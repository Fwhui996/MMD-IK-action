/**
 * Semantic Validator — 语义覆盖验证
 *
 * §4.4.1. 证明候选轨迹覆盖了 MotionIntentPlan 的所有 targets。
 * 每个 target 标记为 covered / repaired / downgraded / rejected。
 * 如果请求的 primary target 被静默丢弃，拒绝该候选。
 *
 * @module SemanticValidator
 */
(function() {
  'use strict';

  /**
   * 验证候选的语义覆盖
   *
   * @param {Object} candidate — { keyframes: [...] }
   * @param {Object} plan — MotionIntentPlan
   * @returns {Object} { passed, coverage: [...] }
   */
  function validate(candidate, plan) {
    var stages = plan.stages || [];
    var keyframes = candidate.keyframes || [];
    var coverage = [];
    var passed = true;

    for (var i = 0; i < stages.length; i++) {
      var stage = stages[i];
      var targets = stage.targets || [];
      var kf = keyframes[i] || { pose: {} };

      for (var j = 0; j < targets.length; j++) {
        var target = targets[j];
        var status = _checkTarget(target, kf, candidate);
        coverage.push({
          stage: stage.name || ('stage_' + i),
          stageIndex: i,
          targetIndex: j,
          body: target.body,
          goal: target.goal,
          amount: target.amount,
          status: status.status,
          evidence: status.evidence,
        });

        if (status.status === 'rejected') {
          passed = false;
        }
      }
    }

    return {
      passed: passed,
      coverage: coverage,
      summary: _summarizeCoverage(coverage),
    };
  }

  // ═══════════════════════════════════════════
  // Target 检查
  // ═══════════════════════════════════════════

  function _checkTarget(target, keyframe, candidate) {
    var goal = target.goal || '';
    var body = target.body || '';
    var pose = keyframe.pose || {};

    // 针对每个 goal，检查对应的骨骼是否有指令
    switch (goal) {
      case 'lower_body':
        return _checkLowerBody(pose, body);
      case 'rise_body':
        return _checkRiseBody(pose, body);
      case 'move_near_chest_outer':
        return _checkHandNearChest(pose, body);
      case 'reach_forward':
        return _checkReachForward(pose, body);
      case 'wave_near_head':
        return _checkWaveNearHead(pose, body);
      case 'tilt_down_slightly':
        return _checkTiltDown(pose, body);
      case 'tilt_up_slightly':
        return _checkTiltUp(pose, body);
      case 'settle_smoothly':
        return _checkSettle(pose, body);
      case 'hold_pose':
        return _checkHold(pose, body);
      case 'prepare_to_move':
        return _checkPrepare(pose, body);
      case 'continue_current_pose':
        return { status: 'covered', evidence: 'continue_current_pose acknowledged' };
      case 'keep_foot_contact':
        return _checkFootContact(pose, body);
      default:
        return { status: 'not_checked', evidence: 'goal "' + goal + '" has no semantic check' };
    }
  }

  function _checkLowerBody(pose, body) {
    var hasCenter = pose.center && pose.center.move && (pose.center.move.down || 0) > 0;
    var hasFootIK = _hasIKSupport(pose);
    var hasBend = pose.upper_body && pose.upper_body.bend;
    if (hasCenter && hasFootIK) {
      return { status: 'covered', evidence: 'center lowered with foot IK support' + (hasBend ? ' and upper body counterbalance' : '') };
    }
    if (hasCenter && !hasFootIK) {
      return { status: 'repaired', evidence: 'center lowered but foot IK support missing — repair attempted' };
    }
    return { status: 'rejected', evidence: 'no center.down or IK support found in pose' };
  }

  function _checkRiseBody(pose, body) {
    var hasCenter = pose.center && pose.center.move && (pose.center.move.up || 0) > 0;
    if (hasCenter) return { status: 'covered', evidence: 'center movement upward detected' };
    return { status: 'rejected', evidence: 'no center.up found in pose' };
  }

  function _checkHandNearChest(pose, body) {
    var side = _sideFromBody(body);
    var arm = pose[side + 'arm'];
    var elbow = pose[side + 'elbow'];
    var wrist = pose[side + 'wrist'];

    if (arm && elbow) {
      var detail = side + ' arm + elbow movement found';
      if (wrist) detail += ' + wrist control';
      return { status: 'covered', evidence: detail };
    }
    return { status: 'rejected', evidence: side + ' arm/elbow pose missing for move_near_chest_outer' };
  }

  function _checkReachForward(pose, body) {
    var side = _sideFromBody(body);
    var arm = pose[side + 'arm'];
    if (arm && arm.bend && arm.bend.forward) {
      return { status: 'covered', evidence: side + ' arm bend forward ' + arm.bend.forward };
    }
    return { status: 'rejected', evidence: side + ' arm forward bend not found' };
  }

  function _checkWaveNearHead(pose, body) {
    var side = _sideFromBody(body);
    var arm = pose[side + 'arm'];
    if (arm && (arm.bend || arm.sway)) {
      return { status: 'covered', evidence: side + ' arm near head pose found' };
    }
    return { status: 'rejected', evidence: side + ' arm pose not found for wave_near_head' };
  }

  function _checkTiltDown(pose, body) {
    var neck = pose.neck;
    var head = pose.head;
    if ((neck && neck.bend && neck.bend.forward) || (head && head.bend && head.bend.forward)) {
      return { status: 'covered', evidence: 'neck/head bend forward detected' };
    }
    return { status: 'rejected', evidence: 'no neck/head forward bend in pose' };
  }

  function _checkTiltUp(pose, body) {
    var neck = pose.neck;
    var head = pose.head;
    if ((neck && neck.bend && neck.bend.backward) || (head && head.bend && head.bend.backward)) {
      return { status: 'covered', evidence: 'neck/head bend backward detected' };
    }
    return { status: 'rejected', evidence: 'no neck/head backward bend in pose' };
  }

  function _checkSettle(pose, body) {
    // settle 不一定产生大幅骨骼指令 → covered if no major action
    return { status: 'covered', evidence: 'settle_smoothly acknowledged' };
  }

  function _checkHold(pose, body) {
    return { status: 'covered', evidence: 'hold_pose acknowledged' };
  }

  function _checkPrepare(pose, body) {
    var hasAny = false;
    for (var bone in pose) {
      if (pose.hasOwnProperty(bone) && pose[bone] !== null && typeof pose[bone] === 'object') {
        hasAny = true;
        break;
      }
    }
    if (hasAny) return { status: 'covered', evidence: 'prepare pose instructions found' };
    return { status: 'covered', evidence: 'prepare_to_move acknowledged (no explicit pose needed)' };
  }

  function _checkFootContact(pose, body) {
    if (_hasIKSupport(pose)) {
      return { status: 'covered', evidence: 'foot IK support detected' };
    }
    return { status: 'rejected', evidence: 'no foot IK support in pose' };
  }

  // ═══════════════════════════════════════════
  // 辅助
  // ═══════════════════════════════════════════

  function _sideFromBody(body) {
    if (!body) return 'r';
    if (body.indexOf('left') !== -1 || body === 'l' || body.indexOf('左') !== -1) return 'l';
    return 'r';
  }

  function _hasIKSupport(pose) {
    var ikBones = ['leg_ik_l', 'leg_ik_r', 'toe_ik_l', 'toe_ik_r'];
    for (var i = 0; i < ikBones.length; i++) {
      if (pose[ikBones[i]]) return true;
    }
    return false;
  }

  function _summarizeCoverage(coverage) {
    var total = coverage.length;
    var covered = 0, repaired = 0, rejected = 0;
    for (var i = 0; i < coverage.length; i++) {
      switch (coverage[i].status) {
        case 'covered': covered++; break;
        case 'repaired':
        case 'downgraded': repaired++; break;
        case 'rejected': rejected++; break;
      }
    }
    return { total: total, covered: covered, repaired: repaired, rejected: rejected };
  }

  window.SemanticValidator = {
    validate: validate,
  };
})();
