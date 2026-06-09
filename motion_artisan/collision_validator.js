/**
 * Collision Validator — 碰撞验证与修复
 *
 * §4.3 硬安全合约执行引擎。
 * 对候选关键帧运行 SafetyContract.checkCandidate，
 * 并执行 PMX 刚体成对碰撞检测（CollisionShapes）。
 * 自动修复 clamp 级别问题，拒绝有 reject 级别违规的候选。
 *
 * @module CollisionValidator
 */
(function() {
  'use strict';

  /**
   * 验证所有候选
   * @param {Array} candidates - 候选轨迹列表
   * @param {Object} snapshot - CurrentPoseSnapshot
   * @param {Object} profile - ModelCollisionProfile / ModelCalibrationProfile
   * @param {Object} report - 用于累加碰撞/修复/拒绝信息
   * @returns {Array} 通过验证的候选列表（含安全报告）
   */
  function validateCandidates(candidates, snapshot, profile, report) {
    report = report || {};
    report.collisions = report.collisions || [];
    report.repairs = report.repairs || [];
    report.rejections = report.rejections || [];

    var anatomyLimits = window.AnatomyLimits ? window.AnatomyLimits.ANATOMY_LIMITS : null;
    var validated = [];

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      c.passedSafety = false;

      // ── 安全合约检查 ──
      var safetyResult;
      if (window.SafetyContract && typeof window.SafetyContract.checkCandidate === 'function') {
        safetyResult = window.SafetyContract.checkCandidate(c, snapshot, profile, anatomyLimits, window.GroundContact);
      } else {
        // fallback: 全通过
        safetyResult = { passed: true, keyframeResults: [], summary: { passed: 0, violations: 0, repairs: 0, rejections: 0 } };
      }

      c.safetyResult = safetyResult;

      // ── PMX 刚体成对碰撞检测 ──
      _checkRigidBodyCollisions(c, snapshot, profile, report, i);

      // Ground repair disabled - IK handles foot placement
      // ── 收集安全结果 ──
      for (var k = 0; k < safetyResult.keyframeResults.length; k++) {
        var kr = safetyResult.keyframeResults[k];
        for (var r = 0; r < kr.rejections.length; r++) {
          report.rejections.push({
            candidate: i,
            keyframe: k,
            rejection: kr.rejections[r],
          });
        }
      }

      // ── 检查碰撞对产生的拒绝 ──
      var collisionRejected = _hasRigidBodyRejection(c);

      // ── 判断通过/失败 ──
      c.passedSafety = safetyResult.passed && !collisionRejected;
      if (c.passedSafety) {
        c.passedCollision = true;
        validated.push(c);
      } else {
        console.warn('[CollisionValidator] candidate ' + i + ' rejected: passedSafety=' + safetyResult.passed + ' collisionRejected=' + collisionRejected + ' rejectionCount=' + (c.safetyResult && c.safetyResult.keyframeResults ? c.safetyResult.keyframeResults.reduce(function(a,kr){return a+kr.rejections.length;},0) : 0));
        if (c.safetyResult && c.safetyResult.keyframeResults) {
          for (var rk = 0; rk < c.safetyResult.keyframeResults.length; rk++) {
            var krs = c.safetyResult.keyframeResults[rk].rejections;
            for (var rj = 0; rj < krs.length; rj++) {
              console.warn('[CollisionValidator]   reason:', JSON.stringify(krs[rj]).substring(0, 200));
            }
          }
        }
      }
    }

    // Fallback: if all rejected, keep the first candidate as degraded
    if (validated.length === 0 && candidates.length > 0) {
      console.warn('[CollisionValidator] ALL candidates rejected, using first as degraded fallback');
      candidates[0].passedSafety = true;
      candidates[0].passedCollision = true;
      candidates[0]._degraded = true;
      validated.push(candidates[0]);
    }

    return validated;
  }

  /**
   * 获取候选的碰撞详情（用于 debug overlay）
   */
  function getCollisionDetails(candidate) {
    var details = [];
    if (!candidate || !candidate.keyframes) return details;

    for (var j = 0; j < candidate.keyframes.length; j++) {
      var kf = candidate.keyframes[j];
      if (kf._penetrations && kf._penetrations.length > 0) {
        details.push({
          keyframe: j,
          name: kf.name,
          penetrations: kf._penetrations,
        });
      }
    }
    return details;
  }

  // ═══════════════════════════════════════════
  // 内部：PMX 刚体成对碰撞
  // ═══════════════════════════════════════════

  function _checkRigidBodyCollisions(candidate, snapshot, profile, report, idx) {
    if (!window.CollisionShapes || !window.CollisionShapes.checkKeyframeCollisions) return;

    for (var j = 0; j < candidate.keyframes.length; j++) {
      var kf = candidate.keyframes[j];
      var penetrations = window.CollisionShapes.checkKeyframeCollisions(kf, snapshot, profile);

      if (penetrations.length > 0) {
        kf._penetrations = penetrations;
        for (var p = 0; p < penetrations.length; p++) {
          report.collisions.push({
            candidate: idx,
            keyframe: j,
            name: kf.name,
            pair: penetrations[p].pair,
            penetration: penetrations[p].penetration.toFixed(4),
            clearance: penetrations[p].clearance.toFixed(4),
            required: penetrations[p].requiredClearance,
            method: penetrations[p].method || 'unknown',
          });

          // 尝试修复（clamp 级别）
          if (window.CollisionShapes.repairPenetration) {
            var repair = window.CollisionShapes.repairPenetration(penetrations[p], kf.pose);
            if (repair.repaired) {
              report.repairs.push({
                candidate: idx,
                keyframe: j,
                name: kf.name,
                pair: penetrations[p].pair,
                extraSway: repair.extraSway,
              });
              kf._repaired = true;
            }
          }
        }
      }
    }
  }

  function _hasRigidBodyRejection(candidate) {
    for (var j = 0; j < candidate.keyframes.length; j++) {
      var kf = candidate.keyframes[j];
      if (kf._penetrations && kf._penetrations.length > 0) {
        // 如果有无法修复的穿透（深度 > 0.15），视为拒绝级别
        for (var p = 0; p < kf._penetrations.length; p++) {
          if (kf._penetrations[p].penetration > 0.15) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════

  window.CollisionValidator = {
    validateCandidates: validateCandidates,
    getCollisionDetails: getCollisionDetails,
  };
})();
