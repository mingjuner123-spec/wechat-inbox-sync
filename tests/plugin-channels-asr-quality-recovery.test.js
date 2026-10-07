'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  CHANNELS_VAD_MODEL_SHA256,
  assessChannelsVadResult,
  inspectChannelsVadAssets,
  mergeVadSpeechSegments,
  padVadSpeechWindows,
  parseVadSpeechSegments,
  runChannelsQualityRecovery,
  runProcess,
  summarizeTokenProbabilities,
  textSimilarity,
} = require('../obsidian-plugin/wechat-inbox-sync/src/channels-asr-quality-recovery');

const VAD_MODEL = 'pinned-vad.bin';
const EXPECTED_VAD_HASH = CHANNELS_VAD_MODEL_SHA256;

function vadStdout(segments) {
  return 'Detected ' + segments.length + ' speech segments:\n' + segments.map((segment, index) =>
    'Speech segment ' + index + ': start = ' + (segment[0] * 100).toFixed(2) + ', end = ' + (segment[1] * 100).toFixed(2)
  ).join('\n') + '\n';
}

function tokensFor(text, includeControl = true) {
  const tokens = (text.match(/[a-z]+/gi) || []).map((word) => ({ text: word, p: 0.96 }));
  if (includeControl) tokens.unshift({ text: '[_BEG_]', p: 0.99 }, { text: '[_TT_452]', p: 0.05 });
  return tokens;
}

function makePcmWav(durationSeconds = 13) {
  const dataLength = Math.floor(16000 * 2 * durationSeconds);
  const wav = Buffer.alloc(44 + dataLength);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataLength, 40);
  return wav;
}

function fakeDeps({ segments, transcript, decodeExit = 0, vadExit = 0, confidenceTokens, windowBehavior } = {}) {
  const calls = [];
  let transcriptPass = 0;
  return {
    calls,
    dependencies: {
      sha256File: async () => EXPECTED_VAD_HASH,
      createTempDir: async () => fs.promises.mkdtemp(path.join(os.tmpdir(), 'channels-quality-test-')),
      cleanupTempDir: async (dir) => fs.promises.rm(dir, { recursive: true, force: true }),
      runProcess: async (filePath, args) => {
        calls.push({ filePath, args });
        if (filePath === 'vad.exe') return { exitCode: vadExit, stdout: vadStdout(segments || []), stderr: '' };
        if (filePath === 'ffmpeg.exe') {
          if (args[0] === '-v' && decodeExit !== 0) return { exitCode: decodeExit, stdout: '', stderr: '' };
          fs.writeFileSync(args[args.length - 1], makePcmWav());
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (filePath === 'whisper.exe') {
          transcriptPass += 1;
          const outputPrefix = args[args.indexOf('-of') + 1];
          const match = path.basename(outputPrefix).match(/speech-window-(\d+)-pass-(\d+)$/);
          const windowIndex = match ? Number(match[1]) : 0;
          const pass = match ? Number(match[2]) : 1;
          const behavior = typeof windowBehavior === 'function'
            ? windowBehavior({ windowIndex, pass, transcriptPass })
            : null;
          if (behavior && behavior.throw) throw new Error(String(behavior.throw));
          if (behavior && behavior.exitCode !== undefined) {
            return { exitCode: behavior.exitCode, stdout: '', stderr: behavior.stderr || '' };
          }
          if (behavior && behavior.missing) return { exitCode: 0, stdout: '', stderr: '' };
          const text = behavior && behavior.text !== undefined
            ? behavior.text
            : (typeof transcript === 'function' ? transcript(transcriptPass) : transcript);
          const tokens = behavior && behavior.confidenceTokens
            ? behavior.confidenceTokens
            : (confidenceTokens || tokensFor(text));
          fs.writeFileSync(outputPrefix + '.json', JSON.stringify({
            transcription: [{ text, tokens }],
          }));
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        throw new Error('unexpected process');
      },
    },
  };
}

function options() {
  return {
    qualityIssue: 'repeated-lines',
    inputAudioPath: 'input.wav',
    durationSeconds: 11,
    vadSegmenterPath: 'vad.exe',
    vadModelPath: VAD_MODEL,
    ffmpegPath: 'ffmpeg.exe',
    whisperPath: 'whisper.exe',
    asrModelPath: 'small.bin',
    language: 'en',
    cpuOnly: true,
  };
}

async function main() {
  assert.deepEqual(parseVadSpeechSegments('Detected 2 speech segments:\nSpeech segment 0: start = 32.00, end = 230.00\nSpeech segment 1: start = 323.00, end = 445.00'), [
    { startSeconds: 0.32, endSeconds: 2.3 },
    { startSeconds: 3.23, endSeconds: 4.45 },
  ], 'VAD CLI centiseconds convert to seconds');
  assert.equal(parseVadSpeechSegments('Detected 1 speech segment:\nSpeech segment 1: start = 10.00, end = 11.00'), null, 'malformed segment indices fail closed');
  const thirtyOneSeconds = mergeVadSpeechSegments([{ startSeconds: 0, endSeconds: 31 }]);
  assert.deepEqual(thirtyOneSeconds.map(({ startSeconds, endSeconds, voicedSeconds }) => [startSeconds, endSeconds, voicedSeconds]), [
    [0, 30, 30],
    [30, 31, 1],
  ], 'a continuous 31-second segment is covered by bounded windows');
  const sixtyOneSeconds = mergeVadSpeechSegments([{ startSeconds: 0, endSeconds: 61 }]);
  assert.deepEqual(sixtyOneSeconds.map(({ startSeconds, endSeconds, voicedSeconds }) => [startSeconds, endSeconds, voicedSeconds]), [
    [0, 30, 30],
    [30, 60, 30],
    [60, 61, 1],
  ], 'a continuous 61-second segment is covered without dropping its tail');
  const overlappingSegments = mergeVadSpeechSegments([
    { startSeconds: 0, endSeconds: 10 },
    { startSeconds: 5, endSeconds: 15 },
  ]);
  assert.deepEqual(overlappingSegments.map(({ startSeconds, endSeconds, voicedSeconds }) => [startSeconds, endSeconds, voicedSeconds]), [
    [0, 15, 15],
  ], 'overlapping VAD input contributes union voiced seconds once');
  const paddedThirtyOneSeconds = padVadSpeechWindows(thirtyOneSeconds, 31);
  assert.deepEqual(paddedThirtyOneSeconds.map(({ startSeconds, endSeconds }) => [startSeconds, endSeconds]), [
    [0, 30],
    [30, 31],
  ], 'padding cannot expand a bounded window past 30 seconds');
  assert.deepEqual(mergeVadSpeechSegments([
    { startSeconds: 0, endSeconds: 1 },
    { startSeconds: 1.4, endSeconds: 2 },
    { startSeconds: 40, endSeconds: 41 },
  ]).map(({ startSeconds, endSeconds, voicedSeconds }) => [startSeconds, endSeconds, voicedSeconds]), [[0, 2, 1.6], [40, 41, 1]]);
  assert.equal(summarizeTokenProbabilities([{ text: '[_BEG_]', p: 0.99 }, { text: '[_TT_452]', p: 0.01 }, { text: 'spoken', p: 0.8 }]).count, 1, 'control tokens do not inflate ASR confidence');
  assert.equal(textSimilarity('same repeated line', 'same repeated line'), 1);
  assert.equal(assessChannelsVadResult({ exitCode: 0, modelSha256: EXPECTED_VAD_HASH, threshold: 0.35, audioDurationSeconds: 11, fullAudioProcessed: true, segments: [] }).decision, 'no_speech');
  assert.equal(assessChannelsVadResult({ exitCode: 0, modelSha256: EXPECTED_VAD_HASH, threshold: 0.35, audioDurationSeconds: 11, fullAudioProcessed: false, segments: [] }).decision, 'retain_quality_failure', 'incomplete coverage cannot assert no speech');

  const absentAssets = await inspectChannelsVadAssets({ installRoot: path.join(os.tmpdir(), 'definitely-missing-channels-vad'), platform: 'win32' });
  assert.equal(absentAssets.available, false);
  assert.equal(absentAssets.reason, 'vad_assets_missing', 'asset discovery never downloads missing binaries');

  const assetRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'channels-vad-assets-'));
  try {
    await fs.promises.mkdir(path.join(assetRoot, 'bin'), { recursive: true });
    await fs.promises.mkdir(path.join(assetRoot, 'models'), { recursive: true });
    await fs.promises.writeFile(path.join(assetRoot, 'bin', 'whisper-vad-speech-segments.exe'), 'binary-stub');
    await fs.promises.writeFile(path.join(assetRoot, 'models', 'ggml-silero-v6.2.0-ggml.bin'), 'model-stub');
    await fs.promises.writeFile(path.join(assetRoot, 'models', 'ggml-silero-v6.2.0.bin'), 'official-model-stub');
    const helpCalls = [];
    const validAssets = await inspectChannelsVadAssets({ installRoot: assetRoot, platform: 'win32' }, {
      sha256File: async () => EXPECTED_VAD_HASH,
      runProcess: async (file, args) => {
        helpCalls.push({ file, args });
        return { exitCode: 0, stdout: 'usage -f --file -vm --vad-model -vt --vad-threshold', stderr: '' };
      },
    });
    assert.equal(validAssets.available, true);
    assert.equal(validAssets.vadSegmenterPath, path.join(assetRoot, 'bin', 'whisper-vad-speech-segments.exe'));
    assert.equal(validAssets.vadModelPath, path.join(assetRoot, 'models', 'ggml-silero-v6.2.0.bin'), 'official filename takes precedence');
    assert.deepEqual(helpCalls[0].args, ['-h'], 'only a bounded local help probe validates CLI flags');
    await fs.promises.rm(path.join(assetRoot, 'models', 'ggml-silero-v6.2.0.bin'));
    const legacyNameAssets = await inspectChannelsVadAssets({ installRoot: assetRoot, platform: 'win32' }, {
      sha256File: async () => EXPECTED_VAD_HASH,
      runProcess: async () => ({ exitCode: 0, stdout: '-f --file -vm --vad-model -vt --vad-threshold', stderr: '' }),
    });
    assert.equal(legacyNameAssets.available, true, 'older ggml-suffixed filename remains supported');
    assert.equal(legacyNameAssets.vadModelPath, path.join(assetRoot, 'models', 'ggml-silero-v6.2.0-ggml.bin'));
    const unverifiedModel = await inspectChannelsVadAssets({ installRoot: assetRoot, platform: 'win32' }, {
      sha256File: async () => '0'.repeat(64),
      runProcess: async () => { throw new Error('must not run incompatible assets'); },
    });
    assert.equal(unverifiedModel.reason, 'vad_model_unverified');
    const incompatibleCli = await inspectChannelsVadAssets({ installRoot: assetRoot, platform: 'win32' }, {
      sha256File: async () => EXPECTED_VAD_HASH,
      runProcess: async () => ({ exitCode: 0, stdout: 'unknown flags', stderr: '' }),
    });
    assert.equal(incompatibleCli.reason, 'vad_cli_incompatible');
  } finally {
    await fs.promises.rm(assetRoot, { recursive: true, force: true });
  }

  const noSpeechFixture = fakeDeps({ segments: [] });
  const noSpeech = await runChannelsQualityRecovery(options(), noSpeechFixture.dependencies);
  assert.equal(noSpeech.decision, 'no_speech');
  assert.equal(noSpeech.errorCode, 'TRANSCRIPTION_NO_SPEECH');
  assert.equal(noSpeech.fullAudioProcessed, true);
  assert.equal(noSpeech.audioDurationSeconds, 13, 'duration comes from the decoded WAV, not caller metadata');
  assert.equal(noSpeechFixture.calls.filter((call) => call.filePath === 'whisper.exe').length, 0, 'no speech does not fabricate transcript text');

  const failedDecodeFixture = fakeDeps({ segments: [], decodeExit: 1 });
  const decodeFailure = await runChannelsQualityRecovery(options(), failedDecodeFixture.dependencies);
  assert.equal(decodeFailure.decision, 'retain_quality_failure');
  assert.equal(decodeFailure.reason, 'full_audio_decode_failed', 'incomplete decode is not no_speech');

  const vadFailureFixture = fakeDeps({ segments: [], vadExit: 2 });
  const vadFailure = await runChannelsQualityRecovery(options(), vadFailureFixture.dependencies);
  assert.equal(vadFailure.decision, 'retain_quality_failure');
  assert.equal(vadFailure.reason, 'vad_process_failed');

  const repeatedText = Array.from({ length: 6 }, () => 'Ask not what your country can do for you').join('\n');
  const speechFixture = fakeDeps({
    segments: [[0, 1.8], [2.1, 3.9], [4.2, 6.0], [6.3, 8.1], [8.4, 10.2]],
    transcript: repeatedText,
  });
  const repeated = await runChannelsQualityRecovery(options(), speechFixture.dependencies);
  assert.equal(repeated.decision, 'preserve_repeated_speech_candidate');
  assert.equal(repeated.deduplicated, false);
  assert.equal(repeated.transcript.split('\n').length, 6, 'real repeated speech is retained verbatim');
  assert.equal(repeated.windows[0].rerunSimilarity, 1);
  assert.equal(speechFixture.calls.filter((call) => call.filePath === 'whisper.exe').length, 2, 'each window receives independent ASR rerun');

  const partialFixture = fakeDeps({
    segments: [[0, 1.8], [2.1, 3.9], [4.2, 6.0], [6.3, 8.1], [8.4, 10.2], [12, 12.4]],
    transcript: repeatedText,
  });
  const partialOptions = options();
  partialOptions.durationSeconds = 13;
  const partial = await runChannelsQualityRecovery(partialOptions, partialFixture.dependencies);
  assert.equal(partial.decision, 'partial_recovery');
  assert.equal(partial.unresolvedVadWindowCount, 1);
  assert.equal(partial.transcript.split('\n').length, 6, 'partial recovery preserves verified repeated speech without dedupe');

  const acceptedWindowText = 'First verified window content is stable';
  const twoWindowSegments = [[0, 2], [3.5, 5.5]];
  const partialWindowScenarios = [
    {
      label: 'nonzero ASR exit',
      expectedReason: 'speech_window_asr_failed',
      behavior: ({ windowIndex }) => windowIndex === 1 ? { exitCode: 9 } : null,
    },
    {
      label: 'missing transcript',
      expectedReason: 'speech_window_transcript_missing',
      behavior: ({ windowIndex }) => windowIndex === 1 ? { missing: true } : null,
    },
    {
      label: 'low confidence',
      expectedReason: 'speech_window_confidence_low',
      behavior: ({ windowIndex }) => windowIndex === 1 ? {
        confidenceTokens: [{ text: '[_BEG_]', p: 0.99 }, { text: '[_TT_452]', p: 0.99 }],
      } : null,
    },
    {
      label: 'single-window quality rejection',
      expectedReason: 'speech_window_quality_rejected',
      expectedQualityIssue: 'prompt-leak',
      behavior: ({ windowIndex }) => windowIndex === 1 ? { text: '请输入简体中文' } : null,
    },
    {
      label: 'inconsistent rerun',
      expectedReason: 'speech_window_rerun_inconsistent',
      behavior: ({ windowIndex, pass }) => windowIndex === 1 && pass === 2
        ? { text: 'A completely different second window transcript is here' }
        : null,
    },
  ];
  for (const scenario of partialWindowScenarios) {
    const fixture = fakeDeps({
      segments: twoWindowSegments,
      transcript: acceptedWindowText,
      windowBehavior: scenario.behavior,
    });
    const result = await runChannelsQualityRecovery(options(), fixture.dependencies);
    assert.equal(result.decision, 'partial_recovery', scenario.label + ' keeps prior accepted window');
    assert.equal(result.transcript, acceptedWindowText, scenario.label + ' keeps accepted text only');
    assert.equal(result.windows.length, 1, scenario.label + ' exposes only accepted windows');
    assert.equal(result.unresolvedAsrWindowCount, 1, scenario.label + ' records one unresolved ASR window');
    assert.equal(result.unresolvedWindowCount, 1, scenario.label + ' records one unresolved total window');
    assert.equal(result.requiresQualityWarning, true, scenario.label + ' requires a quality warning');
    assert.equal(result.unresolvedWindows[0].reason, scenario.expectedReason, scenario.label + ' preserves the failure class');
    if (scenario.expectedQualityIssue) assert.equal(result.unresolvedWindows[0].qualityIssue, scenario.expectedQualityIssue);
  }

  const allFailedFixture = fakeDeps({
    segments: twoWindowSegments,
    transcript: acceptedWindowText,
    windowBehavior: () => ({ exitCode: 9 }),
  });
  const allFailedWindows = await runChannelsQualityRecovery(options(), allFailedFixture.dependencies);
  assert.equal(allFailedWindows.decision, 'retain_quality_failure', 'all unresolved windows remain a failure');
  assert.equal(allFailedWindows.reason, 'speech_window_asr_failed');
  assert.equal(allFailedWindows.transcript, undefined, 'all failed windows produce no transcript');

  const cancelController = new AbortController();
  const cancelFixture = fakeDeps({
    segments: twoWindowSegments,
    transcript: acceptedWindowText,
    windowBehavior: ({ windowIndex }) => {
      if (windowIndex === 1) {
        cancelController.abort();
        return { text: acceptedWindowText };
      }
      return null;
    },
  });
  const cancelled = await runChannelsQualityRecovery({ ...options(), signal: cancelController.signal }, cancelFixture.dependencies);
  assert.equal(cancelled.decision, 'aborted', 'cancellation is not converted to unresolved recovery');

  const inconsistentFixture = fakeDeps({
    segments: [[0, 2], [2.4, 4.4]],
    transcript: (pass) => pass === 1 ? 'Ask not what your country can do for you' : 'Weather conditions today are clear',
  });
  const inconsistent = await runChannelsQualityRecovery(options(), inconsistentFixture.dependencies);
  assert.equal(inconsistent.decision, 'retain_quality_failure');
  assert.equal(inconsistent.reason, 'speech_window_rerun_inconsistent');

  const lowConfidenceFixture = fakeDeps({
    segments: [[0, 2], [2.4, 4.4]],
    transcript: 'Ask not what your country can do for you',
    confidenceTokens: [{ text: '[_BEG_]', p: 0.99 }, { text: '[_TT_452]', p: 0.99 }],
  });
  const lowConfidence = await runChannelsQualityRecovery(options(), lowConfidenceFixture.dependencies);
  assert.equal(lowConfidence.reason, 'speech_window_confidence_low', 'special tokens cannot satisfy minimum confidence');

  const createStubbornChild = (killSignals) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => {
      killSignals.push(signal);
      if (signal === 'SIGKILL') setImmediate(() => child.emit('close', null));
      return true;
    };
    return child;
  };
  const timeoutSignals = [];
  const timedOut = await runProcess('native.exe', [], {
    timeoutMs: 20, killGraceMs: 5, settleAfterKillMs: 20,
    spawnImpl: () => createStubbornChild(timeoutSignals),
  });
  assert.equal(timedOut.timedOut, true);
  assert.deepEqual(timeoutSignals, ['SIGTERM', 'SIGKILL'], 'timeout escalates when native child ignores graceful stop');

  const abortSignals = [];
  const abortController = new AbortController();
  const abortTask = runProcess('native.exe', [], {
    timeoutMs: 5000, killGraceMs: 5, settleAfterKillMs: 20, signal: abortController.signal,
    spawnImpl: () => createStubbornChild(abortSignals),
  });
  abortController.abort();
  const aborted = await abortTask;
  assert.equal(aborted.aborted, true, 'abort is propagated and settles the child process');
  assert.deepEqual(abortSignals, ['SIGTERM', 'SIGKILL']);

  const limitSignals = [];
  const limitChild = createStubbornChild(limitSignals);
  setTimeout(() => limitChild.stdout.write('0123456789'), 5);
  const outputLimit = await runProcess('native.exe', [], {
    maxOutputBytes: 4, timeoutMs: 2000, killGraceMs: 5, settleAfterKillMs: 20,
    spawnImpl: () => limitChild,
  });
  assert.equal(outputLimit.outputLimitExceeded, true);
  assert.deepEqual(limitSignals, ['SIGTERM', 'SIGKILL']);

  process.stdout.write('channels ASR quality recovery tests passed\n');
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error.message) + '\n');
  process.exitCode = 1;
});
