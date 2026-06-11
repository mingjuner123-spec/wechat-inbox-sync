const assert = require('assert');
const http = require('http');
const Module = require('module');

let requestUrlMock = async () => ({});
const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Notice: class Notice {},
      Plugin: class Plugin {},
      PluginSettingTab: class PluginSettingTab {},
      Setting: class Setting {},
      requestUrl: (...args) => requestUrlMock(...args),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const PluginClass = require('../obsidian-plugin/wechat-inbox-sync/main');
Module._load = originalLoad;

const helpers = PluginClass.__test;
const fs = require('fs');
const path = require('path');
const pluginMainSource = fs.readFileSync(path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'main.js'), 'utf8');

const pluginMainLinesWithoutIntentionalPdfNoiseCheck = pluginMainSource
  .split(/\r?\n/)
  .filter((line) => !line.includes('/[锟�]/.test(source)'))
  .join('\n');
assert.strictEqual(/[�]/.test(pluginMainLinesWithoutIntentionalPdfNoiseCheck), false);
assert.strictEqual(/(?:鏈|杞|寮|瀹|妯|鑴|缁|鏉|鐮|锛|銆|€|涓|鍛|浠|绔|鏄|鍚)/.test(pluginMainSource), false);

assert.strictEqual(
  helpers.FEISHU_TUTORIAL_URL,
  'https://my.feishu.cn/wiki/EPHhwqRobijHqfkAqjMcDEgvnlf?from=from_copylink',
);
assert.strictEqual(typeof helpers.buildAliyunVoiceRequest, 'function');
assert.strictEqual(typeof helpers.buildDoubaoAsrRequest, 'function');
assert.strictEqual(typeof helpers.buildDoubaoAsrQueryRequest, 'function');
assert.strictEqual(typeof helpers.parseAliyunTranscriptionResult, 'function');
assert.strictEqual(typeof helpers.parseDoubaoAsrResult, 'function');
assert.strictEqual(typeof helpers.parseDoubaoAsrTaskState, 'function');
assert.strictEqual(typeof helpers.formatHttpError, 'function');
assert.strictEqual(typeof helpers.buildTencentCreateRecTaskBody, 'function');
assert.strictEqual(typeof helpers.buildTencentRequest, 'function');
assert.strictEqual(typeof helpers.parseTencentCreateTaskResponse, 'function');
assert.strictEqual(typeof helpers.parseTencentTaskStatusResponse, 'function');
assert.strictEqual(typeof helpers.buildRecordTitleBase, 'function');
assert.strictEqual(typeof helpers.extractXiaohongshuMarkdownFromHtml, 'function');
assert.strictEqual(typeof helpers.extractSocialVideoMarkdownFromHtml, 'function');
assert.strictEqual(typeof helpers.extractPodcastAudioUrlFromHtml, 'function');
assert.strictEqual(typeof helpers.extractBilibiliSubtitleUrlsFromHtml, 'function');
assert.strictEqual(typeof helpers.parseBilibiliSubtitlePayload, 'function');
assert.strictEqual(typeof helpers.extractBilibiliAudioUrlFromPlayurlPayload, 'function');
assert.strictEqual(typeof helpers.buildAudioTranscriptMarkdown, 'function');
assert.strictEqual(typeof helpers.buildTranscriptOnlyMetadata, 'function');
assert.strictEqual(typeof helpers.buildSyncProgressMessage, 'function');
assert.strictEqual(typeof helpers.extractSocialMediaUrlFromHtml, 'function');
assert.strictEqual(
  helpers.extractSocialMediaUrlFromHtml(`
    <script>
      window.__DATA__ = {
        "videoUrl": "https://v3-dy-o.zjcdn.com/tos-cn-ve/demo-video.mp4?mime_type=video_mp4",
        "audioUrl": "https://audio.example.com/demo-audio.m4a"
      }
    </script>
  `),
  'https://audio.example.com/demo-audio.m4a',
);
assert.strictEqual(typeof helpers.cleanDisplayUrl, 'function');
assert.strictEqual(typeof helpers.getLocalAsrInstallRoot, 'function');
assert.strictEqual(typeof helpers.getLocalAsrInstallStatus, 'function');
assert.strictEqual(typeof helpers.getLocalAsrScriptVersionStatus, 'function');
assert.strictEqual(typeof helpers.explainLocalAsrExitCode, 'function');
assert.strictEqual(typeof helpers.buildLocalAsrInstallCommand, 'function');
assert.strictEqual(typeof helpers.downloadTextViaNode, 'function');
assert.strictEqual(helpers.LOCAL_TRANSCRIPTION_PLAN, 'local_transcription_beta');
assert.strictEqual(
  helpers.LOCAL_ASR_INSTALLER_URL,
  'https://raw.githubusercontent.com/mingjuner123-spec/wechat-inbox-sync/main/local-asr/install-local-asr.ps1',
);
assert.strictEqual(
  helpers.LOCAL_ASR_MACOS_INSTALLER_URL,
  'https://raw.githubusercontent.com/mingjuner123-spec/wechat-inbox-sync/main/local-asr/install-local-asr-macos.sh',
);
assert.ok(pluginMainSource.includes('getAvailableLocalAsrInstallerPath'));
assert.ok(pluginMainSource.includes('raw.githubusercontent.com/mingjuner123-spec/wechat-inbox-sync/main/local-asr/install-local-asr.ps1'));
assert.ok(pluginMainSource.includes('raw.githubusercontent.com/mingjuner123-spec/wechat-inbox-sync/main/local-asr/install-local-asr-macos.sh'));
assert.ok(pluginMainSource.includes('downloadedPath'));
assert.ok(pluginMainSource.includes('return downloadedPath'));
assert.ok(pluginMainSource.includes('return installerPath'));
assert.ok(pluginMainSource.indexOf('return downloadedPath') < pluginMainSource.indexOf('return installerPath'));
assert.strictEqual(pluginMainSource.includes('if (fs.existsSync(installerPath)) return installerPath'), false);
assert.ok(pluginMainSource.includes('Local ASR installer download returned outdated or invalid content'));
assert.ok(pluginMainSource.includes('无法下载最新本地转写安装器'));
const defaultLocalTranscriptionCommand = helpers.getDefaultLocalTranscriptionCommand();
assert.ok(defaultLocalTranscriptionCommand.includes('%USERPROFILE%'));
assert.strictEqual(defaultLocalTranscriptionCommand.includes('$env:USERPROFILE'), false);
assert.strictEqual(
  helpers.getDefaultLocalTranscriptionCommand('darwin'),
  '/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}',
);
assert.strictEqual(
  helpers.mergeSettings({
    localTranscriptionCommand: 'powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
  }).localTranscriptionCommand,
  'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
);
assert.strictEqual(
  helpers.mergeSettings({
    localTranscriptionCommand: 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
  }, 'darwin').localTranscriptionCommand,
  '/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}',
);
assert.strictEqual(
  helpers.mergeSettings({
    localAsrPlatform: 'darwin',
    localTranscriptionCommand: 'powershell -File "%USERPROFILE%\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
  }, 'win32').localTranscriptionCommand,
  '/bin/bash "$HOME/.wechat-inbox-local-asr/transcribe.sh" --input {input} --output {output}',
);
assert.strictEqual(helpers.mergeSettings({ autoSyncOnLoad: false }).autoSyncOnLoad, true);
assert.strictEqual(pluginMainSource.includes(".setName('同步 API 地址')"), false);
assert.strictEqual(pluginMainSource.includes(".setName('启动时自动同步')"), false);
assert.strictEqual(pluginMainSource.includes(".setName('本地转写命令')"), false);
assert.strictEqual(pluginMainSource.includes("local: '本地转写命令'"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('兑换并开通')"), false);
assert.strictEqual(pluginMainSource.includes(".setPlaceholder('例如 ZZAI030')"), false);
assert.ok(pluginMainSource.includes('小程序名字：Obsidian 内容同步助手'));
assert.ok(pluginMainSource.includes('打开微信小程序【Obsidian 内容同步助手】'));
assert.ok(pluginMainSource.includes('本地转写系统'));
assert.ok(pluginMainSource.includes('如果苹果电脑安装失败，请手动选择 macOS'));
assert.ok(pluginMainSource.includes('install.log'));
assert.ok(pluginMainSource.includes('复制诊断信息'));
assert.ok(pluginMainSource.includes('getLocalAsrDiagnosticText'));
assert.ok(pluginMainSource.includes('showSyncProgress'));
assert.ok(pluginMainSource.includes('syncStatusBar'));
assert.ok(pluginMainSource.includes('setText(message)'));
assert.ok(pluginMainSource.includes('lastSyncDiagnostic'));
assert.ok(pluginMainSource.includes('复制同步诊断'));
assert.ok(pluginMainSource.includes('同步失败诊断'));
assert.ok(pluginMainSource.includes('正在同步'));
assert.ok(pluginMainSource.includes('正在处理'));
assert.strictEqual(helpers.getSocialRequestHeaders('https://v3-dy-o.zjcdn.com/tos-cn-ve-15/demo-video?mime_type=video_mp4').Referer, 'https://www.douyin.com/');
assert.strictEqual(helpers.shouldResolveMediaDownloadUrl('https://www.douyin.com/aweme/v1/play/?video_id=v0200fg10000demo'), true);
assert.strictEqual(helpers.shouldResolveMediaDownloadUrl('https://v3-dy-o.zjcdn.com/tos-cn-ve-15/demo-video?mime_type=video_mp4'), false);
assert.strictEqual(
  helpers.cleanDisplayUrl('https://mp.weixin.qq.com/s?search_click_id=1&__biz=MzABC&mid=123&idx=1&sn=abcdef&chksm=old&scene=21&pass_ticket=very-long-token&exportkey=very-long-export-key'),
  'https://mp.weixin.qq.com/s?__biz=MzABC&mid=123&idx=1&sn=abcdef',
);
assert.strictEqual(
  helpers.cleanDisplayUrl('https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=abc&target_url=https%253A%252F%252Fmp.weixin.qq.com%252Fs%253F__biz%253DMzABC%2526mid%253D123%2526idx%253D1%2526sn%253Dabcdef%2526pass_ticket%253Dhidden'),
  'https://mp.weixin.qq.com/s?__biz=MzABC&mid=123&idx=1&sn=abcdef',
);
assert.strictEqual(
  helpers.getLocalAsrInstallRoot('C:\\Users\\demo'),
  'C:\\Users\\demo\\.wechat-inbox-local-asr',
);
assert.deepStrictEqual(
  helpers.getLocalAsrInstallStatus('C:\\Users\\demo\\.wechat-inbox-local-asr', (filePath) => filePath.endsWith('transcribe.ps1')),
  {
    installRoot: 'C:\\Users\\demo\\.wechat-inbox-local-asr',
    transcribeScript: 'C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1',
    whisperPath: '',
    ffmpegPath: '',
    modelPath: 'C:\\Users\\demo\\.wechat-inbox-local-asr\\models\\ggml-small.bin',
    hasTranscribeScript: true,
    scriptVersion: 'unknown',
    scriptOutdated: false,
    hasWhisper: false,
    hasFfmpeg: false,
    hasModel: false,
    missingReasons: [
      'whisper 未找到，请重新安装/更新本地转写组件',
      'ffmpeg 未找到，请重新安装/更新本地转写组件',
      '模型文件未找到，请重新安装/更新本地转写组件',
    ],
    ready: false,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrInstallStatus('/Users/demo/.wechat-inbox-local-asr', (filePath) => filePath.endsWith('transcribe.sh'), 'darwin'),
  {
    installRoot: '/Users/demo/.wechat-inbox-local-asr',
    transcribeScript: '/Users/demo/.wechat-inbox-local-asr/transcribe.sh',
    whisperPath: '',
    ffmpegPath: '',
    modelPath: '/Users/demo/.wechat-inbox-local-asr/models/ggml-small.bin',
    hasTranscribeScript: true,
    scriptVersion: 'unknown',
    scriptOutdated: false,
    hasWhisper: false,
    hasFfmpeg: false,
    hasModel: false,
    missingReasons: [
      'whisper 未找到，请重新安装/更新本地转写组件',
      'ffmpeg 未找到，请重新安装/更新本地转写组件',
      '模型文件未找到，请重新安装/更新本地转写组件',
    ],
    ready: false,
  },
);
const completeWindowsAsrStatus = helpers.getLocalAsrInstallStatus('C:\\Users\\demo\\.wechat-inbox-local-asr', (filePath) => [
  'C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1',
  'C:\\Users\\demo\\.wechat-inbox-local-asr\\whisper\\whisper-cli.exe',
  'C:\\Users\\demo\\.wechat-inbox-local-asr\\ffmpeg\\ffmpeg.exe',
  'C:\\Users\\demo\\.wechat-inbox-local-asr\\models\\ggml-small.bin',
].includes(filePath));
assert.strictEqual(completeWindowsAsrStatus.whisperPath, 'C:\\Users\\demo\\.wechat-inbox-local-asr\\whisper\\whisper-cli.exe');
assert.strictEqual(completeWindowsAsrStatus.ffmpegPath, 'C:\\Users\\demo\\.wechat-inbox-local-asr\\ffmpeg\\ffmpeg.exe');
assert.deepStrictEqual(completeWindowsAsrStatus.missingReasons, []);
assert.ok(pluginMainSource.includes('ffmpeg 路径：'));
assert.ok(pluginMainSource.includes('缺失项：'));
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => '$GeneratedTxt = "$OutputBase.txt"\nthrow "Whisper did not generate transcript: $GeneratedTxt"',
  }),
  {
    scriptVersion: 'legacy-generated-txt',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => '$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Invoke-NativeProcess {}\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-safe-native-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Invoke-NativeProcess {}\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-safe-native-utf8-run-log',
    scriptOutdated: false,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('/Users/demo/.wechat-inbox-local-asr/transcribe.sh', {
    existsSync: () => true,
    readFileSync: () => 'set -euo pipefail\nCHUNK_SECONDS=600\nRUN_LOG="$ROOT/transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-bash-run-log',
    scriptOutdated: false,
  },
);
assert.ok(helpers.buildLocalAsrInstallCommand('C:\\plugin\\local-asr\\install-local-asr.ps1').includes('-ExecutionPolicy Bypass'));
assert.ok(helpers.buildLocalAsrInstallCommand('C:\\plugin\\local-asr\\install-local-asr.ps1').includes('"C:\\plugin\\local-asr\\install-local-asr.ps1"'));
assert.strictEqual(
  helpers.buildLocalAsrInstallCommand('/Users/demo/plugin/local-asr/install-local-asr-macos.sh', 'darwin'),
  '/bin/bash "/Users/demo/plugin/local-asr/install-local-asr-macos.sh"',
);
assert.strictEqual(
  helpers.getLocalAsrPlatformMismatchMessage('darwin', 'win32'),
  'Local ASR platform mismatch: this computer is Windows, but the selected installer is macOS. Please choose Auto or Windows, then install again.',
);
assert.strictEqual(helpers.getLocalAsrPlatformMismatchMessage('auto', 'win32'), '');
assert.strictEqual(helpers.getLocalAsrPlatformMismatchMessage('darwin', 'darwin'), '');
assert.ok(pluginMainSource.includes('getLocalAsrPlatformMismatchMessage(this.settings.localAsrPlatform)'));
assert.ok(pluginMainSource.includes('最近转写日志：'));
assert.ok(pluginMainSource.includes('脚本版本：'));
assert.ok(pluginMainSource.includes('脚本过旧'));
assert.ok(pluginMainSource.includes('transcribe-last.log'));
assert.strictEqual(typeof helpers.buildLocalAsrRunLogText, 'function');
assert.ok(
  helpers.buildLocalAsrRunLogText({
    time: '2026-06-10T14:10:06.000Z',
    status: 'failed',
    command: 'powershell -File transcribe.ps1',
    inputPath: 'C:\\Users\\win11\\AppData\\Local\\Temp\\wechat-inbox-sync-demo.mp3',
    outputPath: 'C:\\Users\\win11\\AppData\\Local\\Temp\\wechat-inbox-sync-demo.mp3.txt',
    stdout: 'stdout text',
    stderr: 'stderr text',
    error: 'Whisper did not generate transcript',
  }).includes('Whisper did not generate transcript'),
);
assert.ok(
  helpers.buildLocalAsrRunLogText({
    status: 'failed',
    error: 'whisper failed with exit code -1073741515',
  }).includes('缺少 Windows VC++ 运行库或 whisper 依赖 DLL'),
);
assert.strictEqual(
  helpers.explainLocalAsrExitCode(-1073741515),
  '缺少 Windows VC++ 运行库或 whisper 依赖 DLL，请重新点击“安装/更新本地转写组件”修复。',
);
assert.strictEqual(helpers.normalizeBindCodeInput(' ozt n1i '), 'OZT-N1I');
assert.strictEqual(helpers.mergeSettings({ token: 'oztn1i' }).token, 'OZT-N1I');
assert.strictEqual(typeof helpers.createRetryableTranscriptionError, 'function');
assert.strictEqual(typeof helpers.isRetryableTranscriptionError, 'function');
assert.strictEqual(typeof helpers.isRemoteAsrDownloadFailure, 'function');
assert.strictEqual(typeof helpers.getDoubaoTaskKey, 'function');
assert.strictEqual(typeof helpers.getDefaultLocalTranscriptionCommand, 'function');
assert.strictEqual(typeof helpers.openExternalUrl, 'function');
assert.strictEqual(typeof helpers.extractPdfMarkdown, 'function');
assert.strictEqual(typeof helpers.cleanPdfExtractedText, 'function');
assert.strictEqual(typeof helpers.resolveRedirectUrl, 'function');
assert.strictEqual(typeof helpers.isRequestUrlTransportError, 'function');
assert.strictEqual(typeof helpers.requestJsonViaNode, 'function');

assert.strictEqual(helpers.buildRecordTitleBase({
  type: 'file',
  content: 'Demo Document.pdf',
  createdAt: '2026-05-13T12:00:00.000Z',
  metadata: {
    fileName: 'Demo Document.pdf',
    fileExt: 'pdf',
  },
}), 'pdf-Demo Document');

assert.strictEqual(helpers.buildRecordTitleBase({
  type: 'webpage',
  content: 'https://mp.weixin.qq.com/s/example',
  createdAt: '2026-05-13T12:00:00.000Z',
  metadata: {
    url: 'https://mp.weixin.qq.com/s/example',
    title: 'Article Title',
  },
}), '公众号-Article Title');

assert.strictEqual(helpers.buildRecordTitleBase({
  type: 'voice',
  content: '现场语音备忘录 - 03:12',
  createdAt: '2026-05-13T12:00:00.000Z',
  metadata: {
    audioFileName: 'Weekly Meeting.m4a',
  },
}), '录音-Weekly Meeting');

const xiaohongshuNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Note Title">',
  '<meta name="description" content="正文第一段。 #tagOne #tagTwo">',
  '<meta property="og:image" content="https://img.example.com/cover.jpg">',
  '</head><body>',
  '<img src="https://img.example.com/inner-a.jpg">',
  '<script>{"note":{"desc":"正文第一段，正文第二段，正文第三段。 #tagOne #tagTwo","imageList":[{"urlDefault":"https:\\/\\/img.example.com\\/inner-b.jpg"},{"url":"https:\\/\\/sns-webpic.example.com\\/inner-c"}]}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/123');
assert.strictEqual(xiaohongshuNote.title, 'XHS Note Title');
assert.ok(xiaohongshuNote.markdown.includes('## 正文'));
assert.ok(xiaohongshuNote.markdown.includes('正文第一段'));
assert.ok(xiaohongshuNote.markdown.includes('正文第三段'));
assert.ok(xiaohongshuNote.markdown.includes('#tagOne'));
assert.strictEqual(xiaohongshuNote.markdown.includes('- #tagOne'), false);
assert.ok(xiaohongshuNote.markdown.includes('![封面](https://img.example.com/cover.jpg)'));
assert.ok(xiaohongshuNote.markdown.includes('![内页图 1](https://img.example.com/inner-a.jpg)'));
assert.ok(xiaohongshuNote.markdown.includes('![内页图 2](https://img.example.com/inner-b.jpg)'));
assert.ok(xiaohongshuNote.markdown.includes('![内页图 3](https://sns-webpic.example.com/inner-c)'));

const xiaohongshuImageArrayNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Image Array Title">',
  '<meta name="description" content="3 亿人的生活经验，都在小红书">',
  '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/spectrum/cover!nd_dft_wlteh_jpg_3">',
  '</head><body>',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"真正的图文正文第一段。\\n真正的图文正文第二段。 #图文笔记","imageList":["https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/inner-a!nd_dft_wlteh_jpg_3","https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/inner-b!nd_dft_wlteh_jpg_3"]}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/image-array');
assert.ok(xiaohongshuImageArrayNote.markdown.includes('真正的图文正文第二段'));
assert.ok(xiaohongshuImageArrayNote.markdown.includes('#图文笔记'));
assert.strictEqual(xiaohongshuImageArrayNote.markdown.includes('3 亿人的生活经验'), false);
assert.ok(xiaohongshuImageArrayNote.markdown.includes('![封面](https://sns-webpic-qc.xhscdn.com/spectrum/cover!nd_dft_wlteh_jpg_3)'));
assert.ok(xiaohongshuImageArrayNote.markdown.includes('![内页图 1](https://sns-webpic-qc.xhscdn.com/spectrum/inner-a!nd_dft_wlteh_jpg_3)'));
assert.ok(xiaohongshuImageArrayNote.markdown.includes('![内页图 2](https://sns-webpic-qc.xhscdn.com/spectrum/inner-b!nd_dft_wlteh_jpg_3)'));
assert.strictEqual(xiaohongshuImageArrayNote.markdown.includes('- #图文笔记'), false);
assert.strictEqual((xiaohongshuImageArrayNote.markdown.match(/cover!nd_dft_wlteh_jpg_3/g) || []).length, 1);
assert.strictEqual((xiaohongshuImageArrayNote.markdown.match(/inner-a!nd_dft_wlteh_jpg_3/g) || []).length, 1);
assert.strictEqual((xiaohongshuImageArrayNote.markdown.match(/inner-b!nd_dft_wlteh_jpg_3/g) || []).length, 1);

const xiaohongshuDuplicatedHostNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Duplicate Host Title">',
  '<meta name="description" content="正文。 #重复图">',
  '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/202605251029/a82219a7b3d58ca6746d500c9b5c2f5b/spectrum/1040g34o320htq6q76o205p5oj0ol6up10lvl070!nd_dft_wlteh_jpg_3">',
  '</head><body>',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"正文。 #重复图","imageList":["http:\\/\\/sns-webpic-qc.xhscdn.com\\/202605251030\\/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\/spectrum\\/1040g34o320htq6q76o205p5oj0ol6up10lvl070!nd_dft_wlteh_jpg_3","https:\\/\\/sns-webpic-qc.xhscdn.com\\/202605251031\\/cccccccccccccccccccccccccccccccc\\/spectrum\\/1040g34o320htq6q76o205p5oj0ol6up10lvl071!nd_dft_wlteh_jpg_3"]}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/duplicate-host');
assert.strictEqual((xiaohongshuDuplicatedHostNote.markdown.match(/1040g34o320htq6q76o205p5oj0ol6up10lvl070/g) || []).length, 1);
assert.strictEqual((xiaohongshuDuplicatedHostNote.markdown.match(/1040g34o320htq6q76o205p5oj0ol6up10lvl071/g) || []).length, 1);
assert.strictEqual(xiaohongshuDuplicatedHostNote.imageUrls.length, 2);
assert.strictEqual(xiaohongshuDuplicatedHostNote.markdown.includes('window.__INITIAL_STATE__'), false);
assert.strictEqual(xiaohongshuDuplicatedHostNote.markdown.includes('imageList'), false);

const xiaohongshuNoisyPageNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="给女朋友做的第一个vibe coding项目💕 - 小红书">',
  '<meta name="description" content="3 亿人的生活经验，都在小红书">',
  '</head><body>',
  '创作中心业务合作发现直播发布通知 沪ICP备13030189号 营业执照 违法不良信息举报',
  '<script>window.__SSR__=true;window.__INITIAL_STATE__={"global":{"appSettings":{"serverTime":1779420628594}},"note":{"desc":"因为我和女朋友是异国恋，还有时差，平时能好好聊天的时间其实不算多。\\n#恋爱笔记 #异地恋 #vibecoding","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/notes_pre_post\\/cover!nd_dft_wlteh_jpg_3"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/notes_pre_post\\/inner!nd_dft_wlteh_jpg_3"}]}}</script>',
  '</body></html>',
].join(''), 'http://xhslink.com/o/7HGhYFyD8gl');
assert.ok(xiaohongshuNoisyPageNote.markdown.includes('因为我和女朋友是异国恋'));
assert.strictEqual(xiaohongshuNoisyPageNote.markdown.includes('沪ICP备13030189号'), false);
assert.strictEqual(xiaohongshuNoisyPageNote.markdown.includes('window.__INITIAL_STATE__'), false);
assert.ok(xiaohongshuNoisyPageNote.markdown.includes('#恋爱笔记 #异地恋 #vibecoding'));
assert.ok(xiaohongshuNoisyPageNote.markdown.includes('![内页图 1](https://sns-webpic-qc.xhscdn.com/notes_pre_post/inner!nd_dft_wlteh_jpg_3)'));

const xiaohongshuFallbackNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="听播客3年，我感受到了信息茧房的恐怖 - 小红书">',
  '<meta name="description" content="3 亿人的生活经验，都在小红书">',
  '</head></html>',
].join(''), 'http://xhslink.com/o/5xRiTruK9EQ', '听播客3年，我感受到了信息茧房的恐怖 刚开始听播客的... http://xhslink.com/o/5xRiTruK9EQ  \n把文字复制好，然后去【小红书】查看详情。');
assert.ok(xiaohongshuFallbackNote.markdown.includes('刚开始听播客的'));
assert.strictEqual(xiaohongshuFallbackNote.markdown.includes('3 亿人的生活经验'), false);
assert.strictEqual(xiaohongshuFallbackNote.markdown.includes('把文字复制好'), false);

const cleanedPdfText = helpers.cleanPdfExtractedText([
  '创始人手册',
  'The Founders Playbook',
  '',
  'A',
  '',
  'I',
  '',
  'M',
  'V',
  'P',
  '',
  '一个',
  '普通',
  '人',
  '也',
  '可以',
].join('\n'));
assert.ok(cleanedPdfText.includes('创始人手册 The Founders Playbook'));
assert.ok(cleanedPdfText.includes('AIMVP'));
assert.ok(cleanedPdfText.includes('一个普通人也可以'));

const douyinVideo = helpers.extractSocialVideoMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="Douyin Video Title">',
  '<meta name="description" content="视频讲了三个同步技巧 #obsidian #效率">',
  '<meta property="og:video" content="https://video.example.com/a.mp4">',
  '</head></html>',
].join(''), 'https://www.douyin.com/video/123', '抖音');
assert.strictEqual(douyinVideo.title, 'Douyin Video Title');
assert.strictEqual(douyinVideo.videoUrl, 'https://video.example.com/a.mp4');
assert.ok(douyinVideo.markdown.includes('## 视频文案'));
assert.ok(douyinVideo.markdown.includes('视频讲了三个同步技巧'));

const douyinSourceVideo = helpers.extractSocialMediaUrlFromHtml([
  '<video controls>',
  '<source src="https://v3-dy-o.zjcdn.com/tos-cn-ve-15/source-video?mime_type=video_mp4" type="video/mp4">',
  '</video>',
].join(''));
assert.strictEqual(douyinSourceVideo, 'https://v3-dy-o.zjcdn.com/tos-cn-ve-15/source-video?mime_type=video_mp4');

const douyinNestedPlayUrl = helpers.extractSocialMediaUrlFromHtml([
  '<script>',
  '{"video":{"play_addr":{"url_list":["https:\\/\\/www.douyin.com\\/aweme\\/v1\\/play\\/?video_id=v0200fg10000demo&ratio=720p&line=0"]}}}',
  '</script>',
].join(''));
assert.strictEqual(douyinNestedPlayUrl, 'https://www.douyin.com/aweme/v1/play/?video_id=v0200fg10000demo&ratio=720p&line=0');

const douyinVodUrl = helpers.extractSocialMediaUrlFromHtml([
  '<script>',
  '{"video":{"playAddr":{"urlList":["https:\\/\\/v3-dy-o.zjcdn.com\\/tos-cn-ve-15\\/demo-video?mime_type=video_mp4&expire=1770000000"]}}}',
  '</script>',
].join(''));
assert.strictEqual(douyinVodUrl, 'https://v3-dy-o.zjcdn.com/tos-cn-ve-15/demo-video?mime_type=video_mp4&expire=1770000000');

const douyinPlayApiUrl = helpers.extractSocialMediaUrlFromHtml([
  '<script>',
  '{"video":{"playApi":"https:\\/\\/www.douyin.com\\/aweme\\/v1\\/play\\/?video_id=v0200fg10000demo&ratio=720p&line=0"}}',
  '</script>',
].join(''));
assert.strictEqual(douyinPlayApiUrl, 'https://www.douyin.com/aweme/v1/play/?video_id=v0200fg10000demo&ratio=720p&line=0');

const podcastAudioUrl = helpers.extractPodcastAudioUrlFromHtml([
  '<html><head>',
  '<meta property="og:audio" content="https://media.example.com/xiaoyuzhou-episode.mp3">',
  '</head></html>',
].join(''));
assert.strictEqual(podcastAudioUrl, 'https://media.example.com/xiaoyuzhou-episode.mp3');

const bilibiliSubtitleUrls = helpers.extractBilibiliSubtitleUrlsFromHtml([
  '<script>',
  '{"subtitle_url":"//subtitle.example.com/subtitle.json"}',
  '</script>',
].join(''));
assert.deepStrictEqual(bilibiliSubtitleUrls, ['https://subtitle.example.com/subtitle.json']);

assert.strictEqual(helpers.parseBilibiliSubtitlePayload({
  body: [
    { content: '第一句口播。' },
    { content: '第二句口播。' },
  ],
}), '第一句口播。\n第二句口播。');

assert.strictEqual(helpers.extractBilibiliAudioUrlFromPlayurlPayload({
  data: {
    dash: {
      audio: [
        {
          baseUrl: 'https://upos.example.com/audio.m4s?deadline=1',
          backupUrl: ['https://backup.example.com/audio.m4s'],
        },
      ],
    },
  },
}), 'https://upos.example.com/audio.m4s?deadline=1');

assert.strictEqual(helpers.extractBilibiliAudioUrlFromPlayurlPayload({
  data: {
    durl: [
      {
        url: 'https://upos.example.com/video.flv',
      },
    ],
  },
}), 'https://upos.example.com/video.flv');

const transcriptMarkdown = helpers.buildAudioTranscriptMarkdown({
  url: 'https://www.bilibili.com/video/BV123',
  transcription: '这是视频里真正说出来的内容。',
  transcriptionStatus: 'success',
  transcriptionSource: 'subtitle',
});
assert.ok(transcriptMarkdown.includes('## 口播/音频文案'));
assert.ok(transcriptMarkdown.includes('这是视频里真正说出来的内容。'));
assert.strictEqual(transcriptMarkdown.includes('## 标题'), false);
assert.strictEqual(transcriptMarkdown.includes('## 标签'), false);

const failedTranscriptMarkdown = helpers.buildAudioTranscriptMarkdown({
  url: 'https://www.douyin.com/video/123',
  transcriptionStatus: 'failed',
  transcriptionError: '没有提取到可转写媒体地址',
});
assert.ok(failedTranscriptMarkdown.includes('## 口播/音频文案'));
assert.strictEqual(failedTranscriptMarkdown.includes('## Markdown 内容'), false);
assert.strictEqual(failedTranscriptMarkdown.includes('## 视频文案'), false);
assert.strictEqual(failedTranscriptMarkdown.includes('window.__'), false);

const socialMediaUrl = helpers.extractSocialMediaUrlFromHtml([
  '<html><head>',
  '<meta property="og:video" content="https://video.example.com/talk.mp4?token=1">',
  '</head></html>',
].join(''));
assert.strictEqual(socialMediaUrl, 'https://video.example.com/talk.mp4?token=1');

const transcriptOnlyMetadata = helpers.buildTranscriptOnlyMetadata({
  title: '旧标题',
  markdown: '## Markdown 内容\nwindow.__INITIAL_STATE__',
  imageUrls: ['https://img.example.com/cover.jpg'],
}, {
  url: 'https://www.bilibili.com/video/BV123',
  platform: 'B站',
  transcription: '字幕里的口播内容',
  transcriptionStatus: 'success',
  transcriptionSource: 'bilibili-subtitle',
  mediaUrl: 'https://audio.example.com/a.m4s',
});
assert.strictEqual(transcriptOnlyMetadata.transcriptOnly, true);
assert.strictEqual(transcriptOnlyMetadata.markdown, undefined);
assert.strictEqual(transcriptOnlyMetadata.imageUrls, undefined);
assert.strictEqual(transcriptOnlyMetadata.title, 'B站口播文案');
assert.strictEqual(transcriptOnlyMetadata.transcription, '字幕里的口播内容');
assert.strictEqual(transcriptOnlyMetadata.audioUrl, 'https://audio.example.com/a.m4s');

const defaultLocalCommand = helpers.getDefaultLocalTranscriptionCommand();
assert.ok(defaultLocalCommand.includes('wechat-inbox-local-asr'));
assert.ok(defaultLocalCommand.includes('{input}'));
assert.ok(defaultLocalCommand.includes('{output}'));

const aliyunRequest = helpers.buildAliyunVoiceRequest({
  settings: {
    aliyunModel: 'qwen3.5-omni-plus',
  },
  audioUrl: 'https://temp.example.com/voice.mp3',
});

assert.strictEqual(aliyunRequest.model, 'qwen3.5-omni-plus');
assert.strictEqual(aliyunRequest.stream, true);
assert.deepStrictEqual(aliyunRequest.modalities, ['text']);
assert.strictEqual(aliyunRequest.messages[0].content[0].type, 'input_audio');
assert.strictEqual(aliyunRequest.messages[0].content[0].input_audio.data, 'https://temp.example.com/voice.mp3');
assert.strictEqual(aliyunRequest.messages[0].content[0].input_audio.format, 'mp3');

assert.strictEqual(
  helpers.parseAliyunTranscriptionResult('data: {"choices":[{"delta":{"content":"第一段"}}]}\n\ndata: {"choices":[{"delta":{"content":"第二段"}}]}\n\ndata: [DONE]\n'),
  '第一段第二段'
);

const doubaoRequest = helpers.buildDoubaoAsrRequest({
  apiKey: 'doubao-key',
  audioUrl: 'https://temp.example.com/voice.mp3',
  requestId: 'request-1',
});

assert.strictEqual(doubaoRequest.url, 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit');
assert.strictEqual(doubaoRequest.headers['X-Api-Key'], 'doubao-key');
assert.strictEqual(doubaoRequest.headers['X-Api-Resource-Id'], 'volc.seedasr.auc');
assert.strictEqual(doubaoRequest.headers['X-Api-Request-Id'], 'request-1');
assert.strictEqual(doubaoRequest.body.user.uid, 'wechat-inbox-sync');
assert.strictEqual(doubaoRequest.body.audio.url, 'https://temp.example.com/voice.mp3');
assert.strictEqual(doubaoRequest.body.audio.format, 'mp3');
assert.strictEqual(doubaoRequest.body.request.model_name, 'bigmodel');
assert.strictEqual(doubaoRequest.throw, false);

const doubaoQueryRequest = helpers.buildDoubaoAsrQueryRequest({
  apiKey: 'doubao-key',
  requestId: 'request-1',
});
assert.strictEqual(doubaoQueryRequest.url, 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query');
assert.strictEqual(doubaoQueryRequest.headers['X-Api-Key'], 'doubao-key');
assert.strictEqual(doubaoQueryRequest.headers['X-Api-Resource-Id'], 'volc.seedasr.auc');
assert.strictEqual(doubaoQueryRequest.headers['X-Api-Request-Id'], 'request-1');
assert.deepStrictEqual(doubaoQueryRequest.body, {});
assert.strictEqual(doubaoQueryRequest.throw, false);

assert.strictEqual(
  helpers.formatHttpError('Doubao', {
    status: 403,
    headers: {
      'X-Api-Status-Code': '4030001',
      'X-Api-Message': 'permission denied',
      'X-Api-Request-Id': 'req-1',
    },
    text: '{"message":"no permission"}',
  }),
  'Doubao请求失败：HTTP 403；X-Api-Status-Code=4030001；X-Api-Message=permission denied；X-Api-Request-Id=req-1；{"message":"no permission"}'
);

assert.strictEqual(helpers.parseDoubaoAsrResult({
  result: {
    text: '豆包转写结果',
  },
}), '豆包转写结果');

assert.strictEqual(helpers.parseDoubaoAsrResult({
  result: [
    { text: '第一段' },
    { text: '第二段' },
  ],
}), '第一段\n第二段');

assert.deepStrictEqual(helpers.parseDoubaoAsrTaskState({
  status: 200,
  headers: {
    'X-Api-Status-Code': '20000001',
  },
  json: {},
}), {
  status: 'processing',
  transcription: '',
});

assert.deepStrictEqual(helpers.parseDoubaoAsrTaskState({
  status: 200,
  headers: {
    'X-Api-Status-Code': '20000000',
  },
  json: {
    result: {
      text: 'è±†åŒ…è½¬å†™ç»“æžœ',
    },
  },
}), {
  status: 'success',
  transcription: 'è±†åŒ…è½¬å†™ç»“æžœ',
});

const createBody = helpers.buildTencentCreateRecTaskBody({
  audioUrl: 'https://temp.example.com/voice.mp3',
  engineModelType: '16k_zh',
});

assert.deepStrictEqual(createBody, {
  EngineModelType: '16k_zh',
  ChannelNum: 1,
  ResTextFormat: 0,
  SourceType: 0,
  Url: 'https://temp.example.com/voice.mp3',
});

const request = helpers.buildTencentRequest({
  action: 'CreateRecTask',
  region: 'ap-shanghai',
  secretId: 'AKIDEXAMPLE',
  secretKey: 'SECRET',
  body: createBody,
  timestamp: 1715596800,
});

assert.strictEqual(request.url, 'https://asr.tencentcloudapi.com');
assert.strictEqual(request.headers['X-TC-Action'], 'CreateRecTask');
assert.strictEqual(request.headers['X-TC-Version'], '2019-06-14');
assert.strictEqual(request.headers['X-TC-Region'], 'ap-shanghai');
assert.ok(request.canonicalRequest.includes('x-tc-action:createrectask'));
assert.ok(request.headers.Authorization.includes('TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2024-05-13/asr/tc3_request'));
assert.strictEqual(request.body, JSON.stringify(createBody));

assert.strictEqual(helpers.parseTencentCreateTaskResponse({
  Response: {
    Data: {
      TaskId: 123456,
    },
  },
}), 123456);

assert.deepStrictEqual(helpers.parseTencentTaskStatusResponse({
  Response: {
    Data: {
      Status: 2,
      StatusStr: 'success',
      Result: '[0:0.000,0:2.000] 第一段\n[0:2.000,0:4.000] 第二段',
    },
  },
}), {
  status: 2,
  statusStr: 'success',
  transcription: '第一段\n第二段',
  errorMsg: '',
});

async function runAsyncHydrationTests() {
  const plugin = new PluginClass();
  plugin.settings = { aiProvider: 'off' };

  const originalHttpRequest = http.request;
  const redirectMethods = [];
  http.request = (parsed, options, callback) => {
    const pathname = parsed.pathname || '';
    const method = options.method || 'GET';
    redirectMethods.push(`${method}:${pathname}`);
    const request = {
      setTimeout: () => request,
      on: () => request,
      destroy: () => {},
      end: () => {
        if (pathname === '/o/demo' && method === 'HEAD') {
          callback({ statusCode: 404, headers: {}, resume: () => {} });
          return;
        }
        if (pathname === '/o/demo' && method === 'GET') {
          callback({ statusCode: 302, headers: { location: '/final' }, resume: () => {} });
          return;
        }
        callback({ statusCode: 200, headers: {}, resume: () => {} });
      },
    };
    return request;
  };
  try {
    const resolvedShortUrl = await helpers.resolveRedirectUrl('http://xhslink.com/o/demo');
    assert.strictEqual(resolvedShortUrl, 'http://xhslink.com/final');
    assert.deepStrictEqual(redirectMethods, ['HEAD:/o/demo', 'GET:/o/demo', 'HEAD:/final']);
  } finally {
    http.request = originalHttpRequest;
  }

  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.douyin.com/video/123') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="Douyin Page">',
          '<meta name="description" content="页面正文不是口播">',
          '<meta property="og:video" content="https://video.example.com/douyin.mp4">',
          '</head><body>window.__DOUYIN_STATE__={}</body></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.xiaohongshu.com/explore/video') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="XHS Video">',
          '<meta property="og:video" content="https://video.example.com/xhs.mp4">',
          '</head><body>#tag 页面正文</body></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.xiaohongshu.com/explore/image') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="XHS Image">',
          '<meta name="description" content="真正图文正文 #图文">',
          '<meta property="og:image" content="https://img.example.com/cover.jpg">',
          '</head></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.bilibili.com/video/BV123') {
      return {
        text: '<script>{"subtitle_url":"https://subtitle.example.com/subtitle.json"}</script>',
      };
    }
    if (url === 'https://www.bilibili.com/video/BVNOSUB123') {
      return {
        text: '<html><head><title>B站无字幕视频</title></head><body></body></html>',
      };
    }
    if (url === 'https://api.bilibili.com/x/web-interface/view?bvid=BVNOSUB123') {
      return {
        json: {
          code: 0,
          data: {
            cid: 998877,
            pages: [{ cid: 998877 }],
          },
        },
      };
    }
    if (url === 'https://api.bilibili.com/x/player/v2?bvid=BVNOSUB123&cid=998877') {
      return {
        json: {
          code: 0,
          data: {
            subtitle: {
              subtitles: [],
            },
          },
        },
      };
    }
    if (url === 'https://api.bilibili.com/x/player/playurl?bvid=BVNOSUB123&cid=998877&fnval=16&fourk=1') {
      return {
        json: {
          code: 0,
          data: {
            dash: {
              audio: [
                {
                  baseUrl: 'https://upos.example.com/bili-audio.m4s?deadline=1',
                },
              ],
            },
          },
        },
      };
    }
    if (url === 'https://subtitle.example.com/subtitle.json') {
      return {
        json: {
          body: [
            { content: 'B站字幕第一句' },
            { content: 'B站字幕第二句' },
          ],
        },
      };
    }
    throw new Error(`unexpected request ${url}`);
  };

  const douyinRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.douyin.com/video/123',
    metadata: { url: 'https://www.douyin.com/video/123' },
  }, '', '', '抖音');
  assert.strictEqual(douyinRecord.metadata.transcriptOnly, true);
  assert.strictEqual(douyinRecord.metadata.markdown, undefined);
  assert.strictEqual(douyinRecord.metadata.transcriptionStatus, 'failed');
  assert.strictEqual(douyinRecord.metadata.mediaUrl, 'https://video.example.com/douyin.mp4');

  const renderedDouyinPlugin = new PluginClass();
  renderedDouyinPlugin.settings = { aiProvider: 'off' };
  renderedDouyinPlugin.renderSocialMediaUrl = async (pageUrl) => {
    assert.strictEqual(pageUrl, 'https://www.douyin.com/video/7644566503081119019');
    return 'https://www.douyin.com/aweme/v1/play/?video_id=v0200fg10000rendered&ratio=720p&line=0';
  };
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.douyin.com/video/7644566503081119019') {
      return {
        text: '<html><head><meta charset="UTF-8"></head><body><script>var glb;</script></body></html>',
      };
    }
    throw new Error(`unexpected rendered douyin request ${url}`);
  };
  const renderedDouyinRecord = await renderedDouyinPlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.douyin.com/video/7644566503081119019',
    metadata: { url: 'https://www.douyin.com/video/7644566503081119019' },
  }, '', '', '抖音真实页');
  assert.strictEqual(renderedDouyinRecord.metadata.transcriptOnly, true);
  assert.strictEqual(renderedDouyinRecord.metadata.mediaUrl, 'https://www.douyin.com/aweme/v1/play/?video_id=v0200fg10000rendered&ratio=720p&line=0');

  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/explore/video') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="XHS Video">',
          '<meta property="og:video" content="https://video.example.com/xhs.mp4">',
          '</head><body>#tag 页面正文</body></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.xiaohongshu.com/explore/image') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="XHS Image">',
          '<meta name="description" content="真正图文正文 #图文">',
          '<meta property="og:image" content="https://img.example.com/cover.jpg">',
          '</head></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.bilibili.com/video/BV123') {
      return {
        text: '<script>{"subtitle_url":"https://subtitle.example.com/subtitle.json"}</script>',
      };
    }
    if (url === 'https://www.bilibili.com/video/BVNOSUB123') {
      return {
        text: '<html><head><title>B站无字幕视频</title></head><body></body></html>',
      };
    }
    if (url === 'https://api.bilibili.com/x/web-interface/view?bvid=BVNOSUB123') {
      return {
        json: {
          code: 0,
          data: {
            cid: 998877,
            pages: [{ cid: 998877 }],
          },
        },
      };
    }
    if (url === 'https://api.bilibili.com/x/player/v2?bvid=BVNOSUB123&cid=998877') {
      return {
        json: {
          code: 0,
          data: {
            subtitle: {
              subtitles: [],
            },
          },
        },
      };
    }
    if (url === 'https://api.bilibili.com/x/player/playurl?bvid=BVNOSUB123&cid=998877&fnval=16&fourk=1') {
      return {
        json: {
          code: 0,
          data: {
            dash: {
              audio: [
                {
                  baseUrl: 'https://upos.example.com/bili-audio.m4s?deadline=1',
                },
              ],
            },
          },
        },
      };
    }
    if (url === 'https://subtitle.example.com/subtitle.json') {
      return {
        json: {
          body: [
            { content: 'B站字幕第一句' },
            { content: 'B站字幕第二句' },
          ],
        },
      };
    }
    throw new Error(`unexpected request ${url}`);
  };

  const xhsVideoRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/video',
    metadata: { url: 'https://www.xiaohongshu.com/explore/video' },
  }, '', '', '小红书视频');
  assert.strictEqual(xhsVideoRecord.metadata.transcriptOnly, true);
  assert.strictEqual(xhsVideoRecord.metadata.markdown, undefined);
  assert.strictEqual(xhsVideoRecord.metadata.mediaUrl, 'https://video.example.com/xhs.mp4');

  const xhsImageRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/image',
    metadata: { url: 'https://www.xiaohongshu.com/explore/image' },
  }, '', '', '小红书图文');
  assert.strictEqual(xhsImageRecord.metadata.transcriptOnly, undefined);
  assert.ok(xhsImageRecord.metadata.markdown.includes('真正图文正文'));

  const bilibiliRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.bilibili.com/video/BV123',
    metadata: { url: 'https://www.bilibili.com/video/BV123' },
  }, '', '', 'B站');
  assert.strictEqual(bilibiliRecord.metadata.transcriptOnly, true);
  assert.strictEqual(bilibiliRecord.metadata.transcriptionStatus, 'success');
  assert.strictEqual(bilibiliRecord.metadata.transcription, 'B站字幕第一句\nB站字幕第二句');

  const bilibiliAudioFallbackPlugin = new PluginClass();
  bilibiliAudioFallbackPlugin.settings = { aiProvider: 'off' };
  const bilibiliAudioRecord = await bilibiliAudioFallbackPlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.bilibili.com/video/BVNOSUB123',
    metadata: { url: 'https://www.bilibili.com/video/BVNOSUB123' },
  }, '', '', 'B站无字幕');
  assert.strictEqual(bilibiliAudioRecord.metadata.transcriptOnly, true);
  assert.strictEqual(bilibiliAudioRecord.metadata.mediaUrl, 'https://upos.example.com/bili-audio.m4s?deadline=1');
  assert.strictEqual(bilibiliAudioRecord.metadata.transcriptionStatus, 'failed');

  const pendingPlugin = new PluginClass();
  pendingPlugin.settings = { aiProvider: 'doubao' };
  pendingPlugin.runConfiguredTranscription = async () => {
    throw helpers.createRetryableTranscriptionError('豆包语音识别仍在处理中，请稍后再次同步');
  };
  await assert.rejects(
    () => pendingPlugin.buildTranscriptRecordFromMedia({
      type: 'webpage',
      content: 'https://www.xiaoyuzhoufm.com/episode/1',
      metadata: { url: 'https://www.xiaoyuzhoufm.com/episode/1' },
    }, {
      url: 'https://www.xiaoyuzhoufm.com/episode/1',
      platform: '小宇宙',
      mediaUrl: 'https://media.example.com/audio.m4a',
      source: 'audio',
    }),
    (error) => helpers.isRetryableTranscriptionError(error),
  );

  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaoyuzhoufm.com/episode/pending') {
      return {
        text: '<meta property="og:audio" content="https://media.example.com/pending.m4a">',
      };
    }
    throw new Error(`unexpected pending request ${url}`);
  };
  await assert.rejects(
    () => pendingPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'https://www.xiaoyuzhoufm.com/episode/pending',
      metadata: { url: 'https://www.xiaoyuzhoufm.com/episode/pending' },
    }, '', '', '小宇宙'),
    (error) => helpers.isRetryableTranscriptionError(error),
  );

  const protectedMediaPlugin = new PluginClass();
  protectedMediaPlugin.settings = { aiProvider: 'doubao' };
  protectedMediaPlugin.saveSettings = async (nextSettings) => {
    protectedMediaPlugin.settings = helpers.mergeSettings(nextSettings);
  };
  protectedMediaPlugin.runDoubaoTranscription = async () => {
    throw new Error('豆包语音识别请求失败：HTTP 200；X-Api-Status-Code=45000006；X-Api-Message=[Invalid audio URI] OperatorWrapper Process failed: internal error,audio download failed');
  };
  protectedMediaPlugin.canRunLocalTranscription = () => true;
  protectedMediaPlugin.runLocalTranscription = async (audioUrl) => {
    assert.strictEqual(audioUrl, 'https://upos.example.com/bili-audio.m4s?deadline=1');
    return '本地转写拿到的 B站口播';
  };
  const protectedMediaResult = await protectedMediaPlugin.runConfiguredTranscription('https://upos.example.com/bili-audio.m4s?deadline=1');
  assert.deepStrictEqual(protectedMediaResult, {
    transcription: '本地转写拿到的 B站口播',
    source: 'doubao-local',
  });

  const doubaoPlugin = new PluginClass();
  doubaoPlugin.settings = {
    aiProvider: 'doubao',
    doubaoAsrApiKey: 'doubao-key',
    doubaoPollAttempts: 1,
    doubaoPollIntervalMs: 1,
    pendingDoubaoTasks: {},
  };
  doubaoPlugin.saveSettings = async (nextSettings) => {
    doubaoPlugin.settings = helpers.mergeSettings(nextSettings);
  };
  let submitCount = 0;
  let queryCount = 0;
  requestUrlMock = async ({ url }) => {
    if (url.includes('/submit')) {
      submitCount += 1;
      return {
        status: 200,
        headers: { 'X-Api-Status-Code': '20000001' },
        json: {},
      };
    }
    if (url.includes('/query')) {
      queryCount += 1;
      return {
        status: 200,
        headers: { 'X-Api-Status-Code': queryCount === 1 ? '20000001' : '20000000' },
        json: queryCount === 1 ? {} : { result: { text: '第二次查询拿到结果' } },
      };
    }
    throw new Error(`unexpected doubao request ${url}`);
  };
  await assert.rejects(
    () => doubaoPlugin.runDoubaoTranscription('https://media.example.com/long.m4a'),
    (error) => helpers.isRetryableTranscriptionError(error),
  );
  const taskKey = helpers.getDoubaoTaskKey('https://media.example.com/long.m4a');
  assert.strictEqual(Boolean(doubaoPlugin.settings.pendingDoubaoTasks[taskKey].requestId), true);
  assert.strictEqual(submitCount, 1);

  const result = await doubaoPlugin.runDoubaoTranscription('https://media.example.com/long.m4a');
  assert.strictEqual(result, '第二次查询拿到结果');
  assert.strictEqual(submitCount, 1);
  assert.strictEqual(doubaoPlugin.settings.pendingDoubaoTasks[taskKey], undefined);
}

async function runOpenExternalUrlTests() {
  const originalWindow = global.window;
  global.window = {
    open(url, target, features) {
      assert.strictEqual(url, 'https://example.com/tutorial');
      assert.strictEqual(target, '_blank');
      assert.strictEqual(features, 'noopener');
      return {};
    },
  };
  try {
    assert.strictEqual(await helpers.openExternalUrl('https://example.com/tutorial'), true);
  } finally {
    global.window = originalWindow;
  }
}

async function runCloudRequestFallbackTests() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      assert.strictEqual(req.method, 'POST');
      assert.strictEqual(req.url, '/sync/bind');
      assert.strictEqual(req.headers.authorization, 'Bearer TEST-CODE');
      assert.strictEqual(req.headers['x-wechat-inbox-client-id'], 'test-client');
      assert.deepStrictEqual(JSON.parse(body), { clientId: 'test-client' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { status: 'bound' } }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const previousRequestUrlMock = requestUrlMock;
  requestUrlMock = async () => {
    throw new Error('net::ERR_CONNECTION_CLOSED');
  };

  const plugin = new PluginClass();
  plugin.settings = {
    apiBase: `http://127.0.0.1:${port}/sync`,
    token: 'TEST-CODE',
    clientId: 'test-client',
  };

  try {
    const payload = await plugin.requestJson('/bind', 'POST', { clientId: 'test-client' });
    assert.deepStrictEqual(payload, { success: true, data: { status: 'bound' } });
    assert.strictEqual(helpers.isRequestUrlTransportError('net::ERR_CONNECTION_CLOSED'), true);
  } finally {
    requestUrlMock = previousRequestUrlMock;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runMissingClientIdRequestTest() {
  const previousRequestUrlMock = requestUrlMock;
  requestUrlMock = async () => ({
    status: 400,
    text: JSON.stringify({
      success: false,
      errMsg: 'Missing client ID',
    }),
  });

  const plugin = new PluginClass();
  plugin.settings = {
    apiBase: 'https://example.com/sync',
    token: 'TEST-CODE',
    clientId: '',
  };

  try {
    await assert.rejects(
      () => plugin.requestJson('/bind', 'POST', {}),
      /本地设备标识缺失，请更新到最新版插件并重启 Obsidian 后再绑定/,
    );
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runUnbindInvalidCodeMarksLocalUnboundTest() {
  const previousRequestUrlMock = requestUrlMock;
  requestUrlMock = async () => ({
    status: 403,
    text: JSON.stringify({
      success: false,
      errMsg: 'Invalid or expired token',
    }),
  });

  const plugin = new PluginClass();
  plugin.saveData = async () => {};
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'OLD-123',
    clientId: 'test-client',
    bindings: [{
      token: 'OLD-123',
      label: '旧微信',
      enabled: true,
      status: 'bound',
    }],
  });
  let savedSettings = null;
  plugin.saveData = async (settings) => {
    savedSettings = settings;
  };

  try {
    await plugin.unbindBinding('OLD-123');
    assert.deepStrictEqual(plugin.settings.bindings, []);
    assert.strictEqual(plugin.settings.token, '');
    assert.deepStrictEqual(savedSettings.bindings, []);
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runLocalTranscriptionEntitlementTests() {
  const previousRequestUrlMock = requestUrlMock;
  const plugin = new PluginClass();
  plugin.saveData = async () => {};
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    bindings: [{
      token: 'ABC-123',
      label: '付费微信',
      enabled: true,
      status: 'bound',
    }],
  });

  requestUrlMock = async ({ url, method, headers }) => {
    assert.strictEqual(method, 'GET');
    assert.strictEqual(url, 'https://example.com/sync/entitlements/status?plan=local_transcription_beta');
    assert.strictEqual(headers.Authorization, 'Bearer ABC-123');
    return {
      status: 200,
      text: JSON.stringify({
        success: true,
        data: {
          hasAccess: true,
          plan: 'local_transcription_beta',
          status: 'active',
          expiresAt: '2026-07-03T08:00:00.000Z',
        },
      }),
    };
  };

  try {
    const status = await plugin.getLocalTranscriptionEntitlementStatus();
    assert.strictEqual(status.hasAccess, true);
    assert.strictEqual(status.expiresAt, '2026-07-03T08:00:00.000Z');
    assert.strictEqual(plugin.settings.localTranscriptionEntitlementStatus.hasAccess, true);
    assert.strictEqual(plugin.settings.localTranscriptionEntitlementStatus.expiresAt, '2026-07-03T08:00:00.000Z');
    assert.strictEqual(typeof plugin.redeemLocalTranscriptionCode, 'undefined');
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }

  const deniedPlugin = new PluginClass();
  deniedPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'DEF-456',
    clientId: 'test-client',
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    bindings: [{
      token: 'DEF-456',
      label: '免费微信',
      enabled: true,
      status: 'bound',
    }],
  });
  requestUrlMock = async () => ({
    status: 200,
    text: JSON.stringify({
      success: true,
      data: {
        hasAccess: false,
        plan: 'local_transcription_beta',
        status: 'expired',
        expiresAt: '2026-06-02T08:00:00.000Z',
      },
    }),
  });

  try {
    await assert.rejects(
      () => deniedPlugin.runConfiguredTranscription('https://media.example.com/demo.mp4'),
      /本地转写权限/,
    );
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function main() {
  await runAsyncHydrationTests();
  await runOpenExternalUrlTests();
  await runCloudRequestFallbackTests();
  await runMissingClientIdRequestTest();
  await runUnbindInvalidCodeMarksLocalUnboundTest();
  await runLocalTranscriptionEntitlementTests();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
