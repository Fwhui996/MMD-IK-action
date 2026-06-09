/**
 * Playback Mode — 播放模式切换
 *
 * vmd: MMDAnimationHelper 管理，手臂 IK 不参与
 * llm: IK 驱动，legSolver + armSolver
 *
 * @module PlaybackMode
 */
(function() {
  'use strict';

  var _currentMode = 'vmd';

  function setMode(mode) {
    if (mode !== 'vmd' && mode !== 'llm') { console.warn('[PlaybackMode] unknown mode:', mode); return; }
    _currentMode = mode;
  }

  function getMode() { return _currentMode; }
  function isVMD() { return _currentMode === 'vmd'; }
  function isLLM() { return _currentMode === 'llm'; }

  window.PlaybackMode = { setMode: setMode, getMode: getMode, isVMD: isVMD, isLLM: isLLM };
})();
