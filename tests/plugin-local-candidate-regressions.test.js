'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');

const notices = [];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      Modal: class Modal {},
      Notice: class Notice {
        constructor(message) { notices.push(String(message)); }
        hide() {}
      },
      requestUrl: async () => ({}),
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main.js';
const PluginClass = require(pluginMainPath);
Module._load = originalLoad;

async function testDouyin403UsesSessionFallback() {
  const plugin = new PluginClass();
  let sessionCalls = 0;
  plugin.downloadArrayBuffer = async () => {
    throw new Error('媒体下载失败：HTTP 403');
  };
  plugin.downloadMediaArrayBufferWithSession = async () => {
    sessionCalls += 1;
    return Buffer.from('ID3-valid-test-audio').buffer;
  };
  plugin.refreshDouyinMediaUrls = async () => [];
  const outputPath = await plugin.downloadMediaToTempFile(
    'https://v3-dy-o.zjcdn.com/example.mp3',
    { sourceUrl: 'https://v.douyin.com/example/' },
  );
  try {
    assert.strictEqual(sessionCalls, 1, '抖音 403 必须使用同一浏览器会话重试');
    assert.strictEqual(fs.existsSync(outputPath), true);
  } finally {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

async function testInvalidBindingIsPausedButGeneric403IsNot() {
  const createPlugin = (message) => {
    const plugin = new PluginClass();
    plugin.settings = PluginClass.__test.mergeSettings({
      token: 'BOUND-1',
      clientId: 'client-1',
      bindings: [{ token: 'BOUND-1', label: '微信 1', enabled: true, status: 'bound' }],
    });
    plugin.showSyncProgress = () => {};
    plugin.clearSyncProgressNotice = () => {};
    plugin.saveData = async () => {};
    plugin.syncBinding = async () => { throw new Error(message); };
    return plugin;
  };

  const invalidPlugin = createPlugin('绑定码未绑定或已失效，请重新绑定');
  await invalidPlugin.syncInbox(false);
  assert.strictEqual(invalidPlugin.settings.bindings[0].status, 'needs_rebind');
  assert.strictEqual(invalidPlugin.settings.bindings[0].enabled, false);

  const genericPlugin = createPlugin('Request failed, status 403');
  await genericPlugin.syncInbox(false);
  assert.strictEqual(genericPlugin.settings.bindings[0].status, 'bound');
  assert.strictEqual(genericPlugin.settings.bindings[0].enabled, true);
}

async function run() {
  const helpers = PluginClass.__test;
  assert.strictEqual(helpers.mergeSettings({}).xiaohongshuImageOcrEnabled, false);
  assert.strictEqual(helpers.mergeSettings({
    settingsVersion: 2,
    xiaohongshuImageOcrEnabled: true,
    xiaohongshuImageOcrConsentVersion: 1,
  }).xiaohongshuImageOcrEnabled, true);
  await testDouyin403UsesSessionFallback();
  await testInvalidBindingIsPausedButGeneric403IsNot();
  console.log('plugin local candidate regression tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
