/**
 * Model Data Extractor — 综合 PMX 模型数据提取器
 *
 * 从 Three.js MMD 运行时提取完整的模型结构数据，
 * 用于输入碰撞动作生成器。
 *
 * 提取内容：
 *  1. 骨骼骨架 — 层次结构、世界坐标、四元数、子骨长度
 *  2. 刚性碰撞体 — 形状类型、尺寸、世界坐标/旋转、物理参数
 *  3. 约束/连接器 — 线性/角度限制、弹簧常数
 *  4. 变形目标 — Morph targets 明称
 *  5. 语义部位映射 — 自动匹配 PMX 骨骼名到解剖部位
 *
 * 依赖: PMXCollisionProfile, ModelCalibration, CurrentPose, ModelProfile
 *
 * @module ModelDataExtractor
 */
(function() {
  'use strict';

  /**
   * 提取完整模型数据
   *
   * @param {Object} runtime — { THREE, model, helper, restPoseQuat, restPosePos }
   * @param {Object} options — { includeWorldTransforms: bool, includeQuaternions: bool }
   * @returns {Object} 完整模型 Profile JSON
   */
  function extractFullModelData(runtime, options) {
    options = options || {};
    var includeWorld = options.includeWorldTransforms !== false;
    var includeQuat = options.includeQuaternions !== false;

    var data = {
      schema_version: '2.0.0',
      extracted_at: new Date().toISOString(),
      timestamp: Date.now(),
      model_id: 'unknown',
    };

    if (!runtime || !runtime.model) {
      data.error = 'no model in runtime';
      return data;
    }

    var model = runtime.model;
    data.model_id = model.uuid || 'unknown';
    data.model_name = model.name || 'unknown';

    // ── Section 1: 骨骼骨架 ──
    data.skeleton = _extractSkeleton(runtime, includeWorld, includeQuat);

    // ── Section 2: 刚体 ──
    data.rigidBodies = _extractRigidBodiesFull(runtime, includeWorld);

    // ── Section 3: 约束/关节 ──
    data.constraints = _extractJointConstraints(runtime);

    // ── Section 4: 变形目标 ──
    data.morphTargets = _extractMorphTargets(runtime);

    // ── Section 5: 校准数据 ──
    data.calibration = _buildFullCalibration(runtime);

    // ── Section 6: 语义部位 ──
    data.semanticParts = _extractSemanticParts(runtime, data.rigidBodies, data.skeleton);

    // ── Section 7: 摘要 ──
    data.summary = _buildSummary(data);

    return data;
  }

  // ================================================================
  // Section 1: 骨骼骨架
  // ================================================================

  function _extractSkeleton(runtime, includeWorld, includeQuat) {
    var model = runtime.model;
    var THREE = runtime.THREE;
    var skeleton = model.skeleton;
    var bones = skeleton.bones;

    var result = {
      bone_count: bones.length,
      root_bone: bones[0] ? bones[0].name : null,
      bones: [],
    };

    // Build rest quaternion map for FK engine baseline
    var restQuatMap = {};
    if (runtime.restPoseQuat) {
      for (var ri = 0; ri < bones.length; ri++) {
        var rq = runtime.restPoseQuat[ri];
        if (rq) {
          restQuatMap[bones[ri].name] = { x: rq.x || 0, y: rq.y || 0, z: rq.z || 0, w: rq.w !== undefined ? rq.w : 1 };
        }
      }
    }
    result._restQuatMap = restQuatMap;
    var restQuatMapBuilt = Object.keys(restQuatMap).length > 0;

    var nameMap = {};
    var childMap = {}; // parentIndex -> [childIndex, ...]
    for (var i = 0; i < bones.length; i++) {
      var b = bones[i];
      nameMap[b.name] = i;

      var pidx = -1;
      if (b.parent && b.parent.name) {
        pidx = b.parent.index !== undefined ? b.parent.index : (nameMap[b.parent.name] !== undefined ? nameMap[b.parent.name] : -1);
      }
      if (pidx >= 0) {
        if (!childMap[pidx]) childMap[pidx] = [];
        childMap[pidx].push(i);
      }
    }

    // 第2遍：提取每个骨骼的全面数据
    for (var i = 0; i < bones.length; i++) {
      var b = bones[i];
      var entry = {
        index: i,
        name: b.name,
        parentIndex: -1,
        parentName: null,
        children: childMap[i] || [],
        depth: 0,
      };

      if (b.parent && b.parent.name) {
        entry.parentIndex = b.parent.index !== undefined ? b.parent.index : (nameMap[b.parent.name] !== undefined ? nameMap[b.parent.name] : -1);
        entry.parentName = b.parent.name;
      }

      // 本地位置
      entry.localPosition = [b.position.x, b.position.y, b.position.z];

      // 本地四元数
      if (includeQuat) {
        entry.localQuaternion = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
      }

      // Rest quaternion for FK engine (distinct from current quaternion)
      if (includeQuat && restQuatMapBuilt) {
        var rq = restQuatMap[b.name];
        if (rq) {
          entry.restQuaternion = [rq.x, rq.y, rq.z, rq.w];
        }
      }

      // 世界位置
      if (includeWorld) {
        var worldPos = new THREE.Vector3();
        b.getWorldPosition(worldPos);
        entry.worldPosition = [worldPos.x, worldPos.y, worldPos.z];

        if (includeQuat) {
          var worldQuat = new THREE.Quaternion();
          b.getWorldQuaternion(worldQuat);
          entry.worldQuaternion = [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w];
        }
      }

      result.bones.push(entry);
    }

    // 第3遍：递归计算 depth
    function _setDepth(idx, d) {
      if (idx < 0 || idx >= result.bones.length) return;
      result.bones[idx].depth = d;
      var children = result.bones[idx].children;
      for (var c = 0; c < children.length; c++) {
        _setDepth(children[c], d + 1);
      }
    }
    // 找根 bone (parentIndex < 0) 并递归
    for (var i = 0; i < result.bones.length; i++) {
      if (result.bones[i].parentIndex < 0) {
        _setDepth(i, 0);
      }
    }
    // 处理可能未到达的节点
    for (var i = 0; i < result.bones.length; i++) {
      if (result.bones[i].depth === 0 && result.bones[i].parentIndex >= 0) {
        result.bones[i].depth = (result.bones[result.bones[i].parentIndex] ? result.bones[result.bones[i].parentIndex].depth + 1 : 0);
      }
    }

    // 第4遍：子骨长度（到第一个 child 的距离）
    for (var i = 0; i < result.bones.length; i++) {
      var entryB = result.bones[i];
      var ch = entryB.children;
      if (ch.length > 0) {
        var firstChild = result.bones[ch[0]];
        if (entryB.localPosition && firstChild && firstChild.localPosition) {
          var dx = firstChild.localPosition[0] - entryB.localPosition[0];
          var dy = firstChild.localPosition[1] - entryB.localPosition[1];
          var dz = firstChild.localPosition[2] - entryB.localPosition[2];
          entryB.length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        } else {
          entryB.length = 0;
        }
      } else {
        entryB.length = 0;
      }
    }

    return result;
  }

  // ================================================================
  // Section 2: 刚体
  // ================================================================

  function _extractRigidBodiesFull(runtime, includeWorld) {
    // 复用 PMXCollisionProfile 的提取逻辑
    var rigidBodies = [];
    if (window.PMXCollisionProfile && typeof window.PMXCollisionProfile.extractRigidBodies === 'function') {
      rigidBodies = window.PMXCollisionProfile.extractRigidBodies(runtime);
    }

    if (rigidBodies.length === 0) return rigidBodies;

    // 补充世界变换
    if (includeWorld) {
      var boneMap = _buildBoneWorldMap(runtime.model, runtime.THREE);

      for (var i = 0; i < rigidBodies.length; i++) {
        var rb = rigidBodies[i];
        var boneName = rb.boneName || 'unknown';
        var boneW = boneMap[boneName];

        if (boneW) {
          var lp = rb.localPosition || [0, 0, 0];
          rb.worldPosition = [
            boneW.pos[0] + lp[0],
            boneW.pos[1] + lp[1],
            boneW.pos[2] + lp[2],
          ];
          if (boneW.quat) {
            rb.worldQuaternion = [
              boneW.quat[0], boneW.quat[1], boneW.quat[2], boneW.quat[3],
            ];
          }
        } else {
          rb.worldPosition = rb.localPosition ? rb.localPosition.slice(0) : [0, 0, 0];
        }

        // 计算碰撞半径
        rb.collisionRadius = _computeCollisionRadius(rb);
      }
    }

    return rigidBodies;
  }

  function _computeCollisionRadius(rb) {
    var s = rb.size || [1, 1, 1];
    switch (rb.shape) {
      case 'sphere': return s[0] || 1;
      case 'capsule': return Math.max(s[0] || 0.5, (s[1] || 1) * 0.5);
      case 'box':
        var w = s[0] || 1, h = s[1] || 1, d = s[2] || 1;
        return Math.sqrt(w * w + h * h + d * d) * 0.5;
      default: return 1;
    }
  }

  // ================================================================
  // Section 3: 约束/关节
  // ================================================================

  function _extractJointConstraints(runtime) {
    var constraints = [];
    if (!runtime.model) return constraints;

    var found = false;
    runtime.model.traverse(function(child) {
      if (found) return;
      if (!child.isSkinnedMesh) return;
      if (!child.geometry || !child.geometry.userData) return;

      var mmdData = child.geometry.userData.MMD;
      if (!mmdData || !mmdData.constraints) return;
      found = true;

      var srcConstraints = mmdData.constraints;
      var rigidBodies = mmdData.rigidBodies || [];

      for (var i = 0; i < srcConstraints.length; i++) {
        var sc = srcConstraints[i];
        var rbA = rigidBodies[sc.rigidBodyIndex1] || {};
        var rbB = rigidBodies[sc.rigidBodyIndex2] || {};

        constraints.push({
          index: i,
          name: sc.name || ('constraint_' + i),
          rigidBodyA: sc.rigidBodyIndex1,
          rigidBodyAName: rbA.name || 'body_' + sc.rigidBodyIndex1,
          rigidBodyB: sc.rigidBodyIndex2,
          rigidBodyBName: rbB.name || 'body_' + sc.rigidBodyIndex2,
          localPosition: sc.position ? sc.position.slice(0) : [0, 0, 0],
          localRotation: sc.rotation ? sc.rotation.slice(0) : [0, 0, 0],
          linearLower: sc.linearLower ? sc.linearLower.slice(0) : [0, 0, 0],
          linearUpper: sc.linearUpper ? sc.linearUpper.slice(0) : [0, 0, 0],
          angularLower: sc.angularLower ? [sc.angularLower[0], sc.angularLower[1]] : [0, 0],
          angularUpper: sc.angularUpper ? [sc.angularUpper[0], sc.angularUpper[1]] : [0, 0],
          springLinear: sc.springLinear ? sc.springLinear.slice(0) : [0, 0, 0],
          springAngular: sc.springAngular ? [sc.springAngular[0], sc.springAngular[1]] : [0, 0],
        });
      }
    });

    return constraints;
  }

  // ================================================================
  // Section 4: 变形目标 (Morph targets)
  // ================================================================

  function _extractMorphTargets(runtime) {
    var morphs = [];
    if (!runtime.model) return morphs;

    var seen = {};
    runtime.model.traverse(function(child) {
      if (!child.isMesh || !child.geometry || !child.geometry.morphAttributes) return;

      var morphKeys = Object.keys(child.geometry.morphAttributes);
      for (var i = 0; i < morphKeys.length; i++) {
        var key = morphKeys[i];
        var attrs = child.geometry.morphAttributes[key];
        if (!attrs) continue;

        for (var j = 0; j < attrs.length; j++) {
          var name = attrs[j] ? attrs[j].name : null;
          if (name && !seen[name]) {
            seen[name] = true;
            morphs.push({
              index: j,
              name: name,
              type: key,
            });
          }
        }
      }
    });

    return morphs;
  }

  // ================================================================
  // Section 5: 校准数据
  // ================================================================

  function _buildFullCalibration(runtime) {
    var snapshot = null;
    if (window.CurrentPose && typeof window.CurrentPose.captureCurrentPose === 'function') {
      snapshot = window.CurrentPose.captureCurrentPose(runtime);
    }

    var cal = {};
    if (window.ModelCalibration && typeof window.ModelCalibration.buildCalibration === 'function') {
      cal = window.ModelCalibration.buildCalibration(runtime, snapshot);
    }

    // 补充 Bounding Box
    if (runtime.model && runtime.THREE) {
      try {
        var bbox = new runtime.THREE.Box3().setFromObject(runtime.model);
        cal.boundingBox = {
          min: [bbox.min.x, bbox.min.y, bbox.min.z],
          max: [bbox.max.x, bbox.max.y, bbox.max.z],
        };
      } catch (e) {}
    }

    return cal;
  }

  // ================================================================
  // Section 6: 语义部位
  // ================================================================

  function _extractSemanticParts(runtime, rigidBodies, skeleton) {
    if (window.PMXCollisionProfile && typeof window.PMXCollisionProfile.extractSemanticParts === 'function') {
      var bones = skeleton ? skeleton.bones || [] : [];
      return window.PMXCollisionProfile.extractSemanticParts(rigidBodies || [], bones);
    }
    return {};
  }

  // ================================================================
  // Section 7: 摘要
  // ================================================================

  function _buildSummary(data) {
    return {
      boneCount: data.skeleton ? data.skeleton.bone_count : 0,
      rigidBodyCount: data.rigidBodies ? data.rigidBodies.length : 0,
      constraintCount: data.constraints ? data.constraints.length : 0,
      morphTargetCount: data.morphTargets ? data.morphTargets.length : 0,
      modelHeight: data.calibration ? data.calibration.height || 0 : 0,
      scale: data.calibration ? data.calibration.scale || 1 : 1,
      floorY: data.calibration && data.calibration.floorPlane ? data.calibration.floorPlane.y : 0,
      reliable: data.calibration ? !!data.calibration.reliable : false,
      fallbackRigidBodiesUsed: false,
    };
  }

  // ================================================================
  // 内部工具
  // ================================================================

  function _buildBoneWorldMap(model, THREE) {
    var map = {};
    if (!model || !model.skeleton) return map;

    var bones = model.skeleton.bones;
    for (var i = 0; i < bones.length; i++) {
      var b = bones[i];
      var worldPos = new THREE.Vector3();
      var worldQuat = new THREE.Quaternion();
      b.getWorldPosition(worldPos);
      b.getWorldQuaternion(worldQuat);
      map[b.name] = {
        pos: [worldPos.x, worldPos.y, worldPos.z],
        quat: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
      };
    }
    return map;
  }

  // ================================================================
  // 导出
  // ================================================================

  window.ModelDataExtractor = {
    extractFullModelData: extractFullModelData,
  };
})();
