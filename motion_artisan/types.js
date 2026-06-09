/**
 * MotionArtisan Types — 类型定义和常量
 *
 * MotionArtisan 是前端确定性动画程序。
 * 它读取当前 MMD 模型姿态、PMX 刚体数据和 MotionIntentPlan，
 * 求解安全、平滑的骨骼关键帧，发射 MPL 给编译器播放。
 *
 * @module MotionArtisanTypes
 */
(function() {
  'use strict';

  /**
   * 允许的 goal 词汇表 — 与后端 ALLOWED_GOALS 保持一致
   */
  const ALLOWED_GOALS = Object.freeze([
    'continue_current_pose',
    'prepare_to_move',
    'lower_body',
    'rise_body',
    'keep_foot_contact',
    'move_near_chest_outer',
    'reach_forward',
    'wave_near_head',
    'tilt_down_slightly',
    'tilt_up_slightly',
    'settle_smoothly',
    'hold_pose',
  ]);

  /**
   * 目标身体部位 → 骨骼名映射（语义部位 → 实际骨骼列表）
   */
  const BODY_TO_BONES = {
    'head': ['頭', '首'],
    'center': ['センター', '上半身', '下半身'],
    'right_arm': ['右腕', '右ひじ', '右手首'],
    'left_arm': ['左腕', '左ひじ', '左手首'],
    'both_arms': ['右腕', '左腕', '右ひじ', '左ひじ', '右手首', '左手首'],
    'right_hand': ['右手首', '右中指１'],
    'left_hand': ['左手首', '左中指１'],
    'full_body': ['全ての親', 'センター', '上半身', '下半身'],
    'right_leg': ['右足', '右ひざ', '右足首'],
    'left_leg': ['左足', '左ひざ', '左足首'],
  };

  /**
   * MotionArtisan 结果对象
   * @typedef {Object} MotionArtisanResult
   * @property {boolean} ok
   * @property {string} source - "motion_artisan"
   * @property {string|null} mplCode
   * @property {number} selectedCandidate
   * @property {Object} score
   * @property {Object} report
   */

  /**
   * CurrentPoseSnapshot
   * @typedef {Object} CurrentPoseSnapshot
   * @property {string} schema_version
   * @property {number} timestamp
   * @property {string} model_id
   * @property {Array<Object>} bones
   */

  window.MotionArtisanTypes = {
    ALLOWED_GOALS,
    BODY_TO_BONES,
  };
})();
