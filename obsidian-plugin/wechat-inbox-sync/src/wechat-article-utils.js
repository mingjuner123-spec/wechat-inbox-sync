'use strict';

const WECHAT_ARTICLE_HOST = 'mp.weixin.qq.com';
const WECHAT_ARTICLE_ID_PARAMS = ['__biz', 'mid', 'idx', 'sn'];

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

function hasWechatArticleBody(html) {
  const source = String(html || '');
  const opening = /<div\b(?=[^>]*\sid=["']js_content["'])[^>]*>/i.exec(source);
  if (!opening) return false;
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
  const bodyHtml = source.slice(opening.index + opening[0].length, closingIndex);
  return stripHtml(bodyHtml).length >= 20;
}

function classifyWechatArticleHtml(html) {
  const text = stripHtml(html);
  if (/环境异常/.test(text) && /完成验证后即可继续访问|去验证/.test(text)) return 'captcha';
  if (/微信扫一扫可打开此内容/.test(text) && /使用完整服务|使用小程序/.test(text)) return 'guide';
  if (hasWechatArticleBody(html)) return 'article';
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
  classifyWechatArticleHtml,
  extractWechatArticleFallbackMetadata,
  hasWechatArticleBody,
  isWechatArticleUrl,
  isGenericWechatMetadata,
  isTrustedCoverUrl,
  normalizeWechatArticleUrl,
};
