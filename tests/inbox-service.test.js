const assert = require('assert');

const { createInboxService } = require('../miniprogram/services/inbox-service');

const calls = [];
const wxMock = {
  cloud: {
    callFunction(options) {
      calls.push(['callFunction', options]);
      return Promise.resolve({ result: { success: true, data: options.data } });
    },
    uploadFile(options) {
      calls.push(['uploadFile', options]);
      return Promise.resolve({ fileID: `cloud://${options.cloudPath}` });
    },
  },
};

(async () => {
  const service = createInboxService(wxMock);

  await service.saveRecord({
    contentType: 'text',
    content: '先收集，后整理',
  });

  assert.deepStrictEqual(calls[0], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'createInboxRecord',
        contentType: 'text',
        content: '先收集，后整理',
      },
    },
  ]);

  await service.createBindCode();
  assert.deepStrictEqual(calls[1], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'createBindCode',
      },
    },
  ]);

  await service.getBindStatus('A1B-2C3');
  assert.deepStrictEqual(calls[2], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'getBindStatus',
        code: 'A1B-2C3',
      },
    },
  ]);

  await service.unbindBindClient('A1B-2C3', 'client-home');
  assert.deepStrictEqual(calls[3], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'unbindBindClient',
        code: 'A1B-2C3',
        clientId: 'client-home',
      },
    },
  ]);

  const upload = await service.uploadVoiceFile('temp://voice.mp3');
  assert.strictEqual(upload.fileID.startsWith('cloud://voices/'), true);
  assert.strictEqual(upload.fileID.endsWith('.mp3'), true);
  assert.strictEqual(calls[4][0], 'uploadFile');
  assert.strictEqual(calls[4][1].filePath, 'temp://voice.mp3');

  const uploadedFile = await service.uploadInboxFile({
    path: 'temp://example.pdf',
    name: 'example.pdf',
  });
  assert.strictEqual(uploadedFile.fileID.startsWith('cloud://files/'), true);
  assert.strictEqual(uploadedFile.fileID.endsWith('.pdf'), true);
  assert.strictEqual(calls[5][0], 'uploadFile');
  assert.strictEqual(calls[5][1].filePath, 'temp://example.pdf');

  await service.submitFeedback({
    content: '绑定时看不懂云函数 HTTP 路由怎么配',
    contact: 'feishu-user',
    appVersion: '0.1.0',
  });
  assert.deepStrictEqual(calls[6], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'submitFeedback',
        content: '绑定时看不懂云函数 HTTP 路由怎么配',
        contact: 'feishu-user',
        appVersion: '0.1.0',
      },
    },
  ]);

  await service.getPublicConfig();
  assert.deepStrictEqual(calls[7], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'getPublicConfig',
      },
    },
  ]);

  await service.getDailyUsage();
  assert.deepStrictEqual(calls[8], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'getDailyUsage',
      },
    },
  ]);

  await service.unlockDailyUsageByShare();
  assert.deepStrictEqual(calls[9], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'unlockDailyUsageByShare',
      },
    },
  ]);

  await service.unlockDailyUsageByAd();
  assert.deepStrictEqual(calls[10], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'unlockDailyUsageByAd',
      },
    },
  ]);

  await service.getEntitlementStatus('local_transcription_beta');
  assert.deepStrictEqual(calls[11], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'getEntitlementStatus',
        plan: 'local_transcription_beta',
      },
    },
  ]);

  await service.redeemAccessCode('ZZAI001');
  assert.deepStrictEqual(calls[12], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'redeemAccessCode',
        code: 'ZZAI001',
      },
    },
  ]);

  await service.adminGenerateRedeemCodes({
    adminSecret: 'secret',
    count: 10,
    durationDays: 30,
    maxRedemptions: 1,
    prefix: 'OBPRO',
    note: '内测码',
  });
  assert.deepStrictEqual(calls[13], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'adminGenerateRedeemCodes',
        adminSecret: 'secret',
        count: 10,
        durationDays: 30,
        maxRedemptions: 1,
        prefix: 'OBPRO',
        note: '内测码',
      },
    },
  ]);

  await service.adminListRedeemCodes({ adminSecret: 'secret', keyword: 'OBPRO' });
  assert.deepStrictEqual(calls[14], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'adminListRedeemCodes',
        adminSecret: 'secret',
        keyword: 'OBPRO',
      },
    },
  ]);

  await service.adminListEntitlements({ adminSecret: 'secret', keyword: 'openid-1' });
  assert.deepStrictEqual(calls[15], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'adminListEntitlements',
        adminSecret: 'secret',
        keyword: 'openid-1',
      },
    },
  ]);

  await service.adminListBindCodes({ adminSecret: 'secret', keyword: 'ABC' });
  assert.deepStrictEqual(calls[16], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'adminListBindCodes',
        adminSecret: 'secret',
        keyword: 'ABC',
      },
    },
  ]);

  await service.adminUpdateEntitlement({
    adminSecret: 'secret',
    entitlementId: 'ent-1',
    action: 'extend',
    days: 30,
  });
  assert.deepStrictEqual(calls[17], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'adminUpdateEntitlement',
        adminSecret: 'secret',
        entitlementId: 'ent-1',
        action: 'extend',
        days: 30,
      },
    },
  ]);

  await service.adminUpdateRedeemCode({
    adminSecret: 'secret',
    codeId: 'code-1',
    action: 'disable',
  });
  assert.deepStrictEqual(calls[18], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'adminUpdateRedeemCode',
        adminSecret: 'secret',
        codeId: 'code-1',
        action: 'disable',
      },
    },
  ]);

  await service.trackAnalyticsEvent('app_visit', { view: 'bind' });
  assert.deepStrictEqual(calls[19], [
    'callFunction',
    {
      name: 'quickstartFunctions',
      data: {
        type: 'trackAnalyticsEvent',
        eventName: 'app_visit',
        payload: { view: 'bind' },
      },
    },
  ]);
})();
