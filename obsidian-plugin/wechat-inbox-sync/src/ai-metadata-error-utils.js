'use strict';

function classifyAiMetadataError(error) {
  const responseStatus = Number(error && error.response && error.response.status);
  if (responseStatus === 429) return 'rate-limited';
  if (responseStatus >= 500 && responseStatus <= 599) return 'upstream-service-error';
  const raw = error && typeof error === 'object'
    ? [error.code, error.message].filter(Boolean).join(' ')
    : String(error || '');
  const normalized = raw.toLowerCase();
  if ([
    'rate-limited',
    'upstream-service-error',
    'request-timeout',
    'empty-response',
    'service-error',
  ].includes(normalized)) {
    return normalized;
  }
  if (/\b429\b|too many requests|rate[-_\s]?limit/.test(normalized)) {
    return 'rate-limited';
  }
  if (/\b5\d\d\b|bad gateway|service unavailable|upstream/.test(normalized)) {
    return 'upstream-service-error';
  }
  if (/timed?\s*out|timeout|etimedout|econnaborted/.test(normalized)) {
    return 'request-timeout';
  }
  if (/empty|no usable|没有返回可用/.test(normalized)) {
    return 'empty-response';
  }
  return 'service-error';
}

function buildAiMetadataErrorComment(error) {
  return `<!-- wechat-inbox-ai-metadata-error: ${classifyAiMetadataError(error)} -->`;
}

function buildAiMetadataConversionWarning(error) {
  const detail = {
    'rate-limited': '请求过于频繁',
    'upstream-service-error': 'AI 服务暂时异常',
    'request-timeout': 'AI 请求超时',
    'empty-response': 'AI 未返回可用结果',
    'service-error': 'AI 服务暂时不可用',
  }[classifyAiMetadataError(error)];
  return `正文已同步，但 AI 简介/关键词未生成（${detail}）。`;
}

module.exports = {
  buildAiMetadataConversionWarning,
  buildAiMetadataErrorComment,
  classifyAiMetadataError,
};
