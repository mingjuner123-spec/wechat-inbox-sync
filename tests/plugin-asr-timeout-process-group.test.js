'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  execWithAsrTimeout,
  terminateDetachedProcessGroup,
} = require('../obsidian-plugin/wechat-inbox-sync/src/asr-timeout-process-group');
const asrRecovery = require('../obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils');

function deferredExec() {
  let callback;
  let seenOptions;
  const child = { pid: 321, kill: () => true };
  return {
    child,
    get options() { return seenOptions; },
    call(error, stdout = '', stderr = '') { callback(error, stdout, stderr); },
    execImpl(_command, options, cb) {
      seenOptions = options;
      callback = cb;
      return child;
    },
  };
}

async function testDeadlineSettlesWithoutExecClose() {
  const fixture = deferredExec();
  let terminatedPid = 0;
  const result = new Promise(resolve => {
    execWithAsrTimeout('fixture', { timeout: 15, detached: true }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    }, {
      platform: 'darwin',
      execImpl: fixture.execImpl,
      terminateGroup: async pid => { terminatedPid = pid; return true; },
    });
  });
  assert.equal(fixture.options.timeout, 0, 'Darwin detached exec must use the independent deadline');
  const completed = await result;
  assert.equal(completed.error.code, 'ASR_TIMEOUT');
  assert.match(completed.error.message, /本地转写超过运行时限，已尝试停止；可重试/);
  assert.equal(completed.error.cleanupStatus, 'group_cleanup_attempted');
  assert.equal(terminatedPid, fixture.child.pid);
  assert.equal(completed.stdout, '');
}

async function testCleanupFailureUsesSafeStatusAndFallback() {
  const fixture = deferredExec();
  const result = new Promise(resolve => {
    execWithAsrTimeout('fixture', { timeout: 15, detached: true }, error => resolve(error), {
      platform: 'darwin',
      execImpl: fixture.execImpl,
      terminateGroup: async () => { throw Object.assign(new Error('private detail ignored'), { code: 'EPERM' }); },
    });
  });
  const error = await result;
  assert.equal(error.code, 'ASR_TIMEOUT');
  assert.equal(error.cleanupStatus, 'direct_child_fallback');
  assert.equal(error.cleanupError, 'EPERM');
  assert.ok(!error.message.includes('private detail'));
}

async function testNormalCompletionClearsDeadline() {
  let terminateCount = 0;
  let callbackCount = 0;
  const child = { pid: 322, kill: () => true };
  const result = new Promise((resolve, reject) => {
    execWithAsrTimeout('fixture', { timeout: 40, detached: true }, (error, stdout) => {
      callbackCount++;
      if (error) reject(error);
      else resolve(stdout);
    }, {
      platform: 'darwin',
      execImpl(_command, options, callback) {
        assert.equal(options.timeout, 0);
        callback(null, 'done', '');
        return child;
      },
      terminateGroup: async () => { terminateCount++; return true; },
    });
  });
  assert.equal(await result, 'done');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(callbackCount, 1);
  assert.equal(terminateCount, 0, 'normal completion must not signal the process group');
}

async function testUserCancelKeepsItsOwnCallbackAndClearsDeadline() {
  const fixture = deferredExec();
  let timeoutCount = 0;
  let callbackError;
  const child = execWithAsrTimeout('fixture', { timeout: 20, detached: true }, error => {
    callbackError = error;
  }, {
    platform: 'darwin',
    execImpl: fixture.execImpl,
    terminateGroup: async () => { timeoutCount++; return true; },
  });
  child.cancelAsrTimeout();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(timeoutCount, 0);
  assert.equal(callbackError, undefined);
  fixture.call(Object.assign(new Error('user stopped'), { signal: 'SIGTERM' }));
  assert.equal(callbackError.message, 'user stopped');
  assert.equal(callbackError.code, undefined);
}

async function testNonTargetCallsKeepNodeTimeout() {
  for (const options of [
    { platform: 'darwin', commandOptions: { detached: false } },
    { platform: 'win32', commandOptions: { detached: true } },
  ]) {
    const fixture = deferredExec();
    let callbackError;
    execWithAsrTimeout('fixture', { timeout: 25, ...options.commandOptions }, error => { callbackError = error; }, {
      platform: options.platform,
      execImpl: fixture.execImpl,
      terminateGroup: async () => { throw new Error('must not run'); },
    });
    assert.equal(fixture.options.timeout, 25);
    fixture.call(null, 'ok', '');
    assert.equal(callbackError, null);
  }
}

async function testTermThenKillEscalation() {
  let alive = true;
  const signals = [];
  const fakeKill = (target, signal) => {
    assert.equal(target, -987);
    if (signal === 0) {
      if (!alive) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      return;
    }
    signals.push(signal);
    if (signal === 'SIGKILL') alive = false;
  };
  const result = await terminateDetachedProcessGroup(987, { killProcess: fakeKill, graceMs: 25, pollMs: 10 });
  assert.equal(result, true);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(alive, false);
}

async function testTimeoutDoesNotTriggerNativeCrashRetry() {
  let calls = 0;
  await assert.rejects(asrRecovery.executeWithMacRecovery({
    platform: 'darwin',
    managed: true,
    execute: async () => {
      calls++;
      throw Object.assign(new Error('本地转写超过运行时限，已尝试停止；可重试。'), {
        code: 'ASR_TIMEOUT', signal: 'SIGTERM',
      });
    },
  }), /本地转写超过运行时限/);
  assert.equal(calls, 1, 'timeout must not be treated as a native crash and retried');
}

async function testDetachedShellAndChildAreStopped() {
  if (process.platform === 'win32') {
    console.log('SKIP POSIX detached shell+child integration: current host is Windows');
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-timeout-group-'));
  const heartbeat = path.join(directory, 'heartbeat.log');
  const childPidFile = path.join(directory, 'child.pid');
  const command = "/bin/sh -c 'sleep 30 & echo $! > " + childPidFile + "; while :; do printf x >> " + heartbeat + "; sleep 0.05; done'";
  let processHandle = null;
  try {
    const completion = new Promise(resolve => {
      processHandle = execWithAsrTimeout(command, { timeout: 350, detached: true, maxBuffer: 1024 }, err => resolve(err), { platform: 'darwin' });
    });
    const error = await completion;
    assert.equal(error.code, 'ASR_TIMEOUT');
    assert.equal(error.cleanupStatus, 'group_cleanup_attempted');
    assert.ok(fs.existsSync(childPidFile), 'the native child fixture should have started before timeout');
    const childPid = Number(fs.readFileSync(childPidFile, 'utf8').trim());
    assert.ok(childPid > 0, 'native child pid should be recorded');
    const stoppedSize = fs.statSync(heartbeat).size;
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(fs.statSync(heartbeat).size, stoppedSize, 'wrapper heartbeat must stop after timeout cleanup');
    const nativeState = childProcess.spawnSync('ps', ['-o', 'stat=', '-p', String(childPid)], { encoding: 'utf8' }).stdout.trim();
    assert.ok(!nativeState || nativeState.startsWith('Z'), 'native child must be gone or zombie, state=' + nativeState);
  } finally {
    if (processHandle && processHandle.pid > 0) {
      try { process.kill(-processHandle.pid, 'SIGKILL'); } catch (_) {}
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function main() {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await testDeadlineSettlesWithoutExecClose();
    await testCleanupFailureUsesSafeStatusAndFallback();
    await testNormalCompletionClearsDeadline();
    await testUserCancelKeepsItsOwnCallbackAndClearsDeadline();
    await testNonTargetCallsKeepNodeTimeout();
    await testTermThenKillEscalation();
    await testTimeoutDoesNotTriggerNativeCrashRetry();
    await testDetachedShellAndChildAreStopped();
    console.log('PASS: ASR timeout group cleanup; cases=7');
  } finally {
    clearInterval(keepAlive);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});