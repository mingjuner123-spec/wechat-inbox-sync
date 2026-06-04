const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildMarkdownForRecord,
  formatCreatedTime,
  getDateFolderName,
  getTitleTimePart,
  getTypeDisplayName,
  buildRecordTitleBase,
  syncRecordsToVault,
} = require('../desktop-sync/sync-core');

assert.strictEqual(getDateFolderName('2026-05-08T16:34:00.000Z'), '2026-05-09');
assert.strictEqual(formatCreatedTime('2026-05-08T06:32:05.000Z'), '2026-05-08 14:32:05');
assert.strictEqual(getTitleTimePart('2026-05-08T06:32:05.000Z'), '143205');
assert.strictEqual(getTypeDisplayName('text'), '文字');
assert.strictEqual(getTypeDisplayName('link'), '链接');
assert.strictEqual(getTypeDisplayName('voice'), '语音');
assert.strictEqual(buildRecordTitleBase({
  type: 'file',
  content: 'Demo Document.pdf',
  createdAt: '2026-05-08T06:32:05.000Z',
  metadata: {
    fileName: 'Demo Document.pdf',
    fileExt: 'pdf',
  },
}), 'pdf-Demo Document');

const textMarkdown = buildMarkdownForRecord({
  record: {
    _id: 'record-text-1',
    type: 'text',
    content: '先收集，后整理。',
    source: 'wechat-miniprogram',
    createdAt: '2026-05-08T12:34:00.000Z',
    status: 'pending',
    metadata: {},
  },
  title: '文字-203400',
  syncedAt: '2026-05-08T13:00:00.000Z',
});

assert.strictEqual(textMarkdown, '收集时间：2026-05-08 20:34:00\n\n先收集，后整理。\n');

const linkMarkdown = buildMarkdownForRecord({
  record: {
    _id: 'record-link-1',
    type: 'link',
    content: 'https://example.com/article',
    source: 'wechat-miniprogram',
    createdAt: '2026-05-08T12:40:00.000Z',
    status: 'pending',
    metadata: {
      url: 'https://example.com/article',
      title: '页面标题',
      fetchStatus: 'failed',
    },
  },
  title: '链接-204000',
  syncedAt: '2026-05-08T13:00:00.000Z',
});

assert.strictEqual(linkMarkdown.includes('---'), false);
assert.strictEqual(linkMarkdown.includes('# 页面标题'), false);
assert.ok(linkMarkdown.startsWith('收集时间：2026-05-08 20:40:00'));
assert.ok(linkMarkdown.includes('原始链接：https://example.com/article'));
assert.ok(linkMarkdown.includes('正文抓取失败，已保存标题和原始链接。'));

const voiceMarkdown = buildMarkdownForRecord({
  record: {
    _id: 'record-voice-1',
    type: 'voice',
    content: '现场语音备忘录 - 00:15',
    source: 'wechat-miniprogram',
    createdAt: '2026-05-08T12:45:00.000Z',
    status: 'pending',
    metadata: {
      audioFileName: '语音-204500.mp3',
      audioFileID: 'cloud://voices/001.mp3',
      transcription: '这是转写全文。',
      transcriptionStatus: 'success',
    },
  },
  title: '语音-204500',
  syncedAt: '2026-05-08T13:00:00.000Z',
});

assert.strictEqual(voiceMarkdown.includes('---'), false);
assert.strictEqual(voiceMarkdown.includes('# 语音-204500'), false);
assert.ok(voiceMarkdown.startsWith('收集时间：2026-05-08 20:45:00'));
assert.strictEqual(voiceMarkdown.includes('## 摘要'), false);
assert.ok(voiceMarkdown.includes('## 转写全文'));
assert.ok(voiceMarkdown.includes('这是转写全文。'));
assert.ok(voiceMarkdown.includes('![[语音-204500.mp3]]'));

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-sync-'));
const result = syncRecordsToVault({
  vaultPath: tmpRoot,
  inboxDir: '临时收集',
  syncedAt: '2026-05-08T13:00:00.000Z',
  records: [
    {
      _id: 'record-text-1',
      type: 'text',
      content: '第一条文字',
      source: 'wechat-miniprogram',
      createdAt: '2026-05-08T12:34:00.000Z',
      status: 'pending',
      metadata: {},
    },
    {
      _id: 'record-text-2',
      type: 'text',
      content: '第二条文字',
      source: 'wechat-miniprogram',
      createdAt: '2026-05-08T12:35:00.000Z',
      status: 'pending',
      metadata: {},
    },
  ],
});

assert.deepStrictEqual(result.written.map((item) => path.basename(item.filePath)), [
  '文本-第一条文字.md',
  '文本-第二条文字.md',
]);
assert.strictEqual(
  fs.existsSync(path.join(tmpRoot, '临时收集', '2026-05-08', '文本-第一条文字.md')),
  true
);
assert.strictEqual(
  fs.readFileSync(path.join(tmpRoot, '临时收集', '2026-05-08', '文本-第二条文字.md'), 'utf8').includes('收集时间：2026-05-08 20:35:00'),
  true
);
