'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { redactKnownCredentials } = require('./diagnostic-redaction-utils');

const RECOVERY_MARKER = 'macos-cpu-recovery-v1';
function isMacNativeCrash(error) {
  if (error?.asrStage && error.asrStage !== 'transcribing') return false;
  return Boolean(error && (error.signal === 'SIGSEGV' || error.signal === 'SIGABRT'
    || [134, 139].includes(Number(error.exitCode ?? error.code))
    || /Segmentation fault|SIGSEGV|SIGABRT|Abort trap:\s*6/i.test(`${error.message || ''}\n${error.stderr || ''}`)));
}
function abortCheck(signal) {
  if (signal && signal.aborted) { const error = new Error('Aborted'); error.name = 'AbortError'; throw error; }
}
async function executeWithMacRecovery({ platform, managed, signal, cpuPreferred = false, execute, onAttempt = () => {} }) {
  const notify = async (event) => { try { await onAttempt(event); } catch (_) { /* Diagnostics cannot change transcription outcomes. */ } };
  let cpu = Boolean(cpuPreferred && platform === 'darwin' && managed);
  for (let attempt = 1; attempt <= 2; attempt++) {
    abortCheck(signal);
    try {
      const result = await execute({ cpu, attempt });
      abortCheck(signal);
      await notify({ attempt, cpu, status: 'success', result });
      return { ...result, cpu, attempts: attempt };
    } catch (error) {
      await notify({ attempt, cpu, status: signal && signal.aborted ? 'cancelled' : 'failed', error });
      abortCheck(signal);
      if (error.name === 'AbortError' || platform !== 'darwin' || !managed || cpu || attempt > 1 || !isMacNativeCrash(error)) throw error;
      cpu = true;
    }
  }
}
function boundedRead(file, limit = 256 * 1024, fileSystem = fs) {
  let fd;
  try {
    const stat = fileSystem.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return '[unavailable: not a regular file]';
    fd = fileSystem.openSync(file, 'r');
    if (stat.size <= limit) {
      const bytes = Buffer.alloc(stat.size); const count = fileSystem.readSync(fd, bytes, 0, bytes.length, 0);
      return bytes.subarray(0, count).toString('utf8');
    }
    const half = Math.floor(limit / 2); const head = Buffer.alloc(half); const tail = Buffer.alloc(half);
    fileSystem.readSync(fd, head, 0, half, 0); fileSystem.readSync(fd, tail, 0, half, stat.size - half);
    const headText = head.toString('utf8'); const tailText = tail.toString('utf8');
    const safeHead = headText.slice(0, Math.max(0, headText.lastIndexOf('\n')));
    const firstNewline = tailText.indexOf('\n');
    const safeTail = firstNewline < 0 ? '' : tailText.slice(firstNewline + 1);
    return `${safeHead}\n[TRUNCATED: at least ${stat.size - limit} bytes omitted; partial boundary lines omitted]\n${safeTail}`;
  } catch (_) { return '[unavailable: missing or unreadable]'; }
  finally { if (fd !== undefined) fileSystem.closeSync(fd); }
}
function readDiagnosticLog(file) {
  let text = boundedRead(file);
  if (path.basename(file) === 'transcribe-last.log') {
    // Older successful runs can contain plain transcript text without a stdout
    // marker. Preserve technical fields only, including when a later failure
    // wrapper was appended to that successful run.
    text = text.split(/(?=--- plugin wrapper ---)/).map(block => {
      if (!/(?:^|\n)status=success(?:\r?\n|$)/.test(block)) return block;
      return '[Successful-run body omitted]\n' + block.split('\n').filter(line => /^(?:progress[A-Z]\w*=|native[A-Z]\w*=|cpuOnlyRequested=|resourceSampleTime=|status=|time=|recoveryVersion=|whisper_|ggml_|system_info:|main: processing|--- (?:plugin wrapper|stdout|stderr|error) ---)/.test(line)).join('\n');
    }).join('');
  }
  const marker = text.indexOf('[TRUNCATED:');
  if (marker < 0) return text;
  const end = text.indexOf('\n', marker);
  // A tail may start inside an omitted stdout section. Keep only structured
  // diagnostic lines there, never an unlabelled fragment of user speech.
  const tail = text.slice(end + 1).split('\n').filter(line => /^(?:progress[A-Z]\w*=|native[A-Z]\w*=|cpuOnlyRequested=|resourceSampleTime=|status=|time=|recoveryVersion=|whisper_|ggml_|system_info:|main: processing|--- (?:plugin wrapper|stderr|error) ---|.*Segmentation fault|.*Abort trap:)/.test(line)).join('\n');
  return text.slice(0, end + 1) + '[Unstructured truncated tail omitted]\n' + tail;
}
function diagnosticRedact(text, settings = {}) {
  const secrets = [];
  const visit = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string'
        && /token|secret|api.?key|password|authorization|cookie|binding.?code|redeem.?code|activation.?code|license.?code|openid|account.?id/i.test(key)
        && value) secrets.push(value);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(settings);
  let result = String(text || '');
  for (const secret of secrets.sort((a, b) => b.length - a.length)) result = result.split(secret).join('[REDACTED]');
  return redactKnownCredentials(result, settings)
    .replace(/(?:\\\\|\/\/)[^\\/\s]+[\\/][^\s"'<>|)]+/g, '[LOCAL PATH REDACTED]')
    .replace(/\\(?:Users|home)\\[^\s"'<>|)]+/g, '[LOCAL PATH REDACTED]')
    .replace(/(["']?(?:password|passphrase|cookie|set-cookie|authorization|token|secret|api[_-]?key|bindingCode|redeemCode|activationCode|licenseCode)["']\s*:\s*["'])[^"']*(["'])/gi, '$1[REDACTED]$2')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL REDACTED]')
    .replace(/\b[A-Z]:[\\/](?:[^\s"'<>|]+[\\/])*[^\s"'<>|]*/gi, '[LOCAL PATH REDACTED]')
    .replace(/\/(?:Users|home)\/[^\s"'<>|)]+/g, '[LOCAL PATH REDACTED]')
    .replace(/((?:bindingToken|bindingCode|redeemCode|activationCode|licenseCode|token|secret|authorization|cookie|api[_-]?key|password)\s*[=:]\s*)[^\r\n]*/gi, '$1[REDACTED]')
    .replace(/(?:^|\n)(?:set-cookie|cookie)\s*:\s*[^\r\n]*/gi, '[COOKIE REDACTED]')
    .replace(/^[\t ]*\[\d\d:\d\d:[\d.,]+\s*-->[^\n]*$/gm, '[TRANSCRIPT OMITTED]')
    .replace(/^(inputPath|outputPath|tempWorkDir|command)=.*$/gm, '$1=[LOCAL PATH/COMMAND OMITTED]')
    .replace(/--- stdout ---[\s\S]*?(?=--- stderr ---|$)/g, '--- stdout ---\n[OMITTED: may contain transcript]\n');
}
function digestFile(file) {
  let fd;
  try {
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) return 'unavailable';
    const hash = crypto.createHash('sha256'); fd = fs.openSync(file, 'r'); const buffer = Buffer.alloc(1024 * 1024);
    let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n));
    return hash.digest('hex');
  } catch (_) { return 'unavailable'; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function packageVersions(root) {
  try {
    const lib = path.join(root, 'venv', 'lib');
    const versions = [];
    for (const py of fs.readdirSync(lib).filter(n => /^python3\.\d+$/.test(n)).slice(0, 3)) {
      const packages = path.join(lib, py, 'site-packages');
      for (const name of fs.readdirSync(packages).filter(n => /^whisper.*\.dist-info$/.test(n)).slice(0, 3)) {
        const metadata = boundedRead(path.join(packages, name, 'METADATA'), 16384);
        versions.push({ name: metadata.match(/^Name: (.+)$/m)?.[1] || 'unknown', version: metadata.match(/^Version: (.+)$/m)?.[1] || 'unknown' });
      }
    }
    return versions.length ? versions : 'unavailable';
  } catch (_) { return 'unavailable'; }
}
function runtimeIdentity(root, platform = os.platform(), status = {}) {
  if (platform === 'win32') {
    const candidates = ['bin/whisper-cli.exe', 'bin/main.exe', 'whisper/whisper-cli.exe', 'whisper/main.exe'].map(name => path.join(root, name));
    const binary = status.whisperPath || candidates.find(file => fs.existsSync(file)) || candidates[0];
    return { platform, pythonPackages: 'not-used-by-native-windows-asr', nativeBuildVersion: 'binary SHA identifies exact build', binaryPathSha256: crypto.createHash('sha256').update(binary).digest('hex'), scriptSha256: digestFile(path.join(root, 'transcribe.ps1')), wrapperSha256: digestFile(path.join(root, 'transcribe.ps1')), binarySha256: digestFile(binary), binary };
  }
  const wrapper = boundedRead(path.join(root, 'bin', 'whisper-cli'), 16384);
  const match = wrapper.match(/^WHISPER_CPP_BIN="([^"\r\n]+)"$/m);
  const binary = match ? match[1] : path.join(root, 'bin', 'whisper-cli');
  return { pythonPackages: packageVersions(root), nativeBuildVersion: 'See native help/install log; binary SHA identifies exact build', binaryPathSha256: crypto.createHash('sha256').update(binary).digest('hex'), scriptSha256: digestFile(path.join(root, 'transcribe.sh')), wrapperSha256: digestFile(path.join(root, 'bin', 'whisper-cli')), binarySha256: digestFile(binary), binary };
}
function cpuPreference(root, identity) {
  try { const saved = JSON.parse(boundedRead(path.join(root, 'asr-cpu-mode.json'), 4096)); return saved.fingerprint === identity && saved.cpu === true; } catch (_) { return false; }
}
function saveCpuPreference(root, fingerprint) {
  try { fs.writeFileSync(path.join(root, 'asr-cpu-mode.json'), JSON.stringify({ cpu: true, fingerprint }), { mode: 0o600 }); } catch (_) {}
}
function fingerprint(identity) { return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex'); }
function systemIdentity(platform = os.platform()) {
  const cpus = os.cpus() || [];
  return {
    platform,
    architecture: os.arch(),
    release: os.release(),
    cpuModel: cpus[0]?.model || 'unavailable',
    logicalCpus: cpus.length || null,
    totalMemoryBytes: os.totalmem(),
  };
}
function modelIdentity(root, { managed = true } = {}) {
  if (!managed) return { scope: 'custom_command', modelUsed: 'unknown' };
  const file = path.join(root, 'models', 'ggml-small.bin');
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) return { scope: 'managed_default_component', fileName: 'ggml-small.bin', status: 'unavailable' };
    return { scope: 'managed_default_component', modelUsed: 'ggml-small.bin', fileName: 'ggml-small.bin', sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
  } catch (_) { return { scope: 'managed_default_component', fileName: 'ggml-small.bin', status: 'unavailable' }; }
}
function snapshotDiagnosticLog(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) return { state: 'unavailable' };
    const sample = boundedRead(file, 256 * 1024);
    if (sample.startsWith('[unavailable:')) return { state: 'unavailable' };
    return {
      state: 'present', sizeBytes: st.size, modifiedAtMs: st.mtimeMs,
      fingerprint: crypto.createHash('sha256').update(`${st.size}\n${st.mtimeMs}\n${sample}`).digest('hex'),
    };
  } catch (error) {
    return error && error.code === 'ENOENT' ? { state: 'absent' } : { state: 'unavailable' };
  }
}
function diagnosticLogFreshness(before, after) {
  if (!after || after.state !== 'present') return 'unavailable';
  if (before?.state === 'absent') return 'fresh';
  if (before?.state === 'present' && before.fingerprint !== after.fingerprint) return 'fresh';
  if (before?.state === 'unavailable') return 'unavailable';
  return 'stale';
}
function latestNativeExitForFinalStage(text, expectedStage = '') {
  let currentStage = '';
  let activePid = null;
  let activeStage = '';
  let latest = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const stage = line.match(/^progressStage=([A-Za-z0-9_-]+)$/);
    if (stage) currentStage = stage[1];
    const pid = line.match(/^progressPid=(\d+)$/);
    if (pid) {
      const value = Number(pid[1]);
      activePid = value > 0 ? value : null;
      activeStage = activePid ? currentStage : '';
      continue;
    }
    const exit = line.match(/^nativeExit=(-?\d+)$/);
    if (exit && activePid) {
      latest = { nativeExitCode: Number(exit[1]), nativePid: activePid, stage: activeStage };
      activePid = null;
      activeStage = '';
    }
  }
  if (activePid) return { nativeExitCode: null, nativePid: activePid, stage: activeStage, reason: 'incomplete_native_process' };
  if (!latest) return { nativeExitCode: null, nativePid: null, stage: '', reason: 'no_matched_native_exit' };
  if (expectedStage && expectedStage !== 'unknown' && latest.stage !== expectedStage) {
    return { nativeExitCode: null, nativePid: latest.nativePid, stage: latest.stage, reason: 'stage_mismatch' };
  }
  return { ...latest, reason: 'matched' };
}

function matchesBinaryPath(value, session) {
  return Boolean(value && session?.runtime?.binaryPathSha256 && crypto.createHash('sha256').update(String(value).trim()).digest('hex') === session.runtime.binaryPathSha256);
}
function parseTimestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}
function getCrashAssociation(session, pid, capturedAt) {
  const attempts = Array.isArray(session?.attempts) ? session.attempts : [];
  const sameAttempt = attempts.find((attempt) => {
    if (!(attempt?.nativePids || []).map(Number).includes(Number(pid))) return false;
    const startedAt = parseTimestamp(attempt.startedAt);
    const finishedAt = parseTimestamp(attempt.finishedAt || attempt.at);
    if (startedAt === null || finishedAt === null) return false;
    return capturedAt >= startedAt - 5000 && capturedAt <= finishedAt + 5000;
  });
  return {
    reliability: sameAttempt ? 'same_attempt_pid_and_time' : 'session_window_pid_and_time',
    attempt: sameAttempt?.attempt ?? null,
    pidMatched: true,
    captureTimeInAttemptWindow: Boolean(sameAttempt),
    pidReuseRisk: !sameAttempt,
  };
}
const CRASH_REPORT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const CRASH_REPORT_MAX_TOTAL_READ_BYTES = 16 * 1024 * 1024;
const CRASH_REPORT_BUDGET_UNAVAILABLE = '[unavailable: crash report read budget exceeded]';
const CRASH_REPORT_NAME_PATTERN = /^(?:whisper(?:-cli|-cpp)?|main)[-_].*\.(?:ips|crash)$/i;
function defaultCrashReportDirectories() {
  const userDirectory = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
  const systemDirectory = path.join(path.parse(userDirectory).root, 'Library', 'Logs', 'DiagnosticReports');
  return [...new Set([userDirectory, systemDirectory])];
}
function readCompleteCrashReport(file, stat, fileSystem) {
  const size = Number(stat && stat.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > CRASH_REPORT_MAX_FILE_BYTES) {
    return { status: 'budget' };
  }
  let fd;
  try {
    fd = fileSystem.openSync(file, 'r');
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fileSystem.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!Number.isInteger(count) || count <= 0) return { status: 'read_failed' };
      offset += count;
    }
    return { status: 'ok', text: bytes.toString('utf8') };
  } catch (_) {
    return { status: 'read_failed' };
  } finally {
    if (fd !== undefined) {
      try { fileSystem.closeSync(fd); } catch (_) { /* A failed close cannot change the scan result. */ }
    }
  }
}
function parseIpsCrashReport(text) {
  const source = String(text || '');
  const firstNewline = source.indexOf('\n');
  const candidates = firstNewline < 0 ? [source] : [source, source.slice(firstNewline + 1)];
  for (const candidate of candidates) {
    try {
      const report = JSON.parse(candidate);
      if (report && typeof report === 'object' && !Array.isArray(report)) return report;
    } catch (_) { /* The first line is often a metadata object; try the full body next. */ }
  }
  return null;
}
function summarizeCrashValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 256);
  if (!value || typeof value !== 'object' || depth >= 2) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 16).map(item => summarizeCrashValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 16).map(([key, item]) => [key.slice(0, 64), summarizeCrashValue(item, depth + 1)]));
}
function buildIpsCrashSummary(report, session, captured) {
  const thread = Array.isArray(report.threads) ? report.threads[report.faultingThread] : null;
  const safeNumber = value => {
    if (value === null || value === undefined || value === '') return undefined;
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
  };
  const frames = (Array.isArray(thread?.frames) ? thread.frames : [])
    .filter(frame => frame && typeof frame === 'object' && !Array.isArray(frame))
    .slice(0, 25)
    .map(frame => Object.fromEntries(Object.entries({
      symbol: typeof frame.symbol === 'string' ? frame.symbol.slice(0, 256) : undefined,
      imageIndex: safeNumber(frame.imageIndex),
      imageOffset: safeNumber(frame.imageOffset),
    }).filter(([, value]) => value !== undefined)));
  const referencedImageIndexes = [...new Set(frames.map(frame => safeNumber(frame.imageIndex)).filter(Number.isSafeInteger))].sort((left, right) => left - right);
  const normalizeImage = (image, index) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
    const name = typeof image?.name === 'string'
      ? image.name.replace(/\\/g, '/').split('/').pop().slice(0, 256)
      : undefined;
    const normalized = {
      index: safeNumber(index),
      name,
      uuid: typeof image?.uuid === 'string' ? image.uuid.slice(0, 128) : undefined,
      arch: typeof image?.arch === 'string' ? image.arch.slice(0, 64) : undefined,
      base: safeNumber(image?.base),
      size: safeNumber(image?.size),
    };
    return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined));
  };
  const usedImages = (Array.isArray(report.usedImages) ? referencedImageIndexes : [])
    .slice(0, 25)
    .map(index => normalizeImage(report.usedImages[index], index))
    .filter(image => image && Number.isSafeInteger(image.index));
  return JSON.stringify({
    process: typeof report.procName === 'string' ? report.procName.slice(0, 64) : undefined,
    pid: safeNumber(report.pid),
    captureTime: new Date(captured).toISOString(),
    associationReliability: getCrashAssociation(session, report.pid, captured),
    exception: summarizeCrashValue(report.exception),
    termination: summarizeCrashValue(report.termination),
    faultingThread: safeNumber(report.faultingThread),
    frames,
    usedImages,
  }, null, 2);
}
function buildTextCrashSummary(text, session, pid, crashTime) {
  const lines = String(text || '').split('\n');
  const headers = lines.filter(line => /^(Process:|Date\/Time:|Exception |Termination |Crashed Thread:)/.test(line)).slice(0, 8).map(line => line.slice(0, 512));
  const crashedThreadLine = lines.find(line => /^Crashed Thread:\s+\d+/.test(line));
  const crashedThreadHeader = lines.find(line => /^Thread\s+\d+\s+Crashed\s*:/.test(line));
  const crashedThread = Number((crashedThreadLine || crashedThreadHeader)?.match(/\d+/)?.[0]);
  let threadHeader = '';
  let inCrashedThread = false;
  const frames = [];
  for (const line of lines) {
    const thread = line.match(/^Thread\s+(\d+)(?:\s+Crashed)?\s*:/);
    if (thread) {
      const markedCrashed = /\s+Crashed\s*::?/.test(line);
      if (!inCrashedThread && ((Number.isFinite(crashedThread) && Number(thread[1]) === crashedThread) || (!Number.isFinite(crashedThread) && markedCrashed))) {
        threadHeader = line.slice(0, 512);
        inCrashedThread = true;
      } else if (inCrashedThread) {
        break;
      }
      continue;
    }
    if (inCrashedThread && /^\d+\s+\S+\s+0x/.test(line)) {
      frames.push(line.slice(0, 512));
      if (frames.length >= 25) break;
    }
  }
  return [
    'associationReliability=' + JSON.stringify(getCrashAssociation(session, pid, crashTime)),
    'captureTime=' + new Date(crashTime).toISOString(),
    ...headers,
    ...(threadHeader ? [threadHeader] : []),
    ...frames,
  ].join('\n');
}
function readMatchingCrashSummary(session, options = {}) {
  const { directory, directories, fileSystem = fs, attempt, discoveryGraceMs = 300000 } = options || {};
  if (!session || session.platform !== 'darwin' || !session.startedAt || !session.finishedAt) {
    return '[unavailable: no matching Mac run]';
  }
  const startedAt = parseTimestamp(session.startedAt);
  const finishedAt = parseTimestamp(session.finishedAt);
  if (startedAt === null || finishedAt === null || finishedAt < startedAt) {
    return '[unavailable: invalid Mac run time]';
  }
  const selectedAttempts = attempt ? [attempt] : (Array.isArray(session.attempts) ? session.attempts : []);
  const pids = selectedAttempts
    .flatMap(attempt => Array.isArray(attempt?.nativePids) ? attempt.nativePids : [])
    .map(Number)
    .filter(pid => Number.isSafeInteger(pid) && pid > 0);
  if (!pids.length) return '[unavailable: native pid not recorded]';

  const selectedStartedAt = attempt ? parseTimestamp(attempt.startedAt) : startedAt;
  const selectedFinishedAt = attempt ? parseTimestamp(attempt.finishedAt || attempt.at) : finishedAt;
  if (selectedStartedAt === null || selectedFinishedAt === null || selectedFinishedAt < selectedStartedAt) {
    return '[unavailable: invalid attempt time]';
  }
  const start = selectedStartedAt - (attempt ? 0 : 5000);
  const end = selectedFinishedAt + Math.max(0, Number(discoveryGraceMs) || 0);
  const exactEnd = selectedFinishedAt + (attempt ? 5000 : 0);
  const scanDirectories = Array.isArray(directories)
    ? directories
    : directory !== undefined
      ? [directory]
      : defaultCrashReportDirectories();
  const candidates = [];
  let accessibleDirectory = false;
  let unreadableCandidate = false;
  for (const scanDirectory of scanDirectories) {
    let entries;
    try {
      entries = fileSystem.readdirSync(scanDirectory);
      accessibleDirectory = true;
    } catch (_) {
      continue;
    }
    for (const name of (Array.isArray(entries) ? entries : [])) {
      if (typeof name !== 'string' || !CRASH_REPORT_NAME_PATTERN.test(name)) continue;
      const file = path.join(scanDirectory, name);
      let stat;
      try {
        stat = fileSystem.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
      } catch (_) {
        unreadableCandidate = true;
        continue;
      }
      const modifiedAt = Number(stat.mtimeMs);
      if (!Number.isFinite(modifiedAt) || modifiedAt < start || modifiedAt > end) continue;
      candidates.push({ file, name, stat, modifiedAt });
    }
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name));

  let totalReadBytes = 0;
  let budgetExceeded = false;
  for (const candidate of candidates) {
    const size = Number(candidate.stat.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > CRASH_REPORT_MAX_FILE_BYTES
      || totalReadBytes + size > CRASH_REPORT_MAX_TOTAL_READ_BYTES) {
      budgetExceeded = true;
      continue;
    }
    totalReadBytes += size;
    const result = readCompleteCrashReport(candidate.file, candidate.stat, fileSystem);
    if (result.status === 'budget') {
      budgetExceeded = true;
      continue;
    }
    if (result.status !== 'ok') {
      unreadableCandidate = true;
      continue;
    }

    if (/\.ips$/i.test(candidate.name)) {
      const report = parseIpsCrashReport(result.text);
      if (!report) continue;
      const processName = String(report.procName || '');
      const processMatched = attempt
        ? matchesBinaryPath(report.procPath, session)
        : /^whisper(?:-cli|-cpp)?$/.test(processName) || matchesBinaryPath(report.procPath, session);
      if (!pids.includes(Number(report.pid)) || !processMatched) continue;
      const captured = parseTimestamp(report.captureTime);
      if (captured === null || captured < start || captured > (attempt ? exactEnd : end)) continue;
      return buildIpsCrashSummary(report, session, captured);
    }

    const proc = result.text.match(/^Process:\s+(\S+)\s+\[(\d+)\]/m);
    const reportBinaryPath = result.text.match(/^Path:\s+(.+)$/m)?.[1];
    const processMatched = proc && (attempt
      ? matchesBinaryPath(reportBinaryPath, session)
      : /^whisper(?:-cli|-cpp)?$/.test(proc[1]) || (proc[1] === 'main' && matchesBinaryPath(reportBinaryPath, session)));
    if (!proc || !processMatched || !pids.includes(Number(proc[2]))) continue;
    const crashTime = parseTimestamp(result.text.match(/^Date\/Time:\s+(.+)$/m)?.[1]);
    if (crashTime === null || crashTime < start || crashTime > (attempt ? exactEnd : end)) continue;
    return buildTextCrashSummary(result.text, session, proc[2], crashTime);
  }
  if (budgetExceeded) return CRASH_REPORT_BUDGET_UNAVAILABLE;
  if (unreadableCandidate) return '[unavailable: crash report candidate unreadable]';
  if (!accessibleDirectory) return '[unavailable: crash reports not accessible]';
  return '[unavailable: no report matching time and native pid]';
}
const DEFAULT_CRASH_REPORT_RETRY_DELAYS_MS = Object.freeze([0, 500, 1000, 2000, 2500]);
async function collectMatchingCrashSummary(session, attempt, options = {}) {
  const delays = (Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : DEFAULT_CRASH_REPORT_RETRY_DELAYS_MS).slice(0, 8);
  const maxWaitMs = Math.min(6000, Math.max(0, Number(options.maxWaitMs ?? 6000) || 0));
  const wait = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let result = '[unavailable: no report matching time and native pid]';
  const baseDiscoveryGraceMs = options.discoveryGraceMs === undefined ? 300000 : Math.max(0, Number(options.discoveryGraceMs) || 0);
  let elapsedMs = 0;
  for (let index = 0; index < delays.length; index++) {
    if (options.signal?.aborted) return '[unavailable: crash report collection cancelled]';
    const pauseMs = Math.min(Math.max(0, Number(delays[index]) || 0), Math.max(0, maxWaitMs - elapsedMs));
    if (pauseMs > 0) await wait(pauseMs);
    elapsedMs += pauseMs;
    if (options.signal?.aborted) return '[unavailable: crash report collection cancelled]';
    result = readMatchingCrashSummary(session, {
      ...options,
      attempt,
      discoveryGraceMs: baseDiscoveryGraceMs + elapsedMs,
    });
    if (result !== '[unavailable: no report matching time and native pid]'
      && result !== '[unavailable: crash report candidate unreadable]') return result;
  }
  return result === '[unavailable: no report matching time and native pid]'
    ? '[unavailable: no report matching attempt before deadline]' : result;
}

function saveSession(root, session, settings) {
  const redact = value => typeof value === 'string' ? diagnosticRedact(value, settings) : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,redact(v)])) : value;
  try { fs.writeFileSync(path.join(root, 'asr-diagnostic-last.json'), JSON.stringify(redact(session), null, 2), { mode: 0o600 }); } catch (_) {}
}
function detailedDiagnostic(root, settings = {}, currentTask = null) {
  let stored = boundedRead(path.join(root, 'asr-diagnostic-last.json'), 768 * 1024);
  let session; try { session = JSON.parse(stored); } catch (_) {}
  const crashAttempts = (['failed', 'cancelled'].includes(session?.status) && Array.isArray(session?.attempts) ? session.attempts : [])
    .filter(attempt => isMacNativeCrash({
      exitCode: attempt.nativeExitCode ?? attempt.exitCode,
      signal: attempt.signal,
      message: attempt.error,
      asrStage: attempt.stage,
    }))
    .slice(0, 2);
  const savedCrashSummaries = crashAttempts.map(attempt => ({
    attempt: attempt.attempt,
    summary: typeof attempt.crashSummary === 'string' && attempt.crashSummaryStatus === 'matched'
      ? attempt.crashSummary
      : readMatchingCrashSummary(session, { attempt }),
  }));
  if (crashAttempts.some(attempt => typeof attempt.crashSummary === 'string')) {
    const displaySession = { ...session, attempts: session.attempts.map(({ crashSummary, crashSummaryStatus, ...attempt }) => attempt) };
    stored = JSON.stringify(displaySession, null, 2);
  }
  const sessionRef = session && session.recordId ? crypto.createHash('sha256').update(String(session.recordId)).digest('hex').slice(0, 16) : '';
  const sameAttempt = Boolean(currentTask && currentTask.transcriptionStarted === true
    && currentTask.attemptId && session && session.diagnosticAttemptId === currentTask.attemptId
    && currentTask.recordRef && sessionRef === currentTask.recordRef
    && Date.parse(session.startedAt) >= Date.parse(currentTask.startedAt)
    && (!currentTask.finishedAt || Date.parse(session.startedAt) <= Date.parse(currentTask.finishedAt)));
  const identity = runtimeIdentity(root);
  const sections = [
    '详细 ASR 诊断 v2（本地生成；未自动上传）',
    '日志每项最多 256 KiB；超出明确标记；stdout/识别文本不导出。',
    JSON.stringify({ system: session?.system || systemIdentity(), freeMemoryBytesNow: os.freemem(), memoryNote: '当前空闲内存不能单独判断转写时内存不足', runtime: session?.runtime || identity, model: session?.model || modelIdentity(root), modelSha256AtReportTime: session?.model?.scope === 'custom_command' ? 'not-collected-custom-model-unknown' : digestFile(path.join(root, 'models', 'ggml-small.bin')) }, null, 2),
    sameAttempt ? '--- 与当前小红书任务匹配的 ASR 尝试 ---' : '--- 最近一次 ASR 历史任务（不代表当前同步已转写）---',
    JSON.stringify({ relation: sameAttempt ? 'same_attempt' : 'historical_or_unconfirmed', recordRef: sessionRef, startedAt: session && session.startedAt || '', currentAttemptId: currentTask && currentTask.attemptId || '', currentTranscriptionStarted: currentTask ? currentTask.transcriptionStarted === true : null }),
    stored,
    '--- 转写日志（首尾有界；日志是否属于各次尝试以 session.attempts.logFreshness 为准） ---', session || /status=failed|Segmentation fault|--- error ---/.test(readDiagnosticLog(path.join(root, 'transcribe-last.log'))) ? readDiagnosticLog(path.join(root, 'transcribe-last.log')) : '[旧成功日志省略]',
    '--- 安装日志（首尾有界） ---', readDiagnosticLog(path.join(root, 'install.log')),
    '--- 匹配的系统崩溃摘要 ---', savedCrashSummaries.length ? savedCrashSummaries.map(item => `attempt=${item.attempt}\n${item.summary}`).join('\n\n') : readMatchingCrashSummary(session),
  ];
  return diagnosticRedact(sections.join('\n'), settings);
}
module.exports = { RECOVERY_MARKER, isMacNativeCrash, executeWithMacRecovery, boundedRead, readDiagnosticLog, diagnosticRedact, runtimeIdentity, systemIdentity, modelIdentity, snapshotDiagnosticLog, diagnosticLogFreshness, latestNativeExitForFinalStage, fingerprint, cpuPreference, saveCpuPreference, saveSession, detailedDiagnostic, readMatchingCrashSummary, collectMatchingCrashSummary, DEFAULT_CRASH_REPORT_RETRY_DELAYS_MS, CRASH_REPORT_MAX_FILE_BYTES, CRASH_REPORT_MAX_TOTAL_READ_BYTES };

// Only migrate the exact managed 1.3.140 script, preserving a versioned backup.
function ensureManagedMacScript(root, installerSource) {
  const target = path.join(root, 'transcribe.sh');
  try {
    const st = fs.lstatSync(target); if (!st.isFile() || st.isSymbolicLink()) return false;
    const existing = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const begin = "cat > \"$INSTALL_ROOT/transcribe.sh\" <<'SCRIPT'\n";
    const from = installerSource.indexOf(begin) + begin.length;
    const to = installerSource.indexOf('\nSCRIPT', from);
    if (from < begin.length || to < from) return false;
    const next = installerSource.slice(from, to) + '\n';
    if (existing === next) return true;
    if (crypto.createHash('sha256').update(existing).digest('hex') !== 'bd84ad38abbbfd9552a4c6caf3f8b6cfd95847f063c262428fdf14dbdc66a91a') return false;
    const backup = target + '.before-macos-cpu-recovery-v1';
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, existing, { flag: 'wx', mode: 0o700 });
    const temp = target + '.macos-cpu-recovery-v1.tmp';
    fs.writeFileSync(temp, next, { flag: 'wx', mode: 0o700 });
    fs.renameSync(temp, target);
    return true;
  } catch (_) { return false; }
}
module.exports.ensureManagedMacScript = ensureManagedMacScript;
