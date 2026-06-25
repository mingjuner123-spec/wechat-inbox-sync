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
        content: 'root one',
        user: { nickName: 'User 1' },
        sub_comments: [
          {
            id: 'reply-1',
            root_comment_id: 'root-1',
            parent_comment_id: 'root-1',
            content: 'first reply',
            user: { nickName: 'User A' },
          },
        ],
      },
      {
        id: 'root-2',
        content: 'root two',
        user: { nickName: 'User 2' },
      },
      {
        id: 'reply-2',
        root_comment_id: 'root-1',
        parent_comment_id: 'reply-1',
        target_comment: { user: { nickName: 'User A' } },
        content: 'expanded second reply',
        user: { nickName: 'User 1' },
      },
    ],
  },
});

assert.strictEqual(threadedComments.length, 2);
assert.strictEqual(threadedComments[0].author, 'User 1');
assert.strictEqual(threadedComments[0].replies.length, 1);
assert.strictEqual(threadedComments[0].replies[0].replyTo, 'User 1');
assert.strictEqual(threadedComments[0].replies[0].replies.length, 1);
assert.strictEqual(threadedComments[0].replies[0].replies[0].replyTo, 'User A');
assert.strictEqual(threadedComments[1].author, 'User 2');

const markdown = helpers.buildSocialCommentsMarkdown(threadedComments);
const root1Index = markdown.indexOf('**User 1**');
const userAIndex = markdown.indexOf('**User A**');
const user1SecondReplyIndex = markdown.indexOf('expanded second reply');
const root2Index = markdown.indexOf('**User 2**');

assert.ok(root1Index >= 0);
assert.ok(userAIndex > root1Index);
assert.ok(user1SecondReplyIndex > userAIndex);
assert.ok(root2Index > user1SecondReplyIndex);

console.log('xiaohongshu comments boundary checks passed');
