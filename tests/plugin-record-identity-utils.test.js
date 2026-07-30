'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'record-identity-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');

const {
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
} = require(modulePath);

for (const exportedFunction of [
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
]) {
  assert.strictEqual(typeof exportedFunction, 'function');
}

assert.strictEqual(normalizeYamlScalar('  value  '), 'value');
assert.strictEqual(normalizeYamlScalar(' " quoted value " '), 'quoted value');
assert.strictEqual(normalizeYamlScalar(" ' single quoted ' "), 'single quoted');
assert.strictEqual(normalizeYamlScalar('"unclosed'), '"unclosed');
assert.strictEqual(normalizeYamlScalar(null), '');

const lfMarkdown = [
  '\uFEFF---',
  'ID: "frontmatter-id"',
  "Url: 'https://Example.com/Note/?b=2&a=1#section'",
  '---',
  '正文',
  '<!-- wechat-inbox-record-id: marker-id -->',
].join('\n');
const crlfMarkdown = [
  '---',
  "id: 'crlf-id'",
  'url: https://example.com/item',
  '---',
  '正文',
].join('\r\n');

assert.strictEqual(
  getFrontmatterBlock(lfMarkdown),
  'ID: "frontmatter-id"\nUrl: \'https://Example.com/Note/?b=2&a=1#section\'',
);
assert.strictEqual(
  getFrontmatterBlock(crlfMarkdown),
  "id: 'crlf-id'\r\nurl: https://example.com/item",
);
assert.strictEqual(getFrontmatterBlock('正文\n---\nid: late\n---'), '');
assert.strictEqual(getFrontmatterScalar(lfMarkdown, 'id'), 'frontmatter-id');
assert.strictEqual(
  getFrontmatterScalar(lfMarkdown, 'URL'),
  'https://Example.com/Note/?b=2&a=1#section',
);
assert.strictEqual(getFrontmatterScalar(lfMarkdown, 'missing'), '');
assert.strictEqual(getFrontmatterScalar('正文', 'id'), '');
assert.strictEqual(getFrontmatterScalar(lfMarkdown, ''), '');

assert.strictEqual(getRecordIdFromFrontmatter(lfMarkdown), 'frontmatter-id');
assert.strictEqual(getRecordIdFromHiddenMarker(lfMarkdown), 'marker-id');
assert.strictEqual(
  getRecordIdFromHiddenMarker('正文\n<!-- WECHAT-INBOX-RECORD-ID: "quoted-marker" -->'),
  'quoted-marker',
);
assert.strictEqual(getRecordIdFromHiddenMarker('正文'), '');
assert.strictEqual(
  getRecordIdFromMarkdown(lfMarkdown),
  'frontmatter-id',
  'frontmatter id must win over a hidden marker',
);
assert.strictEqual(
  getRecordIdFromMarkdown('正文\n<!-- wechat-inbox-record-id: marker-only -->'),
  'marker-only',
);
assert.strictEqual(hasRecordIdInFrontmatter(lfMarkdown, 'frontmatter-id'), true);
assert.strictEqual(hasRecordIdInFrontmatter(lfMarkdown, 'marker-id'), false);
assert.strictEqual(hasRecordIdInFrontmatter(lfMarkdown, '  frontmatter-id  '), true);
assert.strictEqual(hasRecordIdInFrontmatter(lfMarkdown, ''), false);

assert.strictEqual(buildRecordIdMarker(' record-123 '), '<!-- wechat-inbox-record-id: record-123 -->');
assert.strictEqual(
  buildRecordIdMarker('record-->-123'),
  '<!-- wechat-inbox-record-id: record-123 -->',
  'marker construction must remove comment terminators',
);
assert.strictEqual(buildRecordIdMarker(''), '');

assert.strictEqual(
  normalizeRecordUrlForCompare('HTTPS://Example.COM/path/#fragment'),
  'https://example.com/path',
);
assert.strictEqual(
  normalizeRecordUrlForCompare('https://example.com/path?b=2&a=1#fragment'),
  'https://example.com/path?b=2&a=1',
);
assert.strictEqual(
  normalizeRecordUrlForCompare('not a url/#fragment'),
  'not a url',
);
assert.strictEqual(normalizeRecordUrlForCompare(''), '');

const urlMarkdown = [
  '---',
  'url: "https://Example.COM/path?b=2&a=1#old-fragment"',
  '---',
  '正文',
].join('\n');
assert.strictEqual(
  hasRecordUrlInFrontmatter(urlMarkdown, 'https://example.com/path?b=2&a=1#new-fragment'),
  true,
  'host case and hash must not change URL identity',
);
assert.strictEqual(
  hasRecordUrlInFrontmatter(urlMarkdown, 'https://example.com/path?a=1&b=2'),
  false,
  'query ordering remains identity-significant',
);
assert.strictEqual(
  hasRecordUrlInFrontmatter(urlMarkdown, 'https://example.com/path?b=2&a=9'),
  false,
  'different query values must not match',
);
assert.strictEqual(
  hasRecordUrlInFrontmatter('---\nurl: https://Example.com/path/\n---\n', 'https://example.com/path'),
  true,
  'a trailing slash must not change URL identity',
);
assert.strictEqual(hasRecordUrlInFrontmatter(urlMarkdown, ''), false);
assert.strictEqual(hasRecordUrlInFrontmatter('正文', 'https://example.com/path'), false);

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'buildRecordIdMarker',
  'getFrontmatterBlock',
  'getFrontmatterScalar',
  'getRecordIdFromFrontmatter',
  'getRecordIdFromHiddenMarker',
  'getRecordIdFromMarkdown',
  'hasRecordIdInFrontmatter',
  'hasRecordUrlInFrontmatter',
  'normalizeRecordUrlForCompare',
  'normalizeYamlScalar',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./record-identity-utils')"),
  'src/main.js must consume the extracted record identity module',
);
assert.strictEqual(
  (sourceMain.match(/wechat-inbox-record-id/g) || []).length,
  0,
  'src/main.js must not retain another record marker constant',
);
