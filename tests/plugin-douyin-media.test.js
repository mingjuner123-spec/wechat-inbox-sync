'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      App: class {},
      Plugin: class {},
      PluginSettingTab: class {},
      Setting: class {},
      Notice: class {},
      TFile: class {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: async () => ({}),
      MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/src/main.js';
const PluginClass = require(pluginMainPath);
const helpers = PluginClass.__test;

function runTargetBoundDomFallbackWithoutRouteIdentityTest() {
  const targetAwemeId = '7644566503081119019';
  const targetMediaUrl = 'https://v11-weba.douyinvod.com/target-dom-video/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      canonicalUrl: 'https://www.douyin.com/',
      domMediaCandidates: [{
        index: 0,
        urls: [targetMediaUrl],
        identityIds: [targetAwemeId],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 320000,
      }],
    }),
    [targetMediaUrl],
    'the exact target DOM player must remain usable when Douyin strips the id from final/canonical URLs',
  );
}

function runUniquePageIdentityFallbackTest() {
  const targetAwemeId = '7644566503081119019';
  const targetMediaUrl = 'https://v11-weba.douyinvod.com/visible-target-video/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      canonicalUrl: 'https://www.douyin.com/',
      pageIdentityIds: [targetAwemeId],
      domMediaCandidates: [{
        index: 0,
        urls: [targetMediaUrl],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 320000,
      }],
    }),
    [targetMediaUrl],
    'a uniquely target-bound page may use its visible playing media even if the player node has no id attribute',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      pageIdentityIds: [targetAwemeId, '9999999999999999999'],
      domMediaCandidates: [{
        urls: ['https://v11-weba.douyinvod.com/recommendation/?mime_type=video_mp4'],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    ['https://v11-weba.douyinvod.com/recommendation/?mime_type=video_mp4'],
    'mixed page identities alone must not reject the visible playing media from the opened target page',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      pageIdentityIds: [targetAwemeId],
      domMediaCandidates: [{
        urls: ['https://v11-weba.douyinvod.com/unbound-player-1/?mime_type=video_mp4'],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }, {
        urls: ['https://v11-weba.douyinvod.com/unbound-player-2/?mime_type=video_mp4'],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 800000,
      }],
    }),
    ['https://v11-weba.douyinvod.com/unbound-player-1/?mime_type=video_mp4'],
    'multiple unbound players should select the strongest visible playing candidate instead of failing closed',
  );
}

function runOnlyExplicitFinalRouteMismatchIsRejectedTest() {
  const targetAwemeId = '7644566503081119019';
  const targetMediaUrl = 'https://v11-weba.douyinvod.com/target-video/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/video/9999999999999999999',
      debuggerMediaUrls: [targetMediaUrl],
    }),
    [],
    'an explicit final route mismatch must win over stale debugger media from the previous page',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/video/9999999999999999999',
      pageIdentityIds: [targetAwemeId],
      domMediaCandidates: [{
        urls: [targetMediaUrl],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [],
    'an explicit loaded route for another work must still be rejected',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      domMediaCandidates: [{
        urls: [targetMediaUrl],
        identityIds: ['9999999999999999999'],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [targetMediaUrl],
    'candidate identity metadata must not block the visible playing media on the opened page',
  );

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: 'https://www.douyin.com/',
      canonicalUrl: 'https://www.douyin.com/video/9999999999999999999',
      domMediaCandidates: [{
        urls: [targetMediaUrl],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [targetMediaUrl],
    'canonical metadata from a preloaded work must not override the current playable page',
  );
}

function runNoStableAwemeIdStillUsesPrimaryPlayerTest() {
  const mediaUrl = 'https://v11-weba.douyinvod.com/no-stable-id/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId: '',
      finalUrl: 'https://www.douyin.com/',
      domMediaCandidates: [{
        urls: [mediaUrl],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [mediaUrl],
    'missing aweme id must not fail closed when the current page has a playable primary video',
  );
}

function runBrowserFallbackRequestKeepsNonStrictCurrentPageTest() {
  assert.deepStrictEqual(
    helpers.buildDouyinBrowserFallbackRequest(
      'https://v.douyin.com/example/',
      'https://www.douyin.com/',
    ),
    {
      awemeId: '',
      url: 'https://www.douyin.com/',
      strictDouyinTarget: false,
    },
    'a current Douyin page without an id must still enter non-strict browser fallback',
  );

  assert.deepStrictEqual(
    helpers.buildDouyinBrowserFallbackRequests(
      'https://v.douyin.com/example/',
      'https://www.douyin.com/video/7644566503081119019',
    ),
    [{
      awemeId: '7644566503081119019',
      url: 'https://v.douyin.com/example/',
      strictDouyinTarget: false,
      inputKind: 'original-page',
    }, {
      awemeId: '7644566503081119019',
      url: 'https://www.douyin.com/video/7644566503081119019',
      strictDouyinTarget: false,
      inputKind: 'resolved-page',
    }],
    'a known target id must not remove the original/current-page browser fallbacks that worked in 1.3.30',
  );

  assert.deepStrictEqual(
    helpers.buildDouyinBrowserFallbackRequests(
      'https://v.douyin.com/example/',
      'https://douyin.com/',
      '7644566503081119019',
    ),
    [{
      awemeId: '7644566503081119019',
      url: 'https://v.douyin.com/example/',
      strictDouyinTarget: false,
      inputKind: 'original-page',
    }, {
      awemeId: '7644566503081119019',
      url: 'https://douyin.com/',
      strictDouyinTarget: false,
      inputKind: 'resolved-page',
    }, {
      awemeId: '7644566503081119019',
      url: 'https://www.douyin.com/video/7644566503081119019',
      strictDouyinTarget: false,
      inputKind: 'target-page',
    }],
    'a generic resolved page must be followed by the stable canonical work page when the work id is known',
  );
}

function runHiddenDouyinRendererNeverCreatesVisibleChildWindowTest() {
  let windowOpenHandler = null;
  helpers.installExternalAppNavigationGuards({
    on() {},
    setWindowOpenHandler(handler) {
      windowOpenHandler = handler;
    },
  });

  assert.strictEqual(typeof windowOpenHandler, 'function');
  assert.deepStrictEqual(
    windowOpenHandler({ url: 'https://www.douyin.com/video/7644566503081119019' }),
    { action: 'deny' },
    'hidden social-media renderers must not let a page create a visible HTTP child window',
  );
}

function runHiddenDouyinChildWindowGuardTest() {
  assert.strictEqual(typeof helpers.installHiddenBrowserChildWindowGuards, 'function');
  const handlers = new Map();
  const webContents = {
    on(name, handler) {
      handlers.set(name, handler);
    },
    removeListener(name, handler) {
      if (handlers.get(name) === handler) handlers.delete(name);
    },
  };
  const cleanup = helpers.installHiddenBrowserChildWindowGuards(webContents);
  let prevented = false;
  handlers.get('new-window')({ preventDefault() { prevented = true; } });
  assert.strictEqual(prevented, true, 'legacy Electron child-window events must be cancelled');

  let hidden = false;
  let destroyed = false;
  const childWindow = {
    hide() { hidden = true; },
    isDestroyed() { return destroyed; },
    destroy() { destroyed = true; },
  };
  handlers.get('did-create-window')({}, childWindow);
  assert.strictEqual(hidden, true, 'a child created despite the handler must be hidden immediately');
  assert.strictEqual(destroyed, true, 'a child created despite the handler must be destroyed');
  cleanup();
  assert.strictEqual(handlers.size, 0, 'window guards must be removable after extraction finishes');
}

function runBrowserLoadFailureKeepsSafeDiagnosticCodeTest() {
  assert.strictEqual(typeof helpers.createBrowserLoadFailureError, 'function');
  const error = helpers.createBrowserLoadFailureError(-3, 'ERR_ABORTED');
  assert.strictEqual(error.code, 'BROWSER_LOAD_ERR_ABORTED');
}

function runDouyinPersistentLoginContractTest() {
  assert.strictEqual(typeof helpers.hasDouyinLoginCookies, 'function');
  assert.strictEqual(typeof helpers.isDouyinChallengePageText, 'function');
  assert.strictEqual(typeof helpers.shouldRetryDouyinChallengePage, 'function');
  assert.strictEqual(
    helpers.hasDouyinLoginCookies([{ name: 'sessionid', value: 'valid-session-cookie' }]),
    true,
    'a valid plugin-local Douyin session cookie must be recognized without reading a system browser profile',
  );
  assert.strictEqual(
    helpers.hasDouyinLoginCookies([{ name: 'sessionid', value: '' }]),
    false,
    'an empty session cookie must not be reported as a signed-in Douyin account',
  );
  assert.strictEqual(typeof helpers.buildDouyinLoginPageConfig, 'function');
  assert.match(helpers.buildDouyinLoginPageConfig().loginUrl, /^https:\/\/www\.douyin\.com\//);
  assert.strictEqual(
    helpers.isDouyinChallengePageText('sec_sdk risk-control captcha'),
    true,
    'the renderer must recognize a JavaScript/WAF challenge page before treating it as media-empty',
  );
  assert.strictEqual(
    helpers.isDouyinChallengePageText('normal public Douyin video page'),
    false,
  );
  assert.strictEqual(
    helpers.shouldRetryDouyinChallengePage({ challengeDetected: true, retryAllowed: true }),
    true,
    'a cold anonymous session gets one quiet browser retry after a challenge page sets its cookies',
  );
  assert.strictEqual(
    helpers.shouldRetryDouyinChallengePage({ challengeDetected: true, retryAllowed: false }),
    false,
    'fallback routes must not repeatedly reload a challenged page',
  );
}

function runLocalResolverFallbackContractTest() {
  const source = fs.readFileSync(path.resolve(__dirname, pluginMainPath), 'utf8');
  assert.match(
    source,
    /!hasUsableDouyinMedia[\s\S]{0,160}resolveDouyinMediaWithLocalResolver/,
    'the local resolver must run only after the existing Douyin media stages fail',
  );
  assert.match(source, /stage:\s*['"]local-yt-dlp['"]/);
  assert.match(source, /getInstalledLocalDouyinResolver\(\)/, 'the resolver must run only when the optional component is already installed');
  assert.doesNotMatch(source, /localDouyinResolverLastCheckedAt/, 'normal sync must not schedule periodic resolver checks');
  assert.match(source, /getDouyinCookies\(\)/, 'yt-dlp must use the plugin session rather than a system browser profile');
  assert.match(source, /fs\.rmSync\(cookiePath, \{ force: true \}\)/, 'temporary Cookie files must be deleted');
  assert.doesNotMatch(source, /cookies-from-browser/, 'the plugin must not read Chrome/Edge browser profiles');
}

async function runDouyinBrowserSessionLockTest() {
  assert.strictEqual(typeof helpers.runWithDouyinBrowserSessionLock, 'function');
  const trace = [];
  let releaseFirst;
  const first = helpers.runWithDouyinBrowserSessionLock(async () => {
    trace.push('first-start');
    await new Promise((resolve) => { releaseFirst = resolve; });
    trace.push('first-end');
  });
  const second = helpers.runWithDouyinBrowserSessionLock(async () => {
    trace.push('second');
  });
  await Promise.resolve();
  assert.deepStrictEqual(trace, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepStrictEqual(trace, ['first-start', 'first-end', 'second']);
}

function runLegacyPlayerActivationAndPageMediaFallbackContractTest() {
  const sourcePath = path.resolve(__dirname, pluginMainPath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /node\.muted\s*=\s*true;[\s\S]{0,240}node\.play\(\)\.catch\(\(\)\s*=>\s*\{\}\)/,
    'the hidden browser must activate the current video so Douyin emits its real media request',
  );
  assert.doesNotMatch(
    source,
    /isXiaohongshuUrl\(url\)\s*\|\|\s*Boolean\(douyinAwemeId\)\s*\?\s*\[\]/,
    'discovering an aweme id must not discard media already present in the opened page HTML',
  );
  assert.doesNotMatch(
    source,
    /allowGenericSocialMediaRender\s*=\s*!\(douyinAwemeId/,
    'discovering an aweme id must not disable the 1.3.30 current-page renderer',
  );
}

function runPaceSsrStateMediaExtractionTest() {
  const awemeId = '7673128661335166246';
  const mediaUrl = 'https://v11-web.douyinvod.com/video-tos-cn-p-0015/target.mp4?mime_type=video_mp4';
  const pageState = encodeURIComponent(JSON.stringify({
    videoDetail: {
      awemeId,
      video: {
        playAddr: [{ src: mediaUrl }],
      },
    },
  }));
  const html = `<script>self.__pace_f.push([1, ${JSON.stringify(pageState)}]);</script>`;

  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(html, awemeId),
    [mediaUrl],
    'current Douyin React SSR state must provide the target media when legacy router data is absent',
  );

  const flightChunk = `7:${JSON.stringify({
    videoDetail: {
      awemeId,
      video: { playAddr: [{ src: mediaUrl }] },
    },
  })}`;
  const streamedHtml = `<script>self.__pace_f.push([1, ${JSON.stringify(flightChunk)}]);</script>`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(streamedHtml, awemeId),
    [mediaUrl],
    'React Flight chunks with a stream row prefix must also expose target-bound media',
  );

  const signedMediaUrl = 'https://v11-web.douyinvod.com/signed.mp4?token=a%2Fb%26c%3D1&mime_type=video_mp4';
  const signedState = encodeURIComponent(JSON.stringify({
    videoDetail: {
      awemeId,
      video: { playAddr: [{ src: signedMediaUrl }] },
    },
  }));
  const signedHtml = `<script>self.__pace_f.push([1, ${JSON.stringify(signedState)}]);</script>`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(signedHtml, awemeId),
    [signedMediaUrl],
    'decoding the PACE envelope must not decode percent-escaped media signature parameters',
  );

  const splitState = `9:${JSON.stringify({
    videoDetail: {
      awemeId,
      video: { playAddr: [{ src: mediaUrl }] },
    },
  })}`;
  const splitAt = splitState.indexOf('videoDetail') + 5;
  const splitHtml = [splitState.slice(0, splitAt), splitState.slice(splitAt)]
    .map((chunk) => `<script>self.__pace_f.push([1, ${JSON.stringify(chunk)}]);</script>`)
    .join('');
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(splitHtml, awemeId),
    [mediaUrl],
    'React state split across consecutive PACE pushes must be reassembled within a bounded buffer',
  );

  const recommendationUrl = 'https://v11-web.douyinvod.com/recommendation-first.mp4';
  const multiRowState = [
    `5:${JSON.stringify({ videoDetail: { awemeId: 'recommendation-id', video: { playAddr: [{ src: recommendationUrl }] } } })}`,
    `6:${JSON.stringify({ videoDetail: { awemeId, video: { playAddr: [{ src: mediaUrl }] } } })}`,
  ].join('\n');
  const multiRowHtml = `<script>self.__pace_f.push([1, ${JSON.stringify(multiRowState)}]);</script>`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(multiRowHtml, awemeId),
    [mediaUrl],
    'all videoDetail rows must be inspected so a recommendation before the target cannot hide it',
  );
}

function runLegacyRouterDataCompatibilityTest() {
  const awemeId = '7673128661335166246';
  const legacyMediaUrl = 'https://aweme.snssdk.com/aweme/v1/play/?video_id=legacy-target';
  const legacyState = JSON.stringify({
    loaderData: {
      video: {
        aweme_id: awemeId,
        video: { play_addr: { url_list: [legacyMediaUrl] } },
      },
    },
  });
  const legacyHtml = `<script>window._ROUTER_DATA = ${legacyState};</script>`;

  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(legacyHtml, awemeId),
    [legacyMediaUrl],
    'legacy window._ROUTER_DATA pages must remain supported',
  );

  const unrelatedPaceState = encodeURIComponent(JSON.stringify({
    videoDetail: {
      awemeId: '9999999999999999999',
      video: { playAddr: [{ src: 'https://v11-web.douyinvod.com/unrelated.mp4' }] },
    },
  }));
  const mixedHtml = `<script>self.__pace_f.push([1, ${JSON.stringify(unrelatedPaceState)}]);</script>${legacyHtml}`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(mixedHtml, awemeId),
    [legacyMediaUrl],
    'an unrelated PACE payload must fall through to target-bound legacy router data',
  );

  const paceTargetMediaUrl = 'https://v11-web.douyinvod.com/target-primary.mp4';
  const paceTargetState = encodeURIComponent(JSON.stringify({
    videoDetail: {
      awemeId,
      video: { playAddr: [{ src: paceTargetMediaUrl }] },
    },
  }));
  const exactMixedHtml = `<script>self.__pace_f.push([1, ${JSON.stringify(paceTargetState)}]);</script>${legacyHtml}`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(exactMixedHtml, awemeId).sort(),
    [paceTargetMediaUrl, legacyMediaUrl].sort(),
    'exact target media from PACE and legacy router state must both remain available for download retry',
  );
}

function runDouyinPrimaryMediaFallbackWithoutExactIdTest() {
  const requestedAwemeId = '7673128661335166246';
  const paceMediaUrl = 'https://v11-web.douyinvod.com/video-tos-cn-p-0015/primary-fallback.mp4';
  const recommendationMediaUrl = 'https://v11-web.douyinvod.com/video-tos-cn-p-0015/recommendation.mp4';
  const paceState = encodeURIComponent(JSON.stringify({
    videoDetail: {
      awemeId: 'changed-or-unavailable-id',
      video: { playAddr: [{ src: paceMediaUrl }] },
    },
    recommendationList: [{
      awemeId: 'unrelated-recommendation-id',
      video: { playAddr: [{ src: recommendationMediaUrl }] },
    }],
  }));
  const paceHtml = `<script>self.__pace_f.push([1, ${JSON.stringify(paceState)}]);</script>`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(paceHtml, requestedAwemeId),
    [paceMediaUrl],
    'an explicit page-level videoDetail must outrank recommendations when its identity field is absent or changed',
  );
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(paceHtml, ''),
    [paceMediaUrl],
    'a short-link page must use its explicit primary video even before an aweme id is known',
  );

  const nestedRecommendationState = encodeURIComponent(JSON.stringify({
    recommendationList: [{
      videoDetail: {
        awemeId: 'unrelated-recommendation-id',
        video: { playAddr: [{ src: recommendationMediaUrl }] },
      },
    }],
  }));
  const nestedRecommendationHtml = `<script>self.__pace_f.push([1, ${JSON.stringify(nestedRecommendationState)}]);</script>`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(nestedRecommendationHtml, requestedAwemeId),
    [],
    'a nested recommendation videoDetail must not be promoted to the page primary video',
  );

  const legacyMediaUrl = 'https://aweme.snssdk.com/aweme/v1/play/?video_id=legacy-primary-fallback';
  const legacyHtml = `<script>window._ROUTER_DATA = ${JSON.stringify({
    loaderData: {
      video: {
        video: { play_addr: { url_list: [legacyMediaUrl] } },
      },
    },
  })};</script>`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(legacyHtml, requestedAwemeId),
    [legacyMediaUrl],
    'a legacy page with one explicit primary video must not fail only because its aweme id is missing',
  );


  const ambiguousState = [
    `3:${JSON.stringify({ videoDetail: { awemeId: 'other-1', video: { playAddr: [{ src: paceMediaUrl }] } } })}`,
    `4:${JSON.stringify({ videoDetail: { awemeId: 'other-2', video: { playAddr: [{ src: recommendationMediaUrl }] } } })}`,
  ].join('\n');
  const ambiguousHtml = `<script>self.__pace_f.push([1, ${JSON.stringify(ambiguousState)}]);</script>`;
  assert.deepStrictEqual(
    helpers.extractDouyinMediaUrlsFromShareHtml(ambiguousHtml, requestedAwemeId),
    [],
    'multiple unbound videoDetail candidates must not be guessed as the requested work',
  );
}

function runBrowserPaceStateFallbackContractTest() {
  const sourcePath = path.resolve(__dirname, pluginMainPath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /douyinPaceState\s*[,}]/,
    'the hidden browser must return its bounded Douyin PACE state snapshot',
  );
  assert.match(
    source,
    /resolveDouyinMediaFromShareHtml\(payload\s*&&\s*payload\.douyinPaceState/,
    'the hidden browser result must preserve exact and primary media layers from its PACE snapshot',
  );
  assert.match(
    source,
    /const captureDouyinState = isDouyinUrl\(url\)/,
    'short-link pages must capture PACE state even before an aweme id is available in the URL',
  );
  assert.match(
    source,
    /if \(paceStateResolution\.exactUrls\.length\)[\s\S]{0,180}?return paceStateResolution\.exactUrls/,
    'target-bound PACE media must be returned before generic browser network candidates',
  );
  assert.match(
    source,
    /shareStage\.stateFormat\s*=/,
    'copied diagnostics must identify whether the share page contained PACE or legacy Router state',
  );
  assert.match(
    source,
    /shareStage\.exactMediaCount\s*=\s*shareResolution\.exactUrls\.length/,
    'copied diagnostics must distinguish exact target media from a primary-player fallback',
  );
  assert.match(
    source,
    /shareStage\.primaryMediaCount\s*=\s*shareResolution\.primaryUrls\.length/,
    'copied diagnostics must record primary-player candidates without exposing their URLs',
  );
}

function runTargetPlayerInsideMixedIdentityContainerTest() {
  const targetAwemeId = '7644566503081119019';
  const targetMediaUrl = 'https://v11-weba.douyinvod.com/target-inside-feed/?mime_type=video_mp4';

  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId,
      finalUrl: `https://www.douyin.com/video/${targetAwemeId}`,
      canonicalUrl: `https://www.douyin.com/video/${targetAwemeId}`,
      domMediaCandidates: [{
        index: 0,
        urls: [targetMediaUrl],
        identityIds: [targetAwemeId, '9999999999999999999'],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 900000,
      }],
    }),
    [targetMediaUrl],
    'the visible playing target media must survive recommendation ids inherited from a shared feed container',
  );
}

runBrowserFallbackRequestKeepsNonStrictCurrentPageTest();
runHiddenDouyinRendererNeverCreatesVisibleChildWindowTest();
runHiddenDouyinChildWindowGuardTest();
runBrowserLoadFailureKeepsSafeDiagnosticCodeTest();
runDouyinPersistentLoginContractTest();
runLocalResolverFallbackContractTest();
runLegacyPlayerActivationAndPageMediaFallbackContractTest();
runPaceSsrStateMediaExtractionTest();
runLegacyRouterDataCompatibilityTest();
runDouyinPrimaryMediaFallbackWithoutExactIdTest();
runBrowserPaceStateFallbackContractTest();
runTargetBoundDomFallbackWithoutRouteIdentityTest();
runUniquePageIdentityFallbackTest();
runOnlyExplicitFinalRouteMismatchIsRejectedTest();
runTargetPlayerInsideMixedIdentityContainerTest();
runNoStableAwemeIdStillUsesPrimaryPlayerTest();
runDouyinBrowserSessionLockTest()
  .then(() => console.log('plugin-douyin-media.test.js passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
