'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  inspectChannelsVadAssets,
  runChannelsQualityRecovery,
} = require('../obsidian-plugin/wechat-inbox-sync/src/channels-asr-quality-recovery');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error('missing required environment variable: ' + name);
  return value;
}

function readPcmWavDuration(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', 'fixture must be WAV');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE', 'fixture must be WAV');
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const name = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (offset + 8 + size > buffer.length) throw new Error('malformed WAV fixture');
    if (name === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (name === 'data') dataBytes = size;
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataBytes) throw new Error('WAV duration unavailable');
  return dataBytes / byteRate;
}

function runFfmpeg(ffmpegPath, args) {
  const result = spawnSync(ffmpegPath, args, {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 120000,
  });
  if (result.error || result.status !== 0) throw new Error('ffmpeg fixture generation failed');
}

function countExactPhrase(text, phrase) {
  const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  const source = normalize(text);
  const target = normalize(phrase);
  let count = 0;
  for (let offset = 0; target && (offset = source.indexOf(target, offset)) >= 0; offset += target.length) count += 1;
  return count;
}

function chineseFidelity(text, expected) {
  const normalize = (value) => Array.from(String(value || '').replace(/[\s\p{P}\p{S}]+/gu, ''));
  const actual = normalize(text);
  const target = normalize(expected);
  const previous = Array.from({ length: target.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= actual.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= target.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (actual[row - 1] === target[column - 1] ? 0 : 1),
      );
    }
    for (let column = 0; column <= target.length; column += 1) previous[column] = current[column];
  }
  const lcs = Array.from({ length: actual.length + 1 }, () => Array(target.length + 1).fill(0));
  for (let row = 1; row <= actual.length; row += 1) {
    for (let column = 1; column <= target.length; column += 1) {
      lcs[row][column] = actual[row - 1] === target[column - 1]
        ? lcs[row - 1][column - 1] + 1
        : Math.max(lcs[row - 1][column], lcs[row][column - 1]);
    }
  }
  return {
    expectedCharacters: target.length,
    characterCoverage: target.length ? lcs[actual.length][target.length] / target.length : 0,
    characterErrorRate: target.length ? previous[target.length] / target.length : 1,
  };
}

async function main() {
  const installRoot = requiredEnv('CHANNELS_ASR_INSTALL_ROOT');
  const ffmpegPath = requiredEnv('CHANNELS_FFMPEG');
  const whisperPath = requiredEnv('CHANNELS_WHISPER_CLI');
  const asrModelPath = requiredEnv('CHANNELS_ASR_MODEL');
  const jfkPath = requiredEnv('CHANNELS_JFK_WAV');
  const chinesePath = requiredEnv('CHANNELS_CHINESE_WAV');
  const threads = Number(process.env.CHANNELS_ASR_THREADS || 1);
  assert.ok([1, 2, 3].includes(threads), 'Mac helper integration must use a bounded 1–3 thread setting');
  for (const filePath of [ffmpegPath, whisperPath, asrModelPath, jfkPath, chinesePath]) {
    if (!fs.existsSync(filePath)) throw new Error('required local integration fixture/component is missing');
  }

  const assets = await inspectChannelsVadAssets({ installRoot, platform: 'darwin' });
  assert.equal(assets.available, true, 'managed standalone VAD assets must exist and match the pinned model');
  const whisperHelp = spawnSync(whisperPath, ['-h'], { encoding: 'utf8', timeout: 10000 });
  const help = String(whisperHelp.stdout || '') + String(whisperHelp.stderr || '');
  for (const flag of ['-m', '-f', '-l', '-t', '-ojf', '-of', '-ng']) {
    assert.ok(help.includes(flag), 'Mac whisper CLI does not support required flag ' + flag);
  }

  const ffmpegVersion = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(ffmpegVersion.status, 0, 'local ffmpeg must run');

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'channels-vad-mac-integration-'));
  try {
    const silencePath = path.join(tempDir, 'silence.wav');
    runFfmpeg(ffmpegPath, [
      '-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
      '-t', '11', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', silencePath,
    ]);
    const repeatedPath = path.join(tempDir, 'jfk-repeat-6.wav');
    runFfmpeg(ffmpegPath, [
      '-v', 'error', '-nostdin', '-y', '-stream_loop', '5', '-i', jfkPath, '-t', '66',
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', repeatedPath,
    ]);

    const base = {
      qualityIssue: 'repeated-lines',
      vadSegmenterPath: assets.vadSegmenterPath,
      vadModelPath: assets.vadModelPath,
      ffmpegPath,
      whisperPath,
      asrModelPath,
      language: 'en',
      threads,
      cpuOnly: true,
    };
    const jfk = await runChannelsQualityRecovery({
      ...base,
      inputAudioPath: jfkPath,
      durationSeconds: readPcmWavDuration(jfkPath),
    });
    assert.equal(jfk.decision, 'recovered', 'natural human-voice JFK must pass the old Mac CLI JSON/token path');
    assert.equal(countExactPhrase(jfk.transcript, 'Ask not what your country can do for you ask what you can do for your country'), 1);
    assert.ok(jfk.windows.length >= 1);
    assert.ok(jfk.windows.every((window) => window.tokens >= 5 && window.rerunSimilarity >= 0.85));

    const chinese = await runChannelsQualityRecovery({
      ...base,
      language: 'zh',
      inputAudioPath: chinesePath,
      durationSeconds: readPcmWavDuration(chinesePath),
    });
    const chineseMetrics = chineseFidelity(chinese.transcript, '欢迎大家来体验达摩院推出的语音识别模型');
    assert.equal(chinese.decision, 'recovered', 'natural Chinese speech must pass the old Mac CLI JSON/token path');
    assert.ok(chineseMetrics.characterCoverage >= 0.9, 'Chinese speech should preserve at least 90% of expected characters');
    assert.ok(chineseMetrics.characterErrorRate <= 0.1, 'Chinese character error rate must remain within 10%');

    const silence = await runChannelsQualityRecovery({
      ...base,
      inputAudioPath: silencePath,
      durationSeconds: readPcmWavDuration(silencePath),
    });
    assert.equal(silence.decision, 'no_speech');
    assert.equal(silence.errorCode, 'TRANSCRIPTION_NO_SPEECH');
    assert.equal(silence.fullAudioProcessed, true);
    assert.equal(silence.transcript, undefined);

    const repeated = await runChannelsQualityRecovery({
      ...base,
      inputAudioPath: repeatedPath,
      durationSeconds: readPcmWavDuration(repeatedPath),
    });
    assert.equal(repeated.decision, 'recovered', 'repeated natural speech must be a true recovered result, not a warning candidate');
    assert.equal(countExactPhrase(repeated.transcript, 'Ask not what your country can do for you ask what you can do for your country'), 6);
    assert.equal(repeated.deduplicated, false, 'repeated natural speech must never be deduplicated');
    assert.ok(repeated.windows.every((window) => window.endSeconds - window.startSeconds <= 30));

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      platform: 'darwin',
      componentPresence: 'verified',
      vadModelVerified: true,
      jfk: { decision: jfk.decision, durationSeconds: Number(jfk.audioDurationSeconds.toFixed(2)), windows: jfk.windows.length, exactPhraseOccurrences: 1 },
      chinese: { decision: chinese.decision, durationSeconds: Number(chinese.audioDurationSeconds.toFixed(2)), windows: chinese.windows.length, ...chineseMetrics },
      silence: { decision: silence.decision, durationSeconds: Number(silence.audioDurationSeconds.toFixed(2)), fullAudioProcessed: silence.fullAudioProcessed },
      repeated: { decision: repeated.decision, durationSeconds: Number(repeated.audioDurationSeconds.toFixed(2)), windows: repeated.windows.length, exactPhraseOccurrences: 6, deduplicated: repeated.deduplicated },
      threads,
    }) + '\n');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error.message) + '\n');
  process.exitCode = 1;
});
