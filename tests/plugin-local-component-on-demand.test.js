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
  plugin.recoverExistingLocalAsrInstall = async () => ({ status: 'none' });
  return plugin;
}

async function verifyPassiveRefreshPromptsOnceAndInstallsOnlyMissingComponents() {
  const plugin = createPlugin();
  let refreshes = 0;
  let prompts = 0;
  let installedOcr = false;
  const installOptions = [];
  plugin.getProFeatureAccessStatus = async () => {
    refreshes += 1;
    return { hasAccess: true, status: 'active' };
  };
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: installedOcr,
    missingComponents: installedOcr ? [] : ['OCR'],
    asrStatus: { ready: true },
    ocrStatus: { ready: installedOcr },
  });
  plugin.confirmLocalComponentInstall = async () => {
    prompts += 1;
    return true;
  };
  plugin.installLocalTranscriptionComponents = async (options) => {
    installOptions.push(options);
    installedOcr = true;
    return {
      installed: true,
      reason: options.reason,
      readiness: plugin.getLocalTranscriptionComponentReadiness(),
    };
  };

  const bindStatus = await plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'bind', force: true });
  assert.strictEqual(bindStatus.hasAccess, true);
  assert.strictEqual(bindStatus.localComponentReadiness.ready, true);
  assert.strictEqual(bindStatus.localComponentInstallResult.installed, true);

  const settingsStatus = await plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open', force: true });
  assert.strictEqual(settingsStatus.hasAccess, true);
  assert.strictEqual(settingsStatus.localComponentReadiness.ready, true);

  assert.strictEqual(refreshes, 2);
  assert.strictEqual(prompts, 1);
  assert.strictEqual(installOptions.length, 1);
  assert.strictEqual(installOptions[0].reason, 'bind');
  assert.strictEqual(installOptions[0].requireAsr, false);
  assert.strictEqual(installOptions[0].requireOcr, true);
  assert.strictEqual(installOptions[0].forceAsr, false);
  assert.strictEqual(installOptions[0].forceOcr, false);
}

async function verifyCachedEntitlementStillChecksLocalComponents() {
  const plugin = createPlugin();
  plugin.settings = helpers.mergeSettings({
    proSetupLastCheckedAt: new Date().toISOString(),
    localTranscriptionEntitlementStatus: {
      hasAccess: true,
      status: 'active',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });
  let prompts = 0;
  let installs = 0;
  plugin.getProFeatureAccessStatus = async () => {
    throw new Error('fresh entitlement cache should avoid a cloud permission request');
  };
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: false,
    missingComponents: ['OCR'],
    asrStatus: { ready: true },
    ocrStatus: { ready: false },
  });
  plugin.confirmLocalComponentInstall = async () => {
    prompts += 1;
    return true;
  };
  plugin.installLocalTranscriptionComponents = async (options) => {
    installs += 1;
    assert.strictEqual(options.requireAsr, false);
    assert.strictEqual(options.requireOcr, true);
    return {
      installed: true,
      readiness: {
        ready: true,
        missingComponents: [],
        asrStatus: { ready: true },
        ocrStatus: { ready: true },
      },
    };
  };

  const status = await plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open' });
  assert.strictEqual(status.hasAccess, true);
  assert.strictEqual(prompts, 1);
  assert.strictEqual(installs, 1);
}

async function verifyDeclinedOrFailedAutomaticPromptDoesNotLoop() {
  for (const outcome of ['declined', 'failed']) {
    const plugin = createPlugin();
    let prompts = 0;
    let installs = 0;
    plugin.getProFeatureAccessStatus = async () => ({ hasAccess: true, status: 'active' });
    plugin.getLocalTranscriptionComponentReadiness = () => ({
      ready: false,
      missingComponents: ['图片文字识别 OCR'],
      asrStatus: { ready: true },
      ocrStatus: { ready: false },
    });
    plugin.confirmLocalComponentInstall = async () => {
      prompts += 1;
      return outcome !== 'declined';
    };
    plugin.installLocalTranscriptionComponents = async () => {
      installs += 1;
      throw new Error('OCR repair failed');
    };

    const first = await plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open', force: true });
    assert.strictEqual(first.hasAccess, true);
    assert.strictEqual(prompts, 1);
    assert.strictEqual(installs, outcome === 'failed' ? 1 : 0);
    assert.strictEqual(plugin.settings.localComponentAutoPromptedIssues.ocr, true);

    await plugin.saveSettings({
      ...plugin.settings,
      proSetupInstallPromptSnoozedUntil: '',
    });
    const second = await plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open', force: true });
    assert.strictEqual(second.hasAccess, true);
    assert.strictEqual(prompts, 1);
    assert.strictEqual(installs, outcome === 'failed' ? 1 : 0);
  }
}

async function verifyHealthyStateClearsAutomaticPromptEpisode() {
  const plugin = createPlugin();
  let ready = false;
  let prompts = 0;
  plugin.getProFeatureAccessStatus = async () => ({ hasAccess: true, status: 'active' });
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready,
    missingComponents: ready ? [] : ['音视频转写'],
    asrStatus: { ready },
    ocrStatus: { ready: true },
  });
  plugin.confirmLocalComponentInstall = async () => {
    prompts += 1;
    return true;
  };
  plugin.installLocalTranscriptionComponents = async () => {
    ready = true;
    return { installed: true, readiness: plugin.getLocalTranscriptionComponentReadiness() };
  };

  await plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open', force: true });
  assert.strictEqual(prompts, 1);
  assert.strictEqual(plugin.settings.localComponentAutoPromptedIssues.asr, undefined);

  ready = false;
  await plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open', force: true });
  assert.strictEqual(prompts, 2);
}

async function verifyManualRefreshDeclineSkipsDownload() {
  const plugin = createPlugin();
  let prompts = 0;
  plugin.getProFeatureAccessStatus = async () => ({ hasAccess: true, status: 'active' });
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: false,
    missingComponents: ['OCR'],
    asrStatus: { ready: true },
    ocrStatus: { ready: false },
  });
  plugin.confirmLocalComponentInstall = async () => {
    prompts += 1;
    return false;
  };
  plugin.installLocalTranscriptionComponents = async () => {
    throw new Error('declined refresh must not download components');
  };

  const status = await plugin.refreshProAndMaybePromptLocalComponentInstall({
    reason: 'manual-refresh',
    force: true,
  });

  assert.strictEqual(status.hasAccess, true);
  assert.strictEqual(prompts, 1);
  assert.strictEqual(status.localComponentInstallSkipped.reason, 'user-declined');
  assert.ok(Date.parse(status.localComponentInstallSkipped.snoozedUntil) > Date.now());
  assert.strictEqual(plugin.settings.proSetupInstallPromptSnoozedUntil, status.localComponentInstallSkipped.snoozedUntil);
  assert.strictEqual(status.localComponentInstallSkipped.requireAsr, false);
  assert.strictEqual(status.localComponentInstallSkipped.requireOcr, true);
}

async function verifyFirstUseDeclineSnoozesPromptAndSkipsRepeatedDialogs() {
  const plugin = createPlugin();
  let prompts = 0;
  let installs = 0;
  plugin.ensureProFeatureAccess = async () => ({ hasAccess: true, status: 'active' });
  plugin.getLocalAsrInstallStatus = () => ({ ready: false });
  plugin.getLocalOcrInstallStatus = () => ({ ready: true });
  plugin.confirmLocalComponentInstall = async () => {
    prompts += 1;
    return false;
  };
  plugin.installLocalTranscriptionComponents = async () => {
    installs += 1;
    throw new Error('declined first-use prompt must not install components');
  };

  await assert.rejects(
    () => plugin.ensureLocalComponentReadyForUse('音视频转写', {
      reason: 'first-use',
      requireAsr: true,
      requireOcr: false,
    }),
    /需要先安装本地转写组件/,
  );
  assert.strictEqual(prompts, 1);
  assert.strictEqual(installs, 0);
  assert.ok(Date.parse(plugin.settings.proSetupInstallPromptSnoozedUntil) > Date.now());

  await assert.rejects(
    () => plugin.ensureLocalComponentReadyForUse('音视频转写', {
      reason: 'first-use',
      requireAsr: true,
      requireOcr: false,
    }),
    /已选择稍后再试/,
  );
  assert.strictEqual(prompts, 1);
  assert.strictEqual(installs, 0);
}

async function verifyCompatibleComponentsStaySilentUntilManualUpdateCheck() {
  const plugin = createPlugin();
  let prompts = 0;
  const installOptions = [];
  plugin.getProFeatureAccessStatus = async () => ({ hasAccess: true, status: 'active' });
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: true,
    missingComponents: [],
    updateComponents: ['音视频转写', '图片文字识别 OCR'],
    updateRecommended: true,
    asrStatus: {
      ready: true,
      upgradeRecommended: true,
      compatibilityMode: 'diagnostics-process-v1',
    },
    ocrStatus: {
      ready: true,
      upgradeRecommended: true,
      compatibilityMode: 'legacy-ocr-script',
    },
  });
  plugin.confirmLocalComponentInstall = async () => {
    prompts += 1;
    return true;
  };
  plugin.installLocalTranscriptionComponents = async (options) => {
    installOptions.push(options);
    return {
      installed: true,
      readiness: {
        ready: true,
        missingComponents: [],
        asrStatus: { ready: true },
        ocrStatus: { ready: true },
      },
    };
  };

  const passiveStatus = await plugin.refreshProAndMaybePromptLocalComponentInstall({
    reason: 'settings-open',
    force: true,
  });
  assert.strictEqual(passiveStatus.localComponentRefreshPlan.hasRequiredChanges, false);
  assert.strictEqual(prompts, 0);
  assert.strictEqual(installOptions.length, 0);

  const manualStatus = await plugin.refreshProAndMaybePromptLocalComponentInstall({
    reason: 'manual-refresh',
    force: true,
  });
  assert.strictEqual(manualStatus.localComponentInstallResult.installed, true);
  assert.strictEqual(prompts, 1);
  assert.strictEqual(installOptions.length, 1);
  assert.strictEqual(installOptions[0].forceAsr, true);
  assert.strictEqual(installOptions[0].forceOcr, true);
}

async function verifyManualRefreshRequiresReloadWhenPluginFilesDoNotMatch() {
  const plugin = createPlugin();
  plugin.manifest = { version: '1.3.126' };
  plugin.getProFeatureAccessStatus = async () => ({ hasAccess: true, status: 'active' });
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: false,
    missingComponents: ['音视频转写'],
    asrStatus: { ready: false },
    ocrStatus: { ready: true },
  });
  plugin.confirmLocalComponentInstall = async () => {
    throw new Error('mismatched plugin files must not prompt for component repair');
  };
  plugin.installLocalTranscriptionComponents = async () => {
    throw new Error('mismatched plugin files must not download components');
  };

  const status = await plugin.refreshProAndMaybePromptLocalComponentInstall({
    reason: 'manual-refresh',
    force: true,
  });

  assert.strictEqual(status.hasAccess, true);
  assert.strictEqual(status.localComponentInstallSkipped.reason, 'plugin-runtime-mismatch');
  assert.strictEqual(status.localComponentInstallSkipped.identity.manifestVersion, '1.3.126');
  assert.strictEqual(status.localComponentInstallSkipped.identity.matchesManifest, false);
}

async function verifyManualRefreshIgnoresPromptSnoozeAndClearsItAfterInstall() {
  const plugin = createPlugin();
  let prompts = 0;
  const installOptions = [];
  plugin.settings = helpers.mergeSettings({
    proSetupInstallPromptSnoozedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  plugin.getProFeatureAccessStatus = async () => ({ hasAccess: true, status: 'active' });
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: false,
    missingComponents: ['OCR'],
    asrStatus: { ready: true },
    ocrStatus: { ready: false },
  });
  plugin.confirmLocalComponentInstall = async (status, reason) => {
    prompts += 1;
    assert.strictEqual(status.hasAccess, true);
    assert.strictEqual(reason, 'manual-refresh');
    return true;
  };
  plugin.installLocalTranscriptionComponents = async (options) => {
    installOptions.push(options);
    return {
      installed: true,
      reason: options.reason,
      readiness: {
        ready: true,
        missingComponents: [],
        updateComponents: [],
        asrStatus: { ready: true },
        ocrStatus: { ready: true },
      },
    };
  };

  const status = await plugin.refreshProAndMaybePromptLocalComponentInstall({
    reason: 'manual-refresh',
    force: true,
  });

  assert.strictEqual(prompts, 1);
  assert.strictEqual(installOptions.length, 1);
  assert.strictEqual(status.localComponentInstallResult.installed, true);
  assert.strictEqual(plugin.settings.proSetupInstallPromptSnoozedUntil, '');
}

function verifyRefreshPlanOnlyIncludesOptionalUpdatesWhenRequested() {
  const readiness = {
    ready: true,
    missingComponents: [],
    asrStatus: { ready: true, upgradeRecommended: true },
    ocrStatus: { ready: true, upgradeRecommended: false },
  };
  const passivePlan = helpers.buildLocalComponentRefreshPlan(readiness);
  assert.strictEqual(passivePlan.hasRequiredChanges, false);
  assert.strictEqual(passivePlan.forceAsr, false);

  const manualPlan = helpers.buildLocalComponentRefreshPlan(readiness, {
    includeOptionalUpdates: true,
  });
  assert.strictEqual(manualPlan.hasRequiredChanges, true);
  assert.strictEqual(manualPlan.requireAsr, true);
  assert.strictEqual(manualPlan.forceAsr, true);
  assert.deepStrictEqual(manualPlan.updateComponents, ['音视频转写']);
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
  await verifyPassiveRefreshPromptsOnceAndInstallsOnlyMissingComponents();
  await verifyCachedEntitlementStillChecksLocalComponents();
  await verifyDeclinedOrFailedAutomaticPromptDoesNotLoop();
  await verifyHealthyStateClearsAutomaticPromptEpisode();
  await verifyManualRefreshDeclineSkipsDownload();
  await verifyFirstUseDeclineSnoozesPromptAndSkipsRepeatedDialogs();
  await verifyCompatibleComponentsStaySilentUntilManualUpdateCheck();
  await verifyManualRefreshRequiresReloadWhenPluginFilesDoNotMatch();
  await verifyManualRefreshIgnoresPromptSnoozeAndClearsItAfterInstall();
  verifyRefreshPlanOnlyIncludesOptionalUpdatesWhenRequested();
  await verifyFirstUseInstallsOnlyRequestedComponent({ requireAsr: true, requireOcr: false });
  await verifyFirstUseInstallsOnlyRequestedComponent({ requireAsr: false, requireOcr: true });
  await verifyImplicitInstallIsNoOp();
  process.stdout.write('plugin local component on-demand tests passed\n');
})().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
