#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="$HOME/.wechat-inbox-local-asr"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wechat-inbox-local-asr-install.XXXXXX")"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
MODEL_MIRROR_URL="https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

download_file() {
  local url="$1"
  local out_file="$2"
  echo "Downloading $url"
  if command -v curl >/dev/null 2>&1; then
    if curl -L --retry 2 --retry-delay 2 --connect-timeout 30 -C - -o "$out_file" "$url"; then
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
  local urls=("$MODEL_URL" "$MODEL_MIRROR_URL")
  local url=""

  rm -f "$temp_file"
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

brew_install_formula() {
  local formula="$1"
  if brew list --versions "$formula" >/dev/null 2>&1; then
    echo "Homebrew formula already installed: $formula"
    return
  fi

  echo "Installing Homebrew formula: $formula"
  if HOMEBREW_NO_INSTALL_CLEANUP=1 brew install "$formula"; then
    return
  fi

  echo "" >&2
  echo "WeChat Inbox Sync local ASR install failed while installing: $formula" >&2
  echo "Please open Terminal and run this command manually, then retry in Obsidian:" >&2
  echo "  brew install $formula" >&2
  echo "If Homebrew says another process is running, wait a few minutes and retry." >&2
  echo "If the network download is blocked, switch network or proxy and retry." >&2
  exit 1
}

find_command() {
  local name="$1"
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

if ! command -v brew >/dev/null 2>&1; then
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required on macOS. Install it from https://brew.sh/ and rerun this script." >&2
  exit 1
fi

mkdir -p "$INSTALL_ROOT/bin" "$INSTALL_ROOT/models"

brew_install_formula ffmpeg
brew_install_formula whisper-cpp

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
  echo "whisper command was not found after installing whisper-cpp." >&2
  echo "Please open Terminal and run: brew reinstall whisper-cpp" >&2
  exit 1
fi

FFMPEG_BIN="$(find_command ffmpeg || true)"
if [ -z "$FFMPEG_BIN" ]; then
  echo "ffmpeg was not found after installation." >&2
  exit 1
fi

ln -sf "$WHISPER_BIN" "$INSTALL_ROOT/bin/whisper-cli"
ln -sf "$FFMPEG_BIN" "$INSTALL_ROOT/bin/ffmpeg"

MODEL_PATH="$INSTALL_ROOT/models/ggml-small.bin"
if [ -f "$MODEL_PATH" ]; then
  model_size="$(wc -c < "$MODEL_PATH" | tr -d ' ')"
  if [ "$model_size" -lt 400000000 ]; then
    rm -f "$MODEL_PATH"
  fi
fi
if [ ! -f "$MODEL_PATH" ]; then
  download_model "$MODEL_PATH"
fi

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
} > "$RUN_LOG"

"$FFMPEG" -hide_banner -loglevel error -y -i "$INPUT_PATH" -ar 16000 -ac 1 -c:a pcm_s16le -f segment -segment_time "$CHUNK_SECONDS" -reset_timestamps 1 "$TEMP_WORK_DIR/chunk-%03d.wav" 2>> "$RUN_LOG"

chunk_count="$(find "$TEMP_WORK_DIR" -name 'chunk-*.wav' -type f | wc -l | tr -d ' ')"
echo "chunkCount=$chunk_count" >> "$RUN_LOG"
if [ "$chunk_count" -eq 0 ]; then
  echo "ffmpeg did not generate audio chunks." >&2
  echo "status=failed" >> "$RUN_LOG"
  exit 1
fi

: > "$OUTPUT_PATH"
for chunk in "$TEMP_WORK_DIR"/chunk-*.wav; do
  chunk_base="${chunk%.wav}"
  chunk_txt="$chunk_base.txt"
  {
    echo "--- $(basename "$chunk") ---"
  } >> "$RUN_LOG"
  "$WHISPER" -m "$MODEL" -f "$chunk" -l zh -otxt -of "$chunk_base" >> "$RUN_LOG" 2>&1
  if [ ! -f "$chunk_txt" ]; then
    echo "Whisper did not generate transcript: $chunk_txt" >&2
    echo "status=failed" >> "$RUN_LOG"
    exit 1
  fi
  if [ -s "$chunk_txt" ]; then
    cat "$chunk_txt" >> "$OUTPUT_PATH"
    printf '\n\n' >> "$OUTPUT_PATH"
  fi
done

if [ ! -s "$OUTPUT_PATH" ]; then
  echo "Whisper did not generate transcript text." >&2
  echo "status=failed" >> "$RUN_LOG"
  exit 1
fi

echo "status=success" >> "$RUN_LOG"
cat "$OUTPUT_PATH"
SCRIPT

chmod +x "$INSTALL_ROOT/transcribe.sh"

echo ""
echo "Local ASR installed to: $INSTALL_ROOT"
echo "Use this Obsidian plugin command:"
echo '/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}'
