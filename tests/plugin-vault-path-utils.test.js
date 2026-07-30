'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'vault-path-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');

assert.ok(fs.existsSync(modulePath), 'Vault path utils module must exist');

const {
  normalizeConfiguredVaultPath,
  normalizeVaultPath,
  shouldPersistNormalizedInboxDir,
} = require(modulePath);

for (const [name, value] of Object.entries({
  normalizeConfiguredVaultPath,
  normalizeVaultPath,
  shouldPersistNormalizedInboxDir,
})) {
  assert.strictEqual(typeof value, 'function', `${name} must be exported`);
}

assert.strictEqual(normalizeVaultPath(), '');
assert.strictEqual(normalizeVaultPath('  inbox  '), '  inbox  ');
assert.strictEqual(normalizeVaultPath('/inbox//2026/'), 'inbox/2026');
assert.strictEqual(normalizeVaultPath('\\inbox\\\\2026\\'), 'inbox/2026');
assert.strictEqual(normalizeVaultPath('C:\\vault\\inbox'), 'C:/vault/inbox');

const fallback = '\\临时收集\\';
for (const unsafeValue of [
  '',
  '   ',
  '/absolute/path',
  '\\absolute\\path',
  'C:\\vault\\inbox',
  'd:/vault/inbox',
  '\\\\server\\share\\inbox',
  'inbox\0drafts',
  '.',
  '..',
  './inbox',
  '../inbox',
  'inbox/./drafts',
  'inbox/../drafts',
]) {
  assert.strictEqual(
    normalizeConfiguredVaultPath(unsafeValue, fallback),
    '临时收集',
    `unsafe configured path must fall back: ${JSON.stringify(unsafeValue)}`,
  );
}

assert.strictEqual(normalizeConfiguredVaultPath('inbox\\\\2026//July/', fallback), 'inbox/2026/July');
assert.strictEqual(normalizeConfiguredVaultPath('  inbox/2026  ', fallback), 'inbox/2026');
assert.strictEqual(normalizeConfiguredVaultPath('', 'fallback//nested/'), 'fallback/nested');
assert.strictEqual(normalizeConfiguredVaultPath('/absolute/path'), '临时收集');
assert.strictEqual(normalizeConfiguredVaultPath('/absolute/path', undefined), '临时收集');
assert.strictEqual(normalizeConfiguredVaultPath('/absolute/path', ''), '临时收集');
assert.strictEqual(normalizeConfiguredVaultPath('', '/'), '临时收集');

assert.strictEqual(shouldPersistNormalizedInboxDir(undefined, { inboxDir: 'inbox' }), true);
assert.strictEqual(shouldPersistNormalizedInboxDir(null, { inboxDir: 'inbox' }), true);
assert.strictEqual(shouldPersistNormalizedInboxDir('not-an-object', { inboxDir: 'inbox' }), true);
assert.strictEqual(shouldPersistNormalizedInboxDir({}, { inboxDir: '' }), false);
assert.strictEqual(
  shouldPersistNormalizedInboxDir({ inboxDir: ' inbox ' }, { inboxDir: 'inbox' }),
  false,
);
assert.strictEqual(shouldPersistNormalizedInboxDir({ inboxDir: 'old' }, { inboxDir: 'new' }), true);
assert.strictEqual(shouldPersistNormalizedInboxDir({ inboxDir: 'inbox' }, undefined), true);

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'normalizeConfiguredVaultPath',
  'normalizeVaultPath',
  'shouldPersistNormalizedInboxDir',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./vault-path-utils')"),
  'src/main.js must consume the extracted Vault path module',
);
