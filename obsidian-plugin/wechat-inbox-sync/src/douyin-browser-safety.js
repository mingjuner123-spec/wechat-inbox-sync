'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LIMITS = Object.freeze({ timeoutMs: 45000, responses: 24, concurrent: 3, responseBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024 });
const STAGES = new Set(['created', 'loading', 'debugger-setup', 'page-load', 'page-validation', 'media-extraction', 'response-extraction', 'finished']);
const OUTCOMES = new Set(['running', 'success', 'failed', 'cancelled']);
const REASONS = new Set(['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction', 'unknown']);
const number = value => Number.isFinite(value) ? Math.max(0, Math.min(1e12, Math.round(value))) : 0;
const version = value => /^\d+(?:\.\d+){1,3}$/.test(value || '') ? value : '';

function sanitize(value = {}) {
  const result = { source: 'douyin-browser', schema: 1 };
  for (const key of ['attemptId', 'recordRef']) result[key] = /^[a-f0-9]{16,32}$/.test(value[key] || '') ? value[key] : '';
  result.resolutionAttemptId = /^[a-f0-9]{16,32}$/.test(value.resolutionAttemptId || '') ? value.resolutionAttemptId : '';
  result.debuggerStatus = ['ready', 'unavailable', 'timeout', 'failed'].includes(value.debuggerStatus) ? value.debuggerStatus : '';
  result.pageEvent = ['dom-ready', 'did-finish-load', 'did-fail-load', 'did-navigate', 'did-redirect-navigation'].includes(value.pageEvent) ? value.pageEvent : '';
  result.networkCode = /^ERR_[A-Z_]{1,60}$/.test(value.networkCode || '') ? value.networkCode : '';
  result.httpStatus = number(value.httpStatus);
  result.domReady = value.domReady === true;
  result.pageLoaded = value.pageLoaded === true;
  for (const key of ['startedAt', 'updatedAt', 'finishedAt']) if (Number.isFinite(Date.parse(value[key]))) result[key] = new Date(value[key]).toISOString();
  result.stage = STAGES.has(value.stage) ? value.stage : 'created';
  result.outcome = OUTCOMES.has(value.outcome) ? value.outcome : 'running';
  result.browserCode = /^DOUYIN_BROWSER_[A-Z_]{1,40}$/.test(value.browserCode || '') ? value.browserCode : '';
  result.reason = REASONS.has(value.reason) ? value.reason : '';
  result.exitCode = Number.isInteger(value.exitCode) ? value.exitCode : null;
  result.electron = version(value.electron);
  result.chromium = version(value.chromium);
  result.runtimeVersion = version(value.runtimeVersion);
  for (const key of ['durationMs', 'blockedMedia', 'responseReads', 'responseBytes', 'droppedResponses', 'freeMemoryBytesBefore']) result[key] = number(value[key]);
  return result;
}

function readAttempts(root) {
  try {
    const file = path.join(root, 'douyin-browser-diagnostic.json');
    if (fs.statSync(file).size > 64 * 1024) return [];
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(rows) ? rows.slice(-5).map(sanitize) : [];
  } catch (_) { return []; }
}

function createAttempt(root, input, versions = {}) {
  const began = Date.now();
  let value = sanitize({ ...versions, attemptId: crypto.randomBytes(8).toString('hex'), recordRef: crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 16), startedAt: new Date(began).toISOString(), stage: 'created', outcome: 'running' });
  const update = event => {
    value = sanitize({ ...value, ...event, durationMs: Date.now() - began, updatedAt: new Date().toISOString() });
    try {
      fs.mkdirSync(root, { recursive: true });
      const rows = readAttempts(root).filter(row => row.attemptId !== value.attemptId);
      const file = path.join(root, 'douyin-browser-diagnostic.json');
      const temp = file + '.tmp';
      fs.writeFileSync(temp, JSON.stringify([...rows, value].slice(-5)), 'utf8');
      fs.renameSync(temp, file);
    } catch (_) { /* Diagnostic storage must not replace the processing error. */ }
    return value;
  };
  update({});
  return { update, finish(error) { return update({ outcome: error ? (error.name === 'AbortError' ? 'cancelled' : 'failed') : 'success', ...(error ? { browserCode: error.browserCode || value.browserCode } : { stage: 'finished' }), finishedAt: new Date().toISOString() }); } };
}

function ownsRequest(details, contents) {
  // Session listeners also see the login window. Never inspect/block its traffic.
  return Boolean(contents && Number.isInteger(contents.id) && (details?.webContentsId === contents.id || details?.webContents?.id === contents.id));
}

function isMediaRequest(details) {
  if (details?.resourceType === 'media') return true;
  try {
    const url = new URL(details?.url);
    return /\.(?:mp4|m4a|mp3|webm|m3u8|ts)(?:$|[?#])/i.test(url.pathname)
      || /(^|\.)douyinvod\.com$/.test(url.hostname)
      || /\/aweme\/v\d+\/play\//.test(url.pathname);
  } catch (_) { return false; }
}

function mediaResponse(details) {
  return Object.entries(details?.responseHeaders || {}).some(([key, values]) => key.toLowerCase() === 'content-type' && (Array.isArray(values) ? values : [values]).some(value => /^(?:audio|video)\/|application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(String(value))));
}

function attachGuard(win, { signal, onDiagnostic = () => {}, timeoutMs = LIMITS.timeoutMs } = {}) {
  const contents = win.webContents;
  let failure, rejectFailure, closed = false;
  const failed = new Promise((_, reject) => { rejectFailure = reject; });
  failed.catch(() => {});
  const emit = event => { try { onDiagnostic(event); } catch (_) {} };
  const fail = (browserCode, message, detail = {}) => {
    if (failure || closed) return;
    failure = Object.assign(new Error(message), { code: 'EXTRACTION_FAILED', browserCode });
    emit({ ...detail, browserCode });
    rejectFailure(failure);
  };
  const onGone = (_event, details = {}) => fail('DOUYIN_BROWSER_RENDERER_GONE', '抖音网页解析进程异常退出，尚未完成视频地址提取', { reason: REASONS.has(details.reason) ? details.reason : 'unknown', exitCode: Number.isInteger(details.exitCode) ? details.exitCode : null });
  const onDestroyed = () => fail('DOUYIN_BROWSER_CLOSED', '抖音解析窗口提前关闭');
  const onDomReady = () => emit({ pageEvent: 'dom-ready', domReady: true });
  const onLoad = () => emit({ pageEvent: 'did-finish-load', pageLoaded: true });
  const onNavigate = (_event, _url, status) => emit({ pageEvent: 'did-navigate', httpStatus: Number.isInteger(status) ? status : 0 });
  const onLoadFailed = (_event, code, description, _url, mainFrame) => {
    if (mainFrame === false || code === -3) return;
    const networkCode = String(description || '').replace(/^net::/, '');
    fail('DOUYIN_BROWSER_LOAD_FAILED', '抖音主页面加载失败', { pageEvent: 'did-fail-load', networkCode });
  };
  const onAbort = () => {
    if (failure || closed) return;
    failure = Object.assign(new Error('抖音解析已取消'), { name: 'AbortError', code: 'ABORT_ERR', browserCode: 'DOUYIN_BROWSER_CANCELLED' });
    emit({ browserCode: failure.browserCode }); rejectFailure(failure);
  };
  contents.on('render-process-gone', onGone);
  contents.on('destroyed', onDestroyed);
  contents.on('dom-ready', onDomReady);
  contents.on('did-finish-load', onLoad);
  contents.on('did-navigate', onNavigate);
  contents.on('did-fail-load', onLoadFailed);
  // Window-level mute is installed before loadURL, covering autoplay before DOM injection.
  if (typeof contents.setAudioMuted === 'function') contents.setAudioMuted(true);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => fail('DOUYIN_BROWSER_TIMEOUT', '抖音网页解析超时，已停止本次隐藏网页任务'), timeoutMs);
  timer.unref?.();
  return {
    emit,
    async optional(task, timeoutMs = 1500) {
      let timer;
      const timed = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Optional response capture timed out'), { code: 'DOUYIN_DEBUGGER_TIMEOUT' })), timeoutMs); });
      try { return await this.run(Promise.race([Promise.resolve(task), timed]), 'debugger-setup'); }
      finally { clearTimeout(timer); }
    },
    async run(task, stage) {
      const started = Promise.resolve(task);
      started.catch(() => {});
      if (failure) throw failure;
      emit({ stage });
      return Promise.race([started, failed]);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      contents.removeListener('render-process-gone', onGone);
      contents.removeListener('destroyed', onDestroyed);
      contents.removeListener('dom-ready', onDomReady);
      contents.removeListener('did-finish-load', onLoad);
      contents.removeListener('did-navigate', onNavigate);
      contents.removeListener('did-fail-load', onLoadFailed);
    },
  };
}

function createResponseBudget() {
  let reads = 0, active = 0, bytes = 0, dropped = 0;
  return {
    reserve(encodedBytes = 0) {
      if (reads >= LIMITS.responses || active >= LIMITS.concurrent || bytes >= LIMITS.totalBytes || encodedBytes > LIMITS.responseBytes) { dropped++; return false; }
      reads++; active++; return true;
    },
    accept(body) {
      const size = Buffer.byteLength(String(body?.body || ''), 'utf8');
      if (size > LIMITS.responseBytes * (body?.base64Encoded ? 1.4 : 1) || bytes + size > LIMITS.totalBytes) { dropped++; return false; }
      bytes += size; return true;
    },
    release() { active = Math.max(0, active - 1); },
    snapshot() { return { responseReads: reads, responseBytes: bytes, droppedResponses: dropped }; },
  };
}

module.exports = { LIMITS, sanitize, readAttempts, createAttempt, ownsRequest, isMediaRequest, mediaResponse, attachGuard, createResponseBudget };
