'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const { selectFailureDetail, failureMessage, observedFailureStage, reportedFailureDetail } = require('../obsidian-plugin/wechat-inbox-sync/src/failure-reason-utils');
const { normalizeDiagnosticEvent } = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'obsidian') return { Plugin: class {}, Modal: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {} };
  return originalLoad.call(this, name, ...args);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main.js');
Module._load = originalLoad;
const plugin = new Plugin(); plugin.settings = {};
plugin.queueSyncDiagnosticEvent = event => normalizeDiagnosticEvent({ ...event, eventId: 'evt-test',
  pluginVersion: '1.3.217', platform: 'windows', occurredAt: '2026-11-02T00:00:00Z' });
function queue(error) { return plugin.queueSyncDiagnosticFailure({ error, recordId: 'record-test',
  attemptId: 'attempt-test-01', diagnosticId: 'diagnostic-test', binding: { token: 'synthetic-only' }, stage: 'processing' }); }
const nested = code => ({ code: 'EXTRACTION_FAILED', diagnostic: { source: 'douyin-resolution',
  failureCode: code, failure: { code, stage: 'prepare' }, outcome: 'failed' } });
const pro = queue(nested('PRO_REQUIRED'));
const redirect = { code: 'XIAOHONGSHU_EXTERNAL_REDIRECT_BLOCKED' };
assert.equal(queue(redirect).errorCode, redirect.code);
assert.match(failureMessage(redirect), /非小红书网站/);
assert.doesNotMatch(failureMessage(redirect), /未取得这条/);
assert.equal(pro.errorCode, 'PRO_REQUIRED'); assert.equal(pro.errorType, 'EXTRACTION_FAILED'); assert.equal(pro.stage, 'fetch');
assert.match(failureMessage(nested('PRO_REQUIRED')), /不要重复购买/);
assert.doesNotMatch(failureMessage(nested('PRO_REQUIRED')), /已过期|未开通/);
const timeout = queue(nested('NODE_HTTP_TIMEOUT'));
assert.equal(timeout.errorCode, 'NODE_HTTP_TIMEOUT'); assert.equal(timeout.stage, 'fetch');
assert.equal(queue({ code: 'EXTRACTION_FAILED', diagnostic: { failureCode: 'TOKEN=private' } }).errorCode, 'EXTRACTION_FAILED');
assert.equal(selectFailureDetail({ ...nested('PRO_REQUIRED'), code: 'CLOUD_FALLBACK_FAILED' }), 'CLOUD_FALLBACK_FAILED');
assert.equal(observedFailureStage({ ...nested('PRO_REQUIRED'), code: 'CLOUD_FALLBACK_FAILED' }, 'sync'), 'sync');
assert.match(failureMessage({ code: 'CLOUD_FALLBACK_FAILED' }), /无需因此重装/);
assert.equal(selectFailureDetail({ code: 'PLUGIN_VERSION_MISMATCH', diagnostic: { failureCode: 'PRO_REQUIRED' } }), 'PLUGIN_VERSION_MISMATCH');
assert.equal(queue({ code: 'PLUGIN_VERSION_MISMATCH' }).errorCode, 'PLUGIN_VERSION_MISMATCH');
assert.equal(selectFailureDetail({ code: 'ENOENT', syscall: 'open' }), '', 'write ENOENT cannot imply ASR missing');
assert.equal(selectFailureDetail({ message: 'PRO_REQUIRED token=secret', diagnostic: { previous: { code: 'PRO_REQUIRED' } } }), '');
assert.equal(queue({ code: 'PRO_REQUIRED' }).errorType, 'SYNC_FAILED', 'specific code is not a new lifecycle category');
const report = { kind: 'sync_failure', text: JSON.stringify({ schemaVersion: 1, kind: 'sync_failure', failure: {
  code: 'EXTRACTION_FAILED', mediaResolutionDiagnostic: nested('PRO_REQUIRED').diagnostic } }) };
assert.equal(reportedFailureDetail({ technicalReport: report }), 'PRO_REQUIRED');
assert.equal(reportedFailureDetail({ technicalReport: { ...report, truncated: true } }), '');
assert.equal(reportedFailureDetail({ technicalReport: { ...report, text: '{broken' } }), '');
assert.equal(reportedFailureDetail({ outcome: 'succeeded', technicalReport: report }), '');
assert.equal(reportedFailureDetail({ technicalReport: { ...report, text: ' '.repeat(128*1024+1) } }), '');
assert.equal(reportedFailureDetail({ technicalReport: { ...report, text: JSON.stringify({ schemaVersion: 1, kind: 'sync_failure', previous: { failure: { code: 'PRO_REQUIRED' } } }) } }), '');
console.log('failure reason: nested code, built bundle hook, reporter, privacy, cloud/local separation and legacy report passed');
