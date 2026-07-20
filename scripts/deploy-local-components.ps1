[CmdletBinding()]
param(
    [switch]$Execute,
    [string]$TcbPath,
    [string]$NodePath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$CloudBaseEnvironment = 'he02-d8gebzv050ed6c4ef-d350b93bf'
$PublicRoot = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com'
$PublicManifestPath = 'local-components/manifest.json'
$PublicFetchTimeoutSeconds = 20
$PublicFetchAttempts = 5
$ImmutableRecheckDelayMilliseconds = 500
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PluginRoot = Join-Path $RepoRoot 'obsidian-plugin\wechat-inbox-sync'
$ManifestPath = Join-Path $PluginRoot 'local-components-manifest.json'
$ManifestCheckerPath = Join-Path $RepoRoot 'scripts\update-local-components-manifest.js'
$SourceGuardPath = Join-Path $RepoRoot 'scripts\release-source-guard.js'
$GenericVerifierPath = Join-Path $RepoRoot 'scripts\check-local-components-cdn.js'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$StrictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)

function Resolve-CommandPath {
    param(
        [string]$ExplicitPath,
        [string[]]$CommandNames,
        [string]$Label
    )
    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $explicitCommand = Get-Command -Name $ExplicitPath -ErrorAction SilentlyContinue
        if ($null -eq $explicitCommand) {
            throw "$Label was not found at or as '$ExplicitPath'."
        }
        return $explicitCommand.Source
    }
    foreach ($commandName in $CommandNames) {
        $command = Get-Command -Name $commandName -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            return $command.Source
        }
    }
    throw "$Label was not found. Pass its explicit path."
}

function Invoke-ExternalCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Label
    )
    $output = @(& $FilePath @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $text = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    if ($exitCode -ne 0) {
        throw "$Label failed with exit code $exitCode. $text"
    }
    return $text
}

function Test-TemporaryFileContained {
    param([string]$Candidate)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $tempRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $tempRoot += [System.IO.Path]::DirectorySeparatorChar
    }
    $fullCandidate = [System.IO.Path]::GetFullPath($Candidate)
    return $fullCandidate.StartsWith(
        $tempRoot,
        [System.StringComparison]::OrdinalIgnoreCase
    ) -and (Split-Path -Leaf $fullCandidate).StartsWith(
        'wechat-tcb-stderr-',
        [System.StringComparison]::Ordinal
    )
}

function Invoke-JsonExternalCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$Label
    )
    $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) (
        'wechat-tcb-stderr-' + [Guid]::NewGuid().ToString('N') + '.tmp'
    )
    if (-not (Test-TemporaryFileContained -Candidate $stderrPath)) {
        throw "Refusing uncontained JSON-command stderr path: $stderrPath"
    }
    try {
        $previousErrorPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $stdout = @(& $FilePath @Arguments 2> $stderrPath)
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorPreference
        }
        $stdoutText = ($stdout | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        $stderrText = $(if (Test-Path -LiteralPath $stderrPath) {
            [System.IO.File]::ReadAllText($stderrPath)
        } else {
            ''
        })
        if ($exitCode -ne 0) {
            throw "$Label failed with exit code $exitCode. stderr: $stderrText"
        }
        return $stdoutText
    }
    finally {
        if (
            (Test-Path -LiteralPath $stderrPath) -and
            (Test-TemporaryFileContained -Candidate $stderrPath)
        ) {
            Remove-Item -LiteralPath $stderrPath -Force
        }
    }
}

function Invoke-ManifestCheck {
    param([string]$ResolvedNodePath)
    [void](Invoke-ExternalCommand -FilePath $ResolvedNodePath `
        -Arguments @($ManifestCheckerPath, '--check') `
        -Label 'local component manifest check')
}

function Read-ValidatedManifest {
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "Committed local component manifest is missing: $ManifestPath"
    }
    $manifestText = [System.IO.File]::ReadAllText($ManifestPath, $StrictUtf8)
    try {
        $manifestObject = $manifestText | ConvertFrom-Json
    }
    catch {
        throw "Committed local component manifest is invalid JSON: $($_.Exception.Message)"
    }
    if ($manifestObject.schemaVersion -ne 1 -or $null -eq $manifestObject.assets) {
        throw 'Committed local component manifest does not satisfy schemaVersion 1.'
    }
    return $manifestObject
}

function Get-BytesSha256 {
    param([byte[]]$Bytes)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-FileSha256 {
    param([string]$LiteralPath)
    return Get-BytesSha256 -Bytes ([System.IO.File]::ReadAllBytes($LiteralPath))
}

function Assert-NoReparsePoint {
    param(
        [string]$Root,
        [string]$RelativePath
    )
    $current = [System.IO.Path]::GetFullPath($Root)
    foreach ($segment in ($RelativePath -split '/')) {
        $current = Join-Path $current $segment
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Source contains a symbolic link or reparse point: $RelativePath"
        }
    }
}

function Test-TempRootContained {
    param([string]$Candidate)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $tempRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $tempRoot += [System.IO.Path]::DirectorySeparatorChar
    }
    $fullCandidate = [System.IO.Path]::GetFullPath($Candidate)
    $leaf = Split-Path -Leaf $fullCandidate
    return $fullCandidate.StartsWith(
        $tempRoot,
        [System.StringComparison]::OrdinalIgnoreCase
    ) -and $leaf.StartsWith(
        'wechat-local-components-',
        [System.StringComparison]::Ordinal
    )
}

function New-VerifiedStagingTree {
    param([object]$ManifestObject)
    $stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
        'wechat-local-components-' + [Guid]::NewGuid().ToString('N')
    )
    $stageRoot = [System.IO.Path]::GetFullPath($stageRoot)
    if (-not (Test-TempRootContained -Candidate $stageRoot)) {
        throw "Refusing to create an uncontained staging tree: $stageRoot"
    }
    [void](New-Item -ItemType Directory -Path $stageRoot)
    $stagedById = @{}
    try {
        $committedManifestBytes = [System.IO.File]::ReadAllBytes($ManifestPath)
        $stagedManifestPath = Join-Path $stageRoot 'local-components-manifest.json'
        [System.IO.File]::WriteAllBytes($stagedManifestPath, $committedManifestBytes)
        $stagedManifestHash = Get-FileSha256 -LiteralPath $stagedManifestPath
        foreach ($component in $ManifestObject.assets) {
            $relativeSource = [string]$component.sourcePath
            Assert-NoReparsePoint -Root $PluginRoot -RelativePath $relativeSource
            $sourcePath = [System.IO.Path]::GetFullPath((
                Join-Path $PluginRoot ($relativeSource -replace '/', '\')
            ))
            $sourceBytes = [System.IO.File]::ReadAllBytes($sourcePath)
            $sourceText = $StrictUtf8.GetString($sourceBytes)
            if ($sourceText.Length -gt 0 -and $sourceText[0] -eq [char]0xFEFF) {
                $sourceText = $sourceText.Substring(1)
            }
            $sourceText = $sourceText.Replace("`r`n", "`n").Replace("`r", "`n")
            $assetDirectory = Join-Path $stageRoot ([string]$component.id)
            [void](New-Item -ItemType Directory -Path $assetDirectory)
            $stagedPath = Join-Path $assetDirectory ([System.IO.Path]::GetFileName($relativeSource))
            [System.IO.File]::WriteAllText($stagedPath, $sourceText, $Utf8NoBom)
            $stagedHash = Get-FileSha256 -LiteralPath $stagedPath
            if ($stagedHash -ne [string]$component.sha256) {
                throw (
                    "Canonical staging hash mismatch for $relativeSource " +
                    "(manifest $($component.sha256), staged $stagedHash)."
                )
            }
            $stagedById[[string]$component.id] = $stagedPath
        }
        return @{
            Root = $stageRoot
            ById = $stagedById
            ManifestPath = $stagedManifestPath
            ManifestHash = $stagedManifestHash
        }
    }
    catch {
        if ((Test-Path -LiteralPath $stageRoot) -and (Test-TempRootContained -Candidate $stageRoot)) {
            Remove-Item -LiteralPath $stageRoot -Recurse -Force
        }
        throw
    }
}

function Find-JsonValue {
    param([string]$Text)
    for ($start = 0; $start -lt $Text.Length; $start++) {
        if ($Text[$start] -ne '{' -and $Text[$start] -ne '[') {
            continue
        }
        for ($end = $Text.Length; $end -gt $start; $end--) {
            $candidate = $Text.Substring($start, $end - $start).Trim()
            try {
                $parsed = $candidate | ConvertFrom-Json
                return [pscustomobject]@{
                    Value = $parsed
                    IsArray = $candidate.StartsWith('[')
                }
            }
            catch {
                # Noisy tcb output is allowed around JSON, never instead of JSON.
            }
        }
    }
    throw 'CloudBase --json output did not contain valid JSON; failing closed.'
}

function Assert-CloudListDocument {
    param([object]$Document)
    if ($null -eq $Document -or $null -eq $Document.PSObject.Properties['IsArray']) {
        throw 'CloudBase list JSON document is missing parser metadata.'
    }
    if ($Document.IsArray) {
        throw 'CloudBase hosting list must return the documented top-level envelope, not an array.'
    }
    $value = $Document.Value
    if ($value -isnot [pscustomobject]) {
        throw 'CloudBase hosting list envelope must be an object.'
    }
    foreach ($errorPropertyName in @('error', 'name', 'message')) {
        if ($null -ne $value.PSObject.Properties[$errorPropertyName]) {
            throw "CloudBase hosting list returned an error payload containing $errorPropertyName."
        }
    }
    $codeProperty = $value.PSObject.Properties['code']
    if (
        $null -ne $codeProperty -and
        $null -ne $codeProperty.Value -and
        [string]$codeProperty.Value -notin @('', '0')
    ) {
        throw "CloudBase hosting list returned an error code: $($codeProperty.Value)."
    }
    $successProperty = $value.PSObject.Properties['success']
    if ($null -ne $successProperty -and $successProperty.Value -eq $false) {
        throw 'CloudBase hosting list returned an error payload with success=false.'
    }
    $topLevelKeys = @($value.PSObject.Properties.Name | Sort-Object)
    if (
        $topLevelKeys.Count -ne 2 -or
        $topLevelKeys[0] -ne 'data' -or
        $topLevelKeys[1] -ne 'meta'
    ) {
        throw 'CloudBase hosting list envelope must contain exactly data and meta.'
    }
    if ($value.data -isnot [System.Array]) {
        throw 'CloudBase hosting list envelope data must be an array.'
    }
    if ($value.meta -isnot [pscustomobject]) {
        throw 'CloudBase hosting list envelope meta must be an object.'
    }
}

function Find-ExactRemoteObjects {
    param(
        [object]$Value,
        [string]$RemotePath,
        [System.Collections.ArrayList]$Matches
    )
    if ($null -eq $Value) {
        return
    }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        foreach ($entry in $Value) {
            Find-ExactRemoteObjects -Value $entry -RemotePath $RemotePath -Matches $Matches
        }
        return
    }
    if ($Value -is [pscustomobject]) {
        foreach ($property in $Value.PSObject.Properties) {
            if (
                ($property.Name -in @('key', 'Key', 'path', 'Path', 'name', 'Name', 'fileKey')) -and
                ($property.Value -is [string]) -and
                (([string]$property.Value).TrimStart('/') -eq $RemotePath.TrimStart('/'))
            ) {
                [void]$Matches.Add($Value)
                break
            }
        }
        foreach ($property in $Value.PSObject.Properties) {
            if ($property.Value -isnot [string]) {
                Find-ExactRemoteObjects -Value $property.Value -RemotePath $RemotePath -Matches $Matches
            }
        }
    }
}

function Get-RemoteObjectState {
    param(
        [string]$ResolvedTcbPath,
        [string]$RemotePath
    )
    $jsonOutput = Invoke-JsonExternalCommand -FilePath $ResolvedTcbPath `
        -Arguments @('hosting', 'list', $RemotePath, '--json', '-e', $CloudBaseEnvironment) `
        -Label "CloudBase hosting list for $RemotePath"
    $document = Find-JsonValue -Text $jsonOutput
    Assert-CloudListDocument -Document $document
    $matches = New-Object System.Collections.ArrayList
    Find-ExactRemoteObjects -Value $document.Value.data -RemotePath $RemotePath -Matches $matches
    if ($matches.Count -gt 1) {
        throw "CloudBase JSON returned more than one exact remote key for $RemotePath."
    }
    return @{
        Exists = ($matches.Count -eq 1)
        Object = $(if ($matches.Count -eq 1) { $matches[0] } else { $null })
    }
}

function Publish-CloudObject {
    param(
        [string]$ResolvedTcbPath,
        [string]$LocalPath,
        [string]$RemotePath
    )
    [void](Invoke-ExternalCommand -FilePath $ResolvedTcbPath `
        -Arguments @('hosting', 'deploy', $LocalPath, $RemotePath, '-e', $CloudBaseEnvironment) `
        -Label "CloudBase hosting deploy for $RemotePath")
}

function Verify-CloudObject {
    param(
        [string]$ResolvedTcbPath,
        [string]$RemotePath,
        [string]$ExpectedHash,
        [string]$DownloadRoot,
        [string]$Label
    )
    $downloadPath = Join-Path $DownloadRoot (
        ([Guid]::NewGuid().ToString('N')) + '-' + [System.IO.Path]::GetFileName($RemotePath)
    )
    [void](Invoke-ExternalCommand -FilePath $ResolvedTcbPath `
        -Arguments @('hosting', 'download', $RemotePath, $downloadPath, '-e', $CloudBaseEnvironment) `
        -Label "CloudBase hosting download for $RemotePath")
    if (-not (Test-Path -LiteralPath $downloadPath -PathType Leaf)) {
        throw "CloudBase download did not produce $downloadPath for $RemotePath."
    }
    $downloadHash = Get-FileSha256 -LiteralPath $downloadPath
    if ($downloadHash -ne $ExpectedHash) {
        throw "$Label mismatch for $RemotePath (expected $ExpectedHash, CloudBase $downloadHash)."
    }
}

function Verify-PublicObject {
    param(
        [string]$RemotePath,
        [string]$ExpectedHash,
        [string]$Label
    )
    Add-Type -AssemblyName System.Net.Http
    $lastError = $null
    for ($attempt = 1; $attempt -le $PublicFetchAttempts; $attempt++) {
        $client = New-Object System.Net.Http.HttpClient
        try {
            $client.Timeout = [TimeSpan]::FromSeconds($PublicFetchTimeoutSeconds)
            $client.DefaultRequestHeaders.CacheControl = New-Object System.Net.Http.Headers.CacheControlHeaderValue
            $client.DefaultRequestHeaders.CacheControl.NoCache = $true
            $separator = $(if ($RemotePath.Contains('?')) { '&' } else { '?' })
            $url = "$PublicRoot/$RemotePath${separator}release_check=$([Guid]::NewGuid().ToString('N'))"
            $publicBytes = $client.GetByteArrayAsync($url).GetAwaiter().GetResult()
            $publicHash = Get-BytesSha256 -Bytes $publicBytes
            if ($publicHash -ne $ExpectedHash) {
                throw "$Label mismatch for $RemotePath (expected $ExpectedHash, public $publicHash)."
            }
            return
        }
        catch {
            $lastError = $_
            if ($attempt -lt $PublicFetchAttempts) {
                Start-Sleep -Seconds ([Math]::Pow(2, $attempt))
            }
        }
        finally {
            $client.Dispose()
        }
    }
    throw "Public verification failed for $RemotePath after $PublicFetchAttempts attempts: $lastError"
}

function Invoke-ReleaseSourceGuard {
    param(
        [string]$ResolvedNodePath,
        [string]$Phase
    )
    [void](Invoke-ExternalCommand -FilePath $ResolvedNodePath `
        -Arguments @($SourceGuardPath, '--deploy') `
        -Label "release source guard ($Phase)")
}

function Invoke-GenericVerifier {
    param([string]$ResolvedNodePath)
    [void](Invoke-ExternalCommand -FilePath $ResolvedNodePath `
        -Arguments @($GenericVerifierPath) `
        -Label 'generic local component CDN verifier')
}

if ($MyInvocation.InvocationName -eq '.') {
    return
}

$resolvedNode = Resolve-CommandPath -ExplicitPath $NodePath -CommandNames @('node.exe', 'node') -Label 'Node.js'
Invoke-ManifestCheck -ResolvedNodePath $resolvedNode
$manifest = Read-ValidatedManifest

if (-not $Execute) {
    Write-Output 'DRY RUN: controlled local component CDN deployment'
    Write-Output "Environment: $CloudBaseEnvironment"
    Write-Output "Public root: $PublicRoot"
    foreach ($component in $manifest.assets) {
        Write-Output "IMMUTABLE verify-or-create: $($component.immutablePath) <- $($component.sourcePath) [$($component.sha256)]"
    }
    foreach ($component in $manifest.assets) {
        Write-Output "ALIAS publish-after-guard: $($component.compatibilityAlias) <- $($component.sourcePath) [$($component.sha256)]"
    }
    Write-Output "MANIFEST publish-last: $PublicManifestPath <- obsidian-plugin/wechat-inbox-sync/local-components-manifest.json"
    Write-Output 'DRY RUN complete. No Git remote check, tcb command, upload, or public network request was performed.'
    return
}

$resolvedTcb = Resolve-CommandPath `
    -ExplicitPath $(if ($TcbPath) { $TcbPath } elseif ($env:TCB_CLI) { $env:TCB_CLI } else { $null }) `
    -CommandNames @('tcb.cmd', 'tcb') `
    -Label 'CloudBase tcb CLI'

$staging = $null
try {
    $staging = New-VerifiedStagingTree -ManifestObject $manifest
    Invoke-ReleaseSourceGuard -ResolvedNodePath $resolvedNode -Phase 'pre-immutable'
    $downloadRoot = Join-Path $staging.Root 'downloads'
    [void](New-Item -ItemType Directory -Path $downloadRoot)

    foreach ($asset in $manifest.assets) {
        $remotePath = [string]$asset.immutablePath
        $expectedHash = [string]$asset.sha256
        $state = Get-RemoteObjectState -ResolvedTcbPath $resolvedTcb -RemotePath $remotePath
        if ($state.Exists) {
            Write-Output "Immutable object already exists; verifying without overwrite: $remotePath"
        }
        else {
            Start-Sleep -Milliseconds $ImmutableRecheckDelayMilliseconds
            $secondState = Get-RemoteObjectState `
                -ResolvedTcbPath $resolvedTcb -RemotePath $remotePath
            if ($secondState.Exists) {
                Write-Output "Immutable object appeared during recheck; verifying without overwrite: $remotePath"
            }
            else {
                # Installed tcb hosting CLI 3.5.9 has no conditional-create flag.
                # Same-release concurrent content-addressed writes should be identical;
                # differing concurrent bytes fail the mandatory download verification below.
                Publish-CloudObject -ResolvedTcbPath $resolvedTcb `
                    -LocalPath $staging.ById[[string]$asset.id] -RemotePath $remotePath
            }
        }
        Verify-CloudObject -ResolvedTcbPath $resolvedTcb -RemotePath $remotePath `
            -ExpectedHash $expectedHash -DownloadRoot $downloadRoot `
            -Label 'immutable object mismatch'
        Verify-PublicObject -RemotePath $remotePath -ExpectedHash $expectedHash `
            -Label 'immutable public object'
    }

    Invoke-ReleaseSourceGuard -ResolvedNodePath $resolvedNode -Phase 'pre-alias'

    foreach ($asset in $manifest.assets) {
        $remotePath = [string]$asset.compatibilityAlias
        $expectedHash = [string]$asset.sha256
        Publish-CloudObject -ResolvedTcbPath $resolvedTcb `
            -LocalPath $staging.ById[[string]$asset.id] -RemotePath $remotePath
        Verify-CloudObject -ResolvedTcbPath $resolvedTcb -RemotePath $remotePath `
            -ExpectedHash $expectedHash -DownloadRoot $downloadRoot `
            -Label 'compatibility alias'
        Verify-PublicObject -RemotePath $remotePath -ExpectedHash $expectedHash `
            -Label 'compatibility alias'
    }

    $manifestHash = $staging.ManifestHash
    Publish-CloudObject -ResolvedTcbPath $resolvedTcb `
        -LocalPath $staging.ManifestPath -RemotePath $PublicManifestPath
    Verify-CloudObject -ResolvedTcbPath $resolvedTcb -RemotePath $PublicManifestPath `
        -ExpectedHash $manifestHash -DownloadRoot $downloadRoot `
        -Label 'public manifest exact bytes'
    Verify-PublicObject -RemotePath $PublicManifestPath -ExpectedHash $manifestHash `
        -Label 'public manifest exact bytes'

    Invoke-GenericVerifier -ResolvedNodePath $resolvedNode
    Invoke-ReleaseSourceGuard -ResolvedNodePath $resolvedNode -Phase 'final'
    Write-Output 'Controlled local component CDN deployment and verification completed.'
}
finally {
    if (
        ($null -ne $staging) -and
        (Test-Path -LiteralPath $staging.Root) -and
        (Test-TempRootContained -Candidate $staging.Root)
    ) {
        Remove-Item -LiteralPath $staging.Root -Recurse -Force
    }
}
