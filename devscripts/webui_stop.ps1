# Stop the manga-image-translator web UI processes started by the
# silent launcher (pid files in logs\) and, as a fallback, anything
# still listening on ports 8000 / 8001 / 5173.

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root "logs"

function Kill-UpThroughCmdWrappers($procId) {
    # Kill the process, then also kill cmd.exe ancestors so no dead
    # `cmd /k` service windows are left behind.
    taskkill /PID $procId /T /F | Out-Null
    $current = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId").ParentProcessId
    for ($i = 0; $i -lt 5 -and $current; $i++) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$current"
        if (-not $parent) { break }
        if ($parent.Name -ieq "cmd.exe") {
            Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue
            $current = $parent.ParentProcessId
        } else {
            break
        }
    }
}

$stopped = 0

# ---- preferred: pid files written by the silent launcher ----
foreach ($name in @("backend", "frontend")) {
    $pidFile = Join-Path $logs "$name.pid"
    if (Test-Path $pidFile) {
        $recorded = (Get-Content $pidFile | Select-Object -First 1)
        if ("$recorded" -match '^\d+$') {
            if (Get-Process -Id $recorded -ErrorAction SilentlyContinue) {
                Kill-UpThroughCmdWrappers $recorded
                Write-Host "Stopped $name (pid $recorded)."
                $stopped++
            }
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

# ---- fallback: anything still listening on our ports ----
foreach ($port in @(8000, 8001, 5173)) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $listeners) {
        $owner = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($owner -and @("System", "Idle") -notcontains $owner.ProcessName) {
            Kill-UpThroughCmdWrappers $owner.Id
            Write-Host "Stopped $($owner.ProcessName) (pid $($owner.Id)) on port $port."
            $stopped++
        }
    }
}

if ($stopped -eq 0) {
    Write-Host "Nothing to stop - the web UI is not running."
} else {
    Write-Host "All web UI processes stopped."
}
