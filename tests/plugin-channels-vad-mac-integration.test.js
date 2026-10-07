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

async function main() {
  const installRoot = requiredEnv('CHANNELS_ASR_INSTALL_ROOT');
  const ffmpegPath = requiredEnv('CHANNELS_FFMPEG');
  const whisperPath = requiredEnv('CHANNELS_WHISPER_CLI');
  const asrModelPath = requiredEnv('CHANNELS_ASR_MODEL');
  const jfkPath = requiredEnv('CHANNELS_JFK_WAV');
  for (const filePath of [ffmpegPath, whisperPath, asrModelPath, jfkPath]) {
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
      threads: 4,
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
    assert.ok(['recovered', 'preserve_repeated_speech_candidate'].includes(repeated.decision));
    assert.equal(countExactPhrase(repeated.transcript, 'Ask not what your country can do for you ask what you can do for your country'), 6);
    assert.equal(repeated.deduplicated, false, 'repeated natural speech must never be deduplicated');
    assert.ok(repeated.windows.every((window) => window.endSeconds - window.startSeconds <= 30));

    process.stdout.write(JSON.stringify({
      status: 'PASS',
      platform: 'darwin',
      componentPresence: 'verified',
      vadModelVerified: true,
      jfk: { decision: jfk.decision, durationSeconds: Number(jfk.audioDurationSeconds.toFixed(2)), windows: jfk.windows.length, exactPhraseOccurrences: 1 },
      silence: { decision: silence.decision, durationSeconds: Number(silence.audioDurationSeconds.toFixed(2)), fullAudioProcessed: silence.fullAudioProcessed },
      repeated: { decision: repeated.decision, durationSeconds: Number(repeated.audioDurationSeconds.toFixed(2)), windows: repeated.windows.length, exactPhraseOccurrences: 6, deduplicated: repeated.deduplicated },
    }) + '\n');
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error.message) + '\n');
  process.exitCode = 1;
});
