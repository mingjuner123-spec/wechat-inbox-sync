const assert = require('assert');

const {
  buildMembershipDisplayState,
  shouldShowAdEntry,
  shouldShowGeneralAd,
} = require('../miniprogram/utils/membership-display');

const originalDateNow = Date.now;
Date.now = () => new Date('2026-06-30T00:00:00.000Z').getTime();

try {
  assert.deepStrictEqual(buildMembershipDisplayState({
    hasAccess: true,
    status: 'active',
    expiresAt: '2026-07-30T12:00:00.000Z',
    code: '',
  }), {
    trialRedeemCode: '',
    trialRedeemCodeExpiresAt: '2026-07-30T12:00:00.000Z',
    trialRedeemCodeExpiresLabel: '2026-07-30',
    trialRedeemCodeExpired: false,
    showTrialClaim: false,
    showRedeemCode: false,
    showMembershipExpiry: true,
  });

  assert.deepStrictEqual(buildMembershipDisplayState({
    hasAccess: true,
    status: 'active',
    expiresAt: '2037-09-05T00:00:00.000Z',
    code: 'OBPROT93C6',
  }), {
    trialRedeemCode: 'OBPROT93C6',
    trialRedeemCodeExpiresAt: '2037-09-05T00:00:00.000Z',
    trialRedeemCodeExpiresLabel: '2037-09-05',
    trialRedeemCodeExpired: false,
    showTrialClaim: false,
    showRedeemCode: true,
    showMembershipExpiry: true,
  });

  assert.strictEqual(buildMembershipDisplayState({
    hasAccess: false,
    status: 'inactive',
    expiresAt: '',
    code: '',
  }).showTrialClaim, true);

  assert.strictEqual(buildMembershipDisplayState({
    hasAccess: false,
    status: 'expired',
    expiresAt: '2026-06-01T00:00:00.000Z',
    code: '',
  }).showTrialClaim, false);

  assert.strictEqual(shouldShowAdEntry({ hasAccess: true }, {}, true), false);
  assert.strictEqual(shouldShowAdEntry({ hasAccess: false }, { proUnlimited: true }, true), false);
  assert.strictEqual(shouldShowAdEntry({ hasAccess: false }, { proUnlimited: false }, false), false);
  assert.strictEqual(shouldShowAdEntry({ hasAccess: false }, { proUnlimited: false }, true), true);
  assert.strictEqual(shouldShowGeneralAd({ hasAccess: true }, true), false);
  assert.strictEqual(shouldShowGeneralAd({ hasAccess: false }, false), false);
  assert.strictEqual(shouldShowGeneralAd({ hasAccess: false }, true), true);
} finally {
  Date.now = originalDateNow;
}

console.log('membership-display tests passed');
