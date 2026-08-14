const assert = require('assert');
const {
  createSocialMetricsHtmlExtractor,
  buildSocialMetrics,
  buildSocialMetricsFromText,
  hasSocialMetrics,
  withCapturedSocialMetrics,
} = require('../obsidian-plugin/wechat-inbox-sync/src/social-engagement-utils');

function run() {
  const metrics = buildSocialMetrics({
    statistics: {
      play_count: '1.2w',
      digg_count: 0,
      collect_count: '35',
      comment_count: 8,
      share_count: '2',
    },
  });
  assert.deepStrictEqual(metrics, {
    views: 12000,
    likes: 0,
    collects: 35,
    comments: 8,
    shares: 2,
  });
  assert.strictEqual(hasSocialMetrics(metrics), true);
  assert.deepStrictEqual(withCapturedSocialMetrics(metrics, '2026-08-05T00:00:00.000Z'), {
    ...metrics,
    capturedAt: '2026-08-05T00:00:00.000Z',
  });
  assert.deepStrictEqual(buildSocialMetrics({ interactInfo: { likedCount: '31' } }), { likes: 31 });
  assert.deepStrictEqual(buildSocialMetrics({
    data: {
      stat: {
        view: 2195,
        like: 104,
        favorite: 240,
        reply: 31,
        share: 10,
        coin: 31,
      },
    },
  }), {
    views: 2195,
    likes: 104,
    collects: 240,
    comments: 31,
    shares: 10,
    coins: 31,
  });
  assert.deepStrictEqual(buildSocialMetrics({ episode: { playCount: '1.8w', commentCount: 0 } }), {
    views: 18000,
    comments: 0,
  });
  assert.deepStrictEqual(buildSocialMetricsFromText('播放数 124 · 评论数 0'), {
    views: 124,
    comments: 0,
  }, '小宇宙真实页面的中文可见计数必须进入数据属性');
  assert.deepStrictEqual(buildSocialMetricsFromText(
    '视频播放量 2229、弹幕量 0、点赞数 107、投硬币枚数 33、收藏人数 244、转发人数 10、评论数 21',
  ), {
    views: 2229,
    likes: 107,
    collects: 244,
    comments: 21,
    shares: 10,
    coins: 33,
  }, 'B站真实简介里的平台数据必须作为 API 失败时的兜底');
  assert.deepStrictEqual(buildSocialMetrics({ statistics: { play_count: 'unavailable' } }), {});
  assert.strictEqual(hasSocialMetrics({}), false);

  const extractSocialMetricsFromHtml = createSocialMetricsHtmlExtractor({
    collectJsonBlocks: () => ['{"statistics":{"play_count":"1.2w","comment_count":3}}'],
    tryParseJson: JSON.parse,
  });
  assert.deepStrictEqual(extractSocialMetricsFromHtml('<html></html>'), { views: 12000, comments: 3 });
  const extractLabeledMetrics = createSocialMetricsHtmlExtractor({
    collectJsonBlocks: () => [],
    tryParseJson: JSON.parse,
  });
  assert.deepStrictEqual(
    extractLabeledMetrics('<span>播放</span><span>12</span><span>点赞</span><span>3</span>'),
    { views: 12, likes: 3 },
  );
}

run();
console.log('social-engagement-utils tests passed');
