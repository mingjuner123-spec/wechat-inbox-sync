'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { getXiaohongshuRuntimeSnapshotExpression: expression } = require('../obsidian-plugin/wechat-inbox-sync/src/xiaohongshu-runtime-snapshot');
const id = 'abcdef0123456789abcdef01';
const otherId = '111111112222222233333333';
const url = `https://www.xiaohongshu.com/explore/${id}`;
const media = 'https://sns-video-v6.xhscdn.com/stream/synthetic-target.mp4';
const note = (extra = {}) => ({ noteId: id, title: '目标视频', desc: '这是真正目标笔记的正文', ...extra });
const state = value => ({ note: { noteDetailMap: { [id]: { note: value } } }, user: { token: 'DO_NOT_EXPORT_ACCOUNT' }, feed: [{ noteId: otherId, videoUrl: 'https://example.com/recommend.mp4' }] });
function read(value, pageUrl = url, expectedId = id) {
  return vm.runInNewContext(expression(expectedId), { URL, location: { href: pageUrl }, window: { __INITIAL_STATE__: value } }, { timeout: 1000 });
}
let html = '<html><body><article>页面已经显示笔记，但 HTML 中没有序列化状态</article></body></html>';
let currentState = state(note({ type: 'video', video: { media: { stream: { h264: [{ masterUrl: media }] } } } }));
let samples = 0;
let destroyed = 0;
let scenario = () => currentState;
const handlers = {};
const session = { cookies: { get: async () => [] }, webRequest: { onBeforeRequest: (_filter, listener) => { handlers.before = listener; } } };
class BrowserWindow extends EventEmitter {
  constructor() {
    super();
    this.webContents = new EventEmitter();
    Object.assign(this.webContents, {
      session, getURL: () => url, setWindowOpenHandler() {}, isDestroyed: () => false,
      executeJavaScript: async script => {
        samples++;
        return vm.runInNewContext(script, {
          URL, location: { href: url }, window: { __INITIAL_STATE__: scenario(samples) },
          document: { documentElement: { outerHTML: html }, querySelectorAll: () => [] },
        }, { timeout: 1000 });
      },
    });
  }
  loadURL() { setImmediate(() => this.webContents.emit('did-finish-load')); return Promise.resolve(); }
  isDestroyed() { return false; }
  hide() {}
  destroy() { destroyed++; }
}
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, Setting: class {} };
  if (name === 'electron') return { remote: { BrowserWindow, session: { fromPartition: () => session } }, session: { fromPartition: () => session } };
  return originalLoad.call(this, name, parent, isMain);
};
const Plugin = require(process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main.js');
const h = Plugin.__test;
function primary(html, url) { const value = h.extractXiaohongshuMarkdownFromHtml(html, url, '', { includeComments: false }); return { ...value, matched: value.xiaohongshuPrimaryNoteMatched }; }
global.window = { setTimeout, clearTimeout };

async function run() {
  const serialized = read(currentState);
  assert.equal(primary(html, url).matched, false, 'baseline HTML alone loses runtime state');
  assert.equal(primary(serialized, url).videoUrl, media);
  assert.ok(!serialized.includes('DO_NOT_EXPORT_ACCOUNT'));
  assert.ok(!serialized.includes('recommend.mp4'));
  assert.equal(read(state(note({ noteId: otherId, videoUrl: media }))), '');
  assert.equal(read(currentState, url.replace(id, otherId)), '');
  assert.equal(read(currentState, 'https://www.xiaohongshu.com/login'), '');
  assert.equal(primary(read(currentState, 'https://www.xiaohongshu.com/'), url).videoUrl, media, 'known target identity survives trusted root landing');
  assert.equal(read(currentState, 'https://www.xiaohongshu.com/', ''), '');
  assert.equal(read(currentState, 'https://www.xiaohongshu.com/user/profile/someone'), '');
  const tokenState = state(note({ video: { masterUrl: media, xsecToken: 'PRIVATE_FIELD', xsec_token: 'PRIVATE_FIELD' } }));
  assert.ok(!read(tokenState).includes('PRIVATE_FIELD'));
  assert.equal(read(currentState, url.replace('xiaohongshu.com', 'xiaohongshu.com.evil.test')), '');
  assert.equal(read(currentState, url.replace('https:', 'http:')), '');
  assert.equal(read(currentState, url.replace('https://', 'https://user:pass@')), '');
  assert.equal(read(currentState, url.replace('.com/', '.com:444/')), '');
  assert.equal(primary(read(currentState, url, ''), url).videoUrl, media, 'shortlink final route can supply identity');
  assert.equal(read(state(note({ desc: 'x'.repeat(100001) }))), '');
  const cyclic = note({ type: 'video', video: { masterUrl: media } });
  cyclic.video.self = cyclic.video;
  assert.equal(primary(read(state(cyclic)), url).videoUrl, media);
  const throwing = {}; Object.defineProperty(throwing, 'note', { get() { throw new Error('state unavailable'); } });
  assert.equal(read(throwing), '');
  assert.equal(read(state(note({ imageList: new Array(1001).fill('x') }))), '');
  const escaping = read(state(note({ desc: '文字 </script><script>unexpected()</script>' })));
  assert.ok(!escaping.includes('<script>unexpected'));
  assert.ok(escaping.includes('\\u003c'));

  const selected = h.selectXiaohongshuBrowserSnapshot(null, { html, runtimeHtml: serialized, url }, url);
  assert.equal(selected.matched, true, 'candidate must consume runtime state');
  const partialRuntime = read(state(note({ type: 'video', video: {} })));
  const retainedMedia = h.selectXiaohongshuBrowserSnapshot(null, { html: serialized, runtimeHtml: partialRuntime, url }, url);
  assert.equal(primary(retainedMedia.html, url).videoUrl, media, 'partial runtime must not discard ready target media in HTML');
  assert.equal(primary(selected.html, url).videoUrl, media);
  assert.equal(h.selectXiaohongshuBrowserSnapshot(null, { html: '', runtimeHtml: serialized, url: 'https://www.xiaohongshu.com/' }, url).matched, true);
  assert.equal(h.selectXiaohongshuBrowserSnapshot(null, { html: '', runtimeHtml: serialized, url: 'https://www.xiaohongshu.com/' }, '').matched, false);
  assert.equal(h.selectXiaohongshuBrowserSnapshot(null, { html, runtimeHtml: serialized, url, accessWall: true }, url).matched, false);
  assert.equal(h.selectXiaohongshuBrowserSnapshot(null, { html, runtimeHtml: serialized, url: url.replace(id, otherId) }, url).matched, false);

  samples = 0;
  const trace = h.createXiaohongshuBrowserDiagnostic({ _id: 'synthetic' });
  const rendered = await h.renderXiaohongshuPageWithElectron(url, { includeComments: false, expectedUrl: url, xiaohongshuBrowserDiagnostic: trace });
  assert.equal(primary(rendered.html, url).videoUrl, media);
  assert.equal(samples, 1);
  assert.equal(handlers.before, null, 'renderer releases request filter');
  assert.equal(destroyed, 1);

  // Execute the real bundle-generated renderer script while the page hydrates.
  samples = 0;
  scenario = n => n < 3 ? state(note({ imageList: ['https://sns-img-qc.xhscdn.com/cover.jpg'] })) : currentState;
  const delayed = await h.renderXiaohongshuPageWithElectron(url, { includeComments: false, expectedUrl: url });
  assert.equal(samples, 3, 'cover/title alone must not close the window before video arrives');
  assert.equal(primary(delayed.html, url).videoUrl, media);
  samples = 0;
  scenario = n => n < 3 ? state(note({ type: 'video', video: {} })) : currentState;
  const declared = await h.renderXiaohongshuPageWithElectron(url, { includeComments: false, expectedUrl: url });
  assert.equal(samples, 3, 'declared video must wait for media');
  assert.equal(primary(declared.html, url).videoUrl, media);
  samples = 0;
  scenario = () => state(note({ type: 'normal', imageList: ['https://sns-img-qc.xhscdn.com/graphic.jpg'] }));
  const graphic = await h.renderXiaohongshuPageWithElectron(url, { includeComments: false, expectedUrl: url });
  assert.equal(samples, 1, 'confirmed graphic notes keep the fast path');
  assert.equal(primary(graphic.html, url).isVideoNote, false);

  samples = 0;
  scenario = n => n < 3 ? state(note({ imageList: ['https://sns-img-qc.xhscdn.com/cover.jpg'] })) : currentState;
  const plugin = new Plugin();
  plugin.settings = h.mergeSettings({ aiProvider: 'off', settingsVersion: 2, xiaohongshuCommentsEnabled: false });
  plugin.manifest = { version: '1.3.168' };
  plugin.getConfiguredLocalAsrInstallRoot = plugin.getConfiguredLocalOcrInstallRoot = () => path.resolve(__dirname, '../.artifacts/xhs-runtime-media-20260928/synthetic-components');
  plugin.getConfiguredLocalAsrPlatform = () => 'windows';
  plugin.getLocalAsrInstallStatus = plugin.getLocalOcrInstallStatus = () => ({ ready: true });
  plugin.getActiveBindings = plugin.getRecentSyncFailureCleanupErrors = () => [];
  plugin.hasProFeatureAccess = async () => true;
  plugin.enrichXiaohongshuExtractionWithOcr = async value => value;
  plugin.requestXiaohongshuStaticPage = async () => ({ status: 200, url, text: '<title>登录-小红书</title><body>手机号登录 扫码登录</body>' });
  plugin.renderSocialMediaUrls = async () => { throw new Error('must use target runtime media without generic media scan'); };
  let transcriptions = 0;
  plugin.runConfiguredTranscription = async selectedMedia => {
    assert.equal(selectedMedia, media);
    transcriptions++;
    return { transcription: '这是本条视频的口播文字', source: 'local' };
  };
  const result = await plugin.hydrateWebpageMarkdown({ _id: 'runtime-only', type: 'webpage', content: url, metadata: { url } }, '', '', '视频');
  assert.equal(transcriptions, 1, 'video without an incoming audio_video hint must reach ASR');
  assert.equal(result.metadata.transcription, '这是本条视频的口播文字');
  assert.equal(result.metadata.transcriptionStatus, 'success');
  assert.equal(result.metadata.mediaResolutionDiagnostic.transcriptionStarted, true);
  console.log('xhs runtime snapshot regression passed (renderer + delayed hydration + ASR path + negative boundaries)');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; });
