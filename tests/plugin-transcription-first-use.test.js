'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const notices = [];
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return {
    Modal: class {}, Notice: class { constructor(message) { notices.push(message); } },
    Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
    requestUrl: async () => { throw Error('Unexpected network'); },
  };
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require(path.join(__dirname, '../obsidian-plugin/wechat-inbox-sync/main.js'));
Module._load = originalLoad;
function fixture({ access = 'active', ready = false, provider = 'off', platform = 'win32', accept = true } = {}) {
  const plugin = new Plugin();
  plugin.settings = Plugin.__test.mergeSettings({ aiProvider: provider });
  plugin.saveData = async () => {};
  const calls = { prompt: 0, install: 0, transcribe: 0, cloud: 0 };
  plugin.getProFeatureAccessStatus = async () => ({ hasAccess: access === 'active', status: access,
    expiresAt: new Date(Date.now() + (access === 'expired' ? -1 : 1) * 86400000).toISOString() });
  plugin.getConfiguredLocalAsrPlatform = () => platform;
  plugin.canRunLocalTranscription = () => ready;
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready, platformName: platform, missingComponents: ready ? [] : ['音视频转写'],
    asrStatus: { ready }, ocrStatus: { ready: true }, resolverStatus: { ready: true },
  });
  plugin.confirmLocalComponentInstall = async () => { calls.prompt++; return accept; };
  plugin.installLocalTranscriptionComponents = async () => { calls.install++; ready = true; };
  // Exercise the real permission/component gate without downloading or spawning ASR.
  plugin.runLocalTranscription = async () => {
    try {
      await plugin.ensureLocalComponentReadyForUse('音视频转写', { requireAsr: true, reason: 'first-use' });
    } catch (error) { error.transcriptionSetupRequired = true; throw error; }
    calls.transcribe++;
    return '正常文案';
  };
  plugin.runCloudFallbackTranscription = async () => { calls.cloud++; throw Error('Unexpected cloud fallback'); };
  return { plugin, calls };
}
async function main() {
  for (const platform of ['win32', 'darwin']) {
    const { plugin, calls } = fixture({ platform });
    const result = await plugin.runConfiguredTranscription('https://example.test/video.mp4');
    assert.equal(result.transcription, '正常文案');
    assert.deepEqual(calls, { prompt: 1, install: 1, transcribe: 1, cloud: 0 });
  }
  for (const access of ['inactive', 'missing_redeem_code', 'expired', 'unbound']) {
    for (const provider of ['off', 'local']) {
      const { plugin, calls } = fixture({ access, provider });
      plugin.runLocalTranscription = Plugin.prototype.runLocalTranscription;
      await assert.rejects(plugin.runConfiguredTranscription('https://example.test/audio.mp3', { allowCloudUrlFallback: true }), error => {
        assert.match(error.message, /领取.*开通/);
        assert.match(error.message, /安装／更新本地组件/);
        if (access === 'expired') assert.match(error.message, /过期/);
        if (access === 'unbound') assert.match(error.message, /绑定/);
        assert.equal(error.code, 'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED');
        return true;
      });
      assert.deepEqual(calls, { prompt: 0, install: 0, transcribe: 0, cloud: 0 });
    }
  }
  const healthy = fixture({ ready: true });
  await healthy.plugin.runConfiguredTranscription('https://example.test/video.mp4');
  assert.deepEqual(healthy.calls, { prompt: 0, install: 0, transcribe: 1, cloud: 0 });
  const declined = fixture({ accept: false });
  await assert.rejects(declined.plugin.runConfiguredTranscription('https://example.test/video.mp4'), /需要先安装/);
  await assert.rejects(declined.plugin.runConfiguredTranscription('https://example.test/video.mp4'), /稍后再试/);
  assert.deepEqual(declined.calls, { prompt: 1, install: 0, transcribe: 0, cloud: 0 });
  const unavailable = fixture();
  unavailable.plugin.getProFeatureAccessStatus = async () => { throw Error('权限服务网络异常'); };
  const noticeCount = notices.length;
  await assert.rejects(unavailable.plugin.runConfiguredTranscription('https://example.test/video.mp4'), /权限服务网络异常/);
  assert.equal(notices.length, noticeCount, 'query failure must not become a membership upsell');
  assert.deepEqual(unavailable.calls, { prompt: 0, install: 0, transcribe: 0, cloud: 0 });
  const legacy = fixture({ provider: 'aliyun' });
  legacy.plugin.runAliyunTranscription = async () => '已有服务文案';
  assert.equal((await legacy.plugin.runConfiguredTranscription('https://example.test/audio.mp3')).transcription, '已有服务文案');
  assert.deepEqual(legacy.calls, { prompt: 0, install: 0, transcribe: 0, cloud: 0 });
  for (const access of ['active', 'inactive']) {
    const { plugin, calls } = fixture({ access });
    plugin.app = { vault: { adapter: { writeBinary: async () => {} } } };
    plugin.ensureFolder = async () => {};
    plugin.requestFileDownloadUrl = async () => 'https://example.test/audio.mp3';
    plugin.downloadArrayBuffer = async () => Buffer.from('audio');
    plugin.showSyncProgress = () => {};
    const record = { id: 'voice-fixture', type: 'voice', metadata: { audioFileID: 'fixture-audio', audioFileName: 'voice.mp3' } };
    const result = await plugin.writeVoiceAttachment(record, 'inbox', '2026-10-14', 'voice');
    assert.equal(result.metadata.transcriptionStatus, access === 'active' ? 'success' : 'failed');
    if (access === 'inactive') assert.match(result.metadata.transcriptionError, /领取.*开通/);
    assert.equal(calls.transcribe, access === 'active' ? 1 : 0);
    const count = { ...calls };
    const completed = await plugin.writeVoiceAttachment({ ...record, metadata: { ...record.metadata,
      transcription: '已有文案', transcriptionStatus: 'success' } }, 'inbox', '2026-10-14', 'voice');
    assert.equal(completed.metadata.transcription, '已有文案');
    assert.deepEqual(calls, count, 'existing transcript must not prompt or transcribe again');
  }
  const media = fixture({ access: 'inactive' });
  media.plugin.runLocalTranscription = Plugin.prototype.runLocalTranscription;
  media.plugin.showSyncProgress = () => {};
  const beforeMediaNotices = notices.length;
  const failedMedia = await media.plugin.buildTranscriptRecordFromMedia({ id: 'media-fixture', metadata: {} }, {
    url: 'https://www.douyin.com/video/123', platform: '抖音',
    mediaUrls: ['https://example.test/a.mp4', 'https://example.test/b.mp4'],
  });
  assert.match(failedMedia.metadata.transcriptionError, /领取.*开通/);
  assert.equal(notices.length - beforeMediaNotices, 1, 'alternate media must not repeat a setup prompt');
  const subtitleNotices = notices.length;
  const subtitled = await media.plugin.buildTranscriptRecordFromMedia({ id: 'subtitle-fixture', metadata: {} }, {
    url: 'https://example.test/video', platform: '视频号', subtitleText: '已有字幕',
  });
  assert.equal(subtitled.metadata.transcription, '已有字幕');
  assert.equal(notices.length, subtitleNotices, 'subtitles do not need ASR installation');
  assert.ok(notices.some(message => /领取.*开通/.test(message)));
  console.log('transcription first-use tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
