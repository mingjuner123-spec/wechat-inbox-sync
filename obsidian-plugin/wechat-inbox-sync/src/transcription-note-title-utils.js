'use strict';

const MAX_SEMANTIC_TITLE_LENGTH = 36;
const GENERIC_TRANSCRIPTION_TITLE = /^(?:抖音|视频号|B站|哔哩哔哩|小宇宙|网页|音频|视频|录音|文件)?[-\s]*(?:口播文案|音频文案|视频文案|转写文案|转写内容)$/i;
const SHORT_GREETING = /^(?:大家好|你好|您好|哈喽|hello|嗨|嗯+|啊+|呃+)$/i;

function getMetadata(record) {
  return record && record.metadata && typeof record.metadata === 'object'
    ? record.metadata
    : {};
}

function isSuccessfulTranscriptionRecord(record) {
  const metadata = getMetadata(record);
  return String(metadata.transcriptionStatus || '').toLowerCase() === 'success'
    && Boolean(String(metadata.transcription || '').trim());
}

function inferPlatformFromUrl(value) {
  const url = String(value || '').toLowerCase();
  if (/xiaohongshu\.com|xhslink\.cn|xhslink\.com/.test(url)) return '小红书';
  if (/douyin\.com|iesdouyin\.com/.test(url)) return '抖音';
  if (/channels\.weixin\.qq\.com|finder\.video\.qq\.com/.test(url)) return '视频号';
  if (/bilibili\.com|b23\.tv/.test(url)) return 'B站';
  if (/xiaoyuzhoufm\.com|xiaoeknow\.com/.test(url)) return '小宇宙';
  return '';
}

function cleanTitlePart(value, maxLength = MAX_SEMANTIC_TITLE_LENGTH) {
  const normalized = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-—–_，。！？!?：:；;、“”‘’'"【】\[\]（）()]+/, '')
    .replace(/[\s\-—–_，。！？!?：:；;、“”‘’'"【】\[\]（）()]+$/, '')
    .trim();
  return Array.from(normalized).slice(0, maxLength).join('').trim();
}

function stripSourcePrefix(value, source) {
  const title = cleanTitlePart(value);
  const normalizedSource = cleanTitlePart(source, 16);
  if (!title || !normalizedSource) return title;
  const prefixes = [
    `${normalizedSource}-`,
    `${normalizedSource}：`,
    `${normalizedSource}:`,
    `${normalizedSource} `,
  ];
  for (const prefix of prefixes) {
    if (title.toLowerCase().startsWith(prefix.toLowerCase())) {
      return cleanTitlePart(title.slice(prefix.length));
    }
  }
  return title;
}

function getTranscriptionSourcePrefix(record) {
  const metadata = getMetadata(record);
  const explicitPlatform = cleanTitlePart(metadata.platform || metadata.platformName, 16);
  if (explicitPlatform) return explicitPlatform;

  const inferredPlatform = inferPlatformFromUrl(metadata.url || metadata.originalUrl || record && record.content);
  if (inferredPlatform) return inferredPlatform;

  const type = String(record && record.type || '').toLowerCase();
  if (type === 'voice') return '录音';
  if (type === 'file') {
    const category = cleanTitlePart(metadata.contentCategory, 8);
    if (/视频/.test(category)) return '视频';
    if (/音频|录音/.test(category)) return '音频';
    const ext = String(metadata.fileExt || metadata.fileName || '').toLowerCase();
    if (/\.(?:mp4|mov|m4v|mkv|webm)$|^(?:mp4|mov|m4v|mkv|webm)$/.test(ext)) return '视频';
    if (/\.(?:mp3|wav|m4a|aac|flac|ogg|opus)$|^(?:mp3|wav|m4a|aac|flac|ogg|opus)$/.test(ext)) return '音频';
  }
  return '音视频';
}

function getMeaningfulTranscriptSentence(transcription) {
  const sentences = String(transcription || '')
    .replace(/\s+/g, ' ')
    .split(/[。！？!?；;\n]+/)
    .map((item) => cleanTitlePart(item))
    .filter(Boolean);
  return sentences.find((item) => item.length >= 8 && !SHORT_GREETING.test(item))
    || sentences.find((item) => item.length >= 5 && !SHORT_GREETING.test(item))
    || '';
}

function buildTitleFromGeneratedDescription(description) {
  const source = String(description || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source) return '';

  const topicMatch = source.match(/(?:详细)?(?:介绍|讲解|分享|说明|总结|讨论|分析)(?:了|的是)?\s*([^，。！？；;]+)/);
  if (topicMatch && topicMatch[1]) {
    return cleanTitlePart(topicMatch[1]);
  }

  const withoutReportPrefix = source
    .replace(/^(?:这是一(?:份|段|篇)|本文|本视频|这段视频|该视频|这段音频|本期(?:视频|节目)?)[^，。！？；;]{0,24}[，,:：]\s*/, '')
    .replace(/^(?:主要|重点)(?:介绍|讲解|分享|说明|讨论|分析)(?:了|的是)?\s*/, '');
  const firstTopicClause = withoutReportPrefix.split(/[，。！？；;]/)[0] || '';
  return cleanTitlePart(firstTopicClause);
}

function getFileNameStem(fileName) {
  return String(fileName || '').replace(/\.[A-Za-z0-9]{1,8}$/, '');
}

function buildTitleFromKeywords(keywords) {
  const values = (Array.isArray(keywords) ? keywords : String(keywords || '').split(/[,，、\s]+/))
    .map((item) => cleanTitlePart(item, 18))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 2);
  return values.join('-');
}

function extractSourceTitleFromMarkdown(markdown = '') {
  const match = String(markdown || '').match(/(?:^|\n)##\s*标题\s*\n+([^\n]+)/i);
  return cleanTitlePart(match && match[1] || '');
}

function getCanonicalSourceTitleCandidate(record) {
  const metadata = getMetadata(record);
  const source = getTranscriptionSourcePrefix(record);
  const sourceTitle = cleanTitlePart(metadata.sourceTitle || metadata.platformTitle || '');
  if (!['抖音', '小红书', 'B站', '小宇宙', '视频号'].includes(source)) {
    return { title: '', titleSource: '' };
  }
  if (sourceTitle
    && sourceTitle.toLowerCase() !== source.toLowerCase()
    && !GENERIC_TRANSCRIPTION_TITLE.test(sourceTitle)) {
    return { title: sourceTitle, titleSource: 'source-title' };
  }
  const markdownTitle = extractSourceTitleFromMarkdown(metadata.markdown);
  if (markdownTitle
    && markdownTitle.toLowerCase() !== source.toLowerCase()
    && !GENERIC_TRANSCRIPTION_TITLE.test(markdownTitle)) {
    return { title: markdownTitle, titleSource: 'source-markdown-title' };
  }
  return { title: '', titleSource: '' };
}

function buildSemanticTitleCandidate(record, fallbackTitle = '') {
  const metadata = getMetadata(record);
  const source = getTranscriptionSourcePrefix(record);
  const sourceTitleCandidate = getCanonicalSourceTitleCandidate(record);
  if (sourceTitleCandidate.title) return sourceTitleCandidate;

  const keywordTitle = buildTitleFromKeywords(metadata.keywords);
  const shouldPreferKeywordTitle = source === '录音' || source === '音频';
  if (shouldPreferKeywordTitle && keywordTitle && !GENERIC_TRANSCRIPTION_TITLE.test(keywordTitle)) {
    return { title: keywordTitle, titleSource: 'keywords' };
  }

  const semanticTitle = cleanTitlePart(metadata.semanticTitle || metadata.aiTitle);
  if (semanticTitle && !GENERIC_TRANSCRIPTION_TITLE.test(semanticTitle)) {
    return { title: semanticTitle, titleSource: 'ai-title' };
  }

  if (keywordTitle && !GENERIC_TRANSCRIPTION_TITLE.test(keywordTitle)) {
    return { title: keywordTitle, titleSource: 'keywords' };
  }

  const transcriptSentence = getMeaningfulTranscriptSentence(metadata.transcription);
  if (transcriptSentence) return { title: transcriptSentence, titleSource: 'transcription' };

  const fileName = cleanTitlePart(getFileNameStem(metadata.fileName || ''));
  if (fileName && !GENERIC_TRANSCRIPTION_TITLE.test(fileName)) {
    return { title: fileName, titleSource: 'file-name' };
  }

  const originalTitle = cleanTitlePart(metadata.title || record && record.title || '');
  if (originalTitle && !GENERIC_TRANSCRIPTION_TITLE.test(originalTitle)) {
    return { title: originalTitle, titleSource: 'original-title' };
  }

  const fallback = cleanTitlePart(fallbackTitle);
  if (fallback && !GENERIC_TRANSCRIPTION_TITLE.test(fallback)) {
    return { title: fallback, titleSource: 'fallback' };
  }
  return { title: '转写内容', titleSource: 'fallback' };
}

function buildSemanticTranscriptionTitle(record, fallbackTitle = '') {
  const source = getTranscriptionSourcePrefix(record);
  const candidate = buildSemanticTitleCandidate(record, fallbackTitle);
  return stripSourcePrefix(candidate.title, source) || '转写内容';
}

function buildTranscriptionNoteIdentity(record, options = {}) {
  if (!isSuccessfulTranscriptionRecord(record)) return null;
  const source = getTranscriptionSourcePrefix(record);
  const fallbackWithoutBinding = stripSourcePrefix(options.fallbackTitle || '', options.bindingLabel || '');
  const semanticFallbackTitle = stripSourcePrefix(fallbackWithoutBinding, source);
  const candidate = buildSemanticTitleCandidate(record, semanticFallbackTitle);
  const displayTitle = stripSourcePrefix(candidate.title, source) || '转写内容';
  const bindingLabel = cleanTitlePart(options.bindingLabel || '', 24);
  const fileTitle = [bindingLabel, source, displayTitle].filter(Boolean).join('-');
  return {
    displayTitle,
    fileTitle,
    source,
    titleSource: candidate.titleSource,
  };
}

function applyTranscriptionNoteIdentity(record, options = {}) {
  const identity = buildTranscriptionNoteIdentity(record, options);
  if (!identity) {
    return {
      record,
      displayTitle: options.fallbackTitle || '',
      fileTitle: options.fallbackTitle || '',
      source: '',
      titleSource: '',
    };
  }
  const metadata = getMetadata(record);
  const originalTitle = String(metadata.originalTitle || metadata.title || '').trim();
  return {
    ...identity,
    record: {
      ...record,
      metadata: {
        ...metadata,
        ...(originalTitle && originalTitle !== identity.displayTitle ? { originalTitle } : {}),
        title: identity.displayTitle,
        semanticTitleSource: identity.titleSource,
      },
    },
  };
}

module.exports = {
  MAX_SEMANTIC_TITLE_LENGTH,
  applyTranscriptionNoteIdentity,
  buildSemanticTranscriptionTitle,
  buildTitleFromKeywords,
  buildTitleFromGeneratedDescription,
  buildTranscriptionNoteIdentity,
  getTranscriptionSourcePrefix,
  isSuccessfulTranscriptionRecord,
};
