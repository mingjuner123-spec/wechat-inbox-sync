'use strict';

const TRANSIENT_CODES = new Set(['CLOUD_MEDIA_UPLOAD_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'OPERATOR_NODE_REQUEST_TIMEOUT']);
function retryableTransport(error) {
  if (!error || error.name === 'AbortError' || error.retryable === false) return false;
  const status = Number(error.statusCode || error.status);
  if (status) return status === 408 || status === 429 || (status >= 500 && status <= 599);
  return TRANSIENT_CODES.has(error.code) ||
    (['CLOUD_MEDIA_UPLOAD_FAILED', 'OPERATOR_NODE_REQUEST_FAILED'].includes(error.code) && TRANSIENT_CODES.has(error.cause && error.cause.code));
}
function checkAbort(signal) {
  if (signal && signal.aborted) throw Object.assign(new Error('媒体交接已取消'), { name: 'AbortError', code: 'CLOUD_MEDIA_UPLOAD_ABORTED' });
}

// One prepared artifact and upload identity for the entire recovery. Completion
// uncertainty only retries the idempotent completion, never the upload or ASR.
async function recoverMediaUpload({ expiresAt, upload, complete, renew, signal, clock = Date.now }) {
  let attempts = 0;
  for (;;) {
    checkAbort(signal);
    if (renew) await renew();
    checkAbort(signal);
    const expiry = Date.parse(expiresAt || '');
    const remaining = Number.isFinite(expiry) ? expiry - clock() - 30000 : (attempts ? 0 : 480000);
    if (remaining < 1000) throw Object.assign(new Error('媒体上传凭据有效期不足'), { code: 'CLOUD_MEDIA_UPLOAD_WINDOW_EXPIRED', uploadAttempts: attempts, retryable: true });
    attempts++;
    try { await upload(Math.min(480000, remaining)); break; }
    catch (error) {
      error.uploadAttempts = attempts;
      if (attempts >= 2 || !retryableTransport(error)) throw error;
    }
  }
  checkAbort(signal);
  if (renew) await renew();
  checkAbort(signal);
  try { return await complete(); }
  catch (error) {
    if (!retryableTransport(error)) throw error;
    checkAbort(signal);
    // The first completion may have released our lease. Do not renew it here;
    // the server validates the same upload/attempt before its idempotent return.
    return await complete();
  }
}

function articleFailureKind(error) {
  const diagnostic = error && error.wechatArticleDiagnostic || {};
  if (diagnostic.verificationMarker === true || diagnostic.captchaRedirect === true || diagnostic.finalPageKind === 'captcha') return 'captcha';
  if (diagnostic.unavailableMarker === true) return 'unavailable';
  if (error && (error.code === 'WECHAT_ACCESS_PAUSED' || error.code === 'WECHAT_VERIFICATION_REQUIRED')) return 'captcha';
  if (['ETIMEDOUT', 'NODE_HTTP_TIMEOUT', 'OPERATOR_NODE_REQUEST_TIMEOUT'].includes(error && error.code) || /timeout|timed out/i.test(String(error && error.message || ''))) return 'timeout';
  if (diagnostic.hasJsContent === false) return 'body_empty';
  return 'request_failed';
}

module.exports = { recoverMediaUpload, retryableTransport, articleFailureKind };
