const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pluginDir = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
const versions = JSON.parse(fs.readFileSync(path.join(pluginDir, 'versions.json'), 'utf8'));
const readme = fs.readFileSync(path.join(pluginDir, 'README.md'), 'utf8');
const license = fs.readFileSync(path.join(pluginDir, 'LICENSE'), 'utf8');
const checklist = fs.readFileSync(path.join(pluginDir, 'RELEASE_CHECKLIST.md'), 'utf8');
const macInstaller = fs.readFileSync(path.join(pluginDir, 'local-asr/install-local-asr-macos.sh'), 'utf8');

assert.strictEqual(manifest.id, 'wechat-inbox-sync');
assert.strictEqual(manifest.id.includes('obsidian'), false);
assert.strictEqual(manifest.name, 'WeChat Inbox Sync');
assert.strictEqual(manifest.version, '1.1.10');
assert.strictEqual(manifest.minAppVersion, '1.0.0');
assert.strictEqual(manifest.isDesktopOnly, true);
assert.strictEqual(versions[manifest.version], manifest.minAppVersion);

['main.js', 'manifest.json', 'styles.css', 'versions.json', 'README.md', 'LICENSE', 'local-asr/install-local-asr.ps1', 'local-asr/install-local-asr-macos.sh', 'local-asr/README.md'].forEach((fileName) => {
  assert.strictEqual(fs.existsSync(path.join(pluginDir, fileName)), true, `${fileName} should exist`);
});

assert.ok(readme.includes('## Privacy'));
assert.ok(readme.includes('## Installation'));
assert.ok(readme.includes('## Configuration'));
assert.ok(readme.includes('WeChat mini program'));
assert.ok(license.includes('MIT License'));
assert.ok(checklist.includes('community-plugins.json'));
assert.ok(checklist.includes('"id": "wechat-inbox-sync"'));
assert.ok(macInstaller.includes('brew_install_formula whisper-cpp'));
assert.ok(macInstaller.includes('brew reinstall whisper-cpp'));
assert.ok(macInstaller.includes('hf-mirror.com/ggerganov/whisper.cpp'));
assert.ok(macInstaller.includes('No Terminal command is required.'));
