'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const childProcess = require('child_process');
const recovery = require('../obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-native-evidence-test-'));
const reportDir = path.join(scratch, 'DiagnosticReports');
const binaryPath = '/opt/asr/main';
const now = Date.now();
const iso = value => new Date(value).toISOString();
function sessionFixture() {
  return {
    platform: 'darwin', startedAt: iso(now - 10000), finishedAt: iso(now - 1000),
    runtime: { binaryPathSha256: crypto.createHash('sha256').update(binaryPath).digest('hex') },
    attempts: [{ attempt: 1, startedAt: iso(now - 6000), finishedAt: iso(now - 4000), nativePids: [4321] }],
  };
}
function writeIps(name, { pid = 4321, captureTime = iso(now - 5000), procPath = binaryPath } = {}) {
  fs.mkdirSync(reportDir, { recursive: true });
  const file = path.join(reportDir, name);
  fs.writeFileSync(file, JSON.stringify({ procName: 'main', procPath, pid, captureTime,
    faultingThread: 0, threads: [{ frames: [{ symbol: 'fixture::native_crash', imageIndex: 0, imageOffset: 5 }] }],
    usedImages: [{ name: binaryPath, arch: 'x86_64', uuid: 'fixture-image' }] }));
  fs.utimesSync(file, new Date(), new Date());
  return file;
}

async function testAttemptScopedCollection() {
  const session = sessionFixture();
  fs.mkdirSync(reportDir, { recursive: true });
  writeIps('main-other-pid.ips', { pid: 9999 });
  assert.match(recovery.readMatchingCrashSummary(session, { directory: reportDir, attempt: session.attempts[0] }), /no report matching/);
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(reportDir, { recursive: true });
  writeIps('main-other-time.ips', { captureTime: iso(now - 60000) });
  assert.match(recovery.readMatchingCrashSummary(session, { directory: reportDir, attempt: session.attempts[0] }), /no report matching/);
  session.attempts.push({ attempt: 2, startedAt: iso(now - 3000), finishedAt: iso(now - 1000), nativePids: [5432] });
  assert.match(recovery.readMatchingCrashSummary(session, { directory: reportDir, attempt: session.attempts[1] }), /no report matching/, 'a report outside the selected attempt window cannot be reused');
  session.attempts.pop();
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(reportDir, { recursive: true });
  writeIps('main-wrong-path.ips', { procPath: '/other/main' });
  assert.match(recovery.readMatchingCrashSummary(session, { directory: reportDir, attempt: session.attempts[0] }), /no report matching/);
  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(reportDir, { recursive: true });

  const pending = recovery.collectMatchingCrashSummary(session, session.attempts[0], {
    directory: reportDir, retryDelaysMs: [0, 40],
  });
  setTimeout(() => writeIps('main-late-report.ips'), 10);
  const result = await pending;
  assert.match(result, /fixture::native_crash/);
  assert.match(result, /same_attempt_pid_and_time/);
  assert.equal(JSON.parse(result).associationReliability.attempt, 1);

  fs.rmSync(reportDir, { recursive: true, force: true });
  fs.mkdirSync(reportDir, { recursive: true });
  let waited = 0;
  const exhausted = await recovery.collectMatchingCrashSummary(session, session.attempts[0], {
    directory: reportDir, retryDelaysMs: [0, 5000, 5000], delay: async ms => { waited += ms; },
  });
  assert.equal(waited, 6000, 'collector enforces a six-second total wait cap');
  assert.match(exhausted, /before deadline/);
}

function loadPlugin() {
  const originalLoad = Module._load;
  const originalExtensions = {};
  for (const ext of ['.ps1', '.sh', '.py']) {
    originalExtensions[ext] = Module._extensions[ext];
    Module._extensions[ext] = (mod, file) => { mod.exports = fs.readFileSync(file, 'utf8'); };
  }
  Module._load = function (request, ...args) {
    if (request === 'obsidian') return { Plugin: class {}, Modal: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {}, requestUrl: async () => ({}) };
    return originalLoad.call(this, request, ...args);
  };
  try { return require('../obsidian-plugin/wechat-inbox-sync/src/main'); }
  finally {
    Module._load = originalLoad;
    for (const ext of Object.keys(originalExtensions)) {
      if (originalExtensions[ext]) Module._extensions[ext] = originalExtensions[ext];
      else delete Module._extensions[ext];
    }
  }
}
function pluginFixture(Plugin, name) {
  const root = path.join(scratch, name);
  fs.mkdirSync(root, { recursive: true });
  const plugin = new Plugin();
  plugin.settings = {};
  plugin.ensureLocalComponentReadyForUse = async () => {};
  plugin.recoverStaleLocalTranscriptionCommand = async () => {};
  plugin.getConfiguredLocalAsrPlatform = () => 'darwin';
  plugin.getConfiguredLocalAsrInstallRoot = () => root.replace(/\\/g, '/');
  plugin.getLocalAsrInstallStatus = () => ({ ready: true, scriptOutdated: false, whisperPath: path.join(root, 'bin', 'whisper-cli') });
  plugin.getEffectiveLocalTranscriptionCommand = () => `bash "${path.join(root, 'transcribe.sh')}" --input {input} --output {output}`;
  plugin.setTranscriptionStopAvailable = () => {};
  plugin.showSyncProgress = () => {};
  plugin.downloadMediaToTempFile = async () => {
    const input = path.join(root, 'input.mp4');
    fs.writeFileSync(input, 'fixture');
    return input;
  };
  return { plugin, root };
}
function writeRunLog(root, pid, exit) {
  fs.writeFileSync(path.join(root, 'transcribe-last.log'), [
    'status=failed', 'progressStage=transcribing', 'progressCurrent=0', 'progressTotal=1',
    `progressPid=${pid}`, `nativeExit=${exit}`,
  ].join('\n'));
}

async function testRunLocalTranscriptionIntegration() {
  const Plugin = loadPlugin();
  const original = { ensure: recovery.ensureManagedMacScript, collect: recovery.collectMatchingCrashSummary, exec: childProcess.exec };
  const events = [];
  try {
    recovery.ensureManagedMacScript = () => true;
    recovery.collectMatchingCrashSummary = async (session, attempt) => {
      events.push(`collect:${session.status}:${attempt.attempt}`);
      await new Promise(resolve => setTimeout(resolve, 5));
      return `captured fixture crash summary attempt ${attempt.attempt}`;
    };
    const failed = pluginFixture(Plugin, 'failed');
    let count = 0;
    childProcess.exec = (_command, _options, callback) => {
      const attempt = ++count;
      setImmediate(() => {
        writeRunLog(failed.root, 5000 + attempt, 139);
        events.push(`exec:${attempt}`);
        callback(Object.assign(new Error('Segmentation fault: 11'), { code: 139 }), '', '');
      });
      return { pid: 5000 + attempt, killed: false, kill() { this.killed = true; } };
    };
    await assert.rejects(failed.plugin.runLocalTranscription('https://example.invalid/failure', { recordId: 'fixture-failure' }));
    assert.deepEqual(events, ['exec:1', 'exec:2', 'collect:failed:1', 'collect:failed:2'], 'both collections start only after CPU retry ended: ' + JSON.stringify(events));
    const failedSession = JSON.parse(fs.readFileSync(path.join(failed.root, 'asr-diagnostic-last.json'), 'utf8'));
    assert.equal(failedSession.attempts[0].crashSummaryStatus, 'matched');
    assert.equal(failedSession.attempts[1].crashSummaryStatus, 'matched');
    const detail = recovery.detailedDiagnostic(failed.root);
    assert.equal((detail.match(/captured fixture crash summary attempt 1/g) || []).length, 1, 'attempt one stack is emitted once');
    assert.equal((detail.match(/captured fixture crash summary attempt 2/g) || []).length, 1, 'attempt two stack is emitted once');
    assert.equal(fs.existsSync(path.join(failed.root, 'input.mp4')), false, 'failure cleanup still runs');

    events.length = 0;
    const successful = pluginFixture(Plugin, 'successful');
    count = 0;
    childProcess.exec = (_command, _options, callback) => {
      const attempt = ++count;
      setImmediate(() => {
        writeRunLog(successful.root, 6000 + attempt, attempt === 1 ? 139 : 0);
        events.push(`exec:${attempt}`);
        if (attempt === 1) callback(Object.assign(new Error('Segmentation fault: 11'), { code: 139 }), '', '');
        else {
          fs.writeFileSync(path.join(successful.root, 'input.mp4.txt'), '这是一段完整有效的中文语音转写结果。');
          callback(null, '', '');
        }
      });
      return { pid: 6000 + attempt, killed: false, kill() { this.killed = true; } };
    };
    const text = await successful.plugin.runLocalTranscription('https://example.invalid/success', { recordId: 'fixture-success' });
    assert.match(text, /完整有效/);
    assert.deepEqual(events, ['exec:1', 'exec:2'], 'successful retry does not collect crash evidence');
    const successSession = JSON.parse(fs.readFileSync(path.join(successful.root, 'asr-diagnostic-last.json'), 'utf8'));
    assert.equal(successSession.status, 'success');
    assert.ok(!successSession.attempts.some(attempt => attempt.crashSummary));
  } finally {
    recovery.ensureManagedMacScript = original.ensure;
    recovery.collectMatchingCrashSummary = original.collect;
    childProcess.exec = original.exec;
  }
}

async function testCancelledCleanupAndPropagation() {
  const Plugin = loadPlugin();
  const original = { ensure: recovery.ensureManagedMacScript, collect: recovery.collectMatchingCrashSummary, exec: childProcess.exec };
  try {
    recovery.ensureManagedMacScript = () => true;
    let collected = 0;
    recovery.collectMatchingCrashSummary = async () => { collected++; return '[unavailable: cancelled fixture]'; };
    const { plugin, root } = pluginFixture(Plugin, 'cancelled');
    const controller = new AbortController();
    childProcess.exec = (_command, _options, callback) => {
      setImmediate(() => {
        writeRunLog(root, 7001, 139);
        controller.abort();
        callback(Object.assign(new Error('Segmentation fault: 11'), { code: 139 }), '', '');
      });
      return { pid: 7001, killed: false, kill() { this.killed = true; } };
    };
    await assert.rejects(plugin.runLocalTranscription('fixture', { recordId: 'fixture-cancel', signal: controller.signal }));
    assert.equal(collected, 1, 'cancelled crash still permits bounded collection');
    assert.equal(plugin.currentTranscriptionAbortRequest, null, 'finally releases ownership');
    assert.equal(fs.existsSync(path.join(root, 'input.mp4')), false, 'cancelled path still cleans temporary media');
  } finally {
    recovery.ensureManagedMacScript = original.ensure;
    recovery.collectMatchingCrashSummary = original.collect;
    childProcess.exec = original.exec;
  }
}

(async () => {
  try {
    await testAttemptScopedCollection();
    await testRunLocalTranscriptionIntegration();
    await testCancelledCleanupAndPropagation();
    console.log('PASS: bounded attempt-scoped crash evidence, actual main IPS identity matching, failure wiring, success skip and cancellation cleanup');
  } finally {
    if (!scratch.startsWith(path.join(os.tmpdir(), 'mac-native-evidence-test-'))) throw new Error('unsafe cleanup');
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
