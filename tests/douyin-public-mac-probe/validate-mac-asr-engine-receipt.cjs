'use strict';

const fs = require('node:fs');

const HASH = /^[a-f0-9]{64}$/i;
const TOKEN = /^[A-Za-z0-9_.:-]{1,120}$/;
const FORBIDDEN_KEYS = new Set([
  'url', 'fixtureUrl', 'path', 'filePath', 'inputPath', 'outputPath',
  'privateRoot', 'transcriptText', 'stdout', 'stderr', 'raw', 'content',
]);
const ERROR_KEYS = new Set(['code', 'reason', 'exitCode', 'statusCode', 'timedOut']);
const CASE_KEYS = new Set([
  'label', 'inputSha256', 'engineSha256', 'modelSha256', 'wrapperSha256',
  'status', 'exitCode', 'signal', 'timedOut', 'transcriptPresent',
  'transcriptChars', 'wallMs', 'failureCode',
]);
const MEDIA_KEYS = new Set(['status', 'sha256', 'bytes', 'durationSeconds', 'probeMethod', 'exitCode', 'signal']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function walk(value, key = '', allowed = null) {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, key));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(childKey)) fail(`FORBIDDEN_KEY_${childKey}`);
      if (allowed && !allowed.has(childKey)) fail(`UNKNOWN_KEY_${childKey}`);
      walk(childValue, childKey);
    }
    return;
  }
  if (typeof value === 'string') {
    if (key.endsWith('Sha256') && value && !HASH.test(value)) fail('INVALID_HASH');
    if (value.includes('://') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.includes('\\')) fail('PRIVATE_PATH_OR_URL');
    if (value && !TOKEN.test(value)) fail('FREE_TEXT');
  }
}

function isSafeError(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some((key) => !ERROR_KEYS.has(key))) return false;
  if (value.code !== undefined && !TOKEN.test(String(value.code))) return false;
  if (value.reason !== undefined && !TOKEN.test(String(value.reason))) return false;
  if (value.timedOut !== undefined && typeof value.timedOut !== 'boolean') return false;
  return true;
}

function validateReceiptObject(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('RECEIPT_NOT_OBJECT');
  walk(receipt, '', new Set([
    'schemaVersion', 'harness', 'runId', 'fixtureSha256', 'expectedFixtureSha256',
    'fixtureBytes', 'candidateBundleSha256', 'expectedCandidateBundleSha256',
    'pluginVersion', 'candidateIdentityMatched', 'fixtureIdentityMatched',
    'productionWrapperSha256', 'mediaProbe', 'nativeComparison', 'setupError',
    'runtime', 'cleanup',
  ]));
  if (receipt.schemaVersion !== 1 || receipt.harness !== 'mac-intel-asr-engine-compare') fail('SCHEMA_MISMATCH');
  for (const key of ['runId', 'pluginVersion']) if (!TOKEN.test(String(receipt[key] || ''))) fail(`MISSING_${key}`);
  for (const key of ['fixtureSha256', 'expectedFixtureSha256', 'candidateBundleSha256', 'expectedCandidateBundleSha256', 'productionWrapperSha256']) {
    if (!HASH.test(String(receipt[key] || ''))) fail(`MISSING_${key}`);
  }
  if (typeof receipt.candidateIdentityMatched !== 'boolean' || typeof receipt.fixtureIdentityMatched !== 'boolean') fail('IDENTITY_SCHEMA_MISMATCH');
  if (!Number.isFinite(Number(receipt.fixtureBytes)) || Number(receipt.fixtureBytes) < 0) fail('FIXTURE_SIZE_INVALID');
  if (!isSafeError(receipt.setupError)) fail('SETUP_ERROR_INVALID');
  const runtime = receipt.runtime;
  if (!runtime || runtime.platform !== 'darwin' || runtime.arch !== 'x64'
    || runtime.onlineExtraction !== false || runtime.cloudAsr !== false
    || runtime.rawFixtureRetained !== false || runtime.rawTranscriptRetained !== false) fail('RUNTIME_PRIVACY_MISMATCH');
  const cleanup = receipt.cleanup;
  if (!cleanup || cleanup.privateRootRemoved !== true || cleanup.receiptOnly !== true) fail('PRIVATE_CLEANUP_MISSING');
  const media = receipt.mediaProbe;
  if (!media || typeof media !== 'object' || Array.isArray(media)) fail('MEDIA_SCHEMA_MISMATCH');
  walk(media, '', MEDIA_KEYS);
  if (!TOKEN.test(String(media.status || '')) || !HASH.test(String(media.sha256 || ''))) fail('MEDIA_FIELDS_MISSING');
  const comparison = receipt.nativeComparison;
  if (!comparison || typeof comparison !== 'object' || !TOKEN.test(String(comparison.status || '')) || !Array.isArray(comparison.cases)) fail('COMPARISON_SCHEMA_MISMATCH');
  comparison.cases.forEach((item) => {
    if (!item || typeof item !== 'object') fail('CASE_NOT_OBJECT');
    walk(item, '', CASE_KEYS);
    if (!TOKEN.test(String(item.label || '')) || !TOKEN.test(String(item.status || ''))) fail('CASE_FIELDS_MISSING');
    if (!HASH.test(String(item.inputSha256 || '')) || !HASH.test(String(item.engineSha256 || '')) || !HASH.test(String(item.modelSha256 || ''))) fail('CASE_HASH_MISSING');
    if (item.wrapperSha256 !== undefined && !HASH.test(String(item.wrapperSha256))) fail('WRAPPER_HASH_INVALID');
    if (typeof item.transcriptPresent !== 'boolean' || !Number.isFinite(Number(item.transcriptChars))) fail('CASE_TRANSCRIPT_INVALID');
  });
  return true;
}

function validateSuccessfulReceiptObject(receipt) {
  validateReceiptObject(receipt);
  if (receipt.setupError !== null || receipt.candidateIdentityMatched !== true || receipt.fixtureIdentityMatched !== true) fail('IDENTITY_NOT_VERIFIED');
  if (receipt.mediaProbe.status !== 'success' || receipt.mediaProbe.sha256 !== receipt.fixtureSha256 || !(Number(receipt.mediaProbe.bytes) > 0) || !(Number(receipt.mediaProbe.durationSeconds) > 0)) fail('MEDIA_PROBE_FAILED');
  const comparison = receipt.nativeComparison;
  if (comparison.status !== 'success' || comparison.cases.length !== 3) fail('ENGINE_COMPARISON_FAILED');
  const labels = ['legacy', 'candidate-cpu', 'production-wrapper'];
  comparison.cases.forEach((item, index) => {
    if (item.label !== labels[index] || item.status !== 'success' || item.inputSha256 !== receipt.fixtureSha256
      || item.transcriptPresent !== true || !(Number(item.transcriptChars) > 0)) fail('ENGINE_CASE_FAILED');
  });
  if (!HASH.test(String(comparison.cases[2].wrapperSha256 || ''))) fail('PRODUCTION_WRAPPER_UNPROVEN');
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
    process.stdout.write('MAC_ASR_ENGINE_RECEIPT_OK\n');
  } catch (_) {
    process.stderr.write('MAC_ASR_ENGINE_RECEIPT_INVALID\n');
    process.exitCode = 1;
  }
}

module.exports = { validateReceiptObject, validateSuccessfulReceiptObject, validateReceiptFile };
