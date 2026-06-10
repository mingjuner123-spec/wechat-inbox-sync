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
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers $Headers
  } catch {
    Write-Host "PowerShell download failed, retrying with curl."
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if (-not $curl) {
      throw
    }
    & $curl.Source -L --retry 5 --retry-delay 2 --connect-timeout 30 -C - -o $OutFile $Url
    if ($LASTEXITCODE -ne 0) {
      throw "curl download failed with exit code $LASTEXITCODE"
    }
  }
}

function Get-LatestWhisperWindowsAsset {
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest" -Headers $Headers
    $asset = $release.assets |
      Where-Object {
        $_.name -match "\.zip$" -and
        $_.name -match "(win|windows|mingw|x64)" -and
        $_.name -match "(bin|whisper)"
      } |
      Sort-Object @{ Expression = { if ($_.name -match "x64") { 0 } else { 1 } } }, name |
      Select-Object -First 1
    if ($asset) {
      return $asset.browser_download_url
    }
  } catch {
    Write-Host "GitHub API unavailable, falling back to release page parsing."
  }

  $latestResponse = Invoke-WebRequest -Uri "https://github.com/ggml-org/whisper.cpp/releases/latest" -Headers $Headers -MaximumRedirection 0 -ErrorAction SilentlyContinue
  $location = $latestResponse.Headers.Location
  if (-not $location) {
    throw "Cannot locate latest whisper.cpp release."
  }
  $tag = Split-Path -Leaf ([uri]$location).AbsolutePath
  $assetsPage = Invoke-WebRequest -Uri "https://github.com/ggml-org/whisper.cpp/releases/expanded_assets/$tag" -Headers $Headers
  $match = [regex]::Match($assetsPage.Content, '/ggml-org/whisper\.cpp/releases/download/[^"]+whisper-bin-x64\.zip')
  if (-not $match.Success) {
    $match = [regex]::Match($assetsPage.Content, '/ggml-org/whisper\.cpp/releases/download/[^"]+whisper[^"]+x64[^"]+\.zip')
  }
  if (-not $match.Success) {
    throw "Cannot find a Windows x64 whisper.cpp release asset. Open https://github.com/ggml-org/whisper.cpp/releases and download the Windows binary manually."
  }
  return "https://github.com$($match.Value)"
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

  $whisperZip = Join-Path $TempRoot "whisper.zip"
  Download-File -Url (Get-LatestWhisperWindowsAsset) -OutFile $whisperZip
  Expand-Archive -LiteralPath $whisperZip -DestinationPath $WhisperDir -Force

  $ffmpegZip = Join-Path $TempRoot "ffmpeg.zip"
  Download-File -Url "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip
  Expand-Archive -LiteralPath $ffmpegZip -DestinationPath $FfmpegDir -Force

  $modelPath = Join-Path $ModelDir "ggml-small.bin"
  if ((Test-Path -LiteralPath $modelPath) -and ((Get-Item -LiteralPath $modelPath).Length -lt 400MB)) {
    Remove-Item -LiteralPath $modelPath -Force
  }
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
  Sort-Object @{ Expression = { if ($_.Name -eq "whisper-cli.exe") { 0 } else { 1 } } }, FullName |
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

$TempWorkDir = Join-Path $env:TEMP ("wechat-inbox-local-asr-" + [guid]::NewGuid().ToString("N"))
$ChunkSeconds = 600
$OutputBase = if ($OutputPath.ToLowerInvariant().EndsWith(".txt")) {
  $OutputPath.Substring(0, $OutputPath.Length - 4)
} else {
  $OutputPath
}
$RunLog = Join-Path $Root "transcribe-last.log"

try {
  New-Item -ItemType Directory -Force -Path $TempWorkDir | Out-Null
  $ChunkPattern = Join-Path $TempWorkDir "chunk-%03d.wav"
  $ffmpegOutput = & $Ffmpeg.FullName -hide_banner -loglevel error -y -i $InputPath -ar 16000 -ac 1 -c:a pcm_s16le -f segment -segment_time $ChunkSeconds -reset_timestamps 1 $ChunkPattern 2>&1 | Out-String
  $ffmpegExit = $LASTEXITCODE
  $chunkFiles = @(Get-ChildItem -LiteralPath $TempWorkDir -Filter "chunk-*.wav" | Sort-Object Name)
  $whisperLogs = New-Object System.Collections.Generic.List[string]
  $mergedText = New-Object System.Collections.Generic.List[string]
  $whisperExit = 0

  if ($ffmpegExit -eq 0 -and $chunkFiles.Count -eq 0) {
    throw "ffmpeg did not generate audio chunks."
  }

  foreach ($chunk in $chunkFiles) {
    $chunkBase = [System.IO.Path]::Combine($TempWorkDir, [System.IO.Path]::GetFileNameWithoutExtension($chunk.Name))
    $chunkTxt = "$chunkBase.txt"
    $chunkOutput = & $Whisper.FullName -m $Model -f $chunk.FullName -l zh -otxt -of $chunkBase 2>&1 | Out-String
    $currentExit = $LASTEXITCODE
    $whisperLogs.Add("--- $($chunk.Name) exit=$currentExit ---")
    $whisperLogs.Add($chunkOutput)
    if ($currentExit -ne 0) {
      $whisperExit = $currentExit
      break
    }
    if (Test-Path -LiteralPath $chunkTxt) {
      $text = (Get-Content -LiteralPath $chunkTxt -Raw).Trim()
      if ($text) {
        $mergedText.Add($text)
      }
    }
  }

  @(
    "time=$(Get-Date -Format o)"
    "status=pending"
    "inputPath=$InputPath"
    "outputPath=$OutputPath"
    "tempWorkDir=$TempWorkDir"
    "chunkSeconds=$ChunkSeconds"
    "chunkCount=$($chunkFiles.Count)"
    "ffmpeg=$($Ffmpeg.FullName)"
    "ffmpegExit=$ffmpegExit"
    "--- ffmpeg output ---"
    $ffmpegOutput
    "whisper=$($Whisper.FullName)"
    "whisperExit=$whisperExit"
    "--- whisper output ---"
    ($whisperLogs -join [Environment]::NewLine)
  ) | Set-Content -LiteralPath $RunLog -Encoding UTF8

  if ($ffmpegExit -ne 0) {
    throw "ffmpeg failed with exit code $ffmpegExit. See $RunLog"
  }
  if ($whisperExit -ne 0) {
    throw "whisper failed with exit code $whisperExit. See $RunLog"
  }

  if ($mergedText.Count -eq 0) {
    throw "Whisper did not generate transcript text. See $RunLog"
  }

  ($mergedText -join "`n`n") | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value "status=success"
  Get-Content -LiteralPath $OutputPath -Raw
} catch {
  Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value @(
    "status=failed"
    "--- error ---"
    ($_ | Out-String)
  )
  throw
} finally {
  if (Test-Path -LiteralPath $TempWorkDir) {
    Remove-Item -LiteralPath $TempWorkDir -Recurse -Force
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
