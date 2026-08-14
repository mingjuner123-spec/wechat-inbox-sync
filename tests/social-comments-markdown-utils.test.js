'use strict';

const assert = require('assert');
const {
  createSocialCommentsMarkdownBuilder,
} = require('../obsidian-plugin/wechat-inbox-sync/src/social-comments-markdown-utils');

const buildSocialCommentsMarkdown = createSocialCommentsMarkdownBuilder({
  normalizeComment: (comment) => comment && comment.content ? comment : null,
  formatTime: (value) => value || '',
  formatLikes: (value) => value || '',
});

function run() {
  const markdown = buildSocialCommentsMarkdown([
    {
      author: 'Alice',
      content: 'First root comment',
      time: '2026-08-14',
      likes: '12',
      replies: [{ author: 'Bob', content: 'Reply comment' }],
    },
    { author: 'Carol', content: 'Second root comment' },
  ]);

  assert.match(markdown, /^## \u8bc4\u8bba\u533a/m);
  const first = markdown.indexOf('First root comment');
  const reply = markdown.indexOf('Reply comment');
  const second = markdown.indexOf('Second root comment');
  assert.ok(first >= 0 && first < reply && reply < second);
  assert.match(markdown, /\*\*Alice\*\*/);
  assert.match(markdown, /\u21b3 .*Reply comment/);
  assert.strictEqual(buildSocialCommentsMarkdown([]), '');

  console.log('social-comments-markdown-utils tests passed');
}

run();
