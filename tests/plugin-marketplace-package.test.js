const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pluginDir = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
const versions = JSON.parse(fs.readFileSync(path.join(pluginDir, 'versions.json'), 'utf8'));
const readme = fs.readFileSync(path.join(pluginDir, 'README.md'), 'utf8');
const license = fs.readFileSync(path.join(pluginDir, 'LICENSE'), 'utf8');
const checklist = fs.readFileSync(path.join(pluginDir, 'RELEASE_CHECKLIST.md'), 'utf8');
const windowsInstaller = fs.readFileSync(path.join(pluginDir, 'local-asr/install-local-asr.ps1'), 'utf8');
const macInstaller = fs.readFileSync(path.join(pluginDir, 'local-asr/install-local-asr-macos.sh'), 'utf8');

assert.strictEqual(manifest.id, 'wechat-inbox-sync');
assert.strictEqual(manifest.id.includes('obsidian'), false);
assert.strictEqual(manifest.name, 'WeChat Inbox Sync');
assert.strictEqual(manifest.version, '1.1.21');
assert.strictEqual(manifest.minAppVersion, '1.0.0');
assert.strictEqual(manifest.isDesktopOnly, true);
assert.strictEqual(versions[manifest.version], manifest.minAppVersion);

['main.js', 'manifest.json', 'styles.css', 'versions.json', 'README.md', 'LICENSE', 'local-asr/install-local-asr.ps1', 'local-asr/install-local-asr-macos.sh', 'local-asr/README.md'].forEach((fileName) => {
  assert.strictEqual(fs.existsSync(path.join(pluginDir, fileName)), true, `${fileName} should exist`);
});

assert.ok(readme.includes('## Privacy'));
assert.ok(readme.includes('## Installation'));
assert.ok(readme.includes('## Configuration'));
assert.ok(readme.includes('WeChat mini program'));
assert.ok(license.includes('MIT License'));
assert.ok(checklist.includes('community-plugins.json'));
assert.ok(checklist.includes('"id": "wechat-inbox-sync"'));
assert.ok(windowsInstaller.includes('$ChunkSeconds = 600'));
assert.ok(windowsInstaller.includes('"-f", "segment"'));
assert.ok(windowsInstaller.includes('"-segment_time", [string]$ChunkSeconds'));
assert.ok(windowsInstaller.includes('chunkCount='));
assert.ok(windowsInstaller.includes('transcribe-last.log'));
assert.ok(windowsInstaller.includes('function Invoke-NativeProcess'));
assert.ok(windowsInstaller.includes('function ConvertTo-NativeArgument'));
assert.ok(windowsInstaller.includes('RedirectStandardError'));
assert.ok(windowsInstaller.includes('Invoke-NativeProcess -FilePath $Path -Arguments $Arguments'));
assert.ok(windowsInstaller.includes('Start-Process'));
assert.ok(windowsInstaller.includes('-RedirectStandardOutput $stdoutPath'));
assert.strictEqual(windowsInstaller.includes('$output = & $Path @Arguments 2>&1 | Out-String'), false);
assert.ok(windowsInstaller.includes('System.Text.UTF8Encoding'));
assert.ok(windowsInstaller.includes('ReadAllText($chunkTxt, $Utf8NoBom)'));
assert.ok(windowsInstaller.includes('WriteAllText($OutputPath'));
assert.strictEqual(windowsInstaller.includes('Get-Content -LiteralPath $chunkTxt -Raw'), false);
assert.strictEqual(windowsInstaller.includes('& $Whisper.FullName -m $Model'), false);
assert.strictEqual(windowsInstaller.includes('& $Ffmpeg.FullName -hide_banner'), false);
assert.ok(windowsInstaller.includes('Assert-DownloadedFile'));
assert.ok(windowsInstaller.includes('Assert-InstalledFile'));
assert.ok(windowsInstaller.includes('Assert-ExecutableRuns'));
assert.ok(windowsInstaller.includes('Install-VcRuntime'));
assert.ok(windowsInstaller.includes('https://aka.ms/vs/17/release/vc_redist.x64.exe'));
assert.ok(windowsInstaller.includes('0xC0000135'));
assert.ok(windowsInstaller.includes('Local ASR install validation passed'));
assert.ok(windowsInstaller.includes('Write-TranscribeScript -InstallRoot $InstallRoot'));
assert.ok(windowsInstaller.includes('$PSCommandPath'));
assert.strictEqual(windowsInstaller.includes('[System.IO.File]::ReadAllText($MyInvocation.MyCommand.Path)'), false);
assert.ok(windowsInstaller.includes('Existing whisper.cpp is usable; skipping download.'));
assert.ok(windowsInstaller.includes('Existing ffmpeg is usable; skipping download.'));
assert.ok(
  windowsInstaller.indexOf('Write-TranscribeScript -InstallRoot $InstallRoot') <
    windowsInstaller.indexOf('-Urls @((Get-LatestWhisperWindowsAsset))'),
  'Windows installer should refresh transcribe.ps1 before heavy downloads or runtime validation',
);
const templateStart = windowsInstaller.lastIndexOf('# BEGIN_TRANSCRIBE_TEMPLATE');
const templateEnd = windowsInstaller.lastIndexOf('# END_TRANSCRIBE_TEMPLATE');
assert.ok(templateStart >= 0);
assert.ok(templateEnd > templateStart);
const templateBlock = windowsInstaller.slice(templateStart, templateEnd);
const transcribeScriptTemplate = templateBlock.split("@'")[1] || '';
assert.ok(transcribeScriptTemplate.includes('function ConvertTo-NativeArgument'));
assert.ok(transcribeScriptTemplate.includes('function Invoke-NativeProcess'));
assert.ok(macInstaller.includes('brew_install_formula whisper-cpp'));
assert.ok(macInstaller.includes('brew reinstall whisper-cpp'));
assert.ok(macInstaller.includes('hf-mirror.com/ggerganov/whisper.cpp'));
assert.ok(macInstaller.includes('No Terminal command is required.'));
assert.ok(macInstaller.includes('CHUNK_SECONDS=600'));
assert.ok(macInstaller.includes('-f segment -segment_time "$CHUNK_SECONDS"'));
assert.ok(macInstaller.includes('chunkCount='));
assert.ok(macInstaller.includes('transcribe-last.log'));
