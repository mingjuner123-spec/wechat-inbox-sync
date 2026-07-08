const assert = require('assert');
const crypto = require('crypto');

const {
  PAYMENT_PLANS,
  normalizePaymentPlanId,
  createPaymentOrderDocument,
  buildPaymentOrderState,
  createVirtualPaymentPayload,
  createVirtualPaymentQueryOrderRequest,
  createVirtualPaymentProvideGoodsRequest,
  normalizeWechatVirtualPaymentOrder,
  isWechatVirtualPaymentOrderPaid,
  buildPaymentNotificationText,
  buildPaymentNotificationWebhookPayload,
  parseVirtualPaymentNotifyBody,
  createWechatMessageSignature,
  verifyWechatMessageSignature,
  createVirtualPaymentNotifyResponse,
  createPaidEntitlementFromOrder,
  pickPaymentCarryoverEntitlement,
  mergePaidEntitlementWithCarryover,
  createPaidRedeemCodeDocument,
} = require('../cloudfunctions/quickstartFunctions/payment-core');

function hmacSha256Hex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

assert.strictEqual(PAYMENT_PLANS.pro_month.priceFen, 990);
assert.strictEqual(PAYMENT_PLANS.pro_month.durationDays, 30);
assert.strictEqual(PAYMENT_PLANS.pro_year.priceFen, 4990);
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
assert.strictEqual(order.amountFen, 4990);
assert.strictEqual(order.durationDays, 365);
assert.strictEqual(order.payMode, 'manual_pending');
assert.strictEqual(order.paymentEnabled, false);

assert.deepStrictEqual(buildPaymentOrderState(order), {
  orderNo: 'OBPAY20260615100000ABC123',
  status: 'pending',
  planId: 'pro_year',
  planName: 'Pro 年卡',
  amountFen: 4990,
  amountText: '49.90 元',
  durationDays: 365,
  paymentEnabled: false,
  payMode: 'manual_pending',
  message: '微信虚拟支付配置未生效，请检查云函数环境变量并重新部署 quickstartFunctions；当前订单不会自动拉起支付。',
  createdAt: '2026-06-15T10:00:00.000Z',
  paidAt: '',
});

const virtualPayment = createVirtualPaymentPayload({
  order,
  offerId: '1450000000',
  appKey: 'app-key-prod',
  sessionKey: 'session-key-1',
  env: 0,
});
const signData = JSON.stringify({
  offerId: '1450000000',
  buyQuantity: 1,
  env: 0,
  currencyType: 'CNY',
  productId: 'pro_year',
  goodsPrice: 4990,
  outTradeNo: 'OBPAY20260615100000ABC123',
  attach: JSON.stringify({
    orderNo: 'OBPAY20260615100000ABC123',
    planId: 'pro_year',
  }),
});
assert.deepStrictEqual(virtualPayment, {
  mode: 'short_series_goods',
  signData,
  paySig: hmacSha256Hex('app-key-prod', `requestVirtualPayment&${signData}`),
  signature: hmacSha256Hex('session-key-1', signData),
});

const queryOrderRequest = createVirtualPaymentQueryOrderRequest({
  order,
  appKey: 'app-key-prod',
  accessToken: 'ACCESS_TOKEN_1',
  env: 0,
});
const queryOrderBody = JSON.stringify({
  openid: 'openid-1',
  env: 0,
  order_id: 'OBPAY20260615100000ABC123',
});
assert.deepStrictEqual(queryOrderRequest, {
  url: `https://api.weixin.qq.com/xpay/query_order?access_token=ACCESS_TOKEN_1&pay_sig=${hmacSha256Hex('app-key-prod', `/xpay/query_order&${queryOrderBody}`)}`,
  body: queryOrderBody,
});

const provideGoodsRequest = createVirtualPaymentProvideGoodsRequest({
  order,
  appKey: 'app-key-prod',
  accessToken: 'ACCESS_TOKEN_1',
  wxOrderId: 'WXORDER001',
  env: 0,
});
const provideGoodsBody = JSON.stringify({
  order_id: 'OBPAY20260615100000ABC123',
  wx_order_id: 'WXORDER001',
  env: 0,
});
assert.deepStrictEqual(provideGoodsRequest, {
  url: `https://api.weixin.qq.com/xpay/notify_provide_goods?access_token=ACCESS_TOKEN_1&pay_sig=${hmacSha256Hex('app-key-prod', `/xpay/notify_provide_goods&${provideGoodsBody}`)}`,
  body: provideGoodsBody,
});

const queriedWechatOrder = normalizeWechatVirtualPaymentOrder({
  errcode: 0,
  errmsg: 'OK',
  order: {
    order_id: 'OBPAY20260615100000ABC123',
    status: 3,
    paid_fee: 4990,
    paid_time: 1778044072,
    wx_order_id: 'WXORDER001',
    wxpay_order_id: 'WXPAY001',
    channel_order_id: 'CHANNEL001',
  },
});
assert.deepStrictEqual(queriedWechatOrder, {
  orderNo: 'OBPAY20260615100000ABC123',
  status: 3,
  paid: true,
  paidFee: 4990,
  paidAt: '2026-05-06T05:07:52.000Z',
  wxOrderId: 'WXORDER001',
  wxpayOrderId: 'WXPAY001',
  channelOrderId: 'CHANNEL001',
});
assert.strictEqual(isWechatVirtualPaymentOrderPaid({ status: 3 }), true);
assert.strictEqual(isWechatVirtualPaymentOrderPaid({ status: 4 }), true);
assert.strictEqual(isWechatVirtualPaymentOrderPaid({ status: 1 }), false);

const paymentNotificationText = buildPaymentNotificationText({
  order: {
    ...order,
    status: 'paid',
    paidAt: '2026-06-15T11:05:00.000Z',
  },
  entitlement: {
    expiresAt: '2027-06-15T11:00:00.000Z',
  },
  source: '微信支付回调',
});
assert.match(paymentNotificationText, /收到一笔 Pro 支付/);
assert.match(paymentNotificationText, /OBPAY20260615100000ABC123/);
assert.match(paymentNotificationText, /49\.90/);
assert.match(paymentNotificationText, /2027-06-15T11:00:00\.000Z/);
assert.deepStrictEqual(buildPaymentNotificationWebhookPayload({
  order,
  entitlement: { expiresAt: '2027-06-15T11:00:00.000Z' },
  source: '微信支付回调',
  webhookType: 'feishu',
}), {
  msg_type: 'text',
  content: {
    text: buildPaymentNotificationText({
      order,
      entitlement: { expiresAt: '2027-06-15T11:00:00.000Z' },
      source: '微信支付回调',
    }),
  },
});
assert.deepStrictEqual(buildPaymentNotificationWebhookPayload({
  order,
  entitlement: { expiresAt: '2027-06-15T11:00:00.000Z' },
  source: '微信支付回调',
  webhookType: 'wecom',
}), {
  msgtype: 'text',
  text: {
    content: buildPaymentNotificationText({
      order,
      entitlement: { expiresAt: '2027-06-15T11:00:00.000Z' },
      source: '微信支付回调',
    }),
  },
});

assert.deepStrictEqual(buildPaymentOrderState({
  ...order,
  payMode: 'virtual_payment',
  paymentEnabled: true,
  productId: 'pro_year',
  virtualPayment,
}), {
  orderNo: 'OBPAY20260615100000ABC123',
  status: 'pending',
  planId: 'pro_year',
  planName: 'Pro 年卡',
  amountFen: 4990,
  amountText: '49.90 元',
  durationDays: 365,
  paymentEnabled: true,
  payMode: 'virtual_payment',
  message: '请继续完成微信虚拟支付，支付后等待订单确认，确认后 Pro 权益生效。',
  createdAt: '2026-06-15T10:00:00.000Z',
  paidAt: '',
  productId: 'pro_year',
  virtualPayment,
});

const notifyJson = {
  Event: 'xpay_goods_deliver_notify',
  OpenId: 'openid-1',
  OutTradeNo: 'OBPAY20260615100000ABC123',
  GoodsInfo: {
    ProductId: 'pro_year',
  },
  WeChatPayInfo: {
    MchOrderNo: 'MCHORDER001',
    TransactionId: 'TRANSACTION001',
    PaidTime: 1778044072,
  },
};
assert.deepStrictEqual(parseVirtualPaymentNotifyBody(JSON.stringify(notifyJson)), {
  event: 'xpay_goods_deliver_notify',
  openid: 'openid-1',
  orderNo: 'OBPAY20260615100000ABC123',
  productId: 'pro_year',
  transactionId: 'TRANSACTION001',
  mchOrderNo: 'MCHORDER001',
  paidAt: '2026-05-06T05:07:52.000Z',
  raw: notifyJson,
});

assert.deepStrictEqual(parseVirtualPaymentNotifyBody(`
<xml>
  <Event><![CDATA[xpay_goods_deliver_notify]]></Event>
  <OpenId><![CDATA[openid-2]]></OpenId>
  <OutTradeNo><![CDATA[OBPAY20260615100000XYZ999]]></OutTradeNo>
  <GoodsInfo><ProductId><![CDATA[pro_month]]></ProductId></GoodsInfo>
  <WeChatPayInfo>
    <MchOrderNo><![CDATA[MCHORDER002]]></MchOrderNo>
    <TransactionId><![CDATA[TRANSACTION002]]></TransactionId>
    <PaidTime>1778044073</PaidTime>
  </WeChatPayInfo>
</xml>`), {
  event: 'xpay_goods_deliver_notify',
  openid: 'openid-2',
  orderNo: 'OBPAY20260615100000XYZ999',
  productId: 'pro_month',
  transactionId: 'TRANSACTION002',
  mchOrderNo: 'MCHORDER002',
  paidAt: '2026-05-06T05:07:53.000Z',
  raw: {
    Event: 'xpay_goods_deliver_notify',
    OpenId: 'openid-2',
    OutTradeNo: 'OBPAY20260615100000XYZ999',
    GoodsInfo: {
      ProductId: 'pro_month',
    },
    WeChatPayInfo: {
      MchOrderNo: 'MCHORDER002',
      TransactionId: 'TRANSACTION002',
      PaidTime: '1778044073',
    },
  },
});

const messageSignature = createWechatMessageSignature({
  token: 'notify-token',
  timestamp: '1778044072',
  nonce: 'nonce-1',
});
assert.strictEqual(messageSignature, crypto.createHash('sha1')
  .update(['notify-token', '1778044072', 'nonce-1'].sort().join(''))
  .digest('hex'));
assert.strictEqual(verifyWechatMessageSignature({
  token: 'notify-token',
  timestamp: '1778044072',
  nonce: 'nonce-1',
  signature: messageSignature,
}), true);
assert.strictEqual(verifyWechatMessageSignature({
  token: 'notify-token',
  timestamp: '1778044072',
  nonce: 'nonce-1',
  signature: 'bad-signature',
}), false);

assert.deepStrictEqual(createVirtualPaymentNotifyResponse(), {
  ErrCode: 0,
  ErrMsg: 'success',
});

assert.deepStrictEqual(createPaidEntitlementFromOrder({
  order,
  now: '2026-06-15T11:00:00.000Z',
}), {
  openid: 'openid-1',
  plan: 'local_transcription_beta',
  status: 'active',
  source: 'payment',
  code: '',
  paymentOrderNo: 'OBPAY20260615100000ABC123',
  latestPaymentOrderNo: 'OBPAY20260615100000ABC123',
  durationDays: 365,
  cloudQuotaSeconds: 60000,
  cloudUsedSeconds: 0,
  redeemedAt: '2026-06-15T11:00:00.000Z',
  expiresAt: '2027-06-15T11:00:00.000Z',
  updatedAt: '2026-06-15T11:00:00.000Z',
});

assert.strictEqual(createPaidEntitlementFromOrder({
  order: {
    ...order,
    planId: 'pro_month',
    durationDays: 30,
  },
  now: '2026-06-15T11:00:00.000Z',
  baseExpiresAt: '2037-08-01T00:00:00.000Z',
}).expiresAt, '2037-08-31T00:00:00.000Z');

assert.strictEqual(createPaidEntitlementFromOrder({
  order: {
    ...order,
    planId: 'pro_month',
    durationDays: 30,
  },
  now: '2026-06-15T11:00:00.000Z',
  baseExpiresAt: '2026-05-01T00:00:00.000Z',
}).expiresAt, '2026-07-15T11:00:00.000Z');

const carryover = pickPaymentCarryoverEntitlement([
  {
    _id: 'trial-entitlement',
    openid: 'openid-1',
    plan: 'local_transcription_trial',
    status: 'active',
    source: 'trial',
    code: 'obtry1234',
    expiresAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
  {
    _id: 'paid-entitlement',
    openid: 'openid-1',
    plan: 'local_transcription_beta',
    status: 'active',
    source: 'payment',
    code: '',
    expiresAt: '2037-08-06T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    _id: 'ignored-other-plan',
    openid: 'openid-1',
    plan: 'other',
    status: 'active',
    code: 'OTHER001',
    expiresAt: '2040-01-01T00:00:00.000Z',
  },
], '2026-06-30T00:00:00.000Z');

assert.strictEqual(carryover.current._id, 'paid-entitlement');
assert.strictEqual(carryover.codeSource._id, 'trial-entitlement');
assert.strictEqual(carryover.code, 'OBTRY1234');

assert.deepStrictEqual(mergePaidEntitlementWithCarryover({
  entitlement: createPaidEntitlementFromOrder({
    order: {
      ...order,
      planId: 'pro_month',
      durationDays: 30,
    },
    now: '2026-06-30T00:00:00.000Z',
    baseExpiresAt: carryover.current.expiresAt,
  }),
  current: carryover.current,
  codeSource: carryover.codeSource,
  order: {
    ...order,
    orderNo: 'OBPAY20260630000000PAID',
  },
  now: '2026-06-30T00:00:00.000Z',
}).code, 'OBTRY1234');

assert.deepStrictEqual(createPaidRedeemCodeDocument({
  code: 'obtry1234',
  openid: 'openid-1',
  entitlement: {
    durationDays: 30,
    cloudQuotaSeconds: 3600,
    expiresAt: '2037-09-05T00:00:00.000Z',
  },
  order: {
    orderNo: 'OBPAY20260630000000PAID',
    planId: 'pro_month',
    productId: 'pro_month',
    paidAt: '2026-06-30T00:00:00.000Z',
  },
  now: '2026-06-30T00:00:00.000Z',
  existingCodeDoc: {
    _id: 'old-code-doc',
    trialOwnerOpenid: 'openid-1',
    createdAt: '2026-06-01T00:00:00.000Z',
  },
}), {
  _id: 'old-code-doc',
  code: 'OBTRY1234',
  status: 'active',
  plan: 'local_transcription_beta',
  durationDays: 30,
  maxRedemptions: 1,
  cloudQuotaSeconds: 3600,
  redeemedCount: 0,
  deliveryStatus: 'activated',
  deliveredAt: '2026-06-30T00:00:00.000Z',
  deliveredTo: 'openid-1',
  note: 'virtual-payment-pro',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
  trialOwnerOpenid: 'openid-1',
  paidOwnerOpenid: 'openid-1',
  paymentOrderNo: 'OBPAY20260630000000PAID',
  latestPaymentOrderNo: 'OBPAY20260630000000PAID',
  paymentPlanId: 'pro_month',
  paymentProductId: 'pro_month',
  paymentPaidAt: '2026-06-30T00:00:00.000Z',
  entitlementExpiresAt: '2037-09-05T00:00:00.000Z',
  accessExpiresAt: '2037-09-05T00:00:00.000Z',
  expiresAt: '2037-09-05T00:00:00.000Z',
});
