const assert = require('assert');

const {
  buildHermesTicketPayload,
  createFeedbackDocument,
  normalizeHermesApiResponse,
  prepareHermesDispatch,
} = require('../cloudfunctions/quickstartFunctions/feedback-core');
const {
  buildDailyOpsReport,
  buildDailyOpsReportWebhookPayload,
} = require('../cloudfunctions/quickstartFunctions/ops-report-core');

const ticket = createFeedbackDocument({
  event: {
    content: 'How do I bind Obsidian?',
    contact: 'wechat:user-1',
    appVersion: '0.2.0',
    category: 'question',
    autoReplyEnabled: true,
  },
  openid: 'openid-1',
  appid: 'wx-app',
  now: '2026-07-06T13:00:00.000Z',
});

assert.strictEqual(ticket.kind, 'support_ticket');
assert.strictEqual(ticket.category, 'question');
assert.strictEqual(ticket.autoReplyEnabled, true);
assert.strictEqual(ticket.hermesStatus, 'pending');
assert.strictEqual(ticket.requiresHumanReview, false);

assert.deepStrictEqual(buildHermesTicketPayload({
  feedback: ticket,
  feedbackId: 'feedback-1',
}), {
  type: 'support_ticket.created',
  ticket: {
    id: 'feedback-1',
    openid: 'openid-1',
    appid: 'wx-app',
    category: 'question',
    content: 'How do I bind Obsidian?',
    contact: 'wechat:user-1',
    appVersion: '0.2.0',
    createdAt: '2026-07-06T13:00:00.000Z',
  },
  replyTarget: {
    channel: 'wechat-miniprogram-feedback',
    collection: 'feedback',
    documentId: 'feedback-1',
  },
});

assert.deepStrictEqual(prepareHermesDispatch({
  feedback: ticket,
  feedbackId: 'feedback-1',
  webhook: 'https://hermes.example.test/tickets',
  enabled: 'true',
}), {
  shouldDispatch: true,
  mode: 'webhook',
  payload: buildHermesTicketPayload({ feedback: ticket, feedbackId: 'feedback-1' }),
});

assert.deepStrictEqual(prepareHermesDispatch({
  feedback: ticket,
  feedbackId: 'feedback-1',
  webhook: '',
  enabled: 'true',
  localQueueEnabled: 'true',
}), {
  shouldDispatch: true,
  mode: 'local_queue',
  payload: buildHermesTicketPayload({ feedback: ticket, feedbackId: 'feedback-1' }),
});

assert.deepStrictEqual(normalizeHermesApiResponse({
  success: true,
  reply: 'Open the bind tab and paste your Obsidian code.',
  requiresHumanReview: false,
  actions: [{ type: 'knowledge_reply', title: 'Binding answer' }],
}), {
  status: 'replied',
  reply: 'Open the bind tab and paste your Obsidian code.',
  requiresHumanReview: false,
  actions: [{ type: 'knowledge_reply', title: 'Binding answer' }],
  raw: {
    success: true,
    reply: 'Open the bind tab and paste your Obsidian code.',
    requiresHumanReview: false,
    actions: [{ type: 'knowledge_reply', title: 'Binding answer' }],
  },
});

assert.deepStrictEqual(normalizeHermesApiResponse({
  data: {
    answer: 'This looks like a small fix. I created a local task.',
    needReview: true,
    actions: [{ type: 'local_fix', title: 'Patch support copy' }],
  },
}), {
  status: 'replied',
  reply: 'This looks like a small fix. I created a local task.',
  requiresHumanReview: true,
  actions: [{ type: 'local_fix', title: 'Patch support copy' }],
  raw: {
    data: {
      answer: 'This looks like a small fix. I created a local task.',
      needReview: true,
      actions: [{ type: 'local_fix', title: 'Patch support copy' }],
    },
  },
});

assert.deepStrictEqual(normalizeHermesApiResponse({
  needsReview: true,
}), {
  status: 'needs_review',
  reply: '',
  requiresHumanReview: true,
  actions: [],
  raw: {
    needsReview: true,
  },
});

const report = buildDailyOpsReport({
  day: '2026-07-06',
  orders: [
    {
      orderNo: 'OBPAY1',
      status: 'paid',
      amountFen: 4990,
      paidAt: '2026-07-06T02:00:00.000Z',
      createdAt: '2026-07-06T01:00:00.000Z',
    },
    {
      orderNo: 'OBPAY2',
      status: 'pending',
      amountFen: 990,
      createdAt: '2026-07-06T08:00:00.000Z',
    },
    {
      orderNo: 'OBPAY0',
      status: 'paid',
      amountFen: 990,
      paidAt: '2026-07-05T02:00:00.000Z',
      createdAt: '2026-07-05T01:00:00.000Z',
    },
  ],
  feedbacks: [
    { kind: 'support_ticket', hermesStatus: 'replied', createdAt: '2026-07-06T03:00:00.000Z' },
    { kind: 'support_ticket', requiresHumanReview: true, createdAt: '2026-07-06T04:00:00.000Z' },
  ],
  hermesTasks: [
    { taskType: 'local_fix', status: 'done', updatedAt: '2026-07-06T09:00:00.000Z' },
    { taskType: 'local_fix', status: 'needs_review', updatedAt: '2026-07-06T10:00:00.000Z' },
  ],
});

assert.deepStrictEqual(report.payment, {
  orderCount: 2,
  paidOrderCount: 1,
  pendingOrderCount: 1,
  paidAmountFen: 4990,
  paidAmountText: '49.90 yuan',
});
assert.deepStrictEqual(report.work, {
  supportTicketCount: 2,
  hermesReplyCount: 1,
  localFixDoneCount: 1,
  needsReviewCount: 2,
});
assert.match(report.text, /Daily Ops Report 2026-07-06/);
assert.match(report.text, /Paid amount: 49.90 yuan/);
assert.match(report.text, /Needs review: 2/);

assert.deepStrictEqual(buildDailyOpsReportWebhookPayload(report), {
  msg_type: 'text',
  content: {
    text: report.text,
  },
});
