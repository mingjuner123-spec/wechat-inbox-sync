'use strict';

// Real-chain harness.  It loads the already-built candidate bundle in a
// disposable Electron profile, lets the candidate perform its own Douyin
// extraction, downloads the returned media, and runs the installed local ASR.
// It deliberately does not install protocol handlers or replace media/API
// responses with fixtures.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const childProcess = require('node:child_process');

// The first root is the only path that may survive the run.  All browser
// profile, media, note body, transcript and native output stay under the
// private root and are deleted in finish().  Pass the public URL through an
// environment variable in CI so it never appears in the command line/logs.
const [receiptRootArg, privateRootArg, remoteModuleArg, bundleArg, asrRootArg, targetUrlArg,
  legacyEngineArg, candidateEngineArg, modelArg, ffmpegArg, ffprobeArg] = process.argv.slice(2);
const receiptRoot = path.resolve(receiptRootArg || process.cwd());
const privateRoot = path.resolve(privateRootArg || path.join(os.tmpdir(), 'douyin-public-private'));
const resolveOptionalPath = (value) => {
  const text = String(value || '').trim();
  return text ? path.resolve(text) : '';
};
const remoteModule = resolveOptionalPath(remoteModuleArg);
const bundle = resolveOptionalPath(bundleArg);
const asrRoot = resolveOptionalPath(asrRootArg);
const legacyEngine = resolveOptionalPath(legacyEngineArg || process.env.ASR_LEGACY_ENGINE);
const candidateEngine = resolveOptionalPath(candidateEngineArg || process.env.ASR_CANDIDATE_ENGINE);
const modelPath = resolveOptionalPath(modelArg || process.env.ASR_MODEL);
const ffmpegPath = resolveOptionalPath(ffmpegArg || process.env.ASR_FFMPEG);
const ffprobePath = resolveOptionalPath(ffprobeArg || process.env.ASR_FFPROBE);
const targetUrl = String(targetUrlArg || process.env.DOUYIN_PUBLIC_URL || '').trim();
const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const runRoot = path.join(privateRoot, `douyin-public-private-${runId}`);
const privateTempRoot = path.join(runRoot, 'tmp');
const runtimeAsrRoot = path.join(runRoot, 'local-asr-runtime');
const userDataRoot = path.join(runRoot, 'electron-user-data');
const resultJsonPath = path.join(receiptRoot, `douyin-public-mac-receipt-${runId}.json`);
const stagePath = path.join(runRoot, 'stage.json');
const ownedPidsPath = path.join(runRoot, 'owned-asr-pids.json');

function safeError(error) {
  if (!error) return null;
  const result = {};
  for (const key of ['code', 'browserCode', 'channelsStage', 'asrStage', 'cleanupStatus', 'reason']) {
    const value = String(error[key] || '').trim();
    if (/^[A-Za-z0-9_.:-]{1,120}$/.test(value)) result[key] = value;
  }
  for (const key of ['status', 'statusCode', 'exitCode']) {
    const value = Number(error[key]);
    if (Number.isFinite(value)) result[key] = value;
  }
  if (typeof error.timedOut === 'boolean') result.timedOut = error.timedOut;
  return Object.keys(result).length ? result : { code: 'UNCLASSIFIED_ERROR' };
}

function safeEnum(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(text) ? text : '';
}

function safeDiagnostic(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const key of [
    'outcome', 'failureCode', 'selectedStage', 'targetIdState',
    'targetIdRecognized', 'targetStageEligible', 'debuggerCapability',
    'debuggerReason', 'mediaCandidateCount', 'preciseMediaFound',
    'resolverVersion', 'challengeDetected', 'finalOutcome'
  ]) {
    if (value[key] !== undefined && value[key] !== null) {
      const item = value[key];
      if (typeof item === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(item)) result[key] = item.slice(0, 120);
      else if (typeof item === 'number' || typeof item === 'boolean') result[key] = item;
    }
  }
  if (Array.isArray(value.stages)) {
    result.stages = value.stages.slice(-24).map((stage) => {
      const clean = {};
      for (const key of [
        'stage', 'attempted', 'ok', 'mediaCount', 'detailFound',
        'exactMediaCount', 'primaryMediaCount', 'durationMs',
        'rejectionReason', 'inputKind', 'sourceKind', 'resolvedKind',
        'identityOutcome', 'resolverVersion'
      ]) {
        if (stage && stage[key] !== undefined && stage[key] !== null) {
          const item = stage[key];
          if (typeof item === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(item)) clean[key] = item.slice(0, 120);
          else if (typeof item === 'number' || typeof item === 'boolean') clean[key] = item;
        }
      }
      if (stage && stage.error) clean.error = safeError(stage.error);
      return clean;
    });
  }
  return result;
}

function safeMetadata(metadata) {
  const value = metadata && typeof metadata === 'object' ? metadata : {};
  const mediaUrls = Array.isArray(value.mediaUrls) ? value.mediaUrls : [];
  const transcription = String(value.transcription || '');
  const markdown = String(value.markdown || '');
  return {
    platform: safeEnum(value.platform),
    transcriptionStatus: safeEnum(value.transcriptionStatus),
    transcriptionSource: safeEnum(value.transcriptionSource),
    conversionStatus: safeEnum(value.conversionStatus),
    transcriptionChars: transcription.length,
    markdownChars: markdown.length,
    mediaCandidateCount: mediaUrls.length,
    mediaUrlPresent: Boolean(String(value.mediaUrl || '').trim()),
    transcriptionError: value.transcriptionError ? safeError({ message: value.transcriptionError }) : null,
    mediaResolutionDiagnostic: safeDiagnostic(value.mediaResolutionDiagnostic)
  };
}

function safeExtractionRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    inputKind: String(row && row.inputKind || '').slice(0, 80),
    urlKind: String(row && row.urlKind || '').slice(0, 80),
    mediaCount: Number(row && row.mediaCount) || 0,
    durationMs: Number(row && row.durationMs) || 0,
    error: row && row.error ? safeError(row.error) : null
  }));
}

function prepareRuntimeAsr() {
  const scriptSource = path.join(asrRoot, 'transcribe.sh');
  const modelSource = modelPath || path.join(asrRoot, 'models', 'ggml-small.bin');
  const ffmpegSource = ffmpegPath || path.join(asrRoot, 'bin', 'ffmpeg');
  if (!fs.existsSync(scriptSource)) throw new Error('installed ASR transcribe.sh is missing');
  if (!fs.existsSync(modelSource)) throw new Error('ASR model is missing');
  if (!fs.existsSync(ffmpegSource)) throw new Error('ASR ffmpeg is missing');
  if (!fs.existsSync(candidateEngine)) throw new Error('candidate Intel ASR engine is missing');
  if (!fs.existsSync(legacyEngine)) throw new Error('legacy Intel ASR engine is missing');
  fs.mkdirSync(runtimeAsrRoot, { recursive: true });
  fs.mkdirSync(path.join(runtimeAsrRoot, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(runtimeAsrRoot, 'models'), { recursive: true });
  fs.copyFileSync(scriptSource, path.join(runtimeAsrRoot, 'transcribe.sh'));
  fs.chmodSync(path.join(runtimeAsrRoot, 'transcribe.sh'), 0o700);
  const linkFile = (source, target) => {
    try { fs.unlinkSync(target); } catch (_) {}
    fs.symlinkSync(source, target, 'file');
  };
  linkFile(modelSource, path.join(runtimeAsrRoot, 'models', 'ggml-small.bin'));
  linkFile(ffmpegSource, path.join(runtimeAsrRoot, 'bin', 'ffmpeg'));
  const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
  const wrapperPath = path.join(runtimeAsrRoot, 'bin', 'whisper-cli');
  fs.writeFileSync(wrapperPath,
    `#!/usr/bin/env bash\nset -euo pipefail\nWHISPER_CPP_BIN=${shellQuote(candidateEngine)}\nGGML_METAL_RESOURCES_DIR=""\nexec "$WHISPER_CPP_BIN" "$@"\n`,
    { mode: 0o700 });
  fs.chmodSync(wrapperPath, 0o700);
  copyVerifiedDouyinResolver(asrRoot, runtimeAsrRoot);
  process.env.WECHAT_INBOX_ASR_CPU_ONLY = '1';
}

function findFile(root, name) {
  if (!fs.existsSync(root)) return '';
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const current = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return current;
    if (entry.isDirectory()) {
      const found = findFile(current, name);
      if (found) return found;
    }
  }
  return '';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function sha256FileAtPath(filePath) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
  catch (_) { return ''; }
}

function copyVerifiedDouyinResolver(sourceRoot, targetRoot) {
  const sourceResolverRoot = path.join(sourceRoot, 'tools', 'yt-dlp');
  const sourceExecutable = path.join(sourceResolverRoot, 'yt-dlp');
  const sourceReceipt = `${sourceExecutable}.verified.json`;
  const hasExecutable = fs.existsSync(sourceExecutable);
  const hasReceipt = fs.existsSync(sourceReceipt);
  if (!hasExecutable && !hasReceipt) return false;
  if (!hasExecutable || !hasReceipt) throw new Error('verified Douyin resolver layout is incomplete');
  const executableStat = fs.statSync(sourceExecutable);
  const receiptStat = fs.statSync(sourceReceipt);
  if (!executableStat.isFile() || executableStat.size <= 0 || receiptStat.size <= 0 || receiptStat.size > 4096) {
    throw new Error('verified Douyin resolver layout is invalid');
  }
  const targetResolverRoot = path.join(targetRoot, 'tools', 'yt-dlp');
  const targetExecutable = path.join(targetResolverRoot, 'yt-dlp');
  const targetReceipt = `${targetExecutable}.verified.json`;
  fs.mkdirSync(targetResolverRoot, { recursive: true });
  fs.copyFileSync(sourceExecutable, targetExecutable);
  fs.copyFileSync(sourceReceipt, targetReceipt);
  fs.chmodSync(targetExecutable, 0o700);
  return true;
}

function readPluginVersion(bundlePath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(bundlePath), 'manifest.json'), 'utf8'));
    return safeEnum(manifest && manifest.version);
  } catch (_) {
    return '';
  }
}

const candidateBundleSha256 = sha256FileAtPath(bundle);
const pluginVersion = readPluginVersion(bundle);

function writeOutputs(data) {
  const metadata = data && data.hydratedMetadata || data && data.fallbackMetadata || {};
  const reportMetadata = (value) => value && Object.prototype.hasOwnProperty.call(value, 'transcriptionChars') ? value : safeMetadata(value);
  const hydratedReportMetadata = reportMetadata(data && data.hydratedMetadata);
  const fallbackReportMetadata = reportMetadata(data && data.fallbackMetadata);
  const transcriptChars = Number(data && data.transcriptChars) || Number(metadata.transcriptionChars) || 0;
  const transcriptPresent = data && typeof data.transcriptPresent === 'boolean'
    ? data.transcriptPresent
    : transcriptChars > 0;
  const report = {
    schemaVersion: 1,
    harness: 'douyin-public-mac-probe',
    runId,
    candidateBundleLoaded: data && data.candidateBundleLoaded === true,
    candidateBundleSha256,
    pluginVersion,
    sourceUrlSha256: sha256(targetUrl),
    sourceUrlKind: 'douyin-public-link-redacted',
    runtime: {
      electron: process.versions.electron || '',
      chrome: process.versions.chrome || '',
      node: process.versions.node || '',
      platform: process.platform,
      arch: process.arch,
      isolatedUserData: true,
      anonymousSession: true,
      importedUserCookies: false,
      protocolInterception: false,
      apiFixture: false,
      mediaStub: false,
      cloudAsr: false,
      rawMediaRetained: null,
      rawTranscriptRetained: null
    },
    setupError: data && data.setupError || null,
    hydrate: {
      status: data && data.hydrateStatus || 'not-run',
      error: data && data.hydrateError || null,
      metadata: hydratedReportMetadata
    },
    browserExtraction: {
      calls: Number(data && data.extractCalls) || 0,
      rows: safeExtractionRows(data && data.extractRows),
      diagnostics: Array.isArray(data && data.browserDiagnostics) ? data.browserDiagnostics.slice(-24) : []
    },
    sourceIdentityEvidence: data && data.sourceIdentityEvidence || {
      expectedTargetIdSha256: sha256('7200230539758947584'),
      targetDetailCallbacks: 0,
      targetDetailIdMatches: 0,
      targetDetailIdPresent: 0,
      targetIdArgumentPresent: false,
      targetMediaUrlHashCount: 0,
      selectedMediaExactIdentityProven: false
    },
    mediaDownloadEvidence: Array.isArray(data && data.mediaDownloadEvidence)
      ? data.mediaDownloadEvidence.slice(0, 8)
      : [],
    mediaProbe: data && data.mediaProbe || {
      status: 'not-run',
      sha256: '',
      bytes: 0,
      durationSeconds: null,
      probeMethod: '',
      exitCode: null,
      signal: null,
    },
    nativeComparison: data && data.nativeComparison || {
      status: 'not-run',
      cases: [],
    },
    fallbackBuild: {
      attempted: data && data.fallbackBuildAttempted === true,
      status: data && data.fallbackBuildStatus || 'not-run',
      error: data && data.fallbackBuildError || null,
      metadata: fallbackReportMetadata
    },
    writeRecord: data && data.writeRecord || {
      status: 'not-run',
      committed: false,
      sourceUrlPresent: false,
      transcriptionPresent: false,
      metadataFieldsPresent: [],
      error: null
    },
    artifactVault: data && data.artifactVault || { isolated: true, cloudRequestCount: 0 },
    transcript: {
      present: transcriptPresent,
      chars: transcriptChars,
      source: safeEnum(metadata.transcriptionSource)
    },
    cleanup: {
      privateRootRemoved: false,
      receiptOnly: true,
    }
  };
  fs.mkdirSync(receiptRoot, { recursive: true });
  fs.writeFileSync(resultJsonPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

function readWatchdogStage() {
  try {
    const value = JSON.parse(fs.readFileSync(stagePath, 'utf8'));
    return safeEnum(value && value.stage) || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function readPartialNativeEvidence() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(runRoot, 'native-evidence.json'), 'utf8'));
    return {
      mediaProbe: value && value.mediaProbe,
      nativeComparison: value && value.nativeComparison,
    };
  } catch (_) {
    return {};
  }
}

function terminateOwnedAsrProcesses() {
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(ownedPidsPath, 'utf8')); } catch (_) {}
  for (const item of Array.isArray(entries) ? entries : []) {
    const pid = Number(item && item.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (item.detached === true) {
      try { process.kill(-pid, 'SIGTERM'); } catch (_) {}
    }
    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  }
}

function finish(data) {
  if (global.__finished) return;
  global.__finished = true;
  terminateOwnedAsrProcesses();
  // Close the renderer before removing the private root.  The renderer has
  // already awaited its browser and native subprocess work on the normal
  // path; this closes the remaining browser handle before cleanup on both
  // success and failure paths.
  for (const window of BrowserWindow.getAllWindows()) {
    try { window.close(); } catch (_) { /* best effort */ }
  }
  let report = null;
  const partialEvidence = readPartialNativeEvidence();
  const outputData = { ...partialEvidence, ...(data || {}) };
  try {
    report = writeOutputs(outputData);
  } catch (error) {
    try {
      fs.writeFileSync(resultJsonPath, JSON.stringify({
        schemaVersion: 1,
        harness: 'douyin-public-mac-probe',
        runId,
        sourceUrlSha256: sha256(targetUrl),
        outputError: safeError(error)
      }, null, 2), 'utf8');
    } catch (_) {
      // The process exit code and parent-side status remain the final evidence.
    }
  }
  let privateRootRemoved = false;
  try {
    fs.rmSync(runRoot, { recursive: true, force: true });
    privateRootRemoved = !fs.existsSync(runRoot);
  } catch (_) { /* receipt still records the failure below */ }
  if (report) {
    report.cleanup.privateRootRemoved = privateRootRemoved;
    report.runtime.rawMediaRetained = !privateRootRemoved;
    report.runtime.rawTranscriptRetained = !privateRootRemoved;
    try { fs.writeFileSync(resultJsonPath, JSON.stringify(report, null, 2), 'utf8'); } catch (_) {}
  }
  app.quit();
}

process.on('uncaughtException', (error) => {
  finish({ setupError: safeError(error), candidateBundleLoaded: false });
});
process.on('unhandledRejection', (error) => {
  finish({ setupError: safeError(error), candidateBundleLoaded: false });
});

app.setPath('userData', userDataRoot);
app.setPath('sessionData', path.join(userDataRoot, 'session-data'));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('no-sandbox');

let setupError = null;
try {
  fs.mkdirSync(runRoot, { recursive: true });
  fs.mkdirSync(privateTempRoot, { recursive: true });
  process.env.TMPDIR = privateTempRoot;
  app.setPath('temp', privateTempRoot);
  prepareRuntimeAsr();
} catch (error) {
  setupError = safeError(error);
}

const remote = setupError ? null : require(path.join(remoteModule, 'main'));
if (remote) remote.initialize();

app.whenReady().then(async () => {
  if (setupError) {
    finish({ setupError, candidateBundleLoaded: false });
    return;
  }
  const host = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  remote.enable(host.webContents);
  await host.loadURL('data:text/html,<meta charset="utf-8"><title>real-chain-harness</title>');
  const result = await host.webContents.executeJavaScript(
    `(${renderer.toString()})(${JSON.stringify(remoteModule)},${JSON.stringify(bundle)},${JSON.stringify(runtimeAsrRoot)},${JSON.stringify(targetUrl)},${JSON.stringify(runId)},${JSON.stringify(runRoot)},${JSON.stringify(privateTempRoot)},${JSON.stringify(legacyEngine)},${JSON.stringify(candidateEngine)},${JSON.stringify(modelPath || path.join(asrRoot, 'models', 'ggml-small.bin'))},${JSON.stringify(ffmpegPath || path.join(asrRoot, 'bin', 'ffmpeg'))},${JSON.stringify(ffprobePath)},${JSON.stringify(pluginVersion)})`,
    true
  );
  finish({ ...result, candidateBundleLoaded: result && result.candidateBundleLoaded === true });
}).catch((error) => finish({ setupError: safeError(error), candidateBundleLoaded: false }));

setTimeout(() => finish({ setupError: safeError({ code: 'HARNESS_TIMEOUT', reason: readWatchdogStage(), timedOut: true }), candidateBundleLoaded: false }), 20 * 60 * 1000);

async function renderer(remoteModulePath, bundlePath, runtimeRoot, sourceUrl, currentRunId, currentRunRoot,
  privateTempRoot, legacyEnginePath, candidateEnginePath, modelFilePath, ffmpegFilePath, ffprobeFilePath, candidateVersion) {
  const electron = require('electron');
  const bridge = require(remoteModulePath);
  const Module = require('module');
  const originalLoad = Module._load;
  const networkSession = bridge.session.fromPartition(`persist:douyin-public-${currentRunId}`);
  if (typeof networkSession.clearStorageData === 'function') {
    await networkSession.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
  }
  const browserDiagnostics = [];
  const extractionRows = [];
  const mediaDownloadEvidence = [];
  const targetMediaUrlHashes = new Set();
  const expectedTargetId = '7200230539758947584';
  const sourceIdentityEvidence = {
    expectedTargetIdSha256: require('node:crypto').createHash('sha256').update(expectedTargetId, 'utf8').digest('hex'),
    targetDetailCallbacks: 0,
    targetDetailIdMatches: 0,
    targetDetailIdPresent: 0,
    targetIdArgumentPresent: false,
    targetDetailIdSha256: [],
    targetMediaUrlHashCount: 0,
    selectedMediaExactIdentityProven: false,
  };

  const fsLocal = require('node:fs');
  const pathLocal = require('node:path');
  fsLocal.mkdirSync(privateTempRoot, { recursive: true });
  process.env.TMPDIR = privateTempRoot;
  const childProcessLocal = require('node:child_process');
  const ownedChildren = new Map();
  const ownedPidsPathLocal = pathLocal.join(currentRunRoot, 'owned-asr-pids.json');
  const stagePathLocal = pathLocal.join(currentRunRoot, 'stage.json');
  const nativeEvidencePathLocal = pathLocal.join(currentRunRoot, 'native-evidence.json');
  const writeStage = (stage) => {
    try { fsLocal.writeFileSync(stagePathLocal, JSON.stringify({ schemaVersion: 1, stage }), 'utf8'); } catch (_) {}
  };
  const writeNativeEvidence = (mediaProbe, nativeComparison) => {
    try {
      fsLocal.writeFileSync(nativeEvidencePathLocal, JSON.stringify({
        schemaVersion: 1,
        mediaProbe: mediaProbe || { status: 'not-run' },
        nativeComparison: nativeComparison || { status: 'not-run', cases: [] },
      }), 'utf8');
    } catch (_) {}
  };
  const persistOwnedChildren = () => {
    try {
      fsLocal.writeFileSync(ownedPidsPathLocal, JSON.stringify([...ownedChildren.values()]), 'utf8');
    } catch (_) {}
  };
  const trackChild = (child, options) => {
    if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return child;
    ownedChildren.set(child.pid, { pid: child.pid, detached: options && options.detached === true });
    persistOwnedChildren();
    const forget = () => { ownedChildren.delete(child.pid); persistOwnedChildren(); };
    if (typeof child.once === 'function') child.once('exit', forget);
    if (typeof child.once === 'function') child.once('close', forget);
    return child;
  };
  const childProcessProxy = {
    ...childProcessLocal,
    spawn(...args) { return trackChild(childProcessLocal.spawn(...args), args[2]); },
    execFile(...args) {
      const options = Array.isArray(args[1]) ? args[2] : args[1];
      return trackChild(childProcessLocal.execFile(...args), options);
    },
    exec(...args) { return trackChild(childProcessLocal.exec(...args), args[1]); },
    fork(...args) { return trackChild(childProcessLocal.fork(...args), args[2]); },
  };
  writeStage('renderer-start');

  function extractTargetId(value) {
    if (!value || typeof value !== 'object') return '';
    const direct = [value.aweme_id, value.awemeId, value.item_id, value.itemId, value.id]
      .map((item) => String(item || '').trim())
      .find((item) => /^\d{10,30}$/.test(item));
    if (direct) return direct;
    for (const key of ['aweme_detail', 'awemeDetail', 'item', 'data']) {
      const nested = extractTargetId(value[key]);
      if (nested) return nested;
    }
    return '';
  }

  // Functions passed to executeJavaScript must be self-contained; these are
  // intentionally duplicated from the main-process redaction helpers.
  function safeError(error) {
    if (!error) return null;
    const result = {};
    for (const key of ['code', 'browserCode', 'channelsStage', 'asrStage', 'cleanupStatus', 'reason']) {
      const value = String(error[key] || '').trim();
      if (/^[A-Za-z0-9_.:-]{1,120}$/.test(value)) result[key] = value;
    }
    for (const key of ['status', 'statusCode', 'exitCode']) {
      const value = Number(error[key]);
      if (Number.isFinite(value)) result[key] = value;
    }
    if (typeof error.timedOut === 'boolean') result.timedOut = error.timedOut;
    return Object.keys(result).length ? result : { code: 'UNCLASSIFIED_ERROR' };
  }

  function safeDiagnostic(value) {
    if (!value || typeof value !== 'object') return null;
    const result = {};
    for (const key of [
      'outcome', 'failureCode', 'selectedStage', 'targetIdState',
      'targetIdRecognized', 'targetStageEligible', 'debuggerCapability',
      'debuggerReason', 'mediaCandidateCount', 'preciseMediaFound',
      'resolverVersion', 'challengeDetected', 'finalOutcome'
    ]) {
      if (value[key] !== undefined && value[key] !== null) {
        const item = value[key];
        if (typeof item === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(item)) result[key] = item.slice(0, 120);
        else if (typeof item === 'number' || typeof item === 'boolean') result[key] = item;
      }
    }
    if (Array.isArray(value.stages)) {
      result.stages = value.stages.slice(-24).map((stage) => {
        const clean = {};
        for (const key of [
          'stage', 'attempted', 'ok', 'mediaCount', 'detailFound',
          'exactMediaCount', 'primaryMediaCount', 'durationMs',
          'rejectionReason', 'inputKind', 'sourceKind', 'resolvedKind',
          'identityOutcome', 'resolverVersion'
        ]) {
          if (stage && stage[key] !== undefined && stage[key] !== null) {
            const item = stage[key];
            if (typeof item === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(item)) clean[key] = item.slice(0, 120);
            else if (typeof item === 'number' || typeof item === 'boolean') clean[key] = item;
          }
        }
        if (stage && stage.error) clean.error = safeError(stage.error);
        return clean;
      });
    }
    return result;
  }

  function safeMetadata(metadata) {
    const value = metadata && typeof metadata === 'object' ? metadata : {};
    const mediaUrls = Array.isArray(value.mediaUrls) ? value.mediaUrls : [];
    const transcription = String(value.transcription || '');
    const markdown = String(value.markdown || '');
    return {
      platform: /^[A-Za-z0-9_.:-]{1,120}$/.test(String(value.platform || '').trim()) ? String(value.platform).trim() : '',
      transcriptionStatus: /^[A-Za-z0-9_.:-]{1,120}$/.test(String(value.transcriptionStatus || '').trim()) ? String(value.transcriptionStatus).trim() : '',
      transcriptionSource: /^[A-Za-z0-9_.:-]{1,120}$/.test(String(value.transcriptionSource || '').trim()) ? String(value.transcriptionSource).trim() : '',
      conversionStatus: /^[A-Za-z0-9_.:-]{1,120}$/.test(String(value.conversionStatus || '').trim()) ? String(value.conversionStatus).trim() : '',
      transcriptionChars: transcription.length,
      markdownChars: markdown.length,
      mediaCandidateCount: mediaUrls.length,
      mediaUrlPresent: Boolean(String(value.mediaUrl || '').trim()),
      transcriptionError: value.transcriptionError ? safeError({ message: value.transcriptionError }) : null,
      mediaResolutionDiagnostic: safeDiagnostic(value.mediaResolutionDiagnostic)
    };
  }

  const networkRequestKinds = [];

  function createArtifactVault() {
    const fsLocal = require('node:fs');
    const pathLocal = require('node:path');
    const vaultRoot = pathLocal.join(currentRunRoot, 'artifact-vault');
    fsLocal.mkdirSync(vaultRoot, { recursive: true });
    const relativePath = (value) => String(value || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .filter((part) => part && part !== '.' && part !== '..')
      .join('/');
    const absolutePath = (value) => pathLocal.join(vaultRoot, ...relativePath(value).split('/'));
    const adapter = {
      async exists(value) {
        try { await fsLocal.promises.access(absolutePath(value)); return true; } catch (_) { return false; }
      },
      async write(value, data) {
        const target = absolutePath(value);
        await fsLocal.promises.mkdir(pathLocal.dirname(target), { recursive: true });
        await fsLocal.promises.writeFile(target, String(data || ''), 'utf8');
      },
      async writeBinary(value, data) {
        const target = absolutePath(value);
        await fsLocal.promises.mkdir(pathLocal.dirname(target), { recursive: true });
        await fsLocal.promises.writeFile(target, Buffer.from(data));
      },
      async remove(value) {
        await fsLocal.promises.rm(absolutePath(value), { force: true });
      },
      async read(value) {
        return fsLocal.promises.readFile(absolutePath(value), 'utf8');
      },
      getFullPath(value) { return absolutePath(value); }
    };
    return {
      root: vaultRoot,
      vault: {
        adapter,
        async createFolder(value) {
          await fsLocal.promises.mkdir(absolutePath(value), { recursive: true });
        },
        async create(value, data) {
          await adapter.write(value, data);
          return { path: relativePath(value) };
        },
        getMarkdownFiles() { return []; }
      }
    };
  }

  const cryptoLocal = require('node:crypto');
  let capturedMediaPath = '';
  let earlyMediaProbe = null;
  let earlyNativeComparison = null;

  function sha256File(filePath) {
    try { return cryptoLocal.createHash('sha256').update(fsLocal.readFileSync(filePath)).digest('hex'); }
    catch (_) { return ''; }
  }

  function runProcess(command, args, timeoutMs, capture = false) {
    const startedAt = Date.now();
    let result;
    try {
      result = childProcessLocal.spawnSync(command, args, {
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'ignore'],
        encoding: capture ? 'utf8' : undefined,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      return {
        exitCode: null,
        signal: null,
        timedOut: String(error && error.code || '') === 'ETIMEDOUT',
        durationMs: Date.now() - startedAt,
        stdout: '',
        stderr: '',
      };
    }
    return {
      exitCode: Number.isInteger(result.status) ? result.status : null,
      signal: result.signal || null,
      timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
      durationMs: Date.now() - startedAt,
      stdout: capture ? String(result.stdout || '') : '',
      stderr: capture ? String(result.stderr || '') : '',
    };
  }

  function classifyNativeFailure(result) {
    if (result && result.timedOut) return 'PROCESS_TIMEOUT';
    const signal = String(result && result.signal || '').toUpperCase();
    const stderr = String(result && result.stderr || '').toLowerCase();
    if (signal === 'SIGSEGV' || /segmentation fault|segfault|signal 11|sigsegv/.test(stderr)) return 'SEGMENTATION_FAULT';
    if (/illegal instruction|illegal hardware instruction|sigill/.test(stderr) || signal === 'SIGILL') return 'ILLEGAL_INSTRUCTION';
    if (/dyld:|image not found|symbol not found|undefined symbol/.test(stderr)) return 'DYLD_SYMBOL_MISSING';
    return 'OTHER_NATIVE_ERROR';
  }

  function parseDurationSeconds(text) {
    const match = String(text || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) return null;
    const value = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    return Number.isFinite(value) ? value : null;
  }

  function probeMedia(filePath) {
    if (!filePath || !fsLocal.existsSync(filePath)) return { status: 'not-run', reason: 'media-missing' };
    const stat = fsLocal.statSync(filePath);
    let durationSeconds = null;
    let probeMethod = '';
    let exitCode = null;
    let signal = null;
    if (ffprobeFilePath && fsLocal.existsSync(ffprobeFilePath)) {
      const probe = runProcess(ffprobeFilePath,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
        30000, true);
      durationSeconds = Number(String(probe.stdout || '').trim());
      if (!Number.isFinite(durationSeconds)) durationSeconds = null;
      probeMethod = 'ffprobe';
      exitCode = probe.exitCode;
      signal = probe.signal;
    } else if (ffmpegFilePath && fsLocal.existsSync(ffmpegFilePath)) {
      const probe = runProcess(ffmpegFilePath, ['-hide_banner', '-i', filePath], 30000, true);
      durationSeconds = parseDurationSeconds(`${probe.stdout}\n${probe.stderr}`);
      probeMethod = 'ffmpeg-duration-fallback';
      exitCode = probe.exitCode;
      signal = probe.signal;
    }
    return {
      status: durationSeconds === null ? 'failed' : 'success',
      sha256: sha256File(filePath),
      bytes: Number(stat.size) || 0,
      durationSeconds,
      probeMethod,
      exitCode,
      signal,
    };
  }

  function runNativeCase(label, enginePath, cpuOnly) {
    const root = pathLocal.join(currentRunRoot, `native-${label}`);
    const wavPath = pathLocal.join(root, 'input.wav');
    const outputBase = pathLocal.join(root, 'transcript');
    const outputPath = `${outputBase}.txt`;
    const base = {
      label,
      status: 'not-run',
      engineSha256: sha256File(enginePath),
      modelSha256: sha256File(modelFilePath),
      preprocessExitCode: null,
      preprocessSignal: null,
      engineExitCode: null,
      engineSignal: null,
      timedOut: false,
      transcriptPresent: false,
      transcriptChars: 0,
      wallMs: 0,
      failureCode: null,
    };
    if (!capturedMediaPath || !fsLocal.existsSync(enginePath) || !fsLocal.existsSync(modelFilePath)
      || !fsLocal.existsSync(ffmpegFilePath)) {
      base.status = 'not-ready';
      return base;
    }
    fsLocal.mkdirSync(root, { recursive: true });
    const startedAt = Date.now();
    const preprocess = runProcess(ffmpegFilePath,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', capturedMediaPath,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath],
      30 * 1000, true);
    base.preprocessExitCode = preprocess.exitCode;
    base.preprocessSignal = preprocess.signal;
    if (preprocess.timedOut || preprocess.exitCode !== 0 || !fsLocal.existsSync(wavPath)) {
      base.status = preprocess.timedOut ? 'preprocess-timeout' : 'preprocess-failed';
      base.timedOut = preprocess.timedOut;
      base.failureCode = classifyNativeFailure(preprocess);
      base.wallMs = Date.now() - startedAt;
      try { fsLocal.rmSync(root, { recursive: true, force: true }); } catch (_) {}
      return base;
    }
    const args = ['-m', modelFilePath, '-f', wavPath, '-l', 'zh', '-nt', '-otxt', '-of', outputBase];
    if (cpuOnly) args.push('--no-gpu');
    const native = runProcess(enginePath, args, 150 * 1000, true);
    base.engineExitCode = native.exitCode;
    base.engineSignal = native.signal;
    base.timedOut = native.timedOut;
    if (fsLocal.existsSync(outputPath)) {
      try {
        const transcript = fsLocal.readFileSync(outputPath, 'utf8').trim();
        base.transcriptPresent = Boolean(transcript);
        base.transcriptChars = transcript.length;
      } catch (_) {}
    }
    base.status = native.timedOut ? 'timeout'
      : (native.exitCode === 0 && base.transcriptPresent ? 'success' : 'failed');
    if (base.status !== 'success') base.failureCode = classifyNativeFailure(native);
    base.wallMs = Date.now() - startedAt;
    try { fsLocal.rmSync(root, { recursive: true, force: true }); } catch (_) {}
    return base;
  }

  function runNativeComparison(onProgress) {
    if (!capturedMediaPath || !fsLocal.existsSync(capturedMediaPath)) {
      return { status: 'not-run', cases: [] };
    }
    const cases = [];
    cases.push(runNativeCase('legacy', legacyEnginePath, false));
    if (typeof onProgress === 'function') onProgress({ status: 'running', cases: cases.slice() });
    cases.push(runNativeCase('candidate-cpu', candidateEnginePath, true));
    if (typeof onProgress === 'function') onProgress({ status: 'running', cases: cases.slice() });
    return { status: cases.every(item => item.status === 'success') ? 'success' : 'failed', cases };
  }

  async function requestUrl(options = {}) {
    const headers = Object.fromEntries(Object.entries(options.headers || {})
      .filter(([key]) => !/^(?:cookie|authorization|proxy-authorization)$/i.test(String(key))));
    const requestOptions = {
      method: String(options.method || 'GET').toUpperCase(),
      redirect: 'follow',
      credentials: 'omit',
      headers
    };
    if (options.body !== undefined && options.body !== null) {
      requestOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    const response = await networkSession.fetch(String(options.url || ''), requestOptions);
    let host = '';
    try { host = new URL(String(options.url || '')).hostname; } catch (_) { /* diagnostic only */ }
    networkRequestKinds.push({
      kind: /tencent|aliyun|bytedance|volcengine|dashscope|openai/i.test(host) ? 'cloud' : 'browser',
      status: Number(response.status) || 0,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* non-JSON page */ }
    const responseHeaders = {};
    try {
      for (const [key, value] of response.headers.entries()) responseHeaders[key] = value;
    } catch (_) {
      // Header enumeration is diagnostic-only.
    }
    return {
      status: Number(response.status) || 0,
      text,
      json,
      url: String(response.url || options.url || ''),
      headers: responseHeaders
    };
  }

  Module._load = function patchedLoad(id, parent, main) {
    if (id === 'obsidian') {
      return {
        Plugin: class {},
        PluginSettingTab: class {},
        Modal: class {},
        Notice: class {},
        requestUrl
      };
    }
    if (id === 'electron') return { ...electron, remote: bridge };
    if (id === 'child_process' || id === 'node:child_process') return childProcessProxy;
    return originalLoad.call(this, id, parent, main);
  };

  try {
    const Plugin = require(bundlePath);
    const plugin = new Plugin();
    const extractTargetMediaUrls = Plugin && Plugin.__test
      && typeof Plugin.__test.extractDouyinMediaUrlsForAweme === 'function'
      ? Plugin.__test.extractDouyinMediaUrlsForAweme
      : null;
    const pathLocal = require('node:path');
    const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
    const runtimeScript = pathLocal.join(runtimeRoot, 'transcribe.sh');
    const command = `bash ${shellQuote(runtimeScript)} --input {input} --output {output}`;
    plugin.settings = {
      aiProvider: 'local',
      localAsrPlatform: 'darwin',
      localAsrInstallMode: 'default',
      localTranscriptionCommand: command,
      inboxDir: 'DouyinRealWriteRecord',
      noteSaveMode: 'root',
      notePropertyFields: 'title,author,url,synced_at,source,description,keywords,views,likes,collects,comments,shares,coins,metrics_captured_at',
      socialArticleImageStorageMode: 'remote',
      automaticWebpageExtraction: false,
      saveOriginalMediaEnabled: false,
      xiaohongshuCommentsEnabled: false,
      xiaohongshuImageOcrEnabled: false,
      transcriptionMode: 'local'
    };
    plugin.manifest = { version: String(candidateVersion || '') };
    plugin.getConfiguredLocalAsrInstallRoot = () => runtimeRoot;
    plugin.getConfiguredLocalAsrPlatform = () => 'darwin';
    plugin.getActiveBindings = () => [];
    const artifactVault = createArtifactVault();
    plugin.app = { vault: artifactVault.vault };
    plugin.ensureLocalComponentReadyForUse = async () => ({ hasAccess: true, status: 'test-runtime' });
    plugin.showSyncProgress = () => {};
    plugin.setTranscriptionStopAvailable = () => {};
    plugin.saveSettings = async () => {};

    const originalDownloadMediaToTempFile = plugin.downloadMediaToTempFile.bind(plugin);
    plugin.downloadMediaToTempFile = async (audioUrl, options = {}) => {
      const fsLocal = require('node:fs');
      const inputUrl = String(audioUrl || '').trim();
      const inputUrlSha256 = require('node:crypto').createHash('sha256').update(inputUrl, 'utf8').digest('hex');
      const observation = {
        inputUrlSha256,
        inputUrlMatchedTargetDetail: targetMediaUrlHashes.has(inputUrlSha256),
        returnedFileSha256: '',
        returnedFileBytes: 0,
        returnedFileObserved: false,
      };
      try {
        const result = await originalDownloadMediaToTempFile(audioUrl, options);
        const returnedPath = String(result || '');
        if (returnedPath && fsLocal.existsSync(returnedPath)) {
          const bytes = fsLocal.readFileSync(returnedPath);
          observation.returnedFileSha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
          observation.returnedFileBytes = bytes.length;
          observation.returnedFileObserved = true;
          if (!capturedMediaPath) {
            capturedMediaPath = pathLocal.join(currentRunRoot, 'captured-media.bin');
            fsLocal.copyFileSync(returnedPath, capturedMediaPath);
            // Run the independent native comparison immediately after the
            // first real media download.  A later product-wrapper stall must
            // not hide the native result from the watchdog receipt.
            writeStage('native-comparison');
            earlyMediaProbe = probeMedia(capturedMediaPath);
            writeNativeEvidence(earlyMediaProbe, { status: 'running', cases: [] });
            try {
              earlyNativeComparison = runNativeComparison((progress) => writeNativeEvidence(earlyMediaProbe, progress));
            } catch (_) {
              earlyNativeComparison = { status: 'failed', cases: [] };
            }
            writeNativeEvidence(earlyMediaProbe, earlyNativeComparison);
            writeStage('product-hydrate-after-native');
          }
        }
        return result;
      } finally {
        mediaDownloadEvidence.push(observation);
      }
    };

    const originalRender = plugin.renderSocialMediaUrls.bind(plugin);
    plugin.renderSocialMediaUrls = async (url, options = {}) => {
      const row = { inputKind: 'douyin-url', urlKind: /\/video\//i.test(String(url || '')) ? 'video-page' : 'short-or-other' };
      sourceIdentityEvidence.targetIdArgumentPresent = sourceIdentityEvidence.targetIdArgumentPresent
        || Boolean(String(options.targetDouyinAwemeId || '').trim());
      const wrappedOptions = {
        ...options,
        onDouyinTargetDetail(detail) {
          const id = extractTargetId(detail);
          sourceIdentityEvidence.targetDetailCallbacks += 1;
          sourceIdentityEvidence.targetDetailIdPresent += id ? 1 : 0;
          sourceIdentityEvidence.targetDetailIdMatches += id === '7200230539758947584' ? 1 : 0;
          if (id) {
            const hash = require('node:crypto').createHash('sha256').update(id, 'utf8').digest('hex');
            if (!sourceIdentityEvidence.targetDetailIdSha256.includes(hash)) sourceIdentityEvidence.targetDetailIdSha256.push(hash);
          }
          if (extractTargetMediaUrls) {
            let targetMediaUrls = [];
            try { targetMediaUrls = extractTargetMediaUrls(JSON.stringify(detail), expectedTargetId); } catch (_) {}
            for (const mediaUrl of Array.isArray(targetMediaUrls) ? targetMediaUrls : []) {
              const normalizedUrl = String(mediaUrl || '').trim();
              if (!normalizedUrl) continue;
              targetMediaUrlHashes.add(require('node:crypto').createHash('sha256').update(normalizedUrl, 'utf8').digest('hex'));
            }
            sourceIdentityEvidence.targetMediaUrlHashCount = targetMediaUrlHashes.size;
          }
          if (typeof options.onDouyinTargetDetail === 'function') options.onDouyinTargetDetail(detail);
        },
        onDouyinBrowserDiagnostic(event) {
          if (!event || typeof event !== 'object') return;
          const safe = {};
          for (const key of ['stage', 'outcome', 'browserCode', 'debuggerCapability', 'debuggerReason', 'responseReads', 'mediaCandidateCount', 'durationMs']) {
            if (event[key] !== undefined && event[key] !== null) {
              const value = event[key];
              if (typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(value)) safe[key] = value;
              else if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
            }
          }
          if (Object.keys(safe).length) browserDiagnostics.push(safe);
          if (typeof options.onDouyinBrowserDiagnostic === 'function') options.onDouyinBrowserDiagnostic(event);
        }
      };
      try {
        const urls = await originalRender(url, wrappedOptions);
        row.mediaCount = Array.isArray(urls) ? urls.length : 0;
        extractionRows.push(row);
        return urls;
      } catch (error) {
        row.error = safeError(error);
        extractionRows.push(row);
        throw error;
      }
    };

    const record = {
      id: `douyin-real-chain-${currentRunId}`,
      type: 'webpage',
      content: sourceUrl,
      createdAt: new Date().toISOString(),
      metadata: {
        url: sourceUrl,
        title: '抖音真实链路验证',
        platform: '抖音',
        contentCategory: '视频',
        webpageMediaType: 'audio_video',
        transcriptionMode: 'local',
        markdown: ''
      }
    };
    let hydrated = null;
    let hydrateError = null;
    writeStage('product-hydrate');
    try {
      hydrated = await plugin.hydrateWebpageMarkdown(record, '', '', '抖音真实链路验证', null, {});
    } catch (error) {
      hydrateError = safeError(error);
    }

    let fallbackBuildAttempted = false;
    let fallbackBuildStatus = 'not-run';
    let fallbackBuildError = null;
    let fallbackRecord = null;
    if (!hydrated || !String(hydrated.metadata && hydrated.metadata.transcription || '').trim()) {
      writeStage('fallback-extraction');
      // If hydrate stopped before its browser branch, exercise the same built
      // browser extraction method once so a transient static-page failure does
      // not get confused with a media/ASR failure.
      if (extractionRows.length === 0) {
        try {
          await plugin.renderSocialMediaUrls(sourceUrl, { timeoutMs: 30e3 });
        } catch (_) {
          // The stage/error is already captured in extractionRows.
        }
      }
      const lastExtraction = extractionRows[extractionRows.length - 1];
      if (lastExtraction && Number(lastExtraction.mediaCount) > 0) {
        fallbackBuildAttempted = true;
        try {
          const urls = await originalRender(sourceUrl, { timeoutMs: 30e3 });
          if (!Array.isArray(urls) || urls.length === 0) throw new Error('browser extraction returned no media for fallback build');
          fallbackRecord = await plugin.buildTranscriptRecordFromMedia(record, {
            url: sourceUrl,
            platform: '抖音',
            mediaUrl: urls[0],
            mediaUrls: urls,
            source: 'video',
            title: '抖音真实链路验证',
            binding: null
          });
          fallbackBuildStatus = 'success';
        } catch (error) {
          fallbackBuildStatus = 'failed';
          fallbackBuildError = safeError(error);
        }
      }
    }

    const selected = hydrated && hydrated.metadata && String(hydrated.metadata.transcription || '').trim() ? hydrated : fallbackRecord;
    let writeRecord = {
      status: 'not-run',
      committed: false,
      sourceUrlPresent: false,
      transcriptionPresent: false,
      metadataFieldsPresent: [],
      noteSha256: '',
      noteBytes: 0,
      error: null,
    };
    if (selected && selected.metadata && String(selected.metadata.transcription || '').trim()) {
      writeStage('product-write');
      const fsLocal = require('node:fs');
      const originalHydrateForWrite = plugin.hydrateWebpageMarkdown;
      try {
        // The browser extraction, media selection, and ASR above are real.
        // Freeze that returned record for the write phase so writeRecord does
        // not perform a second network extraction or ASR attempt.
        plugin.hydrateWebpageMarkdown = async () => selected;
        const committed = await plugin.writeRecord(
          selected,
          new Date().toISOString(),
          null,
          false,
          { skipAi: true },
        );
        const noteFullPath = artifactVault.vault.adapter.getFullPath(committed.filePath);
        const noteText = fsLocal.readFileSync(noteFullPath, 'utf8');
        const transcript = String(selected.metadata.transcription || '').trim();
        const fields = ['title', 'url', 'synced_at', 'source', 'description', 'keywords'];
        writeRecord = {
          status: 'success',
          committed: committed.committed === true,
          sourceUrlPresent: noteText.includes(sourceUrl),
          transcriptionPresent: Boolean(transcript) && noteText.includes(transcript),
          metadataFieldsPresent: fields.filter((field) => new RegExp(`^${field}:`, 'm').test(noteText)),
          noteSha256: require('node:crypto').createHash('sha256').update(noteText, 'utf8').digest('hex'),
          noteBytes: Buffer.byteLength(noteText, 'utf8'),
          error: null,
        };
      } catch (error) {
        writeRecord = {
          ...writeRecord,
          status: 'failed',
          error: safeError(error),
        };
      } finally {
        plugin.hydrateWebpageMarkdown = originalHydrateForWrite;
      }
    }
    // Both engines consume the exact same captured media file.  Only the
    // numeric/hash/status summary leaves this renderer; transcript text and
    // native output remain under currentRunRoot until finish() removes it.
    const mediaProbe = earlyMediaProbe || probeMedia(capturedMediaPath);
    const nativeComparison = earlyNativeComparison || runNativeComparison();
    writeNativeEvidence(mediaProbe, nativeComparison);
    writeStage('complete');
    return {
      candidateBundleLoaded: true,
      hydrateStatus: hydrated ? 'returned' : 'failed',
      hydrateError,
      hydratedMetadata: hydrated ? safeMetadata(hydrated.metadata) : {},
      fallbackMetadata: fallbackRecord ? safeMetadata(fallbackRecord.metadata) : {},
      transcriptPresent: Boolean(selected && selected.metadata && String(selected.metadata.transcription || '').trim()),
      transcriptChars: selected && selected.metadata ? String(selected.metadata.transcription || '').trim().length : 0,
      extractCalls: extractionRows.length,
      extractRows: extractionRows,
      browserDiagnostics: browserDiagnostics,
      fallbackBuildAttempted,
      fallbackBuildStatus,
      fallbackBuildError,
      writeRecord,
      mediaProbe,
      nativeComparison,
      mediaDownloadEvidence: mediaDownloadEvidence.slice(0, 8),
      artifactVault: {
        isolated: true,
        cloudRequestCount: networkRequestKinds.filter((item) => item.kind === 'cloud').length,
        browserRequestCount: networkRequestKinds.filter((item) => item.kind === 'browser').length,
        vaultRootName: 'artifact-vault'
      },
      sourceIdentityEvidence: {
        ...sourceIdentityEvidence,
        targetDetailIdSha256: sourceIdentityEvidence.targetDetailIdSha256.slice(0, 8),
        selectedMediaExactIdentityProven: mediaDownloadEvidence.some((item) => item.inputUrlMatchedTargetDetail === true
          && item.returnedFileObserved === true),
      }
    };
  } catch (error) {
    return {
      candidateBundleLoaded: false,
      hydrateStatus: 'failed',
      hydrateError: safeError(error),
      extractCalls: extractionRows.length,
      extractRows: extractionRows,
      browserDiagnostics
    };
  } finally {
    Module._load = originalLoad;
  }
}
