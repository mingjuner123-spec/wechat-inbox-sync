const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pluginDir = path.resolve(__dirname, '../obsidian-plugin/wechat-inbox-sync');
const repoRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
const versions = JSON.parse(fs.readFileSync(path.join(pluginDir, 'versions.json'), 'utf8'));
const rootManifestPath = path.join(repoRoot, 'manifest.json');
const rootVersionsPath = path.join(repoRoot, 'versions.json');
const readme = fs.readFileSync(path.join(pluginDir, 'README.md'), 'utf8');
const license = fs.readFileSync(path.join(pluginDir, 'LICENSE'), 'utf8');
const checklist = fs.readFileSync(path.join(pluginDir, 'RELEASE_CHECKLIST.md'), 'utf8');
const windowsInstaller = fs.readFileSync(path.join(pluginDir, 'local-asr/install-local-asr.ps1'), 'utf8');
const windowsCompatibilityBuildScript = fs.readFileSync(
  path.join(repoRoot, 'scripts', 'build-windows-whisper-compat.ps1'),
  'utf8',
);
const macInstaller = fs.readFileSync(path.join(pluginDir, 'local-asr/install-local-asr-macos.sh'), 'utf8');
const windowsOcrInstaller = fs.readFileSync(path.join(pluginDir, 'local-ocr/install-local-ocr.ps1'), 'utf8');
const macOcrInstaller = fs.readFileSync(path.join(pluginDir, 'local-ocr/install-local-ocr-macos.sh'), 'utf8');
const localOcrScript = fs.readFileSync(path.join(pluginDir, 'local-ocr/ocr_image.py'), 'utf8');
const releaseWorkflowPath = path.resolve(__dirname, '../.github/workflows/release.yml');
const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
const gitAttributes = fs.readFileSync(path.resolve(__dirname, '../.gitattributes'), 'utf8');
const cdnVerifierPath = path.resolve(__dirname, '../scripts/check-local-components-cdn.js');
const cdnVerifier = fs.existsSync(cdnVerifierPath) ? fs.readFileSync(cdnVerifierPath, 'utf8') : '';
const marketplacePromise = '把微信中收集的公众号文章、飞书文档、小红书、抖音、B站、小宇宙等网页链接、PDF、MP3、MP4 等文件和速记，一键同步到本地知识库，自动整理为可检索笔记.';

assert.strictEqual(manifest.id, 'wechat-inbox-sync');
assert.strictEqual(manifest.id.includes('obsidian'), false);
assert.strictEqual(manifest.name, 'WeChat Inbox Sync');
assert.strictEqual(manifest.version, '1.3.52');
assert.strictEqual(manifest.description, marketplacePromise);
assert.strictEqual(/\bObsidian\b/i.test(manifest.description), false, 'marketplace descriptions must not repeat the product name');
assert.match(manifest.description, /[.!?]$/, 'marketplace descriptions must end with accepted ASCII punctuation');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.strictEqual(manifest.minAppVersion, '1.0.0');
assert.strictEqual(manifest.isDesktopOnly, true);
assert.strictEqual(versions[manifest.version], manifest.minAppVersion);
assert.strictEqual(fs.existsSync(rootManifestPath), true, 'root manifest.json should exist for Obsidian marketplace version indexing');
assert.strictEqual(fs.existsSync(rootVersionsPath), true, 'root versions.json should exist for Obsidian marketplace version indexing');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(rootManifestPath, 'utf8')), manifest);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(rootVersionsPath, 'utf8')), versions);

['main.js', 'manifest.json', 'styles.css', 'versions.json', 'README.md', 'LICENSE', 'local-asr/install-local-asr.ps1', 'local-asr/install-local-asr-macos.sh', 'local-asr/README.md', 'local-ocr/install-local-ocr.ps1', 'local-ocr/install-local-ocr-macos.sh', 'local-ocr/ocr_image.py', 'local-ocr/README.md'].forEach((fileName) => {
  assert.strictEqual(fs.existsSync(path.join(pluginDir, fileName)), true, `${fileName} should exist`);
});
assert.strictEqual(fs.existsSync(path.join(pluginDir, 'local-ocr/__pycache__')), false, 'local OCR package should not include Python cache files');

assert.ok(readme.includes('## Privacy'));
assert.ok(readme.includes('## Installation'));
assert.ok(readme.includes('## Configuration'));
assert.ok(readme.includes('WeChat mini program'));
assert.ok(readme.includes(marketplacePromise));
assert.ok(license.includes('MIT License'));
assert.ok(checklist.includes('community-plugins.json'));
assert.ok(checklist.includes('"id": "wechat-inbox-sync"'));
assert.ok(checklist.includes('本机已安装或已打包的候选版本也视为已占用'));
assert.ok(releaseWorkflow.includes('tags:'));
assert.ok(releaseWorkflow.includes('obsidian-plugin/wechat-inbox-sync'));
assert.ok(releaseWorkflow.includes('manifest_version="$(node -p'));
assert.ok(releaseWorkflow.includes('root_manifest_version="$(node -p'));
assert.ok(releaseWorkflow.includes('subdir manifest.json version'));
assert.ok(releaseWorkflow.includes('root manifest.json version'));
assert.ok(releaseWorkflow.includes('if [ "$manifest_version" != "$TAG_NAME" ]; then'));
assert.strictEqual(fs.existsSync(cdnVerifierPath), true, 'release must include a public CDN consistency verifier');
assert.ok(releaseWorkflow.includes('node scripts/check-local-components-cdn.js'), 'release must verify all component CDN assets before creating a GitHub Release');
assert.ok(cdnVerifier.includes('local-components-manifest.json'));
assert.ok(cdnVerifier.includes('compatibilityAlias'));
assert.ok(cdnVerifier.includes('immutablePath'));
assert.ok(cdnVerifier.includes('sha256'));
assert.ok(gitAttributes.includes('local-ocr/install-local-ocr.ps1 text eol=lf'));
assert.ok(gitAttributes.includes('local-ocr/install-local-ocr-macos.sh text eol=lf'));
assert.ok(gitAttributes.includes('local-ocr/ocr_image.py text eol=lf'));
assert.ok(releaseWorkflow.includes('zip -r "$ZIP_NAME" main.js manifest.json styles.css versions.json README.md LICENSE local-asr local-ocr'));
assert.ok(windowsOcrInstaller.includes('rapidocr-onnxruntime'));
assert.strictEqual(windowsOcrInstaller.includes('PyMuPDF'), false, 'Windows image OCR installer must not install the PDF renderer');
assert.strictEqual(windowsOcrInstaller.includes('opencc-python-reimplemented'), false, 'Windows image OCR installer must not install OpenCC');
assert.strictEqual(windowsOcrInstaller.includes("'fitz'"), false, 'Windows image OCR installer must not validate the PDF renderer');
assert.strictEqual(windowsOcrInstaller.includes("'opencc'"), false, 'Windows image OCR installer must not validate OpenCC');
assert.ok(windowsOcrInstaller.includes('ocr_image.py'));
assert.ok(windowsOcrInstaller.includes('$TencentOcrAssetBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common"'));
assert.ok(windowsOcrInstaller.includes('$TencentPipIndexUrl = "https://mirrors.cloud.tencent.com/pypi/simple"'));
assert.ok(windowsOcrInstaller.includes('$PypiFallbackIndexUrl = "https://pypi.org/simple"'));
assert.ok(windowsOcrInstaller.includes('$PythonBuildStandaloneBuild = "20260623"'));
assert.ok(windowsOcrInstaller.includes('$PythonBuildStandaloneVersion = "3.12.13+20260623"'));
assert.ok(windowsOcrInstaller.includes('$TencentPythonInstallMirror = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-python/python-build-standalone/releases/download"'));
assert.ok(windowsOcrInstaller.includes('$PythonRuntimeFileName = "cpython-$PythonBuildStandaloneVersion-x86_64-pc-windows-msvc-install_only.tar.gz"'));
assert.ok(windowsOcrInstaller.includes('$PythonRuntimeSha256 = "C6AF85BB83D5158C9FF71F50DFAD467853D1CD236F932B144E87E26E2EA2A83E"'));
assert.ok(windowsOcrInstaller.includes('function Install-PortablePython'));
assert.ok(windowsOcrInstaller.includes('Get-FileHash -Algorithm SHA256'));
assert.ok(windowsOcrInstaller.includes('tar.exe'));
assert.ok(windowsOcrInstaller.includes('sys.version_info >= (3, 10) and sys.version_info < (3, 13)'));
assert.strictEqual(windowsOcrInstaller.includes('$env:UV_PYTHON_INSTALL_MIRROR'), false, 'Windows OCR must not ask uv to resolve the mirrored Python runtime');
assert.strictEqual(windowsOcrInstaller.includes('& $UvExe python install 3.12'), false, 'Windows OCR must download the pinned Python runtime directly');
assert.ok(windowsOcrInstaller.includes('$OcrWheelhouseBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/wheels"'));
assert.ok(windowsOcrInstaller.includes('function Install-OcrPackagesFromWheelhouse'));
assert.ok(windowsOcrInstaller.includes('--no-index'));
assert.ok(windowsOcrInstaller.includes('--find-links'));
assert.ok(windowsOcrInstaller.indexOf('Install-OcrPackagesFromWheelhouse') < windowsOcrInstaller.indexOf('Tencent PyPI mirror install failed'));
assert.ok(windowsOcrInstaller.includes('Download-TextFile'));
assert.ok(windowsOcrInstaller.includes('Invoke-NativeCommand'));
assert.ok(windowsOcrInstaller.includes('$MicrosoftVisualCppRuntimeUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"'), 'Windows OCR installer must use the official Microsoft Visual C++ runtime installer');
assert.ok(windowsOcrInstaller.includes('function Test-OcrPythonImports'), 'Windows OCR installer must diagnose imports module by module');
assert.ok(windowsOcrInstaller.includes("{'stage': 'ocr-import'"), 'Windows PowerShell must pass the Python probe without stripping JSON string quotes');
assert.ok(windowsOcrInstaller.includes('function Test-MissingVisualCppRuntime'), 'Windows OCR installer must distinguish DLL/runtime failures from unrelated Python failures');
assert.ok(windowsOcrInstaller.includes('function Install-MicrosoftVisualCppRuntime'), 'Windows OCR installer must be able to repair a missing Visual C++ runtime');
assert.ok(windowsOcrInstaller.includes('Get-AuthenticodeSignature'), 'Downloaded Microsoft runtime installer must be signature-verified before execution');
assert.ok(windowsOcrInstaller.includes('-Verb RunAs'), 'Visual C++ runtime repair must request Windows elevation explicitly');
assert.ok(windowsOcrInstaller.includes('Visual C++ runtime repair finished; retrying OCR import validation.'), 'Windows OCR installer must retry validation after runtime repair');
assert.ok(windowsOcrInstaller.includes('$StagingVenvDir'), 'Windows OCR repair must build in a staging venv');
assert.ok(windowsOcrInstaller.includes('$BackupVenvDir'), 'Windows OCR repair must keep only a short-lived rollback venv');
assert.ok(windowsOcrInstaller.includes('$PendingSwitchPath'), 'Windows OCR repair must support restart-time activation when files are locked');
assert.ok(windowsOcrInstaller.includes('function Promote-StagedOcrEnvironment'), 'Windows OCR repair must promote a validated staging environment');
assert.ok(windowsOcrInstaller.includes('single-dir-transaction-v1'), 'Windows OCR installer must expose the single-directory transaction capability');
assert.strictEqual(
  windowsOcrInstaller.includes('Remove-Item -LiteralPath $VenvDir -Recurse -Force -ErrorAction SilentlyContinue'),
  false,
  'Windows OCR installer must not silently continue after failing to remove the active venv',
);
assert.strictEqual(windowsOcrInstaller.includes('& $UvExe pip install --upgrade pip 2>$null | Out-Host'), false);
assert.strictEqual(windowsOcrInstaller.includes('Please install Python 3.9-3.12'), false);
assert.ok(macOcrInstaller.includes('rapidocr-onnxruntime'));
assert.strictEqual(macOcrInstaller.includes('PyMuPDF'), false, 'macOS image OCR installer must not install the PDF renderer');
assert.strictEqual(macOcrInstaller.includes('opencc-python-reimplemented'), false, 'macOS image OCR installer must not install OpenCC');
assert.strictEqual(macOcrInstaller.includes('import fitz, opencc'), false, 'macOS image OCR installer must not validate PDF and OpenCC imports');
assert.ok(macOcrInstaller.includes('TENCENT_BASE_URL="https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com"'));
assert.ok(macOcrInstaller.includes('stage=ocr_script'));
assert.ok(macOcrInstaller.includes('status=failed'));
assert.ok(macOcrInstaller.indexOf('install_ocr_script ||') < macOcrInstaller.indexOf('setup_python_venv ||'));
assert.ok(macOcrInstaller.includes('TENCENT_OCR_ASSET_BASE_URL="${TENCENT_BASE_URL}/local-ocr/common"'));
assert.ok(macOcrInstaller.includes('TENCENT_PIP_INDEX_URL="https://mirrors.cloud.tencent.com/pypi/simple"'));
assert.ok(macOcrInstaller.includes('PYPI_FALLBACK_INDEX_URL="https://pypi.org/simple"'));
assert.ok(macOcrInstaller.includes('PYTHON_BUILD_STANDALONE_BUILD="20260623"'));
assert.ok(macOcrInstaller.includes('PYTHON_BUILD_STANDALONE_VERSION="3.12.13+20260623"'));
assert.ok(macOcrInstaller.includes('TENCENT_PYTHON_INSTALL_MIRROR="${TENCENT_BASE_URL}/local-python/python-build-standalone/releases/download"'));
assert.ok(macOcrInstaller.indexOf('PYTHON_RUNTIME_DIR="${INSTALL_ROOT}/python-runtime"') < macOcrInstaller.indexOf('PORTABLE_PYTHON="${PYTHON_RUNTIME_DIR}/python/bin/python3"'));
assert.ok(macOcrInstaller.includes('PYTHON_RUNTIME_SHA256_ARM64="3724AA4DAFB5F7B6C2CF98E89914E4248DC6BD2FE40407DF4A2D73DE99615F16"'));
assert.ok(macOcrInstaller.includes('PYTHON_RUNTIME_SHA256_X64="7C57FDD1FA675190093700EB0D8E7117E1F9EAE7C30A46DEA5F8D5266BCFC791"'));
assert.ok(macOcrInstaller.includes('install_portable_python'));
assert.ok(macOcrInstaller.includes('shasum -a 256'));
assert.ok(macOcrInstaller.includes('tar -xzf'));
assert.ok(macOcrInstaller.includes('(3, 10) <= sys.version_info < (3, 13)'));
assert.strictEqual(macOcrInstaller.includes('UV_PYTHON_INSTALL_MIRROR'), false, 'macOS OCR must not ask uv to resolve the mirrored Python runtime');
assert.strictEqual(macOcrInstaller.includes('"$UV_BIN" python install 3.12'), false, 'macOS OCR must download the pinned Python runtime directly');
assert.ok(macOcrInstaller.includes('OCR_WHEELHOUSE_BASE_URL="${TENCENT_BASE_URL}/local-ocr/wheels"'));
assert.ok(macOcrInstaller.includes('install_ocr_packages_from_wheelhouse'));
assert.ok(macOcrInstaller.includes('macosx_11_0_arm64'));
assert.ok(macOcrInstaller.includes('macosx_11_0_x86_64'));
assert.ok(macOcrInstaller.includes('--no-index'));
assert.ok(macOcrInstaller.includes('--find-links'));
assert.ok(macOcrInstaller.indexOf('install_ocr_packages_from_wheelhouse') < macOcrInstaller.indexOf('Tencent PyPI mirror install failed'));
assert.ok(macOcrInstaller.includes('download_text_file'));
assert.ok(cdnVerifier.includes('cpython-3.12.13+20260623-x86_64-pc-windows-msvc-install_only.tar.gz'));
assert.ok(cdnVerifier.includes('cpython-3.12.13+20260623-aarch64-apple-darwin-install_only.tar.gz'));
assert.ok(cdnVerifier.includes('cpython-3.12.13+20260623-x86_64-apple-darwin-install_only.tar.gz'));
assert.ok(cdnVerifier.includes('C6AF85BB83D5158C9FF71F50DFAD467853D1CD236F932B144E87E26E2EA2A83E'));
assert.ok(cdnVerifier.includes('3724AA4DAFB5F7B6C2CF98E89914E4248DC6BD2FE40407DF4A2D73DE99615F16'));
assert.ok(cdnVerifier.includes('7C57FDD1FA675190093700EB0D8E7117E1F9EAE7C30A46DEA5F8D5266BCFC791'));
assert.ok(localOcrScript.includes('RapidOCR'));
assert.strictEqual(localOcrScript.includes('pdf-page-ocr-v1'), false, 'local image OCR runtime must not advertise PDF support');
assert.strictEqual(localOcrScript.includes('import fitz'), false, 'local image OCR runtime must not render PDF pages');
assert.strictEqual(localOcrScript.includes('from opencc import OpenCC'), false, 'local image OCR runtime must not require OpenCC');
assert.ok(releaseWorkflow.includes('gh release create "$TAG_NAME"'));
assert.ok(releaseWorkflow.includes('gh release upload "$TAG_NAME"'));
assert.ok(windowsInstaller.includes('$ChunkSeconds = 120'));
assert.ok(windowsCompatibilityBuildScript.includes('-DGGML_NATIVE=OFF'));
assert.ok(windowsCompatibilityBuildScript.includes('-DGGML_SSE42=OFF'));
assert.ok(windowsCompatibilityBuildScript.includes('-DGGML_BMI2=OFF'));
assert.ok(windowsCompatibilityBuildScript.includes('-DGGML_AVX2=OFF'));
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
assert.ok(windowsInstaller.includes('$TranscriptQualityGuardVersion = "repeat-guard-v2"'));
assert.strictEqual(windowsInstaller.includes('"--prompt", "请输出简体中文"'), false);
assert.strictEqual(windowsInstaller.includes('"--prompt"'), false);
assert.ok(windowsInstaller.includes('TRANSCRIPT_HALLUCINATION'));
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
assert.ok(windowsInstaller.includes('$InstallerScriptVersion = "1.2.23"'));
assert.ok(windowsInstaller.includes('$TencentCosAssetBaseUrl = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/windows"'));
assert.ok(windowsInstaller.includes('$WhisperWindowsTencentUrls = @()'));
assert.ok(windowsInstaller.includes('$WhisperWindowsCompatibilityUrls = @()'));
assert.ok(windowsInstaller.includes('$FfmpegTencentUrls = @()'));
assert.ok(windowsInstaller.includes('$ModelTencentUrls = @()'));
assert.ok(windowsInstaller.includes('function Get-EnabledAssetUrls'));
assert.ok(windowsInstaller.includes('Skipping invalid primary asset URL'));
assert.ok(windowsInstaller.includes('-PrimaryUrls $WhisperWindowsTencentUrls -FallbackUrls $WhisperWindowsFallbackUrls'));
assert.ok(windowsInstaller.includes('-PrimaryUrls $FfmpegTencentUrls'));
assert.ok(windowsInstaller.includes('-PrimaryUrls $ModelTencentUrls -FallbackUrls $ModelFallbackUrls'));
assert.ok(windowsInstaller.includes('$WhisperWindowsFallbackUrls'));
assert.ok(windowsInstaller.includes('whisper-bin-x64-compat.zip'));
assert.ok(windowsInstaller.includes('$WhisperWindowsCompatibilitySha256'));
assert.ok(windowsInstaller.includes('Assert-FileSha256 -Path $compatibilityZip'));
assert.ok(windowsInstaller.includes('function Test-IllegalInstructionExitCode'));
assert.ok(windowsInstaller.includes('0xC000001D'));
assert.ok(windowsInstaller.includes('Current whisper.cpp uses unsupported CPU instructions; trying the compatibility build.'));
assert.ok(windowsInstaller.includes('Join-Path $CacheRoot "whisper-compat.zip"'));
assert.ok(windowsInstaller.includes('https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.0/whisper-bin-x64.zip'));
assert.ok(windowsInstaller.includes('GitHub release page parsing failed'));
assert.ok(windowsInstaller.includes('INSTALLER FAILED'));
assert.ok(windowsInstaller.includes('$DownloadLowSpeedLimitBytesPerSecond = 10240'));
assert.ok(windowsInstaller.includes('$DownloadLowSpeedTimeoutSeconds = 90'));
assert.ok(windowsInstaller.includes('$DownloadTimeoutSeconds = 1200'));
assert.ok(windowsInstaller.includes('--max-time $DownloadTimeoutSeconds'));
assert.ok(windowsInstaller.includes('-TimeoutSec $DownloadTimeoutSeconds'));
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
assert.ok(windowsInstaller.includes('Remove-Item -LiteralPath $cachedModelPath -Force -ErrorAction SilentlyContinue'));
assert.ok(
  windowsInstaller.indexOf('Invoke-LocalAsrValidation -WhisperPath $installedWhisper.FullName -FfmpegPath $installedFfmpeg.FullName -ModelPath $modelPath') <
    windowsInstaller.indexOf('Remove-Item -LiteralPath $cachedModelPath -Force -ErrorAction SilentlyContinue'),
  'Windows installer should only remove the cached model after validation succeeds',
);
assert.ok(windowsInstaller.includes('hf-mirror.com/ggerganov/whisper.cpp'));
assert.ok(windowsInstaller.includes('$ModelFallbackUrls'));
assert.ok(
  windowsInstaller.indexOf('https://hf-mirror.com/ggerganov/whisper.cpp') <
    windowsInstaller.indexOf('https://huggingface.co/ggerganov/whisper.cpp'),
  'Windows installer should try the Hugging Face mirror before the primary Hugging Face host',
);
assert.ok(
  windowsInstaller.indexOf('Write-TranscribeScript -InstallRoot $InstallRoot') <
    windowsInstaller.indexOf('-PrimaryUrls $WhisperWindowsTencentUrls -FallbackUrls $WhisperWindowsFallbackUrls'),
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
assert.ok(transcribeScriptTemplate.includes('$TranscriptQualityGuardVersion = "repeat-guard-v2"'));
assert.strictEqual(transcribeScriptTemplate.includes('"--prompt", "请输出简体中文"'), false);
assert.strictEqual(transcribeScriptTemplate.includes('"--prompt"'), false);
assert.ok(transcribeScriptTemplate.includes('TRANSCRIPT_HALLUCINATION'));
assert.strictEqual(transcribeScriptTemplate.includes('DataReceivedEventHandler'), false);
assert.strictEqual(transcribeScriptTemplate.includes('BeginOutputReadLine'), false);
assert.ok(windowsInstaller.includes('Assert-LocalAsrInference'));
assert.ok(windowsInstaller.includes('"-f", "lavfi"'));
assert.ok(windowsInstaller.includes('validation.wav'));
assert.ok(windowsInstaller.includes('Local ASR inference validation passed'));
assert.ok(macInstaller.includes('bootstrap_uv'));
assert.ok(macInstaller.includes('setup_python_and_packages'));
assert.ok(macInstaller.includes('whisper.cpp-cli'));
assert.ok(macInstaller.includes('imageio-ffmpeg'));
assert.ok(macInstaller.includes('UV_BIN="$INSTALL_ROOT/bin/uv"'));
assert.ok(macInstaller.includes('UV_PYTHON_DOWNLOADS=automatic'));
assert.ok(macInstaller.includes('UV_PYTHON_PREFERENCE=managed'));
assert.ok(macInstaller.includes('PYTHON_BUILD_STANDALONE_BUILD="20260623"'));
assert.ok(macInstaller.includes('PYTHON_BUILD_STANDALONE_VERSION="3.12.13+20260623"'));
assert.ok(macInstaller.includes('PYTHON_RUNTIME_VERSION="${PYTHON_BUILD_STANDALONE_VERSION%%+*}"'));
assert.ok(macInstaller.includes('PYTHON_RUNTIME_SHA256_ARM64="3724AA4DAFB5F7B6C2CF98E89914E4248DC6BD2FE40407DF4A2D73DE99615F16"'));
assert.ok(macInstaller.includes('PYTHON_RUNTIME_SHA256_X64="7C57FDD1FA675190093700EB0D8E7117E1F9EAE7C30A46DEA5F8D5266BCFC791"'));
assert.ok(macInstaller.includes('TENCENT_PYTHON_DOWNLOAD_BASE="${TENCENT_BASE_URL}/local-python/python-build-standalone/releases/download"'));
assert.ok(macInstaller.includes('PORTABLE_PYTHON="$PYTHON_RUNTIME_DIR/python/bin/python"'));
assert.ok(macInstaller.includes("sys.version.split()[0] == sys.argv[1]"));
assert.ok(macInstaller.includes('"$PYTHON_RUNTIME_VERSION"'));
assert.ok(macInstaller.includes('install_portable_python'));
assert.ok(macInstaller.includes('shasum -a 256 "$1"'));
assert.ok(macInstaller.includes('verify_sha256 "$archive_path" "$expected_sha256"'));
assert.ok(macInstaller.includes('"$PORTABLE_PYTHON" -m venv "$VENV_DIR"'));
assert.ok(
  macInstaller.indexOf('if install_portable_python; then') <
    macInstaller.indexOf('"$UV_BIN" python install 3.12'),
  'macOS ASR installer should try the pinned portable Python before the uv managed-Python fallback',
);
assert.ok(
  macInstaller.lastIndexOf('if ! verify_sha256 "$archive_path" "$expected_sha256"; then') <
    macInstaller.indexOf('if ! tar xzf "$archive_path" -C "$stage_dir"; then'),
  'macOS ASR installer should verify the pinned Python archive before extraction',
);
assert.ok(macInstaller.includes('"$UV_BIN" python install 3.12'));
assert.ok(macInstaller.includes('"$UV_BIN" venv "$VENV_DIR" --python 3.12 --managed-python'));
assert.ok(macInstaller.includes('ASR_WHEELHOUSE_BASE_URL="${TENCENT_BASE_URL}/local-asr/wheels"'));
assert.ok(macInstaller.includes('ASR_PACKAGE_REQUIREMENTS=("whisper.cpp-cli==0.0.3" "imageio-ffmpeg==0.6.0")'));
assert.ok(macInstaller.includes('install_asr_packages "$VENV_PYTHON"'));
assert.ok(macInstaller.includes('INSTALL_STATE_PATH="$INSTALL_ROOT/.install-state.json"'));
assert.ok(macInstaller.includes('INSTALLER_SCRIPT_VERSION="1.3.7"'));
assert.ok(macInstaller.includes('DOWNLOAD_LOW_SPEED_LIMIT=10240'));
assert.ok(macInstaller.includes('DOWNLOAD_LOW_SPEED_TIME=180'));
assert.ok(macInstaller.includes('--speed-limit "$DOWNLOAD_LOW_SPEED_LIMIT"'));
assert.ok(macInstaller.includes('--speed-time "$DOWNLOAD_LOW_SPEED_TIME"'));
assert.ok(macInstaller.includes('CACHE_ROOT="$INSTALL_ROOT/cache"'));
assert.ok(macInstaller.includes('TENCENT_BASE_URL="https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com"'));
assert.ok(macInstaller.includes('TENCENT_MODEL_URL="${TENCENT_BASE_URL}/local-asr/windows/ggml-small.bin"'));
assert.ok(macInstaller.includes('MODEL_URLS=("$TENCENT_MODEL_URL" "$MODEL_MIRROR_URL" "$MODEL_URL")'));
assert.ok(macInstaller.includes('local urls=("${MODEL_URLS[@]}")'));
assert.ok(macInstaller.includes('Python venv and ASR tools are already ready.'));
assert.strictEqual(macInstaller.includes('rm -rf "$venv_dir"'), false);
assert.ok(macInstaller.includes('Local ASR was already validated for the current files; skipping full inference validation.'));
assert.ok(macInstaller.includes('download_model "$CACHE_ROOT/ggml-small.bin"'));
assert.ok(macInstaller.includes('cp -f "$CACHE_ROOT/ggml-small.bin" "$MODEL_PATH"'));
assert.ok(macInstaller.includes('rm -f "$CACHE_ROOT/ggml-small.bin"'));
assert.ok(macInstaller.includes('whisper-cli validation failed.'));
assert.ok(macInstaller.includes('ffmpeg validation failed.'));
assert.ok(macInstaller.includes('validate_local_asr_inference'));
assert.ok(macInstaller.includes('Local ASR inference validation passed'));
assert.ok(macInstaller.includes('find_metal_resources_dir'));
assert.ok(macInstaller.includes('GGML_METAL_PATH_RESOURCES'));
assert.ok(macInstaller.includes('get_media_duration_seconds'));
assert.ok(macInstaller.includes('choose_chunk_seconds'));
assert.ok(macInstaller.includes('durationSeconds=$DURATION_SECONDS'));
assert.ok(macInstaller.includes('metalResourcesPath='));
assert.ok(macInstaller.includes('metalAcceleration=failed'));
assert.ok(macInstaller.includes('exec "\\$WHISPER_CPP_BIN" "\\$@"'));
assert.strictEqual(macInstaller.includes('-m whisper_cpp'), false);
assert.ok(macInstaller.includes('brew_install_formula ffmpeg'));
assert.ok(
  macInstaller.indexOf('setup_python_and_packages') <
    macInstaller.indexOf('brew_install_formula ffmpeg'),
  'macOS installer should only use Homebrew ffmpeg after the uv Python path fails',
);
assert.ok(macInstaller.includes('brew_install_formula whisper-cpp'));
assert.strictEqual(macInstaller.includes('brew reinstall whisper-cpp'), false);
assert.ok(macInstaller.includes('hf-mirror.com/ggerganov/whisper.cpp'));
assert.ok(
  macInstaller.indexOf('TENCENT_MODEL_URL=') <
    macInstaller.indexOf('MODEL_MIRROR_URL='),
  'macOS installer should define the Tencent-hosted model before Hugging Face mirrors',
);
assert.ok(
  macInstaller.indexOf('MODEL_MIRROR_URL=') <
    macInstaller.indexOf('MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"'),
  'macOS installer should define the mirror before the primary Hugging Face host',
);
assert.ok(
  macInstaller.indexOf('run_or_skip_local_asr_validation "$INSTALL_ROOT/bin/whisper-cli" "$INSTALL_ROOT/bin/ffmpeg" "$MODEL_PATH"') <
    macInstaller.lastIndexOf('rm -f "$CACHE_ROOT/ggml-small.bin"'),
  'macOS installer should only remove the cached model after validation succeeds',
);
assert.ok(macInstaller.includes('No Terminal command is required.'));
assert.ok(macInstaller.includes('SHORT_CHUNK_SECONDS=120'));
assert.ok(macInstaller.includes('LONG_CHUNK_SECONDS=600'));
assert.ok(macInstaller.includes('LONG_MEDIA_THRESHOLD_SECONDS=600'));
assert.ok(macInstaller.includes('-f segment -segment_time "$CHUNK_SECONDS"'));
assert.ok(macInstaller.includes('TRANSCRIPT_QUALITY_GUARD_VERSION="repeat-guard-v2"'));
assert.strictEqual(macInstaller.includes('SIMPLIFIED_PROMPT="$(printf'), false);
assert.strictEqual(macInstaller.includes('--prompt "$SIMPLIFIED_PROMPT"'), false);
assert.strictEqual(macInstaller.includes('--prompt "请输出简体中文"'), false);
assert.ok(macInstaller.includes('Homebrew is busy. Waiting before retry'));
assert.ok(macInstaller.includes('chunkCount='));
assert.ok(macInstaller.includes('transcribe-last.log'));
assert.ok(macInstaller.includes('progressStage='));
assert.ok(macInstaller.includes('progressCurrent='));
assert.ok(macInstaller.includes('progressTotal='));
assert.ok(macInstaller.includes('progressPercent='));
