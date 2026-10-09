const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const childProcess = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-no-speech-'));
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
const quality = require('../obsidian-plugin/wechat-inbox-sync/src/transcription-quality-utils');
const noSpeech = () => Object.assign(new Error('未检测到可转写的语音。'), { code: 'TRANSCRIPTION_NO_SPEECH', noSpeechEvidence: 'full-decode-and-vad-no-speech-segments' });
function fixture() {
  const p = new Plugin();
  p.settings = h.mergeSettings({ aiProvider: 'local' });
  p.showSyncProgress = () => {};
  return p;
}
const url = 'https://www.xiaohongshu.com/explore/fixture';
const record = { _id: 'fixture', type: 'webpage', content: url, metadata: { url, transcriptionMode: 'local' } };
const media = {
  url, platform: '视频号', source: 'video',
  mediaUrl: 'https://media.example.com/one.mp4',
  mediaUrls: ['https://media.example.com/two.mp4'],
  markdown: '## 视频说明\n\n保留原始视频说明。', sourceTitle: '测试视频',
};

async function run() {
  for (const text of ['(音樂)\n(音樂)', '[音乐]', '（靜音）', '[silence]\n(MUSIC)', '\n (音乐) \n']) {
    assert.equal(quality.createNoSpeechTranscriptionError(text)?.code, 'TRANSCRIPTION_NO_SPEECH_MARKER');
  }
  for (const text of ['', '   ', '音乐', 'music', '(音乐)\n这里有正常口播', '(音乐', '[笑声]']) {
    assert.equal(quality.createNoSpeechTranscriptionError(text), null);
  }

  assert.equal(quality.isRecognizedNoSpeechMetadata({
    transcriptionStatus: 'no_speech', conversionStatus: 'no_speech',
    transcription: '', noSpeechEvidence: 'non-speech-markers',
  }), false, 'ASR marker alone is not accepted no-speech evidence');
  assert.equal(quality.isRecognizedNoSpeechMetadata({
    transcriptionStatus: 'no_speech', conversionStatus: 'no_speech',
    transcription: '', noSpeechEvidence: 'full-decode-and-vad-no-speech-segments',
  }), true, 'full decode + VAD remains accepted no-speech evidence');

  // An unmanaged command cannot confirm no speech from ASR markers alone.
  const local = fixture();
  local.ensureLocalComponentReadyForUse = async () => {};
  local.recoverStaleLocalTranscriptionCommand = async () => {};
  local.getLocalAsrInstallStatus = () => ({});
  local.getConfiguredLocalAsrInstallRoot = () => home;
  local.getConfiguredLocalAsrPlatform = () => 'win32';
  local.getEffectiveLocalTranscriptionCommand = () => 'fixture {input} {output}';
  local.setTranscriptionStopAvailable = () => {};
  local.downloadMediaToTempFile = async () => {
    const input = path.join(home, 'input.mp4'); fs.writeFileSync(input, 'fixture'); return input;
  };
  const exec = childProcess.exec;
  let raw = '(音樂)\n(音樂)';
  let nativeError = null;
  childProcess.exec = (_command, _options, callback) => {
    setImmediate(() => callback(nativeError, raw, nativeError ? 'native crash' : ''));
    return { kill() {} };
  };
  try {
    await assert.rejects(local.runLocalTranscription(media.mediaUrl), { code: 'TRANSCRIPTION_NO_SPEECH_UNCONFIRMED', noSpeechEvidence: 'non-speech-markers' });
    raw = '';
    await assert.rejects(local.runLocalTranscription(media.mediaUrl), e => e.code !== 'TRANSCRIPTION_NO_SPEECH' && /没有返回文本/.test(e.message));
    raw = '(音樂)\n(音樂)'; nativeError = Object.assign(new Error('native crash'), { code: 1 });
    await assert.rejects(local.runLocalTranscription(media.mediaUrl), e => e.code !== 'TRANSCRIPTION_NO_SPEECH' && /native crash/.test(e.message));
  } finally { childProcess.exec = exec; }

  let cloudCalls = 0;
  const configured = fixture();
  configured.runLocalTranscription = async () => { throw noSpeech(); };
  configured.runCloudFallbackTranscription = async () => { cloudCalls++; return { transcription: '云端结果' }; };
  await assert.rejects(configured.runConfiguredTranscription(media.mediaUrl, { allowCloudUrlFallback: true }), { code: 'TRANSCRIPTION_NO_SPEECH' });
  assert.equal(cloudCalls, 0);
  configured.runLocalTranscription = async () => { throw new Error('native crash'); };
  await configured.runConfiguredTranscription(media.mediaUrl, { allowCloudUrlFallback: true });
  assert.equal(cloudCalls, 1, 'real failures retain existing fallback');
  configured.runLocalTranscription = async () => { throw Object.assign(new Error('empty output'), {
    code: 'TRANSCRIPTION_NO_SPEECH_UNCONFIRMED', noSpeechEvidence: 'empty-output',
    noSpeechVerification: { decision: 'speech_detected' },
  }); };
  const priorFallback = await configured.runConfiguredTranscription(media.mediaUrl, { allowCloudUrlFallback: true });
  assert.ok(priorFallback.transcription);
  assert.equal(cloudCalls, 2, 'unconfirmed empty output retains explicitly allowed existing fallback');
  await assert.rejects(configured.runConfiguredTranscription(media.mediaUrl), { code: 'TRANSCRIPTION_NO_SPEECH_UNCONFIRMED' });
  assert.equal(cloudCalls, 2, 'fallback remains disabled without its existing authorization');

  const p = fixture(); let attempts = 0;
  p.runConfiguredTranscription = async () => { attempts++; throw noSpeech(); };
  const saved = await p.buildTranscriptRecordFromMedia(record, media);
  assert.equal(attempts, 2);
  assert.equal(saved.metadata.transcriptionStatus, 'no_speech');
  assert.equal(saved.metadata.transcription, '');
  assert.equal(h.getSyncLifecycleOutcomeError(saved), null);
  assert.ok(h.getSyncLifecycleOutcomeError({ ...saved, metadata: { ...saved.metadata, noSpeechEvidence: '' } }));
  assert.ok(h.getSyncLifecycleOutcomeError({ ...saved, metadata: { ...saved.metadata, conversionError: 'download failed' } }));
  const body = h.buildWebpageMarkdownBody(saved, '测试视频');
  assert.match(body, /本次未检测到可转写语音，已保存原内容和链接/);
  assert.match(body, /保留原始视频说明/);
  assert.ok(body.includes(url));
  assert.doesNotMatch(body, /转写处理中|转写失败/);

  attempts = 0;
  p.runConfiguredTranscription = async () => {
    if (++attempts === 1) throw noSpeech();
    return { transcription: '备用音轨中有正常口播。', source: 'local' };
  };
  const recovered = await p.buildTranscriptRecordFromMedia(record, media);
  assert.equal(recovered.metadata.transcriptionStatus, 'success');
  assert.equal(recovered.metadata.transcription, '备用音轨中有正常口播。');
  for (const realFirst of [true, false]) {
    attempts = 0;
    p.runConfiguredTranscription = async () => {
      if ((++attempts === 1) === realFirst) throw new Error('download failed');
      throw noSpeech();
    };
    const mixed = await p.buildTranscriptRecordFromMedia(record, media);
    assert.equal(mixed.metadata.transcriptionStatus, 'failed');
    assert.match(mixed.metadata.transcriptionError, /download failed/);
  }
  p.runConfiguredTranscription = async () => { throw new Error('本地转写命令没有返回文本'); };
  const empty = await p.buildTranscriptRecordFromMedia(record, media);
  assert.equal(empty.metadata.transcriptionStatus, 'failed');
  attempts = 0;
  p.runConfiguredTranscription = async () => { throw new Error(`ordinary failure ${++attempts}`); };
  const ordinary = await p.buildTranscriptRecordFromMedia(record, media);
  assert.match(ordinary.metadata.transcriptionError, /ordinary failure 2/, 'ordinary failures retain the prior last-error behavior');
  const subtitle = await p.buildTranscriptRecordFromMedia(record, { ...media, subtitleText: '保留已有字幕' });
  assert.equal(subtitle.metadata.transcription, '保留已有字幕');

  // Full commit path, including the automatic share-text hydration gate.
  const files = new Map();
  p.app = { vault: {
    adapter: { write: async (name, value) => files.set(name, value), exists: async name => files.has(name), remove: async name => files.delete(name) },
    create: async (name, value) => { files.set(name, value); },
  } };
  p.ensureFolder = async () => {};
  p.nextRecordTitle = async () => '测试视频'; p.nextTitle = async () => '测试视频';
  p.hydrateWebpageMarkdown = async () => saved;
  p.saveSourceMediaAttachment = async r => r;
  p.alignSocialArticleImageFolder = async r => ({ record: r, folderName: '测试视频' });
  const committed = await p.writeRecord({ ...record, type: 'text' }, new Date().toISOString(), null, false, { skipAi: true });
  assert.equal(committed.committed, true);
  assert.match(files.get(committed.filePath), /本次未检测到可转写语音，已保存原内容和链接/);
  assert.match(files.get(committed.filePath), /保留原始视频说明/);
  assert.equal(files.size, 1, 'only the committed note remains');
  console.log('plugin no-speech tests passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
