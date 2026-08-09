'use strict';

const assert = require('node:assert');
const Module = require('node:module');

const pluginPath = process.env.PLUGIN_MAIN_PATH
  || require.resolve('../obsidian-plugin/wechat-inbox-sync/main.js');
const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal: class Modal {},
      Notice: class Notice {},
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: async () => ({}),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require(pluginPath);
Module._load = originalLoad;
const helpers = Plugin.__test;

async function runAbortedQueuedBrowserTaskDoesNotDeadlockTest() {
  let releaseFirstTask;
  let firstTaskStarted;
  const firstStarted = new Promise((resolve) => {
    firstTaskStarted = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirstTask = resolve;
  });
  const firstTask = helpers.runWithXiaohongshuBrowserSessionLock(async () => {
    firstTaskStarted();
    await firstGate;
  });
  await firstStarted;

  const queuedController = new AbortController();
  const queuedTask = helpers.runWithXiaohongshuBrowserSessionLock(
    async () => assert.fail('an aborted queued task must never start'),
    queuedController.signal,
  );
  queuedController.abort();
  await assert.rejects(queuedTask, (error) => error && error.name === 'AbortError');

  let followingTaskStarted = false;
  const followingTask = helpers.runWithXiaohongshuBrowserSessionLock(async () => {
    followingTaskStarted = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(followingTaskStarted, false, 'the following task must still wait for the active owner');

  releaseFirstTask();
  await firstTask;
  const followingOutcome = await Promise.race([
    followingTask.then(() => 'started'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
  ]);
  assert.strictEqual(followingOutcome, 'started', 'aborting a queued task must not deadlock later tasks');
}

async function run() {
  await runAbortedQueuedBrowserTaskDoesNotDeadlockTest();
  const plugin = new Plugin();
  const binding = { token: 'ABC-123', label: '微信 1' };
  const record = {
    _id: 'record-xhs-stop',
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/stop-test',
    metadata: { url: 'https://www.xiaohongshu.com/explore/stop-test' },
  };
  plugin.settings = {
    locallyQuarantinedRecordIds: [],
  };
  plugin.showSyncProgress = () => {};
  plugin.setTranscriptionStopAvailable = () => {};
  plugin.findExistingRecordNotePath = async () => '';

  let resolveWriteStarted;
  const writeStarted = new Promise((resolve) => {
    resolveWriteStarted = resolve;
  });
  let receivedSignal = null;
  plugin.writeRecord = async (_record, _syncedAt, _binding, _prefix, progress = {}) => {
    receivedSignal = progress.signal || null;
    resolveWriteStarted();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(receivedSignal, 'syncBinding must pass the per-record AbortSignal into writeRecord');
    return await new Promise((resolve, reject) => {
      const fail = () => {
        const error = new Error('current processing stopped');
        error.name = 'AbortError';
        reject(error);
      };
      if (receivedSignal.aborted) {
        fail();
        return;
      }
      receivedSignal.addEventListener('abort', fail, { once: true });
    });
  };
  plugin.requestJson = async (requestPath) => {
    if (requestPath === '/records?status=pending') {
      return { data: [record] };
    }
    if (requestPath === '/records/record-xhs-stop/synced') {
      return { data: { id: record._id, status: 'deleted' } };
    }
    throw new Error(`unexpected request: ${requestPath}`);
  };

  const syncPromise = plugin.syncBinding(binding, false);
  await writeStarted;
  const stopPromise = plugin.stopCurrentTranscription();
  const [result] = await Promise.all([syncPromise, stopPromise]);

  assert.strictEqual(receivedSignal.aborted, true);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(result.skipped.map((item) => item.reason), ['deleted-current-transcription']);
}

run().then(() => {
  console.log('plugin processing cancellation tests passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
