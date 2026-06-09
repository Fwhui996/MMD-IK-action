# QwenPaw MMD Companion Architecture

## Decision

The QwenPaw integration should not depend on the legacy global-script Three.js runtime in the original prototype. The first implemented backend is modern Three.js ES modules.

## Recommended Path

### Phase 1: Modern Three.js Renderer

Use current `three` from npm and import MMD support from official addons:

```js
import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
```

This keeps PMX/VMD compatibility while avoiding a frozen local copy of old Three.js files.

Use a dedicated adapter:

```ts
interface AvatarRenderer {
  loadModel(path: string): Promise<void>;
  playVmd(path: string, options?: MotionOptions): Promise<void>;
  performGesture(intent: GestureIntent): Promise<void>;
  setExpression(name: string, weight: number): void;
  setMood(mood: string, energy: number): void;
  getState(): AvatarState;
}
```

### Phase 2: Physics Abstraction

Do not let QwenPaw tools call a physics engine directly. Wrap physics behind the renderer.

Candidate physics engines:

- MMDAnimationHelper's MMD physics path for faithful MMD behavior.
- Rapier for additional desktop interaction colliders.
- A custom spring/bone layer for breathing, hair constraints, and idle secondary motion.

### Later: Godot 4 Sidecar

Godot is attractive for a native desktop companion, but PMX/VMD support depends on third-party addons. Keep it as a later backend after the Three.js plugin is useful.

## Why Not Convert Everything To VRM/glTF First?

VRM/glTF is cleaner for modern engines, but PMX/VMD is a hard product requirement. Conversion can be a future optimization path, not the first renderer.
