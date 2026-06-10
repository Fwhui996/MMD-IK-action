# QwenPaw MMD Companion

Modern Three.js PMX/MMD desktop companion plugin for QwenPaw.

## Current Prototype

- QwenPaw plugin manifest and backend entry (`plugin.py`)
- QwenPaw avatar tools for PMX loading, VMD playback, expressions, mood, gestures, and stop
- Local avatar bridge on `127.0.0.1:8098`
- Modern Vite + Three.js renderer on `127.0.0.1:5178`
- PMX loading with `MMDLoader`
- VMD playback with `MMDAnimationHelper`
- Toon-style outline rendering with `OutlineEffect`

## Why Three.js 0.160.0

The newest `three` package tested here no longer includes `MMDLoader` in its addons. `three@0.160.0` is still an ES-module Three.js release while keeping `examples/jsm/loaders/MMDLoader.js` and `examples/jsm/animation/MMDAnimationHelper.js`.

Keep `three` pinned unless you verify the target version still ships MMD addons.

## One-Click Run

Double-click:

```text
start-dev.bat
```

It starts both:

```text
Bridge:   http://127.0.0.1:8098
Renderer: http://127.0.0.1:5178/?bridge=http://127.0.0.1:8098
```

If `node_modules` is missing, the script runs `npm install` once.

## QwenPaw Install

Build the renderer once before installing or packaging:

```text
cd renderers\three-modern
npm install
npm run build
```

```text
install-plugin.bat
```

or package a zip for QwenPaw's plugin page:

```text
package-plugin.bat
```

Restart QwenPaw after install. The plugin registers avatar tools and autostarts the desktop bridge unless `QWENPAW_MMD_AUTOSTART=0`.

The plugin frontend is served at:

```text
http://127.0.0.1:8098/
```

Use `QWENPAW_MMD_DEV_RENDERER=1` only when developing the Vite renderer at `127.0.0.1:5178`.
