'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  inspectChannelsVadAssets,
  runChannelsQualityRecovery,
  summarizeTokenProbabilities,
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

function runDiagnosticAsr(whisperPath, modelPath, audioPath, outputPrefix, threads) {
  const result = spawnSync(whisperPath, [
    '-m', modelPath, '-f', audioPath, '-l', 'en', '-t', String(threads), '-ojf', '-of', outputPrefix, '-ng',
  ], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const segments = result.status === 0 ? readJsonTranscript(outputPrefix) : null;
  return {
    exitCode: result.status,
    signal: result.signal || '',
    error: result.error ? 'spawn_error' : '',
    segments: segments || [],
    segmentCount: (segments || []).length,
    confidence: summarizeTokenProbabilities((segments || []).flatMap((segment) => segment.tokens)),
    text: (segments || []).map((segment) => segment.text).join('\n'),
  };
}

function readJsonTranscript(outputPrefix) {
  try {
    const parsed = JSON.parse(fs.readFileSync(`${outputPrefix}.json`, 'utf8'));
    if (!Array.isArray(parsed.transcription)) return null;
    return parsed.transcription.map((segment) => ({
      text: String(segment && segment.text || '').trim(),
      tokens: Array.isArray(segment && segment.tokens) ? segment.tokens : [],
    })).filter((segment) => segment.text);
  } catch (_error) {
    return null;
  }
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
    const cropDiagnostics = [];
    const jfkDuration = readPcmWavDuration(jfkPath);
    const firstWindow = jfk.windows && jfk.windows[0];
    if (firstWindow) {
      const vadStartSeconds = firstWindow.vadStartSeconds ?? firstWindow.startSeconds;
      const vadEndSeconds = firstWindow.vadEndSeconds ?? firstWindow.endSeconds;
      const crops = [
        { label: 'full-input', start: 0, end: jfkDuration },
        { label: 'vad-exact-window', start: vadStartSeconds, end: vadEndSeconds },
        {
          label: 'vad-window-plus-150ms-context',
          start: firstWindow.startSeconds,
          end: firstWindow.endSeconds,
        },
      ];
      for (const [index, crop] of crops.entries()) {
        let audioPath = jfkPath;
        if (crop.label !== 'full-input') {
          audioPath = path.join(tempDir, `jfk-diagnostic-${index}.wav`);
          runFfmpeg(ffmpegPath, [
            '-v', 'error', '-nostdin', '-y', '-ss', crop.start.toFixed(3), '-i', jfkPath,
            '-t', (crop.end - crop.start).toFixed(3), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath,
          ]);
        }
        cropDiagnostics.push({
          label: crop.label,
          startSeconds: crop.start,
          endSeconds: crop.end,
          ...runDiagnosticAsr(whisperPath, asrModelPath, audioPath, path.join(tempDir, `jfk-diagnostic-${index}`), threads),
        });
      }
    }
    if (process.env.ASR_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.ASR_EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, 'channels-vad-public-jfk-transcript.txt'), jfk.transcript || '', 'utf8');
      fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, 'channels-vad-public-jfk-windows.json'), JSON.stringify({
        decision: jfk.decision,
        reason: jfk.reason || '',
        windows: jfk.windows || [],
      }, null, 2) + '\n', 'utf8');
      fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, 'channels-vad-public-jfk-crop-diagnostics.json'), JSON.stringify({
        threadCount: threads,
        audioDurationSeconds: jfkDuration,
        diagnostics: cropDiagnostics.map(({ segments, ...entry }) => ({
          ...entry,
          exactPhraseOccurrences: countExactPhrase(entry.text, 'Ask not what your country can do for you ask what you can do for your country'),
        })),
      }, null, 2) + '\n', 'utf8');
      for (const entry of cropDiagnostics) {
        fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, `channels-vad-public-jfk-${entry.label}.txt`), entry.text + '\n', 'utf8');
      }
    }
    const chinese = await runChannelsQualityRecovery({
      ...base,
      language: 'zh',
      inputAudioPath: chinesePath,
      durationSeconds: readPcmWavDuration(chinesePath),
    });
    const chineseMetrics = chineseFidelity(chinese.transcript, '欢迎大家来体验达摩院推出的语音识别模型');

    const silence = await runChannelsQualityRecovery({
      ...base,
      inputAudioPath: silencePath,
      durationSeconds: readPcmWavDuration(silencePath),
    });

    const repeated = await runChannelsQualityRecovery({
      ...base,
      inputAudioPath: repeatedPath,
      durationSeconds: readPcmWavDuration(repeatedPath),
    });
    if (process.env.ASR_EVIDENCE_DIR) {
      fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, 'channels-vad-public-jfk-repeat-transcript.txt'), repeated.transcript || '', 'utf8');
      fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, 'channels-vad-public-jfk-repeat-windows.json'), JSON.stringify({
        decision: repeated.decision,
        reason: repeated.reason || '',
        deduplicated: repeated.deduplicated,
        windows: repeated.windows || [],
      }, null, 2) + '\n', 'utf8');
    }

    if (process.env.ASR_EVIDENCE_DIR) {
      const cases = { jfk, chinese, silence, repeated };
      for (const [name, result] of Object.entries(cases)) {
        fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, `channels-vad-public-${name}-transcript.txt`), result.transcript || '', 'utf8');
      }
      fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, 'channels-vad-public-case-summary.json'), JSON.stringify({
        jfk: { decision: jfk.decision, reason: jfk.reason || '', windows: jfk.windows || [], phraseOccurrences: countExactPhrase(jfk.transcript, 'Ask not what your country can do for you ask what you can do for your country') },
        chinese: { decision: chinese.decision, reason: chinese.reason || '', windows: chinese.windows || [], ...chineseMetrics },
        silence: { decision: silence.decision, reason: silence.reason || '', errorCode: silence.errorCode || '', fullAudioProcessed: silence.fullAudioProcessed, durationSeconds: silence.audioDurationSeconds },
        repeated: { decision: repeated.decision, reason: repeated.reason || '', windows: repeated.windows || [], phraseOccurrences: countExactPhrase(repeated.transcript, 'Ask not what your country can do for you ask what you can do for your country'), deduplicated: repeated.deduplicated },
      }, null, 2) + '\n', 'utf8');
    }

    const jfkWindows = Array.isArray(jfk.windows) ? jfk.windows : [];
    const repeatedWindows = Array.isArray(repeated.windows) ? repeated.windows : [];
    const failures = [];
    if (jfk.decision !== 'recovered') failures.push('JFK result was not recovered');
    if (countExactPhrase(jfk.transcript, 'Ask not what your country can do for you ask what you can do for your country') !== 1) failures.push('JFK reference sentence was not preserved exactly once');
    if (!jfkWindows.length || !jfkWindows.every((window) => window.tokens >= 5 && window.rerunSimilarity >= 0.85)) failures.push('JFK evidence window failed confidence or consistency checks');
    if (chinese.decision !== 'recovered') failures.push('Chinese speech was not recovered');
    if (chineseMetrics.characterCoverage < 0.9) failures.push('Chinese character coverage fell below 90%');
    if (chineseMetrics.characterErrorRate > 0.1) failures.push('Chinese character error rate exceeded 10%');
    if (silence.decision !== 'no_speech' || silence.errorCode !== 'TRANSCRIPTION_NO_SPEECH'
      || silence.fullAudioProcessed !== true || silence.transcript !== undefined) failures.push('Silence was not classified with complete no-speech evidence');
    if (repeated.decision !== 'recovered') failures.push('Repeated natural speech was not fully recovered');
    if (countExactPhrase(repeated.transcript, 'Ask not what your country can do for you ask what you can do for your country') !== 6) failures.push('Repeated natural speech was not preserved six times');
    if (repeated.deduplicated !== false) failures.push('Repeated natural speech was deduplicated');
    if (!repeatedWindows.every((window) => window.endSeconds - window.startSeconds <= 30)) failures.push('Repeated speech window exceeded the 30-second bound');
    if (failures.length) assert.fail(failures.join('; '));

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
