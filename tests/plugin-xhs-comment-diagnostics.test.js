'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { EventEmitter } = require('events');
const { sanitizeXiaohongshuCommentResult } = require('../obsidian-plugin/wechat-inbox-sync/src/xiaohongshu-markdown-utils');
const url = 'https://www.xiaohongshu.com/explore/abcdef0123456789abcdef01';
const html = `<html><head><link rel="canonical" href="${url}"><meta property="og:title" content="公开图文测试"><meta name="description" content="所有用户都应该取得这段公开正文以及完整图片。 #公开内容"><meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/public-cover.jpg"></head><body></body></html>`;
let responseHtml = html;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Setting: class {}, Notice: class {}, requestUrl: async () => ({status: 200, text: responseHtml}) };
  if (request === 'electron') return {};
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require(process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;
const helpers = Plugin.__test;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-comment-diagnostic-test-'));

function pluginFixture() {
  const plugin = new Plugin();
  plugin.settings = helpers.mergeSettings({aiProvider: 'off', settingsVersion: 2, xiaohongshuCommentsEnabled: true});
  plugin.manifest = require('../obsidian-plugin/wechat-inbox-sync/manifest.json');
  plugin.hasProFeatureAccess = async () => true;
  plugin.checkXiaohongshuLogin = async () => true;
  plugin.enrichXiaohongshuExtractionWithOcr = async extracted => extracted;
  plugin.renderSocialMediaUrls = async () => [];
  plugin.getConfiguredLocalAsrInstallRoot = () => temp;
  plugin.getConfiguredLocalOcrInstallRoot = () => temp;
  plugin.getConfiguredLocalAsrPlatform = () => 'windows';
  plugin.getLocalAsrInstallStatus = plugin.getLocalOcrInstallStatus = () => ({ready: true});
  plugin.getActiveBindings = () => [];
  plugin.getRecentSyncFailureCleanupErrors = () => [];
  return plugin;
}

async function capture({pro = true, login = true, enabled = true, error, comments = [], details = {}, existing = false, bodyField = 'markdown', prior, savedBody = '已保存正文\n\n![图片](本地图片.png)\n\n成功转写保留'} = {}) {
  responseHtml = html;
  const plugin = pluginFixture();
  plugin.settings.xiaohongshuCommentsEnabled = enabled;
  plugin.hasProFeatureAccess = async () => pro;
  plugin.checkXiaohongshuLogin = async () => { if (login instanceof Error) throw login; return login; };
  let calls = 0;
  plugin.renderXiaohongshuPage = async (_url, options) => {
    if (options.includeComments) { calls++; if (error) throw error; }
    return {url, identityUrl: url, html, comments: options.includeComments ? comments : [], commentDiagnosticDetails: details};
  };
  const record = await plugin.hydrateWebpageMarkdown({type: 'webpage', content: url, metadata: {url, ...(existing ? {[bodyField]: savedBody, transcription: '成功转写保留', xiaohongshuCommentResult: prior} : {})}}, '', '', '测试');
  assert.ok(record.metadata.markdown.includes(existing ? '已保存正文' : '公开正文'));
  let copied = '';
  plugin.copyDiagnosticText = async text => { copied = text; return true; };
  await plugin.copySyncDiagnosticText();
  const diagnostic = record.metadata.xiaohongshuCommentResult;
  assert.ok(diagnostic, 'saved body must carry its own comment result: '+JSON.stringify(record.metadata));
  assert.ok(copied.includes(JSON.stringify(diagnostic)), 'actual copy entry must include even successful-body diagnostics');
  return {plugin, record, diagnostic, copied, calls, warning: helpers.getRecordConversionWarning(record)};
}

async function runPager(response) {
  return vm.runInNewContext(helpers.getXiaohongshuCommentPaginationScript(url), {
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: {href: url}, window: {},
    fetch: async (request, options) => {
      assert.strictEqual(new URL(request).origin, 'https://edith.xiaohongshu.com');
      assert.strictEqual(new URL(request).searchParams.get('note_id'), helpers.getXiaohongshuTargetNoteId(url));
      assert.strictEqual(options.credentials, 'include');
      assert.ok(!options.headers['X-Requested-With'], 'avoid an unnecessary cross-origin preflight');
      return typeof response === 'function' ? response(request) : ({ok: true, status: 200, text: async () => JSON.stringify(response)});
    },
  });
}

// Reproduce Electron's request event order, without real user credentials.
function testRequestHeaderCollection() {
  const id = helpers.getXiaohongshuTargetNoteId(url);
  const requestUrl = 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=' + id;
  const collector = helpers.createXiaohongshuCommentRequestCollector(id);
  collector.capture({id: 1, url: requestUrl, method: 'GET'});
  collector.capture({id: 1, url: requestUrl, method: 'GET', requestHeaders: {'X-S': 'synthetic-signature', 'X-T': '1'}});
  assert.strictEqual(collector.requests.length, 1);
  assert.strictEqual(collector.requests[0].requestHeaders['X-S'], 'synthetic-signature');
  collector.capture({id: 2, url: requestUrl, requestHeaders: {'X-S': 'synthetic-new'}});
  assert.strictEqual(collector.requests.length, 2, 'distinct requests must retain their own headers');
  const post = requestUrl.split('?')[0];
  collector.capture({id: 3, url: post, method: 'POST', uploadData: [{bytes: Buffer.from(JSON.stringify({note_id: id}))}]});
  collector.capture({id: 3, url: post, method: 'POST', requestHeaders: {'X-S': 'synthetic-post'}});
  assert.strictEqual(collector.requests[2].requestHeaders['X-S'], 'synthetic-post');
  assert.ok(collector.requests[2].body.includes(id));
  collector.capture({id: 1, url: requestUrl.replace(id, 'other-note'), requestHeaders: {'X-S': 'wrong-note'}});
  collector.capture({id: 4, url: requestUrl.replace('edith.xiaohongshu.com', 'untrusted.example'), requestHeaders: {'X-S': 'untrusted'}});
  assert.strictEqual(collector.requests.length, 3);
  assert.strictEqual(collector.requests[0].requestHeaders['X-S'], 'synthetic-signature');
}
testRequestHeaderCollection();

// Exercise the production renderer and session queue; only Electron is simulated.
async function testIdentityRendering() {
  const noteId = 'abcdef0123456789abcdef01';
  const shortUrl = 'https://xhslink.cn/o/testlink';
  const noteHtml = '<html><script>' + JSON.stringify({noteDetailMap: {
    [noteId]: {note: {noteId, displayTitle: '目标笔记', desc: '目标正文', type: 'normal'}}
  }}) + '</script></html>';
  const windows = [];
  let pages = [], pagerCalls = 0, cookie = true, fastPageTimeout = false;
  const https = require('https'), savedRequest = https.request;
  let replayResponse = {}, sentReplayHeaders = [];
  https.request = (target, options, callback) => {
    assert.strictEqual(target.hostname, 'edith.xiaohongshu.com', 'test must never send a real network request');
    assert.strictEqual(options.headers['X-S'], 'synthetic-signed-request', 'final browser headers must reach the real replay transport');
    sentReplayHeaders.push(options.headers);
    const request = new EventEmitter();
    request.destroy = error => { if (error) request.emit('error', error); };
    request.write = () => {};
    request.end = () => setImmediate(() => {
      const response = new EventEmitter();
      response.statusCode = replayResponse.status || 200;
      response.headers = {};
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify(replayResponse.payload || {success: true, data: {
        comments: [{id: 'replayed-root', content: '浏览器请求重试恢复评论', user_info: {nickname: '测试'}}], has_more: false,
      }})));
      response.emit('end');
    });
    return request;
  };
  const listeners = {};
  const session = {
    cookies: {get: async () => cookie ? [{name: 'web_session', value: 'synthetic-test-cookie'}] : []},
    webRequest: {
      onBeforeRequest: (_filter, fn) => { listeners.request = fn; },
      onBeforeSendHeaders: (_filter, fn) => { listeners.headers = fn; },
    },
  };
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      this.page = pages.shift();
      assert.ok(this.page, 'unexpected extra browser attempt');
      this.webContents = new EventEmitter();
      this.webContents.session = session;
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.getURL = () => this.page.url;
      this.webContents.executeJavaScript = async script => {
        if (script.includes('const hasLoginWall =')) {
          return vm.runInNewContext(script, {
            document: {body: {innerText: this.page.text || ''}, querySelectorAll: () => this.page.walls || [], querySelector: () => ({})},
            getComputedStyle: element => element.style || {display: 'block', visibility: 'visible'},
            AbortController, setTimeout, clearTimeout,
            fetch: async () => ({ok: this.page.accountStatus === 200, status: this.page.accountStatus,
              json: async () => {
                if (this.page.badJson) throw Error('not json');
                return {code: this.page.accountCode || 0, data: {user_id: 'synthetic'}};
              }}),
          });
        }
        if (script.includes('html: document.documentElement ?') && !script.includes('collectionStopReason')) {
          if (this.page.onSnapshot) return this.page.onSnapshot();
          if (this.page.pagerTimeout) fastPageTimeout = true;
          return vm.runInNewContext(script, {
            location: {href: this.page.url},
            document: {documentElement: {outerHTML: this.page.html}, querySelectorAll: () => this.page.walls || []},
            getComputedStyle: element => element.style || {display: 'block', visibility: 'visible'},
          });
        }
        if (script.includes('replyPayloadGroups')) {
          const deadline = Number(script.match(/const deadlineAt = ([0-9]+)/)[1]);
          assert.ok(deadline <= Date.now() + 20000, 'active pagination must reserve time for the fallback');
          pagerCalls++;
          if (this.page.pagerError) throw Error('synthetic script failure');
          if (this.page.pagerTimeout) {
            fastPageTimeout = true;
            return new Promise(resolve => savedTimer(() => resolve({identityNoteId: noteId, diagnostic: {stopReason: 'exhausted'}, rootPayloads: [], replyPayloadGroups: []}), 15));
          }
          return {identityNoteId: this.page.wrongIdentity ? '111111111111111111111111' : noteId, rootPayloads: [{success: true, data: {
            comments: [{id: 'root', content: '已恢复目标评论', user_info: {nickname: '测试'}}], has_more: false,
          }}], replyPayloadGroups: [], diagnostic: {source: 'page-api', stopReason: 'exhausted', pageCount: 1}};
        }
        assert.ok(script.includes('collectionStopReason'), 'unexpected browser script');
        if (this.page.pagerTimeout) {
          fastPageTimeout = false;
          await new Promise(resolve => savedTimer(resolve, 30));
        }
        return {html: noteHtml, url, comments: this.page.domComments || [], rootRequestCount: 0, collectionStopReason: 'root_idle'};
      };
      windows.push(this);
    }
    loadURL(value) {
      this.loadedUrl = value;
      if (this.page.signedReplay) {
        const details = {id: 701, method: 'GET', url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/' + (this.page.replyOnly ? 'sub/page?root_comment_id=root&' : 'page?') + 'note_id=' + noteId};
        listeners.request(details, () => {});
        listeners.headers({...details, requestHeaders: {'X-S': 'synthetic-signed-request'}}, () => {});
      }
      if (this.page.redirect) this.webContents.emit('will-redirect', {
        url: this.page.redirect, isMainFrame: true, preventDefault() {},
      });
      this.webContents.emit('did-finish-load');
      return Promise.resolve();
    }
    hide() {}
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const savedLoad = Module._load, savedWindow = global.window, savedTimer = global.setTimeout;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return {remote: {BrowserWindow, session: {fromPartition: () => session}}};
    return savedLoad.call(this, request, parent, isMain);
  };
  global.window = {setTimeout: (fn, ms) => savedTimer(fn, ms === 2500 ? 0 : ms), clearTimeout};
  global.setTimeout = (fn, ms, ...args) => savedTimer(fn, fastPageTimeout && ms >= 10000 ? 2 : ms <= 1200 ? 0 : ms, ...args);
  async function render(input, fixtures, extra = {}) {
    pages = fixtures;
    replayResponse = fixtures[fixtures.length - 1] && fixtures[fixtures.length - 1].replayResponse || {};
    const before = windows.length, beforeCalls = pagerCalls;
    const diagnostic = {};
    const result = await helpers.renderXiaohongshuPageWithElectron(input, {
      includeComments: true, xiaohongshuBrowserDiagnostic: diagnostic, ...extra,
    });
    assert.ok(windows.slice(before).every(win => win.destroyed), 'every window must close');
    assert.strictEqual(listeners.request || null, null, 'request interceptor must be released');
    return {result, diagnostic, windowCount: windows.length - before, apiCalls: pagerCalls - beforeCalls};
  }
  try {
    const success = await render(shortUrl, [{url, html: noteHtml, redirect: url}, {url, html: noteHtml}]);
    assert.strictEqual(success.windowCount, 2, 'short links get exactly one discovery attempt');
    assert.strictEqual(success.apiCalls, 1);
    assert.strictEqual(success.result.comments[0].content, '已恢复目标评论');
    assert.ok(success.diagnostic.stages.some(stage => stage.outcome === 'identity_resolved'));
    const known = await render(url, [{url, html: noteHtml}]);
    assert.strictEqual(known.windowCount, 1, 'known identities must not rediscover');
    assert.strictEqual(known.apiCalls, 1);
    for (const [flag, stopReason, errorCode] of [
      ['pagerError', 'page_script_failed', 'REQUEST_FAILED'],
      ['pagerTimeout', 'page_api_timeout', 'TIMEOUT'],
      ['wrongIdentity', 'target_identity_mismatch', 'TARGET_IDENTITY_MISMATCH'],
    ]) {
      const failed = await render(url, [{url, html: noteHtml, [flag]: true}]);
      assert.strictEqual(failed.result.comments.length, 0);
      assert.strictEqual(failed.result.commentDiagnosticDetails.stopReason, stopReason);
      assert.strictEqual(failed.result.commentDiagnosticDetails.errorCode, errorCode);
      fastPageTimeout = false;
    }
    const replayed = await render(url, [{url, html: noteHtml, pagerError: true, signedReplay: true}]);
    assert.strictEqual(replayed.result.comments[0].content, '浏览器请求重试恢复评论');
    assert.strictEqual(sentReplayHeaders.length, 1);
    assert.strictEqual(replayed.result.commentDiagnosticDetails.rootRequestCount, 1);
    const repliesOnly = await render(url, [{url, html: noteHtml, signedReplay: true, replyOnly: true,
      replayResponse: {payload: {success: true, data: {comments: [{id: 'replayed-reply', content: '仅重试取得的回复', user_info: {nickname: '测试'}}], has_more: false}}}}]);
    assert.strictEqual(repliesOnly.result.comments.length, 1);
    assert.strictEqual(repliesOnly.result.comments[0].id, 'root');
    assert.strictEqual(repliesOnly.result.comments[0].replies[0].id, 'replayed-reply');
    assert.strictEqual(repliesOnly.result.commentDiagnosticDetails.finalReplyCount, 1);
    const denied = await render(url, [{url, html: noteHtml, pagerError: true, signedReplay: true,
      replayResponse: {status: 406, payload: {success: false, code: -100, message: 'SYNTHETIC_PRIVATE_BODY'}}}]);
    assert.strictEqual(denied.result.commentDiagnosticDetails.errorCode, 'HTTP_406');
    assert.strictEqual(denied.result.commentDiagnosticDetails.failureStage, 'root_request');
    assert.ok(!JSON.stringify(denied.result).includes('SYNTHETIC_PRIVATE_BODY'));
    const fallback = await render(url, [{url, html: noteHtml, pagerTimeout: true,
      domComments: [{id: 'dom-root', author: '测试', content: '分页超时后页面仍能提取评论', domRole: 'root'}]}]);
    assert.ok(fallback.result.comments.some(comment => comment.content === '分页超时后页面仍能提取评论'));
    assert.strictEqual(fallback.result.commentDiagnosticDetails.pageApiStopReason, 'page_api_timeout');
    fastPageTimeout = false;
    for (const page of [
      {url: 'https://www.xiaohongshu.com/', html: noteHtml}, // State alone is not identity evidence.
      {url: 'https://www.xiaohongshu.com/login', html: noteHtml, redirect: url},
      {url: 'https://untrusted.example/', html: noteHtml, redirect: url},
      {url, html: '<html>页面不存在</html>'},
      {url, html: noteHtml, walls: [{innerText: '请完成安全验证，拖动滑块完成验证', getClientRects: () => [1]}]},
      {url, html: noteHtml, walls: [{innerText: '手机号登录，登录后查看完整内容', getClientRects: () => [1]}]},
    ]) {
      const missing = await render(shortUrl, [page]);
      assert.strictEqual(missing.windowCount, 1);
      assert.strictEqual(missing.apiCalls, 0);
      assert.strictEqual(missing.result.commentDiagnosticDetails.errorCode, 'TARGET_IDENTITY_MISSING');
      assert.ok(missing.diagnostic.stages.some(stage => stage.outcome === 'target_identity_missing'));
    }
    const normalMention = await render(shortUrl, [
      {url, html: noteHtml + '<article>教程：请完成安全验证，之后手机号登录</article>',
        walls: [{innerText: '手机号登录', getClientRects: () => []}]},
      {url, html: noteHtml},
    ]);
    assert.strictEqual(normalMention.apiCalls, 1, 'note prose and hidden login elements must not block identity');
    const external = await render('https://untrusted.example/path', []);
    assert.strictEqual(external.windowCount, 0);
    assert.strictEqual(external.apiCalls, 0);
    const mismatch = await render(url, [{url: url.replace(noteId, '111111111111111111111111'), html: noteHtml.replaceAll(noteId, '111111111111111111111111')}]);
    assert.strictEqual(mismatch.apiCalls, 0);
    assert.strictEqual(mismatch.result.commentDiagnosticDetails.errorCode, 'TARGET_IDENTITY_MISMATCH');
    assert.ok(mismatch.diagnostic.stages.some(stage => stage.outcome === 'target_identity_mismatch'));
    cookie = false;
    const noCookie = await render(shortUrl, []);
    assert.strictEqual(noCookie.windowCount, 0);
    assert.strictEqual(noCookie.result.commentDiagnosticDetails.stopReason, 'skipped_no_login_cookie');
    cookie = true;
    const controller = new AbortController(), abortDiagnostic = {};
    pages = [{url, html: noteHtml, onSnapshot: () => {
      setImmediate(() => controller.abort());
      return new Promise(() => {});
    }}];
    await assert.rejects(() => helpers.renderXiaohongshuPageWithElectron(shortUrl, {
      includeComments: true, signal: controller.signal, xiaohongshuBrowserDiagnostic: abortDiagnostic,
    }), error => error.name === 'AbortError');
    assert.ok(windows.every(win => win.destroyed));
    assert.ok(abortDiagnostic.stages.some(stage => stage.outcome === 'identity_discovery_aborted'));
    const afterAbort = await render(url, [{url, html: noteHtml}]);
    assert.strictEqual(afterAbort.apiCalls, 1, 'aborting discovery must release the session queue');
    for (const [page, expected] of [
      [{text: '推荐文章：请登录后进行安全验证', accountStatus: 200}, true],
      [{text: '普通首页', accountStatus: 200, walls: [{innerText: '手机号登录', getClientRects: () => []}]}, true],
      [{accountStatus: 200, walls: [{innerText: '请完成安全验证', getClientRects: () => [1]}]}, false],
      [{accountStatus: 401, badJson: true}, false],
      [{accountStatus: 403, badJson: true}, false],
      [{accountStatus: 200, accountCode: -100}, false],
    ]) {
      pages = [{url, html: noteHtml, ...page}];
      const loggedIn = await Plugin.prototype.checkXiaohongshuLogin.call({}, {});
      assert.strictEqual(loggedIn, expected, 'real login probe must use visible controls and account rejection');
    }
    assert.ok(windows.every(win => win.destroyed));
  } finally {
    https.request = savedRequest;
    Module._load = savedLoad;
    global.window = savedWindow;
    global.setTimeout = savedTimer;
  }
}

async function run() {
  await testIdentityRendering();
  const timeout = await capture({error: Error('timed out https://private.test/?xsec_token=SYNTHETIC_SECRET')});
  assert.strictEqual(timeout.diagnostic.status, 'failed');
  assert.strictEqual(timeout.diagnostic.loginCheck, 'passed');
  assert.strictEqual(timeout.diagnostic.stage, 'comment_extraction');
  assert.strictEqual(timeout.diagnostic.errorCode, 'TIMEOUT');
  assert.ok(timeout.warning.includes('登录预检已通过'));
  assert.ok(timeout.warning.includes('复制诊断信息'));
  assert.ok(!timeout.copied.includes('SYNTHETIC_SECRET'));
  assert.ok(!timeout.warning.includes('登录失效'));
  for (const [options, reason, loginCheck] of [
    [{login: false}, 'login_unconfirmed', 'unconfirmed'],
    [{enabled: false}, 'disabled', 'not_checked'],
    [{pro: false}, 'pro_not_confirmed', 'not_checked'],
    [{existing: true, enabled: false}, 'disabled', 'not_checked'],
    [{existing: true, pro: false}, 'pro_not_confirmed', 'not_checked'],
    [{existing: true, login: false}, 'login_unconfirmed', 'unconfirmed'],
  ]) {
    const result = await capture(options);
    assert.strictEqual(result.calls, 0);
    assert.strictEqual(result.diagnostic.status, 'skipped');
    assert.strictEqual(result.diagnostic.reason, reason);
    assert.strictEqual(result.diagnostic.loginCheck, loginCheck);
    assert.ok(result.warning);
  }
  const loginFailure = await capture({login: Error('timeout')});
  assert.strictEqual(loginFailure.diagnostic.errorCode, 'TIMEOUT');
  assert.strictEqual(loginFailure.diagnostic.stage, 'login_check');
  const partial = await capture({comments: [{id: 'root', content: '主评论', author: '作者', replies: [{id: 'reply', content: '这是回复正文', author: '读者'}]}], details: {stopReason: 'network_root_idle', pageCount: 2}});
  assert.strictEqual(partial.diagnostic.status, 'partial');
  assert.strictEqual(partial.diagnostic.rootCount, 1);
  assert.strictEqual(partial.diagnostic.replyCount, 1);
  assert.strictEqual(partial.diagnostic.pageCount, 2);
  assert.ok(partial.warning.includes('可能不完整'));
  const empty = await capture({details: {stopReason: 'exhausted'}});
  assert.strictEqual(empty.diagnostic.status, 'empty_unconfirmed');
  assert.ok(empty.warning.includes('无法确认'));
  const success = await capture({comments: [{id: 'one', content: '评论内容', author: '用户'}], details: {stopReason: 'exhausted'}});
  assert.strictEqual(success.diagnostic.status, 'captured');
  assert.strictEqual(success.warning, '');
  for (const bodyField of ['markdown', 'snapshot', 'contentSnapshot']) {
    const retry = await capture({existing: true, bodyField, prior: {status: 'failed'}, comments: [{id: 'saved', content: '补全评论', author: '测试'}], details: {stopReason: 'exhausted'}});
    assert.strictEqual(retry.calls, 1);
    assert.strictEqual(retry.diagnostic.status, 'captured');
    assert.ok(retry.record.metadata.markdown.includes('本地图片.png'));
    assert.strictEqual(retry.record.metadata.transcription, '成功转写保留');
    let calls = 0;
    retry.plugin.renderXiaohongshuPage = async () => { calls++; throw Error('must not repeat captured comments'); };
    const repeated = await retry.plugin.hydrateWebpageMarkdown(retry.record, '', '', '重复');
    assert.strictEqual(calls, 0);
    assert.strictEqual(repeated.metadata.markdown, retry.record.metadata.markdown);
    assert.strictEqual(repeated.metadata.xiaohongshuCommentResult.status, 'captured');
    const failedRetry = await capture({existing: true, bodyField, error: Error('timeout')});
    assert.strictEqual(failedRetry.diagnostic.status, 'failed');
    assert.strictEqual(failedRetry.record.metadata.markdown, '已保存正文\n\n![图片](本地图片.png)\n\n成功转写保留');
    assert.strictEqual(failedRetry.record.metadata.transcription, '成功转写保留');
  }
  const identityFailures = [];
  for (const [stopReason, errorCode, warning] of [
    ['target_identity_missing', 'TARGET_IDENTITY_MISSING', '未能识别目标笔记编号'],
    ['target_identity_mismatch', 'TARGET_IDENTITY_MISMATCH', '打开的页面与目标笔记不一致'],
    ['page_script_failed', 'REQUEST_FAILED', '评论提取失败'],
    ['time_budget_exceeded', 'TIMEOUT', '评论提取失败'],
  ]) {
    const failed = await capture({details: {stopReason, errorCode, failureStage: 'comment_extraction', partial: true}});
    assert.strictEqual(failed.diagnostic.status, 'failed');
    assert.strictEqual(failed.diagnostic.reason, stopReason);
    assert.strictEqual(failed.diagnostic.stopReason, stopReason);
    assert.strictEqual(failed.diagnostic.errorCode, errorCode);
    assert.ok(failed.warning.includes(warning));
    assert.ok(failed.copied.includes(errorCode));
    identityFailures.push(failed.diagnostic);
  }
  const cookieChanged = await capture({details: {stopReason: 'skipped_no_login_cookie'}});
  assert.strictEqual(cookieChanged.diagnostic.status, 'skipped');
  assert.strictEqual(cookieChanged.diagnostic.reason, 'skipped_no_login_cookie');
  const bodyWithHeading = '已保存正文\n\n## 评论区\n\n这是原笔记正文里的说明段落，必须保留。\n\n## 后续章节\n\n保留其他章节。';
  const headingRetry = await capture({existing: true, savedBody: bodyWithHeading, prior: {status: 'failed'}, comments: [{id: 'new', content: '新评论', author: '测试'}], details: {stopReason: 'exhausted'}});
  assert.ok(headingRetry.record.metadata.markdown.startsWith(bodyWithHeading));
  assert.ok(headingRetry.record.metadata.markdown.includes('<!-- xhs-comments:start -->'));
  const partialRetry = await capture({existing: true, comments: [{id: 'old', content: '原有评论', author: '测试'}], details: {stopReason: 'root_request_failed', errorCode: 'REQUEST_FAILED'}});
  const partialAgain = await capture({existing: true, savedBody: partialRetry.record.metadata.markdown, prior: partialRetry.diagnostic, comments: [{id: 'new', content: '另一个片段', author: '测试'}], details: {stopReason: 'root_request_failed', errorCode: 'REQUEST_FAILED'}});
  assert.strictEqual(partialAgain.record.metadata.markdown, partialRetry.record.metadata.markdown);
  const completedAgain = await capture({existing: true, savedBody: partialRetry.record.metadata.markdown, prior: partialRetry.diagnostic, comments: [{id: 'all', content: '完整评论', author: '测试'}], details: {stopReason: 'exhausted'}});
  assert.strictEqual((completedAgain.record.metadata.markdown.match(/<!-- xhs-comments:start -->/g) || []).length, 1);
  assert.ok(completedAgain.record.metadata.markdown.includes('完整评论'));
  assert.ok(!completedAgain.record.metadata.markdown.includes('原有评论'));
  const fenceBody = '已保存正文\n\n~~~html\n<!-- xhs-comments:start -->\n原说明必须保留\n<!-- xhs-comments:end -->\n~~~';
  const fenced = await capture({existing: true, savedBody: fenceBody, prior: {status: 'failed'}, comments: [{id: 'new', content: '真正评论', author: '测试'}], details: {stopReason: 'exhausted'}});
  assert.ok(fenced.record.metadata.markdown.startsWith(fenceBody));
  const legacyBody = '已保存正文\n\n## 评论区\n\n1. **测试**：旧评论\n\n## 正文后续\n\n必须保留正文\n\n<!-- xhs-comment-diag: root=1 -->';
  const legacy = await capture({existing: true, savedBody: legacyBody, prior: {status: 'partial', rootCount: 1, replyCount: 0}, comments: [{id: 'new', content: '新评论', author: '测试'}], details: {stopReason: 'exhausted'}});
  assert.strictEqual(legacy.record.metadata.markdown, legacyBody);
  assert.strictEqual(legacy.diagnostic.status, 'partial');

  // Execute the real generated browser program; HTTP 200 is not business success.
  for (const target of [
    url, url.replace('/explore/', '/discovery/item/'), url.replace('/explore/', '/item/'),
    ...['note_id', 'noteId', 'item_id', 'itemId'].map(key => 'https://www.xiaohongshu.com/?' + key + '=abc_def-123456'),
  ]) {
    let requests = 0;
    const result = await vm.runInNewContext(helpers.getXiaohongshuCommentPaginationScript(target), {
      URL, URLSearchParams, AbortController, setTimeout, clearTimeout, window: {}, location: {href: url},
      fetch: async request => {
        requests++;
        assert.strictEqual(new URL(request, url).searchParams.get('note_id'), helpers.getXiaohongshuTargetNoteId(target));
        return {ok: true, text: async () => JSON.stringify({success: true, data: {comments: [], has_more: false}})};
      },
    });
    assert.strictEqual(requests, 1);
    assert.strictEqual(result.identityNoteId, helpers.getXiaohongshuTargetNoteId(target));
  }
  for (const target of ['https://external.example/explore/abcdef0123456789abcdef01', url.replace('https:', 'http:'), 'https://www.xiaohongshu.com/']) {
    const result = await vm.runInNewContext(helpers.getXiaohongshuCommentPaginationScript(target), {
      URL, URLSearchParams, AbortController, setTimeout, clearTimeout, window: {}, location: {href: url},
      fetch: () => { throw Error('untrusted/unknown identity must not fetch'); },
    });
    assert.strictEqual(result.diagnostic.stopReason, 'note_id_missing');
  }
  const business = await runPager({success: false, code: -100, msg: 'SYNTHETIC_SECRET'});
  assert.strictEqual(business.diagnostic.errorCode, 'BUSINESS_-100');
  assert.strictEqual(business.diagnostic.failureStage, 'root_request');
  assert.notStrictEqual(business.diagnostic.stopReason, 'exhausted');
  assert.strictEqual(business.rootPayloads.length, 0);
  const denied = await capture({details: business.diagnostic});
  assert.strictEqual(denied.diagnostic.status, 'failed');
  assert.strictEqual(denied.diagnostic.errorCode, 'BUSINESS_-100');
  const http = await runPager(async () => ({ok: false, status: 403}));
  assert.strictEqual(http.diagnostic.errorCode, 'HTTP_403');
  const invalid = await runPager({success: true, data: {unexpected: 'shape'}});
  assert.strictEqual(invalid.diagnostic.errorCode, 'INVALID_RESPONSE');
  // Existing response aliases must remain supported.
  for (const key of ['comments', 'comment_list', 'list', 'items']) {
    const valid = await runPager({success: true, result: {[key]: [], has_more: false}});
    assert.strictEqual(valid.diagnostic.stopReason, 'exhausted');
    assert.strictEqual(valid.diagnostic.errorCode, undefined);
  }
  const replyFailure = await runPager(async request => request.includes('/sub/')
    ? {ok: false, status: 429}
    : {ok: true, text: async () => JSON.stringify({success: true, data: {comments: [{id: 'root', sub_comment_count: 2}], has_more: false}})});
  assert.strictEqual(replyFailure.diagnostic.errorCode, 'HTTP_429');
  assert.strictEqual(replyFailure.diagnostic.failureStage, 'reply_request');

  // Video hydration must preserve comment failures through the real transcript builder.
  const videoPlugin = pluginFixture();
  videoPlugin.settings.aiProvider = 'local';
  videoPlugin.runConfiguredTranscription = async () => ({transcription: '视频转写正文', source: 'local'});
  responseHtml = '<html><body><script>' + JSON.stringify({noteDetailMap: {abcdef0123456789abcdef01: {note: {noteId: 'abcdef0123456789abcdef01', displayTitle: '视频测试', desc: '视频正文', video: {media: {stream: {h264: [{masterUrl: 'https://sns-video-v6.xhscdn.com/stream/video.mp4'}]}}}}}}}) + '</script></body></html>';
  videoPlugin.renderXiaohongshuPage = async (_url, options) => {
    if (options.includeComments) throw Error('timeout');
    return {url, identityUrl: url, html: responseHtml, comments: []};
  };
  const video = await videoPlugin.hydrateWebpageMarkdown({type: 'webpage', content: url, metadata: {url}}, '', '', '视频');
  assert.strictEqual(video.metadata.transcription, '视频转写正文');
  assert.strictEqual(video.metadata.xiaohongshuCommentResult.status, 'failed');
  assert.ok(helpers.getRecordConversionWarning(video).includes('评论提取失败'));
  responseHtml = html;
  const abortedPlugin = pluginFixture();
  abortedPlugin.renderXiaohongshuPage = async (_url, options) => {
    if (options.includeComments) { const error = Error('cancelled'); error.name = 'AbortError'; throw error; }
    return {url, identityUrl: url, html, comments: []};
  };
  await assert.rejects(() => abortedPlugin.hydrateWebpageMarkdown({type: 'webpage', content: url, metadata: {url}}, '', '', '取消'), /cancelled/);
  assert.strictEqual(abortedPlugin.lastXiaohongshuCommentResults.at(-1).status, 'aborted');
  assert.ok(abortedPlugin.getSyncDiagnosticText().includes('提取已取消'));
  // The final user notification consumes the same warning returned by saveRecord.
  const {buildSyncResultNotice} = require('../obsidian-plugin/wechat-inbox-sync/src/progress-notice-utils');
  assert.ok(buildSyncResultNotice(['saved'], [], [timeout.warning]).includes('评论提取失败'));

  // Persist through the production log format, then exercise copy after restart.
  const log = helpers.buildSyncDiagnosticLogText({status: 'success', xiaohongshuComments: [timeout.diagnostic, partial.diagnostic, ...identityFailures]});
  const logPath = path.join(temp, 'sync-last.log');
  fs.writeFileSync(logPath, log);
  const restarted = pluginFixture();
  restarted.showSyncProgress({stage: 'empty'});
  assert.ok(fs.readFileSync(logPath, 'utf8').includes('TIMEOUT'), 'empty auto-sync after restart must preserve previous diagnostics');
  assert.ok(restarted.getSyncDiagnosticText().includes('TIMEOUT'));
  assert.ok(restarted.getSyncDiagnosticText().includes('network_root_idle'));
  assert.ok(restarted.getSyncDiagnosticText().includes('TARGET_IDENTITY_MISSING'));
  assert.ok(restarted.getSyncDiagnosticText().includes('TARGET_IDENTITY_MISMATCH'));
  assert.ok(restarted.getSyncDiagnosticText().includes('page_script_failed'));
  for (let attempt = 0; attempt < 6; attempt++) {
    await restarted.hydrateWebpageMarkdown({type: 'webpage', content: url, metadata: {url, markdown: '已保存正文'}}, '', '', '重复');
  }
  assert.strictEqual(restarted.lastXiaohongshuCommentResults.length, 5);
  assert.strictEqual(new Set(restarted.lastXiaohongshuCommentResults.map(item => item.attemptId)).size, 5);
  assert.doesNotThrow(() => sanitizeXiaohongshuCommentResult(null));
  const poisoned = sanitizeXiaohongshuCommentResult({status: 'private_token', reason: 'private_token', stopReason: 'private_token', errorCode: 'private_token', cookie: 'private_token', url: 'https://private.test', rootCount: Infinity});
  assert.ok(!JSON.stringify(poisoned).includes('private_token'));
  assert.ok(!JSON.stringify(poisoned).includes('private.test'));
  assert.strictEqual(poisoned.rootCount, 0);
  console.log('XHS comment diagnostics: hydration, warning, clipboard, restart, API failure and redaction passed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
