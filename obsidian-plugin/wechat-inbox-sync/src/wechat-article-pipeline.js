'use strict';

const {
  buildWechatArticleFallbackMarkdown,
  buildWechatArticleRequestProfiles,
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

function normalizeBrowserResult(value) {
  if (typeof value === 'string') return { html: value, markdown: '', title: '', assets: [], diagnostic: {} };
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

function normalizeStaticResult(value) {
  if (typeof value === 'string') return { html: value, diagnostic: {} };
  return {
    html: String(value && value.html || ''),
    diagnostic: value && value.diagnostic && typeof value.diagnostic === 'object'
      ? value.diagnostic
      : {},
  };
}

function getSafeProfileDiagnostic(profile = {}) {
  const shape = profile.urlShape && typeof profile.urlShape === 'object' ? profile.urlShape : {};
  return {
    profile: String(profile.id || ''),
    inputKind: String(profile.inputKind || ''),
    userAgentProfile: String(profile.userAgentProfile || ''),
    pathKind: String(shape.pathKind || ''),
    parameterNames: Array.isArray(shape.parameterNames) ? shape.parameterNames.slice(0, 30) : [],
    retainedParameterNames: Array.isArray(shape.retainedParameterNames) ? shape.retainedParameterNames.slice(0, 30) : [],
    strippedParameterNames: Array.isArray(shape.strippedParameterNames) ? shape.strippedParameterNames.slice(0, 30) : [],
    hasFragment: Boolean(shape.hasFragment),
    normalizedChanged: Boolean(profile.normalizedChanged),
  };
}

function getResponseSignature(diagnostic = {}) {
  const markers = diagnostic.markers && typeof diagnostic.markers === 'object' ? diagnostic.markers : {};
  return [
    String(diagnostic.pageKind || 'unknown'),
    Number(diagnostic.htmlChars) || 0,
    diagnostic.hasJsContent ? 1 : 0,
    Number(diagnostic.bodyTextChars) || 0,
    Number(diagnostic.imageCandidateCount) || 0,
    markers.captcha ? 1 : 0,
    markers.unavailable ? 1 : 0,
    markers.emptyShell ? 1 : 0,
  ].join(':');
}

function inferWechatArticleFailureCategory(attempts = []) {
  const browserAttempts = attempts.filter((attempt) => attempt.channel === 'browser');
  if (browserAttempts.some((attempt) => attempt.failureCategory === 'extractor-selector-mismatch')) {
    return 'extractor-selector-mismatch';
  }

  const browserResponses = browserAttempts.filter((attempt) => attempt.outcome !== 'error');
  const staticResponses = attempts.filter((attempt) => attempt.channel === 'static' && attempt.outcome !== 'error');
  const decisiveResponses = browserResponses.length ? browserResponses : staticResponses;
  const decisiveOutcomes = decisiveResponses.map((attempt) => attempt.outcome);
  if (decisiveResponses.length >= 2 && new Set(decisiveOutcomes).size === 1) {
    if (decisiveOutcomes[0] === 'captcha') return 'wechat-verification-required';
    if (decisiveOutcomes[0] === 'unavailable') return 'article-unavailable';
  }

  if (browserAttempts.length && browserAttempts.every((attempt) => attempt.outcome === 'error')) {
    return 'browser-transport-failed';
  }
  if (new Set(decisiveOutcomes).size > 1) return 'request-profile-sensitive-response';

  const staticSignatureAttempts = attempts.filter((attempt) => attempt.channel === 'static'
    && attempt.responseSignature
    && ['guide', 'unknown', 'empty-shell'].includes(attempt.outcome));
  const staticSignatures = staticSignatureAttempts.map((attempt) => attempt.responseSignature);
  if (staticSignatures.length >= 2 && new Set(staticSignatures).size === 1) {
    return 'identical-empty-shell-across-request-profiles';
  }
  return 'wechat-empty-shell';
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
  const failureCategory = inferWechatArticleFailureCategory(attempts);
  const diagnostic = {
    reason: 'wechat-article-body-missing',
    failureCategory,
    staticState: String(staticState || 'unknown'),
    staticDiagnosis: staticDiagnostic || null,
    browserState: String(browserState || ''),
    browserError: browserError ? String(browserError.message || browserError).slice(0, 300) : '',
    attempts,
    attemptedChannels: attempts.map((attempt) => attempt.channel).filter(Boolean),
    attemptedProfiles: Array.from(new Set(attempts.map((attempt) => attempt.profile).filter(Boolean))),
    retryable: failureCategory !== 'article-unavailable',
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
  const requestProfiles = buildWechatArticleRequestProfiles(url);
  if (!normalizedUrl || !requestProfiles.length) return buildFallbackResult({ url: '', state: 'unknown', html: '' });

  const previousFailure = getFailureCacheInfo(normalizedUrl);
  const attempts = [];
  let lastStaticState = '';
  let lastStaticDiagnostic = null;
  let terminalState = '';
  let terminalHtml = '';

  for (const profile of requestProfiles) {
    const safeProfile = getSafeProfileDiagnostic(profile);
    try {
      const staticResult = normalizeStaticResult(await fetchStatic(profile.url, profile));
      const staticDiagnostic = diagnoseWechatArticleHtml(staticResult.html);
      const staticState = staticDiagnostic.pageKind;
      lastStaticState = staticState;
      lastStaticDiagnostic = staticDiagnostic;
      attempts.push({
        channel: 'static',
        ...safeProfile,
        outcome: staticState,
        state: staticState,
        htmlChars: staticResult.html.length,
        bodyTextChars: staticDiagnostic.bodyTextChars,
        imageCandidateCount: staticDiagnostic.imageCandidateCount,
        hasJsContent: staticDiagnostic.hasJsContent,
        responseSignature: getResponseSignature(staticDiagnostic),
        ...(Object.keys(staticResult.diagnostic).length ? { transportDiagnostic: staticResult.diagnostic } : {}),
      });
      if (staticState === 'article') {
        clearFailure(normalizedUrl);
        return {
          kind: 'article',
          state: 'complete',
          source: 'static',
          html: staticResult.html,
          title: '',
          assets: [],
          diagnostic: {
            static: staticDiagnostic,
            selectedProfile: safeProfile,
            attempts,
            completeness: {
              articleBodyFound: true,
              imageCandidates: staticDiagnostic.imageCandidateCount,
              successfulChannels: 1,
              failedChannels: attempts.filter((entry) => entry.outcome === 'error').length,
            },
          },
        };
      }
      if (staticState === 'captcha' || staticState === 'unavailable') {
        terminalState = terminalState || staticState;
        terminalHtml = terminalHtml || staticResult.html;
      }
    } catch (staticError) {
      attempts.push({
        channel: 'static',
        ...safeProfile,
        outcome: 'error',
        error: String(staticError && (staticError.message || staticError) || '').slice(0, 300),
      });
    }
  }

  let lastBrowserState = '';
  let lastBrowserError = null;
  if (typeof renderBrowser === 'function') {
    for (const profile of requestProfiles) {
      const safeProfile = getSafeProfileDiagnostic(profile);
      try {
        const browser = normalizeBrowserResult(await renderBrowser(profile.url, profile));
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
        const visibleTextChars = Number(browser.diagnostic && browser.diagnostic.visibleTextChars) || 0;
        const failureCategory = !browserDiagnostic.hasJsContent && visibleTextChars >= 200
          ? 'extractor-selector-mismatch'
          : browserDiagnostic.pageKind === 'captcha'
            ? 'wechat-verification-required'
            : '';
        attempts.push({
          channel: 'browser',
          ...safeProfile,
          outcome: browserDiagnostic.pageKind,
          state: browserDiagnostic.pageKind,
          htmlChars: browser.html.length,
          markdownChars: browser.markdown.length,
          bodyTextChars: browserBodyTextChars,
          visibleTextChars,
          imageCount: browserImageCount,
          imageCandidateCount: browserImageCandidateCount,
          assetCount: browser.assets.length,
          hasJsContent: browserDiagnostic.hasJsContent,
          responseSignature: getResponseSignature(browserDiagnostic),
          ...(failureCategory ? { failureCategory } : {}),
          ...(Object.keys(browser.diagnostic).length ? { renderDiagnostic: browser.diagnostic } : {}),
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
              static: lastStaticDiagnostic,
              browser: browserDiagnostic,
              selectedProfile: safeProfile,
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
          terminalState = terminalState || browserDiagnostic.pageKind;
          terminalHtml = terminalHtml || browser.html || browser.markdown;
        }
      } catch (browserError) {
        lastBrowserError = browserError;
        const renderDiagnostic = browserError && browserError.wechatArticleDiagnostic
          && typeof browserError.wechatArticleDiagnostic === 'object'
          ? browserError.wechatArticleDiagnostic
          : {};
        attempts.push({
          channel: 'browser',
          ...safeProfile,
          outcome: 'error',
          error: String(browserError && (browserError.message || browserError) || '').slice(0, 300),
          ...(Object.keys(renderDiagnostic).length ? { renderDiagnostic } : {}),
          ...(!renderDiagnostic.hasJsContent && Number(renderDiagnostic.visibleTextChars) >= 200
            ? { failureCategory: 'extractor-selector-mismatch' }
            : {}),
        });
      }
    }
  }

  const browserResponses = attempts.filter((attempt) => attempt.channel === 'browser' && attempt.outcome !== 'error');
  const staticResponses = attempts.filter((attempt) => attempt.channel === 'static' && attempt.outcome !== 'error');
  const decisiveTerminalAttempts = browserResponses.length ? browserResponses : staticResponses;
  const terminalOutcomes = decisiveTerminalAttempts.map((attempt) => attempt.outcome);
  const hasConclusiveTerminalOutcome = decisiveTerminalAttempts.length >= requestProfiles.length
    && terminalOutcomes.every((outcome) => outcome === 'captcha' || outcome === 'unavailable')
    && new Set(terminalOutcomes).size === 1;
  if (hasConclusiveTerminalOutcome) {
    const finalTerminalState = terminalOutcomes[0] || terminalState;
    return buildFallbackResult({
      url: normalizedUrl,
      state: finalTerminalState,
      html: terminalHtml,
      diagnostic: {
        attempts,
        failureCategory: finalTerminalState === 'captcha'
          ? 'wechat-verification-required'
          : 'article-unavailable',
      },
    });
  }

  const retryable = buildRetryableBodyMissingResult({
    staticState: lastStaticState,
    staticDiagnostic: lastStaticDiagnostic,
    browserState: lastBrowserState,
    browserError: lastBrowserError,
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
  inferWechatArticleFailureCategory,
  normalizeBrowserResult,
  runWechatArticlePipeline,
};
