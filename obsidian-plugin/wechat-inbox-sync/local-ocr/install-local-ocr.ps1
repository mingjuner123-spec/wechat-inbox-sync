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
$Headers = @{ "User-Agent" = "wechat-inbox-sync-local-ocr-installer" }
$TencentOcrAssetBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common"
$TencentPipIndexUrl = "https://mirrors.cloud.tencent.com/pypi/simple"
$PypiFallbackIndexUrl = "https://pypi.org/simple"

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

function Write-InstallLog {
  param([string]$Message)
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  Write-Host $Message
}

function Find-Python {
  $candidates = @("py", "python", "python3")
  foreach ($candidate in $candidates) {
    try {
      $version = & $candidate --version 2>&1
      if ($LASTEXITCODE -eq 0 -and "$version" -match "Python") {
        return $candidate
      }
    } catch {
    }
  }
  throw "Python not found. Please install Python 3.9-3.12 and rerun this installer."
}

function Download-TextFile {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutFile
  )
  Write-InstallLog "Downloading $Url"
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -Headers $Headers -TimeoutSec 120
    if ((Test-Path -LiteralPath $OutFile) -and ((Get-Item -LiteralPath $OutFile).Length -gt 100)) {
      return
    }
  } catch {
    throw "Failed to download $Url. $($_.Exception.Message)"
  }
  throw "Downloaded file is empty or invalid: $Url"
}

Write-InstallLog "Installing local OCR component into $InstallRoot"
if (!(Test-Path -LiteralPath $PythonScript)) {
  $downloadedScript = Join-Path $InstallRoot "ocr_image.downloaded.py"
  $assetBase = $TencentOcrAssetBaseUrl.TrimEnd("/")
  Download-TextFile -Url "$assetBase/ocr_image.py" -OutFile $downloadedScript
  $PythonScript = $downloadedScript
}

$Python = Find-Python
Write-InstallLog "Using Python command: $Python"

if (!(Test-Path -LiteralPath $VenvDir)) {
  & $Python -m venv $VenvDir
}

$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if (!(Test-Path -LiteralPath $VenvPython)) {
  throw "venv python not found: $VenvPython"
}

& $VenvPython -m pip install --upgrade pip -i $TencentPipIndexUrl --extra-index-url $PypiFallbackIndexUrl
& $VenvPython -m pip install --upgrade rapidocr-onnxruntime pillow -i $TencentPipIndexUrl --extra-index-url $PypiFallbackIndexUrl

Copy-Item -LiteralPath $PythonScript -Destination $RuntimeScript -Force
& $VenvPython -c "from rapidocr_onnxruntime import RapidOCR; print('rapidocr-ready')"

Write-InstallLog "Local OCR component installed."
Write-Host "Python: $VenvPython"
Write-Host "Script: $RuntimeScript"
