# -*- coding: utf-8 -*-
"""QwenPaw HTTP routes for the MMD companion plugin."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from backend.avatar_tools import (
    avatar_get_state,
    avatar_load_model,
    avatar_perform_gesture,
    avatar_play_vmd,
    avatar_set_expression,
    avatar_set_mood,
    avatar_stop,
)
from emitter import desktop_health, ensure_desktop_available


class ModelPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str


class VmdPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    loop: bool = False
    fade_ms: int = 200


class GesturePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent: str
    emotion: str = "neutral"
    intensity: float = 0.5


class ExpressionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    weight: float = 1.0


class MoodPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mood: str
    energy: float = 0.5


def build_router() -> APIRouter:
    router = APIRouter()

    @router.get("/status")
    def status():
        return {
            "ok": True,
            "plugin": "qwenpaw-mmd-companion",
            "desktop": desktop_health(),
            "state": avatar_get_state(),
        }

    @router.post("/desktop/start")
    def desktop_start():
        ensure_desktop_available()
        return {"ok": True, "desktop": desktop_health()}

    @router.post("/model")
    def load_model(payload: ModelPayload):
        return avatar_load_model(payload.path)

    @router.post("/vmd")
    def play_vmd(payload: VmdPayload):
        return avatar_play_vmd(payload.path, payload.loop, payload.fade_ms)

    @router.post("/gesture")
    def gesture(payload: GesturePayload):
        return avatar_perform_gesture(
            payload.intent,
            payload.emotion,
            payload.intensity,
        )

    @router.post("/expression")
    def expression(payload: ExpressionPayload):
        return avatar_set_expression(payload.name, payload.weight)

    @router.post("/mood")
    def mood(payload: MoodPayload):
        return avatar_set_mood(payload.mood, payload.energy)

    @router.post("/stop")
    def stop():
        return avatar_stop()

    return router
