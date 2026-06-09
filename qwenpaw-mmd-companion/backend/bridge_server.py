from __future__ import annotations

import os
import re
import shutil
import tempfile
import zipfile
import sys
import json
from pathlib import Path
from typing import Any, Dict, List

from flask import Flask, jsonify, request, send_from_directory

try:
    from .avatar_tools import command_to_dict, make_command
except ImportError:
    from avatar_tools import command_to_dict, make_command


def create_app(workspace_root: Path) -> Flask:
    workspace_root = workspace_root.resolve()
    frontend_root = workspace_root / "qwenpaw-mmd-companion" / "frontend"
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

    def remember_model(path: str, name: str | None = None, vmds: List[str] | None = None) -> Dict[str, Any]:
        data = load_runtime_state()
        item = {
            "path": path,
            "name": name or Path(path).stem,
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

    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
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
        return jsonify({
            "ok": True,
            "app": "qwenpaw-mmd-companion",
            "renderer": "http://127.0.0.1:5178/?bridge=http://127.0.0.1:8098",
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
        for root_dir, prefix_root in ((model_dir, workspace_root), (runtime_models, runtime_models.parent.parent)):
            if root_dir.is_dir():
                for path in root_dir.rglob("*.pmx"):
                    rel = path.relative_to(prefix_root).as_posix()
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

    def model_identity(path: str, name: str | None = None) -> str:
        base = safe_model_name(name or Path(path).stem).lower()
        return re.sub(r"_\d+$", "", base)

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
                model_path = f"runtime/models/{model_name}/{model_name}.pmx"
                remember_model(model_path, model_name, vmds)
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

    @app.route("/api/runtime/last-model", methods=["GET", "POST", "OPTIONS"])
    def api_runtime_last_model():
        if request.method == "OPTIONS":
            return "", 204
        if request.method == "POST":
            data = request.get_json(silent=True) or {}
            path = data.get("path")
            if not path:
                return jsonify({"ok": False, "error": "missing path"}), 400
            item = remember_model(path, data.get("name"), data.get("vmds") or [])
            return jsonify({"ok": True, "last_model": item})
        data = load_runtime_state()
        models = data.get("models", [])
        if not models and data.get("last_model"):
            models = [data["last_model"]]
        return jsonify({
            "ok": True,
            "last_model": data.get("last_model"),
            "models": models,
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

    @app.route("/api/health")
    def api_health():
        return jsonify({"ok": True, "app": "qwenpaw-mmd-companion"})

    return app


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    create_app(root).run(host="127.0.0.1", port=8098, debug=True)
