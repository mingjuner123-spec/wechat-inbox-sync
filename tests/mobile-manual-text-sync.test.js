const assert = require('assert');
const Module = require('module');
const path = require('path');

const pluginPath = path.resolve(__dirname, '..', 'main.js');
delete require.cache[pluginPath];
const originalLoad = Module._load;
const originalWindow = global.window;
const notices = [];
const writes = [];
const syncedCalls = [];
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
    throw new Error(`Desktop-only module loaded during mobile text sync: ${request}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};
global.window = { setTimeout() {} };

(async () => {
  try {
    const Plugin = require(pluginPath);
    const plugin = Object.create(Plugin.prototype);
    plugin.settings = Plugin.__test.mergeSettings({ token: 'ABC-123', inboxDir: 'Inbox', noteSaveMode: 'root', bindings: [{ token: 'ABC-123', label: 'me', enabled: true, status: 'bound' }] }, '');
    plugin.syncStatusBar = null;
    plugin.app = {
      vault: {
        adapter: {
          async exists(targetPath) { return !String(targetPath || '').endsWith('.md'); },
          async mkdir() {},
          async write(filePath, markdown) { writes.push({ filePath, markdown }); },
        },
        getMarkdownFiles() { return []; },
      },
    };
    plugin.requestJson = async (route) => {
      if (route === '/records?status=pending') {
        return { success: true, data: [{ _id: 'text-1', id: 'text-1', type: 'text', content: 'hello from phone', createdAt: '2026-06-19T00:00:00.000Z', metadata: {} }] };
      }
      if (route.includes('/synced')) syncedCalls.push(route);
      return { success: true };
    };
    await plugin.syncInbox(true);
    assert.strictEqual(writes.length, 1);
    assert.deepStrictEqual(syncedCalls, ['/records/text-1/synced']);
    assert.strictEqual(notices.some((message) => message.includes('同步') || message.includes('Obsidian')), true);
    console.log('mobile manual text sync checks passed');
  } finally {
    Module._load = originalLoad;
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
    delete require.cache[pluginPath];
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

