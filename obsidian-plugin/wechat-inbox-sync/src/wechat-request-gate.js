'use strict';
const { classifyWechatArticleHtml } = require('./wechat-article-utils');
const WECHAT_REQUEST_GAP_MS = 1500;
const WECHAT_RISK_COOLDOWN_MS = 10 * 60 * 1000;
function isWechatAccessPaused(error) { return error && error.code === 'WECHAT_ACCESS_PAUSED'; }
function assertWechatTransportResponse(response) {
  let captchaRedirect = false;
  try { const target = new URL(response?.url || ''); captchaRedirect = target.hostname === 'mp.weixin.qq.com' && /^\/mp\/wappoc_appmsgcaptcha\b/.test(target.pathname); } catch (_) {}
  if (Number(response?.status) === 429 || captchaRedirect) {
    throw Object.assign(new Error(Number(response?.status) === 429 ? 'HTTP 429' : '微信要求完成访问验证'), {
      status: Number(response?.status) || 0,
      wechatArticleDiagnostic: { verificationMarker: captchaRedirect },
    });
  }
}
function createWechatArticleRequestGate({ now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), gapMs = WECHAT_REQUEST_GAP_MS, cooldownMs = WECHAT_RISK_COOLDOWN_MS } = {}) {
  let queue = Promise.resolve(); let nextAt = 0; let blockedUntil = 0; let reason = ''; let requestCount = 0;
  const paused = () => Object.assign(new Error('微信要求验证或限制访问，已暂停公众号抓取。请稍后在微信中确认可正常打开，再重试；请勿连续点击重试。'), { code: 'WECHAT_ACCESS_PAUSED', retryAfterMs: Math.max(0, blockedUntil - now()), reason });
  const markRisk = value => {
    const status = Number(value && (value.status || value.statusCode)) || (/\b(?:HTTP|status)\s*[:=]?\s*429\b/i.test(String(value?.message || '')) ? 429 : 0);
    const html = typeof value === 'string' ? value : String(value && (value.text || value.html || value.markdown) || '');
    const verification = value?.wechatArticleDiagnostic?.verificationMarker === true;
    const completedBrowserArticle = value?.bodyFound === true;
    let captchaRedirect = false;
    try { const target = new URL(value?.url || ''); captchaRedirect = target.hostname === 'mp.weixin.qq.com' && /^\/mp\/wappoc_appmsgcaptcha\b/.test(target.pathname); } catch (_) {}
    if (status === 429 || verification || captchaRedirect || (!completedBrowserArticle && html && classifyWechatArticleHtml(html) === 'captcha')) {
      reason = status === 429 ? 'wechat-rate-limited' : 'wechat-verification-required';
      blockedUntil = Math.max(blockedUntil, now() + cooldownMs);
      throw paused();
    }
  };
  return {
    snapshot: () => ({ minRequestGapMs: gapMs, remainingCooldownMs: Math.max(0, blockedUntil - now()), requestCount, reason }),
    run(operation, { signal } = {}) {
      const aborted = () => { if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' }); };
      let pendingTransport = Promise.resolve();
      const holdUntil = promise => { pendingTransport = Promise.resolve(promise).then(markRisk, markRisk).catch(() => {}); };
      const result = queue.then(async () => {
        aborted(); if (now() < blockedUntil) throw paused();
        const waitMs = Math.max(0, nextAt - now());
        if (waitMs) await sleep(waitMs);
        aborted(); if (now() < blockedUntil) throw paused();
        try { requestCount += 1; const result = await operation({ holdUntil }); markRisk(result); aborted(); return result; }
        catch (error) { if (!isWechatAccessPaused(error)) markRisk(error); throw error; }
        finally { nextAt = now() + gapMs; }
      });
      queue = result.catch(() => {}).then(async () => { await pendingTransport; nextAt = Math.max(nextAt, now() + gapMs); });
      if (!signal) return result;
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        signal.addEventListener('abort', onAbort, { once: true });
        result.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
        if (signal.aborted) onAbort();
      });
    },
  };
}
function buildWechatAccessPausedResult(error, attempts = []) {
  return { kind: 'retryable', state: 'access_paused', source: 'request-guard', diagnostic: { reason: 'wechat-access-paused', failureCategory: error.reason || 'wechat-verification-required', retryAfterMs: error.retryAfterMs || WECHAT_RISK_COOLDOWN_MS, attempts, retryable: true } };
}
module.exports = { assertWechatTransportResponse, createWechatArticleRequestGate, isWechatAccessPaused, buildWechatAccessPausedResult, WECHAT_REQUEST_GAP_MS, WECHAT_RISK_COOLDOWN_MS };
