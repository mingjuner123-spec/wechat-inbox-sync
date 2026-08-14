'use strict';

const assert = require('assert');
const {
  buildSocialMediaSupplementalMarkdown,
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

  console.log('social-media-context-utils tests passed');
}

run();
