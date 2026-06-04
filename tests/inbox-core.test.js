const assert = require('assert');

const {
  createInboxRecordDocument,
  createBindCodeDocument,
  createBindStatusResponse,
  bindClientToCodeDocument,
  unbindClientFromCodeDocument,
  generateBindCode,
  getBindCodeLookupCandidates,
  normalizeBindCodeInput,
  buildDailyUsageDocument,
  buildUsageState,
  generateUniqueBindCode,
  normalizeContentType,
  getUsageDay,
  DAILY_FREE_LIMIT,
  DAILY_SHARE_LIMIT,
  DAILY_AD_BONUS,
  DEFAULT_BIND_DEVICE_LIMIT,
  MAX_BIND_DEVICE_LIMIT,
} = require('../cloudfunctions/quickstartFunctions/inbox-core');

assert.strictEqual(DAILY_FREE_LIMIT, 5);
assert.strictEqual(DAILY_SHARE_LIMIT, 10);
assert.strictEqual(DAILY_AD_BONUS, 10);
assert.strictEqual(DEFAULT_BIND_DEVICE_LIMIT, 1);
assert.strictEqual(MAX_BIND_DEVICE_LIMIT, 3);
assert.strictEqual(getUsageDay('2026-05-08T16:30:00.000Z'), '2026-05-09');
assert.strictEqual(normalizeContentType('TEXT'), 'text');
assert.strictEqual(normalizeContentType('link'), 'link');
assert.strictEqual(normalizeContentType('webpage'), 'webpage');
assert.strictEqual(normalizeContentType('voice'), 'voice');
assert.strictEqual(normalizeContentType('file'), 'file');
assert.throws(() => normalizeContentType('unknown'), /Unsupported content type/);
assert.strictEqual(normalizeBindCodeInput(' ozt n1i '), 'OZT-N1I');
assert.deepStrictEqual(getBindCodeLookupCandidates('0ZT-N11').slice(0, 4), [
  '0ZT-N11',
  '0ZT-N1I',
  '0ZT-NI1',
  '0ZT-NII',
]);
assert.match(generateBindCode(), /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);

const textRecord = createInboxRecordDocument({
  event: {
    contentType: 'text',
    content: '先收集，后整理',
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.deepStrictEqual(textRecord, {
  openid: 'openid-1',
  type: 'text',
  content: '先收集，后整理',
  status: 'pending',
  source: 'wechat-miniprogram',
  createdAt: '2026-05-08T12:00:00.000Z',
  syncedAt: null,
  metadata: {},
});

const linkRecord = createInboxRecordDocument({
  event: {
    contentType: 'link',
    content: 'https://example.com/a',
    url: 'https://example.com/a',
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(linkRecord.metadata.url, 'https://example.com/a');
assert.strictEqual(linkRecord.metadata.fetchStatus, 'pending');

const webpageRecord = createInboxRecordDocument({
  event: {
    contentType: 'webpage',
    content: 'https://mp.weixin.qq.com/s/example',
    url: 'https://mp.weixin.qq.com/s/example',
    shareText: '分享文案 https://mp.weixin.qq.com/s/example',
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(webpageRecord.type, 'webpage');
assert.strictEqual(webpageRecord.metadata.url, 'https://mp.weixin.qq.com/s/example');
assert.strictEqual(webpageRecord.metadata.shareText, '分享文案 https://mp.weixin.qq.com/s/example');
assert.strictEqual(webpageRecord.metadata.conversionStatus, 'pending');

const fileRecord = createInboxRecordDocument({
  event: {
    contentType: 'file',
    content: 'example.pdf',
    fileID: 'cloud://files/example.pdf',
    fileName: 'example.pdf',
    fileExt: 'pdf',
    fileSize: 1234,
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(fileRecord.type, 'file');
assert.deepStrictEqual(fileRecord.metadata, {
  fileID: 'cloud://files/example.pdf',
  fileName: 'example.pdf',
  fileExt: 'pdf',
  fileSize: 1234,
  conversionStatus: 'pending',
});

const voiceRecord = createInboxRecordDocument({
  event: {
    contentType: 'voice',
    content: '现场语音备忘录 - 00:15',
    audioFileID: 'cloud://voice/001.mp3',
    audioFileName: 'meeting.m4a',
    duration: 15200,
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.deepStrictEqual(voiceRecord.metadata, {
  audioFileID: 'cloud://voice/001.mp3',
  audioFileName: 'meeting.m4a',
  duration: 15200,
  transcriptionStatus: 'pending',
  summaryStatus: 'pending',
});

const bindCode = createBindCodeDocument({
  openid: 'openid-1',
  code: 'A1B-2C3',
  now: '2026-05-08T12:00:00.000Z',
});

assert.deepStrictEqual(bindCode, {
  openid: 'openid-1',
  code: 'A1B-2C3',
  status: 'pending',
  createdAt: '2026-05-08T12:00:00.000Z',
  expiresAt: '',
  boundAt: null,
  clientId: '',
  clients: [],
  deviceLimit: 1,
  revokedAt: null,
});

assert.deepStrictEqual(createBindStatusResponse(bindCode, '2026-05-08T12:05:00.000Z'), {
  code: 'A1B-2C3',
  status: 'pending',
  isBound: false,
  createdAt: '2026-05-08T12:00:00.000Z',
  expiresAt: '',
  boundAt: null,
  deviceLimit: 1,
  maxDeviceLimit: 3,
  clientCount: 0,
  canAddDevice: true,
  clients: [],
});

const firstBindResult = bindClientToCodeDocument(bindCode, 'client-home', '2026-05-08T12:03:00.000Z');
assert.strictEqual(firstBindResult.status, 'bound');
assert.deepStrictEqual(firstBindResult.data.clients, [{
  clientId: 'client-home',
  name: '',
  boundAt: '2026-05-08T12:03:00.000Z',
  lastSyncAt: '',
}]);

const fullBindResult = bindClientToCodeDocument({
  ...bindCode,
  status: 'bound',
  boundAt: '2026-05-08T12:03:00.000Z',
  clients: [{
    clientId: 'client-home',
    name: '',
    boundAt: '2026-05-08T12:03:00.000Z',
    lastSyncAt: '',
  }],
  deviceLimit: 1,
}, 'client-office', '2026-05-08T12:04:00.000Z');
assert.strictEqual(fullBindResult.status, 'already-bound');

const secondBindResult = bindClientToCodeDocument({
  ...bindCode,
  status: 'bound',
  boundAt: '2026-05-08T12:03:00.000Z',
  clients: [{
    clientId: 'client-home',
    name: '',
    boundAt: '2026-05-08T12:03:00.000Z',
    lastSyncAt: '',
  }],
  deviceLimit: 2,
}, 'client-office', '2026-05-08T12:04:00.000Z');
assert.strictEqual(secondBindResult.status, 'bound');
assert.strictEqual(secondBindResult.data.clients.length, 2);

const unbindOneResult = unbindClientFromCodeDocument({
  ...bindCode,
  status: 'bound',
  boundAt: '2026-05-08T12:03:00.000Z',
  clientId: 'client-home',
  clients: secondBindResult.data.clients,
  deviceLimit: 2,
}, 'client-home', '2026-05-08T12:06:00.000Z');
assert.strictEqual(unbindOneResult.status, 'updated');
assert.deepStrictEqual(unbindOneResult.data.clients, [{
  clientId: 'client-office',
  name: '',
  boundAt: '2026-05-08T12:04:00.000Z',
  lastSyncAt: '',
}]);
assert.strictEqual(unbindOneResult.data.status, 'bound');
assert.strictEqual(unbindOneResult.data.clientId, 'client-office');

const unbindLastResult = unbindClientFromCodeDocument({
  ...bindCode,
  status: 'bound',
  boundAt: '2026-05-08T12:03:00.000Z',
  clientId: 'client-home',
  clients: [{
    clientId: 'client-home',
    name: '',
    boundAt: '2026-05-08T12:03:00.000Z',
    lastSyncAt: '',
  }],
  deviceLimit: 1,
}, 'client-home', '2026-05-08T12:06:00.000Z');
assert.strictEqual(unbindLastResult.status, 'updated');
assert.deepStrictEqual(unbindLastResult.data.clients, []);
assert.strictEqual(unbindLastResult.data.status, 'pending');
assert.strictEqual(unbindLastResult.data.clientId, '');
assert.strictEqual(unbindLastResult.data.boundAt, null);

assert.strictEqual(unbindClientFromCodeDocument(bindCode, 'missing-client', '2026-05-08T12:06:00.000Z').status, 'not-found');

assert.deepStrictEqual(createBindStatusResponse({
  ...bindCode,
  status: 'bound',
  boundAt: '2026-05-08T12:03:00.000Z',
  clients: secondBindResult.data.clients,
  deviceLimit: 2,
}, '2026-05-08T12:05:00.000Z'), {
  code: 'A1B-2C3',
  status: 'bound',
  isBound: true,
  createdAt: '2026-05-08T12:00:00.000Z',
  expiresAt: '',
  boundAt: '2026-05-08T12:03:00.000Z',
  deviceLimit: 2,
  maxDeviceLimit: 3,
  clientCount: 2,
  canAddDevice: true,
  clients: [
    {
      clientId: 'client-home',
      name: '',
      boundAt: '2026-05-08T12:03:00.000Z',
      lastSyncAt: '',
    },
    {
      clientId: 'client-office',
      name: '',
      boundAt: '2026-05-08T12:04:00.000Z',
      lastSyncAt: '',
    },
  ],
});

assert.deepStrictEqual(createBindStatusResponse(bindCode, '2026-05-08T12:11:00.000Z'), {
  code: 'A1B-2C3',
  status: 'pending',
  isBound: false,
  createdAt: '2026-05-08T12:00:00.000Z',
  expiresAt: '',
  boundAt: null,
  deviceLimit: 1,
  maxDeviceLimit: 3,
  clientCount: 0,
  canAddDevice: true,
  clients: [],
});

const usage = buildDailyUsageDocument({
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});
assert.strictEqual(usage.day, '2026-05-08');
assert.strictEqual(usage.limit, 5);
assert.deepStrictEqual(buildUsageState({
  used: 5,
  limit: 10,
  shareUnlocked: true,
  adUnlockCount: 1,
}), {
  used: 5,
  limit: 10,
  remaining: 5,
  shareUnlocked: true,
  adUnlockCount: 1,
});

(async () => {
  const generated = ['A1B-2C3', 'B2C-3D4', 'C3D-4E5'];
  const selected = await generateUniqueBindCode({
    generateCode: () => generated.shift(),
    codeExists: async (code) => code !== 'C3D-4E5',
  });

  assert.strictEqual(selected, 'C3D-4E5');

  await assert.rejects(
    () => generateUniqueBindCode({
      maxAttempts: 2,
      generateCode: () => 'A1B-2C3',
      codeExists: async () => true,
    }),
    /Unable to generate unique bind code/,
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
