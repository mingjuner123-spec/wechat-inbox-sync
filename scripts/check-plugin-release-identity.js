'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const {
  assertProbeCompleted,
  assertZipMatchesExpected,
  parseZipEntries,
  validateLocalReleaseSnapshot,
  validateReleaseLookup,
  validateReleaseMetadata,
  validateReleasePayload,
} = require('./plugin-release-identity-core');
const { validateVersionTag } = require('./release-source-guard-core');

const REPO_ROOT = path.resolve(__dirname, '..');
const OWNER = 'mingjuner123-spec';
const REPOSITORY = 'wechat-inbox-sync';
const API_ORIGIN = 'https://api.github.com';
const GITHUB_API_TIMEOUT_MS = 20000;
const GIT_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);
const PLUGIN_PREFIX = 'obsidian-plugin/wechat-inbox-sync/';
const REQUIRED_ZIP_ROOTS = new Set([
  'main.js',
  'manifest.json',
  'styles.css',
  'versions.json',
  'README.md',
  'LICENSE',
]);
const USAGE = `Usage:
  node scripts/check-plugin-release-identity.js --prepublish --tag X.Y.Z
  node scripts/check-plugin-release-identity.js --postpublish --tag X.Y.Z
`;

function errorDetail(error) {
  const stderr = Buffer.isBuffer(error.stderr)
    ? error.stderr.toString('utf8').trim()
    : typeof error.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = Buffer.isBuffer(error.stdout)
    ? error.stdout.toString('utf8').trim()
    : typeof error.stdout === 'string' ? error.stdout.trim() : '';
  return stderr || stdout || error.message || String(error);
}

function runGit(args, label) {
  try {
    return childProcess.execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
    });
  } catch (error) {
    if (error && (error.code === 'ETIMEDOUT' || error.errno === 'ETIMEDOUT')) {
      throw new Error(`Git probe for ${label} timed out`);
    }
    throw new Error(`Git probe for ${label} failed: ${errorDetail(error)}`);
  }
}

function readFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relativePath.split('/')));
}

function readMetadata(tag) {
  return validateReleaseMetadata({
    tag,
    rootManifestBytes: readFile('manifest.json'),
    pluginManifestBytes: readFile(`${PLUGIN_PREFIX}manifest.json`),
    rootVersionsBytes: readFile('versions.json'),
    pluginVersionsBytes: readFile(`${PLUGIN_PREFIX}versions.json`),
  });
}

function collectLocalSnapshot(phase, tag) {
  return validateLocalReleaseSnapshot({
    phase,
    tag,
    statusOutput: runGit(['status', '--porcelain', '--untracked-files=all'], 'clean status'),
    headOutput: runGit(['rev-parse', 'HEAD'], 'local HEAD'),
    remoteMainOutput: runGit(['ls-remote', 'origin', 'refs/heads/main'], 'remote main'),
    tagTypeOutput: runGit(['cat-file', '-t', `refs/tags/${tag}`], `annotated tag ${tag}`),
    tagCommitOutput: runGit(['rev-parse', `refs/tags/${tag}^{}`], `peeled tag ${tag}`),
    remoteTagOutput: runGit(
      ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
      `remote tag ${tag}`,
    ),
  });
}

function validateDownloadUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (error) {
    throw new Error(`invalid GitHub asset download URL: ${error.message}`);
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error(`untrusted GitHub asset download host: ${parsed.hostname}`);
  }
  return parsed;
}

function httpsGetBuffer(url, {
  accept = 'application/vnd.github+json',
  redirectsRemaining = MAX_REDIRECTS,
} = {}) {
  const parsed = url instanceof URL ? url : new URL(url);
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: {
        Accept: accept,
        'Cache-Control': 'no-cache',
        'User-Agent': 'wechat-inbox-sync-release-identity',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (response) => {
      const statusCode = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        response.resume();
        if (redirectsRemaining <= 0 || !response.headers.location) {
          reject(new Error('GitHub download redirect limit exceeded'));
          return;
        }
        let next;
        try {
          next = validateDownloadUrl(new URL(response.headers.location, parsed).toString());
        } catch (error) {
          reject(error);
          return;
        }
        httpsGetBuffer(next, { accept, redirectsRemaining: redirectsRemaining - 1 })
          .then(resolve, reject);
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        statusCode,
        body: Buffer.concat(chunks),
      }));
    });
    request.setTimeout(GITHUB_API_TIMEOUT_MS, () => {
      request.destroy(Object.assign(new Error('GitHub request timed out'), { code: 'ETIMEDOUT' }));
    });
    request.on('error', reject);
  });
}

async function lookupRelease(tag, sampleIndex) {
  const nonce = `${Date.now()}-${sampleIndex}`;
  const url = new URL(
    `/repos/${OWNER}/${REPOSITORY}/releases/tags/${encodeURIComponent(tag)}`,
    API_ORIGIN,
  );
  url.searchParams.set('release_identity_probe', nonce);
  try {
    return await httpsGetBuffer(url);
  } catch (error) {
    assertProbeCompleted({
      timedOut: error && error.code === 'ETIMEDOUT',
      error: error && error.code === 'ETIMEDOUT' ? null : error,
      label: 'GitHub release lookup',
    });
    throw error;
  }
}

function resolveReleaseTargetCommit(release, snapshot, tag) {
  if (release.target_commitish === snapshot.remoteMain
      || release.target_commitish === 'main'
      || release.target_commitish === tag) {
    return snapshot.remoteMain;
  }
  return release.target_commitish;
}

function requiredAssets(tag) {
  return [
    'main.js',
    'manifest.json',
    'styles.css',
    'versions.json',
    `wechat-inbox-sync-${tag}.zip`,
  ];
}

function gitShowBytes(tag, relativePath) {
  try {
    return childProcess.execFileSync(
      'git',
      ['show', `refs/tags/${tag}:${PLUGIN_PREFIX}${relativePath}`],
      {
        cwd: REPO_ROOT,
        encoding: null,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'Never',
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: GIT_TIMEOUT_MS,
      },
    );
  } catch (error) {
    throw new Error(`cannot read ${relativePath} from tag ${tag}: ${errorDetail(error)}`);
  }
}

function expectedZipEntries(tag) {
  const listing = runGit(
    ['ls-tree', '-r', '--name-only', `refs/tags/${tag}`, '--', PLUGIN_PREFIX],
    `tag ${tag} plugin tree`,
  );
  const names = listing.split(/\r?\n/).filter(Boolean)
    .filter((name) => name.startsWith(PLUGIN_PREFIX))
    .map((name) => name.slice(PLUGIN_PREFIX.length))
    .filter((name) => REQUIRED_ZIP_ROOTS.has(name)
      || name.startsWith('local-asr/')
      || name.startsWith('local-ocr/'))
    .sort();
  if (names.length === 0) {
    throw new Error(`tag ${tag} contains no expected plugin ZIP entries`);
  }
  return new Map(names.map((name) => [name, gitShowBytes(tag, name)]));
}

async function verifyPublishedAssetBytes(release, tag) {
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const name of ['main.js', 'manifest.json', 'styles.css', 'versions.json']) {
    const asset = assets.get(name);
    const url = validateDownloadUrl(asset.browser_download_url);
    const response = await httpsGetBuffer(url, { accept: 'application/octet-stream' });
    if (response.statusCode !== 200) {
      throw new Error(`Release asset ${name} returned HTTP ${response.statusCode}`);
    }
    const expected = gitShowBytes(tag, name);
    if (!response.body.equals(expected)) {
      throw new Error(`Release asset byte mismatch for ${name}`);
    }
  }
  const zipName = `wechat-inbox-sync-${tag}.zip`;
  const zipUrl = validateDownloadUrl(assets.get(zipName).browser_download_url);
  const zipResponse = await httpsGetBuffer(zipUrl, { accept: 'application/octet-stream' });
  if (zipResponse.statusCode !== 200) {
    throw new Error(`Release asset ${zipName} returned HTTP ${zipResponse.statusCode}`);
  }
  assertZipMatchesExpected(parseZipEntries(zipResponse.body), expectedZipEntries(tag));
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args.length !== 3 || args[1] !== '--tag'
      || (args[0] !== '--prepublish' && args[0] !== '--postpublish')) {
    throw new Error(`invalid arguments\n${USAGE}`);
  }
  validateVersionTag(args[2]);
  return {
    help: false,
    phase: args[0].slice(2),
    tag: args[2],
  };
}

async function runPrepublish(tag) {
  readMetadata(tag);
  const snapshot = collectLocalSnapshot('prepublish', tag);
  const lookup = await lookupRelease(tag, 1);
  validateReleaseLookup({ phase: 'prepublish', ...lookup });
  process.stdout.write(
    `Plugin prepublish identity passed: ${tag} is absent remotely and local annotated tag points to ${snapshot.head}.\n`,
  );
}

async function runPostpublish(tag) {
  readMetadata(tag);
  const expected = requiredAssets(tag);
  let lastRelease = null;
  let finalCommit = null;
  for (let sample = 1; sample <= 3; sample += 1) {
    const snapshot = collectLocalSnapshot('postpublish', tag);
    const lookup = await lookupRelease(tag, sample);
    const release = validateReleaseLookup({ phase: 'postpublish', ...lookup });
    const resolvedTarget = resolveReleaseTargetCommit(release, snapshot, tag);
    lastRelease = validateReleasePayload({
      ...release,
      target_commitish: resolvedTarget,
    }, {
      tag,
      expectedCommit: snapshot.remoteMain,
      expectedAssets: expected,
      nowMs: Date.now(),
    });
    finalCommit = snapshot.remoteMain;
  }
  await verifyPublishedAssetBytes(lastRelease, tag);
  process.stdout.write(
    `Plugin postpublish identity passed: ${tag}, main, peeled tag, Release, assets, and ZIP all match ${finalCommit}.\n`,
  );
}

async function main(args = process.argv.slice(2)) {
  const parsed = parseArguments(args);
  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (parsed.phase === 'prepublish') {
    await runPrepublish(parsed.tag);
    return;
  }
  await runPostpublish(parsed.tag);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Plugin release identity failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArguments,
  runPostpublish,
  runPrepublish,
};
