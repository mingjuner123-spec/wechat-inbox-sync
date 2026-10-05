'use strict';

function createDouyinMediaResolutionDiagnosticBuilder(dependencies = {}) {
  const {
    getSafeUrlDiagnostic = () => ({ protocol: '', host: '' }),
    getTransportErrorDiagnostic = () => ({}),
  } = dependencies;

  const safeText = (value, maxLength = 64) => String(value || '').trim().slice(0, maxLength);
  const byteLength = value => Buffer.byteLength(String(value || ''), 'utf8');
  const takeUtf8 = (value, maxBytes) => {
    let text = ''; let used = 0;
    for (const point of [...String(value || '')]) {
      const size = byteLength(point);
      if (used + size > maxBytes) break;
      text += point; used += size;
    }
    return text;
  };
  const safeMessageInfo = value => {
    const redacted = String(value || '').replace(/\s+/g, ' ').trim();
    const text = takeUtf8(redacted, 512);
    return { text, truncated: byteLength(redacted) > byteLength(text), originalBytes: byteLength(redacted), omittedBytes: Math.max(0, byteLength(redacted) - byteLength(text)) };
  };
  const normalizeCode = (value) => { const code = safeText(value, 64); return code ? (/^[A-Z0-9_.-]+$/.test(code) ? code : 'UNKNOWN') : ''; };
  const normalizeInteger = (value, maxValue) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(maxValue, Math.round(numeric)));
  };
  const normalizeError = (error) => {
    if (!error) return undefined;
    const diagnostic = getTransportErrorDiagnostic(error) || {};
    const safe = {};
    const code = normalizeCode(diagnostic.code);
    if (code) safe.code = code;
    const status = normalizeInteger(diagnostic.status, 999);
    if (status) safe.status = status;
    if (error.browserCode) safe.browserCode = normalizeCode(error.browserCode);
    if (Number.isInteger(error.exitCode)) safe.exitCode = error.exitCode;
    const messageInfo = safeMessageInfo(diagnostic.message);
    if (messageInfo.text) safe.message = messageInfo.text;
    if (messageInfo.truncated) {
      safe.messageTruncated = true;
      safe.messageOriginalBytes = messageInfo.originalBytes;
      safe.messageOmittedBytes = messageInfo.omittedBytes;
    }
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
    resolverVersion = 'unknown',
    downloadAttempts = [],
    pluginDouyinLogin = false,
    challengeDetected = false,
  } = {}) => {
    const rawStages = Array.isArray(stages) ? stages : [];
    const safeStages = rawStages.slice(-12).map((stage) => ({
      stage: safeText(stage && stage.stage),
      resolverVersion: safeText(stage && stage.resolverVersion) || 'unknown',
      attempted: !stage || stage.attempted !== false,
      inputKind: safeText(stage && stage.inputKind),
      ok: stage && stage.ok !== false,
      mediaCount: normalizeInteger(stage && stage.mediaCount, 100),
      stateFormat: safeText(stage && stage.stateFormat),
      exactMediaCount: normalizeInteger(stage && stage.exactMediaCount, 100),
      primaryMediaCount: normalizeInteger(stage && stage.primaryMediaCount, 100),
      detailFound: stage && stage.detailFound === true,
      identityOutcome: safeText(stage && stage.identityOutcome),
      rejectionReason: safeText(stage && stage.rejectionReason),
      durationMs: normalizeInteger(stage && stage.durationMs, 30 * 60 * 1000),
      error: normalizeError(stage && stage.error),
    }));
    const stagesOmittedCount = Math.max(0, rawStages.length - 12);
    const messageOmittedBytes = safeStages.reduce((total, stage) => total + (Number(stage.error && stage.error.messageOmittedBytes) || 0), 0);
    const result = {
      source: getSafeUrlDiagnostic(sourceUrl),
      resolved: getSafeUrlDiagnostic(resolvedUrl),
      awemeId: safeText(awemeId),
      mediaCandidateCount: normalizeInteger(mediaCandidateCount, 100),
      preciseMediaFound: preciseMediaFound === true,
      pluginDouyinLogin: pluginDouyinLogin === true,
      challengeDetected: challengeDetected === true,
      saveOriginalMediaEnabled: saveOriginalMediaEnabled === true,
      selectedStage: safeText(selectedStage),
      finalOutcome: safeText(finalOutcome),
      resolverVersion: safeText(resolverVersion) || 'unknown',
      stages: safeStages,
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
    };
    if (stagesOmittedCount) result.stagesOmittedCount = stagesOmittedCount;
    if (messageOmittedBytes) result.messageOmittedBytes = messageOmittedBytes;
    if (stagesOmittedCount || messageOmittedBytes) result.truncated = true;
    return result;
  };
}

module.exports = {
  createDouyinMediaResolutionDiagnosticBuilder,
};
