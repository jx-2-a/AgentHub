@echo off
rem ============================================================
rem  AgentHub 手动启动：经 launch_hub.vbs 后台隐藏启动（无黑框）
rem  双击或运行 start.bat
rem  Web : http://localhost:8500 （手机走 Tailscale: http://100.x.x.x:8500）
rem  Log : data\hub.log
rem  停止: 面板「重启/停止」按钮,或直接结束 python -m hub.launch 进程
rem ============================================================
cd /d "%~dp0"

if not exist "D:\PyVenv\AgentHub\.venv\Scripts\python.exe" (
    echo [ERROR] venv 不存在: D:\PyVenv\AgentHub\.venv
    pause
    exit /b 1
)

rem ---- 后台隐藏启动（无黑框）----
wscript.exe "%~dp0launch_hub.vbs"

echo [OK] AgentHub 已在后台启动（隐藏窗口）。
echo   Web : http://localhost:8500
echo   Log : data\hub.log
ping -n 4 127.0.0.1 >nul
