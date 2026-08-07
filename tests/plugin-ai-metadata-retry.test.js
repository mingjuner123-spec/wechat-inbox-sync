'use strict';

const assert = require('node:assert');
const {
  retryAiMetadataGeneration,
} = require('../obsidian-plugin/wechat-inbox-sync/src/ai-metadata-utils');

async function run() {
  assert.strictEqual(typeof retryAiMetadataGeneration, 'function', 'retry helper must be exported');

  let retryAttempts = 0;
  const retryDelays = [];
  const result = await retryAiMetadataGeneration(async () => {
    retryAttempts += 1;
    if (retryAttempts < 3) throw new Error('Request failed with status code 429');
    return { title: '有效标题', description: '有效简介', keywords: ['关键词'] };
  }, {
    maxAttempts: 3,
    wait: async (delay) => retryDelays.push(delay),
  });
  assert.deepStrictEqual(result, { title: '有效标题', description: '有效简介', keywords: ['关键词'] });
  assert.strictEqual(retryAttempts, 3, 'rate limit must retry twice before succeeding');
  assert.deepStrictEqual(retryDelays, [800, 1600], 'retry backoff must stay bounded and predictable');

  let structured429Attempts = 0;
  await assert.rejects(
    () => retryAiMetadataGeneration(async () => {
      structured429Attempts += 1;
      const error = new Error('upstream temporarily unavailable');
      error.status = 429;
      throw error;
    }, { wait: async () => {} }),
    /temporarily unavailable/,
  );
  assert.strictEqual(structured429Attempts, 3, 'structured HTTP 429 must retry even when the message has no rate-limit text');

  let nonRetryableAttempts = 0;
  await assert.rejects(
    () => retryAiMetadataGeneration(async () => {
      nonRetryableAttempts += 1;
      throw new Error('Request failed with status code 401');
    }, { wait: async () => {} }),
    /401/,
  );
  assert.strictEqual(nonRetryableAttempts, 1, 'authentication failures must not be retried');
}

run().then(() => console.log('plugin-ai-metadata-retry tests passed'));
