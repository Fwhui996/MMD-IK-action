/**
 * Effector Mapper — 归一化语义坐标 → 绝对世界坐标
 *
 * 将 LLM 输出的归一化 effector 值映射为 3D 绝对坐标：
 * - reach (0~1): 0=贴身, 1=手臂伸直
 * - height (0~1): 0=脚底, 1=头顶
 * - angle (-90~90): 0=正前方, 正=右, 负=左
 *
 * @module EffectorMapper
 */
(function() {
  'use strict';

  /** 将单个 effector 归一化值映射为绝对 3D 坐标 */
  function normalizeToAbsolute(effectorName, norm, profile) {
    if (norm && norm.x !== undefined && norm.y !== undefined && norm.z !== undefined) {
      return { x: norm.x, y: norm.y, z: norm.z };
    }

    var shoulderBase = (profile.shoulderWidth || 3.0) * 0.4;
    var armLen = profile.armTotalLength || 4.0;
    var r = shoulderBase + (norm.reach || 0) * armLen;

    var floorY = profile.floorPlane ? profile.floorPlane.y : 0.0;
    var modelHeight = profile.height || 17.0;
    var y = floorY + (norm.height || 0.5) * modelHeight;

    var angleRad = (norm.angle || 0) * Math.PI / 180;
    var torsoDepth = profile.torsoDepth || 1.5;

    return {
      x: r * Math.sin(angleRad),
      y: y,
      z: torsoDepth * 0.3 + r * 0.6 * Math.cos(angleRad),
    };
  }

  /** 将整帧 effector + torso 映射 */
  function mapKeyframe(keyframe, profile) {
    var result = { time: keyframe.t || 0, effectors: {}, torso: keyframe.torso || {} };
    var effNames = ['right_hand', 'left_hand', 'right_foot', 'left_foot'];

    if (keyframe.effectors) {
      for (var i = 0; i < effNames.length; i++) {
        var name = effNames[i];
        var norm = keyframe.effectors[name];
        if (norm) {
          result.effectors[name] = normalizeToAbsolute(name, norm, profile);
        }
      }
    }
    return result;
  }

  /** 映射完整 effector JSON */
  function mapAllKeyframes(effectorJSON, profile) {
    var keyframes = effectorJSON.motion ? effectorJSON.motion.keyframes : (effectorJSON.keyframes || []);
    var mapped = [];
    for (var i = 0; i < keyframes.length; i++) {
      mapped.push(mapKeyframe(keyframes[i], profile));
    }
    return mapped;
  }

  window.EffectorMapper = {
    normalizeToAbsolute: normalizeToAbsolute,
    mapKeyframe: mapKeyframe,
    mapAllKeyframes: mapAllKeyframes,
  };
})();
