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
const shareText = '改名换姓的熙悦城，搁置3年重出江湖 🔥城投熙悦城（原项目）先存好口令，再去【小红书】解锁这篇笔记~';
const loginHtml = '<title>登录-小红书</title><body>手机号登录 验证码登录 扫码登录 登录后查看更多完整笔记内容 同意用户协议和隐私政策</body>';
const genericTitleLoginHtml = '<title>小红书</title><body>手机号登录 验证码登录 扫码登录 登录后查看更多完整笔记内容 同意用户协议和隐私政策</body>';
const fallbackOnly = h.extractXiaohongshuMarkdownFromHtml(loginHtml, noteUrl, shareText, { includeComments: false });
assert.strictEqual(fallbackOnly.xiaohongshuPrimaryNoteMatched, false);
assert.strictEqual(fallbackOnly.descriptionSource, 'share_text');
assert.strictEqual(fallbackOnly.pageDescription, '');
assert.strictEqual(h.hasReadableXiaohongshuGraphicContent(fallbackOnly, loginHtml, noteUrl), false);
assert.strictEqual(h.scoreXiaohongshuExtraction(fallbackOnly, loginHtml, noteUrl), -1);
assert.notStrictEqual(h.classifyXiaohongshuPage({ html: loginHtml, resolvedUrl: noteUrl, extracted: fallbackOnly }), 'xiaohongshu-note');
const genericTitleLogin = h.extractXiaohongshuMarkdownFromHtml(genericTitleLoginHtml, noteUrl, shareText, { includeComments: false });
assert.strictEqual(h.hasReadableXiaohongshuGraphicContent(genericTitleLogin, genericTitleLoginHtml, noteUrl), false);
assert.notStrictEqual(h.classifyXiaohongshuPage({ html: genericTitleLoginHtml, resolvedUrl: noteUrl, extracted: genericTitleLogin }), 'xiaohongshu-note');
const loginTutorialHtml = '<title>登录方法实测</title><body>本文比较手机号登录、验证码登录和扫码登录三种方式，并介绍用户协议与隐私政策的适用范围。</body>';
const loginTutorial = h.extractXiaohongshuMarkdownFromHtml(loginTutorialHtml, noteUrl, '', { includeComments: false });
assert.strictEqual(h.hasReadableXiaohongshuGraphicContent(loginTutorial, loginTutorialHtml, noteUrl), true);
const primaryLoginTutorial = {
  ...fallbackOnly,
  title: '小红书登录教程',
  description: '小红书登录教程的真实图文正文说明。',
  pageDescription: '小红书登录教程的真实图文正文说明。',
  descriptionSource: 'primary_note',
  xiaohongshuPrimaryNoteMatched: true,
  imageUrls: ['https://sns-img-qc.xhscdn.com/test-login-tutorial.jpg'],
};
assert.strictEqual(h.hasReadableXiaohongshuGraphicContent(
  primaryLoginTutorial,
  '<title>小红书登录教程</title><body>真实图文笔记内容</body>',
  noteUrl,
), true);
const validMeta = '这段页面描述来自真实的小红书笔记正文，虽然比剪贴板分享摘要短得多。';
const metadataOnly = h.extractXiaohongshuMarkdownFromHtml(
  `<title>真实笔记</title><meta property="og:description" content="${validMeta}">`,
  noteUrl,
  `${shareText} ${shareText}`,
  { includeComments: false },
);
assert.strictEqual(metadataOnly.description, validMeta);
assert.strictEqual(metadataOnly.pageDescription, validMeta);
assert.strictEqual(metadataOnly.descriptionSource, 'meta');
assert.strictEqual(h.hasReadableXiaohongshuGraphicContent(metadataOnly, '<title>真实笔记</title>', noteUrl), true);
const bodyOnly = h.extractXiaohongshuMarkdownFromHtml(
  '<title>公开笔记</title><body><article>这是从页面正文区域提取到的有效内容，具备足够文字用于验证兼容性。</article></body>',
  noteUrl,
  '',
  { includeComments: false },
);
assert.strictEqual(bodyOnly.descriptionSource, 'body');
assert.strictEqual(h.hasReadableXiaohongshuGraphicContent(bodyOnly, '<title>公开笔记</title>', noteUrl), true);
assert.strictEqual(h.hasReadableXiaohongshuGraphicContent(
  { ...fallbackOnly, imageUrls: ['https://sns-img-qc.xhscdn.com/test-image.jpg'] },
  '<title>公开笔记</title><body>图片内容已从页面中提取。</body>',
  noteUrl,
), true);
const mergedPageAndFallback = h.mergeXiaohongshuExtractions([
  { ...fallbackOnly, title: '同一笔记' },
  { ...metadataOnly, title: '同一笔记' },
], { ...fallbackOnly, title: '同一笔记' });
assert.strictEqual(mergedPageAndFallback.pageDescription, validMeta);
assert.strictEqual(mergedPageAndFallback.descriptionSource, 'meta');
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

  forceLogin = true;
  plugin.renderSocialMediaUrls = async () => [];
  plugin.renderSocialMediaUrl = async () => '';
  plugin.renderXiaohongshuPage = async () => ({ url: 'https://www.xiaohongshu.com/login', html: loginHtml, comments: [] });
  for (const [recordId, webpageMediaType] of [['share-text-image', 'image_text'], ['share-text-video', 'audio_video']]) {
    await assert.rejects(
      plugin.hydrateWebpageMarkdown({
        _id: recordId,
        type: 'webpage',
        content: noteUrl,
        metadata: { url: noteUrl, shareText, webpageMediaType },
      }, '', '', '测试'),
      error => error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE' && error.retryable === true,
      `${webpageMediaType} login landing must remain retryable when only share text is available`,
    );
  }
  forceLogin = false;

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
