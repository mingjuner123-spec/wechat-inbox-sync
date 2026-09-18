'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { EventEmitter } = require('events');
const source = fs.readFileSync(process.env.DOUYIN_TEST_SOURCE || path.join(__dirname, '../obsidian-plugin/wechat-inbox-sync/src/main.js'), 'utf8');
const start = source.indexOf('function installDouyinExtractionNavigationGuards(');
assert(start >= 0, 'dedicated Douyin extraction guard must exist');
const end = source.indexOf('function createXiaohongshuBrowserDiagnostic(', start);
const context = { URL }; vm.createContext(context); vm.runInContext(source.slice(start, end), context);
const target = new EventEmitter(), unrelated = new EventEmitter(), login = new EventEmitter();
let externalOpens = 0, unrelatedOpens = 0, loginOpens = 0;
for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) target.on(name, () => externalOpens++);
unrelated.on('will-navigate', () => unrelatedOpens++);
login.on('will-navigate', () => loginOpens++);
target.setWindowOpenHandler = fn => { target.openHandler = fn; };
const listeners = target.listeners.bind(target);
target.listeners = name => listeners(name).map(fn => (...args) => fn(...args));
context.installDouyinExtractionNavigationGuards(target, 'https://www.douyin.com/video/123');
const navigate = (name, url, format) => {
  const event = { blocked: false, preventDefault() { this.blocked = true; } };
  if (format === 'event') { event.url = url; target.emit(name, event); }
  else target.emit(name, event, format === 'details' ? { url } : url);
  return event.blocked;
};
for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
  for (const format of ['string', 'details', 'event']) {
    for (const url of ['https://www.douyin.com/video/123', 'https://v.douyin.com/example/', 'https://www.iesdouyin.com/share/video/123', 'https://www.amemv.com/share/video/123']) assert.equal(navigate(name, url, format), false);
    for (const url of ['https://douyin.com.evil.test/', 'https://evildouyin.com/', 'http://www.douyin.com/', 'https://user:pass@www.douyin.com/', 'https://www.douyin.com:444/', 'file:///secret', 'javascript:alert(1)', 'snssdk1128://foo', 'bytedance://foo', 'https://example.com/', 'invalid']) assert.equal(navigate(name, url, format), true, name + ' ' + format + ' ' + url);
  }
}
assert.equal(externalOpens, 0, 'inherited handlers cannot forward redirects to the OS browser');
assert.equal(target.openHandler({ url: 'https://www.douyin.com/' }).action, 'deny');
unrelated.emit('will-navigate', {}); login.emit('will-navigate', {});
assert.equal(unrelatedOpens, 1); assert.equal(loginOpens, 1);
assert.throws(() => context.installDouyinExtractionNavigationGuards({}), /无法隔离/);
assert.throws(() => context.installDouyinExtractionNavigationGuards(target, 'https://evil.test/?douyin.com'), /官方 HTTPS/);
const renderer = source.slice(source.indexOf('async function renderSocialMediaUrlsWithElectron('), source.indexOf('async function renderXiaohongshuContentWithElectron('));
assert(renderer.includes('installDouyinExtractionNavigationGuards(win.webContents, url)'));
assert(renderer.indexOf('installDouyinExtractionNavigationGuards(win.webContents, url)') < renderer.indexOf('beginBestEffortBrowserLoad(win, url)'));
assert(renderer.includes('win.destroy();'));
async function lifecycleTests() {
  for (const mode of ['success', 'initial-url', 'guard-failure', 'guard-install', 'load-failure', 'cancelled', 'timeout']) {
    const counts = { loads: 0, destroyed: 0, abortCleaned: 0, childrenCleaned: 0, closed: 0, detached: 0 };
    const handlers = {};
    const session = { webRequest: {} };
    for (const name of ['onBeforeRequest', 'onHeadersReceived', 'onBeforeRedirect', 'onCompleted']) {
      session.webRequest[name] = (_filter, fn) => { handlers[name] = fn; };
    }
    let win;
    class Window extends EventEmitter {
      constructor() {
        super(); win = this;
        this.webContents = Object.assign(new EventEmitter(), {
          session, setWindowOpenHandler() {},
          executeJavaScript: async () => ({ urls: [] }),
          debugger: Object.assign(new EventEmitter(), {
            attach() {}, sendCommand: async () => {},
            detach() { counts.detached++; },
          }),
        });
        if (mode === 'guard-failure') this.webContents.setWindowOpenHandler = undefined;
        if (mode === 'guard-install') this.webContents.setWindowOpenHandler = () => { throw Error('guard installation failed'); };
      }
      hide() {}
      isDestroyed() { return false; }
      destroy() { counts.destroyed++; }
    }
    const sandbox = {
      URL, Date, Map, Buffer,
      isDouyinUrl: () => true, isXiaohongshuUrl: () => false,
      getElectronBrowserWindow: () => Window, getDouyinSession: () => session,
      installDouyinExternalProtocolHandlers: async () => {},
      trackDouyinBrowserWindow() {},
      installHiddenBrowserChildWindowGuards: () => () => { counts.childrenCleaned++; },
      bindBrowserWindowToAbortSignal: () => () => { counts.abortCleaned++; },
      extractDouyinAwemeId: () => '123',
      throwIfAborted(signal) { if (signal?.aborted) throw Object.assign(Error('cancelled'), { name: 'AbortError' }); },
      waitForWebContents: async () => {},
      beginBestEffortBrowserLoad() { counts.loads++; return mode !== 'load-failure'; },
      waitAndRetryDouyinChallengePage: async () => false,
      buildDouyinDomIdentityExtractorScript: () => '',
      waitForBrowserTasksWithin: async () => {},
      resolveDouyinMediaFromShareHtml: () => ({ exactUrls: [], primaryUrls: [] }),
      selectPrimaryDouyinDomMediaUrls: () => [], normalizeBrowserCapturedMediaUrls: () => [],
      BROWSER_MEDIA_CAPTURE_MAX_REQUESTS: 100, BROWSER_MEDIA_CAPTURE_MAX_URLS: 100,
      douyinBrowserSafety: {
        LIMITS: {},
        createResponseBudget: () => ({ snapshot: () => ({}) }),
        attachGuard: () => ({
          async run(promise, phase) {
            if (phase === 'page-load' && mode === 'timeout') throw Error('timeout');
            if (phase === 'page-load' && mode === 'cancelled') throw Object.assign(Error('cancelled'), { name: 'AbortError' });
            return await promise;
          },
          emit() {}, close() { counts.closed++; },
        }),
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(source.slice(start, end) + '\n' + renderer, sandbox);
    const promise = sandbox.renderSocialMediaUrlsWithElectron(mode === 'initial-url' ? 'https://evil.test/?douyin.com' : 'https://www.douyin.com/video/123', { __douyinSessionLockHeld: true });
    if (mode === 'success') await promise;
    else await assert.rejects(promise, mode === 'initial-url' ? /官方 HTTPS/ : mode === 'guard-install' ? /guard installation failed/ : mode === 'guard-failure' ? /无法隔离/ : mode === 'load-failure' ? /未能开始加载/ : new RegExp(mode === 'cancelled' ? 'cancelled' : 'timeout'));
    assert.equal(counts.loads, ['initial-url', 'guard-failure', 'guard-install'].includes(mode) ? 0 : 1, mode);
    for (const name of ['destroyed', 'abortCleaned', 'childrenCleaned', 'closed', 'detached']) assert.equal(counts[name], 1, mode + ': ' + name);
    for (const fn of Object.values(handlers)) assert.equal(fn, null, mode + ': network listener released');
    assert.equal(win.webContents.debugger.listenerCount('message'), 0, mode);
    assert.equal(win.listenerCount('show'), 0, mode);
    assert.equal(win.listenerCount('ready-to-show'), 0, mode);
  }
}
lifecycleTests().then(() => console.log('PASS: Douyin navigation remains hidden and isolated; success, guard failure, load failure, cancellation and timeout release resources.')).catch(error => { console.error(error); process.exitCode = 1; });
