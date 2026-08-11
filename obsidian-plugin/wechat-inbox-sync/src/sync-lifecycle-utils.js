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
  getSyncNoteTitleFromPath,
  isLegacySyncLifecycleError,
  isSyncRecordBusyError,
  sanitizeSyncNoteTitle,
};
