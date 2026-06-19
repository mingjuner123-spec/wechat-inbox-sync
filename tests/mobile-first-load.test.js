const assert = require('assert');
const Module = require('module');
const path = require('path');

const pluginPath = path.resolve(__dirname, '..', 'main.js');
delete require.cache[pluginPath];
const originalLoad = Module._load;
const originalWindow = global.window;
const originalCrypto = global.crypto;
const blocked = new Set(['crypto', 'fs', 'path', 'child_process', 'http', 'https', 'os', 'zlib', 'electron']);
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    class Plugin {
      addCommand() {}
      addRibbonIcon() {}
      addSettingTab() {}
      addStatusBarItem() { return { setText() {} }; }
      async loadData() { return null; }
      async saveData() {}
    }
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
  if (blocked.has(request)) {
    throw new Error(`Desktop-only module loaded on first mobile onload: ${request}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};
global.window = { setTimeout() {} };
global.crypto = {
  getRandomValues(array) {
    for (let index = 0; index < array.length; index += 1) array[index] = (index * 17 + 23) & 0xff;
    return array;
  },
};

(async () => {
  try {
    const Plugin = require(pluginPath);
    const plugin = new Plugin();
    await plugin.onload();
    assert.strictEqual(typeof plugin.settings.clientId, 'string');
    assert.strictEqual(plugin.settings.clientId.startsWith('obsidian-'), true);
    console.log('mobile first load checks passed');
  } finally {
    Module._load = originalLoad;
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
    if (originalCrypto === undefined) delete global.crypto; else global.crypto = originalCrypto;
    delete require.cache[pluginPath];
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
