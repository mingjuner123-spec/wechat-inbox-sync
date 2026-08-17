#!/usr/bin/env node
'use strict';

// Controlled yt-dlp CDN mirror. It never carries user cookies or media: only
// official release binaries and a SHA-256 verified manifest are published.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const UPSTREAM_RELEASE_URL = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const CDN_BASE_URL = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com';
const DEFAULT_ENV_ID = 'he02-d8gebzv050ed6c4ef-d350b93bf';
const ASSET_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'win32-x64', upstreamName: 'yt-dlp.exe', localName: 'yt-dlp.exe' }),
  Object.freeze({ key: 'darwin-arm64', upstreamName: 'yt-dlp_macos', localName: 'yt-dlp' }),
  Object.freeze({ key: 'darwin-x64', upstreamName: 'yt-dlp_macos', localName: 'yt-dlp' }),
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function parseArgs(args) {
  const result = { execute: false, environmentId: DEFAULT_ENV_ID, tcbPath: 'tcb' };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--execute') result.execute = true;
    else if (value === '--env') result.environmentId = String(args[++index] || '');
    else if (value === '--tcb') result.tcbPath = String(args[++index] || '');
    else throw new Error(`unsupported argument: ${value}`);
  }
  if (!/^[-a-z0-9]+$/i.test(result.environmentId)) throw new Error('invalid CloudBase environment id');
  return result;
}

async function fetchBytes(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json,application/octet-stream;q=0.9,*/*;q=0.1',
      'User-Agent': 'wechat-inbox-sync-component-mirror',
    },
  });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function parseOfficialChecksums(text) {
  const checksums = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) checksums.set(match[2].trim(), match[1].toLowerCase());
  }
  return checksums;
}

async function fetchOfficialRelease(fetchBytesImpl = fetchBytes) {
  const release = JSON.parse((await fetchBytesImpl(UPSTREAM_RELEASE_URL)).toString('utf8'));
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const byName = new Map(assets.map((asset) => [asset && asset.name, asset]));
  const checksumAsset = byName.get('SHA2-256SUMS');
  if (!checksumAsset || !checksumAsset.browser_download_url) throw new Error('official yt-dlp SHA2-256SUMS is missing');
  const checksums = parseOfficialChecksums((await fetchBytesImpl(checksumAsset.browser_download_url)).toString('utf8'));
  const selected = [];
  for (const definition of ASSET_DEFINITIONS) {
    const upstream = byName.get(definition.upstreamName);
    const expectedSha256 = checksums.get(definition.upstreamName);
    if (!upstream || !upstream.browser_download_url || !expectedSha256) {
      throw new Error(`official yt-dlp asset/checksum missing: ${definition.upstreamName}`);
    }
    const bytes = await fetchBytesImpl(upstream.browser_download_url);
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`official yt-dlp SHA-256 mismatch: ${definition.upstreamName}`);
    }
    selected.push({ ...definition, bytes, sha256: actualSha256 });
  }
  return { tagName: String(release.tag_name || ''), selected };
}

function buildManifest(release) {
  const assets = {};
  for (const asset of release.selected) {
    const remotePath = `yt-dlp/by-sha256/${asset.sha256}/${asset.localName}`;
    assets[asset.key] = {
      url: `${CDN_BASE_URL}/${remotePath}`,
      sha256: asset.sha256,
    };
  }
  return {
    schemaVersion: 1,
    upstream: 'yt-dlp',
    version: release.tagName,
    generatedAt: new Date().toISOString(),
    assets,
  };
}

function quotePowerShellLiteral(value) {
  const text = String(value || '');
  if (/[\r\n]/.test(text)) throw new Error('unsafe CloudBase command argument');
  return `'${text.replace(/'/g, "''")}'`;
}

function getTcbInvocation(tcbPath, args, platform = process.platform) {
  const command = String(tcbPath || '').trim();
  if (platform === 'win32' && /\.cmd$/i.test(command)) {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `& ${quotePowerShellLiteral(command)} ${(Array.isArray(args) ? args : []).map(quotePowerShellLiteral).join(' ')}`,
      ],
    };
  }
  return { command, args: Array.isArray(args) ? args : [] };
}

function runTcb(tcbPath, args) {
  const invocation = getTcbInvocation(tcbPath, args);
  const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`CloudBase command failed: ${[result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 600)}`);
}

async function verifyPublicObject(url, expectedSha256) {
  const actual = sha256(await fetchBytes(url));
  if (actual !== expectedSha256) throw new Error(`public CDN hash mismatch: ${url}`);
}

async function executeMirror(release, options) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-douyin-resolver-'));
  try {
    for (const asset of release.selected) {
      const localPath = path.join(stagingRoot, asset.localName === 'yt-dlp.exe'
        ? `${asset.key}-yt-dlp.exe`
        : `${asset.key}-yt-dlp`);
      fs.writeFileSync(localPath, asset.bytes, { mode: 0o700 });
      const remotePath = `yt-dlp/by-sha256/${asset.sha256}/${asset.localName}`;
      runTcb(options.tcbPath, ['hosting', 'deploy', localPath, remotePath, '-e', options.environmentId]);
      await verifyPublicObject(`${CDN_BASE_URL}/${remotePath}?release_check=${Date.now()}`, asset.sha256);
    }
    const manifestBytes = Buffer.from(`${JSON.stringify(buildManifest(release), null, 2)}\n`, 'utf8');
    const manifestPath = path.join(stagingRoot, 'latest.json');
    fs.writeFileSync(manifestPath, manifestBytes);
    // Publish this mutable pointer only after every immutable object is online and verified.
    runTcb(options.tcbPath, ['hosting', 'deploy', manifestPath, 'yt-dlp/latest.json', '-e', options.environmentId]);
    await verifyPublicObject(`${CDN_BASE_URL}/yt-dlp/latest.json?release_check=${Date.now()}`, sha256(manifestBytes));
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const release = await fetchOfficialRelease();
  const manifest = buildManifest(release);
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  }
  await executeMirror(release, options);
  process.stdout.write(`yt-dlp ${release.tagName} mirrored and verified\n`);
  return manifest;
}

module.exports = {
  ASSET_DEFINITIONS,
  CDN_BASE_URL,
  DEFAULT_ENV_ID,
  UPSTREAM_RELEASE_URL,
  buildManifest,
  fetchOfficialRelease,
  getTcbInvocation,
  parseArgs,
  parseOfficialChecksums,
  sha256,
  main,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`DOUYIN_RESOLVER_MIRROR_FAILED: ${error.message || error}\n`);
    process.exitCode = 1;
  });
}
