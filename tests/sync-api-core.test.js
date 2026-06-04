const assert = require('assert');

const {
  buildSyncedRecordCleanupData,
  collectRecordFileIds,
  handleSyncApiRequest,
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
