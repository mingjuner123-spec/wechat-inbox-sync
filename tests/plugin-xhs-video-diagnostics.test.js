'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { EventEmitter } = require('events');
const diagnostic = require('../obsidian-plugin/wechat-inbox-sync/src/xiaohongshu-diagnostic-utils');
const asr = require('../obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils');
const noteUrl = 'https://www.xiaohongshu.com/explore/abcdef0123456789abcdef01';
const mediaUrl = 'https://sns-video-v6.xhscdn.com/stream/test-video.mp4';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-video-diagnostic-'));
let responseHtml = '';
let injectedError = null;
let loginResponse = 'timeout';
let networkStatus = 0;
const scripts = [];
const requestHandlers = {};
const session = { cookies: { get: async () => [{ name: 'web_session', value: 'SYNTHETIC_SESSION' }] }, webRequest: Object.fromEntries(['onBeforeRequest', 'onBeforeRedirect', 'onCompleted', 'onErrorOccurred'].map(name => [name, (_filter, listener) => { requestHandlers[name] = listener; }])) };
class BrowserWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = new EventEmitter();
    Object.assign(this.webContents, {
      session, setWindowOpenHandler() {}, isDestroyed: () => false,
      executeJavaScript: async script => {
        scripts.push(script);
        // Parse AND run the exact bundle-generated program, not a copy of it.
        const compiled = new vm.Script(script, { filename: 'xhs-injected.js' });
        if (injectedError) throw injectedError;
        const video = { tagName: 'VIDEO', currentSrc: mediaUrl, src: mediaUrl, play: async () => {}, getAttribute: () => '', querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100 }) };
        const context = {
          URL, URLSearchParams, AbortController,
          setTimeout: callback => setTimeout(callback, 1), clearTimeout,
          document: { body: { innerText: '已登录的公开内容' }, documentElement: null, scripts: [], querySelector: selector => selector.includes('user/profile') ? {} : null, querySelectorAll: selector => selector === 'video, audio, source' || selector === 'video, audio' ? [video] : [] },
          location: { href: noteUrl }, performance: { getEntriesByType: () => [] }, self: {},
          window: { innerWidth: 1000, innerHeight: 1000, getComputedStyle: () => ({}) },
          fetch: async () => {
            if (loginResponse === 'timeout') return new Promise(() => {});
            return { ok: ['ok', 'business-denied'].includes(loginResponse), status: ['ok', 'business-denied'].includes(loginResponse) ? 200 : 403, json: async () => {
              if (loginResponse === 'malformed-denied') throw new SyntaxError('Non-JSON error page');
              if (loginResponse === 'hanging-denied') return new Promise(() => {});
              return loginResponse === 'ok' ? { data: { user_id: 'synthetic' } } : { code: -100 };
            } };
          },
        };
        return compiled.runInNewContext(context);
      },
    });
  }
  loadURL() {
    setImmediate(() => {
      if (networkStatus) {
        requestHandlers.onBeforeRequest?.({ url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?xsec_token=BLOCK_SECRET', resourceType: 'xhr' }, result => assert.deepStrictEqual(result, { cancel: true }));
        requestHandlers.onCompleted?.({ url: noteUrl + '?xsec_token=NETWORK_SECRET', statusCode: networkStatus });
        requestHandlers.onErrorOccurred?.({ url: noteUrl, error: 'net::ERR_CONNECTION_RESET' });
      }
      this.webContents.emit('did-fail-load', {}, -105, 'synthetic', '', true);
    });
    return Promise.resolve();
  }
  isDestroyed() { return false; }
  destroy() {}
  hide() {}
}
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Setting: class {}, Notice: class {}, requestUrl: async () => ({ status: 200, text: responseHtml }) };
  if (request === 'electron') return { remote: { BrowserWindow, session: { fromPartition: () => session } }, session: { fromPartition: () => session } };
  return originalLoad.call(this, request, parent, isMain);
};
global.window = { setTimeout, clearTimeout };
const Plugin = require(process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main');
const helpers = Plugin.__test;
function fixture() {
  const plugin = new Plugin();
  plugin.settings = helpers.mergeSettings({ aiProvider: 'off', settingsVersion: 2, xiaohongshuCommentsEnabled: false });
  plugin.manifest = require('../obsidian-plugin/wechat-inbox-sync/manifest.json');
  plugin.getConfiguredLocalAsrInstallRoot = plugin.getConfiguredLocalOcrInstallRoot = () => temp;
  plugin.getConfiguredLocalAsrPlatform = () => 'windows';
  plugin.getLocalAsrInstallStatus = plugin.getLocalOcrInstallStatus = () => ({ ready: true });
  plugin.getActiveBindings = plugin.getRecentSyncFailureCleanupErrors = () => [];
  plugin.hasProFeatureAccess = async () => true;
  plugin.enrichXiaohongshuExtractionWithOcr = async value => value;
  plugin.renderXiaohongshuPage = async () => ({ url: noteUrl, identityUrl: noteUrl, html: responseHtml, comments: [] });
  return plugin;
}
async function run() {
  const browser = fixture();
  const trace = helpers.createXiaohongshuBrowserDiagnostic({ _id: 'record-A' });
  const urls = await browser.renderSocialMediaUrls(noteUrl, { includeComments: false, xiaohongshuBrowserDiagnostic: trace });
  assert.ok(urls.includes(mediaUrl), 'actual browser program must return the video URL');
  assert.ok(scripts.some(script => script.includes(".join('\\n')")));
  assert.ok(trace.stages.some(item => item.stage === 'media_extraction' && item.outcome === 'completed'));
  injectedError = Object.assign(new SyntaxError('Invalid token https://private.test/?xsec_token=SYNTHETIC_SECRET cookie=COOKIE_SECRET'), { status: 403 });
  networkStatus = 429;
  await assert.rejects(() => browser.renderSocialMediaUrls(noteUrl, { includeComments: false, xiaohongshuBrowserDiagnostic: trace }), /Invalid token/);
  const failure = trace.stages.find(item => item.outcome === 'failed');
  assert.strictEqual(failure.failureKind, 'BROWSER_SCRIPT_ERROR');
  assert.strictEqual(failure.exception, 'SyntaxError');
  assert.strictEqual(failure.status, 403);
  assert.ok(failure.message.includes('Invalid token'));
  assert.ok(!JSON.stringify(trace).includes('SYNTHETIC_SECRET'));
  assert.ok(!JSON.stringify(trace).includes('COOKIE_SECRET'));
  assert.ok(!JSON.stringify(trace).includes('NETWORK_SECRET'));
  assert.ok(trace.events.some(item => item.status === 429 && item.host === 'xiaohongshu.com'), JSON.stringify(trace.events));
  assert.ok(trace.events.some(item => item.message === 'net::ERR_CONNECTION_RESET'));
  assert.ok(trace.events.some(item => item.outcome === 'plugin_blocked' && item.code === 'COMMENTS_DISABLED_FOR_MEDIA'));
  assert.ok(!JSON.stringify(trace).includes('BLOCK_SECRET'));
  injectedError = null;
  networkStatus = 0;

  // A hanging account request does not swallow page evidence; explicit rejection still denies login.
  const loginTrace = helpers.createXiaohongshuBrowserDiagnostic();
  assert.strictEqual(await browser.checkXiaohongshuLogin({ xiaohongshuBrowserDiagnostic: loginTrace }), true);
  assert.ok(loginTrace.stages.some(item => item.stage === 'account_probe' && item.outcome === 'timeout'));
  loginResponse = 'denied';
  assert.strictEqual(await browser.checkXiaohongshuLogin(), false);
  for (const response of ['malformed-denied', 'hanging-denied', 'business-denied']) {
    loginResponse = response;
    assert.strictEqual(await browser.checkXiaohongshuLogin(), false, response);
  }
  loginResponse = 'ok';
  assert.strictEqual(await browser.checkXiaohongshuLogin(), true);

  // Known video, readable description, no static video URL: exercise browser fallback to actual ASR trigger.
  responseHtml = '<html><body><script>' + JSON.stringify({ noteDetailMap: { abcdef0123456789abcdef01: { note: { noteId: 'abcdef0123456789abcdef01', type: 'video', displayTitle: '视频测试', desc: '公开视频正文', video: {} } } } }) + '</script></body></html>';
  const plugin = fixture();
  let transcriptions = 0;
  plugin.runConfiguredTranscription = async (_url, options) => {
    transcriptions++;
    assert.strictEqual(options.diagnosticAttemptId, plugin.lastXiaohongshuBrowserDiagnostic.attemptId);
    return { transcription: '这是本条视频的口播文字', source: 'local' };
  };
  const record = { _id: 'record-A', type: 'webpage', content: noteUrl, metadata: { url: noteUrl, webpageMediaType: 'audio_video' } };
  const hydrated = await plugin.hydrateWebpageMarkdown(record, '', '', '视频');
  assert.strictEqual(transcriptions, 1);
  assert.strictEqual(hydrated.metadata.transcription, '这是本条视频的口播文字');
  assert.strictEqual(hydrated.metadata.mediaResolutionDiagnostic.transcriptionStarted, true);
  assert.strictEqual(hydrated.metadata.mediaResolutionDiagnostic.finalOutcome, 'transcription-ready');
  assert.strictEqual(hydrated.metadata.xiaohongshuCommentResult.attemptId, hydrated.metadata.mediaResolutionDiagnostic.attemptId);
  plugin.renderSocialMediaUrls = async () => [];
  await assert.rejects(() => plugin.hydrateWebpageMarkdown(record, '', '', '视频'), error => {
    assert.strictEqual(error.retryable, true);
    const trace = error.diagnostic.browser || error.diagnostic;
    assert.strictEqual(trace.finalOutcome, 'no-media-candidate');
    assert.strictEqual(trace.transcriptionStarted, false);
    return true;
  });
  assert.strictEqual(transcriptions, 1, 'no media must not invoke ASR');
  await assert.rejects(() => plugin.hydrateWebpageMarkdown({ ...record, metadata: { ...record.metadata, markdown: '旧版只保存了视频标题，没有转写' } }, '', '', '重试'), error => error.retryable === true);
  const latest = plugin.getRecentXiaohongshuBrowserResults().at(-1);
  assert.notStrictEqual(latest.attemptId, plugin.getRecentXiaohongshuBrowserResults().at(-2).attemptId);
  assert.strictEqual(latest.recordRef, diagnostic.recordRef('record-A'));
  const log = helpers.buildSyncDiagnosticLogText({ status: 'failed', xiaohongshuBrowserResults: plugin.getRecentXiaohongshuBrowserResults() });
  fs.writeFileSync(path.join(temp, 'sync-last.log'), log);
  const restarted = fixture();
  restarted.showSyncProgress({ stage: 'empty' });
  let copied = '';
  restarted.copyDiagnosticText = async text => { copied = text; return true; };
  await restarted.copySyncDiagnosticText();
  assert.ok(copied.includes('no-media-candidate'));
  assert.ok(copied.includes(latest.attemptId));
  // Older ASR success must never claim this failed extraction was transcribed, even for the same record.
  fs.writeFileSync(path.join(temp, 'asr-diagnostic-last.json'), JSON.stringify({ recordId: 'record-A', startedAt: '2026-01-01T01:00:00.000Z', status: 'success' }));
  assert.ok(asr.detailedDiagnostic(temp, {}, latest).includes('historical_or_unconfirmed'));
  assert.ok(asr.detailedDiagnostic(temp, {}, latest).includes('不代表当前同步已转写'));
  const matched = { ...latest, transcriptionStarted: true };
  fs.writeFileSync(path.join(temp, 'asr-diagnostic-last.json'), JSON.stringify({ recordId: 'record-A', diagnosticAttemptId: latest.attemptId, startedAt: latest.startedAt, status: 'success' }));
  assert.ok(asr.detailedDiagnostic(temp, {}, matched).includes('same_attempt'));
  assert.ok(asr.detailedDiagnostic(temp, {}, { ...matched, attemptId: 'abcdefabcdefabcd' }).includes('historical_or_unconfirmed'));
  const safe = diagnostic.errorDetails(new Error('Bearer BEARER_SECRET "web_session":"WEB_SECRET"'));
  assert.ok(!JSON.stringify(safe).includes('BEARER_SECRET'));
  assert.ok(!JSON.stringify(safe).includes('WEB_SECRET'));
  assert.ok(!diagnostic.technicalText('HTTP error {"token":"JSON_SECRET"}').includes('JSON_SECRET'));
  assert.ok(!asr.diagnosticRedact(JSON.stringify({ binary: 'C:\\Users\\敏感用户名\\bin\\whisper.exe' })).includes('敏感用户名'));
  const downloadTrace = diagnostic.sanitize({ downloadAttempts: [{ transport: 'session', ok: true, status: 200, durationMs: 23 }] });
  assert.deepStrictEqual(diagnostic.sanitize(downloadTrace), downloadTrace, '持久化和再次复制不能改写下载结果');
  console.log('XHS video diagnostics: real injected program, fallback transcription, missing media, login deadline, restart, redaction and historical ASR passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; });
