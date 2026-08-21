'use strict';

const {
  buildWechatArticleFallbackMarkdown,
  diagnoseWechatArticleHtml,
  extractWechatArticleFallbackMetadata,
  normalizeWechatArticleUrl,
} = require('./wechat-article-utils');

const FAILURE_CACHE_TTL_MS = 10 * 60 * 1000;
const FAILURE_CACHE_MAX_ENTRIES = 128;
const failureCache = new Map();

function cacheKey(url) {
  return normalizeWechatArticleUrl(url) || String(url || '').trim();
}

function pruneFailureCache(now = Date.now()) {
  for (const [key, value] of failureCache) {
    if (!value || now - value.failedAt > FAILURE_CACHE_TTL_MS) failureCache.delete(key);
  }
  while (failureCache.size > FAILURE_CACHE_MAX_ENTRIES) {
    const first = failureCache.keys().next();
    if (first.done) break;
    failureCache.delete(first.value);
  }
}

function getFailureCacheInfo(url) {
  const key = cacheKey(url);
  if (!key) return null;
  pruneFailureCache();
  const entry = failureCache.get(key);
  if (!entry) return null;
  return {
    cacheHit: true,
    previousFailureAt: new Date(entry.failedAt).toISOString(),
    previousFailureAgeMs: Math.max(0, Date.now() - entry.failedAt),
    previousRetryCount: entry.retryCount,
    previousState: entry.state,
  };
}

function rememberFailure(url, state, diagnostic) {
  const key = cacheKey(url);
  if (!key) return;
  const now = Date.now();
  const previous = failureCache.get(key);
  failureCache.set(key, {
    failedAt: now,
    state: String(state || 'body_missing'),
    retryCount: (previous ? previous.retryCount : 0) + 1,
    diagnostic: diagnostic || null,
  });
  pruneFailureCache(now);
}

function clearFailure(url) {
  const key = cacheKey(url);
  if (key) failureCache.delete(key);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBrowserResult(value) {
  if (typeof value === 'string') return { html: value, title: '', assets: [] };
  const diagnostic = value && value.diagnostic && typeof value.diagnostic === 'object'
    ? value.diagnostic
    : {};
  return {
    html: String(value && value.html || ''),
    markdown: String(value && value.markdown || ''),
    title: String(value && value.title || ''),
    assets: Array.isArray(value && value.assets) ? value.assets : [],
    bodyFound: Boolean(value && value.bodyFound === true),
    bodyTextChars: Number(value && value.bodyTextChars) || 0,
    imageCount: Number(value && value.imageCount) || 0,
    imageCandidateCount: Number(value && value.imageCandidateCount) || 0,
    diagnostic,
  };
}

function buildFallbackResult({ url, state, html, title = '', diagnostic = null }) {
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
    ...(diagnostic ? { diagnostic } : {}),
  };
}

function buildRetryableBodyMissingResult({
  staticState,
  staticDiagnostic,
  browserState = '',
  browserError = null,
  attempts = [],
  previousFailure = null,
} = {}) {
  const diagnostic = {
    reason: 'wechat-article-body-missing',
    staticState: String(staticState || 'unknown'),
    staticDiagnosis: staticDiagnostic || null,
    browserState: String(browserState || ''),
    browserError: browserError ? String(browserError.message || browserError).slice(0, 300) : '',
    attempts,
    attemptedChannels: attempts.map((attempt) => attempt.channel).filter(Boolean),
    retryable: true,
    previousFailure: previousFailure || null,
    completeness: {
      articleBodyFound: false,
      imageCandidates: attempts.reduce((sum, attempt) => sum + (Number(attempt.imageCandidateCount) || 0), 0),
      successfulChannels: attempts.filter((attempt) => attempt.outcome === 'article').length,
      failedChannels: attempts.filter((attempt) => attempt.outcome === 'error').length,
    },
  };
  return {
    kind: 'retryable',
    state: 'body_missing',
    source: browserState || browserError ? 'browser' : 'static',
    diagnostic,
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

  const previousFailure = getFailureCacheInfo(normalizedUrl);
  const staticHtml = String(await fetchStatic(normalizedUrl) || '');
  const staticDiagnostic = diagnoseWechatArticleHtml(staticHtml);
  const staticState = staticDiagnostic.pageKind;
  const attempts = [{
    channel: 'static',
    outcome: staticState,
    state: staticState,
    htmlChars: staticHtml.length,
    bodyTextChars: staticDiagnostic.bodyTextChars,
    imageCandidateCount: staticDiagnostic.imageCandidateCount,
    hasJsContent: staticDiagnostic.hasJsContent,
  }];

  if (staticState === 'article') {
    clearFailure(normalizedUrl);
    return {
      kind: 'article',
      state: 'complete',
      source: 'static',
      html: staticHtml,
      title: '',
      assets: [],
      diagnostic: {
        static: staticDiagnostic,
        attempts,
        completeness: {
          articleBodyFound: true,
          imageCandidates: staticDiagnostic.imageCandidateCount,
          successfulChannels: 1,
          failedChannels: 0,
        },
      },
    };
  }
  if (staticState === 'captcha' || staticState === 'unavailable') {
    return buildFallbackResult({
      url: normalizedUrl,
      state: staticState,
      html: staticHtml,
      diagnostic: { static: staticDiagnostic, attempts },
    });
  }

  if (typeof renderBrowser === 'function' && ['guide', 'unknown', 'empty-shell'].includes(staticState)) {
    let lastBrowserState = '';
    let lastBrowserError = null;
    for (let browserAttempt = 1; browserAttempt <= 2; browserAttempt += 1) {
      try {
        const browser = normalizeBrowserResult(await renderBrowser(normalizedUrl));
        const browserHtml = browser.html || browser.markdown;
        const browserDiagnostic = diagnoseWechatArticleHtml(browserHtml);
        if (browser.bodyFound && browserDiagnostic.pageKind === 'unknown') {
          browserDiagnostic.pageKind = 'article';
          browserDiagnostic.classifiedState = 'article';
        }
        const browserImageCandidateCount = browser.imageCandidateCount || browserDiagnostic.imageCandidateCount;
        const browserImageCount = browser.imageCount || browserDiagnostic.imageCount;
        const browserBodyTextChars = browser.bodyTextChars || browserDiagnostic.bodyTextChars;
        browserDiagnostic.imageCandidateCount = browserImageCandidateCount;
        browserDiagnostic.imageCount = browserImageCount;
        browserDiagnostic.bodyTextChars = browserBodyTextChars;
        lastBrowserState = browserDiagnostic.pageKind;
        attempts.push({
          channel: 'browser',
          attempt: browserAttempt,
          outcome: browserDiagnostic.pageKind,
          state: browserDiagnostic.pageKind,
          htmlChars: browser.html.length,
          markdownChars: browser.markdown.length,
          bodyTextChars: browserBodyTextChars,
          imageCount: browserImageCount,
          imageCandidateCount: browserImageCandidateCount,
          assetCount: browser.assets.length,
          hasJsContent: browserDiagnostic.hasJsContent,
        });
        const hasBrowserArticle = typeof isUsableBrowserArticle === 'function'
          ? Boolean(isUsableBrowserArticle(browser))
          : browserDiagnostic.pageKind === 'article';
        if (hasBrowserArticle) {
          clearFailure(normalizedUrl);
          return {
            kind: 'article',
            state: 'complete',
            source: 'browser',
            html: browser.html,
            title: browser.title,
            assets: browser.assets,
            ...(browser.markdown ? { markdown: browser.markdown } : {}),
            diagnostic: {
              static: staticDiagnostic,
              browser: browserDiagnostic,
              attempts,
              completeness: {
                articleBodyFound: true,
                imageCandidates: browserImageCandidateCount,
                successfulChannels: 1,
                failedChannels: attempts.filter((entry) => entry.outcome === 'error').length,
              },
            },
          };
        }
        if (browserDiagnostic.pageKind === 'captcha' || browserDiagnostic.pageKind === 'unavailable') {
          return buildFallbackResult({
            url: normalizedUrl,
            state: browserDiagnostic.pageKind,
            html: browser.html || browser.markdown,
            title: browser.title,
            diagnostic: { static: staticDiagnostic, browser: browserDiagnostic, attempts },
          });
        }
      } catch (browserError) {
        lastBrowserError = browserError;
        attempts.push({
          channel: 'browser',
          attempt: browserAttempt,
          outcome: 'error',
          error: String(browserError && (browserError.message || browserError) || '').slice(0, 300),
        });
      }
      if (browserAttempt < 2) await wait(250);
    }
    const retryable = buildRetryableBodyMissingResult({
      staticState,
      staticDiagnostic,
      browserState: lastBrowserState,
      browserError: lastBrowserError,
      attempts,
      previousFailure,
    });
    rememberFailure(normalizedUrl, retryable.state, retryable.diagnostic);
    return retryable;
  }

  const retryable = buildRetryableBodyMissingResult({
    staticState,
    staticDiagnostic,
    attempts,
    previousFailure,
  });
  rememberFailure(normalizedUrl, retryable.state, retryable.diagnostic);
  return retryable;
}

module.exports = {
  FAILURE_CACHE_MAX_ENTRIES,
  FAILURE_CACHE_TTL_MS,
  buildRetryableBodyMissingResult,
  getFailureCacheInfo,
  normalizeBrowserResult,
  runWechatArticlePipeline,
};
