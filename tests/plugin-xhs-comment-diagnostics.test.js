'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Module = require('module');
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
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
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

async function capture({pro = true, login = true, enabled = true, error, comments = [], details = {}, existing = false} = {}) {
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
  const record = await plugin.hydrateWebpageMarkdown({type: 'webpage', content: url, metadata: {url, ...(existing ? {markdown: '已保存正文'} : {})}}, '', '', '测试');
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
    fetch: async request => typeof response === 'function' ? response(request) : ({ok: true, status: 200, text: async () => JSON.stringify(response)}),
  });
}

async function run() {
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
    [{existing: true}, 'existing_content', 'not_checked'],
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

  // Execute the real generated browser program; HTTP 200 is not business success.
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
  const log = helpers.buildSyncDiagnosticLogText({status: 'success', xiaohongshuComments: [timeout.diagnostic, partial.diagnostic]});
  const logPath = path.join(temp, 'sync-last.log');
  fs.writeFileSync(logPath, log);
  const restarted = pluginFixture();
  restarted.showSyncProgress({stage: 'empty'});
  assert.ok(fs.readFileSync(logPath, 'utf8').includes('TIMEOUT'), 'empty auto-sync after restart must preserve previous diagnostics');
  assert.ok(restarted.getSyncDiagnosticText().includes('TIMEOUT'));
  assert.ok(restarted.getSyncDiagnosticText().includes('network_root_idle'));
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
