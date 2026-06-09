/**
 * PMX Collision Profile — 从 PMX 模型提取刚性碰撞体
 *
 * §4.1. 真实 PMX 刚体提取，不再是 fallback。
 * MMDLoader 在 geometry.userData.MMD.rigidBodies 中保留了完整 PMX 碰撞数据。
 *
 * 提取来源：
 *   $.model.children[i].geometry.userData.MMD.rigidBodies
 *
 * @module PMXCollisionProfile
 */
(function() {
  'use strict';

  /**
   * 从 runtime 中提取 PMX 刚体列表
   *
   * @param {Object} runtime — { THREE, model, helper }
   * @returns {Array} rigidBodies 列表
   */
  function extractRigidBodies(runtime) {
    if (!runtime || !runtime.model) return [];

    var bodies = [];
    var model = runtime.model;

    // 遍历所有 SkinnedMesh children
    model.traverse(function(child) {
      if (!child.isSkinnedMesh) return;
      if (!child.geometry || !child.geometry.userData) return;

      var mmdData = child.geometry.userData.MMD;
      if (!mmdData || !mmdData.rigidBodies) return;

      var srcBodies = mmdData.rigidBodies;
      var bones = mmdData.bones || [];

      for (var i = 0; i < srcBodies.length; i++) {
        var src = srcBodies[i];

        // 获取关联骨骼名
        var boneName = 'unknown';
        if (src.boneIndex !== undefined && src.boneIndex >= 0 && bones[src.boneIndex]) {
          boneName = bones[src.boneIndex].name || ('bone_' + src.boneIndex);
        }

        bodies.push({
          index: i,
          name: src.name || ('rigidBody_' + i),
          boneIndex: src.boneIndex,
          boneName: boneName,
          shape: _shapeName(src.shape),
          shapeType: src.shape,
          size: src.size ? src.size.slice(0) : [1, 1, 1],
          localPosition: src.position ? src.position.slice(0) : [0, 0, 0],
          localRotation: src.rotation ? src.rotation.slice(0) : [0, 0, 0],
          type: src.type, // 0=bone_follow, 1=physics, 2=physics+bone_aligned
          group: src.group || 0,
          mask: src.mask || 65535,
          typeName: _typeName(src.type),
          mass: src.mass || 1,
          linearDamping: src.linearDamping || 0,
          angularDamping: src.angularDamping || 0,
          restitution: src.restitution || 0,
          friction: src.friction || 0.5,
          kinematic: src.type === 0,
        });
      }
    });

    return bodies;
  }

  /**
   * 提取语义部位映射（基于 PMX 刚体和骨骼名）
   *
   * @param {Array} rigidBodies — 从 extractRigidBodies 获取
   * @param {Array} snapshotBones — 当前姿态骨骼列表（用于名称匹配）
   * @returns {Object} semanticParts: { head: [...], chest: [...], rightHand: [...], ... }
   */
  function extractSemanticParts(rigidBodies, snapshotBones) {
    var parts = {
      head: [],
      neck: [],
      chest: [],
      rightUpperArm: [],
      leftUpperArm: [],
      rightForearm: [],
      leftForearm: [],
      rightHand: [],
      leftHand: [],
      rightThigh: [],
      leftThigh: [],
      rightShin: [],
      leftShin: [],
      feet: [],
    };

    // 日语/中文/英文关键词映射
    var mappings = {
      head: ['頭', 'head', 'あたま'],
      neck: ['首', 'neck', 'くび'],
      chest: ['上半身', '胸', 'chest', '上半身2', '胸上', '胸下'],
      rightUpperArm: ['右腕', '右上腕', '右肩', 'arm_r', 'right_upper_arm', '右腕捩'],
      leftUpperArm: ['左腕', '左上腕', '左肩', 'arm_l', 'left_upper_arm', '左腕捩'],
      rightForearm: ['右ひじ', '右肘', 'elbow_r', 'right_forearm', '右前腕'],
      leftForearm: ['左ひじ', '左肘', 'elbow_l', 'left_forearm', '左前腕'],
      rightHand: ['右手首', '右手', 'wrist_r', 'right_hand', '右指', '右手捩'],
      leftHand: ['左手首', '左手', 'wrist_l', 'left_hand', '左指', '左手捩'],
      rightThigh: ['右足', '右大腿', 'right_thigh', 'leg_r'],
      leftThigh: ['左足', '左大腿', 'left_thigh', 'leg_l'],
      rightShin: ['右ひざ', '右膝', 'knee_r', 'right_shin', '右下腿'],
      leftShin: ['左ひざ', '左膝', 'knee_l', 'left_shin', '左下腿'],
      feet: ['右足首', '左足首', '右つま先', '左つま先', 'ankle_r', 'ankle_l', 'toe_r', 'toe_l', '右足Ｄ', '左足Ｄ', '右足先', '左足先'],
    };

    for (var i = 0; i < rigidBodies.length; i++) {
      var rb = rigidBodies[i];
      var name = rb.boneName || rb.name || '';

      for (var part in mappings) {
        if (!mappings.hasOwnProperty(part)) continue;
        var keywords = mappings[part];
        for (var k = 0; k < keywords.length; k++) {
          if (name.indexOf(keywords[k]) >= 0) {
            parts[part].push(rb);
            break;
          }
        }
      }
    }

    return parts;
  }

  /**
   * 检查是否成功提取了真实 PMX 数据（而非 fallback）
   */
  function hasRealPMXData(profile) {
    return profile && profile.rigidBodies && profile.rigidBodies.length > 0;
  }

  // ═══════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════

  function _shapeName(shape) {
    switch (shape) {
      case 0: return 'sphere';
      case 1: return 'box';
      case 2: return 'capsule';
      default: return 'unknown';
    }
  }

  function _typeName(type) {
    switch (type) {
      case 0: return 'bone_follow';
      case 1: return 'physics';
      case 2: return 'physics_bone_aligned';
      default: return 'unknown';
    }
  }

  // ═══════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════

  window.PMXCollisionProfile = {
    extractRigidBodies: extractRigidBodies,
    extractSemanticParts: extractSemanticParts,
    hasRealPMXData: hasRealPMXData,
  };
})();
