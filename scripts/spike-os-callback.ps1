<#
  OS-level callback spike harness.

  Proves that an *external* `code --open-url` invocation -- the exact mechanism
  Windows uses when it hands a `vscode://` URL to VS Code (registry verb:
  "Code.exe --open-url -- %1") -- reaches this extension's registered
  UriHandler inside an isolated Extension Development Host, without touching the
  developer's daily VS Code profile.

  Isolation:
    * dedicated --user-data-dir and --extensions-dir under a temp folder
    * the extension is loaded only via --extensionDevelopmentPath
    * no Meta credentials; dummy code/state only
    * the extension's spike instrumentation is inert unless THREADS_SPIKE_LOG
      is set, which only this script does

  Usage:
    pwsh scripts/spike-os-callback.ps1 -Scenario happy
    pwsh scripts/spike-os-callback.ps1 -Scenario expired
    pwsh scripts/spike-os-callback.ps1 -Scenario mismatch
    pwsh scripts/spike-os-callback.ps1 -Scenario single-use
    pwsh scripts/spike-os-callback.ps1 -Scenario wrong-path
    pwsh scripts/spike-os-callback.ps1 -Scenario no-pending
#>
[CmdletBinding()]
param(
  [ValidateSet('happy', 'expired', 'mismatch', 'single-use', 'wrong-path', 'no-pending')]
  [string]$Scenario = 'happy',
  [int]$StartupWaitSec = 25,
  [int]$DispatchWaitSec = 20,
  [switch]$KeepWorkDir
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$extId = 'dgh.vscode-threads-plugin'
$codeExe = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'
if (-not (Test-Path $codeExe)) { throw "Code.exe not found at $codeExe" }

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("threads-spike-" + [guid]::NewGuid().ToString('N'))
$userDataDir = Join-Path $work 'user-data'
$extDir = Join-Path $work 'extensions'
$logFile = Join-Path $work 'spike.log'
New-Item -ItemType Directory -Force -Path $userDataDir, $extDir | Out-Null

$goodState = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$wrongState = 'deadbeef' * 8
switch ($Scenario) {
  'happy'      { $primeState = $goodState; $ageMs = 0;      $path = '/auth'; $fireState = $goodState;  $expect = 'RESULT pass=static-callback state-matched' }
  'expired'    { $primeState = $goodState; $ageMs = 600000; $path = '/auth'; $fireState = $goodState;  $expect = 'RESULT error=OAuth callback expired. Start sign-in again.' }
  'mismatch'   { $primeState = $goodState; $ageMs = 0;      $path = '/auth'; $fireState = $wrongState; $expect = 'RESULT error=OAuth callback state does not match.' }
  'single-use' { $primeState = $goodState; $ageMs = 0;      $path = '/auth'; $fireState = $goodState;  $expect = 'RESULT error=No OAuth request is pending. Start sign-in again.' }
  'wrong-path' { $primeState = $goodState; $ageMs = 0;      $path = '/nope'; $fireState = $goodState;  $expect = "handleUri authority=$extId path=/nope" }
  'no-pending' { $primeState = '';         $ageMs = 0;      $path = '/auth'; $fireState = $goodState;  $expect = 'RESULT error=No OAuth request is pending. Start sign-in again.' }
}

$env:THREADS_SPIKE_LOG = $logFile
$env:THREADS_SPIKE_AGE_MS = "$ageMs"
if ($primeState) { $env:THREADS_SPIKE_STATE = $primeState }
else { Remove-Item Env:\THREADS_SPIKE_STATE -ErrorAction SilentlyContinue }

Write-Host "== scenario   : $Scenario"
Write-Host "== work dir   : $work"
Write-Host "== spike log  : $logFile"
Write-Host "== expect     : $expect"
Write-Host "== launching isolated Extension Development Host ..."

$hostProc = Start-Process -FilePath $codeExe -PassThru -ArgumentList @(
  '--user-data-dir', $userDataDir,
  '--extensions-dir', $extDir,
  "--extensionDevelopmentPath=$repo",
  '--new-window',
  '--disable-workspace-trust',
  '--skip-release-notes',
  $repo
)

function Read-Log { if (Test-Path $logFile) { Get-Content -Raw $logFile } else { '' } }
function Find-ExthostLog {
  Get-ChildItem -Recurse "$userDataDir\logs" -Filter 'exthost.log' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

# Wait for the extension host to come up and load the dev extension.
$loaded = $false
$deadline = (Get-Date).AddSeconds($StartupWaitSec + 20)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 1500
  $eh = Find-ExthostLog
  if ($eh) {
    $txt = Get-Content -Raw $eh.FullName
    if ($txt -match 'Extension host with pid \d+ started') {
      # dev extensions are loaded even if not yet activated; give scanning a beat
      if (-not $loaded) { $loaded = $true; Start-Sleep -Seconds 4; break }
    }
  }
}
Write-Host "== extension host up: $loaded"

# Fire the external open-url -- the OS mechanism, pointed at the isolated profile.
$fireUrl = "vscode://$extId$path`?code=SPIKE_DUMMY_CODE&state=$fireState&spike=callback-only"
Write-Host "== external open-url: $fireUrl"
& $codeExe '--user-data-dir' $userDataDir '--open-url' '--' $fireUrl | Out-Null

$pass = $false
$deadline = (Get-Date).AddSeconds($DispatchWaitSec)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 1000
  $log = Read-Log
  if ($log -and ($log -match [regex]::Escape($expect))) { $pass = $true; break }
}

if (-not $pass -and $Scenario -eq 'single-use') {
  Write-Host "== external open-url (second time -- pending must now be cleared)"
  & $codeExe '--user-data-dir' $userDataDir '--open-url' '--' $fireUrl | Out-Null
  $deadline = (Get-Date).AddSeconds($DispatchWaitSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    if ((Read-Log) -match [regex]::Escape($expect)) { $pass = $true; break }
  }
}

Start-Sleep -Seconds 2
Write-Host "`n----- spike.log -----"
Write-Host ((Read-Log).TrimEnd())
Write-Host "---------------------"

if (-not $pass) {
  $eh = Find-ExthostLog
  if ($eh) {
    Write-Host "`n----- exthost.log (tail) -----"
    Get-Content $eh.FullName -Tail 40 | ForEach-Object { Write-Host $_ }
    Write-Host "------------------------------"
    $hit = Select-String -Path $eh.FullName -Pattern 'threads|UriHandler|handleUri' -SimpleMatch -ErrorAction SilentlyContinue
    if ($hit) { Write-Host "`nexthost matches:"; $hit | ForEach-Object { Write-Host $_.Line } }
  }
}

# Tear down the isolated host only.
try { if ($hostProc -and -not $hostProc.HasExited) { Stop-Process -Id $hostProc.Id -Force } } catch {}
Get-CimInstance Win32_Process -Filter "Name='Code.exe'" |
  Where-Object { $_.CommandLine -like "*$($userDataDir -replace '\\','\\')*" } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }

Remove-Item Env:\THREADS_SPIKE_LOG, Env:\THREADS_SPIKE_STATE, Env:\THREADS_SPIKE_AGE_MS -ErrorAction SilentlyContinue

if ($pass) {
  Write-Host "`nRESULT: PASS  ($Scenario)"
  if (-not $KeepWorkDir) { Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue }
  exit 0
}
Write-Host "`nRESULT: FAIL  ($Scenario) -- expected substring not found"
Write-Host "kept work dir: $work"
exit 1
