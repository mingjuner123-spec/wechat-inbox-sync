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
  plugin.__noteRoot = root;
  plugin.app = { vault: { adapter: makeVaultAdapter(root) } };
  plugin.showSyncProgress = () => {};
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => '抖音笔记';
  plugin.saveSourceMediaAttachment = async record => record;
  plugin.getConfiguredLocalAsrInstallRoot = () => root;
  plugin.getActiveBindings = () => [];
  plugin.checkDouyinLogin = async () => true;
  plugin.fetchDouyinMediaResolutionWithSession = async () => { throw new Error('note route must stop before browser/API resolution'); };
  plugin.renderSocialMediaUrls = async () => { throw new Error('note route must stop before browser resolution'); };
  plugin.resolveDouyinMediaWithLocalResolver = async () => { throw new Error('note route must stop before yt-dlp'); };
  return { plugin, root };
}

function makeVaultAdapter(root) {
  const full = (vaultPath) => path.join(root, String(vaultPath || '').replace(/^\/+/, ''));
  return {
    write: async (vaultPath, data) => {
      fs.mkdirSync(path.dirname(full(vaultPath)), { recursive: true });
      fs.writeFileSync(full(vaultPath), data);
    },
    read: async (vaultPath) => fs.readFileSync(full(vaultPath), 'utf8'),
    exists: async (vaultPath) => fs.existsSync(full(vaultPath)),
    remove: async (vaultPath) => { try { fs.unlinkSync(full(vaultPath)); } catch (_) {} },
    getFullPath: (vaultPath) => full(vaultPath),
  };
}

function readWrittenNotes(root) {
  const results = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name.endsWith('.md')) results.push(fs.readFileSync(absolute, 'utf8'));
    }
  };
  visit(root);
  return results;
}

async function assertNoteSaved(plugin, sourceUrl, pageHtml, expectedText) {
  let calls = 0;
  requestUrl = async () => { calls += 1; return { status: 200, text: pageHtml }; };
  const record = {
    _id: `note-${Math.random()}`, type: 'webpage', createdAt: new Date().toISOString(),
    content: sourceUrl, metadata: { url: sourceUrl, webpageMediaType: 'audio_video' },
  };
  const saved = await plugin.writeRecord(record, new Date().toISOString());
  assert.ok(saved && saved.filePath, 'a Douyin note must be saved, not reported as a transcription failure');
  assert.ok(calls >= 1, 'the note page itself is fetched once for its content');
  const notes = readWrittenNotes(plugin.__noteRoot);
  assert.equal(notes.length, 1);
  assert.match(notes[0], expectedText);
  return notes[0];
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

  const notePage = (noteId, description, images) => `<html><body><script>window._ROUTER_DATA = ${JSON.stringify({
    loaderData: { [`note_${noteId}`]: { videoInfoRes: { item_list: [{
      aweme_id: noteId,
      desc: description,
      item_title: '抖音图文标题',
      images: images.map((url) => ({ url_list: [url] })),
    }] } } },
  })};</script></body></html>`;

  const direct = makePlugin('direct');
  const directNote = await assertNoteSaved(
    direct.plugin,
    note,
    notePage('1234567890123456789', '今天的图文笔记正文 #生活', ['https://p3.douyinpic.com/a.jpg']),
    /今天的图文笔记正文/,
  );
  assert.match(directNote, /!\[抖音笔记图片 1\]\(https:\/\/p3\.douyinpic\.com\/a\.jpg\)/);
  assert.doesNotMatch(directNote, /暂不支持转写/, 'a readable note is content, never an unsupported-transcription failure');

  const emptyNote = makePlugin('empty-note');
  const emptySaved = await assertNoteSaved(
    emptyNote.plugin,
    note,
    '<html><body>验证</body></html>',
    /原始链接/,
  );
  assert.ok(emptySaved.includes(note), 'the link is kept when the page yields no text');

  // A logged-out user gets an actionable prompt, not a silent link-only note:
  // the body of a Douyin note is only served to a logged-in session.
  {
    const loggedOut = makePlugin('logged-out');
    loggedOut.plugin.checkDouyinLogin = async () => false;
    let calls = 0;
    requestUrl = async () => { calls += 1; return { status: 200, text: '<html><body></body></html>' }; };
    await assert.rejects(
      loggedOut.plugin.writeRecord({
        _id: 'note-logged-out', type: 'webpage', createdAt: new Date().toISOString(),
        content: note, metadata: { url: note, webpageMediaType: 'audio_video' },
      }, new Date().toISOString()),
      (error) => /登录抖音/.test(error.message) && error.retryable === true,
    );
    assert.equal(readWrittenNotes(loggedOut.plugin.__noteRoot).length, 0, 'nothing is saved without a readable body');
  }

  const short = makePlugin('short');
  const replies = [
    { statusCode: 302, headers: { location: 'https://www.iesdouyin.com/share/note/1234567890123456789' } },
    { statusCode: 404, headers: {} },
  ];
  let headCalls = 0;
  let attemptedGetCalls = 0;
  https.request = (_url, options, callback) => {
    if (options.method === 'GET') {
      attemptedGetCalls += 1;
      return { end() { setImmediate(() => callback({ statusCode: 200, headers: {}, resume() {} })); } };
    }
    assert.equal(options.method, 'HEAD');
    headCalls += 1;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    req.end = () => setImmediate(() => callback({ ...replies.shift(), resume() {} }));
    return req;
  };
  await assertNoteSaved(
    short.plugin,
    'https://v.douyin.com/fixture-shortlink/',
    notePage('1234567890123456789', '短链图文正文', ['https://p3.douyinpic.com/b.jpg']),
    /短链图文正文/,
  );
  assert.ok(headCalls >= 1, 'short-link resolution still runs before the note page is read');
  assert.equal(attemptedGetCalls, 0, 'the note page is read through requestUrl, never a raw GET');

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
