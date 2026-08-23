'use strict';

const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

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

const pluginMainPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'main.js');
const PluginClass = require(pluginMainPath);
Module._load = originalLoad;
const helpers = PluginClass.__test;

function createPlugin() {
  const plugin = new PluginClass();
  plugin.saveData = async () => {};
  plugin.settings = helpers.mergeSettings({});
  return plugin;
}

async function verifyStatusRefreshNeverInstalls() {
  const plugin = createPlugin();
  let refreshes = 0;
  let prompts = 0;
  let installs = 0;
  plugin.getProFeatureAccessStatus = async () => {
    refreshes += 1;
    return { hasAccess: true, status: 'active' };
  };
  plugin.getLocalTranscriptionComponentReadiness = () => ({ ready: false });
  plugin.confirmLocalComponentInstall = async () => {
    prompts += 1;
    return true;
  };
  plugin.installLocalTranscriptionComponents = async () => {
    installs += 1;
    return { installed: true };
  };

  for (const reason of ['bind', 'settings-open', 'manual-refresh']) {
    const status = await plugin.refreshProAndMaybePromptLocalComponentInstall({ reason, force: true });
    assert.strictEqual(status.hasAccess, true);
  }
  assert.strictEqual(refreshes, 3);
  assert.strictEqual(prompts, 0);
  assert.strictEqual(installs, 0);
}

async function verifyFirstUseInstallsOnlyRequestedComponent({ requireAsr, requireOcr }) {
  const plugin = createPlugin();
  let asrReady = false;
  let ocrReady = false;
  let asrInstalls = 0;
  let ocrInstalls = 0;
  const prompts = [];
  plugin.ensureProFeatureAccess = async () => ({ hasAccess: true });
  plugin.getLocalAsrInstallStatus = () => ({ ready: asrReady });
  plugin.getLocalOcrInstallStatus = () => ({ ready: ocrReady });
  plugin.confirmLocalComponentInstall = async (status, reason, readiness) => {
    prompts.push({ status, reason, readiness });
    return true;
  };
  plugin.installLocalAsr = async () => {
    asrInstalls += 1;
    asrReady = true;
  };
  plugin.installLocalOcr = async () => {
    ocrInstalls += 1;
    ocrReady = true;
  };

  await plugin.ensureLocalComponentReadyForUse('first-use-test', {
    reason: 'first-use',
    requireAsr,
    requireOcr,
  });

  assert.strictEqual(prompts.length, 1);
  assert.strictEqual(prompts[0].reason, 'first-use');
  assert.strictEqual(prompts[0].readiness.missingComponents.length, 1);
  assert.strictEqual(asrInstalls, requireAsr ? 1 : 0);
  assert.strictEqual(ocrInstalls, requireOcr ? 1 : 0);
}

async function verifyImplicitInstallIsNoOp() {
  const plugin = createPlugin();
  plugin.ensureProFeatureAccess = async () => {
    throw new Error('implicit install must not reach entitlement or download logic');
  };
  const result = await plugin.installLocalTranscriptionComponents({ reason: 'manual-refresh' });
  assert.strictEqual(result.installed, false);
  assert.strictEqual(result.skipped, true);
}

(async () => {
  await verifyStatusRefreshNeverInstalls();
  await verifyFirstUseInstallsOnlyRequestedComponent({ requireAsr: true, requireOcr: false });
  await verifyFirstUseInstallsOnlyRequestedComponent({ requireAsr: false, requireOcr: true });
  await verifyImplicitInstallIsNoOp();
  process.stdout.write('plugin local component on-demand tests passed\n');
})().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
