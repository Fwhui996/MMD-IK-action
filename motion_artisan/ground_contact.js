/**
 * Ground Contact — 地面检测与脚穿地验证
 *
 * §4.3.4. 地板平面检测（阶段碰撞体 → PMX 脚休息位置 → 包围盒底部 → y=0 fallback）
 *
 * @module GroundContact
 */
(function() {
  'use strict';

  var _floorPlane = null;
  var _floorSource = 'unknown';
  var _floorTolerance = 0.03;

  /**
   * 检测地板平面
   * 1. stage/floor 碰撞对象
   * 2. PMX 脚休息世界位置
   * 3. 模型包围盒底部
   * 4. fallback y=0
   *
   * @param {Object} snapshot - CurrentPoseSnapshot
   * @param {Object} profile - ModelCollisionProfile
   * @returns {number} 地板 Y 坐标
   */
  function getFloorY(snapshot, profile) {
    if (_floorPlane !== null) return _floorPlane;

    // ── 尝试 1: 从 snapshot 脚部世界位置推断 ──
    var footY = _detectFromFootWorldPositions(snapshot);
    if (footY !== null) {
      _floorPlane = footY;
      _floorSource = 'pmx_foot_rest';
      return _floorPlane;
    }

    // ── 尝试 2: 从 profile 包围盒底部 ──
    if (profile && profile.bbox && profile.bbox.min && profile.bbox.min.y !== undefined) {
      _floorPlane = profile.bbox.min.y;
      _floorSource = 'bbox_bottom';
      return _floorPlane;
    }

    // ── fallback ──
    _floorPlane = 0.0;
    _floorSource = 'fallback_y0';
    return _floorPlane;
  }

  /**
   * 手动设置地板平面
   */
  function setFloorY(y, source) {
    _floorPlane = y;
    _floorSource = source || 'manual';
  }

  /**
   * 重置地板检测（切换模型时调用）
   */
  function reset() {
    _floorPlane = null;
    _floorSource = 'unknown';
  }

  /**
   * 检测关键帧骨骼是否穿地
   *
   * @param {Object} pose - 关键帧 pose
   * @param {Object} snapshot - 当前姿态（用于获取当前脚 Y）
   * @param {Object} profile - ModelCalibrationProfile
   * @returns {Array} 穿透的骨骼列表 [{bone, currentY, floorY, penetration}]
   */
  function detectPenetrations(pose, snapshot, profile) {
    var floorY = getFloorY(snapshot, profile);
    var tolerance = _floorTolerance;
    if (profile && profile.clearance && profile.clearance.footFloorTolerance !== undefined) {
      tolerance = profile.clearance.footFloorTolerance;
    }

    var penetrations = [];

    // 检查 center move down 是否导致穿透
    var center = pose.center;
    if (center && center.move && center.move.down) {
      // 获取当前 center world Y
      var currentCenterY = _getCurrentCenterY(snapshot);
      if (currentCenterY !== null) {
        var newCenterY = currentCenterY - center.move.down;
        if (newCenterY < floorY - tolerance) {
          penetrations.push({
            bone: 'center',
            currentY: currentCenterY,
            floorY: floorY,
            newY: newCenterY,
            penetration: floorY - tolerance - newCenterY,
            note: 'center would penetrate floor by ' + (floorY - tolerance - newCenterY).toFixed(2),
          });
        }
      }
    }

    // 脚 IK 是否低于地板
    var ikFootBones = ['leg_ik_l', 'leg_ik_r', 'toe_ik_l', 'toe_ik_r'];
    for (var i = 0; i < ikFootBones.length; i++) {
      var footBone = ikFootBones[i];
      if (pose[footBone] && pose[footBone].move) {
        var footAction = pose[footBone].move;
        var footWorld = _getCurrentBoneWorldY(snapshot, footBone);
        if (footWorld !== null) {
          var newFootY = footWorld;
          if (footAction.down) newFootY -= footAction.down;
          if (footAction.up) newFootY += footAction.up;

          if (newFootY < floorY - tolerance) {
            penetrations.push({
              bone: footBone,
              currentY: footWorld,
              floorY: floorY,
              newY: newFootY,
              penetration: floorY - tolerance - newFootY,
              note: footBone + ' would penetrate floor',
            });
          }
        }
      }
    }

    return penetrations;
  }

  /**
   * 修复穿地：调整 center 和 foot IK height
   */
  function repairPenetrations(pose, snapshot, profile) {
    var penetrations = detectPenetrations(pose, snapshot, profile);
    if (penetrations.length === 0) return { repaired: false, changes: [] };

    var changes = [];
    var floorY = getFloorY(snapshot, profile);

    for (var i = 0; i < penetrations.length; i++) {
      var p = penetrations[i];
      if (p.bone === 'center' && pose.center && pose.center.move) {
        var oldDown = pose.center.move.down;
        var maxDown = Math.max(0, (p.currentY - floorY - _floorTolerance));
        pose.center.move.down = Math.min(oldDown, maxDown);
        changes.push({
          bone: 'center',
          action: 'move',
          direction: 'down',
          old: oldDown,
          new: pose.center.move.down,
        });
      }
    }

    return { repaired: changes.length > 0, changes: changes };
  }

  // ═══════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════

  function _detectFromFootWorldPositions(snapshot) {
    if (!snapshot || !snapshot.bones) return null;
    var footBones = ['左足ＩＫ', '右足ＩＫ', '左足', '右足', 'leg_ik_l', 'leg_ik_r'];
    var yValues = [];

    for (var i = 0; i < snapshot.bones.length; i++) {
      var b = snapshot.bones[i];
      var name = b.name || '';
      if (footBones.indexOf(name) >= 0 && b.worldPosition) {
        yValues.push(b.worldPosition[1]);
      }
    }

    if (yValues.length === 0) return null;
    // 取最小值（最低的脚）
    return Math.min.apply(null, yValues);
  }

  function _getCurrentCenterY(snapshot) {
    if (!snapshot || !snapshot.bones) return null;
    for (var i = 0; i < snapshot.bones.length; i++) {
      var b = snapshot.bones[i];
      if (b.name === 'センター' || b.name === 'center') {
        return b.worldPosition ? b.worldPosition[1] : null;
      }
      if (b.index === 0 || b.parentIndex === -1) {
        return b.worldPosition ? b.worldPosition[1] : null;
      }
    }
    return null;
  }

  function _getCurrentBoneWorldY(snapshot, boneName) {
    if (!snapshot || !snapshot.bones) return null;
    for (var i = 0; i < snapshot.bones.length; i++) {
      var b = snapshot.bones[i];
      if (b.name === boneName && b.worldPosition) {
        return b.worldPosition[1];
      }
    }
    return null;
  }

  window.GroundContact = {
    getFloorY: getFloorY,
    setFloorY: setFloorY,
    reset: reset,
    detectPenetrations: detectPenetrations,
    repairPenetrations: repairPenetrations,
  };
})();
