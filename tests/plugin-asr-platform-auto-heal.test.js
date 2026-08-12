'use strict';

const assert = require('node:assert');
const Module = require('node:module');

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

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;

const helpers = PluginClass.__test;
const legacyWindowsCommand = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}';
const migrated = helpers.mergeSettings({
  localAsrPlatform: 'win32',
  localTranscriptionCommand: legacyWindowsCommand,
}, 'darwin');

assert.strictEqual(migrated.localAsrPlatform, 'auto');
assert.strictEqual(
  migrated.localTranscriptionCommand,
  '/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}',
);
assert.strictEqual(helpers.getLocalAsrPlatformMismatchMessage(migrated.localAsrPlatform, 'darwin'), '');
assert.strictEqual(helpers.shouldPersistAutoLocalAsrPlatform({ localAsrPlatform: 'win32' }), true);
assert.strictEqual(helpers.shouldPersistAutoLocalAsrPlatform({ localAsrPlatform: 'darwin' }), true);
assert.strictEqual(helpers.shouldPersistAutoLocalAsrPlatform({ localAsrPlatform: 'auto' }), false);

process.stdout.write('ASR platform auto-heal: PASS\\n');
