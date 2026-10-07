'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const utils = require(path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'src', 'transcription-partial-note-utils.js'));
const {
  QUALITY_PARTIAL_MARKER,
  QUALITY_COMPLETE_MARKER,
  QUALITY_NO_SPEECH_MARKER,
  QUALITY_PARTIAL_NOTICE,
  QUALITY_NOTICE_START,
  QUALITY_NOTICE_END,
  QUALITY_RESULT_START,
  QUALITY_RESULT_END,
  addQualityPartialMarker,
  addQualityPartialNotice,
  completeQualityPartialNote,
  completeQualityPartialNoteNoSpeech,
  getQualityPartialNoteState,
  isRejectedWechatChannelsTranscript,
} = utils;

function partialNote(body = '原始视频来源链接：https://example.test/video') {
  return [
    '---',
    'title: 视频号来源',
    'transcription_status: failed',
    'conversion_status: partial',
    '---',
    body,
    '',
    QUALITY_NOTICE_START,
    '> 来源已保存，未能生成可靠的转写文字。可查看原视频是否含清晰人声；画面文字需单独提取。',
    QUALITY_NOTICE_END,
    '',
    QUALITY_PARTIAL_MARKER,
    '',
  ].join('\n');
}

// Frontmatter edits are limited to the YAML header; matching prose in the
// user's note body must remain untouched.
{
  const bodyLine = 'transcription_status: failed';
  const note = partialNote(bodyLine);
  const completed = completeQualityPartialNote(note, '这是一段有效转写。');
  assert.ok(completed, 'a partial note with transcript should complete');
  assert.match(completed, /\ntranscription_status: success\n/);
  assert.match(completed, new RegExp('\\n' + bodyLine + '\\n'));
  assert.equal((completed.match(new RegExp(bodyLine, 'g')) || []).length, 1);
}

// A user-authored heading with the result's name must not swallow the newly
// generated result block.
{
  const note = partialNote('用户自己的章节：\n\n## 转写全文\n\n这是用户早先写下的内容。');
  const transcript = '这是这次新生成的转写正文。';
  const completed = completeQualityPartialNote(note, transcript);
  assert.ok(completed);
  assert.ok(completed.indexOf('这是用户早先写下的内容。') < completed.indexOf(QUALITY_RESULT_START));
  assert.ok(completed.indexOf(QUALITY_RESULT_START) < completed.indexOf(transcript));
  assert.ok(completed.includes(QUALITY_RESULT_END));
  assert.equal((completed.match(/## 转写全文/g) || []).length, 2);
}

// Completion is terminal and repeated calls cannot append a second result.
{
  const completed = completeQualityPartialNote(partialNote(), '完整转写文本。');
  assert.ok(completed);
  assert.equal(getQualityPartialNoteState(completed), 'complete');
  assert.equal(completeQualityPartialNote(completed, '完整转写文本。'), null);
  assert.equal((completed.match(new RegExp(QUALITY_RESULT_START, 'g')) || []).length, 1);
  assert.equal((completed.match(new RegExp(QUALITY_COMPLETE_MARKER, 'g')) || []).length, 1);
  assert.equal(completeQualityPartialNote(partialNote(), '   '), null, 'empty transcript must not complete');
}

// Failure prompt and state are managed additions; existing user text and
// status-like prose survive, and adding the managed blocks twice is harmless.
{
  const userText = '用户正文：conversion_status: partial\n> 自己写的说明';
  const marked = addQualityPartialMarker(userText);
  const updated = addQualityPartialNotice(marked);
  assert.ok(updated.startsWith(userText));
  assert.ok(updated.includes(QUALITY_NOTICE_START));
  assert.ok(updated.includes(QUALITY_NOTICE_END));
  assert.equal((updated.match(/用户正文：conversion_status: partial/g) || []).length, 1);
  assert.equal((updated.match(new RegExp(QUALITY_PARTIAL_MARKER, 'g')) || []).length, 1);
  assert.equal(addQualityPartialNotice(updated), updated, 'managed failure notice is idempotent');
  assert.equal(addQualityPartialMarker(updated), updated, 'managed state marker is idempotent');
}

// Marker-looking text inside a quote or fenced code sample is user content,
// not evidence that the note has entered the managed partial lifecycle.
{
  const fence = String.fromCharCode(96).repeat(3);
  for (const body of [
    fence + 'markdown\n' + QUALITY_PARTIAL_MARKER + '\n' + fence,
    '> ' + QUALITY_PARTIAL_MARKER,
  ]) {
    assert.equal(getQualityPartialNoteState(body), '', 'quoted or fenced marker must not set note state');
  }
}

// No-speech is a terminal success classification only with explicit
// recognized evidence. Missing/false evidence must leave the note partial.
{
  const note = partialNote();
  assert.equal(completeQualityPartialNoteNoSpeech(note, '没有返回转写文本。'), null);
  assert.equal(completeQualityPartialNoteNoSpeech(note, '没有返回转写文本。', false), null);
  assert.equal(getQualityPartialNoteState(note), 'partial');
  const confirmed = completeQualityPartialNoteNoSpeech(note, '识别到静音音轨。', true);
  assert.ok(confirmed);
  assert.equal(getQualityPartialNoteState(confirmed), 'no_speech');
  assert.ok(confirmed.includes(QUALITY_NO_SPEECH_MARKER));
  assert.ok(confirmed.includes(QUALITY_RESULT_END));
  assert.equal(completeQualityPartialNoteNoSpeech(confirmed, '', true), null, 'no-speech completion is terminal');
}

// Only the exact video-channel low-quality rejection enters this flow.
{
  const rejectedVideoChannel = {
    metadata: {
      platform: '视频号',
      transcriptionStatus: 'failed',
      transcriptionErrorCode: 'TRANSCRIPTION_LOW_QUALITY',
      transcriptionQualityStatus: 'rejected',
    },
  };
  assert.equal(isRejectedWechatChannelsTranscript(rejectedVideoChannel), true);
  for (const record of [
    {},
    { metadata: { platform: '视频号', transcriptionStatus: 'success', transcriptionErrorCode: 'TRANSCRIPTION_LOW_QUALITY', transcriptionQualityStatus: 'rejected' } },
    { metadata: { platform: '视频号', transcriptionStatus: 'failed', transcriptionErrorCode: 'NETWORK_ERROR', transcriptionQualityStatus: 'rejected' } },
    { metadata: { platform: '抖音', transcriptionStatus: 'failed', transcriptionErrorCode: 'TRANSCRIPTION_LOW_QUALITY', transcriptionQualityStatus: 'rejected' } },
  ]) {
    assert.equal(isRejectedWechatChannelsTranscript(record), false);
  }
}


// Duplicate or conflicting lifecycle markers are ambiguous. Terminal
// transitions fail closed instead of treating the first marker as authority.
{
  const duplicated = partialNote() + '\n' + QUALITY_PARTIAL_MARKER + '\n';
  const conflicting = partialNote() + '\n' + QUALITY_COMPLETE_MARKER + '\n';
  for (const ambiguous of [duplicated, conflicting]) {
    assert.equal(getQualityPartialNoteState(ambiguous), 'ambiguous');
    assert.equal(completeQualityPartialNote(ambiguous, '新的转写。'), null);
    assert.equal(completeQualityPartialNoteNoSpeech(ambiguous, '已确认静音。', true), null);
    assert.equal(utils.updateQualityPartialMarker(ambiguous, 'complete'), ambiguous);
  }
}

// A copied exact notice inside a fenced code sample is user content. Completion
// removes only the matching managed notice outside the fence.
{
  const fence = String.fromCharCode(96).repeat(3);
  const copiedNotice = [
    QUALITY_NOTICE_START,
    '> ' + QUALITY_PARTIAL_NOTICE,
    QUALITY_NOTICE_END,
  ].join('\n');
  const sample = fence + 'markdown\n' + copiedNotice + '\n' + fence;
  const note = partialNote(sample + '\n用户正文结束。');
  const completed = completeQualityPartialNote(note, '本次新转写。');
  assert.ok(completed);
  assert.ok(completed.includes(sample), 'the code sample must remain byte-for-byte present');
  assert.equal((completed.match(new RegExp(QUALITY_NOTICE_START, 'g')) || []).length, 1);
  assert.equal((completed.match(new RegExp(QUALITY_NOTICE_END, 'g')) || []).length, 1);
}
console.log('transcription partial note utils tests passed');
