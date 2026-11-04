'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const x = require('../obsidian-plugin/wechat-inbox-sync/src/x-article');
const { sanitizePlatformArticleDiagnostic } = require('../obsidian-plugin/wechat-inbox-sync/src/platform-article-utils');

const tweetId = '2115810173830750575';
const postUrl = `https://x.com/notkvtwts/status/${tweetId}?s=20`;
const fxPayload = {
  code: 200,
  status: {
    id: tweetId,
    text: 'Example X article text.',
    created_at: '2026-11-03T06:30:00Z',
    author: { name: 'Example author' },
    media: { photos: [{ url: 'https://pbs.twimg.com/media/example.jpg' }] },
  },
};

async function main() {
  const post = x.normalizeFxTweet(fxPayload, tweetId);
  assert.equal(post.text, 'Example X article text.');
  assert.equal(post.images.length, 1);
  const safeVideo = 'https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/example.mp4?tag=12';
  const fxVideo = x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, media: { ...fxPayload.status.media, videos: [{ url: safeVideo }] } } }, tweetId);
  assert.deepEqual(fxVideo.videos, [safeVideo]);
  assert.equal(fxVideo.hasVideo, true);
  const fxVideoOnly = x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, text: '', media: { videos: [{ url: safeVideo }] } } }, tweetId);
  assert.equal(fxVideoOnly.text, ''); assert.equal(fxVideoOnly.hasVideo, true); assert.deepEqual(fxVideoOnly.videos, [safeVideo]);
  const fxArticle = x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, text: '', article: { title: 'Fx article', content: [{ text: 'Article body.' }] }, media: {} } }, tweetId);
  assert.equal(fxArticle.title, 'Fx article'); assert.match(fxArticle.text, /Article body/);
  const fxTitleOnlyBody = x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, text: '', article: { title: 'Headline!', content: [{ text: ' headline ' }] }, media: { photos: [{ url: 'https://pbs.twimg.com/media/title.jpg' }] } } }, tweetId);
  assert.equal(fxTitleOnlyBody.text, '', 'FxEmbed article title repeated as body is not accepted as substantive text');
  const fxNoteTitleOnly = x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, text: '', note_tweet: { note_tweet_results: { result: { title: 'Headline!', content: { blocks: [{ text: ' headline ' }] } } } }, media: { photos: [{ url: 'https://pbs.twimg.com/media/note-title.jpg' }] } } }, tweetId);
  assert.equal(fxNoteTitleOnly.text, '', 'FxEmbed nested note_tweet title repeated as body is not accepted as substantive text');
  const fxFlatNoteTitleOnly = x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, text: '', note_tweet: { title: 'Headline', text: 'Headline' }, media: { photos: [{ url: 'https://pbs.twimg.com/media/flat-note-title.jpg' }] } } }, tweetId);
  assert.equal(fxFlatNoteTitleOnly.text, '', 'FxEmbed flat note_tweet title repeated as body is not accepted as substantive text');
  for (const malformed of [
    { article: { title: 'Only title' } },
    { article: { title: 'Headline', preview_text: 'Preview only' } },
    { text: 'Read more' },
    { text: 'Read more →' },
    { text: '阅读全文' },
    { text: 'https://x.com/i/article/123' },
  ]) assert.throws(() => x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, text: '', ...malformed, media: {} } }, tweetId), /正文、图片或视频/);
  for (const unsafe of [
    'http://video.twimg.com/ext_tw_video/123/example.mp4',
    'https://video.twimg.com.evil.example/ext_tw_video/123/example.mp4',
    'https://user@video.twimg.com/ext_tw_video/123/example.mp4',
    'https://video.twimg.com/ext_tw_video/123/example.m3u8',
  ]) {
    assert.equal(x.videoUrl(unsafe), '', `unsafe or unsupported video URL accepted: ${unsafe}`);
  }
  assert.equal(x.renderPost(fxVideo).includes('视频未转写'), false);
  assert.throws(() => x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, id: '9' } }, tweetId), /与原链接不一致/);
  assert.throws(() => x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, id: '9', text: '', media: {} } }, tweetId), /不一致/);
  assert.throws(() => x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, text: '', media: {} } }, tweetId), /正文、图片或视频/);
  assert.throws(() => x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, text: { secret: 'value' } } }, tweetId), { code: 'X_FXEMBED_INVALID_PAYLOAD' });
  for (const photos of [
    [{ url: 'https://evil.example/tracker.jpg' }],
    [{ url: 'https://pbs.twimg.com/media/safe.jpg' }, { url: 'https://evil.example/tracker.jpg' }],
  ]) {
    assert.throws(() => x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, media: { photos } } }, tweetId), { code: 'X_FXEMBED_IMAGE_INVALID' });
  }
  assert.throws(() => x.normalizeFxTweet({ ...fxPayload, status: { ...fxPayload.status, media: { photos: {} } } }, tweetId), { code: 'X_FXEMBED_INVALID_PAYLOAD' });
  assert.throws(() => x.normalizeFxTweet({ ...fxPayload, code: 429 }, tweetId), { code: 'X_FXEMBED_RATE_LIMITED' });

  let calls = [];
  const recovered = await x.fetchPost(postUrl, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return { __typename: 'Tweet', id_str: 'other', text: 'mismatch' };
    return fxPayload;
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result/);
  assert.equal(calls[1].url, `https://api.fxtwitter.com/2/thread/${tweetId}`);
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.credentials, undefined);
  assert.equal(calls[1].options.headers.Cookie, undefined);
  assert.equal(new URL(calls[1].url).search, '', 'the original X query string is not sent to FxEmbed');
  assert.equal(recovered.text, fxPayload.status.text);

  calls = [];
  const primary = await x.fetchPost(postUrl, async url => {
    calls.push(url);
    return { __typename: 'Tweet', id_str: tweetId, text: 'Primary path still works.' };
  });
  assert.equal(calls.length, 1, 'successful primary extraction must not call the fallback');
  assert.equal(primary.text, 'Primary path still works.');

  const primaryVideo = await x.fetchPost(postUrl, async () => ({
    __typename: 'Tweet', id_str: tweetId, text: 'Video post.',
    mediaDetails: [{ type: 'video', video_info: { variants: [
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/123/playlist.m3u8' },
      { content_type: 'video/mp4', bitrate: 256000, url: safeVideo },
    ] } }],
  }));
  assert.deepEqual(primaryVideo.videos, [safeVideo]);

  let failureCalls = 0;
  await assert.rejects(x.fetchPost(postUrl, async () => {
    failureCalls++;
    if (failureCalls === 1) throw Object.assign(new Error('private primary body'), { status: 429 });
    throw Object.assign(new Error('private fallback body'), { status: 503 });
  }), error => {
    assert.equal(error.code, 'X_FXEMBED_HTTP_ERROR');
    assert.equal(error.xArticleProvider, 'both');
    assert.equal(error.xSyndicationErrorCode, 'X_RATE_LIMITED');
    assert.equal(error.status, 503);
    assert.ok(!error.message.includes('private'));
    return true;
  });

  await assert.rejects(x.fetchPost(postUrl, async () => ({}), null, { skipSyndication: true, skipFxEmbed: true }), { code: 'X_FXEMBED_RATE_LIMITED' });
  let unavailableCalls = 0;
  await assert.rejects(x.fetchPost(postUrl, async () => { unavailableCalls++; return unavailableCalls === 1 ? {} : null; }), error => {
    assert.equal(error.code, 'X_FXEMBED_UNAVAILABLE');
    assert.equal(error.status, undefined, 'status 0 is not exposed as an HTTP response');
    return true;
  });
  let timeoutCalls = 0;
  await assert.rejects(x.fetchPost(postUrl, async () => {
    timeoutCalls++;
    if (timeoutCalls === 1) throw Object.assign(new Error('primary offline'), { status: 503 });
    throw Object.assign(new Error('request timeout'), { code: 'X_REQUEST_TIMEOUT' });
  }), { code: 'X_FXEMBED_TIMEOUT' });

  const abortController = new AbortController();
  let abortCalls = 0;
  const pending = x.fetchPost(postUrl, async () => {
    abortCalls++;
    if (abortCalls === 1) throw Object.assign(new Error('primary offline'), { status: 503 });
    return new Promise(resolve => setTimeout(() => resolve(fxPayload), 100));
  }, abortController.signal);
  setTimeout(() => abortController.abort(), 5);
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(abortCalls, 2, 'an in-flight fallback is cancelled without another request');

  const pluginBundlePath = require.resolve('../obsidian-plugin/wechat-inbox-sync/main');
  const originalLoad = Module._load;
  Module._load = function loadObsidian(name, ...rest) {
    if (name === 'obsidian') return {
      Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, Setting: class {},
      requestUrl: (...args) => requestMock(...args),
    };
    return originalLoad.call(this, name, ...rest);
  };
  let requestMock = async () => ({});
  let Plugin;
  try { delete require.cache[pluginBundlePath]; Plugin = require(pluginBundlePath); }
  finally { Module._load = originalLoad; }

  const plugin = new Plugin();
  plugin.settings = Plugin.__test.mergeSettings({ completedSyncReceipts: [] });
  plugin.saveMarkdownRemoteImageAssets = async markdown => markdown;
  let hydrationCalls = 0;
  plugin.requestXArticleJson = async () => {
    hydrationCalls++;
    if (hydrationCalls === 1) throw Object.assign(new Error('must not be copied'), { status: 429 });
    throw Object.assign(new Error('private upstream response'), { status: 503 });
  };
  const hydrated = await plugin.hydrateXArticle({ type: 'webpage', content: postUrl, metadata: {} }, 'Inbox', '2026-11-03', 'X article');
  const failure = Plugin.__test.getSyncLifecycleOutcomeError(hydrated);
  assert.equal(failure.code, 'EXTRACTION_FAILED');
  const sanitized = sanitizePlatformArticleDiagnostic(failure.diagnostic);
  assert.equal(sanitized.xArticleProvider, 'both');
  assert.equal(sanitized.xArticleErrorCode, 'X_FXEMBED_HTTP_ERROR');
  assert.equal(sanitized.xSyndicationErrorCode, 'X_RATE_LIMITED');
  assert.equal(sanitized.httpStatus, 503);
  assert.equal(sanitizePlatformArticleDiagnostic({ source: 'webpage-extraction', httpStatus: 0 }).httpStatus, undefined);
  for (const status of [-1, 0, 99, 600]) {
    assert.equal(sanitizePlatformArticleDiagnostic({ source: 'webpage-extraction', httpStatus: status }).httpStatus, undefined);
  }
  const unsafeDiagnostic = sanitizePlatformArticleDiagnostic({ source: 'webpage-extraction', xArticleProvider: 'https://evil.example', xArticleErrorCode: 'X_API_KEY=secret' });
  assert.equal(unsafeDiagnostic.xArticleProvider, undefined);
  assert.equal(unsafeDiagnostic.xArticleErrorCode, undefined);

  plugin.lastSyncDiagnostic = { status: 'success' };
  plugin.getConfiguredLocalAsrInstallRoot = () => require('node:os').tmpdir();
  plugin.getRecentSyncFailures = () => [{
    recordId: 'x-failure-test', bindingFingerprint: 'fixture-owner', failedAt: '2026-11-03T06:34:05.739Z',
    stage: 'processing', code: 'EXTRACTION_FAILED', message: '内容解析失败', sourceUrl: postUrl, diagnostic: failure.diagnostic,
  }];
  const finalText = plugin.getSyncDiagnosticText({ detailed: true });
  assert.match(finalText, /X_FXEMBED_HTTP_ERROR/);
  assert.match(finalText, /X_RATE_LIMITED/);
  assert.match(finalText, /"httpStatus": 503/);
  for (const excluded of ['private upstream response', 'must not be copied', 'Authorization', 'httpStatus": 0']) {
    assert.ok(!finalText.includes(excluded), `unsafe detail leaked: ${excluded}`);
  }

  const controller = new AbortController();
  controller.abort();
  let abortedCalls = 0;
  await assert.rejects(x.fetchPost(postUrl, async () => { abortedCalls++; return {}; }, controller.signal), { name: 'AbortError' });
  assert.equal(abortedCalls, 0);
  console.log('x-article-fallback: all behavior tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
