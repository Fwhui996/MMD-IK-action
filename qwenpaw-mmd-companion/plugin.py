# -*- coding: utf-8 -*-
"""QwenPaw MMD Companion plugin entry point."""

from __future__ import annotations

import atexit
import logging
import sys
from pathlib import Path

_plugin_dir = str(Path(__file__).resolve().parent)
if _plugin_dir not in sys.path:
    sys.path.insert(0, _plugin_dir)

from qwenpaw.plugins.api import PluginApi  # noqa: E402

from backend.avatar_tools import (  # noqa: E402
    avatar_get_state,
    avatar_load_model,
    avatar_perform_gesture,
    avatar_play_vmd,
    avatar_set_expression,
    avatar_set_mood,
    avatar_stop,
)
from emitter import (  # noqa: E402
    emit_avatar_event,
    ensure_desktop_available,
    stop_desktop,
)
from router import build_router  # noqa: E402


logger = logging.getLogger("qwenpaw.mmd_companion")


def _atexit_stop() -> None:
    try:
        stop_desktop(force=True)
    except Exception:
        logger.debug("MMD companion atexit stop skipped", exc_info=True)


class QwenPawMMDCompanionPlugin:
    """Modern Three.js PMX/MMD companion for QwenPaw."""

    def register(self, api: PluginApi):
        logger.info("Registering QwenPaw MMD Companion plugin")

        api.register_tool(
            tool_name="avatar_load_model",
            tool_func=avatar_load_model,
            description="Load or replace the PMX model used by the desktop companion.",
            icon="3D",
        )
        api.register_tool(
            tool_name="avatar_play_vmd",
            tool_func=avatar_play_vmd,
            description="Play a VMD motion on the current PMX model.",
            icon="VMD",
        )
        api.register_tool(
            tool_name="avatar_perform_gesture",
            tool_func=avatar_perform_gesture,
            description="Perform a semantic avatar gesture.",
            icon="MMD",
        )
        api.register_tool(
            tool_name="avatar_set_expression",
            tool_func=avatar_set_expression,
            description="Set a PMX morph expression by name and weight.",
            icon="EXP",
        )
        api.register_tool(
            tool_name="avatar_set_mood",
            tool_func=avatar_set_mood,
            description="Set companion mood and idle energy.",
            icon="Mood",
        )
        api.register_tool(
            tool_name="avatar_get_state",
            tool_func=avatar_get_state,
            description="Get current MMD companion bridge state.",
            icon="Info",
        )
        api.register_tool(
            tool_name="avatar_stop",
            tool_func=avatar_stop,
            description="Stop avatar motion and return to idle.",
            icon="Stop",
        )

        api.register_startup_hook(
            hook_name="qwenpaw_mmd_companion_startup",
            callback=self._startup,
            priority=85,
        )
        api.register_shutdown_hook(
            hook_name="qwenpaw_mmd_companion_shutdown",
            callback=self._shutdown,
            priority=125,
        )
        api.register_http_router(
            build_router(),
            prefix="/qwenpaw-mmd-companion",
            tags=["qwenpaw-mmd-companion"],
        )

        atexit.register(_atexit_stop)
        logger.info("QwenPaw MMD Companion plugin registered")

    def _startup(self):
        try:
            ensure_desktop_available()
            emit_avatar_event("qwenpaw.startup", text="QwenPaw started")
        except Exception:
            logger.exception("MMD companion startup failed")

    def _shutdown(self):
        try:
            emit_avatar_event("qwenpaw.shutdown", text="")
        except Exception:
            logger.warning("MMD companion shutdown event failed", exc_info=True)
        try:
            stop_desktop(force=True)
        except Exception:
            logger.exception("MMD companion desktop stop failed")


plugin = QwenPawMMDCompanionPlugin()
