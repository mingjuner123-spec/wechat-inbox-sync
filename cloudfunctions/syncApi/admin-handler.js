const cloud = require('wx-server-sdk');
const {
  createAdminRedeemCodeDocuments,
  normalizeAdminPositiveInteger,
  summarizeAdminDashboard,
} = require('./admin-core');
const {
  DEFAULT_REDEEM_PLAN,
  normalizeRedeemCode,
} = require('./redeem-code-core');
const {
  createBindStatusResponse,
  getBindCodeLookupCandidates,
} = require('./inbox-core');
const {
  buildPaymentOrderState,
  createPaidEntitlementFromOrder,
} = require('./payment-core');

const PRODUCTION_WECHAT_DATA_ENV = 'he02-d8gebzv050ed6c4ef';

function getCloudDataEnv() {
  return String(process.env.WECHAT_DATA_ENV || '').trim() || PRODUCTION_WECHAT_DATA_ENV || cloud.DYNAMIC_CURRENT_ENV;
}

cloud.init({
  env: getCloudDataEnv(),
});

const db = cloud.database();
const _ = db.command;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-admin-secret',
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event || !event.body) return {};
  if (typeof event.body === 'object') return event.body;
  try {
    return JSON.parse(event.body);
  } catch (error) {
    return {};
  }
}

function normalizePath(path) {
  return String(path || '')
    .replace(/^\/admin-api/, '')
    .replace(/^\/adminApi/, '')
    .replace(/\/+$/, '') || '/';
}

function getRequest(event) {
  const method = String(event.httpMethod || event.method || 'POST').toUpperCase();
  const body = parseBody(event);
  const query = event.queryStringParameters || event.query || {};
  const headers = event.headers || {};
  return {
    method,
    path: normalizePath(event.path || event.requestPath || body.path || event.type || '/summary'),
    query,
    body,
    adminSecret: String(
      headers['x-admin-secret']
      || headers['X-Admin-Secret']
      || body.adminSecret
      || query.adminSecret
      || ''
    ).trim(),
  };
}

function assertAdminSecret(secret) {
  const expected = String(process.env.REDEEM_ADMIN_SECRET || '').trim();
  if (!expected) {
    const error = new Error('请先配置 REDEEM_ADMIN_SECRET 环境变量');
    error.statusCode = 500;
    throw error;
  }
  if (!secret || secret !== expected) {
    const error = new Error('管理密钥错误');
    error.statusCode = 403;
    throw error;
  }
}

async function ensureCollection(name) {
  if (typeof db.createCollection !== 'function') return;
  try {
    await db.createCollection(name);
  } catch (error) {
    // Collection already exists.
  }
}

async function readCollection(collectionName, {
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
    total = 0;
  }
  const safeMaxRead = normalizeAdminPositiveInteger(maxRead, 100, 5000, 1000);
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

function buildScope(snapshots) {
  const names = Object.keys(snapshots || {});
  const isTruncated = names.some((name) => snapshots[name] && snapshots[name].isTruncated);
  const maxRead = names.reduce((value, name) => Math.max(value, Number(snapshots[name] && snapshots[name].maxRead) || 0), 0);
  return {
    isFullScan: !isTruncated,
    isTruncated,
    maxRead,
    label: isTruncated ? `已读取每类最多 ${maxRead} 条，部分数据被截断` : '已按当前数据库总数统计',
    desc: isTruncated ? '数据量超过后台直读上限，精确统计需要独立汇总表。' : '当前数字按云数据库现有记录统计。',
  };
}

function isDateInRange(value, range, now = new Date().toISOString()) {
  if (!range || range === 'all') return true;
  if (!value) return false;
  const time = new Date(value).getTime();
  const nowTime = new Date(now).getTime();
  if (Number.isNaN(time) || Number.isNaN(nowTime)) return false;
  const rangeMap = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const span = rangeMap[range];
  if (!span) return true;
  return time >= nowTime - span;
}

function getOpenId(item) {
  return String(item && (item.openid || item.openId || item.userOpenId || '')).trim();
}

function formatRemainingDays(expiresAt, now = new Date().toISOString()) {
  if (!expiresAt) return null;
  const expiresTime = new Date(expiresAt).getTime();
  const nowTime = new Date(now).getTime();
  if (Number.isNaN(expiresTime) || Number.isNaN(nowTime)) return null;
  return Math.ceil((expiresTime - nowTime) / 86400000);
}

function normalizeCodeDeliveryState(item) {
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

function addDays(baseIso, days) {
  const date = new Date(baseIso);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function buildUserRows({ records, bindCodes, entitlements, analyticsEvents, now }) {
  const users = new Map();
  function ensureUser(openid) {
    if (!openid) return null;
    if (!users.has(openid)) {
      users.set(openid, {
        openid,
        firstVisitAt: '',
        lastVisitAt: '',
        firstBindPageAt: '',
        bindSuccessAt: '',
        firstSyncAt: '',
        lastSyncAt: '',
        syncCount: 0,
        pendingCount: 0,
        bindCodeCount: 0,
        boundDeviceCount: 0,
        isPro: false,
        proStatus: 'inactive',
        proPlan: '',
        proExpiresAt: '',
        remainingDays: null,
        entitlementId: '',
        redeemCode: '',
        source: '',
      });
    }
    return users.get(openid);
  }

  analyticsEvents.forEach((event) => {
    const user = ensureUser(getOpenId(event));
    if (!user) return;
    const time = event.firstAt || event.lastAt || event.createdAt || '';
    if (event.eventName === 'app_visit') {
      user.firstVisitAt = !user.firstVisitAt || time < user.firstVisitAt ? time : user.firstVisitAt;
      user.lastVisitAt = !user.lastVisitAt || time > user.lastVisitAt ? time : user.lastVisitAt;
    }
    if (event.eventName === 'bind_page_view') {
      user.firstBindPageAt = !user.firstBindPageAt || time < user.firstBindPageAt ? time : user.firstBindPageAt;
    }
    if (event.eventName === 'bind_success') {
      user.bindSuccessAt = !user.bindSuccessAt || time > user.bindSuccessAt ? time : user.bindSuccessAt;
    }
  });

  bindCodes.forEach((bindCode) => {
    const user = ensureUser(getOpenId(bindCode));
    if (!user) return;
    user.bindCodeCount += 1;
    const clients = Array.isArray(bindCode.clients) ? bindCode.clients : [];
    user.boundDeviceCount += clients.length;
    if (bindCode.boundAt) user.bindSuccessAt = !user.bindSuccessAt || bindCode.boundAt > user.bindSuccessAt ? bindCode.boundAt : user.bindSuccessAt;
  });

  records.forEach((record) => {
    const user = ensureUser(getOpenId(record));
    if (!user) return;
    if (record.status === 'synced') {
      const syncedAt = record.syncedAt || record.updatedAt || record.createdAt || '';
      user.syncCount += 1;
      user.firstSyncAt = !user.firstSyncAt || syncedAt < user.firstSyncAt ? syncedAt : user.firstSyncAt;
      user.lastSyncAt = !user.lastSyncAt || syncedAt > user.lastSyncAt ? syncedAt : user.lastSyncAt;
    } else {
      user.pendingCount += 1;
    }
  });

  entitlements.forEach((entitlement) => {
    const user = ensureUser(getOpenId(entitlement));
    if (!user) return;
    const expiresAt = entitlement.expiresAt || '';
    const expired = expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime();
    const active = (entitlement.status || 'active') === 'active' && !expired;
    if (active || !user.proExpiresAt || expiresAt > user.proExpiresAt) {
      user.isPro = active;
      user.proStatus = active ? 'active' : (expired ? 'expired' : entitlement.status || 'inactive');
      user.proPlan = entitlement.plan || '';
      user.proExpiresAt = expiresAt;
      user.remainingDays = formatRemainingDays(expiresAt, now);
      user.entitlementId = entitlement._id || '';
      user.redeemCode = entitlement.code || '';
      user.source = entitlement.source || '';
    }
  });

  return Array.from(users.values()).sort((a, b) => {
    const left = b.lastSyncAt || b.lastVisitAt || b.bindSuccessAt || '';
    const right = a.lastSyncAt || a.lastVisitAt || a.bindSuccessAt || '';
    return left.localeCompare(right);
  });
}

function filterByKeyword(items, keyword, fields) {
  const normalized = String(keyword || '').trim().toUpperCase();
  if (!normalized) return items;
  return items.filter((item) => fields.some((field) => String(item[field] || '').toUpperCase().includes(normalized)));
}

function truncateAdminText(value, maxLength = 500) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function isAdminTimeInWindow(value, since, until) {
  if (!since && !until) return true;
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  if (since) {
    const sinceTime = new Date(since).getTime();
    if (!Number.isNaN(sinceTime) && time < sinceTime) return false;
  }
  if (until) {
    const untilTime = new Date(until).getTime();
    if (!Number.isNaN(untilTime) && time > untilTime) return false;
  }
  return true;
}

function buildRecordDiagnosticRow(record) {
  const metadata = (record && record.metadata) || {};
  return {
    _id: record._id || '',
    openid: getOpenId(record),
    type: record.type || '',
    status: record.status || '',
    content: truncateAdminText(record.content, 500),
    source: record.source || '',
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || '',
    syncedAt: record.syncedAt || '',
    metadata: {
      url: metadata.url || '',
      originalUrl: metadata.originalUrl || '',
      title: metadata.title || '',
      shareText: truncateAdminText(metadata.shareText, 300),
      fetchStatus: metadata.fetchStatus || '',
      conversionStatus: metadata.conversionStatus || '',
      conversionError: truncateAdminText(metadata.conversionError, 500),
      transcriptionStatus: metadata.transcriptionStatus || '',
      transcriptionError: truncateAdminText(metadata.transcriptionError, 500),
      cleanupStatus: metadata.cleanupStatus || '',
      cleanupError: truncateAdminText(metadata.cleanupError, 500),
      fileID: metadata.fileID || '',
      audioFileID: metadata.audioFileID || '',
      fileName: metadata.fileName || '',
      audioFileName: metadata.audioFileName || '',
      hasMarkdown: Boolean(metadata.markdown || metadata.snapshot || metadata.contentSnapshot),
      markdownLength: String(metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '').length,
    },
  };
}

async function loadAdminSnapshots(maxRead = 1000) {
  await Promise.all([
    ensureCollection('inbox_records'),
    ensureCollection('redeem_codes'),
    ensureCollection('user_entitlements'),
    ensureCollection('bind_codes'),
    ensureCollection('analytics_events'),
  ]);
  const [records, redeemCodes, entitlements, bindCodes, analyticsEvents] = await Promise.all([
    readCollection('inbox_records', { orderField: 'createdAt', maxRead }),
    readCollection('redeem_codes', { orderField: 'updatedAt', maxRead }),
    readCollection('user_entitlements', { orderField: 'updatedAt', maxRead }),
    readCollection('bind_codes', { orderField: 'createdAt', maxRead }),
    readCollection('analytics_events', { orderField: 'lastAt', maxRead }),
  ]);
  return {
    records,
    redeemCodes,
    entitlements,
    bindCodes,
    analyticsEvents,
  };
}

async function getSummary(request) {
  const now = new Date().toISOString();
  const maxRead = normalizeAdminPositiveInteger(request.body.maxRead || request.query.maxRead, 100, 5000, 1000);
  const range = String(request.body.range || request.query.range || 'all');
  const snapshots = await loadAdminSnapshots(maxRead);
  const windowStartMap = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const rangeSpan = windowStartMap[range];
  const windowStart = rangeSpan ? new Date(new Date(now).getTime() - rangeSpan).toISOString() : '';
  const records = (snapshots.records.data || []).filter((item) => isDateInRange(item.createdAt || item.updatedAt, range, now));
  const bindCodes = (snapshots.bindCodes.data || []).filter((item) => isDateInRange(item.createdAt || item.boundAt, range, now));
  const entitlements = (snapshots.entitlements.data || []).filter((item) => range === 'all' || isDateInRange(item.redeemedAt || item.updatedAt, range, now) || ((item.status || 'active') === 'active'));
  const redeemCodes = (snapshots.redeemCodes.data || []).filter((item) => isDateInRange(item.updatedAt || item.createdAt, range, now));
  const analyticsEvents = (snapshots.analyticsEvents.data || []).filter((item) => isDateInRange(item.lastAt || item.firstAt || item.createdAt, range, now));
  return summarizeAdminDashboard({
    records,
    redeemCodes,
    entitlements,
    bindCodes,
    analyticsEvents,
    allRecords: snapshots.records.data || [],
    allEntitlements: snapshots.entitlements.data || [],
    allBindCodes: snapshots.bindCodes.data || [],
    allAnalyticsEvents: snapshots.analyticsEvents.data || [],
    rangeKey: range,
    windowStart,
    now,
    sampleLimit: maxRead,
    scope: buildScope(snapshots),
  });
}

async function listUsers(request) {
  const now = new Date().toISOString();
  const maxRead = normalizeAdminPositiveInteger(request.body.maxRead || request.query.maxRead, 100, 5000, 1000);
  const limit = normalizeAdminPositiveInteger(request.body.limit || request.query.limit, 1, 500, 100);
  const keyword = request.body.keyword || request.query.keyword || '';
  const snapshots = await loadAdminSnapshots(maxRead);
  const rows = buildUserRows({
    records: snapshots.records.data || [],
    bindCodes: snapshots.bindCodes.data || [],
    entitlements: snapshots.entitlements.data || [],
    analyticsEvents: snapshots.analyticsEvents.data || [],
    now,
  });
  return {
    items: filterByKeyword(rows, keyword, ['openid', 'redeemCode', 'proStatus', 'proPlan']).slice(0, limit),
    total: rows.length,
  };
}

async function listProUsers(request) {
  const now = new Date().toISOString();
  const limit = normalizeAdminPositiveInteger(request.body.limit || request.query.limit, 1, 500, 100);
  const keyword = request.body.keyword || request.query.keyword || '';
  const snapshots = await loadAdminSnapshots(normalizeAdminPositiveInteger(request.body.maxRead || request.query.maxRead, 100, 5000, 1000));
  const userRows = buildUserRows({
    records: snapshots.records.data || [],
    bindCodes: snapshots.bindCodes.data || [],
    entitlements: snapshots.entitlements.data || [],
    analyticsEvents: snapshots.analyticsEvents.data || [],
    now,
  });
  const userMap = new Map(userRows.map((user) => [user.openid, user]));
  const rows = (snapshots.entitlements.data || []).map((entitlement) => {
    const expiresAt = entitlement.expiresAt || '';
    const expired = expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime();
    const status = (entitlement.status || 'active') === 'active' && !expired ? 'active' : (expired ? 'expired' : entitlement.status || 'inactive');
    const openid = getOpenId(entitlement);
    const user = userMap.get(openid) || {};
    return {
      openid,
      firstVisitAt: user.firstVisitAt || '',
      lastVisitAt: user.lastVisitAt || '',
      firstBindPageAt: user.firstBindPageAt || '',
      bindSuccessAt: user.bindSuccessAt || '',
      firstSyncAt: user.firstSyncAt || '',
      lastSyncAt: user.lastSyncAt || '',
      syncCount: Number(user.syncCount) || 0,
      pendingCount: Number(user.pendingCount) || 0,
      bindCodeCount: Number(user.bindCodeCount) || 0,
      boundDeviceCount: Number(user.boundDeviceCount) || 0,
      isPro: status === 'active',
      proStatus: status,
      proPlan: entitlement.plan || '',
      proExpiresAt: expiresAt,
      remainingDays: formatRemainingDays(expiresAt, now),
      cloudQuotaSeconds: Number(entitlement.cloudQuotaSeconds) || 0,
      cloudUsedSeconds: Number(entitlement.cloudUsedSeconds) || 0,
      cloudRemainingSeconds: Math.max(0, (Number(entitlement.cloudQuotaSeconds) || 0) - (Number(entitlement.cloudUsedSeconds) || 0)),
      cloudLastUsedAt: entitlement.cloudLastUsedAt || '',
      entitlementId: entitlement._id || '',
      redeemCode: entitlement.code || '',
      source: entitlement.source || '',
      redeemedAt: entitlement.redeemedAt || user.redeemedAt || '',
      updatedAt: entitlement.updatedAt || '',
    };
  }).sort((a, b) => (b.redeemedAt || b.updatedAt || '').localeCompare(a.redeemedAt || a.updatedAt || ''));
  const items = filterByKeyword(rows, keyword, ['openid', 'redeemCode', 'proStatus', 'proPlan', 'source']).slice(0, limit);
  return {
    items,
    total: rows.length,
  };
}

async function listRedeemCodes(request) {
  await ensureCollection('redeem_codes');
  const limit = normalizeAdminPositiveInteger(request.body.limit || request.query.limit, 1, 500, 100);
  const keyword = request.body.keyword || request.query.keyword || '';
  const statusFilter = String(request.body.status || request.query.status || '').trim();
  const deliveryStatusFilter = String(request.body.deliveryStatus || request.query.deliveryStatus || '').trim();
  const snapshot = await readCollection('redeem_codes', { orderField: 'updatedAt', maxRead: 5000 });
  const items = (snapshot.data || []).map((item) => ({
    _id: item._id,
    code: item.code || '',
    status: item.status || 'active',
    plan: item.plan || DEFAULT_REDEEM_PLAN,
    durationDays: Number(item.durationDays) || 0,
    cloudQuotaSeconds: Number(item.cloudQuotaSeconds) || 0,
    maxRedemptions: Number(item.maxRedemptions) || 1,
    redeemedCount: Number(item.redeemedCount) || 0,
    note: item.note || '',
    deliveredTo: item.deliveredTo || '',
    deliveredAt: item.deliveredAt || '',
    lastRedeemedAt: item.lastRedeemedAt || '',
    lastRedeemedOpenId: item.lastRedeemedOpenId || '',
    createdAt: item.createdAt || '',
    updatedAt: item.updatedAt || '',
    ...normalizeCodeDeliveryState(item),
  }));
  const filtered = items
    .filter((item) => !statusFilter || item.status === statusFilter)
    .filter((item) => !deliveryStatusFilter || item.deliveryStatus === deliveryStatusFilter);
  return {
    items: filterByKeyword(filtered, keyword, ['code', 'note', 'deliveredTo', 'lastRedeemedOpenId', 'deliveryStatusText']).slice(0, limit),
    total: filtered.length,
  };
}

async function generateRedeemCodes(request) {
  await ensureCollection('redeem_codes');
  const now = new Date().toISOString();
  const count = normalizeAdminPositiveInteger(request.body.count, 1, 100, 1);
  const docs = [];
  let attempts = 0;
  while (docs.length < count && attempts < count * 30) {
    attempts += 1;
    const [doc] = createAdminRedeemCodeDocuments({
      count: 1,
      prefix: request.body.prefix || 'OBPRO',
      durationDays: request.body.durationDays,
      maxRedemptions: 1,
      note: request.body.note || '',
      plan: request.body.plan || DEFAULT_REDEEM_PLAN,
      now,
    });
    const existingResult = await db.collection('redeem_codes').where({ code: doc.code }).limit(1).get();
    if (existingResult.data && existingResult.data[0]) continue;
    const created = await db.collection('redeem_codes').add({ data: doc });
    docs.push({ ...doc, _id: created._id });
  }
  if (docs.length < count) throw new Error('兑换码生成失败，请换一个前缀后重试');
  return {
    codes: docs,
    plainText: docs.map((item) => item.code).join('\n'),
  };
}

async function updateRedeemCode(request) {
  await ensureCollection('redeem_codes');
  const codeId = String(request.body.codeId || '').trim();
  const code = normalizeRedeemCode(request.body.code);
  const action = String(request.body.action || '').trim();
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
  if (action === 'disable' || action === 'activate') updateData.status = action === 'disable' ? 'disabled' : 'active';
  if (action === 'markSent') {
    updateData.deliveryStatus = 'sent';
    updateData.deliveredAt = now;
    updateData.deliveredTo = String(request.body.deliveredTo || target.deliveredTo || '').trim();
  }
  if (action === 'markUnsent') {
    updateData.deliveryStatus = 'unsent';
    updateData.deliveredAt = '';
    updateData.deliveredTo = '';
  }
  await db.collection('redeem_codes').doc(targetId).update({ data: updateData });
  return { ...target, _id: targetId, ...updateData, ...normalizeCodeDeliveryState({ ...target, ...updateData }) };
}

async function updateEntitlement(request) {
  await ensureCollection('user_entitlements');
  const entitlementId = String(request.body.entitlementId || '').trim();
  const action = String(request.body.action || '').trim();
  if (!entitlementId) throw new Error('缺少 Pro 用户记录 ID');
  if (!['extend', 'disable', 'activate', 'addCloudQuota'].includes(action)) throw new Error('不支持的 Pro 用户操作');
  const result = await db.collection('user_entitlements').doc(entitlementId).get();
  const entitlement = result.data;
  if (!entitlement) throw new Error('Pro 用户记录不存在');
  const now = new Date().toISOString();
  const updateData = { updatedAt: now };
  if (action === 'extend') {
    const days = normalizeAdminPositiveInteger(request.body.days, 1, 9999, 30);
    const base = entitlement.expiresAt && new Date(entitlement.expiresAt).getTime() > new Date(now).getTime() ? entitlement.expiresAt : now;
    updateData.status = 'active';
    updateData.expiresAt = addDays(base, days);
  }
  if (action === 'disable') updateData.status = 'disabled';
  if (action === 'activate') updateData.status = 'active';
  if (action === 'addCloudQuota') {
    const minutes = normalizeAdminPositiveInteger(request.body.minutes, 1, 100000, 60);
    updateData.cloudQuotaSeconds = _.inc(minutes * 60);
    updateData.cloudQuotaUpdatedAt = now;
  }
  await db.collection('user_entitlements').doc(entitlementId).update({ data: updateData });
  return {
    ...entitlement,
    _id: entitlementId,
    ...updateData,
    cloudQuotaSeconds: action === 'addCloudQuota'
      ? (Number(entitlement.cloudQuotaSeconds) || 0) + (normalizeAdminPositiveInteger(request.body.minutes, 1, 100000, 60) * 60)
      : Number(entitlement.cloudQuotaSeconds) || 0,
    remainingDays: formatRemainingDays(updateData.expiresAt || entitlement.expiresAt, now),
  };
}

async function listBindCodes(request) {
  await ensureCollection('bind_codes');
  const limit = normalizeAdminPositiveInteger(request.body.limit || request.query.limit, 1, 500, 100);
  const keyword = request.body.keyword || request.query.keyword || '';
  const snapshot = await readCollection('bind_codes', { orderField: 'createdAt', maxRead: 5000 });
  const now = new Date().toISOString();
  const items = (snapshot.data || []).map((item) => {
    const status = createBindStatusResponse(item, now);
    return {
      _id: item._id,
      openid: item.openid || '',
      code: status.code,
      status: status.status,
      clientCount: status.clientCount,
      clients: status.clients || [],
      deviceLimit: status.deviceLimit,
      createdAt: status.createdAt,
      boundAt: status.boundAt || '',
    };
  });
  return {
    items: filterByKeyword(items, keyword, ['openid', 'code', 'status']).slice(0, limit),
    total: items.length,
  };
}

async function listRecords(request) {
  await ensureCollection('inbox_records');
  const limit = normalizeAdminPositiveInteger(request.body.limit || request.query.limit, 1, 500, 100);
  const maxRead = normalizeAdminPositiveInteger(request.body.maxRead || request.query.maxRead, 100, 5000, 1000);
  const keyword = String(request.body.keyword || request.query.keyword || '').trim().toUpperCase();
  const typeFilter = String(request.body.recordType || request.query.recordType || '').trim().toLowerCase();
  const statusFilter = String(request.body.status || request.query.status || '').trim().toLowerCase();
  const since = String(request.body.since || request.query.since || '').trim();
  const until = String(request.body.until || request.query.until || '').trim();
  const snapshot = await readCollection('inbox_records', { orderField: 'createdAt', maxRead });
  const rows = (snapshot.data || [])
    .filter((item) => !typeFilter || String(item.type || '').toLowerCase() === typeFilter)
    .filter((item) => !statusFilter || String(item.status || '').toLowerCase() === statusFilter)
    .filter((item) => isAdminTimeInWindow(item.createdAt || item.updatedAt || item.syncedAt, since, until))
    .map(buildRecordDiagnosticRow)
    .filter((item) => {
      if (!keyword) return true;
      return [
        item._id,
        item.openid,
        item.type,
        item.status,
        item.content,
        item.metadata.url,
        item.metadata.originalUrl,
        item.metadata.title,
        item.metadata.shareText,
        item.metadata.conversionStatus,
        item.metadata.conversionError,
        item.metadata.transcriptionStatus,
        item.metadata.transcriptionError,
      ].some((value) => String(value || '').toUpperCase().includes(keyword));
    });
  return {
    items: rows.slice(0, limit),
    total: rows.length,
    scanned: (snapshot.data || []).length,
    databaseTotal: snapshot.total,
    isTruncated: snapshot.isTruncated,
  };
}

async function debugEntitlementLookup(request) {
  const token = String(request.body.token || request.body.code || request.query.token || request.query.code || '').trim();
  const clientId = String(request.body.clientId || request.query.clientId || '').trim();
  const openidInput = String(request.body.openid || request.query.openid || '').trim();
  const candidates = token ? getBindCodeLookupCandidates(token) : [];
  let bindCode = null;
  if (candidates.length) {
    const bindResult = await db.collection('bind_codes')
      .where({
        code: _.in(candidates),
      })
      .limit(1)
      .get();
    bindCode = bindResult.data && bindResult.data[0] ? bindResult.data[0] : null;
  }
  const openid = openidInput || (bindCode && bindCode.openid) || '';
  const entitlementsResult = openid
    ? await db.collection('user_entitlements')
      .where({ openid })
      .limit(100)
      .get()
    : { data: [] };
  const entitlements = (entitlementsResult.data || []).map((item) => ({
    _id: item._id || '',
    openid: item.openid || '',
    plan: item.plan || '',
    status: item.status || '',
    code: item.code || '',
    expiresAt: item.expiresAt || '',
    redeemedAt: item.redeemedAt || '',
    updatedAt: item.updatedAt || '',
  }));
  return {
    token,
    candidates,
    clientId,
    resolvedOpenid: openid,
    bindCode: bindCode ? createBindStatusResponse(bindCode, new Date().toISOString()) : null,
    entitlementCount: entitlements.length,
    entitlements,
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

async function listPaymentOrders(request) {
  await ensureCollection('payment_orders');
  const limit = normalizeAdminPositiveInteger(request.body.limit || request.query.limit, 1, 500, 100);
  const keyword = String(request.body.keyword || request.query.keyword || '').trim().toUpperCase();
  const statusFilter = String(request.body.status || request.query.status || '').trim();
  const snapshot = await readCollection('payment_orders', { orderField: 'createdAt', maxRead: 5000 });
  const rows = (snapshot.data || [])
    .filter((item) => !statusFilter || item.status === statusFilter)
    .filter((item) => filterByKeyword([item], keyword, ['orderNo', 'openid', 'planId', 'planName', 'status']).length)
    .map((item) => ({
      _id: item._id,
      openid: item.openid || '',
      ...buildPaymentOrderState(item),
      updatedAt: item.updatedAt || '',
    }));
  return {
    items: rows.slice(0, limit),
    total: rows.length,
  };
}

async function updatePaymentOrder(request) {
  await ensureCollection('payment_orders');
  const orderNo = String(request.body.orderNo || request.query.orderNo || '').trim();
  const action = String(request.body.action || request.query.action || '').trim();
  if (!orderNo) throw new Error('缺少订单号');
  const result = await db.collection('payment_orders').where({ orderNo }).limit(1).get();
  const order = result.data && result.data[0] ? result.data[0] : null;
  if (!order || !order._id) throw new Error('订单不存在');
  const now = new Date().toISOString();
  const updateData = { updatedAt: now };
  if (action === 'markPaid') {
    updateData.status = 'paid';
    updateData.paidAt = order.paidAt || now;
    updateData.payMode = order.payMode || 'manual_pending';
    await applyPaidPaymentOrder({ ...order, ...updateData }, updateData.paidAt);
  } else if (action === 'cancel') {
    updateData.status = 'cancelled';
  } else {
    throw new Error('不支持的订单操作');
  }
  await db.collection('payment_orders').doc(order._id).update({ data: updateData });
  return buildPaymentOrderState({ ...order, ...updateData });
}

async function getRuntimeDiagnostic() {
  const [records, bindCodes, entitlements, redeemCodes] = await Promise.all([
    readCollection('inbox_records', { orderField: 'createdAt', maxRead: 100 }),
    readCollection('bind_codes', { orderField: 'createdAt', maxRead: 100 }),
    readCollection('user_entitlements', { orderField: 'updatedAt', maxRead: 100 }),
    readCollection('redeem_codes', { orderField: 'updatedAt', maxRead: 100 }),
  ]);
  return {
    namespace: process.env.TCB_ENV || process.env.SCF_NAMESPACE || '',
    dynamicCurrentEnv: String(cloud.DYNAMIC_CURRENT_ENV || ''),
    configuredDataEnv: String(process.env.WECHAT_DATA_ENV || ''),
    counts: {
      inbox_records: records.total,
      bind_codes: bindCodes.total,
      user_entitlements: entitlements.total,
      redeem_codes: redeemCodes.total,
    },
    sampleSizes: {
      inbox_records: records.data.length,
      bind_codes: bindCodes.data.length,
      user_entitlements: entitlements.data.length,
      redeem_codes: redeemCodes.data.length,
    },
  };
}

async function dispatch(request) {
  assertAdminSecret(request.adminSecret);
  if (request.path === '/runtime' || request.path === 'runtime') return await getRuntimeDiagnostic(request);
  if (request.path === '/summary' || request.path === 'summary') return await getSummary(request);
  if (request.path === '/users' || request.path === 'users') return await listUsers(request);
  if (request.path === '/pro-users' || request.path === 'pro-users') return await listProUsers(request);
  if (request.path === '/redeem-codes' || request.path === 'redeem-codes') return await listRedeemCodes(request);
  if (request.path === '/redeem-codes/generate' || request.path === 'redeem-codes/generate') return await generateRedeemCodes(request);
  if (request.path === '/redeem-codes/update' || request.path === 'redeem-codes/update') return await updateRedeemCode(request);
  if (request.path === '/entitlements/update' || request.path === 'entitlements/update') return await updateEntitlement(request);
  if (request.path === '/entitlement-debug' || request.path === 'entitlement-debug') return await debugEntitlementLookup(request);
  if (request.path === '/payment-orders' || request.path === 'payment-orders') return await listPaymentOrders(request);
  if (request.path === '/payment-orders/update' || request.path === 'payment-orders/update') return await updatePaymentOrder(request);
  if (request.path === '/bind-codes' || request.path === 'bind-codes') return await listBindCodes(request);
  if (request.path === '/records' || request.path === 'records') return await listRecords(request);
  const error = new Error('未知管理接口');
  error.statusCode = 404;
  throw error;
}

async function handleAdminRequest(request) {
  return await dispatch(request || {});
}

exports.main = async (event) => {
  const request = getRequest(event || {});
  if (request.method === 'OPTIONS') {
    return jsonResponse(204, { success: true });
  }
  try {
    const data = await dispatch(request);
    return jsonResponse(200, {
      success: true,
      data,
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      success: false,
      errMsg: error.message || String(error),
      code: error.code || '',
    });
  }
};

exports.handleAdminRequest = handleAdminRequest;
