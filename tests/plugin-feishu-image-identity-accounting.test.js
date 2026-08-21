const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal: class Modal {},
      Notice: class Notice {},
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: async () => { throw new Error('unexpected requestUrl call'); },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;

function createVault(options = {}) {
  const files = {};
  return {
    files,
    app: {
      vault: {
        adapter: {
          exists: async () => false,
          writeBinary: async (filePath, buffer) => {
            if (options.writeError) throw options.writeError;
            files[filePath] = Buffer.from(buffer);
          },
        },
        createFolder: async () => {},
      },
    },
  };
}

function buildImageBlocks(tokens) {
  return [
    { block_id: 'heading', block_type: 3, heading1: { elements: [{ text_run: { content: '官方正文标题' } }] } },
    { block_id: 'paragraph', block_type: 2, text: { elements: [{ text_run: { content: '这段官方 API 正文不能被浏览器图片兜底覆盖。' } }] } },
    ...tokens.map((token, index) => ({ block_id: `image-${index + 1}`, block_type: 27, image: { token } })),
  ];
}

function buildEnglishImageBlocks(tokens) {
  return [
    { block_id: 'heading', block_type: 3, heading1: { elements: [{ text_run: { content: 'Official document title' } }] } },
    { block_id: 'paragraph', block_type: 2, text: { elements: [{ text_run: { content: 'Official API body must remain canonical.' } }] } },
    ...tokens.map((token, index) => ({ block_id: `image-${index + 1}`, block_type: 27, image: { token } })),
  ];
}

async function runUniqueFailureAccountingTest() {
  const tokens = Array.from({ length: 6 }, (_, index) => `boxcnImage${index + 1}`);
  const plugin = new PluginClass();
  const vault = createVault();
  plugin.app = vault.app;
  plugin.settings = PluginClass.__test.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'TEST-BINDING',
    socialArticleImageStorageMode: 'local',
    socialArticleImageStorageModeConfigured: true,
    bindings: [{ token: 'TEST-BINDING', label: '微信 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: { connected: true, scope: 'offline_access docx:document:readonly docs:document.media:download' },
  });
  plugin.ensureFolder = async () => {};
  plugin.downloadArrayBuffer = async () => { throw new Error('Feishu media download failed: HTTP 403'); };
  plugin.downloadMediaArrayBufferWithSession = async () => { throw new Error('Feishu media download failed: HTTP 403'); };
  plugin.renderFeishuDocumentWithElectron = async () => ({
    title: '浏览器兜底标题',
    markdown: '# 浏览器兜底标题\n\n浏览器只读到了残缺内容。',
    assets: [],
  });
  plugin.requestJson = async (requestPath) => {
    if (requestPath === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: '官方文档标题',
          documentId: 'docxIdentityAccounting',
          blockCount: tokens.length + 2,
          blocks: buildImageBlocks(tokens),
          imageTokens: tokens,
          imageTokenCount: tokens.length,
          imageTmpDownloadUrls: Object.fromEntries(tokens.map((token) => [token, `https://internal-api-drive-stream.feishu.cn/${token}`])),
        },
      };
    }
    if (requestPath === '/feishu/media') throw new Error('Feishu media download failed: HTTP 403');
    throw new Error(`unexpected request path: ${requestPath}`);
  };

  const result = await plugin.hydrateWebpageMarkdown({
    _id: 'feishu-six-images-failed-twice',
    type: 'webpage',
    content: 'https://example.feishu.cn/docx/docxIdentityAccounting',
    metadata: { url: 'https://example.feishu.cn/docx/docxIdentityAccounting' },
  }, '临时收集', '2026-08-15', '飞书六图失败计数');

  assert.strictEqual(result.metadata.imageLocalizationFailedCount, 6, '6 张图片即使两个下载通道都失败，也只能按 6 个图片身份计数一次');
  assert.ok(result.metadata.markdown.includes('# 官方正文标题'));
  assert.ok(result.metadata.markdown.includes('这段官方 API 正文不能被浏览器图片兜底覆盖。'));
  assert.ok(!result.metadata.markdown.includes('浏览器只读到了残缺内容。'));
}

async function runBrowserRecoveryKeepsOfficialMarkdownTest() {
  const tokens = Array.from({ length: 6 }, (_, index) => `boxcnRecovered${index + 1}`);
  const plugin = new PluginClass();
  const vault = createVault();
  plugin.app = vault.app;
  plugin.settings = PluginClass.__test.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'TEST-BINDING',
    socialArticleImageStorageMode: 'local',
    socialArticleImageStorageModeConfigured: true,
    bindings: [{ token: 'TEST-BINDING', label: 'WeChat 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: { connected: true, scope: 'offline_access docx:document:readonly docs:document.media:download' },
  });
  plugin.ensureFolder = async () => {};
  plugin.downloadArrayBuffer = async () => { throw new Error('Feishu media download failed: HTTP 403'); };
  plugin.downloadMediaArrayBufferWithSession = async () => { throw new Error('Feishu media download failed: HTTP 403'); };
  plugin.renderFeishuDocumentWithElectron = async () => ({
    title: 'Browser fallback title',
    markdown: [
      '# Browser fallback title',
      'Browser only loaded a partial body.',
      ...tokens.map((_token, index) => `![image](https://browser.example/image-${index + 1}.png)`),
    ].join('\n\n'),
    assets: tokens.map((_token, index) => ({
      src: `https://browser.example/image-${index + 1}.png`,
      dataUrl: `data:image/png;base64,${Buffer.from(`image-${index + 1}`).toString('base64')}`,
      alt: 'image',
    })),
  });
  plugin.requestJson = async (requestPath) => {
    if (requestPath === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: 'Official document title',
          documentId: 'docxBrowserRecovery',
          blockCount: tokens.length + 2,
          blocks: buildEnglishImageBlocks(tokens),
          imageTokens: tokens,
          imageTokenCount: tokens.length,
          imageTmpDownloadUrls: Object.fromEntries(tokens.map((token) => [token, `https://internal-api-drive-stream.feishu.cn/${token}`])),
        },
      };
    }
    if (requestPath === '/feishu/media') throw new Error('Feishu media download failed: HTTP 403');
    throw new Error(`unexpected request path: ${requestPath}`);
  };

  const result = await plugin.hydrateWebpageMarkdown({
    _id: 'feishu-six-images-recovered-by-browser',
    type: 'webpage',
    content: 'https://example.feishu.cn/docx/docxBrowserRecovery',
    metadata: { url: 'https://example.feishu.cn/docx/docxBrowserRecovery' },
  }, 'Inbox', '2026-08-15', 'Feishu six image recovery');

  assert.strictEqual(result.metadata.imageLocalizationFailedCount, 0, 'browser recovery must clear the final failure count');
  assert.ok(result.metadata.markdown.includes('Official document title'), 'official API title must remain canonical');
  assert.ok(result.metadata.markdown.includes('Official API body must remain canonical.'), 'official API body must remain canonical');
  assert.ok(!result.metadata.markdown.includes('Browser only loaded a partial body.'), 'browser fallback must not replace official text');
  assert.strictEqual((result.metadata.markdown.match(/!\[\[[^\]]+\]\]/g) || []).length, 6, 'all six browser-recovered images must be referenced in Markdown');
  assert.strictEqual(Object.keys(vault.files).length, 6, 'all six browser-recovered images must be saved once');
}

async function runLegacyResponseUsesMarkdownImageOrderTest() {
  const tokens = ['boxcnCanonicalFirst', 'boxcnCanonicalSecond'];
  const plugin = new PluginClass();
  const vault = createVault();
  plugin.app = vault.app;
  plugin.settings = PluginClass.__test.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'TEST-BINDING',
    socialArticleImageStorageMode: 'local',
    socialArticleImageStorageModeConfigured: true,
    bindings: [{ token: 'TEST-BINDING', label: 'WeChat 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: { connected: true, scope: 'offline_access docx:document:readonly docs:document.media:download' },
  });
  plugin.ensureFolder = async () => {};
  plugin.downloadArrayBuffer = async () => { throw new Error('temporary media unavailable'); };
  plugin.downloadMediaArrayBufferWithSession = async () => { throw new Error('session media unavailable'); };
  plugin.renderFeishuDocumentWithElectron = async () => ({
    title: 'Browser title',
    markdown: [
      '# Browser title',
      'Browser partial body.',
      '![image](https://browser.example/canonical-first.png)',
      '![image](https://browser.example/canonical-second.png)',
    ].join('\n\n'),
    assets: [
      {
        src: 'https://browser.example/canonical-first.png',
        dataUrl: `data:image/png;base64,${Buffer.from('canonical-first').toString('base64')}`,
      },
      {
        src: 'https://browser.example/canonical-second.png',
        dataUrl: `data:image/png;base64,${Buffer.from('canonical-second').toString('base64')}`,
      },
    ],
  });
  plugin.requestJson = async (requestPath) => {
    if (requestPath === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: 'Official document title',
          documentId: 'docxLegacyOrdering',
          blockCount: 4,
          blocks: buildEnglishImageBlocks(tokens),
          imageTokenCount: tokens.length,
          imageTmpDownloadUrls: {
            [tokens[1]]: `https://internal-api-drive-stream.feishu.cn/${tokens[1]}`,
            [tokens[0]]: `https://internal-api-drive-stream.feishu.cn/${tokens[0]}`,
          },
        },
      };
    }
    if (requestPath === '/feishu/media') throw new Error('official media unavailable');
    throw new Error(`unexpected request path: ${requestPath}`);
  };

  const result = await plugin.hydrateWebpageMarkdown({
    _id: 'feishu-legacy-ordering',
    type: 'webpage',
    content: 'https://example.feishu.cn/docx/docxLegacyOrdering',
    metadata: { url: 'https://example.feishu.cn/docx/docxLegacyOrdering' },
  }, 'Inbox', '2026-08-15', 'Feishu legacy ordering');

  const refs = result.metadata.markdown.match(/!\[\[([^\]]+)\]\]/g) || [];
  assert.strictEqual(refs.length, 2);
  assert.ok(refs[0].includes('image-01.png'), 'the first Markdown image must retain canonical block order');
  assert.ok(refs[1].includes('image-02.png'), 'the second Markdown image must retain canonical block order');
  const firstPath = Object.keys(vault.files).find((filePath) => filePath.includes('image-01.png'));
  const secondPath = Object.keys(vault.files).find((filePath) => filePath.includes('image-02.png'));
  assert.strictEqual(vault.files[firstPath].toString(), 'canonical-first');
  assert.strictEqual(vault.files[secondPath].toString(), 'canonical-second');
}

async function runBrowserExtraShellImageStillMapsDocumentImagesTest() {
  const tokens = ['boxcnOrderImageA', 'boxcnOrderImageB'];
  const plugin = new PluginClass();
  const vault = createVault();
  plugin.app = vault.app;
  plugin.settings = PluginClass.__test.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'TEST-BINDING',
    socialArticleImageStorageMode: 'local',
    socialArticleImageStorageModeConfigured: true,
    bindings: [{ token: 'TEST-BINDING', label: 'WeChat 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: { connected: true, scope: 'offline_access docx:document:readonly docs:document.media:download' },
  });
  plugin.ensureFolder = async () => {};
  plugin.downloadArrayBuffer = async () => { throw new Error('temporary media unavailable'); };
  plugin.downloadMediaArrayBufferWithSession = async () => { throw new Error('session media unavailable'); };
  plugin.renderFeishuDocumentWithElectron = async () => ({
    title: 'Browser title',
    imageTokens: tokens,
    markdown: [
      '# Browser title',
      'Browser body.',
      '![cover](https://browser.example/cover.png)',
      '![image](https://browser.example/image-a.png)',
      '![image](https://browser.example/image-b.png)',
    ].join('\n\n'),
    assets: [
      { src: 'https://browser.example/cover.png', alt: 'cover', dataUrl: `data:image/png;base64,${Buffer.from('cover').toString('base64')}` },
      { src: 'https://browser.example/image-a.png', alt: 'image', dataUrl: `data:image/png;base64,${Buffer.from('image-a').toString('base64')}` },
      { src: 'https://browser.example/image-b.png', alt: 'image', dataUrl: `data:image/png;base64,${Buffer.from('image-b').toString('base64')}` },
    ],
  });
  plugin.requestJson = async (requestPath) => {
    if (requestPath === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: 'Official document title',
          documentId: 'docxExtraBrowserImage',
          blockCount: tokens.length + 2,
          blocks: buildEnglishImageBlocks(tokens),
          imageTokenCount: tokens.length,
          imageTmpDownloadUrls: {},
          markdown: [
            '# Official document title',
            'Official API body.',
            '![image](https://official.example/image-a.png)',
            '![image](https://official.example/image-b.png)',
          ].join('\n\n'),
        },
      };
    }
    if (requestPath === '/feishu/media') throw new Error('official media unavailable');
    throw new Error(`unexpected request path: ${requestPath}`);
  };

  const result = await plugin.hydrateWebpageMarkdown({
    _id: 'feishu-browser-extra-shell-image',
    type: 'webpage',
    content: 'https://example.feishu.cn/docx/docxExtraBrowserImage',
    metadata: { url: 'https://example.feishu.cn/docx/docxExtraBrowserImage' },
  }, 'Inbox', '2026-08-15', 'Feishu extra browser image');

  assert.strictEqual(result.metadata.imageLocalizationFailedCount, 0);
  assert.strictEqual(Object.keys(vault.files).length, 2);
  assert.strictEqual((result.metadata.markdown.match(/!\[\[[^\]]+\]\]/g) || []).length, 2);
  assert.ok(result.metadata.conversionNote.includes('browser-image-order-mapping=1'));
}

async function runLocalWriteFailureKeepsOfficialMarkdownTest() {
  const token = 'boxcnWriteFailure';
  const plugin = new PluginClass();
  const vault = createVault({ writeError: new Error('vault write denied') });
  plugin.app = vault.app;
  plugin.settings = PluginClass.__test.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'TEST-BINDING',
    socialArticleImageStorageMode: 'local',
    socialArticleImageStorageModeConfigured: true,
    bindings: [{ token: 'TEST-BINDING', label: 'WeChat 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: { connected: true, scope: 'offline_access docx:document:readonly docs:document.media:download' },
  });
  plugin.ensureFolder = async () => {};
  plugin.downloadArrayBuffer = async () => { throw new Error('temporary media unavailable'); };
  plugin.downloadMediaArrayBufferWithSession = async () => { throw new Error('session media unavailable'); };
  plugin.renderFeishuDocumentWithElectron = async () => ({
    title: 'Browser title',
    markdown: '# Browser title\n\nBrowser partial body.\n\n![image](https://browser.example/image.png)',
    assets: [{
      src: 'https://browser.example/image.png',
      dataUrl: `data:image/png;base64,${Buffer.from('browser-image').toString('base64')}`,
    }],
  });
  plugin.requestJson = async (requestPath) => {
    if (requestPath === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: 'Official document title',
          documentId: 'docxWriteFailure',
          blockCount: 3,
          blocks: buildEnglishImageBlocks([token]),
          imageTokens: [token],
          imageTokenCount: 1,
          imageTmpDownloadUrls: {},
        },
      };
    }
    if (requestPath === '/feishu/media') {
      return {
        success: true,
        data: { dataUrl: `data:image/png;base64,${Buffer.from('official-image').toString('base64')}` },
      };
    }
    throw new Error(`unexpected request path: ${requestPath}`);
  };

  const result = await plugin.hydrateWebpageMarkdown({
    _id: 'feishu-local-write-failure',
    type: 'webpage',
    content: 'https://example.feishu.cn/docx/docxWriteFailure',
    metadata: { url: 'https://example.feishu.cn/docx/docxWriteFailure' },
  }, 'Inbox', '2026-08-15', 'Feishu local write failure');

  assert.ok(result.metadata.markdown.includes('Official API body must remain canonical.'));
  assert.ok(!result.metadata.markdown.includes('Browser partial body.'));
  assert.strictEqual(result.metadata.imageLocalizationFailedCount, 1);
  assert.ok(result.metadata.imageLocalizationError.includes('vault write denied'));
}

Promise.resolve()
  .then(runUniqueFailureAccountingTest)
  .then(runBrowserRecoveryKeepsOfficialMarkdownTest)
  .then(runLegacyResponseUsesMarkdownImageOrderTest)
  .then(runBrowserExtraShellImageStillMapsDocumentImagesTest)
  .then(runLocalWriteFailureKeepsOfficialMarkdownTest)
  .then(() => console.log('plugin feishu image identity accounting tests passed'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
