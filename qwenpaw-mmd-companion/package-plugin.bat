@echo off
setlocal
cd /d "%~dp0"

set OUT=%~dp0..\qwenpaw-mmd-companion.zip
if exist "%OUT%" del "%OUT%"

echo Creating plugin zip...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Compress-Archive -Path '%~dp0*' -DestinationPath '%OUT%' -Force"

if errorlevel 1 (
  echo Failed to create plugin zip.
  pause
  exit /b 1
)

echo.
echo Plugin zip created:
echo %OUT%
echo.
echo You can import this zip from QwenPaw's plugin page.
pause
