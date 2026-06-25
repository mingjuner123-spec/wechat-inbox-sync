const assert = require('assert');
const { loadPlugin } = require('./helpers/load-plugin');

const helpers = loadPlugin().__test;

const xhsMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'record-frontmatter-1',
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/frontmatter',
    source: 'wechat-miniprogram',
    createdAt: '2026-06-14T08:00:00.000Z',
    metadata: {
      title: 'Frontmatter Test',
      url: 'https://www.xiaohongshu.com/explore/frontmatter',
      author: '小红书账号',
      platform: '小红书',
      contentCategory: '图文',
      description: '这是一段内容简介',
      keywords: ['Obsidian', '知识管理'],
      aiMetadataSource: 'cloud',
      markdown: '正文内容',
    },
  },
  title: '小红书-Frontmatter Test',
  syncedAt: '2026-06-14T08:05:00.000Z',
});

assert.ok(xhsMarkdown.startsWith('---\n'));
assert.ok(xhsMarkdown.includes('\ntitle: 小红书-Frontmatter Test\n'));
assert.ok(xhsMarkdown.includes('\nauthor: 小红书账号\n'));
assert.ok(xhsMarkdown.includes('\nsource: 小红书图文\n'));
assert.ok(xhsMarkdown.includes('\ndescription: 这是一段内容简介\n'));
assert.ok(xhsMarkdown.includes('\nkeywords:\n  - Obsidian\n  - 知识管理\n'));
assert.strictEqual(xhsMarkdown.includes('\nid: record-frontmatter-1\n'), false);
assert.strictEqual(xhsMarkdown.includes('\ntype: webpage\n'), false);
assert.strictEqual(xhsMarkdown.includes('\nstatus: synced\n'), false);
assert.ok(xhsMarkdown.includes('<!-- wechat-inbox-record-id: record-frontmatter-1 -->'));

const feishuMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'record-feishu-frontmatter-1',
    type: 'webpage',
    content: 'https://my.feishu.cn/docx/demo',
    source: 'wechat-miniprogram',
    metadata: {
      title: '\u2063\u200b\u2063 踩中5次风口，赚',
      url: 'https://my.feishu.cn/docx/demo',
      platform: '飞书',
      contentCategory: '图文',
      description: '踩中5次风口，赚了100w+ 添加快捷方式最近修改: 昨天 16:14 分享 header-v2',
      keywords: ['风口', '小红书:AI', '知识库'],
      aiMetadataSource: 'cloud',
      markdown: '正文内容',
    },
  },
  title: '飞书-\u2063\u200b\u2063 踩中5次风口，赚',
  syncedAt: '2026-06-24T13:04:00.000Z',
});
const feishuFrontmatter = feishuMarkdown.match(/^---\n([\s\S]*?)\n---/)[1];
assert.strictEqual(feishuFrontmatter.includes('\u2063'), false);
assert.strictEqual(feishuFrontmatter.includes('\u200b'), false);
assert.strictEqual(feishuFrontmatter.includes('添加快捷方式'), false);
assert.strictEqual(feishuFrontmatter.includes('最近修改'), false);
assert.ok(feishuFrontmatter.split('\n').includes('title: "飞书-踩中5次风口，赚"'));
assert.ok(feishuFrontmatter.split('\n').some((line) => /^keywords: ".+"$/.test(line) && line.includes('小红书:AI')));

console.log('frontmatter boundary checks passed');
