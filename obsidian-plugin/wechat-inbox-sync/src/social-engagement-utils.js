'use strict';

const METRIC_KEYS = ['views', 'likes', 'collects', 'comments', 'shares', 'coins'];

function normalizeMetricCount(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const text = String(value).trim().replace(/,/g, '').toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(万|w|k)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const unit = match[2];
  const multiplier = unit === '万' || unit === 'w' ? 10000 : (unit === 'k' ? 1000 : 1);
  return Math.round(amount * multiplier);
}

function getMetricContainerCandidates(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];
  const nestedKeys = ['statistics', 'stats', 'interactInfo', 'interact_info', 'engagement', 'data', 'stat', 'episode', 'item', 'aweme_detail'];
  const result = [];
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 4 || result.length >= 80) return;
    seen.add(value);
    result.push(value);
    nestedKeys.forEach((key) => visit(value[key], depth + 1));
  };
  visit(source);
  return result;
}

function readMetric(containers, aliases) {
  for (const container of containers) {
    for (const key of aliases) {
      if (!Object.prototype.hasOwnProperty.call(container, key)) continue;
      const normalized = normalizeMetricCount(container[key]);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

function buildSocialMetrics(source = {}) {
  const containers = getMetricContainerCandidates(source);
  const metrics = {
    views: readMetric(containers, ['viewCount', 'view_count', 'playCount', 'play_count', 'play', 'view']),
    likes: readMetric(containers, ['likedCount', 'liked_count', 'likeCount', 'like_count', 'diggCount', 'digg_count', 'likes', 'like']),
    collects: readMetric(containers, ['collectedCount', 'collected_count', 'collectCount', 'collect_count', 'favoriteCount', 'favorite_count', 'collects', 'favorite']),
    comments: readMetric(containers, ['commentCount', 'comment_count', 'comments', 'reply']),
    shares: readMetric(containers, ['shareCount', 'share_count', 'sharedCount', 'shared_count', 'shares', 'share']),
    coins: readMetric(containers, ['coinCount', 'coin_count', 'coins', 'coin']),
  };
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== null));
}

function buildSocialMetricsFromText(value = '') {
  const source = String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ');
  const definitions = {
    views: ['(?:视频)?播放(?:量|数|次数)?'],
    likes: ['(?:点赞|获赞)(?:量|数|次数)?'],
    collects: ['收藏(?:量|数|人数|次数)?'],
    comments: ['(?:评论|回复)(?:量|数|次数)?'],
    shares: ['(?:转发|分享)(?:量|数|人数|次数)?'],
    coins: ['(?:投硬币|硬币)(?:枚数|数|量|次数)?'],
  };
  const metrics = {};
  Object.entries(definitions).forEach(([key, labels]) => {
    for (const label of labels) {
      const match = source.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?\\s*(?:万|w|k)?)`, 'i'));
      if (!match) continue;
      const normalized = normalizeMetricCount(match[1]);
      if (normalized !== null) metrics[key] = normalized;
      break;
    }
  });
  return metrics;
}

function hasSocialMetrics(metrics = {}) {
  return METRIC_KEYS.some((key) => Number.isFinite(metrics && metrics[key]));
}

function withCapturedSocialMetrics(metrics = {}, capturedAt = '') {
  if (!hasSocialMetrics(metrics)) return {};
  const normalized = Object.fromEntries(METRIC_KEYS
    .filter((key) => Number.isFinite(metrics[key]))
    .map((key) => [key, Math.round(metrics[key])])) ;
  const timestamp = String(capturedAt || '').trim();
  return timestamp ? { ...normalized, capturedAt: timestamp } : normalized;
}

function createSocialMetricsHtmlExtractor(dependencies = {}) {
  const {
    collectJsonBlocks = () => [],
    tryParseJson = () => null,
  } = dependencies;
  const labels = '(?:\u89c6\u9891)?\u64ad\u653e(?:\u91cf|\u6570|\u6b21\u6570)?|\u70b9\u8d5e(?:\u91cf|\u6570|\u6b21\u6570)?|\u6536\u85cf(?:\u91cf|\u4eba\u6570|\u6b21\u6570)?|(?:\u8bc4\u8bba|\u56de\u590d)(?:\u91cf|\u6570|\u6b21\u6570)?|(?:\u8f6c\u53d1|\u5206\u4eab)(?:\u91cf|\u4eba\u6570|\u6b21\u6570)?|(?:\u6295\u5e01|\u786c\u5e01)(?:\u679a\u6570|\u6570|\u91cf|\u6b21\u6570)?';
  const count = '\\d+(?:\\.\\d+)?\\s*(?:\u4e07|w|k)?';

  const extractLabeledMetrics = (html = '') => {
    const pairPattern = new RegExp(
      '<(?:span|div|li|em|strong|button)\\b[^>]*>\\s*(' + labels + ')\\s*<\\/(?:span|div|li|em|strong|button)>\\s*<(?:span|div|li|em|strong|button)\\b[^>]*>\\s*(' + count + ')\\s*<\\/(?:span|div|li|em|strong|button)>',
      'gi',
    );
    const pairs = [];
    let match;
    const source = String(html || '');
    while ((match = pairPattern.exec(source))) pairs.push(match[1] + ' ' + match[2]);
    return buildSocialMetricsFromText(pairs.join(' '));
  };

  return (html = '') => {
    const blocks = collectJsonBlocks(html, {
      maxBlocks: 20,
      maxBlockCharacters: 1024 * 1024,
      maxTotalCharacters: 2 * 1024 * 1024,
      requiredTexts: ['"stat"', '"statistics"', '"playCount"', '"viewCount"'],
    });
    for (const block of blocks) {
      const metrics = buildSocialMetrics(tryParseJson(block));
      if (hasSocialMetrics(metrics)) return metrics;
    }
    return extractLabeledMetrics(html);
  };
}

module.exports = {
  buildSocialMetrics,
  buildSocialMetricsFromText,
  createSocialMetricsHtmlExtractor,
  hasSocialMetrics,
  normalizeMetricCount,
  withCapturedSocialMetrics,
};
