const {
  DEFAULT_REDEEM_PLAN,
  createRedeemCodeDocument,
} = require('./redeem-code-core');

const ADMIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ADMIN_MAX_DURATION_DAYS = 9999;

function normalizeAdminCodePrefix(prefix, fallback = 'OBPRO') {
  const normalized = String(prefix || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return normalized || fallback;
}

function normalizeAdminPositiveInteger(value, min, max, fallback) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    return fallback;
  }
  return normalized;
}

function generateAdminRedeemCode(prefix, randomInt = (max) => Math.floor(Math.random() * max)) {
  let suffix = '';
  for (let index = 0; index < 5; index += 1) {
    suffix += ADMIN_CODE_CHARS[randomInt(ADMIN_CODE_CHARS.length)];
  }
  return `${normalizeAdminCodePrefix(prefix)}${suffix}`;
}

function createAdminRedeemCodeDocuments({
  count,
  prefix,
  durationDays,
  maxRedemptions,
  note = '',
  now = new Date().toISOString(),
  plan = DEFAULT_REDEEM_PLAN,
  randomInt,
} = {}) {
  const normalizedCount = normalizeAdminPositiveInteger(count, 1, 100, 1);
  const normalizedDurationDays = normalizeAdminPositiveInteger(durationDays, 1, ADMIN_MAX_DURATION_DAYS, 30);
  const normalizedPrefix = normalizeAdminCodePrefix(prefix);
  const codes = new Set();
  const documents = [];

  while (documents.length < normalizedCount) {
    const code = generateAdminRedeemCode(normalizedPrefix, randomInt);
    if (codes.has(code)) continue;
    codes.add(code);
    documents.push(createRedeemCodeDocument({
      code,
      plan,
      durationDays: normalizedDurationDays,
      maxRedemptions: 1,
      note,
      now,
    }));
  }

  return documents;
}

function isRedeemCodeActivatedForAdmin(item) {
  if (!item) return false;
  if ((Number(item.redeemedCount) || 0) > 0) return true;
  const deliveryStatus = String(item.deliveryStatus || '').trim().toLowerCase();
  const status = String(item.status || '').trim().toLowerCase();
  return deliveryStatus === 'activated'
    || status === 'redeemed'
    || Boolean(item.lastRedeemedOpenId || item.redeemedOpenId)
    || Boolean(item.paidOwnerOpenid || item.trialOwnerOpenid)
    || Boolean(item.paymentOrderNo || item.latestPaymentOrderNo);
}

function getAdminTimeRange(now = new Date().toISOString()) {
  const nowTime = new Date(now).getTime();
  const safeNow = Number.isNaN(nowTime) ? Date.now() : nowTime;
  return {
    now: new Date(safeNow).toISOString(),
    last24h: new Date(safeNow - 24 * 60 * 60 * 1000).toISOString(),
    stalePending: new Date(safeNow - 24 * 60 * 60 * 1000).toISOString(),
    expiringSoon: new Date(safeNow + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function isDateAfter(value, cutoff) {
  if (!value || !cutoff) return false;
  const valueTime = new Date(value).getTime();
  const cutoffTime = new Date(cutoff).getTime();
  return !Number.isNaN(valueTime) && !Number.isNaN(cutoffTime) && valueTime >= cutoffTime;
}

function isDateBefore(value, cutoff) {
  if (!value || !cutoff) return false;
  const valueTime = new Date(value).getTime();
  const cutoffTime = new Date(cutoff).getTime();
  return !Number.isNaN(valueTime) && !Number.isNaN(cutoffTime) && valueTime <= cutoffTime;
}

function getRecordFileCount(record) {
  const metadata = (record && record.metadata) || {};
  return [metadata.fileID, metadata.audioFileID].filter(Boolean).length;
}

function getRecordFileSize(record) {
  const metadata = (record && record.metadata) || {};
  return Number(metadata.fileSize || metadata.audioFileSize || 0) || 0;
}

function getOpenId(item) {
  return String(item && (item.openid || item.openId || item.userOpenId || '')).trim();
}

function uniqueCount(items, mapper = getOpenId) {
  const values = new Set();
  items.forEach((item) => {
    const value = mapper(item);
    if (value) values.add(value);
  });
  return values.size;
}

function getUniqueValues(items, mapper = getOpenId) {
  const values = new Set();
  items.forEach((item) => {
    const value = mapper(item);
    if (value) values.add(value);
  });
  return values;
}

function unionSetCount(...sets) {
  const values = new Set();
  sets.forEach((set) => {
    if (!set || !set.forEach) return;
    set.forEach((value) => {
      if (value) values.add(value);
    });
  });
  return values.size;
}

function formatAdminRate(value) {
  if (!Number.isFinite(value)) return '-';
  return `${Math.round(value * 100)}%`;
}

function buildFunnelStep({ key, label, value, previousValue, hint }) {
  const rate = previousValue > 0 ? value / previousValue : null;
  return {
    key,
    label,
    value,
    hint,
    rate,
    rateText: rate === null ? '-' : formatAdminRate(rate),
  };
}

function getItemTime(item, fields = ['createdAt', 'updatedAt']) {
  if (!item) return '';
  for (const field of fields) {
    if (item[field]) return item[field];
  }
  return '';
}

function getDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const chinaTime = date.getTime() + 8 * 60 * 60 * 1000;
  return new Date(chinaTime).toISOString().slice(0, 10);
}

function getPreviousDateKey(now = new Date().toISOString()) {
  const nowTime = new Date(now).getTime();
  const safeNow = Number.isNaN(nowTime) ? Date.now() : nowTime;
  return getDateKey(new Date(safeNow - 24 * 60 * 60 * 1000).toISOString());
}

function getWindowStart(rangeKey, now) {
  const nowTime = new Date(now).getTime();
  if (Number.isNaN(nowTime)) return '';
  const spanMap = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const span = spanMap[rangeKey];
  return span ? new Date(nowTime - span).toISOString() : '';
}

function buildFunnelBreakpoints(steps = []) {
  return steps.slice(1).map((step, index) => {
    const previous = steps[index] || {};
    const previousValue = Number(previous.value) || 0;
    const currentValue = Number(step.value) || 0;
    const dropValue = Math.max(0, previousValue - currentValue);
    const conversion = previousValue > 0 ? currentValue / previousValue : null;
    const dropRate = previousValue > 0 ? dropValue / previousValue : null;
    let severity = 'ok';
    if (previousValue >= 10 && dropRate !== null && dropRate >= 0.5) severity = 'danger';
    else if (previousValue >= 10 && dropRate !== null && dropRate >= 0.3) severity = 'warn';
    const actionMap = {
      bindPageUsers: '检查首页是否 1 分钟内讲清楚“先绑定 Obsidian，再开始同步”。',
      bindSuccessUsers: '优先排查插件安装、绑定码复制、插件设置页入口和绑定失败提示。',
      syncedUsers: '检查插件是否自动同步、Obsidian 是否打开、首次成功反馈是否足够明显。',
      repeatSyncUsers: '增加“同步成功后还能怎么用”的场景提示，让用户形成复用。',
      activeProUsers: '在音视频链接失败或识别场景里自然提示 Pro，而不是只等用户主动点开通页。',
    };
    return {
      key: `${previous.key}_to_${step.key}`,
      from: previous.label || '',
      to: step.label || '',
      fromValue: previousValue,
      toValue: currentValue,
      dropValue,
      conversionRate: conversion,
      conversionText: conversion === null ? '-' : formatAdminRate(conversion),
      dropText: dropRate === null ? '-' : formatAdminRate(dropRate),
      severity,
      action: actionMap[step.key] || '继续观察这个环节的用户行为。',
    };
  });
}

function getFirstSeenMap({ analyticsEvents = [], records = [], bindCodes = [], entitlements = [] } = {}) {
  const firstSeen = new Map();
  function touch(openid, time) {
    if (!openid || !time) return;
    const existed = firstSeen.get(openid);
    if (!existed || time < existed) firstSeen.set(openid, time);
  }
  analyticsEvents.forEach((item) => touch(getOpenId(item), getItemTime(item, ['firstAt', 'createdAt', 'lastAt'])));
  records.forEach((item) => touch(getOpenId(item), getItemTime(item, ['createdAt', 'updatedAt', 'syncedAt'])));
  bindCodes.forEach((item) => touch(getOpenId(item), getItemTime(item, ['createdAt', 'boundAt', 'updatedAt'])));
  entitlements.forEach((item) => touch(getOpenId(item), getItemTime(item, ['redeemedAt', 'createdAt', 'updatedAt'])));
  return firstSeen;
}

function buildUserSegments({ currentOpenIds, firstSeen, windowStart, activeProOpenIds, repeatSyncOpenIds } = {}) {
  const current = Array.from(currentOpenIds || []);
  const newUsers = windowStart
    ? current.filter((openid) => {
      const firstTime = firstSeen && firstSeen.get(openid);
      return firstTime && firstTime >= windowStart;
    })
    : [];
  const returningUsers = windowStart ? current.filter((openid) => !newUsers.includes(openid)) : [];
  return [
    {
      key: 'activeUsers',
      label: '活跃用户',
      value: current.length,
      hint: '当前时间范围内有访问、绑定、收集、同步或 Pro 行为',
    },
    {
      key: 'newUsers',
      label: '新用户',
      value: windowStart ? newUsers.length : '-',
      hint: windowStart ? '首次出现就在当前时间范围内' : '总计视图不区分新老用户',
    },
    {
      key: 'returningUsers',
      label: '老用户',
      value: windowStart ? returningUsers.length : '-',
      hint: windowStart ? '当前范围内活跃，但更早就出现过' : '切到 30 天 / 7 天 / 24h 可看',
    },
    {
      key: 'repeatSyncUsers',
      label: '复用用户',
      value: repeatSyncOpenIds ? repeatSyncOpenIds.size : 0,
      hint: '至少同步过 2 条内容',
    },
    {
      key: 'activeProUsers',
      label: 'Pro 用户',
      value: activeProOpenIds ? activeProOpenIds.size : 0,
      hint: '当前仍在有效期内',
    },
  ];
}

function buildDailyTrend({ records = [], analyticsEvents = [], bindCodes = [], entitlements = [], now } = {}) {
  const nowTime = new Date(now).getTime();
  const safeNow = Number.isNaN(nowTime) ? Date.now() : nowTime;
  const days = [];
  for (let index = 13; index >= 0; index -= 1) {
    const day = getDateKey(new Date(safeNow - index * 24 * 60 * 60 * 1000).toISOString());
    days.push({
      day,
      visits: new Set(),
      binds: new Set(),
      syncs: new Set(),
      pros: new Set(),
      records: 0,
    });
  }
  const map = new Map(days.map((item) => [item.day, item]));
  analyticsEvents.forEach((item) => {
    const day = item.day || getDateKey(item.lastAt || item.firstAt || item.createdAt);
    const target = map.get(day);
    const openid = getOpenId(item);
    if (!target || !openid) return;
    if (item.eventName === 'app_visit') target.visits.add(openid);
    if (item.eventName === 'bind_success') target.binds.add(openid);
  });
  bindCodes.forEach((item) => {
    const day = getDateKey(item.boundAt || item.updatedAt || item.createdAt);
    const target = map.get(day);
    const openid = getOpenId(item);
    if (target && openid && (item.status === 'bound' || (Array.isArray(item.clients) && item.clients.length))) {
      target.binds.add(openid);
    }
  });
  records.forEach((item) => {
    const createdDay = getDateKey(item.createdAt || item.updatedAt);
    const createdTarget = map.get(createdDay);
    if (createdTarget) createdTarget.records += 1;
    const syncDay = getDateKey(getSyncedRecordTime(item));
    const syncTarget = map.get(syncDay);
    const openid = getOpenId(item);
    if (syncTarget && openid && item.status === 'synced') syncTarget.syncs.add(openid);
  });
  entitlements.forEach((item) => {
    const day = getDateKey(item.redeemedAt || item.updatedAt || item.createdAt);
    const target = map.get(day);
    const openid = getOpenId(item);
    if (target && openid && (item.status || 'active') === 'active') target.pros.add(openid);
  });
  return days.map((item) => ({
    day: item.day,
    visits: item.visits.size,
    binds: item.binds.size,
    syncs: item.syncs.size,
    pros: item.pros.size,
    records: item.records,
  }));
}

function getSyncedRecordTime(item) {
  return item && (item.syncedAt || (item.status === 'synced' ? item.updatedAt || item.createdAt : ''));
}

function getEventCount(item) {
  return Number(item && item.count) || 1;
}

function hasBoundBefore(bindCode, day) {
  if (!bindCode || !day) return false;
  const clients = Array.isArray(bindCode.clients) ? bindCode.clients : [];
  return clients.some((client) => getDateKey(client.boundAt || bindCode.boundAt || bindCode.updatedAt || bindCode.createdAt) < day)
    || (bindCode.boundAt && getDateKey(bindCode.boundAt) < day);
}

function hasBoundOnDay(bindCode, day) {
  if (!bindCode || !day) return false;
  const clients = Array.isArray(bindCode.clients) ? bindCode.clients : [];
  return clients.some((client) => getDateKey(client.boundAt || bindCode.boundAt || bindCode.updatedAt || bindCode.createdAt) === day)
    || (bindCode.boundAt && getDateKey(bindCode.boundAt) === day);
}

function getEntitlementOpenDay(entitlement) {
  return getDateKey(entitlement && (entitlement.redeemedAt || entitlement.createdAt || entitlement.updatedAt));
}

function isPaidEntitlement(entitlement) {
  return (Number(entitlement && entitlement.durationDays) || 0) >= 30;
}

function buildYesterdayFunnel({
  analyticsEvents = [],
  entitlements = [],
  bindCodes = [],
  now = new Date().toISOString(),
} = {}) {
  const day = getPreviousDateKey(now);
  const yesterdayVisits = analyticsEvents.filter((item) => item.eventName === 'app_visit' && (item.day || getDateKey(item.lastAt || item.firstAt || item.createdAt)) === day);
  const visitOpenIds = getUniqueValues(yesterdayVisits);
  const boundBeforeOpenIds = getUniqueValues(bindCodes.filter((item) => hasBoundBefore(item, day)));
  const boundOnDayOpenIds = getUniqueValues(bindCodes.filter((item) => hasBoundOnDay(item, day)));
  const newOpenIds = new Set();
  const returningOpenIds = new Set();

  visitOpenIds.forEach((openid) => {
    if (boundBeforeOpenIds.has(openid)) returningOpenIds.add(openid);
    else newOpenIds.add(openid);
  });

  const newBoundOpenIds = new Set(Array.from(newOpenIds).filter((openid) => boundOnDayOpenIds.has(openid)));
  const proOpenedOpenIds = getUniqueValues(entitlements.filter((item) => getEntitlementOpenDay(item) === day));
  const paidOpenedOpenIds = getUniqueValues(entitlements.filter((item) => getEntitlementOpenDay(item) === day && isPaidEntitlement(item)));
  const totalProOpenIds = getUniqueValues(entitlements);
  const totalBoundCount = bindCodes.reduce((sum, item) => sum + (Array.isArray(item.clients) ? item.clients.length : 0), 0);
  const totalVisitEvents = analyticsEvents
    .filter((item) => item.eventName === 'app_visit')
    .reduce((sum, item) => sum + getEventCount(item), 0);

  const data = {
    day,
    visitUserTotal: visitOpenIds.size,
    newUserCount: newOpenIds.size,
    returningUserCount: returningOpenIds.size,
    newBoundUserCount: newBoundOpenIds.size,
    proOpenedUsers: proOpenedOpenIds.size,
    paidOpenedUsers: paidOpenedOpenIds.size,
    totalProOpenedUsers: totalProOpenIds.size,
    totalBoundCount,
    totalVisitEvents,
  };

  data.cards = [
    { key: 'visitUserTotal', label: '访问用户总数', value: data.visitUserTotal, hint: day },
    { key: 'newUserCount', label: '新用户数', value: data.newUserCount, hint: '未完成绑定的用户，含第一次绑定用户' },
    { key: 'returningUserCount', label: '老用户数', value: data.returningUserCount, hint: '此前已完成绑定的访问用户' },
    { key: 'newBoundUserCount', label: '新用户中完成绑定的用户', value: data.newBoundUserCount, hint: '昨天第一次完成绑定' },
    { key: 'proOpenedUsers', label: '开通 Pro 的用户数', value: data.proOpenedUsers, hint: '含 7 天体验数' },
    { key: 'paidOpenedUsers', label: '开通付费数', value: data.paidOpenedUsers, hint: 'Pro 时长 30 天及以上' },
    { key: 'totalProOpenedUsers', label: '总 Pro 开通数', value: data.totalProOpenedUsers, hint: '历史累计去重用户' },
    { key: 'totalBoundCount', label: '总绑定数', value: data.totalBoundCount, hint: '历史绑定设备数' },
    { key: 'totalVisitEvents', label: '总访问数', value: data.totalVisitEvents, hint: '历史访问总人次' },
  ];

  return data;
}

function summarizeRecordTypes(records = []) {
  const labels = {
    text: '文字',
    link: '链接',
    webpage: '网页',
    voice: '语音',
    audio: '音频',
    file: '文件',
    image: '图片',
    video: '视频',
  };
  const counts = {};
  records.forEach((item) => {
    const key = String(item && item.type || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, 6)
    .map((key) => ({
      key,
      label: labels[key] || key,
      value: counts[key],
    }));
}

function buildAdminDiagnoses({
  pendingRecords,
  stalePendingRecords,
  cleanupFailedRecords,
  visitUsers,
  bindPageUsers,
  bindSuccessUsers,
  syncedUsers,
  repeatSyncUsers,
  activeProUsers,
} = {}) {
  const diagnoses = [];
  const bindPageRate = visitUsers > 0 ? bindPageUsers / visitUsers : null;
  const bindRate = bindPageUsers > 0 ? bindSuccessUsers / bindPageUsers : null;
  const syncRate = bindSuccessUsers > 0 ? syncedUsers / bindSuccessUsers : null;
  const repeatRate = syncedUsers > 0 ? repeatSyncUsers / syncedUsers : null;
  const proRate = syncedUsers > 0 ? activeProUsers / syncedUsers : null;

  if (visitUsers >= 20 && bindPageRate !== null && bindPageRate < 0.5) {
    diagnoses.push({
      type: 'warning',
      title: '访问到绑定页掉人',
      desc: `访问用户里，到达绑定页的占比约 ${formatAdminRate(bindPageRate)}。如果首页不是默认绑定页，就要检查首页引导；如果默认就是绑定页，说明埋点或页面进入逻辑要排查。`,
    });
  }

  if (bindPageUsers >= 10 && bindRate !== null && bindRate < 0.5) {
    diagnoses.push({
      type: 'warning',
      title: '绑定流程掉人',
      desc: `到达绑定页到插件绑定成功的转化只有 ${formatAdminRate(bindRate)}。优先检查教程、插件安装、绑定码复制、插件设置页入口和用户端绑定报错。`,
    });
  }

  if (bindSuccessUsers >= 5 && syncRate !== null && syncRate < 0.7) {
    diagnoses.push({
      type: 'warning',
      title: '绑定后没有完成首次同步',
      desc: `绑定成功用户里，首次同步成功占比约 ${formatAdminRate(syncRate)}。这里通常是插件未开启、Obsidian 没运行、网络请求失败或用户不知道点同步。`,
    });
  }

  if (syncedUsers >= 5 && repeatRate !== null && repeatRate < 0.4) {
    diagnoses.push({
      type: 'notice',
      title: '复用不够',
      desc: `同步成功后，有二次同步行为的用户约 ${formatAdminRate(repeatRate)}。说明首用可以跑通，但还没有变成习惯，需要优化首页提示、成功反馈和使用场景教育。`,
    });
  }

  if (pendingRecords.length >= 20 || stalePendingRecords.length >= 5) {
    diagnoses.push({
      type: 'danger',
      title: '云端暂存积压',
      desc: `当前样本里待同步 ${pendingRecords.length} 条，其中超 24 小时 ${stalePendingRecords.length} 条。优先排查插件同步失败、附件清理和用户端网络。`,
    });
  }

  if (cleanupFailedRecords.length > 0) {
    diagnoses.push({
      type: 'warning',
      title: '附件清理失败',
      desc: `有 ${cleanupFailedRecords.length} 条记录清理附件失败，可能拖慢同步并占用云存储。需要看下失败文件和云存储权限。`,
    });
  }

  if (syncedUsers >= 10 && proRate !== null && proRate < 0.15) {
    diagnoses.push({
      type: 'notice',
      title: 'Pro 转化偏弱',
      desc: `同步成功用户里，有效 Pro 占比约 ${formatAdminRate(proRate)}。如果目标是卖 Pro，需要在音视频链接场景自然提示，而不是只放在开通页。`,
    });
  }

  if (!diagnoses.length) {
    diagnoses.push({
      type: 'good',
      title: '暂无明显流程异常',
      desc: '当前样本里没有看到特别突出的断点。下一步建议接入首页曝光和教程点击埋点，把访问到绑定的掉点算清楚。',
    });
  }

  return diagnoses.slice(0, 6);
}

function summarizeAdminDashboard({
  records = [],
  redeemCodes = [],
  entitlements = [],
  bindCodes = [],
  analyticsEvents = [],
  allRecords = records,
  allEntitlements = entitlements,
  allBindCodes = bindCodes,
  allAnalyticsEvents = analyticsEvents,
  rangeKey = 'all',
  windowStart = '',
  now = new Date().toISOString(),
  sampleLimit = 200,
  scope = null,
} = {}) {
  const range = getAdminTimeRange(now);
  const pendingRecords = records.filter((item) => item.status === 'pending');
  const syncedRecords = records.filter((item) => item.status === 'synced');
  const stalePendingRecords = pendingRecords.filter((item) => isDateBefore(item.createdAt, range.stalePending));
  const cleanupFailedRecords = records.filter((item) => item && item.metadata && item.metadata.cleanupStatus === 'storage-delete-failed');
  const storageHoldingRecords = records.filter((item) => item.status !== 'synced' && getRecordFileCount(item) > 0);
  const activeEntitlements = entitlements.filter((item) => {
    const expiresAt = item.expiresAt || '';
    return (item.status || 'active') === 'active' && (!expiresAt || isDateAfter(expiresAt, range.now));
  });
  const expiringEntitlements = activeEntitlements.filter((item) => item.expiresAt && isDateBefore(item.expiresAt, range.expiringSoon));
  const sentUnactivatedCodes = redeemCodes.filter((item) => !isRedeemCodeActivatedForAdmin(item) && item.deliveryStatus === 'sent');
  const unsentCodes = redeemCodes.filter((item) => !isRedeemCodeActivatedForAdmin(item) && item.deliveryStatus !== 'sent');
  const activatedCodes = redeemCodes.filter((item) => isRedeemCodeActivatedForAdmin(item));
  const boundCodes = bindCodes.filter((item) => item.status === 'bound');
  const totalBoundClients = bindCodes.reduce((sum, item) => {
    const clients = Array.isArray(item.clients) ? item.clients : [];
    return sum + clients.length;
  }, 0);
  const createdBindCodeUsers = uniqueCount(bindCodes);
  const currentBoundOpenIds = getUniqueValues(bindCodes.filter((item) => item.status === 'bound' || (Array.isArray(item.clients) && item.clients.length)));
  const bindSuccessEventOpenIds = getUniqueValues(analyticsEvents.filter((item) => item.eventName === 'bind_success'));
  const boundUsers = currentBoundOpenIds.size;
  const bindSuccessUsers = unionSetCount(currentBoundOpenIds, bindSuccessEventOpenIds);
  const collectedUsers = uniqueCount(records);
  const syncedUsers = uniqueCount(syncedRecords);
  const activeProUsers = uniqueCount(activeEntitlements);
  const visitUsers = uniqueCount(analyticsEvents.filter((item) => item.eventName === 'app_visit'));
  const bindPageUsers = uniqueCount(analyticsEvents.filter((item) => item.eventName === 'bind_page_view'));
  const syncCountsByUser = syncedRecords.reduce((map, item) => {
    const openid = getOpenId(item);
    if (!openid) return map;
    map[openid] = (map[openid] || 0) + 1;
    return map;
  }, {});
  const repeatSyncOpenIds = new Set(Object.keys(syncCountsByUser).filter((openid) => syncCountsByUser[openid] >= 2));
  const activeProOpenIds = getUniqueValues(activeEntitlements);
  const currentOpenIds = new Set();
  [
    getUniqueValues(analyticsEvents),
    getUniqueValues(records),
    getUniqueValues(bindCodes),
    getUniqueValues(entitlements),
  ].forEach((set) => set.forEach((openid) => currentOpenIds.add(openid)));
  const firstSeen = getFirstSeenMap({
    analyticsEvents: allAnalyticsEvents,
    records: allRecords,
    bindCodes: allBindCodes,
    entitlements: allEntitlements,
  });
  const repeatSyncUsers = repeatSyncOpenIds.size;
  const funnelSteps = [
    buildFunnelStep({
      key: 'visitUsers',
      label: '访问数',
      value: visitUsers,
      previousValue: null,
      hint: '打开过小程序的去重用户',
    }),
    buildFunnelStep({
      key: 'bindPageUsers',
      label: '到达绑定页面数',
      value: bindPageUsers,
      previousValue: visitUsers,
      hint: `${createdBindCodeUsers} 个微信拥有绑定码`,
    }),
    buildFunnelStep({
      key: 'bindSuccessUsers',
      label: '绑定成功数',
      value: bindSuccessUsers,
      previousValue: bindPageUsers,
      hint: `${boundCodes.length} 个绑定码，${totalBoundClients} 台设备`,
    }),
    buildFunnelStep({
      key: 'syncedUsers',
      label: '首次同步成功数',
      value: syncedUsers,
      previousValue: bindSuccessUsers,
      hint: '至少有 1 条记录被插件同步',
    }),
    buildFunnelStep({
      key: 'repeatSyncUsers',
      label: '二次以上同步用户数',
      value: repeatSyncUsers,
      previousValue: syncedUsers,
      hint: '至少同步过 2 条内容',
    }),
    buildFunnelStep({
      key: 'activeProUsers',
      label: 'Pro 用户数',
      value: activeProUsers,
      previousValue: syncedUsers,
      hint: '当前仍在有效期内',
    }),
  ];
  const funnelBreakpoints = buildFunnelBreakpoints(funnelSteps);
  const typeBreakdown = summarizeRecordTypes(records);
  const diagnoses = buildAdminDiagnoses({
    pendingRecords,
    stalePendingRecords,
    cleanupFailedRecords,
    visitUsers,
    bindPageUsers,
    bindSuccessUsers,
    syncedUsers,
    repeatSyncUsers,
    activeProUsers,
  });
  const segments = buildUserSegments({
    currentOpenIds,
    firstSeen,
    windowStart: windowStart || getWindowStart(rangeKey, range.now),
    activeProOpenIds,
    repeatSyncOpenIds,
  });
  const dailyTrend = buildDailyTrend({
    records,
    analyticsEvents,
    bindCodes,
    entitlements,
    now: range.now,
  });
  const conversionCards = [
    {
      key: 'visitToBindPage',
      label: '访问到绑定页',
      value: funnelSteps[1].rateText,
      hint: `${visitUsers} → ${bindPageUsers}`,
    },
    {
      key: 'bindPageToSuccess',
      label: '绑定页到成功',
      value: funnelSteps[2].rateText,
      hint: `${bindPageUsers} → ${bindSuccessUsers}`,
    },
    {
      key: 'bindToFirstSync',
      label: '绑定到首同步',
      value: funnelSteps[3].rateText,
      hint: `${bindSuccessUsers} → ${syncedUsers}`,
    },
    {
      key: 'syncToRepeat',
      label: '首同步到复用',
      value: funnelSteps[4].rateText,
      hint: `${syncedUsers} → ${repeatSyncUsers}`,
    },
    {
      key: 'syncToPro',
      label: '同步到 Pro',
      value: funnelSteps[5].rateText,
      hint: `${syncedUsers} → ${activeProUsers}`,
    },
  ];
  const yesterdayFunnel = buildYesterdayFunnel({
    analyticsEvents: allAnalyticsEvents,
    entitlements: allEntitlements,
    bindCodes: allBindCodes,
    now: range.now,
  });

  return {
    generatedAt: range.now,
    scope: {
      sampleLimit,
      recordSampleSize: records.length,
      bindCodeSampleSize: bindCodes.length,
      entitlementSampleSize: entitlements.length,
      redeemCodeSampleSize: redeemCodes.length,
      analyticsEventSampleSize: analyticsEvents.length,
      isFullScan: Boolean(scope && scope.isFullScan),
      isTruncated: Boolean(scope && scope.isTruncated),
      maxRead: scope && scope.maxRead ? scope.maxRead : sampleLimit,
      label: scope && scope.label ? scope.label : `最近 ${sampleLimit} 条样本，非全量历史`,
      desc: scope && scope.desc ? scope.desc : '用于快速判断流程断点；完整访问转化需要后续接入首页曝光、教程点击等埋点。',
    },
    cards: [
      { key: 'todayRecords', label: '今日新增', value: records.filter((item) => isDateAfter(item.createdAt, range.last24h)).length, hint: '近 24 小时收集' },
      { key: 'visitUsers', label: '访问数', value: visitUsers, hint: '小程序去重访问' },
      { key: 'pendingRecords', label: '待同步', value: pendingRecords.length, hint: '还在云端暂存' },
      { key: 'stalePendingRecords', label: '超 24h 未同步', value: stalePendingRecords.length, hint: '优先排查' },
      { key: 'cleanupFailedRecords', label: '清理失败', value: cleanupFailedRecords.length, hint: '可能占用云存储' },
      { key: 'collectedUsers', label: '收集用户', value: collectedUsers, hint: '保存过素材的微信用户' },
      { key: 'activeProUsers', label: '有效 Pro', value: activeEntitlements.length, hint: '当前可用会员' },
      { key: 'boundDevices', label: '绑定设备', value: totalBoundClients, hint: `${boundUsers} 个微信，${boundCodes.length} 个绑定码` },
    ],
    health: {
      pendingRecords: pendingRecords.length,
      syncedRecords: syncedRecords.length,
      stalePendingRecords: stalePendingRecords.length,
      cleanupFailedRecords: cleanupFailedRecords.length,
      storageHoldingRecords: storageHoldingRecords.length,
      storageHoldingBytes: storageHoldingRecords.reduce((sum, item) => sum + getRecordFileSize(item), 0),
      typeBreakdown,
    },
    funnel: {
      collectedUsers,
      createdBindCodeUsers,
      boundUsers,
      bindPageUsers,
      bindSuccessUsers,
      visitUsers,
      boundCodes: boundCodes.length,
      boundDevices: totalBoundClients,
      syncedUsers,
      repeatSyncUsers,
      activeProUsers,
      steps: funnelSteps,
      breakpoints: funnelBreakpoints,
      conversionCards,
    },
    yesterdayFunnel,
    segments,
    trends: {
      daily: dailyTrend,
      latestDay: dailyTrend[dailyTrend.length - 1] || null,
    },
    diagnoses,
    pro: {
      activeEntitlements: activeEntitlements.length,
      expiringEntitlements: expiringEntitlements.length,
      sentUnactivatedCodes: sentUnactivatedCodes.length,
      unsentCodes: unsentCodes.length,
      activatedCodes: activatedCodes.length,
      totalCodes: redeemCodes.length,
    },
    issues: [
      ...stalePendingRecords.slice(0, 8).map((item) => ({
        type: 'pending',
        title: `${item.type || 'record'} 超 24 小时未同步`,
        desc: `${item.createdAt || '-'} · ${item.content || item._id || ''}`.slice(0, 120),
      })),
      ...cleanupFailedRecords.slice(0, 8).map((item) => ({
        type: 'cleanup',
        title: '云端附件清理失败',
        desc: `${item.metadata.cleanupError || item._id || ''}`.slice(0, 120),
      })),
      ...expiringEntitlements.slice(0, 8).map((item) => ({
        type: 'pro',
        title: 'Pro 即将到期',
        desc: `${item.openid || '-'} · ${item.expiresAt || '-'}`,
      })),
    ].slice(0, 12),
  };
}

module.exports = {
  ADMIN_CODE_CHARS,
  ADMIN_MAX_DURATION_DAYS,
  normalizeAdminCodePrefix,
  normalizeAdminPositiveInteger,
  generateAdminRedeemCode,
  createAdminRedeemCodeDocuments,
  getAdminTimeRange,
  summarizeAdminDashboard,
};
