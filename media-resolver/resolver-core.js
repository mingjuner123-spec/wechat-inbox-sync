const SUPPORTED_HOST_PATTERNS = [
  /(^|\.)xiaohongshu\.com$/i,
  /(^|\.)xhslink\.com$/i,
  /(^|\.)douyin\.com$/i,
  /(^|\.)iesdouyin\.com$/i,
  /(^|\.)amemv\.com$/i,
  /(^|\.)bilibili\.com$/i,
  /(^|\.)b23\.tv$/i,
  /(^|\.)xiaoyuzhoufm\.com$/i,
  /(^|\.)xiaoyuzhou\.com$/i,
  /^weixin\.qq\.com$/i,
  /(^|\.)channels\.weixin\.qq\.com$/i,
];

const WECHAT_CHANNELS_FEED_INFO_URL = 'https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info';

const WECHAT_CHANNELS_MEDIA_URL_KEYS = [
  'videoUrl',
  'video_url',
  'mediaUrl',
  'media_url',
  'downloadUrl',
  'download_url',
  'fileUrl',
  'file_url',
  'url',
];

const WECHAT_CHANNELS_DECODE_KEY_KEYS = [
  'decodeKey',
  'decode_key',
  'decodekey',
];

const WECHAT_CHANNELS_MEDIA_CONTAINER_KEYS = [
  'media',
  'mediaList',
  'media_list',
  'h264VideoInfo',
  'h264_video_info',
  'h265VideoInfo',
  'h265_video_info',
  'videoInfo',
  'video_info',
  'objectDesc',
  'object_desc',
  'feedInfo',
  'feed_info',
  'data',
];

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function isAllowedResolveUrl(url) {
  if (!isHttpUrl(url)) return false;
  try {
    const parsed = new URL(url);
    return SUPPORTED_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
  } catch (error) {
    return false;
  }
}

function normalizeResolveRequest(input = {}) {
  const url = String(input.url || '').trim();
  if (!isHttpUrl(url)) {
    throw new Error('invalid url');
  }
  if (!isAllowedResolveUrl(url)) {
    throw new Error('unsupported url host');
  }
  return { url };
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function decodeUrlComponentSafely(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (error) {
    return String(value || '');
  }
}

function normalizeExtractedUrl(url) {
  const normalized = decodeHtmlAttribute(String(url || ''))
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .trim();
  return normalized.startsWith('//') ? `https:${normalized}` : normalized;
}

function cleanSocialDescription(text) {
  return String(text || '')
    .replace(/\\n/g, '\n')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+#/g, '\n#')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTagsFromText(text) {
  const tags = [];
  const hashPattern = /#([\p{L}\p{N}_-]{1,32})/gu;
  let match;
  while ((match = hashPattern.exec(String(text || '')))) {
    const tag = `#${match[1]}`;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function readObjectString(object, keys) {
  if (!isPlainObject(object)) return '';
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function buildWechatChannelsTitle(description, fallback = '视频号文案') {
  const firstLine = String(description || '')
    .replace(/#[\p{L}\p{N}_-]{1,32}/gu, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
  return (firstLine || fallback).slice(0, 32);
}

function isWechatChannelsUrl(url) {
  const text = String(url || '').toLowerCase();
  if (/weixin\.qq\.com\/sph\//i.test(text)) return true;
  try {
    const parsed = new URL(text);
    return parsed.hostname === 'channels.weixin.qq.com';
  } catch (error) {
    return text.includes('channels.weixin.qq.com');
  }
}

function extractWechatChannelsRequestPayload(url) {
  const source = String(url || '').trim();
  try {
    const parsed = new URL(source);
    const hostname = parsed.hostname.toLowerCase();
    const path = parsed.pathname || '';
    if (hostname === 'weixin.qq.com') {
      const match = path.match(/\/sph\/([^/?#]+)/i);
      if (match && match[1]) return { shortUri: decodeURIComponent(match[1]) };
    }
    if (hostname === 'channels.weixin.qq.com') {
      const id = parsed.searchParams.get('id');
      if (id) return { shortUri: id };
      const eid = parsed.searchParams.get('eid');
      if (eid) return { exportId: eid };
    }
  } catch (error) {
    // Fall through to regex extraction for malformed copied links.
  }

  const shortMatch = source.match(/weixin\.qq\.com\/sph\/([^/?#\s]+)/i)
    || source.match(/[?&]id=([^&#\s]+)/i);
  if (shortMatch && shortMatch[1]) {
    return { shortUri: decodeUrlComponentSafely(shortMatch[1]) };
  }
  const exportMatch = source.match(/[?&]eid=([^&#\s]+)/i);
  if (exportMatch && exportMatch[1]) {
    return { exportId: decodeUrlComponentSafely(exportMatch[1]) };
  }
  return {};
}

function isImageUrl(url) {
  return /\.(?:jpg|jpeg|png|webp|gif|svg)(?:[?#]|$)/i.test(String(url || ''));
}

function isLikelyWechatChannelsMediaUrl(url) {
  const value = normalizeExtractedUrl(url);
  if (!isHttpUrl(value) || isImageUrl(value)) return false;
  return /finder\.video\.qq\.com|mpvideo|video|media|\.mp4|\.m4s|\.m3u8|mime_type=video/i.test(value);
}

function pushWechatChannelsMediaCandidate(candidates, object, forceMediaObject = false) {
  if (!isPlainObject(object)) return;
  const url = normalizeExtractedUrl(readObjectString(object, WECHAT_CHANNELS_MEDIA_URL_KEYS));
  if (!url || !isHttpUrl(url)) return;
  if (isImageUrl(url)) return;
  if (!forceMediaObject && !isLikelyWechatChannelsMediaUrl(url)) return;

  const decodeKey = readObjectString(object, WECHAT_CHANNELS_DECODE_KEY_KEYS);
  if (!candidates.some((candidate) => candidate.url === url)) {
    candidates.push({ url, decodeKey });
  }
}

function collectWechatChannelsMediaCandidates(value, candidates = [], seen = new Set(), forceMediaObject = false) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectWechatChannelsMediaCandidates(item, candidates, seen, forceMediaObject));
    return candidates;
  }
  if (!isPlainObject(value) || seen.has(value)) return candidates;
  seen.add(value);

  pushWechatChannelsMediaCandidate(candidates, value, forceMediaObject);

  for (const key of WECHAT_CHANNELS_MEDIA_CONTAINER_KEYS) {
    if (value[key] !== undefined && value[key] !== null) {
      const childIsMediaObject = forceMediaObject
        || key.toLowerCase().includes('media')
        || key.toLowerCase().includes('video');
      collectWechatChannelsMediaCandidates(value[key], candidates, seen, childIsMediaObject);
    }
  }

  return candidates;
}

function normalizeWechatChannelsFeedPayload(payload) {
  const root = isPlainObject(payload) ? payload : {};
  const data = isPlainObject(root.data) ? root.data : {};
  const feedInfo = isPlainObject(data.feedInfo) ? data.feedInfo
    : isPlainObject(data.feed_info) ? data.feed_info
      : {};
  const objectDesc = isPlainObject(data.object_desc) ? data.object_desc
    : isPlainObject(data.objectDesc) ? data.objectDesc
      : isPlainObject(feedInfo.object_desc) ? feedInfo.object_desc
        : isPlainObject(feedInfo.objectDesc) ? feedInfo.objectDesc
          : {};
  const authorInfo = isPlainObject(data.authorInfo) ? data.authorInfo
    : isPlainObject(data.author_info) ? data.author_info
      : {};
  const sceneInfo = isPlainObject(data.sceneInfo) ? data.sceneInfo
    : isPlainObject(data.scene_info) ? data.scene_info
      : {};
  const errMsg = isPlainObject(data.errMsg) ? data.errMsg : {};

  const description = cleanSocialDescription(
    readObjectString(feedInfo, ['description', 'desc'])
    || readObjectString(objectDesc, ['description', 'desc'])
    || readObjectString(data, ['description', 'desc']),
  );
  const mediaCandidates = collectWechatChannelsMediaCandidates(root);
  const mediaUrls = mediaCandidates.map((candidate) => candidate.url);
  const firstMedia = mediaCandidates[0] || {};
  const decodeKey = firstMedia.decodeKey || mediaCandidates.find((candidate) => candidate.decodeKey)?.decodeKey || '';

  return {
    title: buildWechatChannelsTitle(description),
    author: cleanSocialDescription(readObjectString(authorInfo, ['nickname', 'nickName', 'name'])),
    description,
    tags: extractTagsFromText(description),
    coverUrl: normalizeExtractedUrl(readObjectString(feedInfo, ['coverUrl', 'cover_url'])
      || readObjectString(objectDesc, ['coverUrl', 'cover_url'])
      || readObjectString(data, ['coverUrl', 'cover_url'])),
    videoUrl: firstMedia.url || '',
    mediaUrls,
    decodeKey,
    dynamicExportId: String(readObjectString(sceneInfo, ['dynamicExportId', 'dynamic_export_id']) || ''),
    errMsg: String(readObjectString(errMsg, ['title', 'content']) || root.errMsg || '').trim(),
  };
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getHtmlAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const match = String(tag || '').match(pattern);
  if (!match) return '';
  return decodeHtmlAttribute(String(match[1] || '').replace(/^['"]|['"]$/g, '').trim());
}

function resolveMediaUrl(url, baseUrl) {
  const value = decodeHtmlAttribute(url).trim();
  if (!value) return '';
  if (isHttpUrl(value)) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function extractMediaUrlFromHtml(html, pageUrl) {
  const source = String(html || '');
  const metaPattern = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaPattern.exec(source))) {
    const tag = match[0];
    const key = `${getHtmlAttribute(tag, 'property')} ${getHtmlAttribute(tag, 'name')}`.toLowerCase();
    if (
      key.includes('og:video')
      || key.includes('og:audio')
      || key.includes('twitter:player:stream')
      || key.includes('twitter:video')
      || key.includes('twitter:audio')
    ) {
      const content = resolveMediaUrl(getHtmlAttribute(tag, 'content'), pageUrl);
      if (content) return content;
    }
  }

  const mediaPattern = /<(?:video|audio|source)\b[^>]*\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
  while ((match = mediaPattern.exec(source))) {
    const mediaUrl = resolveMediaUrl(String(match[1] || '').replace(/^['"]|['"]$/g, ''), pageUrl);
    if (mediaUrl) return mediaUrl;
  }

  return '';
}

function parseYtDlpOutput(output) {
  if (!output) return null;
  if (typeof output === 'object') return output;
  try {
    return JSON.parse(String(output));
  } catch (error) {
    return null;
  }
}

function normalizeDurationSeconds(value) {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
}

function normalizeHttpHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  return Object.fromEntries(Object.entries(headers)
    .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
    .filter(([key, value]) => key && value));
}

function buildYtDlpMediaResult(item, mediaUrl, format = {}) {
  const headers = {
    ...normalizeHttpHeaders(item.http_headers),
    ...normalizeHttpHeaders(format.http_headers),
  };
  const result = {
    mediaUrl,
    title: String(item.title || ''),
    durationSeconds: normalizeDurationSeconds(item.duration),
    source: 'yt-dlp',
  };
  if (Object.keys(headers).length > 0) {
    result.headers = headers;
  }
  return result;
}

function isAudioOnlyFormat(format) {
  return String(format && format.url || '').trim()
    && String(format.vcodec || '').toLowerCase() === 'none'
    && String(format.acodec || '').toLowerCase() !== 'none';
}

function pickBestYtDlpMedia(output) {
  const item = parseYtDlpOutput(output);
  if (!item || typeof item !== 'object') return null;
  const entries = Array.isArray(item.entries) ? item.entries.filter(Boolean) : [item];
  for (const entry of entries) {
    const formats = Array.isArray(entry.formats) ? entry.formats : [];
    const audioFormats = formats
      .filter(isAudioOnlyFormat)
      .sort((a, b) => Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0));
    if (audioFormats[0]) {
      return buildYtDlpMediaResult(entry, String(audioFormats[0].url || '').trim(), audioFormats[0]);
    }
    if (isHttpUrl(entry.url)) {
      return buildYtDlpMediaResult(entry, String(entry.url || '').trim());
    }
    const directFormat = formats.find((format) => isHttpUrl(format && format.url));
    if (directFormat) {
      return buildYtDlpMediaResult(entry, String(directFormat.url || '').trim(), directFormat);
    }
  }
  return null;
}

function createFailure(errCode, errMsg) {
  return {
    success: false,
    errCode,
    errMsg,
  };
}

async function tryYtDlp(runYtDlp, url) {
  if (typeof runYtDlp !== 'function') return null;
  const output = await runYtDlp(url);
  return pickBestYtDlpMedia(output);
}

async function tryWechatChannelsFeed(fetchWechatChannelsFeedInfo, url) {
  if (!isWechatChannelsUrl(url) || typeof fetchWechatChannelsFeedInfo !== 'function') return null;
  const payload = await fetchWechatChannelsFeedInfo(url);
  const feed = normalizeWechatChannelsFeedPayload(payload);
  if (!feed.videoUrl) return null;

  const result = {
    mediaUrl: feed.videoUrl,
    title: feed.title || '',
    durationSeconds: 0,
    source: 'wechat-channels-feed',
    author: feed.author || '',
    description: feed.description || '',
    headers: {
      Referer: 'https://channels.weixin.qq.com/',
      'User-Agent': 'Mozilla/5.0 WeChatInboxMediaResolver/1.0',
    },
  };
  if (feed.decodeKey) {
    result.decodeKey = feed.decodeKey;
    result.encrypted = true;
  }
  return result;
}

function createMediaResolver({
  runYtDlp,
  fetchHtml,
  renderMediaUrls,
  resolveFinalUrl,
  fetchWechatChannelsFeedInfo,
} = {}) {
  return {
    async resolve(input) {
      let normalized;
      try {
        normalized = normalizeResolveRequest(input);
      } catch (error) {
        return createFailure('INVALID_URL', error.message || 'invalid url');
      }

      try {
        const data = await tryWechatChannelsFeed(fetchWechatChannelsFeedInfo, normalized.url);
        if (data && data.mediaUrl) {
          return { success: true, data };
        }
      } catch (error) {
        // Continue to generic media extraction.
      }

      try {
        const data = await tryYtDlp(runYtDlp, normalized.url);
        if (data && data.mediaUrl) {
          return { success: true, data };
        }
      } catch (error) {
        // Try the final redirect URL below.
      }

      try {
        if (typeof resolveFinalUrl === 'function') {
          const finalUrl = await resolveFinalUrl(normalized.url);
          if (finalUrl && finalUrl !== normalized.url && isAllowedResolveUrl(finalUrl)) {
            const data = await tryYtDlp(runYtDlp, finalUrl);
            if (data && data.mediaUrl) {
              return { success: true, data };
            }
          }
        }
      } catch (error) {
        // Continue to lighter fallbacks.
      }

      try {
        if (typeof fetchHtml === 'function') {
          const html = await fetchHtml(normalized.url);
          const mediaUrl = extractMediaUrlFromHtml(html, normalized.url);
          if (mediaUrl) {
            return {
              success: true,
              data: {
                mediaUrl,
                title: '',
                durationSeconds: 0,
                source: 'html',
              },
            };
          }
        }
      } catch (error) {
        // Continue to optional browser-render fallback.
      }

      try {
        if (typeof renderMediaUrls === 'function') {
          const urls = await renderMediaUrls(normalized.url);
          const mediaUrl = Array.isArray(urls) ? urls.find(isHttpUrl) : '';
          if (mediaUrl) {
            return {
              success: true,
              data: {
                mediaUrl,
                title: '',
                durationSeconds: 0,
                source: 'browser',
              },
            };
          }
        }
      } catch (error) {
        // Return a consistent miss below.
      }

      return createFailure('MEDIA_NOT_FOUND', '未能解析到可转写的音视频地址');
    },
  };
}

module.exports = {
  SUPPORTED_HOST_PATTERNS,
  WECHAT_CHANNELS_FEED_INFO_URL,
  createMediaResolver,
  extractMediaUrlFromHtml,
  extractWechatChannelsRequestPayload,
  isWechatChannelsUrl,
  normalizeWechatChannelsFeedPayload,
  isAllowedResolveUrl,
  normalizeResolveRequest,
  pickBestYtDlpMedia,
};
