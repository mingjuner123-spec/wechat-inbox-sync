'use strict';
const { getHeader, parseDoubaoAsrTaskState } = require('./cloud-transcription-response-utils');

function parseOperatorDoubaoState(response) {
  const code = getHeader(response.headers || {}, 'X-Api-Status-Code');
  if (code === '20000003') return { status: 'no_speech', transcription: '' };
  if (response.status === 401 || response.status === 403 || code === '45000030') {
    throw Object.assign(new Error('Operator provider access is unavailable'), { code: 'OPERATOR_DOUBAO_ACCESS_DENIED', providerDefinitive: true, retryable: true });
  }
  return parseDoubaoAsrTaskState(response);
}

function checkAbort(signal) {
  if (signal && signal.aborted) throw Object.assign(new Error('Operator stopped'), { name: 'AbortError' });
}
function wait(ms, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(Object.assign(new Error('Operator stopped'), { name: 'AbortError' })); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// The durable identity is the server job and generation, never a signed URL.
// Keep the request ID after transport errors and after provider success until
// the server has durably accepted completion. A retry only queries this ID.
async function runOperatorDoubaoTask({ load, save, createRequestId, submit, query,
  beforeSubmit, beforePost = () => {}, signal, attempts = 180, intervalMs = 5000, sleep = wait }) {
  checkAbort(signal);
  let pending = await load();
  if (!pending || !pending.requestId) {
    pending = { requestId: createRequestId(), createdAt: new Date().toISOString(), submitted: false, phase: 'intent' };
    await save(pending);
  }
  checkAbort(signal);
  await beforeSubmit(pending.requestId);
  checkAbort(signal);
  if (!pending.submitted) {
    pending = { ...pending, submitted: true, phase: 'submission_unknown' };
    // Persist submit intent before sending. An interrupted POST is not safe to
    // repeat; the server's submitting lease uses the same provider identity.
    await save(pending);
    checkAbort(signal);
    beforePost();
    let state;
    try { state = await submit(pending.requestId); }
    catch (error) {
      checkAbort(signal);
      if (error.providerDefinitive === true) { await save({ ...pending, phase: 'rejected' }); throw error; }
      throw Object.assign(new Error('Provider submission could not be confirmed; retain original request identity'), { code: 'DOUBAO_SUBMISSION_UNKNOWN' });
    }
    checkAbort(signal);
    if (['success', 'processing', 'no_speech'].includes(state.status)) {
      pending = { ...pending, phase: state.status === 'processing' ? 'accepted' : 'completed' };
      await save(pending);
    }
    if (['success', 'no_speech'].includes(state.status)) return { ...state, providerRequestId: pending.requestId };
  }
  for (let n = 0; n < attempts; n++) {
    if (n) await sleep(intervalMs, signal);
    checkAbort(signal);
    let state;
    try { state = await query(pending.requestId); }
    catch (error) {
      checkAbort(signal);
      // Neither a transport error nor an ambiguous provider error proves that
      // a POST was absent. Never pay twice by generating another request ID.
      throw Object.assign(new Error('Provider result could not be confirmed'), { code: 'DOUBAO_RECONCILIATION_REQUIRED' });
    }
    checkAbort(signal);
    if (['success', 'processing', 'no_speech'].includes(state.status)) {
      const phase = state.status === 'processing' ? 'accepted' : 'completed';
      if (pending.phase !== phase) { pending = { ...pending, phase }; await save(pending); }
    }
    if (['success', 'no_speech'].includes(state.status)) return { ...state, providerRequestId: pending.requestId };
  }
  throw Object.assign(new Error('Provider result is still pending'), { code: 'DOUBAO_RESULT_PENDING' });
}

async function reconcileOperatorDoubaoTasks({ tasks, workerId, query, reconcile, clear, signal, onStatus = () => {}, now = () => Date.now() }) {
  let completed = 0;
  for (const task of tasks.slice(0, 5)) {
    checkAbort(signal);
    if (task.schema !== 1 || task.workerId !== workerId || !task.submitted
      || !task.jobId || !task.attemptId || !task.requestId || !(task.fencingVersion > 0)) continue;
    try {
      const state = await query(task.requestId);
      checkAbort(signal);
      if (state.status !== 'no_speech' && (state.status !== 'success' || !String(state.transcription || '').trim())) {
        if (now() - Date.parse(task.createdAt) > 20 * 60 * 1000) onStatus('DOUBAO_RECONCILIATION_REQUIRED');
        continue;
      }
      await reconcile({ workerId, jobId: task.jobId, attemptId: task.attemptId,
        fencingVersion: task.fencingVersion, providerRequestId: task.requestId,
        phase: 'asr', backend: 'doubao', outcome: state.status === 'no_speech' ? 'no_speech' : 'succeeded',
        transcription: state.transcription, reconcile: true });
      await clear(task);
      completed++;
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      onStatus('DOUBAO_RECONCILIATION_REQUIRED');
      // Retain exact identity on all uncertain results. A later poll reconciles
      // the original submission; this path never submits or claims old jobs.
    }
  }
  return completed;
}

module.exports = { runOperatorDoubaoTask, reconcileOperatorDoubaoTasks, parseOperatorDoubaoState };
