[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ArchivePath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
  throw "Compatibility archive does not exist: $ArchivePath"
}

$verificationRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('wechat-inbox-whisper-compat-' + [Guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $verificationRoot | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $verificationRoot -Force
  $whisperExecutable = Get-ChildItem -LiteralPath $verificationRoot -Recurse -File |
    Where-Object { $_.Name -in @('whisper-cli.exe', 'main.exe') } |
    Sort-Object @{ Expression = { if ($_.Name -eq 'whisper-cli.exe') { 0 } else { 1 } } }, FullName |
    Select-Object -First 1
  if ($null -eq $whisperExecutable) {
    throw 'Compatibility archive is missing whisper-cli.exe or main.exe.'
  }
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $whisperExecutable.FullName
  $startInfo.Arguments = '--help'
  $startInfo.UseShellExecute = $false
  $process = [System.Diagnostics.Process]::Start($startInfo)
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    $hex = '0x{0:X8}' -f ([uint32]$process.ExitCode)
    throw "Compatibility executable --help failed with exit code $($process.ExitCode)/$hex."
  }
  Write-Output "archive=$ArchivePath"
  Write-Output "sha256=$((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash)"
  Write-Output "whisper=$($whisperExecutable.FullName)"
} finally {
  if (Test-Path -LiteralPath $verificationRoot) {
    Remove-Item -LiteralPath $verificationRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
