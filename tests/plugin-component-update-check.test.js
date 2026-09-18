'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'obsidian') return {
    Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {},
    requestUrl: async () => { throw new Error('Unexpected network'); },
  };
  return originalLoad.call(this, name, ...args);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-update-test-'));
let checks = 0;

function fixture(platform) {
  const p = new Plugin();
  p.settings = Plugin.__test.mergeSettings({});
  p.saveData = async () => {};
  p.getProFeatureAccessStatus = p.ensureProFeatureAccess = async () => ({ hasAccess: true });
  p.getConfiguredLocalAsrPlatform = () => platform;
  p.getLocalDouyinResolverRoot = () => path.join(root, platform);
  p.recoverExistingLocalAsrInstall = async () => ({ status: 'none' });
  p.showLocalComponentInstallFailure = async () => {};
  const state = { bytes: Buffer.from('resolver v1'), requests: 0, downloads: 0, prompts: 0, accepted: true };
  const asset = () => ({ id: 'resolver', downloadUrl: 'https://example.invalid/resolver',
    sha256: crypto.createHash('sha256').update(state.bytes).digest('hex'), byteLength: state.bytes.length });
  p.getAuthorizedLocalComponentManifest = async () => {
    state.requests++;
    return { version: 'fixture', expiresAt: new Date(Date.now() + 3600000).toISOString(), assets: [asset()] };
  };
  p.getOfficialLocalDouyinResolverManifest = async () => { throw Object.assign(new Error('unavailable'), { code: 'ETIMEDOUT' }); };
  p.downloadLocalDouyinResolverAsset = async () => { state.downloads++; return state.bytes; };
  p.getLocalTranscriptionComponentReadiness = () => ({
    asrStatus: { ready: true }, ocrStatus: { ready: true }, resolverStatus: p.getLocalDouyinResolverInstallStatus(),
  });
  p.confirmLocalComponentInstall = async () => { state.prompts++; return state.accepted; };
  p.installLocalAsr = p.installLocalOcr = async () => { throw new Error('Healthy component must be reused'); };
  return { p, state };
}

async function run() {
  for (const platform of ['win32', 'darwin']) {
    const { p, state } = fixture(platform);
    const installed = await p.ensureLocalDouyinResolver();
    const originalBytes = fs.readFileSync(installed.executablePath);
    state.downloads = 0;
    for (let i = 0; i < 2; i++) {
      const status = await p.refreshProAndMaybePromptLocalComponentInstall({ reason: 'manual-refresh', force: true });
      assert.equal(status.localComponentsUpToDate, true);
      assert.equal(status.localComponentRefreshPlan.hasRequiredChanges, false);
      assert.equal(state.prompts, 0);
      assert.equal(state.downloads, 0);
      checks++;
    }

    // Checking a different hash must not install before confirmation.
    state.bytes = Buffer.from('resolver v2');
    state.accepted = false;
    let status = await p.refreshProAndMaybePromptLocalComponentInstall({ reason: 'manual-refresh', force: true });
    assert.equal(status.localComponentsUpToDate, false);
    assert.equal(status.localComponentInstallSkipped.reason, 'user-declined');
    assert.equal(state.prompts, 1);
    assert.equal(state.downloads, 0);
    assert.deepEqual(fs.readFileSync(installed.executablePath), originalBytes);
    checks++;

    // Accepting reuses the checked manifest instead of spending a second request.
    state.accepted = true;
    state.requests = 0;
    status = await p.refreshProAndMaybePromptLocalComponentInstall({ reason: 'manual-refresh', force: true });
    assert.equal(state.requests, 1);
    assert.equal(state.downloads, 1);
    assert.equal(status.localComponentInstallResult.installed, true);
    assert.deepEqual(fs.readFileSync(installed.executablePath), state.bytes);
    checks++;
    status = await p.refreshProAndMaybePromptLocalComponentInstall({ reason: 'manual-refresh', force: true });
    assert.equal(status.localComponentsUpToDate, true);
    assert.equal(state.prompts, 2);
    assert.equal(state.downloads, 1);
    checks++;

    // An expired prechecked URL is reauthorized before download, never used or bypassed.
    const checked = await p.doInstallLocalDouyinResolver({ checkOnly: true });
    const expiredAsset = { ...checked.asset, expiresAt: new Date(Date.now() - 1).toISOString() };
    state.requests = 0;
    await p.doInstallLocalDouyinResolver({ force: true, checkedAsset: expiredAsset });
    assert.equal(state.requests, 1);
    assert.equal(state.downloads, 1);
    const nearExpiryAsset = { ...checked.asset, expiresAt: new Date(Date.now() + 10000).toISOString() };
    state.requests = 0;
    await p.doInstallLocalDouyinResolver({ force: true, checkedAsset: nearExpiryAsset });
    assert.equal(state.requests, 1);
    assert.equal(state.downloads, 1);
    checks++;

    // Network or authorization failure cannot be reported as up to date.
    const installedBytes = fs.readFileSync(installed.executablePath);
    for (const failure of [{ code: 'ETIMEDOUT' }, { status: 403 }, { code: 'COMPONENT_DOWNLOAD_RATE_LIMITED' }]) {
      p.getAuthorizedLocalComponentManifest = async () => { throw Object.assign(new Error('synthetic failure'), failure); };
      status = await p.refreshProAndMaybePromptLocalComponentInstall({ reason: 'manual-refresh', force: true });
      assert.equal(status.localComponentsUpToDate, false);
      assert.ok(status.localComponentUpdateCheckError);
      assert.equal(state.prompts, 2);
      assert.equal(state.downloads, 1);
      assert.deepEqual(fs.readFileSync(installed.executablePath), installedBytes);
      checks++;
    }
  }
  // A request to check is never evidence that an update exists.
  const ready = { asrStatus: { ready: true }, ocrStatus: { ready: true }, resolverStatus: { ready: true } };
  assert.equal(Plugin.__test.buildLocalComponentRefreshPlan(ready, { checkResolverUpdates: true }).hasUpdates, false);
  assert.equal(Plugin.__test.buildLocalComponentRefreshPlan(ready, { resolverUpdateAvailable: true }).hasUpdates, true);
  checks++;
  console.log('Component update check passed: ' + checks);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir())) throw new Error('Unsafe cleanup path');
  fs.rmSync(root, { recursive: true, force: true });
});
