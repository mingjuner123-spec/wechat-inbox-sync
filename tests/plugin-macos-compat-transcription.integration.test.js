'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const compat = require('../obsidian-plugin/wechat-inbox-sync/src/mac-legacy-asr-compat');
const fixtures = {
  legacy: process.env.ASR_LEGACY_WHEEL_FIXTURE || '',
  candidate: process.env.ASR_COMPAT_CANDIDATE_FIXTURE || '',
  audio: process.env.ASR_PUBLIC_AUDIO_FIXTURE || '',
  model: process.env.ASR_PUBLIC_MODEL_FIXTURE || '',
  ffmpeg: process.env.ASR_FFMPEG_FIXTURE || '',
};
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function loadPlugin(requestUrlMock) {
  const oldLoad = Module._load, oldExtensions = {};
  for (const ext of ['.ps1', '.sh', '.py']) {
    oldExtensions[ext] = Module._extensions[ext];
    Module._extensions[ext] = (mod, file) => { mod.exports = fs.readFileSync(file, 'utf8'); };
  }
  Module._load = function (request, ...args) {
    if (request === 'obsidian') return { Plugin: class {}, Modal: class {}, Notice: class {}, PluginSettingTab: class {}, Setting: class {}, requestUrl: requestUrlMock };
    return oldLoad.call(this, request, ...args);
  };
  try { return require('../obsidian-plugin/wechat-inbox-sync/src/main'); }
  finally {
    Module._load = oldLoad;
    for (const ext of Object.keys(oldExtensions)) oldExtensions[ext] ? Module._extensions[ext] = oldExtensions[ext] : delete Module._extensions[ext];
  }
}
function managedTranscribeScript(installerPath) {
  const source = fs.readFileSync(installerPath, 'utf8');
  const marker = 'cat > "$INSTALL_ROOT/transcribe.sh" <<\'SCRIPT\'\n';
  const from = source.indexOf(marker);
  assert.ok(from >= 0, 'managed transcribe heredoc exists');
  const bodyStart = from + marker.length, to = source.indexOf('\nSCRIPT', bodyStart);
  assert.ok(to > bodyStart, 'managed transcribe heredoc terminates');
  return `${source.slice(bodyStart, to)}\n`;
}
async function run() {
  if (process.platform !== 'darwin') {
    console.log('SKIP: real ASR integration requires macOS; source discovery and syntax are checked on other hosts.');
    return;
  }
  assert.strictEqual(process.arch, 'x64', 'real binary integration runs on Intel macOS only');
  for (const [name, file] of Object.entries(fixtures)) assert.ok(file && fs.existsSync(file), `${name} fixture is required`);
  assert.strictEqual(digest(fixtures.legacy), compat.LEGACY_WHEEL_INTEL_SHA256, 'known old Intel wheel fixture');
  assert.strictEqual(digest(fixtures.candidate), compat.COMPAT_INTEL_SHA256, 'pinned CPU/no-Accelerate candidate fixture');
  const audioSha = digest(fixtures.audio), modelSha = digest(fixtures.model);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin compat ASR 集成 with spaces-'));
  let plugin;
  try {
    const root = path.join(scratch, '本地安装 root');
    const wrapper = path.join(root, 'bin', 'whisper-cli');
    const oldEngine = path.join(root, 'python 环境', 'bin', 'whisper-cpp');
    const model = path.join(root, 'models', 'ggml-small.bin');
    const inputDir = path.join(root, 'input');
    const binDir = path.join(root, 'bin');
    [path.dirname(oldEngine), binDir, path.dirname(model), inputDir].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
    fs.copyFileSync(fixtures.legacy, oldEngine); fs.chmodSync(oldEngine, 0o700);
    fs.copyFileSync(fixtures.model, model);
    fs.writeFileSync(wrapper, compat.renderManagedWrapper(oldEngine), { mode: 0o700 });
    const ffmpeg = path.join(binDir, 'ffmpeg');
    fs.copyFileSync(fixtures.ffmpeg, ffmpeg); fs.chmodSync(ffmpeg, 0o700);
    assert.strictEqual(digest(ffmpeg), digest(fixtures.ffmpeg), 'the installed ffmpeg is the pinned CI fixture');
    const installer = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh');
    const transcribe = path.join(root, 'transcribe.sh');
    fs.writeFileSync(transcribe, managedTranscribeScript(installer), { mode: 0o700 }); fs.chmodSync(transcribe, 0o700);

    const candidateBytes = fs.readFileSync(fixtures.candidate);
    let manifest;
    const Plugin = loadPlugin(async request => {
      assert.strictEqual(request.url, manifest.assets[0].downloadUrl, 'only normalized signed asset URL is fetched');
      return { status: 200, arrayBuffer: candidateBytes };
    });
    const host = Plugin.__test.LOCAL_COMPONENT_DOWNLOAD_HOST;
    const filename = 'whisper-cpp-macos-x64-v1.5.5-compat';
    manifest = {
      schemaVersion: 2, deliveryProtocol: 'cloudbase-v1', component: 'asr', platform: 'darwin', arch: 'x64',
      version: '1.5.5-cpu-no-accelerate', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      assets: [{ id: 'whisper-compat', fileName: filename, sha256: compat.COMPAT_INTEL_SHA256, byteLength: candidateBytes.length,
        downloadUrl: `https://${host}/local-components/by-sha256/${compat.COMPAT_INTEL_SHA256}/${filename}?sign=fixture-sign&t=fixture-time` }],
    };
    plugin = new Plugin(); plugin.settings = {};
    plugin._macOSProductVersion = '12.6.3'; // Selector input is simulated; actual host remains macOS Intel CI.
    plugin.ensureLocalComponentReadyForUse = async () => {};
    plugin.recoverStaleLocalTranscriptionCommand = async () => {};
    plugin.ensureProFeatureAccess = async () => ({ bindingToken: 'fixture-binding' });
    plugin.getActiveBindings = () => [{ token: 'fixture-binding' }];
    plugin.getConfiguredLocalAsrPlatform = () => 'darwin';
    plugin.getConfiguredLocalAsrInstallRoot = () => root;
    plugin.getLocalAsrInstallStatus = () => ({ ready: true, scriptOutdated: false, whisperPath: wrapper });
    plugin.getEffectiveLocalTranscriptionCommand = () => `bash "${transcribe}" --input {input} --output {output}`;
    let manifestRequests = 0, inputSequence = 0;
    plugin.requestJson = async (url, method, body, binding) => {
      manifestRequests++;
      assert.strictEqual(method, 'GET'); assert.strictEqual(binding.token, 'fixture-binding');
      assert.match(url, /deliveryProtocol=cloudbase-v1/); assert.match(url, /deliveryHost=short-native-v1/);
      return { success: true, data: manifest };
    };
    plugin.downloadMediaToTempFile = async () => {
      const input = path.join(inputDir, `jfk-${++inputSequence}.wav`);
      fs.copyFileSync(fixtures.audio, input);
      return input;
    };
    plugin.setTranscriptionStopAvailable = () => {}; plugin.showSyncProgress = () => {};

    const first = await plugin.runLocalTranscription('public-jfk-fixture', { recordId: 'compat-integration-first' });
    const transcript = String(first || '').trim();
    assert.ok(transcript.length > 8, 'the real ASR script and candidate produce transcript text');
    console.log("PUBLIC_JFK_TRANSCRIPT_BEGIN" + String.fromCharCode(10) + transcript + String.fromCharCode(10) + "PUBLIC_JFK_TRANSCRIPT_END");
    if (process.env.ASR_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.ASR_EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.ASR_EVIDENCE_DIR, 'plugin-compat-public-jfk-transcript.txt'), transcript + String.fromCharCode(10));
    }
    assert.strictEqual(manifestRequests, 1);
    const activeBinary = path.join(root, compat.COMPAT_RELATIVE_PATH);
    assert.strictEqual(digest(activeBinary), compat.COMPAT_INTEL_SHA256);
    assert.strictEqual(digest(oldEngine), compat.LEGACY_WHEEL_INTEL_SHA256, 'installed 0.0.3 binary remains unchanged');
    assert.strictEqual(digest(model), modelSha, 'existing model remains unchanged');
    assert.strictEqual(digest(fixtures.audio), audioSha, 'public source fixture remains unchanged');
    assert.ok(fs.readFileSync(wrapper, 'utf8').includes(activeBinary));
    const firstSession = JSON.parse(fs.readFileSync(path.join(root, 'asr-diagnostic-last.json'), 'utf8'));
    assert.strictEqual(firstSession.runtime.binarySha256, compat.COMPAT_INTEL_SHA256);
    assert.strictEqual(firstSession.runtime.macLegacyCompatibility.status, 'active');

    const second = await plugin.runLocalTranscription('public-jfk-fixture', { recordId: 'compat-integration-active' });
    assert.ok(typeof second === 'string' && second.trim().length > 8, 'already-active plugin path still transcribes');
    assert.strictEqual(manifestRequests, 1, 'already-active candidate does not redownload');
    const secondSession = JSON.parse(fs.readFileSync(path.join(root, 'asr-diagnostic-last.json'), 'utf8'));
    assert.strictEqual(secondSession.runtime.macLegacyCompatibility.status, 'already-active');
    console.log('PASS: real plugin path downloaded and activated the pinned candidate, then transcribed public JFK twice; macOS 12.6 selector simulated on actual Intel runner. Installer reinstallation is covered by mac-legacy-asr-compat.test.js in the same workflow.');
  } finally {
    plugin?.currentTranscriptionAbortController?.abort();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
