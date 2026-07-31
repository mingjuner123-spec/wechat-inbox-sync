'use strict';

function buildSyncNotice(count) {
  return count ? `已同步 ${count} 条内容到 Obsidian` : '没有需要同步的新内容';
}

function buildSyncResultNotice(written = [], skipped = [], conversionWarnings = [], failed = []) {
  const writtenCount = Array.isArray(written) ? written.length : 0;
  const failedItems = Array.isArray(failed) ? failed : [];
  let message = !writtenCount && failedItems.length
    ? `同步失败：${failedItems.length} 条内容未同步：${failedItems[0].message}`
    : buildSyncNotice(writtenCount);
  if (Array.isArray(skipped) && skipped.length) {
    message += buildSkippedSyncNotice(skipped);
  }
  message += buildConversionWarningsNotice(
    Array.isArray(conversionWarnings) ? conversionWarnings : [],
  );
  if (writtenCount && failedItems.length) {
    message += `，${failedItems.length} 条失败：${failedItems[0].message}`;
  }
  return message;
}

function buildSkippedSyncNotice(skipped = []) {
  const cloudProcessingCount = skipped.filter((item) => item && item.reason === 'cloud-transcription-processing').length;
  const locallyQuarantinedCount = skipped.filter((item) => item && item.reason === 'locally-quarantined-unrecoverable').length;
  const deletedExpiredXiaohongshuCount = skipped.filter((item) => item && item.reason === 'deleted-expired-xhs-shortlink').length;
  const otherSkippedCount = skipped.filter((item) => item
    && item.reason !== 'already-synced-local'
    && item.reason !== 'cloud-transcription-processing'
    && item.reason !== 'locally-quarantined-unrecoverable'
    && item.reason !== 'deleted-expired-xhs-shortlink').length;
  const parts = [];
  if (cloudProcessingCount) {
    parts.push(`${cloudProcessingCount} 条云端转写中，完成后再同步`);
  }
  if (locallyQuarantinedCount) {
    parts.push(`${locallyQuarantinedCount} 条历史失效内容已在本机忽略`);
  }
  if (deletedExpiredXiaohongshuCount) {
    parts.push(`${deletedExpiredXiaohongshuCount} 条原小红书临时链接已失效，已生成失效说明文件并删除云端旧记录；请重新复制原笔记链接后再保存`);
  }
  if (otherSkippedCount) {
    parts.push(`${otherSkippedCount} 条已跳过`);
  }
  return parts.length ? `，${parts.join('，')}` : '';
}

function normalizeProgressPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.floor(number)));
}

function parseLocalAsrProgressLog(text) {
  const source = String(text || '');
  const values = {};
  source.split(/\r?\n/).forEach((line) => {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(String(line || '').trim());
    if (match) values[match[1]] = match[2];
  });
  if (
    !Object.prototype.hasOwnProperty.call(values, 'progressStage')
    && !Object.prototype.hasOwnProperty.call(values, 'progressCurrent')
    && !Object.prototype.hasOwnProperty.call(values, 'progressTotal')
    && !Object.prototype.hasOwnProperty.call(values, 'progressPercent')
  ) {
    return null;
  }
  const current = Number(values.progressCurrent);
  const total = Number(values.progressTotal);
  let percent = normalizeProgressPercent(values.progressPercent);
  if (percent === null && Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    percent = normalizeProgressPercent((current * 100) / total);
  }
  if (percent === null) percent = 0;
  return {
    stage: values.progressStage || '',
    current: Number.isFinite(current) ? current : 0,
    total: Number.isFinite(total) ? total : 0,
    percent,
    startedAt: String(values.progressStartedAt || '').trim(),
    heartbeatAt: String(values.progressHeartbeatAt || '').trim(),
    pid: Number.isFinite(Number(values.progressPid)) ? Number(values.progressPid) : 0,
  };
}

function formatProgressElapsed(startedAt, now = Date.now()) {
  const started = new Date(startedAt || '').getTime();
  if (!Number.isFinite(started) || started <= 0 || !Number.isFinite(now) || now < started) return '';
  return `${Math.max(0, Math.floor((now - started) / 1000))} 秒`;
}

function isProgressHeartbeatStale(heartbeatAt, now = Date.now(), thresholdMs = 20 * 1000) {
  const heartbeat = new Date(heartbeatAt || '').getTime();
  return Number.isFinite(heartbeat) && heartbeat > 0 && Number.isFinite(now) && now - heartbeat > thresholdMs;
}

function buildLocalAsrProgressKey(progress = {}, now = Date.now()) {
  const heartbeatState = isProgressHeartbeatStale(progress.heartbeatAt, now) ? 'stale' : 'fresh';
  return `${progress.stage || ''}|${Number(progress.current) || 0}|${Number(progress.total) || 0}|${Number(progress.percent) || 0}|${progress.heartbeatAt || ''}|${heartbeatState}`;
}

function buildSyncProgressMessage({
  bindingLabel = '',
  stage = '',
  current = 0,
  total = 0,
  title = '',
  percent = null,
  localProgressStage = '',
  localProgressCurrent = 0,
  localProgressTotal = 0,
  localProgressStartedAt = '',
  localProgressHeartbeatAt = '',
  now = Date.now(),
} = {}) {
  const label = bindingLabel ? `${bindingLabel}：` : '';
  const countText = total ? `${current}/${total}` : '';
  const normalizedPercent = normalizeProgressPercent(percent);
  const percentText = normalizedPercent === null ? '' : ` (${normalizedPercent}%)`;
  const suffix = title ? `：${title}` : '';
  if (stage === 'fetching') return `${label}正在同步，正在获取待同步内容`;
  if (stage === 'empty') return `${label}没有需要同步的新内容`;
  if (stage === 'processing') return `${label}正在处理 ${countText}${suffix}`;
  if (stage === 'downloading') return `${label}正在下载附件 ${countText}${percentText}${suffix}`;
  if (stage === 'transcribing') {
    if (isProgressHeartbeatStale(localProgressHeartbeatAt, now)) {
      return `${label}本地转写任务可能无响应，可暂停后重试${suffix}`;
    }
    const elapsed = formatProgressElapsed(localProgressStartedAt, now);
    const elapsedText = elapsed ? `，已运行 ${elapsed}` : '';
    if (localProgressStage === 'preparing' || localProgressStage === 'segmenting') {
      return `${label}正在准备音频${elapsedText}${suffix}`;
    }
    if (localProgressStage === 'transcribing' && Number(localProgressTotal) > 0 && Number(localProgressCurrent) <= 0) {
      return `${label}正在转写第 1/${localProgressTotal} 段${elapsedText}${suffix}`;
    }
    if (localProgressStage === 'transcribing' && Number(localProgressTotal) > 0) {
      return `${label}正在转写第 ${Math.min(Number(localProgressCurrent) + 1, Number(localProgressTotal))}/${localProgressTotal} 段${elapsedText}${suffix}`;
    }
    return `${label}正在转写音视频 ${countText}${percentText}${elapsedText}${suffix}`;
  }
  if (stage === 'writing') return `${label}正在写入 Obsidian ${countText}${suffix}`;
  if (stage === 'marking') return `${label}正在更新同步状态 ${countText}${suffix}`;
  return `${label}正在同步${countText ? ` ${countText}` : ''}${suffix}`;
}

function buildConversionWarningsNotice(warnings = []) {
  const normalized = (Array.isArray(warnings) ? warnings : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!normalized.length) return '';
  return `，${normalized.length} 条内容处理不完整：${normalized[0]}`;
}

module.exports = {
  buildConversionWarningsNotice,
  buildLocalAsrProgressKey,
  buildSkippedSyncNotice,
  buildSyncNotice,
  buildSyncProgressMessage,
  buildSyncResultNotice,
  formatProgressElapsed,
  isProgressHeartbeatStale,
  normalizeProgressPercent,
  parseLocalAsrProgressLog,
};
