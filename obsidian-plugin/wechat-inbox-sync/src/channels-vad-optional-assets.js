'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const REQUIRED_ASSETS = Object.freeze({
  'vad-segmenter': Object.freeze({ darwin: 'whisper-vad-speech-segments', win32: 'whisper-vad-speech-segments.exe' }),
  'vad-model': Object.freeze({ all: 'ggml-silero-v6.2.0.bin' }),
  'vad-license': Object.freeze({ all: 'LICENSE' }),
});
const WINDOWS_RUNTIME_DLLS = Object.freeze({
  'vad-runtime-ggml-base': 'ggml-base.dll',
  'vad-runtime-ggml-cpu': 'ggml-cpu.dll',
  'vad-runtime-ggml': 'ggml.dll',
  'vad-runtime-whisper': 'whisper.dll',
});

function isAllowedHost(host, allowedHosts) {
  const value = String(host || '').toLowerCase().replace(/\.$/, '');
  const ipCandidate = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (!value || net.isIP(ipCandidate) || value === 'localhost' || value.endsWith('.localhost')
    || value.endsWith('.local') || !Array.isArray(allowedHosts)) return false;
  return allowedHosts.some((entry) => String(entry || '').toLowerCase().replace(/\.$/, '') === value);
}

function validateDownloadUrl(value, allowedHosts) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !isAllowedHost(url.hostname, allowedHosts)) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

function safeSegment(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(String(value || ''))
    && !String(value).includes('..');
}

function isSupportedTarget(platform, arch) {
  return (platform === 'darwin' && ['arm64', 'x64'].includes(arch))
    || (platform === 'win32' && arch === 'x64');
}

function receiptPathFor(installRoot, platform, arch) {
  return path.join(installRoot, 'vad', 'receipts', `channels-vad-${platform}-${arch}.json`);
}

function normalizeManifest(manifest, { platform, arch, allowedHosts } = {}) {
  if (!isSupportedTarget(platform, arch) || !manifest || Number(manifest.schemaVersion) !== 1 || manifest.capability !== 'channels-vad'
    || manifest.platform !== platform || manifest.arch !== arch || !safeSegment(manifest.version)
    || !Array.isArray(manifest.assets) || !Array.isArray(allowedHosts) || !allowedHosts.length) return null;
  const assets = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const raw of manifest.assets) {
    const id = String(raw && raw.id || '');
    const fileName = String(raw && raw.fileName || '');
    const expectedName = REQUIRED_ASSETS[id]
      ? (REQUIRED_ASSETS[id].all || REQUIRED_ASSETS[id][platform])
      : (platform === 'win32' ? WINDOWS_RUNTIME_DLLS[id] : '');
    const sha256 = String(raw && raw.sha256 || '').toLowerCase();
    const byteLength = Number(raw && raw.byteLength);
    const downloadUrl = String(raw && raw.downloadUrl || '');
    if (!expectedName || seen.has(id) || fileName !== expectedName
      || !/^[a-f0-9]{64}$/.test(sha256)
      || !Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > MAX_ASSET_BYTES
      || !validateDownloadUrl(downloadUrl, allowedHosts)) return null;
    totalBytes += byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ASSET_BYTES) return null;
    seen.add(id);
    assets.push({ id, fileName, sha256, byteLength, downloadUrl });
  }
  if (!seen.has('vad-segmenter') || !seen.has('vad-model') || !seen.has('vad-license')) return null;
  if (platform === 'win32' && Object.keys(WINDOWS_RUNTIME_DLLS).some((id) => !seen.has(id))) return null;
  if (platform === 'darwin' && assets.some((asset) => asset.id.startsWith('vad-runtime-'))) return null;
  return { schemaVersion: 1, capability: 'channels-vad', platform, arch, version: manifest.version, assets };
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function isVerifiedFile(filePath, asset, hash = hashFile) {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (stat.isSymbolicLink()) return false;
    if (!stat.isFile() || stat.size !== asset.byteLength) return false;
    return String(await hash(filePath)).toLowerCase() === asset.sha256;
  } catch (_error) {
    return false;
  }
}

async function hasSymlinkInPath(pathname) {
  const absolute = path.resolve(pathname);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink()) return true;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

function manifestIdentity(manifest) {
  const identity = manifest.assets.slice().sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, fileName, sha256, byteLength }) => [id, fileName, sha256, byteLength]);
  return crypto.createHash('sha256').update(JSON.stringify([
    manifest.capability, manifest.platform, manifest.arch, manifest.version, identity,
  ])).digest('hex');
}

function normalizeReceipt(receipt, platform, arch) {
  if (!isSupportedTarget(platform, arch) || !receipt || receipt.schemaVersion !== 1
    || receipt.capability !== 'channels-vad' || receipt.platform !== platform || receipt.arch !== arch
    || !safeSegment(receipt.version) || !Array.isArray(receipt.assets)) return null;
  const assets = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const raw of receipt.assets) {
    const id = String(raw && raw.id || '');
    const fileName = String(raw && raw.fileName || '');
    const expectedName = REQUIRED_ASSETS[id]
      ? (REQUIRED_ASSETS[id].all || REQUIRED_ASSETS[id][platform])
      : (platform === 'win32' ? WINDOWS_RUNTIME_DLLS[id] : '');
    const sha256 = String(raw && raw.sha256 || '').toLowerCase();
    const byteLength = Number(raw && raw.byteLength);
    if (!expectedName || seen.has(id) || fileName !== expectedName || !/^[a-f0-9]{64}$/.test(sha256)
      || !Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > MAX_ASSET_BYTES) return null;
    totalBytes += byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_ASSET_BYTES) return null;
    seen.add(id);
    assets.push({ id, fileName, sha256, byteLength });
  }
  if (!seen.has('vad-segmenter') || !seen.has('vad-model') || !seen.has('vad-license')) return null;
  if (platform === 'win32' && Object.keys(WINDOWS_RUNTIME_DLLS).some((id) => !seen.has(id))) return null;
  if (platform === 'darwin' && assets.some((asset) => asset.id.startsWith('vad-runtime-'))) return null;
  const normalized = { capability: 'channels-vad', platform, arch, version: receipt.version, assets };
  const identity = manifestIdentity(normalized);
  if (receipt.identity !== identity) return null;
  return { ...normalized, identity };
}

async function writeLocalReceipt(installRoot, manifest, identity) {
  const receiptPath = receiptPathFor(installRoot, manifest.platform, manifest.arch);
  try {
    if (await hasSymlinkInPath(receiptPath)) return false;
    const receiptDir = path.dirname(receiptPath);
    await fs.promises.mkdir(receiptDir, { recursive: true });
    const receipt = {
      schemaVersion: 1,
      capability: 'channels-vad',
      platform: manifest.platform,
      arch: manifest.arch,
      version: manifest.version,
      identity,
      assets: manifest.assets.map(({ id, fileName, sha256, byteLength }) => ({ id, fileName, sha256, byteLength })),
    };
    const tempPath = `${receiptPath}.tmp-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
    try {
      await fs.promises.writeFile(tempPath, JSON.stringify(receipt) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.promises.rename(tempPath, receiptPath).catch(async (error) => {
        if (error && ['EEXIST', 'EPERM'].includes(error.code)) {
          const existing = await fs.promises.lstat(receiptPath).catch(() => null);
          if (existing && existing.isFile() && !existing.isSymbolicLink()) {
            await fs.promises.unlink(receiptPath);
            await fs.promises.rename(tempPath, receiptPath);
            return;
          }
        }
        throw error;
      });
      return true;
    } finally {
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  } catch (_error) {
    return false;
  }
}

async function inspectCachedChannelsVadAssets({ installRoot, platform, arch } = {}, dependencies = {}) {
  if (!installRoot || !isSupportedTarget(platform, arch)) return { available: false, reason: 'invalid_target' };
  const receiptPath = receiptPathFor(installRoot, platform, arch);
  try {
    if (await hasSymlinkInPath(installRoot) || await hasSymlinkInPath(receiptPath)) {
      return { available: false, reason: 'symlink_path_rejected' };
    }
    const receiptStat = await fs.promises.lstat(receiptPath);
    if (!receiptStat.isFile() || receiptStat.isSymbolicLink() || receiptStat.size > 64 * 1024) {
      return { available: false, reason: 'cached_receipt_invalid' };
    }
    const parsed = JSON.parse(await fs.promises.readFile(receiptPath, 'utf8'));
    const receipt = normalizeReceipt(parsed, platform, arch);
    if (!receipt) return { available: false, reason: 'cached_receipt_invalid' };
    const bundleRoot = path.join(installRoot, 'vad', platform, arch, `${receipt.version}-${receipt.identity.slice(0, 16)}`);
    if (await hasSymlinkInPath(bundleRoot)) return { available: false, reason: 'symlink_path_rejected' };
    const binDir = path.join(bundleRoot, 'bin');
    const modelDir = path.join(bundleRoot, 'models');
    const segmenterName = REQUIRED_ASSETS['vad-segmenter'][platform];
    const modelName = REQUIRED_ASSETS['vad-model'].all;
    const hash = dependencies.sha256File || hashFile;
    for (const asset of receipt.assets) {
      const assetPath = asset.id === 'vad-model'
        ? path.join(modelDir, asset.fileName)
        : path.join(binDir, asset.fileName);
      if (await hasSymlinkInPath(assetPath) || !await isVerifiedFile(assetPath, asset, hash)) {
        return { available: false, reason: 'cached_bundle_unverified' };
      }
    }
    if (platform === 'darwin') {
      const executable = dependencies.isExecutable || (async (filePath) => {
        const stat = await fs.promises.lstat(filePath);
        return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0;
      });
      if (!await executable(path.join(binDir, segmenterName))) {
        return { available: false, reason: 'cached_segmenter_not_executable' };
      }
    }
    return {
      available: true,
      bundleRoot,
      binDir,
      vadSegmenterPath: path.join(binDir, segmenterName),
      vadModelPath: path.join(modelDir, modelName),
      reused: true,
      source: 'local_receipt',
    };
  } catch (error) {
    return { available: false, reason: error && error.code === 'ENOENT' ? 'cached_receipt_missing' : 'cached_receipt_invalid' };
  }
}

function isAborted(signal) {
  return Boolean(signal && signal.aborted);
}

async function installChannelsVadAssets({
  manifest,
  platform,
  arch,
  installRoot,
  cacheRoot,
  allowedHosts,
  signal,
  downloadAsset,
} = {}, dependencies = {}) {
  if (!isSupportedTarget(platform, arch) || !installRoot || !cacheRoot) {
    return { available: false, reason: 'invalid_target' };
  }
  const normalized = normalizeManifest(manifest, { platform, arch, allowedHosts });
  if (!normalized) return { available: false, reason: 'manifest_invalid' };
  if (isAborted(signal)) return { available: false, reason: 'aborted' };
  const download = downloadAsset || dependencies.downloadAsset;
  if (typeof download !== 'function') return { available: false, reason: 'downloader_unavailable' };
  const hash = dependencies.sha256File || hashFile;
  try {
    if (await hasSymlinkInPath(installRoot) || await hasSymlinkInPath(cacheRoot)) {
      return { available: false, reason: 'symlink_path_rejected' };
    }
  } catch (_error) {
    return { available: false, reason: 'path_check_failed' };
  }
  const identity = manifestIdentity(normalized);
  const bundleRoot = path.join(installRoot, 'vad', platform, arch, `${normalized.version}-${identity.slice(0, 16)}`);
  const binDir = path.join(bundleRoot, 'bin');
  const modelDir = path.join(bundleRoot, 'models');
  const segmenterName = REQUIRED_ASSETS['vad-segmenter'][platform];
  const segmenterPath = path.join(binDir, segmenterName);
  const modelPath = path.join(modelDir, REQUIRED_ASSETS['vad-model'].all);

  const finalFiles = normalized.assets.map((asset) => ({
    asset,
    destination: asset.id === 'vad-model' ? modelPath : path.join(binDir, asset.fileName),
  }));
  if (await hasSymlinkInPath(bundleRoot)) return { available: false, reason: 'symlink_path_rejected' };
  const targetExists = await fs.promises.access(bundleRoot).then(() => true, () => false);
  if (targetExists) {
    for (const entry of finalFiles) {
      if (!await isVerifiedFile(entry.destination, entry.asset, hash)) {
        return { available: false, reason: 'existing_bundle_unverified' };
      }
    }
    if (platform === 'darwin') {
      const executable = dependencies.isExecutable || (async (filePath) => {
        const stat = await fs.promises.lstat(filePath);
        return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0;
      });
      if (!await executable(segmenterPath)) return { available: false, reason: 'cached_segmenter_not_executable' };
    }
    const receiptSaved = await writeLocalReceipt(installRoot, normalized, identity);
    return { available: true, bundleRoot, binDir, vadSegmenterPath: segmenterPath, vadModelPath: modelPath, reused: true, receiptSaved };
  }

  const stagingRoot = `${bundleRoot}.stage-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const stageBin = path.join(stagingRoot, 'bin');
  const stageModels = path.join(stagingRoot, 'models');
  try {
    if (isAborted(signal)) return { available: false, reason: 'aborted' };
    await fs.promises.mkdir(stageBin, { recursive: true });
    await fs.promises.mkdir(stageModels, { recursive: true });
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    for (const { asset } of finalFiles) {
      if (isAborted(signal)) return { available: false, reason: 'aborted' };
      const cachePath = path.join(cacheRoot, `${asset.sha256}.asset`);
      if (await hasSymlinkInPath(cachePath)) return { available: false, reason: 'symlink_path_rejected' };
      if (!await isVerifiedFile(cachePath, asset, hash)) {
        await fs.promises.unlink(cachePath).catch((error) => {
          if (!error || error.code !== 'ENOENT') throw error;
        });
        const partPath = `${cachePath}.part-${process.pid}-${crypto.randomBytes(5).toString('hex')}`;
        try {
          await download(asset.downloadUrl, partPath, { signal, maxBytes: asset.byteLength });
          if (isAborted(signal)) return { available: false, reason: 'aborted' };
          if (!await isVerifiedFile(partPath, asset, hash)) return { available: false, reason: 'asset_integrity_failed' };
          await fs.promises.rename(partPath, cachePath).catch(async (error) => {
            if (error && ['EEXIST', 'EPERM'].includes(error.code) && await isVerifiedFile(cachePath, asset, hash)) {
              await fs.promises.unlink(partPath).catch(() => {});
              return;
            }
            throw error;
          });
        } finally {
          await fs.promises.unlink(partPath).catch(() => {});
        }
      }
      const destination = asset.id === 'vad-model' ? path.join(stageModels, asset.fileName) : path.join(stageBin, asset.fileName);
      await fs.promises.copyFile(cachePath, destination);
      if (!await isVerifiedFile(destination, asset, hash)) return { available: false, reason: 'staged_asset_integrity_failed' };
      if (asset.id === 'vad-segmenter' && platform === 'darwin') {
        try {
          await (dependencies.chmod || fs.promises.chmod)(destination, 0o755);
        } catch (_error) {
          return { available: false, reason: 'executable_permission_failed' };
        }
      }
    }
    if (isAborted(signal)) return { available: false, reason: 'aborted' };
    await fs.promises.rename(stagingRoot, bundleRoot);
    const receiptSaved = await writeLocalReceipt(installRoot, normalized, identity);
    return { available: true, bundleRoot, binDir, vadSegmenterPath: segmenterPath, vadModelPath: modelPath, reused: false, receiptSaved };
  } catch (_error) {
    return { available: false, reason: 'install_failed' };
  } finally {
    await fs.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  inspectCachedChannelsVadAssets,
  installChannelsVadAssets,
  normalizeChannelsVadAssetManifest: normalizeManifest,
  validateChannelsVadDownloadUrl: validateDownloadUrl,
};
