const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadPlugin } = require('./helpers/load-plugin');

const repoRoot = path.resolve(__dirname, '..');
const pluginMainSource = fs.readFileSync(path.join(repoRoot, 'main.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
const versions = JSON.parse(fs.readFileSync(path.join(repoRoot, 'versions.json'), 'utf8'));
const PluginClass = loadPlugin();
const helpers = PluginClass.__test;

assert.strictEqual(manifest.version, '1.2.80');
assert.strictEqual(versions['1.2.80'], manifest.minAppVersion);

assert.strictEqual(pluginMainSource.includes('/transcriptions/cloud'), false);
assert.strictEqual(pluginMainSource.includes('runCloudFallbackTranscription'), false);
assert.strictEqual(pluginMainSource.includes('isCloudTranscriptionWaitingRecord'), false);
assert.strictEqual(pluginMainSource.includes('syncTranscriptionPreferences'), false);
assert.ok(pluginMainSource.includes('/metadata/generate'));
assert.ok(pluginMainSource.includes("source: 'local'"));

assert.strictEqual(typeof helpers.extractXiaohongshuCommentsFromApiPayload, 'function');
assert.strictEqual(typeof helpers.buildSocialCommentsMarkdown, 'function');
assert.strictEqual(typeof helpers.extractFeishuMarkdownFromHtml, 'function');
assert.strictEqual(typeof helpers.extractFeishuMarkdownFromClientVars, 'function');
assert.strictEqual(typeof helpers.normalizeGeneratedKeywords, 'function');
assert.strictEqual(typeof helpers.parseGeneratedMetadataResponse, 'function');
assert.strictEqual(typeof helpers.buildMarkdownForRecord, 'function');
assert.strictEqual(typeof PluginClass.prototype.runConfiguredTranscription, 'function');
assert.strictEqual(PluginClass.prototype.runCloudFallbackTranscription, undefined);
assert.strictEqual(PluginClass.prototype.syncTranscriptionPreferences, undefined);

const settings = helpers.mergeSettings({});
assert.strictEqual(settings.aiMetadataEnabled, true);
assert.strictEqual(settings.xiaohongshuCommentsEnabled, true);
assert.strictEqual(settings.notePropertyFields, 'title,author,url,synced_at,source,description,keywords');

console.log('plugin main release checks passed');
