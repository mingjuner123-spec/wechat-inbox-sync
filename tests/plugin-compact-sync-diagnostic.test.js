'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const {
  MAX_COMPACT_DIAGNOSTIC_BYTES,
  formatCompactSyncDiagnostic,
} = require('../obsidian-plugin/wechat-inbox-sync/src/compact-sync-diagnostic');
const { redactKnownCredentials } = require('../obsidian-plugin/wechat-inbox-sync/src/diagnostic-redaction-utils');
const { sanitizeSourceLink } = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');

const success = formatCompactSyncDiagnostic({ failure: { status: 'success', message: 'saved' } });
assert.match(success, /当前没有失败中的同步记录/);
assert.doesNotMatch(success, /saved/);
assert.match(formatCompactSyncDiagnostic({ failure: { status: 'running' } }), /尚无本次失败记录；转写仍进行中/);

const settings = { token: 'private-token-123' };
const safeFailure = {
  status: 'failed',
  time: '2026-10-07T10:00:00.000Z',
  stage: 'download',
  recordId: 'record-42',
  diagnosticId: 'diag-abc',
  error: redactKnownCredentials('request failed with private-token-123', settings),
  sourceUrl: sanitizeSourceLink('https://example.com/watch?v=1&access_token=secret#private'),
};
const safeText = formatCompactSyncDiagnostic({
  failure: safeFailure,
  version: '1.3.181',
  system: 'win32 x64 test-release',
  installStatus: 'ASR 可用；OCR 不可用',
});
assert.match(safeText, /record-42/);
assert.match(safeText, /diag-abc/);
assert.match(safeText, /https:\/\/example\.com\/watch\?v=1/);
assert.doesNotMatch(safeText, /private-token-123|access_token|secret|#private/);

const huge = formatCompactSyncDiagnostic({
  failure: { ...safeFailure, error: '超长错误'.repeat(10000) },
  maxBytes: MAX_COMPACT_DIAGNOSTIC_BYTES,
});
assert.ok(Buffer.byteLength(huge, 'utf8') <= MAX_COMPACT_DIAGNOSTIC_BYTES);
assert.match(huge, /\[诊断内容已截断\]/);
assert.match(huge, /record-42/);
assert.match(huge, /https:\/\/example\.com\/watch\?v=1/);

console.log('plugin compact sync diagnostic tests passed');

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') return {
    Modal: class Modal {}, Notice: class Notice {}, Plugin: class Plugin {},
    PluginSettingTab: class PluginSettingTab {}, Setting: class Setting {}, requestUrl: async () => ({}),
  };
  return originalLoad.call(this, request, parent, isMain);
};
let PluginClass;
try {
  PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
} finally {
  Module._load = originalLoad;
}

(async () => {
  const plugin = Object.create(PluginClass.prototype);
  plugin.settings = { token: 'local-secret-456' };
  plugin.manifest = { version: '1.3.181' };
  plugin.lastSyncDiagnostic = {
    status: 'failed',
    stage: 'finished',
    error: 'poll summary failure',
    syncSnapshots: [
      { records: [{ recordId: 'success-record-1', status: 'success' }] },
      { records: [{ recordId: 'failed-record-2', status: 'failed' }] },
    ],
    failureDetails: [
      { recordId: 'success-record-1', message: 'successful content must stay out' },
      { recordId: 'failed-record-2', message: 'failure includes local-secret-456', stage: 'download', failedAt: '2026-10-07T10:30:00.000Z', diagnosticId: 'diagnostic-2', sourceUrl: 'https://example.com/watch?id=2&token=remote-secret' },
    ],
  };
  plugin.getConfiguredLocalAsrPlatform = () => 'win32';
  plugin.getConfiguredLocalAsrInstallRoot = () => 'C:\\private\\asr';
  plugin.getConfiguredLocalOcrInstallRoot = () => 'C:\\private\\ocr';
  plugin.getLocalAsrInstallStatus = () => ({ ready: true });
  plugin.getLocalOcrInstallStatus = () => ({ ready: false });
  let copied = '';
  plugin.copyDiagnosticText = async text => { copied = text; return true; };
  await plugin.copyCompactSyncDiagnosticText();
  assert.match(copied, /failed-record-2/);
  assert.match(copied, /diagnostic-2/);
  assert.match(copied, /发生时间：2026-10-07T10:30:00.000Z/);
  assert.match(copied, /阶段：download/);
  assert.match(copied, /https:\/\/example\.com\/watch\?id=2/);
  assert.doesNotMatch(copied, /success-record-1|successful content must stay out|local-secret-456|remote-secret|token=/);
  const mainSource = fs.readFileSync(require.resolve('../obsidian-plugin/wechat-inbox-sync/src/main.js'), 'utf8');
  assert.ok(mainSource.includes('...(diagnosticSourceUrl ? { sourceUrl: diagnosticSourceUrl } : {}),'));
  assert.ok(mainSource.includes('...(item.failedAt ? { failedAt: item.failedAt } : {}),'));
  assert.ok(mainSource.includes('...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),'));
  console.log('actual plugin compact diagnostic method test passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
