# -*- coding: utf-8 -*-
"""Start and drive the MMD companion desktop bridge."""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import httpx


logger = logging.getLogger("qwenpaw.mmd_companion")

PLUGIN_ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8098
_DESKTOP_OWNED = False
_ACTIVE_BASE_URL: str | None = None


def _base_url() -> str:
    return os.environ.get(
        "QWENPAW_MMD_DESKTOP_URL",
        f"http://{DEFAULT_HOST}:{DEFAULT_PORT}",
    ).rstrip("/")


def _http_kwargs(timeout: float = 0.6) -> dict[str, Any]:
    return {"timeout": timeout, "trust_env": False}


def _tcp_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
            return True
        except OSError:
            return False


def desktop_health() -> dict[str, Any] | None:
    global _ACTIVE_BASE_URL
    base = _base_url()
    try:
        resp = httpx.get(f"{base}/health", **_http_kwargs())
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict) and data.get("ok"):
            _ACTIVE_BASE_URL = base
            return data
    except Exception:
        _ACTIVE_BASE_URL = None
    return None


def ensure_desktop_available() -> None:
    if desktop_health():
        _mark_owned()
        return
    if os.environ.get("QWENPAW_MMD_AUTOSTART", "0") == "0":
        return
    ok, reason = _spawn_desktop()
    if not ok:
        logger.warning("Could not start MMD companion: %s", reason)
        return
    deadline = time.time() + 8.0
    while time.time() < deadline:
        if desktop_health():
            _mark_owned()
            return
        time.sleep(0.2)


def _spawn_desktop() -> tuple[bool, str | None]:
    host = os.environ.get("QWENPAW_MMD_HOST", DEFAULT_HOST)
    port = int(os.environ.get("QWENPAW_MMD_PORT", str(DEFAULT_PORT)))
    if not _tcp_free(host, port):
        return False, f"port {port} is busy"

    cmd = [
        sys.executable,
        str(PLUGIN_ROOT / "backend" / "desktop_app.py"),
        "--host",
        host,
        "--port",
        str(port),
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = (
        str(PLUGIN_ROOT)
        + os.pathsep
        + env.get("PYTHONPATH", "")
    ).rstrip(os.pathsep)
    try:
        subprocess.Popen(
            cmd,
            cwd=str(PLUGIN_ROOT),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        _mark_owned()
        return True, None
    except OSError as exc:
        return False, str(exc)


def _mark_owned() -> None:
    global _DESKTOP_OWNED
    _DESKTOP_OWNED = True


def _command(command_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    base = _ACTIVE_BASE_URL or _base_url()
    try:
        resp = httpx.post(
            f"{base}/api/avatar/command",
            json={"type": command_type, "payload": payload},
            **_http_kwargs(timeout=2.0),
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.warning("MMD companion command failed: %s", exc)
        return {"ok": False, "error": str(exc)}


def emit_avatar_event(event: str, **payload: Any) -> dict[str, Any]:
    return _command("lifecycle_event", {"event": event, **payload})


def stop_desktop(*, force: bool = False) -> dict[str, Any]:
    if not (_DESKTOP_OWNED or force):
        return {"ok": True, "stopped": False, "reason": "not owned"}
    result = _command("shutdown", {})
    return {"ok": True, "stopped": bool(result.get("ok")), "detail": result}
