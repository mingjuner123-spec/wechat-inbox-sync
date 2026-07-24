'use strict';

const zlib = require('node:zlib');
const {
  assertCleanStatus,
  assertHeadMatchesRemote,
  assertTagMatchesHead,
  parseCommitOutput,
  parseRemoteMainOutput,
  validateVersionTag,
} = require('./release-source-guard-core');

const MAX_RELEASE_AGE_MS = 24 * 60 * 60 * 1000;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

function requireBuffer(value, label) {
  if (!Buffer.isBuffer(value)) {
    throw new TypeError(`${label} must be a Buffer`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTagType(output) {
  if (output !== 'tag\n' && output !== 'tag\r\n') {
    throw new Error('local release tag must be an annotated Git tag object');
  }
  return 'tag';
}

function parseRemoteTagOutput(output, tag, { allowAbsent = false } = {}) {
  if (typeof output !== 'string') {
    throw new TypeError('remote tag output must be a string');
  }
  validateVersionTag(tag);
  if (output.length === 0) {
    if (allowAbsent) return null;
    throw new Error(`remote tag ${tag} is missing`);
  }
  const escapedTag = escapeRegExp(tag);
  const pattern = new RegExp(
    `^([0-9a-f]{40}|[0-9a-f]{64})\\trefs/tags/${escapedTag}\\r?\\n`
    + `([0-9a-f]{40}|[0-9a-f]{64})\\trefs/tags/${escapedTag}\\^\\{\\}\\r?\\n?$`,
  );
  const match = output.match(pattern);
  if (!match) {
    throw new Error(`remote tag ${tag} output must contain exactly one annotated tag and peeled commit`);
  }
  return { tagObject: match[1], tagCommit: match[2] };
}

function validateLocalReleaseSnapshot({
  phase,
  tag,
  statusOutput,
  headOutput,
  remoteMainOutput,
  tagTypeOutput,
  tagCommitOutput,
  remoteTagOutput,
} = {}) {
  if (phase !== 'prepublish' && phase !== 'postpublish') {
    throw new Error('release phase must be prepublish or postpublish');
  }
  validateVersionTag(tag);
  assertCleanStatus(statusOutput);
  const head = parseCommitOutput(headOutput, 'local HEAD');
  const remoteMain = parseRemoteMainOutput(remoteMainOutput);
  parseTagType(tagTypeOutput);
  const tagCommit = parseCommitOutput(tagCommitOutput, `local tag ${tag} peeled commit`);
  assertHeadMatchesRemote(head, remoteMain);
  assertTagMatchesHead(tagCommit, head);
  if (phase === 'prepublish') {
    if (remoteTagOutput !== '') {
      parseRemoteTagOutput(remoteTagOutput, tag, { allowAbsent: false });
      throw new Error(`remote tag ${tag} already exists`);
    }
    return { phase, tag, head, remoteMain, tagCommit, remoteTag: null };
  }
  const remoteTag = parseRemoteTagOutput(remoteTagOutput, tag);
  if (remoteTag.tagCommit !== tagCommit) {
    throw new Error(
      `remote tag ${tag} peeled commit ${remoteTag.tagCommit} differs from local tag commit ${tagCommit}`,
    );
  }
  return { phase, tag, head, remoteMain, tagCommit, remoteTag };
}

function parseJsonBuffer(bytes, label) {
  requireBuffer(bytes, label);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} JSON parse failed: ${error.message}`);
  }
  return requireObject(parsed, label);
}

function assertSameBytes(left, right, label) {
  requireBuffer(left, `${label} left copy`);
  requireBuffer(right, `${label} right copy`);
  if (!left.equals(right)) {
    throw new Error(`${label} byte drift detected`);
  }
}

function validateReleaseMetadata({
  tag,
  rootManifestBytes,
  pluginManifestBytes,
  rootVersionsBytes,
  pluginVersionsBytes,
} = {}) {
  validateVersionTag(tag);
  assertSameBytes(rootManifestBytes, pluginManifestBytes, 'root/plugin manifest');
  assertSameBytes(rootVersionsBytes, pluginVersionsBytes, 'root/plugin versions');
  const manifest = parseJsonBuffer(rootManifestBytes, 'manifest.json');
  const versions = parseJsonBuffer(rootVersionsBytes, 'versions.json');
  if (manifest.version !== tag) {
    throw new Error(`manifest version ${manifest.version} differs from release tag ${tag}`);
  }
  if (typeof manifest.minAppVersion !== 'string' || !manifest.minAppVersion) {
    throw new Error('manifest minAppVersion must be a non-empty string');
  }
  if (versions[tag] !== manifest.minAppVersion) {
    throw new Error(
      `versions mapping for ${tag} differs from manifest minAppVersion ${manifest.minAppVersion}`,
    );
  }
  return { version: tag, minAppVersion: manifest.minAppVersion, manifest, versions };
}

function assertProbeCompleted({ timedOut = false, error = null, label = 'probe' } = {}) {
  if (timedOut) {
    throw new Error(`${label} timed out`);
  }
  if (error) {
    throw new Error(`${label} failed: ${error.message || String(error)}`);
  }
  return true;
}

function validateReleaseLookup({ phase, statusCode, body } = {}) {
  requireBuffer(body, 'GitHub release response body');
  if (phase === 'prepublish') {
    if (statusCode !== 404) {
      throw new Error(`prepublish GitHub Release lookup must return exact HTTP 404, received ${statusCode}`);
    }
    return { absent: true };
  }
  if (phase !== 'postpublish') {
    throw new Error('release phase must be prepublish or postpublish');
  }
  if (statusCode !== 200) {
    throw new Error(`postpublish GitHub Release lookup must return HTTP 200, received ${statusCode}`);
  }
  return parseJsonBuffer(body, 'GitHub Release response');
}

function validateReleasePayload(release, {
  tag,
  expectedCommit,
  expectedAssets,
  nowMs = Date.now(),
} = {}) {
  requireObject(release, 'GitHub Release');
  validateVersionTag(tag);
  parseCommitOutput(`${expectedCommit}\n`, 'expected release commit');
  if (release.tag_name !== tag) {
    throw new Error(`Release tag ${release.tag_name} differs from expected tag ${tag}`);
  }
  if (release.target_commitish !== expectedCommit) {
    throw new Error(
      `Release target commit ${release.target_commitish} differs from expected SHA ${expectedCommit}`,
    );
  }
  if (!Array.isArray(expectedAssets) || expectedAssets.length === 0) {
    throw new Error('expected Release assets must be a non-empty array');
  }
  if (!Array.isArray(release.assets)) {
    throw new Error('GitHub Release assets must be an array');
  }
  const actualNames = release.assets.map((asset) => {
    requireObject(asset, 'GitHub Release asset');
    if (typeof asset.name !== 'string' || !asset.name) {
      throw new Error('GitHub Release asset name must be a non-empty string');
    }
    if (typeof asset.browser_download_url !== 'string' || !asset.browser_download_url) {
      throw new Error(`GitHub Release asset ${asset.name} is missing a download URL`);
    }
    return asset.name;
  });
  const expectedSorted = [...expectedAssets].sort();
  const actualSorted = [...actualNames].sort();
  if (new Set(actualNames).size !== actualNames.length
      || JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `GitHub Release asset set mismatch; expected ${expectedSorted.join(', ')}, received ${actualSorted.join(', ')}`,
    );
  }
  const publishedMs = Date.parse(release.published_at);
  if (!Number.isFinite(publishedMs)) {
    throw new Error('GitHub Release published_at must be a valid timestamp');
  }
  const ageMs = nowMs - publishedMs;
  if (ageMs < 0 || ageMs > MAX_RELEASE_AGE_MS) {
    throw new Error('GitHub Release sample is stale or outside the required 24-hour freshness window');
  }
  return release;
}

function findEndOfCentralDirectory(zipBytes) {
  const minimumOffset = Math.max(0, zipBytes.length - 65557);
  for (let offset = zipBytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (zipBytes.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  throw new Error('ZIP end-of-central-directory record is missing');
}

function validateZipEntryName(name) {
  if (!name || name.includes('\\') || name.startsWith('/')
      || name.split('/').includes('..')) {
    throw new Error(`unsafe ZIP entry name: ${name}`);
  }
}

function parseZipEntries(zipBytes) {
  requireBuffer(zipBytes, 'ZIP bytes');
  if (zipBytes.length < 22) throw new Error('ZIP is truncated');
  const eocdOffset = findEndOfCentralDirectory(zipBytes);
  const diskNumber = zipBytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = zipBytes.readUInt16LE(eocdOffset + 6);
  const entryCount = zipBytes.readUInt16LE(eocdOffset + 10);
  const centralSize = zipBytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = zipBytes.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0) {
    throw new Error('multi-disk ZIP archives are not supported');
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw new Error('ZIP central directory is outside the archive bounds');
  }
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > zipBytes.length || zipBytes.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('ZIP central directory entry is malformed');
    }
    const flags = zipBytes.readUInt16LE(offset + 8);
    const method = zipBytes.readUInt16LE(offset + 10);
    const compressedSize = zipBytes.readUInt32LE(offset + 20);
    const uncompressedSize = zipBytes.readUInt32LE(offset + 24);
    const nameLength = zipBytes.readUInt16LE(offset + 28);
    const extraLength = zipBytes.readUInt16LE(offset + 30);
    const commentLength = zipBytes.readUInt16LE(offset + 32);
    const localOffset = zipBytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > zipBytes.length) {
      throw new Error('ZIP central directory name is truncated');
    }
    const name = zipBytes.subarray(nameStart, nameEnd).toString('utf8');
    validateZipEntryName(name);
    offset = nameEnd + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if ((flags & 0x1) !== 0) throw new Error(`encrypted ZIP entry is not allowed: ${name}`);
    if (method !== 0 && method !== 8) {
      throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
    }
    if (localOffset + 30 > zipBytes.length
        || zipBytes.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error(`ZIP local header is malformed for ${name}`);
    }
    const localNameLength = zipBytes.readUInt16LE(localOffset + 26);
    const localExtraLength = zipBytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBytes.length) throw new Error(`ZIP data is truncated for ${name}`);
    const compressed = zipBytes.subarray(dataStart, dataEnd);
    const data = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed);
    if (data.length !== uncompressedSize) {
      throw new Error(`ZIP uncompressed size mismatch for ${name}`);
    }
    if (entries.has(name)) throw new Error(`duplicate ZIP entry: ${name}`);
    entries.set(name, data);
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error('ZIP central directory size mismatch');
  }
  return entries;
}

function assertZipMatchesExpected(actualEntries, expectedEntries) {
  if (!(actualEntries instanceof Map) || !(expectedEntries instanceof Map)) {
    throw new TypeError('ZIP actual and expected entries must be Map instances');
  }
  const actualNames = [...actualEntries.keys()].sort();
  const expectedNames = [...expectedEntries.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `ZIP entry set mismatch; expected ${expectedNames.join(', ')}, received ${actualNames.join(', ')}`,
    );
  }
  for (const name of expectedNames) {
    const actual = requireBuffer(actualEntries.get(name), `ZIP entry ${name}`);
    const expected = requireBuffer(expectedEntries.get(name), `expected tag entry ${name}`);
    if (!actual.equals(expected)) {
      throw new Error(`ZIP entry byte content mismatch for ${name}`);
    }
  }
  return true;
}

module.exports = {
  MAX_RELEASE_AGE_MS,
  assertProbeCompleted,
  assertZipMatchesExpected,
  parseRemoteTagOutput,
  parseZipEntries,
  validateLocalReleaseSnapshot,
  validateReleaseLookup,
  validateReleaseMetadata,
  validateReleasePayload,
};
