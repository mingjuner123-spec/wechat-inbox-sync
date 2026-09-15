'use strict';
const crypto = require('crypto');
const { diagnosticRedact } = require('./asr-recovery-utils');

function recordRef(value) {
  return value ? crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16) : '';
}

function technicalText(value, settings = {}) {
  const text = String(value || '');
  if (text.length > 16384) return '[oversized error message omitted]';
  return diagnosticRedact(text, settings)
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:token|bindingToken|xsec_token|access_token|refresh_token|web_session|a1|authorization|cookie|password|secret|api[_-]?key)["']?\s*[=:]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL REDACTED]')
    .replace(/\s+/g, ' ').slice(0, 480);
}

function safeStage(value = {}, settings = {}) {
  const result = {};
  for (const key of ['type', 'stage', 'outcome', 'action', 'code', 'failureKind', 'exception', 'host']) {
    if (value[key]) result[key] = technicalText(value[key], settings).slice(0, 64);
  }
  if (value.message) result.message = technicalText(value.message, settings);
  for (const key of ['status', 'durationMs', 'mediaCandidateCount']) {
    const number = Number(value[key]);
    if (Number.isFinite(number) && number >= 0) result[key] = Math.min(3600000, Math.round(number));
  }
  return result;
}

function errorDetails(error, settings = {}) {
  return safeStage({
    exception: ['Error', 'SyntaxError', 'ReferenceError', 'TypeError', 'RangeError', 'AbortError'].includes(error && error.name) ? error.name : 'Error',
    message: String(error && error.message || error || 'Unknown browser error'),
    status: Number(error && (error.status || error.statusCode)) || 0,
  }, settings);
}

function sanitize(value, settings = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const result = { source: 'xiaohongshu-browser', schema: 2 };
  for (const key of ['attemptId', 'recordRef']) result[key] = /^[a-f0-9]{8,32}$/.test(input[key] || '') ? input[key] : '';
  for (const key of ['startedAt', 'finishedAt']) if (Number.isFinite(Date.parse(input[key]))) result[key] = new Date(input[key]).toISOString();
  if (/^\d+\.\d+\.\d+$/.test(input.runtimeVersion || '')) result.runtimeVersion = input.runtimeVersion;
  for (const key of ['finalOutcome', 'loginEvidence', 'commentAccess']) if (input[key]) result[key] = technicalText(input[key], settings).slice(0, 64);
  result.loginCookiePresent = typeof input.loginCookiePresent === 'boolean' ? input.loginCookiePresent : null;
  result.transcriptionStarted = input.transcriptionStarted === true;
  result.mediaCandidateCount = Number.isFinite(input.mediaCandidateCount) ? Math.max(0, Math.min(1000, input.mediaCandidateCount)) : 0;
  for (const key of ['stages', 'events']) result[key] = (Array.isArray(input[key]) ? input[key] : []).slice(-24).map(item => safeStage(item || {}, settings));
  result.downloadAttempts = (Array.isArray(input.downloadAttempts) ? input.downloadAttempts : []).slice(-12).map(item => safeStage({ stage: item.transport || item.stage, outcome: typeof item.ok === 'boolean' ? (item.ok ? 'success' : 'failed') : item.outcome, status: item.status, code: item.code, durationMs: item.durationMs }, settings));
  return result;
}

module.exports = { recordRef, technicalText, errorDetails, safeStage, sanitize };
