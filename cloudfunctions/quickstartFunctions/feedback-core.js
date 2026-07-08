function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return defaultValue;
}

function isSupportTicketEvent(event = {}) {
  return String(event.kind || '').trim() === 'support_ticket'
    || Boolean(normalizeText(event.category))
    || Object.prototype.hasOwnProperty.call(event, 'autoReplyEnabled');
}

function normalizeSupportCategory(value) {
  const category = normalizeText(value).toLowerCase();
  if (['question', 'bug', 'billing', 'feedback'].includes(category)) return category;
  return 'feedback';
}

function createFeedbackDocument({ event, openid, appid, now }) {
  if (!openid) {
    throw new Error('OpenID is required');
  }

  const content = normalizeText(event.content);
  if (!content) {
    throw new Error('Feedback content is required');
  }

  const base = {
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

  if (!isSupportTicketEvent(event)) return base;

  const autoReplyEnabled = normalizeBoolean(event.autoReplyEnabled, true);
  return {
    ...base,
    kind: 'support_ticket',
    category: normalizeSupportCategory(event.category),
    autoReplyEnabled,
    hermesStatus: autoReplyEnabled ? 'pending' : 'disabled',
    hermesTaskId: '',
    hermesReply: '',
    hermesError: '',
    requiresHumanReview: false,
    humanReviewReason: '',
    updatedAt: now,
  };
}

function buildHermesTicketPayload({ feedback, feedbackId }) {
  return {
    type: 'support_ticket.created',
    ticket: {
      id: feedbackId,
      openid: feedback.openid || '',
      appid: feedback.appid || '',
      category: feedback.category || 'feedback',
      content: feedback.content || '',
      contact: feedback.contact || '',
      appVersion: feedback.appVersion || '',
      createdAt: feedback.createdAt || '',
    },
    replyTarget: {
      channel: 'wechat-miniprogram-feedback',
      collection: 'feedback',
      documentId: feedbackId,
    },
  };
}

function prepareHermesDispatch({
  feedback,
  feedbackId,
  webhook,
  enabled,
  localQueueEnabled,
} = {}) {
  if (!feedback || feedback.kind !== 'support_ticket' || !feedback.autoReplyEnabled) {
    return {
      shouldDispatch: false,
      mode: 'disabled',
      payload: null,
    };
  }

  const payload = buildHermesTicketPayload({ feedback, feedbackId });
  if (String(enabled || '').toLowerCase() === 'true' && normalizeText(webhook)) {
    return {
      shouldDispatch: true,
      mode: 'webhook',
      payload,
    };
  }

  if (String(localQueueEnabled || '').toLowerCase() === 'true') {
    return {
      shouldDispatch: true,
      mode: 'local_queue',
      payload,
    };
  }

  return {
    shouldDispatch: false,
    mode: 'disabled',
    payload,
  };
}

function createHermesTaskDocument({ payload, mode = 'local_queue', now = new Date().toISOString() } = {}) {
  return {
    taskType: payload && payload.type === 'support_ticket.created' ? 'support_ticket' : 'unknown',
    mode,
    status: 'pending',
    payload: payload || {},
    createdAt: now,
    updatedAt: now,
    startedAt: '',
    completedAt: '',
    error: '',
    result: null,
  };
}

function pickFirstText(...values) {
  const value = values.find((item) => normalizeText(item));
  return normalizeText(value);
}

function pickHermesActions(response = {}) {
  if (Array.isArray(response.actions)) return response.actions;
  if (response.data && Array.isArray(response.data.actions)) return response.data.actions;
  if (response.result && Array.isArray(response.result.actions)) return response.result.actions;
  return [];
}

function normalizeHermesApiResponse(response) {
  const raw = response === undefined || response === null ? {} : response;
  const object = raw && typeof raw === 'object' ? raw : { message: normalizeText(raw) };
  const data = object.data && typeof object.data === 'object' ? object.data : {};
  const result = object.result && typeof object.result === 'object' ? object.result : {};
  const reply = pickFirstText(
    object.reply,
    object.answer,
    object.message,
    object.text,
    data.reply,
    data.answer,
    data.message,
    data.text,
    result.reply,
    result.answer,
    result.message,
    result.text,
  );
  const requiresHumanReview = Boolean(
    object.requiresHumanReview
      || object.needReview
      || object.needsReview
      || data.requiresHumanReview
      || data.needReview
      || data.needsReview
      || result.requiresHumanReview
      || result.needReview
      || result.needsReview
  );
  const actions = pickHermesActions(object);
  return {
    status: reply ? 'replied' : (requiresHumanReview ? 'needs_review' : 'sent'),
    reply,
    requiresHumanReview,
    actions,
    raw,
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
  buildHermesTicketPayload,
  buildFeishuFeedbackMessage,
  createHermesTaskDocument,
  createFeedbackDocument,
  normalizeHermesApiResponse,
  prepareHermesDispatch,
  prepareFeedbackNotification,
  shouldSendFeishuFeedback,
};
