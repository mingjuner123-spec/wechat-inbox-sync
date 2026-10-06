'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const cp = require('child_process');
const recovery = require('../obsidian-plugin/wechat-inbox-sync/src/asr-recovery-utils');
const compat = require('../obsidian-plugin/wechat-inbox-sync/src/mac-legacy-asr-compat');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-legacy-asr-main-'));
let requestUrlMock = async () => ({ status: 500 });
function loadPlugin() {
  const originalLoad = Module._load;
  const ext = {};
  for (const name of ['.ps1', '.sh', '.py']) { ext[name] = Module._extensions[name]; Module._extensions[name] = (mod, file) => { mod.exports = fs.readFileSync(file, 'utf8'); }; }
  Module._load = function (request, ...args) {
    if (request === 'obsidian') return { Plugin: class {}, Modal: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {}, requestUrl: (...args) => requestUrlMock(...args) };
    return originalLoad.call(this, request, ...args);
  };
  try { return require('../obsidian-plugin/wechat-inbox-sync/src/main'); }
  finally { Module._load = originalLoad; for (const name of Object.keys(ext)) ext[name] ? Module._extensions[name] = ext[name] : delete Module._extensions[name]; }
}
function fixture(Plugin, name) {
  const root = path.join(scratch, name); fs.mkdirSync(root, { recursive: true });
  const plugin = new Plugin(); plugin.settings = {};
  plugin.ensureLocalComponentReadyForUse = async () => {}; plugin.recoverStaleLocalTranscriptionCommand = async () => {};
  plugin.getConfiguredLocalAsrPlatform = () => 'darwin'; plugin.getConfiguredLocalAsrInstallRoot = () => root.split(path.sep).join('/');
  plugin.getLocalAsrInstallStatus = () => ({ ready: true, scriptOutdated: false, whisperPath: path.join(root, 'bin', 'whisper-cli') });
  plugin.getEffectiveLocalTranscriptionCommand = () => `bash "${path.join(root, 'transcribe.sh')}" --input {input} --output {output}`;
  plugin.setTranscriptionStopAvailable = () => {}; plugin.showSyncProgress = () => {};
  plugin.downloadMediaToTempFile = async () => { const file = path.join(root, 'audio.wav'); fs.writeFileSync(file, 'fixture'); return file; };
  return { plugin, root };
}
async function transcribeOk(plugin, root) {
  cp.exec = (_cmd, _opts, callback) => { setImmediate(() => { fs.writeFileSync(path.join(root, 'audio.wav.txt'), '这是一段完整有效的中文转写文本。'); callback(null, '', ''); }); return { pid: 8801, killed: false, kill() {} }; };
  return plugin.runLocalTranscription('fixture-url', { recordId: 'main-wiring' });
}
async function main() {
  const Plugin = loadPlugin();
  const old = { ensure: recovery.ensureManagedMacScript, runtime: recovery.runtimeIdentity, inspect: compat.inspectMacLegacyAsr,
    install: compat.installMacLegacyAsrCompat, activate: compat.activateMacLegacyAsrCompat, spawnSync: cp.spawnSync, arch: os.arch, exec: cp.exec };
  const data = Buffer.from('signed compat fixture'); const sha = crypto.createHash('sha256').update(data).digest('hex');
  const candidatePath = path.join(scratch, 'managed', 'bin', 'compat', 'v1.5.5', 'x64', 'whisper-cpp');
  const calls = []; let active = false;
  try {
    recovery.ensureManagedMacScript = () => true; cp.spawnSync = () => ({ status: 0, stdout: '12.6.9' }); os.arch = () => 'x64';
    recovery.runtimeIdentity = () => active ? { binary: candidatePath, binarySha256: sha } : { binary: '/old/whisper-cli', binarySha256: '08491f7bfa1636ac6f7756c3a6f591225578fa876e6cf97fdc64b7838bc3aa95' };
    compat.inspectMacLegacyAsr = input => { calls.push(`inspect:${input.macOSVersion}`); return { eligible: true, alreadyActive: false, status: 'needs-download', compatPath: candidatePath, expectedCompatSha256: sha, expectedCompatByteLength: data.length }; };
    compat.installMacLegacyAsrCompat = ({ bytes }) => { assert.deepEqual(bytes, data); calls.push('install'); return { installed: true, candidatePath }; };
    compat.activateMacLegacyAsrCompat = ({ candidatePath: target }) => { assert.equal(target, candidatePath); calls.push('activate'); active = true; return { applied: true, reason: 'compat-activated' }; };
    const current = fixture(Plugin, 'managed');
    current.plugin.getAuthorizedLocalComponentManifest = async component => { assert.equal(component, 'asr'); calls.push('manifest'); return { component: 'asr', platform: 'darwin', arch: 'x64', assets: [{ id: 'whisper-compat', sha256: sha, byteLength: data.length, downloadUrl: 'https://signed.example/asset?sign=x&t=1' }] }; };
    requestUrlMock = async options => { assert.equal(options.url, 'https://signed.example/asset?sign=x&t=1'); calls.push('download'); return { status: 200, arrayBuffer: data }; };
    assert.match(await transcribeOk(current.plugin, current.root), /中文转写/);
    assert.deepEqual(calls.map(value => value.split(':')[0]), ['inspect', 'manifest', 'download', 'install', 'activate']);
    const saved = JSON.parse(fs.readFileSync(path.join(current.root, 'asr-diagnostic-last.json'), 'utf8'));
    assert.equal(saved.runtime.binarySha256, sha); assert.equal(saved.runtime.macLegacyCompatibility.status, 'active');

    calls.length = 0;
    compat.inspectMacLegacyAsr = () => ({ eligible: false, alreadyActive: true, status: 'already-active', reason: 'compat-already-active' });
    const activeFixture = fixture(Plugin, 'already-active'); activeFixture.plugin.getAuthorizedLocalComponentManifest = async () => { throw new Error('must not request manifest'); };
    await transcribeOk(activeFixture.plugin, activeFixture.root);
    const activeSession = JSON.parse(fs.readFileSync(path.join(activeFixture.root, 'asr-diagnostic-last.json'), 'utf8'));
    assert.equal(activeSession.runtime.macLegacyCompatibility.status, 'already-active'); assert.equal(calls.length, 0);

    compat.inspectMacLegacyAsr = () => ({ eligible: true, status: 'needs-download', compatPath: candidatePath, expectedCompatSha256: sha, expectedCompatByteLength: data.length });
    const unavailable = fixture(Plugin, 'unavailable'); unavailable.plugin.getAuthorizedLocalComponentManifest = async () => { throw new Error('fixture unavailable'); };
    let engineStarted = false; cp.exec = () => { engineStarted = true; return {}; };
    await assert.rejects(unavailable.plugin.runLocalTranscription('fixture-url'), error => /兼容组件尚未就绪/.test(error.message) && !/ABORT_ERR/.test(error.code || ''));
    assert.equal(engineStarted, false, 'known incompatible legacy engine is not started without the compat asset');

    const invalid = fixture(Plugin, 'invalid-asset');
    invalid.plugin.getAuthorizedLocalComponentManifest = async () => ({ component: 'asr', platform: 'darwin', arch: 'x64', assets: [
      { id: 'whisper-compat', sha256: '0'.repeat(64), byteLength: data.length, downloadUrl: 'https://signed.example/wrong' },
    ] });
    let downloadCalls = 0;
    requestUrlMock = async () => { downloadCalls++; return { status: 200, arrayBuffer: data }; };
    await assert.rejects(invalid.plugin.runLocalTranscription('fixture-url'), /唯一且校验匹配/);
    assert.equal(downloadCalls, 0, 'wrong signed asset identity is rejected before fetching bytes');
    assert.equal(engineStarted, false, 'wrong asset identity does not fall through to the known-bad engine');

    const signedUrl = 'https://signed.example/private?sign=secret-fixture&t=1';
    const makeManifest = () => ({ component: 'asr', platform: 'darwin', arch: 'x64', assets: [
      { id: 'whisper-compat', sha256: sha, byteLength: data.length, downloadUrl: signedUrl },
    ] });
    const requestFailure = fixture(Plugin, 'download-error');
    requestFailure.plugin.getAuthorizedLocalComponentManifest = async () => makeManifest();
    requestUrlMock = async () => { throw new Error(`network failure at ${signedUrl}`); };
    engineStarted = false;
    await assert.rejects(requestFailure.plugin.runLocalTranscription('fixture-url'), error => {
      assert.match(error.message, /下载失败/);
      assert.ok(!error.message.includes(signedUrl), 'signed URL is not reflected in the user-facing error');
      return true;
    });
    assert.equal(engineStarted, false);

    const mismatch = fixture(Plugin, 'download-mismatch');
    mismatch.plugin.getAuthorizedLocalComponentManifest = async () => makeManifest();
    let mismatchBytes = Buffer.alloc(data.length, 0x61);
    requestUrlMock = async () => ({ status: 200, arrayBuffer: mismatchBytes });
    await assert.rejects(mismatch.plugin.runLocalTranscription('fixture-url'), /校验失败/);
    assert.equal(engineStarted, false, 'downloaded bytes with the wrong SHA never reach the old engine');
    mismatchBytes = Buffer.from('short');
    const sizeMismatch = fixture(Plugin, 'size-mismatch');
    sizeMismatch.plugin.getAuthorizedLocalComponentManifest = async () => makeManifest();
    await assert.rejects(sizeMismatch.plugin.runLocalTranscription('fixture-url'), /校验失败/);
    assert.equal(engineStarted, false, 'downloaded bytes with the wrong size never reach the old engine');

    calls.length = 0;
    const abortDuringDownload = fixture(Plugin, 'abort-during-download');
    abortDuringDownload.plugin.getAuthorizedLocalComponentManifest = async () => makeManifest();
    let markRequestStarted;
    let finishRequest;
    const requestStarted = new Promise(resolve => { markRequestStarted = resolve; });
    const pendingResponse = new Promise(resolve => { finishRequest = resolve; });
    requestUrlMock = async () => { markRequestStarted(); return pendingResponse; };
    const controller = new AbortController();
    const pendingRun = abortDuringDownload.plugin.runLocalTranscription('fixture-url', { signal: controller.signal });
    await requestStarted;
    controller.abort();
    finishRequest({ status: 200, arrayBuffer: data });
    await assert.rejects(pendingRun, /abort/i);
    assert.equal(calls.includes('install'), false, 'abort during download prevents candidate installation');
    assert.equal(calls.includes('activate'), false, 'abort during download prevents wrapper activation');
    assert.equal(engineStarted, false);
  } finally {
    recovery.ensureManagedMacScript = old.ensure; recovery.runtimeIdentity = old.runtime; compat.inspectMacLegacyAsr = old.inspect;
    compat.installMacLegacyAsrCompat = old.install; compat.activateMacLegacyAsrCompat = old.activate;
    cp.spawnSync = old.spawnSync; os.arch = old.arch; cp.exec = old.exec;
    if (!scratch.startsWith(path.join(os.tmpdir(), 'mac-legacy-asr-main-'))) throw new Error('unsafe cleanup');
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
main().then(() => console.log('PASS: main wiring downloads exact authorized compat, refreshes runtime identity, skips already active and blocks known-bad engine on setup failure')).catch(error => { console.error(error); process.exitCode = 1; });