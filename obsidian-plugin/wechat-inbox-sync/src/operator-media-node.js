'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');

const OPERATOR_NODE_ENABLED_ENV = 'WECHAT_INBOX_OPERATOR_NODE_ENABLED';
const OPERATOR_NODE_ID_ENV = 'WECHAT_INBOX_OPERATOR_NODE_ID';
const OPERATOR_NODE_TOKEN_ENV = 'WECHAT_INBOX_OPERATOR_NODE_TOKEN';
const OPERATOR_NODE_API_BASE_ENV = 'WECHAT_INBOX_OPERATOR_NODE_API_BASE';
const WORKER_PROTOCOL_VERSION = 'cfb-worker/v2';
const DEFAULT_CAPABILITIES = Object.freeze(['media_acquire', 'local_asr']);
// Advertised only while the plugin really exposes the Xiaohongshu capture path
// and the deployment's node registry accepted the capability.
const XIAOHONGSHU_CAPABILITY = 'xiaohongshu';
const DEFAULT_POLL_INTERVAL_MS = 15000;
// An idle node backs off to one claim per two minutes. This stays well under
// the worker capacity TTL, so a queued job is still noticed promptly.
const DEFAULT_MAX_IDLE_POLL_INTERVAL_MS = 120000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const MAX_OPERATOR_RESPONSE_BYTES = 1024 * 1024;
const MAX_OPERATOR_MEDIA_BYTES = 100 * 1024 * 1024;

function nodeError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function isOperatorNodeEnabled(env = process.env) {
  return String(env && env[OPERATOR_NODE_ENABLED_ENV] || '').trim() === '1'
    && Boolean(String(env && env[OPERATOR_NODE_ID_ENV] || '').trim())
    && Boolean(String(env && env[OPERATOR_NODE_TOKEN_ENV] || '').trim());
}

function readOperatorNodeConfig({ env = process.env, apiBase = '' } = {}) {
  const workerId = String(env && env[OPERATOR_NODE_ID_ENV] || '').trim();
  const workerToken = String(env && env[OPERATOR_NODE_TOKEN_ENV] || '').trim();
  const configuredApiBase = String(env && env[OPERATOR_NODE_API_BASE_ENV] || apiBase || '').trim().replace(/\/+$/, '');
  return {
    enabled: isOperatorNodeEnabled(env),
    workerId,
    workerToken,
    apiBase: configuredApiBase,
  };
}

function redactError(error) {
  const code = String(error && error.code || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80) || 'OPERATOR_NODE_FAILED';
  return { code };
}

// The server stores only code, message, retryable and stage, so a bare
// OPERATOR_NODE_FAILED leaves both the operator and the user guessing whether
// the node lacked a login, hit risk control, or could not reach the platform.
// The reason below is a fixed vocabulary derived from the error - never the
// raw message, which can carry URLs, cookies or page fragments.
const FAILURE_REASON_PATTERNS = [
  [/LOGIN|COOKIE|未登录|登录/i, 'login-required'],
  [/RISK|VERIFY|CAPTCHA|风控|验证/i, 'risk-control'],
  [/NOT_FOUND|NOTFOUND|NOT_FOUND|UNDELIVER|INVALID|失效|不存在|已删除/i, 'content-unavailable'],
  [/UNSUPPORTED|不支持/i, 'unsupported-content'],
  [/TIMEOUT|ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED|socket|network|网络/i, 'network'],
  [/UPLOAD|SIGNED|PUT_/i, 'upload'],
  [/ASR|WHISPER|TRANSCRIB/i, 'transcription'],
];

function classifyFailureReason(error) {
  const text = `${String(error && error.code || '')} ${String(error && error.name || '')} ${String(error && error.message || '')}`;
  const match = FAILURE_REASON_PATTERNS.find(([pattern]) => pattern.test(text));
  return match ? match[1] : 'unknown';
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw nodeError('OPERATOR_NODE_CANCELLED', '运营节点任务已取消', { name: 'AbortError' });
}

function requestJsonViaNode(baseUrl, path, token, body, {
  signal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  allowInsecureLoopback = false,
} = {}) {
  let parsed;
  try {
    parsed = new URL(`${String(baseUrl || '').replace(/\/+$/, '')}${path}`);
  } catch (_) {
    return Promise.reject(nodeError('OPERATOR_NODE_API_INVALID', '运营节点 API 地址无效'));
  }
  const loopbackHost = ['127.0.0.1', '::1', 'localhost'].includes(String(parsed.hostname || '').toLowerCase());
  if (parsed.protocol !== 'https:' && !(allowInsecureLoopback === true && parsed.protocol === 'http:' && loopbackHost)) {
    return Promise.reject(nodeError('OPERATOR_NODE_API_INVALID', '运营节点 API 地址无效'));
  }
  throwIfAborted(signal);
  const transport = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    let request;
    const abort = () => {
      if (request) request.destroy();
      finish(nodeError('OPERATOR_NODE_CANCELLED', '运营节点请求已取消', { name: 'AbortError' }));
    };
    try {
      request = transport.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        method: 'POST',
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Cloud-Transcription-Worker-Token': token,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }, (response) => {
        let text = '';
        let responseBytes = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBytes += Buffer.byteLength(String(chunk));
          if (responseBytes > MAX_OPERATOR_RESPONSE_BYTES) {
            response.destroy();
            if (request) request.destroy();
            finish(nodeError('OPERATOR_NODE_RESPONSE_TOO_LARGE', '运营节点 API 响应过大'));
            return;
          }
          text += chunk;
        });
        response.on('end', () => {
          let payload = null;
          try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = {}; }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = nodeError(
              String(payload && (payload.code || payload.errCode) || `HTTP_${response.statusCode}`).slice(0, 80),
              '运营节点 API 请求失败',
              { statusCode: response.statusCode },
            );
            finish(error);
            return;
          }
          finish(null, payload);
        });
      });
    } catch (error) {
      finish(nodeError('OPERATOR_NODE_REQUEST_FAILED', '运营节点 API 请求失败', { cause: error }));
      return;
    }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      request.destroy();
      finish(nodeError('OPERATOR_NODE_REQUEST_TIMEOUT', '运营节点 API 请求超时', { retryable: true }));
    }, Math.max(1000, Math.min(120000, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS)));
    request.on('error', (error) => {
      if (settled) return;
      if (signal && signal.aborted) finish(nodeError('OPERATOR_NODE_CANCELLED', '运营节点请求已取消', { name: 'AbortError' }));
      else finish(nodeError('OPERATOR_NODE_REQUEST_FAILED', '运营节点 API 请求失败', { cause: error, retryable: true }));
    });
    request.end(JSON.stringify(body || {}));
  });
}

function normalizeJobs(response) {
  const data = response && response.data && typeof response.data === 'object' ? response.data : response;
  return Array.isArray(data) ? data : (Array.isArray(data && data.jobs) ? data.jobs : []);
}

function isDouyinSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return /^https?:$/.test(url.protocol) && /(^|\.)douyin\.com$/i.test(url.hostname);
  } catch (_) {
    return false;
  }
}

function isXiaohongshuSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return /^https?:$/.test(url.protocol)
      && (/(^|\.)xiaohongshu\.com$/i.test(url.hostname)
        || /(^|\.)xhslink\.com$/i.test(url.hostname)
        || /(^|\.)xhslink\.cn$/i.test(url.hostname));
  } catch (_) {
    return false;
  }
}

// A media job carries no platform field, so the pair (sourceType, sourceUrl)
// is the only thing that decides which capture path may run. An unknown pair is
// rejected instead of being guessed at, because claiming a job here takes it
// away from every other node.
function resolveMediaSourcePlatform(job) {
  const sourceType = String(job && job.sourceType || '').trim().toLowerCase();
  const sourceUrl = String(job && job.sourceUrl || '').trim();
  if (sourceType === 'douyin_url' && isDouyinSourceUrl(sourceUrl)) return 'douyin';
  if (sourceType === 'xiaohongshu_url' && isXiaohongshuSourceUrl(sourceUrl)) return 'xiaohongshu';
  return '';
}

function createOperatorMediaNode({
  plugin = null,
  env = process.env,
  apiBase = '',
  request = null,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  capacityHeartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  maxIdlePollIntervalMs = DEFAULT_MAX_IDLE_POLL_INTERVAL_MS,
  logger = () => {},
  clock = () => Date.now(),
  setTimer = (fn, delay) => setTimeout(fn, delay),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  const config = readOperatorNodeConfig({ env, apiBase });
  const callApi = typeof request === 'function'
    ? request
    : (path, body, options) => requestJsonViaNode(config.apiBase, path, config.workerToken, body, options);
  let running = false;
  let pollTimer = null;
  let pollInFlight = null;
  let activeJob = null;
  let activePromise = null;
  let activeController = null;
  let activeHeartbeatTimer = null;
  let capacityHeartbeatTimer = null;
  let capacityHeartbeatInFlight = null;
  let capacityController = null;
  let capacityReady = false;
  let stopRequested = false;
  let lastErrorCode = '';
  let lastPollAt = 0;
  let completedCount = 0;
  let idleRuns = 0;
  let nextPollDelayMs = 0;

  const baseForJob = (job) => ({
    jobId: String(job && job.jobId || job && job.id || '').trim(),
    workerId: config.workerId,
    attemptId: String(job && job.attemptId || '').trim(),
    leaseToken: String(job && job.leaseToken || '').trim(),
    fencingVersion: job && job.fencingVersion,
    protocolVersion: WORKER_PROTOCOL_VERSION,
  });
  const snapshot = () => ({
    enabled: config.enabled,
    running,
    status: activeJob ? 'processing' : running ? 'idle' : 'stopped',
    active: Boolean(activeJob),
    phase: activeJob ? String(activeJob.phase || '') : '',
    stage: activeJob ? String(activeJob.stage || '') : '',
    queuedCount: activeJob ? 1 : 0,
    completedCount,
    lastErrorCode,
    lastPollAt,
    idleRuns,
    nextPollDelayMs,
  });
  const schedule = (delay = pollIntervalMs) => {
    if (!running || pollTimer) return;
    nextPollDelayMs = Math.max(1000, Number(delay) || DEFAULT_POLL_INTERVAL_MS);
    pollTimer = setTimer(() => {
      pollTimer = null;
      poll().catch(() => {});
    }, nextPollDelayMs);
    if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();
  };
  const heartbeat = async (job, stage, progress) => {
    const body = { ...baseForJob(job), stage: String(stage || '').slice(0, 64), progress: Math.max(0, Math.min(100, Number(progress) || 0)) };
    return await callApi('/transcriptions/fallback/worker/heartbeat', body, { signal: activeController && activeController.signal });
  };
  const stopHeartbeat = () => {
    if (activeHeartbeatTimer) clearInterval(activeHeartbeatTimer);
    activeHeartbeatTimer = null;
  };
  const startHeartbeat = (job) => {
    stopHeartbeat();
    activeHeartbeatTimer = setInterval(async () => {
      if (!running || !activeJob || !activeController || activeController.signal.aborted) return;
      try {
        await heartbeat(job, activeJob.stage || 'processing', activeJob.progress || 10);
      } catch (error) {
        lastErrorCode = redactError(error).code;
        if (error && error.code !== 'STALE_HEARTBEAT'
          && (error.code === 'LEASE_LOST' || error.code === 'JOB_CANCELLED')) {
          activeController.abort();
        }
      }
    }, Math.max(5000, Number(heartbeatIntervalMs) || DEFAULT_HEARTBEAT_INTERVAL_MS));
    if (activeHeartbeatTimer && typeof activeHeartbeatTimer.unref === 'function') activeHeartbeatTimer.unref();
  };
  const complete = async (job, body) => {
    return await callApi('/transcriptions/fallback/worker/complete', { ...baseForJob(job), ...body }, { signal: null });
  };
  // Optional capabilities are negotiated, never assumed. A deployment whose
  // node registry predates one of them rejects the whole worker request
  // (WORKER_CAPABILITY_FORBIDDEN), which would take the node offline the moment
  // a new plugin starts. Drop the rejected optional capability and retry, so an
  // older server keeps receiving everything the plugin already supported.
  const rejectedCapabilities = new Set();
  const getCapabilities = () => {
    const capabilities = ['media_acquire'];
    if (!rejectedCapabilities.has(XIAOHONGSHU_CAPABILITY)
      && plugin && typeof plugin.acquireOperatorXiaohongshuContent === 'function') {
      capabilities.push(XIAOHONGSHU_CAPABILITY);
    }
    try {
      if (!rejectedCapabilities.has('local_asr')
        && plugin && typeof plugin.getLocalAsrInstallStatus === 'function'
        && plugin.getLocalAsrInstallStatus().ready === true
        && (typeof plugin.isOperatorLocalAsrAvailable !== 'function' || plugin.isOperatorLocalAsrAvailable())) capabilities.push('local_asr');
    } catch (_) { /* A missing local component is not advertised as capable. */ }
    return capabilities;
  };
  const withCapabilityNegotiation = async (send) => {
    for (;;) {
      try {
        return await send();
      } catch (error) {
        if (!error || error.code !== 'WORKER_CAPABILITY_FORBIDDEN') throw error;
        const candidate = [XIAOHONGSHU_CAPABILITY, 'local_asr']
          .find((capability) => getCapabilities().includes(capability));
        if (!candidate) throw error;
        rejectedCapabilities.add(candidate);
        lastErrorCode = 'WORKER_CAPABILITY_DOWNGRADED';
        try { logger({ type: 'capability-downgraded', capability: candidate }); } catch (_) { /* Diagnostics are advisory. */ }
      }
    }
  };
  const stopCapacityHeartbeat = () => {
    if (capacityHeartbeatTimer) clearInterval(capacityHeartbeatTimer);
    capacityHeartbeatTimer = null;
    if (capacityController && !capacityController.signal.aborted) capacityController.abort();
    capacityController = null;
    capacityReady = false;
  };
  const sendCapacityHeartbeat = async () => {
    if (!running) return false;
    if (capacityHeartbeatInFlight) return await capacityHeartbeatInFlight;
    const controller = new AbortController();
    capacityController = controller;
    capacityHeartbeatInFlight = (async () => {
      try {
        await withCapabilityNegotiation(() => {
          const capabilities = getCapabilities();
          return callApi('/transcriptions/fallback/worker/capacity', {
            workerId: config.workerId,
            protocolVersion: WORKER_PROTOCOL_VERSION,
            capabilities,
            runtimeCapabilities: capabilities,
            availableCapabilities: capabilities,
            phases: ['media', 'asr'],
            capacitySlots: 1,
            activeSlots: activeJob ? 1 : 0,
          }, { signal: controller.signal });
        });
        capacityReady = true;
        return true;
      } catch (error) {
        capacityReady = false;
        lastErrorCode = redactError(error).code;
        try { logger({ type: 'capacity-heartbeat-failed', code: lastErrorCode }); } catch (_) { /* Diagnostics are advisory. */ }
        return false;
      } finally {
        if (capacityController === controller) capacityController = null;
        capacityHeartbeatInFlight = null;
      }
    })();
    return await capacityHeartbeatInFlight;
  };
  const startCapacityHeartbeat = () => {
    if (capacityHeartbeatTimer) clearInterval(capacityHeartbeatTimer);
    capacityHeartbeatTimer = null;
    void sendCapacityHeartbeat().catch(() => {});
    capacityHeartbeatTimer = setInterval(() => {
      void sendCapacityHeartbeat().catch(() => {});
    }, Math.max(5000, Number(capacityHeartbeatIntervalMs) || DEFAULT_HEARTBEAT_INTERVAL_MS));
    if (capacityHeartbeatTimer && typeof capacityHeartbeatTimer.unref === 'function') capacityHeartbeatTimer.unref();
  };
  const failBody = (error, stage, { shutdown = false } = {}) => ({
    // Closing an operator node must release the lease for another node. It is
    // retryable work, never a user cancellation terminal state.
    outcome: shutdown ? 'failed' : error && error.noSpeech === true ? 'no_speech' : 'failed',
    phase: String(activeJob && activeJob.phase || '').trim() || 'asr',
    backend: String(activeJob && activeJob.backend || '').trim() || undefined,
    error: {
      ...(shutdown ? { code: 'OPERATOR_NODE_STOPPED' } : redactError(error)),
      message: shutdown ? '运营节点已停止，任务可由其他节点继续'
        : error && error.linkExpired === true && String(error.message || '').trim()
          ? String(error.message).trim()
          : `运营节点任务处理失败（${String(stage || 'unknown').slice(0, 32)}：${classifyFailureReason(error)}）`,
      // A retired share link is answered by asking the user for a new one; every
      // other failure may succeed on another node or a later attempt.
      retryable: error && error.linkExpired === true ? false : true,
      stage: String(stage || '').slice(0, 64),
    },
  });
  const processJob = async (job) => {
    const phase = String(job && job.phase || '').trim();
    const base = baseForJob(job);
    if (!base.jobId || !base.attemptId || !base.leaseToken) throw nodeError('OPERATOR_JOB_INVALID', '运营节点任务租约无效');
    if (!['media', 'asr'].includes(phase)) throw nodeError('OPERATOR_JOB_PHASE_INVALID', '运营节点任务阶段无效');
    const mediaPlatform = phase === 'media' ? resolveMediaSourcePlatform(job) : '';
    if (phase === 'media' && !mediaPlatform) {
      // Release the lease instead of leaving it to expire: a job this node can
      // never process would otherwise come straight back on the next claim.
      await complete(job, {
        phase: 'media',
        outcome: 'failed',
        error: {
          code: 'OPERATOR_MEDIA_SOURCE_INVALID',
          message: '运营节点只处理受控平台媒体任务',
          retryable: false,
          stage: 'acquiring',
        },
      });
      return null;
    }
    if (phase === 'asr' && !/^https?:\/\//i.test(String(job.controlledMediaUrl || '').trim())) {
      throw nodeError('OPERATOR_CONTROLLED_MEDIA_REQUIRED', '运营节点 ASR 缺少受控媒体地址', { retryable: false });
    }
    activeController = new AbortController();
    activeJob = { phase, backend: String(job.backend || '').trim(), stage: 'acquiring', progress: 5 };
    startHeartbeat(job);
    let tempPath = '';
    let mediaCompletionAttempted = false;
    try {
      await heartbeat(job, 'acquiring', 5);
      if (phase === 'media' && mediaPlatform === 'xiaohongshu') {
        if (!plugin || typeof plugin.acquireOperatorXiaohongshuContent !== 'function' || typeof plugin.uploadWorkerMediaForJob !== 'function') {
          throw nodeError('OPERATOR_MEDIA_HANDLER_UNAVAILABLE', '运营节点小红书抓取能力未就绪', { retryable: true });
        }
        const acquired = await plugin.acquireOperatorXiaohongshuContent(job.sourceUrl, { signal: activeController.signal });
        // A graphic note has no audio to transcribe. Its answer is the article
        // itself, so the media phase completes with extracted content and the
        // job never advances to ASR.
        if (acquired && acquired.kind === 'content') {
          const content = acquired.content && typeof acquired.content === 'object' ? acquired.content : null;
          const markdown = String(content && content.markdown || '').trim();
          const imageUrls = Array.isArray(content && content.imageUrls) ? content.imageUrls : [];
          if (!markdown && !imageUrls.length) {
            throw nodeError('OPERATOR_XIAOHONGSHU_EMPTY', '运营节点未提取到小红书图文内容', { retryable: true });
          }
          activeJob.progress = 100;
          stopHeartbeat();
          return await complete(job, { phase: 'media', outcome: 'succeeded', content });
        }
        const videoPath = String(acquired && acquired.tempPath || '').trim();
        if (!videoPath) throw nodeError('OPERATOR_XIAOHONGSHU_EMPTY', '运营节点未取得小红书视频文件', { retryable: true });
        tempPath = videoPath;
        activeJob.progress = 45;
        const uploadedXiaohongshu = await plugin.uploadWorkerMediaForJob(tempPath, job, {
          signal: activeController.signal,
          workerConfig: config,
          request: callApi,
          beforeComplete: () => {
            mediaCompletionAttempted = true;
            stopHeartbeat();
          },
        });
        activeJob.progress = 100;
        stopHeartbeat();
        const xiaohongshuCompletion = uploadedXiaohongshu && uploadedXiaohongshu.completion;
        if (!xiaohongshuCompletion) throw nodeError('OPERATOR_MEDIA_COMPLETE_INVALID', '运营节点媒体上传未完成', { retryable: true });
        return xiaohongshuCompletion;
      }
      if (phase === 'media') {
        if (!plugin || typeof plugin.acquireOperatorDouyinMediaToTempFile !== 'function' || typeof plugin.uploadWorkerMediaForJob !== 'function') {
          throw nodeError('OPERATOR_MEDIA_HANDLER_UNAVAILABLE', '运营节点媒体能力未就绪', { retryable: true });
        }
        tempPath = await plugin.acquireOperatorDouyinMediaToTempFile(job.sourceUrl, { signal: activeController.signal });
        activeJob.progress = 45;
        const uploaded = await plugin.uploadWorkerMediaForJob(tempPath, job, {
          signal: activeController.signal,
          workerConfig: config,
          request: callApi,
          beforeComplete: () => {
            mediaCompletionAttempted = true;
            stopHeartbeat();
          },
        });
        activeJob.progress = 100;
        stopHeartbeat();
        const completedPayload = uploaded && uploaded.completion;
        if (!completedPayload) throw nodeError('OPERATOR_MEDIA_COMPLETE_INVALID', '运营节点媒体上传未完成', { retryable: true });
        return completedPayload;
      }
      if (!plugin || typeof plugin.downloadMediaToTempFile !== 'function'
        || (typeof plugin.runOperatorLocalTranscription !== 'function' && typeof plugin.runLocalTranscription !== 'function')) {
        throw nodeError('OPERATOR_ASR_HANDLER_UNAVAILABLE', '运营节点本地转写能力未就绪', { retryable: true });
      }
      if (typeof plugin.isOperatorLocalAsrAvailable === 'function' && !plugin.isOperatorLocalAsrAvailable()) {
        throw nodeError('OPERATOR_ASR_BUSY', '运营节点本地转写正忙', { retryable: true });
      }
      tempPath = await plugin.downloadMediaToTempFile(job.controlledMediaUrl, {
        signal: activeController.signal,
        maxBytes: MAX_OPERATOR_MEDIA_BYTES,
      });
      if (typeof plugin.verifyOperatorControlledMediaFile !== 'function') {
        throw nodeError('OPERATOR_MEDIA_INTEGRITY_REQUIRED', '运营节点缺少受控媒体校验能力', { retryable: false });
      }
      await plugin.verifyOperatorControlledMediaFile(tempPath, job, { signal: activeController.signal });
      activeJob.stage = 'transcribing';
      activeJob.progress = 45;
      const runLocalAsr = typeof plugin.runOperatorLocalTranscription === 'function'
        ? plugin.runOperatorLocalTranscription.bind(plugin)
        : plugin.runLocalTranscription.bind(plugin);
      const result = await runLocalAsr(tempPath, {
        inputPath: tempPath,
        signal: activeController.signal,
        includeQualityDetails: true,
        recordId: '',
        sourceUrl: '',
        operatorNode: true,
      });
      const transcription = String(result && typeof result === 'object' ? result.transcription : result || '').trim();
      if (!transcription) throw nodeError('OPERATOR_ASR_EMPTY', '运营节点本地转写结果为空', { retryable: true });
      activeJob.progress = 100;
      stopHeartbeat();
      return await complete(job, {
        phase: 'asr',
        backend: 'local_whisper_cpp',
        outcome: 'succeeded',
        transcription,
      });
    } catch (error) {
      lastErrorCode = redactError(error).code;
      // /worker/media/complete atomically advances media -> ASR. Once that
      // request has been attempted, a generic /worker/complete failure would
      // target the wrong phase and could overwrite a server-side success.
      if (phase === 'media' && mediaCompletionAttempted) throw error;
      try {
        return await complete(job, failBody(error, activeJob && activeJob.stage, { shutdown: stopRequested }));
      } catch (completionError) {
        lastErrorCode = redactError(completionError).code;
        throw completionError;
      }
    } finally {
      stopHeartbeat();
      if (tempPath) {
        try { await fs.promises.rm(tempPath, { force: true }); } catch (_) { /* Temporary operator media is best-effort cleaned. */ }
      }
      activeController = null;
      activeJob = null;
      completedCount += 1;
    }
  };
  const poll = async () => {
    if (!running) return;
    // Callers that poll while a poll is already in flight (for example a
    // timer firing next to a manual wake) join the existing attempt instead
    // of receiving an undefined result.
    if (pollInFlight) return await pollInFlight;
    if (activeJob) return;
    pollInFlight = (async () => {
      lastPollAt = clock();
      let claimed = false;
      try {
        if (!capacityReady && !(await sendCapacityHeartbeat())) return;
        const response = await withCapabilityNegotiation(() => callApi('/transcriptions/fallback/worker/claim', {
          workerId: config.workerId,
          protocolVersion: WORKER_PROTOCOL_VERSION,
          capabilities: getCapabilities(),
          capacitySlots: 1,
          activeSlots: 0,
          limit: 1,
        }, { signal: null }));
        const jobs = normalizeJobs(response).slice(0, 1);
        if (jobs.length) {
          claimed = true;
          // A claim can resolve just after plugin shutdown. Release that lease
          // immediately instead of starting media/session work after stop().
          if (!running || stopRequested) {
            try {
              await complete(jobs[0], {
                phase: String(jobs[0] && jobs[0].phase || '').trim() || 'asr',
                backend: String(jobs[0] && jobs[0].backend || '').trim() || undefined,
                outcome: 'failed',
                error: {
                  code: 'OPERATOR_NODE_STOPPED',
                  message: '运营节点已停止，任务可由其他节点继续',
                  retryable: true,
                  stage: 'acquiring',
                },
              });
            } catch (completionError) {
              lastErrorCode = redactError(completionError).code;
            }
            return;
          }
          activePromise = processJob(jobs[0]).catch((error) => {
            lastErrorCode = redactError(error).code;
          }).finally(() => { activePromise = null; });
          await activePromise;
        }
      } catch (error) {
        lastErrorCode = redactError(error).code;
      } finally {
        pollInFlight = null;
        // An empty claim (or a failed one) slows down geometrically so an
        // always-on node does not spend CloudBase quota while the queue is
        // empty. Claiming work resets the interval immediately.
        idleRuns = claimed ? 0 : Math.min(idleRuns + 1, 3);
        const ceiling = Math.max(
          1000,
          Number(maxIdlePollIntervalMs) || DEFAULT_MAX_IDLE_POLL_INTERVAL_MS,
        );
        schedule(Math.min(ceiling, Math.max(1000, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS) * (2 ** idleRuns)));
      }
    })();
    return await pollInFlight;
  };
  return {
    config: { ...config, workerToken: undefined },
    isEnabled: () => config.enabled,
    getSnapshot: snapshot,
    start() {
      if (!config.enabled || running) return false;
      stopRequested = false;
      running = true;
      startCapacityHeartbeat();
      schedule(0);
      return true;
    },
    async stop() {
      running = false;
      stopRequested = true;
      if (pollTimer) clearTimer(pollTimer);
      pollTimer = null;
      stopCapacityHeartbeat();
      stopHeartbeat();
      if (activeController && !activeController.signal.aborted) activeController.abort();
      if (activePromise) await activePromise.catch(() => {});
      activePromise = null;
      activeController = null;
      activeJob = null;
      return snapshot();
    },
    poll,
  };
}

module.exports = {
  OPERATOR_NODE_ENABLED_ENV,
  OPERATOR_NODE_ID_ENV,
  OPERATOR_NODE_TOKEN_ENV,
  OPERATOR_NODE_API_BASE_ENV,
  WORKER_PROTOCOL_VERSION,
  DEFAULT_CAPABILITIES,
  XIAOHONGSHU_CAPABILITY,
  isDouyinSourceUrl,
  isXiaohongshuSourceUrl,
  resolveMediaSourcePlatform,
  isOperatorNodeEnabled,
  readOperatorNodeConfig,
  requestJsonViaNode,
  createOperatorMediaNode,
  classifyFailureReason,
};
