'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
let response;
let lastUrl = '';
const originalLoad = Module._load;
Module._load = function load(name, parent, isMain) {
  if (name === 'obsidian') {
    return {
      Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {},
      Notice: class {},
      requestUrl: async (options) => { lastUrl = options.url; return response; },
    };
  }
  if (/\.(?:ps1|sh|py)$/.test(name) && parent && parent.filename) {
    return fs.readFileSync(path.resolve(path.dirname(parent.filename), name), 'utf8');
  }
  return originalLoad.call(this, name, parent, isMain);
};
let Plugin;
try {
  Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');
} finally {
  Module._load = originalLoad;
}
const SHORT_SYNC_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';
const OLD_SYNC_BASE = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync';
const source = fs.readFileSync(path.join(__dirname, '../obsidian-plugin/wechat-inbox-sync/src/main.js'), 'utf8').replace(/\r\n/g, '\n');
assert.ok(source.includes('const FEISHU_OAUTH_SYNC_API_BASE = OFFICIAL_SYNC_API_BASE;'));
assert.match(source, /feishuCallbackUrl\s*=.*FEISHU_OAUTH_SYNC_API_BASE.*\/feishu\/oauth\/callback/);
assert.match(source, /const apiBaseForRequest = isFeishuCloudRequest\s*\?\s*FEISHU_OAUTH_SYNC_API_BASE\s*:\s*this\.settings\.apiBase;/);

async function run() {
  const plugin = new Plugin();
  plugin.settings = Plugin.__test.mergeSettings({ token: 'fixture-token', clientId: 'fixture-client' });
  plugin.settings.apiBase = OLD_SYNC_BASE;
  const originalBindings = JSON.stringify(plugin.settings.bindings);
  const originalToken = plugin.settings.token;
  response = { status: 200, json: { success: true, data: { connected: true } } };

  await plugin.requestJson('/feishu/oauth/status', 'GET', {}, { token: 'fixture-token' });
  assert.equal(lastUrl, SHORT_SYNC_BASE + '/feishu/oauth/status');
  assert.equal(plugin.settings.apiBase, OLD_SYNC_BASE, 'known old official API base remains saved');
  assert.equal(JSON.stringify(plugin.settings.bindings), originalBindings);
  assert.equal(plugin.settings.token, originalToken);

  const customApiBase = 'https://custom.example.org/sync';
  plugin.settings.apiBase = customApiBase;
  await plugin.requestJson('/feishu/oauth/status', 'GET', {}, { token: 'fixture-token' });
  assert.equal(lastUrl, SHORT_SYNC_BASE + '/feishu/oauth/status');
  assert.equal(plugin.settings.apiBase, customApiBase, 'Feishu routing must not rewrite a custom saved API base');
  await plugin.requestJson('/health', 'GET', {}, { token: 'fixture-token' });
  assert.equal(lastUrl, customApiBase + '/health', 'non-Feishu requests keep using the custom API base');
  assert.equal(JSON.stringify(plugin.settings.bindings), originalBindings);
  assert.equal(plugin.settings.token, originalToken);

  console.log('Feishu short host, callback reference, and user-setting preservation passed');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });