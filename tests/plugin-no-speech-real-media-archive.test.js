'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const diagnosticsRoot = process.env.CHANNELS_REPRO_DIR
  || path.join(os.homedir(), '.wechat-inbox-diagnostics', 'setup-20261002', 'channels-repro-20261007');
const sourcePath = path.join(diagnosticsRoot, 'source.private.json');
const resolvePath = path.join(diagnosticsRoot, 'resolve.private.json');
const mediaPath = path.join(diagnosticsRoot, 'channels-h264.private.mp4');

async function run() {
  if (![sourcePath, resolvePath, mediaPath].every((item) => fs.existsSync(item))) {
    console.log('SKIP no local Channels source/resolve/media fixture');
    return;
  }

  const sourcePayload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const resolvePayload = JSON.parse(fs.readFileSync(resolvePath, 'utf8'));
  const resolveData = resolvePayload && resolvePayload.data || {};
  const sourceRecord = sourcePayload && sourcePayload.record || {};
  const sourceUrl = String(sourceRecord.metadata && sourceRecord.metadata.url || '').trim();
  const mediaBuffer = fs.readFileSync(mediaPath);
  assert.ok(sourceUrl, 'source fixture must provide the original URL');
  assert.ok(resolveData.h264_url || resolveData.h265_url, 'resolve fixture must provide a media URL');
  assert.ok(mediaBuffer.length > 0, 'cached original media must be non-empty');

  const originalHomedir = os.homedir;
  const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-no-speech-media-'));
  os.homedir = () => testHome;
  const originalLoad = Module._load;
  const textExtensions = ['.ps1', '.sh', '.py'];
  const priorLoaders = new Map(textExtensions.map((extension) => [extension, Module._extensions[extension]]));
  for (const extension of textExtensions) {
    Module._extensions[extension] = (module, filename) => { module.exports = fs.readFileSync(filename, 'utf8'); };
  }
  Module._load = function load(request, parent, isMain) {
    if (request === 'obsidian') {
      return {
        Plugin: class {},
        PluginSettingTab: class {},
        Setting: class {},
        Modal: class {},
        Notice: class {},
        requestUrl: async () => { throw new Error('Unexpected network'); },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');
  for (const [extension, loader] of priorLoaders) {
    if (loader) Module._extensions[extension] = loader;
    else delete Module._extensions[extension];
  }
  Module._load = originalLoad;
  const helpers = Plugin.__test;

  const normalized = helpers.normalizeWechatChannelsFeedPayload({ data: resolveData });
  const mediaUrl = String(resolveData.h264_url || resolveData.h265_url || '').trim();
  const prepared = {
    mediaUrl,
    source: 'wechat-channels-media-prepare',
    title: String(normalized.title || '').trim(),
    author: String(resolveData.author || normalized.author || '').trim(),
    description: String(normalized.description || resolveData.description || '').trim(),
    tags: Array.isArray(normalized.tags) ? normalized.tags.slice() : [],
    coverUrl: String(normalized.coverUrl || resolveData.cover_url || '').trim(),
    socialMetrics: normalized.socialMetrics && typeof normalized.socialMetrics === 'object'
      ? { ...normalized.socialMetrics }
      : {},
    mediaPreparedByCloud: false,
  };
  assert.ok(prepared.title, 'product title mapping must retain the real description title');
  assert.ok(prepared.author, 'product record mapping must retain the real author');
  assert.ok(prepared.description, 'product record mapping must retain the real description');
  assert.ok(prepared.coverUrl, 'product record mapping must retain the real cover');
  assert.ok(prepared.tags.length > 0, 'product record mapping must retain source tags');
  const sourceStats = resolveData.stats && typeof resolveData.stats === 'object' ? resolveData.stats : {};
  assert.ok(Object.prototype.hasOwnProperty.call(sourceStats, 'favorites'), 'real resolve must expose favorites');
  assert.ok(Object.prototype.hasOwnProperty.call(sourceStats, 'forwards'), 'real resolve must expose forwards');
  assert.ok(Object.prototype.hasOwnProperty.call(prepared.socialMetrics, 'collects'), 'Channels mapping must retain raw favorites');
  assert.ok(Object.prototype.hasOwnProperty.call(prepared.socialMetrics, 'shares'), 'Channels mapping must retain raw forwards');
  assert.equal(prepared.socialMetrics.collects, Number(sourceStats.favorites));
  assert.equal(prepared.socialMetrics.shares, Number(sourceStats.forwards));
  const sourceRecordForProduct = {
    ...sourceRecord,
    type: 'webpage',
    content: sourceUrl,
    metadata: { ...(sourceRecord.metadata || {}) },
  };
  const sourceMarkdown = helpers.buildWechatChannelsSourceMarkdown(prepared);
  const noSpeechError = Object.assign(new Error('未检测到可转写的语音。'), {
    code: 'TRANSCRIPTION_NO_SPEECH',
    noSpeechEvidence: 'full-decode-and-vad-no-speech-segments',
  });
  // Contract fixture for the actual prepareWechatChannelsMedia method; this is not a live response capture.
  const prepareResponse = {
    data: {
      mediaUrl: prepared.mediaUrl,
      source: prepared.source,
      title: prepared.title,
      author: prepared.author,
      description: prepared.description,
      tags: prepared.tags,
      coverUrl: prepared.coverUrl,
      // This models the /media/prepare response contract. It intentionally
      // uses raw Channels aliases to exercise the product-side wrapper; it
      // is synthetic and is not a live backend response capture.
      socialMetrics: {
        likes: sourceStats.likes,
        comments: sourceStats.comments,
        favorites: sourceStats.favorites,
        forwards: sourceStats.forwards,
      },
      mediaPreparedByCloud: prepared.mediaPreparedByCloud,
    },
  };

  function makePlugin(saveOriginalMediaEnabled, failure = '') {
    const plugin = new Plugin();
    plugin.settings = helpers.mergeSettings({
      aiProvider: 'local',
      inboxDir: '临时收集',
      noteSaveMode: 'root',
      saveOriginalMediaEnabled,
      notePropertyFields: 'title,author,url,source,views,likes,collects,comments,shares,metrics_captured_at',
    });
    plugin.showSyncProgress = () => {};
    plugin.ensureProFeatureAccess = async () => {
      if (failure === 'pro') throw new Error('保存原始音视频到本地需要有效 Pro。');
      return { hasAccess: true, status: 'active' };
    };
    const prepareCalls = [];
    plugin.requestJson = async (requestPath, method, body) => {
      assert.equal(requestPath, '/media/prepare');
      assert.equal(method, 'POST');
      assert.equal(body.source, 'wechat-channels-local-transcription');
      prepareCalls.push({ requestPath, method });
      return prepareResponse;
    };
    plugin.runConfiguredTranscription = async () => { throw noSpeechError; };
    const files = new Map();
    const binaries = [];
    plugin.app = {
      vault: {
        adapter: {
          write: async (filePath, value) => files.set(filePath, value),
          exists: async (filePath) => files.has(filePath),
          remove: async (filePath) => files.delete(filePath),
          writeBinary: async (filePath, value) => {
            if (failure === 'write') throw new Error('隔离 vault 写入失败');
            binaries.push({ filePath, value: Buffer.from(value) });
          },
        },
        create: async (filePath, value) => files.set(filePath, value),
      },
    };
    plugin.ensureFolder = async () => {};
    plugin.nextRecordTitle = async () => '视频号原始说明';
    plugin.nextTitle = async () => '视频号原始说明';
    plugin.alignSocialArticleImageFolder = async (record) => ({ record, folderName: '视频号原始说明' });
    plugin.downloadArrayBuffer = async () => {
      if (failure === 'download') throw new Error('隔离媒体下载失败');
      return mediaBuffer;
    };
    return { plugin, files, binaries, prepareCalls };
  }

  async function hydrate(plugin) {
    return plugin.hydrateWechatChannelsTranscript(
      sourceRecordForProduct,
      sourceUrl,
      null,
      prepared.title,
      {},
    );
  }

  function assertRetainedMetadata(record) {
    const metadata = record.metadata || {};
    assert.equal(metadata.transcriptionStatus, 'no_speech');
    assert.equal(metadata.conversionStatus, 'no_speech');
    assert.equal(metadata.transcription, '');
    assert.equal(metadata.noSpeechEvidence, 'full-decode-and-vad-no-speech-segments');
    assert.equal(metadata.url, sourceUrl);
    assert.equal(metadata.title, prepared.title);
    assert.equal(metadata.sourceTitle, prepared.title);
    assert.equal(metadata.author, prepared.author);
    assert.equal(metadata.description, prepared.description);
    assert.equal(metadata.coverUrl, prepared.coverUrl);
    assert.deepEqual(metadata.keywords, prepared.tags);
    for (const key of Object.keys(prepared.socialMetrics)) {
      assert.equal(metadata.socialMetrics[key], prepared.socialMetrics[key]);
    }
    assert.ok(metadata.markdown.includes('![视频封面](' + prepared.coverUrl + ')'));
    assert.ok(metadata.markdown.includes(prepared.description));
    for (const tag of prepared.tags) assert.ok(metadata.markdown.includes(tag));
  }

  async function commitCase(saveOriginalMediaEnabled, failure = '') {
    const harness = makePlugin(saveOriginalMediaEnabled, failure);
    const hydrated = await hydrate(harness.plugin);
    assert.equal(harness.prepareCalls.length, 1, 'hydrate must use the actual prepareWechatChannelsMedia request path');
    assertRetainedMetadata(hydrated);
    harness.plugin.hydrateWebpageMarkdown = async () => hydrated;
    const originalSaveSourceMediaAttachment = harness.plugin.saveSourceMediaAttachment.bind(harness.plugin);
    harness.plugin.saveSourceMediaAttachment = async (...args) => {
      harness.savedRecord = await originalSaveSourceMediaAttachment(...args);
      return harness.savedRecord;
    };
    const result = await harness.plugin.writeRecord(
      sourceRecordForProduct,
      '2026-10-08T00:00:00.000Z',
      null,
      false,
      { skipAi: true },
    );
    const note = harness.files.get(result.filePath);
    assert.equal(typeof note, 'string');
    return { ...harness, hydrated, result, note };
  }

  const off = await commitCase(false);
  assert.equal(off.binaries.length, 0, 'off must not save a local media attachment');
  assert.match(off.note, /本次未检测到可转写语音，已保存原内容和链接/);
  assert.ok(off.note.includes(prepared.coverUrl));
  assert.ok(off.note.includes(prepared.description));
  assert.ok(off.note.includes(sourceUrl));
  assert.match(off.note, /^collects: /m);
  assert.match(off.note, /^shares: /m);
  assert.doesNotMatch(off.note, /!\[\[.*\.mp4\]\]/);

  const on = await commitCase(true);
  assert.equal(on.binaries.length, 1, 'on must save the cached original video');
  assert.equal(on.binaries[0].value.length, mediaBuffer.length);
  assert.equal(
    crypto.createHash('sha256').update(on.binaries[0].value).digest('hex'),
    crypto.createHash('sha256').update(mediaBuffer).digest('hex'),
  );
  assert.ok(on.savedRecord.metadata.sourceMediaAttachmentPath, 'on must expose the local attachment path');
  assert.ok(on.note.includes('## 原始音视频'));
  assert.match(on.note, /!\[\[.*\.mp4\]\]/);
  assert.match(on.note, /本次未检测到可转写语音，已保存原内容和链接/);
  assert.ok(on.note.includes(prepared.coverUrl));
  assert.ok(on.note.includes(prepared.description));
  assert.ok(on.note.includes(sourceUrl));
  assert.match(on.note, /^collects: /m);
  assert.match(on.note, /^shares: /m);

  const failed = await commitCase(true, 'pro');
  assert.equal(failed.binaries.length, 0);
  assert.match(failed.note, /保存原始音视频到本地需要有效 Pro/);
  assert.match(failed.note, /原始内容和来源已保留/);
  assert.doesNotMatch(failed.note, /!\[\[.*\.mp4\]\]/);
  assert.ok(failed.note.includes(prepared.coverUrl));
  assert.ok(failed.note.includes(prepared.description));
  assert.ok(failed.note.includes(sourceUrl));

  const writeFailed = await commitCase(true, 'write');
  assert.equal(writeFailed.binaries.length, 0);
  assert.match(writeFailed.note, /无法保存到本地/);
  assert.match(writeFailed.note, /原始内容和来源已保留/);
  assert.doesNotMatch(writeFailed.note, /!\[\[.*\.mp4\]\]/);
  assert.ok(writeFailed.note.includes(prepared.coverUrl));
  assert.ok(writeFailed.note.includes(prepared.description));
  assert.ok(writeFailed.note.includes(sourceUrl));

  fs.rmSync(testHome, { recursive: true, force: true });
  os.homedir = originalHomedir;
  console.log('PASS real Channels no-speech metadata and media archive: on/off/failure isolated vault');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
