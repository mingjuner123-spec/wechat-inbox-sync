const DEFAULT_REDEEM_PLAN = 'local_transcription_beta';
const DEFAULT_CLOUD_TRANSCRIPTION_QUOTA_SECONDS = 0;
const CLOUD_TRANSCRIPTION_MIN_BILL_SECONDS = 60;

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
  return match ? match[1].trim() : '';
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
  const metadata = (record && record.metadata) || {};
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

function filterSyncableRecords(records = []) {
  return (records || []).filter((record) => !hasAlreadySyncedEvidence(record));
}

async function requireOpenId(request, repository) {
  const token = parseBearerToken(request.headers);
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

  return { openid };
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

async function handleEntitlementStatusRequest({ request, repository, openid }) {
  const plan = String((request.query && request.query.plan) || DEFAULT_REDEEM_PLAN).trim() || DEFAULT_REDEEM_PLAN;
  const entitlement = typeof repository.getEntitlement === 'function'
    ? await repository.getEntitlement(openid, plan)
    : null;
  return jsonResponse(200, {
    success: true,
    data: buildEntitlementState(entitlement),
  });
}

async function handleEntitlementRedeemRequest({ request, repository, openid }) {
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
    state = await repository.redeemAccessCode(openid, code);
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

async function handleCloudTranscriptionRequest({ request, repository, openid }) {
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
    ? await repository.getEntitlement(openid, DEFAULT_REDEEM_PLAN)
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

    if (method === 'POST' && isBindPath(path)) {
      return await handleBindRequest({ request, repository });
    }

    if (method === 'POST' && isUnbindSelfPath(path)) {
      return await handleUnbindSelfRequest({ request, repository });
    }

    const auth = await requireOpenId(request, repository);
    if (auth.error) return auth.error;

    if (method === 'GET' && isEntitlementStatusPath(path)) {
      return await handleEntitlementStatusRequest({ request, repository, openid: auth.openid });
    }

    if (method === 'POST' && isEntitlementRedeemPath(path)) {
      return await handleEntitlementRedeemRequest({ request, repository, openid: auth.openid });
    }

    if (method === 'POST' && isCloudTranscriptionPath(path)) {
      return await handleCloudTranscriptionRequest({ request, repository, openid: auth.openid });
    }

    if (method === 'POST' && isMediaPreparePath(path)) {
      return await handleMediaPrepareRequest({ request, repository, openid: auth.openid });
    }

    if (method === 'POST' && isTranscriptionPreferencesPath(path)) {
      return await handleTranscriptionPreferencesRequest({ request, repository, openid: auth.openid });
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
  handleSyncApiRequest,
  hasAlreadySyncedEvidence,
  isRedeemCodeBusinessError,
  shouldKeepRecordPendingForTranscription,
  normalizeTranscriptionPreferences,
  parseBearerToken,
  normalizeRedeemCode,
};
