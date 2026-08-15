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

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main.js');
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
    [],
    'mixed page identities must not turn a recommendation player into the requested work',
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
    [],
    'multiple equally unbound visible players remain ambiguous and must be rejected',
  );
}

runTargetBoundDomFallbackWithoutRouteIdentityTest();
runUniquePageIdentityFallbackTest();
console.log('plugin-douyin-media.test.js passed');
