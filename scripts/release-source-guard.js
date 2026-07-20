'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  assertCleanStatus,
  validateDeployState,
  validateTagState,
  validateVersionTag,
} = require('./release-source-guard-core');

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT_MANIFEST_PATH = path.join(REPO_ROOT, 'manifest.json');
const PLUGIN_MANIFEST_PATH = path.join(
  REPO_ROOT,
  'obsidian-plugin',
  'wechat-inbox-sync',
  'manifest.json',
);
const MANIFEST_CHECKER_PATH = path.join(
  REPO_ROOT,
  'scripts',
  'update-local-components-manifest.js',
);
const LOCAL_COMMAND_TIMEOUT_MS = 10000;
const REMOTE_COMMAND_TIMEOUT_MS = 30000;
const NON_INTERACTIVE_GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'Never',
};
const USAGE = `Usage: node scripts/release-source-guard.js <mode>

Modes:
  --deploy         Require a clean HEAD exactly equal to current origin/main
  --tag <X.Y.Z>   Also require the tag, HEAD, manifests, and origin/main to match
  --help           Show this help
`;

function commandErrorDetail(error) {
  const stderr = typeof error.stderr === 'string'
    ? error.stderr.trim()
    : Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8').trim() : '';
  const stdout = typeof error.stdout === 'string'
    ? error.stdout.trim()
    : Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8').trim() : '';
  return stderr || stdout || error.message || String(error);
}

function runCommand(file, args, label, {
  env = process.env,
  timeoutMs = LOCAL_COMMAND_TIMEOUT_MS,
} = {}) {
  try {
    return childProcess.execFileSync(file, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
  } catch (error) {
    if (error && (error.code === 'ETIMEDOUT' || error.errno === 'ETIMEDOUT')) {
      throw new Error(`${label} timed out after ${timeoutMs} ms`);
    }
    throw new Error(`${label} failed: ${commandErrorDetail(error)}`);
  }
}

function runGit(args, label, { remote = false } = {}) {
  return runCommand('git', args, `Git probe for ${label}`, {
    env: NON_INTERACTIVE_GIT_ENV,
    timeoutMs: remote ? REMOTE_COMMAND_TIMEOUT_MS : LOCAL_COMMAND_TIMEOUT_MS,
  });
}

function readManifestVersion(manifestPath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed.version;
}

function runCanonicalManifestCheck() {
  runCommand(
    process.execPath,
    [MANIFEST_CHECKER_PATH, '--check'],
    'canonical local component manifest check',
  );
}

function probeCleanStatus() {
  const statusOutput = runGit(
    ['status', '--porcelain', '--untracked-files=all'],
    'clean worktree status',
  );
  assertCleanStatus(statusOutput);
  return statusOutput;
}

function probeHead() {
  return runGit(['rev-parse', 'HEAD'], 'local HEAD');
}

function probeRemoteMain() {
  return runGit(
    ['ls-remote', 'origin', 'refs/heads/main'],
    'remote origin/main',
    { remote: true },
  );
}

function probeBaseSnapshot() {
  const statusOutput = probeCleanStatus();
  const headOutput = probeHead();
  const remoteMainOutput = probeRemoteMain();
  return validateDeployState({
    statusOutput,
    headOutput,
    remoteMainOutput,
  });
}

function probeTagSnapshot(tag, baseSnapshot) {
  const rootVersion = readManifestVersion(ROOT_MANIFEST_PATH, 'root manifest.json');
  const pluginVersion = readManifestVersion(
    PLUGIN_MANIFEST_PATH,
    'plugin manifest.json',
  );
  const state = validateTagState({
    statusOutput: '',
    headOutput: `${baseSnapshot.head}\n`,
    tagOutput: runGit(
      ['rev-parse', `refs/tags/${tag}^{}`],
      `tag ${tag} commit`,
    ),
    remoteMainOutput: `${baseSnapshot.remoteMain}\trefs/heads/main\n`,
    tag,
    rootVersion,
    pluginVersion,
  });
  return {
    ...state,
    rootVersion,
    pluginVersion,
  };
}

function assertSnapshotUnchanged(before, after, fields, label) {
  const changedFields = fields.filter((field) => before[field] !== after[field]);
  if (changedFields.length > 0) {
    throw new Error(
      `${label} changed during release source guard (${changedFields.join(', ')}); `
      + 'refusing a moving publication snapshot',
    );
  }
}

function runDeployGuard() {
  const before = probeBaseSnapshot();
  runCanonicalManifestCheck();
  const after = probeBaseSnapshot();
  assertSnapshotUnchanged(
    before,
    after,
    ['head', 'remoteMain'],
    'deploy source snapshot',
  );
  process.stdout.write(
    `Deploy source guard passed: HEAD ${after.head} equals current origin/main.\n`,
  );
}

function runTagGuard(tag) {
  validateVersionTag(tag);
  const beforeBase = probeBaseSnapshot();
  const before = probeTagSnapshot(tag, beforeBase);
  runCanonicalManifestCheck();
  const afterBase = probeBaseSnapshot();
  const after = probeTagSnapshot(tag, afterBase);
  assertSnapshotUnchanged(
    before,
    after,
    ['head', 'tagCommit', 'remoteMain', 'version', 'rootVersion', 'pluginVersion'],
    'tag source snapshot',
  );
  process.stdout.write(
    `Tag source guard passed: ${after.version} and HEAD ${after.head} equal current origin/main.\n`,
  );
}

function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(USAGE);
    return;
  }
  if (args.length === 1 && args[0] === '--deploy') {
    runDeployGuard();
    return;
  }
  if (args.length === 2 && args[0] === '--tag') {
    runTagGuard(args[1]);
    return;
  }
  throw new Error(`invalid or incomplete arguments\n${USAGE}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Release source guard failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  readManifestVersion,
  runDeployGuard,
  runTagGuard,
};
