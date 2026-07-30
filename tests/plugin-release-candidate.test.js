'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

test('root artifacts directory is ignored without hiding unrelated directories', () => {
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\/\.artifacts\/$/m);
  assert.doesNotMatch(gitignore, /^\*?\.artifacts/m);
});

test('candidate task card includes every permanent governance path', () => {
  const card = fs.readFileSync(
    path.join(repoRoot, 'docs', 'task-cards', 'plugin-release-pipeline-v2-001.md'),
    'utf8',
  );
  for (const required of [
    '.gitignore',
    'release-candidate.json',
    'docs/DECISIONS.md',
    'docs/WORKLOG.md',
    'obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md',
  ]) {
    assert.ok(card.includes(required), `missing allowed path: ${required}`);
  }
});
