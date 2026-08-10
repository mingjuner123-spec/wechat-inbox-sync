const assert = require('assert');

const {
  stripMarkdownCodeBlocks,
  normalizeTitleForCompare,
  normalizeFeishuMarkdownLine,
  shouldDropFeishuLine,
  formatFeishuHeadingLine,
  isFeishuCodeLanguageLine,
  postProcessFeishuMarkdown,
  isFeishuMarkdownLikelyTruncated,
} = require('../obsidian-plugin/wechat-inbox-sync/src/feishu-markdown-utils');

assert.strictEqual(
  stripMarkdownCodeBlocks('body\n```bash\nnpm install\n```\ntail'),
  'body\n \ntail',
  'historical AI metadata and record body helpers should retain the code-block stripping dependency',
);
assert.strictEqual(normalizeTitleForCompare('# Feishu Doc'), 'FeishuDoc');
assert.strictEqual(shouldDropFeishuLine('Feishu Doc', 'Feishu Doc'), true);
assert.strictEqual(isFeishuCodeLanguageLine('Bash'), true);

assert.strictEqual(
  normalizeFeishuMarkdownLine('\u200B-  正文  '),
  '- 正文',
  '飞书行规范化必须保留现有零宽字符与列表空格行为',
);

assert.strictEqual(
  formatFeishuHeadingLine('一、项目背景'),
  '# 一、项目背景',
  '中文一级章节标题必须保持现有格式',
);

assert.strictEqual(
  formatFeishuHeadingLine('npm install'),
  'npm install',
  '普通命令行不得被误改成标题',
);

assert.strictEqual(
  postProcessFeishuMarkdown([
    '# 我的文档',
    'Plain Text',
    '正文第一段。',
    'Bash',
    'npm install',
    '正文第二段。',
  ].join('\n'), '我的文档'),
  [
    '正文第一段。',
    '',
    '```bash',
    'npm install',
    '```',
    '',
    '正文第二段。',
  ].join('\n'),
  '壳层噪声、标题去重和代码块整理必须保持现有输出',
);

assert.strictEqual(
  isFeishuMarkdownLikelyTruncated([
    '安装清单总览',
    'Node.js',
    'npm',
    'FFmpeg',
    'Python',
    '必须',
    '推荐',
    'Node.js',
    'npm',
    'FFmpeg',
    'Python',
    '必须',
    '推荐',
  ].join('\n')),
  true,
  '工具清单残片必须继续被判定为疑似截断',
);

assert.strictEqual(
  isFeishuMarkdownLikelyTruncated(
    Array.from({ length: 25 }, (_, index) => `这是完整正文第 ${index + 1} 段。`).join('\n'),
  ),
  false,
  '足量连续正文不得被误判为截断',
);

console.log('plugin feishu markdown utils tests passed');
