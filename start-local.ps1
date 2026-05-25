[CmdletBinding()]
param(
  [switch]$SkipDev,
  [switch]$Seed,
  [switch]$ForceRestart,
  [int]$DockerTimeoutSeconds = 120,
  [switch]$SkipGrokServer,
  [string]$GrokServerPath = "d:\DuAn\CheckGrokJS",
  [int]$GrokServerPort = 4001
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSCommandPath

function Write-Step {
  param([string]$Message)
  Write-Host "[start-local] $Message" -ForegroundColor Cyan
}

function Write-Notice {
  param([string]$Message)
  Write-Host "[start-local] $Message" -ForegroundColor Yellow
}

function Clear-LocalProxyEnvironment {
  $proxyKeys = @(
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy"
  )

  $clearedKeys = @()
  foreach ($key in $proxyKeys) {
    $currentValue = [Environment]::GetEnvironmentVariable($key, "Process")
    if (-not [string]::IsNullOrWhiteSpace($currentValue)) {
      Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
      $clearedKeys += $key
    }
  }

  if ($clearedKeys.Count -gt 0) {
    Write-Notice "Cleared proxy env for local stack: $($clearedKeys -join ', ')"
  }
}

function Test-DockerReady {
  try {
    & docker version *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Ensure-DockerReady {
  if (Test-DockerReady) {
    Write-Step "Docker engine is ready."
    return
  }

  $dockerDesktopExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path -LiteralPath $dockerDesktopExe)) {
    throw "Docker Desktop was not found at '$dockerDesktopExe'."
  }

  $dockerService = Get-Service -Name "com.docker.service" -ErrorAction SilentlyContinue
  if ($dockerService -and $dockerService.Status -ne "Running") {
    Write-Step "Starting Docker service..."
    Start-Service -Name "com.docker.service"
  }

  Write-Step "Launching Docker Desktop..."
  Start-Process -FilePath $dockerDesktopExe | Out-Null

  $deadline = (Get-Date).AddSeconds($DockerTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (Test-DockerReady) {
      Write-Step "Docker engine is ready."
      return
    }
  }

  throw "Docker did not become ready within $DockerTimeoutSeconds seconds."
}

function Get-RepoNodeProcesses {
  $escapedRepoRoot = [Regex]::Escape($repoRoot)

  @(Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
      $_.CommandLine -and (
        $_.CommandLine -match $escapedRepoRoot -or
        $_.CommandLine -match "@reseller/api" -or
        $_.CommandLine -match "@reseller/worker" -or
        $_.CommandLine -match "@reseller/web"
      )
    })
}

function Ensure-NoDuplicateLocalStack {
  $existingProcesses = @(Get-RepoNodeProcesses)
  if ($existingProcesses.Count -eq 0) {
    return
  }

  if (-not $ForceRestart) {
    Write-Notice "Detected reseller-platform Node processes already running:"
    $existingProcesses |
      Select-Object ProcessId, CommandLine |
      Format-Table -AutoSize |
      Out-Host

    throw "Refusing to start a duplicate local stack. Re-run with -ForceRestart to replace the existing processes."
  }

  Write-Step "Stopping existing reseller-platform Node processes..."
  foreach ($process in $existingProcesses) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }

  Start-Sleep -Seconds 2
}

function Ensure-GrokServer {
  if ($SkipGrokServer) {
    Write-Notice "Grok HTTP server skipped (-SkipGrokServer). Worker will use subprocess fallback for grok checks."
    return $null
  }
  $serverJs = Join-Path $GrokServerPath "server.js"
  if (-not (Test-Path -LiteralPath $serverJs)) {
    Write-Notice "Grok server.js not found at $serverJs — skipping (worker will use subprocess fallback)."
    return $null
  }

  # Check if something is already listening on the target port — assume it's a prior instance, reuse it.
  $existing = $false
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async  = $client.BeginConnect("127.0.0.1", $GrokServerPort, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(500, $false)) {
      $client.EndConnect($async)
      if ($client.Connected) { $existing = $true }
    }
    $client.Dispose()
  } catch { }
  if ($existing) {
    Write-Step "Grok HTTP server already listening on :$GrokServerPort — reusing."
    return $null
  }

  # Auto-install deps if missing (express was added later than the original tool).
  $expressDir = Join-Path $GrokServerPath "node_modules\express"
  if (-not (Test-Path -LiteralPath $expressDir)) {
    Write-Step "Installing grok server deps (express, express-rate-limit)..."
    Push-Location $GrokServerPath
    try {
      & cmd /c npm.cmd install --no-fund --no-audit
      if ($LASTEXITCODE -ne 0) { throw "npm install in $GrokServerPath failed." }
    } finally { Pop-Location }
  }

  Write-Step "Starting grok HTTP server on :$GrokServerPort..."
  $logPath = Join-Path $env:TEMP "reseller-grok-server.log"

  # Windows PowerShell 5.1 doesn't support Start-Process -Environment. Set in current
  # process so the child inherits, then restore. Child uses cmd shell to launch node so
  # we can reliably background and log to file.
  $prevPort   = $env:PORT
  $prevWarmer = $env:WARMER
  $env:PORT   = "$GrokServerPort"
  $env:WARMER = "1"
  try {
    $grokProc = Start-Process `
      -FilePath "cmd.exe" `
      -ArgumentList @("/c", "node", "server.js") `
      -WorkingDirectory $GrokServerPath `
      -RedirectStandardOutput $logPath `
      -RedirectStandardError  ($logPath + ".err") `
      -WindowStyle Hidden `
      -PassThru
  } finally {
    $env:PORT   = $prevPort
    $env:WARMER = $prevWarmer
  }

  # Wait briefly for the server to start listening so the worker doesn't race the first claim.
  try {
    Wait-TcpPort -HostName "127.0.0.1" -Port $GrokServerPort -TimeoutSeconds 30
    Write-Step "Grok HTTP server up on http://127.0.0.1:$GrokServerPort (log: $logPath)"
  } catch {
    Write-Notice "Grok HTTP server didn't open port :$GrokServerPort within 30s — worker will fall back to subprocess. See $logPath for details."
    return $null
  }

  return $grokProc
}

function Wait-TcpPort {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
      if ($asyncResult.AsyncWaitHandle.WaitOne(1000, $false)) {
        $client.EndConnect($asyncResult)
        if ($client.Connected) {
          return
        }
      }
    } catch {
    } finally {
      $client.Dispose()
    }

    Start-Sleep -Seconds 1
  }

  throw "Timed out waiting for $HostName`:$Port."
}

try {
  Set-Location -LiteralPath $repoRoot
  Clear-LocalProxyEnvironment

  Ensure-NoDuplicateLocalStack
  Ensure-DockerReady

  Write-Step "Starting PostgreSQL and Redis with Docker Compose..."
  & docker compose up -d
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start Docker Compose services."
  }

  Write-Step "Waiting for PostgreSQL on port 5432..."
  Wait-TcpPort -HostName "127.0.0.1" -Port 5432

  Write-Step "Waiting for Redis on port 6379..."
  Wait-TcpPort -HostName "127.0.0.1" -Port 6379

  Write-Step "Applying database migrations..."
  & cmd /c npm.cmd run db:deploy
  if ($LASTEXITCODE -ne 0) {
    throw "Database migration step failed."
  }

  # Grok HTTP server (long-running, CF warmer) — launched BEFORE dev so the worker
  # sees CHECK_GROK_URL on startup. Skip on -SkipGrokServer or if server.js missing.
  $grokProc = Ensure-GrokServer
  if ($grokProc) {
    $env:CHECK_GROK_URL = "http://127.0.0.1:$GrokServerPort"
    Write-Step "CHECK_GROK_URL set to $env:CHECK_GROK_URL — worker will route grok checks through HTTP."
  } else {
    # Even if we didn't spin it, respect a pre-set CHECK_GROK_URL from the user's env.
    if ($env:CHECK_GROK_URL) {
      Write-Step "Using existing CHECK_GROK_URL=$env:CHECK_GROK_URL from environment."
    }
  }

  if ($Seed) {
    Write-Step "Seeding the database..."
    & cmd /c npm.cmd run db:seed
    if ($LASTEXITCODE -ne 0) {
      throw "Database seed step failed."
    }
  }

  if ($SkipDev) {
    Write-Step "Infra is ready. Start the app when you want with 'cmd /c npm.cmd run dev'."
    exit 0
  }

  Write-Step "Starting api, worker, and web..."
  & cmd /c npm.cmd run dev
  exit $LASTEXITCODE
} catch {
  Write-Host "[start-local] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
