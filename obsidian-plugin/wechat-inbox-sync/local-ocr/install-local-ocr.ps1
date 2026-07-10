param(
  [string]$InstallRoot = (Join-Path $env:USERPROFILE ".wechat-inbox-local-ocr")
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonScript = Join-Path $ScriptDir "ocr_image.py"
$VenvDir = Join-Path $InstallRoot "venv"
$RuntimeScript = Join-Path $InstallRoot "ocr_image.py"
$LogPath = Join-Path $InstallRoot "install.log"
$BinDir = Join-Path $InstallRoot "bin"
$UvExe = Join-Path $BinDir "uv.exe"
$Headers = @{ "User-Agent" = "wechat-inbox-sync-local-ocr-installer" }
$TencentOcrAssetBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common"
$TencentPythonInstallMirror = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-python/python-build-standalone/releases/download"
$OcrWheelhouseBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/wheels"
$TencentPipIndexUrl = "https://mirrors.cloud.tencent.com/pypi/simple"
$PypiFallbackIndexUrl = "https://pypi.org/simple"
$UvVersion = "0.9.14"
$PythonBuildStandaloneBuild = "20260623"
$OcrPackageRequirements = @("rapidocr-onnxruntime==1.4.4", "pillow==12.3.0")
$env:UV_PYTHON_DOWNLOADS = "automatic"
$env:UV_PYTHON_PREFERENCE = "managed"
$env:UV_PYTHON_INSTALL_MIRROR = $TencentPythonInstallMirror
$env:UV_PYTHON_CPYTHON_BUILD = $PythonBuildStandaloneBuild
$env:UV_LINK_MODE = "copy"

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

function Write-InstallLog {
  param([string]$Message)
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  Write-Host $Message
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
    $version = & $Command -c "import sys, venv; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)" 2>&1
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
    $pyVersion = & py -3 -c "import sys, venv; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)" 2>&1
    if ($LASTEXITCODE -eq 0) {
      return "py -3"
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
  if ($PythonCommand -eq "py -3") {
    & py -3 @Arguments
    return $LASTEXITCODE
  }
  & $PythonCommand @Arguments
  return $LASTEXITCODE
}

function Test-OcrPythonReady {
  param([Parameter(Mandatory = $true)][string]$PythonPath)
  try {
    & $PythonPath -c "from rapidocr_onnxruntime import RapidOCR; print('rapidocr-ready')" 2>&1 | Out-Host
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Install-Uv {
  if ((Test-Path -LiteralPath $UvExe) -and (& $UvExe --version 2>$null)) {
    Write-InstallLog "uv is already available: $UvExe"
    return
  }

  $uvZip = Join-Path $BinDir "uv-x86_64-pc-windows-msvc.zip"
  $uvStage = Join-Path $BinDir ("uv-stage-" + [guid]::NewGuid().ToString("N"))
  $assetBase = $TencentOcrAssetBaseUrl.TrimEnd("/")
  $urls = @(
    "$assetBase/uv-x86_64-pc-windows-msvc.zip",
    "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"
  )

  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Remove-Item -LiteralPath $uvZip -Force -ErrorAction SilentlyContinue
      Invoke-DownloadFile -Url $url -OutFile $uvZip -TimeoutSec 600
      $downloaded = $true
      break
    } catch {
      Write-InstallLog "uv download failed from $url. $($_.Exception.Message)"
    }
  }
  if (-not $downloaded) {
    throw "uv download failed. Please check network and retry."
  }

  Remove-Item -LiteralPath $uvStage -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $uvStage | Out-Null
  Expand-Archive -LiteralPath $uvZip -DestinationPath $uvStage -Force
  $foundUv = Get-ChildItem -LiteralPath $uvStage -Recurse -File -Filter "uv.exe" | Select-Object -First 1
  if (-not $foundUv) {
    throw "uv package is invalid: uv.exe not found"
  }
  Copy-Item -LiteralPath $foundUv.FullName -Destination $UvExe -Force
  Remove-Item -LiteralPath $uvStage -Recurse -Force -ErrorAction SilentlyContinue
  & $UvExe --version | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "uv validation failed"
  }
  Write-InstallLog "uv installed to $UvExe"
}

function Get-OcrWheelhouseUrl {
  $platform = "win_amd64"
  return "$($OcrWheelhouseBaseUrl.TrimEnd("/"))/$platform/index.html"
}

function Install-OcrPackagesFromWheelhouse {
  param(
    [string]$PythonPath = "",
    [switch]$Uv
  )
  $wheelhouseUrl = Get-OcrWheelhouseUrl
  Write-InstallLog "Installing OCR packages from CDN wheelhouse: $wheelhouseUrl"
  if ($Uv) {
    $exitCode = Invoke-NativeCommand -FilePath $UvExe -Arguments (@("pip", "install", "--upgrade", "--no-index", "--find-links", $wheelhouseUrl) + $OcrPackageRequirements)
    return $exitCode -eq 0
  }
  if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    return $false
  }
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

function Install-OcrPackagesWithUv {
  $env:VIRTUAL_ENV = $VenvDir
  if (Install-OcrPackagesFromWheelhouse -Uv) {
    return $true
  }
  Write-InstallLog "CDN OCR wheelhouse install failed; retrying package indexes."
  $exitCode = Invoke-NativeCommand -FilePath $UvExe -Arguments (@("pip", "install", "--upgrade") + $OcrPackageRequirements + @("-i", $TencentPipIndexUrl, "--extra-index-url", $PypiFallbackIndexUrl))
  if ($exitCode -eq 0) {
    return $true
  }
  Write-InstallLog "Tencent PyPI mirror install failed; retrying with PyPI only."
  $exitCode = Invoke-NativeCommand -FilePath $UvExe -Arguments (@("pip", "install", "--upgrade") + $OcrPackageRequirements + @("-i", $PypiFallbackIndexUrl))
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
    Remove-Item -LiteralPath $VenvDir -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-Python -PythonCommand $python -m venv $VenvDir | Out-Null
    if ((Test-Path -LiteralPath $venvPython) -and (Install-OcrPackagesWithPip -PythonPath $venvPython) -and (Test-OcrPythonReady -PythonPath $venvPython)) {
      Write-InstallLog "Python OCR environment ready via existing Python."
      return $venvPython
    }
    Write-InstallLog "Existing Python OCR setup failed; falling back to uv managed Python."
    Remove-Item -LiteralPath $VenvDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  Install-Uv
  Write-InstallLog "Setting up managed Python 3.12 with uv..."
  & $UvExe python install 3.12
  if ($LASTEXITCODE -ne 0) {
    throw "uv failed to install managed Python 3.12. Please check network and retry."
  }
  & $UvExe venv $VenvDir --python 3.12
  if (!(Test-Path -LiteralPath $venvPython)) {
    throw "venv python not found: $venvPython"
  }
  if (!(Install-OcrPackagesWithUv)) {
    throw "rapidocr-onnxruntime / pillow install failed. Please check network and retry."
  }
  if (!(Test-OcrPythonReady -PythonPath $venvPython)) {
    throw "rapidocr-onnxruntime import validation failed."
  }
  Write-InstallLog "Python OCR environment ready via uv."
  return $venvPython
}

Write-InstallLog "Installing local OCR component into $InstallRoot"
if (!(Test-Path -LiteralPath $PythonScript)) {
  $downloadedScript = Join-Path $InstallRoot "ocr_image.downloaded.py"
  $assetBase = $TencentOcrAssetBaseUrl.TrimEnd("/")
  Download-TextFile -Url "$assetBase/ocr_image.py" -OutFile $downloadedScript
  $PythonScript = $downloadedScript
}

$VenvPython = Setup-PythonEnvironment
Copy-Item -LiteralPath $PythonScript -Destination $RuntimeScript -Force

Write-InstallLog "Local OCR component installed."
Write-Host "Python: $VenvPython"
Write-Host "Script: $RuntimeScript"
