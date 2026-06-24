const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const repoRoot = path.join(__dirname, '..');
const pluginMainPath = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync', 'main.js');
const pluginCorePath = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync', 'plugin-core.js');
const syncApiIndexPath = path.join(repoRoot, 'cloudfunctions', 'syncApi', 'index.js');
const quickstartIndexPath = path.join(repoRoot, 'cloudfunctions', 'quickstartFunctions', 'index.js');

let requestUrlMock = async () => ({});
const originalLoad = Module._load;

Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Notice: class Notice {},
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: (options) => requestUrlMock(options),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require(pluginMainPath);
Module._load = originalLoad;

const pluginCore = require(pluginCorePath);
const pluginSource = fs.readFileSync(pluginMainPath, 'utf8');
const syncApiSource = fs.readFileSync(syncApiIndexPath, 'utf8');
const quickstartSource = fs.readFileSync(quickstartIndexPath, 'utf8');

function createPlugin({ requestUrl, files = {}, settings = {} }) {
  requestUrlMock = requestUrl;
  const plugin = new PluginClass();
  plugin.settings = PluginClass.__test.mergeSettings({
    apiBase: 'https://api.example.com/sync',
    token: 'ABC-123',
    inboxDir: '临时收集',
    aiProvider: 'off',
    ...settings,
  });
  plugin.app = {
    vault: {
      adapter: {
        async exists(filePath) {
          return Object.prototype.hasOwnProperty.call(files, filePath);
        },
        async write(filePath, content) {
          files[filePath] = content;
        },
        async writeBinary(filePath, content) {
          files[filePath] = content;
        },
      },
      async createFolder(filePath) {
        files[filePath] = '<folder>';
      },
    },
  };
  return { plugin, files };
}

(async () => {
  assert.strictEqual(pluginCore.DEFAULT_SETTINGS.aiMetadataEnabled, true);
  assert.strictEqual(pluginCore.DEFAULT_SETTINGS.xiaohongshuCommentsEnabled, true);
  assert.strictEqual(pluginCore.mergeSettings({ aiMetadataEnabled: false }).aiMetadataEnabled, true);
  assert.strictEqual(pluginCore.mergeSettings({ xiaohongshuCommentsEnabled: false }).xiaohongshuCommentsEnabled, true);
  assert.strictEqual(pluginCore.mergeSettings({ settingsVersion: 2, aiMetadataEnabled: false }).aiMetadataEnabled, false);
  assert.strictEqual(pluginCore.mergeSettings({ settingsVersion: 2, xiaohongshuCommentsEnabled: false }).xiaohongshuCommentsEnabled, false);

  assert.ok(pluginSource.includes("text: 'AI 简介与关键词'"));
  assert.ok(pluginSource.includes("text: '小红书评论区提取'"));
  assert.ok(pluginSource.includes(".setName('提取小红书评论区')"));
  assert.strictEqual(pluginSource.includes(".setName('DeepSeek API Key')"), false);
  assert.strictEqual(pluginSource.includes(".setName('测试 AI 连接')"), false);
  assert.strictEqual(pluginSource.includes("text: '公众号评论区提取（实验性）'"), false);
  assert.strictEqual(pluginSource.includes(".setName('笔记属性字段')"), false);

  assert.match(syncApiSource, /async markRecordSynced[\s\S]*?\.collection\('inbox_records'\)[\s\S]*?\.remove\(\)[\s\S]*?status:\s*'deleted'[\s\S]*?deleted:\s*true/);
  assert.doesNotMatch(syncApiSource, /async markRecordSynced[\s\S]*?status:\s*'synced'/);
  assert.match(quickstartSource, /async function markInboxRecordSynced[\s\S]*?\.collection\('inbox_records'\)[\s\S]*?\.remove\(\)[\s\S]*?status:\s*'deleted'[\s\S]*?deleted:\s*true/);
  assert.doesNotMatch(quickstartSource, /async function markInboxRecordSynced[\s\S]*?status:\s*'synced'/);

  {
    let metadataRequestSeen = false;
    const { plugin, files } = createPlugin({
      requestUrl: async (options) => {
        const url = String(options.url || '');
        if (url === 'https://www.xiaohongshu.com/explore/contract-xhs') {
          return {
            text: [
              '<html><head>',
              '<meta property="og:title" content="Contract XHS">',
              '<meta name="description" content="小红书正文内容，用于防回退测试。 #小红书">',
              '<meta property="og:image" content="https://img.example.com/contract-cover.jpg">',
              '</head><body>',
              '<div class="comment-item"><span class="user-name">用户甲</span><span class="comment-content">评论区会影响关键词</span></div>',
              '</body></html>',
            ].join(''),
          };
        }
        if (url.endsWith('/metadata/generate')) {
          metadataRequestSeen = true;
          const body = JSON.parse(options.body || '{}');
          assert.ok(body.content.includes('小红书正文内容'));
          assert.ok(body.content.includes('评论区会影响关键词'));
          return {
            json: {
              success: true,
              data: {
                description: 'AI 总结必须覆盖原始页面描述',
                keywords: ['小红书评论', 'AI关键词', '防回退'],
              },
            },
          };
        }
        return {};
      },
    });

    await plugin.writeRecord({
      _id: 'contract-xhs',
      type: 'webpage',
      content: 'https://www.xiaohongshu.com/explore/contract-xhs',
      createdAt: '2026-06-24T12:11:30.000Z',
      metadata: {
        url: 'https://www.xiaohongshu.com/explore/contract-xhs',
      },
    }, '2026-06-24T12:11:40.000Z');

    const note = Object.entries(files).find(([filePath]) => filePath.endsWith('.md'))[1];
    assert.strictEqual(metadataRequestSeen, true);
    assert.ok(note.includes('## 评论区'));
    assert.ok(note.includes('评论区会影响关键词'));
    assert.ok(note.includes('description: AI 总结必须覆盖原始页面描述'));
    assert.ok(note.includes('keywords: 小红书评论, AI关键词, 防回退'));
  }

  {
    const markdown = PluginClass.__test.buildMarkdownForRecord({
      record: {
        _id: 'contract-feishu',
        type: 'webpage',
        content: 'https://my.feishu.cn/docx/contract-token',
        createdAt: '2026-06-24T08:00:00.000Z',
        metadata: {
          title: '飞书属性防回退',
          url: 'https://my.feishu.cn/docx/contract-token',
          platform: '飞书',
          contentCategory: '文档',
          description: '飞书描述: 包含冒号也必须是安全属性',
          keywords: ['小红书:AI', '知识库'],
          conversionStatus: 'success',
          markdown: '## 一级标题\n\n正文内容',
        },
      },
      title: '飞书-飞书属性防回退',
      syncedAt: '2026-06-24T08:05:00.000Z',
    });
    const frontmatter = markdown.split('---')[1];
    assert.ok(frontmatter.split('\n').some((line) => /^description: ".+"$/.test(line)));
    assert.ok(frontmatter.split('\n').some((line) => /^keywords: ".+"$/.test(line) && line.includes('小红书:AI')));
    assert.strictEqual(frontmatter.includes('description: 飞书描述: 包含冒号也必须是安全属性\n'), false);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
