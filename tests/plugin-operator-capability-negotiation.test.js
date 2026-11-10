'use strict';
const assert = require('node:assert/strict');
const { createOperatorMediaNode } = require('../obsidian-plugin/wechat-inbox-sync/src/operator-media-node');
(async () => {
  const allowed = new Set(['media_acquire', 'media_transcode', 'local_asr', 'xiaohongshu', 'wechat_article']);
  const heartbeats = [], claims = [];
  const node = createOperatorMediaNode({
    plugin: {
      settings: {},
      acquireOperatorXiaohongshuContent() {}, acquireOperatorWechatArticleContent() {},
      acquireOperatorWechatChannelsMediaToTempFile() {}, hydrateBilibiliTranscript() {}, hydrateXiaoyuzhouTranscript() {},
      getLocalAsrInstallStatus: () => ({ ready: true, ffmpegPath: 'fixture-ffmpeg' }),
      isOperatorLocalAsrAvailable: () => true,
    },
    env: { WECHAT_INBOX_OPERATOR_NODE_ENABLED: '1', WECHAT_INBOX_OPERATOR_NODE_ID: 'fixture-node', WECHAT_INBOX_OPERATOR_NODE_TOKEN: 'fixture-token', WECHAT_INBOX_OPERATOR_NODE_API_BASE: 'https://fixture.invalid/sync' },
    setTimer: () => 1, clearTimer() {},
    request: async (route, body) => {
      if (body.capabilities.some(c => !allowed.has(c))) throw Object.assign(Error('fixture capability rejected'), { code: 'WORKER_CAPABILITY_FORBIDDEN' });
      if (route.endsWith('/capacity')) { heartbeats.push(body); return { success: true }; }
      if (route.endsWith('/claim')) { claims.push(body); return { jobs: [] }; }
      throw Error('Unexpected route');
    },
  });
  node.start();
  try {
    await node.poll();
    assert.deepEqual(new Set(heartbeats.at(-1).capabilities), allowed, 'rejecting channels must preserve supported XHS and WeChat article capabilities');
    assert.deepEqual(new Set(claims.at(-1).capabilities), allowed, 'claim uses negotiated supported capabilities');
    assert.equal(claims.length, 1, 'capability probes must never claim real jobs');
  } finally { await node.stop(); }
  console.log('operator capability negotiation preserves supported capabilities');
})().catch(e => { console.error(e); process.exitCode = 1; });
