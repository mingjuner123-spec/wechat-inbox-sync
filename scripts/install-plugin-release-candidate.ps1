param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateDirectory,

  [Parameter(Mandatory = $true)]
  [string]$TargetDirectory,

  [string]$RepositoryRoot = (Split-Path -Parent $PSScriptRoot),

  [switch]$TestFailAfterSecondEntry,

  [switch]$SkipObsidianProcessCheckForTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Resolve-FullPath {
  param([Parameter(Mandatory = $true)][string]$PathValue)
  return [System.IO.Path]::GetFullPath($PathValue).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
}

function Test-PathContainedBy {
  param(
    [Parameter(Mandatory = $true)][string]$Child,
    [Parameter(Mandatory = $true)][string]$Parent
  )
  $comparison = [System.StringComparison]::OrdinalIgnoreCase
  $childPath = Resolve-FullPath -PathValue $Child
  $parentPath = Resolve-FullPath -PathValue $Parent
  if ($childPath.Equals($parentPath, $comparison)) {
    return $true
  }
  return $childPath.StartsWith(
    $parentPath + [System.IO.Path]::DirectorySeparatorChar,
    $comparison
  )
}

function Assert-NoReparsePoint {
  param([Parameter(Mandatory = $true)][string]$PathValue)
  $current = Resolve-FullPath -PathValue $PathValue
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $attributes = [System.IO.File]::GetAttributes($current)
      if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Candidate install target cannot contain a symlink, junction, or reparse point: $current"
      }
    }
    $parent = [System.IO.Directory]::GetParent($current)
    if ($null -eq $parent) {
      break
    }
    $next = $parent.FullName
    if ($next -eq $current) {
      break
    }
    $current = $next
  }
}

function Assert-TestSwitchAllowed {
  if (($TestFailAfterSecondEntry -or $SkipObsidianProcessCheckForTest) `
      -and $env:WECHAT_INBOX_CANDIDATE_TEST -ne '1') {
    throw 'Candidate installer test switches require WECHAT_INBOX_CANDIDATE_TEST=1.'
  }
}

function Assert-TargetShape {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedTarget,
    [Parameter(Mandatory = $true)][string]$ResolvedRepository,
    [Parameter(Mandatory = $true)][string]$ResolvedCandidate
  )
  $pluginDirectory = [System.IO.DirectoryInfo]::new($ResolvedTarget)
  $pluginsDirectory = $pluginDirectory.Parent
  $obsidianDirectory = if ($null -ne $pluginsDirectory) { $pluginsDirectory.Parent } else { $null }
  if ($pluginDirectory.Name -ne 'wechat-inbox-sync' `
      -or $null -eq $pluginsDirectory `
      -or $pluginsDirectory.Name -ne 'plugins' `
      -or $null -eq $obsidianDirectory `
      -or $obsidianDirectory.Name -ne '.obsidian') {
    throw 'TargetDirectory must end with .obsidian\plugins\wechat-inbox-sync.'
  }
  if (Test-PathContainedBy -Child $ResolvedTarget -Parent $ResolvedRepository) {
    throw 'TargetDirectory cannot be inside the repository source.'
  }
  if (Test-PathContainedBy -Child $ResolvedTarget -Parent $ResolvedCandidate) {
    throw 'TargetDirectory cannot be inside the candidate directory.'
  }
  $artifactsRoot = Join-Path $ResolvedRepository '.artifacts'
  if (Test-PathContainedBy -Child $ResolvedTarget -Parent $artifactsRoot) {
    throw 'TargetDirectory cannot be inside the repository artifacts directory.'
  }
  Assert-NoReparsePoint -PathValue $ResolvedTarget
}

function Invoke-CandidateVerification {
  param(
    [Parameter(Mandatory = $true)][string]$ResolvedRepository,
    [Parameter(Mandatory = $true)][string]$ResolvedCandidate,
    [string]$InstalledDirectory = ''
  )
  $nodeCommand = Get-Command node -ErrorAction Stop
  $verifyScript = Join-Path $ResolvedRepository 'scripts\verify-plugin-release-candidate.js'
  $arguments = @(
    $verifyScript
    '--candidate'
    $ResolvedCandidate
  )
  if ($InstalledDirectory) {
    $arguments += @('--installed', $InstalledDirectory)
  }
  & $nodeCommand.Source @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Plugin candidate verification failed with exit code $LASTEXITCODE."
  }
}

Assert-TestSwitchAllowed

$resolvedCandidate = Resolve-FullPath -PathValue $CandidateDirectory
$resolvedTarget = Resolve-FullPath -PathValue $TargetDirectory
$resolvedRepository = Resolve-FullPath -PathValue $RepositoryRoot

if (-not (Test-Path -LiteralPath $resolvedCandidate -PathType Container)) {
  throw 'CandidateDirectory does not exist.'
}
if (-not (Test-Path -LiteralPath $resolvedRepository -PathType Container)) {
  throw 'RepositoryRoot does not exist.'
}

Assert-TargetShape `
  -ResolvedTarget $resolvedTarget `
  -ResolvedRepository $resolvedRepository `
  -ResolvedCandidate $resolvedCandidate

if (-not $SkipObsidianProcessCheckForTest) {
  $obsidianProcesses = @(Get-Process -Name 'Obsidian' -ErrorAction SilentlyContinue)
  if ($obsidianProcesses.Count -gt 0) {
    throw 'Close Obsidian before installing a local plugin candidate.'
  }
}

Invoke-CandidateVerification `
  -ResolvedRepository $resolvedRepository `
  -ResolvedCandidate $resolvedCandidate

$packageDirectory = Join-Path $resolvedCandidate 'package'
$managedNames = @(
  'main.js'
  'manifest.json'
  'styles.css'
  'versions.json'
  'README.md'
  'LICENSE'
  'local-asr'
  'local-ocr'
)

$targetParent = Split-Path -Parent $resolvedTarget
New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
New-Item -ItemType Directory -Force -Path $resolvedTarget | Out-Null

$transactionId = [Guid]::NewGuid().ToString('N')
$stagingDirectory = Join-Path $targetParent ".wechat-inbox-sync.stage-$transactionId"
$backupDirectory = Join-Path $targetParent ".wechat-inbox-sync.backup-$transactionId"
$promotedNames = New-Object System.Collections.Generic.List[string]
$backedUpNames = New-Object System.Collections.Generic.List[string]

try {
  New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
  New-Item -ItemType Directory -Path $backupDirectory | Out-Null

  foreach ($name in $managedNames) {
    $sourcePath = Join-Path $packageDirectory $name
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "Candidate package is missing managed entry: $name"
    }
    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $stagingDirectory $name) -Recurse
  }

  foreach ($name in $managedNames) {
    $targetPath = Join-Path $resolvedTarget $name
    if (Test-Path -LiteralPath $targetPath) {
      Move-Item -LiteralPath $targetPath -Destination (Join-Path $backupDirectory $name)
      $backedUpNames.Add($name)
    }
  }

  $promotionCount = 0
  foreach ($name in $managedNames) {
    Move-Item `
      -LiteralPath (Join-Path $stagingDirectory $name) `
      -Destination (Join-Path $resolvedTarget $name)
    $promotedNames.Add($name)
    $promotionCount += 1
    if ($TestFailAfterSecondEntry -and $promotionCount -eq 2) {
      throw 'Injected candidate installer failure after second managed entry.'
    }
  }

  Invoke-CandidateVerification `
    -ResolvedRepository $resolvedRepository `
    -ResolvedCandidate $resolvedCandidate `
    -InstalledDirectory $resolvedTarget

  Remove-Item -LiteralPath $backupDirectory -Recurse -Force
  Remove-Item -LiteralPath $stagingDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output 'Plugin release candidate installed and verified.'
} catch {
  $failure = $_
  foreach ($name in $promotedNames) {
    $promotedPath = Join-Path $resolvedTarget $name
    if (Test-Path -LiteralPath $promotedPath) {
      Remove-Item -LiteralPath $promotedPath -Recurse -Force
    }
  }
  foreach ($name in $backedUpNames) {
    $backupPath = Join-Path $backupDirectory $name
    if (Test-Path -LiteralPath $backupPath) {
      Move-Item -LiteralPath $backupPath -Destination (Join-Path $resolvedTarget $name)
    }
  }
  if (Test-Path -LiteralPath $stagingDirectory) {
    Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
  }
  if (Test-Path -LiteralPath $backupDirectory) {
    Remove-Item -LiteralPath $backupDirectory -Recurse -Force
  }
  throw $failure
}
