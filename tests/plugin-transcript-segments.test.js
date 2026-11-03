'use strict';
const assert = require('node:assert/strict');
const {
  groupTranscriptSegments,
  buildTranscriptSegmentsMarkdown,
  buildUntimedTranscriptMarkdown,
  transcriptSegmentsCoverText,
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
  assert.match(markdown, /^### \[00:00\]\n\n这条视频/m);
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
  assert.equal(blocks[0].text.replace(/[，。\s]/g, ''), finished.replace(/[，。\s]/g, ''));
  assert.equal(blocks[0].text.split('\n\n').length, 2, 'long timed text becomes shorter reading paragraphs');
  assert.equal(blocks[1].text, `${next}。`);
}

// 7. A phrase split across timed segments keeps its text and timestamp while
// readable paragraphs are kept under the shorter paragraph limit.
{
  const first = '甲'.repeat(70);
  const second = '乙'.repeat(20);
  const third = '丙'.repeat(20);
  const blocks = groupTranscriptSegments(segments([
    [0, 3000, first],
    [3000, 6000, second],
    [6000, 9000, third],
  ]));
  assert.equal(blocks.length, 1, 'short phrase segments keep one timeline block');
  assert.equal(blocks[0].text.replace(/[，。\s]/g, ''), first + second + third);
  assert.ok(blocks[0].text.includes('\n\n'));
}

// 8. Coarse ASR segments can contain an entire long, unpunctuated passage.
// Split it into readable paragraphs without inventing new timestamps or
// changing the spoken characters.
{
  const source = '这是一段没有标点的中文转写内容需要分成容易阅读的段落'.repeat(5);
  const markdown = buildTranscriptSegmentsMarkdown(segments([[0, 20000, source]]));
  const content = markdown
    .replace(/^## 分段转写\n\n/, '')
    .replace(/^### \[\d{2}:\d{2}\]\n\n/gm, '');
  const wordsOnly = (value) => value.replace(/[，。！？；、\s]/g, '');
  assert.equal(wordsOnly(content), wordsOnly(source));
  assert.match(markdown, /\n\n[^\n]/, 'sentences are separated into blank-line paragraphs');
  assert.equal((markdown.match(/\[\d{2}:\d{2}\]/g) || []).length, 1, 'paragraph splitting must not fabricate timestamps');
  assert.match(markdown.trim(), /[，。]$/);
}

// 12. Existing commas are not duplicated at a split or turned into the
// malformed "，。" ending seen in older notes.
{
  const source = '这是一段较长的口语转写，后面继续讲一个新的意思并且补充一些细节，然后再把这个意思说得更加清楚，最后结束。这些内容还需要接着说明更多细节。';
  const markdown = buildTranscriptSegmentsMarkdown(segments([[0, 20000, source]]));
  assert.doesNotMatch(markdown, /[，,]\s*[，,。]/);
  assert.doesNotMatch(markdown, /[，,]\s*。/);
  assert.match(markdown, /较长的口语转写，后面继续/);
  assert.ok((markdown.match(/\n\n[^\n]/g) || []).length >= 2, 'long transcript should break at spoken clause boundaries');
}

// 13. Providers without segment timing still get readable paragraphs, with
// no fabricated timestamp or extra explanatory text.
{
  const markdown = buildUntimedTranscriptMarkdown('第一句说完了。第二句也结束了！');
  assert.equal(markdown, '## 分段转写\n\n第一句说完了。\n\n第二句也结束了！\n');
  assert.equal((markdown.match(/\[\d{2}:\d{2}\]/g) || []).length, 0);
}

// 14. Timed segments must match the full transcript in order and content;
// percentage-based coverage can silently drop a meaningful tail.
{
  const full = '第一句的完整内容。第二句也要留在全文中。第三句不能因为时间戳缺失而消失。';
  const partial = segments([[0, 1000, '第一句的完整内容。第二句也要留在全文中。']]);
  assert.equal(transcriptSegmentsCoverText(partial, full), false, 'partial timed segments are not complete');
  const complete = segments([[0, 1000, full]]);
  assert.equal(transcriptSegmentsCoverText(complete, full), true, 'matching timed segments can retain the timeline');
  const sameLengthWrongTail = segments([[0, 1000, '第一句的完整内容。第二句也要留在全文中。第三句全部是替换内容。']]);
  assert.equal(transcriptSegmentsCoverText(sameLengthWrongTail, full), false, 'matching character counts cannot hide omitted words');
}

// 9. Existing sentence punctuation is preferred over a blind character cut.
{
  const source = '第一句已经说完。接下来是第二句，后面还有补充内容。';
  const blocks = groupTranscriptSegments(segments([[0, 20000, source.repeat(5)]]));
  assert.ok(blocks[0].text.includes('。\n\n'), 'long passages split at an existing sentence boundary');
}

// 10. Prefer a spoken clause cue over cutting an unpunctuated possessive phrase.
{
  const source = '我现在说的话录完音之后可以连同音频和转写的文字一起保存到知识库里面我们演示一下，比如这会儿我突然想到一个选题也不方便打字我就会先在手机上收集工具里面点击这个录音把想法说下来，录完之后它会自动提交然后回到电脑同步转写文案。';
  const text = groupTranscriptSegments(segments([[0, 20000, source]]))[0].text;
  assert.match(text, /打字。\n\n我就会先/);
  assert.doesNotMatch(text, /的\n\n/);
}

// 11. Even short timed segments with multiple punctuated sentences render one
// sentence per paragraph beneath a single timeline marker.
{
  const markdown = buildTranscriptSegmentsMarkdown(segments([[0, 4000, '第一句说完了。第二句也结束了！']]));
  assert.equal(markdown, '## 分段转写\n\n### [00:00]\n\n第一句说完了。\n\n第二句也结束了！\n');
}

console.log('plugin transcript segment tests passed');
