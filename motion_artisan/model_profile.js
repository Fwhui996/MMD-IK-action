/**
 * Model Profile — 提取模型结构信息
 *
 * §3.4. 从 PMX/MMD 模型数据提取骨骼和碰撞体。
 * 优先使用 PMXCollisionProfile.extractRigidBodies() 获取真实数据。
 * 仅在 PMX 数据不可用时使用 fallback。
 *
 * @module ModelProfile
 */
(function() {
  'use strict';

  /**
   * 提取模型结构 Profile
   * @param {Object} runtime — { THREE, model, helper }
   * @returns {Object} ModelCollisionProfile
   */
  function extractModelProfile(runtime) {
    var profile = {
      schema_version: '1.0',
      model_id: runtime.model ? (runtime.model.uuid || 'unknown') : 'unknown',
      bones: [],
      rigidBodies: [],
      semanticParts: {},
      fallbackCollisionBodiesUsed: false,
    };

    // ── 1. 尝试真实 PMX 刚体提取 ──
    if (window.PMXCollisionProfile && typeof window.PMXCollisionProfile.extractRigidBodies === 'function') {
      var rigidBodies = window.PMXCollisionProfile.extractRigidBodies(runtime);
      if (rigidBodies.length > 0) {
        profile.rigidBodies = rigidBodies;
        profile.fallbackCollisionBodiesUsed = false;
        console.log('[ModelProfile] extracted ' + rigidBodies.length + ' PMX rigid bodies');
      }
    }

    // ── 2. Fallback: 从骨骼推断碰撞体 ──
    if (profile.rigidBodies.length === 0) {
      profile.rigidBodies = _buildFallbackRigidBodies(runtime);
      profile.fallbackCollisionBodiesUsed = true;
      console.log('[ModelProfile] using fallback rigid bodies');
    }

    // ── 3. 骨骼列表 ──
    if (runtime.model && runtime.model.skeleton) {
      var bones = runtime.model.skeleton.bones;
      for (var i = 0; i < bones.length; i++) {
        profile.bones.push({
          index: i,
          name: bones[i].name,
          parentIndex: bones[i].parent ? bones[i].parent.index || -1 : -1,
        });
      }
    }

    // ── 4. 语义部位提取 ──
    if (window.PMXCollisionProfile && typeof window.PMXCollisionProfile.extractSemanticParts === 'function') {
      profile.semanticParts = window.PMXCollisionProfile.extractSemanticParts(profile.rigidBodies, profile.bones);
    } else {
      profile.semanticParts = _buildFallbackSemanticParts(profile);
    }

    return profile;
  }

  // ═══════════════════════════════════════════
  // Fallback
  // ═══════════════════════════════════════════

  function _buildFallbackRigidBodies(runtime) {
    var bodies = [];
    if (!runtime.model || !runtime.model.skeleton) return bodies;

    var bones = runtime.model.skeleton.bones;
    var bodyPartNames = ['上半身', '上半身2', '頭', '首', '右腕', '左腕', '右ひじ', '左ひじ', '右手首', '左手首', '右足', '左足', '右ひざ', '左ひざ', '右足首', '左足首'];

    for (var i = 0; i < bones.length; i++) {
      var name = bones[i].name;
      for (var j = 0; j < bodyPartNames.length; j++) {
        if (name === bodyPartNames[j]) {
          bodies.push({
            index: bodies.length,
            name: name,
            boneIndex: i,
            boneName: name,
            shape: 'box',
            shapeType: 1,
            size: [1.0, 1.0, 0.8],
            localPosition: [0, 0, 0],
            localRotation: [0, 0, 0],
            type: 0,
            group: 0,
            mask: 65535,
            typeName: 'bone_follow',
            kinematic: true,
          });
          break;
        }
      }
    }
    return bodies;
  }

  function _buildFallbackSemanticParts(profile) {
    var parts = {
      head: ['頭'],
      chest: ['上半身', '上半身2'],
      rightHand: ['右手首', '右手捩'],
      leftHand: ['左手首', '左手捩'],
      rightForearm: ['右ひじ'],
      leftForearm: ['左ひじ'],
      feet: ['左足', '右足'],
    };

    var result = {};
    for (var part in parts) {
      if (!parts.hasOwnProperty(part)) continue;
      result[part] = [];
      var keywords = parts[part];
      for (var i = 0; i < profile.rigidBodies.length; i++) {
        var rb = profile.rigidBodies[i];
        for (var k = 0; k < keywords.length; k++) {
          if ((rb.boneName || rb.name || '').indexOf(keywords[k]) >= 0) {
            result[part].push(rb);
            break;
          }
        }
      }
    }
    return result;
  }

  window.ModelProfile = {
    extractModelProfile: extractModelProfile,
  };
})();
