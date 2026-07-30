'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'diagnostic-redaction-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');
const generatedMainPath = path.join(pluginDir, 'main.js');

assert.ok(fs.existsSync(modulePath), 'diagnostic redaction utils module must exist');

const {
  redactKnownCredentials,
  redactSensitiveObject,
} = require(modulePath);

for (const [name, value] of Object.entries({
  redactKnownCredentials,
  redactSensitiveObject,
})) {
  assert.strictEqual(typeof value, 'function', `${name} must be exported`);
}

assert.deepStrictEqual(
  redactSensitiveObject({
    publicField: 'visible',
    ToKeN: 'top-secret-token',
    RedeemCoDe: 'mixed-case-code',
    nested: {
      AUTHORIZATION: 'Bearer secret',
      clientSECRET: 'client-secret',
      safe: 'keep me',
      entries: [
        {
          CookieJar: 'session-cookie',
          ordinary: 42,
        },
        'plain array value',
      ],
    },
  }),
  {
    publicField: 'visible',
    ToKeN: '[REDACTED]',
    RedeemCoDe: '[REDACTED]',
    nested: {
      AUTHORIZATION: '[REDACTED]',
      clientSECRET: '[REDACTED]',
      safe: 'keep me',
      entries: [
        {
          CookieJar: '[REDACTED]',
          ordinary: 42,
        },
        'plain array value',
      ],
    },
  },
);

const settings = {
  token: 'primary-token',
  pendingRedeemCode: 'pending-code',
  localTranscriptionEntitlementStatus: {
    code: 'entitlement-code',
    bindingToken: 'entitlement-binding-token',
  },
  bindings: [
    { token: 'binding-token-a' },
    { token: 'binding-token-b' },
    null,
  ],
};

assert.strictEqual(
  redactKnownCredentials(
    [
      'primary-token',
      'pending-code',
      'entitlement-code',
      'entitlement-binding-token',
      'binding-token-a',
      'binding-token-b',
      'ordinary-text',
    ].join('|'),
    settings,
  ),
  [
    '[REDACTED]',
    '[REDACTED]',
    '[REDACTED]',
    '[REDACTED]',
    '[REDACTED]',
    '[REDACTED]',
    'ordinary-text',
  ].join('|'),
);

assert.strictEqual(
  redactKnownCredentials('abc123 abc', {
    token: 'abc',
    bindings: [{ token: 'abc123' }],
  }),
  '[REDACTED] [REDACTED]',
  'longer credentials must be replaced before their prefixes',
);

assert.strictEqual(
  redactKnownCredentials('ordinary diagnostic text', {}),
  'ordinary diagnostic text',
);
assert.strictEqual(redactKnownCredentials(undefined), '');

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'redactKnownCredentials',
  'redactSensitiveObject',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./diagnostic-redaction-utils')"),
  'src/main.js must consume the extracted diagnostic redaction module',
);

const generatedMain = fs.readFileSync(generatedMainPath, 'utf8');
assert.ok(
  generatedMain.includes('[REDACTED]'),
  'generated main.js must preserve the diagnostic redaction marker',
);
