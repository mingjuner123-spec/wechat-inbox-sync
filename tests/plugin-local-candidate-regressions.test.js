'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const Module = require('module');

const notices = [];
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      Modal: class Modal {},
      Notice: class Notice {
        constructor(message) { notices.push(String(message)); }
        hide() {}
      },
      requestUrl: async () => ({}),
      normalizePath: (value) => String(value || '').replace(/\\/g, '/'),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main.js';
const PluginClass = require(pluginMainPath);
Module._load = originalLoad;

async function testDouyin403UsesSessionFallback() {
  const plugin = new PluginClass();
  let sessionCalls = 0;
  plugin.downloadArrayBuffer = async () => {
    throw new Error('媒体下载失败：HTTP 403');
  };
  plugin.downloadMediaArrayBufferWithSession = async () => {
    sessionCalls += 1;
    return Buffer.from('ID3-valid-test-audio').buffer;
  };
  plugin.refreshDouyinMediaUrls = async () => [];
  const outputPath = await plugin.downloadMediaToTempFile(
    'https://v3-dy-o.zjcdn.com/example.mp3',
    { sourceUrl: 'https://v.douyin.com/example/' },
  );
  try {
    assert.strictEqual(sessionCalls, 1, '抖音 403 必须使用同一浏览器会话重试');
    assert.strictEqual(fs.existsSync(outputPath), true);
  } finally {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
  }
}

async function testDouyinMediaDownloadTimeoutUsesSessionFallback() {
  const plugin = new PluginClass();
  let sessionCalls = 0;
  plugin.downloadArrayBuffer = async () => {
    throw new Error('media download hard timeout');
  };
  plugin.downloadMediaArrayBufferWithSession = async () => {
    sessionCalls += 1;
    return Buffer.from('ID3-session-fallback-audio');
  };
  plugin.getDouyinMediaCandidatesFromBrowser = async () => [];
  plugin.app = { vault: { adapter: { basePath: process.cwd() } } };
  plugin.resolveLocalMediaDir = () => '';
  plugin.getTempMediaPath = () => '';
  plugin.writeBinaryFile = async () => '';

  try {
    await plugin.downloadMediaToTempFile('https://www.douyin.com/video/123', {
      sourceUrl: 'https://www.douyin.com/video/123',
    });
  } catch (_) {
    // The test only asserts that the timeout path attempts the existing session recovery.
  }
  assert.strictEqual(sessionCalls, 1, '抖音下载超时时必须尝试一次浏览器会话恢复');
}

function startTestServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function stopTestServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function getTestServerUrl(server, pathname = '/') {
  const address = server.address();
  return `http://127.0.0.1:${address.port}${pathname}`;
}

async function testMediaDownloadNormalResponseStillCompletes() {
  const plugin = new PluginClass();
  const server = await startTestServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '20' });
    response.end('ID3-valid-test-audio');
  });
  try {
    const arrayBuffer = await plugin.downloadArrayBuffer(getTestServerUrl(server), {}, {
      onProgress: () => {},
      idleTimeoutMs: 1000,
      totalTimeoutMs: 500,
    });
    assert.strictEqual(Buffer.from(arrayBuffer).toString(), 'ID3-valid-test-audio');
  } finally {
    await stopTestServer(server);
  }
}
async function testMediaDownloadTotalTimeoutSpansRedirects() {
  const plugin = new PluginClass();
  const server = await startTestServer((request, response) => {
    const hop = Number(new URL(request.url, 'http://127.0.0.1').searchParams.get('hop') || 0);
    setTimeout(() => {
      if (hop < 2) {
        response.writeHead(302, { Location: `/media?hop=${hop + 1}` });
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      response.end('ID3-valid-test-audio');
    }, 55);
  });
  try {
    const error = await plugin.downloadArrayBuffer(getTestServerUrl(server, '/media?hop=0'), {}, {
      onProgress: () => {},
      idleTimeoutMs: 1000,
      totalTimeoutMs: 90,
    }).then(() => null, (reason) => reason);
    assert(error && error.code === 'MEDIA_DOWNLOAD_TIMEOUT', '总时限必须跨重定向累计，不能在每一跳重新计时');
  } finally {
    await stopTestServer(server);
  }
}

async function testMediaDownloadInterruptedResponseFailsImmediately() {
  const plugin = new PluginClass();
  const server = await startTestServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    response.write('ID3-partial');
    setTimeout(() => response.destroy(), 20);
  });
  try {
    const error = await plugin.downloadArrayBuffer(getTestServerUrl(server), {}, {
      onProgress: () => {},
      idleTimeoutMs: 1000,
      totalTimeoutMs: 500,
    }).then(() => null, (reason) => reason);
    assert(error && error.code === 'MEDIA_DOWNLOAD_INTERRUPTED', '中途断流必须立即结束下载并留下可诊断错误');
  } finally {
    await stopTestServer(server);
  }
}
async function testDouyinRefreshRecoveryStopsAfterThreeCandidates() {
  const plugin = new PluginClass();
  const directAttempts = [];
  plugin.downloadArrayBuffer = async (url) => {
    directAttempts.push(url);
    throw new Error('媒体下载失败：HTTP 403');
  };
  plugin.downloadMediaArrayBufferWithSession = async () => {
    throw new Error('媒体下载失败：HTTP 403');
  };
  plugin.refreshDouyinMediaUrls = async () => [
    'https://v3-dy-o.zjcdn.com/candidate-1.mp4',
    'https://v3-dy-o.zjcdn.com/candidate-2.mp4',
    'https://v3-dy-o.zjcdn.com/candidate-3.mp4',
    'https://v3-dy-o.zjcdn.com/candidate-4.mp4',
  ];

  const error = await plugin.downloadMediaToTempFile(
    'https://v3-dy-o.zjcdn.com/primary.mp4',
    { sourceUrl: 'https://www.douyin.com/video/123' },
  ).then(() => null, (reason) => reason);

  assert(error, '所有候选都失败时必须返回失败');
  assert.deepStrictEqual(directAttempts, [
    'https://v3-dy-o.zjcdn.com/primary.mp4',
    'https://v3-dy-o.zjcdn.com/candidate-1.mp4',
    'https://v3-dy-o.zjcdn.com/candidate-2.mp4',
    'https://v3-dy-o.zjcdn.com/candidate-3.mp4',
  ], '刷新地址最多尝试 3 个候选，避免下载恢复链路无限拉长');
}
async function testDouyinRefreshRespectsRemainingDownloadBudget() {
  const plugin = new PluginClass();
  const originalNow = Date.now;
  let simulatedNow = 0;
  Date.now = () => simulatedNow;
  try {
    plugin.downloadArrayBuffer = async () => {
      simulatedNow = (15 * 60 * 1000) - 1;
      throw new Error('媒体下载失败：HTTP 403');
    };
    plugin.downloadMediaArrayBufferWithSession = async () => {
      throw new Error('媒体下载失败：HTTP 403');
    };
    plugin.refreshDouyinMediaUrls = async () => new Promise(() => {});

    const outcome = await Promise.race([
      plugin.downloadMediaToTempFile(
        'https://v3-dy-o.zjcdn.com/primary.mp4',
        { sourceUrl: 'https://www.douyin.com/video/123' },
      ).then(() => null, (error) => error),
      new Promise((resolve) => setTimeout(() => resolve('test-timeout'), 100)),
    ]);
    assert(outcome && outcome.code === 'MEDIA_DOWNLOAD_TIMEOUT', '刷新抖音地址也必须受整次下载剩余时限约束');
  } finally {
    Date.now = originalNow;
  }
}

async function testInvalidBindingIsPausedButGeneric403IsNot() {
  const createPlugin = (message) => {
    const plugin = new PluginClass();
    plugin.settings = PluginClass.__test.mergeSettings({
      token: 'BOUND-1',
      clientId: 'client-1',
      bindings: [{ token: 'BOUND-1', label: '微信 1', enabled: true, status: 'bound' }],
    });
    plugin.showSyncProgress = () => {};
    plugin.clearSyncProgressNotice = () => {};
    plugin.saveData = async () => {};
    plugin.syncBinding = async () => { throw new Error(message); };
    return plugin;
  };

  const invalidPlugin = createPlugin('绑定码未绑定或已失效，请重新绑定');
  await invalidPlugin.syncInbox(false);
  assert.strictEqual(invalidPlugin.settings.bindings[0].status, 'needs_rebind');
  assert.strictEqual(invalidPlugin.settings.bindings[0].enabled, false);

  const genericPlugin = createPlugin('Request failed, status 403');
  await genericPlugin.syncInbox(false);
  assert.strictEqual(genericPlugin.settings.bindings[0].status, 'bound');
  assert.strictEqual(genericPlugin.settings.bindings[0].enabled, true);
}

async function run() {
  const helpers = PluginClass.__test;
  assert.strictEqual(helpers.mergeSettings({}).xiaohongshuImageOcrEnabled, false);
  assert.strictEqual(helpers.mergeSettings({
    settingsVersion: 2,
    xiaohongshuImageOcrEnabled: true,
    xiaohongshuImageOcrConsentVersion: 1,
  }).xiaohongshuImageOcrEnabled, true);
  await testDouyin403UsesSessionFallback();
  await testDouyinMediaDownloadTimeoutUsesSessionFallback();
  await testMediaDownloadNormalResponseStillCompletes();
  await testMediaDownloadTotalTimeoutSpansRedirects();
  await testMediaDownloadInterruptedResponseFailsImmediately();
  await testDouyinRefreshRecoveryStopsAfterThreeCandidates();
  await testDouyinRefreshRespectsRemainingDownloadBudget();
  assert.strictEqual(
    helpers.shouldBypassExistingLocalNoteDedupe({
      type: 'webpage',
      content: 'https://v.douyin.com/repeat',
      metadata: { url: 'https://v.douyin.com/repeat' },
    }),
    true,
    '旧版未标记 audio_video 的抖音记录也不能被本地同链接笔记去重挡住',
  );
  assert.strictEqual(
    helpers.shouldBypassExistingLocalNoteDedupe({
      type: 'note',
      content: '收藏这个链接：https://v.douyin.com/not-a-media-record',
      metadata: {},
    }),
    false,
    '普通文本即使含抖音链接，也不能绕过本地笔记去重',
  );
  assert.strictEqual(
    helpers.shouldBypassExistingLocalNoteDedupe({
      type: 'webpage',
      content: 'https://example.com/article',
      metadata: { url: 'https://example.com/article' },
    }),
    false,
    '普通网页不能因本轮旧抖音兼容规则绕过本地笔记去重',
  );
  assert.strictEqual(
    helpers.shouldBypassExistingLocalNoteDedupe({
      type: 'voice',
      content: 'https://v.douyin.com/voice-with-link',
      metadata: {},
    }),
    true,
    '语音记录本身仍按既有规则允许重复转写',
  );
  await testInvalidBindingIsPausedButGeneric403IsNot();
  console.log('plugin local candidate regression tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
