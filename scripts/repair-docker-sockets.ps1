$ErrorActionPreference = 'Stop'
$localRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA)
$dockerInstall = [IO.Path]::GetFullPath('C:/Program Files/Docker/Docker')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$targets = @(
    @{ Path = (Join-Path $localRoot 'Docker/run'); Parent = (Join-Path $localRoot 'Docker'); Name = 'run' },
    @{ Path = (Join-Path $localRoot 'docker-secrets-engine'); Parent = $localRoot; Name = 'docker-secrets-engine' }
)
# This repairs runtime sockets only. It never resets Docker, unregisters WSL, or touches disks/volumes.
foreach ($target in $targets) {
    $resolved = [IO.Path]::GetFullPath($target.Path)
    if ([IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetFullPath($target.Parent)) { throw 'Unexpected runtime parent' }
    if (Test-Path -LiteralPath $resolved) {
        $item = Get-Item -LiteralPath $resolved -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime directory itself is a link' }
        if ($target.Name -eq 'docker-secrets-engine') {
            $otherFiles = @(Get-ChildItem -LiteralPath $resolved -Force | Where-Object { $_.Name -ne 'engine.sock' })
            if ($otherFiles.Count) { throw 'Secrets directory contains non-socket data; refusing to rename it' }
        }
    }
}
$processes = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Docker Desktop.exe', 'com.docker.backend.exe', 'com.docker.build.exe') }
foreach ($process in $processes) {
    if (-not $process.ExecutablePath -or -not $process.ExecutablePath.StartsWith($dockerInstall + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unverified Docker process' }
}
foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
foreach ($target in $targets) {
    $resolved = [IO.Path]::GetFullPath($target.Path)
    if (-not (Test-Path -LiteralPath $resolved)) { continue }
    $backupName = $target.Name + '-stale-' + $stamp
    $backup = [IO.Path]::GetFullPath((Join-Path $target.Parent $backupName))
    if ([IO.Path]::GetDirectoryName($backup) -ne [IO.Path]::GetFullPath($target.Parent)) { throw 'Unexpected backup parent' }
    Rename-Item -LiteralPath $resolved -NewName $backupName
    New-Item -ItemType Directory -Path $resolved | Out-Null
    Write-Output ('Preserved stale runtime sockets: ' + $backup)
}
Start-Process -FilePath (Join-Path $dockerInstall 'Docker Desktop.exe') -WindowStyle Hidden
