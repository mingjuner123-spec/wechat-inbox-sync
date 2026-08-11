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
  type: 'text',
  content: '收到',
  metadata: {},
}), null);
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: { conversionStatus: 'success', markdown: '一篇正常且可交付的正文' },
}), null);

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
    message: 'sync completion report failed; local note is preserved',
  }]);
  assert.strictEqual(calls.some((item) => item.body && item.body.status === 'failed'), false);
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

Promise.resolve()
  .then(runSupportedLifecycleSuccessTest)
  .then(runFailureLifecycleReportingTest)
  .then(runLegacyFallbackAndConflictTest)
  .then(runFailureReportFailurePreservesOriginalErrorTest)
  .then(runCompletionReportFailurePreservesLocalWriteTest)
  .then(runCompletionWarningIsVisibleTest)
  .then(runRequestJsonPreservesHttpStatusTest)
  .then(() => console.log('plugin-sync-history tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
