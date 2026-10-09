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
  if (/\.(?:ps1|sh|py)$/i.test(id)) return '';
  if (id === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, requestUrl: (...args) => request(...args) };
  if (id === 'electron') return { remote: { session: { fromPartition: () => ({ cookies: { get: async () => [] } }) } } };
  return originalLoad.call(this, id, parent, main);
};
const Plugin = require(process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main');
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
    {
      const { EventEmitter } = require('node:events');
      const safety = require('../obsidian-plugin/wechat-inbox-sync/src/douyin-browser-safety');
      const contents = new EventEmitter(), debuggerApi = new EventEmitter(), events = [];
      let throttled = true;
      contents.debugger = debuggerApi;
      contents.setBackgroundThrottling = value => { throttled = value; };
      contents.setAudioMuted = value => { assert.equal(value, true); };
      const guard = safety.attachGuard({ webContents: contents }, { onDiagnostic: event => events.push(event) });
      assert.equal(throttled, false);
      debuggerApi.emit('message', {}, 'Network.responseReceived', { type: 'Document', response: { url: 'https://private.invalid/secret', body: 'private' } });
      debuggerApi.emit('message', {}, 'Network.loadingFinished', { requestId: 'private-id' });
      debuggerApi.emit('message', {}, 'Network.loadingFailed', { errorText: 'private-error' });
      assert.equal(events.length, 0, 'network events must not cause per-event disk persistence');
      guard.close(); guard.close();
      assert.equal(events.length, 1);
      assert.equal(debuggerApi.listenerCount('message'), 0);
      assert.equal(contents.listenerCount('did-fail-load'), 0);
      const clean = safety.sanitize(events[0]);
      assert.equal(clean.debuggerMessages, 3);
      assert.equal(clean.responseEvents, 1);
      assert.equal(clean.documentResponses, 1);
      assert.equal(clean.loadingFinishedEvents, 1);
      assert.equal(clean.loadingFailedEvents, 1);
      assert.equal(clean.responseReads, 0, 'raw events are distinct from response body reads');
      assert.equal(clean.backgroundThrottlingDisabled, true);
      assert.doesNotMatch(JSON.stringify(clean), /private|secret/);
      cases++;
    }
    for (const [text, code] of [
      ['Fresh cookies (not necessarily logged in) are needed', 'DOUYIN_COOKIE_REFRESH_REQUIRED'],
      ['captcha required', 'DOUYIN_CHALLENGE'], ['login required', 'DOUYIN_LOGIN_REQUIRED'],
      ['ERROR: Unsupported URL: https://www.douyin.com/private?token=SECRET', 'DOUYIN_UNSUPPORTED_URL'],
      ['certificate verify failed', 'DOUYIN_RESOLVER_NETWORK'], ['unrecognized payload', 'DOUYIN_RESOLVER_FAILED'],
    ]) { assert.equal(diagnostic.classifyResolverError(new Error(text)).code, code); cases++; }
    assert.match(diagnostic.failureMessage('DOUYIN_UNSUPPORTED_URL'), /地址栏复制完整作品链接/);
    assert.match(diagnostic.failureMessage('DOUYIN_UNSUPPORTED_URL'), /解析组件未识别/);
    assert.match(diagnostic.failureMessage('DOUYIN_RESOLVER_NETWORK'), /检查网络/);
    assert.match(diagnostic.failureMessage('DOUYIN_RESOLVER_NETWORK'), /VPN 或代理/);
    assert.match(diagnostic.failureMessage('DOUYIN_TARGET_ID_MISSING'), /具体作品页地址栏/);
    assert.equal(diagnostic.urlKind('https://www.douyin.com/video/1234567890123456789'), 'canonical');
    assert.equal(diagnostic.urlKind('https://www.iesdouyin.com/share/video/1234567890123456789/'), 'share');
    assert.equal(diagnostic.urlKind('https://v.douyin.com/fixture/'), 'shortlink');
    assert.equal(diagnostic.urlKind('https://www.douyin.com/feed/'), 'feed');
    assert.equal(diagnostic.urlKind('https://www.douyin.com/'), 'home');
    assert.equal(diagnostic.urlKind('https://www.douyin.com/search/fixture'), 'other');
    assert.equal(diagnostic.urlKind('https://example.invalid/?token=SECRET'), 'unknown');
    cases += 7;
    const stages = [{ ok: false, error: { browserCode: 'DOUYIN_BROWSER_TIMEOUT' } }, { ok: false, error: { code: 'DOUYIN_COOKIE_REFRESH_REQUIRED' } }];
    assert.equal(diagnostic.failureCode(stages), 'DOUYIN_BROWSER_TIMEOUT'); cases++;
    assert.equal(diagnostic.failureCode([{ ok: false, error: { code: 'DOUYIN_RESOLVER_FAILED', message: 'Unsupported URL: [URL_REDACTED]' } }]), 'DOUYIN_UNSUPPORTED_URL'); cases++;
    assert.equal(diagnostic.failureCode([{ ok: false, error: { code: 'DOUYIN_UNSUPPORTED_URL' } }]), 'DOUYIN_UNSUPPORTED_URL'); cases++;
    assert.equal(diagnostic.failureCode([
      { ok: false, error: { code: 'DOUYIN_CHALLENGE' } },
      { ok: false, error: { code: 'DOUYIN_RESOLVER_FAILED', message: 'Unsupported URL: [URL_REDACTED]' } },
    ]), 'DOUYIN_CHALLENGE'); cases++;
    assert.equal(diagnostic.failureCode([{ ok: false, error: { code: 'DOUYIN_NO_MEDIA' } }], { targetIdRecognized: false }), 'DOUYIN_TARGET_ID_MISSING'); cases++;
    assert.equal(diagnostic.failureCode([{ ok: false, error: { code: 'DOUYIN_RESOLVER_FAILED' } }], { targetIdRecognized: false }), 'DOUYIN_TARGET_ID_MISSING'); cases++;
    assert.equal(diagnostic.failureCode([{ ok: false, error: { code: 'DOUYIN_NO_MEDIA' } }], { targetIdRecognized: true }), 'DOUYIN_NO_MEDIA'); cases++;
    const legacy = diagnostic.sanitize({ stages: [{ stage: 'targeted-browser', ok: false, error: { code: 'DOUYIN_NO_MEDIA' } }] });
    assert.equal(legacy.targetIdState, 'unknown');
    assert.equal(diagnostic.failureCode(legacy.stages, legacy), 'DOUYIN_NO_MEDIA'); cases++;
    const explicitUnknown = diagnostic.sanitize({ targetIdRecognized: false, targetIdState: 'unknown', stages: [{ targetIdRecognized: false, targetIdState: 'unknown' }] });
    assert.equal(explicitUnknown.targetIdState, 'unknown');
    assert.equal(explicitUnknown.stages[0].targetIdState, 'unknown'); cases++;
    const context = diagnostic.sanitize({
      attemptId: 'abcdef0123456789',
      sourceKind: 'shortlink',
      resolvedKind: 'home',
      targetIdRecognized: false,
      targetStageEligible: false,
      debuggerCapability: 'not-eligible',
      debuggerReason: 'target-id-missing',
      stages: [{ stage: 'local-yt-dlp', sourceKind: 'shortlink', resolvedKind: 'home', targetIdRecognized: false, targetStageEligible: false, error: { message: 'Unsupported URL: https://www.douyin.com/video/123?token=SECRET' } }],
    });
    assert.equal(context.sourceKind, 'shortlink');
    assert.equal(context.resolvedKind, 'home');
    assert.equal(context.targetIdRecognized, false);
    assert.equal(context.targetStageEligible, false);
    assert.equal(context.debuggerCapability, 'not-eligible');
    assert.equal(context.debuggerReason, 'target-id-missing');
    assert.equal(context.stages[0].sourceKind, 'shortlink');
    assert.doesNotMatch(JSON.stringify(context), /https?:\/\//);
    assert.doesNotMatch(JSON.stringify(context), /SECRET/);
    cases++;
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
    assert.equal(browserCalls, 1); assert.equal(resolverCalls, 1);
    assert.equal(diagnostic.read(scratch).at(-1).failureCode, 'DOUYIN_CHALLENGE'); cases++;
    const summary = plugin.getSyncDiagnosticText();
    assert.doesNotMatch(summary, /未检测到失败日志|最近小红书|飞书图片显示/);
    assert.match(summary, /DOUYIN_CHALLENGE/); cases++;
    browserCalls = 0; resolverCalls = 0;
    plugin.resolveDouyinMediaWithLocalResolver = async () => { resolverCalls++; return { mediaUrls: ['https://v3.douyinvod.com/challenge-recovered.mp4'], identityOutcome: 'target-id-matched' }; };
    plugin.hydrateWebpageAudioVideo = async record => record;
    await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: url, metadata: { url } }, '', '', 'fixture');
    assert.equal(browserCalls, 1); assert.equal(resolverCalls, 1);
    assert.equal(diagnostic.read(scratch).at(-1).outcome, 'success');
    assert.equal(diagnostic.read(scratch).at(-1).failureCode, ''); cases++;
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
    plugin.resolveDouyinMediaWithLocalResolver = async () => ({ mediaUrls: ['https://v3.douyinvod.com/fixture.mp4'], identityOutcome: 'target-id-matched' });
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
