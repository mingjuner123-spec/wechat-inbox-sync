const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const installerPath = path.join(
  root,
  'obsidian-plugin',
  'wechat-inbox-sync',
  'local-asr',
  'install-local-asr-macos.sh',
);
const installer = fs.readFileSync(installerPath, 'utf8');

function extractShellFunction(source, functionName, nextFunctionName) {
  const startMarker = `${functionName}() {`;
  const endMarker = `\n\n${nextFunctionName}() {`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing shell function: ${functionName}`);
  assert.ok(end > start, `cannot find end of shell function: ${functionName}`);
  return source.slice(start, end);
}

function extractShellSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing shell section start: ${startMarker}`);
  assert.ok(end > start, `missing shell section end: ${endMarker}`);
  return source.slice(start, end);
}

function findBash() {
  const candidates = [
    process.env.BASH_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash',
    'bash',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error('bash is required for the macOS ASR installer behavior test');
}

function runWrapperHarness({ withMetalResources }) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-macos-asr-test-'));
  try {
    const harnessPath = path.join(tempRoot, 'harness.sh');
    const writeWrapperFunction = extractShellFunction(
      installer,
      'write_whisper_wrapper',
      'find_homebrew_whisper_command',
    );
    const metalFixture = withMetalResources
      ? [
          'METAL_DIR="$TEST_ROOT/metal"',
          'mkdir -p "$METAL_DIR"',
          'touch "$METAL_DIR/ggml-metal.metal"',
          'find_metal_resources_dir() { printf "%s\\n" "$METAL_DIR"; }',
        ].join('\n')
      : 'find_metal_resources_dir() { return 0; }';

    fs.writeFileSync(
      harnessPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'TEST_ROOT="$(cd "$(dirname "$0")" && pwd)"',
        'INSTALL_ROOT="$TEST_ROOT/install"',
        'mkdir -p "$INSTALL_ROOT/bin"',
        'FAKE_WHISPER="$TEST_ROOT/fake-whisper"',
        'cat > "$FAKE_WHISPER" <<\'SCRIPT\'',
        '#!/usr/bin/env bash',
        'printf "metal=%s\\n" "${GGML_METAL_PATH_RESOURCES:-}" > "$TEST_ROOT/result.txt"',
        'printf "arg=%s\\n" "$@" >> "$TEST_ROOT/result.txt"',
        'SCRIPT',
        'chmod +x "$FAKE_WHISPER"',
        'export TEST_ROOT',
        metalFixture,
        writeWrapperFunction,
        'write_whisper_wrapper "$FAKE_WHISPER"',
        '"$INSTALL_ROOT/bin/whisper-cli" -m model.bin -f input.wav',
        '',
      ].join('\n'),
      'utf8',
    );

    const run = spawnSync(findBash(), [harnessPath], { encoding: 'utf8' });
    assert.strictEqual(
      run.status,
      0,
      `wrapper harness failed:\nstdout=${run.stdout}\nstderr=${run.stderr}`,
    );
    return fs.readFileSync(path.join(tempRoot, 'result.txt'), 'utf8');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const cpuResult = runWrapperHarness({ withMetalResources: false });
assert.match(
  cpuResult,
  /^metal=\r?\narg=--no-gpu\r?$/m,
  'missing Metal resources must make the official whisper wrapper select CPU mode',
);
assert.match(cpuResult, /^arg=-m\r?\narg=model\.bin\r?\narg=-f\r?\narg=input\.wav\r?$/m);

const metalResult = runWrapperHarness({ withMetalResources: true });
assert.match(metalResult, /^metal=.+\/metal\r?$/m);
assert.strictEqual(
  metalResult.includes('arg=--no-gpu'),
  false,
  'available Metal resources must keep hardware acceleration enabled',
);
assert.match(metalResult, /^arg=-m\r?\narg=model\.bin\r?\narg=-f\r?\narg=input\.wav\r?$/m);

function runSetupOrchestrationHarness(setupReturnCode) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-macos-asr-setup-test-'));
  try {
    const harnessPath = path.join(tempRoot, 'harness.sh');
    const setupOrchestration = extractShellSection(
      installer,
      '# Primary path: uv → Python → pip packages.',
      '# Locate whisper binary.',
    );
    fs.writeFileSync(
      harnessPath,
      [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'TEST_ROOT="$(cd "$(dirname "$0")" && pwd)"',
        `setup_python_and_packages() { return ${setupReturnCode}; }`,
        'brew_install_formula() { printf "%s\\n" "$1" >> "$TEST_ROOT/brew.log"; }',
        setupOrchestration,
        '',
      ].join('\n'),
      'utf8',
    );
    const run = spawnSync(findBash(), [harnessPath], { encoding: 'utf8' });
    const brewLogPath = path.join(tempRoot, 'brew.log');
    return {
      ...run,
      brewLog: fs.existsSync(brewLogPath) ? fs.readFileSync(brewLogPath, 'utf8') : '',
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const primarySetup = runSetupOrchestrationHarness(0);
assert.strictEqual(primarySetup.status, 0);
assert.strictEqual(primarySetup.brewLog, '');

const homebrewFallbackSetup = runSetupOrchestrationHarness(2);
assert.strictEqual(
  homebrewFallbackSetup.status,
  0,
  'primary package failure with Homebrew available must reach the last-resort fallback',
);
assert.strictEqual(homebrewFallbackSetup.brewLog, 'ffmpeg\nwhisper-cpp\n');

const unavailableFallbackSetup = runSetupOrchestrationHarness(1);
assert.strictEqual(unavailableFallbackSetup.status, 1);
assert.strictEqual(unavailableFallbackSetup.brewLog, '');

assert.strictEqual(
  installer.includes(
    'Metal resources not found for current whisper; trying Homebrew whisper-cpp fallback.',
  ),
  false,
  'an already installed whisper must not require Homebrew only to repair optional Metal resources',
);
assert.ok(
  installer.includes('if [ $setup_rc -eq 2 ]; then')
    && installer.includes('brew_install_formula whisper-cpp'),
  'Homebrew must remain available only as the last fallback when the primary ASR package install fails',
);
assert.ok(
  installer.includes('run_or_skip_local_asr_validation'),
  'the installer must retain real inference validation before reporting success',
);

console.log('plugin macOS ASR installer behavior tests passed');
