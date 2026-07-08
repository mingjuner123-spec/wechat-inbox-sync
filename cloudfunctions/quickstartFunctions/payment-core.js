const {
  DEFAULT_REDEEM_PLAN,
  addDaysIso,
  getDefaultCloudQuotaSeconds,
  isLocalTranscriptionPlan,
  normalizeRedeemCode,
  pickBestLocalTranscriptionEntitlement,
  createRedeemCodeDocument,
} = require('./redeem-code-core');
const crypto = require('crypto');

const VIRTUAL_PAYMENT_MODE = 'short_series_goods';
const VIRTUAL_PAYMENT_URI = 'requestVirtualPayment';
const VIRTUAL_PAYMENT_QUERY_ORDER_URI = '/xpay/query_order';
const VIRTUAL_PAYMENT_PROVIDE_GOODS_URI = '/xpay/notify_provide_goods';
const WECHAT_API_BASE_URL = 'https://api.weixin.qq.com';

const PAYMENT_PLANS = {
  pro_month: {
    id: 'pro_month',
    name: 'Pro 月卡',
    priceFen: 990,
    durationDays: 30,
  },
  pro_year: {
    id: 'pro_year',
    name: 'Pro 年卡',
    priceFen: 4990,
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
  paymentEnabled = false,
  payMode,
  virtualPaymentEnv,
  message = '',
} = {}) {
  if (!openid) throw new Error('OpenID is required');
  const normalizedPlanId = normalizePaymentPlanId(planId);
  const plan = PAYMENT_PLANS[normalizedPlanId];
  const enabled = Boolean(paymentEnabled);
  return {
    orderNo: createPaymentOrderNo(now, randomSuffix),
    openid,
    planId: normalizedPlanId,
    planName: plan.name,
    productId: plan.id,
    status: 'pending',
    amountFen: plan.priceFen,
    durationDays: plan.durationDays,
    payMode: payMode || (enabled ? 'virtual_payment' : 'manual_pending'),
    paymentEnabled: enabled,
    virtualPaymentEnv: virtualPaymentEnv === undefined ? null : virtualPaymentEnv,
    message,
    createdAt: now,
    updatedAt: now,
    paidAt: '',
  };
}

function buildPaymentOrderState(order = {}) {
  const planId = normalizePaymentPlanId(order.planId);
  const plan = PAYMENT_PLANS[planId];
  const paymentEnabled = Boolean(order.paymentEnabled);
  const payMode = order.payMode || (paymentEnabled ? 'virtual_payment' : 'manual_pending');
  const state = {
    orderNo: order.orderNo || '',
    status: order.status || 'pending',
    planId,
    planName: order.planName || plan.name,
    amountFen: Number(order.amountFen) || plan.priceFen,
    amountText: formatAmountFen(Number(order.amountFen) || plan.priceFen),
    durationDays: Number(order.durationDays) || plan.durationDays,
    paymentEnabled,
    payMode,
    message: order.message || (paymentEnabled
      ? '请继续完成微信虚拟支付，支付后等待订单确认，确认后 Pro 权益生效。'
      : '微信虚拟支付配置未生效，请检查云函数环境变量并重新部署 quickstartFunctions；当前订单不会自动拉起支付。'),
    createdAt: order.createdAt || '',
    paidAt: order.paidAt || '',
  };
  if (paymentEnabled || payMode === 'virtual_payment' || order.virtualPayment) {
    state.productId = order.productId || plan.id;
  }
  if (order.virtualPayment) {
    state.virtualPayment = order.virtualPayment;
  }
  return state;
}

function hmacSha256Hex(key, data) {
  return crypto
    .createHmac('sha256', String(key || ''))
    .update(String(data || ''))
    .digest('hex');
}

function normalizeVirtualPaymentEnv(value) {
  if (value === 1 || value === '1' || String(value || '').toLowerCase() === 'sandbox') return 1;
  return 0;
}

function createWechatMessageSignature({ token, timestamp, nonce } = {}) {
  const source = [token, timestamp, nonce]
    .map((value) => String(value || ''))
    .sort()
    .join('');
  return crypto
    .createHash('sha1')
    .update(source)
    .digest('hex');
}

function verifyWechatMessageSignature({
  token,
  timestamp,
  nonce,
  signature,
} = {}) {
  const expected = createWechatMessageSignature({ token, timestamp, nonce });
  const provided = String(signature || '').trim().toLowerCase();
  return Boolean(token && provided && expected === provided);
}

function decodeXmlText(value) {
  return String(value || '')
    .trim()
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function readXmlTag(xml, tagName) {
  const match = String(xml || '').match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeXmlText(match[1]) : '';
}

function parseVirtualPaymentNotifyXml(xml) {
  return {
    Event: readXmlTag(xml, 'Event'),
    OpenId: readXmlTag(xml, 'OpenId') || readXmlTag(xml, 'FromUserName'),
    OutTradeNo: readXmlTag(xml, 'OutTradeNo'),
    GoodsInfo: {
      ProductId: readXmlTag(xml, 'ProductId'),
    },
    WeChatPayInfo: {
      MchOrderNo: readXmlTag(xml, 'MchOrderNo'),
      TransactionId: readXmlTag(xml, 'TransactionId'),
      PaidTime: readXmlTag(xml, 'PaidTime'),
    },
  };
}

function parseNotifyBodyValue(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  const text = String(body || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) {
    return JSON.parse(text);
  }
  return parseVirtualPaymentNotifyXml(text);
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function normalizePaidAt(value) {
  const picked = pickFirst(value);
  if (!picked) return '';
  const numberValue = Number(picked);
  if (Number.isFinite(numberValue) && numberValue > 0) {
    const milliseconds = numberValue < 1000000000000 ? numberValue * 1000 : numberValue;
    return new Date(milliseconds).toISOString();
  }
  const date = new Date(String(picked));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function parseVirtualPaymentNotifyBody(body) {
  const raw = parseNotifyBodyValue(body);
  const goodsInfo = raw.GoodsInfo || raw.goodsInfo || raw.goods_info || {};
  const payInfo = raw.WeChatPayInfo || raw.weChatPayInfo || raw.payInfo || raw.pay_info || {};
  return {
    event: String(pickFirst(raw.Event, raw.event)).trim(),
    openid: String(pickFirst(raw.OpenId, raw.openid, raw.openId, raw.FromUserName)).trim(),
    orderNo: String(pickFirst(raw.OutTradeNo, raw.outTradeNo, raw.out_trade_no)).trim(),
    productId: String(pickFirst(
      goodsInfo.ProductId,
      goodsInfo.productId,
      goodsInfo.product_id,
      raw.ProductId,
      raw.productId,
    )).trim(),
    transactionId: String(pickFirst(
      payInfo.TransactionId,
      payInfo.transactionId,
      payInfo.transaction_id,
      raw.TransactionId,
      raw.transactionId,
    )).trim(),
    mchOrderNo: String(pickFirst(
      payInfo.MchOrderNo,
      payInfo.mchOrderNo,
      payInfo.mch_order_no,
      raw.MchOrderNo,
      raw.mchOrderNo,
    )).trim(),
    paidAt: normalizePaidAt(pickFirst(payInfo.PaidTime, payInfo.paidTime, raw.PaidTime, raw.paidAt)),
    raw,
  };
}

function createVirtualPaymentNotifyResponse(errCode = 0, errMsg = 'success') {
  return {
    ErrCode: Number(errCode) || 0,
    ErrMsg: String(errMsg || 'success'),
  };
}

function createVirtualPaymentSignData({
  order,
  offerId,
  env = 0,
} = {}) {
  if (!order || !order.orderNo) throw new Error('Payment order is required');
  if (!offerId) throw new Error('VIRTUAL_PAY_OFFER_ID is required');
  const planId = normalizePaymentPlanId(order.planId);
  const plan = PAYMENT_PLANS[planId];
  return JSON.stringify({
    offerId: String(offerId),
    buyQuantity: 1,
    env: normalizeVirtualPaymentEnv(env),
    currencyType: 'CNY',
    productId: plan.id,
    goodsPrice: Number(order.amountFen) || plan.priceFen,
    outTradeNo: order.orderNo,
    attach: JSON.stringify({
      orderNo: order.orderNo,
      planId,
    }),
  });
}

function createVirtualPaymentPayload({
  order,
  offerId,
  appKey,
  sessionKey,
  env = 0,
} = {}) {
  if (!appKey) throw new Error('Virtual payment AppKey is required');
  if (!sessionKey) throw new Error('session_key is required');
  const signData = createVirtualPaymentSignData({ order, offerId, env });
  return {
    mode: VIRTUAL_PAYMENT_MODE,
    signData,
    paySig: hmacSha256Hex(appKey, `${VIRTUAL_PAYMENT_URI}&${signData}`),
    signature: hmacSha256Hex(sessionKey, signData),
  };
}

function createSignedWechatVirtualPaymentRequest({
  uri,
  body,
  appKey,
  accessToken,
} = {}) {
  if (!uri) throw new Error('WeChat virtual payment URI is required');
  if (!appKey) throw new Error('Virtual payment AppKey is required');
  if (!accessToken) throw new Error('WeChat access_token is required');
  const normalizedBody = typeof body === 'string' ? body : JSON.stringify(body || {});
  const paySig = hmacSha256Hex(appKey, `${uri}&${normalizedBody}`);
  return {
    url: `${WECHAT_API_BASE_URL}${uri}?access_token=${encodeURIComponent(accessToken)}&pay_sig=${paySig}`,
    body: normalizedBody,
  };
}

function createVirtualPaymentQueryOrderRequest({
  order,
  appKey,
  accessToken,
  env = 0,
} = {}) {
  if (!order || !order.orderNo || !order.openid) throw new Error('Payment order is required');
  return createSignedWechatVirtualPaymentRequest({
    uri: VIRTUAL_PAYMENT_QUERY_ORDER_URI,
    appKey,
    accessToken,
    body: JSON.stringify({
      openid: order.openid,
      env: normalizeVirtualPaymentEnv(env),
      order_id: order.orderNo,
    }),
  });
}

function createVirtualPaymentProvideGoodsRequest({
  order,
  appKey,
  accessToken,
  wxOrderId,
  env = 0,
} = {}) {
  if (!order || !order.orderNo) throw new Error('Payment order is required');
  if (!wxOrderId) throw new Error('WeChat order id is required');
  return createSignedWechatVirtualPaymentRequest({
    uri: VIRTUAL_PAYMENT_PROVIDE_GOODS_URI,
    appKey,
    accessToken,
    body: JSON.stringify({
      order_id: order.orderNo,
      wx_order_id: wxOrderId,
      env: normalizeVirtualPaymentEnv(env),
    }),
  });
}

function isWechatVirtualPaymentOrderPaid(order = {}) {
  const status = Number(order.status);
  return status === 2 || status === 3 || status === 4;
}

function normalizeWechatVirtualPaymentOrder(response = {}) {
  const order = response.order || response;
  const status = Number(order.status) || 0;
  return {
    orderNo: String(order.order_id || order.orderNo || '').trim(),
    status,
    paid: isWechatVirtualPaymentOrderPaid({ status }),
    paidFee: Number(order.paid_fee || order.paidFee || 0) || 0,
    paidAt: normalizePaidAt(order.paid_time || order.paidTime || ''),
    wxOrderId: String(order.wx_order_id || order.wxOrderId || '').trim(),
    wxpayOrderId: String(order.wxpay_order_id || order.wxpayOrderId || '').trim(),
    channelOrderId: String(order.channel_order_id || order.channelOrderId || '').trim(),
  };
}

function resolveEntitlementExtensionBase(now, baseExpiresAt) {
  const nowDate = new Date(now);
  const baseDate = new Date(baseExpiresAt || '');
  if (!Number.isNaN(baseDate.getTime()) && !Number.isNaN(nowDate.getTime()) && baseDate.getTime() > nowDate.getTime()) {
    return baseDate.toISOString();
  }
  return now;
}

function createPaidEntitlementFromOrder({ order, now = new Date().toISOString(), baseExpiresAt = '' } = {}) {
  if (!order || !order.openid) throw new Error('Payment order is required');
  const durationDays = Number(order.durationDays) || PAYMENT_PLANS[normalizePaymentPlanId(order.planId)].durationDays;
  const extensionBase = resolveEntitlementExtensionBase(now, baseExpiresAt);
  return {
    openid: order.openid,
    plan: DEFAULT_REDEEM_PLAN,
    status: 'active',
    source: 'payment',
    code: '',
    paymentOrderNo: order.orderNo || '',
    latestPaymentOrderNo: order.orderNo || '',
    durationDays,
    cloudQuotaSeconds: getDefaultCloudQuotaSeconds(durationDays),
    cloudUsedSeconds: 0,
    redeemedAt: now,
    expiresAt: addDaysIso(extensionBase, durationDays),
    updatedAt: now,
  };
}

function getEntitlementTime(entitlement, fieldNames = []) {
  const value = fieldNames
    .map((fieldName) => entitlement && entitlement[fieldName])
    .find((item) => item);
  const time = new Date(value || '').getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sortEntitlementsByFreshness(a, b) {
  const expiresDiff = getEntitlementTime(b, ['expiresAt']) - getEntitlementTime(a, ['expiresAt']);
  if (expiresDiff) return expiresDiff;
  return getEntitlementTime(b, ['updatedAt', 'redeemedAt', 'createdAt'])
    - getEntitlementTime(a, ['updatedAt', 'redeemedAt', 'createdAt']);
}

function pickPaymentCarryoverEntitlement(entitlements = [], now = new Date().toISOString()) {
  const localEntitlements = (entitlements || [])
    .filter((item) => item && isLocalTranscriptionPlan(item.plan));
  const activeEntitlements = localEntitlements
    .filter((item) => (item.status || 'active') === 'active');
  const current = pickBestLocalTranscriptionEntitlement(activeEntitlements, now)
    || activeEntitlements.slice().sort(sortEntitlementsByFreshness)[0]
    || null;
  const codeSource = localEntitlements
    .filter((item) => normalizeRedeemCode(item.code))
    .sort((a, b) => {
      const aIsCurrent = current && a._id && current._id && a._id === current._id ? 1 : 0;
      const bIsCurrent = current && b._id && current._id && b._id === current._id ? 1 : 0;
      if (aIsCurrent !== bIsCurrent) return bIsCurrent - aIsCurrent;
      const aIsActive = (a.status || 'active') === 'active' ? 1 : 0;
      const bIsActive = (b.status || 'active') === 'active' ? 1 : 0;
      if (aIsActive !== bIsActive) return bIsActive - aIsActive;
      return sortEntitlementsByFreshness(a, b);
    })[0] || null;
  return {
    current,
    codeSource,
    code: normalizeRedeemCode(codeSource && codeSource.code),
  };
}

function mergePaidEntitlementWithCarryover({
  entitlement,
  current,
  codeSource,
  order = {},
  now = new Date().toISOString(),
} = {}) {
  const code = normalizeRedeemCode(
    (current && current.code)
    || (codeSource && codeSource.code)
    || (entitlement && entitlement.code)
  );
  return {
    ...(entitlement || {}),
    code,
    source: 'payment',
    redeemedAt: (current && current.redeemedAt) || (entitlement && entitlement.redeemedAt) || now,
    paymentOrderNo: (current && current.paymentOrderNo) || (entitlement && entitlement.paymentOrderNo) || '',
    latestPaymentOrderNo: order.orderNo
      || (entitlement && entitlement.latestPaymentOrderNo)
      || (current && current.latestPaymentOrderNo)
      || '',
    lastPaidAt: now,
  };
}

function createPaidRedeemCodeDocument({
  code,
  openid,
  entitlement = {},
  order = {},
  now = new Date().toISOString(),
  existingCodeDoc = {},
} = {}) {
  const normalizedCode = normalizeRedeemCode(code || existingCodeDoc.code);
  if (!normalizedCode) throw new Error('Redeem code is required');
  if (!openid) throw new Error('OpenID is required');
  const durationDays = Number(entitlement.durationDays) || Number(existingCodeDoc.durationDays) || PAYMENT_PLANS.pro_month.durationDays;
  const cloudQuotaSeconds = Number(entitlement.cloudQuotaSeconds) || Number(existingCodeDoc.cloudQuotaSeconds) || getDefaultCloudQuotaSeconds(durationDays);
  const baseDoc = createRedeemCodeDocument({
    code: normalizedCode,
    plan: DEFAULT_REDEEM_PLAN,
    durationDays,
    cloudQuotaSeconds,
    note: 'virtual-payment-pro',
    now,
  });
  const orderNo = order.orderNo || entitlement.latestPaymentOrderNo || entitlement.paymentOrderNo || existingCodeDoc.latestPaymentOrderNo || existingCodeDoc.paymentOrderNo || '';
  const expiresAt = entitlement.expiresAt || existingCodeDoc.entitlementExpiresAt || existingCodeDoc.accessExpiresAt || existingCodeDoc.expiresAt || '';
  return {
    ...baseDoc,
    ...(existingCodeDoc || {}),
    code: normalizedCode,
    status: 'active',
    plan: DEFAULT_REDEEM_PLAN,
    durationDays,
    maxRedemptions: 1,
    cloudQuotaSeconds,
    redeemedCount: 0,
    deliveryStatus: 'activated',
    deliveredAt: now,
    deliveredTo: openid,
    note: 'virtual-payment-pro',
    createdAt: existingCodeDoc.createdAt || baseDoc.createdAt,
    updatedAt: now,
    paidOwnerOpenid: openid,
    paymentOrderNo: existingCodeDoc.paymentOrderNo || entitlement.paymentOrderNo || orderNo,
    latestPaymentOrderNo: orderNo,
    paymentPlanId: order.planId || existingCodeDoc.paymentPlanId || '',
    paymentProductId: order.productId || order.planId || existingCodeDoc.paymentProductId || '',
    paymentPaidAt: order.paidAt || existingCodeDoc.paymentPaidAt || now,
    entitlementExpiresAt: expiresAt,
    accessExpiresAt: expiresAt,
    expiresAt,
  };
}

function buildPaymentNotificationText({ order = {}, entitlement = {}, source = '' } = {}) {
  const state = buildPaymentOrderState(order);
  const lines = [
    '收到一笔 Pro 支付',
    `套餐：${state.planName}`,
    `金额：${state.amountText}`,
    `订单号：${state.orderNo || order.orderNo || '-'}`,
    `状态：${state.status}`,
    `OpenID：${order.openid || '-'}`,
    `支付时间：${order.paidAt || '-'}`,
    `权益到期：${entitlement.expiresAt || '-'}`,
    `触发来源：${source || '-'}`,
  ];
  return lines.join('\n');
}

function buildPaymentNotificationWebhookPayload({ order, entitlement, source, webhookType = 'feishu' } = {}) {
  const text = buildPaymentNotificationText({ order, entitlement, source });
  const type = String(webhookType || 'feishu').trim().toLowerCase();
  if (['wecom', 'wechat-work', 'work-wechat', 'dingtalk'].includes(type)) {
    return {
      msgtype: 'text',
      text: {
        content: text,
      },
    };
  }
  return {
    msg_type: 'text',
    content: {
      text,
    },
  };
}

module.exports = {
  PAYMENT_PLANS,
  VIRTUAL_PAYMENT_MODE,
  VIRTUAL_PAYMENT_URI,
  VIRTUAL_PAYMENT_QUERY_ORDER_URI,
  VIRTUAL_PAYMENT_PROVIDE_GOODS_URI,
  normalizePaymentPlanId,
  formatAmountFen,
  createPaymentOrderNo,
  createPaymentOrderDocument,
  buildPaymentOrderState,
  normalizeVirtualPaymentEnv,
  createWechatMessageSignature,
  verifyWechatMessageSignature,
  parseVirtualPaymentNotifyBody,
  createVirtualPaymentNotifyResponse,
  createVirtualPaymentSignData,
  createVirtualPaymentPayload,
  createVirtualPaymentQueryOrderRequest,
  createVirtualPaymentProvideGoodsRequest,
  normalizeWechatVirtualPaymentOrder,
  isWechatVirtualPaymentOrderPaid,
  buildPaymentNotificationText,
  buildPaymentNotificationWebhookPayload,
  createPaidEntitlementFromOrder,
  pickPaymentCarryoverEntitlement,
  mergePaidEntitlementWithCarryover,
  createPaidRedeemCodeDocument,
};
