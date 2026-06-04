const cloud = require('wx-server-sdk');
const {
  buildSyncedRecordCleanupData,
  collectRecordFileIds,
  handleSyncApiRequest,
} = require('./sync-api-core');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;
const DEFAULT_BIND_DEVICE_LIMIT = 1;
const MAX_BIND_DEVICE_LIMIT = 3;
const BIND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_REDEEM_PLAN = 'local_transcription_beta';

function formatCleanupError(error) {
  return error && error.message ? error.message : String(error || '');
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

function getBuiltInRedeemCodeDocument(code, now = new Date().toISOString()) {
  if (normalizeRedeemCode(code) !== 'ZZAI0603') return null;
  return {
    code: 'ZZAI0603',
    status: 'active',
    plan: DEFAULT_REDEEM_PLAN,
    durationDays: 30,
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
  const maxRedemptions = Number(codeDoc.maxRedemptions) || 1;
  const redeemedCount = Number(codeDoc.redeemedCount) || 0;
  return redeemedCount < maxRedemptions;
}

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

      const maxRedemptions = Number(effectiveCodeDoc.maxRedemptions) || 1;
      const nextRedeemedCount = (Number(effectiveCodeDoc.redeemedCount) || 0) + 1;
      const updateData = {
        redeemedCount: _.inc(1),
        lastRedeemedAt: now,
        lastRedeemedOpenId: openid,
        updatedAt: now,
      };
      if (nextRedeemedCount >= maxRedemptions) {
        updateData.status = 'redeemed';
      }
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
  };
}

const repository = createRepository();

exports.main = async (event) => {
  return handleSyncApiRequest({
    request: normalizeEvent(event),
    repository,
  });
};
