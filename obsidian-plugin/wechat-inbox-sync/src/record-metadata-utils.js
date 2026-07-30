'use strict';

function getRecordAuthor(metadata = {}) {
  return metadata.author
    || metadata.accountName
    || metadata.nickname
    || metadata.nickName
    || metadata.sourceName
    || '';
}

function getRecordDescription(metadata = {}) {
  return metadata.description
    || metadata.summary
    || metadata.excerpt
    || metadata.abstract
    || '';
}

function getRecordKeywords(metadata = {}) {
  const value = metadata.keywords || metadata.tags || metadata.hashtags || [];
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripMarkdownForDescription(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+/.test(String(line || '').trim()))
    .join('\n')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[\[([^\]]+)]]/g, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\|.*\|$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywordsFromText(text, title = '') {
  const source = `${title || ''} ${text || ''}`;
  const keywords = [];
  const candidates = [
    '风口',
    '小红书',
    'AI',
    '知识库',
    '飞书',
    '复盘',
    '电商',
    '公众号',
    '流量',
    '创新',
    '创业',
  ];
  candidates.forEach((candidate) => {
    if (source.includes(candidate) && !keywords.includes(candidate)) keywords.push(candidate);
  });
  if (keywords.length) return keywords.slice(0, 8);
  return Array.from(new Set(String(source || '').match(/[\p{L}\p{N}]{2,12}/gu) || [])).slice(0, 6);
}

function enrichExtractedWebpageMetadata(metadata = {}) {
  const next = { ...metadata };
  const text = stripMarkdownForDescription(next.markdown || next.content || '');
  if (!next.description && text) {
    const sentences = text.split(/[。！？!?]\s*/).map((item) => item.trim()).filter((item) => item.length >= 8);
    next.description = (sentences[0] || text).slice(0, 120);
  }
  if (!getRecordKeywords(next).length) {
    next.keywords = extractKeywordsFromText(`${next.description || ''} ${text}`, next.title || '');
  }
  return next;
}

module.exports = {
  enrichExtractedWebpageMetadata,
  extractKeywordsFromText,
  getRecordAuthor,
  getRecordDescription,
  getRecordKeywords,
  stripMarkdownForDescription,
};
