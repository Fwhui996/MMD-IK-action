/**
 * Motion Timing Policy — 动作时间策略
 *
 * 控制：
 *   - 动作节奏（单位帧时长、关键帧密度）
 *   - 响应模式（immediate/overtake/queue）
 *   - LLM tempo → 前端时间的转换
 *   - 最大/最小 keyframe 间距
 *
 * @module MotionTimingPolicy
 */
(function() {
  'use strict';

  var DEFAULTS = {
    /** 默认 keyframe 时长（ms） */
    keyframeDurationMs: 300,

    /** 最小 keyframe 时长 */
    minKeyframeDurationMs: 100,

    /** 最大 keyframe 时长 */
    maxKeyframeDurationMs: 2000,

    /** 默认缓动曲线 */
    easing: 'easeInOut',

    /** 稠密动作的最小帧间距（ms） */
    denseSpacingMs: 150,

    /** 舞蹈的最小帧间距 */
    danceSpacingMs: 80,

    /** 说明性动作的帧间距 */
    expressiveSpacingMs: 400,
  };

  /**
   * 将 LLM tempo 描述转换为 keyframe 时长
   * @param {string} tempo — "fast","normal","slow","gentle","urgent"
   * @returns {number} ms
   */
  function tempoToKeyframeDuration(tempo) {
    var map = {
      'urgent': DEFAULTS.minKeyframeDurationMs,
      'fast': 180,
      'normal': DEFAULTS.keyframeDurationMs,
      'slow': 600,
      'gentle': 800,
      'dance': DEFAULTS.danceSpacingMs,
    };
    return map[tempo] || DEFAULTS.keyframeDurationMs;
  }

  /**
   * 根据意图文本推断节奏
   * @param {string} intentText — 自然语言意图
   * @returns {string} tempo label
   */
  function inferTempo(intentText) {
    if (!intentText) return 'normal';

    var fast = /快|急|猛|跳|舞|闪|甩/g;
    var slow = /慢|优雅|缓缓|轻轻|温柔|舒缓|小心翼翼/g;

    var fastCount = (intentText.match(fast) || []).length;
    var slowCount = (intentText.match(slow) || []).length;

    if (fastCount > slowCount) return 'fast';
    if (slowCount > fastCount) return 'slow';
    return 'normal';
  }

  /**
   * 计算运动计划的总时长
   * @param {Array} keyframes — 关键帧列表
   * @param {string} tempo — 节奏
   * @returns {number} ms
   */
  function calculateDuration(keyframes, tempo) {
    var duration = tempoToKeyframeDuration(tempo);
    return Math.max(500, keyframes.length * duration);
  }

  /**
   * 应用时间策略到关键帧序列
   *
   * @param {Array} keyframes — 待填时间戳的 keyframe
   * @param {string} tempo — 节奏
   * @param {number} startOffset — 起始偏移（ms），用于叠加
   * @returns {Array} 含 time 字段的 keyframe
   */
  function applyTiming(keyframes, tempo, startOffset) {
    startOffset = startOffset || 0;
    var spacing = tempoToKeyframeDuration(tempo);

    var timed = [];
    for (var i = 0; i < keyframes.length; i++) {
      var kf = Object.assign({}, keyframes[i]);
      kf.time = startOffset + i * spacing;
      kf.easing = kf.easing || DEFAULTS.easing;
      timed.push(kf);
    }
    return timed;
  }

  /**
   * 确定响应模式
   *
   * @param {Object} motionState — MotionState.getState() 返回值
   * @returns {'immediate'|'overtake'|'queue'}
   */
  function determineResponseMode(motionState) {
    if (!motionState) return 'immediate';

    if (motionState.status === 'idle') return 'immediate';
    if (motionState.status === 'transitioning') return 'overtake';

    // playing: 半程后 → overtake，否则 queue
    if (motionState.progress > 0.5) return 'overtake';
    return 'queue';
  }

  /**
   * 获取排队等待时长
   * @param {Object} motionState
   * @returns {number} ms
   */
  function getQueueDelay(motionState) {
    if (!motionState || motionState.status !== 'playing') return 0;
    return Math.max(0, motionState.timeRemaining || 0);
  }

  /**
   * 为 keyframe 添加时间戳和缓动
   * @param {Array} keyframes
   * @param {number} startTime — 绝对开始时间（ms）
   * @param {number} spacing — 帧间距（ms）
   * @returns {Array}
   */
  function stampKeyframes(keyframes, startTime, spacing) {
    var stamped = [];
    for (var i = 0; i < keyframes.length; i++) {
      var kf = Object.assign({}, keyframes[i]);
      kf.time = startTime + i * spacing;
      kf.easing = kf.easing || DEFAULTS.easing;
      stamped.push(kf);
    }
    return stamped;
  }

  window.MotionTimingPolicy = {
    DEFAULTS: DEFAULTS,
    tempoToKeyframeDuration: tempoToKeyframeDuration,
    inferTempo: inferTempo,
    calculateDuration: calculateDuration,
    applyTiming: applyTiming,
    determineResponseMode: determineResponseMode,
    getQueueDelay: getQueueDelay,
    stampKeyframes: stampKeyframes,
  };
})();
