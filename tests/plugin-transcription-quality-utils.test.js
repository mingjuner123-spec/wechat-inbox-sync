'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'transcription-quality-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');
const generatedMainPath = path.join(pluginDir, 'main.js');

assert.ok(fs.existsSync(modulePath), 'transcription quality utils module must exist');

const qualityUtils = require(modulePath);
const {
  assertUsableTranscription,
  createTranscriptionQualityError,
  dedupeRepeatedTranscriptionLines,
  getTranscriptionQualityIssue,
  getTranscriptionQualityUnits,
  normalizeTranscriptionQualityUnit,
} = qualityUtils;

for (const [name, value] of Object.entries({
  assertUsableTranscription,
  createTranscriptionQualityError,
  dedupeRepeatedTranscriptionLines,
  getTranscriptionQualityIssue,
  getTranscriptionQualityUnits,
  normalizeTranscriptionQualityUnit,
})) {
  assert.strictEqual(typeof value, 'function', `${name} must be exported`);
}

assert.strictEqual(
  dedupeRepeatedTranscriptionLines('第一句\n第一句\n第二句\n第一句'),
  '第一句\n第二句\n第一句',
  'only adjacent duplicate lines should be removed',
);
assert.strictEqual(dedupeRepeatedTranscriptionLines(' \n '), '');
assert.strictEqual(normalizeTranscriptionQualityUnit(' Hello，世界！ '), 'hello世界');
assert.deepStrictEqual(getTranscriptionQualityUnits('第一段正常内容。\n第二段正常内容。\n第三段正常内容。'), [
  '第一段正常内容',
  '第二段正常内容',
  '第三段正常内容',
]);

const repeatedText = Array(12).fill('我们现在就来看看我们的临化设备').join('\n');
assert.strictEqual(getTranscriptionQualityIssue(repeatedText), 'repeated-lines');
assert.strictEqual(
  getTranscriptionQualityIssue('请输入简体中文\n请输出简体中文'),
  'prompt-leak',
);
assert.strictEqual(
  getTranscriptionQualityIssue('这是第一段正常内容。\n这里为了强调重复一次。\n这里为了强调重复一次。\n最后继续讲新的内容。'),
  '',
  'two adjacent repetitions in otherwise normal text must remain accepted',
);

const qualityError = createTranscriptionQualityError(repeatedText, '测试转写');
assert.strictEqual(qualityError.code, 'TRANSCRIPTION_LOW_QUALITY');
assert.strictEqual(qualityError.qualityIssue, 'repeated-lines');
assert.match(qualityError.message, /测试转写结果质量异常/);

assert.strictEqual(assertUsableTranscription(' 正常转写结果 ', '测试转写'), '正常转写结果');
assert.throws(
  () => assertUsableTranscription('', '测试转写'),
  /测试转写命令没有返回文本/,
);
assert.throws(
  () => assertUsableTranscription(repeatedText, '测试转写'),
  (error) => error && error.code === 'TRANSCRIPTION_LOW_QUALITY',
);

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'dedupeRepeatedTranscriptionLines',
  'normalizeTranscriptionQualityUnit',
  'getTranscriptionQualityUnits',
  'getTranscriptionQualityIssue',
  'createTranscriptionQualityError',
  'assertUsableTranscription',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./transcription-quality-utils')"),
  'src/main.js must consume the extracted transcription quality module',
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

assert.strictEqual(PluginClass.__test.getTranscriptionQualityIssue(repeatedText), 'repeated-lines');
assert.strictEqual(
  PluginClass.__test.createTranscriptionQualityError(repeatedText, '测试转写').code,
  'TRANSCRIPTION_LOW_QUALITY',
);
assert.strictEqual(
  PluginClass.__test.assertUsableTranscription('正常转写结果', '测试转写'),
  '正常转写结果',
);
