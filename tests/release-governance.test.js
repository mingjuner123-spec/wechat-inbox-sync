const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ASSET_DEFINITIONS,
  assertManifestMatches,
  buildManifest,
  buildManifestAsset,
  normalizeTextBytes,
  sha256Hex,
  validateCanonicalManifest,
  validateManifest,
  validateManifestSchema,
} = require('../scripts/local-component-manifest-core');
const {
  resolveContainedSourcePath,
  writeFileAtomically,
} = require('../scripts/update-local-components-manifest');

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
const governanceCommands = [
  'node tests/release-governance.test.js',
  'node tests/plugin-main-ai.test.js',
  'node tests/plugin-marketplace-package.test.js',
  'node --check tests/release-governance.test.js',
  'node --check scripts/local-component-manifest-core.js',
  'node --check scripts/update-local-components-manifest.js',
  'node --check scripts/release-source-guard-core.js',
  'node --check scripts/release-source-guard.js',
  'node --check obsidian-plugin/wechat-inbox-sync/main.js',
  'node scripts/update-local-components-manifest.js --check',
];
const macInstallerPaths = [
  'obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh',
  'obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr-macos.sh',
];
const windowsInstallerPaths = [
  'obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1',
  'obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr.ps1',
];
const currentCommit = 'a'.repeat(40);
const staleCommit = 'b'.repeat(40);

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

function loadReleaseSourceGuardCore() {
  return require('../scripts/release-source-guard-core');
}

function remoteMainOutput(commit = currentCommit) {
  return `${commit}\trefs/heads/main\n`;
}

function runReleaseSourceGuard(args) {
  return childProcess.spawnSync(process.execPath, [
    absolutePath(relativePaths.releaseSourceGuard),
    ...args,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000,
  });
}

function assertNormalExit(result, label) {
  assert.equal(result.error, undefined, `${label} did not exit normally: ${result.error?.message}`);
  assert.notEqual(result.status, null, `${label} did not report an exit status (signal: ${result.signal})`);
  assert.equal(result.signal, null, `${label} was terminated by signal ${result.signal}`);
}

function runFixtureCommand(file, args, cwd, label, timeout = 10000) {
  const result = childProcess.spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
    },
    shell: false,
    timeout,
  });
  assertNormalExit(result, label);
  assert.equal(
    result.status,
    0,
    `${label} failed:\n${result.stdout || ''}${result.stderr || ''}`,
  );
  return result;
}

function runFixtureGit(repositoryPath, args, label) {
  return runFixtureCommand('git', args, repositoryPath, label);
}

function copyFixtureFile(fixtureRoot, relativePath) {
  const destination = path.join(fixtureRoot, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(absolutePath(relativePath), destination);
}

function createReleaseGuardFixture(t, {
  checkerSource,
  extraCommit = false,
} = {}) {
  const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-source-guard-'));
  const repositoryPath = path.join(fixtureDirectory, 'repository');
  const originPath = path.join(fixtureDirectory, 'origin.git');
  fs.mkdirSync(repositoryPath, { recursive: true });
  t.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));

  for (const relativePath of [
    'scripts/release-source-guard.js',
    'scripts/release-source-guard-core.js',
    'scripts/update-local-components-manifest.js',
    'scripts/local-component-manifest-core.js',
    'manifest.json',
    'obsidian-plugin/wechat-inbox-sync/manifest.json',
    'obsidian-plugin/wechat-inbox-sync/local-components-manifest.json',
    ...ASSET_DEFINITIONS.map(({ sourcePath }) => (
      `obsidian-plugin/wechat-inbox-sync/${sourcePath}`
    )),
  ]) {
    copyFixtureFile(repositoryPath, relativePath);
  }
  if (checkerSource) {
    fs.writeFileSync(
      path.join(repositoryPath, 'scripts', 'update-local-components-manifest.js'),
      checkerSource,
      'utf8',
    );
  }

  runFixtureGit(repositoryPath, ['init', '-b', 'main'], 'initialize fixture repository');
  runFixtureGit(repositoryPath, ['config', 'user.name', 'Release Guard Test'], 'configure fixture user name');
  runFixtureGit(repositoryPath, ['config', 'user.email', 'release-guard@example.invalid'], 'configure fixture user email');
  runFixtureGit(repositoryPath, ['config', 'commit.gpgSign', 'false'], 'disable fixture commit signing');
  runFixtureGit(repositoryPath, ['add', '--all'], 'stage fixture repository');
  runFixtureGit(repositoryPath, ['commit', '-m', 'fixture release source'], 'commit fixture repository');

  if (extraCommit) {
    fs.writeFileSync(path.join(repositoryPath, 'history-marker.txt'), 'second commit\n', 'utf8');
    runFixtureGit(repositoryPath, ['add', 'history-marker.txt'], 'stage fixture history marker');
    runFixtureGit(repositoryPath, ['commit', '-m', 'fixture second commit'], 'create fixture second commit');
  }

  runFixtureCommand(
    'git',
    ['init', '--bare', '--initial-branch=main', originPath],
    fixtureDirectory,
    'initialize fixture bare origin',
  );
  runFixtureGit(repositoryPath, ['remote', 'add', 'origin', originPath], 'add fixture origin');
  runFixtureGit(
    repositoryPath,
    ['push', '--set-upstream', 'origin', 'main'],
    'push fixture main',
  );

  return {
    guardPath: path.join(repositoryPath, 'scripts', 'release-source-guard.js'),
    originPath,
    repositoryPath,
  };
}

function runFixtureGuard(fixture, args) {
  return childProcess.spawnSync(process.execPath, [fixture.guardPath, ...args], {
    cwd: fixture.repositoryPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
    },
    shell: false,
    timeout: 10000,
  });
}

function remoteAdvancingCheckerSource() {
  return `'use strict';
const childProcess = require('node:child_process');
const path = require('node:path');
const repositoryPath = path.resolve(__dirname, '..');
const options = {
  cwd: repositoryPath,
  encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
};
childProcess.execFileSync('git', ['commit', '--allow-empty', '-m', 'advance during manifest check'], options);
childProcess.execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], options);
process.stdout.write('fixture manifest check advanced main\\n');
`;
}

function tagMovingCheckerSource(tag) {
  return `'use strict';
const childProcess = require('node:child_process');
const path = require('node:path');
const repositoryPath = path.resolve(__dirname, '..');
childProcess.execFileSync(
  'git',
  ['tag', '--force', '--annotate', ${JSON.stringify(tag)}, 'HEAD~1', '--message', 'move during manifest check'],
  {
    cwd: repositoryPath,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
process.stdout.write('fixture manifest check moved tag\\n');
`;
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

function yamlSteps(jobBlock) {
  const lines = jobBlock.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => (
    /^\s*-\s+(?:name|uses|run)\s*:/.test(line) && !line.trimStart().startsWith('#') ? [index] : []
  ));
  return starts.map((start, index) => lines
    .slice(start, starts[index + 1] ?? lines.length)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n'));
}

function runBody(step) {
  const lines = step.split(/\r?\n/);
  const runStart = lines.findIndex((line) => /^\s+(?:-\s+)?run\s*:/.test(line));
  if (runStart === -1) return '';
  const inlineBody = lines[runStart].match(/\brun\s*:\s*(.*)$/)?.[1]?.trim();
  const bodyLines = inlineBody && !/^[|>][-+0-9]*$/.test(inlineBody)
    ? [inlineBody, ...lines.slice(runStart + 1)]
    : lines.slice(runStart + 1);
  return bodyLines
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

function workflowJob(workflow, jobName) {
  const jobs = yamlBlock(workflow, /^jobs:\s*$/);
  return yamlBlock(jobs, new RegExp(`^  ${jobName}:\\s*$`));
}

function workflowPermissions(workflow) {
  return yamlBlock(workflow, /^permissions:\s*$/);
}

function stepUsing(jobBlock, actionPattern) {
  const step = yamlSteps(jobBlock)
    .find((candidate) => actionPattern.test(candidate));
  assert.ok(step, `missing workflow step using ${actionPattern}`);
  return step;
}

function stepWith(step) {
  return yamlBlock(step, /^\s+with:\s*$/);
}

function executableRuns(jobBlock) {
  return yamlSteps(jobBlock).map(runBody).filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function executableCommandPattern(command) {
  return new RegExp(`^\\s*${escapeRegExp(command)}\\s*$`, 'm');
}

function assertExecutableCommand(runs, command, message = `missing executable command: ${command}`) {
  assert.ok(runs.some((run) => executableCommandPattern(command).test(run)), message);
}

function assertNode24(jobBlock) {
  const setupNode = stepUsing(jobBlock, /^\s+uses:\s*actions\/setup-node@v4\s*$/m);
  assert.match(
    stepWith(setupNode),
    /^\s+node-version:\s*['"]?24['"]?\s*$/m,
    'setup-node must configure Node 24 under its with block',
  );
}

function assertFullCheckout(jobBlock) {
  const checkout = stepUsing(jobBlock, /^\s+uses:\s*actions\/checkout@v4\s*$/m);
  assert.match(
    stepWith(checkout),
    /^\s+fetch-depth:\s*0\s*$/m,
    'checkout must configure fetch-depth: 0 under its with block',
  );
}

function assertGovernanceGates(jobBlock) {
  const runs = executableRuns(jobBlock);
  for (const command of governanceCommands) {
    assertExecutableCommand(runs, command);
  }
  for (const installerPath of macInstallerPaths) {
    assertExecutableCommand(runs, `bash -n ${installerPath}`);
  }
  const powershellStep = yamlSteps(jobBlock)
    .find((step) => /\bParser\]::ParseFile\s*\(/.test(runBody(step)));
  assert.ok(powershellStep, 'workflow must parse Windows installers with the PowerShell parser');
  assert.match(
    powershellStep,
    /^\s+shell:\s*pwsh\s*$/m,
    'Windows installer parser gate must execute with pwsh',
  );
  const powershellRun = runBody(powershellStep);
  for (const installerPath of windowsInstallerPaths) {
    assert.ok(
      powershellRun.includes(installerPath),
      `PowerShell parser gate must include ${installerPath}`,
    );
  }
  assert.match(
    powershellRun,
    /foreach\s*\(\$installerPath\s+in\s+\$installerPaths\)/,
    'PowerShell parser gate must iterate over every configured installer path',
  );
  assert.match(
    powershellRun,
    /Parser\]::ParseFile\s*\(\s*\$installerPath\s*,/,
    'PowerShell parser gate must pass each installer path to ParseFile',
  );
  assert.match(
    powershellRun,
    /if\s*\(\$parseErrors\.Count\s+-gt\s+0\)/,
    'PowerShell parser gate must fail when parser errors are returned',
  );
}

function componentEntries(manifest) {
  const entries = manifest.assets || manifest.components || manifest.files;
  assert.ok(Array.isArray(entries), 'component manifest must expose an assets, components, or files array');
  assert.ok(entries.length > 0, 'component manifest must contain at least one component');
  return entries;
}

function canonicalManifestFixture() {
  return buildManifest(ASSET_DEFINITIONS.map((definition) => ({
    ...definition,
    contents: Buffer.from(`${definition.id}\n`, 'utf8'),
  })));
}

test('canonical text hashing treats LF and CRLF source bytes as equivalent', () => {
  const lf = normalizeTextBytes(Buffer.from('alpha\nbeta\ngamma\n', 'utf8'));
  const crlf = normalizeTextBytes(Buffer.from('alpha\r\nbeta\r\ngamma\r\n', 'utf8'));

  assert.deepEqual(crlf, lf);
  assert.equal(sha256Hex(crlf), sha256Hex(lf));
  assert.equal(lf.toString('utf8'), 'alpha\nbeta\ngamma\n');
});

test('canonical text decoding rejects malformed UTF-8 bytes', () => {
  assert.throws(
    () => normalizeTextBytes(Buffer.from([0xc3, 0x28])),
    /UTF-8|encoded data/i,
  );
});

test('canonical text decoding intentionally removes one UTF-8 BOM', () => {
  const plain = normalizeTextBytes(Buffer.from('alpha\n', 'utf8'));
  const withBom = normalizeTextBytes(Buffer.from([0xef, 0xbb, 0xbf, ...plain]));

  assert.deepEqual(withBom, plain);
});

test('manifest assets use the full lowercase canonical SHA-256 in immutable paths', () => {
  const asset = buildManifestAsset({
    id: 'test-installer',
    sourcePath: 'local-asr/test-installer.sh',
    compatibilityAlias: 'local-asr/common/test-installer.sh',
  }, Buffer.from('first\r\nsecond\r\n', 'utf8'));
  const expectedHash = sha256Hex(Buffer.from('first\nsecond\n', 'utf8'));

  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.sha256, expectedHash);
  assert.equal(
    asset.immutablePath,
    `local-components/by-sha256/${expectedHash}/test-installer.sh`,
  );
});

test('manifest matching rejects canonical source changes', () => {
  const definition = {
    id: 'test-installer',
    sourcePath: 'local-asr/test-installer.sh',
    compatibilityAlias: 'local-asr/common/test-installer.sh',
  };
  const committed = buildManifest([{ ...definition, contents: Buffer.from('version one\n', 'utf8') }]);
  const rebuilt = buildManifest([{ ...definition, contents: Buffer.from('version two\n', 'utf8') }]);

  assert.throws(
    () => assertManifestMatches(committed, rebuilt),
    /manifest drift/i,
  );
});

test('manifest schema validation rejects malformed component metadata', async (t) => {
  const validManifest = buildManifest([{
    id: 'test-installer',
    sourcePath: 'local-asr/test-installer.sh',
    compatibilityAlias: 'local-asr/common/test-installer.sh',
    contents: Buffer.from('installer\n', 'utf8'),
  }]);

  await t.test('unsupported schema versions', () => {
    assert.throws(
      () => validateManifestSchema({ ...validManifest, schemaVersion: 2 }),
      /schemaVersion/i,
    );
  });

  await t.test('truncated hashes', () => {
    const malformed = structuredClone(validManifest);
    malformed.assets[0].sha256 = malformed.assets[0].sha256.slice(0, 12);
    assert.throws(() => validateManifestSchema(malformed), /sha256/i);
  });

  await t.test('immutable paths that do not match the full hash', () => {
    const malformed = structuredClone(validManifest);
    malformed.assets[0].immutablePath = 'local-components/by-sha256/short/test-installer.sh';
    assert.throws(() => validateManifestSchema(malformed), /immutablePath/i);
  });

  await t.test('missing compatibility aliases', () => {
    const malformed = structuredClone(validManifest);
    delete malformed.assets[0].compatibilityAlias;
    assert.throws(() => validateManifestSchema(malformed), /compatibilityAlias/i);
  });
});

test('canonical manifest validation rejects missing, extra, unknown, or swapped assets', async (t) => {
  const canonical = canonicalManifestFixture();

  assert.equal(validateCanonicalManifest(canonical), true);
  assert.equal(validateManifest(canonical), true, 'validateManifest must enforce the canonical contract');

  await t.test('missing canonical assets and wrong counts', () => {
    const malformed = structuredClone(canonical);
    malformed.assets.pop();
    assert.throws(() => validateCanonicalManifest(malformed), /exactly 5 canonical assets/i);
  });

  await t.test('extra canonical assets and wrong counts', () => {
    const extraAsset = buildManifestAsset({
      id: 'unknown-extra',
      sourcePath: 'local-z/extra.sh',
      compatibilityAlias: 'local-z/common/extra.sh',
    }, Buffer.from('extra\n', 'utf8'));
    const malformed = structuredClone(canonical);
    malformed.assets.push(extraAsset);
    assert.throws(() => validateCanonicalManifest(malformed), /exactly 5 canonical assets/i);
  });

  await t.test('unknown IDs with the expected count', () => {
    const malformed = structuredClone(canonical);
    malformed.assets[0].id = 'unknown-id';
    assert.throws(() => validateCanonicalManifest(malformed), /unknown canonical asset id/i);
  });

  await t.test('swapped source mappings', () => {
    const malformed = structuredClone(canonical);
    [malformed.assets[0].id, malformed.assets[1].id] = [
      malformed.assets[1].id,
      malformed.assets[0].id,
    ];
    assert.throws(() => validateCanonicalManifest(malformed), /sourcePath/i);
  });

  await t.test('swapped compatibility aliases', () => {
    const malformed = structuredClone(canonical);
    [malformed.assets[0].compatibilityAlias, malformed.assets[1].compatibilityAlias] = [
      malformed.assets[1].compatibilityAlias,
      malformed.assets[0].compatibilityAlias,
    ];
    assert.throws(() => validateCanonicalManifest(malformed), /compatibilityAlias/i);
  });
});

test('repository paths reject Windows, rooted, traversal, NUL, and non-normalized forms', async (t) => {
  const invalidPaths = [
    ['Windows drive', 'C:/local-asr/install.sh'],
    ['backslash', 'local-asr\\install.sh'],
    ['UNC', '//server/share/install.sh'],
    ['traversal', 'local-asr/../install.sh'],
    ['NUL', 'local-asr/\0install.sh'],
    ['dot segment', './local-asr/install.sh'],
  ];

  for (const [label, sourcePath] of invalidPaths) {
    await t.test(label, () => {
      assert.throws(
        () => buildManifestAsset({
          id: 'invalid-path',
          sourcePath,
          compatibilityAlias: 'local-asr/common/install.sh',
        }, Buffer.from('installer\n', 'utf8')),
        /sourcePath/i,
      );
    });
  }
});

test('source path resolution proves the resolved file remains inside the plugin root', () => {
  const pluginRoot = absolutePath('obsidian-plugin/wechat-inbox-sync');
  assert.equal(
    resolveContainedSourcePath(pluginRoot, 'local-asr/install-local-asr.ps1'),
    absolutePath('obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1'),
  );
  assert.throws(
    () => resolveContainedSourcePath(pluginRoot, '../outside.txt'),
    /escapes plugin root/i,
  );
});

test('atomic manifest writes replace the destination and clean temporary files', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-component-manifest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'manifest.json');

  fs.writeFileSync(destination, 'old\n', 'utf8');
  writeFileAtomically(destination, 'new\n');

  assert.equal(fs.readFileSync(destination, 'utf8'), 'new\n');
  assert.deepEqual(fs.readdirSync(directory), ['manifest.json']);
});

test('atomic manifest writes clean temporary files when rename fails', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-component-manifest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'manifest.json');
  fs.mkdirSync(destination);

  let renameError;
  try {
    writeFileAtomically(destination, 'new\n');
  } catch (error) {
    renameError = error;
  }
  assert.ok(renameError, 'rename over a directory must fail');
  assert.notEqual(renameError.name, 'TypeError', 'failure must come from the atomic rename');
  assert.deepEqual(fs.readdirSync(directory), ['manifest.json']);
});

test('canonical asset definitions preserve every compatibility alias', () => {
  const manifest = buildManifest(ASSET_DEFINITIONS.map((definition) => ({
    ...definition,
    contents: Buffer.from(`${definition.id}\n`, 'utf8'),
  })));

  assert.deepEqual(
    manifest.assets.map(({ sourcePath, compatibilityAlias }) => [sourcePath, compatibilityAlias]),
    [...compatibilityMappings].sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    )),
  );
  assert.equal(manifest.assets.length, compatibilityMappings.length);
});

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
    timeout: 5000,
  });
  assert.equal(check.status, 0, `manifest --check failed:\n${check.stdout}${check.stderr}`);

  const help = childProcess.spawnSync(process.execPath, [checkerPath, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(help.status, 0, `manifest --help failed:\n${help.stdout}${help.stderr}`);
  assert.match(`${help.stdout}${help.stderr}`, /--write\b/, 'checker help must document intentional --write mode');

  const invalid = childProcess.spawnSync(process.execPath, [checkerPath, '--not-a-real-mode'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000,
  });
  assertNormalExit(invalid, 'manifest checker invalid-mode rejection');
  assert.notEqual(invalid.status, 0, 'manifest checker must reject unknown modes');
});

test('release source guard accepts a clean checkout at current remote main', () => {
  const { validateDeployState } = loadReleaseSourceGuardCore();

  assert.deepEqual(validateDeployState({
    statusOutput: '',
    headOutput: `${currentCommit}\n`,
    remoteMainOutput: remoteMainOutput(),
  }), {
    head: currentCommit,
    remoteMain: currentCommit,
  });
});

test('release source guard rejects dirty porcelain status', () => {
  const { validateDeployState } = loadReleaseSourceGuardCore();

  assert.throws(() => validateDeployState({
    statusOutput: ' M manifest.json\n',
    headOutput: `${currentCommit}\n`,
    remoteMainOutput: remoteMainOutput(),
  }), /dirty|clean checkout/i);
});

test('release source guard rejects a stale local HEAD', () => {
  const { validateDeployState } = loadReleaseSourceGuardCore();

  assert.throws(() => validateDeployState({
    statusOutput: '',
    headOutput: `${staleCommit}\n`,
    remoteMainOutput: remoteMainOutput(),
  }), /HEAD.*origin\/main|stale/i);
});

test('release source guard rejects a stale tag commit', () => {
  const { assertTagMatchesRemote } = loadReleaseSourceGuardCore();

  assert.throws(
    () => assertTagMatchesRemote(staleCommit, currentCommit),
    /tag.*origin\/main|stale/i,
  );
});

test('release source guard rejects a tag commit differing from checked-out HEAD', () => {
  const { assertTagMatchesHead } = loadReleaseSourceGuardCore();

  assert.throws(
    () => assertTagMatchesHead(staleCommit, currentCommit),
    /tag.*HEAD/i,
  );
});

test('release source guard rejects root and plugin manifest version mismatch', () => {
  const { validateReleaseVersions } = loadReleaseSourceGuardCore();

  assert.throws(
    () => validateReleaseVersions('1.3.48', '1.3.49', '1.3.49'),
    /root.*plugin|manifest versions/i,
  );
});

test('release source guard rejects tag and manifest version mismatch', () => {
  const { validateReleaseVersions } = loadReleaseSourceGuardCore();

  assert.throws(
    () => validateReleaseVersions('1.3.48', '1.3.48', '1.3.49'),
    /tag.*manifest|version/i,
  );
});

test('release source guard accepts a current version tag at current remote main', () => {
  const { validateTagState } = loadReleaseSourceGuardCore();

  assert.deepEqual(validateTagState({
    statusOutput: '',
    headOutput: `${currentCommit}\n`,
    tagOutput: `${currentCommit}\n`,
    remoteMainOutput: remoteMainOutput(),
    tag: '1.3.48',
    rootVersion: '1.3.48',
    pluginVersion: '1.3.48',
  }), {
    head: currentCommit,
    tagCommit: currentCommit,
    remoteMain: currentCommit,
    version: '1.3.48',
  });
});

test('release source guard fails closed on malformed or empty Git output', async (t) => {
  const {
    parseCommitOutput,
    parseRemoteMainOutput,
    validateDeployState,
  } = loadReleaseSourceGuardCore();

  for (const [name, probe, pattern] of [
    ['empty HEAD', () => parseCommitOutput('', 'local HEAD'), /HEAD|commit/i],
    ['malformed HEAD', () => parseCommitOutput('not-a-commit\n', 'local HEAD'), /HEAD|commit/i],
    ['extra HEAD output', () => parseCommitOutput(`${currentCommit}\nextra\n`, 'local HEAD'), /HEAD|commit/i],
    ['empty remote main', () => parseRemoteMainOutput(''), /remote.*main/i],
    ['wrong remote ref', () => parseRemoteMainOutput(`${currentCommit}\trefs/heads/master\n`), /remote.*main/i],
    ['multiple remote refs', () => parseRemoteMainOutput(`${remoteMainOutput()}${remoteMainOutput()}`), /remote.*main/i],
    ['missing status output', () => validateDeployState({
      headOutput: `${currentCommit}\n`,
      remoteMainOutput: remoteMainOutput(),
    }), /status/i],
  ]) {
    await t.test(name, () => assert.throws(probe, pattern));
  }
});

test('release source guard rejects invalid version tag names', async (t) => {
  const { validateVersionTag } = loadReleaseSourceGuardCore();

  for (const tag of [
    '',
    'v1.3.48',
    '1.3',
    '1.3.48-beta.1',
    '01.3.48',
    '1.03.48',
    '1.3.048',
    '1.3.48\n',
    'refs/tags/1.3.48',
  ]) {
    await t.test(JSON.stringify(tag), () => {
      assert.throws(() => validateVersionTag(tag), /version tag|X\.Y\.Z/i);
    });
  }
});

test('release source guard CLI documents both modes and rejects invalid arguments', async (t) => {
  const help = runReleaseSourceGuard(['--help']);
  assertNormalExit(help, 'guard --help');
  assert.equal(help.status, 0, `guard --help failed:\n${help.stdout}${help.stderr}`);
  assert.match(`${help.stdout}${help.stderr}`, /--deploy\b/);
  assert.match(`${help.stdout}${help.stderr}`, /--tag\s+<X\.Y\.Z>/);

  for (const args of [
    [],
    ['--unknown'],
    ['--deploy', 'extra'],
    ['--tag'],
    ['--tag', '1.3.48', 'extra'],
    ['--tag', 'v1.3.48'],
  ]) {
    await t.test(args.join(' ') || 'missing arguments', () => {
      const result = runReleaseSourceGuard(args);
      assertNormalExit(result, `guard rejection for ${args.join(' ') || 'missing arguments'}`);
      assert.notEqual(result.status, 0, `guard must reject arguments: ${args.join(' ')}`);
    });
  }
});

test('release source guard production commands are bounded and Git probes are non-interactive', () => {
  const guard = readText(relativePaths.releaseSourceGuard);
  const localTimeout = Number(
    guard.match(/LOCAL_COMMAND_TIMEOUT_MS\s*=\s*(\d+)/)?.[1],
  );
  const remoteTimeout = Number(
    guard.match(/REMOTE_COMMAND_TIMEOUT_MS\s*=\s*(\d+)/)?.[1],
  );

  assert.ok(localTimeout >= 1000 && localTimeout <= 60000, 'local child timeout must be bounded');
  assert.ok(
    remoteTimeout >= localTimeout && remoteTimeout <= 120000,
    'remote Git timeout must be bounded and allow at least the local timeout',
  );
  assert.match(guard, /\btimeout\s*:/);
  assert.match(guard, /GIT_TERMINAL_PROMPT\s*:\s*['"]0['"]/);
  assert.match(guard, /GCM_INTERACTIVE\s*:\s*['"]Never['"]/);
  assert.match(guard, /\bshell\s*:\s*false/);
  assert.match(guard, /timed out after/i);
  assert.doesNotMatch(guard, /\bexecSync\s*\(/, 'guard must not construct shell commands');
});

test('release source guard CLI integrates with real local Git repositories', async (t) => {
  await t.test('successful deploy', (t) => {
    const fixture = createReleaseGuardFixture(t);
    const result = runFixtureGuard(fixture, ['--deploy']);

    assertNormalExit(result, 'fixture deploy guard');
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /Deploy source guard passed/i);
  });

  await t.test('successful tag with annotated tag peeling', (t) => {
    const fixture = createReleaseGuardFixture(t);
    runFixtureGit(
      fixture.repositoryPath,
      ['tag', '--annotate', '1.3.48', '--message', 'fixture annotated release'],
      'create fixture annotated tag',
    );
    const result = runFixtureGuard(fixture, ['--tag', '1.3.48']);

    assertNormalExit(result, 'fixture tag guard');
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /Tag source guard passed/i);
  });

  await t.test('stale remote main failure', (t) => {
    const fixture = createReleaseGuardFixture(t);
    runFixtureGit(
      fixture.repositoryPath,
      ['commit', '--allow-empty', '-m', 'advance fixture origin'],
      'create fixture remote advance',
    );
    runFixtureGit(fixture.repositoryPath, ['push', 'origin', 'main'], 'push fixture remote advance');
    runFixtureGit(fixture.repositoryPath, ['reset', '--hard', 'HEAD~1'], 'restore stale fixture HEAD');
    const result = runFixtureGuard(fixture, ['--deploy']);

    assertNormalExit(result, 'stale fixture guard rejection');
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /stale|divergent|origin\/main/i);
  });

  await t.test('dirty worktree failure', (t) => {
    const fixture = createReleaseGuardFixture(t);
    fs.writeFileSync(path.join(fixture.repositoryPath, 'dirty.txt'), 'dirty\n', 'utf8');
    const result = runFixtureGuard(fixture, ['--deploy']);

    assertNormalExit(result, 'dirty fixture guard rejection');
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /dirty|clean checkout/i);
  });

  await t.test('manifest and source drift failure', (t) => {
    const fixture = createReleaseGuardFixture(t);
    const sourcePath = path.join(
      fixture.repositoryPath,
      'obsidian-plugin',
      'wechat-inbox-sync',
      ...ASSET_DEFINITIONS[0].sourcePath.split('/'),
    );
    fs.appendFileSync(sourcePath, '\nfixture drift\n', 'utf8');
    runFixtureGit(fixture.repositoryPath, ['add', '--all'], 'stage fixture source drift');
    runFixtureGit(fixture.repositoryPath, ['commit', '-m', 'drift fixture source'], 'commit fixture source drift');
    runFixtureGit(fixture.repositoryPath, ['push', 'origin', 'main'], 'push fixture source drift');
    const result = runFixtureGuard(fixture, ['--deploy']);

    assertNormalExit(result, 'manifest drift guard rejection');
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /manifest drift/i);
  });

  await t.test('remote advance during validation failure', (t) => {
    const fixture = createReleaseGuardFixture(t, {
      checkerSource: remoteAdvancingCheckerSource(),
    });
    const result = runFixtureGuard(fixture, ['--deploy']);

    assertNormalExit(result, 'concurrent remote advance guard rejection');
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /changed during|snapshot|advance/i);
  });

  await t.test('annotated tag move during validation failure', (t) => {
    const fixture = createReleaseGuardFixture(t, {
      checkerSource: tagMovingCheckerSource('1.3.48'),
      extraCommit: true,
    });
    runFixtureGit(
      fixture.repositoryPath,
      ['tag', '--annotate', '1.3.48', '--message', 'fixture annotated release'],
      'create fixture annotated tag before move',
    );
    const result = runFixtureGuard(fixture, ['--tag', '1.3.48']);

    assertNormalExit(result, 'concurrent tag move guard rejection');
    assert.notEqual(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /tag.*HEAD|changed during|snapshot/i);
  });
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
  assert.match(workflowPermissions(workflow), /^\s+contents:\s*read\s*$/m);

  const guardJob = workflowJob(workflow, 'guards');
  assertFullCheckout(guardJob);
  assertNode24(guardJob);
  assertGovernanceGates(guardJob);
});

test('the component-integrity workflow runs on a schedule and by manual dispatch', {
  skip: !fileExists(relativePaths.integrityWorkflow),
}, () => {
  const workflow = readText(relativePaths.integrityWorkflow);
  const triggers = yamlBlock(workflow, /^on:\s*$/);
  const schedule = yamlBlock(triggers, /^  schedule:\s*$/);
  yamlBlock(triggers, /^  workflow_dispatch:\s*(?:\{\})?\s*$/);
  assert.match(schedule, /^\s+-\s+cron\s*:/m, 'component integrity schedule must define a cron');
  assert.match(workflowPermissions(workflow), /^\s+contents:\s*read\s*$/m);

  const integrityJob = workflowJob(workflow, 'integrity');
  assertFullCheckout(integrityJob);
  assertNode24(integrityJob);
  const runs = executableRuns(integrityJob);
  assertExecutableCommand(runs, 'node scripts/update-local-components-manifest.js --check');
  assertExecutableCommand(runs, 'node scripts/check-local-components-cdn.js');
});

test('tag releases only trigger for numeric version-shaped tags', () => {
  const workflow = readText(relativePaths.releaseWorkflow);
  const triggers = yamlBlock(workflow, /^on:\s*$/);
  const push = yamlBlock(triggers, /^  push:\s*$/);
  const tags = yamlBlock(push, /^    tags:\s*$/);
  assert.match(
    tags,
    /^\s+-\s+['"]?\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+['"]?\s*$/m,
    'release tags must be limited to numeric X.Y.Z-shaped refs',
  );
  assert.doesNotMatch(tags, /^\s+-\s+['"]?\*['"]?\s*$/m, 'release must not trigger for every tag');
  assert.match(workflowPermissions(workflow), /^\s+contents:\s*write\s*$/m);
});

test('tag releases enforce all governance gates before publication', () => {
  const workflow = readText(relativePaths.releaseWorkflow);
  const releaseJob = workflowJob(workflow, 'release');
  assertFullCheckout(releaseJob);
  assertNode24(releaseJob);
  assertGovernanceGates(releaseJob);

  const runs = executableRuns(releaseJob);
  const fetchIndex = runs.findIndex((run) => (
    /\bgit fetch\b/.test(run) && /refs\/remotes\/origin\/main|origin\/main/.test(run)
  ));
  const identifyIndex = runs.findIndex((run) => (
    /\bgit rev-parse\b/.test(run) && /refs\/remotes\/origin\/main|origin\/main/.test(run)
  ));
  const guardIndex = runs.findIndex((run) => (
    executableCommandPattern('node scripts/release-source-guard.js --tag "$TAG_NAME"').test(run)
  ));
  const cdnIndex = runs.findIndex((run) => (
    executableCommandPattern('node scripts/check-local-components-cdn.js').test(run)
  ));
  const packageIndex = runs.findIndex((run) => (
    executableCommandPattern(
      'zip -r "$ZIP_NAME" main.js manifest.json styles.css versions.json README.md LICENSE local-asr local-ocr',
    ).test(run)
  ));
  const publishIndex = runs.findIndex((run) => /\bgh release (?:create|upload)\b/.test(run));
  assert.notEqual(fetchIndex, -1, 'release workflow must fetch origin/main explicitly');
  assert.notEqual(identifyIndex, -1, 'release workflow must identify fetched origin/main');
  assert.notEqual(guardIndex, -1, 'release workflow must execute the main-equality release-source guard');
  assert.notEqual(cdnIndex, -1, 'release workflow must execute the generic component CDN verifier');
  assert.notEqual(packageIndex, -1, 'release workflow must preserve the complete plugin release package');
  assert.notEqual(publishIndex, -1, 'release workflow must contain a GitHub Release publication step');
  assert.ok(fetchIndex < identifyIndex, 'origin/main must be fetched before it is identified');
  assert.ok(identifyIndex < guardIndex, 'origin/main must be identified before the release-source guard');
  assert.ok(guardIndex < publishIndex, 'release-source guard must execute before GitHub Release publication');
  assert.ok(cdnIndex < publishIndex, 'generic CDN verification must execute before GitHub Release publication');
  assert.ok(packageIndex < publishIndex, 'release assets must be packaged before GitHub Release publication');
  assert.equal(
    publishIndex,
    runs.length - 1,
    'GitHub Release publication must be the final executable workflow step',
  );
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
