const assert = require('assert');

const {
  DEFAULT_REDEEM_PLAN,
  LOCAL_TRANSCRIPTION_PLAN_ALIASES,
  DEFAULT_REDEEM_DURATION_DAYS,
  DEFAULT_REDEEM_MAX_REDEMPTIONS,
  getDefaultCloudQuotaSeconds,
  normalizeRedeemCode,
  isFormalProPlan,
  isLocalTranscriptionPlan,
  isRedeemCodeActive,
  createRedeemCodeDocument,
  getBuiltInRedeemCodeDocument,
  createEntitlementDocument,
  buildEntitlementState,
  pickBestLocalTranscriptionEntitlement,
} = require('../cloudfunctions/quickstartFunctions/redeem-code-core');
const syncRedeemCodeCore = require('../cloudfunctions/syncApi/redeem-code-core');

assert.strictEqual(DEFAULT_REDEEM_PLAN, 'local_transcription_beta');
assert.deepStrictEqual(LOCAL_TRANSCRIPTION_PLAN_ALIASES, [
  'local_transcription_beta',
  'local_transcription_pro',
  'local_transcription_trial',
  'pro',
  'pro_month',
  'pro_year',
]);
assert.strictEqual(isLocalTranscriptionPlan('local_transcription_beta'), true);
assert.strictEqual(isLocalTranscriptionPlan('local_transcription_pro'), true);
assert.strictEqual(isLocalTranscriptionPlan('local_transcription_trial'), true);
assert.strictEqual(isLocalTranscriptionPlan('pro'), true);
assert.strictEqual(isLocalTranscriptionPlan('pro_month'), true);
assert.strictEqual(isLocalTranscriptionPlan('pro_year'), true);
assert.strictEqual(isLocalTranscriptionPlan('other_product'), false);
assert.strictEqual(isFormalProPlan('local_transcription_beta'), true);
assert.strictEqual(isFormalProPlan('local_transcription_pro'), true);
assert.strictEqual(isFormalProPlan('pro'), true);
assert.strictEqual(isFormalProPlan('pro_month'), true);
assert.strictEqual(isFormalProPlan('pro_year'), true);
assert.strictEqual(isFormalProPlan('local_transcription_trial'), false);
assert.strictEqual(isFormalProPlan('other_product'), false);
assert.strictEqual(syncRedeemCodeCore.isFormalProPlan('pro_year'), true);
assert.strictEqual(syncRedeemCodeCore.isFormalProPlan('local_transcription_trial'), false);
assert.strictEqual(DEFAULT_REDEEM_DURATION_DAYS, 30);
assert.strictEqual(DEFAULT_REDEEM_MAX_REDEMPTIONS, 1);
assert.strictEqual(getDefaultCloudQuotaSeconds(3), 1200);
assert.strictEqual(getDefaultCloudQuotaSeconds(30), 3600);
assert.strictEqual(getDefaultCloudQuotaSeconds(90), 14400);
assert.strictEqual(getDefaultCloudQuotaSeconds(365), 60000);
assert.strictEqual(normalizeRedeemCode(' zz ai 001 '), 'ZZAI001');
assert.strictEqual(normalizeRedeemCode('zz–ai–001'), 'ZZ-AI-001');

assert.deepStrictEqual(createRedeemCodeDocument({
  code: ' zzai0603 ',
  now: '2026-06-03T08:00:00.000Z',
  note: '测试码',
}), {
  code: 'ZZAI0603',
  status: 'active',
  plan: 'local_transcription_beta',
  durationDays: 30,
  maxRedemptions: 1,
  cloudQuotaSeconds: 3600,
  redeemedCount: 0,
  deliveryStatus: 'unsent',
  deliveredAt: '',
  note: '测试码',
  createdAt: '2026-06-03T08:00:00.000Z',
  updatedAt: '2026-06-03T08:00:00.000Z',
});

assert.deepStrictEqual(getBuiltInRedeemCodeDocument(' zzai0603 ', '2026-06-03T08:00:00.000Z'), {
  code: 'ZZAI0603',
  status: 'active',
  plan: 'local_transcription_beta',
  durationDays: 30,
  maxRedemptions: 1,
  cloudQuotaSeconds: 3600,
  redeemedCount: 0,
  deliveryStatus: 'unsent',
  deliveredAt: '',
  note: 'built-in-test-code',
  createdAt: '2026-06-03T08:00:00.000Z',
  updatedAt: '2026-06-03T08:00:00.000Z',
});
assert.deepStrictEqual(getBuiltInRedeemCodeDocument('OBTSTVYE4U', '2026-06-05T08:00:00.000Z'), {
  code: 'OBTSTVYE4U',
  status: 'active',
  plan: 'local_transcription_beta',
  durationDays: 3,
  maxRedemptions: 1,
  cloudQuotaSeconds: 1200,
  redeemedCount: 0,
  deliveryStatus: 'unsent',
  deliveredAt: '',
  note: 'built-in-pro-test-3-days-20260605',
  createdAt: '2026-06-05T08:00:00.000Z',
  updatedAt: '2026-06-05T08:00:00.000Z',
});
assert.strictEqual(getBuiltInRedeemCodeDocument('OBPROVP57N', '2026-06-05T08:00:00.000Z').durationDays, 30);
assert.strictEqual(getBuiltInRedeemCodeDocument('ZZAI999', '2026-06-03T08:00:00.000Z'), null);

assert.strictEqual(isRedeemCodeActive({
  code: 'ZZAI001',
  status: 'active',
  maxRedemptions: 1,
  redeemedCount: 0,
}, '2026-06-03T08:00:00.000Z'), true);

assert.strictEqual(isRedeemCodeActive({
  code: 'ZZAI001',
  status: 'active',
  maxRedemptions: 1,
  redeemedCount: 1,
}, '2026-06-03T08:00:00.000Z'), false);

assert.strictEqual(isRedeemCodeActive({
  code: 'ZZAI001',
  status: 'active',
  maxRedemptions: 99,
  redeemedCount: 1,
}, '2026-06-03T08:00:00.000Z'), false);

assert.strictEqual(isRedeemCodeActive({
  code: 'ZZAI001',
  status: 'revoked',
  maxRedemptions: 1,
  redeemedCount: 0,
}, '2026-06-03T08:00:00.000Z'), false);

assert.strictEqual(isRedeemCodeActive({
  code: 'ZZAI001',
  status: 'active',
  maxRedemptions: 1,
  redeemedCount: 0,
  expiresAt: '2026-06-02T08:00:00.000Z',
}, '2026-06-03T08:00:00.000Z'), false);

assert.deepStrictEqual(createEntitlementDocument({
  openid: 'openid-1',
  codeDoc: {
    code: ' zzai001 ',
    plan: 'douyin_transcription_beta',
    entitlementExpiresAt: '2026-07-03T08:00:00.000Z',
  },
  now: '2026-06-03T08:00:00.000Z',
}), {
  openid: 'openid-1',
  plan: 'douyin_transcription_beta',
  status: 'active',
  source: 'redeem_code',
  code: 'ZZAI001',
  durationDays: 30,
  cloudQuotaSeconds: 3600,
  cloudUsedSeconds: 0,
  redeemedAt: '2026-06-03T08:00:00.000Z',
  expiresAt: '2026-07-03T08:00:00.000Z',
  updatedAt: '2026-06-03T08:00:00.000Z',
});

assert.deepStrictEqual(createEntitlementDocument({
  openid: 'openid-1',
  codeDoc: {
    code: 'zzai030',
    durationDays: 30,
  },
  now: '2026-06-03T08:00:00.000Z',
}), {
  openid: 'openid-1',
  plan: 'local_transcription_beta',
  status: 'active',
  source: 'redeem_code',
  code: 'ZZAI030',
  durationDays: 30,
  cloudQuotaSeconds: 3600,
  cloudUsedSeconds: 0,
  redeemedAt: '2026-06-03T08:00:00.000Z',
  expiresAt: '2026-07-03T08:00:00.000Z',
  updatedAt: '2026-06-03T08:00:00.000Z',
});

assert.deepStrictEqual(buildEntitlementState(null), {
  hasAccess: false,
  plan: '',
  status: 'inactive',
  expiresAt: '',
  code: '',
  source: '',
  durationDays: 0,
  cloudQuotaSeconds: 0,
  cloudUsedSeconds: 0,
  cloudRemainingSeconds: 0,
});

assert.deepStrictEqual(buildEntitlementState({
  plan: 'douyin_transcription_beta',
  status: 'active',
  expiresAt: '2026-07-03T08:00:00.000Z',
  code: 'ZZAI030',
  source: 'redeem_code',
  durationDays: 30,
}, '2026-06-03T08:00:00.000Z'), {
  hasAccess: true,
  plan: 'douyin_transcription_beta',
  status: 'active',
  expiresAt: '2026-07-03T08:00:00.000Z',
  code: 'ZZAI030',
  source: 'redeem_code',
  durationDays: 30,
  cloudQuotaSeconds: 0,
  cloudUsedSeconds: 0,
  cloudRemainingSeconds: 0,
});

assert.deepStrictEqual(buildEntitlementState({
  plan: 'local_transcription_beta',
  status: 'active',
  expiresAt: '2026-06-02T08:00:00.000Z',
  code: 'OBPRO12345',
}, '2026-06-03T08:00:00.000Z'), {
  hasAccess: false,
  plan: 'local_transcription_beta',
  status: 'expired',
  expiresAt: '2026-06-02T08:00:00.000Z',
  code: 'OBPRO12345',
  source: '',
  durationDays: 0,
  cloudQuotaSeconds: 0,
  cloudUsedSeconds: 0,
  cloudRemainingSeconds: 0,
});

assert.strictEqual(pickBestLocalTranscriptionEntitlement([
  {
    _id: 'trial',
    plan: 'local_transcription_trial',
    status: 'active',
    expiresAt: '2026-06-10T08:00:00.000Z',
    redeemedAt: '2026-06-03T08:00:00.000Z',
  },
  {
    _id: 'beta',
    plan: 'local_transcription_beta',
    status: 'active',
    expiresAt: '2026-07-03T08:00:00.000Z',
    redeemedAt: '2026-06-01T08:00:00.000Z',
  },
], '2026-06-03T08:00:00.000Z')._id, 'beta');

assert.strictEqual(pickBestLocalTranscriptionEntitlement([
  {
    _id: 'expired-pro',
    plan: 'local_transcription_pro',
    status: 'active',
    expiresAt: '2026-06-02T08:00:00.000Z',
    redeemedAt: '2026-06-01T08:00:00.000Z',
  },
  {
    _id: 'trial',
    plan: 'local_transcription_trial',
    status: 'active',
    expiresAt: '2026-06-10T08:00:00.000Z',
    redeemedAt: '2026-06-03T08:00:00.000Z',
  },
], '2026-06-03T08:00:00.000Z')._id, 'trial');

assert.strictEqual(pickBestLocalTranscriptionEntitlement([
  {
    _id: 'legacy-trial-without-status',
    plan: 'local_transcription_trial',
    expiresAt: '2026-06-10T08:00:00.000Z',
    redeemedAt: '2026-06-03T08:00:00.000Z',
  },
], '2026-06-03T08:00:00.000Z')._id, 'legacy-trial-without-status');

assert.strictEqual(pickBestLocalTranscriptionEntitlement([
  {
    _id: 'existing-trial-code',
    plan: 'local_transcription_trial',
    status: 'active',
    code: 'OBTRY123',
    expiresAt: '2026-06-10T08:00:00.000Z',
    redeemedAt: '2026-06-03T08:00:00.000Z',
  },
  {
    _id: 'paid-pro',
    plan: 'local_transcription_pro',
    status: 'active',
    code: 'OBPRO123',
    expiresAt: '2026-09-03T08:00:00.000Z',
    redeemedAt: '2026-06-01T08:00:00.000Z',
  },
], '2026-06-03T08:00:00.000Z')._id, 'paid-pro');

assert.strictEqual(pickBestLocalTranscriptionEntitlement([
  {
    _id: 'monthly-payment-plan-id',
    plan: 'pro_month',
    status: 'active',
    code: 'OBPAYMONTH',
    expiresAt: '2026-07-03T08:00:00.000Z',
    redeemedAt: '2026-06-03T08:00:00.000Z',
  },
  {
    _id: 'yearly-payment-plan-id',
    plan: 'pro_year',
    status: 'active',
    code: 'OBPAYYEAR',
    expiresAt: '2027-06-03T08:00:00.000Z',
    redeemedAt: '2026-06-03T08:00:00.000Z',
  },
], '2026-06-03T08:00:00.000Z')._id, 'yearly-payment-plan-id');

assert.strictEqual(syncRedeemCodeCore.pickBestLocalTranscriptionEntitlement([
  {
    _id: 'trial-entitlement',
    plan: 'local_transcription_trial',
    expiresAt: '2026-06-10T08:00:00.000Z',
    redeemedAt: '2026-06-03T08:00:00.000Z',
  },
], '2026-06-03T08:00:00.000Z')._id, 'trial-entitlement');

assert.strictEqual(syncRedeemCodeCore.pickBestLocalTranscriptionEntitlement([
  {
    _id: 'sync-payment-plan-id',
    plan: 'pro_month',
    status: 'active',
    expiresAt: '2026-07-03T08:00:00.000Z',
    redeemedAt: '2026-06-03T08:00:00.000Z',
  },
], '2026-06-03T08:00:00.000Z')._id, 'sync-payment-plan-id');
