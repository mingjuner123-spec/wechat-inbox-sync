'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProcess } = require('./mac-intel-asr-engine-runner.cjs');
const { extractTranscribeScript } = require('./prepare-mac-asr-runtime.cjs');
async function main() {
  const installer = fs.readFileSync(path.resolve(__dirname, '../../obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh'), 'utf8');
  const wrapper = extractTranscribeScript(installer);
  assert(wrapper.startsWith('#!/usr/bin/env bash\n'));
  assert(!wrapper.includes('cat > "$INSTALL_ROOT/transcribe.sh"'));
  assert(wrapper.includes('--input'));
  const success = await runProcess(process.execPath, ['-e', 'process.exit(0)'], 15000);
  assert.equal(success.exitCode, 0, 'ordinary process startup failed: ' + JSON.stringify(success));
  assert.equal(success.timedOut, false);
  const timeout = await runProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},100)'], 500);
  assert.equal(timeout.timedOut, true);
  assert(timeout.wallMs < 4000);
  if (process.platform !== 'win32') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-group-test-'));
    try {
      const marker = path.join(tmp, 'heartbeat');
      const code = `const fs=require('fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.writeFileSync(${JSON.stringify(marker)},String(Date.now())),50);`;
      const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(code)}],{stdio:'ignore'});setInterval(()=>{},100);`;
      const result = await runProcess(process.execPath, ['-e', parent], 10000);
      assert.equal(result.timedOut, true);
      const before = fs.readFileSync(marker, 'utf8');
      await new Promise(resolve=>setTimeout(resolve, 300));
      assert.equal(fs.readFileSync(marker, 'utf8'), before, 'native descendant survived process-group timeout');
    } finally { fs.rmSync(tmp, {recursive:true,force:true}); }
  }
  console.log('mac-engine-runtime-safety.test: ok');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
