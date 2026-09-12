'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
function shellFunction(source, name) {
  const start = source.indexOf(name + '() {');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}\n', start) + 3);
}
let checks = 0;
for (const [file, kind, entry] of [
  ['local-ocr/install-local-ocr-macos.sh', 'ocr', 'install_ocr_packages_with_python'],
  ['local-asr/install-local-asr-macos.sh', 'asr', 'install_asr_packages'],
]) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const syntax = cp.spawnSync(bash, ['-n'], { input: source, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  for (const success of ['wheel', 'tencent', 'official', 'none']) {
    const script = [
      'set -euo pipefail',
      'TENCENT_PIP_INDEX_URL=tencent; PYPI_FALLBACK_INDEX_URL=official',
      kind.toUpperCase() + '_PACKAGE_REQUIREMENTS=(fixture)',
      'log() { echo "$*"; }',
      'install_' + kind + '_packages_from_wheelhouse() { echo CALL:wheel; [ "' + success + '" = wheel ]; }',
      'fake_python() { if [ "$2" = ensurepip ]; then return 0; fi; local label=official; case " $* " in *" -i tencent "*) label=tencent;; esac; echo CALL:$label; [ "' + success + '" = "$label" ]; }',
      shellFunction(source, entry),
      entry + ' fake_python',
    ].join('\n');
    const result = cp.spawnSync(bash, ['-s'], { input: script, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, success === 'none' ? 1 : 0, result.stderr);
    assert.deepEqual(result.stdout.split(/\r?\n/).filter(x => x.startsWith('CALL:')),
      success === 'wheel' ? ['CALL:wheel'] : success === 'tencent' ? ['CALL:wheel', 'CALL:tencent'] : ['CALL:wheel', 'CALL:tencent', 'CALL:official']);
    checks++;
  }
  assert.ok(!source.includes('--extra-index-url'), file + ' must use sequential sources');
  assert.ok(!source.includes('pip install --upgrade pip'), 'no unnecessary online pip upgrade');
}
if (process.platform === 'win32') {
  const source = fs.readFileSync(path.join(root, 'local-ocr/install-local-ocr.ps1'), 'utf8');
  const start = source.indexOf('function Install-OcrPackagesWithPip {');
  const fn = source.slice(start, source.indexOf('\nfunction Install-OcrCompatibilityPackages', start));
  for (const success of ['wheel', 'tencent', 'official', 'none', 'wheel-throws']) {
    const script = [
      '$ErrorActionPreference="Stop"',
      '$script:calls=[System.Collections.Generic.List[string]]::new()',
      '$TencentPipIndexUrl="tencent"; $PypiFallbackIndexUrl="official"; $OcrPackageRequirements=@("fixture")',
      'function Write-InstallLog { param($Message) }',
      'function Install-OcrPackagesFromWheelhouse { param($PythonPath) $script:calls.Add("wheel"); if ("' + success + '" -eq "wheel-throws") {throw "synthetic download failure"}; return ("' + success + '" -eq "wheel") }',
      'function Invoke-NativeCommand { param($FilePath,$Arguments) $label=if($Arguments -contains "tencent"){"tencent"}else{"official"}; $script:calls.Add($label); if("' + success + '" -eq $label -or "' + success + '" -eq "wheel-throws"){return 0}; return 1 }',
      fn,
      '$ok=Install-OcrPackagesWithPip -PythonPath fixture',
      '@{ok=$ok; calls=@($script:calls.ToArray())} | ConvertTo-Json -Compress',
    ].join('\n');
    const result = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.ok, success !== 'none');
    assert.deepEqual(output.calls, success === 'wheel' ? ['wheel'] : ['tencent', 'wheel-throws'].includes(success) ? ['wheel', 'tencent'] : ['wheel', 'tencent', 'official']);
    checks++;
  }
  assert.ok(!source.includes('--extra-index-url'));
}
console.log('component download priority: ' + checks + ' behavioral cases passed');
