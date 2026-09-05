const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

const notices = [];
let requestUrlMock = async () => ({});
const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal: class Modal {},
      Notice: class Notice {
        constructor(message) {
          notices.push(String(message || ''));
        }
      },
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: (...args) => requestUrlMock(...args),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;

const helpers = PluginClass.__test;
assert.strictEqual(helpers.categorizeSyncFailure({ code: 'EXTRACTION_FAILED' }), 'EXTRACTION_FAILED');
assert.strictEqual(helpers.categorizeSyncFailure({ code: 'TRANSCRIPTION_FAILED' }), 'TRANSCRIPTION_FAILED');
assert.strictEqual(helpers.categorizeSyncFailure({ code: 'WRITE_FAILED' }), 'WRITE_FAILED');
assert.strictEqual(helpers.categorizeSyncFailure({ code: 'UNSUPPORTED_PLATFORM' }), 'UNSUPPORTED_PLATFORM');
assert.strictEqual(helpers.categorizeSyncFailure(new Error('Unsupported record type: link')), 'UNSUPPORTED_PLATFORM');
assert.strictEqual(helpers.categorizeSyncFailure({ code: 'UNKNOWN' }), 'SYNC_FAILED');
assert.strictEqual(helpers.sanitizeSyncNoteTitle('private\\vault\\safe-title.md'), 'safe-title');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  content: 'https://weixin.qq.com/sph/At8GEKn0cY',
  metadata: { conversionStatus: 'link_saved', transcriptionStatus: 'failed' },
}).code, 'UNSUPPORTED_PLATFORM');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    url: 'https://mp.weixin.qq.com/s/example',
    conversionStatus: 'success',
    markdown: '微信扫一扫可打开此内容，使用完整服务',
  },
}).code, 'EXTRACTION_FAILED');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'file',
  metadata: {
    fileExt: 'pdf',
    conversionStatus: 'attachment_saved',
    conversionError: 'PDF text missing',
  },
}).code, 'EXTRACTION_FAILED');
const detailedPdfFailure = helpers.getSyncLifecycleOutcomeError({
  type: 'file',
  metadata: {
    fileExt: 'pdf',
    conversionStatus: 'attachment_saved',
    conversionError: '扫描型 PDF 第 1 页没有文本层，且本地 OCR 未能识别。',
    pdfExtractionErrorCode: 'PDF_SCAN_OCR_REQUIRED',
    pdfExtractionDiagnostic: {
      provider: 'pdfjs-text-layer+local-ocr',
      pageCount: 2,
      textPageNumbers: [2],
      ocrPageNumbers: [],
      missingPageNumbers: [1],
    },
  },
});
assert.strictEqual(detailedPdfFailure.code, 'EXTRACTION_FAILED');
assert.strictEqual(
  detailedPdfFailure.message,
  '扫描型 PDF 第 1 页没有文本层，且本地 OCR 未能识别。',
  'PDF failures must preserve the concrete parser/OCR reason',
);
assert.deepStrictEqual(detailedPdfFailure.diagnostic, {
  kind: 'pdf-extraction',
  errorCode: 'PDF_SCAN_OCR_REQUIRED',
  provider: 'pdfjs-text-layer+local-ocr',
  pageCount: 2,
  textPageNumbers: [2],
  ocrPageNumbers: [],
  missingPageNumbers: [1],
});
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    url: 'https://www.toutiao.com/article/example',
    conversionStatus: 'success',
    markdown: '请先登录后查看完整内容\n打开今日头条查看更多',
  },
}).code, 'EXTRACTION_FAILED');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: { conversionStatus: 'link_saved', markdown: '原始链接已保存' },
}).code, 'EXTRACTION_FAILED');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: { conversionStatus: 'wechat_captcha', markdown: '完成验证后继续访问' },
}).code, 'EXTRACTION_FAILED');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: { conversionStatus: 'failed', transcriptionStatus: 'failed', transcription: '' },
}).code, 'TRANSCRIPTION_FAILED');
const detailedTranscriptionFailure = helpers.getSyncLifecycleOutcomeError({
  type: 'voice',
  metadata: {
    transcriptionStatus: 'failed',
    transcription: '',
    transcriptionError: 'HTTP 403: media URL expired',
  },
});
assert.strictEqual(detailedTranscriptionFailure.code, 'TRANSCRIPTION_FAILED');
assert.strictEqual(
  detailedTranscriptionFailure.message,
  'HTTP 403: media URL expired',
  'a concrete transcription error must not be replaced by a generic failure label',
);
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'file',
  metadata: { fileExt: 'zip', conversionStatus: 'attachment_saved' },
}), null);
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    conversionStatus: 'success',
    markdown: '正文完整保存，只是其中一张图片暂时无法本地化。',
    imageLocalizationFailedCount: 1,
    imageLocalizationError: 'one remote image unavailable',
  },
}), null);
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    conversionStatus: 'success',
    markdown: '这是已经成功提取的长正文。'.repeat(30),
    conversionError: '旧错误：暂不支持此平台',
  },
}), null);
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    url: 'https://example.com/normal-technical-article',
    conversionStatus: 'success',
    markdown: '这是一篇讨论正文提取失败诊断方法的正常技术长文。'.repeat(20),
  },
}), null);
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    conversionStatus: 'success',
    markdown: '',
    conversionError: '暂不支持此平台',
  },
}).code, 'UNSUPPORTED_PLATFORM');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    url: 'https://example.com/empty-success',
    conversionStatus: 'success',
    markdown: '',
  },
}).code, 'EXTRACTION_FAILED');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    url: 'https://www.toutiao.com/article/app-only',
    conversionStatus: 'success',
    markdown: '请在今日头条客户端内查看完整内容',
  },
}).code, 'EXTRACTION_FAILED');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    url: 'https://mp.weixin.qq.com/s/legacy-shell',
    conversionStatus: 'success',
    markdown: '\u89c6\u9891 \u5c0f\u7a0b\u5e8f \u8d5e \u8f7b\u70b9\u4e24\u4e0b\u53d6\u6d88\u8d5e \u5728\u770b',
  },
}).code, 'EXTRACTION_FAILED');
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'text',
  content: '收到',
  metadata: {},
}), null);
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: { conversionStatus: 'success', markdown: '一篇正常且可交付的正文' },
}), null);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'webpage',
  content: 'https://weixin.qq.com/sph/example',
}, [
  '---',
  'id: failed-receipt-1',
  'url: https://weixin.qq.com/sph/example',
  '---',
  '> ⚠️ 视频号内容解析功能暂未接通，当前已为你保存原始链接。',
].join('\n')), false);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'webpage',
  content: 'https://example.com/link-only',
}, [
  '---',
  'id: link-only-1',
  'url: https://example.com/link-only',
  '---',
  '原始链接：https://example.com/link-only',
].join('\n')), false);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'webpage',
  content: 'https://example.com/article',
}, '---\nid: article-1\n---\n这是一段已经成功提取并可保存到知识库的正文。'), true);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'text',
}, '---\nid: text-1\n---\n收到'), true);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'file',
  metadata: { fileExt: 'zip' },
}, '---\nid: file-1\n---\n本地附件：[[临时收集/文件附件/附件.zip]]'), true);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'file',
  metadata: { fileExt: 'png' },
}, '---\nid: file-2\n---\n文件名：截图.png\n\n图片已保存成功。'), false);
const douyinFailureReceipt = helpers.buildDouyinFallbackMarkdown(
  'https://v.douyin.com/example',
  '未找到可转写的视频资源',
);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'webpage',
  content: 'https://v.douyin.com/example',
}, douyinFailureReceipt), false);
const xiaohongshuFailureReceipt = helpers.buildXiaohongshuFallbackMarkdown(
  'https://www.xiaohongshu.com/explore/example',
);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'webpage',
  content: 'https://www.xiaohongshu.com/explore/example',
}, xiaohongshuFailureReceipt), false);
const wechatChannelsFailureReceipt = helpers.buildWechatChannelsUnavailableMarkdown(
  'https://weixin.qq.com/sph/example',
  { description: '这只是发布简介，不是可交付的转写正文。' },
  '视频号网页端没有返回真实视频地址',
);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'webpage',
  content: 'https://weixin.qq.com/sph/example',
}, wechatChannelsFailureReceipt), false);
assert.strictEqual(helpers.isExistingLocalNoteDeliverable({
  type: 'webpage',
  content: 'https://example.feishu.cn/docx/example',
}, [
  '飞书链接已保存。',
  '',
  '原始链接：https://example.feishu.cn/docx/example',
  '',
  '> 飞书正文提取失败：需要登录',
  '> 如果该链接在浏览器能无登录打开，可以后续接入浏览器剪藏助手把页面 DOM 直接转成 Markdown。',
].join('\n')), false);

const normalizedLifecycleAttempts = helpers.normalizePendingSyncLifecycleAttempts([
  {
    recordId: 'record-queue-1',
    attemptId: 'attempt-queue-old',
    bindingFingerprint: '0123456789abcdef',
    stage: 'processing',
    createdAt: '2026-08-11T01:00:00.000Z',
    token: 'SECRET-TOKEN',
    url: 'https://private.example/path',
    content: 'private body',
  },
  {
    recordId: 'record-queue-1',
    attemptId: 'attempt-queue-new',
    bindingFingerprint: '0123456789abcdef',
    stage: 'failed',
    code: 'WRITE_FAILED',
    updatedAt: '2026-08-11T02:00:00.000Z',
  },
  {
    recordId: '',
    attemptId: 'invalid-record',
    bindingFingerprint: '0123456789abcdef',
    stage: 'processing',
  },
]);
assert.deepStrictEqual(normalizedLifecycleAttempts, [{
  recordId: 'record-queue-1',
  attemptId: 'attempt-queue-new',
  bindingFingerprint: '0123456789abcdef',
  stage: 'failed',
  code: 'WRITE_FAILED',
  createdAt: '',
  updatedAt: '2026-08-11T02:00:00.000Z',
}]);
assert.doesNotMatch(JSON.stringify(normalizedLifecycleAttempts), /SECRET|private|url|content|token/i);
assert.strictEqual(helpers.normalizePendingSyncLifecycleAttempts(
  Array.from({ length: 120 }, (_, index) => ({
    recordId: `record-${index}`,
    attemptId: `attempt-${index}-valid`,
    bindingFingerprint: 'fedcba9876543210',
    stage: 'processing',
  })),
).length, 100);

const normalizedCompletedReceipts = helpers.normalizeCompletedSyncReceipts([
  {
    recordId: 'completed-record-1',
    bindingFingerprint: '0123456789abcdef',
    noteTitle: 'private\\vault\\safe-title.md',
    completedAt: '2026-08-11T03:00:00.000Z',
    token: 'SECRET-TOKEN',
    url: 'https://private.example/path',
    content: 'private body',
  },
]);
assert.deepStrictEqual(normalizedCompletedReceipts, [{
  recordId: 'completed-record-1',
  bindingFingerprint: '0123456789abcdef',
  noteTitle: 'safe-title',
  completedAt: '2026-08-11T03:00:00.000Z',
}]);
assert.doesNotMatch(JSON.stringify(normalizedCompletedReceipts), /SECRET|private|url|content|token/i);
assert.strictEqual(helpers.normalizeCompletedSyncReceipts(
  Array.from({ length: 520 }, (_, index) => ({
    recordId: `completed-record-${index}`,
    bindingFingerprint: 'fedcba9876543210',
    completedAt: '2026-08-11T03:00:00.000Z',
  })),
).length, 500);

const builtPluginSource = fs.readFileSync(path.join(
  __dirname,
  '../obsidian-plugin/wechat-inbox-sync/main.js',
), 'utf8');
const outcomeGateOffset = builtPluginSource.indexOf('getSyncLifecycleOutcomeError(recordForMarkdown)');
const aiEnrichmentOffset = builtPluginSource.indexOf('enrichRecordMetadataWithAi(recordForMarkdown');
const noteWriteOffset = builtPluginSource.indexOf('adapter.write(temporaryFilePath, markdown)');
assert.ok(outcomeGateOffset > 0, 'writeRecord must classify lifecycle outcome before writing a note');
assert.ok(outcomeGateOffset < aiEnrichmentOffset, 'outcome classification must run before AI enrichment');
assert.ok(outcomeGateOffset < noteWriteOffset, 'outcome classification must run before Markdown write');

function createPlugin() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'plugin-history-test',
  });
  plugin.showSyncProgress = () => {};
  plugin.findExistingRecordNotePath = async () => '';
  plugin.savedSettingsSnapshots = [];
  plugin.saveData = async (settings) => {
    plugin.savedSettingsSnapshots.push(JSON.parse(JSON.stringify(settings)));
  };
  return plugin;
}

async function runSupportedLifecycleSuccessTest() {
  const calls = [];
  const plugin = createPlugin();
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push({ path, method, body, token: binding && binding.token });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'history-plugin-success',
          type: 'text',
          content: '正文不得上传到状态接口',
          createdAt: '2026-08-07T01:00:00.000Z',
          metadata: { title: '安全标题' },
        }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-plugin-success/status') {
      return { success: true, data: { status: 'processing', attemptId: 'attempt-success-1' } };
    }
    if (path === '/records/history-plugin-success/synced') {
      return { success: true, data: {} };
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  plugin.writeRecord = async () => ({
    recordId: 'history-plugin-success',
    title: '安全标题',
    filePath: '私密知识库/临时收集/安全标题.md',
  });

  const result = await plugin.syncBinding({ token: 'ABC-123', label: '测试绑定' }, false);
  assert.strictEqual(result.failed.length, 0);
  assert.strictEqual(result.written.length, 1);
  assert.deepStrictEqual(calls.map((item) => item.path), [
    '/records?status=pending',
    '/records/history-plugin-success/status',
    '/records/history-plugin-success/synced',
  ]);
  assert.deepStrictEqual(calls[1].body, { status: 'processing' });
  assert.deepStrictEqual(calls[2].body, {
    attemptId: 'attempt-success-1',
    noteTitle: '安全标题',
  });
  assert.strictEqual(JSON.stringify(calls).includes('私密知识库'), false);
  assert.strictEqual(JSON.stringify(calls).includes('正文不得上传'), false);
  assert.strictEqual(JSON.stringify(calls).includes('metadata'), false);
  assert.ok(plugin.savedSettingsSnapshots.some((settings) => (
    Array.isArray(settings.pendingSyncLifecycleAttempts)
      && settings.pendingSyncLifecycleAttempts.some((item) => item.stage === 'processing')
  )));
  assert.deepStrictEqual(plugin.settings.pendingSyncLifecycleAttempts, []);
}

async function runNonDeletingCompletionAcknowledgementTest() {
  const plugin = createPlugin();
  plugin.requestJson = async (path, method, body) => {
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'history-plugin-non-deleting-ack',
          type: 'text',
          content: 'queue item must remain retryable when deletion is not confirmed',
          metadata: { title: '需要重试的笔记' },
        }],
      };
    }
    if (path === '/records/history-plugin-non-deleting-ack/synced') {
      return { success: true, data: { status: 'synced' } };
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  plugin.writeRecord = async () => ({
    recordId: 'history-plugin-non-deleting-ack',
    title: '需要重试的笔记',
    filePath: 'vault/需要重试的笔记.md',
  });

  const result = await plugin.syncBinding({ token: 'ABC-123' }, false);
  assert.strictEqual(result.written.length, 1);
  assert.strictEqual(result.completionWarnings.length, 1);
  assert.strictEqual(result.completionWarnings[0].recordId, 'history-plugin-non-deleting-ack');
  assert.strictEqual(result.completionWarnings[0].code, 'COMPLETION_REPORT_FAILED');
  assert.strictEqual(result.completionWarnings[0].serverCode, 'SYNC_COMPLETION_DELETE_UNCONFIRMED');
}

async function runLegacyResponseWithoutMetadataSendsTitleTest() {
  const calls = [];
  const plugin = createPlugin();
  plugin.requestJson = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'history-plugin-legacy-metadata',
          type: 'text',
          content: 'legacy response without lifecycle metadata',
          metadata: { title: '上传标题' },
        }],
      };
    }
    if (path === '/records/history-plugin-legacy-metadata/synced') return { success: true, data: {} };
    throw new Error(`unexpected request ${method} ${path}`);
  };
  plugin.writeRecord = async () => ({
    recordId: 'history-plugin-legacy-metadata',
    title: '实际 Obsidian 笔记',
    filePath: 'private-vault/实际 Obsidian 笔记.md',
  });

  const result = await plugin.syncBinding({ token: 'ABC-123' }, false);
  assert.strictEqual(result.failed.length, 0);
  assert.strictEqual(result.written.length, 1);
  assert.deepStrictEqual(calls.map((item) => item.path), [
    '/records?status=pending',
    '/records/history-plugin-legacy-metadata/synced',
  ]);
  assert.deepStrictEqual(calls[1].body, { noteTitle: '实际 Obsidian 笔记' });
}

async function runFailureLifecycleReportingTest() {
  const calls = [];
  const plugin = createPlugin();
  plugin.requestJson = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'history-plugin-failure',
          type: 'webpage',
          content: 'https://private.example.invalid/article',
          createdAt: '2026-08-07T01:00:00.000Z',
          metadata: { title: '失败标题' },
        }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-plugin-failure/status' && body.status === 'processing') {
      return { success: true, data: { status: 'processing', attemptId: 'attempt-failure-1' } };
    }
    if (path === '/records/history-plugin-failure/status' && body.status === 'failed') {
      return { success: true, data: { status: 'failed' } };
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  plugin.writeRecord = async () => {
    throw new Error('vault write failed: C:\\private\\vault\\secret.md token=TOP_SECRET');
  };

  const result = await plugin.syncBinding({ token: 'ABC-123', label: '测试绑定' }, false);
  assert.strictEqual(result.failed.length, 1);
  assert.match(result.failed[0].message, /vault write failed/);
  const failureCall = calls.find((item) => item.body && item.body.status === 'failed');
  assert.ok(failureCall);
  assert.deepStrictEqual(failureCall.body, {
    status: 'failed',
    attemptId: 'attempt-failure-1',
    code: 'WRITE_FAILED',
  });
  assert.strictEqual(JSON.stringify(failureCall.body).includes('TOP_SECRET'), false);
  assert.strictEqual(JSON.stringify(failureCall.body).includes('private'), false);
}

async function runLegacyFallbackAndConflictTest() {
  const fallbackCalls = [];
  const fallbackPlugin = createPlugin();
  fallbackPlugin.requestJson = async (path, method, body) => {
    fallbackCalls.push({ path, method, body });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'history-plugin-legacy',
          type: 'text',
          content: 'legacy body',
          createdAt: '2026-08-07T01:00:00.000Z',
          metadata: { title: '旧服务标题' },
        }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-plugin-legacy/status') {
      const error = new Error('status route unavailable');
      error.status = 404;
      throw error;
    }
    if (path === '/records/history-plugin-legacy/synced') return { success: true, data: {} };
    throw new Error(`unexpected request ${method} ${path}`);
  };
  fallbackPlugin.writeRecord = async () => ({
    recordId: 'history-plugin-legacy',
    title: '旧服务标题',
    filePath: 'private-vault/旧服务标题.md',
  });
  const fallbackResult = await fallbackPlugin.syncBinding({ token: 'ABC-123' }, false);
  assert.strictEqual(fallbackResult.written.length, 1);
  assert.deepStrictEqual(fallbackCalls.map((item) => item.path), [
    '/records?status=pending',
    '/records/history-plugin-legacy/status',
    '/records/history-plugin-legacy/synced',
  ]);
  assert.deepStrictEqual(fallbackCalls[2].body, { noteTitle: '旧服务标题' });

  const conflictCalls = [];
  const conflictPlugin = createPlugin();
  conflictPlugin.requestJson = async (path, method, body) => {
    conflictCalls.push({ path, method, body });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{ _id: 'history-plugin-busy', type: 'text', content: 'busy', metadata: {} }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-plugin-busy/status') {
      const error = new Error('record busy');
      error.status = 409;
      error.code = 'RECORD_BUSY';
      throw error;
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  let writeCalled = false;
  conflictPlugin.writeRecord = async () => {
    writeCalled = true;
    throw new Error('must not write while another device owns the lease');
  };
  const conflictResult = await conflictPlugin.syncBinding({ token: 'ABC-123' }, false);
  assert.strictEqual(writeCalled, false);
  assert.strictEqual(conflictResult.failed.length, 0);
  assert.deepStrictEqual(conflictResult.skipped, [{
    recordId: 'history-plugin-busy',
    reason: 'record-busy',
  }]);
  assert.strictEqual(conflictCalls.some((item) => item.path.includes('/synced')), false);
}

async function runFailureReportFailurePreservesOriginalErrorTest() {
  const plugin = createPlugin();
  plugin.requestJson = async (path, method, body) => {
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{ _id: 'history-plugin-report-failure', type: 'text', content: '正文', metadata: {} }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-plugin-report-failure/status' && body.status === 'processing') {
      return { success: true, data: { attemptId: 'attempt-report-failure' } };
    }
    if (path === '/records/history-plugin-report-failure/status' && body.status === 'failed') {
      const error = new Error('server unavailable');
      error.status = 503;
      throw error;
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  plugin.writeRecord = async () => {
    throw new Error('original local write error');
  };
  const result = await plugin.syncBinding({ token: 'ABC-123' }, false);
  assert.strictEqual(result.failed.length, 1);
  assert.strictEqual(result.failed[0].message, 'original local write error');
  assert.deepStrictEqual(result.failed[0].lifecycleReportError, {
    code: 'STATUS_REPORT_FAILED',
    message: 'status report failed; original error remains local',
  });
  assert.strictEqual(plugin.settings.pendingSyncLifecycleAttempts.length, 1);
  assert.strictEqual(plugin.settings.pendingSyncLifecycleAttempts[0].stage, 'failed');
  assert.strictEqual(plugin.settings.pendingSyncLifecycleAttempts[0].code, 'WRITE_FAILED');
}

async function runCompletionReportFailurePreservesLocalWriteTest() {
  const calls = [];
  const plugin = createPlugin();
  plugin.requestJson = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{ _id: 'history-plugin-completion-failure', type: 'text', content: 'safe', metadata: {} }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-plugin-completion-failure/status') {
      if (body.status === 'processing') return { success: true, data: { attemptId: 'attempt-completion-failure' } };
      throw new Error('failed status must not be reported after local write');
    }
    if (path === '/records/history-plugin-completion-failure/synced') {
      const error = new Error('completion acknowledgement unavailable');
      error.status = 503;
      throw error;
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  plugin.writeRecord = async () => ({
    recordId: 'history-plugin-completion-failure',
    title: 'safe title',
    filePath: 'private-vault/safe title.md',
  });

  const result = await plugin.syncBinding({ token: 'ABC-123' }, false);
  assert.strictEqual(result.failed.length, 0);
  assert.strictEqual(result.written.length, 1);
  assert.deepStrictEqual(result.completionWarnings, [{
    recordId: 'history-plugin-completion-failure',
    code: 'COMPLETION_REPORT_FAILED',
    status: 503,
    message: 'sync completion report failed (HTTP 503); local note is preserved',
  }]);
  assert.strictEqual(calls.some((item) => item.body && item.body.status === 'failed'), false);
  assert.strictEqual(plugin.settings.pendingSyncLifecycleAttempts.length, 1);
  assert.strictEqual(plugin.settings.pendingSyncLifecycleAttempts[0].stage, 'committed');
  assert.strictEqual(plugin.settings.pendingSyncLifecycleAttempts[0].noteTitle, 'safe title');
  assert.deepStrictEqual(plugin.settings.completedSyncReceipts, [{
    recordId: 'history-plugin-completion-failure',
    bindingFingerprint: helpers.getSyncLifecycleBindingFingerprint('ABC-123'),
    noteTitle: 'safe title',
    completedAt: plugin.settings.completedSyncReceipts[0].completedAt,
  }]);
}

async function runCompletedReceiptPreventsRepeatWriteTest() {
  const plugin = createPlugin();
  const binding = { token: 'ABC-123', label: 'test binding' };
  plugin.findExistingRecordNotePath = async () => 'Inbox/previously saved note.md';
  plugin.settings.completedSyncReceipts = helpers.normalizeCompletedSyncReceipts([{
    recordId: 'history-repeat-record',
    bindingFingerprint: helpers.getSyncLifecycleBindingFingerprint(binding.token),
    noteTitle: 'previously saved note',
    completedAt: '2026-08-11T03:00:00.000Z',
  }]);
  const calls = [];
  plugin.requestJson = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'history-repeat-record',
          type: 'webpage',
          content: 'https://private.example.invalid/repeated',
          metadata: { title: 'old record returned again' },
        }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-repeat-record/status') {
      return { success: true, data: { attemptId: 'attempt-repeat-record' } };
    }
    if (path === '/records/history-repeat-record/synced') return { success: true, data: {} };
    throw new Error(`unexpected request ${method} ${path}`);
  };
  let writeCalled = false;
  plugin.writeRecord = async () => {
    writeCalled = true;
    throw new Error('a completed cloud record must not be written again');
  };

  const result = await plugin.syncBinding(binding, false);

  assert.strictEqual(writeCalled, false);
  assert.deepStrictEqual(result.skipped, [{
    recordId: 'history-repeat-record',
    reason: 'already-committed-local-receipt',
  }]);
  assert.deepStrictEqual(result.completionWarnings, []);
  assert.strictEqual(calls.some((item) => item.path.endsWith('/synced')), true);
}

async function runCompletionWarningIsVisibleTest() {
  notices.splice(0, notices.length);
  const plugin = createPlugin();
  plugin.getActiveBindings = () => [{ token: 'ABC-123', label: '测试绑定' }];
  plugin.syncBinding = async () => ({
    written: [{ recordId: 'completion-warning-visible', title: 'safe title' }],
    failed: [],
    skipped: [],
    conversionWarnings: [],
    completionWarnings: [{
      recordId: 'completion-warning-visible',
      code: 'COMPLETION_REPORT_FAILED',
      message: 'sync completion report failed; local note is preserved',
    }],
    pendingReview: {},
  });
  plugin.clearSyncProgressNotice = () => {};
  plugin.getConfiguredLocalAsrInstallRoot = () => '';

  await plugin.runSyncInboxOnce(true);

  assert.ok(notices.some((message) => message.includes('本地笔记已保存')));
  assert.ok(notices.some((message) => message.includes('同步状态回报失败')));
  assert.match(plugin.lastSyncDiagnostic.message, /同步状态回报失败/);
  assert.strictEqual(plugin.lastSyncDiagnostic.completionWarningCount, 1);
  assert.deepStrictEqual(plugin.lastSyncDiagnostic.completionWarningDetails, [{
    recordId: 'completion-warning-visible',
    code: 'COMPLETION_REPORT_FAILED',
    reason: 'request failed',
  }]);
}


async function runRequestJsonPreservesHttpStatusTest() {
  const plugin = createPlugin();
  requestUrlMock = async () => ({
    status: 404,
    json: { errMsg: 'status route unavailable' },
    text: JSON.stringify({ errMsg: 'status route unavailable' }),
  });

  await assert.rejects(
    () => plugin.requestJson('/records/status-test/status', 'POST', { status: 'processing' }),
    (error) => error && error.status === 404 && error.statusCode === 404,
  );
}

async function runFailedReceiptDoesNotTriggerLocalDedupeTest() {
  const plugin = createPlugin();
  delete plugin.findExistingRecordNotePath;
  plugin.settings.inboxDir = '临时收集';
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: '临时收集/2026-08-11/视频号-失败占位.md' }],
      cachedRead: async () => [
        '---',
        'id: failed-local-note-1',
        'url: https://weixin.qq.com/sph/example',
        '---',
        '> ⚠️ 视频号内容解析功能暂未接通，当前已为你保存原始链接。',
      ].join('\n'),
    },
  };

  const found = await plugin.findExistingRecordNotePath({
    _id: 'failed-local-note-1',
    type: 'webpage',
    content: 'https://weixin.qq.com/sph/example',
    metadata: { url: 'https://weixin.qq.com/sph/example' },
  });
  assert.strictEqual(found, '');
}

async function runDeliverableExistingNoteTriggersLocalDedupeTest() {
  const plugin = createPlugin();
  delete plugin.findExistingRecordNotePath;
  plugin.settings.inboxDir = '临时收集';
  const expectedPath = '临时收集/2026-08-11/公众号-正常文章.md';
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: expectedPath }],
      cachedRead: async () => [
        '---',
        'id: valid-local-note-1',
        'url: https://mp.weixin.qq.com/s/example',
        '---',
        '这是一篇已经完整提取并成功写入知识库的公众号文章正文。'.repeat(8),
      ].join('\n'),
    },
  };

  const found = await plugin.findExistingRecordNotePath({
    _id: 'valid-local-note-1',
    type: 'webpage',
    content: 'https://mp.weixin.qq.com/s/example',
    metadata: { url: 'https://mp.weixin.qq.com/s/example' },
  });
  assert.strictEqual(found, expectedPath);
}

async function runCommittedPersistenceFailureDoesNotReverseSuccessTest() {
  const calls = [];
  const plugin = createPlugin();
  plugin.requestJson = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{ _id: 'history-committed-persist-failure', type: 'text', content: '正文', metadata: {} }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-committed-persist-failure/status' && body.status === 'processing') {
      return { success: true, data: { attemptId: 'attempt-committed-persist-failure' } };
    }
    if (path === '/records/history-committed-persist-failure/synced') {
      return { success: true, data: {} };
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  plugin.writeRecord = async () => ({
    recordId: 'history-committed-persist-failure',
    title: '已经写入的正文',
    filePath: '临时收集/已经写入的正文.md',
    committed: true,
  });
  const originalUpsert = plugin.upsertPendingSyncLifecycleAttempt.bind(plugin);
  plugin.upsertPendingSyncLifecycleAttempt = async (binding, value) => {
    if (value.stage === 'committed') throw new Error('saveData unavailable after commit');
    return await originalUpsert(binding, value);
  };

  const result = await plugin.syncBinding({ token: 'ABC-123' }, false);
  assert.strictEqual(result.written.length, 1);
  assert.strictEqual(result.failed.length, 0);
  assert.deepStrictEqual(result.completionWarnings, []);
  assert.strictEqual(calls.some((item) => item.body && item.body.status === 'failed'), false);
  assert.strictEqual(calls.some((item) => item.path.endsWith('/synced')), true);
}

async function runCompletionClearFailureDoesNotReverseSuccessTest() {
  const calls = [];
  const plugin = createPlugin();
  plugin.requestJson = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{ _id: 'history-completion-clear-failure', type: 'text', content: '正文', metadata: {} }],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (path === '/records/history-completion-clear-failure/status' && body.status === 'processing') {
      return { success: true, data: { attemptId: 'attempt-completion-clear-failure' } };
    }
    if (path === '/records/history-completion-clear-failure/synced') {
      return { success: true, data: {} };
    }
    throw new Error(`unexpected request ${method} ${path}`);
  };
  plugin.writeRecord = async () => ({
    recordId: 'history-completion-clear-failure',
    title: '清理失败但已完成',
    filePath: '临时收集/清理失败但已完成.md',
    committed: true,
  });
  plugin.clearPendingSyncLifecycleAttempt = async () => {
    throw new Error('saveData unavailable while clearing');
  };

  const result = await plugin.syncBinding({ token: 'ABC-123' }, false);
  assert.strictEqual(result.written.length, 1);
  assert.strictEqual(result.failed.length, 0);
  assert.deepStrictEqual(result.completionWarnings, [{
    recordId: 'history-completion-clear-failure',
    code: 'RECOVERY_MARKER_CLEAR_FAILED',
    message: 'sync completion is confirmed; stale recovery marker may be replayed safely',
  }]);
  assert.strictEqual(calls.some((item) => item.body && item.body.status === 'failed'), false);
}

async function runPendingLifecycleReplayTest() {
  const plugin = createPlugin();
  const binding = { token: 'ABC-123', label: '测试微信' };
  const bindingFingerprint = helpers.getSyncLifecycleBindingFingerprint(binding.token);
  plugin.settings.pendingSyncLifecycleAttempts = [{
    recordId: 'replay-processing',
    attemptId: 'attempt-processing-1',
    bindingFingerprint,
    stage: 'processing',
  }, {
    recordId: 'replay-failed',
    attemptId: 'attempt-failed-1',
    bindingFingerprint,
    stage: 'failed',
    code: 'EXTRACTION_FAILED',
  }, {
    recordId: 'replay-committed',
    attemptId: 'attempt-committed-1',
    bindingFingerprint,
    stage: 'committed',
    noteTitle: '已写入笔记',
  }];
  const calls = [];
  plugin.requestJson = async (path, method, body) => {
    calls.push({ path, method, body });
    return { success: true, data: {} };
  };

  await plugin.replayPendingSyncLifecycleAttempts(binding);

  assert.deepStrictEqual(calls, [{
    path: '/records/replay-processing/status',
    method: 'POST',
    body: { status: 'failed', attemptId: 'attempt-processing-1', code: 'SYNC_INTERRUPTED' },
  }, {
    path: '/records/replay-failed/status',
    method: 'POST',
    body: { status: 'failed', attemptId: 'attempt-failed-1', code: 'EXTRACTION_FAILED' },
  }, {
    path: '/records/replay-committed/synced',
    method: 'POST',
    body: { attemptId: 'attempt-committed-1', noteTitle: '已写入笔记' },
  }]);
  assert.deepStrictEqual(plugin.settings.pendingSyncLifecycleAttempts, []);
}

async function runPendingLifecycleReplayNetworkRetentionTest() {
  const plugin = createPlugin();
  const binding = { token: 'ABC-123' };
  plugin.settings.pendingSyncLifecycleAttempts = [{
    recordId: 'replay-network',
    attemptId: 'attempt-network-1',
    bindingFingerprint: helpers.getSyncLifecycleBindingFingerprint(binding.token),
    stage: 'failed',
    code: 'NETWORK_FAILED',
  }];
  plugin.requestJson = async () => {
    const error = new Error('network unavailable');
    error.status = 503;
    throw error;
  };

  await plugin.replayPendingSyncLifecycleAttempts(binding);

  assert.strictEqual(plugin.settings.pendingSyncLifecycleAttempts.length, 1);
  assert.strictEqual(plugin.settings.pendingSyncLifecycleAttempts[0].recordId, 'replay-network');
}

async function runPendingLifecycleReplayTerminalCleanupTest() {
  for (const status of [404, 405, 409]) {
    const plugin = createPlugin();
    const binding = { token: 'ABC-123' };
    plugin.settings.pendingSyncLifecycleAttempts = [{
      recordId: `replay-terminal-${status}`,
      attemptId: `attempt-terminal-${status}`,
      bindingFingerprint: helpers.getSyncLifecycleBindingFingerprint(binding.token),
      stage: 'committed',
      noteTitle: '已经写入的笔记',
    }];
    plugin.requestJson = async () => {
      const error = new Error(`terminal status ${status}`);
      error.status = status;
      if (status === 409) error.code = 'RECORD_BUSY';
      throw error;
    };

    await plugin.replayPendingSyncLifecycleAttempts(binding);

    assert.deepStrictEqual(plugin.settings.pendingSyncLifecycleAttempts, []);
  }
}

Promise.resolve()
  .then(runSupportedLifecycleSuccessTest)
  .then(runNonDeletingCompletionAcknowledgementTest)
  .then(runLegacyResponseWithoutMetadataSendsTitleTest)
  .then(runFailureLifecycleReportingTest)
  .then(runLegacyFallbackAndConflictTest)
  .then(runFailureReportFailurePreservesOriginalErrorTest)
  .then(runCompletionReportFailurePreservesLocalWriteTest)
  .then(runCompletedReceiptPreventsRepeatWriteTest)
  .then(runCompletionWarningIsVisibleTest)
  .then(runRequestJsonPreservesHttpStatusTest)
  .then(runFailedReceiptDoesNotTriggerLocalDedupeTest)
  .then(runDeliverableExistingNoteTriggersLocalDedupeTest)
  .then(runCommittedPersistenceFailureDoesNotReverseSuccessTest)
  .then(runCompletionClearFailureDoesNotReverseSuccessTest)
  .then(runPendingLifecycleReplayTest)
  .then(runPendingLifecycleReplayNetworkRetentionTest)
  .then(runPendingLifecycleReplayTerminalCleanupTest)
  .then(() => console.log('plugin-sync-history tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
