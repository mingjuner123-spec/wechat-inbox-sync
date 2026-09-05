const assert = require('assert');
const Module = require('module');

let requestUrlMock = async () => ({ status: 200, text: '' });
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
  assert.deepStrictEqual(diagnostic.source, { protocol: 'https', host: 'bilibili.com' });
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

async function run() {
  testBilibiliHelpers();
  await testPage412FallsThroughAndRefreshesExpiredMedia();
  await testFailedPlayerSubtitleFallsBackToPageSubtitleOnce();
  await testSubtitleHappyPathSkipsPageAndPlayurl();
  console.log('plugin-bilibili-412 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
});
