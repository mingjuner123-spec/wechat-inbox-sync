'use strict';

function normalizeNoteSaveMode(value, noteSaveModes, defaultMode) {
  const normalized = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(noteSaveModes || {}, normalized)
    ? normalized
    : defaultMode;
}

function normalizeNotePropertyFields(value, notePropertyFieldKeys) {
  const allowedFields = Array.isArray(notePropertyFieldKeys) ? notePropertyFieldKeys : [];
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      if (!allowedFields.includes(item) || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .join(',');
}

function normalizeBindCodeInput(code) {
  const compact = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[-\u2010-\u2015]/g, '-')
    .replace(/[^A-Z0-9]/g, '');
  if (compact.length === 6) {
    return `${compact.slice(0, 3)}-${compact.slice(3)}`;
  }
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[-\u2010-\u2015]/g, '-')
    .replace(/\s+/g, '');
}

module.exports = {
  normalizeBindCodeInput,
  normalizeNotePropertyFields,
  normalizeNoteSaveMode,
};
