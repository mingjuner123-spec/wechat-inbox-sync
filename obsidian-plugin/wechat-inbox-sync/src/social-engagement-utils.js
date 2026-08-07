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

module.exports = {
  buildSocialMetrics,
  buildSocialMetricsFromText,
  hasSocialMetrics,
  normalizeMetricCount,
  withCapturedSocialMetrics,
};
