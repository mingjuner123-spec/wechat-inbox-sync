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
const savedVad = { ...vad };
const savedExec = timeoutGroup.execWithAsrTimeout;
const savedRecovery = {};
for (const key of ['executeWithMacRecovery','saveSession','runtimeIdentity','fingerprint','modelIdentity','systemIdentity','snapshotDiagnosticLog','diagnosticLogFreshness','readDiagnosticLog','latestNativeExitForFinalStage','isMacNativeCrash','diagnosticRedact']) savedRecovery[key] = recovery[key];

let helperCalls = 0;
let helperInstallCalls = 0;
const optionalVad = {
  inspectCachedChannelsVadAssets: async () => ({ available: false, reason: 'cached_receipt_missing' }),
  installChannelsVadAssets: async () => {
    helperInstallCalls += 1;
    return { available: false, reason: 'manifest_unavailable' };
  },
  normalizeChannelsVadAssetManifest: (manifest) => manifest,
};
let assets = { available: true, vadSegmenterPath: 'vad.exe', vadModelPath: 'vad.bin' };
function completeRecovery(transcript) {
  return { decision: 'recovered', transcript, fullAudioProcessed: true, audioDurationSeconds: 10, unresolvedVadWindowCount: 0, windows: [{ startSeconds: 0, endSeconds: 9, voicedSeconds: 8.5, tokens: 14, meanTokenProbability: 0.96, medianTokenProbability: 0.96, rerunSimilarity: 0.96 }] };
}
let result = completeRecovery('恢复得到的真实口播文字');
let output = '这是一段正常的口播内容。';
const recoveryCalls = [];
vad.inspectChannelsVadAssets = async () => assets;
vad.runChannelsQualityRecovery = async (options) => {
  helperCalls += 1;
  recoveryCalls.push({ ...options });
  return typeof result === 'function' ? result(options) : result;
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
const extensions = ['.ps1','.sh','.py'];
const priorExtensions = new Map(extensions.map((ext) => [ext, Module._extensions[ext]]));
for (const ext of extensions) Module._extensions[ext] = (module, filename) => { module.exports = fs.readFileSync(filename, 'utf8'); };
delete require.cache[mainPath];
const Plugin = require(mainPath);
Module._load = originalLoad;
for (const ext of extensions) {
  if (priorExtensions.get(ext)) Module._extensions[ext] = priorExtensions.get(ext);
  else delete Module._extensions[ext];
}

const temporaryRoots = [];
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-vad-wiring-'));
  temporaryRoots.push(dir);
  const input = path.join(dir, 'input.mp4');
  fs.writeFileSync(input, 'fixture');
  const plugin = new Plugin();
  plugin.settings = { aiProvider: 'local' };
  plugin.ensureLocalComponentReadyForUse = async () => {};
  plugin.recoverStaleLocalTranscriptionCommand = async () => {};
  plugin.getLocalAsrInstallStatus = () => ({ scriptOutdated: false, ready: true, ffmpegPath: 'ffmpeg.exe', whisperPath: 'whisper-cli.exe', modelPath: 'ggml-small.bin' });
  plugin.getConfiguredLocalAsrInstallRoot = () => dir;
  plugin.getConfiguredLocalAsrPlatform = () => 'win32';
  plugin.getEffectiveLocalTranscriptionCommand = () => Plugin.__test.getDefaultLocalTranscriptionCommand('win32');
  plugin.getAuthorizedLocalComponentManifest = async () => null;
  plugin.downloadMediaToTempFile = async () => input;
  plugin.showSyncProgress = () => {};
  plugin.setTranscriptionStopAvailable = () => {};
  return { plugin, dir };
}
const repeated = () => Array(12).fill('我们现在就来看看我们的临化设备').join('\n');

async function main() {
  const { plugin, dir } = setup();
  try {
    helperCalls = 0;
    output = '一段正常讲话。';
    assert.equal(await plugin.runLocalTranscription('https://media.example.test/v.mp4', { retryLocalQualityOnce: true, sourcePlatform: '视频号' }), output);
    assert.equal(helperCalls, 0, 'normal success must not invoke VAD');

    output = '[音乐]';
    result = { decision: 'no_speech', noSpeechEvidence: 'full-decode-and-vad-no-speech-segments', fullAudioProcessed: true, audioDurationSeconds: 10 };
    const markerRecord = { _id: 'fixture-marker-record', type: 'webpage', content: 'https://media.example.test/source', metadata: { transcriptionMode: 'local' } };
    for (const platform of ['抖音', '小红书', 'B站', '视频号']) {
      const markerSaved = await plugin.buildTranscriptRecordFromMedia(markerRecord, {
        url: markerRecord.content, platform, mediaUrl: 'https://media.example.test/marker-' + platform + '.mp4', preparedMedia: true,
      });
      assert.equal(markerSaved.metadata.transcriptionStatus, 'no_speech', platform + ' accepts only VAD-confirmed no-speech');
      assert.equal(markerSaved.metadata.noSpeechEvidence, 'full-decode-and-vad-no-speech-segments');
    }
    assert.equal(recoveryCalls.filter((call) => call.verificationOnly === true).length, 4, 'each supported media platform verifies marker output with full decode + VAD');
    assert.ok(recoveryCalls.slice(-4).every((call) => call.qualityIssue === 'non-speech-markers'), 'marker verification uses the dedicated candidate reason');
    helperCalls = 0;

    output = repeated();
    await assert.rejects(() => plugin.runLocalTranscription('https://media.example.test/v.mp4'), (e) => e.code === 'TRANSCRIPTION_LOW_QUALITY');
    assert.equal(helperCalls, 0, 'non-opt-in path must preserve quality failure');

    output = '请输入简体中文\n请输出简体中文';
    await assert.rejects(() => plugin.runLocalTranscription('https://media.example.test/v.mp4', { retryLocalQualityOnce: true, sourcePlatform: '视频号' }), (e) => e.code === 'TRANSCRIPTION_LOW_QUALITY' && e.qualityIssue === 'prompt-leak');
    assert.equal(helperCalls, 0, 'non-repeated quality failures must not enter VAD recovery');

    output = repeated();
    assets = { available: false, reason: 'vad_model_unavailable' };
    await assert.rejects(() => plugin.runLocalTranscription('https://media.example.test/v.mp4', { retryLocalQualityOnce: true, sourcePlatform: '视频号' }), (e) => e.code === 'TRANSCRIPTION_LOW_QUALITY' && e.qualityIssue === 'repeated-lines');
    assert.equal(helperCalls, 0, 'missing assets must not invoke VAD');

    assets = { available: true, vadSegmenterPath: 'vad.exe', vadModelPath: 'vad.bin' };
    result = completeRecovery('恢复得到的真实口播文字');
    helperCalls = 0;
    assert.equal(await plugin.runLocalTranscription('https://media.example.test/v.mp4', { retryLocalQualityOnce: true, sourcePlatform: '视频号' }), result.transcript);
    assert.equal(helperCalls, 1);

    for (const decision of ['partial_recovery','preserve_repeated_speech_candidate']) {
      result = { decision, transcript: '候选文本不能成功' };
      await assert.rejects(() => plugin.runLocalTranscription('https://media.example.test/v.mp4', { retryLocalQualityOnce: true, sourcePlatform: '视频号' }), (e) => e.code === 'TRANSCRIPTION_LOW_QUALITY');
    }

    result = { decision: 'no_speech', noSpeechEvidence: 'full-decode-and-vad-no-speech-segments', fullAudioProcessed: true };
    const noSpeechPlugin = setup().plugin;
    let noSpeechOptions;
    noSpeechPlugin.runConfiguredTranscription = async (mediaUrl, options) => {
      noSpeechOptions = options;
      return { transcription: await noSpeechPlugin.runLocalTranscription(mediaUrl, options), source: 'local' };
    };
    const source = {
      _id: 'fixture-channels-record', type: 'webpage',
      content: 'https://channels.weixin.qq.com/feed/source',
      metadata: { title: '视频号来源标题', transcriptionMode: 'cloud', cloudTranscriptionRequested: true },
    };
    const saved = await noSpeechPlugin.buildTranscriptRecordFromMedia(source, {
      url: source.content, platform: '视频号', mediaUrl: 'https://media.example.test/v.mp4',
      preparedMedia: true, source: 'wechat-channels-media-prepare',
      markdown: '原来源说明和图文', sourceTitle: '视频号来源标题',
    });
    assert.equal(noSpeechOptions.forceLocal, true, 'legacy cloud metadata must still use local Channels ASR');
    assert.equal(noSpeechOptions.allowCloudUrlFallback, false);
    assert.equal(noSpeechOptions.retryLocalQualityOnce, true);
    assert.equal(saved.metadata.transcriptionStatus, 'no_speech');
    assert.equal(saved.metadata.conversionStatus, 'no_speech');
    assert.equal(saved.metadata.transcription, '');
    assert.equal(saved.metadata.noSpeechEvidence, 'full-decode-and-vad-no-speech-segments');
    assert.equal(saved.metadata.sourceTitle, '视频号来源标题');
    assert.equal(saved.metadata.markdown, '原来源说明和图文');

    output = '[音乐]';
    result = { decision: 'speech_detected', fullAudioProcessed: true, audioDurationSeconds: 10, speechSegmentCount: 1 };
    const speechRecord = { _id: 'fixture-marker-speech-record', type: 'webpage', content: 'https://media.example.test/speech', metadata: { transcriptionMode: 'local' } };
    const speechSaved = await plugin.buildTranscriptRecordFromMedia(speechRecord, {
      url: speechRecord.content, platform: '抖音', mediaUrl: 'https://media.example.test/speech.mp4', preparedMedia: true,
    });
    assert.equal(speechSaved.metadata.transcriptionStatus, 'failed', 'VAD speech keeps a marker-only ASR result in failure/uncertain state');
    assert.notEqual(speechSaved.metadata.noSpeechEvidence, 'non-speech-markers');
    result = { decision: 'retain_quality_failure', reason: 'vad_process_failed' };
    const failedSpeech = await plugin.buildTranscriptRecordFromMedia(speechRecord, {
      url: speechRecord.content, platform: '小红书', mediaUrl: 'https://media.example.test/speech-failed.mp4', preparedMedia: true,
    });
    assert.equal(failedSpeech.metadata.transcriptionStatus, 'failed', 'VAD failure cannot become no-speech');

    let mixedVerificationCount = 0;
    result = () => (++mixedVerificationCount === 1
      ? { decision: 'no_speech', noSpeechEvidence: 'full-decode-and-vad-no-speech-segments', fullAudioProcessed: true }
      : { decision: 'retain_quality_failure', reason: 'vad_process_failed' });
    const mixedRecord = { _id: 'fixture-marker-mixed-record', type: 'webpage', content: 'https://media.example.test/mixed', metadata: { transcriptionMode: 'local' } };
    const mixedSaved = await plugin.buildTranscriptRecordFromMedia(mixedRecord, {
      url: mixedRecord.content, platform: 'B站', mediaUrl: 'https://media.example.test/mixed-a.mp4', mediaUrls: ['https://media.example.test/mixed-b.mp4'], preparedMedia: true,
    });
    assert.equal(mixedSaved.metadata.transcriptionStatus, 'failed', 'a confirmed no-speech candidate plus a real failure remains failed');

    output = repeated();
    result = { decision: 'recovered', transcript: '不应进入恢复' };
    helperCalls = 0;
    const otherPlatform = setup().plugin;
    otherPlatform.runConfiguredTranscription = async (mediaUrl, options) => ({
      transcription: await otherPlatform.runLocalTranscription(mediaUrl, options), source: 'local',
    });
    const otherRecord = { _id: 'fixture-other-record', type: 'webpage', content: 'https://example.test/source', metadata: {} };
    const otherSaved = await otherPlatform.buildTranscriptRecordFromMedia(otherRecord, {
      url: otherRecord.content, platform: '抖音', mediaUrl: 'https://media.example.test/other.mp4', preparedMedia: true,
    });
    assert.equal(otherSaved.metadata.transcriptionStatus, 'failed');
    assert.equal(helperCalls, 1, 'shared media platforms verify repeated candidates with VAD but keep the quality failure');

    result = { decision: 'no_speech', noSpeechEvidence: 'full-decode-and-vad-no-speech-segments', fullAudioProcessed: true };
    for (const platform of ['抖音', '小红书', 'B站', '小宇宙']) {
      await assert.rejects(plugin.runLocalTranscription('https://media.example.test/repeated.mp4', { sourcePlatform: platform }),
        { code: 'TRANSCRIPTION_NO_SPEECH', noSpeechEvidence: 'full-decode-and-vad-no-speech-segments' });
    }

    const abort = setup();
    const controller = new AbortController();
    result = { decision: 'aborted' };
    const oldRunner = vad.runChannelsQualityRecovery;
    vad.runChannelsQualityRecovery = async () => { helperCalls += 1; controller.abort(); return result; };
    try {
      await assert.rejects(() => abort.plugin.runLocalTranscription('https://media.example.test/v.mp4', { retryLocalQualityOnce: true, sourcePlatform: '视频号', signal: controller.signal }), (e) => e.code === 'TRANSCRIPTION_PENDING' && e.retryable === true);
    } finally {
      vad.runChannelsQualityRecovery = oldRunner;
      fs.rmSync(abort.dir, { recursive: true, force: true });
    }
    console.log('PASS Channels VAD main wiring: normal, non-opt-in, missing assets, recovered, partial/candidate rejection, no_speech source preservation, abort');
  } finally {
    for (const tempRoot of temporaryRoots) fs.rmSync(tempRoot, { recursive: true, force: true });
    for (const key of Object.keys(savedVad)) vad[key] = savedVad[key];
    timeoutGroup.execWithAsrTimeout = savedExec;
    Object.assign(recovery, savedRecovery);
  }
}
main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
