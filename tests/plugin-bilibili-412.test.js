const assert = require('assert');
const Module = require('module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-diagnostic-'));
os.homedir = () => testHome;
const notices = [];
const bilibiliDiagnostic = require('../obsidian-plugin/wechat-inbox-sync/src/bilibili-diagnostic-utils');

let requestUrlMock = async () => ({ status: 200, text: '' });
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      App: class {},
      Plugin: class {},
      PluginSettingTab: class {},
      Setting: class {},
      Notice: class { constructor(text) { notices.push(text); } },
      TFile: class {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: (...args) => requestUrlMock(...args),
      MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main.js');
const helpers = PluginClass.__test;

function createPlugin() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    aiProvider: 'off',
    settingsVersion: 2,
    saveOriginalMediaEnabled: false,
  });
  plugin.hasProFeatureAccess = async () => true;
  return plugin;
}

async function testPage412FallsThroughAndRefreshesExpiredMedia() {
  const plugin = createPlugin();
  const sourceUrl = 'https://www.bilibili.com/video/BV412FLOW?share_source=copy_web&token=secret';
  const requests = [];
  let playurlCalls = 0;
  const transcribedUrls = [];

  requestUrlMock = async ({ url }) => {
    requests.push(url);
    if (url.includes('/x/web-interface/view')) {
      return {
        status: 200,
        json: {
          code: 0,
          data: {
            cid: 123,
            title: 'Bilibili 412 recovery',
            desc: 'API metadata survives a blocked page.',
            pic: 'https://img.example.com/cover.jpg',
            pages: [{ page: 1, cid: 123 }],
          },
        },
      };
    }
    if (url.includes('/x/player/v2')) {
      return { status: 200, json: { code: 0, data: {} } };
    }
    if (url === sourceUrl) {
      return { status: 412, text: '' };
    }
    if (url.includes('/x/player/playurl')) {
      playurlCalls += 1;
      if (playurlCalls === 2) return { status: 412, text: '' };
      const mediaUrl = 'https://upos.example.com/expired.m4s';
      return {
        status: 200,
        json: {
          code: 0,
          data: {
            dash: {
              audio: [{
                baseUrl: mediaUrl,
                backupUrl: playurlCalls === 1 ? ['https://backup.example.com/also-fails.m4s'] : [],
              }],
            },
          },
        },
      };
    }
    throw new Error(`unexpected request ${url}`);
  };

  plugin.requestBilibiliResourceViaNode = async (url) => {
    if (url === sourceUrl) return { status: 412, text: '' };
    if (url.includes('/x/player/playurl')) {
      return {
        status: 200,
        json: {
          code: 0,
          data: { dash: { audio: [{ baseUrl: 'https://upos.example.com/fresh.m4s' }] } },
        },
      };
    }
    throw new Error(`unexpected node fallback ${url}`);
  };
  plugin.runConfiguredTranscription = async (mediaUrl) => {
    transcribedUrls.push(mediaUrl);
    if (mediaUrl.includes('expired.m4s')) {
      const error = new Error('Request failed, status 412');
      error.status = 412;
      throw error;
    }
    if (mediaUrl.includes('also-fails.m4s')) {
      const error = new Error('Request failed, status 500');
      error.status = 500;
      throw error;
    }
    return { transcription: 'Recovered transcript', source: 'local' };
  };

  const record = await plugin.hydrateBilibiliTranscript({
    type: 'webpage',
    content: sourceUrl,
    metadata: { url: sourceUrl },
  }, sourceUrl, null, 'Bilibili 412 recovery');

  assert.strictEqual(record.metadata.transcriptionStatus, 'success');
  assert.strictEqual(record.metadata.transcription, 'Recovered transcript');
  assert.strictEqual(requests[0].includes('/x/web-interface/view'), true, 'view API should be first');
  assert.strictEqual(playurlCalls, 2, 'playurl should be refreshed exactly once');
  assert.deepStrictEqual(transcribedUrls, [
    'https://upos.example.com/expired.m4s',
    'https://backup.example.com/also-fails.m4s',
    'https://upos.example.com/fresh.m4s',
  ]);

  const diagnostic = record.metadata.mediaResolutionDiagnostic;
  assert.ok(diagnostic);
  assert.strictEqual(diagnostic.platform, 'bilibili');
  assert.strictEqual(diagnostic.source, undefined, 'raw endpoint metadata is not retained');
  assert.strictEqual(JSON.stringify(diagnostic).includes('token=secret'), false);
  assert.ok(diagnostic.stages.some((stage) => (
    stage.stage === 'page-fetch'
    && stage.ok === false
    && stage.error.status === 412
  )));
  assert.ok(diagnostic.stages.some((stage) => stage.stage === 'audio-playurl-refresh' && stage.ok === true));
  assert.ok(diagnostic.stages.some((stage) => (
    stage.stage === 'audio-playurl-refresh'
    && stage.transport === 'obsidian-requestUrl'
    && stage.ok === false
    && stage.error.status === 412
  )));
  assert.ok(diagnostic.stages.some((stage) => (
    stage.stage === 'audio-playurl-refresh'
    && stage.transport === 'node-http'
    && stage.ok === true
  )));
  assert.strictEqual(diagnostic.mediaCandidateCount, 3);
}

async function testFailedPlayerSubtitleFallsBackToPageSubtitleOnce() {
  const plugin = createPlugin();
  const sourceUrl = 'https://www.bilibili.com/video/BVSUBFALLBACK';
  const badSubtitleUrl = 'https://subtitle.example.com/expired.json';
  const goodSubtitleUrl = 'https://subtitle.example.com/page.json';
  const requests = [];
  let nodeBadSubtitleCalls = 0;

  requestUrlMock = async ({ url }) => {
    requests.push(url);
    if (url.includes('/x/web-interface/view')) {
      return { status: 200, json: { code: 0, data: { cid: 789, pages: [{ page: 1, cid: 789 }] } } };
    }
    if (url.includes('/x/player/v2')) {
      return {
        status: 200,
        json: { code: 0, data: { subtitle: { subtitles: [{ subtitle_url: badSubtitleUrl }] } } },
      };
    }
    if (url === badSubtitleUrl) return { status: 412, text: '' };
    if (url === sourceUrl) {
      return { status: 200, text: `<script>{"subtitle_url":"${goodSubtitleUrl}"}</script>` };
    }
    if (url === goodSubtitleUrl) {
      return { status: 200, json: { body: [{ content: 'Page subtitle fallback' }] } };
    }
    throw new Error(`unexpected request ${url}`);
  };
  plugin.requestBilibiliResourceViaNode = async (url) => {
    assert.strictEqual(url, badSubtitleUrl);
    nodeBadSubtitleCalls += 1;
    return { status: 412, text: '' };
  };
  plugin.runConfiguredTranscription = async () => {
    throw new Error('media transcription should not run');
  };

  const record = await plugin.hydrateBilibiliTranscript({
    type: 'webpage',
    content: sourceUrl,
    metadata: { url: sourceUrl },
  }, sourceUrl, null, 'Subtitle fallback');

  assert.strictEqual(record.metadata.transcriptionStatus, 'success');
  assert.strictEqual(record.metadata.transcription, 'Page subtitle fallback');
  assert.strictEqual(requests.filter((url) => url === badSubtitleUrl).length, 1);
  assert.strictEqual(nodeBadSubtitleCalls, 1);
  assert.strictEqual(requests.filter((url) => url === goodSubtitleUrl).length, 1);
  assert.strictEqual(requests.some((url) => url.includes('/x/player/playurl')), false);
}

async function testSubtitleHappyPathSkipsPageAndPlayurl() {
  const plugin = createPlugin();
  const sourceUrl = 'https://www.bilibili.com/video/BVSUBTITLE1';
  const requests = [];

  requestUrlMock = async ({ url }) => {
    requests.push(url);
    if (url.includes('/x/web-interface/view')) {
      return {
        status: 200,
        json: { code: 0, data: { cid: 456, title: 'Subtitle first', pages: [{ page: 1, cid: 456 }] } },
      };
    }
    if (url.includes('/x/player/v2')) {
      return {
        status: 200,
        json: {
          code: 0,
          data: { subtitle: { subtitles: [{ subtitle_url: 'https://subtitle.example.com/one.json' }] } },
        },
      };
    }
    if (url === 'https://subtitle.example.com/one.json') {
      return { status: 200, json: { body: [{ content: 'Subtitle transcript' }] } };
    }
    throw new Error(`unexpected request ${url}`);
  };
  plugin.requestBilibiliResourceViaNode = async () => {
    throw new Error('node fallback should not run');
  };
  plugin.runConfiguredTranscription = async () => {
    throw new Error('media transcription should not run');
  };

  const record = await plugin.hydrateBilibiliTranscript({
    type: 'webpage',
    content: sourceUrl,
    metadata: { url: sourceUrl },
  }, sourceUrl, null, 'Subtitle first');

  assert.strictEqual(record.metadata.transcriptionStatus, 'success');
  assert.strictEqual(record.metadata.transcription, 'Subtitle transcript');
  assert.strictEqual(requests.includes(sourceUrl), false, 'page HTML should remain lazy');
  assert.strictEqual(requests.some((url) => url.includes('/x/player/playurl')), false);
}

function testBilibiliHelpers() {
  assert.deepStrictEqual(helpers.extractBilibiliAudioUrlsFromPlayurlPayload({
    data: {
      dash: {
        audio: [{
          baseUrl: 'https://upos.example.com/main.m4s',
          backupUrl: [
            'https://backup-a.example.com/audio.m4s',
            'https://backup-b.example.com/audio.m4s',
          ],
        }],
      },
    },
  }), [
    'https://upos.example.com/main.m4s',
    'https://backup-a.example.com/audio.m4s',
    'https://backup-b.example.com/audio.m4s',
  ]);
  assert.strictEqual(
    helpers.getTransportErrorDiagnostic(new Error('Request failed, status 412')).status,
    412,
  );
}

async function testDiagnosticChangesPreserveRequestFallbacks() {
  for (const fixture of [
    { response: { status: 412, text: '' }, fallback: true },
    { response: { json: { code: -412 } }, fallback: true },
    { response: { status: 0, json: { code: -412 } }, fallback: true },
    { response: { status: 200, json: { code: -412 } }, fallback: false },
    { response: { status: 403, json: { code: -412 } }, fallback: false },
  ]) {
    const plugin = createPlugin();
    let fallbackCalls = 0;
    const recovered = { status: 200, json: { code: 0, data: { recovered: true } } };
    requestUrlMock = async () => fixture.response;
    plugin.requestBilibiliResourceViaNode = async () => { fallbackCalls++; return recovered; };
    const trace = { platform: 'bilibili', stages: [] };
    const request = plugin.requestBilibiliResource('https://api.bilibili.com/x/web-interface/view?bvid=fixture', 'view-api', trace);
    if (fixture.fallback) assert.strictEqual(await request, recovered);
    else await assert.rejects(request, error => error.apiCode === -412 && error.status === fixture.response.status);
    assert.strictEqual(fallbackCalls, fixture.fallback ? 1 : 0, JSON.stringify(fixture.response));
    const failure = bilibiliDiagnostic.sanitize(trace).stages[0].error;
    assert.strictEqual(failure.apiCode, fixture.response.json?.code || 0);
    assert.strictEqual(failure.status, fixture.response.status >= 400 ? fixture.response.status : 0);
  }
}

async function testSpecificFailureAndPersistentHistory() {
  const plugin = createPlugin();
  const sourceUrl = 'https://www.bilibili.com/video/BVTESTCAUSE?token=private-link';
  requestUrlMock = async ({ url }) => url.includes('/x/web-interface/view')
    ? { status: 200, json: { code: -412, message: 'server-private-response' } }
    : { status: 412, text: 'private-page' };
  plugin.requestBilibiliResourceViaNode = async url => requestUrlMock({ url });
  const record = await plugin.hydrateBilibiliTranscript({ _id: 'failed-bili', type: 'webpage', content: sourceUrl, metadata: { url: sourceUrl } }, sourceUrl);
  assert.strictEqual(record.metadata.transcriptionStatus, 'failed');
  assert.match(record.metadata.transcriptionError, /视频信息接口：API -412/);
  assert.match(record.metadata.transcriptionError, /视频网页：HTTP 412/);
  const trace = record.metadata.mediaResolutionDiagnostic;
  assert.ok(trace.stages.some(s => s.stage === 'view-api' && s.error.apiCode === -412 && s.error.status === 0), 'HTTP 200 with API -412 must not become HTTP 412');
  assert.ok(trace.stages.some(s => s.stage === 'page-fetch' && s.error.status === 412 && s.error.apiCode === 0));

  // The real automatic share-text write gate must not hide the specific reason.
  plugin.settings.inboxDir = 'fixture';
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => 'fixture';
  plugin.showSyncProgress = () => {};
  plugin.hydrateWebpageMarkdown = async () => record;
  let failure;
  await assert.rejects(plugin.writeRecord({ ...record, type: 'text' }, new Date().toISOString()), error => {
    failure = error;
    return /API -412/.test(error.message) && error.diagnostic.source === 'automatic-webpage';
  });

  const polluted = { ...trace, url: sourceUrl, title: 'private-title', headers: { Cookie: 'private-cookie' }, stack: 'private-stack',
    stages: trace.stages.map(stage => ({ ...stage, error: { ...stage.error, message: sourceUrl + ' private-message', Cookie: 'private-cookie', stack: 'private-stack' } })) };
  failure.diagnostic.cause = polluted;
  const binding = { token: 'TEST-123', label: 'fixture', status: 'bound', enabled: true };
  const configure = (p, saved = {}) => {
    p.settings = helpers.mergeSettings({ apiBase: 'https://example.com/sync', clientId: 'fixture', bindings: [binding], ...saved });
    p.showSyncProgress = () => {}; p.clearSyncProgressNotice = () => {};
    p.getConfiguredLocalAsrInstallRoot = () => testHome;
    p.findExistingRecordNotePath = async () => '';
    p.findRecoveredWechatArticleNotePath = async () => '';
    p.saveData = async data => { p.savedSettings = structuredClone(data); };
  };
  configure(plugin);
  plugin.requestJson = async route => route === '/records?status=pending'
    ? { data: [{ _id: 'failed-bili', type: 'webpage', content: sourceUrl }] }
    : { success: true, data: { schemaVersion: 1, records: [{ recordId: 'failed-bili', status: 'failed' }] } };
  plugin.writeRecord = async () => { throw failure; };
  await plugin.syncInbox(true);
  assert.ok(notices.some(text => text.includes('API -412')), 'first actual notice has specific cause');
  assert.match(JSON.stringify(plugin.lastSyncDiagnostic.failureDetails), /apiCode/);
  const retained = plugin.getRecentSyncFailures()[0].diagnostic;
  assert.strictEqual(retained.cause.stages[0].error.apiCode, -412);
  for (const value of ['private-link', 'private-title', 'private-cookie', 'private-stack', 'private-message', 'server-private-response', 'bilibili.com']) {
    assert.ok(!JSON.stringify(plugin.savedSettings.recentSyncFailures).includes(value), value + ' must not persist');
  }
  const reloaded = createPlugin(); configure(reloaded, plugin.savedSettings);
  assert.match(reloaded.getSyncDiagnosticText({ detailed: true }), /"apiCode": -412/, 'copy immediately after restart retains safe API codes');
  reloaded.requestJson = async route => route === '/records?status=pending'
    ? { data: [] } : { success: true, data: { schemaVersion: 1, records: [{ recordId: 'failed-bili', status: 'failed' }] } };
  await reloaded.syncInbox(true);
  assert.strictEqual(reloaded.lastSyncDiagnostic.historicalFailures[0].diagnostic.cause.stages[0].error.apiCode, -412);
  assert.match(reloaded.getSyncDiagnosticText({ detailed: true }), /API -412/);
  const count = notices.filter(text => text.includes('API -412')).length;
  assert.strictEqual(count, 1, 'historical causes remain visible in diagnostics without another notice');

  // Direct webpage errors (without the automatic wrapper) also survive reload.
  await reloaded.updateRecentSyncFailures({ failed: [{ recordId: 'direct-bili', bindingToken: binding.token, message: 'fixture', diagnostic: polluted }] });
  const directReload = helpers.mergeSettings(reloaded.settings);
  assert.strictEqual(directReload.recentSyncFailures.find(x => x.recordId === 'direct-bili').diagnostic.platform, 'bilibili');
}

async function testTimeoutAndEmptyResponses() {
  const plugin = createPlugin(); const url = 'https://www.bilibili.com/video/BVTIMEOUT';
  const timeout = Object.assign(new Error('Request timed out https://private.invalid/?token=secret'), { code: 'ETIMEDOUT' });
  requestUrlMock = async () => { throw timeout; };
  plugin.requestBilibiliResourceViaNode = async () => { throw timeout; };
  let result = await plugin.hydrateBilibiliTranscript({ type: 'webpage', metadata: { url } }, url);
  assert.match(result.metadata.transcriptionError, /请求超时.*ETIMEDOUT/);
  assert.ok(!JSON.stringify(result.metadata.mediaResolutionDiagnostic).includes('private.invalid'));
  requestUrlMock = async () => ({ status: 200, text: '', json: { code: 0, data: {} } });
  result = await plugin.hydrateBilibiliTranscript({ type: 'webpage', metadata: { url } }, url);
  assert.match(result.metadata.transcriptionError, /未获取到可用字幕或音视频地址/);
  assert.strictEqual(bilibiliDiagnostic.sanitize({ platform: 'douyin', stages: [] }), null);
  assert.strictEqual(bilibiliDiagnostic.sanitize({ source: 'automatic-webpage', cause: { platform: 'douyin' } }), null);

  const diagnostic = { platform: 'bilibili', stages: [], mediaCandidateCount: 1 };
  plugin.runConfiguredTranscription = async () => { throw Object.assign(new Error('Request failed, status 403 at https://private.invalid/'), { status: 403, channelsStage: 'download' }); };
  result = await plugin.buildTranscriptRecordFromMedia({ type: 'webpage', metadata: {} }, { url, platform: 'B站', mediaUrl: 'https://media.example.com/test.mp4', mediaResolutionDiagnostic: diagnostic });
  assert.match(result.metadata.transcriptionError, /音视频下载：HTTP 403/);
  assert.strictEqual(result.metadata.transcriptionStatus, 'failed');
  plugin.runConfiguredTranscription = async () => { throw new Error('本地转写命令没有返回文本'); };
  result = await plugin.buildTranscriptRecordFromMedia({ type: 'webpage', metadata: {} }, { url, platform: 'B站', mediaUrl: 'https://media.example.com/test.mp4', mediaResolutionDiagnostic: { platform: 'bilibili', stages: [] } });
  assert.match(result.metadata.transcriptionError, /语音转写：转写未返回文本/);
  const rejectedFields = bilibiliDiagnostic.sanitize({ platform: 'bilibili', stages: [{ stage: 'page-fetch', transport: 'node-http', error: { status: Infinity, apiCode: 'private-key', code: 'private-code', message: 'private-text' } }] });
  assert.deepStrictEqual(rejectedFields.stages[0].error, { status: 0, apiCode: 0, code: '', reason: 'unknown' });
}

async function run() {
  testBilibiliHelpers();
  await testPage412FallsThroughAndRefreshesExpiredMedia();
  await testFailedPlayerSubtitleFallsBackToPageSubtitleOnce();
  await testSubtitleHappyPathSkipsPageAndPlayurl();
  await testDiagnosticChangesPreserveRequestFallbacks();
  await testSpecificFailureAndPersistentHistory();
  await testTimeoutAndEmptyResponses();
  console.log('plugin-bilibili-412 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
});
