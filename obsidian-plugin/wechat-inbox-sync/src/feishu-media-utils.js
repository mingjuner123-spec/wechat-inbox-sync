'use strict';

/**
 * Pure Feishu media helpers.  The network and Obsidian adapters stay in
 * main.js; this module owns identity, scope, and Markdown reference rules.
 */

const FEISHU_MEDIA_DOWNLOAD_SCOPE = 'docs:document.media:download';

function normalizeFeishuImageToken(value) {
  return String(value || '')
    .trim()
    .replace(/^feishu-image:/i, '')
    .trim();
}

function normalizeFeishuScope(scope) {
  if (Array.isArray(scope)) {
    return scope
      .flatMap((item) => String(item || '').split(/[\s,]+/))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return String(scope || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasFeishuMediaDownloadScope(scope) {
  return normalizeFeishuScope(scope).includes(FEISHU_MEDIA_DOWNLOAD_SCOPE);
}

function collectFeishuImageTokens({
  markdown = '',
  imageTokens = [],
  imageTmpDownloadUrls = {},
  blocks = [],
  imageTokenCount = 0,
} = {}) {
  const fromMarkdown = Array.from(String(markdown || '').matchAll(/feishu-image:([^\s)]+)/gi))
    .map((match) => normalizeFeishuImageToken(match[1]))
    .filter(Boolean);
  const explicit = Array.isArray(imageTokens)
    ? imageTokens.map(normalizeFeishuImageToken).filter(Boolean)
    : [];
  const tmpKeys = imageTmpDownloadUrls && typeof imageTmpDownloadUrls === 'object'
    ? Object.keys(imageTmpDownloadUrls).map(normalizeFeishuImageToken).filter(Boolean)
    : [];
  const blockTokens = [];
  const visitBlock = (value, imageContext = false) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => visitBlock(item, imageContext));
      return;
    }
    const isImageBlock = imageContext || Boolean(
      value.image || value.raw_image || value.image_block || value.type === 'image'
      || value.block_type === 27 || value.block_type === 'image',
    );
    if (isImageBlock) {
      ['token', 'file_token', 'fileToken', 'image_token', 'imageToken'].forEach((key) => {
        const token = normalizeFeishuImageToken(value[key]);
        if (token) blockTokens.push(token);
      });
    }
    Object.entries(value).forEach(([key, child]) => {
      if (key === 'image' || key === 'raw_image' || key === 'image_block') {
        visitBlock(child, true);
      } else if (child && typeof child === 'object') {
        visitBlock(child, isImageBlock && /(?:image|file|media)/i.test(key));
      }
    });
  };
  visitBlock(blocks);
  const tokens = Array.from(new Set([...explicit, ...fromMarkdown, ...tmpKeys, ...blockTokens]));
  const normalizedTmpDownloadUrls = {};
  if (imageTmpDownloadUrls && typeof imageTmpDownloadUrls === 'object') {
    Object.entries(imageTmpDownloadUrls).forEach(([key, value]) => {
      const token = normalizeFeishuImageToken(key);
      const url = String(value || '').trim();
      if (token && url && !Object.prototype.hasOwnProperty.call(normalizedTmpDownloadUrls, token)) {
        normalizedTmpDownloadUrls[token] = url;
      }
    });
  }
  const declaredCount = Number(imageTokenCount) || 0;
  return {
    tokens,
    declaredCount,
    unknownIdentityCount: Math.max(0, declaredCount - tokens.length),
    markdownTokenCount: fromMarkdown.length,
    blockTokenCount: blockTokens.length,
    imageTmpDownloadUrls: normalizedTmpDownloadUrls,
  };
}

function buildFeishuImageTokenAsset(token, localIndex, extra = {}) {
  const normalizedToken = normalizeFeishuImageToken(token);
  return {
    token: normalizedToken,
    src: `feishu-image:${normalizedToken}`,
    localIndex: Math.max(0, Number(localIndex) || 0),
    ...extra,
  };
}

function decodeBasicHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function normalizeMarkdownImageSource(value, decodeHtmlEntities = decodeBasicHtmlEntities) {
  const decoder = typeof decodeHtmlEntities === 'function'
    ? decodeHtmlEntities
    : decodeBasicHtmlEntities;
  return String(decoder(String(value || '').trim()) || '').trim();
}

function findFeishuTokenForSource(source) {
  const normalized = String(source || '').trim();
  const match = normalized.match(/^feishu-image:([^\s)]+)/i);
  return match ? normalizeFeishuImageToken(match[1]) : '';
}

function replaceFeishuImageTokenPlaceholders(
  markdown,
  assets = [],
  docUrl = '',
  tokenUrlMap = {},
  buildFallbackUrl = () => '',
  decodeHtmlEntities = (source) => source,
) {
  let result = String(markdown || '');
  if (!result.includes('feishu-image:')) return result;
  const tokenPattern = /!\[([^\]]*)\]\(feishu-image:([^\s)]+)\)/gi;
  return result.replace(tokenPattern, (full, alt, rawToken) => {
    const token = normalizeFeishuImageToken(rawToken);
    if (!token) return full;
    const mappedUrl = String(tokenUrlMap && tokenUrlMap[token] || '').trim();
    if (/^https?:\/\//i.test(mappedUrl)) {
      return `![${alt || '图片'}](${mappedUrl})`;
    }
    const tokenAsset = Array.isArray(assets)
      ? assets.find((asset) => normalizeFeishuImageToken(asset && asset.token) === token)
        || assets.find((asset) => findFeishuTokenForSource(asset && asset.src) === token)
        || assets.find((asset) => String(asset && asset.src || '').includes(token))
      : null;
    if (tokenAsset) {
      const localPath = String(tokenAsset.localPath || tokenAsset.imagePath || '').trim();
      if (localPath) return `![[${localPath}]]`;
      const source = normalizeMarkdownImageSource(tokenAsset.src, decodeHtmlEntities);
      if (/^https?:\/\//i.test(source)) {
        return `![${alt || '图片'}](${source})`;
      }
    }
    const fallback = typeof buildFallbackUrl === 'function'
      ? String(buildFallbackUrl(token, docUrl) || '').trim()
      : '';
    return /^https?:\/\//i.test(fallback)
      ? `![${alt || '图片'}](${fallback})`
      : full;
  });
}

function replaceFeishuImageAssetReference(
  markdown,
  asset,
  imagePath,
  decodeHtmlEntities = decodeBasicHtmlEntities,
  options = {},
) {
  const token = normalizeFeishuImageToken(asset && asset.token);
  const assetSource = normalizeMarkdownImageSource(asset && asset.src, decodeHtmlEntities);
  const targetPath = String(imagePath || '').trim();
  if (!targetPath) return { markdown: String(markdown || ''), replacementCount: 0 };
  let replacementCount = 0;
  const nextMarkdown = String(markdown || '').replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, alt, rawSource) => {
    const source = normalizeMarkdownImageSource(rawSource, decodeHtmlEntities);
    const sourceToken = findFeishuTokenForSource(source);
    const matched = Boolean(
      (token && sourceToken === token)
      || (assetSource && source === assetSource),
    );
    if (!matched) return full;
    replacementCount += 1;
    return `![[${targetPath}]]`;
  });
  if (replacementCount > 0) return { markdown: nextMarkdown, replacementCount };

  // Some Feishu responses expose image blocks/tokens but render the Markdown
  // image source as a temporary CDN URL that is different from the token
  // returned by /feishu/extract. When the caller has a canonical block order,
  // use that order as a narrow compatibility fallback instead of leaving a
  // successfully-written attachment unreferenced.
  const referenceIndex = Number(options && options.referenceIndex);
  if (Number.isInteger(referenceIndex) && referenceIndex >= 0) {
    let imageIndex = -1;
    let cursor = 0;
    const positionalMarkdown = nextMarkdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, alt, rawSource) => {
      const source = normalizeMarkdownImageSource(rawSource, decodeHtmlEntities);
      if (imageIndex < 0 && !/^\[\[/.test(source) && cursor === referenceIndex) imageIndex = cursor;
      cursor += 1;
      return full;
    });
    if (imageIndex >= 0) {
      let currentIndex = 0;
      const replaced = positionalMarkdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, alt, rawSource) => {
        const next = currentIndex === imageIndex ? `![[${targetPath}]]` : full;
        currentIndex += 1;
        return next;
      });
      if (replaced !== positionalMarkdown) return { markdown: replaced, replacementCount: 1 };
    }
  }

  if (options && options.appendWhenUnmatched) {
    const suffix = `![[${targetPath}]]`;
    const separator = String(nextMarkdown || '').trim() ? '\n\n' : '';
    return {
      markdown: `${nextMarkdown.trimEnd()}${separator}${suffix}`,
      replacementCount: 1,
      appended: true,
    };
  }
  return { markdown: nextMarkdown, replacementCount: 0 };
}

function buildFeishuMediaDiagnostic({
  scope = '',
  scopeKnown = null,
  tokenCount = 0,
  official = {},
  temporary = {},
  browser = {},
  markdownReferenceCount = 0,
  localizedCount = 0,
  unresolvedCount = 0,
  errors = [],
} = {}) {
  const normalizedScope = normalizeFeishuScope(scope);
  const mediaScopeKnown = scopeKnown === null ? normalizedScope.length > 0 : Boolean(scopeKnown);
  const mediaScopePresent = hasFeishuMediaDownloadScope(normalizedScope);
  return {
    mediaScopeKnown,
    mediaScopeStatus: !mediaScopeKnown ? 'unknown' : (mediaScopePresent ? 'present' : 'missing'),
    mediaScopePresent,
    requiredScope: FEISHU_MEDIA_DOWNLOAD_SCOPE,
    imageTokenCount: Math.max(0, Number(tokenCount) || 0),
    official: {
      attempted: Boolean(official.attempted),
      succeeded: Math.max(0, Number(official.succeeded) || 0),
      failed: Math.max(0, Number(official.failed) || 0),
    },
    temporary: {
      attempted: Boolean(temporary.attempted),
      succeeded: Math.max(0, Number(temporary.succeeded) || 0),
      failed: Math.max(0, Number(temporary.failed) || 0),
    },
    browser: {
      attempted: Boolean(browser.attempted),
      succeeded: Math.max(0, Number(browser.succeeded) || 0),
      failed: Math.max(0, Number(browser.failed) || 0),
    },
    markdownReferenceCount: Math.max(0, Number(markdownReferenceCount) || 0),
    localizedCount: Math.max(0, Number(localizedCount) || 0),
    unresolvedCount: Math.max(0, Number(unresolvedCount) || 0),
    errors: Array.from(new Set((Array.isArray(errors) ? errors : [errors])
      .map((error) => String(error || '').replace(/[\r\n]+/g, ' ').trim())
      .filter(Boolean))).slice(0, 8),
  };
}

module.exports = {
  FEISHU_MEDIA_DOWNLOAD_SCOPE,
  normalizeFeishuImageToken,
  normalizeFeishuScope,
  hasFeishuMediaDownloadScope,
  collectFeishuImageTokens,
  buildFeishuImageTokenAsset,
  replaceFeishuImageTokenPlaceholders,
  replaceFeishuImageAssetReference,
  buildFeishuMediaDiagnostic,
};
