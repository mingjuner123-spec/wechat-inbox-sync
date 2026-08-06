const assert = require('assert');
const Module = require('module');

let requestUrlMock = async () => ({});
const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal: class Modal {},
      Notice: class Notice {},
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: (...args) => requestUrlMock(...args),
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
        { path: 'Inbox/2026-08-05/old-transcript.md', extension: 'md' },
        { path: 'Inbox/2026-08-05/retry-transcript.md', extension: 'md' },
        { path: 'Inbox/2026-08-05/old-video-transcript.md', extension: 'md' },
      ],
      cachedRead: async (file) => {
        const records = {
          'old-transcript.md': {
            id: 'old-voice-record',
            type: 'voice',
            url: 'repeat voice',
            syncedAt: '2026-08-05T08:00:00.000Z',
          },
          'retry-transcript.md': {
            id: 'retry-after-mark-failure',
            type: 'voice',
            url: 'same pending record retry',
            syncedAt: '2026-08-05T08:30:00.000Z',
          },
          'old-video-transcript.md': {
            id: 'old-audio-video-record',
            type: 'webpage',
            url: 'https://example.com/repeat-video',
            syncedAt: '2026-08-05T08:00:00.000Z',
          },
        };
        const key = String(file && file.path || '').split('/').pop();
        const record = records[key];
        return [
          '---',
          `id: ${record.id}`,
          `type: ${record.type}`,
          `url: ${record.url}`,
          `synced_at: ${record.syncedAt}`,
          '---',
          '',
          'old transcript',
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
          _id: 'repeat-voice-record',
          type: 'voice',
          content: 'repeat voice',
          createdAt: '2026-08-05T07:00:00.000Z',
          metadata: {
            audioFileID: 'cloud://voices/repeat.mp3',
            transcriptionStatus: 'pending',
          },
        }, {
          _id: 'retry-after-mark-failure',
          type: 'voice',
          content: 'same pending record retry',
          createdAt: '2026-08-05T09:00:00.000Z',
          metadata: {
            audioFileID: 'cloud://voices/retry.mp3',
            transcriptionStatus: 'pending',
          },
        }, {
          _id: 'repeat-audio-video-record',
          type: 'webpage',
          content: 'https://example.com/repeat-video',
          createdAt: '2026-08-05T07:30:00.000Z',
          metadata: {
            webpageMediaType: 'audio_video',
            transcriptionStatus: 'pending',
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
      title: 'repeat voice',
      filePath: 'Inbox/2026-08-05/repeat-voice.md',
    };
  };

  const result = await plugin.syncBinding({
    token: 'ABC-123',
    label: 'test binding',
  }, false);

  assert.deepStrictEqual(writeCalls, [
    'repeat-voice-record',
    'repeat-audio-video-record',
  ]);
  assert.deepStrictEqual(result.written, [{
    recordId: 'repeat-voice-record',
    title: 'repeat voice',
    filePath: 'Inbox/2026-08-05/repeat-voice.md',
  }, {
    recordId: 'repeat-audio-video-record',
    title: 'repeat voice',
    filePath: 'Inbox/2026-08-05/repeat-voice.md',
  }]);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(result.skipped, [{
    recordId: 'retry-after-mark-failure',
    reason: 'already-synced-local',
    filePath: 'Inbox/2026-08-05/retry-transcript.md',
  }]);
  assert.deepStrictEqual(calls, [[
    '/records?status=pending',
    'GET',
    {},
    'ABC-123',
  ], [
    '/records/repeat-voice-record/synced',
    'POST',
    {},
    'ABC-123',
  ], [
    '/records/retry-after-mark-failure/synced',
    'POST',
    {},
    'ABC-123',
  ], [
    '/records/repeat-audio-video-record/synced',
    'POST',
    {},
    'ABC-123',
  ]]);

  console.log('plugin audio repeat local dedupe tests passed');
})();
