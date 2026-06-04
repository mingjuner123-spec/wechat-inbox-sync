const assert = require('assert');

const {
  DEFAULT_REDEEM_PLAN,
  DEFAULT_REDEEM_DURATION_DAYS,
  DEFAULT_REDEEM_MAX_REDEMPTIONS,
  normalizeRedeemCode,
  isRedeemCodeActive,
  createRedeemCodeDocument,
  getBuiltInRedeemCodeDocument,
  createEntitlementDocument,
  buildEntitlementState,
} = require('../cloudfunctions/quickstartFunctions/redeem-code-core');

assert.strictEqual(DEFAULT_REDEEM_PLAN, 'local_transcription_beta');
assert.strictEqual(DEFAULT_REDEEM_DURATION_DAYS, 30);
assert.strictEqual(DEFAULT_REDEEM_MAX_REDEMPTIONS, 1);
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
  redeemedCount: 0,
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
  redeemedCount: 0,
  note: 'built-in-test-code',
  createdAt: '2026-06-03T08:00:00.000Z',
  updatedAt: '2026-06-03T08:00:00.000Z',
});
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
  redeemedAt: '2026-06-03T08:00:00.000Z',
  expiresAt: '2026-07-03T08:00:00.000Z',
  updatedAt: '2026-06-03T08:00:00.000Z',
});

assert.deepStrictEqual(buildEntitlementState(null), {
  hasAccess: false,
  plan: '',
  status: 'inactive',
  expiresAt: '',
});

assert.deepStrictEqual(buildEntitlementState({
  plan: 'douyin_transcription_beta',
  status: 'active',
  expiresAt: '2026-07-03T08:00:00.000Z',
}, '2026-06-03T08:00:00.000Z'), {
  hasAccess: true,
  plan: 'douyin_transcription_beta',
  status: 'active',
  expiresAt: '2026-07-03T08:00:00.000Z',
});

assert.deepStrictEqual(buildEntitlementState({
  plan: 'local_transcription_beta',
  status: 'active',
  expiresAt: '2026-06-02T08:00:00.000Z',
}, '2026-06-03T08:00:00.000Z'), {
  hasAccess: false,
  plan: 'local_transcription_beta',
  status: 'expired',
  expiresAt: '2026-06-02T08:00:00.000Z',
});
