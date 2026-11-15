'use strict';
// Exercise the shipped writeRecord entry; only transports, eligibility and vault I/O are stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const urls = {
  podcast: 'https://www.xiaoyuzhoufm.com/episode/0123456789abcdef01234567',
  channels: 'https://weixin.qq.com/sph/ABCDefg123',
};
const sourceTypes = { podcast: 'xiaoyuzhou_url', channels: 'wechat_channels_url' };
const failed = 'AUTOMATIC_WEBPAGE_EXTRACTION_FAILED';
const queued = 'CLOUD_FALLBACK_QUEUED';
const uncertain = 'CLOUD_FALLBACK_SUBMISSION_UNCERTAIN';
const newCreatedAt = '2026-11-16T01:00:00Z';
const oldCreatedAt = '2026-11-14T01:00:00Z';
const cutoff = '2026-11-15T19:00:00Z';

function loadPlugin({ code, filename }, requestUrl) {
  const original = Module._load;
  Module._load = function (name, ...args) {
    if (name === 'obsidian') return {
      Plugin: class {}, PluginSettingTab: class {}, Modal: class {}, Setting: class {}, Notice: class {}, requestUrl,
    };
    return original.call(this, name, ...args);
  };
  try {
    const entry = new Module(filename, module);
    entry.filename = filename;
    entry.paths = Module._nodeModulePaths(path.dirname(filename));
    entry._compile(code, filename);
    return entry.exports;
  } finally {
    Module._load = original;
  }
}

async function runCase(bundle, item) {
  const { platform, response, decision } = item;
  const controller = new AbortController();
  const url = urls[platform];
  const binding = { token: 'synthetic-test-binding' };
  const counters = { reads: 0, gates: 0, submits: 0, writes: 0 };
  const submissions = [];
  const seenGates = [];
  const observedInputs = [];
  const committedNotes = [];
  const storedResult = response === 'stored';
  const transcript = 'Synthetic persisted transcription for this record.';
  function localAttempt() {
    counters.reads++;
    if (response === 'cancel') {
      controller.abort();
      throw Object.assign(new Error('simulated connection error'), { code: 'ECONNRESET' });
    }
    if (response === '404') throw Object.assign(new Error('HTTP 404'), { status: 404, statusCode: 404 });
    if (response === 'transport') throw Object.assign(new Error('simulated connection reset'), { code: 'ECONNRESET' });
    return platform === 'podcast' ? { status: 200, text: '<html></html>' } : { success: true, data: {} };
  }
  const Plugin = loadPlugin(bundle, async (options) => {
    observedInputs.push([options.method, options.url]);
    return localAttempt();
  });
  const plugin = new Plugin();
  plugin.settings = Plugin.__test.mergeSettings({ cloudFallbackEnabled: true, saveOriginalMediaEnabled: false, aiProvider: 'local' });
  plugin.showSyncProgress = () => {};
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => 'fixture';
  plugin.nextTitle = async (_dir, title) => title;
  plugin.app = { vault: {
    adapter: { exists: async () => false, write: async () => { counters.writes++; }, remove: async () => {} },
    create: async (filePath, markdown) => { committedNotes.push({ filePath, markdown }); },
  } };
  plugin.requestJson = async (route, method, body) => {
    observedInputs.push([method, route, body.url]);
    return localAttempt();
  };
  plugin.evaluateCloudFallbackUserGate = async (options) => {
    counters.gates++;
    seenGates.push(options);
    return decision === 'deny'
      ? { allowed: false, code: 'LOCAL_TRANSCRIPTION_MEMBERSHIP_REQUIRED', message: 'Synthetic eligibility denial' }
      : { allowed: true };
  };
  plugin.submitCloudFallbackJob = async (payload) => {
    counters.submits++;
    submissions.push(payload);
    if (decision === 'uncertain') throw Object.assign(new Error('Synthetic uncertain submission'), { code: uncertain });
    return { status: 'queued', jobId: 'synthetic-fixture-job' };
  };
  const record = { _id: 'fixture-record', retryCount: 3, type: 'text', content: 'Share ' + url, createdAt: item.createdAt };
  if (storedResult) record.metadata = {
    url, cloudFallbackJobId: 'fixture-completed', cloudFallbackRecordRetryCount: record.retryCount,
    transcriptionStatus: 'success', transcription: transcript,
  };
  let outcome = 'resolved';
  let result;
  try {
    result = await plugin.writeRecord(record, newCreatedAt, binding, false, { skipAi: true, signal: controller.signal });
  } catch (error) {
    outcome = error.code || error.name;
  }
  const expectedInputs = platform === 'podcast' ? [['GET', url]] : [['POST', '/media/prepare', url]];
  assert.deepEqual(observedInputs, storedResult ? [] : expectedInputs);
  assert.equal(committedNotes.length, Number(storedResult));
  if (storedResult) {
    assert.equal(result?.committed, true);
    assert.equal(result.recordId, record._id);
    assert.equal(result.filePath, committedNotes[0].filePath);
    assert.ok(committedNotes[0].markdown.includes(transcript));
  }
  for (const gate of seenGates) assert.equal(gate.binding, binding);
  for (const payload of submissions) {
    assert.equal(payload.sourceUrl, url);
    assert.equal(payload.sourceType, sourceTypes[platform]);
    assert.equal(payload.recordId, record._id);
    assert.equal(payload.retryCount, record.retryCount);
    assert.equal(payload.binding, binding);
    if (item.checkSignal) assert.equal(payload.signal, controller.signal);
  }
  assert.deepEqual({ outcome, ...counters }, {
    outcome: item.outcome, reads: storedResult ? 0 : 1, gates: item.gates, submits: item.submits, writes: Number(storedResult),
  });
}

function cases() {
  const list = [];
  function add(platform, response, decision, eligible, outcome, createdAt = newCreatedAt) {
    list.push({platform, response, decision, outcome, createdAt, gates: Number(eligible),
      submits: Number(eligible && decision !== 'deny'), checkSignal: createdAt !== oldCreatedAt});
  }
  for (const [platform, response] of [['podcast','transport'], ['channels','empty']]) {
    add(platform, response, 'allow', true, queued);
    add(platform, response, 'deny', true, failed);
    add(platform, response, 'uncertain', true, uncertain);
    add(platform, 'cancel', 'allow', false, 'AbortError');
    add(platform, '404', 'allow', false, failed);
    add(platform, response, 'allow', false, failed, oldCreatedAt);
    add(platform, response, 'allow', false, failed, new Date(Date.parse(cutoff) - 1).toISOString());
    add(platform, response, 'allow', true, queued, cutoff);
    add(platform, 'stored', 'allow', false, 'resolved', oldCreatedAt);
  }
  add('podcast','empty','allow',true,queued);
  add('podcast','empty','deny',true,failed);
  add('podcast','empty','uncertain',true,uncertain);
  add('podcast','empty','allow',true,queued,oldCreatedAt);
  return list;
}
module.exports = async function verifyPreMediaHandoff() {
  const filename = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync/main.js');
  const bundle = {filename, code:fs.readFileSync(filename,'utf8')};
  for (const item of cases()) await runCase(bundle, item);
};