param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE ".wechat-inbox-local-ocr")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonScript = Join-Path $ScriptDir "ocr_image.py"
$ActiveVenvDir = Join-Path $InstallRoot "venv"
$StagingVenvDir = Join-Path $InstallRoot "venv-staging"
$BackupVenvDir = Join-Path $InstallRoot "venv-backup"
$PendingSwitchPath = Join-Path $InstallRoot "pending-venv-switch.json"
$VenvDir = $StagingVenvDir
$InstallerCapability = "single-dir-transaction-v1"
$RuntimeScript = Join-Path $InstallRoot "ocr_image.py"
$LogPath = Join-Path $InstallRoot "install.log"
$BinDir = Join-Path $InstallRoot "bin"
$CacheDir = Join-Path $InstallRoot "cache"
$PythonRuntimeDir = Join-Path $InstallRoot "python-runtime"
$Headers = @{ "User-Agent" = "wechat-inbox-sync-local-ocr-installer" }
$TencentOcrAssetBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common"
$TencentPythonInstallMirror = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-python/python-build-standalone/releases/download"
$OcrWheelhouseBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/wheels"
$TencentPipIndexUrl = "https://mirrors.cloud.tencent.com/pypi/simple"
$PypiFallbackIndexUrl = "https://pypi.org/simple"
$PythonBuildStandaloneBuild = "20260623"
$PythonBuildStandaloneVersion = "3.12.13+20260623"
$PythonRuntimeFileName = "cpython-$PythonBuildStandaloneVersion-x86_64-pc-windows-msvc-install_only.tar.gz"
$PythonRuntimeSha256 = "C6AF85BB83D5158C9FF71F50DFAD467853D1CD236F932B144E87E26E2EA2A83E"
$PortablePython = Join-Path $PythonRuntimeDir "python\python.exe"
$OcrPackageRequirements = @(
  "rapidocr-onnxruntime==1.4.4",
  "pillow==12.3.0",
  "onnxruntime==1.27.0",
  "numpy==2.5.1",
  "opencv-python==5.0.0.93"
)
$OcrCompatibilityPackageRequirements = @(
  "rapidocr-onnxruntime==1.4.4",
  "pillow==12.3.0",
  "onnxruntime==1.20.1",
  "numpy==1.26.4",
  "opencv-python==4.10.0.84"
)
$MicrosoftVisualCppRuntimeUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
$MicrosoftVisualCppRuntimeInstaller = Join-Path $BinDir "vc_redist.x64.exe"
$script:LastOcrImportFailureModule = ""
$script:LastOcrImportFailureMessage = ""
$script:LastOcrImportFailureText = ""
$script:VisualCppRuntimeRepairAttempted = $false
$script:VisualCppRuntimeRepairFailureMessage = ""
$script:VisualCppRuntimeRestartRequired = $false
$script:OcrCompatibilityRepairAttempted = $false
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

function Write-InstallLog {
  param([string]$Message)
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  Write-Host $Message
}

function Remove-DirectoryStrict {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$MaxAttempts = 4
  )
  if (!(Test-Path -LiteralPath $Path)) {
    return
  }
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    try {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
    } catch {
      if ($attempt -ge $MaxAttempts) {
        throw "Cannot remove OCR environment directory '$Path'. Another process or security software may be using it. $($_.Exception.Message)"
      }
      Start-Sleep -Milliseconds (250 * $attempt)
    }
    if (!(Test-Path -LiteralPath $Path)) {
      return
    }
  }
  throw "Cannot remove OCR environment directory '$Path'."
}

function Write-PendingOcrSwitch {
  $payload = [ordered]@{
    capability = $InstallerCapability
    staging = $StagingVenvDir
    target = $ActiveVenvDir
    backup = $BackupVenvDir
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
  }
  $payload | ConvertTo-Json | Set-Content -LiteralPath $PendingSwitchPath -Encoding UTF8
  Write-InstallLog "OCR environment is ready and will be activated after Obsidian restarts."
}

function Promote-StagedOcrEnvironment {
  $stagedPython = Join-Path $StagingVenvDir "Scripts\python.exe"
  if (!(Test-OcrPythonReady -PythonPath $stagedPython)) {
    throw "Staged OCR environment failed validation before activation."
  }

  Remove-DirectoryStrict -Path $BackupVenvDir
  $movedActive = $false
  try {
    if (Test-Path -LiteralPath $ActiveVenvDir) {
      Move-Item -LiteralPath $ActiveVenvDir -Destination $BackupVenvDir -ErrorAction Stop
      $movedActive = $true
    }
    Move-Item -LiteralPath $StagingVenvDir -Destination $ActiveVenvDir -ErrorAction Stop
  } catch {
    if ($movedActive -and !(Test-Path -LiteralPath $ActiveVenvDir) -and (Test-Path -LiteralPath $BackupVenvDir)) {
      Move-Item -LiteralPath $BackupVenvDir -Destination $ActiveVenvDir -ErrorAction SilentlyContinue
    }
    Write-PendingOcrSwitch
    return $false
  }

  $activePython = Join-Path $ActiveVenvDir "Scripts\python.exe"
  if (!(Test-OcrPythonReady -PythonPath $activePython)) {
    Remove-DirectoryStrict -Path $ActiveVenvDir
    if (Test-Path -LiteralPath $BackupVenvDir) {
      Move-Item -LiteralPath $BackupVenvDir -Destination $ActiveVenvDir -ErrorAction Stop
    }
    throw "Activated OCR environment failed validation; the previous environment was restored."
  }

  Remove-DirectoryStrict -Path $BackupVenvDir
  Remove-Item -LiteralPath $PendingSwitchPath -Force -ErrorAction SilentlyContinue
  return $true
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $FilePath @Arguments 2>&1 | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Invoke-DownloadFile {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [int]$TimeoutSec = 300
  )
  $outDir = Split-Path -Parent $OutFile
  if ($outDir) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  }
  Write-InstallLog "Downloading $Url"
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    & $curl.Source `
      -L `
      --fail `
      --silent `
      --show-error `
      --retry 3 `
      --retry-delay 2 `
      --connect-timeout 30 `
      --max-time $TimeoutSec `
      -o $OutFile `
      $Url
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 100)) {
      return
    }
    Write-InstallLog "curl download failed with exit code $LASTEXITCODE; retrying with PowerShell."
  }
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -Headers $Headers -TimeoutSec $TimeoutSec
  if (!(Test-Path -LiteralPath $OutFile) -or ((Get-Item -LiteralPath $OutFile).Length -le 100)) {
    throw "Downloaded file is empty or invalid: $Url"
  }
}

function Download-TextFile {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile
  )
  try {
    Invoke-DownloadFile -Url $Url -OutFile $OutFile -TimeoutSec 180
  } catch {
    throw "Failed to download $Url. $($_.Exception.Message)"
  }
}

function Test-PythonUsable {
  param([Parameter(Mandatory = $true)][string]$Command)
  try {
    $version = & $Command -c "import sys, venv; raise SystemExit(0 if sys.version_info >= (3, 10) and sys.version_info < (3, 13) else 1)" 2>&1
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Find-Python {
  $candidates = @("python", "python3")
  foreach ($candidate in $candidates) {
    if (Test-PythonUsable -Command $candidate) {
      return $candidate
    }
  }
  try {
    $pyVersion = & py -3.12 -c "import sys, venv; raise SystemExit(0 if sys.version_info >= (3, 10) and sys.version_info < (3, 13) else 1)" 2>&1
    if ($LASTEXITCODE -eq 0) {
      return "py -3.12"
    }
  } catch {
  }
  return $null
}

function Invoke-Python {
  param(
    [Parameter(Mandatory = $true)][string]$PythonCommand,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  if ($PythonCommand -eq "py -3.12") {
    & py -3.12 @Arguments
    return $LASTEXITCODE
  }
  & $PythonCommand @Arguments
  return $LASTEXITCODE
}

function Test-OcrPythonImports {
  param([Parameter(Mandatory = $true)][string]$PythonPath)

  $probeCode = @'
import importlib
import json
import traceback

for module_name in ('numpy', 'cv2', 'onnxruntime', 'rapidocr_onnxruntime'):
    try:
        module = importlib.import_module(module_name)
        if module_name == 'rapidocr_onnxruntime':
            getattr(module, 'RapidOCR')
        print(json.dumps({'stage': 'ocr-import', 'module': module_name, 'ok': True}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({
            'stage': 'ocr-import',
            'module': module_name,
            'ok': False,
            'error': str(exc),
            'traceback': traceback.format_exc(),
        }, ensure_ascii=False))
        raise SystemExit(1)
'@

  $output = @()
  $exitCode = 1
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @(& $PythonPath -c $probeCode 2>&1 | ForEach-Object { [string]$_ })
    $exitCode = $LASTEXITCODE
  } catch {
    $output += [string]$_.Exception.Message
    $exitCode = 1
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  $script:LastOcrImportFailureModule = ""
  $script:LastOcrImportFailureMessage = ""
  $script:LastOcrImportFailureText = ($output -join "`n").Trim()
  foreach ($line in $output) {
    Write-InstallLog "OCR import probe: $line"
    try {
      $result = $line | ConvertFrom-Json -ErrorAction Stop
      if ($result.stage -eq "ocr-import" -and $result.ok -eq $false) {
        $script:LastOcrImportFailureModule = [string]$result.module
        $script:LastOcrImportFailureMessage = [string]$result.error
      }
    } catch {
    }
  }
  return $exitCode -eq 0
}

function Test-MissingVisualCppRuntime {
  param([string]$FailureText = $script:LastOcrImportFailureText)
  if ([string]::IsNullOrWhiteSpace($FailureText)) {
    return $false
  }
  return $FailureText -match '(?i)(DLL load failed|WinError\s*(126|127|193)|onnxruntime_pybind11_state|VCRUNTIME|MSVCP140|api-ms-win-crt|initialization routine failed|dynamic link library)'
}

function Install-MicrosoftVisualCppRuntime {
  Write-InstallLog "OCR native dependency is unavailable; downloading the official Microsoft Visual C++ x64 runtime."
  Remove-Item -LiteralPath $MicrosoftVisualCppRuntimeInstaller -Force -ErrorAction SilentlyContinue
  Invoke-DownloadFile -Url $MicrosoftVisualCppRuntimeUrl -OutFile $MicrosoftVisualCppRuntimeInstaller -TimeoutSec 600
  if (!(Test-Path -LiteralPath $MicrosoftVisualCppRuntimeInstaller) -or ((Get-Item -LiteralPath $MicrosoftVisualCppRuntimeInstaller).Length -lt 1MB)) {
    throw "Microsoft Visual C++ runtime download is incomplete."
  }

  $signature = Get-AuthenticodeSignature -FilePath $MicrosoftVisualCppRuntimeInstaller
  $signerSubject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { "" }
  if ($signature.Status -ne "Valid" -or $signerSubject -notmatch 'Microsoft Corporation') {
    throw "Microsoft Visual C++ runtime signature validation failed; installation was stopped."
  }

  Write-InstallLog "Starting the Microsoft Visual C++ runtime installer. Windows may request administrator approval."
  try {
    $process = Start-Process `
      -FilePath $MicrosoftVisualCppRuntimeInstaller `
      -ArgumentList @("/install", "/quiet", "/norestart") `
      -Verb RunAs `
      -WindowStyle Hidden `
      -Wait `
      -PassThru
  } catch {
    throw "Microsoft Visual C++ runtime installation was cancelled or could not start. $($_.Exception.Message)"
  }

  $exitCode = [int]$process.ExitCode
  if ($exitCode -in @(3010, 1641)) {
    $script:VisualCppRuntimeRestartRequired = $true
  }
  if ($exitCode -notin @(0, 1638, 3010, 1641)) {
    throw "Microsoft Visual C++ runtime installation failed with exit code $exitCode."
  }
  Write-InstallLog "Microsoft Visual C++ runtime installer completed with exit code $exitCode."
}

function Test-OcrPythonReady {
  param([Parameter(Mandatory = $true)][string]$PythonPath)
  if (Test-OcrPythonImports -PythonPath $PythonPath) {
    return $true
  }

  if (!(Test-MissingVisualCppRuntime)) {
    return $false
  }

  if (!$script:OcrCompatibilityRepairAttempted) {
    $script:OcrCompatibilityRepairAttempted = $true
    Write-InstallLog "OCR DLL import failed; replacing the moving native dependency stack with the Windows 10 compatible stack."
    if ((Install-OcrCompatibilityPackages -PythonPath $PythonPath) -and (Test-OcrPythonImports -PythonPath $PythonPath)) {
      Write-InstallLog "OCR import validation passed with the Windows compatibility stack."
      return $true
    }
    Write-InstallLog "OCR compatibility stack did not resolve the DLL import; trying the official Microsoft runtime repair."
  }

  if ($script:VisualCppRuntimeRepairAttempted -or !(Test-MissingVisualCppRuntime)) {
    return $false
  }

  $script:VisualCppRuntimeRepairAttempted = $true
  Write-InstallLog "OCR import failure matches a missing Visual C++ runtime; starting one automatic repair attempt."
  try {
    Install-MicrosoftVisualCppRuntime
  } catch {
    $script:VisualCppRuntimeRepairFailureMessage = [string]$_.Exception.Message
    Write-InstallLog "Visual C++ runtime repair failed: $($script:VisualCppRuntimeRepairFailureMessage)"
    return $false
  }

  Write-InstallLog "Visual C++ runtime repair finished; retrying OCR import validation."
  Start-Sleep -Seconds 2
  return Test-OcrPythonImports -PythonPath $PythonPath
}

function Get-OcrImportFailureDetail {
  $details = @()
  if ($script:VisualCppRuntimeRepairFailureMessage) {
    $details += $script:VisualCppRuntimeRepairFailureMessage
  }
  if ($script:VisualCppRuntimeRestartRequired) {
    $details += "Microsoft Visual C++ runtime was installed, but Windows must be restarted before OCR can be validated."
  }
  if ($script:LastOcrImportFailureModule -or $script:LastOcrImportFailureMessage) {
    $moduleName = if ($script:LastOcrImportFailureModule) { $script:LastOcrImportFailureModule } else { "unknown module" }
    $message = if ($script:LastOcrImportFailureMessage) { $script:LastOcrImportFailureMessage } else { "unknown import error" }
    $details += "OCR import failed at ${moduleName}: $message"
  }
  return ($details -join " ").Trim()
}

function Test-FileSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
  )
  if (!(Test-Path -LiteralPath $Path)) {
    return $false
  }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
  return $actual -eq $ExpectedSha256.ToUpperInvariant()
}

function Install-PortablePython {
  if ((Test-Path -LiteralPath $PortablePython) -and (Test-PythonUsable -Command $PortablePython)) {
    Write-InstallLog "Pinned portable Python is already ready: $PortablePython"
    return $PortablePython
  }

  $runtimeUrl = "$($TencentPythonInstallMirror.TrimEnd('/'))/$PythonBuildStandaloneBuild/$PythonRuntimeFileName"
  $archivePath = Join-Path $CacheDir $PythonRuntimeFileName
  if (!(Test-FileSha256 -Path $archivePath -ExpectedSha256 $PythonRuntimeSha256)) {
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    Invoke-DownloadFile -Url $runtimeUrl -OutFile $archivePath -TimeoutSec 1200
  }
  if (!(Test-FileSha256 -Path $archivePath -ExpectedSha256 $PythonRuntimeSha256)) {
    throw "Pinned Python runtime SHA256 validation failed."
  }

  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  if (-not $tar) {
    throw "Windows tar.exe is required to install the pinned Python runtime."
  }

  $stageDir = Join-Path $InstallRoot (".python-runtime-stage-" + [guid]::NewGuid().ToString("N"))
  try {
    New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
    $exitCode = Invoke-NativeCommand -FilePath $tar.Source -Arguments @("-xzf", $archivePath, "-C", $stageDir)
    if ($exitCode -ne 0) {
      throw "Pinned Python runtime extraction failed with exit code $exitCode."
    }
    $stagedPython = Join-Path $stageDir "python\python.exe"
    if (!(Test-Path -LiteralPath $stagedPython) -or !(Test-PythonUsable -Command $stagedPython)) {
      throw "Pinned Python runtime validation failed after extraction."
    }

    Remove-Item -LiteralPath $PythonRuntimeDir -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $stageDir -Destination $PythonRuntimeDir -Force
  } finally {
    Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (!(Test-Path -LiteralPath $PortablePython) -or !(Test-PythonUsable -Command $PortablePython)) {
    throw "Pinned portable Python was not installed correctly."
  }
  Write-InstallLog "Pinned portable Python installed: $PortablePython"
  return $PortablePython
}

function Get-OcrWheelhouseUrl {
  $platform = "win_amd64"
  return "$($OcrWheelhouseBaseUrl.TrimEnd("/"))/$platform/index.html"
}

function Install-OcrPackagesFromWheelhouse {
  param([Parameter(Mandatory = $true)][string]$PythonPath)
  $wheelhouseUrl = Get-OcrWheelhouseUrl
  Write-InstallLog "Installing OCR packages from CDN wheelhouse: $wheelhouseUrl"
  $exitCode = Invoke-NativeCommand -FilePath $PythonPath -Arguments (@("-m", "pip", "install", "--upgrade", "--no-index", "--find-links", $wheelhouseUrl) + $OcrPackageRequirements)
  return $exitCode -eq 0
}

function Install-OcrPackagesWithPip {
  param([Parameter(Mandatory = $true)][string]$PythonPath)
  if (Install-OcrPackagesFromWheelhouse -PythonPath $PythonPath) {
    return $true
  }
  Write-InstallLog "CDN OCR wheelhouse install failed; retrying package indexes."
  Invoke-NativeCommand -FilePath $PythonPath -Arguments @("-m", "pip", "install", "--upgrade", "pip", "-i", $TencentPipIndexUrl, "--extra-index-url", $PypiFallbackIndexUrl) | Out-Null
  $exitCode = Invoke-NativeCommand -FilePath $PythonPath -Arguments (@("-m", "pip", "install", "--upgrade") + $OcrPackageRequirements + @("-i", $TencentPipIndexUrl, "--extra-index-url", $PypiFallbackIndexUrl))
  if ($exitCode -eq 0) {
    return $true
  }
  Write-InstallLog "Tencent PyPI mirror install failed; retrying with PyPI only."
  $exitCode = Invoke-NativeCommand -FilePath $PythonPath -Arguments (@("-m", "pip", "install", "--upgrade") + $OcrPackageRequirements + @("-i", $PypiFallbackIndexUrl))
  return $exitCode -eq 0
}

function Install-OcrCompatibilityPackages {
  param([Parameter(Mandatory = $true)][string]$PythonPath)
  Write-InstallLog "Installing the pinned OCR Windows compatibility stack."
  $commonArguments = @("-m", "pip", "install", "--upgrade", "--force-reinstall") + $OcrCompatibilityPackageRequirements
  $exitCode = Invoke-NativeCommand -FilePath $PythonPath -Arguments ($commonArguments + @("-i", $TencentPipIndexUrl, "--extra-index-url", $PypiFallbackIndexUrl))
  if ($exitCode -eq 0) {
    return $true
  }
  Write-InstallLog "Tencent PyPI compatibility install failed; retrying with PyPI only."
  $exitCode = Invoke-NativeCommand -FilePath $PythonPath -Arguments ($commonArguments + @("-i", $PypiFallbackIndexUrl))
  return $exitCode -eq 0
}

function Setup-PythonEnvironment {
  $venvPython = Join-Path $VenvDir "Scripts\python.exe"
  if ((Test-Path -LiteralPath $venvPython) -and (Test-OcrPythonReady -PythonPath $venvPython)) {
    Write-InstallLog "OCR Python environment is already ready."
    return $venvPython
  }

  $python = Find-Python
  if ($python) {
    Write-InstallLog "Using existing Python command: $python"
    Invoke-Python -PythonCommand $python -m venv $VenvDir | Out-Null
    if ((Test-Path -LiteralPath $venvPython) -and (Install-OcrPackagesWithPip -PythonPath $venvPython) -and (Test-OcrPythonReady -PythonPath $venvPython)) {
      Write-InstallLog "Python OCR environment ready via existing Python."
      return $venvPython
    }
    Write-InstallLog "Existing Python OCR setup failed; falling back to pinned portable Python."
    Remove-DirectoryStrict -Path $VenvDir
    $script:OcrCompatibilityRepairAttempted = $false
  }

  $python = Install-PortablePython
  Write-InstallLog "Creating an isolated OCR environment with pinned Python 3.12."
  Invoke-Python -PythonCommand $python -m venv $VenvDir | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Pinned Python 3.12 failed to create the OCR virtual environment."
  }
  if (!(Test-Path -LiteralPath $venvPython)) {
    throw "venv python not found: $venvPython"
  }
  if (!(Install-OcrPackagesWithPip -PythonPath $venvPython)) {
    throw "rapidocr-onnxruntime / pillow install failed. Please check network and retry."
  }
  if (!(Test-OcrPythonReady -PythonPath $venvPython)) {
    $failureDetail = Get-OcrImportFailureDetail
    if ($failureDetail) {
      throw "rapidocr-onnxruntime import validation failed. $failureDetail"
    }
    throw "rapidocr-onnxruntime import validation failed. See the OCR import probe in install.log."
  }
  Write-InstallLog "Python OCR environment ready via pinned portable Python."
  return $venvPython
}

Write-InstallLog "Installing local OCR component into $InstallRoot"
if (!(Test-Path -LiteralPath $PythonScript)) {
  $downloadedScript = Join-Path $InstallRoot "ocr_image.downloaded.py"
  $assetBase = $TencentOcrAssetBaseUrl.TrimEnd("/")
  Download-TextFile -Url "$assetBase/ocr_image.py" -OutFile $downloadedScript
  $PythonScript = $downloadedScript
}

$null = $InstallerCapability
Remove-DirectoryStrict -Path $StagingVenvDir
$VenvPython = Setup-PythonEnvironment
Copy-Item -LiteralPath $PythonScript -Destination $RuntimeScript -Force
$activated = Promote-StagedOcrEnvironment

if ($activated) {
  Write-InstallLog "Local OCR component installed."
  Write-Host "Python: $(Join-Path $ActiveVenvDir 'Scripts\python.exe')"
}
Write-Host "Script: $RuntimeScript"
