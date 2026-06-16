const assert = require('assert');

const {
  createMediaResolver,
  extractMediaUrlFromHtml,
  normalizeResolveRequest,
  pickBestYtDlpMedia,
} = require('../media-resolver/resolver-core');

async function run() {
  assert.deepStrictEqual(
    normalizeResolveRequest({ url: ' https://www.xiaohongshu.com/explore/abc ' }),
    { url: 'https://www.xiaohongshu.com/explore/abc' },
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
