'use strict';

const childProcess = require('child_process');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function processGroupExists(pid, killProcess) {
  try {
    killProcess(-pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') return false;
    return true;
  }
}

async function terminateDetachedProcessGroup(pid, {
  killProcess = process.kill,
  graceMs = 1500,
  pollMs = 50,
} = {}) {
  const groupId = Number(pid);
  if (!Number.isInteger(groupId) || groupId <= 0) return false;
  const signalGroup = (signal) => {
    try {
      killProcess(-groupId, signal);
      return true;
    } catch (error) {
      if (error && error.code === 'ESRCH') return false;
      throw error;
    }
  };

  if (!signalGroup('SIGTERM')) return false;
  const deadline = Date.now() + Math.max(0, Number(graceMs) || 0);
  while (Date.now() < deadline && processGroupExists(groupId, killProcess)) {
    await delay(Math.min(Math.max(10, Number(pollMs) || 50), deadline - Date.now()));
  }
  if (!processGroupExists(groupId, killProcess)) return true;
  signalGroup('SIGKILL');
  return true;
}

function safeErrorCode(error) {
  const code = String(error && error.code || 'process_group_cleanup_failed');
  return /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : 'process_group_cleanup_failed';
}

function createExecError(message, properties = {}) {
  const error = new Error(message);
  Object.assign(error, properties);
  return error;
}

function execDetachedShell(command, options, callback, {
  spawnImpl = childProcess.spawn,
  terminateGroup = terminateDetachedProcessGroup,
} = {}) {
  const encoding = options && options.encoding === undefined ? 'utf8' : options && options.encoding;
  const maxBuffer = Math.max(1, Number(options && options.maxBuffer) || 1024 * 1024);
  const spawnOptions = { ...options, detached: true, shell: true, stdio: ['ignore', 'pipe', 'pipe'] };
  delete spawnOptions.maxBuffer;
  delete spawnOptions.encoding;
  delete spawnOptions.timeout;
  const child = spawnImpl(command, [], spawnOptions);
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let spawnError = null;
  let outputError = null;
  let outputCleanup = null;
  let settled = false;

  const asOutput = buffer => encoding === null || encoding === 'buffer'
    ? buffer
    : buffer.toString(encoding || 'utf8');
  const finish = (error, code, signal) => {
    if (settled) return;
    settled = true;
    if (error) {
      if (error.code === undefined && code !== null && code !== undefined) error.code = code;
      if (error.signal === undefined) error.signal = signal || null;
      if (error.killed === undefined) error.killed = false;
      if (error.cmd === undefined) error.cmd = command;
    }
    callback(error || null, asOutput(stdout), asOutput(stderr));
  };
  const append = (current, chunk, streamName) => {
    if (outputError) return current;
    const next = Buffer.concat([current, Buffer.from(chunk)]);
    if (next.length <= maxBuffer) return next;
    const limited = next.subarray(0, maxBuffer);
    outputError = createExecError(`${streamName} maxBuffer length exceeded`, {
      code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      killed: true,
      signal: null,
      cmd: command,
      cleanupStatus: 'pending',
    });
    outputCleanup = Promise.resolve().then(async () => {
      try {
        const groupHandled = await terminateGroup(child && child.pid);
        if (groupHandled) {
          outputError.cleanupStatus = 'group_cleanup_attempted';
        } else {
          const fallbackSent = Boolean(child && typeof child.kill === 'function' && child.kill('SIGKILL'));
          outputError.cleanupStatus = fallbackSent ? 'direct_child_fallback' : 'process_already_exited';
        }
      } catch (error) {
        outputError.cleanupError = safeErrorCode(error);
        try {
          const fallbackSent = Boolean(child && typeof child.kill === 'function' && child.kill('SIGKILL'));
          outputError.cleanupStatus = fallbackSent ? 'direct_child_fallback' : 'failed';
        } catch (fallbackError) {
          outputError.cleanupStatus = 'failed';
          outputError.cleanupError = safeErrorCode(fallbackError);
        }
      }
      finish(outputError, null, null);
    });
    return limited;
  };

  if (child.stdout && typeof child.stdout.on === 'function') {
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk, 'stdout'); });
  }
  if (child.stderr && typeof child.stderr.on === 'function') {
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk, 'stderr'); });
  }
  child.on('error', error => { spawnError = error; });
  child.on('close', (code, signal) => {
    if (outputError) {
      if (outputCleanup) outputCleanup.then(() => finish(outputError, code, signal));
      return;
    }
    if (spawnError) {
      finish(spawnError, code, signal);
      return;
    }
    if (code !== 0) {
      finish(createExecError(`${command} exited with code ${code === null ? 'null' : code}${signal ? ` (${signal})` : ''}`, {
        code,
        signal: signal || null,
        killed: Boolean(signal),
        cmd: command,
      }), code, signal);
      return;
    }
    finish(null, code, signal);
  });
  return child;
}

function execWithAsrTimeout(command, options, callback, {
  platform = process.platform,
  execImpl = childProcess.exec,
  spawnImpl = childProcess.spawn,
  terminateGroup = terminateDetachedProcessGroup,
} = {}) {
  const timeoutMs = Math.max(0, Number(options && options.timeout) || 0);
  const ownsDetachedGroup = platform === 'darwin' && options && options.detached === true;
  let settled = false;
  let timeoutStarted = false;
  let timer = null;
  let startupTimer = null;
  const startupGuard = options && options.startupGuard;

  const finish = (error, stdout, stderr) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (startupTimer) clearInterval(startupTimer);
    startupTimer = null;
    callback(error, stdout, stderr);
  };

  const execOptions = {
    ...options,
    timeout: ownsDetachedGroup ? 0 : timeoutMs,
  };
  delete execOptions.startupGuard;
  const onExecComplete = (error, stdout, stderr) => {
    if (timeoutStarted) return;
    finish(error, stdout, stderr);
  };
  const child = ownsDetachedGroup && execImpl === childProcess.exec
    ? execDetachedShell(command, execOptions, onExecComplete, { spawnImpl, terminateGroup })
    : execImpl(command, execOptions, onExecComplete);

  if (ownsDetachedGroup && startupGuard && startupGuard.enabled && !settled) {
    startupTimer = setInterval(() => {
      if (settled || timeoutStarted) return;
      if (child && (child.killed || child.exitCode != null || child.signalCode != null)) {
        clearInterval(startupTimer); startupTimer = null; return;
      }
      const timeoutError = startupGuard.poll();
      if (!timeoutError) {
        if (['permission_granted', 'disabled'].includes(startupGuard.evidence.status)) {
          clearInterval(startupTimer); startupTimer = null;
        }
        return;
      }
      // poll won the atomic gate before cleanup: ASR cannot start afterwards.
      timeoutStarted = true;
      Promise.resolve().then(async () => {
        try {
          const exited = child && (child.exitCode != null || child.signalCode != null);
          if (exited) {
            timeoutError.cleanupStatus = 'process_already_exited';
          } else if (await terminateGroup(child && child.pid)) {
            timeoutError.cleanupStatus = 'group_cleanup_attempted';
          } else {
            const fallbackSent = Boolean(child && typeof child.kill === 'function' && child.kill('SIGKILL'));
            timeoutError.cleanupStatus = fallbackSent ? 'direct_child_fallback' : 'process_already_exited';
          }
        } catch (error) {
          timeoutError.cleanupError = safeErrorCode(error);
          try {
            const fallbackSent = Boolean(child && typeof child.kill === 'function' && child.kill('SIGKILL'));
            timeoutError.cleanupStatus = fallbackSent ? 'direct_child_fallback' : 'failed';
          } catch (fallbackError) {
            timeoutError.cleanupStatus = 'failed';
            timeoutError.cleanupError = safeErrorCode(fallbackError);
          }
        }
        finish(timeoutError, '', '');
      });
    }, 500);
    if (startupTimer.unref) startupTimer.unref();
  }

  if (ownsDetachedGroup && timeoutMs > 0 && !settled) {
    timer = setTimeout(() => {
      if (settled || timeoutStarted) return;
      timeoutStarted = true;
      const timeoutError = Object.assign(
        new Error('本地转写超过运行时限，已尝试停止；可重试。'),
        { code: 'ASR_TIMEOUT', killed: true, signal: 'SIGTERM', cleanupStatus: 'pending' },
      );
      Promise.resolve()
        .then(async () => {
          try {
            const groupHandled = await terminateGroup(child && child.pid);
            if (groupHandled) {
              timeoutError.cleanupStatus = 'group_cleanup_attempted';
              return;
            }
            const fallbackSent = Boolean(child && typeof child.kill === 'function' && child.kill('SIGKILL'));
            timeoutError.cleanupStatus = fallbackSent ? 'direct_child_fallback' : 'process_already_exited';
          } catch (error) {
            timeoutError.cleanupError = safeErrorCode(error);
            try {
              const fallbackSent = Boolean(child && typeof child.kill === 'function' && child.kill('SIGKILL'));
              timeoutError.cleanupStatus = fallbackSent ? 'direct_child_fallback' : 'failed';
            } catch (fallbackError) {
              timeoutError.cleanupStatus = 'failed';
              timeoutError.cleanupError = safeErrorCode(fallbackError);
            }
          }
        })
        .then(() => finish(timeoutError, '', ''));
    }, timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  if (child && ownsDetachedGroup) {
    child.cancelAsrTimeout = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (startupTimer) clearInterval(startupTimer);
      startupTimer = null;
    };
  }
  return child;
}

module.exports = {
  execDetachedShell,
  execWithAsrTimeout,
  terminateDetachedProcessGroup,
};
