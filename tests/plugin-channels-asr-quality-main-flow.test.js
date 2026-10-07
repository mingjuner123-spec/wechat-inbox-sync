'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const originalHomedir = os.homedir;
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-quality-main-flow-'));
os.homedir = () => testRoot;
let recoveryResult = null;
const recoveryCalls = [];
const originalLoad = Module._load;
const sourceTextExtensions = ['.ps1', '.sh', '.py'];
const priorSourceTextLoaders = new Map(sourceTextExtensions.map(extension => [extension, Module._extensions[extension]]));
for (const extension of sourceTextExtensions) Module._extensions[extension] = (module, filename) => { module.exports = fs.readFileSync(filename, 'utf8'); };
Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return {
    Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {},
    Notice: class {}, requestUrl: async () => { throw new Error('Unexpected network'); },
  };
  if (request === './channels-asr-quality-recovery'
    && String(parent && parent.filename || '').endsWith(`${path.sep}src${path.sep}main.js`)) {
    return {
      inspectChannelsVadAssets: async () => ({ available: true, vadSegmenterPath: 'fixture-vad', vadModelPath: 'fixture-model' }),
      runChannelsQualityRecovery: async options => {
        recoveryCalls.push(options);
        return recoveryResult;
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');
for (const [extension, loader] of priorSourceTextLoaders) { if (loader) Module._extensions[extension] = loader; else delete Module._extensions[extension]; }
Module._load = originalLoad;

const asrRecovery = require('../obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils');
const asrTimeout = require('../obsidian-plugin/wechat-inbox-sync/src/asr-timeout-process-group');
const macCompat = require('../obsidian-plugin/wechat-inbox-sync/src/mac-legacy-asr-compat');
const originalRecovery = {
  ensureManagedMacScript: asrRecovery.ensureManagedMacScript,
  runtimeIdentity: asrRecovery.runtimeIdentity,
  fingerprint: asrRecovery.fingerprint,
  cpuPreference: asrRecovery.cpuPreference,
  saveSession: asrRecovery.saveSession,
};
const originalExec = asrTimeout.execWithAsrTimeout;
const originalInspectCompat = macCompat.inspectMacLegacyAsr;
const repeatedTranscript = Array(6).fill('We hold these truths to be self-evident').join('\n');
const partialTranscript = 'We hold these truths to be self-evident, that all men are created equal.';
let asrRunCount = 0;

function configurePlugin() {
  const installRoot = path.join(testRoot, `managed-${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/\\/g, '/');
  fs.mkdirSync(installRoot, { recursive: true });
  const inputPath = path.join(installRoot, 'input.mp4');
  fs.writeFileSync(inputPath, 'synthetic media bytes');
  const command = `/bin/bash "${path.join(installRoot, 'transcribe.sh').replace(/\\/g, '/')}" --input {input} --output {output}`;
  const plugin = new Plugin();
  plugin.settings = { aiProvider: 'local' };
  plugin.ensureLocalComponentReadyForUse = async () => {};
  plugin.recoverStaleLocalTranscriptionCommand = async () => {};
  plugin.getLocalAsrInstallStatus = () => ({ scriptOutdated: false, ready: true, ffmpegPath: 'fixture-ffmpeg', whisperPath: 'fixture-whisper', modelPath: 'fixture-model' });
  plugin.getConfiguredLocalAsrInstallRoot = () => installRoot;
  plugin.getConfiguredLocalAsrPlatform = () => 'darwin';
  plugin.getEffectiveLocalTranscriptionCommand = () => command;
  plugin.downloadMediaToTempFile = async () => inputPath;
  plugin.showSyncProgress = () => {};
  plugin.setTranscriptionStopAvailable = () => {};
  plugin.ensureChannelsVadAssetsForQualityRecovery = async () => ({ available: true, vadSegmenterPath: 'fixture-vad', vadModelPath: 'fixture-model' });
  plugin._macOSProductVersion = '14.0';
  return plugin;
}

function recoveryFixture({ decision, transcript = partialTranscript, unresolvedVadWindowCount = 0, unresolvedAsrWindowCount = 0, unresolvedWindowCount = null, confidence = 0.96 } = {}) {
  const totalUnresolvedWindowCount = unresolvedWindowCount == null
    ? unresolvedVadWindowCount + unresolvedAsrWindowCount
    : unresolvedWindowCount;
  return {
    decision,
    transcript,
    fullAudioProcessed: true,
    audioDurationSeconds: 10,
    unresolvedVadWindowCount,
    unresolvedAsrWindowCount,
    unresolvedWindowCount: totalUnresolvedWindowCount,
    windows: [{
      startSeconds: 0, endSeconds: 9, voicedSeconds: 8.5, tokens: 14,
      meanTokenProbability: confidence, medianTokenProbability: confidence,
      rerunSimilarity: 0.96,
    }],
  };
}

async function run() {
  asrRecovery.ensureManagedMacScript = () => true;
  asrRecovery.runtimeIdentity = () => ({});
  asrRecovery.fingerprint = () => 'synthetic-runtime';
  asrRecovery.cpuPreference = () => false;
  asrRecovery.saveSession = () => {};
  macCompat.inspectMacLegacyAsr = () => ({ status: 'not-eligible', reason: 'synthetic-test', eligible: false, alreadyActive: false });
  asrTimeout.execWithAsrTimeout = (command, _options, callback) => {
    asrRunCount += 1;
    const outputMatch = command.match(/--output "([^"]+)"/);
    assert.ok(outputMatch, 'managed ASR command must expose output path');
    setImmediate(() => {
      fs.writeFileSync(outputMatch[1], repeatedTranscript);
      callback(null, '', '');
    });
    return { pid: 4000 + asrRunCount, killed: false, kill() { this.killed = true; } };
  };

  const verifiedRepeated = recoveryFixture({
    decision: 'preserve_repeated_speech_candidate',
    transcript: repeatedTranscript,
  });
  recoveryResult = verifiedRepeated;
  const directPlugin = configurePlugin();
  const direct = await directPlugin.runConfiguredTranscription('https://media.example.test/synthetic.mp4', {
    forceLocal: true,
    sourcePlatform: '视频号',
    retryLocalQualityOnce: true,
    transcriptionLanguage: 'en',
  });
  assert.equal(direct.transcription, repeatedTranscript, 'verified repeated lines must be preserved exactly');
  assert.equal(direct.transcriptionQualityStatus, 'consistent_repeated_speech_candidate');
  assert.match(direct.transcriptionQualityWarning, /原文已原样保留，建议核对原音频/);
  assert.equal(recoveryCalls.at(-1).language, 'en', 'explicit transcription language must reach VAD recovery');

  const sourceUrl = 'https://channels.weixin.qq.com/platform/synthetic-test';
  const record = {
    _id: 'synthetic-channel-record',
    type: 'webpage',
    content: sourceUrl,
    metadata: { url: sourceUrl, transcriptionMode: 'local' },
  };
  const media = {
    url: sourceUrl,
    platform: '视频号',
    mediaUrl: 'https://media.example.test/synthetic.mp4',
    preparedMedia: true,
    source: 'wechat-channels-media-prepare',
    markdown: '合成原始正文，保留在记录中。',
    sourceTitle: '合成视频',
  };
  recoveryResult = verifiedRepeated;
  const completePlugin = configurePlugin();
  const complete = await completePlugin.buildTranscriptRecordFromMedia(record, media);
  assert.equal(complete.metadata.transcriptionStatus, 'success');
  assert.equal(complete.metadata.conversionStatus, 'success');
  assert.equal(complete.metadata.transcription, repeatedTranscript);
  assert.equal(complete.metadata.transcriptionQualityStatus, 'consistent_repeated_speech_candidate');
  assert.match(complete.metadata.trailingMarkdown, /质量提醒：检测到重复内容；原文已原样保留，建议核对原音频/);
  assert.equal(complete.metadata.url, sourceUrl, 'the original source link must remain attached');
  const renderedNote = Plugin.__test.buildMarkdownForRecord({ record: complete, title: '合成视频', syncedAt: '2026-10-08T00:00:00.000Z', propertyFields: 'title,url,synced_at' });
  assert.ok(renderedNote.includes(repeatedTranscript), 'the verified repeated wording must be present in the rendered note');
  assert.ok(renderedNote.includes(sourceUrl), 'the rendered note must retain the original source link');
  assert.match(renderedNote, /检测到重复内容；原文已原样保留，建议核对原音频/);
  const savedFiles = new Map();
  completePlugin.settings = { inboxDir: '临时收集', noteSaveMode: 'root', notePropertyFields: 'title,url,synced_at', socialArticleImageStorageMode: 'flat' };
  completePlugin.app = { vault: { adapter: { write: async (name, value) => savedFiles.set(name, value), exists: async name => savedFiles.has(name), remove: async name => savedFiles.delete(name) }, create: async (name, value) => savedFiles.set(name, value) } };
  completePlugin.ensureFolder = async () => {};
  completePlugin.nextRecordTitle = async () => '合成视频';
  completePlugin.nextTitle = async () => '合成视频';
  completePlugin.hydrateWebpageMarkdown = async () => complete;
  completePlugin.saveSourceMediaAttachment = async value => value;
  completePlugin.alignSocialArticleImageFolder = async value => ({ record: value, folderName: '合成视频' });
  const writeResult = await completePlugin.writeRecord(record, '2026-10-08T00:00:00.000Z', null, false, { skipAi: true });
  assert.equal(writeResult.committed, true);
  const savedNote = savedFiles.get(writeResult.filePath);
  assert.ok(savedNote.includes(repeatedTranscript), 'writeRecord must save the verified repeated wording');
  assert.ok(savedNote.includes(sourceUrl), 'writeRecord must save the original source link');
  assert.match(savedNote, /检测到重复内容；原文已原样保留，建议核对原音频/);

  recoveryResult = recoveryFixture({ decision: 'partial_recovery', unresolvedVadWindowCount: 1 });
  delete recoveryResult.unresolvedWindowCount;
  const partialPlugin = configurePlugin();
  const partial = await partialPlugin.buildTranscriptRecordFromMedia(record, media);
  assert.equal(partial.metadata.transcriptionStatus, 'failed');
  assert.equal(partial.metadata.conversionStatus, 'partial');
  assert.equal(partial.metadata.transcription, '', 'uncovered audio must not become a successful full transcript');
  assert.match(partial.metadata.trailingMarkdown, /待确认的转写片段/);
  assert.match(partial.metadata.trailingMarkdown, /整段音频仍有未覆盖窗口/);
  assert.ok(partial.metadata.trailingMarkdown.includes(partialTranscript));

  recoveryResult = recoveryFixture({
    decision: 'partial_recovery',
    unresolvedVadWindowCount: 0,
    unresolvedAsrWindowCount: 1,
    unresolvedWindowCount: 1,
  });
  const asrOnlyPartialPlugin = configurePlugin();
  const asrOnlyPartial = await asrOnlyPartialPlugin.buildTranscriptRecordFromMedia(record, media);
  assert.equal(asrOnlyPartial.metadata.transcriptionStatus, 'failed', 'ASR-only unresolved recovery must remain failed');
  assert.equal(asrOnlyPartial.metadata.conversionStatus, 'partial', 'ASR-only unresolved recovery must remain partial');
  assert.equal(asrOnlyPartial.metadata.transcription, '', 'ASR-only unresolved recovery must not masquerade as a complete transcript');
  assert.match(asrOnlyPartial.metadata.trailingMarkdown, /待确认的转写片段/);
  assert.ok(asrOnlyPartial.metadata.trailingMarkdown.includes(partialTranscript), 'accepted ASR text must be retained for review');
  const asrOnlyPartialNote = Plugin.__test.buildMarkdownForRecord({
    record: asrOnlyPartial, title: '合成视频', syncedAt: '2026-10-08T00:00:00.000Z', propertyFields: 'title,url,synced_at',
  });
  assert.ok(asrOnlyPartialNote.includes(partialTranscript), 'rendered partial note must retain accepted ASR text');
  assert.ok(asrOnlyPartialNote.includes('合成原始正文，保留在记录中。'), 'rendered partial note must retain original body');
  assert.doesNotMatch(asrOnlyPartialNote, /transcriptionStatus: success/);
  recoveryResult = recoveryFixture({
    decision: 'preserve_repeated_speech_candidate',
    transcript: repeatedTranscript,
    unresolvedVadWindowCount: 1,
  });
  const incompletePlugin = configurePlugin();
  const incomplete = await incompletePlugin.buildTranscriptRecordFromMedia(record, media);
  assert.equal(incomplete.metadata.transcriptionStatus, 'failed', 'incomplete audio cannot be accepted as full recovery');
  assert.equal(incomplete.metadata.transcription, '');
  assert.doesNotMatch(String(incomplete.metadata.trailingMarkdown || ''), /待确认的转写片段/);

  recoveryResult = recoveryFixture({ decision: 'retain_quality_failure', transcript: repeatedTranscript });
  const rejectedPlugin = configurePlugin();
  const rejected = await rejectedPlugin.buildTranscriptRecordFromMedia(record, media);
  assert.equal(rejected.metadata.transcriptionStatus, 'failed');
  assert.equal(rejected.metadata.transcription, '');
  assert.doesNotMatch(String(rejected.metadata.trailingMarkdown || ''), /待确认的转写片段/);

  const { createSyncDiagnosticReporter } = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');
  let diagnosticPosted = false;
  const reporter = createSyncDiagnosticReporter({ postEvents: async () => { diagnosticPosted = true; }, saveOutbox: async () => {} });
  const diagnostic = reporter.enqueue({
    outcome: 'succeeded', attemptId: 'synthetic-attempt-0001', syncRecordId: record._id,
    transcription: complete.metadata.transcription,
  }, { token: 'synthetic-token' });
  assert.equal(diagnostic.queued, false, 'successful transcript bodies must not enter diagnostics');
  assert.equal(diagnosticPosted, false);

  assert.equal(recoveryCalls.length, 6);
  console.log('PASS Channels ASR quality main flow: repeated transcript retained with warning; partial remains failed and review-only; incomplete/ordinary failures stay failed; success body rejected from diagnostics');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  asrRecovery.ensureManagedMacScript = originalRecovery.ensureManagedMacScript;
  asrRecovery.runtimeIdentity = originalRecovery.runtimeIdentity;
  asrRecovery.fingerprint = originalRecovery.fingerprint;
  asrRecovery.cpuPreference = originalRecovery.cpuPreference;
  asrRecovery.saveSession = originalRecovery.saveSession;
  asrTimeout.execWithAsrTimeout = originalExec;
  macCompat.inspectMacLegacyAsr = originalInspectCompat;
  os.homedir = originalHomedir;
  fs.rmSync(testRoot, { recursive: true, force: true });
});