const assert = require('assert');
const Module = require('module');

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

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main';
const PluginClass = require(pluginMainPath);
Module._load = originalLoad;
const helpers = PluginClass.__test;

function createFileRecord(recordId = 'image-record-1') {
  return {
    _id: recordId,
    type: 'file',
    content: '截图.png',
    createdAt: '2026-09-04T04:49:00.000Z',
    metadata: {
      fileID: 'cloud://safe/image-record-1.png',
      fileName: '截图.png',
      fileExt: 'png',
    },
  };
}

function createPlugin({ attachmentExists = false } = {}) {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'file-local-recovery-test',
    inboxDir: '临时收集',
  });
  plugin.showSyncProgress = () => {};
  plugin.saveData = async () => {};
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: '临时收集/2026-09-04/文件-截图.md', extension: 'md' }],
      cachedRead: async () => [
        '---',
        'id: image-record-1',
        'type: file',
        'file_name: 截图.png',
        '---',
        '',
        '文件名：截图.png',
        '本地图片：![[临时收集/文件附件/2026-09-04/文件-截图-截图.png]]',
        '',
        '文件附件已保存。',
      ].join('\n'),
      adapter: {
        exists: async (filePath) => attachmentExists
          && filePath === '临时收集/文件附件/2026-09-04/文件-截图-截图.png',
      },
    },
  };
  return plugin;
}

async function runPhysicalAttachmentValidationTest() {
  const missingPlugin = createPlugin({ attachmentExists: false });
  assert.strictEqual(
    await missingPlugin.findExistingRecordNotePath(createFileRecord()),
    '',
    'an image note must not count as complete when its referenced attachment is missing',
  );

  const completePlugin = createPlugin({ attachmentExists: true });
  assert.strictEqual(
    await completePlugin.findExistingRecordNotePath(createFileRecord()),
    '临时收集/2026-09-04/文件-截图.md',
    'the same record id remains idempotent only when its local attachment really exists',
  );
}

async function runMissingAttachmentIgnoresCompletedReceiptTest() {
  const plugin = createPlugin({ attachmentExists: false });
  const binding = { token: 'ABC-123', label: '测试微信' };
  plugin.settings.completedSyncReceipts = helpers.normalizeCompletedSyncReceipts([{
    recordId: 'image-record-1',
    bindingFingerprint: helpers.getSyncLifecycleBindingFingerprint(binding.token),
    noteTitle: '文件-截图',
    completedAt: '2026-09-04T04:50:00.000Z',
  }]);
  const writeCalls = [];
  plugin.writeRecord = async (record) => {
    writeCalls.push(record._id);
    return {
      recordId: record._id,
      title: '文件-截图-002',
      filePath: '临时收集/2026-09-04/文件-截图-002.md',
      committed: true,
    };
  };
  plugin.requestJson = async (requestPath) => {
    if (requestPath === '/records?status=pending') {
      return { success: true, data: [createFileRecord()] };
    }
    if (requestPath === '/records/image-record-1/synced') {
      return { success: true, data: { status: 'deleted' } };
    }
    throw new Error(`unexpected request ${requestPath}`);
  };

  const result = await plugin.syncBinding(binding, false);

  assert.deepStrictEqual(writeCalls, ['image-record-1']);
  assert.strictEqual(result.written.length, 1);
  assert.deepStrictEqual(result.skipped, []);
  assert.deepStrictEqual(result.failed, []);
}

async function runCompleteAttachmentKeepsExactIdIdempotencyTest() {
  const plugin = createPlugin({ attachmentExists: true });
  const binding = { token: 'ABC-123', label: '测试微信' };
  plugin.settings.completedSyncReceipts = helpers.normalizeCompletedSyncReceipts([{
    recordId: 'image-record-1',
    bindingFingerprint: helpers.getSyncLifecycleBindingFingerprint(binding.token),
    noteTitle: '文件-截图',
    completedAt: '2026-09-04T04:50:00.000Z',
  }]);
  plugin.writeRecord = async () => {
    throw new Error('a complete attachment for the exact record id must not be duplicated');
  };
  plugin.requestJson = async (requestPath) => {
    if (requestPath === '/records?status=pending') {
      return { success: true, data: [createFileRecord()] };
    }
    if (requestPath === '/records/image-record-1/synced') {
      return { success: true, data: { status: 'deleted' } };
    }
    throw new Error(`unexpected request ${requestPath}`);
  };

  const result = await plugin.syncBinding(binding, false);

  assert.deepStrictEqual(result.written, []);
  assert.deepStrictEqual(result.skipped, [{
    recordId: 'image-record-1',
    reason: 'already-committed-local-receipt',
  }]);
  assert.deepStrictEqual(result.failed, []);
}

Promise.resolve()
  .then(runPhysicalAttachmentValidationTest)
  .then(runMissingAttachmentIgnoresCompletedReceiptTest)
  .then(runCompleteAttachmentKeepsExactIdIdempotencyTest)
  .then(() => console.log('plugin file local recovery tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
