from __future__ import annotations

import os
import re
import shutil
import tempfile
import zipfile
import sys
import json
import time
from pathlib import Path
from typing import Any, Dict, List
from urllib import request as urlrequest
from urllib import error as urlerror

from flask import Flask, jsonify, request, send_from_directory

try:
    from .avatar_tools import command_to_dict, make_command
except ImportError:
    from avatar_tools import command_to_dict, make_command


def create_app(workspace_root: Path) -> Flask:
    workspace_root = workspace_root.resolve()
    frontend_root = workspace_root / "qwenpaw-mmd-companion" / "frontend"
    renderer_dist = workspace_root / "qwenpaw-mmd-companion" / "renderers" / "three-modern" / "dist"
    runtime_models = workspace_root / "qwenpaw-mmd-companion" / "runtime" / "models"
    runtime_state_file = workspace_root / "qwenpaw-mmd-companion" / "runtime" / "state.json"
    runtime_models.mkdir(parents=True, exist_ok=True)
    runtime_state_file.parent.mkdir(parents=True, exist_ok=True)
    app = Flask(__name__)
    commands: List[Dict[str, Any]] = []
    state: Dict[str, Any] = {
        "model": None,
        "motion": None,
        "mood": "neutral",
        "expression": None,
        "last_command": None,
    }

    def load_runtime_state() -> Dict[str, Any]:
        try:
            if runtime_state_file.exists():
                data = json.loads(runtime_state_file.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
        except Exception:
            pass
        return {}

    def save_runtime_state(**updates: Any) -> Dict[str, Any]:
        data = load_runtime_state()
        data.update({k: v for k, v in updates.items() if v is not None})
        runtime_state_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return data

    def get_qwenpaw_api_base() -> str | None:
        endpoint = os.environ.get("QWENPAW_CHAT_ENDPOINT", "").strip()
        if endpoint:
            return endpoint.rstrip("/")
        config_path = Path.home() / ".copaw" / "config.json"
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            last_api = config.get("last_api") or {}
            host = last_api.get("host") or "127.0.0.1"
            port = last_api.get("port")
            if port:
                return f"http://{host}:{int(port)}/api/console/chat"
        except Exception:
            pass
        return None

    def extract_sse_text(raw: str) -> Dict[str, Any]:
        chunks: List[str] = []
        final_messages: List[str] = []
        events: List[Any] = []
        for line in raw.splitlines():
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                payload = json.loads(data)
            except Exception:
                chunks.append(data)
                continue
            events.append(payload)
            if (
                isinstance(payload, dict)
                and payload.get("type") == "message"
                and payload.get("role") == "assistant"
                and payload.get("status") == "completed"
            ):
                message_parts: List[str] = []
                for part in payload.get("content") or []:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text = part.get("text")
                        if isinstance(text, str) and text:
                            message_parts.append(text)
                if message_parts:
                    final_messages.append("".join(message_parts).strip())
                continue
            candidates = [
                payload.get("text") if isinstance(payload, dict) else None,
                payload.get("content") if isinstance(payload, dict) else None,
                payload.get("message", {}).get("content") if isinstance(payload.get("message"), dict) else None,
                payload.get("delta", {}).get("content") if isinstance(payload.get("delta"), dict) else None,
                payload.get("output") if isinstance(payload, dict) else None,
            ]
            for value in candidates:
                if isinstance(value, str) and value:
                    chunks.append(value)
                elif isinstance(value, list):
                    for part in value:
                        if isinstance(part, str):
                            chunks.append(part)
                        elif isinstance(part, dict) and isinstance(part.get("text"), str):
                            chunks.append(part["text"])
        return {
            "text": (final_messages[-1] if final_messages else "".join(chunks).strip()),
            "events": events[-20:],
        }

    def remember_model(path: str, name: str | None = None, vmds: List[str] | None = None) -> Dict[str, Any]:
        data = load_runtime_state()
        item = {
            "path": path,
            "name": display_model_name(path, name),
            "vmds": vmds or [],
        }
        identity = model_identity(path, item["name"])
        history = [
            m for m in data.get("models", [])
            if isinstance(m, dict)
            and m.get("path") != path
            and model_identity(m.get("path", ""), m.get("name")) != identity
        ]
        history.insert(0, item)
        data["last_model"] = item
        data["models"] = history[:30]
        runtime_state_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return item

    def forget_model(path: str) -> None:
        data = load_runtime_state()
        data["models"] = [
            m for m in data.get("models", [])
            if isinstance(m, dict) and m.get("path") != path
        ]
        if isinstance(data.get("last_model"), dict) and data["last_model"].get("path") == path:
            data.pop("last_model", None)
        runtime_state_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def remember_scene_model(path: str, name: str | None = None) -> Dict[str, Any]:
        data = load_runtime_state()
        item = {
            "path": path,
            "name": display_model_name(path, name),
        }
        identity = model_identity(path, item["name"])
        history = [
            m for m in data.get("scene_models", [])
            if isinstance(m, dict)
            and m.get("path") != path
            and model_identity(m.get("path", ""), m.get("name")) != identity
        ]
        if isinstance(data.get("scene_model"), dict):
            old = data["scene_model"]
            if old.get("path") != path and model_identity(old.get("path", ""), old.get("name")) != identity:
                history.insert(0, {
                    "path": old.get("path"),
                    "name": display_model_name(old.get("path", ""), old.get("name")),
                })
        history.insert(0, item)
        data["scene_model"] = item
        data["scene_models"] = history[:30]
        runtime_state_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return item

    def forget_scene_model(path: str) -> None:
        data = load_runtime_state()
        data["scene_models"] = [
            m for m in data.get("scene_models", [])
            if isinstance(m, dict) and m.get("path") != path
        ]
        if isinstance(data.get("scene_model"), dict) and data["scene_model"].get("path") == path:
            data.pop("scene_model", None)
            if data["scene_models"]:
                data["scene_model"] = data["scene_models"][0]
        runtime_state_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def display_vmd_name(path: str, name: str | None = None) -> str:
        raw = str(name or "").replace("\\", "/")
        source = Path(raw).name if "/" in raw else (raw or Path(path).name)
        return re.sub(r"\.vmd$", "", source, flags=re.IGNORECASE) or Path(path).stem

    def remember_vmd(path: str, name: str | None = None) -> Dict[str, Any]:
        data = load_runtime_state()
        item = {"path": path, "name": display_vmd_name(path, name)}
        history = [
            v for v in data.get("vmds", [])
            if isinstance(v, dict) and v.get("path") != path
        ]
        history.insert(0, item)
        data["last_vmd"] = item
        data["vmds"] = history[:50]
        runtime_state_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return item

    def forget_vmd(path: str) -> None:
        data = load_runtime_state()
        data["vmds"] = [
            v for v in data.get("vmds", [])
            if isinstance(v, dict) and v.get("path") != path
        ]
        if isinstance(data.get("last_vmd"), dict) and data["last_vmd"].get("path") == path:
            data.pop("last_vmd", None)
        runtime_state_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,DELETE,OPTIONS"
        return response

    def safe_send(root: Path, filename: str):
      safe = os.path.normpath(filename).replace("\\", "/")
      if safe.startswith("../") or safe.startswith("/") or safe == "..":
          return "Forbidden", 403
      full = (root / safe).resolve()
      if root not in full.parents and full != root:
          return "Forbidden", 403
      if not full.exists():
          return "Not Found", 404
      return send_from_directory(root, safe)

    @app.route("/")
    def index():
        if (renderer_dist / "index.html").exists():
            return send_from_directory(renderer_dist, "index.html")
        return jsonify({
            "ok": True,
            "app": "qwenpaw-mmd-companion",
            "renderer": "http://127.0.0.1:5178/?bridge=http://127.0.0.1:8098",
            "note": "Renderer dist not found. Run npm run build in renderers/three-modern.",
        })

    @app.route("/health")
    def health():
        return jsonify({
            "ok": True,
            "service": "qwenpaw-mmd-companion",
            "bridgeFile": __file__,
            "python": sys.executable,
            "routes": sorted(str(rule) for rule in app.url_map.iter_rules()),
        })

    @app.route("/plugin/<path:filename>")
    def plugin_static(filename: str):
        return safe_send(frontend_root, filename)

    @app.route("/assets/<path:filename>")
    def renderer_assets(filename: str):
        return safe_send(renderer_dist / "assets", filename)

    @app.route("/ammo.js")
    def renderer_ammo():
        return safe_send(renderer_dist, "ammo.js")

    @app.route("/libs/<path:filename>")
    def libs_static(filename: str):
        return safe_send(workspace_root / "libs", filename)

    @app.route("/motion_artisan/<path:filename>")
    def motion_artisan_static(filename: str):
        return safe_send(workspace_root / "motion_artisan", filename)

    @app.route("/models/<path:filename>")
    def model_static(filename: str):
        return safe_send(workspace_root / "models", filename)

    @app.route("/runtime/models/<path:filename>")
    def runtime_model_static(filename: str):
        return safe_send(runtime_models, filename)

    @app.route("/renderer.js")
    def renderer_static():
        return send_from_directory(workspace_root, "renderer.js")

    @app.route("/api/models")
    def api_models():
        model_dir = workspace_root / "models"
        entries = []
        runtime_state = load_runtime_state()
        scene_model_path = runtime_state.get("scene_model", {}).get("path")
        for root_dir, prefix_root in ((model_dir, workspace_root), (runtime_models, runtime_models.parent.parent)):
            if root_dir.is_dir():
                for path in root_dir.rglob("*.pmx"):
                    if (path.parent / ".qwenpaw-scene-model").exists():
                        continue
                    rel = path.relative_to(prefix_root).as_posix()
                    if rel == scene_model_path:
                        continue
                    entries.append({
                        "path": rel,
                        "name": path.stem,
                        "size": path.stat().st_size,
                    })
        return jsonify(entries)

    def fix_zip_encoding(root: Path) -> None:
        for current, dirs, files in os.walk(root, topdown=False):
            for name in files + dirs:
                old = Path(current) / name
                try:
                    fixed = name.encode("cp437").decode("gbk", errors="ignore")
                    if fixed and fixed != name:
                        new = Path(current) / fixed
                        if not new.exists():
                            old.rename(new)
                except Exception:
                    pass

    def clean_extracted(root: Path) -> None:
        for current, dirs, files in os.walk(root, topdown=False):
            for d in dirs:
                if d == "__MACOSX" or d.startswith("._"):
                    shutil.rmtree(Path(current) / d, ignore_errors=True)
            for f in files:
                if f.startswith("._") or f == ".DS_Store":
                    try:
                        (Path(current) / f).unlink()
                    except OSError:
                        pass

    def safe_model_name(name: str) -> str:
        cleaned = re.sub(r'[\\/:*?"<>|]', "_", name).strip()
        return cleaned or "model"

    def display_model_name(path: str, name: str | None = None) -> str:
        raw = str(name or "").replace("\\", "/")
        source = Path(raw).name if "/" in raw else (raw or Path(path).name)
        return re.sub(r"\.pmx$", "", source, flags=re.IGNORECASE) or Path(path).stem

    def model_identity(path: str, name: str | None = None) -> str:
        base = safe_model_name(display_model_name(path, name)).lower()
        return re.sub(r"_\d+$", "", base)

    def resolve_model_path(path: str) -> Path:
        safe = os.path.normpath(path or "").replace("\\", "/").lstrip("/")
        if safe.startswith("runtime/models/"):
            return (workspace_root / "qwenpaw-mmd-companion" / safe).resolve()
        return (workspace_root / safe).resolve()

    def model_file_exists(path: str) -> bool:
        try:
            full = resolve_model_path(path)
            return full.exists() and full.is_file() and full.suffix.lower() == ".pmx"
        except Exception:
            return False

    def is_scene_model_path(path: str) -> bool:
        full = resolve_model_path(path)
        return (full.parent / ".qwenpaw-scene-model").exists()

    @app.route("/api/models/upload", methods=["OPTIONS"])
    def api_models_upload_options():
        return "", 204

    @app.route("/api/models/upload", methods=["POST"])
    def api_models_upload():
        uploaded = request.files.get("file")
        if uploaded is None:
            return jsonify({"ok": False, "error": "missing file"}), 400
        filename = uploaded.filename or "model.zip"
        if not filename.lower().endswith(".zip"):
            return jsonify({"ok": False, "error": "only .zip packages are supported"}), 400
        remember = request.form.get("remember", "1") != "0"

        try:
            with tempfile.TemporaryDirectory(prefix="qwenpaw-mmd-") as tmp:
                tmpdir = Path(tmp)
                zip_path = tmpdir / "model.zip"
                uploaded.save(zip_path)
                with zipfile.ZipFile(zip_path, "r") as zf:
                    for info in zf.infolist():
                        entry = info.filename.replace("\\", "/")
                        parts = Path(entry).parts
                        if entry.startswith("/") or ".." in parts:
                            return jsonify({"ok": False, "error": f"unsafe zip entry: {info.filename}"}), 400
                    zf.extractall(tmpdir)

                fix_zip_encoding(tmpdir)
                clean_extracted(tmpdir)

                pmx_path = None
                for path in tmpdir.rglob("*.pmx"):
                    if not path.name.startswith("._"):
                        pmx_path = path
                        break
                if pmx_path is None:
                    return jsonify({"ok": False, "error": "no .pmx file found in zip"}), 400

                model_name = safe_model_name(pmx_path.stem)
                target_dir = runtime_models / model_name
                suffix = 2
                while target_dir.exists():
                    target_dir = runtime_models / f"{model_name}_{suffix}"
                    suffix += 1
                model_name = target_dir.name

                src_dir = pmx_path.parent
                target_dir.mkdir(parents=True, exist_ok=True)
                for item in src_dir.iterdir():
                    if item.name == "__MACOSX" or item.name.startswith("._"):
                        continue
                    dest = target_dir / item.name
                    if item.is_dir():
                        shutil.copytree(
                            item,
                            dest,
                            ignore=lambda _d, names: [n for n in names if n.startswith("._")],
                        )
                    else:
                        shutil.copy2(item, dest)

                if src_dir != tmpdir:
                    for item in tmpdir.iterdir():
                        if item.is_file() and not item.name.startswith("._"):
                            dest = target_dir / item.name
                            if not dest.exists():
                                shutil.copy2(item, dest)

                final_pmx = target_dir / f"{model_name}.pmx"
                if not final_pmx.exists():
                    for path in target_dir.rglob("*.pmx"):
                        if not path.name.startswith("._"):
                            if path != final_pmx:
                                shutil.move(str(path), str(final_pmx))
                            break

                vmds = [
                    f"runtime/models/{p.relative_to(runtime_models).as_posix()}"
                    for p in target_dir.rglob("*.vmd")
                    if not p.name.startswith("._")
                ]
                for vmd_path in vmds:
                    remember_vmd(vmd_path, Path(vmd_path).name)
                model_path = f"runtime/models/{model_name}/{model_name}.pmx"
                if remember:
                    remember_model(model_path, model_name, vmds)
                else:
                    (target_dir / ".qwenpaw-scene-model").write_text("1", encoding="utf-8")
                    forget_model(model_path)
                return jsonify({
                    "ok": True,
                    "name": model_name,
                    "path": model_path,
                    "vmds": vmds,
                })
        except zipfile.BadZipFile:
            return jsonify({"ok": False, "error": "invalid zip file"}), 400
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 500

    @app.route("/api/vmds/upload", methods=["OPTIONS"])
    def api_vmds_upload_options():
        return "", 204

    @app.route("/api/vmds/upload", methods=["POST"])
    def api_vmds_upload():
        uploaded = request.files.get("file")
        if uploaded is None:
            return jsonify({"ok": False, "error": "missing file"}), 400
        filename = uploaded.filename or "motion.vmd"
        if not filename.lower().endswith(".vmd"):
            return jsonify({"ok": False, "error": "only .vmd files are supported"}), 400
        name = safe_model_name(Path(filename).stem)
        target_dir = runtime_models / "_vmd"
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{name}.vmd"
        suffix = 2
        while target.exists():
            target = target_dir / f"{name}_{suffix}.vmd"
            suffix += 1
        uploaded.save(target)
        vmd_path = f"runtime/models/_vmd/{target.name}"
        item = remember_vmd(vmd_path, filename)
        return jsonify({"ok": True, "vmd": item})

    @app.route("/api/runtime/last-model", methods=["GET", "POST", "DELETE", "OPTIONS"])
    def api_runtime_last_model():
        if request.method == "OPTIONS":
            return "", 204
        if request.method == "DELETE":
            data = request.get_json(silent=True) or {}
            path = data.get("path") or request.args.get("path")
            if not path:
                return jsonify({"ok": False, "error": "missing path"}), 400
            forget_model(path)
            return jsonify({"ok": True})
        if request.method == "POST":
            data = request.get_json(silent=True) or {}
            path = data.get("path")
            if not path:
                return jsonify({"ok": False, "error": "missing path"}), 400
            if is_scene_model_path(path):
                return jsonify({"ok": False, "error": "scene model cannot be saved as avatar"}), 400
            item = remember_model(path, data.get("name"), data.get("vmds") or [])
            return jsonify({"ok": True, "last_model": item})
        data = load_runtime_state()
        models = [
            model for model in data.get("models", [])
            if isinstance(model, dict) and model_file_exists(model.get("path", ""))
        ]
        if len(models) != len(data.get("models", [])):
            data["models"] = models
            if isinstance(data.get("last_model"), dict) and not model_file_exists(data["last_model"].get("path", "")):
                data.pop("last_model", None)
            runtime_state_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        if not models and data.get("last_model"):
            models = [data["last_model"]]
        return jsonify({
            "ok": True,
            "last_model": data.get("last_model"),
            "models": models,
        })

    @app.route("/api/runtime/scene-model", methods=["GET", "POST", "DELETE", "OPTIONS"])
    def api_runtime_scene_model():
        if request.method == "OPTIONS":
            return "", 204
        if request.method == "DELETE":
            data = request.get_json(silent=True) or {}
            path = data.get("path") or request.args.get("path")
            if not path:
                return jsonify({"ok": False, "error": "missing path"}), 400
            forget_scene_model(path)
            return jsonify({"ok": True})
        if request.method == "POST":
            data = request.get_json(silent=True) or {}
            path = data.get("path")
            if not path:
                return jsonify({"ok": False, "error": "missing path"}), 400
            item = remember_scene_model(path, data.get("name"))
            return jsonify({"ok": True, "scene_model": item})
        data = load_runtime_state()
        scene_models = [
            model for model in data.get("scene_models", [])
            if isinstance(model, dict) and model_file_exists(model.get("path", ""))
        ]
        if isinstance(data.get("scene_model"), dict) and model_file_exists(data["scene_model"].get("path", "")):
            current = data["scene_model"]
            if not any(model.get("path") == current.get("path") for model in scene_models):
                scene_models.insert(0, current)
        scene_models = [
            {"path": model.get("path"), "name": display_model_name(model.get("path", ""), model.get("name"))}
            for model in scene_models
            if model.get("path")
        ]
        if len(scene_models) != len(data.get("scene_models", [])):
            data["scene_models"] = scene_models
            if isinstance(data.get("scene_model"), dict) and not model_file_exists(data["scene_model"].get("path", "")):
                data["scene_model"] = scene_models[0] if scene_models else None
            runtime_state_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return jsonify({
            "ok": True,
            "scene_model": data.get("scene_model"),
            "scene_models": scene_models,
        })

    @app.route("/api/runtime/vmds", methods=["GET", "POST", "DELETE", "OPTIONS"])
    def api_runtime_vmds():
        if request.method == "OPTIONS":
            return "", 204
        if request.method == "DELETE":
            data = request.get_json(silent=True) or {}
            path = data.get("path") or request.args.get("path")
            if not path:
                return jsonify({"ok": False, "error": "missing path"}), 400
            forget_vmd(path)
            return jsonify({"ok": True})
        if request.method == "POST":
            data = request.get_json(silent=True) or {}
            path = data.get("path")
            if not path:
                return jsonify({"ok": False, "error": "missing path"}), 400
            item = remember_vmd(path, data.get("name"))
            return jsonify({"ok": True, "vmd": item})
        data = load_runtime_state()
        vmds = [
            {
                "path": vmd.get("path"),
                "name": display_vmd_name(vmd.get("path", ""), vmd.get("name")),
            }
            for vmd in data.get("vmds", [])
            if isinstance(vmd, dict) and vmd.get("path") and (workspace_root / "qwenpaw-mmd-companion" / vmd.get("path")).exists()
        ]
        if len(vmds) != len(data.get("vmds", [])):
            data["vmds"] = vmds
            if isinstance(data.get("last_vmd"), dict) and not any(v.get("path") == data["last_vmd"].get("path") for v in vmds):
                data.pop("last_vmd", None)
            runtime_state_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return jsonify({
            "ok": True,
            "last_vmd": data.get("last_vmd"),
            "vmds": vmds,
        })

    @app.route("/api/avatar/command", methods=["OPTIONS"])
    def api_command_options():
        return "", 204

    @app.route("/api/avatar/command", methods=["POST"])
    def api_command():
        data = request.get_json(silent=True) or {}
        command_type = data.get("type")
        payload = data.get("payload") or {}
        if not command_type:
            return jsonify({"ok": False, "error": "missing command type"}), 400

        command = command_to_dict(make_command(command_type, payload))
        commands.append(command)
        state["last_command"] = command
        if command_type == "load_model":
            state["model"] = payload.get("path")
        elif command_type == "play_vmd":
            state["motion"] = payload.get("path")
        elif command_type == "set_mood":
            state["mood"] = payload.get("mood", state["mood"])
        elif command_type == "set_expression":
            state["expression"] = payload
        elif command_type == "stop":
            state["motion"] = None
        return jsonify({"ok": True, "command": command, "state": state})

    @app.route("/api/avatar/commands")
    def api_commands():
        drained = list(commands)
        commands.clear()
        return jsonify({"ok": True, "commands": drained})

    @app.route("/api/avatar/state")
    def api_state():
        return jsonify({"ok": True, "state": state})

    @app.route("/api/qwenpaw/message", methods=["OPTIONS"])
    def api_qwenpaw_message_options():
        return "", 204

    @app.route("/api/qwenpaw/message", methods=["POST"])
    def api_qwenpaw_message():
        data = request.get_json(silent=True) or {}
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"ok": False, "error": "missing text"}), 400
        endpoint = get_qwenpaw_api_base()
        if not endpoint:
            return jsonify({
                "ok": False,
                "error": "QwenPaw API endpoint not found",
                "text": text,
            }), 501
        try:
            session_id = data.get("session_id") or "qwenpaw-mmd-companion"
            user_id = data.get("user_id") or "mmd-user"
            body = json.dumps({
                "session_id": session_id,
                "user_id": user_id,
                "channel": "console",
                "input": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": text,
                            }
                        ],
                    }
                ],
                "meta": {
                    "source": "qwenpaw-mmd-companion",
                    "sent_at": time.time(),
                },
            }, ensure_ascii=False).encode("utf-8")
            req = urlrequest.Request(
                endpoint,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlrequest.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            payload = extract_sse_text(raw) if "data:" in raw else {"text": raw}
            return jsonify({"ok": True, "endpoint": endpoint, "response": payload})
        except urlerror.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            return jsonify({"ok": False, "error": f"QwenPaw HTTP {exc.code}: {detail}"}), 502
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @app.route("/api/health")
    def api_health():
        return jsonify({"ok": True, "app": "qwenpaw-mmd-companion"})

    return app


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    create_app(root).run(host="127.0.0.1", port=8098, debug=True)
