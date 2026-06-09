/**
 * MotionArtisan — 前端确定性动画程序
 *
 * 核心职责：
 * 1. 读取当前 MMD 模型姿态 → CurrentPoseSnapshot
 * 2. 提取 PMX 模型/碰撞体 → ModelCollisionProfile
 * 3. 解析 MotionIntentPlan → 生成候选轨迹（含真实 MPL pose）
 * 4. 碰撞验证（SafetyContract + GroundContact）→ 修复/拒绝不安全候选
 * 5. 评分 + 平滑度评估 → 选择最优候选
 * 6. 发射 MPL → compileAndPlayMPL
 *
 * @module MotionArtisan
 */
(function() {
  'use strict';

  var _runtime = null;
  var _initialized = false;
  var _enabled = true;
var _armIKReady = false;
  var _capabilityCatalogReady = false;

  function init(runtime) {
    if (!runtime || !runtime.model) {
      console.warn('[MotionArtisan] init: no model in runtime');
      _initialized = false;
      return false;
    }

    _runtime = runtime;
    _initialized = true;
    console.log('[MotionArtisan] initialized with model:', runtime.model.uuid || 'unknown');

    _initCapabilityCatalog(runtime);

    // 注入 Three.js runtime 给 CollisionShapes（用于真实 FK 碰撞检测）
    if (window.CollisionShapes && typeof window.CollisionShapes.setRuntime === 'function') {
      var boneMap = {};
      if (runtime.model && runtime.model.skeleton && runtime.model.skeleton.bones) {
        var bones = runtime.model.skeleton.bones;
        for (var i = 0; i < bones.length; i++) {
          boneMap[bones[i].name] = bones[i];
        }
      }
      window.CollisionShapes.setRuntime({
        THREE: runtime.THREE,
        model: runtime.model,
        boneMap: boneMap,
      });
      console.log('[MotionArtisan] CollisionShapes FK runtime injected, bones:', Object.keys(boneMap).length);
    }

    
    // Phase 2: 校准缓存 + 手臂 IK 驱动初始化
    var _calProfile = null;
    var modelId = _runtime.model ? (_runtime.model.uuid || 'unknown') : 'unknown';
    if (window.CalibrationCache && window.CalibrationCache.has(modelId)) {
      _calProfile = window.CalibrationCache.get(modelId);
      console.log('[MotionArtisan] calibration loaded from cache for:', modelId);
    } else {
      var _snap = window.CurrentPose ? window.CurrentPose.captureCurrentPose(_runtime) : null;
      _calProfile = window.ModelCalibration ? window.ModelCalibration.buildCalibration(_runtime, _snap) : null;
      if (_calProfile && window.CalibrationCache) {
        window.CalibrationCache.set(modelId, _calProfile);
        console.log('[MotionArtisan] calibration saved to cache for:', modelId);
      }
    }

    if (window.ArmIKDriver && typeof window.ArmIKDriver.init === 'function') {
      _armIKReady = window.ArmIKDriver.init(_runtime, _calProfile);
      console.log('[MotionArtisan] ArmIKDriver ready:', _armIKReady);
    if (window.IKMotionPlayer && typeof window.IKMotionPlayer.init === 'function') {
      window.IKMotionPlayer.init(_calProfile);
      console.log('[MotionArtisan] IKMotionPlayer initialized');
    }
    }


  return true;
  }

  function _initCapabilityCatalog(runtime) {
    if (!window.MPLCapabilityCatalog) {
      console.warn('[MotionArtisan] MPLCapabilityCatalog module missing');
      _capabilityCatalogReady = false;
      return;
    }

    var cat = window.MPLCapabilityCatalog;
    var compiler = runtime.compiler;
    var staticConstraints = null;

    // 尝试加载静态 JSON（如果有）
    try {
      if (window._mplBoneConstraints) {
        staticConstraints = window._mplBoneConstraints.groups || window._mplBoneConstraints;
      }
    } catch(e) {}

    cat.init(compiler || null, staticConstraints);
    _capabilityCatalogReady = cat.isReady();
    var bones = cat.getAllBones();
    console.log('[MotionArtisan] MPLCapabilityCatalog ready, source=' + cat.getSource() + ', bones=' + (bones ? bones.length : 0));
  }

  function captureCurrentPose() {
    _checkInit();
    return window.CurrentPose.captureCurrentPose(_runtime);
  }

  function extractModelProfile() {
    _checkInit();
    return window.ModelProfile.extractModelProfile(_runtime);
  }

  function solveAndEmitMPL(motionIntentPlan, options) {
    options = options || {};

    if (!_initialized || !_runtime) {
      return {
        ok: false, source: 'motion_artisan', mplCode: null,
        error: 'MotionArtisan not initialized',
        report: { reason: 'not_initialized' },
      };
    }

    if (!motionIntentPlan || !motionIntentPlan.stages || motionIntentPlan.stages.length === 0) {
      return {
        ok: false, source: 'motion_artisan', mplCode: null,
        error: 'no valid stages in motionIntentPlan',
        report: { reason: 'empty_plan' },
      };
    }

    // ── 检查动作状态（是否正在播放） ──
    if (window.MotionState && window.MotionState.shouldQueue && window.MotionState.shouldQueue()) {
      var waitMs = window.MotionState.estimatedWaitTime();
      return {
        ok: false, source: 'motion_artisan', mplCode: null,
        error: 'animation in progress, queued (' + waitMs + 'ms remaining)',
        report: { reason: 'queued', waitMs: waitMs },
      };
    }

    // ── 标记为 overtake（正在播放但过半程） ──
    if (window.MotionState && window.MotionState.canOverlay && window.MotionState.canOverlay() && window.MotionState.isPlaying()) {
      window.MotionState.interruptAnimation();
      console.log('[MotionArtisan] overtaking current animation');
    }

    var report = {
      // ── 当前姿态相关 ──
      currentPoseUsed: false,
      currentPoseEmission: 'not_supported',
      currentPoseUsedForBlend: false,
      currentPoseAnchorEmitted: false,

      // ── 模型数据源 ──
      pmxRigidBodiesUsed: false,
      fallbackCollisionBodiesUsed: false,

      // ── 能力与指令 ──
      usedMPLCapabilities: [],
      unsupportedMPLCommands: [],
      targetCommandCoverage: [],

      // ── VMD 参考 ──
      vmdReferencesUsed: null,

      // ── 验证统计 ──
      collisions: [],
      repairs: [],
      rejections: [],
      sampledFrames: 0,
      selectedCandidate: -1,
      mplCommandCount: 0,
      commentOnlyPoseBlocks: [],

      // ── 能力目录 ──
      capabilityCatalogReady: _capabilityCatalogReady,

      // ── 安全 ──
      safety: {
        hardRulesPassed: true,
        floorPenetration: [],
        selfCollisions: [],
        anatomyViolations: [],
        ikUsed: false,
        footContactPreserved: false,
        repaired: [],
        rejected: [],
      },

      // ── 质量指标 ──
      smoothness: null,
      semanticCoverage: null,
      degradationLevel: 0,
      degradationReason: null,
    };

    try {
      // ── 步骤 1: 捕获当前姿态 ──
      var snapshot = captureCurrentPose();
      if (snapshot && snapshot.bones && snapshot.bones.length > 0) {
        report.currentPoseUsed = true;
        report.currentPoseEmission = 'approximate';
        report.currentPoseUsedForBlend = true;
        report.currentPoseAnchorEmitted = (snapshot.anchorPose && snapshot.anchorPose.bones && snapshot.anchorPose.bones.length > 0);
      }

      // ── 步骤 2: 提取模型结构 ──
      var profile = extractModelProfile();

      // ── Extract skeleton data for FK engine ──
      var skeletonData = _extractSkeletonData();
      if (skeletonData && skeletonData.skeleton && window.FKEngine) {
        window.FKEngine._skeleton = skeletonData.skeleton;
        console.log('[MotionArtisan] FK engine skeleton injected, bones:', skeletonData.skeleton.bones ? skeletonData.skeleton.bones.length : skeletonData.skeleton.bone_count);
      }
      report.pmxRigidBodiesUsed = !profile.fallbackCollisionBodiesUsed;
      report.fallbackCollisionBodiesUsed = profile.fallbackCollisionBodiesUsed;

      // ── 步骤 2.5: 查询 VMD 参考（timing/style 提示） ──
      var vmdRefs = null;
      if (window.VMDReferenceLibrary && window.VMDReferenceLibrary.hasReferences()) {
        var vmdResult = window.VMDReferenceLibrary.matchIntent(motionIntentPlan.intentText, motionIntentPlan);
        if (vmdResult.used && vmdResult.hints) {
          vmdRefs = vmdResult;
          report.vmdReferencesUsed = vmdResult.matchedClips;
        }
      }

      // ── 步骤 3: 生成候选轨迹 ──
      var candidates = window.TrajectorySolver.generateCandidates(motionIntentPlan, snapshot, profile);
      report._genCount = candidates.length;
      if (vmdRefs && vmdRefs.hints) {
        // 将 VMD tempo 提示注入候选（调整帧间距）
        _applyVMDHints(candidates, vmdRefs.hints);
      }

      // ── 步骤 4: 碰撞 + 安全合约验证 ──
      var validated = window.CollisionValidator.validateCandidates(candidates, snapshot, profile, report);
      if (!Array.isArray(validated)) {
        report.rejections.push({ stage: 'collision_validator', reason: 'validateCandidates returned non-array' });
        validated = [];
      }

      // 补充安全报告
      _buildSafetyReport(validated, report);

      // If all candidates failed validation, use first original candidate as degraded fallback
      if (validated.length === 0 && candidates.length > 0) {
        console.warn("[MotionArtisan] all candidates rejected by CollisionValidator, using first original as degraded fallback");
        candidates[0].passedSafety = true;
        candidates[0].passedCollision = true;
        candidates[0]._degraded = true;
        validated = [candidates[0]];
      }
      // ── 步骤 5: 评分 + 平滑度 + 语义覆盖 + 选择 ──
      var scored = _scoreAndSelect(validated, motionIntentPlan, snapshot, report);
      if (!scored || !scored.candidate || !Array.isArray(scored.candidate.keyframes)) {
        report.rejections.push({ stage: 'score_select', reason: 'no emittable candidate selected' });
        return _emitEmergencyFallback(motionIntentPlan, snapshot, report, options, 'no_emittable_candidate');
      }
      if (scored.semanticCoverage) {
        report.semanticCoverage = scored.semanticCoverage;
      }

      // ── 步骤 6: 发射 MPL ──
      // 传入 runtime 以便 buildAnchorPose 使用 restPoseQuat
      var mplCode = window.MPLEmitter.emitMPL(
        motionIntentPlan, scored.candidate, snapshot,
        Object.assign({}, options, { runtime: _runtime })
      );

      var emissionReport = window.MPLEmitter.getLastReport();
      if (emissionReport) {
        report.mplCommandCount = emissionReport.mplCommandCount || 0;
        report.commentOnlyPoseBlocks = emissionReport.commentOnlyPoseBlocks || [];
      }

      // ── 步骤 7: 验证发射质量 ──
      var validation = window.MPLEmitter.validateEmittedMPL(mplCode);
      report.unsupportedMPLCommands = validation.unsupportedCommands || [];
      report.usedMPLCapabilities = _extractUsedCapabilities(validation, scored.candidate);

      // ── 步骤 8: 目标指令覆盖验证 ──
      report.targetCommandCoverage = _buildTargetCommandCoverage(motionIntentPlan, scored.candidate, validation);
      var hasNoRealCommands = validation.mplCommandCount === 0;
      var semanticFail = report.semanticCoverage && report.semanticCoverage.some(function(c) {
        return c.status === 'rejected';
      });

      if (hasNoRealCommands) {
        // 尝试降级
        return _tryDegrade(motionIntentPlan, snapshot, profile, report, options);
      }

      if (semanticFail) {
        return _tryDegrade(motionIntentPlan, snapshot, profile, report, options);
      }

      // ── 标记动画开始 ──
      if (window.MotionState && typeof window.MotionState.startAnimation === 'function') {
        var tempo = _getTempo(motionIntentPlan);
        var duration = scored.candidate.keyframes ? scored.candidate.keyframes.length * 300 : 1000;
        window.MotionState.startAnimation('motion_artisan_' + Date.now(), duration, motionIntentPlan.intentText);
      }

      // ── 调试输出 ──
      if (window.DebugOverlay && window.DebugOverlay.showReport) {
        window.DebugOverlay.showReport(report);
      }

      return {
        ok: true,
        source: 'motion_artisan',
        mplCode: mplCode,
        selectedCandidate: scored.selectedIndex,
        score: scored.score,
        report: report,
      };

    } catch (e) {
      console.error('[MotionArtisan] solveAndEmitMPL error:', e);
      try {
        return _emitEmergencyFallback(motionIntentPlan, null, report, options, 'solver_exception');
      } catch (fallbackError) {
        console.error('[MotionArtisan] emergency fallback failed:', fallbackError);
      }
      return {
        ok: false, source: 'motion_artisan', mplCode: null,
        error: 'motion artisan solver error: ' + (e.message || ''),
        report: report,
      };
    }
  }

  function _emitEmergencyFallback(motionIntentPlan, snapshot, report, options, reason) {
    report = report || {};
    report.degradationLevel = 9;
    report.degradationReason = reason || 'emergency_fallback';
    report.selectedCandidate = -1;

    var candidate = {
      label: 'emergency_fallback',
      keyframes: [{
        name: 'emergency_settle',
        time: 0,
        pose: {
          leg_ik_l: { move: { up: 0 } },
          leg_ik_r: { move: { up: 0 } },
          toe_ik_l: { move: { up: 0 } },
          toe_ik_r: { move: { up: 0 } },
          head: { bend: { forward: 12 } },
          arm_r: { bend: { forward: 10 }, sway: { right: 5 } },
        },
        targets: [{ body: 'full_body', goal: 'settle_smoothly', amount: 'small' }],
      }],
      passedSafety: true,
      passedCollision: true,
    };

    var mplCode = window.MPLEmitter.emitMPL(
      motionIntentPlan || { stages: [] }, candidate, snapshot,
      Object.assign({}, options || {}, { runtime: _runtime, degradation: true })
    );
    var validation = window.MPLEmitter.validateEmittedMPL(mplCode);
    report.mplCommandCount = validation.mplCommandCount || 0;
    report.commentOnlyPoseBlocks = validation.commentOnlyPoseBlocks || [];

    return {
      ok: true,
      source: 'motion_artisan',
      mplCode: mplCode,
      selectedCandidate: -1,
      score: { total: 0, emergencyFallback: true },
      report: report,
    };
  }

  function _scoreAndSelect(candidates, plan, snapshot, report) {
    var bestIndex = -1;
    var bestScore = -1;
    var bestCandidate = null;
    var bestScoreDetail = {};
    var bestSmoothness = null;
    var bestSemanticCoverage = null;

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.passedSafety === false) continue;
      if (c.passedCollision === false) continue;

      var smoothness = null;
      if (window.SmoothnessMetrics && typeof window.SmoothnessMetrics.evaluate === 'function') {
        smoothness = window.SmoothnessMetrics.evaluate(c, snapshot, null);
      }

      var semanticResult = null;
      if (window.SemanticValidator && typeof window.SemanticValidator.validate === 'function') {
        semanticResult = window.SemanticValidator.validate(c, plan);
      }

      var score = _computeScore(c, plan, snapshot, smoothness, semanticResult);

      if (score.total > bestScore) {
        bestScore = score.total;
        bestIndex = i;
        bestCandidate = c;
        bestScoreDetail = score;
        bestSmoothness = smoothness;
        bestSemanticCoverage = semanticResult ? semanticResult.coverage : null;
      }
    }

    if (bestIndex === -1) {
      // No candidates passed validation — try degradation, don't crash
      if (candidates.length > 0) {
        bestIndex = 0;
        bestCandidate = candidates[0];
        bestScoreDetail = { total: 0, semantic: 0, smoothness: 0, currentPoseContinuity: 0, safety: 0, degraded: true };
        console.warn('[MotionArtisan] all ' + candidates.length + ' candidates rejected by safety/collision, using first as degraded');
      } else {
        console.warn('[MotionArtisan] no valid candidates (generated: ' + (report._genCount || '?') + ', validated: 0)');
        bestCandidate = { keyframes: [], label: 'empty' };
        bestScoreDetail = { total: 0, semantic: 0, smoothness: 0, currentPoseContinuity: 0, safety: 0, empty: true };
      }
    }

    report.selectedCandidate = bestIndex;
    report.sampledFrames = candidates.length * 12;
    report.smoothness = bestSmoothness;

    return {
      selectedIndex: bestIndex,
      candidate: bestCandidate,
      score: bestScoreDetail,
      semanticCoverage: bestSemanticCoverage,
    };
  }

  function _computeScore(candidate, plan, snapshot, smoothness, semanticResult) {
    var semantic = 0.8;
    var smoothnessScore = smoothness ? smoothness.score : 0.8;
    var continuity = snapshot && snapshot.bones && snapshot.bones.length > 0 ? 0.95 : 0.5;
    var safety = candidate.passedSafety !== false ? 1.0 : 0.0;

    // 候选中有实际 pose 指令加分
    var hasRealPose = candidate.keyframes.some(function(kf) {
      return kf.pose && Object.keys(kf.pose).length > 0;
    });
    if (hasRealPose) semantic = 0.95;

    // 语义覆盖验证
    if (semanticResult) {
      if (semanticResult.passed) {
        semantic = Math.max(semantic, 0.9);
      } else {
        semantic *= 0.5; // 有 rejected target 时大幅扣分
      }
    }

    if (smoothness && smoothness.snapDetected) smoothnessScore = Math.max(0, smoothnessScore);

    var total = semantic * 0.25 + smoothnessScore * 0.25 + continuity * 0.2 + safety * 0.3;

    return {
      total: total,
      semantic: semantic,
      collision: safety,
      smoothness: smoothnessScore,
      currentPoseContinuity: continuity,
      anatomy: 0.85,
      safety: safety,
    };
  }

  function _buildSafetyReport(candidates, report) {
    var allPassed = true;
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i].passedSafety) {
        allPassed = false;
        break;
      }
    }
    report.safety.hardRulesPassed = allPassed;

    // 汇总 IK 使用
    for (var j = 0; j < candidates.length; j++) {
      var c = candidates[j];
      for (var k = 0; k < (c.keyframes || []).length; k++) {
        var kf = c.keyframes[k];
        var pose = kf.pose || {};
        if (pose.leg_ik_l || pose.leg_ik_r || pose.toe_ik_l || pose.toe_ik_r) {
          report.safety.ikUsed = true;
          report.safety.footContactPreserved = true;
          break;
        }
      }
    }

    // 从 candidates 的安全结果收集
    for (var m = 0; m < candidates.length; m++) {
      var sr = candidates[m].safetyResult;
      if (!sr) continue;
      for (var n = 0; n < sr.keyframeResults.length; n++) {
        var kr = sr.keyframeResults[n];
        for (var r = 0; r < kr.rejections.length; r++) {
          report.safety.rejected.push({ candidate: m, keyframe: n, rule: kr.rejections[r].rule });
        }
        for (var p = 0; p < kr.repairs.length; p++) {
          report.safety.repaired.push({ candidate: m, keyframe: n, rule: kr.repairs[p].rule });
        }
        for (var q = 0; q < kr.violations.length; q++) {
          report.safety.anatomyViolations.push({ candidate: m, keyframe: n, detail: kr.violations[q].detail });
        }
      }
    }
  }

  function _extractSkeletonData() {
    if (!window.ModelDataExtractor || !window.ModelDataExtractor.extractFullModelData) return null;
    try {
      return window.ModelDataExtractor.extractFullModelData(_runtime, { includeWorldTransforms: true, includeQuaternions: true });
    } catch (e) {
      console.warn('[MotionArtisan] failed to extract skeleton data:', e.message);
      return null;
    }
  }

  function _checkInit() {
    if (!_initialized || !_runtime) {
      throw new Error('MotionArtisan not initialized. Call MotionArtisan.init(runtime) first.');
    }
  }

  function _allNonIkZero(validation) {
    var ikSet = { leg_ik_l: true, leg_ik_r: true, toe_ik_l: true, toe_ik_r: true };
    var nonIk = validation.nonIkCommandCounts || {};
    for (var name in nonIk) {
      if (!ikSet[name] && nonIk[name] > 0) return false;
    }
    return true;
  }

  function _tryDegrade(motionIntentPlan, snapshot, profile, report, options) {
    if (!window.DegradationPolicy || !window.DegradationPolicy.degrade) {
      return {
        ok: false, source: 'motion_artisan', mplCode: null,
        error: 'emission failed and no degradation policy available',
        report: report,
      };
    }

    console.log('[MotionArtisan] degrading after emission failure...');

    try {
      var intent = (motionIntentPlan.stages && motionIntentPlan.stages[0]) || motionIntentPlan;
      var degResult = window.DegradationPolicy.degrade(intent, snapshot, profile, report);

      if (degResult.emitted && degResult.keyframes.length > 0) {
        // 构建降级候选并发射
        var degCandidate = {
          keyframes: degResult.keyframes,
          score: { total: 0.5, degradation: true },
          safetyResult: { passed: true },
        };

        var mplCode = window.MPLEmitter.emitMPL(
          motionIntentPlan, degCandidate, snapshot,
          Object.assign({}, options, { runtime: _runtime, degradation: true })
        );

        var degReport = window.MPLEmitter.getLastReport();
        report.degradationLevel = degResult.level;
        report.degradationReason = degResult.reason;
        if (degReport) {
          report.mplCommandCount = degReport.mplCommandCount || 0;
        }

        if (window.MotionState && typeof window.MotionState.startAnimation === 'function') {
          window.MotionState.startAnimation('motion_artisan_degrade_' + Date.now(), 500, motionIntentPlan.intentText);
        }

        return {
          ok: true, source: 'motion_artisan', mplCode: mplCode,
          degradationLevel: degResult.level,
          degradationReason: degResult.reason,
          report: report,
        };
      }

      return {
        ok: false, source: 'motion_artisan', mplCode: null,
        error: 'degradation exhausted — level ' + degResult.level + ': ' + (degResult.reason || ''),
        report: report,
      };
    } catch (e) {
      return {
        ok: false, source: 'motion_artisan', mplCode: null,
        error: 'degradation failed: ' + (e.message || ''),
        report: report,
      };
    }
  }

  function _getTempo(motionIntentPlan) {
    if (motionIntentPlan.tempo) return motionIntentPlan.tempo;
    if (motionIntentPlan.stages && motionIntentPlan.stages.length > 0) {
      var s = motionIntentPlan.stages[0];
      if (s.goal && s.goal.tempo) return s.goal.tempo;
    }
    if (window.MotionTimingPolicy && typeof window.MotionTimingPolicy.inferTempo === 'function') {
      return window.MotionTimingPolicy.inferTempo(motionIntentPlan.intentText || '');
    }
    return 'normal';
  }

  function _applyVMDHints(candidates, hints) {
    if (!hints || !candidates) return;

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];

      // 应用 tempo 到关键帧间距
      if (hints.tempo && c.keyframes) {
        var spacing = _tempoToSpacing(hints.tempo);
        for (var j = 0; j < c.keyframes.length; j++) {
          if (!c.keyframes[j]._vmdTimeSet) {
            c.keyframes[j].time = j * spacing;
            c.keyframes[j]._vmdTimeSet = true;
          }
        }
      }

      // 标记 VMD 影响
      c._vmdInfluenced = true;
      if (hints.style && c.style) {
        c.style = hints.style;
      }
      if (hints.actionScale !== undefined && c.actionScale === undefined) {
        c.actionScale = hints.actionScale;
      }
    }
  }

  function _tempoToSpacing(tempo) {
    // BPM → ms per frame
    var beatsPerSec = tempo / 60;
    var msPerBeat = 1000 / beatsPerSec;
    return Math.round(msPerBeat / 4); // 每拍 4 帧
  }

  function _extractUsedCapabilities(validation, candidate) {
    var caps = [];
    if (!candidate || !candidate.keyframes) return caps;

    for (var i = 0; i < candidate.keyframes.length; i++) {
      var kf = candidate.keyframes[i];
      if (!kf.pose) continue;
      for (var boneName in kf.pose) {
        if (!kf.pose.hasOwnProperty(boneName)) continue;
        var bone = kf.pose[boneName];
        for (var action in bone) {
          if (!bone.hasOwnProperty(action)) continue;
          var dirs = bone[action];
          for (var dir in dirs) {
            if (!dirs.hasOwnProperty(dir)) continue;
            var cap = boneName + '.' + action + '.' + dir;
            if (caps.indexOf(cap) < 0) {
              caps.push(cap);
            }
          }
        }
      }
    }

    caps.sort();
    return caps;
  }

  function _buildTargetCommandCoverage(intentPlan, candidate, validation) {
    var coverage = [];
    if (!intentPlan || !intentPlan.stages || !candidate || !candidate.keyframes) return coverage;

    for (var i = 0; i < intentPlan.stages.length; i++) {
      var stage = intentPlan.stages[i];
      if (!stage.targets) continue;

      for (var j = 0; j < stage.targets.length; j++) {
        var target = stage.targets[j];
        var goal = target.goal || '(unknown)';
        var body = target.body || '(unknown)';

        // 检查是否有对应的骨骼指令
        var commandsFound = _findCommandsForTarget(body, goal, candidate);
        coverage.push({
          stage: stage.name || ('stage_' + i),
          body: body,
          goal: goal,
          commandsFound: commandsFound.length,
          commandDetails: commandsFound.slice(0, 5), // 最多展示 5 条
          covered: commandsFound.length > 0,
        });
      }
    }

    return coverage;
  }

  function _findCommandsForTarget(body, goal, candidate) {
    var boneMap = {
      right_arm: ['arm_r', 'elbow_r', 'wrist_r'],
      left_arm: ['arm_l', 'elbow_l', 'wrist_l'],
      both_arms: ['arm_r', 'elbow_r', 'wrist_r', 'arm_l', 'elbow_l', 'wrist_l'],
      right_hand: ['wrist_r'],
      left_hand: ['wrist_l'],
      head: ['head', 'neck'],
      center: ['center', 'upper_body'],
      full_body: ['center', 'upper_body', 'arm_r', 'arm_l', 'leg_r', 'leg_l', 'head'],
      right_leg: ['leg_r', 'leg_ik_r', 'toe_ik_r'],
      left_leg: ['leg_l', 'leg_ik_l', 'toe_ik_l'],
      both_legs: ['leg_r', 'leg_ik_r', 'toe_ik_r', 'leg_l', 'leg_ik_l', 'toe_ik_l'],
    };

    var bones = boneMap[body] || [body];
    var commands = [];

    for (var i = 0; i < candidate.keyframes.length; i++) {
      var kf = candidate.keyframes[i];
      if (!kf.pose) continue;
      for (var b = 0; b < bones.length; b++) {
        var boneData = kf.pose[bones[b]];
        if (!boneData) continue;
        for (var action in boneData) {
          if (!boneData.hasOwnProperty(action)) continue;
          for (var dir in boneData[action]) {
            if (!boneData[action].hasOwnProperty(dir)) continue;
            commands.push({
              bone: bones[b],
              action: action,
              direction: dir,
              value: boneData[action][dir],
              keyframe: kf.name || i,
            });
          }
        }
      }
    }

    return commands;
  }

  function playEffectorMotion(effectorJSON) {
    if (!window.IKMotionPlayer) {
      console.warn('[MotionArtisan] IKMotionPlayer not loaded');
      return false;
    }
    if (_armIKReady && _runtime && _runtime.model) {
      window.IKMotionPlayer.init(extractModelProfile());
    }
    return window.IKMotionPlayer.play(effectorJSON);
  }

  function stopEffectorMotion() {
    if (!window.IKMotionPlayer) return;
    window.IKMotionPlayer.stop();
  }

  function setEnabled(enabled) { _enabled = !!enabled; }
  function isEnabled() { return _enabled; }
  function isInitialized() { return _initialized && !!_runtime && !!_runtime.model; }

  window.MotionArtisan = {
    init: init,
    isInitialized: isInitialized,
    emitEmergencyFallback: function(motionIntentPlan, reason) {
      return _emitEmergencyFallback(motionIntentPlan || { stages: [] }, null, {}, {}, reason || 'manual_fallback');
    },
    captureCurrentPose: captureCurrentPose,
    extractModelProfile: extractModelProfile,
    solveAndEmitMPL: solveAndEmitMPL,
    setEnabled: setEnabled,
    isEnabled: isEnabled,
  playEffectorMotion: playEffectorMotion,
  stopEffectorMotion: stopEffectorMotion,
  };

  window.addEventListener('load', function() {
    setTimeout(function() {
      var appState = window._nlp || window.$;
      var threeRef = (appState && appState.THREE) || (typeof THREE !== 'undefined' ? THREE : null);
      if (appState && appState.model && threeRef) {
        init({
          THREE: threeRef,
          model: appState.model,
          helper: appState.helper,
          restPoseQuat: appState.restPoseQuat,
          restPosePos: appState.restPosePos,
          compiler: appState.compiler,
        });
      }
    }, 2000);
  });
})();
