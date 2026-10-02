'use strict';

const crypto = require('node:crypto');

// Keep this contract deliberately small. The server owns any association with
// a canonical content identity; the plugin only reports the sync record id.
const DIAGNOSTIC_ENDPOINT = '/diagnostics/events';
const MAX_OUTBOX_ITEMS = 100;
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BATCH_SIZE = 20;
const DEFAULT_RETRY_BASE_MS = 5 * 1000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 1000;
const NOT_FOUND_RETRY_BASE_MS = 60 * 60 * 1000;

const ALLOWED_EVENT_FIELDS = Object.freeze([
  'eventId',
  'attemptId',
  'diagnosticId',
  'syncRecordId',
  'errorType',
  'stage',
  'pluginVersion',
  'platform',
  'occurredAt',
  'retryCount',
  'outcome',
  'evidenceCodes',
  'errorCode',
]);

const SAFE_OUTCOMES = new Set(['succeeded', 'failed']);
const SAFE_STAGES = new Set([
  'upload',
  'fetch',
  'parse',
  'transcribe',
  'ocr',
  'write',
  'sync',
  'auth',
]);
const SAFE_PLATFORMS = new Set(['windows', 'macos', 'linux', 'ios', 'android', 'unknown']);
const SAFE_ERROR_CODES = new Set([
  'AUTH_FAILED',
  'EXTRACTION_FAILED',
  'LOCAL_COMPONENT_UNAVAILABLE',
  'NETWORK_FAILED',
  'NONE',
  'OCR_FAILED',
  'SYNC_FAILED',
  'TRANSCRIPTION_FAILED',
  'WRITE_FAILED',
]);
const SAFE_EVIDENCE_CODES = new Set([
  'network_timeout',
  'http_status',
  'dns_error',
  'auth_rejected',
  'http_403',
  'http_412',
  'http_5xx',
  'challenge_detected',
  'component_missing',
  'component_version',
  'parser_rejected',
  'asr_no_speech',
  'process_crashed',
  'component_crashed',
  'upgrade_required',
  'write_error',
  'sync_callback',
  'user_retry',
  'trusted_completion',
  'manual_review',
  'no_matching_evidence',
]);

function asFiniteInteger(value, fallback = 0, {min = 0, max = Number.MAX_SAFE_INTEGER} = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeSafeId(value, {min = 8, max = 128} = {}) {
  const source = String(value || '').trim();
  return new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`).test(source) ? source : '';
}

function normalizeRecordId(value) {
  return normalizeSafeId(value, { min: 1, max: 128 });
}

function normalizeTimestamp(value, now = Date.now()) {
  const source = String(value || '').trim();
  const timestamp = source ? new Date(source) : new Date(now);
  return Number.isNaN(timestamp.getTime()) ? new Date(now).toISOString() : timestamp.toISOString();
}

function normalizePluginVersion(value) {
  const source = String(value || '').trim();
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:[-+][A-Za-z0-9.-]+)?$/.test(source)
    ? source.slice(0, 64)
    : 'unknown';
}

function normalizePlatform(value) {
  const source = String(value || '').trim().toLowerCase();
  const aliases = {
    win32: 'windows',
    windows: 'windows',
    darwin: 'macos',
    mac: 'macos',
    macos: 'macos',
    linux: 'linux',
    ios: 'ios',
    android: 'android',
  };
  return aliases[source] || 'unknown';
}

function normalizeOutcome(value) {
  const source = String(value || '').trim().toLowerCase();
  if (source === 'success' || source === 'succeeded') return 'succeeded';
  if (source === 'failure' || source === 'failed') return 'failed';
  return 'failed';
}

function normalizeStage(value) {
  const source = String(value || '').trim().toLowerCase();
  const aliases = {
    fetching: 'fetch',
    processing: 'sync',
    writing: 'write',
    marking: 'sync',
    syncinbox: 'sync',
    finished: 'sync',
  };
  return SAFE_STAGES.has(source) ? source : (aliases[source] || 'sync');
}

function normalizeErrorCode(value, fallback = '') {
  const source = String(value || '').trim().toUpperCase();
  if (SAFE_ERROR_CODES.has(source)) return source;
  return SAFE_ERROR_CODES.has(fallback) ? fallback : '';
}

function normalizeEvidenceCodes(value, outcome, errorCode) {
  const values = Array.isArray(value) ? value : [];
  const result = [];
  for (const item of values) {
    const code = String(item || '').trim().toLowerCase();
    if (!SAFE_EVIDENCE_CODES.has(code) || result.includes(code)) continue;
    result.push(code);
    if (result.length >= 8) break;
  }
  if (outcome === 'succeeded' && !result.includes('sync_callback')) result.unshift('sync_callback');
  if (outcome === 'failed' && !result.length) {
    result.push('no_matching_evidence');
  }
  return result.slice(0, 8);
}

function getBindingFingerprint(bindingOrToken) {
  const source = bindingOrToken && typeof bindingOrToken === 'object'
    ? bindingOrToken.bindingFingerprint || bindingOrToken.token
    : bindingOrToken;
  const value = String(source || '').trim();
  if (!value) return '';
  if (/^[a-f0-9]{16,64}$/i.test(value) && (!bindingOrToken || !bindingOrToken.token)) {
    return value.toLowerCase();
  }
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}

function hashId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 32)}`;
}

function createDiagnosticId({ binding, bindingFingerprint, syncRecordId, attemptId, seed } = {}) {
  const scope = getBindingFingerprint(bindingFingerprint || binding);
  const recordId = normalizeRecordId(syncRecordId);
  // diagnosticId is the incident id. It must remain stable when a server
  // attempt is retried; attemptId belongs in eventId only.
  const value = [scope, recordId].join(':');
  return hashId('diag', value || String(seed || '') || crypto.randomBytes(16).toString('hex'));
}

function buildEventId(input = {}) {
  const normalized = {
    attemptId: normalizeSafeId(input.attemptId),
    diagnosticId: normalizeSafeId(input.diagnosticId),
    syncRecordId: normalizeRecordId(input.syncRecordId),
    outcome: normalizeOutcome(input.outcome),
    errorType: normalizeErrorCode(input.errorType),
    errorCode: normalizeErrorCode(input.errorCode),
    stage: normalizeStage(input.stage),
    retryCount: asFiniteInteger(input.retryCount),
  };
  return hashId('event', JSON.stringify(normalized));
}

function normalizeDiagnosticEvent(input = {}, defaults = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const outcome = normalizeOutcome(source.outcome || defaults.outcome);
  const errorType = outcome === 'failed'
    ? normalizeErrorCode(source.errorType || source.errorCode, 'SYNC_FAILED')
    : 'NONE';
  const errorCode = outcome === 'failed'
    ? normalizeErrorCode(source.errorCode || source.errorType, errorType)
    : 'NONE';
  const diagnosticId = normalizeSafeId(source.diagnosticId || defaults.diagnosticId)
    || createDiagnosticId({
      bindingFingerprint: defaults.bindingFingerprint,
      syncRecordId: source.syncRecordId || defaults.syncRecordId,
      attemptId: source.attemptId || defaults.attemptId,
      seed: defaults.seed,
    });
  const eventId = normalizeSafeId(source.eventId || defaults.eventId) || buildEventId({
    ...source,
    attemptId: source.attemptId || defaults.attemptId,
    syncRecordId: source.syncRecordId || defaults.syncRecordId,
    stage: source.stage || defaults.stage,
    retryCount: source.retryCount ?? defaults.retryCount,
    diagnosticId,
    outcome,
    errorType,
    errorCode,
  });
  const event = {
    eventId,
    pluginVersion: normalizePluginVersion(source.pluginVersion || defaults.pluginVersion),
    platform: normalizePlatform(source.platform || defaults.platform),
    occurredAt: normalizeTimestamp(source.occurredAt || defaults.occurredAt, defaults.now || Date.now()),
    retryCount: asFiniteInteger(source.retryCount ?? defaults.retryCount, 0, { min: 0, max: 100 }),
    outcome,
    evidenceCodes: normalizeEvidenceCodes(source.evidenceCodes || defaults.evidenceCodes, outcome, errorCode),
  };
  const attemptId = normalizeSafeId(source.attemptId || defaults.attemptId);
  const syncRecordId = normalizeRecordId(source.syncRecordId || defaults.syncRecordId);
  if (attemptId) event.attemptId = attemptId;
  event.diagnosticId = diagnosticId;
  if (syncRecordId) event.syncRecordId = syncRecordId;
  const stage = normalizeStage(source.stage || defaults.stage);
  event.stage = stage;
  if (outcome === 'failed') {
    event.errorType = errorType;
    event.errorCode = errorCode;
  } else {
    event.errorType = 'NONE';
  }
  // Rebuild by the explicit allowlist so a caller can never smuggle message,
  // title, body, URL, path, token, stack, or internal outbox fields into JSON.
  return ALLOWED_EVENT_FIELDS.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(event, key)) result[key] = event[key];
    return result;
  }, {});
}

function normalizeOutbox(value, { now = Date.now(), maxItems = MAX_OUTBOX_ITEMS } = {}) {
  const current = Number(now) || Date.now();
  const byId = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const bindingFingerprint = getBindingFingerprint(item.bindingFingerprint);
    if (!bindingFingerprint) continue;
    const createdAt = normalizeTimestamp(item.createdAt, current);
    const createdAtMs = Date.parse(createdAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs + OUTBOX_TTL_MS < current) continue;
    const event = normalizeDiagnosticEvent(item.event && typeof item.event === 'object' ? item.event : item, {
      now: current,
    });
    // Cloud aggregates count server-issued attempts. Discard legacy or
    // malformed snapshots without one instead of retrying a fabricated
    // denominator forever after restart.
    if (!event.eventId || !event.attemptId) continue;
    const nextAttemptAt = Math.max(
      current,
      Number.isFinite(Number(item.nextAttemptAt)) ? Number(item.nextAttemptAt) : current,
    );
    const normalized = {
      event,
      bindingFingerprint,
      createdAt,
      nextAttemptAt,
      uploadAttempts: asFiniteInteger(item.uploadAttempts, 0, { min: 0, max: 1000 }),
    };
    const key = `${bindingFingerprint}:${event.eventId}`;
    byId.set(key, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt) || 0;
      const rightTime = Date.parse(right.createdAt) || 0;
      return leftTime - rightTime;
    })
    .slice(-Math.max(1, asFiniteInteger(maxItems, MAX_OUTBOX_ITEMS, { min: 1, max: 1000 })));
}

function getRetryDelay(uploadAttempts, retryBaseMs = DEFAULT_RETRY_BASE_MS) {
  const attempt = asFiniteInteger(uploadAttempts, 0, { min: 0, max: 30 });
  const base = Math.max(1, asFiniteInteger(retryBaseMs, DEFAULT_RETRY_BASE_MS, { min: 1, max: MAX_RETRY_DELAY_MS }));
  return Math.min(MAX_RETRY_DELAY_MS, base * (2 ** Math.min(attempt, 16)));
}

function getErrorStatus(error) {
  return Number(error && (error.status || error.statusCode || error.response && error.response.status)) || 0;
}

function withTimeout(promise, timeoutMs, setTimeoutImpl, clearTimeoutImpl) {
  const limit = Math.max(1, asFiniteInteger(timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, { min: 1, max: 120 * 1000 }));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeoutImpl(() => {
      if (settled) return;
      settled = true;
      const error = new Error('diagnostic report request timed out');
      error.code = 'DIAGNOSTIC_REPORT_TIMEOUT';
      reject(error);
    }, limit);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeoutImpl(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeoutImpl(timer);
      reject(error);
    });
  });
}

function resolveBindingMap(bindings) {
  const map = new Map();
  for (const binding of Array.isArray(bindings) ? bindings : []) {
    const fingerprint = getBindingFingerprint(binding);
    const token = String(binding && binding.token || '').trim();
    if (!fingerprint || !token || binding.enabled === false || ['unbound', 'needs_rebind', 'paused'].includes(binding.status)) continue;
    map.set(fingerprint, binding);
  }
  return map;
}

function createSyncDiagnosticReporter(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const maxItems = asFiniteInteger(options.maxItems, MAX_OUTBOX_ITEMS, { min: 1, max: 1000 });
  const ttlMs = Math.max(1000, asFiniteInteger(options.ttlMs, OUTBOX_TTL_MS, { min: 1000, max: 30 * 24 * 60 * 60 * 1000 }));
  const retryBaseMs = Math.max(1, asFiniteInteger(options.retryBaseMs, DEFAULT_RETRY_BASE_MS, { min: 1, max: MAX_RETRY_DELAY_MS }));
  const requestTimeoutMs = Math.max(1, asFiniteInteger(
    options.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    { min: 1, max: 120 * 1000 },
  ));
  const setTimeoutImpl = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
  const clearTimeoutImpl = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout;
  const getBindings = typeof options.getBindings === 'function' ? options.getBindings : () => [];
  const saveOutbox = typeof options.saveOutbox === 'function'
    ? options.saveOutbox
    : (typeof options.persist === 'function' ? options.persist : async () => {});
  const postEvents = typeof options.postEvents === 'function'
    ? options.postEvents
    : typeof options.requestJson === 'function'
      ? (events, binding) => options.requestJson(
        DIAGNOSTIC_ENDPOINT,
        'POST',
        { events },
        binding,
        { diagnosticReport: true, timeoutMs: requestTimeoutMs },
      )
      : null;
  let disposed = false;
  let outbox = normalizeOutbox(options.initialOutbox || [], { now: now(), maxItems });
  let timer = null;
  let flushPromise = null;
  let persistPromise = Promise.resolve();

  function currentOutbox() {
    outbox = normalizeOutbox(outbox, { now: now(), maxItems });
    // Apply the reporter's configurable TTL in addition to the shared default
    // normalizer so tests and future migrations can use a shorter retention.
    const cutoff = Number(now()) - ttlMs;
    outbox = outbox.filter((entry) => (Date.parse(entry.createdAt) || 0) >= cutoff);
    return outbox;
  }

  function persistSnapshot() {
    const snapshot = currentOutbox().map((entry) => ({
      event: { ...entry.event, evidenceCodes: [...entry.event.evidenceCodes] },
      bindingFingerprint: entry.bindingFingerprint,
      createdAt: entry.createdAt,
      nextAttemptAt: entry.nextAttemptAt,
      uploadAttempts: entry.uploadAttempts,
    }));
    persistPromise = persistPromise
      .catch(() => {})
      .then(() => saveOutbox(snapshot))
      .catch(() => {});
    return persistPromise;
  }

  function scheduleFlush(delay = 0) {
    if (disposed || !postEvents || timer) return;
    const wait = Math.max(0, asFiniteInteger(delay, 0, { min: 0, max: MAX_RETRY_DELAY_MS }));
    timer = setTimeoutImpl(() => {
      timer = null;
      void flush().catch(() => {});
    }, wait);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function enqueue(input = {}, bindingOrOptions = null) {
    if (disposed) return { queued: false, reason: 'disposed' };
    const binding = bindingOrOptions && bindingOrOptions.binding
      ? bindingOrOptions.binding
      : bindingOrOptions;
    const bindingFingerprint = getBindingFingerprint(binding);
    if (!bindingFingerprint) return { queued: false, reason: 'missing-binding' };
    const event = normalizeDiagnosticEvent(input, {
      pluginVersion: options.pluginVersion,
      platform: options.platform,
      bindingFingerprint,
      now: now(),
    });
    if (!event.attemptId) return { queued: false, reason: 'missing-attempt' };
    const key = `${bindingFingerprint}:${event.eventId}`;
    const existing = currentOutbox().find((entry) => `${entry.bindingFingerprint}:${entry.event.eventId}` === key);
    if (existing) {
      scheduleFlush(0);
      return { queued: false, duplicate: true, event: { ...existing.event } };
    }
    const createdAt = normalizeTimestamp(event.occurredAt, now());
    outbox = normalizeOutbox([
      ...currentOutbox(),
      {
        event,
        bindingFingerprint,
        createdAt,
        nextAttemptAt: now(),
        uploadAttempts: 0,
      },
    ], { now: now(), maxItems });
    void persistSnapshot();
    scheduleFlush(0);
    return { queued: true, event: { ...event } };
  }

  async function flush({ binding = null, bindings = null } = {}) {
    if (disposed || !postEvents) return { sent: 0, retained: currentOutbox().length, failed: 0 };
    if (flushPromise) return await flushPromise;
    flushPromise = (async () => {
      await persistPromise.catch(() => {});
      if (disposed) return { sent: 0, retained: currentOutbox().length, failed: 0 };
      // Resolve the current active bindings immediately before sending. A
      // timer may have been queued with an older binding object; that object
      // must never authorize a re-bound account.
      const available = resolveBindingMap(bindings || getBindings());
      const requestedFingerprint = binding ? getBindingFingerprint(binding) : '';
      if (requestedFingerprint) {
        for (const fingerprint of [...available.keys()]) {
          if (fingerprint !== requestedFingerprint) available.delete(fingerprint);
        }
      }
      const stats = { sent: 0, retained: 0, failed: 0 };
      const currentTime = Number(now()) || Date.now();
      const eligible = currentOutbox().filter((entry) => (
        available.has(entry.bindingFingerprint)
        && entry.nextAttemptAt <= currentTime
      ));
      for (const [bindingFingerprint, bindingValue] of available) {
        const entries = eligible
          .filter((entry) => entry.bindingFingerprint === bindingFingerprint)
          .slice(0, MAX_BATCH_SIZE);
        if (!entries.length) continue;
        try {
          const response = await withTimeout(
            postEvents(entries.map((entry) => ({ ...entry.event })), bindingValue),
            requestTimeoutMs,
            setTimeoutImpl,
            clearTimeoutImpl,
          );
          const responseAcceptedEventIds = response && Array.isArray(response.acceptedEventIds)
            ? response.acceptedEventIds
            : response && response.data && Array.isArray(response.data.acceptedEventIds)
              ? response.data.acceptedEventIds
              : null;
          const responseSingleEventId = response && typeof response.eventId === 'string'
            ? response.eventId
            : response && response.data && typeof response.data.eventId === 'string'
              ? response.data.eventId
              : '';
          const hasExplicitAck = Array.isArray(responseAcceptedEventIds) || Boolean(responseSingleEventId);
          const acceptedEventIds = new Set(
            (Array.isArray(responseAcceptedEventIds) ? responseAcceptedEventIds : [responseSingleEventId])
              .map((value) => String(value || '').trim())
              .filter(Boolean),
          );
          // A successful HTTP response without an explicit event id is not an
          // acknowledgement. Retain every event until the server confirms it;
          // this also keeps an older or partial response from silently losing
          // diagnostics.
          const sentIds = hasExplicitAck
            ? new Set(entries.filter((entry) => acceptedEventIds.has(entry.event.eventId)).map((entry) => entry.event.eventId))
            : new Set();
          const unackedEntries = entries.filter((entry) => !sentIds.has(entry.event.eventId));
          outbox = currentOutbox().filter((entry) => !(entry.bindingFingerprint === bindingFingerprint && sentIds.has(entry.event.eventId)));
          stats.sent += sentIds.size;
          if (unackedEntries.length) {
            const attemptedAt = Number(now()) || Date.now();
            const unackedIds = new Set(unackedEntries.map((entry) => entry.event.eventId));
            outbox = currentOutbox().map((entry) => {
              if (entry.bindingFingerprint !== bindingFingerprint || !unackedIds.has(entry.event.eventId)) return entry;
              const uploadAttempts = entry.uploadAttempts + 1;
              return {
                ...entry,
                uploadAttempts,
                nextAttemptAt: attemptedAt + getRetryDelay(uploadAttempts, retryBaseMs),
              };
            });
            stats.failed += unackedEntries.length;
          }
          await persistSnapshot();
        } catch (error) {
          // Reporting failures are intentionally opaque and never become new
          // diagnostic events. Keep the event for a later retry instead.
          const attemptedAt = Number(now()) || Date.now();
          const attemptedIds = new Set(entries.map((entry) => entry.event.eventId));
          outbox = currentOutbox().map((entry) => {
            if (entry.bindingFingerprint !== bindingFingerprint || !attemptedIds.has(entry.event.eventId)) return entry;
            const uploadAttempts = entry.uploadAttempts + 1;
            const status = getErrorStatus(error);
            const effectiveBase = status === 404
              ? Math.max(retryBaseMs, NOT_FOUND_RETRY_BASE_MS)
              : retryBaseMs;
            return {
              ...entry,
              uploadAttempts,
              nextAttemptAt: attemptedAt + getRetryDelay(uploadAttempts, effectiveBase),
            };
          });
          stats.failed += entries.length;
          await persistSnapshot();
        }
      }
      stats.retained = currentOutbox().length;
      const nextDue = currentOutbox()
        .filter((entry) => available.has(entry.bindingFingerprint))
        .reduce((minimum, entry) => Math.min(minimum, entry.nextAttemptAt), Infinity);
      if (Number.isFinite(nextDue)) scheduleFlush(Math.max(0, nextDue - (Number(now()) || Date.now())));
      return stats;
    })().finally(() => {
      flushPromise = null;
    });
    return await flushPromise;
  }

  function dispose() {
    disposed = true;
    if (timer) {
      clearTimeoutImpl(timer);
      timer = null;
    }
  }

  return {
    enqueue,
    flush,
    dispose,
    kick: () => scheduleFlush(0),
    getOutbox: () => currentOutbox().map((entry) => ({
      event: { ...entry.event, evidenceCodes: [...entry.event.evidenceCodes] },
      bindingFingerprint: entry.bindingFingerprint,
      createdAt: entry.createdAt,
      nextAttemptAt: entry.nextAttemptAt,
      uploadAttempts: entry.uploadAttempts,
    })),
    getPendingCount: () => currentOutbox().length,
    whenIdle: () => persistPromise,
    isDisposed: () => disposed,
  };
}

module.exports = {
  ALLOWED_EVENT_FIELDS,
  DIAGNOSTIC_ENDPOINT,
  DEFAULT_RETRY_BASE_MS,
  MAX_OUTBOX_ITEMS,
  OUTBOX_TTL_MS,
  SAFE_ERROR_CODES,
  SAFE_EVIDENCE_CODES,
  buildEventId,
  createDiagnosticId,
  createSyncDiagnosticReporter,
  getBindingFingerprint,
  getRetryDelay,
  normalizeDiagnosticEvent,
  normalizeOutcome,
  normalizeOutbox,
  normalizePlatform,
  normalizeStage,
};
