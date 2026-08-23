'use strict';

const assert = require('assert');
const Module = require('module');

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
      requestUrl: async () => ({}),
      MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main.js');

function runFeishuMediaIdentityHelpersTest() {
  const helpers = PluginClass.__test;
  assert.strictEqual(
    helpers.hasFeishuMediaDownloadScope('offline_access docs:document.media:download docx:document:readonly'),
    true,
  );
  assert.strictEqual(helpers.hasFeishuMediaDownloadScope('offline_access docx:document:readonly'), false);
  const collected = helpers.collectFeishuImageTokens({
    markdown: '![一](feishu-image:token-a)\n![二](feishu-image:token-a)\n![三](feishu-image:token-b)',
    imageTokens: ['token-b', 'token-c'],
    imageTmpDownloadUrls: {
      'feishu-image:token-c': 'https://example.test/c.png',
    },
    blocks: [{ block_type: 27, image: { token: 'token-d' } }],
    imageTokenCount: 4,
  });
  assert.deepStrictEqual(collected.tokens, ['token-b', 'token-c', 'token-a', 'token-d']);
  assert.strictEqual(collected.unknownIdentityCount, 0);
  assert.strictEqual(collected.imageTmpDownloadUrls['token-c'], 'https://example.test/c.png');

  const replaced = helpers.replaceFeishuImageAssetReference(
    '正文\n\n![图片](feishu-image:token-a)',
    { token: 'token-a', src: 'feishu-image:token-a' },
    '收集/文章/文章-image-01.png',
  );
  assert.strictEqual(replaced.replacementCount, 1);
  assert.ok(replaced.markdown.includes('![[收集/文章/文章-image-01.png]]'));

  const diagnostic = helpers.buildFeishuMediaDiagnostic({
    scope: 'offline_access',
    tokenCount: 2,
    official: { attempted: true, failed: 2 },
    remoteLinkedCount: 1,
    unresolvedCount: 2,
    missingCount: 1,
    images: [
      { index: 1, finalOutcome: 'remote-link', attempts: [{ stage: 'official', outcome: 'failed', error: 'HTTP 403' }] },
      { index: 2, finalOutcome: 'missing', attempts: [{ stage: 'browser', outcome: 'failed', error: 'no asset' }] },
    ],
    errors: ['HTTP 403', 'HTTP 403'],
  });
  assert.strictEqual(diagnostic.mediaScopeKnown, true);
  assert.strictEqual(diagnostic.mediaScopePresent, false);
  assert.strictEqual(diagnostic.official.failed, 2);
  assert.strictEqual(diagnostic.remoteLinkedCount, 1);
  assert.strictEqual(diagnostic.missingCount, 1);
  assert.deepStrictEqual(diagnostic.images.map((item) => item.finalOutcome), ['remote-link', 'missing']);
  assert.deepStrictEqual(diagnostic.errors, ['HTTP 403']);
}

async function runSavedFeishuAttachmentMustBeLinkedTest() {
  const writes = [];
  const plugin = new PluginClass();
  plugin.settings = {
    socialArticleImageStorageMode: 'local',
    socialArticleImageStorageModeConfigured: true,
  };
  plugin.app = {
    vault: {
      adapter: {
        exists: async () => true,
        writeBinary: async (filePath, buffer) => writes.push({ filePath, buffer }),
      },
    },
  };
  plugin.ensureFolder = async () => {};

  const rawUrl = 'https://example.feishu.cn/space/api/box/stream/download/v2/cover/token-1?width=0&height=0';
  const markdownUrl = rawUrl.replace(/&/g, '&amp;');
  const stats = {};
  const markdown = await plugin.saveWebpageImageAssets(
    `正文\n\n![图片](${markdownUrl})`,
    [{
      src: rawUrl,
      dataUrl: 'data:image/png;base64,iVBORw0KGgoBAgM=',
    }],
    '临时收集',
    '2026-08-15',
    '飞书图片链接测试',
    {
      sourceUrl: 'https://example.feishu.cn/docx/test',
      stats,
    },
  );

  assert.strictEqual(writes.length, 1, 'the image binary should be saved once');
  assert.ok(
    markdown.includes('![[临时收集/2026-08-15/飞书-飞书图片链接测试/文章图片/飞书-飞书图片链接测试-image-01.png]]'),
    'the markdown must reference the saved local attachment even when the URL is HTML-escaped',
  );
  assert.ok(!markdown.includes('example.feishu.cn/space/api/box/stream'), 'the stale remote image link must be removed');
  assert.strictEqual(stats.localizedCount, 1, 'a saved image only counts as localized after markdown was actually replaced');
  assert.strictEqual(stats.failedCount, 0);
}

async function runElectronSessionAbortSignalCompatibilityTest() {
  const helpers = PluginClass.__test;
  const controller = new AbortController();
  let receivedInit = null;
  const expected = Buffer.from([1, 2, 3, 4]);
  const session = {
    fetch: async (_url, init) => {
      receivedInit = init;
      if (Object.prototype.hasOwnProperty.call(init, 'signal')) {
        throw new TypeError("RequestInit: Expected signal to be an instance of AbortSignal");
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => expected,
      };
    },
  };

  const result = await helpers.downloadArrayBufferViaElectronSession(
    'https://example.feishu.cn/image.png',
    {},
    { signal: controller.signal, timeout: 1000 },
    session,
  );
  assert.deepStrictEqual(Buffer.from(result), expected);
  assert.ok(receivedInit, 'Electron session fetch should be attempted');
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(receivedInit, 'signal'),
    false,
    'a Node-realm AbortSignal must not be passed into Electron session.fetch',
  );

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => helpers.downloadArrayBufferViaElectronSession(
      'https://example.feishu.cn/image.png',
      {},
      { signal: aborted.signal, timeout: 1000 },
      session,
    ),
    (error) => error && error.name === 'AbortError',
  );

  const interrupted = new AbortController();
  const interruptedRequest = helpers.downloadArrayBufferViaElectronSession(
    'https://example.feishu.cn/slow-image.png',
    {},
    { signal: interrupted.signal, timeout: 1000 },
    { fetch: async () => new Promise(() => {}) },
  );
  interrupted.abort();
  await assert.rejects(
    () => interruptedRequest,
    (error) => error && error.name === 'AbortError',
  );
}

Promise.resolve()
  .then(() => runFeishuMediaIdentityHelpersTest())
  .then(() => runSavedFeishuAttachmentMustBeLinkedTest())
  .then(() => runElectronSessionAbortSignalCompatibilityTest())
  .then(() => console.log('plugin-feishu-media.test.js passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
