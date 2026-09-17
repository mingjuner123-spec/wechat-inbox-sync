'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');

const MAX_RESOLVER_BYTES = 100 * 1024 * 1024;

function resolverError(code, stage, source, url = '') {
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  const safeCode = /^[A-Z0-9_]{1,80}$/.test(String(code || '')) ? code : 'DOWNLOAD_FAILED';
  const error = new Error(`抖音解析组件：${stage}失败（${source}，${host || '未连接'}，${safeCode}）`);
  return Object.assign(error, { code: safeCode, stage, source, host });
}

function isResolverAuthorizationError(error) {
  return [401, 403, 429].includes(Number(error && (error.status || error.statusCode)))
    || /^(PRO_REQUIRED|UNAUTHORIZED|FORBIDDEN|COMPONENT_DOWNLOAD_RATE_LIMITED|COMPONENT_CLIENT_UPGRADE_REQUIRED)$/.test(String(error && error.code || ''));
}

function resolverReceiptPath(executablePath) { return `${executablePath}.verified.json`; }

function getVerifiedResolverStatus(executablePath, platform, arch) {
  try {
    if (fs.statSync(resolverReceiptPath(executablePath)).size > 4096) return { ready: false };
    const receipt = JSON.parse(fs.readFileSync(resolverReceiptPath(executablePath), 'utf8'));
    const stat = fs.statSync(executablePath);
    if (receipt.schema !== 1 || receipt.platform !== platform || receipt.arch !== arch
      || !isValidSha256(receipt.sha256) || !stat.isFile() || stat.size <= 0
      || stat.size > MAX_RESOLVER_BYTES || stat.size !== receipt.byteLength) return { ready: false };
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(executablePath)).digest('hex');
    return { ready: sha256 === receipt.sha256, executablePath, version: receipt.version };
  } catch { return { ready: false }; }
}

// Uses the OS HTTPS trust store; certificate verification is never disabled.
function downloadResolverViaSystem(url) {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\//.test(url)) return reject(resolverError('HTTPS_REQUIRED', 'download', 'system'));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-resolver-'));
    const output = path.join(directory, 'download.bin');
    const command = process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe') : '/usr/bin/curl';
    execFile(command, ['--fail', '--silent', '--show-error', '--location', '--max-redirs', '5',
      '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '20', '--max-time', '120',
      '--max-filesize', String(MAX_RESOLVER_BYTES), '--write-out', '%{http_code}', '--output', output, url],
    { windowsHide: true, timeout: 125000, maxBuffer: 16384 }, (error, stdout) => {
      try {
        const status = Number(String(stdout || '').trim());
        if ([401, 403, 429].includes(status)) throw Object.assign(resolverError('HTTP_' + status, 'download', 'system', url), { status });
        if (error) throw resolverError(Number(error.code) === 60 ? 'TLS_CERTIFICATE_FAILED' : 'SYSTEM_DOWNLOAD_FAILED', 'download', 'system', url);
        const stat = fs.statSync(output);
        if (stat.size <= 0 || stat.size > MAX_RESOLVER_BYTES) throw resolverError('INVALID_SIZE', 'download', 'system', url);
        resolve(fs.readFileSync(output));
      } catch (failure) { reject(failure); }
      finally {
        try { fs.unlinkSync(output); } catch {}
        try { fs.rmdirSync(directory); } catch {}
      }
    });
  });
}

async function downloadVerifiedResolverAsset(asset, dependencies) {
  const { download, systemDownload = downloadResolverViaSystem, onStage = () => {} } = dependencies;
  const source = asset.source;
  for (const [transport, run] of [['app', download], ['system', systemDownload]]) {
    onStage({ stage: 'download', source, transport, status: 'running', host: new URL(asset.url).hostname });
    try {
      const bytes = Buffer.from(await run(asset.url));
      if (!bytes.length || bytes.length > MAX_RESOLVER_BYTES || (asset.byteLength && bytes.length !== asset.byteLength)) {
        throw resolverError('INVALID_SIZE', 'verify', source, asset.url);
      }
      const actual = crypto.createHash('sha256').update(bytes).digest('hex');
      if (actual !== asset.sha256.toLowerCase()) throw resolverError('HASH_MISMATCH', 'verify', source, asset.url);
      return bytes;
    } catch (error) {
      onStage({ stage: error.stage || 'download', source, transport, status: 'failed',
        host: new URL(asset.url).hostname, code: /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'DOWNLOAD_FAILED' });
      if (isResolverAuthorizationError(error) || transport === 'system' || ['HASH_MISMATCH', 'INVALID_SIZE'].includes(error.code)) throw error;
    }
  }
}

function commitVerifiedResolver(executablePath, bytes, asset, platform, arch) {
  // Verify again at the filesystem boundary; never replace a good executable with unverified bytes.
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256.toLowerCase()) throw resolverError('HASH_MISMATCH', 'verify', asset.source);
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  const suffix = `.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
  const temporary = executablePath + suffix + '.tmp';
  const receipt = resolverReceiptPath(executablePath);
  const receiptTemporary = receipt + suffix + '.tmp';
  const backup = executablePath + suffix + '.backup';
  let backedUp = false;
  let replaced = false;
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o700 });
    fs.writeFileSync(receiptTemporary, JSON.stringify({ schema: 1, platform, arch, version: asset.version,
      sha256: asset.sha256.toLowerCase(), byteLength: bytes.length }), { mode: 0o600 });
    if (fs.existsSync(executablePath)) { fs.renameSync(executablePath, backup); backedUp = true; }
    fs.renameSync(temporary, executablePath); replaced = true;
    fs.renameSync(receiptTemporary, receipt);
    if (backedUp) { try { fs.unlinkSync(backup); } catch {} }
  } catch (error) {
    if (replaced) { try { fs.unlinkSync(executablePath); } catch {} }
    if (backedUp && fs.existsSync(backup)) fs.renameSync(backup, executablePath);
    throw resolverError(error.code, 'install', asset.source);
  } finally {
    for (const file of [temporary, receiptTemporary]) { try { fs.unlinkSync(file); } catch {} }
  }
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

function parseOfficialChecksums(text) {
  const checksums = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) checksums.set(match[2].trim(), match[1].toLowerCase());
  }
  return checksums;
}

function buildLocalDouyinResolverGithubManifest(releasePayload, checksumsText) {
  const tagName = String(releasePayload && releasePayload.tag_name || '').trim();
  if (!/^\d{4}\.\d{2}\.\d{2}(?:[.-][A-Za-z0-9.-]+)?$/.test(tagName)) return null;
  const checksums = parseOfficialChecksums(checksumsText);
  const releaseBaseUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${tagName}`;
  const windowsSha256 = checksums.get('yt-dlp.exe');
  const macosSha256 = checksums.get('yt-dlp_macos');
  if (!isValidSha256(windowsSha256) || !isValidSha256(macosSha256)) return null;
  return {
    schemaVersion: 1,
    upstream: 'yt-dlp',
    version: tagName,
    assets: {
      'win32-x64': {
        url: `${releaseBaseUrl}/yt-dlp.exe`,
        sha256: windowsSha256,
      },
      'darwin-arm64': {
        url: `${releaseBaseUrl}/yt-dlp_macos`,
        sha256: macosSha256,
      },
      'darwin-x64': {
        url: `${releaseBaseUrl}/yt-dlp_macos`,
        sha256: macosSha256,
      },
    },
  };
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
  MAX_RESOLVER_BYTES,
  resolverError,
  isResolverAuthorizationError,
  getVerifiedResolverStatus,
  downloadResolverViaSystem,
  downloadVerifiedResolverAsset,
  commitVerifiedResolver,
  isValidSha256,
  selectLocalDouyinResolverAsset,
  parseOfficialChecksums,
  buildLocalDouyinResolverGithubManifest,
  getLocalDouyinResolverRoot,
  isDouyinCookieDomain,
  buildNetscapeCookieFile,
  extractLocalDouyinResolverMediaUrls,
};
