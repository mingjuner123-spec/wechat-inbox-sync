const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-failure-experience-'));
os.homedir = () => home;
const notices = [];
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'obsidian') return {
    Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Modal: class {},
    Notice: class { constructor(text) { notices.push(text); } }, requestUrl: async () => ({}),
  };
  return original.call(this, name, ...args);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = original;
const h = Plugin.__test;
const binding = { token: 'ABC-123', label: 'test', status: 'bound', enabled: true };
function fixture(settings = {}) {
  const p = new Plugin();
  p.settings = h.mergeSettings({ apiBase: 'https://example.com/sync', clientId: 'fixture', bindings: [binding], ...settings });
  p.saveData = async () => {};
  p.showSyncProgress = () => {};
  p.clearSyncProgressNotice = () => {};
  p.findExistingRecordNotePath = async () => '';
  p.findRecoveredWechatArticleNotePath = async () => '';
  p.getConfiguredLocalAsrInstallRoot = () => home;
  return p;
}
async function run() {
  let writes = 0, claims = 0, reports = 0, offline = true;
  let row = { _id: 'record-one', type: 'text', content: 'fixture', retryCount: 0, status: 'pending', syncAttemptId: '' };
  function attach(p) {
    p.requestJson = async (route, method, body) => {
      if (route === '/records?status=pending') return { data: [structuredClone(row)], meta: { syncLifecycleStatus: true } };
      if (route.endsWith('/failure-states')) return { success: true, data: { schemaVersion: 1, records: [{ recordId: row._id, status: row.status }] } };
      if (route.endsWith('/synced')) { row.status = 'synced'; return { success: true, data: { id: row._id, status: 'synced', synced: true } }; }
      if (route.endsWith('/status')) {
        if (body.status === 'processing') {
          claims++;
          row.status = 'processing'; row.syncAttemptId = `attempt-${claims}`;
          return { data: { attemptId: row.syncAttemptId } };
        }
        reports++;
        if (offline) throw new Error('network offline');
        if (body.attemptId !== row.syncAttemptId) { const e = new Error('stale attempt'); e.status = 409; e.code = 'RECORD_BUSY'; throw e; }
        row.status = 'failed';
        return { success: true };
      }
      throw new Error(`unexpected route ${route}`);
    };
    p.writeRecord = async () => { writes++; throw Object.assign(new Error('fixture extraction failed'), { code: 'EXTRACTION_FAILED' }); };
  }
  let p = fixture(); attach(p);
  await p.syncInbox(false, { automatic: true });
  assert.equal(writes, 1); assert.equal(claims, 1);
  assert.equal(notices.filter(x => x.includes('同步失败')).length, 1, 'first actual failure is notified');
  const snapshot = structuredClone(p.settings);
  p = fixture(snapshot); attach(p);
  await p.syncInbox(false, { automatic: true });
  await p.syncInbox(true);
  assert.equal(writes, 1, 'restart and manual sync do not retry the failed content');
  assert.equal(claims, 1); assert.ok(reports >= 3, 'only status report is replayed');
  assert.equal(notices.filter(x => x.includes('同步失败')).length, 1);
  assert.equal(p.lastSyncDiagnostic.historicalFailureCount, 1);
  assert.equal(p.lastSyncDiagnostic.status, 'success', 'history does not make a new poll fail');
  assert.equal(row.status, 'processing', 'failed network report did not delete cloud history');

  // A restart immediately after persisting the lifecycle marker, before the
  // recent-failure cache was written, must also avoid reclaiming the lease.
  const pendingOnly = fixture({ ...snapshot, recentSyncFailures: [] }); attach(pendingOnly);
  await pendingOnly.syncInbox(false, { automatic: true });
  assert.equal(writes, 1); assert.equal(claims, 1);

  // Explicit mini-program retry invalidates the old attempt and raises counter.
  offline = false; row = { ...row, status: 'pending', retryCount: 1, syncAttemptId: '' };
  await p.syncInbox(false, { automatic: true });
  assert.equal(writes, 2); assert.equal(claims, 2);
  assert.equal(row.status, 'failed');
  assert.equal(notices.filter(x => x.includes('同步失败')).length, 2, 'new explicit attempt can notify once');
  await p.syncInbox(false, { automatic: true }); // emulate stale/legacy feed
  assert.equal(writes, 2); assert.equal(notices.filter(x => x.includes('同步失败')).length, 2);

  // Resubmitting identical content under a new record ID is a new attempt.
  row = { ...row, _id: 'record-two', status: 'pending', retryCount: 0, syncAttemptId: '' };
  await p.syncInbox(false, { automatic: true });
  assert.equal(writes, 3);
  assert.equal(p.getRecentSyncFailures().length, 2, 'failure records remain in diagnostics');
  assert.equal(typeof p.clearRecentSyncFailures, 'undefined');

  // An unrelated binding must not borrow this binding's failure suppression.
  const other = fixture({ recentSyncFailures: [{ recordId: 'record-two', bindingToken: 'OTHER-456', retryCount: 99 }] }); attach(other);
  await other.syncInbox(true); assert.equal(writes, 4);

  row = { ...row, status: 'pending', retryCount: 1, syncAttemptId: '' };
  p.writeRecord = async record => { writes++; return { recordId: record._id, title: 'fixture success', filePath: 'fixture.md' }; };
  await p.syncInbox(true);
  assert.equal(row.status, 'synced');
  assert.equal(writes, 5);
  assert.equal(p.getRecentSyncFailures().some(item => item.recordId === 'record-two'), false, 'successful retry removes only its obsolete local failure');
  assert.equal(p.getRecentSyncFailures().some(item => item.recordId === 'record-one'), true);

  // Real transcriber failures still propagate; only the speculative stale-heartbeat
  // warning was removed. Missing progress is not interpreted as a failure.
  const msg = h.buildSyncProgressMessage({ stage: 'transcribing', localProgressHeartbeatAt: '2000-01-01T00:00:00Z', localProgressCurrent: 1, localProgressTotal: 3, localProgressStage: 'transcribing' });
  assert.match(msg, /正在转写第 2\/3 段/); assert.doesNotMatch(msg, /无响应|没有启动/);
  assert.equal(h.buildSyncResultNotice([], [], [], [], [{ message: 'historical' }]), '没有需要同步的新内容');
  console.log('failure experience: first notice, restart, status-only replay, manual retry, new record, binding isolation and history preservation passed');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
