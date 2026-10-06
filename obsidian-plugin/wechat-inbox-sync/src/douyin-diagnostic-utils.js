'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { diagnosticRedact } = require('./asr-recovery-utils');
function byteLength(value) { return Buffer.byteLength(String(value || ''), 'utf8'); }
function takeUtf8(value, maxBytes) {
  let result = ''; let used = 0;
  for (const point of [...String(value || '')]) {
    const size = byteLength(point);
    if (used + size > maxBytes) break;
    result += point; used += size;
  }
  return result;
}
function safeErrorTextInfo(value, settings = {}) {
  const raw = String(value || '');
  if (raw.length > 16384) return { text: '[oversized error omitted]', truncated: true, originalBytes: byteLength(raw), omittedBytes: Math.max(0, byteLength(raw) - byteLength('[oversized error omitted]')) };
  const redacted = diagnosticRedact(raw, settings)
    .replace(/(["']?(?:sessionid(?:_ss)?|sid_guard|ttwid|msToken|cookie|authorization|token|password|secret|api[_-]?key)["']?\s*[=:]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s)\]\'"<>]+/gi, '[URL_REDACTED]')
    .replace(/\s+/g, ' ').trim();
  const text = takeUtf8(redacted, 480);
  return { text, truncated: byteLength(redacted) > byteLength(text), originalBytes: byteLength(redacted), omittedBytes: Math.max(0, byteLength(redacted) - byteLength(text)) };
}
function safeErrorText(value, settings = {}) { return safeErrorTextInfo(value, settings).text; }
const CODES = new Set([
  'DOUYIN_CANCELLED',
  'DOUYIN_FETCH_FAILED',
  'DOUYIN_CHALLENGE',
  'DOUYIN_COOKIE_REFRESH_REQUIRED',
  'DOUYIN_LOGIN_REQUIRED',
  'DOUYIN_RESOLVER_NETWORK',
  'DOUYIN_RESOLVER_FAILED',
  'DOUYIN_UNSUPPORTED_URL',
  'DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED',
  'DOUYIN_TARGET_ID_MISSING',
  'DOUYIN_NO_MEDIA',
  'DOUYIN_BROWSER_TIMEOUT',
  'DOUYIN_BROWSER_RENDERER_GONE',
  'DOUYIN_BROWSER_CLOSED',
  'DOUYIN_BROWSER_COOLDOWN',
  'DOUYIN_BROWSER_LOAD_FAILED',
]);
const URL_KINDS = new Set(['canonical', 'share', 'shortlink', 'home', 'feed', 'other', 'unknown']);
const INPUT_KINDS = new Set(['original-page', 'resolved-page', 'target-page', 'mobile-share', 'aweme-detail', 'authenticated-session', 'targeted-browser', 'local-yt-dlp', 'local-resolver', 'share-page', 'detail-api', 'session', 'platform-fetch', 'unknown']);
const DEBUGGER_CAPABILITIES = new Set(['present', 'absent', 'unsupported', 'not-eligible', 'unknown']);
const DEBUGGER_REASONS = new Set(['target-id-missing', 'api-absent', 'api-unsupported', 'unknown']);

function safeUrlKind(value) {
  return URL_KINDS.has(value) ? value : 'unknown';
}

function getDouyinUrlKind(value) {
  const text = String(value || '').trim();
  if (URL_KINDS.has(text)) return text;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    if (!/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$|(^|\.)amemv\.com$/.test(host)) return 'unknown';
    if (host === 'v.douyin.com' || host === 'v.iesdouyin.com') return 'shortlink';
    if (/\/share\/video\/\d{8,}$/.test(pathname) || /\/aweme\/detail\/\d{8,}$/.test(pathname)) return 'share';
    if (/\/video\/\d{8,}$/.test(pathname)) return 'canonical';
    if (/\/feed(?:\/|$)/.test(pathname)) return 'feed';
    if (pathname === '/') return 'home';
    return 'other';
  } catch (_) {
    return 'unknown';
  }
}

function getTrustedDouyinNoteRoute(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
      || !/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/.test(host)) return null;
    const match = parsed.pathname.match(/^\/(?:share\/)?note\/(\d{8,30})\/?$/i);
    if (!match) return null;
    return {
      kind: parsed.pathname.toLowerCase().startsWith('/share/') ? 'share-note' : 'note',
      idLength: match[1].length,
    };
  } catch (_) {
    return null;
  }
}
function safeInputKind(value) {
  return INPUT_KINDS.has(value) ? value : 'unknown';
}

function normalizeTargetIdState(value) {
  if (['recognized', 'missing', 'unknown'].includes(value)) return value;
  if (value === true) return 'recognized';
  if (value === false) return 'missing';
  return 'unknown';
}

function safeDebuggerCapability(value) {
  return DEBUGGER_CAPABILITIES.has(value) ? value : 'unknown';
}

function safeDebuggerReason(value) {
  return DEBUGGER_REASONS.has(value) ? value : 'unknown';
}

function classifyResolverError(error) {
  const text = String(error && error.message || error || '');
  const code = error && error.code === 'DOUYIN_UNSUPPORTED_URL' ? 'DOUYIN_UNSUPPORTED_URL'
    : error && error.code === 'DOUYIN_TARGET_ID_MISSING' ? 'DOUYIN_TARGET_ID_MISSING'
    : /unsupported\s+url/i.test(text) ? 'DOUYIN_UNSUPPORTED_URL'
    : /captcha|安全验证|请完成验证|risk[-_ ]control/i.test(text) ? 'DOUYIN_CHALLENGE'
    : /fresh cookies|cookies are needed/i.test(text) ? 'DOUYIN_COOKIE_REFRESH_REQUIRED'
    : /login required|sign in|authentication required/i.test(text) ? 'DOUYIN_LOGIN_REQUIRED'
    : /timed? ?out|timeout|ENOTFOUND|ECONN|certificate|HTTP Error [45]\d\d/i.test(text) ? 'DOUYIN_RESOLVER_NETWORK'
    : 'DOUYIN_RESOLVER_FAILED';
  return { code, exitCode: Number.isInteger(error && error.exitCode) ? error.exitCode : null };
}
function failureCode(stages = [], context = {}) {
  const failedStages = stages.filter(s => s && s.ok === false);
  const codes = failedStages.map(s => s.error && (s.error.browserCode || s.error.code)).filter(Boolean);
  // A generic resolver cookie request is not evidence of a CAPTCHA.
  const specificCode = ['DOUYIN_CHALLENGE', 'DOUYIN_LOGIN_REQUIRED', 'DOUYIN_BROWSER_RENDERER_GONE', 'DOUYIN_BROWSER_LOAD_FAILED', 'DOUYIN_BROWSER_TIMEOUT', 'DOUYIN_COOKIE_REFRESH_REQUIRED', 'DOUYIN_RESOLVER_NETWORK', 'DOUYIN_BROWSER_CLOSED', 'DOUYIN_BROWSER_COOLDOWN'].find(code => codes.includes(code));
  if (specificCode) return specificCode;
  if (codes.includes('DOUYIN_UNSUPPORTED_URL')
    || failedStages.some((stage) => /unsupported\s+url/i.test(String(stage.error && stage.error.message || '')))) {
    return 'DOUYIN_UNSUPPORTED_URL';
  }
  if (codes.includes('DOUYIN_TARGET_ID_MISSING')) return 'DOUYIN_TARGET_ID_MISSING';
  const targetIdMissing = context.targetIdState === 'missing'
    || (context.targetIdRecognized === false && context.targetIdState !== 'unknown');
  if (targetIdMissing) return 'DOUYIN_TARGET_ID_MISSING';
  if (codes.includes('DOUYIN_RESOLVER_FAILED')) return 'DOUYIN_RESOLVER_FAILED';
  return 'DOUYIN_NO_MEDIA';
}
function failureMessage(code) {
  return ({
    DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED: '这条链接是抖音笔记页面，当前不支持该类型转写。请分享具体视频作品链接；要保存文字，可复制到小程序后保存。',
    DOUYIN_CHALLENGE: '抖音解析返回安全验证要求，请打开插件内抖音窗口完成验证后重试。',
    DOUYIN_COOKIE_REFRESH_REQUIRED: '抖音解析器未能读取作品信息，提示需要更新网页访问校验信息（Cookie）；这不等于未登录。请在插件内打开这条作品，确认能正常播放后再重试；显示已登录不代表作品访问校验已通过。',
    DOUYIN_LOGIN_REQUIRED: '抖音解析器返回登录要求，请在插件内确认登录后重试。',
    DOUYIN_BROWSER_TIMEOUT: '抖音隐藏网页处理超时，尚未获取视频地址；请复制诊断查看停滞阶段。',
    DOUYIN_BROWSER_LOAD_FAILED: '抖音网页加载失败，网络错误已记录；请复制诊断查看原因。',
    DOUYIN_BROWSER_RENDERER_GONE: '抖音网页解析进程异常退出，已记录退出原因；请重启 Obsidian 后重试。',
    DOUYIN_BROWSER_CLOSED: '抖音解析窗口提前关闭，请重试。',
    DOUYIN_BROWSER_COOLDOWN: '抖音网页刚发生异常，正在短暂冷却，请稍后重试。',
    DOUYIN_RESOLVER_NETWORK: '抖音解析器网络访问失败，请检查网络；如开启了 VPN 或代理，可暂时关闭或切换规则模式后重试。',
    DOUYIN_RESOLVER_FAILED: '抖音本地解析器失败，暂未确认具体原因，请复制详细诊断。',
    DOUYIN_UNSUPPORTED_URL: '抖音解析组件未识别当前链接；请从具体作品页地址栏复制完整作品链接（不要复制主页、搜索页或分享文案）后重试。',
    DOUYIN_TARGET_ID_MISSING: '未从当前链接或重定向页面识别到具体作品；请从抖音具体作品页地址栏复制完整链接后重试。',
  })[code] || '未能从抖音作品页获取到可用的音频或视频地址，请复制诊断查看各解析路径结果。';
}
const token = value => /^[a-zA-Z0-9_.:-]{1,80}$/.test(value || '') ? value : '';
const resolverVersion = value => /^[a-zA-Z0-9][a-zA-Z0-9._:+-]{0,79}$/.test(String(value || '')) ? String(value) : 'unknown';
const integer = value => Number.isSafeInteger(value) ? Math.max(0, Math.min(value, 1e12)) : 0;
function safeCount(value, max = 1024 * 1024) {
  if (value === null || value === undefined || value === '') return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, max) : 0;
}
function sanitizeStageError(error) {
  if (!error || typeof error !== 'object') return undefined;
  const info = safeErrorTextInfo(error.message);
  const inheritedOmitted = safeCount(error.messageOmittedBytes);
  const inheritedOriginal = safeCount(error.messageOriginalBytes);
  const omittedBytes = inheritedOmitted + info.omittedBytes;
  const truncated = error.messageTruncated === true || omittedBytes > 0 || info.truncated;
  const result = {
    code: token(error.code),
    browserCode: token(error.browserCode),
    status: integer(error.status),
    exitCode: Number.isInteger(error.exitCode) ? error.exitCode : null,
    message: info.text,
  };
  if (truncated) {
    result.messageTruncated = true;
    result.messageOriginalBytes = Math.max(inheritedOriginal, info.originalBytes + inheritedOmitted);
    result.messageOmittedBytes = omittedBytes;
  }
  return result;
}
function sanitize(value = {}) {
  const result = { source: 'douyin-resolution', schema: 1 };
  for (const key of ['attemptId', 'recordRef']) result[key] = /^[a-f0-9]{16,32}$/.test(value[key] || '') ? value[key] : '';
  for (const key of ['startedAt', 'finishedAt']) if (Number.isFinite(Date.parse(value[key]))) result[key] = new Date(value[key]).toISOString();
  result.outcome = ['success', 'cancelled'].includes(value.outcome) ? value.outcome : 'failed';
  result.resolverVersion = resolverVersion(value.resolverVersion);
  result.failureCode = CODES.has(value.failureCode) ? value.failureCode : '';
  result.cookieState = value.pluginDouyinLogin === true || value.cookieState === 'saved-unverified' ? 'saved-unverified' : value.cookieState === 'unknown' ? 'unknown' : 'not-found';
  result.sourceKind = safeUrlKind(value.sourceKind);
  result.resolvedKind = safeUrlKind(value.resolvedKind);
  result.targetIdRecognized = value.targetIdRecognized === true;
  result.targetIdState = ['recognized', 'missing', 'unknown'].includes(value.targetIdState)
    ? value.targetIdState
    : (Object.prototype.hasOwnProperty.call(value, 'targetIdRecognized')
      ? normalizeTargetIdState(value.targetIdRecognized)
      : 'unknown');
  result.targetStageEligible = value.targetStageEligible === true;
  result.debuggerCapability = safeDebuggerCapability(value.debuggerCapability);
  result.debuggerReason = safeDebuggerReason(value.debuggerReason);
  const rawStages = (Array.isArray(value.stages) ? value.stages : []).filter(s => s && typeof s === 'object');
  const localStagesOmitted = Math.max(0, rawStages.length - 16);
  const inheritedStagesOmitted = safeCount(value.stagesOmittedCount);
  result.stages = rawStages.slice(-16).map(s => ({
    stage: token(s.stage),
    resolverVersion: resolverVersion(s.resolverVersion),
    inputKind: safeInputKind(s.inputKind),
    sourceKind: safeUrlKind(s.sourceKind),
    resolvedKind: safeUrlKind(s.resolvedKind),
    targetIdRecognized: s.targetIdRecognized === true,
    targetIdState: ['recognized', 'missing', 'unknown'].includes(s.targetIdState)
      ? s.targetIdState
      : (Object.prototype.hasOwnProperty.call(s, 'targetIdRecognized')
        ? normalizeTargetIdState(s.targetIdRecognized)
        : 'unknown'),
    targetStageEligible: s.targetStageEligible === true,
    attempted: s.attempted !== false,
    ok: s.ok === true,
    mediaCount: integer(s.mediaCount),
    durationMs: integer(s.durationMs),
    rejectionReason: token(s.rejectionReason),
    error: sanitizeStageError(s.error),
  }));
  const stagesOmittedCount = inheritedStagesOmitted + localStagesOmitted;
  const sourceMessageOmitted = safeCount(value.messageOmittedBytes);
  const stageMessageOmitted = result.stages.reduce((total, stage) => total + safeCount(stage.error && stage.error.messageOmittedBytes), 0);
  const messageOmittedBytes = Math.max(sourceMessageOmitted, stageMessageOmitted);
  if (stagesOmittedCount) result.stagesOmittedCount = stagesOmittedCount;
  if (messageOmittedBytes) result.messageOmittedBytes = messageOmittedBytes;
  if (value.truncated === true || stagesOmittedCount || messageOmittedBytes) result.truncated = true;
  return result;
}
function read(root) {
  try { const file = path.join(root, 'douyin-resolution-diagnostic.json'); if (fs.statSync(file).size > 128 * 1024) return []; const rows = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(rows) ? rows.slice(-5).map(sanitize) : []; } catch (_) { return []; }
}
function save(root, value) {
  const row = sanitize(value);
  try { fs.mkdirSync(root, { recursive: true }); const file = path.join(root, 'douyin-resolution-diagnostic.json'); const temp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp'; fs.writeFileSync(temp, JSON.stringify([...read(root).filter(x => x.attemptId !== row.attemptId), row].slice(-5))); fs.renameSync(temp, file); } catch (_) { /* Preserve the processing outcome if diagnostic storage is unavailable. */ }
  return row;
}
module.exports = {
  classifyResolverError,
  failureCode,
  failureMessage,
  sanitize,
  read,
  save,
  safeErrorText,
  urlKind: getDouyinUrlKind,
  noteRoute: getTrustedDouyinNoteRoute,
  normalizeUrlKind: safeUrlKind,
  normalizeInputKind: safeInputKind,
  normalizeTargetIdState,
  normalizeDebuggerCapability: safeDebuggerCapability,
  normalizeDebuggerReason: safeDebuggerReason,
};
