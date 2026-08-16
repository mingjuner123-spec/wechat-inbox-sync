'use strict';

function createDouyinMediaResolutionDiagnosticBuilder(dependencies = {}) {
  const {
    getSafeUrlDiagnostic = () => ({ protocol: '', host: '' }),
    getTransportErrorDiagnostic = () => ({}),
  } = dependencies;

  const safeText = (value, maxLength = 64) => String(value || '').trim().slice(0, maxLength);
  const normalizeCode = (value) => { const code = safeText(value, 64); return code ? (/^[A-Z0-9_.-]+$/.test(code) ? code : 'UNKNOWN') : ''; };
  const normalizeInteger = (value, maxValue) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(maxValue, Math.round(numeric)));
  };
  const normalizeSignedInteger = (value, maxAbsoluteValue) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(-maxAbsoluteValue, Math.min(maxAbsoluteValue, Math.round(numeric)));
  };
  const normalizeError = (error) => {
    if (!error) return undefined;
    const diagnostic = getTransportErrorDiagnostic(error) || {};
    const safe = {};
    const code = normalizeCode(diagnostic.code);
    if (code) safe.code = code;
    const status = normalizeInteger(diagnostic.status, 999);
    if (status) safe.status = status;
    const browserErrorCode = normalizeSignedInteger(diagnostic.browserErrorCode, 999);
    if (browserErrorCode) safe.browserErrorCode = browserErrorCode;
    return Object.keys(safe).length ? safe : undefined;
  };

  return ({
    sourceUrl = '',
    resolvedUrl = '',
    awemeId = '',
    stages = [],
    mediaCandidateCount = 0,
    preciseMediaFound = false,
    saveOriginalMediaEnabled = false,
    selectedStage = '',
    finalOutcome = '',
    downloadAttempts = [],
  } = {}) => ({
    source: getSafeUrlDiagnostic(sourceUrl),
    resolved: getSafeUrlDiagnostic(resolvedUrl),
    awemeId: safeText(awemeId),
    mediaCandidateCount: normalizeInteger(mediaCandidateCount, 100),
    preciseMediaFound: preciseMediaFound === true,
    saveOriginalMediaEnabled: saveOriginalMediaEnabled === true,
    selectedStage: safeText(selectedStage),
    finalOutcome: safeText(finalOutcome),
    stages: (Array.isArray(stages) ? stages : []).slice(-12).map((stage) => ({
      stage: safeText(stage && stage.stage),
      attempted: !stage || stage.attempted !== false,
      inputKind: safeText(stage && stage.inputKind),
      ok: stage && stage.ok !== false,
      mediaCount: normalizeInteger(stage && stage.mediaCount, 100),
      detailFound: stage && stage.detailFound === true,
      identityOutcome: safeText(stage && stage.identityOutcome),
      rejectionReason: safeText(stage && stage.rejectionReason),
      durationMs: normalizeInteger(stage && stage.durationMs, 30 * 60 * 1000),
      error: normalizeError(stage && stage.error),
    })),
    downloadAttempts: (Array.isArray(downloadAttempts) ? downloadAttempts : []).slice(-24).map((attempt) => ({
      transport: safeText(attempt && attempt.transport),
      ok: attempt && attempt.ok === true,
      status: normalizeInteger(attempt && attempt.status, 999),
      code: normalizeCode(attempt && attempt.code),
      mediaType: safeText(attempt && attempt.mediaType),
      bytes: normalizeInteger(attempt && attempt.bytes, 16 * 1024 * 1024 * 1024),
      refreshed: attempt && attempt.refreshed === true,
      durationMs: normalizeInteger(attempt && attempt.durationMs, 30 * 60 * 1000),
    })),
  });
}

module.exports = {
  createDouyinMediaResolutionDiagnosticBuilder,
};