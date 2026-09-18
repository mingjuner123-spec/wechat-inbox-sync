'use strict';

const DEFAULT_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 5 * 60 * 1000;
const MAX_IDLE_INTERVAL_MS = 10 * 60 * 1000;
const RECORD_RETRY_MS = 5 * 60 * 1000;

// Owns scheduling only: the existing sync pipeline remains responsible for
// cloud claims, local commit receipts, acknowledgements and content processing.
function createAutoSyncController({
  run,
  canRun = () => true,
  isBusy = () => false,
  now = () => Date.now(),
  setTimer = (fn, delay) => setTimeout(fn, delay),
  clearTimer = (id) => clearTimeout(id),
  intervalMs = DEFAULT_INTERVAL_MS,
  maxIntervalMs = MAX_INTERVAL_MS,
  maxIdleIntervalMs = MAX_IDLE_INTERVAL_MS,
} = {}) {
  let enabled = false;
  let disposed = false;
  let running = false;
  let timer = null;
  let timerDueAt = Infinity;
  let generation = 0;
  let failures = 0;
  let idleRuns = 0;
  let nextAllowedAt = 0;
  let lastCompletedAt = -Infinity;
  const records = new Map();

  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    timerDueAt = Infinity;
  }

  function schedule(delay) {
    clear();
    if (disposed || !enabled) return;
    const wait = Math.max(delay, nextAllowedAt - now(), 0);
    timerDueAt = now() + wait;
    timer = setTimer(tick, wait);
  }

  async function tick() {
    timer = null;
    timerDueAt = Infinity;
    if (disposed || !enabled) return;
    if (running || isBusy() || !canRun()) {
      schedule(intervalMs);
      return;
    }
    if (now() < nextAllowedAt) {
      schedule(nextAllowedAt - now());
      return;
    }
    running = true;
    const startedGeneration = generation;
    let result;
    try {
      result = await run();
    } catch (_) {
      result = { pollFailed: true };
    } finally {
      running = false;
      lastCompletedAt = now();
    }
    if (disposed || !enabled) return;
    // A pause/resume while a task was in flight owns the new schedule.
    if (startedGeneration !== generation) {
      schedule(intervalMs);
      return;
    }
    if (result && result.pollFailed) {
      failures = Math.min(failures + 1, 8);
      idleRuns = 0;
    } else {
      failures = 0;
      // A content-processing failure still means work arrived. Records skipped
      // by retry cooldown do not count as failed attempts and remain idle.
      const hadActivity = result && (result.written > 0 || result.failed > 0);
      idleRuns = hadActivity ? 0 : Math.min(idleRuns + 1, 7);
    }
    const delay = failures
      ? Math.min(maxIntervalMs, intervalMs * (2 ** failures))
      // Three, five and seven consecutive empty checks progressively slow down.
      : Math.min(maxIdleIntervalMs, intervalMs * (idleRuns >= 7 ? 10 : idleRuns >= 5 ? 5 : idleRuns >= 3 ? 2 : 1));
    nextAllowedAt = now() + delay;
    schedule(delay);
  }

  return {
    setEnabled(value) {
      const next = Boolean(value);
      if (disposed || next === enabled) return;
      enabled = next;
      generation += 1;
      clear();
      if (enabled) {
        failures = 0;
        idleRuns = 0;
        nextAllowedAt = 0;
        schedule(1000);
      }
    },
    wake() {
      if (!enabled || disposed || running) return;
      // Focus/online events may shorten idle waits, but never bypass error
      // backoff or cause more than one automatic check per minute. Keep an
      // earlier timer so a storm of focus events cannot postpone it forever.
      const earliest = Math.max(lastCompletedAt + intervalMs, failures ? nextAllowedAt : 0);
      const due = Math.max(now() + 1000, earliest);
      if (timer !== null && timerDueAt <= due) return;
      nextAllowedAt = earliest;
      schedule(due - now());
    },
    dispose() {
      disposed = true;
      enabled = false;
      generation += 1;
      clear();
      records.clear();
    },
    canRetry(key) {
      const entry = records.get(key);
      return !entry || (!entry.stopped && (entry.unlimited || entry.attempts < 3) && now() >= entry.retryAt);
    },
    failed(key, unlimited = false) {
      if (disposed) return;
      const previous = records.get(key);
      if (previous && previous.stopped) return;
      const attempts = (previous ? previous.attempts : 0) + 1;
      records.set(key, { attempts, retryAt: now() + RECORD_RETRY_MS * (2 ** Math.min(attempts - 1, 3)), stopped: false, unlimited });
    },
    stopped(key) {
      records.set(key, { attempts: 0, retryAt: Infinity, stopped: true });
    },
    succeeded(key) { records.delete(key); },
    retryFailures() {
      for (const [key, entry] of records) {
        if (!entry.stopped) records.delete(key);
      }
    },
  };
}

module.exports = { createAutoSyncController, DEFAULT_INTERVAL_MS, MAX_INTERVAL_MS, MAX_IDLE_INTERVAL_MS, RECORD_RETRY_MS };
