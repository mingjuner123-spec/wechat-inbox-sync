'use strict';

const QUALITY_PARTIAL_MARKER = '<!-- wechat-inbox-transcription-quality: partial -->';
const QUALITY_COMPLETE_MARKER = '<!-- wechat-inbox-transcription-quality: complete -->';
const QUALITY_NO_SPEECH_MARKER = '<!-- wechat-inbox-transcription-quality: no-speech -->';
const QUALITY_NOTICE_START = '<!-- wechat-inbox-transcription-notice:start -->';
const QUALITY_NOTICE_END = '<!-- wechat-inbox-transcription-notice:end -->';
const QUALITY_RESULT_START = '<!-- wechat-inbox-transcription-result:start -->';
const QUALITY_RESULT_END = '<!-- wechat-inbox-transcription-result:end -->';
const QUALITY_PARTIAL_NOTICE = '来源已保存，未能生成可靠的转写文字。可查看原视频是否含清晰人声；画面文字需单独提取。';

function isRejectedWechatChannelsTranscript(record) {
  const metadata = record && record.metadata && typeof record.metadata === 'object'
    ? record.metadata
    : {};
  return String(metadata.platform || '').trim() === '视频号'
    && String(metadata.transcriptionStatus || '').trim().toLowerCase() === 'failed'
    && String(metadata.transcriptionErrorCode || '').trim() === 'TRANSCRIPTION_LOW_QUALITY'
    && String(metadata.transcriptionQualityStatus || '').trim().toLowerCase() === 'rejected';
}

function getMarkdownLines(markdown) {
  const text = String(markdown || '');
  const lines = [];
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf('\n', offset);
    const end = newline < 0 ? text.length : newline + 1;
    const raw = text.slice(offset, end);
    lines.push({
      content: raw.replace(/\r?\n$/, ''),
      start: offset,
      end,
    });
    offset = end;
  }
  return lines;
}

function scanStandaloneManagedLines(markdown, markers) {
  const text = String(markdown || '');
  const found = [];
  let fenceCharacter = '';
  let fenceLength = 0;
  for (const line of getMarkdownLines(text)) {
    const trimmed = line.content.trim();
    const fence = /^\s*(\x60{3,}|~{3,})/.exec(line.content);
    if (fenceCharacter) {
      const close = new RegExp('^\\s*' + fenceCharacter + '{' + fenceLength + ',}\\s*$').test(line.content);
      if (close) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      continue;
    }
    if (fence) {
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
      continue;
    }
    if (!line.content.trimStart().startsWith('>') && markers.includes(trimmed)) {
      const start = line.start + line.content.indexOf(trimmed);
      found.push({ marker: trimmed, start, end: start + trimmed.length });
    }
  }
  return found;
}

function findManagedExactNoticeRange(markdown) {
  const lines = getMarkdownLines(markdown);
  let fenceCharacter = '';
  let fenceLength = 0;
  const outsideFence = lines.map((line) => {
    const fence = /^\s*(\x60{3,}|~{3,})/.exec(line.content);
    if (fenceCharacter) {
      const close = new RegExp('^\\s*' + fenceCharacter + '{' + fenceLength + ',}\\s*$').test(line.content);
      if (close) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      return false;
    }
    if (fence) {
      fenceCharacter = fence[1][0];
      fenceLength = fence[1].length;
      return false;
    }
    return true;
  });
  const expectedNotice = '> ' + QUALITY_PARTIAL_NOTICE;
  for (let index = 0; index + 2 < lines.length; index += 1) {
    if (!outsideFence[index] || !outsideFence[index + 1] || !outsideFence[index + 2]) continue;
    if (lines[index].content.trim() !== QUALITY_NOTICE_START
      || lines[index + 1].content !== expectedNotice
      || lines[index + 2].content.trim() !== QUALITY_NOTICE_END) continue;
    return { start: lines[index].start, end: lines[index + 2].end };
  }
  return null;
}

function getQualityPartialNoteState(markdown) {
  const found = scanStandaloneManagedLines(markdown, [
    QUALITY_COMPLETE_MARKER,
    QUALITY_NO_SPEECH_MARKER,
    QUALITY_PARTIAL_MARKER,
  ]);
  if (found.length === 0) return '';
  if (found.length !== 1) return 'ambiguous';
  if (found[0].marker === QUALITY_COMPLETE_MARKER) return 'complete';
  if (found[0].marker === QUALITY_NO_SPEECH_MARKER) return 'no_speech';
  return 'partial';
}

function addQualityPartialNotice(markdown) {
  const original = String(markdown || '');
  if (scanStandaloneManagedLines(original, [QUALITY_NOTICE_START]).length) return original;
  const text = original.replace(/\s+$/, '');
  const noticeBlock = QUALITY_NOTICE_START + '\n> ' + QUALITY_PARTIAL_NOTICE + '\n' + QUALITY_NOTICE_END;
  return text + '\n\n' + noticeBlock + '\n';
}

function addQualityPartialMarker(markdown) {
  let text = String(markdown || '');
  if (getQualityPartialNoteState(text)) return text;
  text = text.replace(/\s+$/, '');
  return text + '\n\n' + QUALITY_PARTIAL_MARKER + '\n';
}

function updateQualityPartialMarker(markdown, state = 'partial') {
  const text = String(markdown || '');
  if (!['partial', 'complete', 'no_speech'].includes(state)) return text;
  const current = getQualityPartialNoteState(text);
  if (!['partial', 'complete', 'no_speech'].includes(current) || current === state) return text;
  const from = current === 'partial' ? QUALITY_PARTIAL_MARKER
    : current === 'no_speech' ? QUALITY_NO_SPEECH_MARKER : QUALITY_COMPLETE_MARKER;
  const to = state === 'complete' ? QUALITY_COMPLETE_MARKER
    : state === 'no_speech' ? QUALITY_NO_SPEECH_MARKER : QUALITY_PARTIAL_MARKER;
  const found = scanStandaloneManagedLines(text, [from]);
  if (found.length !== 1) return text;
  return text.slice(0, found[0].start) + to + text.slice(found[0].end);
}

function updateQualityPartialFrontmatter(markdown, transcriptionStatus = 'success', conversionStatus = 'success') {
  const text = String(markdown || '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!match) return text;
  const block = match[1]
    .replace(/^(transcription_status:\s*)(?:['"]?failed['"]?)\s*$/im, '$1' + transcriptionStatus)
    .replace(/^(conversion_status:\s*)(?:['"]?partial['"]?)\s*$/im, '$1' + conversionStatus);
  return text.slice(0, match.index) + '---\n' + block + '\n---' + match[2]
    + text.slice(match.index + match[0].length);
}

function removeManagedNotice(markdown) {
  const range = findManagedExactNoticeRange(markdown);
  if (!range) return String(markdown || '');
  return String(markdown || '').slice(0, range.start) + String(markdown || '').slice(range.end);
}

function completeQualityPartialNote(markdown, transcription) {
  const text = String(markdown || '');
  const cleanTranscript = String(transcription || '').trim();
  if (getQualityPartialNoteState(text) !== 'partial' || !cleanTranscript) return null;
  let updated = updateQualityPartialFrontmatter(text);
  updated = removeManagedNotice(updated).replace(/\s+$/, '');
  updated = updateQualityPartialMarker(updated, 'complete');
  if (getQualityPartialNoteState(updated) !== 'complete') return null;
  const resultBlock = QUALITY_RESULT_START
    + '\n> 转写已完成，结果如下。\n\n## 转写全文\n\n'
    + cleanTranscript + '\n' + QUALITY_RESULT_END;
  return updated + '\n\n' + resultBlock + '\n';
}

function completeQualityPartialNoteNoSpeech(markdown, notice, recognizedNoSpeech = false) {
  const text = String(markdown || '');
  if (recognizedNoSpeech !== true || getQualityPartialNoteState(text) !== 'partial') return null;
  let updated = updateQualityPartialFrontmatter(text, 'no_speech', 'no_speech');
  updated = removeManagedNotice(updated).replace(/\s+$/, '');
  updated = updateQualityPartialMarker(updated, 'no_speech');
  if (getQualityPartialNoteState(updated) !== 'no_speech') return null;
  const resultBlock = QUALITY_RESULT_START
    + '\n> 本次识别未得到可转写语音。' + (notice ? '\n> ' + String(notice).trim() : '')
    + '\n' + QUALITY_RESULT_END;
  return updated + '\n\n' + resultBlock + '\n';
}

module.exports = {
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
  updateQualityPartialMarker,
};
