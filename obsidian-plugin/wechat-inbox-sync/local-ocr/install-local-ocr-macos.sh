#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${HOME}/.wechat-inbox-local-ocr"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_SCRIPT="${SCRIPT_DIR}/ocr_image.py"
VENV_DIR="${INSTALL_ROOT}/venv"
RUNTIME_SCRIPT="${INSTALL_ROOT}/ocr_image.py"
LOG_PATH="${INSTALL_ROOT}/install.log"

TENCENT_BASE_URL="https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com"
TENCENT_OCR_ASSET_BASE_URL="${TENCENT_BASE_URL}/local-ocr/common"
TENCENT_PIP_INDEX_URL="https://mirrors.cloud.tencent.com/pypi/simple"
PYPI_FALLBACK_INDEX_URL="https://pypi.org/simple"

DOWNLOAD_LOW_SPEED_LIMIT=10240
DOWNLOAD_LOW_SPEED_TIME=180
UV_VERSION="0.9.14"
UV_BIN="${INSTALL_ROOT}/bin/uv"

mkdir -p "$INSTALL_ROOT"

log() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") $*" | tee -a "$LOG_PATH"
}

# ── uv bootstrap ────────────────────────────────────────────────────────────

detect_uv_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    arm64)  echo "aarch64-apple-darwin" ;;
    x86_64) echo "x86_64-apple-darwin"   ;;
    *)
      log "ERROR: Unsupported macOS architecture: $arch"
      return 1
      ;;
  esac
}

download_uv() {
  local uv_arch="$1"

  # If uv already exists and works, skip.
  if [ -x "$UV_BIN" ] && "$UV_BIN" --version >/dev/null 2>&1; then
    log "uv is already available: $UV_BIN"
    return 0
  fi

  mkdir -p "$INSTALL_ROOT/bin"
  local uv_temp="${INSTALL_ROOT}/bin/uv-download"

  local urls=(
    "${TENCENT_BASE_URL}/local-asr/common/uv-${uv_arch}"
    "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${uv_arch}.tar.gz"
  )

  for url in "${urls[@]}"; do
    log "Downloading uv from $url"
    rm -f "$uv_temp"

    if command -v curl >/dev/null 2>&1; then
      if curl -L --retry 2 --retry-delay 2 --connect-timeout 30 \
        --speed-limit "$DOWNLOAD_LOW_SPEED_LIMIT" \
        --speed-time "$DOWNLOAD_LOW_SPEED_TIME" \
        -o "$uv_temp" "$url" 2>&1; then
        # Check if it's a tar.gz (GitHub) or raw binary (CDN)
        if file "$uv_temp" 2>/dev/null | grep -q 'gzip'; then
          tar xzf "$uv_temp" -C "$INSTALL_ROOT/bin" --strip-components=1 2>/dev/null || true
          rm -f "$uv_temp"
          if [ -x "$UV_BIN" ]; then
            return 0
          fi
        else
          mv "$uv_temp" "$UV_BIN"
          chmod +x "$UV_BIN"
          if [ -x "$UV_BIN" ]; then
            return 0
          fi
        fi
      fi
    fi
    rm -f "$uv_temp"
    log "uv download failed from $url, trying next source."
  done

  log "ERROR: 无法下载 uv（Python 安装工具）。请检查网络连接后重试。"
  return 1
}

# ── Python venv via uv ──────────────────────────────────────────────────────

setup_python_venv() {
  # If venv already exists and works, skip.
  local venv_python="${VENV_DIR}/bin/python"
  if [ -x "$venv_python" ] && "$venv_python" -c 'from rapidocr_onnxruntime import RapidOCR; print("rapidocr-ready")' >/dev/null 2>&1; then
    log "OCR Python environment is already ready."
    return 0
  fi

  local uv_arch
  uv_arch="$(detect_uv_arch)" || return 1
  download_uv "$uv_arch" || return 1

  # Create venv.  uv auto-downloads Python if needed.
  log "Setting up Python environment (this may take a few minutes on first run)..."
  if ! "$UV_BIN" venv "$VENV_DIR" --python 3.12 2>&1; then
    if ! "$UV_BIN" venv "$VENV_DIR" --python 3 2>&1; then
      log "ERROR: 无法创建 Python 虚拟环境。"
      log "请尝试在终端运行: xcode-select --install"
      log "安装 Xcode Command Line Tools 后重试。"
      return 1
    fi
  fi

  if [ ! -x "$venv_python" ]; then
    log "ERROR: Python venv was not created at $venv_python"
    return 1
  fi

  log "Installing rapidocr-onnxruntime and pillow..."
  export VIRTUAL_ENV="$VENV_DIR"
  "$UV_BIN" pip install --upgrade pip 2>&1 || true
  if ! "$UV_BIN" pip install --upgrade rapidocr-onnxruntime pillow \
    -i "$TENCENT_PIP_INDEX_URL" \
    --extra-index-url "$PYPI_FALLBACK_INDEX_URL" 2>&1; then
    log "ERROR: rapidocr-onnxruntime / pillow 安装失败。请检查网络连接后重试。"
    return 1
  fi

  # Validate.
  if ! "$venv_python" -c "from rapidocr_onnxruntime import RapidOCR; print('rapidocr-ready')" 2>&1; then
    log "ERROR: rapidocr-onnxruntime 导入验证失败。"
    return 1
  fi

  log "Python OCR environment ready."
  return 0
}

# ── OCR script ──────────────────────────────────────────────────────────────

download_text_file() {
  local url="$1"
  local out_file="$2"
  log "Downloading $url"
  if command -v curl >/dev/null 2>&1; then
    curl -L --retry 2 --retry-delay 2 --connect-timeout 30 --max-time 120 -o "$out_file" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$out_file" "$url"
  else
    log "ERROR: Neither curl nor wget is available."
    return 1
  fi
  test -s "$out_file" || {
    log "ERROR: Downloaded file is empty or invalid: $url"
    return 1
  }
}

install_ocr_script() {
  # If the bundled script exists alongside the installer, use it directly.
  if [ -f "$PYTHON_SCRIPT" ] && [ -s "$PYTHON_SCRIPT" ]; then
    cp "$PYTHON_SCRIPT" "$RUNTIME_SCRIPT"
    log "OCR script copied from bundled source."
    return 0
  fi

  # Otherwise download from CDN.
  local downloaded_script="${INSTALL_ROOT}/ocr_image.downloaded.py"
  if download_text_file "${TENCENT_OCR_ASSET_BASE_URL%/}/ocr_image.py" "$downloaded_script"; then
    cp "$downloaded_script" "$RUNTIME_SCRIPT"
    log "OCR script downloaded from CDN."
    return 0
  fi

  log "ERROR: 无法获取 OCR 脚本。请检查网络连接后重试。"
  return 1
}

# ── Main ────────────────────────────────────────────────────────────────────

log "Installing local OCR component into $INSTALL_ROOT"

setup_python_venv || {
  log "OCR component installation failed at Python environment step."
  exit 1
}

install_ocr_script || {
  log "OCR component installation failed at script download step."
  exit 1
}

log "Local OCR component installed."
echo "Python: ${VENV_DIR}/bin/python"
echo "Script: $RUNTIME_SCRIPT"
