'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { diagnosticRedact } = require('./asr-recovery-utils');
function safeErrorText(value, settings = {}) {
  const text = String(value || '');
  if (text.length > 16384) return '[oversized error omitted]';
  return diagnosticRedact(text, settings)
    .replace(/(["']?(?:sessionid(?:_ss)?|sid_guard|ttwid|msToken|cookie|authorization|token|password|secret|api[_-]?key)["']?\s*[=:]\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/\s+/g, ' ').slice(0, 480);
}
const CODES = new Set(['DOUYIN_CANCELLED', 'DOUYIN_FETCH_FAILED', 'DOUYIN_CHALLENGE', 'DOUYIN_COOKIE_REFRESH_REQUIRED', 'DOUYIN_LOGIN_REQUIRED', 'DOUYIN_RESOLVER_NETWORK', 'DOUYIN_RESOLVER_FAILED', 'DOUYIN_NO_MEDIA', 'DOUYIN_BROWSER_TIMEOUT', 'DOUYIN_BROWSER_RENDERER_GONE', 'DOUYIN_BROWSER_CLOSED', 'DOUYIN_BROWSER_COOLDOWN', 'DOUYIN_BROWSER_LOAD_FAILED']);
function classifyResolverError(error) {
  const text = String(error && error.message || error || '');
  const code = /captcha|安全验证|请完成验证|risk[-_ ]control/i.test(text) ? 'DOUYIN_CHALLENGE'
    : /fresh cookies|cookies are needed/i.test(text) ? 'DOUYIN_COOKIE_REFRESH_REQUIRED'
    : /login required|sign in|authentication required/i.test(text) ? 'DOUYIN_LOGIN_REQUIRED'
    : /timed? ?out|timeout|ENOTFOUND|ECONN|certificate|HTTP Error [45]\d\d/i.test(text) ? 'DOUYIN_RESOLVER_NETWORK'
    : 'DOUYIN_RESOLVER_FAILED';
  return { code, exitCode: Number.isInteger(error && error.exitCode) ? error.exitCode : null };
}
function failureCode(stages = []) {
  const codes = stages.filter(s => s && s.ok === false).map(s => s.error && (s.error.browserCode || s.error.code)).filter(Boolean);
  // A generic resolver cookie request is not evidence of a CAPTCHA.
  return ['DOUYIN_CHALLENGE', 'DOUYIN_LOGIN_REQUIRED', 'DOUYIN_BROWSER_RENDERER_GONE', 'DOUYIN_BROWSER_LOAD_FAILED', 'DOUYIN_BROWSER_TIMEOUT', 'DOUYIN_COOKIE_REFRESH_REQUIRED', 'DOUYIN_RESOLVER_NETWORK', 'DOUYIN_BROWSER_CLOSED', 'DOUYIN_BROWSER_COOLDOWN', 'DOUYIN_RESOLVER_FAILED'].find(code => codes.includes(code)) || 'DOUYIN_NO_MEDIA';
}
function failureMessage(code) {
  return ({
    DOUYIN_CHALLENGE: '抖音解析返回安全验证要求，请打开插件内抖音窗口完成验证后重试。',
    DOUYIN_COOKIE_REFRESH_REQUIRED: '抖音解析器要求更新 Cookie，尚不能确认登录失效或验证码；请在插件内打开抖音确认访问状态。',
    DOUYIN_LOGIN_REQUIRED: '抖音解析器返回登录要求，请在插件内确认登录后重试。',
    DOUYIN_BROWSER_TIMEOUT: '抖音隐藏网页处理超时，尚未获取视频地址；请复制诊断查看停滞阶段。',
    DOUYIN_BROWSER_LOAD_FAILED: '抖音网页加载失败，网络错误已记录；请复制诊断查看原因。',
    DOUYIN_BROWSER_RENDERER_GONE: '抖音网页解析进程异常退出，已记录退出原因；请重启 Obsidian 后重试。',
    DOUYIN_BROWSER_CLOSED: '抖音解析窗口提前关闭，请重试。',
    DOUYIN_BROWSER_COOLDOWN: '抖音网页刚发生异常，正在短暂冷却，请稍后重试。',
    DOUYIN_RESOLVER_NETWORK: '抖音解析器网络访问失败，已保留分阶段诊断。',
    DOUYIN_RESOLVER_FAILED: '抖音本地解析器失败，暂未确认具体原因，请复制详细诊断。',
  })[code] || '未能从抖音作品页获取到可用的音频或视频地址，请复制诊断查看各解析路径结果。';
}
const token = value => /^[a-zA-Z0-9_.:-]{1,80}$/.test(value || '') ? value : '';
const integer = value => Number.isSafeInteger(value) ? Math.max(0, Math.min(value, 1e12)) : 0;
function sanitize(value = {}) {
  const result = { source: 'douyin-resolution', schema: 1 };
  for (const key of ['attemptId', 'recordRef']) result[key] = /^[a-f0-9]{16,32}$/.test(value[key] || '') ? value[key] : '';
  for (const key of ['startedAt', 'finishedAt']) if (Number.isFinite(Date.parse(value[key]))) result[key] = new Date(value[key]).toISOString();
  result.outcome = ['success', 'cancelled'].includes(value.outcome) ? value.outcome : 'failed';
  result.failureCode = CODES.has(value.failureCode) ? value.failureCode : '';
  result.cookieState = value.pluginDouyinLogin === true || value.cookieState === 'saved-unverified' ? 'saved-unverified' : 'not-found';
  result.stages = (Array.isArray(value.stages) ? value.stages : []).filter(s => s && typeof s === 'object').slice(-16).map(s => ({ stage: token(s.stage), inputKind: token(s.inputKind), attempted: s.attempted !== false, ok: s.ok === true, mediaCount: integer(s.mediaCount), durationMs: integer(s.durationMs), rejectionReason: token(s.rejectionReason), error: s.error ? { code: token(s.error.code), browserCode: token(s.error.browserCode), status: integer(s.error.status), exitCode: Number.isInteger(s.error.exitCode) ? s.error.exitCode : null, message: safeErrorText(s.error.message) } : undefined }));
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
module.exports = { classifyResolverError, failureCode, failureMessage, sanitize, read, save, safeErrorText };
