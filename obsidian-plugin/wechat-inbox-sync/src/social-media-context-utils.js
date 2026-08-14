'use strict';

function normalizeSocialMediaImageUrl(value) {
  const normalized = String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .trim();
  if (!normalized || /^data:|^blob:/i.test(normalized)) return '';
  if (normalized.startsWith('//')) return `https:${normalized}`;
  return /^https?:\/\//i.test(normalized) ? normalized : '';
}

function normalizeSocialMediaTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,，、\s]+/);
  return Array.from(new Set(source
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))));
}

function buildSocialMediaSupplementalMarkdown({
  title = '',
  description = '',
  tags = [],
  imageUrls = [],
} = {}) {
  const cleanedTitle = String(title || '').trim();
  const cleanedDescription = String(description || '').trim();
  const normalizedTags = normalizeSocialMediaTags(tags);
  const normalizedImages = Array.from(new Set((Array.isArray(imageUrls) ? imageUrls : [])
    .map(normalizeSocialMediaImageUrl)
    .filter(Boolean)));
  const lines = [];
  if (cleanedTitle) lines.push('## 标题', '', cleanedTitle, '');
  if (cleanedDescription) lines.push('## 原文正文', '', cleanedDescription, '');
  if (normalizedTags.length) lines.push('## 标签', '', normalizedTags.join(' '), '');
  if (normalizedImages.length) lines.push('## 封面图', '', `![封面](${normalizedImages[0]})`, '');
  return lines.join('\n').trim();
}

module.exports = {
  buildSocialMediaSupplementalMarkdown,
  normalizeSocialMediaImageUrl,
};
