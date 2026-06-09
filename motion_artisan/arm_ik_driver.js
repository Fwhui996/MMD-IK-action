/**
 * Arm IK Driver — 手臂 IK 驱动（Phase 1：验证可行性）
 *
 * 用 CCDIKSolver 驱动手臂骨骼：
 * 1. 创建 dummy target bones 挂在 root bone 下，push 进 skeleton.bones
 * 2. 从骨骼层级查找右臂/左臂 IK 链 bone index
 * 3. 每帧设 target worldPosition → solver.update()
 *
 * VMD 兼容：手臂 IK solver 独立于 MMDAnimationHelper 的 leg solver，
 * VMD 播放时不调用 armSolver.update()。
 *
 * @module ArmIKDriver
 */
(function() {
  'use strict';

  var _armSolver = null;
  var _rightTarget = null;
  var _leftTarget = null;
  var _rightTargetIdx = -1;
  var _leftTargetIdx = -1;
  var _initialized = false;
  var _mesh = null;
  var _bones = null;
  var _THREE = null;

  var BONE_PATTERNS = {
    wrist_r:  ['右手首', 'wrist_R', 'Wrist_R', '手首_R', 'r_wrist', '右手捩'],
    elbow_r:  ['右ひじ', 'elbow_R', 'Elbow_R', '右肘', 'r_elbow'],
    arm_r:    ['右腕', 'arm_R', 'Arm_R', 'r_arm'],
    shoulder_r: ['右肩', 'shoulder_R', 'Shoulder_R', 'r_shoulder'],
    wrist_l:  ['左手首', 'wrist_L', 'Wrist_L', '手首_L', 'l_wrist', '左手捩'],
    elbow_l:  ['左ひじ', 'elbow_L', 'Elbow_L', '左肘', 'l_elbow'],
    arm_l:    ['左腕', 'arm_L', 'Arm_L', 'l_arm'],
    shoulder_l: ['左肩', 'shoulder_L', 'Shoulder_L', 'l_shoulder'],
  };

  function _findBoneIdx(namePatterns) {
    for (var i = 0; i < _bones.length; i++) {
      var name = _bones[i].name || '';
      for (var j = 0; j < namePatterns.length; j++) {
        if (name.indexOf(namePatterns[j]) !== -1 || namePatterns[j].indexOf(name) !== -1) {
          return i;
        }
      }
    }
    return -1;
  }

  function init(runtime, calProfile) {
    if (!runtime || !runtime.model) {
      console.warn('[ArmIKDriver] init: no model in runtime');
      return false;
    }

    _mesh = runtime.model;
    _THREE = runtime.THREE;
    _bones = _mesh.skeleton ? _mesh.skeleton.bones : [];

    if (_bones.length === 0) {
      console.warn('[ArmIKDriver] init: skeleton has no bones');
      return false;
    }

    var rWrist   = _findBoneIdx(BONE_PATTERNS.wrist_r);
    var rElbow   = _findBoneIdx(BONE_PATTERNS.elbow_r);
    var rArm     = _findBoneIdx(BONE_PATTERNS.arm_r);
    var rShoulder = _findBoneIdx(BONE_PATTERNS.shoulder_r);

    console.log('[ArmIKDriver] right arm bones:',
      'wrist=' + rWrist + ' elbow=' + rElbow + ' arm=' + rArm + ' shoulder=' + rShoulder);

    if (rWrist < 0 || rElbow < 0 || rArm < 0) {
      console.warn('[ArmIKDriver] right arm bones not found. Listing arm-related bones:');
      for (var d = 0; d < _bones.length; d++) {
        var bn = _bones[d].name;
        if (bn.indexOf('腕') >= 0 || bn.indexOf('arm') >= 0 || bn.indexOf('ひじ') >= 0 ||
            bn.indexOf('elbow') >= 0 || bn.indexOf('肩') >= 0 || bn.indexOf('wrist') >= 0) {
          console.log('[ArmIKDriver]   bone[' + d + '] = "' + bn + '"');
        }
      }
      return false;
    }

    var rootBone = _bones[0];

    _rightTarget = new _THREE.Bone();
    _rightTarget.name = '__ik_target_hand_r';
    rootBone.add(_rightTarget);
    _rightTargetIdx = _bones.length;
    _bones.push(_rightTarget);

    _leftTarget = new _THREE.Bone();
    _leftTarget.name = '__ik_target_hand_l';
    rootBone.add(_leftTarget);
    _leftTargetIdx = _bones.length;
    _bones.push(_leftTarget);

    console.log('[ArmIKDriver] dummy targets: right_idx=' + _rightTargetIdx + ' left_idx=' + _leftTargetIdx);

    var ikConfigs = [];

    ikConfigs.push({
      target: _rightTargetIdx,
      effector: rWrist,
      links: [
        {
          index: rElbow,
          limitation: new _THREE.Vector3(1, 0, 0),
          rotationMin: new _THREE.Vector3(-0.3, -0.3, -0.6),
          rotationMax: new _THREE.Vector3(Math.PI * 0.7, 0.3, 0.3),
        },
        {
          index: rArm,
        },
      ],
      iteration: 5,
    });

    var lWrist   = _findBoneIdx(BONE_PATTERNS.wrist_l);
    var lElbow   = _findBoneIdx(BONE_PATTERNS.elbow_l);
    var lArm     = _findBoneIdx(BONE_PATTERNS.arm_l);
    console.log('[ArmIKDriver] left arm bones:',
      'wrist=' + lWrist + ' elbow=' + lElbow + ' arm=' + lArm);

    if (lWrist >= 0 && lElbow >= 0 && lArm >= 0) {
      ikConfigs.push({
        target: _leftTargetIdx,
        effector: lWrist,
        links: [
          {
            index: lElbow,
            limitation: new _THREE.Vector3(1, 0, 0),
            rotationMin: new _THREE.Vector3(-0.3, -0.3, -0.3),
            rotationMax: new _THREE.Vector3(Math.PI * 0.7, 0.6, 0.3),
          },
          {
            index: lArm,
          },
        ],
        iteration: 5,
      });
    }

    try {
      _armSolver = new _THREE.CCDIKSolver(_mesh, ikConfigs);
      _initialized = true;
      console.log('[ArmIKDriver] CCDIKSolver created with ' + ikConfigs.length + ' chain(s)');
    } catch (e) {
      console.error('[ArmIKDriver] CCDIKSolver creation failed:', e.message);
      return false;
    }

    return true;
  }

  function setRightTarget(x, y, z) {
    if (!_initialized || !_rightTarget) return;
    _rightTarget.position.set(x, y, z);
  }

  function setLeftTarget(x, y, z) {
    if (!_initialized || !_leftTarget) return;
    _leftTarget.position.set(x, y, z);
  }

  function getRightWristPos() {
    if (!_bones || !_initialized) return null;
    var idx = _findBoneIdx(BONE_PATTERNS.wrist_r);
    if (idx < 0) return null;
    var wp = new _THREE.Vector3();
    _bones[idx].getWorldPosition(wp);
    return { x: wp.x, y: wp.y, z: wp.z };
  }

  function getLeftWristPos() {
    if (!_bones || !_initialized) return null;
    var idx = _findBoneIdx(BONE_PATTERNS.wrist_l);
    if (idx < 0) return null;
    var wp = new _THREE.Vector3();
    _bones[idx].getWorldPosition(wp);
    return { x: wp.x, y: wp.y, z: wp.z };
  }

  function update() {
    if (!_initialized || !_armSolver) return;
    try { _armSolver.update(); } catch (e) { console.warn('[ArmIKDriver] solver.update() error:', e.message); }
  }

  function isInitialized() { return _initialized; }
  function getSolver() { return _armSolver; }

  window.ArmIKDriver = {
    init: init,
    setRightTarget: setRightTarget,
    setLeftTarget: setLeftTarget,
    getRightWristPos: getRightWristPos,
    getLeftWristPos: getLeftWristPos,
    update: update,
    isInitialized: isInitialized,
    getSolver: getSolver,
    reset: function() {
      _armSolver = null; _rightTarget = null; _leftTarget = null;
      _initialized = false; _mesh = null; _bones = null;
    },
    BONE_PATTERNS: BONE_PATTERNS,
  };
})();
