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

const articleUrl = 'https://mp.weixin.qq.com/s?__biz=local-image-test&mid=1&idx=1&sn=test';
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
  plugin.settings = { socialArticleImageStorageMode: 'local' };
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
  requestUrlMock = async (options) => {
    assert.strictEqual(options.url, articleUrl);
    plugin._lastWechatStaticRequestOptions = options;
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
  successCase.plugin.settings = { socialArticleImageStorageMode: 'local' };
  const localized = await hydrate(successCase.plugin);
  assert.strictEqual(localized.metadata.conversionStatus, 'success');
  assert.ok(successCase.plugin._lastWechatStaticRequestOptions.headers['User-Agent']);
  assert.ok(successCase.plugin._lastWechatStaticRequestOptions.headers.Accept.includes('text/html'));
  assert.ok(successCase.plugin._lastWechatStaticRequestOptions.headers['Accept-Language'].startsWith('zh-CN'));
  assert.strictEqual(successCase.downloads.length, 1);
  assert.strictEqual(successCase.downloads[0].url, imageUrl);
  assert.strictEqual(successCase.downloads[0].headers.Referer, articleUrl);
  assert.ok(successCase.downloads[0].headers['User-Agent']);
  assert.strictEqual(successCase.writes.length, 1);
  assert.ok(successCase.writes[0].filePath.startsWith('临时收集/2026-08-11/公众号-公众号图片本地化测试/文章图片/'));
  assert.ok(localized.metadata.markdown.includes('![[临时收集/2026-08-11/公众号-公众号图片本地化测试/文章图片/'));
  assert.strictEqual(localized.metadata.markdown.includes(imageUrl), false);
  assert.strictEqual(localized.metadata.imageLocalizationFailedCount, 0);

  const defaultRemoteCase = createPlugin();
  defaultRemoteCase.plugin.settings = {};
  const defaultRemote = await hydrate(defaultRemoteCase.plugin);
  assert.strictEqual(defaultRemoteCase.downloads.length, 0);
  assert.strictEqual(defaultRemoteCase.writes.length, 0);
  assert.ok(defaultRemote.metadata.markdown.includes(imageUrl));

  const xiaohongshuCase = createPlugin();
  xiaohongshuCase.plugin.settings = { socialArticleImageStorageMode: 'local' };
  const xiaohongshuImageUrl = 'https://sns-webpic-qc.xhscdn.com/xiaohongshu-local-image-test.jpg';
  const xiaohongshuMarkdown = await xiaohongshuCase.plugin.saveMarkdownRemoteImageAssets(
    `![配图](${xiaohongshuImageUrl})`,
    '临时收集',
    '2026-08-11',
    '小红书图片本地化测试',
    { sourceUrl: 'https://www.xiaohongshu.com/explore/local-image-test' },
  );
  assert.strictEqual(xiaohongshuCase.writes.length, 1);
  assert.ok(xiaohongshuCase.writes[0].filePath.startsWith('临时收集/2026-08-11/小红书-小红书图片本地化测试/文章图片/'));
  assert.ok(xiaohongshuMarkdown.includes('![[临时收集/2026-08-11/小红书-小红书图片本地化测试/文章图片/'));

  const feishuCase = createPlugin();
  feishuCase.plugin.settings = { socialArticleImageStorageMode: 'local' };
  const feishuImageUrl = 'https://s1-imfile.feishucdn.com/feishu-local-image-test.jpg';
  const feishuMarkdown = await feishuCase.plugin.saveWebpageImageAssets(
    `![配图](${feishuImageUrl})`,
    [{ src: feishuImageUrl }],
    '临时收集',
    '2026-08-11',
    '飞书图片本地化测试',
    { sourceUrl: 'https://example.feishu.cn/docx/local-image-test' },
  );
  assert.strictEqual(feishuCase.writes.length, 1);
  assert.ok(feishuCase.writes[0].filePath.startsWith('临时收集/2026-08-11/飞书-飞书图片本地化测试/文章图片/'));
  assert.ok(feishuMarkdown.includes('![[临时收集/2026-08-11/飞书-飞书图片本地化测试/文章图片/'));
  const remoteOnlyCase = createPlugin();
  remoteOnlyCase.plugin.settings = { socialArticleImageStorageMode: 'remote' };
  const remoteOnly = await hydrate(remoteOnlyCase.plugin);
  assert.strictEqual(remoteOnly.metadata.conversionStatus, 'success');
  assert.strictEqual(remoteOnlyCase.downloads.length, 0);
  assert.strictEqual(remoteOnlyCase.writes.length, 0);
  assert.ok(remoteOnly.metadata.markdown.includes(imageUrl));
  assert.strictEqual(remoteOnly.metadata.imageLocalizationFailedCount, 0);

  const xiaohongshuRemoteCase = createPlugin();
  xiaohongshuRemoteCase.plugin.settings = { socialArticleImageStorageMode: 'remote' };
  const xiaohongshuRemote = await xiaohongshuRemoteCase.plugin.saveMarkdownRemoteImageAssets(
    `![image](${xiaohongshuImageUrl})`,
    '临时收集',
    '2026-08-11',
    '小红书远程图片测试',
    { sourceUrl: 'https://www.xiaohongshu.com/explore/local-image-test' },
  );
  assert.strictEqual(xiaohongshuRemoteCase.downloads.length, 0);
  assert.strictEqual(xiaohongshuRemoteCase.writes.length, 0);
  assert.ok(xiaohongshuRemote.includes(xiaohongshuImageUrl));

  const feishuRemoteCase = createPlugin();
  feishuRemoteCase.plugin.settings = { socialArticleImageStorageMode: 'remote' };
  const feishuRemote = await feishuRemoteCase.plugin.saveWebpageImageAssets(
    `![image](${feishuImageUrl})`,
    [{ src: feishuImageUrl }],
    '临时收集',
    '2026-08-11',
    '飞书远程图片测试',
    { sourceUrl: 'https://example.feishu.cn/docx/local-image-test' },
  );
  assert.strictEqual(feishuRemoteCase.downloads.length, 0);
  assert.strictEqual(feishuRemoteCase.writes.length, 0);
  assert.ok(feishuRemote.includes(feishuImageUrl));
  const alignedFolderCase = createPlugin();
  const imageDirectory = '\u6587\u7ae0\u56fe\u7247';
  const sourceFolder = '临时收集/2026-08-11/公众号-临时标题';
  const targetFolder = '临时收集/2026-08-11/公众号-最终标题';
  const renamedFolders = [];
  alignedFolderCase.plugin.settings = { socialArticleImageStorageMode: 'local' };
  alignedFolderCase.plugin.app.vault.adapter = {
    async exists(path) { return path === `${sourceFolder}/${imageDirectory}`; },
    async rename(from, to) { renamedFolders.push({ from, to }); },
  };
  const alignedRecord = await alignedFolderCase.plugin.alignSocialArticleImageFolder({
    metadata: {
      markdown: `![[${sourceFolder}/${imageDirectory}/cover.jpg]]`,
      snapshot: `![[${sourceFolder}/${imageDirectory}/body.jpg]]`,
    },
  }, {
    sourceUrl: articleUrl,
    noteDir: '临时收集/2026-08-11',
    assetFolderTitle: '公众号-临时标题',
    fileTitle: '公众号-最终标题',
  });
  assert.strictEqual(alignedRecord.folderName, '公众号-最终标题');
  assert.deepStrictEqual(renamedFolders, []);
  assert.ok(alignedRecord.record.metadata.markdown.includes(`${sourceFolder}/${imageDirectory}/cover.jpg`));
  assert.ok(alignedRecord.record.metadata.snapshot.includes(`${sourceFolder}/${imageDirectory}/body.jpg`));

  // Some converters add localized image references only while final Markdown is
  // rendered. The existing per-note image directory must still be moved.
  const lateMetadataCase = createPlugin();
  const lateMetadataRenames = [];
  lateMetadataCase.plugin.settings = { socialArticleImageStorageMode: 'local' };
  lateMetadataCase.plugin.app.vault.adapter = {
    async exists(path) { return path === `${sourceFolder}/${imageDirectory}`; },
    async rename(from, to) { lateMetadataRenames.push({ from, to }); },
  };
  const lateMetadataAligned = await lateMetadataCase.plugin.alignSocialArticleImageFolder({
    metadata: { title: 'final-title-only' },
  }, {
    sourceUrl: articleUrl,
    noteDir: '临时收集/2026-08-11',
    assetFolderTitle: '公众号-临时标题',
    fileTitle: '公众号-最终标题',
  });
  assert.strictEqual(lateMetadataAligned.folderName, '公众号-最终标题');
  assert.deepStrictEqual(lateMetadataRenames, []);
  assert.strictEqual(lateMetadataAligned.sourceImagePath, undefined);
  assert.strictEqual(lateMetadataAligned.targetImagePath, undefined);

  // The downloader can discover the final title before the note writer does.
  // In that order images already live in the final folder while the pre-hydration
  // share-id folder does not exist; the Markdown must still join the final folder.
  const finalFolderAlreadyExistsCase = createPlugin();
  const finalFolderRenames = [];
  const finalFeishuFolder = '临时收集/2026-08-11/飞书图片本地化测试';
  finalFolderAlreadyExistsCase.plugin.settings = { socialArticleImageStorageMode: 'local' };
  finalFolderAlreadyExistsCase.plugin.app.vault.adapter = {
    async exists(path) { return path === finalFeishuFolder; },
    async rename(from, to) { finalFolderRenames.push({ from, to }); },
  };
  const finalFolderAligned = await finalFolderAlreadyExistsCase.plugin.alignSocialArticleImageFolder({
    metadata: { title: 'final-title-only' },
  }, {
    sourceUrl: 'https://example.feishu.cn/docx/local-image-test',
    noteDir: '临时收集/2026-08-11',
    assetFolderTitle: '飞书-LPYgwpZiWiJ8bPkAwX9cE56Enuh',
    fileTitle: '飞书图片本地化测试',
  });
  assert.strictEqual(finalFolderAligned.folderName, '飞书图片本地化测试');
  assert.deepStrictEqual(finalFolderRenames, []);

  const writeRecordCase = createPlugin();
  const createdNotes = [];
  const writeRecordRenames = [];
  const writeRecordFolders = [];
  const writeRecordSourceFolder = '临时收集/2026-08-11/公众号-最终标题';
  writeRecordCase.plugin.settings = {
    inboxDir: '临时收集',
    noteSaveMode: 'date',
    notePropertyFields: [],
    socialArticleImageStorageMode: 'local',
  };
  writeRecordCase.plugin.showSyncProgress = () => {};
  writeRecordCase.plugin.ensureFolder = async (path) => { writeRecordFolders.push(path); };
  let titleCall = 0;
  writeRecordCase.plugin.nextRecordTitle = async () => (
    titleCall++ === 0 ? '公众号-临时标题' : '公众号-最终标题'
  );
  writeRecordCase.plugin.hydrateWebpageMarkdown = async (record) => ({
    ...record,
    metadata: {
      ...record.metadata,
      title: '公众号-最终标题',
      markdown: `![[${writeRecordSourceFolder}/${imageDirectory}/cover.jpg]]`,
    },
  });
  writeRecordCase.plugin.saveSourceMediaAttachment = async (record) => record;
  writeRecordCase.plugin.enrichRecordMetadataWithAi = async (record) => record;
  writeRecordCase.plugin.app.vault.adapter = {
    async exists(path) { return path === `${writeRecordSourceFolder}/${imageDirectory}`; },
    async rename(from, to) { writeRecordRenames.push({ from, to }); },
    async write() {},
    async remove() {},
  };
  writeRecordCase.plugin.app.vault.create = async (path, markdown) => { createdNotes.push({ path, markdown }); };
  const writeRecordResult = await writeRecordCase.plugin.writeRecord({
    id: 'same-folder-note-test',
    type: 'webpage',
    content: articleUrl,
    createdAt: '2026-08-11T10:00:00.000Z',
    metadata: { url: articleUrl },
  }, '2026-08-11T10:01:00.000Z');
  const writeRecordTargetFolder = '临时收集/2026-08-11/公众号-最终标题';
  assert.strictEqual(writeRecordResult.filePath, `${writeRecordTargetFolder}/公众号-最终标题.md`);
  assert.deepStrictEqual(writeRecordRenames, []);
  assert.ok(writeRecordFolders.includes(writeRecordTargetFolder));
  assert.strictEqual(createdNotes.length, 1);
  assert.strictEqual(createdNotes[0].path, `${writeRecordTargetFolder}/公众号-最终标题.md`);
  assert.ok(createdNotes[0].markdown.includes(`${writeRecordTargetFolder}/${imageDirectory}/cover.jpg`));
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
  assert.strictEqual(smallSvgResult.metadata.markdown.includes('![[临时收集/2026-08-11/公众号图片本地化测试/文章图片/'), false);

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
  const nodeRecoveryCase = createPlugin();
  let nodeRecoveryCalls = 0;
  nodeRecoveryCase.plugin.downloadWebpageHtmlViaNode = async () => {
    nodeRecoveryCalls += 1;
    return articleHtml;
  };
  const nodeRecovered = await hydrateWithHtml(nodeRecoveryCase.plugin, guideHtml);
  assert.strictEqual(nodeRecoveryCalls, 1);
  assert.strictEqual(nodeRecovered.metadata.conversionStatus, 'success');
  assert.strictEqual(nodeRecovered.metadata.conversionDiagnostic.source, 'wechat-article');
  assert.strictEqual(nodeRecovered.metadata.conversionDiagnostic.finalState, 'complete');
  assert.ok(nodeRecovered.metadata.conversionDiagnostic.stages.some((stage) => stage.stage === 'node-fallback'));
  assert.ok(nodeRecovered.metadata.markdown.includes('普通抓取路径会把图片保存到本地附件目录'));

  const sessionRecoveryCase = createPlugin();
  let sessionRecoveryCalls = 0;
  let sessionBrowserCalls = 0;
  sessionRecoveryCase.plugin.downloadWebpageHtmlViaNode = async () => guideHtml;
  sessionRecoveryCase.plugin.downloadWechatArticleHtmlViaSession = async () => {
    sessionRecoveryCalls += 1;
    return articleHtml;
  };
  sessionRecoveryCase.plugin.renderWechatArticleWithElectron = async () => {
    sessionBrowserCalls += 1;
    throw new Error('browser fallback should not run after session recovery');
  };
  const sessionRecovered = await hydrateWithHtml(sessionRecoveryCase.plugin, guideHtml);
  assert.strictEqual(sessionRecoveryCalls, 1);
  assert.strictEqual(sessionBrowserCalls, 0);
  assert.strictEqual(sessionRecovered.metadata.conversionStatus, 'success');
  assert.ok(sessionRecovered.metadata.conversionNote.includes('公众号本地会话备用通道'));

  const browserRecoveryCase = createPlugin();
  let browserRecoveryCalls = 0;
  browserRecoveryCase.plugin.renderWechatArticleWithElectron = async () => {
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
  partialGuideCase.plugin.renderWechatArticleWithElectron = async () => {
    partialGuideBrowserCalls += 1;
    return { markdown: '微信扫一扫可打开此内容 使用完整服务', assets: [] };
  };
  const partialGuide = await hydrateWithHtml(partialGuideCase.plugin, guideHtml);
  assert.strictEqual(partialGuideBrowserCalls, 1);
  assert.strictEqual(partialGuide.metadata.conversionStatus, 'success');
  assert.strictEqual(partialGuide.metadata.conversionDiagnostic.bestEffort, true);
  assert.ok(partialGuide.metadata.conversionDiagnostic.stages.some((stage) => stage.stage === 'hidden-browser'));
  assert.ok(String(partialGuide.metadata.markdown || '').trim().length > 0);
  assert.strictEqual(partialGuideCase.writes.length, 0);
  assert.strictEqual(partialGuide.metadata.markdown.includes('https://mmbiz.qpic.cn/guide-cover.jpg'), false);
  assert.strictEqual(
    PluginClass.__test.getSyncLifecycleOutcomeError({
      type: 'webpage',
      content: articleUrl,
      metadata: partialGuide.metadata,
    }),
    null,
  );

  const unavailableBrowserCase = createPlugin();
  unavailableBrowserCase.plugin.renderWechatArticleWithElectron = async () => ({
    markdown: '\u5185\u5bb9\u4e0d\u5b58\u5728\uff0c\u8be5\u6587\u7ae0\u5df2\u88ab\u5220\u9664\u3002This explanatory error page is intentionally long enough to fail the article-content guard.',
    assets: [],
  });
  const unavailableBrowserResult = await hydrateWithHtml(unavailableBrowserCase.plugin, guideHtml);
  assert.strictEqual(unavailableBrowserResult.metadata.conversionStatus, 'partial');
  assert.strictEqual(unavailableBrowserResult.metadata.conversionState, 'unavailable');

  console.log('plugin-wechat-article-image-localization.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
