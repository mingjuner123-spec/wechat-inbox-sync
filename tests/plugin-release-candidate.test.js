'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
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

function runNode(scriptRelativePath, args, options = {}) {
  return childProcess.spawnSync(
    process.execPath,
    [path.join(repoRoot, ...scriptRelativePath.split('/')), ...args],
    {
      cwd: options.cwd || repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    },
  );
}

function parseJsonOutput(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runPowerShell(scriptPath, args, options = {}) {
  return childProcess.spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
    {
      cwd: options.cwd || repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    },
  );
}

function snapshotManagedTree(root) {
  const output = {};
  const visit = (directory, prefix = '') => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${item.name}` : item.name;
      const absolutePath = path.join(directory, item.name);
      if (item.isDirectory()) {
        visit(absolutePath, relativePath);
      } else {
        output[relativePath] = fs.readFileSync(absolutePath).toString('hex');
      }
    }
  };
  visit(root);
  return output;
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

test('prepare creates an immutable full-package candidate and reuses identical identity', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const artifactsRoot = path.join(fixture.tempRoot, '.artifacts', 'plugin');
  const args = [
    '--source', fixture.pluginRoot,
    '--artifacts-root', artifactsRoot,
  ];

  const first = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', args));
  assert.match(first.candidateId, /^9\.9\.9-[a-f0-9]{16}$/);
  assert.ok(fs.existsSync(path.join(first.candidateDirectory, 'candidate.json')));
  assert.ok(fs.existsSync(path.join(
    first.candidateDirectory,
    'package',
    'local-asr',
    'install-local-asr.ps1',
  )));
  assert.equal(
    fs.readFileSync(path.join(first.candidateDirectory, 'package', 'main.js'), 'utf8').includes('\r'),
    false,
  );

  const second = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', args));
  assert.equal(second.candidateId, first.candidateId);
  assert.equal(second.candidateDirectory, first.candidateDirectory);
});

test('prepare refuses a conflicting pre-existing candidate directory', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const artifactsRoot = path.join(fixture.tempRoot, '.artifacts', 'plugin');
  const prepared = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', artifactsRoot,
  ]));
  fs.writeFileSync(path.join(prepared.candidateDirectory, 'package', 'main.js'), 'corrupt', 'utf8');

  const repeated = runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', artifactsRoot,
  ]);
  assert.notEqual(repeated.status, 0);
  assert.match(`${repeated.stderr}\n${repeated.stdout}`, /existing|candidate|drift|different/i);
});

test('verify detects controlled drift but ignores opaque install-only user files', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const artifactsRoot = path.join(fixture.tempRoot, '.artifacts', 'plugin');
  const prepared = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', artifactsRoot,
  ]));
  const installedRoot = path.join(
    fixture.tempRoot,
    'vault',
    '.obsidian',
    'plugins',
    'wechat-inbox-sync',
  );
  fs.cpSync(path.join(prepared.candidateDirectory, 'package'), installedRoot, { recursive: true });
  fs.writeFileSync(path.join(installedRoot, 'data.json'), '{"opaque":"keep"}', 'utf8');
  fs.writeFileSync(path.join(installedRoot, 'local-user-note.txt'), 'keep', 'utf8');

  const valid = runNode('scripts/verify-plugin-release-candidate.js', [
    '--candidate', prepared.candidateDirectory,
    '--source', fixture.pluginRoot,
    '--installed', installedRoot,
  ]);
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);

  fs.writeFileSync(path.join(installedRoot, 'main.js'), 'drift', 'utf8');
  const invalid = runNode('scripts/verify-plugin-release-candidate.js', [
    '--candidate', prepared.candidateDirectory,
    '--source', fixture.pluginRoot,
    '--installed', installedRoot,
  ]);
  assert.notEqual(invalid.status, 0);
  assert.match(`${invalid.stderr}\n${invalid.stdout}`, /main\.js|drift|mismatch/i);
});

test('candidate provenance does not participate in deterministic identity', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const prepared = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', path.join(fixture.tempRoot, '.artifacts', 'plugin'),
  ]));
  const receiptPath = path.join(prepared.candidateDirectory, 'candidate.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  receipt.provenance = {
    createdAt: '2099-01-01T00:00:00.000Z',
    sourceHead: 'f'.repeat(40),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

  const result = runNode('scripts/verify-plugin-release-candidate.js', [
    '--candidate', prepared.candidateDirectory,
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('candidate installer is declared for PowerShell parser and Windows behavior gates', () => {
  const installerRelativePath = 'scripts/install-plugin-release-candidate.ps1';
  const installerPath = path.join(repoRoot, ...installerRelativePath.split('/'));
  assert.ok(fs.existsSync(installerPath), 'candidate installer must exist');
  const installer = fs.readFileSync(installerPath, 'utf8');
  assert.match(installer, /CandidateDirectory/);
  assert.match(installer, /TargetDirectory/);
  assert.match(installer, /TestFailAfterSecondEntry/);

  const mainWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'main-guards.yml'),
    'utf8',
  );
  const releaseWorkflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.ok(mainWorkflow.includes(installerRelativePath));
  assert.ok(releaseWorkflow.includes(installerRelativePath));
  assert.match(mainWorkflow, /windows-deployer:[\s\S]*plugin-release-candidate\.test\.js/);
});

test('Windows target junction cannot alias the canonical source', {
  skip: process.platform !== 'win32',
}, (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const prepared = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', path.join(fixture.tempRoot, '.artifacts', 'plugin'),
  ]));
  const target = path.join(
    fixture.tempRoot,
    'junction-vault',
    '.obsidian',
    'plugins',
    'wechat-inbox-sync',
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(fixture.pluginRoot, target, 'junction');

  const result = runPowerShell(
    path.join(repoRoot, 'scripts', 'install-plugin-release-candidate.ps1'),
    [
      '-CandidateDirectory', prepared.candidateDirectory,
      '-TargetDirectory', target,
      '-RepositoryRoot', repoRoot,
      '-SkipObsidianProcessCheckForTest',
    ],
    { env: { WECHAT_INBOX_CANDIDATE_TEST: '1' } },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /junction|reparse|symlink/i);
});

test('Windows candidate install is transactional and preserves opaque user files', {
  skip: process.platform !== 'win32',
}, (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const prepared = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', path.join(fixture.tempRoot, '.artifacts', 'plugin'),
  ]));
  const target = path.join(
    fixture.tempRoot,
    'vault',
    '.obsidian',
    'plugins',
    'wechat-inbox-sync',
  );
  fs.cpSync(path.join(prepared.candidateDirectory, 'package'), target, { recursive: true });
  fs.writeFileSync(path.join(target, 'main.js'), 'old-main', 'utf8');
  fs.writeFileSync(path.join(target, 'data.json'), '{"opaque":"preserve-exactly"}', 'utf8');
  fs.writeFileSync(path.join(target, 'local-user-note.txt'), 'local-only', 'utf8');
  const dataBefore = fs.readFileSync(path.join(target, 'data.json'));
  const localBefore = fs.readFileSync(path.join(target, 'local-user-note.txt'));
  const installerPath = path.join(repoRoot, 'scripts', 'install-plugin-release-candidate.ps1');
  const commonArgs = [
    '-CandidateDirectory', prepared.candidateDirectory,
    '-TargetDirectory', target,
    '-RepositoryRoot', repoRoot,
    '-SkipObsidianProcessCheckForTest',
  ];

  const installed = runPowerShell(installerPath, commonArgs, {
    env: { WECHAT_INBOX_CANDIDATE_TEST: '1' },
  });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  assert.deepEqual(fs.readFileSync(path.join(target, 'data.json')), dataBefore);
  assert.deepEqual(fs.readFileSync(path.join(target, 'local-user-note.txt')), localBefore);
  const verify = runNode('scripts/verify-plugin-release-candidate.js', [
    '--candidate', prepared.candidateDirectory,
    '--installed', target,
  ]);
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);

  fs.writeFileSync(path.join(target, 'main.js'), 'rollback-main', 'utf8');
  fs.writeFileSync(path.join(target, 'styles.css'), 'rollback-styles', 'utf8');
  const beforeFailure = snapshotManagedTree(target);
  const failed = runPowerShell(installerPath, [...commonArgs, '-TestFailAfterSecondEntry'], {
    env: { WECHAT_INBOX_CANDIDATE_TEST: '1' },
  });
  assert.notEqual(failed.status, 0);
  assert.deepEqual(snapshotManagedTree(target), beforeFailure);
});

test('Windows candidate installer rejects an ordinary same-name target', {
  skip: process.platform !== 'win32',
}, (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const prepared = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', path.join(fixture.tempRoot, '.artifacts', 'plugin'),
  ]));
  const wrongTarget = path.join(fixture.tempRoot, 'wechat-inbox-sync');
  fs.mkdirSync(wrongTarget, { recursive: true });
  const result = runPowerShell(
    path.join(repoRoot, 'scripts', 'install-plugin-release-candidate.ps1'),
    [
      '-CandidateDirectory', prepared.candidateDirectory,
      '-TargetDirectory', wrongTarget,
      '-RepositoryRoot', repoRoot,
      '-SkipObsidianProcessCheckForTest',
    ],
    { env: { WECHAT_INBOX_CANDIDATE_TEST: '1' } },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /\.obsidian|plugins|target/i);
});
