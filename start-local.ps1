[CmdletBinding()]
param(
  [switch]$SkipDev,
  [switch]$Seed,
  [switch]$ForceRestart,
  [int]$DockerTimeoutSeconds = 120
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
