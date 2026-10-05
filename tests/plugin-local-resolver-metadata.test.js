const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const resolverUtils = require('../obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils');

const originalLoad = Module._load;
const originalExtensions = new Map();
for (const extension of ['.ps1', '.sh', '.py']) {
  originalExtensions.set(extension, Module._extensions[extension]);
  Module._extensions[extension] = (module, filename) => {
    module._compile(`module.exports = ${JSON.stringify(fs.readFileSync(filename, 'utf8'))};`, filename);
  };
}
Module._load = function loadWithObsidianMock(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      App: class {},
      Modal: class {},
      Notice: class {},
      Plugin: class {},
      PluginSettingTab: class {},
      Setting: class {},
      TFile: class {},
      MarkdownRenderer: {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: async () => ({ text: '' }),
    };
  }
  if (request === 'opencc-js/t2cn') {
    return { Converter: () => (value) => String(value || '') };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let PluginClass;
try {
  PluginClass = require(path.resolve(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'src', 'main.js'));
} finally {
  Module._load = originalLoad;
  for (const [extension, loader] of originalExtensions.entries()) {
    if (loader) Module._extensions[extension] = loader;
    else delete Module._extensions[extension];
  }
}

const helpers = PluginClass.__test;

function testResolverMetadataAllowlist() {
  const output = JSON.stringify({
    id: 'aweme-123',
    title: '本地解析标题',
    description: '本地解析简介 password=should-not-escape',
    tags: ['效率工具', { name: '#知识管理' }],
    thumbnail: 'https://img.example/cover.jpg?width=300&token=private-token',
    uploader: { nickname: '作者' },
    statistics: { view_count: 42 },
    url: 'https://media.example/video.mp4?token=private-token',
    cookie: 'session=private-cookie',
    auth_token: 'private-token',
  });
  const matched = resolverUtils.extractLocalDouyinResolverMetadata(output, 'aweme-123');
  assert.strictEqual(matched.identityOutcome, 'target-id-matched');
  assert.deepStrictEqual(matched.metadata.counts, { views: 42 });
  assert.deepStrictEqual(matched.metadata.tags, ['效率工具', '知识管理']);
  assert.strictEqual(matched.metadata.thumbnail, 'https://img.example/cover.jpg?width=300');
  assert.ok(!/private-token|private-cookie|auth_token|cookie/i.test(JSON.stringify(matched.metadata)));
  assert.ok(matched.mediaUrls.length === 1 && matched.mediaUrls[0].startsWith('https://media.example/'));

  const mismatch = resolverUtils.extractLocalDouyinResolverMetadata(output, 'aweme-other');
  assert.strictEqual(mismatch.identityOutcome, 'target-id-mismatch');
  assert.deepStrictEqual(mismatch.metadata, {});
  assert.deepStrictEqual(mismatch.mediaUrls, []);

  const unverified = resolverUtils.extractLocalDouyinResolverMetadata(output, '');
  assert.strictEqual(unverified.identityOutcome, 'target-id-unverified');
  assert.strictEqual(unverified.mediaUrls.length, 1, 'short-link fallback must keep the legacy media candidate');
  assert.deepStrictEqual(unverified.metadata, {}, 'unverified target must not contribute metadata');

  const missing = resolverUtils.extractLocalDouyinResolverMetadata(JSON.stringify({ id: 'aweme-123' }), 'aweme-123');
  assert.deepStrictEqual(missing.metadata, {}, 'missing resolver fields must not fabricate metadata or zero counts');
}

async function testResolverAdapterIntegration() {
  const originalExecFile = childProcess.execFile;
  let capturedArgs = [];
  childProcess.execFile = (executable, args, options, callback) => {
    capturedArgs = args.slice();
    callback(null, JSON.stringify({
      id: 'aweme-123',
      title: 'adapter 标题',
      description: 'adapter 简介',
      tags: ['adapter'],
      uploader: 'adapter 作者',
      statistics: { view_count: 9 },
      thumbnail: 'https://img.example/adapter.jpg?token=private-token',
      url: 'https://media.example/adapter.mp4',
      cookie: 'private-cookie',
    }), '');
  };
  try {
    const plugin = new PluginClass();
    plugin.settings = {};
    plugin.getInstalledLocalDouyinResolver = () => ({
      executablePath: path.join(os.tmpdir(), 'yt-dlp-test.exe'),
    });
    const result = await plugin.resolveDouyinMediaWithLocalResolver(
      'https://www.douyin.com/video/aweme-123',
      'aweme-123',
    );
    assert.strictEqual(result.identityOutcome, 'target-id-matched');
    assert.strictEqual(result.metadata.title, 'adapter 标题');
    assert.deepStrictEqual(result.metadata.counts, { views: 9 });
    assert.ok(capturedArgs.includes('--dump-single-json'));
    assert.ok(!/private-token|private-cookie/i.test(JSON.stringify(result.metadata)));

    const shortLinkResult = await plugin.resolveDouyinMediaWithLocalResolver(
      'https://v.douyin.com/short-link',
    );
    assert.strictEqual(shortLinkResult.identityOutcome, 'target-id-unverified');
    assert.strictEqual(shortLinkResult.used, true, 'short-link media fallback must remain usable');
    assert.deepStrictEqual(shortLinkResult.metadata, {});

    const mismatchResult = await plugin.resolveDouyinMediaWithLocalResolver(
      'https://www.douyin.com/video/aweme-123',
      'aweme-other',
    );
    assert.strictEqual(mismatchResult.identityOutcome, 'target-id-mismatch');
    assert.strictEqual(mismatchResult.used, false, 'identity mismatch must reject transcription media');
    assert.deepStrictEqual(mismatchResult.mediaUrls, []);
    assert.deepStrictEqual(mismatchResult.metadata, {}, 'mismatched content must not contribute metadata');
  } finally {
    childProcess.execFile = originalExecFile;
  }
}

async function testWechatChannelsCaptureContext() {
  const normalizedFeed = helpers.normalizeWechatChannelsFeedPayload({
    data: {
      object: { viewCount: 88 },
      object_desc: { description: '规范化 feed 正文' },
    },
  });
  assert.deepStrictEqual(normalizedFeed.socialMetrics, { views: 88 });

  const plugin = new PluginClass();
  plugin.settings = {};
  plugin.getActiveBindings = () => [];
  let transcriptOptions;
  let writtenRecord;
  plugin.buildTranscriptRecordFromMedia = async (record, options) => {
    transcriptOptions = options;
    return {
      ...record,
      metadata: {
        ...record.metadata,
        markdown: options.markdown,
        socialMetrics: { views: 77, capturedAt: '2026-10-06T00:00:00.000Z' },
        transcription: '视频号转写正文',
        transcriptionStatus: 'success',
        transcriptionSource: 'local',
        conversionStatus: 'success',
      },
    };
  };
  plugin.writeCapturedWechatChannelsRecord = async (record) => {
    writtenRecord = record;
    return { title: record.metadata.title };
  };

  await plugin.handleWechatChannelsCapturedProfile({
    title: '视频号标题',
    description: '已取得的 feed 发布正文',
    tags: ['知识管理'],
    author: '作者',
    coverUrl: 'https://img.example/channels-cover.jpg',
    socialMetrics: { views: 77 },
    videoUrl: 'https://media.example/channels.mp4',
    mediaUrls: ['https://media.example/channels.mp4'],
    mediaItems: [{ url: 'https://media.example/channels.mp4' }],
  }, 'https://channels.weixin.qq.com/sph/abc');

  assert.ok(transcriptOptions.markdown.includes('已取得的 feed 发布正文'));
  assert.deepStrictEqual(transcriptOptions.socialMetrics, { views: 77 });
  assert.strictEqual(writtenRecord.metadata.description, '已取得的 feed 发布正文');
  assert.deepStrictEqual(writtenRecord.metadata.keywords, ['知识管理']);
  const markdown = helpers.buildMarkdownForRecord({
    record: writtenRecord,
    title: '视频号标题',
    syncedAt: '2026-10-06T00:00:00.000Z',
  });
  assert.ok(markdown.startsWith('---\n'));
  assert.ok(markdown.includes('description: 已取得的 feed 发布正文'));
  assert.ok(markdown.includes('已取得的 feed 发布正文'));
  assert.ok(markdown.includes('视频号转写正文'));
  assert.ok(markdown.includes('https://img.example/channels-cover.jpg'));
  assert.ok(markdown.includes('views: 77'));
}

function testDouyinResolverContextOutput() {
  const merged = helpers.mergeDouyinResolverMetadata(
    { title: '抖音', description: '', tags: [], socialMetrics: {} },
    {
      title: '本地解析标题',
      description: '没有网页正文时仍保留的本地解析简介',
      tags: ['效率工具'],
      thumbnail: 'https://img.example/douyin-cover.jpg',
      uploader: '作者',
      counts: { views: 123 },
    },
  );
  assert.strictEqual(merged.title, '本地解析标题');
  assert.strictEqual(merged.description, '没有网页正文时仍保留的本地解析简介');
  assert.deepStrictEqual(merged.tags, ['效率工具']);
  assert.strictEqual(merged.socialMetrics.views, 123);
  assert.strictEqual(merged.sourceMetadata, 'douyin-local-resolver');
  const rich = helpers.mergeDouyinResolverMetadata(
    { title: '已验证网页标题', description: '这是一段更长且完整的网页正文。', tags: ['网页标签'], coverUrl: 'https://img.example/page-cover.jpg', author: '网页作者', socialMetrics: { views: 456 } },
    { title: '本地解析标题', description: '短简介', tags: ['本地标签'], thumbnail: 'https://img.example/resolver-cover.jpg', uploader: '本地作者', counts: { views: 10 } },
  );
  assert.strictEqual(rich.title, '已验证网页标题');
  assert.strictEqual(rich.description, '这是一段更长且完整的网页正文。');
  assert.strictEqual(rich.coverUrl, 'https://img.example/page-cover.jpg');
  assert.strictEqual(rich.author, '网页作者');
  assert.strictEqual(rich.socialMetrics.views, 456);
  const mergedSupplemental = helpers.mergeDouyinResolverSupplementalMarkdown(
    '## 标题\n\n初始页面标题',
    merged,
  );
  assert.strictEqual((mergedSupplemental.match(/^## 标题$/gm) || []).length, 1);
  assert.ok(mergedSupplemental.includes('## 原文正文'));
  assert.ok(mergedSupplemental.includes('## 标签'));
  assert.ok(mergedSupplemental.includes('## 封面图'));

  const markdown = helpers.buildMarkdownForRecord({
    record: {
      type: 'webpage',
      content: 'https://www.douyin.com/video/aweme-123',
      metadata: {
        title: merged.title,
        description: merged.description,
        keywords: merged.tags,
        coverUrl: merged.coverUrl,
        author: merged.author,
        aiMetadataSource: 'douyin-local-resolver',
        transcriptOnly: true,
        socialMetrics: { views: 123 },
        markdown: mergedSupplemental,
        transcription: '本地解析转写正文',
        transcriptionStatus: 'success',
        transcriptionSource: 'local',
        conversionStatus: 'success',
      },
    },
    title: merged.title,
    syncedAt: '2026-10-06T00:00:00.000Z',
  });
  assert.ok(markdown.startsWith('---\n'));
  assert.ok(markdown.includes('title: 本地解析标题'));
  assert.ok(markdown.includes('description: 没有网页正文时仍保留的本地解析简介'));
  assert.ok(markdown.includes('本地解析转写正文'));
  assert.ok(markdown.includes('https://img.example/douyin-cover.jpg'));
  assert.ok(markdown.includes('keywords:'));
  assert.ok(markdown.includes('效率工具'));
  assert.ok(markdown.includes('views: 123'));
}

async function run() {
  testResolverMetadataAllowlist();
  testDouyinResolverContextOutput();
  await testResolverAdapterIntegration();
  await testWechatChannelsCaptureContext();
  console.log('plugin local resolver metadata tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
