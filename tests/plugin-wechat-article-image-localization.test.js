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
  return hydrateWithHtml(plugin, articleHtml);
}

async function hydrateWithHtml(plugin, html) {
  requestUrlMock = async ({ url }) => {
    assert.strictEqual(url, articleUrl);
    return { text: html };
  };
  return plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: articleUrl,
    metadata: { url: articleUrl },
  }, '临时收集', '2026-08-11', '公众号图片本地化测试');
}

function createPngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function createArticleHtml(imageTags) {
  return [
    '<html><head><title>公众号图片本地化测试</title></head><body>',
    '<div id="js_content">',
    '<p>这是一篇足够长的公众号正文内容，用于验证复杂公众号排版图片的筛选和本地保存。</p>',
    imageTags,
    '</div></body></html>',
  ].join('');
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

  const folderFailureCase = createPlugin();
  folderFailureCase.plugin.ensureFolder = async () => {
    throw new Error('无法创建附件目录');
  };
  const folderFallback = await hydrate(folderFailureCase.plugin);
  assert.strictEqual(folderFallback.metadata.conversionStatus, 'success');
  assert.ok(folderFallback.metadata.markdown.includes(imageUrl));
  assert.strictEqual(folderFallback.metadata.imageLocalizationFailedCount, 1);
  assert.ok(folderFallback.metadata.imageLocalizationError.includes('无法创建附件目录'));
  assert.ok(folderFallback.metadata.conversionNote.includes('image-localize-failed=1'));

  const smallSvgUrl = 'https://mmbiz.qpic.cn/mmbiz_svg/decorative-dot/640?wx_fmt=jpeg';
  const smallSvgCase = createPlugin();
  smallSvgCase.plugin.downloadArrayBuffer = async () => Buffer.from(
    '<svg width="7" height="7" xmlns="http://www.w3.org/2000/svg"><circle cx="3" cy="3" r="3"/></svg>',
  );
  const smallSvgResult = await hydrateWithHtml(
    smallSvgCase.plugin,
    createArticleHtml(`<img src="${smallSvgUrl}">`),
  );
  assert.strictEqual(smallSvgCase.writes.length, 0);
  assert.strictEqual(smallSvgResult.metadata.markdown.includes(smallSvgUrl), false);
  assert.strictEqual(smallSvgResult.metadata.markdown.includes('![[临时收集/网页图片/'), false);

  const largeSvgUrl = 'https://mmbiz.qpic.cn/mmbiz_svg/meaningful-diagram/640?wx_fmt=jpeg';
  const largeSvgCase = createPlugin();
  largeSvgCase.plugin.downloadArrayBuffer = async () => Buffer.from(
    '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600"/></svg>',
  );
  const largeSvgResult = await hydrateWithHtml(
    largeSvgCase.plugin,
    createArticleHtml(`<img alt="实验室数据结构图" src="${largeSvgUrl}">`),
  );
  assert.strictEqual(largeSvgCase.writes.length, 1);
  assert.ok(largeSvgCase.writes[0].filePath.endsWith('.svg'));
  assert.strictEqual(largeSvgResult.metadata.markdown.includes(largeSvgUrl), false);

  const repeatedPngUrls = [1, 2, 3].map((index) => `https://mmbiz.qpic.cn/mmbiz_png/repeated-diamond-${index}/640`);
  const repeatedPngCase = createPlugin();
  repeatedPngCase.plugin.downloadArrayBuffer = async () => createPngHeader(141, 141);
  const repeatedPngResult = await hydrateWithHtml(
    repeatedPngCase.plugin,
    createArticleHtml(repeatedPngUrls.map((url) => `<img src="${url}">`).join('')),
  );
  assert.strictEqual(repeatedPngCase.writes.length, 1);
  repeatedPngUrls.forEach((url) => assert.strictEqual(repeatedPngResult.metadata.markdown.includes(url), false));
  assert.strictEqual((repeatedPngResult.metadata.markdown.match(/!\[\[/g) || []).length, 1);

  const qrCodeUrl = 'https://mmbiz.qpic.cn/mmbiz_png/article-qrcode/640?wx_fmt=png';
  const qrCodeCase = createPlugin();
  qrCodeCase.plugin.downloadArrayBuffer = async () => createPngHeader(128, 128);
  const qrCodeResult = await hydrateWithHtml(
    qrCodeCase.plugin,
    createArticleHtml(`<img alt="图片" src="${qrCodeUrl}">`),
  );
  assert.strictEqual(qrCodeCase.writes.length, 1);
  assert.strictEqual(qrCodeResult.metadata.markdown.includes(qrCodeUrl), false);
  assert.strictEqual((qrCodeResult.metadata.markdown.match(/!\[\[/g) || []).length, 1);

  const duplicateContentUrls = [
    'https://mmbiz.qpic.cn/mmbiz_jpg/content-copy-a/640',
    'https://mmbiz.qpic.cn/mmbiz_jpg/content-copy-b/640',
  ];
  const duplicateContentCase = createPlugin();
  duplicateContentCase.plugin.downloadArrayBuffer = async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const duplicateContentResult = await hydrateWithHtml(
    duplicateContentCase.plugin,
    createArticleHtml(duplicateContentUrls.map((url) => `<img alt="正文配图" src="${url}">`).join('')),
  );
  assert.strictEqual(duplicateContentCase.writes.length, 1);
  duplicateContentUrls.forEach((url) => assert.strictEqual(duplicateContentResult.metadata.markdown.includes(url), false));
  assert.strictEqual((duplicateContentResult.metadata.markdown.match(/!\[\[/g) || []).length, 1);

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

  const guideHtml = [
    '<html><head><meta property="og:title" content="引导页可保存标题">',
    '<meta property="og:image" content="https://mmbiz.qpic.cn/guide-cover.jpg"></head>',
    '<body>微信扫一扫可打开此内容 使用小程序</body></html>',
  ].join('');
  const browserRecoveryCase = createPlugin();
  let browserRecoveryCalls = 0;
  browserRecoveryCase.plugin.renderWebpageWithElectron = async () => {
    browserRecoveryCalls += 1;
    return {
      title: '浏览器恢复标题',
      markdown: '这是通过隐藏浏览器获得的足够长的公众号正文，应该作为完整文章保存。\n\n![图片](https://mmbiz.qpic.cn/browser-body.jpg)',
      assets: [{ src: 'https://mmbiz.qpic.cn/browser-body.jpg', alt: '图片' }],
    };
  };
  const browserRecovered = await hydrateWithHtml(browserRecoveryCase.plugin, guideHtml);
  assert.strictEqual(browserRecoveryCalls, 1);
  assert.strictEqual(browserRecovered.metadata.conversionStatus, 'success');
  assert.strictEqual(browserRecovered.metadata.title, '浏览器恢复标题');
  assert.strictEqual(browserRecoveryCase.writes.length, 1);

  const partialGuideCase = createPlugin();
  let partialGuideBrowserCalls = 0;
  partialGuideCase.plugin.renderWebpageWithElectron = async () => {
    partialGuideBrowserCalls += 1;
    return { markdown: '微信扫一扫可打开此内容 使用完整服务', assets: [] };
  };
  const partialGuide = await hydrateWithHtml(partialGuideCase.plugin, guideHtml);
  assert.strictEqual(partialGuideBrowserCalls, 1);
  assert.strictEqual(partialGuide.metadata.conversionStatus, 'partial');
  assert.strictEqual(partialGuide.metadata.conversionState, 'guide');
  assert.ok(partialGuide.metadata.markdown.includes('引导页可保存标题'));
  assert.strictEqual(
    PluginClass.__test.getSyncLifecycleOutcomeError({
      type: 'webpage',
      content: articleUrl,
      metadata: partialGuide.metadata,
    }),
    null,
  );

  console.log('plugin-wechat-article-image-localization.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
