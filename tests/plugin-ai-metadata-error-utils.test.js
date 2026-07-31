'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'ai-metadata-error-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');
const generatedMainPath = path.join(pluginDir, 'main.js');

assert.ok(fs.existsSync(modulePath), 'AI metadata error utils module must exist');

const {
  buildAiMetadataConversionWarning,
  buildAiMetadataErrorComment,
  classifyAiMetadataError,
} = require(modulePath);

for (const [name, value] of Object.entries({
  buildAiMetadataConversionWarning,
  buildAiMetadataErrorComment,
  classifyAiMetadataError,
})) {
  assert.strictEqual(typeof value, 'function', `${name} must be exported`);
}

const classificationCases = [
  [{ response: { status: 429 } }, 'rate-limited'],
  [{ response: { status: 503 } }, 'upstream-service-error'],
  [new Error('Too many requests from upstream'), 'rate-limited'],
  [new Error('Request ETIMEDOUT'), 'request-timeout'],
  [new Error('AI returned an empty response'), 'empty-response'],
  [new Error('unexpected failure'), 'service-error'],
];

for (const [error, expected] of classificationCases) {
  assert.strictEqual(classifyAiMetadataError(error), expected);
}

assert.strictEqual(
  buildAiMetadataErrorComment({ response: { status: 429 } }),
  '<!-- wechat-inbox-ai-metadata-error: rate-limited -->',
);

const warningCases = [
  ['rate-limited', '正文已同步，但 AI 简介/关键词未生成（请求过于频繁）。'],
  ['upstream-service-error', '正文已同步，但 AI 简介/关键词未生成（AI 服务暂时异常）。'],
  ['request-timeout', '正文已同步，但 AI 简介/关键词未生成（AI 请求超时）。'],
  ['empty-response', '正文已同步，但 AI 简介/关键词未生成（AI 未返回可用结果）。'],
  ['service-error', '正文已同步，但 AI 简介/关键词未生成（AI 服务暂时不可用）。'],
];

for (const [error, expected] of warningCases) {
  assert.strictEqual(buildAiMetadataConversionWarning(error), expected);
}

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'classifyAiMetadataError',
  'buildAiMetadataErrorComment',
  'buildAiMetadataConversionWarning',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./ai-metadata-error-utils')"),
  'src/main.js must consume the extracted AI metadata error module',
);

const generatedMain = fs.readFileSync(generatedMainPath, 'utf8');
assert.ok(
  generatedMain.includes('wechat-inbox-ai-metadata-error:'),
  'generated main.js must contain the AI metadata diagnostic marker',
);
assert.ok(
  generatedMain.includes('正文已同步，但 AI 简介/关键词未生成'),
  'generated main.js must contain the existing user-facing warning contract',
);
