#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  LOOSE_ASSETS,
  buildCandidateIdentity,
  enumeratePackageEntries,
  normalizePackageBytes,
  sha256,
  validateCandidateIdentity,
} = require('./plugin-release-candidate-core');

function parseArgs(argv) {
  const result = {};
  const allowed = new Set([
    '--candidate',
    '--source',
    '--root-mirror',
    '--installed',
    '--promotion',
    '--json-out',
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || !value || value.startsWith('--')) {
      throw new Error('Usage: verify-plugin-release-candidate.js --candidate <dir> [--source <dir>] [--root-mirror <dir>] [--installed <dir>] [--promotion <file>] [--json-out <file>]');
    }
    result[name.slice(2)] = value;
  }
  if (!result.candidate) throw new Error('candidate is required');
  return result;
}

function readJson(filePath, label) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected an object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
}

function stableIdentity(identity) {
  return JSON.stringify(identity);
}

function identityForDirectory(directory, identity) {
  return buildCandidateIdentity({
    pluginId: identity.pluginId,
    pluginVersion: identity.pluginVersion,
    sourceRoot: identity.sourceRoot,
    entries: enumeratePackageEntries(directory),
  });
}

function assertIdentityEqual(actual, expected, label) {
  if (stableIdentity(actual) !== stableIdentity(expected)) {
    const expectedByPath = new Map(expected.entries.map((entry) => [entry.path, entry]));
    const actualByPath = new Map(actual.entries.map((entry) => [entry.path, entry]));
    const paths = new Set([...expectedByPath.keys(), ...actualByPath.keys()]);
    const drifted = [...paths].filter((entryPath) => (
      JSON.stringify(expectedByPath.get(entryPath)) !== JSON.stringify(actualByPath.get(entryPath))
    ));
    throw new Error(`${label} candidate mismatch${drifted.length ? `: ${drifted.join(', ')}` : ''}`);
  }
}

function installedAssetIdentity(installedDirectory) {
  const root = path.resolve(installedDirectory);
  return LOOSE_ASSETS.map((relativePath) => {
    const filePath = path.join(root, ...relativePath.split('/'));
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch (error) {
      throw new Error(`installed plugin is missing required asset: ${relativePath}`);
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`installed plugin asset must be a regular file: ${relativePath}`);
    }
    const bytes = normalizePackageBytes(relativePath, fs.readFileSync(filePath));
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

function assertInstalledAssetsEqual(actual, expected) {
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry]));
  const paths = new Set([...expectedByPath.keys(), ...actualByPath.keys()]);
  const drifted = [...paths].filter((entryPath) => (
    JSON.stringify(expectedByPath.get(entryPath)) !== JSON.stringify(actualByPath.get(entryPath))
  ));
  if (drifted.length) throw new Error(`installed plugin assets mismatch: ${drifted.join(', ')}`);
}

function assertRootMirror(rootMirror, candidatePackage, identity) {
  const root = path.resolve(rootMirror);
  for (const relativePath of LOOSE_ASSETS) {
    const expected = normalizePackageBytes(
      relativePath,
      fs.readFileSync(path.join(candidatePackage, relativePath)),
    );
    const actualPath = path.join(root, relativePath);
    if (!fs.existsSync(actualPath)) {
      throw new Error(`root mirror is missing ${relativePath}`);
    }
    const actual = fs.readFileSync(actualPath);
    if (actual.length !== expected.length || sha256(actual) !== sha256(expected)) {
      throw new Error(`root mirror drift: ${relativePath}`);
    }
  }
  const manifest = readJson(path.join(root, 'manifest.json'), 'root manifest');
  if (manifest.version !== identity.pluginVersion || manifest.id !== identity.pluginId) {
    throw new Error('root mirror manifest identity drift');
  }
}

function verifyCandidate({
  candidate,
  source,
  rootMirror,
  installed,
  promotion,
}) {
  const candidateDirectory = path.resolve(candidate);
  const receipt = readJson(path.join(candidateDirectory, 'candidate.json'), 'candidate receipt');
  validateCandidateIdentity(receipt.identity, {
    expectedDirectoryName: path.basename(candidateDirectory),
  });
  const packageDirectory = path.join(candidateDirectory, 'package');
  const packageIdentity = identityForDirectory(packageDirectory, receipt.identity);
  assertIdentityEqual(packageIdentity, receipt.identity, 'candidate package');

  if (source) {
    assertIdentityEqual(
      identityForDirectory(path.resolve(source), receipt.identity),
      receipt.identity,
      'canonical source',
    );
  }
  if (rootMirror) {
    assertRootMirror(rootMirror, packageDirectory, receipt.identity);
  }
  if (installed) {
    assertInstalledAssetsEqual(
      installedAssetIdentity(installed),
      receipt.identity.entries.filter((entry) => LOOSE_ASSETS.includes(entry.path)),
    );
  }
  if (promotion) {
    const promoted = readJson(path.resolve(promotion), 'promotion receipt');
    validateCandidateIdentity(promoted);
    assertIdentityEqual(promoted, receipt.identity, 'promotion receipt');
  }

  return {
    success: true,
    candidateId: receipt.identity.candidateId,
    aggregateSha256: receipt.identity.aggregateSha256,
    packageDirectory,
    identity: receipt.identity,
  };
}

function writeJsonAtomic(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, resolved);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifyCandidate({
    candidate: args.candidate,
    source: args.source,
    rootMirror: args['root-mirror'],
    installed: args.installed,
    promotion: args.promotion,
  });
  if (args['json-out']) writeJsonAtomic(args['json-out'], result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Plugin candidate verify failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertIdentityEqual,
  assertRootMirror,
  identityForDirectory,
  installedAssetIdentity,
  parseArgs,
  verifyCandidate,
};
