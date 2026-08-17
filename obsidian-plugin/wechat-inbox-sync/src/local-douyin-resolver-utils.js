'use strict';

const LOCAL_DOUYIN_RESOLVER_CHECK_INTERVAL_MS = 48 * 60 * 60 * 1000;

function shouldCheckLocalDouyinResolver({
  now = Date.now(),
  lastCheckedAt = 0,
  force = false,
} = {}) {
  if (force) return true;
  const checkedAt = Number(lastCheckedAt);
  return !Number.isFinite(checkedAt)
    || checkedAt <= 0
    || Number(now) - checkedAt >= LOCAL_DOUYIN_RESOLVER_CHECK_INTERVAL_MS;
}

function shouldForceLocalDouyinResolverCheck(error) {
  const message = String(error && error.message || error || '');
  return /extractor|unsupported url|outdated|signature|unable to extract/i.test(message);
}

function isValidSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function selectLocalDouyinResolverAsset(manifest, platform, arch) {
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.assets) return null;
  const asset = manifest.assets[`${platform}-${arch}`];
  if (!asset || !/^https:\/\//i.test(String(asset.url || '')) || !isValidSha256(asset.sha256)) return null;
  return asset;
}

module.exports = {
  LOCAL_DOUYIN_RESOLVER_CHECK_INTERVAL_MS,
  shouldCheckLocalDouyinResolver,
  shouldForceLocalDouyinResolverCheck,
  isValidSha256,
  selectLocalDouyinResolverAsset,
};
