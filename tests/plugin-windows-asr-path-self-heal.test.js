const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal: class Modal {},
      Notice: class Notice {},
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: async () => ({}),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pluginMainPath = process.env.PLUGIN_MAIN_PATH || '../obsidian-plugin/wechat-inbox-sync/main';
const PluginClass = require(pluginMainPath);
Module._load = originalLoad;

const plugin = new PluginClass();
plugin.settings = PluginClass.__test.mergeSettings({
  localAsrPlatform: 'win32',
  localAsrInstallMode: 'default',
  localTranscriptionCommand: 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\Rick\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
});
plugin.getConfiguredLocalAsrPlatform = () => 'win32';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-asr-self-heal-'));
plugin.getConfiguredLocalAsrInstallRoot = () => tempRoot;

const installerText = fs.readFileSync(
  path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'local-asr', 'install-local-asr.ps1'),
  'utf8',
);
const embeddedScriptMatch = installerText.match(/\$embeddedTranscribeTemplate\s*=\s*@'\r?\n([\s\S]*?)\r?\n'@/);
assert.ok(embeddedScriptMatch, 'canonical Windows transcribe script must be embedded in installer');
fs.writeFileSync(path.join(tempRoot, 'transcribe.ps1'), embeddedScriptMatch[1], 'utf8');

async function run() {
  try {
  assert.strictEqual(
    plugin.getEffectiveLocalTranscriptionCommand(),
    plugin.settings.localTranscriptionCommand,
    '只有转写脚本、但模型/whisper/ffmpeg 不完整时不得切换路径',
  );
  fs.mkdirSync(path.join(tempRoot, 'models'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'models', 'ggml-small.bin'), 'model');
  fs.writeFileSync(path.join(tempRoot, 'bin', 'whisper-cli.exe'), 'whisper');
  fs.writeFileSync(path.join(tempRoot, 'bin', 'ffmpeg.exe'), 'ffmpeg');
  const expectedCommand = `powershell -NoProfile -ExecutionPolicy Bypass -File "${tempRoot}\\transcribe.ps1" -InputPath {input} -OutputPath {output}`;
  assert.strictEqual(
    plugin.getEffectiveLocalTranscriptionCommand(),
    expectedCommand,
  );
  let savedSettings = null;
  plugin.saveSettings = async (settings) => {
    savedSettings = settings;
    plugin.settings = settings;
  };
    const recoveredCommand = await plugin.recoverStaleLocalTranscriptionCommand();
    assert.strictEqual(recoveredCommand, expectedCommand);
    assert.strictEqual(savedSettings.localTranscriptionCommand, recoveredCommand);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().then(() => console.log('plugin Windows ASR path self-heal test passed')).catch((error) => {
  console.error(error);
  process.exit(1);
});
