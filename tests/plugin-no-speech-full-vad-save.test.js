'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-full-vad-no-speech-'));
os.homedir = () => home;
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'obsidian') return {
    Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {},
    Notice: class {}, requestUrl: async () => { throw new Error('Unexpected network'); },
  };
  return originalLoad.call(this, name, ...args);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;

const h = Plugin.__test;
const { createSyncDiagnosticReporter } = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');

function fixture() {
  const plugin = new Plugin();
  plugin.settings = h.mergeSettings({ aiProvider: 'local' });
  plugin.showSyncProgress = () => {};
  return plugin;
}

function installVaultFixture(plugin) {
  const files = new Map();
  plugin.app = {
    vault: {
      adapter: {
        write: async (name, value) => files.set(name, value),
        exists: async name => files.has(name),
        remove: async name => files.delete(name),
      },
      create: async (name, value) => { files.set(name, value); },
    },
  };
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => '视频号原始说明';
  plugin.nextTitle = async () => '视频号原始说明';
  plugin.saveSourceMediaAttachment = async record => record;
  plugin.alignSocialArticleImageFolder = async record => ({ record, folderName: '视频号原始说明' });
  return files;
}

async function run() {
  const plugin = fixture();
  const url = 'https://channels.weixin.qq.com/feed/typed-no-speech';
  const sourceRecord = {
    _id: 'typed-full-vad-record',
    type: 'webpage',
    content: url,
    metadata: { url, transcriptionMode: 'local' },
  };
  const media = {
    url,
    platform: '视频号',
    source: 'wechat-channels-media-prepare',
    mediaUrl: 'https://media.example.test/channels-30s.mp4',
    preparedMedia: true,
    markdown: '原始视频说明和图文内容。',
    sourceTitle: '视频号原始说明',
  };
  const typedNoSpeech = Object.assign(new Error('未检测到可转写的语音。'), {
    code: 'TRANSCRIPTION_NO_SPEECH',
    noSpeechEvidence: 'full-decode-and-vad-no-speech-segments',
  });
  let asrCalls = 0;
  plugin.runConfiguredTranscription = async () => {
    asrCalls += 1;
    throw typedNoSpeech;
  };

  const saved = await plugin.buildTranscriptRecordFromMedia(sourceRecord, media);
  assert.equal(asrCalls, 1);
  assert.equal(saved.metadata.transcriptionStatus, 'no_speech');
  assert.equal(saved.metadata.conversionStatus, 'no_speech');
  assert.equal(saved.metadata.transcription, '');
  assert.equal(saved.metadata.noSpeechEvidence, 'full-decode-and-vad-no-speech-segments');
  assert.equal(h.getSyncLifecycleOutcomeError(saved), null);

  const rendered = h.buildWebpageMarkdownBody(saved, '视频号原始说明');
  assert.match(rendered, /本次未检测到可转写语音，已保存原内容和链接/);
  assert.ok(rendered.includes('原始视频说明和图文内容。'));
  assert.ok(rendered.includes(url));
  assert.doesNotMatch(rendered, /转写成功|音频中没有人声/);

  const files = installVaultFixture(plugin);
  plugin.hydrateWebpageMarkdown = async () => saved;
  const committed = await plugin.writeRecord(
    { ...sourceRecord, type: 'text' },
    new Date().toISOString(),
    null,
    false,
    { skipAi: true },
  );
  assert.equal(committed.committed, true);
  const note = files.get(committed.filePath);
  assert.equal(typeof note, 'string');
  assert.match(note, /本次未检测到可转写语音，已保存原内容和链接/);
  assert.ok(note.includes(url));
  assert.ok(note.includes('原始视频说明和图文内容。'));
  assert.doesNotMatch(note, /转写成功|音频中没有人声/);
  assert.equal(files.size, 1, 'writeRecord must commit one note through the vault adapter');

  const completionRequests = [];
  plugin.requestJson = async (requestPath, method, payload) => {
    completionRequests.push({ requestPath, method, payload });
    return { data: { status: 'deleted' } };
  };
  await plugin.reportSyncRecordCompletion(
    sourceRecord._id,
    '视频号原始说明',
    { token: 'fixture-binding-token' },
  );
  assert.equal(completionRequests.length, 1);
  assert.deepEqual(completionRequests[0].payload, { noteTitle: '视频号原始说明' });
  assert.equal(Object.prototype.hasOwnProperty.call(completionRequests[0].payload, 'transcription'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(completionRequests[0].payload, 'content'), false);

  let posted = false;
  const reporter = createSyncDiagnosticReporter({
    postEvents: async () => { posted = true; },
    saveOutbox: async () => {},
  });
  const diagnostic = reporter.enqueue({
    outcome: 'succeeded',
    attemptId: 'typed-vad-attempt-20261008',
    syncRecordId: sourceRecord._id,
    transcription: 'private transcript must never be accepted',
    noteBody: note,
  }, { token: 'fixture-binding-token' });
  assert.equal(diagnostic.queued, false);
  assert.equal(diagnostic.reason, 'success-outcome-rejected');
  assert.equal(posted, false);

  const invalidEvidence = {
    ...saved,
    metadata: { ...saved.metadata, noSpeechEvidence: 'vad-no-speech-segments' },
  };
  assert.ok(h.getSyncLifecycleOutcomeError(invalidEvidence));
  const decodeFailure = {
    ...saved,
    metadata: {
      ...saved.metadata,
      noSpeechEvidence: '',
      transcriptionStatus: 'failed',
      conversionStatus: 'failed',
      transcriptionError: 'full_audio_decode_failed',
    },
  };
  assert.ok(h.getSyncLifecycleOutcomeError(decodeFailure));
  const partialRecovery = {
    ...saved,
    metadata: {
      ...saved.metadata,
      noSpeechEvidence: '',
      transcriptionStatus: 'failed',
      conversionStatus: 'partial',
      transcriptionQualityStatus: 'rejected',
      transcriptionError: 'quality_recovery_partial',
    },
  };
  assert.ok(h.getSyncLifecycleOutcomeError(partialRecovery));
  const normalSpeech = {
    ...saved,
    metadata: {
      ...saved.metadata,
      noSpeechEvidence: '',
      transcriptionStatus: 'success',
      conversionStatus: 'success',
      transcription: '真实口播结果',
    },
  };
  assert.equal(h.getSyncLifecycleOutcomeError(normalSpeech), null);

  fs.rmSync(home, { recursive: true, force: true });
  console.log('PASS full VAD no-speech typed writeRecord: note saved, success body rejected from diagnostics, failure semantics retained');
}

run().catch(error => {
  try { fs.rmSync(home, { recursive: true, force: true }); } catch (_) {}
  console.error(error);
  process.exitCode = 1;
});
