'use strict';

const assert = require('assert');
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
    helpers.buildDouyinBrowserFallbackRequest(
      'https://v.douyin.com/example/',
      'https://www.douyin.com/video/7644566503081119019',
    ),
    {
      awemeId: '7644566503081119019',
      url: 'https://www.douyin.com/video/7644566503081119019',
      strictDouyinTarget: true,
    },
    'a resolved target id should keep the precise browser path as the preferred request',
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
runTargetBoundDomFallbackWithoutRouteIdentityTest();
runUniquePageIdentityFallbackTest();
runOnlyExplicitFinalRouteMismatchIsRejectedTest();
runTargetPlayerInsideMixedIdentityContainerTest();
runNoStableAwemeIdStillUsesPrimaryPlayerTest();
console.log('plugin-douyin-media.test.js passed');
