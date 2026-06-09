#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MMD Motion Artisan — 开发服务器
启动: python server.py [端口号]
默认端口: 8080

仅用于本地开发和演示。不支持生产使用。
"""

import os
import sys
from flask import Flask, send_from_directory, jsonify, request

ROOT = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)

@app.route("/")
def index_redirect():
    return send_from_directory(ROOT, "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    # 安全检查: 不允许路径遍历
    safe = os.path.normpath(filename)
    if safe.startswith("..") or safe.startswith("/"):
        return "Forbidden", 403
    full = os.path.join(ROOT, safe)
    if not os.path.exists(full):
        return "Not Found", 404
    return send_from_directory(ROOT, safe)

@app.route("/api/models")
def api_models_list():
    """扫描 models/ 目录下的 PMX 文件"""
    import glob, fnmatch
    model_dir = os.path.join(ROOT, "models")
    entries = []
    if os.path.isdir(model_dir):
        for root_dir, dirs, files in os.walk(model_dir):
            for f in files:
                if fnmatch.fnmatch(f.lower(), "*.pmx"):
                    full = os.path.join(root_dir, f)
                    fsize = os.path.getsize(full)
                    parent = os.path.basename(root_dir)
                    fname_noext = f[:-4]
                    # 过滤配件
                    if fname_noext != parent and fsize < 500000:
                        continue
                    rel = os.path.relpath(full, ROOT).replace("\\", "/")
                    name = parent if fname_noext == parent else fname_noext
                    entries.append({"path": rel, "name": name, "size": fsize})
    return jsonify(entries)

@app.route("/api/health")
def api_health():
    return jsonify({"status": "ok", "app": "MMD Motion Artisan"})

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"\n  MMD Motion Artisan Server")
    print(f"  =========================")
    print(f"  → http://localhost:{port}/")
    print(f"  → 放置 PMX 模型到 models/ 目录")
    print(f"  → Ctrl+C 停止\n")
    app.run(host="0.0.0.0", port=port, debug=True)
