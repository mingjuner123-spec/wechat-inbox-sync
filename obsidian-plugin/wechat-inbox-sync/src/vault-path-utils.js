'use strict';

const DEFAULT_VAULT_INBOX_DIR = '临时收集';

function normalizeVaultPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function normalizeConfiguredVaultPath(value, fallback = DEFAULT_VAULT_INBOX_DIR) {
  const raw = String(value || '').trim();
  const safeFallback = normalizeVaultPath(fallback) || DEFAULT_VAULT_INBOX_DIR;
  if (!raw) return safeFallback;
  if (/^[\\/]/.test(raw) || /^[a-z]:[\\/]/i.test(raw) || raw.includes('\0')) {
    return safeFallback;
  }
  const normalized = normalizeVaultPath(raw);
  const segments = normalized.split('/');
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return safeFallback;
  }
  return normalized;
}

function shouldPersistNormalizedInboxDir(savedSettings, mergedSettings) {
  if (!savedSettings || typeof savedSettings !== 'object') return true;
  const savedInboxDir = String(savedSettings.inboxDir || '').trim();
  const mergedInboxDir = String(mergedSettings && mergedSettings.inboxDir || '').trim();
  return savedInboxDir !== mergedInboxDir;
}

module.exports = {
  DEFAULT_VAULT_INBOX_DIR,
  normalizeConfiguredVaultPath,
  normalizeVaultPath,
  shouldPersistNormalizedInboxDir,
};
