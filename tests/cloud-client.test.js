const assert = require('assert');

const { createCloudClient } = require('../desktop-sync/cloud-client');

const calls = [];
const fetchImpl = async (url, options) => {
  calls.push({ url, options });
  if (url.endsWith('/records?status=pending')) {
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            _id: 'record-text-1',
            type: 'text',
            content: '远程记录',
            source: 'wechat-miniprogram',
            createdAt: '2026-05-08T12:34:00.000Z',
            status: 'pending',
            metadata: {},
          },
        ],
      }),
    };
  }
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { id: 'record-text-1', status: 'synced' },
    }),
  };
};

(async () => {
  const client = createCloudClient({
    baseUrl: 'https://api.example.com/sync',
    token: 'token-123',
    fetchImpl,
  });

  const records = await client.listPendingRecords();
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].content, '远程记录');

  await client.markRecordSynced('record-text-1');

  assert.deepStrictEqual(calls[0], {
    url: 'https://api.example.com/sync/records?status=pending',
    options: {
      method: 'GET',
      headers: {
        Authorization: 'Bearer token-123',
        Accept: 'application/json',
      },
    },
  });

  assert.deepStrictEqual(calls[1], {
    url: 'https://api.example.com/sync/records/record-text-1/synced',
    options: {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-123',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
  });
})();

