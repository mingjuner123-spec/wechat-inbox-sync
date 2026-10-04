'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const originalLoad = Module._load;
const originalExtensions = new Map(['.ps1', '.sh', '.py'].map((extension) => [extension, require.extensions[extension]]));
for (const extension of originalExtensions.keys()) {
  require.extensions[extension] = (module) => { module.exports = ''; };
}
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal: class {},
      Notice: class {},
      Plugin: class {},
      PluginSettingTab: class {},
      Setting: class {},
      requestUrl: async () => ({ status: 200, json: {} }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');
Module._load = originalLoad;
for (const [extension, loader] of originalExtensions) {
  if (loader) require.extensions[extension] = loader;
  else delete require.extensions[extension];
}

function configure(plugin, root) {
  plugin.settings = Plugin.__test.mergeSettings({
    apiBase: 'https://api.example.test/sync',
    bindings: [],
    localAsrPlatform: 'win32',
  });
  plugin.manifest = { version: '1.3.176' };
  plugin.getConfiguredLocalAsrInstallRoot = () => root;
  plugin.getConfiguredLocalOcrInstallRoot = () => root;
  plugin.getConfiguredLocalAsrPlatform = () => 'win32';
  plugin.getLocalAsrInstallStatus = () => ({ ready: true, installRoot: root, missingReasons: [] });
  plugin.getLocalOcrInstallStatus = () => ({ ready: true, installRoot: root, missingReasons: [] });
  plugin.getLocalDouyinResolverInstallStatus = () => ({ ready: true });
  plugin.getLocalDouyinResolverInstallDiagnostic = () => [];
  plugin.getRecentXiaohongshuBrowserResults = () => [];
  plugin.getRecentXiaohongshuCommentResults = () => [];
  plugin.getRecentSyncFailureCleanupErrors = () => [];
  plugin.getRecentSyncFailures = () => [];
  plugin.getActiveBindings = () => [];
  plugin.feishuImageDisplay = null;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-url-diagnostic-'));
  try {
    const plugin = new Plugin();
    configure(plugin, root);
    assert.equal(
      Plugin.__test.getDiagnosticSourceUrl({
        type: 'webpage',
        metadata: {
          url: 'https://cdn.example.test/video.mp4?signature=SIGNED_FIXTURE',
          originalUrl: 'https://www.douyin.com/video/123456789?from=share',
        },
      }),
      'https://www.douyin.com/video/123456789?from=share',
      'a rejected media URL must not hide a later public source page',
    );
    assert.equal(Plugin.__test.getDiagnosticSourceUrl({
      type: 'voice',
      metadata: { url: 'https://www.douyin.com/video/123456789' },
    }), '');
    assert.equal(Plugin.__test.getDiagnosticSourceUrl({
      type: 'file',
      metadata: { originalUrl: 'https://www.douyin.com/video/123456789' },
    }), '');
    plugin.lastSyncDiagnostic = {
      status: 'failed',
      error: 'request failed at https://www.douyin.com/video/123?token=SECRET',
      sourceUrl: 'https://www.douyin.com/video/123?token=SECRET&utm_source=share#fragment',
    };
    for (const options of [{}, { detailed: true }]) {
      const summary = plugin.getSyncDiagnosticText(options);
      assert.match(summary, /最近失败原始分享链接：https:\/\/www\.douyin\.com\/video\/123/);
      assert.doesNotMatch(summary, /SECRET|token=SECRET/);
    }

    fs.writeFileSync(path.join(root, 'sync-last.log'), [
      'time=2026-10-05T00:00:00.000Z',
      'status=failed',
      'sourceUrl=https://www.douyin.com/video/456?token=SECRET&utm_source=share',
      '--- error ---',
      'request failed',
    ].join('\n'));
    const restarted = new Plugin();
    configure(restarted, root);
    const restartedSummary = restarted.getSyncDiagnosticText({ detailed: true });
    assert.match(restartedSummary, /最近失败原始分享链接：https:\/\/www\.douyin\.com\/video\/456/);
    assert.doesNotMatch(restartedSummary, /SECRET|token=SECRET/);

    const recovered = new Plugin();
    configure(recovered, root);
    recovered.lastSyncDiagnostic = {
      status: 'success',
      sourceUrl: 'https://www.douyin.com/video/123?token=SECRET',
    };
    assert.doesNotMatch(recovered.getSyncDiagnosticText(), /最近失败原始分享链接|www\.douyin\.com\/video\/123/);
    console.log('plugin-source-url-diagnostic.test.js: PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
