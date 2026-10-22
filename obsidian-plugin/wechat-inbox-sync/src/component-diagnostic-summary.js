'use strict';
function summarizeResolverAttempts(entries = []) {
  if (!entries.length) return '';
  const latest = entries.at(-1);
  const selected = new Map();
  for (const entry of entries) {
    if (entry.status === 'failed' && entry.transport) selected.set(`${entry.source}/${entry.transport}`, entry);
  }
  const format = entry => [entry.time, entry.source, entry.transport, entry.stage, entry.code || entry.status,
    Number.isSafeInteger(entry.receivedBytes) ? `已收 ${entry.receivedBytes} 字节` : '',
    entry.totalBytes > 0 ? `共 ${entry.totalBytes} 字节` : '',
    Number.isSafeInteger(entry.elapsedMs) ? `耗时 ${entry.elapsedMs} ms` : '',
    Number.isSafeInteger(entry.curlExitCode) ? `curl=${entry.curlExitCode}` : '',
    entry.httpStatus > 0 ? `HTTP=${entry.httpStatus}` : '',
  ].filter(Boolean).join(' | ');
  return ['最近结果：' + format(latest), ...[...selected.values()].slice(-4).map(e =>
    (e.attemptId === latest.attemptId ? '本次下载：' : '之前下载失败（非本次）：') + format(e))].join('\n');
}
function hasFeishuActivity(value = {}) {
  return ['detected', 'shown', 'failed', 'pending', 'active'].some(key => Number(value[key]) > 0) || Boolean(value.lastErrorCode);
}
module.exports = { summarizeResolverAttempts, hasFeishuActivity };
