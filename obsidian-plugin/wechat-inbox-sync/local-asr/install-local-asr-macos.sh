#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="$HOME/.wechat-inbox-local-asr"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wechat-inbox-local-asr-install.XXXXXX")"
CACHE_ROOT="$INSTALL_ROOT/cache"
INSTALL_STATE_PATH="$INSTALL_ROOT/.install-state.json"
INSTALLER_SCRIPT_VERSION="1.3.0"
DOWNLOAD_LOW_SPEED_LIMIT=10240
DOWNLOAD_LOW_SPEED_TIME=180
LOCK_DIR="$INSTALL_ROOT/.install.lock"
LOCK_HELD=0

TENCENT_BASE_URL="https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com"
TENCENT_MODEL_URL="${TENCENT_BASE_URL}/local-asr/windows/ggml-small.bin"
MODEL_MIRROR_URL="https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
MODEL_URLS=("$TENCENT_MODEL_URL" "$MODEL_MIRROR_URL" "$MODEL_URL")

cleanup() {
  if [ "$LOCK_HELD" -eq 1 ]; then
    rm -rf "$LOCK_DIR"
  fi
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

acquire_install_lock() {
  mkdir -p "$INSTALL_ROOT"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCK_HELD=1
    echo "$$" > "$LOCK_DIR/pid"
    return
  fi

  local existing_pid=""
  if [ -f "$LOCK_DIR/pid" ]; then
    existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  fi
  if [ -n "$existing_pid" ] && ! kill -0 "$existing_pid" 2>/dev/null; then
    rm -rf "$LOCK_DIR"
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      LOCK_HELD=1
      echo "$$" > "$LOCK_DIR/pid"
      return
    fi
  fi

  echo "Another WeChat Inbox Sync local ASR installation is already running." >&2
  echo "Please wait a few minutes for the current installation to finish, then retry in Obsidian." >&2
  echo "No Terminal command is required." >&2
  exit 1
}

# ── uv bootstrap ────────────────────────────────────────────────────────────
# uv is a single Rust binary (~50 MB) that can install Python and manage venvs.
# Primary download from Tencent CDN, fallback to GitHub releases.

UV_VERSION="0.9.14"
UV_BIN="$INSTALL_ROOT/bin/uv"

detect_uv_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    arm64)  echo "aarch64-apple-darwin" ;;
    x86_64) echo "x86_64-apple-darwin"   ;;
    *)
      echo "Unsupported macOS architecture: $arch" >&2
      return 1
      ;;
  esac
}

download_uv() {
  local uv_arch="$1"
  local uv_temp="$2"
  local urls=(
    "${TENCENT_BASE_URL}/local-asr/common/uv-${uv_arch}"
    "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${uv_arch}.tar.gz"
  )

  for url in "${urls[@]}"; do
    echo "Downloading uv from $url"
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
    echo "uv download failed from $url, trying next source." >&2
  done
  return 1
}

bootstrap_uv() {
  if [ -x "$UV_BIN" ] && "$UV_BIN" --version >/dev/null 2>&1; then
    echo "uv is already available: $UV_BIN"
    return 0
  fi

  mkdir -p "$INSTALL_ROOT/bin"
  local uv_arch
  uv_arch="$(detect_uv_arch)" || return 1
  local uv_temp="$TEMP_ROOT/uv-download"

  if download_uv "$uv_arch" "$uv_temp"; then
    echo "uv installed to $UV_BIN"
    return 0
  fi

  echo "" >&2
  echo "无法下载 uv（Python 安装工具）。" >&2
  echo "请检查网络连接后重试。No Terminal command is required." >&2
  return 1
}

# ── Python + packages via uv ────────────────────────────────────────────────

VENV_DIR="$INSTALL_ROOT/python-venv"
VENV_PYTHON="$VENV_DIR/bin/python"

setup_python_and_packages() {
  # If everything is already set up and working, skip.
  if [ -x "$VENV_PYTHON" ] && [ -x "$INSTALL_ROOT/bin/whisper-cli" ] && [ -x "$INSTALL_ROOT/bin/ffmpeg" ]; then
    if "$VENV_PYTHON" -c 'import imageio_ffmpeg' >/dev/null 2>&1; then
      echo "Python venv and ASR tools are already ready."
      return 0
    fi
  fi

  bootstrap_uv || return 1

  # Create venv.  uv will use system Python 3 if a working one exists;
  # otherwise it auto-downloads a standalone Python build.
  echo "Setting up Python environment (this may take a few minutes on first run)..."
  if ! "$UV_BIN" venv "$VENV_DIR" --python 3.12 2>&1; then
    # If 3.12 is unavailable, let uv pick the best available Python.
    if ! "$UV_BIN" venv "$VENV_DIR" --python 3 2>&1; then
      echo "" >&2
      echo "无法创建 Python 虚拟环境。" >&2
      echo "请尝试在终端运行: xcode-select --install" >&2
      echo "安装 Xcode Command Line Tools 后重试。" >&2
      echo "No Terminal command is required for the retry." >&2
      return 1
    fi
  fi

  if [ ! -x "$VENV_PYTHON" ]; then
    echo "Python venv was not created at $VENV_PYTHON" >&2
    return 1
  fi

  # Export VIRTUAL_ENV so uv pip targets this venv.
  export VIRTUAL_ENV="$VENV_DIR"

  echo "Installing whisper.cpp-cli and imageio-ffmpeg..."
  if ! "$UV_BIN" pip install --upgrade whisper.cpp-cli imageio-ffmpeg 2>&1; then
    echo "" >&2
    echo "whisper.cpp-cli / imageio-ffmpeg 安装失败。" >&2
    echo "请检查网络连接后重试。No Terminal command is required." >&2

    # Fallback: try Homebrew
    if command -v brew >/dev/null 2>&1; then
      echo "尝试通过 Homebrew 安装..." >&2
      return 2  # signal caller to try Homebrew
    fi
    return 1
  fi

  # Locate whisper-cpp binary in the venv.
  local whisper_cpp_bin
  whisper_cpp_bin="$VENV_DIR/bin/whisper-cpp"
  if [ ! -x "$whisper_cpp_bin" ]; then
    whisper_cpp_bin="$(find "$VENV_DIR/bin" -maxdepth 1 -type f -name 'whisper-cpp*' -perm -111 2>/dev/null | head -n 1 || true)"
  fi
  if [ -z "$whisper_cpp_bin" ] || [ ! -x "$whisper_cpp_bin" ]; then
    echo "whisper.cpp-cli did not install the whisper-cpp command." >&2
    return 1
  fi

  # Create wrapper scripts.
  cat > "$INSTALL_ROOT/bin/whisper-cli" <<SCRIPT
#!/usr/bin/env bash
WHISPER_CPP_BIN="$whisper_cpp_bin"
exec "\$WHISPER_CPP_BIN" "\$@"
SCRIPT

  cat > "$INSTALL_ROOT/bin/ffmpeg" <<SCRIPT
#!/usr/bin/env bash
exec "$VENV_PYTHON" -c 'import os, sys, imageio_ffmpeg; exe = imageio_ffmpeg.get_ffmpeg_exe(); os.execv(exe, [exe] + sys.argv[1:])' "\$@"
SCRIPT

  chmod +x "$INSTALL_ROOT/bin/whisper-cli" "$INSTALL_ROOT/bin/ffmpeg"

  if ! "$INSTALL_ROOT/bin/whisper-cli" -h >/dev/null 2>&1; then
    echo "whisper-cli validation failed." >&2
    return 1
  fi
  if ! "$INSTALL_ROOT/bin/ffmpeg" -version >/dev/null 2>&1; then
    echo "ffmpeg validation failed." >&2
    return 1
  fi

  echo "Python ASR tools installed successfully via uv."
  return 0
}

# ── Homebrew fallback (only if uv pip install fails) ────────────────────────

brew_install_formula() {
  local formula="$1"
  local max_attempts=3
  local retry_delay_seconds=10

  if brew list --versions "$formula" >/dev/null 2>&1; then
    echo "Homebrew formula already installed: $formula"
    return
  fi

  echo "Installing Homebrew formula: $formula"
  local attempt output status
  for attempt in $(seq 1 "$max_attempts"); do
    set +e
    output="$(HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install "$formula" 2>&1)"
    status=$?
    set -e
    printf '%s\n' "$output"
    if [ "$status" -eq 0 ]; then
      return
    fi
    if brew list --versions "$formula" >/dev/null 2>&1; then
      echo "Homebrew formula is now installed despite a non-zero brew exit: $formula"
      return
    fi
    if printf '%s\n' "$output" | grep -Eiq 'already locked|Please wait|another process'; then
      echo "Homebrew is busy. Waiting before retry $attempt/$max_attempts..." >&2
      sleep "$retry_delay_seconds"
      continue
    fi
    break
  done

  echo "" >&2
  echo "Homebrew did not finish installing $formula." >&2
  echo "Please retry in Obsidian after closing other installers." >&2
  echo "No Terminal command is required." >&2
  exit 1
}

find_command() {
  local name="$1"
  if [ -x "$INSTALL_ROOT/bin/$name" ]; then
    echo "$INSTALL_ROOT/bin/$name"
    return
  fi
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return
  fi
  for prefix in /opt/homebrew /usr/local; do
    if [ -x "$prefix/bin/$name" ]; then
      echo "$prefix/bin/$name"
      return
    fi
  done
  return 1
}

# ── Model download ──────────────────────────────────────────────────────────

download_file() {
  local url="$1"
  local out_file="$2"
  echo "Downloading $url"
  if command -v curl >/dev/null 2>&1; then
    if curl -L \
      --retry 2 \
      --retry-delay 2 \
      --connect-timeout 30 \
      --speed-limit "$DOWNLOAD_LOW_SPEED_LIMIT" \
      --speed-time "$DOWNLOAD_LOW_SPEED_TIME" \
      -C - \
      -o "$out_file" \
      "$url"; then
      return 0
    fi
  fi
  if command -v wget >/dev/null 2>&1; then
    if wget -O "$out_file" "$url"; then
      return 0
    fi
  fi
  return 1
}

download_model() {
  local out_file="$1"
  local temp_file="$out_file.part"
  local urls=("${MODEL_URLS[@]}")

  for url in "${urls[@]}"; do
    if download_file "$url" "$temp_file"; then
      local model_size
      model_size="$(wc -c < "$temp_file" | tr -d ' ')"
      if [ "$model_size" -ge 400000000 ]; then
        mv -f "$temp_file" "$out_file"
        return 0
      fi
      echo "Downloaded model is too small from $url, trying next source." >&2
      rm -f "$temp_file"
    else
      echo "Model download failed from $url, trying next source." >&2
      rm -f "$temp_file"
    fi
  done

  echo "Whisper model download failed from all sources." >&2
  echo "The local ASR engine is installed, but the model file could not be downloaded." >&2
  echo "Please retry installation later or switch network. No Terminal command is required." >&2
  return 1
}

# ── Validation ──────────────────────────────────────────────────────────────

validate_local_asr_inference() {
  local whisper_bin="$1"
  local ffmpeg_bin="$2"
  local model_path="$3"
  local validation_dir="$TEMP_ROOT/inference-validation"
  local validation_wav="$validation_dir/validation.wav"
  local validation_base="$validation_dir/validation"
  local validation_log="$validation_dir/whisper.log"

  mkdir -p "$validation_dir"
  if ! "$ffmpeg_bin" -hide_banner -loglevel error -y -f lavfi -i anullsrc=r=16000:cl=mono -t 1 -c:a pcm_s16le "$validation_wav"; then
    echo "ffmpeg inference validation audio generation failed." >&2
    return 1
  fi
  if ! "$whisper_bin" -m "$model_path" -f "$validation_wav" -l zh -otxt -of "$validation_base" >"$validation_log" 2>&1; then
    echo "whisper inference validation failed." >&2
    cat "$validation_log" >&2 || true
    return 1
  fi
  echo "Local ASR inference validation passed."
}

file_state() {
  local file_path="$1"
  if [ ! -e "$file_path" ]; then
    echo "::missing::"
    return
  fi
  local size mtime
  size="$(wc -c < "$file_path" | tr -d ' ')"
  mtime="$(stat -f '%m' "$file_path" 2>/dev/null || stat -c '%Y' "$file_path" 2>/dev/null || echo 0)"
  printf '%s|%s|%s' "$file_path" "$size" "$mtime"
}

install_state_is_valid() {
  local whisper_bin="$1"
  local ffmpeg_bin="$2"
  local model_path="$3"
  [ -f "$INSTALL_STATE_PATH" ] || return 1
  grep -Fqx "installerScriptVersion=$INSTALLER_SCRIPT_VERSION" "$INSTALL_STATE_PATH" || return 1
  grep -Fqx "validationStatus=passed" "$INSTALL_STATE_PATH" || return 1
  grep -Fqx "whisper=$(file_state "$whisper_bin")" "$INSTALL_STATE_PATH" || return 1
  grep -Fqx "ffmpeg=$(file_state "$ffmpeg_bin")" "$INSTALL_STATE_PATH" || return 1
  grep -Fqx "model=$(file_state "$model_path")" "$INSTALL_STATE_PATH" || return 1
}

write_install_state() {
  local whisper_bin="$1"
  local ffmpeg_bin="$2"
  local model_path="$3"
  {
    echo "installerScriptVersion=$INSTALLER_SCRIPT_VERSION"
    echo "validationStatus=passed"
    echo "validatedAtUtc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "whisper=$(file_state "$whisper_bin")"
    echo "ffmpeg=$(file_state "$ffmpeg_bin")"
    echo "model=$(file_state "$model_path")"
  } > "$INSTALL_STATE_PATH"
}

run_or_skip_local_asr_validation() {
  local whisper_bin="$1"
  local ffmpeg_bin="$2"
  local model_path="$3"
  if install_state_is_valid "$whisper_bin" "$ffmpeg_bin" "$model_path"; then
    echo "Local ASR was already validated for the current files; skipping full inference validation."
    return
  fi
  validate_local_asr_inference "$whisper_bin" "$ffmpeg_bin" "$model_path"
  write_install_state "$whisper_bin" "$ffmpeg_bin" "$model_path"
}

# ── Main ────────────────────────────────────────────────────────────────────

# Ensure Homebrew is on PATH for Apple Silicon Macs (used only as fallback).
if ! command -v brew >/dev/null 2>&1; then
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

acquire_install_lock
mkdir -p "$INSTALL_ROOT/bin" "$INSTALL_ROOT/models" "$CACHE_ROOT"

# Primary path: uv → Python → pip packages.
# Returns 2 if uv pip install failed but Homebrew is available as fallback.
setup_python_and_packages
setup_rc=$?

if [ $setup_rc -eq 2 ]; then
  # uv pip install failed, but Homebrew is available.
  brew_install_formula ffmpeg
  brew_install_formula whisper-cpp
elif [ $setup_rc -ne 0 ]; then
  # uv pipeline failed and no Homebrew available.
  echo "" >&2
  echo "本地转写组件安装失败。" >&2
  echo "常见原因：网络不通、macOS 版本过旧、缺少 Xcode Command Line Tools。" >&2
  echo "请在终端运行: xcode-select --install" >&2
  echo "然后重新在 Obsidian 里安装。No Terminal command is required." >&2
  exit 1
fi

# Locate whisper binary.
WHISPER_BIN="$(find_command whisper-cli || true)"
if [ -z "$WHISPER_BIN" ]; then
  WHISPER_BIN="$(find_command whisper-cpp || true)"
fi
if [ -z "$WHISPER_BIN" ]; then
  WHISPER_BIN="$(find_command whisper || true)"
fi
if [ -z "$WHISPER_BIN" ]; then
  for prefix in /opt/homebrew /usr/local; do
    candidate="$(find "$prefix" -path '*/whisper-cpp/*' -type f \( -name 'whisper-cli' -o -name 'whisper-cpp' -o -name 'whisper' -o -name 'main' \) -perm -111 2>/dev/null | head -n 1 || true)"
    if [ -n "$candidate" ]; then
      WHISPER_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "$WHISPER_BIN" ]; then
  echo "whisper command was not found after installation." >&2
  echo "Please retry in Obsidian. No Terminal command is required." >&2
  exit 1
fi

FFMPEG_BIN="$(find_command ffmpeg || true)"
if [ -z "$FFMPEG_BIN" ]; then
  echo "ffmpeg was not found after installation." >&2
  exit 1
fi

# Symlink into our bin directory.
if [ "$WHISPER_BIN" != "$INSTALL_ROOT/bin/whisper-cli" ]; then
  ln -sf "$WHISPER_BIN" "$INSTALL_ROOT/bin/whisper-cli"
fi
if [ "$FFMPEG_BIN" != "$INSTALL_ROOT/bin/ffmpeg" ]; then
  ln -sf "$FFMPEG_BIN" "$INSTALL_ROOT/bin/ffmpeg"
fi

# Download model.
MODEL_PATH="$INSTALL_ROOT/models/ggml-small.bin"
if [ -f "$MODEL_PATH" ]; then
  model_size="$(wc -c < "$MODEL_PATH" | tr -d ' ')"
  if [ "$model_size" -lt 400000000 ]; then
    rm -f "$MODEL_PATH"
  fi
fi
if [ ! -f "$MODEL_PATH" ]; then
  if [ -f "$CACHE_ROOT/ggml-small.bin" ]; then
    cached_model_size="$(wc -c < "$CACHE_ROOT/ggml-small.bin" | tr -d ' ')"
    if [ "$cached_model_size" -lt 400000000 ]; then
      rm -f "$CACHE_ROOT/ggml-small.bin"
    fi
  fi
  if [ ! -f "$CACHE_ROOT/ggml-small.bin" ]; then
    download_model "$CACHE_ROOT/ggml-small.bin"
  fi
  cp -f "$CACHE_ROOT/ggml-small.bin" "$MODEL_PATH"
fi

# Run inference validation (cached if state is still valid).
run_or_skip_local_asr_validation "$INSTALL_ROOT/bin/whisper-cli" "$INSTALL_ROOT/bin/ffmpeg" "$MODEL_PATH"
rm -f "$CACHE_ROOT/ggml-small.bin"

# ── Transcribe script ───────────────────────────────────────────────────────

cat > "$INSTALL_ROOT/transcribe.sh" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
INPUT_PATH=""
OUTPUT_PATH=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --input|-InputPath)
      INPUT_PATH="${2:-}"
      shift 2
      ;;
    --output|-OutputPath)
      OUTPUT_PATH="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [ -z "$INPUT_PATH" ] || [ -z "$OUTPUT_PATH" ]; then
  echo "Usage: transcribe.sh --input <audio-or-video> --output <text-file>" >&2
  exit 1
fi

WHISPER="$ROOT/bin/whisper-cli"
FFMPEG="$ROOT/bin/ffmpeg"
MODEL="$ROOT/models/ggml-small.bin"
SIMPLIFIED_PROMPT="$(printf '\350\257\267\350\276\223\345\207\272\347\256\200\344\275\223\344\270\255\346\226\207')"

if [ ! -x "$WHISPER" ]; then
  echo "whisper-cli not found. Please rerun install-local-asr-macos.sh." >&2
  exit 1
fi
if [ ! -x "$FFMPEG" ]; then
  echo "ffmpeg not found. Please rerun install-local-asr-macos.sh." >&2
  exit 1
fi
if [ ! -f "$MODEL" ]; then
  echo "Whisper model not found: $MODEL" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
TEMP_WORK_DIR="${TMPDIR:-/tmp}/wechat-inbox-local-asr-$(uuidgen 2>/dev/null || date +%s%N)"
CHUNK_SECONDS=600
OUTPUT_BASE="$OUTPUT_PATH"
case "$OUTPUT_BASE" in
  *.txt) OUTPUT_BASE="${OUTPUT_BASE%.txt}" ;;
esac
RUN_LOG="$ROOT/transcribe-last.log"

cleanup() {
  rm -rf "$TEMP_WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$TEMP_WORK_DIR"
{
  echo "time=$(date '+%Y-%m-%dT%H:%M:%S%z')"
  echo "status=pending"
  echo "inputPath=$INPUT_PATH"
  echo "outputPath=$OUTPUT_PATH"
  echo "tempWorkDir=$TEMP_WORK_DIR"
  echo "chunkSeconds=$CHUNK_SECONDS"
  echo "progressStage=preparing"
  echo "progressCurrent=0"
  echo "progressTotal=0"
  echo "progressPercent=0"
} > "$RUN_LOG"

"$FFMPEG" -hide_banner -loglevel error -y -i "$INPUT_PATH" -ar 16000 -ac 1 -c:a pcm_s16le -f segment -segment_time "$CHUNK_SECONDS" -reset_timestamps 1 "$TEMP_WORK_DIR/chunk-%03d.wav" 2>> "$RUN_LOG"

chunk_count="$(find "$TEMP_WORK_DIR" -name 'chunk-*.wav' -type f | wc -l | tr -d ' ')"
echo "chunkCount=$chunk_count" >> "$RUN_LOG"
{
  echo "progressStage=transcribing"
  echo "progressCurrent=0"
  echo "progressTotal=$chunk_count"
  echo "progressPercent=0"
} >> "$RUN_LOG"
if [ "$chunk_count" -eq 0 ]; then
  echo "ffmpeg did not generate audio chunks." >&2
  echo "status=failed" >> "$RUN_LOG"
  exit 1
fi

: > "$OUTPUT_PATH"
chunk_index=0
for chunk in "$TEMP_WORK_DIR"/chunk-*.wav; do
  chunk_base="${chunk%.wav}"
  chunk_txt="$chunk_base.txt"
  {
    echo "--- $(basename "$chunk") ---"
  } >> "$RUN_LOG"
  "$WHISPER" -m "$MODEL" -f "$chunk" -l zh --prompt "$SIMPLIFIED_PROMPT" -otxt -of "$chunk_base" >> "$RUN_LOG" 2>&1
  if [ ! -f "$chunk_txt" ]; then
    echo "Whisper did not generate transcript: $chunk_txt" >&2
    echo "status=failed" >> "$RUN_LOG"
    exit 1
  fi
  if [ -s "$chunk_txt" ]; then
    cat "$chunk_txt" >> "$OUTPUT_PATH"
    printf '\n\n' >> "$OUTPUT_PATH"
  fi
  chunk_index=$((chunk_index + 1))
  progress_percent=$((chunk_index * 100 / chunk_count))
  {
    echo "progressStage=transcribing"
    echo "progressCurrent=$chunk_index"
    echo "progressTotal=$chunk_count"
    echo "progressPercent=$progress_percent"
  } >> "$RUN_LOG"
done

if [ ! -s "$OUTPUT_PATH" ]; then
  echo "Whisper did not generate transcript text." >&2
  echo "status=failed" >> "$RUN_LOG"
  exit 1
fi

{
  echo "progressStage=done"
  echo "progressCurrent=$chunk_count"
  echo "progressTotal=$chunk_count"
  echo "progressPercent=100"
} >> "$RUN_LOG"
echo "status=success" >> "$RUN_LOG"
cat "$OUTPUT_PATH"
SCRIPT

chmod +x "$INSTALL_ROOT/transcribe.sh"

echo ""
echo "Local ASR installed to: $INSTALL_ROOT"
echo "Use this Obsidian plugin command:"
echo '/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}'
