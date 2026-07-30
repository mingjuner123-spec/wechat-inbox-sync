#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateCandidateIdentity } = require('./plugin-release-candidate-core');
const {
  assertNoPathAliases,
  checkMirror,
} = require('./sync-plugin-release-mirror');
const { verifyCandidate } = require('./verify-plugin-release-candidate');

function parseArgs(argv) {
  const allowed = new Set([
    '--candidate',
    '--source',
    '--root-mirror',
    '--installed',
    '--output',
  ]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name) || !value || value.startsWith('--')) {
      throw new Error('Usage: promote-plugin-release-candidate.js --candidate <dir> --source <dir> --root-mirror <dir> --installed <dir> --output <release-candidate.json>');
    }
    result[name.slice(2)] = value;
  }
  for (const required of ['candidate', 'source', 'root-mirror', 'installed', 'output']) {
    if (!result[required]) throw new Error(`${required} is required`);
  }
  return result;
}

function writeVerifiedJsonAtomic(filePath, value) {
  const resolved = path.resolve(filePath);
  const temporary = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    const staged = JSON.parse(fs.readFileSync(temporary, 'utf8'));
    validateCandidateIdentity(staged);
    if (JSON.stringify(staged) !== JSON.stringify(value)) {
      throw new Error('staged promotion receipt verification failed');
    }
    fs.renameSync(temporary, resolved);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function promoteCandidate({
  candidate,
  source,
  rootMirror,
  installed,
  output,
}) {
  const safeRootMirror = assertNoPathAliases(rootMirror, 'root mirror');
  const safeCandidate = assertNoPathAliases(candidate, 'candidate');
  const safeSource = assertNoPathAliases(source, 'canonical source');
  const safeInstalled = assertNoPathAliases(installed, 'installed plugin');
  const resolvedOutput = path.resolve(output);
  assertNoPathAliases(resolvedOutput, 'promotion output', { requireDirectory: false });
  const expectedOutput = path.join(safeRootMirror, 'release-candidate.json');
  const compare = (value) => (
    process.platform === 'win32' ? value.toLowerCase() : value
  );
  if (compare(resolvedOutput) !== compare(expectedOutput)) {
    throw new Error('promotion output must be root mirror release-candidate.json');
  }
  const verification = verifyCandidate({
    candidate: safeCandidate,
    source: safeSource,
    rootMirror: safeRootMirror,
    installed: safeInstalled,
  });
  checkMirror({ source: safeSource, root: safeRootMirror });
  const identity = verification.identity;
  writeVerifiedJsonAtomic(resolvedOutput, identity);
  return {
    success: true,
    candidateId: identity.candidateId,
    aggregateSha256: identity.aggregateSha256,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = promoteCandidate({
    candidate: args.candidate,
    source: args.source,
    rootMirror: args['root-mirror'],
    installed: args.installed,
    output: args.output,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Plugin candidate promotion failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  promoteCandidate,
  writeVerifiedJsonAtomic,
};
