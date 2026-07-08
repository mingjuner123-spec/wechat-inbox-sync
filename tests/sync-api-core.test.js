const assert = require('assert');
const crypto = require('crypto');

const {
  buildSyncedRecordCleanupData,
  collectRecordFileIds,
  filterSyncableRecords,
  handleSyncApiRequest,
  normalizeSyncableRecord,
  shouldKeepRecordPendingForTranscription,
} = require('../cloudfunctions/syncApi/sync-api-core');

(async () => {
  const calls = [];
  const repository = {
    async bindClientByToken(token, clientId) {
      calls.push(['bindClientByToken', token, clientId]);
      if (token === 'token-123' && clientId === 'client-1') {
        return {
          status: 'bound',
          openid: 'openid-1',
          boundAt: '2026-05-20T10:00:00.000Z',
        };
      }
      if (token === 'token-bound') {
        return {
          status: 'already-bound',
        };
      }
      if (token === 'limit-code') {
        return {
          status: 'plugin-binding-limit-exceeded',
          currentCount: 1,
          limit: 1,
          hasProBinding: false,
          errMsg: 'Free plan allows 1 binding; Pro allows 3 bindings',
        };
      }
      return {
        status: 'invalid',
      };
    },
    async findOpenIdByToken(token, clientId) {
      calls.push(['findOpenIdByToken', token, clientId]);
      return token === 'token-123' && clientId === 'client-1' ? 'openid-1' : null;
    },
    async unbindClientByToken(token, clientId) {
      calls.push(['unbindClientByToken', token, clientId]);
      return token === 'token-123' && clientId === 'client-1'
        ? { status: 'updated' }
        : { status: 'invalid' };
    },
    async listPendingRecords(openid) {
      calls.push(['listPendingRecords', openid]);
      return [
        {
          _id: 'record-text-1',
          type: 'text',
          content: 'API record',
          createdAt: '2026-05-08T12:34:00.000Z',
          source: 'wechat-miniprogram',
          status: 'pending',
          metadata: {},
        },
        {
          _id: 'record-reactivated-synced-at',
          type: 'text',
          content: '',
          createdAt: '2026-05-08T12:35:00.000Z',
          source: 'wechat-miniprogram',
          status: 'pending',
          syncedAt: '2026-05-08T13:00:00.000Z',
          metadata: {},
        },
        {
          _id: 'record-reactivated-cleaned',
          type: 'voice',
          content: '',
          createdAt: '2026-05-08T12:36:00.000Z',
          source: 'wechat-miniprogram',
          status: 'pending',
          syncedAt: '',
          metadata: {
            cleanupStatus: 'cleaned',
            cleanedAt: '2026-05-08T13:01:00.000Z',
          },
        },
        {
          _id: 'record-xhs-duplicate-pending',
          type: 'webpage',
          content: 'https://xhslink.com/o/3LgfhGjkO9w',
          dedupeKey: 'webpage:https://xhslink.com/o/3LgfhGjkO9w',
          createdAt: '2026-06-18T12:00:00.000Z',
          source: 'wechat-miniprogram',
          status: 'pending',
          metadata: {
            url: 'https://xhslink.com/o/3LgfhGjkO9w',
          },
        },
        {
          _id: 'record-xhs-already-synced',
          type: 'webpage',
          content: '',
          dedupeKey: 'webpage:https://xhslink.com/o/3LgfhGjkO9w',
          createdAt: '2026-06-18T11:00:00.000Z',
          source: 'wechat-miniprogram',
          status: 'synced',
          syncedAt: '2026-06-18T11:10:00.000Z',
          metadata: {
            url: '',
            cleanupStatus: 'cleaned',
          },
        },
      ];
    },
    async markRecordSynced(openid, recordId) {
      calls.push(['markRecordSynced', openid, recordId]);
      return { id: recordId, status: 'synced' };
    },
    async isFileOwnedByOpenId(openid, fileID) {
      calls.push(['isFileOwnedByOpenId', openid, fileID]);
      return !String(fileID).includes('foreign');
    },
    async getTempFileURL(openid, fileID) {
      calls.push(['getTempFileURL', openid, fileID]);
      return {
        fileID,
        tempFileURL: 'https://temp.example.com/voice.mp3',
      };
    },
    async getEntitlement(openid, plan, context = {}) {
      calls.push(['getEntitlement', openid, plan, context.clientId || '']);
      return openid === 'openid-1' && plan === 'local_transcription_beta'
        ? {
          plan,
          status: 'active',
          expiresAt: '2036-07-03T08:00:00.000Z',
        }
        : null;
    },
    async redeemAccessCode(openid, code, context = {}) {
      calls.push(['redeemAccessCode', openid, code, context.clientId || '']);
      if (code === 'BADCODE') {
        const error = new Error('Invalid redeem code');
        error.code = 'INVALID_REDEEM_CODE';
        throw error;
      }
      return code === 'ZZAI030'
        ? {
          hasAccess: true,
          plan: 'local_transcription_beta',
          status: 'active',
          expiresAt: '2036-07-03T08:00:00.000Z',
        }
        : {
          hasAccess: false,
          plan: 'local_transcription_beta',
          status: 'inactive',
          expiresAt: '',
        };
    },
  };

  const clientHeaders = {
    authorization: 'Bearer token-123',
    'x-wechat-inbox-client-id': 'client-1',
  };

  const notifySignature = crypto.createHash('sha1')
    .update(['notify-token', '1778044072', 'nonce-1'].sort().join(''))
    .digest('hex');
  const notifyVerifyResponse = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/sync/virtual-payment/notify',
      query: {
        signature: notifySignature,
        timestamp: '1778044072',
        nonce: 'nonce-1',
        echostr: 'wechat-ok',
      },
      headers: {},
    },
    repository: {
      virtualPaymentNotifyToken: 'notify-token',
    },
  });
  assert.strictEqual(notifyVerifyResponse.statusCode, 200);
  assert.strictEqual(notifyVerifyResponse.body, 'wechat-ok');

  const notifyCalls = [];
  const notifyPostResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/virtual-payment/notify',
      query: {
        signature: notifySignature,
        timestamp: '1778044072',
        nonce: 'nonce-1',
      },
      headers: {},
      body: JSON.stringify({
        Event: 'xpay_goods_deliver_notify',
        OpenId: 'openid-1',
        OutTradeNo: 'OBPAY20260615100000ABC123',
        GoodsInfo: {
          ProductId: 'pro_year',
        },
        WeChatPayInfo: {
          TransactionId: 'TRANSACTION001',
          PaidTime: 1778044072,
        },
      }),
    },
    repository: {
      virtualPaymentNotifyToken: 'notify-token',
      async handleVirtualPaymentNotify(notify) {
        notifyCalls.push(['handleVirtualPaymentNotify', notify.orderNo, notify.openid, notify.productId]);
        return {
          orderNo: notify.orderNo,
          status: 'paid',
        };
      },
    },
  });
  assert.strictEqual(notifyPostResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(notifyPostResponse.body), {
    ErrCode: 0,
    ErrMsg: 'success',
  });
  assert.deepStrictEqual(notifyCalls, [
    ['handleVirtualPaymentNotify', 'OBPAY20260615100000ABC123', 'openid-1', 'pro_year'],
  ]);

  const listResponse = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/sync/records',
      query: { status: 'pending' },
      headers: clientHeaders,
    },
    repository,
  });

  assert.strictEqual(listResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(listResponse.body).data.map((item) => item._id), ['record-text-1']);
  assert.strictEqual(JSON.parse(listResponse.body).data[0].content, 'API record');

  const markResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/records/record-text-1/synced',
      query: {},
      headers: clientHeaders,
    },
    repository,
  });

  assert.strictEqual(markResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(markResponse.body).data, {
    id: 'record-text-1',
    status: 'synced',
  });

  const fileResponse = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/sync/files/download-url',
      query: { fileID: 'cloud://voices/001.mp3' },
      headers: clientHeaders,
    },
    repository,
  });

  assert.strictEqual(fileResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(fileResponse.body).data, {
    fileID: 'cloud://voices/001.mp3',
    tempFileURL: 'https://temp.example.com/voice.mp3',
  });

  const fallbackFileResponse = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/sync/download-url',
      query: { fileID: 'cloud://voices/002.mp3' },
      headers: clientHeaders,
    },
    repository,
  });

  assert.strictEqual(fallbackFileResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(fallbackFileResponse.body).data, {
    fileID: 'cloud://voices/002.mp3',
    tempFileURL: 'https://temp.example.com/voice.mp3',
  });

  const entitlementResponse = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/sync/entitlements/status',
      query: { plan: 'local_transcription_beta' },
      headers: clientHeaders,
    },
    repository,
  });

  assert.strictEqual(entitlementResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(entitlementResponse.body).data, {
    hasAccess: true,
    plan: 'local_transcription_beta',
    status: 'active',
    expiresAt: '2036-07-03T08:00:00.000Z',
    code: '',
    source: '',
    durationDays: 0,
    cloudQuotaSeconds: 0,
    cloudUsedSeconds: 0,
    cloudRemainingSeconds: 0,
  });

  const autoExistingResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/entitlements/auto-redeem',
      query: {},
      headers: clientHeaders,
      body: '{}',
    },
    repository,
  });

  assert.strictEqual(autoExistingResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(autoExistingResponse.body).data, {
    hasAccess: true,
    plan: 'local_transcription_beta',
    status: 'active',
    expiresAt: '2036-07-03T08:00:00.000Z',
    code: '',
    source: '',
    durationDays: 0,
    cloudQuotaSeconds: 0,
    cloudUsedSeconds: 0,
    cloudRemainingSeconds: 0,
    autoRedeemed: false,
  });

  const autoRedeemedRepository = {
    ...repository,
    async getEntitlement(openid, plan, context = {}) {
      calls.push(['autoGetEntitlement', openid, plan, context.clientId || '']);
      return null;
    },
    async autoRedeemAccessCode(openid, context = {}) {
      calls.push(['autoRedeemAccessCode', openid, context.clientId || '']);
      return {
        hasAccess: true,
        plan: 'local_transcription_beta',
        status: 'active',
        expiresAt: '2026-07-30T08:00:00.000Z',
        code: 'OBPROT93C6',
        source: 'redeem_code',
      };
    },
  };
  const autoRedeemedResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/entitlements/auto-redeem',
      query: {},
      headers: clientHeaders,
      body: '{}',
    },
    repository: autoRedeemedRepository,
  });

  assert.strictEqual(autoRedeemedResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(autoRedeemedResponse.body).data, {
    hasAccess: true,
    plan: 'local_transcription_beta',
    status: 'active',
    expiresAt: '2026-07-30T08:00:00.000Z',
    code: 'OBPROT93C6',
    source: 'redeem_code',
    autoRedeemed: true,
  });

  const redeemResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/entitlements/redeem',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({ code: ' zzai030 ' }),
    },
    repository,
  });

  assert.strictEqual(redeemResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(redeemResponse.body).data, {
    hasAccess: true,
    plan: 'local_transcription_beta',
    status: 'active',
    expiresAt: '2036-07-03T08:00:00.000Z',
  });

  const invalidRedeemResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/entitlements/redeem',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({ code: ' bad code ' }),
    },
    repository,
  });

  assert.strictEqual(invalidRedeemResponse.statusCode, 400);
  assert.strictEqual(JSON.parse(invalidRedeemResponse.body).errCode, 'INVALID_REDEEM_CODE');
  assert.strictEqual(JSON.parse(invalidRedeemResponse.body).errMsg, 'Invalid redeem code');

  const foreignFileResponse = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/sync/files/download-url',
      query: { fileID: 'cloud://voices/foreign.mp3' },
      headers: clientHeaders,
    },
    repository,
  });

  assert.strictEqual(foreignFileResponse.statusCode, 403);
  assert.strictEqual(JSON.parse(foreignFileResponse.body).errMsg, 'File does not belong to current user');

  const bindResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/bind',
      query: {},
      headers: { authorization: 'Bearer token-123' },
      body: JSON.stringify({ clientId: 'client-1' }),
    },
    repository,
  });

  assert.strictEqual(bindResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(bindResponse.body).data, {
    status: 'bound',
    boundAt: '2026-05-20T10:00:00.000Z',
  });

  const alreadyBoundResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/bind',
      query: {},
      headers: { authorization: 'Bearer token-bound' },
      body: JSON.stringify({ clientId: 'client-2' }),
    },
    repository,
  });

  assert.strictEqual(alreadyBoundResponse.statusCode, 409);
  assert.strictEqual(JSON.parse(alreadyBoundResponse.body).errMsg, 'Bind code already bound');

  const invalidBindResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/bind',
      query: {},
      headers: { authorization: 'Bearer wrong-code' },
      body: JSON.stringify({ clientId: 'client-3' }),
    },
    repository,
  });

  assert.strictEqual(invalidBindResponse.statusCode, 403);
  assert.strictEqual(JSON.parse(invalidBindResponse.body).errMsg, 'Invalid bind code');

  const bindLimitResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/bind',
      query: {},
      headers: { authorization: 'Bearer limit-code' },
      body: JSON.stringify({ clientId: 'client-4' }),
    },
    repository,
  });

  assert.strictEqual(bindLimitResponse.statusCode, 403);
  assert.deepStrictEqual(JSON.parse(bindLimitResponse.body), {
    success: false,
    errCode: 'PLUGIN_BINDING_LIMIT_EXCEEDED',
    errMsg: 'Free plan allows 1 binding; Pro allows 3 bindings',
    data: {
      currentCount: 1,
      limit: 1,
      hasProBinding: false,
    },
  });

  const unbindSelfResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/unbind-self',
      query: {},
      headers: clientHeaders,
    },
    repository,
  });

  assert.strictEqual(unbindSelfResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(unbindSelfResponse.body).data, {
    status: 'unbound',
  });

  const cloudTranscriptionResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/transcriptions/cloud',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        fileID: 'cloud://voices/001.mp3',
        durationSeconds: 120,
        localError: 'local whisper failed',
      }),
    },
    repository: {
      ...repository,
      async getEntitlement(openid, plan) {
        calls.push(['cloudGetEntitlement', openid, plan]);
        return {
          plan,
          status: 'active',
          expiresAt: '2036-07-03T08:00:00.000Z',
          cloudQuotaSeconds: 3600,
          cloudUsedSeconds: 60,
        };
      },
      async transcribeCloudAudio(openid, payload) {
        calls.push(['transcribeCloudAudio', openid, payload.fileID, payload.durationSeconds, payload.localError]);
        return {
          transcription: '云端兜底转写结果',
          provider: 'doubao',
          requestId: 'request-1',
          billedSeconds: 120,
        };
      },
      async recordCloudTranscriptionUsage(openid, usage) {
        calls.push(['recordCloudTranscriptionUsage', openid, usage.fileID, usage.usedSeconds, usage.remainingSeconds]);
      },
    },
  });

  assert.strictEqual(cloudTranscriptionResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(cloudTranscriptionResponse.body).data, {
    transcription: '云端兜底转写结果',
    provider: 'doubao',
    requestId: 'request-1',
    usedSeconds: 120,
    remainingSeconds: 3420,
  });

  const noProCloudResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/transcriptions/cloud',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        fileID: 'cloud://voices/001.mp3',
        durationSeconds: 60,
      }),
    },
    repository: {
      ...repository,
      async getEntitlement() {
        return null;
      },
    },
  });

  assert.strictEqual(noProCloudResponse.statusCode, 403);
  assert.strictEqual(JSON.parse(noProCloudResponse.body).errCode, 'PRO_REQUIRED');

  const quotaExceededCloudResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/transcriptions/cloud',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        fileID: 'cloud://voices/001.mp3',
        durationSeconds: 600,
      }),
    },
    repository: {
      ...repository,
      async getEntitlement(openid, plan) {
        return {
          plan,
          status: 'active',
          expiresAt: '2036-07-03T08:00:00.000Z',
          cloudQuotaSeconds: 300,
          cloudUsedSeconds: 0,
        };
      },
    },
  });

  assert.strictEqual(quotaExceededCloudResponse.statusCode, 402);
  assert.strictEqual(JSON.parse(quotaExceededCloudResponse.body).errCode, 'CLOUD_QUOTA_EXCEEDED');

  const cloudTranscriptionByUrlResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/transcriptions/cloud',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        audioUrl: 'https://video.example.com/xhs.mp4',
        durationSeconds: 60,
        localError: 'local whisper crashed',
      }),
    },
    repository: {
      ...repository,
      async getEntitlement(openid, plan) {
        calls.push(['cloudGetEntitlementByUrl', openid, plan]);
        return {
          plan,
          status: 'active',
          expiresAt: '2036-07-03T08:00:00.000Z',
          cloudQuotaSeconds: 3600,
          cloudUsedSeconds: 0,
        };
      },
      async transcribeCloudAudio(openid, payload) {
        calls.push(['transcribeCloudAudioByUrl', openid, payload.audioUrl, payload.durationSeconds, payload.localError]);
        return {
          transcription: 'xhs cloud fallback transcript',
          provider: 'doubao',
          requestId: 'request-url-1',
          billedSeconds: 60,
        };
      },
      async recordCloudTranscriptionUsage(openid, usage) {
        calls.push(['recordCloudTranscriptionUsageByUrl', openid, usage.fileID, usage.usedSeconds, usage.remainingSeconds]);
      },
    },
  });

  assert.strictEqual(cloudTranscriptionByUrlResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(cloudTranscriptionByUrlResponse.body).data, {
    transcription: 'xhs cloud fallback transcript',
    provider: 'doubao',
    requestId: 'request-url-1',
    usedSeconds: 60,
    remainingSeconds: 3540,
  });

  const prepareMediaResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/media/prepare',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        url: 'https://www.douyin.com/video/123',
        recordId: 'record-web-media-1',
      }),
    },
    repository: {
      ...repository,
      async prepareWebpageMedia(openid, payload) {
        calls.push(['prepareWebpageMedia', openid, payload.url, payload.recordId]);
        return {
          mediaUrl: 'https://media.example.com/prepared-douyin.m4a',
          audioUrl: 'https://media.example.com/prepared-douyin.m4a',
          originalMediaUrl: 'https://platform.example.com/raw-douyin.m4a',
          preparedFileID: 'cloud://prepared-media/openid-1/demo.m4a',
          cached: true,
          mediaPreparedByCloud: true,
          source: 'media-resolver',
          title: 'prepared title',
          durationSeconds: 88,
          expiresAt: '2026-06-16T12:00:00.000Z',
        };
      },
    },
  });

  assert.strictEqual(prepareMediaResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(prepareMediaResponse.body).data, {
    mediaUrl: 'https://media.example.com/prepared-douyin.m4a',
    audioUrl: 'https://media.example.com/prepared-douyin.m4a',
    originalMediaUrl: 'https://platform.example.com/raw-douyin.m4a',
    preparedFileID: 'cloud://prepared-media/openid-1/demo.m4a',
    cached: true,
    mediaPreparedByCloud: true,
    source: 'media-resolver',
    title: 'prepared title',
    durationSeconds: 88,
    expiresAt: '2026-06-16T12:00:00.000Z',
  });

  const preferenceResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/transcription-preferences',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        cloudPreTranscriptionEnabled: true,
        cloudPreTranscriptionThresholdMinutes: 30,
      }),
    },
    repository: {
      ...repository,
      async saveTranscriptionPreferences(openid, preferences) {
        calls.push([
          'saveTranscriptionPreferences',
          openid,
          preferences.cloudPreTranscriptionEnabled,
          preferences.cloudPreTranscriptionThresholdMinutes,
        ]);
        return preferences;
      },
    },
  });

  assert.strictEqual(preferenceResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(preferenceResponse.body).data, {
    cloudPreTranscriptionEnabled: true,
    cloudPreTranscriptionThresholdMinutes: 30,
  });

  const ocrResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/ocr/images',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        images: [
          { imageUrl: 'https://img.example.com/1.jpg', imageBase64: 'aW1n', index: 1 },
        ],
      }),
    },
    repository: {
      ...repository,
      async getEntitlement(openid, plan, context = {}) {
        calls.push(['ocrGetEntitlement', openid, plan, context.clientId || '']);
        return {
          plan,
          status: 'active',
          expiresAt: '2036-07-03T08:00:00.000Z',
        };
      },
      async recognizeImageTexts(openid, payload) {
        calls.push(['recognizeImageTexts', openid, payload.images.length, payload.images[0].imageUrl]);
        return {
          provider: 'mock-ocr',
          items: [
            { imageUrl: payload.images[0].imageUrl, index: 1, text: 'image text content for OCR' },
          ],
        };
      },
    },
  });

  assert.strictEqual(ocrResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(ocrResponse.body).data.items, [
    {
      imageUrl: 'https://img.example.com/1.jpg',
      text: 'image text content for OCR',
      index: 1,
      readableChars: 22,
      substantial: false,
    },
  ]);

  const metadataGenerateResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/metadata/generate',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        title: 'wechat channels transcript',
        source: 'wechat channels',
        content: 'comments are a useful topic library with user questions and needs',
      }),
    },
    repository: {
      ...repository,
      async generateMetadata(openid, payload) {
        calls.push(['generateMetadata', openid, payload.title, payload.source, payload.content.slice(0, 10)]);
        return {
          description: 'comments can be used as a topic library',
          keywords: ['评论区选题', '用户痛点', '内容创作'],
        };
      },
    },
  });

  assert.strictEqual(metadataGenerateResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(metadataGenerateResponse.body).data, {
    description: 'comments can be used as a topic library',
    keywords: ['评论区选题', '用户痛点', '内容创作'],
  });

  const metadataNoModelResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/metadata/generate',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        title: '抖音口播文案',
        source: 'douyin audio video',
        content: 'platforms make it hard to keep content as your own private asset',
      }),
    },
    repository: {
      async findOpenIdByToken() {
        return 'openid-1';
      },
      async getEntitlement() {
        return {
          plan: 'local_transcription_beta',
          status: 'active',
          expiresAt: '2036-07-03T08:00:00.000Z',
        };
      },
      async generateMetadata() {
        return null;
      },
    },
  });
  assert.strictEqual(metadataNoModelResponse.statusCode, 502);
  assert.strictEqual(JSON.parse(metadataNoModelResponse.body).errCode, 'AI_METADATA_UNAVAILABLE');

  assert.deepStrictEqual(calls, [
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['listPendingRecords', 'openid-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['markRecordSynced', 'openid-1', 'record-text-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['isFileOwnedByOpenId', 'openid-1', 'cloud://voices/001.mp3'],
    ['getTempFileURL', 'openid-1', 'cloud://voices/001.mp3'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['isFileOwnedByOpenId', 'openid-1', 'cloud://voices/002.mp3'],
    ['getTempFileURL', 'openid-1', 'cloud://voices/002.mp3'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['getEntitlement', 'openid-1', 'local_transcription_beta', 'client-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['getEntitlement', 'openid-1', 'local_transcription_beta', 'client-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['autoGetEntitlement', 'openid-1', 'local_transcription_beta', 'client-1'],
    ['autoRedeemAccessCode', 'openid-1', 'client-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['redeemAccessCode', 'openid-1', 'ZZAI030', 'client-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['redeemAccessCode', 'openid-1', 'BADCODE', 'client-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['isFileOwnedByOpenId', 'openid-1', 'cloud://voices/foreign.mp3'],
    ['bindClientByToken', 'token-123', 'client-1'],
    ['bindClientByToken', 'token-bound', 'client-2'],
    ['bindClientByToken', 'wrong-code', 'client-3'],
    ['bindClientByToken', 'limit-code', 'client-4'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['unbindClientByToken', 'token-123', 'client-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['isFileOwnedByOpenId', 'openid-1', 'cloud://voices/001.mp3'],
    ['cloudGetEntitlement', 'openid-1', 'local_transcription_beta'],
    ['transcribeCloudAudio', 'openid-1', 'cloud://voices/001.mp3', 120, 'local whisper failed'],
    ['recordCloudTranscriptionUsage', 'openid-1', 'cloud://voices/001.mp3', 120, 3420],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['isFileOwnedByOpenId', 'openid-1', 'cloud://voices/001.mp3'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['isFileOwnedByOpenId', 'openid-1', 'cloud://voices/001.mp3'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['cloudGetEntitlementByUrl', 'openid-1', 'local_transcription_beta'],
    ['transcribeCloudAudioByUrl', 'openid-1', 'https://video.example.com/xhs.mp4', 60, 'local whisper crashed'],
    ['recordCloudTranscriptionUsageByUrl', 'openid-1', 'https://video.example.com/xhs.mp4', 60, 3540],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['prepareWebpageMedia', 'openid-1', 'https://www.douyin.com/video/123', 'record-web-media-1'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['saveTranscriptionPreferences', 'openid-1', true, 30],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['ocrGetEntitlement', 'openid-1', 'local_transcription_beta', 'client-1'],
    ['recognizeImageTexts', 'openid-1', 1, 'https://img.example.com/1.jpg'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['getEntitlement', 'openid-1', 'local_transcription_beta', 'client-1'],
    ['generateMetadata', 'openid-1', 'wechat channels transcript', 'wechat channels', 'comments a'],
  ]);

  assert.deepStrictEqual(collectRecordFileIds({
    metadata: {
      audioFileID: 'cloud://voices/001.mp3',
      fileID: 'cloud://files/001.pdf',
    },
  }), [
    'cloud://voices/001.mp3',
    'cloud://files/001.pdf',
  ]);

  assert.deepStrictEqual(buildSyncedRecordCleanupData({
    syncedAt: '2026-05-14T08:00:00.000Z',
    fileIds: ['cloud://files/001.pdf'],
  }), {
    status: 'synced',
    syncedAt: '2026-05-14T08:00:00.000Z',
    content: '',
    metadata: {
      cleanupStatus: 'cleaned',
      cleanedAt: '2026-05-14T08:00:00.000Z',
      deletedFileCount: 1,
      cleanupError: '',
    },
  });
  assert.deepStrictEqual(normalizeSyncableRecord({
    _id: 'xhs-podcast-text-note',
    type: 'webpage',
    content: 'http://xhslink.com/o/3LgfhGjkO9w',
    status: 'pending',
    metadata: {
      url: 'http://xhslink.com/o/3LgfhGjkO9w',
      shareText: '\u8ba9\u6211\u770b\u770b \u8fd8\u6709\u8c01\u4e0d\u4f1a\u7528\u64ad\u5ba2\u8f6c\u6587\u5b57\u7684 \u53bb\u3010\u5c0f\u7ea2\u4e66\u3011\u770b\u770b\u8fd9\u7bc7\u5b9d\u85cf\u7b14\u8bb0\u5427\uff01',
      conversionStatus: 'pending',
      webpageMediaType: 'audio_video',
      transcriptionStatus: 'pending',
      transcriptionMode: 'local',
      cloudTranscriptionRequested: false,
      cloudTranscriptionReason: 'cloud-disabled',
    },
  }).metadata, {
    url: 'http://xhslink.com/o/3LgfhGjkO9w',
    shareText: '\u8ba9\u6211\u770b\u770b \u8fd8\u6709\u8c01\u4e0d\u4f1a\u7528\u64ad\u5ba2\u8f6c\u6587\u5b57\u7684 \u53bb\u3010\u5c0f\u7ea2\u4e66\u3011\u770b\u770b\u8fd9\u7bc7\u5b9d\u85cf\u7b14\u8bb0\u5427\uff01',
    conversionStatus: 'pending',
  });
  assert.strictEqual(shouldKeepRecordPendingForTranscription({
    type: 'voice',
    metadata: {
      audioFileID: 'cloud://voices/not-ready.mp3',
      transcriptionMode: 'cloud',
      transcriptionStatus: 'pending',
    },
  }), true);
  assert.strictEqual(shouldKeepRecordPendingForTranscription({
    type: 'webpage',
    metadata: {
      webpageMediaType: 'audio_video',
      transcriptionMode: 'local',
      transcriptionStatus: 'failed',
      transcriptionError: 'local transcribe failed',
    },
  }), false);
  assert.strictEqual(shouldKeepRecordPendingForTranscription({
    type: 'voice',
    metadata: {
      audioFileID: 'cloud://voices/local-ready-to-mark.mp3',
      transcriptionMode: 'local',
      transcriptionStatus: 'pending',
    },
  }), false);
  assert.strictEqual(shouldKeepRecordPendingForTranscription({
    type: 'voice',
    metadata: {
      audioFileID: 'cloud://voices/done.mp3',
      transcriptionStatus: 'success',
      transcription: 'done',
    },
  }), false);
  assert.deepStrictEqual(normalizeSyncableRecord({
    _id: 'xhs-text-note',
    type: 'webpage',
    content: 'http://xhslink.com/o/2rths0HGbgt',
    status: 'pending',
    metadata: {
      url: 'http://xhslink.com/o/2rths0HGbgt',
      shareText: 'AI era, I recommend Obsidian. Jump to Xiaohongshu for details.',
      conversionStatus: 'pending',
      webpageMediaType: 'audio_video',
      transcriptionStatus: 'pending',
      transcriptionMode: 'local',
      cloudTranscriptionRequested: false,
      cloudTranscriptionReason: 'cloud-disabled',
    },
  }).metadata, {
    url: 'http://xhslink.com/o/2rths0HGbgt',
    shareText: 'AI era, I recommend Obsidian. Jump to Xiaohongshu for details.',
    conversionStatus: 'pending',
  });
  assert.strictEqual(shouldKeepRecordPendingForTranscription({
    type: 'webpage',
    content: 'http://xhslink.com/o/2rths0HGbgt',
    metadata: {
      url: 'http://xhslink.com/o/2rths0HGbgt',
      shareText: 'AI era, I recommend Obsidian. Jump to Xiaohongshu for details.',
      webpageMediaType: 'audio_video',
      transcriptionStatus: 'pending',
      transcriptionMode: 'local',
    },
  }), false);

  let adminCalled = false;
  const adminResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/admin/summary',
      query: {},
      headers: {
        'x-admin-secret': 'secret',
      },
      body: JSON.stringify({ range: 'all' }),
    },
    repository: {
      async handleAdminRequest(request) {
        adminCalled = true;
        assert.strictEqual(request.path, '/summary');
        assert.strictEqual(request.adminSecret, 'secret');
        return { ok: true };
      },
    },
  });
  assert.strictEqual(adminCalled, true);
  assert.strictEqual(adminResponse.statusCode, 200);
  assert.strictEqual(adminResponse.headers['Access-Control-Allow-Origin'], '*');
  assert.deepStrictEqual(JSON.parse(adminResponse.body), {
    success: true,
    data: {
      ok: true,
    },
  });

  const feishuStartResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/feishu/oauth/start',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        feishuApp: {
          appId: 'cli_custom_app',
          appSecret: 'custom-secret',
        },
      }),
    },
    repository: {
      ...repository,
      async createFeishuOAuthStart(openid, clientId, request, payload) {
        calls.push(['createFeishuOAuthStart', openid, clientId, request.path, payload.feishuApp]);
        return {
          authUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=state-1',
          expiresAt: '2026-07-04T10:05:00.000Z',
        };
      },
    },
  });
  assert.strictEqual(feishuStartResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(feishuStartResponse.body).data, {
    authUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=state-1',
    expiresAt: '2026-07-04T10:05:00.000Z',
  });

  const feishuStatusResponse = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/sync/feishu/oauth/status',
      query: {},
      headers: clientHeaders,
      body: '',
    },
    repository: {
      ...repository,
      async getFeishuOAuthStatus(openid, clientId) {
        calls.push(['getFeishuOAuthStatus', openid, clientId]);
        return {
          connected: true,
          scope: 'offline_access docx:document:readonly',
          expiresAt: '2026-07-04T12:00:00.000Z',
        };
      },
    },
  });
  assert.strictEqual(feishuStatusResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(feishuStatusResponse.body).data, {
    connected: true,
    scope: 'offline_access docx:document:readonly',
    expiresAt: '2026-07-04T12:00:00.000Z',
  });

  const feishuExtractResponse = await handleSyncApiRequest({
    request: {
      method: 'POST',
      path: '/sync/feishu/extract',
      query: {},
      headers: clientHeaders,
      body: JSON.stringify({
        url: 'https://example.feishu.cn/wiki/wikiToken123',
        feishuApp: {
          appId: 'cli_custom_app',
          appSecret: 'custom-secret',
        },
      }),
    },
    repository: {
      ...repository,
      async extractFeishuDocument(openid, clientId, payload) {
        calls.push(['extractFeishuDocument', openid, clientId, payload.url, payload.feishuApp]);
        return {
          title: 'OpenAPI document',
          documentId: 'docxToken123',
          blockCount: 2,
          blocks: [{ block_id: 'b1' }, { block_id: 'b2' }],
        };
      },
    },
  });
  assert.strictEqual(feishuExtractResponse.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(feishuExtractResponse.body).data, {
    title: 'OpenAPI document',
    documentId: 'docxToken123',
    blockCount: 2,
    blocks: [{ block_id: 'b1' }, { block_id: 'b2' }],
  });
  assert.deepStrictEqual(calls.filter((item) => item[0] === 'createFeishuOAuthStart')[0], [
    'createFeishuOAuthStart',
    'openid-1',
    'client-1',
    '/sync/feishu/oauth/start',
    { appId: 'cli_custom_app', appSecret: 'custom-secret' },
  ]);
  assert.deepStrictEqual(calls.filter((item) => item[0] === 'extractFeishuDocument')[0], [
    'extractFeishuDocument',
    'openid-1',
    'client-1',
    'https://example.feishu.cn/wiki/wikiToken123',
    { appId: 'cli_custom_app', appSecret: 'custom-secret' },
  ]);

  const feishuCallbackResponse = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/sync/feishu/oauth/callback',
      query: {
        code: 'oauth-code-1',
        state: 'state-1',
      },
      headers: {},
      body: '',
    },
    repository: {
      async completeFeishuOAuthCallback(input) {
        assert.deepStrictEqual(input, {
          code: 'oauth-code-1',
          state: 'state-1',
        });
        return {
          connected: true,
        };
      },
    },
  });
  assert.strictEqual(feishuCallbackResponse.statusCode, 200);
  assert.ok(feishuCallbackResponse.body.includes('Feishu connected'));

  const unauthorized = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/records',
      query: {},
      headers: {},
    },
    repository,
  });
  assert.strictEqual(unauthorized.statusCode, 401);

  const missingToken = await handleSyncApiRequest({
    request: {
      method: 'GET',
      path: '/records',
      query: {},
      headers: {
        authorization: 'Bearer missing',
        'x-wechat-inbox-client-id': 'client-1',
      },
    },
    repository,
  });
  assert.strictEqual(missingToken.statusCode, 403);
})();
