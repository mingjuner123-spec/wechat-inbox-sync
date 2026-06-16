const DEFAULT_REDEEM_PLAN = 'local_transcription_beta';
const LOCAL_TRANSCRIPTION_PLAN_ALIASES = [
  DEFAULT_REDEEM_PLAN,
  'local_transcription_pro',
  'local_transcription_trial',
  'pro',
];
const DEFAULT_REDEEM_DURATION_DAYS = 30;
const DEFAULT_REDEEM_MAX_REDEMPTIONS = 1;

function getDefaultCloudQuotaSeconds(durationDays) {
  const days = Number(durationDays) || DEFAULT_REDEEM_DURATION_DAYS;
  if (days <= 7) return 20 * 60;
  if (days <= 31) return 60 * 60;
  if (days <= 100) return 240 * 60;
  return 1000 * 60;
}

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

function getEntitlementExpiresTime(entitlement) {
  const expiresAt = entitlement && entitlement.expiresAt;
  if (!expiresAt) return 0;
  const time = new Date(expiresAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getEntitlementRedeemedTime(entitlement) {
  const redeemedAt = entitlement && (entitlement.redeemedAt || entitlement.updatedAt || entitlement.createdAt);
  if (!redeemedAt) return 0;
  const time = new Date(redeemedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function pickBestLocalTranscriptionEntitlement(entitlements = [], now = new Date().toISOString()) {
  const nowTime = new Date(now).getTime();
  const safeNowTime = Number.isNaN(nowTime) ? Date.now() : nowTime;
  return (entitlements || [])
    .filter((item) => item && (item.status || 'active') === 'active' && isLocalTranscriptionPlan(item.plan))
    .filter((item) => {
      const expiresTime = getEntitlementExpiresTime(item);
      return !expiresTime || expiresTime > safeNowTime;
    })
    .sort((a, b) => {
      const expiresDiff = getEntitlementExpiresTime(b) - getEntitlementExpiresTime(a);
      if (expiresDiff) return expiresDiff;
      return getEntitlementRedeemedTime(b) - getEntitlementRedeemedTime(a);
    })[0] || null;
}

function isRedeemCodeActive(codeDoc, now) {
  if (!codeDoc) return false;
  if (codeDoc.status && codeDoc.status !== 'active') return false;
  const expiresAt = codeDoc.expiresAt || '';
  if (expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime()) return false;
  const redeemedCount = Number(codeDoc.redeemedCount) || 0;
  return redeemedCount < 1;
}

function createEntitlementDocument({ openid, codeDoc, now }) {
  if (!openid) throw new Error('OpenID is required');
  if (!codeDoc || !codeDoc.code) throw new Error('Redeem code is required');
  const plan = codeDoc.plan || DEFAULT_REDEEM_PLAN;
  const durationDays = Number(codeDoc.durationDays) || DEFAULT_REDEEM_DURATION_DAYS;
  return {
    openid,
    plan,
    status: 'active',
    source: 'redeem_code',
    code: normalizeRedeemCode(codeDoc.code),
    durationDays,
    cloudQuotaSeconds: Number(codeDoc.cloudQuotaSeconds) || getDefaultCloudQuotaSeconds(durationDays),
    cloudUsedSeconds: Number(codeDoc.cloudUsedSeconds) || 0,
    redeemedAt: now,
    expiresAt: codeDoc.entitlementExpiresAt || codeDoc.accessExpiresAt || addDaysIso(now, durationDays),
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
  cloudQuotaSeconds = 0,
} = {}) {
  const normalizedCode = normalizeRedeemCode(code);
  if (!normalizedCode) throw new Error('Redeem code is required');
  const normalizedDurationDays = Number(durationDays);
  return {
    code: normalizedCode,
    status: 'active',
    plan: String(plan || DEFAULT_REDEEM_PLAN).trim() || DEFAULT_REDEEM_PLAN,
    durationDays: Number.isFinite(normalizedDurationDays) && normalizedDurationDays > 0
      ? normalizedDurationDays
      : DEFAULT_REDEEM_DURATION_DAYS,
    maxRedemptions: 1,
    cloudQuotaSeconds: Number(cloudQuotaSeconds) > 0
      ? Number(cloudQuotaSeconds)
      : getDefaultCloudQuotaSeconds(Number.isFinite(normalizedDurationDays) && normalizedDurationDays > 0
        ? normalizedDurationDays
        : DEFAULT_REDEEM_DURATION_DAYS),
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
      code: '',
      source: '',
      durationDays: 0,
      cloudQuotaSeconds: 0,
      cloudUsedSeconds: 0,
      cloudRemainingSeconds: 0,
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
    code: normalizeRedeemCode(entitlement.code),
    source: entitlement.source || '',
    durationDays: Number(entitlement.durationDays) || 0,
    cloudQuotaSeconds: Number(entitlement.cloudQuotaSeconds) || 0,
    cloudUsedSeconds: Number(entitlement.cloudUsedSeconds) || 0,
    cloudRemainingSeconds: Math.max(0, (Number(entitlement.cloudQuotaSeconds) || 0) - (Number(entitlement.cloudUsedSeconds) || 0)),
  };
}

module.exports = {
  DEFAULT_REDEEM_PLAN,
  LOCAL_TRANSCRIPTION_PLAN_ALIASES,
  DEFAULT_REDEEM_DURATION_DAYS,
  DEFAULT_REDEEM_MAX_REDEMPTIONS,
  getDefaultCloudQuotaSeconds,
  addDaysIso,
  normalizeRedeemCode,
  isLocalTranscriptionPlan,
  pickBestLocalTranscriptionEntitlement,
  isRedeemCodeActive,
  createRedeemCodeDocument,
  getBuiltInRedeemCodeDocument,
  createEntitlementDocument,
  buildEntitlementState,
};
