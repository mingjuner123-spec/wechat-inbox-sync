$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinDir = Join-Path $Root "bin"
$YtDlpPath = Join-Path $BinDir "yt-dlp.exe"
$YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"

if (-not (Test-Path -LiteralPath $BinDir)) {
  New-Item -ItemType Directory -Path $BinDir | Out-Null
}

Write-Host "Downloading yt-dlp.exe..."
Invoke-WebRequest -Uri $YtDlpUrl -OutFile $YtDlpPath

Write-Host ""
Write-Host "OK: yt-dlp installed at:"
Write-Host $YtDlpPath
Write-Host ""
Write-Host "Next step:"
Write-Host "  powershell -ExecutionPolicy Bypass -File .\start-windows.ps1 -ResolverSecret your-long-secret"
