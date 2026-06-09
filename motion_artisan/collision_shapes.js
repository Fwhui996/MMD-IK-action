/**
 * Collision Shapes — 碰撞体定义与成对检测
 *
 * 基于 PMX 刚体数据构建碰撞形状（球/盒/胶囊），
 * 在真实 FK 世界姿态上执行 clearance 检查。
 *
 * 真实路径：通过 Three.js 骨骼世界矩阵计算碰撞体 world center。
 * 近似路径：snapshot worldPosition + MPL pose delta（非 Three.js 环境 fallback）。
 *
 * 关键碰撞对：
 *   hand ↔ chest（手穿胸）
 *   hand ↔ head（手穿头）
 *   forearm ↔ chest（前臂穿胸）
 *   hand ↔ hand（双手交叉）
 *   leg ↔ torso（腿穿躯干）
 *
 * @module CollisionShapes
 */
(function() {
  'use strict';

  /**
   * 碰撞对定义
   */
  var COLLISION_PAIRS = [
    { a: '右手首', b: '上半身', name: 'rightHand_chest', minClearance: 0.18 },
    { a: '左手首', b: '上半身', name: 'leftHand_chest', minClearance: 0.18 },
    { a: '右手首', b: '頭', name: 'rightHand_head', minClearance: 0.16 },
    { a: '左手首', b: '頭', name: 'leftHand_head', minClearance: 0.16 },
    { a: '右ひじ', b: '上半身', name: 'rightForearm_chest', minClearance: 0.12 },
    { a: '左ひじ', b: '上半身', name: 'leftForearm_chest', minClearance: 0.12 },
    { a: '右手首', b: '左手首', name: 'rightHand_leftHand', minClearance: 0.10 },
    { a: '右ひじ', b: '左ひじ', name: 'rightElbow_leftElbow', minClearance: 0.10 },
  ];

  /**
   * Three.js runtime 引用（在浏览器中由 MotionArtisan.init 注入）
   */
  var _threeRuntime = null;

  function setRuntime(runtime) {
    _threeRuntime = runtime;
  }

  /**
   * 从 PMX 刚体构建碰撞形状
   */
  function buildShapes(rigidBodies) {
    var shapes = [];
    for (var i = 0; i < rigidBodies.length; i++) {
      var rb = rigidBodies[i];
      shapes.push({
        index: rb.index,
        boneName: rb.boneName || rb.name,
        boneIndex: rb.boneIndex,
        shape: rb.shape,
        size: rb.size,
        localPosition: rb.localPosition,
        center: rb.localPosition ? rb.localPosition.slice(0) : [0, 0, 0],
        radius: _computeRadius(rb),
        halfExtents: _computeHalfExtents(rb),
      });
    }
    return shapes;
  }

  /**
   * 获取碰撞对的 world-space 包围球中心
   *
   * 优先使用 Three.js FK（真实骨链世界矩阵）；
   * 无 Three.js 时退化为 snapshot + pose delta 近似。
   *
   * @param {string} boneName — 碰撞体关联的 PMX 骨骼名（如 '右手首'）
   * @param {Object} snapshot — CurrentPoseSnapshot
   * @param {Object} pose — 当前 keyframe 的 MPL pose
   * @returns {Object|null} { x, y, z } world position
   */
  function getWorldCenter(boneName, snapshot, pose) {
    // ── Primary: FK engine prediction ──
    if (window.FKEngine) {
      var fkResult = window.FKEngine.computeWorldPosition(boneName, null, pose, snapshot);
      if (fkResult) return fkResult;
    }

    // ── Fallback: snapshot approximate (crude linear delta) ──
    var basePos = _findBoneWorldPos(boneName, snapshot);
    if (!basePos) return null;

    var delta = _getPoseDelta(boneName, pose);
    return {
      x: basePos[0] + (delta.x || 0),
      y: basePos[1] + (delta.y || 0),
      z: basePos[2] + (delta.z || 0),
      _method: 'snapshot_approximate',
    };
  }

  /**
   * 通过 Three.js 骨链世界矩阵计算碰撞体世界坐标
   */
  function _computeWorldFromThreeFK(pmxBoneName, runtime) {
    var bone = _findThreeBone(pmxBoneName, runtime);
    if (!bone) return null;

    var worldMatrix = new runtime.THREE.Matrix4();

    // 从该骨骼向上遍历 bone chain，累积世界变换
    var chain = _getBoneChain(bone);
    worldMatrix.identity();
    for (var i = 0; i < chain.length; i++) {
      worldMatrix.multiply(chain[i].matrix);
    }

    // 应用 model 的世界矩阵
    if (runtime.model && runtime.model.matrixWorld) {
      worldMatrix = runtime.model.matrixWorld.clone().multiply(worldMatrix);
    }

    var pos = new runtime.THREE.Vector3();
    pos.setFromMatrixPosition(worldMatrix);

    return {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      _method: 'three_fk',
    };
  }

  function _findThreeBone(pmxBoneName, runtime) {
    // 先通过 boneMap 查找
    if (runtime.boneMap) {
      var mapped = runtime.boneMap[pmxBoneName];
      if (mapped) return mapped;

      // 尝试匹配 MPL 骨骼名
      var mplName = _pmxToMPL(pmxBoneName);
      mapped = runtime.boneMap[mplName];
      if (mapped) return mapped;
    }

    // 遍历 model skeleton
    if (runtime.model && runtime.model.skeleton && runtime.model.skeleton.bones) {
      var bones = runtime.model.skeleton.bones;
      for (var i = 0; i < bones.length; i++) {
        if (bones[i].name === pmxBoneName || bones[i].name === _pmxToMPL(pmxBoneName)) {
          return bones[i];
        }
      }
    }

    return null;
  }

  function _getBoneChain(leafBone) {
    var chain = [];
    var current = leafBone;
    while (current) {
      chain.unshift(current);
      current = current.parent;
    }
    return chain;
  }

  /**
   * 检测两个碰撞形状对是否穿透
   */
  function detectPenetration(shapeA, centerA, shapeB, centerB, minClearance) {
    if (!centerA || !centerB) return null;

    var dx = centerA.x - centerB.x;
    var dy = centerA.y - centerB.y;
    var dz = centerA.z - centerB.z;
    var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    var radiusA = shapeA.radius || 0.5;
    var radiusB = shapeB.radius || 0.5;

    var clearance = distance - radiusA - radiusB;
    if (clearance < minClearance) {
      return {
        penetration: minClearance - clearance,
        distance: distance,
        clearance: clearance,
        requiredClearance: minClearance,
      };
    }

    return null;
  }

  /**
   * 对候选关键帧执行碰撞检测
   */
  function checkKeyframeCollisions(keyframe, snapshot, profile) {
    var shapes = profile._collisionShapes;
    if (!shapes) {
      shapes = buildShapes(profile.rigidBodies || []);
      profile._collisionShapes = shapes;
    }

    var shapeMap = {};
    for (var i = 0; i < shapes.length; i++) {
      shapeMap[shapes[i].boneName] = shapes[i];
    }

    var penetrations = [];
    var pose = keyframe.pose || {};

    for (var j = 0; j < COLLISION_PAIRS.length; j++) {
      var pair = COLLISION_PAIRS[j];

      var aMoving = _hasPoseBone(pose, pair.a);
      var bMoving = _hasPoseBone(pose, pair.b);
      if (!aMoving && !bMoving) continue;

      var shapeA = shapeMap[pair.a];
      var shapeB = shapeMap[pair.b];
      if (!shapeA || !shapeB) continue;

      var centerA = getWorldCenter(pair.a, snapshot, pose);
      var centerB = getWorldCenter(pair.b, snapshot, pose);
      if (!centerA || !centerB) continue;

      var result = detectPenetration(shapeA, centerA, shapeB, centerB, pair.minClearance);
      if (result) {
        penetrations.push({
          pair: pair.name,
          a: pair.a,
          b: pair.b,
          penetration: result.penetration,
          distance: result.distance,
          clearance: result.clearance,
          requiredClearance: pair.minClearance,
          method: centerA._method || 'unknown',
        });
      }
    }

    return penetrations;
  }

  /**
   * 尝试修复穿透
   */
  function repairPenetration(penetration, pose) {
    var bone = _findPoseBone(pose, penetration.a);
    if (!bone) return { repaired: false };

    var extraSway = Math.min(15, penetration.penetration * 8);
    if (bone.sway) {
      for (var dir in bone.sway) {
        if (bone.sway.hasOwnProperty(dir)) {
          bone.sway[dir] += extraSway;
        }
      }
    } else {
      var side = penetration.a.indexOf('左') >= 0 ? 'right' : 'left';
      bone.sway = {};
      bone.sway[side] = extraSway;
    }

    return { repaired: true, extraSway: extraSway };
  }

  // ═══════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════

  function _computeRadius(rb) {
    if (rb.shape === 'sphere') return rb.size ? rb.size[0] || 0.5 : 0.5;
    if (rb.shape === 'capsule') return rb.size ? rb.size[0] || 0.3 : 0.3;
    if (rb.size && rb.size.length >= 3) {
      return Math.sqrt(rb.size[0]*rb.size[0] + rb.size[1]*rb.size[1] + rb.size[2]*rb.size[2]) * 0.5;
    }
    return 0.5;
  }

  function _computeHalfExtents(rb) {
    if (rb.shape === 'box' && rb.size && rb.size.length >= 3) {
      return [rb.size[0]/2, rb.size[1]/2, rb.size[2]/2];
    }
    return [0.3, 0.3, 0.3];
  }

  function _findBoneWorldPos(boneName, snapshot) {
    if (!snapshot || !snapshot.bones) return null;
    for (var i = 0; i < snapshot.bones.length; i++) {
      if (snapshot.bones[i].name === boneName) return snapshot.bones[i].worldPosition;
    }
    for (var j = 0; j < snapshot.bones.length; j++) {
      if (snapshot.bones[j].name.indexOf(boneName) >= 0 || boneName.indexOf(snapshot.bones[j].name) >= 0) {
        return snapshot.bones[j].worldPosition;
      }
    }
    return null;
  }

  function _getPoseDelta(boneName, pose) {
    var mplBone = _pmxToMPL(boneName);
    var p = pose[mplBone];
    if (!p) return { x: 0, y: 0, z: 0 };

    var delta = { x: 0, y: 0, z: 0 };

    if (p.move) {
      if (p.move.up) delta.y += p.move.up;
      if (p.move.down) delta.y -= p.move.down;
      if (p.move.forward) delta.z += p.move.forward;
      if (p.move.backward) delta.z -= p.move.backward;
      if (p.move.left) delta.x -= p.move.left;
      if (p.move.right) delta.x += p.move.right;
    }

    var scale = 0.04;
    if (p.bend) {
      if (p.bend.forward) delta.z += p.bend.forward * scale;
      if (p.bend.backward) delta.z -= p.bend.backward * scale;
    }
    if (p.sway) {
      if (p.sway.left) delta.x -= p.sway.left * scale;
      if (p.sway.right) delta.x += p.sway.right * scale;
    }

    return delta;
  }

  function _pmxToMPL(pmxName) {
    var map = {
      '右手首': 'wrist_r', '左手首': 'wrist_l',
      '右ひじ': 'elbow_r', '左ひじ': 'elbow_l',
      '右腕': 'arm_r', '左腕': 'arm_l',
      '右肩': 'shoulder_r', '左肩': 'shoulder_l',
      '上半身': 'upper_body', '上半身2': 'upper_body2',
      '頭': 'head', '首': 'neck',
      '右足': 'leg_r', '左足': 'leg_l',
      '右ひざ': 'knee_r', '左ひざ': 'knee_l',
      '右足首': 'ankle_r', '左足首': 'ankle_l',
      '右つま先': 'toe_ik_r', '左つま先': 'toe_ik_l',
      'センター': 'center',
    };
    return map[pmxName] || pmxName;
  }

  function _hasPoseBone(pose, pmxName) {
    var mpl = _pmxToMPL(pmxName);
    return !!(pose[mpl]);
  }

  function _findPoseBone(pose, pmxName) {
    var mpl = _pmxToMPL(pmxName);
    return pose[mpl] || null;
  }

  function _getMethod() {
    return _threeRuntime ? 'three_fk_available' : 'snapshot_approximate';
  }

  // ═══════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════

  window.CollisionShapes = {
    COLLISION_PAIRS: COLLISION_PAIRS,
    setRuntime: setRuntime,
    buildShapes: buildShapes,
    getWorldCenter: getWorldCenter,
    detectPenetration: detectPenetration,
    checkKeyframeCollisions: checkKeyframeCollisions,
    repairPenetration: repairPenetration,
    _getMethod: _getMethod,
  };
})();
