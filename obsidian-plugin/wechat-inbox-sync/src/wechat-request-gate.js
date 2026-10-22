'use strict';
const { classifyWechatArticleHtml } = require('./wechat-article-utils');
const { randomBytes } = require('crypto');
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
  let incident = null;
  const paused = (pauseOrigin = 'cooldown') => Object.assign(new Error('公众号访问暂时暂停'), {
    code: 'WECHAT_ACCESS_PAUSED', retryAfterMs: Math.max(0, blockedUntil - now()), reason,
    accessPause: { ...incident, pauseOrigin, requestStarted: pauseOrigin === 'trigger', retryAfterMs: Math.max(0, blockedUntil - now()) },
  });
  const markRisk = (value, context = {}) => {
    const status = Number(value && (value.status || value.statusCode)) || (/\b(?:HTTP|status)\s*[:=]?\s*429\b/i.test(String(value?.message || '')) ? 429 : 0);
    const html = typeof value === 'string' ? value : String(value && (value.text || value.html || value.markdown) || '');
    const verification = value?.wechatArticleDiagnostic?.verificationMarker === true;
    const completedBrowserArticle = value?.bodyFound === true;
    let captchaRedirect = false;
    try { const target = new URL(value?.url || ''); captchaRedirect = target.hostname === 'mp.weixin.qq.com' && /^\/mp\/wappoc_appmsgcaptcha\b/.test(target.pathname); } catch (_) {}
    if (status === 429 || verification || captchaRedirect || (!completedBrowserArticle && html && classifyWechatArticleHtml(html) === 'captcha')) {
      const riskReason = status === 429 ? 'wechat-rate-limited' : 'wechat-verification-required';
      const riskIncident = { incidentId: randomBytes(12).toString('hex'), triggeredAt: now(),
        scope: status === 429 ? 'global' : 'article',
        triggerKind: status === 429 ? 'http-429' : captchaRedirect ? 'captcha-redirect' : verification ? 'verification-marker' : 'captcha-page',
        triggerStage: context.stage || 'unknown',
        sourceFingerprint: /^[a-f0-9]{12,64}$/.test(context.sourceFingerprint || '') ? context.sourceFingerprint : '',
        ...(status >= 100 && status <= 599 ? { httpStatus: status } : {}),
      };
      // Verification belongs to this article/transport. Only an explicit rate
      // limit closes the shared gate; a static challenge may use browser fallback.
      if (status === 429) {
        reason = riskReason;
        blockedUntil = Math.max(blockedUntil, now() + cooldownMs);
        incident = riskIncident;
      }
      throw Object.assign(new Error('公众号访问受限'), {
        code: 'WECHAT_ACCESS_PAUSED', reason: riskReason,
        retryAfterMs: status === 429 ? Math.max(0, blockedUntil - now()) : 0,
        accessPause: { ...riskIncident, pauseOrigin: 'trigger', requestStarted: true,
          retryAfterMs: status === 429 ? Math.max(0, blockedUntil - now()) : 0 },
        ...(value?.wechatArticleDiagnostic ? { wechatArticleDiagnostic: value.wechatArticleDiagnostic } : {}),
      });
    }
  };
  return {
    snapshot: () => ({ minRequestGapMs: gapMs, remainingCooldownMs: Math.max(0, blockedUntil - now()), requestCount, reason, ...(incident || {}) }),
    confirmRecovery(incidentId) {
      if (reason === 'wechat-rate-limited') return false;
      if (!incidentId || incident?.incidentId !== incidentId) return false;
      blockedUntil = 0; reason = ''; incident = null; return true;
    },
    run(operation, { signal, context = {} } = {}) {
      const aborted = () => { if (signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' }); };
      let pendingTransport = Promise.resolve();
      const holdUntil = promise => { pendingTransport = Promise.resolve(promise).then(v => markRisk(v, context), e => markRisk(e, context)).catch(() => {}); };
      const result = queue.then(async () => {
        aborted(); if (now() < blockedUntil) throw paused();
        const waitMs = Math.max(0, nextAt - now());
        if (waitMs) await sleep(waitMs);
        aborted(); if (now() < blockedUntil) throw paused();
        try { requestCount += 1; const result = await operation({ holdUntil }); markRisk(result, context); aborted(); return result; }
        catch (error) { if (!isWechatAccessPaused(error)) markRisk(error, context); throw error; }
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
  return { kind: 'retryable', state: 'access_paused', source: 'request-guard', diagnostic: { reason: 'wechat-access-paused', failureCategory: error.reason || 'wechat-verification-required', retryAfterMs: error.retryAfterMs ?? (error.reason === 'wechat-rate-limited' ? WECHAT_RISK_COOLDOWN_MS : 0), ...(error.accessPause ? { accessPause: error.accessPause } : {}), attempts, retryable: true } };
}
function wechatAccessPauseMessage(diagnostic = {}) {
  const pause = diagnostic.accessPause || {};
  const minutes = Math.max(1, Math.ceil(Number(pause.retryAfterMs || diagnostic.retryAfterMs || WECHAT_RISK_COOLDOWN_MS) / 60000));
  if (pause.pauseOrigin === 'cooldown') return `受前一次公众号访问限制影响，已暂停公众号抓取；本条尚未重新请求，不能据此判断这篇文章无法访问。约 ${minutes} 分钟后可重试，或到插件设置“公众号访问验证”处理。`;
  if (diagnostic.failureCategory === 'wechat-rate-limited') return `微信返回访问频率限制（HTTP 429），已暂停公众号抓取约 ${minutes} 分钟。请等待后重试，不要连续点击。`;
  return '这篇公众号文章暂时无法读取，访问时遇到验证提示；其他内容将继续同步。可在插件设置“公众号访问验证”打开原文查看；若页面提供验证，请按页面操作；没有验证入口时无需反复重试。';
}
module.exports = { assertWechatTransportResponse, createWechatArticleRequestGate, isWechatAccessPaused, buildWechatAccessPausedResult, wechatAccessPauseMessage, WECHAT_REQUEST_GAP_MS, WECHAT_RISK_COOLDOWN_MS };
