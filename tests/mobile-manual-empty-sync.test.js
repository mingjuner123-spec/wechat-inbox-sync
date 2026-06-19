const assert = require('assert');
const Module = require('module');
const path = require('path');

const pluginPath = path.resolve(__dirname, '..', 'main.js');
delete require.cache[pluginPath];
const originalLoad = Module._load;
const originalWindow = global.window;
const notices = [];
const blocked = new Set(['crypto', 'fs', 'path', 'child_process', 'http', 'https', 'os', 'zlib', 'electron']);
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    class Plugin {}
    class PluginSettingTab {}
    class Notice {
      constructor(message) { notices.push(String(message || '')); }
      setMessage(message) { notices.push(String(message || '')); }
      hide() {}
    }
    return {
      Notice,
      Plugin,
      PluginSettingTab,
      Setting: class Setting {},
      requestUrl: async () => ({ status: 200, json: { success: true }, text: '{"success":true}' }),
      Platform: { isMobile: true, isDesktop: false, isIosApp: false, isAndroidApp: true },
    };
  }
  if (blocked.has(request)) {
    throw new Error(`Desktop-only module loaded during mobile manual sync: ${request}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};
global.window = { setTimeout() {} };

(async () => {
  try {
    const Plugin = require(pluginPath);
    const plugin = Object.create(Plugin.prototype);
    plugin.settings = Plugin.__test.mergeSettings({ token: 'ABC-123', bindings: [{ token: 'ABC-123', label: 'me', enabled: true, status: 'bound' }] }, '');
    plugin.syncStatusBar = null;
    plugin.requestJson = async (route) => {
      assert.strictEqual(route, '/records?status=pending');
      return { success: true, data: [] };
    };
    await plugin.syncInbox(true);
    assert.strictEqual(notices.length > 0, true);
    assert.strictEqual(notices.some((message) => message.includes('没有') || message.includes('同步')), true);
    console.log('mobile manual empty sync checks passed');
  } finally {
    Module._load = originalLoad;
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
    delete require.cache[pluginPath];
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
