const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-xhs-fallback-'));
os.homedir = () => home;
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'obsidian') return {
    Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {},
    Notice: class {}, requestUrl: async () => { throw new Error('Unexpected network'); },
  };
  return originalLoad.call(this, name, ...args);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;
const h = Plugin.__test;

const SHARE_URL = 'http://xhslink.com/a/abc123';
const XHS_NOTE_URL = 'https://www.xiaohongshu.com/explore/abc123';
const DOUYIN_URL = 'https://www.douyin.com/video/7644238277092174409';
const MEDIA_URL = 'https://sns-video-bd.xhscdn.com/stream/one.mp4';

function fixture() {
  const plugin = new Plugin();
  plugin.settings = h.mergeSettings({ aiProvider: 'local' });
  plugin.showSyncProgress = () => {};
  // The resume probe reads persisted submissions before the local attempt; the
  // tests below exercise the submission itself, not the resume bookkeeping.
  plugin.resumePendingCloudFallbackSubmission = async () => null;
  return plugin;
}

function stubGate(plugin, gate) {
  const calls = [];
  plugin.evaluateCloudFallbackUserGate = async (options = {}) => {
    calls.push(options);
    return gate;
  };
  return calls;
}

function stubSubmit(plugin, job) {
  const calls = [];
  plugin.submitCloudFallbackJob = async (payload) => {
    calls.push(payload);
    return job;
  };
  return calls;
}

async function run() {
  // 1. A Xiaohongshu media failure on the local path must reach the worker
  // queue before the retryable short-circuit turns it into another user-retry
  // record. The submission carries the original share link, not the CDN URL no
  // anonymous cloud node can fetch.
  {
    const plugin = fixture();
    plugin.runLocalTranscription = async () => {
      throw h.createRetryableXiaohongshuContentError({ reason: 'risk-control' });
    };
    const gateCalls = stubGate(plugin, { allowed: true });
    const submissions = stubSubmit(plugin, {
      status: 'succeeded',
      transcription: '云端识别结果',
      provider: 'xiaohongshu',
      providerRequestId: 'req-1',
    });
    const result = await plugin.runConfiguredTranscription(MEDIA_URL, {
      sourceUrl: SHARE_URL,
      binding: { token: 'PRO-1' },
      title: '小红书视频',
    });
    assert.equal(result.transcription, '云端识别结果');
    assert.equal(result.source, 'cloud-fallback');
    assert.equal(submissions.length, 1, 'the Xiaohongshu share link is submitted once');
    assert.equal(submissions[0].sourceType, 'xiaohongshu_url');
    assert.equal(submissions[0].sourceUrl, SHARE_URL);
    assert.equal(gateCalls.length, 1);
    assert.equal(gateCalls[0].requireDouyinLogin, undefined, 'a Xiaohongshu failure never asks for Douyin login');
    assert.equal(gateCalls[0].requireDouyinResolver, undefined);
  }

  // 2. A queued job is a pending record, never a transcription defect.
  {
    const plugin = fixture();
    plugin.runLocalTranscription = async () => {
      throw h.createRetryableXiaohongshuContentError({ reason: 'login-wall' });
    };
    stubGate(plugin, { allowed: true });
    stubSubmit(plugin, { status: 'queued', jobId: 'job-queued' });
    await assert.rejects(
      plugin.runConfiguredTranscription(MEDIA_URL, { sourceUrl: SHARE_URL, binding: { token: 'PRO-1' } }),
      (error) => error && error.code === 'CLOUD_FALLBACK_QUEUED',
    );
  }

  // 3. A retired note cannot be revived by a cloud node, so the paid worker is
  // never asked to chase it.
  {
    const plugin = fixture();
    plugin.runLocalTranscription = async () => {
      const error = h.createRetryableXiaohongshuContentError({ reason: 'link-expired' });
      error.linkExpired = true;
      throw error;
    };
    stubGate(plugin, { allowed: true });
    const submissions = stubSubmit(plugin, { status: 'queued', jobId: 'job-never' });
    await assert.rejects(
      plugin.runConfiguredTranscription(MEDIA_URL, { sourceUrl: SHARE_URL, binding: { token: 'PRO-1' } }),
      (error) => !/转写失败/.test(error.message),
    );
    assert.deepEqual(submissions, [], 'an expired Xiaohongshu link is not submitted');
  }

  // 4. A blocked gate leaves the Xiaohongshu content outcome intact: the user
  // must see a media message, never a transcription failure.
  {
    const plugin = fixture();
    plugin.runLocalTranscription = async () => {
      throw h.createRetryableXiaohongshuContentError({ reason: 'risk-control' });
    };
    stubGate(plugin, { allowed: false, message: '云端兜底未启用：请先完成小程序绑定。' });
    const submissions = stubSubmit(plugin, { status: 'succeeded', transcription: '不应出现' });
    await assert.rejects(
      plugin.runConfiguredTranscription(MEDIA_URL, { sourceUrl: SHARE_URL, binding: null }),
      (error) => !/转写失败/.test(error.message),
    );
    assert.deepEqual(submissions, []);
  }

  // 5. The added branch is Xiaohongshu-only: a Douyin failure keeps its own
  // route and never masquerades as a Xiaohongshu submission.
  {
    const plugin = fixture();
    plugin.runLocalTranscription = async () => { throw new Error('whisper failed'); };
    stubGate(plugin, { allowed: true });
    const submissions = stubSubmit(plugin, { status: 'succeeded', transcription: '不应出现' });
    await assert.rejects(
      plugin.runConfiguredTranscription('https://v3-web.douyinvod.com/one.mp4', {
        sourceUrl: DOUYIN_URL,
        binding: { token: 'PRO-1' },
      }),
      /whisper failed/,
    );
    assert.deepEqual(submissions, [], 'the Xiaohongshu branch must not fire for Douyin');
  }

  // 6. No media candidate at all: the cloud answer for a graphic note is the
  // note content, so the record completes instead of waiting for a transcript
  // that will never exist.
  {
    const plugin = fixture();
    const gateCalls = stubGate(plugin, { allowed: true });
    const submissions = stubSubmit(plugin, {
      status: 'succeeded',
      jobId: 'job-graphic',
      content: {
        markdown: '图文正文',
        title: '图文笔记',
        author: '作者',
        tags: ['标签'],
        imageUrls: ['https://sns-img-bd.xhscdn.com/one.jpg'],
      },
    });
    const saved = await plugin.buildTranscriptRecordFromMedia({
      _id: 'xhs-graphic',
      type: 'webpage',
      content: SHARE_URL,
      metadata: { url: SHARE_URL, webpageMediaType: 'audio_video' },
    }, {
      url: SHARE_URL,
      platform: '小红书',
      source: 'xiaohongshu',
      binding: { token: 'PRO-1' },
    });
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].sourceType, 'xiaohongshu_url');
    assert.equal(submissions[0].sourceUrl, SHARE_URL);
    assert.equal(gateCalls[0].requireDouyinLogin, undefined, 'the graphic-note gate needs no Douyin setup');
    assert.equal(saved.metadata.contentCategory, '图文');
    assert.equal(saved.metadata.conversionStatus, 'success');
    assert.equal(saved.metadata.webpageMediaType, '', 'a graphic note must not stay tagged as audio_video');
    assert.equal(saved.metadata.transcriptionError, '');
    assert.match(saved.metadata.markdown, /图文正文/);
    assert.deepEqual(saved.metadata.imageUrls, ['https://sns-img-bd.xhscdn.com/one.jpg']);
    assert.ok(!(saved.metadata.transcriptionStatus === 'failed'));
  }

  // 7. A denied gate is reported on the failed record so the user learns which
  // step is missing, and no job is created.
  {
    const plugin = fixture();
    stubGate(plugin, { allowed: false, message: '云端兜底未启用：请先完成小程序绑定。' });
    const submissions = stubSubmit(plugin, { status: 'queued', jobId: 'job-gate' });
    const saved = await plugin.buildTranscriptRecordFromMedia({
      _id: 'xhs-gated',
      type: 'webpage',
      content: SHARE_URL,
      metadata: { url: SHARE_URL },
    }, {
      url: SHARE_URL,
      platform: '小红书',
      source: 'xiaohongshu',
      binding: { token: 'FREE-1' },
    });
    assert.deepEqual(submissions, []);
    assert.equal(saved.metadata.transcriptionStatus, 'failed');
    assert.match(saved.metadata.transcriptionError, /云端兜底未启用/);
  }

  // 8. Douyin keeps its stricter gate: the resolver and login it lacked locally
  // are exactly what the cloud node must have.
  {
    const plugin = fixture();
    const gateCalls = stubGate(plugin, { allowed: false, message: '待安装组件：抖音解析组件未安装。' });
    stubSubmit(plugin, { status: 'queued', jobId: 'job-douyin' });
    await plugin.buildTranscriptRecordFromMedia({
      _id: 'douyin-no-media',
      type: 'webpage',
      content: DOUYIN_URL,
      metadata: { url: DOUYIN_URL },
    }, {
      url: DOUYIN_URL,
      platform: '抖音',
      source: 'douyin',
      binding: { token: 'PRO-1' },
    });
    assert.equal(gateCalls[0].requireDouyinLogin, true);
    assert.equal(gateCalls[0].requireDouyinResolver, true);
  }

  // 9. A non-platform URL is not eligible for the queue at all.
  {
    const plugin = fixture();
    const gateCalls = stubGate(plugin, { allowed: true });
    const submissions = stubSubmit(plugin, { status: 'queued', jobId: 'job-other' });
    await plugin.buildTranscriptRecordFromMedia({
      _id: 'other',
      type: 'webpage',
      content: 'https://example.com/article',
      metadata: { url: 'https://example.com/article' },
    }, {
      url: 'https://example.com/article',
      platform: '网页',
      source: 'webpage',
      binding: { token: 'PRO-1' },
    });
    assert.deepEqual(gateCalls, []);
    assert.deepEqual(submissions, []);
  }

  // 5b. A silent video and a missing local component are local verdicts: the
  // cloud node cannot hear speech that is not there, and the gate already
  // requires the component to be installed.
  {
    const quality = require('../obsidian-plugin/wechat-inbox-sync/src/transcription-quality-utils');
    const plugin = fixture();
    plugin.runLocalTranscription = async () => {
      throw quality.createNoSpeechTranscriptionError('(音乐)');
    };
    stubGate(plugin, { allowed: true });
    const submissions = stubSubmit(plugin, { status: 'queued', jobId: 'job-nospeech' });
    await assert.rejects(
      plugin.runConfiguredTranscription(MEDIA_URL, { sourceUrl: SHARE_URL, binding: { token: 'PRO-1' } }),
      (error) => error && error.code === 'TRANSCRIPTION_NO_SPEECH',
    );
    assert.deepEqual(submissions, [], 'a silent Xiaohongshu video is not queued');
  }
  {
    const plugin = fixture();
    plugin.runLocalTranscription = async () => {
      const error = new Error('请先安装本地转写组件');
      error.transcriptionSetupRequired = true;
      throw error;
    };
    stubGate(plugin, { allowed: true });
    const submissions = stubSubmit(plugin, { status: 'queued', jobId: 'job-setup' });
    await assert.rejects(
      plugin.runConfiguredTranscription(MEDIA_URL, { sourceUrl: SHARE_URL, binding: { token: 'PRO-1' } }),
      /本地转写组件/,
    );
    assert.deepEqual(submissions, [], 'a missing component is not queued');
  }

  // 10. The same guard holds for a full Xiaohongshu note URL, not only the
  // short share link.
  {
    const plugin = fixture();
    plugin.runLocalTranscription = async () => {
      throw h.createRetryableXiaohongshuContentError({ reason: 'risk-control' });
    };
    stubGate(plugin, { allowed: true });
    const submissions = stubSubmit(plugin, { status: 'succeeded', transcription: '云端识别结果' });
    const result = await plugin.runConfiguredTranscription(MEDIA_URL, {
      sourceUrl: XHS_NOTE_URL,
      binding: { token: 'PRO-1' },
    });
    assert.equal(result.source, 'cloud-fallback');
    assert.equal(submissions[0].sourceUrl, XHS_NOTE_URL);
  }

  // 11. Hydration treats either page signal — `isVideoNote` or a playable
  // `videoUrl` — as video intent, so neither may ever be reported alone. A
  // graphic note keeps both false and stays a content note.
  {
    const noteId = 'abcdef0123456789abcdef01';
    const noteUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
    const page = (note) => `<html><body><script>window.__INITIAL_STATE__=${
      JSON.stringify({ note: { noteDetailMap: { [noteId]: { note } } } })
    }</script></body></html>`;
    const video = h.extractXiaohongshuMarkdownFromHtml(page({
      noteId,
      title: '视频笔记',
      desc: '视频正文',
      type: 'video',
      video: { media: { stream: { h264: [{ masterUrl: MEDIA_URL }] } } },
    }), noteUrl, '', { includeComments: false });
    assert.equal(video.videoUrl, MEDIA_URL);
    assert.equal(video.isVideoNote, true, 'a page video URL always also reports video note');

    const graphic = h.extractXiaohongshuMarkdownFromHtml(page({
      noteId,
      title: '图文笔记',
      desc: '图文正文',
      type: 'normal',
      imageList: ['https://sns-img-qc.xhscdn.com/one.jpg'],
    }), noteUrl, '', { includeComments: false });
    assert.equal(graphic.videoUrl, '');
    assert.equal(graphic.isVideoNote, false);
  }

  console.log('plugin xiaohongshu cloud fallback tests passed');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
