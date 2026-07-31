'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'record-state-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');

assert.ok(fs.existsSync(modulePath), 'record state utils module must exist');

const {
  isAudioVideoTranscriptionIncompleteRecord,
  isCloudTranscriptionWaitingRecord,
} = require(modulePath);

for (const metadata of [
  { transcriptionMode: 'cloud', transcriptionStatus: 'pending' },
  { cloudTranscriptionRequested: true, transcriptionStatus: 'queued' },
  { transcriptionSource: 'cloud-pretranscription', transcriptionStatus: 'processing' },
  { transcriptionProvider: 'some-cloud-provider', transcriptionStatus: 'pending' },
]) {
  assert.strictEqual(isCloudTranscriptionWaitingRecord({ metadata }), true);
}
assert.strictEqual(isCloudTranscriptionWaitingRecord({
  metadata: { transcriptionMode: 'cloud', transcriptionStatus: 'processing', transcription: '已经完成' },
}), false);
assert.strictEqual(isCloudTranscriptionWaitingRecord({
  metadata: { transcriptionMode: 'cloud', transcriptionStatus: 'failed' },
}), false);
assert.strictEqual(isCloudTranscriptionWaitingRecord({
  metadata: { transcriptionStatus: 'pending' },
}), false);

for (const record of [
  { type: 'voice', metadata: { transcriptionStatus: 'pending' } },
  { type: 'file', metadata: { webpageMediaType: 'audio_video', transcriptionStatus: 'queued' } },
  { type: 'file', metadata: { audioFileID: 'cloud://audio', transcriptionStatus: 'processing' } },
  { type: 'file', metadata: { transcriptOnly: true, transcriptionStatus: 'failed' } },
]) {
  assert.strictEqual(isAudioVideoTranscriptionIncompleteRecord(record), true);
}
assert.strictEqual(isAudioVideoTranscriptionIncompleteRecord({
  type: 'voice',
  metadata: { transcriptionStatus: 'failed', markdown: '# 已有正文' },
}), false);
assert.strictEqual(isAudioVideoTranscriptionIncompleteRecord({
  type: 'voice',
  metadata: { transcriptionStatus: 'failed', transcription: '已经完成' },
}), false);
assert.strictEqual(isAudioVideoTranscriptionIncompleteRecord({
  type: 'text',
  metadata: { transcriptionStatus: 'failed' },
}), false);

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'isCloudTranscriptionWaitingRecord',
  'isAudioVideoTranscriptionIncompleteRecord',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./record-state-utils')"),
  'src/main.js must consume the extracted record state module',
);
