$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeRoot = 'C:\Users\given\.codex\runtimes\node-v22.23.1-win-x64'
$corepackShims = Join-Path $nodeRoot 'node_modules\corepack\shims'
$env:Path = "$nodeRoot;$corepackShims;$env:Path"
Set-Location $projectRoot

pnpm exec eas whoami
pnpm exec eas build --platform ios --profile preview
