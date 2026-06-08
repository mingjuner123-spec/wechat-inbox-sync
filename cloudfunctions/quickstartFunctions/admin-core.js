const {
  DEFAULT_REDEEM_PLAN,
  createRedeemCodeDocument,
} = require('./redeem-code-core');

const ADMIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
  const normalizedDurationDays = normalizeAdminPositiveInteger(durationDays, 1, 3650, 30);
  const normalizedMaxRedemptions = normalizeAdminPositiveInteger(maxRedemptions, 1, 1000, 1);
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
      maxRedemptions: normalizedMaxRedemptions,
      note,
      now,
    }));
  }

  return documents;
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

function getSyncedRecordTime(item) {
  return item && (item.syncedAt || (item.status === 'synced' ? item.updatedAt || item.createdAt : ''));
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
  const sentUnactivatedCodes = redeemCodes.filter((item) => (Number(item.redeemedCount) || 0) <= 0 && item.deliveryStatus === 'sent');
  const unsentCodes = redeemCodes.filter((item) => (Number(item.redeemedCount) || 0) <= 0 && item.deliveryStatus !== 'sent');
  const activatedCodes = redeemCodes.filter((item) => (Number(item.redeemedCount) || 0) > 0);
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
  const repeatSyncUsers = Object.keys(syncCountsByUser).filter((openid) => syncCountsByUser[openid] >= 2).length;
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
  normalizeAdminCodePrefix,
  normalizeAdminPositiveInteger,
  generateAdminRedeemCode,
  createAdminRedeemCodeDocuments,
  getAdminTimeRange,
  summarizeAdminDashboard,
};
