'use strict';

const MAX_SEGMENTS = 5000;
const MAX_SEGMENT_TEXT = 2000;

function toFiniteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

// Accepts producer variants: startMs/endMs (local whisper), start_time/end_time
// (Doubao, milliseconds) and plain start/end seconds.
function readSegmentRange(item) {
  if (!item || typeof item !== 'object') return null;
  let startMs = toFiniteNumber(item.startMs);
  let endMs = toFiniteNumber(item.endMs);
  if (startMs === null) {
    if (item.start_time !== undefined || item.startTime !== undefined) {
      startMs = toFiniteNumber(item.start_time !== undefined ? item.start_time : item.startTime);
    } else if (item.start !== undefined) {
      const seconds = toFiniteNumber(item.start);
      startMs = seconds === null ? null : seconds * 1000;
    }
  }
  if (endMs === null) {
    if (item.end_time !== undefined || item.endTime !== undefined) {
      endMs = toFiniteNumber(item.end_time !== undefined ? item.end_time : item.endTime);
    } else if (item.end !== undefined) {
      const seconds = toFiniteNumber(item.end);
      endMs = seconds === null ? null : seconds * 1000;
    }
  }
  if (startMs === null && endMs === null) return null;
  const anchor = startMs === null ? endMs : startMs;
  return {
    startMs: Math.max(0, Math.round(startMs === null ? anchor : startMs)),
    endMs: Math.max(0, Math.round(endMs === null ? anchor : endMs)),
  };
}

function normalizeSpeakerLabel(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^说话人/.test(text)) return text;
  if (/^\d+$/.test(text)) return `说话人${text}`;
  return text;
}

function normalizeTranscriptSegments(value) {
  const list = Array.isArray(value) ? value : [];
  const result = [];
  const seen = new Set();
  for (const item of list) {
    if (result.length >= MAX_SEGMENTS) break;
    const range = readSegmentRange(item);
    if (!range) continue;
    const rawText = typeof item === 'string' ? item : (item.text || item.content || '');
    const text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SEGMENT_TEXT);
    if (!text) continue;
    // A negative range means the producer did not know the timing; drop it
    // rather than rendering a misleading timestamp.
    if (range.endMs < range.startMs) continue;
    const speaker = normalizeSpeakerLabel(item.speaker !== undefined ? item.speaker : item.speakerId);
    const key = `${range.startMs}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      startMs: range.startMs,
      endMs: range.endMs,
      text,
      ...(speaker ? { speaker } : {}),
    });
  }
  result.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return result;
}

function formatTranscriptTimestamp(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

// Whisper emits a segment every phrase, which reads like a wall of one-line
// timestamps. Group them the way meeting-transcript products do: one timestamp
// per readable paragraph, split on speaker change, a real pause, or length.
const BLOCK_MAX_CHARS = 80;
// Slight overflow is better than cutting a sentence in half, so the hard split
// only applies once the block is clearly long.
const BLOCK_SOFT_MAX_CHARS = 140;
const BLOCK_MAX_DURATION_MS = 30000;
const BLOCK_GAP_BREAK_MS = 1200;
const CJK_PATTERN = /[　-〿㐀-鿿＀-￯]$/;
const CJK_START_PATTERN = /^[　-〿㐀-鿿＀-￯]/;
const CJK_ANY_PATTERN = /[　-〿㐀-鿿＀-￯]/;
const SENTENCE_END_PATTERN = /[。！？!?…；;]$/;
const QUESTION_TAIL_PATTERN = /(吗|呢|吧|么|嘛|对不对|是不是|好不好|行不行|有没有|能不能|可不可以)$/;

function joinSegmentTexts(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a) return b;
  if (!b) return a;
  // Chinese text should not grow artificial spaces; latin text should.
  return CJK_PATTERN.test(a) || CJK_START_PATTERN.test(b) ? `${a}${b}` : `${a} ${b}`;
}

function hasCjk(text) {
  return CJK_ANY_PATTERN.test(String(text || ''));
}

// Local ASR often returns unpunctuated Chinese. The pause between two segments
// is the best free signal we have: a short gap is the same phrase, a longer one
// is a clause, and the block break already handles real silence.
function punctuationForGap(gapMs, previousText) {
  if (!previousText || SENTENCE_END_PATTERN.test(String(previousText).trim())) return '';
  if (gapMs >= 650) return '。';
  if (gapMs >= 300) return '，';
  return '';
}

function ensureTerminalPunctuation(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !hasCjk(trimmed) || SENTENCE_END_PATTERN.test(trimmed)) return trimmed;
  return trimmed + (QUESTION_TAIL_PATTERN.test(trimmed) ? '？' : '。');
}

function groupTranscriptSegments(value) {
  const segments = normalizeTranscriptSegments(value);
  const blocks = [];
  let current = null;
  for (const segment of segments) {
    const gap = current ? segment.startMs - current.endMs : 0;
    const wouldOverflow = current && current.text.length + segment.text.length > BLOCK_MAX_CHARS;
    const startsNewBlock = !current
      || (segment.speaker && current.speaker && segment.speaker !== current.speaker)
      || (!current.speaker && segment.speaker)
      || gap >= BLOCK_GAP_BREAK_MS
      || segment.startMs - current.startMs >= BLOCK_MAX_DURATION_MS
      // Prefer to break where the previous sentence already ended, or once the
      // block is long enough that holding the line costs more than it saves.
      || (wouldOverflow && (
        SENTENCE_END_PATTERN.test(current.text.trim())
        || current.text.length >= BLOCK_SOFT_MAX_CHARS
      ));
    if (startsNewBlock) {
      if (current) current.text = ensureTerminalPunctuation(current.text);
      current = {
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        ...(segment.speaker ? { speaker: segment.speaker } : {}),
      };
      blocks.push(current);
      continue;
    }
    const mark = hasCjk(current.text) ? punctuationForGap(gap, current.text) : '';
    current.text = mark ? `${current.text}${mark}${segment.text}` : joinSegmentTexts(current.text, segment.text);
    current.endMs = Math.max(current.endMs, segment.endMs);
  }
  if (current) current.text = ensureTerminalPunctuation(current.text);
  return blocks;
}

function buildTranscriptSegmentsMarkdown(value) {
  const blocks = groupTranscriptSegments(value);
  if (!blocks.length) return '';
  // Whisper.cpp cannot tell speakers apart; a single "说话人1" on every line is
  // noise, so labels only appear when the transcript really has more than one.
  const speakers = new Set(blocks.map((block) => block.speaker).filter(Boolean));
  const showSpeakers = speakers.size > 1;
  const lines = blocks.map((block) => {
    const stamp = `[${formatTranscriptTimestamp(block.startMs)}]`;
    const speaker = showSpeakers && block.speaker ? `${block.speaker}：` : '';
    return `- ${stamp} ${speaker}${block.text}`;
  });
  return ['## 分段转写', '', ...lines, ''].join('\n');
}

function countTranscriptCoreCharacters(value) {
  return String(value || '').replace(/[\s\p{P}\p{S}]/gu, '').length;
}

// Notes used to print the whole transcript and then the same text again as
// timed segments. The segment list is the better reading surface, so the flat
// copy is only kept when the segments miss a meaningful part of the text
// (partial chunk recovery, or a producer that only timed the first minutes).
function transcriptSegmentsCoverText(segments, transcription) {
  const textCharacters = countTranscriptCoreCharacters(transcription);
  if (!textCharacters) return false;
  const segmentCharacters = normalizeTranscriptSegments(segments)
    .reduce((total, segment) => total + countTranscriptCoreCharacters(segment.text), 0);
  if (!segmentCharacters) return false;
  return segmentCharacters >= textCharacters * 0.6;
}

function parseTranscriptSegmentsSidecar(value) {
  let payload = value;
  if (typeof value === 'string') {
    try {
      payload = JSON.parse(value);
    } catch (error) {
      return [];
    }
  }
  if (!payload || typeof payload !== 'object') return [];
  const segments = Array.isArray(payload.segments)
    ? payload.segments
    : (Array.isArray(payload.transcription) ? payload.transcription : []);
  return normalizeTranscriptSegments(segments);
}

function extractDoubaoUtteranceSegments(payload) {
  const data = typeof payload === 'string'
    ? (() => {
      try {
        return JSON.parse(payload);
      } catch (error) {
        return null;
      }
    })()
    : payload;
  const result = data && data.result;
  const groups = Array.isArray(result) ? result : [result];
  const segments = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const utterances = Array.isArray(group.utterances) ? group.utterances : [];
    for (const utterance of utterances) {
      if (!utterance || typeof utterance !== 'object') continue;
      const text = String(utterance.text || utterance.result_text || utterance.utterance_text || '').trim();
      if (!text) continue;
      const additions = utterance.additions && typeof utterance.additions === 'object' ? utterance.additions : {};
      const speaker = utterance.speaker
        || utterance.speaker_id
        || utterance.spk
        || utterance.speakerId
        || additions.speaker
        || additions.speaker_id
        || additions.spk
        || additions.speakerId;
      segments.push({
        startMs: utterance.start_time !== undefined ? utterance.start_time : utterance.startTime,
        endMs: utterance.end_time !== undefined ? utterance.end_time : utterance.endTime,
        text,
        speaker,
      });
    }
  }
  return normalizeTranscriptSegments(segments);
}

module.exports = {
  normalizeTranscriptSegments,
  normalizeSpeakerLabel,
  formatTranscriptTimestamp,
  groupTranscriptSegments,
  buildTranscriptSegmentsMarkdown,
  transcriptSegmentsCoverText,
  parseTranscriptSegmentsSidecar,
  extractDoubaoUtteranceSegments,
};
