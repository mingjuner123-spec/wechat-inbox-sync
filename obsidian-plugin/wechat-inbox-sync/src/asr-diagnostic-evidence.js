'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const MAX_CHECKPOINTS = 128;
const MAX_SOURCE_URL_LENGTH = 2048;
const PRIVATE_HOST = /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[::1\]|::1$)/i;
const SECRET_QUERY_KEY = /(?:access[_-]?key|access[_-]?token|authorization|auth|cookie|credential|csrf|nonce|password|secret|session|signature|sig|token|xsec|expires?|expiry|deadline|policy|key[_-]?pair)/i;

function safeText(value, maxLength = 128) {
  const text = String(value || '').trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function safeIdentifier(value, { min = 1, max = 128 } = {}) {
  const text = safeText(value, max);
  return new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`).test(text) ? text : '';
}

function safeWorkId(value) {
  const text = safeText(value, 128);
  return /^(?:\d{10,30}|[A-Za-z0-9_-]{3,128})$/.test(text) ? text : '';
}

function safeSourceUrl(value) {
  const raw = safeText(value, MAX_SOURCE_URL_LENGTH);
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch (_) { return ''; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
  if (!parsed.hostname || PRIVATE_HOST.test(parsed.hostname)) return '';
  for (const [key, queryValue] of [...parsed.searchParams.entries()]) {
    if (SECRET_QUERY_KEY.test(key) || /(?:authorization|bearer|cookie|secret|signature|token|password)\s*=/i.test(queryValue)) {
      parsed.searchParams.delete(key);
    }
  }
  parsed.hash = '';
  const normalized = parsed.toString();
  return normalized.length <= MAX_SOURCE_URL_LENGTH ? normalized : '';
}

function extractWorkId(sourceUrl) {
  const safeUrl = safeSourceUrl(sourceUrl);
  if (!safeUrl) return '';
  try {
    const parsed = new URL(safeUrl);
    for (const key of ['modal_id', 'aweme_id', 'item_id', 'video_id']) {
      const value = safeWorkId(parsed.searchParams.get(key));
      if (value) return value;
    }
    const match = parsed.pathname.match(/\/(?:video|detail|note|item|aweme)\/(\d{10,30})(?:\/|$)/i);
    return safeWorkId(match && match[1]);
  } catch (_) { return ''; }
}

function normalizeDuration(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 24 * 60 * 60
    ? Math.round(number * 1000) / 1000
    : null;
}

function readMeasuredDurationFromLog(rawLog) {
  const text = String(rawLog || '');
  const matches = [...text.matchAll(/^durationSeconds=([0-9]+(?:\.[0-9]+)?)\s*$/gm)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const duration = normalizeDuration(matches[index][1]);
    if (duration !== null) return duration;
  }
  return null;
}
function buildAsrInputIdentity({
  recordId = '',
  attemptId = '',
  sourceUrl = '',
  workId = '',
  durationSeconds = null,
  durationHintSeconds = null,
} = {}) {
  const safeUrl = safeSourceUrl(sourceUrl);
  const result = {
    recordId: safeIdentifier(recordId),
    attemptId: safeIdentifier(attemptId),
  };
  if (safeUrl) result.sourceUrl = safeUrl;
  const safeId = safeWorkId(workId) || extractWorkId(safeUrl);
  if (safeId) result.workId = safeId;
  const duration = normalizeDuration(durationSeconds);
  if (duration !== null) result.durationSeconds = duration;
  const durationHint = normalizeDuration(durationHintSeconds);
  if (durationHint !== null) result.durationHintSeconds = durationHint;
  return result;
}

function readFileIdentity(filePath, { fileSystem = fs } = {}) {
  const file = String(filePath || '');
  if (!file) return { status: 'unavailable', reason: 'missing_path' };
  let descriptor;
  try {
    const stat = fileSystem.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return { status: 'unavailable', reason: 'not_regular_file' };
    const hash = crypto.createHash('sha256');
    descriptor = fileSystem.openSync(file, 'r');
    const buffer = Buffer.alloc(1024 * 1024);
    let total = 0;
    let count = 0;
    while ((count = fileSystem.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
      total += count;
    }
    return { status: 'captured', sha256: hash.digest('hex'), byteLength: total };
  } catch (_) {
    return { status: 'unavailable', reason: 'read_failed' };
  } finally {
    if (descriptor !== undefined) {
      try { fileSystem.closeSync(descriptor); } catch (_) { /* best effort */ }
    }
  }
}

async function readFileIdentityAsync(filePath, { fileSystem = fs } = {}) {
  const file = String(filePath || '');
  if (!file) return { status: 'unavailable', reason: 'missing_path' };
  try {
    const lstat = fileSystem.promises && typeof fileSystem.promises.lstat === 'function'
      ? await fileSystem.promises.lstat(file)
      : fileSystem.lstatSync(file);
    if (!lstat.isFile() || lstat.isSymbolicLink()) return { status: 'unavailable', reason: 'not_regular_file' };
    if (typeof fileSystem.createReadStream !== 'function') return readFileIdentity(file, { fileSystem });
    return await new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      let total = 0;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const stream = fileSystem.createReadStream(file, { highWaterMark: 1024 * 1024 });
      stream.on('data', (chunk) => {
        if (chunk) {
          hash.update(chunk);
          total += chunk.length;
        }
      });
      stream.once('error', () => finish({ status: 'unavailable', reason: 'read_failed' }));
      stream.once('end', () => finish({ status: 'captured', sha256: hash.digest('hex'), byteLength: total }));
    });
  } catch (_) {
    return { status: 'unavailable', reason: 'read_failed' };
  }
}
async function captureMediaIdentityAsync(filePath, { actualDurationSeconds = null, durationHintSeconds = null, now = new Date().toISOString(), fileSystem = fs } = {}) {
  const result = await readFileIdentityAsync(filePath, { fileSystem });
  result.mediaKind = 'downloaded_media';
  result.audioStatus = 'unavailable';
  result.audioReason = 'preprocessed_chunks_not_exposed';
  const actualDuration = normalizeDuration(actualDurationSeconds);
  if (actualDuration !== null) {
    result.durationSeconds = actualDuration;
    result.durationStatus = 'measured';
  } else {
    result.durationStatus = 'unavailable';
    result.durationReason = 'not_probed';
  }
  const durationHint = normalizeDuration(durationHintSeconds);
  if (durationHint !== null) result.durationHintSeconds = durationHint;
  const timestamp = Date.parse(now);
  result.capturedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
  return result;
}
function captureMediaIdentity(filePath, { actualDurationSeconds = null, durationHintSeconds = null, now = new Date().toISOString(), fileSystem = fs } = {}) {
  const result = readFileIdentity(filePath, { fileSystem });
  result.mediaKind = 'downloaded_media';
  result.audioStatus = 'unavailable';
  result.audioReason = 'preprocessed_chunks_not_exposed';
  const actualDuration = normalizeDuration(actualDurationSeconds);
  if (actualDuration !== null) {
    result.durationSeconds = actualDuration;
    result.durationStatus = 'measured';
  } else {
    result.durationStatus = 'unavailable';
    result.durationReason = 'not_probed';
  }
  const durationHint = normalizeDuration(durationHintSeconds);
  if (durationHint !== null) result.durationHintSeconds = durationHint;
  const timestamp = Date.parse(now);
  result.capturedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
  return result;
}

function normalizeProgress(progress) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null;
  const result = {};
  const stage = safeText(progress.stage, 64);
  if (stage) result.stage = stage;
  for (const key of ['current', 'total']) {
    if (progress[key] === null || progress[key] === undefined || progress[key] === '') continue;
    const value = Number(progress[key]);
    if (Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000) result[key] = value;
  }
  const percentValue = progress.percent;
  const percent = percentValue === null || percentValue === undefined || percentValue === '' ? NaN : Number(percentValue);
  if (Number.isFinite(percent) && percent >= 0 && percent <= 100) result.percent = Math.round(percent * 100) / 100;
  for (const key of ['startedAt', 'heartbeatAt']) {
    const value = Date.parse(progress[key] || '');
    if (Number.isFinite(value)) result[key] = new Date(value).toISOString();
  }
  return Object.keys(result).length ? result : null;
}

function progressKey(progress) {
  if (!progress) return '';
  return JSON.stringify({
    stage: progress.stage || '',
    current: progress.current ?? null,
    total: progress.total ?? null,
    percent: progress.percent ?? null,
  });
}

function buildRunningCheckpoint({
  attempt = null,
  stage = '',
  pid = null,
  processState = 'unknown',
  processStateSource = 'unknown',
  pidSource = 'unknown',
  progressSource = 'unknown',
  wrapperPid = null,
  wrapperProcessState = 'unknown',
  progress = null,
  previous = [],
  rssKiB = null,
  cpuTimeMs = null,
  now = new Date().toISOString(),
} = {}) {
  const normalizedProgress = normalizeProgress(progress);
  const key = progressKey(normalizedProgress);
  const prior = Array.isArray(previous) ? [...previous].reverse().find(item => item && item.progressKey) : null;
  const progressObserved = Boolean(key && (!prior || key !== prior.progressKey));
  const timestamp = Date.parse(now);
  const capturedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
  const safePid = Number.isSafeInteger(Number(pid)) && Number(pid) > 0 ? Number(pid) : null;
  const safeWrapperPid = Number.isSafeInteger(Number(wrapperPid)) && Number(wrapperPid) > 0 ? Number(wrapperPid) : null;
  const safeState = ['running', 'exited', 'unknown'].includes(processState) ? processState : 'unknown';
  const safeWrapperState = ['running', 'exited', 'unknown'].includes(wrapperProcessState) ? wrapperProcessState : 'unknown';
  const safeSource = (value) => ['native_log', 'wrapper_process', 'unknown'].includes(value) ? value : 'unknown';
  const attemptValue = attempt === null || attempt === undefined || attempt === '' ? null : Number(attempt);
  const result = {
    attempt: Number.isSafeInteger(attemptValue) && attemptValue >= 0 ? attemptValue : null,
    capturedAt,
    stage: safeText(stage || normalizedProgress?.stage || 'transcribing', 64) || 'unknown',
    pid: safePid,
    pidSource: safeSource(pidSource),
    processState: safeState,
    processStateSource: safeSource(processStateSource),
    wrapperPid: safeWrapperPid,
    wrapperProcessState: safeWrapperState,
    progressSource: safeSource(progressSource),
    kind: progressObserved ? 'real_progress' : 'heartbeat',
    progressObserved,
    progressKey: key,
  };
  if (normalizedProgress) result.progress = normalizedProgress;
  const safeRss = rssKiB === null || rssKiB === undefined || rssKiB === '' ? NaN : Number(rssKiB);
  if (Number.isSafeInteger(safeRss) && safeRss >= 0) result.rssKiB = safeRss;
  const safeCpu = cpuTimeMs === null || cpuTimeMs === undefined || cpuTimeMs === '' ? NaN : Number(cpuTimeMs);
  if (Number.isSafeInteger(safeCpu) && safeCpu >= 0) result.cpuTimeMs = safeCpu;
  return result;
}

function appendRunningCheckpoint(previous, checkpoint, { max = MAX_CHECKPOINTS } = {}) {
  const list = Array.isArray(previous) ? previous.filter(item => item && typeof item === 'object') : [];
  if (!checkpoint || typeof checkpoint !== 'object') return list.slice(-max);
  const last = list[list.length - 1];
  if (last
    && last.pid === checkpoint.pid
    && last.kind === checkpoint.kind
    && last.progressKey === checkpoint.progressKey
    && last.processState === checkpoint.processState
    && Date.parse(checkpoint.capturedAt || '') - Date.parse(last.capturedAt || '') < 1000) {
    return list;
  }
  return [...list, checkpoint].slice(-Math.max(1, Math.min(MAX_CHECKPOINTS, Number(max) || MAX_CHECKPOINTS)));
}

module.exports = {
  MAX_CHECKPOINTS,
  appendRunningCheckpoint,
  buildAsrInputIdentity,
  buildRunningCheckpoint,
  captureMediaIdentity,
  captureMediaIdentityAsync,
  extractWorkId,
  normalizeDuration,
  readFileIdentity,
  readMeasuredDurationFromLog,
  readFileIdentityAsync,
  safeIdentifier,
  safeSourceUrl,
  safeWorkId,
};
