/**
 * MPLEmitter — 将 pose keyframes 编译为真实 MPL 字符串
 *
 * MPL 语法:
 *   @pose name { bone action direction value; }
 *   @animation name { time: poseName; }
 *   main { animName; }
 *
 * 骨骼命名: prefix_side  (arm_r, elbow_l, wrist_r)
 *
 * 安全:
 *   - 预检: keyframe 有 targets 但无 pose → throw Error
 *   - 空候选: 产出最小 MPL (idle stand)
 */

(function (global) {
  'use strict';

  var _lastReport = null;

  /**
   * 发射 MPL 字符串
   * @param {Object} candidate - { keyframes: [{time, pose, label?, ...}], label }
   * @param {Object} catalog - MPLCapabilityCatalog instance (optional)
   * @returns {string} MPL 源码
   */
  function emitMPL(candidate, catalog) {
    if (!candidate) {
      return _emitMinimalMPL();
    }

    var keyframes = candidate.keyframes;
    if (!keyframes || keyframes.length === 0) {
      return _emitMinimalMPL();
    }

    var poseNames = [];
    var poseBlocks = [];
    var animFrames = [];
    var totalCommands = 0;

    for (var i = 0; i < keyframes.length; i++) {
      var kf = keyframes[i];
      var pose = kf.pose;
      var hasTargets = kf.targets && kf.targets.length > 0;
      var hasPose = pose && typeof pose === 'object';

      if (hasTargets && !hasPose) {
        // 预检失败：有 targets 但无 pose
        throw new Error(
          '[MPLEmitter] keyframe at t=' + kf.time +
          ' has targets but no pose — impossible to emit. ' +
          'targets=' + JSON.stringify(kf.targets)
        );
      }

      if (!hasPose) {
        // 无 pose 无 targets：跳过（如纯 comment/transition 帧）
        continue;
      }

      var poseName = kf.label || kf.name || ('pose_' + i);
      if (poseNames.indexOf(poseName) >= 0) {
        poseName = poseName + '_' + i;
      }
      poseNames.push(poseName);

      var lines = _poseToMPL(pose, catalog);
      poseBlocks.push('@pose ' + poseName + ' {\n' + lines.join('\n') + '\n}');
      totalCommands += lines.length;

      animFrames.push(_formatTime(kf.time) + ': ' + poseName + ';');
    }

    if (poseBlocks.length === 0) {
      return _emitMinimalMPL();
    }

    var animName = candidate.label || candidate.name || 'main_anim';
    var mpl = '';
    mpl += poseBlocks.join('\n\n');
    mpl += '\n\n@animation ' + animName + ' {\n';
    mpl += '  ' + animFrames.join('\n  ');
    mpl += '\n}\n\n';
    mpl += 'main {\n  ' + animName + ';\n}';

    _lastReport = {
      totalCommands: totalCommands,
      poseCount: poseBlocks.length,
      frameCount: animFrames.length,
      animationName: animName,
    };

    return mpl;
  }

  /**
   * 将单个 pose 转 MPL 指令行
   * @param {Object} pose — { bone: { action: { direction: value } } }
   * @param {Object} catalog — 用于检查指令支持性
   * @returns {Array<string>} MPL 行
   */
  function _poseToMPL(pose, catalog) {
    var lines = [];
    var bones = Object.keys(pose).sort();

    for (var bi = 0; bi < bones.length; bi++) {
      var bone = bones[bi];
      var actions = pose[bone];
      if (!actions || typeof actions !== 'object') continue;

      var actionKeys = Object.keys(actions).sort();
      for (var ai = 0; ai < actionKeys.length; ai++) {
        var action = actionKeys[ai];
        var dirs = actions[action];
        if (!dirs || typeof dirs !== 'object') continue;

        var dirKeys = Object.keys(dirs).sort();
        for (var di = 0; di < dirKeys.length; di++) {
          var direction = dirKeys[di];
          var value = dirs[direction];

          if (typeof value !== 'number') continue;
          if (Math.abs(value) < 0.01) continue;

          // 检查 catalog 支持
          if (catalog && !_isSupportedByCatalog(catalog, bone, action, direction)) {
            continue;
          }

          lines.push('  ' + bone + ' ' + action + ' ' + direction + ' ' + _fmt(value) + ';');
        }
      }
    }

    return lines;
  }

  function _isSupportedByCatalog(catalog, bone, action, direction) {
    if (!catalog || !catalog.getAllBones) return true; // 无 catalog → 全放行
    try {
      var bones = catalog.getAllBones();
      if (bones.indexOf(bone) < 0) return false;
      var cmd = action + ' ' + direction;
      var supported = catalog.getSupportedCommands ? catalog.getSupportedCommands(bone) : [];
      return supported.length === 0 || supported.indexOf(cmd) >= 0;
    } catch (e) {
      return true; // catalog 异常 → 放行
    }
  }

  function _fmt(v) {
    return Math.round(v * 100) / 100;
  }

  function _formatTime(t) {
    return (Math.round(t * 1000) / 1000).toFixed(3);
  }

  /**
   * 最小 MPL (idle stand)
   */
  function _emitMinimalMPL() {
    _lastReport = {
      totalCommands: 0,
      poseCount: 0,
      frameCount: 0,
      minimal: true,
    };
    return '@pose idle {\n}\n\n@animation idle_anim {\n  0.000: idle;\n}\n\nmain {\n  idle_anim;\n}';
  }

  /**
   * 验证已发射的 MPL 质量
   */
  function validateEmittedMPL(mpl, catalog) {
    var report = {
      mplCommandCount: 0,
      commentOnlyPoseBlocks: [],
      unsupportedCommands: [],
      poseBlocks: 0,
      animationBlocks: 0,
      errors: [],
    };

    if (!mpl || typeof mpl !== 'string') {
      report.errors.push('no MPL string');
      return report;
    }

    var lines = mpl.split('\n');
    var inPose = false;
    var currentPoseLines = 0;
    var currentPoseName = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      if (line.match(/^@pose\s/)) {
        inPose = true;
        currentPoseLines = 0;
        currentPoseName = line;
        report.poseBlocks++;
      } else if (line === '}') {
        if (inPose && currentPoseLines === 0) {
          report.commentOnlyPoseBlocks.push(currentPoseName);
        }
        inPose = false;
      } else if (line.match(/^@animation\s/)) {
        report.animationBlocks++;
      } else if (inPose && line.match(/^\s*\w+\s+\w+\s+\w+\s+[\d.-]+\s*;/)) {
        report.mplCommandCount++;
        currentPoseLines++;

        // 检查 unsupported
        if (catalog) {
          var parts = line.trim().replace(';', '').split(/\s+/);
          if (parts.length >= 4) {
            var bone = parts[0], action = parts[1], direction = parts[2];
            if (!_isSupportedByCatalog(catalog, bone, action, direction)) {
              report.unsupportedCommands.push(line.trim());
            }
          }
        }
      }
    }

    return report;
  }

  /**
   * 统计真实 MPL 指令数（不含注释空行）
   */
  function countRealMPLCommands(mpl) {
    if (!mpl) return 0;
    var lines = mpl.split('\n');
    var count = 0;
    var inPose = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.match(/^@pose\s/)) { inPose = true; continue; }
      if (line === '}') { inPose = false; continue; }
      if (inPose && line.match(/^\s*\w+\s+\w+\s+\w+\s+[\d.-]+\s*;/)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 查找纯注释的 pose block（无真实指令）
   */
  function findCommentOnlyPoseBlocks(mpl) {
    var report = validateEmittedMPL(mpl);
    return report.commentOnlyPoseBlocks;
  }

  function getLastReport() {
    return _lastReport;
  }

  // ── 导出 ──
  global.MPLEmitter = {
    emitMPL: emitMPL,
    validateEmittedMPL: validateEmittedMPL,
    countRealMPLCommands: countRealMPLCommands,
    findCommentOnlyPoseBlocks: findCommentOnlyPoseBlocks,
    getLastReport: getLastReport,
  };

})(window);
