# MMD Motion Artisan — IK 动作系统 & 渲染引擎

提取自 [Fengyun-MMD](https://github.com/nextlevel/fengyun-mmd) 项目，独立出核心的 IK 动作系统和 MMD 渲染管线。

## 目录结构

```
MMDdongbu/
├── index.html              # 演示页面
├── renderer.js             # 渲染引擎（场景/模型/灯光/动画循环）
├── server.py               # 本地开发服务器
├── README.md               # 本文件
├── libs/                   # Three.js + MMD 核心库（10个文件）
│   ├── three.min.js        # Three.js r128+
│   ├── MMDLoader.js        # PMX/VMD 加载器
│   ├── MMDAnimationHelper.js
│   ├── MMDPhysics.js       # 刚体物理
│   ├── CCDIKSolver.js      # CCD IK 解算器
│   ├── mmdparser.min.js    # PMX 解析器
│   ├── ammo.js             # Bullet 物理引擎 (WASM)
│   ├── OrbitControls.js    # 摄像机控制
│   ├── OutlineEffect.js    # 描边后处理
│   └── TGALoader.js        # TGA 纹理
├── motion_artisan/         # IK 动作引擎（33个模块）
│   ├── index.js            # MotionArtisan 主入口
│   ├── types.js            # 类型定义
│   ├── mpl_capability_catalog.js    # 骨骼能力目录
│   ├── anatomy_limits.js           # 人体解剖约束
│   ├── current_pose.js             # 当前姿态捕获
│   ├── pose_targets.js             # 目标姿态求解
│   ├── trajectory_solver.js        # 轨迹生成
│   ├── collision_validator.js      # 碰撞验证
│   ├── collision_shapes.js         # 碰撞体计算
│   ├── safety_contract.js          # 安全合约（8规则）
│   ├── ground_contact.js           # 地面接触
│   ├── smoothness_metrics.js       # 平滑度评分
│   ├── semantic_validator.js       # 语义验证
│   ├── motion_scorer.js            # 动作评分
│   ├── degradation_policy.js       # 降级策略
│   ├── motion_state.js             # 动作状态管理
│   ├── motion_timing_policy.js     # 时序策略
│   ├── model_profile.js            # 模型特征
│   ├── model_data_extractor.js     # 模型数据提取
│   ├── model_calibration.js        # 模型校准
│   ├── calibration_cache.js        # 校准缓存
│   ├── pmx_collision_profile.js    # PMX 碰撞体
│   ├── fk_engine.js                # FK 引擎
│   ├── ik_solver_bridge.js         # IK 桥接
│   ├── effector_mapper.js          # 效应器映射
│   ├── trajectory_interpolator.js  # 轨迹插值
│   ├── ik_motion_player.js         # IK 动作播放器
│   ├── arm_ik_driver.js            # 手臂 IK 驱动
│   ├── mpl_emitter.js              # MPL 代码发射
│   ├── vmd_reference_library.js    # VMD 参考库
│   ├── playback_mode.js            # 播放模式
│   ├── debug_overlay.js            # 调试面板
│   └── mmd_mpl_v2.js               # MPL WASM 编译器
└── models/                 # PMX 模型目录（用户自行放置）
```

## 快速启动

```bash
# 1. 安装依赖
pip install flask

# 2. 放入 PMX 模型到 models/ 目录
# 例如: models/绯英/绯英.pmx

# 3. 启动服务器
python server.py

# 4. 打开浏览器
# http://localhost:8080/
```

## 核心架构

```
┌──────────────────────────────────────────────┐
│                 Motion Artisan                 │
│                                                │
│  IntentPlan → TrajectorySolver → PoseTargets  │
│                                ↓              │
│                         CollisionValidator     │
│                         SafetyContract         │
│                                ↓              │
│                          MPLEmitter           │
│                                ↓              │
│                    MPL Code / IK Targets       │
└────────────────────┬─────────────────────────┘
                     ↓
┌──────────────────────────────────────────────┐
│               Rendering Engine                │
│                                                │
│  THREE.Scene ← MMDRenderer.initScene()        │
│  MMDLoader.load() → SkinnedMesh               │
│  MMDAnimationHelper (Physics + IK)            │
│  OutlineEffect (描边后处理)                    │
│  OrbitControls (旋转/缩放/平移)                │
│  SoftConstraintSystem (裙子/头发)              │
│  Three-Point Lighting (Key/Fill/Rim)          │
└──────────────────────────────────────────────┘
```

## API 参考

### MMDRenderer

```javascript
// 初始化场景
MMDRenderer.initScene('viewer', { bgColor: 0x0d1117 });

// 加载模型
await MMDRenderer.loadModel('models/feiying.pmx', {
  onProgress: (pct) => console.log(pct + '%')
});

// 启动渲染循环
MMDRenderer.startLoop();

// 控制
MMDRenderer.setPhysics(true);  // 物理开关
MMDRenderer.setIK(true);       // IK 开关
MMDRenderer.getState();        // 获取内部状态
```

### MotionArtisan

```javascript
// 初始化（在 loadModel 之后）
window.MotionArtisan.init({
  THREE: THREE,
  model: MMDRenderer.getState().model,
  helper: MMDRenderer.getState().helper,
  restPoseQuat: MMDRenderer.getState().restPoseQuat,
  restPosePos: MMDRenderer.getState().restPosePos,
  compiler: null
});

// 执行意图 → 动作
var result = window.MotionArtisan.solveAndEmitMPL(plan);

// IK 直接控制
window.ArmIKDriver.setRightTarget(x, y, z);
window.ArmIKDriver.setLeftTarget(x, y, z);
window.ArmIKDriver.update();
```

### 意图计划 (IntentPlan) 格式

```javascript
{
  intent: '蹲下',
  motionMode: 'explicit_action',
  stages: [
    {
      name: 'prepare',
      targets: [
        { body: 'center', goal: 'lower_center', amount: 30 },
        { body: 'knee_r', goal: 'bend_backward', amount: 40 }
      ]
    },
    {
      name: 'settle',
      targets: [
        { body: 'center', goal: 'settle_smoothly', amount: 0 }
      ]
    }
  ]
}
```

## 安全合约

8 条规则保护模型不崩溃：

1. **禁止空 pose 关键帧** — 必须有 MPL 指令
2. **禁止无定义 body** — 目标体必须在目录中
3. **禁止致命碰撞** — 穿透 >0.15 拒绝
4. **禁止硬切到 rest pose** — 首帧不能全零
5. **解剖约束** — 关节角度不超过人体极限
6. **地面穿透修复** — 自动修补穿地
7. **时间单调性** — keyframe.time 必须递增
8. **MPL 语法验证** — 发射前语法检查

## 依赖

- Three.js r128+ (实测 r152 兼容)
- Ammo.js (Bullet Physics)
- Flask (Python 服务器)
- 现代浏览器 (Chrome/Firefox/Edge, WebGL 2.0)

## 许可

MIT License — 详见项目根目录 LICENSE 文件
