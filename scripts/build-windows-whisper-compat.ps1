[CmdletBinding()]
param(
  [string]$OutputDirectory = '',
  [string]$CmakePath = '',
  [string]$VsDevCmdPath = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# This package is intentionally built without optional x86 CPU extensions. It is
# downloaded only after the normal package exits with 0xC000001D.
$WhisperTag = 'v1.9.0'
$WhisperSourceArchiveUrl = 'https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.0.zip'
$ArchiveName = 'whisper-bin-x64-compat.zip'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot '..\output\windows-whisper-compat'
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$BuildDirectory = Join-Path $OutputDirectory 'build'
$PackageDirectory = Join-Path $OutputDirectory 'package'
$ArchivePath = Join-Path $OutputDirectory $ArchiveName
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-Executable {
  param([string]$Candidate, [string]$Label)
  $command = Get-Command -Name $Candidate -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "$Label was not found: $Candidate"
  }
  return $command.Source
}

function Resolve-VisualStudioDevCmd {
  param([string]$ExplicitPath)
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
      throw "Visual Studio developer command script was not found: $ExplicitPath"
    }
    return [System.IO.Path]::GetFullPath($ExplicitPath)
  }
  $candidates = @(
    'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat',
    'C:\Program Files\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }
  throw 'Visual Studio 2022 Build Tools with C++ desktop tools was not found. Pass -VsDevCmdPath explicitly.'
}

function Invoke-DeveloperCommand {
  param([string]$DeveloperCommand, [string]$Label)
  $commandLine = "call `"$resolvedVsDevCmd`" -arch=x64 -host_arch=x64 >nul && $DeveloperCommand"
  & $env:ComSpec '/d' '/s' '/c' $commandLine
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Disable-GgmlAssemblyInTemporarySource {
  param([string]$SourceRoot)
  $cmakeListsPath = Join-Path $SourceRoot 'ggml\CMakeLists.txt'
  $sourceText = [System.IO.File]::ReadAllText($cmakeListsPath)
  $asmProjectLine = 'project("ggml" C CXX ASM)'
  if ($sourceText.Contains($asmProjectLine)) {
    # CMake 4.1's Visual Studio ASM compiler probe crashes on some hosts. The
    # compatibility package deliberately excludes optional assembly paths.
    $sourceText = $sourceText.Replace($asmProjectLine, 'project("ggml" C CXX)')
    [System.IO.File]::WriteAllText($cmakeListsPath, $sourceText, $Utf8NoBom)
    return
  }
  if (-not $sourceText.Contains('project("ggml" C CXX)')) {
    throw "Unexpected ggml CMake project declaration: $cmakeListsPath"
  }
}

$resolvedVsDevCmd = Resolve-VisualStudioDevCmd -ExplicitPath $VsDevCmdPath
if ([string]::IsNullOrWhiteSpace($CmakePath)) {
  $CmakePath = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
}
$resolvedCmake = Resolve-Executable -Candidate $CmakePath -Label 'CMake'
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$sourceArchive = Join-Path ([System.IO.Path]::GetTempPath()) ('wechat-inbox-whispercpp-' + [Guid]::NewGuid().ToString('N') + '.zip')
$sourceExtractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('wechat-inbox-whispercpp-' + [Guid]::NewGuid().ToString('N'))
try {
  Invoke-WebRequest -UseBasicParsing -Uri $WhisperSourceArchiveUrl -OutFile $sourceArchive
  $sourceArchiveHash = (Get-FileHash -LiteralPath $sourceArchive -Algorithm SHA256).Hash
  New-Item -ItemType Directory -Path $sourceExtractRoot | Out-Null
  Expand-Archive -LiteralPath $sourceArchive -DestinationPath $sourceExtractRoot -Force
  $sourceRoot = Join-Path $sourceExtractRoot 'whisper.cpp-1.9.0'
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'CMakeLists.txt') -PathType Leaf)) {
    throw "Downloaded whisper.cpp archive did not contain the expected $WhisperTag source tree."
  }
  # whisper.cpp's CMake version logic expects a Git worktree. A local empty
  # repository is sufficient and never changes the downloaded upstream source.
  & (Resolve-Executable -Candidate 'git' -Label 'Git') init -q $sourceRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Could not initialize temporary whisper.cpp source metadata: $LASTEXITCODE"
  }
  Disable-GgmlAssemblyInTemporarySource -SourceRoot $sourceRoot

  Remove-Item -LiteralPath $BuildDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $PackageDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue

  $configureArguments = @(
    '-S', $sourceRoot,
    '-B', $BuildDirectory,
    '-G', 'Ninja',
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_C_COMPILER=cl',
    '-DCMAKE_CXX_COMPILER=cl',
    '-DWHISPER_BUILD_TESTS=OFF',
    '-DWHISPER_BUILD_EXAMPLES=ON',
    '-DGGML_NATIVE=OFF',
    '-DGGML_SSE42=OFF',
    '-DGGML_BMI2=OFF',
    '-DGGML_SSSE3=OFF',
    '-DGGML_SSE3=OFF',
    '-DGGML_AVX=OFF',
    '-DGGML_AVX2=OFF',
    '-DGGML_FMA=OFF',
    '-DGGML_F16C=OFF'
  ) | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
  Invoke-DeveloperCommand -DeveloperCommand (
    '"' + $resolvedCmake + '" ' + ($configureArguments -join ' ')
  ) -Label 'whisper.cpp compatibility configure'
  Invoke-DeveloperCommand -DeveloperCommand (
    '"' + $resolvedCmake + '" --build "' + $BuildDirectory + '" --target whisper-cli'
  ) -Label 'whisper.cpp compatibility build'

  $binDirectory = Join-Path $BuildDirectory 'bin'
  $whisperExecutable = Join-Path $binDirectory 'whisper-cli.exe'
  if (-not (Test-Path -LiteralPath $whisperExecutable -PathType Leaf)) {
    throw 'whisper.cpp compatibility build did not produce build\\bin\\whisper-cli.exe.'
  }
  New-Item -ItemType Directory -Force -Path $PackageDirectory | Out-Null
  Get-ChildItem -LiteralPath $binDirectory -File |
    Where-Object { $_.Extension -in @('.exe', '.dll') } |
    Copy-Item -Destination $PackageDirectory -Force
  Compress-Archive -Path (Join-Path $PackageDirectory '*') -DestinationPath $ArchivePath -CompressionLevel Optimal
  if (-not (Test-Path -LiteralPath $ArchivePath) -or (Get-Item -LiteralPath $ArchivePath).Length -lt 1MB) {
    throw "Compatibility archive was not created correctly: $ArchivePath"
  }
  Write-Output "sourceTag=$WhisperTag"
  Write-Output "sourceArchiveSha256=$sourceArchiveHash"
  Write-Output "archive=$ArchivePath"
  Write-Output "sha256=$((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash)"
} finally {
  if (Test-Path -LiteralPath $sourceArchive) {
    Remove-Item -LiteralPath $sourceArchive -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $sourceExtractRoot) {
    Remove-Item -LiteralPath $sourceExtractRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
