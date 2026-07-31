'use strict';

const RECORD_ID_MARKER_NAME = 'wechat-inbox-record-id';

function normalizeYamlScalar(value) {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function getFrontmatterBlock(markdown) {
  const source = String(markdown || '').replace(/^\uFEFF/, '');
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return match ? match[1] : '';
}

function getFrontmatterScalar(markdown, fieldName) {
  const block = getFrontmatterBlock(markdown);
  if (!block || !fieldName) return '';
  const escapedField = String(fieldName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const fieldMatch = new RegExp(`^\\s*${escapedField}\\s*:\\s*(.*?)\\s*$`, 'i').exec(line);
    if (fieldMatch) return normalizeYamlScalar(fieldMatch[1]);
  }
  return '';
}

function getRecordIdFromFrontmatter(markdown) {
  return getFrontmatterScalar(markdown, 'id');
}

function getRecordIdFromHiddenMarker(markdown) {
  const match = new RegExp(`<!--\\s*${RECORD_ID_MARKER_NAME}\\s*:\\s*([\\s\\S]*?)\\s*-->`, 'i').exec(String(markdown || ''));
  return match ? normalizeYamlScalar(match[1]).replace(/-->/g, '').trim() : '';
}

function getRecordIdFromMarkdown(markdown) {
  return getRecordIdFromFrontmatter(markdown) || getRecordIdFromHiddenMarker(markdown);
}

function hasRecordIdInFrontmatter(markdown, recordId) {
  const expected = String(recordId || '').trim();
  return Boolean(expected && getRecordIdFromMarkdown(markdown) === expected);
}

function buildRecordIdMarker(recordId) {
  const id = String(recordId || '').replace(/-->/g, '').trim();
  return id ? `<!-- ${RECORD_ID_MARKER_NAME}: ${id} -->` : '';
}

function normalizeRecordUrlForCompare(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    return raw.replace(/#.*$/, '').replace(/\/$/, '');
  }
}

function hasRecordUrlInFrontmatter(markdown, recordUrl) {
  const expected = normalizeRecordUrlForCompare(recordUrl);
  if (!expected) return false;
  const actual = normalizeRecordUrlForCompare(getFrontmatterScalar(markdown, 'url'));
  return Boolean(actual && actual === expected);
}

module.exports = {
  buildRecordIdMarker,
  getFrontmatterBlock,
  getFrontmatterScalar,
  getRecordIdFromFrontmatter,
  getRecordIdFromHiddenMarker,
  getRecordIdFromMarkdown,
  hasRecordIdInFrontmatter,
  hasRecordUrlInFrontmatter,
  normalizeRecordUrlForCompare,
  normalizeYamlScalar,
};
