const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
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

const compatibilityMappings = [
  ['local-asr/install-local-asr.ps1', 'local-asr/common/install-local-asr.ps1'],
  ['local-asr/install-local-asr-macos.sh', 'local-asr/common/install-local-asr-macos.sh'],
  ['local-ocr/install-local-ocr.ps1', 'local-ocr/common/install-local-ocr.ps1'],
  ['local-ocr/install-local-ocr-macos.sh', 'local-ocr/common/install-local-ocr-macos.sh'],
  ['local-ocr/ocr_image.py', 'local-ocr/common/ocr_image.py'],
];

function absolutePath(relativePath) {
  return path.join(repoRoot, ...relativePath.split('/'));
}

function readText(relativePath) {
  return fs.readFileSync(absolutePath(relativePath), 'utf8');
}

function fileExists(relativePath) {
  try {
    return fs.statSync(absolutePath(relativePath)).isFile();
  } catch {
    return false;
  }
}

function yamlBlock(text, headerPattern) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => headerPattern.test(line));
  assert.notEqual(start, -1, `missing YAML block matching ${headerPattern}`);
  const indent = lines[start].match(/^\s*/)[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    const significant = line.trim() && !line.trimStart().startsWith('#');
    if (significant && line.match(/^\s*/)[0].length <= indent) break;
    end += 1;
  }
  return lines.slice(start, end).join('\n');
}

function executableYamlSteps(jobBlock) {
  const lines = jobBlock.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => (
    /^\s*-\s+(?:name|uses|run)\s*:/.test(line) && !line.trimStart().startsWith('#') ? [index] : []
  ));
  return starts.map((start, index) => lines
    .slice(start, starts[index + 1] ?? lines.length)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n'));
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

for (const [sourceSuffix, alias] of compatibilityMappings) {
  test(`the component manifest maps ${sourceSuffix} to ${alias}`, {
    skip: !fileExists(relativePaths.componentManifest),
  }, () => {
    const entries = componentEntries(JSON.parse(readText(relativePaths.componentManifest)));
    const entry = entries.find((candidate) => String(candidate.sourcePath || '')
      .replace(/\\/g, '/')
      .endsWith(sourceSuffix));
    assert.ok(entry, `component manifest must contain source ${sourceSuffix}`);
    assert.equal(entry.compatibilityAlias, alias, `${sourceSuffix} must preserve compatibility alias ${alias}`);
  });
}

test('the manifest checker executes check mode and documents intentional write mode', {
  skip: !fileExists(relativePaths.manifestChecker),
}, () => {
  const checkerPath = absolutePath(relativePaths.manifestChecker);
  const check = childProcess.spawnSync(process.execPath, [checkerPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, `manifest --check failed:\n${check.stdout}${check.stderr}`);

  const help = childProcess.spawnSync(process.execPath, [checkerPath, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(help.status, 0, `manifest --help failed:\n${help.stdout}${help.stderr}`);
  assert.match(`${help.stdout}${help.stderr}`, /--write\b/, 'checker help must document intentional --write mode');

  const invalid = childProcess.spawnSync(process.execPath, [checkerPath, '--not-a-real-mode'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.notEqual(invalid.status, 0, 'manifest checker must reject unknown modes');
});

test('the main workflow guards main pushes and pull requests with repository contracts', {
  skip: !fileExists(relativePaths.mainWorkflow),
}, () => {
  const workflow = readText(relativePaths.mainWorkflow);
  const triggers = yamlBlock(workflow, /^on:\s*$/);
  const push = yamlBlock(triggers, /^  push:\s*$/);
  const pullRequest = yamlBlock(triggers, /^  pull_request:\s*$/);
  assert.match(push, /^\s+branches:\s*(?:\[\s*main\s*\]|(?:\r?\n\s+-\s+main))\s*$/m, 'push trigger must target main');
  assert.match(pullRequest, /^\s+branches:\s*(?:\[\s*main\s*\]|(?:\r?\n\s+-\s+main))\s*$/m, 'pull_request trigger must target main');

  const steps = executableYamlSteps(workflow);
  assert.ok(
    steps.some((step) => /node tests\/release-governance\.test\.js/.test(step)),
    'main guard workflow must execute release-governance contracts',
  );
  assert.match(
    steps.join('\n'),
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
  const releaseJob = yamlBlock(workflow, /^  release:\s*$/);
  const steps = executableYamlSteps(releaseJob);
  const guardIndex = steps.findIndex((step) => /node scripts\/release-source-guard\.js/.test(step));
  const publishIndex = steps.findIndex((step) => /\bgh release (?:create|upload)\b/.test(step));
  assert.match(
    releaseJob,
    /(?:origin\/main|refs\/heads\/main)/,
    'release workflow must identify the current remote main commit',
  );
  assert.notEqual(guardIndex, -1, 'release workflow must execute the main-equality release-source guard');
  assert.notEqual(publishIndex, -1, 'release workflow must contain a GitHub Release publication step');
  assert.ok(guardIndex < publishIndex, 'release-source guard must execute before GitHub Release publication');
});

for (const installerPath of [
  'obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1',
  'obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh',
]) {
  test(`Git resolves canonical LF bytes for ${installerPath}`, () => {
    const result = childProcess.spawnSync('git', ['check-attr', 'eol', '--', installerPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `git check-attr failed:\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /:\s*eol:\s*lf\s*$/m, `${installerPath} must resolve to eol=lf`);
  });
}
