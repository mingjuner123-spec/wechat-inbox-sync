'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.join(__dirname, '../obsidian-plugin/wechat-inbox-sync');
for (const extension of ['.ps1', '.sh', '.py']) require.extensions[extension] = (m, file) => { m.exports = fs.readFileSync(file, 'utf8'); };
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, Setting: class {}, requestUrl: async () => { throw Error('network forbidden'); } };
  return load.call(this, request, parent, isMain);
};
const Plugin = require(path.join(root, 'src/main.js'));
Module._load = load;
const { getSyncLifecycleBindingFingerprint } = require(path.join(root, 'src/sync-lifecycle-utils'));
const { sameCloudFallbackDelivery, selectCloudFallbackDelivery, cloudFallbackRecordSourceFingerprint } = require(path.join(root, 'src/cloud-fallback-job-utils'));
const binding = { token: 'FIXTURE-ONLY', label: 'fixture', enabled: true, status: 'bound' };
const fingerprint = getSyncLifecycleBindingFingerprint(binding.token);
const record = { id: 'record-test', type: 'webpage', content: 'https://www.douyin.com/video/123456789', retryCount: 0, metadata: { title: 'fixture', url: 'https://www.douyin.com/video/123456789' } };
const job = (extra = {}) => ({ jobId: 'job-first', recordId: record.id, sourceType: 'douyin_url', sourceUrl: record.content, sourceFingerprint: 'same-media', bindingFingerprint: fingerprint, clientId: 'client-test', recordRetryCount: 0, status: 'succeeded', transcription: 'synthetic transcript', updatedAt: '2026-10-28T01:00:00Z', ...extra });
function plugin(jobs = []) {
  const p = Object.create(Plugin.prototype);
  p.settings = { clientId: 'client-test', bindings: [binding], token: binding.token, cloudFallbackEnabled: true, cloudFallbackJobs: jobs, cloudFallbackSubmissions: [], cloudFallbackAcks: [], pendingSyncLifecycleAttempts: [], completedSyncReceipts: [], locallyQuarantinedRecordIds: [], autoSyncStoppedRecords: [] };
  p.manifest = { version: '1.3.213' };
  p.saveData = async () => {}; p.saveSettings = async value => { p.settings = value; };
  p.getActiveBindings = p.getAutoSyncBindings = () => [binding];
  p.showSyncProgress = p.setTranscriptionStopAvailable = p.ensureSerializedSaveData = () => {};
  p.autoSyncController = null; p.autoSyncDisposed = false; p.backgroundSyncActive = false;
  p.getRecentSyncFailures = () => []; p.updateRecentSyncFailures = async () => {};
  p.getSyncDiagnosticReporter = () => ({ clearRecord: async () => {} });
  p.queueSyncDiagnosticFailure = () => {}; p.getConfiguredLocalAsrInstallRoot = () => '';
  p.findQualityPartialNote = async () => null; p.findExistingRecordNotePath = async () => '';
  p.getRecentXiaohongshuCommentResults = p.getRecentXiaohongshuBrowserResults = () => [];
  p.requestJson = async () => { throw Error('unexpected request'); };
  return p;
}
let count = 0;
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }
(async () => {
  await test('queued first candidate stops additional submissions', async () => {
    const p = plugin(); let calls = 0;
    p.runConfiguredTranscription = async () => { calls++; throw Object.assign(Error('queued'), { code: 'CLOUD_FALLBACK_QUEUED', cloudFallbackJob: job({ status: 'queued' }) }); };
    await assert.rejects(p.buildTranscriptRecordFromMedia(record, { url: record.content, platform: '抖音', preparedMedia: true, binding, mediaUrls: ['https://fixture.test/a.mp4', 'https://fixture.test/b.mp4', 'https://fixture.test/c.mp4'] }), { code: 'CLOUD_FALLBACK_QUEUED' });
    assert.equal(calls, 1);
  });
  await test('ordinary candidate failure still tries another candidate', async () => {
    const p = plugin(); let calls = 0;
    p.runConfiguredTranscription = async () => { if (++calls === 1) throw Error('download failed'); return { transcription: 'valid fixture', source: 'local' }; };
    const result = await p.buildTranscriptRecordFromMedia(record, { url: record.content, platform: '抖音', preparedMedia: true, binding, mediaUrls: ['https://fixture.test/a.mp4', 'https://fixture.test/b.mp4'] });
    assert.equal(calls, 2); assert.equal(result.metadata.transcription, 'valid fixture');
  });
  await test('accepted job stores snapshot before returning', async () => {
    const p = plugin(); p.currentProcessingContext = { recordId: record.id, recordSnapshot: record, attemptId: 'attempt-a', leaseUntil: '2099-01-01T00:00:00Z' };
    let body;
    p.requestJson = async (_path, _method, value) => { body = value; return { data: job({ status: 'queued' }) }; };
    const result = await p.submitCloudFallbackJob({ recordId: record.id, sourceType: 'douyin_url', sourceUrl: record.content, binding });
    assert.equal(body.recordRetryCount, 0); assert.equal(body.recordSourceFingerprint, cloudFallbackRecordSourceFingerprint(record)); assert.equal(result.recordSnapshot.id, record.id); assert.equal(result.syncAttemptId, 'attempt-a');
    assert.equal(p.settings.cloudFallbackJobs[0].recordSnapshot.id, record.id);
  });
  await test('accepted job persistence error remains queued and never triggers new candidate', async () => {
    const p = plugin(); let requests = 0;
    p.requestJson = async () => { requests++; return { data: job({ status: 'queued' }) }; };
    p.saveData = async () => { throw Error('disk full'); };
    await assert.rejects(p.submitCloudFallbackJob({ recordId: record.id, sourceType: 'douyin_url', sourceUrl: record.content, binding }), error => error.code === 'CLOUD_FALLBACK_QUEUED' && error.persistenceWarning);
    assert.equal(requests, 1);
  });
  await test('clearing submission failure after accepted job is still queued', async () => {
    const p = plugin(); let saved = 0;
    p.requestJson = async () => ({ data: job({ status: 'queued' }) });
    p.saveData = async () => { saved++; };
    p.clearCloudFallbackSubmission = async () => { throw Error('second settings write failed'); };
    await assert.rejects(p.submitCloudFallbackJob({ recordId: record.id, sourceType: 'douyin_url', sourceUrl: record.content, binding }), error => error.code === 'CLOUD_FALLBACK_QUEUED' && error.persistenceWarning);
    assert.equal(saved, 1); assert.equal(p.settings.cloudFallbackJobs.length, 1);
  });
  await test('earlier same-media success beats later failure, sharing recovery context', async () => {
    const p = plugin([job(), job({ jobId: 'job-last', status: 'failed', transcription: '', updatedAt: '2026-10-28T02:00:00Z', recordSnapshot: { ...record, metadata: { ...record.metadata, cloudFallbackJobId: 'job-last' } } })]);
    const result = await p.pollCloudFallbackJobs(binding, []);
    assert.equal(result.records.length, 1); assert.equal(result.records[0].metadata.cloudFallbackJobId, 'job-first'); assert.equal(result.records[0].metadata.transcription, 'synthetic transcript');
  });
  await test('different media, generation and account never borrow success', async () => {
    const a = job(), b = job({ jobId: 'last', status: 'failed', transcription: '', sourceFingerprint: 'other-media', updatedAt: '2026-10-29T00:00:00Z' });
    assert.equal(selectCloudFallbackDelivery([a, b], record).jobId, 'last');
    assert.equal(sameCloudFallbackDelivery(a, { ...a, recordRetryCount: 1 }), false);
    assert.equal(sameCloudFallbackDelivery(a, { ...a, clientId: 'other' }), false);
    assert.equal(sameCloudFallbackDelivery(a, { ...a, bindingFingerprint: 'other' }), false);
    const p = plugin([a]); assert.equal((await p.pollCloudFallbackJobs(binding, [{ ...record, retryCount: 1 }])).records[0].metadata.transcription, undefined);
  });
  await test('lost local cache discovers scoped server result and reconstructs record', async () => {
    const p = plugin(); p.requestJson = async (url, method) => {
      assert.equal(url, '/transcriptions/fallback/jobs/recover'); assert.equal(method, 'POST');
      return { data: { jobs: [job({ deliveryKey: 'd'.repeat(64), recordSourceFingerprint: cloudFallbackRecordSourceFingerprint(record), recordSnapshot: record })], nextCursor: '' } };
    };
    const result = await p.pollCloudFallbackJobs(binding, []);
    assert.equal(result.records.length, 1); assert.equal(result.records[0].metadata.transcription, 'synthetic transcript'); assert.equal(p.settings.cloudFallbackJobs.length, 1);
  });
  await test('metadata discovery fetches result body through single-job GET', async () => {
    const p = plugin(), requests = [];
    const discovered = job({ deliveryKey: 'd'.repeat(64), recordSourceFingerprint: cloudFallbackRecordSourceFingerprint(record), recordSnapshot: record, transcription: '' });
    p.requestJson = async (url, method) => { requests.push(method); return url.endsWith('/recover') ? { data: { jobs: [discovered] } } : { data: { ...discovered, transcription: 'single job result' } }; };
    const result = await p.pollCloudFallbackJobs(binding, []);
    assert.deepEqual(requests, ['POST', 'GET']); assert.equal(result.records[0].metadata.transcription, 'single job result');
  });
  await test('result GET outage waits without local retranscription', async () => {
    const p = plugin(); const discovered = job({ deliveryKey: 'd'.repeat(64), recordSourceFingerprint: cloudFallbackRecordSourceFingerprint(record), recordSnapshot: record, transcription: '' });
    p.requestJson = async url => { if (url.endsWith('/recover')) return { data: { jobs: [discovered] } }; throw Error('offline'); };
    const result = await p.pollCloudFallbackJobs(binding, []);
    assert.equal(result.records[0].metadata.cloudFallbackStatus, 'queued'); assert.equal(result.records[0].metadata.transcriptionStatus, 'pending');
  });
  await test('server invalidation removes only same-account cached jobs', async () => {
    const a = job({ deliveryKey: 'd'.repeat(64), recordSnapshot: record }); const other = { ...a, bindingFingerprint: 'another-account' };
    const p = plugin([a, other]); p.requestJson = async () => ({ data: { jobs: [], invalidatedJobIds: [a.jobId] } });
    assert.equal((await p.pollCloudFallbackJobs(binding, [])).records.length, 0);
    assert.equal(p.settings.cloudFallbackJobs.length, 1); assert.equal(p.settings.cloudFallbackJobs[0].bindingFingerprint, 'another-account');
  });
  await test('discovery preserves matching local lease context', async () => {
    const a = job({ deliveryKey: 'd'.repeat(64), recordSourceFingerprint: cloudFallbackRecordSourceFingerprint(record), recordSnapshot: record, syncAttemptId: 'active-attempt', syncLeaseUntil: '2099-01-01T00:00:00Z' });
    const p = plugin([a]); p.requestJson = async () => ({ data: { jobs: [{ ...a, syncAttemptId: undefined, syncLeaseUntil: undefined }] } });
    const result = await p.pollCloudFallbackJobs(binding, []);
    assert.equal(result.records[0].metadata.cloudFallbackSyncAttemptId, 'active-attempt');
  });
  await test('old server discovery unavailable preserves local recovery', async () => {
    const p = plugin([job({ recordSnapshot: record })]);
    p.requestJson = async () => { throw Object.assign(Error('not supported'), { status: 405 }); };
    assert.equal((await p.pollCloudFallbackJobs(binding, [])).records.length, 1);
  });
  await test('discovery pagination advances without unbounded looping', async () => {
    const p = plugin(); const cursors = [];
    p.requestJson = async (_url, _method, body) => { cursors.push(body.cursor); return { data: { jobs: [], nextCursor: cursors.length === 1 ? 'cfb_next' : '' } }; };
    await p.discoverCloudFallbackJobs(binding); assert.deepEqual(cursors, ['', 'cfb_next']);
  });
  function flow(status, { busy = false, local = false, reportFails = false, ackFails = false } = {}) {
    const p = plugin([job({ status, transcription: status === 'succeeded' ? 'synthetic transcript' : '', recordSnapshot: record, syncAttemptId: 'expired-attempt', syncLeaseUntil: '2000-01-01T00:00:00Z' })]);
    const events = [];
    p.findExistingRecordNotePath = async () => local ? 'fixture.md' : '';
    p.requestJson = async url => { if (url.startsWith('/records?')) return { data: [], meta: { syncLifecycleStatus: true } }; throw Error('unsupported'); };
    p.claimSyncRecordProcessing = async () => { events.push('claim'); return busy ? { enabled: true, conflict: true } : { enabled: true, attemptId: 'fresh-attempt', leaseUntil: '2099-01-01T00:00:00Z' }; };
    p.reportSyncRecordFailure = async (_id, attempt, error) => { assert.equal(attempt, 'fresh-attempt'); events.push(`failed:${error.code}`); if (reportFails) throw Error('offline'); };
    p.writeRecord = async () => { events.push('write'); return { recordId: record.id, title: 'fixture', committed: true }; };
    p.reportSyncRecordCompletionBestEffort = async () => { events.push('complete'); return reportFails ? { code: 'COMPLETION_REPORT_FAILED' } : null; };
    p.acknowledgeCloudFallbackJobForRecord = async () => { events.push('ack'); if (ackFails) throw Error('offline'); };
    return { p, events };
  }
  await test('new delivery always validates with server even during active local lease', async () => {
    const p = plugin(); let body;
    p.reportSyncLifecycleStatus = async (_id, input) => { body = input; return { data: { attemptId: 'server-validated', leaseUntil: '2099-01-01T00:00:00Z' } }; };
    const r = { ...record, metadata: { cloudFallbackJobId: 'cfb_fixture', cloudFallbackDeliveryKey: 'd'.repeat(64), cloudFallbackRecordRetryCount: 0, cloudFallbackSyncAttemptId: 'previous-attempt', cloudFallbackSyncLeaseUntil: '2099-01-01T00:00:00Z' } };
    const result = await p.claimSyncRecordProcessing(record.id, binding, true, r);
    assert.equal(body.fallbackJobId, 'cfb_fixture'); assert.equal(body.resumeAttemptId, 'previous-attempt'); assert.equal(result.attemptId, 'server-validated');
    assert.equal((await p.claimSyncRecordProcessing(record.id, binding, false, r)).conflict, true, 'new protocol cannot bypass fencing if lifecycle unavailable');
  });
  await test('generation conflict after discovery cannot write or mark a new generation failed', async () => {
    const { p, events } = flow('succeeded');
    p.settings.cloudFallbackJobs[0].deliveryKey = 'd'.repeat(64);
    p.claimSyncRecordProcessing = Plugin.prototype.claimSyncRecordProcessing;
    p.reportSyncLifecycleStatus = async () => { events.push('guarded-claim'); throw Object.assign(Error('record busy'), { status: 409, code: 'RECORD_BUSY' }); };
    const result = await p.syncBinding(binding, false);
    assert.equal(result.written.length, 0); assert.equal(result.failed.length, 0); assert.deepEqual(events, ['guarded-claim']);
  });
  for (const status of ['failed', 'needs_action', 'cancelled', 'no_speech']) await test(`terminal ${status} claims valid lease and reports without writing`, async () => {
    const { p, events } = flow(status); const result = await p.syncBinding(binding, false);
    assert.deepEqual(events, ['claim', `failed:CLOUD_FALLBACK_${status.toUpperCase()}`]); assert.equal(result.failed.length, 1); assert.equal(p.settings.pendingSyncLifecycleAttempts.length, 0);
  });
  await test('busy lease preserves terminal result without write or false receipt', async () => {
    const { p, events } = flow('failed', { busy: true }); const result = await p.syncBinding(binding, false);
    assert.deepEqual(events, ['claim']); assert.equal(result.skipped[0].reason, 'record-busy'); assert.equal(p.settings.cloudFallbackJobs.length, 1);
  });
  await test('terminal failure report outage retains pending failure marker', async () => {
    const { p, events } = flow('failed', { reportFails: true }); const result = await p.syncBinding(binding, false);
    assert.equal(result.failed[0].lifecycleReportError.code, 'STATUS_REPORT_FAILED'); assert.equal(p.settings.pendingSyncLifecycleAttempts[0].stage, 'failed'); assert(!events.includes('ack'));
  });
  await test('existing local note takes precedence over cloud failure', async () => {
    const { p, events } = flow('failed', { local: true }); const result = await p.syncBinding(binding, false);
    assert.equal(result.failed.length, 0); assert.deepEqual(events, ['claim', 'complete', 'ack']);
  });
  await test('success writes before ACK and completion, expired lease reclaimed', async () => {
    const { p, events } = flow('succeeded'); const result = await p.syncBinding(binding, false);
    assert.equal(result.written.length, 1); assert.deepEqual(events, ['claim', 'write', 'ack', 'complete']);
  });
  await test('completion outage keeps commit receipt so next run never rewrites', async () => {
    const { p, events } = flow('succeeded', { reportFails: true });
    await p.syncBinding(binding, false); assert.equal(p.settings.completedSyncReceipts.length, 1);
    p.replayPendingSyncLifecycleAttempts = async () => {};
    await p.syncBinding(binding, false);
    assert.equal(events.filter(x => x === 'write').length, 1); assert.equal(events.filter(x => x === 'complete').length, 2);
  });
  await test('ACK outage cannot turn a committed note into failure', async () => {
    const { p, events } = flow('succeeded', { ackFails: true }); const result = await p.syncBinding(binding, false);
    assert.equal(result.written.length, 1); assert.equal(result.failed.length, 0); assert(events.includes('complete'));
  });
  console.log(`plugin fallback delivery: ${count} behavioral cases passed`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
