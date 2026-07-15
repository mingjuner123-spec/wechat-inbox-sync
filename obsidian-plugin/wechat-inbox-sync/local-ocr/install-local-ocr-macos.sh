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
TENCENT_PYTHON_INSTALL_MIRROR="${TENCENT_BASE_URL}/local-python/python-build-standalone/releases/download"
OCR_WHEELHOUSE_BASE_URL="${TENCENT_BASE_URL}/local-ocr/wheels"
TENCENT_PIP_INDEX_URL="https://mirrors.cloud.tencent.com/pypi/simple"
PYPI_FALLBACK_INDEX_URL="https://pypi.org/simple"

DOWNLOAD_LOW_SPEED_LIMIT=10240
DOWNLOAD_LOW_SPEED_TIME=180
UV_VERSION="0.9.14"
PYTHON_BUILD_STANDALONE_BUILD="20260623"
UV_BIN="${INSTALL_ROOT}/bin/uv"
PORTABLE_PYTHON="${PYTHON_RUNTIME_DIR}/python/bin/python"
OCR_PACKAGE_REQUIREMENTS=("rapidocr-onnxruntime==1.4.4" "pillow==12.3.0")
export UV_PYTHON_DOWNLOADS=automatic
export UV_PYTHON_PREFERENCE=managed
export UV_PYTHON_INSTALL_MIRROR="$TENCENT_PYTHON_INSTALL_MIRROR"
export UV_PYTHON_CPYTHON_BUILD="$PYTHON_BUILD_STANDALONE_BUILD"

mkdir -p "$INSTALL_ROOT"
: > "$LOG_PATH"

log() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") $*" | tee -a "$LOG_PATH"
}

# ── uv bootstrap ────────────────────────────────────────────────────────────

curl_supports_retry_all_errors() {
  command -v curl >/dev/null 2>&1 && curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'
}

download_with_curl() {
  local url="$1"
  local out_file="$2"
  local max_time="${3:-300}"
  if curl_supports_retry_all_errors; then
    curl -fL --silent --show-error --retry 5 --retry-delay 2 --retry-all-errors \
      --connect-timeout 30 \
      --max-time "$max_time" \
      --speed-limit "$DOWNLOAD_LOW_SPEED_LIMIT" \
      --speed-time "$DOWNLOAD_LOW_SPEED_TIME" \
      -o "$out_file" "$url"
  else
    curl -fL --silent --show-error --retry 5 --retry-delay 2 \
      --connect-timeout 30 \
      --max-time "$max_time" \
      --speed-limit "$DOWNLOAD_LOW_SPEED_LIMIT" \
      --speed-time "$DOWNLOAD_LOW_SPEED_TIME" \
      -o "$out_file" "$url"
  fi
}

download_with_retry() {
  local url="$1"
  local out_file="$2"
  local label="${3:-file}"
  local max_time="${4:-300}"
  local attempt
  for attempt in 1 2 3; do
    log "Downloading ${label} (attempt ${attempt}/3): ${url}"
    rm -f "$out_file"
    if command -v curl >/dev/null 2>&1; then
      if download_with_curl "$url" "$out_file" "$max_time" && [ -s "$out_file" ]; then
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -q --tries=3 --timeout=30 -O "$out_file" "$url" && [ -s "$out_file" ]; then
        return 0
      fi
    else
      log "ERROR: Neither curl nor wget is available."
      return 1
    fi
    rm -f "$out_file"
    sleep $((attempt * 2))
  done
  log "ERROR: Download failed for ${label}: ${url}"
  return 1
}

is_python_usable() {
  local python_bin="$1"
  [ -n "$python_bin" ] || return 1
  if [ ! -x "$python_bin" ]; then
    python_bin="$(command -v "$python_bin" 2>/dev/null || true)"
    [ -n "$python_bin" ] || return 1
  fi
  "$python_bin" -c 'import sys, venv; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1
}

find_existing_python() {
  local candidates=(
    "${HOME}/.wechat-inbox-local-asr/python-venv/bin/python"
    "${HOME}/.wechat-inbox-local-asr/venv/bin/python"
    "${HOME}/.wechat-inbox-local-asr/.venv/bin/python"
    "/opt/homebrew/bin/python3"
    "/usr/local/bin/python3"
  )
  local candidate
  for candidate in "${candidates[@]}"; do
    if is_python_usable "$candidate"; then
      echo "$candidate"
      return 0
    fi
  done
  candidate="$(command -v python3 2>/dev/null || true)"
  if [ -n "$candidate" ] && is_python_usable "$candidate"; then
    echo "$candidate"
    return 0
  fi
  return 1
}

validate_ocr_python() {
  local python_bin="$1"
  "$python_bin" -c "from rapidocr_onnxruntime import RapidOCR; print('rapidocr-ready')" 2>&1
}

detect_ocr_wheel_platform() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    arm64)  echo "macosx_11_0_arm64" ;;
    x86_64) echo "macosx_11_0_x86_64" ;;
    *)
      log "ERROR: Unsupported macOS wheelhouse architecture: $arch"
      return 1
      ;;
  esac
}

ocr_wheelhouse_url() {
  local wheel_platform
  wheel_platform="$(detect_ocr_wheel_platform)" || return 1
  echo "${OCR_WHEELHOUSE_BASE_URL%/}/${wheel_platform}/index.html"
}

install_ocr_packages_from_wheelhouse() {
  local installer="$1"
  shift
  local wheelhouse_url
  wheelhouse_url="$(ocr_wheelhouse_url)" || return 1
  log "Installing OCR packages from CDN wheelhouse: $wheelhouse_url"
  "$installer" "$@" install --upgrade \
    --no-index \
    --find-links "$wheelhouse_url" \
    "${OCR_PACKAGE_REQUIREMENTS[@]}" 2>&1
}

install_ocr_packages_with_python() {
  local python_bin="$1"
  export PIP_DISABLE_PIP_VERSION_CHECK=1
  "$python_bin" -m ensurepip --upgrade >/dev/null 2>&1 || true
  if install_ocr_packages_from_wheelhouse "$python_bin" -m pip; then
    return 0
  fi
  log "CDN OCR wheelhouse install failed; retrying package indexes."
  "$python_bin" -m pip install --upgrade pip \
    -i "$TENCENT_PIP_INDEX_URL" \
    --extra-index-url "$PYPI_FALLBACK_INDEX_URL" 2>&1 || true
  if "$python_bin" -m pip install --upgrade "${OCR_PACKAGE_REQUIREMENTS[@]}" \
    -i "$TENCENT_PIP_INDEX_URL" \
    --extra-index-url "$PYPI_FALLBACK_INDEX_URL" 2>&1; then
    return 0
  fi
  log "Tencent PyPI mirror install failed; retrying with PyPI only."
  "$python_bin" -m pip install --upgrade "${OCR_PACKAGE_REQUIREMENTS[@]}" \
    -i "$PYPI_FALLBACK_INDEX_URL" 2>&1
}

install_ocr_packages_with_uv() {
  export VIRTUAL_ENV="$VENV_DIR"
  if install_ocr_packages_from_wheelhouse "$UV_BIN" pip; then
    return 0
  fi
  log "CDN OCR wheelhouse install failed; retrying package indexes."
  "$UV_BIN" pip install --upgrade pip 2>&1 || true
  if "$UV_BIN" pip install --upgrade "${OCR_PACKAGE_REQUIREMENTS[@]}" \
    -i "$TENCENT_PIP_INDEX_URL" \
    --extra-index-url "$PYPI_FALLBACK_INDEX_URL" 2>&1; then
    return 0
  fi
  log "Tencent PyPI mirror install failed; retrying with PyPI only."
  "$UV_BIN" pip install --upgrade "${OCR_PACKAGE_REQUIREMENTS[@]}" \
    -i "$PYPI_FALLBACK_INDEX_URL" 2>&1
}

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
    rm -f "$uv_temp"

    if download_with_retry "$url" "$uv_temp" "uv" 600; then
      # Check if it's a tar.gz (GitHub) or raw binary (CDN)
      if [[ "$url" == *.tar.gz ]] || file "$uv_temp" 2>/dev/null | grep -q 'gzip'; then
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
  if [ -x "$venv_python" ] && validate_ocr_python "$venv_python" >/dev/null 2>&1; then
    log "OCR Python environment is already ready."
    return 0
  fi

  local existing_python
  existing_python="$(find_existing_python || true)"
  if [ -n "$existing_python" ]; then
    log "Reusing existing Python for OCR environment: $existing_python"
    rm -rf "$VENV_DIR"
    if "$existing_python" -m venv "$VENV_DIR" 2>&1 \
      && [ -x "$venv_python" ] \
      && install_ocr_packages_with_python "$venv_python" \
      && validate_ocr_python "$venv_python" >/dev/null 2>&1; then
      log "Python OCR environment ready via existing Python."
      return 0
    fi
    log "Existing Python OCR setup failed; falling back to uv managed Python."
    rm -rf "$VENV_DIR"
  fi

  local uv_arch
  uv_arch="$(detect_uv_arch)" || return 1
  download_uv "$uv_arch" || return 1

  # Create venv.  uv auto-downloads Python if needed.
  log "Setting up Python environment (this may take a few minutes on first run)..."
  if ! "$UV_BIN" python install 3.12 2>&1; then
    log "ERROR: Failed to install managed Python 3.12 via uv. Please check your network connection and retry."
    return 1
  fi
  if ! "$UV_BIN" venv "$VENV_DIR" --python 3.12 --managed-python 2>&1; then
    if ! "$UV_BIN" venv "$VENV_DIR" --python 3.12 2>&1; then
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
  if ! install_ocr_packages_with_uv; then
    log "ERROR: rapidocr-onnxruntime / pillow 安装失败。请检查网络连接后重试。"
    return 1
  fi

  # Validate.
  if ! validate_ocr_python "$venv_python"; then
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
  download_with_retry "$url" "$out_file" "ocr script" 180
  test -s "$out_file" || {
    log "ERROR: Downloaded file is empty or invalid: $url"
    return 1
  }
}

install_ocr_script() {
  local source_script=""
  local downloaded_script="${INSTALL_ROOT}/ocr_image.downloaded.py"
  local staged_script="${INSTALL_ROOT}/.ocr_image.py.tmp.$$"

  is_valid_ocr_script() {
    local candidate="$1"
    [ -s "$candidate" ] \
      && grep -q 'RapidOCR' "$candidate" \
      && grep -q -- '--input' "$candidate" \
      && grep -q -- '--output' "$candidate"
  }

  if is_valid_ocr_script "$RUNTIME_SCRIPT"; then
    log "OCR script is already ready."
    return 0
  fi

  # Community plugin updates may not include extra runtime files, so bundled
  # assets are preferred but the CDN remains the normal fallback.
  if is_valid_ocr_script "$PYTHON_SCRIPT"; then
    source_script="$PYTHON_SCRIPT"
    log "Using bundled OCR script."
  elif download_text_file "${TENCENT_OCR_ASSET_BASE_URL%/}/ocr_image.py" "$downloaded_script" \
    && is_valid_ocr_script "$downloaded_script"; then
    source_script="$downloaded_script"
    log "OCR script downloaded from CDN."
  fi

  if [ -z "$source_script" ]; then
    log "ERROR: 无法获取有效的 OCR 脚本。请检查网络连接后重试。"
    return 1
  fi

  rm -f "$staged_script"
  cp "$source_script" "$staged_script"
  if ! is_valid_ocr_script "$staged_script"; then
    rm -f "$staged_script"
    log "ERROR: OCR 脚本校验失败。"
    return 1
  fi
  mv -f "$staged_script" "$RUNTIME_SCRIPT"
  log "OCR script installed atomically."
  return 0
}

# ── Main ────────────────────────────────────────────────────────────────────

log "Installing local OCR component into $INSTALL_ROOT"

install_ocr_script || {
  log "status=failed"
  log "stage=ocr_script"
  log "OCR component installation failed at script download step."
  exit 1
}

setup_python_venv || {
  log "status=failed"
  log "stage=python_environment"
  log "OCR component installation failed at Python environment step."
  exit 1
}

log "status=success"
log "stage=complete"
log "Local OCR component installed."
echo "Python: ${VENV_DIR}/bin/python"
echo "Script: $RUNTIME_SCRIPT"
