'use strict';
const assert = require('node:assert/strict');
const x = require('../obsidian-plugin/wechat-inbox-sync/src/x-article');
const { buildEnglishAsrScript } = require('../obsidian-plugin/wechat-inbox-sync/src/asr-language-script-utils');

(async () => {
  const preview = { __typename: 'Tweet', id_str: '123', text: 'This preview ends halfway through a sentence', note_tweet: { id: 'NoteTweet:123' } };
  let calls = 0;
  const full = await x.fetchPost('https://x.com/test/status/123', async endpoint => {
    calls++;
    return endpoint.includes('syndication') ? preview : { code: 200, status: { id: '123', lang: 'en', text: 'The complete original text. Including its final sentence.' } };
  });
  assert.equal(calls, 2);
  assert.match(full.text, /final sentence/);
  assert.equal(full.language, 'en');
  await assert.rejects(x.fetchPost('https://x.com/test/status/123', async endpoint => {
    if (endpoint.includes('syndication')) return preview;
    throw new Error('unavailable');
  }), 'a note ID without content must never be accepted as a complete post');

  const article = x.normalizeFxTweet({ code: 200, status: { id: '123', text: 'Preview', article: {
    title: 'Article', cover_media: { media_info: { original_img_url: 'https://pbs.twimg.com/media/cover.jpg' } },
    media_entities: [{ media_id: '777', media_info: { original_img_url: 'https://pbs.twimg.com/media/inline.jpg' } }],
    content: { blocks: [
      { type: 'header-two', text: 'Section' }, { type: 'unstyled', text: 'Before image.' },
      { type: 'atomic', text: ' ', entityRanges: [{ key: 0 }] },
      { type: 'unstyled', text: 'After image.' },
      { type: 'atomic', text: ' ', entityRanges: [{ key: 4 }] },
      { type: 'atomic', text: ' ', entityRanges: [{ key: 2 }] },
    ], entityMap: [
      { key: '4', value: { type: 'MARKDOWN', data: { markdown: '```markdown\n### Template heading\n* Keep the whole template\n```' } } },
      { key: '2', value: { type: 'DIVIDER', data: {} } },
      { key: '0', value: { type: 'MEDIA', data: { mediaItems: [{ mediaId: '777' }] } } },
    ] },
  } } }, '123');
  const md = x.renderPost(article);
  assert.match(md, /cover\.jpg[\s\S]*## Section[\s\S]*Before image\.[\s\S]*inline\.jpg[\s\S]*After image\./);
  assert.equal((md.match(/inline\.jpg/g) || []).length, 1);
  assert.match(md, /```markdown\n### Template heading\n\* Keep the whole template\n```/);
  assert.ok(article.text.includes('Keep the whole template'));

  const multi = x.renderPost({ title: 'Two clips', images: [], videoTranscript: 'First. Second. Third. Fourth.', videoTranscriptSegments: [
    { videoIndex: 1, startMs: 0, endMs: 2000, text: 'First.' },
    { videoIndex: 1, startMs: 2000, endMs: 4000, text: 'Second.' },
    { videoIndex: 2, startMs: 0, endMs: 2000, text: 'Third.' },
    { videoIndex: 2, startMs: 2000, endMs: 4000, text: 'Fourth.' },
  ] });
  assert.match(multi, /### 视频 1[\s\S]*First\.[\s\S]*Second\.[\s\S]*### 视频 2[\s\S]*Third\.[\s\S]*Fourth\./);
  assert.equal((multi.match(/\[00:00\]/g) || []).length, 2);

  const videoPost = {
    title: 'Original title', text: 'The post caption repeats the video.',
    videoPoster: 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/cover.jpg',
    images: [], videoTranscript: 'Hello there. How are you?',
    videoTranscriptSegments: [
      { startMs: 0, endMs: 2000, text: 'Hello there.' },
      { startMs: 2000, endMs: 4000, text: 'How are you?' },
    ],
    quote: { author: 'Quoted author', text: 'Another copy of the caption.', images: [], url: 'https://x.com/test/status/124' },
  };
  const translation = { titleTranslation: '原始标题', pairs: [
    { original: 'Hello there.', translation: '你好。' },
    { original: 'How are you?', translation: '你好吗？' },
  ] };
  const videoOnly = x.renderPost(videoPost, translation);
  assert.match(videoOnly, /^# \*\*原始标题（Original title）\*\*/);
  assert.match(videoOnly, /cover\.jpg/);
  assert.match(videoOnly, /## 视频转写[\s\S]*\[00:00\][\s\S]*你好。\n\n> Hello there\.[\s\S]*\[00:02\][\s\S]*你好吗？\n\n> How are you\?/);
  assert.equal((videoOnly.match(/^# /gm) || []).length, 1);
  assert.equal((videoOnly.match(/Hello there\./g) || []).length, 1);
  assert.doesNotMatch(videoOnly, /## 正文|引用推文|post caption|Another copy/);
  for (const overrides of [
    { videoTranscript: '', videoTranscriptSegments: [] },
    { videoTranscriptSegments: [] },
    { videoTranscriptSegments: videoPost.videoTranscriptSegments.slice(0, 1) },
    { transcriptionError: '部分视频未能完成转写。' },
  ]) {
    const fallback = x.renderPost({ ...videoPost, ...overrides }, translation);
    assert.match(fallback, /## 正文[\s\S]*The post caption repeats the video\./, 'incomplete transcription retains the original post');
    if (overrides.videoTranscript !== '') assert.ok(fallback.includes('How are you?'), 'missing timestamps cannot drop transcript text');
  }
  const withInlinePhoto = x.renderPost({ ...videoPost, bodyBlocks: [
    { type: 'heading', text: 'Repeated subheading', level: 2 },
    { type: 'paragraph', text: videoPost.text },
    { type: 'image', url: 'https://pbs.twimg.com/media/inline-video.jpg' },
  ] }, translation);
  assert.match(withInlinePhoto, /inline-video\.jpg/);
  assert.doesNotMatch(withInlinePhoto, /## 正文|Repeated subheading|post caption/);

  const script = '$TranscriptionLanguage = $Language\n$Root = Split-Path -Parent $MyInvocation.MyCommand.Path\n$PunctuationReady = [bool](true)\nfunction Add-UnitPunctuation {}';
  const patched = buildEnglishAsrScript(script, "C:\\User's components");
  assert.ok(patched.includes("$Root = 'C:\\User''s components'"));
  assert.ok(patched.includes('($TranscriptionLanguage -ne "en") -and [bool]('));
  assert.equal(buildEnglishAsrScript('unrelated custom script', 'C:\\asr'), null);
  assert.throws(() => buildEnglishAsrScript('$PunctuationReady = [bool](true)', 'C:\\asr'));
  console.log('x-content-completeness: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
