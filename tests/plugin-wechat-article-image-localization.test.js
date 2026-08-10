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

const articleUrl = 'https://mp.weixin.qq.com/s/local-image-test';
const imageUrl = 'https://mmbiz.qpic.cn/mmbiz_jpg/local-image-test/640?wx_fmt=jpeg';
const articleHtml = [
  '<html><head><title>公众号图片本地化测试</title></head><body>',
  '<div id="js_content">',
  '<p>这是一篇足够长的公众号正文内容，用于验证普通抓取路径会把图片保存到本地附件目录。</p>',
  `<img alt="正文图片" src="${imageUrl}">`,
  '</div></body></html>',
].join('');

function createPlugin() {
  const writes = [];
  const downloads = [];
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
  plugin.downloadArrayBuffer = async (url, headers) => {
    downloads.push({ url, headers });
    return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  };
  return { plugin, writes, downloads };
}

async function hydrate(plugin) {
  requestUrlMock = async ({ url }) => {
    assert.strictEqual(url, articleUrl);
    return { text: articleHtml };
  };
  return plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: articleUrl,
    metadata: { url: articleUrl },
  }, '临时收集', '2026-08-11', '公众号图片本地化测试');
}

async function run() {
  const successCase = createPlugin();
  const localized = await hydrate(successCase.plugin);
  assert.strictEqual(localized.metadata.conversionStatus, 'success');
  assert.strictEqual(successCase.downloads.length, 1);
  assert.strictEqual(successCase.downloads[0].url, imageUrl);
  assert.strictEqual(successCase.downloads[0].headers.Referer, articleUrl);
  assert.ok(successCase.downloads[0].headers['User-Agent']);
  assert.strictEqual(successCase.writes.length, 1);
  assert.ok(successCase.writes[0].filePath.startsWith('临时收集/网页图片/2026-08-11/'));
  assert.ok(localized.metadata.markdown.includes('![[临时收集/网页图片/2026-08-11/'));
  assert.strictEqual(localized.metadata.markdown.includes(imageUrl), false);
  assert.strictEqual(localized.metadata.imageLocalizationFailedCount, 0);

  const failureCase = createPlugin();
  failureCase.plugin.downloadArrayBuffer = async () => { throw new Error('HTTP 403'); };
  const fallback = await hydrate(failureCase.plugin);
  assert.strictEqual(fallback.metadata.conversionStatus, 'success');
  assert.ok(fallback.metadata.markdown.includes(imageUrl));
  assert.strictEqual(fallback.metadata.imageLocalizationFailedCount, 1);
  assert.ok(fallback.metadata.imageLocalizationError.includes('HTTP 403'));
  assert.ok(fallback.metadata.conversionNote.includes('image-localize-failed=1'));

  const genericCase = createPlugin();
  requestUrlMock = async () => ({
    text: articleHtml.replace(articleUrl, 'https://example.com/article'),
  });
  const generic = await genericCase.plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://example.com/article',
    metadata: { url: 'https://example.com/article' },
  }, '临时收集', '2026-08-11', '普通网页测试');
  assert.strictEqual(genericCase.downloads.length, 0);
  assert.ok(generic.metadata.markdown.includes(imageUrl));
  assert.strictEqual('imageLocalizationFailedCount' in generic.metadata, false);

  console.log('plugin-wechat-article-image-localization.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
