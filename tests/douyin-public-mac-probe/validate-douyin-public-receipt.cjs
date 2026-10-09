'use strict';

const fs = require('node:fs');

const HASH = /^[a-f0-9]{64}$/i;
const TOKEN = /^[A-Za-z0-9_.:-]{1,120}$/;
const FORBIDDEN_KEYS = new Set([
  'filePath', 'notePath', 'title', 'message', 'stdout', 'stderr', 'body',
  'headers', 'cookie', 'cookies', 'content', 'transcriptText', 'raw',
  'inputPath', 'outputPath', 'tempWorkDir', 'privateRoot', 'vaultRoot',
  'mediaUrl', 'url'
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function walk(value, key = '') {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, key));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(childKey)) fail(`FORBIDDEN_KEY_${childKey}`);
      walk(childValue, childKey);
    }
    return;
  }
  if (typeof value !== 'string') return;
  if (key.endsWith('Sha256') && value && !HASH.test(value)) fail('INVALID_HASH');
  if (value.includes('://') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\\')) {
    fail('PRIVATE_PATH_OR_URL');
  }
  if (value && !TOKEN.test(value)) fail('FREE_TEXT');
}

function isError(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => ['code', 'browserCode', 'channelsStage', 'asrStage', 'cleanupStatus', 'reason', 'status', 'statusCode', 'exitCode', 'timedOut'].includes(key));
}

function validateReceiptObject(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('RECEIPT_NOT_OBJECT');
  walk(receipt);
  if (receipt.schemaVersion !== 1 || receipt.harness !== 'douyin-public-mac-probe') fail('SCHEMA_MISMATCH');
  if (!TOKEN.test(String(receipt.runId || '')) || !HASH.test(String(receipt.sourceUrlSha256 || ''))) fail('IDENTITY_HASH_MISSING');
  const runtime = receipt.runtime;
  if (!runtime || runtime.platform !== 'darwin' || runtime.arch !== 'x64'
    || runtime.isolatedUserData !== true || runtime.anonymousSession !== true
    || runtime.importedUserCookies !== false || runtime.protocolInterception !== false
    || runtime.apiFixture !== false || runtime.mediaStub !== false || runtime.cloudAsr !== false
    || runtime.rawMediaRetained !== false || runtime.rawTranscriptRetained !== false) fail('RUNTIME_PRIVACY_MISMATCH');
  const cleanup = receipt.cleanup;
  if (!cleanup || cleanup.privateRootRemoved !== true || cleanup.receiptOnly !== true) fail('PRIVATE_CLEANUP_MISSING');
  if (typeof receipt.candidateBundleLoaded !== 'boolean' || !isError(receipt.setupError)) fail('ERROR_SCHEMA_MISMATCH');
  if (!receipt.hydrate || !TOKEN.test(String(receipt.hydrate.status || '')) || !isError(receipt.hydrate.error)) fail('HYDRATE_SCHEMA_MISMATCH');
  if (!receipt.fallbackBuild || !TOKEN.test(String(receipt.fallbackBuild.status || '')) || !isError(receipt.fallbackBuild.error)) fail('FALLBACK_SCHEMA_MISMATCH');
  if (!receipt.writeRecord || !TOKEN.test(String(receipt.writeRecord.status || '')) || !isError(receipt.writeRecord.error)) fail('WRITE_SCHEMA_MISMATCH');
  if (!receipt.mediaProbe || !TOKEN.test(String(receipt.mediaProbe.status || ''))) fail('MEDIA_SCHEMA_MISMATCH');
  if (!receipt.nativeComparison || !TOKEN.test(String(receipt.nativeComparison.status || ''))
    || !Array.isArray(receipt.nativeComparison.cases)) fail('NATIVE_SCHEMA_MISMATCH');
  if (!receipt.artifactVault || receipt.artifactVault.isolated !== true) fail('VAULT_ISOLATION_MISSING');
  return true;
}

function validateSuccessfulReceiptObject(receipt) {
  validateReceiptObject(receipt);
  if (receipt.setupError !== null || receipt.candidateBundleLoaded !== true) fail('SETUP_FAILED');
  if (!HASH.test(String(receipt.candidateBundleSha256 || '')) || !TOKEN.test(String(receipt.pluginVersion || ''))) fail('PLUGIN_IDENTITY_MISSING');
  if (!receipt.hydrate || receipt.hydrate.status !== 'returned') fail('HYDRATE_FAILED');
  const media = receipt.mediaProbe;
  if (!media || media.status !== 'success' || !HASH.test(String(media.sha256 || ''))
    || !(Number(media.bytes) > 0) || !(Number(media.durationSeconds) > 0)) fail('MEDIA_PROBE_FAILED');
  const native = receipt.nativeComparison;
  if (!native || native.status !== 'success' || !Array.isArray(native.cases) || native.cases.length !== 2) fail('NATIVE_COMPARISON_FAILED');
  for (const [expected, item] of [['legacy', native.cases[0]], ['candidate-cpu', native.cases[1]]]) {
    if (!item || item.label !== expected || item.status !== 'success' || !HASH.test(String(item.engineSha256 || ''))
      || !HASH.test(String(item.modelSha256 || '')) || item.transcriptPresent !== true || !(Number(item.transcriptChars) > 0)) fail('NATIVE_CASE_FAILED');
  }
  const identity = receipt.sourceIdentityEvidence;
  if (!identity || !(Number(identity.targetDetailCallbacks) > 0) || !(Number(identity.targetDetailIdMatches) > 0)
    || identity.selectedMediaExactIdentityProven !== true) fail('TARGET_IDENTITY_UNPROVEN');
  if (!Array.isArray(receipt.mediaDownloadEvidence) || !receipt.mediaDownloadEvidence.some((item) =>
    item && item.returnedFileObserved === true && HASH.test(String(item.returnedFileSha256 || '')) && Number(item.returnedFileBytes) > 0)) {
    fail('MEDIA_DOWNLOAD_UNPROVEN');
  }
  const observedMediaHashes = receipt.mediaDownloadEvidence
    .filter((item) => item && item.returnedFileObserved === true && HASH.test(String(item.returnedFileSha256 || '')))
    .map((item) => item.returnedFileSha256);
  if (!observedMediaHashes.includes(media.sha256)) fail('NATIVE_MEDIA_HASH_MISMATCH');
  if (new Set(observedMediaHashes).size !== 1) fail('MULTIPLE_MEDIA_INPUTS_UNPROVEN');
  const write = receipt.writeRecord;
  if (!write || write.status !== 'success' || write.committed !== true || write.sourceUrlPresent !== true
    || write.transcriptionPresent !== true || !HASH.test(String(write.noteSha256 || '')) || !(Number(write.noteBytes) > 0)) fail('PRODUCT_WRITE_UNPROVEN');
  if (!receipt.transcript || receipt.transcript.present !== true || !(Number(receipt.transcript.chars) > 0)) fail('TRANSCRIPT_SUMMARY_MISSING');
  if (!receipt.artifactVault || receipt.artifactVault.isolated !== true || receipt.artifactVault.vaultRootName !== 'artifact-vault') fail('VAULT_ISOLATION_MISSING');
  return true;
}

function validateReceiptFile(filePath) {
  const receipt = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return validateReceiptObject(receipt);
}

if (require.main === module) {
  try {
    const filePath = process.argv[2];
    if (!filePath) fail('RECEIPT_PATH_MISSING');
    const receipt = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (process.argv.includes('--require-success')) validateSuccessfulReceiptObject(receipt);
    else validateReceiptObject(receipt);
    process.stdout.write('DOUYIN_PUBLIC_RECEIPT_OK\n');
  } catch (_) {
    process.stderr.write('DOUYIN_PUBLIC_RECEIPT_INVALID\n');
    process.exitCode = 1;
  }
}

module.exports = { validateReceiptObject, validateSuccessfulReceiptObject, validateReceiptFile };
