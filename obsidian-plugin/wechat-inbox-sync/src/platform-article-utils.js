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

function getPlatformArticleIdentity(url) {
  let parsed;
  try { parsed = new URL(url); } catch (_) { return null; }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
  const path = parsed.pathname;
  const kind = /(^|\.)zhihu\.com$/.test(parsed.hostname) ? 'zhihu'
    : /(^|\.)toutiao\.com$/.test(parsed.hostname) ? 'toutiao' : '';
  if (!kind) return null;
  const match = kind === 'zhihu' ? path.match(/\/(answer|p)\/(\d+)\/?$/)
    : path.match(/\/(?:article|group|item)\/(\d+)\/?$|\/[ai](\d+)\/?$/);
  if (!match) return null;
  return kind === 'zhihu' ? { platform: kind, type: match[1], id: match[2] }
    : { platform: kind, type: 'article', id: match[1] || match[2] };
}

// Judge the body, not its title, source URL, or site navigation.
function hasPlatformArticleBody(markdown) {
  if (/^\s*>?\s*(?:知乎|今日头条)(?:正文未能自动提取|页面需要登录后才能读取正文|返回访问验证或登录提示)/m.test(String(markdown || ''))
    || /^\s*>?\s*(?:原始链接已写入笔记属性，可稍后重新同步|已保留原始链接等待重试，本次未完成正文同步)/m.test(String(markdown || ''))) return false;
  const body = String(markdown || '')
    .replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^\s*#{1,6}\s+.*$/gm, '')
    .replace(/^\s*(?:原始链接|来源链接|来源|作者|发布时间|source\s*url)\s*[：:].*$/gim, '')
    .replace(/!?\[[^\]]*\]\([^)]+\)|!?\[\[[^\]]+\]\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]*>/g, '').trim();
  if (/^(?:首页|热点|登录|注册|关于我们|下载APP|关注|推荐|举报|分享|收藏|赞同|评论|\s|[|·])+$/i.test(body)) return false;
  if (body.length < 160 && /请先登录|登录后(?:查看|阅读)|安全验证|访问异常|请求存在异常|打开.{0,12}(?:APP|客户端)|正文提取失败|内容解析失败/.test(body)) return false;
  return body.replace(/[\s\p{P}\p{S}]/gu, '').length >= 20;
}

function findArticleLikeObject(root, target = null) {
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
    const ids = [node.group_id, node.groupId, node.item_id, node.itemId, node.article_id, node.articleId, node.id]
      .filter(value => typeof value === 'string' || Number.isSafeInteger(value)).map(String);
    const matchesTarget = !target || ids.includes(target.id);
    if (matchesTarget && content && content.length >= 40 && (title || node.articleInfo)) {
      const score = content.length + (title ? 1000 : 0);
      if (!best || score > best.score) best = { node, content, title, score };
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return best;
}

function parseToutiaoRenderData(html, targetUrl = '') {
  const source = String(html || '');
  const match = source.match(/<script[^>]*\bid=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/i)
    || source.match(/<script[^>]*\bid=["']render_data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const data = decodeRenderDataScript(match[1]);
  if (!data) return null;
  const target = targetUrl ? getPlatformArticleIdentity(targetUrl) : null;
  if (targetUrl && !target) return null;
  const found = findArticleLikeObject(data, target);
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

function parseZhihuInitialData(html, targetUrl = '') {
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
  const target = targetUrl ? getPlatformArticleIdentity(targetUrl) : null;
  if (targetUrl && !target) return null;
  const groups = target ? [target.type === 'answer' ? 'answers' : 'articles'] : ['answers', 'articles', 'zvideo'];
  for (const group of groups) {
    const collection = entities[group];
    if (!collection || typeof collection !== 'object') continue;
    for (const [key, entity] of Object.entries(collection)) {
      if (target && key !== target.id && String(entity.id || '') !== target.id) continue;
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

function extractPlatformArticleFromHtml(html, platform, targetUrl = '') {
  if (platform === 'toutiao') return parseToutiaoRenderData(html, targetUrl);
  if (platform === 'zhihu') return parseZhihuInitialData(html, targetUrl);
  return null;
}

// Self contained: also executed in the sandboxed extraction window.
function selectPlatformArticleBody(doc, platform, target) {
  const pick = (root, selectors) => selectors.map(selector => root.querySelector(selector)).find(Boolean);
  // Share URLs without a stable numeric identity can still use a narrowly
  // scoped article-body fallback. Never scan page-wide text or recommendation
  // cards; only use the platform's dedicated body container.
  if (!target) {
    let canonical = '';
    try {
      canonical = Array.from(doc.querySelectorAll('link[rel="canonical"],meta[property="og:url"]'))
        .map(node => node.getAttribute('href') || node.getAttribute('content') || '')
        .find(value => value) || '';
      const parsed = new URL(canonical);
      const hostname = String(parsed.hostname || '').toLowerCase().replace(/\.$/, '');
      const onPlatform = platform === 'zhihu'
        ? hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com')
        : platform === 'toutiao' && (hostname === 'toutiao.com' || hostname.endsWith('.toutiao.com'));
      const canonicalArticlePath = platform === 'zhihu'
        ? /\/(?:answer|p)\/\d+\/?$|\/question\/\d+\/?$/i.test(parsed.pathname)
        : platform === 'toutiao' && /\/(?:article|group|item)\/\d+\/?$|\/[ai]\d{6,}\/?$/i.test(parsed.pathname);
      if (!onPlatform || !canonicalArticlePath) return null;
    } catch (_) {
      return null;
    }
    return (platform === 'zhihu' ? pick(doc, ['.QuestionRichText', '.Post-RichText'])
      : platform === 'toutiao' ? pick(doc, ['.article-content', '.syl-article-base']) : null) || null;
  }
  if (platform === 'zhihu' && target.type === 'answer') {
    for (const answer of doc.querySelectorAll('.AnswerItem')) {
      const raw = answer.getAttribute('data-zop') || '';
      let itemId = '';
      try { itemId = String(JSON.parse(raw).itemId || ''); } catch (_) {}
      const urls = Array.from(answer.querySelectorAll('meta[itemprop="url"],a[itemprop="url"]'))
        .map(node => node.getAttribute('content') || node.getAttribute('href') || '');
      if (itemId === target.id || urls.some(url => new RegExp('/answer/' + target.id + '(?:[/?#]|$)').test(url))) {
        return pick(answer, ['.RichContent-inner .RichText', '.RichText']);
      }
    }
    return null;
  }
  return platform === 'zhihu' ? pick(doc, ['.Post-RichText'])
    : pick(doc, ['.article-content', '.syl-article-base']);
}

function hasMatchingPlatformArticleDocumentIdentity(doc, url) {
  const target = getPlatformArticleIdentity(url);
  const platform = getPlatformArticleKind(url);
  if (!platform) return false;
  const values = Array.from(doc.querySelectorAll('link[rel="canonical"],meta[property="og:url"]'))
    .map(node => node.getAttribute('href') || node.getAttribute('content'));
  const identities = values.map(getPlatformArticleIdentity).filter(Boolean);
  if (!target) {
    // For share URLs without an identity, require an explicit canonical URL
    // resolving to an article on the same platform. The DOM fallback path uses
    // the same restricted article-body containers.
    const canonicalArticles = values.map(value => {
      try {
        const parsed = new URL(value);
        const hostname = cleanHost(parsed.hostname);
        const hostMatches = platform === 'zhihu'
          ? ZHIHU_ROOTS.some(root => hostname === root || hostname.endsWith(`.${root}`))
          : TOUTIAO_ROOTS.some(root => hostname === root || hostname.endsWith(`.${root}`));
        const pathMatches = platform === 'zhihu'
          ? /\/(?:answer|p)\/\d+\/?$|\/question\/\d+\/?$/i.test(parsed.pathname)
          : /\/(?:article|group|item)\/\d+\/?$|\/[ai]\d{6,}\/?$/i.test(parsed.pathname);
        return hostMatches && pathMatches;
      } catch (_) {
        return false;
      }
    });
    return canonicalArticles.length > 0 && canonicalArticles.every(Boolean);
  }
  return identities.length > 0 && identities.every(value => value.platform === target.platform && value.type === target.type && value.id === target.id);
}

function sanitizePlatformArticleDiagnostic(value) {
  if (!value || !['platform-article', 'webpage-extraction'].includes(value.source)) return null;
  const result = { source: value.source };
  for (const key of ['platform', 'stage', 'conversionStatus', 'transcriptionStatus', 'finalKind', 'finalState']) {
    if (value[key]) result[key] = String(value[key]).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  }
  for (const key of ['httpStatus', 'markdownChars']) {
    if (!Number.isSafeInteger(value[key])) continue;
    if (key === 'httpStatus' && (value[key] < 100 || value[key] > 599)) continue;
    if (key === 'markdownChars' && value[key] < 0) continue;
    result[key] = value[key];
  }
  if (value.source === 'webpage-extraction') {
    if (['none', 'syndication', 'fxembed', 'both'].includes(value.xArticleProvider)) result.xArticleProvider = value.xArticleProvider;
    const safeCodes = new Set([
      'X_RATE_LIMITED', 'X_FETCH_FAILED', 'X_IDENTITY_UNCONFIRMED', 'X_LONG_POST_UNSUPPORTED',
      'X_CONTENT_EMPTY', 'X_IMAGE_INCOMPLETE', 'X_REQUEST_TIMEOUT', 'X_POST_URL_REQUIRED',
      'X_FXEMBED_UNAVAILABLE', 'X_FXEMBED_IDENTITY_MISMATCH', 'X_FXEMBED_CONTENT_EMPTY',
      'X_FXEMBED_INVALID_PAYLOAD', 'X_FXEMBED_IMAGE_INVALID', 'X_FXEMBED_TIMEOUT',
      'X_FXEMBED_RATE_LIMITED', 'X_FXEMBED_HTTP_ERROR', 'X_FXEMBED_FETCH_FAILED',
    ]);
    for (const key of ['xArticleErrorCode', 'xSyndicationErrorCode']) {
      if (safeCodes.has(String(value[key] || ''))) result[key] = String(value[key]);
    }
  }
  if (value.http) {
    const status = Number(value.http.status);
    const previousStatus = Number(value.http.previousStatus);
    result.http = {
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
      ...(Number.isInteger(previousStatus) && previousStatus >= 100 && previousStatus <= 599 ? { previousStatus } : {}),
      transport: String(value.http.transport || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
    };
    if (!Object.keys(result.http).length) delete result.http;
  }
  if (value.hiddenBrowser) {
    result.hiddenBrowser = {};
    for (const key of ['ok', 'needsLogin', 'blocked', 'appWall', 'identityMatched']) result.hiddenBrowser[key] = value.hiddenBrowser[key] === true;
    result.hiddenBrowser.bodyTextChars = Number(value.hiddenBrowser.bodyTextChars) || 0;
  }
  return result;
}

module.exports = {
  getPlatformArticleIdentity,
  hasPlatformArticleBody,
  selectPlatformArticleBody,
  hasMatchingPlatformArticleDocumentIdentity,
  sanitizePlatformArticleDiagnostic,
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
