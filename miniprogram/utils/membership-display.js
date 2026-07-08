function formatDateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isExpired(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() <= Date.now();
}

function buildMembershipDisplayState(status = {}) {
  const hasAccess = Boolean(status.hasAccess);
  const code = String(status.code || '').trim();
  const expiresAt = status.expiresAt || '';
  const expiresLabel = formatDateLabel(expiresAt);
  const statusText = String(status.status || '').trim();

  return {
    trialRedeemCode: code,
    trialRedeemCodeExpiresAt: expiresAt,
    trialRedeemCodeExpiresLabel: expiresLabel,
    trialRedeemCodeExpired: isExpired(expiresAt),
    showTrialClaim: !hasAccess && statusText !== 'expired' && !code,
    showRedeemCode: Boolean(code),
    showMembershipExpiry: hasAccess && Boolean(expiresLabel),
  };
}

function shouldShowGeneralAd(status = {}, entitlementStatusLoaded = true) {
  if (!entitlementStatusLoaded) return false;
  return Boolean(status && status.hasAccess === false);
}

function shouldShowAdEntry(status = {}, usage = {}, entitlementStatusLoaded = true) {
  if (!shouldShowGeneralAd(status, entitlementStatusLoaded)) return false;
  if (usage && usage.proUnlimited) return false;
  return true;
}

module.exports = {
  buildMembershipDisplayState,
  formatDateLabel,
  isExpired,
  shouldShowAdEntry,
  shouldShowGeneralAd,
};
