const assert = require('assert');

const {
  createCommentModel,
  normalizeSocialComment,
  pushSocialComment,
  threadSocialComments,
  buildSocialCommentsMarkdown,
} = require('../src/comments/model');

const model = createCommentModel({
  limit: 10,
  isNoiseText: (text) => /^noise$/i.test(String(text || '').trim()),
  labels: {
    sectionTitle: '评论区',
    anonymous: '匿名用户',
    reply: '回复',
    likes: '赞',
    separator: ' · ',
    colon: '：',
    metaOpen: '（',
    metaClose: '）',
  },
});

assert.strictEqual(normalizeSocialComment({ author: '用户甲', content: ' 正文评论 ' }).content, '正文评论');
assert.strictEqual(model.normalizeSocialComment({ author: 'noise', content: '正文评论' }), null);
assert.strictEqual(model.normalizeSocialComment({ author: '用户甲', content: 'noise' }), null);

const comments = [];
const seen = new Set();
pushSocialComment(comments, seen, { id: '1', author: '用户甲', content: '第一条' });
pushSocialComment(comments, seen, { id: '1-dup', author: '用户甲', content: '第一条' });
pushSocialComment(comments, seen, { id: '2', author: '用户乙', content: '第二条' });
assert.deepStrictEqual(comments.map((comment) => comment.author), ['用户甲', '用户乙']);

const threaded = threadSocialComments([
  { id: 'root-1', author: '用户1', content: '主评论' },
  { id: 'reply-1', rootId: 'root-1', parentId: 'root-1', author: '用户2', content: '回复1' },
  { id: 'reply-2', rootId: 'root-1', parentId: 'reply-1', author: '用户1', content: '展开后的二次回复', replyTo: '用户2' },
  { id: 'root-2', author: '用户3', content: '另一条主评论' },
], 10);
assert.strictEqual(threaded.length, 2);
assert.strictEqual(threaded[0].author, '用户1');
assert.strictEqual(threaded[0].replies.length, 2);
assert.strictEqual(threaded[0].replies[1].content, '展开后的二次回复');
assert.strictEqual(threaded[0].replies[1].replyTo, '用户2');
assert.strictEqual(threaded[1].author, '用户3');

const markdown = buildSocialCommentsMarkdown(threaded, { limit: 10 });
assert.ok(markdown.includes('## 评论区'));
assert.ok(markdown.includes('- **用户1**：主评论'));
assert.ok(markdown.includes('  - **用户2** 回复 **用户1**：回复1'));
assert.ok(markdown.includes('  - **用户1** 回复 **用户2**：展开后的二次回复'));
assert.ok(markdown.includes('- **用户3**：另一条主评论'));

console.log('comments model boundary checks passed');
