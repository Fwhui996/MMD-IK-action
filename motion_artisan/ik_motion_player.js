/**
 * IK Motion Player — IK 驱动动画播放器
 *
 * 替代旧的 MPL compileAndPlay 流程。
 * 接收 effector JSON → 映射 → 插值 → 每帧设 IK target + solver.update() + 躯干旋转。
 *
 * @module IKMotionPlayer
 */
(function() {
  'use strict';

  var _playing = false;
  var _frames = [];
  var _currentFrame = 0;
  var _startTime = 0;
  var _rafId = null;
  var _fps = 60;
  var _calProfile = null;

  function init(calProfile) { _calProfile = calProfile; }

  function play(effectorJSON) {
    if (!_calProfile) { console.warn('[IKMotionPlayer] no calibration profile'); return false; }
    if (_playing) stop();

    // Step 1: map
    var mappedKeyframes;
    if (window.EffectorMapper && typeof window.EffectorMapper.mapAllKeyframes === 'function') {
      mappedKeyframes = window.EffectorMapper.mapAllKeyframes(effectorJSON, _calProfile);
    } else {
      var kfs = effectorJSON.motion ? effectorJSON.motion.keyframes : (effectorJSON.keyframes || []);
      mappedKeyframes = kfs.map(function(kf) {
        return window.EffectorMapper.mapKeyframe(kf, _calProfile);
      });
    }

    if (mappedKeyframes.length === 0) { console.warn('[IKMotionPlayer] no mapped keyframes'); return false; }

    // Step 2: interpolate
    if (window.TrajectoryInterpolator) {
      _frames = window.TrajectoryInterpolator.interpolate(mappedKeyframes, _fps);
    } else {
      _frames = mappedKeyframes;
    }

    // Step 3: start
    _currentFrame = 0;
    _startTime = performance.now();
    _playing = true;

    if (window.PlaybackMode && typeof window.PlaybackMode.setMode === 'function') {
      window.PlaybackMode.setMode('llm');
    }

    if (window.MotionState && typeof window.MotionState.startAnimation === 'function') {
      var dur = _frames.length > 0 ? _frames[_frames.length - 1].time : 1;
      window.MotionState.startAnimation('ik_motion_' + Date.now(), dur * 1000, effectorJSON.reply || '');
    }

    _tick();
    return true;
  }

  function _tick() {
    if (!_playing) return;
    var elapsed = (performance.now() - _startTime) / 1000;

    while (_currentFrame < _frames.length && _frames[_currentFrame].time <= elapsed) {
      _applyFrame(_frames[_currentFrame]);
      _currentFrame++;
    }

    if (_currentFrame >= _frames.length) { stop(); return; }
    _rafId = requestAnimationFrame(_tick);
  }

  function _applyFrame(frame) {
    var effs = frame.effectors || {};
    // Set IK targets
    if (window.ArmIKDriver && window.ArmIKDriver.isInitialized()) {
      if (effs.right_hand) { window.ArmIKDriver.setRightTarget(effs.right_hand.x, effs.right_hand.y, effs.right_hand.z); }
      if (effs.left_hand)  { window.ArmIKDriver.setLeftTarget(effs.left_hand.x, effs.left_hand.y, effs.left_hand.z); }
    }
    // Torso
    _applyTorso(frame);
    // IK solvers
    if (window.$ && window.$.helper && window.$.helper.ikSolver) {
      try { window.$.helper.ikSolver.update(); } catch(e) {}
    }
    if (window.ArmIKDriver) { window.ArmIKDriver.update(); }
  }

  function _applyTorso(frame) {
    var torso = frame.torso || {};
    if (!window.$ || !window.$.model || !window.$.model.skeleton) return;
    var bones = window.$.model.skeleton.bones;
    var THREE = typeof THREE !== 'undefined' ? THREE : (window.$ && window.$.THREE);

    function _find(names) {
      for (var i = 0; i < bones.length; i++) {
        for (var j = 0; j < names.length; j++) {
          if ((bones[i].name || '').indexOf(names[j]) !== -1) return i;
        }
      }
      return -1;
    }

    function _set(idx, bend, turn, sway) {
      if (idx < 0 || !THREE) return;
      var e = new THREE.Euler(THREE.MathUtils.degToRad(bend||0), THREE.MathUtils.degToRad(turn||0), THREE.MathUtils.degToRad(sway||0), 'YXZ');
      bones[idx].quaternion.setFromEuler(e);
    }

    if (torso.upper_body) { var ub = torso.upper_body; _set(_find(['上半身','upper_body','Upper_Body']), ub.bend, ub.turn, ub.sway); }
    if (torso.neck)       { var nk = torso.neck;       _set(_find(['首','neck','Neck']), nk.bend, nk.turn, nk.sway); }
    if (torso.head)       { var hd = torso.head;       _set(_find(['頭','head','Head']), hd.bend, hd.turn, hd.sway); }
  }

  function stop() {
    _playing = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (window.PlaybackMode && typeof window.PlaybackMode.setMode === 'function') { window.PlaybackMode.setMode('vmd'); }
    if (window.MotionState && typeof window.MotionState.endAnimation === 'function') { window.MotionState.endAnimation(); }
  }

  function isPlaying() { return _playing; }

  window.IKMotionPlayer = {
    init: init, play: play, stop: stop, isPlaying: isPlaying,
  };
})();
