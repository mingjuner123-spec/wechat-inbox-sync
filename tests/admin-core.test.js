const assert = require('assert');

const {
  normalizeAdminCodePrefix,
  normalizeAdminPositiveInteger,
  createAdminRedeemCodeDocuments,
  summarizeAdminDashboard,
} = require('../cloudfunctions/quickstartFunctions/admin-core');

assert.strictEqual(normalizeAdminCodePrefix(' ob pro '), 'OBPRO');
assert.strictEqual(normalizeAdminCodePrefix(''), 'OBPRO');
assert.strictEqual(normalizeAdminCodePrefix('ob-pro!'), 'OBPRO');
assert.strictEqual(normalizeAdminPositiveInteger('12', 1, 100, 10), 12);
assert.strictEqual(normalizeAdminPositiveInteger('0', 1, 100, 10), 10);
assert.strictEqual(normalizeAdminPositiveInteger('101', 1, 100, 10), 10);

const docs = createAdminRedeemCodeDocuments({
  count: 2,
  prefix: 'OBTST',
  durationDays: 3,
  maxRedemptions: 1,
  note: '测试码',
  now: '2026-06-05T10:00:00.000Z',
  randomInt: (() => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let index = 0;
    return (max) => values[index++] % max;
  })(),
});

assert.deepStrictEqual(docs.map((item) => item.code), ['OBTSTABCDE', 'OBTSTFGHJK']);
assert.strictEqual(docs[0].durationDays, 3);
assert.strictEqual(docs[0].plan, 'local_transcription_beta');
assert.strictEqual(docs[0].maxRedemptions, 1);
assert.strictEqual(docs[0].redeemedCount, 0);
assert.strictEqual(docs[0].deliveryStatus, 'unsent');
assert.strictEqual(docs[0].deliveredAt, '');
assert.strictEqual(docs[0].note, '测试码');

const longTermDocs = createAdminRedeemCodeDocuments({
  count: 1,
  prefix: 'OBPRO',
  durationDays: 9999,
  maxRedemptions: 1,
  now: '2026-06-10T10:00:00.000Z',
  randomInt: () => 0,
});

assert.strictEqual(longTermDocs[0].durationDays, 9999);

const singleUseDocs = createAdminRedeemCodeDocuments({
  count: 1,
  prefix: 'OBPRO',
  durationDays: 30,
  maxRedemptions: 99,
  now: '2026-06-10T10:00:00.000Z',
  randomInt: () => 1,
});

assert.strictEqual(singleUseDocs[0].maxRedemptions, 1);

const dashboard = summarizeAdminDashboard({
  now: '2026-06-08T10:00:00.000Z',
  records: [
    {
      _id: 'r1',
      openid: 'u1',
      type: 'file',
      content: 'old.pdf',
      status: 'pending',
      createdAt: '2026-06-06T09:00:00.000Z',
      metadata: { fileID: 'cloud://file-1', fileSize: 2048 },
    },
    {
      _id: 'r2',
      openid: 'u1',
      type: 'voice',
      content: 'voice',
      status: 'synced',
      createdAt: '2026-06-08T09:00:00.000Z',
      metadata: { cleanupStatus: 'storage-delete-failed', cleanupError: 'delete failed' },
    },
  ],
  redeemCodes: [
    { code: 'A', redeemedCount: 0, deliveryStatus: 'sent' },
    { code: 'B', redeemedCount: 0, deliveryStatus: 'unsent' },
    { code: 'C', redeemedCount: 1, deliveryStatus: 'activated' },
    {
      code: 'D',
      redeemedCount: 0,
      deliveryStatus: 'activated',
      paidOwnerOpenid: 'u4',
      paymentOrderNo: 'OBPAY20260702000000PAID',
    },
  ],
  entitlements: [
    { openid: 'u1', status: 'active', expiresAt: '2026-06-10T10:00:00.000Z' },
    { openid: 'u2', status: 'expired', expiresAt: '2026-06-01T10:00:00.000Z' },
    { openid: 'u3', status: 'active', expiresAt: '2026-06-15T10:00:00.000Z', redeemedAt: '2026-06-07T11:00:00.000Z', durationDays: 7 },
    { openid: 'u4', status: 'active', expiresAt: '2026-07-07T11:00:00.000Z', redeemedAt: '2026-06-07T12:00:00.000Z', durationDays: 30 },
  ],
  bindCodes: [
    { code: 'ABC-123', openid: 'u1', status: 'bound', clients: [{ clientId: 'pc1' }, { clientId: 'pc2' }], boundAt: '2026-06-06T08:00:00.000Z' },
    { code: 'DEF-456', openid: 'u3', status: 'active', clients: [] },
    { code: 'GHI-789', openid: 'u4', status: 'bound', clients: [{ clientId: 'pc3' }], boundAt: '2026-06-07T10:00:00.000Z' },
  ],
  analyticsEvents: [
    { openid: 'u1', eventName: 'app_visit', day: '2026-06-08' },
    { openid: 'u3', eventName: 'app_visit', day: '2026-06-08' },
    { openid: 'u1', eventName: 'bind_page_view', day: '2026-06-08' },
    { openid: 'u3', eventName: 'bind_page_view', day: '2026-06-08' },
    { openid: 'u1', eventName: 'bind_success', day: '2026-06-08' },
    { openid: 'u1', eventName: 'app_visit', day: '2026-06-07', lastAt: '2026-06-07T09:00:00.000Z' },
    { openid: 'u3', eventName: 'app_visit', day: '2026-06-07', lastAt: '2026-06-07T09:30:00.000Z' },
    { openid: 'u4', eventName: 'app_visit', day: '2026-06-07', lastAt: '2026-06-07T10:30:00.000Z' },
    { openid: 'u4', eventName: 'bind_success', day: '2026-06-07', lastAt: '2026-06-07T10:40:00.000Z' },
  ],
  sampleLimit: 5000,
  scope: {
    isFullScan: true,
    label: '已按当前数据库总数统计',
    desc: '测试口径',
    maxRead: 5000,
  },
});

assert.strictEqual(dashboard.health.pendingRecords, 1);
assert.strictEqual(dashboard.health.stalePendingRecords, 1);
assert.strictEqual(dashboard.health.cleanupFailedRecords, 1);
assert.strictEqual(dashboard.health.storageHoldingRecords, 1);
assert.strictEqual(dashboard.health.storageHoldingBytes, 2048);
assert.strictEqual(dashboard.pro.activeEntitlements, 3);
assert.strictEqual(dashboard.pro.expiringEntitlements, 2);
assert.strictEqual(dashboard.pro.sentUnactivatedCodes, 1);
assert.strictEqual(dashboard.pro.unsentCodes, 1);
assert.strictEqual(dashboard.pro.activatedCodes, 2);
assert.strictEqual(dashboard.scope.isFullScan, true);
assert.strictEqual(dashboard.scope.label, '已按当前数据库总数统计');
assert.strictEqual(dashboard.funnel.visitUsers, 3);
assert.strictEqual(dashboard.funnel.bindPageUsers, 2);
assert.strictEqual(dashboard.funnel.createdBindCodeUsers, 3);
assert.strictEqual(dashboard.funnel.boundUsers, 2);
assert.strictEqual(dashboard.funnel.bindSuccessUsers, 2);
assert.strictEqual(dashboard.funnel.boundDevices, 3);
assert.strictEqual(dashboard.funnel.syncedUsers, 1);
assert.strictEqual(dashboard.funnel.steps[0].key, 'visitUsers');
assert.strictEqual(dashboard.funnel.steps[0].label, '访问数');
assert.strictEqual(dashboard.funnel.steps[1].key, 'bindPageUsers');
assert.strictEqual(dashboard.funnel.steps[1].label, '到达绑定页面数');
assert.strictEqual(dashboard.funnel.steps[2].key, 'bindSuccessUsers');
assert.strictEqual(dashboard.funnel.steps[2].label, '绑定成功数');
assert.strictEqual(dashboard.funnel.steps[2].rateText, '100%');
assert.strictEqual(dashboard.yesterdayFunnel.day, '2026-06-07');
assert.strictEqual(dashboard.yesterdayFunnel.visitUserTotal, 3);
assert.strictEqual(dashboard.yesterdayFunnel.newUserCount, 2);
assert.strictEqual(dashboard.yesterdayFunnel.returningUserCount, 1);
assert.strictEqual(dashboard.yesterdayFunnel.newBoundUserCount, 1);
assert.strictEqual(dashboard.yesterdayFunnel.proOpenedUsers, 2);
assert.strictEqual(dashboard.yesterdayFunnel.paidOpenedUsers, 1);
assert.strictEqual(dashboard.yesterdayFunnel.totalProOpenedUsers, 4);
assert.strictEqual(dashboard.yesterdayFunnel.totalBoundCount, 3);
assert.strictEqual(dashboard.yesterdayFunnel.totalVisitEvents, 5);
assert.strictEqual(dashboard.yesterdayFunnel.cards[0].label, '访问用户总数');
assert.strictEqual(dashboard.funnel.breakpoints.length, 5);
assert.strictEqual(dashboard.funnel.conversionCards.length, 5);
assert.strictEqual(dashboard.segments.some((item) => item.key === 'activeUsers'), true);
assert.strictEqual(dashboard.trends.daily.length, 14);
assert.strictEqual(dashboard.health.typeBreakdown[0].value, 1);
assert.strictEqual(dashboard.diagnoses.length >= 1, true);
assert.strictEqual(dashboard.cards.some((item) => item.key === 'stalePendingRecords'), true);
assert.strictEqual(dashboard.cards.some((item) => item.key === 'collectedUsers'), true);
assert.strictEqual(dashboard.issues.length >= 3, true);
