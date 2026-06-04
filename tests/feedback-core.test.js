const assert = require('assert');

const {
  buildFeishuFeedbackMessage,
  createFeedbackDocument,
  prepareFeedbackNotification,
  shouldSendFeishuFeedback,
} = require('../cloudfunctions/quickstartFunctions/feedback-core');

const doc = createFeedbackDocument({
  event: {
    content: '绑定时看不懂云函数 HTTP 路由怎么配',
    contact: 'feishu-user',
    appVersion: '0.1.0',
  },
  openid: 'openid-1',
  appid: 'wx-app',
  now: '2026-05-13T15:00:00.000Z',
});

assert.deepStrictEqual(doc, {
  openid: 'openid-1',
  appid: 'wx-app',
  content: '绑定时看不懂云函数 HTTP 路由怎么配',
  contact: 'feishu-user',
  appVersion: '0.1.0',
  status: 'new',
  source: 'wechat-miniprogram',
  createdAt: '2026-05-13T15:00:00.000Z',
  notifiedAt: null,
  notificationStatus: 'pending',
  notificationError: '',
});

assert.throws(() => createFeedbackDocument({
  event: {
    content: '  ',
  },
  openid: 'openid-1',
  now: '2026-05-13T15:00:00.000Z',
}), /Feedback content is required/);

const message = buildFeishuFeedbackMessage({
  feedback: doc,
  feedbackId: 'feedback-1',
});

assert.deepStrictEqual(message, {
  msg_type: 'text',
  content: {
    text: [
      '收到新的 Obsidian 收集箱反馈',
      '内容：绑定时看不懂云函数 HTTP 路由怎么配',
      '联系方式：feishu-user',
      '版本：0.1.0',
      'OpenID：openid-1',
      '反馈 ID：feedback-1',
      '时间：2026-05-13T15:00:00.000Z',
    ].join('\n'),
  },
});

assert.strictEqual(shouldSendFeishuFeedback(''), false);
assert.strictEqual(shouldSendFeishuFeedback('   '), false);
assert.strictEqual(shouldSendFeishuFeedback(null), false);
assert.strictEqual(
  shouldSendFeishuFeedback('https://open.feishu.cn/open-apis/bot/v2/hook/example'),
  false,
);
assert.strictEqual(
  shouldSendFeishuFeedback('https://open.feishu.cn/open-apis/bot/v2/hook/example', 'true'),
  true,
);

assert.deepStrictEqual(prepareFeedbackNotification({
  feedback: doc,
  webhook: '',
  enabled: '',
}), {
  shouldNotify: false,
  feedback: {
    ...doc,
    notificationStatus: 'skipped',
    notificationError: '',
  },
});

assert.deepStrictEqual(prepareFeedbackNotification({
  feedback: doc,
  webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/example',
  enabled: 'true',
}), {
  shouldNotify: true,
  feedback: doc,
});
