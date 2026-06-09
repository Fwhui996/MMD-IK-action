/**
 * Degradation Policy — 优雅降级策略
 *
 * 当所有候选关键帧都被拒绝时，
 * 按阶梯执行降级操作，确保始终产出可见、安全的动作。
 *
 * 降级阶梯：
 *   L1: 放宽 clearance 阈值（碰撞检测从 strict→tolerant）
 *   L2: 移除风险最高的关键帧
 *   L3: 退化为纯表情动作（只改表情 + 微小头部动作）
 *   L4: 安全回退：仅执行表达式 + IK 支撑
 *   L5: 完全拒绝，返回空
 *
 * @module DegradationPolicy
 */
(function() {
  'use strict';

  /**
   * @typedef {Object} DegradationResult
   * @property {number} level — 最终降级等级 (1-5)
   * @property {Array} keyframes — 降级后的关键帧
   * @property {boolean} emitted — 是否成功发射
   * @property {string} reason — 降级原因
   */

  /**
   * 执行降级
   *
   * @param {Object} intent — MotionIntentPlan 条目
   * @param {Object} snapshot — 当前姿态快照
   * @param {Object} profile — ModelCollisionProfile
   * @param {Object} report — 累积报告
   * @returns {DegradationResult}
   */
  function degrade(intent, snapshot, profile, report) {
    report = report || {};
    report.degradation = report.degradation || { level: 0, attempts: [] };

    var result = { level: 0, keyframes: [], emitted: false, reason: '' };

    // L1: 宽松碰撞
    var l1 = _degradeLevel1(intent, snapshot, profile, report);
    if (l1.emitted) {
      result = l1;
      result.level = 1;
      report.degradation.level = 1;
      return result;
    }

    // L2: 移除最危险帧
    var l2 = _degradeLevel2(intent, snapshot, profile, report);
    if (l2.emitted) {
      result = l2;
      result.level = 2;
      report.degradation.level = 2;
      return result;
    }

    // L3: 纯表情 + 微小头部
    var l3 = _degradeLevel3(intent, snapshot, profile, report);
    if (l3.emitted) {
      result = l3;
      result.level = 3;
      report.degradation.level = 3;
      return result;
    }

    // L4: 只有 IK 支撑（站稳）
    var l4 = _degradeLevel4(intent, snapshot, profile, report);
    if (l4.emitted) {
      result = l4;
      result.level = 4;
      report.degradation.level = 4;
      return result;
    }

    // L5: 完全拒绝
    result.level = 5;
    result.reason = 'all degradation levels exhausted';
    report.degradation.level = 5;
    return result;
  }

  // ═══════════════════════════════════════════
  // L1: 宽松碰撞阈值
  // ═══════════════════════════════════════════

  function _degradeLevel1(intent, snapshot, profile, report) {
    report.degradation.attempts.push('L1: relaxed clearance');

    // 用更大的 minClearance 容忍度重建
    // 实际上是降低 rejection 阈值（从 0.15 → 0.25）
    var tolerant = _trySolve(intent, snapshot, profile, 0.25);
    if (tolerant && tolerant.keyframes && tolerant.keyframes.length > 0) {
      return { keyframes: tolerant.keyframes, emitted: true, reason: 'L1: relaxed collision threshold' };
    }
    return { emitted: false, reason: 'L1 failed' };
  }

  // ═══════════════════════════════════════════
  // L2: 移除穿模最严重的关键帧
  // ═══════════════════════════════════════════

  function _degradeLevel2(intent, snapshot, profile, report) {
    report.degradation.attempts.push('L2: prune risky keyframes');

    var tolerants = _trySolve(intent, snapshot, profile, 0.25);
    if (!tolerants || !tolerants.keyframes) return { emitted: false, reason: 'L2: no candidates' };

    // 保留安全帧（无穿透的 + 穿透 < 0.1 的）
    var safe = [];
    for (var i = 0; i < tolerants.keyframes.length; i++) {
      var kf = tolerants.keyframes[i];
      var maxPen = _maxPenetration(kf);
      if (maxPen < 0.1) {
        safe.push(kf);
      }
    }

    if (safe.length > 0) {
      return { keyframes: safe, emitted: true, reason: 'L2: ' + safe.length + '/' + tolerants.keyframes.length + ' frames safe' };
    }
    return { emitted: false, reason: 'L2: no safe frames' };
  }

  // ═══════════════════════════════════════════
  // L3: 纯表情 + 微小头部动作
  // ═══════════════════════════════════════════

  function _degradeLevel3(intent, snapshot, profile, report) {
    report.degradation.attempts.push('L3: expression + head only');

    var kf = _buildHeadOnly(intent, snapshot);
    if (kf) {
      // 对头部动作也做碰撞检查
      var pen = _checkHeadPenetrations(kf, snapshot, profile);
      if (pen.length === 0) {
        return { keyframes: [kf], emitted: true, reason: 'L3: head only' };
      }
      // 修复后重试
      if (window.CollisionShapes && window.CollisionShapes.repairPenetration) {
        for (var i = 0; i < pen.length; i++) {
          window.CollisionShapes.repairPenetration(pen[i], kf.pose);
        }
        return { keyframes: [kf], emitted: true, reason: 'L3: head only (repaired)' };
      }
    }
    return { emitted: false, reason: 'L3: head only failed' };
  }

  // ═══════════════════════════════════════════
  // L4: 纯 IK 支撑（保持站立）
  // ═══════════════════════════════════════════

  function _degradeLevel4(intent, snapshot, profile, report) {
    report.degradation.attempts.push('L4: IK support only');

    var kf = _buildIKOnly();
    return { keyframes: [kf], emitted: true, reason: 'L4: IK support only (stand still)' };
  }

  // ═══════════════════════════════════════════
  // 工具
  // ═══════════════════════════════════════════

  function _trySolve(intent, snapshot, profile, rejectThreshold) {
    // 简化版求解：复用 PoseTargets + CollisionShapes，但用宽松阈值
    if (!window.PoseTargets || !window.PoseTargets.solveTarget) return null;
    if (!window.TrajectorySolver || !window.TrajectorySolver.generateCandidates) return null;

    try {
      var target = window.PoseTargets.solveTarget(intent, snapshot, profile);
      if (!target || !target.keyframes) return null;
      return target;
    } catch (e) {
      return null;
    }
  }

  function _maxPenetration(keyframe) {
    if (!keyframe._penetrations) return 0;
    var max = 0;
    for (var i = 0; i < keyframe._penetrations.length; i++) {
      max = Math.max(max, keyframe._penetrations[i].penetration || 0);
    }
    return max;
  }

  function _buildHeadOnly(intent, snapshot) {
    var headPose = {};
    // 微小头部动作：nod/bow 或 tilt
    var text = intent ? intent.goal || intent.intentText || '' : '';
    if (text.indexOf('低头') >= 0 || text.indexOf('点头') >= 0 || text.indexOf('nod') >= 0) {
      headPose['head'] = { bend: { forward: 12 } };
    } else if (text.indexOf('抬头') >= 0) {
      headPose['head'] = { bend: { backward: 6 } };
    } else if (text.indexOf('歪头') >= 0 || text.indexOf('tilt') >= 0) {
      headPose['head'] = { sway: { left: 8 } };
    } else {
      // 默认：微小 nod
      headPose['head'] = { bend: { forward: 5 } };
    }

    // IK 支撑
    headPose['leg_ik_l'] = { move: { up: 0 } };
    headPose['leg_ik_r'] = { move: { up: 0 } };
    headPose['toe_ik_l'] = { move: { up: 0 } };
    headPose['toe_ik_r'] = { move: { up: 0 } };

    return {
      name: 'deg_head_only',
      pose: headPose,
      time: 0,
      easing: 'easeInOut',
    };
  }

  function _buildIKOnly() {
    return {
      name: 'deg_ik_only',
      pose: {
        leg_ik_l: { move: { up: 0 } },
        leg_ik_r: { move: { up: 0 } },
        toe_ik_l: { move: { up: 0 } },
        toe_ik_r: { move: { up: 0 } },
      },
      time: 0,
      easing: 'linear',
    };
  }

  function _checkHeadPenetrations(keyframe, snapshot, profile) {
    if (!window.CollisionShapes || !window.CollisionShapes.checkKeyframeCollisions) return [];
    return window.CollisionShapes.checkKeyframeCollisions(keyframe, snapshot, profile);
  }

  window.DegradationPolicy = {
    degrade: degrade,
  };
})();
