@echo off
rem ============================================================
rem  AgentHub 后台启动器（经 launch_hub.vbs 调用，隐藏窗口无黑框）
rem  幂等：端口已被占用说明服务已在运行 → 静默跳过，不影响现有服务。
rem  先起 Gotify（80 端口，隐藏），再起 hub（8500，绑定 0.0.0.0）。
rem ============================================================
cd /d "%~dp0"

rem ---- Gotify：80 未被监听才启动 ----
netstat -ano | findstr /r ":80 .*LISTENING" >nul 2>&1
if errorlevel 1 (
    if exist "%~dp0launch_gotify.vbs" if exist "gotify\gotify-windows-amd64.exe" (
        wscript.exe "%~dp0launch_gotify.vbs"
    )
)

rem ---- Hub：8500 未被监听才启动 ----
netstat -ano | findstr /r ":8500 .*LISTENING" >nul 2>&1
if not errorlevel 1 exit /b 0

set PY=D:\PyVenv\AgentHub\.venv\Scripts\python.exe
if not exist "%PY%" set PY=python
if not exist "data" mkdir data

"%PY%" -m hub.launch --port 8500 --bind 0.0.0.0 --data data >> data\hub.log 2>&1
