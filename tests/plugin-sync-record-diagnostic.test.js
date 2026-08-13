const assert = require('assert');
const Module = require('module');

const notices = [];
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    class Plugin {}
    class Notice {
      constructor(message) {
        notices.push(String(message));
      }
      hide() {}
    }
    return {
      App: class {},
      Plugin,
      PluginSettingTab: class {},
      Setting: class {},
      Notice,
      TFile: class {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: async () => ({ status: 200, json: {} }),
      MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main.js';
const PluginClass = require(pluginMainPath);

async function run() {
  notices.length = 0;
  const plugin = new PluginClass();
  plugin.app = { vault: {}, metadataCache: {} };
  plugin.settings = PluginClass.__test.mergeSettings({
    token: 'token',
    clientId: 'client',
    bindings: [],
  });
  plugin.getActiveBindings = () => [{ token: 'token', clientId: 'client', label: '微信 1' }];
  plugin.showSyncProgress = () => {};
  plugin.clearSyncProgress = () => {};
  plugin.requestJson = async (path) => {
    assert.strictEqual(path, '/records?status=pending');
    return {
      success: true,
      data: [],
      meta: {
        syncSnapshot: {
          schemaVersion: 1,
          examinedCount: 2,
          returnedCount: 0,
          truncated: false,
          counts: {
            securityReview: 0,
            processing: 1,
            failed: 0,
            alreadySynced: 1,
            deduplicated: 0,
            other: 0,
          },
          records: [
            {
              recordId: 'record-processing-1',
              type: 'voice',
              status: 'processing',
              sourcePlatform: 'voice',
              mediaType: 'audio',
              transcriptionStatus: 'processing',
              filterReason: 'processing',
              createdAt: '2026-08-13T01:02:03.000Z',
              updatedAt: '2026-08-13T01:03:03.000Z',
              openid: 'should-not-leak',
              token: 'should-not-leak',
              url: 'https://secret.example/path',
              body: 'private text',
            },
            {
              recordId: 'record-synced-1',
              type: 'webpage',
              status: 'pending',
              sourcePlatform: 'douyin',
              mediaType: 'audio_video',
              transcriptionStatus: 'not_required',
              filterReason: 'already-synced',
              createdAt: '2026-08-13T02:02:03.000Z',
              updatedAt: '2026-08-13T02:03:03.000Z',
            },
          ],
        },
      },
    };
  };

  await plugin.syncInbox(false);

  const diagnostic = plugin.lastSyncDiagnostic;
  assert.strictEqual(diagnostic.status, 'success');
  assert.ok(Array.isArray(diagnostic.syncSnapshots));
  assert.strictEqual(diagnostic.syncSnapshots.length, 1);
  assert.deepStrictEqual(diagnostic.syncSnapshots[0].counts, {
    securityReview: 0,
    processing: 1,
    failed: 0,
    alreadySynced: 1,
    deduplicated: 0,
    other: 0,
  });
  assert.deepStrictEqual(
    diagnostic.syncSnapshots[0].records.map((record) => ({
      recordId: record.recordId,
      sourcePlatform: record.sourcePlatform,
      filterReason: record.filterReason,
    })),
    [
      {
        recordId: 'record-processing-1',
        sourcePlatform: 'voice',
        filterReason: 'processing',
      },
      {
        recordId: 'record-synced-1',
        sourcePlatform: 'douyin',
        filterReason: 'already-synced',
      },
    ],
  );
  const serialized = JSON.stringify(diagnostic);
  assert.strictEqual(serialized.includes('should-not-leak'), false);
  assert.strictEqual(serialized.includes('secret.example'), false);
  assert.strictEqual(serialized.includes('private text'), false);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
