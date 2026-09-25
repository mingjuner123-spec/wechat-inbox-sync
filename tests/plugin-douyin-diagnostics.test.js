'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const diagnostic = require('../obsidian-plugin/wechat-inbox-sync/src/douyin-diagnostic-utils');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-diagnostic-test-'));
const originalLoad = Module._load;
let request = async () => ({ text: '<html><body></body></html>', status: 200 });
Module._load = function(id, parent, main) {
  if (id === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, requestUrl: (...args) => request(...args) };
  if (id === 'electron') return { remote: { session: { fromPartition: () => ({ cookies: { get: async () => [] } }) } } };
  return originalLoad.call(this, id, parent, main);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
function fixture() {
  const plugin = new Plugin(); plugin.settings = { aiProvider: 'off' };
  plugin.getConfiguredLocalAsrInstallRoot = () => scratch;
  plugin.getConfiguredLocalOcrInstallRoot = () => scratch;
  plugin.getLocalAsrInstallStatus = plugin.getLocalOcrInstallStatus = () => ({ ready: true, missingReasons: [] });
  plugin.getLocalDouyinResolverInstallStatus = () => ({ ready: true });
  plugin.getActiveBindings = () => [];
  plugin.getRecentXiaohongshuBrowserResults = plugin.getRecentXiaohongshuCommentResults = plugin.getRecentSyncFailureCleanupErrors = plugin.getLocalDouyinResolverInstallDiagnostic = () => [];
  plugin.checkDouyinLogin = async () => true;
  plugin.fetchDouyinMediaResolutionWithSession = async () => ({ mediaUrls: [], stages: [] });
  return plugin;
}
async function run() {
  let cases = 0;
  try {
    for (const [text, code] of [
      ['Fresh cookies (not necessarily logged in) are needed', 'DOUYIN_COOKIE_REFRESH_REQUIRED'],
      ['captcha required', 'DOUYIN_CHALLENGE'], ['login required', 'DOUYIN_LOGIN_REQUIRED'],
      ['certificate verify failed', 'DOUYIN_RESOLVER_NETWORK'], ['unrecognized payload', 'DOUYIN_RESOLVER_FAILED'],
    ]) { assert.equal(diagnostic.classifyResolverError(new Error(text)).code, code); cases++; }
    const stages = [{ ok: false, error: { browserCode: 'DOUYIN_BROWSER_TIMEOUT' } }, { ok: false, error: { code: 'DOUYIN_COOKIE_REFRESH_REQUIRED' } }];
    assert.equal(diagnostic.failureCode(stages), 'DOUYIN_BROWSER_TIMEOUT'); cases++;
    const saved = diagnostic.save(scratch, { attemptId: 'abcdef0123456789', pluginDouyinLogin: true, outcome: 'failed', failureCode: 'DOUYIN_BROWSER_TIMEOUT', stages: [{ stage: 'local-resolver', error: { message: 'request https://example.test/?secret=PRIVATE\nCookie: sessionid=SECRET', exitCode: 1 } }] });
    assert.equal(diagnostic.read(scratch)[0].cookieState, 'saved-unverified');
    assert.equal(diagnostic.read(scratch)[0].stages[0].error.exitCode, 1);
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE|SECRET/); cases++;
    const cookieTest = Plugin.__test.hasDouyinLoginCookies;
    assert.equal(cookieTest([{ name: 'sessionid', value: 'fixture-value', expirationDate: Date.now() / 1000 - 100 }]), false);
    assert.equal(cookieTest([{ name: 'sessionid', value: 'fixture-value', expirationDate: Date.now() / 1000 + 100 }]), true); cases++;
    const url = 'https://www.douyin.com/video/7659778280362429711';
    let browserCalls = 0, resolverCalls = 0, correlation;
    const plugin = fixture();
    plugin.renderSocialMediaUrls = async (_url, options) => { browserCalls++; correlation = options.diagnosticAttemptId; throw Object.assign(new Error('fixture timeout'), { browserCode: 'DOUYIN_BROWSER_TIMEOUT' }); };
    plugin.resolveDouyinMediaWithLocalResolver = async () => { resolverCalls++; return { mediaUrls: [], code: 'DOUYIN_COOKIE_REFRESH_REQUIRED', error: 'Fresh cookies are needed', exitCode: 1 }; };
    const result = await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: url, metadata: { url } }, '', '', 'fixture');
    const latest = diagnostic.read(scratch).at(-1);
    assert.equal(latest.failureCode, 'DOUYIN_BROWSER_TIMEOUT');
    assert.equal(latest.attemptId, correlation);
    assert.equal(browserCalls, 1); assert.equal(resolverCalls, 1);
    assert.doesNotMatch(result.metadata.transcriptionError || '', /安全验证/); cases++;
    browserCalls = 0; resolverCalls = 0;
    plugin.renderSocialMediaUrls = async () => { browserCalls++; throw Object.assign(new Error('fixture challenge'), { code: 'DOUYIN_CHALLENGE' }); };
    await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: url, metadata: { url } }, '', '', 'fixture');
    assert.equal(browserCalls, 1); assert.equal(resolverCalls, 0);
    assert.equal(diagnostic.read(scratch).at(-1).failureCode, 'DOUYIN_CHALLENGE'); cases++;
    const summary = plugin.getSyncDiagnosticText();
    assert.doesNotMatch(summary, /未检测到失败日志|最近小红书|飞书图片显示/);
    assert.match(summary, /DOUYIN_CHALLENGE/); cases++;
    plugin.renderSocialMediaUrls = async () => [];
    plugin.resolveDouyinMediaWithLocalResolver = async () => ({ mediaUrls: [], notInstalled: true, error: 'component missing' });
    const missing = await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: url, metadata: { url } }, '', '', 'fixture');
    assert.match(missing.metadata.transcriptionError, /安装/);
    assert.equal(diagnostic.read(scratch).at(-1).failureCode, 'DOUYIN_NO_MEDIA'); cases++;
    request = async () => { throw Object.assign(new Error('fixture request failed'), { code: 'ECONNRESET', status: 503 }); };
    await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: url, metadata: { url } }, '', '', 'fixture');
    const early = diagnostic.read(scratch).at(-1);
    assert.equal(early.failureCode, 'DOUYIN_FETCH_FAILED');
    assert.equal(early.stages.at(-1).error.code, 'ECONNRESET');
    assert.equal(early.stages.at(-1).error.status, 503); cases++;
    request = async () => ({ text: '<html></html>', status: 200 });
    plugin.renderSocialMediaUrls = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError', code: 'ABORT_ERR' }); };
    await assert.rejects(plugin.hydrateWebpageMarkdown({ type: 'webpage', content: url, metadata: { url } }, '', '', 'fixture'), { name: 'AbortError' });
    assert.equal(diagnostic.read(scratch).at(-1).outcome, 'cancelled'); cases++;
    assert.equal(diagnostic.read(scratch).at(-1).failureCode, 'DOUYIN_CANCELLED');
    assert.equal(diagnostic.read(scratch).at(-1).stages.at(-1).stage, 'cancelled');
    assert.equal(diagnostic.read(scratch).at(-1).stages.find(s => s.stage === 'targeted-browser').error.code, 'ABORT_ERR');
    plugin.renderSocialMediaUrls = async () => { throw Object.assign(new Error('timeout'), { browserCode: 'DOUYIN_BROWSER_TIMEOUT' }); };
    plugin.resolveDouyinMediaWithLocalResolver = async () => ({ mediaUrls: ['https://v3.douyinvod.com/fixture.mp4'] });
    plugin.hydrateWebpageAudioVideo = async record => record;
    await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: url, metadata: { url } }, '', '', 'fixture');
    assert.equal(diagnostic.read(scratch).at(-1).outcome, 'success');
    assert.equal(diagnostic.read(scratch).at(-1).failureCode, ''); cases++;
    for (let i = 0; i < 6; i++) diagnostic.save(scratch, { attemptId: i.toString(16).padStart(16, '0'), stages: [], outcome: 'success' });
    assert.equal(diagnostic.read(scratch).length, 5);
    assert.equal(diagnostic.read(scratch)[0].attemptId, '0000000000000001'); cases++;
    console.log(`Douyin diagnostic: ${cases} behavior cases passed`);
  } finally { Module._load = originalLoad; fs.rmSync(scratch, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
