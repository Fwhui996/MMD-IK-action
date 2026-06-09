/**
 * IK Solver Bridge — IK 求解器桥接
 *
 * 如果 MMD helper 暴露可用的 IK solver，包装它；
 * 否则使用本地启发式算法。
 *
 * 当前版本：使用解析式启发式 IK（两骨骼手臂近似等）。
 *
 * @module IKSolverBridge
 */
(function() {
  'use strict';

  /**
   * 简单两骨骼 IK：给定肩、肘、腕目标和臂长，求解肘位置
   * @param {Array<number>} shoulder - [x,y,z]
   * @param {Array<number>} wrist - [x,y,z]
   * @param {number} upperLen - 上臂长度
   * @param {number} lowerLen - 前臂长度
   * @param {Array<number>} elbowHint - 肘方向提示（如 [0, -1, 0] 表示肘向下）
   * @returns {Object} { elbow: [x,y,z], reachable: bool }
   */
  function solveTwoBoneIK(shoulder, wrist, upperLen, lowerLen, elbowHint) {
    elbowHint = elbowHint || [0, -1, 0];

    var sx = shoulder[0], sy = shoulder[1], sz = shoulder[2];
    var wx = wrist[0], wy = wrist[1], wz = wrist[2];

    // 肩到腕的向量
    var dx = wx - sx, dy = wy - sy, dz = wz - sz;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 不可达
    if (dist > upperLen + lowerLen || dist < Math.abs(upperLen - lowerLen)) {
      // 返回最近可达点
      var scale = (upperLen + lowerLen) / Math.max(dist, 0.001);
      return {
        elbow: [sx + dx * scale * 0.5, sy + dy * scale * 0.5, sz + dz * scale * 0.5],
        reachable: false,
      };
    }

    // 余弦定理求肘部角度
    var cosAngle = (upperLen * upperLen + dist * dist - lowerLen * lowerLen) /
                   (2 * upperLen * dist);
    cosAngle = Math.max(-1, Math.min(1, cosAngle));
    var angle = Math.acos(cosAngle);

    // 归一化肩→腕方向
    var ndx = dx / dist, ndy = dy / dist, ndz = dz / dist;

    // 旋转轴：肩→腕方向 × 肘方向提示
    var ex = elbowHint[0], ey = elbowHint[1], ez = elbowHint[2];
    var rx = ndy * ez - ndz * ey;
    var ry = ndz * ex - ndx * ez;
    var rz = ndx * ey - ndy * ex;
    var rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);

    if (rLen < 0.001) {
      // 并行：使用任意垂直轴
      rx = -ndz;
      ry = 0;
      rz = ndx;
      rLen = Math.sqrt(rx * rx + rz * rz);
    }

    rx /= rLen;
    ry /= rLen;
    rz /= rLen;

    // 绕旋转轴旋转
    var cosA = Math.cos(angle);
    var sinA = Math.sin(angle);

    // Rodriques 公式
    var edx = ndx * cosA +
              (ry * ndz - rz * ndy) * sinA +
              rx * (rx * ndx + ry * ndy + rz * ndz) * (1 - cosA);
    var edy = ndy * cosA +
              (rz * ndx - rx * ndz) * sinA +
              ry * (rx * ndx + ry * ndy + rz * ndz) * (1 - cosA);
    var edz = ndz * cosA +
              (rx * ndy - ry * ndx) * sinA +
              rz * (rx * ndx + ry * ndy + rz * ndz) * (1 - cosA);

    var elbow = [
      sx + edx * upperLen,
      sy + edy * upperLen,
      sz + edz * upperLen,
    ];

    return { elbow: elbow, reachable: true };
  }

  /**
   * 检查 MMD helper 是否暴露 IK solver
   * @returns {boolean}
   */
  function hasMMDIKSolver() {
    return !!(window.$ && window.$.helper && window.$.helper.ikSolver);
  }

  window.IKSolverBridge = {
    solveTwoBoneIK: solveTwoBoneIK,
    hasMMDIKSolver: hasMMDIKSolver,
  };
})();
