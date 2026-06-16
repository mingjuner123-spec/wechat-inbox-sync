const cloud = require('wx-server-sdk');
const https = require('https');
const {
  buildSyncedRecordCleanupData,
  collectRecordFileIds,
  handleSyncApiRequest,
} = require('./sync-api-core');
const {
  DEFAULT_REDEEM_PLAN,
  isLocalTranscriptionPlan,
  pickBestLocalTranscriptionEntitlement,
} = require('./redeem-code-core');

const PRODUCTION_WECHAT_DATA_ENV = 'he02-d8gebzv050ed6c4ef';

function getCloudDataEnv() {
  return String(process.env.WECHAT_DATA_ENV || '').trim() || PRODUCTION_WECHAT_DATA_ENV || cloud.DYNAMIC_CURRENT_ENV;
}

cloud.init({
  env: getCloudDataEnv(),
});

const db = cloud.database();
const _ = db.command;
const { handleAdminRequest: handleAdminConsoleRequest } = require('./admin-handler');
const DEFAULT_BIND_DEVICE_LIMIT = 1;
const MAX_BIND_DEVICE_LIMIT = 3;
const BIND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DOUBAO_ASR_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const DOUBAO_ASR_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
const DOUBAO_ASR_RESOURCE_ID = 'volc.bigasr.auc';
const DEFAULT_CLOUD_ASR_POLL_ATTEMPTS = 60;
const DEFAULT_CLOUD_ASR_POLL_INTERVAL_MS = 5000;
const MEDIA_RESOLVER_TIMEOUT_MS = 30000;
const MEDIA_PREPARE_DOWNLOAD_TIMEOUT_MS = 120000;
const MEDIA_PREPARE_MAX_BYTES = 512 * 1024 * 1024;

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function getMediaResolverUrl() {
  return String(process.env.MEDIA_RESOLVER_URL || '').trim();
}

function getMediaResolverSecret() {
  return String(process.env.MEDIA_RESOLVER_SECRET || '').trim();
}

function isMediaPrepareCacheEnabled() {
  return String(process.env.MEDIA_PREPARE_CACHE_ENABLED || '').toLowerCase() === 'true';
}

function getMediaPrepareCacheTtlMs() {
  const hours = Number(process.env.MEDIA_PREPARE_CACHE_TTL_HOURS || 24);
  return Math.max(1, Math.min(168, Number.isFinite(hours) ? hours : 24)) * 60 * 60 * 1000;
}

function sanitizeCloudPathPart(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80) || 'unknown';
}

function getPreparedMediaExt(url) {
  const clean = String(url || '').split('?')[0].split('#')[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]{2,5})$/);
  const ext = match ? match[1] : '';
  if (['mp3', 'wav', 'm4a', 'mp4', 'aac', 'ogg', 'flac', 'webm', 'm4s'].includes(ext)) return ext;
  return 'm4a';
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

function downloadPreparedMedia(url, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (!isHttpUrl(url)) {
      reject(new Error('Prepared media URL is invalid'));
      return;
    }
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? require('http') : https;
    const req = client.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 WeChatInboxMediaPrepare/1.0',
        Accept: '*/*',
        ...headers,
      },
    }, (res) => {
      const location = res.headers && res.headers.location;
      if ([301, 302, 303, 307, 308].includes(Number(res.statusCode)) && location && redirectCount < 5) {
        res.resume();
        resolve(downloadPreparedMedia(new URL(location, url).toString(), headers, redirectCount + 1));
        return;
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        reject(new Error(`Prepared media download failed: HTTP ${res.statusCode}`));
        return;
      }
      const contentLength = Number(res.headers && res.headers['content-length']) || 0;
      if (contentLength > MEDIA_PREPARE_MAX_BYTES) {
        res.resume();
        reject(new Error('Prepared media is too large'));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MEDIA_PREPARE_MAX_BYTES) {
          req.destroy(new Error('Prepared media is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const head = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trim().toLowerCase();
        if (buffer.length < 512 || head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<body')) {
          reject(new Error('Prepared media download returned HTML instead of media'));
          return;
        }
        resolve({
          buffer,
          contentType: String(res.headers && res.headers['content-type'] || 'application/octet-stream'),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(MEDIA_PREPARE_DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error('Prepared media download timed out'));
    });
  });
}

function formatCleanupError(error) {
  return error && error.message ? error.message : String(error || '');
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
    const req = https.request({
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
  const parts = [`豆包语音识别请求失败：HTTP ${response && response.status}`];
  ['x-api-status-code', 'x-api-message', 'x-api-request-id'].forEach((name) => {
    const value = getHttpHeader(response && response.headers, name);
    if (value) parts.push(`${name}=${value}`);
  });
  const body = String((response && (response.text || JSON.stringify(response.json || ''))) || '').trim();
  if (body) parts.push(body.slice(0, 500));
  return parts.join('；');
}

function normalizeDoubaoSpeakerText(result) {
  if (!result || typeof result !== 'object') return '';
  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  if (utterances.length) {
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
  return '';
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
  throw new Error('豆包语音识别仍在处理中，请稍后重试');
}

function normalizeEvent(event) {
  return {
    method: event.httpMethod || event.method || 'GET',
    path: event.path || event.requestPath || '/',
    query: event.queryStringParameters || event.query || {},
    headers: event.headers || {},
    body: event.body || '',
  };
}

function normalizeBindDeviceLimit(bindCode) {
  const value = Number(bindCode && bindCode.deviceLimit) || DEFAULT_BIND_DEVICE_LIMIT;
  return Math.min(MAX_BIND_DEVICE_LIMIT, Math.max(DEFAULT_BIND_DEVICE_LIMIT, value));
}

function normalizeBindCodeInput(code) {
  const compact = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[‐-‒–—―]/g, '-')
    .replace(/[^A-Z0-9]/g, '');
  if (compact.length === 6) {
    return `${compact.slice(0, 3)}-${compact.slice(3)}`;
  }
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[‐-‒–—―]/g, '-')
    .replace(/\s+/g, '');
}

function getBindCodeLookupCandidates(code) {
  const normalized = normalizeBindCodeInput(code);
  if (!normalized) return [];
  const variants = [''];
  for (const char of normalized) {
    let choices = [char];
    if (char === 'O') choices = ['O', '0'];
    if (char === '0') choices = ['0', 'O'];
    if (char === 'I') choices = ['I', '1'];
    if (char === '1') choices = ['1', 'I'];
    const currentLength = variants.length;
    for (let index = 0; index < currentLength; index += 1) {
      const prefix = variants.shift();
      choices.forEach((choice) => variants.push(`${prefix}${choice}`));
    }
  }
  return Array.from(new Set(variants));
}

function getChinaLocalDay(now = new Date().toISOString()) {
  const date = new Date(now);
  const time = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getAnalyticsEventDocumentId(openid, eventName, day) {
  const safeOpenId = String(openid || '').replace(/[^A-Za-z0-9_-]/g, '_');
  return `analytics_${eventName}_${day}_${safeOpenId}`;
}

async function recordAnalyticsEvent(openid, eventName, payload = {}) {
  if (!openid || !eventName) return;
  const now = new Date().toISOString();
  const day = getChinaLocalDay(now);
  const documentId = getAnalyticsEventDocumentId(openid, eventName, day);
  if (typeof db.createCollection === 'function') {
    try {
      await db.createCollection('analytics_events');
    } catch (error) {
      // The collection already exists in normal use.
    }
  }
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
}

function normalizeBindClients(bindCode) {
  const seen = new Set();
  const clients = [];
  const source = Array.isArray(bindCode && bindCode.clients) ? bindCode.clients : [];

  source.forEach((item) => {
    const clientId = String((item && item.clientId) || '').trim();
    if (!clientId || seen.has(clientId)) return;
    seen.add(clientId);
    clients.push({
      clientId,
      name: String((item && item.name) || '').trim(),
      boundAt: (item && item.boundAt) || (bindCode && bindCode.boundAt) || '',
      lastSyncAt: (item && item.lastSyncAt) || '',
    });
  });

  const legacyClientId = String((bindCode && bindCode.clientId) || '').trim();
  if (legacyClientId && !seen.has(legacyClientId)) {
    clients.unshift({
      clientId: legacyClientId,
      name: '',
      boundAt: (bindCode && bindCode.boundAt) || '',
      lastSyncAt: '',
    });
  }

  return clients.slice(0, MAX_BIND_DEVICE_LIMIT);
}

function bindClientToCodeDocument(bindCode, clientId, now) {
  const normalizedClientId = String(clientId || '').trim();
  if (!bindCode || !normalizedClientId) {
    return { status: 'invalid' };
  }

  const status = bindCode.status || 'pending';
  if (status !== 'pending' && status !== 'bound') {
    return { status: 'invalid' };
  }

  const clients = normalizeBindClients(bindCode);
  const existing = clients.find((item) => item.clientId === normalizedClientId);
  if (existing) {
    return {
      status: 'bound',
      openid: bindCode.openid,
      boundAt: existing.boundAt || bindCode.boundAt || '',
      data: null,
    };
  }

  const deviceLimit = normalizeBindDeviceLimit(bindCode);
  if (clients.length >= deviceLimit) {
    return { status: 'already-bound' };
  }

  const boundAt = bindCode.boundAt || now;
  const nextClients = [
    ...clients,
    {
      clientId: normalizedClientId,
      name: '',
      boundAt: now,
      lastSyncAt: '',
    },
  ];

  return {
    status: 'bound',
    openid: bindCode.openid,
    boundAt,
    data: {
      status: 'bound',
      clientId: bindCode.clientId || nextClients[0].clientId,
      clients: nextClients,
      deviceLimit,
      boundAt,
    },
  };
}

function unbindClientFromCodeDocument(bindCode, clientId, now) {
  const normalizedClientId = String(clientId || '').trim();
  if (!bindCode || !normalizedClientId) {
    return { status: 'invalid' };
  }

  const clients = normalizeBindClients(bindCode);
  const nextClients = clients.filter((item) => item.clientId !== normalizedClientId);
  if (nextClients.length === clients.length) {
    return { status: 'not-found' };
  }

  const hasClients = nextClients.length > 0;
  return {
    status: 'updated',
    data: {
      status: hasClients ? 'bound' : 'pending',
      clientId: hasClients ? nextClients[0].clientId : '',
      clients: nextClients,
      boundAt: hasClients ? (bindCode.boundAt || nextClients[0].boundAt || now) : null,
      unboundAt: now,
    },
  };
}

function isBindClientAllowed(bindCode, clientId) {
  const normalizedClientId = String(clientId || '').trim();
  if (!bindCode || bindCode.status !== 'bound' || !normalizedClientId) return false;
  return normalizeBindClients(bindCode).some((item) => item.clientId === normalizedClientId);
}

function addDaysIso(now, days) {
  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return '';
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString();
}

function getDefaultCloudQuotaSeconds(durationDays) {
  const days = Number(durationDays) || 30;
  if (days <= 7) return 20 * 60;
  if (days <= 31) return 60 * 60;
  if (days <= 100) return 240 * 60;
  return 1000 * 60;
}

function getBuiltInRedeemCodeDocument(code, now = new Date().toISOString()) {
  if (normalizeRedeemCode(code) !== 'ZZAI0603') return null;
  return {
    code: 'ZZAI0603',
    status: 'active',
    plan: DEFAULT_REDEEM_PLAN,
    durationDays: 30,
    cloudQuotaSeconds: getDefaultCloudQuotaSeconds(30),
    maxRedemptions: 1,
    redeemedCount: 0,
    note: 'built-in-test-code',
    createdAt: now,
    updatedAt: now,
  };
}

function isRedeemCodeActive(codeDoc, now) {
  if (!codeDoc) return false;
  if (codeDoc.status && codeDoc.status !== 'active') return false;
  const expiresAt = codeDoc.expiresAt || '';
  if (expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime()) return false;
  const redeemedCount = Number(codeDoc.redeemedCount) || 0;
  return redeemedCount < 1;
}

function buildEntitlementState(entitlement, now = new Date().toISOString()) {
  if (!entitlement) {
    return {
      hasAccess: false,
      plan: '',
      status: 'inactive',
      expiresAt: '',
      code: '',
      source: '',
      durationDays: 0,
    };
  }
  const expiresAt = entitlement.expiresAt || '';
  const isExpired = expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime();
  const status = isExpired ? 'expired' : (entitlement.status || 'active');
  return {
    hasAccess: status === 'active',
    plan: entitlement.plan || DEFAULT_REDEEM_PLAN,
    status,
    expiresAt,
    code: normalizeRedeemCode(entitlement.code),
    source: entitlement.source || '',
    durationDays: Number(entitlement.durationDays) || 0,
  };
}

function createRepository() {
  return {
    async bindClientByToken(token, clientId) {
      const candidates = getBindCodeLookupCandidates(token);
      const result = await db
        .collection('bind_codes')
        .where({
          code: _.in(candidates),
          status: _.neq('revoked'),
        })
        .limit(1)
        .get();

      const bindCode = result.data && result.data[0] ? result.data[0] : null;
      if (!bindCode) {
        return { status: 'invalid' };
      }

      const boundAt = new Date().toISOString();
      const bindResult = bindClientToCodeDocument(bindCode, clientId, boundAt);
      if (!bindResult || bindResult.status === 'invalid') {
        return { status: 'invalid' };
      }
      if (bindResult.status === 'already-bound') {
        return { status: 'already-bound' };
      }
      if (bindResult.data) {
        await db.collection('bind_codes').doc(bindCode._id).update({
          data: bindResult.data,
        });
      }
      await recordAnalyticsEvent(bindResult.openid, 'bind_success', {
        clientId,
        status: bindResult.status,
      });

      return {
        status: 'bound',
        openid: bindResult.openid,
        boundAt: bindResult.boundAt || boundAt,
      };
    },

    async findOpenIdByToken(token, clientId) {
      const candidates = getBindCodeLookupCandidates(token);
      const result = await db
        .collection('bind_codes')
        .where({
          code: _.in(candidates),
          status: _.neq('revoked'),
        })
        .limit(1)
        .get();

      const bindCode = result.data && result.data[0] ? result.data[0] : null;
      if (!bindCode || bindCode.status !== 'bound') {
        return null;
      }

      return isBindClientAllowed(bindCode, clientId) ? bindCode.openid : null;
    },

    async unbindClientByToken(token, clientId) {
      const candidates = getBindCodeLookupCandidates(token);
      const result = await db
        .collection('bind_codes')
        .where({
          code: _.in(candidates),
          status: _.neq('revoked'),
        })
        .limit(1)
        .get();

      const bindCode = result.data && result.data[0] ? result.data[0] : null;
      if (!bindCode) {
        return { status: 'invalid' };
      }

      const unboundAt = new Date().toISOString();
      const unbindResult = unbindClientFromCodeDocument(bindCode, clientId, unboundAt);
      if (!unbindResult || unbindResult.status === 'invalid') {
        return { status: 'invalid' };
      }
      if (unbindResult.status === 'not-found') {
        return { status: 'not-found' };
      }

      await db.collection('bind_codes').doc(bindCode._id).update({
        data: unbindResult.data,
      });

      return {
        status: 'updated',
      };
    },

    async getEntitlement(openid, plan) {
      if (isLocalTranscriptionPlan(plan)) {
        const result = await db
          .collection('user_entitlements')
          .where({
            openid,
          })
          .limit(100)
          .get();

        return pickBestLocalTranscriptionEntitlement(result.data || []);
      }

      const result = await db
        .collection('user_entitlements')
        .where({
          openid,
          plan,
          status: 'active',
        })
        .orderBy('redeemedAt', 'desc')
        .limit(1)
        .get();

      return result.data && result.data[0] ? result.data[0] : null;
    },

    async redeemAccessCode(openid, code) {
      const now = new Date().toISOString();
      const codeResult = await db
        .collection('redeem_codes')
        .where({ code })
        .limit(1)
        .get();
      const codeDoc = codeResult.data && codeResult.data[0] ? codeResult.data[0] : null;
      const effectiveCodeDoc = codeDoc || getBuiltInRedeemCodeDocument(code, now);
      if (!isRedeemCodeActive(effectiveCodeDoc, now)) {
        const error = new Error('兑换码无效、已过期或已被使用');
        error.code = 'INVALID_REDEEM_CODE';
        throw error;
      }

      const plan = effectiveCodeDoc.plan || DEFAULT_REDEEM_PLAN;
      const entitlement = {
        openid,
        plan,
        status: 'active',
        source: 'redeem_code',
        code,
        durationDays: Number(effectiveCodeDoc.durationDays) || 30,
        cloudQuotaSeconds: Number(effectiveCodeDoc.cloudQuotaSeconds)
          || getDefaultCloudQuotaSeconds(Number(effectiveCodeDoc.durationDays) || 30),
        cloudUsedSeconds: Number(effectiveCodeDoc.cloudUsedSeconds) || 0,
        redeemedAt: now,
        expiresAt: effectiveCodeDoc.entitlementExpiresAt || effectiveCodeDoc.accessExpiresAt || addDaysIso(now, effectiveCodeDoc.durationDays),
        updatedAt: now,
      };

      const currentResult = await db
        .collection('user_entitlements')
        .where({
          openid,
          plan,
          status: 'active',
        })
        .orderBy('redeemedAt', 'desc')
        .limit(1)
        .get();
      const current = currentResult.data && currentResult.data[0] ? currentResult.data[0] : null;
      if (current) {
        await db.collection('user_entitlements').doc(current._id).update({ data: entitlement });
      } else {
        await db.collection('user_entitlements').add({ data: entitlement });
      }

      const updateData = {
        redeemedCount: _.inc(1),
        lastRedeemedAt: now,
        lastRedeemedOpenId: openid,
        status: 'redeemed',
        updatedAt: now,
      };
      if (effectiveCodeDoc._id) {
        await db.collection('redeem_codes').doc(effectiveCodeDoc._id).update({ data: updateData });
      }

      return buildEntitlementState(entitlement, now);
    },

    async listPendingRecords(openid) {
      const result = await db
        .collection('inbox_records')
        .where({
          openid,
          status: _.neq('synced'),
        })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      return result.data || [];
    },

    async markRecordSynced(openid, recordId) {
      const syncedAt = new Date().toISOString();

      const recordResult = await db
        .collection('inbox_records')
        .where({
          _id: recordId,
          openid,
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
            syncedAt,
            fileIds,
            cleanupError,
          }),
        });

      return {
        id: recordId,
        status: 'synced',
        syncedAt,
        cleaned: true,
        deletedFileCount: fileIds.length,
        cleanupError,
      };
    },

    async isFileOwnedByOpenId(openid, fileID) {
      const normalizedFileID = String(fileID || '').trim();
      if (!normalizedFileID) return false;

      const result = await db
        .collection('inbox_records')
        .where(_.or([
          {
            openid,
            'metadata.fileID': normalizedFileID,
          },
          {
            openid,
            'metadata.audioFileID': normalizedFileID,
          },
        ]))
        .limit(1)
        .get();

      return Boolean(result.data && result.data.length);
    },

    async getTempFileURL(openid, fileID) {
      const result = await cloud.getTempFileURL({
        fileList: [fileID],
      });
      const file = result.fileList && result.fileList[0];
      if (!file || !file.tempFileURL) {
        throw new Error('Failed to create temp file URL');
      }
      return {
        fileID,
        tempFileURL: file.tempFileURL,
      };
    },

    async transcribeCloudAudio(openid, payload) {
      const audioUrl = payload.audioUrl
        ? String(payload.audioUrl).trim()
        : (await this.getTempFileURL(openid, payload.fileID)).tempFileURL;
      if (!/^https?:\/\//i.test(audioUrl)) {
        throw new Error('Cloud transcription audio URL is invalid');
      }
      const result = await runDoubaoCloudTranscription(audioUrl);
      const billedSeconds = Math.max(
        60,
        Math.ceil(Number(payload.durationSeconds) || 0),
        Math.ceil(Number(result.durationSeconds) || 0),
      );
      return {
        ...result,
        billedSeconds,
      };
    },

    async prepareWebpageMedia(openid, payload) {
      const pageUrl = String(payload && payload.url || '').trim();
      const resolverUrl = getMediaResolverUrl();
      if (!isHttpUrl(pageUrl)) {
        throw new Error('Media prepare URL is invalid');
      }
      if (!resolverUrl || !isHttpUrl(resolverUrl)) {
        throw new Error('MEDIA_RESOLVER_URL is not configured');
      }
      const secret = getMediaResolverSecret();
      const response = await postJson({
        url: resolverUrl,
        headers: secret ? { 'x-resolver-secret': secret } : {},
        body: {
          url: pageUrl,
          recordId: payload.recordId || '',
        },
        timeoutMs: MEDIA_RESOLVER_TIMEOUT_MS,
      });
      if (!response.status || response.status < 200 || response.status >= 300) {
        const errorPayload = response.json || {};
        throw new Error(errorPayload.errMsg || response.text || `Media resolver HTTP ${response.status}`);
      }
      const data = response.json && response.json.data ? response.json.data : {};
      const mediaUrl = normalizeResolverMediaUrl(data.mediaUrl, resolverUrl, data);
      if (!isHttpUrl(mediaUrl)) {
        throw new Error('Media resolver returned empty media URL');
      }
      if (isMediaPrepareCacheEnabled()) {
        const downloaded = await downloadPreparedMedia(mediaUrl, data.headers || {});
        const now = Date.now();
        const ext = getPreparedMediaExt(mediaUrl);
        const openidPart = sanitizeCloudPathPart(openid);
        const recordPart = sanitizeCloudPathPart(payload.recordId || createRequestId());
        const cloudPath = `prepared-media/${openidPart}/${recordPart}-${now}.${ext}`;
        const upload = await cloud.uploadFile({
          cloudPath,
          fileContent: downloaded.buffer,
        });
        const fileID = upload.fileID || '';
        const tempUrlResult = await cloud.getTempFileURL({
          fileList: [fileID],
        });
        const file = tempUrlResult.fileList && tempUrlResult.fileList[0] ? tempUrlResult.fileList[0] : {};
        const tempFileURL = file.tempFileURL || '';
        if (!isHttpUrl(tempFileURL)) {
          throw new Error('Failed to create prepared media temp URL');
        }
        return {
          mediaUrl: tempFileURL,
          audioUrl: tempFileURL,
          originalMediaUrl: mediaUrl,
          preparedFileID: fileID,
          cached: true,
          mediaPreparedByCloud: true,
          source: String(data.source || 'media-resolver'),
          title: String(data.title || ''),
          durationSeconds: Number(data.durationSeconds || 0) || 0,
          expiresAt: new Date(Date.now() + getMediaPrepareCacheTtlMs()).toISOString(),
        };
      }
      return {
        mediaUrl,
        audioUrl: mediaUrl,
        originalMediaUrl: String(data.originalMediaUrl || ''),
        preparedFileID: '',
        cached: false,
        mediaPreparedByCloud: false,
        source: String(data.source || 'media-resolver'),
        title: String(data.title || ''),
        durationSeconds: Number(data.durationSeconds || 0) || 0,
        expiresAt: data.expiresAt || '',
      };
    },

    async recordCloudTranscriptionUsage(openid, usage) {
      const now = usage.createdAt || new Date().toISOString();
      if (typeof db.createCollection === 'function') {
        try {
          await db.createCollection('cloud_transcription_usages');
        } catch (error) {
          // Collection already exists.
        }
      }
      await db.collection('cloud_transcription_usages').add({
        data: {
          openid,
          fileID: usage.fileID,
          usedSeconds: Number(usage.usedSeconds) || 0,
          remainingSeconds: Number(usage.remainingSeconds) || 0,
          quotaSeconds: Number(usage.quotaSeconds) || 0,
          previousUsedSeconds: Number(usage.previousUsedSeconds) || 0,
          provider: usage.provider || 'doubao',
          requestId: usage.requestId || '',
          localError: usage.localError || '',
          createdAt: now,
        },
      });

      const entitlement = await this.getEntitlement(openid, DEFAULT_REDEEM_PLAN);
      if (entitlement && entitlement._id) {
        await db.collection('user_entitlements').doc(entitlement._id).update({
          data: {
            cloudUsedSeconds: _.inc(Number(usage.usedSeconds) || 0),
            cloudLastUsedAt: now,
            updatedAt: now,
          },
        });
      }
    },

    async saveTranscriptionPreferences(openid, preferences) {
      const now = new Date().toISOString();
      if (typeof db.createCollection === 'function') {
        try {
          await db.createCollection('user_transcription_settings');
        } catch (error) {
          // Collection already exists.
        }
      }
      const data = {
        openid,
        cloudPreTranscriptionEnabled: Boolean(preferences.cloudPreTranscriptionEnabled),
        cloudPreTranscriptionThresholdMinutes: Number(preferences.cloudPreTranscriptionThresholdMinutes) || 10,
        updatedAt: now,
      };
      const result = await db
        .collection('user_transcription_settings')
        .where({ openid })
        .limit(1)
        .get();
      const current = result.data && result.data[0] ? result.data[0] : null;
      if (current && current._id) {
        await db.collection('user_transcription_settings').doc(current._id).update({ data });
      } else {
        await db.collection('user_transcription_settings').add({ data: { ...data, createdAt: now } });
      }
      return data;
    },

    async handleAdminRequest(request) {
      return await handleAdminConsoleRequest(request);
    },
  };
}

const repository = createRepository();

exports.main = async (event) => {
  return handleSyncApiRequest({
    request: normalizeEvent(event),
    repository,
  });
};
