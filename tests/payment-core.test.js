const assert = require('assert');

const {
  PAYMENT_PLANS,
  normalizePaymentPlanId,
  createPaymentOrderDocument,
  buildPaymentOrderState,
  createPaidEntitlementFromOrder,
} = require('../cloudfunctions/quickstartFunctions/payment-core');

assert.strictEqual(PAYMENT_PLANS.pro_month.priceFen, 2900);
assert.strictEqual(PAYMENT_PLANS.pro_month.durationDays, 30);
assert.strictEqual(PAYMENT_PLANS.pro_year.priceFen, 19900);
assert.strictEqual(PAYMENT_PLANS.pro_year.durationDays, 365);

assert.strictEqual(normalizePaymentPlanId('pro_year'), 'pro_year');
assert.strictEqual(normalizePaymentPlanId('unknown'), 'pro_month');

const order = createPaymentOrderDocument({
  openid: 'openid-1',
  planId: 'pro_year',
  now: '2026-06-15T10:00:00.000Z',
  randomSuffix: () => 'ABC123',
});

assert.strictEqual(order.orderNo, 'OBPAY20260615100000ABC123');
assert.strictEqual(order.openid, 'openid-1');
assert.strictEqual(order.planId, 'pro_year');
assert.strictEqual(order.status, 'pending');
assert.strictEqual(order.amountFen, 19900);
assert.strictEqual(order.durationDays, 365);
assert.strictEqual(order.payMode, 'manual_pending');
assert.strictEqual(order.paymentEnabled, false);

assert.deepStrictEqual(buildPaymentOrderState(order), {
  orderNo: 'OBPAY20260615100000ABC123',
  status: 'pending',
  planId: 'pro_year',
  planName: 'Pro 年卡',
  amountFen: 19900,
  amountText: '199.00 元',
  durationDays: 365,
  paymentEnabled: false,
  payMode: 'manual_pending',
  message: '微信支付商户号配置完成后可直接拉起支付；当前订单需人工确认。',
  createdAt: '2026-06-15T10:00:00.000Z',
  paidAt: '',
});

assert.deepStrictEqual(createPaidEntitlementFromOrder({
  order,
  now: '2026-06-15T11:00:00.000Z',
}), {
  openid: 'openid-1',
  plan: 'local_transcription_beta',
  status: 'active',
  source: 'payment',
  code: 'OBPAY20260615100000ABC123',
  durationDays: 365,
  cloudQuotaSeconds: 60000,
  cloudUsedSeconds: 0,
  redeemedAt: '2026-06-15T11:00:00.000Z',
  expiresAt: '2027-06-15T11:00:00.000Z',
  updatedAt: '2026-06-15T11:00:00.000Z',
});
