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

function createMediaResolver({
  runYtDlp,
  fetchHtml,
  renderMediaUrls,
  resolveFinalUrl,
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
  createMediaResolver,
  extractMediaUrlFromHtml,
  isAllowedResolveUrl,
  normalizeResolveRequest,
  pickBestYtDlpMedia,
};
