#!/usr/bin/env node
'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildCandidateIdentity,
  enumeratePackageEntries,
  validateCandidateIdentity,
} = require('./plugin-release-candidate-core');

function parseArgs(argv) {
  const result = {};
  const allowed = new Set([
    '--source',
    '--artifacts-root',
    '--json-out',
    '--verify-promotion',
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || !value || value.startsWith('--')) {
      throw new Error('Usage: prepare-plugin-release-candidate.js --source <dir> --artifacts-root <dir> [--verify-promotion <release-candidate.json>] [--json-out <file>]');
    }
    result[name.slice(2)] = value;
  }
  if (!result.source || !result['artifacts-root']) {
    throw new Error('source and artifacts-root are required');
  }
  return result;
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`);
  }
  return parsed;
}

function readPluginMetadata(sourceRoot) {
  const manifest = readJson(path.join(sourceRoot, 'manifest.json'), 'plugin manifest');
  const versions = readJson(path.join(sourceRoot, 'versions.json'), 'plugin versions');
  const pluginId = String(manifest.id || '').trim();
  const pluginVersion = String(manifest.version || '').trim();
  if (pluginId !== 'wechat-inbox-sync') {
    throw new Error('plugin manifest id must be wechat-inbox-sync');
  }
  if (!pluginVersion || !Object.prototype.hasOwnProperty.call(versions, pluginVersion)) {
    throw new Error('plugin manifest version must exist in versions.json');
  }
  return { pluginId, pluginVersion };
}

function tryReadGitHead(sourceRoot) {
  const result = childProcess.spawnSync(
    'git',
    ['-C', sourceRoot, 'rev-parse', 'HEAD'],
    { encoding: 'utf8', windowsHide: true },
  );
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function writeJsonAtomic(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  const temporaryPath = path.join(
    parent,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  );
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function writePackage(packageRoot, entries) {
  for (const entry of entries) {
    const destination = path.join(packageRoot, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.content);
  }
}

function publicIdentity(value) {
  return JSON.stringify(value);
}

function verifyExistingCandidate(candidateDirectory, expectedIdentity, options = {}) {
  const receipt = readJson(path.join(candidateDirectory, 'candidate.json'), 'candidate receipt');
  validateCandidateIdentity(
    receipt.identity,
    options.ignoreDirectoryName
      ? {}
      : { expectedDirectoryName: path.basename(candidateDirectory) },
  );
  if (publicIdentity(receipt.identity) !== publicIdentity(expectedIdentity)) {
    throw new Error('existing candidate identity is different');
  }
  const packageEntries = enumeratePackageEntries(path.join(candidateDirectory, 'package'));
  const packageIdentity = buildCandidateIdentity({
    pluginId: expectedIdentity.pluginId,
    pluginVersion: expectedIdentity.pluginVersion,
    sourceRoot: expectedIdentity.sourceRoot,
    entries: packageEntries,
  });
  if (publicIdentity(packageIdentity) !== publicIdentity(expectedIdentity)) {
    throw new Error('existing candidate package drift');
  }
}

function prepareCandidate({ source, artifactsRoot }) {
  const sourceRoot = path.resolve(source);
  const outputRoot = path.resolve(artifactsRoot);
  const metadata = readPluginMetadata(sourceRoot);
  const entries = enumeratePackageEntries(sourceRoot);
  const identity = buildCandidateIdentity({
    ...metadata,
    sourceRoot: 'obsidian-plugin/wechat-inbox-sync',
    entries,
  });
  const candidateDirectory = path.join(outputRoot, identity.candidateId);
  const packageDirectory = path.join(candidateDirectory, 'package');

  fs.mkdirSync(outputRoot, { recursive: true });
  if (fs.existsSync(candidateDirectory)) {
    verifyExistingCandidate(candidateDirectory, identity);
    return {
      candidateId: identity.candidateId,
      candidateDirectory,
      packageDirectory,
      reused: true,
      aggregateSha256: identity.aggregateSha256,
    };
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(outputRoot, '.tmp-'));
  try {
    writePackage(path.join(temporaryDirectory, 'package'), entries);
    const receipt = {
      identity,
      provenance: {
        createdAt: new Date().toISOString(),
        sourceHead: tryReadGitHead(sourceRoot),
        hostPlatform: `${os.platform()}-${os.arch()}`,
      },
    };
    fs.writeFileSync(
      path.join(temporaryDirectory, 'candidate.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
      'utf8',
    );
    verifyExistingCandidate(temporaryDirectory, identity, { ignoreDirectoryName: true });
    fs.renameSync(temporaryDirectory, candidateDirectory);
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    candidateId: identity.candidateId,
    candidateDirectory,
    packageDirectory,
    reused: false,
    aggregateSha256: identity.aggregateSha256,
  };
}

function verifyPromotion(candidateDirectory, promotionPath) {
  const candidateReceipt = readJson(
    path.join(candidateDirectory, 'candidate.json'),
    'candidate receipt',
  );
  const promotion = readJson(path.resolve(promotionPath), 'promotion receipt');
  validateCandidateIdentity(promotion);
  if (publicIdentity(promotion) !== publicIdentity(candidateReceipt.identity)) {
    throw new Error('promotion receipt does not match the prepared candidate identity');
  }
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = prepareCandidate({
    source: args.source,
    artifactsRoot: args['artifacts-root'],
  });
  if (args['verify-promotion']) {
    verifyPromotion(result.candidateDirectory, args['verify-promotion']);
  }
  if (args['json-out']) {
    writeJsonAtomic(path.resolve(args['json-out']), result);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Plugin candidate prepare failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  prepareCandidate,
  readPluginMetadata,
  verifyPromotion,
  verifyExistingCandidate,
  writeJsonAtomic,
};
