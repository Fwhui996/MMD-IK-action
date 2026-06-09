/**
 * Pose Targets — 语义目标 → MPL 骨骼指令求解器
 *
 * §3.7.4 Director Target To MPL Strategy.
 * 每个 goal 的 solver 返回可执行的 MPL pose deltas：
 *   { "bone": {"action": {"direction": value}} }
 *
 * 不再返回 {"_intent": "...", "_amount": 0.6}——那无法发射为 MPL。
 *
 * @module PoseTargets
 */
(function() {
  'use strict';

  var _solvers = {};

  // ── 幅度映射 ──
  var AMOUNT_FACTORS = { small: 0.35, medium: 0.65, large: 1.0 };

  function _factor(amount) {
    return AMOUNT_FACTORS[amount] || 0.5;
  }

  /**
   * 辅助：clamp 一个指令
   */
  function _cmd(bone, action, direction, value) {
    var cat = window.MPLCapabilityCatalog;
    if (!cat || !cat.isReady()) return value; // fallback 无法 clamp

    // 检查骨骼是否存在
    if (!cat.hasBone(bone)) {
      console.warn('[PoseTargets] bone not found in catalog: ' + bone);
      return value;
    }

    return cat.clampCommand(bone, action, direction, value);
  }

  /**
   * 辅助：检查骨骼/动作/方向是否合法
   */
  function _valid(bone, action, direction) {
    var cat = window.MPLCapabilityCatalog;
    if (!cat || !cat.isReady()) return true; // fallback：无法验证时默认通过
    return cat.isValidCommand(bone, action, direction, 1); // 测试值 1
  }

  // ═══════════════════════════════════════════
  // Goal Solvers
  // ═══════════════════════════════════════════

  /**
   * lower_body：蹲下
   *
   * 控制 center 下降 + 上半身微前倾（反平衡） + IK 支持。
   * 不 root-only 下沉：脚部 IK 保持在原地。
   */
  function _solveLowerBody(target, snapshot, profile) {
    var f = _factor(target.amount);
    var pose = {};

    // center 下降量（模型单位）
    var downVal = _cmd('center', 'move', 'down', Math.round(2 + f * 4));

    // 上半身微前倾（反平衡）
    var bendVal = _cmd('upper_body', 'bend', 'forward', Math.round(2 + f * 5));

    pose.center = { move: { down: downVal } };
    pose.upper_body = { bend: { forward: bendVal } };

    // IK 支撑
    _mergeInto(pose, _buildIKPose());

    return {
      pose: pose,
      usedCapabilities: ['center.move.down', 'upper_body.bend.forward'],
      assumptions: ['feet IK on ground', 'legs support crouch'],
      safetyRequirements: ['keep_foot_contact', 'no_root_only_crouch'],
    };
  }

  /**
   * rise_body：上升/站起
   */
  function _solveRiseBody(target, snapshot, profile) {
    var f = _factor(target.amount);

    var pose = {};
    pose.center = { move: { up: _cmd('center', 'move', 'up', Math.round(1 + f * 3)) } };
    pose.upper_body = { bend: { backward: _cmd('upper_body', 'bend', 'backward', Math.round(1 + f * 2)) } };

    _mergeInto(pose, _buildIKPose());

    return {
      pose: pose,
      usedCapabilities: ['center.move.up', 'upper_body.bend.backward'],
      assumptions: ['feet IK on ground'],
      safetyRequirements: ['keep_foot_contact'],
    };
  }

  /**
   * move_near_chest_outer：手靠近胸外侧
   *
   * 右手：大臂前举 + 肘弯曲 + 腕外摆（保持在胸外侧）。
   * 如果是 left_hand，对称使用左侧骨骼。
   */
  function _solveMoveNearChestOuter(target, snapshot, profile) {
    var f = _factor(target.amount);
    var side = _getSide(target.body);
    var pose = {};

    // arm bend forward + sway（肩前举 + 侧摆，保持在胸外侧）
    var swayDir = side === 'r' ? 'left' : 'right';
    pose[_bn('arm', side)] = {
      bend: { forward: _cmd(_bn('arm', side), 'bend', 'forward', Math.round(20 + f * 25)) },
      sway: _obj(swayDir, _cmd(_bn('arm', side), 'sway', swayDir, Math.round(10 + f * 15))),
    };

    // elbow bend forward（肘弯曲，手靠近身体）
    pose[_bn('elbow', side)] = {
      bend: { forward: _cmd(_bn('elbow', side), 'bend', 'forward', Math.round(45 + f * 35)) },
    };

    // wrist sway（腕向外摆，保持在胸外侧）
    if (_valid(_bn('wrist', side), 'sway', swayDir)) {
      pose[_bn('wrist', side)] = {
        sway: _obj(swayDir, _cmd(_bn('wrist', side), 'sway', swayDir, Math.round(5 + f * 12))),
      };
    }

    return {
      pose: pose,
      usedCapabilities: [
        _bn('arm', side) + '.bend.forward',
        _bn('elbow', side) + '.bend.forward',
        _bn('wrist', side) + '.sway.' + swayDir,
      ],
      assumptions: ['hand stays outside chest collision body'],
      safetyRequirements: ['avoid_hand_chest_collision', 'elbow_outside_torso'],
    };
  }

  /**
   * reach_forward：手前伸
   */
  function _solveReachForward(target, snapshot, profile) {
    var f = _factor(target.amount);
    var side = _getSide(target.body);
    var pose = {};

    // arm bend forward（肩前举）
    pose[_bn('arm', side)] = {
      bend: { forward: _cmd(_bn('arm', side), 'bend', 'forward', Math.round(40 + f * 40)) },
    };

    // elbow slight bend（肘微曲）
    pose[_bn('elbow', side)] = {
      bend: { forward: _cmd(_bn('elbow', side), 'bend', 'forward', Math.round(5 + f * 10)) },
    };

    // wrist微弯
    if (_valid(_bn('wrist', side), 'bend', 'forward')) {
      pose[_bn('wrist', side)] = {
        bend: { forward: _cmd(_bn('wrist', side), 'bend', 'forward', Math.round(5 + f * 8)) },
      };
    }

    return {
      pose: pose,
      usedCapabilities: [
        _bn('arm', side) + '.bend.forward',
        _bn('elbow', side) + '.bend.forward',
      ],
      assumptions: ['hand reaches forward of torso'],
      safetyRequirements: ['no_torso_collision'],
    };
  }

  /**
   * wave_near_head：手靠近头部外侧（挥手）
   */
  function _solveWaveNearHead(target, snapshot, profile) {
    var f = _factor(target.amount);
    var side = _getSide(target.body);
    var pose = {};

    // arm up + out
    pose[_bn('arm', side)] = {
      bend: { forward: _cmd(_bn('arm', side), 'bend', 'forward', Math.round(50 + f * 30)) },
      sway: _obj(side === 'r' ? 'left' : 'right', _cmd(_bn('arm', side), 'sway', side === 'r' ? 'left' : 'right', Math.round(10 + f * 15))),
    };

    pose[_bn('elbow', side)] = {
      bend: { forward: _cmd(_bn('elbow', side), 'bend', 'forward', Math.round(10 + f * 15)) },
    };

    return {
      pose: pose,
      usedCapabilities: [_bn('arm', side) + '.bend.forward', _bn('arm', side) + '.sway'],
      assumptions: ['hand stays outside head sphere'],
      safetyRequirements: ['avoid_hand_head_collision'],
    };
  }

  /**
   * tilt_down_slightly：轻微低头
   */
  function _solveTiltDownSlightly(target, snapshot, profile) {
    var f = _factor(target.amount);
    var pose = {};

    pose.neck = {
      bend: { forward: _cmd('neck', 'bend', 'forward', Math.round(8 + f * 18)) },
    };

    pose.head = {
      bend: { forward: _cmd('head', 'bend', 'forward', Math.round(5 + f * 12)) },
    };

    return {
      pose: pose,
      usedCapabilities: ['neck.bend.forward', 'head.bend.forward'],
      assumptions: ['head tilt is small amplitude'],
      safetyRequirements: ['avoid_hand_head_collision_when_hand_near'],
    };
  }

  /**
   * tilt_up_slightly：轻微抬头
   */
  function _solveTiltUpSlightly(target, snapshot, profile) {
    var f = _factor(target.amount);
    var pose = {};

    pose.neck = {
      bend: { backward: _cmd('neck', 'bend', 'backward', Math.round(5 + f * 15)) },
    };

    pose.head = {
      bend: { backward: _cmd('head', 'bend', 'backward', Math.round(3 + f * 10)) },
    };

    return {
      pose: pose,
      usedCapabilities: ['neck.bend.backward', 'head.bend.backward'],
      assumptions: ['head tilt is small amplitude'],
      safetyRequirements: [],
    };
  }

  /**
   * settle_smoothly：自然回稳
   *
   * 不强制回 rest pose。小微幅度过渡到稳定。
   * 实际上 emit 一个几乎为空的 pose（所有骨骼趋近当前值）。
   */
  function _solveSettleSmoothly(target, snapshot, profile) {
    var pose = _buildIKPose();
    return {
      pose: pose,
      usedCapabilities: [],
      assumptions: ['gentle settle, no hard reset'],
      safetyRequirements: ['preserve_current_pose_start', 'no_hard_cut_to_rest'],
    };
  }

  function _solveHoldPose(target, snapshot, profile) {
    var pose = _buildIKPose();
    return {
      pose: pose,
      usedCapabilities: [],
      assumptions: ['hold current pose'],
      safetyRequirements: [],
    };
  }

  /**
   * prepare_to_move：微小准备动作
   */
  function _solvePrepareToMove(target, snapshot, profile) {
    var f = _factor(target.amount) * 0.3; // prepare is always subtle
    var pose = {};

    // 根据 body 判断哪些骨骼需要微调
    var body = target.body || '';
    if (body.indexOf('arm') !== -1 || body.indexOf('hand') !== -1) {
      var side = _getSide(body);
      pose[_bn('arm', side)] = {
        bend: { forward: _cmd(_bn('arm', side), 'bend', 'forward', Math.round(f * 8)) },
      };
    }

    if (body === 'center' || body === 'full_body') {
      pose.center = {
        move: { down: _cmd('center', 'move', 'down', Math.round(f * 1.5)) },
      };
    }

    return {
      pose: pose,
      usedCapabilities: [],
      assumptions: ['subtle anticipation'],
      safetyRequirements: ['no_sudden_movement'],
    };
  }

  /**
   * continue_current_pose：从当前姿态继续
   */
  function _solveContinueCurrentPose(target, snapshot, profile) {
    var pose = _buildIKPose();
    return {
      pose: pose,
      usedCapabilities: [],
      assumptions: ['continue from current pose'],
      safetyRequirements: ['preserve_current_pose_start'],
    };
  }

  function _solveKeepFootContact(target, snapshot, profile) {
    var pose = _buildIKPose();
    return {
      pose: pose,
      usedCapabilities: ['leg_ik_l.move.up', 'leg_ik_r.move.up'],
      assumptions: ['feet IK on ground'],
      safetyRequirements: ['no_floor_penetration'],
    };
  }

  // ═══════════════════════════════════════════
  // 注册
  // ═══════════════════════════════════════════

  function registerSolver(goal, fn) {
    _solvers[goal] = fn;
  }

  registerSolver('lower_body', _solveLowerBody);
  registerSolver('rise_body', _solveRiseBody);
  registerSolver('move_near_chest_outer', _solveMoveNearChestOuter);
  registerSolver('reach_forward', _solveReachForward);
  registerSolver('wave_near_head', _solveWaveNearHead);
  registerSolver('tilt_down_slightly', _solveTiltDownSlightly);
  registerSolver('tilt_up_slightly', _solveTiltUpSlightly);
  registerSolver('settle_smoothly', _solveSettleSmoothly);
  registerSolver('hold_pose', _solveHoldPose);
  registerSolver('prepare_to_move', _solvePrepareToMove);
  registerSolver('continue_current_pose', _solveContinueCurrentPose);
  registerSolver('keep_foot_contact', _solveKeepFootContact);

  /**
   * 求解单个 target
   * @param {Object} target - { body, goal, amount, space, notes }
   * @param {Object} snapshot
   * @param {Object} profile
   * @returns {Object} { pose: {...}, usedCapabilities: [...], assumptions: [...], safetyRequirements: [...] }
   */
  function solveTarget(target, snapshot, profile) {
    var goal = target.goal || '';
    var solver = _solvers[goal];

    if (solver) {
      return solver(target, snapshot, profile);
    }

    if (goal) { console.warn('[PoseTargets] no solver for goal: ' + goal); }
    var fallbackPose = _buildIKPose();
    return { pose: fallbackPose, usedCapabilities: [], assumptions: ['fallback ik pose'], safetyRequirements: [] };
  }

  // ═══════════════════════════════════════════
  // 辅助
  // ═══════════════════════════════════════════

  function _getSide(body) {
    if (!body) return 'r';
    if (body.indexOf('left') !== -1 || body.indexOf('左') !== -1) return 'l';
    return 'r';
  }

  /**
   * MPL 骨骼命名: arm_r, elbow_l, wrist_r ...
   * prefix + '_' + side
   */
  function _bn(prefix, side) {
    return prefix + '_' + side;
  }

  /**
   * 构建 IK 支撑 pose
   */
  function _buildIKPose() {
    var pose = {};
    var defaultIK = {
      leg_ik_l: { action: 'move', direction: 'up', value: 0 },
      leg_ik_r: { action: 'move', direction: 'up', value: 0 },
      toe_ik_l: { action: 'move', direction: 'up', value: 0 },
      toe_ik_r: { action: 'move', direction: 'up', value: 0 },
    };

    var source = (window.MPLCapabilityCatalog && window.MPLCapabilityCatalog.IK_SUPPORT_BONES) || defaultIK;
    for (var boneName in source) {
      var ik = source[boneName];
      var val = ik.defaultValue !== undefined ? ik.defaultValue : ik.value;
      pose[boneName] = {};
      pose[boneName][ik.action] = {};
      pose[boneName][ik.action][ik.direction] = val;
    }
    return pose;
  }

  function _mergeInto(target, source) {
    for (var bone in source) {
      if (!source.hasOwnProperty(bone)) continue;
      target[bone] = source[bone];
    }
  }

  function _obj(key, val) {
    var o = {};
    o[key] = val;
    return o;
  }

  // ═══════════════════════════════════════════
  // 导出
  // ═══════════════════════════════════════════

  window.PoseTargets = {
    solveTarget: solveTarget,
    registerSolver: registerSolver,
  };
})();
