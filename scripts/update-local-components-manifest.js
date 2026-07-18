#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  ASSET_DEFINITIONS,
  assertManifestMatches,
  buildManifest,
  serializeManifest,
  validateManifest,
} = require('./local-component-manifest-core');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'obsidian-plugin', 'wechat-inbox-sync');
const MANIFEST_PATH = path.join(PLUGIN_ROOT, 'local-components-manifest.json');
const USAGE = `Usage: node scripts/update-local-components-manifest.js <mode>

Modes:
  --check  Verify the committed manifest matches canonical source bytes
  --write  Regenerate the manifest from canonical source bytes
  --help   Show this help
`;

function buildCurrentManifest() {
  return buildManifest(ASSET_DEFINITIONS.map((definition) => ({
    ...definition,
    contents: fs.readFileSync(path.join(PLUGIN_ROOT, ...definition.sourcePath.split('/'))),
  })));
}

function checkManifest() {
  const expectedManifest = buildCurrentManifest();
  const expectedText = serializeManifest(expectedManifest);
  let committedText;
  let committedManifest;
  try {
    committedText = fs.readFileSync(MANIFEST_PATH, 'utf8');
    committedManifest = JSON.parse(committedText);
  } catch (error) {
    throw new Error(`cannot read committed local component manifest: ${error.message}`);
  }
  validateManifest(committedManifest);
  assertManifestMatches(committedManifest, expectedManifest);
  if (committedText !== expectedText) {
    throw new Error('local component manifest formatting drift detected; run with --write');
  }
  process.stdout.write('Local component manifest is current.\n');
}

function writeManifest() {
  const manifest = buildCurrentManifest();
  fs.writeFileSync(MANIFEST_PATH, serializeManifest(manifest), 'utf8');
  process.stdout.write(`Wrote ${path.relative(REPO_ROOT, MANIFEST_PATH).replace(/\\/g, '/')}.\n`);
}

function main(args = process.argv.slice(2)) {
  if (args.length !== 1) {
    process.stderr.write(USAGE);
    return 1;
  }
  switch (args[0]) {
    case '--check':
      checkManifest();
      return 0;
    case '--write':
      writeManifest();
      return 0;
    case '--help':
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`Unknown mode: ${args[0]}\n${USAGE}`);
      return 1;
  }
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildCurrentManifest,
  main,
};
