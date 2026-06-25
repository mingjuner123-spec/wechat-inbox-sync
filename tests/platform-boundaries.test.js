const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sharedPath = path.join(root, 'shared', 'platform-rules.js');
const miniPath = path.join(root, 'miniprogram', 'pages', 'index', 'platform-rules.js');
const quickstartPath = path.join(root, 'cloudfunctions', 'quickstartFunctions', 'platform-rules.js');
const syncApiPath = path.join(root, 'cloudfunctions', 'syncApi', 'platform-rules.js');
const pluginMainPath = path.join(root, 'obsidian-plugin', 'wechat-inbox-sync', 'main.js');
const pluginAiMetadataPath = path.join(root, 'obsidian-plugin', 'wechat-inbox-sync', 'ai-metadata.js');
const pluginXiaohongshuCommentsPath = path.join(root, 'obsidian-plugin', 'wechat-inbox-sync', 'xiaohongshu-comments.js');
const pluginFeishuClientVarsPath = path.join(root, 'obsidian-plugin', 'wechat-inbox-sync', 'feishu-client-vars.js');
const mirroredCloudCoreFiles = [
  'admin-core.js',
  'payment-core.js',
  'redeem-code-core.js',
];

const runtimeCopies = [miniPath, quickstartPath, syncApiPath];

assert.ok(fs.existsSync(sharedPath), 'shared platform rules contract must exist');
runtimeCopies.forEach((filePath) => {
  assert.ok(fs.existsSync(filePath), `${filePath} must keep a deployable platform rules copy`);
  assert.strictEqual(
    fs.readFileSync(filePath, 'utf8'),
    fs.readFileSync(sharedPath, 'utf8'),
    `${filePath} must match shared/platform-rules.js exactly`,
  );
});

[
  path.join(root, 'miniprogram', 'pages', 'index', 'inbox-utils.js'),
  path.join(root, 'cloudfunctions', 'quickstartFunctions', 'inbox-core.js'),
  path.join(root, 'cloudfunctions', 'syncApi', 'inbox-core.js'),
].forEach((filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /require\('\.\/platform-rules'\)/, `${filePath} must import platform rules`);
  assert.doesNotMatch(source, /function isSupportedWebpageUrl\(/, `${filePath} must not redefine platform URL support`);
  assert.doesNotMatch(source, /function hasXiaohongshuAudioVideoIntent\(/, `${filePath} must not redefine XHS media intent`);
  assert.doesNotMatch(source, /function isAudioVideoWebpageUrl\(/, `${filePath} must not redefine audio/video platform rules`);
});

const sharedRules = require(sharedPath);
const miniRules = require(miniPath);
const quickstartRules = require(quickstartPath);
const syncApiRules = require(syncApiPath);
const quickstartCore = require('../cloudfunctions/quickstartFunctions/inbox-core');
const syncApiCore = require('../cloudfunctions/syncApi/inbox-core');
const miniUtils = require('../miniprogram/pages/index/inbox-utils');

[
  [quickstartCore, quickstartRules],
  [syncApiCore, syncApiRules],
  [miniUtils, miniRules],
].forEach(([moduleApi, rulesApi]) => {
  assert.strictEqual(moduleApi.extractHttpUrl, rulesApi.extractHttpUrl);
  assert.strictEqual(moduleApi.isSupportedWebpageUrl, rulesApi.isSupportedWebpageUrl);
  assert.strictEqual(moduleApi.isAudioVideoWebpageUrl, rulesApi.isAudioVideoWebpageUrl);
});

assert.strictEqual(sharedRules.isSupportedWebpageUrl('https://mp.weixin.qq.com/s/demo'), true);
assert.strictEqual(sharedRules.isSupportedWebpageUrl('https://xhslink.com/o/abc'), true);
assert.strictEqual(sharedRules.isSupportedWebpageUrl('https://example.com/plain'), false);
assert.strictEqual(sharedRules.isAudioVideoWebpageUrl('https://xhslink.com/o/abc', 'open xiaohongshu note'), false);
assert.strictEqual(sharedRules.isAudioVideoWebpageUrl('https://xhslink.com/a/abc', 'open xiaohongshu video'), true);

mirroredCloudCoreFiles.forEach((fileName) => {
  const quickstartCorePath = path.join(root, 'cloudfunctions', 'quickstartFunctions', fileName);
  const syncApiCorePath = path.join(root, 'cloudfunctions', 'syncApi', fileName);
  assert.strictEqual(
    fs.readFileSync(quickstartCorePath, 'utf8'),
    fs.readFileSync(syncApiCorePath, 'utf8'),
    `${fileName} is copied into both cloud functions; update both copies together`,
  );
});

{
  const pluginMainSource = fs.readFileSync(pluginMainPath, 'utf8');
  assert.match(pluginMainSource, /require\('\.\/ai-metadata'\)/, 'plugin main must import AI metadata helpers');
  [
    'normalizeGeneratedKeywords',
    'parseGeneratedMetadataResponse',
    'normalizeGeneratedMetadataResult',
  ].forEach((functionName) => {
    assert.doesNotMatch(
      pluginMainSource,
      new RegExp(`function ${functionName}\\(`),
      `${functionName} must live in ai-metadata.js`,
    );
  });
  assert.match(
    fs.readFileSync(pluginAiMetadataPath, 'utf8'),
    /function parseGeneratedMetadataResponse\(/,
    'AI metadata parsing must have an isolated module boundary',
  );
  assert.match(pluginMainSource, /\/metadata\/generate/, 'AI metadata is the only plugin API path that should generate AI text');
  assert.doesNotMatch(
    pluginMainSource,
    /\/transcriptions\/cloud/,
    'audio/video transcription must stay local; plugin must not call cloud transcription APIs',
  );
  assert.doesNotMatch(
    pluginMainSource,
    /runCloudFallbackTranscription/,
    'audio/video transcription must not fall back to cloud transcription',
  );
  assert.doesNotMatch(
    pluginMainSource,
    /isCloudTranscriptionWaitingRecord|syncTranscriptionPreferences/,
    'plugin must not keep cloud transcription queue or preference sync entry points',
  );
  assert.doesNotMatch(
    pluginMainSource,
    /await this\.run(?:Aliyun|Doubao|Tencent)Transcription/,
    'audio/video transcription providers must not be API based',
  );
}

{
  const pluginMainSource = fs.readFileSync(pluginMainPath, 'utf8');
  assert.match(pluginMainSource, /require\('\.\/xiaohongshu-comments'\)/, 'plugin main must import XHS comment helpers');
  [
    'extractXiaohongshuNoteIdFromUrl',
    'extractXiaohongshuXsecTokenFromUrl',
    'extractXiaohongshuCommentsFromApiPayload',
    'buildXiaohongshuCommentApiUrl',
  ].forEach((functionName) => {
    assert.doesNotMatch(
      pluginMainSource,
      new RegExp(`function ${functionName}\\(`),
      `${functionName} must live in xiaohongshu-comments.js`,
    );
  });
  const xhsCommentSource = fs.readFileSync(pluginXiaohongshuCommentsPath, 'utf8');
  assert.match(xhsCommentSource, /edith\.xiaohongshu\.com\/api\/sns\/web\/v2\/comment\/page/);
  assert.match(xhsCommentSource, /function extractXiaohongshuCommentsFromApiPayload\(/);
}

{
  const pluginMainSource = fs.readFileSync(pluginMainPath, 'utf8');
  assert.match(pluginMainSource, /require\('\.\/feishu-client-vars'\)/, 'plugin main must import Feishu client-vars helpers');
  [
    'unwrapFeishuClientVarsPayload',
    'collectFeishuRichText',
    'collectFeishuTableRowsFromValue',
    'formatMarkdownTableRows',
    'formatFeishuClientVarBlock',
    'extractFeishuMarkdownFromClientVars',
  ].forEach((functionName) => {
    assert.doesNotMatch(
      pluginMainSource,
      new RegExp(`function ${functionName}\\(`),
      `${functionName} must live in feishu-client-vars.js`,
    );
  });
  const feishuClientVarsSource = fs.readFileSync(pluginFeishuClientVarsPath, 'utf8');
  assert.match(feishuClientVarsSource, /function extractFeishuMarkdownFromClientVars\(/);
  assert.match(feishuClientVarsSource, /function formatMarkdownTableRows\(/);
}
