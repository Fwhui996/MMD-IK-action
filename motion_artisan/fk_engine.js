/**
 * FK Engine — Minimal forward kinematics solver for collision prediction.
 *
 * Takes skeleton data + rest quaternions + MPL pose commands,
 * computes world-space bone positions by chaining the bone hierarchy.
 *
 * MMD coordinate system: Y-up, X-right, Z-forward.
 * MPL Euler order: turn(Y) → bend(X) → sway(Z)  (YXZ intrinsic).
 *
 * Key: uses PARENT bone's world quaternion to rotate each bone's localPosition.
 *
 * @module FKEngine
 */
(function() {
  'use strict';

  var PMX_TO_MPL = {
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
    '右腕捩': 'arm_r', '左腕捩': 'arm_l',
    '右手捩': 'wrist_r', '左手捩': 'wrist_l',
    '下半身': 'lower_body',
  };

  function pmxToMpl(pmxName) {
    if (PMX_TO_MPL[pmxName]) return PMX_TO_MPL[pmxName];
    for (var key in PMX_TO_MPL) { if (pmxName.indexOf(key) >= 0) return PMX_TO_MPL[key]; }
    return pmxName;
  }

  /**
   * Compute world-space position of a PMX bone given an MPL pose.
   *
   * @param {string} pmxBoneName — e.g., '右手首', '上半身', '頭'
   * @param {Object} skeleton — { bones: [{name, parentIndex, localPosition, restQuaternion}] }
   *    (null to use stored _skeleton)
   * @param {Object} pose — MPL pose { "wrist_r": { bend: { forward: 50 } }, ... }
   * @param {Object} snapshot — CurrentPoseSnapshot (used to find root world position)
   * @returns {Object|null} { x, y, z, _method: 'fk_engine' }
   */
  function computeWorldPosition(pmxBoneName, skeleton, pose, snapshot) {
    skeleton = skeleton || window.FKEngine._skeleton;
    if (!skeleton || !skeleton.bones) return null;

    var bones = skeleton.bones;
    var nameToIdx = {};
    for (var i = 0; i < bones.length; i++) nameToIdx[bones[i].name] = i;

    var targetIdx = nameToIdx[pmxBoneName];
    if (targetIdx === undefined) {
      for (var k = 0; k < bones.length; k++) {
        if (bones[k].name.indexOf(pmxBoneName) >= 0 || pmxBoneName.indexOf(bones[k].name) >= 0) {
          targetIdx = k; break;
        }
      }
    }
    if (targetIdx === undefined) return null;

    var chain = [], cur = targetIdx;
    while (cur >= 0 && chain.length < 100) { chain.unshift(cur); cur = bones[cur].parentIndex; }

    // Find root world position from snapshot
    var wp = { x: 0, y: 0, z: 0 };
    if (snapshot && snapshot.bones) {
      for (var si = 0; si < snapshot.bones.length; si++) {
        if (snapshot.bones[si].name === bones[0].name && snapshot.bones[si].worldPosition) {
          wp = { x: snapshot.bones[si].worldPosition[0], y: snapshot.bones[si].worldPosition[1], z: snapshot.bones[si].worldPosition[2] };
          break;
        }
      }
    }

    var wq = { x: 0, y: 0, z: 0, w: 1 };

    for (var ci = 0; ci < chain.length; ci++) {
      var bone = bones[chain[ci]];

      // Rest quaternion
      var restQ = { x: 0, y: 0, z: 0, w: 1 };
      if (bone.restQuaternion && bone.restQuaternion.length === 4)
        restQ = { x: bone.restQuaternion[0], y: bone.restQuaternion[1], z: bone.restQuaternion[2], w: bone.restQuaternion[3] };
      else if (skeleton._restQuatMap && skeleton._restQuatMap[bone.name])
        restQ = skeleton._restQuatMap[bone.name];
      else if (bone.localQuaternion && bone.localQuaternion.length === 4)
        restQ = { x: bone.localQuaternion[0], y: bone.localQuaternion[1], z: bone.localQuaternion[2], w: bone.localQuaternion[3] };

      // MPL pose delta (Euler angles in degrees)
      var mplName = pmxToMpl(bone.name);
      var bp = pose[mplName];
      var bend = 0, sway = 0, turn = 0;
      if (bp) {
        if (bp.bend) { if (bp.bend.forward) bend += bp.bend.forward; if (bp.bend.backward) bend -= bp.bend.backward; }
        if (bp.sway) { if (bp.sway.left) sway -= bp.sway.left; if (bp.sway.right) sway += bp.sway.right; }
        if (bp.turn) { if (bp.turn.left) turn -= bp.turn.left; if (bp.turn.right) turn += bp.turn.right; }
      }

      // SAVE parent world quat BEFORE updating
      var parentWQ = { x: wq.x, y: wq.y, z: wq.z, w: wq.w };

      var dq = _eulerToQuatYXZ(_degToRad(bend), _degToRad(turn), _degToRad(sway));
      var lq = _quatNormalize(quatMul(dq, restQ));
      wq = _quatNormalize(quatMul(wq, lq));

      var lp = bone.localPosition || [0, 0, 0];
      var ro = _rotateVec3(lp[0], lp[1], lp[2], parentWQ);
      wp = { x: wp.x + ro.x, y: wp.y + ro.y, z: wp.z + ro.z };
    }

    return { x: wp.x, y: wp.y, z: wp.z, _method: 'fk_engine' };
  }

  // ── Math ──
  function _degToRad(d) { return d * Math.PI / 180; }
  function _radToDeg(r) { return r * 180 / Math.PI; }

  function _eulerToQuatYXZ(bendRad, turnRad, swayRad) {
    var cx = Math.cos(bendRad * 0.5), sx = Math.sin(bendRad * 0.5);
    var cy = Math.cos(turnRad * 0.5), sy = Math.sin(turnRad * 0.5);
    var cz = Math.cos(swayRad * 0.5), sz = Math.sin(swayRad * 0.5);
    return {
      x: sx * cy * cz + cx * sy * sz,
      y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz + sx * sy * cz,
      w: cx * cy * cz - sx * sy * sz,
    };
  }

  function quatMul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  function _quatNormalize(q) {
    var len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    return len < 1e-10 ? { x: 0, y: 0, z: 0, w: 1 } : { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  }

  function _rotateVec3(x, y, z, q) {
    var qv = { x: x, y: y, z: z, w: 0 };
    var qInv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    var r = quatMul(quatMul(q, qv), qInv);
    return { x: r.x, y: r.y, z: r.z };
  }

  // ── Export ──
  console.log('[FKEngine] loaded successfully');
  window.FKEngine = {
    computeWorldPosition: computeWorldPosition,
    pmxToMpl: pmxToMpl,
  };
})();
