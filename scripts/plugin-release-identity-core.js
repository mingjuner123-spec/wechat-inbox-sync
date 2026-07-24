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
const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SINGLE_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 4096;
const OFFICIAL_OWNER = 'mingjuner123-spec';
const OFFICIAL_REPOSITORY = 'wechat-inbox-sync';
const OFFICIAL_FULL_NAME = `${OFFICIAL_OWNER}/${OFFICIAL_REPOSITORY}`;
const OFFICIAL_ORIGIN = `https://github.com/${OFFICIAL_FULL_NAME}.git`;
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

function sanitizeErrorMessage(value) {
  let text = typeof value === 'string' ? value : String(value);
  text = text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (candidate) => {
    try {
      const parsed = new URL(candidate);
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return '[REDACTED_URL]';
    }
  });
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]');
  text = text.replace(
    /\b(authorization|access[_-]?token|api[_-]?key|private[_-]?key|client[_-]?secret|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
    '$1=[REDACTED]',
  );
  text = text.replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g, '[REDACTED]');
  text = text.replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '[REDACTED]');
  return text;
}

function normalizeOfficialOriginUrl(output) {
  if (typeof output !== 'string') {
    throw new TypeError('origin URL output must be a string');
  }
  const match = output.match(/^([^\r\n]+)\r?\n?$/);
  if (!match) {
    throw new Error('origin URL output must contain exactly one repository URL');
  }
  const origin = match[1];
  const scpMatch = origin.match(/^git@github\.com:([^/?#]+)\/([^/?#]+?)(?:\.git)?$/);
  if (scpMatch) {
    if (`${scpMatch[1]}/${scpMatch[2]}` !== OFFICIAL_FULL_NAME) {
      throw new Error('origin must point to the official plugin repository');
    }
    return OFFICIAL_ORIGIN;
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('origin must be an official GitHub HTTPS or SSH repository URL');
  }
  if (parsed.search || parsed.hash || parsed.password) {
    throw new Error('origin URL must not contain credentials, query parameters, or fragments');
  }
  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const isHttps = protocol === 'https:'
    && parsed.username === ''
    && parsed.port === '';
  const isSsh = protocol === 'ssh:'
    && parsed.username === 'git'
    && parsed.port === '';
  if (host !== 'github.com' || (!isHttps && !isSsh)) {
    throw new Error('origin must use the official GitHub repository endpoint');
  }
  const pathname = parsed.pathname.replace(/\.git$/, '');
  if (pathname !== `/${OFFICIAL_FULL_NAME}`) {
    throw new Error('origin must point to the official plugin repository');
  }
  return OFFICIAL_ORIGIN;
}

function validateGitBranchName(branch) {
  if (typeof branch !== 'string'
      || !branch
      || branch.length > 255
      || branch.startsWith('/')
      || branch.endsWith('/')
      || branch.endsWith('.')
      || branch.includes('..')
      || branch.includes('@{')
      || /[\x00-\x20\x7f~^:?*[\]\\]/.test(branch)) {
    throw new Error('GitHub default_branch is not a valid Git branch name');
  }
  return branch;
}

function validateRepositoryPayload(payload) {
  requireObject(payload, 'GitHub repository response');
  if (payload.full_name !== OFFICIAL_FULL_NAME) {
    throw new Error('GitHub repository response is not the official plugin repository');
  }
  if (payload.html_url !== `https://github.com/${OFFICIAL_FULL_NAME}`) {
    throw new Error('GitHub repository html_url differs from the official plugin repository');
  }
  return {
    fullName: payload.full_name,
    defaultBranch: validateGitBranchName(payload.default_branch),
  };
}

function validateGitHubRefPayload(payload, { expectedRef, expectedType } = {}) {
  requireObject(payload, 'GitHub ref response');
  if (typeof expectedRef !== 'string' || !expectedRef.startsWith('refs/')) {
    throw new Error('expected GitHub ref must be a complete refs/* name');
  }
  if (payload.ref !== expectedRef) {
    throw new Error(`GitHub ref ${payload.ref} differs from expected ref ${expectedRef}`);
  }
  requireObject(payload.object, 'GitHub ref object');
  if (payload.object.type !== expectedType) {
    throw new Error(
      `GitHub ref ${expectedRef} type ${payload.object.type} differs from required ${expectedType}`
      + (expectedType === 'tag' ? ' annotated tag' : ''),
    );
  }
  const sha = parseCommitOutput(`${payload.object.sha}\n`, `GitHub ref ${expectedRef} SHA`);
  return { ref: expectedRef, type: expectedType, sha };
}

function validateAnnotatedTagPayload(payload, {
  tag,
  expectedTagObject,
  expectedCommit,
} = {}) {
  validateVersionTag(tag);
  requireObject(payload, 'GitHub annotated tag response');
  const tagObject = parseCommitOutput(`${payload.sha}\n`, `GitHub tag ${tag} object SHA`);
  const expectedObject = parseCommitOutput(
    `${expectedTagObject}\n`,
    `expected GitHub tag ${tag} object SHA`,
  );
  if (tagObject !== expectedObject || payload.tag !== tag) {
    throw new Error(`GitHub annotated tag ${tag} object identity drift`);
  }
  requireObject(payload.object, 'GitHub annotated tag target');
  if (payload.object.type !== 'commit') {
    throw new Error(`GitHub annotated tag ${tag} must target a commit`);
  }
  const commit = parseCommitOutput(
    `${payload.object.sha}\n`,
    `GitHub annotated tag ${tag} commit SHA`,
  );
  if (expectedCommit && commit !== expectedCommit) {
    throw new Error(
      `GitHub annotated tag ${tag} commit ${commit} differs from expected SHA ${expectedCommit}`,
    );
  }
  return { tag, tagObject, commit };
}

function resolveTrustedReleaseTarget(targetCommitish, {
  defaultBranch,
  defaultCommit,
  tag,
  tagCommit,
} = {}) {
  validateGitBranchName(defaultBranch);
  validateVersionTag(tag);
  const trustedDefaultCommit = parseCommitOutput(
    `${defaultCommit}\n`,
    'trusted default branch commit',
  );
  const trustedTagCommit = parseCommitOutput(`${tagCommit}\n`, 'trusted tag commit');
  if (trustedDefaultCommit !== trustedTagCommit) {
    throw new Error('trusted default branch and annotated tag commit identities differ');
  }
  if (targetCommitish === trustedDefaultCommit
      || targetCommitish === defaultBranch
      || targetCommitish === tag) {
    return trustedDefaultCommit;
  }
  throw new Error(`Release target_commitish is not a trusted default branch, tag, or commit SHA`);
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

function validateTrustedLocalSnapshot({
  phase,
  tag,
  statusOutput,
  headOutput,
  tagTypeOutput,
  tagCommitOutput,
  trustedDefaultCommit,
  trustedTagCommit = null,
} = {}) {
  if (phase !== 'prepublish' && phase !== 'postpublish') {
    throw new Error('release phase must be prepublish or postpublish');
  }
  validateVersionTag(tag);
  assertCleanStatus(statusOutput);
  const head = parseCommitOutput(headOutput, 'local HEAD');
  const localTagCommit = parseCommitOutput(
    tagCommitOutput,
    `local tag ${tag} peeled commit`,
  );
  const defaultCommit = parseCommitOutput(
    `${trustedDefaultCommit}\n`,
    'trusted GitHub default branch commit',
  );
  parseTagType(tagTypeOutput);
  assertHeadMatchesRemote(head, defaultCommit);
  assertTagMatchesHead(localTagCommit, head);
  if (phase === 'prepublish') {
    if (trustedTagCommit !== null) {
      throw new Error(`official remote tag ${tag} already exists`);
    }
  } else {
    const remoteTagCommit = parseCommitOutput(
      `${trustedTagCommit}\n`,
      `trusted GitHub tag ${tag} commit`,
    );
    if (remoteTagCommit !== localTagCommit) {
      throw new Error(
        `trusted GitHub tag ${tag} commit ${remoteTagCommit} differs from local tag commit ${localTagCommit}`,
      );
    }
  }
  return {
    phase,
    tag,
    head,
    tagCommit: localTagCommit,
    trustedDefaultCommit: defaultCommit,
    trustedTagCommit,
  };
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
    throw new Error(`${label} failed: ${sanitizeErrorMessage(error.message || String(error))}`);
  }
  return true;
}

function assertResponseWithinLimit(receivedBytes, limitBytes, label = 'response') {
  if (!Number.isSafeInteger(receivedBytes) || receivedBytes < 0
      || !Number.isSafeInteger(limitBytes) || limitBytes < 0) {
    throw new TypeError(`${label} size and limit must be non-negative safe integers`);
  }
  if (receivedBytes > limitBytes) {
    throw new Error(`${label} size exceeds the configured limit`);
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
  trustedRefs = null,
} = {}) {
  requireObject(release, 'GitHub Release');
  validateVersionTag(tag);
  parseCommitOutput(`${expectedCommit}\n`, 'expected release commit');
  if (release.tag_name !== tag) {
    throw new Error(`Release tag ${release.tag_name} differs from expected tag ${tag}`);
  }
  const resolvedTarget = trustedRefs
    ? resolveTrustedReleaseTarget(release.target_commitish, trustedRefs)
    : release.target_commitish;
  if (resolvedTarget !== expectedCommit) {
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
    if (!Number.isSafeInteger(asset.size) || asset.size < 0) {
      throw new Error(`GitHub Release asset ${asset.name} has an invalid size`);
    }
    const limit = asset.name.endsWith('.zip')
      ? MAX_ZIP_COMPRESSED_BYTES
      : MAX_SINGLE_ASSET_BYTES;
    assertResponseWithinLimit(asset.size, limit, `GitHub Release asset ${asset.name}`);
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

function computeCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseZipEntries(zipBytes, {
  maxCompressedBytes = MAX_ZIP_COMPRESSED_BYTES,
  maxEntryUncompressedBytes = MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES,
  maxTotalUncompressedBytes = MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  maxEntries = MAX_ZIP_ENTRIES,
} = {}) {
  requireBuffer(zipBytes, 'ZIP bytes');
  assertResponseWithinLimit(zipBytes.length, maxCompressedBytes, 'ZIP compressed bytes');
  if (zipBytes.length < 22) throw new Error('ZIP is truncated');
  const eocdOffset = findEndOfCentralDirectory(zipBytes);
  const diskNumber = zipBytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = zipBytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = zipBytes.readUInt16LE(eocdOffset + 8);
  const entryCount = zipBytes.readUInt16LE(eocdOffset + 10);
  const centralSize = zipBytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = zipBytes.readUInt32LE(eocdOffset + 16);
  const eocdCommentLength = zipBytes.readUInt16LE(eocdOffset + 20);
  if (diskNumber !== 0 || centralDisk !== 0) {
    throw new Error('multi-disk ZIP archives are not supported');
  }
  if (entriesOnDisk !== entryCount) {
    throw new Error('ZIP entry counts on disk and in the archive differ');
  }
  if (eocdOffset + 22 + eocdCommentLength !== zipBytes.length) {
    throw new Error('ZIP EOCD comment length does not match the exact archive end');
  }
  if (centralOffset + centralSize !== eocdOffset) {
    throw new Error('ZIP central directory must end immediately before EOCD');
  }
  if (entryCount > maxEntries) {
    throw new Error('ZIP entry count exceeds the configured limit');
  }
  const entries = new Map();
  const seenNames = new Set();
  const occupiedRanges = [];
  let totalUncompressedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > zipBytes.length || zipBytes.readUInt32LE(offset) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('ZIP central directory entry is malformed');
    }
    const flags = zipBytes.readUInt16LE(offset + 8);
    const method = zipBytes.readUInt16LE(offset + 10);
    const crc32 = zipBytes.readUInt32LE(offset + 16);
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
    if (seenNames.has(name)) throw new Error(`duplicate ZIP entry: ${name}`);
    seenNames.add(name);
    offset = nameEnd + extraLength + commentLength;
    const isDirectory = name.endsWith('/');
    if ((flags & 0x1) !== 0) throw new Error(`encrypted ZIP entry is not allowed: ${name}`);
    if ((flags & 0x8) !== 0) throw new Error(`ZIP data descriptor flag is unsupported: ${name}`);
    if ((flags & ~0x800) !== 0) throw new Error(`unsupported ZIP flags for ${name}`);
    if (method !== 0 && method !== 8) {
      throw new Error(`unsupported ZIP compression method ${method} for ${name}`);
    }
    if (uncompressedSize > maxEntryUncompressedBytes) {
      throw new Error(`ZIP entry expanded size exceeds the configured limit for ${name}`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > maxTotalUncompressedBytes) {
      throw new Error('ZIP total expanded size exceeds the configured limit');
    }
    if (localOffset + 30 > zipBytes.length
        || zipBytes.readUInt32LE(localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw new Error(`ZIP local header is malformed for ${name}`);
    }
    const localFlags = zipBytes.readUInt16LE(localOffset + 6);
    const localMethod = zipBytes.readUInt16LE(localOffset + 8);
    const localCrc32 = zipBytes.readUInt32LE(localOffset + 14);
    const localCompressedSize = zipBytes.readUInt32LE(localOffset + 18);
    const localUncompressedSize = zipBytes.readUInt32LE(localOffset + 22);
    const localNameLength = zipBytes.readUInt16LE(localOffset + 26);
    const localExtraLength = zipBytes.readUInt16LE(localOffset + 28);
    const localNameStart = localOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (localNameEnd > zipBytes.length || dataStart > zipBytes.length) {
      throw new Error(`ZIP local header name or extra field is truncated for ${name}`);
    }
    const localNameBytes = zipBytes.subarray(localNameStart, localNameEnd);
    const centralNameBytes = zipBytes.subarray(nameStart, nameEnd);
    const localName = localNameBytes.toString('utf8');
    validateZipEntryName(localName);
    if (!localNameBytes.equals(centralNameBytes)) {
      throw new Error(`ZIP local filename differs from central filename for ${name}`);
    }
    if (localFlags !== flags || localMethod !== method) {
      throw new Error(`ZIP local flags or compression method differs from central entry for ${name}`);
    }
    if (localCrc32 !== crc32
        || localCompressedSize !== compressedSize
        || localUncompressedSize !== uncompressedSize) {
      throw new Error(`ZIP local CRC or size differs from central entry for ${name}`);
    }
    if (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) {
      throw new Error(`ZIP directory entry must be empty: ${name}`);
    }
    if (isDirectory && crc32 !== 0) {
      throw new Error(`ZIP directory CRC32 must be zero: ${name}`);
    }
    if (localOffset >= centralOffset || dataEnd > centralOffset || dataEnd > zipBytes.length) {
      throw new Error(`ZIP local entry overlaps the central directory or archive bounds for ${name}`);
    }
    occupiedRanges.push({ start: localOffset, end: dataEnd, name });
    if (isDirectory) continue;
    const compressed = zipBytes.subarray(dataStart, dataEnd);
    let data;
    try {
      data = method === 0
        ? Buffer.from(compressed)
        : zlib.inflateRawSync(compressed, {
          maxOutputLength: maxEntryUncompressedBytes,
        });
    } catch (error) {
      throw new Error(`ZIP inflation failed for ${name}: ${sanitizeErrorMessage(error.message)}`);
    }
    if (data.length !== uncompressedSize) {
      throw new Error(`ZIP uncompressed size mismatch for ${name}`);
    }
    if (computeCrc32(data) !== crc32) {
      throw new Error(`ZIP extracted content CRC32 mismatch for ${name}`);
    }
    entries.set(name, data);
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error('ZIP central directory size mismatch');
  }
  occupiedRanges.sort((left, right) => left.start - right.start);
  if (occupiedRanges.length === 0) {
    if (centralOffset !== 0) {
      throw new Error('ZIP contains an unsupported prefix before the central directory');
    }
  } else if (occupiedRanges[0].start !== 0) {
    throw new Error('ZIP contains an unsupported prefix or orphan local entry');
  }
  for (let index = 1; index < occupiedRanges.length; index += 1) {
    const previous = occupiedRanges[index - 1];
    const current = occupiedRanges[index];
    if (current.start !== previous.end) {
      throw new Error(`ZIP local entry ranges are not continuous: ${previous.name} and ${current.name}`);
    }
  }
  if (occupiedRanges.length > 0
      && occupiedRanges[occupiedRanges.length - 1].end !== centralOffset) {
    throw new Error('ZIP contains an orphan local entry or gap before the central directory');
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
  MAX_API_RESPONSE_BYTES,
  MAX_RELEASE_AGE_MS,
  MAX_SINGLE_ASSET_BYTES,
  MAX_ZIP_COMPRESSED_BYTES,
  MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES,
  MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  assertProbeCompleted,
  assertResponseWithinLimit,
  assertZipMatchesExpected,
  normalizeOfficialOriginUrl,
  parseRemoteTagOutput,
  parseZipEntries,
  resolveTrustedReleaseTarget,
  sanitizeErrorMessage,
  validateAnnotatedTagPayload,
  validateGitHubRefPayload,
  validateLocalReleaseSnapshot,
  validateTrustedLocalSnapshot,
  validateReleaseLookup,
  validateReleaseMetadata,
  validateReleasePayload,
  validateRepositoryPayload,
};
