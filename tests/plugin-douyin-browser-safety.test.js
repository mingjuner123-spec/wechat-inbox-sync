'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const safety = require('../obsidian-plugin/wechat-inbox-sync/src/douyin-browser-safety');

const url = 'https://www.douyin.com/video/7685198123559390506';
const media = 'https://v3.douyinvod.com/fixture.mp4';
let mode = 'success', debuggerHang = false, windowId = 20, extractionEntered, lastWindow, capturedScript = '', attempts = 0;
const handlers = {};
const session = { webRequest: {}, cookies: { async get() { return []; } } };
for (const name of ['onBeforeRequest', 'onHeadersReceived', 'onBeforeRedirect', 'onCompleted', 'onBeforeSendHeaders', 'onErrorOccurred']) session.webRequest[name] = (_filter, fn) => { handlers[name] = fn; };
class Window extends EventEmitter {
  constructor(options = {}) {
    super(); attempts++; lastWindow = this; this.options = options; this.destroyed = false;
    this.webContents = Object.assign(new EventEmitter(), {
      id: ++windowId, session, setAudioMuted: muted => { this.muted = muted; }, setWindowOpenHandler() {}, setUserAgent() {}, getURL: () => url,
      executeJavaScript: async script => {
        if (!script.includes('const collect =')) return false;
        capturedScript = script;
        extractionEntered?.(this);
        if (mode !== 'success') return new Promise(() => {});
        return { pageUrl: url, canonicalUrl: url, pageIdentityIds: ['7685198123559390506'], urls: [{ url: media, resourceType: 'media' }], domMediaCandidates: [{ urls: [media], identityIds: ['7685198123559390506'], visible: true, intersectsViewport: true, area: 100000, isPlaying: false }], douyinPaceState: '' };
      },
    });
    if (debuggerHang) {
      let attached = false;
      this.webContents.debugger = Object.assign(new EventEmitter(), {
        isAttached: () => attached, attach: () => { attached = true; },
        detach: () => { attached = false; }, sendCommand: () => new Promise(() => {}),
      });
    }
  }
  hide() {}
  isDestroyed() { return this.destroyed; }
  destroy() { if (this.destroyed) return; this.destroyed = true; this.webContents.emit('destroyed'); this.emit('closed'); }
  async loadURL() {
    assert.equal(this.muted, true, 'whole window must already be muted before navigation');
    assert.equal(this.options.webPreferences.autoplayPolicy, 'user-gesture-required');
    assert.equal(this.options.webPreferences.webgl, false);
    let response;
    handlers.onBeforeRequest({ webContentsId: this.webContents.id, url: media, resourceType: 'media' }, r => { response = r; });
    assert.equal(response.cancel, true, 'own media is captured before bytes enter the decoder');
    handlers.onBeforeRequest({ webContentsId: this.webContents.id + 500, url: media, resourceType: 'media' }, r => { response = r; });
    assert.notEqual(response.cancel, true, 'other login/page media must remain unaffected');
    handlers.onHeadersReceived({ webContentsId: this.webContents.id, url: 'https://example.test/opaque', responseHeaders: { 'Content-Type': ['video/mp4'] } }, r => { response = r; });
    assert.equal(response.cancel, true, 'opaque fetch media is blocked based on MIME');
    setImmediate(() => this.webContents.emit('did-finish-load'));
  }
}
const originalLoad = Module._load;
const previousWindow = global.window;
global.window = { setTimeout: (fn, ms) => setTimeout(fn, ms === 2500 ? 0 : ms), clearTimeout }; 
let Plugin;
Module._load = function(id, parent, main) {
  if (id === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {} };
  if (id === 'electron') return { remote: { BrowserWindow: Window, session: { fromPartition() { return session; } } } };
  return originalLoad.call(this, id, parent, main);
};
Plugin = require('../obsidian-plugin/wechat-inbox-sync/main');

const bounded = async promise => { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('test exceeded two seconds')), 2000); })]); } finally { clearTimeout(timer); } };
async function run() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-browser-safe-'));
  let cases = 0;
  try {
    const plugin = new Plugin(); plugin.settings = {}; plugin.getConfiguredLocalAsrInstallRoot = () => scratch;
    const result = await bounded(plugin.renderSocialMediaUrls(url)); assert.ok(result.includes(media)); cases++;
    assert.equal(safety.readAttempts(scratch).at(-1).outcome, 'success'); assert.ok(safety.readAttempts(scratch).at(-1).blockedMedia >= 2); cases++;
    fs.mkdirSync(path.join(__dirname, '../.artifacts'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../.artifacts/douyin-extraction-script.js'), capturedScript);
    const domPayload = await require('node:vm').runInNewContext(capturedScript, {
      setTimeout: fn => setImmediate(fn), performance: { getEntriesByType: () => [] },
      self: {}, window: {}, location: { href: url },
      document: { documentElement: {}, body: {}, scripts: [], querySelectorAll: () => [], querySelector(selector) {
        if (selector.includes('og:url')) {
          assert.match(selector, /\[property=["']og:url["']\]/, 'CSS attribute values containing a colon must be quoted');
          return { content: url };
        }
        return null;
      } },
    });
    assert.equal(domPayload.canonicalUrl, url); cases++;
    debuggerHang = true;
    assert.ok((await bounded(plugin.renderSocialMediaUrls(url, { diagnosticAttemptId: 'abcdef0123456789' }))).includes(media));
    const fallback = safety.readAttempts(scratch).at(-1);
    assert.equal(fallback.debuggerStatus, 'timeout');
    assert.equal(fallback.pageLoaded, true);
    assert.equal(fallback.resolutionAttemptId, 'abcdef0123456789');
    assert.equal(lastWindow.webContents.debugger.isAttached(), false);
    debuggerHang = false; cases++;
    const c = new AbortController(); mode = 'hang'; extractionEntered = () => setImmediate(() => c.abort());
    await assert.rejects(bounded(plugin.renderSocialMediaUrls(url, { signal: c.signal })), { name: 'AbortError' });
    assert.equal(lastWindow.destroyed, true); assert.equal(safety.readAttempts(scratch).at(-1).outcome, 'cancelled'); cases++;
    mode = 'success'; extractionEntered = null; assert.ok((await bounded(plugin.renderSocialMediaUrls(url))).includes(media)); cases++;
    mode = 'gone'; extractionEntered = win => setImmediate(() => win.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: -1073741819 }));
    await assert.rejects(bounded(plugin.renderSocialMediaUrls(url)), error => error.code === 'EXTRACTION_FAILED' && error.browserCode === 'DOUYIN_BROWSER_RENDERER_GONE');
    const gone = safety.readAttempts(scratch).at(-1); assert.equal(gone.reason, 'oom'); assert.equal(gone.exitCode, -1073741819); assert.equal(gone.outcome, 'failed'); cases++;
    const count = attempts; await assert.rejects(plugin.renderSocialMediaUrls(url), error => error.browserCode === 'DOUYIN_BROWSER_COOLDOWN'); assert.equal(attempts, count); cases++;
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(plugin.renderSocialMediaUrls(url, { signal: cancelled.signal }), { name: 'AbortError' }); assert.equal(attempts, count); cases++;
    plugin.douyinBrowserRetryAfter = 0; mode = 'success'; extractionEntered = null; await bounded(plugin.renderSocialMediaUrls(url)); cases++;
    for (const timeoutOrGone of ['timeout', 'destroyed']) {
      const win = new Window(); const g = safety.attachGuard(win, { timeoutMs: 15 });
      const pending = g.run(new Promise(() => {}), 'media-extraction');
      if (timeoutOrGone === 'destroyed') win.webContents.emit('destroyed');
      await assert.rejects(bounded(pending), e => e.browserCode === (timeoutOrGone === 'timeout' ? 'DOUYIN_BROWSER_TIMEOUT' : 'DOUYIN_BROWSER_CLOSED'));
      g.close(); assert.equal(win.webContents.listenerCount('render-process-gone'), 0); cases++;
    }
    {
      const win = new Window(), events = [];
      const guard = safety.attachGuard(win, { onDiagnostic: e => events.push(e) });
      win.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', url, false);
      win.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', url, true);
      assert.equal(await guard.run(Promise.resolve('ok'), 'page-load'), 'ok');
      win.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', url, true);
      await assert.rejects(guard.run(Promise.resolve(), 'page-load'), e => e.browserCode === 'DOUYIN_BROWSER_LOAD_FAILED');
      assert.equal(events.at(-1).networkCode, 'ERR_NAME_NOT_RESOLVED');
      guard.close(); assert.equal(win.webContents.listenerCount('did-fail-load'), 0); cases++;
    }
    const rejected = []; const onUnhandled = error => rejected.push(error); process.on('unhandledRejection', onUnhandled);
    try {
      const win = new Window(); const guard = safety.attachGuard(win);
      win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
      await assert.rejects(guard.run(Promise.reject(Error('remote command rejected')), 'loading'), error => error.browserCode === 'DOUYIN_BROWSER_RENDERER_GONE');
      await new Promise(resolve => setImmediate(resolve)); guard.close(); assert.deepEqual(rejected, []); cases++;
    } finally { process.removeListener('unhandledRejection', onUnhandled); }
    const budget = safety.createResponseBudget(); for (let i = 0; i < 3; i++) assert.equal(budget.reserve(), true); assert.equal(budget.reserve(), false);
    for (let i = 0; i < 3; i++) budget.release();
    for (let i = 3; i < safety.LIMITS.responses; i++) { assert.equal(budget.reserve(), true); budget.release(); }
    assert.equal(budget.reserve(), false); assert.equal(budget.reserve(2e6), false); assert.equal(budget.accept({ body: 'x'.repeat(safety.LIMITS.responseBytes + 1) }), false); cases++;
    const total = safety.createResponseBudget(); for (let i = 0; i < 8; i++) assert.equal(total.accept({ body: 'x'.repeat(safety.LIMITS.responseBytes) }), true); assert.equal(total.accept({ body: 'x' }), false); cases++;
    const pendingAttempt = safety.createAttempt(scratch, 'https://host.test/?token=SECRET', { runtimeVersion: '1.3.152' }); pendingAttempt.update({ stage: 'media-extraction', body: 'PRIVATE', token: 'SECRET' });
    const restored = safety.readAttempts(scratch).at(-1); assert.equal(restored.stage, 'media-extraction'); assert.equal(restored.outcome, 'running');
    assert.ok(!JSON.stringify(safety.readAttempts(scratch)).includes('SECRET')); assert.ok(!JSON.stringify(safety.readAttempts(scratch)).includes('PRIVATE')); cases++;
    assert.equal(safety.ownsRequest({ url: media }, { id: 1 }), false); assert.equal(safety.isMediaRequest({ url: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=1', resourceType: 'xhr' }), false); cases++;
    console.log('Douyin browser safety: ' + cases + ' behavior cases passed');
  } finally { Module._load = originalLoad; global.window = previousWindow; fs.rmSync(scratch, { recursive: true, force: true }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
