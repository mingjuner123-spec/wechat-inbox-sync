'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'record-metadata-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');

assert.ok(fs.existsSync(modulePath), 'record metadata utils module must exist');

const {
  enrichExtractedWebpageMetadata,
  extractKeywordsFromText,
  getRecordAuthor,
  getRecordDescription,
  getRecordKeywords,
  stripMarkdownForDescription,
} = require(modulePath);

assert.strictEqual(getRecordAuthor({ author: '作者', accountName: '账号' }), '作者');
assert.strictEqual(getRecordAuthor({ nickname: '昵称', nickName: '备用昵称' }), '昵称');
assert.strictEqual(getRecordAuthor({ sourceName: '来源' }), '来源');
assert.strictEqual(getRecordAuthor(), '');

assert.strictEqual(getRecordDescription({ description: '描述', summary: '摘要' }), '描述');
assert.strictEqual(getRecordDescription({ excerpt: '摘录', abstract: '概要' }), '摘录');
assert.strictEqual(getRecordDescription(), '');

const arrayKeywords = ['一', '二'];
assert.strictEqual(getRecordKeywords({ keywords: arrayKeywords }), arrayKeywords);
assert.deepStrictEqual(
  getRecordKeywords({ hashtags: '小红书，AI、知识库 复盘' }),
  ['小红书', 'AI', '知识库', '复盘'],
);
assert.deepStrictEqual(getRecordKeywords(), []);

assert.strictEqual(
  stripMarkdownForDescription([
    '# 标题',
    '![封面](https://example.com/cover.png)',
    '- **正文内容**',
    '| 列一 | 列二 |',
    '普通 [[内部链接]] 段落',
  ].join('\n')),
  '正文内容 普通 段落',
);

assert.deepStrictEqual(
  extractKeywordsFromText('风口 小红书 AI 知识库 飞书 复盘 电商 公众号 流量 创新 创业 小红书'),
  ['风口', '小红书', 'AI', '知识库', '飞书', '复盘', '电商', '公众号'],
);
assert.deepStrictEqual(
  extractKeywordsFromText('alpha alpha beta gamma delta epsilon zeta eta'),
  ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'],
);

const completeMetadata = {
  title: '原标题',
  markdown: '# 标题\n这是正文内容，而且足够长。',
  description: '已有描述',
  keywords: ['已有关键词'],
};
const completeResult = enrichExtractedWebpageMetadata(completeMetadata);
assert.notStrictEqual(completeResult, completeMetadata);
assert.strictEqual(completeResult.description, '已有描述');
assert.deepStrictEqual(completeResult.keywords, ['已有关键词']);

const enriched = enrichExtractedWebpageMetadata({
  title: 'AI 实践',
  markdown: '# 标题\n这是一个足够长的第一句，用于生成描述。第二句也不应覆盖第一句。',
});
assert.strictEqual(enriched.description, '这是一个足够长的第一句，用于生成描述');
assert.ok(enriched.keywords.includes('AI'));

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'getRecordAuthor',
  'getRecordDescription',
  'getRecordKeywords',
  'stripMarkdownForDescription',
  'extractKeywordsFromText',
  'enrichExtractedWebpageMetadata',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./record-metadata-utils')"),
  'src/main.js must consume the extracted record metadata module',
);
