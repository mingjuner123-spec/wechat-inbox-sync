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

test('prepare can require an existing promotion receipt to match the candidate', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const artifactsRoot = path.join(fixture.tempRoot, '.artifacts', 'plugin');
  const prepared = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', artifactsRoot,
  ]));
  const candidateReceipt = JSON.parse(fs.readFileSync(
    path.join(prepared.candidateDirectory, 'candidate.json'),
    'utf8',
  ));
  const promotionPath = path.join(fixture.tempRoot, 'release-candidate.json');
  fs.writeFileSync(
    promotionPath,
    `${JSON.stringify(candidateReceipt.identity, null, 2)}\n`,
    'utf8',
  );

  const verified = runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', artifactsRoot,
    '--verify-promotion', promotionPath,
  ]);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);

  const drifted = { ...candidateReceipt.identity, candidateId: '9.9.9-deadbeefdeadbeef' };
  fs.writeFileSync(promotionPath, JSON.stringify(drifted), 'utf8');
  const rejected = runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', artifactsRoot,
    '--verify-promotion', promotionPath,
  ]);
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stderr}\n${rejected.stdout}`, /promotion|candidate|identity/i);
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

test('main guards and release checklist enforce the committed tested candidate', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'main-guards.yml'),
    'utf8',
  );
  for (const required of [
    'tests/plugin-release-candidate.test.js',
    'prepare-plugin-release-candidate.js',
    '--verify-promotion release-candidate.json',
    'sync-plugin-release-mirror.js --check',
  ]) {
    assert.ok(workflow.includes(required), `main guard misses ${required}`);
  }
  const checklist = fs.readFileSync(
    path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync', 'RELEASE_CHECKLIST.md'),
    'utf8',
  );
  for (const required of [
    'prepare-plugin-release-candidate.js',
    'install-plugin-release-candidate.ps1',
    'verify-plugin-release-candidate.js',
    'sync-plugin-release-mirror.js --write',
    'promote-plugin-release-candidate.js',
    'release-candidate.json',
  ]) {
    assert.ok(checklist.includes(required), `release checklist misses ${required}`);
  }
});

test('release workflow packages and publishes only the verified candidate package', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  const orderedMarkers = [
    'Prepare verified release candidate',
    '--verify-promotion release-candidate.json',
    'Package plugin release assets',
    'PACKAGE_DIR=',
    'Publish GitHub release',
    'check-plugin-release-identity.js --postpublish',
  ];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const index = workflow.indexOf(marker);
    assert.ok(index > previousIndex, `release workflow ordering misses ${marker}`);
    previousIndex = index;
  }
  assert.match(workflow, /zip -r "\$ZIP_PATH"[\s\S]*main\.js manifest\.json styles\.css versions\.json README\.md LICENSE local-asr local-ocr/);
  assert.match(workflow, /gh release create "\$TAG_NAME" "\$PACKAGE_DIR\/main\.js"/);
  const packageDirectoryAssignment = 'PACKAGE_DIR="$(node -p "JSON.parse(require(\'fs\').readFileSync(\'.artifacts/release-candidate-result.json\', \'utf8\')).packageDirectory")"';
  assert.equal(
    workflow.split(packageDirectoryAssignment).length - 1,
    2,
    'both package and publish steps must resolve PACKAGE_DIR from the verified candidate result',
  );
  const normalizedWorkflow = workflow
    .replace(/\\\r?\n\s*/g, ' ')
    .replace(/\s+/g, ' ');
  assert.ok(
    normalizedWorkflow.includes(
      'gh release create "$TAG_NAME" "$PACKAGE_DIR/main.js" "$PACKAGE_DIR/manifest.json" '
      + '"$PACKAGE_DIR/styles.css" "$PACKAGE_DIR/versions.json" "$ZIP_PATH" --title',
    ),
    'gh release create must receive exactly the four candidate loose assets and candidate ZIP',
  );
  assert.equal(
    workflow.trim().endsWith(
      'node scripts/check-plugin-release-identity.js --postpublish --tag "$TAG_NAME"',
    ),
    true,
    'postpublish identity verification must remain the final non-empty workflow command',
  );
  assert.doesNotMatch(
    workflow,
    /cd obsidian-plugin\/wechat-inbox-sync[\s\S]*zip -r/,
    'release ZIP must not be created from the mutable source working directory',
  );
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

test('Windows candidate keeps the verified new install when backup cleanup is interrupted', {
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
    'cleanup-vault',
    '.obsidian',
    'plugins',
    'wechat-inbox-sync',
  );
  fs.cpSync(path.join(prepared.candidateDirectory, 'package'), target, { recursive: true });
  fs.writeFileSync(path.join(target, 'main.js'), 'old-main', 'utf8');

  const result = runPowerShell(
    path.join(repoRoot, 'scripts', 'install-plugin-release-candidate.ps1'),
    [
      '-CandidateDirectory', prepared.candidateDirectory,
      '-TargetDirectory', target,
      '-RepositoryRoot', repoRoot,
      '-SkipObsidianProcessCheckForTest',
      '-TestFailBackupCleanup',
    ],
    { env: { WECHAT_INBOX_CANDIDATE_TEST: '1' } },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, /backup|preserved|cleanup/i);
  const verify = runNode('scripts/verify-plugin-release-candidate.js', [
    '--candidate', prepared.candidateDirectory,
    '--installed', target,
  ]);
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  const backupMatch = `${result.stderr}\n${result.stdout}`.match(
    /BACKUP_PRESERVED=([^\r\n]+)/,
  );
  assert.ok(backupMatch, result.stderr || result.stdout);
  assert.equal(fs.existsSync(backupMatch[1].trim()), true);
});

test('Windows candidate rollback aggregates failures and preserves remaining backup', {
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
    'rollback-failure-vault',
    '.obsidian',
    'plugins',
    'wechat-inbox-sync',
  );
  fs.cpSync(path.join(prepared.candidateDirectory, 'package'), target, { recursive: true });
  fs.writeFileSync(path.join(target, 'main.js'), 'old-main', 'utf8');

  const result = runPowerShell(
    path.join(repoRoot, 'scripts', 'install-plugin-release-candidate.ps1'),
    [
      '-CandidateDirectory', prepared.candidateDirectory,
      '-TargetDirectory', target,
      '-RepositoryRoot', repoRoot,
      '-SkipObsidianProcessCheckForTest',
      '-TestFailAfterSecondEntry',
      '-TestFailRollbackForName', 'main.js',
    ],
    { env: { WECHAT_INBOX_CANDIDATE_TEST: '1' } },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /rollback incomplete/i);
  const backupMatch = `${result.stderr}\n${result.stdout}`.match(
    /BACKUP_PRESERVED=([^\r\n]+)/,
  );
  assert.ok(backupMatch, result.stderr || result.stdout);
  const backupDirectory = backupMatch[1].trim();
  assert.equal(fs.existsSync(backupDirectory), true);
  assert.equal(fs.readFileSync(path.join(backupDirectory, 'main.js'), 'utf8'), 'old-main');
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

test('root mirror check fails on drift and write copies only loose assets', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const rootMirror = path.join(fixture.tempRoot, 'public-root');
  fs.mkdirSync(rootMirror, { recursive: true });
  for (const fileName of ['main.js', 'manifest.json', 'styles.css', 'versions.json']) {
    fs.copyFileSync(path.join(fixture.pluginRoot, fileName), path.join(rootMirror, fileName));
  }
  fs.writeFileSync(path.join(rootMirror, 'main.js'), 'drift', 'utf8');

  const failedCheck = runNode('scripts/sync-plugin-release-mirror.js', [
    '--check',
    '--source', fixture.pluginRoot,
    '--root', rootMirror,
  ]);
  assert.notEqual(failedCheck.status, 0);
  assert.match(`${failedCheck.stderr}\n${failedCheck.stdout}`, /main\.js|mirror|drift/i);

  const written = runNode('scripts/sync-plugin-release-mirror.js', [
    '--write',
    '--source', fixture.pluginRoot,
    '--root', rootMirror,
  ]);
  assert.equal(written.status, 0, written.stderr || written.stdout);
  const passingCheck = runNode('scripts/sync-plugin-release-mirror.js', [
    '--check',
    '--source', fixture.pluginRoot,
    '--root', rootMirror,
  ]);
  assert.equal(passingCheck.status, 0, passingCheck.stderr || passingCheck.stdout);
  assert.equal(fs.existsSync(path.join(rootMirror, 'README.md')), false);
  assert.equal(fs.existsSync(path.join(rootMirror, 'local-asr')), false);

  const normalizedStyles = fs.readFileSync(path.join(rootMirror, 'styles.css'), 'utf8');
  fs.writeFileSync(
    path.join(rootMirror, 'styles.css'),
    normalizedStyles.replace(/\n/g, '\r\n'),
    'utf8',
  );
  const newlineDrift = runNode('scripts/sync-plugin-release-mirror.js', [
    '--check',
    '--source', fixture.pluginRoot,
    '--root', rootMirror,
  ]);
  assert.notEqual(newlineDrift.status, 0);
  assert.match(`${newlineDrift.stderr}\n${newlineDrift.stdout}`, /styles\.css|mirror|drift/i);
});

test('root mirror write rolls back the complete loose-asset set on interruption', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const rootMirror = path.join(fixture.tempRoot, 'transactional-root');
  fs.mkdirSync(rootMirror, { recursive: true });
  const original = {};
  for (const fileName of ['main.js', 'manifest.json', 'styles.css', 'versions.json']) {
    const content = Buffer.from(`old-${fileName}`, 'utf8');
    fs.writeFileSync(path.join(rootMirror, fileName), content);
    original[fileName] = content;
  }
  const { writeMirror } = require('../scripts/sync-plugin-release-mirror');
  const previousTestMode = process.env.WECHAT_INBOX_CANDIDATE_TEST;
  process.env.WECHAT_INBOX_CANDIDATE_TEST = '1';
  try {
    assert.throws(
      () => writeMirror({
        source: fixture.pluginRoot,
        root: rootMirror,
        testFailAfterEntry: 2,
      }),
      /injected|test/i,
    );
  } finally {
    if (previousTestMode === undefined) {
      delete process.env.WECHAT_INBOX_CANDIDATE_TEST;
    } else {
      process.env.WECHAT_INBOX_CANDIDATE_TEST = previousTestMode;
    }
  }
  for (const [fileName, content] of Object.entries(original)) {
    assert.deepEqual(fs.readFileSync(path.join(rootMirror, fileName)), content);
  }
});

test('root mirror preserves its backup when rollback itself is incomplete', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const rootMirror = path.join(fixture.tempRoot, 'rollback-failure-root');
  fs.mkdirSync(rootMirror, { recursive: true });
  for (const fileName of ['main.js', 'manifest.json', 'styles.css', 'versions.json']) {
    fs.writeFileSync(path.join(rootMirror, fileName), `old-${fileName}`, 'utf8');
  }
  const { writeMirror } = require('../scripts/sync-plugin-release-mirror');
  const previousTestMode = process.env.WECHAT_INBOX_CANDIDATE_TEST;
  process.env.WECHAT_INBOX_CANDIDATE_TEST = '1';
  let failure;
  try {
    assert.throws(
      () => writeMirror({
        source: fixture.pluginRoot,
        root: rootMirror,
        testFailAfterEntry: 2,
        testFailRollbackEntry: 'main.js',
      }),
      (error) => {
        failure = error;
        return /rollback incomplete/i.test(error.message);
      },
    );
  } finally {
    if (previousTestMode === undefined) {
      delete process.env.WECHAT_INBOX_CANDIDATE_TEST;
    } else {
      process.env.WECHAT_INBOX_CANDIDATE_TEST = previousTestMode;
    }
  }
  const backupMatch = failure.message.match(/backup preserved at (.+)$/i);
  assert.ok(backupMatch, failure.message);
  const backupRoot = backupMatch[1];
  assert.equal(fs.existsSync(backupRoot), true);
  assert.equal(fs.readFileSync(path.join(backupRoot, 'main.js'), 'utf8'), 'old-main.js');
  fs.rmSync(backupRoot, { recursive: true, force: true });
});

test('mirror and promotion reject aliased or out-of-bound write targets', {
  skip: process.platform !== 'win32',
}, (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const realMirror = path.join(fixture.tempRoot, 'real-root');
  const aliasedMirror = path.join(fixture.tempRoot, 'junction-root');
  fs.mkdirSync(realMirror, { recursive: true });
  fs.symlinkSync(realMirror, aliasedMirror, 'junction');

  const mirrorResult = runNode('scripts/sync-plugin-release-mirror.js', [
    '--write',
    '--source', fixture.pluginRoot,
    '--root', aliasedMirror,
  ]);
  assert.notEqual(mirrorResult.status, 0);
  assert.match(`${mirrorResult.stderr}\n${mirrorResult.stdout}`, /junction|reparse|symbolic|alias/i);
});

test('promotion refuses drift and writes only deterministic candidate identity', (t) => {
  const fixture = createPackageFixture();
  t.after(fixture.cleanup);
  const prepared = parseJsonOutput(runNode('scripts/prepare-plugin-release-candidate.js', [
    '--source', fixture.pluginRoot,
    '--artifacts-root', path.join(fixture.tempRoot, '.artifacts', 'plugin'),
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
  const rootMirror = path.join(fixture.tempRoot, 'public-root');
  fs.mkdirSync(rootMirror, { recursive: true });
  const mirrorWrite = runNode('scripts/sync-plugin-release-mirror.js', [
    '--write',
    '--source', fixture.pluginRoot,
    '--root', rootMirror,
  ]);
  assert.equal(mirrorWrite.status, 0, mirrorWrite.stderr || mirrorWrite.stdout);
  const promotionPath = path.join(rootMirror, 'release-candidate.json');
  const promoteArgs = [
    '--candidate', prepared.candidateDirectory,
    '--source', fixture.pluginRoot,
    '--root-mirror', rootMirror,
    '--installed', installedRoot,
    '--output', promotionPath,
  ];

  const promoted = runNode('scripts/promote-plugin-release-candidate.js', promoteArgs);
  assert.equal(promoted.status, 0, promoted.stderr || promoted.stdout);
  const receipt = JSON.parse(fs.readFileSync(promotionPath, 'utf8'));
  const candidate = JSON.parse(fs.readFileSync(
    path.join(prepared.candidateDirectory, 'candidate.json'),
    'utf8',
  ));
  assert.deepEqual(receipt, candidate.identity);
  assert.equal(JSON.stringify(receipt).includes('provenance'), false);
  assert.equal(JSON.stringify(receipt).includes(fixture.tempRoot), false);

  const stableReceipt = fs.readFileSync(promotionPath);
  const outOfBounds = runNode('scripts/promote-plugin-release-candidate.js', [
    ...promoteArgs.slice(0, -2),
    '--output', path.join(fixture.tempRoot, 'outside-release-candidate.json'),
  ]);
  assert.notEqual(outOfBounds.status, 0);
  assert.match(`${outOfBounds.stderr}\n${outOfBounds.stdout}`, /output|root|release-candidate/i);
  assert.equal(fs.existsSync(path.join(fixture.tempRoot, 'outside-release-candidate.json')), false);

  fs.writeFileSync(path.join(installedRoot, 'styles.css'), 'drift', 'utf8');
  const rejected = runNode('scripts/promote-plugin-release-candidate.js', promoteArgs);
  assert.notEqual(rejected.status, 0);
  assert.deepEqual(fs.readFileSync(promotionPath), stableReceipt);

  const promotionSource = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'promote-plugin-release-candidate.js'),
    'utf8',
  );
  assert.match(promotionSource, /verification\.identity/);
  assert.doesNotMatch(promotionSource, /readCandidateIdentity/);
});
