'use strict';

// Platform detection, URL normalisation and server-rendered payload parsing for
// Zhihu and Toutiao. Kept free of Obsidian/Electron APIs so it can be unit
// tested in plain Node.

const ZHIHU_ROOTS = ['zhihu.com'];
const TOUTIAO_ROOTS = ['toutiao.com'];

const TRACKING_PARAM = /^(?:utm_[a-z0-9_]+|share_[a-z0-9_]+|from|source|spm|tt_from|traffic_source|isappinstalled|wxshare_count|scene|share_token|share_source|s_r|s_c|share_medium|share_plat|share_tag|timestamp|utm)$/i;

function cleanHost(value) {
  return String(value || '').toLowerCase().replace(/\.$/, '');
}

function getHttpHostname(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password) return '';
    return cleanHost(parsed.hostname);
  } catch (error) {
    return '';
  }
}

function isHostWithin(url, roots) {
  const hostname = getHttpHostname(url);
  if (!hostname) return false;
  return roots.some((root) => hostname === root || hostname.endsWith(`.${root}`));
}

function isZhihuUrl(url) {
  return isHostWithin(url, ZHIHU_ROOTS);
}

function isToutiaoUrl(url) {
  return isHostWithin(url, TOUTIAO_ROOTS);
}

function isPlatformArticleUrl(url) {
  return isZhihuUrl(url) || isToutiaoUrl(url);
}

function getPlatformArticleKind(url) {
  if (isZhihuUrl(url)) return 'zhihu';
  if (isToutiaoUrl(url)) return 'toutiao';
  return '';
}

function getPlatformArticleLabel(url) {
  const kind = getPlatformArticleKind(url);
  if (kind === 'zhihu') return '知乎';
  if (kind === 'toutiao') return '今日头条';
  return '';
}

function getPlatformArticleReferer(url) {
  if (isZhihuUrl(url)) return 'https://www.zhihu.com/';
  if (isToutiaoUrl(url)) return 'https://www.toutiao.com/';
  return '';
}

// Only the article's own official host may load inside the hidden extraction
// window. Toutiao bounces article loads through redirects; Obsidian's inherited
// will-navigate handler forwards those to shell.openExternal, which opened the
// system browser and left the extraction window empty.
const PLATFORM_ARTICLE_NAVIGATION_ROOTS = {
  zhihu: ZHIHU_ROOTS,
  toutiao: TOUTIAO_ROOTS,
};

function isAllowedPlatformArticleNavigation(url, platform) {
  const roots = PLATFORM_ARTICLE_NAVIGATION_ROOTS[platform];
  if (!roots) return false;
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch (error) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  const hostname = cleanHost(parsed.hostname);
  return roots.some((root) => hostname === root || hostname.endsWith(`.${root}`));
}

// Zhihu share links wrap the real target in ?target=. Unwrap until the value
// stops changing so a doubly-encoded share link still resolves.
function unwrapZhihuRedirect(parsed) {
  if (!isHostWithin(parsed.toString(), ZHIHU_ROOTS)) return null;
  if (cleanHost(parsed.hostname) !== 'link.zhihu.com') return null;
  let current = parsed;
  for (let index = 0; index < 3; index += 1) {
    const target = current.searchParams.get('target');
    if (!target) break;
    let next;
    try {
      next = new URL(target);
    } catch (error) {
      break;
    }
    if (!['http:', 'https:'].includes(next.protocol)) break;
    if (next.hostname.endsWith('.')) break;
    current = next;
  }
  return current === parsed ? null : current;
}

const ZHIHU_CANONICAL_PATH = /\/(?:p|answer)\/\d+\/?$|\/question\/\d+\/answer\/\d+\/?$|\/question\/\d+\/?$/i;
const TOUTIAO_CANONICAL_PATH = /\/(?:article|group|item)\/\d+\/?$|\/[ai]\d{6,}\/?$/i;

function normalizePlatformArticleUrl(url) {
  const source = String(url || '').trim();
  if (!isPlatformArticleUrl(source)) return source;
  let parsed;
  try {
    parsed = new URL(source);
  } catch (error) {
    return source;
  }
  const unwrapped = unwrapZhihuRedirect(parsed);
  if (unwrapped) parsed = unwrapped;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return source;
  if (parsed.username || parsed.password) return source;

  const hostname = cleanHost(parsed.hostname);
  const kind = isZhihuUrl(parsed.toString()) ? 'zhihu' : (isToutiaoUrl(parsed.toString()) ? 'toutiao' : '');
  if (!kind) return source;

  const canonicalPath = kind === 'zhihu'
    ? ZHIHU_CANONICAL_PATH.test(parsed.pathname)
    : TOUTIAO_CANONICAL_PATH.test(parsed.pathname);

  const result = new URL(`${parsed.protocol}//${hostname}${parsed.pathname}`);
  if (!canonicalPath) {
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!TRACKING_PARAM.test(key)) result.searchParams.append(key, value);
    }
  }
  // Article identity never lives in the fragment for either platform.
  return result.toString();
}

function decodeRenderDataScript(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const candidates = [value];
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value) candidates.push(decoded);
  } catch (error) {
    // A literal percent sign inside the JSON makes decodeURIComponent throw.
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      // Try the next decoding candidate.
    }
  }
  return null;
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function findArticleLikeObject(root) {
  if (!root || typeof root !== 'object') return null;
  const queue = [root];
  const seen = new Set();
  let best = null;
  let visited = 0;
  while (queue.length && visited < 20000) {
    const node = queue.shift();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    visited += 1;
    if (Array.isArray(node)) {
      for (const item of node) queue.push(item);
      continue;
    }
    const content = typeof node.content === 'string' ? node.content : '';
    const title = pickString(node.title, node.article_title, node.headline);
    if (content && content.length >= 40 && (title || node.articleInfo)) {
      const score = content.length + (title ? 1000 : 0);
      if (!best || score > best.score) best = { node, content, title, score };
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return best;
}

function parseToutiaoRenderData(html) {
  const source = String(html || '');
  const match = source.match(/<script[^>]*\bid=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i)
    || source.match(/<script[^>]*\bid=["']render_data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const data = decodeRenderDataScript(match[1]);
  if (!data) return null;
  const found = findArticleLikeObject(data);
  if (!found) return null;
  const node = found.node;
  const mediaUser = node.media_user && typeof node.media_user === 'object' ? node.media_user : {};
  const author = pickString(
    node.author,
    node.source,
    node.name,
    mediaUser.screen_name,
    mediaUser.name,
    node.user_info && node.user_info.name,
  );
  const contentHtml = String(found.content || '');
  return {
    title: pickString(node.title, node.article_title, node.headline),
    author,
    contentHtml: /<[a-z][\s\S]*>/i.test(contentHtml) ? contentHtml : '',
    contentText: /<[a-z][\s\S]*>/i.test(contentHtml) ? '' : contentHtml,
    publishTime: pickString(node.publish_time, node.create_time, node.datetime),
    source: 'render-data',
  };
}

function getZhihuEntityContent(entity) {
  if (!entity || typeof entity !== 'object') return '';
  // Answers and articles both expose HTML under content; some payloads nest it
  // under a rich-text wrapper.
  const direct = pickString(entity.content, entity.contentHtml);
  if (direct) return direct;
  const nested = entity.rich_text && typeof entity.rich_text === 'object'
    ? pickString(entity.rich_text.content, entity.rich_text.contentHtml)
    : '';
  return nested;
}

function parseZhihuInitialData(html) {
  const source = String(html || '');
  const match = source.match(/<script[^>]*\bid=["']js-initialData["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const raw = String(match[1] || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return null;
  }
  const initialState = parsed && parsed.initialState && typeof parsed.initialState === 'object'
    ? parsed.initialState
    : parsed;
  const entities = initialState && initialState.entities && typeof initialState.entities === 'object'
    ? initialState.entities
    : {};
  const groups = ['answers', 'articles', 'zvideo'];
  for (const group of groups) {
    const collection = entities[group];
    if (!collection || typeof collection !== 'object') continue;
    for (const entity of Object.values(collection)) {
      const contentHtml = getZhihuEntityContent(entity);
      if (!contentHtml || String(contentHtml).length < 40) continue;
      const author = entity.author && typeof entity.author === 'object'
        ? pickString(entity.author.name, entity.author.headline)
        : pickString(entity.author);
      return {
        title: pickString(entity.title, entity.question && entity.question.title),
        author,
        contentHtml: String(contentHtml),
        contentText: '',
        publishTime: pickString(entity.created, entity.updated, entity.created_time),
        source: 'js-initial-data',
      };
    }
  }
  return null;
}

function extractPlatformArticleFromHtml(html, platform) {
  if (platform === 'toutiao') return parseToutiaoRenderData(html);
  if (platform === 'zhihu') return parseZhihuInitialData(html);
  return null;
}

module.exports = {
  isZhihuUrl,
  isToutiaoUrl,
  isPlatformArticleUrl,
  getPlatformArticleKind,
  getPlatformArticleLabel,
  getPlatformArticleReferer,
  isAllowedPlatformArticleNavigation,
  normalizePlatformArticleUrl,
  parseToutiaoRenderData,
  parseZhihuInitialData,
  extractPlatformArticleFromHtml,
};
