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
  buildProUsageState,
  requiresProTranscriptionAccess,
  generateUniqueBindCode,
  normalizeContentType,
  buildInboxRecordDedupeKey,
  isAudioVideoWebpageUrl,
  getUsageDay,
  DAILY_FREE_LIMIT,
  DAILY_SHARE_LIMIT,
  DAILY_AD_BONUS,
  CLOUD_PRE_TRANSCRIPTION_TEMP_DISABLED,
  DEFAULT_BIND_DEVICE_LIMIT,
  MAX_BIND_DEVICE_LIMIT,
} = require('../cloudfunctions/quickstartFunctions/inbox-core');

assert.strictEqual(DAILY_FREE_LIMIT, 5);
assert.strictEqual(DAILY_SHARE_LIMIT, 10);
assert.strictEqual(DAILY_AD_BONUS, 10);
assert.strictEqual(CLOUD_PRE_TRANSCRIPTION_TEMP_DISABLED, true);
assert.strictEqual(DEFAULT_BIND_DEVICE_LIMIT, 1);
assert.strictEqual(MAX_BIND_DEVICE_LIMIT, 3);
assert.strictEqual(requiresProTranscriptionAccess({ type: 'voice', metadata: {} }), true);
assert.strictEqual(requiresProTranscriptionAccess({ type: 'webpage', metadata: { webpageMediaType: 'audio_video' } }), true);
assert.strictEqual(requiresProTranscriptionAccess({ type: 'webpage', metadata: { webpageMediaType: 'article' } }), false);
assert.strictEqual(requiresProTranscriptionAccess({ type: 'file', metadata: {} }), false);
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
  dedupeKey: 'text:先收集，后整理',
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

const linkWechatRecord = createInboxRecordDocument({
  event: {
    contentType: 'link',
    content: 'https://mp.weixin.qq.com/s/example',
    url: 'https://mp.weixin.qq.com/s/example',
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(linkWechatRecord.type, 'webpage');
assert.strictEqual(linkWechatRecord.metadata.url, 'https://mp.weixin.qq.com/s/example');
assert.strictEqual(linkWechatRecord.metadata.conversionStatus, 'pending');

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

const douyinShareTextRecord = createInboxRecordDocument({
  event: {
    contentType: 'text',
    content: '3.35 复制打开抖音，看看作品 https://v.douyin.com/3x-bYuN1C9k/ 10/16',
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(douyinShareTextRecord.type, 'webpage');
assert.strictEqual(douyinShareTextRecord.content, 'https://v.douyin.com/3x-bYuN1C9k/');
assert.strictEqual(douyinShareTextRecord.metadata.url, 'https://v.douyin.com/3x-bYuN1C9k/');
assert.strictEqual(douyinShareTextRecord.metadata.webpageMediaType, 'audio_video');
assert.strictEqual(douyinShareTextRecord.metadata.transcriptionMode, 'local');
assert.strictEqual(douyinShareTextRecord.metadata.transcriptionStatus, 'pending');
assert.strictEqual(douyinShareTextRecord.metadata.cloudTranscriptionRequested, false);
assert.match(douyinShareTextRecord.metadata.shareText, /复制打开抖音/);
assert.strictEqual(douyinShareTextRecord.dedupeKey, 'webpage:https://v.douyin.com/3x-bYuN1C9k');

const repeatedXhsRecord = createInboxRecordDocument({
  event: {
    contentType: 'text',
    content: '3.35 复制此链接，打开小红书 https://xhslink.com/o/3LgfhGjkO9w 直接观看',
  },
  openid: 'openid-1',
  now: '2026-06-18T12:00:00.000Z',
});

assert.strictEqual(repeatedXhsRecord.type, 'webpage');
assert.strictEqual(repeatedXhsRecord.content, 'https://xhslink.com/o/3LgfhGjkO9w');
assert.strictEqual(repeatedXhsRecord.dedupeKey, 'webpage:https://xhslink.com/o/3LgfhGjkO9w');
assert.strictEqual(repeatedXhsRecord.metadata.webpageMediaType, undefined);
assert.strictEqual(repeatedXhsRecord.metadata.transcriptionStatus, undefined);
assert.strictEqual(isAudioVideoWebpageUrl(
  'http://xhslink.com/o/2rths0HGbgt',
  'AI时代，我为什么推荐每个人使用Obsidian？ 跳转【小红书】看看笔记详情~',
), false);
assert.strictEqual(isAudioVideoWebpageUrl(
  'http://xhslink.com/video/demo',
  '小红书 vlog 视频，打开看看',
), true);
assert.strictEqual(isAudioVideoWebpageUrl(
  'http://xhslink.com/o/3LgfhGjkO9w',
  '\u8ba9\u6211\u770b\u770b \u8fd8\u6709\u8c01\u4e0d\u4f1a\u7528\u64ad\u5ba2\u8f6c\u6587\u5b57\u7684 \u53bb\u3010\u5c0f\u7ea2\u4e66\u3011\u770b\u770b\u8fd9\u7bc7\u5b9d\u85cf\u7b14\u8bb0\u5427\uff01',
), false);
assert.strictEqual(buildInboxRecordDedupeKey({
  type: 'webpage',
  content: 'http://xhslink.com/o/3LgfhGjkO9w',
  metadata: { url: 'http://xhslink.com/o/3LgfhGjkO9w' },
}), repeatedXhsRecord.dedupeKey);
assert.strictEqual(buildInboxRecordDedupeKey({
  type: 'webpage',
  content: 'http://xhslink.com/o/3LgfhGjkO9w/',
  metadata: { url: 'https://xhslink.com/o/3LgfhGjkO9w/?utm_source=copy' },
}), 'webpage:https://xhslink.com/o/3LgfhGjkO9w');
assert.strictEqual(buildInboxRecordDedupeKey({
  type: 'file',
  content: 'same.pdf',
  metadata: { fileID: ' cloud://files/same.pdf ' },
}), 'file:cloud://files/same.pdf');
assert.strictEqual(buildInboxRecordDedupeKey({
  type: 'voice',
  content: 'same.mp3',
  metadata: { audioFileID: ' cloud://voices/same.mp3 ' },
}), 'voice:cloud://voices/same.mp3');

const cloudDouyinShareTextRecord = createInboxRecordDocument({
  event: {
    contentType: 'text',
    content: '复制打开抖音 https://v.douyin.com/3x-bYuN1C9k/',
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
  cloudPreTranscription: {
    enabled: true,
    mode: 'cloud',
    reason: 'server-default',
    speakerDiarization: true,
  },
});

assert.strictEqual(cloudDouyinShareTextRecord.type, 'webpage');
assert.strictEqual(cloudDouyinShareTextRecord.metadata.transcriptionMode, 'local');
assert.strictEqual(cloudDouyinShareTextRecord.metadata.transcriptionStatus, 'pending');
assert.strictEqual(cloudDouyinShareTextRecord.metadata.cloudTranscriptionRequested, false);
assert.strictEqual(cloudDouyinShareTextRecord.metadata.cloudTranscriptionReason, 'cloud-disabled');

const cloudWebMediaRecord = createInboxRecordDocument({
  event: {
    contentType: 'webpage',
    content: 'https://www.douyin.com/video/123',
    url: 'https://www.douyin.com/video/123',
    webpageMediaType: 'audio_video',
    cloudPreTranscription: {
      enabled: true,
      mode: 'cloud',
      reason: 'remembered',
    },
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(cloudWebMediaRecord.metadata.webpageMediaType, 'audio_video');
assert.strictEqual(cloudWebMediaRecord.metadata.transcriptionMode, 'local');
assert.strictEqual(cloudWebMediaRecord.metadata.cloudTranscriptionRequested, false);
assert.strictEqual(cloudWebMediaRecord.metadata.transcriptionStatus, 'pending');
assert.strictEqual(cloudWebMediaRecord.metadata.cloudTranscriptionReason, 'cloud-disabled');

const cloudTestWebMediaRecord = createInboxRecordDocument({
  event: {
    contentType: 'webpage',
    content: 'https://www.douyin.com/video/456',
    url: 'https://www.douyin.com/video/456',
    webpageMediaType: 'audio_video',
    cloudPreTranscription: {
      enabled: true,
      mode: 'cloud',
      reason: 'cloud-test',
      speakerDiarization: true,
    },
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(cloudTestWebMediaRecord.metadata.webpageMediaType, 'audio_video');
assert.strictEqual(cloudTestWebMediaRecord.metadata.transcriptionMode, 'cloud');
assert.strictEqual(cloudTestWebMediaRecord.metadata.cloudTranscriptionRequested, true);
assert.strictEqual(cloudTestWebMediaRecord.metadata.transcriptionStatus, 'queued');
assert.strictEqual(cloudTestWebMediaRecord.metadata.cloudTranscriptionReason, 'cloud-test');
assert.strictEqual(cloudTestWebMediaRecord.metadata.transcriptionSource, 'cloud-pretranscription');
assert.strictEqual(cloudTestWebMediaRecord.metadata.speakerDiarizationRequested, true);

const localWebMediaRecord = createInboxRecordDocument({
  event: {
    contentType: 'webpage',
    content: 'https://www.bilibili.com/video/BV123',
    url: 'https://www.bilibili.com/video/BV123',
    webpageMediaType: 'audio_video',
    cloudPreTranscription: {
      enabled: false,
      mode: 'local',
      reason: 'remembered',
    },
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(localWebMediaRecord.metadata.webpageMediaType, 'audio_video');
assert.strictEqual(localWebMediaRecord.metadata.transcriptionMode, 'local');
assert.strictEqual(localWebMediaRecord.metadata.cloudTranscriptionRequested, false);

const legacyWebMediaRecord = createInboxRecordDocument({
  event: {
    contentType: 'webpage',
    content: 'https://xhslink.com/example',
    url: 'https://xhslink.com/example',
    webpageMediaType: 'audio_video',
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(legacyWebMediaRecord.metadata.webpageMediaType, undefined);
assert.strictEqual(legacyWebMediaRecord.metadata.transcriptionMode, undefined);
assert.strictEqual(legacyWebMediaRecord.metadata.cloudTranscriptionRequested, undefined);
assert.strictEqual(legacyWebMediaRecord.metadata.cloudTranscriptionReason, undefined);

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
  transcriptionMode: 'local',
  cloudTranscriptionRequested: false,
  cloudTranscriptionReason: 'missing-client-choice',
});

const cloudQueuedVoiceRecord = createInboxRecordDocument({
  event: {
    contentType: 'voice',
    content: '访谈录音 - 31:00',
    audioFileID: 'cloud://voice/long.mp3',
    audioFileName: 'interview.mp3',
    duration: 31 * 60 * 1000,
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
  cloudPreTranscription: {
    enabled: true,
    thresholdMinutes: 30,
  },
});

assert.strictEqual(cloudQueuedVoiceRecord.metadata.transcriptionStatus, 'pending');
assert.strictEqual(cloudQueuedVoiceRecord.metadata.transcriptionMode, 'local');
assert.strictEqual(cloudQueuedVoiceRecord.metadata.cloudTranscriptionRequested, false);
assert.strictEqual(cloudQueuedVoiceRecord.metadata.cloudTranscriptionReason, 'cloud-disabled');

const shortVoiceRecord = createInboxRecordDocument({
  event: {
    contentType: 'voice',
    content: '短语音 - 05:00',
    audioFileID: 'cloud://voice/short.mp3',
    duration: 5 * 60 * 1000,
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
  cloudPreTranscription: {
    enabled: true,
    thresholdMinutes: 10,
  },
});

assert.strictEqual(shortVoiceRecord.metadata.transcriptionStatus, 'pending');

const manuallyQueuedVoiceRecord = createInboxRecordDocument({
  event: {
    contentType: 'voice',
    content: 'manual cloud - 05:00',
    audioFileID: 'cloud://voice/manual.mp3',
    duration: 5 * 60 * 1000,
    cloudPreTranscription: {
      enabled: true,
      mode: 'cloud',
      reason: 'manual',
      speakerDiarization: true,
    },
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
  cloudPreTranscription: {
    enabled: false,
    thresholdMinutes: 30,
  },
});

assert.strictEqual(manuallyQueuedVoiceRecord.metadata.transcriptionStatus, 'pending');
assert.strictEqual(manuallyQueuedVoiceRecord.metadata.transcriptionMode, 'local');
assert.strictEqual(manuallyQueuedVoiceRecord.metadata.cloudTranscriptionRequested, false);
assert.strictEqual(manuallyQueuedVoiceRecord.metadata.cloudTranscriptionReason, 'cloud-disabled');

const cloudTestVoiceRecord = createInboxRecordDocument({
  event: {
    contentType: 'voice',
    content: 'cloud test - 02:00',
    audioFileID: 'cloud://voice/cloud-test.mp3',
    duration: 2 * 60 * 1000,
    cloudPreTranscription: {
      enabled: true,
      mode: 'cloud',
      reason: 'cloud-test',
      speakerDiarization: true,
    },
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
});

assert.strictEqual(cloudTestVoiceRecord.metadata.transcriptionStatus, 'queued');
assert.strictEqual(cloudTestVoiceRecord.metadata.transcriptionMode, 'cloud');
assert.strictEqual(cloudTestVoiceRecord.metadata.cloudTranscriptionRequested, true);
assert.strictEqual(cloudTestVoiceRecord.metadata.cloudTranscriptionReason, 'cloud-test');
assert.strictEqual(cloudTestVoiceRecord.metadata.transcriptionSource, 'cloud-pretranscription');
assert.strictEqual(cloudTestVoiceRecord.metadata.speakerDiarizationRequested, true);

const localOverrideVoiceRecord = createInboxRecordDocument({
  event: {
    contentType: 'voice',
    content: 'local override - 31:00',
    audioFileID: 'cloud://voice/local.mp3',
    duration: 31 * 60 * 1000,
    cloudPreTranscription: {
      enabled: false,
      mode: 'local',
      reason: 'manual',
    },
  },
  openid: 'openid-1',
  now: '2026-05-08T12:00:00.000Z',
  cloudPreTranscription: {
    enabled: true,
    thresholdMinutes: 10,
  },
});

assert.strictEqual(localOverrideVoiceRecord.metadata.transcriptionStatus, 'pending');
assert.strictEqual(localOverrideVoiceRecord.metadata.transcriptionMode, 'local');
assert.strictEqual(localOverrideVoiceRecord.metadata.cloudTranscriptionRequested, false);

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

assert.deepStrictEqual(buildProUsageState(), {
  used: 0,
  limit: null,
  remaining: null,
  shareUnlocked: true,
  adUnlockCount: 0,
  proUnlimited: true,
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
