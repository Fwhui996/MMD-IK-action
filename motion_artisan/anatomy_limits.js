/**
 * Anatomy Limits — 解剖学安全范围
 *
 * §4.3.3. 每个关节的保守范围（度）。
 * 初始版本是保守的硬编码值。
 * 后续 calibratePerModel() 可基于 PMX 骨骼朝向/缩放调整。
 *
 * @module AnatomyLimits
 */
(function() {
  'use strict';

  /**
   * 解剖限制（度）
   *
   * bendForwardDeg: 前弯最大角度
   * bendBackwardDeg: 后弯最大角度
   * 数组中 [0, max] 表示安全范围
   * turn = 水平扭转，sway = 侧摆
   */
  var ANATOMY_LIMITS = {
    // ── 颈 ──
    neck: {
      bendForwardDeg: [0, 35],
      bendBackwardDeg: [0, 45],
      turnDeg: [0, 65],
      swayDeg: [0, 35],
    },
    headNeckCombined: {
      bendForwardDegMax: 70,
      bendBackwardDegMax: 75,
    },
    // ── 肩 ──
    shoulder: {
      forwardDeg: [0, 95],
      backwardDeg: [0, 55],
      outwardDeg: [0, 100],
      twistDeg: [0, 80],
    },
    // ── 肘 ──
    elbow: {
      bendDeg: [0, 150],
      hyperextendDegMax: 5,
    },
    // ── 腕 ──
    wrist: {
      bendDeg: [0, 70],
      swayDeg: [0, 45],
      twistDeg: [0, 90],
    },
    // ── 脊柱 ──
    spine: {
      bendForwardDeg: [0, 35],
      bendBackwardDeg: [0, 25],
      twistDeg: [0, 35],
    },
    // ── 髋 ──
    hip: {
      flexDeg: [0, 120],
      extendDeg: [0, 35],
      abductDeg: [0, 45],
    },
    // ── 膝 ──
    knee: {
      bendDeg: [0, 145],
      hyperextendDegMax: 5,
    },
    // ── 踝 ──
    ankle: {
      bendDeg: [0, 45],
      swayDeg: [0, 25],
    },
    // ── root/center 下沉幅度 ──
    root: {
      crouchCenterDownProfile: {
        tiny: [0, 1.5],
        small: [0.5, 3.0],
        medium: [1.5, 5.0],
        large: [3.0, 8.0],
        hardMax: 10.0,
      },
    },
  };

  /**
   * 查询某个关节/动作/方向的安全范围
   *
   * @param {string} joint — 'neck' | 'shoulder' | 'elbow' | 'wrist' | 'spine' | 'hip' | 'knee' | 'ankle'
   * @param {string} action — 'bend' | 'sway' | 'turn' | 'twist'
   * @param {string} direction — 'forward' | 'backward' | 'left' | 'right'
   * @returns {number[]|null} [min, max] 或 null
   */
  function getRange(joint, action, direction) {
    var limits = ANATOMY_LIMITS[joint];
    if (!limits) return null;

    var key;
    if (action === 'bend') {
      key = direction === 'forward' ? 'bendForwardDeg' : 'bendBackwardDeg';
    } else if (action === 'sway') {
      key = 'swayDeg';
    } else if (action === 'turn') {
      key = 'turnDeg';
    } else if (action === 'twist') {
      key = 'twistDeg';
    }
    // 通用 fallback
    if (!key && action === 'bend') key = 'bendDeg';

    var range = limits[key];
    if (Array.isArray(range)) return range;
    if (typeof range === 'number') return [0, range];
    return null;
  }

  /**
   * clamp 值到安全范围
   * @returns {number} clamped value
   */
  function clamp(joint, action, direction, value) {
    var range = getRange(joint, action, direction);
    if (!range) return value;

    var absVal = Math.abs(value);
    var max = range[range.length - 1];
    if (absVal > max) {
      return Math.sign(value) * max;
    }
    return value;
  }

  /**
   * 检查是否在范围内
   */
  function isWithinRange(joint, action, direction, value) {
    var range = getRange(joint, action, direction);
    if (!range) return true; // 未知关节→允许通过
    return Math.abs(value) <= range[range.length - 1];
  }

  /**
   * MPL 骨骼名 → 解剖关节名 映射
   */
  var BONE_TO_JOINT = {
    neck: 'neck',
    head: 'headNeckCombined',
    upper_body: 'spine',
    upper_body2: 'spine',
    arm_r: 'shoulder',
    arm_l: 'shoulder',
    elbow_r: 'elbow',
    elbow_l: 'elbow',
    wrist_r: 'wrist',
    wrist_l: 'wrist',
    knee_r: 'knee',
    knee_l: 'knee',
    ankle_r: 'ankle',
    ankle_l: 'ankle',
  };

  /**
   * 通过 MPL 骨骼名获取解剖限制
   */
  function getJointForBone(mplBoneName) {
    return BONE_TO_JOINT[mplBoneName] || null;
  }

  /**
   * per-model 校准（将来实现）
   * 基于 PMX 骨骼朝向、比例调整范围
   */
  function calibratePerModel(modelProfile) {
    // TODO: Phase 8 - adjust ranges based on model scale and bone orientation
    return ANATOMY_LIMITS;
  }

  window.AnatomyLimits = {
    ANATOMY_LIMITS: ANATOMY_LIMITS,
    getRange: getRange,
    clamp: clamp,
    isWithinRange: isWithinRange,
    getJointForBone: getJointForBone,
    calibratePerModel: calibratePerModel,
  };
})();
