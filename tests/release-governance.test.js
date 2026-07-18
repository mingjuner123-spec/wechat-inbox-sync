const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const relativePaths = {
  componentManifest: 'obsidian-plugin/wechat-inbox-sync/local-components-manifest.json',
  manifestChecker: 'scripts/update-local-components-manifest.js',
  releaseSourceGuard: 'scripts/release-source-guard.js',
  deployScript: 'scripts/deploy-local-components.ps1',
  mainWorkflow: '.github/workflows/main-guards.yml',
  integrityWorkflow: '.github/workflows/component-integrity.yml',
  releaseWorkflow: '.github/workflows/release.yml',
  gitAttributes: '.gitattributes',
};

const compatibilityAliases = [
  'local-asr/common/install-local-asr.ps1',
  'local-asr/common/install-local-asr-macos.sh',
  'local-ocr/common/install-local-ocr.ps1',
  'local-ocr/common/install-local-ocr-macos.sh',
  'local-ocr/common/ocr_image.py',
];

function absolutePath(relativePath) {
  return path.join(repoRoot, ...relativePath.split('/'));
}

function readText(relativePath) {
  return fs.readFileSync(absolutePath(relativePath), 'utf8');
}

function fileExists(relativePath) {
  return fs.existsSync(absolutePath(relativePath));
}

function collectStringValues(value, result = []) {
  if (typeof value === 'string') {
    result.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, result));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStringValues(item, result));
  }
  return result;
}

function componentEntries(manifest) {
  const entries = manifest.assets || manifest.components || manifest.files;
  assert.ok(Array.isArray(entries), 'component manifest must expose an assets, components, or files array');
  assert.ok(entries.length > 0, 'component manifest must contain at least one component');
  return entries;
}

for (const [name, relativePath] of Object.entries(relativePaths)) {
  test(`${name} exists at its canonical repository path`, () => {
    assert.ok(fileExists(relativePath), `missing required release-governance file: ${relativePath}`);
  });
}

test('the component manifest uses full SHA-256 content-addressed immutable paths', {
  skip: !fileExists(relativePaths.componentManifest),
}, () => {
  const manifest = JSON.parse(readText(relativePaths.componentManifest));

  for (const component of componentEntries(manifest)) {
    assert.equal(typeof component.sourcePath, 'string', `${component.id || 'component'} must identify its source path`);
    assert.equal(typeof component.immutablePath, 'string', `${component.id || 'component'} must identify its immutable path`);
    assert.match(component.sha256, /^[a-f0-9]{64}$/, `${component.id || 'component'} must have a full lowercase SHA-256`);
    assert.equal(
      component.immutablePath,
      `local-components/by-sha256/${component.sha256}/${path.posix.basename(component.sourcePath)}`,
      `${component.id || component.sourcePath} must use its full SHA-256 in the immutable path`,
    );
  }
});

for (const alias of compatibilityAliases) {
  test(`the component manifest preserves compatibility alias ${alias}`, {
    skip: !fileExists(relativePaths.componentManifest),
  }, () => {
    const manifestStrings = new Set(collectStringValues(JSON.parse(readText(relativePaths.componentManifest))));
    assert.ok(manifestStrings.has(alias), `component manifest must preserve compatibility alias ${alias}`);
  });
}

test('the manifest checker exposes check mode for CI and write mode for intentional updates', {
  skip: !fileExists(relativePaths.manifestChecker),
}, () => {
  const checker = readText(relativePaths.manifestChecker);
  assert.match(checker, /--check\b/, 'manifest checker must expose --check');
  assert.match(checker, /--write\b/, 'manifest checker must expose --write');
  assert.match(checker, /local-components-manifest\.json/, 'manifest checker must target the canonical manifest');
});

test('the main workflow guards main pushes and pull requests with repository contracts', {
  skip: !fileExists(relativePaths.mainWorkflow),
}, () => {
  const workflow = readText(relativePaths.mainWorkflow);
  assert.match(workflow, /\bpush\s*:/, 'main guard workflow must run on pushes');
  assert.match(workflow, /\bmain\b/, 'main guard workflow must target main');
  assert.match(workflow, /\bpull_request\s*:/, 'main guard workflow must run on pull requests');
  assert.match(workflow, /node tests\/release-governance\.test\.js/, 'main guard workflow must run release-governance contracts');
  assert.match(
    workflow,
    /node scripts\/update-local-components-manifest\.js --check/,
    'main guard workflow must reject component-manifest drift',
  );
});

test('the component-integrity workflow runs on a schedule and by manual dispatch', {
  skip: !fileExists(relativePaths.integrityWorkflow),
}, () => {
  const workflow = readText(relativePaths.integrityWorkflow);
  assert.match(workflow, /\bschedule\s*:/, 'component integrity must run on a schedule');
  assert.match(workflow, /\bcron\s*:/, 'component integrity schedule must define a cron');
  assert.match(workflow, /\bworkflow_dispatch\s*:/, 'component integrity must support manual dispatch');
  assert.match(
    workflow,
    /node scripts\/check-local-components-cdn\.js/,
    'component integrity workflow must run the canonical CDN verifier',
  );
});

test('tag releases check out full Git history', () => {
  const workflow = readText(relativePaths.releaseWorkflow);
  assert.match(workflow, /fetch-depth\s*:\s*0/, 'release checkout must fetch full Git history');
});

test('tag releases enforce equality with current remote main', () => {
  const workflow = readText(relativePaths.releaseWorkflow);
  assert.match(
    workflow,
    /(?:origin\/main|refs\/heads\/main)/,
    'release workflow must identify the current remote main commit',
  );
  assert.match(
    workflow,
    /node scripts\/release-source-guard\.js/,
    'release workflow must run the main-equality release-source guard',
  );
});

function gitAttributeRules() {
  return readText(relativePaths.gitAttributes)
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

test('Git attributes force the Windows ASR installer to canonical LF bytes', () => {
  const rules = gitAttributeRules();
  assert.ok(
    rules.includes('obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1 text eol=lf'),
    'Windows ASR installer must be committed with LF line endings',
  );
});

test('Git attributes force the macOS ASR installer to canonical LF bytes', () => {
  const rules = gitAttributeRules();
  assert.ok(
    rules.includes('obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh text eol=lf'),
    'macOS ASR installer must be committed with LF line endings',
  );
});
