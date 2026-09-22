'use strict';
const assert = require('assert');
const Module = require('module');
const https = require('https');
const { EventEmitter } = require('events');
const diagnostics = require('../obsidian-plugin/wechat-inbox-sync/src/xiaohongshu-diagnostic-utils');
const originalLoad = Module._load;
const originalRequest = https.request;
Module._load = function(name, parent, isMain) {
  if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Setting: class {}, Notice: class {} };
  return originalLoad.call(this, name, parent, isMain);
};
const Plugin = require(process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main');
const h = Plugin.__test;
const noteId = 'abcdef0123456789abcdef01';
const noteUrl = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=SYNTHETIC_SHARE_TOKEN`;
const mediaUrl = 'https://sns-video-v2.xhscdn.com/test-public-video.mp4';
const html = '<script>window.__INITIAL_STATE__=' + JSON.stringify({ noteDetailMap: { [noteId]: { note: {
  noteId, type: 'video', displayTitle: '公开测试视频', desc: '用于验证公开文档内容协商与转写衔接', video: { media: { stream: { h264: [{ masterUrl: mediaUrl }] } } },
} } } }) + '</script>';
let forceLogin = false;
let externalRedirect = false;
let responseStatus = 200;
let networkFailure = false;
const requests = [];
https.request = (url, options, callback) => {
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.destroy = error => { if (error) req.emit('error', error); };
  req.end = () => setImmediate(() => {
    if (networkFailure) { req.emit('error', new Error('net::ERR_CONNECTION_RESET')); return; }
    const parsed = new URL(url);
    requests.push({ url: parsed.toString(), headers: options.headers });
    const res = new EventEmitter();
    res.resume = () => {};
    const isDocument = /text\/html/.test(options.headers.Accept || '');
    const landing = parsed.pathname === '/login';
    res.statusCode = !landing && (!isDocument || forceLogin || externalRedirect) ? 302 : responseStatus;
    res.headers = res.statusCode === 302 ? { location: externalRedirect ? 'https://untrusted.example/note' : 'https://www.xiaohongshu.com/login' } : {};
    callback(res);
    if (res.statusCode !== 302) {
      res.emit('data', Buffer.from(res.statusCode >= 400 ? '{}' : landing ? '<title>小红书</title><body>登录</body>' : html));
      res.emit('end');
    }
  });
  return req;
};

async function main() {
  const plugin = new Plugin();
  assert.strictEqual(h.getSocialRequestHeaders(noteUrl).Accept, '*/*', 'media and API headers remain separate');
  // Same public response negotiation as the live regression: wildcard -> login.
  const baseline = await h.requestPublicWebpageText(noteUrl, { headers: h.getSocialRequestHeaders(noteUrl) });
  assert.strictEqual(new URL(baseline.url).pathname, '/login');
  requests.length = 0;
  const trace = h.createXiaohongshuBrowserDiagnostic();
  const response = await plugin.requestXiaohongshuStaticPage(noteUrl, { xiaohongshuBrowserDiagnostic: trace });
  const extracted = h.extractXiaohongshuMarkdownFromHtml(response.text, response.url, '', { includeComments: false });
  assert.strictEqual(extracted.xiaohongshuPrimaryNoteMatched, true);
  assert.strictEqual(extracted.videoUrl, mediaUrl);
  assert.ok(trace.stages.some(row => row.outcome === 'xiaohongshu-note' && row.mediaCandidateCount === 1));
  assert.ok(requests.every(row => !Object.keys(row.headers).some(key => /cookie|authorization/i.test(key))));
  assert.ok(!JSON.stringify(trace).includes('SYNTHETIC_SHARE_TOKEN'));

  plugin.settings = h.mergeSettings({ aiProvider: 'local', settingsVersion: 2, xiaohongshuCommentsEnabled: false });
  plugin.hasProFeatureAccess = async () => true;
  let browserCalls = 0;
  plugin.renderSocialMediaUrls = async () => { browserCalls++; throw new Error('Browser must not be needed after exact static media'); };
  plugin.renderXiaohongshuPage = async () => { browserCalls++; throw new Error('Static video is already complete'); };
  let asrCalls = 0;
  plugin.runConfiguredTranscription = async url => {
    assert.strictEqual(url, mediaUrl);
    asrCalls++;
    return { transcription: '该视频的测试口播文字', source: 'local' };
  };
  const record = await plugin.hydrateWebpageMarkdown({ _id: 'synthetic', type: 'webpage', content: noteUrl, metadata: { url: noteUrl, webpageMediaType: 'audio_video' } }, '', '', '测试');
  assert.strictEqual(asrCalls, 1);
  assert.strictEqual(browserCalls, 0);
  assert.strictEqual(record.metadata.transcription, '该视频的测试口播文字');
  forceLogin = true;
  const loginTrace = h.createXiaohongshuBrowserDiagnostic();
  await plugin.requestXiaohongshuStaticPage(noteUrl, { xiaohongshuBrowserDiagnostic: loginTrace });
  assert.ok(loginTrace.stages.some(row => row.outcome === 'login_landing' && row.status === 200 && row.mediaCandidateCount === 0));
  externalRedirect = true;
  const blockedTrace = h.createXiaohongshuBrowserDiagnostic();
  await assert.rejects(plugin.requestXiaohongshuStaticPage(noteUrl, { xiaohongshuBrowserDiagnostic: blockedTrace }), /不受信任/);
  assert.ok(blockedTrace.stages.some(row => row.stage === 'static_content' && row.failureKind));
  assert.ok(!requests.some(row => row.url.startsWith('https://untrusted.example/')));
  forceLogin = externalRedirect = false;
  responseStatus = 406;
  const deniedTrace = h.createXiaohongshuBrowserDiagnostic();
  await plugin.requestXiaohongshuStaticPage(noteUrl, { xiaohongshuBrowserDiagnostic: deniedTrace });
  assert.ok(deniedTrace.stages.some(row => row.outcome === 'http_failed' && row.status === 406));
  networkFailure = true;
  const networkTrace = h.createXiaohongshuBrowserDiagnostic();
  await assert.rejects(plugin.requestXiaohongshuStaticPage(noteUrl, { xiaohongshuBrowserDiagnostic: networkTrace }), /ERR_CONNECTION_RESET/);
  assert.ok(networkTrace.stages.some(row => row.outcome === 'failed' && row.message === 'net::ERR_CONNECTION_RESET'));
  assert.deepStrictEqual(diagnostics.sanitize(diagnostics.sanitize(deniedTrace)), diagnostics.sanitize(deniedTrace));

  // Reproduce TLS reset followed by an unusable browser document: terminal evidence must survive.
  plugin.renderXiaohongshuPage = async () => ({ url: noteUrl, html: '<title>小红书</title><body>登录</body>', comments: [] });
  plugin.renderSocialMediaUrls = async () => [];
  await assert.rejects(plugin.hydrateWebpageMarkdown({ _id: 'reset-empty', type: 'webpage', content: noteUrl, metadata: {url:noteUrl} }, '', '', '测试'), error => error.retryable === true);
  const ended = plugin.getRecentXiaohongshuBrowserResults().at(-1);
  assert.equal(ended.finalOutcome, 'content-failed');
  assert.ok(Number.isFinite(Date.parse(ended.finishedAt)));
  assert.ok(ended.stages.some(row => row.stage === 'content_result' && row.outcome === 'failed'));
  assert.ok(ended.stages.some(row => row.stage === 'static_content' && row.outcome === 'failed'));
  assert.ok(!JSON.stringify(ended).includes('SYNTHETIC_SHARE_TOKEN'));

  const plain = { error: { name: 'TypeError', errorDescription: 'failed to read media https://private.example/?xsec_token=HIDDEN cookie=COOKIE_SECRET', errorCode: 'ERR_SCRIPT_FAILED', statusCode: 406 }, body: 'PRIVATE_BODY', headers: { authorization: 'HEADER_SECRET' } };
  plain.cause = plain;
  const detail = diagnostics.errorDetails(plain);
  assert.strictEqual(detail.exception, 'TypeError');
  assert.strictEqual(detail.status, 406);
  assert.strictEqual(detail.code, 'ERR_SCRIPT_FAILED');
  assert.ok(detail.message.includes('failed to read media'));
  assert.ok(!/HIDDEN|COOKIE_SECRET|PRIVATE_BODY|HEADER_SECRET|\[object Object\]/.test(JSON.stringify(detail)));
  assert.ok(!diagnostics.errorDetails({ data: 'SECRET' }).message.includes('[object Object]'));
  assert.doesNotThrow(() => diagnostics.errorDetails({ get message() { throw new Error('private getter'); } }));
  console.log('XHS static document: HTML negotiation, exact-note ASR, no redundant browser, login diagnostics, redirect trust and object-error redaction passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { https.request = originalRequest; Module._load = originalLoad; });
