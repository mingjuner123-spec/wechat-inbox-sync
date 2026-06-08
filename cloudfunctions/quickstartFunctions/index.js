const cloud = require('wx-server-sdk');
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
  return (result.data || []).find((item) => isLocalTranscriptionPlan(item.plan)) || null;
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
    deliveryStatus: 'activated',
    activatedAt: now,
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
      maxRedemptions: event.maxRedemptions,
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
  const limit = normalizeAdminPositiveInteger(event.limit, 1, 100, 50);
  const result = await db.collection('redeem_codes')
    .orderBy('updatedAt', 'desc')
    .limit(100)
    .get();
  const items = (result.data || [])
    .filter((item) => includesAdminKeyword({
      ...item,
      ...buildRedeemCodeDeliveryState(item),
    }, keyword, ['code', 'status', 'plan', 'note', 'lastRedeemedOpenId', 'deliveryStatus', 'deliveryStatusText']))
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
      total: items.length,
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
  if (!entitlementId) throw new Error('缺少 Pro 用户记录 ID');
  if (!['extend', 'disable', 'activate'].includes(action)) throw new Error('不支持的 Pro 用户操作');

  const result = await db.collection('user_entitlements').doc(entitlementId).get();
  const entitlement = result.data;
  if (!entitlement) throw new Error('Pro 用户记录不存在');

  const now = new Date().toISOString();
  const updateData = { updatedAt: now };
  if (action === 'extend') {
    const days = normalizeAdminPositiveInteger(event.days, 1, 3650, 30);
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
  }
  if (action === 'markUnsent') {
    updateData.deliveryStatus = 'unsent';
    updateData.deliveredAt = '';
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
  const quota = buildEntitlementState(entitlement, now).hasAccess
    ? buildProUsageState()
    : await consumeDailyQuota(wxContext.OPENID, now);
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
      case 'trackAnalyticsEvent':
        return await trackAnalyticsEvent(event);
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
