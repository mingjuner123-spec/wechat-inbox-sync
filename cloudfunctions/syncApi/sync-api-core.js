const DEFAULT_REDEEM_PLAN = 'local_transcription_beta';

function buildEntitlementState(entitlement, now = new Date().toISOString()) {
  if (!entitlement) {
    return {
      hasAccess: false,
      plan: '',
      status: 'inactive',
      expiresAt: '',
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

async function handleSyncApiRequest({ request, repository }) {
  try {
    const method = String(request.method || '').toUpperCase();
    const path = request.path || '/';

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

    if (method === 'GET' && isRecordsPath(path)) {
      const records = await repository.listPendingRecords(auth.openid);
      return jsonResponse(200, {
        success: true,
        data: records,
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
  collectRecordFileIds,
  handleSyncApiRequest,
  isRedeemCodeBusinessError,
  parseBearerToken,
  normalizeRedeemCode,
};
