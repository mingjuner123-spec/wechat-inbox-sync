const DEFAULT_REDEEM_PLAN = 'local_transcription_beta';
const DEFAULT_CLOUD_TRANSCRIPTION_QUOTA_SECONDS = 0;
const CLOUD_TRANSCRIPTION_MIN_BILL_SECONDS = 60;
const { buildInboxRecordDedupeKey, isAudioVideoWebpageUrl } = require('./inbox-core');
const {
  parseVirtualPaymentNotifyBody,
  verifyWechatMessageSignature,
  createVirtualPaymentNotifyResponse,
} = require('./payment-core');

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
      cloudQuotaSeconds: 0,
      cloudUsedSeconds: 0,
      cloudRemainingSeconds: 0,
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
    cloudQuotaSeconds: Number(entitlement.cloudQuotaSeconds) || 0,
    cloudUsedSeconds: Number(entitlement.cloudUsedSeconds) || 0,
    cloudRemainingSeconds: Math.max(0, (Number(entitlement.cloudQuotaSeconds) || 0) - (Number(entitlement.cloudUsedSeconds) || 0)),
  };
}

function normalizeRedeemCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[‐-‒–—―]/g, '-')
    .replace(/\s+/g, '');
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type,x-admin-secret,authorization,x-wechat-inbox-client-id',
    },
    body: JSON.stringify(payload),
  };
}

function textResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type,x-admin-secret,authorization,x-wechat-inbox-client-id',
    },
    body: String(body || ''),
  };
}

function isRedeemCodeBusinessError(error) {
  const code = error && error.code ? String(error.code) : '';
  const message = error && error.message ? String(error.message) : String(error || '');
  return code === 'INVALID_REDEEM_CODE'
    || message.includes('兑换码无效')
    || message.includes('已过期')
    || message.includes('已被使用');
}

function getHeader(headers, name) {
  const target = name.toLowerCase();
  const found = Object.keys(headers || {}).find((key) => key.toLowerCase() === target);
  return found ? headers[found] : '';
}

function parseBearerToken(headers) {
  const authorization = getHeader(headers, 'authorization');
  const match = String(authorization || '').match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return String(getHeader(headers, 'x-wechat-inbox-token') || '').trim();
}

function parseAuthToken(request) {
  const headerToken = parseBearerToken(request && request.headers);
  if (headerToken) return headerToken;
  const query = (request && request.query) || {};
  const body = parseJsonBody(request && request.body);
  return String(
    query.authToken
    || query.token
    || body.authToken
    || body.token
    || ''
  ).trim();
}

function parseJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(String(body));
  } catch (error) {
    return {};
  }
}

function parseClientId(request) {
  const headerClientId = getHeader(request.headers, 'x-wechat-inbox-client-id');
  if (headerClientId) return String(headerClientId).trim();
  const query = request.query || {};
  if (query.clientId) return String(query.clientId).trim();
  const body = parseJsonBody(request.body);
  return String((body && body.clientId) || '').trim();
}

function extractSyncedRecordId(path) {
  const match = String(path || '').match(/\/records\/([^/]+)\/synced$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function isBindPath(path) {
  const normalized = String(path || '');
  return normalized === '/bind' || normalized.endsWith('/bind');
}

function isUnbindSelfPath(path) {
  const normalized = String(path || '');
  return normalized === '/unbind-self' || normalized.endsWith('/unbind-self');
}

function isRecordsPath(path) {
  return String(path || '') === '/records' || String(path || '').endsWith('/records');
}

function isDownloadUrlPath(path) {
  const normalized = String(path || '');
  return normalized === '/files/download-url'
    || normalized === '/download-url'
    || normalized.endsWith('/files/download-url')
    || normalized.endsWith('/download-url');
}

function isEntitlementStatusPath(path) {
  const normalized = String(path || '');
  return normalized === '/entitlements/status' || normalized.endsWith('/entitlements/status');
}

function isEntitlementRedeemPath(path) {
  const normalized = String(path || '');
  return normalized === '/entitlements/redeem' || normalized.endsWith('/entitlements/redeem');
}

function isEntitlementAutoRedeemPath(path) {
  const normalized = String(path || '');
  return normalized === '/entitlements/auto-redeem' || normalized.endsWith('/entitlements/auto-redeem');
}

function isCloudTranscriptionPath(path) {
  const normalized = String(path || '');
  return normalized === '/transcriptions/cloud' || normalized.endsWith('/transcriptions/cloud');
}

function isMediaPreparePath(path) {
  const normalized = String(path || '');
  return normalized === '/media/prepare' || normalized.endsWith('/media/prepare');
}

function isTranscriptionPreferencesPath(path) {
  const normalized = String(path || '');
  return normalized === '/transcription-preferences' || normalized.endsWith('/transcription-preferences');
}

function isMetadataGeneratePath(path) {
  const normalized = String(path || '');
  return normalized === '/metadata/generate' || normalized.endsWith('/metadata/generate');
}

function isOcrImagesPath(path) {
  const normalized = String(path || '');
  return normalized === '/ocr/images' || normalized.endsWith('/ocr/images');
}

function isVirtualPaymentNotifyPath(path) {
  const normalized = String(path || '');
  return normalized === '/virtual-payment/notify'
    || normalized.endsWith('/virtual-payment/notify')
    || normalized === '/payment/virtual/notify'
    || normalized.endsWith('/payment/virtual/notify');
}

function isFeishuOAuthStartPath(path) {
  const normalized = String(path || '');
  return normalized === '/feishu/oauth/start' || normalized.endsWith('/feishu/oauth/start');
}

function isFeishuOAuthStatusPath(path) {
  const normalized = String(path || '');
  return normalized === '/feishu/oauth/status' || normalized.endsWith('/feishu/oauth/status');
}

function isFeishuOAuthCallbackPath(path) {
  const normalized = String(path || '');
  return normalized === '/feishu/oauth/callback' || normalized.endsWith('/feishu/oauth/callback');
}

function isFeishuExtractPath(path) {
  const normalized = String(path || '');
  return normalized === '/feishu/extract' || normalized.endsWith('/feishu/extract');
}

function getVirtualPaymentNotifyToken(repository) {
  if (!repository) return '';
  if (typeof repository.getVirtualPaymentNotifyToken === 'function') {
    return String(repository.getVirtualPaymentNotifyToken() || '').trim();
  }
  return String(repository.virtualPaymentNotifyToken || '').trim();
}

function isVirtualPaymentNotifySignatureValid(request, repository) {
  const query = request.query || {};
  return verifyWechatMessageSignature({
    token: getVirtualPaymentNotifyToken(repository),
    timestamp: query.timestamp,
    nonce: query.nonce,
    signature: query.signature,
  });
}

async function handleVirtualPaymentNotifyRequest({ request, repository }) {
  const method = String(request.method || '').toUpperCase();
  if (!isVirtualPaymentNotifySignatureValid(request, repository)) {
    if (method === 'GET') return textResponse(403, 'invalid signature');
    return jsonResponse(403, createVirtualPaymentNotifyResponse(-1, 'invalid signature'));
  }
  if (method === 'GET') {
    return textResponse(200, request.query && request.query.echostr || '');
  }
  if (typeof repository.handleVirtualPaymentNotify !== 'function') {
    return jsonResponse(500, createVirtualPaymentNotifyResponse(-1, 'notify handler unavailable'));
  }
  const notify = parseVirtualPaymentNotifyBody(request.body);
  await repository.handleVirtualPaymentNotify(notify);
  return jsonResponse(200, createVirtualPaymentNotifyResponse());
}

async function handleFeishuOAuthCallbackRequest({ request, repository }) {
  if (typeof repository.completeFeishuOAuthCallback !== 'function') {
    return textResponse(500, 'Feishu OAuth callback handler is unavailable');
  }
  const query = request.query || {};
  const state = String(query.state || '').trim();
  const error = String(query.error || '').trim();
  if (error) {
    return textResponse(400, `Feishu authorization denied: ${error}`);
  }
  const code = String(query.code || '').trim();
  if (!code || !state) {
    return textResponse(400, 'Missing Feishu OAuth code or state');
  }
  await repository.completeFeishuOAuthCallback({ code, state });
  return textResponse(200, 'Feishu connected. You can return to Obsidian now.');
}

async function handleFeishuOAuthStartRequest({
  request, repository, openid, clientId, token,
}) {
  if (typeof repository.createFeishuOAuthStart !== 'function') {
    return jsonResponse(500, {
      success: false,
      errMsg: 'Feishu OAuth start handler is unavailable',
    });
  }
  const body = parseJsonBody(request.body);
  const data = await repository.createFeishuOAuthStart(openid, clientId, request, body, token);
  return jsonResponse(200, {
    success: true,
    data,
  });
}

async function handleFeishuOAuthStatusRequest({
  repository, openid, clientId, token,
}) {
  if (typeof repository.getFeishuOAuthStatus !== 'function') {
    return jsonResponse(200, {
      success: true,
      data: {
        connected: false,
        errMsg: 'Feishu OAuth is not configured',
      },
    });
  }
  const data = await repository.getFeishuOAuthStatus(openid, clientId, token);
  return jsonResponse(200, {
    success: true,
    data,
  });
}

async function handleFeishuExtractRequest({
  request, repository, openid, clientId, token,
}) {
  if (typeof repository.extractFeishuDocument !== 'function') {
    return jsonResponse(500, {
      success: false,
      errMsg: 'Feishu extraction handler is unavailable',
    });
  }
  const body = parseJsonBody(request.body);
  const url = String(body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return jsonResponse(400, {
      success: false,
      errMsg: 'Missing Feishu document URL',
    });
  }
  const data = await repository.extractFeishuDocument(openid, clientId, { ...body, url }, token);
  return jsonResponse(200, {
    success: true,
    data,
  });
}

function normalizeTranscriptionPreferences(body) {
  const threshold = Number(body.cloudPreTranscriptionThresholdMinutes);
  const allowedThresholds = [10, 30, 60];
  return {
    cloudPreTranscriptionEnabled: Boolean(body.cloudPreTranscriptionEnabled),
    cloudPreTranscriptionThresholdMinutes: allowedThresholds.includes(threshold) ? threshold : 10,
  };
}

function normalizePositiveSeconds(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.ceil(number);
}

function getEntitlementCloudQuotaSeconds(entitlement) {
  return normalizePositiveSeconds(
    entitlement && (
      entitlement.cloudQuotaSeconds
      || entitlement.cloudQuota
      || entitlement.cloudQuotaMinutes && Number(entitlement.cloudQuotaMinutes) * 60
    ),
    DEFAULT_CLOUD_TRANSCRIPTION_QUOTA_SECONDS,
  );
}

function getEntitlementCloudUsedSeconds(entitlement) {
  return normalizePositiveSeconds(
    entitlement && (
      entitlement.cloudUsedSeconds
      || entitlement.cloudTranscriptionUsedSeconds
      || entitlement.cloudUsedMinutes && Number(entitlement.cloudUsedMinutes) * 60
    ),
    0,
  );
}

function buildCloudQuotaState(entitlement, requestedSeconds) {
  const quotaSeconds = getEntitlementCloudQuotaSeconds(entitlement);
  const usedSeconds = getEntitlementCloudUsedSeconds(entitlement);
  const billableSeconds = Math.max(
    CLOUD_TRANSCRIPTION_MIN_BILL_SECONDS,
    normalizePositiveSeconds(requestedSeconds, CLOUD_TRANSCRIPTION_MIN_BILL_SECONDS),
  );
  return {
    quotaSeconds,
    usedSeconds,
    billableSeconds,
    remainingSeconds: Math.max(0, quotaSeconds - usedSeconds),
  };
}

function collectRecordFileIds(record) {
  const metadata = (record && record.metadata) || {};
  const candidates = [metadata.audioFileID, metadata.fileID];
  return Array.from(new Set(candidates
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

function shouldKeepRecordPendingForTranscription(record) {
  const normalizedRecord = normalizeSyncableRecord(record);
  const metadata = (normalizedRecord && normalizedRecord.metadata) || {};
  const status = String(metadata.transcriptionStatus || '').toLowerCase();
  const hasTranscription = String(metadata.transcription || '').trim().length > 0;
  const mode = String(metadata.transcriptionMode || '').toLowerCase();
  const cloudRequested = mode === 'cloud'
    || metadata.cloudTranscriptionRequested === true
    || metadata.transcriptionSource === 'cloud-pretranscription'
    || Boolean(metadata.doubaoRequestId);
  const isAudioVideoRecord = String(record && record.type || '').toLowerCase() === 'voice'
    || metadata.webpageMediaType === 'audio_video'
    || Boolean(metadata.audioFileID)
    || metadata.transcriptOnly === true;
  if (!isAudioVideoRecord || hasTranscription) return false;
  if (mode === 'local' || !cloudRequested) return false;
  return ['pending', 'queued', 'processing', 'failed'].includes(status);
}

function hasAlreadySyncedEvidence(record) {
  if (!record) return false;
  if (String(record.status || '').toLowerCase() === 'synced') return true;
  if (String(record.syncedAt || '').trim()) return true;
  const metadata = record.metadata || {};
  const cleanupStatus = String(metadata.cleanupStatus || '').toLowerCase();
  return cleanupStatus === 'cleaned'
    || cleanupStatus === 'storage-delete-failed'
    || Boolean(String(metadata.cleanedAt || '').trim());
}

function getRecordDedupeKey(record) {
  const storedKey = String(record && record.dedupeKey || '').trim();
  if (storedKey) return storedKey;
  try {
    return buildInboxRecordDedupeKey(record);
  } catch (error) {
    return '';
  }
}

function normalizeSyncableRecord(record) {
  const metadata = (record && record.metadata) || {};
  const url = metadata.url || (record && record.content) || '';
  const shareText = metadata.shareText || (record && record.content) || '';
  const isXhsUrl = /(?:xhslink\.com|xiaohongshu\.com)/i.test(String(url || ''));
  if (
    String(record && record.type || '').toLowerCase() === 'webpage'
    && isXhsUrl
    && metadata.webpageMediaType === 'audio_video'
    && !isAudioVideoWebpageUrl(url, shareText)
  ) {
    const nextMetadata = { ...metadata };
    delete nextMetadata.webpageMediaType;
    delete nextMetadata.transcriptionStatus;
    delete nextMetadata.transcriptionMode;
    delete nextMetadata.cloudTranscriptionRequested;
    delete nextMetadata.cloudTranscriptionReason;
    delete nextMetadata.transcriptionSource;
    return {
      ...record,
      metadata: nextMetadata,
    };
  }
  return record;
}

function filterSyncableRecords(records = []) {
  const syncedKeys = new Set();
  for (const record of records || []) {
    if (!hasAlreadySyncedEvidence(record)) continue;
    const key = getRecordDedupeKey(record);
    if (key) syncedKeys.add(key);
  }
  const pendingKeys = new Set();
  return (records || []).filter((record) => {
    if (hasAlreadySyncedEvidence(record)) return false;
    const key = getRecordDedupeKey(record);
    if (!key) return true;
    if (syncedKeys.has(key) || pendingKeys.has(key)) return false;
    pendingKeys.add(key);
    return true;
  }).map(normalizeSyncableRecord);
}

async function requireOpenId(request, repository) {
  const token = parseAuthToken(request);
  const clientId = parseClientId(request);
  if (!token) {
    return {
      error: jsonResponse(401, {
        success: false,
        errMsg: 'Missing bearer token',
      }),
    };
  }

  const openid = await repository.findOpenIdByToken(token, clientId);
  if (!openid) {
    return {
      error: jsonResponse(403, {
        success: false,
        errMsg: 'Invalid or expired token',
      }),
    };
  }

  return { openid, clientId, token };
}

async function handleBindRequest({ request, repository }) {
  const token = parseBearerToken(request.headers);
  if (!token) {
    return jsonResponse(401, {
      success: false,
      errMsg: 'Missing bearer token',
    });
  }

  const clientId = parseClientId(request);
  if (!clientId) {
    return jsonResponse(400, {
      success: false,
      errMsg: 'Missing client ID',
    });
  }

  const result = await repository.bindClientByToken(token, clientId);
  if (!result || result.status === 'invalid') {
    return jsonResponse(403, {
      success: false,
      errMsg: 'Invalid bind code',
    });
  }

  if (result.status === 'already-bound') {
    return jsonResponse(409, {
      success: false,
      errMsg: 'Bind code already bound',
    });
  }

  if (result.status === 'plugin-binding-limit-exceeded') {
    return jsonResponse(403, {
      success: false,
      errCode: 'PLUGIN_BINDING_LIMIT_EXCEEDED',
      errMsg: result.errMsg || '免费版最多绑定 1 个微信，开通 Pro 后可绑定 3 个。',
      data: {
        currentCount: Number(result.currentCount) || 0,
        limit: Number(result.limit) || 1,
        hasProBinding: Boolean(result.hasProBinding),
      },
    });
  }

  return jsonResponse(200, {
    success: true,
    data: {
      status: 'bound',
      boundAt: result.boundAt || '',
    },
  });
}

async function handleUnbindSelfRequest({ request, repository }) {
  const token = parseBearerToken(request.headers);
  const clientId = parseClientId(request);

  const auth = await requireOpenId(request, repository);
  if (auth.error) return auth.error;

  if (!token || !clientId || typeof repository.unbindClientByToken !== 'function') {
    return jsonResponse(400, {
      success: false,
      errMsg: 'Missing unbind parameters',
    });
  }

  const result = await repository.unbindClientByToken(token, clientId);
  if (!result || result.status === 'invalid') {
    return jsonResponse(403, {
      success: false,
      errMsg: 'Invalid bind code',
    });
  }

  return jsonResponse(200, {
    success: true,
    data: {
      status: 'unbound',
    },
  });
}

async function handleEntitlementStatusRequest({
  request, repository, openid, clientId,
}) {
  const plan = String((request.query && request.query.plan) || DEFAULT_REDEEM_PLAN).trim() || DEFAULT_REDEEM_PLAN;
  const entitlement = typeof repository.getEntitlement === 'function'
    ? await repository.getEntitlement(openid, plan, { clientId })
    : null;
  return jsonResponse(200, {
    success: true,
    data: buildEntitlementState(entitlement),
  });
}

async function handleEntitlementRedeemRequest({
  request, repository, openid, clientId,
}) {
  const body = parseJsonBody(request.body);
  const code = normalizeRedeemCode(body.code);
  if (!code) {
    return jsonResponse(400, {
      success: false,
      errMsg: 'Missing redeem code',
    });
  }
  if (typeof repository.redeemAccessCode !== 'function') {
    return jsonResponse(501, {
      success: false,
      errMsg: 'Redeem API is not available',
    });
  }
  let state;
  try {
    state = await repository.redeemAccessCode(openid, code, { clientId });
  } catch (error) {
    if (isRedeemCodeBusinessError(error)) {
      return jsonResponse(400, {
        success: false,
        errCode: 'INVALID_REDEEM_CODE',
        errMsg: error.message || '兑换码无效、已过期或已被使用',
      });
    }
    throw error;
  }
  return jsonResponse(200, {
    success: true,
    data: state,
  });
}

async function handleEntitlementAutoRedeemRequest({
  repository, openid, clientId,
}) {
  const current = typeof repository.getEntitlement === 'function'
    ? await repository.getEntitlement(openid, DEFAULT_REDEEM_PLAN, { clientId })
    : null;
  const currentState = buildEntitlementState(current);
  if (currentState.hasAccess) {
    return jsonResponse(200, {
      success: true,
      data: {
        ...currentState,
        autoRedeemed: false,
      },
    });
  }
  if (typeof repository.autoRedeemAccessCode !== 'function') {
    return jsonResponse(501, {
      success: false,
      errMsg: 'Auto redeem API is not available',
    });
  }
  let state;
  try {
    state = await repository.autoRedeemAccessCode(openid, { clientId });
  } catch (error) {
    if (isRedeemCodeBusinessError(error)) {
      return jsonResponse(404, {
        success: false,
        errCode: 'NO_AVAILABLE_REDEEM_CODE',
        errMsg: error.message || 'No available redeem code',
      });
    }
    throw error;
  }
  return jsonResponse(200, {
    success: true,
    data: {
      ...state,
      autoRedeemed: true,
    },
  });
}

async function handleCloudTranscriptionRequest({
  request, repository, openid, clientId,
}) {
  const body = parseJsonBody(request.body);
  const fileID = String(body.fileID || body.audioFileID || '').trim();
  const audioUrl = String(body.audioUrl || body.mediaUrl || '').trim();
  const hasAudioUrl = /^https?:\/\//i.test(audioUrl);
  if (!fileID && !hasAudioUrl) {
    return jsonResponse(400, {
      success: false,
      errMsg: 'Missing fileID or audioUrl',
    });
  }
  if (fileID && typeof repository.isFileOwnedByOpenId === 'function') {
    const isOwned = await repository.isFileOwnedByOpenId(openid, fileID);
    if (!isOwned) {
      return jsonResponse(403, {
        success: false,
        errMsg: 'File does not belong to current user',
      });
    }
  }
  const entitlement = typeof repository.getEntitlement === 'function'
    ? await repository.getEntitlement(openid, DEFAULT_REDEEM_PLAN, { clientId })
    : null;
  const entitlementState = buildEntitlementState(entitlement);
  if (!entitlementState.hasAccess) {
    return jsonResponse(403, {
      success: false,
      errCode: 'PRO_REQUIRED',
      errMsg: 'Pro membership is required for cloud transcription',
    });
  }
  const durationSeconds = normalizePositiveSeconds(body.durationSeconds, CLOUD_TRANSCRIPTION_MIN_BILL_SECONDS);
  const quota = buildCloudQuotaState(entitlement, durationSeconds);
  if (quota.remainingSeconds < quota.billableSeconds) {
    return jsonResponse(402, {
      success: false,
      errCode: 'CLOUD_QUOTA_EXCEEDED',
      errMsg: 'Cloud transcription quota exceeded',
      data: {
        quotaSeconds: quota.quotaSeconds,
        usedSeconds: quota.usedSeconds,
        remainingSeconds: quota.remainingSeconds,
        requestedSeconds: quota.billableSeconds,
      },
    });
  }
  if (typeof repository.transcribeCloudAudio !== 'function') {
    return jsonResponse(501, {
      success: false,
      errMsg: 'Cloud transcription is not available',
    });
  }
  const result = await repository.transcribeCloudAudio(openid, {
    fileID,
    audioUrl,
    durationSeconds: quota.billableSeconds,
    localError: String(body.localError || '').slice(0, 1000),
    source: String(body.source || '').slice(0, 100),
    title: String(body.title || '').slice(0, 300),
  });
  const transcription = String(result && result.transcription || '').trim();
  if (!transcription) {
    return jsonResponse(502, {
      success: false,
      errMsg: 'Cloud transcription returned empty result',
    });
  }
  const usedSeconds = normalizePositiveSeconds(result && result.billedSeconds, quota.billableSeconds);
  const remainingSeconds = Math.max(0, quota.remainingSeconds - usedSeconds);
  if (typeof repository.recordCloudTranscriptionUsage === 'function') {
    await repository.recordCloudTranscriptionUsage(openid, {
      fileID: fileID || audioUrl,
      usedSeconds,
      remainingSeconds,
      quotaSeconds: quota.quotaSeconds,
      previousUsedSeconds: quota.usedSeconds,
      provider: result.provider || 'cloud',
      requestId: result.requestId || '',
      localError: String(body.localError || '').slice(0, 1000),
      createdAt: new Date().toISOString(),
    });
  }
  return jsonResponse(200, {
    success: true,
    data: {
      transcription,
      provider: result.provider || 'cloud',
      requestId: result.requestId || '',
      usedSeconds,
      remainingSeconds,
    },
  });
}

async function handleMediaPrepareRequest({ request, repository, openid }) {
  const body = parseJsonBody(request.body);
  const url = String(body.url || body.pageUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return jsonResponse(400, {
      success: false,
      errMsg: 'Missing or invalid url',
    });
  }
  if (typeof repository.prepareWebpageMedia !== 'function') {
    return jsonResponse(501, {
      success: false,
      errMsg: 'Media preparation is not available',
    });
  }
  const data = await repository.prepareWebpageMedia(openid, {
    url,
    recordId: String(body.recordId || '').trim(),
    source: String(body.source || '').slice(0, 100),
    title: String(body.title || '').slice(0, 300),
  });
  const mediaUrl = String(data && (data.mediaUrl || data.audioUrl) || '').trim();
  if (!/^https?:\/\//i.test(mediaUrl)) {
    return jsonResponse(422, {
      success: false,
      errMsg: 'No transcribable media URL was prepared',
      data: data || null,
    });
  }
  return jsonResponse(200, {
    success: true,
    data: {
      mediaUrl,
      audioUrl: String(data.audioUrl || mediaUrl),
      originalMediaUrl: String(data.originalMediaUrl || ''),
      preparedFileID: String(data.preparedFileID || ''),
      cached: Boolean(data.cached),
      mediaPreparedByCloud: Boolean(data.mediaPreparedByCloud || data.cached),
      source: String(data.source || 'media-prepare'),
      title: String(data.title || ''),
      durationSeconds: Number(data.durationSeconds || 0) || 0,
      expiresAt: String(data.expiresAt || ''),
    },
  });
}

async function handleTranscriptionPreferencesRequest({ request, repository, openid }) {
  if (typeof repository.saveTranscriptionPreferences !== 'function') {
    return jsonResponse(501, {
      success: false,
      errMsg: 'Transcription preferences API is not available',
    });
  }
  const body = parseJsonBody(request.body);
  const preferences = normalizeTranscriptionPreferences(body);
  const saved = await repository.saveTranscriptionPreferences(openid, preferences);
  return jsonResponse(200, {
    success: true,
    data: normalizeTranscriptionPreferences(saved || preferences),
  });
}

function parseAdminBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try {
    return JSON.parse(body);
  } catch (error) {
    return {};
  }
}

function getAdminPath(path) {
  const normalized = String(path || '')
    .replace(/^\/sync/, '')
    .replace(/^\/admin/, '')
    .replace(/\/+$/, '');
  return normalized || '/summary';
}

function normalizeGeneratedKeywords(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(/[,，、\n#]+/);
  const seen = new Set();
  return list
    .map((item) => String(item || '').replace(/^#+/, '').trim())
    .filter((item) => item && item.length <= 24)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function normalizeGeneratedMetadataResult(result) {
  return {
    description: String(result && (result.description || result.summary || result.excerpt) || '').trim().slice(0, 300),
    keywords: normalizeGeneratedKeywords(result && (result.keywords || result.tags || result.hashtags)),
  };
}

function extractFallbackKeywords(text, title = '') {
  const source = `${title || ''}\n${text || ''}`;
  const keywords = [];
  const tagPattern = /#([\p{L}\p{N}_-]{1,32})/gu;
  let match;
  while ((match = tagPattern.exec(source))) {
    const tag = match[1].trim();
    if (tag && !keywords.includes(tag)) keywords.push(tag);
  }
  [
    '视频号',
    '小红书',
    'Obsidian',
    '评论区',
    '选题',
    '用户痛点',
    '内容创作',
    '知识库',
    'AI',
    '自媒体',
    '运营',
    '转写',
  ].forEach((candidate) => {
    if (source.includes(candidate) && !keywords.includes(candidate)) keywords.push(candidate);
  });
  return keywords.slice(0, 8);
}

function generateFallbackMetadata({ title = '', content = '' } = {}) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = text.split(/[。！？!?]\s*/).map((item) => item.trim()).filter((item) => item.length >= 8);
  return {
    description: (sentences[0] || text || String(title || '')).slice(0, 160).trim(),
    keywords: extractFallbackKeywords(text, title),
  };
}

async function handleMetadataGenerateRequest({
  request, repository, openid, clientId,
}) {
  const body = parseJsonBody(request.body);
  const payload = {
    title: String(body.title || '').trim().slice(0, 300),
    source: String(body.source || '').trim().slice(0, 100),
    content: String(body.content || '').trim().slice(0, 6000),
  };
  if (!payload.content && !payload.title) {
    return jsonResponse(400, {
      success: false,
      errMsg: 'Missing metadata content',
    });
  }

  const entitlement = typeof repository.getEntitlement === 'function'
    ? await repository.getEntitlement(openid, DEFAULT_REDEEM_PLAN, { clientId })
    : null;
  const entitlementState = buildEntitlementState(entitlement);
  if (!entitlementState.hasAccess) {
    return jsonResponse(403, {
      success: false,
      errCode: 'PRO_REQUIRED',
      errMsg: 'Pro membership is required for metadata generation',
    });
  }

  if (typeof repository.generateMetadata !== 'function') {
    return jsonResponse(502, {
      success: false,
      errCode: 'AI_METADATA_UNAVAILABLE',
      errMsg: 'AI metadata provider is not configured',
    });
  }

  let generated = null;
  try {
    generated = await repository.generateMetadata(openid, payload);
  } catch (error) {
    return jsonResponse(502, {
      success: false,
      errCode: 'AI_METADATA_FAILED',
      errMsg: error && error.message ? error.message : 'AI metadata generation failed',
    });
  }
  const normalized = normalizeGeneratedMetadataResult(generated);
  if (!normalized.description || !normalized.keywords.length) {
    return jsonResponse(502, {
      success: false,
      errCode: 'AI_METADATA_UNAVAILABLE',
      errMsg: 'AI metadata provider did not return a usable description and keywords',
    });
  }
  return jsonResponse(200, {
    success: true,
    data: {
      description: normalized.description,
      keywords: normalized.keywords,
    },
  });
}

function normalizeOcrImageRequests(body) {
  const source = Array.isArray(body.images)
    ? body.images
    : (Array.isArray(body.imageUrls) ? body.imageUrls : []);
  return source
    .map((item) => (typeof item === 'string' ? { imageUrl: item } : item))
    .map((item) => ({
      imageUrl: String(item && (item.imageUrl || item.url) || '').trim(),
      imageBase64: String(item && item.imageBase64 || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim(),
      index: Number(item && item.index) || 0,
    }))
    .filter((item) => item.imageUrl || item.imageBase64)
    .slice(0, 6);
}

function normalizeOcrTextItem(item, fallbackIndex = 0) {
  const text = String(item && (item.text || item.ocrText || item.value) || '').trim();
  const readableChars = (text.replace(/\s+/g, '').match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length;
  return {
    imageUrl: String(item && (item.imageUrl || item.url) || '').trim(),
    text,
    index: Number(item && item.index) || fallbackIndex,
    readableChars,
    substantial: readableChars >= 80,
  };
}

async function handleOcrImagesRequest({
  request, repository, openid, clientId,
}) {
  const body = parseJsonBody(request.body);
  const images = normalizeOcrImageRequests(body);
  if (!images.length) {
    return jsonResponse(400, {
      success: false,
      errMsg: 'Missing OCR images',
    });
  }
  const entitlement = typeof repository.getEntitlement === 'function'
    ? await repository.getEntitlement(openid, DEFAULT_REDEEM_PLAN, { clientId })
    : null;
  const entitlementState = buildEntitlementState(entitlement);
  if (!entitlementState.hasAccess) {
    return jsonResponse(403, {
      success: false,
      errCode: 'PRO_REQUIRED',
      errMsg: 'Pro membership is required for image OCR',
    });
  }
  if (typeof repository.recognizeImageTexts !== 'function') {
    return jsonResponse(501, {
      success: false,
      errMsg: 'Image OCR is not available',
    });
  }
  const result = await repository.recognizeImageTexts(openid, {
    images,
    pageUrl: String(body.pageUrl || body.url || '').trim(),
    title: String(body.title || '').trim().slice(0, 300),
  });
  const items = (Array.isArray(result && result.items) ? result.items : [])
    .map((item, index) => normalizeOcrTextItem(item, index + 1))
    .filter((item) => item.text);
  return jsonResponse(200, {
    success: true,
    data: {
      items,
      provider: String(result && result.provider || ''),
    },
  });
}

function getHeader(headers, name) {
  if (!headers || !name) return '';
  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find((item) => String(item).toLowerCase() === target);
  return key ? headers[key] : '';
}

function isAdminPath(path) {
  const normalized = String(path || '').replace(/^\/sync/, '');
  return normalized === '/admin' || normalized.startsWith('/admin/');
}

async function handleAdminApiRequest({ request, repository }) {
  if (typeof repository.handleAdminRequest !== 'function') {
    return jsonResponse(500, {
      success: false,
      errMsg: 'Admin handler is unavailable',
    });
  }
  const body = parseAdminBody(request.body);
  const query = request.query || {};
  const data = await repository.handleAdminRequest({
    method: request.method,
    path: getAdminPath(request.path),
    query,
    body,
    adminSecret: String(
      getHeader(request.headers, 'x-admin-secret')
      || body.adminSecret
      || query.adminSecret
      || ''
    ).trim(),
  });
  return jsonResponse(200, {
    success: true,
    data,
  });
}

async function handleSyncApiRequest({ request, repository }) {
  try {
    const method = String(request.method || '').toUpperCase();
    const path = request.path || '/';

    if (method === 'OPTIONS' && isAdminPath(path)) {
      return jsonResponse(204, { success: true });
    }

    if ((method === 'GET' || method === 'POST') && isAdminPath(path)) {
      return await handleAdminApiRequest({ request, repository });
    }

    if ((method === 'GET' || method === 'POST') && isVirtualPaymentNotifyPath(path)) {
      return await handleVirtualPaymentNotifyRequest({ request, repository });
    }

    if (method === 'GET' && isFeishuOAuthCallbackPath(path)) {
      return await handleFeishuOAuthCallbackRequest({ request, repository });
    }

    if (method === 'POST' && isBindPath(path)) {
      return await handleBindRequest({ request, repository });
    }

    if (method === 'POST' && isUnbindSelfPath(path)) {
      return await handleUnbindSelfRequest({ request, repository });
    }

    const auth = await requireOpenId(request, repository);
    if (auth.error) return auth.error;

    if (method === 'POST' && isFeishuOAuthStartPath(path)) {
      return await handleFeishuOAuthStartRequest({
        request, repository, openid: auth.openid, clientId: auth.clientId, token: auth.token,
      });
    }

    if (method === 'GET' && isFeishuOAuthStatusPath(path)) {
      return await handleFeishuOAuthStatusRequest({
        repository, openid: auth.openid, clientId: auth.clientId, token: auth.token,
      });
    }

    if (method === 'POST' && isFeishuExtractPath(path)) {
      return await handleFeishuExtractRequest({
        request, repository, openid: auth.openid, clientId: auth.clientId, token: auth.token,
      });
    }

    if (method === 'GET' && isEntitlementStatusPath(path)) {
      return await handleEntitlementStatusRequest({
        request, repository, openid: auth.openid, clientId: auth.clientId,
      });
    }

    if (method === 'POST' && isEntitlementRedeemPath(path)) {
      return await handleEntitlementRedeemRequest({
        request, repository, openid: auth.openid, clientId: auth.clientId,
      });
    }

    if (method === 'POST' && isEntitlementAutoRedeemPath(path)) {
      return await handleEntitlementAutoRedeemRequest({
        repository, openid: auth.openid, clientId: auth.clientId,
      });
    }

    if (method === 'POST' && isCloudTranscriptionPath(path)) {
      return await handleCloudTranscriptionRequest({
        request, repository, openid: auth.openid, clientId: auth.clientId,
      });
    }

    if (method === 'POST' && isOcrImagesPath(path)) {
      return await handleOcrImagesRequest({
        request, repository, openid: auth.openid, clientId: auth.clientId,
      });
    }

    if (method === 'POST' && isMediaPreparePath(path)) {
      return await handleMediaPrepareRequest({ request, repository, openid: auth.openid });
    }

    if (method === 'POST' && isTranscriptionPreferencesPath(path)) {
      return await handleTranscriptionPreferencesRequest({ request, repository, openid: auth.openid });
    }

    if (method === 'POST' && isMetadataGeneratePath(path)) {
      return await handleMetadataGenerateRequest({
        request, repository, openid: auth.openid, clientId: auth.clientId,
      });
    }

    if (method === 'GET' && isRecordsPath(path)) {
      const records = await repository.listPendingRecords(auth.openid);
      return jsonResponse(200, {
        success: true,
        data: filterSyncableRecords(records),
      });
    }

    if (method === 'GET' && isDownloadUrlPath(path)) {
      const fileID = request.query && request.query.fileID;
      if (!fileID) {
        return jsonResponse(400, {
          success: false,
          errMsg: 'Missing fileID',
        });
      }
      if (typeof repository.isFileOwnedByOpenId === 'function') {
        const isOwned = await repository.isFileOwnedByOpenId(auth.openid, fileID);
        if (!isOwned) {
          return jsonResponse(403, {
            success: false,
            errMsg: 'File does not belong to current user',
          });
        }
      }
      const file = await repository.getTempFileURL(auth.openid, fileID);
      return jsonResponse(200, {
        success: true,
        data: file,
      });
    }

    if (method === 'POST') {
      const recordId = extractSyncedRecordId(path);
      if (recordId) {
        const result = await repository.markRecordSynced(auth.openid, recordId);
        return jsonResponse(200, {
          success: true,
          data: result,
        });
      }
    }

    return jsonResponse(404, {
      success: false,
      errMsg: 'Route not found',
    });
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      errMsg: error.message || String(error),
    });
  }
}

module.exports = {
  buildSyncedRecordCleanupData,
  buildCloudQuotaState,
  collectRecordFileIds,
  filterSyncableRecords,
  getRecordDedupeKey,
  normalizeSyncableRecord,
  handleSyncApiRequest,
  hasAlreadySyncedEvidence,
  isRedeemCodeBusinessError,
  shouldKeepRecordPendingForTranscription,
  normalizeTranscriptionPreferences,
  parseBearerToken,
  parseAuthToken,
  normalizeRedeemCode,
};
