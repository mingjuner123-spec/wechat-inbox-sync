function normalizeText(value) {
  return String(value || '').trim();
}

function createFeedbackDocument({ event, openid, appid, now }) {
  if (!openid) {
    throw new Error('OpenID is required');
  }

  const content = normalizeText(event.content);
  if (!content) {
    throw new Error('Feedback content is required');
  }

  return {
    openid,
    appid: appid || '',
    content,
    contact: normalizeText(event.contact),
    appVersion: normalizeText(event.appVersion),
    status: 'new',
    source: 'wechat-miniprogram',
    createdAt: now,
    notifiedAt: null,
    notificationStatus: 'pending',
    notificationError: '',
  };
}

function buildFeishuFeedbackMessage({ feedback, feedbackId }) {
  const lines = [
    '收到新的 Obsidian 收集箱反馈',
    `内容：${feedback.content}`,
    `联系方式：${feedback.contact || '未填写'}`,
    `版本：${feedback.appVersion || '未提供'}`,
    `OpenID：${feedback.openid}`,
    `反馈 ID：${feedbackId}`,
    `时间：${feedback.createdAt}`,
  ];

  return {
    msg_type: 'text',
    content: {
      text: lines.join('\n'),
    },
  };
}

function shouldSendFeishuFeedback(webhook, enabled) {
  return String(enabled || '').toLowerCase() === 'true'
    && Boolean(String(webhook || '').trim());
}

function prepareFeedbackNotification({ feedback, webhook, enabled }) {
  if (shouldSendFeishuFeedback(webhook, enabled)) {
    return {
      shouldNotify: true,
      feedback,
    };
  }

  return {
    shouldNotify: false,
    feedback: {
      ...feedback,
      notificationStatus: 'skipped',
      notificationError: '',
    },
  };
}

module.exports = {
  buildFeishuFeedbackMessage,
  createFeedbackDocument,
  prepareFeedbackNotification,
  shouldSendFeishuFeedback,
};
