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

assert.strictEqual(typeof helpers.buildXiaohongshuLoginPageConfig, 'function');
assert.strictEqual(typeof helpers.isAbortedBrowserNavigationError, 'function');
assert.strictEqual(typeof helpers.installXiaohongshuLoginWindowGuards, 'function');
assert.strictEqual(typeof helpers.bindBrowserWindowToAbortSignal, 'function');

const config = helpers.buildXiaohongshuLoginPageConfig();
assert.strictEqual(config.loginUrl, 'https://www.xiaohongshu.com/');
assert.match(config.userAgent, /Chrome\/\d+/);
assert.strictEqual(/Electron|Obsidian/i.test(config.userAgent), false);

const customConfig = helpers.buildXiaohongshuLoginPageConfig('https://www.xiaohongshu.com/explore/test-note');
assert.strictEqual(customConfig.loginUrl, 'https://www.xiaohongshu.com/explore/test-note');
assert.strictEqual(customConfig.userAgent, config.userAgent);

assert.strictEqual(helpers.isAbortedBrowserNavigationError({ code: -3 }), true);
assert.strictEqual(helpers.isAbortedBrowserNavigationError({ errno: -3 }), true);
assert.strictEqual(helpers.isAbortedBrowserNavigationError({ code: 'ERR_ABORTED', message: '' }), true);
assert.strictEqual(helpers.isAbortedBrowserNavigationError({ code: 'UNKNOWN', errno: -3, message: '' }), true);
assert.strictEqual(helpers.isAbortedBrowserNavigationError(new Error('net::ERR_ABORTED')), true);
assert.strictEqual(helpers.isAbortedBrowserNavigationError({ code: -105, message: 'ERR_NAME_NOT_RESOLVED' }), false);

let windowOpenHandler = null;
helpers.installXiaohongshuLoginWindowGuards({
  on() {},
  setWindowOpenHandler(handler) {
    windowOpenHandler = handler;
  },
});
assert.strictEqual(typeof windowOpenHandler, 'function');
const allowedLoginPopup = windowOpenHandler({
  url: 'https://www.xiaohongshu.com/explore/another-note',
});
assert.strictEqual(
  allowedLoginPopup.action,
  'allow',
  'the visible login window must allow a Xiaohongshu-owned authentication popup',
);
assert.deepStrictEqual(allowedLoginPopup.overrideBrowserWindowOptions.webPreferences, {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});
assert.deepStrictEqual(
  windowOpenHandler({ url: 'https://example.com/' }),
  { action: 'deny' },
  'the visible login window must not let the page spawn external windows',
);

let extractionWindowOpenHandler = null;
helpers.installXiaohongshuNavigationGuards({
  on() {},
  setWindowOpenHandler(handler) {
    extractionWindowOpenHandler = handler;
  },
});
assert.strictEqual(typeof extractionWindowOpenHandler, 'function');
assert.deepStrictEqual(
  extractionWindowOpenHandler({ url: 'https://www.xiaohongshu.com/explore/another-note' }),
  { action: 'deny' },
  'hidden extraction windows must never spawn visible Xiaohongshu child windows',
);

{
  const controller = new AbortController();
  let destroyed = 0;
  const browserWindow = {
    isDestroyed() { return destroyed > 0; },
    destroy() { destroyed += 1; },
  };
  const cleanup = helpers.bindBrowserWindowToAbortSignal(browserWindow, controller.signal);
  controller.abort();
  assert.strictEqual(destroyed, 1, 'aborting the current record must close its active browser window');
  cleanup();
}

console.log('plugin Xiaohongshu login window tests passed');
