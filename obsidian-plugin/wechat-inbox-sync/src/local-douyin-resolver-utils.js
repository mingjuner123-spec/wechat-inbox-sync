'use strict';

const path = require('path');

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
  const root = String(homeDir || '');
  // Tests and release tooling may run on a different OS than the plugin host.
  // Preserve a Windows home path even when this helper executes on a Linux runner.
  const pathApi = /^(?:[a-z]:[\\/]|\\\\)/i.test(root) ? path.win32 : path;
  return pathApi.join(root, '.wechat-inbox-local-asr', 'tools', 'yt-dlp');
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
  isValidSha256,
  selectLocalDouyinResolverAsset,
  getLocalDouyinResolverRoot,
  isDouyinCookieDomain,
  buildNetscapeCookieFile,
  extractLocalDouyinResolverMediaUrls,
};
