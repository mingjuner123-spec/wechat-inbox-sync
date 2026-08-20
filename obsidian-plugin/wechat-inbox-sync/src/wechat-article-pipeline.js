'use strict';

const {
  buildWechatArticleFallbackMarkdown,
  classifyWechatArticleHtml,
  extractWechatArticleFallbackMetadata,
  normalizeWechatArticleUrl,
} = require('./wechat-article-utils');

function normalizeBrowserResult(value) {
  if (typeof value === 'string') return { html: value, title: '', assets: [] };
  return {
    html: String(value && value.html || ''),
    markdown: String(value && value.markdown || ''),
    title: String(value && value.title || ''),
    assets: Array.isArray(value && value.assets) ? value.assets : [],
    bodyFound: Boolean(value && value.bodyFound === true),
  };
}

function buildFallbackResult({ url, state, html, title = '' }) {
  const metadata = extractWechatArticleFallbackMetadata(html);
  const resolvedTitle = title || metadata.title || '';
  return {
    kind: 'fallback',
    state,
    source: 'fallback',
    title: resolvedTitle,
    markdown: buildWechatArticleFallbackMarkdown({
      url,
      state,
      title: resolvedTitle,
      description: metadata.description,
      coverUrl: metadata.coverUrl,
    }),
    coverUrl: metadata.coverUrl,
  };
}

function buildRetryableBodyMissingResult({ staticState, browserState = '', browserError = null }) {
  return {
    kind: 'retryable',
    state: 'body_missing',
    source: browserState || browserError ? 'browser' : 'static',
    diagnostic: {
      reason: 'wechat-article-body-missing',
      staticState: String(staticState || 'unknown'),
      browserState: String(browserState || ''),
      browserError: browserError ? String(browserError.message || browserError) : '',
    },
  };
}

async function runWechatArticlePipeline({
  url = '',
  fetchStatic,
  renderBrowser,
  isUsableBrowserArticle,
} = {}) {
  if (typeof fetchStatic !== 'function') throw new Error('fetchStatic is required');
  const normalizedUrl = normalizeWechatArticleUrl(url);
  if (!normalizedUrl) return buildFallbackResult({ url: '', state: 'unknown', html: '' });
  const staticHtml = String(await fetchStatic(normalizedUrl) || '');
  const staticState = classifyWechatArticleHtml(staticHtml);
  if (staticState === 'article') {
    return {
      kind: 'article',
      state: 'complete',
      source: 'static',
      html: staticHtml,
      title: '',
      assets: [],
    };
  }
  if (staticState === 'captcha' || staticState === 'unavailable') {
    return buildFallbackResult({ url: normalizedUrl, state: staticState, html: staticHtml });
  }
  if (typeof renderBrowser === 'function' && (staticState === 'guide' || staticState === 'unknown')) {
    try {
      const browser = normalizeBrowserResult(await renderBrowser(normalizedUrl));
      const hasBrowserArticle = typeof isUsableBrowserArticle === 'function'
        ? Boolean(isUsableBrowserArticle(browser))
        : classifyWechatArticleHtml(browser.html) === 'article';
      if (hasBrowserArticle) {
        const article = {
          kind: 'article',
          state: 'complete',
          source: 'browser',
          html: browser.html,
          title: browser.title,
          assets: browser.assets,
        };
        if (browser.markdown) article.markdown = browser.markdown;
        return article;
      }
      const browserState = classifyWechatArticleHtml(browser.html || browser.markdown);
      if (browserState === 'captcha' || browserState === 'unavailable') {
        return buildFallbackResult({ url: normalizedUrl, state: browserState, html: browser.html || browser.markdown });
      }
      return buildRetryableBodyMissingResult({ staticState, browserState });
    } catch (browserError) {
      return buildRetryableBodyMissingResult({ staticState, browserError });
    }
  }
  return buildRetryableBodyMissingResult({ staticState });
}

module.exports = { runWechatArticlePipeline };
