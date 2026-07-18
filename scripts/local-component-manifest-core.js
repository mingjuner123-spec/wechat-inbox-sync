const crypto = require('node:crypto');
const path = require('node:path');

const ASSET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'asr-windows-installer',
    sourcePath: 'local-asr/install-local-asr.ps1',
    compatibilityAlias: 'local-asr/common/install-local-asr.ps1',
  }),
  Object.freeze({
    id: 'asr-macos-installer',
    sourcePath: 'local-asr/install-local-asr-macos.sh',
    compatibilityAlias: 'local-asr/common/install-local-asr-macos.sh',
  }),
  Object.freeze({
    id: 'ocr-windows-installer',
    sourcePath: 'local-ocr/install-local-ocr.ps1',
    compatibilityAlias: 'local-ocr/common/install-local-ocr.ps1',
  }),
  Object.freeze({
    id: 'ocr-macos-installer',
    sourcePath: 'local-ocr/install-local-ocr-macos.sh',
    compatibilityAlias: 'local-ocr/common/install-local-ocr-macos.sh',
  }),
  Object.freeze({
    id: 'ocr-python-script',
    sourcePath: 'local-ocr/ocr_image.py',
    compatibilityAlias: 'local-ocr/common/ocr_image.py',
  }),
]);

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeTextBytes(value) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError('text source must be a string, Buffer, or Uint8Array');
  }
  const text = typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
  return Buffer.from(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), 'utf8');
}

function sha256Hex(value) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new TypeError('SHA-256 input must be a string, Buffer, or Uint8Array');
  }
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeRepositoryPath(value, fieldName) {
  if (typeof value !== 'string' || !value) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  const normalized = value.replace(/\\/g, '/');
  if (
    normalized.startsWith('/')
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')
    || path.posix.normalize(normalized) !== normalized
  ) {
    throw new TypeError(`${fieldName} must be a normalized repository-relative path`);
  }
  return normalized;
}

function buildManifestAsset(definition, contents) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('asset definition must be an object');
  }
  if (typeof definition.id !== 'string' || !definition.id) {
    throw new TypeError('asset id must be a non-empty string');
  }
  const sourcePath = normalizeRepositoryPath(definition.sourcePath, 'sourcePath');
  const compatibilityAlias = normalizeRepositoryPath(
    definition.compatibilityAlias,
    'compatibilityAlias',
  );
  const sha256 = sha256Hex(normalizeTextBytes(contents));
  return {
    id: definition.id,
    sourcePath,
    sha256,
    immutablePath: `local-components/by-sha256/${sha256}/${path.posix.basename(sourcePath)}`,
    compatibilityAlias,
  };
}

function buildManifest(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new TypeError('manifest sources must be a non-empty array');
  }
  const manifest = {
    schemaVersion: 1,
    assets: sources
      .map(({ contents, ...definition }) => buildManifestAsset(definition, contents))
      .sort((left, right) => compareText(left.sourcePath, right.sourcePath)),
  };
  validateManifest(manifest);
  return manifest;
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort(compareText);
  const sortedExpectedKeys = [...expectedKeys].sort(compareText);
  if (
    actualKeys.length !== sortedExpectedKeys.length
    || actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new TypeError(`${label} must contain exactly: ${sortedExpectedKeys.join(', ')}`);
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('manifest must be an object');
  }
  assertExactKeys(manifest, ['schemaVersion', 'assets'], 'manifest');
  if (manifest.schemaVersion !== 1) {
    throw new TypeError('manifest schemaVersion must be 1');
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new TypeError('manifest assets must be a non-empty array');
  }

  const ids = new Set();
  const sourcePaths = new Set();
  const aliases = new Set();
  let previousSourcePath = '';
  for (const [index, asset] of manifest.assets.entries()) {
    const label = `manifest assets[${index}]`;
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      throw new TypeError(`${label} must be an object`);
    }
    assertExactKeys(
      asset,
      ['id', 'sourcePath', 'sha256', 'immutablePath', 'compatibilityAlias'],
      label,
    );
    if (typeof asset.id !== 'string' || !asset.id) {
      throw new TypeError(`${label}.id must be a non-empty string`);
    }
    const sourcePath = normalizeRepositoryPath(asset.sourcePath, `${label}.sourcePath`);
    const compatibilityAlias = normalizeRepositoryPath(
      asset.compatibilityAlias,
      `${label}.compatibilityAlias`,
    );
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new TypeError(`${label}.sha256 must be 64 lowercase hexadecimal characters`);
    }
    const expectedImmutablePath = (
      `local-components/by-sha256/${asset.sha256}/${path.posix.basename(sourcePath)}`
    );
    if (asset.immutablePath !== expectedImmutablePath) {
      throw new TypeError(`${label}.immutablePath must equal ${expectedImmutablePath}`);
    }
    if (previousSourcePath && compareText(previousSourcePath, sourcePath) >= 0) {
      throw new TypeError('manifest assets must be sorted by unique sourcePath');
    }
    if (ids.has(asset.id)) {
      throw new TypeError(`manifest asset id is duplicated: ${asset.id}`);
    }
    if (sourcePaths.has(sourcePath)) {
      throw new TypeError(`manifest sourcePath is duplicated: ${sourcePath}`);
    }
    if (aliases.has(compatibilityAlias)) {
      throw new TypeError(`manifest compatibilityAlias is duplicated: ${compatibilityAlias}`);
    }
    ids.add(asset.id);
    sourcePaths.add(sourcePath);
    aliases.add(compatibilityAlias);
    previousSourcePath = sourcePath;
  }
  return true;
}

function canonicalManifestObject(manifest) {
  validateManifest(manifest);
  return {
    schemaVersion: manifest.schemaVersion,
    assets: manifest.assets.map((asset) => ({
      id: asset.id,
      sourcePath: asset.sourcePath,
      sha256: asset.sha256,
      immutablePath: asset.immutablePath,
      compatibilityAlias: asset.compatibilityAlias,
    })),
  };
}

function serializeManifest(manifest) {
  return `${JSON.stringify(canonicalManifestObject(manifest), null, 2)}\n`;
}

function assertManifestMatches(actualManifest, expectedManifest) {
  const actual = serializeManifest(actualManifest);
  const expected = serializeManifest(expectedManifest);
  if (actual !== expected) {
    throw new Error('local component manifest drift detected; run with --write');
  }
  return true;
}

module.exports = {
  ASSET_DEFINITIONS,
  assertManifestMatches,
  buildManifest,
  buildManifestAsset,
  normalizeTextBytes,
  serializeManifest,
  sha256Hex,
  validateManifest,
};
