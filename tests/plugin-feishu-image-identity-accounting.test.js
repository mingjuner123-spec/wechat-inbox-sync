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

function createVault() {
  const files = {};
  return {
    files,
    app: {
      vault: {
        adapter: {
          exists: async () => false,
          writeBinary: async (filePath, buffer) => { files[filePath] = Buffer.from(buffer); },
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

Promise.resolve()
  .then(runUniqueFailureAccountingTest)
  .then(runBrowserRecoveryKeepsOfficialMarkdownTest)
  .then(() => console.log('plugin feishu image identity accounting tests passed'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
