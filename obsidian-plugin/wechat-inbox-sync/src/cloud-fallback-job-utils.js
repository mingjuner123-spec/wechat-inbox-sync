'use strict';

const CONNECTION_TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CONNECTION_TICKET_PAYLOAD_LENGTH = 12;
const CONNECTION_TICKET_PATTERN = new RegExp(
  `^CNT[${CONNECTION_TICKET_ALPHABET}]{${CONNECTION_TICKET_PAYLOAD_LENGTH}}$`,
);

const TERMINAL_CLOUD_FALLBACK_STATUSES = new Set([
  'succeeded',
  'no_speech',
  'needs_action',
  'cancelled',
  // The note is written locally and the cloud copy has been released. The
  // status only appears while an acknowledgement is being reconciled.
  'acknowledged',
]);

const CLOUD_FALLBACK_STATUSES = new Set([
  'queued',
  'acquiring',
  'transcribing',
  'submitting',
  'submission_unknown',
  ...TERMINAL_CLOUD_FALLBACK_STATUSES,
]);

function normalizeConnectionTicket(value) {
  const compact = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
  if (!CONNECTION_TICKET_PATTERN.test(compact)) return '';
  const payload = compact.slice(3);
  return `CNT-${payload.slice(0, 4)}-${payload.slice(4, 8)}-${payload.slice(8, 12)}`;
}

function isConnectionTicket(value) {
  return Boolean(normalizeConnectionTicket(value));
}

function normalizeCloudFallbackStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return CLOUD_FALLBACK_STATUSES.has(status) ? status : 'failed';
}

function normalizeCloudFallbackError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const code = String(value.code || '').trim().slice(0, 120);
  const message = String(value.message || '').trim().slice(0, 2000);
  if (!code && !message) return null;
  return {
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {}),
    ...(String(value.stage || '').trim() ? { stage: String(value.stage).trim().slice(0, 80) } : {}),
  };
}

function normalizeCloudFallbackRecordSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
    ? { ...value.metadata }
    : {};
  // A local snapshot is only used to finish a record whose server lease is
  // still active. Never persist transport credentials with that recovery
  // snapshot, even if an older resolver put them in record metadata.
  delete metadata.cookie;
  delete metadata.cookies;
  delete metadata.authorization;
  delete metadata.headers;
  delete metadata.proxy;
  const snapshot = {
    ...(String(value.id || '').trim() ? { id: String(value.id).trim().slice(0, 180) } : {}),
    ...(String(value._id || '').trim() ? { _id: String(value._id).trim().slice(0, 180) } : {}),
    ...(String(value.recordId || value.syncRecordId || '').trim()
      ? { recordId: String(value.recordId || value.syncRecordId).trim().slice(0, 180) }
      : {}),
    ...(String(value.type || '').trim() ? { type: String(value.type).trim().slice(0, 80) } : {}),
    ...(String(value.content || '').trim() ? { content: String(value.content).slice(0, 240000) } : {}),
    ...(String(value.title || '').trim() ? { title: String(value.title).trim().slice(0, 2000) } : {}),
    ...(String(value.description || '').trim() ? { description: String(value.description).trim().slice(0, 12000) } : {}),
    ...(String(value.createdAt || '').trim() ? { createdAt: String(value.createdAt).trim().slice(0, 80) } : {}),
    ...(String(value.uploadedAt || '').trim() ? { uploadedAt: String(value.uploadedAt).trim().slice(0, 80) } : {}),
    ...(String(value.source || '').trim() ? { source: String(value.source).trim().slice(0, 120) } : {}),
    ...(String(value.platform || '').trim() ? { platform: String(value.platform).trim().slice(0, 120) } : {}),
    ...(Number.isFinite(Number(value.retryCount))
      ? { retryCount: Math.max(0, Math.floor(Number(value.retryCount))) }
      : {}),
    metadata,
  };
  try {
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 320000) return null;
  } catch (_) {
    return null;
  }
  return snapshot;
}

function normalizeCloudFallbackJob(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const jobId = String(value.jobId || value.id || '').trim();
  if (!jobId || jobId.length > 180) return null;
  const sourceType = String(value.sourceType || '').trim().toLowerCase();
  if (!['douyin_url', 'uploaded_file'].includes(sourceType)) return null;
  const status = normalizeCloudFallbackStatus(value.status);
  const recordId = String(value.recordId || value.syncRecordId || '').trim().slice(0, 180);
  const sourceUrl = String(value.sourceUrl || value.url || '').trim().slice(0, 4096);
  const fileID = String(value.fileID || value.audioFileID || value.fileId || '').trim().slice(0, 512);
  const transcription = String(value.transcription || '').trim().slice(0, 200000);
  const recordSnapshot = normalizeCloudFallbackRecordSnapshot(value.recordSnapshot);
  return {
    jobId,
    recordId,
    sourceType,
    bindingFingerprint: String(value.bindingFingerprint || '').trim().slice(0, 80),
    clientId: String(value.clientId || '').trim().slice(0, 180),
    sourceFingerprint: String(value.sourceFingerprint || '').trim().slice(0, 80),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(fileID ? { fileID } : {}),
    status,
    stage: String(value.stage || '').trim().slice(0, 100),
    progress: Number.isFinite(Number(value.progress))
      ? Math.max(0, Math.min(100, Number(value.progress)))
      : 0,
    attemptId: String(value.attemptId || '').trim().slice(0, 180),
    ...(String(value.syncAttemptId || '').trim() ? { syncAttemptId: String(value.syncAttemptId).trim().slice(0, 180) } : {}),
    ...(String(value.syncLeaseUntil || '').trim() ? { syncLeaseUntil: String(value.syncLeaseUntil).trim().slice(0, 80) } : {}),
    provider: String(value.provider || '').trim().slice(0, 120),
    providerRequestId: String(value.providerRequestId || '').trim().slice(0, 180),
    ...(transcription ? { transcription } : {}),
    error: normalizeCloudFallbackError(value.error),
    clientRequestId: String(value.clientRequestId || value.idempotencyKey || '').trim().slice(0, 240),
    createdAt: String(value.createdAt || '').trim(),
    updatedAt: String(value.updatedAt || '').trim(),
    completedAt: String(value.completedAt || '').trim(),
    retryCount: Math.max(0, Number(value.retryCount) || 0),
    ...(Number.isFinite(Number(value.recordRetryCount))
      ? { recordRetryCount: Math.max(0, Math.floor(Number(value.recordRetryCount))) }
      : {}),
    retryable: value.retryable === true,
    ...(recordSnapshot ? { recordSnapshot } : {}),
  };
}

function normalizeCloudFallbackJobs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = value.map(normalizeCloudFallbackJob).filter((job) => {
    if (!job) return false;
    // A server job ID is only unique within its owner/client/record/source
    // scope. Keep same-ID jobs from different bindings so polling cannot
    // accidentally reuse one account's terminal result for another.
    const sourceIdentity = job.sourceFingerprint
      || [job.sourceType, job.sourceUrl || job.fileID || ''].join(':');
    const identity = [
      job.jobId,
      job.bindingFingerprint,
      job.clientId,
      job.recordId,
      sourceIdentity,
    ].join('\u001f');
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  const pending = normalized.filter((job) => isCloudFallbackPendingStatus(job.status)
    || (job.status === 'failed' && job.retryable === true));
  const terminal = normalized
    .filter((job) => isCloudFallbackTerminalStatus(job.status)
      || (job.status === 'failed' && job.retryable !== true))
    .slice(-100);
  return [...pending, ...terminal];
}

function isCloudFallbackTerminalStatus(value) {
  return TERMINAL_CLOUD_FALLBACK_STATUSES.has(String(value || '').trim().toLowerCase());
}

function isCloudFallbackPendingStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return CLOUD_FALLBACK_STATUSES.has(status) && !TERMINAL_CLOUD_FALLBACK_STATUSES.has(status);
}

function isCloudFallbackJobTerminal(value) {
  const job = value && typeof value === 'object' ? value : { status: value };
  const status = String(job.status || '').trim().toLowerCase();
  return isCloudFallbackTerminalStatus(status)
    || (status === 'failed' && job.retryable !== true);
}

function isCloudFallbackJobPending(value) {
  const job = value && typeof value === 'object' ? value : { status: value };
  const status = String(job.status || '').trim().toLowerCase();
  return isCloudFallbackPendingStatus(status)
    || (status === 'failed' && job.retryable === true);
}

// A pending acknowledgement records the user's intent to release a finished
// cloud job. It is persisted before the request so an offline or interrupted
// sync retries the release instead of leaking the stored transcription.
function normalizeCloudFallbackAck(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const jobId = String(value.jobId || value.id || '').trim();
  const bindingFingerprint = String(value.bindingFingerprint || '').trim();
  const clientId = String(value.clientId || '').trim();
  if (!jobId || jobId.length > 180 || !bindingFingerprint || !clientId) return null;
  return {
    jobId,
    bindingFingerprint: bindingFingerprint.slice(0, 80),
    clientId: clientId.slice(0, 180),
    recordId: String(value.recordId || '').trim().slice(0, 180),
    queuedAt: String(value.queuedAt || '').trim().slice(0, 80),
    attempts: Math.max(0, Math.floor(Number(value.attempts) || 0)),
  };
}

function normalizeCloudFallbackAcks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(normalizeCloudFallbackAck).filter((ack) => {
    if (!ack) return false;
    const identity = [ack.jobId, ack.bindingFingerprint, ack.clientId].join('\u001f');
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(-100);
}

function normalizeCloudFallbackSourceType(value) {
  const sourceType = String(value || '').trim().toLowerCase();
  return ['douyin_url', 'uploaded_file'].includes(sourceType) ? sourceType : '';
}

function isControlledCloudFallbackFileId(value) {
  const fileID = String(value || '').trim();
  return Boolean(fileID)
    && fileID.length <= 512
    && !/[?&#\s]/.test(fileID)
    && (!/^[a-z][a-z0-9+.-]*:\/\//i.test(fileID) || /^cloud:\/\//i.test(fileID))
    && !/["'<>]/.test(fileID);
}

module.exports = {
  CONNECTION_TICKET_ALPHABET,
  CONNECTION_TICKET_PAYLOAD_LENGTH,
  normalizeConnectionTicket,
  isConnectionTicket,
  normalizeCloudFallbackStatus,
  normalizeCloudFallbackError,
  normalizeCloudFallbackRecordSnapshot,
  normalizeCloudFallbackJob,
  normalizeCloudFallbackJobs,
  normalizeCloudFallbackAck,
  normalizeCloudFallbackAcks,
  isCloudFallbackTerminalStatus,
  isCloudFallbackPendingStatus,
  isCloudFallbackJobTerminal,
  isCloudFallbackJobPending,
  normalizeCloudFallbackSourceType,
  isControlledCloudFallbackFileId,
};
