param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE ".wechat-inbox-local-asr")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$TempRoot = Join-Path $env:TEMP ("wechat-inbox-local-asr-install-" + [guid]::NewGuid().ToString("N"))
$CacheRoot = Join-Path $InstallRoot "cache"
$InstallStatePath = Join-Path $InstallRoot ".install-state.json"
$InstallerScriptVersion = "1.2.33"
$DownloadResumeVersion = "asr-resume-v1"
$script:DownloadEvents = @()
$script:AuthorizedDownloadAssets = @()
if ($env:WECHAT_INBOX_ASR_DOWNLOAD_ASSETS) {
  $script:AuthorizedDownloadAssets = ConvertFrom-Json -InputObject $env:WECHAT_INBOX_ASR_DOWNLOAD_ASSETS
}
$NativeProcessRunnerVersion = "diagnostics-process-v2"
$DownloadLowSpeedLimitBytesPerSecond = 65536
$DownloadLowSpeedTimeoutSeconds = 30
$DownloadTimeoutSeconds = 1200
$InstallLockPath = Join-Path $InstallRoot ".install.lock"
$InstallMutexName = "Global\WechatInboxLocalAsrInstall"
$Headers = @{ "User-Agent" = "wechat-inbox-sync-local-asr-installer" }
$PublicCloudBaseCdnDisabled = $env:WECHAT_INBOX_DISABLE_PUBLIC_CLOUDBASE_CDN -eq "1"
$WhisperWindowsAuthorizedUrls = @($env:WECHAT_INBOX_ASR_WHISPER_URL) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$WhisperWindowsCompatibilityUrls = @($env:WECHAT_INBOX_ASR_WHISPER_COMPAT_URL) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$WhisperWindowsCompatibilitySha256 = '7B562DEEF031BD8A1A3954E3F5FF43BE0ACE2E86974235518530594BEECFF4B7'
$FfmpegAuthorizedUrls = @($env:WECHAT_INBOX_ASR_FFMPEG_URL) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
$ModelAuthorizedUrls = @($env:WECHAT_INBOX_ASR_MODEL_URL) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
# "small" mis-hears Chinese dialects, names and crosstalk badly. The turbo
# large-v3 quantization is about twelve times the compute and roughly three
# times slower than real time on a desktop CPU, which is the right trade for
# a transcript that is then read instead of listened to.
$WhisperModelFileName = "ggml-large-v3-turbo-q5_0.bin"
$WhisperModelMinBytes = 500MB
$LegacyWhisperModelFileName = "ggml-small.bin"
$ModelFallbackUrls = @(
  "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/$WhisperModelFileName"
)
$ModelOfficialFallbackUrls = @(
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$WhisperModelFileName"
)
$WhisperWindowsFallbackUrls = @(
  "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.0/whisper-bin-x64.zip"
)

# Speaker diarization (optional, best-effort): pure-CPU sherpa-onnx runtime with
# the pyannote segmentation-3.0 model plus a 3D-Speaker CAM++ embedding model.
# The wheels are ordinary zip archives, so Expand-Archive can unpack them.
$DiarizationEngineVersion = "1.13.8"
$DiarizationBinUrls = @(
  "https://files.pythonhosted.org/packages/38/b9/ad8cd468f0adb37f2701c5067d5b19b141bf815c6434a8749b02d688f3b9/sherpa_onnx_bin-1.13.8-py3-none-win_amd64.whl",
  "https://pypi.tuna.tsinghua.edu.cn/packages/38/b9/ad8cd468f0adb37f2701c5067d5b19b141bf815c6434a8749b02d688f3b9/sherpa_onnx_bin-1.13.8-py3-none-win_amd64.whl"
)
$DiarizationBinSha256 = "9549D3C1A9EC325FB7315006407FFDE5BDEEE99F3625C03D0B7967009E869A9A"
$DiarizationCoreUrls = @(
  "https://files.pythonhosted.org/packages/94/38/64356ad97f68fffcf01fe7545407ad18a2ea86c1ffae5b0950f7fac73638/sherpa_onnx_core-1.13.8-py3-none-win_amd64.whl",
  "https://pypi.tuna.tsinghua.edu.cn/packages/94/38/64356ad97f68fffcf01fe7545407ad18a2ea86c1ffae5b0950f7fac73638/sherpa_onnx_core-1.13.8-py3-none-win_amd64.whl"
)
$DiarizationCoreSha256 = "5579E80196D516E6DAE23C8F629292CE3142AB8869925D32B94612FD86F93733"
$DiarizationSegmentationUrls = @(
  "https://hf-mirror.com/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx",
  "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx"
)
$DiarizationSegmentationSha256 = "220AD67CA923BEF2FA91F2390C786097BF305BCEB5E261D4AF67B38E938E1079"
$DiarizationEmbeddingUrls = @(
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
)
$DiarizationEmbeddingSha256 = "AA3CFC16963A10586A9393F5035D6D6B57E98D358B347F80C2A30BF4F00CEBA2"

# Chinese punctuation restoration (optional, best-effort). whisper.cpp emits no
# punctuation for Mandarin, so transcripts are punctuated afterwards by the
# same sherpa-onnx runtime the diarization stage already installs. Only the
# model file is an extra download; the runtime DLLs come from that stage.
$PunctuationModelUrls = @(
  "https://hf-mirror.com/csukuangfj/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12/resolve/main/model.onnx",
  "https://huggingface.co/csukuangfj/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12/resolve/main/model.onnx"
)
$PunctuationModelSha256 = "E93593A6DBD69A07F8734EF269DBE861A379755F8D1C8354719432116F2C44BD"
$PunctuationModelMinBytes = 250MB
$PunctuationModelFileName = "punct-ct-transformer-zh-en.onnx"
# The punctuation CLI shipped with sherpa-onnx only accepts text on its command
# line, and Windows PowerShell hands native programs ANSI bytes, so Chinese text
# would arrive as mojibake. This shim calls the runtime's C API directly with
# UTF-8 buffers instead. It is generated into the install directory so the
# transcription script can load it with Add-Type -Path.
$PunctuationShimSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WechatInboxSherpaPunctuation
{
  [StructLayout(LayoutKind.Sequential)]
  private struct ModelConfig
  {
    public IntPtr ct_transformer;
    public int num_threads;
    public int debug;
    public IntPtr provider;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct Config
  {
    public ModelConfig model;
  }

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool SetDllDirectoryW(string path);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern IntPtr LoadLibraryExW(string path, IntPtr hFile, uint flags);

  [DllImport("sherpa-onnx-c-api.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern IntPtr SherpaOnnxCreateOfflinePunctuation(ref Config config);

  [DllImport("sherpa-onnx-c-api.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern void SherpaOnnxDestroyOfflinePunctuation(IntPtr handle);

  [DllImport("sherpa-onnx-c-api.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern IntPtr SherpaOfflinePunctuationAddPunct(IntPtr handle, IntPtr text);

  [DllImport("sherpa-onnx-c-api.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern void SherpaOfflinePunctuationFreeText(IntPtr text);

  private static IntPtr Utf8ToPtr(string value)
  {
    byte[] bytes = Encoding.UTF8.GetBytes(value);
    IntPtr pointer = Marshal.AllocHGlobal(bytes.Length + 1);
    Marshal.Copy(bytes, 0, pointer, bytes.Length);
    Marshal.WriteByte(pointer, bytes.Length, 0);
    return pointer;
  }

  private static string PtrToUtf8(IntPtr pointer)
  {
    if (pointer == IntPtr.Zero)
    {
      return string.Empty;
    }
    int length = 0;
    while (Marshal.ReadByte(pointer, length) != 0)
    {
      length += 1;
    }
    byte[] bytes = new byte[length];
    Marshal.Copy(pointer, bytes, 0, length);
    return Encoding.UTF8.GetString(bytes);
  }

  public static bool Preload(string runtimeDir)
  {
    string directory = runtimeDir.TrimEnd('\\');
    SetDllDirectoryW(directory);
    IntPtr dependency = LoadLibraryExW(directory + "\\onnxruntime.dll", IntPtr.Zero, 8);
    if (dependency == IntPtr.Zero)
    {
      return false;
    }
    IntPtr runtime = LoadLibraryExW(directory + "\\sherpa-onnx-c-api.dll", IntPtr.Zero, 8);
    return runtime != IntPtr.Zero;
  }

  public static IntPtr Create(string modelPath, int threads)
  {
    Config config = new Config();
    IntPtr modelPointer = Utf8ToPtr(modelPath);
    IntPtr providerPointer = Utf8ToPtr("cpu");
    config.model.ct_transformer = modelPointer;
    config.model.num_threads = threads;
    config.model.debug = 0;
    config.model.provider = providerPointer;
    IntPtr handle = SherpaOnnxCreateOfflinePunctuation(ref config);
    Marshal.FreeHGlobal(modelPointer);
    Marshal.FreeHGlobal(providerPointer);
    return handle;
  }

  public static void Destroy(IntPtr handle)
  {
    if (handle != IntPtr.Zero)
    {
      SherpaOnnxDestroyOfflinePunctuation(handle);
    }
  }

  public static string AddPunctuation(IntPtr handle, string text)
  {
    IntPtr textPointer = Utf8ToPtr(text);
    IntPtr resultPointer = SherpaOfflinePunctuationAddPunct(handle, textPointer);
    Marshal.FreeHGlobal(textPointer);
    if (resultPointer == IntPtr.Zero)
    {
      return string.Empty;
    }
    string punctuated = PtrToUtf8(resultPointer);
    SherpaOfflinePunctuationFreeText(resultPointer);
    return punctuated;
  }
}
'@

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

function Complete-InstallerCleanup {
  param([string]$TemporaryRoot, [AllowNull()]$Mutex)
  try {
    $resolvedRoot = [IO.Path]::GetFullPath($TemporaryRoot)
    $expectedParent = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($resolvedRoot).TrimEnd('\') -ine $expectedParent -or
        [IO.Path]::GetFileName($resolvedRoot) -notmatch '^wechat-inbox-local-asr-install-[a-f0-9]{32}$') {
      throw 'Cleanup path is outside the owned installer temporary directory'
    }
    if (Test-Path -LiteralPath $resolvedRoot) {
      $item = Get-Item -LiteralPath $resolvedRoot -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cleanup directory is a reparse point' }
      for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { Remove-Item -LiteralPath $resolvedRoot -Recurse -Force -ErrorAction Stop; break }
        catch { if ($attempt -eq 3) { throw }; Start-Sleep -Milliseconds 150 }
      }
    }
  } catch {
    Write-Warning -WarningAction Continue ("INSTALLER_CLEANUP_WARNING stage=temporary-directory path={0} reason={1}" -f $TemporaryRoot, $_.Exception.Message)
  } finally {
    try { Release-InstallLock -Mutex $Mutex }
    catch { Write-Warning -WarningAction Continue ("INSTALLER_CLEANUP_WARNING stage=release-lock reason={0}" -f $_.Exception.Message) }
  }
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
    throw "$Label cache package is locked or unreadable; cached bytes were preserved. Close other installers before retrying."
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
  Download-File -Url $Url -OutFile $CachePath -Resume
  return $CachePath
}

function Get-DownloadSpec {
  param([string]$Url)
  $uri = [Uri]$Url
  $resource = $uri.GetLeftPart([UriPartial]::Path)
  $spec = @($script:AuthorizedDownloadAssets | Where-Object { $_.url -eq $resource }) | Select-Object -First 1
  if ($spec) {
    if ($spec.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or [Int64]$spec.byteLength -le 0) { throw 'Invalid authorized download metadata' }
    return $spec
  }
  $authorizedUrls = @($WhisperWindowsAuthorizedUrls) + @($WhisperWindowsCompatibilityUrls) + @($FfmpegAuthorizedUrls) + @($ModelAuthorizedUrls)
  if ($authorizedUrls -contains $Url) { throw 'Authorized ASR asset metadata missing' }
  return $null
}

function Write-DownloadStatus {
  param([string]$Url, [string]$Stage, [Int64]$Bytes = 0, [int]$Attempt = 0, [int]$CurlCode = 0, [double]$Seconds = 0)
  try {
    $uri = [Uri]$Url
    $spec = Get-DownloadSpec -Url $Url
    $name = [IO.Path]::GetFileName($uri.AbsolutePath)
    if ($name -notmatch '^[a-zA-Z0-9._+-]{1,160}$') { $name = 'asset' }
    $entry = [ordered]@{ time = [DateTime]::UtcNow.ToString('o'); stage = $Stage; file = $name; host = $uri.DnsSafeHost; bytes = $Bytes; expectedBytes = $(if ($spec) { [Int64]$spec.byteLength } else { 0 }); attempt = $Attempt; curlCode = $CurlCode; seconds = [Math]::Round($Seconds, 3) }
    $script:DownloadEvents = @($script:DownloadEvents + [pscustomobject]$entry | Select-Object -Last 24)
    $statusPath = Join-Path $InstallRoot 'download-status.json'
    $json = ConvertTo-Json -InputObject @($script:DownloadEvents) -Depth 3 -Compress
    [IO.File]::WriteAllText($statusPath, $json, (New-Object Text.UTF8Encoding($false)))
    Write-Host ("Download {0}: {1}, {2} bytes, attempt {3}" -f $Stage, $name, $Bytes, $Attempt)
  } catch { Write-Host 'Download diagnostic unavailable' }
}

function Preserve-UnverifiedDownload {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    Move-Item -LiteralPath $Path -Destination ($Path + '.unverified-' + [Guid]::NewGuid().ToString('N'))
  }
}

function Get-FileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $hasher = $null
  try {
    $hasher = [Security.Cryptography.SHA256]::Create()
    return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToUpperInvariant()
  } finally {
    if ($hasher) { $hasher.Dispose() }
    $stream.Dispose()
  }
}

function Test-DownloadComplete {
  param([string]$Path, $Spec)
  if (-not $Spec -or -not (Test-Path -LiteralPath $Path)) { return $false }
  if ((Get-Item -LiteralPath $Path).Length -ne [Int64]$Spec.byteLength) { return $false }
  return (Get-FileSha256 -Path $Path) -eq $Spec.sha256
}

function Download-File {
  param([Parameter(Mandatory = $true)][string]$Url, [Parameter(Mandatory = $true)][string]$OutFile, [switch]$Resume)
  $outDir = Split-Path -Parent $OutFile
  if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
  $spec = Get-DownloadSpec -Url $Url
  $identityText = if ($spec) { 'sha256:' + $spec.sha256.ToLowerInvariant() } else { $Url }
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $identity = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($identityText))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
  $metaPath = $OutFile + '.download.json'
  $previousIdentity = ''
  try { $previousIdentity = (Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json).identity } catch {}
  if (Test-DownloadComplete -Path $OutFile -Spec $spec) {
    Write-DownloadStatus -Url $Url -Stage 'cached' -Bytes ([Int64]$spec.byteLength)
    return
  }
  if (Test-Path -LiteralPath $OutFile) {
    $length = (Get-Item -LiteralPath $OutFile).Length
    if ($previousIdentity -ne $identity -or ($spec -and $length -ge [Int64]$spec.byteLength)) {
      Preserve-UnverifiedDownload -Path $OutFile
    }
  }
  [IO.File]::WriteAllText($metaPath, (ConvertTo-Json -Compress -InputObject @{ identity = $identity }), (New-Object Text.UTF8Encoding($false)))
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { throw 'curl.exe is required for resumable Windows ASR downloads; cached progress was preserved.' }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $offset = if (Test-Path -LiteralPath $OutFile) { (Get-Item -LiteralPath $OutFile).Length } else { 0 }
    Write-DownloadStatus -Url $Url -Stage 'downloading' -Bytes $offset -Attempt $attempt
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $sizeArgs = @()
    if ($spec) { $sizeArgs = @('--max-filesize', [string]$spec.byteLength) }
    & $curl.Source @sizeArgs -L --fail --silent --show-error --retry 0 --connect-timeout 30 --speed-limit $DownloadLowSpeedLimitBytesPerSecond --speed-time $DownloadLowSpeedTimeoutSeconds --max-time $DownloadTimeoutSeconds -C - -o $OutFile $Url
    $exitCode = $LASTEXITCODE
    $bytes = if (Test-Path -LiteralPath $OutFile) { (Get-Item -LiteralPath $OutFile).Length } else { 0 }
    if ($exitCode -eq 0) {
      if ($spec -and -not (Test-DownloadComplete -Path $OutFile -Spec $spec)) {
        Write-DownloadStatus -Url $Url -Stage 'integrity-failed' -Bytes $bytes -Attempt $attempt -Seconds $timer.Elapsed.TotalSeconds
        Preserve-UnverifiedDownload -Path $OutFile
        throw 'Authorized ASR download size or SHA256 mismatch; package was not installed.'
      }
      Write-DownloadStatus -Url $Url -Stage 'complete' -Bytes $bytes -Attempt $attempt -Seconds $timer.Elapsed.TotalSeconds
      return
    }
    # A transfer can deliver all bytes and still report a connection close error.
    if (Test-DownloadComplete -Path $OutFile -Spec $spec) {
      Write-DownloadStatus -Url $Url -Stage 'complete' -Bytes $bytes -Attempt $attempt -CurlCode $exitCode -Seconds $timer.Elapsed.TotalSeconds
      return
    }
    Write-DownloadStatus -Url $Url -Stage 'interrupted' -Bytes $bytes -Attempt $attempt -CurlCode $exitCode -Seconds $timer.Elapsed.TotalSeconds
    if ($exitCode -notin @(5, 6, 7, 18, 28, 35, 52, 55, 56, 92) -or $attempt -eq 3) {
      throw "ASR download interrupted (curl $exitCode); downloaded bytes preserved. Retry installation to resume."
    }
    Start-Sleep -Seconds 1
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
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$ReportProgress,
    [string]$ProgressStage = "transcribing",
    [int]$ProgressCurrent = 0,
    [int]$ProgressTotal = 0
  )
  $process = $null
  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join " ")
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
      throw "Native process did not start: $FilePath"
    }
    $null = $process.Handle
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    while (-not $process.WaitForExit(5000)) {
      if ($ReportProgress) {
        Write-ProgressLog -Stage $ProgressStage -Current $ProgressCurrent -Total $ProgressTotal -ProcessId $process.Id
      }
    }
    $process.WaitForExit()
    $stdoutText = [string]$stdoutTask.GetAwaiter().GetResult()
    $stderrText = [string]$stderrTask.GetAwaiter().GetResult()
    $exitCode = [int]$process.ExitCode
  } finally {
    if ($process) {
      $process.Dispose()
    }
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
  $actualSha256 = Get-FileSha256 -Path $Path
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
    $safeModelPath = Join-Path $validationDir $WhisperModelFileName
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
  if ($enabledPrimaryUrls.Count -gt 0) { return @($enabledPrimaryUrls) }
  return @($FallbackUrls)
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
      Download-File -Url $url -OutFile $cacheFile -Resume
      $extractZipPath = Prepare-ZipForExtraction -ZipPath $cacheFile -TempRoot $TempRoot -Label $Label
      Assert-DownloadedFile -Path $extractZipPath -MinBytes $MinBytes -Label $Label | Out-Null
      Expand-Archive -LiteralPath $extractZipPath -DestinationPath $StageDir -Force
      return Assert-InstalledFile -Root $StageDir -Names $ExpectedFiles -Label $Label
    } catch {
      $lastError = $_
      Write-Host "$Label source failed; downloaded bytes were preserved."
      Write-Host ($_.Exception.Message)
      if (Test-Path -LiteralPath $ZipPath) {
        $cachedZip = Get-Item -LiteralPath $ZipPath
        if ($cachedZip.Length -ge $MinBytes) {
          Write-Host "Keeping downloaded $Label bytes for verified retry: $ZipPath"
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
      Download-File -Url $url -OutFile $OutFile -Resume
      Assert-DownloadedFile -Path $OutFile -MinBytes $MinBytes -Label $Label | Out-Null
      return $OutFile
    } catch {
      $lastError = $_
      Write-Host "$Label source failed; downloaded bytes were preserved."
      Write-Host ($_.Exception.Message)
      if (Test-Path -LiteralPath $OutFile) {
        $cachedFile = Get-Item -LiteralPath $OutFile
        if ($cachedFile.Length -ge $MinBytes) {
          Write-Host "Keeping downloaded $Label bytes for verified retry: $OutFile"
        } else {
          Write-Host "Keeping partial $Label package for retry: $OutFile"
        }
      }
    }
  }
  throw $lastError
}

function Install-VerifiedAsset {
  param(
    [Parameter(Mandatory = $true)][string[]]$Urls,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [Parameter(Mandatory = $true)][Int64]$MinBytes,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $expected = $ExpectedSha256.ToUpperInvariant()
  if (Test-Path -LiteralPath $OutFile) {
    if ((Get-FileSha256 -Path $OutFile) -eq $expected) {
      Write-Host "$Label is cached; skipping download."
      return $OutFile
    }
    Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  }
  $lastError = $null
  foreach ($url in $Urls) {
    try {
      Download-File -Url $url -OutFile $OutFile -Resume
      Assert-DownloadedFile -Path $OutFile -MinBytes $MinBytes -Label $Label | Out-Null
      Assert-FileSha256 -Path $OutFile -ExpectedSha256 $expected -Label $Label
      return $OutFile
    } catch {
      $lastError = $_
      Write-Host "$Label source failed: $url"
      Write-Host ($_.Exception.Message)
    }
  }
  throw $lastError
}

function Install-DiarizationPackage {
  param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$TempRoot
  )
  $destinationDir = Join-Path $InstallRoot "diarization"
  $modelDir = Join-Path $destinationDir "models"
  $exePath = Join-Path $destinationDir "sherpa-onnx-offline-speaker-diarization.exe"
  $segmentationPath = Join-Path $modelDir "segmentation-3.0.onnx"
  $embeddingPath = Join-Path $modelDir "campplus-zh-en-16k.onnx"
  if ((Test-Path -LiteralPath $exePath) -and
      (Test-Path -LiteralPath $segmentationPath) -and
      (Test-Path -LiteralPath $embeddingPath)) {
    Assert-ExecutableRuns -Path $exePath -Arguments @("--help") -Label "speaker diarization" -TryInstallVcRuntime | Out-Null
    Write-Host "Existing speaker diarization is usable; skipping download."
    return
  }

  $binZip = Join-Path $CacheRoot ("sherpa-onnx-bin-" + $DiarizationEngineVersion + ".zip")
  $coreZip = Join-Path $CacheRoot ("sherpa-onnx-core-" + $DiarizationEngineVersion + ".zip")
  Install-VerifiedAsset -Urls $DiarizationBinUrls -OutFile $binZip -MinBytes 15MB -ExpectedSha256 $DiarizationBinSha256 -Label "speaker diarization engine" | Out-Null
  Install-VerifiedAsset -Urls $DiarizationCoreUrls -OutFile $coreZip -MinBytes 15MB -ExpectedSha256 $DiarizationCoreSha256 -Label "speaker diarization runtime" | Out-Null

  $stageDir = Join-Path $TempRoot "diarization"
  New-CleanDirectory -Path $stageDir
  $binStage = Join-Path $stageDir "bin"
  $coreStage = Join-Path $stageDir "core"
  New-Item -ItemType Directory -Force -Path $binStage | Out-Null
  New-Item -ItemType Directory -Force -Path $coreStage | Out-Null
  Expand-Archive -LiteralPath $binZip -DestinationPath $binStage -Force
  Expand-Archive -LiteralPath $coreZip -DestinationPath $coreStage -Force

  $sourceExe = Find-InstalledFile -Root $binStage -Names @("sherpa-onnx-offline-speaker-diarization.exe")
  if (-not $sourceExe) {
    throw "speaker diarization engine package is missing the CLI executable."
  }
  $runtimeNames = @("onnxruntime.dll", "sherpa-onnx-c-api.dll", "sherpa-onnx-cxx-api.dll")
  $runtimeFiles = @()
  foreach ($name in $runtimeNames) {
    $file = Find-InstalledFile -Root $coreStage -Names @($name)
    if (-not $file) {
      throw "speaker diarization runtime package is missing $name."
    }
    $runtimeFiles += $file
  }

  $segmentationCache = Join-Path $CacheRoot "sherpa-segmentation-3.0.onnx"
  Install-VerifiedAsset -Urls $DiarizationSegmentationUrls -OutFile $segmentationCache -MinBytes 5MB -ExpectedSha256 $DiarizationSegmentationSha256 -Label "speaker segmentation model" | Out-Null
  $embeddingCache = Join-Path $CacheRoot "sherpa-campplus-zh-en-16k.onnx"
  Install-VerifiedAsset -Urls $DiarizationEmbeddingUrls -OutFile $embeddingCache -MinBytes 25MB -ExpectedSha256 $DiarizationEmbeddingSha256 -Label "speaker embedding model" | Out-Null

  New-CleanDirectory -Path $destinationDir
  New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
  Copy-FileWithRetry -SourcePath $sourceExe.FullName -DestinationPath $exePath | Out-Null
  foreach ($file in $runtimeFiles) {
    Copy-FileWithRetry -SourcePath $file.FullName -DestinationPath (Join-Path $destinationDir $file.Name) | Out-Null
  }
  Copy-FileWithRetry -SourcePath $segmentationCache -DestinationPath $segmentationPath | Out-Null
  Copy-FileWithRetry -SourcePath $embeddingCache -DestinationPath $embeddingPath | Out-Null

  Assert-ExecutableRuns -Path $exePath -Arguments @("--help") -Label "speaker diarization" -TryInstallVcRuntime | Out-Null
  Write-Host "Speaker diarization installed to: $destinationDir"
}

function Install-PunctuationModel {
  param(
    [Parameter(Mandatory = $true)][string]$InstallRoot
  )
  $runtimeDir = Join-Path $InstallRoot "diarization"
  $destinationDir = Join-Path $runtimeDir "models"
  $modelPath = Join-Path $destinationDir $PunctuationModelFileName
  $shimPath = Join-Path $runtimeDir "punctuation-shim.cs"
  # The shim is a few kilobytes, so refresh it before any early return: a repair
  # run must be able to restore it without re-downloading the model.
  if ((Test-Path -LiteralPath $runtimeDir) -and (Test-Path -LiteralPath $shimPath)) {
    $existingShim = [System.IO.File]::ReadAllText($shimPath)
    if ($existingShim -ne $PunctuationShimSource) {
      [System.IO.File]::WriteAllText($shimPath, $PunctuationShimSource, (New-Object System.Text.UTF8Encoding($false)))
    }
  } elseif (-not (Test-Path -LiteralPath $runtimeDir)) {
    Write-Host "Punctuation runtime is missing; skipping the Chinese punctuation shim."
    return
  } else {
    [System.IO.File]::WriteAllText($shimPath, $PunctuationShimSource, (New-Object System.Text.UTF8Encoding($false)))
  }
  # Punctuation reuses the diarization runtime; without its DLLs the model file
  # alone cannot do anything, so skip instead of downloading 294 MB for nothing.
  foreach ($name in @("onnxruntime.dll", "sherpa-onnx-c-api.dll")) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir $name))) {
      Write-Host "Punctuation runtime is missing; skipping the Chinese punctuation model."
      return
    }
  }
  if ((Test-Path -LiteralPath $modelPath) -and ((Get-Item -LiteralPath $modelPath).Length -ge $PunctuationModelMinBytes)) {
    Write-Host "Existing Chinese punctuation model is usable; skipping download."
    return
  }
  $cachePath = Join-Path $CacheRoot $PunctuationModelFileName
  Install-VerifiedAsset -Urls $PunctuationModelUrls -OutFile $cachePath -MinBytes $PunctuationModelMinBytes -ExpectedSha256 $PunctuationModelSha256 -Label "Chinese punctuation model" | Out-Null
  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
  Copy-FileWithRetry -SourcePath $cachePath -DestinationPath $modelPath | Out-Null
  Remove-Item -LiteralPath $cachePath -Force -ErrorAction SilentlyContinue
  Write-Host "Chinese punctuation model installed to: $modelPath"
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

function Assert-TranscribeScriptCandidate {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path) -or (Get-Item -LiteralPath $Path).Length -le 0) {
    throw "Cannot prepare transcribe script candidate."
  }

  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile(
    $Path,
    [ref]$tokens,
    [ref]$parseErrors
  ) | Out-Null
  if ($parseErrors -and $parseErrors.Count -gt 0) {
    $parseSummary = ($parseErrors | ForEach-Object { $_.Message }) -join "; "
    throw ("Cannot parse transcribe script candidate: " + $parseSummary)
  }

  $candidateSource = [System.IO.File]::ReadAllText($Path)
  $requiredMarkers = @(
    '$TranscriptQualityGuardVersion = "repeat-guard-v2"',
    '$TranscriptPartialRecoveryVersion = "partial-recovery-v1"',
    '$NativeProcessRunnerVersion = "diagnostics-process-v2"',
    '$SpeakerDiarizationVersion = "speaker-diarization-v1"',
    '$ChinesePunctuationVersion = "chinese-punctuation-v1"',
    'Set-SegmentSpeakers',
    'WechatInboxSherpaPunctuation',
    'Add-UnitPunctuation',
    'Optimize-PunctuationText',
    'PunctuationStatus',
    'Find-SilenceCutPoints',
    'Get-WavDurationSeconds',
    'ChunkStartSeconds',
    '-segment_times',
    'ChunkOffsetMs',
    'System.Diagnostics.ProcessStartInfo',
    'ReadToEndAsync',
    '$null = $process.Handle',
    'progressHeartbeatAt',
    'progressPid',
    '-ProgressStage "segmenting"'
  )
  foreach ($marker in $requiredMarkers) {
    if (-not $candidateSource.Contains($marker)) {
      throw ("Transcribe script candidate is missing required capability: " + $marker)
    }
  }
}

function Start-TranscribeScriptUpdate {
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
  $updateId = [guid]::NewGuid().ToString("N")
  $targetPath = Join-Path $InstallRoot "transcribe.ps1"
  $candidatePath = Join-Path $InstallRoot ("transcribe.ps1.candidate-" + $updateId)
  $backupPath = Join-Path $InstallRoot ("transcribe.ps1.backup-" + $updateId)
  Set-Content -LiteralPath $candidatePath -Value $template -Encoding UTF8
  try {
    Assert-TranscribeScriptCandidate -Path $candidatePath
  } catch {
    Remove-Item -LiteralPath $candidatePath -Force -ErrorAction SilentlyContinue
    throw
  }
  return [pscustomobject]@{
    TargetPath = $targetPath
    CandidatePath = $candidatePath
    BackupPath = $backupPath
    HadOriginal = $false
    Promoted = $false
    Completed = $false
  }
}

function Restore-TranscribeScriptUpdate {
  param($State)
  if (-not $State) {
    return
  }
  if ($State.Completed) {
    return
  }
  if ($State.Promoted -and (Test-Path -LiteralPath $State.TargetPath)) {
    Remove-Item -LiteralPath $State.TargetPath -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $State.BackupPath) {
    Move-Item -LiteralPath $State.BackupPath -Destination $State.TargetPath -Force
  }
  if (Test-Path -LiteralPath $State.CandidatePath) {
    Remove-Item -LiteralPath $State.CandidatePath -Force -ErrorAction SilentlyContinue
  }
}

function Promote-TranscribeScriptUpdate {
  param([Parameter(Mandatory = $true)]$State)
  try {
    if (Test-Path -LiteralPath $State.TargetPath) {
      Move-Item -LiteralPath $State.TargetPath -Destination $State.BackupPath -Force
      $State.HadOriginal = $true
    }
    Move-Item -LiteralPath $State.CandidatePath -Destination $State.TargetPath -Force
    $State.Promoted = $true
  } catch {
    Restore-TranscribeScriptUpdate -State $State
    throw
  }
}

function Complete-TranscribeScriptUpdate {
  param($State)
  if (-not $State) {
    return
  }
  $State.Completed = $true
  if (Test-Path -LiteralPath $State.BackupPath) {
    try {
      Remove-Item -LiteralPath $State.BackupPath -Force -ErrorAction Stop
    } catch {
      Write-Warning "Validated transcribe script is active, but the old backup could not be removed: $($_.Exception.Message)"
    }
  }
  if (Test-Path -LiteralPath $State.CandidatePath) {
    try {
      Remove-Item -LiteralPath $State.CandidatePath -Force -ErrorAction Stop
    } catch {
      Write-Warning "Validated transcribe script is active, but the candidate residue could not be removed: $($_.Exception.Message)"
    }
  }
}

$installMutex = $null
$transcribeScriptUpdate = $null
try {
  $installMutex = Acquire-InstallLock
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
  $transcribeScriptUpdate = Start-TranscribeScriptUpdate -InstallRoot $InstallRoot
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
      -Urls (Get-EnabledAssetUrls -PrimaryUrls $WhisperWindowsAuthorizedUrls -FallbackUrls $WhisperWindowsFallbackUrls) `
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
      -Urls (Get-EnabledAssetUrls -PrimaryUrls $FfmpegAuthorizedUrls -FallbackUrls @(
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

  $modelPath = Join-Path $ModelDir $WhisperModelFileName
  $cachedModelPath = Join-Path $CacheRoot $WhisperModelFileName
  if ((Test-Path -LiteralPath $modelPath) -and ((Get-Item -LiteralPath $modelPath).Length -lt $WhisperModelMinBytes)) {
    Remove-Item -LiteralPath $modelPath -Force
  }
  if (-not (Test-Path -LiteralPath $modelPath)) {
    # Retain partial model cache; Download-File resumes only a matching asset identity.
    Install-ModelPackage -Urls (Get-EnabledAssetUrls -PrimaryUrls $ModelAuthorizedUrls -FallbackUrls @($ModelFallbackUrls + $ModelOfficialFallbackUrls)) -OutFile $cachedModelPath -MinBytes $WhisperModelMinBytes -Label "Whisper model" | Out-Null
    Move-Item -LiteralPath $cachedModelPath -Destination $modelPath -Force
  }

  Assert-DownloadedFile -Path $modelPath -MinBytes $WhisperModelMinBytes -Label "Whisper model" | Out-Null
  # The previous "small" model is no longer used; it would otherwise keep
  # half a gigabyte of dead weights around after the upgrade.
  $legacyModelPath = Join-Path $ModelDir $LegacyWhisperModelFileName
  if ((Test-Path -LiteralPath $legacyModelPath) -and $LegacyWhisperModelFileName -ne $WhisperModelFileName) {
    Remove-Item -LiteralPath $legacyModelPath -Force -ErrorAction SilentlyContinue
  }

  try {
    Invoke-LocalAsrValidation -WhisperPath $installedWhisper.FullName -FfmpegPath $installedFfmpeg.FullName -ModelPath $modelPath
  } catch {
    Write-Host "Current whisper.cpp failed real inference validation; reinstalling once."
    Write-Host ($_.Exception.Message)
    $whisperZip = Join-Path $CacheRoot "whisper.zip"
    Install-ZipPackage `
      -Urls (Get-EnabledAssetUrls -PrimaryUrls $WhisperWindowsAuthorizedUrls -FallbackUrls $WhisperWindowsFallbackUrls) `
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

  # Optional stage: transcription must keep working when these assets cannot be
  # downloaded on this machine or network.
  $diarizationInstalled = $false
  try {
    Install-DiarizationPackage -InstallRoot $InstallRoot -TempRoot $TempRoot
    $diarizationInstalled = $true
  } catch {
    Write-Host "Speaker diarization is unavailable; transcription continues without speaker labels."
    Write-Host ($_.Exception.Message)
  }

  try {
    Install-PunctuationModel -InstallRoot $InstallRoot
  } catch {
    Write-Host "Chinese punctuation is unavailable; transcripts continue without punctuation."
    Write-Host ($_.Exception.Message)
  }

# BEGIN_TRANSCRIBE_TEMPLATE
  $embeddedTranscribeTemplate = @'
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

$ModelFileName = "ggml-large-v3-turbo-q5_0.bin"
$Model = Join-Path $Root "models\$ModelFileName"
# whisper.cpp defaults to four threads on every machine. The large model makes
# transcription the slowest stage of a sync, so use the cores that are there.
$WhisperThreads = [Math]::Max(4, [Math]::Min(16, [Environment]::ProcessorCount))
if (-not (Test-Path -LiteralPath $Model)) {
  throw "Whisper model not found: $Model"
}

# Speaker diarization is optional. Old installs simply have no diarization
# folder and produce transcripts without speaker labels.
$DiarizationExe = $null
$DiarizationSegmentationModel = Join-Path $Root "diarization\models\segmentation-3.0.onnx"
$DiarizationEmbeddingModel = Join-Path $Root "diarization\models\campplus-zh-en-16k.onnx"
$DiarizationDir = Join-Path $Root "diarization"
if (Test-Path -LiteralPath $DiarizationDir) {
  $DiarizationExe = Get-ChildItem -LiteralPath $DiarizationDir -Recurse -File -Filter "sherpa-onnx-offline-speaker-diarization.exe" | Select-Object -First 1
}
$DiarizationReady = [bool]($DiarizationExe -and
  (Test-Path -LiteralPath $DiarizationSegmentationModel) -and
  (Test-Path -LiteralPath $DiarizationEmbeddingModel))

# Chinese punctuation is optional as well. It needs the sherpa-onnx runtime the
# diarization stage installs, the CT-Transformer model, and the small C# shim
# that bridges to the runtime's C API.
$PunctuationModel = Join-Path $DiarizationDir "models\punct-ct-transformer-zh-en.onnx"
$PunctuationShimPath = Join-Path $DiarizationDir "punctuation-shim.cs"
$PunctuationReady = [bool](
  (Test-Path -LiteralPath $PunctuationModel) -and
  (Test-Path -LiteralPath $PunctuationShimPath) -and
  (Test-Path -LiteralPath (Join-Path $DiarizationDir "onnxruntime.dll")) -and
  (Test-Path -LiteralPath (Join-Path $DiarizationDir "sherpa-onnx-c-api.dll")))

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
$TranscriptPartialRecoveryVersion = "partial-recovery-v1"
$SpeakerDiarizationVersion = "speaker-diarization-v1"
$ChinesePunctuationVersion = "chinese-punctuation-v1"
$NativeProcessRunnerVersion = "diagnostics-process-v2"
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
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$ReportProgress,
    [string]$ProgressStage = "transcribing",
    [int]$ProgressCurrent = 0,
    [int]$ProgressTotal = 0
  )
  $process = $null
  try {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join " ")
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
      throw "Native process did not start: $FilePath"
    }
    $null = $process.Handle
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    while (-not $process.WaitForExit(5000)) {
      if ($ReportProgress) {
        Write-ProgressLog -Stage $ProgressStage -Current $ProgressCurrent -Total $ProgressTotal -ProcessId $process.Id
      }
    }
    $process.WaitForExit()
    $stdoutText = [string]$stdoutTask.GetAwaiter().GetResult()
    $stderrText = [string]$stderrTask.GetAwaiter().GetResult()
    $exitCode = [int]$process.ExitCode
  } finally {
    if ($process) {
      $process.Dispose()
    }
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
    [Parameter(Mandatory = $true)][int]$Total,
    [int]$ProcessId = 0
  )
  $now = (Get-Date).ToUniversalTime().ToString("o")
  if ($script:ProgressStageName -ne $Stage -or -not $script:ProgressStageStartedAt) {
    $script:ProgressStageName = $Stage
    $script:ProgressStageStartedAt = $now
  }
  $percent = 0
  if ($Total -gt 0) {
    $percent = [Math]::Floor(($Current * 100) / $Total)
  }
  Add-Content -LiteralPath $RunLog -Encoding UTF8 -Value @(
    "progressStage=$Stage"
    "progressCurrent=$Current"
    "progressTotal=$Total"
    "progressPercent=$percent"
    "progressStartedAt=$script:ProgressStageStartedAt"
    "progressHeartbeatAt=$now"
    "progressPid=$ProcessId"
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

function Trim-RepeatedTranscriptTailLegacy {
  param([AllowNull()][string]$Text)
  $source = [string]$Text
  if (-not $source.Trim()) {
    return ""
  }

  $lines = @($source -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($lines.Count -lt 3) {
    return $source.Trim()
  }

  # Repetition caused by a bad chunk is normally concentrated at its tail. Keep
  # the useful prefix so one poisoned chunk does not discard the whole media.
  $tailStart = [Math]::Max(0, $lines.Count - 36)
  $cutoff = $lines.Count
  $occurrences = @{}
  for ($index = $tailStart; $index -lt $lines.Count; $index += 1) {
    $key = (($lines[$index] -replace "\s+", " ").Trim()).ToLowerInvariant()
    if ($key.Length -lt 6) {
      continue
    }
    if (-not $occurrences.ContainsKey($key)) {
      $occurrences[$key] = New-Object System.Collections.Generic.List[int]
    }
    $occurrences[$key].Add($index)
  }
  foreach ($entry in $occurrences.GetEnumerator()) {
    $indexes = @($entry.Value)
    if ($indexes.Count -ge 6) {
      $cutoff = [Math]::Min($cutoff, [int]$indexes[0])
    }
  }
  for ($index = $tailStart + 2; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index].Length -ge 6 -and $lines[$index] -eq $lines[$index - 1] -and $lines[$index] -eq $lines[$index - 2]) {
      $cutoff = [Math]::Min($cutoff, $index - 2)
      break
    }
  }
  if ($cutoff -ge $lines.Count -or $cutoff -le 0) {
    return ""
  }

  $prefixLines = @($lines[0..($cutoff - 1)])
  while ($prefixLines.Count -gt 0) {
    $last = $prefixLines[$prefixLines.Count - 1].Trim()
    $looksLikeNoise = $last.Length -lt 3 -or
      # CJK is written as .NET regex escapes on purpose: this installer is
      # stored as UTF-8 without a BOM and Windows PowerShell 5.1 decodes it
      # with the ANSI code page, so literal CJK here would arrive as mojibake.
      $last -match "^(?:\u5b57\u5e55|\u672c\u5b57\u5e55|\u8c22\u8c22\u89c2\u770b|\u8bf7\u4e0d\u541d\u70b9\u8d5e|www\\.|https?://)" -or
      $last -match "^[A-Za-z\s\.,!?-]{1,8}$"
    if (-not $looksLikeNoise) {
      break
    }
    if ($prefixLines.Count -eq 1) {
      $prefixLines = @()
    } else {
      $prefixLines = @($prefixLines[0..($prefixLines.Count - 2)])
    }
  }
  if ($prefixLines.Count -eq 0) {
    return ""
  }
  $prefix = ($prefixLines -join "`n").Trim()
  if ($prefix.Length -lt 4) {
    return ""
  }
  return $prefix
}

# Keep the trimming rule ASCII-only because Windows PowerShell may load a UTF-8
# script without a BOM using the active code page.
function Trim-RepeatedTranscriptTail {
  param([AllowNull()][string]$Text)
  $source = [string]$Text
  if (-not $source.Trim()) {
    return ""
  }
  $lines = @($source -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($lines.Count -lt 3) {
    return $source.Trim()
  }
  $tailStart = [Math]::Max(0, $lines.Count - 36)
  $cutoff = $lines.Count
  $occurrences = @{}
  for ($index = $tailStart; $index -lt $lines.Count; $index += 1) {
    $key = (($lines[$index] -replace "\s+", " ").Trim()).ToLowerInvariant()
    if ($key.Length -lt 6) {
      continue
    }
    if (-not $occurrences.ContainsKey($key)) {
      $occurrences[$key] = New-Object System.Collections.Generic.List[int]
    }
    $occurrences[$key].Add($index)
  }
  foreach ($entry in $occurrences.GetEnumerator()) {
    $indexes = @($entry.Value)
    if ($indexes.Count -ge 6) {
      $cutoff = [Math]::Min($cutoff, [int]$indexes[0])
    }
  }
  for ($index = $tailStart + 2; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index].Length -ge 6 -and $lines[$index] -eq $lines[$index - 1] -and $lines[$index] -eq $lines[$index - 2]) {
      $cutoff = [Math]::Min($cutoff, $index - 2)
      break
    }
  }
  if ($cutoff -ge $lines.Count -or $cutoff -le 0) {
    return ""
  }
  $prefixLines = @($lines[0..($cutoff - 1)])
  while ($prefixLines.Count -gt 0) {
    $last = $prefixLines[$prefixLines.Count - 1].Trim()
    $looksLikeNoise = $last.Length -lt 3 -or
      $last -match "^(?:subtitle|subtitles|thanks for watching|www\\.|https?://)" -or
      $last -match "^[A-Za-z\s\.,!?-]{1,8}$"
    if (-not $looksLikeNoise) {
      break
    }
    if ($prefixLines.Count -eq 1) {
      $prefixLines = @()
    } else {
      $prefixLines = @($prefixLines[0..($prefixLines.Count - 2)])
    }
  }
  if ($prefixLines.Count -eq 0) {
    return ""
  }
  $prefix = ($prefixLines -join "`n").Trim()
  if ($prefix.Length -lt 4) {
    return ""
  }
  return $prefix
}

function Invoke-WhisperChunk {
  param(
    [Parameter(Mandatory = $true)][string]$ChunkPath,
    [Parameter(Mandatory = $true)][string]$ChunkBase,
    [Parameter(Mandatory = $true)][scriptblock]$PathForNative,
    [string[]]$ExtraArguments = @(),
    [int]$ProgressCurrent = 0,
    [int]$ProgressTotal = 0
  )
  $arguments = @(
    "-m", (& $PathForNative $attemptModelPath),
    "-f", (& $PathForNative $ChunkPath),
    "-t", [string]$WhisperThreads,
    "-l", "zh"
  ) + $ExtraArguments + @(
    "-otxt",
    "-oj",
    "-of", (& $PathForNative $ChunkBase)
  )
  return Invoke-NativeProcess -FilePath $Whisper.FullName -Arguments $arguments -ReportProgress -ProgressStage "transcribing" -ProgressCurrent $ProgressCurrent -ProgressTotal $ProgressTotal
}

function Read-WhisperChunkSegments {
  param(
    [Parameter(Mandatory = $true)][string]$ChunkBase,
    [Parameter(Mandatory = $true)][int64]$ChunkOffsetMs
  )
  $jsonPath = "$ChunkBase.json"
  if (-not (Test-Path -LiteralPath $jsonPath)) {
    return @()
  }
  try {
    $payload = [System.IO.File]::ReadAllText($jsonPath, $Utf8NoBom) | ConvertFrom-Json
  } catch {
    return @()
  }
  if (-not $payload -or -not $payload.transcription) {
    return @()
  }
  $offsetMs = $ChunkOffsetMs
  $segments = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($payload.transcription)) {
    if (-not $item) { continue }
    $text = (ConvertTo-SimplifiedChinese ([string]$item.text)).Trim()
    if (-not $text) { continue }
    $fromMs = [int64]0
    $toMs = [int64]0
    if ($item.offsets) {
      $fromMs = [int64]$item.offsets.from
      $toMs = [int64]$item.offsets.to
    }
    if ($toMs -lt $fromMs) { $toMs = $fromMs }
    $segments.Add([PSCustomObject]@{
      startMs = $offsetMs + $fromMs
      endMs = $offsetMs + $toMs
      text = $text
      speaker = ""
    })
  }
  return $segments.ToArray()
}

function Convert-AudioToNormalizedWav {
  param(
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][scriptblock]$PathForNative
  )
  return Invoke-NativeProcess -FilePath $Ffmpeg.FullName -Arguments @(
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", (& $PathForNative $AudioPath),
    "-vn",
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-f", "wav",
    (& $PathForNative $OutputPath)
  ) -ReportProgress -ProgressStage "diarizing"
}

function Read-DiarizationTurns {
  param(
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [Parameter(Mandatory = $true)][scriptblock]$PathForNative
  )
  # One whole-file pass: the clustering step is global, so running this per
  # chunk would give each chunk its own speaker ids and produce labels that
  # contradict each other across chunk boundaries.
  $result = Invoke-NativeProcess -FilePath $DiarizationExe.FullName -Arguments @(
    ("--segmentation.pyannote-model=" + (& $PathForNative $DiarizationSegmentationModel)),
    ("--embedding.model=" + (& $PathForNative $DiarizationEmbeddingModel)),
    (& $PathForNative $AudioPath)
  ) -ReportProgress -ProgressStage "diarizing"
  $turns = New-Object System.Collections.Generic.List[object]
  foreach ($line in ([string]$result.Output -split "`r?`n")) {
    $match = [regex]::Match($line, '^\s*(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s+(speaker_\d+)\s*$')
    if (-not $match.Success) { continue }
    $startSeconds = [double]$match.Groups[1].Value
    $endSeconds = [double]$match.Groups[2].Value
    if ($endSeconds -le $startSeconds) { continue }
    $turns.Add([PSCustomObject]@{
      StartMs = [int64][math]::Round($startSeconds * 1000)
      EndMs = [int64][math]::Round($endSeconds * 1000)
      Speaker = [string]$match.Groups[3].Value
    })
  }
  return [PSCustomObject]@{
    ExitCode = $result.ExitCode
    Turns = $turns
    Output = $result.Output
  }
}

function Set-SegmentSpeakers {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Segments,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Turns
  )
  if ($Segments.Count -eq 0 -or $Turns.Count -eq 0) { return 0 }
  # Speaker ids from sherpa-onnx are sparse (speaker_00, speaker_07...);
  # renumber by first appearance so the note reads speaker 1, speaker 2, ...
  # The CJK label prefix is built from code points on purpose: this installer
  # is stored as UTF-8 without a BOM and Windows PowerShell 5.1 decodes that
  # with the ANSI code page, so a literal here would arrive as mojibake.
  $speakerPrefix = [string]([char]0x8BF4) + [string]([char]0x8BDD) + [string]([char]0x4EBA)
  $labels = @{}
  $speakerCount = 0
  foreach ($turn in $Turns) {
    if (-not $labels.ContainsKey($turn.Speaker)) {
      $speakerCount += 1
      $labels[$turn.Speaker] = $speakerPrefix + [string]$speakerCount
    }
  }
  foreach ($segment in $Segments) {
    $segmentStart = [double]$segment.startMs
    $segmentEnd = [double]$segment.endMs
    $segmentMiddle = ($segmentStart + $segmentEnd) / 2
    $bestSpeaker = $null
    $bestOverlap = 0.0
    $nearestSpeaker = $null
    $nearestDistance = [double]::MaxValue
    foreach ($turn in $Turns) {
      $overlap = [math]::Min($segmentEnd, [double]$turn.EndMs) - [math]::Max($segmentStart, [double]$turn.StartMs)
      if ($overlap -gt $bestOverlap) {
        $bestOverlap = $overlap
        $bestSpeaker = $turn.Speaker
      }
      $turnMiddle = ([double]$turn.StartMs + [double]$turn.EndMs) / 2
      $distance = [math]::Abs($turnMiddle - $segmentMiddle)
      if ($distance -lt $nearestDistance) {
        $nearestDistance = $distance
        $nearestSpeaker = $turn.Speaker
      }
    }
    $speaker = if ($bestSpeaker) { $bestSpeaker } else { $nearestSpeaker }
    if ($speaker -and $labels.ContainsKey($speaker)) {
      $segment.speaker = $labels[$speaker]
    }
  }
  return $speakerCount
}

# whisper.cpp produces no punctuation for Mandarin, so transcripts are
# punctuated afterwards by the sherpa-onnx CT-Transformer model. The model only
# inserts punctuation and keeps every other character, which is what makes the
# mapping back onto timed segments possible.
function Test-PunctuationFillerCharacter {
  param([char]$Character)
  return ([char]::IsWhiteSpace($Character) -or
    [char]::IsPunctuation($Character) -or
    [char]::IsSymbol($Character))
}

function Get-PunctuationCoreText {
  param([string]$Text)
  $builder = New-Object System.Text.StringBuilder
  foreach ($character in ([string]$Text).ToCharArray()) {
    if (Test-PunctuationFillerCharacter $character) { continue }
    [void]$builder.Append($character)
  }
  return $builder.ToString()
}

function Test-CjkCharacter {
  param([char]$Character)
  $code = [int]$Character
  return (($code -ge 0x3400 -and $code -le 0x4DBF) -or
    ($code -ge 0x4E00 -and $code -le 0x9FFF) -or
    ($code -ge 0xF900 -and $code -le 0xFAFF) -or
    ($code -ge 0xFF00 -and $code -le 0xFFEF) -or
    ($code -ge 0x3000 -and $code -le 0x303F))
}

function Test-SentenceEndPunctuation {
  param([char]$Character)
  $code = [int]$Character
  return ($code -eq 0x3002 -or $code -eq 0xFF01 -or $code -eq 0xFF1F)
}

function Test-ClausePunctuation {
  param([char]$Character)
  $code = [int]$Character
  return ($code -eq 0xFF0C -or $code -eq 0x3001 -or $code -eq 0xFF1B -or $code -eq 0xFF1A)
}

function Get-FullWidthPunctuation {
  param([char]$Character)
  switch ([int]$Character) {
    0x2C { return [char]0xFF0C }
    0x3F { return [char]0xFF1F }
    0x21 { return [char]0xFF01 }
    0x3B { return [char]0xFF1B }
    0x3A { return [char]0xFF1A }
    0x2E { return [char]0x3002 }
  }
  return $Character
}

# The model mixes half-width and full-width marks and occasionally emits a
# comma right after a sentence end. Normalize both so notes read evenly.
# Half-width marks only become full width after a Chinese character, which
# keeps English text such as "ChatGPT, GPT-4" untouched.
function Optimize-PunctuationText {
  param([string]$Text)
  if (-not $Text) { return "" }
  $source = $Text.ToCharArray()
  $builder = New-Object System.Text.StringBuilder
  $lastAppended = [char]0
  $previousCore = [char]0
  for ($index = 0; $index -lt $source.Length; $index += 1) {
    $character = $source[$index]
    if ([char]::IsWhiteSpace($character)) { continue }
    $mapped = $character
    if (Test-CjkCharacter $previousCore) {
      $mapped = Get-FullWidthPunctuation $character
    }
    if ((Test-ClausePunctuation $mapped) -and (Test-SentenceEndPunctuation $lastAppended)) {
      continue
    }
    if (Test-SentenceEndPunctuation $mapped) {
      if (Test-SentenceEndPunctuation $lastAppended) {
        continue
      }
      if ($builder.Length -gt 0 -and (Test-ClausePunctuation $lastAppended)) {
        $builder.Length = $builder.Length - 1
      }
    }
    [void]$builder.Append($mapped)
    if (-not (Test-PunctuationFillerCharacter $mapped)) {
      $previousCore = $mapped
    }
    $lastAppended = $mapped
  }
  return $builder.ToString()
}

function Initialize-PunctuationEngine {
  if ($script:PunctuationInitialized) { return }
  $script:PunctuationInitialized = $true
  $script:PunctuationHandle = [IntPtr]::Zero
  if (-not $PunctuationReady) { return }
  try {
    Add-Type -Path $PunctuationShimPath -ErrorAction Stop
    if (-not [WechatInboxSherpaPunctuation]::Preload($DiarizationDir)) {
      throw "the sherpa-onnx punctuation runtime failed to load"
    }
    $threads = [Math]::Max(1, [Math]::Min(8, [Environment]::ProcessorCount))
    $script:PunctuationHandle = [WechatInboxSherpaPunctuation]::Create($PunctuationModel, $threads)
    if ($script:PunctuationHandle -eq [IntPtr]::Zero) {
      throw "the punctuation model failed to open"
    }
    Write-Host "[punctuation] engine ready"
  } catch {
    $script:PunctuationHandle = [IntPtr]::Zero
    Write-Host ("[punctuation] unavailable: " + $_.Exception.Message)
  }
}

function Add-TextPunctuation {
  param([string]$Text)
  if (-not $Text) { return "" }
  Initialize-PunctuationEngine
  if ($script:PunctuationHandle -eq [IntPtr]::Zero) { return "" }
  try {
    return [WechatInboxSherpaPunctuation]::AddPunctuation($script:PunctuationHandle, $Text)
  } catch {
    $script:PunctuationHandle = [IntPtr]::Zero
    Write-Host ("[punctuation] model call failed: " + $_.Exception.Message)
    return ""
  }
}

function Set-PunctuationUnitText {
  param([AllowEmptyCollection()][object[]]$Units)
  if ($Units.Count -eq 0) { return 0 }
  $flat = New-Object System.Text.StringBuilder
  foreach ($unit in $Units) { [void]$flat.Append([string]$unit.text) }
  $flatText = $flat.ToString()
  $punctuated = Add-TextPunctuation $flatText
  if (-not $punctuated) { return 0 }
  $punctuated = Optimize-PunctuationText $punctuated
  # Guard: the model must only add punctuation. If it rewrote characters the
  # result cannot be mapped back onto timings, so keep the original text.
  if ((Get-PunctuationCoreText $flatText) -ne (Get-PunctuationCoreText $punctuated)) {
    Write-Host "[punctuation] block skipped: the model altered characters"
    return 0
  }
  $owners = New-Object System.Collections.Generic.List[int]
  for ($index = 0; $index -lt $Units.Count; $index += 1) {
    $coreLength = (Get-PunctuationCoreText ([string]$Units[$index].text)).Length
    for ($k = 0; $k -lt $coreLength; $k += 1) { $owners.Add($index) }
  }
  if ($owners.Count -eq 0) { return 0 }
  $buffers = @()
  for ($index = 0; $index -lt $Units.Count; $index += 1) {
    $buffers += (New-Object System.Text.StringBuilder)
  }
  $coreIndex = 0
  foreach ($character in $punctuated.ToCharArray()) {
    if ([char]::IsWhiteSpace($character)) { continue }
    if (Test-PunctuationFillerCharacter $character) {
      $owner = if ($coreIndex -eq 0) { 0 } else { $owners[$coreIndex - 1] }
    } else {
      if ($coreIndex -ge $owners.Count) { break }
      $owner = $owners[$coreIndex]
      $coreIndex += 1
    }
    if ($owner -ge 0 -and $owner -lt $buffers.Count) {
      [void]$buffers[$owner].Append($character)
    }
  }
  $changed = 0
  for ($index = 0; $index -lt $Units.Count; $index += 1) {
    $updated = $buffers[$index].ToString().Trim()
    if (-not $updated) { continue }
    if ($updated -ne [string]$Units[$index].text) {
      $Units[$index].text = $updated
      $changed += 1
    }
  }
  return $changed
}

function Add-UnitPunctuation {
  param(
    [AllowEmptyCollection()][object[]]$Units,
    [int]$MaxCoreCharacters = 1600
  )
  if (-not $PunctuationReady) { return 0 }
  if ($Units.Count -eq 0) { return 0 }
  $changed = 0
  $batch = New-Object System.Collections.Generic.List[object]
  $batchCoreLength = 0
  foreach ($unit in $Units) {
    if (-not $unit) { continue }
    $text = [string]$unit.text
    if (-not $text) { continue }
    $batch.Add($unit)
    $batchCoreLength += (Get-PunctuationCoreText $text).Length
    if ($batchCoreLength -lt $MaxCoreCharacters) { continue }
    $changed += (Set-PunctuationUnitText -Units @($batch.ToArray()))
    $batch = New-Object System.Collections.Generic.List[object]
    $batchCoreLength = 0
  }
  if ($batch.Count -gt 0) {
    $changed += (Set-PunctuationUnitText -Units @($batch.ToArray()))
  }
  return $changed
}

function Get-WavDurationSeconds {
  param(
    [Parameter(Mandatory = $true)][string]$Path
  )
  $stream = $null
  $reader = $null
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    if ($stream.Length -lt 44) { return 0.0 }
    $reader = New-Object System.IO.BinaryReader($stream)
    $header = $reader.ReadBytes(12)
    if ($header.Length -lt 12) { return 0.0 }
    $ascii = [System.Text.Encoding]::ASCII
    if (($ascii.GetString($header, 0, 4)) -ne "RIFF") { return 0.0 }
    if (($ascii.GetString($header, 8, 4)) -ne "WAVE") { return 0.0 }
    $position = [int64]12
    while (($position + 8) -le $stream.Length) {
      $stream.Position = $position
      $chunkId = $ascii.GetString($reader.ReadBytes(4))
      $chunkSize = [int64]$reader.ReadInt32()
      if ($chunkSize -lt 0) { break }
      if ($chunkId -eq "data") {
        # Chunks are written as 16 kHz mono 16-bit PCM: 32000 bytes a second.
        return ([double]$chunkSize / 32000.0)
      }
      $position = $position + 8 + $chunkSize
      if (($chunkSize % 2) -ne 0) { $position = $position + 1 }
    }
    return 0.0
  } catch {
    return 0.0
  } finally {
    if ($reader) { $reader.Dispose() }
    if ($stream) { $stream.Dispose() }
  }
}

function Find-SilenceCutPoints {
  param(
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [Parameter(Mandatory = $true)][int]$TargetSeconds,
    [Parameter(Mandatory = $true)][scriptblock]$PathForNative
  )
  $result = [PSCustomObject]@{
    Cuts = @()
    DurationSeconds = 0.0
  }
  # Default log level on purpose: silencedetect reports on stderr at info level,
  # together with the Duration line this pass needs anyway.
  $probe = Invoke-NativeProcess -FilePath $Ffmpeg.FullName -Arguments @(
    "-hide_banner", "-nostats",
    "-i", (& $PathForNative $AudioPath),
    "-af", "silencedetect=noise=-32dB:d=0.7",
    "-f", "null", "-"
  )
  if ($probe.ExitCode -ne 0) {
    return $result
  }
  $invariant = [System.Globalization.CultureInfo]::InvariantCulture
  $durationSeconds = 0.0
  $durationMatch = [regex]::Match([string]$probe.Output, "Duration:\s*(\d+):(\d+):([0-9.]+)")
  if ($durationMatch.Success) {
    $durationSeconds = ([double]$durationMatch.Groups[1].Value * 3600.0) +
      ([double]$durationMatch.Groups[2].Value * 60.0) +
      [double]::Parse($durationMatch.Groups[3].Value, $invariant)
  }
  $result.DurationSeconds = $durationSeconds
  if ($durationSeconds -le [double]$TargetSeconds) {
    return $result
  }
  # The end of a pause, not its start. A chunk that opens on silence makes the
  # model guess its first words, and it guesses whatever it just heard.
  $silences = New-Object System.Collections.Generic.List[double]
  foreach ($line in ([string]$probe.Output -split "`r?`n")) {
    $match = [regex]::Match($line, "silence_end:\s*(-?[0-9.]+)")
    if (-not $match.Success) { continue }
    $value = [double]::Parse($match.Groups[1].Value, $invariant)
    if ($value -ge 0) { $silences.Add($value) }
  }
  # A cut through a spoken word loses or repeats it, so each boundary slides to
  # the nearest quiet moment. When nothing is quiet nearby the clock wins.
  $window = [Math]::Max(6.0, [double]$TargetSeconds * 0.08)
  $cuts = New-Object System.Collections.Generic.List[double]
  $previous = 0.0
  $boundary = [double]$TargetSeconds
  while ($boundary -lt ($durationSeconds - 10.0)) {
    $chosen = $boundary
    $bestDistance = $window + 1.0
    foreach ($silence in $silences) {
      $distance = [Math]::Abs($silence - $boundary)
      if ($distance -le $window -and $distance -lt $bestDistance) {
        $chosen = $silence
        $bestDistance = $distance
      }
    }
    # A cut too close to the previous one would leave a stub chunk.
    if (($chosen - $previous) -ge 20.0) {
      $cuts.Add($chosen)
      $previous = $chosen
    } else {
      $previous = $boundary
    }
    $boundary = $boundary + [double]$TargetSeconds
  }
  $result.Cuts = $cuts.ToArray()
  return $result
}

function Split-AudioToChunks {
  param(
    [Parameter(Mandatory = $true)][string]$AudioPath,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [Parameter(Mandatory = $true)][int]$SegmentSeconds,
    [Parameter(Mandatory = $true)][scriptblock]$PathForNative,
    [switch]$PreferSilence
  )
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  $pattern = Join-Path $OutputDir "chunk-%03d.wav"
  $cutSeconds = @()
  if ($PreferSilence) {
    try {
      $analysis = Find-SilenceCutPoints -AudioPath $AudioPath -TargetSeconds $SegmentSeconds -PathForNative $PathForNative
      if ($analysis -and $analysis.Cuts) {
        $cutSeconds = @($analysis.Cuts)
      }
    } catch {
      $cutSeconds = @()
    }
  }
  $arguments = @(
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", (& $PathForNative $AudioPath),
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "-f", "segment"
  )
  if ($cutSeconds.Count -gt 0) {
    $invariant = [System.Globalization.CultureInfo]::InvariantCulture
    $cutList = ($cutSeconds | ForEach-Object { ([double]$_).ToString("0.000", $invariant) }) -join ","
    $arguments += @("-segment_times", $cutList)
  } else {
    $arguments += @("-segment_time", [string]$SegmentSeconds)
  }
  $arguments += @("-reset_timestamps", "1", $pattern)
  $result = Invoke-NativeProcess -FilePath $Ffmpeg.FullName -Arguments $arguments -ReportProgress -ProgressStage "segmenting"
  $chunks = @(Get-ChildItem -LiteralPath $OutputDir -Filter "chunk-*.wav" | Sort-Object Name)
  # Chunks are not exactly SegmentSeconds long, so timestamps are built from the
  # real start of each chunk instead of assuming a fixed stride.
  $chunkStartSeconds = New-Object System.Collections.Generic.List[double]
  $elapsed = 0.0
  foreach ($chunk in $chunks) {
    $chunkStartSeconds.Add($elapsed)
    $elapsed = $elapsed + (Get-WavDurationSeconds -Path $chunk.FullName)
  }
  return [PSCustomObject]@{
    FfmpegResult = $result
    ChunkFiles = $chunks
    ChunkPattern = $pattern
    ChunkStartSeconds = $chunkStartSeconds.ToArray()
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
    $attemptModelPath = Join-Path $safeTempRoot $ModelFileName
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
  $punctuationStatus = "pending"

  try {
  New-Item -ItemType Directory -Force -Path $TempWorkDir | Out-Null
  $diarizationTurns = @()
  $diarizationStatus = if ($DiarizationReady) { "pending" } else { "unavailable" }
  $diarizationLog = ""
  $splitSourcePath = $attemptInputPath
  if ($DiarizationReady) {
    $normalizedAudioPath = Join-Path $TempWorkDir "normalized.wav"
    try {
      $normalizeResult = Convert-AudioToNormalizedWav -AudioPath $attemptInputPath -OutputPath $normalizedAudioPath -PathForNative $pathForNative
      if ($normalizeResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $normalizedAudioPath)) {
        throw "ffmpeg normalize failed with exit code $($normalizeResult.ExitCode)"
      }
      # Chunking reuses this decode instead of re-reading the source.
      $splitSourcePath = $normalizedAudioPath
      if ((Get-Item -LiteralPath $normalizedAudioPath).Length -gt 460MB) {
        $diarizationStatus = "too-long"
      } else {
        $diarizationResult = Read-DiarizationTurns -AudioPath $normalizedAudioPath -PathForNative $pathForNative
        $diarizationTurns = @($diarizationResult.Turns.ToArray())
        $diarizationStatus = if ($diarizationTurns.Count -gt 0) { "ok" } else { "empty" }
        $diarizationLog = $diarizationResult.Output
      }
    } catch {
      $diarizationStatus = "failed"
      $diarizationTurns = @()
      $diarizationLog = ($_ | Out-String)
    }
  }
  Write-ProgressLog -Stage "segmenting" -Current 0 -Total 0
  $split = Split-AudioToChunks -AudioPath $splitSourcePath -OutputDir $tempWorkDir -SegmentSeconds $ChunkSeconds -PathForNative $pathForNative -PreferSilence
  if ($splitSourcePath -ne $attemptInputPath) {
    Remove-Item -LiteralPath $splitSourcePath -Force -ErrorAction SilentlyContinue
  }
  $ffmpegOutput = $split.FfmpegResult.Output
  $ffmpegExit = $split.FfmpegResult.ExitCode
  $chunkFiles = @($split.ChunkFiles)
  $chunkStartSeconds = @($split.ChunkStartSeconds)
  $result.ChunkCount = $chunkFiles.Count
  Write-ProgressLog -Stage "transcribing" -Current 0 -Total $chunkFiles.Count
  $whisperLogs = New-Object System.Collections.Generic.List[string]
  $mergedText = New-Object System.Collections.Generic.List[string]
  $mergedSegments = New-Object System.Collections.Generic.List[object]
  $whisperExit = 0
  $chunkIndex = 0
  $recoveryTriggered = 0
  $skippedRepeatChunks = 0

  if ($ffmpegExit -eq 0 -and $chunkFiles.Count -eq 0) {
    throw "ffmpeg did not generate audio chunks."
  }

  foreach ($chunk in $chunkFiles) {
    $chunkBase = [System.IO.Path]::Combine($tempWorkDir, [System.IO.Path]::GetFileNameWithoutExtension($chunk.Name))
    $chunkTxt = "$chunkBase.txt"
    $chunkResult = Invoke-WhisperChunk -ChunkPath $chunk.FullName -ChunkBase $chunkBase -PathForNative $pathForNative -ProgressCurrent $chunkIndex -ProgressTotal $chunkFiles.Count
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
          $candidateText = ""
          if ($recovered.ExitCode -eq 0 -and $recovered.Text.Trim()) {
            if (-not (Test-TranscriptHasRepeatHallucination $recovered.Text)) {
              $candidateText = $recovered.Text.Trim()
            } else {
              $candidateText = Trim-RepeatedTranscriptTail -Text $recovered.Text
            }
          }
          if (-not $candidateText) {
            $candidateText = Trim-RepeatedTranscriptTail -Text $normalizedText
          }
          if ($candidateText) {
            $normalizedText = $candidateText
          } else {
            $skippedRepeatChunks += 1
            $whisperLogs.Add("--- $($chunk.Name) repeat-unusable; skipped ---")
            $chunkIndex += 1
            Write-ProgressLog -Stage "transcribing" -Current $chunkIndex -Total $chunkFiles.Count
            continue
          }
        }
        $mergedText.Add($normalizedText)
        # Timestamps come from the original chunk output. Repeat-hallucination
        # recovery may trim the text slightly; segment timing stays the trusted
        # first-pass alignment.
        $chunkOffsetMs = [int64]0
        if ($chunkIndex -lt $chunkStartSeconds.Count) {
          $chunkOffsetMs = [int64][Math]::Round([double]$chunkStartSeconds[$chunkIndex] * 1000.0)
        }
        foreach ($segment in @(Read-WhisperChunkSegments -ChunkBase $chunkBase -ChunkOffsetMs $chunkOffsetMs)) {
          $mergedSegments.Add($segment)
        }
      }
    }
    $chunkIndex += 1
    Write-ProgressLog -Stage "transcribing" -Current $chunkIndex -Total $chunkFiles.Count
  }

    $detectedSpeakers = 0
    if ($diarizationTurns.Count -gt 0 -and $mergedSegments.Count -gt 0) {
      $detectedSpeakers = Set-SegmentSpeakers -Segments @($mergedSegments.ToArray()) -Turns $diarizationTurns
    }

    # Punctuation is best effort: any failure leaves the raw transcript intact.
    $punctuationStatus = if ($PunctuationReady) { "skipped" } else { "unavailable" }
    if ($PunctuationReady -and $mergedSegments.Count -gt 0) {
      try {
        $punctuatedSegments = Add-UnitPunctuation -Units @($mergedSegments.ToArray())
        $punctuationStatus = if ($punctuatedSegments -gt 0) { "ok" } else { "unchanged" }
      } catch {
        $punctuationStatus = "failed"
        Write-Host ("[punctuation] segment step failed: " + $_.Exception.Message)
      }
    }
    if ($PunctuationReady -and $mergedText.Count -gt 0) {
      try {
        $textUnits = @()
        foreach ($chunkText in $mergedText) {
          $textUnits += [PSCustomObject]@{ text = [string]$chunkText }
        }
        [void](Add-UnitPunctuation -Units $textUnits)
        $mergedText = New-Object System.Collections.Generic.List[string]
        foreach ($textUnit in $textUnits) { $mergedText.Add([string]$textUnit.text) }
      } catch {
        Write-Host ("[punctuation] text step failed: " + $_.Exception.Message)
      }
    }

    $result.FfmpegOutput = $ffmpegOutput
    $result.FfmpegExit = $ffmpegExit
    $result.WhisperLogs = ($whisperLogs -join [Environment]::NewLine)
    $result.WhisperExit = $whisperExit
    $result.Text = ConvertTo-SimplifiedChinese ($mergedText -join "`n`n")
    $result | Add-Member -NotePropertyName Segments -NotePropertyValue @($mergedSegments.ToArray()) -Force
    $result | Add-Member -NotePropertyName RecoveryTriggered -NotePropertyValue $recoveryTriggered -Force
    $result | Add-Member -NotePropertyName SkippedRepeatChunks -NotePropertyValue $skippedRepeatChunks -Force
    $result | Add-Member -NotePropertyName DiarizationStatus -NotePropertyValue $diarizationStatus -Force
    $result | Add-Member -NotePropertyName DiarizationSpeakers -NotePropertyValue $detectedSpeakers -Force
    $result | Add-Member -NotePropertyName DiarizationLog -NotePropertyValue $diarizationLog -Force
    $result | Add-Member -NotePropertyName PunctuationStatus -NotePropertyValue $punctuationStatus -Force
    return $result
  } catch {
    $result.FfmpegOutput = $ffmpegOutput
    $result.FfmpegExit = $ffmpegExit
    $result.WhisperLogs = ($whisperLogs -join [Environment]::NewLine)
    $result.WhisperExit = $whisperExit
    $result.Error = ($_ | Out-String)
    $result | Add-Member -NotePropertyName Segments -NotePropertyValue @($mergedSegments.ToArray()) -Force
    $result | Add-Member -NotePropertyName RecoveryTriggered -NotePropertyValue $recoveryTriggered -Force
    $result | Add-Member -NotePropertyName SkippedRepeatChunks -NotePropertyValue $skippedRepeatChunks -Force
    $result | Add-Member -NotePropertyName DiarizationStatus -NotePropertyValue $diarizationStatus -Force
    $result | Add-Member -NotePropertyName DiarizationSpeakers -NotePropertyValue 0 -Force
    $result | Add-Member -NotePropertyName DiarizationLog -NotePropertyValue $diarizationLog -Force
    $result | Add-Member -NotePropertyName PunctuationStatus -NotePropertyValue $punctuationStatus -Force
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
    "skippedRepeatChunks=$($Attempt.SkippedRepeatChunks)"
    "diarization=$($Attempt.DiarizationStatus)"
    "diarizationSpeakers=$($Attempt.DiarizationSpeakers)"
    "punctuation=$($Attempt.PunctuationStatus)"
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
      "skippedRepeatChunks=$($FallbackAttempt.SkippedRepeatChunks)"
      "diarization=$($FallbackAttempt.DiarizationStatus)"
      "diarizationSpeakers=$($FallbackAttempt.DiarizationSpeakers)"
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
    if ($finalAttempt.RecoveryTriggered -eq 1) {
      throw "TRANSCRIPT_HALLUCINATION: no usable transcript remained after local retry. See $RunLog"
    }
    throw "Whisper did not generate transcript text. See $RunLog"
  }

  $finalText = ConvertTo-SimplifiedChinese $finalAttempt.Text
  [System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)
  $segmentsPath = [System.IO.Path]::ChangeExtension($OutputPath, ".segments.json")
  $finalSegments = @()
  if ($finalAttempt.Segments) {
    $finalSegments = @($finalAttempt.Segments)
  }
  if ($finalSegments.Count -gt 0) {
    $speakerCount = 0
    if ($finalAttempt.DiarizationSpeakers) {
      $speakerCount = [int]$finalAttempt.DiarizationSpeakers
    }
    $segmentsPayload = [PSCustomObject]@{
      version = 1
      language = "zh"
      chunkSeconds = $ChunkSeconds
      speakers = $speakerCount
      segments = $finalSegments
    }
    $segmentsJson = $segmentsPayload | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($segmentsPath, $segmentsJson, $Utf8NoBom)
  } elseif (Test-Path -LiteralPath $segmentsPath) {
    # A previous run may leave a stale sidecar; the text no longer matches it.
    Remove-Item -LiteralPath $segmentsPath -Force -ErrorAction SilentlyContinue
  }
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
'@
  $null = $embeddedTranscribeTemplate
# END_TRANSCRIBE_TEMPLATE

  Promote-TranscribeScriptUpdate -State $transcribeScriptUpdate
  Assert-InstalledFile -Root $InstallRoot -Names @("transcribe.ps1") -Label "transcribe script" | Out-Null
  Complete-TranscribeScriptUpdate -State $transcribeScriptUpdate
  $transcribeScriptUpdate = $null

  Write-Host ""
  Write-Host "Local ASR install validation passed."
  Write-Host "whisper: $($installedWhisper.FullName)"
  Write-Host "ffmpeg: $($installedFfmpeg.FullName)"
  Write-Host "model: $modelPath"
  Write-Host "speaker diarization: $(if ($diarizationInstalled) { 'installed' } else { 'unavailable' })"
  Write-Host "Local ASR installed to: $InstallRoot"
  Write-Host "Use this Obsidian plugin command:"
  Write-Host "powershell -NoProfile -ExecutionPolicy Bypass -File `"$InstallRoot\transcribe.ps1`" -InputPath {input} -OutputPath {output}"
} catch {
  $originalInstallError = $_
  try { Restore-TranscribeScriptUpdate -State $transcribeScriptUpdate }
  catch { Write-Warning -WarningAction Continue ("INSTALLER_ROLLBACK_WARNING reason={0}" -f $_.Exception.Message) }
  Write-Host ""
  Write-Host "INSTALLER FAILED"
  Write-Host ($originalInstallError | Out-String)
  throw $originalInstallError
} finally {
  Complete-InstallerCleanup -TemporaryRoot $TempRoot -Mutex $installMutex
}
