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
        pendingReview: {
          total: 1,
          audioVideoCount: 1,
        },
      },
    };
  };

  await plugin.syncInbox(true);

  assert.ok(
    notices.some((message) => message.includes('1 条音频/音视频正在微信安全审核，通过后会自动进入转写')),
    `expected pending review notice, got ${JSON.stringify(notices)}`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
