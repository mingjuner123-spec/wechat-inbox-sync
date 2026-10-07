$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$sourceCommit = '86c40c3bd6fc86f1187fb751d111b49e0fc18e84'
$vadModelUrl = 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin'
$vadModelSha256 = '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987'
$vadModelBytes = 885098
$requiredDlls = @('ggml-base.dll', 'ggml-cpu.dll', 'ggml.dll', 'whisper.dll')
$tempRoot = Join-Path $env:RUNNER_TEMP 'windows-vad-cpu'
$evidenceRoot = Join-Path $env:RUNNER_TEMP 'windows-vad-evidence'
$sourceRoot = Join-Path $tempRoot 'whisper.cpp'
$buildRoot = Join-Path $tempRoot 'build'
$bundleRoot = Join-Path $evidenceRoot 'vad-windows-x64'
$modelPath = Join-Path $bundleRoot 'models\ggml-silero-v6.2.0.bin'
$jfkPath = Join-Path $tempRoot 'jfk.wav'
$silencePath = Join-Path $tempRoot 'silence.wav'

New-Item -ItemType Directory -Force -Path $tempRoot, $evidenceRoot, (Join-Path $bundleRoot 'bin'), (Join-Path $bundleRoot 'models') | Out-Null

git clone --no-checkout https://github.com/ggml-org/whisper.cpp.git $sourceRoot
if ($LASTEXITCODE -ne 0) { throw 'source_clone_failed' }
git -C $sourceRoot checkout --detach $sourceCommit
if ($LASTEXITCODE -ne 0) { throw 'source_checkout_failed' }
$actualCommit = (git -C $sourceRoot rev-parse HEAD).Trim()
if ($actualCommit -ne $sourceCommit) { throw 'source_commit_mismatch' }
Copy-Item -LiteralPath (Join-Path $sourceRoot 'samples\jfk.wav') -Destination $jfkPath

$configureArgs = @(
  '-S', $sourceRoot, '-B', $buildRoot,
  '-DBUILD_SHARED_LIBS=ON', '-DWHISPER_BUILD_EXAMPLES=ON', '-DWHISPER_BUILD_TESTS=OFF',
  '-DWHISPER_SDL2=OFF', '-DWHISPER_COMMON_FFMPEG=OFF',
  '-DGGML_NATIVE=OFF', '-DGGML_CUDA=OFF', '-DGGML_VULKAN=OFF', '-DGGML_SYCL=OFF',
  '-DGGML_OPENCL=OFF', '-DGGML_HIP=OFF', '-DGGML_METAL=OFF', '-DGGML_ACCELERATE=OFF',
  '-DGGML_AVX=OFF', '-DGGML_AVX2=OFF', '-DGGML_AVX512=OFF', '-DGGML_FMA=OFF', '-DGGML_F16C=OFF',
  '-DGGML_BLAS=OFF', '-DGGML_OPENMP=OFF',
  '-DCMAKE_POLICY_DEFAULT_CMP0091=NEW', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded'
)
& cmake @configureArgs 2>&1 | Tee-Object -FilePath (Join-Path $evidenceRoot 'cmake-configure.txt')
if ($LASTEXITCODE -ne 0) { throw 'cmake_configure_failed' }
& cmake --build $buildRoot --config Release --target whisper-vad-speech-segments --parallel 3 2>&1 |
  Tee-Object -FilePath (Join-Path $evidenceRoot 'cmake-build.txt')
if ($LASTEXITCODE -ne 0) { throw 'cmake_build_failed' }

$builtSegmenter = Get-ChildItem -LiteralPath $buildRoot -Filter 'whisper-vad-speech-segments.exe' -File -Recurse |
  Select-Object -First 1
if (-not $builtSegmenter) { throw 'vad_executable_missing' }
$builtBinDirectory = Split-Path -Parent $builtSegmenter.FullName
Copy-Item -LiteralPath $builtSegmenter.FullName -Destination (Join-Path $bundleRoot 'bin\whisper-vad-speech-segments.exe')
foreach ($dll in $requiredDlls) {
  $candidate = Join-Path $builtBinDirectory $dll
  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "required_runtime_dll_missing:$dll" }
  Copy-Item -LiteralPath $candidate -Destination (Join-Path $bundleRoot "bin\$dll")
}
Copy-Item -LiteralPath (Join-Path $sourceRoot 'LICENSE') -Destination (Join-Path $bundleRoot 'bin\LICENSE')

curl.exe --fail --location --retry 3 --output $modelPath $vadModelUrl 2>&1 |
  Tee-Object -FilePath (Join-Path $evidenceRoot 'model-download.txt')
if ($LASTEXITCODE -ne 0) { throw 'model_download_failed' }
if ((Get-Item -LiteralPath $modelPath).Length -ne $vadModelBytes) { throw 'vad_model_size_mismatch' }
$actualModelHash = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualModelHash -ne $vadModelSha256) { throw 'vad_model_hash_mismatch' }

$pythonSource = @'
import sys
import wave
with wave.open(sys.argv[1], "wb") as stream:
    stream.setnchannels(1)
    stream.setsampwidth(2)
    stream.setframerate(16000)
    stream.writeframes(b"\x00\x00" * 32000)
'@
$pythonSource | Set-Content -LiteralPath (Join-Path $tempRoot 'make-silence.py') -Encoding ascii
python (Join-Path $tempRoot 'make-silence.py') $silencePath
if ($LASTEXITCODE -ne 0) { throw 'silence_fixture_failed' }

$segmenter = Join-Path $bundleRoot 'bin\whisper-vad-speech-segments.exe'
$originalPath = $env:PATH
$env:PATH = "$(Join-Path $bundleRoot 'bin');$env:SystemRoot\System32;$env:SystemRoot"
try {
  $speechOutput = & $segmenter -f $jfkPath -vm $modelPath -vt 0.35 -np 2>&1
  $speechExit = $LASTEXITCODE
} finally {
  $env:PATH = $originalPath
}
$speechOutput | Set-Content -LiteralPath (Join-Path $evidenceRoot 'jfk-vad-output.txt') -Encoding utf8
if ($speechExit -ne 0) { throw 'jfk_vad_exit_failed' }
$speechHeader = ($speechOutput | Select-String -Pattern '^Detected\s+(\d+)\s+speech segments?:?' | Select-Object -First 1).Matches
if (-not $speechHeader -or [int]$speechHeader[0].Groups[1].Value -le 0) { throw 'jfk_speech_not_detected' }

$env:PATH = "$(Join-Path $bundleRoot 'bin');$env:SystemRoot\System32;$env:SystemRoot"
try {
  $silenceOutput = & $segmenter -f $silencePath -vm $modelPath -vt 0.35 -np 2>&1
  $silenceExit = $LASTEXITCODE
} finally {
  $env:PATH = $originalPath
}
$silenceOutput | Set-Content -LiteralPath (Join-Path $evidenceRoot 'silence-vad-output.txt') -Encoding utf8
if ($silenceExit -ne 0) { throw 'silence_vad_exit_failed' }
$silenceHeader = ($silenceOutput | Select-String -Pattern '^Detected\s+(\d+)\s+speech segments?:?' | Select-Object -First 1).Matches
if (-not $silenceHeader -or [int]$silenceHeader[0].Groups[1].Value -ne 0) { throw 'silence_not_rejected' }

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$dumpbinPath = ''
if (Test-Path -LiteralPath $vswhere) {
  $vsInstall = (& $vswhere -latest -products '*' -property installationPath | Select-Object -First 1).Trim()
  if ($vsInstall) {
    $dumpbin = Get-ChildItem -LiteralPath (Join-Path $vsInstall 'VC\Tools\MSVC') -Filter dumpbin.exe -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($dumpbin) { $dumpbinPath = $dumpbin.FullName }
  }
}
if (-not $dumpbinPath) { throw 'dumpbin_unavailable' }
$bundleDllNames = @($requiredDlls | ForEach-Object { $_.ToLowerInvariant() })
$windowsSystemDlls = @(
  'advapi32.dll', 'bcrypt.dll', 'cfgmgr32.dll', 'combase.dll', 'comdlg32.dll', 'gdi32.dll',
  'kernel32.dll', 'ntdll.dll', 'ole32.dll', 'oleaut32.dll', 'rpcrt4.dll', 'sechost.dll',
  'shell32.dll', 'shlwapi.dll', 'user32.dll', 'winmm.dll', 'ws2_32.dll', 'ucrtbase.dll',
  'api-ms-win-core-file-l1-1-0.dll', 'api-ms-win-core-handle-l1-1-0.dll', 'api-ms-win-core-heap-l1-1-0.dll',
  'api-ms-win-core-libraryloader-l1-1-0.dll', 'api-ms-win-core-localization-l1-2-0.dll',
  'api-ms-win-core-processthreads-l1-1-0.dll', 'api-ms-win-core-synch-l1-2-0.dll',
  'api-ms-win-core-sysinfo-l1-1-0.dll', 'api-ms-win-core-timezone-l1-1-0.dll',
  'api-ms-win-crt-convert-l1-1-0.dll', 'api-ms-win-crt-heap-l1-1-0.dll',
  'api-ms-win-crt-locale-l1-1-0.dll', 'api-ms-win-crt-math-l1-1-0.dll',
  'api-ms-win-crt-runtime-l1-1-0.dll', 'api-ms-win-crt-stdio-l1-1-0.dll',
  'api-ms-win-crt-string-l1-1-0.dll', 'api-ms-win-crt-time-l1-1-0.dll',
  'api-ms-win-crt-utility-l1-1-0.dll'
)
$dependencyEvidence = @()
$binaries = @($segmenter) + @($requiredDlls | ForEach-Object { Join-Path $bundleRoot "bin\$_" })
foreach ($binary in $binaries) {
  $dependencyOutput = & $dumpbinPath /DEPENDENTS $binary 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'dependency_inspection_failed' }
  $binaryName = Split-Path -Leaf $binary
  $dependencyOutput | Set-Content -LiteralPath (Join-Path $evidenceRoot "dependencies-$binaryName.txt") -Encoding utf8
  foreach ($dependency in $dependencyOutput) {
    if ([string]$dependency -match '^\s+([A-Za-z0-9_.+-]+\.dll)\s*$') {
      $name = $Matches[1].ToLowerInvariant()
      $isVCRuntime = $name -match '^(vcruntime|msvcp|concrt)\d*.*\.dll$'
      $isWindowsSystem = $name -in $windowsSystemDlls -or $name -like 'api-ms-win-*.dll'
        -or (Test-Path -LiteralPath (Join-Path "$env:SystemRoot\System32" $name) -PathType Leaf)
      if ($name -notin $bundleDllNames -and ($isVCRuntime -or -not $isWindowsSystem)) {
        throw "unbundled_runtime_dependency:$name"
      }
      $dependencyEvidence += [ordered]@{ binary = $binaryName; dependency = $name; providedBy = $(if ($name -in $bundleDllNames) { 'bundle' } else { 'windows' }) }
    }
  }
}
$dependencyEvidence | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'vad-dependencies.json') -Encoding utf8

$files = Get-ChildItem -LiteralPath $bundleRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
  [ordered]@{
    relativePath = $_.FullName.Substring($bundleRoot.Length + 1).Replace('\', '/')
    byteLength = $_.Length
    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$report = [ordered]@{
  status = 'PASS'
  platform = 'win32'
  arch = 'x64'
  sourceCommit = $actualCommit
  buildMode = 'shared-cpu-ggml-native-off'
  jfkSpeechSegments = [int]$speechHeader[0].Groups[1].Value
  silenceSpeechSegments = [int]$silenceHeader[0].Groups[1].Value
  vadModelSha256 = $actualModelHash
  files = @($files)
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $evidenceRoot 'bundle-manifest.json') -Encoding utf8
Get-ChildItem -LiteralPath $bundleRoot -File -Recurse | Get-FileHash -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash.ToLowerInvariant())  $($_.Path.Substring($bundleRoot.Length + 1).Replace('\', '/'))" } |
  Set-Content -LiteralPath (Join-Path $evidenceRoot 'bundle-sha256.txt') -Encoding utf8
Write-Output 'Windows CPU VAD bundle and public speech/silence controls: PASS'
