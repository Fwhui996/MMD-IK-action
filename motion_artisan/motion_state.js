/**
 * Motion State — 动画状态追踪器
 *
 * 追踪：
 *   - 当前是否在播放动画（playing/idle）
 *   - 上一帧播放的动画名
 *   - 当前动画耗时 / 剩余时间
 *   - 动画完成后的状态（settled/transitioning/interrupted）
 *
 * 使用场景：
 *   - solveAndEmitMPL 检查是否可以叠加新动画
 *   - 中断当前动画 vs 排队等待
 *
 * @module MotionState
 */
(function() {
  'use strict';

  /**
   * @typedef {Object} AnimationState
   * @property {'idle'|'playing'|'transitioning'} status — 当前状态
   * @property {string|null} currentAnimation — 当前播放的动画名
   * @property {string|null} previousAnimation — 上一段播放的动画名
   * @property {number} startTime — 开始时间（performance.now）
   * @property {number} duration — 动画总时长（ms），0 表示未知
   * @property {number} timeRemaining — 剩余时间（ms），-1 表示未知
   * @property {number} progress — 播放进度 0..1
   * @property {string|null} lastIntent — 上一条动作意图
   */

  var _state = {
    status: 'idle',
    currentAnimation: null,
    previousAnimation: null,
    startTime: 0,
    duration: 0,
    timeRemaining: -1,
    progress: 0,
    lastIntent: null,
  };

  /** 是否正在播放 */
  function isPlaying() { return _state.status === 'playing'; }

  /** 是否空闲 */
  function isIdle() { return _state.status === 'idle'; }

  /** 是否在过渡 */
  function isTransitioning() { return _state.status === 'transitioning'; }

  /** 获取当前状态快照 */
  function getState() { return Object.assign({}, _state); }

  /**
   * 标记动画开始
   * @param {string} animationName
   * @param {number} durationMs — 预估时长
   * @param {string} intent — 意图文本
   */
  function startAnimation(animationName, durationMs, intent) {
    _state.previousAnimation = _state.currentAnimation;
    _state.currentAnimation = animationName;
    _state.status = 'playing';
    _state.startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    _state.duration = durationMs || 0;
    _state.timeRemaining = durationMs || -1;
    _state.progress = 0;
    if (intent) {
      _state.lastIntent = intent;
    }
  }

  /**
   * 标记动画结束
   */
  function endAnimation() {
    _state.status = 'idle';
    _state.progress = 1;
    _state.timeRemaining = 0;
  }

  /**
   * 标记被中断
   */
  function interruptAnimation() {
    _state.previousAnimation = _state.currentAnimation;
    _state.status = 'transitioning';
    _state.currentAnimation = null;
    _state.timeRemaining = 0;
    _state.progress = 0;
  }

  /**
   * 更新播放进度（每帧调用）
   */
  function updateProgress() {
    if (_state.status !== 'playing') return;
    if (_state.duration <= 0) return;

    var now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    var elapsed = now - _state.startTime;
    _state.progress = Math.min(1, elapsed / _state.duration);
    _state.timeRemaining = Math.max(0, _state.duration - elapsed);

    if (_state.progress >= 1) {
      endAnimation();
    }
  }

  /**
   * 检查是否可以安全叠加新动画
   * @returns {boolean}
   */
  function canOverlay() {
    updateProgress();
    // 空闲时总是可以
    if (_state.status === 'idle') return true;
    // 过渡中也可以（中断旧动画）
    if (_state.status === 'transitioning') return true;
    // 播放中如果已过 50%，允许覆盖
    if (_state.status === 'playing' && _state.progress > 0.5) return true;
    return false;
  }

  /**
   * 检查是否需要排队
   * @returns {boolean}
   */
  function shouldQueue() {
    updateProgress();
    return _state.status === 'playing' && _state.progress <= 0.5;
  }

  /**
   * 获取等待时间估计
   * @returns {number} ms
   */
  function estimatedWaitTime() {
    updateProgress();
    if (_state.status === 'idle') return 0;
    return Math.max(0, _state.timeRemaining || 0);
  }

  window.MotionState = {
    isPlaying: isPlaying,
    isIdle: isIdle,
    isTransitioning: isTransitioning,
    getState: getState,
    startAnimation: startAnimation,
    endAnimation: endAnimation,
    interruptAnimation: interruptAnimation,
    updateProgress: updateProgress,
    canOverlay: canOverlay,
    shouldQueue: shouldQueue,
    estimatedWaitTime: estimatedWaitTime,
  };
})();
