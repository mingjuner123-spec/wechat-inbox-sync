'use strict';
const assert = require('node:assert/strict');
const x = require('../obsidian-plugin/wechat-inbox-sync/src/x-article');
const tweet = { __typename: 'Tweet', id_str: '123456', text: 'First sentence. Second sentence!', user: { name: 'Example' }, photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }], mediaDetails: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a.jpg' }] };
const settings = { ...x.DEFAULTS, xAiApiKey: 'test-placeholder' };
const response = data => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] });
async function main() {
  assert.deepEqual(x.sentences('we rank on Google. when people search, they find us.'), ['we rank on Google.', 'when people search, they find us.']);
  assert.deepEqual(x.sentences('1. we talk to Dr. smith about v1.2 at example.com. then we leave.'), ['1. we talk to Dr. smith about v1.2 at example.com.', 'then we leave.']);
  for (const url of ['https://x.com/a/status/123456', 'https://twitter.com/a/status/123456/photo/1', 'https://mobile.x.com/i/web/status/123456']) assert.equal(x.postId(url), '123456');
  for (const url of ['https://x.com.evil.test/a/status/123456', 'https://evil.test/x.com/a/status/123456', 'https://a@x.com/a/status/123456', 'https://x.com/home', 'https://x.com/a/status/123456/evil']) assert.equal(x.postId(url), '');
  const post = x.normalizeTweet(tweet, '123456');
  assert.equal(post.images.length, 1);
  const variantPhotos = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: 'Photos', photos: [
    { url: 'https://pbs.twimg.com/media/same.jpg?format=jpg&name=small' },
    { url: 'https://pbs.twimg.com/media/same.jpg?format=jpg&name=orig' },
  ] }, '123456');
  assert.equal(variantPhotos.images.length, 1, 'size variants of the same X photo count as one image');
  const variantMarkdown = x.renderPost({ title: 'Photo', text: '', bodyBlocks: [
    { type: 'image', url: 'https://pbs.twimg.com/media/same.jpg?format=jpg&name=small' },
  ], images: ['https://pbs.twimg.com/media/same.jpg?format=jpg&name=orig'] });
  assert.equal((variantMarkdown.match(/!\[X 图片/g) || []).length, 1, 'inline and collected image variants must not duplicate');
  const notePost = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: 'short preview', note_tweet: { note_tweet_results: { result: { text: 'Complete note text.' } } } }, '123456');
  assert.equal(notePost.text, 'Complete note text.');
  const articlePost = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: '', article: { title: 'Long article title', content: { blocks: [{ text: 'First article paragraph.' }, { text: 'Second article paragraph.' }] } } }, '123456');
  assert.equal(articlePost.title, 'Long article title'); assert.match(articlePost.text, /Second article paragraph/);
  const structuredArticle = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: '', article: {
    title: 'Structured title', content: { blocks: [
      { type: 'header-two', text: 'A real subheading' },
      { type: 'unstyled', text: 'Paragraph after the subheading.' },
      { type: 'atomic', media_url_https: 'https://pbs.twimg.com/media/inline.jpg' },
    ] },
  } }, '123456');
  assert.deepEqual(structuredArticle.bodyBlocks.map(block => block.type), ['heading', 'paragraph', 'image']);
  assert.equal(structuredArticle.bodyBlocks[0].level, 2);
  assert.match(x.renderPost(structuredArticle), /^# \*\*Structured title\*\*[\s\S]*## A real subheading[\s\S]*Paragraph after the subheading\.[\s\S]*!\[X 图片 1\]\(https:\/\/pbs\.twimg\.com\/media\/inline\.jpg\)/);
  assert.deepEqual(structuredArticle.images, ['https://pbs.twimg.com/media/inline.jpg']);
  const timedVideoMarkdown = x.renderPost({ title: 'Video', text: 'Video caption.', images: [], bodyBlocks: [], videos: [],
    videoTranscript: 'Hello there. How are you?',
    videoTranscriptSegments: [
      { startMs: 1000, endMs: 2000, text: 'Hello there.', videoIndex: 1 },
      { startMs: 3000, endMs: 4000, text: 'How are you?', videoIndex: 1 },
    ],
  }, { pairs: [
    { original: 'Hello there.', translation: '你好。' },
    { original: 'How are you?', translation: '你好吗？' },
  ] });
  assert.match(timedVideoMarkdown, /## 视频转写[\s\S]*\[00:01\][\s\S]*你好。\n\n> Hello there\.[\s\S]*\[00:03\][\s\S]*你好吗？\n\n> How are you\?/,
    'X video output should retain segment timestamps and paired translation/original lines');
  const syndicatedArticle = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: 'Preview.', article: {
    title: 'Long article', cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' } },
  } }, '123456');
  assert.deepEqual(syndicatedArticle.images, ['https://pbs.twimg.com/media/cover.jpg']);
  const fxArticle = x.normalizeFxTweet({ code: 200, status: { id: '123456', text: 'Preview.', article: {
    title: 'Long article', content: { blocks: [{ text: 'First paragraph.' }], entityMap: [{}] },
    cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' } },
    media_entities: [{ media_info: { original_img_url: 'https://pbs.twimg.com/media/body-image.jpg' } }],
  } } }, '123456');
  assert.equal(fxArticle.images.length, 2, 'X article cover and body media_entities must be captured');
  const fxLongNote = x.normalizeFxTweet({ code: 200, status: { id: '123456', text: 'Preview.', note_tweet_results: {
    result: { text: 'First complete paragraph. Second complete paragraph.' },
  } } }, '123456');
  assert.match(fxLongNote.text, /First complete paragraph\.[\s\S]*Second complete paragraph\./,
    'nested long-note payloads must not collapse to the short preview');
  const fxThread = x.normalizeFxTweet({ code: 200, author: { id: 'author-1' }, status: {
    id: '123456', text: 'Opening post.', author: { id: 'author-1' }, media: { photos: [] },
  }, thread: [
    { id: '123456', text: 'Opening post.', author: { id: 'author-1' } },
    { id: '123457', text: 'Second thread post with the rest of the article.', author: { id: 'author-1' }, media: { photos: [{ url: 'https://pbs.twimg.com/media/thread.jpg' }] } },
    { id: '123458', text: 'A reply from someone else.', author: { id: 'other-author' } },
  ] }, '123456');
  assert.match(fxThread.text, /Opening post\.[\s\S]*Second thread post with the rest of the article/);
  assert.doesNotMatch(fxThread.text, /reply from someone else/i, 'thread extraction must exclude replies by other authors');
  assert.deepEqual(fxThread.images, ['https://pbs.twimg.com/media/thread.jpg']);
  assert.match(x.renderPost(fxThread), /Opening post\.[\s\S]*Second thread post with the rest of the article/,
    'rendering a recovered thread must keep the focal post as well as its continuation');
  const fxVideo = x.normalizeFxTweet({ code: 200, status: { id: '123456', text: 'Video post.', media: {
    all: [{ thumbnail_url: 'https://pbs.twimg.com/amplify_video_thumb/123/video-poster.jpg' }],
    videos: [{ url: 'https://video.twimg.com/ext_tw_video/123/video.mp4?tag=12', thumbnail_url: 'https://pbs.twimg.com/amplify_video_thumb/123/video-poster.jpg', formats: [] }],
  } } }, '123456');
  assert.equal(fxVideo.hasVideo, true); assert.equal(fxVideo.videos.length, 1);
  assert.deepEqual(fxVideo.images, [], 'video posters are not article images');
  const cardVideo = { __typename: 'Tweet', id_str: '123456', text: 'Video post.', card: {
    name: 'unified_card', binding_values: { unified_card: { string_value: JSON.stringify({ type: 'video_website' }) } },
  } };
  let cardVideoFetches = 0;
  const enrichedCardVideo = await x.fetchPost('https://x.com/example/status/123456', async endpoint => {
    cardVideoFetches++;
    if (endpoint.includes('syndication.twimg.com')) return cardVideo;
    return { code: 200, status: { id: '123456', text: 'Video post.', media: { videos: [{
      url: 'https://video.twimg.com/ext_tw_video/123/video.mp4', thumbnail_url: 'https://pbs.twimg.com/amplify_video_thumb/123/video-poster.jpg',
    }] } } };
  });
  assert.equal(cardVideoFetches, 2, 'video cards without primary media must use the media fallback');
  assert.equal(enrichedCardVideo.hasVideo, true); assert.equal(enrichedCardVideo.videos.length, 1);
  assert.deepEqual(enrichedCardVideo.images, [], 'video posters are not article images');
  const longArticleBody = Array.from({ length: 148 }, (_, i) => `Paragraph sentence ${i + 1} contains enough detail to preserve sentence alignment.`).join('\n');
  const longArticleTranslation = await x.processCloudTranslation({ url: post.url, title: 'A long article title', text: longArticleBody }, async request => ({
    translations: request.items.map(item => ({ id: item.id, text: `中文译句${item.id + 1}` })),
  }));
  assert.equal(longArticleTranslation.pairs.length, 148, 'every long-article sentence must receive its aligned translation');
  assert.ok(longArticleTranslation.titleTranslation, 'the original article title must be translated too');
  const longArticleMarkdown = x.renderPost({ title: 'A long article title', text: longArticleBody, images: [] }, longArticleTranslation);
  assert.match(longArticleMarkdown, /^# \*\*中文译句0（A long article title）\*\*/,
    'translated X title must be explicitly bold in Markdown');
  assert.equal((longArticleMarkdown.match(/^> Paragraph sentence /gm) || []).length, 148,
    'rendering must pair all translated sentences with their originals');
  const titleOnlyBody = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: '', article: { title: 'Headline!', content: { blocks: [{ text: ' headline ' }] } }, photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }] }, '123456');
  assert.equal(titleOnlyBody.text, '', 'article title repeated as body is not accepted as substantive text');
  const noteTitleOnly = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: 'preview', note_tweet: { note_tweet_results: { result: { title: 'Headline!', content: { blocks: [{ text: ' headline ' }] } } } }, photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }] }, '123456');
  assert.equal(noteTitleOnly.text, '', 'nested note_tweet title repeated as body is not accepted as substantive text');
  const flatNoteTitleOnly = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: '', note_tweet: { title: 'Headline', text: 'Headline' }, photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }] }, '123456');
  assert.equal(flatNoteTitleOnly.text, '', 'flat note_tweet title repeated as body is not accepted as substantive text');
  for (const malformed of [
    { article: { title: 'Only title' } },
    { article: { title: 'Headline', preview_text: 'Preview only' } },
    { text: 'Read more' },
    { text: 'Read more →' },
    { text: '阅读全文' },
    { text: 'https://x.com/i/article/123' },
  ]) assert.throws(() => x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', ...malformed }, '123456'), /可保存|完整正文/);
  assert.equal(x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: 'Hi' }, '123456').text, 'Hi');
  const extendedVideo = x.normalizeTweet({ __typename: 'Tweet', id_str: '123456', text: '', extended_entities: { media: [{ video_info: { variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/ext_tw_video/123/video.mp4' }] } }] } }, '123456');
  assert.equal(extendedVideo.hasVideo, true); assert.equal(extendedVideo.text, ''); assert.equal(extendedVideo.videos.length, 1);
  assert.throws(() => x.normalizeTweet(tweet, '999'), /目标推文/);
  assert.throws(() => x.normalizeTweet({}, '123456'), /目标推文/);
  assert.throws(() => x.normalizeTweet({ ...tweet, truncated: true }, '123456'), /完整正文/);
  assert.throws(() => x.normalizeTweet({ ...tweet, photos: [{ url: 'http://localhost/a.jpg' }] }, '123456'), /图片地址/);
  assert.throws(() => x.normalizeTweet({ ...tweet, photos: [{}] }, '123456'), /图片地址/,
    'a declared photo without a usable URL must not be silently dropped');
  assert.throws(() => x.normalizeTweet({ ...tweet, mediaDetails: [{ type: 'photo' }] }, '123456'), /图片地址/,
    'a declared photo media item without a usable URL must fail extraction');
  assert.throws(() => x.normalizeTweet({ ...tweet, text: '', photos: [], mediaDetails: [] }, '123456'), /图文或视频内容/);
  const quoted = x.normalizeTweet({ ...tweet, quoted_tweet: { ...tweet, id_str: '987', text: 'Quoted.' } }, '123456');
  assert.match(x.renderPost(quoted), /引用推文/);
  assert.match(x.renderPost(quoted), /status\/987/);
  assert.equal(x.recordText({ type: 'file', content: 'private-file.pdf' }), '');
  assert.equal(x.recordText({ type: 'webpage', content: 'https://example.com', metadata: { conversionStatus: 'failed', markdown: 'failure diagnostic' } }), '');
  assert.equal(x.recordText({ type: 'webpage', content: 'https://example.com', metadata: { conversionStatus: 'success', conversionNote: '抖音图文笔记已保存链接（正文未获取）', markdown: '抖音图文笔记：页面未返回可读正文，已保存链接。\n\n> 失败原因' } }), '');
  assert.equal(x.recordText({ type: 'webpage', metadata: { conversionStatus: 'success', conversionNote: 'Obsidian requestUrl 与 Node.js 均失败，已使用隐藏浏览器通道恢复正文', markdown: '恢复的实际正文' } }), '恢复的实际正文');
  assert.equal(x.recordText({ type: 'text', content: 'https://example.com' }), '');
  assert.equal(x.recordText({ type: 'file', metadata: { convertedMarkdown: '正文 ![[private.png]] ![image](https://private.test)\n[链接文字](https://private.test)' } }), '正文  \n链接文字');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(x.fetchPost(post.url, async () => tweet, controller.signal), { name: 'AbortError' });
  await assert.rejects(x.boundedRequest(() => new Promise(() => {}), 'https://example.test', {}, null, 5), { code: 'X_REQUEST_TIMEOUT' });
  let limitedCalls = 0;
  await assert.rejects(x.fetchPost(post.url, async () => { limitedCalls++; throw Object.assign(Error(), { status: 429 }); }), error => {
    assert.equal(error.code, 'X_FXEMBED_RATE_LIMITED');
    assert.equal(error.xSyndicationErrorCode, 'X_RATE_LIMITED');
    assert.equal(error.status, 429);
    return true;
  });
  assert.equal(limitedCalls, 2, 'a primary 429 is followed by one fallback attempt');
  const fetched = await x.fetchPost(post.url, async (url, opts) => { assert.match(url, /^https:\/\/cdn.syndication.twimg.com/); assert.equal(opts.headers.Authorization, undefined); return tweet; });
  assert.equal(fetched.id, '123456');
  const pureVideoCard = { __typename: 'Tweet', id_str: '123456', text: '', card: {
    name: 'unified_card', binding_values: { unified_card: { string_value: JSON.stringify({ type: 'video_website' }) } },
  } };
  await assert.rejects(x.fetchPost(post.url, async endpoint => {
    if (endpoint.includes('syndication.twimg.com')) return pureVideoCard;
    throw Object.assign(new Error('fallback failed'), { status: 500 });
  }), error => error.code === 'X_VIDEO_MEDIA_UNAVAILABLE',
  'an empty video card must fail instead of becoming a successful empty note');
  const videoFallbackFailedWithCaption = await x.fetchPost(post.url, async endpoint => {
    if (endpoint.includes('syndication.twimg.com')) return { ...pureVideoCard, text: 'A caption.' };
    throw Object.assign(new Error('fallback failed'), { status: 500 });
  });
  assert.equal(videoFallbackFailedWithCaption.xMediaEnrichmentError, 'X_FXEMBED_HTTP_ERROR');
  const injectedImageUrl = 'https://pbs.twimg.com/media/123/a.jpg?x=)![track](https://evil.test/a';
  const safeImageUrl = x.photoUrl(injectedImageUrl);
  assert.ok(safeImageUrl.includes('%29') && safeImageUrl.includes('%28'));
  assert.ok(!x.renderPost({ title: 'Safe', text: '', images: [safeImageUrl] }).includes('![track]('),
    'image URL characters must not escape the Markdown destination');
  assert.equal(x.photoUrl('https://pbs.twimg.com/amplify_video_thumb/123/a.jpg'), '',
    'video thumbnails must not be added to the article image list');
  const unsafe = x.renderPost({ ...post, text: '<script>evil</script> ![track](https://evil.test)' });
  assert.ok(!unsafe.includes('<script>')); assert.ok(!unsafe.includes('![track]('));
  console.log('x-article-local: all behavior tests passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
