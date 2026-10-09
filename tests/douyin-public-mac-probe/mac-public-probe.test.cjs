'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractTranscribeScript } = require('./prepare-mac-asr-runtime.cjs');
const { validateReceiptObject, validateSuccessfulReceiptObject } = require('./validate-douyin-public-receipt.cjs');

const runnerPath = path.join(__dirname, 'mac-intel-douyin-public-runner.cjs');
const runnerSource = fs.readFileSync(runnerPath, 'utf8');
const workflowSource = fs.readFileSync(path.join(__dirname, '../../.github/workflows/douyin-public-mac-probe.yml'), 'utf8');
const expectedCandidateSha = fs.readFileSync(path.join(__dirname, 'candidate-bundle.sha256'), 'utf8').trim();
assert.match(expectedCandidateSha, /^[a-f0-9]{64}$/);
assert.equal(workflowSource.includes('plugin-baseline'), false);
assert.equal(workflowSource.includes('candidate-bundle.sha256'), true);
assert.equal(workflowSource.includes('mac-intel-asr-engine-runner.cjs'), true);
assert.equal(workflowSource.includes('audio_fixture_sha256'), true);
assert.equal(workflowSource.includes('inputs.mode == \'engine\''), true);
assert.equal(workflowSource.includes('Install pinned local Douyin resolver for online fallback'), true);
assert.equal(workflowSource.includes('https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_macos'), true);
assert.equal(workflowSource.includes('--max-filesize 37146048'), true);
assert.equal(workflowSource.includes('0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'), true);
assert.equal(workflowSource.includes('yt-dlp/latest'), false);
const onlineJobSource = workflowSource.split('\n  engine:\n')[0];
assert.equal(onlineJobSource.includes('Install pinned local Douyin resolver for online fallback'), true);
assert.equal(onlineJobSource.includes('DOUYIN_MAC_SAME_AUDIO_URL'), false);
assert.equal(runnerSource.toLowerCase().includes('powershell'), false);
assert.equal(runnerSource.toLowerCase().includes('win32'), false);
assert.equal(runnerSource.includes('credentials: \'omit\''), true);
assert.equal(runnerSource.includes("path.join(sourceRoot, 'tools', 'yt-dlp')"), true);
assert.equal(runnerSource.includes("path.join(targetRoot, 'tools', 'yt-dlp')"), true);
assert.equal(runnerSource.includes('copyFileSync(sourceExecutable, targetExecutable)'), true);
assert.equal(runnerSource.includes('copyFileSync(sourceReceipt, targetReceipt)'), true);
assert.equal(runnerSource.includes('copyVerifiedDouyinResolver(asrRoot, runtimeAsrRoot);'), true);
assert.equal(runnerSource.includes('fromPartition(`persist:douyin-public-'), true);
assert.equal(runnerSource.includes('earlyMediaProbe = probeMedia(capturedMediaPath);'), true);
assert.equal(runnerSource.includes('earlyNativeComparison = runNativeComparison('), true);
assert.equal(runnerSource.includes('const mediaProbe = earlyMediaProbe || probeMedia(capturedMediaPath);'), true);
assert.equal(runnerSource.includes('const nativeComparison = earlyNativeComparison || runNativeComparison();'), true);
assert.equal(runnerSource.indexOf('window.close()') < runnerSource.indexOf('fs.rmSync(runRoot'), true);
assert.equal(runnerSource.includes('console.log('), false);
assert.equal(runnerSource.includes('console.error('), false);
assert.equal(runnerSource.includes('candidate-real-chain'), false);

const extracted = extractTranscribeScript([
  'header',
  'cat > "$INSTALL_ROOT/transcribe.sh" <<\'SCRIPT\'',
  '#!/usr/bin/env bash',
  'WHISPER="$ROOT/bin/whisper-cli"',
  'SCRIPT',
  'footer',
  ''
].join('\r\n'));
assert.match(extracted, /^#!\/usr\/bin\/env bash\n/);
assert.match(extracted, /WHISPER="\$ROOT\/bin\/whisper-cli"/);

const hash = 'a'.repeat(64);
const receipt = {
  schemaVersion: 1,
  harness: 'douyin-public-mac-probe',
  runId: 'test-run-1',
  candidateBundleLoaded: true,
  candidateBundleSha256: hash,
  pluginVersion: '1.3.182',
  sourceUrlSha256: hash,
  sourceUrlKind: 'douyin-public-link-redacted',
  runtime: {
    electron: '39.8.3', chrome: '142.0', node: '22.0', platform: 'darwin', arch: 'x64',
    isolatedUserData: true, anonymousSession: true, importedUserCookies: false,
    protocolInterception: false, apiFixture: false, mediaStub: false, cloudAsr: false,
    rawMediaRetained: false, rawTranscriptRetained: false
  },
  setupError: null,
  hydrate: { status: 'returned', error: null, metadata: { platform: '', transcriptionStatus: 'success', transcriptionSource: 'local', conversionStatus: '', transcriptionChars: 12, markdownChars: 0, mediaCandidateCount: 1, mediaUrlPresent: true, transcriptionError: null, mediaResolutionDiagnostic: null } },
  browserExtraction: { calls: 1, rows: [{ inputKind: 'douyin-url', urlKind: 'short-or-other', mediaCount: 1, durationMs: 100, error: null }], diagnostics: [] },
  sourceIdentityEvidence: { expectedTargetIdSha256: hash, targetDetailCallbacks: 1, targetDetailIdMatches: 1, targetDetailIdPresent: 1, targetIdArgumentPresent: true, targetDetailIdSha256: [hash], targetMediaUrlHashCount: 1, selectedMediaExactIdentityProven: true },
  mediaDownloadEvidence: [{ inputUrlSha256: hash, inputUrlMatchedTargetDetail: true, returnedFileSha256: hash, returnedFileBytes: 100, returnedFileObserved: true }],
  mediaProbe: { status: 'success', sha256: hash, bytes: 100, durationSeconds: 1.2, probeMethod: 'ffmpeg-duration-fallback', exitCode: 0, signal: null },
  nativeComparison: { status: 'success', cases: [
    { label: 'legacy', status: 'success', engineSha256: hash, modelSha256: hash, preprocessExitCode: 0, preprocessSignal: null, engineExitCode: 0, engineSignal: null, timedOut: false, transcriptPresent: true, transcriptChars: 12, wallMs: 100 },
    { label: 'candidate-cpu', status: 'success', engineSha256: hash, modelSha256: hash, preprocessExitCode: 0, preprocessSignal: null, engineExitCode: 0, engineSignal: null, timedOut: false, transcriptPresent: true, transcriptChars: 12, wallMs: 100 }
  ] },
  fallbackBuild: { attempted: false, status: 'not-run', error: null, metadata: {} },
  writeRecord: { status: 'success', committed: true, sourceUrlPresent: true, transcriptionPresent: true, metadataFieldsPresent: ['title', 'url', 'synced_at'], noteSha256: hash, noteBytes: 100, error: null },
  artifactVault: { isolated: true, cloudRequestCount: 0, browserRequestCount: 1, vaultRootName: 'artifact-vault' },
  transcript: { present: true, chars: 12, source: 'local' },
  cleanup: { privateRootRemoved: true, receiptOnly: true }
};

assert.equal(validateReceiptObject(receipt), true);
assert.equal(validateSuccessfulReceiptObject(receipt), true);
const multiMediaReceipt = JSON.parse(JSON.stringify(receipt));
multiMediaReceipt.mediaDownloadEvidence.push({ inputUrlSha256: hash, inputUrlMatchedTargetDetail: false, returnedFileSha256: 'b'.repeat(64), returnedFileBytes: 100, returnedFileObserved: true });
assert.equal(validateReceiptObject(multiMediaReceipt), true);
assert.throws(() => validateSuccessfulReceiptObject(multiMediaReceipt));
assert.throws(() => validateReceiptObject({ ...receipt, writeRecord: { ...receipt.writeRecord, filePath: 'private.md' } }));
assert.throws(() => validateReceiptObject({ ...receipt, hydrate: { ...receipt.hydrate, error: { message: 'private error' } } }));

const failedReceipt = JSON.parse(JSON.stringify(receipt));
failedReceipt.candidateBundleLoaded = false;
failedReceipt.setupError = { code: 'HARNESS_TIMEOUT', reason: 'product-hydrate', timedOut: true };
failedReceipt.hydrate = { status: 'failed', error: { code: 'PROCESS_TIMEOUT', timedOut: true }, metadata: {} };
failedReceipt.mediaProbe = { status: 'failed', sha256: '', bytes: 0, durationSeconds: null, probeMethod: 'ffmpeg-duration-fallback', exitCode: 1, signal: null };
failedReceipt.nativeComparison.status = 'failed';
failedReceipt.nativeComparison.cases[0].status = 'timeout';
failedReceipt.nativeComparison.cases[0].failureCode = 'PROCESS_TIMEOUT';
failedReceipt.nativeComparison.cases[1].status = 'not-ready';
failedReceipt.writeRecord = { status: 'not-run', committed: false, sourceUrlPresent: false, transcriptionPresent: false, metadataFieldsPresent: [], noteSha256: '', noteBytes: 0, error: null };
failedReceipt.transcript = { present: false, chars: 0, source: '' };
assert.equal(validateReceiptObject(failedReceipt), true);
assert.throws(() => validateSuccessfulReceiptObject(failedReceipt));

const watchdogReceipt = JSON.parse(JSON.stringify(receipt));
watchdogReceipt.candidateBundleLoaded = false;
watchdogReceipt.setupError = { code: 'HARNESS_TIMEOUT', reason: 'product-hydrate', timedOut: true };
watchdogReceipt.hydrate = { status: 'not-run', error: null, metadata: {} };
watchdogReceipt.mediaProbe = { status: 'not-run', sha256: '', bytes: 0, durationSeconds: null, probeMethod: '', exitCode: null, signal: null };
watchdogReceipt.nativeComparison = { status: 'running', cases: [] };
watchdogReceipt.fallbackBuild = { attempted: false, status: 'not-run', error: null, metadata: {} };
watchdogReceipt.writeRecord = { status: 'not-run', committed: false, sourceUrlPresent: false, transcriptionPresent: false, metadataFieldsPresent: [], error: null };
watchdogReceipt.artifactVault = { isolated: true, cloudRequestCount: 0 };
watchdogReceipt.transcript = { present: false, chars: 0, source: '' };
assert.equal(validateReceiptObject(watchdogReceipt), true);
assert.throws(() => validateSuccessfulReceiptObject(watchdogReceipt));

process.stdout.write('mac-public-probe.test: ok\n');
