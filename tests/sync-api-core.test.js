const assert = require('assert');

const {
  buildSyncedRecordCleanupData,
  collectRecordFileIds,
  handleSyncApiRequest,
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
    async getEntitlement(openid, plan) {
      calls.push(['getEntitlement', openid, plan]);
      return openid === 'openid-1' && plan === 'local_transcription_beta'
        ? {
          plan,
          status: 'active',
          expiresAt: '2026-07-03T08:00:00.000Z',
        }
        : null;
    },
    async redeemAccessCode(openid, code) {
      calls.push(['redeemAccessCode', openid, code]);
      if (code === 'BADCODE') {
        const error = new Error('兑换码无效、已过期或已被使用');
        error.code = 'INVALID_REDEEM_CODE';
        throw error;
      }
      return code === 'ZZAI030'
        ? {
          hasAccess: true,
          plan: 'local_transcription_beta',
          status: 'active',
          expiresAt: '2026-07-03T08:00:00.000Z',
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
    expiresAt: '2026-07-03T08:00:00.000Z',
    code: '',
    source: '',
    durationDays: 0,
    cloudQuotaSeconds: 0,
    cloudUsedSeconds: 0,
    cloudRemainingSeconds: 0,
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
    expiresAt: '2026-07-03T08:00:00.000Z',
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
  assert.strictEqual(JSON.parse(invalidRedeemResponse.body).errMsg, '兑换码无效、已过期或已被使用');

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
          expiresAt: '2026-07-03T08:00:00.000Z',
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
          expiresAt: '2026-07-03T08:00:00.000Z',
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
          expiresAt: '2026-07-03T08:00:00.000Z',
          cloudQuotaSeconds: 3600,
          cloudUsedSeconds: 0,
        };
      },
      async transcribeCloudAudio(openid, payload) {
        calls.push(['transcribeCloudAudioByUrl', openid, payload.audioUrl, payload.durationSeconds, payload.localError]);
        return {
          transcription: '小红书云端兜底转写结果',
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
    transcription: '小红书云端兜底转写结果',
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
    ['getEntitlement', 'openid-1', 'local_transcription_beta'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['redeemAccessCode', 'openid-1', 'ZZAI030'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['redeemAccessCode', 'openid-1', 'BADCODE'],
    ['findOpenIdByToken', 'token-123', 'client-1'],
    ['isFileOwnedByOpenId', 'openid-1', 'cloud://voices/foreign.mp3'],
    ['bindClientByToken', 'token-123', 'client-1'],
    ['bindClientByToken', 'token-bound', 'client-2'],
    ['bindClientByToken', 'wrong-code', 'client-3'],
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
