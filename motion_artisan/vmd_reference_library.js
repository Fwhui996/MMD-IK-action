/**
 * VMD Reference Library — VMD 参考动作库
 *
 * 存储已学习的 VMD 短片元数据，在 solveAndEmitMPL 时提供
 * 节奏/goal 匹配和 timing/style 提示。
 *
 * 流程：
 *   1. 后端上传 VMD → /api/motion/expert/upload-vmd
 *   2. 后端存储 clip_metadata.json
 *   3. 前端 loadClips() 加载元数据
 *   4. solveAndEmitMPL 调用 matchIntent() 查询匹配
 *   5. 匹配到的 timing/style 提示注入 TrajectorySolver
 *   6. 报告 vmdReferencesUsed
 *
 * @module VMDReferenceLibrary
 */
(function() {
  'use strict';

  var _clips = [];
  var _loaded = false;
  var _lastMatched = [];

  /**
   * @typedef {Object} VMDClipMeta
   * @property {string} clip_id
   * @property {string} label — 人类可读标签
   * @property {string} source_vmd — 源 VMD 文件名
   * @property {number} duration — 时长 (s)
   * @property {number} tempo — BPM
   * @property {number} frame_count — 总帧数
   * @property {string[]} goal_tags — goal 标签（如 lower_body, wave, nod）
   * @property {string[]} body_tags — body 标签（如 full_body, right_arm）
   * @property {number} action_scale — 动作幅度（0-1）
   * @property {string} style — 风格标签
   * @property {number} quality — 质量评分（0-1）
   */

  /**
   * 加载 VMD 短片元数据
   * @param {VMDClipMeta[]} clips
   */
  function loadClips(clips) {
    _clips = clips || [];
    _loaded = true;
    console.log('[VMDReferenceLibrary] loaded ' + _clips.length + ' clips');
  }

  /**
   * 从后端 API 异步加载
   */
  function fetchFromAPI(baseUrl) {
    baseUrl = baseUrl || '';
    var url = baseUrl + '/api/motion/vmd-clips';
    if (typeof fetch !== 'undefined') {
      fetch(url)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.ok && data.clips) {
            loadClips(data.clips);
          }
        })
        .catch(function(e) {
          console.warn('[VMDReferenceLibrary] fetch failed:', e);
        });
    }
  }

  /**
   * 匹配动作意图，返回 timing/style 提示
   *
   * @param {string} intentText — 用户意图文本
   * @param {Object} motionIntentPlan — MotionIntentPlan 对象
   * @returns {Object} { hints: { tempo, actionScale, style }, matchedClips: [] }
   */
  function matchIntent(intentText, motionIntentPlan) {
    _lastMatched = [];

    if (!_loaded || _clips.length === 0) {
      return { hints: null, matchedClips: [], used: false };
    }

    // 从 intent plan 提取 goal 和 body 关键词
    var goals = _extractGoals(motionIntentPlan);
    var bodies = _extractBodies(motionIntentPlan);
    var text = (intentText || '').toLowerCase();

    // 对每个 clip 打分
    var scored = [];
    for (var i = 0; i < _clips.length; i++) {
      var clip = _clips[i];
      var score = _scoreClip(clip, text, goals, bodies);
      if (score > 0) {
        scored.push({ clip: clip, score: score });
      }
    }

    // 按分数降序
    scored.sort(function(a, b) { return b.score - a.score; });

    // 取 top 3
    var top = scored.slice(0, 3);
    _lastMatched = top;

    if (top.length === 0) {
      return { hints: null, matchedClips: [], used: false };
    }

    // 聚合提示
    var hints = _aggregateHints(top);

    return {
      hints: hints,
      matchedClips: top.map(function(t) { return t.clip.clip_id; }),
      used: true,
    };
  }

  /**
   * 获取上次匹配的 clip 列表（用于报告）
   * @returns {string[]}
   */
  function getLastMatched() {
    return _lastMatched.map(function(m) { return m.clip.clip_id; });
  }

  /**
   * 是否有可用参考
   */
  function hasReferences() {
    return _loaded && _clips.length > 0;
  }

  /**
   * 获取已加载 clip 数
   */
  function count() {
    return _clips.length;
  }

  // ═══════════════════════════════════════════
  // 内部
  // ═══════════════════════════════════════════

  function _extractGoals(plan) {
    if (!plan || !plan.stages) return [];
    var set = {};
    for (var i = 0; i < plan.stages.length; i++) {
      var targets = plan.stages[i].targets || [];
      for (var j = 0; j < targets.length; j++) {
        var goal = targets[j].goal;
        if (goal) set[goal.toLowerCase()] = true;
      }
    }
    return Object.keys(set);
  }

  function _extractBodies(plan) {
    if (!plan || !plan.stages) return [];
    var set = {};
    for (var i = 0; i < plan.stages.length; i++) {
      var targets = plan.stages[i].targets || [];
      for (var j = 0; j < targets.length; j++) {
        var body = targets[j].body;
        if (body) set[body.toLowerCase()] = true;
      }
    }
    return Object.keys(set);
  }

  function _scoreClip(clip, text, goals, bodies) {
    var score = 0;

    // 文本匹配
    var label = (clip.label || '').toLowerCase();
    var overlap = _wordOverlap(text, label);
    score += overlap * 3;

    // goal 标签匹配
    if (clip.goal_tags) {
      for (var i = 0; i < goals.length; i++) {
        if (clip.goal_tags.indexOf(goals[i]) >= 0) score += 2;
      }
    }

    // body 标签匹配
    if (clip.body_tags) {
      for (var j = 0; j < bodies.length; j++) {
        if (clip.body_tags.indexOf(bodies[j]) >= 0) score += 1;
      }
    }

    // 质量加权
    score *= (1 + (clip.quality || 0.5) * 0.5);

    return score;
  }

  function _wordOverlap(a, b) {
    if (!a || !b) return 0;
    var wordsA = a.split(/[\s,，、]+/);
    var wordsB = b.split(/[\s,，、]+/);
    var overlap = 0;
    for (var i = 0; i < wordsA.length; i++) {
      if (wordsA[i].length < 2) continue;
      if (b.indexOf(wordsA[i]) >= 0) overlap++;
    }
    return overlap;
  }

  function _aggregateHints(scored) {
    var totalWeight = 0;
    var tempoSum = 0;
    var scaleSum = 0;
    var styleVotes = {};

    for (var i = 0; i < scored.length; i++) {
      var w = scored[i].score;
      var c = scored[i].clip;
      totalWeight += w;
      if (c.tempo) tempoSum += c.tempo * w;
      if (c.action_scale !== undefined) scaleSum += c.action_scale * w;
      if (c.style) {
        styleVotes[c.style] = (styleVotes[c.style] || 0) + w;
      }
    }

    var topStyle = null;
    var topStyleWeight = 0;
    for (var s in styleVotes) {
      if (styleVotes[s] > topStyleWeight) {
        topStyleWeight = styleVotes[s];
        topStyle = s;
      }
    }

    return {
      tempo: totalWeight > 0 ? Math.round(tempoSum / totalWeight) : null,
      actionScale: totalWeight > 0 ? scaleSum / totalWeight : null,
      style: topStyle,
    };
  }

  window.VMDReferenceLibrary = {
    loadClips: loadClips,
    fetchFromAPI: fetchFromAPI,
    matchIntent: matchIntent,
    getLastMatched: getLastMatched,
    hasReferences: hasReferences,
    count: count,
  };
})();
