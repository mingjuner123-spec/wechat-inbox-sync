'use strict';

const crypto = require('crypto');
const recordRef = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
const list = value => Array.isArray(value) ? value : [];
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const resolved = status => ['success', 'succeeded', 'synced', 'committed', 'deleted', 'already-synced-local', 'synced-via-content-identity'].includes(status);
const owner = row => row.bindingFingerprint || (row.bindingToken ? crypto.createHash('sha256').update(row.bindingToken).digest('hex').slice(0, 32) : '');
const key = row => `${owner(row)}:${row.recordId}`;

// This selector never treats a successful poll with an empty queue as proof that
// an older failed record recovered. Only per-record completion can remove it.
function selectFailureRecords(recent = [], current = null, receipts = []) {
  const state = current || {};
  const snapshots = new Map();
  for (const snapshot of list(state.syncSnapshots)) {
    for (const row of list(snapshot && snapshot.records)) {
      if (row && row.recordId) {
        const entry = { ...row, bindingFingerprint: owner(row) || owner(snapshot) };
        snapshots.set(key(entry), entry);
      }
    }
  }
  if (state.recordId && resolved(state.status)) snapshots.set(key(state), state);
  for (const receipt of list(receipts)) snapshots.set(key(receipt), { ...receipt, status: 'committed', updatedAt: receipt.completedAt });
  const candidates = [...list(recent), ...list(state.historicalFailures), ...list(state.failureDetails)];
  if (['failed', 'action_required'].includes(state.status) && state.recordId) candidates.push(state);
  const records = new Map();
  for (const item of candidates) {
    if (!item || !item.recordId || resolved(item.status)) continue;
    const id = String(item.recordId);
    const owned = candidates.filter(row => row && row.recordId === id && owner(row));
    const owners = [...new Set(owned.map(owner))];
    const fingerprint = owner(item) || (owners.length === 1 ? owners[0] : '');
    if (!fingerprint && owners.length > 1) continue;
    const identity = `${fingerprint}:${id}`;
    const snapshot = snapshots.get(identity) || (!fingerprint ? snapshots.get(':' + id) : null);
    if (snapshot && resolved(snapshot.status)
      && (!time(item.failedAt || item.time) || !time(snapshot.updatedAt || snapshot.time)
        || time(snapshot.updatedAt || snapshot.time) >= time(item.failedAt || item.time))) continue;
    const previous = records.get(identity) || {};
    if (time(previous.failedAt) > time(item.failedAt || item.time)) continue;
    records.set(identity, {
      ...previous,
      recordId: id,
      bindingFingerprint: fingerprint,
      failedAt: item.failedAt || item.time || previous.failedAt || '',
      stage: item.stage || previous.stage || '',
      code: item.code || item.errorCode || item.setupCode || previous.code || '',
      message: item.error || item.message || previous.message || '',
      sourceUrl: item.sourceUrl || item.diagnostic && item.diagnostic.sourceUrl || previous.sourceUrl || '',
      attemptId: item.attemptId || item.diagnosticAttemptId || previous.attemptId || '',
      diagnostic: item.diagnostic || previous.diagnostic || null,
      setupRequired: item.setupRequired === true || previous.setupRequired === true,
    });
  }
  return [...records.values()].sort((a, b) => time(b.failedAt) - time(a.failedAt));
}

function relatedFailureRows(rows, failures) {
  const latest = new Map();
  for (const row of list(rows)) {
    if (!row) continue;
    const matches = failures.filter(item => ((row.recordId && row.recordId === item.recordId)
      || (row.recordRef && row.recordRef === recordRef(item.recordId))) && (!owner(row) || owner(row) === owner(item)));
    const failure = matches.length === 1 ? matches[0] : null;
    if (!failure || (failure.attemptId && row.syncAttemptId && row.syncAttemptId !== failure.attemptId)) continue;
    const finished = time(row.finishedAt || row.updatedAt || row.startedAt);
    if (time(failure.failedAt) && finished > time(failure.failedAt) + 5000) continue;
    const identity = key(failure);
    const previous = latest.get(identity);
    if (!previous || finished >= time(previous.finishedAt || previous.updatedAt || previous.startedAt)) latest.set(identity, row);
  }
  // A fallback's earlier failure is not a final failure when the last attempt
  // for this same record succeeded.
  return [...latest.values()].filter(row => !resolved(row.outcome || row.finalOutcome || row.status));
}

function matchingFailedAsrSession(session, failures) {
  if (!session || !session.recordId) return null;
  const syncAttemptId = session.syncAttemptId || session.inputIdentity && session.inputIdentity.attemptId;
  const matches = failures.filter(row => row.recordId === session.recordId
    && (!owner(session) || owner(session) === owner(row))
    && (!row.attemptId || !syncAttemptId || row.attemptId === syncAttemptId));
  const failure = matches.length === 1 ? matches[0] : null;
  if (!failure) return null;
  const attempts = list(session.attempts);
  const last = attempts.at(-1);
  if (!last || resolved(last.status) || !['failed', 'cancelled'].includes(session.status || last.status)) return null;
  if (time(failure.failedAt) && time(last.finishedAt || session.finishedAt) > time(failure.failedAt) + 5000) return null;
  return {
    recordRef: recordRef(session.recordId), startedAt: session.startedAt,
    attempts: attempts.filter(row => row.status === 'failed').map(row => ({
      attempt: row.attempt, stage: row.stage, status: row.status, error: row.error,
      exitCode: row.nativeExitCode ?? row.exitCode, signal: row.signal,
      startedAt: row.startedAt, finishedAt: row.finishedAt,
    })),
  };
}

function boundedDiagnostic(text, maxBytes = 32768) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const marker = '\n[诊断内容已截断；仅显示未恢复失败记录的部分细节]';
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'));
  let result = '', bytes = 0;
  for (const char of text) { const n = Buffer.byteLength(char, 'utf8'); if (bytes + n > budget) break; result += char; bytes += n; }
  return result + marker;
}

module.exports = { selectFailureRecords, relatedFailureRows, matchingFailedAsrSession, boundedDiagnostic, recordRef };
