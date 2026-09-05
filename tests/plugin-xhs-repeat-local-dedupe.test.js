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

(async () => {
  const calls = [];
  const writeCalls = [];
  const repeatedUrl = 'https://www.xiaohongshu.com/explore/repeat-note';
  const ordinaryUrl = 'https://example.com/ordinary-page';
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    inboxDir: 'Inbox',
  });
  plugin.showSyncProgress = () => {};
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [
        { path: 'Inbox/2026-08-07/old-xhs-note.md', extension: 'md' },
        { path: 'Inbox/2026-08-07/old-ordinary-page.md', extension: 'md' },
      ],
      cachedRead: async (file) => {
        const isXhs = String(file && file.path || '').endsWith('old-xhs-note.md');
        return [
          '---',
          `url: ${isXhs ? repeatedUrl : ordinaryUrl}`,
          'synced_at: 2026-08-07T08:00:00.000Z',
          '---',
          '',
          `<!-- wechat-inbox-record-id: ${isXhs ? 'old-xhs-record' : 'old-ordinary-record'} -->`,
          '',
          isXhs ? 'old xhs note' : 'old ordinary page',
        ].join('\n');
      },
    },
  };
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push([path, method, body, binding && binding.token]);
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'new-xhs-record',
          type: 'webpage',
          content: repeatedUrl,
          createdAt: '2026-08-07T09:00:00.000Z',
          metadata: {
            url: repeatedUrl,
            platform: '小红书',
            contentCategory: '图文',
          },
        }, {
          _id: 'old-xhs-record',
          type: 'webpage',
          content: repeatedUrl,
          createdAt: '2026-08-07T09:00:30.000Z',
          metadata: {
            url: repeatedUrl,
          },
        }, {
          _id: 'new-ordinary-record',
          type: 'webpage',
          content: ordinaryUrl,
          createdAt: '2026-08-07T09:01:00.000Z',
          metadata: {
            url: ordinaryUrl,
          },
        }],
      };
    }
    return { success: true, data: {} };
  };
  plugin.writeRecord = async (record) => {
    writeCalls.push(record._id);
    return {
      recordId: record._id,
      title: '重复保存的小红书笔记',
      filePath: 'Inbox/2026-08-07/重复保存的小红书笔记-002.md',
    };
  };

  const result = await plugin.syncBinding({
    token: 'ABC-123',
    label: 'test binding',
  }, false);

  assert.deepStrictEqual(writeCalls, ['new-xhs-record', 'new-ordinary-record']);
  assert.deepStrictEqual(result.skipped, [{
    recordId: 'old-xhs-record',
    reason: 'already-synced-local',
    filePath: 'Inbox/2026-08-07/old-xhs-note.md',
  }]);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(calls, [[
    '/records?status=pending',
    'GET',
    {},
    'ABC-123',
  ], [
    '/records/new-xhs-record/synced',
    'POST',
    { noteTitle: '重复保存的小红书笔记' },
    'ABC-123',
  ], [
    '/records/old-xhs-record/synced',
    'POST',
    { noteTitle: 'old-xhs-note' },
    'ABC-123',
  ], [
    '/records/new-ordinary-record/synced',
    'POST',
    { noteTitle: '重复保存的小红书笔记' },
    'ABC-123',
  ]]);

  console.log('plugin xhs repeat local dedupe tests passed');
})();
