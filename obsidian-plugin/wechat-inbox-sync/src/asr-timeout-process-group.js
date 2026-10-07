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

function execWithAsrTimeout(command, options, callback, {
  platform = process.platform,
  execImpl = childProcess.exec,
  terminateGroup = terminateDetachedProcessGroup,
} = {}) {
  const timeoutMs = Math.max(0, Number(options && options.timeout) || 0);
  const ownsDetachedGroup = platform === 'darwin' && options && options.detached === true;
  let settled = false;
  let timeoutStarted = false;
  let timer = null;

  const finish = (error, stdout, stderr) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    callback(error, stdout, stderr);
  };

  const execOptions = {
    ...options,
    timeout: ownsDetachedGroup ? 0 : timeoutMs,
  };
  const child = execImpl(command, execOptions, (error, stdout, stderr) => {
    if (timeoutStarted) return;
    finish(error, stdout, stderr);
  });

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
    };
  }
  return child;
}

module.exports = {
  execWithAsrTimeout,
  terminateDetachedProcessGroup,
};