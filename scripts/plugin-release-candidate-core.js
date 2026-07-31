'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOOSE_ASSETS = Object.freeze([
  'main.js',
  'manifest.json',
  'styles.css',
  'versions.json',
]);

const PACKAGE_ROOT_FILES = Object.freeze([
  ...LOOSE_ASSETS,
  'README.md',
  'LICENSE',
]);

const PACKAGE_DIRECTORIES = Object.freeze([
  'local-asr',
  'local-ocr',
]);

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.json',
  '.md',
  '.ps1',
  '.py',
  '.sh',
]);

const CANDIDATE_SCHEMA_VERSION = 1;
const CANDIDATE_HASH_PREFIX_LENGTH = 16;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PLUGIN_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeRelativePackagePath(input) {
  const source = String(input || '');
  if (!source || source.includes('\\') || source.includes('\0')) {
    throw new Error('package path must be a non-empty canonical POSIX relative path');
  }
  if (source.normalize('NFC') !== source) {
    throw new Error('package path must use canonical NFC Unicode');
  }
  if (source.startsWith('/') || /^[A-Za-z]:/.test(source)) {
    throw new Error('package path must be relative');
  }
  const segments = source.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('package path cannot contain empty, dot, or parent segments');
  }
  return source;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function assertCanonicalEntryPaths(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('candidate entries must be a non-empty array');
  }
  const exact = new Set();
  const folded = new Set();
  let previous = null;
  for (const entry of entries) {
    const entryPath = normalizeRelativePackagePath(entry && entry.path);
    const foldedPath = entryPath.toLocaleLowerCase('en-US');
    if (exact.has(entryPath) || folded.has(foldedPath)) {
      throw new Error(`candidate path collision or duplicate: ${entryPath}`);
    }
    if (previous !== null && compareUtf8(previous, entryPath) >= 0) {
      throw new Error('candidate entries must be uniquely sorted by UTF-8 path bytes');
    }
    exact.add(entryPath);
    folded.add(foldedPath);
    previous = entryPath;
  }
  return true;
}

function isTextPackagePath(relativePath) {
  return relativePath === 'LICENSE'
    || TEXT_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function normalizePackageBytes(relativePath, input) {
  const source = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!isTextPackagePath(relativePath)) return Buffer.from(source);
  return Buffer.from(source.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
}

function assertAllowedPackagePath(relativePath) {
  const normalized = normalizeRelativePackagePath(relativePath);
  if (PACKAGE_ROOT_FILES.includes(normalized)) return normalized;
  if (PACKAGE_DIRECTORIES.some((directory) => normalized.startsWith(`${directory}/`))) {
    return normalized;
  }
  throw new Error(`path is outside the release package allowlist: ${normalized}`);
}

function assertRegularFile(filePath, relativePath) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`symbolic link or reparse alias is forbidden: ${relativePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`release package entry must be a regular file: ${relativePath}`);
  }
}

function collectDirectoryFiles(root, directory, output) {
  const directoryPath = path.join(root, directory);
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`release package directory must be a real directory: ${directory}`);
  }
  const children = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const child of children) {
    const relativePath = `${directory}/${child.name}`;
    const absolutePath = path.join(directoryPath, child.name);
    const childStat = fs.lstatSync(absolutePath);
    if (childStat.isSymbolicLink()) {
      throw new Error(`symbolic link or reparse alias is forbidden: ${relativePath}`);
    }
    if (childStat.isDirectory()) {
      collectDirectoryFiles(root, relativePath, output);
      continue;
    }
    if (!childStat.isFile()) {
      throw new Error(`release package entry must be a regular file: ${relativePath}`);
    }
    output.push(assertAllowedPackagePath(relativePath));
  }
}

function enumeratePackageEntries(pluginRoot) {
  const root = path.resolve(String(pluginRoot || ''));
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('plugin source root must be a real directory');
  }

  const relativePaths = [];
  for (const relativePath of PACKAGE_ROOT_FILES) {
    const absolutePath = path.join(root, relativePath);
    assertRegularFile(absolutePath, relativePath);
    relativePaths.push(relativePath);
  }
  for (const directory of PACKAGE_DIRECTORIES) {
    collectDirectoryFiles(root, directory, relativePaths);
  }
  relativePaths.sort(compareUtf8);

  const entries = relativePaths.map((relativePath) => {
    const content = normalizePackageBytes(
      relativePath,
      fs.readFileSync(path.join(root, ...relativePath.split('/'))),
    );
    return {
      path: relativePath,
      bytes: content.length,
      sha256: sha256(content),
      content,
    };
  });
  assertCanonicalEntryPaths(entries);
  return entries;
}

function encodeField(value) {
  const bytes = Buffer.from(String(value), 'utf8');
  return Buffer.concat([
    Buffer.from(`${bytes.length}:`, 'ascii'),
    bytes,
  ]);
}

function encodeAggregateEntries(entries, metadata = {}) {
  assertCanonicalEntryPaths(entries);
  const chunks = [
    Buffer.from('WECHAT_INBOX_RELEASE_CANDIDATE_V1\0', 'ascii'),
    encodeField(metadata.pluginId || ''),
    encodeField(metadata.pluginVersion || ''),
    encodeField(metadata.sourceRoot || ''),
  ];
  for (const entry of entries) {
    chunks.push(
      encodeField(entry.path),
      encodeField(String(entry.bytes)),
      encodeField(entry.sha256),
    );
  }
  return Buffer.concat(chunks);
}

function publicEntry(entry) {
  return {
    path: normalizeRelativePackagePath(entry.path),
    bytes: Number(entry.bytes),
    sha256: String(entry.sha256 || '').toLowerCase(),
  };
}

function validatePublicEntries(entries) {
  const normalizedEntries = entries.map(publicEntry);
  assertCanonicalEntryPaths(normalizedEntries);
  for (const entry of normalizedEntries) {
    assertAllowedPackagePath(entry.path);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`candidate entry bytes are invalid: ${entry.path}`);
    }
    if (!SHA256_PATTERN.test(entry.sha256)) {
      throw new Error(`candidate entry SHA-256 is invalid: ${entry.path}`);
    }
  }
  return normalizedEntries;
}

function buildCandidateIdentity({
  pluginId,
  pluginVersion,
  sourceRoot,
  entries,
}) {
  const normalizedPluginId = String(pluginId || '').trim();
  const normalizedVersion = String(pluginVersion || '').trim();
  const normalizedSourceRoot = normalizeRelativePackagePath(sourceRoot);
  if (normalizedPluginId !== 'wechat-inbox-sync') {
    throw new Error('candidate plugin id must be wechat-inbox-sync');
  }
  if (!PLUGIN_VERSION_PATTERN.test(normalizedVersion)) {
    throw new Error('candidate plugin version must be semantic X.Y.Z');
  }
  const publicEntries = validatePublicEntries(entries);
  const metadata = {
    pluginId: normalizedPluginId,
    pluginVersion: normalizedVersion,
    sourceRoot: normalizedSourceRoot,
  };
  const aggregateSha256 = sha256(encodeAggregateEntries(publicEntries, metadata));
  return {
    schemaVersion: CANDIDATE_SCHEMA_VERSION,
    ...metadata,
    candidateId: `${normalizedVersion}-${aggregateSha256.slice(0, CANDIDATE_HASH_PREFIX_LENGTH)}`,
    aggregateSha256,
    looseAssets: [...LOOSE_ASSETS],
    entries: publicEntries,
  };
}

function validateCandidateIdentity(identity, options = {}) {
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new Error('candidate identity must be an object');
  }
  if (identity.schemaVersion !== CANDIDATE_SCHEMA_VERSION) {
    throw new Error('candidate identity schema version is unsupported');
  }
  const rebuilt = buildCandidateIdentity({
    pluginId: identity.pluginId,
    pluginVersion: identity.pluginVersion,
    sourceRoot: identity.sourceRoot,
    entries: identity.entries,
  });
  if (identity.aggregateSha256 !== rebuilt.aggregateSha256) {
    throw new Error('candidate aggregate identity drift');
  }
  if (identity.candidateId !== rebuilt.candidateId) {
    throw new Error('candidate id differs from aggregate identity');
  }
  if (JSON.stringify(identity.looseAssets) !== JSON.stringify(rebuilt.looseAssets)) {
    throw new Error('candidate loose asset identity drift');
  }
  if (JSON.stringify(identity.entries) !== JSON.stringify(rebuilt.entries)) {
    throw new Error('candidate entry bytes or identity drift');
  }
  if (options.expectedDirectoryName
    && String(options.expectedDirectoryName) !== rebuilt.candidateId) {
    throw new Error('candidate directory name differs from candidate identity');
  }
  return true;
}

module.exports = {
  CANDIDATE_HASH_PREFIX_LENGTH,
  CANDIDATE_SCHEMA_VERSION,
  LOOSE_ASSETS,
  PACKAGE_DIRECTORIES,
  PACKAGE_ROOT_FILES,
  assertAllowedPackagePath,
  assertCanonicalEntryPaths,
  buildCandidateIdentity,
  compareUtf8,
  encodeAggregateEntries,
  enumeratePackageEntries,
  isTextPackagePath,
  normalizePackageBytes,
  normalizeRelativePackagePath,
  sha256,
  validateCandidateIdentity,
};
