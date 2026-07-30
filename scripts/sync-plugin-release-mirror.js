#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LOOSE_ASSETS,
  normalizePackageBytes,
  sha256,
} = require('./plugin-release-candidate-core');

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 5) {
    throw new Error('Usage: sync-plugin-release-mirror.js <--check|--write> --source <dir> --root <dir>');
  }
  const mode = argv[0];
  if (mode !== '--check' && mode !== '--write') {
    throw new Error('mirror mode must be --check or --write');
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== '--source' && name !== '--root') || !value || value.startsWith('--')) {
      throw new Error('mirror source and root arguments are invalid');
    }
    values[name.slice(2)] = value;
  }
  if (!values.source || !values.root) throw new Error('mirror source and root are required');
  return { mode, ...values };
}

function expectedLooseAssetBytes(sourceRoot, relativePath) {
  const sourcePath = path.join(sourceRoot, relativePath);
  if (!fs.existsSync(sourcePath) || !fs.lstatSync(sourcePath).isFile()) {
    throw new Error(`canonical source is missing loose asset: ${relativePath}`);
  }
  return normalizePackageBytes(relativePath, fs.readFileSync(sourcePath));
}

function normalizePathForComparison(input) {
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertNoPathAliases(input, label, { requireDirectory = true } = {}) {
  const resolved = path.resolve(input);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} cannot contain a symbolic link, junction, or reparse alias`);
    }
  }
  if (requireDirectory) {
    if (!fs.existsSync(resolved) || !fs.lstatSync(resolved).isDirectory()) {
      throw new Error(`${label} must be an existing real directory`);
    }
  }
  return resolved;
}

function assertSafeMirrorPaths(source, root) {
  const sourceRoot = assertNoPathAliases(source, 'canonical source');
  const mirrorRoot = assertNoPathAliases(root, 'root mirror');
  if (normalizePathForComparison(sourceRoot) === normalizePathForComparison(mirrorRoot)) {
    throw new Error('canonical source and root mirror must be different directories');
  }
  const sourcePrefix = `${normalizePathForComparison(sourceRoot)}${path.sep}`;
  if (normalizePathForComparison(mirrorRoot).startsWith(sourcePrefix)) {
    throw new Error('root mirror cannot be inside the canonical source');
  }
  return { sourceRoot, mirrorRoot };
}

function checkMirror({ source, root }) {
  const { sourceRoot, mirrorRoot } = assertSafeMirrorPaths(source, root);
  for (const relativePath of LOOSE_ASSETS) {
    const expected = expectedLooseAssetBytes(sourceRoot, relativePath);
    const actualPath = path.join(mirrorRoot, relativePath);
    if (!fs.existsSync(actualPath) || !fs.lstatSync(actualPath).isFile()) {
      throw new Error(`root mirror is missing ${relativePath}`);
    }
    const actual = fs.readFileSync(actualPath);
    if (actual.length !== expected.length || sha256(actual) !== sha256(expected)) {
      throw new Error(`root mirror drift: ${relativePath}`);
    }
  }
  return true;
}

function writeFileAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

function writeMirror({
  source,
  root,
  testFailAfterEntry = 0,
  testFailRollbackEntry = '',
}) {
  if ((testFailAfterEntry || testFailRollbackEntry)
    && process.env.WECHAT_INBOX_CANDIDATE_TEST !== '1') {
    throw new Error('test mirror failure injection requires WECHAT_INBOX_CANDIDATE_TEST=1');
  }
  const { sourceRoot, mirrorRoot } = assertSafeMirrorPaths(source, root);
  const transactionId = `${process.pid}-${Date.now()}`;
  const stageRoot = path.join(mirrorRoot, `.plugin-mirror-stage-${transactionId}`);
  const backupRoot = path.join(mirrorRoot, `.plugin-mirror-backup-${transactionId}`);
  const originalExists = new Map();
  let promotionStarted = false;
  let preserveBackup = false;
  fs.mkdirSync(stageRoot);
  fs.mkdirSync(backupRoot);
  try {
    for (const relativePath of LOOSE_ASSETS) {
      fs.writeFileSync(
        path.join(stageRoot, relativePath),
        expectedLooseAssetBytes(sourceRoot, relativePath),
      );
      const destination = path.join(mirrorRoot, relativePath);
      const existed = fs.existsSync(destination);
      originalExists.set(relativePath, existed);
      if (existed) {
        if (!fs.lstatSync(destination).isFile()) {
          throw new Error(`root mirror entry is not a regular file: ${relativePath}`);
        }
        fs.copyFileSync(destination, path.join(backupRoot, relativePath));
      }
    }
    checkMirror({ source: sourceRoot, root: stageRoot });
    promotionStarted = true;
    let promotedCount = 0;
    for (const relativePath of LOOSE_ASSETS) {
      writeFileAtomic(
        path.join(mirrorRoot, relativePath),
        fs.readFileSync(path.join(stageRoot, relativePath)),
      );
      promotedCount += 1;
      if (testFailAfterEntry === promotedCount) {
        throw new Error('injected test mirror promotion failure');
      }
    }
    checkMirror({ source: sourceRoot, root: mirrorRoot });
    return true;
  } catch (error) {
    const rollbackErrors = [];
    if (promotionStarted) {
      for (const relativePath of LOOSE_ASSETS) {
        const destination = path.join(mirrorRoot, relativePath);
        try {
          if (testFailRollbackEntry === relativePath) {
            throw new Error('injected test rollback failure');
          }
          if (originalExists.get(relativePath)) {
            writeFileAtomic(destination, fs.readFileSync(path.join(backupRoot, relativePath)));
          } else if (originalExists.has(relativePath) && fs.existsSync(destination)) {
            fs.unlinkSync(destination);
          }
        } catch (rollbackError) {
          rollbackErrors.push(`${relativePath}: ${rollbackError.message}`);
        }
      }
    }
    if (rollbackErrors.length) {
      preserveBackup = true;
      throw new Error(
        `mirror promotion failed: ${error.message}; rollback incomplete: `
        + `${rollbackErrors.join('; ')}; backup preserved at ${backupRoot}`,
      );
    }
    throw error;
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    if (!preserveBackup) {
      fs.rmSync(backupRoot, { recursive: true, force: true });
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === '--write') {
    writeMirror(args);
  } else {
    checkMirror(args);
  }
  process.stdout.write(`${JSON.stringify({ success: true, mode: args.mode })}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Plugin root mirror failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertNoPathAliases,
  assertSafeMirrorPaths,
  checkMirror,
  expectedLooseAssetBytes,
  parseArgs,
  writeMirror,
};
