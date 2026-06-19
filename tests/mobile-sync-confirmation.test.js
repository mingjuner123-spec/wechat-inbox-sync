const assert = require('assert');
const Module = require('module');
const path = require('path');

const pluginPath = path.resolve(__dirname, '..', 'main.js');
delete require.cache[pluginPath];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    class Plugin {}
    class PluginSettingTab {}
    class Notice {}
    return {
      Notice,
      Plugin,
      PluginSettingTab,
      Setting: class Setting {},
      requestUrl: async () => ({ status: 200, json: { success: true }, text: '{"success":true}' }),
      Platform: { isMobile: true, isDesktop: false, isIosApp: false, isAndroidApp: true },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require(pluginPath);
Module._load = originalLoad;

delete require.cache[pluginPath];

(async () => {
  const plugin = Object.create(Plugin.prototype);
  const syncedCalls = [];
  plugin.settings = { inboxDir: 'Inbox', noteSaveMode: 'root', bindings: [], token: 'ABC-123', apiBase: 'https://example.test', clientId: 'client' };
  plugin.showSyncProgress = () => {};
  plugin.findExistingRecordNotePath = async () => '';
  plugin.requestJson = async (route) => {
    if (route === '/records?status=pending') {
      return {
        success: true,
        data: [
          { _id: 'text-1', id: 'text-1', type: 'text', content: 'hello', createdAt: '2026-06-19T00:00:00.000Z', metadata: {} },
          { _id: 'voice-1', id: 'voice-1', type: 'voice', content: '', createdAt: '2026-06-19T00:00:00.000Z', metadata: {} },
        ],
      };
    }
    if (route.includes('/synced')) syncedCalls.push(route);
    return { success: true };
  };
  plugin.writeRecord = async (record) => ({ recordId: record._id, filePath: `Inbox/${record._id}.md`, title: record._id, conversionWarning: '' });

  const result = await plugin.syncBinding({ token: 'ABC-123', label: 'mobile' }, false);

  assert.deepStrictEqual(result.written.map((item) => item.recordId), ['text-1']);
  assert.strictEqual(result.skipped.some((item) => item.recordId === 'voice-1' && item.reason === 'mobile-unsupported'), true);
  assert.deepStrictEqual(syncedCalls, ['/records/text-1/synced']);
  console.log('mobile sync confirmation checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
