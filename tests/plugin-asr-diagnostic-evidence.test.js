'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const evidence = require('../obsidian-plugin/wechat-inbox-sync/src/asr-diagnostic-evidence');
const {
  buildFailureTechnicalReport,
} = require('../obsidian-plugin/wechat-inbox-sync/src/failure-technical-report');
const {
  MAX_OUTBOX_BYTES,
  createSyncDiagnosticReporter,
  getBindingFingerprint,
  normalizeDiagnosticEvent,
  normalizeOutbox,
} = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-asr-evidence-'));
const mediaPath = path.join(fixtureDir, 'downloaded-media.bin');
const mediaBytes = Buffer.from('same-attempt-media-fixture', 'utf8');
fs.writeFileSync(mediaPath, mediaBytes);

const sourceUrl = 'https://www.douyin.com/video/1234567890123456789?modal_id=1234567890123456789&token=DO_NOT_STORE';
const inputIdentity = evidence.buildAsrInputIdentity({
  recordId: 'record-asr-evidence-1',
  attemptId: 'attempt-asr-evidence-1',
  sourceUrl,
  durationHintSeconds: 12.3456,
});
assert.strictEqual(inputIdentity.workId, '1234567890123456789');
assert.strictEqual(inputIdentity.sourceUrl.includes('token='), false);
assert.strictEqual(evidence.normalizeDuration(null), null);
assert.strictEqual(evidence.readMeasuredDurationFromLog('durationSeconds=17.600\r\ndurationSeconds=18.25\r\n'), 18.25);
assert.strictEqual(evidence.readMeasuredDurationFromLog('durationSeconds=not-a-duration\n'), null);
assert.strictEqual(inputIdentity.durationHintSeconds, 12.346);
assert.strictEqual(Object.prototype.hasOwnProperty.call(inputIdentity, 'durationSeconds'), false);
inputIdentity.media = evidence.captureMediaIdentity(mediaPath, {
  durationHintSeconds: 12.346,
  now: '2026-10-09T01:02:03.000Z',
});
assert.deepStrictEqual(inputIdentity.media, {
  status: 'captured',
  mediaKind: 'downloaded_media',
  audioStatus: 'unavailable',
  audioReason: 'preprocessed_chunks_not_exposed',
  sha256: crypto.createHash('sha256').update(mediaBytes).digest('hex'),
  byteLength: mediaBytes.length,
  durationStatus: 'unavailable',
  durationReason: 'not_probed',
  durationHintSeconds: 12.346,
  capturedAt: '2026-10-09T01:02:03.000Z',
});
assert.strictEqual(JSON.stringify(inputIdentity).includes(mediaPath), false);
const measuredMediaIdentity = evidence.captureMediaIdentity(mediaPath, {
  actualDurationSeconds: 12.346,
  now: '2026-10-09T01:02:03.000Z',
});
assert.strictEqual(measuredMediaIdentity.durationSeconds, 12.346);
assert.strictEqual(measuredMediaIdentity.durationStatus, 'measured');
assert.strictEqual(measuredMediaIdentity.mediaKind, 'downloaded_media');
assert.strictEqual(measuredMediaIdentity.audioStatus, 'unavailable');
assert.strictEqual(measuredMediaIdentity.audioReason, 'preprocessed_chunks_not_exposed');
inputIdentity.media.durationSeconds = 12.346;
inputIdentity.media.durationStatus = 'measured_log';
delete inputIdentity.media.durationReason;

const firstCheckpoint = evidence.buildRunningCheckpoint({
  attempt: 1,
  stage: 'transcribing',
  pid: 4312,
  processState: 'running',
  processStateSource: 'native_log',
  pidSource: 'native_log',
  progressSource: 'native_log',
  wrapperPid: 9001,
  wrapperProcessState: 'running',
  progress: { stage: 'decode', current: 1, total: 3, percent: 33.33 },
  now: '2026-10-09T01:02:04.000Z',
});
const heartbeat = evidence.buildRunningCheckpoint({
  attempt: 1,
  stage: 'transcribing',
  pid: 4312,
  processState: 'running',
  processStateSource: 'native_log',
  pidSource: 'native_log',
  progressSource: 'native_log',
  wrapperPid: 9001,
  wrapperProcessState: 'running',
  progress: { stage: 'decode', current: 1, total: 3, percent: 33.33 },
  previous: [firstCheckpoint],
  now: '2026-10-09T01:02:05.000Z',
});
const progressed = evidence.buildRunningCheckpoint({
  attempt: 1,
  stage: 'transcribing',
  pid: 4312,
  processState: 'running',
  progress: { stage: 'decode', current: 2, total: 3, percent: 66.67 },
  previous: [firstCheckpoint, heartbeat],
  now: '2026-10-09T01:02:06.000Z',
});
assert.strictEqual(firstCheckpoint.kind, 'real_progress');
assert.strictEqual(heartbeat.kind, 'heartbeat');
assert.strictEqual(heartbeat.progressObserved, false);
assert.strictEqual(progressed.kind, 'real_progress');
assert.strictEqual(progressed.progressObserved, true);
assert.strictEqual(progressed.pid, 4312);
assert.strictEqual(firstCheckpoint.pidSource, 'native_log');
assert.strictEqual(firstCheckpoint.processStateSource, 'native_log');
assert.strictEqual(firstCheckpoint.progressSource, 'native_log');
assert.strictEqual(firstCheckpoint.wrapperPid, 9001);
assert.strictEqual(firstCheckpoint.wrapperProcessState, 'running');
const unknownCheckpoint = evidence.buildRunningCheckpoint({
  attempt: null,
  stage: 'transcribing',
  pid: null,
  processState: 'unknown',
  processStateSource: 'unknown',
  pidSource: 'unknown',
  progressSource: 'unknown',
  wrapperPid: 9002,
  wrapperProcessState: 'running',
  progress: { stage: 'decode', current: null, total: null, percent: null },
  rssKiB: null,
  cpuTimeMs: null,
  now: '2026-10-09T01:02:07.000Z',
});
assert.strictEqual(unknownCheckpoint.attempt, null);
assert.strictEqual(unknownCheckpoint.processStateSource, 'unknown');
assert.strictEqual(unknownCheckpoint.pidSource, 'unknown');
assert.strictEqual(unknownCheckpoint.progressSource, 'unknown');
assert.strictEqual(unknownCheckpoint.wrapperPid, 9002);
assert.strictEqual(unknownCheckpoint.wrapperProcessState, 'running');
assert.strictEqual(Object.prototype.hasOwnProperty.call(unknownCheckpoint, 'rssKiB'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(unknownCheckpoint, 'cpuTimeMs'), false);
assert.deepStrictEqual(unknownCheckpoint.progress, { stage: 'decode' });
let bounded = [];
for (let index = 0; index < evidence.MAX_CHECKPOINTS + 5; index += 1) {
  bounded = evidence.appendRunningCheckpoint(bounded, evidence.buildRunningCheckpoint({
    attempt: 1,
    stage: 'transcribing',
    pid: 4312,
    processState: 'running',
    progress: { stage: 'decode', current: index, total: 200 },
    now: new Date(Date.parse('2026-10-09T01:03:00.000Z') + index * 1000).toISOString(),
  }));
}
assert.strictEqual(bounded.length, evidence.MAX_CHECKPOINTS);
const rolledReference = bounded;
const rolled = evidence.appendRunningCheckpoint(rolledReference, evidence.buildRunningCheckpoint({
  attempt: 1,
  stage: 'transcribing',
  pid: 4312,
  processState: 'running',
  progress: { stage: 'decode', current: evidence.MAX_CHECKPOINTS + 5, total: 200 },
  now: '2026-10-09T01:06:00.000Z',
}));
assert.notStrictEqual(rolled, rolledReference);
assert.strictEqual(rolled.length, evidence.MAX_CHECKPOINTS);
assert.strictEqual(rolled.at(-1).progress.current, evidence.MAX_CHECKPOINTS + 5);

const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-asr-session-'));
fs.writeFileSync(path.join(sessionRoot, 'asr-diagnostic-last.json'), JSON.stringify({
  schemaVersion: 1,
  recordId: 'record-asr-evidence-1',
  syncAttemptId: 'attempt-asr-evidence-1',
  status: 'failed',
  startedAt: '2026-10-09T01:00:00.000Z',
  finishedAt: '2026-10-09T01:04:00.000Z',
  platform: 'darwin',
  inputIdentity,
  runtime: { nativeBuildVersion: 'fixture', scriptSha256: 'a'.repeat(64), wrapperSha256: 'b'.repeat(64), binarySha256: 'c'.repeat(64) },
  system: { platform: 'darwin', architecture: 'x64', release: 'fixture', logicalCpus: 4, totalMemoryBytes: 1000 },
  model: { scope: 'managed_default_component', modelUsed: 'ggml-small.bin', sizeBytes: 200 },
  attempts: [{
    attempt: 1,
    requestedMode: 'default',
    status: 'failed',
    stage: 'transcribing',
    logFreshness: 'fresh',
    startedAt: '2026-10-09T01:00:00.000Z',
    finishedAt: '2026-10-09T01:04:00.000Z',
    runningCheckpoints: [firstCheckpoint, heartbeat, progressed, unknownCheckpoint],
    error: 'native process exited',
    runLog: 'safe-run-log',
  }],
}), 'utf8');
const report = buildFailureTechnicalReport({
  error: Object.assign(new Error('native process exited'), { code: 'TRANSCRIPTION_FAILED' }),
  recordId: 'record-asr-evidence-1',
  attemptId: 'attempt-asr-evidence-1',
  stage: 'transcribe',
  retryCount: 0,
  asrRoot: sessionRoot,
  now: '2026-10-09T01:05:00.000Z',
});
const reportObject = JSON.parse(report.text);
assert.strictEqual(reportObject.asr.inputIdentity.media.sha256, inputIdentity.media.sha256);
assert.strictEqual(reportObject.asr.inputIdentity.media.byteLength, mediaBytes.length);
assert.strictEqual(reportObject.asr.attempts[0].runningCheckpoints.length, 4);
assert.strictEqual(reportObject.asr.attempts[0].runningCheckpoints[1].kind, 'heartbeat');
assert.strictEqual(reportObject.asr.attempts[0].runningCheckpoints[0].pidSource, 'native_log');
assert.strictEqual(reportObject.asr.attempts[0].runningCheckpoints[0].processStateSource, 'native_log');
assert.strictEqual(reportObject.asr.attempts[0].runningCheckpoints[0].wrapperPid, 9001);
assert.strictEqual(reportObject.asr.attempts[0].runningCheckpoints[3].pidSource, 'unknown');
assert.strictEqual(reportObject.asr.attempts[0].runningCheckpoints[3].wrapperPid, 9002);
assert.strictEqual(Object.prototype.hasOwnProperty.call(reportObject.asr.attempts[0].runningCheckpoints[3], 'rssKiB'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(reportObject.asr.attempts[0].runningCheckpoints[3], 'cpuTimeMs'), false);
assert.strictEqual(JSON.stringify(reportObject).includes(mediaPath), false);
assert.strictEqual(JSON.stringify(reportObject).includes('DO_NOT_STORE'), false);
const linkedEvent = normalizeDiagnosticEvent({
  eventId: 'event-asr-linked-1',
  attemptId: 'attempt-asr-evidence-1',
  diagnosticId: 'diagnostic-asr-linked-1',
  syncRecordId: 'record-asr-evidence-1',
  outcome: 'failed',
  errorType: 'TRANSCRIPTION_FAILED',
  stage: 'transcribe',
  sourceUrl,
  technicalReport: report,
});
assert.strictEqual(linkedEvent.sourceUrl, inputIdentity.sourceUrl);
const linkedReportObject = JSON.parse(linkedEvent.technicalReport.text);
assert.notStrictEqual(linkedReportObject.asr.inputIdentity.sourceUrl, inputIdentity.sourceUrl);
assert.strictEqual(linkedReportObject.asr.inputIdentity.sourceUrl.includes('DO_NOT_STORE'), false);
assert.ok(linkedReportObject.asr.inputIdentity.sourceUrl.includes('REDACTED'));
assert.strictEqual(linkedReportObject.asr.inputIdentity.recordId, inputIdentity.recordId);
assert.strictEqual(linkedReportObject.asr.inputIdentity.attemptId, inputIdentity.attemptId);
assert.strictEqual(linkedReportObject.asr.inputIdentity.workId, inputIdentity.workId);
assert.strictEqual(linkedReportObject.asr.inputIdentity.media.sha256, inputIdentity.media.sha256);
assert.strictEqual(linkedReportObject.asr.inputIdentity.media.durationStatus, 'measured_log');
assert.strictEqual(linkedReportObject.asr.inputIdentity.media.mediaKind, 'downloaded_media');
assert.strictEqual(linkedReportObject.asr.inputIdentity.media.audioStatus, 'unavailable');
assert.strictEqual(linkedReportObject.asr.inputIdentity.media.audioReason, 'preprocessed_chunks_not_exposed');
const oversizedSessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-asr-oversized-'));
const structuredCheckpoints = Array.from({ length: evidence.MAX_CHECKPOINTS }, (_, index) => ({
  attempt: 1,
  capturedAt: new Date(Date.parse('2026-10-09T02:00:00.000Z') + index * 1000).toISOString(),
  stage: 'transcribing',
  pid: 5000 + index,
  processState: 'running',
  kind: index % 2 ? 'heartbeat' : 'real_progress',
  progressObserved: index % 2 === 0,
  progress: { stage: 'decode', current: index, total: 100000, percent: index / 1000 },
  rssKiB: 100000 + index,
  cpuTimeMs: index * 10,
}));
fs.writeFileSync(path.join(oversizedSessionRoot, 'asr-diagnostic-last.json'), JSON.stringify({
  schemaVersion: 1,
  recordId: 'record-asr-evidence-1',
  syncAttemptId: 'attempt-asr-evidence-1',
  status: 'failed',
  startedAt: '2026-10-09T01:00:00.000Z',
  finishedAt: '2026-10-09T01:04:00.000Z',
  platform: 'darwin',
  inputIdentity,
  runtime: { nativeBuildVersion: 'fixture', scriptSha256: 'a'.repeat(64), wrapperSha256: 'b'.repeat(64), binarySha256: 'c'.repeat(64) },
  system: { platform: 'darwin', architecture: 'x64', release: 'fixture', logicalCpus: 4, totalMemoryBytes: 1000 },
  model: { scope: 'managed_default_component', modelUsed: 'ggml-small.bin', sizeBytes: 200 },
  attempts: Array.from({ length: 8 }, (_, attempt) => ({
    attempt: attempt + 1,
    requestedMode: attempt ? 'cpu_compatibility' : 'default',
    status: 'failed',
    stage: 'transcribing',
    logFreshness: 'fresh',
    startedAt: '2026-10-09T01:00:00.000Z',
    finishedAt: '2026-10-09T01:04:00.000Z',
    exitCode: -1,
    nativeExitCode: -1073740791,
    nativeExitAssociation: 'matched',
    runningCheckpoints: structuredCheckpoints.map(checkpoint => ({ ...checkpoint, attempt: attempt + 1 })),
    runLog: 'bounded-run-log',
  })),
}), 'utf8');
const oversizedReport = buildFailureTechnicalReport({
  error: Object.assign(new Error('native process exited'), { code: 'TRANSCRIPTION_FAILED' }),
  recordId: 'record-asr-evidence-1',
  attemptId: 'attempt-asr-evidence-1',
  stage: 'transcribe',
  retryCount: 0,
  asrRoot: oversizedSessionRoot,
  now: '2026-10-09T01:05:00.000Z',
});
const oversizedObject = JSON.parse(oversizedReport.text);
assert.ok(oversizedReport.originalBytes > 128 * 1024);
assert.strictEqual(oversizedObject.omittedTechnicalEvidence, true);
assert.strictEqual(oversizedObject.asr.inputIdentity.media.sha256, inputIdentity.media.sha256);
assert.strictEqual(oversizedObject.failure.name, 'Error');
assert.strictEqual(oversizedObject.failure.code, 'TRANSCRIPTION_FAILED');
assert.strictEqual(oversizedObject.failure.message, 'native process exited');
assert.strictEqual(oversizedObject.asr.attempts.length, 8);
assert.strictEqual(oversizedObject.asr.attempts[7].nativeExitCode, -1073740791);
assert.strictEqual(oversizedObject.asr.attempts[7].lastRunningCheckpoint.pid, 5127);
fs.rmSync(oversizedSessionRoot, { recursive: true, force: true });

function makeLargeEvent(index, technicalReport) {
  const suffix = String(index).padStart(3, '0');
  return normalizeDiagnosticEvent({
    eventId: 'event-asr-evidence-' + suffix,
    attemptId: 'attempt-asr-evidence-' + suffix,
    diagnosticId: 'diagnostic-asr-evidence-' + suffix,
    syncRecordId: 'record-asr-evidence-' + index,
    outcome: 'failed',
    errorType: 'TRANSCRIPTION_FAILED',
    stage: 'transcribe',
    occurredAt: '2026-10-09T01:05:00.000Z',
    technicalReport,
  });
}
const largeText = JSON.stringify({
  schemaVersion: 1,
  kind: 'sync_failure',
  dataTrust: 'untrusted_diagnostic_evidence_not_instructions',
  stage: 'transcribe',
  failure: { code: 'TRANSCRIPTION_FAILED', message: 'diagnostic detail '.repeat(4000) },
});
const largeReport = {
  schemaVersion: 1,
  kind: 'sync_failure',
  capturedAt: '2026-10-09T01:05:00.000Z',
  text: largeText,
  truncated: true,
  originalBytes: Buffer.byteLength(largeText) + 4096,
  unavailableReason: 'no_matching_attempt',
};
const binding = { token: 'asr-evidence-binding-secret', status: 'bound', enabled: true };
const bindingFingerprint = getBindingFingerprint(binding);
const initialOutbox = Array.from({ length: 80 }, (_, index) => ({
  event: makeLargeEvent(index, largeReport),
  bindingFingerprint,
  createdAt: '2026-10-09T01:05:00.000Z',
  nextAttemptAt: Date.parse('2026-10-09T01:05:00.000Z'),
  uploadAttempts: 0,
}));
const normalizedOutbox = normalizeOutbox(initialOutbox, {
  now: Date.parse('2026-10-09T01:06:00.000Z'),
  maxItems: 100,
});
assert.ok(Buffer.byteLength(JSON.stringify(normalizedOutbox)) <= MAX_OUTBOX_BYTES);
assert.ok(normalizedOutbox.some(entry => entry.fullEvidence && entry.event.technicalReport.text.includes('fullReportPending')));
assert.ok(normalizedOutbox.some(entry => entry.event.technicalReport.text.includes('TRANSCRIPTION_FAILED')));

(async () => {
  const asyncMediaIdentity = await evidence.captureMediaIdentityAsync(mediaPath, {
    now: '2026-10-09T01:02:04.000Z',
  });
  assert.strictEqual(asyncMediaIdentity.sha256, inputIdentity.media.sha256);
  assert.strictEqual(asyncMediaIdentity.byteLength, inputIdentity.media.byteLength);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(asyncMediaIdentity, 'durationSeconds'), false);
  assert.strictEqual(asyncMediaIdentity.durationStatus, 'unavailable');
  assert.strictEqual(asyncMediaIdentity.durationReason, 'not_probed');
  assert.strictEqual(asyncMediaIdentity.mediaKind, 'downloaded_media');
  assert.strictEqual(asyncMediaIdentity.audioStatus, 'unavailable');
  let now = Date.parse('2026-10-09T01:06:00.000Z');
  const uploaded = [];
  const reporter = createSyncDiagnosticReporter({
    initialOutbox: [normalizedOutbox[0]],
    now: () => now,
    getBindings: () => [binding],
    saveOutbox: async () => {},
    postEvents: async (events) => {
      uploaded.push(...events);
      return { acceptedEventIds: events.map(event => event.eventId) };
    },
  });
  const result = await reporter.flush({ bindings: [binding] });
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(uploaded.length, 1);
  assert.ok(uploaded[0].technicalReport.text.includes('diagnostic detail'));
  assert.strictEqual(uploaded[0].technicalReport.capturedAt, largeReport.capturedAt);
  assert.strictEqual(uploaded[0].technicalReport.truncated, true);
  assert.strictEqual(uploaded[0].technicalReport.originalBytes, largeReport.originalBytes);
  assert.strictEqual(uploaded[0].technicalReport.unavailableReason, largeReport.unavailableReason);
  assert.strictEqual(JSON.parse(uploaded[0].technicalReport.text).evidenceCompleteness, undefined);
  assert.strictEqual(reporter.getPendingCount(), 0);
  reporter.dispose();

  let offlineNow = Date.parse('2026-10-09T01:06:00.000Z');
  let offlinePersisted = [];
  const offlineReporter = createSyncDiagnosticReporter({
    initialOutbox: [normalizedOutbox[1]],
    now: () => offlineNow,
    getBindings: () => [binding],
    saveOutbox: async (value) => { offlinePersisted = JSON.parse(JSON.stringify(value)); },
    postEvents: async () => { throw new Error('offline'); },
  });
  const offlineResult = await offlineReporter.flush({ bindings: [binding] });
  assert.strictEqual(offlineResult.failed, 1);
  assert.strictEqual(offlineReporter.getOutbox()[0].fullEvidencePending, true);
  assert.ok(offlinePersisted[0].fullEvidence, 'offline retry snapshot keeps complete compressed report');
  assert.strictEqual(offlinePersisted[0].fullEvidence.capturedAt, largeReport.capturedAt);
  assert.strictEqual(offlinePersisted[0].fullEvidence.truncated, true);
  assert.strictEqual(offlinePersisted[0].fullEvidence.originalBytes, largeReport.originalBytes);
  assert.strictEqual(offlinePersisted[0].fullEvidence.unavailableReason, largeReport.unavailableReason);
  offlineReporter.dispose();

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.rmSync(sessionRoot, { recursive: true, force: true });
  console.log('PASS: ASR input identity, bounded running checkpoints, and durable full-report retry');
})().catch((error) => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  fs.rmSync(sessionRoot, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});