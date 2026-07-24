'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const repoRoot = path.resolve(__dirname, '..');
const corePath = path.join(repoRoot, 'scripts', 'plugin-release-identity-core.js');
const cliPath = path.join(repoRoot, 'scripts', 'check-plugin-release-identity.js');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'release.yml');
const core = fs.existsSync(corePath) ? require(corePath) : {};
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const TAG_OBJECT = 'c'.repeat(40);
const TAG = '1.3.57';
const REQUIRED_ASSETS = [
  'main.js',
  'manifest.json',
  'styles.css',
  'versions.json',
  `wechat-inbox-sync-${TAG}.zip`,
];
const OFFICIAL_ORIGIN = 'https://github.com/mingjuner123-spec/wechat-inbox-sync.git';

function git(cwd, args) {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function writeFixtureFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createBareFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-release-identity-'));
  const bare = path.join(fixtureRoot, 'remote.git');
  const work = path.join(fixtureRoot, 'work');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  git(fixtureRoot, ['init', '--bare', bare]);
  git(fixtureRoot, ['init', '-b', 'main', work]);
  git(work, ['config', 'user.email', 'release-test@example.invalid']);
  git(work, ['config', 'user.name', 'Release Test']);
  git(work, ['remote', 'add', 'origin', bare]);
  writeFixtureFile(path.join(work, 'README.md'), 'fixture\n');
  git(work, ['add', 'README.md']);
  git(work, ['commit', '-m', 'fixture']);
  git(work, ['push', '-u', 'origin', 'main']);
  git(work, ['tag', '-a', TAG, '-m', TAG]);
  return { bare, work };
}

function copyProductionIdentityScripts(targetRoot) {
  const targetScripts = path.join(targetRoot, 'scripts');
  fs.mkdirSync(targetScripts, { recursive: true });
  for (const name of [
    'release-source-guard-core.js',
    'plugin-release-identity-core.js',
    'check-plugin-release-identity.js',
  ]) {
    fs.copyFileSync(path.join(repoRoot, 'scripts', name), path.join(targetScripts, name));
  }
}

function makeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.from(value);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

test('the public release identity core and CLI are self-contained files', () => {
  assert.equal(fs.existsSync(corePath), true);
  assert.equal(fs.existsSync(cliPath), true);
  assert.equal(typeof core.validateLocalReleaseSnapshot, 'function');
  assert.equal(typeof core.validateReleaseMetadata, 'function');
  assert.equal(typeof core.validateReleaseLookup, 'function');
  assert.equal(typeof core.validateReleasePayload, 'function');
  assert.equal(typeof core.parseZipEntries, 'function');
  assert.equal(typeof core.assertZipMatchesExpected, 'function');
  assert.equal(typeof core.normalizeOfficialOriginUrl, 'function');
  assert.equal(typeof core.validateRepositoryPayload, 'function');
  assert.equal(typeof core.validateGitHubRefPayload, 'function');
  assert.equal(typeof core.validateAnnotatedTagPayload, 'function');
  assert.equal(typeof core.resolveTrustedReleaseTarget, 'function');
  assert.equal(typeof core.sanitizeErrorMessage, 'function');
});

test('canonical origin accepts only credential-free official GitHub URL equivalents', () => {
  for (const origin of [
    OFFICIAL_ORIGIN,
    'https://github.com/mingjuner123-spec/wechat-inbox-sync',
    'git@github.com:mingjuner123-spec/wechat-inbox-sync.git',
    'ssh://git@github.com/mingjuner123-spec/wechat-inbox-sync.git',
  ]) {
    assert.equal(core.normalizeOfficialOriginUrl(`${origin}\n`), OFFICIAL_ORIGIN);
  }
  for (const origin of [
    'https://github.com/attacker/wechat-inbox-sync.git',
    'https://user:password@github.com/mingjuner123-spec/wechat-inbox-sync.git',
    'https://github.com/mingjuner123-spec/wechat-inbox-sync.git?token=secret',
    'https://github.com/mingjuner123-spec/wechat-inbox-sync.git#fragment',
    'git@evil.example:mingjuner123-spec/wechat-inbox-sync.git',
  ]) {
    assert.throws(
      () => core.normalizeOfficialOriginUrl(`${origin}\n`),
      /official|origin|repository/i,
    );
  }
});

test('trusted repository metadata resolves the real default branch instead of assuming main', () => {
  const repository = core.validateRepositoryPayload({
    full_name: 'mingjuner123-spec/wechat-inbox-sync',
    default_branch: 'stable',
    html_url: 'https://github.com/mingjuner123-spec/wechat-inbox-sync',
  });
  assert.equal(repository.defaultBranch, 'stable');
  assert.equal(core.validateGitHubRefPayload({
    ref: 'refs/heads/stable',
    object: { type: 'commit', sha: SHA_A },
  }, {
    expectedRef: 'refs/heads/stable',
    expectedType: 'commit',
  }).sha, SHA_A);
  assert.throws(() => core.validateGitHubRefPayload({
    ref: 'refs/heads/main',
    object: { type: 'commit', sha: SHA_A },
  }, {
    expectedRef: 'refs/heads/stable',
    expectedType: 'commit',
  }), /default|ref|stable/i);
});

test('trusted annotated tag resolution rejects lightweight tags and peeled SHA drift', () => {
  assert.throws(() => core.validateGitHubRefPayload({
    ref: `refs/tags/${TAG}`,
    object: { type: 'commit', sha: SHA_A },
  }, {
    expectedRef: `refs/tags/${TAG}`,
    expectedType: 'tag',
  }), /annotated|type|tag/i);
  const tagRef = core.validateGitHubRefPayload({
    ref: `refs/tags/${TAG}`,
    object: { type: 'tag', sha: TAG_OBJECT },
  }, {
    expectedRef: `refs/tags/${TAG}`,
    expectedType: 'tag',
  });
  assert.equal(core.validateAnnotatedTagPayload({
    tag: TAG,
    sha: TAG_OBJECT,
    object: { type: 'commit', sha: SHA_A },
  }, {
    tag: TAG,
    expectedTagObject: tagRef.sha,
  }).commit, SHA_A);
  assert.throws(() => core.validateAnnotatedTagPayload({
    tag: TAG,
    sha: TAG_OBJECT,
    object: { type: 'commit', sha: SHA_B },
  }, {
    tag: TAG,
    expectedTagObject: tagRef.sha,
    expectedCommit: SHA_A,
  }), /commit|drift|SHA/i);
});

test('Release target text resolves only through trusted default-branch or tag refs', () => {
  const trusted = {
    defaultBranch: 'stable',
    defaultCommit: SHA_A,
    tag: TAG,
    tagCommit: SHA_A,
  };
  assert.equal(core.resolveTrustedReleaseTarget(SHA_A, trusted), SHA_A);
  assert.equal(core.resolveTrustedReleaseTarget('stable', trusted), SHA_A);
  assert.equal(core.resolveTrustedReleaseTarget(TAG, trusted), SHA_A);
  assert.throws(() => core.resolveTrustedReleaseTarget('main', trusted), /target|trusted|main/i);
  assert.throws(() => core.resolveTrustedReleaseTarget(SHA_B, trusted), /target|commit|SHA/i);
});

test('local snapshot parsing rejects malformed Git output and dirty worktrees', () => {
  assert.throws(
    () => core.validateLocalReleaseSnapshot({
      phase: 'prepublish',
      tag: TAG,
      statusOutput: ' M manifest.json\n',
      headOutput: `${SHA_A}\n`,
      remoteMainOutput: `${SHA_A}\trefs/heads/main\n`,
      tagTypeOutput: 'tag\n',
      tagCommitOutput: `${SHA_A}\n`,
      remoteTagOutput: '',
    }),
    /dirty|clean/i,
  );
  assert.throws(
    () => core.validateLocalReleaseSnapshot({
      phase: 'prepublish',
      tag: TAG,
      statusOutput: '',
      headOutput: `${SHA_A}\nextra\n`,
      remoteMainOutput: `${SHA_A}\trefs/heads/main\n`,
      tagTypeOutput: 'tag\n',
      tagCommitOutput: `${SHA_A}\n`,
      remoteTagOutput: '',
    }),
    /exactly|commit/i,
  );
});

test('temporary bare Git fixture covers clean, dirty, moved main, annotated tag peeling, and pre/post states', (t) => {
  const { bare, work } = createBareFixture(t);
  const headOutput = git(work, ['rev-parse', 'HEAD']);
  const tagCommitOutput = git(work, ['rev-parse', `refs/tags/${TAG}^{}`]);
  const remoteMainOutput = git(work, ['ls-remote', 'origin', 'refs/heads/main']);
  assert.equal(git(work, ['cat-file', '-t', `refs/tags/${TAG}`]), 'tag\n');

  assert.doesNotThrow(() => core.validateLocalReleaseSnapshot({
    phase: 'prepublish',
    tag: TAG,
    statusOutput: git(work, ['status', '--porcelain', '--untracked-files=all']),
    headOutput,
    remoteMainOutput,
    tagTypeOutput: 'tag\n',
    tagCommitOutput,
    remoteTagOutput: git(work, ['ls-remote', 'origin', `refs/tags/${TAG}`, `refs/tags/${TAG}^{}`]),
  }));

  writeFixtureFile(path.join(work, 'dirty.txt'), 'dirty\n');
  assert.throws(() => core.validateLocalReleaseSnapshot({
    phase: 'prepublish',
    tag: TAG,
    statusOutput: git(work, ['status', '--porcelain', '--untracked-files=all']),
    headOutput,
    remoteMainOutput,
    tagTypeOutput: 'tag\n',
    tagCommitOutput,
    remoteTagOutput: '',
  }), /dirty|clean/i);
  fs.rmSync(path.join(work, 'dirty.txt'));

  git(work, ['push', 'origin', `refs/tags/${TAG}:refs/tags/${TAG}`]);
  const remoteTagOutput = git(work, ['ls-remote', 'origin', `refs/tags/${TAG}`, `refs/tags/${TAG}^{}`]);
  assert.doesNotThrow(() => core.validateLocalReleaseSnapshot({
    phase: 'postpublish',
    tag: TAG,
    statusOutput: '',
    headOutput,
    remoteMainOutput,
    tagTypeOutput: 'tag\n',
    tagCommitOutput,
    remoteTagOutput,
  }));

  const other = path.join(path.dirname(work), 'other');
  git(path.dirname(work), ['clone', '--branch', 'main', bare, other]);
  git(other, ['config', 'user.email', 'release-test@example.invalid']);
  git(other, ['config', 'user.name', 'Release Test']);
  writeFixtureFile(path.join(other, 'advance.txt'), 'advance\n');
  git(other, ['add', 'advance.txt']);
  git(other, ['commit', '-m', 'advance']);
  git(other, ['push', 'origin', 'main']);
  const movedMain = git(work, ['ls-remote', 'origin', 'refs/heads/main']);
  assert.throws(() => core.validateLocalReleaseSnapshot({
    phase: 'postpublish',
    tag: TAG,
    statusOutput: '',
    headOutput,
    remoteMainOutput: movedMain,
    tagTypeOutput: 'tag\n',
    tagCommitOutput,
    remoteTagOutput,
  }), /stale|divergent|main/i);
});

test('metadata validation fails closed on any of the four version files drifting', () => {
  const manifest = Buffer.from(JSON.stringify({
    version: TAG,
    minAppVersion: '1.0.0',
  }));
  const versions = Buffer.from(JSON.stringify({ [TAG]: '1.0.0' }));
  assert.equal(core.validateReleaseMetadata({
    tag: TAG,
    rootManifestBytes: manifest,
    pluginManifestBytes: manifest,
    rootVersionsBytes: versions,
    pluginVersionsBytes: versions,
  }).version, TAG);
  assert.throws(() => core.validateReleaseMetadata({
    tag: TAG,
    rootManifestBytes: manifest,
    pluginManifestBytes: Buffer.from(JSON.stringify({ version: '1.3.55', minAppVersion: '1.0.0' })),
    rootVersionsBytes: versions,
    pluginVersionsBytes: versions,
  }), /manifest|drift|version/i);
  assert.throws(() => core.validateReleaseMetadata({
    tag: TAG,
    rootManifestBytes: manifest,
    pluginManifestBytes: manifest,
    rootVersionsBytes: versions,
    pluginVersionsBytes: Buffer.from(JSON.stringify({ [TAG]: '1.5.0' })),
  }), /versions|drift|minAppVersion/i);
});

test('prepublish requires an exact HTTP 404 and rejects approximate Not Found bodies', () => {
  assert.deepEqual(core.validateReleaseLookup({
    phase: 'prepublish',
    statusCode: 404,
    body: Buffer.from('{"message":"Not Found"}'),
  }), { absent: true });
  assert.throws(() => core.validateReleaseLookup({
    phase: 'prepublish',
    statusCode: 200,
    body: Buffer.from('{"message":"Not Found"}'),
  }), /404|status/i);
  assert.throws(() => core.validateReleaseLookup({
    phase: 'prepublish',
    statusCode: 500,
    body: Buffer.from('404 Not Found'),
  }), /404|status/i);
});

test('postpublish release payload rejects SHA drift, missing assets, stale samples, and malformed JSON', () => {
  const nowMs = Date.parse('2026-07-24T12:00:00.000Z');
  const release = {
    tag_name: TAG,
    target_commitish: SHA_A,
    published_at: '2026-07-24T11:30:00.000Z',
    assets: REQUIRED_ASSETS.map((name) => ({
      name,
      browser_download_url: `https://github.com/example/${encodeURIComponent(name)}`,
      size: name.endsWith('.zip') ? 1024 : 128,
    })),
  };
  assert.equal(core.validateReleasePayload(release, {
    tag: TAG,
    expectedCommit: SHA_A,
    expectedAssets: REQUIRED_ASSETS,
    nowMs,
  }).tag_name, TAG);
  assert.throws(() => core.validateReleasePayload({ ...release, target_commitish: SHA_B }, {
    tag: TAG,
    expectedCommit: SHA_A,
    expectedAssets: REQUIRED_ASSETS,
    nowMs,
  }), /commit|SHA|target/i);
  assert.throws(() => core.validateReleasePayload({
    ...release,
    assets: release.assets.slice(0, -1),
  }, {
    tag: TAG,
    expectedCommit: SHA_A,
    expectedAssets: REQUIRED_ASSETS,
    nowMs,
  }), /asset|missing/i);
  assert.throws(() => core.validateReleasePayload({
    ...release,
    published_at: '2026-07-22T11:30:00.000Z',
  }, {
    tag: TAG,
    expectedCommit: SHA_A,
    expectedAssets: REQUIRED_ASSETS,
    nowMs,
  }), /fresh|24|stale/i);
  assert.throws(() => core.validateReleaseLookup({
    phase: 'postpublish',
    statusCode: 200,
    body: Buffer.from('{not-json'),
  }), /JSON|parse/i);
});

test('timeouts and probe failures are never interpreted as an absent release', () => {
  assert.throws(
    () => core.assertProbeCompleted({ timedOut: true, label: 'GitHub release lookup' }),
    /timed out|timeout/i,
  );
  assert.throws(
    () => core.assertProbeCompleted({ error: new Error('socket reset'), label: 'GitHub release lookup' }),
    /socket reset|failed/i,
  );
});

test('response and Release asset size limits fail before buffering oversized data', () => {
  assert.throws(
    () => core.assertResponseWithinLimit(1025, 1024, 'GitHub API response'),
    /size|limit|large/i,
  );
  const release = {
    tag_name: TAG,
    target_commitish: SHA_A,
    published_at: '2026-07-24T11:30:00.000Z',
    assets: REQUIRED_ASSETS.map((name) => ({
      name,
      browser_download_url: `https://github.com/example/${encodeURIComponent(name)}`,
      size: name.endsWith('.zip') ? core.MAX_ZIP_COMPRESSED_BYTES + 1 : 128,
    })),
  };
  assert.throws(() => core.validateReleasePayload(release, {
    tag: TAG,
    expectedCommit: SHA_A,
    expectedAssets: REQUIRED_ASSETS,
    nowMs: Date.parse('2026-07-24T12:00:00.000Z'),
  }), /asset|ZIP|size|large/i);
});

test('ZIP parser validates exact entry names and bytes for stored and deflated members', () => {
  const stored = makeStoredZip({
    'main.js': 'main',
    'local-asr/install.sh': 'asr',
  });
  const parsed = core.parseZipEntries(stored);
  assert.equal(parsed.get('main.js').toString('utf8'), 'main');
  assert.equal(parsed.get('local-asr/install.sh').toString('utf8'), 'asr');
  assert.doesNotThrow(() => core.assertZipMatchesExpected(parsed, new Map([
    ['main.js', Buffer.from('main')],
    ['local-asr/install.sh', Buffer.from('asr')],
  ])));
  assert.throws(() => core.assertZipMatchesExpected(parsed, new Map([
    ['main.js', Buffer.from('changed')],
    ['local-asr/install.sh', Buffer.from('asr')],
  ])), /byte|content|mismatch/i);
  assert.throws(() => core.assertZipMatchesExpected(parsed, new Map([
    ['main.js', Buffer.from('main')],
  ])), /entry|unexpected|set/i);

  const compressed = zlib.deflateRawSync(Buffer.from('compressed'));
  const deflatedZip = makeStoredZip({ 'main.js': compressed });
  deflatedZip.writeUInt16LE(8, 8);
  const centralOffset = deflatedZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  deflatedZip.writeUInt16LE(8, centralOffset + 10);
  const uncompressedCrc = crc32(Buffer.from('compressed'));
  deflatedZip.writeUInt32LE(uncompressedCrc, 14);
  deflatedZip.writeUInt32LE(uncompressedCrc, centralOffset + 16);
  deflatedZip.writeUInt32LE('compressed'.length, 22);
  deflatedZip.writeUInt32LE('compressed'.length, centralOffset + 24);
  assert.equal(core.parseZipEntries(deflatedZip).get('main.js').toString('utf8'), 'compressed');
});

test('ZIP parser computes CRC32 from extracted bytes instead of trusting forged local and central fields', () => {
  const forged = makeStoredZip({ 'main.js': 'non-empty-content' });
  const centralOffset = forged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  forged.writeUInt32LE(0, 14);
  forged.writeUInt32LE(0, centralOffset + 16);
  assert.throws(() => core.parseZipEntries(forged), /CRC|checksum|content/i);
});

test('ZIP parser rejects orphan local headers and unsupported SFX prefixes', () => {
  const orphanArchive = makeStoredZip({ '../evil': 'bad' });
  const orphanCentralOffset = orphanArchive.readUInt32LE(orphanArchive.length - 6);
  const orphanLocalBytes = orphanArchive.subarray(0, orphanCentralOffset);
  const normal = makeStoredZip({ 'main.js': 'main' });
  const normalEocdOffset = normal.length - 22;
  const normalCentralOffset = normal.readUInt32LE(normalEocdOffset + 16);
  const combined = Buffer.concat([orphanLocalBytes, normal]);
  const combinedCentralOffset = orphanLocalBytes.length + normalCentralOffset;
  combined.writeUInt32LE(
    orphanLocalBytes.length + normal.readUInt32LE(normalCentralOffset + 42),
    combinedCentralOffset + 42,
  );
  const combinedEocdOffset = orphanLocalBytes.length + normalEocdOffset;
  combined.writeUInt32LE(combinedCentralOffset, combinedEocdOffset + 16);
  assert.throws(() => core.parseZipEntries(combined), /orphan|prefix|offset|continuous|unreferenced/i);
});

test('ZIP parser requires exact EOCD counts, central adjacency, comment length, and file end', () => {
  const countMismatch = makeStoredZip({ 'main.js': 'main' });
  countMismatch.writeUInt16LE(0, countMismatch.length - 14);
  assert.throws(() => core.parseZipEntries(countMismatch), /entry|count|disk|EOCD/i);

  const centralGapSource = makeStoredZip({ 'main.js': 'main' });
  const oldEocdOffset = centralGapSource.length - 22;
  const centralGap = Buffer.concat([
    centralGapSource.subarray(0, oldEocdOffset),
    Buffer.from([0]),
    centralGapSource.subarray(oldEocdOffset),
  ]);
  assert.throws(() => core.parseZipEntries(centralGap), /central|EOCD|gap|adjacent/i);

  const trailing = Buffer.concat([
    makeStoredZip({ 'main.js': 'main' }),
    Buffer.from('trailing'),
  ]);
  assert.throws(() => core.parseZipEntries(trailing), /EOCD|comment|trailing|end/i);

  const badCommentLength = makeStoredZip({ 'main.js': 'main' });
  badCommentLength.writeUInt16LE(1, badCommentLength.length - 2);
  assert.throws(() => core.parseZipEntries(badCommentLength), /EOCD|comment|trailing|end/i);
});

test('ZIP parser rejects central/local filename confusion and unsupported local flags', () => {
  const mismatch = makeStoredZip({ 'main.js': 'main' });
  Buffer.from('../a.js', 'utf8').copy(mismatch, 30);
  assert.throws(() => core.parseZipEntries(mismatch), /local|filename|unsafe|mismatch/i);

  const descriptor = makeStoredZip({ 'main.js': 'main' });
  descriptor.writeUInt16LE(0x8, 6);
  const centralOffset = descriptor.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  descriptor.writeUInt16LE(0x8, centralOffset + 8);
  assert.throws(() => core.parseZipEntries(descriptor), /descriptor|flag|unsupported/i);

  const sizeMismatch = makeStoredZip({ 'main.js': 'main' });
  sizeMismatch.writeUInt32LE(1, 18);
  assert.throws(() => core.parseZipEntries(sizeMismatch), /local|size|central|mismatch/i);

  const directoryMismatch = makeStoredZip({ 'safe/': '' });
  Buffer.from('../x/', 'utf8').copy(directoryMismatch, 30);
  assert.throws(() => core.parseZipEntries(directoryMismatch), /local|filename|unsafe|mismatch/i);
});

test('ZIP parser enforces compressed, per-entry, and total expanded limits before inflation', () => {
  const zip = makeStoredZip({
    'a.txt': '12345',
    'b.txt': '67890',
  });
  assert.throws(() => core.parseZipEntries(zip, {
    maxCompressedBytes: zip.length - 1,
  }), /compressed|size|limit/i);
  assert.throws(() => core.parseZipEntries(zip, {
    maxEntryUncompressedBytes: 4,
  }), /entry|expanded|size|limit/i);
  assert.throws(() => core.parseZipEntries(zip, {
    maxTotalUncompressedBytes: 9,
  }), /total|expanded|size|limit/i);
});

test('all surfaced errors redact URL credentials, query secrets, bearer tokens, and key-value credentials', () => {
  const sanitized = core.sanitizeErrorMessage(
    'failed https://user:pass@github.com/repo.git?token=query-secret#frag '
    + 'Authorization: Bearer ghp_supersecret token=abc123 api_key=xyz secret: hidden',
  );
  for (const secret of ['user', 'pass', 'query-secret', 'ghp_supersecret', 'abc123', 'xyz', 'hidden']) {
    assert.equal(sanitized.includes(secret), false, `must redact ${secret}`);
  }
  assert.match(sanitized, /\[REDACTED\]/);
  assert.equal(sanitized.includes('?'), false);
});

test('release workflow refuses existing releases and never overwrites assets', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.doesNotMatch(workflow, /--clobber/);
  assert.match(workflow, /gh release view[\s\S]*exit 1/);
  assert.match(workflow, /gh release create/);
  assert.doesNotMatch(workflow, /gh release upload/);
  assert.match(workflow, /node tests\/plugin-release-identity\.test\.js/);
  assert.match(workflow, /node --check scripts\/plugin-release-identity-core\.js/);
  assert.match(workflow, /node --check scripts\/check-plugin-release-identity\.js/);
});

test('production CLI exposes only fixed prepublish/postpublish modes and no command injection options', () => {
  assert.equal(fs.existsSync(cliPath), true);
  const cli = fs.readFileSync(cliPath, 'utf8');
  assert.match(cli, /--prepublish/);
  assert.match(cli, /--postpublish/);
  assert.match(cli, /mingjuner123-spec/);
  assert.match(cli, /wechat-inbox-sync/);
  assert.doesNotMatch(cli, /--command|--git-bin|--api-url|process\.env\.GITHUB_API_URL/);
  assert.doesNotMatch(cli, /shell:\s*true/);
  assert.match(cli, /\['remote', 'get-url', 'origin'\]/);
  assert.match(cli, /\/repos\/\$\{OWNER\}\/\$\{REPOSITORY\}/);
  assert.match(cli, /default_branch|defaultBranch/);
  assert.match(cli, /effectiveDeadlineMs\s*-\s*Date\.now\(\)/);
  assert.doesNotMatch(cli, /resolveReleaseTargetCommit/);
});

test('production CLI rejects a fork origin before any fixed GitHub Release lookup', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-release-cli-fork-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  git(fixtureRoot, ['init', '-b', 'main']);
  git(fixtureRoot, ['config', 'user.email', 'release-test@example.invalid']);
  git(fixtureRoot, ['config', 'user.name', 'Release Test']);
  git(fixtureRoot, ['remote', 'add', 'origin', 'https://github.com/attacker/wechat-inbox-sync.git']);
  writeFixtureFile(path.join(fixtureRoot, 'manifest.json'), JSON.stringify({
    version: TAG,
    minAppVersion: '1.0.0',
  }));
  writeFixtureFile(path.join(fixtureRoot, 'versions.json'), JSON.stringify({ [TAG]: '1.0.0' }));
  writeFixtureFile(
    path.join(fixtureRoot, 'obsidian-plugin/wechat-inbox-sync/manifest.json'),
    JSON.stringify({ version: TAG, minAppVersion: '1.0.0' }),
  );
  writeFixtureFile(
    path.join(fixtureRoot, 'obsidian-plugin/wechat-inbox-sync/versions.json'),
    JSON.stringify({ [TAG]: '1.0.0' }),
  );
  copyProductionIdentityScripts(fixtureRoot);
  git(fixtureRoot, ['add', '.']);
  git(fixtureRoot, ['commit', '-m', 'fixture']);
  git(fixtureRoot, ['tag', '-a', TAG, '-m', TAG]);
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/check-plugin-release-identity.js', '--prepublish', '--tag', TAG],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /official|origin|repository/i);
});

test('production CLI rejects a fork push URL even when fetch origin is official', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-release-cli-push-fork-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  git(fixtureRoot, ['init', '-b', 'main']);
  git(fixtureRoot, ['config', 'user.email', 'release-test@example.invalid']);
  git(fixtureRoot, ['config', 'user.name', 'Release Test']);
  git(fixtureRoot, ['remote', 'add', 'origin', OFFICIAL_ORIGIN]);
  git(fixtureRoot, ['remote', 'set-url', '--push', 'origin', 'https://github.com/attacker/wechat-inbox-sync.git']);
  writeFixtureFile(path.join(fixtureRoot, 'manifest.json'), JSON.stringify({
    version: TAG,
    minAppVersion: '1.0.0',
  }));
  writeFixtureFile(path.join(fixtureRoot, 'versions.json'), JSON.stringify({ [TAG]: '1.0.0' }));
  writeFixtureFile(
    path.join(fixtureRoot, 'obsidian-plugin/wechat-inbox-sync/manifest.json'),
    JSON.stringify({ version: TAG, minAppVersion: '1.0.0' }),
  );
  writeFixtureFile(
    path.join(fixtureRoot, 'obsidian-plugin/wechat-inbox-sync/versions.json'),
    JSON.stringify({ [TAG]: '1.0.0' }),
  );
  copyProductionIdentityScripts(fixtureRoot);
  git(fixtureRoot, ['add', '.']);
  git(fixtureRoot, ['commit', '-m', 'fixture']);
  git(fixtureRoot, ['tag', '-a', TAG, '-m', TAG]);
  const result = childProcess.spawnSync(
    process.execPath,
    ['scripts/check-plugin-release-identity.js', '--prepublish', '--tag', TAG],
    {
      cwd: fixtureRoot,
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /official|origin|repository/i);
});
