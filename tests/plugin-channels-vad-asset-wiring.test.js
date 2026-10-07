'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const mainPath = path.join(root, 'obsidian-plugin/wechat-inbox-sync/src/main.js');
const vad = require(path.join(root, 'obsidian-plugin/wechat-inbox-sync/src/channels-asr-quality-recovery.js'));
const timeoutGroup = require(path.join(root, 'obsidian-plugin/wechat-inbox-sync/src/asr-timeout-process-group.js'));
const recovery = require(path.join(root, 'obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils.js'));

const savedVad = {
  inspectChannelsVadAssets: vad.inspectChannelsVadAssets,
  runChannelsQualityRecovery: vad.runChannelsQualityRecovery,
};
const savedExec = timeoutGroup.execWithAsrTimeout;
const savedRecovery = {};
for (const key of [
  'executeWithMacRecovery', 'saveSession', 'runtimeIdentity', 'fingerprint',
  'modelIdentity', 'systemIdentity', 'snapshotDiagnosticLog',
  'diagnosticLogFreshness', 'readDiagnosticLog', 'latestNativeExitForFinalStage',
  'isMacNativeCrash', 'diagnosticRedact',
]) savedRecovery[key] = recovery[key];

const expectedAssetIds = [
  'vad-segmenter',
  'vad-model',
  'vad-license',
  'vad-runtime-ggml-base',
  'vad-runtime-ggml-cpu',
  'vad-runtime-ggml',
  'vad-runtime-whisper',
];
const expectedFileNames = {
  'vad-segmenter': 'whisper-vad-speech-segments.exe',
  'vad-model': 'ggml-silero-v6.2.0.bin',
  'vad-license': 'LICENSE',
  'vad-runtime-ggml-base': 'ggml-base.dll',
  'vad-runtime-ggml-cpu': 'ggml-cpu.dll',
  'vad-runtime-ggml': 'ggml.dll',
  'vad-runtime-whisper': 'whisper.dll',
};
const componentHost = '6865-he02-d8gebzv050ed6c4ef-1428610652.tcb.qcloud.la';
const authorizedManifest = {
  schemaVersion: 2,
  deliveryProtocol: 'cloudbase-v1',
  component: 'channels-vad',
  platform: 'win32',
  arch: 'x64',
  version: '2026.10.08',
  expiresAt: '2099-01-01T00:00:00.000Z',
  assets: expectedAssetIds.map((id, index) => {
    const sha256 = String.fromCharCode(97 + index).repeat(64);
    const fileName = expectedFileNames[id];
    return {
      id,
      fileName,
      sha256,
      byteLength: 1024 + index,
      downloadUrl: 'https://' + componentHost + '/local-components/by-sha256/' + sha256 + '/' + fileName + '?sign=fixture&t=fixture',
    };
  }),
};

let output = '正常讲话。';
let inspectionQueue = [];
let fallbackInspection = { available: false, reason: 'vad_assets_missing' };
let cachedResult = { available: false, reason: 'cached_receipt_missing' };
let installResult = { available: false, reason: 'manifest_unavailable' };
function completeRecovery(transcript) {
  return { decision: 'recovered', transcript, fullAudioProcessed: true, audioDurationSeconds: 10, unresolvedVadWindowCount: 0, windows: [{ startSeconds: 0, endSeconds: 9, voicedSeconds: 8.5, tokens: 14, meanTokenProbability: 0.96, medianTokenProbability: 0.96, rerunSimilarity: 0.96 }] };
}
let recoveryResult = completeRecovery('VAD 恢复后的完整文字');
let downloadFailure = false;
let manifestFailure = false;
let abortInCachedInspection = false;
let inspectCalls = 0;
let cachedCalls = 0;
let installCalls = 0;
let normalizeCalls = 0;
let recoveryCalls = 0;
let authCalls = 0;
let downloadCalls = 0;
const inspected = [];
const installRequests = [];
const recoveryRequests = [];
const downloadRequests = [];

const availableInspection = {
  available: true,
  vadSegmenterPath: 'vad.exe',
  vadModelPath: 'vad.bin',
};
const repeated = () => Array(12).fill('我们现在就来看看我们的临化设备').join('\n');

const optionalVad = {
  inspectCachedChannelsVadAssets: async ({ installRoot, platform, arch, signal } = {}) => {
    cachedCalls += 1;
    assert.equal(platform, 'win32');
    assert.equal(arch, 'x64');
    assert.ok(String(installRoot).endsWith(path.join('channels-vad')));
    if (abortInCachedInspection) {
      if (signal && typeof signal.abort === 'function') signal.abort();
      throw Object.assign(new Error('aborted fixture'), { name: 'AbortError' });
    }
    return cachedResult;
  },
  normalizeChannelsVadAssetManifest: (manifest, options = {}) => {
    normalizeCalls += 1;
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.capability, 'channels-vad');
    assert.equal(manifest.platform, 'win32');
    assert.equal(manifest.arch, 'x64');
    assert.ok(Array.isArray(manifest.assets));
    assert.deepEqual(
      manifest.assets.map((asset) => asset.id).sort(),
      expectedAssetIds.slice().sort(),
      'main must map the complete Channels VAD asset contract',
    );
    assert.ok(Array.isArray(options.allowedHosts));
    assert.ok(options.allowedHosts.includes(componentHost));
    manifest.assets.forEach((asset) => {
      assert.equal(asset.fileName, expectedFileNames[asset.id]);
      assert.match(asset.downloadUrl, new RegExp('/local-components/by-sha256/' + asset.sha256 + '/'));
    });
    return manifest;
  },
  installChannelsVadAssets: async (options = {}) => {
    installCalls += 1;
    installRequests.push(options);
    assert.equal(options.manifest.capability, 'channels-vad');
    assert.equal(options.manifest.schemaVersion, 1);
    assert.equal(options.platform, 'win32');
    assert.equal(options.arch, 'x64');
    assert.ok(String(options.installRoot).endsWith(path.join('channels-vad')));
    assert.equal(options.cacheRoot, path.join(options.installRoot, 'cache'));
    if (downloadFailure || installResult.available === true) {
      const asset = options.manifest.assets[0];
      await options.downloadAsset(asset.downloadUrl, path.join(options.cacheRoot, 'fixture.part'), {
        maxBytes: asset.byteLength,
      });
    }
    return installResult;
  },
};

vad.inspectChannelsVadAssets = async (args = {}) => {
  inspectCalls += 1;
  inspected.push(args);
  return inspectionQueue.length ? inspectionQueue.shift() : fallbackInspection;
};
vad.runChannelsQualityRecovery = async (options = {}) => {
  recoveryCalls += 1;
  recoveryRequests.push(options);
  return recoveryResult;
};
recovery.executeWithMacRecovery = async ({ execute, onAttempt, cpuPreferred = false }) => {
  try {
    const value = await execute({ cpu: cpuPreferred, attempt: 1 });
    if (onAttempt) onAttempt({ attempt: 1, cpu: cpuPreferred, status: 'success', error: null });
    return value;
  } catch (error) {
    if (onAttempt) onAttempt({ attempt: 1, cpu: cpuPreferred, status: 'failed', error });
    throw error;
  }
};
recovery.saveSession = () => {};
recovery.runtimeIdentity = () => ({ binarySha256: 'fixture' });
recovery.fingerprint = () => 'fixture';
recovery.modelIdentity = () => ({ model: 'fixture' });
recovery.systemIdentity = () => ({ platform: 'fixture' });
recovery.snapshotDiagnosticLog = () => ({ exists: false, size: 0, mtimeMs: 0 });
recovery.diagnosticLogFreshness = () => 'unavailable';
recovery.readDiagnosticLog = () => '';
recovery.latestNativeExitForFinalStage = () => ({ nativeExitCode: null, reason: 'unavailable' });
recovery.isMacNativeCrash = () => false;
recovery.diagnosticRedact = (value) => String(value || '');
timeoutGroup.execWithAsrTimeout = (command, _options, callback) => {
  const match = command.match(/-OutputPath\s+"([^"]+)"/i);
  assert.ok(match, 'expected wrapper output path');
  fs.writeFileSync(match[1], output, 'utf8');
  setImmediate(() => callback(null, '', ''));
  return { pid: 123, killed: false, kill() { this.killed = true; } };
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return {
    Modal: class {}, Notice: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
    requestUrl: async () => ({}),
  };
  if (request === './channels-vad-optional-assets') return optionalVad;
  return originalLoad.call(this, request, parent, isMain);
};
const extensions = ['.ps1', '.sh', '.py'];
const priorExtensions = new Map(extensions.map((ext) => [ext, Module._extensions[ext]]));
for (const ext of extensions) Module._extensions[ext] = (module, filename) => {
  module.exports = fs.readFileSync(filename, 'utf8');
};
delete require.cache[mainPath];
const Plugin = require(mainPath);
Module._load = originalLoad;
for (const ext of extensions) {
  if (priorExtensions.get(ext)) Module._extensions[ext] = priorExtensions.get(ext);
  else delete Module._extensions[ext];
}

const temporaryRoots = [];

function resetFixture() {
  output = repeated();
  inspectionQueue = [];
  fallbackInspection = { available: false, reason: 'vad_assets_missing' };
  cachedResult = { available: false, reason: 'cached_receipt_missing' };
  installResult = { available: false, reason: 'manifest_unavailable' };
  recoveryResult = completeRecovery('VAD 恢复后的完整文字');
  downloadFailure = false;
  manifestFailure = false;
  abortInCachedInspection = false;
  inspectCalls = 0;
  cachedCalls = 0;
  installCalls = 0;
  normalizeCalls = 0;
  recoveryCalls = 0;
  authCalls = 0;
  downloadCalls = 0;
  inspected.length = 0;
  installRequests.length = 0;
  recoveryRequests.length = 0;
  downloadRequests.length = 0;
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-vad-assets-'));
  temporaryRoots.push(dir);
  const input = path.join(dir, 'input.mp4');
  fs.writeFileSync(input, 'fixture');
  const plugin = new Plugin();
  plugin.settings = { aiProvider: 'local' };
  plugin.ensureLocalComponentReadyForUse = async () => {};
  plugin.recoverStaleLocalTranscriptionCommand = async () => {};
  plugin.getLocalAsrInstallStatus = () => ({
    scriptOutdated: false,
    ready: true,
    ffmpegPath: 'ffmpeg.exe',
    whisperPath: 'whisper-cli.exe',
    modelPath: 'ggml-small.bin',
  });
  plugin.getConfiguredLocalAsrInstallRoot = () => dir;
  plugin.getConfiguredLocalAsrPlatform = () => 'win32';
  plugin.getEffectiveLocalTranscriptionCommand = () => Plugin.__test.getDefaultLocalTranscriptionCommand('win32');
  plugin.getAuthorizedLocalComponentManifest = async (component) => {
    authCalls += 1;
    assert.equal(component, 'channels-vad');
    if (manifestFailure) throw new Error('fixture manifest unavailable');
    return authorizedManifest;
  };
  plugin.downloadChannelsVadAsset = async (url, targetPath, options = {}) => {
    downloadCalls += 1;
    downloadRequests.push({ url, targetPath, options });
    assert.equal(options.headers, undefined, 'VAD download must not receive user cookies/headers');
    if (downloadFailure) throw new Error('fixture download failed');
  };
  plugin.downloadMediaToTempFile = async () => input;
  plugin.showSyncProgress = () => {};
  plugin.setTranscriptionStopAvailable = () => {};
  return { plugin, dir };
}

async function runQuality(plugin, sourcePlatform = '视频号', signal = null) {
  const options = {
    retryLocalQualityOnce: true,
    sourcePlatform,
  };
  if (signal) options.signal = signal;
  return plugin.runLocalTranscription('https://media.example.test/v.mp4', options);
}

async function main() {
  resetFixture();
  const ordinary = setup().plugin;
  output = '一段正常讲话。';
  assert.equal(await runQuality(ordinary), output);
  assert.equal(inspectCalls, 0);
  assert.equal(cachedCalls, 0);
  assert.equal(authCalls, 0);

  resetFixture();
  const installed = setup().plugin;
  inspectionQueue = [availableInspection];
  assert.equal(await runQuality(installed), recoveryResult.transcript);
  assert.equal(inspectCalls, 1);
  assert.equal(cachedCalls, 0);
  assert.equal(authCalls, 0);
  assert.equal(installCalls, 0);
  assert.equal(recoveryCalls, 1);
  assert.equal(recoveryRequests[0].threads, 1);
  assert.equal(recoveryRequests[0].vadSegmenterPath, availableInspection.vadSegmenterPath);

  resetFixture();
  const downloaded = setup().plugin;
  inspectionQueue = [{ available: false, reason: 'vad_assets_missing' }];
  installResult = {
    available: true,
    bundleRoot: path.join('C:', 'fixture', 'channels-vad', 'vad', 'win32', 'x64', '2026.10.08'),
  };
  downloadFailure = true;
  await assert.rejects(
    () => runQuality(downloaded),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  assert.equal(authCalls, 1);
  assert.equal(normalizeCalls, 1);
  assert.equal(installCalls, 1);
  assert.equal(downloadCalls, 1);
  assert.equal(recoveryCalls, 0);
  const failedInstallCount = installCalls;
  await assert.rejects(
    () => runQuality(downloaded),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  assert.equal(installCalls, failedInstallCount, 'failed receipt/install must not redownload or consume another grant');
  assert.equal(authCalls, 1);

  resetFixture();
  const recovered = setup().plugin;
  inspectionQueue = [
    { available: false, reason: 'vad_assets_missing' },
    { ...availableInspection, vadSegmenterPath: 'isolated-vad.exe', vadModelPath: 'isolated-vad.bin' },
  ];
  installResult = {
    available: true,
    bundleRoot: path.join('C:', 'fixture', 'channels-vad', 'vad', 'win32', 'x64', '2026.10.08'),
  };
  downloadFailure = false;
  assert.equal(await runQuality(recovered), recoveryResult.transcript);
  assert.equal(inspectCalls, 2);
  assert.equal(cachedCalls, 1);
  assert.equal(authCalls, 1);
  assert.equal(normalizeCalls, 1);
  assert.equal(installCalls, 1);
  assert.equal(downloadCalls, 1);
  assert.equal(recoveryCalls, 1);
  assert.equal(recoveryRequests[0].threads, 1);
  assert.equal(recoveryRequests[0].vadSegmenterPath, 'isolated-vad.exe');
  assert.equal(recoveryRequests[0].vadModelPath, 'isolated-vad.bin');
  assert.equal(inspected[1].installRoot, installResult.bundleRoot);
  assert.equal(installRequests[0].platform, 'win32');
  assert.equal(installRequests[0].arch, 'x64');
  assert.ok(String(installRequests[0].installRoot).endsWith(path.join('channels-vad')));
  assert.equal(downloadRequests[0].options.expectedAsset.id, 'vad-segmenter');
  assert.equal(downloadRequests[0].options.maxBytes, authorizedManifest.assets[0].byteLength);

  resetFixture();
  const backoff = setup().plugin;
  let simulatedNow = 1000000;
  backoff.channelsVadInstallNow = () => simulatedNow;
  inspectionQueue = [{ available: false, reason: 'vad_assets_missing' }];
  manifestFailure = true;
  await assert.rejects(
    () => runQuality(backoff),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  assert.equal(authCalls, 1);
  manifestFailure = false;
  inspectionQueue = [{ available: false, reason: 'vad_assets_missing' }];
  await assert.rejects(
    () => runQuality(backoff),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  assert.equal(authCalls, 1, 'manifest failure must be rate-limited during the backoff window');
  cachedResult = {
    available: true,
    bundleRoot: path.join('C:', 'fixture', 'channels-vad', 'cached-bundle'),
  };
  inspectionQueue = [
    { available: false, reason: 'vad_assets_missing' },
    { ...availableInspection, vadSegmenterPath: 'cached-vad.exe', vadModelPath: 'cached-vad.bin' },
  ];
  assert.equal(await runQuality(backoff), recoveryResult.transcript, 'a repaired verified receipt must bypass network backoff');
  assert.equal(authCalls, 1);
  assert.equal(installCalls, 0);
  assert.equal(recoveryCalls, 1);
  assert.equal(recoveryRequests[0].vadSegmenterPath, 'cached-vad.exe');
  assert.equal(recoveryRequests[0].vadModelPath, 'cached-vad.bin');

  resetFixture();
  const expiredBackoff = setup().plugin;
  simulatedNow = 2000000;
  expiredBackoff.channelsVadInstallNow = () => simulatedNow;
  inspectionQueue = [{ available: false, reason: 'vad_assets_missing' }];
  manifestFailure = true;
  await assert.rejects(
    () => runQuality(expiredBackoff),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  manifestFailure = false;
  simulatedNow += 5 * 60 * 1000 + 1;
  inspectionQueue = [{ available: false, reason: 'vad_assets_missing' }];
  await assert.rejects(
    () => runQuality(expiredBackoff),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  assert.equal(authCalls, 2, 'manifest should be retried after the finite backoff');
  assert.equal(installCalls, 1);

  resetFixture();
  const invalidReceipt = setup().plugin;
  inspectionQueue = [{ available: false, reason: 'vad_assets_missing' }];
  cachedResult = { available: false, reason: 'cached_receipt_invalid' };
  await assert.rejects(
    () => runQuality(invalidReceipt),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  await assert.rejects(
    () => runQuality(invalidReceipt),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  assert.equal(cachedCalls, 2, 'invalid cached receipt must be rechecked before the permanent failure gate');
  assert.equal(authCalls, 0);
  assert.equal(installCalls, 0);
  assert.equal(downloadCalls, 0);

  resetFixture();
  const aborted = setup().plugin;
  inspectionQueue = [{ available: false, reason: 'vad_assets_missing' }];
  abortInCachedInspection = true;
  const controller = new AbortController();
  await assert.rejects(
    () => runQuality(aborted, '视频号', controller.signal),
    (error) => error.code === 'TRANSCRIPTION_PENDING' && error.retryable === true,
  );
  assert.equal(authCalls, 0);
  assert.equal(installCalls, 0);
  assert.equal(downloadCalls, 0);
  assert.equal(recoveryCalls, 0);

  resetFixture();
  const otherPlatform = setup().plugin;
  inspectionQueue = [{ available: false, reason: 'vad_assets_missing' }];
  await assert.rejects(
    () => runQuality(otherPlatform, '抖音'),
    (error) => error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.qualityIssue === 'repeated-lines',
  );
  assert.equal(inspectCalls, 0, 'non-Channels source must not inspect VAD');
  assert.equal(cachedCalls, 0);
  assert.equal(authCalls, 0);
  assert.equal(installCalls, 0);
  assert.equal(downloadCalls, 0);
  console.log('PASS Channels VAD asset wiring: ordinary path, installed reuse, isolated authorized mapping, size/cookie-safe callback, receipt memoization/backoff, abort, source gate');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
}).finally(() => {
  for (const tempRoot of temporaryRoots) fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const key of Object.keys(savedVad)) vad[key] = savedVad[key];
  timeoutGroup.execWithAsrTimeout = savedExec;
  Object.assign(recovery, savedRecovery);
});