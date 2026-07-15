$ErrorActionPreference = 'Stop'

$ruleName = 'Hermes Expo Metro 8081'
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Remove-NetFirewallRule -DisplayName $ruleName
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Description 'Allow Hermes development clients on the local network to reach Metro.' `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 8081 `
  -RemoteAddress LocalSubnet `
  -Profile Private,Public | Out-Null

Write-Host 'Hermes Expo firewall rule configured.' -ForegroundColor Green
