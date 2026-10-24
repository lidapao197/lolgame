@echo off
title LOL 赛事日历 - 本地服务
cd /d "%~dp0"

echo ==========================================
echo   LOL 赛事日历 - 本地开发服务
echo ==========================================
echo.

%SystemRoot%\System32\where.exe node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node 18 或更高版本。
    echo 下载地址: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo ============正在启动本地服务...
echo.

node server.js

echo.
echo 本地服务已停止。
pause
