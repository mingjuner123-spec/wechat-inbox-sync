'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const candidateCorePath = path.join(repoRoot, 'scripts', 'plugin-release-candidate-core.js');

function loadCandidateCore() {
  let loaded;
  assert.doesNotThrow(() => {
    loaded = require(candidateCorePath);
  }, 'plugin release candidate core must exist');
  return loaded;
}

function writeFixtureFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createPackageFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-release-candidate-'));
  const pluginRoot = path.join(tempRoot, 'obsidian-plugin', 'wechat-inbox-sync');
  const files = {
    'main.js': "'use strict';\r\nmodule.exports = {};\r\n",
    'manifest.json': '{\r\n  "id": "wechat-inbox-sync",\r\n  "version": "9.9.9"\r\n}\r\n',
    'styles.css': '.notice {\r\n  color: red;\r\n}\r\n',
    'versions.json': '{\r\n  "9.9.9": "1.0.0"\r\n}\r\n',
    'README.md': '# Fixture\r\n',
    LICENSE: 'MIT\r\n',
    'local-asr/install-local-asr-macos.sh': '#!/bin/sh\r\necho asr\r\n',
    'local-asr/install-local-asr.ps1': 'Write-Output "asr"\r\n',
    'local-ocr/install-local-ocr-macos.sh': '#!/bin/sh\r\necho ocr\r\n',
    'local-ocr/install-local-ocr.ps1': 'Write-Output "ocr"\r\n',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    writeFixtureFile(pluginRoot, relativePath, content);
  }
  return {
    tempRoot,
    pluginRoot,
    cleanup() {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

test('root artifacts directory is ignored without hiding unrelated directories', () => {
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\/\.artifacts\/$/m);
  assert.doesNotMatch(gitignore, /^\*?\.artifacts/m);
});

test('candidate task card includes every permanent governance path', () => {
  const card = fs.readFileSync(
    path.join(repoRoot, 'docs', 'task-cards', 'plugin-release-pipeline-v2-001.md'),
    'utf8',
  );
  for (const required of [
    '.gitignore',
    'release-candidate.json',
    'docs/DECISIONS.md',
    'docs/WORKLOG.md',
    'obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md',
  ]) {
    assert.ok(card.includes(required), `missing allowed path: ${required}`);
  }
});

test('candidate identity covers the exact release ZIP set with deterministic POSIX paths', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const {
    enumeratePackageEntries,
    buildCandidateIdentity,
    validateCandidateIdentity,
  } = loadCandidateCore();

  const entries = enumeratePackageEntries(fixture.pluginRoot);
  assert.deepEqual(entries.map((entry) => entry.path), [
    'LICENSE',
    'README.md',
    'local-asr/install-local-asr-macos.sh',
    'local-asr/install-local-asr.ps1',
    'local-ocr/install-local-ocr-macos.sh',
    'local-ocr/install-local-ocr.ps1',
    'main.js',
    'manifest.json',
    'styles.css',
    'versions.json',
  ]);

  const identity = buildCandidateIdentity({
    pluginId: 'wechat-inbox-sync',
    pluginVersion: '9.9.9',
    sourceRoot: 'obsidian-plugin/wechat-inbox-sync',
    entries,
  });
  assert.equal(identity.candidateId, `9.9.9-${identity.aggregateSha256.slice(0, 16)}`);
  assert.equal(validateCandidateIdentity(identity, {
    expectedDirectoryName: identity.candidateId,
  }), true);
  assert.deepEqual(identity.looseAssets, [
    'main.js',
    'manifest.json',
    'styles.css',
    'versions.json',
  ]);
});

test('CRLF and LF package trees produce the same staged bytes and identity', (t) => {
  const left = createPackageFixture();
  const right = createPackageFixture();
  t.after(left.cleanup);
  t.after(right.cleanup);
  const {
    enumeratePackageEntries,
    buildCandidateIdentity,
  } = loadCandidateCore();

  for (const relativePath of [
    'main.js',
    'manifest.json',
    'styles.css',
    'versions.json',
    'README.md',
    'LICENSE',
    'local-asr/install-local-asr-macos.sh',
    'local-asr/install-local-asr.ps1',
    'local-ocr/install-local-ocr-macos.sh',
    'local-ocr/install-local-ocr.ps1',
  ]) {
    const rightPath = path.join(right.pluginRoot, ...relativePath.split('/'));
    const content = fs.readFileSync(rightPath, 'utf8').replace(/\r\n?/g, '\n');
    fs.writeFileSync(rightPath, content, 'utf8');
  }

  const leftEntries = enumeratePackageEntries(left.pluginRoot);
  const rightEntries = enumeratePackageEntries(right.pluginRoot);
  assert.deepEqual(
    leftEntries.map(({ path: entryPath, bytes, sha256 }) => ({ path: entryPath, bytes, sha256 })),
    rightEntries.map(({ path: entryPath, bytes, sha256 }) => ({ path: entryPath, bytes, sha256 })),
  );
  assert.equal(
    buildCandidateIdentity({
      pluginId: 'wechat-inbox-sync',
      pluginVersion: '9.9.9',
      sourceRoot: 'obsidian-plugin/wechat-inbox-sync',
      entries: leftEntries,
    }).aggregateSha256,
    buildCandidateIdentity({
      pluginId: 'wechat-inbox-sync',
      pluginVersion: '9.9.9',
      sourceRoot: 'obsidian-plugin/wechat-inbox-sync',
      entries: rightEntries,
    }).aggregateSha256,
  );
});

test('canonical paths reject traversal, aliases, and case-fold collisions', () => {
  const {
    normalizeRelativePackagePath,
    assertCanonicalEntryPaths,
  } = loadCandidateCore();

  for (const invalid of [
    '../main.js',
    '/main.js',
    'C:/main.js',
    'local-asr\\install.ps1',
    'local-asr//install.ps1',
    './main.js',
    'local-asr/../main.js',
    'local-asr/\u0065\u0301.ps1',
  ]) {
    assert.throws(() => normalizeRelativePackagePath(invalid), /path|canonical|relative|NFC/i);
  }
  assert.throws(() => assertCanonicalEntryPaths([
    { path: 'local-asr/A.ps1' },
    { path: 'local-asr/a.ps1' },
  ]), /collision|duplicate/i);
});

test('candidate identity detects entry, aggregate, and directory drift', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const {
    enumeratePackageEntries,
    buildCandidateIdentity,
    validateCandidateIdentity,
  } = loadCandidateCore();
  const identity = buildCandidateIdentity({
    pluginId: 'wechat-inbox-sync',
    pluginVersion: '9.9.9',
    sourceRoot: 'obsidian-plugin/wechat-inbox-sync',
    entries: enumeratePackageEntries(fixture.pluginRoot),
  });

  assert.throws(
    () => validateCandidateIdentity({
      ...identity,
      aggregateSha256: '0'.repeat(64),
    }),
    /aggregate|identity/i,
  );
  assert.throws(
    () => validateCandidateIdentity(identity, { expectedDirectoryName: 'wrong-candidate' }),
    /directory|candidate/i,
  );
  assert.throws(
    () => validateCandidateIdentity({
      ...identity,
      entries: identity.entries.map((entry, index) => (
        index === 0 ? { ...entry, bytes: entry.bytes + 1 } : entry
      )),
    }),
    /bytes|aggregate|identity/i,
  );
});

test('package enumeration rejects symbolic links and non-regular entries', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const { enumeratePackageEntries } = loadCandidateCore();
  const targetPath = path.join(fixture.pluginRoot, 'local-asr', 'install-local-asr.ps1');
  const linkPath = path.join(fixture.pluginRoot, 'local-asr', 'linked-installer.ps1');
  try {
    fs.symlinkSync(targetPath, linkPath, 'file');
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`);
    return;
  }
  assert.throws(() => enumeratePackageEntries(fixture.pluginRoot), /symbolic|link|regular|reparse/i);
});
