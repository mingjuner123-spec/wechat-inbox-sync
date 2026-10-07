'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getTranscriptionQualityIssue } = require('./transcription-quality-utils');

const CHANNELS_VAD_MODEL_SHA256 = '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987';
const CHANNELS_VAD_THRESHOLD = 0.35;
const MAX_VAD_SEGMENTS = 128;
const MAX_WINDOW_SECONDS = 30;
const VAD_WINDOW_PADDING_SECONDS = 0.15;
const MAX_GAP_SECONDS = 1;
const MIN_WINDOW_SECONDS = 0.6;
const MIN_VOICED_SECONDS = 0.6;
const MIN_VOICED_RATIO = 0.35;
const MIN_TOKENS = 5;
const MIN_MEAN_TOKEN_PROBABILITY = 0.75;
const MIN_MEDIAN_TOKEN_PROBABILITY = 0.85;
const MIN_REPEAT_RERUN_SIMILARITY = 0.85;

function parseVadSpeechSegments(output) {
  const source = String(output || '');
  const header = source.match(/^Detected\s+(\d+)\s+speech segments?:?\s*$/im);
  if (!header) return null;
  const count = Number(header[1]);
  if (!Number.isInteger(count) || count < 0 || count > MAX_VAD_SEGMENTS) return null;
  const segments = [];
  const pattern = /^Speech segment\s+(\d+):\s*start\s*=\s*([\d.]+),\s*end\s*=\s*([\d.]+)\s*$/gim;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const index = Number(match[1]);
    const startSeconds = Number(match[2]) / 100;
    const endSeconds = Number(match[3]) / 100;
    if (index !== segments.length || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)
      || startSeconds < 0 || endSeconds <= startSeconds) return null;
    segments.push({ startSeconds, endSeconds });
  }
  return segments.length === count ? segments : null;
}

function mergeVadSpeechSegments(segments, { maxGapSeconds = MAX_GAP_SECONDS, maxWindowSeconds = MAX_WINDOW_SECONDS } = {}) {
  if (!Array.isArray(segments) || segments.length > MAX_VAD_SEGMENTS) return null;
  const sorted = segments.map((segment) => ({
    startSeconds: Number(segment && segment.startSeconds),
    endSeconds: Number(segment && segment.endSeconds),
  })).sort((left, right) => left.startSeconds - right.startSeconds);
  const windows = [];
  for (const segment of sorted) {
    if (!Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.endSeconds)
      || segment.startSeconds < 0 || segment.endSeconds <= segment.startSeconds) return null;
    if (segment.endSeconds - segment.startSeconds > maxWindowSeconds) return null;
    const current = windows[windows.length - 1];
    if (current && segment.startSeconds < current.endSeconds
      && segment.endSeconds - current.startSeconds > maxWindowSeconds) return null;
    if (current && segment.startSeconds <= current.endSeconds + maxGapSeconds
      && segment.endSeconds - current.startSeconds <= maxWindowSeconds) {
      current.voicedSeconds += Math.max(0, segment.endSeconds - Math.max(segment.startSeconds, current.endSeconds));
      current.endSeconds = Math.max(current.endSeconds, segment.endSeconds);
    } else {
      windows.push({ ...segment, voicedSeconds: segment.endSeconds - segment.startSeconds });
    }
  }
  return windows;
}

function padVadSpeechWindows(windows, audioDurationSeconds, {
  paddingSeconds = VAD_WINDOW_PADDING_SECONDS,
  maxWindowSeconds = MAX_WINDOW_SECONDS,
} = {}) {
  const duration = Number(audioDurationSeconds);
  const padding = Number(paddingSeconds);
  const maxWindow = Number(maxWindowSeconds);
  if (!Array.isArray(windows) || !Number.isFinite(duration) || duration <= 0
    || !Number.isFinite(padding) || padding < 0 || !Number.isFinite(maxWindow) || maxWindow <= 0) return null;
  const sorted = windows.map((window) => ({
    vadStartSeconds: Number(window && window.startSeconds),
    vadEndSeconds: Number(window && window.endSeconds),
    voicedSeconds: Number(window && window.voicedSeconds),
  })).sort((left, right) => left.vadStartSeconds - right.vadStartSeconds);
  const padded = [];
  for (const window of sorted) {
    const speechDuration = window.vadEndSeconds - window.vadStartSeconds;
    if (!Number.isFinite(window.vadStartSeconds) || !Number.isFinite(window.vadEndSeconds)
      || !Number.isFinite(window.voicedSeconds) || window.vadStartSeconds < 0
      || window.vadEndSeconds <= window.vadStartSeconds || window.vadEndSeconds > duration + 0.05
      || speechDuration > maxWindow) return null;
    window.vadEndSeconds = Math.min(window.vadEndSeconds, duration);
    const availableExtra = Math.max(0, maxWindow - speechDuration);
    let leftPadding = Math.min(padding, window.vadStartSeconds, availableExtra / 2);
    let rightPadding = Math.min(padding, duration - window.vadEndSeconds, availableExtra - leftPadding);
    const remainingExtra = Math.max(0, availableExtra - leftPadding - rightPadding);
    if (remainingExtra > 0) {
      leftPadding += Math.min(remainingExtra, padding - leftPadding, window.vadStartSeconds - leftPadding);
    }
    padded.push({
      startSeconds: window.vadStartSeconds - leftPadding,
      endSeconds: window.vadEndSeconds + rightPadding,
      vadStartSeconds: window.vadStartSeconds,
      vadEndSeconds: window.vadEndSeconds,
      voicedSeconds: window.voicedSeconds,
    });
  }
  const nonOverlapping = [];
  for (const window of padded) {
    const previous = nonOverlapping[nonOverlapping.length - 1];
    if (previous && window.startSeconds < previous.endSeconds) {
      const combinedEnd = Math.max(previous.endSeconds, window.endSeconds);
      if (combinedEnd - previous.startSeconds <= maxWindow) {
        previous.endSeconds = combinedEnd;
        previous.vadEndSeconds = window.vadEndSeconds;
        previous.voicedSeconds += window.voicedSeconds;
        continue;
      }
      const boundary = (previous.vadEndSeconds + window.vadStartSeconds) / 2;
      previous.endSeconds = boundary;
      window.startSeconds = boundary;
    }
    if (window.endSeconds - window.startSeconds > maxWindow + 1e-9) return null;
    nonOverlapping.push(window);
  }
  return nonOverlapping;
}

function summarizeTokenProbabilities(tokens) {
  const values = (Array.isArray(tokens) ? tokens : [])
    .filter((token) => !/^\[_[A-Z]+(?:_\d+)?_?\]$/i.test(String(token && token.text || '')))
    .map((token) => Number(token && (token.p ?? token.probability)))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    .sort((left, right) => left - right);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return {
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
  };
}

function normalizedText(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').trim();
}

function textSimilarity(left, right) {
  const a = Array.from(normalizedText(left));
  const b = Array.from(normalizedText(right));
  if (!a.length || !b.length) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return Math.max(0, 1 - previous[b.length] / Math.max(a.length, b.length));
}

function runProcess(filePath, args, {
  signal, timeoutMs = 120000, maxOutputBytes = 2 * 1024 * 1024,
  spawnImpl = spawn, killGraceMs = 100, settleAfterKillMs = 1000,
} = {}) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve({ exitCode: null, aborted: true, stdout: '', stderr: '' });
    let stdout = ''; let stderr = ''; let outputBytes = 0; let timedOut = false;
    let aborted = false; let outputLimitExceeded = false; let settled = false; let stopping = false;
    let timer; let forceTimer; let settleTimer; let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(forceTimer); clearTimeout(settleTimer);
      if (signal) signal.removeEventListener('abort', abortHandler);
      if (result.forcedStop && child) {
        try { child.stdout && child.stdout.destroy(); } catch (_error) { /* force bounded shutdown */ }
        try { child.stderr && child.stderr.destroy(); } catch (_error) { /* force bounded shutdown */ }
      }
      resolve({ ...result, aborted: aborted || Boolean(signal && signal.aborted), timedOut, outputLimitExceeded, stdout, stderr });
    };
    const stop = (reason) => {
      if (reason === 'timeout') timedOut = true;
      if (reason === 'abort') aborted = true;
      if (stopping || settled) return;
      stopping = true;
      clearTimeout(timer);
      try { child && child.kill('SIGTERM'); } catch (_error) { /* continue to forced kill */ }
      forceTimer = setTimeout(() => {
        try { child && child.kill('SIGKILL'); } catch (_error) { /* settle independently below */ }
        settleTimer = setTimeout(() => finish({ exitCode: null, forcedStop: true }), settleAfterKillMs);
      }, killGraceMs);
    };
    const abortHandler = () => stop('abort');
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        outputLimitExceeded = true;
        stop('output-limit');
        return;
      }
      if (target === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    try { child = spawnImpl(filePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (_error) { return finish({ exitCode: null, spawnFailed: true }); }
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.on('error', () => finish({ exitCode: null, spawnFailed: true }));
    child.on('close', (code) => finish({ exitCode: code }));
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    if (signal) { signal.addEventListener('abort', abortHandler, { once: true }); if (signal.aborted) abortHandler(); }
  });
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function inspectChannelsVadAssets({ installRoot, platform, arch, signal, exists = fs.existsSync } = {}, dependencies = {}) {
  if (!installRoot || !['darwin', 'win32'].includes(platform) || (arch && !['arm64', 'x64'].includes(arch))) {
    return { available: false, reason: 'vad_assets_unavailable' };
  }
  const binaryName = platform === 'win32' ? 'whisper-vad-speech-segments.exe' : 'whisper-vad-speech-segments';
  const binaryCandidates = [
    path.join(installRoot, 'bin', binaryName),
    path.join(installRoot, 'whisper', binaryName),
  ];
  const modelCandidates = [
    path.join(installRoot, 'models', 'ggml-silero-v6.2.0.bin'),
    path.join(installRoot, 'models', 'ggml-silero-v6.2.0-ggml.bin'),
    path.join(installRoot, 'models', 'vad', 'ggml-silero-v6.2.0.bin'),
    path.join(installRoot, 'models', 'vad', 'ggml-silero-v6.2.0-ggml.bin'),
  ];
  const vadSegmenterPath = binaryCandidates.find((candidate) => exists(candidate)) || '';
  const vadModelPath = modelCandidates.find((candidate) => exists(candidate)) || '';
  if (!vadSegmenterPath || !vadModelPath) return { available: false, reason: 'vad_assets_missing' };
  let modelSha256 = '';
  try { modelSha256 = String(await (dependencies.sha256File || sha256File)(vadModelPath)).toLowerCase(); } catch (_error) {
    return { available: false, reason: 'vad_model_unavailable' };
  }
  if (modelSha256 !== CHANNELS_VAD_MODEL_SHA256) return { available: false, reason: 'vad_model_unverified' };
  const help = await (dependencies.runProcess || runProcess)(vadSegmenterPath, ['-h'], {
    signal, timeoutMs: 5000, maxOutputBytes: 64 * 1024,
  });
  if (help.aborted || (signal && signal.aborted)) return { available: false, reason: 'vad_probe_aborted' };
  const helpText = String(help.stdout || '') + '\n' + String(help.stderr || '');
  if (help.exitCode !== 0 || help.timedOut || help.spawnFailed || help.outputLimitExceeded
    || !/(?:-f|--file)\b/.test(helpText)
    || !/(?:-vm|--vad-model)\b/.test(helpText)
    || !/(?:-vt|--vad-threshold)\b/.test(helpText)) {
    return { available: false, reason: 'vad_cli_incompatible' };
  }
  return { available: true, vadSegmenterPath, vadModelPath, modelSha256 };
}

function jsonOutputPrefix(args) {
  const index = args.indexOf('-of');
  return index >= 0 ? args[index + 1] : '';
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

function readPcmWavDuration(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const header = Buffer.alloc(12);
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length
      || header.toString('ascii', 0, 4) !== 'RIFF'
      || header.toString('ascii', 8, 12) !== 'WAVE') return null;
    let offset = 12;
    let format = null;
    let dataBytes = null;
    while (offset + 8 <= stat.size) {
      const chunkHeader = Buffer.alloc(8);
      if (fs.readSync(fd, chunkHeader, 0, 8, offset) !== 8) return null;
      const chunkName = chunkHeader.toString('ascii', 0, 4);
      const chunkSize = chunkHeader.readUInt32LE(4);
      const dataOffset = offset + 8;
      if (dataOffset + chunkSize > stat.size) return null;
      if (chunkName === 'fmt ' && chunkSize >= 16) {
        const fmt = Buffer.alloc(16);
        if (fs.readSync(fd, fmt, 0, 16, dataOffset) !== 16) return null;
        format = {
          audioFormat: fmt.readUInt16LE(0),
          channels: fmt.readUInt16LE(2),
          sampleRate: fmt.readUInt32LE(4),
          byteRate: fmt.readUInt32LE(8),
          bitsPerSample: fmt.readUInt16LE(14),
        };
      } else if (chunkName === 'data') {
        dataBytes = chunkSize;
      }
      offset = dataOffset + chunkSize + (chunkSize % 2);
    }
    if (!format || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== 16000
      || format.bitsPerSample !== 16 || !format.byteRate || !dataBytes) return null;
    return dataBytes / format.byteRate;
  } catch (_error) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_error) { /* descriptor is already closed */ }
    }
  }
}

async function runChannelsQualityRecovery(options = {}, dependencies = {}) {
  if (options.qualityIssue !== 'repeated-lines') return { decision: 'not_applicable' };
  if (options.signal && options.signal.aborted) return { decision: 'aborted', code: 'AbortError' };
  const run = dependencies.runProcess || runProcess;
  const hashFile = dependencies.sha256File || sha256File;
  const createTempDir = dependencies.createTempDir || (() => fs.promises.mkdtemp(path.join(os.tmpdir(), 'channels-asr-recovery-')));
  const cleanupTempDir = dependencies.cleanupTempDir || ((tempDir) => fs.promises.rm(tempDir, { recursive: true, force: true }));
  const required = ['inputAudioPath', 'vadSegmenterPath', 'vadModelPath', 'ffmpegPath', 'whisperPath', 'asrModelPath'];
  if (required.some((key) => !options[key])) return { decision: 'retain_quality_failure', reason: 'recovery_inputs_unavailable' };
  let vadHash;
  try { vadHash = String(await hashFile(options.vadModelPath)).toLowerCase(); } catch (_error) {
    return { decision: 'retain_quality_failure', reason: 'vad_model_unavailable' };
  }
  if (vadHash !== CHANNELS_VAD_MODEL_SHA256) return { decision: 'retain_quality_failure', reason: 'vad_model_unverified' };
  const signal = options.signal;
  let tempDir = '';
  try {
    tempDir = await createTempDir();
    const fullAudioPath = path.join(tempDir, 'full-audio-16k-mono.wav');
    const decode = await run(options.ffmpegPath, [
      '-v', 'error', '-nostdin', '-y', '-i', options.inputAudioPath,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', fullAudioPath,
    ], { signal, timeoutMs: options.processTimeoutMs || 120000, maxOutputBytes: 64 * 1024 });
    if (decode.aborted || (signal && signal.aborted)) return { decision: 'aborted', code: 'AbortError' };
    if (decode.exitCode !== 0 || decode.timedOut || decode.spawnFailed || decode.outputLimitExceeded || !fs.existsSync(fullAudioPath)) {
      return { decision: 'retain_quality_failure', reason: 'full_audio_decode_failed' };
    }
    const audioDurationSeconds = readPcmWavDuration(fullAudioPath);
    if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) {
      return { decision: 'retain_quality_failure', reason: 'decoded_audio_duration_unavailable' };
    }
    const vadRun = await run(options.vadSegmenterPath, [
      '-f', fullAudioPath, '-vm', options.vadModelPath, '-vt', String(CHANNELS_VAD_THRESHOLD), '-np',
    ], { signal, timeoutMs: options.processTimeoutMs || 120000 });
    if (vadRun.aborted || (signal && signal.aborted)) return { decision: 'aborted', code: 'AbortError' };
    if (vadRun.exitCode !== 0 || vadRun.timedOut || vadRun.spawnFailed || vadRun.outputLimitExceeded) {
      return { decision: 'retain_quality_failure', reason: 'vad_process_failed' };
    }
    const vadSegments = parseVadSpeechSegments(vadRun.stdout);
    if (!vadSegments) return { decision: 'retain_quality_failure', reason: 'vad_output_invalid' };
    if (vadSegments.some((segment) => segment.endSeconds > audioDurationSeconds + 0.05)) {
      return { decision: 'retain_quality_failure', reason: 'vad_coverage_invalid' };
    }
    if (!vadSegments.length) {
      return {
        decision: 'no_speech',
        errorCode: 'TRANSCRIPTION_NO_SPEECH',
        noSpeechEvidence: 'full-decode-and-vad-no-speech-segments',
        fullAudioProcessed: true,
        audioDurationSeconds,
        vadThreshold: CHANNELS_VAD_THRESHOLD,
        vadModelSha256: CHANNELS_VAD_MODEL_SHA256,
      };
    }
    const windows = mergeVadSpeechSegments(vadSegments, {
      maxGapSeconds: options.maxGapSeconds ?? MAX_GAP_SECONDS,
      maxWindowSeconds: options.maxWindowSeconds ?? MAX_WINDOW_SECONDS,
    });
    if (!windows || windows.length > MAX_VAD_SEGMENTS) return { decision: 'retain_quality_failure', reason: 'vad_windowing_invalid' };
    const validWindows = windows.filter((window) => window.endSeconds - window.startSeconds >= MIN_WINDOW_SECONDS
      && window.voicedSeconds >= MIN_VOICED_SECONDS
      && window.voicedSeconds / (window.endSeconds - window.startSeconds) >= MIN_VOICED_RATIO);
    const unresolvedVadWindowCount = windows.length - validWindows.length;
    if (!validWindows.length) return { decision: 'retain_quality_failure', reason: 'vad_activity_too_short_or_sparse' };
    const clipWindows = padVadSpeechWindows(validWindows, audioDurationSeconds, {
      paddingSeconds: options.windowPaddingSeconds ?? VAD_WINDOW_PADDING_SECONDS,
      maxWindowSeconds: options.maxWindowSeconds ?? MAX_WINDOW_SECONDS,
    });
    if (!clipWindows || !clipWindows.length || clipWindows.length > MAX_VAD_SEGMENTS) {
      return { decision: 'retain_quality_failure', reason: 'vad_padded_windowing_invalid' };
    }

    const asrWindows = [];
    for (let index = 0; index < clipWindows.length; index += 1) {
      if (signal && signal.aborted) return { decision: 'aborted', code: 'AbortError' };
      const window = clipWindows[index];
      const duration = window.endSeconds - window.startSeconds;
      const clipPath = path.join(tempDir, 'speech-window-' + index + '.wav');
      const ffmpeg = await run(options.ffmpegPath, [
        '-nostdin', '-y', '-ss', window.startSeconds.toFixed(3), '-i', fullAudioPath,
        '-t', duration.toFixed(3), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', clipPath,
      ], { signal, timeoutMs: options.processTimeoutMs || 120000 });
      if (ffmpeg.aborted || (signal && signal.aborted)) return { decision: 'aborted', code: 'AbortError' };
      if (ffmpeg.exitCode !== 0 || ffmpeg.timedOut || ffmpeg.spawnFailed || ffmpeg.outputLimitExceeded || !fs.existsSync(clipPath)) {
        return { decision: 'retain_quality_failure', reason: 'speech_clip_failed' };
      }
      const language = String(options.language || 'auto');
      const runWindowAsr = async (pass) => {
        const outputPrefix = path.join(tempDir, 'speech-window-' + index + '-pass-' + pass);
        const asrArgs = ['-m', options.asrModelPath, '-f', clipPath, '-l', language, '-t', String(options.threads || 4), '-ojf', '-of', outputPrefix];
        if (options.cpuOnly === true) asrArgs.push('-ng');
        const asr = await run(options.whisperPath, asrArgs, { signal, timeoutMs: options.processTimeoutMs || 120000 });
        if (asr.aborted || (signal && signal.aborted)) return { aborted: true };
        if (asr.exitCode !== 0 || asr.timedOut || asr.spawnFailed || asr.outputLimitExceeded) return { failed: true };
        const outputSegments = readJsonTranscript(jsonOutputPrefix(asrArgs));
        if (!outputSegments || !outputSegments.length) return { missing: true };
        return {
          text: outputSegments.map((segment) => segment.text).join('\n').trim(),
          confidence: summarizeTokenProbabilities(outputSegments.flatMap((segment) => segment.tokens)),
        };
      };
      const firstPass = await runWindowAsr(1);
      if (firstPass.aborted || (signal && signal.aborted)) return { decision: 'aborted', code: 'AbortError' };
      if (firstPass.failed) return { decision: 'retain_quality_failure', reason: 'speech_window_asr_failed' };
      if (firstPass.missing) return { decision: 'retain_quality_failure', reason: 'speech_window_transcript_missing' };
      const text = firstPass.text;
      const localQualityIssue = getTranscriptionQualityIssue(text);
      if (localQualityIssue && localQualityIssue !== 'repeated-lines') return { decision: 'retain_quality_failure', reason: 'speech_window_quality_rejected', qualityIssue: localQualityIssue };
      const confidence = firstPass.confidence;
      if (!confidence || confidence.count < MIN_TOKENS || confidence.mean < MIN_MEAN_TOKEN_PROBABILITY || confidence.median < MIN_MEDIAN_TOKEN_PROBABILITY) {
        return { decision: 'retain_quality_failure', reason: 'speech_window_confidence_low' };
      }
      const secondPass = await runWindowAsr(2);
      if (secondPass.aborted || (signal && signal.aborted)) return { decision: 'aborted', code: 'AbortError' };
      if (secondPass.failed || secondPass.missing) return { decision: 'retain_quality_failure', reason: 'speech_window_independent_rerun_failed' };
      const rerunSimilarity = textSimilarity(text, secondPass.text);
      if (rerunSimilarity < MIN_REPEAT_RERUN_SIMILARITY) return { decision: 'retain_quality_failure', reason: 'speech_window_rerun_inconsistent' };
      asrWindows.push({
        startSeconds: window.startSeconds,
        endSeconds: window.endSeconds,
        vadStartSeconds: window.vadStartSeconds,
        vadEndSeconds: window.vadEndSeconds,
        voicedSeconds: window.voicedSeconds,
        text,
        tokens: confidence.count,
        meanTokenProbability: confidence.mean,
        medianTokenProbability: confidence.median,
        rerunSimilarity,
      });
    }
    const transcript = asrWindows.map((window) => window.text).join('\n').trim();
    const finalQualityIssue = getTranscriptionQualityIssue(transcript);
    if (finalQualityIssue && finalQualityIssue !== 'repeated-lines') {
      return { decision: 'retain_quality_failure', reason: 'recovered_transcript_quality_rejected', qualityIssue: finalQualityIssue };
    }
    return {
      decision: unresolvedVadWindowCount > 0 ? 'partial_recovery'
        : (finalQualityIssue === 'repeated-lines' ? 'preserve_repeated_speech_candidate' : 'recovered'),
      confidence: 'limited',
      requiresQualityWarning: unresolvedVadWindowCount > 0 || finalQualityIssue === 'repeated-lines',
      qualityIssue: finalQualityIssue || '',
      unresolvedVadWindowCount,
      transcript,
      audioDurationSeconds,
      vadThreshold: CHANNELS_VAD_THRESHOLD,
      windowPaddingSeconds: options.windowPaddingSeconds ?? VAD_WINDOW_PADDING_SECONDS,
      vadModelSha256: CHANNELS_VAD_MODEL_SHA256,
      fullAudioProcessed: true,
      windows: asrWindows.map(({ text: _text, ...window }) => window),
      deduplicated: false,
    };
  } catch (_error) {
    return { decision: 'retain_quality_failure', reason: 'recovery_execution_failed' };
  } finally {
    if (tempDir) {
      try { await cleanupTempDir(tempDir); } catch (_error) { /* remove only this invocation's private temporary files */ }
    }
  }
}

module.exports = {
  CHANNELS_VAD_MODEL_SHA256,
  CHANNELS_VAD_THRESHOLD,
  assessChannelsVadResult: ({ exitCode, modelSha256, threshold, audioDurationSeconds, fullAudioProcessed, segments } = {}) => {
    const valid = exitCode === 0 && String(modelSha256 || '').toLowerCase() === CHANNELS_VAD_MODEL_SHA256
      && Number(threshold) === CHANNELS_VAD_THRESHOLD && fullAudioProcessed === true
      && Number.isFinite(Number(audioDurationSeconds)) && Number(audioDurationSeconds) > 0 && Array.isArray(segments);
    if (!valid) return { decision: 'retain_quality_failure', reason: 'vad_unavailable_or_incomplete' };
    if (!segments.length) return { decision: 'no_speech', errorCode: 'TRANSCRIPTION_NO_SPEECH', noSpeechEvidence: 'vad-no-speech-segments' };
    return { decision: 'speech_detected', segments };
  },
  inspectChannelsVadAssets,
  mergeVadSpeechSegments,
  padVadSpeechWindows,
  parseVadSpeechSegments,
  runChannelsQualityRecovery,
  runProcess,
  summarizeTokenProbabilities,
  textSimilarity,
};
