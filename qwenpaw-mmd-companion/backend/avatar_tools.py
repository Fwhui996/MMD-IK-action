"""
QwenPaw MMD Companion tool bridge.

This file is intentionally framework-light: QwenPaw can import the tool
functions directly, or it can run the local bridge server and talk HTTP.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib import request


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PLUGIN_ROOT.parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8098


@dataclass
class AvatarCommand:
    id: str
    type: str
    payload: Dict[str, Any]
    created_at: float


class AvatarBridgeClient:
    def __init__(self, base_url: str = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}") -> None:
        self.base_url = base_url.rstrip("/")

    def post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        data = json.dumps(payload).encode("utf-8")
        req = request.Request(
            self.base_url + path,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def get(self, path: str) -> Dict[str, Any]:
        with request.urlopen(self.base_url + path, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))


_client = AvatarBridgeClient()


def avatar_start(port: int = DEFAULT_PORT) -> Dict[str, Any]:
    """Start the local avatar bridge in a background thread."""
    from .bridge_server import create_app

    app = create_app(WORKSPACE_ROOT)

    def run() -> None:
        app.run(host=DEFAULT_HOST, port=port, debug=False, use_reloader=False)

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    time.sleep(0.5)
    return {
        "ok": True,
        "url": f"http://{DEFAULT_HOST}:{port}/",
        "message": "MMD companion bridge started.",
    }


def avatar_load_model(path: str) -> Dict[str, Any]:
    """Load or replace the active PMX model."""
    return _client.post("/api/avatar/command", {
        "type": "load_model",
        "payload": {"path": path},
    })


def avatar_play_vmd(path: str, loop: bool = False, fade_ms: int = 200) -> Dict[str, Any]:
    """Play a VMD motion on the current PMX model."""
    return _client.post("/api/avatar/command", {
        "type": "play_vmd",
        "payload": {"path": path, "loop": loop, "fade_ms": fade_ms},
    })


def avatar_perform_gesture(
    intent: str,
    emotion: str = "neutral",
    intensity: float = 0.5,
) -> Dict[str, Any]:
    """Ask the avatar to perform a semantic gesture."""
    return _client.post("/api/avatar/command", {
        "type": "perform_gesture",
        "payload": {
            "intent": intent,
            "emotion": emotion,
            "intensity": max(0.0, min(1.0, float(intensity))),
        },
    })


def avatar_set_expression(name: str, weight: float = 1.0) -> Dict[str, Any]:
    """Set a morph/expression by name."""
    return _client.post("/api/avatar/command", {
        "type": "set_expression",
        "payload": {"name": name, "weight": max(0.0, min(1.0, float(weight)))},
    })


def avatar_set_mood(mood: str, energy: float = 0.5) -> Dict[str, Any]:
    """Set high-level avatar mood, used by idle and gesture systems."""
    return _client.post("/api/avatar/command", {
        "type": "set_mood",
        "payload": {"mood": mood, "energy": max(0.0, min(1.0, float(energy)))},
    })


def avatar_look_at(x: float, y: float, z: float = 0.0) -> Dict[str, Any]:
    """Ask the avatar to look at a desktop or world target."""
    return _client.post("/api/avatar/command", {
        "type": "look_at",
        "payload": {"x": x, "y": y, "z": z},
    })


def avatar_get_state() -> Dict[str, Any]:
    """Return current bridge/avatar state."""
    return _client.get("/api/avatar/state")


def avatar_stop() -> Dict[str, Any]:
    """Stop avatar motion and return to idle."""
    return _client.post("/api/avatar/command", {
        "type": "stop",
        "payload": {},
    })


def make_command(command_type: str, payload: Optional[Dict[str, Any]] = None) -> AvatarCommand:
    return AvatarCommand(
        id=str(uuid.uuid4()),
        type=command_type,
        payload=payload or {},
        created_at=time.time(),
    )


def command_to_dict(command: AvatarCommand) -> Dict[str, Any]:
    return asdict(command)
