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
    unresolvedCount: 2,
    errors: ['HTTP 403', 'HTTP 403'],
  });
  assert.strictEqual(diagnostic.mediaScopeKnown, true);
  assert.strictEqual(diagnostic.mediaScopePresent, false);
  assert.strictEqual(diagnostic.official.failed, 2);
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

Promise.resolve()
  .then(() => runFeishuMediaIdentityHelpersTest())
  .then(() => runSavedFeishuAttachmentMustBeLinkedTest())
  .then(() => console.log('plugin-feishu-media.test.js passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
