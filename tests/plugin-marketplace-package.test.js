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
const releaseWorkflowPath = path.resolve(__dirname, '../.github/workflows/release.yml');
const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, 'utf8');

assert.strictEqual(manifest.id, 'wechat-inbox-sync');
assert.strictEqual(manifest.id.includes('obsidian'), false);
assert.strictEqual(manifest.name, 'WeChat Inbox Sync');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
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
assert.ok(releaseWorkflow.includes('tags:'));
assert.ok(releaseWorkflow.includes('obsidian-plugin/wechat-inbox-sync'));
assert.ok(releaseWorkflow.includes('manifest_version="$(node -p'));
assert.ok(releaseWorkflow.includes('if [ "$manifest_version" != "$TAG_NAME" ]; then'));
assert.ok(releaseWorkflow.includes('zip -r "$ZIP_NAME" main.js manifest.json styles.css versions.json README.md LICENSE local-asr'));
assert.ok(releaseWorkflow.includes('gh release create "$TAG_NAME"'));
assert.ok(releaseWorkflow.includes('gh release upload "$TAG_NAME"'));
assert.ok(windowsInstaller.includes('$ChunkSeconds = 120'));
assert.ok(windowsInstaller.includes('$ChunkRetrySeconds = 30'));
assert.ok(windowsInstaller.includes('"-f", "segment"'));
assert.ok(windowsInstaller.includes('"-segment_time", [string]$SegmentSeconds'));
assert.ok(windowsInstaller.includes('function Split-AudioToChunks'));
assert.ok(windowsInstaller.includes('function Test-TranscriptHasRepeatHallucination'));
assert.ok(windowsInstaller.includes('function Invoke-RecoverRepeatedChunkText'));
assert.ok(windowsInstaller.includes('chunkCount='));
assert.ok(windowsInstaller.includes('recoveryTriggered='));
assert.ok(windowsInstaller.includes('transcribe-last.log'));
assert.ok(windowsInstaller.includes('progressStage='));
assert.ok(windowsInstaller.includes('progressCurrent='));
assert.ok(windowsInstaller.includes('progressTotal='));
assert.ok(windowsInstaller.includes('progressPercent='));
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
assert.ok(windowsInstaller.includes('ConvertTo-SimplifiedChinese'));
assert.ok(windowsInstaller.includes('SimplifiedChinese'));
assert.ok(windowsInstaller.includes('$SimplifiedPrompt'));
assert.strictEqual(windowsInstaller.includes('"--prompt", "请输出简体中文"'), false);
assert.ok(windowsInstaller.includes('"--prompt"'));
assert.strictEqual(windowsInstaller.includes('Get-Content -LiteralPath $chunkTxt -Raw'), false);
assert.strictEqual(windowsInstaller.includes('& $Whisper.FullName -m $Model'), false);
assert.strictEqual(windowsInstaller.includes('& $Ffmpeg.FullName -hide_banner'), false);
assert.ok(windowsInstaller.includes('Assert-DownloadedFile'));
assert.ok(windowsInstaller.includes('Assert-InstalledFile'));
assert.ok(windowsInstaller.includes('Install-ExtractedPackage'));
assert.ok(windowsInstaller.includes('Find-InstalledFile -Root $StageDir -Names $ExpectedFiles'));
assert.strictEqual(windowsInstaller.includes('Move-Item -LiteralPath $FfmpegStageDir -Destination $FfmpegDir'), false);
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
assert.ok(windowsInstaller.includes('$CacheRoot = Join-Path $InstallRoot "cache"'));
assert.ok(windowsInstaller.includes('$InstallStatePath = Join-Path $InstallRoot ".install-state.json"'));
assert.ok(windowsInstaller.includes('$InstallerScriptVersion = "1.2.18"'));
assert.ok(windowsInstaller.includes('$DownloadLowSpeedLimitBytesPerSecond = 10240'));
assert.ok(windowsInstaller.includes('$DownloadLowSpeedTimeoutSeconds = 180'));
assert.ok(windowsInstaller.includes('$InstallLockPath = Join-Path $InstallRoot ".install.lock"'));
assert.ok(windowsInstaller.includes('function Acquire-InstallLock'));
assert.ok(windowsInstaller.includes('function Release-InstallLock'));
assert.ok(windowsInstaller.includes('function Copy-FileWithRetry'));
assert.ok(windowsInstaller.includes('function Prepare-ZipForExtraction'));
assert.ok(windowsInstaller.includes('function Download-ZipToCacheOrTemp'));
assert.ok(windowsInstaller.includes('$installMutex = Acquire-InstallLock'));
assert.ok(windowsInstaller.includes('Release-InstallLock -Mutex $installMutex'));
assert.ok(windowsInstaller.includes('Prepare-ZipForExtraction -ZipPath $cacheFile -TempRoot $TempRoot -Label $Label -FallbackUrl $url'));
assert.ok(windowsInstaller.includes('Download-ZipToCacheOrTemp -Url $url -CachePath $cacheFile -TempPath $downloadTempPath'));
assert.ok(windowsInstaller.includes('Expand-Archive -LiteralPath $extractZipPath'));
assert.ok(windowsInstaller.includes('LowSpeedLimit'));
assert.ok(windowsInstaller.includes('LowSpeedTime'));
assert.ok(windowsInstaller.includes('function Read-InstallState'));
assert.ok(windowsInstaller.includes('function Write-InstallState'));
assert.ok(windowsInstaller.includes('function Test-InstallStateValid'));
assert.ok(windowsInstaller.includes('function Invoke-LocalAsrValidation'));
assert.ok(windowsInstaller.includes('Local ASR was already validated for the current files; skipping full inference validation.'));
assert.ok(windowsInstaller.includes('Join-Path $CacheRoot "whisper.zip"'));
assert.ok(windowsInstaller.includes('Join-Path $CacheRoot "ffmpeg.zip"'));
assert.ok(windowsInstaller.includes('Join-Path $CacheRoot "ggml-small.bin"'));
assert.ok(windowsInstaller.includes('Download-File -Url $Url -OutFile $CachePath -Resume'));
assert.ok(windowsInstaller.includes('Resuming partial cached $Label package'));
assert.ok(windowsInstaller.includes('Keeping partial $Label package for retry'));
assert.ok(windowsInstaller.includes('Copy-Item -LiteralPath $cachedModelPath -Destination $modelPath -Force'));
assert.ok(windowsInstaller.includes('hf-mirror.com/ggerganov/whisper.cpp'));
assert.ok(windowsInstaller.includes('$ModelUrls'));
assert.ok(
  windowsInstaller.indexOf('https://hf-mirror.com/ggerganov/whisper.cpp') <
    windowsInstaller.indexOf('https://huggingface.co/ggerganov/whisper.cpp'),
  'Windows installer should try the Hugging Face mirror before the primary Hugging Face host',
);
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
assert.ok(transcribeScriptTemplate.includes('function Convert-ExitCodeToHex'));
assert.ok(transcribeScriptTemplate.includes('function Get-ShortPath'));
assert.ok(transcribeScriptTemplate.includes('function Split-AudioToChunks'));
assert.ok(transcribeScriptTemplate.includes('function Test-TranscriptHasRepeatHallucination'));
assert.ok(transcribeScriptTemplate.includes('function Invoke-RecoverRepeatedChunkText'));
assert.ok(transcribeScriptTemplate.includes('function Test-WhisperNativeCrashExitCode'));
assert.ok(transcribeScriptTemplate.includes('$hex = Convert-ExitCodeToHex -ExitCode $ExitCode'));
assert.ok(transcribeScriptTemplate.includes('$ChunkSeconds = 120'));
assert.ok(transcribeScriptTemplate.includes('$ChunkRetrySeconds = 30'));
assert.ok(transcribeScriptTemplate.includes('recoveryTriggered='));
assert.strictEqual(transcribeScriptTemplate.includes('[uint32]($ExitCode -band 0xffffffff)'), false);
assert.ok(transcribeScriptTemplate.includes('Invoke-TranscribeAttempt -Mode "normal"'));
assert.ok(transcribeScriptTemplate.includes('Invoke-TranscribeAttempt -Mode "safe"'));
assert.ok(transcribeScriptTemplate.includes('safeModelPath'));
assert.ok(transcribeScriptTemplate.includes('if ($Mode -eq "safe")'));
assert.strictEqual(transcribeScriptTemplate.includes('$SafeTempRoot = New-SafeTempDirectory'), false);
assert.ok(transcribeScriptTemplate.includes('function Invoke-NativeProcess'));
assert.ok(transcribeScriptTemplate.includes('Start-Process'));
assert.ok(transcribeScriptTemplate.includes('-RedirectStandardOutput $stdoutPath'));
assert.ok(transcribeScriptTemplate.includes('ConvertTo-SimplifiedChinese'));
assert.ok(transcribeScriptTemplate.includes('SimplifiedChinese'));
assert.ok(transcribeScriptTemplate.includes('$SimplifiedPrompt'));
assert.strictEqual(transcribeScriptTemplate.includes('"--prompt", "请输出简体中文"'), false);
assert.ok(transcribeScriptTemplate.includes('"--prompt"'));
assert.strictEqual(transcribeScriptTemplate.includes('DataReceivedEventHandler'), false);
assert.strictEqual(transcribeScriptTemplate.includes('BeginOutputReadLine'), false);
assert.ok(windowsInstaller.includes('Assert-LocalAsrInference'));
assert.ok(windowsInstaller.includes('"-f", "lavfi"'));
assert.ok(windowsInstaller.includes('validation.wav'));
assert.ok(windowsInstaller.includes('Local ASR inference validation passed'));
assert.ok(macInstaller.includes('install_python_local_asr_tools'));
assert.ok(macInstaller.includes('whisper.cpp-cli'));
assert.ok(macInstaller.includes('imageio-ffmpeg'));
assert.ok(macInstaller.includes('python-venv'));
assert.ok(macInstaller.includes('create_python_venv'));
assert.ok(macInstaller.includes('INSTALL_STATE_PATH="$INSTALL_ROOT/.install-state.json"'));
assert.ok(macInstaller.includes('INSTALLER_SCRIPT_VERSION="1.2.16"'));
assert.ok(macInstaller.includes('DOWNLOAD_LOW_SPEED_LIMIT=10240'));
assert.ok(macInstaller.includes('DOWNLOAD_LOW_SPEED_TIME=180'));
assert.ok(macInstaller.includes('--speed-limit "$DOWNLOAD_LOW_SPEED_LIMIT"'));
assert.ok(macInstaller.includes('--speed-time "$DOWNLOAD_LOW_SPEED_TIME"'));
assert.ok(macInstaller.includes('CACHE_ROOT="$INSTALL_ROOT/cache"'));
assert.ok(macInstaller.includes('reuse_python_venv'));
assert.ok(macInstaller.includes('Reusing existing portable macOS ASR tools.'));
assert.strictEqual(macInstaller.includes('rm -rf "$venv_dir"'), false);
assert.ok(macInstaller.includes('Local ASR was already validated for the current files; skipping full inference validation.'));
assert.ok(macInstaller.includes('download_model "$CACHE_ROOT/ggml-small.bin"'));
assert.ok(macInstaller.includes('cp -f "$CACHE_ROOT/ggml-small.bin" "$MODEL_PATH"'));
assert.ok(macInstaller.includes('assert_executable_runs'));
assert.ok(macInstaller.includes('validate_local_asr_inference'));
assert.ok(macInstaller.includes('Local ASR inference validation passed'));
assert.ok(macInstaller.includes('exec "\\$WHISPER_CPP_BIN" "\\$@"'));
assert.strictEqual(macInstaller.includes('-m whisper_cpp'), false);
assert.ok(macInstaller.includes('brew_install_formula ffmpeg'));
assert.ok(
  macInstaller.indexOf('if ! install_python_local_asr_tools; then') <
    macInstaller.indexOf('brew_install_formula ffmpeg'),
  'macOS installer should only use Homebrew ffmpeg after the portable Python path fails',
);
assert.ok(macInstaller.includes('brew_install_formula whisper-cpp'));
assert.strictEqual(macInstaller.includes('brew reinstall whisper-cpp'), false);
assert.ok(macInstaller.includes('hf-mirror.com/ggerganov/whisper.cpp'));
assert.ok(
  macInstaller.indexOf('MODEL_MIRROR_URL=') <
    macInstaller.indexOf('MODEL_URL='),
  'macOS installer should define the mirror before the primary Hugging Face host',
);
assert.ok(macInstaller.includes('No Terminal command is required.'));
assert.ok(macInstaller.includes('CHUNK_SECONDS=600'));
assert.ok(macInstaller.includes('-f segment -segment_time "$CHUNK_SECONDS"'));
assert.ok(macInstaller.includes('SIMPLIFIED_PROMPT="$(printf'));
assert.ok(macInstaller.includes('--prompt "$SIMPLIFIED_PROMPT"'));
assert.strictEqual(macInstaller.includes('--prompt "请输出简体中文"'), false);
assert.ok(macInstaller.includes('Homebrew is busy installing another package'));
assert.ok(macInstaller.includes('chunkCount='));
assert.ok(macInstaller.includes('transcribe-last.log'));
assert.ok(macInstaller.includes('progressStage='));
assert.ok(macInstaller.includes('progressCurrent='));
assert.ok(macInstaller.includes('progressTotal='));
assert.ok(macInstaller.includes('progressPercent='));
