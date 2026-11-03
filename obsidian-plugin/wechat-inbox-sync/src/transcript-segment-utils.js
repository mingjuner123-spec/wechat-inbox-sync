'use strict';

const MAX_SEGMENTS = 5000;
const { cleanTranscriptionTail } = require('./readable-content-utils');

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
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
    const text = String(rawText || '').replace(/\s+/g, ' ').trim();
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
const BLOCK_PARAGRAPH_MAX_CHARS = 44;
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

function splitLongTranscriptParagraph(text) {
  const source = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。！？；、,.!?;:：])/g, '$1')
    .replace(/([，,])\s*([，,])+/g, '$1')
    .trim();
  if (!source) return source;
  if (!hasCjk(source)) return splitEnglishTranscript(source);

  // Keep every spoken sentence in its own paragraph, even when the segment is
  // short. Segment providers may put several sentences into one timed chunk.
  const sentences = splitTranscriptSentences(source);
  const paragraphs = [];
  for (const sentence of sentences) {
    const split = splitLongTranscriptClause(sentence.trim());
    if (split) paragraphs.push(...split.split('\n\n'));
  }
  return paragraphs.join('\n\n');
}

function splitTranscriptSentences(source) {
  // Keep abbreviations, decimals and the recognizer's words. A long sentence
  // without punctuation can only be wrapped, not semantically reconstructed.
  const sentences = [];
  let start = 0;
  const boundary = /[。！？!?…]+["'”’」』)]*|[.]+["'”’)]*(?=\s|$)/g;
  let match;
  while ((match = boundary.exec(source))) {
    const end = match.index + match[0].length;
    const prefix = source.slice(start, end);
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.$/i.test(prefix)
      || /\b[A-Z]\.$/.test(prefix)) continue;
    sentences.push(prefix.trim());
    start = end;
  }
  if (source.slice(start).trim()) sentences.push(source.slice(start).trim());
  return sentences;
}

function splitEnglishTranscript(source) {
  const sentences = splitTranscriptSentences(source);
  const paragraphs = [];
  for (let sentence of sentences) {
    while (sentence.length > 240) {
      const window = sentence.slice(0, 241);
      const clauses = [...window.matchAll(/[,;:]\s+/g)].filter(item => item.index >= 100);
      const splitAt = clauses.length ? clauses[clauses.length - 1].index + 1 : window.lastIndexOf(' ');
      if (splitAt <= 0) break; // Never cut a word to meet the display limit.
      paragraphs.push(sentence.slice(0, splitAt).trim());
      sentence = sentence.slice(splitAt).trim();
    }
    if (sentence) paragraphs.push(sentence);
  }
  return paragraphs.join('\n\n');
}

function cleanTimedSegments(value) {
  const segments = normalizeTranscriptSegments(value);
  const text = segments.map(segment => segment.text).join('\n');
  const cleaned = cleanTranscriptionTail(text);
  return cleaned === text ? segments : segments.slice(0, cleaned.split('\n').length);
}

function splitLongTranscriptClause(source) {
  if (!source || source.length <= BLOCK_PARAGRAPH_MAX_CHARS) return source;
  const paragraphs = [];
  let remaining = source;
  while (remaining.length > BLOCK_PARAGRAPH_MAX_CHARS) {
    const limit = BLOCK_PARAGRAPH_MAX_CHARS;
    const minBreak = Math.floor(limit * 0.45);
    let splitAt = -1;
    let splitIncludesPunctuation = false;

    // Prefer a clause boundary near the target length. Avoid short cues such
    // as "再" that commonly occur inside a phrase (for example, "再也没").
    const clauseStarts = /(接下来|与此同时|不过|但是|所以|因为|另外|此外|首先|其次|最后|然后|同时|之后|这时候|这时|这会儿|如果|比如说|比如|你看|下次|现在|我后来|我觉得|我发现|我突然|我最近|我抖音|我上个月|我现在|我反而|我直接|我认为|我做|我就|我会|我想|我们|接着|打开|点击|回到|真正|其实|等到|有一天)/g;
    const clauseCandidates = [];
    const sentenceCues = /^(?:接下来|首先|其次|最后|现在|我后来|我觉得|我发现|我突然|我最近|我抖音|我上个月|我现在|我反而|我直接|我认为|我做|我就|我会|我想|我们|真正|其实|有一天)$/;
    let match;
    while ((match = clauseStarts.exec(remaining)) !== null) {
      if (match.index >= minBreak && match.index <= limit) clauseCandidates.push({ index: match.index, cue: match[0] });
    }
    let inferredPunctuation = '，';
    if (clauseCandidates.length) {
      const selected = clauseCandidates.reduce((best, candidate) =>
        Math.abs(candidate.index - Math.floor(limit * 0.72)) < Math.abs(best.index - Math.floor(limit * 0.72)) ? candidate : best);
      splitAt = selected.index;
      if (sentenceCues.test(selected.cue)) inferredPunctuation = '。';
    }

    // Existing punctuation is the strongest boundary signal. Prefer the last
    // comma/semicolon before the limit when no explicit clause cue is nearby.
    if (splitAt < 0) {
      for (let index = minBreak; index <= limit; index += 1) {
        if (/[，,、；;]/.test(remaining[index - 1])) {
          splitAt = index;
          splitIncludesPunctuation = true;
        }
      }
    }

    // With no cue, use a bounded continuation paragraph. Mark it with a comma
    // rather than pretending the recognizer supplied a sentence boundary.
    if (splitAt < 0) {
      // A display wrap is not evidence of a sentence/comma. Prefer a word
      // boundary and leave the punctuation unchanged in this fallback.
      const boundaries = typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(remaining.slice(0, limit + 64))].map(part => part.index)
        : [];
      splitAt = boundaries.filter(index => index >= minBreak && index <= limit).pop() || limit;
      while (splitAt < remaining.length && /[A-Za-z0-9]/.test(remaining[splitAt - 1]) && /[A-Za-z0-9]/.test(remaining[splitAt])) splitAt += 1;
      if (splitAt > 0 && /[\uD800-\uDBFF]/.test(remaining[splitAt - 1])) splitAt += 1;
      inferredPunctuation = '';
    }
    let head = remaining.slice(0, splitAt).trim();
    remaining = remaining.slice(splitAt).trim();
    if (!splitIncludesPunctuation) {
      const leadingPunctuation = remaining.match(/^[，,、；;]+/);
      if (leadingPunctuation) {
        if (!/[，,、；;]$/.test(head)) head += '，';
        remaining = remaining.slice(leadingPunctuation[0].length).trim();
      }
    }
    if (!splitIncludesPunctuation) {
      // A cue split is before the next clause; a hard split is only a reading
      // aid. Neither boundary should duplicate punctuation already in the text.
      if (head && !/[，,、；;。！？!?…]$/.test(head)) head += inferredPunctuation;
    }
    if (head) paragraphs.push(head);
  }
  if (remaining) {
    const tail = remaining.trim();
    paragraphs.push(SENTENCE_END_PATTERN.test(tail)
      ? tail
      : tail + (QUESTION_TAIL_PATTERN.test(tail) ? '？' : '。'));
  }
  return paragraphs.join('\n\n');
}

// Local ASR often returns unpunctuated Chinese. The pause between two segments
// is the best free signal we have: a short gap is the same phrase, a longer one
// is a clause, and the block break already handles real silence.
function punctuationForGap(gapMs, previousText) {
  if (!previousText || /[，,、；;。！？!?…]$/.test(String(previousText).trim())) return '';
  if (gapMs >= 650) return '。';
  if (gapMs >= 300) return '，';
  return '';
}

function ensureTerminalPunctuation(text) {
  const trimmed = splitLongTranscriptParagraph(text);
  if (!trimmed || !hasCjk(trimmed) || /[，,、；;。！？!?…]$/.test(trimmed)) return trimmed;
  const parts = trimmed.split('\n\n');
  const last = parts.pop();
  parts.push(last + (QUESTION_TAIL_PATTERN.test(last) ? '？' : '。'));
  return parts.join('\n\n');
}

function groupTranscriptSegments(value) {
  const segments = cleanTimedSegments(value);
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
    const paragraphs = String(block.text || '').split('\n\n');
    return `### ${stamp}\n\n${paragraphs.map((paragraph) => `${speaker}${paragraph}`).join('\n\n')}`;
  });
  return ['## 分段转写', '', lines.join('\n\n'), ''].join('\n');
}

function buildUntimedTranscriptMarkdown(value) {
  const text = cleanTranscriptionTail(value);
  if (!text) return '';
  // Some transcription providers return plain text without segment times.
  // Keep the readable paragraph layout, but do not fabricate a [00:00] marker.
  const paragraphs = ensureTerminalPunctuation(text);
  return [
    '## 分段转写',
    '',
    paragraphs,
    '',
  ].join('\n');
}

function normalizeTranscriptCoreText(value) {
  return String(value || '').replace(/[\s\p{P}\p{S}]/gu, '');
}

// Notes used to print the whole transcript and then the same text again as
// timed segments. Use timed segments only when their spoken characters match
// the full transcript; otherwise keep the full text without fabricated times.
function transcriptSegmentsCoverText(segments, transcription) {
  const fullText = normalizeTranscriptCoreText(cleanTranscriptionTail(transcription));
  if (!fullText) return false;
  const segmentText = cleanTimedSegments(segments)
    .map((segment) => normalizeTranscriptCoreText(segment.text))
    .join('');
  if (!segmentText) return false;
  // A percentage threshold can silently discard a transcript tail. Retain
  // timed output only when its spoken characters match the full text exactly;
  // otherwise the untimed full transcript is the safe output.
  return segmentText === fullText;
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
  if (Array.isArray(payload.chunks)) {
    const segments = [];
    let previousOffset = -1;
    for (const chunk of payload.chunks) {
      const offset = toFiniteNumber(chunk && chunk.offsetMs);
      const items = chunk && chunk.result && chunk.result.transcription;
      if (offset === null || offset < 0 || offset < previousOffset || !Array.isArray(items)) return [];
      previousOffset = offset;
      for (const item of items) {
        const from = toFiniteNumber(item && item.offsets && item.offsets.from);
        const to = toFiniteNumber(item && item.offsets && item.offsets.to);
        if (from === null || to === null || from < 0 || to < from || typeof item.text !== 'string') return [];
        segments.push({ startMs: offset + from, endMs: offset + to, text: item.text });
      }
    }
    return normalizeTranscriptSegments(segments);
  }
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
  buildUntimedTranscriptMarkdown,
  transcriptSegmentsCoverText,
  parseTranscriptSegmentsSidecar,
  extractDoubaoUtteranceSegments,
};
