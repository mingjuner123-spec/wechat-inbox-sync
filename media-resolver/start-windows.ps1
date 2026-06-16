param(
  [string]$ResolverSecret = "",
  [string]$PublicBaseUrl = "",
  [string]$CookieFile = "",
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$YtDlpPath = Join-Path $Root "bin\yt-dlp.exe"

if (-not (Test-Path -LiteralPath $YtDlpPath)) {
  throw "yt-dlp.exe not found. Run setup-windows.ps1 first."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 18+ first."
}

$env:YT_DLP_BIN = $YtDlpPath
$env:YT_DLP_COOKIE_FILE = $CookieFile
$env:RESOLVER_SECRET = $ResolverSecret
$env:PUBLIC_BASE_URL = $PublicBaseUrl
$env:PORT = [string]$Port

Write-Host "Starting media resolver..."
Write-Host "Local health check: http://127.0.0.1:$Port/health"
if ($PublicBaseUrl) {
  Write-Host "Public base URL: $PublicBaseUrl"
} else {
  Write-Host "PUBLIC_BASE_URL is empty. This is OK for local parsing tests, but cloud transcription needs a public URL."
}
if ($CookieFile) {
  Write-Host "yt-dlp cookie file: $CookieFile"
}

Push-Location $Root
try {
  node server.js
} finally {
  Pop-Location
}
