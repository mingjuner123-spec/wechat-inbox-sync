'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {
  diagnosticRedact,
  readMatchingCrashSummary,
} = require('./asr-recovery-utils');

const DEFAULT_MAX_BYTES = 64 * 1024;
const HARD_MAX_BYTES = 128 * 1024;
const MAX_FRAMES = 4096;
const MAX_MODULES = 4096;
const MAX_TEXT_LINES = 4096;
const MAX_FIELD_BYTES = 1024;
const MAX_REASON_BYTES = 160;

const PRIVATE_KEY = /^(?:path|procPath|parentProcPath|workingDirectory|cwd|home|user|username|uid|gid|command|commandLine|arguments|argv|environment|env|url|cookie|token|secret|authorization|password|apiKey|api_key|input|output)$/i;
const PRIVATE_LINE = /^(?:Path|Parent Process|Responsible|User ID|Coalition|Bundle Identifier|Launch Arguments|Environment|Working Directory|Input|Output)\s*:/i;
const MODULE_PATH = /(?:\/|\\)(?:Users|home|private|Applications|Library|System|usr|opt)(?:\/|\\)[^ \t,;]+|[A-Za-z]:[\\/][^ \t,;]+/g;

function byteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function normalizeLimit(value) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate)) return DEFAULT_MAX_BYTES;
  return Math.min(HARD_MAX_BYTES, Math.max(2048, Math.floor(candidate)));
}

function safeString(value, limit = MAX_FIELD_BYTES) {
  const text = String(value || '');
  if (byteLength(text) <= limit) return text;
  const marker = '…[truncated]';
  const markerBytes = byteLength(marker);
  const prefixLimit = Math.max(0, limit - markerBytes);
  let result = '';
  let used = 0;
  for (const point of [...text]) {
    const size = byteLength(point);
    if (used + size > prefixLimit) break;
    result += point;
    used += size;
  }
  return result + (markerBytes <= limit ? marker : '');
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function safeTimestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function redactString(value, settings = {}) {
  return diagnosticRedact(safeString(value), settings);
}

function baseName(value) {
  const text = String(value || '').replace(/\\/g, '/');
  return text.split('/').pop() || '';
}

function safeObject(value, settings = {}, depth = 0) {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value, settings);
  if (Array.isArray(value)) return value.slice(0, 64).map(item => safeObject(item, settings, depth + 1));
  if (!value || typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [
    key,
    PRIVATE_KEY.test(key) ? '[REDACTED]' : safeObject(item, settings, depth + 1),
  ]));
}

function safeFrame(frame, settings = {}) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const result = {};
  for (const [key, value] of Object.entries(frame)) {
    if (!/^(?:symbol|name|module|function|library|imageIndex|imageOffset|address|instruction|line|column|source|file)$/i.test(key)) continue;
    if (PRIVATE_KEY.test(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      result[key] = redactString(value, settings);
    } else if (Number.isSafeInteger(value)) {
      result[key] = value;
    }
  }
  return Object.keys(result).length ? result : null;
}

function safeModule(image, settings = {}, sourceIndex = null) {
  if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
  const result = {};
  const imageName = image.name || image.module || image.path;
  if (imageName) result.name = redactString(baseName(imageName), settings);
  for (const key of ['uuid', 'arch']) {
    if (typeof image[key] === 'string') result[key] = redactString(image[key], settings);
  }
  const embeddedIndex = safeNumber(image.index);
  const moduleIndex = embeddedIndex !== null ? embeddedIndex : safeNumber(sourceIndex);
  if (moduleIndex !== null && moduleIndex >= 0) result.index = moduleIndex;
  for (const key of ['base', 'size']) {
    const value = safeNumber(image[key]);
    if (value !== null && value >= 0) result[key] = value;
  }
  return Object.keys(result).length ? result : null;
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function parseSummary(summary) {
  const parsed = parseJson(summary);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function safePathLine(line, settings = {}) {
  if (PRIVATE_LINE.test(String(line || ''))) return '';
  // Keep the final binary/module name while removing user-specific directories.
  const normalized = String(line || '').replace(MODULE_PATH, match => baseName(match));
  return redactString(normalized, settings).slice(0, MAX_FIELD_BYTES);
}

function textThreadEvidence(text, settings = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const crashed = lines.find(line => /^Crashed Thread:\s*(\d+)/i.test(line));
  const threadNumber = crashed ? Number(crashed.match(/\d+/)?.[0]) : null;
  const faultLines = [];
  const moduleLines = [];
  let faultLineCount = 0;
  let moduleLineCount = 0;
  let inFaultThread = false;
  let inModules = false;
  let faultHeader = '';
  for (const line of lines) {
    if (/^Binary Images:/i.test(line)) {
      inModules = true;
      inFaultThread = false;
      const safe = safePathLine(line, settings);
      if (safe) { moduleLineCount += 1; moduleLines.push(safe); }
      continue;
    }
    if (inModules) {
      const safe = safePathLine(line, settings);
      if (safe) { moduleLineCount += 1; if (moduleLines.length < MAX_TEXT_LINES) moduleLines.push(safe); }
      continue;
    }
    const thread = line.match(/^Thread\s+(\d+)(?:\s+Crashed)?\s*:/i);
    if (thread) {
      if (inFaultThread) inFaultThread = false;
      const marked = /\s+Crashed\s*::?/i.test(line);
      if ((Number.isSafeInteger(threadNumber) && Number(thread[1]) === threadNumber) || (!Number.isSafeInteger(threadNumber) && marked)) {
        inFaultThread = true;
        faultHeader = safePathLine(line, settings);
        if (faultHeader) { faultLineCount += 1; faultLines.push(faultHeader); }
      }
      continue;
    }
    if (inFaultThread) {
      const safe = safePathLine(line, settings);
      if (safe) { faultLineCount += 1; if (faultLines.length < MAX_TEXT_LINES) faultLines.push(safe); }
    }
  }
  return {
    faultThread: {
      thread: Number.isSafeInteger(threadNumber) ? threadNumber : null,
      header: faultHeader || undefined,
      lines: faultLines.slice(0, MAX_TEXT_LINES),
      linesOmitted: Math.max(0, faultLineCount - MAX_TEXT_LINES),
    },
    modules: {
      lines: moduleLines.slice(0, MAX_TEXT_LINES),
      linesOmitted: Math.max(0, moduleLineCount - MAX_TEXT_LINES),
    },
  };
}

function ipsEvidence(match, settings = {}) {
  const parsed = match.report && typeof match.report === 'object'
    ? match.report
    : parseJson(match.text);
  if (!parsed) return null;
  const threadIndex = safeNumber(parsed.faultingThread);
  const thread = Number.isSafeInteger(threadIndex) && Array.isArray(parsed.threads)
    ? parsed.threads[threadIndex]
    : null;
  const sourceFrames = Array.isArray(thread?.frames) ? thread.frames : [];
  const sourceImages = Array.isArray(parsed.usedImages) ? parsed.usedImages : [];
  const frames = sourceFrames.slice(0, MAX_FRAMES).map(frame => safeFrame(frame, settings)).filter(Boolean);
  const referencedIndexes = [...new Set(sourceFrames
    .map(frame => safeNumber(frame && frame.imageIndex))
    .filter(index => Number.isSafeInteger(index) && index >= 0 && index < sourceImages.length))];
  const allIndexes = sourceImages.map((_, index) => index);
  const orderedIndexes = [
    ...referencedIndexes,
    ...allIndexes.filter(index => !referencedIndexes.includes(index)),
  ];
  const selectedIndexes = orderedIndexes.slice(0, MAX_MODULES);
  const modules = selectedIndexes
    .map(index => safeModule(sourceImages[index], settings, index))
    .filter(Boolean);
  const summary = parseSummary(match.summary);
  return {
    format: 'ips',
    process: safeString(match.process, 96),
    pid: safeNumber(match.pid),
    captureTime: safeTimestamp(match.captureTime),
    reportByteLength: safeNumber(match.byteLength),
    association: summary && summary.associationReliability ? summary.associationReliability : undefined,
    exception: safeObject(parsed.exception, settings),
    termination: safeObject(parsed.termination, settings),
    faultThread: {
      thread: threadIndex,
      frames,
      framesOmitted: Math.max(0, sourceFrames.length - frames.length),
    },
    modules: {
      items: modules,
      itemsOmitted: Math.max(0, sourceImages.length - modules.length),
    },
  };
}

function textEvidence(match, settings = {}) {
  const summary = parseSummary(match.summary);
  const extracted = textThreadEvidence(match.text, settings);
  return {
    format: 'crash',
    process: safeString(match.process, 96),
    pid: safeNumber(match.pid),
    captureTime: safeTimestamp(match.captureTime),
    reportByteLength: safeNumber(match.byteLength),
    association: summary && summary.associationReliability ? summary.associationReliability : undefined,
    ...extracted,
  };
}

function hasProjectionTruncation(value) {
  if (value === '[TRUNCATED]' || value === '[TRUNCATED: size limit]') return true;
  if (Array.isArray(value)) return value.some(hasProjectionTruncation);
  if (value && typeof value === 'object') return Object.values(value).some(hasProjectionTruncation);
  return false;
}
function hasOmittedProjectionItems(value) {
  const omitted = [
    value && value.faultThread && value.faultThread.framesOmitted,
    value && value.faultThread && value.faultThread.linesOmitted,
    value && value.modules && value.modules.itemsOmitted,
    value && value.modules && value.modules.linesOmitted,
  ];
  return omitted.some(item => item === 'size_limit' || (Number.isSafeInteger(item) && item > 0));
}
function pruneEvidence(value, limit) {
  const output = JSON.parse(JSON.stringify(value));
  const originalBytes = byteLength(JSON.stringify(output));
  const projectionTruncated = output.truncated === true || hasProjectionTruncation(output) || hasOmittedProjectionItems(output);
  output.truncated = projectionTruncated;
  output.originalBytes = originalBytes;
  const serializedSize = () => byteLength(JSON.stringify(output));
  if (serializedSize() <= limit) {
    return { evidence: output, truncated: projectionTruncated, originalBytes };
  }

  output.truncated = true;
  for (let pass = 0; pass < 64 && serializedSize() > limit; pass += 1) {
    const candidates = [
      { owner: output.faultThread, key: 'frames', omitted: 'framesOmitted' },
      { owner: output.faultThread, key: 'lines', omitted: 'linesOmitted' },
      { owner: output.modules, key: 'items', omitted: 'itemsOmitted' },
      { owner: output.modules, key: 'lines', omitted: 'linesOmitted' },
    ].filter(candidate => candidate.owner && Array.isArray(candidate.owner[candidate.key]));
    const candidate = candidates.sort((left, right) => right.owner[right.key].length - left.owner[left.key].length)[0];
    if (candidate && candidate.owner[candidate.key].length > 0) {
      const items = candidate.owner[candidate.key];
      const keep = items.length > 1 ? Math.floor(items.length / 2) : 0;
      const removed = items.length - keep;
      items.splice(keep);
      const previous = Number(candidate.owner[candidate.omitted]);
      candidate.owner[candidate.omitted] = (Number.isFinite(previous) ? previous : 0) + removed;
      continue;
    }
    if (output.exception && typeof output.exception === 'object') {
      output.exception = '[TRUNCATED]';
      continue;
    }
    if (output.termination && typeof output.termination === 'object') {
      output.termination = '[TRUNCATED]';
      continue;
    }
    if (output.association && typeof output.association === 'object') {
      output.association = '[TRUNCATED]';
      continue;
    }
    break;
  }

  if (serializedSize() > limit) {
    const minimal = {
      schemaVersion: 1,
      kind: 'native_crash_evidence',
      status: 'matched',
      source: output.source,
      truncated: true,
      originalBytes,
      format: output.format,
      process: output.process,
      pid: output.pid,
      captureTime: output.captureTime,
      reportByteLength: output.reportByteLength,
      association: output.association,
      summary: output.summary,
      exception: '[TRUNCATED: size limit]',
      termination: '[TRUNCATED: size limit]',
      faultThread: {
        thread: output.faultThread && output.faultThread.thread,
        frames: [{ symbol: '[TRUNCATED: size limit]' }],
        framesOmitted: output.faultThread && output.faultThread.framesOmitted,
      },
      modules: {
        items: [{ index: 0, name: '[TRUNCATED: size limit]' }],
        itemsOmitted: output.modules && output.modules.itemsOmitted,
      },
    };
    for (const key of ['summary', 'association', 'termination', 'exception', 'reportByteLength', 'captureTime', 'process']) {
      if (byteLength(JSON.stringify(minimal)) <= limit) break;
      delete minimal[key];
    }
    if (byteLength(JSON.stringify(minimal)) > limit) {
      return {
        evidence: {
          schemaVersion: 1,
          kind: 'native_crash_evidence',
          status: 'matched',
          source: output.source,
          truncated: true,
          originalBytes,
          faultThread: {
            thread: output.faultThread && output.faultThread.thread,
            frames: [{ symbol: '[TRUNCATED: size limit]' }],
            framesOmitted: 'size_limit',
          },
          modules: {
            items: [{ index: 0, name: '[TRUNCATED: size limit]' }],
            itemsOmitted: 'size_limit',
          },
        },
        truncated: true,
        originalBytes,
      };
    }
    return { evidence: minimal, truncated: true, originalBytes };
  }
  output.originalBytes = originalBytes;
  output.truncated = true;
  return { evidence: output, truncated: true, originalBytes };
}

function unavailable(status, reason, summary, extra = {}) {
  return {
    schemaVersion: 1,
    kind: 'native_crash_evidence',
    status,
    source: 'macos_diagnostic_report',
    unavailableReason: safeString(reason, MAX_REASON_BYTES),
    summary: safeString(summary, MAX_FIELD_BYTES),
    ...extra,
  };
}

function collectNativeCrashEvidence({
  session = null,
  attempt = null,
  directories,
  fileSystem = fs,
  settings = {},
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    return unavailable('unavailable', 'session_missing', '[unavailable: no matching Mac run]');
  }
  if (session.platform !== 'darwin') {
    return unavailable('not_applicable', 'platform_not_macos', '[unavailable: no matching Mac run]');
  }
  const selectedAttempt = attempt && typeof attempt === 'object'
    ? attempt
    : Array.isArray(session.attempts) && session.attempts.length === 1
      ? session.attempts[0]
      : null;
  if (!selectedAttempt) {
    return unavailable('unavailable', 'attempt_not_provided', '[unavailable: native attempt identity is required]');
  }
  let matchedPayload = null;
  const summary = readMatchingCrashSummary(session, {
    directories,
    fileSystem,
    attempt: selectedAttempt,
    onMatch: payload => { matchedPayload = payload; },
  });
  if (!matchedPayload || String(summary || '').startsWith('[unavailable:')) {
    const unavailableText = String(summary || '[unavailable: crash report payload missing]');
    const reason = unavailableText.replace(/^\[unavailable:\s*/, '').replace(/\]$/, '').replace(/\s+/g, '_').slice(0, MAX_REASON_BYTES);
    return unavailable(
      unavailableText === '[unavailable: no matching Mac run]' ? 'not_applicable' : 'unavailable',
      reason,
      unavailableText,
    );
  }
  const base = matchedPayload.format === 'ips'
    ? ipsEvidence({ ...matchedPayload, summary }, settings)
    : textEvidence({ ...matchedPayload, summary }, settings);
  if (!base) return unavailable('unavailable', 'matched_report_unreadable', summary);
  const limit = normalizeLimit(maxBytes);
  const bounded = pruneEvidence({
    schemaVersion: 1,
    kind: 'native_crash_evidence',
    status: 'matched',
    source: 'macos_diagnostic_report',
    truncated: false,
    summary: redactString(summary, settings),
    ...base,
  }, limit);
  bounded.evidence.originalBytes = bounded.originalBytes;
  bounded.evidence.truncated = bounded.truncated;
  return bounded.evidence;
}

module.exports = {
  DEFAULT_MAX_BYTES,
  HARD_MAX_BYTES,
  collectNativeCrashEvidence,
  normalizeLimit,
  pruneEvidence,
};