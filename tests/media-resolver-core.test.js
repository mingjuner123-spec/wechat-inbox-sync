const assert = require('assert');

const {
  createMediaResolver,
  extractMediaUrlFromHtml,
  extractWechatChannelsRequestPayload,
  isWechatChannelsUrl,
  normalizeWechatChannelsFeedPayload,
  normalizeResolveRequest,
  pickBestYtDlpMedia,
} = require('../media-resolver/resolver-core');

async function run() {
  assert.deepStrictEqual(
    normalizeResolveRequest({ url: ' https://www.xiaohongshu.com/explore/abc ' }),
    { url: 'https://www.xiaohongshu.com/explore/abc' },
  );

  assert.strictEqual(typeof isWechatChannelsUrl, 'function');
  assert.strictEqual(typeof extractWechatChannelsRequestPayload, 'function');
  assert.strictEqual(typeof normalizeWechatChannelsFeedPayload, 'function');
  assert.strictEqual(isWechatChannelsUrl('https://weixin.qq.com/sph/A7ULN6a876'), true);
  assert.deepStrictEqual(
    normalizeResolveRequest({ url: ' https://weixin.qq.com/sph/A7ULN6a876 ' }),
    { url: 'https://weixin.qq.com/sph/A7ULN6a876' },
  );
  assert.deepStrictEqual(
    extractWechatChannelsRequestPayload('https://channels.weixin.qq.com/web/pages/feed?eid=export%2Fdemo'),
    { exportId: 'export/demo' },
  );
  assert.deepStrictEqual(
    normalizeWechatChannelsFeedPayload({
      data: {
        object_desc: {
          description: '发布简介不能当成转写',
          media: [
            {
              url: 'https://finder.video.qq.com/encrypted.mp4',
              decode_key: '210003037022918',
            },
          ],
        },
        authorInfo: { nickname: '视频号作者' },
      },
    }),
    {
      title: '发布简介不能当成转写',
      author: '视频号作者',
      description: '发布简介不能当成转写',
      tags: [],
      coverUrl: '',
      videoUrl: 'https://finder.video.qq.com/encrypted.mp4',
      mediaUrls: ['https://finder.video.qq.com/encrypted.mp4'],
      decodeKey: '210003037022918',
      dynamicExportId: '',
      errMsg: '',
    },
  );

  assert.throws(
    () => normalizeResolveRequest({ url: 'https://example.com/video' }),
    /unsupported/i,
  );

  assert.strictEqual(
    extractMediaUrlFromHtml(
      '<meta property="og:video" content="/video/play.mp4?token=a&amp;b=1">',
      'https://www.xiaohongshu.com/explore/abc',
    ),
    'https://www.xiaohongshu.com/video/play.mp4?token=a&b=1',
  );

  assert.strictEqual(
    extractMediaUrlFromHtml(
      '<video><source src="https://cdn.example.test/audio.m4a"></video>',
      'https://www.bilibili.com/video/BV1xx',
    ),
    'https://cdn.example.test/audio.m4a',
  );

  assert.deepStrictEqual(
    pickBestYtDlpMedia({
      title: 'demo',
      duration: 123,
      formats: [
        { url: 'https://cdn.example.test/video.mp4', vcodec: 'h264', acodec: 'aac' },
        { url: 'https://cdn.example.test/audio.m4a', vcodec: 'none', acodec: 'aac', abr: 128 },
      ],
    }),
    {
      mediaUrl: 'https://cdn.example.test/audio.m4a',
      title: 'demo',
      durationSeconds: 123,
      source: 'yt-dlp',
    },
  );

  assert.deepStrictEqual(
    pickBestYtDlpMedia({
      title: 'needs headers',
      http_headers: { Referer: 'https://www.bilibili.com/' },
      formats: [
        {
          url: 'https://cdn.example.test/video.m4a',
          vcodec: 'none',
          acodec: 'aac',
          http_headers: { 'User-Agent': 'yt-dlp' },
        },
      ],
    }),
    {
      mediaUrl: 'https://cdn.example.test/video.m4a',
      title: 'needs headers',
      durationSeconds: 0,
      source: 'yt-dlp',
      headers: {
        Referer: 'https://www.bilibili.com/',
        'User-Agent': 'yt-dlp',
      },
    },
  );

  const ytDlpResolver = createMediaResolver({
    runYtDlp: async () => JSON.stringify({
      title: 'xhs video',
      duration: 60,
      url: 'https://cdn.example.test/xhs.mp4',
    }),
    fetchHtml: async () => {
      throw new Error('should not fetch html');
    },
  });
  assert.deepStrictEqual(
    await ytDlpResolver.resolve({ url: 'https://xhslink.com/a/b' }),
    {
      success: true,
      data: {
        mediaUrl: 'https://cdn.example.test/xhs.mp4',
        title: 'xhs video',
        durationSeconds: 60,
        source: 'yt-dlp',
      },
    },
  );

  const fallbackResolver = createMediaResolver({
    runYtDlp: async () => {
      throw new Error('yt-dlp failed');
    },
    fetchHtml: async () => '<meta property="og:audio" content="https://cdn.example.test/podcast.mp3">',
  });
  assert.deepStrictEqual(
    await fallbackResolver.resolve({ url: 'https://www.xiaoyuzhoufm.com/episode/1' }),
    {
      success: true,
      data: {
        mediaUrl: 'https://cdn.example.test/podcast.mp3',
        title: '',
        durationSeconds: 0,
        source: 'html',
      },
    },
  );

  const redirectResolver = createMediaResolver({
    runYtDlp: async (url) => {
      if (url === 'https://b23.tv/short') {
        throw new Error('short url failed');
      }
      return {
        title: 'redirected',
        url: 'https://cdn.example.test/bilibili.m4a',
      };
    },
    resolveFinalUrl: async () => 'https://www.bilibili.com/video/BV1xx',
  });
  assert.deepStrictEqual(
    await redirectResolver.resolve({ url: 'https://b23.tv/short' }),
    {
      success: true,
      data: {
        mediaUrl: 'https://cdn.example.test/bilibili.m4a',
        title: 'redirected',
        durationSeconds: 0,
        source: 'yt-dlp',
      },
    },
  );

  const wechatChannelsResolver = createMediaResolver({
    runYtDlp: async () => {
      throw new Error('yt-dlp should not be required for feed media');
    },
    fetchWechatChannelsFeedInfo: async (url) => {
      assert.strictEqual(url, 'https://weixin.qq.com/sph/A7ULN6a876');
      return {
        data: {
          object_desc: {
            description: '视频号知识口播',
            media: [
              {
                url: 'https://finder.video.qq.com/encrypted.mp4',
                decode_key: '210003037022918',
              },
            ],
          },
          authorInfo: { nickname: '视频号作者' },
        },
      };
    },
  });
  assert.deepStrictEqual(
    await wechatChannelsResolver.resolve({ url: 'https://weixin.qq.com/sph/A7ULN6a876' }),
    {
      success: true,
      data: {
        mediaUrl: 'https://finder.video.qq.com/encrypted.mp4',
        title: '视频号知识口播',
        durationSeconds: 0,
        source: 'wechat-channels-feed',
        author: '视频号作者',
        description: '视频号知识口播',
        decodeKey: '210003037022918',
        encrypted: true,
        headers: {
          Referer: 'https://channels.weixin.qq.com/',
          'User-Agent': 'Mozilla/5.0 WeChatInboxMediaResolver/1.0',
        },
      },
    },
  );

  const failedResolver = createMediaResolver({
    runYtDlp: async () => {
      throw new Error('yt-dlp failed');
    },
    fetchHtml: async () => '<html><body>no media</body></html>',
  });
  assert.deepStrictEqual(
    await failedResolver.resolve({ url: 'https://www.bilibili.com/video/BV1xx' }),
    {
      success: false,
      errCode: 'MEDIA_NOT_FOUND',
      errMsg: '未能解析到可转写的音视频地址',
    },
  );
}

run().then(() => {
  console.log('media-resolver-core.test.js passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
