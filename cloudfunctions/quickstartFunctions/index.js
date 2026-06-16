const cloud = require('wx-server-sdk');
const http = require('http');
const https = require('https');
const {
  createAdminRedeemCodeDocuments,
  normalizeAdminPositiveInteger,
  summarizeAdminDashboard,
} = require('./admin-core');
const {
  DAILY_SHARE_LIMIT,
  DAILY_AD_BONUS,
  createInboxRecordDocument,
  createBindCodeDocument,
  createBindStatusResponse,
  getBindCodeLookupCandidates,
  unbindClientFromCodeDocument,
  MAX_BIND_DEVICE_LIMIT,
  normalizeBindDeviceLimit,
  generateUniqueBindCode,
  buildDailyUsageDocument,
  buildUsageState,
  buildProUsageState,
  requiresProTranscriptionAccess,
} = require('./inbox-core');
const {
  buildFeishuFeedbackMessage,
  createFeedbackDocument,
  prepareFeedbackNotification,
} = require('./feedback-core');
const { buildPublicConfig } = require('./public-config-core');
const { processVoiceMetadata } = require('./voice-ai');
const {
  DEFAULT_REDEEM_PLAN,
  isLocalTranscriptionPlan,
  normalizeRedeemCode,
  isRedeemCodeActive,
  createRedeemCodeDocument,
  getBuiltInRedeemCodeDocument,
  createEntitlementDocument,
  buildEntitlementState,
  pickBestLocalTranscriptionEntitlement,
} = require('./redeem-code-core');
const {
  createPaymentOrderDocument,
  buildPaymentOrderState,
  createPaidEntitlementFromOrder,
} = require('./payment-core');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;
const REQUEST_TIMEOUT_MS = 10000;
const DOUBAO_ASR_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const DOUBAO_ASR_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
const DOUBAO_ASR_RESOURCE_ID = 'volc.bigasr.auc';
const DEFAULT_CLOUD_ASR_POLL_ATTEMPTS = 60;
const DEFAULT_CLOUD_ASR_POLL_INTERVAL_MS = 5000;
const CLOUD_TRANSCRIPTION_MIN_BILL_SECONDS = 60;
const MEDIA_RESOLVER_TIMEOUT_MS = 30000;
const CLOUD_TRANSCRIPTION_QUEUE_BATCH_SIZE = 3;
const CLOUD_TRANSCRIPTION_QUEUE_MAX_READ = 5000;
const CLOUD_TRANSCRIPTION_POLL_INTERVAL_MS = 60 * 1000;
const CLOUD_TRANSCRIPTION_MAX_POLL_ATTEMPTS = 240;

function collectRecordFileIds(record) {
  const metadata = (record && record.metadata) || {};
  return Array.from(new Set([metadata.audioFileID, metadata.fileID]
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
}

function buildSyncedRecordCleanupData({ syncedAt, fileIds = [], cleanupError = '' }) {
  return {
    status: 'synced',
    syncedAt,
    content: '',
    metadata: {
      cleanupStatus: cleanupError ? 'storage-delete-failed' : 'cleaned',
      cleanedAt: syncedAt,
      deletedFileCount: fileIds.length,
      cleanupError,
    },
  };
}

function formatCleanupError(error) {
  return error && error.message ? error.message : String(error || '');
}

async function ensureCollection(name) {
  if (typeof db.createCollection !== 'function') {
    return;
  }
  try {
    await db.createCollection(name);
  } catch (error) {
    // The collection already exists in normal use.
  }
}

function logDailyUsageError(error) {
  console.error('daily_usage unavailable:', error && (error.errMsg || error.message || error));
}

function buildFallbackUsageState(openid, now) {
  return {
    ...buildUsageState(buildDailyUsageDocument({ openid, now })),
    quotaUnavailable: true,
  };
}

function getDailyUsageDocumentId(openid, day) {
  return `${String(openid || '').replace(/[^A-Za-z0-9_-]/g, '_')}_${day}`;
}

function getChinaLocalDay(now = new Date().toISOString()) {
  const date = new Date(now);
  const time = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeAnalyticsEventName(value) {
  const eventName = String(value || '').trim();
  const allowedEvents = new Set([
    'app_visit',
    'bind_page_view',
    'bind_success',
  ]);
  return allowedEvents.has(eventName) ? eventName : '';
}

function getAnalyticsEventDocumentId(openid, eventName, day) {
  const safeOpenId = String(openid || '').replace(/[^A-Za-z0-9_-]/g, '_');
  return `analytics_${eventName}_${day}_${safeOpenId}`;
}

async function trackAnalyticsEvent(event) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const eventName = normalizeAnalyticsEventName(event.eventName);
  if (!openid || !eventName) {
    return {
      success: false,
      errMsg: 'invalid analytics event',
    };
  }

  await ensureCollection('analytics_events');
  const now = new Date().toISOString();
  const day = getChinaLocalDay(now);
  const documentId = getAnalyticsEventDocumentId(openid, eventName, day);
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  try {
    await db.collection('analytics_events').add({
      data: {
        _id: documentId,
        openid,
        eventName,
        day,
        count: 1,
        firstAt: now,
        lastAt: now,
        payload,
      },
    });
  } catch (error) {
    await db.collection('analytics_events').doc(documentId).update({
      data: {
        count: _.inc(1),
        lastAt: now,
        payload,
      },
    });
  }

  return {
    success: true,
    data: {
      eventName,
      day,
    },
  };
}

async function getCloudRuntimeConfigStatus() {
  return {
    success: true,
    data: getCloudRuntimeConfigStatusData(),
  };
}

function getCloudRuntimeConfigStatusData() {
  const doubaoKey = String(process.env.DOUBAO_ASR_API_KEY || '').trim();
  const mediaResolverUrl = getMediaResolverUrl();
  const mediaResolverSecret = getMediaResolverSecret();
  return {
    doubaoAsrApiKeyConfigured: Boolean(doubaoKey),
    doubaoAsrApiKeyLength: doubaoKey.length,
    mediaResolverUrlConfigured: Boolean(mediaResolverUrl),
    mediaResolverSecretConfigured: Boolean(mediaResolverSecret),
    checkedAt: new Date().toISOString(),
  };
}

async function tryGetTodayUsage(openid, now) {
  try {
    return await getTodayUsage(openid, now);
  } catch (error) {
    logDailyUsageError(error);
    return null;
  }
}

async function getOpenId() {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
}

async function getMiniProgramCode() {
  const resp = await cloud.openapi.wxacode.get({
    path: 'pages/index/index',
  });
  const upload = await cloud.uploadFile({
    cloudPath: 'code.png',
    fileContent: resp.buffer,
  });
  return upload.fileID;
}

async function getAudioTempURL(fileID) {
  const result = await cloud.getTempFileURL({
    fileList: [fileID],
  });
  const file = result.fileList && result.fileList[0];
  return file && file.tempFileURL ? file.tempFileURL : '';
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getHtmlAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const match = String(tag || '').match(pattern);
  if (!match) return '';
  return decodeHtmlAttribute(String(match[1] || '').replace(/^['"]|['"]$/g, '').trim());
}

function resolveMediaUrl(url, baseUrl) {
  const value = decodeHtmlAttribute(url).trim();
  if (!value) return '';
  if (isHttpUrl(value)) return value;
  try {
    return new URL(value, baseUrl).toString();
  } catch (error) {
    return '';
  }
}

function extractCloudPreTranscriptionMediaUrl(html, pageUrl) {
  const source = String(html || '');
  const metaPattern = /<meta\b[^>]*>/gi;
  let match;
  while ((match = metaPattern.exec(source))) {
    const tag = match[0];
    const key = `${getHtmlAttribute(tag, 'property')} ${getHtmlAttribute(tag, 'name')}`.toLowerCase();
    if (
      key.includes('og:video')
      || key.includes('og:audio')
      || key.includes('twitter:player:stream')
      || key.includes('twitter:video')
      || key.includes('twitter:audio')
    ) {
      const content = resolveMediaUrl(getHtmlAttribute(tag, 'content'), pageUrl);
      if (content) return content;
    }
  }

  const mediaPattern = /<(?:video|audio|source)\b[^>]*\bsrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
  while ((match = mediaPattern.exec(source))) {
    const mediaUrl = resolveMediaUrl(String(match[1] || '').replace(/^['"]|['"]$/g, ''), pageUrl);
    if (mediaUrl) return mediaUrl;
  }

  return '';
}

function fetchTextUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (!isHttpUrl(url)) {
      reject(new Error('Invalid webpage URL'));
      return;
    }
    const parsed = new URL(url);
    const req = https.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 WeChatInboxSync/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, (res) => {
      const location = res.headers && res.headers.location;
      if ([301, 302, 303, 307, 308].includes(Number(res.statusCode)) && location && redirectCount < 3) {
        res.resume();
        resolve(fetchTextUrl(new URL(location, url).toString(), redirectCount + 1));
        return;
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        reject(new Error(`Webpage fetch failed: HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Webpage fetch timed out'));
    });
  });
}

function getMediaResolverUrl() {
  return String(process.env.MEDIA_RESOLVER_URL || '').trim();
}

function getMediaResolverSecret() {
  return String(process.env.MEDIA_RESOLVER_SECRET || '').trim();
}

function normalizeResolverMediaUrl(mediaUrl, resolverUrl, data = {}) {
  const value = String(mediaUrl || '').trim();
  if (!value || !isHttpUrl(value)) return value;
  if (!data.proxied) return value;
  try {
    const media = new URL(value);
    const resolver = new URL(resolverUrl);
    if (media.pathname.startsWith('/media/') && resolver.protocol === 'https:') {
      return `${resolver.origin}${media.pathname}${media.search}`;
    }
  } catch (error) {
    return value;
  }
  return value;
}

async function requestMediaResolver(pageUrl, record = {}) {
  const resolverUrl = getMediaResolverUrl();
  if (!resolverUrl || !isHttpUrl(resolverUrl) || !isHttpUrl(pageUrl)) {
    return null;
  }
  const secret = getMediaResolverSecret();
  const headers = secret ? { 'x-resolver-secret': secret } : {};
  const response = await postJson({
    url: resolverUrl,
    headers,
    body: {
      url: pageUrl,
      recordId: record && record._id ? record._id : '',
    },
    timeoutMs: MEDIA_RESOLVER_TIMEOUT_MS,
  });
  if (response.status && response.status >= 200 && response.status < 300) {
    const data = response.json && response.json.data;
    const mediaUrl = normalizeResolverMediaUrl(data && data.mediaUrl, resolverUrl, data || {});
    if (mediaUrl) {
      return {
        audioUrl: mediaUrl,
        mediaUrl,
        source: String(data.source || 'media-resolver'),
        title: String(data.title || ''),
        durationSeconds: Number(data.durationSeconds || 0) || 0,
        originalMediaUrl: String(data.originalMediaUrl || ''),
        proxied: Boolean(data.proxied),
      };
    }
  }
  const errorPayload = response.json || {};
  const errMsg = errorPayload.errMsg || response.text || `HTTP ${response.status}`;
  throw new Error(`网页音视频解析服务失败：${String(errMsg).slice(0, 200)}`);
}

async function resolveWebpageAudioUrl(pageUrl, record = {}) {
  let resolverError = '';
  try {
    const resolved = await requestMediaResolver(pageUrl, record);
    if (resolved && resolved.audioUrl) {
      return resolved;
    }
  } catch (error) {
    resolverError = error.message || String(error);
  }

  const html = await fetchTextUrl(pageUrl);
  const audioUrl = extractCloudPreTranscriptionMediaUrl(html, pageUrl);
  if (audioUrl) {
    return {
      audioUrl,
      mediaUrl: audioUrl,
      source: 'html',
      title: '',
      durationSeconds: 0,
      resolverError,
    };
  }

  if (resolverError) {
    throw new Error(`${resolverError}；静态页面也未提取到可转写地址`);
  }
  throw new Error('未能从网页中提取到可转写的音视频地址');
}

function shouldPrepareAudioTempURL() {
  return Boolean(process.env.OPENAI_API_KEY)
    || String(process.env.VOICE_AI_PROVIDER || '').toLowerCase() === 'openai';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson(text) {
  try {
    return JSON.parse(String(text || ''));
  } catch (error) {
    return null;
  }
}

function getAudioFormatFromUrl(url) {
  const clean = String(url || '').split('?')[0].split('#')[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1] : '';
  if (['mp3', 'wav', 'm4a', 'mp4', 'aac', 'ogg', 'flac', 'webm'].includes(ext)) return ext;
  return 'mp3';
}

function getHttpHeader(headers, name) {
  if (!headers || !name) return '';
  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find((item) => String(item).toLowerCase() === target);
  return key ? headers[key] : '';
}

function postJson({ url, headers = {}, body = {}, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const rawBody = JSON.stringify(body || {});
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request({
      method: 'POST',
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(rawBody),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers || {},
          text,
          json: tryParseJson(text),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Cloud transcription request timed out'));
    });
    req.end(rawBody);
  });
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildDoubaoSubmitRequest({ apiKey, audioUrl, requestId }) {
  return {
    url: DOUBAO_ASR_SUBMIT_URL,
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': DOUBAO_ASR_RESOURCE_ID,
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: {
      user: {
        uid: 'wechat-inbox-sync-cloud',
      },
      audio: {
        url: audioUrl,
        format: getAudioFormatFromUrl(audioUrl),
        codec: 'raw',
        rate: 16000,
        bits: 16,
        channel: 1,
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false,
        enable_speaker_info: true,
        enable_channel_split: false,
        show_utterances: true,
        vad_segment: false,
        sensitive_words_filter: '',
      },
    },
  };
}

function buildDoubaoQueryRequest({ apiKey, requestId }) {
  return {
    url: DOUBAO_ASR_QUERY_URL,
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': DOUBAO_ASR_RESOURCE_ID,
      'X-Api-Request-Id': requestId,
    },
    body: {},
  };
}

function formatDoubaoHttpError(response) {
  const parts = [`Doubao ASR request failed: HTTP ${response && response.status}`];
  ['x-api-status-code', 'x-api-message', 'x-api-request-id'].forEach((name) => {
    const value = getHttpHeader(response && response.headers, name);
    if (value) parts.push(`${name}=${value}`);
  });
  const body = String((response && (response.text || JSON.stringify(response.json || ''))) || '').trim();
  if (body) parts.push(body.slice(0, 500));
  return parts.join('; ');
}

function normalizeDoubaoSpeakerText(result) {
  if (!result || typeof result !== 'object') return '';
  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  if (!utterances.length) return '';
  return utterances
    .map((item) => {
      const text = String((item && (item.text || item.result_text || item.utterance_text)) || '').trim();
      if (!text) return '';
      const additions = item && item.additions && typeof item.additions === 'object' ? item.additions : {};
      const speaker = item && (
        item.speaker
        || item.speaker_id
        || item.spk
        || item.speakerId
        || additions.speaker
        || additions.speaker_id
        || additions.spk
        || additions.speakerId
      );
      return speaker === undefined || speaker === null || speaker === ''
        ? text
        : `说话人${speaker}：${text}`;
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function normalizeDoubaoTimeToSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 1000 ? Math.ceil(number / 1000) : Math.ceil(number);
}

function getDoubaoUtteranceEndSeconds(item = {}) {
  const additions = item && item.additions && typeof item.additions === 'object' ? item.additions : {};
  return normalizeDoubaoTimeToSeconds(
    item.end_time
    || item.endTime
    || item.end
    || item.end_ms
    || item.endMs
    || additions.end_time
    || additions.endTime
    || additions.end
    || additions.end_ms
    || additions.endMs
  );
}

function getDoubaoResultDurationSeconds(result) {
  if (!result || typeof result !== 'object') return 0;
  const directDuration = normalizeDoubaoTimeToSeconds(
    result.duration
    || result.duration_ms
    || result.durationMs
    || result.audio_duration
    || result.audioDuration
  );
  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  const utteranceDuration = utterances.reduce((maxValue, item) => Math.max(maxValue, getDoubaoUtteranceEndSeconds(item)), 0);
  return Math.max(directDuration, utteranceDuration);
}

function getDoubaoPayloadDurationSeconds(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const result = data && data.result;
  if (Array.isArray(result)) {
    return result.reduce((maxValue, item) => Math.max(maxValue, getDoubaoResultDurationSeconds(item)), 0);
  }
  return getDoubaoResultDurationSeconds(result || data);
}

function parseDoubaoResult(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const result = data && data.result;
  if (Array.isArray(result)) {
    return result
      .map((item) => normalizeDoubaoSpeakerText(item) || String((item && (item.text || item.result_text || item.utterance_text)) || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  const speakerText = normalizeDoubaoSpeakerText(result);
  if (speakerText) return speakerText;
  const text = (result && (result.text || result.result_text))
    || (data && (data.text || data.transcription))
    || '';
  return String(text || '').trim();
}

function parseDoubaoTaskState(response) {
  if (response.status && (response.status < 200 || response.status >= 300)) {
    throw new Error(formatDoubaoHttpError(response));
  }
  const statusCode = getHttpHeader(response.headers, 'x-api-status-code');
  if (statusCode && statusCode !== '20000000') {
    if (statusCode === '20000001' || statusCode === '20000002') {
      return {
        status: 'processing',
        transcription: '',
      };
    }
    throw new Error(formatDoubaoHttpError(response));
  }
  const transcription = parseDoubaoResult(response.json || response.text);
  return {
    status: transcription ? 'success' : 'empty',
    transcription,
    durationSeconds: getDoubaoPayloadDurationSeconds(response.json || response.text),
  };
}

async function runDoubaoCloudTranscription(audioUrl, options = {}) {
  const apiKey = String((options.env || process.env || {}).DOUBAO_ASR_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('DOUBAO_ASR_API_KEY is not configured');
  }
  const requestId = createRequestId();
  const submit = buildDoubaoSubmitRequest({ apiKey, audioUrl, requestId });
  const submitResponse = await postJson(submit);
  const submitState = parseDoubaoTaskState(submitResponse);
  if (submitState.status === 'success') {
    return {
      transcription: submitState.transcription,
      durationSeconds: submitState.durationSeconds || 0,
      requestId,
      provider: 'doubao',
    };
  }

  const attempts = Math.max(1, Number(process.env.CLOUD_ASR_POLL_ATTEMPTS) || DEFAULT_CLOUD_ASR_POLL_ATTEMPTS);
  const intervalMs = Math.max(1000, Number(process.env.CLOUD_ASR_POLL_INTERVAL_MS) || DEFAULT_CLOUD_ASR_POLL_INTERVAL_MS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(intervalMs);
    const query = buildDoubaoQueryRequest({ apiKey, requestId });
    const queryResponse = await postJson(query);
    const state = parseDoubaoTaskState(queryResponse);
    if (state.status === 'success') {
      return {
        transcription: state.transcription,
        durationSeconds: state.durationSeconds || 0,
        requestId,
        provider: 'doubao',
      };
    }
  }
  throw new Error('Doubao ASR is still processing, please retry later');
}

async function submitDoubaoCloudTranscription(audioUrl, options = {}) {
  const apiKey = String((options.env || process.env || {}).DOUBAO_ASR_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('DOUBAO_ASR_API_KEY is not configured');
  }
  const requestId = createRequestId();
  const submit = buildDoubaoSubmitRequest({ apiKey, audioUrl, requestId });
  const submitResponse = await postJson(submit);
  const submitState = parseDoubaoTaskState(submitResponse);
  if (submitState.status === 'success') {
    return {
      complete: true,
      transcription: submitState.transcription,
      durationSeconds: submitState.durationSeconds || 0,
      requestId,
      provider: 'doubao',
    };
  }
  return {
    complete: false,
    transcription: '',
    durationSeconds: 0,
    requestId,
    provider: 'doubao',
  };
}

async function queryDoubaoCloudTranscription(requestId, options = {}) {
  const apiKey = String((options.env || process.env || {}).DOUBAO_ASR_API_KEY || '').trim();
  const safeRequestId = String(requestId || '').trim();
  if (!apiKey) {
    throw new Error('DOUBAO_ASR_API_KEY is not configured');
  }
  if (!safeRequestId) {
    throw new Error('Doubao ASR request id is missing');
  }
  const query = buildDoubaoQueryRequest({ apiKey, requestId: safeRequestId });
  const queryResponse = await postJson(query);
  const state = parseDoubaoTaskState(queryResponse);
  if (state.status === 'success') {
    return {
      complete: true,
      transcription: state.transcription,
      durationSeconds: state.durationSeconds || 0,
      requestId: safeRequestId,
      provider: 'doubao',
    };
  }
  if (state.status === 'processing') {
    return {
      complete: false,
      transcription: '',
      durationSeconds: 0,
      requestId: safeRequestId,
      provider: 'doubao',
    };
  }
  throw new Error('Doubao ASR returned empty result');
}

function getBillableCloudSeconds(durationMs) {
  const seconds = Math.ceil((Number(durationMs) || 0) / 1000);
  return Math.max(CLOUD_TRANSCRIPTION_MIN_BILL_SECONDS, seconds);
}

function getBillableCloudSecondsFromResult(metadata = {}, result = {}) {
  const metadataSeconds = Math.ceil((Number(metadata.duration) || 0) / 1000);
  const resultSeconds = Math.ceil(Number(result.durationSeconds) || 0);
  return Math.max(CLOUD_TRANSCRIPTION_MIN_BILL_SECONDS, metadataSeconds, resultSeconds);
}

function getCloudQuotaState(entitlement, billableSeconds) {
  const state = buildEntitlementState(entitlement);
  return {
    ...state,
    billableSeconds,
    hasEnoughQuota: state.cloudRemainingSeconds >= billableSeconds,
  };
}

async function getTodayUsage(openid, now) {
  await ensureCollection('daily_usage');
  const base = buildDailyUsageDocument({ openid, now });
  const result = await db.collection('daily_usage')
    .where({
      openid,
      day: base.day,
    })
    .limit(1)
    .get();

  if (result.data && result.data[0]) return result.data[0];

  const documentId = getDailyUsageDocumentId(openid, base.day);
  try {
    const created = await db.collection('daily_usage').add({
      data: {
        _id: documentId,
        ...base,
      },
    });
    return {
      _id: created._id || documentId,
      ...base,
    };
  } catch (error) {
    const retryResult = await db.collection('daily_usage')
      .where({
        openid,
        day: base.day,
      })
      .limit(1)
      .get();
    if (retryResult.data && retryResult.data[0]) return retryResult.data[0];
    throw error;
  }
}

async function getDailyUsage() {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();
  const entitlement = await getUserEntitlement(wxContext.OPENID, DEFAULT_REDEEM_PLAN);
  if (buildEntitlementState(entitlement, now).hasAccess) {
    return {
      success: true,
      data: buildProUsageState(),
    };
  }
  const usage = await tryGetTodayUsage(wxContext.OPENID, now);
  return {
    success: true,
    data: usage ? buildUsageState(usage) : buildFallbackUsageState(wxContext.OPENID, now),
  };
}

async function consumeDailyQuota(openid, now) {
  const usage = await tryGetTodayUsage(openid, now);
  if (!usage) {
    return buildFallbackUsageState(openid, now);
  }
  const state = buildUsageState(usage);
  if (state.used >= state.limit) {
    const error = new Error('今日免费同步次数已用完');
    error.code = 'DAILY_QUOTA_EXCEEDED';
    error.quota = state;
    throw error;
  }

  const updateResult = await db.collection('daily_usage')
    .where({
      _id: usage._id,
      used: _.lt(state.limit),
    })
    .update({
      data: {
        used: _.inc(1),
        updatedAt: now,
      },
    });

  if (!updateResult.stats || updateResult.stats.updated === 0) {
    const error = new Error('今日免费同步次数已用完');
    error.code = 'DAILY_QUOTA_EXCEEDED';
    error.quota = {
      ...state,
      used: state.limit,
      remaining: 0,
    };
    throw error;
  }

  return {
    ...state,
    used: state.used + 1,
    remaining: Math.max(0, state.limit - state.used - 1),
  };
}

async function unlockDailyUsageByShare() {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();
  const usage = await tryGetTodayUsage(wxContext.OPENID, now);
  if (!usage) {
    return {
      success: false,
      errMsg: '今日次数服务暂不可用，请稍后再试',
      data: buildFallbackUsageState(wxContext.OPENID, now),
    };
  }
  const nextLimit = Math.max(Number(usage.limit) || 0, DAILY_SHARE_LIMIT);
  await db.collection('daily_usage').doc(usage._id).update({
    data: {
      limit: nextLimit,
      shareUnlocked: true,
      updatedAt: now,
    },
  });
  return {
    success: true,
    data: buildUsageState({
      ...usage,
      limit: nextLimit,
      shareUnlocked: true,
    }),
  };
}

async function unlockDailyUsageByAd() {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();
  const usage = await tryGetTodayUsage(wxContext.OPENID, now);
  if (!usage) {
    return {
      success: false,
      errMsg: '今日次数服务暂不可用，请稍后再试',
      data: buildFallbackUsageState(wxContext.OPENID, now),
    };
  }
  const nextLimit = (Number(usage.limit) || 0) + DAILY_AD_BONUS;
  const nextAdUnlockCount = (Number(usage.adUnlockCount) || 0) + 1;
  await db.collection('daily_usage').doc(usage._id).update({
    data: {
      limit: nextLimit,
      adUnlockCount: nextAdUnlockCount,
      updatedAt: now,
    },
  });
  return {
    success: true,
    data: buildUsageState({
      ...usage,
      limit: nextLimit,
      adUnlockCount: nextAdUnlockCount,
    }),
  };
}

async function getUserEntitlement(openid, plan = DEFAULT_REDEEM_PLAN) {
  await ensureCollection('user_entitlements');
  if (plan && plan !== DEFAULT_REDEEM_PLAN) {
    const result = await db.collection('user_entitlements')
      .where({
        openid,
        plan,
        status: 'active',
      })
      .orderBy('redeemedAt', 'desc')
      .limit(1)
      .get();
    return result.data && result.data[0] ? result.data[0] : null;
  }

  const result = await db.collection('user_entitlements')
    .where({
      openid,
      status: 'active',
    })
    .orderBy('redeemedAt', 'desc')
    .limit(20)
    .get();
  return pickBestLocalTranscriptionEntitlement(result.data || []);
}

async function getUserTranscriptionSettings(openid) {
  await ensureCollection('user_transcription_settings');
  const result = await db.collection('user_transcription_settings')
    .where({ openid })
    .limit(1)
    .get();
  const settings = result.data && result.data[0] ? result.data[0] : null;
  return {
    enabled: Boolean(settings && settings.cloudPreTranscriptionEnabled),
    thresholdMinutes: Number(settings && settings.cloudPreTranscriptionThresholdMinutes) || 10,
  };
}

function getRedeemCodeSortTime(item = {}) {
  return String(item.lastRedeemedAt || item.redeemedAt || item.activatedAt || item.updatedAt || item.createdAt || '');
}

function pickLatestRedeemCodeDocument(items = []) {
  return (items || [])
    .filter((item) => normalizeRedeemCode(item.code))
    .sort((a, b) => getRedeemCodeSortTime(b).localeCompare(getRedeemCodeSortTime(a)))[0] || null;
}

async function findRedeemCodeForOpenid(openid) {
  const safeOpenid = String(openid || '').trim();
  if (!safeOpenid) return null;

  await ensureCollection('redeem_codes');
  const codeMatches = [];
  const redeemCodeOpenidFields = [
    'lastRedeemedOpenId',
    'redeemedOpenId',
    'openid',
    'openId',
    'userOpenId',
  ];
  for (const field of redeemCodeOpenidFields) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await db.collection('redeem_codes')
        .where({ [field]: safeOpenid })
        .limit(50)
        .get();
      codeMatches.push(...(result.data || []));
    } catch (error) {
      // 兼容历史字段，不让单个兜底查询影响权限状态读取。
    }
  }

  const codeDoc = pickLatestRedeemCodeDocument(codeMatches);
  if (codeDoc) return codeDoc;

  await ensureCollection('user_entitlements');
  try {
    const entitlementResult = await db.collection('user_entitlements')
      .where({ openid: safeOpenid })
      .limit(50)
      .get();
    return pickLatestRedeemCodeDocument((entitlementResult.data || [])
      .filter((item) => isLocalTranscriptionPlan(item.plan)));
  } catch (error) {
    return null;
  }
}

async function hydrateEntitlementWithRedeemCode(openid, entitlement) {
  if (!entitlement || normalizeRedeemCode(entitlement.code)) {
    return entitlement;
  }

  const codeDoc = await findRedeemCodeForOpenid(openid);
  const code = normalizeRedeemCode(codeDoc && codeDoc.code);
  if (!code) {
    return entitlement;
  }

  const now = new Date().toISOString();
  const hydrated = {
    ...entitlement,
    code,
    source: 'redeem_code',
    durationDays: Number(codeDoc.durationDays) || Number(entitlement.durationDays) || 0,
  };
  if (entitlement._id) {
    try {
      await db.collection('user_entitlements').doc(entitlement._id).update({
        data: {
          code,
          source: 'redeem_code',
          durationDays: hydrated.durationDays,
          updatedAt: now,
        },
      });
    } catch (error) {
      // 回填失败不影响用户查看当前权限状态。
    }
  }

  return hydrated;
}

async function getEntitlementStatus(event) {
  const wxContext = cloud.getWXContext();
  const plan = String(event.plan || DEFAULT_REDEEM_PLAN).trim() || DEFAULT_REDEEM_PLAN;
  const entitlement = await getUserEntitlement(wxContext.OPENID, plan);
  const hydratedEntitlement = event && event.includeRedeemCode
    ? await hydrateEntitlementWithRedeemCode(wxContext.OPENID, entitlement)
    : entitlement;
  return {
    success: true,
    data: buildEntitlementState(hydratedEntitlement),
  };
}

async function redeemAccessCode(event) {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();
  const code = normalizeRedeemCode(event.code);
  if (!code) {
    throw new Error('请输入兑换码');
  }

  await ensureCollection('redeem_codes');
  await ensureCollection('user_entitlements');

  const existingEntitlementResult = await db.collection('user_entitlements')
    .where({
      openid: wxContext.OPENID,
      code,
      status: 'active',
    })
    .limit(1)
    .get();
  const existingEntitlement = existingEntitlementResult.data && existingEntitlementResult.data[0]
    ? existingEntitlementResult.data[0]
    : null;
  if (existingEntitlement) {
    return {
      success: true,
      data: {
        ...buildEntitlementState(existingEntitlement),
        alreadyRedeemed: true,
      },
    };
  }

  const codeEntitlementResult = await db.collection('user_entitlements')
    .where({
      code,
      status: 'active',
    })
    .limit(1)
    .get();
  const codeEntitlement = codeEntitlementResult.data && codeEntitlementResult.data[0]
    ? codeEntitlementResult.data[0]
    : null;
  if (codeEntitlement && codeEntitlement.openid !== wxContext.OPENID) {
    const error = new Error('兑换码无效、已过期或已被使用');
    error.code = 'INVALID_REDEEM_CODE';
    throw error;
  }

  const codeResult = await db.collection('redeem_codes')
    .where({ code })
    .limit(1)
    .get();
  const codeDoc = codeResult.data && codeResult.data[0]
    ? codeResult.data[0]
    : getBuiltInRedeemCodeDocument(code, now);
  if (!isRedeemCodeActive(codeDoc, now)) {
    const error = new Error('兑换码无效、已过期或已被使用');
    error.code = 'INVALID_REDEEM_CODE';
    throw error;
  }
  if (codeDoc.trialOwnerOpenid && codeDoc.trialOwnerOpenid !== wxContext.OPENID) {
    const error = new Error('兑换码无效、已过期或已被使用');
    error.code = 'INVALID_REDEEM_CODE';
    throw error;
  }

  const plan = codeDoc.plan || DEFAULT_REDEEM_PLAN;
  const entitlement = createEntitlementDocument({
    openid: wxContext.OPENID,
    codeDoc,
    now,
  });

  const currentPlanEntitlement = await getUserEntitlement(wxContext.OPENID, plan);
  if (currentPlanEntitlement) {
    await db.collection('user_entitlements').doc(currentPlanEntitlement._id).update({
      data: entitlement,
    });
  } else {
    await db.collection('user_entitlements').add({ data: entitlement });
  }

  const codeUpdateData = {
    redeemedCount: _.inc(1),
    deliveryStatus: 'activated',
    activatedAt: now,
    lastRedeemedAt: now,
    lastRedeemedOpenId: wxContext.OPENID,
    status: 'redeemed',
    updatedAt: now,
  };
  if (codeDoc._id) {
    await db.collection('redeem_codes').doc(codeDoc._id).update({
      data: codeUpdateData,
    });
  }

  return {
    success: true,
    data: buildEntitlementState(entitlement),
  };
}

async function activateTrialRedeemCode({ openid, codeDoc, now }) {
  const code = normalizeRedeemCode(codeDoc && codeDoc.code);
  if (!openid) throw new Error('OpenID is required');
  if (!code) throw new Error('Redeem code is required');

  const existingEntitlementResult = await db.collection('user_entitlements')
    .where({
      openid,
      code,
      status: 'active',
    })
    .limit(1)
    .get();
  const existingEntitlement = existingEntitlementResult.data && existingEntitlementResult.data[0]
    ? existingEntitlementResult.data[0]
    : null;
  if (existingEntitlement) {
    return {
      entitlement: existingEntitlement,
      alreadyActivated: true,
    };
  }

  const entitlement = createEntitlementDocument({
    openid,
    codeDoc,
    now,
  });
  const currentLocalEntitlement = await getUserEntitlement(openid, DEFAULT_REDEEM_PLAN);
  if (
    currentLocalEntitlement
    && buildEntitlementState(currentLocalEntitlement, now).hasAccess
    && new Date(currentLocalEntitlement.expiresAt || 0).getTime() >= new Date(entitlement.expiresAt || 0).getTime()
  ) {
    return {
      entitlement: currentLocalEntitlement,
      alreadyActivated: true,
      preservedExistingEntitlement: true,
    };
  }

  const plan = codeDoc.plan || DEFAULT_REDEEM_PLAN;
  const currentPlanEntitlement = await getUserEntitlement(openid, plan);
  if (currentPlanEntitlement) {
    await db.collection('user_entitlements').doc(currentPlanEntitlement._id).update({
      data: entitlement,
    });
  } else {
    await db.collection('user_entitlements').add({ data: entitlement });
  }

  if (codeDoc._id && codeDoc.status !== 'redeemed') {
    await db.collection('redeem_codes').doc(codeDoc._id).update({
      data: {
        redeemedCount: _.inc(1),
        deliveryStatus: 'activated',
        activatedAt: now,
        lastRedeemedAt: now,
        lastRedeemedOpenId: openid,
        status: 'redeemed',
        updatedAt: now,
      },
    });
  }

  return {
    entitlement,
    alreadyActivated: false,
  };
}

async function getTrialRedeemCode() {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const now = new Date().toISOString();
  if (!openid) {
    throw new Error('OpenID is required');
  }

  await ensureCollection('redeem_codes');
  await ensureCollection('user_entitlements');

  const currentLocalEntitlement = await getUserEntitlement(openid, DEFAULT_REDEEM_PLAN);
  const currentLocalState = buildEntitlementState(currentLocalEntitlement, now);
  const trialExpiresAt = createEntitlementDocument({
    openid,
    codeDoc: {
      code: 'OBTRY-PRECHECK',
      plan: 'local_transcription_trial',
      durationDays: 7,
    },
    now,
  }).expiresAt;
  if (
    currentLocalState.hasAccess
    && new Date(currentLocalEntitlement.expiresAt || 0).getTime() >= new Date(trialExpiresAt || 0).getTime()
  ) {
    return {
      success: true,
      data: {
        ...currentLocalState,
        reused: true,
        alreadyActivated: true,
        preservedExistingEntitlement: true,
      },
    };
  }

  const existingResult = await db.collection('redeem_codes')
    .where({
      trialOwnerOpenid: openid,
    })
    .limit(1)
    .get();
  const existing = existingResult.data && existingResult.data[0] ? existingResult.data[0] : null;
  if (existing) {
    const activation = await activateTrialRedeemCode({ openid, codeDoc: existing, now });
    const entitlementState = buildEntitlementState(activation.entitlement, now);
    return {
      success: true,
      data: {
        ...entitlementState,
        code: normalizeRedeemCode(existing.code),
        status: existing.status || 'active',
        durationDays: Number(existing.durationDays) || 7,
        cloudQuotaSeconds: Number(existing.cloudQuotaSeconds) || 0,
        createdAt: existing.createdAt || '',
        expiresAt: entitlementState.expiresAt,
        reused: true,
        alreadyActivated: activation.alreadyActivated,
      },
    };
  }

  let doc = null;
  let attempts = 0;
  while (!doc && attempts < 30) {
    attempts += 1;
    const [candidate] = createAdminRedeemCodeDocuments({
      count: 1,
      prefix: 'OBTRY',
      durationDays: 7,
      maxRedemptions: 1,
      note: 'self-service-pro-trial',
      plan: 'local_transcription_trial',
      now,
    });
    const duplicateResult = await db.collection('redeem_codes')
      .where({ code: candidate.code })
      .limit(1)
      .get();
    if (duplicateResult.data && duplicateResult.data[0]) continue;
    doc = {
      ...candidate,
      trialOwnerOpenid: openid,
      trialIssuedAt: now,
      deliveryStatus: 'sent',
      deliveredAt: now,
      deliveredTo: openid,
    };
  }

  if (!doc) {
    const error = new Error('体验卡生成失败，请稍后再试');
    error.code = 'TRIAL_REDEEM_CODE_GENERATE_FAILED';
    throw error;
  }

  const created = await db.collection('redeem_codes').add({ data: doc });
  const createdDoc = {
    ...doc,
    _id: created._id,
  };
  const activation = await activateTrialRedeemCode({ openid, codeDoc: createdDoc, now });
  const entitlementState = buildEntitlementState(activation.entitlement, now);
  return {
    success: true,
    data: {
      ...entitlementState,
      code: doc.code,
      status: 'redeemed',
      durationDays: doc.durationDays,
      cloudQuotaSeconds: doc.cloudQuotaSeconds,
      createdAt: doc.createdAt,
      expiresAt: entitlementState.expiresAt,
      _id: created._id,
      reused: false,
      alreadyActivated: false,
    },
  };
}

async function createPaymentOrder(event = {}) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) throw new Error('OpenID is required');
  await ensureCollection('payment_orders');
  const now = new Date().toISOString();
  const order = createPaymentOrderDocument({
    openid,
    planId: event.planId,
    now,
  });
  const created = await db.collection('payment_orders').add({ data: order });
  return {
    success: true,
    data: {
      ...buildPaymentOrderState(order),
      _id: created._id,
    },
  };
}

async function queryPaymentOrder(event = {}) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const orderNo = String(event.orderNo || '').trim();
  if (!openid) throw new Error('OpenID is required');
  if (!orderNo) throw new Error('缺少订单号');
  await ensureCollection('payment_orders');
  const result = await db.collection('payment_orders')
    .where({ orderNo, openid })
    .limit(1)
    .get();
  const order = result.data && result.data[0] ? result.data[0] : null;
  if (!order) throw new Error('订单不存在');
  return {
    success: true,
    data: buildPaymentOrderState(order),
  };
}

async function applyPaidPaymentOrder(order, now = new Date().toISOString()) {
  const entitlement = createPaidEntitlementFromOrder({ order, now });
  await ensureCollection('user_entitlements');
  const currentResult = await db.collection('user_entitlements')
    .where({
      openid: order.openid,
      plan: entitlement.plan,
      status: 'active',
    })
    .orderBy('redeemedAt', 'desc')
    .limit(1)
    .get();
  const current = currentResult.data && currentResult.data[0] ? currentResult.data[0] : null;
  if (current && current._id) {
    await db.collection('user_entitlements').doc(current._id).update({ data: entitlement });
  } else {
    await db.collection('user_entitlements').add({ data: entitlement });
  }
  return entitlement;
}

async function adminListPaymentOrders(event = {}) {
  assertRedeemAdmin(event);
  await ensureCollection('payment_orders');
  const keyword = getKeyword(event.keyword);
  const statusFilter = String(event.status || '').trim();
  const limit = normalizeAdminPositiveInteger(event.limit, 1, 500, 100);
  const result = await db.collection('payment_orders')
    .orderBy('createdAt', 'desc')
    .limit(500)
    .get();
  const filtered = (result.data || [])
    .filter((item) => !statusFilter || item.status === statusFilter)
    .filter((item) => includesAdminKeyword(item, keyword, ['orderNo', 'openid', 'planId', 'planName', 'status']));
  return {
    success: true,
    data: {
      items: filtered.slice(0, limit).map((item) => ({
        _id: item._id,
        openid: item.openid || '',
        ...buildPaymentOrderState(item),
        updatedAt: item.updatedAt || '',
      })),
      total: filtered.length,
    },
  };
}

async function adminUpdatePaymentOrder(event = {}) {
  assertRedeemAdmin(event);
  await ensureCollection('payment_orders');
  const orderNo = String(event.orderNo || '').trim();
  const action = String(event.action || '').trim();
  if (!orderNo) throw new Error('缺少订单号');
  const result = await db.collection('payment_orders')
    .where({ orderNo })
    .limit(1)
    .get();
  const order = result.data && result.data[0] ? result.data[0] : null;
  if (!order || !order._id) throw new Error('订单不存在');
  const now = new Date().toISOString();
  const updateData = { updatedAt: now };
  let entitlement = null;
  if (action === 'markPaid') {
    updateData.status = 'paid';
    updateData.paidAt = order.paidAt || now;
    updateData.payMode = order.payMode || 'manual_pending';
    entitlement = await applyPaidPaymentOrder({ ...order, ...updateData }, updateData.paidAt);
  } else if (action === 'cancel') {
    updateData.status = 'cancelled';
  } else {
    throw new Error('不支持的订单操作');
  }
  await db.collection('payment_orders').doc(order._id).update({ data: updateData });
  return {
    success: true,
    data: {
      ...buildPaymentOrderState({ ...order, ...updateData }),
      entitlement: entitlement ? buildEntitlementState(entitlement, now) : null,
    },
  };
}

function assertRedeemAdmin(event) {
  const expectedSecret = String(process.env.REDEEM_ADMIN_SECRET || '').trim();
  if (!expectedSecret) {
    const error = new Error('请先在云函数环境变量里设置 REDEEM_ADMIN_SECRET，再创建兑换码');
    error.code = 'REDEEM_ADMIN_SECRET_MISSING';
    throw error;
  }
  const providedSecret = String(event.adminSecret || '').trim();
  if (providedSecret !== expectedSecret) {
    const error = new Error('兑换码管理密钥错误');
    error.code = 'REDEEM_ADMIN_FORBIDDEN';
    throw error;
  }
}

async function adminUpsertRedeemCode(event) {
  assertRedeemAdmin(event);
  await ensureCollection('redeem_codes');
  const now = new Date().toISOString();
  const doc = createRedeemCodeDocument({
    code: event.code,
    plan: event.plan || DEFAULT_REDEEM_PLAN,
    durationDays: event.durationDays,
    maxRedemptions: 1,
    now,
    note: event.note || '',
  });

  const existingResult = await db.collection('redeem_codes')
    .where({
      code: doc.code,
    })
    .limit(1)
    .get();
  const existing = existingResult.data && existingResult.data[0] ? existingResult.data[0] : null;

  if (existing) {
    await db.collection('redeem_codes').doc(existing._id).update({
      data: {
        ...doc,
        createdAt: existing.createdAt || doc.createdAt,
        updatedAt: now,
      },
    });
    return {
      success: true,
      data: {
        ...doc,
        _id: existing._id,
        action: 'updated',
      },
    };
  }

  const created = await db.collection('redeem_codes').add({
    data: doc,
  });
  return {
    success: true,
    data: {
      ...doc,
      _id: created._id,
      action: 'created',
    },
  };
}

function getKeyword(value) {
  return String(value || '').trim().toUpperCase();
}

function includesAdminKeyword(item, keyword, fields) {
  if (!keyword) return true;
  return fields.some((field) => String(item && item[field] ? item[field] : '').toUpperCase().includes(keyword));
}

function getRemainingDays(expiresAt, now) {
  if (!expiresAt) return null;
  const expiresTime = new Date(expiresAt).getTime();
  const nowTime = new Date(now).getTime();
  if (Number.isNaN(expiresTime) || Number.isNaN(nowTime)) return null;
  return Math.ceil((expiresTime - nowTime) / 86400000);
}

function buildRedeemCodeDeliveryState(item) {
  const redeemedCount = Number(item && item.redeemedCount) || 0;
  if (redeemedCount > 0) {
    return {
      deliveryStatus: 'activated',
      deliveryStatusText: '已激活',
    };
  }
  const deliveryStatus = item && item.deliveryStatus === 'sent' ? 'sent' : 'unsent';
  return {
    deliveryStatus,
    deliveryStatusText: deliveryStatus === 'sent' ? '已发放未激活' : '未发放',
  };
}

function addDaysFromBase(baseIso, days) {
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return '';
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

async function adminGenerateRedeemCodes(event) {
  assertRedeemAdmin(event);
  await ensureCollection('redeem_codes');
  const now = new Date().toISOString();
  const count = normalizeAdminPositiveInteger(event.count, 1, 100, 1);
  const docs = [];
  let attempts = 0;

  while (docs.length < count && attempts < count * 30) {
    attempts += 1;
    const [doc] = createAdminRedeemCodeDocuments({
      count: 1,
      prefix: event.prefix || 'OBPRO',
      durationDays: event.durationDays,
      maxRedemptions: 1,
      note: event.note || '',
      plan: event.plan || DEFAULT_REDEEM_PLAN,
      now,
    });

    const existingResult = await db.collection('redeem_codes')
      .where({ code: doc.code })
      .limit(1)
      .get();
    if (existingResult.data && existingResult.data[0]) continue;

    const created = await db.collection('redeem_codes').add({ data: doc });
    docs.push({
      ...doc,
      _id: created._id,
    });
  }

  if (docs.length < count) {
    const error = new Error('兑换码生成失败，请换一个前缀后重试');
    error.code = 'ADMIN_GENERATE_REDEEM_CODES_FAILED';
    throw error;
  }

  return {
    success: true,
    data: {
      codes: docs,
      plainText: docs.map((item) => item.code).join('\n'),
    },
  };
}

async function adminListRedeemCodes(event) {
  assertRedeemAdmin(event);
  await ensureCollection('redeem_codes');
  const now = new Date().toISOString();
  const keyword = getKeyword(event.keyword);
  const statusFilter = String(event.status || '').trim();
  const deliveryStatusFilter = String(event.deliveryStatus || '').trim();
  const limit = normalizeAdminPositiveInteger(event.limit, 1, 500, 100);
  const maxRead = normalizeAdminPositiveInteger(event.maxRead, 100, 5000, 5000);
  const result = await readAdminCollectionSnapshot('redeem_codes', {
    orderField: 'updatedAt',
    maxRead,
  });
  const filtered = (result.data || [])
    .filter((item) => {
      const deliveryState = buildRedeemCodeDeliveryState(item);
      if (statusFilter && (item.status || 'active') !== statusFilter) return false;
      if (deliveryStatusFilter && deliveryState.deliveryStatus !== deliveryStatusFilter) return false;
      return includesAdminKeyword({
        ...item,
        ...deliveryState,
      }, keyword, ['code', 'status', 'plan', 'note', 'deliveredTo', 'lastRedeemedOpenId', 'deliveryStatus', 'deliveryStatusText']);
    });
  const items = filtered
    .slice(0, limit)
    .map((item) => {
      const deliveryState = buildRedeemCodeDeliveryState(item);
      return {
        _id: item._id,
        code: item.code,
        status: item.status || 'active',
        plan: item.plan || DEFAULT_REDEEM_PLAN,
        durationDays: Number(item.durationDays) || 0,
        maxRedemptions: Number(item.maxRedemptions) || 1,
        redeemedCount: Number(item.redeemedCount) || 0,
        deliveryStatus: deliveryState.deliveryStatus,
        deliveryStatusText: deliveryState.deliveryStatusText,
        deliveredAt: item.deliveredAt || '',
        deliveredTo: item.deliveredTo || '',
        note: item.note || '',
        lastRedeemedAt: item.lastRedeemedAt || '',
        lastRedeemedOpenId: item.lastRedeemedOpenId || '',
        createdAt: item.createdAt || '',
        updatedAt: item.updatedAt || '',
        remainingDays: item.expiresAt ? getRemainingDays(item.expiresAt, now) : null,
      };
    });

  return {
    success: true,
    data: {
      items,
      total: filtered.length,
      scannedTotal: result.total,
      isTruncated: result.isTruncated,
      maxRead: result.maxRead,
    },
  };
}

async function adminListEntitlements(event) {
  assertRedeemAdmin(event);
  await ensureCollection('user_entitlements');
  const now = new Date().toISOString();
  const keyword = getKeyword(event.keyword);
  const limit = normalizeAdminPositiveInteger(event.limit, 1, 100, 50);
  const result = await db.collection('user_entitlements')
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();
  const items = (result.data || [])
    .filter((item) => includesAdminKeyword(item, keyword, ['openid', 'code', 'status', 'plan', 'source']))
    .slice(0, limit)
    .map((item) => ({
      _id: item._id,
      openid: item.openid || '',
      code: item.code || '',
      plan: item.plan || DEFAULT_REDEEM_PLAN,
      status: buildEntitlementState(item, now).status,
      hasAccess: buildEntitlementState(item, now).hasAccess,
      source: item.source || '',
      redeemedAt: item.redeemedAt || '',
      expiresAt: item.expiresAt || '',
      updatedAt: item.updatedAt || '',
      cloudQuotaSeconds: Number(item.cloudQuotaSeconds) || 0,
      cloudUsedSeconds: Number(item.cloudUsedSeconds) || 0,
      cloudRemainingSeconds: buildEntitlementState(item, now).cloudRemainingSeconds,
      remainingDays: getRemainingDays(item.expiresAt, now),
    }));

  return {
    success: true,
    data: {
      items,
      total: items.length,
    },
  };
}

async function adminListBindCodes(event) {
  assertRedeemAdmin(event);
  await ensureCollection('bind_codes');
  const keyword = getKeyword(event.keyword);
  const limit = normalizeAdminPositiveInteger(event.limit, 1, 100, 50);
  const result = await db.collection('bind_codes')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  const now = new Date().toISOString();
  const items = (result.data || [])
    .filter((item) => includesAdminKeyword(item, keyword, ['code', 'openid', 'status', 'clientId']))
    .slice(0, limit)
    .map((item) => {
      const status = createBindStatusResponse(item, now);
      return {
        _id: item._id,
        openid: item.openid || '',
        code: status.code,
        status: status.status,
        isBound: status.isBound,
        createdAt: status.createdAt,
        boundAt: status.boundAt || '',
        expiresAt: status.expiresAt || '',
        deviceLimit: status.deviceLimit,
        maxDeviceLimit: status.maxDeviceLimit,
        clientCount: status.clientCount,
        clients: status.clients,
      };
    });

  return {
    success: true,
    data: {
      items,
      total: items.length,
    },
  };
}

async function readAdminCollectionSnapshot(collectionName, {
  orderField = 'createdAt',
  order = 'desc',
  maxRead = 5000,
  pageSize = 100,
} = {}) {
  const collection = db.collection(collectionName);
  let total = 0;
  try {
    const countResult = await collection.count();
    total = Number(countResult.total) || 0;
  } catch (error) {
    console.error(`count ${collectionName} unavailable:`, error && (error.errMsg || error.message || error));
  }

  const safeMaxRead = normalizeAdminPositiveInteger(maxRead, 100, 5000, 5000);
  const safePageSize = normalizeAdminPositiveInteger(pageSize, 20, 100, 100);
  const targetTotal = total > 0 ? Math.min(total, safeMaxRead) : safeMaxRead;
  const data = [];

  for (let offset = 0; offset < targetTotal; offset += safePageSize) {
    const result = await collection
      .orderBy(orderField, order)
      .skip(offset)
      .limit(Math.min(safePageSize, targetTotal - offset))
      .get();
    const page = result.data || [];
    if (!page.length) break;
    data.push(...page);
    if (page.length < safePageSize) break;
  }

  return {
    data,
    total: total || data.length,
    isTruncated: total > safeMaxRead || data.length >= safeMaxRead,
    maxRead: safeMaxRead,
  };
}

function buildAdminDashboardScope(snapshots) {
  const names = Object.keys(snapshots || {});
  const isTruncated = names.some((name) => snapshots[name] && snapshots[name].isTruncated);
  const maxRead = names.reduce((value, name) => Math.max(value, Number(snapshots[name] && snapshots[name].maxRead) || 0), 0);
  const totals = names.reduce((result, name) => {
    result[name] = Number(snapshots[name] && snapshots[name].total) || 0;
    return result;
  }, {});
  return {
    isFullScan: !isTruncated,
    isTruncated,
    maxRead,
    totals,
    label: isTruncated ? `已读取每类最多 ${maxRead} 条，部分数据被截断` : '已按当前数据库总数统计',
    desc: isTruncated
      ? '数据量已超过后台直接读取上限，趋势判断可用，但精确全量需要做独立统计表。'
      : '当前数字按云数据库现有记录统计；访问和到达绑定页从本版本埋点上线后开始累计。',
  };
}

async function adminGetDashboard(event) {
  assertRedeemAdmin(event);
  await ensureCollection('inbox_records');
  await ensureCollection('redeem_codes');
  await ensureCollection('user_entitlements');
  await ensureCollection('bind_codes');
  await ensureCollection('analytics_events');
  const now = new Date().toISOString();
  const maxRead = normalizeAdminPositiveInteger(event.maxRead, 100, 5000, 5000);
  const [recordsResult, redeemResult, entitlementResult, bindResult, analyticsResult] = await Promise.all([
    readAdminCollectionSnapshot('inbox_records', { orderField: 'createdAt', maxRead }),
    readAdminCollectionSnapshot('redeem_codes', { orderField: 'updatedAt', maxRead }),
    readAdminCollectionSnapshot('user_entitlements', { orderField: 'updatedAt', maxRead }),
    readAdminCollectionSnapshot('bind_codes', { orderField: 'createdAt', maxRead }),
    readAdminCollectionSnapshot('analytics_events', { orderField: 'lastAt', maxRead }),
  ]);
  const scope = buildAdminDashboardScope({
    records: recordsResult,
    redeemCodes: redeemResult,
    entitlements: entitlementResult,
    bindCodes: bindResult,
    analyticsEvents: analyticsResult,
  });

  return {
    success: true,
    data: summarizeAdminDashboard({
      records: recordsResult.data || [],
      redeemCodes: redeemResult.data || [],
      entitlements: entitlementResult.data || [],
      bindCodes: bindResult.data || [],
      analyticsEvents: analyticsResult.data || [],
      now,
      sampleLimit: maxRead,
      scope,
    }),
  };
}

async function adminUpdateEntitlement(event) {
  assertRedeemAdmin(event);
  await ensureCollection('user_entitlements');
  const entitlementId = String(event.entitlementId || '').trim();
  const action = String(event.action || '').trim();
  if (action === 'addCloudQuota') {
    if (!entitlementId) throw new Error('缺少 Pro 用户记录 ID');
    const result = await db.collection('user_entitlements').doc(entitlementId).get();
    const entitlement = result.data;
    if (!entitlement) throw new Error('Pro 用户记录不存在');
    const now = new Date().toISOString();
    const minutes = normalizeAdminPositiveInteger(event.minutes, 1, 100000, 60);
    const addedSeconds = minutes * 60;
    const cloudQuotaSeconds = (Number(entitlement.cloudQuotaSeconds) || 0) + addedSeconds;
    const updateData = {
      cloudQuotaSeconds: _.inc(addedSeconds),
      cloudQuotaUpdatedAt: now,
      updatedAt: now,
    };
    await db.collection('user_entitlements').doc(entitlementId).update({ data: updateData });
    return {
      success: true,
      data: {
        ...entitlement,
        ...updateData,
        _id: entitlementId,
        cloudQuotaSeconds,
        cloudRemainingSeconds: Math.max(0, cloudQuotaSeconds - (Number(entitlement.cloudUsedSeconds) || 0)),
        remainingDays: getRemainingDays(entitlement.expiresAt, now),
      },
    };
  }
  if (!entitlementId) throw new Error('缺少 Pro 用户记录 ID');
  if (!['extend', 'disable', 'activate'].includes(action)) throw new Error('不支持的 Pro 用户操作');

  const result = await db.collection('user_entitlements').doc(entitlementId).get();
  const entitlement = result.data;
  if (!entitlement) throw new Error('Pro 用户记录不存在');

  const now = new Date().toISOString();
  const updateData = { updatedAt: now };
  if (action === 'extend') {
    const days = normalizeAdminPositiveInteger(event.days, 1, 9999, 30);
    const baseTime = entitlement.expiresAt && new Date(entitlement.expiresAt).getTime() > new Date(now).getTime()
      ? entitlement.expiresAt
      : now;
    updateData.status = 'active';
    updateData.expiresAt = addDaysFromBase(baseTime, days);
  }
  if (action === 'disable') {
    updateData.status = 'disabled';
  }
  if (action === 'activate') {
    updateData.status = 'active';
  }

  await db.collection('user_entitlements').doc(entitlementId).update({ data: updateData });
  return {
    success: true,
    data: {
      ...entitlement,
      ...updateData,
      _id: entitlementId,
      remainingDays: getRemainingDays(updateData.expiresAt || entitlement.expiresAt, now),
    },
  };
}

async function adminUpdateRedeemCode(event) {
  assertRedeemAdmin(event);
  await ensureCollection('redeem_codes');
  const codeId = String(event.codeId || '').trim();
  const code = normalizeRedeemCode(event.code);
  const action = String(event.action || '').trim();
  if (!codeId && !code) throw new Error('缺少兑换码 ID 或兑换码');
  if (!['disable', 'activate', 'markSent', 'markUnsent'].includes(action)) throw new Error('不支持的兑换码操作');

  let targetId = codeId;
  let target = null;
  if (targetId) {
    const result = await db.collection('redeem_codes').doc(targetId).get();
    target = result.data;
  } else {
    const result = await db.collection('redeem_codes').where({ code }).limit(1).get();
    target = result.data && result.data[0] ? result.data[0] : null;
    targetId = target && target._id;
  }
  if (!target || !targetId) throw new Error('兑换码不存在');

  const now = new Date().toISOString();
  const updateData = { updatedAt: now };
  if (action === 'disable' || action === 'activate') {
    updateData.status = action === 'disable' ? 'disabled' : 'active';
  }
  if (action === 'markSent') {
    updateData.deliveryStatus = 'sent';
    updateData.deliveredAt = now;
    updateData.deliveredTo = String(event.deliveredTo || target.deliveredTo || '').trim();
  }
  if (action === 'markUnsent') {
    updateData.deliveryStatus = 'unsent';
    updateData.deliveredAt = '';
    updateData.deliveredTo = '';
  }
  await db.collection('redeem_codes').doc(targetId).update({
    data: updateData,
  });
  const deliveryState = buildRedeemCodeDeliveryState({ ...target, ...updateData });

  return {
    success: true,
    data: {
      ...target,
      _id: targetId,
      ...updateData,
      ...deliveryState,
      updatedAt: now,
    },
  };
}

async function createInboxRecord(event) {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();
  const entitlement = await getUserEntitlement(wxContext.OPENID, DEFAULT_REDEEM_PLAN);
  const transcriptionSettings = await getUserTranscriptionSettings(wxContext.OPENID);
  const data = createInboxRecordDocument({
    event,
    openid: wxContext.OPENID,
    now,
    cloudPreTranscription: transcriptionSettings,
  });
  const entitlementState = buildEntitlementState(entitlement, now);
  if (requiresProTranscriptionAccess(data) && !entitlementState.hasAccess) {
    return {
      success: false,
      errCode: 'PRO_REQUIRED',
      errMsg: '录音、MP3 和音视频转写需要开通 Pro',
    };
  }
  const quota = entitlementState.hasAccess
    ? buildProUsageState()
    : await consumeDailyQuota(wxContext.OPENID, now);

  if (data.type === 'voice' && shouldPrepareAudioTempURL()) {
    const voiceMetadata = {
      ...data.metadata,
    };

    try {
      voiceMetadata.audioTempURL = await getAudioTempURL(data.metadata.audioFileID);
    } catch (error) {
      voiceMetadata.audioTempURLError = error.message || String(error);
    }

    data.metadata = await processVoiceMetadata(voiceMetadata);
  }

  await ensureCollection('inbox_records');
  const result = await db.collection('inbox_records').add({ data });

  return {
    success: true,
    data: {
      id: result._id,
      quota,
      ...data,
    },
  };
}

async function getOwnedInboxRecord(openid, recordId) {
  await ensureCollection('inbox_records');
  const result = await db.collection('inbox_records')
    .where({
      _id: recordId,
      openid,
    })
    .limit(1)
    .get();
  if (result.data && result.data[0]) return result.data[0];

  const record = await findInboxRecordByIdFromSnapshot(recordId);
  if (!record) return null;
  return String(record.openid || '') === String(openid || '') ? record : null;
}

async function getInboxRecordById(recordId) {
  await ensureCollection('inbox_records');
  const result = await db.collection('inbox_records')
    .where({
      _id: recordId,
    })
    .limit(1)
    .get();
  if (result.data && result.data[0]) return result.data[0];
  return await findInboxRecordByIdFromSnapshot(recordId);
}

async function findInboxRecordByIdFromSnapshot(recordId) {
  const safeRecordId = String(recordId || '').trim();
  if (!safeRecordId) return null;
  const snapshot = await readAdminCollectionSnapshot('inbox_records', {
    orderField: 'createdAt',
    order: 'desc',
    maxRead: 5000,
  });
  return (snapshot.data || []).find((item) => String(item._id || '') === safeRecordId) || null;
}

async function updateInboxRecordMetadata(record, metadataPatch, recordPatch = {}) {
  const now = new Date().toISOString();
  const metadata = {
    ...(record.metadata || {}),
    ...metadataPatch,
    updatedAt: now,
  };
  const data = {
    ...recordPatch,
    metadata,
    updatedAt: now,
  };
  await db.collection('inbox_records').doc(record._id).update({
    data,
  });
  return {
    ...record,
    ...recordPatch,
    metadata,
    updatedAt: now,
  };
}

async function failCloudPreTranscription(record, message) {
  const runtimeConfig = getCloudRuntimeConfigStatusData();
  const nextRecord = await updateInboxRecordMetadata(record, {
    transcriptionStatus: 'failed',
    transcriptionSource: 'cloud-pretranscription',
    transcriptionError: String(message || '云端转写失败'),
    cloudRuntimeDoubaoKeyConfigured: runtimeConfig.doubaoAsrApiKeyConfigured,
    cloudRuntimeDoubaoKeyLength: runtimeConfig.doubaoAsrApiKeyLength,
    cloudRuntimeMediaResolverUrlConfigured: runtimeConfig.mediaResolverUrlConfigured,
    cloudRuntimeMediaResolverSecretConfigured: runtimeConfig.mediaResolverSecretConfigured,
    cloudPreTranscriptionFinishedAt: new Date().toISOString(),
  });
  return {
    success: false,
    errMsg: nextRecord.metadata.transcriptionError,
    data: {
      recordId: record._id,
      transcriptionStatus: 'failed',
    },
  };
}

async function consumeCloudTranscriptionQuota({ openid, entitlement, record, billableSeconds, provider, requestId }) {
  const now = new Date().toISOString();
  await ensureCollection('cloud_transcription_usages');
  await db.collection('cloud_transcription_usages').add({
    data: {
      openid,
      entitlementId: entitlement._id || '',
      recordId: record._id,
      fileID: record.metadata && (record.metadata.audioFileID || record.metadata.fileID || ''),
      provider,
      requestId,
      usedSeconds: billableSeconds,
      createdAt: now,
    },
  });
  if (entitlement._id) {
    await db.collection('user_entitlements').doc(entitlement._id).update({
      data: {
        cloudUsedSeconds: _.inc(billableSeconds),
        cloudLastUsedAt: now,
        updatedAt: now,
      },
    });
  }
}

async function completeCloudPreTranscriptionRecord({
  openid,
  entitlement,
  record,
  result,
  audioUrl = '',
  isWebpageAudioVideo = false,
  resolvedWebpageMedia = null,
}) {
  const metadata = record.metadata || {};
  const transcription = String(result && result.transcription || '').trim();
  if (!transcription) {
    throw new Error('云端转写未返回正文');
  }
  const actualBillableSeconds = getBillableCloudSecondsFromResult(metadata, result);
  const actualQuotaState = getCloudQuotaState(entitlement, actualBillableSeconds);
  if (!actualQuotaState.hasEnoughQuota) {
    return await failCloudPreTranscription(record, '云端转写额度不足');
  }

  await consumeCloudTranscriptionQuota({
    openid,
    entitlement,
    record,
    billableSeconds: actualBillableSeconds,
    provider: result.provider || 'doubao',
    requestId: result.requestId || '',
  });

  const remainingSeconds = Math.max(0, actualQuotaState.cloudRemainingSeconds - actualBillableSeconds);
  const reactivateSyncedRecordPatch = record.status === 'synced'
    ? {
      status: 'pending',
      syncedAt: '',
    }
    : {};
  await updateInboxRecordMetadata(record, {
    ...(isWebpageAudioVideo ? {
      transcriptOnly: true,
      audioUrl,
      mediaUrl: audioUrl,
      mediaResolverSource: resolvedWebpageMedia && resolvedWebpageMedia.source ? resolvedWebpageMedia.source : 'unknown',
      mediaResolverTitle: resolvedWebpageMedia && resolvedWebpageMedia.title ? resolvedWebpageMedia.title : '',
      mediaResolverDurationSeconds: resolvedWebpageMedia && resolvedWebpageMedia.durationSeconds ? resolvedWebpageMedia.durationSeconds : 0,
      mediaResolverError: resolvedWebpageMedia && resolvedWebpageMedia.resolverError ? resolvedWebpageMedia.resolverError : '',
      conversionStatus: 'success',
    } : {}),
    transcription,
    transcriptionStatus: 'success',
    transcriptionSource: 'cloud-pretranscription',
    transcriptionProvider: result.provider || 'doubao',
    transcriptionError: '',
    doubaoRequestId: result.requestId || '',
    cloudUsedSeconds: actualBillableSeconds,
    cloudRemainingSeconds: remainingSeconds,
    cloudDetectedDurationSeconds: Math.ceil(Number(result.durationSeconds) || 0),
    cloudPreTranscriptionFinishedAt: new Date().toISOString(),
  }, reactivateSyncedRecordPatch);

  return {
    success: true,
    data: {
      recordId: record._id,
      transcriptionStatus: 'success',
      usedSeconds: actualBillableSeconds,
      remainingSeconds,
    },
  };
}

async function processCloudPreTranscription(event) {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const recordId = String(event.recordId || '').trim();
  if (!recordId) {
    throw new Error('缺少收集记录 ID');
  }

  const record = await getOwnedInboxRecord(openid, recordId);
  if (!record) {
    throw new Error('收集记录不存在');
  }
  return await processCloudPreTranscriptionRecord({
    openid,
    record,
  });
}

function getNextCloudTranscriptionPollAt() {
  return new Date(Date.now() + CLOUD_TRANSCRIPTION_POLL_INTERVAL_MS).toISOString();
}

async function startCloudPreTranscriptionRecord({ openid, record }) {
  const metadata = record.metadata || {};
  const fileID = String(metadata.audioFileID || metadata.fileID || '').trim();
  const pageUrl = String(metadata.url || record.content || '').trim();
  const isWebpageAudioVideo = record.type === 'webpage' && metadata.webpageMediaType === 'audio_video';
  if (!fileID && !isWebpageAudioVideo) {
    return await failCloudPreTranscription(record, 'Missing audio or video file for cloud transcription');
  }

  const now = new Date().toISOString();
  const entitlement = await getUserEntitlement(openid, DEFAULT_REDEEM_PLAN);
  const entitlementState = buildEntitlementState(entitlement, now);
  if (!entitlementState.hasAccess) {
    return await failCloudPreTranscription(record, 'Pro access is required for cloud transcription');
  }

  const minimumBillableSeconds = getBillableCloudSeconds(metadata.duration);
  const minimumQuotaState = getCloudQuotaState(entitlement, minimumBillableSeconds);
  if (!minimumQuotaState.hasEnoughQuota) {
    return await failCloudPreTranscription(record, 'Cloud transcription quota is not enough');
  }

  try {
    let audioUrl = '';
    let resolvedWebpageMedia = null;
    if (fileID) {
      audioUrl = await getAudioTempURL(fileID);
    } else if (isWebpageAudioVideo && isHttpUrl(pageUrl)) {
      resolvedWebpageMedia = await resolveWebpageAudioUrl(pageUrl, record);
      audioUrl = resolvedWebpageMedia.audioUrl;
    }
    if (!audioUrl) {
      throw new Error(isWebpageAudioVideo ? 'No transcribable media URL was extracted from the webpage' : 'Failed to create audio temp URL');
    }

    const result = await submitDoubaoCloudTranscription(audioUrl);
    if (result.complete) {
      return await completeCloudPreTranscriptionRecord({
        openid,
        entitlement,
        record,
        result,
        audioUrl,
        isWebpageAudioVideo,
        resolvedWebpageMedia,
      });
    }

    await updateInboxRecordMetadata(record, {
      ...(isWebpageAudioVideo ? {
        transcriptOnly: true,
        audioUrl,
        mediaUrl: audioUrl,
        mediaResolverSource: resolvedWebpageMedia && resolvedWebpageMedia.source ? resolvedWebpageMedia.source : 'unknown',
        mediaResolverTitle: resolvedWebpageMedia && resolvedWebpageMedia.title ? resolvedWebpageMedia.title : '',
        mediaResolverDurationSeconds: resolvedWebpageMedia && resolvedWebpageMedia.durationSeconds ? resolvedWebpageMedia.durationSeconds : 0,
        mediaResolverError: resolvedWebpageMedia && resolvedWebpageMedia.resolverError ? resolvedWebpageMedia.resolverError : '',
        conversionStatus: 'processing',
      } : {}),
      transcriptionStatus: 'processing',
      transcriptionSource: 'cloud-pretranscription',
      transcriptionProvider: result.provider || 'doubao',
      transcriptionError: '',
      doubaoRequestId: result.requestId || '',
      cloudPollAttempts: 0,
      cloudNextPollAt: getNextCloudTranscriptionPollAt(),
      cloudPreTranscriptionStartedAt: metadata.cloudPreTranscriptionStartedAt || now,
      cloudPreTranscriptionSubmittedAt: now,
    });

    return {
      success: true,
      data: {
        recordId: record._id,
        transcriptionStatus: 'processing',
        requestId: result.requestId || '',
      },
    };
  } catch (error) {
    return await failCloudPreTranscription(record, error.message || String(error));
  }
}

async function pollCloudPreTranscriptionRecord({ openid, record }) {
  const metadata = record.metadata || {};
  const requestId = String(metadata.doubaoRequestId || '').trim();
  if (!requestId) {
    return await failCloudPreTranscription(record, 'Cloud transcription request id is missing');
  }

  const pollAttempts = Number(metadata.cloudPollAttempts) || 0;
  if (pollAttempts >= CLOUD_TRANSCRIPTION_MAX_POLL_ATTEMPTS) {
    return await failCloudPreTranscription(record, 'Cloud transcription timed out');
  }

  const now = new Date().toISOString();
  const entitlement = await getUserEntitlement(openid, DEFAULT_REDEEM_PLAN);
  const entitlementState = buildEntitlementState(entitlement, now);
  if (!entitlementState.hasAccess) {
    return await failCloudPreTranscription(record, 'Pro access is required for cloud transcription');
  }

  try {
    const result = await queryDoubaoCloudTranscription(requestId);
    if (result.complete) {
      const isWebpageAudioVideo = record.type === 'webpage' && metadata.webpageMediaType === 'audio_video';
      return await completeCloudPreTranscriptionRecord({
        openid,
        entitlement,
        record,
        result,
        audioUrl: metadata.audioUrl || metadata.mediaUrl || '',
        isWebpageAudioVideo,
        resolvedWebpageMedia: {
          source: metadata.mediaResolverSource || '',
          title: metadata.mediaResolverTitle || '',
          durationSeconds: Number(metadata.mediaResolverDurationSeconds) || 0,
          resolverError: metadata.mediaResolverError || '',
        },
      });
    }

    const nextAttempts = pollAttempts + 1;
    await updateInboxRecordMetadata(record, {
      transcriptionStatus: 'processing',
      transcriptionSource: 'cloud-pretranscription',
      transcriptionError: '',
      cloudPollAttempts: nextAttempts,
      cloudLastPolledAt: now,
      cloudNextPollAt: getNextCloudTranscriptionPollAt(),
    });

    return {
      success: true,
      data: {
        recordId: record._id,
        transcriptionStatus: 'processing',
        pollAttempts: nextAttempts,
      },
    };
  } catch (error) {
    return await failCloudPreTranscription(record, error.message || String(error));
  }
}

function isCloudTranscriptionQueueRecord(record, nowTime) {
  const metadata = (record && record.metadata) || {};
  const status = String(metadata.transcriptionStatus || '').toLowerCase();
  if (status !== 'queued' && status !== 'processing') return false;
  const requested = metadata.cloudTranscriptionRequested === true
    || metadata.transcriptionSource === 'cloud-pretranscription'
    || metadata.doubaoRequestId
    || status === 'queued';
  if (!requested) return false;
  const nextPollAt = metadata.cloudNextPollAt ? new Date(metadata.cloudNextPollAt).getTime() : 0;
  return !nextPollAt || Number.isNaN(nextPollAt) || nextPollAt <= nowTime;
}

async function processCloudTranscriptionQueue(event = {}) {
  const nowTime = Date.now();
  const limit = normalizeAdminPositiveInteger(event.limit, 1, 10, CLOUD_TRANSCRIPTION_QUEUE_BATCH_SIZE);
  const maxRead = normalizeAdminPositiveInteger(event.maxRead, 100, CLOUD_TRANSCRIPTION_QUEUE_MAX_READ, CLOUD_TRANSCRIPTION_QUEUE_MAX_READ);
  const snapshot = await readAdminCollectionSnapshot('inbox_records', {
    orderField: 'updatedAt',
    order: 'asc',
    maxRead,
  });
  const candidates = (snapshot.data || [])
    .filter((record) => isCloudTranscriptionQueueRecord(record, nowTime))
    .slice(0, limit);

  const results = [];
  for (const record of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await processCloudPreTranscriptionRecord({
        openid: record.openid,
        record,
      });
      results.push({
        recordId: record._id,
        success: Boolean(result && result.success),
        data: result && result.data ? result.data : null,
        errMsg: result && result.errMsg ? result.errMsg : '',
      });
    } catch (error) {
      results.push({
        recordId: record._id,
        success: false,
        data: null,
        errMsg: error.message || String(error),
      });
    }
  }

  return {
    success: true,
    data: {
      checked: snapshot.data ? snapshot.data.length : 0,
      processed: results.length,
      results,
    },
  };
}

async function processCloudPreTranscriptionRecord({ openid, record }) {
  const recordId = record._id;
  const metadata = record.metadata || {};
  if (metadata.transcriptionStatus === 'success' && metadata.transcription) {
    if (record.status === 'synced') {
      await updateInboxRecordMetadata(record, {}, {
        status: 'pending',
        syncedAt: '',
      });
    }
    return {
      success: true,
      data: {
        recordId,
        transcriptionStatus: 'success',
        alreadyProcessed: true,
      },
    };
  }

  if (metadata.transcriptionStatus === 'processing' && metadata.doubaoRequestId) {
    return await pollCloudPreTranscriptionRecord({ openid, record });
  }

  return await startCloudPreTranscriptionRecord({ openid, record });
}

async function adminRetryCloudPreTranscription(event) {
  assertRedeemAdmin(event);
  const recordId = String(event.recordId || '').trim();
  if (!recordId) {
    throw new Error('Record ID is required');
  }
  const record = await getInboxRecordById(recordId);
  if (!record) {
    throw new Error('Record not found');
  }
  return await processCloudPreTranscriptionRecord({
    openid: record.openid,
    record,
  });
}

async function createBindCode() {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();

  await ensureCollection('bind_codes');

  const currentResult = await db.collection('bind_codes')
    .where({
      openid: wxContext.OPENID,
      status: _.neq('revoked'),
    })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  const current = currentResult.data && currentResult.data[0] ? currentResult.data[0] : null;
  if (current) {
    return {
      success: true,
      data: {
        id: current._id,
        ...createBindStatusResponse(current, now),
      },
    };
  }

  return await createFreshBindCode(wxContext.OPENID, now);
}

async function createFreshBindCode(openid, now) {
  await ensureCollection('bind_codes');

  const code = await generateUniqueBindCode({
    codeExists: async (candidate) => {
      const existing = await db.collection('bind_codes')
        .where({
          code: candidate,
        })
        .limit(1)
        .get();
      return Boolean(existing.data && existing.data.length);
    },
  });

  const data = createBindCodeDocument({
    openid,
    code,
    now,
  });

  const result = await db.collection('bind_codes').add({ data });

  return {
    success: true,
    data: {
      id: result._id,
      code,
      status: data.status,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
    },
  };
}

async function replaceBindCode() {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();

  await ensureCollection('bind_codes');
  await db.collection('bind_codes')
    .where({
      openid: wxContext.OPENID,
      status: _.neq('revoked'),
    })
    .update({
      data: {
        status: 'revoked',
        revokedAt: now,
      },
    })
    .catch(() => {});

  return await createFreshBindCode(wxContext.OPENID, now);
}

async function getBindStatus(event) {
  const wxContext = cloud.getWXContext();
  const code = String(event.code || '').trim();
  if (!code) {
    throw new Error('Bind code is required');
  }
  const candidates = getBindCodeLookupCandidates(code);

  await ensureCollection('bind_codes');
  const result = await db.collection('bind_codes')
    .where({
      openid: wxContext.OPENID,
      code: _.in(candidates),
    })
    .limit(1)
    .get();

  const bindCode = result.data && result.data[0] ? result.data[0] : null;

  return {
    success: true,
    data: createBindStatusResponse(bindCode, new Date().toISOString()),
  };
}

async function increaseBindDeviceLimit(event) {
  const wxContext = cloud.getWXContext();
  const code = String(event.code || '').trim();

  await ensureCollection('bind_codes');
  const query = {
    openid: wxContext.OPENID,
    status: _.neq('revoked'),
  };
  if (code) {
    query.code = _.in(getBindCodeLookupCandidates(code));
  }

  const result = await db.collection('bind_codes')
    .where(query)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  const bindCode = result.data && result.data[0] ? result.data[0] : null;
  if (!bindCode) {
    throw new Error('Bind code is required');
  }

  const currentLimit = normalizeBindDeviceLimit(bindCode);
  if (currentLimit >= MAX_BIND_DEVICE_LIMIT) {
    throw new Error('Device limit reached');
  }

  const deviceLimit = currentLimit + 1;
  await db.collection('bind_codes').doc(bindCode._id).update({
    data: {
      deviceLimit,
    },
  });

  return {
    success: true,
    data: createBindStatusResponse({
      ...bindCode,
      deviceLimit,
    }, new Date().toISOString()),
  };
}

async function unbindBindClient(event) {
  const wxContext = cloud.getWXContext();
  const code = String(event.code || '').trim();
  const clientId = String(event.clientId || '').trim();
  if (!code || !clientId) {
    throw new Error('Bind code and client ID are required');
  }

  await ensureCollection('bind_codes');
  const result = await db.collection('bind_codes')
    .where({
      openid: wxContext.OPENID,
      code: _.in(getBindCodeLookupCandidates(code)),
      status: _.neq('revoked'),
    })
    .limit(1)
    .get();

  const bindCode = result.data && result.data[0] ? result.data[0] : null;
  if (!bindCode) {
    throw new Error('Bind code is required');
  }

  const now = new Date().toISOString();
  const unbindResult = unbindClientFromCodeDocument(bindCode, clientId, now);
  if (!unbindResult || unbindResult.status === 'invalid') {
    throw new Error('Client is required');
  }
  if (unbindResult.status === 'not-found') {
    return {
      success: true,
      data: createBindStatusResponse(bindCode, now),
    };
  }

  await db.collection('bind_codes').doc(bindCode._id).update({
    data: unbindResult.data,
  });

  return {
    success: true,
    data: createBindStatusResponse({
      ...bindCode,
      ...unbindResult.data,
    }, now),
  };
}

function postFeishuWebhookJson(url, payload) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('FEISHU_FEEDBACK_WEBHOOK is not configured'));
      return;
    }

    const requestBody = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }
        reject(new Error(`Feishu webhook failed: HTTP ${res.statusCode} ${body.slice(0, 200)}`));
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Feishu webhook request timed out'));
    });
    req.write(requestBody);
    req.end();
  });
}

async function submitFeedback(event) {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();
  let data = createFeedbackDocument({
    event,
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    now,
  });
  const feishuWebhook = process.env.FEISHU_FEEDBACK_WEBHOOK;
  const feishuWebhookEnabled = process.env.FEISHU_FEEDBACK_WEBHOOK_ENABLED;
  const notification = prepareFeedbackNotification({
    feedback: data,
    webhook: feishuWebhook,
    enabled: feishuWebhookEnabled,
  });
  data = notification.feedback;

  await ensureCollection('feedback');
  const result = await db.collection('feedback').add({ data });
  const feedbackId = result._id;

  if (!notification.shouldNotify) {
    return {
      success: true,
      data: {
        id: feedbackId,
        notificationStatus: 'skipped',
        notificationError: '',
      },
    };
  }

  try {
    await postFeishuWebhookJson(feishuWebhook, buildFeishuFeedbackMessage({
      feedback: data,
      feedbackId,
    }));
    await db.collection('feedback').doc(feedbackId).update({
      data: {
        notificationStatus: 'sent',
        notifiedAt: new Date().toISOString(),
        notificationError: '',
      },
    });
    data.notificationStatus = 'sent';
  } catch (error) {
    const message = error.message || String(error);
    await db.collection('feedback').doc(feedbackId).update({
      data: {
        notificationStatus: 'failed',
        notificationError: message,
      },
    });
    data.notificationStatus = 'failed';
    data.notificationError = message;
  }

  return {
    success: true,
    data: {
      id: feedbackId,
      notificationStatus: data.notificationStatus,
      notificationError: data.notificationError,
    },
  };
}

async function getPublicConfig() {
  await ensureCollection('public_config');
  const result = await db.collection('public_config')
    .where({
      key: 'home',
    })
    .limit(1)
    .get();

  const config = result.data && result.data[0] ? result.data[0] : null;

  return {
    success: true,
    data: buildPublicConfig(config),
  };
}

async function listInboxRecords() {
  const wxContext = cloud.getWXContext();
  await ensureCollection('inbox_records');

  const result = await db
    .collection('inbox_records')
    .where({
      openid: wxContext.OPENID,
      status: _.neq('synced'),
    })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  return {
    success: true,
    data: result.data,
  };
}

async function markInboxRecordSynced(event) {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();

  if (!event.recordId) {
    throw new Error('Record ID is required');
  }

  const recordResult = await db
    .collection('inbox_records')
    .where({
      _id: event.recordId,
      openid: wxContext.OPENID,
    })
    .limit(1)
    .get();

  const record = recordResult.data && recordResult.data[0] ? recordResult.data[0] : null;
  if (!record) {
    throw new Error('Record not found');
  }

  const fileIds = collectRecordFileIds(record);
  let cleanupError = '';

  if (fileIds.length) {
    try {
      const deleteResult = await cloud.deleteFile({
        fileList: fileIds,
      });
      const failedFiles = (deleteResult.fileList || []).filter((item) => item.status && item.status !== 0);
      if (failedFiles.length) {
        cleanupError = failedFiles
          .map((item) => `${item.fileID || 'unknown'}:${item.errMsg || item.status}`)
          .join('; ');
      }
    } catch (error) {
      cleanupError = formatCleanupError(error);
    }
  }

  await db
    .collection('inbox_records')
    .doc(record._id)
    .update({
      data: buildSyncedRecordCleanupData({
        syncedAt: now,
        fileIds,
        cleanupError,
      }),
    });

  return {
    success: true,
    data: {
      id: event.recordId,
      status: 'synced',
      syncedAt: now,
      cleaned: true,
      deletedFileCount: fileIds.length,
      cleanupError,
    },
  };
}

exports.main = async (event) => {
  try {
    if (event && (event.Type === 'Timer' || event.TriggerName || event.timer || event.type === 'timer')) {
      return await processCloudTranscriptionQueue(event);
    }
    switch (event.type) {
      case 'getOpenId':
        return await getOpenId();
      case 'getMiniProgramCode':
        return await getMiniProgramCode();
      case 'getPublicConfig':
        return await getPublicConfig(event);
      case 'getDailyUsage':
        return await getDailyUsage(event);
      case 'unlockDailyUsageByShare':
        return await unlockDailyUsageByShare(event);
      case 'unlockDailyUsageByAd':
        return await unlockDailyUsageByAd(event);
      case 'getEntitlementStatus':
        return await getEntitlementStatus(event);
      case 'redeemAccessCode':
        return await redeemAccessCode(event);
      case 'getTrialRedeemCode':
        return await getTrialRedeemCode(event);
      case 'createPaymentOrder':
        return await createPaymentOrder(event);
      case 'queryPaymentOrder':
        return await queryPaymentOrder(event);
      case 'adminUpsertRedeemCode':
        return await adminUpsertRedeemCode(event);
      case 'adminGenerateRedeemCodes':
        return await adminGenerateRedeemCodes(event);
      case 'adminListRedeemCodes':
        return await adminListRedeemCodes(event);
      case 'adminListEntitlements':
        return await adminListEntitlements(event);
      case 'adminListBindCodes':
        return await adminListBindCodes(event);
      case 'adminGetDashboard':
        return await adminGetDashboard(event);
      case 'adminUpdateEntitlement':
        return await adminUpdateEntitlement(event);
      case 'adminUpdateRedeemCode':
        return await adminUpdateRedeemCode(event);
      case 'adminListPaymentOrders':
        return await adminListPaymentOrders(event);
      case 'adminUpdatePaymentOrder':
        return await adminUpdatePaymentOrder(event);
      case 'adminRetryCloudPreTranscription':
        return await adminRetryCloudPreTranscription(event);
      case 'trackAnalyticsEvent':
        return await trackAnalyticsEvent(event);
      case 'getCloudRuntimeConfigStatus':
        return await getCloudRuntimeConfigStatus(event);
      case 'createInboxRecord':
        return await createInboxRecord(event);
      case 'processCloudPreTranscription':
        return await processCloudPreTranscription(event);
      case 'processCloudTranscriptionQueue':
        return await processCloudTranscriptionQueue(event);
      case 'createBindCode':
        return await createBindCode(event);
      case 'replaceBindCode':
        return await replaceBindCode(event);
      case 'getBindStatus':
        return await getBindStatus(event);
      case 'increaseBindDeviceLimit':
        return await increaseBindDeviceLimit(event);
      case 'unbindBindClient':
        return await unbindBindClient(event);
      case 'submitFeedback':
        return await submitFeedback(event);
      case 'listInboxRecords':
        return await listInboxRecords(event);
      case 'markInboxRecordSynced':
        return await markInboxRecordSynced(event);
      default:
        throw new Error(`Unsupported function type: ${event.type}`);
    }
  } catch (error) {
    return {
      success: false,
      errCode: error.code || '',
      errMsg: error.message || String(error),
      data: error.quota || null,
    };
  }
};
