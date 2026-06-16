const assert = require('assert');

const {
  AI_PROVIDER_NAMES,
  DEFAULT_SETTINGS,
  MAX_PLUGIN_BINDINGS,
  OFFICIAL_SYNC_API_BASE,
  mergeSettings,
  normalizeBindings,
  validateSettings,
  buildSyncNotice,
  normalizeBindCodeInput,
} = require('../obsidian-plugin/wechat-inbox-sync/plugin-core');

const LEGACY_OFFICIAL_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';

assert.strictEqual(OFFICIAL_SYNC_API_BASE, 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync');
assert.strictEqual(MAX_PLUGIN_BINDINGS, 3);

assert.deepStrictEqual(AI_PROVIDER_NAMES, {
  off: '关闭转写',
  local: '本地转写命令',
  aliyun: '阿里云百炼 Qwen-Omni',
  doubao: '豆包语音识别',
  tencent: '腾讯云 ASR 录音文件识别',
});

assert.deepStrictEqual(DEFAULT_SETTINGS, {
  apiBase: OFFICIAL_SYNC_API_BASE,
  token: '',
  pendingBindCode: '',
  bindings: [],
  clientId: '',
  inboxDir: '临时收集',
  noteSaveMode: 'date',
  notePropertyFields: '',
  autoSyncOnLoad: false,
  aiProvider: 'off',
  localAsrPlatform: 'auto',
  localTranscriptionCommand: '',
  aliyunApiKey: '',
  aliyunModel: 'qwen3.5-omni-plus',
  aliyunBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  doubaoAsrApiKey: '',
  doubaoPollAttempts: 60,
  doubaoPollIntervalMs: 5000,
  pendingDoubaoTasks: {},
  tencentSecretId: '',
  tencentSecretKey: '',
  tencentRegion: 'ap-shanghai',
  tencentEngineModelType: '16k_zh',
  tencentPollAttempts: 60,
  tencentPollIntervalMs: 5000,
});

{
  const merged = mergeSettings({ token: 'ABC-123' });
  assert.strictEqual(merged.token, 'ABC-123');
  assert.match(merged.clientId, /^obsidian-[a-f0-9]{32}$/);
}

assert.match(mergeSettings({ clientId: '' }).clientId, /^obsidian-[a-f0-9]{32}$/);

assert.strictEqual(
  mergeSettings({ apiBase: LEGACY_OFFICIAL_SYNC_API_BASE }).apiBase,
  OFFICIAL_SYNC_API_BASE,
);

assert.deepStrictEqual(mergeSettings({
  apiBase: ' https://api.example.com/sync ',
  clientId: 'client-2',
  inboxDir: '',
  noteSaveMode: 'root',
  notePropertyFields: 'type, title, url',
  aiProvider: 'tencent',
  tencentSecretId: ' sid ',
  tencentSecretKey: ' sk ',
  aliyunApiKey: ' dashscope-key ',
  doubaoAsrApiKey: ' doubao-key ',
  doubaoPollAttempts: 0,
  doubaoPollIntervalMs: 300,
  pendingDoubaoTasks: { abc: { requestId: 'request-1' } },
  tencentPollAttempts: 0,
  tencentPollIntervalMs: 300,
  localTranscriptionCommand: ' powershell -File transcribe.ps1 -InputPath {input} -OutputPath {output} ',
}), {
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  clientId: 'client-2',
  noteSaveMode: 'root',
  notePropertyFields: 'type,title,url',
  aiProvider: 'tencent',
  localTranscriptionCommand: 'powershell -File transcribe.ps1 -InputPath {input} -OutputPath {output}',
  tencentSecretId: 'sid',
  tencentSecretKey: 'sk',
  aliyunApiKey: 'dashscope-key',
  doubaoAsrApiKey: 'doubao-key',
  doubaoPollAttempts: 1,
  doubaoPollIntervalMs: 1000,
  pendingDoubaoTasks: { abc: { requestId: 'request-1' } },
  tencentPollAttempts: 1,
  tencentPollIntervalMs: 1000,
});

assert.strictEqual(
  mergeSettings({
    localTranscriptionCommand: 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
  }).localTranscriptionCommand,
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
);

assert.strictEqual(
  mergeSettings({
    localTranscriptionCommand: 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
  }, 'darwin').localTranscriptionCommand,
  '/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}',
);

assert.strictEqual(
  mergeSettings({
    localAsrPlatform: 'darwin',
    localTranscriptionCommand: 'powershell -File "%USERPROFILE%\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
  }, 'win32').localTranscriptionCommand,
  '/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}',
);
assert.strictEqual(mergeSettings({ localAsrPlatform: 'bad-value' }).localAsrPlatform, 'auto');
assert.strictEqual(mergeSettings({ noteSaveMode: 'bad-value' }).noteSaveMode, 'date');
assert.strictEqual(mergeSettings({ notePropertyFields: ' id, bad_key, url, id ' }).notePropertyFields, 'id,url');

const whitespaceSettings = mergeSettings({
  apiBase: '   ',
  token: 'ABC-123',
  clientId: 'client-1',
});
assert.strictEqual(whitespaceSettings.apiBase, DEFAULT_SETTINGS.apiBase);
assert.strictEqual(whitespaceSettings.token, 'ABC-123');
assert.strictEqual(whitespaceSettings.clientId, 'client-1');

assert.deepStrictEqual(normalizeBindings({
  bindings: [
    { token: ' abc123 ', label: '主微信', enabled: true },
    { token: ' def456 ', label: '备用微信', enabled: false },
    { token: 'abc-123', label: '重复', enabled: true },
    { token: ' ghi789 ', label: '第三个微信', enabled: true },
    { token: ' jkl234 ', label: '第四个微信', enabled: true },
    { token: '', label: '空' },
  ],
}), [
  {
    token: 'ABC-123',
    label: '主微信',
    enabled: true,
    status: 'bound',
    boundAt: '',
    lastSyncAt: '',
    unboundAt: '',
    lastError: '',
  },
  {
    token: 'DEF-456',
    label: '备用微信',
    enabled: false,
    status: 'paused',
    boundAt: '',
    lastSyncAt: '',
    unboundAt: '',
    lastError: '',
  },
  {
    token: 'GHI-789',
    label: '第三个微信',
    enabled: true,
    status: 'bound',
    boundAt: '',
    lastSyncAt: '',
    unboundAt: '',
    lastError: '',
  },
]);

assert.deepStrictEqual(normalizeBindings({
  token: ' abc123 ',
  bindings: [
    {
      token: ' def456 ',
      label: '备用微信',
      enabled: false,
      status: 'unbound',
      unboundAt: '2026-06-03T08:00:00.000Z',
      lastError: '绑定码已失效',
    },
  ],
}), [
  {
    token: 'ABC-123',
    label: '默认微信',
    enabled: true,
    status: 'bound',
    boundAt: '',
    lastSyncAt: '',
    unboundAt: '',
    lastError: '',
  },
]);

assert.deepStrictEqual(mergeSettings({
  token: ' old123 ',
  bindings: [],
}).bindings, [{
  token: 'OLD-123',
  label: '默认微信',
  enabled: true,
  status: 'bound',
  boundAt: '',
  lastSyncAt: '',
  unboundAt: '',
  lastError: '',
}]);

assert.strictEqual(mergeSettings({
  token: '',
  pendingBindCode: ' add789 ',
  bindings: [{ token: 'new456', label: '第二个微信', enabled: true }],
}).token, 'NEW-456');
assert.strictEqual(mergeSettings({
  token: '',
  pendingBindCode: ' add789 ',
  bindings: [{ token: 'new456', label: '第二个微信', enabled: true }],
}).pendingBindCode, 'ADD-789');

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: '',
  token: '',
}), [
  '请填写同步 API 地址',
  '请填写小程序绑定码',
]);

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  token: 'ABC-123',
  aiProvider: 'aliyun',
}), []);

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  token: '',
  bindings: [{ token: 'ABC-123', label: '主微信', enabled: true }],
  aiProvider: 'aliyun',
  aliyunApiKey: 'dashscope-key',
}), []);

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  token: 'ABC-123',
  aiProvider: 'doubao',
}), []);

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  token: 'ABC-123',
  aiProvider: 'doubao',
  doubaoAsrApiKey: 'doubao-key',
}), []);

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  token: 'ABC-123',
  aiProvider: 'local',
}), []);

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  token: 'ABC-123',
  aiProvider: 'local',
  localTranscriptionCommand: 'powershell -File transcribe.ps1 -InputPath {input} -OutputPath {output}',
}), []);

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  token: 'ABC-123',
  aiProvider: 'tencent',
}), []);

assert.deepStrictEqual(validateSettings({
  ...DEFAULT_SETTINGS,
  apiBase: 'https://api.example.com/sync',
  token: 'ABC-123',
  aiProvider: 'tencent',
  tencentSecretId: 'sid',
  tencentSecretKey: 'sk',
}), []);

assert.strictEqual(buildSyncNotice(0), '没有需要同步的新内容');
assert.strictEqual(buildSyncNotice(3), '已同步 3 条内容到 Obsidian');
assert.strictEqual(normalizeBindCodeInput(' ozt n1i '), 'OZT-N1I');
assert.strictEqual(normalizeBindCodeInput('oztn1i'), 'OZT-N1I');
assert.strictEqual(mergeSettings({ token: ' ozt n1i ' }).token, 'OZT-N1I');
