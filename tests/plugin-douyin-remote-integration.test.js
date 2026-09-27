'use strict';
// Real renderer -> @electron/remote -> BrowserWindow, with no live website or user profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const executable = process.env.DOUYIN_TEST_ELECTRON;
const remoteModule = process.env.DOUYIN_TEST_REMOTE;
assert.ok(executable && remoteModule, 'Set DOUYIN_TEST_ELECTRON and DOUYIN_TEST_REMOTE to the isolated test dependencies');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-real-remote-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(executable, [path.join(__dirname, 'fixtures/douyin-remote/main.cjs'), root,
  path.resolve(remoteModule), process.env.DOUYIN_TEST_BUNDLE || path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync/main.js')],
{ env, encoding: 'utf8', timeout: 150000, windowsHide: true });
assert.equal(run.status, 0, `Electron test failed: ${run.error?.message || run.stderr}`);
const result = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
assert.equal(result.error, undefined, JSON.stringify(result));
assert.ok(result.mainResponses > 0, 'real main process must receive CDP responses');
const [visible, valid, empty, wrong] = result.cases;
assert.equal(valid.name, 'network-only');
assert.deepEqual(valid.urls, ['https://v3.douyinvod.com/test-target.mp4']);
assert.ok(valid.responseReads > 0, 'renderer plugin must actually read network bodies');
for (const failure of [empty, wrong]) {
  assert.equal(failure.code, 'DOUYIN_NO_MEDIA', `${failure.name}: HTTP 200 must not imply extraction success`);
  assert.equal(failure.urls, undefined);
}
assert.equal(result.remainingWindows, 1, 'only the local harness host may remain');
assert.deepEqual(visible.urls, valid.urls, 'hidden timer throttling must not delay media requests beyond the extraction budget');
console.log('PASS: real remote network-only media, HTTP 200 empty body, wrong target, delayed timer request, window cleanup');
