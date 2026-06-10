# -*- coding: utf-8 -*-
"""Desktop bridge process for the modern Three.js MMD companion."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import threading
from pathlib import Path

try:
    from .bridge_server import create_app
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from backend.bridge_server import create_app


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = PLUGIN_ROOT.parent


def _run_bridge(host: str, port: int) -> None:
    app = create_app(WORKSPACE_ROOT)
    app.run(host=host, port=port, debug=False, use_reloader=False)


def _run_renderer(port: int) -> subprocess.Popen:
    renderer_dir = PLUGIN_ROOT / "renderers" / "three-modern"
    npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
    cmd = [
        npm_cmd,
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        "5178",
    ]
    env = os.environ.copy()
    env["QWENPAW_MMD_BRIDGE_URL"] = f"http://127.0.0.1:{port}"
    return subprocess.Popen(
        cmd,
        cwd=str(renderer_dir),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run MMD companion bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8098)
    parser.add_argument("--no-renderer", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    renderer_proc = None
    dist_index = PLUGIN_ROOT / "renderers" / "three-modern" / "dist" / "index.html"
    use_vite = os.environ.get("QWENPAW_MMD_DEV_RENDERER", "0") == "1"
    if not args.no_renderer and use_vite:
        renderer_proc = _run_renderer(args.port)
        print("Renderer URL: http://127.0.0.1:5178/?bridge=http://127.0.0.1:%s" % args.port)
    elif dist_index.exists():
        print("Renderer URL: http://127.0.0.1:%s/" % args.port)
    elif not args.no_renderer:
        renderer_proc = _run_renderer(args.port)
        print("Renderer URL: http://127.0.0.1:5178/?bridge=http://127.0.0.1:%s" % args.port)

    bridge_thread = threading.Thread(
        target=_run_bridge,
        args=(args.host, args.port),
        daemon=True,
    )
    bridge_thread.start()

    try:
        bridge_thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        if renderer_proc is not None:
            renderer_proc.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
