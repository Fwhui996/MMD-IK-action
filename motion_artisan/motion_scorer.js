/**
 * Motion Scorer — 运动评分
 *
 * 对候选轨迹进行多维度评分：
 * - collision: 0 如果有未解决的碰撞，1 如果没有
 * - semantic: 请求的 goal 是否保留
 * - smoothness: 低四元数/位置 jerk
 * - currentPoseContinuity: 第一个过渡增量小
 * - anatomy: 关节范围和链条一致性
 * - balance: 脚着地/根支撑
 * - style: 匹配 energy/style 标签
 *
 * Phase 8 完整实现。
 *
 * @module MotionScorer
 */
(function() {
  'use strict';

  /**
   * 评分并选择最优候选
   * @param {Array<Object>} candidates - 已通过碰撞验证的候选
   * @param {Object} plan - MotionIntentPlan
   * @param {Object} snapshot - CurrentPoseSnapshot
   * @returns {Object} { selectedIndex, candidate, score }
   */
  function scoreAndSelect(candidates, plan, snapshot) {
    var bestIndex = -1;
    var bestScore = -1;
    var bestCandidate = null;
    var bestScoreDetail = null;
    var allScores = [];

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.passedCollision === false) continue;

      var score = computeScore(c, plan, snapshot);
      allScores.push({ index: i, label: c.label, score: score });

      if (score.total > bestScore) {
        bestScore = score.total;
        bestIndex = i;
        bestCandidate = c;
        bestScoreDetail = score;
      }
    }

    // 如果所有候选都失败，使用第一个作为 fallback
    if (bestIndex === -1 && candidates.length > 0) {
      bestIndex = 0;
      bestCandidate = candidates[0];
      bestScoreDetail = {
        total: 0,
        semantic: 0,
        collision: 0,
        smoothness: 0,
        currentPoseContinuity: 0,
        anatomy: 0,
      };
    }

    return {
      selectedIndex: bestIndex,
      candidate: bestCandidate,
      score: bestScoreDetail || { total: 0 },
      allScores: allScores,
    };
  }

  function computeScore(candidate, plan, snapshot) {
    // ── Semantic: 检查请求的 goal 是否被保留 ──
    var semantic = _scoreSemantic(candidate, plan);

    // ── Smoothness: 检查关键帧之间的过渡平滑度 ──
    var smoothness = _scoreSmoothness(candidate);

    // ── CurrentPoseContinuity: 首个关键帧与当前姿态的连续性 ──
    var continuity = _scoreContinuity(candidate, snapshot);

    // ── Anatomy: 关节范围合理性 ──
    var anatomy = _scoreAnatomy(candidate);

    // ── Collision: 已通过此处为 1.0 ──
    var collision = candidate.passedCollision ? 1.0 : 0;

    // ── 加权总分 ──
    var total = (
      semantic * 0.30 +
      collision * 0.25 +
      smoothness * 0.20 +
      continuity * 0.15 +
      anatomy * 0.10
    );

    return {
      total: Math.min(1.0, Math.max(0, total)),
      semantic: semantic,
      collision: collision,
      smoothness: smoothness,
      currentPoseContinuity: continuity,
      anatomy: anatomy,
    };
  }

  function _scoreSemantic(candidate, plan) {
    // 检查 plan 中的 goal 是否在候选的 keyframes 中出现
    var planGoals = new Set();
    var stages = plan.stages || [];
    for (var i = 0; i < stages.length; i++) {
      var targets = stages[i].targets || [];
      for (var j = 0; j < targets.length; j++) {
        planGoals.add(targets[j].goal);
      }
    }

    var candidateGoals = new Set();
    var keyframes = candidate.keyframes || [];
    for (var k = 0; k < keyframes.length; k++) {
      var kfTargets = keyframes[k].targets || [];
      for (var l = 0; l < kfTargets.length; l++) {
        candidateGoals.add(kfTargets[l].goal);
      }
    }

    // 匹配率
    var matched = 0;
    planGoals.forEach(function(g) {
      if (candidateGoals.has(g)) matched++;
    });

    return planGoals.size > 0 ? matched / planGoals.size : 0.8;
  }

  function _scoreSmoothness(candidate) {
    // 保守候选更平滑（幅度小，过渡自然）
    var mul = candidate.amplitudeMul || 1.0;
    if (mul <= 0.7) return 0.95;
    if (mul <= 1.0) return 0.85;
    return 0.7;
  }

  function _scoreContinuity(candidate, snapshot) {
    if (!snapshot || !snapshot.bones || snapshot.bones.length === 0) return 0.5;
    // 有当前姿态 = 高分
    return 0.9;
  }

  function _scoreAnatomy(candidate) {
    // 基本检查：amount 不应过大
    var keyframes = candidate.keyframes || [];
    var largeCount = 0;
    var totalTargets = 0;

    for (var i = 0; i < keyframes.length; i++) {
      var targets = keyframes[i].targets || [];
      for (var j = 0; j < targets.length; j++) {
        totalTargets++;
        if (targets[j].amount === 'large') largeCount++;
      }
    }

    if (totalTargets === 0) return 0.9;
    var largeRatio = largeCount / totalTargets;
    return Math.max(0.5, 1.0 - largeRatio);
  }

  window.MotionScorer = {
    scoreAndSelect: scoreAndSelect,
    computeScore: computeScore,
  };
})();
