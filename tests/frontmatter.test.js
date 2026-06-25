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
      author: 'XHS author',
      platform: 'Xiaohongshu',
      contentCategory: 'image-text',
      description: 'AI generated summary.',
      keywords: ['Obsidian', 'Knowledge management'],
      aiMetadataSource: 'cloud',
      markdown: 'Body content',
    },
  },
  title: 'XHS Frontmatter Test',
  syncedAt: '2026-06-14T08:05:00.000Z',
});

assert.ok(xhsMarkdown.startsWith('---\n'));
assert.ok(xhsMarkdown.includes('\ntitle: XHS Frontmatter Test\n'));
assert.ok(xhsMarkdown.includes('\nauthor: XHS author\n'));
assert.ok(xhsMarkdown.includes('\nsource: Xiaohongshuimage-text\n'));
assert.ok(xhsMarkdown.includes('\ndescription: AI generated summary.\n'));
assert.ok(xhsMarkdown.includes('\nkeywords: Obsidian, Knowledge management\n'));
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
      title: '\u2063\u200b Five trends',
      url: 'https://my.feishu.cn/docx/demo',
      platform: 'Feishu',
      contentCategory: 'image-text',
      description: 'Five trends 添加快捷方式 最近修改 昨天 16:14 分享 header-v2',
      keywords: ['trend', 'XHS AI', 'knowledge base'],
      aiMetadataSource: 'cloud',
      markdown: 'Body content',
    },
  },
  title: 'Feishu-\u2063\u200b Five trends',
  syncedAt: '2026-06-24T13:04:00.000Z',
});
const feishuFrontmatter = feishuMarkdown.match(/^---\n([\s\S]*?)\n---/)[1];
assert.strictEqual(feishuFrontmatter.includes('\u2063'), false);
assert.strictEqual(feishuFrontmatter.includes('\u200b'), false);
assert.strictEqual(feishuFrontmatter.includes('添加快捷方式'), false);
assert.strictEqual(feishuFrontmatter.includes('最近修改'), false);
assert.ok(feishuFrontmatter.split('\n').includes('title: "Feishu-Five trends"'));
assert.ok(feishuFrontmatter.split('\n').some((line) => /^keywords: ".+"$/.test(line) && line.includes('XHS AI')));

console.log('frontmatter boundary checks passed');
