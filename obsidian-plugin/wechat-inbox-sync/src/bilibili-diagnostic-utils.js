'use strict';

const STAGES = {
  'view-api': '视频信息接口', 'player-api': '字幕信息接口',
  'subtitle-fetch': '字幕下载', 'page-fetch': '视频网页',
  'audio-playurl-api': '音频地址接口', 'audio-playurl-refresh': '音频地址刷新',
  'progressive-playurl-api': '视频地址接口', 'media-download': '音视频下载',
  transcription: '语音转写',
};
const TRANSPORTS = new Set(['obsidian-requestUrl', 'node-http', 'transcription']);
const CODES = new Set(['BILIBILI_HTTP_412', 'BILIBILI_REQUEST_FAILED', 'ETIMEDOUT',
  'ESOCKETTIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED',
  'ERR_CERT_AUTHORITY_INVALID', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'TRANSCRIPTION_FAILED', 'LOCAL_COMPONENT_UNAVAILABLE', 'MEDIA_DOWNLOAD_TIMEOUT']);
const REASONS = {
  timeout: '请求超时', dns: '域名解析失败', connection: '网络连接失败',
  certificate: '证书校验失败', empty_transcript: '转写未返回文本',
  configuration: '转写配置不可用', native_exit: '转写程序异常退出', unknown: '请求失败',
};
function number(value, min, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : 0;
}
function fault(error = {}) {
  const text = `${error.code || ''} ${error.message || ''}`;
  const reason = typeof error.reason === 'string' && Object.hasOwn(REASONS, error.reason) ? error.reason
    : /timeout|timed.?out|ETIMEDOUT|超时/i.test(text) ? 'timeout'
    : /ENOTFOUND|EAI_AGAIN|域名解析/i.test(text) ? 'dns'
    : /certificate|CERT_|证书/i.test(text) ? 'certificate'
    : /ECONN|connection|网络连接/i.test(text) ? 'connection'
    : /没有返回文本|未返回文本|empty.*transcript/i.test(text) ? 'empty_transcript'
    : /not configured|未配置/i.test(text) ? 'configuration'
    : /exit code|异常退出|崩溃/i.test(text) ? 'native_exit' : 'unknown';
  return {
    status: number(error.status, 400, 599),
    apiCode: number(error.apiCode, -1000000, 1000000),
    code: CODES.has(error.code) ? error.code : '', reason,
  };
}
function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.source === 'automatic-webpage') {
    // Accept only one known wrapper, never arbitrary nested objects.
    const cause = input.cause?.platform === 'bilibili' ? sanitize({ ...input.cause, source: undefined }) : null;
    return cause ? { source: 'automatic-webpage', stage: 'hydration', cause } : null;
  }
  if (input.platform !== 'bilibili') return null;
  return {
    schemaVersion: 1, platform: 'bilibili',
    requestedPageNumber: number(input.requestedPageNumber, 1, 10000),
    mediaCandidateCount: number(input.mediaCandidateCount, 0, 1000),
    stages: (Array.isArray(input.stages) ? input.stages : []).slice(-24)
      .filter(item => item && typeof item.stage === 'string' && Object.hasOwn(STAGES, item.stage) && TRANSPORTS.has(item.transport))
      .map(item => ({ stage: item.stage, transport: item.transport, ok: item.ok === true,
        ...(item.error ? { error: fault(item.error) } : {}) })),
  };
}
function summary(input) {
  const sanitized = sanitize(input);
  const trace = sanitized?.source === 'automatic-webpage' ? sanitized.cause : sanitized;
  if (!trace) return '';
  const latest = new Map();
  for (const item of trace.stages) latest.set(item.stage, item);
  const reasons = [...latest.values()].filter(item => !item.ok).slice(-3).map(item => {
    const error = item.error || fault();
    const details = [error.status ? `HTTP ${error.status}` : '', error.apiCode ? `API ${error.apiCode}` : ''].filter(Boolean);
    if (!details.length) details.push(REASONS[error.reason]);
    if (error.code && !error.code.startsWith('BILIBILI_')) details.push(error.code);
    return `${STAGES[item.stage]}：${details.join('，')}`;
  });
  return `B站内容获取失败：${reasons.length ? reasons.join('；') : '未获取到可用字幕或音视频地址'}。可在小程序同步记录中重试。`;
}
module.exports = { sanitize, summary };
