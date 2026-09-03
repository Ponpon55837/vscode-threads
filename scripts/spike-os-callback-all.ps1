<#
  Runs every OS-callback spike scenario back to back and prints a summary
  table. Requires that NO other VS Code instance is running: the `vscode://`
  protocol is always delivered to the primary instance, so the isolated
  Extension Development Host can only receive the callback when it is the
  only instance.

  Usage (close all VS Code windows first):
    pwsh scripts/spike-os-callback-all.ps1
#>
[CmdletBinding()]
param([switch]$KeepWorkDir)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$one = Join-Path $here 'spike-os-callback.ps1'

$running = Get-CimInstance Win32_Process -Filter "Name='Code.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -notlike '*--type=*' -and $_.CommandLine -notlike '*threads-spike*' }
if ($running) {
  Write-Warning "A VS Code instance seems to be running (pid $($running.ProcessId -join ', ')). The vscode:// callback is delivered to the PRIMARY instance only; close all VS Code windows before running this."
}

$scenarios = 'happy', 'expired', 'mismatch', 'single-use', 'wrong-path', 'no-pending'
$results = [ordered]@{}
foreach ($s in $scenarios) {
  Write-Host "`n############################## $s ##############################"
  & $one -Scenario $s @($(if ($KeepWorkDir) { '-KeepWorkDir' }))
  $results[$s] = ($LASTEXITCODE -eq 0)
}

Write-Host "`n==================== SUMMARY ===================="
foreach ($k in $results.Keys) {
  '{0,-12} {1}' -f $k, $(if ($results[$k]) { 'PASS' } else { 'FAIL' }) | Write-Host
}
$failed = ($results.Values | Where-Object { -not $_ }).Count
exit $failed
