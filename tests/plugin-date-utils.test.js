'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'date-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');
const generatedMainPath = path.join(pluginDir, 'main.js');

assert.ok(fs.existsSync(modulePath), 'date utils module must exist');

const dateUtils = require(modulePath);
const {
  formatCreatedTime,
  getChinaTimeParts,
  getDateFolderName,
  getTitleTimePart,
  pad2,
} = dateUtils;

for (const [name, value] of Object.entries({
  formatCreatedTime,
  getChinaTimeParts,
  getDateFolderName,
  getTitleTimePart,
  pad2,
})) {
  assert.strictEqual(typeof value, 'function', `${name} must be exported`);
}

assert.strictEqual(pad2(3), '03');
assert.strictEqual(pad2(12), '12');

const crossingMidnightIso = '2026-07-27T16:30:45.000Z';
const crossingMidnightTimestamp = Date.parse(crossingMidnightIso);
const expectedParts = {
  year: 2026,
  month: '07',
  day: '28',
  hour: '00',
  minute: '30',
  second: '45',
};

assert.deepStrictEqual(getChinaTimeParts(crossingMidnightIso), expectedParts);
assert.deepStrictEqual(getChinaTimeParts(crossingMidnightTimestamp), expectedParts);
assert.strictEqual(getDateFolderName(crossingMidnightIso), '2026-07-28');
assert.strictEqual(formatCreatedTime(crossingMidnightIso), '2026-07-28 00:30:45');
assert.strictEqual(getTitleTimePart(crossingMidnightIso), '003045');

const fixedFallbackNow = Date.parse('2026-01-02T03:04:05.000Z');
assert.deepStrictEqual(
  getChinaTimeParts('not-a-date', fixedFallbackNow),
  {
    year: 2026,
    month: '01',
    day: '02',
    hour: '11',
    minute: '04',
    second: '05',
  },
  'invalid dates must preserve the current-time fallback behavior',
);

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'pad2',
  'getChinaTimeParts',
  'getDateFolderName',
  'formatCreatedTime',
  'getTitleTimePart',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./date-utils')"),
  'src/main.js must consume the extracted date utils module',
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
  'pad2',
  'getChinaTimeParts',
  'getDateFolderName',
  'formatCreatedTime',
  'getTitleTimePart',
]) {
  assert.strictEqual(typeof PluginClass.__test[functionName], 'function');
  const input = functionName === 'pad2' ? 3 : crossingMidnightIso;
  assert.deepStrictEqual(
    PluginClass.__test[functionName](input),
    dateUtils[functionName](input),
    `generated plugin helper ${functionName} must match the source module`,
  );
}
