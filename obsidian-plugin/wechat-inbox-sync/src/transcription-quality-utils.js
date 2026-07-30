'use strict';

function dedupeRepeatedTranscriptionLines(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return '';

  const deduped = [];
  let previousLine = '';
  for (const line of lines) {
    if (line === previousLine) {
      continue;
    } else {
      previousLine = line;
    }
    deduped.push(line);
  }
  return deduped.join('\n').trim();
}

function normalizeTranscriptionQualityUnit(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function getTranscriptionQualityUnits(text) {
  const source = String(text || '').trim();
  if (!source) return [];

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rawUnits = lines.length >= 3
    ? lines
    : (source.match(/[^。！？!?；;\r\n]+[。！？!?；;]?/g) || lines);
  return rawUnits
    .map(normalizeTranscriptionQualityUnit)
    .filter((unit) => unit.length >= 4);
}

function getTranscriptionQualityIssue(text) {
  const units = getTranscriptionQualityUnits(text);
  if (!units.length) return '';

  const promptLeakPattern = /^(?:请|請)(?:输入|輸入|输出|輸出)(?:简体|簡體)中文$/;
  const promptLeakCount = units.filter((unit) => promptLeakPattern.test(unit)).length;
  if (promptLeakCount >= 2 || (promptLeakCount === 1 && units.length === 1)) {
    return 'prompt-leak';
  }

  const counts = new Map();
  let longestConsecutiveRun = 1;
  let currentRun = 1;
  let previousUnit = '';
  units.forEach((unit) => {
    counts.set(unit, (counts.get(unit) || 0) + 1);
    if (unit === previousUnit) {
      currentRun += 1;
      longestConsecutiveRun = Math.max(longestConsecutiveRun, currentRun);
    } else {
      currentRun = 1;
      previousUnit = unit;
    }
  });

  const maxCount = Math.max(...counts.values());
  if (
    longestConsecutiveRun >= 3
    || maxCount >= 6
    || (units.length >= 8 && maxCount >= 5 && maxCount / units.length >= 0.6)
  ) {
    return 'repeated-lines';
  }
  return '';
}

function createTranscriptionQualityError(text, source = '转写') {
  const issue = getTranscriptionQualityIssue(text);
  if (!issue) return null;
  const reason = issue === 'prompt-leak' ? '检测到提示词泄漏' : '检测到重复句循环';
  const error = new Error(`${source}结果质量异常：${reason}，已放弃该媒体地址并尝试备用地址。`);
  error.code = 'TRANSCRIPTION_LOW_QUALITY';
  error.qualityIssue = issue;
  return error;
}

function assertUsableTranscription(text, source = '转写') {
  const transcription = String(text || '').trim();
  if (!transcription) {
    throw new Error(`${source}命令没有返回文本`);
  }
  const qualityError = createTranscriptionQualityError(transcription, source);
  if (qualityError) throw qualityError;
  return transcription;
}

module.exports = {
  assertUsableTranscription,
  createTranscriptionQualityError,
  dedupeRepeatedTranscriptionLines,
  getTranscriptionQualityIssue,
  getTranscriptionQualityUnits,
  normalizeTranscriptionQualityUnit,
};
