const assert = require('assert');
const {
  createDouyinMediaResolutionDiagnosticBuilder,
} = require('../obsidian-plugin/wechat-inbox-sync/src/social-media-diagnostic-utils');

function run() {
  const buildDiagnostic = createDouyinMediaResolutionDiagnosticBuilder({
    getSafeUrlDiagnostic: (url) => ({ host: new URL(url).hostname }),
    getTransportErrorDiagnostic: (error) => ({ code: error.code, status: error.status, message: error.message }),
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
    selectedStage: '',
    finalOutcome: '',
    stages: [{
      stage: 'share-page',
      inputKind: '',
      ok: false,
      attempted: true,
      mediaCount: 0,
      detailFound: false,
      error: { code: 'HTTP_403' },
      identityOutcome: '',
      rejectionReason: '',
      durationMs: 0,
    }],
    downloadAttempts: [],
  });

  const traced = buildDiagnostic({
    sourceUrl: 'https://v.douyin.com/example',
    resolvedUrl: 'https://www.douyin.com/',
    awemeId: '7644566503081119019',
    selectedStage: 'targeted-browser',
    finalOutcome: 'transcription-ready',
    stages: [{
      stage: 'targeted-browser',
      inputKind: 'original-page',
      attempted: true,
      ok: true,
      mediaCount: 1,
      identityOutcome: 'page-unique-single-player',
      durationMs: 421,
      mediaUrl: 'https://douyinvod.com/secret.mp4',
      headers: { Cookie: 'secret-cookie', Authorization: 'Bearer secret' },
      error: {
        code: 'HTTP_403 token=secret-code',
        status: 403,
        message: 'GET https://douyinvod.com/private.mp4?token=secret-url Cookie: sid=secret-cookie; pref=secret-pref Authorization: Bearer secret-auth token=secret-token openid=secret-openid',
      },
    }],
    downloadAttempts: [{
      transport: 'node-http',
      ok: false,
      status: 403,
      code: 'HTTP_403 token=download-secret',
      bytes: -10,
      refreshed: false,
      durationMs: 50,
      url: 'https://douyinvod.com/private.mp4?token=secret',
      headers: { Cookie: 'secret-cookie' },
    }, {
      transport: 'browser-session',
      ok: true,
      mediaType: 'video/mp4',
      bytes: Number.MAX_SAFE_INTEGER,
      refreshed: false,
      durationMs: 90,
    }],
    token: 'secret-token',
    openid: 'secret-openid',
  });
  assert.strictEqual(traced.selectedStage, 'targeted-browser');
  assert.strictEqual(traced.finalOutcome, 'transcription-ready');
  assert.strictEqual(traced.stages[0].inputKind, 'original-page');
  assert.strictEqual(traced.stages[0].identityOutcome, 'page-unique-single-player');
  assert.strictEqual(traced.stages[0].error.code, 'UNKNOWN');
  assert.strictEqual(traced.stages[0].error.status, 403);
  assert.strictEqual(traced.stages[0].error.message, undefined);
  assert.strictEqual(traced.downloadAttempts[0].status, 403);
  assert.strictEqual(traced.downloadAttempts[0].code, 'UNKNOWN');
  assert.strictEqual(traced.downloadAttempts[0].bytes, 0);
  assert.strictEqual(traced.downloadAttempts[1].bytes, 16 * 1024 * 1024 * 1024);
  const serialized = JSON.stringify(traced);
  assert.strictEqual(serialized.includes('douyinvod.com'), false);
  assert.strictEqual(serialized.includes('secret-cookie'), false);
  assert.strictEqual(serialized.includes('secret-auth'), false);
  assert.strictEqual(serialized.includes('secret-code'), false);
  assert.strictEqual(serialized.includes('download-secret'), false);
  assert.strictEqual(serialized.includes('secret-url'), false);
  assert.strictEqual(serialized.includes('secret-token'), false);
  assert.strictEqual(serialized.includes('secret-openid'), false);
}

run();
console.log('social-media-diagnostic-utils tests passed');