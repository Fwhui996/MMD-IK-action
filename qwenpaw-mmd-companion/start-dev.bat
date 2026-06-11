@echo off
setlocal
cd /d "%~dp0"

set QWENPAW_MMD_DEV_RENDERER=1
set RENDERER_DIR=%~dp0renderers\three-modern
if not exist "%RENDERER_DIR%\node_modules" (
  echo Installing renderer dependencies...
  pushd "%RENDERER_DIR%"
  call npm install
  if errorlevel 1 (
    popd
    echo npm install failed.
    pause
    exit /b 1
  )
  popd
)

echo Starting QwenPaw MMD Companion...
echo.
echo Bridge:   http://127.0.0.1:8098
echo Renderer: http://127.0.0.1:5178/?bridge=http://127.0.0.1:8098
echo.
echo Keep this window open. Press Ctrl+C to stop.
echo.
python "%~dp0backend\desktop_app.py"
