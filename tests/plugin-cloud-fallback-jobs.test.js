'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync');
const helpers = require(path.join(pluginRoot, 'src', 'cloud-fallback-job-utils.js'));
const cloudMediaUpload = require(path.join(pluginRoot, 'src', 'cloud-media-upload.js'));
const operatorNode = require(path.join(pluginRoot, 'src', 'operator-media-node.js'));
const source = fs.readFileSync(path.join(pluginRoot, 'src', 'main.js'), 'utf8');

// Captured from cloudfunctions/syncApi/connection-core.js buildObsidianResponse
// in the paired weekly-cloud-connect backend worktree. Keep this fixture at
// the protocol boundary so the plugin test exercises the server's actual
// credentialType label instead of a client-only mock.
const backendConnectionCoreFixture = Object.freeze({
  version: 'v1',
  purpose: 'obsidian_bind',
  credentialType: 'bind_code',
  bindingToken: 'NEW-456',
  clientId: 'client-test-1',
  deviceLimit: 1,
  clientCount: 1,
  boundAt: '2026-10-18T00:00:00.000Z',
  expiresAt: '',
  idempotent: false,
  ticketExpiresAt: '2026-10-18T00:10:00.000Z',
});

for (const ext of ['.ps1', '.sh', '.py']) {
  require.extensions[ext] = (module, filename) => {
    module.exports = fs.readFileSync(filename, 'utf8');
  };
}
const originalModuleLoad = Module._load;
Module._load = function loadWithObsidianStub(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Plugin: class {},
      PluginSettingTab: class {},
      Modal: class {},
      Notice: class {},
      Setting: class {},
      requestUrl: async () => ({ status: 200, json: { success: true } }),
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const PluginClass = require(path.join(pluginRoot, 'src', 'main.js'));
Module._load = originalModuleLoad;

const normalized = helpers.normalizeCloudFallbackJob({
  id: 'job-1',
  recordId: 'record-1',
  sourceType: 'douyin_url',
  sourceUrl: 'https://www.douyin.com/video/123',
  status: 'queued',
  progress: 12,
  cookie: 'must-not-survive',
  headers: { Cookie: 'must-not-survive' },
});
assert.deepStrictEqual(normalized, {
  jobId: 'job-1',
  recordId: 'record-1',
  sourceType: 'douyin_url',
  bindingFingerprint: '',
  clientId: '',
  sourceFingerprint: '',
  sourceUrl: 'https://www.douyin.com/video/123',
  status: 'queued',
  stage: '',
  progress: 12,
  attemptId: '',
  provider: '',
  providerRequestId: '',
  error: null,
  clientRequestId: '',
  createdAt: '',
  updatedAt: '',
  completedAt: '',
  retryCount: 0,
  retryable: false,
});
assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized, 'cookie'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized, 'headers'), false);

assert.strictEqual(helpers.isCloudFallbackPendingStatus('transcribing'), true);
assert.strictEqual(helpers.isCloudFallbackTerminalStatus('succeeded'), true);
assert.strictEqual(helpers.isCloudFallbackPendingStatus('succeeded'), false);
assert.strictEqual(helpers.isCloudFallbackJobTerminal({ status: 'failed', retryable: true }), false);
assert.strictEqual(helpers.isCloudFallbackJobPending({ status: 'failed', retryable: true }), true);
assert.strictEqual(helpers.isControlledCloudFallbackFileId('cloud://file-1'), true);
assert.strictEqual(helpers.isControlledCloudFallbackFileId('cloud-file-1'), true);
assert.strictEqual(helpers.isCloudFallbackTerminalStatus('acknowledged'), true);
assert.strictEqual(helpers.normalizeCloudFallbackAck({ jobId: 'job-1' }), null, 'an ack must be scoped to a binding and client');
assert.deepStrictEqual(
  helpers.normalizeCloudFallbackAck({
    jobId: ' job-1 ', bindingFingerprint: 'fp', clientId: 'device-1',
    recordId: 'record-1', queuedAt: '2026-10-18T00:00:00.000Z', attempts: 2,
  }),
  {
    jobId: 'job-1',
    bindingFingerprint: 'fp',
    clientId: 'device-1',
    recordId: 'record-1',
    queuedAt: '2026-10-18T00:00:00.000Z',
    attempts: 2,
  },
);
assert.strictEqual(
  helpers.normalizeCloudFallbackAcks([
    { jobId: 'job-1', bindingFingerprint: 'fp', clientId: 'device-1' },
    { jobId: 'job-1', bindingFingerprint: 'fp', clientId: 'device-1' },
  ]).length,
  1,
  'duplicate acknowledgements must collapse to one retry entry',
);

const jobs = helpers.normalizeCloudFallbackJobs([
  normalized,
  { ...normalized, status: 'succeeded', transcription: '结果' },
  { jobId: 'bad', sourceType: 'unknown', status: 'queued' },
]);
assert.strictEqual(jobs.length, 1, 'duplicate and invalid jobs should be dropped');
assert.strictEqual(jobs[0].status, 'queued');
const sameJobDifferentOwners = helpers.normalizeCloudFallbackJobs([
  { ...normalized, bindingFingerprint: 'binding-a', clientId: 'client-a', sourceFingerprint: 'source-a' },
  { ...normalized, bindingFingerprint: 'binding-b', clientId: 'client-b', sourceFingerprint: 'source-b' },
]);
assert.strictEqual(sameJobDifferentOwners.length, 2, 'same server job IDs must remain scoped by owner/client/source');
const pendingOverflow = helpers.normalizeCloudFallbackJobs(Array.from({ length: 101 }, (_, index) => ({
  ...normalized,
  jobId: `pending-${index}`,
  recordId: `record-pending-${index}`,
  status: 'queued',
})));
assert.strictEqual(pendingOverflow.length, 101, 'pending jobs must survive terminal-history trimming');

assert.match(source, /\/transcriptions\/fallback\/jobs/);
assert.match(source, /\/transcriptions\/fallback\/jobs\/\$\{encodeURIComponent\(normalizedJobId\)\}/);
assert.match(source, /sourceType:\s*['"]douyin_url['"]/);
assert.match(source, /sourceType:\s*['"]uploaded_file['"]/);
assert.match(source, /cloudFallbackJobs/);
assert.match(source, /cloudFallbackEnabled:\s*true/);
assert.match(source, /delete requestBody\.cookie/);
assert.match(source, /delete requestBody\.cookies/);
assert.match(source, /CLOUD_FALLBACK_QUEUED/);
assert.match(source, /cloud-fallback-processing/);
assert.match(source, /cloud-fallback-terminal/);
assert.match(source, /cloudFallbackRetryCount/);
assert.match(source, /CLOUD_FALLBACK_RETRY_REQUIRED/);
assert.match(source, /transcriptionStatus = 'no_speech'/);

function makePlugin({ jobs = [], bindingToken = 'ABC-123' } = {}) {
  let savedSnapshot = null;
  const plugin = Object.create(PluginClass.prototype);
  plugin.settings = {
    apiBase: 'https://sync.example.test/sync',
    clientId: 'client-test-1',
    token: bindingToken,
    pendingBindCode: 'LEGACY-PENDING',
    pendingConnectionTicket: '',
    cloudFallbackEnabled: true,
    cloudFallbackJobs: jobs,
    bindings: [{ token: bindingToken, label: '微信 1', enabled: true, status: 'bound' }],
  };
  plugin.manifest = { version: '1.3.0' };
  plugin.getActiveBindings = () => plugin.settings.bindings;
  plugin.saveData = async (value) => { savedSnapshot = JSON.parse(JSON.stringify(value)); };
  plugin.saveSettings = async (value) => { plugin.settings = { ...value }; };
  plugin.showSyncProgress = () => {};
  plugin.refreshProAndMaybePromptLocalComponentInstall = async () => {};
  plugin.autoSyncController = null;
  // The cloud fallback gate only lets a fully set-up Pro user reach the paid
  // path. Default the fixture to that state; individual tests opt out.
  plugin.getProFeatureAccessStatus = async () => ({
    hasAccess: true,
    status: 'active',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  plugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: true,
    asrStatus: { ready: true },
    ocrStatus: { ready: true },
    resolverStatus: { ready: true },
  });
  plugin.checkDouyinLogin = async () => true;
  plugin.__getSavedSnapshot = () => savedSnapshot;
  return plugin;
}

(async () => {
  const connectionPlugin = makePlugin();
  let connectionRequest = null;
  connectionPlugin.requestUnauthenticatedJson = async (requestPath, method, body) => {
    connectionRequest = { requestPath, method, body };
    return {
      success: true,
      data: {
        ...backendConnectionCoreFixture,
      },
    };
  };
  const connected = await connectionPlugin.connectWithConnectionTicket('cnt-abcd-efgh-jklm');
  assert.strictEqual(connected.token, 'NEW-456');
  assert.strictEqual(connectionRequest.requestPath, '/connection/consume');
  assert.strictEqual(connectionRequest.method, 'POST');
  assert.strictEqual(connectionRequest.body.ticket, 'CNT-ABCD-EFGH-JKLM');
  assert.strictEqual(connectionRequest.body.purpose, 'obsidian_bind');
  assert.strictEqual(connectionRequest.body.clientId, 'client-test-1');
  assert.strictEqual(connectionPlugin.settings.pendingBindCode, 'LEGACY-PENDING');
  assert.strictEqual(connectionPlugin.settings.bindings.some((item) => item.token === 'NEW-456'), true);

  const oldBindPlugin = makePlugin({ bindingToken: '' });
  oldBindPlugin.settings.bindings = [];
  oldBindPlugin.settings.token = '';
  let detectedTicket = '';
  oldBindPlugin.connectWithConnectionTicket = async (ticket) => { detectedTicket = ticket; return null; };
  await oldBindPlugin.bindCurrentCode.call({
    ...oldBindPlugin,
    settings: { ...oldBindPlugin.settings, pendingBindCode: 'CNT-ABCD-EFGH-JKLM' },
    connectWithConnectionTicket: oldBindPlugin.connectWithConnectionTicket,
  });
  assert.strictEqual(detectedTicket, 'CNT-ABCD-EFGH-JKLM');

  const submitPlugin = makePlugin();
  let postBody = null;
  submitPlugin.requestJson = async (requestPath, method, body) => {
    assert.strictEqual(requestPath, '/transcriptions/fallback/jobs');
    assert.strictEqual(method, 'POST');
    postBody = body;
    return {
      success: true,
      data: {
        jobId: 'job-file-1',
        recordId: 'record-file-1',
        sourceType: 'uploaded_file',
        status: 'queued',
        retryable: false,
      },
    };
  };
  const submitted = await submitPlugin.submitCloudFallbackJob({
    sourceType: 'uploaded_file',
    fileID: 'cloud://bucket/audio-1',
    recordId: 'record-file-1',
    title: '录音',
    binding: submitPlugin.settings.bindings[0],
  });
  assert.strictEqual(submitted.jobId, 'job-file-1');
  assert.strictEqual(postBody.fileID, 'cloud://bucket/audio-1');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(postBody, 'audioUrl'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(postBody, 'cookies'), false);
  assert.strictEqual(submitPlugin.settings.cloudFallbackJobs[0].bindingFingerprint.length, 32);
  assert.strictEqual(submitPlugin.settings.cloudFallbackJobs[0].clientId, 'client-test-1');

  const racedSubmitPlugin = makePlugin();
  const racedAbortController = new AbortController();
  const racedRequests = [];
  racedSubmitPlugin.requestJson = async (requestPath, method) => {
    racedRequests.push({ requestPath, method });
    if (method === 'POST' && requestPath === '/transcriptions/fallback/jobs') {
      racedAbortController.abort();
      return {
        success: true,
        data: {
          jobId: 'job-raced-1',
          recordId: 'record-raced-1',
          sourceType: 'uploaded_file',
          fileID: 'cloud://bucket/raced.m4a',
          status: 'queued',
        },
      };
    }
    assert.match(requestPath, /\/cancel$/);
    return { success: true, data: { jobId: 'job-raced-1', sourceType: 'uploaded_file', status: 'cancelled' } };
  };
  await assert.rejects(
    racedSubmitPlugin.submitCloudFallbackJob({
      sourceType: 'uploaded_file',
      fileID: 'cloud://bucket/raced.m4a',
      recordId: 'record-raced-1',
      binding: racedSubmitPlugin.settings.bindings[0],
      signal: racedAbortController.signal,
    }),
    error => error && error.name === 'AbortError',
  );
  assert.ok(racedRequests.some((item) => item.requestPath === '/transcriptions/fallback/jobs/job-raced-1/cancel' && item.method === 'POST'));
  assert.strictEqual(racedSubmitPlugin.settings.cloudFallbackJobs.find((job) => job.jobId === 'job-raced-1').status, 'cancelled');

  const stopPlugin = makePlugin({
    jobs: [{
      jobId: 'job-stop-1',
      recordId: 'record-stop-1',
      sourceType: 'douyin_url',
      sourceUrl: 'https://www.douyin.com/video/stop-1',
      status: 'queued',
      bindingFingerprint: racedSubmitPlugin.settings.cloudFallbackJobs[0].bindingFingerprint,
      clientId: 'client-test-1',
      recordRetryCount: 0,
    }],
  });
  let stopCancel = null;
  stopPlugin.cancelCloudFallbackJob = async (jobId, binding) => {
    stopCancel = { jobId, token: binding && binding.token };
    return { jobId, status: 'cancelled' };
  };
  stopPlugin.rememberAutoSyncStoppedRecord = async () => {};
  stopPlugin.deleteCurrentTranscriptionRecord = async () => ({ deleted: true, response: {} });
  stopPlugin.currentTranscriptionAbortController = { abort: () => {} };
  stopPlugin.currentTranscriptionContext = {
    recordId: 'record-stop-1',
    binding: stopPlugin.settings.bindings[0],
    cloudFallbackJobId: 'job-stop-1',
  };
  const stopped = await stopPlugin.stopCurrentTranscription();
  assert.strictEqual(stopped, true);
  assert.deepStrictEqual(stopCancel, { jobId: 'job-stop-1', token: 'ABC-123' });

  const abortedPlugin = makePlugin();
  abortedPlugin.settings.aiProvider = 'local';
  let abortSubmitted = false;
  abortedPlugin.runLocalTranscription = async () => {
    const error = new Error('用户已停止');
    error.name = 'AbortError';
    throw error;
  };
  abortedPlugin.submitCloudFallbackJob = async () => {
    abortSubmitted = true;
    throw new Error('abort must not submit cloud work');
  };
  await assert.rejects(
    abortedPlugin.runConfiguredTranscription('https://cdn.example.test/audio.mp3', {
      fileID: 'cloud://bucket/audio-1',
      binding: abortedPlugin.settings.bindings[0],
    }),
    /已停止/,
  );
  assert.strictEqual(abortSubmitted, false, 'cancelling local ASR must not submit a fallback job');

  const noSpeechPlugin = makePlugin();
  let noSpeechSubmitted = false;
  noSpeechPlugin.runLocalTranscription = async () => {
    throw Object.assign(new Error('未检测到语音'), { code: 'TRANSCRIPTION_NO_SPEECH' });
  };
  noSpeechPlugin.submitCloudFallbackJob = async () => {
    noSpeechSubmitted = true;
    throw new Error('no-speech must not submit cloud work');
  };
  await assert.rejects(
    noSpeechPlugin.runConfiguredTranscription('https://cdn.example.test/audio.mp3', {
      fileID: 'cloud://bucket/audio-1',
      binding: noSpeechPlugin.settings.bindings[0],
    }),
    error => error && error.code === 'TRANSCRIPTION_NO_SPEECH',
  );
  assert.strictEqual(noSpeechSubmitted, false, 'no-speech must not submit paid fallback work');

  const douyinCandidatePlugin = makePlugin();
  const douyinUrl = 'https://www.douyin.com/video/1234567890';
  let douyinFallbackBody = null;
  douyinCandidatePlugin.runConfiguredTranscription = async () => {
    throw Object.assign(new Error('媒体下载失败：HTTP 403'), { status: 403 });
  };
  douyinCandidatePlugin.submitCloudFallbackJob = async (options) => {
    douyinFallbackBody = options;
    return {
      jobId: 'job-douyin-url-1',
      recordId: 'record-douyin-1',
      sourceType: 'douyin_url',
      sourceUrl: douyinUrl,
      status: 'queued',
      retryable: false,
    };
  };
  await assert.rejects(
    douyinCandidatePlugin.buildTranscriptRecordFromMedia({
      id: 'record-douyin-1',
      type: 'webpage',
      content: douyinUrl,
      metadata: { title: '抖音失败样本', url: douyinUrl },
    }, {
      url: douyinUrl,
      platform: '抖音',
      mediaUrl: 'https://cdn.example.test/expired.mp4',
      preparedMedia: true,
      binding: douyinCandidatePlugin.settings.bindings[0],
      title: '抖音失败样本',
    }),
    error => error && error.code === 'CLOUD_FALLBACK_QUEUED',
  );
  assert.strictEqual(douyinFallbackBody.sourceType, 'douyin_url');
  assert.strictEqual(douyinFallbackBody.sourceUrl, douyinUrl);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(douyinFallbackBody, 'fileID'), false);

  const cancelledCandidatePlugin = makePlugin();
  let cancelledCandidateSubmitted = false;
  cancelledCandidatePlugin.runConfiguredTranscription = async () => {
    throw Object.assign(new Error('用户已停止当前转写'), { name: 'AbortError' });
  };
  cancelledCandidatePlugin.submitCloudFallbackJob = async () => {
    cancelledCandidateSubmitted = true;
    throw new Error('用户取消不应提交云端任务');
  };
  await assert.rejects(
    cancelledCandidatePlugin.buildTranscriptRecordFromMedia({
      id: 'record-douyin-cancelled',
      type: 'webpage',
      content: douyinUrl,
      metadata: { url: douyinUrl },
    }, {
      url: douyinUrl,
      platform: '抖音',
      mediaUrl: 'https://cdn.example.test/video.mp4',
      preparedMedia: true,
      binding: cancelledCandidatePlugin.settings.bindings[0],
    }),
    error => error && error.name === 'AbortError',
  );
  assert.strictEqual(cancelledCandidateSubmitted, false);

  // Cloud fallback is only for platform-side failures. Missing Pro, a missing
  // local component, or a missing Douyin login must stop locally with guidance
  // instead of submitting paid cloud work.
  const membershipDeniedPlugin = makePlugin();
  membershipDeniedPlugin.getProFeatureAccessStatus = async () => ({ hasAccess: false, status: 'expired', expiresAt: '' });
  const membershipGate = await membershipDeniedPlugin.evaluateCloudFallbackUserGate({
    binding: membershipDeniedPlugin.settings.bindings[0],
  });
  assert.strictEqual(membershipGate.allowed, false);
  assert.strictEqual(membershipGate.code, 'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED');
  assert.match(membershipGate.message, /开通|续费/);

  const componentDeniedPlugin = makePlugin();
  componentDeniedPlugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: false,
    asrStatus: { ready: false },
    ocrStatus: { ready: true },
    resolverStatus: { ready: true },
  });
  const componentGate = await componentDeniedPlugin.evaluateCloudFallbackUserGate({
    binding: componentDeniedPlugin.settings.bindings[0],
  });
  assert.strictEqual(componentGate.allowed, false);
  assert.strictEqual(componentGate.code, 'LOCAL_COMPONENT_SETUP_REQUIRED');

  const resolverDeniedPlugin = makePlugin();
  resolverDeniedPlugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: false,
    asrStatus: { ready: true },
    ocrStatus: { ready: true },
    resolverStatus: { ready: false },
  });
  const resolverGate = await resolverDeniedPlugin.evaluateCloudFallbackUserGate({
    binding: resolverDeniedPlugin.settings.bindings[0],
    requireDouyinResolver: true,
  });
  assert.strictEqual(resolverGate.allowed, false);
  assert.strictEqual(resolverGate.code, 'DOUYIN_RESOLVER_NOT_INSTALLED');

  const loginDeniedPlugin = makePlugin();
  loginDeniedPlugin.checkDouyinLogin = async () => false;
  const loginGate = await loginDeniedPlugin.evaluateCloudFallbackUserGate({
    binding: loginDeniedPlugin.settings.bindings[0],
    requireDouyinLogin: true,
  });
  assert.strictEqual(loginGate.allowed, false);
  assert.strictEqual(loginGate.code, 'DOUYIN_LOGIN_REQUIRED');

  const allowedGatePlugin = makePlugin();
  const allowedGate = await allowedGatePlugin.evaluateCloudFallbackUserGate({
    binding: allowedGatePlugin.settings.bindings[0],
    requireDouyinLogin: true,
    requireDouyinResolver: true,
  });
  assert.strictEqual(allowedGate.allowed, true);

  // A setup failure that surfaces after candidate transcription must not be
  // re-submitted as a cloud job by the outer catch.
  const setupErrorPlugin = makePlugin();
  let setupErrorSubmitted = false;
  setupErrorPlugin.runConfiguredTranscription = async () => {
    throw Object.assign(new Error('待安装组件：音视频转写需要先安装本地转写组件。'), {
      code: 'LOCAL_COMPONENT_SETUP_REQUIRED',
      transcriptionSetupRequired: true,
    });
  };
  setupErrorPlugin.submitCloudFallbackJob = async () => {
    setupErrorSubmitted = true;
    throw new Error('setup errors must not submit cloud work');
  };
  await assert.rejects(
    setupErrorPlugin.buildTranscriptRecordFromMedia({
      id: 'record-douyin-setup',
      type: 'webpage',
      content: douyinUrl,
      metadata: { url: douyinUrl },
    }, {
      url: douyinUrl,
      platform: '抖音',
      mediaUrl: 'https://cdn.example.test/video.mp4',
      preparedMedia: true,
      binding: setupErrorPlugin.settings.bindings[0],
    }),
    error => error && error.code === 'LOCAL_COMPONENT_SETUP_REQUIRED',
  );
  assert.strictEqual(setupErrorSubmitted, false);

  const pollPlugin = makePlugin({ jobs: submitPlugin.settings.cloudFallbackJobs });
  let pollCount = 0;
  pollPlugin.requestJson = async (requestPath, method) => {
    assert.strictEqual(method, 'GET');
    assert.match(requestPath, /job-file-1$/);
    pollCount += 1;
    return {
      success: true,
      data: {
        jobId: 'job-file-1',
        recordId: 'record-file-1',
        sourceType: 'uploaded_file',
        status: 'succeeded',
        transcription: '云端结果',
        updatedAt: '2026-10-18T00:01:00.000Z',
      },
    };
  };
  const polled = await pollPlugin.pollCloudFallbackJobs(pollPlugin.settings.bindings[0], [{
    id: 'record-file-1',
    type: 'file',
    metadata: { fileID: 'cloud://bucket/audio-1' },
  }]);
  assert.strictEqual(pollCount, 1);
  assert.strictEqual(polled.records[0].metadata.transcription, '云端结果');
  assert.strictEqual(polled.records[0].metadata.transcriptionStatus, 'success');

  const retryPlugin = makePlugin({ jobs: [{
    ...submitPlugin.settings.cloudFallbackJobs[0],
    jobId: 'job-retry-1',
    status: 'failed',
    retryable: true,
  }] });
  let retryPolled = false;
  retryPlugin.requestJson = async () => {
    retryPolled = true;
    return { success: true, data: { jobId: 'job-retry-1', recordId: 'record-file-1', sourceType: 'uploaded_file', status: 'queued', retryable: false } };
  };
  await retryPlugin.pollCloudFallbackJobs(retryPlugin.settings.bindings[0], []);
  assert.strictEqual(retryPolled, true);

  // The local note is already written, so the client asks the server to drop
  // its stored transcription and media. The intent is persisted first and the
  // scoped job is forgotten only after the server confirms.
  const ackFingerprint = require('crypto').createHash('sha256').update('ABC-123', 'utf8').digest('hex').slice(0, 32);
  const ackJobFixture = {
    jobId: 'job-ack-1',
    recordId: 'record-ack-1',
    sourceType: 'douyin_url',
    sourceUrl: 'https://www.douyin.com/video/ack-1',
    status: 'succeeded',
    bindingFingerprint: ackFingerprint,
    clientId: 'client-test-1',
  };
  const ackPlugin = makePlugin({ jobs: [ackJobFixture] });
  let ackRequest = null;
  ackPlugin.requestJson = async (requestPath, method, body) => {
    ackRequest = { requestPath, method, body };
    return { success: true, data: { jobId: 'job-ack-1', status: 'acknowledged' } };
  };
  const acknowledged = await ackPlugin.acknowledgeCloudFallbackJob('job-ack-1', ackPlugin.settings.bindings[0]);
  assert.strictEqual(ackRequest.requestPath, '/transcriptions/fallback/jobs/job-ack-1/ack');
  assert.strictEqual(ackRequest.method, 'POST');
  assert.deepStrictEqual(ackRequest.body, {});
  assert.strictEqual(acknowledged.status, 'acknowledged');
  assert.strictEqual(ackPlugin.settings.cloudFallbackPendingAcks.length, 0);
  assert.strictEqual(ackPlugin.settings.cloudFallbackJobs.some((job) => job.jobId === 'job-ack-1'), false);

  const ackRetryPlugin = makePlugin({ jobs: [{ ...ackJobFixture, jobId: 'job-ack-retry' }] });
  let ackAttempts = 0;
  ackRetryPlugin.requestJson = async () => {
    ackAttempts += 1;
    throw Object.assign(new Error('offline'), { status: 503, statusCode: 503 });
  };
  assert.strictEqual(
    await ackRetryPlugin.acknowledgeCloudFallbackJob('job-ack-retry', ackRetryPlugin.settings.bindings[0]),
    null,
  );
  assert.strictEqual(ackAttempts, 1);
  assert.strictEqual(ackRetryPlugin.settings.cloudFallbackPendingAcks.length, 1, 'a failed ack must stay queued');
  assert.strictEqual(ackRetryPlugin.settings.cloudFallbackPendingAcks[0].jobId, 'job-ack-retry');
  assert.strictEqual(ackRetryPlugin.settings.cloudFallbackPendingAcks[0].attempts, 1);
  assert.strictEqual(ackRetryPlugin.settings.cloudFallbackJobs.some((job) => job.jobId === 'job-ack-retry'), true);
  let ackFlushCalls = 0;
  ackRetryPlugin.requestJson = async (requestPath) => {
    ackFlushCalls += 1;
    assert.match(requestPath, /job-ack-retry\/ack$/);
    return { success: true, data: { jobId: 'job-ack-retry', status: 'acknowledged' } };
  };
  const flushed = await ackRetryPlugin.flushCloudFallbackAcks(ackRetryPlugin.settings.bindings[0]);
  assert.strictEqual(flushed.acknowledged, 1);
  assert.strictEqual(ackFlushCalls, 1);
  assert.strictEqual(ackRetryPlugin.settings.cloudFallbackPendingAcks.length, 0);
  assert.strictEqual(ackRetryPlugin.settings.cloudFallbackJobs.some((job) => job.jobId === 'job-ack-retry'), false);

  const ackGonePlugin = makePlugin({ jobs: [{ ...ackJobFixture, jobId: 'job-ack-gone' }] });
  ackGonePlugin.requestJson = async () => {
    throw Object.assign(new Error('job not found'), { status: 404, statusCode: 404 });
  };
  assert.strictEqual(
    await ackGonePlugin.acknowledgeCloudFallbackJob('job-ack-gone', ackGonePlugin.settings.bindings[0]),
    null,
  );
  assert.strictEqual(ackGonePlugin.settings.cloudFallbackPendingAcks.length, 0, 'a missing server job needs no retry');
  assert.strictEqual(ackGonePlugin.settings.cloudFallbackJobs.some((job) => job.jobId === 'job-ack-gone'), false);
  assert.strictEqual(
    await ackPlugin.acknowledgeCloudFallbackJobForRecord({ metadata: {} }, ackPlugin.settings.bindings[0]),
    null,
    'records that never used cloud fallback must not send an ack',
  );

  const cancelPlugin = makePlugin({ jobs: submitPlugin.settings.cloudFallbackJobs });
  cancelPlugin.requestJson = async (requestPath, method) => {
    assert.strictEqual(method, 'POST');
    assert.match(requestPath, /\/cancel$/);
    return { success: true, data: { jobId: 'job-file-1', sourceType: 'uploaded_file', status: 'cancelled' } };
  };
  const cancelled = await cancelPlugin.cancelCloudFallbackJob('job-file-1', cancelPlugin.settings.bindings[0]);
  assert.strictEqual(cancelled.status, 'cancelled');
  assert.strictEqual(cancelPlugin.settings.cloudFallbackJobs.some((job) => job.jobId === 'job-file-1'), true);
  assert.strictEqual(cancelPlugin.settings.cloudFallbackJobs.find((job) => job.jobId === 'job-file-1').status, 'cancelled');

  const retryGuardPlugin = makePlugin({ jobs: cancelPlugin.settings.cloudFallbackJobs });
  let retryGuardRequestCount = 0;
  retryGuardPlugin.requestJson = async () => {
    retryGuardRequestCount += 1;
    return { success: true, data: { jobId: 'unexpected-reuse', sourceType: 'uploaded_file', status: 'queued' } };
  };
  await assert.rejects(
    retryGuardPlugin.submitCloudFallbackJob({
      sourceType: 'uploaded_file',
      fileID: 'cloud://bucket/audio-1',
      recordId: 'record-file-1',
      binding: retryGuardPlugin.settings.bindings[0],
    }),
    error => error && error.code === 'CLOUD_FALLBACK_RETRY_REQUIRED',
  );
  assert.strictEqual(retryGuardRequestCount, 0, 'a cancelled job must not be silently reused');

  const generationPlugin = makePlugin();
  const generationRecordId = 'record-generation-submit';
  const generationFileID = 'cloud://bucket/generation.m4a';
  generationPlugin.settings.cloudFallbackJobs = [{
    jobId: 'job-generation-old',
    recordId: generationRecordId,
    sourceType: 'uploaded_file',
    fileID: generationFileID,
    bindingFingerprint: submitPlugin.settings.cloudFallbackJobs[0].bindingFingerprint,
    clientId: 'client-test-1',
    sourceFingerprint: generationPlugin.buildCloudFallbackSourceFingerprint({
      sourceType: 'uploaded_file',
      fileID: generationFileID,
      recordId: generationRecordId,
    }),
    status: 'cancelled',
    // This is a historical job written before request generations were
    // persisted. A new mini-program retry must be allowed to submit again.
  }];
  let generationSubmitCount = 0;
  generationPlugin.requestJson = async (requestPath, method) => {
    assert.strictEqual(requestPath, '/transcriptions/fallback/jobs');
    assert.strictEqual(method, 'POST');
    generationSubmitCount += 1;
    return {
      success: true,
      data: {
        jobId: 'job-generation-new',
        recordId: generationRecordId,
        sourceType: 'uploaded_file',
        fileID: generationFileID,
        status: 'queued',
      },
    };
  };
  const generationJob = await generationPlugin.submitCloudFallbackJob({
    sourceType: 'uploaded_file',
    fileID: generationFileID,
    recordId: generationRecordId,
    retryCount: 1,
    binding: generationPlugin.settings.bindings[0],
  });
  assert.strictEqual(generationSubmitCount, 1, 'a historical cancelled job must not block a new record retry');
  assert.strictEqual(generationJob.recordRetryCount, 1);
  assert.strictEqual(generationPlugin.settings.cloudFallbackJobs.find((job) => job.jobId === 'job-generation-new').recordRetryCount, 1);

  const generationPollPlugin = makePlugin();
  const generationPollRecordId = 'record-generation-poll';
  const generationPollFileID = 'cloud://bucket/generation-poll.m4a';
  const generationPollSourceFingerprint = generationPollPlugin.buildCloudFallbackSourceFingerprint({
    sourceType: 'uploaded_file',
    fileID: generationPollFileID,
    recordId: generationPollRecordId,
  });
  generationPollPlugin.settings.cloudFallbackJobs = [{
    jobId: 'job-generation-old-success',
    recordId: generationPollRecordId,
    sourceType: 'uploaded_file',
    fileID: generationPollFileID,
    bindingFingerprint: submitPlugin.settings.cloudFallbackJobs[0].bindingFingerprint,
    clientId: 'client-test-1',
    sourceFingerprint: generationPollSourceFingerprint,
    status: 'succeeded',
    transcription: '旧代结果',
    updatedAt: '2030-01-01T00:00:00.000Z',
  }, {
    jobId: 'job-generation-current',
    recordId: generationPollRecordId,
    sourceType: 'uploaded_file',
    fileID: generationPollFileID,
    bindingFingerprint: submitPlugin.settings.cloudFallbackJobs[0].bindingFingerprint,
    clientId: 'client-test-1',
    sourceFingerprint: generationPollSourceFingerprint,
    status: 'failed',
    retryable: true,
    retryCount: 3,
    recordRetryCount: 1,
    updatedAt: '2026-10-18T00:01:00.000Z',
  }];
  let generationPollCount = 0;
  generationPollPlugin.requestJson = async (requestPath, method) => {
    assert.strictEqual(method, 'GET');
    assert.match(requestPath, /job-generation-current$/);
    generationPollCount += 1;
    return {
      success: true,
      data: {
        jobId: 'job-generation-current',
        recordId: generationPollRecordId,
        sourceType: 'uploaded_file',
        fileID: generationPollFileID,
        status: 'succeeded',
        transcription: '当前代结果',
        retryCount: 3,
        updatedAt: '2026-10-18T00:02:00.000Z',
      },
    };
  };
  const generationPollResult = await generationPollPlugin.pollCloudFallbackJobs(
    generationPollPlugin.settings.bindings[0],
    [{ id: generationPollRecordId, retryCount: 1, metadata: {} }],
  );
  assert.strictEqual(generationPollCount, 1, 'worker retries should poll only the current record generation');
  assert.strictEqual(generationPollResult.records[0].metadata.transcription, '当前代结果');
  assert.strictEqual(generationPollResult.records[0].metadata.cloudFallbackRecordRetryCount, 1);
  assert.strictEqual(generationPollResult.records[0].metadata.cloudFallbackRetryCount, 1);
  assert.strictEqual(generationPollResult.records[0].metadata.cloudFallbackWorkerRetryCount, 3);

  const flowPlugin = makePlugin();
  flowPlugin.settings.pendingSyncLifecycleAttempts = [];
  flowPlugin.settings.completedSyncReceipts = [];
  flowPlugin.settings.locallyQuarantinedRecordIds = [];
  flowPlugin.settings.autoSyncStoppedRecords = [];
  flowPlugin.autoSyncDisposed = false;
  flowPlugin.backgroundSyncActive = false;
  flowPlugin.ensureSerializedSaveData = () => {};
  flowPlugin.setTranscriptionStopAvailable = () => {};
  flowPlugin.showSyncProgress = () => {};
  flowPlugin.getAutoSyncBindings = () => flowPlugin.settings.bindings;
  flowPlugin.getSyncDiagnosticReporter = () => ({ clearRecord: async () => {} });
  flowPlugin.rememberCompletedSyncReceiptBestEffort = async () => null;
  flowPlugin.findQualityPartialNote = async () => null;
  flowPlugin.findExistingRecordNotePath = async () => '';
  let flowFetchCount = 0;
  let flowClaimCount = 0;
  let flowWriteCount = 0;
  let flowCompletionLifecycle = null;
  const flowRecord = {
    id: 'record-flow-1',
    type: 'webpage',
    content: 'https://www.douyin.com/video/flow-1',
    createdAt: '2026-10-18T00:00:00.000Z',
    metadata: {
      title: '云端兜底流程样本',
      url: 'https://www.douyin.com/video/flow-1',
    },
  };
  const activeLease = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  flowPlugin.getRecentSyncFailures = () => flowWriteCount > 0
    ? [{ recordId: 'record-flow-1', bindingToken: 'ABC-123', retryCount: 0 }]
    : [];
  flowPlugin.claimSyncRecordProcessing = async () => {
    flowClaimCount += 1;
    return { enabled: true, attemptId: 'attempt-flow-1', leaseUntil: activeLease };
  };
  flowPlugin.writeRecord = async (record) => {
    flowWriteCount += 1;
    if (flowWriteCount === 1) {
      throw Object.assign(new Error('云端任务已提交'), {
        code: 'CLOUD_FALLBACK_QUEUED',
        cloudFallbackJob: {
          jobId: 'job-flow-1',
          recordId: 'record-flow-1',
          sourceType: 'douyin_url',
          sourceUrl: flowRecord.content,
          status: 'queued',
          retryable: false,
        },
      });
    }
    assert.strictEqual(record.metadata.transcription, '云端流程结果');
    return { recordId: 'record-flow-1', title: '云端兜底流程样本', committed: true };
  };
  flowPlugin.requestJson = async (requestPath, method) => {
    if (requestPath === '/records?status=pending' && method === 'GET') {
      flowFetchCount += 1;
      return {
        success: true,
        data: flowFetchCount === 1 ? [flowRecord] : [],
        meta: { syncLifecycleStatus: true },
      };
    }
    if (requestPath === '/transcriptions/fallback/jobs/job-flow-1' && method === 'GET') {
      return {
        success: true,
        data: {
          jobId: 'job-flow-1',
          recordId: 'record-flow-1',
          sourceType: 'douyin_url',
          sourceUrl: flowRecord.content,
          status: 'succeeded',
          transcription: '云端流程结果',
          updatedAt: new Date().toISOString(),
        },
      };
    }
    if (requestPath === '/records/record-flow-1/synced' && method === 'POST') {
      return { success: true, data: { status: 'deleted' } };
    }
    throw new Error(`unexpected flow request ${method} ${requestPath}`);
  };
  flowPlugin.reportSyncRecordCompletion = async (_recordId, _title, _binding, lifecycle) => {
    flowCompletionLifecycle = lifecycle;
    return { success: true, data: { status: 'deleted' } };
  };
  const firstFlow = await flowPlugin.syncBinding(flowPlugin.settings.bindings[0], false);
  assert.ok(firstFlow.skipped.some((item) => item.reason === 'cloud-fallback-processing'));
  assert.strictEqual(firstFlow.cloudFallbackPending, 1, 'a waiting cloud job must count as sync activity');
  assert.strictEqual(flowPlugin.settings.pendingSyncLifecycleAttempts[0].stage, 'cloud-fallback');
  assert.strictEqual(flowPlugin.settings.cloudFallbackJobs[0].recordSnapshot.id, 'record-flow-1');
  assert.strictEqual(flowPlugin.settings.cloudFallbackJobs[0].syncAttemptId, 'attempt-flow-1');
  const secondFlow = await flowPlugin.syncBinding(flowPlugin.settings.bindings[0], false);
  assert.strictEqual(flowClaimCount, 1, 'completed fallback must reuse the active claim instead of being blocked or reclaimed');
  assert.strictEqual(flowWriteCount, 2);
  assert.strictEqual(secondFlow.written.length, 1);
  assert.strictEqual(flowCompletionLifecycle.attemptId, 'attempt-flow-1');
  assert.strictEqual(flowPlugin.settings.pendingSyncLifecycleAttempts.length, 0);

  const mediaTempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wechat-inbox-cloud-media-test-'));
  const mediaPath = path.join(mediaTempRoot, 'sample.m4a');
  const mediaBytes = Buffer.from('controlled-media-fixture');
  await fs.promises.writeFile(mediaPath, mediaBytes);
  const mediaDigest = await cloudMediaUpload.hashFileSha256(mediaPath);
  assert.strictEqual(mediaDigest.size, mediaBytes.length);
  assert.strictEqual(mediaDigest.sha256, require('crypto').createHash('sha256').update(mediaBytes).digest('hex'));
  let uploadedRequest = null;
  const uploadServer = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      uploadedRequest = {
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks),
      };
      response.statusCode = 200;
      response.end('ok');
    });
  });
  await new Promise((resolve) => uploadServer.listen(0, '127.0.0.1', resolve));
  const uploadAddress = uploadServer.address();
  await cloudMediaUpload.uploadMultipartFile(
    `http://127.0.0.1:${uploadAddress.port}/signed-upload?signature=test-only`,
    {},
    mediaPath,
    { method: 'PUT', headers: { Signature: 'test-signature' }, contentType: 'audio/mpeg' },
  );
  await new Promise((resolve) => uploadServer.close(resolve));
  assert.strictEqual(uploadedRequest.method, 'PUT');
  assert.deepStrictEqual(uploadedRequest.body, mediaBytes, 'signed upload must send raw bytes, not a multipart wrapper');
  assert.strictEqual(uploadedRequest.headers.signature, 'test-signature');

  const uploadFlowPlugin = makePlugin();
  uploadFlowPlugin.settings.aiProvider = 'local';
  uploadFlowPlugin.settings.cloudFallbackSubmissions = [];
  let retainedPathSeen = '';
  let uploadedFileSeen = null;
  uploadFlowPlugin.runLocalTranscription = async (_audioUrl, options) => {
    await options.onInputPathReady(mediaPath);
    throw new Error('本地 ASR 失败');
  };
  uploadFlowPlugin.uploadLocalMediaForCloudFallback = async (filePath) => {
    retainedPathSeen = filePath;
    assert.strictEqual(fs.existsSync(filePath), true, 'failed local ASR must retain media until upload attempt');
    return { fileID: 'cloud://bucket/uploaded-test.mp3' };
  };
  uploadFlowPlugin.submitCloudFallbackJob = async (options) => {
    uploadedFileSeen = options;
    return {
      jobId: 'job-uploaded-test',
      recordId: 'record-uploaded-test',
      sourceType: 'uploaded_file',
      fileID: options.fileID,
      status: 'queued',
    };
  };
  await assert.rejects(
    uploadFlowPlugin.runConfiguredTranscription('https://cdn.example.test/expired.mp4', {
      sourceUrl: 'https://www.douyin.com/video/uploaded-test',
      recordId: 'record-uploaded-test',
      binding: uploadFlowPlugin.settings.bindings[0],
      preserveLocalMediaForCloudFallback: true,
    }),
    error => error && error.code === 'CLOUD_FALLBACK_QUEUED',
  );
  assert.strictEqual(uploadedFileSeen.sourceType, 'uploaded_file');
  assert.strictEqual(uploadedFileSeen.fileID, 'cloud://bucket/uploaded-test.mp3');
  assert.strictEqual(fs.existsSync(retainedPathSeen), false, 'retained media must be removed after fallback submission');

  const noSpeechUploadPlugin = makePlugin();
  noSpeechUploadPlugin.settings.aiProvider = 'local';
  let noSpeechUploadCount = 0;
  noSpeechUploadPlugin.runLocalTranscription = async (_audioUrl, options) => {
    await options.onInputPathReady(mediaPath);
    throw Object.assign(new Error('未检测到语音'), { code: 'TRANSCRIPTION_NO_SPEECH' });
  };
  noSpeechUploadPlugin.uploadLocalMediaForCloudFallback = async () => {
    noSpeechUploadCount += 1;
    return { fileID: 'cloud://bucket/should-not-upload.mp3' };
  };
  await assert.rejects(
    noSpeechUploadPlugin.runConfiguredTranscription('https://cdn.example.test/no-speech.mp4', {
      sourceUrl: 'https://www.douyin.com/video/no-speech',
      recordId: 'record-no-speech',
      binding: noSpeechUploadPlugin.settings.bindings[0],
      preserveLocalMediaForCloudFallback: true,
    }),
    error => error && error.code === 'TRANSCRIPTION_NO_SPEECH',
  );
  assert.strictEqual(noSpeechUploadCount, 0, 'no-speech must not upload a paid fallback artifact');

  const uploadFailurePlugin = makePlugin();
  uploadFailurePlugin.settings.aiProvider = 'local';
  let uploadFailureOriginalUrl = null;
  uploadFailurePlugin.runLocalTranscription = async (_audioUrl, options) => {
    await options.onInputPathReady(mediaPath);
    throw new Error('本地 ASR 失败，上传也失败');
  };
  uploadFailurePlugin.uploadLocalMediaForCloudFallback = async () => {
    const error = new Error('prepare unavailable');
    error.code = 'CLOUD_MEDIA_PREPARE_INVALID';
    throw error;
  };
  uploadFailurePlugin.submitCloudFallbackJob = async (options) => {
    uploadFailureOriginalUrl = options;
    return {
      jobId: 'job-original-url-after-upload-failure',
      recordId: 'record-upload-failure',
      sourceType: 'douyin_url',
      sourceUrl: 'https://www.douyin.com/video/upload-failure',
      status: 'queued',
    };
  };
  await assert.rejects(
    uploadFailurePlugin.buildTranscriptRecordFromMedia({
      id: 'record-upload-failure',
      type: 'webpage',
      content: 'https://www.douyin.com/video/upload-failure',
      metadata: { title: '上传失败回落原链接' },
    }, {
      url: 'https://www.douyin.com/video/upload-failure',
      platform: '抖音',
      mediaUrl: 'https://cdn.example.test/expired.mp4',
      preparedMedia: true,
      binding: uploadFailurePlugin.settings.bindings[0],
    }),
    error => error && error.code === 'CLOUD_FALLBACK_QUEUED',
  );
  assert.strictEqual(uploadFailureOriginalUrl.sourceType, 'douyin_url');
  assert.strictEqual(uploadFailureOriginalUrl.sourceUrl, 'https://www.douyin.com/video/upload-failure');

  const uncertainPlugin = makePlugin();
  uncertainPlugin.settings.aiProvider = 'local';
  uncertainPlugin.settings.cloudFallbackSubmissions = [];
  uncertainPlugin.runLocalTranscription = async (_audioUrl, options) => {
    await options.onInputPathReady(mediaPath);
    throw new Error('本地 ASR 失败');
  };
  uncertainPlugin.uploadLocalMediaForCloudFallback = async () => ({ fileID: 'cloud://bucket/idempotent.mp3' });
  uncertainPlugin.requestJson = async (requestPath, method) => {
    if (requestPath === '/transcriptions/fallback/jobs' && method === 'POST') {
      const error = new Error('服务端暂不可用');
      error.status = 503;
      error.statusCode = 503;
      throw error;
    }
    throw new Error(`unexpected uncertain request ${method} ${requestPath}`);
  };
  await assert.rejects(
    uncertainPlugin.runConfiguredTranscription('https://cdn.example.test/expired.mp4', {
      sourceUrl: 'https://www.douyin.com/video/idempotent',
      recordId: 'record-idempotent',
      retryCount: 0,
      binding: uncertainPlugin.settings.bindings[0],
      preserveLocalMediaForCloudFallback: true,
    }),
    error => error && error.code === 'CLOUD_FALLBACK_SUBMISSION_UNCERTAIN',
  );
  assert.strictEqual(uncertainPlugin.settings.cloudFallbackSubmissions.length, 1, 'uncertain POST must retain the exact uploaded source');
  const pendingSubmission = uncertainPlugin.settings.cloudFallbackSubmissions[0];
  const replayPlugin = makePlugin();
  replayPlugin.settings.cloudFallbackSubmissions = [pendingSubmission];
  replayPlugin.settings.aiProvider = 'local';
  let replayLocalCalled = false;
  let replayBody = null;
  replayPlugin.runLocalTranscription = async () => {
    replayLocalCalled = true;
    throw new Error('replay must use the pending artifact');
  };
  replayPlugin.requestJson = async (requestPath, method, body) => {
    assert.strictEqual(requestPath, '/transcriptions/fallback/jobs');
    assert.strictEqual(method, 'POST');
    replayBody = body;
    return { success: true, data: {
      jobId: 'job-idempotent-replayed',
      recordId: 'record-idempotent',
      sourceType: 'uploaded_file',
      fileID: pendingSubmission.fileID,
      clientRequestId: pendingSubmission.clientRequestId,
      status: 'succeeded',
      transcription: '按原文件恢复的结果',
    } };
  };
  const replayed = await replayPlugin.runConfiguredTranscription('https://cdn.example.test/expired.mp4', {
    sourceUrl: 'https://www.douyin.com/video/idempotent',
    recordId: 'record-idempotent',
    retryCount: 0,
    binding: replayPlugin.settings.bindings[0],
    preserveLocalMediaForCloudFallback: true,
  });
  assert.strictEqual(replayed.transcription, '按原文件恢复的结果');
  assert.strictEqual(replayLocalCalled, false);
  assert.strictEqual(replayBody.fileID, pendingSubmission.fileID);
  assert.strictEqual(replayBody.clientRequestId, pendingSubmission.clientRequestId);
  assert.strictEqual(replayPlugin.settings.cloudFallbackSubmissions.length, 0);

  const operatorResolutionPlugin = Object.create(PluginClass.prototype);
  const operatorResolutionCalls = [];
  operatorResolutionPlugin.fetchDouyinMediaResolutionWithSession = async (pageUrl, awemeId) => {
    operatorResolutionCalls.push({ type: 'session-resolution', pageUrl, awemeId });
    return { mediaUrls: ['https://cdn.example.test/operator-resolved.mp3'] };
  };
  operatorResolutionPlugin.downloadMediaToTempFile = async (candidateUrl, options) => {
    operatorResolutionCalls.push({ type: 'download', candidateUrl, options });
    assert.notStrictEqual(candidateUrl, 'https://www.douyin.com/video/1234567890123456789');
    assert.strictEqual(options.maxBytes, 100 * 1024 * 1024);
    return mediaPath;
  };
  // A 200 response containing the share page HTML is not treated as media;
  // the authenticated Electron session must supply the actual candidate.
  const operatorResolvedPath = await operatorResolutionPlugin.acquireOperatorDouyinMediaToTempFile(
    'https://www.douyin.com/video/1234567890123456789',
  );
  assert.strictEqual(operatorResolvedPath, mediaPath);
  assert.strictEqual(operatorResolutionCalls[0].type, 'session-resolution');
  assert.strictEqual(operatorResolutionCalls[1].candidateUrl, 'https://cdn.example.test/operator-resolved.mp3');

  const operatorTempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wechat-inbox-operator-test-'));
  const operatorMediaPath = path.join(operatorTempRoot, 'operator.mp3');
  await fs.promises.writeFile(operatorMediaPath, Buffer.from('operator-media'));
  const verifiedMediaPath = path.join(operatorTempRoot, 'verified.mp3');
  await fs.promises.writeFile(verifiedMediaPath, Buffer.from('operator-media'));
  const operatorCalls = [];
  const capacityBodies = [];
  const heartbeatBodies = [];
  const mediaCompletions = [];
  const genericCompletions = [];
  let operatorUpload = null;
  const operatorUploadServer = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      operatorUpload = { method: request.method, headers: request.headers, body: Buffer.concat(chunks) };
      response.statusCode = 200;
      response.end('ok');
    });
  });
  await new Promise((resolve) => operatorUploadServer.listen(0, '127.0.0.1', resolve));
  const operatorUploadAddress = operatorUploadServer.address();
  const operatorJob = {
    jobId: 'operator-media-job',
    attemptId: 'operator-attempt-1',
    leaseToken: 'lease-1',
    fencingVersion: 1,
    protocolVersion: 'cfb-worker/v2',
    phase: 'media',
    sourceType: 'douyin_url',
    sourceUrl: 'https://www.douyin.com/video/operator-1',
  };
  // Use the real PluginClass upload helper. Only the authenticated media
  // acquisition step is replaced because this test has no Electron session.
  const operatorPlugin = Object.create(PluginClass.prototype);
  operatorPlugin.settings = { apiBase: 'https://worker.example.test/sync' };
  operatorPlugin.localAsrMutexOwner = null;
  operatorPlugin.operatorLocalAsrActive = false;
  Object.assign(operatorPlugin, {
    acquireOperatorDouyinMediaToTempFile: async (sourceUrl) => {
      assert.strictEqual(sourceUrl, operatorJob.sourceUrl);
      return operatorMediaPath;
    },
    getLocalAsrInstallStatus: () => ({ ready: true }),
    isOperatorLocalAsrAvailable: () => false,
  });
  const operator = operatorNode.createOperatorMediaNode({
    plugin: operatorPlugin,
    env: {
      WECHAT_INBOX_OPERATOR_NODE_ENABLED: '1',
      WECHAT_INBOX_OPERATOR_NODE_ID: 'operator-test-node',
      WECHAT_INBOX_OPERATOR_NODE_TOKEN: 'test-token',
      WECHAT_INBOX_OPERATOR_NODE_API_BASE: 'https://worker.example.test/sync',
    },
    request: async (requestPath, body) => {
      operatorCalls.push({ requestPath, body });
      if (requestPath.endsWith('/capacity')) {
        capacityBodies.push(body);
        return { success: true, data: { workerId: body.workerId, availableCapabilities: body.runtimeCapabilities } };
      }
      if (requestPath.endsWith('/claim')) return { jobs: [operatorJob] };
      if (requestPath.endsWith('/heartbeat')) {
        heartbeatBodies.push(body);
        return { success: true, data: body };
      }
      if (requestPath.endsWith('/media/prepare')) {
        assert.strictEqual(body.jobId, operatorJob.jobId);
        assert.strictEqual(body.workerId, 'operator-test-node');
        assert.strictEqual(body.format, 'mp3');
        return {
          success: true,
          data: {
            uploadId: 'upload-1',
            fileID: 'cloud://bucket/operator-1.mp3',
            uploadUrl: `http://127.0.0.1:${operatorUploadAddress.port}/worker-upload`,
            method: 'PUT',
            headers: { Signature: 'test-signature' },
          },
        };
      }
      if (requestPath.endsWith('/media/complete')) {
        mediaCompletions.push(body);
        return {
          success: true,
          data: {
            jobId: operatorJob.jobId,
            status: 'queued',
            phase: 'asr',
            fileID: 'cloud://bucket/operator-1.mp3',
            mediaReady: true,
          },
        };
      }
      if (requestPath.endsWith('/complete')) {
        genericCompletions.push(body);
        return { success: true, data: body };
      }
      return { success: true, data: {} };
    },
  });
  assert.strictEqual(operator.start(), true);
  await operator.poll();
  await operator.stop();
  await new Promise((resolve) => operatorUploadServer.close(resolve));
  assert.ok(operatorUpload, 'real worker upload helper must send bytes to the signed URL');
  assert.strictEqual(operatorUpload.method, 'PUT');
  assert.deepStrictEqual(operatorUpload.body, Buffer.from('operator-media'));
  assert.strictEqual(operatorUpload.headers.signature, 'test-signature');
  assert.strictEqual(mediaCompletions.length, 1, 'worker media complete must atomically advance media to ASR');
  assert.strictEqual(mediaCompletions[0].uploadId, 'upload-1');
  assert.strictEqual(mediaCompletions[0].jobId, operatorJob.jobId);
  assert.strictEqual(genericCompletions.length, 0, 'media completion must not call generic outcome media_ready');
  assert.ok(heartbeatBodies.length >= 1);
  assert.ok(heartbeatBodies.every((item) => item.stage === 'acquiring'), 'media heartbeat must use the backend-supported acquiring stage');
  assert.ok(capacityBodies.length >= 1, 'operator must register capacity before claiming work');
  assert.deepStrictEqual(capacityBodies[0].runtimeCapabilities, ['media_acquire']);
  assert.deepStrictEqual(capacityBodies[0].availableCapabilities, ['media_acquire']);
  assert.deepStrictEqual(operatorCalls.find((item) => item.requestPath.endsWith('/claim')).body.capabilities, ['media_acquire']);
  assert.strictEqual(fs.existsSync(operatorMediaPath), false, 'operator temp media must never remain after completion');

  // An idle always-on node backs off geometrically so it does not spend
  // CloudBase quota on an empty queue; claiming work resets the interval.
  const backoffTimers = [];
  const backoffMediaPath = path.join(operatorTempRoot, 'backoff.mp3');
  await fs.promises.writeFile(backoffMediaPath, Buffer.from('backoff-media'));
  const backoffCompletions = [];
  let backoffJobToClaim = null;
  const backoffNode = operatorNode.createOperatorMediaNode({
    plugin: {
      downloadMediaToTempFile: async () => backoffMediaPath,
      verifyOperatorControlledMediaFile: async () => ({ size: 13, sha256: 'fixture' }),
      runLocalTranscription: async () => 'backoff transcript',
      getLocalAsrInstallStatus: () => ({ ready: true }),
    },
    env: {
      WECHAT_INBOX_OPERATOR_NODE_ENABLED: '1',
      WECHAT_INBOX_OPERATOR_NODE_ID: 'operator-backoff-node',
      WECHAT_INBOX_OPERATOR_NODE_TOKEN: 'test-token',
    },
    apiBase: 'https://worker.example.test/sync',
    pollIntervalMs: 15000,
    maxIdlePollIntervalMs: 120000,
    setTimer: (fn, delay) => {
      backoffTimers.push({ fn, delay });
      return backoffTimers.length;
    },
    clearTimer: (id) => {
      const entry = backoffTimers[id - 1];
      if (entry) entry.cleared = true;
    },
    request: async (requestPath, body) => {
      if (requestPath.endsWith('/capacity')) return { success: true, data: { workerId: body.workerId } };
      if (requestPath.endsWith('/claim')) {
        const job = backoffJobToClaim;
        backoffJobToClaim = null;
        return { jobs: job ? [job] : [] };
      }
      if (requestPath.endsWith('/heartbeat')) return { success: true, data: body };
      if (requestPath.endsWith('/complete')) {
        backoffCompletions.push(body);
        return { success: true, data: body };
      }
      return { success: true, data: {} };
    },
  });
  const fireBackoffTimer = async () => {
    const entry = backoffTimers.pop();
    assert.ok(entry, 'operator must schedule its next poll');
    entry.fn();
    await backoffNode.poll();
    return entry.delay;
  };
  assert.strictEqual(backoffNode.start(), true);
  assert.strictEqual(await fireBackoffTimer(), 15000);
  assert.strictEqual(backoffNode.getSnapshot().nextPollDelayMs, 30000);
  assert.strictEqual(await fireBackoffTimer(), 30000);
  assert.strictEqual(backoffNode.getSnapshot().nextPollDelayMs, 60000);
  assert.strictEqual(await fireBackoffTimer(), 60000);
  assert.strictEqual(backoffNode.getSnapshot().nextPollDelayMs, 120000);
  assert.strictEqual(await fireBackoffTimer(), 120000);
  assert.strictEqual(backoffNode.getSnapshot().nextPollDelayMs, 120000, 'idle polling must stay capped');
  backoffJobToClaim = {
    jobId: 'backoff-job-1',
    attemptId: 'backoff-attempt-1',
    leaseToken: 'lease-backoff',
    fencingVersion: 1,
    phase: 'asr',
    backend: 'local_whisper_cpp',
    controlledMediaUrl: 'https://signed.example.test/backoff.mp3',
  };
  assert.strictEqual(await fireBackoffTimer(), 120000);
  assert.strictEqual(backoffCompletions.length, 1);
  assert.strictEqual(backoffCompletions[0].outcome, 'succeeded');
  assert.strictEqual(backoffNode.getSnapshot().idleRuns, 0, 'claiming work must reset idle backoff');
  assert.strictEqual(backoffNode.getSnapshot().nextPollDelayMs, 15000);
  assert.strictEqual(fs.existsSync(backoffMediaPath), false, 'operator temp media must be removed after success');
  await backoffNode.stop();

  const verifierPlugin = Object.create(PluginClass.prototype);
  const verifiedDigest = require('crypto').createHash('sha256').update(Buffer.from('operator-media')).digest('hex');
  const verified = await verifierPlugin.verifyOperatorControlledMediaFile(verifiedMediaPath, {
    mediaSize: Buffer.byteLength('operator-media'),
    mediaSha256: verifiedDigest,
  });
  assert.strictEqual(verified.sha256, verifiedDigest);
  const legacyOwned = await verifierPlugin.verifyOperatorControlledMediaFile(verifiedMediaPath, {
    legacyOwnedFile: true,
    mediaIntegrity: 'legacy_owned_file',
  });
  assert.strictEqual(legacyOwned.sha256, verifiedDigest, 'backend-owned legacy file IDs still require a local digest');
  await assert.rejects(
    verifierPlugin.verifyOperatorControlledMediaFile(verifiedMediaPath, {
      mediaSize: Buffer.byteLength('operator-media'),
      mediaSha256: '0'.repeat(64),
    }),
    error => error && error.code === 'OPERATOR_MEDIA_INTEGRITY_MISMATCH',
  );

  const asrGatePlugin = Object.create(PluginClass.prototype);
  asrGatePlugin.operatorLocalAsrActive = false;
  asrGatePlugin.currentTranscriptionAbortController = null;
  asrGatePlugin.currentTranscriptionProcess = null;
  asrGatePlugin.currentTranscriptionContext = { recordId: 'foreground-run' };
  assert.strictEqual(asrGatePlugin.isOperatorLocalAsrAvailable(), false, 'foreground ASR must pause operator local_asr');
  asrGatePlugin.currentTranscriptionContext = null;
  let operatorAsrOptions = null;
  asrGatePlugin.runLocalTranscription = async (inputPath, options) => {
    operatorAsrOptions = { inputPath, options };
    return 'operator transcript';
  };
  const operatorAsrResult = await asrGatePlugin.runOperatorLocalTranscription('/tmp/operator-controlled.mp3', { signal: new AbortController().signal });
  assert.strictEqual(operatorAsrResult, 'operator transcript');
  assert.strictEqual(operatorAsrOptions.options.operatorNode, true);
  assert.strictEqual(operatorAsrOptions.options.inputPath, '/tmp/operator-controlled.mp3');
  assert.strictEqual(asrGatePlugin.operatorLocalAsrActive, false, 'operator ASR gate must release after completion');

  let releaseForegroundMutex = null;
  const foregroundMutexGate = new Promise((resolve) => { releaseForegroundMutex = resolve; });
  const foregroundMutexPlugin = Object.create(PluginClass.prototype);
  foregroundMutexPlugin.localAsrMutexOwner = null;
  foregroundMutexPlugin.operatorLocalAsrActive = false;
  foregroundMutexPlugin.runLocalTranscriptionCore = async () => {
    await foregroundMutexGate;
    return 'foreground transcript';
  };
  const foregroundMutexRun = foregroundMutexPlugin.runLocalTranscription('/tmp/foreground.mp3');
  assert.strictEqual(foregroundMutexPlugin.localAsrMutexOwner.kind, 'foreground', 'foreground ASR must claim the mutex before its first await');
  await assert.rejects(
    foregroundMutexPlugin.runOperatorLocalTranscription('/tmp/operator.mp3'),
    error => error && error.code === 'OPERATOR_ASR_BUSY',
  );
  await assert.rejects(
    foregroundMutexPlugin.runLocalTranscription('/tmp/second-foreground.mp3'),
    error => error && error.code === 'LOCAL_ASR_BUSY',
  );
  releaseForegroundMutex();
  assert.strictEqual(await foregroundMutexRun, 'foreground transcript');
  assert.strictEqual(foregroundMutexPlugin.localAsrMutexOwner, null);

  let releaseOperatorMutex = null;
  const operatorMutexGate = new Promise((resolve) => { releaseOperatorMutex = resolve; });
  const operatorMutexPlugin = Object.create(PluginClass.prototype);
  operatorMutexPlugin.localAsrMutexOwner = null;
  operatorMutexPlugin.operatorLocalAsrActive = false;
  operatorMutexPlugin.runLocalTranscriptionCore = async () => {
    await operatorMutexGate;
    return 'operator transcript';
  };
  const operatorMutexRun = operatorMutexPlugin.runOperatorLocalTranscription('/tmp/operator.mp3');
  assert.strictEqual(operatorMutexPlugin.localAsrMutexOwner.kind, 'operator', 'operator ASR must claim the mutex before setup awaits');
  await assert.rejects(
    operatorMutexPlugin.runLocalTranscription('/tmp/foreground.mp3'),
    error => error && error.code === 'LOCAL_ASR_BUSY',
  );
  releaseOperatorMutex();
  assert.strictEqual(await operatorMutexRun, 'operator transcript');
  assert.strictEqual(operatorMutexPlugin.localAsrMutexOwner, null);

  const stoppedOperatorTempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wechat-inbox-operator-stop-test-'));
  const stoppedOperatorMediaPath = path.join(stoppedOperatorTempRoot, 'operator.mp4');
  await fs.promises.writeFile(stoppedOperatorMediaPath, Buffer.from('operator-stop-media'));
  const stoppedCompletions = [];
  let stopRunSignal = null;
  const stoppedOperator = operatorNode.createOperatorMediaNode({
    plugin: {
      downloadMediaToTempFile: async () => stoppedOperatorMediaPath,
      verifyOperatorControlledMediaFile: async () => ({ size: 19, sha256: 'fixture' }),
      runLocalTranscription: async (_path, options) => await new Promise((_resolve, reject) => {
        stopRunSignal = options.signal;
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('node stopped'), { name: 'AbortError' })), { once: true });
      }),
      getLocalAsrInstallStatus: () => ({ ready: true }),
    },
    env: {
      WECHAT_INBOX_OPERATOR_NODE_ENABLED: '1',
      WECHAT_INBOX_OPERATOR_NODE_ID: 'operator-stop-node',
      WECHAT_INBOX_OPERATOR_NODE_TOKEN: 'test-token',
    },
    apiBase: 'https://worker.example.test/sync',
    request: async (requestPath, body) => {
      if (requestPath.endsWith('/claim')) return { jobs: [{
        jobId: 'operator-stop-job', attemptId: 'operator-stop-attempt', leaseToken: 'lease-stop', fencingVersion: 1,
        phase: 'asr', backend: 'local_whisper_cpp', sourceType: 'uploaded_file', controlledMediaUrl: 'https://signed.example.test/media.mp3',
        mediaSize: 19, mediaSha256: require('crypto').createHash('sha256').update(Buffer.from('operator-stop-media')).digest('hex'),
      }] };
      if (requestPath.endsWith('/complete')) stoppedCompletions.push(body);
      return { success: true, data: {} };
    },
  });
  stoppedOperator.start();
  const stoppedPoll = stoppedOperator.poll();
  for (let attempt = 0; attempt < 20 && !stopRunSignal; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  await stoppedOperator.stop();
  await stoppedPoll;
  assert.strictEqual(stopRunSignal && stopRunSignal.aborted, true);
  assert.strictEqual(stoppedCompletions[0].outcome, 'failed', 'node shutdown must release work as retryable failure');
  assert.strictEqual(stoppedCompletions[0].error.code, 'OPERATOR_NODE_STOPPED');
  assert.notStrictEqual(stoppedCompletions[0].outcome, 'cancelled');
  assert.strictEqual(fs.existsSync(stoppedOperatorMediaPath), false);

  let releaseClaim = null;
  let claimStarted = false;
  const claimCompletions = [];
  const claimGate = new Promise((resolve) => { releaseClaim = resolve; });
  const claimRaceNode = operatorNode.createOperatorMediaNode({
    plugin: {},
    env: {
      WECHAT_INBOX_OPERATOR_NODE_ENABLED: '1',
      WECHAT_INBOX_OPERATOR_NODE_ID: 'operator-claim-race-node',
      WECHAT_INBOX_OPERATOR_NODE_TOKEN: 'test-token',
    },
    apiBase: 'https://worker.example.test/sync',
    request: async (requestPath, body) => {
      if (requestPath.endsWith('/claim')) {
        claimStarted = true;
        await claimGate;
        return { jobs: [{
          jobId: 'operator-claim-race-job', attemptId: 'operator-claim-race-attempt',
          leaseToken: 'lease-race', fencingVersion: 1, phase: 'media',
          sourceType: 'douyin_url', sourceUrl: 'https://www.douyin.com/video/claim-race',
        }] };
      }
      if (requestPath.endsWith('/complete')) claimCompletions.push(body);
      return { success: true, data: {} };
    },
  });
  claimRaceNode.start();
  const claimPoll = claimRaceNode.poll();
  for (let attempt = 0; attempt < 20 && !claimStarted; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  await claimRaceNode.stop();
  releaseClaim();
  await claimPoll;
  assert.strictEqual(claimCompletions[0].outcome, 'failed', 'claim resolving after shutdown must release the lease');
  assert.strictEqual(claimCompletions[0].error.code, 'OPERATOR_NODE_STOPPED');

  await fs.promises.rm(mediaTempRoot, { recursive: true, force: true });
  await fs.promises.rm(operatorTempRoot, { recursive: true, force: true });
  await fs.promises.rm(stoppedOperatorTempRoot, { recursive: true, force: true });

  console.log('plugin cloud fallback real method tests passed');
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

console.log('plugin cloud fallback jobs tests passed');
