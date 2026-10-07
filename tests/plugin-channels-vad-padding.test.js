'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const qualityUtilsPath = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync/src/transcription-quality-utils.js');
require.cache[qualityUtilsPath] = {
  id: qualityUtilsPath,
  filename: qualityUtilsPath,
  loaded: true,
  exports: { getTranscriptionQualityIssue: () => '' },
};
const { mergeVadSpeechSegments, padVadSpeechWindows } = require('../obsidian-plugin/wechat-inbox-sync/src/channels-asr-quality-recovery');

test('merges overlapping VAD intervals and counts voiced coverage only once', () => {
  const [merged] = mergeVadSpeechSegments([
    { startSeconds: 0, endSeconds: 2 },
    { startSeconds: 1, endSeconds: 3 },
  ], { maxGapSeconds: 0 });
  assert.equal(merged.startSeconds, 0);
  assert.equal(merged.endSeconds, 3);
  assert.equal(merged.voicedSeconds, 3);
  assert.equal(mergeVadSpeechSegments([
    { startSeconds: 0, endSeconds: 20 },
    { startSeconds: 10, endSeconds: 31 },
  ], { maxGapSeconds: 0 }), null);
});

test('adds 150 ms context while retaining the original VAD speech interval', () => {
  const [window] = padVadSpeechWindows([
    { startSeconds: 0.32, endSeconds: 10.69, voicedSeconds: 8.06 },
  ], 11);
  assert.equal(window.startSeconds, 0.17);
  assert.equal(window.endSeconds, 10.84);
  assert.equal(window.vadStartSeconds, 0.32);
  assert.equal(window.vadEndSeconds, 10.69);
  assert.equal(window.voicedSeconds, 8.06);
});

test('clamps padding to media boundaries and never exceeds the 30-second clip cap', () => {
  const [atEdges] = padVadSpeechWindows([
    { startSeconds: 0.1, endSeconds: 9.9, voicedSeconds: 8 },
  ], 10);
  assert.equal(atEdges.startSeconds, 0);
  assert.equal(atEdges.endSeconds, 10);

  const [nearCap] = padVadSpeechWindows([
    { startSeconds: 0.2, endSeconds: 29.95, voicedSeconds: 28 },
  ], 40);
  assert.ok(nearCap.endSeconds - nearCap.startSeconds <= 30);
  assert.ok(nearCap.startSeconds >= 0);
  assert.ok(nearCap.endSeconds <= 40);
});

test('coalesces overlapping padded clips so one speech span is not transcribed twice', () => {
  const windows = padVadSpeechWindows([
    { startSeconds: 1, endSeconds: 2, voicedSeconds: 0.9 },
    { startSeconds: 2.2, endSeconds: 3, voicedSeconds: 0.7 },
  ], 4);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].startSeconds, 0.85);
  assert.equal(windows[0].endSeconds, 3.15);
  assert.equal(windows[0].voicedSeconds, 1.6);
});

test('keeps separated long clips non-overlapping when coalescing would exceed the cap', () => {
  const windows = padVadSpeechWindows([
    { startSeconds: 0, endSeconds: 20, voicedSeconds: 19 },
    { startSeconds: 20.2, endSeconds: 40.2, voicedSeconds: 19 },
  ], 45);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].endSeconds, windows[1].startSeconds);
  for (const window of windows) assert.ok(window.endSeconds - window.startSeconds <= 30);
  assert.equal(windows[1].endSeconds, 40.35, 'the final padded segment remains present');
});

test('rejects invalid, out-of-duration, and overlong VAD input', () => {
  assert.equal(padVadSpeechWindows([], 0), null);
  assert.equal(padVadSpeechWindows([{ startSeconds: 2, endSeconds: 1, voicedSeconds: 1 }], 3), null);
  assert.equal(padVadSpeechWindows([{ startSeconds: 0, endSeconds: 31, voicedSeconds: 30 }], 40), null);
  assert.equal(padVadSpeechWindows([{ startSeconds: 0, endSeconds: 2.2, voicedSeconds: 2 }], 2), null);
});
