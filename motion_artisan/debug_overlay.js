/**
 * Debug Overlay — 完整调试面板
 *
 * 展示：候选分数、碰撞对详情、语义覆盖、平滑度、模型校准、降级报告。
 * Ctrl+Shift+D 切换。
 *
 * @module DebugOverlay
 */
(function() {
  'use strict';

  var _panel = null;
  var _visible = false;
  var _lastReport = null;
  var _expandedSections = {};

  function _create() {
    if (_panel) return;
    _panel = document.createElement('div');
    _panel.id = 'motion-artisan-debug';
    _panel.style.cssText = [
      'position:fixed', 'bottom:10px', 'right:10px',
      'background:rgba(0,0,0,0.9)', 'color:#0f0',
      'font-family:monospace', 'font-size:10px',
      'padding:8px', 'border-radius:4px',
      'max-width:420px', 'max-height:500px',
      'overflow-y:auto', 'z-index:9999',
      'display:none', 'border:1px solid #333',
      'white-space:pre-wrap', 'word-break:break-all',
    ].join(';');
    document.body.appendChild(_panel);
  }

  function toggle() {
    _create();
    _visible = !_visible;
    _panel.style.display = _visible ? 'block' : 'none';
    if (_visible && _lastReport) _render(_lastReport);
    return _visible;
  }

  function showReport(report) {
    _create();
    _lastReport = report || {};
    if (_visible) _render(_lastReport);
  }

  // ═══════════════════════════════════════════
  // 渲染
  // ═══════════════════════════════════════════

  function _render(r) {
    var lines = [];
    lines.push(_hdr('🔍 MotionArtisan Debug'));
    lines.push('');

    // ── 数据源 ──
    lines.push(_section('📦 数据源'));
    lines.push(_kv('PMX刚体', r.pmxRigidBodiesUsed ? '✅ 真实提取' : (r.fallbackCollisionBodiesUsed ? '⚠ fallback' : '❌ 无')));
    lines.push(_kv('当前姿态', r.currentPoseUsed ? '✅ 已捕获' : '❌ 未捕获'));
    lines.push(_kv('姿态发射', r.currentPoseEmission || '??'));
    lines.push(_kv('锚定发射', r.currentPoseAnchorEmitted ? '✅' : '❌'));
    lines.push(_kv('碰撞方法', _collisionMethod(r)));
    lines.push(_kv('目录就绪', r.capabilityCatalogReady ? '✅' : '❌'));

    // ── 候选 ──
    lines.push('');
    lines.push(_section('🎯 候选'));
    lines.push(_kv('采样帧数', r.sampledFrames));
    lines.push(_kv('选中候选', '#' + r.selectedCandidate));

    // ── 评分 ──
    if (r.smoothness) {
      lines.push('');
      lines.push(_section('📈 平滑度（0=最差 1=最佳）'));
      lines.push(_kv('总分', _f2(r.smoothness.total || 0)));
      lines.push(_kv('  jerk', _f2(r.smoothness.jerk || 0)));
      lines.push(_kv('  snap', _f2(r.smoothness.snap || 0)));
      lines.push(_kv('  瞬移', _f2(r.smoothness.teleport || 0)));
      lines.push(_kv('  翻转', _f2(r.smoothness.flip || 0)));
      lines.push(_kv('  连续', _f2(r.smoothness.continuity || 0)));
    }

    // ── 碰撞 ──
    var cols = r.collisions || [];
    lines.push('');
    lines.push(_section('💥 碰撞对（' + cols.length + '）'));
    for (var ci = 0; ci < Math.min(cols.length, 8); ci++) {
      var c = cols[ci];
      lines.push(_kv(c.pair, '穿透=' + _ff(c.penetration, 3) + ' 间隙=' + _ff(c.clearance, 3) + ' 需要=' + _ff(c.required, 3)));
    }
    if (cols.length > 8) lines.push('  ... +' + (cols.length - 8) + ' more');

    // ── 修复 ──
    var reps = r.repairs || [];
    if (reps.length > 0) {
      lines.push('');
      lines.push(_section('🔧 修复（' + reps.length + '）'));
      for (var ri = 0; ri < Math.min(reps.length, 5); ri++) {
        lines.push('  ' + reps[ri].name + ':' + (reps[ri].pair || 'ground'));
      }
    }

    // ── 拒绝 ──
    var rejs = r.rejections || [];
    if (rejs.length > 0) {
      lines.push('');
      lines.push(_section('🚫 拒绝（' + rejs.length + '）'));
      for (var rj = 0; rj < Math.min(rejs.length, 5); rj++) {
        lines.push('  ' + (rejs[rj].rejection || rejs[rj].rule));
      }
    }

    // ── 语义覆盖 ──
    if (r.semanticCoverage && r.semanticCoverage.length > 0) {
      lines.push('');
      lines.push(_section('📋 语义覆盖（' + r.semanticCoverage.length + ' goal）'));
      for (var sc = 0; sc < Math.min(r.semanticCoverage.length, 10); sc++) {
        var cov = r.semanticCoverage[sc];
        lines.push('  ' + (cov.goal || cov.targetGoal) + ' [' + cov.body + '] ' + (cov.covered ? '✅' : '❌'));
      }
    }

    // ── 目标指令覆盖 ──
    if (r.targetCommandCoverage && r.targetCommandCoverage.length > 0) {
      lines.push('');
      lines.push(_section('🎯 目标→指令覆盖（' + r.targetCommandCoverage.length + '）'));
      for (var tc = 0; tc < Math.min(r.targetCommandCoverage.length, 8); tc++) {
        var t = r.targetCommandCoverage[tc];
        lines.push('  ' + t.goal + '→' + t.body + ': ' + t.commandsFound + ' cmd ' + (t.covered ? '✅' : '❌'));
      }
    }

    // ── 发射质量 ──
    lines.push('');
    lines.push(_section('📤 MPL 发射'));
    lines.push(_kv('总指令数', r.mplCommandCount || 0));
    lines.push(_kv('不支持指令', (r.unsupportedMPLCommands || []).length));
    lines.push(_kv('注释Only块', (r.commentOnlyPoseBlocks || []).length));
    var caps = r.usedMPLCapabilities || [];
    if (caps.length > 0) {
      lines.push(_kv('能力使用', caps.length + ' 种'));
      for (var uci = 0; uci < Math.min(caps.length, 5); uci++) {
        lines.push('  ' + caps[uci]);
      }
    }

    // ── 安全 ──
    if (r.safety) {
      lines.push('');
      lines.push(_section('🛡️ 安全'));
      lines.push(_kv('硬规则通过', r.safety.hardRulesPassed ? '✅' : '❌'));
      lines.push(_kv('IK使用', r.safety.ikUsed ? '✅' : '❌'));
      lines.push(_kv('脚接触', r.safety.footContactPreserved ? '✅' : '❌'));
      lines.push(_kv('违反', (r.safety.rejected || []).length));
      lines.push(_kv('修复', (r.safety.repaired || []).length));
    }

    // ── 降级 ──
    if (r.degradationLevel && r.degradationLevel > 0) {
      lines.push('');
      lines.push(_section('⬇ 降级 L' + r.degradationLevel));
      lines.push(_kv('原因', r.degradationReason || 'unknown'));
    }

    // ── VMD ──
    if (r.vmdReferencesUsed && r.vmdReferencesUsed.length > 0) {
      lines.push('');
      lines.push(_section('🎬 VMD参考'));
      for (var vi = 0; vi < r.vmdReferencesUsed.length; vi++) {
        lines.push('  ' + r.vmdReferencesUsed[vi]);
      }
    }

    _panel.innerHTML = lines.join('\n');
  }

  function _hdr(text) { return '<div style="font-weight:bold;font-size:11px;color:#0ff;">' + text + '</div>'; }
  function _section(text) { return '<div style="color:#ff0;margin-top:2px;">' + text + '</div>'; }
  function _kv(k, v) { return '  ' + k + ': ' + v; }
  function _f2(n) { return (typeof n === 'number' ? n.toFixed(2) : String(n)); }
  function _ff(n, d) { return (typeof n === 'number' ? n.toFixed(d) : String(n)); }

  function _collisionMethod(r) {
    if (r.collisions && r.collisions.length > 0 && r.collisions[0].method) {
      return r.collisions[0].method;
    }
    return '?';
  }

  // 快捷键
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      toggle();
    }
  });

  window.DebugOverlay = {
    createDebugPanel: _create,
    toggle: toggle,
    showReport: showReport,
    update: function(data) { showReport(data); },
  };
})();
