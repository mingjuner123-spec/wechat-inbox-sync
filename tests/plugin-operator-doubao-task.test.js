'use strict';
const assert = require('node:assert/strict');
const { runOperatorDoubaoTask, reconcileOperatorDoubaoTasks, parseOperatorDoubaoState } = require('../obsidian-plugin/wechat-inbox-sync/src/operator-doubao-task');
async function run() {
  assert.throws(() => parseOperatorDoubaoState({ status: 403, headers: { 'X-Api-Status-Code': '45000030' } }), { code: 'OPERATOR_DOUBAO_ACCESS_DENIED', providerDefinitive: true, retryable: true });
  assert.equal(parseOperatorDoubaoState({ status: 200, headers: { 'X-Api-Status-Code': '20000003' } }).status, 'no_speech');
  let deniedState, deniedPosts = 0;
  await assert.rejects(runOperatorDoubaoTask({ load: async () => deniedState, save: async x => { deniedState = x; }, createRequestId: () => 'denied', beforeSubmit: async () => {}, submit: async () => { deniedPosts++; return parseOperatorDoubaoState({ status: 403, headers: {} }); } }), { code: 'OPERATOR_DOUBAO_ACCESS_DENIED', retryable: true });
  assert.equal(deniedPosts, 1); assert.equal(deniedState.phase, 'rejected');
  for (const crash of ['before-post', 'post-delivered', 'accepted']) {
    let stored, posts = 0, crashOnce = true;
    const base = { load: async () => stored, createRequestId: () => 'fixed-request', beforeSubmit: async () => {}, attempts: 1,
      save: async task => { stored = { ...task }; if (crashOnce && ((crash === 'before-post' && task.submitted) || (crash === 'accepted' && task.phase === 'accepted'))) { crashOnce = false; throw Error('simulated crash'); } },
      submit: async () => { posts++; if (crash === 'post-delivered') throw Error('response lost'); return { status: 'processing' }; },
      query: async () => { if (crash === 'before-post') throw Object.assign(Error('ambiguous'), { code: '45000001' }); return { status: 'success', transcription: 'Fixture text.' }; } };
    await assert.rejects(runOperatorDoubaoTask(base));
    if (crash === 'before-post') await assert.rejects(runOperatorDoubaoTask(base), { code: 'DOUBAO_RECONCILIATION_REQUIRED' });
    else assert.equal((await runOperatorDoubaoTask(base)).providerRequestId, 'fixed-request');
    assert.equal(posts, crash === 'before-post' ? 0 : 1, 'unknown or already accepted submission is never posted again');
  }
  let stored, queries = 0;
  const result = await runOperatorDoubaoTask({ load: async () => stored, save: async task => { stored = { ...task }; }, createRequestId: () => 'request', beforeSubmit: async () => {}, submit: async () => ({ status: 'processing' }), query: async () => (++queries < 2 ? { status: 'processing' } : { status: 'success', transcription: 'Done.' }), attempts: 3, sleep: async () => {} });
  assert.equal(result.transcription, 'Done.'); assert.equal(stored.phase, 'completed');
  const task = { ...stored, schema: 1, workerId: 'owner', jobId: 'job', attemptId: 'attempt', fencingVersion: 3 };
  let cleared = 0, sends = 0; const alerts = [];
  const recovery = { tasks: [task, { ...task, workerId: 'other' }], workerId: 'owner', query: async () => ({ status: 'success', transcription: 'Done.' }), reconcile: async body => { sends++; assert.equal(body.fencingVersion, 3); if (sends === 1) throw Error('server offline'); }, clear: async () => { cleared++; }, onStatus: code => alerts.push(code) };
  assert.equal(await reconcileOperatorDoubaoTasks(recovery), 0); assert.equal(cleared, 0);
  assert.equal(await reconcileOperatorDoubaoTasks(recovery), 1); assert.equal(cleared, 1); assert.equal(sends, 2);
  assert.deepEqual(alerts, ['DOUBAO_RECONCILIATION_REQUIRED']);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(reconcileOperatorDoubaoTasks({ ...recovery, signal: abort.signal }), { name: 'AbortError' });
  console.log('provider crash windows, stable identity, bounded uncertainty, processing, completion retry and shutdown passed');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
