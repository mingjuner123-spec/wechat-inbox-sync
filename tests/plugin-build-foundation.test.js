'use strict';

const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const sourcePath = path.join(pluginDir, 'src', 'main.js');
const outputPath = path.join(pluginDir, 'main.js');
const buildScriptPath = path.join(pluginDir, 'build-plugin.js');
const packageJsonPath = path.join(pluginDir, 'package.json');
const packageLockPath = path.join(pluginDir, 'package-lock.json');
const mainWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'main-guards.yml');
const releaseWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml');

for (const requiredPath of [
  sourcePath,
  outputPath,
  buildScriptPath,
  packageJsonPath,
  packageLockPath,
]) {
  assert.ok(fs.existsSync(requiredPath), `required build path must exist: ${requiredPath}`);
}

for (const generatedPath of [sourcePath, outputPath]) {
  const relativePath = path.relative(repoRoot, generatedPath).replace(/\\/g, '/');
  const attribute = childProcess.execFileSync(
    'git',
    ['check-attr', 'eol', '--', relativePath],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.match(
    attribute,
    /:\s+eol:\s+lf\s*$/i,
    `${relativePath} must use LF so Windows checkouts remain reproducible`,
  );
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8'));
assert.strictEqual(packageJson.private, true);
assert.strictEqual(packageJson.version, '0.0.0');
assert.deepStrictEqual(packageJson.scripts, {
  build: 'node build-plugin.js',
  check: 'node build-plugin.js --check',
});
assert.strictEqual(
  packageJson.devDependencies && packageJson.devDependencies.esbuild,
  '0.28.1',
  'the bundler must be pinned exactly',
);
for (const platformPackage of [
  'node_modules/@esbuild/darwin-arm64',
  'node_modules/@esbuild/linux-x64',
  'node_modules/@esbuild/win32-x64',
]) {
  assert.ok(
    packageLock.packages && packageLock.packages[platformPackage],
    `lockfile must preserve cross-platform build package ${platformPackage}`,
  );
}
assert.strictEqual(
  fs.readFileSync(packageLockPath, 'utf8').includes('registry.npmmirror.com'),
  false,
  'the public lockfile must not depend on a developer-only registry',
);

const builder = require(buildScriptPath);
const outputBytes = fs.readFileSync(outputPath);

assert.strictEqual(builder.checkPluginBuild(), true, 'committed bundle must have no source drift');
assert.deepStrictEqual(
  outputBytes,
  builder.getPluginBuildBytes(),
  'fresh deterministic build must equal committed main.js byte-for-byte',
);
assert.ok(
  outputBytes.includes(Buffer.from('require("obsidian")'))
    || outputBytes.includes(Buffer.from("require('obsidian')")),
  'Obsidian must remain an external runtime dependency',
);
assert.ok(
  outputBytes.includes(Buffer.from("require('fs')"))
    || outputBytes.includes(Buffer.from('require("fs")')),
  'Node built-ins must remain external',
);

const firstBuild = builder.getPluginBuildBytes();
const secondBuild = builder.getPluginBuildBytes();
assert.deepStrictEqual(firstBuild, secondBuild, 'two builds from the same source must be identical');

const fixtureRoot = fs.mkdtempSync(path.join(pluginDir, '.tmp-plugin-build-foundation-'));
const fixtureSource = path.join(fixtureRoot, 'src', 'main.js');
const fixtureOutput = path.join(fixtureRoot, 'main.js');

try {
  fs.mkdirSync(path.dirname(fixtureSource), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(fixtureSource), 'value.js'), 'module.exports = "stable";\n');
  fs.writeFileSync(fixtureSource, 'module.exports = require("./value");\n');
  fs.writeFileSync(fixtureOutput, 'module.exports = "drift";\n');

  assert.strictEqual(
    builder.checkPluginBuild({ sourcePath: fixtureSource, outputPath: fixtureOutput }),
    false,
    'output drift must be detected',
  );

  builder.buildPlugin({ sourcePath: fixtureSource, outputPath: fixtureOutput });
  assert.deepStrictEqual(
    fs.readFileSync(fixtureOutput),
    builder.getPluginBuildBytes({ sourcePath: fixtureSource, outputPath: fixtureOutput }),
    'build must restore exact output',
  );

  fs.rmSync(path.dirname(fixtureSource), { recursive: true, force: true });
  delete require.cache[fixtureOutput];
  assert.strictEqual(require(fixtureOutput), 'stable', 'built output must be self-contained');

  fs.mkdirSync(path.dirname(fixtureSource), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(fixtureSource), 'value.js'), 'module.exports = "changed";\n');
  fs.writeFileSync(fixtureSource, 'module.exports = require("./value");\n');
  assert.strictEqual(
    builder.checkPluginBuild({ sourcePath: fixtureSource, outputPath: fixtureOutput }),
    false,
    'source drift must be detected',
  );

  fs.rmSync(fixtureOutput);
  assert.strictEqual(
    builder.checkPluginBuild({ sourcePath: fixtureSource, outputPath: fixtureOutput }),
    false,
    'missing output must be detected',
  );

  fs.rmSync(fixtureSource);
  assert.throws(
    () => builder.buildPlugin({ sourcePath: fixtureSource, outputPath: fixtureOutput }),
    /source|ENOENT|Could not resolve|build failed/i,
    'missing source must fail closed',
  );

  fs.mkdirSync(path.dirname(fixtureSource), { recursive: true });
  fs.writeFileSync(fixtureSource, 'module.exports = require("./missing");\n');
  assert.throws(
    () => builder.getPluginBuildBytes({ sourcePath: fixtureSource, outputPath: fixtureOutput }),
    /Could not resolve|build failed/i,
    'a missing relative module must not be copied into a falsely green bundle',
  );

  fs.writeFileSync(path.join(path.dirname(fixtureSource), 'value.js'), 'module.exports = "dynamic";\n');
  fs.writeFileSync(
    fixtureSource,
    'const localPath = "./value";\nmodule.exports = require(localPath);\n',
  );
  assert.throws(
    () => builder.getPluginBuildBytes({ sourcePath: fixtureSource, outputPath: fixtureOutput }),
    /dynamic|relative|unbundled|require/i,
    'a dynamic relative require must not survive into the single-file release bundle',
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

const checkResult = childProcess.spawnSync(
  process.execPath,
  [buildScriptPath, '--check'],
  { cwd: repoRoot, encoding: 'utf8' },
);
assert.strictEqual(checkResult.status, 0, checkResult.stderr || checkResult.stdout);

const invalidResult = childProcess.spawnSync(
  process.execPath,
  [buildScriptPath, '--write-and-publish'],
  { cwd: repoRoot, encoding: 'utf8' },
);
assert.notStrictEqual(invalidResult.status, 0, 'unknown build modes must fail closed');
assert.match(`${invalidResult.stdout}\n${invalidResult.stderr}`, /usage|unsupported|argument/i);

for (const workflowPath of [mainWorkflowPath, releaseWorkflowPath]) {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(
    workflow,
    /npm\s+ci\s+--prefix\s+obsidian-plugin\/wechat-inbox-sync/,
    `${path.basename(workflowPath)} must install the pinned build toolchain`,
  );
  assert.match(
    workflow,
    /node\s+tests\/plugin-build-foundation\.test\.js/,
    `${path.basename(workflowPath)} must run the source/bundle drift gate`,
  );

  const buildGateIndex = workflow.indexOf('node tests/plugin-build-foundation.test.js');
  const candidateIndex = workflow.indexOf('node scripts/prepare-plugin-release-candidate.js');
  assert.ok(buildGateIndex >= 0 && candidateIndex >= 0 && buildGateIndex < candidateIndex,
    `${path.basename(workflowPath)} must verify the committed bundle before candidate preparation`);
}
