/**
 * Model Calibration — 模型校准 Profile
 *
 * §4.4.4. 为当前加载的 PMX 模型构建校准数据：
 * 缩放、肢体长度、地板平面、安全间隙、下沉幅度。
 *
 * 校准来源优先级：
 * 1. skeleton bounding box → scale / height
 * 2. bone world positions → limb lengths
 * 3. PMX foot rest positions → floorY
 * 4. model bounding box bottom → floorY fallback
 * 5. fallback y=0
 *
 * @module ModelCalibration
 */
(function() {
  'use strict';

  /**
   * 构建当前模型的校准 profile
   * @param {Object} runtime — { THREE, model, helper }
   * @param {Object} snapshot — CurrentPoseSnapshot
   * @returns {Object} ModelCalibrationProfile
   */
  function buildCalibration(runtime, snapshot) {
    var profile = {
      model_id: runtime.model ? (runtime.model.uuid || 'unknown') : 'unknown',
      scale: 1.0,
      height: 17.0,
      floorPlane: { source: 'bbox_bottom', y: 0.0 },
      proportions: {
        torsoHeight: 4.0,
        upperArmLength: 2.0,
        forearmLength: 1.8,
        thighLength: 3.0,
        shinLength: 2.8,
      },
      clearance: {
        handChestMin: 0.18,
        handHeadMin: 0.16,
        forearmTorsoMin: 0.12,
        footFloorTolerance: 0.03,
      },
      motionLimits: {
        centerDownTiny: 0.6,
        centerDownSmall: 1.5,
        centerDownMedium: 3.2,
        centerDownHardMax: 5.5,
      },
      fallbackCollisionBodiesUsed: false,
      shoulderWidth: 3.0,
      armTotalLength: 4.0,
      torsoDepth: 1.5,
      boneIndexMap: {},
    };

    // ── 1. 从 skeleton 提取 scale ──
    var bbox = _computeBoundingBox(runtime);
    if (bbox) {
      profile.height = bbox.max.y - bbox.min.y;
      profile.scale = profile.height / 17.0; // 标准化到 17 unit 标准模型
      if (bbox.min.y !== undefined) {
        profile.floorPlane = { source: 'bbox_bottom', y: bbox.min.y };
      }
    }

    // ── 2. 从 snapshot 提取脚位置（更精确的 floorY）──
    if (snapshot && snapshot.bones) {
      var footY = _getFootWorldY(snapshot);
      if (footY !== null) {
        profile.floorPlane = { source: 'pmx_foot_rest', y: footY };
      }
    }

    // ── 3. 从 snapshot 提取肢体长度 ──
    if (snapshot && snapshot.bones) {
      var limbLengths = _computeLimbLengths(snapshot);
      if (limbLengths) {
        profile.proportions = limbLengths;
      }
    }

    // ── 4. 基于 scale 调整校准值 ──
    _applyScale(profile);

    // ── Phase 2: 肩宽、臂全长、IK index 映射 ──
    if (snapshot && snapshot.bones) {
      var boneMap2 = {};
      for (var k2 = 0; k2 < snapshot.bones.length; k2++) {
        boneMap2[snapshot.bones[k2].name] = snapshot.bones[k2];
      }

      var rSh = _findBoneByNames(boneMap2, ['右肩', 'shoulder_R', 'Shoulder_R', '右腕', 'arm_R']);
      var lSh = _findBoneByNames(boneMap2, ['左肩', 'shoulder_L', 'Shoulder_L', '左腕', 'arm_L']);
      if (rSh && lSh && rSh.worldPosition && lSh.worldPosition) {
        profile.shoulderWidth = Math.abs(rSh.worldPosition[0] - lSh.worldPosition[0]);
      }

      var armR = _computeArmChainLength(boneMap2,
        ['右肩','shoulder_R','Shoulder_R','右腕','arm_R'],
        ['右手首','wrist_R','Wrist_R','右手捩'],
        ['右ひじ','elbow_R','Elbow_R','右肘']);
      if (armR > 0) profile.armTotalLength = armR;

      profile.torsoDepth = profile.shoulderWidth * 0.35;
      profile.boneIndexMap = _buildIKIndexMap(runtime, snapshot);
    }

    // ── 5. 标记可靠性 ──
    profile.reliable = !!bbox && !!snapshot;

    return profile;
  }

  // ═══════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════

  function _computeBoundingBox(runtime) {
    try {
      if (!runtime || !runtime.model) return null;
      var model = runtime.model;
      var bbox = new runtime.THREE.Box3().setFromObject(model);
      return { min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z }, max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z } };
    } catch (e) {
      return null;
    }
  }

  function _getFootWorldY(snapshot) {
    var footNames = ['左足ＩＫ', '右足ＩＫ', '左足首', '右足首', '左足', '右足'];
    var yValues = [];
    for (var i = 0; i < snapshot.bones.length; i++) {
      var b = snapshot.bones[i];
      if (footNames.indexOf(b.name) >= 0 && b.worldPosition) {
        yValues.push(b.worldPosition[1]);
      }
    }
    if (yValues.length === 0) return null;
    return Math.min.apply(null, yValues);
  }

  function _computeLimbLengths(snapshot) {
    // 从骨骼 world position 估算肢体长度
    var result = {
      torsoHeight: 4.0,
      upperArmLength: 2.0,
      forearmLength: 1.8,
      thighLength: 3.0,
      shinLength: 2.8,
    };

    var boneMap = {};
    for (var i = 0; i < snapshot.bones.length; i++) {
      var b = snapshot.bones[i];
      boneMap[b.name] = b;
    }

    // 上半身 → 下半身 = torsoHeight
    var upper = boneMap['上半身'];
    var lower = boneMap['下半身'];
    if (upper && lower && upper.worldPosition && lower.worldPosition) {
      result.torsoHeight = Math.abs(upper.worldPosition[1] - lower.worldPosition[1]);
    }

    // 右腕 → 右ひじ = forearmLength
    var rWrist = boneMap['右腕'] || boneMap['右手首'];
    var rElbow = boneMap['右ひじ'] || boneMap['右肘'];
    if (rWrist && rElbow && rWrist.worldPosition && rElbow.worldPosition) {
      result.forearmLength = _dist(rWrist.worldPosition, rElbow.worldPosition);
    }

    // 右肩 → 右ひじ = upperArmLength
    var rShoulder = boneMap['右肩'] || boneMap['右腕'];
    if (rShoulder && rElbow && rShoulder.worldPosition && rElbow.worldPosition) {
      result.upperArmLength = _dist(rShoulder.worldPosition, rElbow.worldPosition);
    }

    return result;
  }

  function _dist(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function _applyScale(profile) {
    var s = profile.scale;
    // 缩放 clearance
    profile.clearance.handChestMin *= s;
    profile.clearance.handHeadMin *= s;
    profile.clearance.forearmTorsoMin *= s;
    profile.clearance.footFloorTolerance *= s;

    // 缩放 motion limits
    var ml = profile.motionLimits;
    ml.centerDownTiny *= s;
    ml.centerDownSmall *= s;
    ml.centerDownMedium *= s;
    ml.centerDownHardMax *= s;

    // 缩放 proportions
    for (var key in profile.proportions) {
      if (profile.proportions.hasOwnProperty(key)) {
        profile.proportions[key] *= s;
      }
    }
  }

  // ═══════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════

  function _findBoneByNames(boneMap, names) {
    for (var fn = 0; fn < names.length; fn++) {
      for (var key in boneMap) {
        if (boneMap.hasOwnProperty(key) && key.indexOf(names[fn]) !== -1) return boneMap[key];
      }
    }
    return null;
  }

  function _computeArmChainLength(boneMap, shoulderNames, wristNames, elbowNames) {
    var shoulder = _findBoneByNames(boneMap, shoulderNames);
    var elbow = _findBoneByNames(boneMap, elbowNames);
    var wrist = _findBoneByNames(boneMap, wristNames);
    if (!shoulder || !wrist) return 0;
    var total = 0;
    if (shoulder.worldPosition && elbow && elbow.worldPosition) {
      total += _dist(shoulder.worldPosition, elbow.worldPosition);
    }
    if (elbow && elbow.worldPosition && wrist.worldPosition) {
      total += _dist(elbow.worldPosition, wrist.worldPosition);
    }
    if (total === 0) {
      total = _dist(shoulder.worldPosition, wrist.worldPosition) * 1.05;
    }
    return total;
  }

  function _buildIKIndexMap(runtime, snapshot) {
    var idxMap = { right_hand: {}, left_hand: {} };
    if (!runtime || !runtime.model || !runtime.model.skeleton) return idxMap;
    var bones = runtime.model.skeleton.bones;
    var boneIdxMap = {};
    for (var bi = 0; bi < bones.length; bi++) { boneIdxMap[bones[bi].name] = bi; }

    var patterns = (window.ArmIKDriver && window.ArmIKDriver.BONE_PATTERNS) ? window.ArmIKDriver.BONE_PATTERNS : {};
    function _findIdx(pk) {
      var pats = patterns[pk] || [];
      for (var pj = 0; pj < pats.length; pj++) {
        for (var nk in boneIdxMap) {
          if (boneIdxMap.hasOwnProperty(nk) && nk.indexOf(pats[pj]) !== -1) return boneIdxMap[nk];
        }
      }
      return -1;
    }

    idxMap.right_hand = {
      target: -1,
      effector: _findIdx('wrist_r'),
      chain: [_findIdx('elbow_r'), _findIdx('arm_r'), _findIdx('shoulder_r')],
    };
    idxMap.left_hand = {
      target: -1,
      effector: _findIdx('wrist_l'),
      chain: [_findIdx('elbow_l'), _findIdx('arm_l'), _findIdx('shoulder_l')],
    };
    return idxMap;
  }

  window.ModelCalibration = {
    buildCalibration: buildCalibration,
  };
})();
