param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE ".wechat-inbox-local-asr")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$TempRoot = Join-Path $env:TEMP ("wechat-inbox-local-asr-install-" + [guid]::NewGuid().ToString("N"))
$CacheRoot = Join-Path $InstallRoot "cache"
$InstallStatePath = Join-Path $InstallRoot ".install-state.json"
$InstallerScriptVersion = "1.2.23"
$DownloadLowSpeedLimitBytesPerSecond = 10240
$DownloadLowSpeedTimeoutSeconds = 90
$DownloadTimeoutSeconds = 1200
$InstallLockPath = Join-Path $InstallRoot ".install.lock"
$InstallMutexName = "Global\WechatInboxLocalAsrInstall"
$Headers = @{ "User-Agent" = "wechat-inbox-sync-local-asr-installer" }
$TencentCosAssetBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/windows"
$WhisperWindowsTencentUrls = @()
$WhisperWindowsCompatibilityUrls = @()
$WhisperWindowsCompatibilitySha256 = '7B562DEEF031BD8A1A3954E3F5FF43BE0ACE2E86974235518530594BEECFF4B7'
$FfmpegTencentUrls = @()
$ModelTencentUrls = @()
if (-not [string]::IsNullOrWhiteSpace($TencentCosAssetBaseUrl)) {
  $tencentCosAssetBase = $TencentCosAssetBaseUrl.TrimEnd("/")
  $WhisperWindowsTencentUrls += "$tencentCosAssetBase/whisper-bin-x64.zip"
  $WhisperWindowsCompatibilityUrls += "$tencentCosAssetBase/whisper-bin-x64-compat.zip"
  $FfmpegTencentUrls += "$tencentCosAssetBase/ffmpeg-release-essentials.zip"
  $ModelTencentUrls += "$tencentCosAssetBase/ggml-small.bin"
}
$ModelFallbackUrls = @(
  "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
)
$WhisperWindowsFallbackUrls = @(
  "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.0/whisper-bin-x64.zip"
)

function New-CleanDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Acquire-InstallLock {
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  $mutex = New-Object System.Threading.Mutex($false, $InstallMutexName)
  $acquired = $false
  try {
    $acquired = $mutex.WaitOne([TimeSpan]::FromSeconds(10))
  } catch [System.Threading.AbandonedMutexException] {
    $acquired = $true
  }
  if (-not $acquired) {
    throw "Another local ASR installation is already running. Please stop the previous installation or wait a few minutes, then retry."
  }
  Set-Content -LiteralPath $InstallLockPath -Encoding UTF8 -Value @(
    "pid=$PID"
    "time=$(Get-Date -Format o)"
  )
  return $mutex
}

function Release-InstallLock {
  param([AllowNull()]$Mutex)
  if ($Mutex) {
    try {
      $Mutex.ReleaseMutex()
    } catch {
      # The mutex may already be abandoned if the process is exiting.
    }
    $Mutex.Dispose()
  }
  Remove-Item -LiteralPath $InstallLockPath -Force -ErrorAction SilentlyContinue
}

function Copy-FileWithRetry {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [int]$Attempts = 10,
    [int]$DelayMilliseconds = 1000
  )
  $lastError = $null
  $destinationDir = Split-Path -Parent $DestinationPath
  if ($destinationDir) {
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
  }
  for ($i = 1; $i -le $Attempts; $i += 1) {
    try {
      Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
      return $DestinationPath
    } catch {
      $lastError = $_
      Write-Host "File is busy, retrying copy $i/$Attempts`: $SourcePath"
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }
  throw $lastError
}

function Prepare-ZipForExtraction {
  param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$TempRoot,
    [Parameter(Mandatory = $true)][string]$Label,
    [string]$FallbackUrl = ""
  )
  $extractZipPath = Join-Path $TempRoot ("extract-" + [guid]::NewGuid().ToString("N") + ".zip")
  try {
    Copy-FileWithRetry -SourcePath $ZipPath -DestinationPath $extractZipPath | Out-Null
    return $extractZipPath
  } catch {
    if (-not $FallbackUrl) {
      throw
    }
    Write-Host "$Label cache package is locked or unreadable; downloading a fresh temporary package."
    Download-File -Url $FallbackUrl -OutFile $extractZipPath -Resume
    return $extractZipPath
  }
}

function Remove-ItemIfNotBusy {
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
    return $true
  } catch {
    Write-Host "Cannot remove busy cache file; keeping it for a later retry: $Path"
    return $false
  }
}

function Download-ZipToCacheOrTemp {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$CachePath,
    [Parameter(Mandatory = $true)][string]$TempPath
  )
  try {
    Download-File -Url $Url -OutFile $CachePath -Resume
    return $CachePath
  } catch {
    Write-Host "Cache download failed or cache is busy; downloading to a temporary package."
    Download-File -Url $Url -OutFile $TempPath -Resume
    return $TempPath
  }
}

function Download-File {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [switch]$Resume
  )
  $outDir = Split-Path -Parent $OutFile
  if ($outDir) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  }
  Write-Host "Downloading $Url"
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($Resume -and $curl) {
    & $curl.Source `
      -L `
      --fail `
      --silent `
      --show-error `
      --retry 2 `
      --retry-delay 2 `
      --connect-timeout 30 `
      --speed-limit $DownloadLowSpeedLimitBytesPerSecond `
      --speed-time $DownloadLowSpeedTimeoutSeconds `
      --max-time $DownloadTimeoutSeconds `
      -C - `
      -o $OutFile `
      $Url
    if ($LASTEXITCODE -eq 0) {
      return
    }
    Write-Host "curl resumable download failed with exit code $LASTEXITCODE; retrying with PowerShell."
  }
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -Headers $Headers -TimeoutSec $DownloadTimeoutSeconds
  } catch {
    Write-Host "PowerShell download failed, retrying with curl."
    if (-not $curl) {
      throw
    }
    & $curl.Source `
      -L `
      --fail `
      --silent `
      --show-error `
      --retry 2 `
      --retry-delay 2 `
      --connect-timeout 30 `
      --speed-limit $DownloadLowSpeedLimitBytesPerSecond `
      --speed-time $DownloadLowSpeedTimeoutSeconds `
      --max-time $DownloadTimeoutSeconds `
      -C - `
      -o $OutFile `
      $Url
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
  $signed = [int64]$ExitCode
  if ($signed -lt 0) {
    $signed = 4294967296 + $signed
  }
  return "0x{0:X8}" -f $signed
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

function Assert-FileSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label is missing after download: $Path"
  }
  $actualSha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualSha256 -ne $ExpectedSha256.ToUpperInvariant()) {
    throw "$Label SHA-256 mismatch (expected $ExpectedSha256, got $actualSha256)."
  }
}

function Test-IllegalInstructionExitCode {
  param([AllowNull()]$Value)
  if ($Value -is [int]) {
    return $Value -eq -1073741795 -or (Convert-ExitCodeToHex -ExitCode $Value) -eq "0xC000001D"
  }
  $text = [string]$Value
  return $text -match "exit code\\s+-1073741795/0xC000001D" -or $text -match "0xC000001D"
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
    $safeModelPath = Join-Path $validationDir "ggml-small.bin"
    Copy-Item -LiteralPath $ModelPath -Destination $safeModelPath -Force
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
        "-m", (Get-ShortPath $safeModelPath),
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

function Read-InstallState {
  if (-not (Test-Path -LiteralPath $InstallStatePath)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $InstallStatePath -Raw | ConvertFrom-Json
  } catch {
    Write-Host "Install state is unreadable; running full validation."
    return $null
  }
}

function Get-FileState {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  $item = Get-Item -LiteralPath $Path
  return [pscustomobject]@{
    path = $item.FullName
    length = [Int64]$item.Length
    lastWriteUtcTicks = [Int64]$item.LastWriteTimeUtc.Ticks
  }
}

function Test-FileStateMatches {
  param(
    [AllowNull()]$State,
    [Parameter(Mandatory = $true)][string]$Path
  )
  if (-not $State) {
    return $false
  }
  $actual = Get-FileState -Path $Path
  if (-not $actual) {
    return $false
  }
  return (
    $State.path -eq $actual.path -and
    [Int64]$State.length -eq $actual.length -and
    [Int64]$State.lastWriteUtcTicks -eq $actual.lastWriteUtcTicks
  )
}

function Test-InstallStateValid {
  param(
    [AllowNull()]$State,
    [Parameter(Mandatory = $true)][string]$WhisperPath,
    [Parameter(Mandatory = $true)][string]$FfmpegPath,
    [Parameter(Mandatory = $true)][string]$ModelPath
  )
  if (-not $State) {
    return $false
  }
  if ($State.installerScriptVersion -ne $InstallerScriptVersion) {
    return $false
  }
  if ($State.validationStatus -ne "passed") {
    return $false
  }
  return (
    (Test-FileStateMatches -State $State.whisper -Path $WhisperPath) -and
    (Test-FileStateMatches -State $State.ffmpeg -Path $FfmpegPath) -and
    (Test-FileStateMatches -State $State.model -Path $ModelPath)
  )
}

function Write-InstallState {
  param(
    [Parameter(Mandatory = $true)][string]$WhisperPath,
    [Parameter(Mandatory = $true)][string]$FfmpegPath,
    [Parameter(Mandatory = $true)][string]$ModelPath
  )
  $state = [pscustomobject]@{
    installerScriptVersion = $InstallerScriptVersion
    validationStatus = "passed"
    validatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    whisper = Get-FileState -Path $WhisperPath
    ffmpeg = Get-FileState -Path $FfmpegPath
    model = Get-FileState -Path $ModelPath
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $InstallStatePath -Encoding UTF8
}

function Invoke-LocalAsrValidation {
  param(
    [Parameter(Mandatory = $true)][string]$WhisperPath,
    [Parameter(Mandatory = $true)][string]$FfmpegPath,
    [Parameter(Mandatory = $true)][string]$ModelPath
  )
  $state = Read-InstallState
  if (Test-InstallStateValid -State $state -WhisperPath $WhisperPath -FfmpegPath $FfmpegPath -ModelPath $ModelPath) {
    Write-Host "Local ASR was already validated for the current files; skipping full inference validation."
    return
  }
  Assert-LocalAsrInference -WhisperPath $WhisperPath -FfmpegPath $FfmpegPath -ModelPath $ModelPath
  Write-InstallState -WhisperPath $WhisperPath -FfmpegPath $FfmpegPath -ModelPath $ModelPath
}

function Get-EnabledAssetUrls {
  param(
    [string[]]$PrimaryUrls = @(),
    [string[]]$FallbackUrls = @()
  )
  $enabledPrimaryUrls = @()
  foreach ($url in $PrimaryUrls) {
    $value = [string]$url
    if ([string]::IsNullOrWhiteSpace($value)) {
      continue
    }
    $trimmed = $value.Trim()
    if ($trimmed -match "example\.com|your-cos-url|<|>") {
      Write-Host "Skipping invalid primary asset URL: $trimmed"
      continue
    }
    $enabledPrimaryUrls += $trimmed
  }
  return @($enabledPrimaryUrls + $FallbackUrls)
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
      New-CleanDirectory -Path $StageDir
      $cacheFile = $ZipPath
      if ((Test-Path -LiteralPath $cacheFile) -and ((Get-Item -LiteralPath $cacheFile).Length -ge $MinBytes)) {
        Write-Host "Using cached $Label package: $cacheFile"
        $extractZipPath = Prepare-ZipForExtraction -ZipPath $cacheFile -TempRoot $TempRoot -Label $Label -FallbackUrl $url
      } else {
        if (Test-Path -LiteralPath $cacheFile) {
          Write-Host "Resuming partial cached $Label package: $cacheFile"
        }
        $downloadTempPath = Join-Path $TempRoot ("download-" + [guid]::NewGuid().ToString("N") + ".zip")
        $zipForExtraction = Download-ZipToCacheOrTemp -Url $url -CachePath $cacheFile -TempPath $downloadTempPath
        $extractZipPath = Prepare-ZipForExtraction -ZipPath $zipForExtraction -TempRoot $TempRoot -Label $Label -FallbackUrl $url
      }
      Assert-DownloadedFile -Path $extractZipPath -MinBytes $MinBytes -Label $Label | Out-Null
      Expand-Archive -LiteralPath $extractZipPath -DestinationPath $StageDir -Force
      return Assert-InstalledFile -Root $StageDir -Names $ExpectedFiles -Label $Label
    } catch {
      $lastError = $_
      Write-Host "$Label source failed: $url"
      Write-Host ($_.Exception.Message)
      if (Test-Path -LiteralPath $ZipPath) {
        $cachedZip = Get-Item -LiteralPath $ZipPath
        if ($cachedZip.Length -ge $MinBytes) {
          Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
        } else {
          Write-Host "Keeping partial $Label package for retry: $ZipPath"
        }
      }
    }
  }
  throw $lastError
}

function Install-ExtractedPackage {
  param(
    [Parameter(Mandatory = $true)][string]$StageDir,
    [Parameter(Mandatory = $true)][string]$DestinationDir,
    [Parameter(Mandatory = $true)][string[]]$ExpectedFiles,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $found = Find-InstalledFile -Root $StageDir -Names $ExpectedFiles
  if (-not $found) {
    throw "$Label install validation failed: cannot find $($ExpectedFiles -join ' or ') under $StageDir"
  }
  if (Test-Path -LiteralPath $DestinationDir) {
    Remove-Item -LiteralPath $DestinationDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null
  Get-ChildItem -LiteralPath $StageDir -Force |
    Copy-Item -Destination $DestinationDir -Recurse -Force
  return Assert-InstalledFile -Root $DestinationDir -Names $ExpectedFiles -Label $Label
}

function Install-WhisperCompatibilityPackage {
  param(
    [Parameter(Mandatory = $true)][string]$DestinationDir,
    [Parameter(Mandatory = $true)][string]$StageDir
  )
  $compatibilityUrls = Get-EnabledAssetUrls -PrimaryUrls $WhisperWindowsCompatibilityUrls
  if (-not $compatibilityUrls -or $compatibilityUrls.Count -eq 0) {
    throw "whisper.cpp compatibility build is not configured. Please contact support with the installer diagnostic."
  }
  Write-Host "Current whisper.cpp uses unsupported CPU instructions; trying the compatibility build."
  $optimizedCachePath = Join-Path $CacheRoot "whisper.zip"
  Remove-Item -LiteralPath $optimizedCachePath -Force -ErrorAction SilentlyContinue
  $compatibilityZip = Join-Path $CacheRoot "whisper-compat.zip"
  Install-ZipPackage `
    -Urls $compatibilityUrls `
    -ZipPath $compatibilityZip `
    -StageDir $StageDir `
    -MinBytes 1MB `
    -ExpectedFiles @("whisper-cli.exe", "main.exe") `
    -Label "whisper.cpp compatibility" | Out-Null
  Assert-FileSha256 -Path $compatibilityZip `
    -ExpectedSha256 $WhisperWindowsCompatibilitySha256 `
    -Label "whisper.cpp compatibility"
  $installed = Install-ExtractedPackage `
    -StageDir $StageDir `
    -DestinationDir $DestinationDir `
    -ExpectedFiles @("whisper-cli.exe", "main.exe") `
    -Label "whisper.cpp compatibility"
  Assert-ExecutableRuns -Path $installed.FullName -Arguments @("--help") -Label "whisper.cpp compatibility" -TryInstallVcRuntime | Out-Null
  return $installed
}

function Install-ModelPackage {
  param(
    [Parameter(Mandatory = $true)][string[]]$Urls,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [Parameter(Mandatory = $true)][Int64]$MinBytes,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $lastError = $null
  foreach ($url in $Urls) {
    try {
      if (Test-Path -LiteralPath $OutFile) {
        if ((Get-Item -LiteralPath $OutFile).Length -ge $MinBytes) {
          Write-Host "Using cached $Label package: $OutFile"
          return $OutFile
        }
        Write-Host "Resuming partial cached $Label package: $OutFile"
      }
      Download-File -Url $url -OutFile $OutFile -Resume
      Assert-DownloadedFile -Path $OutFile -MinBytes $MinBytes -Label $Label | Out-Null
      return $OutFile
    } catch {
      $lastError = $_
      Write-Host "$Label source failed: $url"
      Write-Host ($_.Exception.Message)
      if (Test-Path -LiteralPath $OutFile) {
        $cachedFile = Get-Item -LiteralPath $OutFile
        if ($cachedFile.Length -ge $MinBytes) {
          Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
        } else {
          Write-Host "Keeping partial $Label package for retry: $OutFile"
        }
      }
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

  try {
    $latestResponse = Invoke-WebRequest -Uri "https://github.com/ggml-org/whisper.cpp/releases/latest" -Headers $Headers -MaximumRedirection 0 -ErrorAction Stop
    $location = $latestResponse.Headers.Location
    if (-not $location) {
      throw "Cannot locate latest whisper.cpp release."
    }
    $tag = Split-Path -Leaf ([uri]$location).AbsolutePath
    $assetsPage = Invoke-WebRequest -Uri "https://github.com/ggml-org/whisper.cpp/releases/expanded_assets/$tag" -Headers $Headers -ErrorAction Stop
    $match = [regex]::Match($assetsPage.Content, '/ggml-org/whisper\.cpp/releases/download/[^"]+whisper-bin-x64\.zip')
    if (-not $match.Success) {
      $match = [regex]::Match($assetsPage.Content, '/ggml-org/whisper\.cpp/releases/download/[^"]+whisper[^"]+x64[^"]+\.zip')
    }
    if ($match.Success) {
      return "https://github.com$($match.Value)"
    }
    throw "Cannot find a Windows x64 whisper.cpp release asset on the expanded assets page."
  } catch {
    Write-Host "GitHub release page parsing failed; falling back to bundled whisper.cpp release URL."
    Write-Host ($_.Exception.Message)
  }
  return $WhisperWindowsFallbackUrls[0]
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

$installMutex = $null
try {
  $installMutex = Acquire-InstallLock
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
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
    $whisperZip = Join-Path $CacheRoot "whisper.zip"
    Install-ZipPackage `
      -Urls (Get-EnabledAssetUrls -PrimaryUrls $WhisperWindowsTencentUrls -FallbackUrls $WhisperWindowsFallbackUrls) `
      -ZipPath $whisperZip `
      -StageDir $WhisperStageDir `
      -MinBytes 1MB `
      -ExpectedFiles @("whisper-cli.exe", "main.exe") `
      -Label "whisper.cpp" | Out-Null

    if (Test-Path -LiteralPath $WhisperDir) {
      Remove-Item -LiteralPath $WhisperDir -Recurse -Force
    }
    $installedWhisper = Install-ExtractedPackage -StageDir $WhisperStageDir -DestinationDir $WhisperDir -ExpectedFiles @("whisper-cli.exe", "main.exe") -Label "whisper.cpp"
    try {
      Assert-ExecutableRuns -Path $installedWhisper.FullName -Arguments @("--help") -Label "whisper.cpp" -TryInstallVcRuntime | Out-Null
    } catch {
      if (-not (Test-IllegalInstructionExitCode -Value ($_ | Out-String))) {
        throw
      }
      $installedWhisper = Install-WhisperCompatibilityPackage -DestinationDir $WhisperDir -StageDir (Join-Path $TempRoot "whisper-compat")
    }
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
    $ffmpegZip = Join-Path $CacheRoot "ffmpeg.zip"
    Install-ZipPackage `
      -Urls (Get-EnabledAssetUrls -PrimaryUrls $FfmpegTencentUrls -FallbackUrls @(
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip"
      )) `
      -ZipPath $ffmpegZip `
      -StageDir $FfmpegStageDir `
      -MinBytes 10MB `
      -ExpectedFiles @("ffmpeg.exe") `
      -Label "ffmpeg" | Out-Null

    if (Test-Path -LiteralPath $FfmpegDir) {
      Remove-Item -LiteralPath $FfmpegDir -Recurse -Force
    }
    $installedFfmpeg = Install-ExtractedPackage -StageDir $FfmpegStageDir -DestinationDir $FfmpegDir -ExpectedFiles @("ffmpeg.exe") -Label "ffmpeg"
    Assert-ExecutableRuns -Path $installedFfmpeg.FullName -Arguments @("-version") -Label "ffmpeg" | Out-Null
  }

  $modelPath = Join-Path $ModelDir "ggml-small.bin"
  $cachedModelPath = Join-Path $CacheRoot "ggml-small.bin"
  if ((Test-Path -LiteralPath $modelPath) -and ((Get-Item -LiteralPath $modelPath).Length -lt 400MB)) {
    Remove-Item -LiteralPath $modelPath -Force
  }
  if (-not (Test-Path -LiteralPath $modelPath)) {
    if ((Test-Path -LiteralPath $cachedModelPath) -and ((Get-Item -LiteralPath $cachedModelPath).Length -lt 400MB)) {
      Remove-Item -LiteralPath $cachedModelPath -Force
    }
    Install-ModelPackage -Urls (Get-EnabledAssetUrls -PrimaryUrls $ModelTencentUrls -FallbackUrls $ModelFallbackUrls) -OutFile $cachedModelPath -MinBytes 400MB -Label "Whisper model" | Out-Null
    Copy-Item -LiteralPath $cachedModelPath -Destination $modelPath -Force
  }

  Assert-DownloadedFile -Path $modelPath -MinBytes 400MB -Label "Whisper model" | Out-Null

  try {
    Invoke-LocalAsrValidation -WhisperPath $installedWhisper.FullName -FfmpegPath $installedFfmpeg.FullName -ModelPath $modelPath
  } catch {
    Write-Host "Current whisper.cpp failed real inference validation; reinstalling once."
    Write-Host ($_.Exception.Message)
    $whisperZip = Join-Path $CacheRoot "whisper.zip"
    Install-ZipPackage `
      -Urls (Get-EnabledAssetUrls -PrimaryUrls $WhisperWindowsTencentUrls -FallbackUrls $WhisperWindowsFallbackUrls) `
      -ZipPath $whisperZip `
      -StageDir $WhisperStageDir `
      -MinBytes 1MB `
      -ExpectedFiles @("whisper-cli.exe", "main.exe") `
      -Label "whisper.cpp" | Out-Null
    if (Test-Path -LiteralPath $WhisperDir) {
      Remove-Item -LiteralPath $WhisperDir -Recurse -Force
    }
    $installedWhisper = Install-ExtractedPackage -StageDir $WhisperStageDir -DestinationDir $WhisperDir -ExpectedFiles @("whisper-cli.exe", "main.exe") -Label "whisper.cpp"
    try {
      Assert-ExecutableRuns -Path $installedWhisper.FullName -Arguments @("--help") -Label "whisper.cpp" -TryInstallVcRuntime | Out-Null
      Assert-LocalAsrInference -WhisperPath $installedWhisper.FullName -FfmpegPath $installedFfmpeg.FullName -ModelPath $modelPath
    } catch {
      if (-not (Test-IllegalInstructionExitCode -Value ($_ | Out-String))) {
        throw
      }
      $installedWhisper = Install-WhisperCompatibilityPackage -DestinationDir $WhisperDir -StageDir (Join-Path $TempRoot "whisper-compat")
      Assert-LocalAsrInference -WhisperPath $installedWhisper.FullName -FfmpegPath $installedFfmpeg.FullName -ModelPath $modelPath
    }
    Write-InstallState -WhisperPath $installedWhisper.FullName -FfmpegPath $installedFfmpeg.FullName -ModelPath $modelPath
  }
  Remove-Item -LiteralPath $cachedModelPath -Force -ErrorAction SilentlyContinue

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

$ChunkSeconds = 120
$ChunkRetrySeconds = 30
$OutputBase = if ($OutputPath.ToLowerInvariant().EndsWith(".txt")) {
  $OutputPath.Substring(0, $OutputPath.Length - 4)
} else {
  $OutputPath
}
$RunLog = Join-Path $Root "transcribe-last.log"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$TranscriptQualityGuardVersion = "repeat-guard-v2"
@(
  "time=$(Get-Date -Format o)"
  "status=pending"
  "inputPath=$InputPath"
  "outputPath=$OutputPath"
  "chunkSeconds=$ChunkSeconds"
  "chunkRetrySeconds=$ChunkRetrySeconds"
  "progressStage=preparing"
  "progressCurrent=0"
  "progressTotal=0"
  "progressPercent=0"
  "recoveryTriggered=0"
) | Set-Content -LiteralPath $RunLog -Encoding UTF8

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

function Convert-ExitCodeToHex {
  param([Parameter(Mandatory = $true)][int]$ExitCode)
  $signed = [int64]$ExitCode
  if ($signed -lt 0) {
    $signed = 4294967296 + $signed
  }
  return "0x{0:X8}" -f $signed
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

function Test-WhisperNativeCrashExitCode {
  param([int]$ExitCode)
  $hex = Convert-ExitCodeToHex -ExitCode $ExitCode
  return ($ExitCode -eq -1073740791 -or $hex -eq "0xC0000409")
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

function Write-ProgressLog {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][int]$Current,
    [Parameter(Mandatory = $true)][int]$Total
  )
  $percent = 0
  if ($Total -gt 0) {
    $percent = [Math]::Floor(($Current * 100) / $Total)
  }
  Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value @(
    "progressStage=$Stage"
    "progressCurrent=$Current"
    "progressTotal=$Total"
    "progressPercent=$percent"
  )
}

function Get-TranscriptPreview {
  param([AllowNull()][string]$Text)
  $value = [string]$Text
  if ($value.Length -le 160) {
    return $value
  }
  return $value.Substring(0, 160)
}

function Test-TranscriptHasRepeatHallucination {
  param([AllowNull()][string]$Text)
  $source = [string]$Text
  if (-not $source.Trim()) {
    return $false
  }
  $lines = $source -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  if ($lines.Count -lt 3) {
    return $false
  }
  $current = $null
  $repeatCount = 0
  foreach ($line in $lines) {
    if ($line -eq $current) {
      $repeatCount += 1
      if ($repeatCount -ge 2 -and $line.Length -ge 6) {
        return $true
      }
      continue
    }
    $current = $line
    $repeatCount = 0
  }
  $joined = ($lines -join "")
  if (-not $joined) {
    return $false
  }
  $unique = @{}
  foreach ($line in $lines) {
    if (-not $unique.ContainsKey($line)) {
      $unique[$line] = 0
    }
    $unique[$line] += 1
    if ($line.Length -ge 6 -and $unique[$line] -ge 6) {
      return $true
    }
  }
  return $false
}

function Invoke-WhisperChunk {
  param(
    [Parameter(Mandatory = $true)][string]$ChunkPath,
    [Parameter(Mandatory = $true)][string]$ChunkBase,
    [Parameter(Mandatory = $true)][scriptblock]$PathForNative,
    [string[]]$ExtraArguments = @()
  )
  $arguments = @(
    "-m", (& $PathForNative $attemptModelPath),
    "-f", (& $PathForNative $ChunkPath),
    "-l", "zh"
  ) + $ExtraArguments + @(
    "-otxt",
    "-of", (& $PathForNative $ChunkBase)
  )
  return Invoke-NativeProcess -FilePath $Whisper.FullName -Arguments $arguments
}

function Split-AudioToChunks {
  param(
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [Parameter(Mandatory = $true)][int]$SegmentSeconds,
    [Parameter(Mandatory = $true)][scriptblock]$PathForNative
  )
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  $pattern = Join-Path $OutputDir "chunk-%03d.wav"
  $result = Invoke-NativeProcess -FilePath $Ffmpeg.FullName -Arguments @(
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", (& $PathForNative $AudioPath),
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-f", "segment",
    "-segment_time", [string]$SegmentSeconds,
    "-reset_timestamps", "1",
    $pattern
  )
  $chunks = @(Get-ChildItem -LiteralPath $OutputDir -Filter "chunk-*.wav" | Sort-Object Name)
  return [PSCustomObject]@{
    FfmpegResult = $result
    ChunkFiles = $chunks
    ChunkPattern = $pattern
  }
}

function Invoke-RecoverRepeatedChunkText {
  param(
    [Parameter(Mandatory = $true)][string]$ChunkPath,
    [Parameter(Mandatory = $true)][scriptblock]$PathForNative
  )
  $recoverDir = Join-Path (Split-Path -Parent $ChunkPath) ([System.IO.Path]::GetFileNameWithoutExtension($ChunkPath) + "-retry")
  if (Test-Path -LiteralPath $recoverDir) {
    Remove-Item -LiteralPath $recoverDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  $split = Split-AudioToChunks -AudioPath $ChunkPath -OutputDir $recoverDir -SegmentSeconds $ChunkRetrySeconds -PathForNative $PathForNative
  $logs = New-Object System.Collections.Generic.List[string]
  $texts = New-Object System.Collections.Generic.List[string]
  $exitCode = $split.FfmpegResult.ExitCode
  $logs.Add("--- recovery ffmpeg exit=$exitCode ---")
  $logs.Add($split.FfmpegResult.Output)
  if ($exitCode -ne 0) {
    return [PSCustomObject]@{
      ExitCode = $exitCode
      Logs = ($logs -join [Environment]::NewLine)
      Text = ""
    }
  }
  foreach ($recoverChunk in $split.ChunkFiles) {
    $recoverBase = [System.IO.Path]::Combine($recoverDir, [System.IO.Path]::GetFileNameWithoutExtension($recoverChunk.Name))
    $recoverTxt = "$recoverBase.txt"
    $recoverResult = Invoke-WhisperChunk -ChunkPath $recoverChunk.FullName -ChunkBase $recoverBase -PathForNative $PathForNative -ExtraArguments @("-mc", "0", "-ml", "80", "-sow", "-bo", "1", "-bs", "1", "-tp", "0", "-nf", "-sns")
    $logs.Add("--- recovery $($recoverChunk.Name) exit=$($recoverResult.ExitCode) ---")
    $logs.Add($recoverResult.Output)
    if ($recoverResult.ExitCode -ne 0) {
      return [PSCustomObject]@{
        ExitCode = $recoverResult.ExitCode
        Logs = ($logs -join [Environment]::NewLine)
        Text = ""
      }
    }
    if (Test-Path -LiteralPath $recoverTxt) {
      $recoverText = ([System.IO.File]::ReadAllText($recoverTxt, $Utf8NoBom)).Trim()
      if ($recoverText) {
        $texts.Add((ConvertTo-SimplifiedChinese $recoverText))
      }
    }
  }
  return [PSCustomObject]@{
    ExitCode = 0
    Logs = ($logs -join [Environment]::NewLine)
    Text = (ConvertTo-SimplifiedChinese ($texts -join "`n"))
  }
}

function Invoke-TranscribeAttempt {
  param(
    [Parameter(Mandatory = $true)][ValidateSet("normal", "safe")][string]$Mode
  )
  $safeTempRoot = $null
  $tempWorkDir = $null
  $attemptInputPath = $InputPath
  $attemptModelPath = $Model
  if ($Mode -eq "safe") {
    $safeTempRoot = New-SafeTempDirectory
    $tempWorkDir = Join-Path $safeTempRoot "chunks"
    $attemptInputPath = Join-Path $safeTempRoot ("input" + [System.IO.Path]::GetExtension($InputPath))
    $attemptModelPath = Join-Path $safeTempRoot "ggml-small.bin"
    Copy-Item -LiteralPath $InputPath -Destination $attemptInputPath -Force
    Copy-Item -LiteralPath $Model -Destination $attemptModelPath -Force
  } else {
    $tempWorkDir = Join-Path $env:TEMP ("wechat-inbox-local-asr-" + [guid]::NewGuid().ToString("N"))
  }
  $pathForNative = {
    param([string]$PathValue)
    if ($Mode -eq "safe") {
      return Get-ShortPath $PathValue
    }
    return $PathValue
  }

  $result = [PSCustomObject]@{
    Mode = $Mode
    TempWorkDir = $tempWorkDir
    InputPath = $attemptInputPath
    ModelPath = $attemptModelPath
    FfmpegOutput = ""
    FfmpegExit = 0
    ChunkCount = 0
    WhisperLogs = ""
    WhisperExit = 0
    Text = ""
    Error = ""
  }

  try {
  New-Item -ItemType Directory -Force -Path $TempWorkDir | Out-Null
  $split = Split-AudioToChunks -AudioPath $attemptInputPath -OutputDir $tempWorkDir -SegmentSeconds $ChunkSeconds -PathForNative $pathForNative
  $ffmpegOutput = $split.FfmpegResult.Output
  $ffmpegExit = $split.FfmpegResult.ExitCode
  $chunkFiles = @($split.ChunkFiles)
  $result.ChunkCount = $chunkFiles.Count
  Write-ProgressLog -Stage "transcribing" -Current 0 -Total $chunkFiles.Count
  $whisperLogs = New-Object System.Collections.Generic.List[string]
  $mergedText = New-Object System.Collections.Generic.List[string]
  $whisperExit = 0
  $chunkIndex = 0
  $recoveryTriggered = 0

  if ($ffmpegExit -eq 0 -and $chunkFiles.Count -eq 0) {
    throw "ffmpeg did not generate audio chunks."
  }

  foreach ($chunk in $chunkFiles) {
    $chunkBase = [System.IO.Path]::Combine($tempWorkDir, [System.IO.Path]::GetFileNameWithoutExtension($chunk.Name))
    $chunkTxt = "$chunkBase.txt"
    $chunkResult = Invoke-WhisperChunk -ChunkPath $chunk.FullName -ChunkBase $chunkBase -PathForNative $pathForNative
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
        $normalizedText = ConvertTo-SimplifiedChinese $text
        if (Test-TranscriptHasRepeatHallucination $normalizedText) {
          $recoveryTriggered = 1
          $whisperLogs.Add("--- $($chunk.Name) repeat-detected preview ---")
          $whisperLogs.Add((Get-TranscriptPreview $normalizedText))
          $recovered = Invoke-RecoverRepeatedChunkText -ChunkPath $chunk.FullName -PathForNative $pathForNative
          $whisperLogs.Add($recovered.Logs)
          if ($recovered.ExitCode -eq 0 -and $recovered.Text.Trim() -and -not (Test-TranscriptHasRepeatHallucination $recovered.Text)) {
            $normalizedText = $recovered.Text
          } else {
            throw "TRANSCRIPT_HALLUCINATION: repeated transcript remained after local retry for $($chunk.Name)."
          }
        }
        $mergedText.Add($normalizedText)
      }
    }
    $chunkIndex += 1
    Write-ProgressLog -Stage "transcribing" -Current $chunkIndex -Total $chunkFiles.Count
  }

    $result.FfmpegOutput = $ffmpegOutput
    $result.FfmpegExit = $ffmpegExit
    $result.WhisperLogs = ($whisperLogs -join [Environment]::NewLine)
    $result.WhisperExit = $whisperExit
    $result.Text = ConvertTo-SimplifiedChinese ($mergedText -join "`n`n")
    $result | Add-Member -NotePropertyName RecoveryTriggered -NotePropertyValue $recoveryTriggered -Force
    return $result
  } catch {
    $result.FfmpegOutput = $ffmpegOutput
    $result.FfmpegExit = $ffmpegExit
    $result.WhisperLogs = ($whisperLogs -join [Environment]::NewLine)
    $result.WhisperExit = $whisperExit
    $result.Error = ($_ | Out-String)
    $result | Add-Member -NotePropertyName RecoveryTriggered -NotePropertyValue 0 -Force
    return $result
  } finally {
    if ($safeTempRoot -and (Test-Path -LiteralPath $safeTempRoot)) {
      Remove-Item -LiteralPath $safeTempRoot -Recurse -Force
    } elseif ($tempWorkDir -and (Test-Path -LiteralPath $tempWorkDir)) {
      Remove-Item -LiteralPath $tempWorkDir -Recurse -Force
    }
  }
}

function Write-AttemptLog {
  param(
    [Parameter(Mandatory = $true)]$Attempt,
    [AllowNull()]$FallbackAttempt
  )
  $lines = @(
    "time=$(Get-Date -Format o)"
    "status=running"
    "inputPath=$InputPath"
    "outputPath=$OutputPath"
    "mode=$($Attempt.Mode)"
    "tempWorkDir=$($Attempt.TempWorkDir)"
    "chunkSeconds=$ChunkSeconds"
    "chunkRetrySeconds=$ChunkRetrySeconds"
    "chunkCount=$($Attempt.ChunkCount)"
    "recoveryTriggered=$($Attempt.RecoveryTriggered)"
    "ffmpeg=$($Ffmpeg.FullName)"
    "ffmpegExit=$($Attempt.FfmpegExit)"
    "--- ffmpeg output ---"
    $Attempt.FfmpegOutput
    "whisper=$($Whisper.FullName)"
    "whisperExit=$($Attempt.WhisperExit)"
    "--- whisper output ---"
    $Attempt.WhisperLogs
  )
  if ($FallbackAttempt) {
    $lines += @(
      "--- fallback attempt ---"
      "mode=$($FallbackAttempt.Mode)"
      "tempWorkDir=$($FallbackAttempt.TempWorkDir)"
      "safeInputPath=$($FallbackAttempt.InputPath)"
      "safeModelPath=$($FallbackAttempt.ModelPath)"
      "chunkCount=$($FallbackAttempt.ChunkCount)"
      "ffmpegExit=$($FallbackAttempt.FfmpegExit)"
      "--- fallback ffmpeg output ---"
      $FallbackAttempt.FfmpegOutput
      "whisperExit=$($FallbackAttempt.WhisperExit)"
      "--- fallback whisper output ---"
      $FallbackAttempt.WhisperLogs
      "--- fallback error ---"
      $FallbackAttempt.Error
    )
  }
  $lines | Set-Content -LiteralPath $RunLog -Encoding UTF8
}

try {
  $normalAttempt = Invoke-TranscribeAttempt -Mode "normal"
  $finalAttempt = $normalAttempt
  $fallbackAttempt = $null
  if ($normalAttempt.FfmpegExit -eq 0 -and (Test-WhisperNativeCrashExitCode $normalAttempt.WhisperExit)) {
    $fallbackAttempt = Invoke-TranscribeAttempt -Mode "safe"
    if ($fallbackAttempt.FfmpegExit -eq 0 -and $fallbackAttempt.WhisperExit -eq 0 -and $fallbackAttempt.Text.Trim()) {
      $finalAttempt = $fallbackAttempt
    }
  }
  Write-AttemptLog -Attempt $normalAttempt -FallbackAttempt $fallbackAttempt

  if ($finalAttempt.Error -and $finalAttempt.Error -match "TRANSCRIPT_HALLUCINATION") {
    throw $finalAttempt.Error
  }
  if ($finalAttempt.FfmpegExit -ne 0) {
    throw "ffmpeg failed with exit code $($finalAttempt.FfmpegExit). See $RunLog"
  }
  if ($finalAttempt.WhisperExit -ne 0) {
    throw "whisper failed with exit code $($finalAttempt.WhisperExit). See $RunLog"
  }
  if (-not $finalAttempt.Text.Trim()) {
    throw "Whisper did not generate transcript text. See $RunLog"
  }

  $finalText = ConvertTo-SimplifiedChinese $finalAttempt.Text
  [System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)
  Write-ProgressLog -Stage "done" -Current $finalAttempt.ChunkCount -Total $finalAttempt.ChunkCount
  Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value "status=success"
  [System.IO.File]::ReadAllText($OutputPath, $Utf8NoBom)
} catch {
  Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value @(
    "status=failed"
    "--- error ---"
    ($_ | Out-String)
  )
  throw
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
  Write-Host "powershell -NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\transcribe.ps1`" -InputPath {input} -OutputPath {output}"
} catch {
  Write-Host ""
  Write-Host "INSTALLER FAILED"
  Write-Host ($_ | Out-String)
  throw
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    Remove-Item -LiteralPath $TempRoot -Recurse -Force
  }
  Release-InstallLock -Mutex $installMutex
}
