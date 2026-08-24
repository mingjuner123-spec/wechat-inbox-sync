'use strict';

const WECHAT_ARTICLE_HOST = 'mp.weixin.qq.com';
// Keep the article identity plus WeChat's request signature/context. The
// `chksm` value is part of the signed public-account URL; dropping it can
// turn a valid article into a small guide/shell page. `scene` is retained
// because WeChat uses it when routing shared links. Other tracking/secret
// parameters remain intentionally omitted.
const WECHAT_ARTICLE_ID_PARAMS = ['__biz', 'mid', 'idx', 'sn', 'chksm', 'scene'];

function isWechatArticleUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.hostname.toLowerCase() === WECHAT_ARTICLE_HOST
      && (/^\/s$/.test(parsed.pathname || '') || /^\/s\/[^/]+$/.test(parsed.pathname || ''));
  } catch (_) {
    return false;
  }
}

function normalizeWechatArticleUrl(value) {
  if (!isWechatArticleUrl(value)) return '';
  const parsed = new URL(String(value || '').trim());
  const pathname = String(parsed.pathname || '').replace(/\/+$/, '') || '/s';
  const normalized = new URL(`https://${WECHAT_ARTICLE_HOST}${pathname}`);
  if (pathname === '/s') {
    WECHAT_ARTICLE_ID_PARAMS.forEach((key) => {
      const parameter = parsed.searchParams.get(key);
      if (parameter) normalized.searchParams.set(key, parameter);
    });
  }
  return normalized.toString();
}

function getWechatArticleUrlShape(value) {
  if (!isWechatArticleUrl(value)) return null;
  const parsed = new URL(String(value || '').trim());
  const parameterNames = Array.from(new Set(Array.from(parsed.searchParams.keys())))
    .filter(Boolean)
    .sort();
  const retainedParameterNames = parameterNames.filter((name) => WECHAT_ARTICLE_ID_PARAMS.includes(name));
  const strippedParameterNames = parameterNames.filter((name) => !WECHAT_ARTICLE_ID_PARAMS.includes(name));
  return {
    pathKind: parsed.pathname === '/s' ? 'query-id' : 'slug',
    parameterNames,
    retainedParameterNames,
    strippedParameterNames,
    hasFragment: Boolean(parsed.hash),
  };
}

function buildWechatArticleRequestProfiles(value) {
  const originalUrl = String(value || '').trim();
  const normalizedUrl = normalizeWechatArticleUrl(originalUrl);
  if (!normalizedUrl) return [];
  const originalShape = getWechatArticleUrlShape(originalUrl);
  const normalizedShape = getWechatArticleUrlShape(normalizedUrl);
  return [
    {
      id: 'original-desktop',
      inputKind: 'original-url',
      userAgentProfile: 'desktop',
      url: originalUrl,
      urlShape: originalShape,
      normalizedChanged: originalUrl !== normalizedUrl,
    },
    {
      id: 'canonical-mobile',
      inputKind: 'canonical-url',
      userAgentProfile: 'mobile',
      url: normalizedUrl,
      urlShape: normalizedShape,
      normalizedChanged: originalUrl !== normalizedUrl,
    },
  ];
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function getMetaContent(html, key) {
  const source = String(html || '');
  const escapedKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta\\b(?=[^>]*(?:name|property)=["']${escapedKey}["'])[^>]*\\bcontent=["']([^"']*)["'][^>]*>`, 'i');
  const reversedPattern = new RegExp(`<meta\\b(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*(?:name|property)=["']${escapedKey}["'][^>]*>`, 'i');
  const match = source.match(pattern) || source.match(reversedPattern);
  return match && match[1] ? decodeHtmlEntities(match[1]).trim() : '';
}

function getHtmlTitle(html) {
  const source = String(html || '');
  return getMetaContent(source, 'og:title')
    || stripHtml((source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
}

function isGenericWechatMetadata(value) {
  const text = String(value || '').replace(/\s+/g, '').trim();
  return !text
    || /^(微信公众平台|微信|微信公众号|WeChatOfficialAccountsPlatform)$/i.test(text)
    || /微信扫一扫可打开此内容|使用完整服务|使用小程序/.test(text);
}

function isTrustedCoverUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function extractWechatArticleBodyHtml(html) {
  const source = String(html || '');
  const opening = /<div\b(?=[^>]*\sid=["']js_content["'])[^>]*>/i.exec(source);
  if (!opening) return '';
  const tagName = 'div';
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  let closingIndex = source.length;
  let tagMatch;
  while ((tagMatch = tagPattern.exec(source))) {
    if (/^<\//.test(tagMatch[0])) depth -= 1;
    else if (!/\/\s*>$/.test(tagMatch[0])) depth += 1;
    if (depth === 0) {
      closingIndex = tagMatch.index;
      break;
    }
  }
  return source.slice(opening.index + opening[0].length, closingIndex);
}

function hasWechatArticleBody(html) {
  const bodyHtml = extractWechatArticleBodyHtml(html);
  // A short text article or an image-first article is still a real article.
  // The required fact is an actual js_content body, not an arbitrary length.
  return Boolean(stripHtml(bodyHtml))
    || /<img\b[^>]+(?:data-src|src)=/i.test(bodyHtml)
    || /<(?:video|audio)\b/i.test(bodyHtml);
}

function getHtmlAttribute(attributes, name) {
  const source = String(attributes || '');
  const escapedName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, 'i'));
  return decodeHtmlEntities((match && (match[1] || match[2])) || '').trim();
}

function normalizeWechatImageCandidate(value) {
  const source = decodeHtmlEntities(String(value || '').trim());
  if (!source || /^data:image\/gif/i.test(source) || /^javascript:/i.test(source)) return '';
  if (/^\/\//.test(source)) return `https:${source}`;
  if (/^https?:\/\//i.test(source)) return source;
  return '';
}

function collectWechatArticleImageCandidates(html) {
  const bodyHtml = extractWechatArticleBodyHtml(html);
  if (!bodyHtml) return [];
  const candidates = [];
  const seen = new Set();
  const imagePattern = /<img\b([^>]*)>/gi;
  let match;
  while ((match = imagePattern.exec(bodyHtml))) {
    const attributes = match[1] || '';
    const candidate = [
      getHtmlAttribute(attributes, 'data-src'),
      getHtmlAttribute(attributes, 'data-original'),
      getHtmlAttribute(attributes, 'data-lazy-src'),
      getHtmlAttribute(attributes, 'src'),
      getHtmlAttribute(attributes, 'data-fail'),
    ].map(normalizeWechatImageCandidate).find(Boolean) || '';
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

function getWechatArticleBodyStats(html) {
  const source = String(html || '');
  const bodyHtml = extractWechatArticleBodyHtml(source);
  const bodyText = stripHtml(bodyHtml);
  const imageCandidates = collectWechatArticleImageCandidates(source);
  const mediaCount = (bodyHtml.match(/<(?:video|audio|source)\b/gi) || []).length;
  return {
    hasJsContent: /<div\b(?=[^>]*\bid=["']js_content["'])/i.test(source),
    bodyHtmlChars: bodyHtml.length,
    bodyTextChars: bodyText.length,
    imageCount: imageCandidates.length,
    mediaCount,
    imageCandidates,
    hasSubstantiveBody: bodyText.length >= 50 || imageCandidates.length > 0 || mediaCount > 0,
  };
}

function isWechatEmptyShellHtml(html) {
  const source = String(html || '');
  const stats = getWechatArticleBodyStats(source);
  if (!/mp\.weixin\.qq\.com|rich_media|js_content|\u89c6\u9891|\u5c0f\u7a0b\u5e8f|\u8f7b\u70b9\u4e24\u4e0b/i.test(source)) return false;
  return !stats.hasJsContent
    || (!stats.hasSubstantiveBody && stats.bodyTextChars < 50);
}

function diagnoseWechatArticleHtml(html) {
  const source = String(html || '');
  const stats = getWechatArticleBodyStats(source);
  const classifiedState = classifyWechatArticleHtml(source);
  const text = stripHtml(source);
  const markers = {
    captcha: classifiedState === 'captcha',
    unavailable: classifiedState === 'unavailable',
    guide: classifiedState === 'guide',
    emptyShell: isWechatEmptyShellHtml(source),
    shellToolbar: /\u8f7b\u70b9\u4e24\u4e0b\u53d6\u6d88\u8d5e|\u5728\u770b|\u89c6\u9891|\u5c0f\u7a0b\u5e8f/i.test(text),
  };
  let pageKind = classifiedState;
  if (markers.emptyShell && !markers.captcha && !markers.unavailable) {
   pageKind = 'empty-shell';
 }
  return {
    pageKind,
    classifiedState,
    hasHtml: Boolean(source.trim()),
    htmlChars: source.length,
    hasJsContent: stats.hasJsContent,
    bodyHtmlChars: stats.bodyHtmlChars,
    bodyTextChars: stats.bodyTextChars,
    imageCount: stats.imageCount,
    mediaCount: stats.mediaCount,
    imageCandidateCount: stats.imageCandidates.length,
    markers,
  };
}

function classifyWechatArticleHtml(html) {
  const text = stripHtml(html);
  if (/环境异常/.test(text) && /完成验证后即可继续访问|去验证/.test(text)) return 'captcha';
  // Full article pages can contain hidden QR/app guide text outside #js_content.
  // Preserve the legacy successful behavior: substantive #js_content wins.
  if (hasWechatArticleBody(html)) return 'article';
  if (/微信扫一扫可打开此内容/.test(text) && /使用完整服务|使用小程序/.test(text)) return 'guide';
  if (/内容不存在|已删除|暂时无法查看|加载失败/.test(text)) return 'unavailable';
  return 'unknown';
}

function extractWechatArticleFallbackMetadata(html) {
  const title = getHtmlTitle(html);
  const description = getMetaContent(html, 'og:description') || getMetaContent(html, 'description');
  const coverUrl = getMetaContent(html, 'og:image');
  return {
    title: isGenericWechatMetadata(title) ? '' : title,
    description: isGenericWechatMetadata(description) ? '' : description,
    coverUrl: isTrustedCoverUrl(coverUrl) ? coverUrl : '',
  };
}

function buildWechatArticleFallbackMarkdown({
  url = '',
  state = 'guide',
  title = '',
  description = '',
  coverUrl = '',
} = {}) {
  const statusText = state === 'captcha'
    ? '公众号文章触发了微信安全验证，插件不能自动绕过验证。'
    : state === 'unavailable'
      ? '公众号文章暂时不可访问，未能取得正文。'
      : '微信公众号未返回正文，已保存原始链接和可用线索；可在微信内打开后重试。';
  const lines = [statusText, ''];
  if (title) lines.push(`标题：${title}`, '');
  if (description) lines.push(description, '');
  if (coverUrl) lines.push(`![封面](${coverUrl})`, '');
  if (url) lines.push(`原始链接：${url}`, '');
  return lines.join('\n').trim();
}

module.exports = {
  buildWechatArticleFallbackMarkdown,
  buildWechatArticleRequestProfiles,
  classifyWechatArticleHtml,
  collectWechatArticleImageCandidates,
  diagnoseWechatArticleHtml,
  extractWechatArticleFallbackMetadata,
  extractWechatArticleBodyHtml,
  getWechatArticleBodyStats,
  getWechatArticleUrlShape,
  hasWechatArticleBody,
  isWechatArticleUrl,
  isWechatEmptyShellHtml,
  isGenericWechatMetadata,
  isTrustedCoverUrl,
  normalizeWechatArticleUrl,
};
