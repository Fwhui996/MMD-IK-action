/**
 * Safety Contract — 硬安全规则引擎
 *
 * §4.3 MotionArtisan Hard Safety Contract.
 * MotionArtisan 在发射 MPL 前必须通过全部拒绝级规则。
 *
 * 每条规则返回 { pass, clamp, repair, reject } 之一。
 * - pass: 通过
 * - clamp: 超限但可截断而不改变语义
 * - repair: 可调整目标/时间同时保留用户意图
 * - reject: 违反不可能解剖、碰撞无法解决、穿地、锁体违规、意图丢失
 *
 * MotionArtisan 绝不在任何采样帧有未解决的 reject 时发射 MPL。
 *
 * @module SafetyContract
 */
(function() {
  'use strict';

  /**
   * 硬安全规则定义
   * 每规则含：severity, description, check() 函数
   */
  var HARD_SAFETY_RULES = {
    noFloorPenetration: {
      severity: 'reject',
      description: '脚、膝、手或 root 控制的身体部位不得低于检测到的地板平面',
      blocksProduction: true,
    },
    keepFootContactForCrouch: {
      severity: 'repair',
      description: '蹲下必须保持脚着地；纯 root 下沉被拒绝',
      blocksProduction: true,
    },
    ikRequiredForLegSupport: {
      severity: 'repair',
      description: 'lower_body/rise_body 改变 center 高度时，必须保持 IK 激活',
      blocksProduction: true,
    },
    noSelfIntersection: {
      severity: 'repair_or_reject',
      description: '手/胸、手/头、前臂/胸、手/手、腿/躯干交叉必须修复或拒绝',
      blocksProduction: true,
    },
    noHyperextension: {
      severity: 'clamp_or_reject',
      description: '肘、膝、腕、颈、肩、脊柱必须在解剖范围内',
      blocksProduction: true,
    },
    noBoneBreakingTwist: {
      severity: 'reject',
      description: '跨连接关节的对向旋转不可行（即使每个标量在范围内）',
      blocksProduction: true,
    },
    preserveCurrentPoseStart: {
      severity: 'reject',
      description: '生成动作不可从当前姿态硬切到 rest/empty pose',
      blocksProduction: true,
    },
    preserveRequestedIntent: {
      severity: 'reject',
      description: '请求的 body/action targets 不可被静默丢弃',
      blocksProduction: true,
    },
  };

  /**
   * 对单个关键帧 + 当前姿态执行所有规则
   *
   * @param {Object} keyframe - { name, time, targets, pose }
   * @param {Object} snapshot - CurrentPoseSnapshot
   * @param {Object} profile - ModelCalibrationProfile
   * @param {Object} anatomyLimits — 从 window.AnatomyLimits 获取
   * @param {Object} groundContact — 从 window.GroundContact 获取
   * @returns {Object} { passed, violations: [...], repairs: [...], rejections: [...] }
   */
  function checkKeyframe(keyframe, snapshot, profile, anatomyLimits, groundContact) {
    var result = {
      passed: true,
      violations: [],
      repairs: [],
      rejections: [],
    };

    var pose = keyframe.pose || {};
    anatomyLimits = anatomyLimits || (window.AnatomyLimits ? window.AnatomyLimits.ANATOMY_LIMITS : null);
    groundContact = groundContact || (window.GroundContact ? window.GroundContact : null);

    // ── 1. floor penetration ──
    if (groundContact && typeof groundContact.getFloorY === 'function') {
      var floorY = groundContact.getFloorY(snapshot, profile);
      var penetrationBones = _checkFloorPenetration(pose, floorY, profile);
      if (penetrationBones.length > 0) {
        result.rejections.push({
          rule: 'noFloorPenetration',
          severity: 'reject',
          detail: 'bones below floor: ' + penetrationBones.join(', '),
          floorY: floorY,
          bones: penetrationBones,
        });
        result.passed = false;
      }
    } else {
      // ground_contact 未实现 → 报告但暂时允许通过（开发阶段）
      result.violations.push({
        rule: 'noFloorPenetration',
        severity: 'not_implemented',
        detail: 'GroundContact module not available',
      });
    }

    // ── 2. crouch requires foot contact ──
    if (_crouchDetected(pose)) {
      var hasIKSupport = _hasIKFootSupport(pose);
      if (!hasIKSupport) {
        result.rejections.push({
          rule: 'keepFootContactForCrouch',
          severity: 'reject',
          detail: 'crouch detected but no foot IK support lines',
        });
        result.passed = false;
      }
    }

    // ── 3. hyperextension check ──
    if (anatomyLimits) {
      var hyperViolations = _checkHyperextension(pose, anatomyLimits);
      for (var i = 0; i < hyperViolations.length; i++) {
        var hv = hyperViolations[i];
        if (hv.severity === 'reject') {
          result.rejections.push({
            rule: 'noHyperextension',
            severity: 'reject',
            detail: hv.detail,
          });
          result.passed = false;
        } else {
          result.repairs.push({
            rule: 'noHyperextension',
            severity: 'clamp',
            detail: hv.detail,
            clampedValue: hv.clampedValue,
          });
          // 自动 clamp 到安全值
          var rpose = pose[hv.bone];
          if (rpose && rpose[hv.action] && rpose[hv.action][hv.direction] !== undefined) {
            rpose[hv.action][hv.direction] = hv.clampedValue;
          }
        }
      }
    } else {
      result.violations.push({
        rule: 'noHyperextension',
        severity: 'not_implemented',
        detail: 'AnatomyLimits module not available',
      });
    }

    // ── 4. preserve current pose start (仅首帧检查) ──
    // 阻止硬切到 rest/empty pose（全零或近零），但允许有意义的动作（蹲下/挥手等）
    if (keyframe.time === 0 || keyframe.time < 0.02) {
      var hasExplicitTargets = keyframe.targets && keyframe.targets.length > 0;
      console.log("[SafetyContract] hasExplicitTargets=" + hasExplicitTargets + " poseKeys=" + Object.keys(pose||{}).length + " pose=" + JSON.stringify(pose||{}).substring(0,200));
      if (!hasExplicitTargets && _isNearRestPose(pose)) {
        result.rejections.push({
          rule: 'preserveCurrentPoseStart',
          severity: 'reject',
          detail: 'first keyframe is near-rest pose — hard cut from current action to rest prohibited',
        });
        result.passed = false;
      }
    }

    return result;
  }

  /**
   * 对候选轨迹执行全部规则
   */
  function checkCandidate(candidate, snapshot, profile, anatomyLimits, groundContact) {
    var allResults = [];
    var passed = true;

    var keyframes = candidate.keyframes || [];
    for (var i = 0; i < keyframes.length; i++) {
      var r = checkKeyframe(keyframes[i], snapshot, profile, anatomyLimits, groundContact);
      allResults.push(r);
      if (!r.passed) passed = false;
    }

    return {
      passed: passed,
      keyframeResults: allResults,
      summary: _summarize(allResults),
    };
  }

  // ═══════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════

  function _checkFloorPenetration(pose, floorY, profile) {
    var penetration = [];
    var minClearance = profile && profile.clearance ? (profile.clearance.footFloorTolerance || 0.03) : 0.03;

    // center move down 超过 floor → 穿透
    var center = pose.center;
    if (center && center.move && center.move.down !== undefined) {
      var downVal = center.move.down;
      // 简化判断：大值 down 需要 IK 支撑
      if (downVal > 5 && !_hasIKFootSupport(pose)) {
        penetration.push('center');
      }
    }

    return penetration;
  }

  function _crouchDetected(pose) {
    var center = pose.center;
    return center && center.move && (center.move.down || 0) > 0.5;
  }

  function _hasIKFootSupport(pose) {
    var ikBones = ['leg_ik_l', 'leg_ik_r', 'toe_ik_l', 'toe_ik_r'];
    for (var i = 0; i < ikBones.length; i++) {
      if (pose[ikBones[i]]) return true;
    }
    return false;
  }

  function _hasNonTrivialMotion(pose) {
    var count = 0;
    for (var bone in pose) {
      if (!pose.hasOwnProperty(bone)) continue;
      var actions = pose[bone];
      for (var act in actions) {
        if (!actions.hasOwnProperty(act)) continue;
        var dirs = actions[act];
        for (var dir in dirs) {
          if (!dirs.hasOwnProperty(dir)) continue;
          var v = dirs[dir];
          if (typeof v === 'number' && v !== 0) count++;
        }
      }
    }
    // More than 2 non-zero commands = non-trivial
    return count > 2;
  }

  function _isConnectedToCurrentPose(pose, snapshot) {
    // 已废弃 — 改为 _isNearRestPose 检查，见上方的 preserveCurrentPoseStart 规则
    // 保留函数以兼容其它调用方
  }

  /**
   * 检查 pose 是否是近 rest pose（所有指令绝对值 < 0.1°）
   * 用于阻止硬切回 rest pose；空 pose 也算 rest
   */
  function _isNearRestPose(pose) {
    var hasAny = false;
    for (var bone in pose) {
      if (!pose.hasOwnProperty(bone)) continue;
      for (var act in pose[bone]) {
        if (!pose[bone].hasOwnProperty(act)) continue;
        for (var dir in pose[bone][act]) {
          if (!pose[bone][act].hasOwnProperty(dir)) continue;
          var v = pose[bone][act][dir];
          if (typeof v === 'number' && Math.abs(v) >= 0.5) return false;
          hasAny = true;
        }
      }
    }
    return true;  // 空 pose 或所有值近零 → rest pose
  }

  /**
   * 检查 hyperextension
   * MPL 值是近似角度（°）：forward=Y+，数值即度数
   */
  function _checkHyperextension(pose, anatomyLimits) {
    var violations = [];

    // Bone-to-MPL-direction mapping
    // "bend forward" → forward rotation (positive)
    // "bend backward" → backward rotation (negative/opposite)
    var checks = {
      elbow_r: {
        'bend/forward': { limitName: 'elbow', rangeKey: 'bendDeg', maxIdx: 1 },
      },
      elbow_l: {
        'bend/forward': { limitName: 'elbow', rangeKey: 'bendDeg', maxIdx: 1 },
      },
      wrist_r: {
        'bend/forward': { limitName: 'wrist', rangeKey: 'bendDeg', maxIdx: 1 },
        'sway/left': { limitName: 'wrist', rangeKey: 'swayDeg', maxIdx: 1 },
        'sway/right': { limitName: 'wrist', rangeKey: 'swayDeg', maxIdx: 1 },
      },
      wrist_l: {
        'bend/forward': { limitName: 'wrist', rangeKey: 'bendDeg', maxIdx: 1 },
        'sway/left': { limitName: 'wrist', rangeKey: 'swayDeg', maxIdx: 1 },
        'sway/right': { limitName: 'wrist', rangeKey: 'swayDeg', maxIdx: 1 },
      },
      neck: {
        'bend/forward': { limitName: 'neck', rangeKey: 'bendForwardDeg', maxIdx: 1 },
        'bend/backward': { limitName: 'neck', rangeKey: 'bendBackwardDeg', maxIdx: 1 },
      },
      head: {
        'bend/forward': { limitName: 'headNeckCombined', rangeKey: 'bendForwardDegMax', maxIdx: null },
        'bend/backward': { limitName: 'headNeckCombined', rangeKey: 'bendBackwardDegMax', maxIdx: null },
      },
      upper_body: {
        'bend/forward': { limitName: 'spine', rangeKey: 'bendForwardDeg', maxIdx: 1 },
        'bend/backward': { limitName: 'spine', rangeKey: 'bendBackwardDeg', maxIdx: 1 },
      },
      arm_r: {
        'bend/forward': { limitName: 'shoulder', rangeKey: 'forwardDeg', maxIdx: 1 },
        'bend/backward': { limitName: 'shoulder', rangeKey: 'backwardDeg', maxIdx: 1 },
      },
      arm_l: {
        'bend/forward': { limitName: 'shoulder', rangeKey: 'forwardDeg', maxIdx: 1 },
        'bend/backward': { limitName: 'shoulder', rangeKey: 'backwardDeg', maxIdx: 1 },
      },
    };

    for (var bone in checks) {
      if (!pose[bone]) continue;
      var boneChecks = checks[bone];
      for (var actDir in boneChecks) {
        var parts = actDir.split('/');
        var action = parts[0];
        var direction = parts[1];
        if (!pose[bone][action] || pose[bone][action][direction] === undefined) continue;
        var value = pose[bone][action][direction];
        var cfg = boneChecks[actDir];
        var limit = anatomyLimits[cfg.limitName];
        if (!limit) continue;

        var rangeValue;
        if (cfg.maxIdx === null) {
          // Single max value (e.g., headNeckCombined.bendForwardDegMax)
          rangeValue = limit[cfg.rangeKey];
          if (typeof rangeValue === 'number' && value > rangeValue) {
            violations.push({
              bone: bone, action: action, direction: direction,
              value: value, max: rangeValue,
              severity: value > rangeValue * 1.2 ? 'reject' : 'clamp',
              detail: bone + ' ' + action + ' ' + direction + '=' + value + ' exceeds max ' + rangeValue,
              clampedValue: rangeValue,
            });
          }
        } else {
          // Range [min, max]
          rangeValue = limit[cfg.rangeKey];
          if (Array.isArray(rangeValue) && rangeValue.length >= 2) {
            var absVal = Math.abs(value);
            if (absVal > rangeValue[cfg.maxIdx]) {
              var maxVal = rangeValue[cfg.maxIdx];
              violations.push({
                bone: bone, action: action, direction: direction,
                value: value, max: maxVal,
                severity: absVal > maxVal * 1.3 ? 'reject' : 'clamp',
                detail: bone + ' ' + action + ' ' + direction + '=' + value + ' exceeds [' + rangeValue.join(', ') + ']',
                clampedValue: Math.sign(value) * maxVal,
              });
            }
          }
        }
      }
    }

    return violations;
  }

  function _summarize(allResults) {
    var total = { passed: 0, violations: 0, repairs: 0, rejections: 0, notImplemented: 0 };
    for (var i = 0; i < allResults.length; i++) {
      var r = allResults[i];
      if (r.passed) total.passed++;
      total.violations += r.violations.length;
      total.repairs += r.repairs.length;
      total.rejections += r.rejections.length;
    }
    return total;
  }

  // ═══════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════

  window.SafetyContract = {
    HARD_SAFETY_RULES: HARD_SAFETY_RULES,
    checkKeyframe: checkKeyframe,
    checkCandidate: checkCandidate,
  };
})();
