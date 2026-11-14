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
  await test('submission idempotency persistence failure prevents an untracked create request', async () => {
    const p = plugin(); let requests = 0;
    p.requestJson = async () => { requests++; return { data: job({ status: 'queued' }) }; };
    p.saveData = async () => { throw Error('disk full'); };
    await assert.rejects(p.submitCloudFallbackJob({ recordId: record.id, sourceType: 'douyin_url', sourceUrl: record.content, binding }), /disk full/);
    assert.equal(requests, 0, 'do not create a remote task until its idempotency key is durable locally');
  });
  await test('clearing submission failure after accepted job is still queued', async () => {
    const p = plugin(); let saved = 0;
    p.requestJson = async () => ({ data: job({ status: 'queued' }) });
    p.saveData = async () => { saved++; };
    p.clearCloudFallbackSubmission = async () => { throw Error('second settings write failed'); };
    await assert.rejects(p.submitCloudFallbackJob({ recordId: record.id, sourceType: 'douyin_url', sourceUrl: record.content, binding }), error => error.code === 'CLOUD_FALLBACK_QUEUED' && error.persistenceWarning);
    assert.equal(saved, 2); assert.equal(p.settings.cloudFallbackJobs.length, 1);
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
  await test('old record receipt cannot acknowledge an unwritten fallback result', async () => {
    const { p, events } = flow('succeeded');
    await p.rememberCompletedSyncReceipt(binding, { recordId: record.id, noteTitle: 'old attachment only' });
    await p.syncBinding(binding, false);
    assert.deepEqual(events, ['claim', 'write', 'ack', 'complete']);
    assert.match(p.settings.completedSyncReceipts[0].fallbackDeliveryId, /^[a-f0-9]{64}$/);
    events.length = 0;
    p.settings.cloudFallbackJobs[0].jobId = 'different-delivery';
    await p.syncBinding(binding, false);
    assert(events.includes('write'), 'a different job must not borrow the old receipt');
  });
  await test('only the same fallback delivery marker proves local recovery', async () => {
    const { markFallbackDelivery, hasFallbackDeliveryMarker } = require(path.join(root, 'src/fallback-delivery-marker'));
    const p = plugin();
    const r = { ...record, type: 'file', metadata: { cloudFallbackStatus: 'succeeded', cloudFallbackJobId: 'job-new', cloudFallbackDeliveryKey: 'd'.repeat(64) } };
    const old = `---\nid: ${record.id}\n---\n![[audio.mp3]]`;
    let markdown = old;
    p.settings.inboxDir = '';
    p.app = { vault: { getMarkdownFiles: () => [{ path: 'fixture.md' }], cachedRead: async () => markdown, adapter: { exists: async () => true } } };
    assert.equal(await Plugin.prototype.findExistingRecordNotePath.call(p, r), '');
    markdown = markFallbackDelivery(`${old}\n\nComplete synthetic transcript.`, r);
    assert.equal(await Plugin.prototype.findExistingRecordNotePath.call(p, r), 'fixture.md');
    assert.equal(hasFallbackDeliveryMarker(markdown, { ...r, metadata: { ...r.metadata, cloudFallbackDeliveryKey: 'e'.repeat(64) } }), false);
    assert.equal(hasFallbackDeliveryMarker(markdown, { ...r, id: 'other-record' }), false);
    assert.equal(markFallbackDelivery(markdown, r), markdown);
  });
  for (const gateCode of ['DOUYIN_LOGIN_REQUIRED', 'LOCAL_COMPONENT_SETUP_REQUIRED']) await test(`media failure retains ${gateCode} for diagnostics`, async () => {
    const p = plugin();
    p.runConfiguredTranscription = async () => { throw Object.assign(Error('fixture local failure'), { code: 'MEDIA_DOWNLOAD_INTERRUPTED' }); };
    p.evaluateCloudFallbackUserGate = async () => ({ allowed: false, code: gateCode, message: 'fixture gate guidance' });
    const result = await p.buildTranscriptRecordFromMedia(record, { url: record.content, platform: '抖音', preparedMedia: true, binding, mediaUrls: ['https://fixture.test/a.mp4'] });
    assert.equal(result.metadata.mediaResolutionDiagnostic.cloudFallback.code, gateCode);
    assert.equal(result.metadata.mediaResolutionDiagnostic.cloudFallback.stage, 'eligibility');
  });
  await test('uncertain fallback submit stays pending through outer media catch', async () => {
    const p = plugin();
    p.runConfiguredTranscription = async () => { throw Error('fixture local failure'); };
    p.evaluateCloudFallbackUserGate = async () => ({ allowed: true });
    p.submitCloudFallbackJob = async () => { throw Object.assign(Error('fixture uncertain'), { code: 'CLOUD_FALLBACK_SUBMISSION_UNCERTAIN' }); };
    await assert.rejects(p.buildTranscriptRecordFromMedia(record, { url: record.content, platform: '抖音', preparedMedia: true, binding, mediaUrls: ['https://fixture.test/a.mp4'] }), { code: 'CLOUD_FALLBACK_SUBMISSION_UNCERTAIN' });
  });
  for (const status of [0, 503, 403]) await test(`real submit entry retains correct state for HTTP ${status}`, async () => {
    const p = plugin(); const ids = [];
    p.requestJson = async (_url, _method, body) => { ids.push(body.clientRequestId); throw Object.assign(Error('fixture rejected'), { status }); };
    const submit = () => p.submitCloudFallbackJob({ sourceType: 'douyin_url', sourceUrl: record.content, recordId: record.id, binding });
    await assert.rejects(submit(), error => status === 403 ? error.status === 403 : error.code === 'CLOUD_FALLBACK_SUBMISSION_UNCERTAIN');
    assert.equal(p.settings.cloudFallbackSubmissions.length, status === 403 ? 0 : 1);
    if (status !== 403) { await assert.rejects(submit()); assert.equal(ids[0], ids[1]); }
  });
  await test('no media rejection retains the gate reason', async () => {
    const p = plugin();
    p.evaluateCloudFallbackUserGate = async () => ({ allowed: false, code: 'DOUYIN_LOGIN_REQUIRED', message: 'fixture login guidance' });
    const result = await p.buildTranscriptRecordFromMedia(record, { url: record.content, platform: '抖音', binding });
    assert.equal(result.metadata.mediaResolutionDiagnostic.cloudFallback.code, 'DOUYIN_LOGIN_REQUIRED');
  });
  await test('immediate success joins the scoped poll/write/ACK path', async () => {
    const p = plugin();
    p.currentProcessingContext = { recordId: record.id, recordSnapshot: record };
    p.requestJson = async () => ({ data: job({ deliveryKey: 'd'.repeat(64) }) });
    await assert.rejects(p.submitCloudFallbackJob({ sourceType: 'douyin_url', sourceUrl: record.content, recordId: record.id, binding }), { code: 'CLOUD_FALLBACK_QUEUED' });
    assert.equal(p.settings.cloudFallbackJobs[0].status, 'succeeded');
    p.requestJson = async () => { throw Error('unsupported'); };
    const recovered = (await p.pollCloudFallbackJobs(binding, [])).records[0];
    assert.equal(recovered.metadata.cloudFallbackDeliveryKey, 'd'.repeat(64));
    assert.equal(recovered.metadata.cloudFallbackJobId, 'job-first');
  });
  await test('real write commits a delivery marker and restart recovers without audio', async () => {
    const { hasFallbackDeliveryMarker } = require(path.join(root, 'src/fallback-delivery-marker'));
    const p = plugin(); const files = new Map();
    p.settings = { ...Plugin.__test.mergeSettings({ inboxDir: 'Inbox', noteSaveMode: 'root', aiProvider: 'off' }), ...p.settings };
    p.ensureFolder = async () => {}; p.nextRecordTitle = async () => 'fixture';
    p.saveSourceMediaAttachment = p.enrichRecordMetadataWithAi = async r => r;
    p.appendAdvancedAi = async s => s;
    p.app = { vault: { create: async (f, s) => { assert(!files.has(f)); files.set(f, s); }, getMarkdownFiles: () => [...files.keys()].filter(f => f.endsWith('.md')).map(path => ({ path })), cachedRead: async f => files.get(f.path), adapter: { exists: async f => files.has(f), read: async f => files.get(f), write: async (f, s) => files.set(f, s), remove: async f => files.delete(f) } } };
    const r = { ...record, type: 'file', metadata: { title: 'fixture', cloudFallbackJobId: 'new-file-job', cloudFallbackStatus: 'succeeded', cloudFallbackDeliveryKey: 'd'.repeat(64), transcriptionStatus: 'success', transcription: 'This is the complete synthetic transcript.', transcriptionSource: 'cloud-fallback', cloudFallbackRecordRetryCount: 0 } };
    const item = await p.writeRecord(r, new Date().toISOString(), binding, false);
    assert.equal(item.committed, true);
    assert(hasFallbackDeliveryMarker(files.get(item.filePath), r));
    assert.equal(await Plugin.prototype.findExistingRecordNotePath.call(p, r), item.filePath);
    assert.equal([...files.keys()].filter(f => f.endsWith('.tmp')).length, 0);
  });
  for (const submitCode of ['CLOUD_FALLBACK_SUBMISSION_UNCERTAIN', 'FIXTURE_REJECTED']) await test(`real Douyin graphic hydrate never masks ${submitCode} as saved content`, async () => {
    const p = plugin(); p.checkDouyinLogin = async () => true;
    p.evaluateCloudFallbackUserGate = async () => ({ allowed: true });
    p.submitCloudFallbackJob = async () => { throw Object.assign(Error('fixture rejected'), { code: submitCode }); };
    const url = 'https://www.douyin.com/note/1234567890123456';
    const promise = p.hydrateWebpageMarkdown({ ...record, content: url, metadata: { url } }, 'Inbox', '2026-11-13', 'fixture', binding);
    if (submitCode === 'CLOUD_FALLBACK_SUBMISSION_UNCERTAIN') await assert.rejects(promise, { code: submitCode });
    else {
      await assert.rejects(promise, error => error.code === 'DOUYIN_NOTE_TRANSCRIPTION_UNSUPPORTED' && error.diagnostic.cloudFallback.code === 'CLOUD_FALLBACK_SUBMIT_FAILED');
    }
  });

  for (const initial of ['empty','throw']) await test('operator WeChat continues browser after '+initial, async () => {
    const p=plugin();let calls=0;
    p.downloadWebpageHtmlViaNode=async()=>{if(initial==='throw')throw Object.assign(Error('fixture'),{code:'ECONNRESET'});return '';};
    p.renderWechatArticleWithElectron=async()=>{calls++;return {markdown:'Synthetic recovered article',title:'fixture'};};
    const result=await p.acquireOperatorWechatArticleContent('https://mp.weixin.qq.com/s/fixture');
    assert.equal(result.content.markdown,'Synthetic recovered article');assert.equal(calls,1);
  });
  await test('operator WeChat preserves bounded failures, captcha and cancellation',async()=>{
    const p=plugin();p.downloadWebpageHtmlViaNode=async()=>{throw Object.assign(Error('private url never returned'),{code:'ECONNRESET'});};
    p.renderWechatArticleWithElectron=async()=>{throw Object.assign(Error('private browser data'),{wechatArticleDiagnostic:{verificationMarker:true}});};
    await assert.rejects(p.acquireOperatorWechatArticleContent('https://mp.weixin.qq.com/s/fixture'),e=>e.code==='OPERATOR_WECHAT_ARTICLE_CAPTCHA'&&e.nodeFailure==='request_failed'&&e.browserFailure==='captcha'&&!JSON.stringify(e).includes('private'));
    for(const diagnostic of [{captchaRedirect:true},{finalPageKind:'captcha'}]) {p.renderWechatArticleWithElectron=async()=>{throw Object.assign(Error('private'),{wechatArticleDiagnostic:diagnostic});}; await assert.rejects(p.acquireOperatorWechatArticleContent('https://mp.weixin.qq.com/s/fixture'),{code:'OPERATOR_WECHAT_ARTICLE_CAPTCHA',browserFailure:'captcha'});}
    let renders=0;p.downloadWebpageHtmlViaNode=async()=>{throw Object.assign(Error('stop'),{name:'AbortError'});};p.renderWechatArticleWithElectron=async()=>{renders++;};
    await assert.rejects(p.acquireOperatorWechatArticleContent('https://mp.weixin.qq.com/s/fixture'),{name:'AbortError'});assert.equal(renders,0);
    await assert.rejects(p.acquireOperatorWechatArticleContent('https://evil.example/s/fixture'),{code:'OPERATOR_MEDIA_SOURCE_INVALID'});
  });
  await test('same audio upload has bounded recovery and completion-only retry',async()=>{
    const {recoverMediaUpload}=require('../obsidian-plugin/wechat-inbox-sync/src/operator-recovery');
    let now=0,uploads=0,completes=0,renewals=0;const budgets=[];
    const result=await recoverMediaUpload({expiresAt:new Date(900000).toISOString(),clock:()=>now,renew:async()=>{renewals++;},upload:async budget=>{budgets.push(budget);if(++uploads===1){now=480001;throw Object.assign(Error('fixture'),{code:'CLOUD_MEDIA_UPLOAD_TIMEOUT'});}},complete:async()=>{if(++completes===1)throw Object.assign(Error('lost response'),{code:'OPERATOR_NODE_REQUEST_TIMEOUT'});return 'done';}});
    assert.equal(result,'done');assert.deepEqual(budgets,[480000,389999]);assert.equal(uploads,2);assert.equal(completes,2);assert.equal(renewals,3);
    for(const statusCode of [401,403,409]){let n=0;await assert.rejects(recoverMediaUpload({upload:async()=>{n++;throw Object.assign(Error('denied'),{code:'CLOUD_MEDIA_UPLOAD_FAILED',statusCode});},complete:async()=>{throw Error('must not complete');}}));assert.equal(n,1);}
    let n=0;await assert.rejects(recoverMediaUpload({expiresAt:new Date(900000).toISOString(),clock:()=>0,renew:async()=>{throw Object.assign(Error('lease'),{code:'LEASE_LOST'});},upload:async()=>{n++;}}),{code:'LEASE_LOST'});assert.equal(n,0);
    const controller=new AbortController();controller.abort();await assert.rejects(recoverMediaUpload({signal:controller.signal,upload:async()=>{throw Error('must not run');}}),{name:'AbortError'});
    await assert.rejects(recoverMediaUpload({expiresAt:new Date(20000).toISOString(),clock:()=>0,upload:async()=>{throw Error('must not run');}}),{code:'CLOUD_MEDIA_UPLOAD_WINDOW_EXPIRED'});
    n=0;await assert.rejects(recoverMediaUpload({expiresAt:new Date(900000).toISOString(),clock:()=>0,upload:async()=>{n++;throw Object.assign(Error('fixture'),{code:'CLOUD_MEDIA_UPLOAD_TIMEOUT'});}}),{uploadAttempts:2});assert.equal(n,2);
  });
  await test('terminal fallback detail survives safe report and cannot relabel cancellation',async()=>{
    const {sanitizeFallbackDecision}=require('../obsidian-plugin/wechat-inbox-sync/src/fallback-decision');
    const {selectFailureDetail}=require('../obsidian-plugin/wechat-inbox-sync/src/failure-reason-utils');
    const cloudFallback=sanitizeFallbackDecision({status:'failed',code:'OPERATOR_WECHAT_ARTICLE_EMPTY',stage:'acquiring',secret:'never'});
    assert.deepEqual(cloudFallback,{status:'failed',code:'OPERATOR_WECHAT_ARTICLE_EMPTY',stage:'acquiring'});
    assert.equal(selectFailureDetail({code:'CLOUD_FALLBACK_FAILED',diagnostic:{cloudFallback}}),'OPERATOR_WECHAT_ARTICLE_EMPTY');
    assert.notEqual(selectFailureDetail({code:'CLOUD_FALLBACK_CANCELLED',diagnostic:{cloudFallback}}),'OPERATOR_WECHAT_ARTICLE_EMPTY');
    assert.equal(sanitizeFallbackDecision({status:'failed',code:'private text',stage:'path'}),null);
  });


  await test('worker upload integration reuses file/hash/upload identity and cleans once', async()=>{
    const source=fs.readFileSync(require('path').join(root,'src/main.js'),'utf8');let from=source.indexOf('  async uploadWorkerMediaForJob('),to=source.indexOf('\n  isOperatorLocalAsrAvailable(',from);
    const method=source.slice(from,to);const removed=[];let hashes=0,transcodes=0,prepares=0,uploads=0,completes=0;const used=[];
    const X=new Function('require','process','fs','hashFileSha256','uploadMultipartFile','getOperatorMediaNodeModule','throwIfAborted','isControlledCloudFallbackFileId','MAX_CLOUD_FALLBACK_MEDIA_BYTES','OPERATOR_NODE_TOKEN_ENV','OPERATOR_NODE_ID_ENV','OPERATOR_NODE_API_BASE_ENV','OPERATOR_NODE_ENABLED_ENV','recoverMediaUpload','return class X {'+method+'}')(name=>require(require('path').join(root,'src',name)),{env:{}},{existsSync:()=>true,unlinkSync:p=>removed.push(p)},async p=>{hashes++;return{size:4,sha256:'a'.repeat(64)};},async(url,fields,p,opts)=>{used.push(p);if(++uploads===1)throw Object.assign(Error('reset'),{code:'CLOUD_MEDIA_UPLOAD_FAILED',cause:{code:'ECONNRESET'}});},()=>({WORKER_PROTOCOL_VERSION:1}),()=>{},x=>x==='cloud://fixture/audio',1e8,'TOKEN','ID','API','ENABLED',require('../obsidian-plugin/wechat-inbox-sync/src/operator-recovery').recoverMediaUpload);
    const p=new X();p.settings={};p.transcodeCloudFallbackMediaToMp3=async()=>{transcodes++;return {path:'synthetic-owned.mp3',owned:true};};
    const result=await p.uploadWorkerMediaForJob('synthetic-input', {jobId:'job',attemptId:'attempt',fencingVersion:3,leaseToken:'fixture'}, {workerConfig:{enabled:true,workerToken:'fixture',workerId:'worker',apiBase:'https://fixture.invalid'},beforeComplete:async()=>{},request:async(route,body)=>{assert.equal(body.attemptId,'attempt');if(route.endsWith('/prepare')){prepares++;return {uploadId:'same-upload',uploadUrl:'https://fixture.invalid/upload',expiresAt:new Date(Date.now()+900000).toISOString()};}completes++;assert.equal(body.uploadId,'same-upload');if(completes===1)throw Object.assign(Error('response lost'),{code:'OPERATOR_NODE_REQUEST_TIMEOUT'});return {fileID:'cloud://fixture/audio'};}});
    assert.equal(result.uploadId,'same-upload');assert.deepEqual([transcodes,hashes,prepares,uploads,completes],[1,1,1,2,2]);assert.deepEqual(used,['synthetic-owned.mp3','synthetic-owned.mp3']);assert.deepEqual(removed,['synthetic-owned.mp3']);
  });

  console.log(`plugin fallback delivery: ${count} behavioral cases passed`);
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
