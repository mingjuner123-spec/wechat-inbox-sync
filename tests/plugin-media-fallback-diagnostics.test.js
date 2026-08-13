'use strict';

const assert = require('assert');
const Module = require('module');

let requestUrlMock = async () => ({ text: '' });
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      App: class {},
      Plugin: class {},
      PluginSettingTab: class {},
      Setting: class {},
      Notice: class {},
      TFile: class {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: (...args) => requestUrlMock(...args),
      MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main.js';
const PluginClass = require(pluginMainPath);

function createPlugin() {
  const writes = [];
  const plugin = new PluginClass();
  plugin.app = {
    vault: {
      adapter: {
        async exists() { return true; },
        async writeBinary(filePath, buffer) { writes.push({ filePath, buffer }); },
      },
    },
  };
  plugin.ensureFolder = async () => {};
  return { plugin, writes };
}

async function runFeishuImageSessionFallbackTest() {
  const { plugin, writes } = createPlugin();
  const sessionDownloads = [];
  plugin.downloadArrayBuffer = async () => { throw Object.assign(new Error('HTTP 401'), { status: 401 }); };
  plugin.downloadMediaArrayBufferWithSession = async (url) => {
    sessionDownloads.push(url);
    return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  };
  const stats = {};
  const source = 'https://example.feishu.cn/docx/abc';
  const imageUrl = 'https://example.feishu.cn/space/api/box/stream/download/v2/cover/token-1';
  const markdown = await plugin.saveWebpageImageAssets(
    `![图片](${imageUrl})`,
    [{ src: imageUrl, alt: '图片' }],
    '临时收集',
    '2026-08-12',
    '飞书测试',
    { sourceUrl: source, stats },
  );
  assert.strictEqual(sessionDownloads.length, 1);
  assert.strictEqual(writes.length, 1);
  assert.ok(markdown.includes('![[临时收集/网页图片/2026-08-12/'));
  assert.strictEqual(stats.assetCount, 1);
  assert.strictEqual(stats.localizedCount, 1);
  assert.strictEqual(stats.failedCount, 0);
}

async function runFeishuCloudMissingUrlBrowserFallbackTest() {
  const { plugin, writes } = createPlugin();
  const source = 'https://example.feishu.cn/docx/abc';
  const browserImage = 'https://example.feishu.cn/space/api/box/stream/download/v2/cover/browser-1';
  plugin.getFeishuCloudOAuthStatus = async () => ({ connected: true });
  plugin.fetchFeishuCloudOAuthMarkdownFromUrl = async () => ({
    title: '飞书测试',
    markdown: '正文内容足够长，可以验证图片缺失后的浏览器兜底。\n\n![图片](feishu-image:token-1)',
    imageTmpDownloadUrls: {},
    imageTokenCount: 1,
    blockCount: 3,
  });
  plugin.renderFeishuDocumentWithElectron = async () => ({
    title: '飞书测试',
    markdown: `正文内容足够长，可以验证浏览器兜底。\n\n![图片](${browserImage})`,
    assets: [{ src: browserImage, alt: '图片' }],
  });
  plugin.downloadArrayBuffer = async (url) => {
    if (String(url).includes('/cover/token-1')) throw Object.assign(new Error('HTTP 401'), { status: 401 });
    return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  };
  const result = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: source,
    metadata: { url: source },
  }, '临时收集', '2026-08-12', '飞书测试', null);
  assert.strictEqual(result.metadata.conversionSource, 'feishu-cloud-oauth');
  assert.ok(result.metadata.conversionNote.includes('browser-image-fallback=1/1'));
  assert.strictEqual(writes.length, 1);
  assert.ok(result.metadata.markdown.includes('![[临时收集/网页图片/2026-08-12/'));
}

async function runDouyinTranscriptionIndependentOfSaveToggleTest() {
  const { plugin } = createPlugin();
  plugin.settings = { saveOriginalMediaEnabled: false };
  plugin.runConfiguredTranscription = async () => ({
    transcription: '这是完整的抖音视频文案。',
    source: 'local',
  });
  const result = await plugin.buildTranscriptRecordFromMedia({
    type: 'webpage',
    content: 'https://www.douyin.com/video/123',
    metadata: {},
  }, {
    url: 'https://www.douyin.com/video/123',
    platform: '抖音',
    mediaUrl: 'https://example.com/media.mp4',
    source: 'video',
    title: '抖音测试',
  });
  assert.strictEqual(result.metadata.transcriptionStatus, 'success');
  assert.strictEqual(result.metadata.transcription, '这是完整的抖音视频文案。');
  assert.strictEqual(result.metadata.sourceMediaAttachmentPath || '', '');
}

async function runPublicAccountBrowserFallbackTest() {
  const { plugin, writes } = createPlugin();
  const source = 'https://mp.weixin.qq.com/s/public-article';
  requestUrlMock = async () => { throw Object.assign(new Error('net::ERR_NETWORK_ACCESS_DENIED'), { code: 'ERR_NETWORK_ACCESS_DENIED' }); };
  plugin.downloadWebpageHtmlViaNode = async () => { throw Object.assign(new Error('AggregateError'), { name: 'AggregateError' }); };
  plugin.renderWebpageWithElectron = async () => ({
    title: '公众号测试文章',
    markdown: '这是一段足够长的公众号正文，用于验证请求失败后的浏览器兜底。\n\n![正文图片](https://mmbiz.qpic.cn/test/640)',
    assets: [{ src: 'https://mmbiz.qpic.cn/test/640', alt: '正文图片' }],
  });
  plugin.downloadArrayBuffer = async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const result = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: source,
    metadata: { url: source },
  }, '临时收集', '2026-08-12', '公众号测试', null);
  assert.strictEqual(result.metadata.conversionSource, 'electron-fallback');
  assert.strictEqual(result.metadata.conversionDiagnostic.selectedTransport, 'hidden-browser');
  assert.strictEqual(result.metadata.conversionDiagnostic.attempts.length, 2);
  assert.strictEqual(writes.length, 1);
  assert.ok(result.metadata.markdown.includes('![[临时收集/网页图片/2026-08-12/'));
}

async function runDiagnosticHelperTest() {
  const webpage = PluginClass.__test.buildWebpageTransportDiagnostic({
    sourceUrl: 'https://mp.weixin.qq.com/s/example?token=secret',
    requestError: Object.assign(new Error('network denied'), { code: 'ERR_NETWORK_ACCESS_DENIED' }),
    nodeError: Object.assign(new Error('AggregateError'), { name: 'AggregateError' }),
  });
  assert.strictEqual(webpage.source.host, 'mp.weixin.qq.com');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(webpage.source, 'query'), false);
  assert.strictEqual(webpage.attempts.length, 2);

  const douyin = PluginClass.__test.buildDouyinMediaResolutionDiagnostic({
    sourceUrl: 'https://v.douyin.com/abc',
    resolvedUrl: 'https://www.douyin.com/video/123',
    awemeId: '123',
    stages: [{ stage: 'detail-api', ok: false, error: new Error('HTTP 403') }],
    mediaCandidateCount: 0,
    saveOriginalMediaEnabled: false,
  });
  assert.strictEqual(douyin.source.host, 'v.douyin.com');
  assert.strictEqual(douyin.resolved.host, 'douyin.com');
  assert.strictEqual(douyin.stages[0].error.message, 'HTTP 403');
}

async function run() {
  await runFeishuImageSessionFallbackTest();
  await runFeishuCloudMissingUrlBrowserFallbackTest();
  await runDouyinTranscriptionIndependentOfSaveToggleTest();
  await runPublicAccountBrowserFallbackTest();
  await runDiagnosticHelperTest();
  console.log('plugin-media-fallback-diagnostics.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
