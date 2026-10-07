#!/usr/bin/env bash
# Read-only, synthetic probe for the macOS ASR wrapper lifecycle.
# It never opens user media and never contacts a network service.
set -u

SCRIPT_PATH="$0"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd)"
TMP_PARENT="${TMPDIR:-/tmp}"
TMP_PARENT="${TMP_PARENT%/}"
[ -n "$TMP_PARENT" ] || TMP_PARENT="/"
TMP_ROOT="$(mktemp -d "$TMP_PARENT/wechat-inbox-asr-lifecycle-probe.XXXXXX")" || exit 1
MAX_SECONDS="${MAC_ASR_PROBE_MAX_SECONDS:-8}"
mkdir -p "$TMP_ROOT"

cleanup() {
  case "$TMP_ROOT" in
    "$TMP_PARENT"/wechat-inbox-asr-lifecycle-probe.*) rm -rf -- "$TMP_ROOT" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

if [ "${1:-}" = "--child" ]; then
  case "${2:-}" in
    exit-zero)
      exit 0
      ;;
    exit-nonzero)
      exit 17
      ;;
    sleep)
      sleep "${3:-30}"
      exit 0
      ;;
    *)
      exit 64
      ;;
  esac
fi

if ! printf '%s' "$MAX_SECONDS" | grep -Eq '^[1-9][0-9]*$'; then
  echo "MAC_ASR_PROBE_MAX_SECONDS must be a positive integer" >&2
  exit 64
fi

ps_state() {
  local pid="$1"
  local value
  value="$(ps -p "$pid" -o state= 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$value" ]; then
    value="$(ps -p "$pid" -o stat= 2>/dev/null | tr -d '[:space:]')"
  fi
  printf '%s' "${value:-unavailable}"
}

ps_cpu_time() {
  local pid="$1"
  local value
  value="$(ps -p "$pid" -o time= 2>/dev/null | tr -d '[:space:]')"
  printf '%s' "${value:-unavailable}"
}

run_case() {
  local case_name="$1"
  local child_mode="$2"
  local child_seconds="${3:-30}"
  local run_log="$TMP_ROOT/${case_name}.log"
  local native_pid
  local loop_seconds=0
  local last_state="unavailable"
  local last_cpu="unavailable"
  local wrapper_loop_exit="unknown"
  local native_exit=0
  local zombie_seen=false
  local kill0_after_deadline=false

  # This is intentionally the same background process shape as the live
  # run_with_heartbeat function. Output is redirected so pipe buffering is
  # not part of this probe.
  bash "$SCRIPT_PATH" --child "$child_mode" "$child_seconds" >>"$run_log" 2>&1 &
  native_pid=$!

  while kill -0 "$native_pid" 2>/dev/null && [ "$loop_seconds" -lt "$MAX_SECONDS" ]; do
    last_state="$(ps_state "$native_pid")"
    last_cpu="$(ps_cpu_time "$native_pid")"
    case "$last_state" in
      Z*|z*) zombie_seen=true ;;
    esac
    sleep 1
    loop_seconds=$((loop_seconds + 1))
  done

  if kill -0 "$native_pid" 2>/dev/null; then
    wrapper_loop_exit="deadline_with_kill0"
    kill0_after_deadline=true
    last_state="$(ps_state "$native_pid")"
    last_cpu="$(ps_cpu_time "$native_pid")"
    case "$last_state" in
      Z*|z*) zombie_seen=true ;;
    esac
    # Keep the synthetic probe bounded. The real wrapper would proceed to
    # wait only after this loop; a live child is terminated for cleanup here.
    kill "$native_pid" 2>/dev/null || true
    wait "$native_pid" || native_exit=$?
  else
    wrapper_loop_exit="exited_before_wait"
    # This is the exact ordering used by the live wrapper.
    wait "$native_pid" || native_exit=$?
  fi

  printf 'case=%s childMode=%s wrapperLoopExit=%s nativeExit=%s lastState=%s zombieSeen=%s kill0AfterDeadline=%s cpuTime=%s elapsedLoopSeconds=%s\n' \
    "$case_name" "$child_mode" "$wrapper_loop_exit" "$native_exit" \
    "$last_state" "$zombie_seen" "$kill0_after_deadline" "$last_cpu" "$loop_seconds"

  case "$case_name" in
    exit_zero)
      [ "$wrapper_loop_exit" = "exited_before_wait" ] && [ "$native_exit" -eq 0 ]
      ;;
    exit_nonzero)
      [ "$wrapper_loop_exit" = "exited_before_wait" ] && [ "$native_exit" -eq 17 ]
      ;;
    long_running)
      [ "$wrapper_loop_exit" = "deadline_with_kill0" ] && [ "$kill0_after_deadline" = true ]
      ;;
    *)
      return 1
      ;;
  esac
}

echo "probe=mac-asr-wrapper-lifecycle"
echo "platform=$(uname -s 2>/dev/null || echo unknown)"
echo "shell=${BASH_VERSION:-unknown}"
echo "maxSeconds=$MAX_SECONDS"
failures=0
if ! run_case exit_zero exit-zero 0; then
  echo "assertion=fail case=exit_zero" >&2
  failures=$((failures + 1))
fi
if ! run_case exit_nonzero exit-nonzero 0; then
  echo "assertion=fail case=exit_nonzero" >&2
  failures=$((failures + 1))
fi
if ! run_case long_running sleep "$((MAX_SECONDS + 5))"; then
  echo "assertion=fail case=long_running" >&2
  failures=$((failures + 1))
fi
if [ "$failures" -ne 0 ]; then
  exit 1
fi
