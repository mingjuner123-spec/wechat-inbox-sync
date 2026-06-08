const DEFAULT_REDEEM_PLAN = 'local_transcription_beta';
const LOCAL_TRANSCRIPTION_PLAN_ALIASES = [
  DEFAULT_REDEEM_PLAN,
  'local_transcription_pro',
  'local_transcription_trial',
  'pro',
];
const DEFAULT_REDEEM_DURATION_DAYS = 30;
const DEFAULT_REDEEM_MAX_REDEMPTIONS = 1;

function addDaysIso(now, days) {
  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return '';
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString();
}

function normalizeRedeemCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[‐-‒–—―]/g, '-')
    .replace(/\s+/g, '');
}

function isLocalTranscriptionPlan(plan) {
  return LOCAL_TRANSCRIPTION_PLAN_ALIASES.includes(String(plan || '').trim());
}

function isRedeemCodeActive(codeDoc, now) {
  if (!codeDoc) return false;
  if (codeDoc.status && codeDoc.status !== 'active') return false;
  const expiresAt = codeDoc.expiresAt || '';
  if (expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime()) return false;
  const maxRedemptions = Number(codeDoc.maxRedemptions) || 1;
  const redeemedCount = Number(codeDoc.redeemedCount) || 0;
  return redeemedCount < maxRedemptions;
}

function createEntitlementDocument({ openid, codeDoc, now }) {
  if (!openid) throw new Error('OpenID is required');
  if (!codeDoc || !codeDoc.code) throw new Error('Redeem code is required');
  const plan = codeDoc.plan || DEFAULT_REDEEM_PLAN;
  return {
    openid,
    plan,
    status: 'active',
    source: 'redeem_code',
    code: normalizeRedeemCode(codeDoc.code),
    redeemedAt: now,
    expiresAt: codeDoc.entitlementExpiresAt || codeDoc.accessExpiresAt || addDaysIso(now, codeDoc.durationDays),
    updatedAt: now,
  };
}

function createRedeemCodeDocument({
  code,
  plan = DEFAULT_REDEEM_PLAN,
  durationDays = DEFAULT_REDEEM_DURATION_DAYS,
  maxRedemptions = DEFAULT_REDEEM_MAX_REDEMPTIONS,
  now = new Date().toISOString(),
  note = '',
} = {}) {
  const normalizedCode = normalizeRedeemCode(code);
  if (!normalizedCode) throw new Error('Redeem code is required');
  const normalizedDurationDays = Number(durationDays);
  const normalizedMaxRedemptions = Number(maxRedemptions);
  return {
    code: normalizedCode,
    status: 'active',
    plan: String(plan || DEFAULT_REDEEM_PLAN).trim() || DEFAULT_REDEEM_PLAN,
    durationDays: Number.isFinite(normalizedDurationDays) && normalizedDurationDays > 0
      ? normalizedDurationDays
      : DEFAULT_REDEEM_DURATION_DAYS,
    maxRedemptions: Number.isFinite(normalizedMaxRedemptions) && normalizedMaxRedemptions > 0
      ? normalizedMaxRedemptions
      : DEFAULT_REDEEM_MAX_REDEMPTIONS,
    redeemedCount: 0,
    deliveryStatus: 'unsent',
    deliveredAt: '',
    note: String(note || ''),
    createdAt: now,
    updatedAt: now,
  };
}

function getBuiltInRedeemCodeDocument(code, now = new Date().toISOString()) {
  const normalizedCode = normalizeRedeemCode(code);
  const builtInCodes = {
    ZZAI0603: {
      durationDays: DEFAULT_REDEEM_DURATION_DAYS,
      note: 'built-in-test-code',
    },
    OBTSTVYE4U: {
      durationDays: 3,
      note: 'built-in-pro-test-3-days-20260605',
    },
    OBTSTGAN38: {
      durationDays: 3,
      note: 'built-in-pro-test-3-days-20260605',
    },
    OBPROVP57N: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPROJVELA: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPROESTH9: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPROFZP5R: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPRO8RCSP: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPROWECUS: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPROK3Q9E: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPROHVRLG: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPROU8DZ4: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
    OBPROWVPNU: {
      durationDays: 30,
      note: 'built-in-pro-beta-30-days-20260605',
    },
  };
  const builtInCode = builtInCodes[normalizedCode];
  if (!builtInCode) return null;
  return createRedeemCodeDocument({
    code: normalizedCode,
    durationDays: builtInCode.durationDays,
    now,
    note: builtInCode.note,
  });
}

function buildEntitlementState(entitlement, now = new Date().toISOString()) {
  if (!entitlement) {
    return {
      hasAccess: false,
      plan: '',
      status: 'inactive',
      expiresAt: '',
    };
  }
  const expiresAt = entitlement.expiresAt || '';
  const isExpired = expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime();
  const status = isExpired ? 'expired' : (entitlement.status || 'active');
  return {
    hasAccess: status === 'active',
    plan: entitlement.plan || DEFAULT_REDEEM_PLAN,
    status,
    expiresAt,
  };
}

module.exports = {
  DEFAULT_REDEEM_PLAN,
  LOCAL_TRANSCRIPTION_PLAN_ALIASES,
  DEFAULT_REDEEM_DURATION_DAYS,
  DEFAULT_REDEEM_MAX_REDEMPTIONS,
  addDaysIso,
  normalizeRedeemCode,
  isLocalTranscriptionPlan,
  isRedeemCodeActive,
  createRedeemCodeDocument,
  getBuiltInRedeemCodeDocument,
  createEntitlementDocument,
  buildEntitlementState,
};
