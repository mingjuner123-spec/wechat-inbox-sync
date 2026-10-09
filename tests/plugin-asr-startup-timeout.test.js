'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const helper = require('../obsidian-plugin/wechat-inbox-sync/src/asr-startup-timeout');
const runner = require('../obsidian-plugin/wechat-inbox-sync/src/asr-timeout-process-group');
const report = require('../obsidian-plugin/wechat-inbox-sync/src/failure-technical-report');
const recovery = require('../obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils');
const root = fs.mkdtempSync(path.join(os.tmpdir(), "asr startup fixture's-"));
const installer = fs.readFileSync(path.join(__dirname, '../obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh'), 'utf8');
const original = helper.extractManagedScript(installer);
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const slash = p => p.replace(/\\/g, '/');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const end = Date.now() + 15000; while (!check()) { if (Date.now() > end) throw Error('fixture condition timeout'); await pause(20); } }
const liveFixtures = new Set();
let index = 0;
function fixture() {
  const dir = slash(path.join(root, String(++index))); fs.mkdirSync(dir);
  for (const sub of ['bin', 'models']) fs.mkdirSync(path.join(dir, sub));
  fs.writeFileSync(path.join(dir, 'transcribe.sh'), original);
  fs.writeFileSync(path.join(dir, 'models/ggml-small.bin'), 'synthetic');
  fs.writeFileSync(path.join(dir, 'input.wav'), 'synthetic process fixture; not user audio');
  fs.writeFileSync(path.join(dir, 'bin/ffmpeg'), `#!/bin/bash
if [ "$#" = 3 ]; then echo 'Duration: 00:00:37.00' >&2; exit 0; fi
: > "$FIXTURE_DIR/prep-entered"
while [ ! -f "$FIXTURE_DIR/release-prep" ]; do sleep 0.05; done
last="\${!#}"
touch "\${last//%03d/000}" "\${last//%03d/001}"
`);
  fs.writeFileSync(path.join(dir, 'bin/whisper-cli'), `#!/bin/bash
if [ "\${1:-}" = --help ]; then echo fixture; exit 0; fi
printf 'native\\n' >> "$FIXTURE_DIR/native-invocations"
while [ ! -f "$FIXTURE_DIR/release-native" ]; do sleep 0.05; done
base=''
while [ "$#" -gt 0 ]; do if [ "$1" = -of ]; then shift; base="$1"; fi; shift; done
printf 'Synthetic fixture transcript.' > "$base.txt"
`);
  for (const f of ['ffmpeg', 'whisper-cli']) fs.chmodSync(path.join(dir, 'bin', f), 0o755);
  let clock = 0;
  const config = { platform: 'darwin', managed: true, installRoot: dir, installerSource: installer,
    commandTemplate: `/bin/bash "${dir}/transcribe.sh" --input {input} --output {output}`,
    inputPath: dir + '/input.wav', outputPath: dir + '/output.txt', now: () => clock };
  const guard = helper.prepareStartupAttempt(config); assert.equal(guard.enabled, true, guard.evidence.reason);
  return { dir, guard, config, advance: ms => { clock += ms; } };
}
function execute(f) {
  const child = cp.spawn(bash, [slash(path.join(f.guard.directory, 'transcribe.sh')), '--input', f.config.inputPath, '--output', f.config.outputPath], { env: { ...process.env, FIXTURE_DIR: f.dir }, windowsHide: true, detached: process.platform !== 'win32' });
  liveFixtures.add(child); child.on('close', () => liveFixtures.delete(child));
  let stderr = ''; child.stderr.on('data', b => { stderr += b; }); child.stdout.resume();
  const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, stderr })); });
  return { child, completed };
}
async function mainIntegration() {
  const Module = require('node:module');
  const pluginRoot = path.join(__dirname, '../obsidian-plugin/wechat-inbox-sync');
  const oldLoad = Module._load, oldExtensions = {}, oldArch = os.arch;
  for (const ext of ['.sh', '.ps1', '.py']) { oldExtensions[ext] = Module._extensions[ext]; Module._extensions[ext] = (m, f) => { m.exports = fs.readFileSync(f, 'utf8'); }; }
  Module._load = function(request, ...args) {
    if (request === 'obsidian') return { Plugin: class {}, Modal: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {} };
    return oldLoad.call(this, request, ...args);
  };
  let Plugin;
  try { Plugin = require(path.join(pluginRoot, 'src/main')); }
  finally { Module._load = oldLoad; for (const ext of Object.keys(oldExtensions)) { if (oldExtensions[ext]) Module._extensions[ext] = oldExtensions[ext]; else delete Module._extensions[ext]; } }
  const f = fixture(); f.guard.dispose();
  const plugin = new Plugin(); plugin.settings = {};
  plugin.ensureLocalComponentReadyForUse = async () => {}; plugin.recoverStaleLocalTranscriptionCommand = async () => {};
  plugin.getConfiguredLocalAsrPlatform = () => 'darwin'; plugin.getConfiguredLocalAsrInstallRoot = () => f.dir;
  plugin.getLocalAsrInstallStatus = () => ({ ready: true, scriptOutdated: false });
  plugin.getEffectiveLocalTranscriptionCommand = () => f.config.commandTemplate;
  plugin.setTranscriptionStopAvailable = () => {}; plugin.showSyncProgress = () => {};
  plugin.downloadMediaToTempFile = async () => f.config.inputPath;
  const oldPrepare = helper.prepareStartupAttempt, oldExec = runner.execWithAsrTimeout;
  let calls = 0, captured;
  try {
    os.arch = () => 'arm64';
    helper.prepareStartupAttempt = opts => { const guard = oldPrepare({ ...opts, platform: 'darwin', now: f.config.now }); f.advance(120001); return guard; };
    runner.execWithAsrTimeout = (command, options, callback) => {
      calls++; assert.equal(options.startupGuard.enabled, true);
      captured = options.startupGuard.poll(); assert.equal(captured.code, 'ASR_STARTUP_TIMEOUT');
      captured.cleanupStatus = 'group_cleanup_attempted';
      callback(captured, '', ''); // Synchronous callback must not reattach stale child.
      return { pid: 19999 };
    };
    await assert.rejects(plugin.runLocalTranscription('https://fixture.invalid/audio', { recordId: 'record-main-startup', syncAttemptId: 'attempt-main-startup' }), { code: 'ASR_STARTUP_TIMEOUT' });
    assert.equal(calls, 1); assert.equal(plugin.currentTranscriptionProcess, null);
    const session = JSON.parse(fs.readFileSync(path.join(f.dir, 'asr-diagnostic-last.json'), 'utf8'));
    assert.equal(session.status, 'failed'); assert.equal(session.abort.requestedAt, null);
    assert.equal(session.attempts.length, 1); assert.equal(session.attempts[0].stage, 'transcribe_startup');
    assert.equal(session.attempts[0].timeoutCode, 'ASR_STARTUP_TIMEOUT');
    assert.equal(session.attempts[0].startupGuard.permissionGranted, false);
    const built = report.buildFailureTechnicalReport({ error: captured, recordId: session.recordId, attemptId: session.syncAttemptId, stage: 'transcribe', asrRoot: f.dir });
    const normal = report.normalizeTechnicalReport(built);
    const parsed = JSON.parse(normal.text);
    assert.equal(parsed.asr.attempts[0].startupGuard.nativeStartStatus, 'not_started');
    assert.equal(parsed.asr.attempts[0].timeoutCleanupStatus, 'group_cleanup_attempted');
  } finally { helper.prepareStartupAttempt = oldPrepare; runner.execWithAsrTimeout = oldExec; os.arch = oldArch; }
}
async function run() {
  try {
    assert.equal(helper.ASR_STARTUP_TIMEOUT_MS, 120000);
    const f = fixture(); const launched = execute(f);
    await until(() => fs.existsSync(path.join(f.dir, 'prep-entered')));
    f.advance(600000); assert.equal(f.guard.poll(), null, 'long active preprocessing keeps lease');
    assert.equal(f.guard.evidence.permissionGranted, false);
    fs.writeFileSync(path.join(f.dir, 'release-prep'), '');
    await until(() => fs.existsSync(path.join(f.dir, 'native-invocations')));
    assert.equal(f.guard.poll(), null); assert.equal(f.guard.evidence.permissionGranted, true);
    assert.equal(f.guard.evidence.nativeStartStatus, 'unknown', 'grant is not native observation');
    f.advance(90000000); assert.equal(f.guard.poll(), null, 'silent/long native has no startup limit');
    fs.writeFileSync(path.join(f.dir, 'release-native'), '');
    const success = await launched.completed; assert.equal(success.code, 0, success.stderr);
    assert.equal(fs.readFileSync(path.join(f.dir, 'native-invocations'), 'utf8').trim().split('\n').length, 2, 'chunks share permanent grant');
    assert.equal(fs.readFileSync(path.join(f.dir, 'transcribe.sh'), 'utf8'), original);
    assert.match(f.guard.evidence.originalScriptSha256, /^[a-f0-9]{64}$/);
    assert.notEqual(f.guard.evidence.originalScriptSha256, f.guard.evidence.instrumentedScriptSha256);
    f.guard.dispose();

    const late = fixture(); late.advance(120001);
    const startupError = late.guard.poll(); assert.equal(startupError.code, 'ASR_STARTUP_TIMEOUT');
    assert.equal(late.guard.evidence.elapsedIdleMs, 120001); assert.equal(late.guard.evidence.nativeStartStatus, 'not_started');
    fs.writeFileSync(path.join(late.dir, 'release-prep'), ''); fs.writeFileSync(path.join(late.dir, 'release-native'), '');
    const blocked = await execute(late).completed; assert.notEqual(blocked.code, 0);
    assert.equal(fs.existsSync(path.join(late.dir, 'native-invocations')), false, 'late real wrapper cannot launch after timeout');
    late.guard.dispose();
    const partial = fixture(); fs.mkdirSync(path.join(partial.guard.directory, 'gate'));
    partial.advance(999999); assert.equal(partial.guard.poll(), null, 'claim without metadata is never timeout victory');
    fs.writeFileSync(path.join(partial.guard.directory, 'started'), ''); assert.equal(partial.guard.poll(), null); partial.guard.dispose();
    const unavailable = fixture(); fs.renameSync(unavailable.guard.directory, unavailable.guard.directory + '.moved');
    unavailable.advance(120001); assert.equal(unavailable.guard.poll(), null); assert.equal(unavailable.guard.evidence.status, 'disabled');
    fs.rmSync(unavailable.guard.directory + '.moved', { recursive: true, force: true });
    const unknown = fixture(); fs.appendFileSync(path.join(unknown.dir, 'transcribe.sh'), '# unknown legacy variant\n');
    assert.equal(helper.prepareStartupAttempt(unknown.config).evidence.reason, 'unknown_wrapper_template');
    assert.equal(helper.prepareStartupAttempt({ ...f.config, commandTemplate: f.config.commandTemplate + '; echo custom' }).evidence.reason, 'unknown_command_template');
    assert.equal(helper.prepareStartupAttempt({ ...f.config, platform: 'win32' }).enabled, false); unknown.guard.dispose();
    const activity = fixture(); activity.advance(120001); fs.writeFileSync(path.join(activity.dir, 'transcribe-last.log'), 'progressStage=preparing\n');
    assert.equal(activity.guard.poll(), null); activity.advance(119999); assert.equal(activity.guard.poll(), null);
    activity.advance(2); assert.equal(activity.guard.poll().code, 'ASR_STARTUP_TIMEOUT'); activity.guard.dispose();
    const independent = fixture(); independent.advance(120001);
    const second = helper.prepareStartupAttempt(independent.config); assert.equal(independent.guard.poll().code, 'ASR_STARTUP_TIMEOUT');
    assert.notEqual(second.directory, independent.guard.directory); assert.equal(second.poll(), null);
    independent.guard.dispose(); second.dispose();

    let cleanup = 0; let callbackCount = 0; const controlled = fixture(); controlled.advance(120001);
    // Keep this test alive: production timers intentionally unref themselves.
    const keepAlive = setInterval(() => {}, 1000);
    try {
      const error = await new Promise(resolve => runner.execWithAsrTimeout('fixture', { detached: true, startupGuard: controlled.guard }, e => { callbackCount++; resolve(e); }, {
        platform: 'darwin', execImpl: () => ({ pid: 123 }), terminateGroup: async () => { cleanup++; return true; },
      }));
      assert.equal(error.code, 'ASR_STARTUP_TIMEOUT'); assert.equal(cleanup, 1); assert.equal(callbackCount, 1); controlled.guard.dispose();
      for (const mode of ['group_false', 'group_throw', 'both_throw', 'fallback_false']) {
        const fallback = fixture(); fallback.advance(120001);
        const signals = [];
        const fallbackError = await new Promise(resolve => runner.execWithAsrTimeout('fixture', { detached: true, startupGuard: fallback.guard }, resolve, {
          platform: 'darwin',
          execImpl: () => ({ pid: 128, kill(signal) {
            signals.push(signal);
            if (mode === 'both_throw') throw Object.assign(Error('private diagnostic text must not escape'), { code: 'invalid secret-bearing code /private/path' });
            return mode !== 'fallback_false';
          } }),
          terminateGroup: async () => { if (mode === 'group_false') return false; throw Object.assign(Error('private group failure'), { code: 'EPERM' }); },
        }));
        assert.equal(fallbackError.code, 'ASR_STARTUP_TIMEOUT');
        assert.deepEqual(signals, ['SIGKILL'], mode + ' uses the owned child fallback');
        assert.equal(fallbackError.cleanupStatus, ['both_throw', 'fallback_false'].includes(mode) ? 'failed' : 'direct_child_fallback');
        if (mode === 'group_throw' || mode === 'fallback_false') assert.equal(fallbackError.cleanupError, 'EPERM');
        if (mode === 'both_throw') assert.equal(fallbackError.cleanupError, 'process_group_cleanup_failed');
        assert.ok(!JSON.stringify(fallbackError).includes('private'), 'only safe error code is retained');
        fallback.guard.dispose();
      }
      let complete; const cancelled = fixture(); cancelled.advance(120001);
      const handle = runner.execWithAsrTimeout('fixture', { detached: true, startupGuard: cancelled.guard }, () => {}, {
        platform: 'darwin', execImpl: (_, __, cb) => { complete = cb; return { pid: 124 }; }, terminateGroup: async () => { throw Error('must not terminate'); },
      });
      handle.cancelAsrTimeout(); await pause(600); assert.equal(cancelled.guard.evidence.status, 'waiting'); complete(null, '', ''); cancelled.guard.dispose();
    } finally { clearInterval(keepAlive); }
    // Assert timer disposal itself (not merely settled no-op callbacks).
    const realSetInterval = global.setInterval, realClearInterval = global.clearInterval;
    const activeTimers = new Set();
    global.setInterval = (...args) => { const timer = realSetInterval(...args); activeTimers.add(timer); return timer; };
    global.clearInterval = timer => { activeTimers.delete(timer); return realClearInterval(timer); };
    try {
      let cb;
      const g = { enabled: true, evidence: { status: 'waiting' }, poll() { throw Error('must be disposed'); } };
      const h = runner.execWithAsrTimeout('fixture', { detached: true, startupGuard: g }, () => {}, { platform: 'darwin', execImpl: (_, __, done) => { cb = done; return { pid: 125 }; } });
      assert.equal(activeTimers.size, 1); cb(null, '', ''); assert.equal(activeTimers.size, 0);
      const h2 = runner.execWithAsrTimeout('fixture', { detached: true, startupGuard: g }, () => {}, { platform: 'darwin', execImpl: () => ({ pid: 126 }) });
      assert.equal(activeTimers.size, 1); h2.cancelAsrTimeout(); assert.equal(activeTimers.size, 0);
      const h3 = runner.execWithAsrTimeout('fixture', { detached: true, startupGuard: g }, () => {}, { platform: 'darwin', execImpl: (_, __, done) => { done(null, '', ''); return { pid: 127 }; } });
      assert.equal(activeTimers.size, 0, 'synchronous completion must not start a timer');
    } finally { for (const timer of activeTimers) realClearInterval(timer); global.setInterval = realSetInterval; global.clearInterval = realClearInterval; }
    let attempts = 0;
    await assert.rejects(recovery.executeWithMacRecovery({ platform: 'darwin', managed: true, execute: async () => { attempts++; throw startupError; } }), { code: 'ASR_STARTUP_TIMEOUT' });
    assert.equal(attempts, 1, 'startup timeout is not native crash retry');
    if (process.platform !== 'win32') {
      const owned = fixture(); owned.advance(120001);
      const receipt = await new Promise(resolve => runner.execWithAsrTimeout('sleep 10; ' + owned.guard.command, { detached: true, startupGuard: owned.guard, env: { ...process.env, FIXTURE_DIR: owned.dir } }, resolve, { platform: 'darwin' }));
      assert.equal(receipt.code, 'ASR_STARTUP_TIMEOUT'); assert.equal(receipt.cleanupStatus, 'group_cleanup_attempted');
      assert.equal(fs.existsSync(path.join(owned.dir, 'native-invocations')), false); owned.guard.dispose();
    }
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(root, 'asr-diagnostic-last.json'), JSON.stringify({
      recordId: 'record-startup', syncAttemptId: 'attempt-startup', status: 'failed', platform: 'darwin', startedAt: now, finishedAt: now,
      attempts: [{ attempt: 1, status: 'failed', stage: 'transcribe_startup', logFreshness: 'unavailable', timeoutCode: 'ASR_STARTUP_TIMEOUT', timeoutCleanupStatus: 'failed', startupGuard: late.guard.evidence }],
    }));
    const built = report.buildFailureTechnicalReport({ error: startupError, recordId: 'record-startup', attemptId: 'attempt-startup', stage: 'transcribe', asrRoot: root, now });
    for (const value of [built, report.compactTechnicalReport(built)]) {
      const data = JSON.parse(value.text); assert.equal(data.failure.code, 'ASR_STARTUP_TIMEOUT');
      assert.equal(data.asr.attempts[0].timeoutCode, 'ASR_STARTUP_TIMEOUT');
      assert.equal(data.asr.attempts[0].startupGuard.elapsedIdleMs, 120001);
      assert.equal(data.asr.attempts[0].startupGuard.permissionGranted, false);
      assert.equal(data.asr.attempts[0].timeoutCleanupStatus, 'failed');
    }
    await mainIntegration();
    console.log('PASS: atomic ASR startup gate; real wrapper prep/start/late-timeout, isolation, cancellation, report');
  } finally {
    for (const child of liveFixtures) {
      if (child.exitCode != null || child.signalCode != null) continue;
      try {
        if (process.platform === 'win32') cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
        else process.kill(-child.pid, 'SIGKILL');
      } catch (_) { /* Only fixture children are targeted. */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
