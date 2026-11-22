# maintain-khyeast-restic.ps1
# Run only on the Windows maintenance host (office PC) with full local
# repository access. Never install these credentials on the application VPS.
#
# Windows equivalent of ops/maintain-khyeast-restic (Linux). It operates on
# the local repository directory, NOT through the append-only REST server, so
# that check/forget/prune can run. The VPS only ever holds the restricted
# REST credential; the encryption password file stays on this machine.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File maintain-khyeast-restic.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File maintain-khyeast-restic.ps1 -CheckOnly
#
# -CheckOnly runs `restic check` without applying retention. Use it for the
# first validation run before enabling the weekly scheduled task.

param(
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$Restic       = 'D:\KhyeastBackupSetup\restic\restic_0.20.0_windows_amd64.exe'
$Repository   = 'D:\KhyeastBackup\data\khyeast-vps\production'
$PasswordFile = 'D:\KhyeastBackup\auth\production-password.txt'
$CacheDir     = 'D:\KhyeastBackup\cache\maintenance'
$LogDir       = 'D:\KhyeastBackup\logs'
$LogFile      = Join-Path $LogDir 'maintenance.log'
$LockFile     = Join-Path $LogDir 'maintenance.lock'
$Tag          = 'khyeast-validated-archive'
$KeepDaily    = 14
$KeepWeekly   = 8
$KeepMonthly  = 12

function Write-Log {
    param([Parameter(Mandatory = $true)][string]$Message)
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -Path $LogFile -Value $line
    Write-Output $line
}

function Invoke-Restic {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Write-Log "restic $($Arguments -join ' ')"
    $output = & $Restic @Arguments 2>&1 | ForEach-Object { "$_" }
    $output | ForEach-Object { Write-Log "  $_" }
    if ($LASTEXITCODE -ne 0) {
        throw "restic $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

# --- Preflight -------------------------------------------------------------
foreach ($path in @($Restic, $Repository, $PasswordFile)) {
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Log "FATAL: required path is missing: $path"
        exit 1
    }
}
New-Item -ItemType Directory -Force -Path $CacheDir, $LogDir | Out-Null

$env:RESTIC_REPOSITORY     = $Repository
$env:RESTIC_PASSWORD_FILE  = $PasswordFile
$env:RESTIC_CACHE_DIR      = $CacheDir
# The local repository needs no REST credentials; make sure none leak in
# from an interactive session.
Remove-Item Env:RESTIC_REST_USERNAME -ErrorAction SilentlyContinue
Remove-Item Env:RESTIC_REST_PASSWORD -ErrorAction SilentlyContinue

# --- Single-instance lock (equivalent of flock) -----------------------------
$lockStream = $null
try {
    $lockStream = [System.IO.File]::Open(
        $LockFile, [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
} catch {
    Write-Log 'FATAL: another maintenance run is already active'
    exit 1
}

try {
    Write-Log "maintenance started (CheckOnly=$($CheckOnly.IsPresent))"
    Invoke-Restic @('check')

    if (-not $CheckOnly) {
        Invoke-Restic @(
            'forget',
            '--tag', $Tag,
            '--group-by', 'host,tags',
            '--keep-daily', "$KeepDaily",
            '--keep-weekly', "$KeepWeekly",
            '--keep-monthly', "$KeepMonthly",
            '--prune'
        )
        Invoke-Restic @('check')
        Invoke-Restic @('cache', '--cleanup')
    }

    Write-Log 'maintenance completed successfully'
    exit 0
} catch {
    Write-Log "FATAL: $($_.Exception.Message)"
    exit 1
} finally {
    if ($lockStream) { $lockStream.Dispose() }
    Remove-Item Env:RESTIC_REPOSITORY, Env:RESTIC_PASSWORD_FILE, Env:RESTIC_CACHE_DIR -ErrorAction SilentlyContinue
}
