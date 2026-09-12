@echo off
REM =================================================================
REM ==  MANGA-IMAGE-TRANSLATOR - SILENT WEB UI LAUNCHER             ==
REM ==                                                              ==
REM ==  Same as start_webui.bat but with NO console windows:        ==
REM ==  services run hidden, output goes to logs\, and the browser  ==
REM ==  opens automatically. Stop everything with stop_webui.bat    ==
REM =================================================================
REM `start` detaches PowerShell so this launcher window closes at once.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0devscripts\webui_silent.ps1"
exit /b 0
