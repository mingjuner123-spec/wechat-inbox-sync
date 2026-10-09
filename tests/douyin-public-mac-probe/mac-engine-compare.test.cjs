'use strict';

const assert = require('node:assert/strict');
const { validateReceiptObject, validateSuccessfulReceiptObject } = require('./validate-mac-asr-engine-receipt.cjs');
const runner = require('./mac-intel-asr-engine-runner.cjs');

const hash = 'a'.repeat(64);
const receipt = {
  schemaVersion: 1,
  harness: 'mac-intel-asr-engine-compare',
  runId: 'engine-test-1',
  fixtureSha256: hash,
  expectedFixtureSha256: hash,
  fixtureBytes: 562604,
  candidateBundleSha256: hash,
  expectedCandidateBundleSha256: hash,
  pluginVersion: '1.3.182',
  candidateIdentityMatched: true,
  fixtureIdentityMatched: true,
  productionWrapperSha256: hash,
  mediaProbe: { status: 'success', sha256: hash, bytes: 562604, durationSeconds: 17.6, probeMethod: 'ffmpeg', exitCode: 0, signal: null },
  nativeComparison: {
    status: 'success',
    cases: ['legacy', 'candidate-cpu', 'production-wrapper'].map((label) => ({
      label,
      inputSha256: hash,
      engineSha256: hash,
      modelSha256: hash,
      ...(label === 'production-wrapper' ? { wrapperSha256: hash } : {}),
      status: 'success',
      exitCode: 0,
      signal: null,
      timedOut: false,
      transcriptPresent: true,
      transcriptChars: 67,
      wallMs: 100,
      failureCode: null,
    })),
  },
  setupError: null,
  runtime: { platform: 'darwin', arch: 'x64', onlineExtraction: false, cloudAsr: false, rawFixtureRetained: false, rawTranscriptRetained: false },
  cleanup: { privateRootRemoved: true, receiptOnly: true },
};

assert.equal(validateReceiptObject(receipt), true);
assert.equal(validateSuccessfulReceiptObject(receipt), true);
assert.equal(runner.classifyFailure({ timedOut: true }), 'PROCESS_TIMEOUT');
assert.equal(runner.classifyFailure({ signal: 'SIGSEGV' }), 'SEGMENTATION_FAULT');

const unsafe = JSON.parse(JSON.stringify(receipt));
unsafe.nativeComparison.cases[0].stderr = 'private output';
assert.throws(() => validateReceiptObject(unsafe));

const mismatched = JSON.parse(JSON.stringify(receipt));
mismatched.nativeComparison.cases[2].inputSha256 = 'b'.repeat(64);
assert.throws(() => validateSuccessfulReceiptObject(mismatched));

process.stdout.write('mac-engine-compare.test: ok\n');
