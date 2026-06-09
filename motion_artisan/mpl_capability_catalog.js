/**
 * MPL Capability Catalog — MPL 能力目录
 *
 * §3.7.3 Required Expert Knowledge.
 * 封装 WASM 编译器自省 + 静态约束 JSON。
 * 暴露 MotionArtisan 所需的骨骼/动作/方向/限制查询 API。
 *
 * 数据来源优先级：
 * 1. WASM 编译器（$.compiler）—— 运行时
 * 2. mpl_bone_constraints.json —— 静态 fallback
 * 3. 保守本地 fallback —— MVP 应急
 *
 * @module MPLCapabilityCatalog
 */
(function() {
  'use strict';

  var _catalog = null;       // { bone -> { actions -> { directions -> limit } } }
  var _ikBones = null;       // Set of IK bone names
  var _source = 'none';      // 'compiler' | 'constraints_json' | 'fallback'
  var _allBones = [];

  // ═══════════════════════════════════════════
  // 初始化
  // ═══════════════════════════════════════════

  /**
   * 初始化 catalog。
   * 优先从 WASM 编译器自省，其次用静态 JSON。
   * @param {Object} compiler - $.compiler (WasmMPLCompiler 实例)
   * @param {Object} staticConstraints - mpl_bone_constraints.json 的 groups
   */
  function init(compiler, staticConstraints) {
    // 方案 1: WASM 编译器自省
    if (compiler && typeof compiler.get_all_bones === 'function') {
      try {
        _catalog = _buildFromCompiler(compiler);
        _source = 'compiler';
        console.log('[MPLCatalog] loaded from compiler, ' + _allBones.length + ' bones');
        return true;
      } catch (e) {
        console.warn('[MPLCatalog] compiler introspection failed, trying static JSON:', e.message);
      }
    }

    // 方案 2: 静态 constraints JSON
    if (staticConstraints) {
      try {
        _catalog = _buildFromStaticJSON(staticConstraints);
        _source = 'constraints_json';
        console.log('[MPLCatalog] loaded from static JSON, ' + _allBones.length + ' bones');
        return true;
      } catch (e) {
        console.warn('[MPLCatalog] static JSON failed:', e.message);
      }
    }

    // 方案 3: 保守本地 fallback
    _catalog = _buildFallback();
    _source = 'fallback';
    console.warn('[MPLCatalog] using conservative fallback catalog');
    return false;
  }

  // ═══════════════════════════════════════════
  // 构建器
  // ═══════════════════════════════════════════

  function _buildFromCompiler(compiler) {
    var catalog = {};
    var ikSet = {};
    var bones;

    try {
      bones = compiler.get_all_bones();
    } catch (e) {
      bones = [];
    }

    for (var i = 0; i < bones.length; i++) {
      var bone = bones[i];
      var actions = _safeCall(compiler, 'get_bone_actions', [bone]) || [];
      var entry = {};

      for (var j = 0; j < actions.length; j++) {
        var action = actions[j];
        var directions = _safeCall(compiler, 'get_bone_directions', [bone, action]) || [];
        var dirEntry = {};

        for (var k = 0; k < directions.length; k++) {
          var dir = directions[k];
          var limit = _safeCall(compiler, 'get_bone_degree_limit', [bone, action, dir]);
          dirEntry[dir] = (limit !== undefined && limit !== null) ? limit : 180;
        }

        if (Object.keys(dirEntry).length > 0) {
          entry[action] = dirEntry;
        }
      }

      if (Object.keys(entry).length > 0) {
        catalog[bone] = entry;
      }

      // 判断是否为 IK 骨骼（只有 move 动作）
      if (entry.move && !entry.turn && !entry.bend && !entry.sway) {
        ikSet[bone] = true;
      }
    }

    _allBones = Object.keys(catalog);
    _ikBones = ikSet;
    return catalog;
  }

  function _buildFromStaticJSON(groups) {
    var catalog = {};
    var ikSet = {};

    for (var groupName in groups) {
      if (groupName === 'desc') continue;
      var group = groups[groupName];
      var bones = group.bones || {};

      for (var boneName in bones) {
        var boneDef = bones[boneName];
        catalog[boneName] = boneDef.actions || {};

        // IK 检测
        var acts = boneDef.actions || {};
        if (acts.move && !acts.turn && !acts.bend && !acts.sway) {
          ikSet[boneName] = true;
        }
      }
    }

    _allBones = Object.keys(catalog);
    _ikBones = ikSet;
    return catalog;
  }

  function _buildFallback() {
    // 最小保守 fallback：仅运动所需的核心骨骼
    var catalog = {
      center: {
        move: { up: 20, down: 20, left: 20, right: 20, forward: 20, backward: 20 },
        turn: { left: 180, right: 180 },
        bend: { forward: 180, backward: 180 },
        sway: { left: 180, right: 180 },
      },
      upper_body: {
        turn: { left: 90, right: 90 },
        bend: { forward: 90, backward: 90 },
        sway: { left: 90, right: 90 },
      },
      neck: {
        turn: { left: 90, right: 90 },
        bend: { forward: 60, backward: 90 },
        sway: { left: 60, right: 60 },
      },
      head: {
        turn: { left: 90, right: 90 },
        bend: { forward: 60, backward: 90 },
        sway: { left: 60, right: 60 },
      },
      arm_r: {
        turn: { left: 90, right: 90 },
        bend: { forward: 90, backward: 90 },
        sway: { left: 90, right: 90 },
      },
      arm_l: {
        turn: { left: 90, right: 90 },
        bend: { forward: 90, backward: 90 },
        sway: { left: 90, right: 90 },
      },
      elbow_r: { bend: { forward: 180 } },
      elbow_l: { bend: { forward: 180 } },
      wrist_r: {
        turn: { left: 90, right: 90 },
        bend: { forward: 60, backward: 90 },
        sway: { left: 90, right: 90 },
      },
      wrist_l: {
        turn: { left: 90, right: 90 },
        bend: { forward: 60, backward: 90 },
        sway: { left: 90, right: 90 },
      },
      leg_ik_l: { move: { up: 50, down: 50, left: 50, right: 50, forward: 50, backward: 50 } },
      leg_ik_r: { move: { up: 50, down: 50, left: 50, right: 50, forward: 50, backward: 50 } },
      toe_ik_l: { move: { up: 30, down: 30, left: 30, right: 30, forward: 30, backward: 30 } },
      toe_ik_r: { move: { up: 30, down: 30, left: 30, right: 30, forward: 30, backward: 30 } },
    };

    _allBones = Object.keys(catalog);
    _ikBones = {
      leg_ik_l: true, leg_ik_r: true,
      toe_ik_l: true, toe_ik_r: true,
    };
    return catalog;
  }

  // ═══════════════════════════════════════════
  // 公共 API
  // ═══════════════════════════════════════════

  function getAllBones() {
    return _allBones.slice();
  }

  function getActions(bone) {
    var entry = _catalog && _catalog[bone];
    return entry ? Object.keys(entry) : [];
  }

  function getDirections(bone, action) {
    var entry = _catalog && _catalog[bone];
    if (!entry || !entry[action]) return [];
    return Object.keys(entry[action]);
  }

  function getLimit(bone, action, direction) {
    var entry = _catalog && _catalog[bone];
    if (!entry || !entry[action]) return undefined;
    return entry[action][direction];
  }

  function isValidCommand(bone, action, direction, value) {
    var limit = getLimit(bone, action, direction);
    if (limit === undefined) return false;
    return Math.abs(value) <= limit;
  }

  function clampCommand(bone, action, direction, value) {
    var limit = getLimit(bone, action, direction);
    if (limit === undefined) return value;
    var clamped = Math.max(-limit, Math.min(limit, value));
    if (clamped !== value) {
      console.warn('[MPLCatalog] clamped ' + bone + '.' + action + '.' + direction +
        ': ' + value + ' → ' + clamped + ' (limit=' + limit + ')');
    }
    return clamped;
  }

  function isIKBone(bone) {
    return !!(_ikBones && _ikBones[bone]);
  }

  function hasBone(bone) {
    return !!(_catalog && _catalog[bone]);
  }

  function getSource() {
    return _source;
  }

  function isReady() {
    return _catalog !== null && _allBones.length > 0;
  }

  // ═══════════════════════════════════════════
  // 辅助
  // ═══════════════════════════════════════════

  function _safeCall(obj, methodName, args) {
    try {
      if (typeof obj[methodName] === 'function') {
        return obj[methodName].apply(obj, args);
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  // ═══════════════════════════════════════════
  // 语义骨骼映射（body → MPL bone names）
  // ═══════════════════════════════════════════

  /**
   * 将语义身体部位映射到 MPL 骨骼名列表
   */
  var BODY_TO_MPL_BONES = {
    head: ['head', 'neck'],
    center: ['center', 'upper_body'],
    right_arm: ['shoulder_r', 'arm_r', 'elbow_r', 'wrist_r'],
    left_arm: ['shoulder_l', 'arm_l', 'elbow_l', 'wrist_l'],
    both_arms: ['arm_r', 'elbow_r', 'wrist_r', 'arm_l', 'elbow_l', 'wrist_l'],
    right_hand: ['wrist_r', 'arm_r', 'elbow_r'],
    left_hand: ['wrist_l', 'arm_l', 'elbow_l'],
    full_body: ['center', 'upper_body', 'head', 'neck'],
  };

  /**
   * IK 支持骨骼（蹲下时需要）
   */
  var IK_SUPPORT_BONES = {
    leg_ik_l: { action: 'move', direction: 'up', defaultValue: 0 },
    leg_ik_r: { action: 'move', direction: 'up', defaultValue: 0 },
    toe_ik_l: { action: 'move', direction: 'up', defaultValue: 0 },
    toe_ik_r: { action: 'move', direction: 'up', defaultValue: 0 },
  };

  // ── 尝试自动初始化 ──
  function _autoInit() {
    if (isReady()) return;

    // 检查是否有全局 compiler
    var compiler = (window.$ && window.$.compiler) || null;

    // 检查是否有静态 JSON（通过 fetch 或内联）
    var staticJSON = null;
    // 尝试从全局变量获取（如果在 index.html 中内联了）
    if (window._MPL_BONE_CONSTRAINTS) {
      staticJSON = window._MPL_BONE_CONSTRAINTS.groups;
    }

    if (compiler || staticJSON) {
      init(compiler, staticJSON);
    } else {
      // 延迟初始化：等 compiler 可用
      init(null, null); // 使用 fallback
    }
  }

  // 延迟自动初始化
  setTimeout(_autoInit, 3000);

  // ═══════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════

  window.MPLCapabilityCatalog = {
    init: init,
    getAllBones: getAllBones,
    getActions: getActions,
    getDirections: getDirections,
    getLimit: getLimit,
    isValidCommand: isValidCommand,
    clampCommand: clampCommand,
    isIKBone: isIKBone,
    hasBone: hasBone,
    getSource: getSource,
    isReady: isReady,
    BODY_TO_MPL_BONES: BODY_TO_MPL_BONES,
    IK_SUPPORT_BONES: IK_SUPPORT_BONES,
  };
})();
