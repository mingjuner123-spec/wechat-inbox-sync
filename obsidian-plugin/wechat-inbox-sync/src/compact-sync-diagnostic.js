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

function formatCompactSyncDiagnostic({ failure, version, system, installStatus, maxBytes = MAX_COMPACT_DIAGNOSTIC_BYTES } = {}) {
  if (failure && failure.status === 'running') {
    return 'WeChat Inbox Sync 单次失败诊断\n尚无本次失败记录；转写仍进行中。';
  }
  if (!failure || failure.status !== 'failed') {
    return 'WeChat Inbox Sync 单次失败诊断\n当前没有失败中的同步记录。';
  }
  const diagnosticId = failure.diagnosticId || (failure.diagnostic && failure.diagnostic.id) || '';
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
