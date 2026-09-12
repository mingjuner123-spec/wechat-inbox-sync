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
  const visit = (obj) => { if (!obj || typeof obj !== 'object') return; for (const [key, value] of Object.entries(obj)) { if (typeof value === 'string' && /token|secret|api.?key|password|authorization|cookie/i.test(key) && value) secrets.push(value); else if (typeof value === 'object') visit(value); } };
  visit(settings);
  for (const secret of secrets.sort((a,b) => b.length-a.length)) text = String(text).split(secret).join('[REDACTED]');
  return redactKnownCredentials(String(text || ''), settings)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL REDACTED]')
    .replace(/(?:\/Users\/|\/home\/)[^\s/"']+/g, '/Users/[USER]')
    .replace(/[A-Z]:[\\/]Users[\\/][^\s\\/"']+/gi, 'C:/Users/[USER]')
    .replace(/((?:bindingToken|token|secret|authorization|cookie|api[_-]?key|password)\s*[=:]\s*)[^\r\n]+/gi, '$1[REDACTED]')
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
function matchesBinaryPath(value, session) {
  return Boolean(value && session?.runtime?.binaryPathSha256 && crypto.createHash('sha256').update(String(value).trim()).digest('hex') === session.runtime.binaryPathSha256);
}
function readMatchingCrashSummary(session, { directory = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports'), fileSystem = fs } = {}) {
  if (!session || session.platform !== 'darwin' || !session.startedAt || !session.finishedAt) return '[unavailable: no matching Mac run]';
  const pids = (session.attempts || []).flatMap(a => a.nativePids || []).map(Number).filter(n => n > 0);
  if (!pids.length) return '[unavailable: native pid not recorded]';
  try {
    const start = Date.parse(session.startedAt) - 5000; const end = Date.parse(session.finishedAt) + 300000;
    const entries = fileSystem.readdirSync(directory).filter(n => /^(?:whisper(?:-cli|-cpp)?|main)[-_].*\.(?:ips|crash)$/i.test(n)).slice(-100);
    for (const name of entries.reverse()) {
      const file = path.join(directory, name); const stat = fileSystem.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mtimeMs < start || stat.mtimeMs > end || stat.size > 1024 * 1024) continue;
      const text = boundedRead(file, 1024 * 1024, fileSystem);
      if (name.endsWith('.ips')) {
        let report; try { report = JSON.parse(text); } catch (_) { try { report = JSON.parse(text.slice(text.indexOf('\n') + 1)); } catch (_) { continue; } }
        if (!pids.includes(Number(report.pid)) || !/^whisper(?:-cli|-cpp)?$/.test(report.procName || '') && !matchesBinaryPath(report.procPath, session)) continue;
        const captured = Date.parse(report.captureTime || '');
        if (!Number.isFinite(captured) || captured < start || captured > end) continue;
        const thread = report.threads?.[report.faultingThread];
        return JSON.stringify({ process: report.procName, pid: report.pid, exception: report.exception, termination: report.termination, faultingThread: report.faultingThread, frames: (thread?.frames || []).slice(0, 25).map(f => ({ symbol: f.symbol, imageIndex: f.imageIndex, imageOffset: f.imageOffset })) }, null, 2);
      }
      const proc = text.match(/^Process:\s+(\S+)\s+\[(\d+)\]/m);
      if (!proc || (!/^whisper(?:-cli|-cpp)?$/.test(proc[1]) && !(proc[1] === 'main' && matchesBinaryPath(text.match(/^Path:\s+(.+)$/m)?.[1], session))) || !pids.includes(Number(proc[2]))) continue;
      const crashTime = Date.parse(text.match(/^Date\/Time:\s+(.+)$/m)?.[1] || '');
      if (!Number.isFinite(crashTime) || crashTime < start || crashTime > end) continue;
      return text.split('\n').filter(line => /^(Process:|Date\/Time:|Exception |Termination |Crashed Thread:|Thread \d+ Crashed:|\d+\s+\S+\s+0x)/.test(line)).slice(0, 40).join('\n');
    }
  } catch (_) { return '[unavailable: crash reports not accessible]'; }
  return '[unavailable: no report matching time and native pid]';
}
function saveSession(root, session, settings) {
  const redact = value => typeof value === 'string' ? diagnosticRedact(value, settings) : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,redact(v)])) : value;
  try { fs.writeFileSync(path.join(root, 'asr-diagnostic-last.json'), JSON.stringify(redact(session), null, 2), { mode: 0o600 }); } catch (_) {}
}
function detailedDiagnostic(root, settings = {}) {
  const stored = boundedRead(path.join(root, 'asr-diagnostic-last.json'), 768 * 1024);
  let session; try { session = JSON.parse(stored); } catch (_) {}
  const identity = runtimeIdentity(root);
  const sections = [
    '详细 ASR 诊断 v1（本地生成；未自动上传）',
    '日志每项最多 256 KiB；超出明确标记；stdout/识别文本不导出。',
    JSON.stringify({ platform: os.platform(), arch: os.arch(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), freeMemoryBytesNow: os.freemem(), memoryNote: '当前空闲内存不能单独判断转写时内存不足', runtime: identity, modelSha256: digestFile(path.join(root, 'models', 'ggml-small.bin')) }, null, 2),
    '--- 本次任务及尝试 ---', stored,
    '--- 转写日志（首尾有界） ---', session || /status=failed|Segmentation fault|--- error ---/.test(readDiagnosticLog(path.join(root, 'transcribe-last.log'))) ? readDiagnosticLog(path.join(root, 'transcribe-last.log')) : '[旧成功日志省略]',
    '--- 安装日志（首尾有界） ---', readDiagnosticLog(path.join(root, 'install.log')),
    '--- 匹配的系统崩溃摘要 ---', readMatchingCrashSummary(session),
  ];
  return diagnosticRedact(sections.join('\n'), settings);
}
module.exports = { RECOVERY_MARKER, isMacNativeCrash, executeWithMacRecovery, boundedRead, readDiagnosticLog, diagnosticRedact, runtimeIdentity, fingerprint, cpuPreference, saveCpuPreference, saveSession, detailedDiagnostic, readMatchingCrashSummary };

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
