'use strict';

const GATE_CODES = new Set(['CLOUD_FALLBACK_DISABLED', 'CLOUD_FALLBACK_BINDING_REQUIRED',
  'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED', 'LOCAL_COMPONENT_SETUP_REQUIRED',
  'DOUYIN_LOGIN_REQUIRED', 'DOUYIN_RESOLVER_NOT_INSTALLED', 'SOURCE_UNAVAILABLE']);
function sanitizeFallbackDecision(value) {
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
