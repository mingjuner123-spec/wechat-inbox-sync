'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOperatorMediaNode } = require('../obsidian-plugin/wechat-inbox-sync/src/operator-media-node');
const { runOperatorDoubaoTask, parseOperatorDoubaoState } = require('../obsidian-plugin/wechat-inbox-sync/src/operator-doubao-task');
const env = { WECHAT_INBOX_OPERATOR_NODE_ENABLED: '1', WECHAT_INBOX_OPERATOR_NODE_ID: 'fixture-node', WECHAT_INBOX_OPERATOR_NODE_TOKEN: 'fixture-token', WECHAT_INBOX_OPERATOR_NODE_API_BASE: 'https://fixture.invalid/sync' };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function providerFailure(mode) {
  let state, posts = 0, issued = false, denied = false;
  const completed = [], claims = [];
  const plugin = { settings: {}, uploadWorkerMediaForJob() {},
    getLocalAsrInstallStatus: () => ({ ready: false, ffmpegPath: 'fixture' }),
    isOperatorDoubaoAvailable: () => !denied,
    runOperatorDoubaoTranscription: async (_url, options) => {
      try {
        return await runOperatorDoubaoTask({ load: async () => state, save: async x => { if (mode === 'save-fails' && x.submitted) throw Error('fixture disk unavailable'); state = x; }, createRequestId: () => 'fixture-request', beforeSubmit: options.beforeSubmit, beforePost: options.beforePost, signal: options.signal,
          submit: async () => { posts++; return parseOperatorDoubaoState({ status: 403, headers: { 'X-Api-Status-Code': '45000030' } }); } });
      } catch (error) { if (error.code === 'OPERATOR_DOUBAO_ACCESS_DENIED') denied = true; throw error; }
    } };
  const node = createOperatorMediaNode({ plugin, env, setTimer: () => 1, clearTimer() {}, request: async (route, body, options) => {
    if (route.endsWith('/heartbeat') && body.stage === 'submitting') {
      if (mode === 'heartbeat-fails') throw Object.assign(Error('offline'), { code: 'FIXTURE_OFFLINE' });
      if (mode === 'abort') { void node.stop(); throw Object.assign(Error('stopped'), { name: 'AbortError' }); }
    }
    if (route.endsWith('/claim')) {
      claims.push(body);
      if (body.backend !== 'doubao' || issued) return { jobs: [] };
      issued = true;
      return { jobs: [{ jobId: 'provider-failure', attemptId: 'attempt', fencingVersion: 1, leaseToken: 'fixture', phase: 'asr', backend: 'doubao', controlledMediaUrl: 'https://fixture.invalid/audio.mp3' }] };
    }
    if (route.endsWith('/complete')) completed.push(body);
    return {};
  } });
  node.start();
  try {
    await node.poll();
    assert.equal(posts, mode === 'denied' ? 1 : 0);
    assert.ok(completed.length > 0);
    assert.ok(completed.every(x => x.outcome === 'failed' && x.error.retryable === true), 'no POST / definite rejection leaves work retryable, never submission_unknown');
    if (mode === 'denied') {
      const n = claims.length; await node.poll();
      assert.ok(claims.slice(n).every(x => x.backend !== 'doubao' && !x.capabilities.includes('doubao')), 'permission rejection withdraws provider capacity');
    }
  } finally { await node.stop(); }
}
async function run() {
  // End-to-end node dispatch: idle ASR never uploads; busy/failed local work
  // hands off the already captured audio, without acquiring a second job.
  for (const mode of ['idle', 'busy', 'raced', 'preflight-raced', 'failed', 'empty', 'no-speech', 'no-speech-markers', 'no-speech-linux', 'cancelled']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-local-first-'));
    let issued = false, uploads = 0, asr = 0, availabilityChecks = 0, capturing = false;
    const completions = [];
    const plugin = {
      settings: {}, getLocalAsrInstallStatus: () => ({ ready: true, ffmpegPath: 'fixture' }),
      isOperatorLocalAsrAvailable: () => mode !== 'busy' && !(mode === 'preflight-raced' && capturing && ++availabilityChecks >= 3),
      acquireOperatorDouyinMediaToTempFile: async () => { capturing=true; const p=path.join(dir,'media.mp4'); fs.writeFileSync(p,'fixture'); return p; },
      transcodeCloudFallbackMediaToMp3: async p => ({ path:p, owned:false }),
      runOperatorLocalTranscription: async () => {
        asr++;
        if (mode === 'raced') throw Object.assign(Error('busy'), { code:'OPERATOR_ASR_BUSY' });
        if (mode === 'failed') throw Object.assign(Error('native exit'), { code:'LOCAL_ASR_FAILED' });
        if (mode === 'cancelled') throw Object.assign(Error('cancelled'), { name:'AbortError' });
        if (mode === 'empty') return { transcription:'' };
        if (mode === 'no-speech') throw Object.assign(Error('silence'), { code:'TRANSCRIPTION_NO_SPEECH',noSpeechEvidence:'full-decode-and-vad-no-speech-segments' });
        if (mode === 'no-speech-markers') throw Object.assign(Error('music'), { code:'TRANSCRIPTION_NO_SPEECH',noSpeechEvidence:'non-speech-markers' });
        if (mode === 'no-speech-linux') throw Object.assign(Error('silence'), { code:'LOCAL_ASR_NO_SPEECH',noSpeech:true,retryable:false });
        return { transcription:'fixture transcript', transcriptionSegments:[{ start:0, end:2, text:'fixture transcript' }] };
      },
      uploadWorkerMediaForJob: async (p, job) => {
        assert.ok(fs.existsSync(p)); assert.equal(job.jobId,'local-first'); uploads++;
        return { completion:{ mediaReady:true } };
      },
    };
    const node=createOperatorMediaNode({ plugin,env,setTimer:()=>1,clearTimer(){},request:async(route,body)=>{
      if(route.endsWith('/claim') && body.phases[0]==='media' && !issued){issued=true;return {jobs:[{
        jobId:'local-first',attemptId:'attempt',fencingVersion:1,leaseToken:'fixture',phase:'media',
        sourceType:'douyin_url',sourceUrl:'https://www.douyin.com/video/123456789',
      }]};}
      if(route.endsWith('/complete'))completions.push(body);
      return {jobs:[]};
    }});
    node.start();
    try {
      await node.poll();
      assert.equal(uploads,['busy','raced','preflight-raced','failed','empty'].includes(mode)?1:0,mode);
      assert.equal(asr,['busy','preflight-raced'].includes(mode)?0:1,mode);
      if(mode==='idle'){
        assert.equal(completions.length,1);assert.equal(completions[0].phase,'media');
        assert.equal(completions[0].backend,'local_whisper_cpp');assert.equal(completions[0].outcome,'succeeded');
        assert.equal(completions[0].transcriptionSegments.length,1);
      }
      if(mode==='cancelled')assert.equal(completions[0].outcome,'failed');
      if(mode.startsWith('no-speech'))assert.equal(completions[0].outcome,'no_speech');
    } finally {await node.stop();fs.rmSync(dir,{recursive:true,force:true});}
  }
  for (const mode of ['heartbeat-fails', 'save-fails', 'abort', 'denied']) await providerFailure(mode);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-lanes-'));
  let releaseAsr, asrStarted = false, uploaded = false, providerFinished = false;
  const asrWait = new Promise(resolve => { releaseAsr = resolve; });
  const claims = [], completed = [], issued = new Set();
  const plugin = {
    settings: { doubaoAsrApiKey: 'fixture-only' },
    getLocalAsrInstallStatus: () => ({ ready: true, ffmpegPath: 'fixture' }),
    isOperatorLocalAsrAvailable: () => !asrStarted,
    acquireOperatorDouyinMediaToTempFile: async () => {
      for (let n=0;n<50 && !asrStarted;n++) await tick();
      assert.ok(asrStarted, 'fixture starts existing ASR before media capture returns');
      const p = path.join(dir, 'input.mp4'); fs.writeFileSync(p, 'fixture'); return p;
    },
    uploadWorkerMediaForJob: async (_p, job, opts) => { assert.equal(job.phase, 'media'); await opts.beforeComplete(); uploaded = true; return { completion: { mediaReady: true } }; },
    downloadMediaToTempFile: async () => { const p = path.join(dir, 'audio.mp3'); fs.writeFileSync(p, 'fixture'); return p; },
    verifyOperatorControlledMediaFile: async () => {},
    runOperatorLocalTranscription: async (_p, { signal }) => { asrStarted = true; signal.addEventListener('abort', releaseAsr, { once: true }); await asrWait; if (signal.aborted) throw Object.assign(Error('Stopped'), { name: 'AbortError' }); return 'Local fixture.'; },
    runOperatorDoubaoTranscription: async (_url, opts) => { await opts.beforeSubmit('provider-fixture'); providerFinished = true; return { transcription: 'Provider fixture.', providerRequestId: 'provider-fixture' }; },
    clearOperatorDoubaoTask: async () => {},
  };
  const node = createOperatorMediaNode({ plugin, env, setTimer: () => 1, clearTimer() {}, request: async (route, body) => {
    if (route.endsWith('/capacity') || route.endsWith('/heartbeat')) return {};
    if (route.endsWith('/complete')) { completed.push(body); return {}; }
    if (route.endsWith('/claim')) {
      claims.push(body); const kind = body.phases[0] === 'media' ? 'media' : body.backend;
      if (issued.has(kind)) return { jobs: [] }; issued.add(kind);
      return { jobs: [{ jobId: 'job-' + kind, attemptId: 'attempt-fixture', leaseToken: 'lease-fixture', fencingVersion: 1, phase: body.phases[0], backend: body.backend,
        sourceType: 'douyin_url', sourceUrl: 'https://www.douyin.com/video/123456789', controlledMediaUrl: 'https://fixture.invalid/audio.mp3' }] };
    }
    throw Error('Unexpected route');
  } });
  node.start();
  try {
    const polling = node.poll();
    for (let n = 0; n < 50 && !(asrStarted && uploaded && providerFinished); n++) await tick();
    assert.ok(asrStarted && uploaded && providerFinished, 'extraction/upload and provider complete while local ASR remains blocked');
    assert.equal(completed.filter(x => x.backend === 'local_whisper_cpp').length, 0);
    assert.ok(claims.every(x => x.capacitySlots === 3 && x.capabilities.includes('media_handoff')));
    await node.stop(); await polling;
    assert.equal(completed.find(x => x.backend === 'local_whisper_cpp')?.error?.code, 'OPERATOR_NODE_STOPPED', 'shutdown releases the active local lane');
    assert.equal(completed.find(x => x.backend === 'doubao')?.providerRequestId, 'provider-fixture');
  } finally { releaseAsr(); await node.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
  const absentClaims = [];
  const absent = createOperatorMediaNode({ plugin: { settings: {}, uploadWorkerMediaForJob() {}, getLocalAsrInstallStatus: () => ({ ready: false, ffmpegPath: 'fixture' }) }, env, setTimer: () => 1, clearTimer() {}, request: async (route, body) => { if (route.endsWith('/claim')) absentClaims.push(body); return { jobs: [] }; } });
  absent.start(); try { await absent.poll(); assert.deepEqual(absentClaims.map(x => x.phases), [['media']], 'no local component or provider key still permits extraction, but no false ASR claims'); } finally { await absent.stop(); }
  console.log('operator lanes: extraction and provider during local ASR, shutdown release and missing-key capability passed');
}
const watchdog = setTimeout(() => { console.error('Operator lane test did not settle'); process.exit(1); }, 15000);
run().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
