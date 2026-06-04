const assert = require('assert');

const {
  buildMarkdownForRecord,
  getTypeDisplayName,
} = require('../desktop-sync/sync-core');

assert.doesNotThrow(() => getTypeDisplayName('webpage'));
assert.doesNotThrow(() => getTypeDisplayName('file'));

const webpageMarkdown = buildMarkdownForRecord({
  record: {
    _id: 'record-webpage-1',
    type: 'webpage',
    content: 'https://mp.weixin.qq.com/s/example',
    source: 'wechat-miniprogram',
    createdAt: '2026-05-08T12:42:00.000Z',
    status: 'pending',
    metadata: {
      url: 'https://mp.weixin.qq.com/s/example',
      conversionStatus: 'pending',
    },
  },
  title: 'webpage-204200',
  syncedAt: '2026-05-08T13:00:00.000Z',
});

assert.ok(webpageMarkdown.includes('https://mp.weixin.qq.com/s/example'));
assert.ok(webpageMarkdown.includes('Markdown'));

const wechatForwardMarkdown = buildMarkdownForRecord({
  record: {
    _id: 'record-webpage-forward',
    type: 'webpage',
    content: 'https://mp.weixin.qq.com/s/forward-example',
    source: 'wechat-miniprogram',
    createdAt: '2026-05-25T08:05:38.000Z',
    status: 'pending',
    metadata: {
      title: '裸辞两年，从没赚过工资外的钱，到靠AI养活自己｜我的完整经历-002',
      url: 'https://mp.weixin.qq.com/s/forward-example',
      shareText: '裸辞两年，从没赚过工资外的钱，到靠AI养活自己｜我的完整经历',
      conversionStatus: 'success',
      markdown: '如果你现在的状态是这样的：想做点什么，但不知道从哪里开始。',
    },
  },
  title: '公众号-裸辞两年，从没赚过工资外的钱，到靠AI养活自己｜我的完整经历-002',
  syncedAt: '2026-05-25T08:06:00.000Z',
});

assert.strictEqual(wechatForwardMarkdown.includes('\n裸辞两年，从没赚过工资外的钱，到靠AI养活自己｜我的完整经历\n\n原始链接：'), false);
assert.ok(wechatForwardMarkdown.includes('## Markdown 内容'));
assert.ok(wechatForwardMarkdown.includes('如果你现在的状态是这样的'));
assert.strictEqual(wechatForwardMarkdown.includes('\n裸辞两年，从没赚过工资外的钱，到靠AI养活自己｜我的完整经历-002\n\n原始链接：'), false);
assert.strictEqual(
  wechatForwardMarkdown.split('\n').map((line) => line.trim()).filter(Boolean)[1].startsWith('原始链接：'),
  true,
);

const fileMarkdown = buildMarkdownForRecord({
  record: {
    _id: 'record-file-1',
    type: 'file',
    content: 'example.pdf',
    source: 'wechat-miniprogram',
    createdAt: '2026-05-08T12:43:00.000Z',
    status: 'pending',
    metadata: {
      fileName: 'example.pdf',
      fileID: 'cloud://files/example.pdf',
      fileExt: 'pdf',
      conversionStatus: 'pending',
    },
  },
  title: 'file-204300',
  syncedAt: '2026-05-08T13:00:00.000Z',
});

assert.ok(fileMarkdown.includes('example.pdf'));
assert.ok(fileMarkdown.includes('cloud://files/example.pdf'));
assert.ok(fileMarkdown.includes('Markdown'));

const attachmentOnlyMarkdown = buildMarkdownForRecord({
  record: {
    _id: 'record-file-2',
    type: 'file',
    content: 'example.docx',
    createdAt: '2026-05-13T12:43:00.000Z',
    metadata: {
      fileName: 'example.docx',
      fileID: 'cloud://files/example.docx',
      filePath: '临时收集/文件附件/2026-05-13/example.docx',
      conversionStatus: 'attachment_saved',
    },
  },
  title: 'file-204300',
  syncedAt: '2026-05-13T12:44:00.000Z',
});

assert.ok(attachmentOnlyMarkdown.includes('[[临时收集/文件附件/2026-05-13/example.docx]]'));
assert.ok(attachmentOnlyMarkdown.includes('PDF / Word'));
