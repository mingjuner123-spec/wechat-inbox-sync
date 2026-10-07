function Read-WindowsVadCMakeCache {
  param([Parameter(Mandatory)][string]$CachePath)

  if (-not (Test-Path -LiteralPath $CachePath -PathType Leaf)) {
    throw 'windows_vad_build_gate_cache_missing'
  }

  $values = @{}
  foreach ($line in (Get-Content -LiteralPath $CachePath)) {
    if ($line -match '^(?<key>[^:#/][^=]*):[^=]*=(?<value>.*)$') {
      $values[$Matches.key.Trim()] = $Matches.value.Trim()
    }
  }
  return $values
}

function Test-WindowsVadReleaseFlags {
  param(
    [Parameter(Mandatory)][AllowEmptyString()][string]$Optimization,
    [Parameter(Mandatory)][string]$Definitions,
    [Parameter(Mandatory)][string]$AdditionalOptions
  )

  $optimizedProperty = $Optimization.Trim() -match '^(?i:MaxSpeed|MinSpace|Full)$'
  $optimizedFlag = $AdditionalOptions -match '(?i)(?:^|\s)/(?:O[12]|Ox)(?:\s|$)'
  $hasNdebug = $Definitions -match '(?i)(?:^|[;,\s])NDEBUG(?:[=;,\s]|$)' -or
    $AdditionalOptions -match '(?i)(?:^|\s)/(?:D|d)NDEBUG(?:\s|$)'

  return [ordered]@{
    optimizationEnabled = [bool]($optimizedProperty -or $optimizedFlag)
    optimizationProperty = $Optimization.Trim()
    ndebugEnabled = [bool]$hasNdebug
  }
}

function Get-WindowsVadBuildConfigurationEvidence {
  param([Parameter(Mandatory)][string]$BuildRoot)

  $cache = Read-WindowsVadCMakeCache -CachePath (Join-Path $BuildRoot 'CMakeCache.txt')
  $generator = [string]$cache['CMAKE_GENERATOR']
  if ([string]::IsNullOrWhiteSpace($generator)) { throw 'windows_vad_build_gate_generator_missing' }

  $configurationTypes = [string]$cache['CMAKE_CONFIGURATION_TYPES']
  $buildType = [string]$cache['CMAKE_BUILD_TYPE']
  $isMultiConfig = -not [string]::IsNullOrWhiteSpace($configurationTypes)
  $hasRelease = if ($isMultiConfig) {
    @($configurationTypes -split ';' | ForEach-Object { $_.Trim() }) -contains 'Release'
  } else {
    $buildType -eq 'Release'
  }
  if (-not $hasRelease) { throw 'windows_vad_build_gate_release_configuration_missing' }

  $runtime = [string]$cache['CMAKE_MSVC_RUNTIME_LIBRARY']
  if ($runtime -ne 'MultiThreaded') { throw 'windows_vad_build_gate_static_runtime_required' }

  $cpuOptions = @(
    'GGML_NATIVE', 'GGML_CUDA', 'GGML_VULKAN', 'GGML_SYCL', 'GGML_OPENCL', 'GGML_HIP',
    'GGML_METAL', 'GGML_ACCELERATE', 'GGML_WEBGPU', 'GGML_MUSA', 'GGML_OPENVINO',
    'GGML_HEXAGON', 'GGML_RPC', 'GGML_AVX', 'GGML_AVX2', 'GGML_AVX512',
    'GGML_AVX512_BF16', 'GGML_AVX512_VBMI', 'GGML_AVX512_VNNI', 'GGML_AVX_VNNI',
    'GGML_FMA', 'GGML_F16C', 'GGML_BLAS', 'GGML_OPENMP'
  )
  $cpuSettings = [ordered]@{}
  foreach ($name in $cpuOptions) {
    if (-not $cache.ContainsKey($name)) { throw "windows_vad_build_gate_cpu_setting_missing:$name" }
    $value = [string]$cache[$name]
    if ($value -notmatch '^(?i:OFF|FALSE|0)$') { throw "windows_vad_build_gate_cpu_setting_enabled:$name" }
    $cpuSettings[$name] = $value
  }
  $availableBackends = [string]$cache['GGML_AVAILABLE_BACKENDS']
  if ($availableBackends -ne 'ggml-cpu') { throw 'windows_vad_build_gate_non_cpu_backend_present' }

  $releaseProjects = @()
  if ($generator -match '^Visual Studio ') {
    $projects = @(Get-ChildItem -LiteralPath $BuildRoot -Filter '*.vcxproj' -File -Recurse |
      Where-Object { $_.Name -notin @('ALL_BUILD.vcxproj', 'ZERO_CHECK.vcxproj', 'INSTALL.vcxproj') })
    foreach ($project in $projects) {
      [xml]$xml = Get-Content -LiteralPath $project.FullName -Raw
      $releaseGroups = @($xml.SelectNodes("//*[local-name()='ItemDefinitionGroup']") |
        Where-Object { [string]$_.Condition -match "(?i)Release\|x64" })
      foreach ($group in $releaseGroups) {
        foreach ($compile in @($group.SelectNodes("./*[local-name()='ClCompile']"))) {
          $result = Test-WindowsVadReleaseFlags `
            -Optimization ([string]$compile.Optimization) `
            -Definitions ([string]$compile.PreprocessorDefinitions) `
            -AdditionalOptions ([string]$compile.AdditionalOptions)
          $runtimeProperty = ([string]$compile.RuntimeLibrary).Trim()
          $record = [ordered]@{
            project = $project.Name
            optimizationProperty = $result.optimizationProperty
            optimizationEnabled = $result.optimizationEnabled
            ndebugEnabled = $result.ndebugEnabled
            runtimeLibrary = $runtimeProperty
          }
          $releaseProjects += [pscustomobject]$record
          if (-not $result.optimizationEnabled) { throw "windows_vad_build_gate_release_optimization_missing:$($project.Name)" }
          if (-not $result.ndebugEnabled) { throw "windows_vad_build_gate_ndebug_missing:$($project.Name)" }
          if ($runtimeProperty -ne 'MultiThreaded') { throw "windows_vad_build_gate_project_runtime_mismatch:$($project.Name)" }
        }
      }
    }
    if ($releaseProjects.Count -eq 0) { throw 'windows_vad_build_gate_release_project_evidence_missing' }
  } elseif ($generator -match '^Ninja') {
    $commandsPath = Join-Path $BuildRoot 'compile_commands.json'
    if (-not (Test-Path -LiteralPath $commandsPath -PathType Leaf)) { throw 'windows_vad_build_gate_compile_commands_missing' }
    $commands = @(Get-Content -LiteralPath $commandsPath -Raw | ConvertFrom-Json)
    $cxxCommands = @($commands | Where-Object { [string]$_.file -match '(?i)\.(cc|cpp|cxx|c\+\+)$' })
    if ($cxxCommands.Count -eq 0) { throw 'windows_vad_build_gate_cxx_commands_missing' }
    foreach ($entry in $cxxCommands) {
      $command = [string]$entry.command
      if ($command -notmatch '(?i)(?:^|\s)/(?:O[12]|Ox)(?:\s|$)') { throw 'windows_vad_build_gate_release_optimization_missing' }
      if ($command -notmatch '(?i)(?:^|\s)/(?:D|d)NDEBUG(?:\s|$)') { throw 'windows_vad_build_gate_ndebug_missing' }
      if ($command -notmatch '(?i)(?:^|\s)(?:-|/)MT(?:\s|$)' -or $command -match '(?i)(?:^|\s)(?:-|/)MDd?(?:\s|$)') {
        throw 'windows_vad_build_gate_actual_static_runtime_missing'
      }
    }
    $releaseProjects += [pscustomobject]@{
      project = 'compile_commands.json'
      cxxCommandCount = $cxxCommands.Count
      optimizationEnabled = $true
      ndebugEnabled = $true
      runtimeLibrary = $runtime
    }
  } else {
    throw 'windows_vad_build_gate_unsupported_generator'
  }

  return [ordered]@{
    status = 'PASS'
    generator = $generator
    configuration = 'Release'
    configurationEvidence = $(if ($isMultiConfig) { 'CMAKE_CONFIGURATION_TYPES' } else { 'CMAKE_BUILD_TYPE' })
    runtimeLibrary = $runtime
    availableBackends = $availableBackends
    releaseCxxProjects = @($releaseProjects)
    cpuSettings = $cpuSettings
  }
}
