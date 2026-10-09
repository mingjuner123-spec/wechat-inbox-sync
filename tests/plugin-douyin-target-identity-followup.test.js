'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createDouyinMediaHelpers } = require('../obsidian-plugin/wechat-inbox-sync/src/douyin-media-utils');

const flattenStrings = value => {
  const output = [];
  const visit = item => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (typeof item === 'string' && item) output.push(item);
  };
  visit(value);
  return output;
};
const helpers = createDouyinMediaHelpers({
  normalizeBrowserCapturedMediaUrls: flattenStrings,
  sortMediaUrlsForTranscription: urls => [...new Set(flattenStrings(urls))],
});

const TARGET_ID = '123456789012';
const OTHER_ID = '987654321098';
const TARGET_MEDIA = 'https://media.example/target.mp4';
const OTHER_MEDIA = 'https://media.example/recommendation.mp4';

function testDomRequiresTargetIdentity() {
  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId: TARGET_ID,
      domMediaCandidates: [{
        urls: [TARGET_MEDIA],
        identityIds: [TARGET_ID],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 100,
      }],
    }),
    [TARGET_MEDIA],
  );
  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId: TARGET_ID,
      domMediaCandidates: [{
        urls: [OTHER_MEDIA],
        identityIds: [],
        isPlaying: true,
        visible: true,
        intersectsViewport: true,
        area: 1000,
      }],
      primaryDomMediaUrls: [OTHER_MEDIA],
    }),
    [],
    'a playing recommendation without an identity must not satisfy a target request',
  );
  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId: TARGET_ID,
      domMediaCandidates: [{ urls: [OTHER_MEDIA], identityIds: [OTHER_ID], isPlaying: true }],
    }),
    [],
    'a different aweme identity must not satisfy the target request',
  );
}

function testShortLinkNeedsPageIdentity() {
  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      finalUrl: `https://www.douyin.com/video/${TARGET_ID}`,
      domMediaCandidates: [{ urls: [TARGET_MEDIA], identityIds: [TARGET_ID] }],
    }),
    [TARGET_MEDIA],
  );
  assert.deepStrictEqual(
    helpers.selectIdentityBoundDouyinBrowserMedia({
      domMediaCandidates: [{ urls: [OTHER_MEDIA], identityIds: [] }],
      primaryDomMediaUrls: [OTHER_MEDIA],
    }),
    [],
    'a short link with no recognized page identity must fail closed',
  );
}

function testPayloadPrimaryFallbackIsNotUsable() {
  const unverified = helpers.resolveDouyinMediaFromPayloads([{
    videoDetail: {
      aweme_id: OTHER_ID,
      video: { play_addr: { url_list: [OTHER_MEDIA] } },
    },
  }], TARGET_ID);
  assert.deepStrictEqual(unverified.exactUrls, []);
  assert.deepStrictEqual(unverified.primaryUrls, []);
  assert.strictEqual(unverified.identityOutcome, 'unverified-primary-player');

  const exact = helpers.resolveDouyinMediaFromPayloads([{
    aweme_detail: {
      aweme_id: TARGET_ID,
      video: { play_addr: { url_list: [TARGET_MEDIA] } },
    },
  }], TARGET_ID);
  assert.deepStrictEqual(exact.exactUrls, [TARGET_MEDIA]);
  assert.deepStrictEqual(exact.primaryUrls, []);
  assert.strictEqual(exact.identityOutcome, 'target-id-matched');
}

function testQualityRetryUsesGlobalAttemptNumberForLogBaseline() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'src', 'main.js'),
    'utf8',
  );
  assert.ok(source.includes('attemptLogBaseline.get(attemptNumber)'), 'quality retry must read its attempt-scoped baseline');
  assert.strictEqual(source.includes('attemptLogBaseline.get(attempt),'), false, 'local retry index must not be used for the baseline');
}

testDomRequiresTargetIdentity();
testShortLinkNeedsPageIdentity();
testPayloadPrimaryFallbackIsNotUsable();
testQualityRetryUsesGlobalAttemptNumberForLogBaseline();


function testPageRecommendationsCannotBindTarget() {
  for (const targetAwemeId of [TARGET_ID, '']) {
    assert.deepStrictEqual(helpers.selectIdentityBoundDouyinBrowserMedia({
      targetAwemeId, pageIdentityIds: [TARGET_ID, OTHER_ID],
      domMediaCandidates: [{ urls: [OTHER_MEDIA], identityIds: [OTHER_ID], isPlaying: true }],
    }), []);
  }
  assert.deepStrictEqual(helpers.selectIdentityBoundDouyinBrowserMedia({
    targetAwemeId: TARGET_ID, canonicalUrl: 'https://www.douyin.com/video/' + OTHER_ID,
    domMediaCandidates: [{ urls: [OTHER_MEDIA], identityIds: [OTHER_ID] }],
  }), []);
  assert.deepStrictEqual(helpers.selectIdentityBoundDouyinBrowserMedia({
    finalUrl: 'https://www.douyin.com/video/' + TARGET_ID,
    canonicalUrl: 'https://www.douyin.com/video/' + OTHER_ID,
    domMediaCandidates: [{ urls: [OTHER_MEDIA], identityIds: [OTHER_ID] }],
  }), []);
  assert.deepStrictEqual(helpers.selectIdentityBoundDouyinBrowserMedia({
    canonicalUrl: 'https://www.douyin.com/video/' + TARGET_ID,
    domMediaCandidates: [{ urls: [TARGET_MEDIA], identityIds: [TARGET_ID] }],
  }), [TARGET_MEDIA]);
  const node = id => ({ getAttribute: key => key === 'data-aweme-id' ? id : '' });
  const player = node(OTHER_ID); player.parentElement = node(TARGET_ID);
  const extract = require('node:vm').runInNewContext(helpers.buildDouyinDomIdentityExtractorScript() + '; collectIdentityIds');
  assert.deepStrictEqual(Array.from(extract(player)), [OTHER_ID], 'nearest owner identity must exclude feed ancestors');
}

async function testHydrationRequiresActualEvidence() {
  const Module = require('node:module'), os = require('node:os');
  const prior = Module._load;
  Module._load = function(id, parent, main) {
    if (/\.(?:ps1|sh|py)$/i.test(id)) return '';
    if (id === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, requestUrl: async () => ({ text: '<html></html>', status: 200 }) };
    if (id === 'electron') return { remote: { session: { fromPartition: () => ({ cookies: { get: async () => [] } }) } } };
    return prior.call(this, id, parent, main);
  };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-identity-test-'));
  try {
    const Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');
    const diagnostic = require('../obsidian-plugin/wechat-inbox-sync/src/douyin-diagnostic-utils');
    const resolver = require('../obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils');
    const media = 'https://v3.douyinvod.com/fixture.mp4';
    const url = 'https://www.douyin.com/video/' + TARGET_ID;
    for (const mode of ['strict-only', 'detail-only', 'browser-proof', 'resolver-missing', 'resolver-other', 'resolver-match']) {
      const plugin = new Plugin(); plugin.settings = { aiProvider: 'off' };
      plugin.getConfiguredLocalAsrInstallRoot = () => scratch;
      plugin.checkDouyinLogin = async () => false;
      plugin.fetchDouyinMediaResolutionWithSession = async () => ({ mediaUrls: [], stages: [] });
      plugin.renderSocialMediaUrls = async (_url, options) => {
        if (mode.startsWith('resolver')) return [];
        assert.strictEqual(options.strictDouyinTarget, true);
        if (mode === 'detail-only') options.onDouyinTargetDetail({ aweme_id: TARGET_ID });
        if (mode === 'browser-proof') options.onDouyinBrowserDiagnostic({ identityOutcome: 'target-id-matched', preciseMediaFound: true });
        return [media];
      };
      plugin.resolveDouyinMediaWithLocalResolver = async () => {
        if (!mode.startsWith('resolver')) return { mediaUrls: [] };
        return resolver.extractLocalDouyinResolverMetadata(JSON.stringify({
          ...(mode === 'resolver-missing' ? {} : { id: mode === 'resolver-other' ? OTHER_ID : TARGET_ID }), url: media,
        }), TARGET_ID);
      };
      let hydrated = 0;
      plugin.hydrateWebpageAudioVideo = async record => { hydrated++; return record; };
      await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: url, metadata: { url } }, '', '', 'fixture');
      const accepted = ['browser-proof', 'resolver-match'].includes(mode);
      const latest = diagnostic.read(scratch).at(-1);
      assert.strictEqual(latest.outcome, accepted ? 'success' : 'failed', mode);
      if (!accepted) assert.strictEqual(hydrated, 0, mode + ': unverified media never reaches ASR');
    }
  } finally {
    Module._load = prior;
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
testPageRecommendationsCannotBindTarget();
testHydrationRequiresActualEvidence().then(() => console.log('PASS: Douyin identity pure and real hydration regressions')).catch(error => { console.error(error); process.exitCode = 1; });
