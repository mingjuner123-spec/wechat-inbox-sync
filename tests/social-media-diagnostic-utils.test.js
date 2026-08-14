const assert = require('assert');
const {
  createDouyinMediaResolutionDiagnosticBuilder,
} = require('../obsidian-plugin/wechat-inbox-sync/src/social-media-diagnostic-utils');

function run() {
  const buildDiagnostic = createDouyinMediaResolutionDiagnosticBuilder({
    getSafeUrlDiagnostic: (url) => ({ host: new URL(url).hostname }),
    getTransportErrorDiagnostic: (error) => ({ code: error.code }),
  });
  assert.deepStrictEqual(buildDiagnostic({
    sourceUrl: 'https://v.douyin.com/example',
    resolvedUrl: 'https://www.douyin.com/video/123',
    awemeId: 'abc',
    mediaCandidateCount: 2,
    preciseMediaFound: true,
    saveOriginalMediaEnabled: true,
    stages: [{ stage: 'share-page', ok: false, mediaCount: 0, error: { code: 'HTTP_403' } }],
  }), {
    source: { host: 'v.douyin.com' },
    resolved: { host: 'www.douyin.com' },
    awemeId: 'abc',
    mediaCandidateCount: 2,
    preciseMediaFound: true,
    saveOriginalMediaEnabled: true,
    stages: [{
      stage: 'share-page',
      ok: false,
      mediaCount: 0,
      detailFound: false,
      error: { code: 'HTTP_403' },
    }],
  });
}

run();
console.log('social-media-diagnostic-utils tests passed');
