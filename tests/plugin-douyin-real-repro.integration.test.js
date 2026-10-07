'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Module = require('node:module');

const envValue = (name) => {
  if (!process.env[name]) throw new Error('missing ' + name);
  return process.env[name];
};
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function loadPlugin() {
  const oldLoad = Module._load;
  const oldExtensions = {};
  for (const ext of ['.ps1', '.sh', '.py']) {
    oldExtensions[ext] = Module._extensions[ext];
    Module._extensions[ext] = (mod, file) => { mod.exports = fs.readFileSync(file, 'utf8'); };
  }
  Module._load = function (request, ...args) {
    if (request === 'obsidian') return {
      Plugin: class {}, Modal: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {},
      requestUrl: async () => { throw new Error('unexpected network request'); },
    };
    return oldLoad.call(this, request, ...args);
  };
  try {
    return require('../obsidian-plugin/wechat-inbox-sync/src/main');
  } finally {
    Module._load = oldLoad;
    for (const ext of Object.keys(oldExtensions)) {
      if (oldExtensions[ext]) Module._extensions[ext] = oldExtensions[ext];
      else delete Module._extensions[ext];
    }
  }
}

function linkOrCopy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try { fs.linkSync(source, target); } catch (_) { fs.copyFileSync(source, target); }
}

function isolateWrapper(source, target) {
  const anchor = '$baseCandidates = @()';
  let script = fs.readFileSync(source, 'utf8');
  assert.equal(script.split(anchor).length - 1, 1, 'wrapper temp isolation anchor must be unique');
  script = script.replace(anchor, '$baseCandidates = @((Join-Path $Root "tmp"))');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, script, 'utf8');
}

function inspectMedia(ffmpeg, media) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-i', media], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  const text = String(result.stdout || '') + '\n' + String(result.stderr || '');
  const match = text.match(/Duration:\s*(\d{2,}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
  const hasAudio = /Stream #[^\r\n]*Audio:/i.test(text);
  assert.ok(duration > 0 && duration < 30, 'expected a short decodable media');
  assert.equal(hasAudio, true, 'media must contain an audio stream');
  return { duration, hasAudio };
}

function textMetrics(value) {
  const text = String(value || '').trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalized = lines.map((line) => line.toLowerCase().replace(/\s+/g, ' '));
  const duplicateCount = normalized.filter((line, i) => i > 0 && line === normalized[i - 1]).length;
  return {
    characters: Array.from(text).length,
    hanCharacters: (text.match(/[\u3400-\u9fff]/g) || []).length,
    latinWords: (text.match(/[A-Za-z]+/g) || []).length,
    nonEmptyLines: lines.length,
    repeatedAdjacentLineRatio: lines.length ? duplicateCount / lines.length : 0,
  };
}

async function main() {
  if (process.platform !== 'win32') {
    process.stdout.write('SKIP: requires authorized Windows ASR host.\n');
    return;
  }
  const sourceMedia = envValue('DOUYIN_REAL_MEDIA');
  const installedRoot = envValue('DOUYIN_INSTALLED_ASR_ROOT');
  const sources = {
    wrapper: path.join(installedRoot, 'transcribe.ps1'),
    whisper: path.join(installedRoot, 'whisper', 'Release', 'whisper-cli.exe'),
    model: path.join(installedRoot, 'models', 'ggml-small.bin'),
    ffmpeg: path.join(installedRoot, 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin', 'ffmpeg.exe'),
  };
  for (const file of [sourceMedia, ...Object.values(sources)]) {
    assert.ok(fs.statSync(file).isFile(), 'authorized local media or ASR component missing');
  }
  const originalIdentity = {
    whisperSha256: digest(sources.whisper),
    modelSha256: digest(sources.model),
    modelBytes: fs.statSync(sources.model).size,
    ffmpegSha256: digest(sources.ffmpeg),
  };
  const Plugin = loadPlugin();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin local plugin repro with spaces-'));
  let plugin;
  try {
    const installRoot = path.join(scratch, 'isolated asr root');
    const whisper = path.join(installRoot, 'whisper', 'Release', 'whisper-cli.exe');
    const model = path.join(installRoot, 'models', 'ggml-small.bin');
    const ffmpeg = path.join(installRoot, 'ffmpeg', 'ffmpeg.exe');
    const wrapper = path.join(installRoot, 'transcribe.ps1');
    const inputDir = path.join(installRoot, 'input');
    linkOrCopy(sources.whisper, whisper);
    linkOrCopy(sources.model, model);
    linkOrCopy(sources.ffmpeg, ffmpeg);
    isolateWrapper(sources.wrapper, wrapper);
    fs.mkdirSync(inputDir, { recursive: true });
    const mediaProbeCopy = path.join(inputDir, 'duration-probe.mp4');
    fs.copyFileSync(sourceMedia, mediaProbeCopy);
    const media = inspectMedia(ffmpeg, mediaProbeCopy);

    plugin = new Plugin();
    plugin.settings = { aiProvider: 'local' };
    plugin.ensureLocalComponentReadyForUse = async () => {};
    plugin.recoverStaleLocalTranscriptionCommand = async () => {};
    plugin.getConfiguredLocalAsrPlatform = () => 'win32';
    plugin.getConfiguredLocalAsrInstallRoot = () => installRoot;
    plugin.getEffectiveLocalTranscriptionCommand = () => Plugin.__test.getDefaultLocalTranscriptionCommand('win32', installRoot);
    plugin.getLocalAsrInstallStatus = () => ({
      ready: true, scriptOutdated: false, whisperPath: whisper, modelPath: model, ffmpegPath: ffmpeg, scriptPath: wrapper,
    });
    plugin.setTranscriptionStopAvailable = () => {};
    plugin.showSyncProgress = () => {};
    let downloadCount = 0;
    let cloudCalls = 0;
    plugin.downloadMediaToTempFile = async () => {
      downloadCount += 1;
      const copy = path.join(inputDir, 'plugin-input-' + downloadCount + '.mp4');
      fs.copyFileSync(sourceMedia, copy);
      return copy;
    };
    plugin.runCloudFallbackTranscription = async () => {
      cloudCalls += 1;
      throw new Error('cloud transcription forbidden in this test');
    };

    const direct = await plugin.runLocalTranscription('local-fixture://authorized-media', {
      recordId: 'local-repro-direct',
    });
    const directStats = textMetrics(direct);
    assert.ok(directStats.characters >= 8, 'real runLocalTranscription must return usable text');
    assert.equal(Plugin.__test.getTranscriptionQualityIssue(direct), '', 'direct output must pass quality guard');

    const sourceUrl = 'https://www.douyin.com/video/7000000000000000000';
    const sourceTitle = 'Local reproduction media';
    const record = await plugin.buildTranscriptRecordFromMedia({
      recordId: 'local-repro-record',
      content: sourceUrl,
      metadata: { title: sourceTitle, contentCategory: 'audio-video' },
    }, {
      url: sourceUrl,
      platform: '\u6296\u97f3',
      mediaUrl: 'https://fixture.invalid/local-repro.mp4',
      preparedMedia: true,
      source: 'media-url',
      title: sourceTitle,
      sourceTitle,
    });
    const metadata = record && record.metadata || {};
    const transcript = String(metadata.transcription || '').trim();
    const recordStats = textMetrics(transcript);
    assert.equal(metadata.transcriptionStatus, 'success');
    assert.equal(metadata.conversionStatus, 'success');
    assert.equal(metadata.transcriptionSource, 'local');
    assert.equal(metadata.url, sourceUrl);
    assert.equal(metadata.title, sourceTitle);
    assert.ok(recordStats.characters >= 8);
    assert.equal(Plugin.__test.getTranscriptionQualityIssue(transcript), '');
    assert.equal(cloudCalls, 0, 'the test must make no cloud ASR requests');
    assert.equal(downloadCount, 2, 'direct and record methods each copy the same local media');

    const summary = {
      status: 'PASS',
      platform: 'win32',
      sourceDurationSeconds: Number(media.duration.toFixed(2)),
      audioStreamPresent: media.hasAudio,
      engine: 'whisper-cli.exe',
      engineSha256: originalIdentity.whisperSha256,
      model: 'ggml-small.bin',
      modelBytes: originalIdentity.modelBytes,
      modelSha256: originalIdentity.modelSha256,
      ffmpegSha256: originalIdentity.ffmpegSha256,
      cpuMode: 'installed-wrapper-default',
      runLocalTranscription: directStats,
      buildTranscriptRecordFromMedia: recordStats,
      sourceUrlPreserved: metadata.url === sourceUrl,
      titlePreserved: metadata.title === sourceTitle,
      transcriptionStatus: metadata.transcriptionStatus,
      conversionStatus: metadata.conversionStatus,
      cloudCalls: cloudCalls,
      isolatedMediaCopies: downloadCount,
      sourceMediaHash: 'withheld',
      sourceAndInstalledComponentsModified: false,
    };
    if (process.env.DOUYIN_SAFE_RESULT) {
      const target = path.resolve(process.env.DOUYIN_SAFE_RESULT);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    }
    process.stdout.write(JSON.stringify(summary) + '\n');
  } finally {
    plugin && plugin.currentTranscriptionAbortController && plugin.currentTranscriptionAbortController.abort();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const code = String(error && (error.code || error.name) || 'LOCAL_REPRO_FAILED');
  const message = String(error && (error.message || error) || '').split(/\r?\n/)[0];
  process.stderr.write(code + ': ' + message + '\n');
  process.exitCode = 1;
});
