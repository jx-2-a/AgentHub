@echo off
rem ============================================================
rem  AgentHub manual start: runs launch_hub.vbs (hidden, no black box)
rem  Web : http://localhost:8500  (phone via Tailscale)
rem  Log : data\hub.log
rem  Stop: panel restart/stop, or kill the python -m hub.launch process
rem ============================================================
cd /d "%~dp0"

if not exist "D:\PyVenv\AgentHub\.venv\Scripts\python.exe" (
    echo [ERROR] venv not found: D:\PyVenv\AgentHub\.venv
    pause
    exit /b 1
)

rem ---- launch hidden (no black box) ----
wscript.exe "%~dp0launch_hub.vbs"

echo [OK] AgentHub started in background (hidden).
echo   Web : http://localhost:8500
echo   Log : data\hub.log
ping -n 4 127.0.0.1 >nul
