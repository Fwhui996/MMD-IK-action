@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════╗
echo   ║  MMD Motion Artisan Engine  ║
echo   ╚══════════════════════════════╝
echo.

REM Kill old process on port 8080
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080.*LISTENING" 2^>nul') do (
    echo [Killing old process PID=%%a]
    taskkill /PID %%a /F >nul 2>nul
)

echo [Starting server...]
start "MMD-Motion-Artisan" cmd /k "cd /d %~dp0 && echo === MMD Motion Artisan Server === && python server.py 8080"

timeout /t 3 /nobreak >nul

echo [Opening browser...]
start http://localhost:8080/

echo.
echo   Server: http://localhost:8080/
echo   Models: place .pmx files in models/ folder
echo   Stop:   Ctrl+C in server window
echo.
pause
