'use strict';

const assert = require('node:assert');
const Module = require('node:module');

const {
  ALLOWED_EVENT_FIELDS,
  createDiagnosticId,
  createSyncDiagnosticReporter,
  getBindingFingerprint,
  normalizeDiagnosticEvent,
  normalizeOutbox,
  sanitizeSourceLink,
} = require('../obsidian-plugin/wechat-inbox-sync/src/sync-diagnostic-reporter');

const bindingA = { token: 'binding-a-secret', status: 'bound', enabled: true };
const bindingB = { token: 'binding-b-secret', status: 'bound', enabled: true };
const nowValue = Date.parse('2026-10-02T00:00:00.000Z');

const sourceLinkFixture = 'https://v.douyin.com/abc123/?from=copy&modal_id=123456789&token=DO_NOT_STORE&xsec_token=DO_NOT_STORE#private-fragment';

function makeEvent(overrides = {}) {
  return normalizeDiagnosticEvent({
    attemptId: 'attempt-00000001',
    diagnosticId: createDiagnosticId({ binding: bindingA, syncRecordId: 'record-1' }),
    syncRecordId: 'record-1',
    outcome: 'failed',
    errorType: 'NETWORK_FAILED',
    stage: 'fetch',
    pluginVersion: '1.3.175',
    platform: 'win32',
    occurredAt: new Date(nowValue).toISOString(),
    retryCount: 2,
    evidenceCodes: ['http_status'],
    title: 'private title',
    body: 'private body',
    url: 'https://private.example/secret',
    path: 'C:/private/path.md',
    token: bindingA.token,
    message: 'raw private message',
    stack: 'private stack',
    ...overrides,
  });
}

assert.deepStrictEqual(
  Object.keys(makeEvent()).sort(),
  [...new Set(['eventId', 'attemptId', 'diagnosticId', 'syncRecordId', 'errorType', 'stage', 'pluginVersion', 'platform', 'occurredAt', 'retryCount', 'outcome', 'evidenceCodes', 'errorCode'])].sort(),
  'event is rebuilt from the explicit allowlist',
);
const privateSerialized = JSON.stringify(makeEvent());
for (const secret of ['private title', 'private body', 'private.example', 'C:/private/path.md', bindingA.token, 'raw private message', 'private stack']) {
  assert.strictEqual(privateSerialized.includes(secret), false, `event must not contain ${secret}`);
}
assert.strictEqual(makeEvent().outcome, 'failed');
assert.strictEqual(makeEvent({ outcome: 'success', stage: 'write', evidenceCodes: ['sync_callback'] }).outcome, 'succeeded');
assert.strictEqual(makeEvent({ outcome: 'success', stage: 'write', evidenceCodes: ['sync_callback'] }).errorType, 'NONE');
assert.strictEqual(makeEvent({ errorType: 'UNSUPPORTED_PLATFORM' }).errorType, 'SYNC_FAILED');
assert.strictEqual(makeEvent({ platform: 'darwin' }).platform, 'macos');
assert.strictEqual(makeEvent({ stage: 'writing' }).stage, 'write');
assert.strictEqual(makeEvent({ retryCount: 9999 }).retryCount, 100);
assert.strictEqual(
  sanitizeSourceLink(sourceLinkFixture),
  'https://v.douyin.com/abc123/?from=copy&modal_id=123456789',
  'source links retain a public short-link path and work id while dropping token parameters and fragments',
);
assert.strictEqual(
  sanitizeSourceLink('https://www.douyin.com/video/987654321?foo=bar&access-key=SIGNED_VALUE#fragment'),
  'https://www.douyin.com/video/987654321?foo=bar',
  'canonical work links retain non-credential query values',
);
assert.strictEqual(
  sanitizeSourceLink('https://fc.example.test/post?id=123'),
  'https://fc.example.test/post?id=123',
  'ordinary domains beginning with fc are not treated as private IPv6 hosts',
);
for (const unsafeLink of [
  'file:///private/record.mp4',
  'http://127.0.0.1:8080/video/123',
  'https://cdn.example.com/media/clip.mp4?signature=SIGNED_VALUE',
  'https://user:password@example.com/video/123',
]) {
  assert.strictEqual(sanitizeSourceLink(unsafeLink), '', `unsafe source link is rejected: ${unsafeLink}`);
}
assert.strictEqual(
  makeEvent({ sourceLink: sourceLinkFixture }).sourceUrl,
  'https://v.douyin.com/abc123/?from=copy&modal_id=123456789',
);
assert.strictEqual(
  makeEvent({ sourceUrl: sourceLinkFixture }).sourceUrl,
  'https://v.douyin.com/abc123/?from=copy&modal_id=123456789',
  'the canonical server field is accepted directly',
);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(makeEvent({ sourceLink: sourceLinkFixture }), 'sourceLink'),
  false,
  'the client alias is never serialized alongside sourceUrl',
);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(makeEvent({ outcome: 'success', sourceLink: sourceLinkFixture }), 'sourceLink'),
  false,
  'successful sync events never retain a source URL in diagnostics',
);

const incidentOne = createDiagnosticId({ binding: bindingA, syncRecordId: 'record-1', attemptId: 'attempt-00000001' });
const incidentTwo = createDiagnosticId({ binding: bindingA, syncRecordId: 'record-1', attemptId: 'attempt-00000002' });
assert.strictEqual(incidentOne, incidentTwo, 'incident id remains stable across attempts');
const eventOne = makeEvent({ attemptId: 'attempt-00000001' });
const eventTwo = makeEvent({ attemptId: 'attempt-00000002' });
assert.notStrictEqual(eventOne.eventId, eventTwo.eventId, 'event id includes attempt identity');

async function runOutboxTests() {
  let clock = nowValue;
  let persisted = [];
  const calls = [];
  let mode = 'fail';
  let filteredSnapshot = null;
  const legacySuccessReporter = createSyncDiagnosticReporter({
    initialOutbox: [{
      event: makeEvent({
        eventId: 'event-legacy-success-0001',
        outcome: 'succeeded',
      }),
      bindingFingerprint: getBindingFingerprint(bindingA),
      createdAt: new Date(clock).toISOString(),
      nextAttemptAt: clock,
      uploadAttempts: 0,
    }],
    now: () => clock,
    saveOutbox: async (value) => { filteredSnapshot = JSON.parse(JSON.stringify(value)); },
  });
  await legacySuccessReporter.whenIdle();
  assert.deepStrictEqual(filteredSnapshot, [], 'legacy success outbox entries are filtered and persisted');
  assert.strictEqual(legacySuccessReporter.getPendingCount(), 0);
  const rejectedSuccess = legacySuccessReporter.enqueue(
    makeEvent({ eventId: 'event-new-success-0001', outcome: 'success' }),
    bindingA,
  );
  assert.strictEqual(rejectedSuccess.queued, false, 'success outcomes are rejected before enqueue');
  assert.strictEqual(rejectedSuccess.reason, 'success-outcome-rejected');
  legacySuccessReporter.dispose();

  const reporter = createSyncDiagnosticReporter({
    initialOutbox: [],
    now: () => clock,
    pluginVersion: '1.3.175',
    platform: 'win32',
    getBindings: () => [bindingA],
    retryBaseMs: 1000,
    requestTimeoutMs: 20,
    saveOutbox: async (value) => { persisted = JSON.parse(JSON.stringify(value)); },
    postEvents: async (events, binding) => {
      calls.push({ events, binding });
      if (mode === 'fail') {
        const error = new Error('server unavailable');
        error.status = 503;
        throw error;
      }
      if (mode === 'empty-ack') return { acceptedEventIds: [] };
      if (mode === 'no-ack') return { success: true, data: { accepted: true } };
      return { acceptedEventIds: events.map((event) => event.eventId) };
    },
  });
  assert.strictEqual(
    reporter.enqueue(makeEvent({ attemptId: '' }), bindingA).queued,
    false,
    'events without a server attempt do not enter the aggregate denominator',
  );
  const queued = reporter.enqueue(makeEvent({ sourceLink: sourceLinkFixture }), bindingA);
  assert.strictEqual(queued.queued, true);
  assert.strictEqual(queued.event.sourceUrl, 'https://v.douyin.com/abc123/?from=copy&modal_id=123456789');
  await reporter.whenIdle();
  assert.strictEqual(persisted.length, 1);
  assert.strictEqual(persisted[0].bindingFingerprint, getBindingFingerprint(bindingA));
  assert.strictEqual(Object.prototype.hasOwnProperty.call(persisted[0], 'token'), false);
  assert.strictEqual(persisted[0].event.sourceUrl, 'https://v.douyin.com/abc123/?from=copy&modal_id=123456789');

  const wrongBindingFlush = await reporter.flush({ bindings: [bindingB] });
  assert.strictEqual(wrongBindingFlush.sent, 0);
  assert.strictEqual(calls.length, 0, 'an outbox item must not use a different binding');

  const failedFlush = await reporter.flush({ bindings: [bindingA] });
  assert.strictEqual(failedFlush.failed, 1);
  assert.strictEqual(reporter.getPendingCount(), 1);
  assert.strictEqual(reporter.getOutbox()[0].uploadAttempts, 1);
  assert.ok(reporter.getOutbox()[0].nextAttemptAt > clock);

  clock = reporter.getOutbox()[0].nextAttemptAt;
  mode = 'empty-ack';
  const emptyAckFlush = await reporter.flush({ bindings: [bindingA] });
  assert.strictEqual(emptyAckFlush.sent, 0, 'empty acknowledgements must not dequeue events');
  assert.strictEqual(emptyAckFlush.failed, 1);
  assert.strictEqual(reporter.getPendingCount(), 1);
  assert.strictEqual(reporter.getOutbox()[0].uploadAttempts, 2);

  clock = reporter.getOutbox()[0].nextAttemptAt;
  mode = 'no-ack';
  const noAckFlush = await reporter.flush({ bindings: [bindingA] });
  assert.strictEqual(noAckFlush.sent, 0, 'a response without explicit event ids must not dequeue');
  assert.strictEqual(noAckFlush.failed, 1);
  assert.strictEqual(reporter.getPendingCount(), 1);
  assert.strictEqual(reporter.getOutbox()[0].uploadAttempts, 3);

  const restart = createSyncDiagnosticReporter({
    initialOutbox: persisted,
    now: () => clock,
    pluginVersion: '1.3.175',
    platform: 'win32',
    getBindings: () => [bindingA],
    retryBaseMs: 1,
    saveOutbox: async (value) => { persisted = JSON.parse(JSON.stringify(value)); },
    postEvents: async (events, binding) => {
      calls.push({ events, binding });
      return { success: true, data: { acceptedEventIds: events.map((event) => event.eventId) } };
    },
  });
  // The persisted snapshot was captured after the first failed request. It is
  // still a durable event after a new reporter instance is created.
  assert.strictEqual(restart.getPendingCount(), 1);
  clock = restart.getOutbox()[0].nextAttemptAt;
  const sent = await restart.flush({ bindings: [bindingA] });
  assert.strictEqual(sent.sent, 1);
  assert.strictEqual(restart.getPendingCount(), 0);

  const batchCalls = [];
  const batchReporter = createSyncDiagnosticReporter({
    initialOutbox: [],
    now: () => clock,
    pluginVersion: '1.3.175',
    platform: 'win32',
    getBindings: () => [bindingA],
    saveOutbox: async () => {},
    postEvents: async (events, binding) => {
      batchCalls.push({ events, binding });
      return { success: true, data: { eventId: events[0].eventId } };
    },
  });
  batchReporter.enqueue(makeEvent({ eventId: 'event-batch-0001', syncRecordId: 'record-batch-1' }), bindingA);
  batchReporter.enqueue(makeEvent({ eventId: 'event-batch-0002', syncRecordId: 'record-batch-2' }), bindingA);
  await batchReporter.whenIdle();
  const partialBatch = await batchReporter.flush({ bindings: [bindingA] });
  assert.strictEqual(batchCalls.length, 1, 'diagnostics are posted as one batch');
  assert.strictEqual(batchCalls[0].events.length, 2);
  assert.strictEqual(partialBatch.sent, 1, 'single-event acknowledgement removes only that event');
  assert.strictEqual(batchReporter.getPendingCount(), 1, 'unacknowledged batch item remains durable');
  batchReporter.dispose();

  let releaseRaceBindingA;
  let raceBindingAStarted;
  const raceBindingAStartedPromise = new Promise((resolve) => { raceBindingAStarted = resolve; });
  const raceCalls = [];
  const raceReporter = createSyncDiagnosticReporter({
    initialOutbox: [
      {
        event: makeEvent({
          eventId: 'event-race-binding-a-0001',
          attemptId: 'attempt-race-binding-a-1',
          syncRecordId: 'record-race-a',
        }),
        bindingFingerprint: getBindingFingerprint(bindingA),
        createdAt: new Date(clock).toISOString(),
        nextAttemptAt: clock,
        uploadAttempts: 0,
      },
      {
        event: makeEvent({
          eventId: 'event-race-binding-b-0001',
          attemptId: 'attempt-race-binding-b-1',
          syncRecordId: 'record-race-b',
        }),
        bindingFingerprint: getBindingFingerprint(bindingB),
        createdAt: new Date(clock).toISOString(),
        nextAttemptAt: clock,
        uploadAttempts: 0,
      },
    ],
    now: () => clock,
    getBindings: () => [bindingA, bindingB],
    saveOutbox: async () => {},
    postEvents: async (events, binding) => {
      raceCalls.push({ events, binding });
      if (binding === bindingA) {
        raceBindingAStarted();
        await new Promise((resolve) => { releaseRaceBindingA = resolve; });
      }
      return { acceptedEventIds: events.map((event) => event.eventId) };
    },
  });
  const raceFlush = raceReporter.flush({ bindings: [bindingA, bindingB] });
  await raceBindingAStartedPromise;
  const clearedDuringRace = await raceReporter.clearRecord({
    binding: bindingB,
    syncRecordId: 'record-race-b',
  });
  assert.strictEqual(clearedDuringRace.cleared, 1);
  releaseRaceBindingA();
  const raceResult = await raceFlush;
  assert.strictEqual(raceResult.sent, 1);
  assert.deepStrictEqual(raceCalls.map((call) => call.binding), [bindingA], 'a deferred binding does not send a record cleared while A was in flight');
  assert.strictEqual(raceReporter.getPendingCount(), 0);
  raceReporter.dispose();

  let timedOut = false;
  const timeoutReporter = createSyncDiagnosticReporter({
    initialOutbox: [],
    now: () => clock,
    getBindings: () => [bindingA],
    requestTimeoutMs: 5,
    retryBaseMs: 1000,
    postEvents: () => new Promise(() => {}),
  });
  timeoutReporter.enqueue(makeEvent({ eventId: 'event-timeout-0001' }), bindingA);
  const began = Date.now();
  const timeoutResult = await timeoutReporter.flush({ bindings: [bindingA] });
  timedOut = Date.now() - began < 1000;
  assert.strictEqual(timedOut, true, 'report request has a bounded timeout');
  assert.strictEqual(timeoutResult.failed, 1);
  timeoutReporter.dispose();
  assert.strictEqual(timeoutReporter.enqueue(makeEvent({ eventId: 'event-after-stop-1' }), bindingA).queued, false);
  reporter.dispose();
  restart.dispose();
}

async function runPluginHookTest() {
  const originalLoad = Module._load;
  Module._load = function mockObsidian(request, parent, isMain) {
    if (request === 'obsidian') {
      return {
        Modal: class {},
        Notice: class {},
        Plugin: class {},
        PluginSettingTab: class {},
        Setting: class {},
        requestUrl: async () => ({ status: 200, json: { success: true, data: {} } }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  // Load the candidate bundle so the test exercises the same artifact that
  // Obsidian loads. The source module embeds PowerShell files, which Node
  // cannot parse without a test-only text loader.
  const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
  Module._load = originalLoad;
  function makePlugin(record, sent, writeError = null, writeResult = null, initialOutbox = []) {
    const plugin = new PluginClass();
    plugin.settings = PluginClass.__test.mergeSettings({
      bindings: [bindingA],
      token: bindingA.token,
      syncDiagnosticOutbox: initialOutbox,
    });
    plugin.getActiveBindings = () => [bindingA];
    plugin.getAutoSyncBindings = () => [bindingA];
    plugin.saveData = async (settings) => { plugin.settings = settings; };
    plugin.showSyncProgress = () => {};
    plugin.setTranscriptionStopAvailable = () => {};
    plugin.replayPendingSyncLifecycleAttempts = async () => ({ replayed: 0, retained: 0 });
    plugin.findExistingRecordNotePath = async () => '';
    plugin.getConfiguredLocalAsrInstallRoot = () => '';
    plugin.getRecentXiaohongshuCommentResults = () => [];
    plugin.getRecentXiaohongshuBrowserResults = () => [];
    plugin.writeRecord = async () => {
      if (writeError) throw writeError;
      return writeResult || {
        recordId: record._id,
        title: 'safe title',
        filePath: 'vault/safe title.md',
        committed: true,
      };
    };
    plugin.requestJson = async (path, method, body, binding, options) => {
      sent.push({ path, method, body, binding, options });
      if (path === '/diagnostics/events') {
        return { success: true, data: { acceptedEventIds: body.events.map((event) => event.eventId) } };
      }
      if (path === '/records?status=pending') {
        return {
          success: true,
          data: [record],
          meta: { syncLifecycleStatus: true },
        };
      }
      if (/\/status$/.test(path)) {
        return body && body.status === 'processing'
          ? { success: true, data: { attemptId: 'attempt-hook-sync-0001' } }
          : { success: true, data: { status: 'failed' } };
      }
      if (/\/synced$/.test(path)) return { success: true, data: { status: 'deleted' } };
      throw new Error(`unexpected path: ${path}`);
    };
    return plugin;
  }

  const directRecord = { _id: 'record-hook-direct' };
  const directSent = [];
  const directPlugin = makePlugin(directRecord, directSent);
  const directReporter = directPlugin.getSyncDiagnosticReporter();
  const controlledEvidenceCases = [
    [{ code: 'DOUYIN_CHALLENGE' }, 'challenge_detected'],
    [{ code: 'DOUYIN_NO_MEDIA' }, 'parser_rejected'],
    [{ code: 'TRANSCRIPTION_NO_SPEECH', diagnostic: { noSpeechEvidence: 'full-decode-and-vad-no-speech-segments' } }, 'asr_no_speech'],
    [{ code: 'DOUYIN_BROWSER_RENDERER_GONE' }, 'process_crashed'],
    [{ code: 'COMPONENT_CLIENT_UPGRADE_REQUIRED' }, 'upgrade_required'],
    [{ status: 403 }, 'http_403'],
    [{ status: 412, code: 'BILIBILI_HTTP_412' }, 'http_412'],
    [{ code: 'LOCAL_COMPONENT_UNAVAILABLE', diagnostic: { componentMissing: true } }, 'component_missing'],
  ];
  controlledEvidenceCases.forEach(([errorOptions, expectedEvidence], index) => {
    const controlledError = new Error('controlled diagnostic fixture');
    Object.assign(controlledError, errorOptions);
    directPlugin.queueSyncDiagnosticFailure({
      recordId: `record-evidence-${index + 1}`,
      attemptId: `attempt-evidence-${index + 1}`,
      binding: bindingA,
      error: controlledError,
      retryCount: 0,
    });
  });
  const unconfirmedNoSpeechError = new Error('no speech code without full decode evidence');
  unconfirmedNoSpeechError.code = 'TRANSCRIPTION_NO_SPEECH';
  directPlugin.queueSyncDiagnosticFailure({
    recordId: 'record-evidence-no-speech-unconfirmed',
    attemptId: 'attempt-evidence-no-speech-unconfirmed',
    binding: bindingA,
    error: unconfirmedNoSpeechError,
    retryCount: 0,
  });
  const genericComponentError = new Error('component install failed');
  genericComponentError.code = 'LOCAL_COMPONENT_UNAVAILABLE';
  directPlugin.queueSyncDiagnosticFailure({
    recordId: 'record-evidence-generic-component',
    attemptId: 'attempt-evidence-generic',
    binding: bindingA,
    error: genericComponentError,
    retryCount: 0,
  });
  await directReporter.whenIdle();
  await directReporter.flush({ bindings: [bindingA] });
  const directEvidenceEvents = directSent
    .filter((call) => call.path === '/diagnostics/events')
    .flatMap((call) => call.body.events);
  controlledEvidenceCases.forEach(([, expectedEvidence], index) => {
    const event = directEvidenceEvents.find((candidate) => candidate.syncRecordId === `record-evidence-${index + 1}`);
    assert.ok(event, `controlled evidence event ${index + 1} is posted`);
    assert.ok(event.evidenceCodes.includes(expectedEvidence), `controlled evidence maps to ${expectedEvidence}`);
  });
  const unconfirmedNoSpeechEvent = directEvidenceEvents.find((candidate) => candidate.syncRecordId === 'record-evidence-no-speech-unconfirmed');
  assert.ok(unconfirmedNoSpeechEvent, 'unconfirmed no-speech event is posted');
  assert.strictEqual(unconfirmedNoSpeechEvent.evidenceCodes.includes('asr_no_speech'), false, 'error code alone cannot claim no speech');
  const genericComponentEvent = directEvidenceEvents.find((candidate) => candidate.syncRecordId === 'record-evidence-generic-component');
  assert.deepStrictEqual(genericComponentEvent.evidenceCodes, ['no_matching_evidence']);
  directReporter.dispose();

  const raceFixtureNow = Date.now();
  const expiredRaceEvent = makeEvent({
    eventId: 'event-race-expired-0001',
    occurredAt: new Date(raceFixtureNow - (8 * 24 * 60 * 60 * 1000)).toISOString(),
  });
  const expiredRaceOutbox = normalizeOutbox([{
    event: expiredRaceEvent,
    bindingFingerprint: getBindingFingerprint(bindingA),
    createdAt: expiredRaceEvent.occurredAt,
    nextAttemptAt: raceFixtureNow,
    uploadAttempts: 0,
  }], { now: raceFixtureNow });
  assert.deepStrictEqual(expiredRaceOutbox, [], 'diagnostic outbox entries beyond the TTL are dropped');

  const racePlugin = new PluginClass();
  racePlugin.settings = PluginClass.__test.mergeSettings({
    bindings: [bindingA],
    token: bindingA.token,
    syncDiagnosticOutbox: [],
  });
  racePlugin.getActiveBindings = () => racePlugin.settings.bindings;
  const delayedWrites = [];
  racePlugin.saveData = async (settings) => await new Promise((resolve) => {
    delayedWrites.push({ snapshot: JSON.parse(JSON.stringify(settings)), resolve });
  });
  const raceReporter = racePlugin.getSyncDiagnosticReporter();
  raceReporter.enqueue(makeEvent({
    eventId: 'event-race-0001',
    occurredAt: new Date(raceFixtureNow - 60 * 1000).toISOString(),
  }), bindingA);
  raceReporter.dispose();
  const outboxWrite = raceReporter.whenIdle();
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  assert.strictEqual(delayedWrites.length, 1);
  const rebindWrite = racePlugin.saveSettings({
    ...racePlugin.settings,
    bindings: [bindingB],
    token: bindingB.token,
  });
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  assert.strictEqual(delayedWrites.length, 1, 'settings update waits for an in-flight outbox write');
  delayedWrites.shift().resolve();
  await outboxWrite;
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  assert.strictEqual(delayedWrites.length, 1);
  delayedWrites.shift().resolve();
  await rebindWrite;
  const raceSnapshot = racePlugin.settings;
  assert.strictEqual(raceSnapshot.bindings[0].token, bindingB.token.toUpperCase(), 'rebind survives serialized persistence');
  assert.strictEqual(raceSnapshot.syncDiagnosticOutbox.length, 1, 'rebind does not erase the durable outbox');

  const successRecord = {
    _id: 'record-hook-success',
    type: 'text',
    content: 'safe content',
    createdAt: '2026-10-02T00:00:00.000Z',
    retryCount: 0,
  };
  const successSent = [];
  const successPlugin = makePlugin(successRecord, successSent);
  const successResult = await successPlugin.syncBinding(bindingA, false);
  const successReporter = successPlugin.getSyncDiagnosticReporter();
  await successReporter.whenIdle();
  await successReporter.flush({ bindings: [bindingA] });
  const successDiagnostics = successSent
    .filter((call) => call.path === '/diagnostics/events')
    .flatMap((call) => call.body.events);
  assert.strictEqual(successResult.written.length, 1, 'syncBinding success writes the local record');
  assert.strictEqual(successResult.failed.length, 0, 'syncBinding success has no failed records');
  assert.strictEqual(successDiagnostics.length, 0, 'actual syncBinding success does not create a diagnostic event');
  assert.strictEqual(successReporter.getPendingCount(), 0, 'actual syncBinding success leaves no diagnostic outbox entry');
  assert.strictEqual(successSent.some((call) => /\/synced$/.test(call.path)), true, 'success waits for local write before completion ack');
  successReporter.dispose();

  const cleanupCreatedAt = new Date(raceFixtureNow - (2 * 60 * 1000)).toISOString();
  const cleanupOutbox = [
    {
      event: makeEvent({
        eventId: 'event-stale-binding-a-0001',
        attemptId: 'attempt-stale-binding-a-1',
        diagnosticId: createDiagnosticId({ binding: bindingA, syncRecordId: successRecord._id }),
        syncRecordId: successRecord._id,
      }),
      bindingFingerprint: getBindingFingerprint(bindingA),
      createdAt: cleanupCreatedAt,
      nextAttemptAt: raceFixtureNow,
      uploadAttempts: 0,
    },
    {
      event: makeEvent({
        eventId: 'event-stale-binding-b-0001',
        attemptId: 'attempt-stale-binding-b-1',
        diagnosticId: createDiagnosticId({ binding: bindingB, syncRecordId: successRecord._id }),
        syncRecordId: successRecord._id,
      }),
      bindingFingerprint: getBindingFingerprint(bindingB),
      createdAt: cleanupCreatedAt,
      nextAttemptAt: raceFixtureNow,
      uploadAttempts: 0,
    },
    {
      event: makeEvent({
        eventId: 'event-stale-other-record-0001',
        attemptId: 'attempt-stale-other-record-1',
        syncRecordId: 'record-hook-other',
      }),
      bindingFingerprint: getBindingFingerprint(bindingA),
      createdAt: cleanupCreatedAt,
      nextAttemptAt: raceFixtureNow,
      uploadAttempts: 0,
    },
  ];
  const cleanupSent = [];
  const cleanupPlugin = makePlugin(successRecord, cleanupSent, null, null, cleanupOutbox);
  const cleanupReporter = cleanupPlugin.getSyncDiagnosticReporter();
  assert.strictEqual(cleanupReporter.getPendingCount(), 3);
  await cleanupPlugin.syncBinding(bindingA, false);
  await cleanupReporter.whenIdle();
  const retainedAfterSuccess = cleanupReporter.getOutbox();
  assert.strictEqual(
    retainedAfterSuccess.some((entry) => entry.bindingFingerprint === getBindingFingerprint(bindingA)
      && entry.event.syncRecordId === successRecord._id),
    false,
    'normal completion clears stale failure diagnostics for the committed binding and record',
  );
  assert.strictEqual(
    retainedAfterSuccess.some((entry) => entry.bindingFingerprint === getBindingFingerprint(bindingB)
      && entry.event.syncRecordId === successRecord._id),
    true,
    'normal completion keeps the same record under another binding',
  );
  assert.strictEqual(
    retainedAfterSuccess.some((entry) => entry.bindingFingerprint === getBindingFingerprint(bindingA)
      && entry.event.syncRecordId === 'record-hook-other'),
    true,
    'normal completion keeps other failure records under the same binding',
  );
  assert.strictEqual(cleanupSent.some((call) => call.path === '/diagnostics/events'), false);
  assert.strictEqual(cleanupSent.some((call) => /\/synced$/.test(call.path)), true);
  cleanupReporter.dispose();

  const unacknowledgedRecord = {
    _id: 'record-hook-unacknowledged',
    type: 'text',
    content: 'safe content',
    createdAt: '2026-10-02T00:00:00.000Z',
    retryCount: 0,
  };
  const unacknowledgedSent = [];
  const unacknowledgedPlugin = makePlugin(
    unacknowledgedRecord,
    unacknowledgedSent,
    null,
    { recordId: unacknowledgedRecord._id, title: 'safe title', filePath: 'vault/safe.md', committed: false },
  );
  const unacknowledgedResult = await unacknowledgedPlugin.syncBinding(bindingA, false);
  const unacknowledgedReporter = unacknowledgedPlugin.getSyncDiagnosticReporter();
  await unacknowledgedReporter.whenIdle();
  await unacknowledgedReporter.flush({ bindings: [bindingA] });
  assert.strictEqual(unacknowledgedResult.written.length, 1, 'missing write acknowledgement does not change sync business result');
  assert.strictEqual(unacknowledgedSent.some((call) => call.path === '/diagnostics/events'), false, 'success is reported only after an explicit write acknowledgement');
  unacknowledgedReporter.dispose();

  const failureRecord = {
    _id: 'record-hook-failure',
    type: 'webpage',
    metadata: { url: sourceLinkFixture },
    createdAt: '2026-10-02T00:00:00.000Z',
    retryCount: 1,
  };
  const failureSent = [];
  const networkError = new Error('network connection failed');
  networkError.code = 'NETWORK_FAILED';
  const failurePlugin = makePlugin(failureRecord, failureSent, networkError);
  const failureResult = await failurePlugin.syncBinding(bindingA, false);
  const failureReporter = failurePlugin.getSyncDiagnosticReporter();
  await failureReporter.whenIdle();
  await failureReporter.flush({ bindings: [bindingA] });
  const failureDiagnostics = failureSent
    .filter((call) => call.path === '/diagnostics/events')
    .flatMap((call) => call.body.events);
  assert.strictEqual(failureResult.written.length, 0, 'syncBinding failure does not report a local write');
  assert.strictEqual(failureResult.failed.length, 1, 'actual syncBinding failure remains failed');
  assert.strictEqual(failureDiagnostics.length, 1, 'actual syncBinding failure enqueues one diagnostic');
  assert.strictEqual(failureDiagnostics[0].outcome, 'failed');
  assert.strictEqual(failureDiagnostics[0].errorType, 'NETWORK_FAILED');
  assert.strictEqual(
    failureDiagnostics[0].sourceUrl,
    'https://v.douyin.com/abc123/?from=copy&modal_id=123456789',
    'failed sync passes the record page URL through the sanitized sourceUrl field',
  );
  assert.deepStrictEqual(failureDiagnostics[0].evidenceCodes, ['no_matching_evidence'], 'generic network failure is not mislabeled timeout');
  assert.strictEqual(failureSent.some((call) => /\/synced$/.test(call.path)), false, 'failed sync never reports completion');
  failureReporter.dispose();
}

async function main() {
  let completedSuites = 0;
  await runOutboxTests();
  completedSuites += 1;
  await runPluginHookTest();
  completedSuites += 1;
  console.log(`plugin-diagnostic-reporter.test.js: PASS (${completedSuites} suites complete)`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
