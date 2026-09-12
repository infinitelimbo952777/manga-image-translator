@echo off
REM Stop the hidden web UI processes (see start_webui_silent.bat).
REM Also kills anything left listening on ports 8000 / 8001 / 5173.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0devscripts\webui_stop.ps1"
REM `ping` is used instead of `timeout` to dodge PATH conflicts with Git Bash.
ping -n 6 127.0.0.1 >nul
