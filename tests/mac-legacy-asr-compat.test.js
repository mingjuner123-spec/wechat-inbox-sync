'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const helper = require('../obsidian-plugin/wechat-inbox-sync/src/mac-legacy-asr-compat');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wechat inbox 兼容测试 ')); }
function makeManagedInstall(root, enginePath, metal = '') {
  fs.mkdirSync(path.dirname(enginePath), { recursive: true });
  fs.copyFileSync(LEGACY_FIXTURE, enginePath);
  fs.chmodSync(enginePath, 0o700);
  const wrapperPath = path.join(root, 'bin', 'whisper-cli');
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(wrapperPath, helper.renderManagedWrapper(enginePath, metal), { mode: 0o700 });
  return { wrapperPath, enginePath };
}
function digest(file) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const LEGACY_FIXTURE = process.env.ASR_LEGACY_WHEEL_FIXTURE || '';
const COMPAT_FIXTURE = process.env.ASR_COMPAT_CANDIDATE_FIXTURE || '';
const PUBLIC_AUDIO_FIXTURE = process.env.ASR_PUBLIC_AUDIO_FIXTURE || '';
const PUBLIC_MODEL_FIXTURE = process.env.ASR_PUBLIC_MODEL_FIXTURE || '';

function runInstallerCompatActivation(installRoot, legacyBinary, mode = 'activate', newTarget = '') {
  const installerPath = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh');
  const installer = fs.readFileSync(installerPath, 'utf8');
  const start = installer.indexOf('render_whisper_wrapper_to_file() {');
  const end = installer.indexOf('find_homebrew_whisper_command() {', start);
  assert.ok(start >= 0 && end > start, 'installer compatibility functions are present');
  const functions = installer.slice(start, end);
  const tempRoot = path.join(installRoot, 'installer temp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const scriptPath = path.join(tempRoot, 'exercise-installer-compat.sh');
  const script = `
set -euo pipefail
set -x
INSTALL_ROOT="$ASR_INSTALL_ROOT"
TEMP_ROOT="$INSTALL_ROOT/installer temp"
find_metal_resources_dir() { return 0; }
file_sha256() { shasum -a 256 "$1" | awk '{print toupper($1)}'; }
extract_whisper_wrapper_target() { local wrapper="$1" target expected="$TEMP_ROOT/wrapper-check"; target="$(sed -n 's/^WHISPER_CPP_BIN="\\(.*\\)"$/\\1/p' "$wrapper" | head -n 1)"; [ -n "$target" ] && [ -x "$target" ] || return 1; render_whisper_wrapper_to_file "$expected" "$target"; cmp -s "$expected" "$wrapper" || { rm -f "$expected"; return 1; }; rm -f "$expected"; echo "$target"; }
sw_vers() { printf '12.6.3\\n'; }
${functions}
if [ "$ASR_TEST_MODE" = preserve ]; then
  write_whisper_wrapper "$ASR_NEW_TARGET"
else
  render_whisper_wrapper_to_file "$INSTALL_ROOT/bin/whisper-cli" "$ASR_LEGACY_BINARY"
  activate_compat_for_legacy_wrapper "$ASR_LEGACY_BINARY"
fi
`;
  fs.writeFileSync(scriptPath, script);
  const result = childProcess.spawnSync('/bin/bash', [scriptPath], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, ASR_INSTALL_ROOT: installRoot, ASR_LEGACY_BINARY: legacyBinary, ASR_TEST_MODE: mode, ASR_NEW_TARGET: newTarget },
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, `installer compat activation should finish: ${String(result.stderr || '').slice(-2000)}`);
  return result;
}

function runInstallerPreserveUnknownWrapper(installRoot, newTarget) {
  const oldWrapper = '#!/usr/bin/env bash\\nWHISPER_CPP_BIN="/custom/engine"\\necho custom-user-logic\\n';
  const wrapperPath = path.join(installRoot, 'bin', 'whisper-cli');
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(wrapperPath, oldWrapper, { mode: 0o700 });
  runInstallerCompatActivation(installRoot, '', 'preserve', newTarget);
  assert.strictEqual(fs.readFileSync(wrapperPath, 'utf8'), oldWrapper, 'installer preserves an unknown custom wrapper');
}
async function run() {
  assert.strictEqual(helper.macVersionInRange('12.6.3'), true);
  assert.strictEqual(helper.macVersionInRange('13.2.1'), true);
  assert.strictEqual(helper.macVersionInRange('13.3'), false);
  assert.strictEqual(helper.macVersionInRange('11.7.10'), false);

  const unknownRoot = tempRoot();
  try {
    const unknown = path.join(unknownRoot, 'bin', 'whisper-cli');
    fs.mkdirSync(path.dirname(unknown), { recursive: true });
    fs.writeFileSync(unknown, '#!/bin/sh\nexec custom-wrapper "$@"\n', { mode: 0o700 });
    const blocked = helper.inspectMacLegacyAsr({ platform: 'darwin', arch: 'x64', macOSVersion: '12.6.3', managed: true, installRoot: unknownRoot, runtimeIdentity: { binary: unknown } });
    assert.strictEqual(blocked.status, 'blocked');
    assert.strictEqual(blocked.reason, 'unknown-or-custom-wrapper');
    assert.strictEqual(helper.inspectMacLegacyAsr({ platform: 'darwin', arch: 'arm64', macOSVersion: '12.6.3', managed: true, installRoot: unknownRoot }).eligible, false);
    assert.strictEqual(helper.inspectMacLegacyAsr({ platform: 'darwin', arch: 'x64', macOSVersion: '14.0', managed: true, installRoot: unknownRoot }).eligible, false);
  } finally { fs.rmSync(unknownRoot, { recursive: true, force: true }); }

  const invalidRoot = tempRoot();
  try {
    const invalid = helper.installMacLegacyAsrCompat({ installRoot: invalidRoot, bytes: Buffer.from('not a Mach-O candidate') });
    assert.strictEqual(invalid.installed, false);
    assert.match(invalid.reason, /byte-length|sha256|Mach-O/);
    assert.strictEqual(fs.existsSync(path.join(invalidRoot, helper.COMPAT_RELATIVE_PATH)), false);
  } finally { fs.rmSync(invalidRoot, { recursive: true, force: true }); }

  if (!LEGACY_FIXTURE || !COMPAT_FIXTURE || !fs.existsSync(LEGACY_FIXTURE) || !fs.existsSync(COMPAT_FIXTURE)) {
    console.log('SKIP: set ASR_LEGACY_WHEEL_FIXTURE and ASR_COMPAT_CANDIDATE_FIXTURE to run real-binary switch cases.');
    return;
  }
  assert.strictEqual(digest(LEGACY_FIXTURE), helper.LEGACY_WHEEL_INTEL_SHA256);
  assert.strictEqual(digest(COMPAT_FIXTURE), helper.COMPAT_INTEL_SHA256);
  const candidateBytes = fs.readFileSync(COMPAT_FIXTURE);

  const root = tempRoot();
  try {
    const install = makeManagedInstall(root, path.join(root, 'python venv', 'bin', 'whisper-cpp'), path.join(root, 'Resources 中文'));
    const identity = { binary: install.enginePath, binarySha256: digest(install.enginePath), wrapperSha256: digest(install.wrapperPath) };
    let plan = helper.inspectMacLegacyAsr({ platform: 'darwin', arch: 'x64', macOSVersion: '12.6.3', managed: true, installRoot: root, runtimeIdentity: identity });
    assert.strictEqual(plan.status, 'needs-download');
    const licenseSource = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync/local-asr/WHISPER-CPP-LICENSE.txt');
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = function (filePath, ...args) {
      if (typeof filePath === 'string' && path.resolve(filePath) === licenseSource) throw new Error('runtime package has no adjacent source license');
      return originalReadFileSync.call(fs, filePath, ...args);
    };
    let installed;
    try { installed = helper.installMacLegacyAsrCompat({ installRoot: root, bytes: candidateBytes }); }
    finally { fs.readFileSync = originalReadFileSync; }
    assert.strictEqual(installed.installed, true);
    assert.strictEqual(installed.reason, 'candidate-installed');
    plan = helper.inspectMacLegacyAsr({ platform: 'darwin', arch: 'x64', macOSVersion: '12.6.3', managed: true, installRoot: root, runtimeIdentity: identity });
    assert.strictEqual(plan.status, 'ready-to-activate');
    assert.strictEqual(helper.installMacLegacyAsrCompat({ installRoot: root, bytes: candidateBytes }).reason, 'candidate-already-installed');
    const activated = helper.activateMacLegacyAsrCompat({ installRoot: root, candidatePath: plan.compatPath });
    assert.strictEqual(activated.applied, true);
    const after = helper.inspectMacLegacyAsr({ platform: 'darwin', arch: 'x64', macOSVersion: '12.6.3', managed: true, installRoot: root,
      runtimeIdentity: { binary: plan.compatPath, binarySha256: helper.COMPAT_INTEL_SHA256 } });
    assert.strictEqual(after.status, 'already-active');
    const repeatedActivation = helper.activateMacLegacyAsrCompat({ installRoot: root, candidatePath: plan.compatPath });
    assert.strictEqual(repeatedActivation.applied, true);
    assert.strictEqual(repeatedActivation.reason, 'already-active');
    assert.strictEqual(fs.readFileSync(activated.wrapperBackupPath, 'utf8'), helper.renderManagedWrapper(install.enginePath, path.join(root, 'Resources 中文')));
    assert.ok(fs.readFileSync(install.wrapperPath, 'utf8').includes(plan.compatPath));
    assert.ok(fs.existsSync(install.enginePath), 'original wheel binary remains in place');
    assert.strictEqual(digest(install.enginePath), helper.LEGACY_WHEEL_INTEL_SHA256, 'original wheel bytes are unchanged');
    assert.ok(fs.existsSync(path.join(path.dirname(plan.compatPath), 'LICENSE.txt')), 'upstream MIT license is installed beside compat binary');
    if (PUBLIC_AUDIO_FIXTURE && PUBLIC_MODEL_FIXTURE) {
      assert.strictEqual(process.platform, 'darwin', 'public audio wrapper integration runs only on macOS');
      const audioHash = digest(PUBLIC_AUDIO_FIXTURE);
      const modelHash = digest(PUBLIC_MODEL_FIXTURE);
      const installerRoot = tempRoot();
      try {
        const legacyPath = path.join(installerRoot, 'python 环境', 'bin', 'whisper-cpp');
        fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
        fs.copyFileSync(LEGACY_FIXTURE, legacyPath);
        fs.chmodSync(legacyPath, 0o700);
        const wrapperPath = path.join(installerRoot, 'bin', 'whisper-cli');
        fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
        fs.writeFileSync(wrapperPath, helper.renderManagedWrapper(legacyPath), { mode: 0o700 });
        const candidateInstall = helper.installMacLegacyAsrCompat({ installRoot: installerRoot, bytes: fs.readFileSync(COMPAT_FIXTURE) });
        assert.strictEqual(candidateInstall.installed, true, 'runtime helper installs the pinned candidate and its exact license bytes');
        const compatPath = candidateInstall.candidatePath;
        const modelMarker = path.join(installerRoot, 'models', 'user-model-marker');
        fs.mkdirSync(path.dirname(modelMarker), { recursive: true });
        fs.writeFileSync(modelMarker, 'preserve model directory');
        const modelMarkerHash = digest(modelMarker);
        const runtimeIdentity = { binary: legacyPath, binarySha256: digest(legacyPath) };
        const helperPlan = helper.inspectMacLegacyAsr({ platform: 'darwin', arch: 'x64', macOSVersion: '12.6.3', managed: true, installRoot: installerRoot, runtimeIdentity });
        assert.strictEqual(helperPlan.status, 'ready-to-activate');
        assert.strictEqual(helper.activateMacLegacyAsrCompat({ installRoot: installerRoot, candidatePath: compatPath }).applied, true);
        assert.ok(fs.readFileSync(wrapperPath, 'utf8').includes(compatPath), 'main helper switches the managed wrapper first');

        // Reinstall may refresh the old wheel wrapper; exercise the real installer functions to ensure it reselects the pinned candidate.
        fs.writeFileSync(wrapperPath, helper.renderManagedWrapper(legacyPath), { mode: 0o700 });
        const installerResult = runInstallerCompatActivation(installerRoot, legacyPath);
        assert.ok(fs.readFileSync(wrapperPath, 'utf8').includes(compatPath),
          `installer reuses the already installed candidate instead of leaving the old wheel active; stdout:\n${installerResult.stdout || ''}\nstderr:\n${installerResult.stderr || ''}`);
        assert.strictEqual(fs.existsSync(wrapperPath + '.before-macos-legacy-asr-compat-v1'), true);
        assert.strictEqual(digest(legacyPath), helper.LEGACY_WHEEL_INTEL_SHA256, 'installer leaves original wheel bytes unchanged');
        assert.strictEqual(digest(modelMarker), modelMarkerHash, 'installer leaves user model marker unchanged');

        const prefix = path.join(installerRoot, 'public output', 'jfk-result');
        fs.mkdirSync(path.dirname(prefix), { recursive: true });
        const cliResult = childProcess.spawnSync(wrapperPath, [
          '-m', PUBLIC_MODEL_FIXTURE, '-f', PUBLIC_AUDIO_FIXTURE, '-l', 'en', '-nt', '-otxt', '-of', prefix,
        ], { encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
        assert.ifError(cliResult.error);
        assert.strictEqual(cliResult.status, 0, `compat wrapper should finish public JFK sample: ${String(cliResult.stderr || '').slice(-2000)}`);
        const transcript = fs.readFileSync(`${prefix}.txt`, 'utf8').toLowerCase().replace(/\s+/g, ' ');
        assert.match(transcript, /ask not what your country can do for you/);
        assert.strictEqual(digest(PUBLIC_AUDIO_FIXTURE), audioHash, 'public audio fixture is unchanged');
        assert.strictEqual(digest(PUBLIC_MODEL_FIXTURE), modelHash, 'public model fixture is unchanged');

        const unknownWrapperRoot = tempRoot();
        try { runInstallerPreserveUnknownWrapper(unknownWrapperRoot, compatPath); }
        finally { fs.rmSync(unknownWrapperRoot, { recursive: true, force: true }); }

        const corruptRoot = tempRoot();
        try {
          const corruptLegacy = path.join(corruptRoot, 'venv', 'whisper-cpp');
          fs.mkdirSync(path.dirname(corruptLegacy), { recursive: true });
          fs.copyFileSync(LEGACY_FIXTURE, corruptLegacy);
          fs.chmodSync(corruptLegacy, 0o700);
          const corruptPath = path.join(corruptRoot, helper.COMPAT_RELATIVE_PATH);
          fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
          fs.writeFileSync(corruptPath, candidateBytes.subarray(0, 4096), { mode: 0o700 });
          fs.copyFileSync(path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync/local-asr/WHISPER-CPP-LICENSE.txt'), path.join(path.dirname(corruptPath), 'LICENSE.txt'));
          const corruptWrapper = path.join(corruptRoot, 'bin', 'whisper-cli');
          fs.mkdirSync(path.dirname(corruptWrapper), { recursive: true });
          const oldWrapper = helper.renderManagedWrapper(corruptLegacy);
          fs.writeFileSync(corruptWrapper, oldWrapper, { mode: 0o700 });
          runInstallerCompatActivation(corruptRoot, corruptLegacy);
          assert.strictEqual(fs.readFileSync(corruptWrapper, 'utf8'), oldWrapper, 'invalid candidate never changes the old wrapper');
          assert.strictEqual(fs.existsSync(corruptWrapper + '.before-macos-legacy-asr-compat-v1'), false, 'invalid candidate does not create a misleading backup');
        } finally { fs.rmSync(corruptRoot, { recursive: true, force: true }); }
      } finally { fs.rmSync(installerRoot, { recursive: true, force: true }); }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

  const collisionRoot = tempRoot();
  try {
    const install = makeManagedInstall(collisionRoot, path.join(collisionRoot, 'venv', 'whisper-cpp'));
    const candidate = helper.installMacLegacyAsrCompat({ installRoot: collisionRoot, bytes: candidateBytes });
    assert.strictEqual(candidate.installed, true);
    const backup = install.wrapperPath + '.before-macos-legacy-asr-compat-v1';
    fs.writeFileSync(backup, 'unrelated existing backup', { flag: 'wx' });
    const before = fs.readFileSync(install.wrapperPath, 'utf8');
    const result = helper.activateMacLegacyAsrCompat({ installRoot: collisionRoot, candidatePath: candidate.candidatePath });
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.reason, 'wrapper-backup-mismatch');
    assert.strictEqual(fs.readFileSync(install.wrapperPath, 'utf8'), before);
    assert.strictEqual(fs.readFileSync(backup, 'utf8'), 'unrelated existing backup');
  } finally { fs.rmSync(collisionRoot, { recursive: true, force: true }); }

  const rollbackRoot = tempRoot();
  try {
    const install = makeManagedInstall(rollbackRoot, path.join(rollbackRoot, 'venv', 'whisper-cpp'));
    const candidate = helper.installMacLegacyAsrCompat({ installRoot: rollbackRoot, bytes: candidateBytes });
    const before = fs.readFileSync(install.wrapperPath, 'utf8');
    const originalRename = fs.renameSync;
    let corrupted = false;
    fs.renameSync = function (from, to) {
      const result = originalRename.call(fs, from, to);
      if (!corrupted && path.resolve(to) === path.resolve(install.wrapperPath)) {
        corrupted = true;
        fs.writeFileSync(candidate.candidatePath, 'corrupt after rename');
      }
      return result;
    };
    let result;
    try { result = helper.activateMacLegacyAsrCompat({ installRoot: rollbackRoot, candidatePath: candidate.candidatePath }); }
    finally { fs.renameSync = originalRename; }
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.reason, 'post-switch-readback-failed-rolled-back');
    assert.strictEqual(fs.readFileSync(install.wrapperPath, 'utf8'), before);
  } finally { fs.rmSync(rollbackRoot, { recursive: true, force: true }); }
  console.log('Mac legacy ASR compatibility tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
