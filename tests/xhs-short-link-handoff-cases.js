'use strict';

// Exercise the published writeRecord entry with synthetic public links.

const assert = require('node:assert/strict');

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const cwd=path.resolve(__dirname,'..'); const mode='after'; const filename=path.resolve(__dirname,'../main.js'); const code=fs.readFileSync(filename,'utf8');
const canonical = 'https://www.xiaohongshu.com/explore/abcdef0123456789abcdef01';
const external = 'https://outside.invalid/synthetic';
const recent = '2026-11-16T01:00:00Z';
const old = '2026-11-14T01:00:00Z';
const unavailable = 'XIAOHONGSHU_CONTENT_UNAVAILABLE';
const queued = 'CLOUD_FALLBACK_QUEUED';
const uncertain = 'CLOUD_FALLBACK_SUBMISSION_UNCERTAIN';
function networkFailure() {
  return Object.assign(new Error('net::ERR_CONNECTION_RESET'), { code: 'ECONNRESET' });
}

function fixtureClass(item, calls) {
  function mockRequest(target, options, callback) {
    const uri = new URL(target);
    calls.redirect.push({ method: options.method, host: uri.hostname });
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      if (item.redirect === 'offline') return req.emit('error', networkFailure());
      const location = uri.hostname === 'xhslink.cn' ? (item.redirect === 'external' ? external : canonical) : '';
      callback({ statusCode: location ? 302 : 200, headers: location ? { location } : {}, resume() {} });
    });
    return req;
  }
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'obsidian') return {
      Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, Modal: class {},
      requestUrl: async () => { throw networkFailure(); },
    };
    if (['http', 'https', 'node:http', 'node:https'].includes(name)) {
      return { ...originalLoad.call(this, name, ...args), request: mockRequest };
    }
    return originalLoad.call(this, name, ...args);
  };
  try {
    const entry = new Module(filename, module);
    entry.filename = filename;
    entry.paths = Module._nodeModulePaths(cwd);
    entry._compile(code, filename);
    return entry.exports;
  } finally { Module._load = originalLoad; }
}

async function runCase(item) {
  const calls = { redirect: [], statics: [], browser: [], gates: 0, submissions: [], writes: 0 };
  const Plugin = fixtureClass(item, calls);
  const plugin = new Plugin();
  const controller = new AbortController();
  const binding = { token: 'synthetic-binding' };
  const uri = (item.scheme || 'http') + '://xhslink.cn/o/syntheticReview123';
  const record = { _id: 'fixture-record', retryCount: 2, type: 'text', createdAt: item.date || recent, content: 'Share ' + uri + ' ' };
  plugin.settings = Plugin.__test.mergeSettings({ aiProvider: 'local', cloudFallbackEnabled: true, xiaohongshuCommentsEnabled: false });
  plugin.showSyncProgress = () => {};
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => 'fixture';
  plugin.getRecentXiaohongshuBrowserResults = () => [];
  plugin.hasProFeatureAccess = async () => true;
  plugin.collectXiaohongshuMediaUrlsWithSession = async () => [];
  plugin.probeXiaohongshuMediaUrls = async () => [];
  plugin.requestXiaohongshuStaticPage = async (url) => {
    calls.statics.push(new URL(url).hostname);
    if (item.cancel) {
      controller.abort();
      throw Object.assign(new Error('Synthetic cancellation'), { name: 'AbortError' });
    }
    if (item.status) throw Object.assign(new Error('Request failed, status ' + item.status), { status: item.status });
    if (item.page) {
      const terminal = item.page === 'deleted';
      return {
        url: terminal ? 'https://www.xiaohongshu.com/404' : 'https://www.xiaohongshu.com/explore',
        status: terminal ? 404 : 200,
        text: terminal ? '<html><body>你访问的页面不见了</body></html>' : '<html><title>小红书 - 你的生活兴趣社区</title><body>打开小红书阅读</body></html>',
      };
    }
    throw networkFailure();
  };
  plugin.renderXiaohongshuPage = async (url) => {
    calls.browser.push(new URL(url).hostname);
    throw networkFailure();
  };
  plugin.evaluateCloudFallbackUserGate = async () => {
    calls.gates++;
    return item.deny ? { allowed: false, code: 'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED', message: 'Synthetic eligibility denial' } : { allowed: true };
  };
  plugin.submitCloudFallbackJob = async (payload) => {
    calls.submissions.push(payload);
    if (item.uncertain) throw Object.assign(new Error('Synthetic uncertain response'), { code: uncertain });
    return { jobId: 'fixture-job', status: 'queued' };
  };
  plugin.app = { vault: { adapter: { write: async () => { calls.writes++; } } } };
  assert.equal(Plugin.__test.selectAutomaticWebpageUrlFromText(record.content), uri);
  assert.equal(Plugin.__test.isXiaohongshuUrl(uri), true);
  let outcome;
  try {
    await plugin.writeRecord(record, recent, binding, false, { skipAi: true, signal: controller.signal });
    outcome = 'resolved';
  } catch (e) { outcome = e.code || e.name; }
  assert.ok(calls.redirect.length > 0);
  assert.ok(calls.redirect.every(call => ['xhslink.cn', 'www.xiaohongshu.com'].includes(call.host)));
  assert.ok([...calls.statics, ...calls.browser].every(host => ['xhslink.cn', 'www.xiaohongshu.com'].includes(host)));
  if (item.redirect === 'external') assert.equal(calls.statics.length + calls.browser.length, 0);
  for (const payload of calls.submissions) {
    assert.equal(payload.sourceType, 'xiaohongshu_url');
    assert.equal(payload.sourceUrl, uri);
    assert.equal(payload.recordId, record._id);
    assert.equal(payload.retryCount, record.retryCount);
    assert.equal(payload.binding, binding);
    assert.equal(payload.signal, controller.signal);
  }
  const handoff = item.redirect === 'external' ? mode !== 'old' : mode === 'after' && !item.date && !item.page && !item.status && !item.cancel;
  const submissions = Number(handoff && !item.deny);
  const expected = item.cancel ? 'AbortError' : submissions ? (item.uncertain ? uncertain : queued) : unavailable;
  assert.deepEqual({ outcome, gates: calls.gates, submissions: calls.submissions.length, writes: calls.writes },
    { outcome: expected, gates: Number(handoff), submissions, writes: 0 });
}

const cases = [
  { name: 'redirect and page transports exhausted', redirect: 'offline' },
  { name: 'https short link', redirect: 'offline', scheme: 'https' },
  { name: 'official redirect followed by page network failure', redirect: 'canonical' },
  { name: 'existing external redirect handoff', redirect: 'external' },
  { name: 'old record receives no new handoff', redirect: 'offline', date: old },
  { name: 'denied eligibility', redirect: 'offline', deny: true },
  { name: 'uncertain create', redirect: 'offline', uncertain: true },
  { name: 'user cancelled', redirect: 'offline', cancel: true },
  { name: 'forbidden static response followed by browser reset', redirect: 'canonical', status: 403 },
  { name: 'gone static response followed by browser reset', redirect: 'canonical', status: 410 },
  { name: 'empty official landing page', redirect: 'canonical', page: 'landing' },
  { name: 'deleted official note page', redirect: 'canonical', page: 'deleted' },
];
module.exports=async function verifyXhsTransportHandoff(){for(const item of cases) await runCase(item);};
