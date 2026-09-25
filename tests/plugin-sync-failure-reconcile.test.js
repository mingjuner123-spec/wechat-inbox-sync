'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let Plugin;
try {
  Module._load = function loadWithObsidianStub(name, ...args) {
    if (name === 'obsidian') {
      return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Setting: class {}, Notice: class {} };
    }
    return originalLoad.call(this, name, ...args);
  };
  Plugin = require('../obsidian-plugin/wechat-inbox-sync/main.js');
} finally {
  Module._load = originalLoad;
}

function runResult() {
  return {
    written: [], failed: [], skipped: [], conversionWarnings: [],
    completionWarnings: [], pendingReview: {},
  };
}

async function main() {
  const resolveIds = Plugin.__test.getDurablyResolvedFailureRecordIds;
  const states = {
    success: 'synced',
    duplicateSuccess: 'synced-via-content-identity',
    pending: 'pending',
    processing: 'processing',
    deleted: 'deleted',
    securityPending: 'security_pending',
    securitySubmitting: 'security_submitting',
    failed: 'failed',
    absent: 'absent',
    unknown: 'unknown',
  };
  const requested = Object.keys(states);
  assert.deepStrictEqual(
    resolveIds(requested, { success: true, data: { schemaVersion: 1, records: requested.map((recordId) => ({ recordId, status: states[recordId] })) } }),
    ['success', 'duplicateSuccess'],
  );
  assert.deepStrictEqual(resolveIds(['one'], { success: true, data: { schemaVersion: 1, records: [{ recordId: 'one', status: 'synced' }, { recordId: 'one', status: 'synced' }] } }), []);
  assert.deepStrictEqual(resolveIds(['one', 'two'], { success: true, data: { schemaVersion: 1, records: [{ recordId: 'one', status: 'synced' }] } }), []);
  assert.deepStrictEqual(resolveIds(['one'], { success: true, data: { schemaVersion: 1, records: [{ recordId: 'other', status: 'synced' }] } }), []);
  assert.deepStrictEqual(resolveIds(['../one'], { success: true, data: { schemaVersion: 1, records: [{ recordId: '../one', status: 'synced' }] } }), []);
  assert.deepStrictEqual(resolveIds(['one'], { data: { schemaVersion: 1, records: [{ recordId: 'one', status: 'synced' }] } }), []);
  assert.deepStrictEqual(resolveIds(['one'], { success: false, data: { schemaVersion: 1, records: [{ recordId: 'one', status: 'synced' }] } }), []);
  assert.deepStrictEqual(resolveIds(['one'], { success: true, data: { records: [{ recordId: 'one', status: 'synced' }] } }), []);
  assert.deepStrictEqual(resolveIds(['one'], { success: true, data: { schemaVersion: 2, records: [{ recordId: 'one', status: 'synced' }] } }), []);

  const bindingA = { token: 'AAA-111', label: '设备 A', enabled: true, status: 'bound' };
  const bindingB = { token: 'BBB-222', label: '设备 B', enabled: true, status: 'bound' };
  const recordId = 'same-old-failed-record';
  const plugin = new Plugin();
  plugin.settings = Plugin.__test.mergeSettings({
    token: bindingA.token,
    bindings: [bindingA, bindingB],
    recentSyncFailures: [
      { recordId, bindingToken: bindingA.token, message: 'failure A' },
      { recordId, bindingToken: bindingB.token, message: 'failure B' },
    ],
    recentSyncFailureCleanupErrors: [
      { recordId, bindingToken: bindingA.token, reason: 'cleanup A' },
      { recordId, bindingToken: bindingB.token, reason: 'cleanup B' },
    ],
  });
  plugin.saveData = async () => {};
  plugin.getActiveBindings = () => [bindingA, bindingB];
  plugin.syncBinding = async () => runResult();
  plugin.showSyncProgress = () => {};
  plugin.clearSyncProgressNotice = () => {};
  plugin.getConfiguredLocalAsrInstallRoot = () => '';
  plugin.getRecentXiaohongshuCommentResults = () => [];
  plugin.getRecentXiaohongshuBrowserResults = () => [];
  plugin.findExistingRecordNotePath = async () => '';
  const calls = [];
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push({ path, method, body, binding: binding.token });
    return {
      success: true,
      data: { schemaVersion: 1, records: body.recordIds.map((id) => ({
        recordId: id,
        status: binding.token === bindingA.token ? 'synced-via-content-identity' : 'failed',
      })) },
    };
  };
  await plugin.runSyncInboxOnce(false);
  assert.deepStrictEqual(calls.map((call) => call.binding), [bindingA.token, bindingB.token]);
  assert.deepStrictEqual(plugin.getRecentSyncFailures().map((item) => item.bindingToken), [bindingB.token]);
  assert.deepStrictEqual(plugin.getRecentSyncFailureCleanupErrors().map((item) => item.bindingToken), [bindingB.token]);

  const rollbackPlugin = new Plugin();
  rollbackPlugin.settings = Plugin.__test.mergeSettings({
    token: bindingA.token,
    bindings: [bindingA],
    recentSyncFailures: [{ recordId, bindingToken: bindingA.token, message: 'failure' }],
    recentSyncFailureCleanupErrors: [{ recordId, bindingToken: bindingA.token, reason: 'cleanup failed' }],
  });
  const originalSettings = rollbackPlugin.settings;
  rollbackPlugin.saveData = async () => { throw new Error('disk full'); };
  await assert.rejects(
    rollbackPlugin.updateRecentSyncFailures({ resolved: [{ recordId, bindingToken: bindingA.token }] }),
    /disk full/,
  );
  assert.strictEqual(rollbackPlugin.settings, originalSettings);
  assert.equal(rollbackPlugin.getRecentSyncFailures().length, 1);
  assert.equal(rollbackPlugin.getRecentSyncFailureCleanupErrors().length, 1);

  const failClosed = new Plugin();
  failClosed.settings = Plugin.__test.mergeSettings({
    token: bindingA.token,
    bindings: [bindingA],
    recentSyncFailures: [{ recordId, bindingToken: bindingA.token, message: 'failure' }],
  });
  failClosed.saveData = async () => {};
  failClosed.getActiveBindings = () => [bindingA];
  failClosed.syncBinding = async () => runResult();
  failClosed.showSyncProgress = () => {};
  failClosed.clearSyncProgressNotice = () => {};
  failClosed.getConfiguredLocalAsrInstallRoot = () => '';
  failClosed.getRecentXiaohongshuCommentResults = () => [];
  failClosed.getRecentXiaohongshuBrowserResults = () => [];
  failClosed.findExistingRecordNotePath = async () => '';
  failClosed.requestJson = async () => { throw new Error('endpoint unavailable'); };
  await failClosed.runSyncInboxOnce(false);
  assert.equal(failClosed.getRecentSyncFailures().length, 1);

  console.log('Plugin failure reconciliation success-only, identity isolation, stale cleanup errors, malformed responses and rollback passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
