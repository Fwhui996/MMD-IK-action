/**
 * MMD Renderer Engine
 * ====================
 * Extracted from Fengyun-MMD project.
 * 
 * Core pipeline:
 *   initScene(containerId) → loadModel(pmxPath) → startLoop()
 * 
 * IK integration:
 *   window.MotionArtisan.init({THREE, model, helper, restPoseQuat, restPosePos, compiler})
 * 
 * Dependencies (loaded before this script):
 *   libs/three.min.js  libs/MMDLoader.js  libs/MMDAnimationHelper.js  
 *   libs/MMDPhysics.js  libs/CCDIKSolver.js  libs/OrbitControls.js  
 *   libs/OutlineEffect.js  libs/ammo.js  libs/mmdparser.min.js  libs/TGALoader.js
 */

(function(global) {
'use strict';

// ── 全局状态 ──
var $ = {
  scene: null, camera: null, renderer: null, controls: null,
  model: null, helper: null, clock: null,
  outlineEffect: null,
  isPlaying: false, _lastFrameTime: 0,
  physics: true, ik: true,
  restPoseQuat: [], restPosePos: [],
  _legBoneIndices: [],
  _softBones: [],
  _softConfigs: []
};

// ── 软骨骼配置（裙子/头发/袖子/蝴蝶结） ──
var SOFT_PATTERNS = [
  { pat: '裙_',     cat: 'skirt',  maxAngle: 0.08, stiffness: 0.35 },
  { pat: '右袖',    cat: 'sleeve', maxAngle: 0.06, stiffness: 0.15 },
  { pat: '腕甲',    cat: 'sleeve', maxAngle: 0.06, stiffness: 0.25 },
  { pat: '後腰',    cat: 'bow',    maxAngle: 0.14, stiffness: 0.14 },
  { pat: '左腰結',  cat: 'bow',    maxAngle: 0.14, stiffness: 0.14 },
  { pat: '右腰結',  cat: 'bow',    maxAngle: 0.14, stiffness: 0.14 },
  { pat: '左腰結帶',cat: 'bow',    maxAngle: 0.14, stiffness: 0.14 },
  { pat: '右腰結帶',cat: 'bow',    maxAngle: 0.14, stiffness: 0.14 },
  { pat: '髮',      cat: 'hair',   maxAngle: 0.12, stiffness: 0.10 },
  { pat: '前髮',    cat: 'hair',   maxAngle: 0.10, stiffness: 0.12 },
  { pat: '後髮',    cat: 'hair',   maxAngle: 0.14, stiffness: 0.08 },
  { pat: '横髮',    cat: 'hair',   maxAngle: 0.12, stiffness: 0.10 },
  { pat: '鬢',      cat: 'hair',   maxAngle: 0.10, stiffness: 0.12 },
  { pat: '捩',      cat: 'hair',   maxAngle: 0.08, stiffness: 0.15 }
];

function initScene(containerId, opts) {
  opts = opts || {};
  var container = document.getElementById(containerId);
  if (!container) throw new Error('Container #' + containerId + ' not found');

  var w = container.clientWidth;
  var h = container.clientHeight;

  // Scene
  $.scene = new THREE.Scene();

  // Background
  if (opts.bgColor) {
    $.scene.background = new THREE.Color(opts.bgColor);
  } else if (opts.bgImage) {
    var bgLoader = new THREE.TextureLoader();
    $.scene.background = bgLoader.load(opts.bgImage);
  } else {
    $.scene.background = new THREE.Color(0x0d1117);
  }

  // Camera
  $.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
  $.camera.position.set(0, 9, 36);
  $.camera.lookAt(0, 9, 0);

  // Renderer
  $.renderer = new THREE.WebGLRenderer({ 
    antialias: true, 
    powerPreference: 'high-performance' 
  });
  $.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  $.renderer.setSize(w, h);
  $.renderer.shadowMap.enabled = true;
  $.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild($.renderer.domElement);

  // Outline effect
  $.outlineEffect = new THREE.OutlineEffect($.renderer, {
    defaultThickness: 0.004,
    defaultColor: new THREE.Color(0x000000),
    defaultAlpha: 1,
    defaultKeepAlive: true
  });

  // Orbit controls
  $.controls = new THREE.OrbitControls($.camera, $.renderer.domElement);
  $.controls.target.set(0, 9, 0);
  $.controls.update();

  // ── 灯光（三点光 + 环境光） ──
  $.ambient = new THREE.AmbientLight(0xffffff, 0.7);
  $.scene.add($.ambient);

  $.keyLight = new THREE.DirectionalLight(0xffffff, 0.35);
  $.keyLight.position.set(1, 1, 1).normalize();
  $.keyLight.castShadow = true;
  $.keyLight.shadow.mapSize.width = 2048;
  $.keyLight.shadow.mapSize.height = 2048;
  $.keyLight.shadow.camera.near = 0.5;
  $.keyLight.shadow.camera.far = 80;
  $.keyLight.shadow.camera.left = -12;
  $.keyLight.shadow.camera.right = 12;
  $.keyLight.shadow.camera.top = 20;
  $.keyLight.shadow.camera.bottom = -4;
  $.keyLight.shadow.bias = -0.0005;
  $.scene.add($.keyLight);

  $.fillLight = new THREE.DirectionalLight(0xddeeff, 0.15);
  $.fillLight.position.set(-6, 8, 10);
  $.scene.add($.fillLight);

  $.rimLight = new THREE.DirectionalLight(0xffddcc, 0.25);
  $.rimLight.position.set(6, 10, -8);
  $.scene.add($.rimLight);

  // Resize
  window.addEventListener('resize', function() {
    var w2 = container.clientWidth;
    var h2 = container.clientHeight;
    $.camera.aspect = w2 / h2;
    $.camera.updateProjectionMatrix();
    $.renderer.setSize(w2, h2);
  });

  console.log('[Renderer] Scene initialized');
  return $;
}

function loadModel(modelPath, opts) {
  opts = opts || {};
  modelPath = modelPath || 'models/feiying.pmx';
  var dir = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);

  return new Promise(function(resolve, reject) {
    var loader = new THREE.MMDLoader();
    loader.setResourcePath(dir);

    loader.load(
      modelPath,
      function(mesh) {
        try {
          $.model = mesh;

          // 材质配置（发射材质风格）
          mesh.traverse(function(child) {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
            if (child.isSkinnedMesh) {
              var mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach(function(m) {
                if (m) {
                  m.skinning = true;
                  if (m.shininess !== undefined) m.shininess = 5;
                  if (m.specular) m.specular.set(0x111111);
                  // 描边
                  var outlineVal = (opts.outlineThickness || 4) / 1000;
                  m.userData.outlineParameters = {
                    thickness: outlineVal,
                    color: [0, 0, 0],
                    alpha: 1.0,
                    visible: true
                  };
                  // 自发光备份
                  if (m.emissive) m._baseEmissive = m.emissive.clone();
                  if (m.type === 'MeshToonMaterial' && m.emissive) {
                    m.emissive = m.emissive.clone().multiplyScalar(0.5);
                    m.emissiveIntensity = 1.0;
                  }
                  m.needsUpdate = true;
                }
              });
            }
          });

          $.scene.add(mesh);

          if (window.PMXPhysicsOptimizer && opts.optimizePhysics !== false) {
            var optReport = window.PMXPhysicsOptimizer.optimizeModel(mesh, {
              modelId: modelPath,
              useCache: true
            });
            console.log('[Renderer] Physics optimizer:', optReport);
          }

          // 捕获 rest pose（IK 需要在 helper.add 之前）
          $.restPoseQuat = [];
          $.restPosePos = [];
          mesh.skeleton.bones.forEach(function(b) {
            $.restPoseQuat.push(b.quaternion.clone());
            $.restPosePos.push(b.position.clone());
          });

          // 腿部骨骼索引（IK 自动切换）
          var legNames = ['leg_l', 'leg_r', 'knee_l', 'knee_r', 'ankle_l', 'ankle_r'];
          $._legBoneIndices = [];
          mesh.skeleton.bones.forEach(function(b, i) {
            if (legNames.indexOf(b.name) >= 0) $._legBoneIndices.push(i);
          });

          // MMDAnimationHelper（物理 + IK）
          $.helper = new THREE.MMDAnimationHelper({ 
            afterglow: 2.0, 
            resetPhysicsOnLoop: false 
          });
          $.helper.add(mesh, { 
            physics: $.physics, 
            unitStep: 1 / 120, 
            maxStepNum: 5 
          });
          $.helper.enabled.physics = $.physics;
          $.helper.enabled.ik = $.ik;

          // 构建软骨骼约束
          buildSoftBoneList();

          console.log('[Renderer] Model loaded: ' + mesh.skeleton.bones.length + ' bones');
          resolve(mesh);
        } catch (e) {
          console.error('[Renderer] Model init failed:', e);
          reject(e);
        }
      },
      function(progress) {
        // progress callback
        if (opts.onProgress) {
          var pct = Math.min(progress.loaded / progress.total * 100, 99);
          opts.onProgress(Math.round(pct));
        }
      },
      function(err) {
        reject(err);
      }
    );
  });
}

// ── 软骨骼注册 ──
function buildSoftBoneList() {
  if (!$.model) return;
  $._softBones = [];
  $._softConfigs = [];

  $.model.skeleton.bones.forEach(function(bone, i) {
    SOFT_PATTERNS.forEach(function(cfg) {
      if (bone.name.indexOf(cfg.pat) === 0) {
        $._softBones.push({
          index: i,
          restQuat: $.restPoseQuat[i].clone(),
          restPos: $.restPosePos[i] ? $.restPosePos[i].clone() : null
        });
        $._softConfigs.push(cfg);
      }
    });
  });

  console.log('[Renderer] Soft bones: ' + $._softBones.length);
}

// ── 软约束应用 ──
function applySoftConstraints(delta) {
  if ($._softBones.length === 0) return;
  var bones = $.model.skeleton.bones;

  for (var i = 0; i < $._softBones.length; i++) {
    var sb = $._softBones[i];
    var cfg = $._softConfigs[i];
    var bone = bones[sb.index];
    if (!bone || !sb.restQuat) continue;

    // 计算当前姿态与 rest 姿态的角度差
    var dot = Math.abs(
      bone.quaternion.x * sb.restQuat.x +
      bone.quaternion.y * sb.restQuat.y +
      bone.quaternion.z * sb.restQuat.z +
      bone.quaternion.w * sb.restQuat.w
    );
    var angle = 2 * Math.acos(Math.min(dot, 1));
    var maxAngle = cfg.maxAngle;

    if (angle > maxAngle) {
      // 弹簧阻尼：超过阈值则拉回
      var t = cfg.stiffness * Math.min(delta * 60, 1);
      bone.quaternion.slerp(sb.restQuat, t);
    }
  }
}

// ── IK 自动控制：腿部骨骼回 rest 时自动开启 ──
function autoControlIK() {
  if ($.isPlaying) {
    $.helper.enabled.ik = $.ik;
    return;
  }
  if (!$.model || !$._legBoneIndices.length || !$.restPoseQuat.length) return;
  var THRESHOLD = 0.999;  // dot ≈ cos(2.5°)
  var bones = $.model.skeleton.bones;
  var allAtRest = true;

  for (var j = 0; j < $._legBoneIndices.length; j++) {
    var idx = $._legBoneIndices[j];
    var restQ = $.restPoseQuat[idx];
    if (!restQ) continue;
    var curQ = bones[idx].quaternion;
    var dot = Math.abs(curQ.x * restQ.x + curQ.y * restQ.y + curQ.z * restQ.z + curQ.w * restQ.w);
    if (dot < THRESHOLD) { allAtRest = false; break; }
  }

  $.helper.enabled.ik = allAtRest;
}

// ── Animation Loop ──
var _animId = null;
var FRAME_INTERVAL = 16;   // ~60fps when playing
var IDLE_INTERVAL = 33;    // ~30fps when idle

function startLoop() {
  $.clock = new THREE.Clock();
  $._lastFrameTime = 0;

  function animate(now) {
    _animId = requestAnimationFrame(animate);
    now = now || 0;

    var interval = ($.isPlaying || $.physics) ? FRAME_INTERVAL : IDLE_INTERVAL;
    if (now - $._lastFrameTime < interval) return;
    $._lastFrameTime = now;

    var delta = $.clock ? $.clock.getDelta() : 0.016;

    if ($.helper) {
      try {
        $.helper.update(delta);
        applySoftConstraints(delta);
        autoControlIK();
      } catch (e) {
        if (!$._helperUpdateWarned) {
          $._helperUpdateWarned = true;
          console.error('[Renderer] Helper update failed, rendering without:', e);
        }
      }
    }

    if ($.outlineEffect && $.scene && $.camera) {
      $.outlineEffect.render($.scene, $.camera);
    } else if ($.renderer && $.scene && $.camera) {
      $.renderer.render($.scene, $.camera);
    }
  }

  animate(0);
  console.log('[Renderer] Animation loop started');
}

function stopLoop() {
  if (_animId) {
    cancelAnimationFrame(_animId);
    _animId = null;
  }
}

// ── 设置物理开关 ──
function setPhysics(enabled) {
  $.physics = enabled;
  if ($.helper) {
    $.helper.enabled.physics = enabled;
  }
}

// ── 设置 IK 开关 ──
function setIK(enabled) {
  $.ik = enabled;
  if ($.helper) {
    $.helper.enabled.ik = enabled;
  }
}

// ── 获取渲染状态 ──
function getState() {
  return $;
}

// ── 获取摄像机截图 ──
function takeScreenshot(width, height) {
  if (!$.renderer) return null;
  var oldSize = $.renderer.getSize(new THREE.Vector2());
  if (width && height) {
    $.renderer.setSize(width, height);
    $.camera.aspect = width / height;
    $.camera.updateProjectionMatrix();
  }
  $.renderer.render($.scene, $.camera);
  var dataURL = $.renderer.domElement.toDataURL('image/png');
  if (width && height) {
    $.renderer.setSize(oldSize.x, oldSize.y);
    $.camera.aspect = oldSize.x / oldSize.y;
    $.camera.updateProjectionMatrix();
  }
  return dataURL;
}

// ── 导出 ──
global.MMDRenderer = {
  initScene: initScene,
  loadModel: loadModel,
  startLoop: startLoop,
  stopLoop: stopLoop,
  setPhysics: setPhysics,
  setIK: setIK,
  getState: getState,
  takeScreenshot: takeScreenshot,
  buildSoftBoneList: buildSoftBoneList
};

})(window);
