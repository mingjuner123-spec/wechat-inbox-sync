const {
  DEFAULT_REDEEM_PLAN,
  addDaysIso,
  getDefaultCloudQuotaSeconds,
} = require('./redeem-code-core');

const PAYMENT_PLANS = {
  pro_month: {
    id: 'pro_month',
    name: 'Pro 月卡',
    priceFen: 2900,
    durationDays: 30,
  },
  pro_year: {
    id: 'pro_year',
    name: 'Pro 年卡',
    priceFen: 19900,
    durationDays: 365,
  },
};

function normalizePaymentPlanId(planId) {
  return PAYMENT_PLANS[planId] ? planId : 'pro_month';
}

function formatAmountFen(value) {
  const fen = Math.max(0, Number(value) || 0);
  return `${(fen / 100).toFixed(2)} 元`;
}

function createPaymentOrderNo(now, randomSuffix = () => Math.random().toString(36).slice(2, 8).toUpperCase()) {
  const date = new Date(now);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const stamp = safeDate.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffix = String(randomSuffix() || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8) || 'ORDER';
  return `OBPAY${stamp}${suffix}`;
}

function createPaymentOrderDocument({
  openid,
  planId,
  now = new Date().toISOString(),
  randomSuffix,
} = {}) {
  if (!openid) throw new Error('OpenID is required');
  const normalizedPlanId = normalizePaymentPlanId(planId);
  const plan = PAYMENT_PLANS[normalizedPlanId];
  return {
    orderNo: createPaymentOrderNo(now, randomSuffix),
    openid,
    planId: normalizedPlanId,
    planName: plan.name,
    status: 'pending',
    amountFen: plan.priceFen,
    durationDays: plan.durationDays,
    payMode: 'manual_pending',
    paymentEnabled: false,
    createdAt: now,
    updatedAt: now,
    paidAt: '',
  };
}

function buildPaymentOrderState(order = {}) {
  const planId = normalizePaymentPlanId(order.planId);
  const plan = PAYMENT_PLANS[planId];
  return {
    orderNo: order.orderNo || '',
    status: order.status || 'pending',
    planId,
    planName: order.planName || plan.name,
    amountFen: Number(order.amountFen) || plan.priceFen,
    amountText: formatAmountFen(Number(order.amountFen) || plan.priceFen),
    durationDays: Number(order.durationDays) || plan.durationDays,
    paymentEnabled: Boolean(order.paymentEnabled),
    payMode: order.payMode || 'manual_pending',
    message: order.message || '微信支付商户号配置完成后可直接拉起支付；当前订单需人工确认。',
    createdAt: order.createdAt || '',
    paidAt: order.paidAt || '',
  };
}

function createPaidEntitlementFromOrder({ order, now = new Date().toISOString() } = {}) {
  if (!order || !order.openid) throw new Error('Payment order is required');
  const durationDays = Number(order.durationDays) || PAYMENT_PLANS[normalizePaymentPlanId(order.planId)].durationDays;
  return {
    openid: order.openid,
    plan: DEFAULT_REDEEM_PLAN,
    status: 'active',
    source: 'payment',
    code: order.orderNo || '',
    durationDays,
    cloudQuotaSeconds: getDefaultCloudQuotaSeconds(durationDays),
    cloudUsedSeconds: 0,
    redeemedAt: now,
    expiresAt: addDaysIso(now, durationDays),
    updatedAt: now,
  };
}

module.exports = {
  PAYMENT_PLANS,
  normalizePaymentPlanId,
  formatAmountFen,
  createPaymentOrderNo,
  createPaymentOrderDocument,
  buildPaymentOrderState,
  createPaidEntitlementFromOrder,
};
