$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeRoot = $env:HERMES_NODE_ROOT
if ([string]::IsNullOrWhiteSpace($nodeRoot)) {
    $nodeCommand = Get-Command node -ErrorAction Stop
    $nodeRoot = Split-Path -Parent $nodeCommand.Source
}
$corepackShims = Join-Path $nodeRoot 'node_modules\corepack\shims'
if (Test-Path $corepackShims) {
    $env:Path = "$nodeRoot;$corepackShims;$env:Path"
}
Set-Location $projectRoot

pnpm dlx eas-cli@20.5.1 whoami
pnpm dlx eas-cli@20.5.1 build --platform ios --profile preview
