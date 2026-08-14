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

function createSocialMediaContextHtmlBuilder(dependencies = {}) {
  const {
    extractPageMetadata,
    extractTagsFromText,
    extractMetaContent,
    collectImageUrls,
    normalizeUrl,
    isBilibiliUrl,
  } = dependencies;
  return (html, url = '') => {
    const metadata = typeof extractPageMetadata === 'function' ? extractPageMetadata(html, url) || {} : {};
    const tags = typeof extractTagsFromText === 'function'
      ? extractTagsFromText(metadata.description, html)
      : [];
    const cover = typeof extractMetaContent === 'function' && typeof normalizeUrl === 'function'
      ? normalizeUrl(extractMetaContent(html, ['og:image', 'twitter:image']))
      : '';
    const isPlaceholder = (imageUrl) => typeof isBilibiliUrl === 'function'
      && isBilibiliUrl(url)
      && /\/bfs\/static\/jinkela\/|\/long\/images\/512\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(String(imageUrl || ''));
    return buildSocialMediaSupplementalMarkdown({
      title: metadata.title,
      description: metadata.description,
      tags: Array.isArray(tags) && tags.length ? tags : metadata.keywords,
      imageUrls: [cover, ...(typeof collectImageUrls === 'function' ? collectImageUrls(html) : [])]
        .filter(Boolean)
        .filter((imageUrl) => !isPlaceholder(imageUrl)),
    });
  };
}

module.exports = {
  buildSocialMediaSupplementalMarkdown,
  createSocialMediaContextHtmlBuilder,
  normalizeSocialMediaImageUrl,
};
