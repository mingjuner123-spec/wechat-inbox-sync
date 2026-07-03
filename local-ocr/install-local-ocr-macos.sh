#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${HOME}/.wechat-inbox-local-ocr"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_SCRIPT="${SCRIPT_DIR}/ocr_image.py"
VENV_DIR="${INSTALL_ROOT}/venv"
RUNTIME_SCRIPT="${INSTALL_ROOT}/ocr_image.py"
LOG_PATH="${INSTALL_ROOT}/install.log"
TENCENT_OCR_ASSET_BASE_URL="https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common"
TENCENT_PIP_INDEX_URL="https://mirrors.cloud.tencent.com/pypi/simple"
PYPI_FALLBACK_INDEX_URL="https://pypi.org/simple"

mkdir -p "$INSTALL_ROOT"

log() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") $*" | tee -a "$LOG_PATH"
}

find_python() {
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      "$candidate" --version 2>&1 | grep -q "Python" && {
        echo "$candidate"
        return 0
      }
    fi
  done
  echo "Python not found. Please install Python 3.9-3.12 and rerun this installer." >&2
  return 1
}

download_text_file() {
  local url="$1"
  local out_file="$2"
  log "Downloading $url"
  if command -v curl >/dev/null 2>&1; then
    curl -L --retry 2 --retry-delay 2 --connect-timeout 30 --max-time 120 -o "$out_file" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$out_file" "$url"
  else
    echo "Neither curl nor wget is available." >&2
    return 1
  fi
  test -s "$out_file" || {
    echo "Downloaded file is empty or invalid: $url" >&2
    return 1
  }
}

log "Installing local OCR component into $INSTALL_ROOT"
if [ ! -f "$PYTHON_SCRIPT" ]; then
  DOWNLOADED_SCRIPT="${INSTALL_ROOT}/ocr_image.downloaded.py"
  download_text_file "${TENCENT_OCR_ASSET_BASE_URL%/}/ocr_image.py" "$DOWNLOADED_SCRIPT"
  PYTHON_SCRIPT="$DOWNLOADED_SCRIPT"
fi

PYTHON="$(find_python)"
log "Using Python command: $PYTHON"

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON" -m venv "$VENV_DIR"
fi

VENV_PYTHON="${VENV_DIR}/bin/python"
test -x "$VENV_PYTHON" || {
  echo "venv python not found: $VENV_PYTHON" >&2
  exit 1
}

"$VENV_PYTHON" -m pip install --upgrade pip -i "$TENCENT_PIP_INDEX_URL" --extra-index-url "$PYPI_FALLBACK_INDEX_URL"
"$VENV_PYTHON" -m pip install --upgrade rapidocr-onnxruntime pillow -i "$TENCENT_PIP_INDEX_URL" --extra-index-url "$PYPI_FALLBACK_INDEX_URL"
cp "$PYTHON_SCRIPT" "$RUNTIME_SCRIPT"
"$VENV_PYTHON" -c "from rapidocr_onnxruntime import RapidOCR; print('rapidocr-ready')"

log "Local OCR component installed."
echo "Python: $VENV_PYTHON"
echo "Script: $RUNTIME_SCRIPT"
