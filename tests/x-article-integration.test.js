'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
let requestMock;
const controls = [];
class Element {
  constructor(tag = 'div', options = {}) { this.tag = tag; this.options = options; this.children = []; this.attributes = options.attr || {}; }
  createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); return el; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
const modals = [], notices = [];
class Modal {
  constructor() { this.contentEl = new Element(); modals.push(this); }
  open() { this.opened = true; }
}
class Setting {
  constructor() { this.entry = { controls: [] }; controls.push(this.entry); }
  setName(name) { this.entry.name = name; return this; }
  setDesc(value) { this.entry.description = value; return this; }
  control(callback) { const c = { inputEl: new Element('input'), setPlaceholder() { return c; }, setValue(v) { c.value = v; return c; }, onChange(fn) { c.change = fn; return c; }, onClick(fn) { c.click = fn; return c; }, setButtonText(v) { c.label = v; return c; }, setDisabled(v) { c.disabled = v; return c; } }; this.entry.control = c; this.entry.controls.push(c); callback(c); return this; }
  addText(cb) { return this.control(cb); } addToggle(cb) { return this.control(cb); } addButton(cb) { return this.control(cb); }
  addDropdown(cb) { return this.control(c => { c.selectEl = new Element('select'); c.options = {}; c.addOption = (value, label) => { c.options[value] = label; return c; }; cb(c); }); }
}
const load = Module._load;
Module._load = function (name, ...rest) { if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal, Notice: class { constructor(message) { notices.push(message); } }, Setting, requestUrl: (...args) => requestMock(...args) }; return load.call(this, name, ...rest); };
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = load;
const x = require('../obsidian-plugin/wechat-inbox-sync/src/x-article');
const tweet = { __typename: 'Tweet', id_str: '123456', text: 'Hello world. Another sentence.', user: { name: 'Example' }, photos: [{ url: 'https://pbs.twimg.com/media/a.jpg' }, { url: 'https://pbs.twimg.com/media/b.jpg' }] };
async function main() {
  const plugin = new Plugin(); plugin.settings = Plugin.__test.mergeSettings({ deepseekApiKey: 'legacy-placeholder', xTranslationEnabled: 'true', xSummaryEnabled: 1 });
  assert.equal(plugin.settings.xTranslationEnabled, false); assert.equal(plugin.settings.xSummaryEnabled, false); assert.equal(plugin.settings.xAiApiKey, '');
  assert.equal(Plugin.__test.mergeSettings({}).xAiModel, 'deepseek-flash');
  for (const model of ['deepseek-chat', 'custom-model']) assert.equal(Plugin.__test.mergeSettings({ xAiModel: model }).xAiModel, model);
  const translationRequests = [];
  plugin.requestJson = async (...args) => { translationRequests.push(args); throw Object.assign(Error('translation unavailable'), {status:503}); };
  let requests = [];
  requestMock = async opts => { requests.push(opts); return { status: 200, json: tweet }; };
  plugin.saveMarkdownRemoteImageAssets = async md => md;
  const record = { type: 'webpage', content: 'https://x.com/example/status/123456', metadata: { transcriptOnly: true, webpageMediaType: 'audio_video', transcriptionStatus: 'failed' } };
  const original = JSON.stringify(record);
  let result = await plugin.hydrateWebpageMarkdown(record, 'Inbox', '2026-11-02', 'title');
  assert.equal(JSON.stringify(record), original); assert.equal(requests.length, 1);
  assert.equal(result.metadata.conversionStatus, 'success'); assert.equal(result.metadata.transcriptOnly, false); assert.equal(result.metadata.transcriptionStatus, undefined); assert.equal(result.metadata.xImageCount, 2);
  assert.equal(translationRequests[0][0], '/x/translate'); assert.equal(translationRequests[0][1], 'POST');
  assert.equal(translationRequests[0][2].url, 'https://x.com/i/web/status/123456'); assert.ok(translationRequests[0][2].items.length > 0);
  assert.equal(result.metadata.sourceMetadataComplete, false, 'X extraction must not suppress existing keyword/description generation');
  plugin.hasProFeatureAccess = async () => true;
  const originalMetadataGenerator = plugin.generateMetadataWithDeepSeek;
  plugin.generateMetadataWithDeepSeek = async () => ({description:'帖子简介',keywords:['关键词']});
  const enriched = await plugin.enrichRecordMetadataWithAi(result);
  assert.equal(enriched.metadata.description,'帖子简介');
  assert.deepEqual(enriched.metadata.keywords,['关键词']);
  plugin.generateMetadataWithDeepSeek = originalMetadataGenerator;
  const originalTranslateRequest = plugin.requestJson;
  plugin.requestJson = async (_path,_method,payload) => ({translations:payload.items.map(item=>({id:item.id,text:item.id===-1?'中文标题':'中文句子'}))});
  const translated = await plugin.hydrateWebpageMarkdown(record,'Inbox','2026-11-02','title');
  assert.equal(translated.metadata.title,'Example：中文标题');
  assert.match(translated.metadata.markdown,/中文标题（Example：/,'body heading still preserves the original');
  plugin.requestJson = originalTranslateRequest;
  const originalMockRequest=requestMock;
  const fullTweetTitle='HubSpot co-founder and CTO Dharmesh Shah says ChatGPT and Claude are the new browsers';
  requestMock=async()=>({status:200,json:{...tweet,text:fullTweetTitle+'\n\nThe rest of the post.'}});
  const fullTitleRecord=await plugin.hydrateWebpageMarkdown(record,'Inbox','2026-11-02','title');
  assert.equal(fullTitleRecord.metadata.title,'Example：'+fullTweetTitle,'tweet title extraction never cuts browsers into bro');
  requestMock=originalMockRequest;
  assert.ok(!Plugin.__test.getSyncLifecycleOutcomeError(result));
  assert.match(Plugin.__test.buildWebpageMarkdownBody(result, 'title'), /Hello world/);
  assert.match(Plugin.__test.buildWebpageMarkdownBody(result, 'title'), /^# \*\*Example：/,
    'X note bodies should start with the post title, without a generic Markdown wrapper heading');
  const originalXRequest = plugin.requestXArticleJson;
  plugin.requestXArticleJson = async () => ({ __typename: 'Tweet', id_str: '123456', text: '', article: {
    title: 'Original long article title', content: { blocks: [{ text: 'A real paragraph from the article body.' }] },
  } });
  const titledArticle = await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: record.content, metadata: {} }, 'Inbox', '2026-11-02', 'fallback');
  assert.match(titledArticle.metadata.title, /Original long article title/);
  assert.match(titledArticle.metadata.markdown, /^# \*\*X：Original long article title\*\*/m);
  const lifecycleUrl = `https://x.com/example/status/${tweet.id_str}`;
  for (const markdown of [
    '# X：Only title',
    '# X：Headline\n\n## 正文\n\nhttps://x.com/i/article/123',
    '# X：Headline\n\n## 正文\n\nRead more',
    '# X：Author：Headline\n\n## 正文\n\nHeadline',
    '# X：Author：Headline\n\n## 正文\n\nRead more →',
    '# X：Author：Headline\n\n## 正文\n\n阅读全文',
  ]) {
    const error = Plugin.__test.getSyncLifecycleOutcomeError({ type: 'webpage', content: lifecycleUrl, metadata: {
      url: lifecycleUrl, platform: 'X', conversionStatus: 'success', markdown,
    } });
    assert.equal(error && error.code, 'EXTRACTION_FAILED', 'X title, URL, and shell text cannot count as a saved body');
  }
  assert.equal(Plugin.__test.getSyncLifecycleOutcomeError({ type: 'webpage', content: lifecycleUrl, metadata: {
    url: lifecycleUrl, platform: 'X', conversionStatus: 'success', xOriginalText: 'Hi', markdown: '# X：A title\n\n## 正文\n\nHi',
  } }), null, 'short real X text remains a valid body');
  for (const metadata of [
    { xOriginalText: 'Headline', xOriginalTitle: 'Headline' },
    { xOriginalText: 'Headline', title: 'Author：Headline' },
    { xOriginalText: 'Read more →' },
    { xOriginalText: '阅读全文' },
  ]) {
    assert.equal(Plugin.__test.getSyncLifecycleOutcomeError({ type: 'webpage', content: lifecycleUrl, metadata: {
      url: lifecycleUrl, platform: 'X', conversionStatus: 'success', ...metadata,
      markdown: '# X：Author：Headline\n\n## 正文\n\nHeadline',
    } })?.code, 'EXTRACTION_FAILED', 'legacy X title-only and shell text cannot be accepted as body');
  }
  assert.equal(Plugin.__test.getSyncLifecycleOutcomeError({ type: 'webpage', content: lifecycleUrl, metadata: {
    url: lifecycleUrl, platform: 'X', conversionStatus: 'success', markdown: '# X：A title\n\n![X 图片 1](https://pbs.twimg.com/media/a.jpg)',
  } }), null, 'an X post with a real image remains deliverable');
  const originalRunLocal = plugin.runLocalTranscription;
  const originalPluginSettings = plugin.settings;
  const localOptionsSeen = [];
  plugin.settings = { ...plugin.settings, aiProvider: 'local', cloudFallbackEnabled: false };
  plugin.runLocalTranscription = async (_url, options) => { localOptionsSeen.push(options); return { transcription: 'captured locally' }; };
  await plugin.runConfiguredTranscription('https://media.example/non-x.mp4', { sourceUrl: 'https://example.com/post' });
  await plugin.runConfiguredTranscription('https://video.twimg.com/ext_tw_video/123/test.mp4', { maxBytes: 100 * 1024 * 1024 });
  assert.equal(Number(localOptionsSeen[0].maxBytes) || 0, 0, 'non-X local transcription keeps its existing size behavior');
  assert.equal(localOptionsSeen[1].maxBytes, 100 * 1024 * 1024, 'the X-specific size cap is still forwarded');
  plugin.runLocalTranscription = originalRunLocal;
  plugin.settings = originalPluginSettings;
  const originalTranscriptBuilder = plugin.buildTranscriptRecordFromMedia;
  const videoUrl = 'https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/test.mp4?tag=12';
  const articleVideo = { ...tweet, lang: 'en', mediaDetails: [{ type: 'video', video_info: { variants: [
    { content_type: 'video/mp4', bitrate: 256000, url: videoUrl },
  ] } }] };
  const videoRecord = { type: 'webpage', content: 'https://x.com/example/status/123456', metadata: {} };
  const signal = new AbortController().signal;
  const binding = { label: 'fixture-binding' };
  let videoTranscriptionCalls = 0;
  plugin.requestXArticleJson = async () => articleVideo;
  plugin.buildTranscriptRecordFromMedia = async (sourceRecord, options) => {
    videoTranscriptionCalls++;
    assert.equal(options.platform, 'X'); assert.equal(options.mediaUrl, videoUrl);
    assert.equal(options.transcriptionLanguage, 'en', 'English X videos must not inherit the Chinese ASR default');
    assert.ok(Number(options.maxBytes) > 0, 'X video transcription downloads have a size limit');
    assert.equal(options.binding, binding); assert.equal(options.signal, signal);
    assert.match(options.markdown, /Hello world/); assert.match(options.markdown, /pbs.twimg.com\/media\/a.jpg/);
    return { ...sourceRecord, metadata: { ...sourceRecord.metadata, transcriptOnly: true,
      transcription: '识别到的视频语音。', transcriptionStatus: 'success', conversionStatus: 'success',
      markdown: options.markdown, mediaUrl: options.mediaUrl, title: options.sourceTitle } };
  };
  const transcribedVideo = await plugin.hydrateWebpageMarkdown(videoRecord, 'Inbox', '2026-11-02', 'X video', binding, { signal });
  assert.equal(videoTranscriptionCalls, 1); assert.equal(transcribedVideo.metadata.transcriptionStatus, 'success');
  assert.equal(transcribedVideo.metadata.platform, 'X'); assert.equal(transcribedVideo.metadata.transcriptOnly, false);
  const videoBody = Plugin.__test.buildWebpageMarkdownBody(transcribedVideo, 'X video');
  assert.match(videoBody, /Hello world/); assert.match(videoBody, /pbs.twimg.com\/media\/b.jpg/);
  assert.match(videoBody, /识别到的视频语音/);
  const secondVideoUrl = 'https://video.twimg.com/ext_tw_video/456/pu/vid/avc1/1280x720/test-2.mp4?tag=12';
  plugin.requestXArticleJson = async () => ({ ...articleVideo, mediaDetails: [
    ...articleVideo.mediaDetails,
    { type: 'video', video_info: { variants: [{ content_type: 'video/mp4', bitrate: 128000, url: secondVideoUrl }] } },
  ] });
  plugin.buildTranscriptRecordFromMedia = async (sourceRecord, options) => ({ ...sourceRecord, metadata: {
    ...sourceRecord.metadata, transcriptOnly: true, transcription: options.mediaUrl === videoUrl ? '第一段视频。' : '第二段视频。',
    transcriptionStatus: 'success', conversionStatus: 'success', markdown: options.markdown,
  } });
  const multiVideo = await plugin.hydrateWebpageMarkdown(videoRecord, 'Inbox', '2026-11-02', 'X video', binding, { signal });
  assert.equal(multiVideo.metadata.transcriptionStatus, 'success');
  assert.match(multiVideo.metadata.transcription, /第一段视频/); assert.match(multiVideo.metadata.transcription, /第二段视频/);
  assert.deepEqual(multiVideo.metadata.mediaUrls, [videoUrl, secondVideoUrl]);
  plugin.buildTranscriptRecordFromMedia = async () => { throw new Error('temporary ASR failure'); };
  const videoWithAsrFailure = await plugin.hydrateWebpageMarkdown(videoRecord, 'Inbox', '2026-11-02', 'X video', binding, { signal });
  assert.equal(videoWithAsrFailure.metadata.conversionStatus, 'success');
  assert.equal(videoWithAsrFailure.metadata.transcriptionStatus, 'failed');
  assert.match(videoWithAsrFailure.metadata.markdown, /原帖文字和图片已保留/);
  plugin.requestXArticleJson = async () => ({ ...articleVideo, mediaDetails: [{ type: 'video', video_info: { variants: [
    { content_type: 'video/mp4', url: 'https://evil.example/video.mp4' },
  ] } }] });
  const videoWithoutDirectUrl = await plugin.hydrateWebpageMarkdown(videoRecord, 'Inbox', '2026-11-02', 'X video', binding, { signal });
  assert.equal(videoTranscriptionCalls, 1, 'a non-X host is never passed to the downloader');
  assert.equal(videoWithoutDirectUrl.metadata.conversionStatus, 'success');
  assert.equal(videoWithoutDirectUrl.metadata.transcriptionStatus, 'failed');
  assert.match(videoWithoutDirectUrl.metadata.markdown, /X 视频转写未完成/);
  const posterUrl = 'https://pbs.twimg.com/amplify_video_thumb/123/video-poster.jpg';
  const cardOnlyVideo = { __typename: 'Tweet', id_str: '123456', text: 'Video post.', card: {
    name: 'unified_card', binding_values: { unified_card: { string_value: JSON.stringify({ type: 'video_website' }) } },
  } };
  const fxVideoPayload = { code: 200, status: { id: '123456', text: 'Video post.', media: { videos: [{
    url: videoUrl, thumbnail_url: posterUrl,
  }] } } };
  let mediaFallbackCalls = 0, fallbackVideoTranscriptions = 0;
  plugin.requestXArticleJson = async endpoint => {
    if (endpoint.startsWith('https://api.fxtwitter.com/')) { mediaFallbackCalls++; return fxVideoPayload; }
    return cardOnlyVideo;
  };
  plugin.buildTranscriptRecordFromMedia = async (sourceRecord, options) => {
    fallbackVideoTranscriptions++;
    assert.equal(options.mediaUrl, videoUrl);
    return { ...sourceRecord, metadata: { ...sourceRecord.metadata, transcriptOnly: true,
      transcription: '卡片视频转写成功。',
      transcriptionSegments: [{ startMs: 1000, endMs: 2000, text: '卡片视频转写成功。' }],
      transcriptionStatus: 'success', conversionStatus: 'success', markdown: options.markdown } };
  };
  const fallbackTranscribedVideo = await plugin.hydrateWebpageMarkdown(videoRecord, 'Inbox', '2026-11-02', 'X video', binding, { signal });
  assert.equal(mediaFallbackCalls, 1, `a Syndication video card without media must use the media fallback (transcription calls: ${fallbackVideoTranscriptions})`);
  assert.equal(fallbackVideoTranscriptions, 1); assert.equal(fallbackTranscribedVideo.metadata.transcriptionStatus, 'success');
  assert.match(fallbackTranscribedVideo.metadata.markdown, /^# \*\*X：Video post\.\*\*/m);
  assert.match(fallbackTranscribedVideo.metadata.markdown, /卡片视频转写成功/);
  assert.match(fallbackTranscribedVideo.metadata.markdown, /\*\*\[00:01\]\*\*/,
    'X video segments should retain their timestamps in the paired transcript output');
  assert.equal(fallbackTranscribedVideo.metadata.transcriptionSegments[0].videoIndex, 1);
  assert.match(fallbackTranscribedVideo.metadata.markdown, /!\[X 视频封面\].*video-poster\.jpg/,
    'one separate video cover is retained without adding it as an article photo');
  plugin.requestXArticleJson = originalXRequest;
  plugin.buildTranscriptRecordFromMedia = originalTranscriptBuilder;
  // Exercise real ingestion routes and the atomic note writer, not just hydration.
  const files = new Map();
  const folders = new Set();
  plugin.settings = { ...plugin.settings, inboxDir: 'Inbox', noteSaveMode: 'root', socialArticleImageStorageMode: 'remote' };
  plugin.app = { vault: { create: async (p, value) => { assert.equal(files.has(p), false); files.set(p, value); }, adapter: {
    exists: async p => files.has(p) || folders.has(p), write: async (p, value) => { files.set(p, value); },
    read: async p => files.get(p), rename: async (from, to) => {
      for (const p of [...files.keys()]) if (p === from || p.startsWith(from + '/')) { files.set(to + p.slice(from.length), files.get(p)); files.delete(p); }
      for (const p of [...folders]) if (p === from || p.startsWith(from + '/')) { folders.add(to + p.slice(from.length)); folders.delete(p); }
    },
    remove: async p => { files.delete(p); },
  } } };
  plugin.ensureFolder = async p => { folders.add(p); }; plugin.showSyncProgress = () => {};
  plugin.saveSourceMediaAttachment = async r => r;
  const hydrateForWrite = plugin.hydrateWebpageMarkdown;
  plugin.hydrateWebpageMarkdown = async r => r;
  plugin.nextRecordTitle = async () => 'X-video-asr-failed';
  await assert.rejects(plugin.writeRecord({ ...videoWithAsrFailure, _id: 'x-video-asr-failed', createdAt: '2026-11-02T00:00:00Z' }, '2026-11-02T00:01:00Z', null, false, { skipAi: true }),
    error => /TRANSCRIPTION/.test(error.code), 'failed X video transcription must remain retryable, never acknowledged as success');
  assert.equal(Plugin.__test.getSyncLifecycleOutcomeError(videoWithAsrFailure).code, 'TRANSCRIPTION_FAILED');
  plugin.settings.socialArticleImageStorageMode = 'local';
  folders.add('Inbox/X-video-asr-failed'); folders.add('Inbox/X-video-asr-failed/文章图片');
  files.set('Inbox/X-video-asr-failed/文章图片/image.jpg', Buffer.from('image-fixture'));
  const writeFixture = { ...transcribedVideo, metadata: { ...transcribedVideo.metadata,
    markdown: transcribedVideo.metadata.markdown + '\n![[Inbox/X-video-asr-failed/文章图片/image.jpg]]' } };
  const successWrite = await plugin.writeRecord({ ...writeFixture, _id: 'x-video-complete', createdAt: '2026-11-02T00:00:00Z' }, '2026-11-02T00:01:00Z', null, false, { skipAi: true });
  assert.match(successWrite.title, /Example/);
  assert.doesNotMatch(successWrite.title, /识别到/);
  assert.equal((files.get(successWrite.filePath).match(/^# /gm) || []).length, 1, 'X video must have a single source title');
  const imagePath = successWrite.filePath.slice(0, successWrite.filePath.lastIndexOf('/')) + '/文章图片/image.jpg';
  assert.ok(files.has(imagePath), 'selected local images and final note must stay in the same title folder');
  assert.ok(files.get(successWrite.filePath).includes(imagePath));
  plugin.settings.socialArticleImageStorageMode = 'remote';
  const remoteWrite = await plugin.writeRecord({ ...transcribedVideo, _id: 'x-video-remote', createdAt: '2026-11-02T00:00:00Z' }, '2026-11-02T00:01:00Z', null, false, { skipAi: true });
  assert.match(remoteWrite.filePath, /^Inbox\/[^/]+\.md$/, 'remote mode keeps the note directly in the selected save folder');
  assert.match(files.get(remoteWrite.filePath), /pbs\.twimg\.com/);
  assert.doesNotMatch(files.get(remoteWrite.filePath), /!\[\[/, 'remote mode does not add local image references');
  plugin.hydrateWebpageMarkdown = hydrateForWrite;
  for (const type of ['link', 'text', 'webpage']) {
    plugin.nextRecordTitle = async () => `X-${type}`;
    const written = await plugin.writeRecord({ _id: `x-${type}`, type, content: type === 'text' ? 'Read this: https://x.com/example/status/123456' : record.content, createdAt: '2026-11-02T00:00:00Z', metadata: {} }, '2026-11-02T00:01:00Z');
    assert.equal(written.committed, true); assert.match(files.get(written.filePath), /Hello world/); assert.match(files.get(written.filePath), /pbs.twimg.com\/media\/b.jpg/);
  }
  plugin.settings = { ...plugin.settings, xSummaryEnabled: true, xAiApiKey: 'test-placeholder' };
  requestMock = async opts => opts.method === 'GET' ? { status: 200, json: tweet } : { status: 429, json: { error: { message: 'provider-secret' } } };
  result = await plugin.hydrateWebpageMarkdown(record, 'Inbox', '2026-11-02', 'title');
  assert.equal(result.metadata.conversionStatus, 'success');
  const failedAi = await plugin.appendAdvancedAi(result.metadata.markdown, result);
  assert.match(failedAi, /翻译暂未完成/); assert.match(failedAi, /pbs.twimg.com/); assert.ok(!failedAi.includes('provider-secret'));
  requestMock = async () => ({ status: 200, json: {} });
  result = await plugin.hydrateWebpageMarkdown(record, 'Inbox', '2026-11-02', 'title');
  assert.equal(result.metadata.conversionStatus, 'link_saved'); assert.ok(Plugin.__test.getSyncLifecycleOutcomeError(result));
  let primaryRateLimitedCalls = 0, fallbackCalls = 0;
  plugin.settings = { ...plugin.settings, xTranslationEnabled: false, xSummaryEnabled: false };
  requestMock = async options => {
    if (options.url.startsWith('https://api.fxtwitter.com/')) { fallbackCalls++; return { status: 200, json: { code: 200, status: { id: '123456', text: 'Recovered through FxEmbed.' } } }; }
    primaryRateLimitedCalls++; return { status: 429 };
  };
  await plugin.hydrateWebpageMarkdown(record, 'Inbox', 'date', 'title');
  await plugin.hydrateWebpageMarkdown(record, 'Inbox', 'date', 'title');
  assert.equal(primaryRateLimitedCalls, 1, 'a syndication 429 must cool that provider down');
  assert.equal(fallbackCalls, 2, 'the healthy fallback remains available during provider cooldown');
  requestMock = async () => { throw Error('non-X should use cached markdown'); };
  const other = await plugin.hydrateWebpageMarkdown({ type: 'webpage', content: 'https://example.com/page', metadata: { markdown: 'Existing article' } }, 'Inbox', 'date', 'title');
  assert.equal(other.metadata.markdown, 'Existing article');
  // Removed settings must stay unavailable, including for legacy users.
  const tab = Object.create(Plugin.__test.WechatInboxSettingTab.prototype); tab.plugin = plugin;
  const container = new Element();
  assert.equal(tab.renderXArticleSettings, undefined);
  assert.equal(tab.openXArticleTutorial, undefined);
  plugin.settings = { ...plugin.settings, xSummaryEnabled: true, xTranslationEnabled: true, xAiApiKey: 'legacy-fixture' };
  requestMock = async () => { throw Error('retired AI must not call provider'); };
  for (const type of ['text','webpage','file','voice']) {
    const source = { type, content: 'Original body.', metadata: { xAdvancedAiResult: {summary:'cached summary'} } };
    assert.equal(await plugin.prepareAdvancedAiRecord(source), source);
    assert.equal(await plugin.appendAdvancedAi('Original body.', source), 'Original body.');
  }
  let diagnosticCalls = 0;
  plugin.copySupportDiagnosticText = async () => { diagnosticCalls++; return true; };
  tab.renderDiagnosticSetting(container);
  const diagnostic = controls.find(c => c.name === '诊断信息');
  assert.equal(diagnostic.controls.length, 1); assert.equal(diagnostic.control.label, '复制诊断');
  await diagnostic.control.click(); assert.equal(diagnosticCalls, 1); assert.equal(notices.at(-1), '诊断已复制');
  plugin.copySupportDiagnosticText = async () => { throw new Error('clipboard unavailable'); };
  await diagnostic.control.click(); assert.match(notices.at(-1), /复制失败/);
  assert.equal(plugin.startTranscriptMediaPlayer, undefined);
  const fs = require('node:fs');
  const path = require('node:path');
  const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'x-diagnostic-test-'));
  fs.writeFileSync(path.join(fixture, 'install.log'), 'Install failed: missing ffmpeg; api_key=synthetic-test-secret\n');
  fs.writeFileSync(path.join(fixture, 'transcribe-last.log'), 'unrelated-successful-transcript');
  fs.writeFileSync(path.join(fixture, 'sync-last.log'), 'unrelated-successful-note');
  const diagPlugin = new Plugin();
  diagPlugin.settings = Plugin.__test.mergeSettings({ xAiApiKey: 'synthetic-test-secret' });
  diagPlugin.lastSyncDiagnostic = { status: 'success', message: 'unrelated-current-success' };
  diagPlugin.getConfiguredLocalAsrInstallRoot = () => fixture;
  diagPlugin.getConfiguredLocalOcrInstallRoot = () => fixture;
  diagPlugin.getConfiguredLocalAsrPlatform = () => 'win32';
  diagPlugin.getRecentSyncFailures = () => [];
  diagPlugin.getActiveBindings = () => [];
  let diagnosticText;
  diagPlugin.copyDiagnosticText = async text => { diagnosticText = text; return true; };
  await diagPlugin.copySupportDiagnosticText();
  assert.match(diagnosticText, /未恢复失败记录：0/);
  assert.match(diagnosticText, /组件可用：否/);
  assert.match(diagnosticText, /Install failed: missing ffmpeg/);
  for (const excluded of ['synthetic-test-secret', 'unrelated-successful-transcript', 'unrelated-successful-note', 'unrelated-current-success']) assert.ok(!diagnosticText.includes(excluded));
  diagPlugin.getLocalAsrInstallStatus = () => ({ ready: true, missingReasons: [], installRoot: fixture });
  diagPlugin.getLocalOcrInstallStatus = () => ({ ready: false, hasPython: false, hasScript: true, missingReasons: ['OCR 环境缺失测试'] });
  await diagPlugin.copySupportDiagnosticText();
  assert.match(diagnosticText, /组件可用：是/); assert.match(diagnosticText, /OCR 可用：否/); assert.match(diagnosticText, /OCR 环境缺失测试/);
  diagPlugin.getSyncDiagnosticText = () => '同步'.repeat(40000);
  diagPlugin.getLocalAsrDiagnosticText = options => { assert.equal(options.installationOnly, true); return '安装'.repeat(40000); };
  await diagPlugin.copySupportDiagnosticText();
  assert.ok(Buffer.byteLength(diagnosticText, 'utf8') <= 32768 + 16384 + 2);
  const bundle = fs.readFileSync(require.resolve('../obsidian-plugin/wechat-inbox-sync/main'), 'utf8');
  for (const removed of ['分段转写时间戳', '播放器截图按钮', '复制本次失败', '复制完整诊断', 'wb-transcript-screenshot', 'wb-transcript-seek']) assert.ok(!bundle.includes(removed), `removed feature remains: ${removed}`);
  for (const removed of ['function aiConfig(settings)', 'async function processAi(post', 'function renderAi(ai', 'async function testConnection(settings', 'xAdvancedAiResult']) assert.ok(!bundle.includes(removed), `retired local X AI remains: ${removed}`);
  await require('./x-video-attachment.test').main();
  console.log('x-article-integration: all behavior tests passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
