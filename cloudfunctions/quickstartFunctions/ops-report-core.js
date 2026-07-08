function toNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatAmountFen(value) {
  return `${(Math.max(0, toNumber(value)) / 100).toFixed(2)} yuan`;
}

function getChinaLocalDay(value = new Date().toISOString()) {
  const date = new Date(value);
  const time = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isInChinaLocalDay(item, fields, day) {
  return fields.some((field) => {
    const value = item && item[field];
    return value && getChinaLocalDay(value) === day;
  });
}

function buildDailyOpsReport({
  day = getChinaLocalDay(),
  orders = [],
  feedbacks = [],
  hermesTasks = [],
} = {}) {
  const dayOrders = (orders || []).filter((item) => isInChinaLocalDay(item, ['paidAt', 'createdAt'], day));
  const paidOrders = dayOrders.filter((item) => item.status === 'paid');
  const pendingOrders = dayOrders.filter((item) => item.status === 'pending');
  const dayFeedbacks = (feedbacks || []).filter((item) => isInChinaLocalDay(item, ['createdAt', 'updatedAt'], day));
  const dayHermesTasks = (hermesTasks || []).filter((item) => isInChinaLocalDay(item, ['updatedAt', 'createdAt'], day));

  const paidAmountFen = paidOrders.reduce((sum, item) => sum + toNumber(item.amountFen), 0);
  const hermesReplyCount = dayFeedbacks
    .filter((item) => ['replied', 'answered'].includes(String(item.hermesStatus || '')))
    .length;
  const localFixDoneCount = dayHermesTasks
    .filter((item) => item.taskType === 'local_fix' && item.status === 'done')
    .length;
  const needsReviewCount = dayFeedbacks.filter((item) => item.requiresHumanReview).length
    + dayHermesTasks.filter((item) => item.status === 'needs_review').length;

  const payment = {
    orderCount: dayOrders.length,
    paidOrderCount: paidOrders.length,
    pendingOrderCount: pendingOrders.length,
    paidAmountFen,
    paidAmountText: formatAmountFen(paidAmountFen),
  };
  const work = {
    supportTicketCount: dayFeedbacks.filter((item) => item.kind === 'support_ticket').length,
    hermesReplyCount,
    localFixDoneCount,
    needsReviewCount,
  };

  const text = [
    `Daily Ops Report ${day}`,
    '',
    `Orders: ${payment.orderCount}`,
    `Paid orders: ${payment.paidOrderCount}`,
    `Pending orders: ${payment.pendingOrderCount}`,
    `Paid amount: ${payment.paidAmountText}`,
    '',
    `Support tickets: ${work.supportTicketCount}`,
    `Hermes replies: ${work.hermesReplyCount}`,
    `Local fixes done: ${work.localFixDoneCount}`,
    `Needs review: ${work.needsReviewCount}`,
  ].join('\n');

  return {
    day,
    payment,
    work,
    text,
  };
}

function buildDailyOpsReportWebhookPayload(report = {}) {
  return {
    msg_type: 'text',
    content: {
      text: report.text || '',
    },
  };
}

module.exports = {
  buildDailyOpsReport,
  buildDailyOpsReportWebhookPayload,
  formatAmountFen,
  getChinaLocalDay,
  isInChinaLocalDay,
};
