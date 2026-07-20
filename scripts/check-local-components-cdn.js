#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {
  ASSET_DEFINITIONS,
  assertManifestMatches,
  buildManifest,
  normalizeTextBytes,
  serializeManifest,
  sha256Hex,
  validateCanonicalManifest,
} = require('./local-component-manifest-core');
const {
  resolveContainedSourcePath,
} = require('./update-local-components-manifest');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'obsidian-plugin', 'wechat-inbox-sync');
const MANIFEST_PATH = path.join(PLUGIN_ROOT, 'local-components-manifest.json');
const PUBLIC_MANIFEST_PATH = 'local-components/manifest.json';
const DEFAULT_CDN_BASE_URL = (
  'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com'
);
const DEFAULT_PYTHON_RUNTIME_BASE_URL = (
  `${DEFAULT_CDN_BASE_URL}/local-python/python-build-standalone/releases/download/20260623`
);
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RUNTIME_TIMEOUT_MS = 120000;
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_BACKOFF_MS = 250;
const PYTHON_RUNTIMES = Object.freeze([
  Object.freeze({
    fileName: 'cpython-3.12.13+20260623-x86_64-pc-windows-msvc-install_only.tar.gz',
    sha256: 'C6AF85BB83D5158C9FF71F50DFAD467853D1CD236F932B144E87E26E2EA2A83E',
  }),
  Object.freeze({
    fileName: 'cpython-3.12.13+20260623-aarch64-apple-darwin-install_only.tar.gz',
    sha256: '3724AA4DAFB5F7B6C2CF98E89914E4248DC6BD2FE40407DF4A2D73DE99615F16',
  }),
  Object.freeze({
    fileName: 'cpython-3.12.13+20260623-x86_64-apple-darwin-install_only.tar.gz',
    sha256: '7C57FDD1FA675190093700EB0D8E7117E1F9EAE7C30A46DEA5F8D5266BCFC791',
  }),
]);
const USAGE = `Usage: node scripts/check-local-components-cdn.js [option]

Options:
  --skip-external-runtimes  Test-only: skip the separately hosted pinned Python runtimes
  --help                    Show this help
`;

function normalizeBaseUrl(value, label) {
  const normalized = String(value || '').replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL`);
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password
  ) {
    throw new TypeError(`${label} must be an HTTP(S) root URL without query or fragment`);
  }
  return normalized;
}

function parseTimeout(value) {
  const timeoutMs = Number(value ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new TypeError('LOCAL_COMPONENTS_FETCH_TIMEOUT_MS must be an integer from 1 to 120000');
  }
  return timeoutMs;
}

function parseRuntimeTimeout(value) {
  const timeoutMs = Number(value ?? DEFAULT_RUNTIME_TIMEOUT_MS);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new TypeError('runtime fetch timeout must be an integer from 1 to 120000');
  }
  return timeoutMs;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function publicUrl(baseUrl, publicPath) {
  const url = new URL(publicPath, `${baseUrl}/`);
  url.searchParams.set('release_check', `${Date.now()}-${randomUUID()}`);
  return url.href;
}

async function fetchBytes(url, {
  fetchImpl = globalThis.fetch,
  label = url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is unavailable');
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, parseTimeout(timeoutMs));
  try {
    const response = await fetchImpl(url, {
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      signal: controller.signal,
    });
    if (!response || typeof response.ok !== 'boolean') {
      throw new Error(`${label}: fetch returned an invalid response`);
    }
    if (!response.ok) {
      throw new Error(`${label}: CDN returned HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (timedOut) {
      throw new Error(`${label}: timed out after ${timeoutMs}ms`);
    }
    if (error.message?.startsWith(`${label}:`)) throw error;
    throw new Error(`${label}: fetch failed: ${error.message || error}`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytesWithRetry(url, {
  retries = DEFAULT_RETRY_COUNT,
  backoffMs = DEFAULT_RETRY_BACKOFF_MS,
  sleepImpl = sleep,
  ...fetchOptions
} = {}) {
  if (!Number.isInteger(retries) || retries < 0 || retries > DEFAULT_RETRY_COUNT) {
    throw new TypeError(`fetch retries must be an integer from 0 to ${DEFAULT_RETRY_COUNT}`);
  }
  if (!Number.isInteger(backoffMs) || backoffMs < 0 || backoffMs > 30000) {
    throw new TypeError('fetch retry backoff must be an integer from 0 to 30000ms');
  }
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchBytes(url, fetchOptions);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleepImpl(backoffMs * (2 ** attempt));
      }
    }
  }
  throw lastError;
}

function readCanonicalReleaseState({
  pluginRoot = PLUGIN_ROOT,
  manifestPath = MANIFEST_PATH,
} = {}) {
  let committedManifestBytes;
  let manifest;
  try {
    committedManifestBytes = fs.readFileSync(manifestPath);
    manifest = JSON.parse(committedManifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`cannot read committed local component manifest: ${error.message}`);
  }
  validateCanonicalManifest(manifest);
  const canonicalManifestBytes = Buffer.from(serializeManifest(manifest), 'utf8');
  if (!committedManifestBytes.equals(canonicalManifestBytes)) {
    throw new Error('committed local component manifest is not in exact canonical form');
  }

  const sourceBytesByPath = new Map();
  const rebuiltManifest = buildManifest(ASSET_DEFINITIONS.map((definition) => {
    const sourcePath = resolveContainedSourcePath(pluginRoot, definition.sourcePath);
    const contents = fs.readFileSync(sourcePath);
    const canonicalBytes = normalizeTextBytes(contents);
    sourceBytesByPath.set(definition.sourcePath, canonicalBytes);
    return { ...definition, contents };
  }));
  assertManifestMatches(manifest, rebuiltManifest);
  return {
    committedManifestBytes,
    manifest,
    sourceBytesByPath,
  };
}

function assertExpectedBytes(label, expectedBytes, remoteBytes, expectedHash) {
  const normalizedExpectedHash = String(expectedHash).toLowerCase();
  const remoteHash = sha256Hex(remoteBytes);
  if (remoteHash !== normalizedExpectedHash || !expectedBytes.equals(remoteBytes)) {
    throw new Error(
      `${label}: byte/hash mismatch (expected ${normalizedExpectedHash}, remote ${remoteHash})`,
    );
  }
  return remoteHash;
}

async function main({
  cdnBaseUrl = process.env.LOCAL_COMPONENTS_CDN_BASE_URL || DEFAULT_CDN_BASE_URL,
  pythonRuntimeBaseUrl = (
    process.env.LOCAL_PYTHON_CDN_BASE_URL || DEFAULT_PYTHON_RUNTIME_BASE_URL
  ),
  timeoutMs = process.env.LOCAL_COMPONENTS_FETCH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
  runtimeTimeoutMs = (
    process.env.LOCAL_PYTHON_FETCH_TIMEOUT_MS || DEFAULT_RUNTIME_TIMEOUT_MS
  ),
  retryCount = DEFAULT_RETRY_COUNT,
  retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS,
  skipExternalRuntimes = false,
  pythonRuntimes = PYTHON_RUNTIMES,
  fetchImpl = globalThis.fetch,
  log = console.log,
  pluginRoot = PLUGIN_ROOT,
  manifestPath = MANIFEST_PATH,
} = {}) {
  const normalizedCdnBaseUrl = normalizeBaseUrl(cdnBaseUrl, 'LOCAL_COMPONENTS_CDN_BASE_URL');
  const normalizedTimeout = parseTimeout(timeoutMs);
  const normalizedRuntimeTimeout = parseRuntimeTimeout(runtimeTimeoutMs);
  const releaseState = readCanonicalReleaseState({ pluginRoot, manifestPath });

  for (const asset of releaseState.manifest.assets) {
    const expectedBytes = releaseState.sourceBytesByPath.get(asset.sourcePath);
    for (const publicPath of [asset.immutablePath, asset.compatibilityAlias]) {
      const remoteBytes = await fetchBytesWithRetry(publicUrl(normalizedCdnBaseUrl, publicPath), {
        fetchImpl,
        label: publicPath,
        timeoutMs: normalizedTimeout,
        retries: retryCount,
        backoffMs: retryBackoffMs,
      });
      const remoteHash = assertExpectedBytes(
        publicPath,
        expectedBytes,
        remoteBytes,
        asset.sha256,
      );
      log(`${publicPath}: OK ${remoteHash}`);
    }
  }

  const remoteManifestBytes = await fetchBytesWithRetry(
    publicUrl(normalizedCdnBaseUrl, PUBLIC_MANIFEST_PATH),
    {
      fetchImpl,
      label: PUBLIC_MANIFEST_PATH,
      timeoutMs: normalizedTimeout,
      retries: retryCount,
      backoffMs: retryBackoffMs,
    },
  );
  if (!releaseState.committedManifestBytes.equals(remoteManifestBytes)) {
    throw new Error(`${PUBLIC_MANIFEST_PATH}: exact committed-byte mismatch`);
  }
  let remoteManifest;
  try {
    remoteManifest = JSON.parse(remoteManifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${PUBLIC_MANIFEST_PATH}: invalid JSON: ${error.message}`);
  }
  validateCanonicalManifest(remoteManifest);
  log(`${PUBLIC_MANIFEST_PATH}: OK exact committed bytes`);

  if (!skipExternalRuntimes) {
    const normalizedRuntimeBaseUrl = normalizeBaseUrl(
      pythonRuntimeBaseUrl,
      'LOCAL_PYTHON_CDN_BASE_URL',
    );
    for (const runtime of pythonRuntimes) {
      const runtimePath = runtime.fileName;
      const remoteBytes = await fetchBytesWithRetry(
        publicUrl(normalizedRuntimeBaseUrl, runtimePath),
        {
        fetchImpl,
        label: runtime.fileName,
        timeoutMs: normalizedRuntimeTimeout,
        retries: retryCount,
        backoffMs: retryBackoffMs,
        },
      );
      const remoteHash = sha256Hex(remoteBytes).toUpperCase();
      if (remoteHash !== runtime.sha256) {
        throw new Error(
          `${runtime.fileName}: CDN runtime hash mismatch `
          + `(expected ${runtime.sha256}, remote ${remoteHash})`,
        );
      }
      log(`${runtime.fileName}: OK ${remoteHash}`);
    }
  }

  log('Local component CDN verification passed.');
}

function parseCliArgs(args) {
  if (args.length === 0) return { skipExternalRuntimes: false };
  if (args.length === 1 && args[0] === '--skip-external-runtimes') {
    return { skipExternalRuntimes: true };
  }
  if (args.length === 1 && args[0] === '--help') return { help: true };
  throw new TypeError(`Invalid arguments.\n${USAGE}`);
}

async function runCli(args = process.argv.slice(2), {
  failurePrefix = 'LOCAL_COMPONENTS_CDN_CHECK_FAILED',
} = {}) {
  try {
    const options = parseCliArgs(args);
    if (options.help) {
      process.stdout.write(USAGE);
      return 0;
    }
    await main(options);
    return 0;
  } catch (error) {
    process.stderr.write(`${failurePrefix}: ${error.message || error}\n`);
    return 1;
  }
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  DEFAULT_CDN_BASE_URL,
  DEFAULT_PYTHON_RUNTIME_BASE_URL,
  DEFAULT_RETRY_COUNT,
  DEFAULT_RETRY_BACKOFF_MS,
  DEFAULT_RUNTIME_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  MANIFEST_PATH,
  PUBLIC_MANIFEST_PATH,
  PYTHON_RUNTIMES,
  assertExpectedBytes,
  fetchBytes,
  fetchBytesWithRetry,
  main,
  normalizeBaseUrl,
  parseCliArgs,
  parseRuntimeTimeout,
  publicUrl,
  readCanonicalReleaseState,
  runCli,
};
