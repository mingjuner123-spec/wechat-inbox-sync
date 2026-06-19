const assert = require('assert');
const Module = require('module');
const path = require('path');

const pluginPath = path.resolve(__dirname, '..', 'main.js');

function loadPluginWithBlockedDesktopModules() {
  delete require.cache[pluginPath];
  const originalLoad = Module._load;
  const blocked = new Set(['fs', 'path', 'child_process', 'http', 'https', 'os', 'zlib', 'electron']);
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
      throw new Error(`Desktop-only module loaded during mobile import: ${request}`);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(pluginPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[pluginPath];
  }
}

const Plugin = loadPluginWithBlockedDesktopModules();
assert.strictEqual(typeof Plugin, 'function');
assert.strictEqual(Plugin.__test.isMobileRuntime({ isMobile: true }), true);
assert.strictEqual(Plugin.__test.isDesktopRuntime({ isMobile: true }), false);
assert.strictEqual(Plugin.__test.isMobileSafeRecord({ type: 'text' }), true);
assert.strictEqual(Plugin.__test.isMobileSafeRecord({ type: 'webpage', metadata: { platform: '公众号', contentCategory: '图文' } }), true);
assert.strictEqual(Plugin.__test.isMobileSafeRecord({ type: 'voice' }), false);
assert.strictEqual(Plugin.__test.isMobileSafeRecord({ type: 'file' }), false);
console.log('mobile compatibility checks passed');
