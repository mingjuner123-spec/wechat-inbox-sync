'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ASR_STARTUP_TIMEOUT_MS = 120000;
const ASR_STARTUP_POLL_MS = 500;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
function extractManagedScript(installer) {
  const marker = `cat > "$INSTALL_ROOT/transcribe.sh" <<'SCRIPT'\n`;
  const normalized = String(installer || '').replace(/\r\n/g, '\n');
  const start = normalized.indexOf(marker);
  if (start < 0) return '';
  const end = normalized.indexOf('\nSCRIPT', start + marker.length);
  return end < 0 ? '' : normalized.slice(start + marker.length, end) + '\n';
}
function replaceExactlyOnce(text, before, after) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw Error('unsupported_wrapper_shape');
  return text.replace(before, after);
}
// The byte-matched managed template has ONE mkdir mutex for prep/start/timeout.
// A timeout winner never removes it; a late wrapper cannot start native code.
function instrumentManagedScript(source, { installRoot, directory }) {
  const gate = quote(path.join(directory, 'gate').replace(/\\/g, '/'));
  const started = quote(path.join(directory, 'started').replace(/\\/g, '/'));
  const protocol = `
WI_ASR_GATE=${gate}
WI_ASR_STARTED=${started}
WI_ASR_GRANTED=0
wi_asr_start() {
  if [ "$WI_ASR_GRANTED" = 1 ]; then return 0; fi
  /bin/mkdir "$WI_ASR_GATE" 2>/dev/null || return 75
  # Permission is conservative: NOT evidence of native exec or progress.
  : > "$WI_ASR_STARTED" || return 75
  WI_ASR_GRANTED=1
}
wi_asr_prep() {
  /bin/mkdir "$WI_ASR_GATE" 2>/dev/null || return 75
  local wi_rc=0
  "$@" || wi_rc=$?
  /bin/rmdir "$WI_ASR_GATE" || return 75
  return "$wi_rc"
}
`;
  let result = replaceExactlyOnce(source, 'set -euo pipefail\n', 'set -euo pipefail\n' + protocol);
  result = replaceExactlyOnce(result, 'ROOT="$(cd "$(dirname "$0")" && pwd)"', 'ROOT=' + quote(installRoot.replace(/\\/g, '/')));
  result = replaceExactlyOnce(result, '"$FFMPEG" -hide_banner -i "$INPUT_PATH"', 'wi_asr_prep "$FFMPEG" -hide_banner -i "$INPUT_PATH"');
  result = replaceExactlyOnce(result, '"$WHISPER" --help', 'wi_asr_prep "$WHISPER" --help');
  result = replaceExactlyOnce(result, '  "$@" >> "$RUN_LOG" 2>&1 &', `  local wi_prep=0
  if [ "$stage" = transcribing ]; then
    wi_asr_start || return 75
  else
    /bin/mkdir "$WI_ASR_GATE" 2>/dev/null || return 75
    wi_prep=1
  fi
  "$@" >> "$RUN_LOG" 2>&1 &`);
  result = replaceExactlyOnce(result, '  wait "$native_pid" || native_exit=$?', '  wait "$native_pid" || native_exit=$?\n  if [ "$wi_prep" = 1 ]; then /bin/rmdir "$WI_ASR_GATE" || return 75; fi');
  return result;
}
function prepareStartupAttempt({ platform = process.platform, managed, installRoot, installerSource, commandTemplate, inputPath, outputPath, timeoutMs = ASR_STARTUP_TIMEOUT_MS, now = () => Number(process.hrtime.bigint() / 1000000n) } = {}) {
  const evidence = { status: 'skipped', reason: 'unsupported_platform', timeoutMs: ASR_STARTUP_TIMEOUT_MS, permissionGranted: false, nativeStartStatus: 'unknown', elapsedIdleMs: 0 };
  const skipped = reason => ({ enabled: false, evidence: Object.assign(evidence, { reason }), dispose() {} });
  if (platform !== 'darwin') return skipped('unsupported_platform');
  if (!managed) return skipped('unmanaged_wrapper');
  let directory = '';
  try {
    const scriptPath = path.join(installRoot, 'transcribe.sh');
    const stat = fs.lstatSync(scriptPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) return skipped('unsupported_wrapper_file');
    const original = fs.readFileSync(scriptPath);
    evidence.originalScriptSha256 = sha(original);
    const source = original.toString('utf8').replace(/\r\n/g, '\n');
    const expected = extractManagedScript(installerSource);
    if (!expected || source !== expected) return skipped('unknown_wrapper_template');
    // Never silently drop custom shell operations, flags or substitutions.
    const commandPath = installRoot.replace(/\\/g, '/') + '/transcribe.sh';
    const homePath = '$HOME/' + path.relative(os.homedir(), installRoot).replace(/\\/g, '/') + '/transcribe.sh';
    const accepted = [commandPath, homePath].map(p => `/bin/bash "${p}" --input {input} --output {output}`);
    if (!accepted.includes(commandTemplate)) return skipped('unknown_command_template');
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-asr-startup-'));
    const instrumented = instrumentManagedScript(source, { installRoot, directory });
    const temporaryScript = path.join(directory, 'transcribe.sh');
    fs.writeFileSync(temporaryScript, instrumented, { flag: 'wx', mode: 0o700 });
    Object.assign(evidence, { status: 'waiting', reason: 'atomic_gate_pending', instrumentedScriptSha256: sha(instrumented), timeoutMs: Math.max(1, Number(timeoutMs) || ASR_STARTUP_TIMEOUT_MS) });
    const gate = path.join(directory, 'gate');
    const started = path.join(directory, 'started');
    const runLog = path.join(installRoot, 'transcribe-last.log');
    const logStamp = () => { try { const s = fs.statSync(runLog); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`; } catch (_) { return ''; } };
    let stamp = logStamp();
    let lastActivity = now();
    let stopped = false;
    const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
    return {
      enabled: true, evidence, directory,
      command: `/bin/bash ${quote(temporaryScript.replace(/\\/g, '/'))} --input ${quote(inputPath.replace(/\\/g, '/'))} --output ${quote(outputPath.replace(/\\/g, '/'))}`,
      observeGrant() {
        try { if (exists(started)) {
          evidence.status = 'permission_granted'; evidence.reason = 'wrapper_won_atomic_gate'; evidence.permissionGranted = true;
          stopped = true;
        } } catch (_) { /* No unproven native state. */ }
      },
      poll() {
        if (stopped) return null;
        try {
          if (exists(started)) {
            evidence.status = 'permission_granted'; evidence.reason = 'wrapper_won_atomic_gate'; evidence.permissionGranted = true;
            stopped = true; return null;
          }
          // An existing gate can be prep, a grant being recorded, or timeout.
          // Never infer timeout victory from an existing/unreadable gate.
          if (exists(gate)) { lastActivity = now(); evidence.reason = 'preparation_or_grant_in_progress'; return null; }
          const next = logStamp();
          if (next !== stamp) { stamp = next; lastActivity = now(); }
          evidence.elapsedIdleMs = Math.max(0, now() - lastActivity);
          if (evidence.elapsedIdleMs < evidence.timeoutMs) return null;
          try { fs.mkdirSync(gate); }
          catch (e) { if (e.code === 'EEXIST') return null; throw e; }
          stopped = true;
          evidence.nativeStartStatus = 'not_started';
          evidence.status = 'timed_out'; evidence.reason = 'timeout_won_atomic_gate';
          const error = new Error('本地转写引擎尚未启动，连续120秒无响应，已结束本次等待并记录诊断。');
          error.code = 'ASR_STARTUP_TIMEOUT'; error.asrStage = 'transcribe_startup';
          error.killed = true; error.signal = 'SIGTERM'; error.cleanupStatus = 'pending';
          return error;
        } catch (_) { stopped = true; evidence.status = 'disabled'; evidence.reason = 'gate_io_unavailable'; return null; }
      },
      dispose() {
        stopped = true;
        // Atomic retirement makes late mkdir fail ENOENT, never reopens a gate.
        try { const retired = directory + '.retired'; fs.renameSync(directory, retired); fs.rmSync(retired, { recursive: true, force: true }); } catch (_) { /* Isolated temp files may remain; component unchanged. */ }
      },
    };
  } catch (_) {
    if (directory) { try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) {} }
    return skipped('startup_guard_prepare_failed');
  }
}
module.exports = { ASR_STARTUP_TIMEOUT_MS, ASR_STARTUP_POLL_MS, extractManagedScript, instrumentManagedScript, prepareStartupAttempt };
