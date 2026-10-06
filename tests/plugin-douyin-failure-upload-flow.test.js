'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-failure-upload-'));
const originalLoad = Module._load;
let requestUrl = async () => ({ status: 200, url: 'https://www.douyin.com/', text: '<html><title>抖音</title></html>' });
Module._load = function patchedLoad(id, parent, isMain) {
  if (id === 'obsidian') return {
    App: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
    Modal: class {}, Notice: class {}, TFile: class {},
    normalizePath: value => String(value || '').replace(/\\/g, '/'),
    requestUrl: (...args) => requestUrl(...args), MarkdownRenderer: {},
  };
  if (String(id).endsWith('.ps1') || String(id).endsWith('.sh') || String(id).endsWith('.py')) return '';
  if (id === 'electron') return { remote: { session: { fromPartition: () => ({ cookies: { get: async () => [] } }) } } };
  return originalLoad.call(this, id, parent, isMain);
};

const Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');
const reporter = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');

async function run() {
  try {
    const sourceUrl = 'https://v.douyin.com/fixture-shortlink/?token=PRIVATE_TOKEN';
    const plugin = new Plugin();
    plugin.settings = { inboxDir: 'Inbox', noteSaveMode: 'root', notePropertyFields: [], aiProvider: 'off' };
    plugin.app = { vault: { adapter: {} } };
    plugin.showSyncProgress = () => {};
    plugin.ensureFolder = async () => {};
    plugin.nextRecordTitle = async () => '短链解析失败';
    plugin.saveSourceMediaAttachment = async record => record;
    plugin.getConfiguredLocalAsrInstallRoot = () => scratch;
    plugin.getLocalDouyinResolverInstallStatus = () => ({ ready: true });
    plugin.getActiveBindings = () => [];
    plugin.checkDouyinLogin = async () => true;
    plugin.fetchDouyinMediaResolutionWithSession = async () => ({ mediaUrls: [], stages: [] });
    plugin.renderSocialMediaUrls = async () => [];
    plugin.resolveDouyinMediaWithLocalResolver = async () => ({
      mediaUrls: [], resolverVersion: 'fixture-1.2', code: 'DOUYIN_UNSUPPORTED_URL',
      error: 'Unsupported URL: https://www.douyin.com/video/123?token=PRIVATE_TOKEN',
      technicalMessage: 'Unsupported URL: https://www.douyin.com/video/123?token=[REDACTED]',
    });

    const originalRecord = {
      _id: 'fixture-record', type: 'webpage', createdAt: new Date().toISOString(),
      content: sourceUrl, metadata: { url: sourceUrl, webpageMediaType: 'audio_video' },
    };
    let capturedError;
    await assert.rejects(plugin.writeRecord(originalRecord, new Date().toISOString()), error => {
      capturedError = error;
      return error.code === 'TRANSCRIPTION_FAILED';
    });
    assert.ok(capturedError.diagnostic, 'writeRecord should propagate the resolver trace from hydrated metadata');
    assert.equal(capturedError.diagnostic.source.host, 'v.douyin.com');
    assert.equal(capturedError.diagnostic.sourceKind, 'shortlink');
    assert.equal(capturedError.diagnostic.resolverVersion, 'fixture-1.2');
    assert.ok(capturedError.diagnostic.stages.some(stage => stage.stage === 'local-yt-dlp' && stage.error.code === 'DOUYIN_UNSUPPORTED_URL'));

    let normalizedEvent;
    plugin.queueSyncDiagnosticEvent = event => {
      normalizedEvent = reporter.normalizeDiagnosticEvent(event, { now: new Date().toISOString() });
      return { queued: true };
    };
    const queued = plugin.queueSyncDiagnosticFailure({
      recordId: 'fixture-record', attemptId: 'fixture-attempt', diagnosticId: 'fixture-diagnostic',
      binding: { token: 'test-binding-token' }, error: capturedError, stage: 'processing', retryCount: 0,
      sourceUrl,
    });
    assert.equal(queued.queued, true);
    assert.equal(normalizedEvent.sourceUrl, 'https://v.douyin.com/fixture-shortlink/');
    const report = JSON.parse(normalizedEvent.technicalReport.text);
    assert.equal(report.failure.mediaResolutionDiagnostic.source, 'unknown');
    assert.equal(report.failure.mediaResolutionDiagnostic.resolverVersion, 'fixture-1.2');
    assert.equal(report.failure.mediaResolutionDiagnostic.failureCode, 'DOUYIN_UNSUPPORTED_URL');
    assert.ok(report.failure.mediaResolutionDiagnostic.stages.some(stage => stage.stage === 'local-yt-dlp' && stage.error.code === 'DOUYIN_UNSUPPORTED_URL'));
    assert.doesNotMatch(JSON.stringify(normalizedEvent), /PRIVATE_TOKEN|test-binding-token/);
    console.log('plugin-douyin-failure-upload-flow.test.js passed');
  } finally {
    Module._load = originalLoad;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
