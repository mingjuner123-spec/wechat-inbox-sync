'use strict';
const assert = require('node:assert/strict');
const {
  groupTranscriptSegments,
  buildTranscriptSegmentsMarkdown,
} = require('../obsidian-plugin/wechat-inbox-sync/src/transcript-segment-utils');

function segments(list) {
  return list.map(([startMs, endMs, text, speaker]) => ({ startMs, endMs, text, ...(speaker ? { speaker } : {}) }));
}

// 1. Local ASR has no real diarization, so a transcript with one speaker must
// not repeat a "说话人1" label on every line.
{
  const markdown = buildTranscriptSegmentsMarkdown(segments([
    [0, 3000, '这条视频里的每一帧都是AI写代码画出来的', '说话人1'],
    [3000, 6000, '没有用任何生图或者生视频的模型', '说话人1'],
  ]));
  assert.doesNotMatch(markdown, /说话人/);
  assert.match(markdown, /^- \[00:00\] 这条视频/m);
}

// 2. A real multi-speaker transcript keeps its labels.
{
  const markdown = buildTranscriptSegmentsMarkdown(segments([
    [0, 3000, '我们先看第一部分', '说话人1'],
    [1500, 4000, '好的', '说话人2'],
  ]));
  assert.match(markdown, /说话人1：/);
  assert.match(markdown, /说话人2：/);
}

// 3. Unpunctuated Chinese gets sentence marks from the pauses between
// segments, and every block ends with a mark instead of running on.
{
  const blocks = groupTranscriptSegments(segments([
    [0, 1800, '第一个工具专门做网页宣传片'],
    [2200, 4200, '给它一个网址它会打开真实页面去截图'],
    [4700, 7000, '再从配方卡里挑镜头和音效'],
  ]));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, '第一个工具专门做网页宣传片，给它一个网址它会打开真实页面去截图，再从配方卡里挑镜头和音效。');
}

// 4. Latin-only text keeps its own spacing and is not given Chinese marks.
{
  const blocks = groupTranscriptSegments(segments([
    [0, 1000, 'Hello world'],
    [1400, 2000, 'this is a test'],
  ]));
  assert.equal(blocks[0].text, 'Hello world this is a test');
  assert.doesNotMatch(blocks[0].text, /[，。]/);
}

// 5. A question keeps its question mark instead of a full stop.
{
  const blocks = groupTranscriptSegments(segments([[0, 2000, '你学会了吗']]));
  assert.equal(blocks[0].text, '你学会了吗？');
}

// 6. Blocks break at a finished sentence rather than cutting the next phrase.
{
  const finished = `${'甲'.repeat(75)}。`;
  const next = '乙'.repeat(30);
  const blocks = groupTranscriptSegments(segments([
    [0, 3000, finished],
    [3000, 6000, next],
  ]));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, finished);
  assert.equal(blocks[1].text, `${next}。`);
}

// 7. A phrase split across two segments is not cut just because the block
// reached the character limit mid-sentence.
{
  const first = '甲'.repeat(70);
  const second = '乙'.repeat(20);
  const third = '丙'.repeat(20);
  const blocks = groupTranscriptSegments(segments([
    [0, 3000, first],
    [3000, 6000, second],
    [6000, 9000, third],
  ]));
  assert.equal(blocks.length, 1, 'a mid-sentence phrase stays together well past 80 characters');
  assert.ok(blocks[0].text.startsWith(first + second));
}

console.log('plugin transcript segment tests passed');
