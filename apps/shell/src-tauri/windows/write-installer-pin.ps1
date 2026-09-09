# Hashes the setup exe and writes installer-digest.pin into the channel data dir.
# Invoked from NSIS POSTINSTALL via powershell -File (no $ in the nsExec line).
param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$DataDir,
  [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = "Stop"
$env:PSModulePath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules"

$sha = $null
try {
  $sha = (Get-FileHash -LiteralPath $ExePath -Algorithm SHA256).Hash.ToLowerInvariant()
} catch {
  $sha = $null
}

if (-not $sha) {
  $cert = Join-Path $env:SystemRoot "System32\certutil.exe"
  $lines = & $cert -hashfile $ExePath SHA256 2>$null
  $line = @($lines)[1]
  $sha = (($line -replace "\s", "")).ToLowerInvariant()
}

if ($sha -notmatch "^[0-9a-f]{64}$") {
  exit 1
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$pin = Join-Path $DataDir "installer-digest.pin"
[System.IO.File]::WriteAllText($pin, "version=$Version`r`nsha256=$sha`r`n")
exit 0
