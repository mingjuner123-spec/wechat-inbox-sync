const assert = require('assert');
const Module = require('module');

let requestUrlMock = async () => ({ text: '' });
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    class Plugin {}
    class Notice {}
    return {
      App: class {},
      Plugin,
      PluginSettingTab: class {},
      Setting: class {},
      Notice,
      TFile: class {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: (...args) => requestUrlMock(...args),
      MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main.js';
const PluginClass = require(pluginMainPath);
const helpers = PluginClass.__test;

function createPlugin(transcription = '平台视频转写正文') {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    aiProvider: 'off',
    settingsVersion: 2,
    xiaohongshuCommentsEnabled: false,
  });
  plugin.hasProFeatureAccess = async () => true;
  plugin.runConfiguredTranscription = async () => ({
    transcription,
    source: 'local',
  });
  plugin.renderSocialMediaUrls = async (url) => (
    String(url || '').includes('xiaohongshu.com')
      ? ['https://sns-video-v6.xhscdn.com/stream/xhs-rendered.mp4']
      : []
  );
  plugin.requestXiaohongshuStaticPage = async (url) => {
    const response = await requestUrlMock({ url });
    return {
      ...response,
      status: Number(response && response.status) || 200,
      url,
    };
  };
  return plugin;
}

function assertHasContextBeforeTranscript(record, {
  title,
  description,
  tag,
  cover,
  transcript,
}) {
  const markdown = helpers.buildMarkdownForRecord({
    record,
    title,
    syncedAt: '2026-08-06T00:00:00.000Z',
  });
  const titleIndex = markdown.indexOf(title);
  const descriptionIndex = markdown.indexOf(description);
  const transcriptIndex = markdown.indexOf(transcript);
  assert.ok(titleIndex >= 0, `missing title in markdown: ${markdown}`);
  assert.ok(descriptionIndex >= 0, `missing description in markdown: ${markdown}`);
  assert.ok(markdown.includes(tag), `missing tag in markdown: ${markdown}`);
  assert.ok(markdown.includes(cover), `missing cover in markdown: ${markdown}`);
  assert.ok(transcriptIndex >= 0, `missing transcript in markdown: ${markdown}`);
  assert.ok(descriptionIndex < transcriptIndex, 'original description should appear before transcript');
}

async function run() {
  const plugin = createPlugin('小红书视频口播正文');
  requestUrlMock = async (request) => {
    const url = typeof request === 'string' ? request : request && request.url;
    if (process.env.DEBUG_SOCIAL_CONTEXT_URLS) console.error(`requestUrl: ${url}`);
    if (String(url || '').includes('xiaohongshu.com')) {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="小红书视频标题">',
          '<meta property="og:description" content="小红书原文正文 #效率工具">',
          '<meta name="keywords" content="效率工具,Obsidian">',
          '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/xhs-cover.jpg">',
          '<meta property="og:video" content="https://sns-video-v6.xhscdn.com/stream/xhs.mp4">',
          '</head><body></body></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.douyin.com/video/context') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="抖音视频标题">',
          '<meta property="og:description" content="抖音原文简介 #AI工具">',
          '<meta name="keywords" content="AI工具,内容创作">',
          '<meta property="og:image" content="https://img.example.com/douyin-cover.jpg">',
          '<meta property="og:video" content="https://video.example.com/douyin.mp4">',
          '</head><body></body></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.bilibili.com/video/BVCONTEXT') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="B站视频标题">',
          '<meta property="og:description" content="B站原文简介 #知识管理">',
          '<meta name="keywords" content="知识管理,笔记">',
          '<meta property="og:image" content="https://img.example.com/bili-cover.jpg">',
          '<meta property="og:video" content="https://video.example.com/bili.mp4">',
          '</head><body></body></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.xiaoyuzhoufm.com/episode/context') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="小宇宙标题">',
          '<meta property="og:description" content="小宇宙节目简介 #播客">',
          '<meta name="keywords" content="播客,访谈">',
          '<meta property="og:image" content="https://img.example.com/xyz-cover.jpg">',
          '<meta property="og:audio" content="https://audio.example.com/xyz.mp3">',
          '</head><body></body></html>',
        ].join(''),
      };
    }
    if (url.includes('/x/web-interface/view')) {
      return { json: { data: { cid: 123, stat: { view: 2195, like: 104, favorite: 240, reply: 31, share: 10, coin: 31 } } } };
    }
    if (url.includes('/x/player/')) {
      return { json: {} };
    }
    throw new Error(`unexpected request ${url}`);
  };

  const xhsRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/context-video',
    metadata: {
      url: 'https://www.xiaohongshu.com/explore/context-video',
      webpageMediaType: 'audio_video',
    },
  }, '', '', '小红书视频');
  assertHasContextBeforeTranscript(xhsRecord, {
    title: '小红书视频标题',
    description: '小红书原文正文',
    tag: '#效率工具',
    cover: 'https://sns-webpic-qc.xhscdn.com/xhs-cover.jpg',
    transcript: '小红书视频口播正文',
  });
  assert.strictEqual(xhsRecord.metadata.sourceTitle, '小红书视频标题');

  const douyinRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.douyin.com/video/context',
    metadata: { url: 'https://www.douyin.com/video/context' },
  }, '', '', '抖音视频');
  assertHasContextBeforeTranscript(douyinRecord, {
    title: '抖音视频标题',
    description: '抖音原文简介',
    tag: '#AI工具',
    cover: 'https://img.example.com/douyin-cover.jpg',
    transcript: '小红书视频口播正文',
  });
  assert.strictEqual(douyinRecord.metadata.sourceTitle, '抖音视频标题');

  const bilibiliRecord = await plugin.hydrateBilibiliTranscript({
    type: 'webpage',
    content: 'https://www.bilibili.com/video/BVCONTEXT',
    metadata: { url: 'https://www.bilibili.com/video/BVCONTEXT' },
  }, 'https://www.bilibili.com/video/BVCONTEXT', null, 'B站视频');
  assertHasContextBeforeTranscript(bilibiliRecord, {
    title: 'B站视频标题',
    description: 'B站原文简介',
    tag: '#知识管理',
    cover: 'https://img.example.com/bili-cover.jpg',
    transcript: '小红书视频口播正文',
  });
  assert.strictEqual(bilibiliRecord.metadata.sourceTitle, 'B站视频标题');
  assert.deepStrictEqual({ ...bilibiliRecord.metadata.socialMetrics, capturedAt: undefined }, {
    views: 2195,
    likes: 104,
    collects: 240,
    comments: 31,
    shares: 10,
    coins: 31,
    capturedAt: undefined,
  });
  assert.match(helpers.buildMarkdownForRecord({
    record: bilibiliRecord,
    title: 'B站视频标题',
    syncedAt: '2026-08-06T00:00:00.000Z',
  }), /coins:\s*31/);

  const xiaoyuzhouRecord = await plugin.hydrateXiaoyuzhouTranscript({
    type: 'webpage',
    content: 'https://www.xiaoyuzhoufm.com/episode/context',
    metadata: { url: 'https://www.xiaoyuzhoufm.com/episode/context' },
  }, 'https://www.xiaoyuzhoufm.com/episode/context', null, '小宇宙');
  assertHasContextBeforeTranscript(xiaoyuzhouRecord, {
    title: '小宇宙标题',
    description: '小宇宙节目简介',
    tag: '#播客',
    cover: 'https://img.example.com/xyz-cover.jpg',
    transcript: '小红书视频口播正文',
  });
  assert.strictEqual(xiaoyuzhouRecord.metadata.sourceTitle, '小宇宙标题');

  requestUrlMock = async (request) => {
    const url = typeof request === 'string' ? request : request && request.url;
    if (url === 'https://www.xiaoyuzhoufm.com/episode/real-shape') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="Vol.41 那些年，我做过的独立开发产品">',
          '<meta property="og:description" content="本期播客，分享我的独立开发故事">',
          '<meta property="og:image" content="https://img.example.com/xyz-real-cover.jpg">',
          '<meta property="og:audio" content="https://audio.example.com/xyz-real.mp3">',
          '</head><body><span>播放数</span><span>124</span><span>评论数</span><span>0</span></body></html>',
        ].join(''),
      };
    }
    throw new Error(`unexpected request ${url}`);
  };
  const realShapeXiaoyuzhouRecord = await plugin.hydrateXiaoyuzhouTranscript({
    type: 'webpage',
    content: 'https://www.xiaoyuzhoufm.com/episode/real-shape',
    metadata: { url: 'https://www.xiaoyuzhoufm.com/episode/real-shape' },
  }, 'https://www.xiaoyuzhoufm.com/episode/real-shape', null, '小宇宙');
  assert.deepStrictEqual({ ...realShapeXiaoyuzhouRecord.metadata.socialMetrics, capturedAt: undefined }, {
    views: 124,
    comments: 0,
    capturedAt: undefined,
  });

  requestUrlMock = async (request) => {
    const url = typeof request === 'string' ? request : request && request.url;
    if (url === 'https://www.xiaoyuzhoufm.com/episode/body-numbers-only') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="正文数字不是数据属性">',
          '<meta property="og:audio" content="https://audio.example.com/body-numbers.mp3">',
          '</head><body><article>案例正文：这个选题最终获得播放量 124，点赞 8；这些数字不是当前页面指标。</article></body></html>',
        ].join(''),
      };
    }
    throw new Error(`unexpected request ${url}`);
  };
  const bodyNumbersOnlyRecord = await plugin.hydrateXiaoyuzhouTranscript({
    type: 'webpage',
    content: 'https://www.xiaoyuzhoufm.com/episode/body-numbers-only',
    metadata: { url: 'https://www.xiaoyuzhoufm.com/episode/body-numbers-only' },
  }, 'https://www.xiaoyuzhoufm.com/episode/body-numbers-only', null, '小宇宙');
  assert.strictEqual(bodyNumbersOnlyRecord.metadata.socialMetrics, undefined);

  requestUrlMock = async (request) => {
    const url = typeof request === 'string' ? request : request && request.url;
    if (url === 'https://www.bilibili.com/video/BVREALSHAPE') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="页面占位标题_哔哩哔哩_bilibili">',
          '<meta property="og:description" content="页面简介，视频播放量 2229、点赞数 107、投硬币枚数 33、收藏人数 244、转发人数 10、评论数 21">',
          '<meta property="og:image" content="https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png">',
          '</head><body></body></html>',
        ].join(''),
      };
    }
    if (url.includes('/x/web-interface/view')) {
      return {
        json: {
          data: {
            cid: 987,
            title: '如何把微信读书一键导入Obsidian生成个人图书馆',
            desc: '这一套流程跑下来，分享微信读书与 Obsidian 的完整同步方法。',
            pic: 'https://i0.hdslb.com/bfs/archive/real-video-cover.jpg',
            stat: { view: 2229, like: 107, favorite: 244, reply: 21, share: 10, coin: 33 },
          },
        },
      };
    }
    if (url.includes('/x/player/')) return { json: {} };
    throw new Error(`unexpected request ${url}`);
  };
  const realShapeBilibiliRecord = await plugin.hydrateBilibiliTranscript({
    type: 'webpage',
    content: 'https://www.bilibili.com/video/BVREALSHAPE',
    metadata: { url: 'https://www.bilibili.com/video/BVREALSHAPE' },
  }, 'https://www.bilibili.com/video/BVREALSHAPE', null, 'B站视频');
  assert.strictEqual(realShapeBilibiliRecord.metadata.sourceTitle, '如何把微信读书一键导入Obsidian生成个人图书馆');
  assert.match(realShapeBilibiliRecord.metadata.markdown, /https:\/\/i0\.hdslb\.com\/bfs\/archive\/real-video-cover\.jpg/);
  assert.doesNotMatch(realShapeBilibiliRecord.metadata.markdown, /jinkela\/long\/images\/512\.png/);
  assert.deepStrictEqual({ ...realShapeBilibiliRecord.metadata.socialMetrics, capturedAt: undefined }, {
    views: 2229,
    likes: 107,
    collects: 244,
    comments: 21,
    shares: 10,
    coins: 33,
    capturedAt: undefined,
  });

  requestUrlMock = async (request) => {
    const url = typeof request === 'string' ? request : request && request.url;
    if (url === 'https://www.bilibili.com/video/BVAPIFAIL') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="B站接口失败回退标题">',
          '<meta property="og:description" content="接口失败时仍保留正文并完成转写">',
          '<meta property="og:image" content="https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png">',
          '<meta property="og:audio" content="https://audio.example.com/bili-api-fail.mp3">',
          '</head><body></body></html>',
        ].join(''),
      };
    }
    if (url.includes('/x/web-interface/view')) throw new Error('Bilibili view API unavailable');
    throw new Error(`unexpected request ${url}`);
  };
  const bilibiliApiFailureRecord = await plugin.hydrateBilibiliTranscript({
    type: 'webpage',
    content: 'https://www.bilibili.com/video/BVAPIFAIL',
    metadata: { url: 'https://www.bilibili.com/video/BVAPIFAIL' },
  }, 'https://www.bilibili.com/video/BVAPIFAIL', null, 'B站视频');
  assert.strictEqual(bilibiliApiFailureRecord.metadata.transcriptionStatus, 'success');
  assert.strictEqual(bilibiliApiFailureRecord.metadata.sourceTitle, 'B站接口失败回退标题');
  assert.match(bilibiliApiFailureRecord.metadata.markdown, /接口失败时仍保留正文并完成转写/);
  assert.doesNotMatch(bilibiliApiFailureRecord.metadata.markdown, /jinkela\/long\/images\/512\.png/);

  const douyinAwemeId = '7530000000000000001';
  const douyinDetail = {
    aweme_id: douyinAwemeId,
    desc: '欢迎收看我的 Vlog，我们即将拍婚纱照，今天生意也特别好。',
    statistics: {
      play_count: 3210,
      digg_count: 88,
      collect_count: 17,
      comment_count: 9,
      share_count: 3,
    },
    text_extra: [{ hashtag_name: '婚纱照' }, { hashtag_name: '日常Vlog' }],
    video: {
      play_addr: { url_list: ['https://v.douyinvod.com/real-video.mp4'] },
      cover: { url_list: ['https://p3-sign.douyinpic.com/real-cover.jpeg'] },
    },
  };
  const unrelatedDouyinDetail = {
    aweme_id: '7530000000000000999',
    desc: '推荐流里的其他作品 #不要串用',
    statistics: { play_count: 999999, digg_count: 99999 },
    text_extra: [{ hashtag_name: '不要串用' }],
    video: {
      play_addr: { url_list: ['https://v.douyinvod.com/unrelated-video.mp4'] },
      cover: { url_list: ['https://p3-sign.douyinpic.com/unrelated-cover.jpeg'] },
    },
  };
  requestUrlMock = async (request) => {
    const url = typeof request === 'string' ? request : request && request.url;
    if (url === `https://www.douyin.com/video/${douyinAwemeId}`) {
      return {
        text: '<html><head><title>抖音</title><meta property="og:description" content="记录美好生活"></head></html>',
      };
    }
    if (url.includes(`/share/video/${douyinAwemeId}/`)) {
      return {
        text: [
          '<html><head><title>抖音</title></head><body><script>',
          `window._ROUTER_DATA=${JSON.stringify({
            loaderData: {
              video: { aweme_detail: douyinDetail },
              recommendation: { aweme_detail: unrelatedDouyinDetail },
            },
          })}`,
          '</script></body></html>',
        ].join(''),
      };
    }
    if (url.includes('/aweme/v1/web/aweme/detail/')) throw new Error('detail api unavailable');
    throw new Error(`unexpected request ${url}`);
  };
  const realShapeDouyinRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: `https://www.douyin.com/video/${douyinAwemeId}`,
    metadata: { url: `https://www.douyin.com/video/${douyinAwemeId}` },
  }, '', '', '抖音视频');
  assert.strictEqual(realShapeDouyinRecord.metadata.sourceTitle, douyinDetail.desc);
  assert.match(realShapeDouyinRecord.metadata.markdown, /欢迎收看我的 Vlog/);
  assert.match(realShapeDouyinRecord.metadata.markdown, /#婚纱照/);
  assert.match(realShapeDouyinRecord.metadata.markdown, /https:\/\/p3-sign\.douyinpic\.com\/real-cover\.jpeg/);
  assert.doesNotMatch(realShapeDouyinRecord.metadata.markdown, /推荐流里的其他作品|不要串用|unrelated-cover/);
  assert.deepStrictEqual({ ...realShapeDouyinRecord.metadata.socialMetrics, capturedAt: undefined }, {
    views: 3210,
    likes: 88,
    collects: 17,
    comments: 9,
    shares: 3,
    capturedAt: undefined,
  });
  const realShapeDouyinMarkdown = helpers.buildMarkdownForRecord({
    record: realShapeDouyinRecord,
    title: realShapeDouyinRecord.metadata.sourceTitle,
    syncedAt: '2026-08-07T00:00:00.000Z',
  });
  assert.ok(realShapeDouyinMarkdown.indexOf('## 标题') < realShapeDouyinMarkdown.indexOf('## 原文正文'));
  assert.ok(realShapeDouyinMarkdown.indexOf('## 原文正文') < realShapeDouyinMarkdown.indexOf('## 标签'));
  assert.ok(realShapeDouyinMarkdown.indexOf('## 标签') < realShapeDouyinMarkdown.indexOf('## 封面图'));
  assert.ok(realShapeDouyinMarkdown.indexOf('## 封面图') < realShapeDouyinMarkdown.indexOf('## 口播/音频文案'));
  assert.match(realShapeDouyinMarkdown, /views:\s*3210/);
  assert.match(realShapeDouyinMarkdown, /likes:\s*88/);
  assert.match(realShapeDouyinMarkdown, /collects:\s*17/);
  assert.match(realShapeDouyinMarkdown, /comments:\s*9/);
  assert.match(realShapeDouyinMarkdown, /shares:\s*3/);

  const sessionFallbackAwemeId = '7659778280362429711';
  const sessionFallbackDouyinDetail = {
    aweme_id: sessionFallbackAwemeId,
    desc: '全平台内容，一键进 Obsidian #Obsidian #知识管理',
    statistics: {
      play_count: 0,
      digg_count: 113,
      collect_count: 157,
      comment_count: 25,
      share_count: 39,
    },
    text_extra: [{ hashtag_name: 'Obsidian' }, { hashtag_name: '知识管理' }],
    video: {
      play_addr: { url_list: ['https://v.douyinvod.com/session-video.mp4'] },
      cover: { url_list: ['https://p3-sign.douyinpic.com/session-cover.jpeg'] },
    },
  };
  requestUrlMock = async (request) => {
    const url = typeof request === 'string' ? request : request && request.url;
    if (url === `https://www.douyin.com/video/${sessionFallbackAwemeId}`) {
      return {
        text: '<html><head><title>抖音</title><meta property="og:description" content="记录美好生活"></head></html>',
      };
    }
    if (url.includes('/share/video/') || url.includes('/aweme/v1/web/aweme/detail/')) {
      throw new Error('anonymous request unavailable');
    }
    throw new Error(`unexpected request ${url}`);
  };
  plugin.fetchDouyinMediaUrlsWithSession = async () => [
    'https://v.douyinvod.com/session-video.mp4',
  ];
  plugin.fetchDouyinMediaResolutionWithSession = async () => ({
    mediaUrls: ['https://v.douyinvod.com/session-video.mp4'],
    detail: sessionFallbackDouyinDetail,
  });
  const sessionFallbackDouyinRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: `https://www.douyin.com/video/${sessionFallbackAwemeId}`,
    metadata: { url: `https://www.douyin.com/video/${sessionFallbackAwemeId}` },
  }, '', '', '抖音视频');
  assert.match(sessionFallbackDouyinRecord.metadata.sourceTitle, /^全平台内容，一键进 Obsidian/);
  assert.match(sessionFallbackDouyinRecord.metadata.markdown, /全平台内容，一键进 Obsidian/);
  assert.match(sessionFallbackDouyinRecord.metadata.markdown, /#知识管理/);
  assert.match(sessionFallbackDouyinRecord.metadata.markdown, /session-cover\.jpeg/);
  assert.deepStrictEqual({ ...sessionFallbackDouyinRecord.metadata.socialMetrics, capturedAt: undefined }, {
    views: 0,
    likes: 113,
    collects: 157,
    comments: 25,
    shares: 39,
    capturedAt: undefined,
  });

  const xhsTrailingRecord = {
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/trailing-comments',
    metadata: helpers.buildTranscriptOnlyMetadata({
      title: '小红书评论顺序测试',
    }, {
      url: 'https://www.xiaohongshu.com/explore/trailing-comments',
      platform: '小红书',
      transcription: '视频转写结果应当位于评论区之前',
      transcriptionStatus: 'success',
      conversionStatus: 'success',
      markdown: '## 标题\n\n小红书评论顺序测试\n\n## 原文正文\n\n原文正文',
      trailingMarkdown: '## 评论区\n\n- 测试评论用户：测试评论',
    }),
  };
  const xhsTrailingMarkdown = helpers.buildMarkdownForRecord({
    record: xhsTrailingRecord,
    title: '小红书评论顺序测试',
    syncedAt: '2026-08-07T00:00:00.000Z',
  });
  assert.ok(xhsTrailingMarkdown.indexOf('视频转写结果应当位于评论区之前') < xhsTrailingMarkdown.indexOf('## 评论区'));
  assert.ok(xhsTrailingMarkdown.indexOf('## 评论区') < xhsTrailingMarkdown.indexOf('测试评论'));

  const xhsVideoId = '6a72a881000000002403f099';
  requestUrlMock = async (request) => {
    const url = typeof request === 'string' ? request : request && request.url;
    if (String(url || '').includes(xhsVideoId)) {
      return {
        status: 200,
        text: `<html><body><script>${JSON.stringify({
          noteDetailMap: {
            [xhsVideoId]: {
              note: {
                noteId: xhsVideoId,
                noteType: 'video',
                displayTitle: '小红书视频标题',
                desc: '这是一条应当进入转写的视频笔记',
                imageList: [{ url: 'https://sns-webpic-qc.xhscdn.com/video-cover.jpg' }],
              },
            },
          },
        })}</script></body></html>`,
      };
    }
    throw new Error(`unexpected request ${url}`);
  };
  const xhsVideoWithoutStaticMediaRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: `https://www.xiaohongshu.com/explore/${xhsVideoId}`,
    metadata: { url: `https://www.xiaohongshu.com/explore/${xhsVideoId}` },
  }, '', '', '小红书视频');
  assert.strictEqual(xhsVideoWithoutStaticMediaRecord.metadata.transcriptionStatus, 'success');
  assert.match(xhsVideoWithoutStaticMediaRecord.metadata.transcription, /小红书视频口播正文/);
  assert.strictEqual(xhsVideoWithoutStaticMediaRecord.metadata.contentCategory, '音视频');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
