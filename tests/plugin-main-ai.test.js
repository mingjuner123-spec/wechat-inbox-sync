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

const PluginClass = require('../main');
Module._load = originalLoad;

const helpers = PluginClass.__test;
const fs = require('fs');
const path = require('path');
const os = require('os');
const pluginMainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function utf16BeHex(text) {
  const bytes = [0xfe, 0xff];
  Array.from(text).forEach((char) => {
    const code = char.charCodeAt(0);
    bytes.push((code >> 8) & 0xff, code & 0xff);
  });
  return Buffer.from(bytes).toString('hex').toUpperCase();
}

function createUtf16BePdfBuffer(text) {
  const stream = `BT /F1 12 Tf 72 720 Td <${utf16BeHex(text)}> Tj ET`;
  const streamBuffer = Buffer.from(stream, 'latin1');
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${streamBuffer.length} >>\nstream\n`, 'latin1'),
    streamBuffer,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

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
assert.strictEqual(typeof helpers.hasRecordIdInFrontmatter, 'function');
assert.strictEqual(typeof helpers.buildSkippedSyncNotice, 'function');
assert.strictEqual(typeof helpers.extractXiaohongshuMarkdownFromHtml, 'function');
assert.strictEqual(typeof helpers.enrichExtractedWebpageMetadata, 'function');
assert.strictEqual(typeof helpers.extractSocialVideoMarkdownFromHtml, 'function');
assert.strictEqual(typeof helpers.extractPodcastAudioUrlFromHtml, 'function');
assert.strictEqual(typeof helpers.extractBilibiliSubtitleUrlsFromHtml, 'function');
assert.strictEqual(typeof helpers.parseBilibiliSubtitlePayload, 'function');
assert.strictEqual(typeof helpers.extractBilibiliAudioUrlFromPlayurlPayload, 'function');
assert.strictEqual(typeof helpers.buildAudioTranscriptMarkdown, 'function');
assert.strictEqual(typeof helpers.buildTranscriptOnlyMetadata, 'function');
assert.strictEqual(typeof helpers.buildSyncProgressMessage, 'function');
assert.strictEqual(typeof helpers.parseLocalAsrProgressLog, 'function');
assert.strictEqual(typeof helpers.extractSocialMediaUrlFromHtml, 'function');
assert.strictEqual(typeof PluginClass.prototype.stopCurrentTranscription, 'function');
assert.ok(pluginMainSource.includes("setButtonText('停止当前转写')"));
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
assert.strictEqual(typeof helpers.htmlToMarkdown, 'function');
assert.strictEqual(typeof helpers.normalizeGeneratedKeywords, 'function');
assert.strictEqual(typeof helpers.parseGeneratedMetadataResponse, 'function');
assert.strictEqual(typeof helpers.extractAiMetadataInputText, 'function');
assert.strictEqual(typeof helpers.isWechatMpArticleUrl, 'function');
assert.strictEqual(typeof helpers.shouldHydrateLinkAsWebpage, 'function');
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
assert.ok(pluginMainSource.includes('installerUrl}?t=${Date.now()}'));
assert.ok(pluginMainSource.includes("source.includes('python-venv')"));
assert.ok(pluginMainSource.includes("source.includes('validate_local_asr_inference')"));
assert.ok(pluginMainSource.includes("source.includes('exec \"\\\\$WHISPER_CPP_BIN\" \"\\\\$@\"')"));
assert.ok(pluginMainSource.includes("source.includes('[string]$InstallRoot')"));
assert.ok(pluginMainSource.includes("source.includes('safeModelPath')"));
assert.ok(pluginMainSource.includes('downloadedPath'));
assert.ok(pluginMainSource.includes('return downloadedPath'));
assert.ok(pluginMainSource.includes('return installerPath'));
assert.ok(pluginMainSource.indexOf('return downloadedPath') < pluginMainSource.indexOf('return installerPath'));
assert.strictEqual(pluginMainSource.includes('if (fs.existsSync(installerPath)) return installerPath'), false);
assert.ok(pluginMainSource.includes('Local ASR installer download returned outdated or invalid content'));
assert.ok(pluginMainSource.includes("source.includes('Install-ExtractedPackage')"));
assert.ok(pluginMainSource.includes("!source.includes('Move-Item -LiteralPath $FfmpegStageDir -Destination $FfmpegDir')"));
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
assert.strictEqual(helpers.mergeSettings({}).cloudPreTranscriptionEnabled, false);
assert.strictEqual(helpers.mergeSettings({}).cloudPreTranscriptionThresholdMinutes, 10);
assert.strictEqual(helpers.mergeSettings({}).aiMetadataEnabled, true);
assert.strictEqual(helpers.mergeSettings({ aiMetadataEnabled: false }).aiMetadataEnabled, true);
assert.strictEqual(helpers.mergeSettings({ settingsVersion: 2, aiMetadataEnabled: false }).aiMetadataEnabled, false);
assert.strictEqual(helpers.mergeSettings({}).xiaohongshuCommentsEnabled, true);
assert.strictEqual(helpers.mergeSettings({ xiaohongshuCommentsEnabled: false }).xiaohongshuCommentsEnabled, true);
assert.strictEqual(helpers.mergeSettings({ settingsVersion: 2, xiaohongshuCommentsEnabled: false }).xiaohongshuCommentsEnabled, false);
assert.strictEqual(helpers.mergeSettings({}).deepseekApiKey, '');
assert.strictEqual(helpers.mergeSettings({}).deepseekModel, 'deepseek-chat');
assert.strictEqual(helpers.mergeSettings({ notePropertyFields: 'id,url' }).notePropertyFields, 'title,author,url,synced_at,source,description,keywords');
assert.strictEqual(helpers.mergeSettings({ cloudPreTranscriptionThresholdMinutes: 30 }).cloudPreTranscriptionThresholdMinutes, 30);
assert.strictEqual(helpers.mergeSettings({ cloudPreTranscriptionThresholdMinutes: 999 }).cloudPreTranscriptionThresholdMinutes, 10);
assert.strictEqual(helpers.mergeSettings({ autoSyncOnLoad: false }).autoSyncOnLoad, true);
assert.strictEqual(pluginMainSource.includes(".setName('同步 API 地址')"), false);
assert.strictEqual(pluginMainSource.includes(".setName('启动时自动同步')"), false);
assert.strictEqual(pluginMainSource.includes(".setName('本地转写命令')"), false);
assert.strictEqual(pluginMainSource.includes("local: '本地转写命令'"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('兑换并开通')"), false);
assert.strictEqual(pluginMainSource.includes(".setPlaceholder('例如 ZZAI030')"), false);
assert.ok(pluginMainSource.includes('小程序名字：Obsidian 内容同步助手'));
assert.ok(pluginMainSource.includes('打开微信小程序【Obsidian 内容同步助手】'));
assert.ok(pluginMainSource.includes(".setName('立即绑定')"));
assert.ok(pluginMainSource.includes(".setButtonText('立即绑定')"));
assert.ok(pluginMainSource.includes('已完成绑定的微信'));
assert.strictEqual(pluginMainSource.includes("text: '已绑定小程序码'"), false);
assert.strictEqual(pluginMainSource.includes(".setName('新增绑定码')"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('新增绑定码')"), false);
assert.ok(pluginMainSource.includes("text: '使用教程'"));
assert.ok(pluginMainSource.includes("text: '绑定小程序'"));
assert.strictEqual(pluginMainSource.includes("text: 'Pro 本地转写功能'"), false);
assert.ok(pluginMainSource.includes("text: '高级选项'"));
assert.ok(pluginMainSource.includes("createEl('details'"));
assert.ok(pluginMainSource.includes("text: 'AI 简介与关键词'"));
assert.strictEqual(pluginMainSource.includes(".setName('DeepSeek API Key')"), false);
assert.strictEqual(pluginMainSource.includes(".setName('测试 AI 连接')"), false);
assert.strictEqual(pluginMainSource.includes("text: '公众号评论区提取（实验性）'"), false);
assert.strictEqual(pluginMainSource.includes(".setName('笔记属性字段')"), false);
assert.ok(pluginMainSource.includes("text: '飞书文档提取'"));
assert.ok(pluginMainSource.includes(".setName('登录飞书')"));
assert.ok(pluginMainSource.includes(".setButtonText('打开飞书登录')"));
assert.ok(pluginMainSource.includes('插件会优先尝试无登录提取'));
assert.strictEqual(pluginMainSource.includes("text: 'Feishu link extraction'"), false);
assert.strictEqual(pluginMainSource.includes(".setName('Feishu web login')"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('Login Feishu')"), false);
assert.ok(pluginMainSource.includes("text: '小红书评论区提取'"));
assert.ok(pluginMainSource.includes(".setName('提取小红书评论区')"));
assert.ok(pluginMainSource.includes(".setButtonText('检测小红书登录状态')"));
assert.ok(pluginMainSource.includes("text: '本地转写组件（高级/备用）'"));
assert.ok(pluginMainSource.includes('默认走本地转写'));
assert.ok(pluginMainSource.includes('wechat-inbox-sync-section-spacer'));
assert.ok(pluginMainSource.indexOf("text: '使用教程'") < pluginMainSource.indexOf("text: '绑定小程序'"));
assert.ok(pluginMainSource.indexOf("text: '绑定小程序'") < pluginMainSource.indexOf("text: '高级选项'"));
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
assert.ok(pluginMainSource.includes('发给开发者张张（微信：heyhmjx）'));
assert.ok(pluginMainSource.includes('/transcriptions/cloud'));
assert.ok(pluginMainSource.includes('runCloudFallbackTranscription'));
assert.ok(pluginMainSource.includes('local-cloud-fallback'));
assert.ok(pluginMainSource.includes('云端兜底'));
assert.strictEqual(pluginMainSource.includes("setName('语音转写')"), false);
assert.strictEqual(pluginMainSource.includes("setName('豆包语音识别 API Key')"), false);
assert.strictEqual(pluginMainSource.includes("setName('阿里百炼 API Key')"), false);
assert.strictEqual(pluginMainSource.includes("setName('腾讯云 SecretId')"), false);
assert.strictEqual(pluginMainSource.includes("setName('长音视频云端预转写')"), false);
assert.strictEqual(pluginMainSource.includes("setName('云端预转写阈值')"), false);
assert.ok(pluginMainSource.includes('正在同步'));
assert.ok(pluginMainSource.includes('正在处理'));
assert.strictEqual(typeof helpers.hasXiaohongshuAccountCookie, 'function');
assert.strictEqual(helpers.XIAOHONGSHU_SESSION_PARTITION, 'persist:wechat-inbox-xiaohongshu');
assert.strictEqual(typeof helpers.probeXiaohongshuLoginStatus, 'function');
assert.strictEqual(typeof helpers.renderXiaohongshuMarkdownWithElectron, 'function');
assert.ok(pluginMainSource.includes('function getXiaohongshuSession()'));
assert.ok(pluginMainSource.includes('const session = getXiaohongshuSession();'));
assert.ok(pluginMainSource.includes('return await probeXiaohongshuLoginStatus();'));
const checkWechatLoginSource = pluginMainSource.slice(
  pluginMainSource.indexOf('async function checkWechatLoginStatus'),
  pluginMainSource.indexOf('async function checkFeishuLoginStatus'),
);
const checkFeishuLoginSource = pluginMainSource.slice(
  pluginMainSource.indexOf('async function checkFeishuLoginStatus'),
  pluginMainSource.indexOf('async function getXiaohongshuCookies'),
);
assert.ok(checkWechatLoginSource.includes('const session = getWechatSession();'));
assert.ok(checkFeishuLoginSource.includes('const session = getWechatSession();'));
const loginXhsSource = pluginMainSource.slice(
  pluginMainSource.indexOf('async function loginXiaohongshuWeb'),
  pluginMainSource.indexOf('function getElectronShell'),
);
assert.ok(loginXhsSource.includes('const session = getXiaohongshuSession();'));
assert.strictEqual(loginXhsSource.includes('setInterval'), false);
assert.strictEqual(loginXhsSource.includes('win.destroy()'), false);
assert.strictEqual(helpers.hasXiaohongshuAccountCookie([
  { name: 'webId', value: 'device-web-id' },
  { name: 'a1', value: 'device-a1' },
  { name: 'gid', value: 'device-gid' },
  { name: 'xsecappid', value: 'xhs-pc-web' },
]), false);
assert.strictEqual(helpers.hasXiaohongshuAccountCookie([
  { name: 'web_session', value: 'account-session-token' },
]), true);
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
assert.strictEqual(helpers.isWechatMpArticleUrl('https://mp.weixin.qq.com/s/example'), true);
assert.strictEqual(helpers.shouldHydrateLinkAsWebpage('https://mp.weixin.qq.com/s/example'), true);
assert.strictEqual(helpers.shouldHydrateLinkAsWebpage('https://developers.weixin.qq.com/miniprogram'), false);
const wechatCodeMarkdown = helpers.htmlToMarkdown(`
  <html>
    <body>
      <div id="js_content">
        <h2>Part4 Python可视化JRA-3Q气温数据</h2>
        <pre><code>import numpy as np
import xarray as xr
# 读取JRA-3Q气温数据
ds=xr.open_dataset('./jra3q.anl_surf.0_0_0.tmp2m-hgt-an-gauss.2026050100_2026053118.nc')
# 绘制中国区域降水分布图
region=[70, 140, 15, 55]
# 读取地形数据
img=plt.imread('./ned.tif')
for item in [1, 2]:
    print(item)</code></pre>
      </div>
      <script></script>
    </body>
  </html>
`);
assert.ok(wechatCodeMarkdown.includes('```'));
assert.ok(wechatCodeMarkdown.includes('\n# 读取JRA-3Q气温数据\n'));
assert.strictEqual(
  /^# 读取JRA-3Q气温数据/m.test(wechatCodeMarkdown.replace(/```[\s\S]*?```/g, '')),
  false,
);
const cleanedCodeMarkdown = helpers.cleanMarkdownForStorage(wechatCodeMarkdown);
assert.ok(cleanedCodeMarkdown.includes('```'));
assert.ok(cleanedCodeMarkdown.includes('ds=xr.open_dataset'));
assert.ok(cleanedCodeMarkdown.includes('    print(item)'));
assert.strictEqual(
  /^# 绘制中国区域降水分布图/m.test(cleanedCodeMarkdown.replace(/```[\s\S]*?```/g, '')),
  false,
);
const wechatCommentHtml = `
  <html>
    <body>
      <div id="js_content"><p>这是一段足够长的公众号正文内容，用来确认评论区不会被保存到 Markdown 文件。</p></div>
      <div id="js_cmt_area">
        <ul id="js_cmt_list">
          <li class="comment_card">
            <span class="nickname">读者A</span>
            <div class="comment_content">这个资料很有用，感谢整理。</div>
          </li>
        </ul>
      </div>
      <script></script>
    </body>
  </html>
`;
const wechatCommentMarkdown = helpers.htmlToMarkdown(wechatCommentHtml);
assert.strictEqual(wechatCommentMarkdown.includes('## 评论区'), false);
assert.strictEqual(wechatCommentMarkdown.includes('这个资料很有用，感谢整理。'), false);
const wechatTableMarkdown = helpers.htmlToMarkdown(`
  <html>
    <body>
      <div id="js_content">
        <p>SAR后向散射特性与传感器频段相关。</p>
        <table>
          <tbody>
            <tr><th>频段</th><th>频率</th><th>波长</th><th>应用方向</th></tr>
            <tr><td>Ka</td><td>27-40°GHz</td><td>1.1-0.8°cm</td><td>SAR中应用较少</td></tr>
            <tr><td>X</td><td>8-12°GHz</td><td>3.8-2.4°cm</td><td>适用于城市监测、冰雪环境</td></tr>
          </tbody>
        </table>
      </div>
    </body>
  </html>
`);
assert.ok(wechatTableMarkdown.includes('| 频段 | 频率 | 波长 | 应用方向 |'));
assert.ok(wechatTableMarkdown.includes('| --- | --- | --- | --- |'));
assert.ok(wechatTableMarkdown.includes('| Ka | 27-40°GHz | 1.1-0.8°cm | SAR中应用较少 |'));
assert.ok(wechatTableMarkdown.includes('| X | 8-12°GHz | 3.8-2.4°cm | 适用于城市监测、冰雪环境 |'));
const flattenedWechatTableMarkdown = helpers.cleanMarkdownForStorage([
  'SAR后向散射特性与传感器的工作频率、波长密切相关。',
  '',
  '频段',
  '',
  '频率',
  '',
  '波长',
  '',
  '应用方向',
  '',
  'Ka',
  '',
  '27-40°GHz',
  '',
  '1.1-0.8°cm',
  '',
  'SAR中应用较少',
  '',
  'K',
  '',
  '18-27°GHz',
  '',
  '1.7-1.1°cm',
  '',
  'SAR中应用较少',
  '',
  '与此同时，雷达波长与空间分辨率呈负相关。',
].join('\n'));
assert.ok(flattenedWechatTableMarkdown.includes('| 频段 | 频率 | 波长 | 应用方向 |'));
assert.ok(flattenedWechatTableMarkdown.includes('| Ka | 27-40°GHz | 1.1-0.8°cm | SAR中应用较少 |'));
assert.ok(flattenedWechatTableMarkdown.includes('| K | 18-27°GHz | 1.7-1.1°cm | SAR中应用较少 |'));
assert.ok(flattenedWechatTableMarkdown.includes('\n与此同时，雷达波长与空间分辨率呈负相关。'));
const wechatScriptCommentHtml = `
  <html>
    <body>
      <div id="js_content"><p>这是一段足够长的公众号正文内容，用来确认脚本里的评论数据不会被保存。</p></div>
      <script>
        window.cgiData = {
          elected_comment: [{
            nick_name: "读者B",
            content: "评论来自脚本数据",
            create_time: "2026-06-22",
            like_num: 12
          }]
        };
      </script>
    </body>
  </html>
`;
assert.strictEqual(helpers.htmlToMarkdown(wechatScriptCommentHtml).includes('评论来自脚本数据'), false);
const feishuStaticMarkdown = helpers.extractFeishuMarkdownFromHtml(`
  <html>
    <body>
      <h1>一级标题</h1>
      <h2>二级标题</h2>
      <p>正文第一段</p>
      <h3>三级标题</h3>
      <img src="https://example.com/a.png" alt="流程图">
      <script>
        window.__DATA__ = {
          "block_type":"heading2",
          "text":"脚本二级标题",
          "url":"https://example.com/b.jpg"
        };
      </script>
    </body>
  </html>
`);
assert.strictEqual(feishuStaticMarkdown.includes('## 目录'), false);
assert.ok(feishuStaticMarkdown.includes('# 一级标题'));
assert.ok(feishuStaticMarkdown.includes('## 二级标题'));
assert.ok(feishuStaticMarkdown.includes('### 三级标题'));
assert.ok(feishuStaticMarkdown.includes('![流程图](https://example.com/a.png)'));
assert.ok(feishuStaticMarkdown.includes('![图片](https://example.com/b.jpg)'));
const feishuCleanMarkdown = helpers.extractFeishuMarkdownFromHtml(`
  <html>
    <body>
      <h1>踩中5次风口，赚了100w+</h1>
      <aside class="docx-outline">
        <div class="outline-item" data-level="1">踩中5次风口，赚了100w+</div>
        <div class="outline-item" data-level="2">2020年之前，我没有任何目标</div>
        <div class="outline-item" data-level="3">第一次风口：小红书商单</div>
        <div class="outline-item" data-level="3">第一，旧元素重组，就是创新</div>
        <div class="outline-item" data-level="2">我的真实经历</div>
      </aside>
      <p>分享</p>
      <p>共有 22 个协作者</p>
      <p>+17</p>
      <p>图2</p>
      <p>添加快捷方式最近修改: 昨天 16:14</p>
      <p>上传日志</p>
      <p>联系客服</p>
      <p>功能更新</p>
      <p>帮助中心</p>
      <p>效率指南</p>
      <p>你可能还想问 (2)</p>
      <p>推荐内容由 AI 生成</p>
      <p>加载中...</p>
      <p>本文暂未引用其它文档</p>
      <p>取消发送</p>
      <p>1 人点赞</p>
      <p>- 踩中5次风口，赚了100w+ - 2020年之前，我没有任何目标 - 第一次风口：小红书商单</p>
      <p>2020年之前，我没有任何目标</p>
      <p>第一次风口：小红书商单</p>
      <p>第一，旧元素重组，就是创新</p>
      <p>我的真实经历</p>
      <p>第一，普通正文没有在飞书目录里，就不能被猜成标题。</p>
      <p>复盘这几次经历我发现，其实我从来没有刻意去追过什么风口，也没有研究趋势报告。</p>
      <p>正文内容应该保留下来，作为普通正文继续显示。</p>
    </body>
  </html>
`);
assert.strictEqual(feishuCleanMarkdown.includes('分享'), false);
assert.strictEqual(feishuCleanMarkdown.includes('共有 22 个协作者'), false);
assert.strictEqual(feishuCleanMarkdown.includes('+17'), false);
assert.strictEqual(feishuCleanMarkdown.includes('图2'), false);
assert.strictEqual(feishuCleanMarkdown.includes('添加快捷方式'), false);
assert.strictEqual(feishuCleanMarkdown.includes('最近修改'), false);
assert.strictEqual(feishuCleanMarkdown.includes('上传日志'), false);
assert.strictEqual(feishuCleanMarkdown.includes('联系客服'), false);
assert.strictEqual(feishuCleanMarkdown.includes('功能更新'), false);
assert.strictEqual(feishuCleanMarkdown.includes('帮助中心'), false);
assert.strictEqual(feishuCleanMarkdown.includes('效率指南'), false);
assert.strictEqual(feishuCleanMarkdown.includes('你可能还想问'), false);
assert.strictEqual(feishuCleanMarkdown.includes('推荐内容'), false);
assert.strictEqual(feishuCleanMarkdown.includes('加载中'), false);
assert.strictEqual(feishuCleanMarkdown.includes('本文暂未引用'), false);
assert.strictEqual(feishuCleanMarkdown.includes('取消发送'), false);
assert.strictEqual(feishuCleanMarkdown.includes('人点赞'), false);
assert.strictEqual(feishuCleanMarkdown.includes('- 踩中5次风口'), false);
assert.ok(feishuCleanMarkdown.includes('# 踩中5次风口，赚了100w+'));
assert.ok(feishuCleanMarkdown.includes('## 2020年之前，我没有任何目标'));
assert.ok(feishuCleanMarkdown.includes('### 第一次风口：小红书商单'));
assert.ok(feishuCleanMarkdown.includes('### 第一，旧元素重组，就是创新'));
assert.ok(feishuCleanMarkdown.includes('## 我的真实经历'));
assert.strictEqual(feishuCleanMarkdown.includes('### 第一，普通正文没有在飞书目录里'), false);
assert.ok(feishuCleanMarkdown.includes('第一，普通正文没有在飞书目录里，就不能被猜成标题。'));
assert.strictEqual(feishuCleanMarkdown.includes('# 复盘这几次经历我发现'), false);
assert.ok(feishuCleanMarkdown.includes('复盘这几次经历我发现，其实我从来没有刻意去追过什么风口，也没有研究趋势报告。'));
assert.ok(feishuCleanMarkdown.includes('正文内容应该保留下来'));
const enrichedFeishuMetadata = helpers.enrichExtractedWebpageMetadata({
  title: '踩中5次风口，赚了100w+',
  markdown: feishuCleanMarkdown,
  platform: '飞书',
});
assert.ok(enrichedFeishuMetadata.description.includes('普通正文') || enrichedFeishuMetadata.description.includes('复盘这几次经历我发现'));
assert.strictEqual(enrichedFeishuMetadata.description.includes('我的真实经历'), false);
assert.strictEqual(enrichedFeishuMetadata.description.includes('添加快捷方式'), false);
assert.ok(enrichedFeishuMetadata.keywords.includes('风口'));
const feishuRenderedBodyCleanup = helpers.cleanMarkdownForStorage([
  '内容有点长，我想把如何找到自己的新业务讲清楚。',
  '',
  '2020年之前，我没有任何目标',
  '',
  '踩中第一个风口之前，我一直在跑地推销售。',
  '',
  '- 上传日志',
  '',
  '- 联系客服',
  '',
  '- 功能更新',
  '',
  '- 帮助中心',
  '',
  '- 效率指南',
  '',
  '- 第一次风口：小红书商单',
  '- 第二次风口：小红书电商',
  '- 第三次风口：小红书虚拟电商',
  '- 第四、五次风口：AI知识库 + 企业培训',
  '',
  '第一次风口：小红书商单',
  '',
  '2020年，疫情原因没法继续跑地推。',
].join('\n'), {
  dedupe: true,
  feishuTitle: '踩中5次风口，赚了100w+',
});
assert.ok(feishuRenderedBodyCleanup.includes('## 2020年之前，我没有任何目标'));
assert.ok(feishuRenderedBodyCleanup.includes('## 第一次风口：小红书商单'));
assert.strictEqual(feishuRenderedBodyCleanup.includes('上传日志'), false);
assert.strictEqual(feishuRenderedBodyCleanup.includes('联系客服'), false);
assert.strictEqual(feishuRenderedBodyCleanup.includes('功能更新'), false);
assert.strictEqual(feishuRenderedBodyCleanup.includes('帮助中心'), false);
assert.strictEqual(feishuRenderedBodyCleanup.includes('效率指南'), false);
assert.strictEqual(feishuRenderedBodyCleanup.includes('- 第二次风口：小红书电商'), false);
const feishuDirtyTitleBase = helpers.buildRecordTitleBase({
  type: 'webpage',
  content: 'https://my.feishu.cn/docx/VpP7d1nwuomPF5xHSrIcxrtUn8f',
  metadata: {
    title: '\u2063\u200b\u2063 ‌‌​‬⁢⁤ ‬⁤ ‬‍⁢​​‍⁤⁡ ⁢‍​‌⁢⁢​​⁡⁢⁢‌‬⁢⁡‍​‌⁣⁤‬​​‍‍踩中5次风口，赚',
    platform: '飞书',
  },
});
assert.strictEqual(feishuDirtyTitleBase, '飞书-踩中5次风口，赚');
const feishuClientVarsMarkdown = helpers.extractFeishuMarkdownFromClientVars({
  id: 'root',
  block_sequence: ['root', 'heading-block', 'paragraph-block', 'table-block', 'image-block', 'bullet-block'],
  block_map: {
    root: { id: 'root', data: { type: 'page' } },
    'heading-block': {
      id: 'heading-block',
      data: {
        type: 'heading1',
        text: { initialAttributedTexts: { text: { 0: '飞书新版标题' } } },
      },
    },
    'paragraph-block': {
      id: 'paragraph-block',
      data: {
        type: 'text',
        text: { initialAttributedTexts: { text: { 0: '新版 client vars 正文内容' } } },
      },
    },
    'table-block': {
      id: 'table-block',
      data: {
        type: 'table',
        rows: [
          [{ text: { initialAttributedTexts: { text: { 0: '频段' } } } }, { text: { initialAttributedTexts: { text: { 0: '频率' } } } }],
          [{ text: { initialAttributedTexts: { text: { 0: 'Ka' } } } }, { text: { initialAttributedTexts: { text: { 0: '27-40GHz' } } } }],
        ],
      },
    },
    'image-block': {
      id: 'image-block',
      data: {
        type: 'image',
        image: { origin_url: 'https://example.com/feishu-image.png' },
      },
    },
    'bullet-block': {
      id: 'bullet-block',
      data: {
        type: 'bullet',
        text: { initialAttributedTexts: { text: { 0: '列表项目' } } },
      },
    },
  },
});
assert.ok(feishuClientVarsMarkdown.includes('# 飞书新版标题'));
assert.ok(feishuClientVarsMarkdown.includes('新版 client vars 正文内容'));
assert.strictEqual(feishuClientVarsMarkdown.includes('## 目录'), false);
assert.ok(feishuClientVarsMarkdown.includes('| 频段 | 频率 |'));
assert.ok(feishuClientVarsMarkdown.includes('| Ka | 27-40GHz |'));
assert.ok(feishuClientVarsMarkdown.includes('![图片](https://example.com/feishu-image.png)'));
assert.ok(feishuClientVarsMarkdown.includes('- 列表项目'));
assert.strictEqual(typeof helpers.extractWebpageMetadataFromHtml, 'function');
const articleMeta = helpers.extractWebpageMetadataFromHtml(`
  <html>
    <head>
      <meta property="og:title" content="公众号文章标题">
      <meta name="author" content="保姆级教程">
      <meta name="description" content="这是一篇介绍 Codex 的文章">
      <meta name="keywords" content="Codex, DeepSeek, 教程">
    </head>
  </html>
`, 'https://mp.weixin.qq.com/s/example');
assert.deepStrictEqual(articleMeta, {
  title: '公众号文章标题',
  author: '保姆级教程',
  description: '这是一篇介绍 Codex 的文章',
  keywords: ['Codex', 'DeepSeek', '教程'],
  platform: '公众号',
  contentCategory: '图文',
});
assert.strictEqual(
  helpers.buildSkippedSyncNotice([{ reason: 'already-synced-local' }, { reason: 'already-synced-local' }]),
  '',
);
assert.strictEqual(
  helpers.buildSkippedSyncNotice([{ reason: 'cloud-transcription-processing' }]),
  '，1 条云端转写中，完成后再同步',
);
assert.strictEqual(
  helpers.buildSkippedSyncNotice([{ reason: 'already-synced-local' }, { reason: 'cloud-transcription-processing' }]),
  '，1 条云端转写中，完成后再同步',
);
assert.deepStrictEqual(
  helpers.normalizeGeneratedKeywords('#飞书机器人, Obsidian，效率提升  AI'),
  ['飞书机器人', 'Obsidian', '效率提升', 'AI'],
);
assert.deepStrictEqual(
  helpers.parseGeneratedMetadataResponse('```json\n{"description":"一句话总结","keywords":["飞书机器人","Obsidian","效率"]}\n```'),
  {
    description: '一句话总结',
    keywords: ['飞书机器人', 'Obsidian', '效率'],
  },
);
assert.deepStrictEqual(
  helpers.parseGeneratedMetadataResponse('description: 一句话总结\nkeywords: 飞书机器人, Obsidian, 效率'),
  {
    description: '一句话总结',
    keywords: ['飞书机器人', 'Obsidian', '效率'],
  },
);
const aiMetadataInput = helpers.extractAiMetadataInputText({
  type: 'webpage',
  content: 'https://example.com/post',
  metadata: {
    title: '飞书机器人直播回放',
    markdown: '# 飞书机器人直播回放\n\n这是正文第一段。\n\n- 要点一\n- 要点二\n\n```js\nconst hidden = true;\n```',
  },
});
assert.ok(aiMetadataInput.includes('飞书机器人直播回放'));
assert.ok(aiMetadataInput.includes('这是正文第一段'));
assert.ok(aiMetadataInput.includes('要点一'));
assert.strictEqual(aiMetadataInput.includes('const hidden = true;'), false);
assert.strictEqual(
  helpers.getLocalAsrInstallRoot('C:\\Users\\demo', 'default', 'win32'),
  'C:\\Users\\demo\\.wechat-inbox-local-asr',
);
assert.deepStrictEqual(
  helpers.getLocalAsrInstallStatus('C:\\Users\\demo\\.wechat-inbox-local-asr', (filePath) => filePath.endsWith('transcribe.ps1'), 'win32'),
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
].includes(filePath), 'win32');
assert.strictEqual(completeWindowsAsrStatus.whisperPath, 'C:\\Users\\demo\\.wechat-inbox-local-asr\\whisper\\whisper-cli.exe');
assert.strictEqual(completeWindowsAsrStatus.ffmpegPath, 'C:\\Users\\demo\\.wechat-inbox-local-asr\\ffmpeg\\ffmpeg.exe');
assert.deepStrictEqual(completeWindowsAsrStatus.missingReasons, []);
{
  const tempAsrRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-asr-status-'));
  fs.mkdirSync(path.join(tempAsrRoot, 'whisper', 'Release'), { recursive: true });
  fs.mkdirSync(path.join(tempAsrRoot, 'ffmpeg', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(tempAsrRoot, 'models'), { recursive: true });
  fs.writeFileSync(path.join(tempAsrRoot, 'whisper', 'Release', 'main.exe'), '');
  fs.writeFileSync(path.join(tempAsrRoot, 'whisper', 'Release', 'whisper-cli.exe'), '');
  fs.writeFileSync(path.join(tempAsrRoot, 'ffmpeg', 'bin', 'ffmpeg.exe'), '');
  fs.writeFileSync(path.join(tempAsrRoot, 'models', 'ggml-small.bin'), '');
  fs.writeFileSync(
    path.join(tempAsrRoot, 'transcribe.ps1'),
    'function Convert-ExitCodeToHex { $signed = [int64]$ExitCode; if ($signed -lt 0) { $signed = 4294967296 + $signed }; return "0x{0:X8}" -f $signed }\nfunction Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }\nfunction Split-AudioToChunks { param([string]$AudioPath, [int]$SegmentSeconds) }\nfunction Test-TranscriptHasRepeatHallucination { param([string]$Text) }\nfunction Invoke-RecoverRepeatedChunkText { param([string]$ChunkPath) }\nfunction Test-WhisperNativeCrashExitCode { $hex = Convert-ExitCodeToHex -ExitCode $ExitCode }\nInvoke-TranscribeAttempt -Mode "normal"\nInvoke-TranscribeAttempt -Mode "safe"\nsafeModelPath\nfunction Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$SimplifiedPrompt = [string]::Concat([char]0x8bf7)\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n"--prompt", $SimplifiedPrompt\n$ChunkSeconds = 120\n$ChunkRetrySeconds = 30\n$RunLog = Join-Path $Root "transcribe-last.log"\nprogressPercent=100\nrecoveryTriggered=1',
    'utf8',
  );
  const recursiveStatus = helpers.getLocalAsrInstallStatus(tempAsrRoot, fs.existsSync, os.platform());
  assert.strictEqual(path.basename(recursiveStatus.whisperPath), 'whisper-cli.exe');
  assert.strictEqual(path.basename(recursiveStatus.ffmpegPath), 'ffmpeg.exe');
  assert.strictEqual(recursiveStatus.ready, true);
  fs.rmSync(tempAsrRoot, { recursive: true, force: true });
}
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
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-start-process-utf8-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$SimplifiedPrompt = [string]::Concat([char]0x8bf7)\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n"--prompt", $SimplifiedPrompt\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-start-process-utf8-simplified-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }\n$SafeTempRoot = New-SafeTempDirectory\nfunction Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$SimplifiedPrompt = [string]::Concat([char]0x8bf7)\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n"--prompt", $SimplifiedPrompt\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-start-process-utf8-simplified-shortpath-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }\nfunction Test-WhisperNativeCrashExitCode {}\nInvoke-TranscribeAttempt -Mode "normal"\nInvoke-TranscribeAttempt -Mode "safe"\nfunction Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$SimplifiedPrompt = [string]::Concat([char]0x8bf7)\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n"--prompt", $SimplifiedPrompt\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-start-process-utf8-simplified-fallback-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Convert-ExitCodeToHex { $signed = [int64]$ExitCode; if ($signed -lt 0) { $signed = 4294967296 + $signed }; return "0x{0:X8}" -f $signed }\nfunction Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }\nfunction Test-WhisperNativeCrashExitCode { $hex = Convert-ExitCodeToHex -ExitCode $ExitCode }\nInvoke-TranscribeAttempt -Mode "normal"\nInvoke-TranscribeAttempt -Mode "safe"\nfunction Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$SimplifiedPrompt = [string]::Concat([char]0x8bf7)\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n"--prompt", $SimplifiedPrompt\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"',
  }),
  {
    scriptVersion: 'chunked-start-process-utf8-simplified-fallback-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Convert-ExitCodeToHex { $signed = [int64]$ExitCode; if ($signed -lt 0) { $signed = 4294967296 + $signed }; return "0x{0:X8}" -f $signed }\nfunction Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }\nfunction Split-AudioToChunks { param([string]$AudioPath, [int]$SegmentSeconds) }\nfunction Test-TranscriptHasRepeatHallucination { param([string]$Text) }\nfunction Invoke-RecoverRepeatedChunkText { param([string]$ChunkPath) }\nfunction Test-WhisperNativeCrashExitCode { $hex = Convert-ExitCodeToHex -ExitCode $ExitCode }\nInvoke-TranscribeAttempt -Mode "normal"\nInvoke-TranscribeAttempt -Mode "safe"\nsafeModelPath\nfunction Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$SimplifiedPrompt = [string]::Concat([char]0x8bf7)\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n"--prompt", $SimplifiedPrompt\n$ChunkSeconds = 120\n$ChunkRetrySeconds = 30\n$RunLog = Join-Path $Root "transcribe-last.log"\nprogressPercent=100\nrecoveryTriggered=1',
  }),
  {
    scriptVersion: 'adaptive-chunked-start-process-repeat-guard-progress-run-log',
    scriptOutdated: false,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Convert-ExitCodeToHex { $signed = [int64]$ExitCode; if ($signed -lt 0) { $signed = 4294967296 + $signed }; return "0x{0:X8}" -f $signed }\nfunction Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }\nfunction Test-WhisperNativeCrashExitCode { $hex = Convert-ExitCodeToHex -ExitCode $ExitCode }\nInvoke-TranscribeAttempt -Mode "normal"\nInvoke-TranscribeAttempt -Mode "safe"\nsafeModelPath\nfunction Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$SimplifiedPrompt = [string]::Concat([char]0x8bf7)\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n"--prompt", $SimplifiedPrompt\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"\nprogressPercent=100',
  }),
  {
    scriptVersion: 'chunked-start-process-utf8-simplified-fallback-safe-model-progress-run-log',
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
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('/Users/demo/.wechat-inbox-local-asr/transcribe.sh', {
    existsSync: () => true,
    readFileSync: () => 'set -euo pipefail\nSIMPLIFIED_PROMPT="$(printf)"\nCHUNK_SECONDS=600\nRUN_LOG="$ROOT/transcribe-last.log"\n--prompt "$SIMPLIFIED_PROMPT"\nprogressPercent=100',
  }),
  {
    scriptVersion: 'chunked-bash-simplified-progress-run-log',
    scriptOutdated: false,
  },
);
assert.ok(helpers.buildLocalAsrInstallCommand('C:\\plugin\\local-asr\\install-local-asr.ps1').includes('-ExecutionPolicy Bypass'));
assert.ok(helpers.buildLocalAsrInstallCommand('C:\\plugin\\local-asr\\install-local-asr.ps1').includes('"C:\\plugin\\local-asr\\install-local-asr.ps1"'));
assert.strictEqual(
  helpers.buildLocalAsrInstallCommand('/Users/demo/plugin/local-asr/install-local-asr-macos.sh', 'darwin'),
  '/bin/bash "/Users/demo/plugin/local-asr/install-local-asr-macos.sh"',
);
assert.deepStrictEqual(
  helpers.parseLocalAsrProgressLog('progressStage=transcribing\nprogressCurrent=2\nprogressTotal=5\nprogressPercent=40\n'),
  {
    stage: 'transcribing',
    current: 2,
    total: 5,
    percent: 40,
  },
);
assert.deepStrictEqual(
  helpers.parseLocalAsrProgressLog('progressStage=transcribing\nprogressCurrent=3\nprogressTotal=4\n'),
  {
    stage: 'transcribing',
    current: 3,
    total: 4,
    percent: 75,
  },
);
assert.strictEqual(
  helpers.buildSyncProgressMessage({ stage: 'transcribing', title: 'demo.mp3', percent: 40 }).includes('40%'),
  true,
);
assert.strictEqual(
  helpers.buildSyncProgressMessage({ stage: 'downloading', title: 'podcast.mp3', percent: 25 }).includes('25%'),
  true,
);
assert.strictEqual(helpers.isAsciiPath('C:\\Users\\Public'), true);
assert.strictEqual(helpers.isAsciiPath('C:\\用户\\公用'), false);
assert.strictEqual(
  helpers.getSafeLocalAsrInstallRoot('win32', { PUBLIC: 'C:\\Users\\Public' }),
  'C:\\Users\\Public\\wechat-inbox-local-asr',
);
assert.strictEqual(
  helpers.getSafeLocalAsrInstallRoot('win32', {
    PUBLIC: 'C:\\用户\\公用',
    ProgramData: 'C:\\ProgramData',
  }),
  'C:\\ProgramData\\wechat-inbox-local-asr',
);
assert.strictEqual(
  helpers.getSafeLocalAsrInstallRoot('win32', {
    PUBLIC: 'C:\\用户\\公用',
    ProgramData: 'C:\\程序数据',
    SystemDrive: 'D:',
  }),
  'D:\\wechat-inbox-local-asr',
);
assert.strictEqual(
  helpers.getLocalAsrInstallRoot('C:\\Users\\demo', 'safe', 'win32', { PUBLIC: 'C:\\Users\\Public' }),
  'C:\\Users\\Public\\wechat-inbox-local-asr',
);
assert.strictEqual(
  helpers.getLocalAsrRepairAction({
    platform: 'win32',
    installRoot: 'C:\\Users\\ADMIN\\.wechat-inbox-local-asr',
    status: { ready: true, scriptOutdated: false },
    runLogText: '',
  }),
  'none',
);
assert.strictEqual(
  helpers.getLocalAsrRepairAction({
    platform: 'win32',
    installRoot: 'C:\\Users\\ADMIN\\.wechat-inbox-local-asr',
    status: { ready: true, scriptOutdated: true },
    runLogText: '',
  }),
  'default',
);
assert.strictEqual(
  helpers.getLocalAsrRepairAction({
    platform: 'win32',
    installRoot: 'C:\\Users\\徐zx\\.wechat-inbox-local-asr',
    status: { ready: true, scriptOutdated: false },
    runLogText: '',
  }),
  'safe',
);
assert.strictEqual(
  helpers.getLocalAsrRepairAction({
    platform: 'win32',
    installRoot: 'C:\\Users\\ADMIN\\.wechat-inbox-local-asr',
    status: { ready: true, scriptOutdated: false },
    runLogText: 'whisper failed with exit code -1073740791 / 0xC0000409',
  }),
  'safe',
);
assert.strictEqual(
  helpers.getDefaultLocalTranscriptionCommand('win32', 'C:\\Users\\Public\\wechat-inbox-local-asr'),
  'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\Public\\wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
);
assert.ok(
  helpers.buildLocalAsrInstallCommand(
    'C:\\plugin\\local-asr\\install-local-asr.ps1',
    'win32',
    'C:\\Users\\Public\\wechat-inbox-local-asr',
  ).includes('-InstallRoot "C:\\Users\\Public\\wechat-inbox-local-asr"'),
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
assert.ok(
  helpers.buildLocalAsrRunLogText({
    status: 'failed',
    error: 'whisper failed with exit code -1073740791',
  }).includes('whisper.cpp 原生程序崩溃'),
);
assert.strictEqual(typeof helpers.appendLocalAsrRunLog, 'function');
{
  const tempRunLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-run-log-'));
  const runLogPath = helpers.getLocalAsrRunLogPath(tempRunLogDir);
  fs.writeFileSync(runLogPath, 'script detailed log\nffmpegExit=1', 'utf8');
  helpers.appendLocalAsrRunLog({
    installRoot: tempRunLogDir,
    status: 'failed',
    command: 'powershell -File transcribe.ps1',
    error: 'wrapper command failed',
  });
  const mergedLog = fs.readFileSync(runLogPath, 'utf8');
  assert.ok(mergedLog.includes('script detailed log'));
  assert.ok(mergedLog.includes('ffmpegExit=1'));
  assert.ok(mergedLog.includes('plugin wrapper'));
  assert.ok(mergedLog.includes('wrapper command failed'));
  fs.rmSync(tempRunLogDir, { recursive: true, force: true });
}
assert.strictEqual(
  helpers.explainLocalAsrExitCode(-1073741515),
  '缺少 Windows VC++ 运行库或 whisper 依赖 DLL，请重新点击“安装/更新本地转写组件”修复。',
);
assert.ok(helpers.explainLocalAsrExitCode(-1073740791).includes('0xC0000409'));
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

const chineseBookPdfText = helpers.extractPdfMarkdown(createUtf16BePdfBuffer([
  '如果目标是实现10倍增长，那么这个过程通常并不会比10%的增长难上100倍，回报却可能是10%增长的100倍。',
  '这本书讨论破局者如何重新设计自己的目标、能力和协作方式，让复杂问题变得更清楚。',
  '当一个团队从追求线性改善转向重新定义问题，很多原本看起来必要的步骤都会被过滤掉。',
  '作者强调，真正重要的不是把所有事情都做得更多，而是找到那些能够放大结果的关键杠杆。',
  '在这种思路下，目标会变成一个筛选器，帮助我们区分什么值得继续投入，什么应该果断放弃。',
  '所以这类书籍里经常会引用英文标题、心理学术语和商业案例，但主体内容仍然是可读的中文正文。',
  'TheAgonyandtheEcstasy FiniteandInfiniteGames FriendsLoversandtheBigTerribleThing EdwardNortonLorenz CatchingtheBigFish SocialandPersonalityPsychologyCompass',
  'BreakthroughCompanyPlaybook StrategicCoachResources TransformationalGrowthMindset EntrepreneurialConfidence IncomprehensibleAmbiguity ExponentialCollaboration',
].join('\n')));
assert.ok(chineseBookPdfText.includes('如果目标是实现10倍增长'));
assert.ok(chineseBookPdfText.includes('TheAgonyandtheEcstasy'));

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
  '<div class="comment-item"><span class="user-name">用户甲</span><span class="comment-content">这个角度太有用了</span><span class="like-count">9</span></div>',
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
assert.ok(xiaohongshuNote.markdown.includes('## 评论区'));
assert.ok(xiaohongshuNote.markdown.includes('**用户甲**：这个角度太有用了'));
assert.strictEqual(xiaohongshuNote.comments.length, 1);

const xiaohongshuJsonCommentNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><body>',
  '<script>',
  'window.__INITIAL_STATE__={',
  '  note:{comments:{list:[',
  '    {contentText:"JSON里的评论正文",user_info:{nickname:"JSON用户"},likeCount:12,createTime:"2026-06-24"},',
  '    {commentText:{text:"第二条评论"},userInfo:{nickName:"嵌套用户"},liked_count:3}',
  '  ]}}',
  '};',
  '</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/json-comments');
assert.ok(xiaohongshuJsonCommentNote.markdown.includes('## 评论区'));
assert.ok(xiaohongshuJsonCommentNote.markdown.includes('**JSON用户**：JSON里的评论正文'));
assert.ok(xiaohongshuJsonCommentNote.markdown.includes('**嵌套用户**：第二条评论'));

const xiaohongshuNestedDomCommentNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Nested DOM Comments">',
  '<meta name="description" content="正文。 #评论区">',
  '</head><body>',
  '<div class="comment-item">',
  '  <div class="user-info"><span class="user-name">嵌套用户甲</span></div>',
  '  <div class="comment-main">',
  '    <div class="comment-content"><span>这是嵌套 DOM 里的评论正文</span></div>',
  '    <span class="like-count">17</span>',
  '  </div>',
  '</div>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/nested-dom-comments');
assert.ok(xiaohongshuNestedDomCommentNote.markdown.includes('## 评论区'));
assert.ok(xiaohongshuNestedDomCommentNote.markdown.includes('**嵌套用户甲**：这是嵌套 DOM 里的评论正文'));
assert.strictEqual(xiaohongshuNestedDomCommentNote.comments.length, 1);

const xiaohongshuLoginWallCommentNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Login Wall Comment">',
  '<meta name="description" content="正文已经提取出来，这里不应该混入登录墙评论。 #登录墙">',
  '</head><body>',
  '<div class="comment-container">',
  '<div class="comment-item">共 5 条评论 - 回复</div>',
  '<div class="comment-item">登录查看全部评论内容</div>',
  '</div>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/login-wall-comments');
assert.strictEqual(xiaohongshuLoginWallCommentNote.comments.length, 0);
assert.strictEqual(xiaohongshuLoginWallCommentNote.markdown.includes('## 评论区'), false);
assert.strictEqual(xiaohongshuLoginWallCommentNote.markdown.includes('登录查看全部评论内容'), false);
assert.strictEqual(xiaohongshuLoginWallCommentNote.markdown.includes('共 5 条评论'), false);

assert.strictEqual(typeof helpers.extractXiaohongshuNoteIdFromUrl, 'function');
assert.strictEqual(typeof helpers.extractXiaohongshuXsecTokenFromUrl, 'function');
assert.strictEqual(typeof helpers.extractXiaohongshuCommentsFromApiPayload, 'function');
assert.strictEqual(
  helpers.extractXiaohongshuNoteIdFromUrl('https://www.xiaohongshu.com/explore/66b123abc?xsec_token=token-a'),
  '66b123abc',
);
assert.strictEqual(
  helpers.extractXiaohongshuXsecTokenFromUrl('https://www.xiaohongshu.com/explore/66b123abc?xsec_token=token-a%3D'),
  'token-a=',
);
const xiaohongshuApiComments = helpers.extractXiaohongshuCommentsFromApiPayload({
  success: true,
  data: {
    comments: [
      {
        content: '接口里的一级评论',
        user_info: { nickname: '接口用户甲' },
        like_count: 8,
        create_time: '2026-06-25',
        sub_comments: [
          { content: '接口里的二级回复', user_info: { nickname: '回复用户' }, liked_count: 2 },
        ],
      },
      { content: '登录查看全部评论内容', user_info: { nickname: '噪声' } },
    ],
  },
});
assert.deepStrictEqual(xiaohongshuApiComments.map((item) => item.content), ['接口里的一级评论', '接口里的二级回复']);
assert.ok(helpers.buildSocialCommentsMarkdown(xiaohongshuApiComments).includes('**接口用户甲**：接口里的一级评论'));

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

const xiaohongshuNoisyImagesNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Noisy Images Title">',
  '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/spectrum/cover-noisy!nd_dft_wlteh_jpg_3">',
  '</head><body>',
  '<img src="https://sns-avatar-qc.xhscdn.com/avatar-user.jpg">',
  '<img src="https://ci.xiaohongshu.com/recommend-banner.jpg">',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"正文。 #干净图片","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/real-inner-a!nd_dft_wlteh_jpg_3"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/real-inner-b!nd_dft_wlteh_jpg_3"}]},"feed":{"items":[{"image":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/recommend-noise!nd_dft_wlteh_jpg_3"}]}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/noisy-images');
assert.ok(xiaohongshuNoisyImagesNote.markdown.includes('cover-noisy'));
assert.ok(xiaohongshuNoisyImagesNote.markdown.includes('real-inner-a'));
assert.ok(xiaohongshuNoisyImagesNote.markdown.includes('real-inner-b'));
assert.strictEqual(xiaohongshuNoisyImagesNote.markdown.includes('avatar-user'), false);
assert.strictEqual(xiaohongshuNoisyImagesNote.markdown.includes('recommend-banner'), false);
assert.strictEqual(xiaohongshuNoisyImagesNote.markdown.includes('recommend-noise'), false);
assert.strictEqual(xiaohongshuNoisyImagesNote.imageUrls.length, 3);

const xiaohongshuRealWorldNoisyImagesNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="Obsidian 录音插件更新，一大波功能。 - 小红书">',
  '<meta property="og:image" content="http://sns-webpic-qc.xhscdn.com/202606251730/cover/notes_pre_post/1040g3k83203evdfhl4905o2tvghgbjurjbrclmo!nd_dft_wlteh_webp_3">',
  '</head><body>',
  '<img src="https://fe-platform.xhscdn.com/platform/104101l0321829dg07k06jn2ge0jp60000000007dp7iga.png?imageView2/2/format/webp">',
  '<img src="https://picasso-static.xiaohongshu.com/fe-platform/09c136c01bac91a3eb7284b6e107e4714d7c06da.png">',
  '<img src="http://sns-webpic-qc.xhscdn.com/202606251730/48436f0cf18c194333586836cbb14a68/comment/1040g2u031ulate8m340040nace2uo6u5mbptf30!nc_n_webp_mw_1">',
  '<img src="https://sns-avatar-qc.xhscdn.com/avatar/5e4ce12000000000010005f8.jpg?imageView2/2/w/120/format/jpg|imageMogr2/strip">',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"Resojot 0.9.2 更新了转写后的整理功能。 #obsidian插件","imageList":[{"urlDefault":"http:\\/\\/sns-webpic-qc.xhscdn.com\\/202606251730\\/899a2c43a72a840bad71401011e29afc\\/notes_pre_post\\/1040g3k83203evdfhl4c05o2tvghgbjur5qaev50!nd_dft_wlteh_webp_3"},{"urlDefault":"http:\\/\\/sns-webpic-qc.xhscdn.com\\/202606251730\\/ffbefd942a6d62afc2aed247adb46a59\\/notes_pre_post\\/1040g3k83203evdfhl49g5o2tvghgbjurcmq1u8g!nd_dft_wlteh_webp_3"}]}}</script>',
  '</body></html>',
].join(''), 'http://xhslink.com/o/9uBQ3b4KWbw');
assert.ok(xiaohongshuRealWorldNoisyImagesNote.markdown.includes('notes_pre_post/1040g3k83203evdfhl4c05o2tvghgbjur5qaev50'));
assert.ok(xiaohongshuRealWorldNoisyImagesNote.markdown.includes('notes_pre_post/1040g3k83203evdfhl49g5o2tvghgbjurcmq1u8g'));
assert.strictEqual(xiaohongshuRealWorldNoisyImagesNote.markdown.includes('fe-platform.xhscdn.com/platform'), false);
assert.strictEqual(xiaohongshuRealWorldNoisyImagesNote.markdown.includes('picasso-static.xiaohongshu.com'), false);
assert.strictEqual(xiaohongshuRealWorldNoisyImagesNote.markdown.includes('/comment/1040g2u031ulate8m340040nace2uo6u5mbptf30'), false);
assert.strictEqual(xiaohongshuRealWorldNoisyImagesNote.markdown.includes('sns-avatar-qc.xhscdn.com'), false);
assert.strictEqual(xiaohongshuRealWorldNoisyImagesNote.imageUrls.length, 3);

const xiaohongshuInlinePageNoiseNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Inline Noise Title">',
  '</head><body>',
  '<main>',
  '<img src="https://sns-webpic-qc.xhscdn.com/spectrum/avatar-user-headshot!nd_dft_wlteh_jpg_3">',
  '<img src="https://sns-webpic-qc.xhscdn.com/spectrum/right-rail-recommend-card!nd_dft_wlteh_jpg_3">',
  '</main>',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"正文。 #正文图","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/only-real-note-a!nd_dft_wlteh_jpg_3"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/only-real-note-b!nd_dft_wlteh_jpg_3"}]},"recommend":{"imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/recommend-json-noise!nd_dft_wlteh_jpg_3"}]}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/inline-noise');
assert.ok(xiaohongshuInlinePageNoiseNote.markdown.includes('only-real-note-a'));
assert.ok(xiaohongshuInlinePageNoiseNote.markdown.includes('only-real-note-b'));
assert.strictEqual(xiaohongshuInlinePageNoiseNote.markdown.includes('avatar-user-headshot'), false);
assert.strictEqual(xiaohongshuInlinePageNoiseNote.markdown.includes('right-rail-recommend-card'), false);
assert.strictEqual(xiaohongshuInlinePageNoiseNote.markdown.includes('recommend-json-noise'), false);
assert.deepStrictEqual(xiaohongshuInlinePageNoiseNote.imageUrls, [
  'https://sns-webpic-qc.xhscdn.com/spectrum/only-real-note-a!nd_dft_wlteh_jpg_3',
  'https://sns-webpic-qc.xhscdn.com/spectrum/only-real-note-b!nd_dft_wlteh_jpg_3',
]);

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
assert.ok(Array.isArray(xiaohongshuNoisyPageNote.tags));
assert.ok(xiaohongshuNoisyPageNote.tags.includes('#恋爱笔记'));
assert.ok(xiaohongshuNoisyPageNote.description.includes('异国恋'));
assert.strictEqual(xiaohongshuNoisyPageNote.markdown.includes('原始链接：'), false);

const xiaohongshuFallbackNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="听播客3年，我感受到了信息茧房的恐怖 - 小红书">',
  '<meta name="description" content="3 亿人的生活经验，都在小红书">',
  '</head></html>',
].join(''), 'http://xhslink.com/o/5xRiTruK9EQ', '听播客3年，我感受到了信息茧房的恐怖 刚开始听播客的... http://xhslink.com/o/5xRiTruK9EQ  \n把文字复制好，然后去【小红书】查看详情。');
assert.ok(xiaohongshuFallbackNote.markdown.includes('刚开始听播客的'));
assert.strictEqual(xiaohongshuFallbackNote.markdown.includes('3 亿人的生活经验'), false);
assert.strictEqual(xiaohongshuFallbackNote.markdown.includes('把文字复制好'), false);

assert.strictEqual(typeof helpers.buildMarkdownForRecord, 'function');
const freeXiaohongshuMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'free-xhs-frontmatter',
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/free-frontmatter',
    source: 'wechat-miniprogram',
    createdAt: '2026-06-24T08:00:00.000Z',
    metadata: {
      title: '免费小红书图文',
      url: 'https://www.xiaohongshu.com/explore/free-frontmatter',
      platform: '小红书',
      contentCategory: '图文',
      description: '这是页面 meta 描述，不是 Pro AI 简介',
      keywords: ['页面标签', '非AI'],
      markdown: '## 正文\n\n正文内容\n\n## 评论区\n\n- **用户甲**：评论内容',
      conversionStatus: 'success',
      aiMetadataSource: '',
    },
  },
  title: '免费小红书图文',
  syncedAt: '2026-06-24T08:05:00.000Z',
});
assert.strictEqual(/^description:/m.test(freeXiaohongshuMarkdown), false);
assert.strictEqual(/^keywords:/m.test(freeXiaohongshuMarkdown), false);

const proAiXiaohongshuMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'pro-xhs-frontmatter',
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/pro-frontmatter',
    source: 'wechat-miniprogram',
    createdAt: '2026-06-24T08:00:00.000Z',
    metadata: {
      title: 'Pro 小红书图文',
      url: 'https://www.xiaohongshu.com/explore/pro-frontmatter',
      platform: '小红书',
      contentCategory: '图文',
      description: '这是 Pro AI 总结',
      keywords: ['AI关键词', '小红书评论'],
      markdown: '## 正文\n\n正文内容',
      conversionStatus: 'success',
      aiMetadataSource: 'cloud',
    },
  },
  title: 'Pro 小红书图文',
  syncedAt: '2026-06-24T08:05:00.000Z',
});
assert.match(proAiXiaohongshuMarkdown, /^description: 这是 Pro AI 总结/m);
assert.match(proAiXiaohongshuMarkdown, /^keywords: AI关键词, 小红书评论/m);

const frontmatterMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'record-frontmatter-1',
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/frontmatter',
    source: 'wechat-miniprogram',
    createdAt: '2026-06-14T08:00:00.000Z',
    metadata: {
      title: 'Frontmatter Test',
      url: 'https://www.xiaohongshu.com/explore/frontmatter',
      author: '小红书账号',
      platform: '小红书',
      contentCategory: '图文',
      description: '这是一段内容简介',
      keywords: ['Obsidian', '知识管理'],
      aiMetadataSource: 'cloud',
      conversionStatus: 'success',
      markdown: '正文内容',
    },
  },
  title: '小红书-Frontmatter Test',
  syncedAt: '2026-06-14T08:05:00.000Z',
});
assert.ok(frontmatterMarkdown.startsWith('---\n'));
assert.strictEqual(frontmatterMarkdown.includes('\nid: record-frontmatter-1\n'), false);
assert.strictEqual(frontmatterMarkdown.includes('\ntype: webpage\n'), false);
assert.ok(frontmatterMarkdown.includes('\ntitle: 小红书-Frontmatter Test\n'));
assert.ok(frontmatterMarkdown.includes('\nauthor: 小红书账号\n'));
assert.ok(frontmatterMarkdown.includes('\nurl: https://www.xiaohongshu.com/explore/frontmatter\n'));
assert.strictEqual(frontmatterMarkdown.includes('\ncreated_at: 2026-06-14T08:00:00.000Z\n'), false);
assert.ok(frontmatterMarkdown.includes('\nsynced_at: 2026-06-14T08:05:00.000Z\n'));
assert.ok(frontmatterMarkdown.includes('\nsource: 小红书图文\n'));
assert.ok(frontmatterMarkdown.includes('\ndescription: 这是一段内容简介\n'));
assert.ok(frontmatterMarkdown.includes('\nkeywords: Obsidian, 知识管理\n'));
assert.strictEqual(frontmatterMarkdown.includes('\nstatus: synced\n'), false);
assert.ok(frontmatterMarkdown.includes('<!-- wechat-inbox-record-id: record-frontmatter-1 -->'));
assert.strictEqual(helpers.hasRecordIdInFrontmatter(frontmatterMarkdown, 'record-frontmatter-1'), true);
assert.strictEqual(frontmatterMarkdown.includes('收集时间：2026-06-14 16:00:00'), false);
assert.strictEqual(frontmatterMarkdown.includes('原始链接：https://www.xiaohongshu.com/explore/frontmatter'), false);

const feishuFrontmatterMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'record-feishu-frontmatter-1',
    type: 'webpage',
    content: 'https://my.feishu.cn/docx/VpP7d1nwuomPF5xHSrIcxrtUn8f?from=from_copylink',
    source: 'wechat-miniprogram',
    createdAt: '2026-06-24T13:03:39.000Z',
    metadata: {
      title: '\u2063\u200b\u2063 踩中5次风口，赚',
      url: 'https://my.feishu.cn/docx/VpP7d1nwuomPF5xHSrIcxrtUn8f?from=from_copylink',
      platform: '飞书',
      contentCategory: '图文',
      description: '踩中5次风口，赚了100w+ 添加快捷方式最近修改: 昨天 16:14 分享 header-v2',
      keywords: ['风口', '小红书:AI', '知识库'],
      aiMetadataSource: 'cloud',
      conversionStatus: 'success',
      markdown: '正文内容',
    },
  },
  title: '飞书-\u2063\u200b\u2063 踩中5次风口，赚',
  syncedAt: '2026-06-24T13:04:00.000Z',
});
const feishuFrontmatterBlock = feishuFrontmatterMarkdown.match(/^---\n([\s\S]*?)\n---/)[1];
assert.strictEqual(feishuFrontmatterBlock.includes('\u2063'), false);
assert.strictEqual(feishuFrontmatterBlock.includes('\u200b'), false);
assert.strictEqual(feishuFrontmatterBlock.includes('添加快捷方式'), false);
assert.strictEqual(feishuFrontmatterBlock.includes('最近修改'), false);
assert.ok(feishuFrontmatterBlock.split('\n').includes('title: "飞书-踩中5次风口，赚"'));
assert.ok(feishuFrontmatterBlock.split('\n').some((line) => /^description: ".+"$/.test(line)));
assert.ok(feishuFrontmatterBlock.split('\n').some((line) => /^keywords: ".+"$/.test(line) && line.includes('小红书:AI')));
assert.ok(feishuFrontmatterBlock.split('\n').every((line) => !/title: .*url: /.test(line) && !/description: .*keywords: /.test(line)));

const customFrontmatterMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'record-frontmatter-custom-1',
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/custom-frontmatter',
    source: 'wechat-miniprogram',
    createdAt: '2026-06-14T08:00:00.000Z',
    metadata: {
      title: 'Custom Frontmatter Test',
      url: 'https://www.xiaohongshu.com/explore/custom-frontmatter',
      conversionStatus: 'success',
      markdown: '正文内容',
    },
  },
  title: '小红书-Custom Frontmatter Test',
  syncedAt: '2026-06-14T08:05:00.000Z',
  propertyFields: 'type,title,url',
});
assert.ok(customFrontmatterMarkdown.startsWith('---\n'));
assert.ok(customFrontmatterMarkdown.includes('\ntype: webpage\n'));
assert.ok(customFrontmatterMarkdown.includes('\ntitle: 小红书-Custom Frontmatter Test\n'));
assert.ok(customFrontmatterMarkdown.includes('\nurl: https://www.xiaohongshu.com/explore/custom-frontmatter\n'));
assert.strictEqual(customFrontmatterMarkdown.includes('\nid: record-frontmatter-custom-1\n'), false);
assert.strictEqual(customFrontmatterMarkdown.includes('\ncreated_at: 2026-06-14T08:00:00.000Z\n'), false);
assert.strictEqual(customFrontmatterMarkdown.includes('\nstatus: synced\n'), false);

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

assert.strictEqual(
  helpers.extractDouyinAwemeId('https://www.douyin.com/video/7644238277092174409'),
  '7644238277092174409',
);
assert.strictEqual(
  helpers.extractDouyinAwemeId('https://www.iesdouyin.com/share/video/7644238277092174409/?region=CN'),
  '7644238277092174409',
);
assert.deepStrictEqual(
  helpers.extractDouyinMediaUrlsFromDetailPayload({
    aweme_detail: {
      aweme_id: '7644238277092174409',
      video: {
        play_addr: {
          url_list: [
            'https://v11-weba.douyinvod.com/target-video/?mime_type=video_mp4',
          ],
        },
      },
    },
  }),
  ['https://v11-weba.douyinvod.com/target-video/?mime_type=video_mp4'],
);

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

const cloudPendingTranscriptMarkdown = helpers.buildAudioTranscriptMarkdown({
  url: 'cloud://voice/interview.mp3',
  transcriptionStatus: 'processing',
  transcriptionSource: 'cloud-pretranscription',
});
assert.ok(cloudPendingTranscriptMarkdown.includes('云端转写中，下次同步会自动更新。'));

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
assert.strictEqual(doubaoRequest.body.request.enable_speaker_info, true);
assert.strictEqual(doubaoRequest.body.request.show_utterances, true);
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

assert.strictEqual(helpers.parseDoubaoAsrResult({
  result: {
    text: '完整文本',
    utterances: [
      { speaker: 1, text: '第一位说话。' },
      { speaker_id: 2, utterance_text: '第二位回应。' },
    ],
  },
}), '说话人1：第一位说话。\n说话人2：第二位回应。');

assert.strictEqual(helpers.parseDoubaoAsrResult({
  result: {
    text: '完整文本',
    utterances: [
      { additions: { speaker: '1' }, text: '官方结构第一句。' },
      { additions: { speaker: '2' }, text: '官方结构第二句。' },
    ],
  },
}), '说话人1：官方结构第一句。\n说话人2：官方结构第二句。');

assert.strictEqual(helpers.parseDoubaoAsrResult({
  result: [
    {
      text: '完整文本',
      utterances: [
        { speaker: 1, text: '第一段' },
        { speaker: 1, text: '继续第一段' },
        { speaker: 2, result_text: '第二段' },
      ],
    },
  ],
}), '说话人1：第一段\n说话人1：继续第一段\n说话人2：第二段');

assert.strictEqual(helpers.parseDoubaoAsrResult({
  result: {
    text: [
      '但是这个可能会再打开微信',
      '但是这个可能会再打开微信',
      '但是这个可能会再打开微信',
      '但是这个可能会再打开微信',
      '我们继续往下讲',
    ].join('\n'),
  },
}), '但是这个可能会再打开微信\n我们继续往下讲');

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

  const preciseDouyinPlugin = new PluginClass();
  preciseDouyinPlugin.settings = { aiProvider: 'off' };
  let preciseDouyinRenderCalled = false;
  preciseDouyinPlugin.renderSocialMediaUrls = async () => {
    preciseDouyinRenderCalled = true;
    throw new Error('precise douyin detail should avoid rendered recommendation resources');
  };
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.douyin.com/video/7644238277092174409') {
      return {
        text: '<html><head><meta charset="UTF-8"></head><body><script>var glb;</script></body></html>',
      };
    }
    if (url.includes('/aweme/v1/web/aweme/detail/') && url.includes('aweme_id=7644238277092174409')) {
      return {
        json: {
          aweme_detail: {
            aweme_id: '7644238277092174409',
            desc: '先生 我出不了神山 你带一支格桑花走吧 #萨普神山 #西藏',
            video: {
              play_addr: {
                url_list: [
                  'https://v11-weba.douyinvod.com/target-video/?mime_type=video_mp4',
                ],
              },
            },
          },
        },
      };
    }
    throw new Error(`unexpected precise douyin request ${url}`);
  };
  const preciseDouyinRecord = await preciseDouyinPlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.douyin.com/video/7644238277092174409',
    metadata: { url: 'https://www.douyin.com/video/7644238277092174409' },
  }, '', '', '抖音精确作品');
  assert.strictEqual(preciseDouyinRecord.metadata.transcriptOnly, true);
  assert.strictEqual(preciseDouyinRecord.metadata.mediaUrl, 'https://v11-weba.douyinvod.com/target-video/?mime_type=video_mp4');
  assert.strictEqual(preciseDouyinRecord.metadata.title, '抖音口播文案');
  assert.strictEqual(preciseDouyinRenderCalled, false);

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
    if (url === 'https://www.xiaohongshu.com/explore/short-link-note') {
      return {
        text: '<html><head><title>XHS Short Link</title></head><body>短链落地页没有直接暴露视频</body></html>',
      };
    }
    if (url === 'https://www.xiaohongshu.com/404?source=note&type=video') {
      return {
        text: '<html><head><title>小红书 - 你访问的页面不见了</title></head><body>你访问的页面不见了</body></html>',
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

  const forcedXhsVideoPlugin = new PluginClass();
  forcedXhsVideoPlugin.settings = { aiProvider: 'off' };
  forcedXhsVideoPlugin.renderSocialMediaUrls = async (url) => {
    assert.strictEqual(url, 'https://www.xiaohongshu.com/explore/short-link-note');
    return ['https://video.example.com/xhs-short-link.mp4'];
  };
  const forcedXhsVideoRecord = await forcedXhsVideoPlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/short-link-note',
    metadata: {
      url: 'https://www.xiaohongshu.com/explore/short-link-note',
      webpageMediaType: 'audio_video',
      transcriptionMode: 'local',
    },
  }, '', '', '小红书短链视频');
  assert.strictEqual(forcedXhsVideoRecord.metadata.transcriptOnly, true);
  assert.strictEqual(forcedXhsVideoRecord.metadata.mediaUrl, 'https://video.example.com/xhs-short-link.mp4');

  const mislabeledXhsImageRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/image',
    metadata: {
      url: 'https://www.xiaohongshu.com/explore/image',
      webpageMediaType: 'audio_video',
    },
  }, '', '', '误标小红书图文');
  assert.strictEqual(mislabeledXhsImageRecord.metadata.transcriptOnly, undefined);
  assert.strictEqual(mislabeledXhsImageRecord.metadata.contentCategory, '图文');
  assert.ok(mislabeledXhsImageRecord.metadata.markdown.includes('真正图文正文'));
  assert.ok(mislabeledXhsImageRecord.metadata.markdown.includes('![封面](https://img.example.com/cover.jpg)'));

  const xhsUnavailableVideoRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/404?source=note&type=video',
    metadata: { url: 'https://www.xiaohongshu.com/404?source=note&type=video' },
  }, '', '', '小红书失效视频');
  assert.strictEqual(xhsUnavailableVideoRecord.metadata.transcriptOnly, undefined);
  assert.ok(xhsUnavailableVideoRecord.metadata.markdown.includes('小红书链接已保存'));
  assert.strictEqual(xhsUnavailableVideoRecord.metadata.transcriptionStatus, 'failed');
  assert.ok(xhsUnavailableVideoRecord.metadata.transcriptionError.includes('小红书网页端未返回可转写的视频资源'));
  assert.ok(xhsUnavailableVideoRecord.metadata.transcriptionError.includes('从手机相册或文件导入视频'));

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

  const forcedLocalPlugin = new PluginClass();
  forcedLocalPlugin.settings = { aiProvider: 'off' };
  forcedLocalPlugin.runLocalTranscription = async (audioUrl) => {
    assert.strictEqual(audioUrl, 'https://media.example.com/local.m4a');
    return '小程序选择本地后的转写结果';
  };
  const forcedLocalResult = await forcedLocalPlugin.runConfiguredTranscription('https://media.example.com/local.m4a', {
    forceLocal: true,
  });
  assert.deepStrictEqual(forcedLocalResult, {
    transcription: '小程序选择本地后的转写结果',
    source: 'local',
  });

  const webMediaFallbackPlugin = new PluginClass();
  webMediaFallbackPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'PRO-123',
    clientId: 'test-client',
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    bindings: [{
      token: 'PRO-123',
      label: 'Pro 微信',
      enabled: true,
      status: 'bound',
    }],
  });
  webMediaFallbackPlugin.runLocalTranscription = async () => {
    throw new Error('whisper failed with exit code -1073740791');
  };
  webMediaFallbackPlugin.showSyncProgress = () => {};
  const previousRequestUrlForWebMediaFallback = requestUrlMock;
  const cloudFallbackRequests = [];
  requestUrlMock = async ({ url, method, body, headers }) => {
    cloudFallbackRequests.push({ url, method, body: JSON.parse(body), auth: headers.Authorization });
    return {
      status: 200,
      text: JSON.stringify({
        success: true,
        data: {
          transcription: '小红书云端兜底文案',
          provider: 'doubao',
          requestId: 'cloud-url-1',
          usedSeconds: 60,
          remainingSeconds: 3540,
        },
      }),
    };
  };
  try {
    const webMediaFallbackResult = await webMediaFallbackPlugin.runConfiguredTranscription('https://video.example.com/xhs.mp4', {
      allowCloudUrlFallback: true,
      title: '小红书口播',
      source: 'video',
    });
    assert.deepStrictEqual(webMediaFallbackResult, {
      transcription: '小红书云端兜底文案',
      source: 'local-cloud-fallback',
      cloudProvider: 'doubao',
      cloudRequestId: 'cloud-url-1',
      cloudUsedSeconds: 60,
      cloudRemainingSeconds: 3540,
    });
    assert.deepStrictEqual(cloudFallbackRequests, [{
      url: 'https://example.com/sync/transcriptions/cloud',
      method: 'POST',
      body: {
        audioUrl: 'https://video.example.com/xhs.mp4',
        durationSeconds: 60,
        localError: 'whisper failed with exit code -1073740791',
        source: 'video',
        title: '小红书口播',
      },
      auth: 'Bearer PRO-123',
    }]);
  } finally {
    requestUrlMock = previousRequestUrlForWebMediaFallback;
  }

  const cloudWebpagePlugin = new PluginClass();
  cloudWebpagePlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'PRO-123',
    clientId: 'test-client',
    aiProvider: 'off',
    bindings: [{
      token: 'PRO-123',
      label: 'Pro 微信',
      enabled: true,
      status: 'bound',
    }],
  });
  cloudWebpagePlugin.runConfiguredTranscription = async () => {
    throw new Error('云端网页链接不应调用本地/插件转写');
  };
  const cloudWebpageCalls = [];
  cloudWebpagePlugin.runCloudFallbackTranscription = async (audioUrl, options) => {
    cloudWebpageCalls.push([audioUrl, options.source, options.title, options.binding && options.binding.token]);
    return {
      transcription: '云端网页音视频转写结果',
      source: 'cloud-webpage',
      cloudProvider: 'doubao',
      cloudRequestId: 'cloud-web-1',
      cloudUsedSeconds: 60,
      cloudRemainingSeconds: 540,
    };
  };
  const cloudWebpageResult = await cloudWebpagePlugin.buildTranscriptRecordFromMedia({
    type: 'webpage',
    content: 'https://www.douyin.com/video/123',
    metadata: {
      url: 'https://www.douyin.com/video/123',
      webpageMediaType: 'audio_video',
      transcriptionMode: 'cloud',
      cloudTranscriptionRequested: true,
    },
  }, {
    url: 'https://www.douyin.com/video/123',
    platform: '抖音',
    mediaUrl: 'https://video.example.com/douyin.mp4',
    source: 'video',
    binding: cloudWebpagePlugin.settings.bindings[0],
    title: '抖音视频',
  });
  assert.strictEqual(cloudWebpageResult.metadata.transcription, '云端网页音视频转写结果');
  assert.strictEqual(cloudWebpageResult.metadata.transcriptionSource, 'cloud-webpage');
  assert.strictEqual(cloudWebpageResult.metadata.cloudTranscriptionProvider, 'doubao');
  assert.deepStrictEqual(cloudWebpageCalls, [[
    'https://video.example.com/douyin.mp4',
    'video',
    '抖音视频',
    'PRO-123',
  ]]);

  const localPlatformParsePlugin = new PluginClass();
  localPlatformParsePlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'PRO-123',
    clientId: 'test-client',
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    bindings: [{
      token: 'PRO-123',
      label: 'Pro 微信',
      enabled: true,
      status: 'bound',
    }],
  });
  let localPrepareCalled = false;
  localPlatformParsePlugin.prepareWebpageMedia = async () => {
    localPrepareCalled = true;
    throw new Error('local software mode should not call cloud media prepare');
  };
  localPlatformParsePlugin.runLocalTranscription = async (audioUrl) => {
    assert.strictEqual(audioUrl, 'https://media.example.com/local-xhs.mp4');
    return '本地解析音频后本地转写结果';
  };
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/explore/local-parse') {
      return {
        text: '<html><script>{"video":{"url":"https:\\/\\/media.example.com\\/local-xhs.mp4"}}</script></html>',
      };
    }
    throw new Error(`unexpected local platform parse request ${url}`);
  };
  const localPlatformParseRecord = await localPlatformParsePlugin.hydrateWebpageMarkdown({
    _id: 'record-local-parse-1',
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/local-parse',
    metadata: {
      url: 'https://www.xiaohongshu.com/explore/local-parse',
      webpageMediaType: 'audio_video',
      transcriptionMode: 'local',
    },
  }, '', '', '小红书本地解析');
  assert.strictEqual(localPrepareCalled, false);
  assert.strictEqual(localPlatformParseRecord.metadata.transcriptionStatus, 'success');
  assert.strictEqual(localPlatformParseRecord.metadata.mediaUrl, 'https://media.example.com/local-xhs.mp4');
  assert.strictEqual(localPlatformParseRecord.metadata.transcription, '本地解析音频后本地转写结果');
  assert.strictEqual(localPlatformParseRecord.metadata.mediaPreparedByCloud, undefined);

  const inferredLocalPlatformPlugin = new PluginClass();
  inferredLocalPlatformPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'PRO-123',
    clientId: 'test-client',
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    bindings: [{
      token: 'PRO-123',
      label: 'Pro 微信',
      enabled: true,
      status: 'bound',
    }],
  });
  let inferredPrepareCalled = false;
  inferredLocalPlatformPlugin.prepareWebpageMedia = async () => {
    inferredPrepareCalled = true;
    throw new Error('unmarked platform links should stay on local platform parsing');
  };
  inferredLocalPlatformPlugin.runLocalTranscription = async (audioUrl) => {
    assert.strictEqual(audioUrl, 'https://v3-dy-o.zjcdn.com/tos-cn-ve/local-douyin.mp4');
    return '未标记平台链接走本地解析';
  };
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.douyin.com/video/local-parse-unmarked') {
      return {
        text: '<html><script>{"videoUrl":"https:\\/\\/v3-dy-o.zjcdn.com\\/tos-cn-ve\\/local-douyin.mp4"}</script></html>',
      };
    }
    throw new Error(`unexpected inferred local parse request ${url}`);
  };
  const inferredLocalPlatformRecord = await inferredLocalPlatformPlugin.hydrateWebpageMarkdown({
    _id: 'record-local-parse-inferred-1',
    type: 'webpage',
    content: 'https://www.douyin.com/video/local-parse-unmarked',
    metadata: {
      url: 'https://www.douyin.com/video/local-parse-unmarked',
      conversionStatus: 'pending',
    },
  }, '', '', '抖音未标记本地解析');
  assert.strictEqual(inferredPrepareCalled, false);
  assert.strictEqual(inferredLocalPlatformRecord.metadata.transcriptionStatus, 'success');
  assert.strictEqual(inferredLocalPlatformRecord.metadata.transcription, '未标记平台链接走本地解析');
  assert.strictEqual(inferredLocalPlatformRecord.metadata.mediaPreparedByCloud, undefined);

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

async function runTranscriptionPreferenceSyncTest() {
  const calls = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    cloudPreTranscriptionEnabled: true,
    cloudPreTranscriptionThresholdMinutes: 30,
  });
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push([path, method, body, binding && binding.token]);
    return {
      success: true,
      data: body,
    };
  };

  await plugin.syncTranscriptionPreferences();

  assert.deepStrictEqual(calls, [[
    '/transcription-preferences',
    'POST',
    {
      cloudPreTranscriptionEnabled: true,
      cloudPreTranscriptionThresholdMinutes: 30,
    },
    'ABC-123',
  ]]);
}

async function runCloudProcessingRecordSkipSyncTest() {
  const calls = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
  });
  plugin.showSyncProgress = () => {};
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push([path, method, body, binding && binding.token]);
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'cloud-processing-1',
          type: 'voice',
          content: '云端录音',
          createdAt: '2026-06-13T08:38:46.735Z',
          metadata: {
            audioFileID: 'cloud://voices/cloud-processing.mp3',
            transcriptionMode: 'cloud',
            transcriptionStatus: 'processing',
            transcriptionSource: 'cloud-pretranscription',
          },
        }, {
          _id: 'cloud-pending-1',
          type: 'webpage',
          content: 'https://v.douyin.com/example/',
          createdAt: '2026-06-13T08:39:46.735Z',
          metadata: {
            url: 'https://v.douyin.com/example/',
            webpageMediaType: 'audio_video',
            transcriptionMode: 'cloud',
            transcriptionStatus: 'pending',
            cloudTranscriptionRequested: true,
          },
        }],
      };
    }
    return {
      success: true,
      data: {},
    };
  };
  const writeCalls = [];
  plugin.writeRecord = async (record) => {
    writeCalls.push(record._id);
    return {
      recordId: record._id,
      title: '云端录音',
      filePath: '临时收集/云端录音.md',
    };
  };

  const result = await plugin.syncBinding({
    token: 'ABC-123',
    label: '测试微信',
  }, false);

  assert.deepStrictEqual(result.written, []);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(writeCalls, []);
  assert.deepStrictEqual(calls, [[
    '/records?status=pending',
    'GET',
    {},
    'ABC-123',
  ]]);
}

async function runExistingLocalRecordDedupSyncTest() {
  assert.strictEqual(helpers.hasRecordIdInFrontmatter([
    '---',
    'id: existing-record-1',
    'type: text',
    '---',
    '',
    '正文内容',
  ].join('\n'), 'existing-record-1'), true);
  assert.strictEqual(helpers.hasRecordIdInFrontmatter([
    '正文里出现 id: existing-record-1 不算已经同步',
  ].join('\n'), 'existing-record-1'), false);
  assert.strictEqual(helpers.hasRecordIdInFrontmatter([
    '---',
    'title: 旧版默认属性笔记',
    '---',
    '',
    '<!-- wechat-inbox-record-id: existing-record-1 -->',
    '',
    '之前已经同步过的内容',
  ].join('\n'), 'existing-record-1'), true);

  const calls = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    inboxDir: '临时收集',
  });
  plugin.showSyncProgress = () => {};
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [
        { path: '临时收集/2026-06-17/旧内容.md', extension: 'md' },
        { path: '其他目录/旧内容.md', extension: 'md' },
      ],
      cachedRead: async (file) => {
        if (file.path === '临时收集/2026-06-17/旧内容.md') {
          return [
            '---',
            'id: existing-record-1',
            'type: text',
            '---',
            '',
            '之前已经同步过的内容',
          ].join('\n');
        }
        return [
          '---',
          'id: existing-record-1',
          '---',
        ].join('\n');
      },
    },
  };
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push([path, method, body, binding && binding.token]);
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'existing-record-1',
          type: 'text',
          content: '云端误标成 pending 的旧内容',
          createdAt: '2026-06-17T08:00:00.000Z',
          metadata: {},
        }],
      };
    }
    return {
      success: true,
      data: {},
    };
  };
  plugin.writeRecord = async () => {
    throw new Error('本地已有同 id 笔记时不应重复写入');
  };

  const result = await plugin.syncBinding({
    token: 'ABC-123',
    label: '测试微信',
  }, false);

  assert.deepStrictEqual(result.written, []);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(result.skipped, [{
    recordId: 'existing-record-1',
    reason: 'already-synced-local',
    filePath: '临时收集/2026-06-17/旧内容.md',
  }]);
  assert.deepStrictEqual(calls, [[
    '/records?status=pending',
    'GET',
    {},
    'ABC-123',
  ], [
    '/records/existing-record-1/synced',
    'POST',
    {},
    'ABC-123',
  ]]);
}

async function runExistingLocalRecordUrlDedupSyncTest() {
  const calls = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    inboxDir: '临时收集',
  });
  plugin.showSyncProgress = () => {};
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [
        { path: '临时收集/2026-06-24/小红书-旧图文.md', extension: 'md' },
      ],
      cachedRead: async () => [
        '---',
        'title: 小红书-旧图文',
        'url: https://www.xiaohongshu.com/explore/url-dedup',
        'synced_at: 2026-06-24T08:00:00.000Z',
        'source: 小红书图文',
        '---',
        '',
        '旧版默认属性没有 id，但同一个链接已经同步过。',
      ].join('\n'),
    },
  };
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push([path, method, body, binding && binding.token]);
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'new-cloud-id-for-same-url',
          type: 'webpage',
          content: 'https://www.xiaohongshu.com/explore/url-dedup',
          createdAt: '2026-06-24T08:05:00.000Z',
          metadata: {
            url: 'https://www.xiaohongshu.com/explore/url-dedup',
          },
        }],
      };
    }
    return {
      success: true,
      data: {},
    };
  };
  plugin.writeRecord = async () => {
    throw new Error('本地已有同 url 笔记时不应重复写入');
  };

  const result = await plugin.syncBinding({
    token: 'ABC-123',
    label: '测试微信',
  }, false);

  assert.deepStrictEqual(result.written, []);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(result.skipped, [{
    recordId: 'new-cloud-id-for-same-url',
    reason: 'already-synced-local',
    filePath: '临时收集/2026-06-24/小红书-旧图文.md',
  }]);
  assert.deepStrictEqual(calls, [[
    '/records?status=pending',
    'GET',
    {},
    'ABC-123',
  ], [
    '/records/new-cloud-id-for-same-url/synced',
    'POST',
    {},
    'ABC-123',
  ]]);
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

async function runSyncInvalidCodePreservesLocalBindingTest() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'OLD-123',
    clientId: 'stale-client',
    bindings: [{
      token: 'OLD-123',
      label: '旧微信',
      enabled: true,
      status: 'bound',
    }],
  });
  plugin.showSyncProgress = () => {};
  let savedSettings = null;
  plugin.saveData = async (settings) => {
    savedSettings = settings;
  };
  plugin.requestJson = async () => {
    throw new Error('绑定码未绑定或已失效，请在插件设置里粘贴小程序绑定码后点击“立即绑定”。');
  };

  await plugin.syncInbox(false);

  assert.strictEqual(plugin.settings.token, 'OLD-123');
  assert.deepStrictEqual(plugin.settings.bindings.map((item) => item.token), ['OLD-123']);
  assert.strictEqual(savedSettings, null);
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

  const trialFallbackPlugin = new PluginClass();
  trialFallbackPlugin.saveData = async () => {};
  trialFallbackPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'TRIAL-123',
    clientId: 'trial-client',
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    bindings: [{
      token: 'TRIAL-123',
      label: '体验微信',
      enabled: true,
      status: 'bound',
    }],
  });
  const trialFallbackUrls = [];
  requestUrlMock = async ({ url, method, headers }) => {
    assert.strictEqual(method, 'GET');
    assert.strictEqual(headers.Authorization, 'Bearer TRIAL-123');
    trialFallbackUrls.push(url);
    if (url.endsWith('plan=local_transcription_beta')) {
      return {
        status: 200,
        text: JSON.stringify({
          success: true,
          data: {
            hasAccess: false,
            plan: '',
            status: 'inactive',
            expiresAt: '',
          },
        }),
      };
    }
    assert.strictEqual(url, 'https://example.com/sync/entitlements/status?plan=local_transcription_trial');
    return {
      status: 200,
      text: JSON.stringify({
        success: true,
        data: {
          hasAccess: true,
          plan: 'local_transcription_trial',
          status: 'active',
          expiresAt: '2026-06-23T02:10:14.993Z',
        },
      }),
    };
  };

  try {
    const status = await trialFallbackPlugin.getLocalTranscriptionEntitlementStatus();
    assert.deepStrictEqual(trialFallbackUrls, [
      'https://example.com/sync/entitlements/status?plan=local_transcription_beta',
      'https://example.com/sync/entitlements/status?plan=local_transcription_trial',
    ]);
    assert.strictEqual(status.hasAccess, true);
    assert.strictEqual(status.plan, 'local_transcription_trial');
    assert.strictEqual(status.expiresAt, '2026-06-23T02:10:14.993Z');
    assert.strictEqual(trialFallbackPlugin.settings.localTranscriptionEntitlementStatus.hasAccess, true);
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

async function runCloudFailedVoiceLocalFallbackTests() {
  const plugin = new PluginClass();
  const writtenBinaries = [];
  plugin.settings = helpers.mergeSettings({
    aiProvider: 'off',
    localTranscriptionCommand: 'echo local',
  });
  plugin.app = {
    vault: {
      adapter: {
        exists: async () => true,
        writeBinary: async (filePath, buffer) => {
          writtenBinaries.push([filePath, Buffer.from(buffer).toString('utf8')]);
        },
      },
      createFolder: async () => {},
    },
  };
  plugin.requestFileDownloadUrl = async (fileID) => {
    assert.strictEqual(fileID, 'cloud://voices/cloud-failed.mp3');
    return 'https://temp.example.com/cloud-failed.mp3';
  };
  plugin.downloadArrayBuffer = async (url) => {
    assert.strictEqual(url, 'https://temp.example.com/cloud-failed.mp3');
    return Buffer.from('audio-bytes');
  };
  const transcriptionCalls = [];
  plugin.runConfiguredTranscription = async (audioUrl, options) => {
    transcriptionCalls.push([audioUrl, options.fileID, options.forceLocal, options.cloudFallbackReason]);
    return {
      transcription: '本地兜底转写成功',
      source: 'local',
    };
  };
  plugin.showSyncProgress = () => {};

  const result = await plugin.writeVoiceAttachment({
    _id: 'record-cloud-failed',
    type: 'voice',
    content: '会议录音',
    metadata: {
      audioFileID: 'cloud://voices/cloud-failed.mp3',
      audioFileName: 'meeting.mp3',
      transcriptionMode: 'cloud',
      transcriptionStatus: 'failed',
      transcriptionSource: 'cloud-pretranscription',
      transcriptionError: '云端转写额度不足',
    },
  }, '临时收集', '2026-06-13', '录音-001', {
    token: 'ABC-123',
  });

  assert.deepStrictEqual(transcriptionCalls, [[
    'https://temp.example.com/cloud-failed.mp3',
    'cloud://voices/cloud-failed.mp3',
    true,
    'cloud-pretranscription-failed',
  ]]);
  assert.deepStrictEqual(writtenBinaries, [[
    '临时收集/语音附件/2026-06-13/录音-001.mp3',
    'audio-bytes',
  ]]);
  assert.strictEqual(result.metadata.transcription, '本地兜底转写成功');
  assert.strictEqual(result.metadata.transcriptionStatus, 'success');
  assert.strictEqual(result.metadata.transcriptionProvider, 'local');
  assert.strictEqual(result.metadata.cloudTranscriptionError, '云端转写额度不足');
}

async function runPodcastDownloadHeaderTests() {
  const plugin = new PluginClass();
  let capturedHeaders = null;
  plugin.downloadArrayBuffer = async (url, headers) => {
    assert.strictEqual(url, 'https://cdn.example.com/podcast.mp3');
    capturedHeaders = headers;
    return Buffer.concat([
      Buffer.from('ID3'),
      Buffer.alloc(1024, 1),
    ]);
  };

  const tempPath = await plugin.downloadMediaToTempFile('https://cdn.example.com/podcast.mp3', {
    sourceUrl: 'https://www.xiaoyuzhoufm.com/episode/abc123',
  });
  try {
    assert.strictEqual(capturedHeaders.Referer, 'https://www.xiaoyuzhoufm.com/');
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

async function runXiaohongshuCommentApiFallbackTests() {
  const originalRequestUrlMock = requestUrlMock;
  const originalModuleLoad = Module._load;
  const sessionFetchCalls = [];

  requestUrlMock = async () => {
    throw new Error('net::ERR_BLOCKED_BY_CLIENT');
  };

  Module._load = function mockElectron(request, parent, isMain) {
    if (request === 'electron') {
      return {
        remote: {
          session: {
            fromPartition: () => ({
              cookies: {
                get: async () => [{ name: 'web_session', value: 'saved-login' }],
              },
              fetch: async (url, options) => {
                sessionFetchCalls.push({ url, options });
                return {
                  ok: true,
                  status: 200,
                  text: async () => JSON.stringify({
                    data: {
                      comments: [
                        { content: '登录会话里的评论', user: { nickName: '用户乙' }, like_count: 8 },
                      ],
                      cursor: '',
                      has_more: false,
                    },
                  }),
                };
              },
            }),
          },
        },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };

  try {
    const result = await helpers.fetchXiaohongshuCommentsFromApi(
      'https://www.xiaohongshu.com/explore/abc123?xsec_token=token-demo',
      5,
    );
    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.error, '');
    assert.strictEqual(result.comments.length, 1);
    assert.strictEqual(result.comments[0].author, '用户乙');
    assert.strictEqual(result.comments[0].content, '登录会话里的评论');
    assert.strictEqual(sessionFetchCalls.length, 1);
    assert.ok(String(sessionFetchCalls[0].url).includes('/api/sns/web/v2/comment/page'));
    assert.strictEqual(sessionFetchCalls[0].options.credentials, 'include');
  } finally {
    requestUrlMock = originalRequestUrlMock;
    Module._load = originalModuleLoad;
  }
}

async function runLocalAsrRepairDecisionTests() {
  const healthyPlugin = new PluginClass();
  healthyPlugin.settings = helpers.mergeSettings({
    localAsrPlatform: 'win32',
    localAsrInstallMode: 'default',
  });
  healthyPlugin.getConfiguredLocalAsrPlatform = () => 'win32';
  healthyPlugin.getConfiguredLocalAsrInstallRoot = () => 'C:\\Users\\ADMIN\\.wechat-inbox-local-asr';
  healthyPlugin.getLocalAsrInstallStatus = () => ({ ready: true, scriptOutdated: false });
  const healthyCalls = [];
  healthyPlugin.installLocalAsr = async (options) => healthyCalls.push(options);
  const healthyResult = await healthyPlugin.checkAndRepairLocalAsr();
  assert.strictEqual(healthyResult.action, 'none');
  assert.deepStrictEqual(healthyCalls, []);

  const stalePlugin = new PluginClass();
  stalePlugin.settings = helpers.mergeSettings({
    localAsrPlatform: 'win32',
    localAsrInstallMode: 'default',
  });
  stalePlugin.getConfiguredLocalAsrPlatform = () => 'win32';
  stalePlugin.getConfiguredLocalAsrInstallRoot = () => 'C:\\Users\\ADMIN\\.wechat-inbox-local-asr';
  stalePlugin.getLocalAsrInstallStatus = () => ({ ready: true, scriptOutdated: true });
  const staleCalls = [];
  stalePlugin.installLocalAsr = async (options) => staleCalls.push(options);
  const staleResult = await stalePlugin.checkAndRepairLocalAsr();
  assert.strictEqual(staleResult.action, 'default');
  assert.deepStrictEqual(staleCalls, [{ installMode: 'default' }]);

  const crashRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-crash-log-'));
  try {
    fs.writeFileSync(path.join(crashRoot, 'transcribe-last.log'), 'whisper failed with exit code -1073740791 / 0xC0000409', 'utf8');
    const crashPlugin = new PluginClass();
    crashPlugin.settings = helpers.mergeSettings({
      localAsrPlatform: 'win32',
      localAsrInstallMode: 'default',
    });
    crashPlugin.getConfiguredLocalAsrPlatform = () => 'win32';
    crashPlugin.getConfiguredLocalAsrInstallRoot = () => crashRoot;
    crashPlugin.getLocalAsrInstallStatus = () => ({ ready: true, scriptOutdated: false });
    const crashCalls = [];
    crashPlugin.installLocalAsr = async (options) => crashCalls.push(options);
    const crashResult = await crashPlugin.checkAndRepairLocalAsr();
    assert.strictEqual(crashResult.action, 'safe');
    assert.deepStrictEqual(crashCalls, [{ installMode: 'safe' }]);
  } finally {
    fs.rmSync(crashRoot, { recursive: true, force: true });
  }
}

async function main() {
  await runAsyncHydrationTests();
  await runOpenExternalUrlTests();
  await runCloudRequestFallbackTests();
  await runMissingClientIdRequestTest();
  await runTranscriptionPreferenceSyncTest();
  await runCloudProcessingRecordSkipSyncTest();
  await runExistingLocalRecordDedupSyncTest();
  await runExistingLocalRecordUrlDedupSyncTest();
  await runUnbindInvalidCodeMarksLocalUnboundTest();
  await runSyncInvalidCodePreservesLocalBindingTest();
  await runLocalTranscriptionEntitlementTests();
  await runCloudFailedVoiceLocalFallbackTests();
  await runPodcastDownloadHeaderTests();
  await runXiaohongshuCommentApiFallbackTests();
  await runLocalAsrRepairDecisionTests();
}

main().catch((error) => {
  if (process.env.GITHUB_ACTIONS) {
    const message = String(error && (error.stack || error.message) || error)
      .replace(/\r?\n/g, '%0A');
    console.error(`::error file=tests/plugin-main-ai.test.js::${message}`);
  }
  console.error(error);
  process.exit(1);
});
