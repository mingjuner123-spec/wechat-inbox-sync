'use strict';

const assert = require('node:assert');
const Module = require('node:module');

const pluginPath = process.env.PLUGIN_MAIN_PATH
  || require.resolve('../obsidian-plugin/wechat-inbox-sync/main.js');
let activeFakeBrowserWindow = null;
let rejectPendingPageApi = null;
let pageApiStarted = null;
let resolvePageApiStarted = null;
const fakeXiaohongshuSession = {
  cookies: {
    async get() { return []; },
  },
  webRequest: {
    onBeforeSendHeaders() {},
    onBeforeRequest() {},
  },
};

class FakeBrowserWindow {
  constructor() {
    this.destroyed = false;
    this.loadHandlers = new Map();
    let executeCount = 0;
    this.webContents = {
      session: fakeXiaohongshuSession,
      debugger: {
        isAttached() { return false; },
        attach() {},
        sendCommand() { return Promise.resolve({}); },
        on() {},
        detach() {},
      },
      on() {},
      once: (event, handler) => {
        this.loadHandlers.set(event, handler);
      },
      removeListener() {},
      setWindowOpenHandler() {},
      executeJavaScript: () => {
        executeCount += 1;
        if (executeCount === 1) {
          const noteId = '6a4ccf88000000001101d145';
          return Promise.resolve({
            html: `<html><script>{"noteDetailMap":{"${noteId}":{"note":{"noteId":"${noteId}","displayTitle":"Abort test","desc":"Enough readable content for the identity check"}}}}</script></html>`,
            url: `https://www.xiaohongshu.com/explore/${noteId}`,
          });
        }
        if (executeCount === 2) {
          if (resolvePageApiStarted) resolvePageApiStarted();
          return new Promise((resolve, reject) => {
            rejectPendingPageApi = reject;
          });
        }
        return Promise.reject(new Error('Object has been destroyed'));
      },
    };
    activeFakeBrowserWindow = this;
  }

  loadURL() {
    const failed = this.loadHandlers.get('did-fail-load');
    if (failed) setImmediate(failed);
    return Promise.resolve();
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (rejectPendingPageApi) rejectPendingPageApi(new Error('Object has been destroyed'));
  }
}

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
  if (request === 'electron') {
    return {
      remote: {
        BrowserWindow: FakeBrowserWindow,
        session: {
          fromPartition() { return fakeXiaohongshuSession; },
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require(pluginPath);
Module._load = function keepElectronMock(request, parent, isMain) {
  if (request === 'electron') {
    return {
      remote: {
        BrowserWindow: FakeBrowserWindow,
        session: {
          fromPartition() { return fakeXiaohongshuSession; },
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
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

async function runAbortedCommentPageDoesNotContinueInBackgroundTest() {
  const previousWindow = global.window;
  global.window = {
    setTimeout,
    clearTimeout,
  };
  pageApiStarted = new Promise((resolve) => {
    resolvePageApiStarted = resolve;
  });
  rejectPendingPageApi = null;
  activeFakeBrowserWindow = null;
  const controller = new AbortController();
  const plugin = new Plugin();
  const noteUrl = 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d145';
  try {
    const renderPromise = plugin.renderXiaohongshuPage(noteUrl, {
      includeComments: true,
      expectedUrl: noteUrl,
      signal: controller.signal,
    });
    await pageApiStarted;
    controller.abort();
    await assert.rejects(
      renderPromise,
      (error) => error && error.name === 'AbortError',
      'aborting while comment pagination is running must terminate the whole comment pipeline',
    );
    assert.strictEqual(activeFakeBrowserWindow.isDestroyed(), true);
  } finally {
    global.window = previousWindow;
    resolvePageApiStarted = null;
    pageApiStarted = null;
    rejectPendingPageApi = null;
    activeFakeBrowserWindow = null;
  }
}

async function runCloudFallbackRequestCanBeAbortedTest() {
  const plugin = new Plugin();
  const binding = { token: 'ABC-123', label: '微信 1' };
  const controller = new AbortController();
  let resolveStarted;
  const started = new Promise((resolve) => {
    resolveStarted = resolve;
  });
  plugin.getActiveBindings = () => [binding];
  plugin.showSyncProgress = () => {};
  plugin.requestJson = async (_path, _method, _body, _binding, options = {}) => {
    assert.strictEqual(options.signal, controller.signal, 'cloud fallback must pass the active AbortSignal into requestJson');
    resolveStarted();
    return await new Promise((resolve, reject) => {
      const fail = () => {
        const error = new Error('current processing stopped');
        error.name = 'AbortError';
        reject(error);
      };
      if (options.signal.aborted) {
        fail();
        return;
      }
      options.signal.addEventListener('abort', fail, { once: true });
    });
  };

  const request = plugin.runCloudFallbackTranscription('https://example.com/audio.mp3', {
    binding,
    allowCloudUrlFallback: true,
    signal: controller.signal,
  });
  await started;
  controller.abort();
  await assert.rejects(
    request,
    (error) => error && error.name === 'AbortError',
    'stopping a cloud fallback request must remain an AbortError instead of becoming a retryable failure',
  );
}

async function runAbortAfterNoteWriteRemovesNewlyCreatedNoteTest() {
  const plugin = new Plugin();
  const controller = new AbortController();
  const files = new Map();
  let resolveWriteStarted;
  let resolveWrite;
  const writeStarted = new Promise((resolve) => {
    resolveWriteStarted = resolve;
  });
  const writeGate = new Promise((resolve) => {
    resolveWrite = resolve;
  });
  plugin.settings = {
    inboxDir: 'Inbox',
    noteSaveMode: 'root',
    notePropertyFields: [],
  };
  plugin.showSyncProgress = () => {};
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => 'Abort write test';
  plugin.nextTitle = async (_dir, title) => title;
  plugin.enrichRecordMetadataWithAi = async (record) => record;
  plugin.app = {
    vault: {
      adapter: {
        async exists(filePath) {
          return files.has(filePath);
        },
        async read(filePath) {
          return files.get(filePath) || '';
        },
        async write(filePath, markdown) {
          resolveWriteStarted();
          await writeGate;
          files.set(filePath, markdown);
        },
        async remove(filePath) {
          files.delete(filePath);
        },
        async rename(fromPath, toPath) {
          if (files.has(toPath)) throw new Error('target exists');
          files.set(toPath, files.get(fromPath));
          files.delete(fromPath);
        },
      },
    },
  };
  const record = {
    _id: 'record-abort-write',
    type: 'text',
    content: 'This note must not remain after the user stops processing.',
    createdAt: '2026-08-09T00:00:00.000Z',
    metadata: {},
  };

  const writePromise = plugin.writeRecord(record, new Date().toISOString(), null, false, {
    signal: controller.signal,
  });
  await writeStarted;
  controller.abort();
  resolveWrite();
  await assert.rejects(writePromise, (error) => error && error.name === 'AbortError');
  assert.deepStrictEqual(Array.from(files.keys()), [], 'a note created by an aborted write must be removed');
}

async function runAbortNeverTouchesConcurrentlyCreatedFinalNoteTest() {
  const plugin = new Plugin();
  const controller = new AbortController();
  const finalPath = 'Inbox/Abort collision test.md';
  const files = new Map();
  let resolveWriteStarted;
  let resolveWrite;
  const writeStarted = new Promise((resolve) => {
    resolveWriteStarted = resolve;
  });
  const writeGate = new Promise((resolve) => {
    resolveWrite = resolve;
  });
  plugin.settings = {
    inboxDir: 'Inbox',
    noteSaveMode: 'root',
    notePropertyFields: [],
  };
  plugin.showSyncProgress = () => {};
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => 'Abort collision test';
  plugin.nextTitle = async (_dir, title) => title;
  plugin.enrichRecordMetadataWithAi = async (record) => record;
  plugin.app = {
    vault: {
      adapter: {
        async exists(filePath) {
          return files.has(filePath);
        },
        async write(filePath, markdown) {
          resolveWriteStarted();
          await writeGate;
          files.set(filePath, markdown);
        },
        async remove(filePath) {
          files.delete(filePath);
        },
        async rename(fromPath, toPath) {
          if (files.has(toPath)) throw new Error('target exists');
          files.set(toPath, files.get(fromPath));
          files.delete(fromPath);
        },
      },
    },
  };
  const record = {
    _id: 'record-abort-collision',
    type: 'text',
    content: 'This pending note must not overwrite the user note.',
    createdAt: '2026-08-09T00:00:00.000Z',
    metadata: {},
  };

  const writePromise = plugin.writeRecord(record, new Date().toISOString(), null, false, {
    signal: controller.signal,
  });
  await writeStarted;
  files.set(finalPath, 'user-created content');
  controller.abort();
  resolveWrite();
  await assert.rejects(writePromise, (error) => error && error.name === 'AbortError');
  assert.strictEqual(files.get(finalPath), 'user-created content');
  assert.deepStrictEqual(
    Array.from(files.keys()).filter((filePath) => filePath.endsWith('.tmp')),
    [],
    'aborting must remove only the unique temporary file',
  );
}

async function run() {
  await runAbortedQueuedBrowserTaskDoesNotDeadlockTest();
  await runAbortedCommentPageDoesNotContinueInBackgroundTest();
  await runCloudFallbackRequestCanBeAbortedTest();
  await runAbortAfterNoteWriteRemovesNewlyCreatedNoteTest();
  await runAbortNeverTouchesConcurrentlyCreatedFinalNoteTest();
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
