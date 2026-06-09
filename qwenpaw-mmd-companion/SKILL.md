# QwenPaw MMD Companion

This plugin turns a PMX/MMD renderer into an avatar surface that a QwenPaw agent can control with tools.

## Purpose

- Keep QwenPaw as the agent host for persona, memory, chat, voice, and skill routing.
- Provide a separate PMX desktop companion window with toon rendering, physics, VMD playback, and gesture tools.
- Avoid locking the agent plugin to one old browser runtime. The backend bridge is renderer-agnostic.
- Let the agent call semantic avatar tools instead of directly touching Three.js.

## Renderer Strategy

Use `renderers/three-modern`. It uses current `three` ES modules and official addons such as `MMDLoader` and `MMDAnimationHelper`.

The old `libs/*.js` runtime should be treated as compatibility/reference code, not the target architecture.

## Runtime Shape

The plugin starts a local HTTP bridge. The bridge serves:

- a selected renderer frontend or sidecar
- avatar control endpoints under `/api/avatar/*`

The renderer polls commands from `/api/avatar/commands` or receives them over a socket, then applies them to its own PMX/VMD/avatar runtime.

## Suggested Agent Tool Use

- Use `avatar_perform_gesture` for normal emotional or conversational body language.
- Use `avatar_play_vmd` when a specific VMD file should be played.
- Use `avatar_set_expression` and `avatar_set_mood` alongside speech.
- Use `avatar_load_model` only when the user explicitly wants to change character.

## Tool Contract

The bridge is intentionally narrow:

```json
{
  "type": "perform_gesture",
  "intent": "greet_user",
  "emotion": "happy",
  "intensity": 0.7
}
```

The frontend decides whether to play a VMD, run IK, or trigger a lightweight procedural action.

## Integration Notes

QwenPaw's exact plugin manifest may evolve. Keep this directory as the source plugin package, and adapt `plugin.json` / `backend/avatar_tools.py` to the current QwenPaw loader if needed.
