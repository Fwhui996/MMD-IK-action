/**
 * Trajectory Interpolator — Catmull-Rom 样条插值
 *
 * 在 LLM 输出的稀疏关键帧之间插值生成每帧目标坐标。
 *
 * @module TrajectoryInterpolator
 */
(function() {
  'use strict';

  function catmullRom1D(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * (2*p1 + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3);
  }

  function catmullRom3D(p0, p1, p2, p3, t) {
    return {
      x: catmullRom1D(p0.x, p1.x, p2.x, p3.x, t),
      y: catmullRom1D(p0.y, p1.y, p2.y, p3.y, t),
      z: catmullRom1D(p0.z, p1.z, p2.z, p3.z, t),
    };
  }

  function lerp3D(a, b, t) {
    return { x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t, z: a.z+(b.z-a.z)*t };
  }

  function _getEffectorPos(kf, name) {
    if (!kf || !kf.effectors || !kf.effectors[name]) return null;
    var e = kf.effectors[name];
    return { x: e.x||0, y: e.y||0, z: e.z||0 };
  }

  function _getEffectorNames(mappedKeyframes) {
    var names = {};
    for (var i = 0; i < mappedKeyframes.length; i++) {
      var effs = mappedKeyframes[i].effectors;
      if (!effs) continue;
      for (var name in effs) { if (effs.hasOwnProperty(name)) names[name] = true; }
    }
    return Object.keys(names);
  }

  /** 对映射后的关键帧插值，返回每帧数据 */
  function interpolate(mappedKeyframes, fps) {
    fps = fps || 60;
    if (!mappedKeyframes || mappedKeyframes.length === 0) return [];

    var frameInterval = 1 / fps;
    var totalDuration = mappedKeyframes[mappedKeyframes.length - 1].time;
    var totalFrames = Math.ceil(totalDuration * fps) + 1;
    var n = mappedKeyframes.length;
    var frames = [];
    var effectorNames = _getEffectorNames(mappedKeyframes);

    for (var f = 0; f < totalFrames; f++) {
      var t = Math.min(f * frameInterval, totalDuration);
      var frame = { time: t, effectors: {} };

      for (var ei = 0; ei < effectorNames.length; ei++) {
        var ename = effectorNames[ei];

        // Find segment
        var seg = n - 1;
        for (var s = 0; s < n - 1; s++) {
          if (t <= mappedKeyframes[s + 1].time) { seg = s; break; }
        }

        var p0 = _getEffectorPos(mappedKeyframes[Math.max(0, seg - 1)], ename);
        var p1 = _getEffectorPos(mappedKeyframes[seg], ename);
        var p2 = _getEffectorPos(mappedKeyframes[Math.min(n-1, seg+1)], ename);
        var p3 = _getEffectorPos(mappedKeyframes[Math.min(n-1, seg+2)], ename);

        if (!p1 || !p2) { frame.effectors[ename] = p1 || p2 || {x:0,y:0,z:0}; continue; }

        var segStart = mappedKeyframes[seg].time;
        var segEnd = mappedKeyframes[Math.min(n-1, seg+1)].time;
        var localT = (segEnd - segStart > 0.001) ? (t - segStart) / (segEnd - segStart) : 0;

        try {
          frame.effectors[ename] = catmullRom3D(p0||p1, p1, p2, p3||p2, localT);
        } catch(e) {
          frame.effectors[ename] = lerp3D(p1, p2, localT);
        }
      }

      frames.push(frame);
    }

    return frames;
  }

  window.TrajectoryInterpolator = {
    interpolate: interpolate,
    catmullRom1D: catmullRom1D,
    catmullRom3D: catmullRom3D,
    lerp3D: lerp3D,
  };
})();
