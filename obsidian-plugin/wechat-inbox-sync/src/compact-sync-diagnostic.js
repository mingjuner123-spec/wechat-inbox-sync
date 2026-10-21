'use strict';

const MAX_COMPACT_DIAGNOSTIC_BYTES = 12 * 1024;
const byteLength = text => Buffer.byteLength(String(text || ''), 'utf8');

function takeUtf8(text, limit) {
  let result = '';
  let used = 0;
  for (const point of [...String(text || '')]) {
    const size = byteLength(point);
    if (used + size > limit) break;
    result += point;
    used += size;
  }
  return result;
}

// 知乎 / 今日头条 抓取失败时，failure.diagnostic.cause 里带着阶段、隐藏浏览器和
// HTTP 状态。诊断文本要把这些字段带到用户能复制的地方，否则这类失败只剩一句
// “未支持”，无法定位。其它来源没有 cause.source，保持原有输出不变。
function describeCause(diagnostic) {
  if (!diagnostic || typeof diagnostic !== 'object') return '';
  const cause = diagnostic.cause && typeof diagnostic.cause === 'object' ? diagnostic.cause : diagnostic;
  if (cause.source !== 'platform-article') return '';
  const parts = [];
  if (cause.platform) parts.push(`平台 ${cause.platform}`);
  if (cause.stage) parts.push(`阶段 ${cause.stage}`);
  if (cause.reason) parts.push(cause.reason);
  const hidden = cause.hiddenBrowser;
  if (hidden && typeof hidden === 'object') {
    const flags = [hidden.ok ? '成功' : '失败', hidden.blocked ? '被拒绝' : '', hidden.needsLogin ? '需登录' : ''].filter(Boolean);
    parts.push(`隐藏浏览器 ${flags.join('/')}`);
  }
  const http = cause.http;
  if (http && typeof http === 'object') {
    parts.push(http.status ? `HTTP ${http.status}` : String(http.transport || ''));
  }
  return parts.filter(Boolean).join('；').slice(0, 300);
}

function formatCompactSyncDiagnostic({ failure, version, system, installStatus, maxBytes = MAX_COMPACT_DIAGNOSTIC_BYTES } = {}) {
  if (failure && failure.status === 'running') {
    return 'WeChat Inbox Sync 单次失败诊断\n尚无本次失败记录；转写仍进行中。';
  }
  if (!failure || failure.status !== 'failed') {
    return 'WeChat Inbox Sync 单次失败诊断\n当前没有失败中的同步记录。';
  }
  const diagnosticId = failure.diagnosticId || (failure.diagnostic && failure.diagnostic.id) || '';
  const cause = describeCause(failure.diagnostic);
  const fields = [
    'WeChat Inbox Sync 单次失败诊断',
    `插件版本：${version || '未知'}`,
    `运行系统：${system || '未知'}`,
    installStatus ? `本地安装状态：${installStatus}` : '',
    `发生时间：${failure.time || '未知'}`,
    `阶段：${failure.stage || '未知'}`,
    `记录 ID：${failure.recordId || '未知'}`,
    diagnosticId ? `诊断 ID：${diagnosticId}` : '',
    `错误摘要：${failure.error || failure.message || '未提供错误摘要'}`,
    cause ? `失败原因：${cause}` : '',
    `原始分享链接：${failure.sourceUrl || '未记录'}`,
  ].filter(Boolean);
  const full = fields.join('\n');
  if (byteLength(full) <= maxBytes) return full;

  // Keep the identifying context and sanitized source link intact; spend the
  // remaining byte budget on the error summary and mark any omission clearly.
  const errorLine = `错误摘要：${failure.error || failure.message || '未提供错误摘要'}`;
  const prefix = fields.filter(field => field !== errorLine && !field.startsWith('原始分享链接：')).join('\n');
  const link = fields.find(field => field.startsWith('原始分享链接：')) || '';
  const suffix = link ? `\n${link}` : '';
  const marker = '\n[诊断内容已截断]';
  const available = Math.max(0, maxBytes - byteLength(`${prefix}\n错误摘要：${marker}${suffix}`));
  const error = takeUtf8(failure.error || failure.message || '未提供错误摘要', available);
  const result = `${prefix}\n错误摘要：${error}${marker}${suffix}`;
  return byteLength(result) <= maxBytes ? result : takeUtf8(result, maxBytes);
}

module.exports = { MAX_COMPACT_DIAGNOSTIC_BYTES, formatCompactSyncDiagnostic };
