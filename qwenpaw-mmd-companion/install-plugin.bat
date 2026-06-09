@echo off
setlocal
cd /d "%~dp0"

where qwenpaw >nul 2>nul
if errorlevel 1 (
  echo qwenpaw command was not found in PATH.
  echo.
  echo Open QwenPaw's terminal/environment, then run:
  echo   qwenpaw plugin install "%~dp0"
  echo.
  pause
  exit /b 1
)

echo Installing QwenPaw MMD Companion plugin...
qwenpaw plugin install "%~dp0"
if errorlevel 1 (
  echo.
  echo Plugin install failed.
  pause
  exit /b 1
)

echo.
echo Installed. Restart QwenPaw to load the plugin.
pause
