$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-vad-build-evidence.ps1')

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("windows-vad-build-gate-test-" + [guid]::NewGuid().ToString('N'))
$cachePath = Join-Path $testRoot 'CMakeCache.txt'
$projectRoot = Join-Path $testRoot 'examples\vad-speech-segments'
$projectPath = Join-Path $projectRoot 'whisper-vad-speech-segments.vcxproj'
New-Item -ItemType Directory -Force -Path $projectRoot | Out-Null

$cacheLines = @(
  'CMAKE_GENERATOR:INTERNAL=Visual Studio 17 2022',
  'CMAKE_CONFIGURATION_TYPES:STRING=Debug;Release;MinSizeRel;RelWithDebInfo',
  'CMAKE_MSVC_RUNTIME_LIBRARY:STRING=MultiThreaded',
  'GGML_NATIVE:BOOL=OFF', 'GGML_CUDA:BOOL=OFF', 'GGML_VULKAN:BOOL=OFF',
  'GGML_SYCL:BOOL=OFF', 'GGML_OPENCL:BOOL=OFF', 'GGML_HIP:BOOL=OFF',
  'GGML_METAL:BOOL=OFF', 'GGML_ACCELERATE:BOOL=OFF', 'GGML_AVX:BOOL=OFF',
  'GGML_WEBGPU:BOOL=OFF', 'GGML_MUSA:BOOL=OFF', 'GGML_OPENVINO:BOOL=OFF', 'GGML_HEXAGON:BOOL=OFF', 'GGML_RPC:BOOL=OFF',
  'GGML_AVX2:BOOL=OFF', 'GGML_AVX512:BOOL=OFF', 'GGML_AVX512_BF16:BOOL=OFF',
  'GGML_AVX512_VBMI:BOOL=OFF', 'GGML_AVX512_VNNI:BOOL=OFF', 'GGML_AVX_VNNI:BOOL=OFF',
  'GGML_FMA:BOOL=OFF', 'GGML_F16C:BOOL=OFF', 'GGML_BLAS:BOOL=OFF', 'GGML_OPENMP:BOOL=OFF',
  'GGML_AVAILABLE_BACKENDS:INTERNAL=ggml-cpu'
)
Set-Content -LiteralPath $cachePath -Value $cacheLines -Encoding ascii

function Write-TestProject {
  param(
    [Parameter(Mandatory)][AllowEmptyString()][string]$Optimization,
    [Parameter(Mandatory)][string]$Definitions,
    [string]$RuntimeLibrary = 'MultiThreaded'
  )

  $xml = @(
    '<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">',
    '  <ItemDefinitionGroup Condition="''$(Configuration)|$(Platform)''==''Release|x64''">',
    '    <ClCompile>',
    "      <Optimization>$Optimization</Optimization>",
    "      <PreprocessorDefinitions>$Definitions</PreprocessorDefinitions>",
    "      <RuntimeLibrary>$RuntimeLibrary</RuntimeLibrary>",
    '      <AdditionalOptions>%(AdditionalOptions) /utf-8</AdditionalOptions>',
    '    </ClCompile>',
    '  </ItemDefinitionGroup>',
    '</Project>'
  )
  Set-Content -LiteralPath $projectPath -Value $xml -Encoding utf8
}

Write-TestProject -Optimization 'MaxSpeed' -Definitions 'GGML_USE_CPU;NDEBUG;%(PreprocessorDefinitions)'
$valid = Get-WindowsVadBuildConfigurationEvidence -BuildRoot $testRoot
if ($valid.status -ne 'PASS' -or $valid.generator -ne 'Visual Studio 17 2022' -or $valid.releaseCxxProjects.Count -ne 1) {
  throw 'valid_release_fixture_not_accepted'
}

Write-TestProject -Optimization '' -Definitions 'GGML_USE_CPU;%(PreprocessorDefinitions)'
$missingFlagsRejected = $false
try {
  Get-WindowsVadBuildConfigurationEvidence -BuildRoot $testRoot | Out-Null
} catch {
  $missingFlagsRejected = $_.Exception.Message -match 'windows_vad_build_gate_release_optimization_missing'
}
if (-not $missingFlagsRejected) { throw 'empty_release_flags_fixture_was_not_rejected' }

Write-TestProject -Optimization 'MaxSpeed' -Definitions 'GGML_USE_CPU;%(PreprocessorDefinitions)'
$missingNdebugRejected = $false
try {
  Get-WindowsVadBuildConfigurationEvidence -BuildRoot $testRoot | Out-Null
} catch {
  $missingNdebugRejected = $_.Exception.Message -match 'windows_vad_build_gate_ndebug_missing'
}
if (-not $missingNdebugRejected) { throw 'missing_ndebug_fixture_was_not_rejected' }

Write-TestProject -Optimization 'MaxSpeed' -Definitions 'GGML_USE_CPU;NDEBUG;%(PreprocessorDefinitions)' -RuntimeLibrary 'MultiThreadedDLL'
$runtimeRejected = $false
try {
  Get-WindowsVadBuildConfigurationEvidence -BuildRoot $testRoot | Out-Null
} catch {
  $runtimeRejected = $_.Exception.Message -match 'windows_vad_build_gate_project_runtime_mismatch'
}
if (-not $runtimeRejected) { throw 'dynamic_runtime_fixture_was_not_rejected' }

$cacheText = Get-Content -LiteralPath $cachePath -Raw
$cacheText = $cacheText.Replace('GGML_AVX2:BOOL=OFF', 'GGML_AVX2:BOOL=ON')
Set-Content -LiteralPath $cachePath -Value $cacheText -Encoding ascii
$cpuMismatchRejected = $false
try {
  Get-WindowsVadBuildConfigurationEvidence -BuildRoot $testRoot | Out-Null
} catch {
  $cpuMismatchRejected = $_.Exception.Message -match 'windows_vad_build_gate_cpu_setting_enabled:GGML_AVX2'
}
if (-not $cpuMismatchRejected) { throw 'cpu_feature_fixture_was_not_rejected' }

Write-Output 'Windows VAD build evidence parser fixtures: PASS (Release accepted; missing optimization/NDEBUG, runtime mismatch, and enabled CPU feature rejected)'

$resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
$resolvedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $resolvedTestRoot.StartsWith($resolvedTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'test_fixture_cleanup_path_unexpected'
}
Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
