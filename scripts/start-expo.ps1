param(
  [switch]$Tunnel
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeRoot = 'C:\Users\given\.codex\runtimes\node-v22.23.1-win-x64'
$corepackShims = Join-Path $nodeRoot 'node_modules\corepack\shims'

if (-not (Test-Path (Join-Path $nodeRoot 'node.exe'))) {
  throw "Node 22 runtime is missing: $nodeRoot"
}

$env:Path = "$nodeRoot;$corepackShims;$env:Path"
$env:npm_config_registry = 'https://registry.npmmirror.com'
$env:EXPO_OFFLINE = '1'
Set-Location $projectRoot

$hotspotAddress = Get-NetIPAddress `
  -AddressFamily IPv4 `
  -IPAddress '192.168.137.1' `
  -ErrorAction SilentlyContinue
if ($hotspotAddress) {
  $env:REACT_NATIVE_PACKAGER_HOSTNAME = '192.168.137.1'
  Write-Host 'Using Windows hotspot address: 192.168.137.1' -ForegroundColor Cyan
}

if ($Tunnel) {
  pnpm exec expo start --go --tunnel --clear
} else {
  pnpm exec expo start --go --lan --clear
}
