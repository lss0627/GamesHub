param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw '请先从 https://nodejs.org/ 安装 Node.js 24，再重新双击启动。' }
  $nodeVersion = & node.exe --version
  if ($LASTEXITCODE -ne 0 -or ([version]$nodeVersion.TrimStart('v')).Major -lt 24) { throw '当前 Node.js 版本过低，请安装 Node.js 24 后重新双击启动。' }
  if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { throw '还缺少 pnpm，请在终端运行 npm install -g pnpm@11.19.0，完成后重新双击启动。' }
  if (-not (Test-Path -LiteralPath 'node_modules/tsx')) {
    & pnpm.cmd install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw '项目依赖尚未下载完成，请检查网络后重新双击启动。' }
  }
  $launchArgs = @('--import', 'tsx', 'scripts/start-gamerhub.ts')
  if ($NoOpen) { $launchArgs += '--no-open' }
  & node.exe @launchArgs
  exit $LASTEXITCODE
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Yellow
  exit 1
}
