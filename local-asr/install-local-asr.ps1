$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

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
    & $curl.Source -L --fail --silent --show-error --retry 5 --retry-delay 2 --connect-timeout 30 -C - -o $OutFile $Url
    if ($LASTEXITCODE -ne 0) {
      throw "curl download failed with exit code $LASTEXITCODE"
    }
  }
}

function Assert-DownloadedFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][Int64]$MinBytes,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label download failed: file not found at $Path"
  }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt $MinBytes) {
    throw "$Label download looks incomplete: $($item.Length) bytes at $Path. Please retry with a more stable network."
  }
  return $item
}

function Find-InstalledFile {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string[]]$Names
  )
  if (-not (Test-Path -LiteralPath $Root)) {
    return $null
  }
  return Get-ChildItem -LiteralPath $Root -Recurse -File |
    Where-Object { $Names -contains $_.Name } |
    Sort-Object @{ Expression = { [array]::IndexOf($Names, $_.Name) } }, FullName |
    Select-Object -First 1
}

function Assert-InstalledFile {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string[]]$Names,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $found = Find-InstalledFile -Root $Root -Names $Names
  if (-not $found) {
    throw "$Label install validation failed: cannot find $($Names -join ' or ') under $Root"
  }
  return $found
}

function Convert-ExitCodeToHex {
  param([Parameter(Mandatory = $true)][int]$ExitCode)
  return "0x{0:X8}" -f ([uint32]($ExitCode -band 0xffffffff))
}

function ConvertTo-NativeArgument {
  param([AllowNull()][string]$Value)
  $text = [string]$Value
  if ($text -eq "") {
    return '""'
  }
  if ($text -notmatch '[\s"]') {
    return $text
  }
  return '"' + ($text -replace '"', '\"') + '"'
}

function Invoke-NativeProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $stdoutPath = Join-Path $TempRoot ("native-stdout-" + [guid]::NewGuid().ToString("N") + ".log")
  $stderrPath = Join-Path $TempRoot ("native-stderr-" + [guid]::NewGuid().ToString("N") + ".log")
  try {
    $process = Start-Process `
      -FilePath $FilePath `
      -ArgumentList $Arguments `
      -NoNewWindow `
      -Wait `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath
    $exitCode = $process.ExitCode
    $stdoutText = if (Test-Path -LiteralPath $stdoutPath) { [string](Get-Content -LiteralPath $stdoutPath -Raw) } else { "" }
    $stderrText = if (Test-Path -LiteralPath $stderrPath) { [string](Get-Content -LiteralPath $stderrPath -Raw) } else { "" }
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }

  $combined = @(
    "--- stdout ---"
    ([string]$stdoutText).TrimEnd()
    "--- stderr ---"
    ([string]$stderrText).TrimEnd()
  ) -join [Environment]::NewLine
  return [PSCustomObject]@{
    ExitCode = $exitCode
    Output = $combined
  }
}

function Get-ShortPath {
  param([AllowNull()][string]$Path)
  $text = [string]$Path
  if ($text -eq "") {
    return ""
  }
  try {
    $fso = New-Object -ComObject Scripting.FileSystemObject
    if (Test-Path -LiteralPath $text -PathType Leaf) {
      return $fso.GetFile($text).ShortPath
    }
    if (Test-Path -LiteralPath $text -PathType Container) {
      return $fso.GetFolder($text).ShortPath
    }
    $parent = Split-Path -Parent $text
    $name = Split-Path -Leaf $text
    if ($parent -and (Test-Path -LiteralPath $parent)) {
      $shortParent = Get-ShortPath $parent
      if ($shortParent) {
        return Join-Path $shortParent $name
      }
    }
  } catch {
    return $text
  }
  return $text
}

function New-SafeTempDirectory {
  $baseCandidates = @()
  if ($env:ProgramData) {
    $baseCandidates += (Join-Path $env:ProgramData "wechat-inbox-local-asr")
  }
  if ($env:PUBLIC) {
    $baseCandidates += (Join-Path $env:PUBLIC "wechat-inbox-local-asr")
  }
  if ($env:SystemDrive) {
    $baseCandidates += (Join-Path $env:SystemDrive "wechat-inbox-local-asr-temp")
  }
  if ($env:TEMP) {
    $baseCandidates += $env:TEMP
  }

  foreach ($base in $baseCandidates) {
    try {
      New-Item -ItemType Directory -Force -Path $base | Out-Null
      $dir = Join-Path $base ("run-" + [guid]::NewGuid().ToString("N"))
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      return $dir
    } catch {
      continue
    }
  }

  throw "Cannot create a local ASR temp directory."
}

function Install-VcRuntime {
  $vcInstaller = Join-Path $TempRoot "vc_redist.x64.exe"
  Write-Host "Installing Microsoft Visual C++ Runtime for whisper.cpp."
  Download-File -Url "https://aka.ms/vs/17/release/vc_redist.x64.exe" -OutFile $vcInstaller
  Assert-DownloadedFile -Path $vcInstaller -MinBytes 1MB -Label "Microsoft Visual C++ Runtime" | Out-Null
  & $vcInstaller /install /quiet /norestart
  $exit = $LASTEXITCODE
  if ($exit -notin @(0, 3010)) {
    throw "Microsoft Visual C++ Runtime install failed with exit code $exit"
  }
}

function Assert-ExecutableRuns {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Label,
    [switch]$TryInstallVcRuntime
  )
  $result = Invoke-NativeProcess -FilePath $Path -Arguments $Arguments
  $output = $result.Output
  $exit = $result.ExitCode
  if ($exit -eq 0) {
    return $output
  }

  $hex = Convert-ExitCodeToHex -ExitCode $exit
  if ($TryInstallVcRuntime -and ($exit -eq -1073741515 -or $hex -eq "0xC0000135")) {
    Write-Host "$Label failed to start with $exit/$hex. This usually means the Windows VC++ Runtime is missing."
    Install-VcRuntime
    $result = Invoke-NativeProcess -FilePath $Path -Arguments $Arguments
    $output = $result.Output
    $exit = $result.ExitCode
    if ($exit -eq 0) {
      return $output
    }
    $hex = Convert-ExitCodeToHex -ExitCode $exit
  }

  throw "$Label runtime validation failed with exit code $exit/$hex. $output"
}

function Assert-LocalAsrInference {
  param(
    [Parameter(Mandatory = $true)][string]$WhisperPath,
    [Parameter(Mandatory = $true)][string]$FfmpegPath,
    [Parameter(Mandatory = $true)][string]$ModelPath
  )
  $validationDir = New-SafeTempDirectory
  try {
    $samplePath = Join-Path $validationDir "validation.wav"
    $outputBase = Join-Path $validationDir "validation"
    Assert-ExecutableRuns `
      -Path $FfmpegPath `
      -Arguments @(
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi",
        "-i", "sine=frequency=440:duration=1",
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        $samplePath
      ) `
      -Label "ffmpeg inference validation" | Out-Null
    Assert-ExecutableRuns `
      -Path $WhisperPath `
      -Arguments @(
        "-m", (Get-ShortPath $ModelPath),
        "-f", (Get-ShortPath $samplePath),
        "-l", "zh",
        "-otxt",
        "-of", (Get-ShortPath $outputBase)
      ) `
      -Label "whisper.cpp inference validation" `
      -TryInstallVcRuntime | Out-Null
    Write-Host "Local ASR inference validation passed."
  } finally {
    if (Test-Path -LiteralPath $validationDir) {
      Remove-Item -LiteralPath $validationDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Install-ZipPackage {
  param(
    [Parameter(Mandatory = $true)][string[]]$Urls,
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$StageDir,
    [Parameter(Mandatory = $true)][Int64]$MinBytes,
    [Parameter(Mandatory = $true)][string[]]$ExpectedFiles,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $lastError = $null
  foreach ($url in $Urls) {
    try {
      if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
      }
      New-CleanDirectory -Path $StageDir
      Download-File -Url $url -OutFile $ZipPath
      Assert-DownloadedFile -Path $ZipPath -MinBytes $MinBytes -Label $Label | Out-Null
      Expand-Archive -LiteralPath $ZipPath -DestinationPath $StageDir -Force
      return Assert-InstalledFile -Root $StageDir -Names $ExpectedFiles -Label $Label
    } catch {
      $lastError = $_
      Write-Host "$Label source failed: $url"
      Write-Host ($_.Exception.Message)
    }
  }
  throw $lastError
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

function Write-TranscribeScript {
  param([Parameter(Mandatory = $true)][string]$InstallRoot)

  $scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.ScriptName }
  if (-not $scriptPath) {
    throw "Cannot determine installer script path."
  }
  $installerSource = [System.IO.File]::ReadAllText($scriptPath)
  $beginMarker = "# BEGIN_TRANSCRIBE_TEMPLATE"
  $endMarker = "# END_TRANSCRIBE_TEMPLATE"
  $beginIndex = $installerSource.LastIndexOf($beginMarker)
  $endIndex = $installerSource.LastIndexOf($endMarker)
  if ($beginIndex -lt 0 -or $endIndex -le $beginIndex) {
    throw "Cannot find embedded transcribe script template."
  }

  $quoteIndex = $installerSource.IndexOf("@'", $beginIndex)
  $contentStart = $installerSource.IndexOf("`n", $quoteIndex)
  $quoteEnd = $installerSource.IndexOf("`n'@", $contentStart)
  if ($quoteIndex -lt 0 -or $contentStart -lt 0 -or $quoteEnd -le $contentStart) {
    throw "Cannot parse embedded transcribe script template."
  }

  $template = $installerSource.Substring($contentStart + 1, $quoteEnd - $contentStart - 1).TrimEnd("`r", "`n")
  $transcribeScript = Join-Path $InstallRoot "transcribe.ps1"
  Set-Content -LiteralPath $transcribeScript -Value $template -Encoding UTF8
  Assert-InstalledFile -Root $InstallRoot -Names @("transcribe.ps1") -Label "transcribe script" | Out-Null
}

try {
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  Write-TranscribeScript -InstallRoot $InstallRoot
  New-CleanDirectory -Path $TempRoot

  $WhisperDir = Join-Path $InstallRoot "whisper"
  $FfmpegDir = Join-Path $InstallRoot "ffmpeg"
  $ModelDir = Join-Path $InstallRoot "models"
  $WhisperStageDir = Join-Path $TempRoot "whisper"
  $FfmpegStageDir = Join-Path $TempRoot "ffmpeg"
  New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

  $installedWhisper = Find-InstalledFile -Root $WhisperDir -Names @("whisper-cli.exe", "main.exe")
  if ($installedWhisper) {
    try {
      Assert-ExecutableRuns -Path $installedWhisper.FullName -Arguments @("--help") -Label "whisper.cpp" -TryInstallVcRuntime | Out-Null
      Write-Host "Existing whisper.cpp is usable; skipping download."
    } catch {
      Write-Host "Existing whisper.cpp is not usable; reinstalling."
      Write-Host ($_.Exception.Message)
      $installedWhisper = $null
    }
  }
  if (-not $installedWhisper) {
    $whisperZip = Join-Path $TempRoot "whisper.zip"
    Install-ZipPackage `
      -Urls @((Get-LatestWhisperWindowsAsset)) `
      -ZipPath $whisperZip `
      -StageDir $WhisperStageDir `
      -MinBytes 1MB `
      -ExpectedFiles @("whisper-cli.exe", "main.exe") `
      -Label "whisper.cpp" | Out-Null

    if (Test-Path -LiteralPath $WhisperDir) {
      Remove-Item -LiteralPath $WhisperDir -Recurse -Force
    }
    Move-Item -LiteralPath $WhisperStageDir -Destination $WhisperDir
    $installedWhisper = Assert-InstalledFile -Root $WhisperDir -Names @("whisper-cli.exe", "main.exe") -Label "whisper.cpp"
    Assert-ExecutableRuns -Path $installedWhisper.FullName -Arguments @("--help") -Label "whisper.cpp" -TryInstallVcRuntime | Out-Null
  }

  $installedFfmpeg = Find-InstalledFile -Root $FfmpegDir -Names @("ffmpeg.exe")
  if ($installedFfmpeg) {
    try {
      Assert-ExecutableRuns -Path $installedFfmpeg.FullName -Arguments @("-version") -Label "ffmpeg" | Out-Null
      Write-Host "Existing ffmpeg is usable; skipping download."
    } catch {
      Write-Host "Existing ffmpeg is not usable; reinstalling."
      Write-Host ($_.Exception.Message)
      $installedFfmpeg = $null
    }
  }
  if (-not $installedFfmpeg) {
    $ffmpegZip = Join-Path $TempRoot "ffmpeg.zip"
    Install-ZipPackage `
      -Urls @(
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip"
      ) `
      -ZipPath $ffmpegZip `
      -StageDir $FfmpegStageDir `
      -MinBytes 10MB `
      -ExpectedFiles @("ffmpeg.exe") `
      -Label "ffmpeg" | Out-Null

    if (Test-Path -LiteralPath $FfmpegDir) {
      Remove-Item -LiteralPath $FfmpegDir -Recurse -Force
    }
    Move-Item -LiteralPath $FfmpegStageDir -Destination $FfmpegDir
    $installedFfmpeg = Assert-InstalledFile -Root $FfmpegDir -Names @("ffmpeg.exe") -Label "ffmpeg"
    Assert-ExecutableRuns -Path $installedFfmpeg.FullName -Arguments @("-version") -Label "ffmpeg" | Out-Null
  }

  $modelPath = Join-Path $ModelDir "ggml-small.bin"
  if ((Test-Path -LiteralPath $modelPath) -and ((Get-Item -LiteralPath $modelPath).Length -lt 400MB)) {
    Remove-Item -LiteralPath $modelPath -Force
  }
  if (-not (Test-Path -LiteralPath $modelPath)) {
    $modelTempPath = Join-Path $TempRoot "ggml-small.bin"
    Download-File -Url "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin" -OutFile $modelTempPath
    Assert-DownloadedFile -Path $modelTempPath -MinBytes 400MB -Label "Whisper model" | Out-Null
    Move-Item -LiteralPath $modelTempPath -Destination $modelPath -Force
  }

  Assert-DownloadedFile -Path $modelPath -MinBytes 400MB -Label "Whisper model" | Out-Null

  try {
    Assert-LocalAsrInference -WhisperPath $installedWhisper.FullName -FfmpegPath $installedFfmpeg.FullName -ModelPath $modelPath
  } catch {
    Write-Host "Current whisper.cpp failed real inference validation; reinstalling once."
    Write-Host ($_.Exception.Message)
    $whisperZip = Join-Path $TempRoot "whisper-retry.zip"
    Install-ZipPackage `
      -Urls @((Get-LatestWhisperWindowsAsset)) `
      -ZipPath $whisperZip `
      -StageDir $WhisperStageDir `
      -MinBytes 1MB `
      -ExpectedFiles @("whisper-cli.exe", "main.exe") `
      -Label "whisper.cpp" | Out-Null
    if (Test-Path -LiteralPath $WhisperDir) {
      Remove-Item -LiteralPath $WhisperDir -Recurse -Force
    }
    Move-Item -LiteralPath $WhisperStageDir -Destination $WhisperDir
    $installedWhisper = Assert-InstalledFile -Root $WhisperDir -Names @("whisper-cli.exe", "main.exe") -Label "whisper.cpp"
    Assert-ExecutableRuns -Path $installedWhisper.FullName -Arguments @("--help") -Label "whisper.cpp" -TryInstallVcRuntime | Out-Null
    Assert-LocalAsrInference -WhisperPath $installedWhisper.FullName -FfmpegPath $installedFfmpeg.FullName -ModelPath $modelPath
  }

# BEGIN_TRANSCRIBE_TEMPLATE
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

$ChunkSeconds = 600
$OutputBase = if ($OutputPath.ToLowerInvariant().EndsWith(".txt")) {
  $OutputPath.Substring(0, $OutputPath.Length - 4)
} else {
  $OutputPath
}
$RunLog = Join-Path $Root "transcribe-last.log"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$SimplifiedPrompt = [string]::Concat([char]0x8bf7, [char]0x8f93, [char]0x51fa, [char]0x7b80, [char]0x4f53, [char]0x4e2d, [char]0x6587)

function ConvertTo-NativeArgument {
  param([AllowNull()][string]$Value)
  $text = [string]$Value
  if ($text -eq "") {
    return '""'
  }
  if ($text -notmatch '[\s"]') {
    return $text
  }
  return '"' + ($text -replace '"', '\"') + '"'
}

function Get-ShortPath {
  param([AllowNull()][string]$Path)
  $text = [string]$Path
  if ($text -eq "") {
    return ""
  }
  try {
    $fso = New-Object -ComObject Scripting.FileSystemObject
    if (Test-Path -LiteralPath $text -PathType Leaf) {
      return $fso.GetFile($text).ShortPath
    }
    if (Test-Path -LiteralPath $text -PathType Container) {
      return $fso.GetFolder($text).ShortPath
    }
    $parent = Split-Path -Parent $text
    $name = Split-Path -Leaf $text
    if ($parent -and (Test-Path -LiteralPath $parent)) {
      $shortParent = Get-ShortPath $parent
      if ($shortParent) {
        return Join-Path $shortParent $name
      }
    }
  } catch {
    return $text
  }
  return $text
}

function New-SafeTempDirectory {
  $baseCandidates = @()
  if ($env:ProgramData) {
    $baseCandidates += (Join-Path $env:ProgramData "wechat-inbox-local-asr")
  }
  if ($env:PUBLIC) {
    $baseCandidates += (Join-Path $env:PUBLIC "wechat-inbox-local-asr")
  }
  if ($env:SystemDrive) {
    $baseCandidates += (Join-Path $env:SystemDrive "wechat-inbox-local-asr-temp")
  }
  if ($env:TEMP) {
    $baseCandidates += $env:TEMP
  }

  foreach ($base in $baseCandidates) {
    try {
      New-Item -ItemType Directory -Force -Path $base | Out-Null
      $dir = Join-Path $base ("run-" + [guid]::NewGuid().ToString("N"))
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
      return $dir
    } catch {
      continue
    }
  }

  throw "Cannot create a local ASR temp directory."
}

function Invoke-NativeProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $nativeTempDir = Join-Path $env:TEMP ("wechat-inbox-local-asr-native-" + [guid]::NewGuid().ToString("N"))
  $stdoutPath = Join-Path $nativeTempDir "stdout.log"
  $stderrPath = Join-Path $nativeTempDir "stderr.log"
  try {
    New-Item -ItemType Directory -Force -Path $nativeTempDir | Out-Null
    $process = Start-Process `
      -FilePath $FilePath `
      -ArgumentList $Arguments `
      -NoNewWindow `
      -Wait `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath
    $exitCode = $process.ExitCode
    $stdoutText = if (Test-Path -LiteralPath $stdoutPath) { [string](Get-Content -LiteralPath $stdoutPath -Raw) } else { "" }
    $stderrText = if (Test-Path -LiteralPath $stderrPath) { [string](Get-Content -LiteralPath $stderrPath -Raw) } else { "" }
  } finally {
    Remove-Item -LiteralPath $nativeTempDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  $combined = @(
    "--- stdout ---"
    ([string]$stdoutText).TrimEnd()
    "--- stderr ---"
    ([string]$stderrText).TrimEnd()
  ) -join [Environment]::NewLine
  return [PSCustomObject]@{
    ExitCode = $exitCode
    Output = $combined
  }
}

function ConvertTo-SimplifiedChinese {
  param([AllowNull()][string]$Text)
  $source = [string]$Text
  if ($source -eq "") {
    return ""
  }
  try {
    Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop
    return [Microsoft.VisualBasic.Strings]::StrConv($source, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804)
  } catch {
    return $source
  }
}

try {
  $SafeTempRoot = New-SafeTempDirectory
  $TempWorkDir = Join-Path $SafeTempRoot "chunks"
  New-Item -ItemType Directory -Force -Path $TempWorkDir | Out-Null
  $SafeInputPath = Join-Path $SafeTempRoot ("input" + [System.IO.Path]::GetExtension($InputPath))
  Copy-Item -LiteralPath $InputPath -Destination $SafeInputPath -Force
  $ChunkPattern = Join-Path $TempWorkDir "chunk-%03d.wav"
  @(
    "time=$(Get-Date -Format o)"
    "status=running"
    "inputPath=$InputPath"
    "outputPath=$OutputPath"
    "safeInputPath=$SafeInputPath"
    "tempWorkDir=$TempWorkDir"
    "chunkSeconds=$ChunkSeconds"
  ) | Set-Content -LiteralPath $RunLog -Encoding UTF8
  $ffmpegResult = Invoke-NativeProcess -FilePath $Ffmpeg.FullName -Arguments @(
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", (Get-ShortPath $SafeInputPath),
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-f", "segment",
    "-segment_time", [string]$ChunkSeconds,
    "-reset_timestamps", "1",
    $ChunkPattern
  )
  $ffmpegOutput = $ffmpegResult.Output
  $ffmpegExit = $ffmpegResult.ExitCode
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
    $chunkResult = Invoke-NativeProcess -FilePath $Whisper.FullName -Arguments @(
      "-m", (Get-ShortPath $Model),
      "-f", (Get-ShortPath $chunk.FullName),
      "-l", "zh",
      "--prompt", $SimplifiedPrompt,
      "-otxt",
      "-of", (Get-ShortPath $chunkBase)
    )
    $chunkOutput = $chunkResult.Output
    $currentExit = $chunkResult.ExitCode
    $whisperLogs.Add("--- $($chunk.Name) exit=$currentExit ---")
    $whisperLogs.Add($chunkOutput)
    if ($currentExit -ne 0) {
      $whisperExit = $currentExit
      break
    }
    if (Test-Path -LiteralPath $chunkTxt) {
      $text = ([System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)).Trim()
      if ($text) {
        $mergedText.Add((ConvertTo-SimplifiedChinese $text))
      }
    }
  }

  @(
    "time=$(Get-Date -Format o)"
    "status=running"
    "inputPath=$InputPath"
    "outputPath=$OutputPath"
    "safeInputPath=$SafeInputPath"
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

  $finalText = ConvertTo-SimplifiedChinese ($mergedText -join "`n`n")
  [System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)
  Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value "status=success"
  [System.IO.File]::ReadAllText($OutputPath, $Utf8NoBom)
} catch {
  Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value @(
    "status=failed"
    "--- error ---"
    ($_ | Out-String)
  )
  throw
} finally {
  if ($SafeTempRoot -and (Test-Path -LiteralPath $SafeTempRoot)) {
    Remove-Item -LiteralPath $SafeTempRoot -Recurse -Force
  }
}
'@ | Set-Content -LiteralPath $transcribeScript -Encoding UTF8
# END_TRANSCRIBE_TEMPLATE

  Assert-InstalledFile -Root $InstallRoot -Names @("transcribe.ps1") -Label "transcribe script" | Out-Null

  Write-Host ""
  Write-Host "Local ASR install validation passed."
  Write-Host "whisper: $($installedWhisper.FullName)"
  Write-Host "ffmpeg: $($installedFfmpeg.FullName)"
  Write-Host "model: $modelPath"
  Write-Host "Local ASR installed to: $InstallRoot"
  Write-Host "Use this Obsidian plugin command:"
  Write-Host "powershell -NoProfile -ExecutionPolicy Bypass -File `"`$env:USERPROFILE\.wechat-inbox-local-asr\transcribe.ps1`" -InputPath {input} -OutputPath {output}"
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
  }
}
