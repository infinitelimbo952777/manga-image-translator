@echo off
REM =================================================================
REM ==  MANGA-IMAGE-TRANSLATOR - ONE-CLICK WEB UI LAUNCHER          ==
REM ==                                                              ==
REM ==  Starts the backend (:8000) and the React frontend (:5173),  ==
REM ==  then opens http://localhost:5173 in your default browser.  ==
REM ==  Stop both servers by closing the two service windows.      ==
REM =================================================================
setlocal
cd /d "%~dp0"
title manga-image-translator launcher

REM ---- Pick a python that has the backend deps (repo venv first, then PATH) ----
set "PYTHON="
if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" -c "import fastapi, uvicorn" >nul 2>nul && set "PYTHON=%~dp0venv\Scripts\python.exe"
)
if not defined PYTHON (
    python -c "import fastapi, uvicorn" >nul 2>nul && set "PYTHON=python"
)
if not defined PYTHON (
    echo [ERROR] No python with fastapi+uvicorn found. Run: pip install -r requirements.txt
    pause
    exit /b 1
)

REM ---- npm is required for the frontend ----
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found in PATH. Please install Node.js first.
    pause
    exit /b 1
)

REM ---- Auto-detect CUDA and enable --use-gpu when available ----
set "GPU_FLAG="
"%PYTHON%" -c "import sys; sys.exit(0 if __import__('torch').cuda.is_available() else 1)" >nul 2>nul
if not errorlevel 1 (
    set "GPU_FLAG=--use-gpu"
    echo [INFO] CUDA available - backend will start with --use-gpu
) else (
    echo [INFO] No CUDA available - backend will run on CPU
)

REM ---- Backend on :8000, skipped if it is already running ----
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/docs' -TimeoutSec 2)|Out-Null; exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
    echo [INFO] Starting backend on http://127.0.0.1:8000 ...
    start "mit-backend :8000" cmd /k "cd /d %~dp0server && %PYTHON% main.py %GPU_FLAG%"
) else (
    echo [INFO] Backend already running on :8000 - skipping.
)

REM ---- Frontend dependencies, first run only ----
if not exist "front\node_modules" (
    echo [INFO] Installing frontend dependencies - this may take a few minutes ...
    pushd front
    call npm install || (popd & echo [ERROR] npm install failed. & pause & exit /b 1)
    popd
)

REM ---- Frontend dev server on :5173, skipped if already running ----
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing 'http://localhost:5173/' -TimeoutSec 2)|Out-Null; exit 0}catch{exit 1}" >nul 2>nul
if errorlevel 1 (
    echo [INFO] Starting frontend dev server on http://localhost:5173 ...
    start "mit-frontend :5173" cmd /k "cd /d %~dp0front && npm run dev"
) else (
    echo [INFO] Frontend already running on :5173 - skipping.
)

REM ---- Wait for both services, then open the browser ----
echo [INFO] Waiting for the services to come up ...
call :wait_for "http://127.0.0.1:8000/docs" 120
call :wait_for "http://localhost:5173/" 300
start "" "http://localhost:5173/"

echo.
echo  =================================================
echo   Web UI :  http://localhost:5173
echo   API    :  http://127.0.0.1:8000/docs
echo   Stop   :  close the two service windows
echo  =================================================
REM Auto-close this launcher window; the two service windows keep running.
ping -n 9 127.0.0.1 >nul
endlocal
exit /b 0

:wait_for
REM Poll %~1 every second, give up after %2 seconds.
powershell -NoProfile -Command "for($i=0;$i -lt %2;$i++){try{(Invoke-WebRequest -UseBasicParsing '%~1' -TimeoutSec 2)|Out-Null; exit 0}catch{Start-Sleep -Seconds 1}}; exit 1" >nul 2>nul
if errorlevel 1 echo [WARN] %~1 did not respond in time - opening the browser anyway.
goto :eof
