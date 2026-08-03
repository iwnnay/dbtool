# deploy.ps1 — Stop server, pull changes, migrate DB, rebuild, restart on port 7201

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# ── 1. Stop any process currently listening on port 7201 ──────────────────────
Write-Host "Checking for process on port 7201..."
$listeningLines = netstat -ano | Select-String "TCP\s+[^\s]+:7201\s+[^\s]+\s+LISTENING"
foreach ($listeningLine in $listeningLines) {
    $columns = $listeningLine.Line.Trim() -split '\s+'
    $processId = $columns[-1]
    if ($processId -match '^\d+$' -and [int]$processId -gt 0) {
        Write-Host "  Stopping PID $processId..."
        Stop-Process -Id ([int]$processId) -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

# ── 2. Pull latest changes ─────────────────────────────────────────────────────
Write-Host "Pulling latest changes..."
git pull
if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

# ── 3. Install dependencies ────────────────────────────────────────────────────
Write-Host "Installing dependencies..."
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

# ── 4. Run database migrations ────────────────────────────────────────────────
Write-Host "Applying database migrations..."
npm run db:migrate
if ($LASTEXITCODE -ne 0) { throw "db:migrate failed" }

# ── 5. Build the app ──────────────────────────────────────────────────────────
Write-Host "Building application..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

# ── 6. Load .env and start server in background ───────────────────────────────
Write-Host "Loading environment from .env..."
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        $envLine = $_.Trim()
        if ($envLine -and !$envLine.StartsWith('#') -and $envLine -match '^([^=]+)=(.*)$') {
            $key   = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

$env:PORT = "7201"
$env:HOST = "127.0.0.1"

New-Item -ItemType Directory -Force -Path "logs" | Out-Null

Write-Host "Starting server on port 7201..."
$serverProcess = Start-Process `
    -FilePath "node" `
    -ArgumentList "build/index.js" `
    -RedirectStandardOutput "logs/server.log" `
    -RedirectStandardError  "logs/server.error.log" `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Server started (PID $($serverProcess.Id)). Logs: logs/server.log"
