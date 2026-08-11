'use strict';

const SYNC_LIFECYCLE_FAILURE_MESSAGES = Object.freeze({
  UNSUPPORTED_PLATFORM: '\u6682\u4e0d\u652f\u6301\u6b64\u5e73\u53f0',
  NETWORK_FAILED: '\u7f51\u7edc\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u65b0\u540c\u6b65',
  EXTRACTION_FAILED: '\u5185\u5bb9\u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
  TRANSCRIPTION_FAILED: '\u97f3\u89c6\u9891\u8f6c\u5199\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
  OCR_FAILED: '\u56fe\u7247\u6587\u5b57\u8bc6\u522b\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
  LOCAL_COMPONENT_UNAVAILABLE: '\u672c\u5730\u8f6c\u5199\u7ec4\u4ef6\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5\u540e\u91cd\u65b0\u540c\u6b65',
  WRITE_FAILED: '\u5199\u5165 Obsidian \u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
  SYNC_FAILED: '\u540c\u6b65\u5904\u7406\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
});

function sanitizeSyncNoteTitle(value) {
  const source = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const basename = source.split(/[\\/]/).pop() || '';
  return basename.replace(/\.md$/i, '').trim().slice(0, 200);
}

function getSyncNoteTitleFromPath(filePath) {
  return sanitizeSyncNoteTitle(String(filePath || '').split(/[\\/]/).pop() || '');
}

function categorizeSyncFailure(error) {
  const code = String(error && error.code || '').trim().toUpperCase();
  const message = String(error && error.message || error || '').trim().toUpperCase();
  if (code === 'UNSUPPORTED_PLATFORM'
    || /UNSUPPORTED_(?:PLATFORM|RECORD_TYPE|SITE)/.test(code)
    || /UNSUPPORTED (?:PLATFORM|RECORD TYPE|SITE)/.test(message)
    || /\u6682\u4e0d\u652f\u6301\u6b64\u5e73\u53f0|\u4e0d\u652f\u6301(?:\u6b64|\u8be5)?\u5e73\u53f0/.test(message)) {
    return 'UNSUPPORTED_PLATFORM';
  }
  if (/NETWORK|TIMEOUT|ECONN|ENOTFOUND|FETCH/.test(code)
    || /NETWORK|TIMEOUT|ECONN|ENOTFOUND|FETCH/.test(message)) return 'NETWORK_FAILED';
  if (/LOCAL_COMPONENT|COMPONENT_UNAVAILABLE/.test(code)) return 'LOCAL_COMPONENT_UNAVAILABLE';
  if (/OCR/.test(code) || /OCR|\u6587\u5b57\u8bc6\u522b/.test(message)) return 'OCR_FAILED';
  if (/TRANSCR|ASR|AUDIO|VOICE/.test(code) || /TRANSCR|ASR|\u8f6c\u5199|\u97f3\u9891|\u8bed\u97f3/.test(message)) {
    return 'TRANSCRIPTION_FAILED';
  }
  if (/WRITE|VAULT|NOTE|FILE_SAVE/.test(code) || /WRITE|VAULT|NOTE|\u5199\u5165|\u7b14\u8bb0/.test(message)) {
    return 'WRITE_FAILED';
  }
  if (/EXTRACT|XIAOHONGSHU|WEBPAGE|HTML|LINK/.test(code) || /EXTRACT|\u63d0\u53d6|\u7f51\u9875|\u5c0f\u7ea2\u4e66/.test(message)) {
    return 'EXTRACTION_FAILED';
  }
  return 'SYNC_FAILED';
}

function createSyncLifecycleOutcomeError(code, message) {
  const error = new Error(String(message || '同步处理失败'));
  error.code = String(code || 'SYNC_FAILED').trim().toUpperCase() || 'SYNC_FAILED';
  return error;
}

function getMeaningfulMarkdownLength(markdown) {
  return String(markdown || '')
    .replace(/!\[[^\]]*\]\([^)]+\)|!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s`#>*_\-|[\](){},.!?:;\u3000\uff0c\u3002\uff01\uff1f\uff1a\uff1b\u3001\u201c\u201d\u2018\u2019\u2026\u00b7]+/g, '')
    .length;
}

function isLikelyWebpageShell(url, markdown) {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;
  const text = String(markdown || '');
  if (/微信扫一扫可打开此内容|当前已为你保存原始链接|仅保存原始链接|正文提取失败|内容解析失败/.test(text)) {
    return true;
  }
  const shellPatterns = [
    /请(?:先)?登录.{0,16}(?:查看|继续|访问|阅读)/,
    /登录后.{0,16}(?:查看|继续|访问|阅读)/,
    /打开.{0,20}(?:APP|客户端|今日头条|抖音|小红书|微信).{0,20}(?:查看|阅读|继续|更多)/i,
    /访问(?:受限|异常|过于频繁)/,
    /完成验证后.{0,12}(?:继续|访问)/,
    /内容(?:不存在|已删除|暂时无法查看|加载失败)/,
  ];
  const signalCount = shellPatterns.filter((pattern) => pattern.test(text)).length;
  const meaningfulLength = getMeaningfulMarkdownLength(text);
  return signalCount >= 2 || (signalCount >= 1 && meaningfulLength < 160);
}

function getSyncLifecycleOutcomeError(record) {
  const source = record && typeof record === 'object' ? record : {};
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const conversionStatus = String(metadata.conversionStatus || '').trim().toLowerCase();
  const transcriptionStatus = String(metadata.transcriptionStatus || '').trim().toLowerCase();
  const transcription = String(metadata.transcription || '').trim();
  const url = String(metadata.url || source.content || '').trim().toLowerCase();
  const fileExt = String(metadata.fileExt || '').trim().toLowerCase().replace(/^\./, '');
  const markdown = [
    metadata.convertedMarkdown,
    metadata.markdown,
    metadata.snapshot,
    metadata.contentSnapshot,
  ].map((value) => String(value || '').trim()).filter(Boolean).join('\n');
  const declaredError = `${metadata.conversionError || ''} ${metadata.transcriptionError || ''}`.trim();
  const meaningfulLength = getMeaningfulMarkdownLength(markdown);
  const hasUsableOutput = meaningfulLength >= 40 || transcription.length >= 20;
  const hasDeclaredFailureState = ['failed', 'link_saved', 'wechat_captcha'].includes(conversionStatus)
    || transcriptionStatus === 'failed';

  if ((/weixin\.qq\.com\/sph\//.test(url)
      && (['failed', 'link_saved'].includes(conversionStatus) || transcriptionStatus === 'failed'))
    || (/UNSUPPORTED (?:PLATFORM|RECORD TYPE|SITE)|暂不支持(?:此|该)?平台|不支持(?:此|该)?平台/i.test(declaredError)
      && (hasDeclaredFailureState || (conversionStatus !== 'success' && !hasUsableOutput)))) {
    return createSyncLifecycleOutcomeError('UNSUPPORTED_PLATFORM', '暂不支持此平台');
  }

  if (conversionStatus === 'wechat_captcha') {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '公众号正文提取失败：微信安全验证拦截');
  }

  if (/mp\.weixin\.qq\.com\//.test(url)
    && /微信扫一扫可打开此内容/.test(markdown)
    && /使用完整服务|使用小程序/.test(markdown)) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '公众号正文提取失败：微信仅返回打开引导页');
  }

  if (isLikelyWebpageShell(url, markdown)) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '内容解析失败：仅获取到打开或登录引导页');
  }

  if (fileExt === 'pdf' && conversionStatus === 'attachment_saved') {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', 'PDF 内容提取失败');
  }

  if (transcriptionStatus === 'failed' && !transcription) {
    return createSyncLifecycleOutcomeError('TRANSCRIPTION_FAILED', '音视频转写失败');
  }

  if (['failed', 'link_saved'].includes(conversionStatus)) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '内容解析失败');
  }

  return null;
}

function getHttpStatusFromError(error) {
  return Number(error && (error.status || error.statusCode || (error.response && error.response.status))) || 0;
}

function isLegacySyncLifecycleError(error) {
  return [404, 405].includes(getHttpStatusFromError(error));
}

function isSyncRecordBusyError(error) {
  const code = String(error && error.code || '').toUpperCase();
  return getHttpStatusFromError(error) === 409 || ['RECORD_BUSY', 'ATTEMPT_CONFLICT'].includes(code);
}

module.exports = {
  SYNC_LIFECYCLE_FAILURE_MESSAGES,
  categorizeSyncFailure,
  getSyncLifecycleOutcomeError,
  getSyncNoteTitleFromPath,
  isLegacySyncLifecycleError,
  isSyncRecordBusyError,
  sanitizeSyncNoteTitle,
};
