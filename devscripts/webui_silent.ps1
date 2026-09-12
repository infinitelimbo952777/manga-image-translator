# Silent launcher for the manga-image-translator web UI.
# Starts backend (:8000, auto-spawns worker on :8001) and frontend dev server
# (:5173) as HIDDEN processes, logs to logs\, records PIDs for stop_webui.bat,
# then opens the browser when both services are ready.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

function Show-Error($text) {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    [System.Windows.Forms.MessageBox]::Show($text, "manga-image-translator") | Out-Null
}

function Test-Url($url) {
    try {
        Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Wait-Url($url, $seconds) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Test-Url $url) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

# ---- pick a python that has the backend deps (repo venv first, then PATH) ----
$py = $null
$candidates = @()
$venvPy = Join-Path $root "venv\Scripts\python.exe"
if (Test-Path $venvPy) { $candidates += $venvPy }
$candidates += "python"
foreach ($candidate in $candidates) {
    try { & $candidate -c "import fastapi, uvicorn" 2>$null } catch { continue }
    if ($LASTEXITCODE -eq 0) { $py = $candidate; break }
}
if (-not $py) {
    Show-Error "No python with fastapi+uvicorn found. Run: pip install -r requirements.txt"
    exit 1
}
# Full path so the hidden cmd.exe wrapper can run it unquoted (repo path has no spaces)
if (Test-Path $py) { $py = (Resolve-Path $py).Path }

# ---- npm check ----
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
    Show-Error "npm not found in PATH. Please install Node.js first."
    exit 1
}

# ---- GPU detect ----
$gpuFlag = ""
& $py -c "import sys; sys.exit(0 if __import__('torch').cuda.is_available() else 1)" 2>$null
if ($LASTEXITCODE -eq 0) { $gpuFlag = "--use-gpu" }

# ---- backend ----
if (Test-Url "http://127.0.0.1:8000/docs") {
    Write-Host "Backend already running on :8000, skipping."
} else {
    Write-Host "Starting backend on http://127.0.0.1:8000 (hidden)..."
    # Start-Process cannot combine -WindowStyle with output redirection,
    # so let a hidden cmd.exe do the redirection to log files.
    $cmdLine = "$py -u main.py $gpuFlag 1>`"$logs\backend.out.log`" 2>`"$logs\backend.err.log`""
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmdLine `
        -WorkingDirectory (Join-Path $root "server") -WindowStyle Hidden -PassThru
    $proc.Id | Set-Content (Join-Path $logs "backend.pid")
}

# ---- frontend deps (first run only) ----
if (-not (Test-Path (Join-Path $root "front\node_modules"))) {
    Write-Host "Installing frontend dependencies (first run, this takes a few minutes)..."
    $install = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npm install 1>`"$logs\npm-install.log`" 2>`"$logs\npm-install.err.log`"" `
        -WorkingDirectory (Join-Path $root "front") -WindowStyle Hidden -PassThru
    Wait-Process -Id $install.Id -Timeout 600 -ErrorAction SilentlyContinue
    if (-not (Test-Path (Join-Path $root "front\node_modules"))) {
        Show-Error "npm install failed. See logs\npm-install.err.log"
        exit 1
    }
}

# ---- frontend ----
if (Test-Url "http://localhost:5173/") {
    Write-Host "Frontend already running on :5173, skipping."
} else {
    Write-Host "Starting frontend dev server on http://localhost:5173 (hidden)..."
    $cmdLine = "npm run dev 1>`"$logs\frontend.out.log`" 2>`"$logs\frontend.err.log`""
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmdLine `
        -WorkingDirectory (Join-Path $root "front") -WindowStyle Hidden -PassThru
    $proc.Id | Set-Content (Join-Path $logs "frontend.pid")
}

# ---- wait for both services, then open the browser ----
Write-Host "Waiting for services to come up..."
[void](Wait-Url "http://127.0.0.1:8000/docs" 120)
[void](Wait-Url "http://localhost:5173/" 300)
Start-Process "http://localhost:5173/"
Write-Host "Web UI ready at http://localhost:5173 - processes run hidden, logs in logs\."
Write-Host "Stop everything with stop_webui.bat"
