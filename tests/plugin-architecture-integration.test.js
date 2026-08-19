'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginRoot = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const sourceRoot = path.join(pluginRoot, 'src');
const sourcePath = path.join(sourceRoot, 'main.js');
const bundlePath = path.join(pluginRoot, 'main.js');
const manifestPath = path.join(pluginRoot, 'manifest.json');
const versionsPath = path.join(pluginRoot, 'versions.json');

const expectedModules = [
  'ai-metadata-error-utils',
  'ai-metadata-utils',
  'cloud-transcription-response-utils',
  'date-utils',
  'diagnostic-redaction-utils',
  'document-text-extraction-utils',
  'feishu-markdown-utils',
  'input-normalization-utils',
  'local-douyin-resolver-utils',
  'media-file-utils',
  'note-output-plan-utils',
  'progress-notice-utils',
  'record-body-markdown-utils',
  'record-identity-utils',
  'record-metadata-utils',
  'record-state-utils',
  'social-comments-markdown-utils',
  'social-engagement-utils',
  'social-media-context-utils',
  'social-media-diagnostic-utils',
  'social-platform-content-utils',
  'sync-lifecycle-utils',
  'transcription-note-title-utils',
  'transcription-quality-utils',
  'vault-path-utils',
  'wechat-article-pipeline',
  'wechat-article-utils',
  'wechat-channels-decrypt-utils',
  'xiaohongshu-markdown-utils',
].sort();

const source = fs.readFileSync(sourcePath, 'utf8');
const referencedModules = Array.from(source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g))
  .map((match) => match[1])
  .sort();

assert.deepStrictEqual(
  referencedModules,
  expectedModules,
  'src/main.js must wire the complete frozen module set without hidden or missing local modules',
);

for (const moduleName of expectedModules) {
  const modulePath = path.join(sourceRoot, `${moduleName}.js`);
  assert.ok(fs.existsSync(modulePath), `integrated module must exist: ${moduleName}.js`);
  assert.doesNotThrow(() => new Function(fs.readFileSync(modulePath, 'utf8')),
    `integrated module must parse: ${moduleName}.js`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
assert.strictEqual(manifest.id, 'wechat-inbox-sync');
assert.strictEqual(manifest.version, '1.3.104');
assert.ok(Object.prototype.hasOwnProperty.call(versions, '1.3.92'));

const builder = require(path.join(pluginRoot, 'build-plugin.js'));
assert.strictEqual(builder.checkPluginBuild(), true, 'committed bundle must match the integrated source');
const firstBuild = builder.getPluginBuildBytes();
const secondBuild = builder.getPluginBuildBytes();
assert.deepStrictEqual(firstBuild, secondBuild, 'integrated builds must be byte-for-byte deterministic');
assert.deepStrictEqual(firstBuild, fs.readFileSync(bundlePath), 'generated bundle must be committed without drift');

console.log(`plugin architecture integration passed (${expectedModules.length} modules, ${manifest.version})`);
