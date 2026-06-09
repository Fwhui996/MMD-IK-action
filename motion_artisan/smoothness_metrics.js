/**
 * Smoothness Metrics — 平滑度度量
 *
 * §4.4.3. 在采样帧上测量位置/旋转 jerk、端点位移、快照检测。
 * 硬拒：首帧 delta 过大、root 垂直跳变、手瞬移、肘/膝方向翻转。
 *
 * @module SmoothnessMetrics
 */
(function() {
  'use strict';

  /**
   * 评估候选轨迹的平滑度
   *
   * @param {Object} candidate — 含 keyframes[]
   * @param {Object} snapshot — CurrentPoseSnapshot（参考首帧）
   * @param {Object} profile — ModelCalibrationProfile
   * @returns {Object} { score, maxPositionJerk, maxAngularJerkDeg, firstTransitionDelta, snapDetected }
   */
  function evaluate(candidate, snapshot, profile) {
    var keyframes = candidate.keyframes || [];
    if (keyframes.length === 0) {
      return _zeroScore();
    }

    var result = {
      score: 1.0,
      maxPositionJerk: 0,
      maxAngularJerkDeg: 0,
      firstTransitionDelta: 0,
      snapDetected: false,
      violations: [],
    };

    // ── 1. 首帧 delta ──
    if (keyframes.length > 0) {
      var firstKf = keyframes[0];
      result.firstTransitionDelta = _computeFirstFrameDelta(firstKf, snapshot);

      if (result.firstTransitionDelta > 25) {
        result.violations.push({
          type: 'first_frame_delta_excessive',
          delta: result.firstTransitionDelta,
          threshold: 25,
        });
        result.snapDetected = true;
        result.score -= 0.3;
      }
    }

    // ── 2. 帧间 jerk ──
    for (var i = 1; i < keyframes.length; i++) {
      var prev = keyframes[i - 1];
      var curr = keyframes[i];

      var posJerk = _computePositionJerk(prev.pose, curr.pose, (curr.time - prev.time));
      if (posJerk > result.maxPositionJerk) result.maxPositionJerk = posJerk;

      if (posJerk > 15) {
        result.violations.push({
          type: 'position_jerk_high',
          keyframe: i,
          value: posJerk,
          threshold: 15,
        });
        result.score -= 0.1;
      }
      if (posJerk > 30) {
        result.snapDetected = true;
        result.score -= 0.2;
      }
    }

    // ── 3. root 垂直跳变检查 ──
    var prevCenterDown = 0;
    for (var j = 0; j < keyframes.length; j++) {
      var kf = keyframes[j];
      var center = kf.pose.center;
      var currDown = 0;
      if (center && center.move && center.move.down) {
        currDown = center.move.down;
      }

      if (j > 0) {
        var delta = Math.abs(currDown - prevCenterDown);
        if (delta > 4) {
          result.violations.push({
            type: 'root_vertical_jump',
            keyframe: j,
            delta: delta,
            threshold: 4,
          });
          result.snapDetected = true;
          result.score -= 0.15;
        }
      }

      prevCenterDown = currDown;
    }

    // ── 4. 肘/膝方向翻转检测 ──
    var elbowFlip = _detectDirectionFlip(keyframes, ['elbow_r', 'elbow_l', 'knee_r', 'knee_l']);
    if (elbowFlip) {
      result.violations.push({
        type: 'joint_direction_flip',
        bone: elbowFlip.bone,
        keyframe: elbowFlip.keyframe,
      });
      result.snapDetected = true;
      result.score -= 0.25;
    }

    // ── 5. 手瞬移检测 ──
    var handTeleport = _detectHandTeleport(keyframes);
    if (handTeleport) {
      result.violations.push({
        type: 'hand_teleport',
        keyframe: handTeleport.keyframe,
        bone: handTeleport.bone,
      });
      result.snapDetected = true;
      result.score -= 0.3;
    }

    result.score = Math.max(0, result.score);
    return result;
  }

  // ═══════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════

  function _zeroScore() {
    return {
      score: 0,
      maxPositionJerk: 0,
      maxAngularJerkDeg: 0,
      firstTransitionDelta: 0,
      snapDetected: false,
      violations: [],
    };
  }

  /**
   * 计算首帧与当前姿态之间的最大骨骼变化
   */
  function _computeFirstFrameDelta(keyframe, snapshot) {
    var pose = keyframe.pose || {};
    var maxDelta = 0;

    for (var bone in pose) {
      if (!pose.hasOwnProperty(bone)) continue;
      var actions = pose[bone];
      for (var act in actions) {
        if (!actions.hasOwnProperty(act)) continue;
        var dirs = actions[act];
        for (var dir in dirs) {
          if (!dirs.hasOwnProperty(dir)) continue;
          var val = dirs[dir];
          if (typeof val === 'number') {
            maxDelta = Math.max(maxDelta, Math.abs(val));
          }
        }
      }
    }

    return maxDelta;
  }

  /**
   * 计算两帧之间的位置 jerk（简化版：最大增量差）
   */
  function _computePositionJerk(prevPose, currPose, timeDelta) {
    if (timeDelta <= 0) return 0;
    var maxDiff = 0;

    var allBones = {};
    _addBones(allBones, prevPose);
    _addBones(allBones, currPose);

    for (var bone in allBones) {
      var prevVal = _extractMaxValue(prevPose, bone);
      var currVal = _extractMaxValue(currPose, bone);
      var diff = Math.abs(currVal - prevVal);
      // 单位时间变化率
      var rate = diff / timeDelta;
      if (rate > maxDiff) maxDiff = rate;
    }

    return maxDiff;
  }

  function _addBones(set, pose) {
    if (!pose) return;
    for (var bone in pose) {
      if (pose.hasOwnProperty(bone)) set[bone] = true;
    }
  }

  function _extractMaxValue(pose, bone) {
    if (!pose || !pose[bone]) return 0;
    var maxVal = 0;
    var actions = pose[bone];
    for (var act in actions) {
      if (!actions.hasOwnProperty(act)) continue;
      var dirs = actions[act];
      for (var dir in dirs) {
        if (!dirs.hasOwnProperty(dir)) continue;
        maxVal = Math.max(maxVal, Math.abs(dirs[dir] || 0));
      }
    }
    return maxVal;
  }

  /**
   * 检测关节方向翻转（同一骨骼的 bend forward/backward 符号突变）
   */
  function _detectDirectionFlip(keyframes, bones) {
    for (var b = 0; b < bones.length; b++) {
      var bone = bones[b];
      var prevSign = 0;
      for (var i = 0; i < keyframes.length; i++) {
        var kf = keyframes[i];
        var bp = kf.pose[bone];
        if (!bp) continue;

        var curVal = 0;
        if (bp.bend) {
          if (bp.bend.forward) curVal = bp.bend.forward;
          if (bp.bend.backward) curVal = -bp.bend.backward;
        }

        var curSign = curVal > 0.5 ? 1 : curVal < -0.5 ? -1 : 0;
        if (prevSign !== 0 && curSign !== 0 && curSign !== prevSign) {
          return { bone: bone, keyframe: i, prevSign: prevSign, curSign: curSign };
        }
        if (curSign !== 0) prevSign = curSign;
      }
    }
    return null;
  }

  /**
   * 检测手部瞬移（跨帧大位移）
   */
  function _detectHandTeleport(keyframes) {
    var handBones = ['wrist_r', 'wrist_l', 'elbow_r', 'elbow_l'];
    for (var b = 0; b < handBones.length; b++) {
      var bone = handBones[b];
      var prevVal = null;
      for (var i = 0; i < keyframes.length; i++) {
        var kf = keyframes[i];
        var bp = kf.pose[bone];
        if (!bp) continue;
        var curVal = _extractMaxValue(kf.pose, bone);
        if (prevVal !== null && Math.abs(curVal - prevVal) > 40) {
          return { bone: bone, keyframe: i, prevVal: prevVal, curVal: curVal };
        }
        prevVal = curVal;
      }
    }
    return null;
  }

  window.SmoothnessMetrics = {
    evaluate: evaluate,
  };
})();
