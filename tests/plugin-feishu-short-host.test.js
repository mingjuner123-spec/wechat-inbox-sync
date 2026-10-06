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
assert.ok(source.includes('const feishuCallbackUrl = `${trimTrailingSlash(FEISHU_OAUTH_SYNC_API_BASE)}/feishu/oauth/callback`;'));
assert.ok(source.includes('const apiBaseForRequest = isFeishuCloudRequest\n      ? FEISHU_OAUTH_SYNC_API_BASE\n      : this.settings.apiBase;'));
assert.equal(Plugin.__test.LOCAL_COMPONENT_DOWNLOAD_HOST, '6865-he02-d8gebzv050ed6c4ef-1428610652.tcb.qcloud.la');
assert.equal(Plugin.__test.LEGACY_LOCAL_COMPONENT_DOWNLOAD_HOST, '6865-he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcb.qcloud.la');
assert.equal(Plugin.__test.LOCAL_COMPONENT_DELIVERY_HOST_CAPABILITY, 'short-native-v1');
const shaFixture = 'a'.repeat(64);
for (const host of [Plugin.__test.LOCAL_COMPONENT_DOWNLOAD_HOST, Plugin.__test.LEGACY_LOCAL_COMPONENT_DOWNLOAD_HOST]) {
  const url = `https://${host}/local-components/by-sha256/${shaFixture}/engine.zip?sign=fixture&t=123`;
  assert.equal(Plugin.__test.isAuthorizedLocalComponentDownloadUrl(url, shaFixture, 'engine.zip'), true);
}
const unknownHostUrl = `https://6865-he02-d8gebzv050ed6c4ef-9999999999.tcb.qcloud.la/local-components/by-sha256/${shaFixture}/engine.zip?sign=fixture&t=123`;
assert.equal(Plugin.__test.isAuthorizedLocalComponentDownloadUrl(unknownHostUrl, shaFixture, 'engine.zip'), false);
const accessPolicy = require('../scripts/check-local-component-access-policy');
const declarations = "const LOCAL_COMPONENT_DOWNLOAD_HOST = '6865-he02-d8gebzv050ed6c4ef-1428610652.tcb.qcloud.la';\nconst LEGACY_LOCAL_COMPONENT_DOWNLOAD_HOST = '6865-he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcb.qcloud.la';";
assert.doesNotThrow(() => accessPolicy.assertNoPublicHost(declarations, true));
assert.throws(() => accessPolicy.assertNoPublicHost(declarations.replace('1428610652', '9999999999'), true));

async function run() {
  const plugin = new Plugin();
  plugin.settings = Plugin.__test.mergeSettings({ token: 'fixture-token', clientId: 'fixture-client' });
  plugin.settings.apiBase = OLD_SYNC_BASE;
  plugin.ensureProFeatureAccess = async () => ({ hasAccess: true, bindingToken: 'fixture-token' });
  plugin.getActiveBindings = () => [{ token: 'fixture-token' }];
  plugin.getConfiguredLocalAsrPlatform = () => 'win32';
  const originalBindings = JSON.stringify(plugin.settings.bindings);
  const originalToken = plugin.settings.token;
  response = { status: 200, json: { success: true, data: { connected: true } } };
  await plugin.requestJson('/feishu/oauth/status', 'GET', {}, { token: 'fixture-token' });
  assert.equal(lastUrl, `${SHORT_SYNC_BASE}/feishu/oauth/status`);
  assert.equal(plugin.settings.apiBase, OLD_SYNC_BASE);
  assert.equal(JSON.stringify(plugin.settings.bindings), originalBindings);
  assert.equal(plugin.settings.token, originalToken);

  const sha = 'a'.repeat(64);
  const ids = ['model', 'ffmpeg', 'whisper', 'whisper-compat'];
  response = { status: 200, json: { success: true, data: {
    schemaVersion: 2, deliveryProtocol: 'cloudbase-v1', component: 'asr', platform: 'win32', arch: 'x64',
    version: 'fixture-v2', expiresAt: new Date(Date.now() + 3600000).toISOString(),
    assets: ids.map((id) => ({
      id, fileName: `${id}.zip`, sha256: sha, byteLength: 1234,
      downloadUrl: `https://${Plugin.__test.LOCAL_COMPONENT_DOWNLOAD_HOST}/local-components/by-sha256/${sha}/${id}.zip?sign=fixture&t=123`,
    })),
  } } };
  const manifest = await plugin.getAuthorizedLocalComponentManifest('asr');
  assert.equal(manifest.assets.length, 4);
  assert.ok(lastUrl.includes('deliveryProtocol=cloudbase-v1'));
  assert.ok(lastUrl.includes('deliveryHost=short-native-v1'));

  response = { status: 200, json: { success: true, data: {
    metadataOnly: true, schemaVersion: 1, component: 'asr', platform: 'win32', arch: 'x64', version: 'fixture-v2',
    assets: [{ id: 'resolver', sha256: sha, byteLength: 1234 }],
  } } };
  await plugin.getAuthorizedLocalComponentManifest('asr', { metadataOnly: true });
  assert.ok(lastUrl.includes('/local-components/version?'));
  assert.equal(lastUrl.includes('deliveryHost='), false);
  console.log('Feishu short host and component host capability fixtures passed');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
