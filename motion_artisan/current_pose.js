/**
 * Current Pose — 捕获当前 MMD 模型姿态
 *
 * §3.3 CurrentPoseSnapshot + §4.
 * 1. 捕获所有骨骼的 local + world position/quaternion
 * 2. 计算关键骨骼的近似 MPL 指令用于 current_anchor
 * 3. 不修改模型
 *
 * @module CurrentPose
 */
(function() {
  'use strict';

  /**
   * 捕获当前姿态
   * @param {Object} runtime — { THREE, model, helper, restPoseQuat, restPosePos }
   * @returns {Object} CurrentPoseSnapshot
   */
  function captureCurrentPose(runtime) {
    if (!runtime || !runtime.model || !runtime.model.skeleton) {
      return { schema_version: '1.0', timestamp: Date.now(), model_id: 'unknown', bones: [] };
    }

    var bones = runtime.model.skeleton.bones;
    var snapshot = {
      schema_version: '1.0',
      timestamp: Date.now(),
      model_id: runtime.model.uuid || 'unknown',
      bones: [],
    };

    for (var i = 0; i < bones.length; i++) {
      var b = bones[i];
      var worldPos = new runtime.THREE.Vector3();
      var worldQuat = new runtime.THREE.Quaternion();
      b.getWorldPosition(worldPos);
      b.getWorldQuaternion(worldQuat);

      snapshot.bones.push({
        index: i,
        name: b.name,
        parentIndex: b.parent ? b.parent.index || -1 : -1,
        position: [b.position.x, b.position.y, b.position.z],
        quaternion: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
        worldPosition: [worldPos.x, worldPos.y, worldPos.z],
        worldQuaternion: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
      });
    }

    return snapshot;
  }

  /**
   * 从当前姿态构建近似 MPL anchor pose
   * 将关键骨骼的当前 quaternion 转换为 bend/sway/turn MPL 指令
   *
   * @param {Object} snapshot - CurrentPoseSnapshot
   * @param {Object} runtime - 含 restPoseQuat, restPosePos
   * @returns {Object} { anchorPose: {...}, confidence: "approximate"|"not_supported", approximatedBones: [...] }
   */
  function buildAnchorPose(snapshot, runtime) {
    var anchorPose = {};
    var approximatedBones = [];
    var boneMap = {};
    var restMap = {};

    if (snapshot && snapshot.bones) {
      for (var i = 0; i < snapshot.bones.length; i++) {
        var b = snapshot.bones[i];
        boneMap[b.name] = b;
      }
    }

    // 读取 rest pose
    if (runtime && runtime.restPoseQuat && runtime.model && runtime.model.skeleton) {
      var skeleton = runtime.model.skeleton;
      for (var j = 0; j < skeleton.bones.length; j++) {
        var rb = skeleton.bones[j];
        if (runtime.restPoseQuat[j]) {
          restMap[rb.name] = runtime.restPoseQuat[j];
        }
      }
    }

    // ── 关键骨骼映射: MPL 名 → PMX 名 + 近似方式 ──
    var keyBones = [
      { mpl: 'center', pmxNames: ['センター', 'center'], actions: ['move'] },
      { mpl: 'upper_body', pmxNames: ['上半身', 'upper_body'], actions: ['bend'] },
      { mpl: 'upper_body2', pmxNames: ['上半身2', 'upper_body2'], actions: ['bend'] },
      { mpl: 'neck', pmxNames: ['首', 'neck'], actions: ['bend'] },
      { mpl: 'head', pmxNames: ['頭', 'head'], actions: ['bend'] },
      { mpl: 'arm_r', pmxNames: ['右腕', 'arm_r', '右肩'], actions: ['bend', 'sway'] },
      { mpl: 'arm_l', pmxNames: ['左腕', 'arm_l', '左肩'], actions: ['bend', 'sway'] },
      { mpl: 'elbow_r', pmxNames: ['右ひじ', 'elbow_r', '右肘'], actions: ['bend'] },
      { mpl: 'elbow_l', pmxNames: ['左ひじ', 'elbow_l', '左肘'], actions: ['bend'] },
      { mpl: 'wrist_r', pmxNames: ['右手首', 'wrist_r', '右手捩'], actions: ['sway'] },
      { mpl: 'wrist_l', pmxNames: ['左手首', 'wrist_l', '左手捩'], actions: ['sway'] },
    ];

    for (var k = 0; k < keyBones.length; k++) {
      var kb = keyBones[k];
      var boneData = _findBone(kb.pmxNames, boneMap);
      if (!boneData) continue;

      // 计算当前姿态相对于 rest pose 的 delta
      var deltaEuler = _computeDeltaEuler(boneData, kb.pmxNames[0], restMap);
      if (!deltaEuler) continue;

      var cmds = {};
      var hasAny = false;

      for (var a = 0; a < kb.actions.length; a++) {
        var action = kb.actions[a];
        var dirs = _eulerToMPL(deltaEuler, action);
        if (dirs && Object.keys(dirs).length > 0) {
          // 量化到整数度
          for (var dir in dirs) {
            if (!dirs.hasOwnProperty(dir)) continue;
            dirs[dir] = Math.round(dirs[dir]);
            if (Math.abs(dirs[dir]) > 1) hasAny = true;
          }
          cmds[action] = dirs;
        }
      }

      if (hasAny) {
        anchorPose[kb.mpl] = cmds;
        approximatedBones.push(kb.mpl);
      }
    }

    return {
      anchorPose: anchorPose,
      confidence: approximatedBones.length > 0 ? 'approximate' : 'not_supported',
      approximatedBones: approximatedBones,
    };
  }

  // ═══════════════════════════════════════════
  // 内部：quaternion → Euler 近似
  // ═══════════════════════════════════════════

  function _findBone(pmxNames, boneMap) {
    for (var i = 0; i < pmxNames.length; i++) {
      if (boneMap[pmxNames[i]]) return boneMap[pmxNames[i]];
    }
    return null;
  }

  /**
   * 计算当前 quaternion 相对 rest quaternion 的 Euler delta
   * Y-up MMD 坐标系: Y=up, X=right, Z=forward
   *
   * Euler 顺序: YXZ (符合 MMD 骨骼惯例)
   * bend = X 轴旋转 (前倾/后仰)
   * sway = Z 轴旋转 (侧摆)
   * turn = Y 轴旋转 (扭转)
   */
  function _computeDeltaEuler(boneData, pmxName, restMap) {
    var curQ = boneData.quaternion;
    var restQ = restMap[pmxName];

    if (!curQ || curQ.length !== 4) return null;
    if (!restQ) {
      // 无 rest pose → 用单位四元数
      restQ = { x: 0, y: 0, z: 0, w: 1 };
    }

    var qRest = { x: restQ.x || 0, y: restQ.y || 0, z: restQ.z || 0, w: restQ.w !== undefined ? restQ.w : 1 };
    var qCur = { x: curQ[0], y: curQ[1], z: curQ[2], w: curQ[3] };

    // 计算 delta = cur * inverse(rest)
    var invRest = _quatInv(qRest);
    var delta = _quatMul(qCur, invRest);

    // 转 Euler (YXZ order)
    return _quatToEulerYXZ(delta);
  }

  function _quatInv(q) {
    return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  }

  function _quatMul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  function _quatToEulerYXZ(q) {
    // YXZ 顺序 (Y=turn, X=bend, Z=sway)
    var x = q.x, y = q.y, z = q.z, w = q.w;

    // pitch (X axis = bend)
    var sinPitch = 2 * (w * x + y * z);
    var cosPitch = 1 - 2 * (x * x + y * y);
    var pitch = Math.atan2(sinPitch, cosPitch);

    // yaw (Y axis = turn)
    var sinYaw = 2 * (w * y - z * x);
    var yaw;
    if (Math.abs(sinYaw) > 0.9999) {
      yaw = Math.PI / 2 * Math.sign(sinYaw);
    } else {
      yaw = Math.asin(sinYaw);
    }

    // roll (Z axis = sway)
    var sinRoll = 2 * (w * z + x * y);
    var cosRoll = 1 - 2 * (y * y + z * z);
    var roll = Math.atan2(sinRoll, cosRoll);

    return {
      x: _radToDeg(pitch),   // bend (forward/backward)
      y: _radToDeg(yaw),     // turn (left/right rotation)
      z: _radToDeg(roll),    // sway (left/right lean)
    };
  }

  function _radToDeg(rad) {
    return rad * 180 / Math.PI;
  }

  /**
   * 将 Euler delta 转换为 MPL bend/sway/turn direction 指令
   */
  function _eulerToMPL(delta, action) {
    var result = {};
    switch (action) {
      case 'bend':
        if (Math.abs(delta.x) > 2) {
          result[delta.x > 0 ? 'forward' : 'backward'] = Math.abs(delta.x);
        }
        break;
      case 'sway':
        if (Math.abs(delta.z) > 2) {
          result[delta.z > 0 ? 'right' : 'left'] = Math.abs(delta.z);
        }
        break;
      case 'turn':
        if (Math.abs(delta.y) > 2) {
          result[delta.y > 0 ? 'right' : 'left'] = Math.abs(delta.y);
        }
        break;
      case 'move':
        // move 需要 world position delta → 暂不处理，用 IK 支撑代替
        break;
    }
    return result;
  }

  // ═══════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════

  window.CurrentPose = {
    captureCurrentPose: captureCurrentPose,
    buildAnchorPose: buildAnchorPose,
  };
})();
