'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { createAutoSyncController, RECORD_RETRY_MS } = require('../obsidian-plugin/wechat-inbox-sync/src/auto-sync-controller');

function fakeClock() {
  let time = 0;
  let sequence = 0;
  const jobs = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) { const id = ++sequence; jobs.set(id, { fn, due: time + delay }); return id; },
    clearTimer(id) { jobs.delete(id); },
    get size() { return jobs.size; },
    get delay() { return Math.min(...[...jobs.values()].map((job) => job.due - time)); },
    advance(ms) { time += ms; },
    fire() {
      assert.ok(jobs.size, 'expected a scheduled check');
      const [id, job] = [...jobs].sort((a, b) => a[1].due - b[1].due)[0];
      jobs.delete(id);
      time = Math.max(time, job.due);
      return job.fn();
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function controllerTests() {
  const clock = fakeClock();
  let calls = 0;
  let allowed = true;
  let busy = false;
  let result = { written: 1 };
  const controller = createAutoSyncController({
    ...clock,
    run: async () => { calls += 1; return result; },
    canRun: () => allowed,
    isBusy: () => busy,
  });
  controller.setEnabled(true);
  assert.equal(clock.delay, 1000);
  await clock.fire();
  assert.equal(calls, 1);
  assert.equal(clock.delay, 60000);
  busy = true;
  await clock.fire();
  assert.equal(calls, 1, 'manual sync must not overlap a background check');
  busy = false;
  allowed = false;
  await clock.fire();
  assert.equal(calls, 1, 'unbound/offline clients must not make requests');
  allowed = true;
  result = { pollFailed: true };
  await clock.fire();
  assert.equal(clock.delay, 120000);
  controller.wake();
  assert.equal(clock.delay, 120000, 'focus must not bypass network backoff');
  await clock.fire();
  assert.equal(clock.delay, 240000);
  await clock.fire();
  assert.equal(clock.delay, 300000);
  result = { written: 0 };
  await clock.fire();
  assert.equal(clock.delay, 60000);
  for (let i = 0; i < 4; i += 1) await clock.fire();
  assert.equal(clock.delay, 300000, 'five idle checks should slow to five minutes');
  controller.wake();
  assert.equal(clock.delay, 60000, 'focus just after a check must respect the minimum interval');
  controller.setEnabled(false);
  assert.equal(clock.size, 0);
  controller.wake();
  assert.equal(clock.size, 0);
  controller.setEnabled(true);
  assert.equal(clock.size, 1);
  controller.dispose();
  controller.setEnabled(true);
  assert.equal(clock.size, 0, 'disposed controllers cannot restart');

  for (const action of ['pause', 'dispose', 'pause-resume']) {
    const raceClock = fakeClock();
    const pending = deferred();
    let raceCalls = 0;
    const race = createAutoSyncController({ ...raceClock, run: () => { raceCalls += 1; return pending.promise; } });
    race.setEnabled(true);
    const running = raceClock.fire();
    race.wake();
    assert.equal(raceClock.size, 0, 'wake during an in-flight task cannot start another');
    if (action === 'dispose') race.dispose();
    else race.setEnabled(false);
    if (action === 'pause-resume') {
      race.setEnabled(true);
      await raceClock.fire();
      assert.equal(raceCalls, 1);
    }
    pending.resolve({ written: 1 });
    await running;
    assert.equal(raceClock.size, action === 'pause-resume' ? 1 : 0, 'in-flight completion must respect current lifecycle');
    race.dispose();
  }

  const retryClock = fakeClock();
  const retries = createAutoSyncController({ ...retryClock, run: async () => { throw new Error('network'); } });
  retries.setEnabled(true);
  await retryClock.fire();
  assert.equal(retryClock.delay, 120000, 'thrown errors also back off');
  for (let n = 0; n < 3; n += 1) {
    assert.equal(retries.canRetry('bad-record'), true);
    retries.failed('bad-record');
    assert.equal(retries.canRetry('bad-record'), false);
    retryClock.advance(RECORD_RETRY_MS * (2 ** n));
  }
  assert.equal(retries.canRetry('bad-record'), false, 'three failures require manual retry');
  retries.stopped('user-stopped');
  retries.retryFailures();
  assert.equal(retries.canRetry('bad-record'), true);
  assert.equal(retries.canRetry('user-stopped'), false, 'manual retry reset must not restart explicitly stopped records');
  for (let n = 0; n < 5; n += 1) {
    assert.equal(retries.canRetry('completion:record'), true);
    retries.failed('completion:record', true);
    retryClock.advance(RECORD_RETRY_MS * (2 ** Math.min(n, 3)));
  }
  assert.equal(retries.canRetry('completion:record'), true, 'committed state acknowledgements must remain recoverable');
  retries.dispose();

  const idleClock = fakeClock();
  let idleResult = { written: 0 };
  const idle = createAutoSyncController({ ...idleClock, run: async () => idleResult });
  idle.setEnabled(true);
  for (const expectedDelay of [60000, 60000, 120000, 120000, 300000, 300000, 600000, 600000]) {
    await idleClock.fire();
    assert.equal(idleClock.delay, expectedDelay, 'idle stages must progress and cap at ten minutes');
  }
  idleClock.advance(90000);
  idle.wake();
  assert.equal(idleClock.delay, 1000, 'focus after a long idle should check promptly');
  for (let i = 0; i < 5; i += 1) {
    idleClock.advance(100);
    idle.wake();
  }
  assert.equal(idleClock.delay, 500, 'event storms must not postpone an already scheduled check');
  await idleClock.fire();
  assert.equal(idleClock.delay, 600000, 'an empty focus check must not reset idle history');
  idle.wake();
  assert.equal(idleClock.delay, 60000);
  idleClock.advance(30000);
  idle.wake();
  assert.equal(idleClock.delay, 30000, 'repeat focus cannot bypass the one-minute floor');
  idleResult = { written: 1 };
  await idleClock.fire();
  assert.equal(idleClock.delay, 60000, 'new content restores fast checks');
  idleResult = { written: 0 };
  for (const expectedDelay of [60000, 60000, 120000]) {
    await idleClock.fire();
    assert.equal(idleClock.delay, expectedDelay, 'activity resets consecutive empty checks');
  }
  for (let i = 0; i < 4; i += 1) await idleClock.fire();
  assert.equal(idleClock.delay, 600000);
  idleResult = { written: 0, failed: 1 };
  await idleClock.fire();
  assert.equal(idleClock.delay, 60000, 'content arriving but failing processing is still activity');
  idleResult = { written: 0, failed: 0 };
  for (let i = 0; i < 7; i += 1) await idleClock.fire();
  assert.equal(idleClock.delay, 600000, 'deferred failures must still allow idle backoff');
  idleResult = { pollFailed: true };
  for (const expectedDelay of [120000, 240000, 300000, 300000]) {
    await idleClock.fire();
    idle.wake();
    assert.equal(idleClock.delay, expectedDelay, 'network error backoff retains its separate five-minute cap');
  }
  idleClock.advance(3600000);
  idle.wake();
  assert.ok(idleClock.delay <= 1000, 'an overdue check after sleep should run promptly');
  idle.dispose();

  const dayClock = fakeClock();
  let dayCalls = 0;
  const day = createAutoSyncController({ ...dayClock, run: async () => { dayCalls += 1; return { written: 0 }; } });
  day.setEnabled(true);
  while (dayClock.now() + dayClock.delay <= 8 * 60 * 60 * 1000) await dayClock.fire();
  assert.equal(dayCalls, 53, 'eight idle hours should make 53 checks including startup, without focus events');
  day.dispose();
}

const notices = [];
const noticeInstances = [];
const originalLoad = Module._load;
let PluginClass;
try {
  Module._load = function mockObsidian(request, parent, isMain) {
    if (request === 'obsidian') {
      return {
        Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {},
        Notice: class {
          constructor(message, duration) { this.message = String(message); this.duration = duration; this.hidden = false; notices.push(this.message); noticeInstances.push(this); }
          hide() { this.hidden = true; }
          setMessage(message) { this.message = String(message); }
        },
        requestUrl: async () => { throw new Error('Unexpected real request in isolated test'); },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
} finally { Module._load = originalLoad; }

function fixture(records = []) {
  const plugin = Object.create(PluginClass.prototype);
  const clock = fakeClock();
  const state = { records, writes: 0, requests: 0, acknowledgements: 0, persisted: null, failWrite: false, failAck: false };
  plugin.settings = PluginClass.__test.mergeSettings({
    token: 'ABC-123', bindings: [{ token: 'ABC-123', enabled: true, status: 'bound', label: 'test' }],
  });
  plugin.app = { vault: {} };
  plugin.getConfiguredLocalAsrInstallRoot = () => ''; // mkdir('') fails harmlessly; no real diagnostic files.
  plugin.getRecentXiaohongshuCommentResults = () => [];
  plugin.getRecentXiaohongshuBrowserResults = () => [];
  plugin.saveData = async (settings) => { state.persisted = JSON.parse(JSON.stringify(settings)); };
  plugin.findExistingRecordNotePath = async () => '';
  plugin.requestJson = async (route) => {
    assert.equal(route, '/records?status=pending');
    state.requests += 1;
    return { data: state.records, meta: {} };
  };
  plugin.writeRecord = async (record) => {
    state.writes += 1;
    if (state.failWrite) throw new Error('fixture extraction failed');
    return { recordId: record._id, title: 'Fixture note', committed: true };
  };
  plugin.reportSyncRecordCompletion = async (recordId) => {
    state.acknowledgements += 1;
    if (state.failAck) throw new Error('fixture ack network failure');
    state.records = state.records.filter((record) => record._id !== recordId);
  };
  plugin.autoSyncController = createAutoSyncController({ ...clock, run: () => plugin.syncInbox(false, { automatic: true }) });
  return { plugin, state, clock };
}

const record = (id) => ({ _id: id, type: 'text', content: 'Fixture content', metadata: {} });

async function pluginTests() {
  assert.equal(PluginClass.__test.mergeSettings({}).autoSyncEnabled, true);
  assert.equal(PluginClass.__test.mergeSettings({ autoSyncEnabled: false }).autoSyncEnabled, false);
  assert.deepEqual(PluginClass.__test.mergeSettings({ autoSyncStoppedRecords: ['bad'] }).autoSyncStoppedRecords, []);

  {
    const { plugin, state } = fixture([record('disabled-binding')]);
    plugin.settings.bindings[0].enabled = false;
    plugin.settings.bindings[0].status = 'paused';
    assert.equal(plugin.settings.token, 'ABC-123');
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.requests, 0, 'a legacy token must not reactivate a paused binding');
    assert.equal(state.writes, 0);
  }
  {
    const { plugin, state } = fixture([record('startup')]);
    const runtimeClock = fakeClock();
    const originalTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const originalWindow = global.window;
    const cleanups = [];
    const events = {};
    plugin.register = (cleanup) => cleanups.push(cleanup);
    plugin.registerDomEvent = (_element, event, handler) => { events[event] = handler; };
    try {
      global.setTimeout = runtimeClock.setTimer;
      global.clearTimeout = runtimeClock.clearTimer;
      global.window = {};
      plugin.startAutoSync();
      assert.equal(runtimeClock.delay, 1000);
      await runtimeClock.fire();
      assert.equal(state.writes, 1, 'startup uses the actual automatic pipeline');
      await plugin.saveSettings({ ...plugin.settings, autoSyncEnabled: false });
      assert.equal(runtimeClock.size, 0);
      events.focus();
      assert.equal(runtimeClock.size, 0, 'window focus cannot resume user-disabled automatic sync');
      await plugin.saveSettings({ ...plugin.settings, autoSyncEnabled: true });
      assert.equal(runtimeClock.size, 1);
      cleanups.forEach((cleanup) => cleanup());
      events.online();
      assert.equal(runtimeClock.size, 0, 'unload cleans timer and makes event callbacks inert');
      assert.equal(plugin.autoSyncDisposed, true);
    } finally {
      cleanups.forEach((cleanup) => cleanup());
      global.setTimeout = originalTimeout;
      global.clearTimeout = originalClearTimeout;
      if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
    }
  }

  {
    const { plugin, state } = fixture();
    notices.length = 0;
    const result = await plugin.syncInbox(false, { automatic: true });
    assert.equal(result.pollFailed, false);
    assert.equal(state.requests, 1);
    assert.deepEqual(notices, [], 'empty automatic poll must be completely silent');
    plugin.requestJson = async () => { throw new Error('fixture offline'); };
    const failed = await plugin.syncInbox(false, { automatic: true });
    assert.equal(failed.pollFailed, true, 'caught binding errors must reach the scheduler');
    assert.deepEqual(notices, [], 'background network failure cannot spam Notices');
    await plugin.syncInbox(true);
    assert.ok(notices.length, 'manual sync retains feedback');
  }
  {
    const { plugin } = fixture();
    plugin.settings.apiBase = '';
    notices.length = 0;
    assert.equal((await plugin.syncInbox(false, { automatic: true })).pollFailed, true);
    assert.deepEqual(notices, [], 'background validation failures remain quiet');
  }
  {
    const waiting = { ...record('cloud-waiting'), type: 'voice', metadata: {
      transcriptionMode: 'cloud', transcriptionStatus: 'processing', transcriptionSource: 'cloud-pretranscription',
    } };
    const { plugin, state } = fixture([waiting]);
    notices.length = 0;
    await plugin.syncInbox(false, { automatic: true });
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.writes, 0, 'cloud-waiting records do not start local work');
    assert.deepEqual(notices, [], 'polling the same cloud-waiting record must not repeatedly show progress');
    await plugin.syncInbox(true);
    assert.ok(notices.some((message) => message.includes('云端转写中')), 'manual checks retain the cloud-waiting explanation');
  }
  {
    const { plugin, state } = fixture([record('visible-progress')]);
    const started = deferred();
    const gate = deferred();
    const originalWrite = plugin.writeRecord;
    notices.length = 0;
    noticeInstances.length = 0;
    plugin.writeRecord = async (...args) => {
      plugin.showSyncProgress({ stage: 'downloading', title: 'Fixture recording', current: 1, total: 1 });
      const downloading = plugin.syncProgressNotice;
      assert.ok(downloading, 'automatic downloading must show a persistent progress notice');
      assert.equal(downloading.duration, 0);
      const previousMessage = downloading.message;
      plugin.showSyncProgress({ stage: 'transcribing', title: 'Fixture recording', current: 1, total: 1 });
      assert.equal(plugin.syncProgressNotice, downloading, 'stage changes reuse the same progress notice');
      assert.notEqual(downloading.message, previousMessage);
      started.resolve();
      await gate.promise;
      return originalWrite(...args);
    };
    const automatic = plugin.syncInbox(false, { automatic: true });
    await started.promise;
    const progressNotice = plugin.syncProgressNotice;
    assert.equal(progressNotice.hidden, false);
    const manual = plugin.syncInbox(true);
    assert.ok(notices.at(-1).includes(plugin.lastSyncDiagnostic.message), 'manual click during background work shows the current stage');
    gate.resolve();
    await Promise.all([automatic, manual]);
    assert.equal(state.writes, 1, 'revealing background progress cannot start duplicate work');
    assert.equal(progressNotice.hidden, true, 'completion clears the persistent progress notice');
    assert.equal(plugin.syncProgressNotice, null);
    assert.equal(noticeInstances.filter((item) => item.duration === 0).length, 1);
    const noticeCount = noticeInstances.length;
    plugin.autoSyncDisposed = true;
    plugin.showSyncProgress({ stage: 'transcribing', title: 'Late progress' });
    assert.equal(noticeInstances.length, noticeCount, 'unloaded plugins must not restore progress notices');
  }
  {
    const { plugin, state } = fixture([record('concurrent')]);
    const gate = deferred();
    const originalWrite = plugin.writeRecord;
    plugin.writeRecord = async (...args) => { await gate.promise; return originalWrite(...args); };
    const automatic = plugin.syncInbox(false, { automatic: true });
    const manual = plugin.syncInbox(true);
    gate.resolve();
    await Promise.all([automatic, manual]);
    assert.equal(state.writes, 1);
    assert.equal(state.requests, 1);
    assert.equal(plugin.backgroundSyncActive, false);
  }
  {
    const { plugin, state, clock } = fixture([record('bad')]);
    state.failWrite = true;
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.writes, 1);
    state.records.push(record('new-good'));
    state.failWrite = false;
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.writes, 2, 'deferred failure does not block fresh content');
    clock.advance(RECORD_RETRY_MS);
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.writes, 3, 'transient failed content is retried after cooldown');
  }
  {
    const { plugin, state, clock } = fixture([record('ack-failed')]);
    state.failAck = true;
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.writes, 1);
    assert.equal(state.acknowledgements, 1);
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.acknowledgements, 1, 'completion retries are throttled');
    clock.advance(RECORD_RETRY_MS);
    state.failAck = false;
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.writes, 1, 'a saved local receipt avoids reprocessing after failed cloud acknowledgement');
    assert.equal(state.acknowledgements, 2);
  }
  {
    const { plugin, state } = fixture([record('stop-first'), record('leave-second')]);
    const write = plugin.writeRecord;
    plugin.writeRecord = async (...args) => {
      const result = await write(...args);
      await plugin.saveSettings({ ...plugin.settings, autoSyncEnabled: false });
      return result;
    };
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.writes, 1, 'turning off auto sync finishes only the current record');
    assert.equal(state.persisted.autoSyncEnabled, false);
  }
  {
    const { plugin, state } = fixture([record('stopped')]);
    plugin.currentProcessingAbortController = new AbortController();
    plugin.currentProcessingContext = { recordId: 'stopped', binding: { token: 'ABC-123' } };
    plugin.deleteCurrentTranscriptionRecord = async () => { throw new Error('fixture delete failed'); };
    await plugin.stopCurrentTranscription();
    assert.equal(state.persisted.autoSyncStoppedRecords.length, 1);
    const restarted = fixture([record('stopped')]);
    restarted.plugin.settings = PluginClass.__test.mergeSettings(state.persisted);
    await restarted.plugin.syncInbox(false, { automatic: true });
    assert.equal(restarted.state.writes, 0, 'stopped content stays stopped after plugin restart even when cloud delete failed');
    await restarted.plugin.syncInbox(true);
    assert.equal(restarted.state.writes, 1, 'an explicit manual sync can still recover stopped content');
  }
  {
    const { plugin } = fixture([record('stop-save-race')]);
    const saving = deferred();
    const entered = deferred();
    plugin.saveData = async () => { await saving.promise; };
    plugin.writeRecord = async (_record, _time, _binding, _prefix, progress) => {
      entered.resolve();
      return await new Promise((_resolve, reject) => {
        progress.signal.addEventListener('abort', () => reject(new Error('user stopped')), { once: true });
      });
    };
    plugin.deleteCurrentTranscriptionRecord = async () => ({ deleted: true });
    plugin.backgroundSyncActive = true;
    const syncing = plugin.syncBinding({ token: 'ABC-123' }, false);
    await entered.promise;
    const stopping = plugin.stopCurrentTranscription();
    let finished = false;
    syncing.then(() => { finished = true; });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(finished, false, 'abort recovery waits for the registered persistence/deletion operation');
    saving.resolve();
    await stopping;
    const result = await syncing;
    assert.equal(result.failed.length, 0);
    assert.equal(result.skipped[0].reason, 'deleted-current-transcription');
  }
  {
    const { plugin, state } = fixture([record('busy')]);
    plugin.requestJson = async () => ({ data: state.records, meta: { syncLifecycleStatus: true } });
    plugin.claimSyncRecordProcessing = async () => ({ enabled: true, conflict: true });
    await plugin.syncInbox(false, { automatic: true });
    assert.equal(state.writes, 0, 'another device owning the claim cannot be processed locally');
  }
  {
    const { plugin, clock } = fixture();
    const key = `completion:${plugin.getAutoSyncRecordKey({ token: 'ABC-123' }, 'replay')}`;
    plugin.settings.pendingSyncLifecycleAttempts = [{
      recordId: 'replay', attemptId: 'attempt-123', bindingFingerprint: PluginClass.__test.getSyncLifecycleBindingFingerprint('ABC-123'),
      stage: 'committed', noteTitle: 'saved',
    }];
    let reports = 0;
    plugin.backgroundSyncActive = true;
    plugin.reportSyncRecordCompletion = async () => { reports += 1; throw new Error('fixture retry'); };
    await plugin.replayPendingSyncLifecycleAttempts({ token: 'ABC-123' });
    await plugin.replayPendingSyncLifecycleAttempts({ token: 'ABC-123' });
    assert.equal(reports, 1, 'replaying persisted markers also honors retry cooldown');
    assert.equal(plugin.autoSyncController.canRetry(key), false);
    clock.advance(RECORD_RETRY_MS);
    await plugin.replayPendingSyncLifecycleAttempts({ token: 'ABC-123' });
    assert.equal(reports, 2);
  }
}

(async () => {
  await controllerTests();
  await pluginTests();
  console.log('plugin auto sync: scheduling, lifecycle races, quiet polling, failures, receipts, pause and restart checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
