'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const helperPath = path.join(
  __dirname,
  '..',
  'obsidian-plugin',
  'wechat-inbox-sync',
  'src',
  'cloud-fallback-job-utils.js',
);
const sourcePath = path.join(
  __dirname,
  '..',
  'obsidian-plugin',
  'wechat-inbox-sync',
  'src',
  'main.js',
);
const helpers = require(helperPath);
const source = fs.readFileSync(sourcePath, 'utf8');

assert.strictEqual(
  helpers.normalizeConnectionTicket(' cnt-abcd-efgh-jklm '),
  'CNT-ABCD-EFGH-JKLM',
);
assert.strictEqual(
  helpers.normalizeConnectionTicket('CNTAB CDEFGHJKLM'),
  'CNT-ABCD-EFGH-JKLM',
);
assert.strictEqual(helpers.isConnectionTicket('CNT-ABCD-EFGH-JKLM'), true);
assert.strictEqual(helpers.normalizeConnectionTicket('ABC-123'), '');
assert.strictEqual(helpers.normalizeConnectionTicket('CNT-ABCD-EFGH-IJKL'), '');
assert.strictEqual(helpers.normalizeConnectionTicket('CNT-ABCD-EFGH-JK'), '');

assert.match(source, /requestUnauthenticatedJson\(['"]\/connection\/consume['"]/);
assert.match(source, /purpose:\s*['"]obsidian_bind['"]/);
assert.match(source, /\[['"]bind_code['"],\s*['"]binding_token['"]\]/);
assert.match(source, /pendingConnectionTicket/);
assert.match(source, /pendingBindCode:\s*['"]['"]/);
assert.match(source, /暂时使用旧绑定码/);
assert.match(source, /connectWithConnectionTicket/);

console.log('plugin connection ticket tests passed');
