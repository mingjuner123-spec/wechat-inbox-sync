#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${HOME}/.wechat-inbox-local-ocr"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_SCRIPT="${SCRIPT_DIR}/ocr_image.py"
VENV_DIR="${INSTALL_ROOT}/venv"
PYTHON_RUNTIME_DIR="${INSTALL_ROOT}/python-runtime"
CACHE_DIR="${INSTALL_ROOT}/cache"
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
PYTHON_BUILD_STANDALONE_BUILD="20260623"
PYTHON_BUILD_STANDALONE_VERSION="3.12.13+20260623"
PYTHON_RUNTIME_SHA256_ARM64="3724AA4DAFB5F7B6C2CF98E89914E4248DC6BD2FE40407DF4A2D73DE99615F16"
PYTHON_RUNTIME_SHA256_X64="7C57FDD1FA675190093700EB0D8E7117E1F9EAE7C30A46DEA5F8D5266BCFC791"
PORTABLE_PYTHON="${PYTHON_RUNTIME_DIR}/python/bin/python3"
OCR_PACKAGE_REQUIREMENTS=("rapidocr-onnxruntime==1.4.4" "pillow==12.3.0")

mkdir -p "$INSTALL_ROOT" "$CACHE_DIR"
: > "$LOG_PATH"

log() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") $*" | tee -a "$LOG_PATH"
}

# ── Downloads ───────────────────────────────────────────────────────────────

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
  "$python_bin" -c 'import sys, venv; raise SystemExit(0 if (3, 10) <= sys.version_info < (3, 13) else 1)' >/dev/null 2>&1
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

python_runtime_file_name() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    arm64)  echo "cpython-${PYTHON_BUILD_STANDALONE_VERSION}-aarch64-apple-darwin-install_only.tar.gz" ;;
    x86_64) echo "cpython-${PYTHON_BUILD_STANDALONE_VERSION}-x86_64-apple-darwin-install_only.tar.gz" ;;
    *)
      log "ERROR: Unsupported macOS architecture: $arch"
      return 1
      ;;
  esac
}

python_runtime_sha256() {
  case "$(uname -m)" in
    arm64) echo "$PYTHON_RUNTIME_SHA256_ARM64" ;;
    x86_64) echo "$PYTHON_RUNTIME_SHA256_X64" ;;
    *) return 1 ;;
  esac
}

file_sha256() {
  shasum -a 256 "$1" | awk '{ print toupper($1) }'
}

verify_sha256() {
  local file_path="$1"
  local expected_sha256="$2"
  [ -s "$file_path" ] || return 1
  [ "$(file_sha256 "$file_path")" = "$expected_sha256" ]
}

install_portable_python() {
  if is_python_usable "$PORTABLE_PYTHON"; then
    log "Pinned portable Python is already ready: $PORTABLE_PYTHON"
    return 0
  fi

  local file_name expected_sha256 archive_path runtime_url stage_dir staged_python
  file_name="$(python_runtime_file_name)" || return 1
  expected_sha256="$(python_runtime_sha256)" || return 1
  archive_path="${CACHE_DIR}/${file_name}"
  runtime_url="${TENCENT_PYTHON_INSTALL_MIRROR%/}/${PYTHON_BUILD_STANDALONE_BUILD}/${file_name}"

  if ! verify_sha256 "$archive_path" "$expected_sha256"; then
    rm -f "$archive_path"
    download_with_retry "$runtime_url" "$archive_path" "pinned Python runtime" 1200 || return 1
  fi
  if ! verify_sha256 "$archive_path" "$expected_sha256"; then
    log "ERROR: Pinned Python runtime SHA256 validation failed."
    return 1
  fi

  stage_dir="$(mktemp -d "${INSTALL_ROOT}/.python-runtime-stage.XXXXXX")"
  if ! tar -xzf "$archive_path" -C "$stage_dir"; then
    rm -rf "$stage_dir"
    log "ERROR: Pinned Python runtime extraction failed."
    return 1
  fi
  staged_python="${stage_dir}/python/bin/python3"
  if ! is_python_usable "$staged_python"; then
    rm -rf "$stage_dir"
    log "ERROR: Pinned Python runtime validation failed after extraction."
    return 1
  fi

  rm -rf "$PYTHON_RUNTIME_DIR"
  mv "$stage_dir" "$PYTHON_RUNTIME_DIR"
  if ! is_python_usable "$PORTABLE_PYTHON"; then
    log "ERROR: Pinned portable Python was not installed correctly."
    return 1
  fi
  log "Pinned portable Python installed: $PORTABLE_PYTHON"
  return 0
}

# ── Python venv via pinned portable runtime ─────────────────────────────────

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
    log "Existing Python OCR setup failed; falling back to pinned portable Python."
    rm -rf "$VENV_DIR"
  fi

  install_portable_python || return 1
  log "Creating an isolated OCR environment with pinned Python 3.12."
  rm -rf "$VENV_DIR"
  if ! "$PORTABLE_PYTHON" -m venv "$VENV_DIR" 2>&1; then
    log "ERROR: Pinned Python 3.12 failed to create the OCR virtual environment."
    return 1
  fi

  if [ ! -x "$venv_python" ]; then
    log "ERROR: Python venv was not created at $venv_python"
    return 1
  fi

  log "Installing rapidocr-onnxruntime and pillow..."
  if ! install_ocr_packages_with_python "$venv_python"; then
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
