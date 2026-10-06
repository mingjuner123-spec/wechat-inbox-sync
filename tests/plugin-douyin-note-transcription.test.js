'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const diagnostic = require('../obsidian-plugin/wechat-inbox-sync/src/douyin-diagnostic-utils');
const reporter = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-note-route-'));
const originalLoad = Module._load;
const originalHttpsRequest = https.request;
let requestUrl = async () => ({ status: 200 });
Module._load = function patchedLoad(id, parent, isMain) {
  if (id === 'obsidian') return {
    Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {}, Notice: class {},
    normalizePath: value => String(value || '').replace(/\\/g, '/'),
    requestUrl: (...args) => requestUrl(...args),
  };
  if (String(id).endsWith('.ps1') || String(id).endsWith('.sh') || String(id).endsWith('.py')) return '';
  if (id === 'electron') return { remote: { session: { fromPartition: () => ({ cookies: { get: async () => [] } }) } } };
  return originalLoad.call(this, id, parent, isMain);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');

function makePlugin(label) {
  const root = path.join(scratch, label);
  fs.mkdirSync(root, { recursive: true });
  const plugin = new Plugin();
  plugin.settings = { inboxDir: 'Inbox', noteSaveMode: 'root', notePropertyFields: [], aiProvider: 'off' };
  plugin.app = { vault: { adapter: {} } };
  plugin.showSyncProgress = () => {};
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => '抖音笔记';
  plugin.saveSourceMediaAttachment = async record => record;
  plugin.getConfiguredLocalAsrInstallRoot = () => root;
  plugin.getActiveBindings = () => [];
  plugin.checkDouyinLogin = async () => { throw new Error('note route must stop before login/ASR resolution'); };
  plugin.fetchDouyinMediaResolutionWithSession = async () => { throw new Error('note route must stop before browser/API resolution'); };
  plugin.renderSocialMediaUrls = async () => { throw new Error('note route must stop before browser resolution'); };
  plugin.resolveDouyinMediaWithLocalResolver = async () => { throw new Error('note route must stop before yt-dlp'); };
  return { plugin, root };
}

async function assertWriteFailure(plugin, sourceUrl, expectedRequests) {
  let calls = 0;
  requestUrl = async () => { calls += 1; return { status: 200 }; };
  const record = {
    _id: `note-${Math.random()}`, type: 'webpage', createdAt: new Date().toISOString(),
    content: sourceUrl, metadata: { url: sourceUrl, webpageMediaType: 'audio_video' },
  };
  let failure;
  await assert.rejects(plugin.writeRecord(record, new Date().toISOString()), error => {
    failure = error;
    return error.message === diagnostic.failureMessage('DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED');
  });
  assert.equal(calls, expectedRequests, 'no page GET or media download should follow a recognized note route');
  assert.equal(failure.code, 'TRANSCRIPTION_FAILED');
  assert.equal(failure.diagnostic.failureCode, 'DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED');
  assert.equal(failure.diagnostic.stages[0].stage, 'note-route');
  assert.equal(failure.diagnostic.stages[0].error.code, 'DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED');
  assert.equal(failure.diagnostic.cookieState, 'unknown');

  let queuedEvent;
  plugin.queueSyncDiagnosticEvent = event => {
    queuedEvent = reporter.normalizeDiagnosticEvent(event, { now: new Date().toISOString() });
    return { queued: true };
  };
  assert.equal(plugin.queueSyncDiagnosticFailure({
    recordId: record._id, attemptId: 'note-attempt', diagnosticId: 'note-diagnostic',
    binding: { token: 'fixture-token' }, error: failure, stage: 'processing', retryCount: 0, sourceUrl,
  }).queued, true);
  const report = JSON.parse(queuedEvent.technicalReport.text);
  assert.equal(report.failure.message, diagnostic.failureMessage('DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED'));
  assert.equal(report.failure.mediaResolutionDiagnostic.failureCode, 'DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED');
  assert.ok(report.failure.mediaResolutionDiagnostic.stages.some(stage => stage.stage === 'note-route'));
  assert.equal(queuedEvent.sourceUrl, sourceUrl.split('?')[0]);
  assert.doesNotMatch(JSON.stringify(queuedEvent), /fixture-token/);
}

async function run() {
  const note = 'https://www.douyin.com/note/1234567890123456789';
  assert.deepEqual(diagnostic.noteRoute(note), { kind: 'note', idLength: 19 });
  assert.deepEqual(diagnostic.noteRoute('https://www.iesdouyin.com/share/note/1234567890123456789/'), { kind: 'share-note', idLength: 19 });
  for (const url of [
    'https://douyin.com.attacker.test/note/1234567890123456789',
    'https://notdouyin.com/note/1234567890123456789',
    'https://douyin.com:8443/note/1234567890123456789',
    'https://user@douyin.com/note/1234567890123456789',
    'http://www.douyin.com/note/1234567890123456789',
  ]) assert.equal(diagnostic.noteRoute(url), null, `must reject untrusted/ambiguous host ${url}`);
  assert.equal(diagnostic.noteRoute('https://www.douyin.com/video/1234567890123456789'), null);
  assert.equal(diagnostic.sanitize({ failureCode: 'DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED' }).failureCode, 'DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED');

  const direct = makePlugin('direct');
  await assertWriteFailure(direct.plugin, note, 0);

  const short = makePlugin('short');
  const replies = [
    { statusCode: 302, headers: { location: 'https://www.iesdouyin.com/share/note/1234567890123456789' } },
    { statusCode: 404, headers: {} },
  ];
  const modeledGetResponse = { statusCode: 200, body: '<html>note page</html>' };
  let headCalls = 0;
  let attemptedGetCalls = 0;
  https.request = (_url, options, callback) => {
    if (options.method === 'GET') {
      attemptedGetCalls += 1;
      return { end() { setImmediate(() => callback({ statusCode: modeledGetResponse.statusCode, headers: {}, resume() {} })); } };
    }
    assert.equal(options.method, 'HEAD');
    headCalls += 1;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    req.end = () => setImmediate(() => callback({ ...replies.shift(), resume() {} }));
    return req;
  };
  await assertWriteFailure(short.plugin, 'https://v.douyin.com/fixture-shortlink/', 0);
  assert.equal(headCalls, 2, 'short-link resolver should follow the single 302 to a terminal HEAD 404');
  assert.equal(modeledGetResponse.statusCode, 200, 'fixture models a note page whose GET is successful despite HEAD 404');
  assert.equal(attemptedGetCalls, 0, 'recognized note must stop before GET, independent of the GET-200 page response');
  const videoShort = makePlugin('video-short');
  const videoReplies = [
    { statusCode: 302, headers: { location: 'https://www.douyin.com/video/1234567890123456789' } },
    { statusCode: 404, headers: {} },
  ];
  let videoHeadCalls = 0;
  let videoPageRequests = 0;
  https.request = (_url, options, callback) => {
    assert.equal(options.method, 'HEAD');
    videoHeadCalls += 1;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    req.end = () => setImmediate(() => callback({ ...videoReplies.shift(), resume() {} }));
    return req;
  };
  requestUrl = async () => {
    videoPageRequests += 1;
    return { status: 200, text: '<html><title>视频</title></html>' };
  };
  await videoShort.plugin.hydrateWebpageMarkdown({
    _id: 'video-short-negative', type: 'webpage', createdAt: new Date().toISOString(),
    content: 'https://v.douyin.com/video-fixture/',
    metadata: { url: 'https://v.douyin.com/video-fixture/', webpageMediaType: 'audio_video' },
  }, 'Inbox', '2026-10-06', '视频');
  assert.equal(videoHeadCalls, 2, 'video short-link fixture follows redirect to terminal HEAD 404');
  assert.ok(videoPageRequests > 0, 'terminal video URL continues normal page handling instead of note early-stop');
  assert.equal(diagnostic.noteRoute('https://www.douyin.com/video/1234567890123456789'), null);
  https.request = originalHttpsRequest;

  assert.equal(diagnostic.noteRoute('https://www.douyin.com/video/1234567890123456789'), null, 'ordinary video URLs remain outside the note branch');
  assert.equal(diagnostic.noteRoute('https://www.douyin.com/note/1234567890123456789?share_token=hidden').kind, 'note');
  console.log('plugin-douyin-note-transcription.test.js passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  https.request = originalHttpsRequest;
  fs.rmSync(scratch, { recursive: true, force: true });
});
