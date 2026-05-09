[CmdletBinding()]
param(
  [switch]$SkipDev,
  [switch]$Seed,
  [switch]$ForceRestart,
  [int]$DockerTimeoutSeconds = 120,
  [string]$EnvFile = ".env.bot-test"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSCommandPath
$startLocalScript = Join-Path $repoRoot "start-local.ps1"
$envFilePath = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
  $EnvFile
} else {
  Join-Path $repoRoot $EnvFile
}
$exampleEnvFilePath = Join-Path $repoRoot ".env.bot-test.example"

function Write-Step {
  param([string]$Message)
  Write-Host "[start-local:bot-test] $Message" -ForegroundColor Cyan
}

function Write-Notice {
  param([string]$Message)
  Write-Host "[start-local:bot-test] $Message" -ForegroundColor Yellow
}

function Import-DotEnvFile {
  param([string]$Path)

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmedLine = $line.Trim()
    if (-not $trimmedLine -or $trimmedLine.StartsWith("#")) {
      continue
    }

    $separatorIndex = $trimmedLine.IndexOf("=")
    if ($separatorIndex -lt 1) {
      continue
    }

    $name = $trimmedLine.Substring(0, $separatorIndex).Trim()
    $value = $trimmedLine.Substring($separatorIndex + 1)

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    Set-Item -Path "Env:$name" -Value $value
  }
}

if (-not (Test-Path -LiteralPath $startLocalScript)) {
  throw "Could not find '$startLocalScript'."
}

if (-not (Test-Path -LiteralPath $envFilePath)) {
  if (Test-Path -LiteralPath $exampleEnvFilePath) {
    throw "Missing '$envFilePath'. Copy '$exampleEnvFilePath' to '.env.bot-test' and fill SEED_SELLER_BOT_TOKEN with your test bot token."
  }

  throw "Missing '$envFilePath'."
}

Import-DotEnvFile -Path $envFilePath
$env:DOTENV_CONFIG_PATH = $envFilePath

Write-Step "Loaded env from '$envFilePath'."

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot ".env.bot-test"))) {
  Write-Notice "You are loading a custom env file. Keep the bot token dedicated to this local test stack."
}

if (-not ([string]$env:SEED_SELLER_BOT_TOKEN).Trim()) {
  Write-Notice "SEED_SELLER_BOT_TOKEN is blank. The stack will boot, but the real Telegram test bot will not reply until you add the token."
}

Write-Step "Effective DATABASE_URL host: localhost:5432"
Write-Step "Forwarding to start-local.ps1 in the same process."

& $startLocalScript `
  -SkipDev:$SkipDev `
  -Seed:$Seed `
  -ForceRestart:$ForceRestart `
  -DockerTimeoutSeconds $DockerTimeoutSeconds

exit $LASTEXITCODE
