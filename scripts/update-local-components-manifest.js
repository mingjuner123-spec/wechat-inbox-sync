#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  ASSET_DEFINITIONS,
  assertManifestMatches,
  buildManifest,
  serializeManifest,
  validateCanonicalManifest,
  validateRepositoryPath,
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
  const manifest = buildManifest(ASSET_DEFINITIONS.map((definition) => ({
    ...definition,
    contents: fs.readFileSync(resolveContainedSourcePath(PLUGIN_ROOT, definition.sourcePath)),
  })));
  validateCanonicalManifest(manifest);
  return manifest;
}

function resolveContainedSourcePath(pluginRoot, sourcePath) {
  const resolvedRoot = path.resolve(pluginRoot);
  const resolvedSource = path.resolve(resolvedRoot, sourcePath);
  const relative = path.relative(resolvedRoot, resolvedSource);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError(`sourcePath escapes plugin root: ${sourcePath}`);
  }
  validateRepositoryPath(sourcePath, 'sourcePath');

  let currentPath = resolvedRoot;
  for (const segment of sourcePath.split('/')) {
    currentPath = path.join(currentPath, segment);
    const stats = fs.lstatSync(currentPath);
    if (stats.isSymbolicLink()) {
      throw new TypeError(`sourcePath contains a symbolic link or reparse point: ${sourcePath}`);
    }
  }
  const canonicalRoot = fs.realpathSync.native(resolvedRoot);
  const canonicalSource = fs.realpathSync.native(resolvedSource);
  const canonicalRelative = path.relative(canonicalRoot, canonicalSource);
  if (
    canonicalRelative === '..'
    || canonicalRelative.startsWith(`..${path.sep}`)
    || path.isAbsolute(canonicalRelative)
  ) {
    throw new TypeError(`sourcePath escapes plugin root through a reparse point: ${sourcePath}`);
  }
  return resolvedSource;
}

function writeFileAtomically(destinationPath, contents) {
  const tempPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.tmp-${process.pid}-${randomUUID()}`,
  );
  try {
    fs.writeFileSync(tempPath, contents, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tempPath, destinationPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        error.message += `; temporary file cleanup failed: ${cleanupError.message}`;
      }
    }
    throw error;
  }
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
  validateCanonicalManifest(committedManifest);
  assertManifestMatches(committedManifest, expectedManifest);
  if (committedText !== expectedText) {
    throw new Error('local component manifest formatting drift detected; run with --write');
  }
  process.stdout.write('Local component manifest is current.\n');
}

function writeManifest() {
  const manifest = buildCurrentManifest();
  writeFileAtomically(MANIFEST_PATH, serializeManifest(manifest));
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
  resolveContainedSourcePath,
  writeFileAtomically,
};
