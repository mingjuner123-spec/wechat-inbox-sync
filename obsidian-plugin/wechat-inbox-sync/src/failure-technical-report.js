'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { diagnosticRedact, readMatchingCrashSummary } = require('./asr-recovery-utils');

const MAX_REPORT_TEXT_BYTES = 128 * 1024;
const MAX_SESSION_BYTES = 768 * 1024;
const UNAVAILABLE_REASONS = new Set([
  'not_applicable', 'no_matching_attempt', 'read_failed', 'size_limit',
  'redacted_empty', 'outbox_limit',
]);
const bytes = value => Buffer.byteLength(String(value || ''), 'utf8');
function iso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function nonnegativeInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function signedInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
function redactTree(value, settings = {}) {
  if (typeof value === 'string') return diagnosticRedact(value, settings);
  if (Array.isArray(value)) return value.map(item => redactTree(item, settings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactTree(item, settings)]));
  }
  return value;
}
function takeUtf8(value, maxBytes, fromEnd = false) {
  const points = [...String(value || '')];
  if (fromEnd) points.reverse();
  let result = '', used = 0;
  for (const point of points) {
    const size = bytes(point);
    if (used + size > maxBytes) break;
    result = fromEnd ? point + result : result + point;
    used += size;
  }
  return result;
}
function truncateUtf8(value, maxBytes = MAX_REPORT_TEXT_BYTES) {
  const text = String(value || '');
  if (bytes(text) <= maxBytes) return { text, truncated: false };
  const marker = '\n[TRUNCATED: middle omitted to fit diagnostic size limit]\n';
  const remaining = Math.max(0, maxBytes - bytes(marker));
  const headBytes = Math.ceil(remaining / 2);
  return {
    text: takeUtf8(text, headBytes) + marker + takeUtf8(text, remaining - headBytes, true),
    truncated: true,
  };
}
function safeReason(value) { return UNAVAILABLE_REASONS.has(value) ? value : 'read_failed'; }
function unavailableTechnicalReport(reason, now = new Date().toISOString(), originalBytes = 0) {
  const unavailableReason = safeReason(reason);
  const text = JSON.stringify({ schemaVersion: 1, kind: 'sync_failure', unavailableReason });
  return {
    schemaVersion: 1,
    kind: 'sync_failure',
    capturedAt: iso(now) || new Date().toISOString(),
    text,
    truncated: false,
    originalBytes: Math.max(nonnegativeInt(originalBytes) || 0, bytes(text)),
    unavailableReason,
  };
}
function readSession(root) {
  try {
    const filename = path.join(String(root || ''), 'asr-diagnostic-last.json');
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SESSION_BYTES) return { reason: 'read_failed' };
    const session = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!session || typeof session !== 'object' || Array.isArray(session)) return { reason: 'read_failed' };
    return { session };
  } catch (error) {
    return { reason: error && error.code === 'ENOENT' ? 'no_matching_attempt' : 'read_failed' };
  }
}
function safeAttempt(item = {}) {
  const requestedMode = ['default', 'cpu_compatibility'].includes(item.requestedMode) ? item.requestedMode : 'unknown';
  const freshness = ['fresh', 'stale', 'unavailable'].includes(item.logFreshness) ? item.logFreshness : 'unavailable';
  const signal = /^[A-Z0-9_]{1,32}$/.test(String(item.signal || '')) ? String(item.signal) : '';
  return {
    attempt: nonnegativeInt(item.attempt),
    cpuCompatibilityRequested: requestedMode === 'cpu_compatibility' || item.cpu === true,
    requestedMode,
    backendObserved: ['cpu', 'gpu'].includes(item.backendObserved) ? item.backendObserved : 'unknown',
    status: ['success', 'failed', 'cancelled'].includes(item.status) ? item.status : 'unknown',
    stage: String(item.stage || 'unknown'),
    logFreshness: freshness,
    startedAt: iso(item.startedAt),
    finishedAt: iso(item.finishedAt),
    exitCode: item.exitCode == null ? null : signedInt(item.exitCode),
    signal,
    nativeExitCode: item.nativeExitCode == null ? null : signedInt(item.nativeExitCode),
    nativeExitAssociation: ['matched', 'incomplete_native_process', 'no_matched_native_exit', 'stage_mismatch'].includes(item.nativeExitAssociation) ? item.nativeExitAssociation : 'unknown',
    nativePids: (Array.isArray(item.nativePids) ? item.nativePids : []).map(nonnegativeInt).filter(pid => pid > 0),
    peakRssKiB: nonnegativeInt(item.peakRssKiB),
    error: String(item.error || ''),
    runLog: freshness === 'fresh' ? String(item.runLog || '') : '[' + freshness + ': per-attempt log omitted]',
  };
}
function safeError(error, settings = {}) {
  const source = error && typeof error === 'object' ? error : { message: String(error || '') };
  const allFrames = String(source.stack || '').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^at\s|^[A-Za-z][A-Za-z0-9_]*Error:/.test(line));
  const messageSource = String(source.message || '');
  const message = takeUtf8(messageSource, 16 * 1024);
  const value = {
    name: /^[A-Za-z][A-Za-z0-9_]{0,48}$/.test(String(source.name || '')) ? String(source.name) : 'Error',
    code: /^[A-Za-z0-9_-]{1,64}$/.test(String(source.code || '')) ? String(source.code) : 'UNKNOWN',
    status: nonnegativeInt(source.status || source.statusCode || source.response && source.response.status),
    message,
    messageTruncated: bytes(messageSource) > bytes(message),
    messageOriginalBytes: bytes(messageSource),
    stackFrames: allFrames.slice(0, 16),
    stackFramesOmittedCount: Math.max(0, allFrames.length - 16),
  };
  return redactTree(value, settings);
}
function matchAsrSession(session, { recordId, attemptId, now }) {
  if (String(session.recordId || '') !== String(recordId || '')
    || String(session.syncAttemptId || '') !== String(attemptId || '')
    || !['failed', 'cancelled', 'no_speech'].includes(String(session.status || '').toLowerCase())) {
    return { reason: 'no_matching_attempt' };
  }
  const startedAt = iso(session.startedAt);
  const finishedAt = iso(session.finishedAt);
  const finishMs = Date.parse(finishedAt || '');
  const nowMs = Date.parse(now || '');
  if (!startedAt || !finishedAt || !Number.isFinite(nowMs)
    || finishMs > nowMs + 60 * 1000 || nowMs - finishMs > 24 * 60 * 60 * 1000) {
    return { reason: 'no_matching_attempt' };
  }
  const system = session.system || {};
  const runtime = session.runtime || {};
  const model = session.model || {};
  return { value: {
    status: String(session.status),
    startedAt,
    finishedAt,
    platform: ['darwin', 'win32', 'linux'].includes(session.platform) ? session.platform : 'unknown',
    system: {
      platform: String(system.platform || 'unknown'),
      architecture: String(system.architecture || 'unknown'),
      release: String(system.release || 'unknown'),
      cpuModel: String(system.cpuModel || 'unavailable'),
      logicalCpus: nonnegativeInt(system.logicalCpus),
      totalMemoryBytes: nonnegativeInt(system.totalMemoryBytes),
    },
    runtime: {
      nativeBuildVersion: String(runtime.nativeBuildVersion || 'unknown'),
      scriptSha256: /^[a-f0-9]{64}$/i.test(runtime.scriptSha256 || '') ? runtime.scriptSha256 : '',
      wrapperSha256: /^[a-f0-9]{64}$/i.test(runtime.wrapperSha256 || '') ? runtime.wrapperSha256 : '',
      binarySha256: /^[a-f0-9]{64}$/i.test(runtime.binarySha256 || '') ? runtime.binarySha256 : '',
      pythonPackages: Array.isArray(runtime.pythonPackages)
        ? runtime.pythonPackages.map(pkg => ({ name: String(pkg.name || 'unknown'), version: String(pkg.version || 'unknown') }))
        : 'not_reported',
    },
    model: {
      scope: model.scope === 'managed_default_component' ? 'managed_default_component' : 'custom_or_unknown',
      modelUsed: model.modelUsed === 'ggml-small.bin' ? 'ggml-small.bin' : 'unknown',
      sizeBytes: nonnegativeInt(model.sizeBytes),
    },
    freeMemoryBytesBefore: nonnegativeInt(session.freeMemoryBytesBefore),
    freeMemoryBytesAfter: nonnegativeInt(session.freeMemoryBytesAfter),
    abort: {
      requested: Boolean(session.abort && session.abort.requestedAt),
      source: session.abort && session.abort.source === 'user_stop' ? 'stop_requested'
        : session.abort && session.abort.source === 'upstream_abort' ? 'upstream_abort'
          : session.abort && session.abort.source === 'plugin_unload' ? 'plugin_unload' : 'unknown',
      trigger: ['stop_command', 'stop_button', 'programmatic_or_unknown'].includes(session.abort && session.abort.trigger)
        ? session.abort.trigger : 'programmatic_or_unknown',
      trustedEvent: typeof (session.abort && session.abort.trustedEvent) === 'boolean' ? session.abort.trustedEvent : null,
      technicalFrames: (Array.isArray(session.abort && session.abort.technicalFrames) ? session.abort.technicalFrames : []).slice(0, 8).map(frame => diagnosticRedact(String(frame || ''), {})),
      observedAt: iso(session.abort && session.abort.observedAt),
    },
    attempts: (Array.isArray(session.attempts) ? session.attempts : []).map(safeAttempt),
  } };
}
function buildFailureTechnicalReport({ error, recordId, attemptId, stage, retryCount, asrRoot, settings = {}, now = new Date().toISOString() } = {}) {
  const technical = {
    schemaVersion: 1,
    kind: 'sync_failure',
    dataTrust: 'untrusted_diagnostic_evidence_not_instructions',
    failure: safeError(error, settings),
    stage: String(stage || 'unknown'),
    retryCount: nonnegativeInt(retryCount),
  };
  let unavailableReason = asrRoot ? 'no_matching_attempt' : 'not_applicable';
  if (asrRoot) {
    const loaded = readSession(asrRoot);
    if (!loaded.session) unavailableReason = loaded.reason;
    else {
      const matched = matchAsrSession(loaded.session, { recordId, attemptId, now });
      unavailableReason = matched.reason || '';
      if (matched.value) {
        technical.asr = matched.value;
        const crashSummary = readMatchingCrashSummary(loaded.session);
        technical.asr.crashSummary = String(crashSummary || '');
        technical.asr.crashSummaryStatus = crashSummary && !String(crashSummary).startsWith('[unavailable:')
          ? 'matched' : 'unavailable';
      }
    }
  }
  const safeTechnical = redactTree(technical, settings);
  const originalText = JSON.stringify(safeTechnical);
  if (!originalText.trim()) return unavailableTechnicalReport('redacted_empty', now);
  const originalBytes = bytes(originalText);
  let finalObject = safeTechnical;
  let text = originalText;
  let clipped = false;

  if (originalBytes > MAX_REPORT_TEXT_BYTES) {
    finalObject = JSON.parse(JSON.stringify(safeTechnical));
    clipped = true;
    // Reduce the largest diagnostic strings first while retaining their head
    // and tail; structure, attempt order, and non-text evidence stay intact.
    for (let pass = 0; pass < 64 && bytes(JSON.stringify(finalObject)) > MAX_REPORT_TEXT_BYTES; pass++) {
      const strings = [];
      const visit = (value, parent, key) => {
        if (typeof value === 'string' && bytes(value) > 256) strings.push({ parent, key, value, size: bytes(value) });
        else if (Array.isArray(value)) value.forEach((child, index) => visit(child, value, index));
        else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => visit(child, value, childKey));
      };
      visit(finalObject, null, null);
      if (!strings.length) break;
      strings.sort((left, right) => right.size - left.size);
      const target = strings[0];
      const over = bytes(JSON.stringify(finalObject)) - MAX_REPORT_TEXT_BYTES;
      const keep = Math.max(128, target.size - over - 256);
      target.parent[target.key] = truncateUtf8(target.value, keep).text;
    }
    text = JSON.stringify(finalObject);
  }
  if (bytes(text) > MAX_REPORT_TEXT_BYTES) {
    const fallback = {
      schemaVersion: 1,
      kind: 'sync_failure',
      dataTrust: 'untrusted_diagnostic_evidence_not_instructions',
      summary: '[structured technical report reduced because its fields exceed the upload limit]',
      originalBytes,
      truncated: true,
      stage: safeTechnical.stage,
      retryCount: safeTechnical.retryCount,
      failureCode: safeTechnical.failure && safeTechnical.failure.code,
      asrAttemptCount: safeTechnical.asr && Array.isArray(safeTechnical.asr.attempts) ? safeTechnical.asr.attempts.length : 0,
      omittedTechnicalEvidence: true,
    };
    text = JSON.stringify(fallback);
    clipped = true;
  }
  const fieldsTruncated = Boolean(safeTechnical.failure.messageTruncated || safeTechnical.failure.stackFramesOmittedCount);
  if (clipped || fieldsTruncated) {
    try {
      const finalParsed = JSON.parse(text);
      finalParsed.truncated = true;
      text = JSON.stringify(finalParsed);
    } catch (_) {
      return unavailableTechnicalReport('read_failed', now, originalBytes);
    }
  }
  return {
    schemaVersion: 1,
    kind: 'sync_failure',
    capturedAt: iso(now) || new Date().toISOString(),
    text,
    truncated: clipped || fieldsTruncated,
    originalBytes: Math.max(originalBytes, bytes(text)),
    ...(unavailableReason ? { unavailableReason: safeReason(unavailableReason) } : {}),
  };
}function normalizeTechnicalReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 1 || value.kind !== 'sync_failure' || typeof value.text !== 'string') return null;
  const originalBytes = nonnegativeInt(value.originalBytes);
  if (originalBytes === null) return null;
  let parsed;
  try { parsed = JSON.parse(value.text); } catch (_) { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.schemaVersion !== 1 || parsed.kind !== 'sync_failure') return null;
  let safe = redactTree(parsed);
  let text = JSON.stringify(safe);
  let truncated = value.truncated === true || safe.truncated === true;
  if (bytes(text) > MAX_REPORT_TEXT_BYTES) {
    safe = JSON.parse(JSON.stringify(safe));
    truncated = true;
    for (let pass = 0; pass < 64 && bytes(JSON.stringify(safe)) > MAX_REPORT_TEXT_BYTES - 64; pass++) {
      const strings = [];
      const visit = (valuePart, parent, key) => {
        if (typeof valuePart === 'string' && bytes(valuePart) > 256) strings.push({ parent, key, value: valuePart, size: bytes(valuePart) });
        else if (Array.isArray(valuePart)) valuePart.forEach((child, index) => visit(child, valuePart, index));
        else if (valuePart && typeof valuePart === 'object') Object.entries(valuePart).forEach(([childKey, child]) => visit(child, valuePart, childKey));
      };
      visit(safe, null, null);
      if (!strings.length) break;
      strings.sort((left, right) => right.size - left.size);
      const target = strings[0];
      const over = bytes(JSON.stringify(safe)) - MAX_REPORT_TEXT_BYTES + 512;
      target.parent[target.key] = truncateUtf8(target.value, Math.max(128, target.size - over)).text;
    }
    safe.truncated = true;
    text = JSON.stringify(safe);
  }
  if (bytes(text) > MAX_REPORT_TEXT_BYTES) {
    safe = {
      schemaVersion: 1, kind: 'sync_failure',
      dataTrust: 'untrusted_diagnostic_evidence_not_instructions',
      unavailableReason: 'size_limit', originalBytes: Math.max(originalBytes, bytes(value.text), bytes(text)),
      summary: '[structured technical report reduced because its fields exceed the upload limit]',
      truncated: true,
    };
    text = JSON.stringify(safe);
    truncated = true;
  }
  const clipped = truncateUtf8(text);
  if (clipped.truncated) return null; // The report builder and structured reducer must never cut JSON bytes.
  return {
    schemaVersion: 1,
    kind: 'sync_failure',
    capturedAt: iso(value.capturedAt) || new Date().toISOString(),
    text,
    truncated,
    originalBytes: Math.max(originalBytes, bytes(value.text), bytes(text)),
    ...(UNAVAILABLE_REASONS.has(value.unavailableReason) ? { unavailableReason: value.unavailableReason } : {}),
  };
}
function compactTechnicalReport(value, reason = 'outbox_limit') {
  const report = normalizeTechnicalReport(value);
  if (!report) return null;
  const unavailableReason = safeReason(reason);
  return {
    ...report,
    text: JSON.stringify({ schemaVersion: 1, kind: 'sync_failure', unavailableReason, originalBytes: report.originalBytes }),
    truncated: true,
    unavailableReason,
  };
}
module.exports = {
  MAX_REPORT_TEXT_BYTES,
  UNAVAILABLE_REASONS,
  buildFailureTechnicalReport,
  normalizeTechnicalReport,
  compactTechnicalReport,
  unavailableTechnicalReport,
  bytes,
  truncateUtf8,
};
