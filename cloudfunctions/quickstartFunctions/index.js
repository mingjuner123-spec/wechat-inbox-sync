const cloud = require('wx-server-sdk');
const https = require('https');
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
  normalizeRedeemCode,
  isRedeemCodeActive,
  createRedeemCodeDocument,
  getBuiltInRedeemCodeDocument,
  createEntitlementDocument,
  buildEntitlementState,
} = require('./redeem-code-core');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;
const REQUEST_TIMEOUT_MS = 10000;

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

function shouldPrepareAudioTempURL() {
  return Boolean(process.env.OPENAI_API_KEY)
    || String(process.env.VOICE_AI_PROVIDER || '').toLowerCase() === 'openai';
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

async function getEntitlementStatus(event) {
  const wxContext = cloud.getWXContext();
  const plan = String(event.plan || DEFAULT_REDEEM_PLAN).trim() || DEFAULT_REDEEM_PLAN;
  const entitlement = await getUserEntitlement(wxContext.OPENID, plan);
  return {
    success: true,
    data: buildEntitlementState(entitlement),
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
      data: buildEntitlementState(existingEntitlement),
    };
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

  const maxRedemptions = Number(codeDoc.maxRedemptions) || 1;
  const nextRedeemedCount = (Number(codeDoc.redeemedCount) || 0) + 1;
  const codeUpdateData = {
    redeemedCount: _.inc(1),
    lastRedeemedAt: now,
    lastRedeemedOpenId: wxContext.OPENID,
    updatedAt: now,
  };
  if (nextRedeemedCount >= maxRedemptions) {
    codeUpdateData.status = 'redeemed';
  }
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
    maxRedemptions: event.maxRedemptions,
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

async function createInboxRecord(event) {
  const wxContext = cloud.getWXContext();
  const now = new Date().toISOString();
  const quota = await consumeDailyQuota(wxContext.OPENID, now);
  const data = createInboxRecordDocument({
    event,
    openid: wxContext.OPENID,
    now,
  });

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

function postJson(url, payload) {
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
    await postJson(feishuWebhook, buildFeishuFeedbackMessage({
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
      case 'adminUpsertRedeemCode':
        return await adminUpsertRedeemCode(event);
      case 'createInboxRecord':
        return await createInboxRecord(event);
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
