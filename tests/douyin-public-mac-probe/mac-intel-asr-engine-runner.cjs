'use strict';

// Offline Intel-Mac engine probe.  The fixture is downloaded by the workflow
// into the disposable private root before this runner starts.  No online
// Douyin extraction is performed here; that path has its own probe job.
// Only hashes, process results, durations and transcript character counts are
// written to the receipt.  The fixture, transcript and native logs are
// removed with the private root before the receipt is accepted.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { extractTranscribeScript } = require('./prepare-mac-asr-runtime.cjs');

const [receiptRootArg, privateRootArg, fixtureArg, expectedFixtureShaArg,
  candidateBundleArg, expectedCandidateShaArg, productionScriptArg, modelArg,
  ffmpegArg, legacyEngineArg, candidateEngineArg] = process.argv.slice(2);

const receiptRoot = path.resolve(receiptRootArg || process.cwd());
const privateRoot = path.resolve(privateRootArg || path.join(process.cwd(), '.mac-asr-private'));
const fixturePath = path.resolve(fixtureArg || '');
const candidateBundlePath = path.resolve(candidateBundleArg || '');
const productionScriptPath = path.resolve(productionScriptArg || '');
const modelPath = path.resolve(modelArg || '');
const ffmpegPath = path.resolve(ffmpegArg || '');
const legacyEnginePath = path.resolve(legacyEngineArg || '');
const candidateEnginePath = path.resolve(candidateEngineArg || '');
const expectedFixtureSha = String(expectedFixtureShaArg || '').trim().toLowerCase();
const expectedCandidateSha = String(expectedCandidateShaArg || '').trim().toLowerCase();
const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const resultPath = path.join(receiptRoot, `mac-intel-asr-engine-receipt-${runId}.json`);
const runRoot = path.join(privateRoot, `run-${runId}`);

const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_.:-]{1,120}$/;

function sha256File(filePath) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
  catch (_) { return ''; }
}

function safeError(error) {
  if (!error) return null;
  const result = {};
  for (const key of ['code', 'reason']) {
    const value = String(error[key] || '').trim();
    if (TOKEN.test(value)) result[key] = value;
  }
  for (const key of ['exitCode', 'statusCode']) {
    const value = Number(error[key]);
    if (Number.isFinite(value)) result[key] = value;
  }
  if (typeof error.timedOut === 'boolean') result.timedOut = error.timedOut;
  return Object.keys(result).length ? result : { code: 'UNCLASSIFIED_ERROR' };
}

function safeVersion(bundlePath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(bundlePath), 'manifest.json'), 'utf8'));
    const value = String(manifest && manifest.version || '').trim();
    return TOKEN.test(value) ? value : '';
  } catch (_) { return ''; }
}

function runProcess(command, args, timeoutMs, env) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let child; let deadline; let killTimer; let timedOut = false; let settled = false;
    let closed = false; let exitCode = null; let exitSignal = null;
    const finish = () => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(killTimer);
      resolve({ exitCode, signal: exitSignal, timedOut, wallMs: Date.now() - startedAt });
    };
    const killGroup = signal => {
      try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch (_) {}
    };
    try {
      child = childProcess.spawn(command, args, { stdio: 'ignore', detached: process.platform !== 'win32', env: env || process.env });
      child.once('error', finish);
      child.once('close', (code, signal) => { closed = true; exitCode = code; exitSignal = signal; if (!timedOut) finish(); });
      deadline = setTimeout(() => {
        timedOut = true; killGroup('SIGTERM');
        // Wait for the group, not just the shell: its native child may outlive it.
        killTimer = setTimeout(() => { killGroup('SIGKILL'); if (closed) finish(); else setTimeout(finish, 1000); }, 1000);
      }, timeoutMs);
    } catch (_) { finish(); }
  });
}

function classifyFailure(result) {
  if (result && result.timedOut) return 'PROCESS_TIMEOUT';
  if (String(result && result.signal || '').toUpperCase() === 'SIGSEGV') return 'SEGMENTATION_FAULT';
  if (String(result && result.signal || '').toUpperCase() === 'SIGILL') return 'ILLEGAL_INSTRUCTION';
  return 'PROCESS_FAILED';
}

function parseDurationSeconds(filePath) {
  const probe = runProcessCapture(ffmpegPath, ['-hide_banner', '-i', filePath], 30 * 1000);
  const text = `${probe.stdout}\n${probe.stderr}`;
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (!match) return { ...probe, durationSeconds: null };
  const durationSeconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return { ...probe, durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null };
}

function runProcessCapture(command, args, timeoutMs) {
  const startedAt = Date.now();
  try {
    const result = childProcess.spawnSync(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return {
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal || null,
      timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
      wallMs: Date.now() - startedAt,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
    };
  } catch (error) {
    return { exitCode: null, signal: null, timedOut: String(error && error.code || '') === 'ETIMEDOUT', wallMs: Date.now() - startedAt, stdout: '', stderr: '' };
  }
}

function readTranscriptChars(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').trim().length; } catch (_) { return 0; }
}

function linkFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.unlinkSync(target); } catch (_) {}
  fs.symlinkSync(path.resolve(source), target, 'file');
}

function prepareProductionRoot() {
  const root = path.join(runRoot, 'production-wrapper');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.writeFileSync(path.join(root, 'transcribe.sh'), extractTranscribeScript(fs.readFileSync(productionScriptPath, 'utf8')));
  fs.chmodSync(path.join(root, 'transcribe.sh'), 0o700);
  linkFile(candidateEnginePath, path.join(root, 'bin', 'whisper-cli'));
  linkFile(ffmpegPath, path.join(root, 'bin', 'ffmpeg'));
  linkFile(modelPath, path.join(root, 'models', 'ggml-small.bin'));
  return path.join(root, 'transcribe.sh');
}

async function runNativeCase(label, enginePath, wavPath, inputSha, cpuOnly) {
  const root = path.join(runRoot, `case-${label}`);
  const outputBase = path.join(root, 'transcript');
  const outputPath = `${outputBase}.txt`;
  const result = {
    label,
    inputSha256: inputSha,
    engineSha256: sha256File(enginePath),
    modelSha256: sha256File(modelPath),
    status: 'not-run',
    exitCode: null,
    signal: null,
    timedOut: false,
    transcriptPresent: false,
    transcriptChars: 0,
    wallMs: 0,
    failureCode: null,
  };
  if (!fs.existsSync(enginePath) || !fs.existsSync(wavPath)) {
    result.status = 'not-ready';
    result.failureCode = 'INPUT_NOT_READY';
    return result;
  }
  fs.mkdirSync(root, { recursive: true });
  const args = ['-m', modelPath, '-f', wavPath, '-l', 'zh', '-nt', '-otxt', '-of', outputBase];
  if (cpuOnly) args.push('--no-gpu');
  const run = await runProcess(enginePath, args, 150 * 1000);
  result.exitCode = run.exitCode;
  result.signal = run.signal;
  result.timedOut = run.timedOut;
  result.transcriptChars = readTranscriptChars(outputPath);
  result.transcriptPresent = result.transcriptChars > 0;
  result.status = !run.timedOut && run.exitCode === 0 && result.transcriptPresent ? 'success' : (run.timedOut ? 'timeout' : 'failed');
  if (result.status !== 'success') result.failureCode = classifyFailure(run);
  result.wallMs = run.wallMs;
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  return result;
}

async function runProductionCase(wrapperPath, inputSha, wavPath) {
  const root = path.join(runRoot, 'case-production-wrapper');
  const outputPath = path.join(root, 'transcript.txt');
  const result = {
    label: 'production-wrapper',
    inputSha256: inputSha,
    engineSha256: sha256File(candidateEnginePath),
    modelSha256: sha256File(modelPath),
    wrapperSha256: sha256File(wrapperPath),
    status: 'not-run',
    exitCode: null,
    signal: null,
    timedOut: false,
    transcriptPresent: false,
    transcriptChars: 0,
    wallMs: 0,
    failureCode: null,
  };
  fs.mkdirSync(root, { recursive: true });
  const tmpDir = path.join(runRoot, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const run = await runProcess('bash', [wrapperPath, '--input', wavPath, '--output', outputPath], 180 * 1000, {
    ...process.env,
    TMPDIR: tmpDir,
    WECHAT_INBOX_ASR_CPU_ONLY: '1',
  });
  result.exitCode = run.exitCode;
  result.signal = run.signal;
  result.timedOut = run.timedOut;
  result.transcriptChars = readTranscriptChars(outputPath);
  result.transcriptPresent = result.transcriptChars > 0;
  result.status = !run.timedOut && run.exitCode === 0 && result.transcriptPresent ? 'success' : (run.timedOut ? 'timeout' : 'failed');
  if (result.status !== 'success') result.failureCode = classifyFailure(run);
  result.wallMs = run.wallMs;
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  return result;
}

function makeReceipt(data = {}) {
  const fixtureSha = sha256File(fixturePath);
  const candidateSha = sha256File(candidateBundlePath);
  const media = data.mediaProbe || { status: 'not-run', sha256: fixtureSha, bytes: 0, durationSeconds: null };
  return {
    schemaVersion: 1,
    harness: 'mac-intel-asr-engine-compare',
    runId,
    fixtureSha256: fixtureSha,
    expectedFixtureSha256: expectedFixtureSha,
    fixtureBytes: fs.existsSync(fixturePath) ? Number(fs.statSync(fixturePath).size) || 0 : 0,
    candidateBundleSha256: candidateSha,
    expectedCandidateBundleSha256: expectedCandidateSha,
    pluginVersion: safeVersion(candidateBundlePath),
    candidateIdentityMatched: Boolean(candidateSha && expectedCandidateSha && candidateSha === expectedCandidateSha),
    fixtureIdentityMatched: Boolean(fixtureSha && expectedFixtureSha && fixtureSha === expectedFixtureSha),
    productionWrapperSha256: data.wrapperSha256 || '',
    mediaProbe: media,
    nativeComparison: data.nativeComparison || { status: 'not-run', cases: [] },
    setupError: data.setupError || null,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      onlineExtraction: false,
      cloudAsr: false,
      rawFixtureRetained: false,
      rawTranscriptRetained: false,
    },
    cleanup: { privateRootRemoved: false, receiptOnly: true },
  };
}

function writeReceipt(receipt) {
  fs.mkdirSync(receiptRoot, { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify(receipt, null, 2), 'utf8');
}

async function main() {
  let receipt = null;
  try {
    if (process.platform !== 'darwin' || process.arch !== 'x64') throw Object.assign(new Error(), { code: 'INTEL_MAC_REQUIRED' });
    if (!process.env.RUNNER_TEMP || !privateRoot.startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep) || path.basename(privateRoot) !== 'asr-engine-private' || receiptRoot.startsWith(privateRoot + path.sep)) throw Object.assign(new Error(), { code: 'PRIVATE_ROOT_INVALID' });
    fs.mkdirSync(runRoot, { recursive: true });
    const required = [fixturePath, candidateBundlePath, productionScriptPath, modelPath, ffmpegPath, legacyEnginePath, candidateEnginePath];
    if (required.some((item) => !item || !fs.existsSync(item))) throw Object.assign(new Error('ENGINE_INPUT_MISSING'), { code: 'ENGINE_INPUT_MISSING' });
    if (!HASH.test(expectedFixtureSha) || !HASH.test(expectedCandidateSha)) throw Object.assign(new Error('EXPECTED_HASH_MISSING'), { code: 'EXPECTED_HASH_MISSING' });
    const actualFixtureSha = sha256File(fixturePath);
    const actualCandidateSha = sha256File(candidateBundlePath);
    if (actualFixtureSha !== expectedFixtureSha) throw Object.assign(new Error('FIXTURE_SHA256_MISMATCH'), { code: 'FIXTURE_SHA256_MISMATCH' });
    if (actualCandidateSha !== expectedCandidateSha) throw Object.assign(new Error('CANDIDATE_BUNDLE_ID_MISMATCH'), { code: 'CANDIDATE_BUNDLE_ID_MISMATCH' });
    const mediaProbe = parseDurationSeconds(fixturePath);
    if (mediaProbe.durationSeconds === null) throw Object.assign(new Error('FIXTURE_MEDIA_PROBE_FAILED'), { code: 'FIXTURE_MEDIA_PROBE_FAILED' });
    // The pinned fixture is already the 16 kHz mono WAV used for all cases.
    const wavPath = fixturePath;
    const inputSha = sha256File(fixturePath);
    const nativeCases = [];
    for (const [label, engine, cpuOnly] of [['legacy', legacyEnginePath, false], ['candidate-cpu', candidateEnginePath, true]]) {
      nativeCases.push(await runNativeCase(label, engine, wavPath, inputSha, cpuOnly));
      writeReceipt(makeReceipt({ nativeComparison: { status: 'running', cases: nativeCases } }));
    }
    const wrapperPath = prepareProductionRoot();
    nativeCases.push(await runProductionCase(wrapperPath, inputSha, wavPath));
    receipt = makeReceipt({
      wrapperSha256: sha256File(wrapperPath),
      mediaProbe: {
        status: 'success',
        sha256: inputSha,
        bytes: Number(fs.statSync(fixturePath).size) || 0,
        durationSeconds: mediaProbe.durationSeconds,
        probeMethod: 'ffmpeg',
        exitCode: mediaProbe.exitCode,
        signal: mediaProbe.signal,
      },
      nativeComparison: {
        status: nativeCases.every((item) => item.status === 'success') ? 'success' : 'failed',
        cases: nativeCases,
      },
    });
  } catch (error) {
    receipt = makeReceipt({ setupError: safeError(error) });
  }
  try { writeReceipt(receipt); } catch (_) {}
  if (process.env.RUNNER_TEMP && privateRoot.startsWith(path.resolve(process.env.RUNNER_TEMP) + path.sep) && path.basename(privateRoot) === 'asr-engine-private') {
    try { fs.rmSync(privateRoot, { recursive: true, force: true }); } catch (_) {}
  }
  if (receipt) {
    receipt.cleanup.privateRootRemoved = !fs.existsSync(privateRoot);
    receipt.runtime.rawFixtureRetained = !receipt.cleanup.privateRootRemoved;
    receipt.runtime.rawTranscriptRetained = !receipt.cleanup.privateRootRemoved;
    try { writeReceipt(receipt); } catch (_) {}
  }
  if (!receipt || receipt.setupError || receipt.nativeComparison.status !== 'success') process.exitCode = 1;
}

if (require.main === module) main().catch(() => { process.exitCode = 1; });

module.exports = {
  classifyFailure,
  makeReceipt,
  parseDurationSeconds,
  runProcess,
};
