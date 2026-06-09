/**
 * Trajectory Solver — 轨迹求解器
 *
 * 将 MotionIntentPlan 的阶段/target 转换为候选关键帧轨迹。
 * 每个关键帧包含 targets（语义意图）和 pose（真实 MPL 骨骼指令）。
 *
 * §3.6: keyframe.pose 必须包含可发射的骨骼指令。
 *
 * @module TrajectorySolver
 */
(function() {
  'use strict';

  /**
   * 从 MotionIntentPlan 生成候选轨迹
   * @param {Object} plan
   * @param {Object} snapshot - CurrentPoseSnapshot
   * @param {Object} profile - ModelCollisionProfile
   * @returns {Array<Object>} 候选列表
   */
  function generateCandidates(plan, snapshot, profile) {
    var stages = plan.stages || [];
    console.log('[TrajectorySolver] plan:', { stagesLen: stages.length, stageCount: plan.stage_count, mode: plan.motion_mode, intent: plan.intent });
    if (stages.length > 0) { console.log('[TrajectorySolver] stage targets:', JSON.stringify(stages[0].targets).substring(0,400)); }
    if (stages.length === 0) {
      console.warn('[TrajectorySolver] no stages in plan, returning empty');
      return [];
    }

    var candidates = [];

    // 候选 1: 保守（小幅度）
    try {
      candidates.push(_buildCandidate(stages, 0.6, plan.duration || 2.0, 'conservative', snapshot, profile));
    } catch(e) { console.error('[TrajectorySolver] conservative build failed:', e.message); }

    // 候选 2: 正常（计划幅度）
    try {
      candidates.push(_buildCandidate(stages, 1.0, plan.duration || 2.0, 'normal', snapshot, profile));
    } catch(e) { console.error('[TrajectorySolver] normal build failed:', e.message); }

    // 候选 3: 宽松（更慢 timing，更大间隙）
    try {
      candidates.push(_buildCandidate(stages, 1.3, (plan.duration || 2.0) * 1.2, 'relaxed', snapshot, profile));
    } catch(e) { console.error('[TrajectorySolver] relaxed build failed:', e.message); }

    console.log('[TrajectorySolver] generated ' + candidates.length + ' candidates');
    return candidates;
  }

  function _buildCandidate(stages, amplitudeMul, totalDuration, label, snapshot, profile) {
    var keyframes = [];
    var cumulativeTime = 0;
    var _currentPose = {};

    for (var i = 0; i < stages.length; i++) {
      var stage = stages[i];
      var stageDuration = stage.duration * (amplitudeMul >= 1.2 ? 1.1 : 1.0);

      // ── 转换 targets + 求解 pose ──
      var rawTargets = stage.targets || [];
      var enrichedTargets = [];
      var mergedPose = {};

      for (var j = 0; j < rawTargets.length; j++) {
        var t = rawTargets[j];
        var scaledAmount = _scaleAmount(t.amount, amplitudeMul);

        // 构造一个 target 对象给 solver
        var targetForSolver = {
          body: t.body,
          goal: t.goal,
          amount: scaledAmount,
          space: t.space || 'relative',
          notes: t.notes || '',
        };

        // 调用 PoseTargets solver 获取真实骨骼指令
        var solved = { pose: {}, usedCapabilities: [], assumptions: [], safetyRequirements: [] };
        if (window.PoseTargets && typeof window.PoseTargets.solveTarget === 'function') {
          solved = window.PoseTargets.solveTarget(targetForSolver, snapshot, profile);
        }

        // 合并 pose
        _mergePose(mergedPose, solved.pose || {});

        enrichedTargets.push({
          body: t.body,
          goal: t.goal,
          amount: scaledAmount,
          space: t.space || 'relative',
          notes: t.notes || '',
          solved: solved,
        });
      }

      // Subdivide this stage into sub-keyframes for smoother animation
      var SUB_STEPS = 20;
      var prevPose = _currentPose || {};
      for (var sub = 0; sub < SUB_STEPS; sub++) {
        var t = (sub + 1) / SUB_STEPS;
        var subTime = cumulativeTime + stageDuration * ((sub + 0.5) / SUB_STEPS);
        var lerpedPose = {};
        var boneNames = [];
        for (var bone in mergedPose) { if (mergedPose.hasOwnProperty(bone)) boneNames.push(bone); }
        for (var bi = 0; bi < boneNames.length; bi++) {
          var bone = boneNames[bi];
          lerpedPose[bone] = {};
          var actNames = [];
          for (var act in mergedPose[bone]) { if (mergedPose[bone].hasOwnProperty(act)) actNames.push(act); }
          for (var ai = 0; ai < actNames.length; ai++) {
            var act = actNames[ai];
            lerpedPose[bone][act] = {};
            var dirNames = [];
            for (var dir in mergedPose[bone][act]) { if (mergedPose[bone][act].hasOwnProperty(dir)) dirNames.push(dir); }
            for (var di = 0; di < dirNames.length; di++) {
              var dir = dirNames[di];
              var targetVal = mergedPose[bone][act][dir];
              var prevVal = 0;
              if (prevPose[bone] && prevPose[bone][act] && typeof prevPose[bone][act][dir] === 'number') prevVal = prevPose[bone][act][dir];
              lerpedPose[bone][act][dir] = Math.round(prevVal + (targetVal - prevVal) * t);
            }
          }
        }
        keyframes.push({
          time: subTime,
          duration: stageDuration / SUB_STEPS,
          name: stage.name + '_' + (sub + 1),
          intent: stage.intent,
          targets: enrichedTargets,
          pose: lerpedPose,
          source: { solver: 'pose_targets', validated: false },
        });
      }
      _currentPose = mergedPose;

      cumulativeTime += stageDuration;
    }

    return {
      label: label,
      amplitudeMul: amplitudeMul,
      totalDuration: cumulativeTime,
      keyframes: keyframes,
    };
  }

  /**
   * 合并两个 pose 对象（后面的覆盖前面的同骨骼）
   */
  function _mergePose(target, source) {
    for (var bone in source) {
      if (!source.hasOwnProperty(bone)) continue;
      if (!target[bone]) {
        target[bone] = {};
      }
      for (var action in source[bone]) {
        if (!source[bone].hasOwnProperty(action)) continue;
        if (!target[bone][action]) {
          target[bone][action] = {};
        }
        for (var dir in source[bone][action]) {
          if (!source[bone][action].hasOwnProperty(dir)) continue;
          target[bone][action][dir] = source[bone][action][dir];
        }
      }
    }
  }

  function _scaleAmount(amount, mul) {
    if (mul <= 0.7) return 'small';
    if (mul >= 1.2) return 'large';
    return amount || 'medium';
  }

  window.TrajectorySolver = {
    generateCandidates: generateCandidates,
  };
})();
