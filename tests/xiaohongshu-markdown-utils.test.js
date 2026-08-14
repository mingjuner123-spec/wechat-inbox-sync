'use strict';

const assert = require('assert');
const {
  createXiaohongshuMarkdownBuilder,
} = require('../obsidian-plugin/wechat-inbox-sync/src/xiaohongshu-markdown-utils');

const buildMarkdown = createXiaohongshuMarkdownBuilder({
  buildCommentsMarkdown: (comments) => comments.length
    ? '## Comments\n\nFirst comment'
    : '',
});

function run() {
  const markdown = buildMarkdown({
    title: 'Original note title',
    description: 'Original note body',
    tags: ['#Parenting', '#Obsidian'],
    imageUrls: [
      'https://img.example.com/cover.jpg',
      'https://img.example.com/page-1.jpg',
    ],
    videoUrl: 'https://media.example.com/video.mp4',
    comments: [{ content: 'First comment' }],
  });

  const titleIndex = markdown.indexOf('Original note title');
  const bodyIndex = markdown.indexOf('Original note body');
  const tagsIndex = markdown.indexOf('#Parenting #Obsidian');
  const coverIndex = markdown.indexOf('cover.jpg');
  const pageIndex = markdown.indexOf('page-1.jpg');
  const videoIndex = markdown.indexOf('video.mp4');
  const commentsIndex = markdown.indexOf('First comment');
  assert.ok(titleIndex >= 0 && titleIndex < bodyIndex);
  assert.ok(bodyIndex < tagsIndex && tagsIndex < coverIndex && coverIndex < pageIndex);
  assert.ok(pageIndex < videoIndex && videoIndex < commentsIndex);

  const fallback = buildMarkdown({ title: 'Untitled note' });
  assert.match(fallback, /Untitled note/);
  assert.match(fallback, /\u9875\u9762\u672a\u76f4\u63a5\u66b4\u9732\u6b63\u6587/);

  console.log('xiaohongshu-markdown-utils tests passed');
}

run();
