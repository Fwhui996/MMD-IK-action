from __future__ import annotations

import os
import re
import shutil
import tempfile
import zipfile
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
    runtime_models.mkdir(parents=True, exist_ok=True)
    app = Flask(__name__)
    commands: List[Dict[str, Any]] = []
    state: Dict[str, Any] = {
        "model": None,
        "motion": None,
        "mood": "neutral",
        "expression": None,
        "last_command": None,
    }

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
        return jsonify({"ok": True, "service": "qwenpaw-mmd-companion"})

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
                return jsonify({
                    "ok": True,
                    "name": model_name,
                    "path": f"runtime/models/{model_name}/{model_name}.pmx",
                    "vmds": vmds,
                })
        except zipfile.BadZipFile:
            return jsonify({"ok": False, "error": "invalid zip file"}), 400
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 500

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
