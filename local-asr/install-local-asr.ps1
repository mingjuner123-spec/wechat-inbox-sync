$ErrorActionPreference = "Stop"

$InstallRoot = Join-Path $env:USERPROFILE ".wechat-inbox-local-asr"
$TempRoot = Join-Path $env:TEMP ("wechat-inbox-local-asr-install-" + [guid]::NewGuid().ToString("N"))
$Headers = @{ "User-Agent" = "wechat-inbox-sync-local-asr-installer" }

function New-CleanDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Download-File {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile
  )
  Write-Host "Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers $Headers
}

try {
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  New-CleanDirectory -Path $TempRoot

  $WhisperDir = Join-Path $InstallRoot "whisper"
  $FfmpegDir = Join-Path $InstallRoot "ffmpeg"
  $ModelDir = Join-Path $InstallRoot "models"
  New-CleanDirectory -Path $WhisperDir
  New-CleanDirectory -Path $FfmpegDir
  New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest" -Headers $Headers
  $asset = $release.assets |
    Where-Object {
      $_.name -match "\.zip$" -and
      $_.name -match "(win|windows|mingw|x64)" -and
      $_.name -match "(bin|whisper)"
    } |
    Select-Object -First 1

  if (-not $asset) {
    throw "Cannot find a Windows x64 whisper.cpp release asset. Open https://github.com/ggml-org/whisper.cpp/releases and download the Windows binary manually."
  }

  $whisperZip = Join-Path $TempRoot "whisper.zip"
  Download-File -Url $asset.browser_download_url -OutFile $whisperZip
  Expand-Archive -LiteralPath $whisperZip -DestinationPath $WhisperDir -Force

  $ffmpegZip = Join-Path $TempRoot "ffmpeg.zip"
  Download-File -Url "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip
  Expand-Archive -LiteralPath $ffmpegZip -DestinationPath $FfmpegDir -Force

  $modelPath = Join-Path $ModelDir "ggml-small.bin"
  if (-not (Test-Path -LiteralPath $modelPath)) {
    Download-File -Url "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" -OutFile $modelPath
  }

  $transcribeScript = Join-Path $InstallRoot "transcribe.ps1"
  @'
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$Whisper = Get-ChildItem -LiteralPath (Join-Path $Root "whisper") -Recurse -File |
  Where-Object { $_.Name -in @("whisper-cli.exe", "main.exe") } |
  Select-Object -First 1
if (-not $Whisper) {
  throw "whisper-cli.exe not found. Please rerun install-local-asr.ps1."
}

$Ffmpeg = Get-ChildItem -LiteralPath (Join-Path $Root "ffmpeg") -Recurse -File -Filter "ffmpeg.exe" |
  Select-Object -First 1
if (-not $Ffmpeg) {
  throw "ffmpeg.exe not found. Please rerun install-local-asr.ps1."
}

$Model = Join-Path $Root "models\ggml-small.bin"
if (-not (Test-Path -LiteralPath $Model)) {
  throw "Whisper model not found: $Model"
}

$OutputDir = Split-Path -Parent $OutputPath
if ($OutputDir) {
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

$TempWav = Join-Path $env:TEMP ("wechat-inbox-local-asr-" + [guid]::NewGuid().ToString("N") + ".wav")
$OutputBase = if ($OutputPath.ToLowerInvariant().EndsWith(".txt")) {
  $OutputPath.Substring(0, $OutputPath.Length - 4)
} else {
  $OutputPath
}
$GeneratedTxt = "$OutputBase.txt"

try {
  & $Ffmpeg.FullName -hide_banner -loglevel error -y -i $InputPath -ar 16000 -ac 1 -c:a pcm_s16le $TempWav
  & $Whisper.FullName -m $Model -f $TempWav -l zh -otxt -of $OutputBase | Out-Null

  if (-not (Test-Path -LiteralPath $GeneratedTxt)) {
    throw "Whisper did not generate transcript: $GeneratedTxt"
  }

  Move-Item -LiteralPath $GeneratedTxt -Destination $OutputPath -Force
  Get-Content -LiteralPath $OutputPath -Raw
} finally {
  if (Test-Path -LiteralPath $TempWav) {
    Remove-Item -LiteralPath $TempWav -Force
  }
}
'@ | Set-Content -LiteralPath $transcribeScript -Encoding UTF8

  Write-Host ""
  Write-Host "Local ASR installed to: $InstallRoot"
  Write-Host "Use this Obsidian plugin command:"
  Write-Host "powershell -NoProfile -ExecutionPolicy Bypass -File `"`$env:USERPROFILE\.wechat-inbox-local-asr\transcribe.ps1`" -InputPath {input} -OutputPath {output}"
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
  }
}
