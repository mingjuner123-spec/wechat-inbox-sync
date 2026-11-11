'use strict';

const { formatTranscriptTimestamp, transcriptSegmentsCoverText } = require('./transcript-segment-utils');

const DEFAULTS = Object.freeze({ xTranslationEnabled: false, xSummaryEnabled: false, xAiApiKey: '', xAiBaseUrl: 'https://api.deepseek.com', xAiModel: 'deepseek-flash' });
'use strict';

function fail(code, message) { return Object.assign(new Error(message), { code }); }
function abortError() { return Object.assign(new Error('操作已取消'), { name: 'AbortError', code: 'ABORT_ERR' }); }
function abort(signal) { if (signal && signal.aborted) throw abortError(); }
function isAbortError(error, signal) { return Boolean(signal && signal.aborted) || Boolean(error && error.name === 'AbortError'); }
function isXUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && !u.port && /^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/.test(u.hostname); } catch (_) { return false; }
}
function postId(value) {
  if (!isXUrl(value)) return '';
  const m = new URL(value).pathname.match(/^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d{1,25})(?:\/(?:photo|video)\/\d+)?\/?$/);
  return m ? m[1] : '';
}
function plain(value) { return String(value || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim(); }
function markdownText(value) { return plain(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#!|])/g, '\\$1'); }
function photoUrl(value) {
  try {
    const u = new URL(value);
    // Only X photo media belongs in the article image list. Video thumbnails
    // use separate paths and were being saved as extra, misleading images.
    const allowedPath = u.pathname.startsWith('/media/');
    if (u.protocol !== 'https:' || u.hostname !== 'pbs.twimg.com' || !allowedPath || u.username || u.password || u.port) return '';
    u.hash = '';
    // Keep valid query parameters such as format/name, but prevent Markdown
    // destination delimiters from escaping the image URL.
    return u.href.replace(/[()\\<>]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch (_) { return ''; }
}
function videoUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'video.twimg.com' || !u.pathname.toLowerCase().endsWith('.mp4') || u.username || u.password || u.port || u.hash) return '';
    return u.href;
  } catch (_) { return ''; }
}
function videoPosterUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'pbs.twimg.com' || u.username || u.password || u.port
      || !/^\/(?:media|amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//.test(u.pathname)) return '';
    return u.href.replace(/[()\\<>]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  } catch (_) { return ''; }
}
function syndicationVideos(items) {
  const videos = [];
  for (const item of Array.isArray(items) ? items : []) {
    const variants = item && item.video_info && Array.isArray(item.video_info.variants) ? item.video_info.variants : [];
    const candidates = variants
      .filter(variant => variant && (!variant.content_type || variant.content_type === 'video/mp4'))
      .map(variant => ({ url: videoUrl(variant.url), bitrate: Number(variant.bitrate) || 0 }))
      .filter(variant => variant.url)
      .sort((a, b) => b.bitrate - a.bitrate);
    if (candidates.length && !videos.includes(candidates[0].url)) videos.push(candidates[0].url);
  }
  return videos.slice(0, 4);
}
function collectText(value, output = [], depth = 0) {
  if (depth > 8 || value == null) return output;
  if (typeof value === 'string') {
    const text = plain(value);
    if (text && !output.includes(text)) output.push(text);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 500)) collectText(item, output, depth + 1);
    return output;
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'content', 'blocks', 'result', 'note_tweet_results', 'article', 'paragraphs']) {
      if (Object.prototype.hasOwnProperty.call(value, key)) collectText(value[key], output, depth + 1);
    }
  }
  return output;
}
function collectArticleBodyBlocks(value) {
  if (!value || typeof value !== 'object') return [];
  const content = value.content && typeof value.content === 'object' ? value.content : value;
  const sourceBlocks = Array.isArray(content.blocks) ? content.blocks : [];
  if (!sourceBlocks.length) return [];
  const mediaEntities = Array.isArray(value.media_entities) ? value.media_entities
    : Array.isArray(content.media_entities) ? content.media_entities : [];
  const entityMap = content.entityMap && typeof content.entityMap === 'object' ? content.entityMap
    : content.entity_map && typeof content.entity_map === 'object' ? content.entity_map : {};
  const mediaByEntityKey = new Map();
  const blocksByEntityKey = new Map();
  const mediaIdentity = (item) => [item && item.id, item && item.id_str, item && item.media_id,
    item && item.mediaId, item && item.media_key, item && item.mediaKey, item && item.key]
    .filter(value => value !== undefined && value !== null).map(String);
  const entities = Array.isArray(entityMap)
    ? entityMap.map(entry => [String(entry.key), entry.value]) : Object.entries(entityMap);
  for (const [key, entity] of entities) {
    const data = entity && entity.data && typeof entity.data === 'object' ? entity.data : {};
    const ids = [String(key), ...mediaIdentity(data),
      ...(Array.isArray(data.mediaItems) ? data.mediaItems.flatMap(mediaIdentity) : [])];
    const media = mediaEntities.filter(item => mediaIdentity(item).some(id => ids.includes(id)));
    const urls = media.length ? collectImages(media) : collectImages(data);
    if (urls.length) mediaByEntityKey.set(String(key), urls);
    if (entity && entity.type === 'DIVIDER') blocksByEntityKey.set(String(key), { type: 'divider' });
    if (entity && entity.type === 'MARKDOWN' && typeof data.markdown === 'string') {
      const source = plain(data.markdown);
      const fenced = source.match(/^(`{3,}|~{3,})([\w-]*)\s*\n([\s\S]*?)\n\1$/);
      blocksByEntityKey.set(String(key), fenced
        ? { type: 'code', language: fenced[2], text: fenced[3] }
        : { type: 'paragraph', text: source });
    }
  }
  const headingLevels = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const result = [];
  for (const block of sourceBlocks.slice(0, 500)) {
    if (!block || typeof block !== 'object') continue;
    const rawType = String(block.type || block.style || block.blockType || '').trim().toLowerCase().replace(/_/g, '-');
    const heading = rawType.match(/^(?:header|heading)-?(one|two|three|four|five|six|[1-6])$|^h([1-6])$/);
    const headingLevel = heading
      ? Number(heading[2] || heading[1] && (headingLevels[heading[1]] || heading[1]))
      : 0;
    const text = collectText(block).join('\n').trim();
    const imageUrls = collectImages(block);
    const ranges = Array.isArray(block.entityRanges) ? block.entityRanges
      : Array.isArray(block.entity_ranges) ? block.entity_ranges : [];
    for (const range of ranges) {
      const key = range && (range.key ?? range.entityKey ?? range.entity_key);
      const mapped = key === undefined || key === null ? [] : mediaByEntityKey.get(String(key)) || [];
      for (const imageUrl of mapped) if (!imageUrls.includes(imageUrl)) imageUrls.push(imageUrl);
      if (rawType === 'atomic' && blocksByEntityKey.has(String(key))) result.push(blocksByEntityKey.get(String(key)));
    }
    if (headingLevel && text) result.push({ type: 'heading', level: Math.min(6, Math.max(1, headingLevel)), text });
    else if (text) result.push({ type: rawType === 'blockquote' ? 'quote' : 'paragraph', text });
    for (const imageUrl of imageUrls) result.push({ type: 'image', url: imageUrl });
  }
  return result;
}
function articleTitle(...values) {
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const direct = plain(value.title);
    if (direct) return direct;
    const nested = plain(value.article && value.article.title);
    if (nested) return nested;
    const result = value.note_tweet_results && value.note_tweet_results.result;
    if (result && result !== value) {
      const title = articleTitle(result);
      if (title) return title;
    }
  }
  return '';
}
function collectMedia(payload) {
  const media = [];
  for (const rows of [payload.mediaDetails, payload.entities && payload.entities.media,
    payload.extended_entities && payload.extended_entities.media,
    payload.media && payload.media.all, payload.media]) {
    if (Array.isArray(rows)) media.push(...rows.slice(0, 30));
  }
  return media;
}
function collectImages(value, output = [], depth = 0) {
  if (depth > 9 || value == null) return output;
  if (typeof value === 'string') {
    const url = photoUrl(value);
    const key = photoIdentity(url);
    if (url && !output.some(existing => photoIdentity(existing) === key)) output.push(url);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) collectImages(item, output, depth + 1);
  } else if (typeof value === 'object') {
    for (const item of Object.values(value).slice(0, 200)) collectImages(item, output, depth + 1);
  }
  return output;
}
function photoIdentity(value) {
  try { const url = new URL(value); return `${url.hostname}${url.pathname}`; } catch (_) { return ''; }
}
function unifiedCard(payload) {
  const raw = payload && payload.card && payload.card.binding_values
    && payload.card.binding_values.unified_card && payload.card.binding_values.unified_card.string_value;
  if (typeof raw !== 'string' || raw.length > 200000) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}
function cardIndicatesVideo(payload) {
  const card = unifiedCard(payload);
  return Boolean(card && /video/i.test(String(card.type || '')));
}
function articleHasBody(article) {
  const blocks = article && article.content && article.content.blocks;
  return (Array.isArray(blocks) && blocks.some(block => plain(block && block.text)))
    || Boolean(article && article.content && !Array.isArray(blocks) && collectText(article.content).join('').trim());
}
function articleNeedsFallback(payload) {
  const article = payload && payload.article;
  if (!article || !articleTitle(article)) return false;
  return !articleHasBody(article) || (Array.isArray(article.content && article.content.entityMap) && article.content.entityMap.length > 0
    && !(Array.isArray(article.media_entities) && article.media_entities.length));
}
function readableText(value) {
  const text = plain(value).replace(/https?:\/\/\S+/gi, '').trim();
  if (!text || /^(?:read more|continue reading|view more|view on x|show more|see more|more\.\.\.|阅读全文|继续阅读|查看更多|显示更多)[.!…\s→➜➔›»]*$/i.test(text)) return '';
  return text;
}
function comparableText(value) { return plain(value).replace(/https?:\/\/\S+/gi, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function normalizeTweet(payload, expectedId, allowQuote = true) {
  if (!payload || payload.__typename !== 'Tweet' || String(payload.id_str || '') !== expectedId) throw fail('X_IDENTITY_UNCONFIRMED', 'X 未返回目标推文，可能需要登录、已删除或暂时不可访问。');
  const notePayload = payload.note_tweet && payload.note_tweet.note_tweet_results
    ? payload.note_tweet.note_tweet_results.result : payload.note_tweet;
  const noteText = collectText(notePayload).join('\n\n');
  const articleText = collectText(payload.article).join('\n\n');
  // Syndication exposes long posts as a short preview plus note_tweet.id,
  // without setting truncated. An ID is not the note's full content.
  if ((payload.truncated === true || (notePayload && !noteText)) && !noteText && !articleText) throw fail('X_LONG_POST_UNSUPPORTED', '这条 X 长文需要完整正文通道，当前返回内容不足，已保留链接等待重试。');
  const title = articleTitle(payload.article, notePayload);
  const bodyBlocks = collectArticleBodyBlocks(payload.article).length
    ? collectArticleBodyBlocks(payload.article) : collectArticleBodyBlocks(notePayload);
  const blockText = bodyBlocks.filter(block => block.type !== 'image').map(block => block.text || '').join('\n\n');
  const candidateText = readableText(blockText || noteText || articleText || payload.text);
  const text = comparableText(candidateText) && comparableText(candidateText) === comparableText(title) ? '' : candidateText.slice(0, 50000);
  const media = collectMedia(payload);
  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  const card = unifiedCard(payload);
  const article = payload.article && typeof payload.article === 'object' ? payload.article : {};
  const articleMedia = [article.cover_media, ...(Array.isArray(article.media_entities) ? article.media_entities : [])];
  const photoItems = [...photos, ...media.filter(p => p && p.type === 'photo'), ...articleMedia,
    ...(card && Array.isArray(card.media_entities) ? card.media_entities : [])];
  const images = collectImages(photoItems);
  for (const block of bodyBlocks) {
    if (block.type === 'image' && block.url
      && !images.some(existing => photoIdentity(existing) === photoIdentity(block.url))) images.push(block.url);
  }
  const videoItems = [...media, ...(Array.isArray(article.media_entities) ? article.media_entities : [])]
    .filter(p => p && (['video', 'animated_gif'].includes(p.type) || p.video_info));
  const videos = syndicationVideos(videoItems);
  if (card && Array.isArray(card.media_entities)) collectImages(card.media_entities, images);
  if (!text && !images.length && !videos.length && !cardIndicatesVideo(payload)) throw fail('X_CONTENT_EMPTY', 'X 未返回可保存的图文或视频内容。');
  const requiredPhotoItems = [...photos, ...media.filter(p => p && p.type === 'photo'),
    ...(article.cover_media ? [article.cover_media] : []),
    ...(Array.isArray(article.media_entities) ? article.media_entities : []),
    ...(card && Array.isArray(card.media_entities) ? card.media_entities : [])];
  const hasInvalidPhoto = requiredPhotoItems.some(item => !collectImages(item).length);
  if (hasInvalidPhoto) throw fail('X_IMAGE_INCOMPLETE', 'X 返回了无法读取的图片地址，请稍后重试。');
  let quote = null;
  if (allowQuote && payload.quoted_tweet && /^\d+$/.test(String(payload.quoted_tweet.id_str || ''))) quote = normalizeTweet(payload.quoted_tweet, String(payload.quoted_tweet.id_str), false);
  return { id: expectedId, url: `https://x.com/i/web/status/${expectedId}`, title, text, images, bodyBlocks, coverImage: collectImages(article.cover_media)[0] || '',
    language: plain(payload.lang),
    videoPoster: videoItems.map(item => videoPosterUrl(item.media_url_https || item.thumbnail_url || item.url)).find(Boolean) || '',
    author: plain(payload.user && (payload.user.name || payload.user.screen_name)) || plain(payload.author && (payload.author.name || payload.author.screen_name)),
    createdAt: plain(payload.created_at), hasVideo: videoItems.length > 0 || cardIndicatesVideo(payload), videos, quote };
}
function normalizeFxTweet(payload, expectedId) {
  if (payload && typeof payload === 'object' && Number(payload.code) === 429) {
    throw fail('X_FXEMBED_RATE_LIMITED', '备用 X 内容源暂时限制访问频率。');
  }
  if (!payload || typeof payload !== 'object' || Number(payload.code) !== 200) {
    throw fail('X_FXEMBED_UNAVAILABLE', '备用 X 内容源暂时无法读取这条推文。');
  }
  const status = payload.status;
  if (!status || typeof status !== 'object' || String(status.id || '') !== expectedId) {
    throw fail('X_FXEMBED_IDENTITY_MISMATCH', '备用 X 内容源返回的推文与原链接不一致。');
  }
  if (status.text !== undefined && typeof status.text !== 'string') {
    throw fail('X_FXEMBED_INVALID_PAYLOAD', '备用 X 内容源返回的数据格式不完整。');
  }
  const statusArticleText = collectText([status.note_tweet, status.article, status.note_tweet_results]).join('\n\n');
  const title = articleTitle(status.article, status.note_tweet, status.note_tweet_results);
  const articleBlocks = collectArticleBodyBlocks(status.article);
  const noteBlocks = collectArticleBodyBlocks(status.note_tweet);
  const resultBlocks = collectArticleBodyBlocks(status.note_tweet_results);
  const bodyBlocks = [articleBlocks, noteBlocks, resultBlocks]
    .sort((a, b) => b.filter(block => block.type !== 'image').reduce((n, block) => n + String(block.text || '').length, 0)
      - a.filter(block => block.type !== 'image').reduce((n, block) => n + String(block.text || '').length, 0))[0];
  const blockText = bodyBlocks.filter(block => block.type !== 'image').map(block => block.text || '').join('\n\n');
  const candidateText = readableText(blockText || statusArticleText || (typeof status.text === 'string' ? status.text : ''));
  const focalText = comparableText(candidateText) && comparableText(candidateText) === comparableText(title) ? '' : candidateText;
  const sameAuthor = (left, right) => {
    if (left.id && right.id) return String(left.id) === String(right.id);
    const handle = value => String(value.screen_name || value.username || '').trim().toLowerCase();
    return Boolean(handle(left) && handle(left) === handle(right));
  };
  const focalAuthor = status.author || payload.author || {};
  const threadBlocks = [];
  const threadTexts = [];
  const threadImages = [];
  const seenThreadText = new Set([comparableText(focalText)].filter(Boolean));
  for (const item of (Array.isArray(payload.thread) ? payload.thread : []).slice(0, 100)) {
    if (!item || typeof item !== 'object' || item.id && String(item.id) === expectedId) continue;
    const itemAuthor = item.author || {};
    // /2/thread can include replies by other people. Only append posts from
    // the focal author's own thread; never silently mix in conversation replies.
    if (!sameAuthor(focalAuthor, itemAuthor)) continue;
    const itemNote = item.note_tweet || item.note_tweet_results || item.article;
    const itemBlocks = collectArticleBodyBlocks(item.article).length
      ? collectArticleBodyBlocks(item.article) : collectArticleBodyBlocks(itemNote);
    const itemBlockText = itemBlocks.filter(block => block.type !== 'image').map(block => block.text || '').join('\n\n');
    const itemText = readableText(itemBlockText || collectText([item.note_tweet, item.note_tweet_results, item.article]).join('\n\n') || item.text || '');
    const itemIdentity = comparableText(itemText);
    if (itemIdentity && !seenThreadText.has(itemIdentity)) {
      seenThreadText.add(itemIdentity);
      threadTexts.push(itemText);
      const itemBlockText = itemBlocks.filter(block => block.type !== 'image').map(block => block.text || '').join('\n\n');
      if (itemBlocks.length && comparableText(itemBlockText).includes(itemIdentity)) threadBlocks.push(...itemBlocks);
      else threadBlocks.push({ type: 'paragraph', text: itemText }, ...itemBlocks.filter(block => block.type === 'image'));
    }
    const itemMedia = item.media && typeof item.media === 'object' ? item.media : {};
    const itemPhotos = Array.isArray(itemMedia.photos) ? itemMedia.photos : [];
    const itemPhotoUrls = collectImages(itemPhotos);
    for (const imageUrl of itemPhotoUrls) {
      if (!threadImages.includes(imageUrl)) threadImages.push(imageUrl);
      if (!itemBlocks.some(block => block.type === 'image' && block.url === imageUrl)) {
        threadBlocks.push({ type: 'image', url: imageUrl });
      }
    }
  }
  const text = [focalText, ...threadTexts].filter(Boolean).join('\n\n').slice(0, 50000);
  const media = status.media && typeof status.media === 'object' ? status.media : {};
  if (media.photos !== undefined && !Array.isArray(media.photos)) {
    throw fail('X_FXEMBED_INVALID_PAYLOAD', '备用 X 内容源返回的数据格式不完整。');
  }
  if (media.videos !== undefined && !Array.isArray(media.videos)) {
    throw fail('X_FXEMBED_INVALID_PAYLOAD', '备用 X 内容源返回的数据格式不完整。');
  }
  const photos = Array.isArray(media.photos) ? media.photos : [];
  const article = status.article && typeof status.article === 'object' ? status.article : {};
  const images = collectImages([photos, media.all, media.videos, article.cover_media, article.media_entities, article.content]);
  for (const imageUrl of threadImages) if (!images.includes(imageUrl)) images.push(imageUrl);
  if (photos.some(item => {
    const candidate = item && (item.url || item.media_url_https || item.media_info && item.media_info.original_img_url);
    return !candidate || !photoUrl(candidate);
  })) throw fail('X_FXEMBED_IMAGE_INVALID', '备用 X 内容源返回了无效图片地址。');
  const author = status.author && typeof status.author === 'object' ? status.author
    : payload.author && typeof payload.author === 'object' ? payload.author : {};
  const createdAt = plain(status.created_at)
    || (Number.isFinite(status.created_timestamp) ? new Date(status.created_timestamp * 1000).toISOString() : '');
  const videos = [];
  for (const item of Array.isArray(media.videos) ? media.videos : []) {
    const url = videoUrl(item && (item.url || item.video_url));
    for (const candidate of [url, ...syndicationVideos([item])]) if (candidate && !videos.includes(candidate)) videos.push(candidate);
  }
  if (!text && !images.length && !videos.length) throw fail('X_FXEMBED_CONTENT_EMPTY', '备用 X 内容源没有返回可保存的正文、图片或视频。');
  const baseBlockText = bodyBlocks.filter(block => block.type !== 'image').map(block => block.text || '').join('\n\n');
  const completeBodyBlocks = bodyBlocks.length && comparableText(baseBlockText).includes(comparableText(focalText))
    ? [...bodyBlocks, ...threadBlocks]
    : [...(focalText ? [{ type: 'paragraph', text: focalText }] : []), ...bodyBlocks.filter(block => block.type === 'image'), ...threadBlocks];
  return { id: expectedId, url: `https://x.com/i/web/status/${expectedId}`, title, text, images, bodyBlocks: completeBodyBlocks, coverImage: collectImages(article.cover_media)[0] || '',
    language: plain(status.lang),
    videoPoster: (media.videos || []).map(item => videoPosterUrl(item.thumbnail_url)).find(Boolean) || '',
    author: plain(author.name || author.screen_name || author.username), createdAt,
    hasVideo: Array.isArray(media.videos) && media.videos.length > 0, videos: videos.slice(0, 4) };
}
async function boundedRequest(request, url, options = {}, signal = null, timeoutMs = 30000) {
  abort(signal);
  let timer, onAbort;
  const pending = Promise.resolve().then(() => { abort(signal); return request(url, options); });
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(fail('X_REQUEST_TIMEOUT', '请求超时，请稍后重试。')), timeoutMs);
    onAbort = () => reject(Object.assign(new Error('操作已取消'), { name: 'AbortError', code: 'ABORT_ERR' }));
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
  try { const result = await Promise.race([pending, deadline]); abort(signal); return result; }
  finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
}
async function fetchPost(url, request, signal, options = {}) {
  const id = postId(url);
  if (!id) throw fail('X_POST_URL_REQUIRED', '请提供具体的 X 推文链接，暂不支持主页、书签或长文章链接。');
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  let syndicationError = null;
  let syndicationPost = null;
  let requiresFallback = false;
  let articleBodyMissing = false;
  if (!options.skipSyndication) {
    try {
      const payload = await boundedRequest(request, `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${encodeURIComponent(token)}`, {
        method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://platform.twitter.com/' },
      }, signal);
      syndicationPost = normalizeTweet(payload, id);
      articleBodyMissing = Boolean(payload.article && articleTitle(payload.article) && !articleHasBody(payload.article));
      requiresFallback = articleNeedsFallback(payload)
        || ((syndicationPost.hasVideo || cardIndicatesVideo(payload)) && !syndicationPost.videos.length);
      if (!requiresFallback) return syndicationPost;
    } catch (error) {
      if (isAbortError(error, signal)) throw abortError();
      syndicationError = error;
    }
  }
  abort(signal);
  if (options.skipFxEmbed) {
    const syndicationCode = Number(syndicationError && syndicationError.status) === 429
      ? 'X_RATE_LIMITED'
      : /^X_[A-Z0-9_]+$/.test(String(syndicationError && syndicationError.code || ''))
        ? syndicationError.code : 'X_FETCH_FAILED';
    const failure = fail(syndicationError ? syndicationCode : 'X_FXEMBED_RATE_LIMITED',
      'X 暂时限制访问频率，请稍后重试。');
    failure.xArticleProvider = syndicationError ? 'syndication' : 'none';
    if (syndicationError && /^X_[A-Z0-9_]+$/.test(String(syndicationError.code || ''))) failure.xSyndicationErrorCode = syndicationError.code;
    const status = Number(syndicationError && syndicationError.status);
    if (Number.isInteger(status) && status >= 100 && status <= 599) failure.status = status;
    throw failure;
  }
  try {
    const payload = await boundedRequest(request, `https://api.fxtwitter.com/2/thread/${id}`, {
      method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    }, signal);
    const post = normalizeFxTweet(payload, id);
    if (Number(syndicationError && syndicationError.status) === 429) post.xSyndicationRateLimited = true;
    if (!syndicationPost) return post;
    const images = collectImages([...syndicationPost.images, ...post.images]);
    const videos = [...new Set([...syndicationPost.videos, ...post.videos])].slice(0, 4);
    const richerText = post.text.length > syndicationPost.text.length ? post.text : syndicationPost.text;
    return { ...syndicationPost, ...post, title: syndicationPost.title || post.title, text: richerText,
      images, videos, hasVideo: syndicationPost.hasVideo || post.hasVideo || videos.length > 0,
      author: syndicationPost.author || post.author, createdAt: syndicationPost.createdAt || post.createdAt };
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    if (syndicationPost && requiresFallback) {
      if (articleBodyMissing) {
        throw fail('X_ARTICLE_BODY_UNAVAILABLE', 'X 长文正文或配图暂未完整读取，已保留原始链接。');
      }
      if (!syndicationPost.text && !syndicationPost.images.length && !syndicationPost.videos.length) {
        throw fail('X_VIDEO_MEDIA_UNAVAILABLE', 'X 视频媒体暂未读取成功，已保留原始链接，请稍后重试。');
      }
      return { ...syndicationPost, xMediaEnrichmentError: xMediaEnrichmentCode(error) };
    }
    const status = Number(error && error.status);
    let code = String(error && error.code || '');
    if (code === 'X_REQUEST_TIMEOUT') code = 'X_FXEMBED_TIMEOUT';
    else if (status === 429) code = 'X_FXEMBED_RATE_LIMITED';
    else if (Number.isInteger(status) && status >= 100 && status <= 599) code = 'X_FXEMBED_HTTP_ERROR';
    else if (!/^X_FXEMBED_[A-Z0-9_]+$/.test(code)) code = 'X_FXEMBED_FETCH_FAILED';
    const failure = fail(code, 'X 图文暂时无法读取，原始链接已保留。');
    failure.xArticleProvider = syndicationError ? 'both' : 'fxembed';
    if (syndicationError) {
      const syndicationCode = Number(syndicationError.status) === 429
        ? 'X_RATE_LIMITED'
        : /^X_[A-Z0-9_]+$/.test(String(syndicationError.code || ''))
          ? syndicationError.code : 'X_FETCH_FAILED';
      failure.xSyndicationErrorCode = syndicationCode;
    }
    if (Number.isInteger(status) && status >= 100 && status <= 599) failure.status = status;
    throw failure;
  }
}
function sentences(text) {
  // Social posts often start sentences in lowercase. Intl.Segmenter keeps
  // those together, so refine those boundaries without splitting common
  // abbreviations, numbered list markers, domains, or decimal numbers.
  const parts = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)].map(p => p.segment)
    : [text];
  return parts.flatMap(part => part.split(/\n+/).flatMap(line => {
    const result = []; let start = 0;
    const boundaries = /([.!?。！？])\s+(?=[\p{L}"“])/gu;
    for (const match of line.matchAll(boundaries)) {
      const prefix = line.slice(start, match.index + 1);
      if (match[1] === '.' && (/(?:\b(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc|e\.g|i\.e)|\b[A-Za-z]|\b(?:[A-Za-z]\.)+[A-Za-z]|^\s*\d+)\.$/i.test(prefix))) continue;
      result.push(prefix.trim()); start = match.index + match[0].length;
    }
    result.push(line.slice(start).trim()); return result.filter(Boolean);
  })).map(s => s.trim()).filter(Boolean);
}
function errorCode(error) {
  if (Number(error.status) === 401 || Number(error.status) === 403) return 'X_AI_AUTH_FAILED';
  if (Number(error.status) === 429 || error.code === 'X_TRANSLATION_RATE_LIMITED') return 'X_AI_RATE_LIMITED';
  return /^X_[A-Z_]+$/.test(String(error.code || '')) ? error.code : 'X_AI_REQUEST_FAILED';
}
function xMediaEnrichmentCode(error) {
  const status = Number(error && error.status);
  const code = String(error && error.code || '');
  if (code === 'X_REQUEST_TIMEOUT') return 'X_FXEMBED_TIMEOUT';
  if (status === 429) return 'X_FXEMBED_RATE_LIMITED';
  if (/^X_FXEMBED_[A-Z0-9_]+$/.test(code)) return code;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return 'X_FXEMBED_HTTP_ERROR';
  return 'X_FXEMBED_FETCH_FAILED';
}
function needsTranslation(value) {
  const text = plain(value).replace(/https?:\/\/\S+/g, '');
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}]/u.test(text)) return true;
  const chinese = (text.match(/\p{Script=Han}/gu) || []).length;
  return !chinese || chinese / letters.length < 0.5;
}
function recordText(record = {}) {
  const metadata = record.metadata || {};
  if (metadata.transcriptionQualityStatus === 'rejected') return '';
  const transcriptReady = !['failed', 'pending', 'queued', 'processing', 'no_speech'].includes(String(metadata.transcriptionStatus || '').toLowerCase());
  let text = transcriptReady && typeof metadata.transcription === 'string' ? metadata.transcription : '';
  if (!text && transcriptReady && Array.isArray(metadata.transcriptionSegments)) text = metadata.transcriptionSegments.map(row => row.text || '').join('\n');
  const bodyUnavailable = /正文未获取|未返回可读正文/.test(String(metadata.conversionNote || ''));
  if (!text && !bodyUnavailable && !['failed', 'pending', 'queued', 'processing', 'link_saved', 'attachment_saved', 'wechat_captcha'].includes(String(metadata.conversionStatus || '').toLowerCase())) {
    text = metadata.xOriginalText || metadata.markdown || metadata.convertedMarkdown || metadata.snapshot || metadata.contentSnapshot || '';
  }
  if (!text && record.type === 'text' && !metadata.webpageMediaType && !metadata.conversionStatus) text = record.content || '';
  return plain(text)
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '')
    .replace(/```[^\n]*\n[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!?\[\[[^\]]*\]\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*)/gm, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .trim();
}
async function processCloudTranslation(post, translate, signal) {
  const result = { titleTranslation: '', pairs: [], summary: '', warnings: [] };
  if (!postId(post && post.url)) return result;
  abort(signal);
  const text = plain(post.aiText || [post.text, post.quote && post.quote.text, post.videoTranscript].filter(Boolean).join('\n\n'));
  const title = plain(post.title);
  if (text.length + title.length > 120000) { result.warnings.push('X_AI_INPUT_TOO_LARGE'); return result; }
  const items = [
    ...(title && needsTranslation(title) ? [{ id: -1, original: title }] : []),
    ...sentences(text).map((original, id) => ({ id, original })).filter(item => needsTranslation(item.original)),
  ];
  if (!items.length) return result;
  try {
    if (items.some(item => item.original.length > 5000)) throw fail('X_AI_INPUT_TOO_LARGE', '单句过长。');
    const translated = [];
    let batch = [], size = 0;
    const flush = async () => {
      if (!batch.length) return;
      abort(signal);
      const response = await translate({ url: post.url, items: batch }, signal);
      abort(signal);
      const rows = response && response.translations;
      if (!Array.isArray(rows) || rows.length !== batch.length || rows.some((row, index) => !row || row.id !== batch[index].id
        || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 16000)) {
        throw fail('X_AI_ALIGNMENT_FAILED', '译句未能逐句对应原文。');
      }
      translated.push(...rows.map((row, index) => ({ id: batch[index].id, original: batch[index].original, translation: row.text.trim() })));
      batch = []; size = 0;
    };
    for (const item of items) {
      if (batch.length >= 20 || size + item.original.length > 5000) await flush();
      batch.push(item); size += item.original.length;
    }
    await flush();
    result.titleTranslation = (translated.find(row => row.id === -1) || {}).translation || '';
    result.pairs = translated.filter(row => row.id !== -1 && row.translation !== row.original);
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    result.warnings.push(errorCode(error));
  }
  return result;
}

function renderPost(post, ai = {}) {
  const title = plain(post.title || 'X');
  const displayedTitle = ai.titleTranslation && ai.titleTranslation !== title
    ? `${markdownText(ai.titleTranslation)}（${markdownText(title)}）` : markdownText(title);
  const sections = [`# **${displayedTitle}**`];
  const timedSegments = Array.isArray(post.videoTranscriptSegments) ? post.videoTranscriptSegments : [];
  // Each clip starts at zero. Check coverage in clip order while displaying
  // the original timestamps. Never hide source text for an incomplete result.
  const coverageSegments = timedSegments.map((segment, index) => ({
    ...segment, startMs: index * 1000, endMs: (index + 1) * 1000,
  }));
  const hasTimedTranscript = Boolean(post.videoTranscript && timedSegments.length
    && transcriptSegmentsCoverText(coverageSegments, post.videoTranscript));
  const transcriptOnly = hasTimedTranscript && !post.transcriptionError;
  const bodyBlocks = Array.isArray(post.bodyBlocks) ? post.bodyBlocks : [];
  const bodyImageUrls = new Set(bodyBlocks.filter(block => block.type === 'image').map(block => photoIdentity(block.url)));
  const outsideImages = (post.images || []).filter(url => !bodyImageUrls.has(photoIdentity(url)));
  // Article cover belongs ahead of the body; inline photos remain at their
  // source positions. Ordinary tweet photos follow their tweet text.
  if (post.coverImage && outsideImages.includes(post.coverImage)) sections.push(`![X 封面](${post.coverImage})`);
  else if (videoPosterUrl(post.videoPoster)) sections.push(`![X 视频封面](${videoPosterUrl(post.videoPoster)})`);
  if (bodyBlocks.length) {
    let bodyImageIndex = 0;
    const body = bodyBlocks.map(block => {
      if (block.type === 'image' && block.url) return `![X 图片 ${++bodyImageIndex}](${block.url})`;
      if (transcriptOnly) return '';
      if (block.type === 'divider') return '---';
      if (block.type === 'code') {
        const fence = '`'.repeat(Math.max(3, ...([...String(block.text || '').matchAll(/`+/g)].map(match => match[0].length + 1))));
        return `${fence}${/^[\w-]*$/.test(block.language || '') ? block.language || '' : ''}\n${block.text || ''}\n${fence}`;
      }
      const text = renderSentencePairs(block.text || '', ai.pairs);
      if (!text) return '';
      if (block.type === 'heading') return `${'#'.repeat(Math.min(6, Math.max(1, Number(block.level) || 2)))} ${text}`;
      return block.type === 'quote' ? `> ${text.replace(/\n/g, '\n> ')}` : text;
    }).filter(Boolean).join('\n\n');
    if (body) sections.push(...(transcriptOnly ? [body] : ['## 正文', body]));
  } else if (post.text && !transcriptOnly) sections.push('## 正文', renderSentencePairs(post.text, ai.pairs));
  if (post.videoTranscript) {
    if (hasTimedTranscript) {
      const multipleVideos = new Set(timedSegments.map(segment => Number(segment.videoIndex) || 1)).size > 1;
      const rendered = [];
      let currentVideo = 0;
      for (const segment of timedSegments) {
        const videoIndex = Number(segment.videoIndex) || 1;
        if (multipleVideos && currentVideo !== videoIndex) {
          rendered.push(`### 视频 ${videoIndex}`);
          currentVideo = videoIndex;
        }
        rendered.push(`**[${formatTranscriptTimestamp(segment.startMs)}]**`, renderSentencePairs(segment.text, ai.pairs));
      }
      sections.push('## 视频转写', rendered.join('\n\n'));
    } else {
      sections.push('## 视频转写', renderSentencePairs(post.videoTranscript, ai.pairs));
    }
  }
  sections.push(...outsideImages.filter(url => url !== post.coverImage).map((url, i) => `![X 图片 ${i + 1}](${url})`));
  if (post.quote) {
    const quoteImages = (post.quote.images || []).map((url, i) => `![引用图片 ${i + 1}](${url})`);
    if (transcriptOnly) sections.push(...quoteImages);
    else sections.push('### 引用推文', markdownText(post.quote.author), renderSentencePairs(post.quote.text, ai.pairs), ...quoteImages, `来源：${post.quote.url}`);
  }
  if (ai.warnings && ai.warnings.length) sections.push('> 翻译暂未完成，原文与图片已保留。');
  return sections.filter(Boolean).join('\n\n');
}
function renderSentencePairs(text, pairs = []) {
  const translations = new Map((Array.isArray(pairs) ? pairs : []).map(pair => [pair.original, pair.translation]));
  return sentences(plain(text)).map(original => {
    const translation = translations.get(original);
    return translation && translation !== original
      ? `${markdownText(translation)}\n\n> ${markdownText(original).replace(/\n/g, '\n> ')}`
      : markdownText(original);
  }).join('\n\n');
}
module.exports = { DEFAULTS, isXUrl, postId, photoUrl, videoUrl, normalizeTweet, normalizeFxTweet, fetchPost, sentences, needsTranslation, recordText, processCloudTranslation, renderPost, errorCode, boundedRequest, collectArticleBodyBlocks };
