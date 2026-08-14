'use strict';

const assert = require('assert');
const {
  buildSocialMediaSupplementalMarkdown,
  createSocialMediaContextHtmlBuilder,
  normalizeSocialMediaImageUrl,
} = require('../obsidian-plugin/wechat-inbox-sync/src/social-media-context-utils');

function run() {
  assert.strictEqual(
    normalizeSocialMediaImageUrl(' //img.example.com/cover.jpg '),
    'https://img.example.com/cover.jpg',
  );
  assert.strictEqual(normalizeSocialMediaImageUrl('blob:https://example.com/video'), '');

  assert.strictEqual(buildSocialMediaSupplementalMarkdown({
    title: '抖音作品标题',
    description: '原文正文',
    tags: ['AI', '#Obsidian', 'AI', ''],
    imageUrls: ['https://img.example.com/cover.jpg', '', 'data:image/png;base64,test'],
  }), [
    '## 标题',
    '',
    '抖音作品标题',
    '',
    '## 原文正文',
    '',
    '原文正文',
    '',
    '## 标签',
    '',
    '#AI #Obsidian',
    '',
    '## 封面图',
    '',
    '![封面](https://img.example.com/cover.jpg)',
  ].join('\n'));

  assert.strictEqual(buildSocialMediaSupplementalMarkdown({
    title: '只有标题',
    imageUrls: ['https://img.example.com/a.jpg', 'https://img.example.com/a.jpg'],
  }), [
    '## 标题',
    '',
    '只有标题',
    '',
    '## 封面图',
    '',
    '![封面](https://img.example.com/a.jpg)',
  ].join('\n'));

  const buildFromHtml = createSocialMediaContextHtmlBuilder({
    extractPageMetadata: () => ({
      title: 'B站视频标题',
      description: 'B站原文简介 #知识管理',
      keywords: ['笔记'],
    }),
    extractTagsFromText: () => ['知识管理'],
    extractMetaContent: () => 'https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png',
    collectImageUrls: () => [
      'https://i0.hdslb.com/bfs/static/jinkela/long/images/512.png',
      'https://img.example.com/real-cover.jpg',
    ],
    normalizeUrl: (value) => String(value || '').trim(),
    isBilibiliUrl: () => true,
  });
  assert.match(buildFromHtml('<html></html>', 'https://www.bilibili.com/video/BV1'), /real-cover\.jpg/);
  assert.doesNotMatch(buildFromHtml('<html></html>', 'https://www.bilibili.com/video/BV1'), /jinkela/);

  console.log('social-media-context-utils tests passed');
}

run();
