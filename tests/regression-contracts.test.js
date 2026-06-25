const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const repoRoot = path.join(__dirname, '..');
const pluginMainPath = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync', 'main.js');
const pluginCorePath = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync', 'plugin-core.js');
const pluginXiaohongshuCommentsPath = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync', 'xiaohongshu-comments.js');
const syncApiCorePath = path.join(repoRoot, 'cloudfunctions', 'syncApi', 'sync-api-core.js');
const syncApiIndexPath = path.join(repoRoot, 'cloudfunctions', 'syncApi', 'index.js');
const quickstartIndexPath = path.join(repoRoot, 'cloudfunctions', 'quickstartFunctions', 'index.js');
const cloudbasercPath = path.join(repoRoot, 'cloudbaserc.json');

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
const pluginXiaohongshuCommentsSource = fs.readFileSync(pluginXiaohongshuCommentsPath, 'utf8');
const syncApiCoreSource = fs.readFileSync(syncApiCorePath, 'utf8');
const syncApiSource = fs.readFileSync(syncApiIndexPath, 'utf8');
const quickstartSource = fs.readFileSync(quickstartIndexPath, 'utf8');
const cloudbaserc = JSON.parse(fs.readFileSync(cloudbasercPath, 'utf8'));

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
  assert.strictEqual(
    pluginCore.OFFICIAL_SYNC_API_BASE,
    'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync',
  );
  assert.strictEqual(
    pluginCore.mergeSettings({
      apiBase: 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync',
    }).apiBase,
    pluginCore.OFFICIAL_SYNC_API_BASE,
  );
  assert.strictEqual(pluginCore.mergeSettings({ aiMetadataEnabled: false }).aiMetadataEnabled, true);
  assert.strictEqual(pluginCore.mergeSettings({ xiaohongshuCommentsEnabled: false }).xiaohongshuCommentsEnabled, true);
  assert.strictEqual(pluginCore.mergeSettings({ settingsVersion: 2, aiMetadataEnabled: false }).aiMetadataEnabled, false);
  assert.strictEqual(pluginCore.mergeSettings({ settingsVersion: 2, xiaohongshuCommentsEnabled: false }).xiaohongshuCommentsEnabled, false);

  assert.ok(pluginSource.includes("text: 'AI 简介与关键词'"));
  assert.ok(pluginSource.includes("text: '小红书评论区提取'"));
  assert.ok(pluginSource.includes(".setName('提取小红书评论区')"));
  assert.ok(pluginSource.includes("id: 'login-xiaohongshu-web'"));
  assert.ok(pluginSource.includes("async function checkXiaohongshuLoginStatus"));
  assert.ok(pluginSource.includes("const XIAOHONGSHU_SESSION_PARTITION = 'persist:wechat-inbox-xiaohongshu'"));
  assert.ok(pluginSource.includes('function getXiaohongshuSession()'));
  assert.ok(pluginSource.includes('async function probeXiaohongshuLoginStatus'));
  assert.ok(pluginSource.includes("async function getXiaohongshuCookieHeader"));
  assert.ok(pluginSource.includes("async function getXiaohongshuRequestHeaders"));
  assert.ok(pluginSource.includes('headers.Cookie = cookieHeader'));
  assert.ok(pluginSource.includes('登录小红书'));
  assert.ok(pluginSource.includes('async checkXiaohongshuLogin()'));
  assert.ok(pluginSource.includes("async loginXiaohongshu(targetUrl = '')"));
  assert.ok(pluginSource.includes(".setButtonText('打开小红书登录')"));
  assert.ok(pluginSource.includes(".setButtonText('检测小红书登录状态')"));
  const loginXhsSource = pluginSource.slice(
    pluginSource.indexOf('async function loginXiaohongshuWeb'),
    pluginSource.indexOf('function getElectronShell'),
  );
  assert.ok(loginXhsSource.includes('const session = getXiaohongshuSession();'));
  assert.strictEqual(loginXhsSource.includes('setInterval'), false);
  assert.strictEqual(loginXhsSource.includes('win.destroy()'), false);
  assert.ok(pluginSource.includes('this.plugin.checkXiaohongshuLogin()'));
  assert.ok(pluginSource.includes('hasXiaohongshuAccountCookie'));
  assert.ok(pluginSource.includes('renderXiaohongshuMarkdownWithElectron'));
  assert.ok(pluginSource.includes('aiMetadataSource'));
  assert.match(pluginSource, /key === 'description'[\s\S]*?aiMetadataSource/);
  assert.match(pluginSource, /key === 'keywords'[\s\S]*?aiMetadataSource/);
  assert.ok(pluginSource.includes('contentText'));
  assert.ok(pluginSource.includes('commentText'));
  assert.ok(pluginSource.includes('user_info'));
  assert.ok(pluginSource.includes('likeCount'));
  const renderXhsSource = pluginSource.slice(
    pluginSource.indexOf('async function renderXiaohongshuMarkdownWithElectron'),
    pluginSource.indexOf('function decodeJsonStringLiteral'),
  );
  assert.ok(renderXhsSource.includes('const session = getXiaohongshuSession();'));
  assert.strictEqual(renderXhsSource.includes('const session = getWechatSession();'), false);
  assert.ok(pluginSource.includes('async function fetchXiaohongshuCommentsFromApi'));
  assert.ok(pluginSource.includes("require('./xiaohongshu-comments')"));
  assert.ok(pluginXiaohongshuCommentsSource.includes('https://edith.xiaohongshu.com/api/sns/web/v2/comment/page'));
  assert.ok(pluginSource.includes('isNoiseSocialCommentText'));
  assert.ok(pluginSource.includes('查看全部评论内容'));
  assert.ok(pluginSource.includes('^共\\d+条评论'));
  assert.strictEqual(pluginSource.includes(".setName('DeepSeek API Key')"), false);
  assert.strictEqual(pluginSource.includes(".setName('测试 AI 连接')"), false);
  assert.strictEqual(pluginSource.includes("text: '公众号评论区提取（实验性）'"), false);
  assert.strictEqual(pluginSource.includes(".setName('笔记属性字段')"), false);

  assert.match(syncApiCoreSource, /const PRO_FEATURE_PLANS = \[[\s\S]*?'pro_month'[\s\S]*?'pro_year'[\s\S]*?\]/);
  {
    const syncApiConfig = cloudbaserc.functions.find((item) => item.name === 'syncApi');
    assert.ok(syncApiConfig, 'cloudbaserc should contain syncApi deployment config');
    assert.ok(syncApiConfig.envVariables.DEEPSEEK_API_KEY, 'syncApi deploy config must keep DEEPSEEK_API_KEY');
    assert.strictEqual(syncApiConfig.envVariables.WECHAT_DATA_ENV, 'he02-d8gebzv050ed6c4ef');
  }

  assert.match(syncApiSource, /async markRecordSynced[\s\S]*?\.collection\('inbox_records'\)[\s\S]*?\.remove\(\)[\s\S]*?status:\s*'deleted'[\s\S]*?deleted:\s*true/);
  assert.match(syncApiSource, /async function deleteDuplicatePendingRecordsByDedupeKey[\s\S]*?getRecordDedupeKey[\s\S]*?\.remove\(\)/);
  assert.match(syncApiSource, /const\s*\{[\s\S]*buildInboxRecordDedupeKey[\s\S]*\}\s*=\s*require\('\.\/inbox-core'\)/);
  assert.match(syncApiSource, /async markRecordSynced[\s\S]*?deleteDuplicatePendingRecordsByDedupeKey[\s\S]*?deletedDuplicateCount/);
  assert.doesNotMatch(syncApiSource, /async markRecordSynced[\s\S]*?status:\s*'synced'/);
  assert.match(quickstartSource, /async function markInboxRecordSynced[\s\S]*?\.collection\('inbox_records'\)[\s\S]*?\.remove\(\)[\s\S]*?status:\s*'deleted'[\s\S]*?deleted:\s*true/);
  assert.match(quickstartSource, /async function deleteDuplicatePendingRecordsByDedupeKey[\s\S]*?getRecordDedupeKey[\s\S]*?\.remove\(\)/);
  assert.match(quickstartSource, /async function markInboxRecordSynced[\s\S]*?deleteDuplicatePendingRecordsByDedupeKey[\s\S]*?deletedDuplicateCount/);
  assert.doesNotMatch(quickstartSource, /async function markInboxRecordSynced[\s\S]*?status:\s*'synced'/);
  assert.strictEqual(quickstartSource.includes("case 'unlockDailyUsageByShare'"), false);
  assert.strictEqual(quickstartSource.includes('async function unlockDailyUsageByShare'), false);
  assert.strictEqual(quickstartSource.includes('DAILY_SHARE_LIMIT'), false);
  assert.strictEqual(syncApiSource.includes('DAILY_SHARE_LIMIT'), false);
  assert.match(syncApiSource, /referral_rewards/);
  assert.match(syncApiSource, /ensureCollection\('referral_rewards'\)/);
  assert.match(syncApiSource, /source:\s*'referral_invite'/);
  assert.match(syncApiSource, /durationDays:\s*7/);
  assert.match(syncApiSource, /inviterOpenid/);
  assert.match(syncApiSource, /referralRewardedAt/);

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
        if (url.includes('/entitlements/status')) {
          return {
            json: {
              success: true,
              data: {
                hasAccess: true,
                plan: 'local_transcription_beta',
                status: 'active',
              },
            },
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
          aiMetadataSource: 'cloud',
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

  {
    const cleaned = PluginClass.__test.cleanMarkdownForStorage([
      '内容有点长，我想把如何找到自己的新业务讲清楚。',
      '',
      '2020年之前，我没有任何目标',
      '',
      '踩中第一个风口之前，我一直在跑地推销售。',
      '',
      '- 上传日志',
      '- 联系客服',
      '- 功能更新',
      '- 帮助中心',
      '- 效率指南',
      '- 第一次风口：小红书商单',
      '- 第二次风口：小红书电商',
      '',
      '第一次风口：小红书商单',
      '',
      '2020年，疫情原因没法继续跑地推。',
    ].join('\n'), {
      dedupe: true,
      feishuTitle: '踩中5次风口，赚了100w+',
    });
    assert.ok(cleaned.includes('## 2020年之前，我没有任何目标'));
    assert.ok(cleaned.includes('## 第一次风口：小红书商单'));
    assert.strictEqual(cleaned.includes('上传日志'), false);
    assert.strictEqual(cleaned.includes('联系客服'), false);
    assert.strictEqual(cleaned.includes('功能更新'), false);
    assert.strictEqual(cleaned.includes('帮助中心'), false);
    assert.strictEqual(cleaned.includes('效率指南'), false);
    assert.strictEqual(cleaned.includes('- 第二次风口：小红书电商'), false);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
