#!/usr/bin/env bash
set -euo pipefail

EVIDENCE_DIR="${1:?usage: mac-vad-ci.sh <evidence-dir>}"
RUNNER_TEMP_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}"
VAD_ROOT="$RUNNER_TEMP_DIR/whisper-vad-1.9.0"
VAD_SOURCE="https://github.com/ggml-org/whisper.cpp.git"
VAD_MODEL_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin"
VAD_MODEL_SHA256="2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"
VAD_MODEL_BYTES=885098

mkdir -p "$EVIDENCE_DIR"
git clone --depth 1 --branch v1.9.0 "$VAD_SOURCE" "$VAD_ROOT" \
  >"$RUNNER_TEMP_DIR/vad-clone.log" 2>&1
git -C "$VAD_ROOT" rev-parse HEAD >"$EVIDENCE_DIR/vad-source-commit.txt"

export MACOSX_DEPLOYMENT_TARGET=12.0
cmake -S "$VAD_ROOT" -B "$VAD_ROOT/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_SDL2=OFF \
  -DWHISPER_COMMON_FFMPEG=OFF \
  -DGGML_BUILD_EXAMPLES=ON \
  -DGGML_BUILD_TESTS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL=OFF \
  -DGGML_ACCELERATE=OFF \
  -DGGML_BLAS=OFF \
  -DGGML_OPENMP=OFF \
  >"$RUNNER_TEMP_DIR/vad-configure.log" 2>&1
cmake --build "$VAD_ROOT/build" --config Release \
  --target whisper-vad-speech-segments --parallel 3 \
  >"$RUNNER_TEMP_DIR/vad-build.log" 2>&1

VAD_BIN="$VAD_ROOT/build/bin/whisper-vad-speech-segments"
MODEL="$VAD_ROOT/models/ggml-silero-v6.2.0.bin"
JFK="${ASR_PUBLIC_AUDIO_FIXTURE:?ASR_PUBLIC_AUDIO_FIXTURE is required}"
SILENCE="$RUNNER_TEMP_DIR/vad-silence-2s.wav"
test -x "$VAD_BIN"
curl --fail --location --retry 3 --output "$MODEL" "$VAD_MODEL_URL" \
  >"$RUNNER_TEMP_DIR/vad-model-download.log" 2>&1
test "$(wc -c <"$MODEL" | tr -d ' ')" -eq "$VAD_MODEL_BYTES"
printf '%s  %s\n' "$VAD_MODEL_SHA256" "$MODEL" | shasum -a 256 --check

{
  printf 'runner_arch=%s\n' "$(uname -m)"
  printf 'source_commit=%s\n' "$(cat "$EVIDENCE_DIR/vad-source-commit.txt")"
  printf 'model_bytes=%s\nmodel_sha256=%s\n' "$VAD_MODEL_BYTES" "$VAD_MODEL_SHA256"
  printf 'binary_sha256=%s\n' "$(shasum -a 256 "$VAD_BIN" | awk '{print $1}')"
} >"$EVIDENCE_DIR/vad-identity.txt"
file "$VAD_BIN" >"$EVIDENCE_DIR/vad-binary-file.txt"
otool -L "$VAD_BIN" >"$EVIDENCE_DIR/vad-linked-libraries.txt"
if grep -Eiq 'Metal\.framework|Accelerate\.framework|vecLib\.framework|libomp' \
  "$EVIDENCE_DIR/vad-linked-libraries.txt"; then
  echo 'VAD binary unexpectedly links a GPU/Accelerate/OpenMP library.' >&2
  exit 1
fi
if ! awk '
  NR > 1 && NF {
    path = $1
    if (path !~ /^\/System\/Library\// && path !~ /^\/usr\/lib\//) {
      print "non-system dynamic dependency: " path > "/dev/stderr"
      bad = 1
    }
  }
  END { exit bad }
' "$EVIDENCE_DIR/vad-linked-libraries.txt"; then
  echo 'VAD binary unexpectedly links a non-system dynamic library.' >&2
  exit 1
fi

python - "$SILENCE" <<'PY'
import sys
import wave

with wave.open(sys.argv[1], "wb") as handle:
    handle.setnchannels(1)
    handle.setsampwidth(2)
    handle.setframerate(16000)
    handle.writeframes(b"\x00\x00" * (16000 * 2))
PY

run_case() {
  local label="$1"
  local input_path="$2"
  local threshold="$3"
  local expected_min="$4"
  local expected_exact="$5"
  local output="$EVIDENCE_DIR/vad-${label}.txt"
  local timing="$EVIDENCE_DIR/vad-${label}.time"
  local status
  local segments
  local real_seconds
  local user_seconds
  local sys_seconds

  set +e
  /usr/bin/time -p "$VAD_BIN" -t 1 -vt "$threshold" -vm "$MODEL" -f "$input_path" --no-prints \
    >"$output" 2>"$timing"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    echo "VAD case failed: $label (exit=$status)" >&2
    return 1
  fi
  segments="$(grep -Eo 'Detected [0-9]+ speech segments' "$output" | tail -n 1 | awk '{print $2}' || true)"
  if ! printf '%s' "$segments" | grep -Eq '^[0-9]+$'; then
    echo "VAD case had no safe segment count: $label" >&2
    return 1
  fi
  if [ "$segments" -lt "$expected_min" ]; then
    echo "VAD case detected too few segments: $label count=$segments" >&2
    return 1
  fi
  if [ "$expected_exact" != '-' ] && [ "$segments" -ne "$expected_exact" ]; then
    echo "VAD case expected exact segment count: $label expected=$expected_exact actual=$segments" >&2
    return 1
  fi
  real_seconds="$(awk '$1 == "real" {print $2}' "$timing" | tail -n 1)"
  user_seconds="$(awk '$1 == "user" {print $2}' "$timing" | tail -n 1)"
  sys_seconds="$(awk '$1 == "sys" {print $2}' "$timing" | tail -n 1)"
  printf 'case=%s inputClass=%s vadThreshold=%s exitCode=%s segmentCount=%s realSeconds=%s userSeconds=%s sysSeconds=%s\n' \
    "$label" "$label" "$threshold" "$status" "$segments" \
    "${real_seconds:-unknown}" "${user_seconds:-unknown}" "${sys_seconds:-unknown}" \
    >>"$EVIDENCE_DIR/vad-results.txt"
}

: >"$EVIDENCE_DIR/vad-results.txt"
run_case jfk "$JFK" 0.50 1 -
run_case silence-threshold-035 "$SILENCE" 0.35 0 0
run_case silence-threshold-050 "$SILENCE" 0.50 0 0
run_case silence-threshold-070 "$SILENCE" 0.70 0 0
