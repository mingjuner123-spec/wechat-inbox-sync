'use strict';

const path = require('path');

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

function getLocalDouyinResolverRoot(homeDir) {
  return path.join(String(homeDir || ''), '.wechat-inbox-local-asr', 'tools', 'yt-dlp');
}

function isDouyinCookieDomain(domain) {
  return /(?:^|\.)douyin\.com$/i.test(String(domain || '').replace(/^\./, ''));
}

function sanitizeCookieField(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]/g, '');
}

function buildNetscapeCookieFile(cookies = []) {
  const rows = (Array.isArray(cookies) ? cookies : [])
    .filter((cookie) => cookie && cookie.name && isDouyinCookieDomain(cookie.domain))
    .map((cookie) => {
      const domain = sanitizeCookieField(cookie.domain || 'www.douyin.com');
      const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const pathValue = sanitizeCookieField(cookie.path || '/') || '/';
      const secure = cookie.secure ? 'TRUE' : 'FALSE';
      const expiry = Math.max(0, Math.floor(Number(cookie.expirationDate) || 0));
      return [
        domain,
        includeSubdomains,
        pathValue,
        secure,
        expiry,
        sanitizeCookieField(cookie.name),
        sanitizeCookieField(cookie.value),
      ].join('\t');
    });
  return ['# Netscape HTTP Cookie File', ...rows, ''].join('\n');
}

function extractLocalDouyinResolverMediaUrls(output) {
  let payload;
  try {
    payload = JSON.parse(String(output || ''));
  } catch (error) {
    return [];
  }
  const candidates = [
    payload && payload.url,
    ...((payload && Array.isArray(payload.requested_formats))
      ? payload.requested_formats.map((format) => format && format.url)
      : []),
  ];
  return Array.from(new Set(candidates
    .map((value) => String(value || '').trim())
    .filter((value) => /^https?:\/\//i.test(value))));
}

module.exports = {
  LOCAL_DOUYIN_RESOLVER_CHECK_INTERVAL_MS,
  shouldCheckLocalDouyinResolver,
  shouldForceLocalDouyinResolverCheck,
  isValidSha256,
  selectLocalDouyinResolverAsset,
  getLocalDouyinResolverRoot,
  isDouyinCookieDomain,
  buildNetscapeCookieFile,
  extractLocalDouyinResolverMediaUrls,
};
