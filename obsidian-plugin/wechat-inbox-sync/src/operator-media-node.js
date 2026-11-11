'use strict';
const { reconcileOperatorDoubaoTasks } = require('./operator-doubao-task');

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
const WECHAT_ARTICLE_CAPABILITY = 'wechat_article';
const TOUTIAO_ARTICLE_CAPABILITY = 'toutiao_article';
const ZHIHU_ARTICLE_CAPABILITY = 'zhihu_article';
const WECHAT_CHANNELS_CAPABILITY = 'wechat_channels';
const BILIBILI_CAPABILITY = 'bilibili';
const XIAOYUZHOU_CAPABILITY = 'xiaoyuzhou';
const DOUBAO_CAPABILITY = 'doubao';
const MEDIA_TRANSCODE_CAPABILITY = 'media_transcode';
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
  const safeInteger = (value) => Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.min(Math.floor(Number(value)), Number.MAX_SAFE_INTEGER)
    : null;
  const bytesSent = safeInteger(error && error.bytesSent);
  const totalBytes = safeInteger(error && error.totalBytes);
  const elapsedMs = safeInteger(error && error.elapsedMs);
  return {
    code,
    ...(bytesSent !== null ? { bytesSent } : {}),
    ...(totalBytes !== null ? { totalBytes } : {}),
    ...(elapsedMs !== null ? { elapsedMs } : {}),
  };
}

// The server stores a bounded error envelope. Keep upload progress limited to
// numeric byte counts and elapsed time; never forward raw URLs, paths or text.
// The reason below is a fixed vocabulary derived from the error - never the
// raw message, which can carry URLs, cookies or page fragments.
const FAILURE_REASON_PATTERNS = [
  // More specific media-production failures come first: their messages often
  // contain the generic words the later patterns match.
  [/CLOUD_MEDIA_TRANSCODER_UNAVAILABLE|ffmpeg not found|缺少 ffmpeg/i, 'transcoder-missing'],
  [/CLOUD_MEDIA_TRANSCODE|TRANSCODE_FAILED|exit code -22/i, 'transcode-failed'],
  [/WORKER_OPERATION_TIMEOUT|操作超时/i, 'worker-timeout'],
  [/CLOUD_MEDIA_TOO_LARGE|TOO_LARGE/i, 'media-too-large'],
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
function isWechatArticleSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return /^https?:$/.test(url.protocol) && /^mp\.weixin\.qq\.com$/i.test(url.hostname);
  } catch (_) {
    return false;
  }
}

function isToutiaoSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (host === 'toutiao.com' || host.endsWith('.toutiao.com'))
      && (/\/(?:article|group|item)\/\d+\/?$/i.test(url.pathname)
        || /\/[ai]\d{6,}\/?$/i.test(url.pathname)
        || (url.protocol === 'https:' && !url.port && host === 'm.toutiao.com'
          && /^\/is\/[A-Za-z0-9_-]{4,128}\/?$/.test(url.pathname)));
  } catch (_) {
    return false;
  }
}

function isZhihuSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (host === 'zhihu.com' || host.endsWith('.zhihu.com'))
      && /\/(?:answer|p)\/\d+\/?$/i.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function isWechatChannelsSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    return /^channels\.weixin\.qq\.com$/i.test(url.hostname)
      || (/^weixin\.qq\.com$/i.test(url.hostname) && /^\/sph\//i.test(url.pathname));
  } catch (_) {
    return false;
  }
}

function hasOfficialHost(value, domains) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch (_) {
    return false;
  }
}

function isBilibiliSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      && (host === 'b23.tv' || host === 'bilibili.com' || host.endsWith('.bilibili.com'));
  } catch (_) {
    return false;
  }
}

function isXiaoyuzhouSourceUrl(value) {
  return hasOfficialHost(value, ['xiaoyuzhoufm.com', 'xiaoyuzhou.com']);
}

function resolveMediaSourcePlatform(job) {
  const sourceType = String(job && job.sourceType || '').trim().toLowerCase();
  const sourceUrl = String(job && job.sourceUrl || '').trim();
  if (sourceType === 'douyin_url' && isDouyinSourceUrl(sourceUrl)) return 'douyin';
  if (sourceType === 'xiaohongshu_url' && isXiaohongshuSourceUrl(sourceUrl)) return 'xiaohongshu';
  if (sourceType === 'wechat_article' && isWechatArticleSourceUrl(sourceUrl)) return 'wechat_article';
  if (sourceType === 'toutiao_article' && isToutiaoSourceUrl(sourceUrl)) return 'toutiao_article';
  if (sourceType === 'zhihu_article' && isZhihuSourceUrl(sourceUrl)) return 'zhihu_article';
  if (sourceType === 'wechat_channels_url' && isWechatChannelsSourceUrl(sourceUrl)) return 'wechat_channels';
  if (sourceType === 'bilibili_url' && isBilibiliSourceUrl(sourceUrl)) return 'bilibili';
  if (sourceType === 'xiaoyuzhou_url' && isXiaoyuzhouSourceUrl(sourceUrl)) return 'xiaoyuzhou';
  return '';
}

function createSingleOperatorMediaNode({
  lane = '',
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
    const body = { ...baseForJob(job), ...(activeJob && activeJob.providerRequestId ? { providerRequestId: activeJob.providerRequestId } : {}), stage: String(stage || '').slice(0, 64), progress: Math.max(0, Math.min(100, Number(progress) || 0)) };
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
  const transcribeCapturedMedia = async (job, inputPath) => {
    if (getCapabilities().includes('media_handoff')) {
      activeJob.stage = 'acquiring';
      activeJob.progress = 55;
      const uploaded = await plugin.uploadWorkerMediaForJob(inputPath, job, {
        signal: activeController.signal, workerConfig: config, request: callApi,
        beforeComplete: async () => { await heartbeat(job, 'acquiring', 90); },
      });
      stopHeartbeat();
      return uploaded.completion;
    }
    if (!plugin || typeof plugin.transcodeCloudFallbackMediaToMp3 !== 'function'
      || (typeof plugin.runOperatorLocalTranscription !== 'function' && typeof plugin.runLocalTranscription !== 'function')) {
      throw nodeError('OPERATOR_ASR_HANDLER_UNAVAILABLE', '运营节点本地转写能力未就绪', { retryable: true });
    }
    if (typeof plugin.isOperatorLocalAsrAvailable === 'function' && !plugin.isOperatorLocalAsrAvailable()) {
      throw nodeError('OPERATOR_ASR_BUSY', '运营节点本地转写正忙', { retryable: true });
    }
    const prepared = await plugin.transcodeCloudFallbackMediaToMp3(inputPath, { signal: activeController.signal });
    const asrPath = String(prepared && prepared.path || '').trim();
    if (!asrPath) throw nodeError('OPERATOR_MEDIA_TRANSCODE_EMPTY', '运营节点未准备好本地转写音频', { retryable: true });
    try {
      activeJob.stage = 'acquiring';
      activeJob.progress = 55;
      const runLocalAsr = typeof plugin.runOperatorLocalTranscription === 'function'
        ? plugin.runOperatorLocalTranscription.bind(plugin)
        : plugin.runLocalTranscription.bind(plugin);
      const result = await runLocalAsr(asrPath, {
        inputPath: asrPath,
        signal: activeController.signal,
        includeQualityDetails: true,
        recordId: '',
        sourceUrl: String(job && job.sourceUrl || ''),
        operatorNode: true,
      });
      const transcription = String(result && typeof result === 'object' ? result.transcription : result || '').trim();
      if (!transcription) throw nodeError('OPERATOR_ASR_EMPTY', '运营节点本地转写结果为空', { retryable: true });
      activeJob.progress = 100;
      stopHeartbeat();
      // URL jobs are completed by the Obsidian plugin node itself. The media
      // stays on that node; only the Markdown transcript returns to CloudBase.
      return await complete(job, {
        phase: 'media',
        backend: 'local_whisper_cpp',
        outcome: 'succeeded',
        transcription,
      });
    } finally {
      if (prepared && prepared.owned === true && asrPath !== inputPath) {
        try { await fs.promises.rm(asrPath, { force: true }); } catch (_) { /* Best-effort temp cleanup. */ }
      }
    }
  };
  // Optional capabilities are negotiated, never assumed. A deployment whose
  // node registry predates one of them rejects the whole worker request
  // (WORKER_CAPABILITY_FORBIDDEN), which would take the node offline the moment
  // a new plugin starts. Drop the rejected optional capability and retry, so an
  // older server keeps receiving everything the plugin already supported.
  const rejectedCapabilities = new Set();
  const getCapabilities = () => {
    const capabilities = ['media_acquire'];
    if (!rejectedCapabilities.has('media_handoff') && plugin && typeof plugin.uploadWorkerMediaForJob === 'function') capabilities.push('media_handoff');
    if (!rejectedCapabilities.has(XIAOHONGSHU_CAPABILITY)
      && plugin && typeof plugin.acquireOperatorXiaohongshuContent === 'function') {
      capabilities.push(XIAOHONGSHU_CAPABILITY);
    }
    // ffmpeg is what turns a downloaded video into the audio the ASR stage
    // needs. A node without it must not claim media jobs.
    if (!rejectedCapabilities.has(MEDIA_TRANSCODE_CAPABILITY)
      && plugin && typeof plugin.getLocalAsrInstallStatus === 'function') {
      try {
        const asrStatus = plugin.getLocalAsrInstallStatus();
        const systemFfmpeg = typeof plugin.resolveSystemFfmpegPath === 'function' ? plugin.resolveSystemFfmpegPath() : '';
        if ((asrStatus && asrStatus.ffmpegPath) || systemFfmpeg) capabilities.push(MEDIA_TRANSCODE_CAPABILITY);
      } catch (_error) { /* capability stays off */ }
    }
    if (!rejectedCapabilities.has(WECHAT_ARTICLE_CAPABILITY)
      && plugin && typeof plugin.acquireOperatorWechatArticleContent === 'function') {
      capabilities.push(WECHAT_ARTICLE_CAPABILITY);
    }
    if (!rejectedCapabilities.has(TOUTIAO_ARTICLE_CAPABILITY)
      && plugin && typeof plugin.acquireOperatorToutiaoArticleContent === 'function') {
      capabilities.push(TOUTIAO_ARTICLE_CAPABILITY);
    }
    if (!rejectedCapabilities.has(ZHIHU_ARTICLE_CAPABILITY)
      && plugin && typeof plugin.acquireOperatorZhihuArticleContent === 'function') {
      capabilities.push(ZHIHU_ARTICLE_CAPABILITY);
    }
    if (!rejectedCapabilities.has(WECHAT_CHANNELS_CAPABILITY)
      && plugin && typeof plugin.acquireOperatorWechatChannelsMediaToTempFile === 'function') {
      capabilities.push(WECHAT_CHANNELS_CAPABILITY);
    }
    if (!rejectedCapabilities.has(BILIBILI_CAPABILITY)
      && plugin && typeof plugin.hydrateBilibiliTranscript === 'function') capabilities.push(BILIBILI_CAPABILITY);
    if (!rejectedCapabilities.has(XIAOYUZHOU_CAPABILITY)
      && plugin && typeof plugin.hydrateXiaoyuzhouTranscript === 'function') capabilities.push(XIAOYUZHOU_CAPABILITY);
    // Doubao is available only when this node has a configured API key and the
    // plugin exposes the ASR handler. Never claim overflow work it cannot run.
    if (!rejectedCapabilities.has(DOUBAO_CAPABILITY)
      && plugin && typeof plugin.runOperatorDoubaoTranscription === 'function'
      && (typeof plugin.isOperatorDoubaoAvailable === 'function' ? plugin.isOperatorDoubaoAvailable() : plugin.settings && String(plugin.settings.doubaoAsrApiKey || '').trim())) {
      capabilities.push(DOUBAO_CAPABILITY);
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
    const offered = getCapabilities();
    try {
      return await send(offered);
    } catch (error) {
      if (!error || error.code !== 'WORKER_CAPABILITY_FORBIDDEN') throw error;
    }
    // Probe only the idempotent capacity endpoint, never the claim endpoint.
    // Do not remove earlier supported capabilities just because a later one
    // is forbidden. Publish the negotiated set only after the final heartbeat.
    const accepted = ['media_acquire'];
    const rejected = [];
    await send(accepted);
    for (const candidate of offered.filter(c => c !== 'media_acquire')) {
      try {
        await send([...accepted, candidate]);
        accepted.push(candidate);
      } catch (error) {
        if (!error || error.code !== 'WORKER_CAPABILITY_FORBIDDEN') throw error;
        rejected.push(candidate);
      }
    }
    const result = await send(accepted);
    for (const candidate of rejected) {
      rejectedCapabilities.add(candidate);
      lastErrorCode = 'WORKER_CAPABILITY_DOWNGRADED';
      try { logger({ type: 'capability-downgraded', capability: candidate }); } catch (_) { /* advisory */ }
    }
    return result;
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
        await withCapabilityNegotiation((capabilities) => {
          return callApi('/transcriptions/fallback/worker/capacity', {
            workerId: config.workerId,
            protocolVersion: WORKER_PROTOCOL_VERSION,
            capabilities,
            runtimeCapabilities: capabilities,
            availableCapabilities: capabilities,
            phases: ['media', 'asr'],
            capacitySlots: getCapabilities().includes('media_handoff') ? 3 : 1,
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
    outcome: activeJob && activeJob.submissionStarted && error?.providerDefinitive !== true ? 'submission_unknown' : shutdown ? 'failed' : error && error.noSpeech === true ? 'no_speech' : 'failed',
    ...(activeJob && activeJob.providerRequestId ? { providerRequestId: activeJob.providerRequestId } : {}),
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
      retryable: error && (error.linkExpired === true || error.retryable === false) ? false : true,
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
    if (phase === 'asr' && String(job.backend || '').trim() === DOUBAO_CAPABILITY
      && (!plugin || typeof plugin.runOperatorDoubaoTranscription !== 'function'
        || !(typeof plugin.isOperatorDoubaoAvailable === 'function' ? plugin.isOperatorDoubaoAvailable() : plugin.settings && String(plugin.settings.doubaoAsrApiKey || '').trim()))) {
      throw nodeError('OPERATOR_DOUBAO_ASR_UNAVAILABLE', '运营节点未配置可用的豆包转写能力', { retryable: true });
    }
    activeController = new AbortController();
    activeJob = { phase, backend: String(job.backend || '').trim(), stage: 'acquiring', progress: 5 };
    startHeartbeat(job);
    let tempPath = '';
    try {
      await heartbeat(job, 'acquiring', 5);
      if (phase === 'media' && mediaPlatform === 'xiaohongshu') {
        if (!plugin || typeof plugin.acquireOperatorXiaohongshuContent !== 'function') {
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
        return await transcribeCapturedMedia(job, tempPath);
      }
      if (phase === 'media' && mediaPlatform === 'wechat_article') {
        if (!plugin || typeof plugin.acquireOperatorWechatArticleContent !== 'function') {
          throw nodeError('OPERATOR_MEDIA_HANDLER_UNAVAILABLE', '运营节点公众号抓取能力未就绪', { retryable: true });
        }
        const article = await plugin.acquireOperatorWechatArticleContent(job.sourceUrl, { signal: activeController.signal });
        const articleContent = article && article.content;
        if (!articleContent || !String(articleContent.markdown || '').trim()) {
          throw nodeError('OPERATOR_WECHAT_ARTICLE_EMPTY', '运营节点未提取到公众号正文', { retryable: true });
        }
        activeJob.progress = 100;
        stopHeartbeat();
        return await complete(job, { phase: 'media', outcome: 'succeeded', content: articleContent });
      }
      if (phase === 'media' && mediaPlatform === 'toutiao_article') {
        if (!plugin || typeof plugin.acquireOperatorToutiaoArticleContent !== 'function') {
          throw nodeError('OPERATOR_MEDIA_HANDLER_UNAVAILABLE', '运营节点今日头条抓取能力未就绪', { retryable: true });
        }
        const article = await plugin.acquireOperatorToutiaoArticleContent(job.sourceUrl, { signal: activeController.signal });
        const articleContent = article && article.content;
        if (!articleContent || !String(articleContent.markdown || '').trim()) {
          throw nodeError('OPERATOR_TOUTIAO_ARTICLE_EMPTY', '运营节点未提取到今日头条正文', { retryable: true });
        }
        activeJob.progress = 100;
        stopHeartbeat();
        return await complete(job, { phase: 'media', outcome: 'succeeded', content: articleContent });
      }
      if (phase === 'media' && mediaPlatform === 'zhihu_article') {
        if (!plugin || typeof plugin.acquireOperatorZhihuArticleContent !== 'function') {
          throw nodeError('OPERATOR_MEDIA_HANDLER_UNAVAILABLE', '运营节点知乎抓取能力未就绪', { retryable: true });
        }
        const article = await plugin.acquireOperatorZhihuArticleContent(job.sourceUrl, { signal: activeController.signal });
        const articleContent = article && article.content;
        if (!articleContent || !String(articleContent.markdown || '').trim()) {
          throw nodeError('OPERATOR_ZHIHU_ARTICLE_EMPTY', '运营节点未提取到知乎正文', { retryable: true });
        }
        activeJob.progress = 100;
        stopHeartbeat();
        return await complete(job, { phase: 'media', outcome: 'succeeded', content: articleContent });
      }
      if (phase === 'media' && mediaPlatform === 'wechat_channels') {
        if (!plugin || typeof plugin.acquireOperatorWechatChannelsMediaToTempFile !== 'function') {
          throw nodeError('OPERATOR_MEDIA_HANDLER_UNAVAILABLE', '运营节点视频号原生提取能力未就绪', { retryable: true });
        }
        tempPath = await plugin.acquireOperatorWechatChannelsMediaToTempFile(job.sourceUrl, { signal: activeController.signal });
        if (!tempPath) throw nodeError('OPERATOR_MEDIA_ACQUIRE_EMPTY', '运营节点未能从视频号原链接获取媒体', { retryable: true });
        activeJob.progress = 45;
        return await transcribeCapturedMedia(job, tempPath);
      }
      if (phase === 'media' && ['bilibili', 'xiaoyuzhou'].includes(mediaPlatform)
        && getCapabilities().includes('media_handoff') && typeof plugin.acquireOperatorNativePlatformContent === 'function') {
        const captured = await plugin.acquireOperatorNativePlatformContent(mediaPlatform, job.sourceUrl, { signal: activeController.signal });
        if (captured.transcription) {
          stopHeartbeat();
          return await complete(job, { phase: 'media', outcome: 'succeeded', transcription: captured.transcription });
        }
        tempPath = captured.tempPath;
        if (!tempPath) throw nodeError('OPERATOR_MEDIA_ACQUIRE_EMPTY', '运营节点未取得音频', { retryable: true });
        return await transcribeCapturedMedia(job, tempPath);
      }
      if (phase === 'media' && ['bilibili', 'xiaoyuzhou'].includes(mediaPlatform)) {
        const methodName = mediaPlatform === 'bilibili' ? 'hydrateBilibiliTranscript' : 'hydrateXiaoyuzhouTranscript';
        if (!plugin || typeof plugin[methodName] !== 'function') {
          throw nodeError('OPERATOR_MEDIA_HANDLER_UNAVAILABLE', '运营节点原生平台提取能力未就绪', { retryable: true });
        }
        const sourceUrl = String(job.sourceUrl || '').trim();
        const sourceRecord = {
          _id: String(job.recordId || job.jobId),
          type: 'webpage',
          content: sourceUrl,
          metadata: { url: sourceUrl, title: String(job.title || ''), platform: mediaPlatform === 'bilibili' ? 'B站' : '小宇宙' },
        };
        const result = await plugin[methodName](sourceRecord, sourceUrl, null, String(job.title || ''), {
          signal: activeController.signal,
          forceLocal: true,
          operatorNode: true,
        });
        const metadata = result && result.metadata && typeof result.metadata === 'object' ? result.metadata : {};
        const transcription = String(metadata.transcription || '').trim();
        if (metadata.transcriptionStatus !== 'success' || !transcription) {
          throw nodeError('OPERATOR_NATIVE_TRANSCRIPTION_FAILED', String(metadata.transcriptionError || '运营节点原生平台转写未成功'), { retryable: true });
        }
        activeJob.progress = 100;
        stopHeartbeat();
        return await complete(job, { phase: 'media', backend: 'local_whisper_cpp', outcome: 'succeeded', transcription });
      }
      if (phase === 'media') {
        if (!plugin || typeof plugin.acquireOperatorDouyinMediaToTempFile !== 'function') {
          throw nodeError('OPERATOR_MEDIA_HANDLER_UNAVAILABLE', '运营节点媒体能力未就绪', { retryable: true });
        }
        // A Douyin graphic note has no media to download; its answer is the
        // note content, handled the same way as a Xiaohongshu graphic note.
        if (typeof plugin.acquireOperatorDouyinNoteContent === 'function') {
          let noteCapture = null;
          try {
            noteCapture = await plugin.acquireOperatorDouyinNoteContent(job.sourceUrl, { signal: activeController.signal });
          } catch (noteError) {
            if (noteError && noteError.name === 'AbortError') throw noteError;
            noteCapture = null;
          }
          if (noteCapture && noteCapture.content) {
            activeJob.progress = 100;
            stopHeartbeat();
            return await complete(job, { phase: 'media', outcome: 'succeeded', content: noteCapture.content });
          }
        }
        tempPath = await plugin.acquireOperatorDouyinMediaToTempFile(job.sourceUrl, { signal: activeController.signal });
        activeJob.progress = 45;
        return await transcribeCapturedMedia(job, tempPath);
      }
      if (String(job.backend || '').trim() === DOUBAO_CAPABILITY) {
        activeJob.stage = 'acquiring';
        activeJob.progress = 45;
        const result = await plugin.runOperatorDoubaoTranscription(String(job.controlledMediaUrl || '').trim(), {
          jobId: base.jobId,
          workerId: config.workerId, attemptId: base.attemptId, fencingVersion: base.fencingVersion,
          signal: activeController.signal,
          beforeSubmit: async providerRequestId => {
            activeJob.providerRequestId = providerRequestId;
            activeJob.stage = 'submitting';
            await heartbeat(job, 'submitting', 45);
            if (activeController.signal.aborted) throw Object.assign(new Error('Operator stopped'), { name: 'AbortError' });
          },
          beforePost: () => { activeJob.submissionStarted = true; },
        });
        if (result?.status === 'no_speech') {
          stopHeartbeat();
          const completed = await complete(job, { phase: 'asr', backend: DOUBAO_CAPABILITY, outcome: 'no_speech', providerRequestId: result.providerRequestId });
          if (typeof plugin.clearOperatorDoubaoTask === 'function') await plugin.clearOperatorDoubaoTask(base);
          return completed;
        }
        const transcription = String(result && typeof result === 'object' ? result.transcription : result || '').trim();
        if (!transcription) throw nodeError('OPERATOR_ASR_EMPTY', '运营节点豆包转写结果为空', { retryable: true });
        activeJob.progress = 100;
        stopHeartbeat();
        const completed = await complete(job, {
          phase: 'asr', backend: DOUBAO_CAPABILITY, outcome: 'succeeded', transcription,
          providerRequestId: result.providerRequestId,
          ...(Array.isArray(result.transcriptionSegments) && result.transcriptionSegments.length
            ? { transcriptionSegments: result.transcriptionSegments } : {}),
        });
        if (typeof plugin.clearOperatorDoubaoTask === 'function') {
          try { await plugin.clearOperatorDoubaoTask(base); } catch (_) { /* Server completion is durable. */ }
        }
        return completed;
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
  let recoveryCursor = 0;
  let recoveryController = null;
  const recoverProviderResults = async () => {
    if (!plugin || typeof plugin.getOperatorDoubaoPendingTasks !== 'function'
      || typeof plugin.queryOperatorDoubaoTranscription !== 'function' || typeof plugin.clearOperatorDoubaoTask !== 'function') return;
    const all = plugin.getOperatorDoubaoPendingTasks(config.workerId);
    if (!all.length) return;
    recoveryCursor %= all.length;
    const batch = [...all.slice(recoveryCursor), ...all.slice(0, recoveryCursor)].slice(0, 5);
    recoveryCursor = (recoveryCursor + batch.length) % all.length;
    recoveryController = new AbortController();
    await reconcileOperatorDoubaoTasks({ tasks: batch, workerId: config.workerId, signal: recoveryController.signal,
      onStatus: code => { lastErrorCode = code; try { logger({ type: "provider-reconciliation", code }); } catch (_) {} },
      query: id => plugin.queryOperatorDoubaoTranscription(id),
      reconcile: body => callApi('/transcriptions/fallback/worker/complete', body, { signal: null }),
      clear: task => plugin.clearOperatorDoubaoTask(task),
    });
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
        if (!lane || lane === 'doubao') await recoverProviderResults();
        if (!running || stopRequested) return;
        if (!capacityReady && !(await sendCapacityHeartbeat())) return;
        const offered = getCapabilities();
        if ((lane === 'local_asr' && !offered.includes('local_asr')) || (lane === 'doubao' && !offered.includes('doubao'))) return;
        const response = await callApi('/transcriptions/fallback/worker/claim', {
          ...(lane ? { phases: [lane === 'media' ? 'media' : 'asr'], backend: lane === 'media' ? '' : lane === 'local_asr' ? 'local_whisper_cpp' : 'doubao' } : {}),
          workerId: config.workerId,
          protocolVersion: WORKER_PROTOCOL_VERSION,
          capabilities: getCapabilities(),
          capacitySlots: getCapabilities().includes('media_handoff') ? 3 : 1,
          activeSlots: 0,
          limit: 1,
        }, { signal: null });
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
      if (recoveryController && !recoveryController.signal.aborted) recoveryController.abort();
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

// Each lane owns its own lease, abort controller and heartbeat. A long ASR
// request must never stop media acquisition or provider polling.
function createOperatorMediaNode(options = {}) {
  if (!options.plugin || typeof options.plugin.uploadWorkerMediaForJob !== 'function') return createSingleOperatorMediaNode(options);
  const lanes = ['media', 'local_asr', 'doubao'].map(lane => createSingleOperatorMediaNode({ ...options, lane }));
  return {
    config: lanes[0].config,
    isEnabled: () => lanes[0].isEnabled(),
    start: () => lanes.map(node => node.start()).some(Boolean),
    poll: () => Promise.all(lanes.map(node => node.poll())),
    stop: async () => { await Promise.all(lanes.map(node => node.stop())); return lanes[0].getSnapshot(); },
    getSnapshot: () => { const snapshots = lanes.map(node => node.getSnapshot()); return { ...snapshots[0], active: snapshots.some(s => s.active), queuedCount: snapshots.reduce((n,s)=>n+s.queuedCount,0), completedCount: snapshots.reduce((n,s)=>n+s.completedCount,0), lanes: snapshots }; },
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
  isWechatArticleSourceUrl,
  WECHAT_ARTICLE_CAPABILITY,
  isToutiaoSourceUrl,
  TOUTIAO_ARTICLE_CAPABILITY,
  MEDIA_TRANSCODE_CAPABILITY,
  DOUBAO_CAPABILITY,
  resolveMediaSourcePlatform,
  isOperatorNodeEnabled,
  readOperatorNodeConfig,
  requestJsonViaNode,
  redactError,
  createOperatorMediaNode,
  classifyFailureReason,
};
