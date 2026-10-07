'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  inspectCachedChannelsVadAssets,
  installChannelsVadAssets,
  normalizeChannelsVadAssetManifest,
  validateChannelsVadDownloadUrl,
} = require('../obsidian-plugin/wechat-inbox-sync/src/channels-vad-optional-assets');

const HOSTS = ['components.example.test'];
const ASSET_NAMES = {
  'vad-segmenter': ['whisper-vad-speech-segments.exe', 'segmenter'],
  'vad-model': ['ggml-silero-v6.2.0.bin', 'vad model'],
  'vad-license': ['LICENSE', 'MIT license text'],
  'vad-runtime-ggml-base': ['ggml-base.dll', 'base dll'],
  'vad-runtime-ggml-cpu': ['ggml-cpu.dll', 'cpu dll'],
  'vad-runtime-ggml': ['ggml.dll', 'ggml dll'],
  'vad-runtime-whisper': ['whisper.dll', 'whisper dll'],
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixtureManifest(platform = 'win32', arch = 'x64') {
  const assets = Object.entries(ASSET_NAMES).map(([id, [fileName, content]]) => ({
    id,
    fileName,
    sha256: sha256(content),
    byteLength: Buffer.byteLength(content),
    downloadUrl: `https://components.example.test/vad/${fileName}`,
  }));
  if (platform === 'darwin') {
    return {
      schemaVersion: 1,
      capability: 'channels-vad',
      platform,
      arch,
      version: '1.0.0',
      assets: [assets[0], assets[1], assets[2]].map((asset, index) => ({
        ...asset,
        fileName: index === 0 ? 'whisper-vad-speech-segments' : asset.fileName,
        downloadUrl: `https://components.example.test/vad/${index}`,
      })),
    };
  }
  return { schemaVersion: 1, capability: 'channels-vad', platform, arch, version: '1.0.0', assets };
}

function assetContent(asset) {
  return ASSET_NAMES[asset.id]?.[1] || 'vad model';
}

function fakeDownloader(counter, { corrupt = false, fail = false } = {}) {
  return async (_url, partPath) => {
    counter.count += 1;
    if (fail) throw new Error('fixture download failed');
    const asset = counter.manifest.assets.find((entry) => entry.downloadUrl === _url);
    const content = assetContent(asset);
    await fs.promises.writeFile(partPath, corrupt ? `${content}bad` : content);
  };
}

async function makeTempRoot(prefix) {
  const canonicalTempDir = await fs.promises.realpath(os.tmpdir());
  return fs.promises.mkdtemp(path.join(canonicalTempDir, prefix));
}

test('validates isolated optional Windows capability and installs a platform bundle with hash cache reuse', async (t) => {
  const root = await makeTempRoot('channels-vad-assets-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const manifest = fixtureManifest();
  const counter = { count: 0, manifest };
  const options = {
    manifest,
    platform: 'win32',
    arch: 'x64',
    installRoot: path.join(root, 'components'),
    cacheRoot: path.join(root, 'cache'),
    allowedHosts: HOSTS,
    downloadAsset: fakeDownloader(counter),
  };

  const result = await installChannelsVadAssets(options);
  assert.equal(result.available, true);
  assert.equal(result.reused, false);
  assert.equal(path.basename(result.vadSegmenterPath), 'whisper-vad-speech-segments.exe');
  assert.equal(path.basename(result.vadModelPath), 'ggml-silero-v6.2.0.bin');
  for (const name of Object.values(ASSET_NAMES).slice(2).map(([fileName]) => fileName)) {
    assert.equal(await fs.promises.stat(path.join(result.binDir, name)).then((stat) => stat.isFile()), true);
  }
  assert.equal(counter.count, 7);

  await fs.promises.rm(result.bundleRoot, { recursive: true, force: true });
  const restoredFromShaCache = await installChannelsVadAssets(options);
  assert.equal(restoredFromShaCache.available, true);
  assert.equal(restoredFromShaCache.reused, false);
  assert.equal(counter.count, 7, 'verified SHA cache should avoid redownloads after bundle loss');

  const second = await installChannelsVadAssets(options);
  assert.equal(second.available, true);
  assert.equal(second.reused, true);
  assert.equal(counter.count, 7, 'verified bundle should avoid repeat work');
});

test('rejects mismatched targets, unsafe URLs, and non-capability manifests', async () => {
  const manifest = fixtureManifest();
  assert.equal(normalizeChannelsVadAssetManifest(manifest, {
    platform: 'darwin', arch: 'x64', allowedHosts: HOSTS,
  }), null);
  assert.equal(normalizeChannelsVadAssetManifest({ ...manifest, capability: 'asr' }, {
    platform: 'win32', arch: 'x64', allowedHosts: HOSTS,
  }), null);
  assert.equal(normalizeChannelsVadAssetManifest(fixtureManifest('win32', 'arm64'), {
    platform: 'win32', arch: 'arm64', allowedHosts: HOSTS,
  }), null);
  assert.equal(validateChannelsVadDownloadUrl('http://components.example.test/a', HOSTS), false);
  assert.equal(validateChannelsVadDownloadUrl('https://user:pass@components.example.test/a', HOSTS), false);
  assert.equal(validateChannelsVadDownloadUrl('https://127.0.0.1/a', ['127.0.0.1']), false);
  assert.equal(validateChannelsVadDownloadUrl('https://[::1]/a', ['[::1]']), false);
  assert.equal(validateChannelsVadDownloadUrl('https://localhost/a', ['localhost']), false);

  assert.deepEqual(await installChannelsVadAssets({
    manifest: fixtureManifest('win32', 'arm64'),
    platform: 'win32',
    arch: 'arm64',
    installRoot: path.join(os.tmpdir(), 'unsupported-vad-target'),
    cacheRoot: path.join(os.tmpdir(), 'unsupported-vad-cache'),
    allowedHosts: HOSTS,
  }), { available: false, reason: 'invalid_target' });

  const unsafe = fixtureManifest();
  unsafe.assets[0].downloadUrl = 'https://other.example.test/segmenter';
  assert.equal(normalizeChannelsVadAssetManifest(unsafe, {
    platform: 'win32', arch: 'x64', allowedHosts: HOSTS,
  }), null);

  const withoutLicense = fixtureManifest();
  withoutLicense.assets = withoutLicense.assets.filter((asset) => asset.id !== 'vad-license');
  assert.equal(normalizeChannelsVadAssetManifest(withoutLicense, {
    platform: 'win32', arch: 'x64', allowedHosts: HOSTS,
  }), null);
});

test('download or integrity failures leave the existing ASR installation untouched', async (t) => {
  const root = await makeTempRoot('channels-vad-failure-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const asrRoot = path.join(root, 'asr');
  const asrSentinel = path.join(asrRoot, 'whisper-cli.exe');
  await fs.promises.mkdir(asrRoot, { recursive: true });
  await fs.promises.writeFile(asrSentinel, 'existing ASR component');
  const manifest = fixtureManifest();
  const base = {
    manifest,
    platform: 'win32',
    arch: 'x64',
    installRoot: path.join(root, 'components'),
    cacheRoot: path.join(root, 'cache'),
    allowedHosts: HOSTS,
  };

  const failedDownload = await installChannelsVadAssets({
    ...base,
    downloadAsset: fakeDownloader({ count: 0, manifest }, { fail: true }),
  });
  assert.equal(failedDownload.available, false);
  assert.equal(await fs.promises.readFile(asrSentinel, 'utf8'), 'existing ASR component');
  assert.equal(await fs.promises.readdir(path.join(base.installRoot, 'vad', 'win32', 'x64')).then((names) => names.length, () => 0), 0);

  const badIntegrity = await installChannelsVadAssets({
    ...base,
    downloadAsset: fakeDownloader({ count: 0, manifest }, { corrupt: true }),
  });
  assert.equal(badIntegrity.available, false);
  assert.equal(badIntegrity.reason, 'asset_integrity_failed');
  assert.equal(await fs.promises.readFile(asrSentinel, 'utf8'), 'existing ASR component');
  assert.equal(await fs.promises.readdir(path.join(base.installRoot, 'vad', 'win32', 'x64')).then((names) => names.length, () => 0), 0);
});

test('does not install assets when the operation is already aborted', async (t) => {
  const root = await makeTempRoot('channels-vad-abort-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  controller.abort();
  let downloads = 0;
  const result = await installChannelsVadAssets({
    manifest: fixtureManifest(),
    platform: 'win32',
    arch: 'x64',
    installRoot: path.join(root, 'components'),
    cacheRoot: path.join(root, 'cache'),
    allowedHosts: HOSTS,
    signal: controller.signal,
    downloadAsset: async () => { downloads += 1; },
  });
  assert.deepEqual(result, { available: false, reason: 'aborted' });
  assert.equal(downloads, 0);
});

test('rejects symlinked installation roots before invoking the downloader', async (t) => {
  const root = await makeTempRoot('channels-vad-symlink-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const realRoot = path.join(root, 'real-install');
  const installLink = path.join(root, 'install-link');
  await fs.promises.mkdir(realRoot, { recursive: true });
  try {
    await fs.promises.symlink(realRoot, installLink, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (_error) {
    t.skip('symlink creation is unavailable in this test environment');
    return;
  }
  let downloads = 0;
  const result = await installChannelsVadAssets({
    manifest: fixtureManifest(),
    platform: 'win32',
    arch: 'x64',
    installRoot: installLink,
    cacheRoot: path.join(root, 'cache'),
    allowedHosts: HOSTS,
    downloadAsset: async () => { downloads += 1; },
  });
  assert.deepEqual(result, { available: false, reason: 'symlink_path_rejected' });
  assert.equal(downloads, 0);
});

test('rejects a symlinked SHA cache entry instead of following it', async (t) => {
  const root = await makeTempRoot('channels-vad-cache-link-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const manifest = fixtureManifest();
  const asset = manifest.assets[0];
  const cacheRoot = path.join(root, 'cache');
  const outside = path.join(root, 'outside.asset');
  await fs.promises.mkdir(cacheRoot, { recursive: true });
  await fs.promises.writeFile(outside, assetContent(asset));
  try {
    await fs.promises.symlink(outside, path.join(cacheRoot, `${asset.sha256}.asset`), 'file');
  } catch (_error) {
    t.skip('file symlink creation is unavailable in this test environment');
    return;
  }
  let downloads = 0;
  const result = await installChannelsVadAssets({
    manifest,
    platform: 'win32',
    arch: 'x64',
    installRoot: path.join(root, 'components'),
    cacheRoot,
    allowedHosts: HOSTS,
    downloadAsset: async () => { downloads += 1; },
  });
  assert.deepEqual(result, { available: false, reason: 'symlink_path_rejected' });
  assert.equal(downloads, 0);
  assert.equal(await fs.promises.readFile(outside, 'utf8'), assetContent(asset));
});

test('Darwin installs an executable segmenter and reuses only a verified path-free receipt', async (t) => {
  const root = await makeTempRoot('channels-vad-receipt-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const manifest = fixtureManifest('darwin', 'arm64');
  const counter = { count: 0, manifest };
  const chmodCalls = [];
  const result = await installChannelsVadAssets({
    manifest,
    platform: 'darwin',
    arch: 'arm64',
    installRoot: path.join(root, 'components'),
    cacheRoot: path.join(root, 'cache'),
    allowedHosts: HOSTS,
    downloadAsset: fakeDownloader(counter),
  }, {
    chmod: async (filePath, mode) => {
      chmodCalls.push({ filePath, mode });
      await fs.promises.chmod(filePath, mode);
    },
  });
  assert.equal(result.available, true);
  assert.equal(result.receiptSaved, true);
  assert.equal(chmodCalls.length, 1);
  assert.equal(path.basename(chmodCalls[0].filePath), path.basename(result.vadSegmenterPath));
  assert.equal(chmodCalls[0].mode, 0o755);

  const receiptPath = path.join(root, 'components', 'vad', 'receipts', 'channels-vad-darwin-arm64.json');
  const receiptText = await fs.promises.readFile(receiptPath, 'utf8');
  assert.equal(receiptText.includes('downloadUrl'), false);
  assert.equal(receiptText.includes('token'), false);
  const cached = await inspectCachedChannelsVadAssets({
    installRoot: path.join(root, 'components'), platform: 'darwin', arch: 'arm64',
  }, process.platform === 'darwin' ? {} : { isExecutable: async () => true });
  assert.equal(cached.available, true);
  assert.equal(cached.source, 'local_receipt');
  assert.equal(cached.vadSegmenterPath, result.vadSegmenterPath);
  const cachedWithoutExecuteBit = await inspectCachedChannelsVadAssets({
    installRoot: path.join(root, 'components'), platform: 'darwin', arch: 'arm64',
  }, { isExecutable: async () => false });
  assert.deepEqual(cachedWithoutExecuteBit, { available: false, reason: 'cached_segmenter_not_executable' });

  const parsed = JSON.parse(receiptText);
  parsed.assets[0].fileName = '../../outside';
  await fs.promises.writeFile(receiptPath, JSON.stringify(parsed));
  const badReceipt = await inspectCachedChannelsVadAssets({
    installRoot: path.join(root, 'components'), platform: 'darwin', arch: 'arm64',
  });
  assert.deepEqual(badReceipt, { available: false, reason: 'cached_receipt_invalid' });
  assert.equal(counter.count, 3);
});

test('Darwin bundle is unavailable when executable permissions cannot be applied', async (t) => {
  const root = await makeTempRoot('channels-vad-chmod-');
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const manifest = fixtureManifest('darwin', 'x64');
  const result = await installChannelsVadAssets({
    manifest,
    platform: 'darwin',
    arch: 'x64',
    installRoot: path.join(root, 'components'),
    cacheRoot: path.join(root, 'cache'),
    allowedHosts: HOSTS,
    downloadAsset: fakeDownloader({ count: 0, manifest }),
  }, {
    chmod: async () => { throw new Error('chmod denied'); },
  });
  assert.deepEqual(result, { available: false, reason: 'executable_permission_failed' });
});
