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

async function runSavedFeishuAttachmentMustBeLinkedTest() {
  const writes = [];
  const plugin = new PluginClass();
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
    markdown.includes('![[临时收集/网页图片/2026-08-15/飞书图片链接测试-image-01.png]]'),
    'the markdown must reference the saved local attachment even when the URL is HTML-escaped',
  );
  assert.ok(!markdown.includes('example.feishu.cn/space/api/box/stream'), 'the stale remote image link must be removed');
  assert.strictEqual(stats.localizedCount, 1, 'a saved image only counts as localized after markdown was actually replaced');
  assert.strictEqual(stats.failedCount, 0);
}

runSavedFeishuAttachmentMustBeLinkedTest()
  .then(() => console.log('plugin-feishu-media.test.js passed'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
