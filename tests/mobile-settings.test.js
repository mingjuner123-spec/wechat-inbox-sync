const assert = require('assert');
const Module = require('module');
const path = require('path');

const pluginPath = path.resolve(__dirname, '..', 'main.js');
delete require.cache[pluginPath];
const originalLoad = Module._load;
const settingCalls = [];
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    class Plugin {}
    class PluginSettingTab {
      constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
      }
    }
    class Notice {}
    class Setting {
      constructor() { settingCalls.push(this); }
      setName() { return this; }
      setDesc() { return this; }
      addText() { return this; }
      addToggle() { return this; }
      addDropdown() { return this; }
      addButton() { return this; }
    }
    return {
      Notice,
      Plugin,
      PluginSettingTab,
      Setting,
      requestUrl: async () => ({ status: 200, json: { success: true }, text: '{"success":true}' }),
      Platform: { isMobile: true, isDesktop: false, isIosApp: false, isAndroidApp: true },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require(pluginPath);
Module._load = originalLoad;
delete require.cache[pluginPath];

const plugin = Object.create(Plugin.prototype);
plugin.settings = Plugin.__test.mergeSettings({ token: 'ABC-123', bindings: [{ token: 'ABC-123', label: 'me', enabled: true, status: 'bound' }] }, '');
plugin.saveSettings = async (next) => { plugin.settings = next; };
plugin.syncInbox = async () => {};
plugin.copySyncDiagnosticText = async () => true;
plugin.unbindBinding = async () => {};
plugin.bindCurrentCode = async () => {};
plugin.getLocalAsrInstallStatus = () => { throw new Error('desktop local ASR check should not render on mobile'); };

const created = [];
const containerEl = {
  empty() {},
  createEl(tag, options) {
    created.push({ tag, options });
    return { createEl() {}, createDiv() {}, setText() {} };
  },
  createDiv(options) {
    created.push({ tag: 'div', options });
    return { createEl() {}, createDiv() {}, setText() {} };
  },
};
const tab = new Plugin.__test.WechatInboxSettingTab({ vault: {} }, plugin);
tab.containerEl = containerEl;
tab.display();

assert.strictEqual(created.some((item) => String((item.options && item.options.text) || '').includes('手机轻量模式')), true);
console.log('mobile settings checks passed');
