'use strict';

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      App: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {},
      Notice: class {}, TFile: class {},
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
      requestUrl: async () => ({}), MarkdownRenderer: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/src/main.js';
const PluginClass = require(pluginMainPath);

async function run() {
  const diagnostic = {
    source: { protocol: 'https', host: 'v.douyin.com' },
    awemeId: '7644566503081119019',
    mediaCandidateCount: 0,
    finalOutcome: 'no-media-candidate',
    stages: [{ stage: 'authenticated-session', attempted: true, ok: false, rejectionReason: 'no-target-bound-media' }],
  };
  const plugin = new PluginClass();
  plugin.settings = { inboxDir: 'Inbox', noteSaveMode: 'root', notePropertyFields: [] };
  plugin.app = { vault: { adapter: {} } };
  plugin.showSyncProgress = () => {};
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => '抖音测试';
  plugin.hydrateWebpageMarkdown = async (record) => ({
    ...record,
    metadata: {
      ...(record.metadata || {}),
      transcriptionStatus: 'failed',
      transcriptionError: '未能从抖音作品页获取到可用的音频或视频地址',
      mediaResolutionDiagnostic: diagnostic,
    },
  });
  plugin.saveSourceMediaAttachment = async (record) => record;

  await assert.rejects(
    plugin.writeRecord({
      _id: 'douyin-failure-1', type: 'webpage', createdAt: '2026-08-15T17:01:35.277Z',
      metadata: { url: 'https://v.douyin.com/example' },
    }, new Date().toISOString()),
    (error) => {
      assert.strictEqual(error.code, 'TRANSCRIPTION_FAILED');
      assert.deepStrictEqual(error.diagnostic, diagnostic);
      return true;
    },
  );
}

run().then(() => console.log('plugin-douyin-failure-diagnostic.test.js passed')).catch((error) => {
  console.error(error);
  process.exit(1);
});
