const assert = require('assert');
const { loadPlugin } = require('./helpers/load-plugin');

const helpers = loadPlugin().__test;

assert.strictEqual(typeof helpers.extractXiaohongshuCommentsFromApiPayload, 'function');
assert.strictEqual(typeof helpers.buildSocialCommentsMarkdown, 'function');

const threadedComments = helpers.extractXiaohongshuCommentsFromApiPayload({
  data: {
    comments: [
      {
        id: 'root-1',
        content: '用户1的主评论',
        user: { nickName: '用户1' },
        sub_comments: [
          {
            id: 'reply-1',
            root_comment_id: 'root-1',
            parent_comment_id: 'root-1',
            content: '用户A第一次回复用户1',
            user: { nickName: '用户A' },
          },
        ],
      },
      {
        id: 'root-2',
        content: '用户2的主评论',
        user: { nickName: '用户2' },
      },
      {
        id: 'reply-2',
        root_comment_id: 'root-1',
        parent_comment_id: 'reply-1',
        target_comment: { user: { nickName: '用户A' } },
        content: '用户1展开后的二次回复',
        user: { nickName: '用户1' },
      },
    ],
  },
});

assert.strictEqual(threadedComments.length, 2);
assert.strictEqual(threadedComments[0].author, '用户1');
assert.strictEqual(threadedComments[0].replies.length, 2);
assert.strictEqual(threadedComments[0].replies[1].replyTo, '用户A');
assert.strictEqual(threadedComments[1].author, '用户2');

const markdown = helpers.buildSocialCommentsMarkdown(threadedComments);
const root1Index = markdown.indexOf('**用户1**：用户1的主评论');
const userAIndex = markdown.indexOf('**用户A** 回复 **用户1**：用户A第一次回复用户1');
const user1SecondReplyIndex = markdown.indexOf('**用户1** 回复 **用户A**：用户1展开后的二次回复');
const root2Index = markdown.indexOf('**用户2**：用户2的主评论');

assert.ok(root1Index >= 0);
assert.ok(userAIndex > root1Index);
assert.ok(user1SecondReplyIndex > userAIndex);
assert.ok(root2Index > user1SecondReplyIndex);

console.log('xiaohongshu comments boundary checks passed');
