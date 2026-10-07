'use strict';

const { runChannelsQualityRecovery } = require('../obsidian-plugin/wechat-inbox-sync/src/channels-asr-quality-recovery');

function fidelity(transcript, expected) {
  const tokens = (expected.toLowerCase().match(/[a-z]+/g) || []);
  const actual = new Set((String(transcript || '').toLowerCase().match(/[a-z]+/g) || []));
  const normalized = (value) => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  const phrase = normalized(expected);
  const text = normalized(transcript);
  let exactPhraseOccurrences = 0;
  for (let offset = 0; phrase && (offset = text.indexOf(phrase, offset)) >= 0; offset += phrase.length) exactPhraseOccurrences += 1;
  return {
    expectedTokenCount: tokens.length,
    tokenCoverage: tokens.length ? Number((tokens.filter((token) => actual.has(token)).length / tokens.length).toFixed(3)) : 0,
    exactPhraseOccurrences,
  };
}

function chineseFidelity(transcript, expected) {
  const normalize = (value) => Array.from(String(value || '').replace(/[\\s\\p{P}\\p{S}]+/gu, ''));
  const actual = normalize(transcript);
  const target = normalize(expected);
  const joined = actual.join('');
  const phrase = target.join('');
  let exactPhraseOccurrences = 0;
  for (let offset = 0; phrase && (offset = joined.indexOf(phrase, offset)) >= 0; offset += phrase.length) exactPhraseOccurrences += 1;
  const actualCharacters = new Set(actual);
  const previous = Array.from({ length: target.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= actual.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= target.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (actual[i - 1] === target[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  const charErrorRate = target.length ? Number((previous[target.length] / target.length).toFixed(3)) : 1;
  return {
    expectedCharacterCount: target.length,
    characterCoverage: target.length ? Number((target.filter((character) => actualCharacters.has(character)).length / target.length).toFixed(3)) : 0,
    charErrorRate,
    exactPhraseOccurrences,
  };
}

async function main() {
  const [caseName, inputAudioPath, durationArg, vadSegmenterPath, vadModelPath, ffmpegPath, whisperPath, asrModelPath] = process.argv.slice(2);
  if (!caseName || !inputAudioPath || !durationArg || !vadSegmenterPath || !vadModelPath || !ffmpegPath || !whisperPath || !asrModelPath) {
    throw new Error('usage: node scripts/experiment-channels-asr-quality-recovery.js <channels|jfk|repeat6> <audio> <duration> <vad.exe> <vad-model> <ffmpeg.exe> <whisper.exe> <asr-model>');
  }
  const result = await runChannelsQualityRecovery({
    qualityIssue: 'repeated-lines',
    inputAudioPath,
    durationSeconds: Number(durationArg),
    vadSegmenterPath,
    vadModelPath,
    ffmpegPath,
    whisperPath,
    asrModelPath,
    language: caseName === 'channels' || caseName === 'zh' ? 'zh' : 'en',
    threads: 4,
    cpuOnly: true,
  });
  const output = {
    case: caseName,
    decision: result.decision,
    reason: result.reason || '',
    errorCode: result.errorCode || '',
    qualityIssue: result.qualityIssue || '',
    fullAudioProcessed: result.fullAudioProcessed ?? null,
    audioDurationSeconds: result.audioDurationSeconds ?? null,
    noSpeechEvidence: result.noSpeechEvidence || '',
    vadThreshold: result.vadThreshold ?? 0.35,
    vadModelSha256: result.vadModelSha256 || '',
    windowCount: result.windows ? result.windows.length : 0,
    unresolvedVadWindowCount: result.unresolvedVadWindowCount || 0,
    windows: (result.windows || []).map((window) => ({
      start: Number(window.startSeconds.toFixed(2)),
      end: Number(window.endSeconds.toFixed(2)),
      voiced: Number(window.voicedSeconds.toFixed(2)),
      tokens: window.tokens,
      meanP: Number(window.meanTokenProbability.toFixed(3)),
      medianP: Number(window.medianTokenProbability.toFixed(3)),
      rerunSimilarity: Number(window.rerunSimilarity.toFixed(3)),
    })),
    deduplicated: result.deduplicated ?? false,
  };
  if (caseName === 'jfk' || caseName === 'repeat6') {
    output.fidelity = fidelity(result.transcript, 'Ask not what your country can do for you ask what you can do for your country');
  }
  if (caseName === 'zh') output.fidelity = chineseFidelity(result.transcript, '欢迎大家来体验达摩院推出的语音识别模型');
  process.stdout.write(JSON.stringify(output) + '\n');
}

main().catch((error) => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
