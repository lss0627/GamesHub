param(
  [string]$ProxyUrl = '',
  [string]$InstallRoot = '',
  [switch]$SkipBootstrap
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$unityVersion = '6000.0.80f1'
$unityChangeset = '2dfd32957da2'
$downloadDirectory = Join-Path $env:LOCALAPPDATA "Temp\gamerhub-deps\unity-$unityVersion"
$artifactDirectory = Join-Path $projectRoot 'artifacts\dev-tools'
$statusPath = Join-Path $artifactDirectory 'unity-install-status.json'
$editorInstallerName = "UnitySetup64-$unityVersion.exe"
$webglInstallerName = "UnitySetup-WebGL-Support-for-Editor-$unityVersion.exe"
$editorInstallerPath = Join-Path $downloadDirectory $editorInstallerName
$webglInstallerPath = Join-Path $downloadDirectory $webglInstallerName
$downloadInputPath = Join-Path $downloadDirectory 'unity-downloads.txt'
$editorDownloadUrl = "https://download.unity3d.com/download_unity/$unityChangeset/Windows64EditorInstaller/$editorInstallerName"
$webglDownloadUrl = "https://download.unity3d.com/download_unity/$unityChangeset/TargetSupportInstaller/$webglInstallerName"
$expectedEditorLength = 4034369624L
$expectedWebglLength = 928852968L

if (-not $InstallRoot) {
  $InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\Unity\Hub\Editor\$unityVersion"
}
$unityEditorPath = Join-Path $InstallRoot 'Editor\Unity.exe'
$unityWebglPath = Join-Path $InstallRoot 'Editor\Data\PlaybackEngines\WebGLSupport'

New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null

function Write-InstallStatus {
  param(
    [string]$Stage,
    [string]$Status,
    [string]$Message
  )

  [ordered]@{
    version = $unityVersion
    stage = $Stage
    status = $Status
    message = $Message
    installRoot = $InstallRoot
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding utf8
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"
}

function Require-Command {
  param([string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required but was not found" }
  return $command.Source
}

function Resolve-SystemProxy {
  if ($ProxyUrl) { return $ProxyUrl }

  $settings = Get-ItemProperty `
    -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' `
    -ErrorAction SilentlyContinue
  if (-not $settings -or $settings.ProxyEnable -ne 1 -or -not $settings.ProxyServer) {
    return ''
  }

  $candidate = [string]$settings.ProxyServer
  if ($candidate.Contains(';')) {
    $httpsEntry = $candidate.Split(';') |
      Where-Object { $_ -match '^https=' } |
      Select-Object -First 1
    $candidate = if ($httpsEntry) { $httpsEntry.Split('=', 2)[1] } else { $candidate.Split(';')[0] }
  } elseif ($candidate.Contains('=')) {
    $candidate = $candidate.Split('=', 2)[1]
  }
  if ($candidate -notmatch '^https?://') { $candidate = "http://$candidate" }
  return $candidate
}

function Assert-OfficialInstaller {
  param(
    [string]$Path,
    [long]$ExpectedLength
  )

  $file = Get-Item -LiteralPath $Path
  if ($file.Length -ne $ExpectedLength) {
    throw "Installer length mismatch for $($file.Name): expected $ExpectedLength, got $($file.Length)"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne 'Valid') {
    throw "Installer signature verification failed for $($file.Name): $($signature.Status)"
  }
}

function Invoke-SilentInstaller {
  param([string]$Path)

  $arguments = "/S /D=$InstallRoot"
  try {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Path
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    # NSIS requires /D to be the final, unquoted argument. The Arguments property
    # is also available in the Windows PowerShell 5.1/.NET Framework runtime.
    $startInfo.Arguments = $arguments
    $process = [System.Diagnostics.Process]::Start($startInfo)
  } catch {
    $exception = $_.Exception
    $requiresElevation = $false
    while ($exception) {
      if (
        $exception -is [System.ComponentModel.Win32Exception] -and
        $exception.NativeErrorCode -eq 740
      ) {
        $requiresElevation = $true
        break
      }
      $exception = $exception.InnerException
    }
    if (-not $requiresElevation) { throw }
    Write-InstallStatus `
      -Stage 'awaiting-elevation' `
      -Status 'action-required' `
      -Message "Approve the Windows UAC prompt for $([IO.Path]::GetFileName($Path))."
    $process = Start-Process `
      -FilePath $Path `
      -ArgumentList $arguments `
      -Verb RunAs `
      -Wait `
      -PassThru
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "$([IO.Path]::GetFileName($Path)) exited with code $($process.ExitCode)"
  }
}

try {
  Refresh-ProcessPath
  if ((Test-Path -LiteralPath $unityEditorPath) -and (Test-Path -LiteralPath $unityWebglPath)) {
    Write-InstallStatus -Stage 'complete' -Status 'ready' -Message 'Unity Editor and WebGL support are already installed.'
  } else {
    $aria2 = Get-Command aria2c.exe -ErrorAction SilentlyContinue
    if (-not $aria2) {
      Write-InstallStatus -Stage 'prerequisite' -Status 'running' -Message 'Installing aria2 for resumable Unity downloads.'
      $winget = Require-Command 'winget.exe'
      & $winget install --id aria2.aria2 --exact --silent --accept-package-agreements --accept-source-agreements
      if ($LASTEXITCODE -ne 0) { throw "aria2 installation exited with code $LASTEXITCODE" }
      Refresh-ProcessPath
      $aria2 = Get-Command aria2c.exe -ErrorAction SilentlyContinue
      if (-not $aria2) { throw 'aria2c.exe was not found after installation' }
    }

    $resolvedProxy = Resolve-SystemProxy
    $downloadInput = @(
      $editorDownloadUrl,
      "  out=$editorInstallerName",
      $webglDownloadUrl,
      "  out=$webglInstallerName"
    )
    [IO.File]::WriteAllLines(
      $downloadInputPath,
      $downloadInput,
      [Text.UTF8Encoding]::new($false)
    )
    $downloadArguments = @(
      '--continue=true',
      '--max-concurrent-downloads=2',
      '--split=16',
      '--max-connection-per-server=16',
      '--min-split-size=1M',
      '--file-allocation=none',
      '--auto-file-renaming=false',
      '--summary-interval=60',
      '--console-log-level=notice',
      "--dir=$downloadDirectory",
      "--input-file=$downloadInputPath"
    )
    if ($resolvedProxy) { $downloadArguments += "--all-proxy=$resolvedProxy" }

    Write-InstallStatus -Stage 'download' -Status 'running' -Message 'Downloading the pinned Editor and WebGL installers with resume support.'
    & $aria2.Source @downloadArguments
    if ($LASTEXITCODE -ne 0) { throw "Unity download exited with code $LASTEXITCODE" }

    Write-InstallStatus -Stage 'verify' -Status 'running' -Message 'Checking installer lengths and Authenticode signatures.'
    Assert-OfficialInstaller -Path $editorInstallerPath -ExpectedLength $expectedEditorLength
    Assert-OfficialInstaller -Path $webglInstallerPath -ExpectedLength $expectedWebglLength

    if (-not (Test-Path -LiteralPath $unityEditorPath)) {
      Write-InstallStatus -Stage 'editor-install' -Status 'running' -Message "Installing Unity Editor into $InstallRoot."
      Invoke-SilentInstaller -Path $editorInstallerPath
    }
    if (-not (Test-Path -LiteralPath $unityWebglPath)) {
      Write-InstallStatus -Stage 'webgl-install' -Status 'running' -Message 'Installing Unity WebGL Build Support.'
      Invoke-SilentInstaller -Path $webglInstallerPath
    }
    if (-not (Test-Path -LiteralPath $unityEditorPath) -or -not (Test-Path -LiteralPath $unityWebglPath)) {
      throw 'Unity installation finished without the expected Editor or WebGL paths'
    }
  }

  if (-not $SkipBootstrap) {
    Refresh-ProcessPath
    $pnpm = Require-Command 'pnpm.cmd'
    $env:UNITY_EDITOR_PATH = $unityEditorPath
    $env:UNITY_WEB_MODULE_READY = '1'
    Push-Location $projectRoot
    try {
      Write-InstallStatus -Stage 'bootstrap' -Status 'running' -Message 'Refreshing .env.local and running the local environment doctor.'
      & $pnpm dev:bootstrap
      if ($LASTEXITCODE -ne 0) { throw "dev:bootstrap exited with code $LASTEXITCODE" }
      & $pnpm env:doctor:local
      if ($LASTEXITCODE -ne 0) { throw "env:doctor:local exited with code $LASTEXITCODE" }
    } finally {
      Pop-Location
    }
  }

  Write-InstallStatus -Stage 'complete' -Status 'ready' -Message 'Unity Editor, WebGL support and local environment checks are ready.'
} catch {
  Write-InstallStatus -Stage 'failed' -Status 'blocked' -Message $_.Exception.Message
  throw
}
