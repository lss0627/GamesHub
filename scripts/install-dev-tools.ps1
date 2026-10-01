param(
  [switch]$SkipUnity,
  [switch]$SkipPlaywright,
  [string]$ProxyUrl = ''
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$unityVersion = '6000.0.80f1'

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"
}

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required but was not found" }
  return $command.Source
}

Write-Host 'Installing Node.js 24 LTS...'
& (Require-Command 'winget') install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
Refresh-ProcessPath
& (Require-Command 'npm.cmd') install --global pnpm@11.19.0
Refresh-ProcessPath
$pnpm = Require-Command 'pnpm.cmd'
if ((& $pnpm --version).Trim() -ne '11.19.0') {
  throw 'pnpm 11.19.0 verification failed'
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Docker Desktop...'
  & (Require-Command 'winget') install --id Docker.DockerDesktop --exact --silent --accept-package-agreements --accept-source-agreements
}

if (-not $SkipUnity) {
  Write-Host 'Ensuring Unity Hub is installed...'
  $hubPackage = Get-AppxPackage UnityTechnologies.UnityHub
  if (-not $hubPackage) {
    & (Require-Command 'winget') install --id Unity.UnityHub --exact --silent --accept-package-agreements --accept-source-agreements
    $hubPackage = Get-AppxPackage UnityTechnologies.UnityHub
  }
  $hubPath = if ($hubPackage) {
    Join-Path $hubPackage.InstallLocation 'app\Unity Hub.exe'
  } else {
    'C:\Program Files\Unity Hub\Unity Hub.exe'
  }
  if (-not (Test-Path -LiteralPath $hubPath)) {
    throw 'Unity Hub executable was not found after installation'
  }
}

Push-Location $projectRoot
try {
  & $pnpm install
  if (-not $SkipPlaywright) {
    $browserPath = Join-Path $env:LOCALAPPDATA 'ms-playwright'
    $env:PLAYWRIGHT_BROWSERS_PATH = $browserPath
    & $pnpm exec playwright install chromium firefox webkit
  }
  if (-not $SkipUnity) {
    $unityInstaller = Join-Path $PSScriptRoot 'complete-unity-install.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $unityInstaller -ProxyUrl $ProxyUrl -SkipBootstrap
    if ($LASTEXITCODE -ne 0) { throw "Unity installation exited with code $LASTEXITCODE" }
  }
  & $pnpm dev:bootstrap
  & $pnpm env:doctor:local
} finally {
  Pop-Location
}

$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
if (-not $processor.VirtualizationFirmwareEnabled) {
  Write-Warning 'BIOS/UEFI virtualization is disabled. Enable Intel Virtualization Technology/VT-x, reboot, then start Docker Desktop.'
}
