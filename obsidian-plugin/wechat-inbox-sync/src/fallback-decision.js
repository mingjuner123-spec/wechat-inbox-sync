'use strict';

const GATE_CODES = new Set(['CLOUD_FALLBACK_DISABLED', 'CLOUD_FALLBACK_BINDING_REQUIRED',
  'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED', 'LOCAL_COMPONENT_SETUP_REQUIRED',
  'DOUYIN_LOGIN_REQUIRED', 'DOUYIN_RESOLVER_NOT_INSTALLED', 'SOURCE_UNAVAILABLE']);
function sanitizeFallbackDecision(value) {
  const terminalCodes = new Set(['OPERATOR_WECHAT_ARTICLE_EMPTY', 'OPERATOR_WECHAT_ARTICLE_CAPTCHA', 'OPERATOR_MEDIA_ACQUIRE_EMPTY', 'OPERATOR_MEDIA_RESOLUTION_EMPTY', 'CLOUD_MEDIA_UPLOAD_TIMEOUT', 'CLOUD_MEDIA_UPLOAD_FAILED', 'CLOUD_MEDIA_UPLOAD_WINDOW_EXPIRED', 'OPERATOR_DOUBAO_ACCESS_DENIED', 'OPERATOR_ASR_EMPTY', 'OPERATOR_NODE_FAILED']);
  if (value && value.status === 'failed' && terminalCodes.has(value.code)) {
    return { status: 'failed', code: value.code, stage: ['acquiring', 'upload', 'transcribing'].includes(value.stage) ? value.stage : 'unknown' };
  }
  if (!value || value.status !== 'not_submitted') return null;
  const code = GATE_CODES.has(value.code) ? value.code : 'CLOUD_FALLBACK_SUBMIT_FAILED';
  return { status: 'not_submitted', code, stage: code === 'CLOUD_FALLBACK_SUBMIT_FAILED' ? 'submission' : 'eligibility' };
}
function attachFallbackDecision(error, decision) {
  if (!error || !decision || !decision.gateMessage) return error;
  error.diagnostic = { ...(error.diagnostic || {}), cloudFallback: sanitizeFallbackDecision({ status: 'not_submitted', code: decision.gateCode }) };
  error.cloudFallbackGateMessage = decision.gateMessage;
  // The caller already redacts the error for display and diagnostics.
  error.message = [error.message, decision.gateMessage].filter(Boolean).join('；');
  return error;
}
module.exports = { sanitizeFallbackDecision, attachFallbackDecision };
