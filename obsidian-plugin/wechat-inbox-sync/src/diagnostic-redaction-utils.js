'use strict';

function redactSensitiveObject(value, key = '') {
  if (/token|code|secret|authorization|cookie/i.test(String(key || ''))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactSensitiveObject(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitiveObject(entryValue, entryKey),
      ])
    );
  }
  return value;
}

function redactKnownCredentials(text, settings = {}) {
  const entitlement = settings.localTranscriptionEntitlementStatus || {};
  const credentials = [
    settings.token,
    settings.pendingRedeemCode,
    entitlement.code,
    entitlement.bindingToken,
    ...(Array.isArray(settings.bindings) ? settings.bindings.map((item) => item && item.token) : []),
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return credentials.reduce(
    (result, credential) => result.split(credential).join('[REDACTED]'),
    String(text || '')
  );
}

module.exports = {
  redactKnownCredentials,
  redactSensitiveObject,
};
