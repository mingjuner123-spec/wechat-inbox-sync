'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'progress-notice-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');
const generatedMainPath = path.join(pluginDir, 'main.js');

assert.ok(fs.existsSync(modulePath), 'progress notice utils module must exist');

const helpers = require(modulePath);
const functionNames = [
  'buildSyncNotice',
  'buildSyncResultNotice',
  'buildSkippedSyncNotice',
  'buildConversionWarningsNotice',
  'normalizeProgressPercent',
  'parseLocalAsrProgressLog',
  'formatProgressElapsed',
  'isProgressHeartbeatStale',
  'buildLocalAsrProgressKey',
  'buildSyncProgressMessage',
];

for (const functionName of functionNames) {
  assert.strictEqual(typeof helpers[functionName], 'function', `${functionName} must be exported`);
}

assert.strictEqual(helpers.buildSyncNotice(0), '没有需要同步的新内容');
assert.strictEqual(helpers.buildSyncNotice(2), '已同步 2 条内容到 Obsidian');
assert.strictEqual(
  helpers.buildSyncResultNotice([], [], [], [{ message: '小红书内容提取失败' }]),
  '同步失败：1 条内容未同步：小红书内容提取失败',
);
assert.strictEqual(
  helpers.buildSyncResultNotice(
    [{ id: '1' }],
    [{ reason: 'cloud-transcription-processing' }],
    ['飞书图片有 1 张未保存'],
    [{ message: '第二条失败' }],
  ),
  '已同步 1 条内容到 Obsidian，1 条云端转写中，完成后再同步，1 条内容处理不完整：飞书图片有 1 张未保存，1 条失败：第二条失败',
);
assert.strictEqual(
  helpers.buildSkippedSyncNotice([
    { reason: 'already-synced-local' },
    { reason: 'cloud-transcription-processing' },
    { reason: 'locally-quarantined-unrecoverable' },
    { reason: 'deleted-expired-xhs-shortlink' },
    { reason: 'unsupported' },
  ]),
  '，1 条云端转写中，完成后再同步，1 条历史失效内容已在本机忽略，1 条原小红书临时链接已失效，已生成失效说明文件并删除云端旧记录；请重新复制原笔记链接后再保存，1 条已跳过',
);
assert.strictEqual(
  helpers.buildConversionWarningsNotice(['飞书图片有 2 张未保存', '']),
  '，1 条内容处理不完整：飞书图片有 2 张未保存',
);

assert.strictEqual(helpers.normalizeProgressPercent(-1), 0);
assert.strictEqual(helpers.normalizeProgressPercent(41.9), 41);
assert.strictEqual(helpers.normalizeProgressPercent(999), 100);
assert.strictEqual(helpers.normalizeProgressPercent('not-a-number'), null);

const progress = helpers.parseLocalAsrProgressLog([
  'progressStage=transcribing',
  'progressCurrent=2',
  'progressTotal=5',
  'progressPercent=40',
  'progressStartedAt=2026-07-23T12:00:00.000Z',
  'progressHeartbeatAt=2026-07-23T12:00:05.000Z',
  'progressPid=1234',
].join('\n'));
assert.deepStrictEqual(progress, {
  stage: 'transcribing',
  current: 2,
  total: 5,
  percent: 40,
  startedAt: '2026-07-23T12:00:00.000Z',
  heartbeatAt: '2026-07-23T12:00:05.000Z',
  pid: 1234,
});
assert.strictEqual(helpers.parseLocalAsrProgressLog('status=success'), null);
assert.strictEqual(
  helpers.parseLocalAsrProgressLog('progressStage=transcribing\nprogressCurrent=3\nprogressTotal=4').percent,
  75,
);

const fixedNow = Date.parse('2026-07-23T12:00:30.000Z');
assert.strictEqual(helpers.formatProgressElapsed('2026-07-23T12:00:00.000Z', fixedNow), '30 秒');
assert.strictEqual(helpers.isProgressHeartbeatStale('2026-07-23T12:00:05.000Z', fixedNow), true);
assert.strictEqual(helpers.isProgressHeartbeatStale('2026-07-23T12:00:20.000Z', fixedNow), false);
assert.match(
  helpers.buildLocalAsrProgressKey({
    stage: 'transcribing',
    current: 2,
    total: 5,
    percent: 40,
    heartbeatAt: '2026-07-23T12:00:05.000Z',
  }, fixedNow),
  /\|stale$/,
);

assert.strictEqual(
  helpers.buildSyncProgressMessage({ bindingLabel: '微信 1', stage: 'fetching' }),
  '微信 1：正在同步，正在获取待同步内容',
);
assert.strictEqual(
  helpers.buildSyncProgressMessage({
    bindingLabel: '微信 1',
    stage: 'transcribing',
    title: 'demo.mp3',
    localProgressStage: 'transcribing',
    localProgressCurrent: 1,
    localProgressTotal: 4,
    localProgressStartedAt: '2026-07-23T12:00:00.000Z',
    localProgressHeartbeatAt: '2026-07-23T12:00:20.000Z',
    now: fixedNow,
  }),
  '微信 1：正在转写第 2/4 段，已运行 30 秒：demo.mp3',
);
assert.strictEqual(
  helpers.buildSyncProgressMessage({
    stage: 'transcribing',
    title: 'demo.mp3',
    localProgressHeartbeatAt: '2026-07-23T12:00:05.000Z',
    now: fixedNow,
  }),
  '本地转写任务可能无响应，可暂停后重试：demo.mp3',
);

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of functionNames) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./progress-notice-utils')"),
  'src/main.js must consume the extracted progress notice module',
);

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

let PluginClass;
try {
  delete require.cache[generatedMainPath];
  PluginClass = require(generatedMainPath);
} finally {
  Module._load = originalLoad;
}

for (const functionName of [
  'buildSyncResultNotice',
  'buildSkippedSyncNotice',
  'buildConversionWarningsNotice',
  'parseLocalAsrProgressLog',
  'buildLocalAsrProgressKey',
  'buildSyncProgressMessage',
]) {
  assert.strictEqual(typeof PluginClass.__test[functionName], 'function');
}
assert.strictEqual(
  PluginClass.__test.buildSyncProgressMessage({ bindingLabel: '微信 1', stage: 'fetching' }),
  helpers.buildSyncProgressMessage({ bindingLabel: '微信 1', stage: 'fetching' }),
);
