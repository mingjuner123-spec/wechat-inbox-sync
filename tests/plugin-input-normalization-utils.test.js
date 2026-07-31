'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const pluginDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync');
const modulePath = path.join(pluginDir, 'src', 'input-normalization-utils.js');
const sourceMainPath = path.join(pluginDir, 'src', 'main.js');

assert.ok(fs.existsSync(modulePath), 'input normalization utils module must exist');

const {
  normalizeBindCodeInput,
  normalizeNotePropertyFields,
  normalizeNoteSaveMode,
} = require(modulePath);

const noteSaveModes = Object.freeze({ date: '按日期创建子目录', root: '直接保存到根目录' });
assert.strictEqual(normalizeNoteSaveMode('root', noteSaveModes, 'date'), 'root');
assert.strictEqual(normalizeNoteSaveMode(' date ', noteSaveModes, 'root'), 'date');
assert.strictEqual(normalizeNoteSaveMode('unknown', noteSaveModes, 'date'), 'date');
assert.strictEqual(normalizeNoteSaveMode('toString', noteSaveModes, 'date'), 'date');

const propertyFieldKeys = Object.freeze(['id', 'title', 'author', 'url', 'description', 'keywords']);
assert.strictEqual(
  normalizeNotePropertyFields(' title,author,title,invalid,url, author ,keywords ', propertyFieldKeys),
  'title,author,url,keywords',
);
assert.strictEqual(
  normalizeNotePropertyFields('keywords,title,id', propertyFieldKeys),
  'keywords,title,id',
);
assert.strictEqual(normalizeNotePropertyFields('', propertyFieldKeys), '');

assert.strictEqual(normalizeBindCodeInput(), '');
assert.strictEqual(normalizeBindCodeInput(' ozt n1i '), 'OZT-N1I');
assert.strictEqual(normalizeBindCodeInput('abc-def'), 'ABC-DEF');
assert.strictEqual(normalizeBindCodeInput('ab\u2014c def'), 'ABC-DEF');
assert.strictEqual(normalizeBindCodeInput('abc\u2014defghi'), 'ABC-DEFGHI');
assert.strictEqual(normalizeBindCodeInput(' ab_cd '), 'AB_CD');
assert.strictEqual(normalizeBindCodeInput('a!b c-d e?f'), 'ABC-DEF');

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
for (const functionName of [
  'normalizeBindCodeInput',
  'normalizeNotePropertyFields',
  'normalizeNoteSaveMode',
]) {
  assert.strictEqual(
    new RegExp(`function\\s+${functionName}\\s*\\(`).test(sourceMain),
    false,
    `${functionName} must not remain duplicated in src/main.js`,
  );
}
assert.ok(
  sourceMain.includes("require('./input-normalization-utils')"),
  'src/main.js must consume the extracted input normalization module',
);
