const assert = require('assert');
const Module = require('module');

let requestUrlMock = async () => ({});
const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal: class Modal {},
      Notice: class Notice {},
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: (...args) => requestUrlMock(...args),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;
const helpers = PluginClass.__test;

async function run() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    saveOriginalMediaEnabled: true,
  });
  const binding = { token: 'PRO-WECHAT-CHANNELS' };
  const apiCalls = [];
  plugin.fetchWechatChannelsFeedInfo = async () => {
    throw new Error('direct feed token unavailable');
  };
  plugin.requestJson = async (requestPath, method, body, requestBinding, options) => {
    apiCalls.push({ requestPath, method, body, requestBinding, options });
    return {
      success: true,
      data: {
        mediaUrl: 'https://finder.video.qq.com/media/short-lived-token',
        source: 'wechat-channels-feed',
        author: 'Original Author',
        description: 'Original post body. #Obsidian #Knowledge',
        tags: ['#Obsidian', '#Knowledge'],
        coverUrl: 'https://finder.video.qq.com/source-cover.jpg',
        title: '服务端解析的视频号标题',
        expiresAt: '2026-09-02T12:00:00.000Z',
      },
    };
  };
  const transcriptionCalls = [];
  plugin.runConfiguredTranscription = async (mediaUrl, options = {}) => {
    transcriptionCalls.push({ mediaUrl, options });
    return {
      transcription: '这是通过云端解析媒体地址后在本地完成的视频号转写。',
      source: 'local',
    };
  };

  const sourceRecord = {
    _id: 'wechat-channels-record-1',
    type: 'webpage',
    content: 'https://weixin.qq.com/sph/A7ULN6a876',
    metadata: {
      url: 'https://weixin.qq.com/sph/A7ULN6a876',
      title: 'Generic shared title',
      webpageMediaType: 'audio_video',
      transcriptionMode: 'local',
      transcriptionStatus: 'pending',
    },
  };
  const hydrated = await plugin.hydrateWebpageMarkdown(
    sourceRecord,
    '临时收集',
    '2026-09-02',
    '视频号测试',
    binding,
  );

  assert.strictEqual(apiCalls.length, 1);
  assert.strictEqual(apiCalls[0].requestPath, '/media/prepare');
  assert.strictEqual(apiCalls[0].method, 'POST');
  assert.strictEqual(apiCalls[0].body.url, sourceRecord.metadata.url);
  assert.strictEqual(apiCalls[0].body.recordId, sourceRecord._id);
  assert.strictEqual(apiCalls[0].body.source, 'wechat-channels-local-transcription');
  assert.strictEqual(apiCalls[0].requestBinding, binding);
  assert.strictEqual(apiCalls[0].options.noCache, true);
  assert.strictEqual(transcriptionCalls.length, 1);
  assert.strictEqual(transcriptionCalls[0].mediaUrl, 'https://finder.video.qq.com/media/short-lived-token');
  assert.strictEqual(transcriptionCalls[0].options.binding, binding);
  assert.strictEqual(hydrated.metadata.transcriptionStatus, 'success');
  assert.strictEqual(hydrated.metadata.transcriptionSource, 'local');
  assert.strictEqual(hydrated.metadata.transcription, '这是通过云端解析媒体地址后在本地完成的视频号转写。');
  assert.strictEqual(hydrated.metadata.mediaUrl, 'https://finder.video.qq.com/media/short-lived-token');
  assert.notStrictEqual(hydrated.metadata.title, sourceRecord.metadata.title);
  assert.strictEqual(hydrated.metadata.sourceTitle, hydrated.metadata.title);
  assert.strictEqual(hydrated.metadata.author, 'Original Author');
  assert.strictEqual(hydrated.metadata.description, 'Original post body. #Obsidian #Knowledge');
  assert.deepStrictEqual(hydrated.metadata.keywords, ['#Obsidian', '#Knowledge']);
  assert.strictEqual(hydrated.metadata.coverUrl, 'https://finder.video.qq.com/source-cover.jpg');
  assert.strictEqual(hydrated.metadata.aiMetadataSource, 'wechat-channels-feed');
  assert.strictEqual(hydrated.metadata.sourceMetadataComplete, true);
  assert.ok(hydrated.metadata.markdown.includes('## 视频封面'));
  assert.ok(hydrated.metadata.markdown.includes('![视频封面](https://finder.video.qq.com/source-cover.jpg)'));
  assert.ok(hydrated.metadata.markdown.includes('## 发布正文'));
  assert.ok(hydrated.metadata.markdown.includes('Original post body. #Obsidian #Knowledge'));
  assert.ok(hydrated.metadata.markdown.includes('## 标签'));
  assert.ok(hydrated.metadata.markdown.includes('#Obsidian #Knowledge'));
  const metadataPreserved = await plugin.enrichRecordMetadataWithAi(hydrated, binding);
  assert.strictEqual(metadataPreserved, hydrated);
  assert.strictEqual(hydrated.metadata.title, '服务端解析的视频号标题');

  const writtenBinaries = [];
  plugin.ensureProFeatureAccess = async () => ({ hasAccess: true });
  plugin.app = {
    vault: {
      adapter: {
        writeBinary: async (filePath, buffer) => {
          writtenBinaries.push([filePath, Buffer.from(buffer)]);
        },
      },
      createFolder: async () => {},
    },
  };
  plugin.ensureFolder = async () => {};
  const videoBuffer = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.from('vide'),
    Buffer.alloc(1024, 1),
  ]);
  plugin.downloadArrayBuffer = async (mediaUrl) => {
    assert.strictEqual(mediaUrl, 'https://finder.video.qq.com/media/short-lived-token');
    return videoBuffer;
  };
  const withAttachment = await plugin.saveSourceMediaAttachment(
    hydrated,
    '临时收集',
    '2026-09-02',
    '视频号测试',
  );

  assert.strictEqual(writtenBinaries.length, 1);
  assert.strictEqual(
    writtenBinaries[0][0],
    '临时收集/音视频附件/2026-09-02/视频号测试-wechat-chann.mp4',
  );
  assert.deepStrictEqual(writtenBinaries[0][1], videoBuffer);
  assert.strictEqual(
    withAttachment.metadata.sourceMediaAttachmentPath,
    '临时收集/音视频附件/2026-09-02/视频号测试-wechat-chann.mp4',
  );
}

run()
  .then(() => console.log('plugin-wechat-channels-media-prepare.test.js passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
