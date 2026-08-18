@echo off
title AgentHub
rem ============================================================
rem  AgentHub launcher (called by launch_hub.vbs, minimized window)
rem  Idempotent: skip if the hub port is already listening.
rem  Gotify is spawned by the hub itself (child process, Task Manager grouping).
rem ============================================================
cd /d "%~dp0"

netstat -ano | findstr /c:":8500 " | findstr /c:"LISTENING" >nul 2>&1
if not errorlevel 1 exit /b 0

set PY=D:\PyVenv\AgentHub\.venv\Scripts\python.exe
if not exist "%PY%" set PY=python
if not exist "data" mkdir data

"%PY%" -m hub.launch --port 8500 --bind 0.0.0.0 --data data >> data\hub.log 2>&1
