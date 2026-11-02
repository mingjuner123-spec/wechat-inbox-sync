'use strict';

// Only existing machine codes are promoted. Never index raw messages, paths,
// URLs or arbitrary nested data. Categories and business decisions stay intact.
const FAILURE_DETAILS = Object.freeze({
  PRO_REQUIRED: ['本次处理未通过 Pro 权益校验。', '请核对当前绑定对应的 Pro 权益；已开通请检查绑定和权益状态，不要重复购买。'],
  XIAOHONGSHU_PRO_REQUIRED: ['本次小红书处理未通过 Pro 权益校验。', '请核对当前绑定对应的 Pro 权益；已开通请检查绑定和权益状态，不要重复购买。'],
  LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED: ['本地转写未通过会员权益校验。', '请在插件设置中检查当前绑定和权益状态；已开通不要重复购买。'],
  LOCAL_TRANSCRIPTION_BINDING_REQUIRED: ['本地转写需要有效绑定。', '请在插件设置中检查当前绑定状态后重试，不要提交绑定令牌。'],
  LOCAL_COMPONENT_SETUP_REQUIRED: ['本地转写组件尚未就绪。', '请在插件设置中完成所需组件安装或修复后重试。'],
  NODE_HTTP_TIMEOUT: ['处理所需的网络请求超时。', '请在网络恢复后重试；若持续失败，保留此任务编号排查请求环节，无需因此重装转写组件。'],
  MEDIA_DOWNLOAD_INTERRUPTED: ['媒体下载中断，未完成下载。', '请在网络恢复后重试；仍失败时保留任务编号排查媒体链接与下载环节。'],
  ERR_SSL_BAD_PACKET_LENGTH: ['下载连接的 TLS 通信失败。', '请检查当前网络或代理后重试，保留安全证书校验。'],
  DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED: ['当前处理路径未能处理这条抖音图文。', '新版插件已支持抖音图文，请检查更新后重试；已是最新版仍失败时，保留任务编号排查图文识别路径。'],
  DOUYIN_BROWSER_COOLDOWN: ['抖音浏览器处理处于冷却状态。', '请等待冷却结束后再试，避免连续重复提交；这不等于未登录。'],
  DOUYIN_NO_MEDIA: ['未获得与这条抖音内容匹配的媒体。', '请确认原内容仍可打开；若可以，保留任务编号排查提取路径，不要仅因此重装转写组件。'],
  XIAOHONGSHU_CONTENT_UNAVAILABLE: ['未取得这条小红书内容。', '请确认原内容仍可打开；可正常打开时保留任务编号排查提取路径。'],
  WECHAT_ARTICLE_BODY_MISSING: ['未取得公众号文章正文。', '请确认原文可打开，并在插件中检查公众号访问验证；仍失败时保留任务编号。'],
  CHANNELS_OPERATION_FAILED: ['视频号处理操作未完成。', '请保留任务编号排查具体操作环节，不要反复重新提交。'],
  CLOUD_FALLBACK_FAILED: ['本次云端兜底处理失败，尚未交付结果。', '请保留任务编号查看后续处理；无需因此重装自己电脑的转写组件。'],
  CLOUD_MEDIA_UPLOAD_TIMEOUT: ['发送媒体到云端的请求超时。', '请保留任务编号排查上传连接；这不是本地转写组件安装失败，无需因此重装组件。'],
});
const DETAIL_CODES = new Set(Object.keys(FAILURE_DETAILS));
const VERSION_CODES = new Set(['PLUGIN_UPDATE_REQUIRED', 'PLUGIN_VERSION_MISMATCH', 'PLUGIN_VERSION_UNSUPPORTED']);
const codeOf = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function selectFailureDetail(error = {}) {
  const diagnostic = object(error.diagnostic);
  const media = object(error.mediaResolutionDiagnostic || diagnostic.mediaResolutionDiagnostic || diagnostic);
  const top = codeOf(error.code);
  // A cloud failure must not be relabelled as the end user's local failure.
  if (VERSION_CODES.has(top) || /^CLOUD_/.test(top) && DETAIL_CODES.has(top)) return top;
  const candidates = [top, codeOf(diagnostic.errorCode), codeOf(diagnostic.failureCode),
    codeOf(diagnostic.code), codeOf(media.failureCode), codeOf(media.errorCode), codeOf(object(media.failure).code)];
  return candidates.find(code => VERSION_CODES.has(code)) || candidates.find(code => DETAIL_CODES.has(code)) || '';
}

function observedFailureStage(error = {}, fallback = 'sync') {
  if (/^CLOUD_/.test(codeOf(error.code))) return fallback;
  const diagnostic = object(error.diagnostic);
  const media = object(error.mediaResolutionDiagnostic || diagnostic.mediaResolutionDiagnostic || diagnostic);
  const map = { prepare: 'fetch', download: 'fetch', fetch: 'fetch', fetching: 'fetch', parse: 'parse',
    transcribe: 'transcribe', transcription: 'transcribe', ocr: 'ocr', write: 'write', writeFile: 'write', upload: 'upload', auth: 'auth' };
  for (const value of [object(media.failure).stage, diagnostic.failureStage, error.stage]) {
    if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(map, value)) return map[value];
  }
  return fallback;
}

function failureGuidance(code) {
  const detail = FAILURE_DETAILS[codeOf(code)];
  if (!detail) return null;
  return { reason: detail[0], nextStep: detail[1], reasonCode: `detail_${codeOf(code).toLowerCase()}`, evidenceSufficiency: 'observed' };
}
function failureMessage(error) {
  const guidance = failureGuidance(selectFailureDetail(error));
  return guidance ? `${guidance.reason}${guidance.nextStep}` : '';
}

// Legacy clients already attach this report. Read only its documented failure
// object; do not search raw text or unrelated attempts for plausible reasons.
function reportedFailureDetail(event = {}) {
  if (event.outcome === 'succeeded') return '';
  const top = codeOf(event.errorCode);
  if (VERSION_CODES.has(top) || DETAIL_CODES.has(top)) return top;
  const report = object(event.technicalReport);
  if (report.kind !== 'sync_failure' || report.truncated === true || typeof report.text !== 'string'
    || Buffer.byteLength(report.text, 'utf8') > 128 * 1024) return '';
  try {
    const parsed = JSON.parse(report.text);
    if (parsed.kind !== 'sync_failure' || parsed.schemaVersion !== 1) return '';
    return selectFailureDetail(object(parsed.failure));
  } catch (_) { return ''; }
}
module.exports = { DETAIL_CODES, selectFailureDetail, observedFailureStage, failureGuidance, failureMessage, reportedFailureDetail };
