'use strict';
const { isWechatArticleFailurePlaceholder } = require('./wechat-placeholder-utils');
const { isRecognizedNoSpeechMetadata } = require('./transcription-quality-utils');
const { isPlatformArticleUrl, hasPlatformArticleBody, sanitizePlatformArticleDiagnostic } = require('./platform-article-utils');
const { isXUrl } = require('./x-article');

const crypto = require('node:crypto');
const channelsDiagnostic = require('./wechat-channels-diagnostic-utils');

const SYNC_LIFECYCLE_FAILURE_MESSAGES = Object.freeze({
  CLOUD_FALLBACK_DISABLED: "本地提取失败，云端兜底未开启；请在插件设置中开启后重试。",
  CLOUD_FALLBACK_BINDING_REQUIRED: "云端兜底未提交，请先完成小程序与插件绑定。",
  LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED: "当前 Pro 权益未确认有效，请在插件刷新权限并核对有效期。",
  LOCAL_TRANSCRIPTION_BINDING_REQUIRED: "请先完成小程序与插件绑定，再重新同步。",
  LOCAL_COMPONENT_SETUP_REQUIRED: "本地转写组件未就绪，请在插件设置安装或更新组件后重试。",
  DOUYIN_LOGIN_REQUIRED: "请在插件设置中登录抖音后重试。",
  DOUYIN_RESOLVER_NOT_INSTALLED: "抖音解析组件未就绪，请在插件设置安装或更新组件后重试。",
  CLOUD_FALLBACK_SUBMIT_FAILED: "本地提取失败，云端兜底暂未接收任务；请保持插件联网，稍后重试。",
  // Preserve safe, machine-readable failure causes through the lifecycle API.
  // The mini-program uses these codes to show a precise recovery step.
  CLOUD_FALLBACK_FAILED: '\u4e91\u7aef\u515c\u5e95\u5904\u7406\u5931\u8d25\uff0c\u5c1a\u672a\u4ea4\u4ed8\u7ed3\u679c',
  NODE_HTTP_TIMEOUT: '\u8bf7\u6c42\u5904\u7406\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
  MEDIA_DOWNLOAD_INTERRUPTED: '\u5a92\u4f53\u4e0b\u8f7d\u4e2d\u65ad\uff0c\u8bf7\u5728\u7f51\u7edc\u7a33\u5b9a\u540e\u91cd\u8bd5',
  CHANNELS_OPERATION_FAILED: '\u89c6\u9891\u53f7\u5904\u7406\u672a\u5b8c\u6210',
  DOUYIN_NO_MEDIA: '\u672a\u83b7\u5f97\u4e0e\u8fd9\u6761\u6296\u97f3\u5185\u5bb9\u5339\u914d\u7684\u5a92\u4f53',
  WECHAT_ARTICLE_BODY_MISSING: '\u672a\u83b7\u53d6\u516c\u4f17\u53f7\u6587\u7ae0\u6b63\u6587',
  XIAOHONGSHU_CONTENT_UNAVAILABLE: '\u672a\u83b7\u53d6\u8fd9\u6761\u5c0f\u7ea2\u4e66\u5185\u5bb9',
  UNSUPPORTED_PLATFORM: '\u6682\u4e0d\u652f\u6301\u6b64\u5e73\u53f0',
  NETWORK_FAILED: '\u7f51\u7edc\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u65b0\u540c\u6b65',
  EXTRACTION_FAILED: '\u5185\u5bb9\u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
  TRANSCRIPTION_FAILED: '\u97f3\u89c6\u9891\u8f6c\u5199\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
  OCR_FAILED: '\u56fe\u7247\u6587\u5b57\u8bc6\u522b\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
  LOCAL_COMPONENT_UNAVAILABLE: '\u672c\u5730\u8f6c\u5199\u7ec4\u4ef6\u4e0d\u53ef\u7528\uff0c\u8bf7\u68c0\u67e5\u540e\u91cd\u65b0\u540c\u6b65',
  WRITE_FAILED: '\u5199\u5165 Obsidian \u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
  SYNC_FAILED: '\u540c\u6b65\u5904\u7406\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u540c\u6b65',
});

const MAX_PENDING_SYNC_LIFECYCLE_ATTEMPTS = 100;
const MAX_COMPLETED_SYNC_RECEIPTS = 500;

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
  const fallbackCode = error && error.diagnostic && error.diagnostic.cloudFallback && error.diagnostic.cloudFallback.code;
  if (fallbackCode && Object.prototype.hasOwnProperty.call(SYNC_LIFECYCLE_FAILURE_MESSAGES, fallbackCode)) return fallbackCode;
  if (Object.prototype.hasOwnProperty.call(SYNC_LIFECYCLE_FAILURE_MESSAGES, code)) return code;
  // Xiaohongshu records are webpage extractions first. The mini program tags
  // every xhslink.com/a/ share as audio_video, so a wall, an unavailable note or
  // an unresolved media candidate can carry transcription-shaped wording while
  // nothing was transcribed. Never report those as a transcription failure.
  if (/^XIAOHONGSHU_/.test(code)) {
    return code === 'XIAOHONGSHU_PRO_REQUIRED' ? 'SYNC_FAILED' : 'EXTRACTION_FAILED';
  }
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

function normalizeLifecycleTimestamp(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  const timestamp = new Date(source);
  return Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString();
}

function normalizePendingSyncLifecycleAttempts(value) {
  const byIdentity = new Map();
  for (const source of Array.isArray(value) ? value : []) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const recordId = String(source.recordId || '').trim().slice(0, 128);
    const attemptId = String(source.attemptId || '').trim();
    const bindingFingerprint = String(source.bindingFingerprint || '').trim().toLowerCase();
    const stage = String(source.stage || '').trim().toLowerCase();
    if (!recordId
      || !/^[A-Za-z0-9_-]{8,128}$/.test(attemptId)
      || !/^[a-f0-9]{16,64}$/.test(bindingFingerprint)
      || !['processing', 'failed', 'committed', 'cloud-fallback'].includes(stage)) continue;
    const normalized = {
      recordId,
      attemptId,
      bindingFingerprint,
      stage,
      code: stage === 'failed'
        ? String(source.code || 'SYNC_FAILED').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 64) || 'SYNC_FAILED'
        : '',
      noteTitle: stage === 'committed' ? sanitizeSyncNoteTitle(source.noteTitle) : '',
      createdAt: normalizeLifecycleTimestamp(source.createdAt),
      updatedAt: normalizeLifecycleTimestamp(source.updatedAt),
    };
    if (!normalized.code) delete normalized.code;
    if (!normalized.noteTitle) delete normalized.noteTitle;
    byIdentity.set(`${bindingFingerprint}:${recordId}`, normalized);
  }
  return [...byIdentity.values()].slice(-MAX_PENDING_SYNC_LIFECYCLE_ATTEMPTS);
}

function normalizeCompletedSyncReceipts(value) {
  const byIdentity = new Map();
  for (const source of Array.isArray(value) ? value : []) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const recordId = String(source.recordId || '').trim().slice(0, 128);
    const bindingFingerprint = String(source.bindingFingerprint || '').trim().toLowerCase();
    if (!recordId || !/^[a-f0-9]{16,64}$/.test(bindingFingerprint)) continue;
    const normalized = {
      recordId,
      bindingFingerprint,
      noteTitle: sanitizeSyncNoteTitle(source.noteTitle),
      completedAt: normalizeLifecycleTimestamp(source.completedAt),
    };
    if (!normalized.noteTitle) delete normalized.noteTitle;
    byIdentity.set(`${bindingFingerprint}:${recordId}`, normalized);
  }
  return [...byIdentity.values()].slice(-MAX_COMPLETED_SYNC_RECEIPTS);
}

function getSyncLifecycleBindingFingerprint(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 32);
}

function createSyncLifecycleOutcomeError(code, message, diagnostic = null) {
  const error = new Error(String(message || '同步处理失败'));
  error.code = String(code || 'SYNC_FAILED').trim().toUpperCase() || 'SYNC_FAILED';
  if (diagnostic && typeof diagnostic === 'object') {
    error.diagnostic = diagnostic;
  }
  return error;
}

// "内容解析失败" alone cannot tell captcha from an empty page or an HTTP
// rejection. Keep the facts that separate them with the failure.
function buildWebpageExtractionFailureDiagnostic(source, metadata, markdown) {
  const url = String(metadata.url || source.content || '').trim();
  let host = '';
  try { host = new URL(url).hostname.slice(0, 80); } catch (_error) { /* keep empty */ }
  const conversionDiagnostic = metadata.conversionDiagnostic && typeof metadata.conversionDiagnostic === 'object'
    ? metadata.conversionDiagnostic
    : {};
  const httpStatus = Number(metadata.httpStatus || conversionDiagnostic.status || conversionDiagnostic.httpStatus);
  const xArticleErrorCode = String(metadata.xArticleErrorCode || '').trim();
  const xSyndicationErrorCode = String(metadata.xSyndicationErrorCode || '').trim();
  const xProvider = String(metadata.xArticleProvider || '').trim();
  return {
    source: 'webpage-extraction',
    host,
    conversionStatus: String(metadata.conversionStatus || '').trim().toLowerCase(),
    transcriptionStatus: String(metadata.transcriptionStatus || '').trim().toLowerCase(),
    markdownChars: String(markdown || '').length,
    ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? { httpStatus } : {}),
    ...(xArticleErrorCode ? { xArticleErrorCode } : {}),
    ...(xSyndicationErrorCode ? { xSyndicationErrorCode } : {}),
    ...(xProvider ? { xArticleProvider: xProvider } : {}),
    finalKind: String(conversionDiagnostic.finalKind || '').slice(0, 40),
    finalState: String(conversionDiagnostic.finalState || '').slice(0, 40),
    note: String(metadata.conversionNote || metadata.conversionError || '').slice(0, 200),
    ...(sanitizePlatformArticleDiagnostic(conversionDiagnostic) || {}),
    ...(require('./fallback-decision').sanitizeFallbackDecision(conversionDiagnostic.cloudFallback)
      ? { cloudFallback: require('./fallback-decision').sanitizeFallbackDecision(conversionDiagnostic.cloudFallback) } : {}),
  };
}

function buildPdfExtractionFailureDiagnostic(metadata = {}) {
  const source = metadata.pdfExtractionDiagnostic && typeof metadata.pdfExtractionDiagnostic === 'object'
    ? metadata.pdfExtractionDiagnostic
    : {};
  const diagnostic = {
    kind: 'pdf-extraction',
  };
  const errorCode = String(metadata.pdfExtractionErrorCode || '').trim();
  if (errorCode) diagnostic.errorCode = errorCode;
  const provider = String(source.provider || '').trim();
  if (provider) diagnostic.provider = provider;
  ['pageCount'].forEach((key) => {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) diagnostic[key] = value;
  });
  ['textPageNumbers', 'ocrPageNumbers', 'missingPageNumbers'].forEach((key) => {
    if (!Array.isArray(source[key])) return;
    diagnostic[key] = source[key]
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 200);
  });
  const fastPathError = String(source.fastPathError || '').trim();
  if (fastPathError) diagnostic.fastPathError = fastPathError.slice(0, 500);
  return diagnostic;
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
  if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(String(url || '')) && isWechatArticleFailurePlaceholder(text)) return true;
  if (/微信扫一扫可打开此内容|当前已为你保存原始链接|仅保存原始链接/.test(text)) {
    return true;
  }
  const wechatEmptyShellPatterns = [
    /\u89c6\u9891\s*\u5c0f\u7a0b\u5e8f\s*\u8d5e/,
    /\u8f7b\u70b9\u4e24\u4e0b\u53d6\u6d88\u8d5e/,
  ];
  const shellPatterns = [
    /请(?:先)?登录.{0,16}(?:查看|继续|访问|阅读)/,
    /登录后.{0,16}(?:查看|继续|访问|阅读)/,
    /打开.{0,20}(?:APP|客户端|今日头条|抖音|小红书|微信).{0,20}(?:查看|阅读|继续|更多)/i,
    /(?:请)?在.{0,20}(?:APP|客户端).{0,12}(?:查看|阅读).{0,8}(?:完整)?内容/i,
    /访问(?:受限|异常|过于频繁)/,
    /完成验证后.{0,12}(?:继续|访问)/,
    /内容(?:不存在|已删除|暂时无法查看|加载失败)/,
    /(?:正文提取失败|内容解析失败)(?:[：:，,。]|$)/,
  ];
  const signalCount = shellPatterns.filter((pattern) => pattern.test(text)).length;
  const isWechatEmptyShell = /mp\.weixin\.qq\.com\//.test(String(url || ''))
    && wechatEmptyShellPatterns.some((pattern) => pattern.test(text));
  const meaningfulLength = getMeaningfulMarkdownLength(text);
  return isWechatEmptyShell || signalCount >= 2 || (signalCount >= 1 && meaningfulLength < 160);
}

function getMarkdownBody(markdown) {
  return String(markdown || '')
    .replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/<!--\s*wechat-inbox-record-id\s*:[\s\S]*?-->/gi, '')
    .trim();
}

function hasXArticleBody(markdown, metadata = {}) {
  const body = getMarkdownBody(markdown);
  const comparableText = value => String(value || '').replace(/https?:\/\/\S+/gi, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const originalText = String(metadata && metadata.xOriginalText || '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim();
  const markdownTitle = (body.match(/^#\s+X[：:]\s*([^\r\n]+)/im) || [])[1] || '';
  const metadataTitle = String(metadata && (metadata.xOriginalTitle || metadata.title) || markdownTitle).split('：').slice(-1)[0].trim();
  const isShell = value => /^(?:read more|continue reading|view more|view on x|show more|see more|more\.\.\.|阅读全文|继续阅读|查看更多|显示更多)[.!…\s→➜➔›»]*$/i.test(String(value || '').trim());
  if (originalText && !isShell(originalText) && comparableText(originalText) !== comparableText(metadataTitle)) return true;
  const hasImage = /!\[[^\]\n]*\]\(\s*https?:\/\/pbs\.twimg\.com\/media\//i.test(body);
  if (hasImage) return true;
  const sections = body.split(/(?=^#{1,6}\s)/m).filter((section) => /^## (?:正文|视频转写)\s*$/m.test(section));
  return sections.some((section) => {
    const content = section
      .replace(/^\s*#{1,6}\s+[^\n]*\r?\n/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/^\s*(?:来源|原始链接|source\s*url)\s*[：:]\s*https?:\/\/\S+\s*$/gim, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/^\s*(?:read more|continue reading|view more|view on x|show more|see more|more\.\.\.|阅读全文|继续阅读|查看更多|显示更多)[.!…\s→➜➔›»]*$/gim, '')
      .replace(/^\s*>\s?/gm, '')
      .trim();
    return content.length > 0 && comparableText(content) !== comparableText(metadataTitle);
  });
}

function getLocalFileAttachmentPaths(markdown) {
  const paths = [];
  const pattern = /^\s*本地(?:图片|附件)\s*[：:]\s*!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]\s*$/gim;
  let match = null;
  while ((match = pattern.exec(String(markdown || ''))) !== null) {
    const attachmentPath = String(match[1] || '').trim();
    if (attachmentPath && !paths.includes(attachmentPath)) paths.push(attachmentPath);
  }
  return paths;
}

function isKnownFailureReceiptMarkdown(markdown) {
  const body = getMarkdownBody(markdown);
  if (!body) return false;
  if (isWechatArticleFailurePlaceholder(body)) return true;
  const startsWithSavedPlatformLink = /^(?:小红书|抖音|飞书)链接已保存[。.!！]?/i.test(body);
  if (startsWithSavedPlatformLink) return true;
  return /^原始链接[：:]\s*https?:\/\/\S+[\s\S]*?##\s*视频号口播文案[\s\S]*?未能提取视频号口播文案[。.!！]?/i.test(body);
}

function hasWechatImageBody(record, markdown) {
  const metadata = record && record.metadata || {};
  // A video cover is not a transcript. This exemption only applies to MP
  // image content, and must not change the video/voice completion rules.
  if (metadata.webpageMediaType === 'audio_video' || metadata.transcriptOnly === true
    || metadata.contentCategory === '视频') return false;
  try {
    const url = new URL(String(metadata.url || record && record.content || ''));
    if (!/^https?:$/.test(url.protocol) || url.hostname !== 'mp.weixin.qq.com') return false;
  } catch (_) { return false; }
  const body = getMarkdownBody(markdown);
  const targets = [];
  for (const match of body.matchAll(/!\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\s*\)|!\[\[([^\]\n]+)\]\]/g)) {
    targets.push(String(match[1] || match[2] || '').replace(/^<|>$/g, '').split('|')[0].trim());
  }
  return targets.some((target) => {
    if (/^https?:\/\//i.test(target)) {
      try { return new URL(target).hostname === 'mmbiz.qpic.cn'; } catch (_) { return false; }
    }
    return !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)
      && /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:[?#].*)?$/i.test(target);
  });
}

function isExistingLocalNoteDeliverable(record, markdown) {
  const source = record && typeof record === 'object' ? record : {};
  const metadata = source.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const recordType = String(source.type || '').trim().toLowerCase();
  const fileExt = String(metadata.fileExt || '').trim().toLowerCase().replace(/^\./, '');
  const url = String(metadata.url || source.content || '').trim();
  const body = getMarkdownBody(markdown);
  if (isPlatformArticleUrl(url) && !hasPlatformArticleBody(body)) return false;
  if (isKnownFailureReceiptMarkdown(body)) return false;
  if (metadata.transcriptionStatus === 'failed' && !String(metadata.transcription || '').trim()) return false;
  const hasEmbeddedAttachment = /!\[\[[^\]]+\]\]/.test(body);
  const contentOnlyBody = body
    .replace(/^\s*(?:原始链接|来源链接|source\s*url)\s*[：:]\s*https?:\/\/\S+\s*$/gim, '')
    .replace(/^\s*>?\s*⚠️.*$/gim, '')
    .replace(/^\s*##\s+(?:Markdown 内容|口播\/音频文案|视频号口播文案|原始音视频)\s*$/gm, '')
    .trim();
  const meaningfulLength = getMeaningfulMarkdownLength(contentOnlyBody);

  // A committed image-post note carries a fixed evidence marker. The same
  // source record may still have its old video hint on retry. This check is
  // only used after the caller has matched the note's record identity.
  if (['webpage', 'link', 'text'].includes(recordType)
    && /^<!-- wechat-inbox-content-kind: image-post -->\s*<!--\s*wechat-inbox-record-id:/.test(
      String(markdown || '').replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trimStart())
    && metadata.transcriptionStatus !== 'failed' && !metadata.videoUrl && !metadata.audioUrl
    && !metadata.transcriptionSource && !metadata.mediaResolutionDiagnostic
    && !isLikelyWebpageShell(url, body)
    && hasWechatImageBody({ ...source, metadata: { ...metadata,
      webpageMediaType: '', transcriptOnly: false, contentCategory: '贴图' } }, contentOnlyBody)) return true;

  if (recordType === 'text') return meaningfulLength > 0;
  if (recordType === 'file') {
    return getLocalFileAttachmentPaths(body).length > 0;
  }
  if (recordType === 'voice'
    || metadata.webpageMediaType === 'audio_video'
    || metadata.transcriptOnly === true) {
    return meaningfulLength >= 8;
  }
  if (['webpage', 'link'].includes(recordType) || /^https?:\/\//i.test(url)) {
    if (isLikelyWebpageShell(url, body)) return false;
    return meaningfulLength >= 8 || hasWechatImageBody(source, contentOnlyBody);
  }
  return meaningfulLength > 0 || hasEmbeddedAttachment;
}

function isXiaohongshuRecordSource(value) {
  return /^https?:\/\/(?:[^/?#]*\.)?(?:xiaohongshu\.com|xhslink\.com|xhslink\.cn)(?:[/?#]|$)/i
    .test(String(value || '').trim());
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
  const xRecord = isXUrl(url);
  const declaredError = `${metadata.conversionError || ''} ${metadata.transcriptionError || ''}`.trim();
  if (xRecord && (['failed', 'link_saved'].includes(conversionStatus)
    || (conversionStatus === 'success' && !hasXArticleBody(markdown, metadata)))) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', 'X 正文提取失败，未将标题或链接标记为同步成功', buildWebpageExtractionFailureDiagnostic(source, metadata, markdown));
  }
  if (isPlatformArticleUrl(url) && (['failed', 'link_saved'].includes(conversionStatus) || !hasPlatformArticleBody(markdown))) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '文章正文提取失败，未将标题或链接标记为同步成功', buildWebpageExtractionFailureDiagnostic(source, metadata, markdown));
  }
  if (transcriptionStatus === 'no_speech' || conversionStatus === 'no_speech') {
    if (isRecognizedNoSpeechMetadata(metadata)) return null;
    // Same reason as below: an Xiaohongshu record is an extraction outcome.
    return isXiaohongshuRecordSource(url)
      ? createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '小红书内容提取失败，请重新同步')
      : createSyncLifecycleOutcomeError('TRANSCRIPTION_FAILED', '无语音识别结果缺少有效证据');
  }
  const meaningfulLength = getMeaningfulMarkdownLength(markdown);
  const hasUsableImages = hasWechatImageBody(source, markdown);
  const hasUsableOutput = meaningfulLength >= 40 || transcription.length >= 20 || hasUsableImages;
  const hasDeclaredFailureState = ['failed', 'link_saved', 'wechat_captcha'].includes(conversionStatus)
    || transcriptionStatus === 'failed';

  const channelsOutcome = channelsDiagnostic.outcome(metadata.mediaResolutionDiagnostic);
  if (channelsOutcome && transcriptionStatus === 'failed') return createSyncLifecycleOutcomeError(channelsOutcome.code, channelsOutcome.message, channelsOutcome.diagnostic);
  if (transcriptionStatus === 'failed' && !transcription) {
    // Xiaohongshu shares are webpages first; the mini program tags every
    // xhslink.com/a/ link as audio_video, so a persisted transcript failure on
    // those records would surface as "音视频转写失败" for a note that was only
    // ever being extracted. Report it as an extraction outcome instead.
    return isXiaohongshuRecordSource(url)
      ? createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '小红书内容提取失败，请重新同步')
      : createSyncLifecycleOutcomeError('TRANSCRIPTION_FAILED', metadata.transcriptionError || metadata.conversionError || SYNC_LIFECYCLE_FAILURE_MESSAGES.TRANSCRIPTION_FAILED);
  }
  if (/UNSUPPORTED (?:PLATFORM|RECORD TYPE|SITE)|暂不支持(?:此|该)?平台|不支持(?:此|该)?平台/i.test(declaredError)
    && (hasDeclaredFailureState || !hasUsableOutput)) {
    return createSyncLifecycleOutcomeError('UNSUPPORTED_PLATFORM', '暂不支持此平台');
  }
  if (conversionStatus === 'wechat_captcha') {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '公众号正文提取失败：微信安全验证拦截；可在插件命令「处理公众号访问验证」中完成验证后重试');
  }

  if (/mp\.weixin\.qq\.com\//.test(url)
    && /微信扫一扫可打开此内容/.test(markdown)
    && /使用完整服务|使用小程序/.test(markdown)) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '公众号正文提取失败：微信仅返回打开引导页；可在插件命令「处理公众号访问验证」中完成验证后重试');
  }

  if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(url) && isWechatArticleFailurePlaceholder(markdown)) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '公众号正文提取失败：仅保存了标题、简介或封面，需要重新提取；可在插件命令「处理公众号访问验证」中完成验证后重试');
  }

  if (isLikelyWebpageShell(url, markdown)) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '内容解析失败：仅获取到打开或登录引导页', buildWebpageExtractionFailureDiagnostic(source, metadata, markdown));
  }

  const recordType = String(source.type || '').trim().toLowerCase();
  const isWebpageRecord = ['webpage', 'link'].includes(recordType) || /^https?:\/\//i.test(url);
  if (isWebpageRecord
    && conversionStatus === 'success'
    && !transcription
    && meaningfulLength === 0
    && !hasUsableImages) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '内容解析失败：没有获得可写入的正文', buildWebpageExtractionFailureDiagnostic(source, metadata, markdown));
  }

  if (fileExt === 'pdf' && conversionStatus === 'attachment_saved') {
    return createSyncLifecycleOutcomeError(
      'EXTRACTION_FAILED',
      declaredError || 'PDF 内容提取失败',
      buildPdfExtractionFailureDiagnostic(metadata),
    );
  }

  if (transcriptionStatus === 'failed' && !transcription) {
    return createSyncLifecycleOutcomeError(
      'TRANSCRIPTION_FAILED',
      declaredError || SYNC_LIFECYCLE_FAILURE_MESSAGES.TRANSCRIPTION_FAILED,
    );
  }

  if (['failed', 'link_saved'].includes(conversionStatus)) {
    return createSyncLifecycleOutcomeError('EXTRACTION_FAILED', '内容解析失败', buildWebpageExtractionFailureDiagnostic(source, metadata, markdown));
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
  MAX_COMPLETED_SYNC_RECEIPTS,
  MAX_PENDING_SYNC_LIFECYCLE_ATTEMPTS,
  SYNC_LIFECYCLE_FAILURE_MESSAGES,
  categorizeSyncFailure,
  getLocalFileAttachmentPaths,
  hasXArticleBody,
  getSyncLifecycleOutcomeError,
  getSyncLifecycleBindingFingerprint,
  getSyncNoteTitleFromPath,
  isExistingLocalNoteDeliverable,
  isKnownFailureReceiptMarkdown,
  isLegacySyncLifecycleError,
  isSyncRecordBusyError,
  normalizeCompletedSyncReceipts,
  normalizePendingSyncLifecycleAttempts,
  sanitizeSyncNoteTitle,
};
