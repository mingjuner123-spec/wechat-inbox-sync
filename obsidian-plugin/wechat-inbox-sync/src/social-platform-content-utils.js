'use strict';

function collectDouyinImageUrlList(value, urls) {
  if (!value) return;
  if (typeof value === 'string') {
    urls.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDouyinImageUrlList(item, urls));
    return;
  }
  if (typeof value === 'object') {
    collectDouyinImageUrlList(value.url_list, urls);
    collectDouyinImageUrlList(value.urlList, urls);
    collectDouyinImageUrlList(value.url, urls);
    collectDouyinImageUrlList(value.uri, urls);
  }
}

function createDouyinStructuredContentBuilder(dependencies = {}) {
  const {
    cleanDescription = (value) => String(value || '').trim(),
    extractTags = () => [],
    buildMetrics = () => ({}),
    hasMetrics = () => false,
    isGenericTitle = () => false,
    deriveTitle = () => '',
    normalizeUrl = (value) => String(value || '').trim(),
  } = dependencies;

  return (detail = {}, fallback = {}) => {
    const source = detail && typeof detail === 'object' ? detail : {};
    const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
    const description = cleanDescription(
      source.desc
      || source.description
      || fallbackSource.description
      || '',
    );
    const title = [
      source.title,
      source.preview_title,
      source.previewTitle,
      fallbackSource.title,
    ]
      .map((candidate) => cleanDescription(candidate || ''))
      .find((candidate) => candidate
        && candidate !== description
        && candidate.length <= 80
        && !candidate.includes('\n')
        && !isGenericTitle(candidate))
      || deriveTitle(description);
    const structuredTags = [];
    const rememberTag = (value) => {
      const tag = String(value || '').replace(/^#+/, '').trim();
      if (tag && !structuredTags.includes(tag)) structuredTags.push(tag);
    };
    (Array.isArray(source.text_extra) ? source.text_extra : []).forEach((item) => {
      rememberTag(item && (item.hashtag_name || item.hashtagName));
    });
    (Array.isArray(source.cha_list) ? source.cha_list : []).forEach((item) => {
      rememberTag(item && (item.cha_name || item.chaName));
    });
    const extractedTags = extractTags(description);
    (Array.isArray(extractedTags) ? extractedTags : []).forEach(rememberTag);
    if (!structuredTags.length) {
      (Array.isArray(fallbackSource.tags) ? fallbackSource.tags : []).forEach(rememberTag);
    }

    const video = source.video && typeof source.video === 'object' ? source.video : {};
    const coverUrls = [];
    [
      video.cover,
      video.origin_cover,
      video.originCover,
      video.dynamic_cover,
      video.dynamicCover,
      video.animated_cover,
      video.animatedCover,
    ].forEach((value) => collectDouyinImageUrlList(value, coverUrls));
    const coverUrl = coverUrls
      .map((value) => normalizeUrl(value))
      .find(Boolean)
      || normalizeUrl(fallbackSource.coverUrl);
    const socialMetrics = buildMetrics(source);
    return {
      title,
      description,
      tags: structuredTags,
      coverUrl,
      socialMetrics: hasMetrics(socialMetrics)
        ? socialMetrics
        : (fallbackSource.socialMetrics || {}),
    };
  };
}

module.exports = {
  createDouyinStructuredContentBuilder,
};
