const assert = require('assert');
const http = require('http');
const https = require('https');
const childProcess = require('child_process');
const Module = require('module');
const { EventEmitter } = require('events');

let requestUrlMock = async () => ({});
const originalLoad = Module._load;
Module._load = function mockObsidian(request, parent, isMain) {
  if (request === 'obsidian') {
    return {
      Modal: class Modal {},
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
const productionRequestXiaohongshuStaticPage = PluginClass.prototype.requestXiaohongshuStaticPage;
PluginClass.prototype.requestXiaohongshuStaticPage = async function requestXiaohongshuStaticPageFixture(url) {
  const response = await requestUrlMock({
    url,
    method: 'GET',
    headers: helpers.getSocialRequestHeaders(url),
  });
  return {
    ...(response && typeof response === 'object' ? response : {}),
    url: String(response && response.url || url),
  };
};
const fs = require('fs');
const path = require('path');
const os = require('os');
const pluginMainSource = fs
  .readFileSync(path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'main.js'), 'utf8')
  .replace(/\r\n/g, '\n');
const macOcrInstallerSource = fs.readFileSync(
  path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'local-ocr', 'install-local-ocr-macos.sh'),
  'utf8',
);
const windowsOcrInstallerSource = fs.readFileSync(
  path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'local-ocr', 'install-local-ocr.ps1'),
  'utf8',
);
const windowsAsrInstallerSource = fs.readFileSync(
  path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'local-asr', 'install-local-asr.ps1'),
  'utf8',
);
const historicalWindowsAsrInstallerSource = childProcess.execFileSync(
  'git',
  ['show', '1.3.56:obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1'],
  {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    windowsHide: true,
  },
);
const historicalTemplateStart = historicalWindowsAsrInstallerSource.lastIndexOf('# BEGIN_TRANSCRIBE_TEMPLATE');
const historicalTemplateQuoteStart = historicalWindowsAsrInstallerSource.indexOf("@'", historicalTemplateStart);
const historicalTemplateContentStart = historicalWindowsAsrInstallerSource.indexOf('\n', historicalTemplateQuoteStart);
const historicalTemplateQuoteEnd = historicalWindowsAsrInstallerSource.indexOf("\n'@", historicalTemplateContentStart);
assert.ok(historicalTemplateStart >= 0 && historicalTemplateQuoteStart >= 0 && historicalTemplateQuoteEnd > historicalTemplateContentStart);
const historicalWindowsAsrScriptSource = historicalWindowsAsrInstallerSource.slice(
  historicalTemplateContentStart + 1,
  historicalTemplateQuoteEnd,
);
const currentTemplateStart = windowsAsrInstallerSource.lastIndexOf('# BEGIN_TRANSCRIBE_TEMPLATE');
const currentTemplateQuoteStart = windowsAsrInstallerSource.indexOf("@'", currentTemplateStart);
const currentTemplateContentStart = windowsAsrInstallerSource.indexOf('\n', currentTemplateQuoteStart);
const currentTemplateQuoteEnd = windowsAsrInstallerSource.indexOf("\n'@", currentTemplateContentStart);
const currentWindowsAsrScriptSource = windowsAsrInstallerSource.slice(
  currentTemplateContentStart + 1,
  currentTemplateQuoteEnd,
);
const portableWindowsLayoutPlatform = os.platform() === 'win32' ? 'win32' : 'linux';
const macAsrInstallerSource = fs.readFileSync(
  path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync', 'local-asr', 'install-local-asr-macos.sh'),
  'utf8',
);
const markerOnlyLegacyWindowsAsrScriptSource = [
  'function Convert-ExitCodeToHex { $signed = [int64]$ExitCode; if ($signed -lt 0) { $signed = 4294967296 + $signed }; return "0x{0:X8}" -f $signed }',
  'function Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }',
  'function Split-AudioToChunks { param([string]$AudioPath, [int]$SegmentSeconds) }',
  'function Test-TranscriptHasRepeatHallucination { param([string]$Text) }',
  'function Invoke-RecoverRepeatedChunkText { param([string]$ChunkPath) }',
  'function Test-WhisperNativeCrashExitCode { $hex = Convert-ExitCodeToHex -ExitCode $ExitCode }',
  'Invoke-TranscribeAttempt -Mode "normal"',
  'Invoke-TranscribeAttempt -Mode "safe"',
  'safeModelPath',
  'function Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath }',
  'function ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }',
  '$TranscriptQualityGuardVersion = "repeat-guard-v2"',
  '$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)',
  '[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)',
  '[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)',
  'TRANSCRIPT_HALLUCINATION',
  '$ChunkSeconds = 120',
  '$ChunkRetrySeconds = 30',
  '$RunLog = Join-Path $Root "transcribe-last.log"',
  'progressPercent=100',
  'progressHeartbeatAt=now',
  'progressPid=1',
  '-ProgressStage "segmenting"',
  'recoveryTriggered=1',
].join('\n');
const staleWindowsAsrInstallerSource = windowsAsrInstallerSource
  .replace('$InstallerScriptVersion = "1.2.26"', '$InstallerScriptVersion = "1.2.24"')
  .replace('$TranscriptQualityGuardVersion = "repeat-guard-v2"', '$SimplifiedPrompt = "请输入简体中文"\n"--prompt", $SimplifiedPrompt');
const nonTransactionalWindowsAsrInstallerSource = windowsAsrInstallerSource
  .replace('$InstallerScriptVersion = "1.2.26"', '$InstallerScriptVersion = "1.2.25"')
  .replaceAll('Start-TranscribeScriptUpdate', 'Start-LegacyTranscribeScriptUpdate')
  .replaceAll('Promote-TranscribeScriptUpdate', 'Promote-LegacyTranscribeScriptUpdate')
  .replaceAll('Restore-TranscribeScriptUpdate', 'Restore-LegacyTranscribeScriptUpdate')
  .replaceAll('Complete-TranscribeScriptUpdate', 'Complete-LegacyTranscribeScriptUpdate');
const staleMacAsrInstallerSource = macAsrInstallerSource
  .replace('INSTALLER_SCRIPT_VERSION="1.3.8"', 'INSTALLER_SCRIPT_VERSION="1.3.7"');
const promptedMacAsrInstallerSource = macAsrInstallerSource
  .replace('TRANSCRIPT_QUALITY_GUARD_VERSION="repeat-guard-v2"', 'SIMPLIFIED_PROMPT="请输入简体中文"\n--prompt "$SIMPLIFIED_PROMPT"');
const legacyUvOnlyMacAsrInstallerSource = macAsrInstallerSource
  .replaceAll('install_portable_python', 'install_legacy_python');
const runtimeVersionUnverifiedMacAsrInstallerSource = macAsrInstallerSource
  .replace('sys.version.split()[0] == sys.argv[1]', 'sys.version_info >= (3, 10)');
const futurePythonMacAsrInstallerSource = macAsrInstallerSource
  .replace('PYTHON_BUILD_STANDALONE_BUILD="20260623"', 'PYTHON_BUILD_STANDALONE_BUILD="20260701"')
  .replace('PYTHON_BUILD_STANDALONE_VERSION="3.12.13+20260623"', 'PYTHON_BUILD_STANDALONE_VERSION="3.12.14+20260701"')
  .replace(/PYTHON_RUNTIME_SHA256_ARM64="[A-F0-9]{64}"/, `PYTHON_RUNTIME_SHA256_ARM64="${'A'.repeat(64)}"`)
  .replace(/PYTHON_RUNTIME_SHA256_X64="[A-F0-9]{64}"/, `PYTHON_RUNTIME_SHA256_X64="${'B'.repeat(64)}"`);
assert.strictEqual(typeof helpers.isLocalAsrInstallerCurrent, 'function');
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(windowsAsrInstallerSource, false), true);
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(staleWindowsAsrInstallerSource, false), false);
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(nonTransactionalWindowsAsrInstallerSource, false), false);
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(macAsrInstallerSource, true), true);
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(staleMacAsrInstallerSource, true), false);
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(promptedMacAsrInstallerSource, true), false);
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(legacyUvOnlyMacAsrInstallerSource, true), false);
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(runtimeVersionUnverifiedMacAsrInstallerSource, true), false);
assert.strictEqual(helpers.isLocalAsrInstallerCurrent(futurePythonMacAsrInstallerSource, true), true);
assert.strictEqual(typeof helpers.isLocalOcrInstallerCurrent, 'function');
assert.strictEqual(helpers.isLocalOcrInstallerCurrent(windowsOcrInstallerSource, false), true);
assert.strictEqual(helpers.isLocalOcrInstallerCurrent(macOcrInstallerSource, true), true);
assert.strictEqual(typeof helpers.isTrustedLocalOcrInstallerSource, 'function');
assert.strictEqual(
  helpers.isTrustedLocalOcrInstallerSource(
    windowsOcrInstallerSource,
    helpers.LOCAL_OCR_WINDOWS_INSTALLER_SHA256,
    false,
  ),
  true,
);
assert.strictEqual(
  helpers.isTrustedLocalOcrInstallerSource(
    `${windowsOcrInstallerSource}\n# stale cached installer`,
    helpers.LOCAL_OCR_WINDOWS_INSTALLER_SHA256,
    false,
  ),
  false,
);
assert.strictEqual(
  helpers.isLocalOcrInstallerCurrent(windowsOcrInstallerSource.replaceAll('Install-PortablePython', 'Install-LegacyPython'), false),
  false,
);
assert.strictEqual(
  helpers.isLocalOcrInstallerCurrent(macOcrInstallerSource.replaceAll('install_portable_python', 'install_legacy_python'), true),
  false,
);
assert.strictEqual(
  helpers.isLocalOcrInstallerCurrent(windowsOcrInstallerSource.replaceAll('single-dir-transaction-v1', 'legacy-in-place-install'), false),
  false,
);
assert.strictEqual(
  helpers.isLocalOcrInstallerCurrent(
    windowsOcrInstallerSource.replaceAll('function Expand-TarGzArchiveWithPowerShell', 'function Expand-LegacyTarArchive'),
    false,
  ),
  false,
);
assert.ok(pluginMainSource.includes('completePendingLocalOcrSwitch'));

function runPendingLocalOcrSwitchTests() {
  const createFixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-ocr-switch-'));
    const marker = path.join(root, 'pending-venv-switch.json');
    fs.writeFileSync(marker, JSON.stringify({ capability: 'single-dir-transaction-v1' }), 'utf8');
    return { root, marker };
  };

  const noMarkerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-ocr-no-switch-'));
  try {
    assert.deepStrictEqual(helpers.completePendingLocalOcrSwitch(noMarkerRoot), { status: 'none' });
  } finally {
    fs.rmSync(noMarkerRoot, { recursive: true, force: true });
  }

  const activation = createFixture();
  try {
    const oldVenv = path.join(activation.root, 'venv');
    const stagingVenv = path.join(activation.root, 'venv-staging');
    fs.mkdirSync(path.join(oldVenv, 'Scripts'), { recursive: true });
    fs.mkdirSync(path.join(stagingVenv, 'Scripts'), { recursive: true });
    fs.writeFileSync(path.join(oldVenv, 'Scripts', 'python.exe'), 'old');
    fs.writeFileSync(path.join(stagingVenv, 'Scripts', 'python.exe'), 'new');
    const result = helpers.completePendingLocalOcrSwitch(activation.root, {
      validatePython(pythonPath) {
        return fs.readFileSync(pythonPath, 'utf8') === 'new';
      },
    });
    assert.strictEqual(result.status, 'activated');
    assert.strictEqual(fs.readFileSync(path.join(activation.root, 'venv', 'Scripts', 'python.exe'), 'utf8'), 'new');
    assert.strictEqual(fs.existsSync(path.join(activation.root, 'venv-staging')), false);
    assert.strictEqual(fs.existsSync(path.join(activation.root, 'venv-backup')), false);
    assert.strictEqual(fs.existsSync(activation.marker), false);
  } finally {
    fs.rmSync(activation.root, { recursive: true, force: true });
  }

  const locked = createFixture();
  try {
    const oldVenv = path.join(locked.root, 'venv');
    const stagingVenv = path.join(locked.root, 'venv-staging');
    fs.mkdirSync(path.join(oldVenv, 'Scripts'), { recursive: true });
    fs.mkdirSync(path.join(stagingVenv, 'Scripts'), { recursive: true });
    fs.writeFileSync(path.join(stagingVenv, 'Scripts', 'python.exe'), 'new');
    const result = helpers.completePendingLocalOcrSwitch(locked.root, {
      validatePython: () => true,
      rename(from, to) {
        if (from === oldVenv) throw new Error('EPERM locked');
        fs.renameSync(from, to);
      },
    });
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(fs.existsSync(locked.marker), true);
    assert.strictEqual(fs.existsSync(stagingVenv), true);
    assert.strictEqual(fs.existsSync(oldVenv), true);
  } finally {
    fs.rmSync(locked.root, { recursive: true, force: true });
  }

  const rollback = createFixture();
  try {
    const oldVenv = path.join(rollback.root, 'venv');
    const stagingVenv = path.join(rollback.root, 'venv-staging');
    fs.mkdirSync(path.join(oldVenv, 'Scripts'), { recursive: true });
    fs.mkdirSync(path.join(stagingVenv, 'Scripts'), { recursive: true });
    fs.writeFileSync(path.join(oldVenv, 'Scripts', 'python.exe'), 'old');
    fs.writeFileSync(path.join(stagingVenv, 'Scripts', 'python.exe'), 'new');
    let validationCount = 0;
    const result = helpers.completePendingLocalOcrSwitch(rollback.root, {
      validatePython() {
        validationCount += 1;
        return validationCount === 1;
      },
    });
    assert.strictEqual(result.status, 'pending');
    assert.strictEqual(
      fs.readFileSync(path.join(rollback.root, 'venv', 'Scripts', 'python.exe'), 'utf8'),
      'old',
    );
    assert.strictEqual(fs.existsSync(rollback.marker), true);
  } finally {
    fs.rmSync(rollback.root, { recursive: true, force: true });
  }
}

function runXiaohongshuOcrPolicyTests() {
  assert.strictEqual(typeof helpers.isXiaohongshuTextDominantOcrItem, 'function');
  assert.strictEqual(typeof helpers.mergeXiaohongshuOcrText, 'function');
  assert.strictEqual(helpers.XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS.trustedBoxConfidence, 0.55);
  assert.strictEqual(helpers.XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS.averageConfidence, 0.65);

  const textCard = {
    index: 3,
    imageUrl: 'https://sns-webpic-qc.xhscdn.com/text-card.jpg',
    text: [
      '这是一张以正文为主体的长文字卡片',
      '底色和小头像不会改变正文占主要版面的事实',
      '连续内容用于验证文字主体判定',
      '第四行正文继续解释卡片中的核心信息',
      '第五行正文确保文字覆盖足够的纵向区域',
      '最后一行正文用于完成测试样本',
    ].join('\n'),
    metrics: {
      readableChars: 120,
      lineCount: 8,
      averageConfidence: 0.92,
      textBoxAreaRatio: 0.16,
      coveredRowRatio: 0.22,
      verticalSpanRatio: 0.62,
    },
  };
  const captionedPhoto = {
    index: 2,
    imageUrl: 'https://sns-webpic-qc.xhscdn.com/captioned-photo.jpg',
    text: '照片标题\n一行字幕\n品牌水印',
    metrics: {
      readableChars: 18,
      lineCount: 3,
      averageConfidence: 0.91,
      textBoxAreaRatio: 0.03,
      coveredRowRatio: 0.04,
      verticalSpanRatio: 0.12,
    },
  };

  assert.strictEqual(helpers.isXiaohongshuTextDominantOcrItem(textCard), true);
  assert.strictEqual(helpers.isXiaohongshuTextDominantOcrItem(captionedPhoto), false);
  assert.strictEqual(helpers.isXiaohongshuTextDominantOcrItem({
    text: Array.from({ length: 6 }, () => '几何缺失时保守回退正文内容'.repeat(5)).join('\n'),
    metrics: {},
  }), true);
  assert.strictEqual(helpers.isXiaohongshuTextDominantOcrItem({
    text: Array.from({ length: 6 }, () => '非法指标不能伪装成几何缺失正文'.repeat(5)).join('\n'),
    metrics: {
      readableChars: 999,
      lineCount: 99,
      averageConfidence: Number.POSITIVE_INFINITY,
      textBoxAreaRatio: Number.POSITIVE_INFINITY,
      coveredRowRatio: -1,
      verticalSpanRatio: Number.NaN,
    },
  }), false);
  assert.deepStrictEqual(
    helpers.normalizeXiaohongshuOcrItems([captionedPhoto, textCard]).map((item) => item.index),
    [3],
  );

  const page1 = {
    ...textCard,
    index: 1,
    text: [
      '第一页正文开头',
      '同一页允许重复的合法句子',
      '同一页允许重复的合法句子',
      '第一页正文继续',
      '共同边界第一行',
      '共同边界第二行',
    ].join('\n'),
  };
  const page2 = {
    ...textCard,
    index: 2,
    text: [
      '共同边界第一行',
      '共同边界第二行',
      '第二页正文开头',
      '第二页正文继续',
      '第二页正文补充',
      '第二页正文结束',
    ].join('\n'),
  };
  const mergedText = helpers.mergeXiaohongshuOcrText([page2, page1]);
  const markdown = helpers.buildXiaohongshuOcrMarkdown([page2, page1]);

  assert.ok(markdown.startsWith('## 图片文字\n\n'));
  assert.strictEqual((markdown.match(/^## 图片文字$/gm) || []).length, 1);
  assert.doesNotMatch(markdown, /### 图片\s*\d+/);
  assert.strictEqual((mergedText.match(/共同边界第一行/g) || []).length, 1);
  assert.strictEqual((mergedText.match(/共同边界第二行/g) || []).length, 1);
  assert.strictEqual((mergedText.match(/同一页允许重复的合法句子/g) || []).length, 2);
  assert.ok(mergedText.indexOf('第一页正文开头') < mergedText.indexOf('第二页正文开头'));
}

runPendingLocalOcrSwitchTests();
runXiaohongshuOcrPolicyTests();
assert.strictEqual(typeof helpers.enableDebuggerNetworkCapture, 'function');
let debuggerNetworkCommand = '';
const neverSettlingDebuggerCommand = new Promise(() => {});
assert.strictEqual(helpers.enableDebuggerNetworkCapture({
  sendCommand(command) {
    debuggerNetworkCommand = command;
    return neverSettlingDebuggerCommand;
  },
}), true);
assert.strictEqual(debuggerNetworkCommand, 'Network.enable');
assert.strictEqual(typeof helpers.beginBestEffortBrowserLoad, 'function');
let browserLoadUrl = '';
assert.strictEqual(helpers.beginBestEffortBrowserLoad({
  loadURL(url) {
    browserLoadUrl = url;
    return new Promise(() => {});
  },
}, 'https://www.douyin.com/video/123456789'), true);
assert.strictEqual(browserLoadUrl, 'https://www.douyin.com/video/123456789');
assert.strictEqual(typeof helpers.waitForBrowserTasksWithin, 'function');
assert.strictEqual(typeof helpers.getProEntitlementStatusFingerprint, 'function');
const inactiveProFingerprint = helpers.getProEntitlementStatusFingerprint({
  hasAccess: false,
  status: 'inactive',
  expiresAt: '',
});
const activeProFingerprint = helpers.getProEntitlementStatusFingerprint({
  hasAccess: true,
  status: 'active',
  expiresAt: '2026-07-22T04:46:17.347Z',
  code: 'OBTRYTEST1',
});
assert.notStrictEqual(inactiveProFingerprint, activeProFingerprint);
assert.strictEqual(
  activeProFingerprint,
  helpers.getProEntitlementStatusFingerprint({
    hasAccess: true,
    status: 'active',
    expiresAt: '2026-07-22T04:46:17.347Z',
    code: 'OBTRYTEST1',
  }),
);
assert.strictEqual(pluginMainSource.includes('selectors.flatMap'), false);
assert.strictEqual(pluginMainSource.includes("querySelectorAll('*')"), false);
assert.ok(pluginMainSource.includes('async function renderFeishuUrlToSimpleMarkdownWithElectron'));
assert.ok(pluginMainSource.includes('const rendered = await renderFeishuUrlToSimpleMarkdownWithElectron(url);'));
const simpleFeishuRendererSource = pluginMainSource.slice(
  pluginMainSource.indexOf('async function renderFeishuUrlToSimpleMarkdownWithElectron'),
  pluginMainSource.indexOf('async function renderSocialMediaUrlsWithElectron'),
);
assert.ok(simpleFeishuRendererSource.includes('getFeishuClientVars'));
assert.ok(simpleFeishuRendererSource.includes('mergeFeishuRenderedAndClientVarsMarkdown'));
const socialMediaRendererSource = pluginMainSource.slice(
  pluginMainSource.indexOf('async function renderSocialMediaUrlsWithElectron'),
  pluginMainSource.indexOf('async function renderXiaohongshuPageWithElectron'),
);
assert.ok(socialMediaRendererSource.includes('const wechatSession = isXiaohongshuUrl(url) ? getXiaohongshuSession() : getWechatSession();'));
assert.ok(socialMediaRendererSource.includes('shouldBlockExternalAppUrl(details && details.url)'));
assert.ok(socialMediaRendererSource.includes('isXiaohongshuCommentApiUrl(details && details.url)'));
assert.ok(socialMediaRendererSource.includes('runWithXiaohongshuBrowserSessionLock'));
assert.ok(socialMediaRendererSource.includes('__xiaohongshuSessionLockHeld'));
assert.ok(socialMediaRendererSource.includes('installExternalAppNavigationGuards(win.webContents)'));
assert.ok(socialMediaRendererSource.includes('await installDouyinExternalProtocolHandlers(wechatSession)'));
assert.ok(
  socialMediaRendererSource.indexOf('await installDouyinExternalProtocolHandlers(wechatSession)')
    < socialMediaRendererSource.indexOf('new BrowserWindow'),
);
const xiaohongshuPageRendererSource = pluginMainSource.slice(
  pluginMainSource.indexOf('async function renderXiaohongshuPageWithElectron'),
  pluginMainSource.indexOf('async function renderXiaohongshuCommentsWithElectron'),
);
assert.ok(xiaohongshuPageRendererSource.includes('installXiaohongshuNavigationGuards(win.webContents)'));
assert.ok(pluginMainSource.includes('async function renderXiaohongshuContentWithElectron'));
assert.ok(xiaohongshuPageRendererSource.includes('options.includeComments === false'));
const xiaohongshuContentRendererSource = pluginMainSource.slice(
  pluginMainSource.indexOf('async function renderXiaohongshuContentWithElectron'),
  pluginMainSource.indexOf('let xiaohongshuBrowserSessionQueue'),
);

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
  'https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink',
);
assert.strictEqual(
  helpers.FEISHU_OFFICIAL_API_TUTORIAL_URL,
  'https://my.feishu.cn/wiki/LZBlwhqBCi880Bk00yOcB2dKn1g?from=from_copylink',
);
assert.strictEqual(typeof helpers.buildAliyunVoiceRequest, 'function');
assert.strictEqual(typeof helpers.buildDoubaoAsrRequest, 'function');
assert.strictEqual(typeof helpers.buildDoubaoAsrQueryRequest, 'function');
assert.strictEqual(typeof helpers.parseAliyunTranscriptionResult, 'function');
assert.strictEqual(typeof helpers.parseDoubaoAsrResult, 'function');
assert.strictEqual(typeof helpers.parseDoubaoAsrTaskState, 'function');
assert.strictEqual(typeof helpers.getTranscriptionQualityIssue, 'function');
assert.strictEqual(typeof helpers.assertUsableTranscription, 'function');
assert.strictEqual(
  helpers.getTranscriptionQualityIssue(Array(12).fill('我们现在就来看看我们的临化设备').join('\n')),
  'repeated-lines',
);
assert.strictEqual(
  helpers.getTranscriptionQualityIssue([
    ...Array(8).fill('我们选择的问题就是'),
    ...Array(3).fill('请输入简体中文'),
  ].join('\n')),
  'prompt-leak',
);
assert.strictEqual(
  helpers.getTranscriptionQualityIssue('这是第一段正常内容。\n这里为了强调重复一次。\n这里为了强调重复一次。\n最后继续讲新的内容。'),
  '',
);
assert.throws(
  () => helpers.assertUsableTranscription(Array(10).fill('我们选择的问题就是').join('\n'), '本地转写'),
  (error) => error && error.code === 'TRANSCRIPTION_LOW_QUALITY' && error.message.includes('重复句循环'),
);
assert.strictEqual(typeof helpers.formatHttpError, 'function');
assert.strictEqual(typeof helpers.buildTencentCreateRecTaskBody, 'function');
assert.strictEqual(typeof helpers.buildTencentRequest, 'function');
assert.strictEqual(typeof helpers.parseTencentCreateTaskResponse, 'function');
assert.strictEqual(typeof helpers.parseTencentTaskStatusResponse, 'function');
assert.strictEqual(typeof helpers.buildRecordTitleBase, 'function');
assert.strictEqual(typeof helpers.hasRecordIdInFrontmatter, 'function');
assert.strictEqual(typeof helpers.buildSkippedSyncNotice, 'function');
assert.strictEqual(typeof helpers.buildSyncDiagnosticLogText, 'function');
assert.strictEqual(typeof helpers.getRecordConversionWarning, 'function');
assert.strictEqual(typeof helpers.buildConversionWarningsNotice, 'function');
assert.strictEqual(typeof helpers.buildSyncResultNotice, 'function');
assert.strictEqual(
  helpers.buildSyncResultNotice([], [], [], [{
    recordId: 'xhs-failed',
    message: '小红书内容提取失败，已记录诊断，下次同步将重试。',
  }]),
  '同步失败：1 条内容未同步：小红书内容提取失败，已记录诊断，下次同步将重试。',
);
assert.strictEqual(typeof helpers.extractXiaohongshuMarkdownFromHtml, 'function');
assert.strictEqual(typeof helpers.getPluginRuntimeIdentity, 'function');
assert.deepStrictEqual(helpers.getPluginRuntimeIdentity('1.3.70'), {
  manifestVersion: '1.3.70',
  runtimeVersion: '1.3.70',
  buildMarker: 'clipboard-link-path-v1',
  matchesManifest: true,
});
assert.strictEqual(helpers.getPluginRuntimeIdentity('1.3.58').matchesManifest, false);
assert.strictEqual(typeof helpers.buildXiaohongshuFailureDiagnostic, 'function');
const xiaohongshuFailureDiagnostic = helpers.buildXiaohongshuFailureDiagnostic({
  manifestVersion: '1.3.60',
  sourceUrl: 'http://xhslink.cn/o/demo?xsec_token=source-secret',
  resolvedUrl: 'https://www.xiaohongshu.com/explore/123?xsec_token=resolved-secret',
  responseStatus: 200,
  html: '<title>小红书 - 你的生活兴趣社区</title>',
  extracted: {
    title: '小红书 - 你的生活兴趣社区',
    description: '存下口令，跳转【小红书】阅读',
    markdown: '存下口令，跳转【小红书】阅读',
    imageUrls: [],
  },
  browserAttempts: [{
    inputKind: 'original-shortlink',
    attempted: true,
    finalHost: 'xiaohongshu.com',
    pageType: 'xiaohongshu-generic-landing',
    bodyCharacterCount: 0,
    imageCount: 1,
    failed: false,
    url: 'https://www.xiaohongshu.com/explore/secret?xsec_token=must-not-leak',
    cookie: 'must-not-leak',
  }],
});
assert.strictEqual(xiaohongshuFailureDiagnostic.request.sourceHost, 'xhslink.cn');
assert.strictEqual(xiaohongshuFailureDiagnostic.request.finalHost, 'xiaohongshu.com');
assert.strictEqual(xiaohongshuFailureDiagnostic.request.responseStatus, 200);
assert.strictEqual(xiaohongshuFailureDiagnostic.request.pageType, 'xiaohongshu-generic-landing');
assert.strictEqual(xiaohongshuFailureDiagnostic.extraction.shareBoilerplateOnly, true);
assert.strictEqual(xiaohongshuFailureDiagnostic.extraction.imageCount, 0);
assert.strictEqual(JSON.stringify(xiaohongshuFailureDiagnostic).includes('source-secret'), false);
assert.strictEqual(JSON.stringify(xiaohongshuFailureDiagnostic).includes('resolved-secret'), false);
assert.strictEqual(JSON.stringify(xiaohongshuFailureDiagnostic).includes('存下口令'), false);
assert.deepStrictEqual(xiaohongshuFailureDiagnostic.request.browserAttempts, [{
  inputKind: 'original-shortlink',
  attempted: true,
  finalHost: 'xiaohongshu.com',
  pageType: 'xiaohongshu-generic-landing',
  bodyCharacterCount: 0,
  imageCount: 1,
  failed: false,
}]);
assert.strictEqual(JSON.stringify(xiaohongshuFailureDiagnostic).includes('must-not-leak'), false);
const xiaohongshuFailureLogText = helpers.buildSyncDiagnosticLogText({
  status: 'failed',
  message: '单条内容同步失败',
  diagnostic: {
    ...xiaohongshuFailureDiagnostic,
    request: {
      ...xiaohongshuFailureDiagnostic.request,
      xsec_token: 'must-not-be-copied',
    },
  },
});
assert.ok(xiaohongshuFailureLogText.includes('--- diagnostic ---'));
assert.ok(xiaohongshuFailureLogText.includes('"pageType": "xiaohongshu-generic-landing"'));
assert.strictEqual(xiaohongshuFailureLogText.includes('must-not-be-copied'), false);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent({
  title: '🔥有钱之后，应该给多提升生活质量',
  description: '🔥有钱之后，应该给多提升生活质量 http://xhslink.cn/o/demo 存下口令，跳转【小红书】阅读~',
  markdown: '🔥有钱之后，应该给多提升生活质量 http://xhslink.cn/o/demo 存下口令，跳转【小红书】阅读~',
  imageUrls: [],
}, '<html><body></body></html>', 'https://www.xiaohongshu.com/explore/123'), false);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent({
  title: '真实图片笔记',
  description: '存下口令，跳转【小红书】阅读',
  markdown: '存下口令，跳转【小红书】阅读',
  imageUrls: ['https://sns-webpic-qc.xhscdn.com/real-note.jpg'],
}, [
  '<html><head>',
  '<link rel="canonical" href="https://www.xiaohongshu.com/explore/real-image-note">',
  '</head><body></body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/real-image-note'), true);
assert.strictEqual(
  helpers.getSocialRequestHeaders('http://xhslink.cn/o/demo').Referer,
  'https://www.xiaohongshu.com/',
  'xhslink.cn short links must enter the Xiaohongshu extraction path',
);
assert.strictEqual(typeof helpers.isXiaohongshuUrl, 'function');
assert.strictEqual(helpers.isXiaohongshuUrl('https://www.xiaohongshu.com/explore/demo'), true);
assert.strictEqual(helpers.isXiaohongshuUrl('http://xhslink.cn/o/demo'), true);
assert.strictEqual(helpers.isXiaohongshuUrl('https://evil.example/?u=xhslink.cn'), false);
assert.strictEqual(helpers.isXiaohongshuUrl('https://xhslink.cn.evil.example/o/demo'), false);
assert.strictEqual(typeof helpers.getXiaohongshuTargetNoteId, 'function');
assert.strictEqual(
  helpers.getXiaohongshuTargetNoteId('https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144'),
  '6a4ccf88000000001101d144',
);
assert.strictEqual(
  helpers.getXiaohongshuTargetNoteId('https://attacker.example/explore/6a4ccf88000000001101d144'),
  '',
);
assert.strictEqual(
  helpers.getXiaohongshuTargetNoteId('http://www.xiaohongshu.com/explore/6a4ccf88000000001101d144'),
  '',
);
assert.strictEqual(typeof helpers.isTrustedXiaohongshuCookieUrl, 'function');
assert.strictEqual(helpers.isTrustedXiaohongshuCookieUrl('https://www.xiaohongshu.com/explore/demo'), true);
assert.strictEqual(helpers.isTrustedXiaohongshuCookieUrl('https://edith.xiaohongshu.com/api/demo'), true);
assert.strictEqual(helpers.isTrustedXiaohongshuCookieUrl('http://xhslink.cn/o/demo'), false);
assert.strictEqual(helpers.isTrustedXiaohongshuCookieUrl('https://xiaohongshu.com.evil.example/'), false);
assert.strictEqual(typeof helpers.hasXiaohongshuLoginCookies, 'function');
assert.deepStrictEqual(helpers.getXiaohongshuCapabilityMatrix({
  hasProAccess: false,
  commentsEnabled: true,
  isLoggedIn: false,
}), {
  publicGraphic: true,
  mediaTranscription: false,
  imageOcr: false,
  comments: false,
});
assert.deepStrictEqual(helpers.getXiaohongshuCapabilityMatrix({
  hasProAccess: true,
  commentsEnabled: true,
  isLoggedIn: false,
}), {
  publicGraphic: true,
  mediaTranscription: true,
  imageOcr: true,
  comments: false,
});
assert.deepStrictEqual(helpers.getXiaohongshuCapabilityMatrix({
  hasProAccess: true,
  commentsEnabled: true,
  isLoggedIn: true,
}), {
  publicGraphic: true,
  mediaTranscription: true,
  imageOcr: true,
  comments: true,
});
assert.deepStrictEqual(
  helpers.getXiaohongshuBrowserCandidates(
    'http://xhslink.cn/o/demo',
    'https://www.xiaohongshu.com/explore/note-1?xsec_token=redacted',
  ).map((item) => item.kind),
  ['original-shortlink', 'resolved-url'],
);
assert.strictEqual(
  helpers.getXiaohongshuBrowserCandidates(
    'https://www.xiaohongshu.com/explore/note-1',
    'https://www.xiaohongshu.com/explore/note-1',
  ).length,
  1,
);
const mergedXiaohongshuExtraction = helpers.mergeXiaohongshuExtractions([
  {
    title: '小红书笔记',
    description: '单纯到真诚，我走了10年！ http://xhslink.cn/o/demo 先复制这段口令，再去【小红书】打开笔记查看更多内容。',
    tags: [],
    imageUrls: ['https://ci.xiaohongshu.com/default-landing.png'],
    videoUrl: '',
    comments: [],
    markdown: '分享口令',
  },
  {
    title: '真实笔记标题',
    description: '真实笔记正文。',
    tags: ['#真实标签'],
    imageUrls: [
      'https://sns-webpic-qc.xhscdn.com/real-cover.jpg',
      'https://sns-webpic-qc.xhscdn.com/real-page-2.jpg',
    ],
    videoUrl: '',
    comments: [],
    markdown: '真实笔记正文。',
  },
], {
  title: '小红书笔记',
  description: '单纯到真诚，我走了10年！ http://xhslink.cn/o/demo 先复制这段口令，再去【小红书】打开笔记查看更多内容。',
  tags: [],
  imageUrls: ['https://ci.xiaohongshu.com/default-landing.png'],
  videoUrl: '',
  comments: [],
  markdown: '分享口令',
});
assert.strictEqual(mergedXiaohongshuExtraction.title, '真实笔记标题');
assert.strictEqual(mergedXiaohongshuExtraction.description, '真实笔记正文。');
assert.deepStrictEqual(mergedXiaohongshuExtraction.tags, ['#真实标签']);
assert.deepStrictEqual(mergedXiaohongshuExtraction.imageUrls, [
  'https://sns-webpic-qc.xhscdn.com/real-cover.jpg',
  'https://sns-webpic-qc.xhscdn.com/real-page-2.jpg',
]);
const matchedPrimaryExtraction = {
  title: '目标笔记标题',
  description: '目标笔记正文。',
  tags: ['#目标标签'],
  imageUrls: ['https://sns-webpic-qc.xhscdn.com/target-only.jpg'],
  videoUrl: '',
  author: '目标作者',
  comments: [],
  markdown: '目标笔记正文。',
  xiaohongshuTargetNoteIdPresent: true,
  xiaohongshuPrimaryNoteMatched: true,
};
const unmatchedRecommendationExtraction = {
  title: '另一篇推荐笔记',
  description: '另一篇推荐笔记的正文非常长，绝对不能因为更长就覆盖已经精确匹配的目标正文。'.repeat(8),
  tags: ['#推荐标签'],
  imageUrls: ['https://sns-webpic-qc.xhscdn.com/unrelated-recommendation.jpg'],
  videoUrl: 'https://sns-video.xhscdn.com/unrelated-recommendation.mp4',
  author: '推荐作者',
  comments: [{ text: '推荐笔记评论' }],
  markdown: '另一篇推荐笔记正文。',
  xiaohongshuTargetNoteIdPresent: true,
  xiaohongshuPrimaryNoteMatched: false,
};
const identityBoundMergedXiaohongshuExtraction = helpers.mergeXiaohongshuExtractions([
  matchedPrimaryExtraction,
  unmatchedRecommendationExtraction,
], matchedPrimaryExtraction);
assert.strictEqual(identityBoundMergedXiaohongshuExtraction.title, '目标笔记标题');
assert.strictEqual(identityBoundMergedXiaohongshuExtraction.description, '目标笔记正文。');
assert.deepStrictEqual(identityBoundMergedXiaohongshuExtraction.tags, ['#目标标签']);
assert.deepStrictEqual(identityBoundMergedXiaohongshuExtraction.imageUrls, [
  'https://sns-webpic-qc.xhscdn.com/target-only.jpg',
]);
assert.strictEqual(identityBoundMergedXiaohongshuExtraction.videoUrl, '');
assert.strictEqual(identityBoundMergedXiaohongshuExtraction.author, '目标作者');
assert.deepStrictEqual(identityBoundMergedXiaohongshuExtraction.comments, []);
assert.strictEqual(typeof helpers.extractSocialCommentsFromHtml, 'function');
assert.strictEqual(typeof helpers.getXiaohongshuCapturedRequestBody, 'function');
assert.strictEqual(
  helpers.getXiaohongshuCapturedRequestBody({
    uploadData: [{ bytes: Buffer.from('cursor=next-comment-page', 'utf8') }],
  }),
  'cursor=next-comment-page',
);
const oversizedXiaohongshuCommentBody = helpers.getXiaohongshuCapturedRequestBody({
  uploadData: [{ bytes: Buffer.alloc((1024 * 1024) + 1, 97) }],
});
assert.strictEqual(
  helpers.classifyXiaohongshuCommentRequestIdentity({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
    body: oversizedXiaohongshuCommentBody,
  }, '6a4ccf88000000001101d144'),
  'mismatched',
);
assert.strictEqual(typeof helpers.getXiaohongshuCapturedResponseText, 'function');
assert.strictEqual(
  helpers.getXiaohongshuCapturedResponseText({
    body: Buffer.from('{"code":0}', 'utf8').toString('base64'),
    base64Encoded: true,
  }),
  '{"code":0}',
);
assert.strictEqual(
  helpers.getXiaohongshuCapturedResponseText({
    body: 'A'.repeat((Math.ceil((4 * 1024 * 1024) / 3) * 4) + 16),
    base64Encoded: true,
  }),
  '',
);
assert.strictEqual(typeof helpers.classifyXiaohongshuCommentRequestIdentity, 'function');
assert.strictEqual(typeof helpers.isXiaohongshuCommentApiUrl, 'function');
assert.strictEqual(typeof helpers.isXiaohongshuSubCommentApiUrl, 'function');
assert.strictEqual(
  helpers.isXiaohongshuCommentApiUrl(
    'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
  ),
  true,
);
assert.strictEqual(
  helpers.isXiaohongshuSubCommentApiUrl(
    'https://www.xiaohongshu.com/api/sns/web/v2/comment/sub/page?root_comment_id=root-1',
  ),
  true,
);
[
  'http://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
  'https://xiaohongshu.com.evil.example/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
  'https://evil.example/xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
  'https://user@edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
  'https://edith.xiaohongshu.com:444/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
  'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page/other?note_id=6a4ccf88000000001101d144',
].forEach((unsafeUrl) => {
  assert.strictEqual(
    helpers.isXiaohongshuCommentApiUrl(unsafeUrl),
    false,
    `comment endpoint must reject an untrusted URL: ${unsafeUrl}`,
  );
});
assert.strictEqual(
  helpers.classifyXiaohongshuCommentRequestIdentity({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
  }, '6a4ccf88000000001101d144'),
  'matched',
);
assert.strictEqual(
  helpers.classifyXiaohongshuCommentRequestIdentity({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=000000000000000000000099',
  }, '6a4ccf88000000001101d144'),
  'mismatched',
);
assert.strictEqual(
  helpers.classifyXiaohongshuCommentRequestIdentity({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page',
    body: JSON.stringify({ note_id: '6a4ccf88000000001101d144' }),
  }, '6a4ccf88000000001101d144'),
  'matched',
);
assert.strictEqual(
  helpers.classifyXiaohongshuCommentRequestIdentity({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/sub/page?root_comment_id=root-1',
  }, '6a4ccf88000000001101d144'),
  'unidentified',
);
assert.strictEqual(
  helpers.classifyXiaohongshuCommentRequestIdentity({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
    payload: { data: { note_id: '000000000000000000000099', comments: [] } },
  }, '6a4ccf88000000001101d144'),
  'mismatched',
);
assert.strictEqual(
  helpers.classifyXiaohongshuCommentRequestIdentity({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page',
    payload: { data: { note_id: '6a4ccf88000000001101d144', comments: [] } },
  }, '6a4ccf88000000001101d144'),
  'unidentified',
  'a matching response payload must not rescue a request that lacked target identity',
);
assert.strictEqual(
  helpers.classifyXiaohongshuCommentRequestIdentity({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
    payload: {
      padding: Array.from({ length: 2100 }, () => ({})),
      data: {
        note_id: '000000000000000000000099',
        comments: [{ content: 'OTHER NOTE COMMENT' }],
      },
    },
  }, '6a4ccf88000000001101d144'),
  'mismatched',
  'an identity scan that reaches its traversal budget must fail closed',
);
[
  {
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144&note_id=000000000000000000000099',
  },
  {
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page',
    body: 'note_id=6a4ccf88000000001101d144&note_id=000000000000000000000099',
  },
  {
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
    payload: { data: { comments: Array.from({ length: 5000 }, () => null) } },
  },
  {
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=6a4ccf88000000001101d144',
    payload: { data: { nested: { deeper: { level4: { level5: { level6: { level7: { level8: { level9: {
      note_id: '000000000000000000000099',
    } } } } } } } } } },
  },
].forEach((request) => {
  assert.notStrictEqual(
    helpers.classifyXiaohongshuCommentRequestIdentity(
      request,
      '6a4ccf88000000001101d144',
    ),
    'matched',
    'ambiguous or incompletely inspected comment identity must fail closed',
  );
});
assert.strictEqual(typeof helpers.enrichExtractedWebpageMetadata, 'function');
assert.strictEqual(typeof helpers.extractSocialVideoMarkdownFromHtml, 'function');
assert.strictEqual(typeof helpers.extractPodcastAudioUrlFromHtml, 'function');
assert.strictEqual(typeof helpers.extractBilibiliSubtitleUrlsFromHtml, 'function');
assert.strictEqual(typeof helpers.parseBilibiliSubtitlePayload, 'function');
assert.strictEqual(typeof helpers.extractBilibiliAudioUrlFromPlayurlPayload, 'function');
assert.strictEqual(typeof helpers.extractBilibiliProgressiveVideoUrlFromPlayurlPayload, 'function');
assert.strictEqual(typeof helpers.hasVideoTrackInMediaBuffer, 'function');
assert.strictEqual(typeof helpers.cleanTrailingTranscriptionHallucinations, 'function');
assert.strictEqual(typeof helpers.isWechatChannelsUrl, 'function');
assert.strictEqual(typeof helpers.extractWechatChannelsRequestPayload, 'function');
assert.strictEqual(typeof helpers.normalizeWechatChannelsFeedPayload, 'function');
assert.strictEqual(typeof helpers.normalizeBrowserCapturedMediaUrls, 'function');
assert.strictEqual(typeof helpers.shouldBlockExternalAppUrl, 'function');
assert.strictEqual(typeof helpers.installExternalAppNavigationGuards, 'function');
assert.strictEqual(helpers.shouldBlockExternalAppUrl('bytedance://aweme/detail/123'), true);
assert.strictEqual(helpers.shouldBlockExternalAppUrl('snssdk1128://aweme/detail/123'), true);
assert.strictEqual(helpers.shouldBlockExternalAppUrl('bytedance://open?url=https%3A%2F%2Fwww.douyin.com%2F'), true);
assert.strictEqual(helpers.shouldBlockExternalAppUrl('https://www.douyin.com/video/123'), false);
assert.strictEqual(helpers.shouldBlockExternalAppUrl('blob:https://www.douyin.com/demo'), false);
assert.strictEqual(helpers.shouldBlockExternalAppUrl('data:text/plain,media'), false);
assert.strictEqual(helpers.shouldBlockExternalAppUrl('about:blank'), false);
const externalNavigationHandlers = {};
let externalWindowOpenHandler = null;
helpers.installExternalAppNavigationGuards({
  on(eventName, handler) {
    externalNavigationHandlers[eventName] = handler;
  },
  setWindowOpenHandler(handler) {
    externalWindowOpenHandler = handler;
  },
});
assert.strictEqual(typeof externalNavigationHandlers['will-navigate'], 'function');
assert.strictEqual(typeof externalNavigationHandlers['will-frame-navigate'], 'function');
assert.strictEqual(typeof externalNavigationHandlers['will-redirect'], 'function');
let preventedExternalFrameNavigation = false;
externalNavigationHandlers['will-frame-navigate']({
  preventDefault() {
    preventedExternalFrameNavigation = true;
  },
}, 'bytedance://aweme/detail/123');
assert.strictEqual(preventedExternalFrameNavigation, true);
assert.strictEqual(typeof externalWindowOpenHandler, 'function');
let preventedExternalFrameNavigationDetails = false;
externalNavigationHandlers['will-frame-navigate']({
  preventDefault() {
    preventedExternalFrameNavigationDetails = true;
  },
}, {
  url: 'bytedance://aweme/detail/123',
  isMainFrame: false,
});
assert.strictEqual(preventedExternalFrameNavigationDetails, true);
let preventedExternalFrameNavigationEvent = false;
externalNavigationHandlers['will-frame-navigate']({
  url: 'bytedance://aweme/detail/123',
  isMainFrame: false,
  preventDefault() {
    preventedExternalFrameNavigationEvent = true;
  },
});
assert.strictEqual(preventedExternalFrameNavigationEvent, true);
let preventedExternalRedirect = false;
externalNavigationHandlers['will-redirect']({
  preventDefault() {
    preventedExternalRedirect = true;
  },
}, 'bytedance://aweme/detail/123');
assert.strictEqual(preventedExternalRedirect, true);
let preventedSafeNavigation = false;
externalNavigationHandlers['will-navigate']({
  preventDefault() {
    preventedSafeNavigation = true;
  },
}, 'https://www.douyin.com/video/123');
assert.strictEqual(preventedSafeNavigation, false);
assert.deepStrictEqual(externalWindowOpenHandler({ url: 'snssdk1128://aweme/detail/123' }), { action: 'deny' });
assert.deepStrictEqual(externalWindowOpenHandler({ url: 'bytedance://aweme/detail/123' }), { action: 'deny' });
assert.deepStrictEqual(externalWindowOpenHandler({ url: 'https://www.douyin.com/video/123' }), { action: 'allow' });
assert.strictEqual(typeof helpers.installXiaohongshuNavigationGuards, 'function');
assert.strictEqual(typeof helpers.shouldBlockXiaohongshuBrowserNavigationRequest, 'function');
assert.strictEqual(
  helpers.shouldBlockXiaohongshuBrowserNavigationRequest({
    url: 'https://attacker.example/forged-note',
    resourceType: 'mainFrame',
  }),
  true,
);
assert.strictEqual(
  helpers.shouldBlockXiaohongshuBrowserNavigationRequest({
    url: 'https://sns-webpic-qc.xhscdn.com/note-image.jpg',
    resourceType: 'image',
    frameId: 0,
    parentFrameId: -1,
  }),
  false,
  '主框架发起的图片子资源不能被误判为顶层导航',
);
assert.strictEqual(
  helpers.shouldBlockXiaohongshuBrowserNavigationRequest({
    url: 'https://fe-static.xhscdn.com/runtime.js',
    resourceType: 'script',
    frameId: 0,
    parentFrameId: -1,
  }),
  false,
  '主框架发起的脚本子资源不能被误判为顶层导航',
);
assert.strictEqual(
  helpers.shouldBlockXiaohongshuBrowserNavigationRequest({
    url: 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
    resourceType: 'mainFrame',
  }),
  false,
);
assert.strictEqual(
  helpers.shouldBlockXiaohongshuBrowserNavigationRequest({
    url: 'http://xhslink.cn/o/demo',
    resourceType: 'mainFrame',
  }),
  false,
);
const xiaohongshuNavigationHandlers = {};
let xiaohongshuWindowOpenHandler = null;
helpers.installXiaohongshuNavigationGuards({
  on(eventName, handler) {
    xiaohongshuNavigationHandlers[eventName] = handler;
  },
  setWindowOpenHandler(handler) {
    xiaohongshuWindowOpenHandler = handler;
  },
});
let preventedExternalXiaohongshuRedirect = false;
xiaohongshuNavigationHandlers['will-redirect']({
  preventDefault() {
    preventedExternalXiaohongshuRedirect = true;
  },
}, 'https://attacker.example/forged-note');
assert.strictEqual(preventedExternalXiaohongshuRedirect, true);
let preventedOfficialXiaohongshuRedirect = false;
xiaohongshuNavigationHandlers['will-redirect']({
  preventDefault() {
    preventedOfficialXiaohongshuRedirect = true;
  },
}, 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144');
assert.strictEqual(preventedOfficialXiaohongshuRedirect, false);
assert.deepStrictEqual(
  xiaohongshuWindowOpenHandler({ url: 'https://attacker.example/forged-note' }),
  { action: 'deny' },
);
assert.deepStrictEqual(
  xiaohongshuWindowOpenHandler({ url: 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144' }),
  { action: 'allow' },
);
assert.strictEqual(typeof helpers.buildAudioTranscriptMarkdown, 'function');
assert.strictEqual(typeof helpers.buildTranscriptPropertyMetadata, 'function');
assert.strictEqual(typeof helpers.buildTranscriptOnlyMetadata, 'function');
assert.strictEqual(typeof helpers.buildSyncProgressMessage, 'function');
assert.strictEqual(typeof helpers.parseLocalAsrProgressLog, 'function');
assert.strictEqual(typeof helpers.buildLocalAsrProgressKey, 'function');
assert.strictEqual(typeof helpers.extractSocialMediaUrlFromHtml, 'function');
assert.strictEqual(typeof PluginClass.prototype.stopCurrentTranscription, 'function');
assert.strictEqual(pluginMainSource.includes("setButtonText('停止当前转写')"), false);
{
  const ribbon = { style: { display: 'initial' } };
  PluginClass.prototype.setTranscriptionStopAvailable.call({ transcriptionStopRibbon: ribbon }, false);
  assert.strictEqual(ribbon.style.display, '', '停止转写入口在没有任务时也必须保持可见');
}
assert.ok(pluginMainSource.includes('shouldReadBindErrorBody'));
assert.ok(pluginMainSource.includes('暂时无法确认绑定码状态，请重试。'));
assert.ok(pluginMainSource.includes("taskkill', ['/PID'"));
assert.ok(pluginMainSource.includes("'/T', '/F'"));
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
assert.strictEqual(typeof helpers.extractFeishuOpenApiUrlInfo, 'function');
assert.strictEqual(typeof helpers.extractFeishuMarkdownFromOpenApiBlocks, 'function');
assert.strictEqual(typeof helpers.fetchFeishuOpenApiMarkdownFromUrl, 'function');
assert.strictEqual(
  helpers.formatRedeemAccessError(new Error('Request failed, status 404'), 'auto'),
  '没有识别到可用兑换码，请手动输入兑换码。',
);
assert.strictEqual(
  helpers.formatRedeemAccessError(new Error('Request failed, status 400'), 'redeem'),
  '兑换码无效、已过期，或不属于当前绑定微信。',
);
assert.strictEqual(typeof helpers.isWechatMpArticleUrl, 'function');
assert.strictEqual(typeof helpers.shouldHydrateLinkAsWebpage, 'function');
assert.strictEqual(typeof helpers.selectAutomaticWebpageUrlFromText, 'function');
assert.strictEqual(typeof helpers.normalizeConfiguredVaultPath, 'function');
assert.strictEqual(typeof helpers.shouldPersistNormalizedInboxDir, 'function');
assert.strictEqual(typeof helpers.requestPublicWebpageText, 'function');
assert.strictEqual(typeof helpers.getSafeRedirectRequestHeaders, 'function');
assert.strictEqual(
  helpers.selectAutomaticWebpageUrlFromText('存下口令，跳转【小红书】阅读 http://xhslink.cn/o/3twEehTqivC'),
  'http://xhslink.cn/o/3twEehTqivC',
);
assert.strictEqual(
  helpers.selectAutomaticWebpageUrlFromText('复制口令 http://xhslink.cn/o/3twEehTqivC存下口令，跳转【小红书】阅读'),
  'http://xhslink.cn/o/3twEehTqivC',
);
assert.strictEqual(
  helpers.selectAutomaticWebpageUrlFromText('普通网页 https://example.com/article?id=1'),
  'https://example.com/article?id=1',
);
assert.strictEqual(
  helpers.selectAutomaticWebpageUrlFromText('句末链接 https://example.com/article.'),
  'https://example.com/article',
);
assert.strictEqual(
  helpers.selectAutomaticWebpageUrlFromText('两个普通链接 https://example.com/a https://example.net/b'),
  '',
);
assert.strictEqual(
  helpers.selectAutomaticWebpageUrlFromText('保留唯一平台链接 https://example.com/a http://xhslink.cn/o/abc123'),
  'http://xhslink.cn/o/abc123',
);
assert.strictEqual(
  helpers.selectAutomaticWebpageUrlFromText('两个平台链接 http://xhslink.cn/o/a https://v.douyin.com/b'),
  '',
);
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('本机 http://127.0.0.1:3000/private'), 'http://127.0.0.1:3000/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('本机 http://localhost/private'), 'http://localhost/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('私网 http://192.168.1.2/private'), 'http://192.168.1.2/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('链路本地 http://169.254.1.2/private'), 'http://169.254.1.2/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('文档网段 http://198.51.100.2/private'), 'http://198.51.100.2/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('文档网段 http://203.0.113.2/private'), 'http://203.0.113.2/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('废弃 6to4 中继 http://192.88.99.1/private'), 'http://192.88.99.1/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('IPv6 http://[::1]/private'), 'http://[::1]/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('映射 IPv6 http://[::ffff:127.0.0.1]/private'), 'http://[::ffff:7f00:1]/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('映射 IPv6 十六进制 http://[::ffff:7f00:1]/private'), 'http://[::ffff:7f00:1]/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('映射 IPv6 完整格式 http://[0:0:0:0:0:ffff:7f00:1]/private'), 'http://[::ffff:7f00:1]/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('IPv6 discard-only http://[100::1]/private'), 'http://[100::1]/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('IPv6 benchmarking http://[2001:2::1]/private'), 'http://[2001:2::1]/private');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('凭据 https://user:pass@example.com/private'), '');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('非网页 file:///C:/secret.txt'), '');
assert.strictEqual(helpers.selectAutomaticWebpageUrlFromText('纯文字，不含链接'), '');
assert.strictEqual(helpers.normalizeConfiguredVaultPath('raw\\wechatmd'), 'raw/wechatmd');
assert.strictEqual(helpers.normalizeConfiguredVaultPath('raw//wechatmd/'), 'raw/wechatmd');
assert.strictEqual(helpers.normalizeConfiguredVaultPath('C:\\Users\\ADMIN\\vault'), '临时收集');
assert.strictEqual(helpers.normalizeConfiguredVaultPath('/absolute/path'), '临时收集');
assert.strictEqual(helpers.normalizeConfiguredVaultPath('raw/../secret'), '临时收集');
assert.strictEqual(helpers.mergeSettings({ inboxDir: 'raw\\wechatmd' }).inboxDir, 'raw/wechatmd');
assert.strictEqual(helpers.shouldPersistNormalizedInboxDir({ inboxDir: 'raw\\wechatmd' }, { inboxDir: 'raw/wechatmd' }), true);
assert.strictEqual(helpers.shouldPersistNormalizedInboxDir({ inboxDir: 'raw/wechatmd' }, { inboxDir: 'raw/wechatmd' }), false);
assert.deepStrictEqual(
  helpers.getSafeRedirectRequestHeaders(
    'https://www.xiaohongshu.com/explore/demo',
    'https://evil.example/collect',
    {
      Cookie: 'session=TOP_SECRET',
      Authorization: 'Bearer TOP_SECRET',
      'Proxy-Authorization': 'Basic TOP_SECRET',
      'X-API-Token': 'TOP_SECRET',
      'X-Access-Token': 'TOP_SECRET',
      'X-Security-Token': 'TOP_SECRET',
      'X-Amz-Security-Token': 'TOP_SECRET',
      'X-Session-Token': 'TOP_SECRET',
      Token: 'TOP_SECRET',
      'X-Custom-Credential': 'TOP_SECRET',
      'X-Custom-Signature': 'TOP_SECRET',
      Referer: 'https://www.xiaohongshu.com/',
      'User-Agent': 'test-agent',
      Accept: 'text/html',
      'Accept-Language': 'zh-CN',
    },
  ),
  {
    'User-Agent': 'test-agent',
    Accept: 'text/html',
    'Accept-Language': 'zh-CN',
  },
);
assert.deepStrictEqual(
  helpers.getSafeRedirectRequestHeaders(
    'https://www.xiaohongshu.com/explore/demo',
    'https://www.xiaohongshu.com/explore/final',
    {
      Cookie: 'session=SAME_ORIGIN',
      Authorization: 'Bearer SAME_ORIGIN',
    },
  ),
  {
    Cookie: 'session=SAME_ORIGIN',
    Authorization: 'Bearer SAME_ORIGIN',
  },
);
assert.deepStrictEqual(
  helpers.getSafeRedirectRequestHeaders(
    'https://www.xiaohongshu.com/explore/demo',
    'http://www.xiaohongshu.com/explore/final',
    { Cookie: 'session=HTTPS_DOWNGRADE' },
  ),
  {},
);
assert.strictEqual(helpers.isWechatChannelsUrl('https://weixin.qq.com/sph/A7ULN6a876'), true);
assert.strictEqual(helpers.isWechatChannelsUrl('https://channels.weixin.qq.com/finder-preview/pages/sph?id=A7ULN6a876'), true);
const unavailableWechatChannelsMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'wechat-channels-unavailable',
    type: 'webpage',
    content: 'https://weixin.qq.com/sph/A7ULN6a876',
    createdAt: '2026-07-25T08:00:00.000Z',
    metadata: {
      url: 'https://weixin.qq.com/sph/A7ULN6a876',
      conversionStatus: 'failed',
      conversionError: 'HTML 转 Markdown 失败：网页正文太短，无法转为 Markdown',
    },
  },
  title: '视频号内容',
  syncedAt: '2026-07-25T08:01:00.000Z',
});
assert.ok(unavailableWechatChannelsMarkdown.includes('视频号内容解析功能暂未接通'));
assert.ok(unavailableWechatChannelsMarkdown.includes('当前已为你保存原始链接'));
assert.strictEqual(unavailableWechatChannelsMarkdown.includes('网页正文太短'), false);
assert.ok(unavailableWechatChannelsMarkdown.includes('\nurl: https://weixin.qq.com/sph/A7ULN6a876\n'));
const linkSavedWechatChannelsMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'wechat-channels-link-saved',
    type: 'webpage',
    content: 'https://weixin.qq.com/sph/A7ULN6a876',
    createdAt: '2026-07-25T08:00:00.000Z',
    metadata: {
      url: 'https://weixin.qq.com/sph/A7ULN6a876',
      conversionStatus: 'link_saved',
      transcriptOnly: true,
      markdown: '未能提取视频号口播文案。',
    },
  },
  title: '视频号内容',
  syncedAt: '2026-07-25T08:01:00.000Z',
});
assert.ok(linkSavedWechatChannelsMarkdown.includes('视频号内容解析功能暂未接通'));
assert.strictEqual(linkSavedWechatChannelsMarkdown.includes('未能提取视频号口播文案'), false);
const successfulWechatChannelsMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'wechat-channels-success',
    type: 'webpage',
    content: 'https://weixin.qq.com/sph/A7ULN6a876',
    createdAt: '2026-07-25T08:00:00.000Z',
    metadata: {
      url: 'https://weixin.qq.com/sph/A7ULN6a876',
      conversionStatus: 'success',
      markdown: '视频号已提取正文',
    },
  },
  title: '视频号内容',
  syncedAt: '2026-07-25T08:01:00.000Z',
});
assert.ok(successfulWechatChannelsMarkdown.includes('视频号已提取正文'));
assert.strictEqual(successfulWechatChannelsMarkdown.includes('视频号内容解析功能暂未接通'), false);
const failedGenericWebpageMarkdown = helpers.buildMarkdownForRecord({
  record: {
    _id: 'generic-webpage-failed',
    type: 'webpage',
    content: 'https://example.com/short-page',
    createdAt: '2026-07-25T08:00:00.000Z',
    metadata: {
      url: 'https://example.com/short-page',
      conversionStatus: 'failed',
      conversionError: 'HTML 转 Markdown 失败：网页正文太短，无法转为 Markdown',
    },
  },
  title: '普通网页',
  syncedAt: '2026-07-25T08:01:00.000Z',
});
assert.ok(failedGenericWebpageMarkdown.includes('这篇文章的正文未能自动提取'));
assert.ok(failedGenericWebpageMarkdown.includes('网页正文太短'));
assert.deepStrictEqual(
  helpers.extractWechatChannelsRequestPayload('https://weixin.qq.com/sph/A7ULN6a876'),
  { shortUri: 'A7ULN6a876' },
);
assert.deepStrictEqual(
  helpers.extractWechatChannelsRequestPayload('https://channels.weixin.qq.com/web/pages/feed?eid=export%2Fdemo'),
  { exportId: 'export/demo' },
);
const normalizedChannelsObjectDesc = helpers.normalizeWechatChannelsFeedPayload({
  data: {
    authorInfo: { nickname: '视频号作者' },
    object_desc: {
      description: '发布简介不能作为转写',
      media: [
        {
          url: 'https://finder.video.qq.com/encrypted.mp4',
          decode_key: '210003037022918',
        },
      ],
    },
  },
});
assert.strictEqual(normalizedChannelsObjectDesc.videoUrl, 'https://finder.video.qq.com/encrypted.mp4');
assert.deepStrictEqual(normalizedChannelsObjectDesc.mediaUrls, ['https://finder.video.qq.com/encrypted.mp4']);
assert.strictEqual(normalizedChannelsObjectDesc.decodeKey, '210003037022918');
assert.strictEqual(normalizedChannelsObjectDesc.author, '视频号作者');
const normalizedChannelsNestedObject = helpers.normalizeWechatChannelsFeedPayload({
  data: {
    object: {
      id: 'page-export-id',
      contact: { nickname: '页面作者' },
      objectDesc: {
        description: '页面分享视频',
        media: [
          {
            url: 'https://finder.video.qq.com/251/20302/stodownload?encfilekey=abc123',
            urlToken: '&token=tok456',
            decodeKey: '987654321',
            thumbUrl: 'https://cdn.example.com/page-cover.jpg',
            videoPlayLen: 12,
            fileSize: 1048576,
            videoResolution: '1080p',
          },
        ],
      },
    },
    sceneInfo: { dynamicExportId: 'page-export-id' },
  },
});
assert.strictEqual(
  normalizedChannelsNestedObject.videoUrl,
  'https://finder.video.qq.com/251/20302/stodownload?encfilekey=abc123&token=tok456',
);
assert.deepStrictEqual(normalizedChannelsNestedObject.mediaUrls, [
  'https://finder.video.qq.com/251/20302/stodownload?encfilekey=abc123&token=tok456',
]);
assert.strictEqual(normalizedChannelsNestedObject.decodeKey, '987654321');
assert.strictEqual(normalizedChannelsNestedObject.author, '页面作者');
assert.strictEqual(normalizedChannelsNestedObject.coverUrl, 'https://cdn.example.com/page-cover.jpg');
assert.strictEqual(normalizedChannelsNestedObject.mediaItems[0].decryptKey, '987654321');
assert.strictEqual(normalizedChannelsNestedObject.mediaItems[0].durationSeconds, 12);
assert.strictEqual(typeof helpers.extractWechatChannelsProfilesFromText, 'function');
const extractedWechatChannelsProfiles = helpers.extractWechatChannelsProfilesFromText(JSON.stringify({
  ret: 0,
  data: {
    object: {
      id: 'captured-export-id',
      contact: { nickname: '捕获作者' },
      objectDesc: {
        description: '从登录窗口捕获的视频号对象',
        media: [
          {
            url: 'https://finder.video.qq.com/251/20302/stodownload?encfilekey=captured',
            urlToken: '&token=captured-token',
            decodeKey: '123456789',
          },
        ],
      },
    },
  },
}), 'https://channels.weixin.qq.com/web/pages/feed?eid=captured-export-id');
assert.strictEqual(extractedWechatChannelsProfiles.length, 1);
assert.strictEqual(
  extractedWechatChannelsProfiles[0].mediaItems[0].url,
  'https://finder.video.qq.com/251/20302/stodownload?encfilekey=captured&token=captured-token',
);
assert.strictEqual(extractedWechatChannelsProfiles[0].mediaItems[0].decryptKey, '123456789');
assert.deepStrictEqual(
  helpers.normalizeBrowserCapturedMediaUrls([
    { url: 'https://res.wx.qq.com/open/js/finder-preview.js' },
    { url: 'https://mpvideo.qpic.cn/cover-only/0?dis_k=demo', resourceType: 'image' },
    { url: 'https://finder.video.qq.com/251/20304/stodownload?m=demo&filekey=video.mp4' },
    'https://mpvideo.qpic.cn/0b2eiaaaakiaaaaabcdef/0?dis_k=demo',
    { request: { url: 'https://example.com/cover.jpg' } },
    'https://finder.video.qq.com/251/20304/stodownload?m=demo&filekey=video.mp4',
  ]),
  [
    'https://finder.video.qq.com/251/20304/stodownload?m=demo&filekey=video.mp4',
    'https://mpvideo.qpic.cn/0b2eiaaaakiaaaaabcdef/0?dis_k=demo',
  ],
);
const browserMediaFloodStartedAt = Date.now();
const boundedBrowserMediaFlood = helpers.normalizeBrowserCapturedMediaUrls(
  Array.from({ length: 20000 }, (_item, index) => ({
    url: `https://media.example.com/video-${index}.mp4`,
    resourceType: 'media',
  })),
);
assert.ok(boundedBrowserMediaFlood.length > 0);
assert.ok(
  boundedBrowserMediaFlood.length <= 256,
  `browser media capture must stay bounded, got ${boundedBrowserMediaFlood.length}`,
);
assert.ok(
  Date.now() - browserMediaFloodStartedAt < 2000,
  'browser media capture flood should be processed within the bounded traversal budget',
);
assert.deepStrictEqual(
  helpers.extractSocialMediaUrlsFromHtml(`
    <script>
      window.__finderData = {
        raw: "https:\\/\\/mpvideo.qpic.cn\\/0b2eiaaaakiaaaaabcdef\\/0?dis_k=demo"
      };
    </script>
  `),
  ['https://mpvideo.qpic.cn/0b2eiaaaakiaaaaabcdef/0?dis_k=demo'],
);
assert.strictEqual(helpers.shouldHydrateLinkAsWebpage('https://weixin.qq.com/sph/A7ULN6a876'), false);
assert.strictEqual(typeof helpers.getLocalAsrInstallRoot, 'function');
assert.strictEqual(typeof helpers.getLocalAsrInstallStatus, 'function');
assert.strictEqual(typeof helpers.getLocalAsrScriptVersionStatus, 'function');
assert.strictEqual(typeof helpers.explainLocalAsrExitCode, 'function');
assert.ok(
  helpers.explainLocalAsrExitCode('whisper exited -1073741795/0xC000001D').includes('兼容版本'),
);
assert.strictEqual(typeof helpers.buildLocalAsrInstallCommand, 'function');
assert.strictEqual(typeof helpers.downloadTextViaNode, 'function');
assert.strictEqual(typeof helpers.normalizeInstallerScriptText, 'function');
assert.strictEqual(
  helpers.normalizeInstallerScriptText('#!/bin/bash\r\nset -euo pipefail\r\necho ok\r\n', true),
  '#!/bin/bash\nset -euo pipefail\necho ok\n',
);
assert.strictEqual(
  helpers.normalizeInstallerScriptText('\uFEFF#!/bin/bash\r\nset -euo pipefail\r', true),
  '#!/bin/bash\nset -euo pipefail\n',
);
assert.strictEqual(
  helpers.normalizeInstallerScriptText('param()\r\nWrite-Host ok\r\n', false),
  'param()\r\nWrite-Host ok\r\n',
);
assert.strictEqual(helpers.LOCAL_TRANSCRIPTION_PLAN, 'local_transcription_beta');
assert.strictEqual(
  helpers.LOCAL_ASR_INSTALLER_URL,
  'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr.ps1',
);
assert.strictEqual(
  helpers.LOCAL_ASR_MACOS_INSTALLER_URL,
  'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr-macos.sh',
);
assert.strictEqual(
  helpers.LOCAL_OCR_INSTALLER_URL,
  `https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-components/by-sha256/${helpers.LOCAL_OCR_WINDOWS_INSTALLER_SHA256}/install-local-ocr.ps1`,
);
assert.strictEqual(
  helpers.LOCAL_OCR_MACOS_INSTALLER_URL,
  `https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-components/by-sha256/${helpers.LOCAL_OCR_MACOS_INSTALLER_SHA256}/install-local-ocr-macos.sh`,
);
assert.ok(pluginMainSource.includes('getAvailableLocalAsrInstallerPath'));
assert.ok(pluginMainSource.includes('getAvailableLocalOcrInstallerPath'));
assert.ok(pluginMainSource.includes('he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr.ps1'));
assert.ok(pluginMainSource.includes('he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr-macos.sh'));
assert.ok(pluginMainSource.includes('LOCAL_OCR_WINDOWS_INSTALLER_SHA256'));
assert.ok(pluginMainSource.includes('LOCAL_OCR_MACOS_INSTALLER_SHA256'));
assert.ok(pluginMainSource.includes('isTrustedLocalOcrInstallerSource(scriptText, installerSha256, isMac)'));
assert.ok(pluginMainSource.includes('isTrustedLocalOcrInstallerSource(bundledScriptText, installerSha256, isMac)'));
assert.ok(pluginMainSource.includes("const OFFICIAL_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';"));
assert.ok(pluginMainSource.includes("const FEISHU_OAUTH_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync';"));
assert.ok(pluginMainSource.includes('const feishuCallbackUrl = `${trimTrailingSlash(FEISHU_OAUTH_SYNC_API_BASE)}/feishu/oauth/callback`;'));
assert.ok(pluginMainSource.includes("'X-Wechat-Inbox-Token': token"));
assert.strictEqual(pluginMainSource.includes('authToken=${encodeURIComponent(token)}'), false);
assert.strictEqual(pluginMainSource.includes('authToken: token'), false);
assert.ok(pluginMainSource.includes('installerUrl}?t=${Date.now()}'));
assert.ok(pluginMainSource.includes('copyBundledLocalOcrRuntimeAssets'));
assert.strictEqual(pluginMainSource.includes("source.includes('PyMuPDF')"), false, 'image OCR installer validation must not require PDF dependencies');
assert.strictEqual(pluginMainSource.includes("source.includes('opencc-python-reimplemented')"), false, 'image OCR installer validation must not require OpenCC');
assert.ok(pluginMainSource.includes("fs.copyFileSync(sourcePath, targetPath)"));
assert.ok(macOcrInstallerSource.includes('find_existing_python'));
assert.ok(macOcrInstallerSource.includes('.wechat-inbox-local-asr/python-venv/bin/python'));
assert.ok(macOcrInstallerSource.includes('download_with_retry'));
assert.ok(macOcrInstallerSource.includes('--retry-all-errors'));
assert.ok(macOcrInstallerSource.includes('--silent --show-error'));
const localOcrInstallerValidatorSource = pluginMainSource.slice(
  pluginMainSource.indexOf('function isLocalOcrInstallerCurrent'),
  pluginMainSource.indexOf('function createRetryableTranscriptionError'),
);
assert.ok(localOcrInstallerValidatorSource.includes("source.includes('function Install-PortablePython')"));
assert.ok(localOcrInstallerValidatorSource.includes("source.includes('$PythonBuildStandaloneBuild = \"20260623\"')"));
assert.ok(localOcrInstallerValidatorSource.includes("source.includes('single-dir-transaction-v1')"));
assert.ok(localOcrInstallerValidatorSource.includes("source.includes('function Expand-TarGzArchiveWithPowerShell')"));
assert.ok(localOcrInstallerValidatorSource.includes("source.includes('install_portable_python')"));
assert.ok(localOcrInstallerValidatorSource.includes("source.includes('PYTHON_BUILD_STANDALONE_BUILD=\"20260623\"')"));
assert.strictEqual(localOcrInstallerValidatorSource.includes('Install-Uv'), false);
assert.strictEqual(localOcrInstallerValidatorSource.includes('UV_PYTHON_DOWNLOADS'), false);
assert.ok(pluginMainSource.includes("source.includes('CHUNK_SECONDS=120')"));
assert.ok(pluginMainSource.includes("source.includes('choose_chunk_seconds')"));
assert.ok(pluginMainSource.includes("source.includes('metalAcceleration=failed')"));
assert.ok(pluginMainSource.includes("source.includes('GGML_METAL_PATH_RESOURCES')"));
assert.ok(pluginMainSource.includes("source.includes('validate_local_asr_inference')"));
assert.ok(pluginMainSource.includes("source.includes('TENCENT_MODEL_URL=')"));
assert.ok(pluginMainSource.includes("source.includes('bootstrap_uv')"));
assert.ok(pluginMainSource.includes("source.includes('detect_uv_arch')"));
assert.ok(pluginMainSource.includes("source.includes('setup_python_and_packages')"));
assert.ok(pluginMainSource.includes("source.includes('[string]$InstallRoot')"));
assert.ok(pluginMainSource.includes("source.includes('safeModelPath')"));
assert.ok(pluginMainSource.includes("source.includes('$TencentCosAssetBaseUrl')"));
assert.ok(pluginMainSource.includes("source.includes('$WhisperWindowsTencentUrls')"));
assert.ok(pluginMainSource.includes("source.includes('$FfmpegTencentUrls')"));
assert.ok(pluginMainSource.includes("source.includes('$ModelTencentUrls')"));
assert.ok(pluginMainSource.includes("source.includes('Get-EnabledAssetUrls')"));
assert.ok(pluginMainSource.includes("source.includes('$WhisperWindowsFallbackUrls')"));
assert.ok(pluginMainSource.includes("source.includes('GitHub release page parsing failed')"));
assert.ok(pluginMainSource.includes("source.includes('INSTALLER FAILED')"));
assert.ok(pluginMainSource.includes('LOCAL_ASR_INSTALL_TIMEOUT_MS'));
assert.ok(pluginMainSource.includes('本地转写组件安装超时'));
assert.ok(pluginMainSource.includes('安装超过 20 分钟'));
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
assert.strictEqual(helpers.mergeSettings({ settingsVersion: 2, aiMetadataEnabled: false }).aiMetadataEnabled, true);
assert.strictEqual(helpers.mergeSettings({}).xiaohongshuCommentsEnabled, true);
assert.strictEqual(helpers.mergeSettings({ xiaohongshuCommentsEnabled: false }).xiaohongshuCommentsEnabled, true);
assert.strictEqual(helpers.mergeSettings({ settingsVersion: 2, xiaohongshuCommentsEnabled: false }).xiaohongshuCommentsEnabled, false);
assert.strictEqual(helpers.mergeSettings({}).xiaohongshuImageOcrEnabled, true);
assert.strictEqual(helpers.mergeSettings({ settingsVersion: 2, xiaohongshuImageOcrEnabled: false }).xiaohongshuImageOcrEnabled, true);
assert.strictEqual(
  helpers.hasXiaohongshuLoginCookies([
    { name: 'a1', value: 'browser-device-cookie' },
    { name: 'gid', value: 'guest-id' },
    { name: 'webId', value: 'anonymous-web-id' },
    { name: 'xsecappid', value: 'xhs-pc-web' },
  ]),
  false,
);
assert.strictEqual(
  helpers.hasXiaohongshuLoginCookies([
    { name: 'web_session', value: '0123456789abcdef0123456789abcdef' },
  ]),
  true,
);
assert.strictEqual(
  helpers.hasXiaohongshuLoginCookies([
    { name: 'web_session', value: '' },
  ]),
  false,
);
{
  const restoredFromPendingBindCode = helpers.mergeSettings({
    token: '',
    pendingBindCode: 'TT7-7L6',
    pendingRedeemCode: 'OBPROT93C6',
    bindings: [],
  });
  assert.strictEqual(restoredFromPendingBindCode.token, 'TT7-7L6');
  assert.strictEqual(restoredFromPendingBindCode.pendingBindCode, '');
  assert.strictEqual(restoredFromPendingBindCode.pendingRedeemCode, 'OBPROT93C6');
  assert.strictEqual(restoredFromPendingBindCode.bindings.length, 1);
  assert.strictEqual(restoredFromPendingBindCode.bindings[0].token, 'TT7-7L6');
}
{
  const draftBinding = helpers.mergeSettings({
    settingsVersion: 2,
    token: '',
    pendingBindCode: 'OBPROT93C6',
    bindings: [],
  });
  assert.strictEqual(draftBinding.token, '');
  assert.strictEqual(draftBinding.pendingBindCode, 'OBPROT93C6');
  assert.deepStrictEqual(draftBinding.bindings, []);
}
assert.strictEqual(helpers.mergeSettings({
  pendingRedeemCode: 'OBPROT93C6',
  localTranscriptionEntitlementStatus: {
    hasAccess: false,
    status: 'invalid_redeem_code',
    code: 'OBPROT93C6',
    bindingToken: 'OLD-123',
    bindingLabel: '微信 1',
    message: 'collection.get:fail -501001 resource system error. [100003] Env Not Exists (85ab9ac4-006f-4935-918d-e2c97ac3828e) INVALID_ENV',
  },
}).localTranscriptionEntitlementStatus, null);
{
  const restored = helpers.mergeSettings({
    token: '',
    pendingRedeemCode: '',
    bindings: [],
    localTranscriptionEntitlementStatus: {
      hasAccess: false,
      status: 'invalid_redeem_code',
      code: 'OBPROT93C6',
      bindingToken: 'OLD-123',
      bindingLabel: '微信 1',
      message: 'collection.get:fail -501001 resource system error. [100003] Env Not Exists INVALID_ENV',
    },
  });
  assert.strictEqual(restored.localTranscriptionEntitlementStatus, null);
  assert.strictEqual(restored.token, 'OLD-123');
  assert.strictEqual(restored.pendingRedeemCode, 'OBPROT93C6');
  assert.strictEqual(restored.bindings.length, 1);
  assert.strictEqual(restored.bindings[0].token, 'OLD-123');
}
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
assert.ok(pluginMainSource.includes(".setName('输入绑定码')"));
assert.strictEqual(pluginMainSource.includes(".setName('立即绑定')"), false);
assert.ok(pluginMainSource.includes(".setButtonText(primaryBinding ? '绑定成功' : '立即绑定')"));
assert.strictEqual(pluginMainSource.includes('基础绑定微信'), false);
assert.strictEqual(pluginMainSource.includes('renderBindingSetting(containerEl, primaryBinding'), false);
assert.ok(pluginMainSource.includes('基础绑定区只保留 1 个小程序绑定码'));
assert.ok(pluginMainSource.includes("text: '额外绑定设备'"));
assert.ok(pluginMainSource.includes(".setName('绑定额外设备')"));
assert.ok(pluginMainSource.includes("ensureProFeatureAccess('额外绑定设备')"));
assert.ok(pluginMainSource.includes("new Setting(proPanel)\n      .setName('保存原始音视频到本地')"));
assert.ok(pluginMainSource.includes('Pro 功能。默认关闭；开启后，新同步且可下载的音频或视频会保存到'));
assert.ok(pluginMainSource.includes("cleanTrailingTranscriptionHallucinations(String(outputText || '').trim())"));
assert.strictEqual(pluginMainSource.includes("text: '已绑定小程序码'"), false);
assert.strictEqual(pluginMainSource.includes(".setName('新增绑定码')"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('新增绑定码')"), false);
assert.ok(pluginMainSource.includes("text: '使用教程'"));
assert.ok(pluginMainSource.includes("text: '绑定小程序'"));
assert.strictEqual(pluginMainSource.includes("text: 'Pro 本地转写功能'"), false);
assert.ok(pluginMainSource.includes("text: 'Pro 高级功能'"));
assert.ok(pluginMainSource.includes("text: 'Pro 状态'"));
assert.strictEqual(pluginMainSource.includes("text: 'Pro 高级选项'"), false);
assert.strictEqual(pluginMainSource.includes("text: '兑换码与权限状态'"), false);
assert.ok(pluginMainSource.includes("autoRedeemProCode"));
assert.ok(pluginMainSource.includes("/entitlements/auto-redeem"));
assert.ok(pluginMainSource.includes('refreshProAndMaybePromptLocalComponentInstall'));
assert.ok(pluginMainSource.includes('installLocalTranscriptionComponents'));
assert.ok(pluginMainSource.includes('confirmLocalComponentInstall'));
assert.ok(pluginMainSource.includes("createEl('button', { text: '稍后再试' })"));
assert.ok(pluginMainSource.includes('ensureLocalComponentReadyForUse'));
assert.ok(pluginMainSource.includes('PRO_SETUP_CHECK_INTERVAL_MS'));
assert.ok(pluginMainSource.includes('PRO_SETUP_PROMPT_COOLDOWN_MS'));
assert.ok(pluginMainSource.includes("reason: 'bind'"));
assert.ok(pluginMainSource.includes("reason: 'settings-open'"));
assert.ok(pluginMainSource.includes("reason: 'first-use'"));
assert.ok(pluginMainSource.includes('pendingRedeemCode'));
assert.ok(pluginMainSource.includes('formatRedeemAccessError'));
assert.strictEqual(pluginMainSource.includes(".setName('输入兑换码')"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('自动识别')"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('兑换并刷新')"), false);
assert.ok(pluginMainSource.includes('兑换码：'));
assert.ok(pluginMainSource.includes("createEl('details'"));
assert.strictEqual(pluginMainSource.includes("text: 'AI 简介与关键词'"), false);
assert.strictEqual(pluginMainSource.includes(".setName('启用 AI 简介与关键词')"), false);
assert.ok(pluginMainSource.includes('AI 简介与关键词自动生成：已默认开启'));
assert.strictEqual(pluginMainSource.includes(".setName('启用小红书图片 OCR')"), false);
assert.ok(pluginMainSource.includes('小红书图文 OCR：已默认开启'));
assert.ok(pluginMainSource.includes('const isXiaohongshuVideoNote = Boolean(extractedXiaohongshu.videoUrl || mediaUrl);'));
assert.ok(pluginMainSource.includes('if (xiaohongshuCapabilities.imageOcr && !isXiaohongshuVideoNote) {'));
assert.strictEqual(pluginMainSource.includes('图片文字识别组件安装（测试版）'), false);
assert.strictEqual(pluginMainSource.includes('图片文字识别 OCR 模块'), false);
assert.ok(pluginMainSource.includes('getLocalOcrInstallStatus'));
assert.ok(pluginMainSource.includes('runLocalImageOcr'));
assert.ok(pluginMainSource.includes('install-local-ocr.ps1'));
assert.ok(pluginMainSource.includes('install-local-ocr-macos.sh'));
assert.strictEqual(pluginMainSource.includes("requestJson('/ocr/images'"), false);
assert.strictEqual(pluginMainSource.includes('!settings.aiMetadataEnabled'), false);
assert.strictEqual(pluginMainSource.includes(".setName('DeepSeek API Key')"), false);
assert.strictEqual(pluginMainSource.includes(".setName('测试 AI 连接')"), false);
assert.strictEqual(pluginMainSource.includes("text: '公众号评论区提取（实验性）'"), false);
assert.strictEqual(pluginMainSource.includes(".setName('笔记属性字段')"), false);
assert.ok(pluginMainSource.includes("text: '登录设置'"));
assert.ok(pluginMainSource.includes("text: '连接飞书文档'"));
assert.ok(pluginMainSource.includes('feishuPanel.open = true'));
assert.ok(pluginMainSource.includes('未连接飞书官方 API 时仍会使用旧解析方式转存飞书链接'));
assert.ok(pluginMainSource.includes('FEISHU_OFFICIAL_API_TUTORIAL_URL'));
assert.ok(pluginMainSource.includes("this.renderFeishuSettings(containerEl);"));
assert.strictEqual(pluginMainSource.includes('飞书官方 API 未连接，请先在插件设置里连接飞书后再同步飞书文档。'), false);
assert.ok(pluginMainSource.includes('连接飞书官方 API'));
assert.ok(pluginMainSource.includes("setButtonText(feishuOAuthStatus.connected ? '重新连接' : '连接飞书')"));
assert.strictEqual(pluginMainSource.includes(".setName('登录飞书')"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('打开飞书登录')"), false);
assert.strictEqual(pluginMainSource.includes('插件会优先尝试无登录提取'), false);
assert.strictEqual(pluginMainSource.includes('飞书官方 API 实验通道'), false);
assert.ok(pluginMainSource.includes('飞书 App ID'));
assert.ok(pluginMainSource.includes('飞书 App Secret'));
assert.strictEqual(pluginMainSource.includes('this.settings.feishuOpenApiEnabled && this.settings.feishuAppId'), false);
assert.ok(pluginMainSource.includes('getFeishuCustomAppConfig'));
assert.ok(pluginMainSource.includes('withFeishuCustomAppConfig'));
assert.strictEqual(pluginMainSource.includes("text: 'Feishu link extraction'"), false);
assert.strictEqual(pluginMainSource.includes(".setName('Feishu web login')"), false);
assert.strictEqual(pluginMainSource.includes(".setButtonText('Login Feishu')"), false);
assert.ok(pluginMainSource.includes("text: 'Pro 高级功能'"));
assert.ok(pluginMainSource.includes("text: 'Pro 状态'"));
assert.ok(pluginMainSource.includes("text: '登录小红书评论区'"));
assert.strictEqual(pluginMainSource.includes(".setName('提取小红书评论区')"), false);
assert.ok(pluginMainSource.includes('renderXiaohongshuCommentsWithElectron'));
assert.ok(pluginMainSource.includes('renderXiaohongshuPageWithElectron'));
assert.ok(pluginMainSource.includes('appendSocialCommentsToMarkdown'));
assert.ok(pluginMainSource.includes('renderedXiaohongshuComments'));
assert.strictEqual(pluginMainSource.includes('renderedXiaohongshuExtraction'), false);
assert.ok(pluginMainSource.includes('fetchXiaohongshuCommentsFromCapturedRequests'));
assert.ok(pluginMainSource.includes('Network.getResponseBody'));
assert.ok(pluginMainSource.includes('debuggerComments'));
assert.ok(pluginMainSource.includes('staticXiaohongshuComments'));
assert.ok(pluginMainSource.includes('mergeSocialComments'));
assert.ok(pluginMainSource.includes('commentApiRequests'));
assert.ok(pluginMainSource.includes('onBeforeSendHeaders'));
assert.ok(pluginMainSource.includes('const XIAOHONGSHU_SESSION_PARTITION'));
assert.ok(pluginMainSource.includes('function getXiaohongshuSession'));
assert.ok(pluginMainSource.includes('async function probeXiaohongshuLoginStatus'));
assert.ok(pluginMainSource.includes('resolve(await probeXiaohongshuLoginStatus(loginUrl));'));
assert.ok(pluginMainSource.includes('return await probeXiaohongshuLoginStatus();'));
assert.strictEqual(pluginMainSource.includes("text: '视频号转写实验'"), false);
assert.strictEqual(pluginMainSource.includes("id: 'open-wechat-channels-listener'"), false);
assert.strictEqual(pluginMainSource.includes("text: '音视频转写组件安装'"), false);
assert.strictEqual(pluginMainSource.includes("text: '本地转写组件'"), false);
assert.strictEqual(pluginMainSource.includes(".setName('手动安装 / 修复本地组件')"), false);
assert.strictEqual(pluginMainSource.includes('const localAsrPanel = containerEl.createEl'), false);
assert.strictEqual(pluginMainSource.includes('runLocalAsrButtonTask(button'), false);
assert.strictEqual(pluginMainSource.includes('button.setButtonText(runningText)'), false);
assert.strictEqual(pluginMainSource.includes('button.setButtonText(originalText)'), false);
assert.ok(pluginMainSource.includes('本地转写组件：'));
assert.ok(pluginMainSource.includes('wechat-inbox-sync-section-spacer'));
assert.ok(pluginMainSource.indexOf("text: '使用教程'") < pluginMainSource.indexOf("text: '绑定小程序'"));
assert.ok(pluginMainSource.indexOf("text: '绑定小程序'") < pluginMainSource.indexOf("text: '登录设置'"));
assert.ok(pluginMainSource.indexOf("text: '登录设置'") < pluginMainSource.indexOf("text: 'Pro 高级功能'"));
assert.strictEqual(pluginMainSource.includes('本地转写系统'), false);
assert.strictEqual(pluginMainSource.includes('如果苹果电脑安装失败，请手动选择 macOS'), false);
assert.ok(pluginMainSource.includes('install.log'));
assert.ok(pluginMainSource.includes('复制诊断信息'));
assert.ok(pluginMainSource.includes('getLocalAsrDiagnosticText'));
assert.ok(pluginMainSource.includes('showSyncProgress'));
assert.ok(pluginMainSource.includes('syncStatusBar'));
assert.ok(pluginMainSource.includes('setText(message)'));
assert.ok(pluginMainSource.includes('lastSyncDiagnostic'));
assert.ok(pluginMainSource.includes("setButtonText('复制诊断信息')"));
assert.strictEqual(pluginMainSource.includes("setButtonText('复制同步诊断')"), false);
assert.ok(pluginMainSource.includes('同步/安装失败诊断'));
assert.strictEqual(pluginMainSource.includes(".setName('同步失败诊断')"), false);
assert.ok(pluginMainSource.includes('发给开发者张张（微信：heyhmjx）'));
assert.ok(pluginMainSource.includes('本地转写组件安装失败'));
assert.ok(pluginMainSource.includes('如需协助，请点击插件设置里的「复制诊断信息」'));
assert.strictEqual(
  helpers.formatLocalComponentInstallFailureReason([
    '% Total % Received % Xferd Average Speed Time Time Time Current',
    'Dload Upload Total Spent Left Speed',
    '0 0 0 0 0 0 0 --:--:-- --:--:-- --:--:-- 0',
    'curl: (35) Recv failure: Connection reset by peer',
  ].join('\n')),
  'curl: (35) Recv failure: Connection reset by peer',
);
assert.ok(pluginMainSource.includes("setButtonText('检测登录状态')"));
assert.ok(pluginMainSource.includes('小红书登录状态正常'));
assert.ok(pluginMainSource.includes('未检测到小红书登录状态'));
assert.ok(pluginMainSource.includes('飞书连接状态已刷新：已连接'));
assert.ok(pluginMainSource.includes('飞书连接状态已刷新：未连接或已过期'));
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
assert.strictEqual(helpers.getSocialRequestHeaders('https://v3-dy-o.zjcdn.com/tos-cn-ve-15/demo-video?mime_type=video_mp4').Referer, 'https://www.douyin.com/');
assert.strictEqual(helpers.getSocialRequestHeaders('https://mpvideo.qpic.cn/0b2eiaaaakiaaaaabcdef/0?dis_k=demo').Referer, 'https://channels.weixin.qq.com/');
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
      <p>搜索</p>
      <p>墨度</p>
      <p>莞尔</p>
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
assert.strictEqual(feishuCleanMarkdown.includes('搜索'), false);
assert.strictEqual(feishuCleanMarkdown.includes('墨度'), false);
assert.strictEqual(feishuCleanMarkdown.includes('莞尔'), false);
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
  block_sequence: ['root', 'heading-block', 'paragraph-block', 'table-block', 'image-block', 'video-block', 'bullet-block'],
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
    'video-block': {
      id: 'video-block',
      data: {
        type: 'file',
        name: '演示视频.mp4',
        file: { download_url: 'https://example.com/feishu-demo.mp4' },
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
assert.ok(feishuClientVarsMarkdown.includes('[演示视频.mp4](https://example.com/feishu-demo.mp4)'));
assert.ok(feishuClientVarsMarkdown.includes('- 列表项目'));
const feishuClientVarsTreeMarkdown = helpers.extractFeishuMarkdownFromClientVars({
  id: 'root',
  block_sequence: ['root', 'heading-block', 'visible-paragraph'],
  block_map: {
    root: { id: 'root', data: { type: 'page', children: ['heading-block'] } },
    'heading-block': {
      id: 'heading-block',
      data: {
        type: 'heading1',
        children: ['visible-paragraph', 'late-paragraph'],
        text: { initialAttributedTexts: { text: { 0: '飞书树形标题' } } },
      },
    },
    'visible-paragraph': {
      id: 'visible-paragraph',
      data: {
        type: 'text',
        text: { initialAttributedTexts: { text: { 0: 'block_sequence 里的正文' } } },
      },
    },
    'late-paragraph': {
      id: 'late-paragraph',
      data: {
        type: 'text',
        text: { initialAttributedTexts: { text: { 0: '只存在于 children 的后续正文' } } },
      },
    },
  },
});
assert.ok(feishuClientVarsTreeMarkdown.includes('# 飞书树形标题'));
assert.ok(feishuClientVarsTreeMarkdown.includes('block_sequence 里的正文'));
assert.ok(feishuClientVarsTreeMarkdown.includes('只存在于 children 的后续正文'));
assert.deepStrictEqual(
  helpers.extractFeishuOpenApiUrlInfo('https://fv2fbshiww0.feishu.cn/wiki/KTQtw8R56igHE7kkKwHcoTBun9e?from=from_copylink'),
  {
    apiBase: 'https://open.feishu.cn/open-apis',
    kind: 'wiki',
    token: 'KTQtw8R56igHE7kkKwHcoTBun9e',
  },
);
assert.deepStrictEqual(
  helpers.extractFeishuOpenApiUrlInfo('https://example.larksuite.com/docx/DOCXtoken123'),
  {
    apiBase: 'https://open.larksuite.com/open-apis',
    kind: 'docx',
    token: 'DOCXtoken123',
  },
);
const feishuOpenApiBlocksMarkdown = helpers.extractFeishuMarkdownFromOpenApiBlocks([
  { block_id: 'page', block_type: 1, children: ['h1', 'p1', 'table1', 'img1', 'code1'] },
  {
    block_id: 'h1',
    block_type: 3,
    heading1: { elements: [{ text_run: { content: '官方 API 一级标题' } }] },
  },
  {
    block_id: 'p1',
    block_type: 2,
    text: { elements: [{ text_run: { content: '官方 API 分页正文第一段' } }] },
  },
  {
    block_id: 'table1',
    block_type: 31,
    table: { property: { row_size: 2, column_size: 2 }, cells: ['cell1', 'cell2', 'cell3', 'cell4'] },
  },
  { block_id: 'cell1', block_type: 32, children: ['cell1-text'] },
  { block_id: 'cell1-text', block_type: 2, text: { elements: [{ text_run: { content: '组件' } }] } },
  { block_id: 'cell2', block_type: 32, children: ['cell2-text'] },
  { block_id: 'cell2-text', block_type: 2, text: { elements: [{ text_run: { content: '说明' } }] } },
  { block_id: 'cell3', block_type: 32, children: ['cell3-text'] },
  { block_id: 'cell3-text', block_type: 2, text: { elements: [{ text_run: { content: 'Remotion' } }] } },
  { block_id: 'cell4', block_type: 32, children: ['cell4-text'] },
  { block_id: 'cell4-text', block_type: 2, text: { elements: [{ text_run: { content: '视频生成' } }] } },
  { block_id: 'img1', block_type: 27, image: { token: 'boxcnImageToken' } },
  {
    block_id: 'code1',
    block_type: 14,
    code: { elements: [{ text_run: { content: 'npm install\nnpm run dev' } }] },
  },
]);
assert.ok(feishuOpenApiBlocksMarkdown.includes('# 官方 API 一级标题'));
assert.ok(feishuOpenApiBlocksMarkdown.includes('官方 API 分页正文第一段'));
assert.ok(feishuOpenApiBlocksMarkdown.includes('| 组件 | 说明 |'));
assert.ok(feishuOpenApiBlocksMarkdown.includes('| Remotion | 视频生成 |'));
assert.ok(feishuOpenApiBlocksMarkdown.includes('![图片](feishu-image:boxcnImageToken)'));
assert.ok(feishuOpenApiBlocksMarkdown.includes('```'));
assert.ok(feishuOpenApiBlocksMarkdown.includes('npm install\nnpm run dev'));
const feishuMergedMarkdown = helpers.mergeFeishuRenderedAndClientVarsMarkdown([
  '# 飞书云文档',
  '',
  '搜索',
  '',
  '墨度',
  '',
  '![头像](blob:https://feishu.example/avatar)',
  '',
  '- 飞书新版标题 - 一级目录 - 二级目录 - 三级目录',
  '',
  '上传日志',
  '',
  '联系客服',
  '',
  '这是一大段渲染出来的网页壳内容，长度比结构化正文更长，但不应该被优先使用。',
].join('\n'), [
  '# 飞书新版标题',
  '',
  '正文第一段',
  '',
  '## 一级目录',
  '',
  '### 二级目录',
].join('\n'));
assert.ok(feishuMergedMarkdown.startsWith('# 飞书新版标题'));
assert.ok(feishuMergedMarkdown.includes('## 一级目录'));
assert.ok(feishuMergedMarkdown.includes('### 二级目录'));
assert.strictEqual(feishuMergedMarkdown.includes('上传日志'), false);
assert.strictEqual(feishuMergedMarkdown.includes('联系客服'), false);
assert.strictEqual(feishuMergedMarkdown.includes('墨度'), false);
const feishuRenderedWinsWhenStructuredIsIncomplete = helpers.mergeFeishuRenderedAndClientVarsMarkdown([
  '# 飞书云文档',
  '',
  '搜索',
  '',
  '![头像](https://s1-imfile.feishucdn.com/static-resource/v1/avatar.png)',
  '',
  '# 读完这篇，你能做到什么',
  '',
  '一套属于自己的声音克隆',
  '',
  '一个能跑通的 Remotion 项目',
  '',
  '![成果截图](https://s1-imfile.feishucdn.com/static-resource/v1/remotion-result.png)',
  '',
  '## 3.0 整体流程图',
  '',
  '文案 -> 文案审查 -> 语句划分 -> 语音克隆 -> 音频时长核定 -> 画面规划 -> Remotion 画面 -> 渲染成片。这一段代表隐藏浏览器读到的真实长正文，不能被 client_vars 里的短占位文件名截断。',
  '',
  '联系客服',
].join('\n'), [
  '# 读完这篇，你能做到什么',
  '',
  'b6b20254ef3cf62a0f8e6009f59dcc08.jpg',
  '',
  'REMOITON做视频.mp4',
].join('\n'));
assert.ok(feishuRenderedWinsWhenStructuredIsIncomplete.includes('一个能跑通的 Remotion 项目'));
assert.ok(feishuRenderedWinsWhenStructuredIsIncomplete.includes('## 3.0 整体流程图'));
assert.ok(feishuRenderedWinsWhenStructuredIsIncomplete.includes('真实长正文，不能被 client_vars'));
assert.ok(feishuRenderedWinsWhenStructuredIsIncomplete.includes('![成果截图](https://s1-imfile.feishucdn.com/static-resource/v1/remotion-result.png)'));
assert.strictEqual(feishuRenderedWinsWhenStructuredIsIncomplete.includes('avatar.png'), false);
assert.strictEqual(feishuRenderedWinsWhenStructuredIsIncomplete.includes('联系客服'), false);
assert.strictEqual(helpers.shouldRefreshFeishuMarkdownFromSource(
  'https://fv2fbshiww0.feishu.cn/wiki/KTQtw8R56igHE7kkKwHcoTBun9e',
  {
    markdown: [
      '# 飞书标题',
      '',
      'b6b20254ef3cf62a0f8e6009f59dcc08.jpg',
      '',
      'REMOITON做视频.mp4',
      '',
      'CUDA Toolkit',
    ].join('\n'),
  },
), true);
assert.strictEqual(helpers.shouldRefreshFeishuMarkdownFromSource(
  'https://fv2fbshiww0.feishu.cn/wiki/KTQtw8R56igHE7kkKwHcoTBun9e',
  {
    markdown: [
      '# 飞书标题',
      '',
      '![成果截图](https://s1-imfile.feishucdn.com/static-resource/v1/remotion-result.png)',
      '',
      '[演示视频.mp4](https://example.com/feishu-demo.mp4)',
      '',
      '这是一段已经包含真实图片和视频链接的飞书正文，不需要重新提取。',
    ].join('\n'),
  },
), false);
const cleanedFeishuRenderedMarkdown = helpers.cleanMarkdownForStorage([
  '# 飞书云文档',
  '',
  '蟹',
  '',
  '蟹老板-老王1的云文档',
  '',
  '星辰大海蟹老板-老王1REMOTION制作AI视频，深度经验分享',
  '',
  '- REMOTION制作AI视频，深度经验分享',
  '- 读完这篇，你能做到什么',
  '',
  '蟹老板-老王1',
  '',
  '6月27日修改',
  '',
  '😀',
  '',
  '一套属于自己的声音克隆',
  '',
  '一、成果',
  '',
  '1.1 我的数据：2个月、1000万播放、5万粉丝',
  '',
  '61%',
  '',
  '- 一、成果',
  '- 1.1 我的数据：2个月、1000万播放、5万粉丝',
  '- 1.2 不是我一个人的想法',
  '- 二、Remotion能做什么：',
  '- 三、实战教学：从0到出片',
  '',
  '重播',
  '',
  '播放',
  '',
  '00:00',
  '/',
  '直播',
  '进入全屏',
  '画中画',
  '1080p',
  '- 360p',
  '- 1080p',
  '- 原画',
  '1x',
  '- 2x',
  '- 1.5x',
  '- 1x',
  '- 0.75x',
  '- 0.5x',
  '点击按住可拖动视频',
  '',
  '3.11remotion安装',
  '',
  'Bash',
  '',
  '# 创建项目（如果还没有的话）',
  '',
  'npx create-video@latest',
  '',
  '|',
  '组件',
  '|',
  '要求',
  '说明',
  '| --- | --- | --- |',
  'CPU',
  '4核以上',
  '渲染视频时 CPU 占用高',
  '内存',
  '8GB以上',
  'Remotion 渲染',
].join('\n'), {
  dedupe: true,
  feishuTitle: 'REMOTION制作AI视频，深度经验分享',
});
assert.ok(cleanedFeishuRenderedMarkdown.includes('# 读完这篇，你能做到什么'));
assert.ok(cleanedFeishuRenderedMarkdown.includes('# 一、成果'));
assert.ok(cleanedFeishuRenderedMarkdown.includes('## 1.1 我的数据：2个月、1000万播放、5万粉丝'));
assert.ok(cleanedFeishuRenderedMarkdown.includes('### 3.11remotion安装'));
assert.ok(cleanedFeishuRenderedMarkdown.includes('| 组件 | 要求 | 说明 |'));
assert.ok(cleanedFeishuRenderedMarkdown.includes('| CPU | 4核以上 | 渲染视频时 CPU 占用高 |'));
assert.strictEqual(cleanedFeishuRenderedMarkdown.includes('蟹老板'), false);
assert.strictEqual(cleanedFeishuRenderedMarkdown.includes('飞书云文档'), false);
assert.strictEqual(cleanedFeishuRenderedMarkdown.includes('6月27日修改'), false);
assert.strictEqual(cleanedFeishuRenderedMarkdown.includes('- 一、成果'), false);
assert.strictEqual(cleanedFeishuRenderedMarkdown.includes('重播'), false);
assert.strictEqual(cleanedFeishuRenderedMarkdown.includes('点击按住可拖动视频'), false);
assert.strictEqual(cleanedFeishuRenderedMarkdown.includes('61%'), false);
const cleanedFeishuCodeBlockMarkdown = helpers.cleanMarkdownForStorage([
  '### 3.11remotion安装',
  '',
  'Bash',
  '',
  '# 创建项目（如果还没有的话）',
  '',
  'npx create-video@latest',
  '',
  '# 或者克隆已有项目后安装依赖',
  '',
  'cd remotion-studio',
  'npm install',
  '',
  '安装完成后启动开发环境：',
  '',
  'npm start',
].join('\n'), {
  dedupe: true,
  feishuTitle: 'REMOTION制作AI视频，深度经验分享',
});
assert.ok(cleanedFeishuCodeBlockMarkdown.includes('```bash\n# 创建项目（如果还没有的话）\nnpx create-video@latest'));
assert.ok(cleanedFeishuCodeBlockMarkdown.includes('cd remotion-studio\nnpm install'));
assert.ok(cleanedFeishuCodeBlockMarkdown.includes('```\n\n安装完成后启动开发环境：'));
const truncatedFeishuMarkdown = [
  '# 飞书标题',
  '',
  '### 第三步：安装 Conda + Python 3.12',
  'python --version',
  'REMOTION搭配Qwen3-TTS的声音克隆方法',
  'AI企业服务赛道实战经验分享 - 从选品到获客策略',
  'Hermes Agent从0到1部署教程 | 服务器选购及连接指南',
  '用REMOTION做AI视频要避开的3个踩坑点',
].join('\n');
assert.strictEqual(helpers.shouldRefreshFeishuMarkdownFromSource(
  'https://fv2fbshiww0.feishu.cn/wiki/KTQtw8R56igHE7kkKwHcoTBun9e',
  { markdown: truncatedFeishuMarkdown },
), true);
assert.strictEqual(helpers.shouldRefreshFeishuMarkdownFromSource(
  'https://fv2fbshiww0.feishu.cn/wiki/KTQtw8R56igHE7kkKwHcoTBun9e',
  {
    markdown: [
      '# 读完这篇，你能做到什么',
      '',
      '# 三、实战教学：从0到出片',
      '',
      '### (2) 安装清单总览',
      '',
      '以下是所有需要安装的软件和工具：',
      '',
      '序号',
      '版本',
      '用途',
      '是否必须',
      'Node.js',
      'v20+（推荐 v22）',
      'Remotion 运行环境',
      '必须',
      'CUDA Toolkit',
    ].join('\n'),
  },
), true);
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
assert.strictEqual(
  helpers.getRecordConversionWarning({
    metadata: {
      imageLocalizationFailedCount: 2,
      imageLocalizationError: 'read ECONNRESET',
    },
  }),
  '飞书图片有 2 张未保存：read ECONNRESET',
);
assert.strictEqual(
  helpers.getRecordConversionWarning({
    metadata: {
      imageTempUrlMissingCount: 3,
    },
  }),
  '飞书图片有 3 张未保存：飞书未返回 3 张图片地址',
);
assert.strictEqual(
  helpers.buildConversionWarningsNotice(['飞书图片有 2 张未保存：read ECONNRESET']),
  '，1 条内容处理不完整：飞书图片有 2 张未保存：read ECONNRESET',
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
assert.strictEqual(aiMetadataInput.includes('https://example.com/post'), false);
const transcriptAiMetadataInput = helpers.extractAiMetadataInputText({
  type: 'webpage',
  content: 'https://v.douyin.com/uTXolAGel5w/',
  metadata: {
    title: '抖音口播文案',
    transcriptOnly: true,
    transcriptionStatus: 'success',
    transcription: '所有平台都在阻止你把他们的内容变成你的私有财产。今天我们从零开始讲如何把内容保存到 Obsidian。',
    description: '旧的非 AI 摘要 https://v.douyin.com/uTXolAGel5w/',
    keywords: ['Obsidian', 'AI'],
  },
});
assert.ok(transcriptAiMetadataInput.includes('抖音口播文案'));
assert.ok(transcriptAiMetadataInput.includes('所有平台都在阻止你'));
assert.strictEqual(transcriptAiMetadataInput.includes('https://v.douyin.com'), false);
assert.strictEqual(transcriptAiMetadataInput.includes('旧的非 AI 摘要'), false);
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
    currentWindowsAsrScriptSource,
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
    readFileSync: () => currentWindowsAsrScriptSource,
  }),
  {
    scriptVersion: 'adaptive-chunked-diagnostics-process-repeat-guard-v2-heartbeat-run-log',
    scriptOutdated: false,
  },
);
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
    readFileSync: () => markerOnlyLegacyWindowsAsrScriptSource,
  }),
  {
    scriptVersion: 'legacy-signature-mismatch',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => historicalWindowsAsrScriptSource,
  }),
  {
    scriptVersion: 'adaptive-chunked-start-process-repeat-guard-v2-heartbeat-run-log',
    scriptOutdated: false,
    upgradeRecommended: true,
    compatibilityMode: 'legacy-start-process',
  },
);
for (const damagedOfficialSource of [
  `${historicalWindowsAsrScriptSource}\nfunction Broken-LegacyScript {`,
  `${currentWindowsAsrScriptSource}\nfunction Broken-CurrentScript {`,
]) {
  assert.strictEqual(
    helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
      existsSync: () => true,
      readFileSync: () => damagedOfficialSource,
    }).scriptOutdated,
    true,
  );
}
for (const unreadableSource of ['', 'this is not a transcription script']) {
  assert.deepStrictEqual(
    helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
      existsSync: () => true,
      readFileSync: () => unreadableSource,
    }),
    {
      scriptVersion: 'unknown',
      scriptOutdated: true,
    },
  );
}
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => {
      throw new Error('permission denied');
    },
  }),
  {
    scriptVersion: 'unknown',
    scriptOutdated: true,
  },
);
{
  const tempLegacyAsrRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-asr-legacy-ready-'));
  fs.mkdirSync(path.join(tempLegacyAsrRoot, 'whisper'), { recursive: true });
  fs.mkdirSync(path.join(tempLegacyAsrRoot, 'ffmpeg'), { recursive: true });
  fs.mkdirSync(path.join(tempLegacyAsrRoot, 'models'), { recursive: true });
  fs.writeFileSync(path.join(tempLegacyAsrRoot, 'whisper', 'whisper-cli.exe'), '');
  fs.writeFileSync(path.join(tempLegacyAsrRoot, 'ffmpeg', 'ffmpeg.exe'), '');
  fs.writeFileSync(path.join(tempLegacyAsrRoot, 'models', 'ggml-small.bin'), '');
  fs.writeFileSync(path.join(tempLegacyAsrRoot, 'transcribe.ps1'), historicalWindowsAsrScriptSource, 'utf8');
  const legacyStatus = helpers.getLocalAsrInstallStatus(
    tempLegacyAsrRoot,
    fs.existsSync,
    portableWindowsLayoutPlatform,
  );
  assert.strictEqual(legacyStatus.ready, true);
  assert.strictEqual(legacyStatus.scriptOutdated, false);
  assert.strictEqual(legacyStatus.upgradeRecommended, true);
  assert.strictEqual(legacyStatus.compatibilityMode, 'legacy-start-process');
  assert.deepStrictEqual(legacyStatus.missingReasons, []);
  fs.rmSync(tempLegacyAsrRoot, { recursive: true, force: true });
}
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
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Convert-ExitCodeToHex { $signed = [int64]$ExitCode; if ($signed -lt 0) { $signed = 4294967296 + $signed }; return "0x{0:X8}" -f $signed }\nfunction Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }\nfunction Split-AudioToChunks { param([string]$AudioPath, [int]$SegmentSeconds) }\nfunction Test-TranscriptHasRepeatHallucination { param([string]$Text) }\nfunction Invoke-RecoverRepeatedChunkText { param([string]$ChunkPath) }\nfunction Test-WhisperNativeCrashExitCode { $hex = Convert-ExitCodeToHex -ExitCode $ExitCode }\nInvoke-TranscribeAttempt -Mode "normal"\nInvoke-TranscribeAttempt -Mode "safe"\nsafeModelPath\nfunction Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$TranscriptQualityGuardVersion = "repeat-guard-v2"\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n$ChunkSeconds = 120\n$ChunkRetrySeconds = 30\n$RunLog = Join-Path $Root "transcribe-last.log"\nprogressPercent=100\nrecoveryTriggered=1\nTRANSCRIPT_HALLUCINATION',
  }),
  {
    scriptVersion: 'adaptive-chunked-start-process-repeat-guard-v2-progress-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('C:\\Users\\demo\\.wechat-inbox-local-asr\\transcribe.ps1', {
    existsSync: () => true,
    readFileSync: () => 'function Convert-ExitCodeToHex { $signed = [int64]$ExitCode; if ($signed -lt 0) { $signed = 4294967296 + $signed }; return "0x{0:X8}" -f $signed }\nfunction Get-ShortPath { New-Object -ComObject Scripting.FileSystemObject }\nfunction Test-WhisperNativeCrashExitCode { $hex = Convert-ExitCodeToHex -ExitCode $ExitCode }\nInvoke-TranscribeAttempt -Mode "normal"\nInvoke-TranscribeAttempt -Mode "safe"\nsafeModelPath\nfunction Invoke-NativeProcess { Start-Process -RedirectStandardOutput $stdoutPath }\nfunction ConvertTo-SimplifiedChinese { [Microsoft.VisualBasic.Strings]::StrConv($Text, [Microsoft.VisualBasic.VbStrConv]::SimplifiedChinese, 0x0804) }\n$SimplifiedPrompt = [string]::Concat([char]0x8bf7)\n$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)\n[System.IO.File]::ReadAllText($chunkTxt, $Utf8NoBom)\n[System.IO.File]::WriteAllText($OutputPath, $finalText, $Utf8NoBom)\n"--prompt", $SimplifiedPrompt\n$ChunkSeconds = 600\n$RunLog = Join-Path $Root "transcribe-last.log"\nprogressPercent=100',
  }),
  {
    scriptVersion: 'chunked-start-process-utf8-simplified-fallback-safe-model-progress-run-log',
    scriptOutdated: true,
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
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('/Users/demo/.wechat-inbox-local-asr/transcribe.sh', {
    existsSync: () => true,
    readFileSync: () => 'set -euo pipefail\nSIMPLIFIED_PROMPT="$(printf)"\nfind_metal_resources_dir\nGGML_METAL_PATH_RESOURCES\nCHUNK_SECONDS=120\nchoose_chunk_seconds\nmetalAcceleration=failed\nRUN_LOG="$ROOT/transcribe-last.log"\n--prompt "$SIMPLIFIED_PROMPT"\nprogressPercent=100',
  }),
  {
    scriptVersion: 'adaptive-chunked-bash-simplified-progress-metal-diagnostics-run-log',
    scriptOutdated: true,
  },
);
assert.deepStrictEqual(
  helpers.getLocalAsrScriptVersionStatus('/Users/demo/.wechat-inbox-local-asr/transcribe.sh', {
    existsSync: () => true,
    readFileSync: () => 'set -euo pipefail\nTRANSCRIPT_QUALITY_GUARD_VERSION="repeat-guard-v2"\nfind_metal_resources_dir\nGGML_METAL_PATH_RESOURCES\nCHUNK_SECONDS=120\nchoose_chunk_seconds\nmetalAcceleration=failed\nRUN_LOG="$ROOT/transcribe-last.log"\nprogressPercent=100',
  }),
  {
    scriptVersion: 'adaptive-chunked-bash-repeat-guard-v2-progress-metal-diagnostics-run-log',
    scriptOutdated: true,
  },
);
assert.ok(helpers.buildLocalAsrInstallCommand('C:\\plugin\\local-asr\\install-local-asr.ps1').includes('-ExecutionPolicy Bypass'));
assert.ok(helpers.buildLocalAsrInstallCommand('C:\\plugin\\local-asr\\install-local-asr.ps1').includes('"C:\\plugin\\local-asr\\install-local-asr.ps1"'));
assert.strictEqual(
  helpers.buildLocalAsrInstallCommand('/Users/demo/plugin/local-asr/install-local-asr-macos.sh', 'darwin'),
  '/bin/bash "/Users/demo/plugin/local-asr/install-local-asr-macos.sh"',
);
assert.deepStrictEqual(
  helpers.parseLocalAsrProgressLog('progressStage=transcribing\nprogressCurrent=2\nprogressTotal=5\nprogressPercent=40\nprogressStartedAt=2026-07-23T12:00:00.000Z\nprogressHeartbeatAt=2026-07-23T12:00:05.000Z\nprogressPid=1234\n'),
  {
    stage: 'transcribing',
    current: 2,
    total: 5,
    percent: 40,
    startedAt: '2026-07-23T12:00:00.000Z',
    heartbeatAt: '2026-07-23T12:00:05.000Z',
    pid: 1234,
  },
);
assert.deepStrictEqual(
  helpers.parseLocalAsrProgressLog('progressStage=transcribing\nprogressCurrent=3\nprogressTotal=4\n'),
  {
    stage: 'transcribing',
    current: 3,
    total: 4,
    percent: 75,
    startedAt: '',
    heartbeatAt: '',
    pid: 0,
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
assert.strictEqual(
  helpers.buildSyncProgressMessage({
    stage: 'transcribing',
    localProgressStage: 'segmenting',
    localProgressStartedAt: '2026-07-23T12:00:00.000Z',
    now: new Date('2026-07-23T12:00:12.000Z').getTime(),
  }).includes('正在准备音频，已运行 12 秒'),
  true,
);
assert.strictEqual(
  helpers.buildSyncProgressMessage({
    stage: 'transcribing',
    localProgressStage: 'transcribing',
    localProgressCurrent: 0,
    localProgressTotal: 4,
    localProgressStartedAt: '2026-07-23T12:00:00.000Z',
    now: new Date('2026-07-23T12:00:12.000Z').getTime(),
  }).includes('正在转写第 1/4 段，已运行 12 秒'),
  true,
);
assert.strictEqual(
  helpers.buildSyncProgressMessage({
    stage: 'transcribing',
    localProgressStage: 'transcribing',
    localProgressHeartbeatAt: '2026-07-23T12:00:00.000Z',
    now: new Date('2026-07-23T12:00:25.000Z').getTime(),
  }).includes('任务可能无响应，可暂停后重试'),
  true,
);
assert.notStrictEqual(
  helpers.buildLocalAsrProgressKey({
    stage: 'transcribing', current: 0, total: 4, percent: 0, heartbeatAt: '2026-07-23T12:00:00.000Z',
  }, new Date('2026-07-23T12:00:10.000Z').getTime()),
  helpers.buildLocalAsrProgressKey({
    stage: 'transcribing', current: 0, total: 4, percent: 0, heartbeatAt: '2026-07-23T12:00:00.000Z',
  }, new Date('2026-07-23T12:00:25.000Z').getTime()),
);
assert.ok(windowsAsrInstallerSource.includes('progressHeartbeatAt='));
assert.ok(windowsAsrInstallerSource.includes('progressPid='));
assert.ok(windowsAsrInstallerSource.includes('-ProgressStage "segmenting"'));
assert.ok(windowsAsrInstallerSource.includes('WaitForExit(5000)'));
assert.ok(macAsrInstallerSource.includes('progressHeartbeatAt='));
assert.ok(macAsrInstallerSource.includes('progressPid='));
assert.ok(macAsrInstallerSource.includes('run_with_heartbeat segmenting'));
assert.ok(macAsrInstallerSource.includes('sleep 1'));
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
assert.strictEqual(typeof helpers.extractLocalAsrInstallRootFromCommand, 'function');
assert.strictEqual(
  helpers.extractLocalAsrInstallRootFromCommand(
    'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\ADMIN\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
    'win32',
  ),
  'C:\\Users\\ADMIN\\.wechat-inbox-local-asr',
);
const extractLocalAsrInstallRootSource = pluginMainSource.slice(
  pluginMainSource.indexOf('function extractLocalAsrInstallRootFromCommand'),
  pluginMainSource.indexOf('function normalizeNoteSaveMode'),
);
assert.match(extractLocalAsrInstallRootSource, /path\.win32\.basename/);
assert.match(extractLocalAsrInstallRootSource, /path\.posix\.basename/);
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

const corruptedPdfText = [
  '更部移两移少理随躁少么梳的主回过识表本不随谱随内容么消全流程随份案领稳玩随这',
  '险课法的是理物何需随更部移两移少理随际随图随本不份个部少么梳的主回过识表云需',
  '它持则么消内容总随份个是背的物是理很成么图本不少盘的过识表编要么稳玩本断了味展',
  '持不下去要么书了份统东味不过道这么需总这险课的索领主部是成过识表不是评完什的第',
].join('').repeat(8);
assert.throws(
  () => helpers.extractPdfMarkdown(createUtf16BePdfBuffer(corruptedPdfText)),
  (error) => error && !error.code && /PDF/.test(error.message),
  '长串、低标点且重复度异常的 PDF 文本层应作为普通转换失败处理',
);

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
  '<script>{"note":{"desc":"正文第一段，正文第二段，正文第三段。 #tagOne #tagTwo","imageList":[{"urlDefault":"https:\\/\\/img.example.com\\/cover.jpg"},{"urlDefault":"https:\\/\\/img.example.com\\/inner-a.jpg"},{"urlDefault":"https:\\/\\/img.example.com\\/inner-b.jpg"},{"url":"https:\\/\\/sns-webpic.example.com\\/inner-c"}]}}</script>',
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

const xiaohongshuPathAwareContentNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<script>{"note":{"content":"真实笔记正文只存在于 note.content 字段。 #正文标签"},"comments":[{"content":"评论内容绝不能冒充正文，即使它更长。 #评论标签"}]}</script>',
].join(''), 'https://www.xiaohongshu.com/explore/path-aware-content', '', { includeComments: false });
assert.ok(xiaohongshuPathAwareContentNote.description.includes('真实笔记正文只存在于 note.content 字段'));
assert.strictEqual(xiaohongshuPathAwareContentNote.description.includes('评论内容绝不能冒充正文'), false);
assert.strictEqual(xiaohongshuPathAwareContentNote.markdown.includes('评论内容绝不能冒充正文'), false);

const xiaohongshuStandaloneCommentObject = helpers.extractXiaohongshuMarkdownFromHtml([
  '<script>window.__COMMENTS__=[{"note_id":"note-1","content":"独立评论对象即使带 note_id 也不能冒充正文。 #评论标签"}]</script>',
].join(''), 'https://www.xiaohongshu.com/explore/standalone-comment', '', { includeComments: false });
assert.strictEqual(xiaohongshuStandaloneCommentObject.description.includes('独立评论对象'), false);
assert.strictEqual(xiaohongshuStandaloneCommentObject.markdown.includes('独立评论对象'), false);

const genericXiaohongshuLandingHtml = [
  '<html><head>',
  '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
  '<meta name="description" content="86【超常儿童，也可能被鸡废了，家长都踩过】分享口令">',
  '<meta property="og:image" content="https://picasso-static.xiaohongshu.com/fe-platform/default-logo.png">',
  '</head></html>',
].join('');
const genericXiaohongshuExtraction = helpers.extractXiaohongshuMarkdownFromHtml(
  genericXiaohongshuLandingHtml,
  'https://www.xiaohongshu.com/explore/generic-note',
  '86【超常儿童，也可能被鸡废了，家长都踩过】分享口令',
);
assert.strictEqual(helpers.isGenericXiaohongshuLandingExtraction(
  genericXiaohongshuExtraction,
  genericXiaohongshuLandingHtml,
), true);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent(
  genericXiaohongshuExtraction,
  genericXiaohongshuLandingHtml,
  'https://www.xiaohongshu.com/explore/generic-note',
), false);

const realXiaohongshuNoteWithGenericDocumentTitleHtml = [
  '<html><head>',
  '<title>小红书 - 你的生活兴趣社区</title>',
  '<link rel="canonical" href="https://www.xiaohongshu.com/explore/real-note-generic-document-title">',
  '<meta property="og:title" content="真实笔记标题">',
  '<meta name="description" content="这里是已经匿名返回的真实笔记正文，不能因为文档标题通用就拒绝。">',
  '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/real-note-cover.jpg">',
  '</head></html>',
].join('');
const realXiaohongshuNoteWithGenericDocumentTitle = helpers.extractXiaohongshuMarkdownFromHtml(
  realXiaohongshuNoteWithGenericDocumentTitleHtml,
  'https://www.xiaohongshu.com/explore/real-note-generic-document-title',
);
assert.strictEqual(helpers.isGenericXiaohongshuLandingExtraction(
  realXiaohongshuNoteWithGenericDocumentTitle,
  realXiaohongshuNoteWithGenericDocumentTitleHtml,
), false);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent(
  realXiaohongshuNoteWithGenericDocumentTitle,
  realXiaohongshuNoteWithGenericDocumentTitleHtml,
  'https://www.xiaohongshu.com/explore/real-note-generic-document-title',
), true);

const realStructuredXiaohongshuNoteWithGenericMetaTitleHtml = [
  '<html><head>',
  '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
  '<meta name="description" content="该内容来自小红书，请打开小红书查看">',
  '</head><body>',
  '<script>',
  'window.__INITIAL_STATE__={"opPrompt":undefined,"noteDetailMap":{"6a4ccf88000000001101d144":{"note":{',
  '"noteId":"6a4ccf88000000001101d144",',
  '"displayTitle":"真实结构化笔记标题",',
  '"desc":"这是目标笔记的完整正文，不应被小红书通用网页标题误杀。 #真实标签",',
  '"tagList":[{"name":"结构标签"}],',
  '"imageList":[',
  '{"urlDefault":"https://sns-webpic-qc.xhscdn.com/target-note-cover.jpg"},',
  '{"urlDefault":"https://sns-webpic-qc.xhscdn.com/target-note-inner.jpg"}',
  ']}}}};',
  '</script>',
  '</body></html>',
].join('');
const realStructuredXiaohongshuNoteWithGenericMetaTitle = helpers.extractXiaohongshuMarkdownFromHtml(
  realStructuredXiaohongshuNoteWithGenericMetaTitleHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
assert.strictEqual(
  realStructuredXiaohongshuNoteWithGenericMetaTitle.title,
  '真实结构化笔记标题',
);
assert.ok(realStructuredXiaohongshuNoteWithGenericMetaTitle.description.includes('目标笔记的完整正文'));
assert.ok(realStructuredXiaohongshuNoteWithGenericMetaTitle.tags.includes('#真实标签'));
assert.ok(realStructuredXiaohongshuNoteWithGenericMetaTitle.tags.includes('#结构标签'));
assert.strictEqual(realStructuredXiaohongshuNoteWithGenericMetaTitle.imageUrls.length, 2);
assert.ok(realStructuredXiaohongshuNoteWithGenericMetaTitle.markdown.includes(
  '![封面](https://sns-webpic-qc.xhscdn.com/target-note-cover.jpg)',
));
assert.ok(realStructuredXiaohongshuNoteWithGenericMetaTitle.markdown.includes(
  '![内页图 1](https://sns-webpic-qc.xhscdn.com/target-note-inner.jpg)',
));
assert.ok(
  realStructuredXiaohongshuNoteWithGenericMetaTitle.markdown.indexOf('target-note-cover.jpg')
    < realStructuredXiaohongshuNoteWithGenericMetaTitle.markdown.indexOf('target-note-inner.jpg'),
);
assert.strictEqual(helpers.isGenericXiaohongshuLandingExtraction(
  realStructuredXiaohongshuNoteWithGenericMetaTitle,
  realStructuredXiaohongshuNoteWithGenericMetaTitleHtml,
), false);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent(
  realStructuredXiaohongshuNoteWithGenericMetaTitle,
  realStructuredXiaohongshuNoteWithGenericMetaTitleHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
), true);

const mismatchedInnerNoteIdHtml = [
  '<html><head>',
  '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
  '</head><body><script>',
  JSON.stringify({
    noteDetailMap: {
      '6a4ccf88000000001101d144': {
        note: {
          noteId: '000000000000000000000099',
          displayTitle: '不能冒充目标笔记的另一篇内容',
          desc: '路径键虽然等于目标 ID，但对象自己的 noteId 明确属于另一篇笔记。',
          imageList: [{
            urlDefault: 'https://sns-webpic-qc.xhscdn.com/cards/mismatched-note.jpg',
          }],
        },
      },
    },
  }),
  '</script></body></html>',
].join('');
const mismatchedInnerNoteIdExtraction = helpers.extractXiaohongshuMarkdownFromHtml(
  mismatchedInnerNoteIdHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
assert.strictEqual(
  mismatchedInnerNoteIdExtraction.xiaohongshuPrimaryNoteMatched,
  false,
  'an explicit mismatched noteId must override a matching noteDetailMap path key',
);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent(
  mismatchedInnerNoteIdExtraction,
  mismatchedInnerNoteIdHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
), false);

const nonGenericForeignRecommendationHtml = [
  '<html><head>',
  '<meta property="og:title" content="另一篇看起来正常的推荐笔记">',
  '<meta name="description" content="这是另一篇笔记的完整推荐正文，长度和图片都不能让它冒充目标内容。">',
  '</head><body><script>',
  JSON.stringify({
    noteDetailMap: {
      '000000000000000000000099': {
        note: {
          noteId: '000000000000000000000099',
          displayTitle: '另一篇看起来正常的推荐笔记',
          desc: '这是另一篇笔记的完整推荐正文，长度和图片都不能让它冒充目标内容。',
          imageList: [{
            urlDefault: 'https://sns-webpic-qc.xhscdn.com/cards/foreign-but-plausible.jpg',
          }],
        },
      },
    },
  }),
  '</script></body></html>',
].join('');
const nonGenericForeignRecommendation = helpers.extractXiaohongshuMarkdownFromHtml(
  nonGenericForeignRecommendationHtml,
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
);
assert.strictEqual(nonGenericForeignRecommendation.xiaohongshuTargetNoteIdPresent, true);
assert.strictEqual(nonGenericForeignRecommendation.xiaohongshuPrimaryNoteMatched, false);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent(
  nonGenericForeignRecommendation,
  nonGenericForeignRecommendationHtml,
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
), false, 'a plausible recommendation note must not be accepted for a different target ID');

const oversizedXiaohongshuStateHtml = [
  '<html><head><meta property="og:title" content="小红书 - 你的生活兴趣社区"></head><body><script>',
  JSON.stringify({
    noteDetailMap: {
      '6a4ccf88000000001101d144': {
        note: {
          noteId: '6a4ccf88000000001101d144',
          displayTitle: '超出结构化状态预算的笔记',
          desc: '超大状态必须失败关闭，不能无限占用 Obsidian 主线程。',
          padding: 'x'.repeat((2 * 1024 * 1024) + 2048),
        },
      },
    },
  }),
  '</script></body></html>',
].join('');
const oversizedXiaohongshuStateExtraction = helpers.extractXiaohongshuMarkdownFromHtml(
  oversizedXiaohongshuStateHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
assert.strictEqual(oversizedXiaohongshuStateExtraction.xiaohongshuPrimaryNoteMatched, false);

const plausibleRecommendationWithoutIdentityHtml = [
  '<html><head>',
  '<meta property="og:title" content="看起来完整但无法证明身份的推荐笔记">',
  '<meta name="description" content="这是一段长度足够、看起来完全正常的推荐正文，但页面里没有目标笔记身份。">',
  '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/recommendation-without-id.jpg">',
  '</head><body></body></html>',
].join('');
const plausibleRecommendationWithoutIdentity = helpers.extractXiaohongshuMarkdownFromHtml(
  plausibleRecommendationWithoutIdentityHtml,
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
);
assert.strictEqual(
  helpers.hasReadableXiaohongshuGraphicContent(
    plausibleRecommendationWithoutIdentity,
    plausibleRecommendationWithoutIdentityHtml,
    'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
  ),
  false,
  'plausible meta content without exact target identity must fail closed',
);

assert.strictEqual(typeof helpers.collectXiaohongshuNoteImageUrls, 'function');
const xiaohongshuImageFloodHtml = JSON.stringify({
  imageList: Array.from({ length: 5000 }, (_unused, index) => ({
    urlDefault: `https://sns-webpic-qc.xhscdn.com/flood/image-${index}.jpg`,
  })),
});
const xiaohongshuImageFloodStartedAt = Date.now();
const xiaohongshuImageFloodResult = helpers.collectXiaohongshuNoteImageUrls(
  xiaohongshuImageFloodHtml,
);
assert.ok(
  xiaohongshuImageFloodResult.length <= 100,
  'Xiaohongshu fallback image extraction must never schedule more than 100 downloads',
);
assert.ok(
  Date.now() - xiaohongshuImageFloodStartedAt < 2000,
  'Xiaohongshu fallback image extraction must stay within a bounded runtime',
);
const xiaohongshuImageTagFloodHtml = Array.from(
  { length: 20000 },
  (_unused, index) => `<img src="https://sns-webpic-qc.xhscdn.com/tag-flood/${index}.jpg">`,
).join('');
const xiaohongshuImageTagFloodStartedAt = Date.now();
const xiaohongshuImageTagFloodResult = helpers.collectXiaohongshuNoteImageUrls(
  xiaohongshuImageTagFloodHtml,
);
assert.ok(xiaohongshuImageTagFloodResult.length <= 100);
assert.ok(
  Date.now() - xiaohongshuImageTagFloodStartedAt < 2000,
  'Xiaohongshu img-tag fallback must stop scanning after its image budget',
);
const xiaohongshuNoisyImagesBeforeRealHtml = [
  ...Array.from(
    { length: 150 },
    (_unused, index) => `<img src="https://sns-avatar-qc.xhscdn.com/avatar-${index}.jpg">`,
  ),
  '<img src="https://sns-webpic-qc.xhscdn.com/notes_pre_post/real-note.jpg">',
].join('');
assert.deepStrictEqual(
  helpers.collectXiaohongshuNoteImageUrls(xiaohongshuNoisyImagesBeforeRealHtml),
  ['https://sns-webpic-qc.xhscdn.com/notes_pre_post/real-note.jpg'],
  'noisy avatars must not consume the image budget before the real note image',
);
const xiaohongshuJsonUrlFloodHtml = Array.from(
  { length: 20000 },
  (_unused, index) => `"url":"https://sns-webpic-qc.xhscdn.com/json-flood/${index}.jpg"`,
).join(',');
const xiaohongshuJsonUrlFloodStartedAt = Date.now();
const xiaohongshuJsonUrlFloodResult = helpers.collectXiaohongshuNoteImageUrls(
  xiaohongshuJsonUrlFloodHtml,
);
assert.ok(xiaohongshuJsonUrlFloodResult.length <= 100);
assert.ok(
  Date.now() - xiaohongshuJsonUrlFloodStartedAt < 2000,
  'Xiaohongshu JSON image fallback must stop scanning after its image budget',
);
const xiaohongshuWideUnrelatedStateHtml = `<script>${Array.from(
  { length: 12000 },
  (_unused, index) => JSON.stringify({
    desc: `unrelated recommendation ${index}`,
    image: `https://sns-webpic-qc.xhscdn.com/wide/${index}.jpg`,
  }),
).join('')}</script>`;
const xiaohongshuWideUnrelatedStateStartedAt = Date.now();
const xiaohongshuWideUnrelatedState = helpers.extractXiaohongshuMarkdownFromHtml(
  xiaohongshuWideUnrelatedStateHtml,
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
);
assert.strictEqual(xiaohongshuWideUnrelatedState.xiaohongshuPrimaryNoteMatched, false);
assert.ok(
  Date.now() - xiaohongshuWideUnrelatedStateStartedAt < 2000,
  'wide unrelated structured state must not trigger quadratic target scans',
);
const malformedXiaohongshuImageArrays = Array.from(
  { length: 20000 },
  () => '"imageList":[',
).join('');
const malformedXiaohongshuImageArraysStartedAt = Date.now();
assert.deepStrictEqual(
  helpers.collectXiaohongshuNoteImageUrls(malformedXiaohongshuImageArrays),
  [],
);
assert.ok(
  Date.now() - malformedXiaohongshuImageArraysStartedAt < 2000,
  'malformed image arrays must fail closed without rescanning every suffix',
);

const unrelatedRecommendationCards = Object.fromEntries(Array.from({ length: 24 }, (_, index) => {
  const noteId = (index + 1).toString(16).padStart(24, '0');
  return [noteId, {
    note: {
      noteId,
      displayTitle: `推荐流里的第 ${index + 1} 篇笔记`,
      desc: `这是推荐流里的第 ${index + 1} 篇正文，内容再完整也不能冒充目标笔记。`,
      imageList: [{
        urlDefault: `https://sns-webpic-qc.xhscdn.com/cards/card-${index + 1}.jpg`,
      }],
    },
  }];
}));
const unrelatedRecommendationLandingHtml = [
  '<html><head>',
  '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
  '</head><body>',
  `<main>${'推荐流导航和卡片文字。'.repeat(80)}</main>`,
  '<script>',
  JSON.stringify({ noteDetailMap: unrelatedRecommendationCards }),
  '</script>',
  '</body></html>',
].join('');
const unrelatedRecommendationLanding = helpers.extractXiaohongshuMarkdownFromHtml(
  unrelatedRecommendationLandingHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
assert.ok(unrelatedRecommendationLanding.description.length > 500);
assert.strictEqual(
  unrelatedRecommendationLanding.imageUrls.length,
  16,
  'the image block budget should stay bounded while the recommendation page remains obviously substantial',
);
assert.strictEqual(helpers.isGenericXiaohongshuLandingExtraction(
  unrelatedRecommendationLanding,
  unrelatedRecommendationLandingHtml,
), true);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent(
  unrelatedRecommendationLanding,
  unrelatedRecommendationLandingHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
), false);
assert.strictEqual(typeof helpers.shouldStopWaitingForXiaohongshuContent, 'function');
assert.strictEqual(helpers.shouldStopWaitingForXiaohongshuContent(
  realStructuredXiaohongshuNoteWithGenericMetaTitleHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
), true);
assert.strictEqual(helpers.shouldStopWaitingForXiaohongshuContent(
  unrelatedRecommendationLandingHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
), false);
assert.strictEqual(typeof helpers.rememberXiaohongshuObservedIdentity, 'function');
const observedMainFrameIdentity = helpers.rememberXiaohongshuObservedIdentity('', {
  resourceType: 'mainFrame',
  url: 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
});
assert.strictEqual(
  observedMainFrameIdentity,
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
);
assert.strictEqual(
  helpers.rememberXiaohongshuObservedIdentity('', {
    resourceType: 'image',
    frameId: 0,
    parentFrameId: -1,
    url: 'https://www.xiaohongshu.com/explore/6b5ddf99000000002202e255',
  }),
  '',
  'a subresource must not establish an observed note identity',
);
assert.strictEqual(
  helpers.rememberXiaohongshuObservedIdentity('', {
    resourceType: 'mainFrame',
    url: 'https://www.xiaohongshu.com/',
  }),
  '',
  'a generic Xiaohongshu landing page must not establish an observed note identity',
);
assert.strictEqual(
  helpers.rememberXiaohongshuObservedIdentity('', {
    resourceType: 'mainFrame',
    url: 'https://attacker.example/explore/6b5ddf99000000002202e255',
  }),
  '',
  'an external main-frame URL must not establish an observed note identity',
);
assert.strictEqual(
  helpers.rememberXiaohongshuObservedIdentity('', {
    resourceType: 'mainFrame',
    url: 'http://www.xiaohongshu.com/explore/6b5ddf99000000002202e255',
  }),
  '',
  'an insecure Xiaohongshu URL must not establish an observed note identity',
);
assert.strictEqual(
  helpers.rememberXiaohongshuObservedIdentity(observedMainFrameIdentity, {
    resourceType: 'image',
    frameId: 0,
    parentFrameId: -1,
    url: 'https://www.xiaohongshu.com/explore/6b5ddf99000000002202e255',
  }),
  observedMainFrameIdentity,
  'a subresource in the main frame must not replace the observed note identity',
);
assert.strictEqual(
  helpers.rememberXiaohongshuObservedIdentity(observedMainFrameIdentity, {
    resourceType: 'mainFrame',
    url: 'https://www.xiaohongshu.com/',
  }),
  observedMainFrameIdentity,
  'a generic Xiaohongshu landing page must not erase the observed note identity',
);
assert.strictEqual(
  helpers.rememberXiaohongshuObservedIdentity(observedMainFrameIdentity, {
    resourceType: 'mainFrame',
    url: 'https://attacker.example/explore/6b5ddf99000000002202e255',
  }),
  observedMainFrameIdentity,
  'an external main-frame navigation must not replace the observed note identity',
);
assert.strictEqual(
  helpers.rememberXiaohongshuObservedIdentity('', {
    frameId: 0,
    parentFrameId: -1,
    url: 'https://www.xiaohongshu.com/',
    redirectURL: 'https://www.xiaohongshu.com/discovery/item/6b5ddf99000000002202e255',
  }),
  'https://www.xiaohongshu.com/discovery/item/6b5ddf99000000002202e255',
  'main-frame redirect details must remember the official HTTPS note destination',
);
assert.strictEqual(typeof helpers.installXiaohongshuIdentityObserver, 'function');
const firstIdentityWebContents = new EventEmitter();
const secondIdentityWebContents = new EventEmitter();
const unrelatedRedirectHandler = () => {};
firstIdentityWebContents.on('will-redirect', unrelatedRedirectHandler);
const firstObservedIdentities = [];
const secondObservedIdentities = [];
const cleanupFirstIdentityObserver = helpers.installXiaohongshuIdentityObserver(
  firstIdentityWebContents,
  (identityUrl) => firstObservedIdentities.push(identityUrl),
);
const cleanupSecondIdentityObserver = helpers.installXiaohongshuIdentityObserver(
  secondIdentityWebContents,
  (identityUrl) => secondObservedIdentities.push(identityUrl),
);
secondIdentityWebContents.emit(
  'will-navigate',
  {},
  'https://www.xiaohongshu.com/explore/6b5ddf99000000002202e255',
);
assert.deepStrictEqual(firstObservedIdentities, []);
assert.deepStrictEqual(secondObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6b5ddf99000000002202e255',
]);
firstIdentityWebContents.emit(
  'will-redirect',
  {},
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
  false,
  false,
);
firstIdentityWebContents.emit(
  'will-frame-navigate',
  {},
  {
    url: 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
    isMainFrame: false,
  },
);
firstIdentityWebContents.emit(
  'will-redirect',
  {},
  'https://attacker.example/explore/6a4ccf88000000001101d144',
  false,
  true,
);
assert.deepStrictEqual(firstObservedIdentities, []);
firstIdentityWebContents.emit(
  'will-redirect',
  {},
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
  false,
  true,
);
assert.deepStrictEqual(firstObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
]);
assert.strictEqual(firstIdentityWebContents.listenerCount('will-redirect'), 2);
cleanupFirstIdentityObserver();
assert.strictEqual(firstIdentityWebContents.listenerCount('will-redirect'), 1);
assert.strictEqual(
  firstIdentityWebContents.listeners('will-redirect')[0],
  unrelatedRedirectHandler,
  'cleanup must preserve unrelated listeners on the same webContents',
);
firstIdentityWebContents.emit(
  'will-navigate',
  {},
  'https://www.xiaohongshu.com/explore/6c6eefaa000000003303f366',
);
assert.deepStrictEqual(firstObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
]);
secondIdentityWebContents.emit(
  'will-redirect',
  {},
  'https://www.xiaohongshu.com/explore/6c6eefaa000000003303f366',
  false,
  true,
);
assert.deepStrictEqual(secondObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6b5ddf99000000002202e255',
  'https://www.xiaohongshu.com/explore/6c6eefaa000000003303f366',
]);
cleanupSecondIdentityObserver();
const signatureIdentityWebContents = new EventEmitter();
const signatureObservedIdentities = [];
const cleanupSignatureIdentityObserver = helpers.installXiaohongshuIdentityObserver(
  signatureIdentityWebContents,
  (identityUrl) => signatureObservedIdentities.push(identityUrl),
);
signatureIdentityWebContents.emit('will-redirect', {
  url: 'https://www.xiaohongshu.com/explore/6d7ff0bb000000004404a477',
  isMainFrame: true,
});
assert.deepStrictEqual(signatureObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6d7ff0bb000000004404a477',
], 'current Electron details must record a main-frame redirect');
signatureIdentityWebContents.emit('will-redirect', {
  url: 'https://www.xiaohongshu.com/explore/6e8001cc000000005505b588',
  isMainFrame: false,
});
assert.deepStrictEqual(signatureObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6d7ff0bb000000004404a477',
], 'current Electron details must ignore a subframe redirect');
signatureIdentityWebContents.emit(
  'will-redirect',
  {},
  'https://www.xiaohongshu.com/explore/6f9112dd000000006606c699',
  false,
  true,
);
assert.deepStrictEqual(signatureObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6d7ff0bb000000004404a477',
  'https://www.xiaohongshu.com/explore/6f9112dd000000006606c699',
], 'deprecated positional parameters must still record a main-frame redirect');
signatureIdentityWebContents.emit(
  'will-redirect',
  {},
  'https://www.xiaohongshu.com/explore/70a223ee000000007707d7aa',
  false,
  false,
);
assert.deepStrictEqual(signatureObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6d7ff0bb000000004404a477',
  'https://www.xiaohongshu.com/explore/6f9112dd000000006606c699',
], 'deprecated positional parameters must ignore a subframe redirect');
signatureIdentityWebContents.emit('will-navigate', {
  url: 'https://www.xiaohongshu.com/explore/71b334ff000000008808e8bb',
  isMainFrame: true,
});
signatureIdentityWebContents.emit('will-navigate', {
  url: 'https://www.xiaohongshu.com/explore/72c445aa000000009909f9cc',
  isMainFrame: false,
});
signatureIdentityWebContents.emit(
  'will-navigate',
  {},
  'https://www.xiaohongshu.com/explore/73d556bb00000000aa10a0dd',
  false,
  true,
);
signatureIdentityWebContents.emit(
  'will-navigate',
  {},
  'https://www.xiaohongshu.com/explore/74e667cc00000000bb11b1ee',
  false,
  false,
);
assert.deepStrictEqual(signatureObservedIdentities, [
  'https://www.xiaohongshu.com/explore/6d7ff0bb000000004404a477',
  'https://www.xiaohongshu.com/explore/6f9112dd000000006606c699',
  'https://www.xiaohongshu.com/explore/71b334ff000000008808e8bb',
  'https://www.xiaohongshu.com/explore/73d556bb00000000aa10a0dd',
], 'will-navigate must normalize current details and deprecated positional parameters');
cleanupSignatureIdentityObserver();
assert.ok(xiaohongshuContentRendererSource.includes('installXiaohongshuIdentityObserver'));
assert.ok(xiaohongshuContentRendererSource.includes('observedIdentityUrl'));
assert.strictEqual(
  xiaohongshuContentRendererSource.includes('browserSession.webRequest.onBeforeRedirect'),
  false,
  'identity observation must not install or clear listeners on the shared persistent session',
);
assert.strictEqual(typeof helpers.selectXiaohongshuBrowserSnapshot, 'function');
const longRecommendationSnapshot = helpers.selectXiaohongshuBrowserSnapshot(
  null,
  {
    html: `<html><body>${'推荐流内容。'.repeat(1200)}</body></html>`,
    url: 'https://www.xiaohongshu.com/',
  },
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
const shorterMatchedTargetSnapshot = helpers.selectXiaohongshuBrowserSnapshot(
  longRecommendationSnapshot,
  {
    html: realStructuredXiaohongshuNoteWithGenericMetaTitleHtml,
    url: 'https://www.xiaohongshu.com/',
  },
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
assert.strictEqual(shorterMatchedTargetSnapshot.matched, true);
assert.strictEqual(
  shorterMatchedTargetSnapshot.html,
  realStructuredXiaohongshuNoteWithGenericMetaTitleHtml,
  'a shorter exact-target snapshot must replace a longer recommendation snapshot',
);
assert.strictEqual(
  shorterMatchedTargetSnapshot.identityUrl,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
const canonicalTargetHtml = realStructuredXiaohongshuNoteWithGenericMetaTitleHtml.replace(
  '<head>',
  '<head><link rel="canonical" href="https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144">',
);
const canonicalTargetSnapshot = helpers.selectXiaohongshuBrowserSnapshot(
  null,
  {
    html: canonicalTargetHtml,
    url: 'https://www.xiaohongshu.com/',
  },
  'http://xhslink.cn/o/no-note-id',
);
assert.strictEqual(canonicalTargetSnapshot.matched, true);
assert.strictEqual(
  canonicalTargetSnapshot.identityUrl,
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
  'a root landing URL must retain the canonical target identity found in the HTML',
);
const externalOriginSnapshot = helpers.selectXiaohongshuBrowserSnapshot(
  null,
  {
    html: realStructuredXiaohongshuNoteWithGenericMetaTitleHtml.replace(
      'https://sns-webpic-qc.xhscdn.com/target-note-cover.jpg',
      'http://127.0.0.1:4567/internal.jpg',
    ),
    url: 'https://attacker.example/explore/6a4ccf88000000001101d144',
  },
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
);
assert.strictEqual(
  externalOriginSnapshot.matched,
  false,
  'a hidden browser page on an external origin must never satisfy Xiaohongshu identity',
);

const textOnlyTargetWithUnrelatedFeedHtml = [
  '<html><head>',
  '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
  '</head><body><script>',
  JSON.stringify({
    noteDetailMap: {
      '6a4ccf88000000001101d144': {
        note: {
          noteId: '6a4ccf88000000001101d144',
          desc: '目标笔记只有正文，没有标题、图片或视频，不能混入推荐流素材。',
        },
      },
    },
    feed: {
      items: [{
        noteId: '000000000000000000000099',
        displayTitle: '推荐流标题',
        desc: '推荐流正文',
        user: { nickname: '推荐流作者' },
        imageList: [{
          urlDefault: 'https://sns-webpic-qc.xhscdn.com/cards/unrelated-feed.jpg',
        }],
        video: {
          media: {
            stream: {
              h264: [{ masterUrl: 'https://sns-video.xhscdn.com/unrelated-feed.mp4' }],
            },
          },
        },
      }],
    },
  }),
  '</script></body></html>',
].join('');
const textOnlyTargetWithUnrelatedFeed = helpers.extractXiaohongshuMarkdownFromHtml(
  textOnlyTargetWithUnrelatedFeedHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
assert.strictEqual(textOnlyTargetWithUnrelatedFeed.title, '小红书笔记');
assert.ok(textOnlyTargetWithUnrelatedFeed.description.includes('目标笔记只有正文'));
assert.deepStrictEqual(textOnlyTargetWithUnrelatedFeed.imageUrls, []);
assert.strictEqual(textOnlyTargetWithUnrelatedFeed.videoUrl, '');
assert.strictEqual(textOnlyTargetWithUnrelatedFeed.author, '');

const targetNoteWithNestedRelatedVideoHtml = [
  '<html><head>',
  '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
  '</head><body><script>',
  JSON.stringify({
    noteDetailMap: {
      '6a4ccf88000000001101d144': {
        note: {
          noteId: '6a4ccf88000000001101d144',
          displayTitle: '目标图文笔记',
          desc: '目标笔记本身是图文，关联推荐视频不能冒充它的视频。',
          imageList: [{
            urlDefault: 'https://sns-webpic-qc.xhscdn.com/target-graphic.jpg',
          }],
          related: {
            video: {
              media: {
                stream: {
                  h264: [{
                    masterUrl: 'https://sns-video.xhscdn.com/unrelated-nested-video.mp4',
                  }],
                },
              },
            },
          },
        },
      },
    },
  }),
  '</script></body></html>',
].join('');
const targetNoteWithNestedRelatedVideo = helpers.extractXiaohongshuMarkdownFromHtml(
  targetNoteWithNestedRelatedVideoHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
assert.strictEqual(
  targetNoteWithNestedRelatedVideo.videoUrl,
  '',
  'a related recommendation video nested inside the target object must not become the target video',
);

const targetNoteWithNestedRelatedCardHtml = [
  '<html><head><meta property="og:title" content="小红书 - 你的生活兴趣社区"></head><body><script>',
  JSON.stringify({
    noteDetailMap: {
      '6a4ccf88000000001101d144': {
        note: {
          noteId: '6a4ccf88000000001101d144',
          displayTitle: 'TARGET TITLE',
          desc: 'TARGET BODY',
          imageList: [{
            urlDefault: 'https://sns-webpic-qc.xhscdn.com/target-card.jpg',
          }],
          related: {
            displayTitle: 'RELATED TITLE',
            desc: 'RELATED BODY '.repeat(80),
            imageList: Array.from({ length: 10 }, (_, index) => ({
              urlDefault: `https://sns-webpic-qc.xhscdn.com/related-${index}.jpg`,
            })),
          },
        },
      },
    },
  }),
  '</script></body></html>',
].join('');
const targetNoteWithNestedRelatedCard = helpers.extractXiaohongshuMarkdownFromHtml(
  targetNoteWithNestedRelatedCardHtml,
  'https://www.xiaohongshu.com/discovery/item/6a4ccf88000000001101d144',
);
assert.strictEqual(targetNoteWithNestedRelatedCard.title, 'TARGET TITLE');
assert.strictEqual(targetNoteWithNestedRelatedCard.description, 'TARGET BODY');
assert.deepStrictEqual(targetNoteWithNestedRelatedCard.imageUrls, [
  'https://sns-webpic-qc.xhscdn.com/target-card.jpg',
]);

const targetImageWithForeignPageMetaHtml = [
  '<html><head>',
  '<link rel="canonical" href="https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144">',
  '<meta property="og:title" content="FOREIGN_RECOMMENDATION_TITLE">',
  '<meta name="description" content="FOREIGN_RECOMMENDATION_BODY">',
  '</head><body><script>',
  JSON.stringify({
    noteDetailMap: {
      '6a4ccf88000000001101d144': {
        note: {
          noteId: '6a4ccf88000000001101d144',
          imageList: [{
            urlDefault: 'https://sns-webpic-qc.xhscdn.com/identity-bound-only.jpg',
          }],
        },
      },
    },
  }),
  '</script></body></html>',
].join('');
const targetImageWithForeignPageMeta = helpers.extractXiaohongshuMarkdownFromHtml(
  targetImageWithForeignPageMetaHtml,
  'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144',
);
assert.strictEqual(targetImageWithForeignPageMeta.xiaohongshuPrimaryNoteMatched, true);
assert.strictEqual(targetImageWithForeignPageMeta.title, '小红书笔记');
assert.strictEqual(targetImageWithForeignPageMeta.description, '');
assert.strictEqual(targetImageWithForeignPageMeta.markdown.includes('FOREIGN_RECOMMENDATION'), false);
assert.deepStrictEqual(targetImageWithForeignPageMeta.imageUrls, [
  'https://sns-webpic-qc.xhscdn.com/identity-bound-only.jpg',
]);

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
assert.deepStrictEqual(
  helpers.extractSocialCommentsFromHtml([
    '<div class="comments-container">',
    '<div class="comment-item">共 84 条评论 - 回复</div>',
    '<div class="comment-item">12</div>',
    '</div>',
  ].join('')),
  [],
);
assert.deepStrictEqual(
  helpers.extractSocialCommentsFromHtml([
    '<script>window.__INITIAL_STATE__={comment_list:[{content:"真实评论内容",user_info:{nickname:"真实用户"},like_count:6}]};</script>',
  ].join('')),
  [{ author: '真实用户', content: '真实评论内容', time: '', likes: '6' }],
);

const xiaohongshuNestedComments = helpers.extractSocialCommentsFromHtml([
  '<script>window.__INITIAL_STATE__={comments:[',
  '{content:"父评论",user_info:{nickname:"主评论用户"},like_count:8,sub_comments:[',
  '{content:"展开后的回复",user_info:{nickname:"回复用户"},like_count:2},',
  '{content:"展开后的回复",user_info:{nickname:"回复用户"},like_count:2}',
  ']}]};</script>',
].join(''), 100);
assert.deepStrictEqual(xiaohongshuNestedComments, [{
  author: '主评论用户',
  content: '父评论',
  time: '',
  likes: '8',
  replies: [{
    author: '回复用户',
    content: '展开后的回复',
    time: '',
    likes: '2',
  }],
}]);
assert.strictEqual(typeof helpers.buildSocialCommentsMarkdown, 'function');
assert.ok(helpers.buildSocialCommentsMarkdown(xiaohongshuNestedComments).includes('  - ↳ **回复用户**：展开后的回复（2 赞）'));
assert.strictEqual(typeof helpers.getSocialCommentTreeStats, 'function');
assert.deepStrictEqual(helpers.getSocialCommentTreeStats(xiaohongshuNestedComments), {
  rootCount: 1,
  replyCount: 1,
});
const storedXiaohongshuNestedMarkdown = helpers.cleanMarkdownForStorage(
  helpers.buildSocialCommentsMarkdown(xiaohongshuNestedComments),
  { preserveListIndent: true },
);
assert.ok(storedXiaohongshuNestedMarkdown.includes('\n  - ↳ **回复用户**：展开后的回复（2 赞）'));

const xiaohongshuPagedCommentPayloads = Array.from({ length: 4 }, (_unused, pageIndex) => ({
  data: {
    comments: Array.from({ length: 50 }, (_comment, commentIndex) => {
      const id = pageIndex * 50 + commentIndex;
      return {
        id: `root-${id}`,
        content: `第 ${id} 条分页评论`,
        user_info: { nickname: '分页用户' },
      };
    }),
    cursor: pageIndex < 3 ? `cursor-${pageIndex + 1}` : '',
    has_more: pageIndex < 3,
  },
}));
const xiaohongshuPagedComments = helpers.collectXiaohongshuCommentPages(xiaohongshuPagedCommentPayloads);
assert.strictEqual(xiaohongshuPagedComments.comments.length, 200);
assert.strictEqual(xiaohongshuPagedComments.pageCount, 4);
assert.strictEqual(xiaohongshuPagedComments.stopReason, 'exhausted');
assert.strictEqual(
  helpers.collectXiaohongshuCommentPages([{
    data: {
      comments: [
        { id: 'duplicate-a', content: '同一用户的重复文案', user_info: { nickname: '重复用户' } },
        { id: 'duplicate-b', content: '同一用户的重复文案', user_info: { nickname: '重复用户' } },
      ],
      has_more: false,
    },
  }]).comments.length,
  2,
);
const xiaohongshuReplyPagedComments = helpers.mergeXiaohongshuReplyPages([
  {
    id: 'root-with-replies',
    author: '主评论用户',
    content: '需要展开回复的主评论',
    replies: [{ id: 'reply-1', author: '回复用户甲', content: '首屏回复' }],
  },
], 'root-with-replies', [
  {
    data: {
      comments: [{ id: 'reply-2', root_comment_id: 'root-with-replies', content: '第二条折叠回复', user_info: { nickname: '回复用户乙' } }],
      cursor: 'reply-cursor-2',
      has_more: true,
    },
  },
  {
    data: {
      comments: [{ id: 'reply-3', root_comment_id: 'root-with-replies', content: '第三条折叠回复', user_info: { nickname: '回复用户丙' } }],
      has_more: false,
    },
  },
]);
assert.strictEqual(xiaohongshuReplyPagedComments[0].replies.length, 3);
assert.ok(helpers.buildSocialCommentsMarkdown(xiaohongshuReplyPagedComments).includes('  - ↳ **回复用户丙**：第三条折叠回复'));
assert.strictEqual(typeof helpers.mergeXiaohongshuCapturedCommentPayloads, 'function');
const capturedXiaohongshuCommentResult = helpers.mergeXiaohongshuCapturedCommentPayloads([
  {
    url: 'https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-1',
    payload: {
      data: {
        comments: [{ id: 'captured-root-1', user_info: { nickname: '主评论用户' }, content: '主评论内容' }],
        has_more: false,
      },
    },
  },
  {
    url: 'https://www.xiaohongshu.com/api/sns/web/v2/comment/sub/page?note_id=note-1&root_comment_id=captured-root-1',
    payload: {
      data: {
        comments: [{ id: 'captured-reply-1', user_info: { nickname: '回复用户' }, content: '折叠回复内容' }],
        has_more: false,
      },
    },
  },
]);
assert.strictEqual(capturedXiaohongshuCommentResult.comments.length, 1);
assert.strictEqual(capturedXiaohongshuCommentResult.comments[0].replies.length, 1);
assert.strictEqual(capturedXiaohongshuCommentResult.comments[0].replies[0].content, '折叠回复内容');
assert.strictEqual(capturedXiaohongshuCommentResult.rootPayloadCount, 1);
assert.strictEqual(capturedXiaohongshuCommentResult.replyPayloadCount, 1);
assert.strictEqual(capturedXiaohongshuCommentResult.rootPageCount, 1);
assert.strictEqual(capturedXiaohongshuCommentResult.replyPageCount, 1);
assert.strictEqual(capturedXiaohongshuCommentResult.stopReason, 'exhausted');
const identityFilteredCapturedComments = helpers.mergeXiaohongshuCapturedCommentPayloads([
  {
    sequence: 1,
    url: 'https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=foreign-note',
    payload: {
      data: {
        note_id: 'foreign-note',
        comments: [{ id: 'foreign-root', content: 'FOREIGN_COMMENT' }],
        has_more: false,
      },
    },
  },
  {
    sequence: 2,
    url: 'https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=target-note',
    payload: {
      data: {
        note_id: 'target-note',
        comments: [{ id: 'target-root', content: 'TARGET_COMMENT' }],
        has_more: false,
      },
    },
  },
], 200, { expectedNoteId: 'target-note' });
assert.deepStrictEqual(
  identityFilteredCapturedComments.comments.map((comment) => comment.content),
  ['TARGET_COMMENT'],
);
assert.strictEqual(identityFilteredCapturedComments.rootPayloadCount, 1);
assert.strictEqual(typeof helpers.mergeXiaohongshuCommentSources, 'function');
const canonicalXiaohongshuComments = helpers.mergeXiaohongshuCommentSources({
  networkComments: [{
    id: 'canonical-root-1',
    author: '用户甲',
    content: '同一条评论',
    time: '1780000000000',
    replies: [{
      id: 'canonical-reply-1',
      author: '用户乙',
      content: '折叠回复',
      time: '1780000001000',
    }],
  }],
  fallbackGroups: [[
    { author: '用户甲', content: '同一条评论', time: '1天前上海' },
    { author: '用户乙', content: '折叠回复', time: '1天前广东' },
    { author: '用户丙', content: '真正新增评论', time: '刚刚', domRole: 'root' },
  ]],
  limit: 200,
});
assert.strictEqual(canonicalXiaohongshuComments.comments.length, 2);
assert.strictEqual(canonicalXiaohongshuComments.comments[0].replies.length, 1);
assert.strictEqual(canonicalXiaohongshuComments.comments[1].content, '真正新增评论');
assert.strictEqual(canonicalXiaohongshuComments.dedupedFallbackCount, 2);
assert.strictEqual(canonicalXiaohongshuComments.fallbackAddedCount, 1);

const symbolicAuthorXiaohongshuComments = helpers.mergeXiaohongshuCommentSources({
  networkComments: [{
    id: 'symbolic-author-root',
    author: '。。。',
    content: '科技改变生活了也是',
    time: '1780000000000',
  }],
  fallbackGroups: [[{
    author: '。。。',
    content: '科技改变生活了也是',
    time: '04-08江西',
    domRole: 'root',
  }]],
  limit: 200,
});
assert.strictEqual(symbolicAuthorXiaohongshuComments.comments.length, 1);
assert.strictEqual(symbolicAuthorXiaohongshuComments.dedupedFallbackCount, 1);

const losslessNetworkRoots = Array.from({ length: 74 }, (_unused, index) => ({
  id: `lossless-root-${index}`,
  author: `主评论用户${index}`,
  content: `主评论正文${index}`,
  replies: index < 19 ? [{
    id: `lossless-reply-${index}`,
    author: `回复用户${index}`,
    content: `回复正文${index}`,
  }] : [],
}));
assert.strictEqual(typeof helpers.finalizeXiaohongshuComments, 'function');
const productionShapedXiaohongshuFinalization = helpers.finalizeXiaohongshuComments({
  baseMarkdown: [
    '# 小红书正文',
    '',
    '正文内容',
    '',
    '## 评论区',
    '',
    '- **旧静态用户**：不应继续保留的旧评论区',
    '  - ↳ **旧回复一**：旧回复一',
    '  - ↳ **旧回复二**：旧回复二',
    '  - ↳ **旧回复三**：旧回复三',
  ].join('\n'),
  renderedComments: losslessNetworkRoots,
  staticComments: [
    {
      author: '主评论用户0',
      content: '主评论正文0[doge]',
      time: '1天前上海',
      domRole: 'root',
    },
    {
      author: '主评论用户1',
      content: '主评论正文1',
      time: '2026-07-14',
      domRole: 'root',
    },
  ],
  diagnosticDetails: {
    source: 'browser-network',
    rootCount: 74,
    replyCount: 19,
    mergedRootCount: 74,
    mergedReplyCount: 19,
    stopReason: 'exhausted',
  },
  limit: 200,
});
assert.deepStrictEqual(productionShapedXiaohongshuFinalization.stats, {
  rootCount: 74,
  replyCount: 19,
});
assert.deepStrictEqual(
  helpers.getSocialCommentMarkdownStats(productionShapedXiaohongshuFinalization.markdown),
  { rootCount: 74, replyCount: 19 },
);
assert.strictEqual(productionShapedXiaohongshuFinalization.markdown.includes('旧静态用户'), false);
assert.strictEqual(productionShapedXiaohongshuFinalization.markdown.includes('旧回复三'), false);
assert.strictEqual(productionShapedXiaohongshuFinalization.diagnosticDetails.lostRootCount, 0);
assert.strictEqual(productionShapedXiaohongshuFinalization.diagnosticDetails.lostReplyCount, 0);
assert.strictEqual(productionShapedXiaohongshuFinalization.diagnosticDetails.fallbackAddedCount, 0);

const fallbackEmojiDuplicateFinalization = helpers.finalizeXiaohongshuComments({
  baseMarkdown: '# 正文',
  renderedComments: [],
  staticComments: [
    { author: '墨烟轻云', content: '同一条评论[doge]', time: '1天前', domRole: 'root' },
    { author: '墨烟轻云', content: '同一条评论', time: '2026-07-14', domRole: 'root' },
  ],
  limit: 200,
});
assert.strictEqual(fallbackEmojiDuplicateFinalization.comments.length, 1);

const sameTextDistinctIdsFinalization = helpers.finalizeXiaohongshuComments({
  baseMarkdown: '# 正文',
  renderedComments: [
    { id: 'same-text-a', author: '复读用户', content: '相同正文' },
    { id: 'same-text-b', author: '复读用户', content: '相同正文' },
  ],
  staticComments: [],
  limit: 200,
});
assert.strictEqual(sameTextDistinctIdsFinalization.comments.length, 2);

assert.strictEqual(typeof helpers.didXiaohongshuRootCollectionProgress, 'function');
assert.strictEqual(helpers.didXiaohongshuRootCollectionProgress(
  { rootCommentCount: 10, rootRequestCount: 1, replyCommentCount: 2, replyRequestCount: 1, scrollTop: 100, scrollHeight: 1000 },
  { rootCommentCount: 10, rootRequestCount: 1, replyCommentCount: 20, replyRequestCount: 8, scrollTop: 100, scrollHeight: 1000 },
), false);
assert.strictEqual(helpers.didXiaohongshuRootCollectionProgress(
  { rootCommentCount: 10, rootRequestCount: 1, replyCommentCount: 20, replyRequestCount: 8, scrollTop: 100, scrollHeight: 1000 },
  { rootCommentCount: 11, rootRequestCount: 2, replyCommentCount: 20, replyRequestCount: 8, scrollTop: 700, scrollHeight: 1400 },
), true);

const losslessNetworkMerge = helpers.mergeXiaohongshuCommentSources({
  networkComments: losslessNetworkRoots,
  fallbackGroups: [[{ author: '补充用户', content: '真正新增的 DOM 主评论', domRole: 'root' }]],
  limit: 200,
});
assert.deepStrictEqual(helpers.getSocialCommentTreeStats(losslessNetworkMerge.comments), {
  rootCount: 75,
  replyCount: 19,
});
assert.strictEqual(losslessNetworkMerge.networkRootCount, 74);
assert.strictEqual(losslessNetworkMerge.networkReplyCount, 19);
assert.strictEqual(losslessNetworkMerge.restoredRootCount, 0);
assert.strictEqual(losslessNetworkMerge.restoredReplyCount, 0);
assert.strictEqual(losslessNetworkMerge.lostRootCount, 0);
assert.strictEqual(losslessNetworkMerge.lostReplyCount, 0);

const hardenedXiaohongshuFallback = helpers.mergeXiaohongshuCommentSources({
  networkComments: [{
    id: 'hardened-root-1',
    author: '蓝爽',
    content: '刚开始操作，还想把视频保存下来有没有方法[笑哭R]',
  }],
  fallbackGroups: [[
    { author: '蓝爽', content: '刚开始操作，还想把视频保存下来有没有方法……展开', domRole: 'root' },
    { author: '问一问', content: '小红书评论区大家都在问什么？问一问为你总结', domRole: 'root' },
    { author: '蓝爽', content: '蓝爽', domRole: 'root' },
    { author: '结构不明用户', content: '不能证明是主评论的 DOM 文本' },
  ]],
  limit: 200,
});
assert.strictEqual(hardenedXiaohongshuFallback.comments.length, 1);
assert.strictEqual(hardenedXiaohongshuFallback.dedupedFallbackCount, 1);
assert.strictEqual(hardenedXiaohongshuFallback.droppedFallbackCount, 3);

const structuredDomReply = helpers.mergeXiaohongshuCommentSources({
  networkComments: [{ id: 'structured-parent-1', author: '父评论用户', content: '父评论正文' }],
  fallbackGroups: [[{
    author: '回复用户',
    content: 'DOM 中没有“回复某人”前缀的折叠回复',
    domRole: 'reply',
    parentCommentId: 'structured-parent-1',
  }]],
  limit: 200,
});
assert.strictEqual(structuredDomReply.comments.length, 1);
assert.strictEqual(structuredDomReply.comments[0].replies.length, 1);
assert.strictEqual(structuredDomReply.comments[0].replies[0].content, 'DOM 中没有“回复某人”前缀的折叠回复');

const formattedXiaohongshuComments = helpers.buildSocialCommentsMarkdown([{
  author: '格式用户',
  content: '格式化评论',
  time: '1712102400000',
  likes: '赞',
  replies: [{ author: '回复用户', content: '格式化回复', likes: '35赞' }],
}]);
assert.ok(formattedXiaohongshuComments.includes('2024-04-03 · 赞'));
assert.ok(formattedXiaohongshuComments.includes('35 赞'));
assert.strictEqual(formattedXiaohongshuComments.includes('赞 赞'), false);
assert.deepStrictEqual(helpers.getSocialCommentMarkdownStats(formattedXiaohongshuComments), {
  rootCount: 1,
  replyCount: 1,
});

const mergedXiaohongshuNetworkVariants = helpers.mergeXiaohongshuCommentSources({
  networkComments: [
    { id: 'network-root-variant', author: '主评论用户', content: '同一条主评论' },
    {
      id: 'network-root-variant',
      author: '主评论用户',
      content: '同一条主评论',
      replies: [
        { id: 'network-reply-a', author: '回复用户甲', content: '第一条回复' },
        { id: 'network-reply-b', author: '回复用户乙', content: '第二条回复' },
      ],
    },
  ],
  fallbackGroups: [],
  limit: 200,
});
assert.strictEqual(mergedXiaohongshuNetworkVariants.comments.length, 1);
assert.strictEqual(mergedXiaohongshuNetworkVariants.comments[0].replies.length, 2);

assert.strictEqual(typeof helpers.preserveXiaohongshuPrimaryCommentTree, 'function');
const preservedXiaohongshuPrimaryTree = helpers.preserveXiaohongshuPrimaryCommentTree(
  [{
    id: 'preserved-root',
    author: '主评论用户',
    content: '主评论正文',
    replies: Array.from({ length: 19 }, (_unused, index) => ({
      id: `preserved-reply-${index}`,
      author: `回复用户${index}`,
      content: `回复正文${index}`,
    })),
  }],
  [{ id: 'preserved-root', author: '主评论用户', content: '主评论正文' }],
  200,
);
assert.deepStrictEqual(helpers.getSocialCommentTreeStats(preservedXiaohongshuPrimaryTree), {
  rootCount: 1,
  replyCount: 19,
});

const attachedDomReply = helpers.mergeXiaohongshuCommentSources({
  networkComments: [{ id: 'dom-parent-1', author: '父评论用户', content: '父评论正文' }],
  fallbackGroups: [[{
    author: '回复用户',
    content: '回复 父评论用户 : DOM 中新增的回复',
    time: '1天前广东',
  }]],
  limit: 200,
});
assert.strictEqual(attachedDomReply.comments.length, 1);
assert.strictEqual(attachedDomReply.comments[0].replies.length, 1);
assert.strictEqual(attachedDomReply.comments[0].replies[0].content, 'DOM 中新增的回复');
assert.strictEqual(attachedDomReply.fallbackReplyAddedCount, 1);

const unmatchedDomReply = helpers.mergeXiaohongshuCommentSources({
  networkComments: [],
  fallbackGroups: [[{
    author: '回复用户',
    content: '回复 不存在的父评论 : 不能平铺成主评论',
    time: '1天前广东',
  }]],
  limit: 200,
});
assert.deepStrictEqual(unmatchedDomReply.comments, []);
assert.strictEqual(unmatchedDomReply.unmatchedFallbackReplyCount, 1);

const unmatchedCapturedXiaohongshuReplies = helpers.mergeXiaohongshuCapturedCommentPayloads([
  {
    url: 'https://www.xiaohongshu.com/api/sns/web/v2/comment/sub/page?note_id=note-1&root_comment_id=missing-root',
    payload: {
      data: {
        comments: [{ id: 'unmatched-reply-1', root_comment_id: 'missing-root', content: '不能平铺的回复', user_info: { nickname: '回复用户' } }],
        has_more: false,
      },
    },
  },
]);
assert.deepStrictEqual(unmatchedCapturedXiaohongshuReplies.comments, []);
assert.strictEqual(unmatchedCapturedXiaohongshuReplies.unmatchedReplyCount, 1);
assert.strictEqual(unmatchedCapturedXiaohongshuReplies.deferredReplyGroups.length, 1);
const recoveredDeferredXiaohongshuReplies = helpers.mergeXiaohongshuCommentSources({
  networkComments: [{ id: 'missing-root', author: '后到的主评论用户', content: '后到的主评论正文' }],
  deferredReplyGroups: unmatchedCapturedXiaohongshuReplies.deferredReplyGroups,
  fallbackGroups: [],
  limit: 200,
});
assert.strictEqual(recoveredDeferredXiaohongshuReplies.comments.length, 1);
assert.strictEqual(recoveredDeferredXiaohongshuReplies.comments[0].replies.length, 1);
assert.strictEqual(recoveredDeferredXiaohongshuReplies.comments[0].replies[0].content, '不能平铺的回复');
assert.strictEqual(recoveredDeferredXiaohongshuReplies.unmatchedDeferredReplyCount, 0);
assert.strictEqual(
  helpers.mergeXiaohongshuReplyPages([{
    id: 'root-many-replies',
    author: '主评论用户',
    content: '有很多回复的主评论',
    replies: Array.from({ length: 25 }, (_unused, index) => ({
      id: `many-reply-${index}`,
      author: '回复用户',
      content: `第 ${index} 条回复`,
    })),
  }], 'root-many-replies', [])[0].replies.length,
  25,
);
assert.strictEqual(helpers.XIAOHONGSHU_TOTAL_COMMENT_LIMIT, 300);
assert.strictEqual(typeof helpers.limitSocialCommentTreeTotal, 'function');
const oversizedXiaohongshuCommentTree = Array.from({ length: 3 }, (_unused, rootIndex) => ({
  id: `budget-root-${rootIndex}`,
  author: `一级评论用户${rootIndex}`,
  content: `一级评论正文${rootIndex}`,
  replies: Array.from({ length: 150 }, (_replyUnused, replyIndex) => ({
    id: `budget-reply-${rootIndex}-${replyIndex}`,
    author: `回复用户${rootIndex}-${replyIndex}`,
    content: `回复正文${rootIndex}-${replyIndex}`,
  })),
}));
const limitedXiaohongshuCommentTree = helpers.limitSocialCommentTreeTotal(
  oversizedXiaohongshuCommentTree,
  helpers.XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
);
const limitedXiaohongshuCommentStats = helpers.getSocialCommentTreeStats(limitedXiaohongshuCommentTree);
assert.strictEqual(limitedXiaohongshuCommentStats.rootCount + limitedXiaohongshuCommentStats.replyCount, 300);
assert.deepStrictEqual(
  limitedXiaohongshuCommentTree.map((comment) => comment.id),
  ['budget-root-0', 'budget-root-1', 'budget-root-2'],
);
assert.strictEqual(oversizedXiaohongshuCommentTree[1].replies.length, 150);
const finalizedXiaohongshuCommentBudget = helpers.finalizeXiaohongshuComments({
  baseMarkdown: '# 正文',
  renderedComments: oversizedXiaohongshuCommentTree,
  diagnosticDetails: { stopReason: 'total_limit_reached' },
  limit: 300,
});
assert.strictEqual(
  finalizedXiaohongshuCommentBudget.stats.rootCount + finalizedXiaohongshuCommentBudget.stats.replyCount,
  300,
);
assert.strictEqual(
  finalizedXiaohongshuCommentBudget.markdownStats.rootCount + finalizedXiaohongshuCommentBudget.markdownStats.replyCount,
  300,
);
assert.strictEqual(finalizedXiaohongshuCommentBudget.diagnosticDetails.partial, true);
assert.strictEqual(helpers.XIAOHONGSHU_COMMENT_TIMEOUT_MS, 90000);
assert.strictEqual(typeof helpers.getXiaohongshuCommentBudgetState, 'function');
assert.deepStrictEqual(
  helpers.getXiaohongshuCommentBudgetState({ deadlineAt: 100000, now: 99999, totalCount: 299 }),
  { shouldStop: false, stopReason: '', remainingMs: 1 },
);
assert.deepStrictEqual(
  helpers.getXiaohongshuCommentBudgetState({ deadlineAt: 100000, now: 100000, totalCount: 299 }),
  { shouldStop: true, stopReason: 'time_budget_exceeded', remainingMs: 0 },
);
assert.deepStrictEqual(
  helpers.getXiaohongshuCommentBudgetState({ deadlineAt: 100000, now: 90000, totalCount: 300 }),
  { shouldStop: true, stopReason: 'total_limit_reached', remainingMs: 10000 },
);
const xiaohongshuCommentDiagnostic = helpers.buildXiaohongshuCommentDiagnostic({
  source: 'page-api',
  rootCount: 200,
  replyCount: 3,
  pageCount: 4,
  rootPageCount: 4,
  replyPageCount: 0,
  finalRootCount: 198,
  finalReplyCount: 3,
  mergedRootCount: 198,
  mergedReplyCount: 3,
  restoredRootCount: 0,
  restoredReplyCount: 2,
  lostRootCount: 0,
  lostReplyCount: 0,
  fallbackAddedCount: 2,
  dedupedFallbackCount: 8,
  unmatchedReplyCount: 0,
  invalidPayloadCount: 1,
  rootRequestCount: 4,
  replyRequestCount: 7,
  partial: true,
  scrollMode: 'comment_container',
  pageApiStopReason: 'root_unavailable',
  stopReason: 'limit_reached',
  cookie: 'must-not-leak',
});
assert.match(xiaohongshuCommentDiagnostic, /^<!-- xhs-comment-diag: source=page-api; root=200; replies=3; pages=4; root_pages=4; reply_pages=0; root_requests=4; reply_requests=7; merged_root=198; merged_replies=3; restored_root=0; restored_replies=2; final_root=198; final_replies=3; lost_root=0; lost_replies=0; fallback=2; deduped=8; dropped=0; unmatched=0; invalid=1; partial=1; scroll=comment_container; api_stop=root_unavailable; stop=limit_reached -->$/);
assert.strictEqual(xiaohongshuCommentDiagnostic.includes('must-not-leak'), false);
assert.strictEqual(
  helpers.appendXiaohongshuCommentDiagnostic('# 正文\n\n<!-- xhs-comment-diag: source=old; root=1; replies=0; pages=1; stop=old -->', xiaohongshuCommentDiagnostic),
  `# 正文\n\n${xiaohongshuCommentDiagnostic}`,
);
const xiaohongshuCommentPaginationScript = helpers.getXiaohongshuCommentPaginationScript(
  'https://www.xiaohongshu.com/explore/demo-note?xsec_token=demo-token',
  { deadlineAt: 123456, totalLimit: 300 },
);
assert.match(xiaohongshuCommentPaginationScript, /credentials:\s*'include'/);
assert.match(xiaohongshuCommentPaginationScript, /\/api\/sns\/web\/v2\/comment\/page/);
assert.match(xiaohongshuCommentPaginationScript, /\/api\/sns\/web\/v2\/comment\/sub\/page/);
assert.match(xiaohongshuCommentPaginationScript, /XIAOHONGSHU_ROOT_COMMENT_LIMIT/);
assert.match(xiaohongshuCommentPaginationScript, /const deadlineAt = 123456/);
assert.match(xiaohongshuCommentPaginationScript, /AbortController/);
assert.match(xiaohongshuCommentPaginationScript, /time_budget_exceeded/);
assert.match(xiaohongshuCommentPaginationScript, /total_limit_reached/);
assert.doesNotThrow(() => new Function(`return ${xiaohongshuCommentPaginationScript};`));
assert.match(pluginMainSource, /mergeXiaohongshuCapturedCommentPayloads/);
assert.match(pluginMainSource, /debuggerCommentPayloads/);
assert.match(pluginMainSource, /data-testid\*="reply"/);
const xiaohongshuRendererSource = pluginMainSource.slice(
  pluginMainSource.indexOf('async function renderXiaohongshuPageWithElectron'),
  pluginMainSource.indexOf('async function renderXiaohongshuCommentsWithElectron'),
);
assert.match(xiaohongshuRendererSource, /findCommentScrollContainer/);
assert.match(xiaohongshuRendererSource, /scrollTop\s*=\s*Math\.min/);
assert.match(xiaohongshuRendererSource, /dispatchEvent\(new Event\('scroll'/);
assert.match(xiaohongshuRendererSource, /dispatchEvent\(new WheelEvent\('wheel'/);
assert.match(xiaohongshuRendererSource, /idleRounds/);
assert.match(xiaohongshuRendererSource, /mergeXiaohongshuCommentSources/);
assert.match(xiaohongshuRendererSource, /didRootCollectionProgress/);
assert.match(xiaohongshuRendererSource, /rootRequestCount/);
assert.match(xiaohongshuRendererSource, /replyRequestCount/);
assert.match(xiaohongshuRendererSource, /replySettlingRounds/);
assert.match(xiaohongshuRendererSource, /mainCommentListBonus/);
assert.match(xiaohongshuRendererSource, /nestedReplyPenalty/);
assert.match(xiaohongshuRendererSource, /nestedReplyAncestor/);
assert.match(xiaohongshuRendererSource, /drainDebuggerBodyTasks/);
assert.match(xiaohongshuRendererSource, /beginBestEffortBrowserLoad\(win, url\)/);
assert.strictEqual(xiaohongshuRendererSource.includes('await win.loadURL(url)'), false);
assert.match(xiaohongshuRendererSource, /XIAOHONGSHU_COMMENT_TIMEOUT_MS/);
assert.match(xiaohongshuRendererSource, /getXiaohongshuCommentBudgetState/);
assert.match(xiaohongshuRendererSource, /waitForBrowserTasksWithin\(pending, remainingMs\)/);
assert.match(xiaohongshuRendererSource, /deferredReplyGroups:\s*browserNetworkResult\.deferredReplyGroups/);
assert.match(xiaohongshuRendererSource, /preserveXiaohongshuPrimaryCommentTree/);
assert.strictEqual(xiaohongshuRendererSource.includes('const commentBonus = /comment|reply/i.test(marker)'), false);
assert.strictEqual(xiaohongshuRendererSource.includes('for (let index = 0; index < 24; index += 1)'), false);
const xiaohongshuFinalizationSource = pluginMainSource.slice(
  pluginMainSource.indexOf('const renderedXiaohongshuComments'),
  pluginMainSource.indexOf('const isXiaohongshuVideoNote'),
);
assert.match(xiaohongshuFinalizationSource, /finalizeXiaohongshuComments/);
assert.strictEqual(xiaohongshuFinalizationSource.includes('finalXiaohongshuMerge'), false);
assert.strictEqual(
  xiaohongshuFinalizationSource.includes('appendSocialCommentsToMarkdown(extractedXiaohongshu.markdown, mergedXiaohongshuComments)'),
  false,
);

const rejectedCapturedXiaohongshuPayload = helpers.mergeXiaohongshuCapturedCommentPayloads([{
  url: 'https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-1',
  payload: { success: false, code: -100, msg: 'request rejected' },
}]);
assert.strictEqual(rejectedCapturedXiaohongshuPayload.rootPayloadCount, 0);
assert.strictEqual(rejectedCapturedXiaohongshuPayload.invalidPayloadCount, 1);

const outOfOrderCapturedXiaohongshuPages = helpers.mergeXiaohongshuCapturedCommentPayloads([
  {
    sequence: 2,
    url: 'https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-1&cursor=next',
    payload: {
      data: {
        comments: [{ id: 'ordered-root-2', content: '第二页评论', user_info: { nickname: '分页用户' } }],
        has_more: false,
      },
    },
  },
  {
    sequence: 1,
    url: 'https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-1',
    payload: {
      data: {
        comments: [{ id: 'ordered-root-1', content: '第一页评论', user_info: { nickname: '分页用户' } }],
        cursor: 'next',
        has_more: true,
      },
    },
  },
]);
assert.deepStrictEqual(
  outOfOrderCapturedXiaohongshuPages.comments.map((comment) => comment.id),
  ['ordered-root-1', 'ordered-root-2'],
);
assert.strictEqual(outOfOrderCapturedXiaohongshuPages.rootPageCount, 2);

const xiaohongshuImageArrayNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Image Array Title">',
  '<meta name="description" content="3 亿人的生活经验，都在小红书">',
  '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/spectrum/cover!nd_dft_wlteh_jpg_3">',
  '</head><body>',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"真正的图文正文第一段。\\n真正的图文正文第二段。 #图文笔记","imageList":["https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/cover!nd_dft_wlteh_jpg_3","https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/inner-a!nd_dft_wlteh_jpg_3","https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/inner-b!nd_dft_wlteh_jpg_3"]}}</script>',
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

const xiaohongshuMultiQualityImageNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Multi Quality Images">',
  '<meta name="description" content="每页只保留高质量图片。 #高清图">',
  '</head><body>',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"每页只保留高质量图片。 #高清图","imageList":[',
  '{"urlPre":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/thumb\\/page-1!nd_prv_wlteh_jpg_1","urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/original\\/page-1!nd_dft_wlteh_jpg_3"},',
  '{"urlPre":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/thumb\\/page-2!nd_prv_wlteh_jpg_1","urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/original\\/page-2!nd_dft_wlteh_jpg_3"}',
  ']}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/multi-quality-images');
assert.deepStrictEqual(xiaohongshuMultiQualityImageNote.imageUrls, [
  'https://sns-webpic-qc.xhscdn.com/original/page-1!nd_dft_wlteh_jpg_3',
  'https://sns-webpic-qc.xhscdn.com/original/page-2!nd_dft_wlteh_jpg_3',
]);
assert.strictEqual(xiaohongshuMultiQualityImageNote.markdown.includes('/thumb/'), false);

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

const xiaohongshuDomThumbnailAndStructuredOriginalNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<title>结构化高清图优先 - 小红书</title>',
  '<meta property="og:description" content="公开分享页正文。 #高清图">',
  '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/thumb-assets/slide-a-thumb.jpg">',
  '</head><body>',
  '<img src="https://sns-webpic-qc.xhscdn.com/thumb-assets/slide-a-thumb.jpg">',
  '<img src="https://sns-webpic-qc.xhscdn.com/thumb-assets/slide-b-thumb.jpg">',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"公开分享页正文。 #高清图","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/original-assets\\/slide-a-original.jpg"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/original-assets\\/slide-b-original.jpg"}]}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/discovery/item/anonymous-structured-note?xsec_token=public-share-token');
assert.deepStrictEqual(xiaohongshuDomThumbnailAndStructuredOriginalNote.imageUrls, [
  'https://sns-webpic-qc.xhscdn.com/original-assets/slide-a-original.jpg',
  'https://sns-webpic-qc.xhscdn.com/original-assets/slide-b-original.jpg',
]);
assert.strictEqual(xiaohongshuDomThumbnailAndStructuredOriginalNote.markdown.includes('slide-a-thumb.jpg'), false);
assert.strictEqual(xiaohongshuDomThumbnailAndStructuredOriginalNote.markdown.includes('slide-b-thumb.jpg'), false);
assert.ok(xiaohongshuDomThumbnailAndStructuredOriginalNote.markdown.includes('![封面](https://sns-webpic-qc.xhscdn.com/original-assets/slide-a-original.jpg)'));
assert.ok(xiaohongshuDomThumbnailAndStructuredOriginalNote.markdown.includes('![内页图 1](https://sns-webpic-qc.xhscdn.com/original-assets/slide-b-original.jpg)'));

const xiaohongshuNoisyImagesNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Noisy Images Title">',
  '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/spectrum/cover-noisy!nd_dft_wlteh_jpg_3">',
  '</head><body>',
  '<img src="https://sns-avatar-qc.xhscdn.com/avatar-user.jpg">',
  '<img src="https://ci.xiaohongshu.com/recommend-banner.jpg">',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"正文。 #干净图片","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/cover-noisy!nd_dft_wlteh_jpg_3"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/real-inner-a!nd_dft_wlteh_jpg_3"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/real-inner-b!nd_dft_wlteh_jpg_3"}]},"feed":{"items":[{"image":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/recommend-noise!nd_dft_wlteh_jpg_3"}]}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/noisy-images');
assert.ok(xiaohongshuNoisyImagesNote.markdown.includes('cover-noisy'));
assert.ok(xiaohongshuNoisyImagesNote.markdown.includes('real-inner-a'));
assert.ok(xiaohongshuNoisyImagesNote.markdown.includes('real-inner-b'));
assert.strictEqual(xiaohongshuNoisyImagesNote.markdown.includes('avatar-user'), false);
assert.strictEqual(xiaohongshuNoisyImagesNote.markdown.includes('recommend-banner'), false);
assert.strictEqual(xiaohongshuNoisyImagesNote.markdown.includes('recommend-noise'), false);
assert.strictEqual(xiaohongshuNoisyImagesNote.imageUrls.length, 3);

const xiaohongshuDefaultShareImageNote = helpers.extractXiaohongshuMarkdownFromHtml([
  '<html><head>',
  '<meta property="og:title" content="XHS Default Share Image Title">',
  '<meta property="og:image" content="https://picasso-static.xiaohongshu.com/fe-platform/default-logo.png">',
  '</head><body>',
  '<img src="https://fe-platform.xhscdn.com/platform/blank-placeholder.png?imageView2/2/2/format/png">',
  '<script>window.__INITIAL_STATE__={"note":{"desc":"正文。 #真实图集","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/real-cover!nd_dft_wlteh_jpg_3"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/spectrum\\/real-inner!nd_dft_wlteh_jpg_3"}]}}</script>',
  '</body></html>',
].join(''), 'https://www.xiaohongshu.com/explore/default-share-image');
assert.strictEqual(xiaohongshuDefaultShareImageNote.markdown.includes('picasso-static'), false);
assert.strictEqual(xiaohongshuDefaultShareImageNote.markdown.includes('fe-platform.xhscdn.com/platform'), false);
assert.ok(xiaohongshuDefaultShareImageNote.markdown.includes('![封面](https://sns-webpic-qc.xhscdn.com/spectrum/real-cover!nd_dft_wlteh_jpg_3)'));
assert.ok(xiaohongshuDefaultShareImageNote.markdown.includes('![内页图 1](https://sns-webpic-qc.xhscdn.com/spectrum/real-inner!nd_dft_wlteh_jpg_3)'));
assert.strictEqual(xiaohongshuDefaultShareImageNote.imageUrls.length, 2);

const xiaohongshuPrebuiltMarkdownNote = helpers.buildMarkdownForRecord({
  record: {
    _id: 'xhs-prebuilt-bad-cover',
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/prebuilt-bad-cover',
    metadata: {
      title: 'XHS Prebuilt Bad Cover',
      url: 'https://www.xiaohongshu.com/explore/prebuilt-bad-cover',
      markdown: [
        '## 标题',
        '',
        'XHS Prebuilt Bad Cover',
        '',
        '## 正文',
        '',
        '正文。',
        '',
        '## 图片',
        '',
        '### 封面',
        '',
        '![封面](https://picasso-static.xiaohongshu.com/fe-platform/default-logo.png)',
        '',
        '### 内页图',
        '',
        '![内页图 1](https://fe-platform.xhscdn.com/platform/blank-placeholder.png?imageView2/2/2/format/png)',
        '',
        '![内页图 2](https://sns-webpic-qc.xhscdn.com/spectrum/real-cover!nd_dft_wlteh_jpg_3)',
        '',
        '![内页图 3](https://sns-webpic-qc.xhscdn.com/spectrum/real-inner!nd_dft_wlteh_jpg_3)',
        '',
      ].join('\n'),
    },
    createdAt: '2026-07-03T00:00:00.000Z',
  },
  title: 'XHS Prebuilt Bad Cover',
  syncedAt: '2026-07-03T00:01:00.000Z',
});
assert.strictEqual(xiaohongshuPrebuiltMarkdownNote.includes('picasso-static'), false);
assert.strictEqual(xiaohongshuPrebuiltMarkdownNote.includes('fe-platform.xhscdn.com/platform'), false);
assert.ok(xiaohongshuPrebuiltMarkdownNote.includes('![封面](https://sns-webpic-qc.xhscdn.com/spectrum/real-cover!nd_dft_wlteh_jpg_3)'));
assert.ok(xiaohongshuPrebuiltMarkdownNote.includes('![内页图 1](https://sns-webpic-qc.xhscdn.com/spectrum/real-inner!nd_dft_wlteh_jpg_3)'));
assert.strictEqual(xiaohongshuPrebuiltMarkdownNote.includes('![内页图 2](https://sns-webpic-qc.xhscdn.com/spectrum/real-cover!nd_dft_wlteh_jpg_3)'), false);

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
assert.strictEqual(
  helpers.extractDouyinAwemeId('bytedance://aweme/detail/7644566503081119019'),
  '7644566503081119019',
);
assert.deepStrictEqual(
  helpers.normalizeDouyinTargetUrl(
    'https://v.douyin.com/demo/',
    'bytedance://aweme/detail/7644566503081119019',
  ),
  {
    awemeId: '7644566503081119019',
    url: 'https://www.douyin.com/video/7644566503081119019',
  },
);
assert.deepStrictEqual(
  helpers.normalizeDouyinTargetUrl(
    'https://v.douyin.com/demo/',
    'snssdk1128://aweme/detail/7644566503081119019',
  ),
  {
    awemeId: '7644566503081119019',
    url: 'https://www.douyin.com/video/7644566503081119019',
  },
);
assert.deepStrictEqual(
  helpers.normalizeDouyinTargetUrl('https://www.douyin.com/video/7644566503081119019', ''),
  {
    awemeId: '7644566503081119019',
    url: 'https://www.douyin.com/video/7644566503081119019',
  },
);
assert.deepStrictEqual(
  helpers.normalizeDouyinTargetUrl('https://v.douyin.com/demo/', 'bytedance://user/profile/abc'),
  { awemeId: '', url: '' },
);
assert.deepStrictEqual(
  helpers.extractDouyinMediaUrlsForAweme({
    feed: [
      {
        aweme_id: '9999999999999999999',
        video: {
          play_addr: {
            url_list: ['https://v11-weba.douyinvod.com/recommendation/?mime_type=video_mp4'],
          },
        },
      },
      {
        aweme_id: '7659778280362429711',
        video: {
          play_addr: {
            url_list: ['https://v11-weba.douyinvod.com/browser-target/?mime_type=video_mp4'],
          },
        },
      },
    ],
  }, '7659778280362429711'),
  ['https://v11-weba.douyinvod.com/browser-target/?mime_type=video_mp4'],
);
assert.deepStrictEqual(
  helpers.extractDouyinMediaUrlsForAweme(JSON.stringify({
    aweme_detail: {
      aweme_id: '9999999999999999999',
      video: {
        play_addr: {
          url_list: ['https://v11-weba.douyinvod.com/wrong-target/?mime_type=video_mp4'],
        },
      },
    },
  }), '7659778280362429711'),
  [],
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
const douyinMobileShareHtml = [
  '<html><body><script>',
  'window._ROUTER_DATA = {"loaderData":{"video_(id)/page":{"videoInfoRes":{"item_list":[',
  '{"aweme_id":"9999999999999999999","video":{"play_addr":{"url_list":["https://v11-weba.douyinvod.com/recommendation/?mime_type=video_mp4"]}}},',
  '{"aweme_id":"7659778280362429711","video":{"play_addr":{"url_list":["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v0200fg10000target&ratio=720p&line=0"]}}}',
  ']}}}}};',
  '</script></body></html>',
].join('');
assert.deepStrictEqual(
  helpers.extractDouyinMediaUrlsFromShareHtml(douyinMobileShareHtml, '7659778280362429711'),
  ['https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v0200fg10000target&ratio=720p&line=0'],
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

assert.strictEqual(helpers.extractBilibiliProgressiveVideoUrlFromPlayurlPayload({
  data: {
    durl: [{ url: 'https://upos.example.com/video.mp4?deadline=1' }],
  },
}), 'https://upos.example.com/video.mp4?deadline=1');
assert.strictEqual(helpers.hasVideoTrackInMediaBuffer(Buffer.from('0000ftypisom0000mp4a')), false);
assert.strictEqual(helpers.hasVideoTrackInMediaBuffer(Buffer.from('0000ftypisom0000avc10000moov0000mp4a')), false);
assert.strictEqual(helpers.hasVideoTrackInMediaBuffer(Buffer.from('0000ftypisom0000avc10000vide0000mp4a')), true);
assert.strictEqual(helpers.cleanTrailingTranscriptionHallucinations([
  '这是正文最后一句。',
  'i know you',
  '画面的画面',
  '画面的画面',
  '字幕by索兰娅',
  '字幕:J Chong',
].join('\n')), '这是正文最后一句。');
const douyinRecoveredTailTranscript = [
  '所有的内容都可以进行同步。',
  '如果你在使用上有任何问题或者建议都可以联系我。',
  '以上就是我们今天的全部内容，我们下条视频再见。',
  '安装完成后，音视频链接和文件里的口播文案都会自动提取并保存到本地知识库。',
  'i know you',
  '用笔记画面画面的画面',
  ...Array(13).fill('画面的画面'),
  '字幕by索兰娅',
  '字幕by索兰娅',
  '得音！',
].join('\n');
assert.strictEqual(
  helpers.cleanTrailingTranscriptionHallucinations(douyinRecoveredTailTranscript),
  [
    '所有的内容都可以进行同步。',
    '如果你在使用上有任何问题或者建议都可以联系我。',
    '以上就是我们今天的全部内容，我们下条视频再见。',
    '安装完成后，音视频链接和文件里的口播文案都会自动提取并保存到本地知识库。',
  ].join('\n'),
  '重试转写在正确正文后产生高频重复尾巴和短噪声时，应保留正文并截掉整个污染尾段',
);
assert.strictEqual(helpers.cleanTrailingTranscriptionHallucinations([
  '这句话在正文中提到“我们下身再见”这个错听案例，不应该被删除。',
  '最后一段正常正文。',
  '我现在就以为我们下身再见',
].join('\n')), [
  '这句话在正文中提到“我们下身再见”这个错听案例，不应该被删除。',
  '最后一段正常正文。',
].join('\n'));
assert.strictEqual(helpers.cleanTrailingTranscriptionHallucinations([
  '如果你在使用上有任何问题或者建议都可以联系我',
  '以上就是我们今天的全部内容 我们下条视频再见',
  '请不吝点赞 订阅 转发 打赏支持明镜与点点点点赞 欢迎订阅 转发 打赏支持明镜与点点赞',
  '. 谢谢大家. 下次见. 拜拜.',
  '# 当时也有烧烤的食材,可以搭配蒜籽 & 炒鲜肉,可以搭配烤鲜肉 & 蒜籽 & 炒鲜肉',
  '# 蒜籽可以搭配烤鲜肉 & 炒鲜肉,可以搭配烤鲜肉 & 炒鲜肉',
  'MING PAO CANADA | MING PAO TORONTO',
  '(CC字幕制作:贝尔)',
].join('\n')), [
  '如果你在使用上有任何问题或者建议都可以联系我',
  '以上就是我们今天的全部内容 我们下条视频再见',
].join('\n'));

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
assert.strictEqual(transcriptMarkdown.includes('原始链接：'), false);
assert.strictEqual(transcriptMarkdown.includes('转写来源：'), false);

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
  const xiaohongshuRenderOrder = [];
  let releaseFirstXiaohongshuRender;
  const firstXiaohongshuRenderGate = new Promise((resolve) => {
    releaseFirstXiaohongshuRender = resolve;
  });
  const firstXiaohongshuRender = helpers.runWithXiaohongshuBrowserSessionLock(async () => {
    xiaohongshuRenderOrder.push('first:start');
    await firstXiaohongshuRenderGate;
    xiaohongshuRenderOrder.push('first:end');
  });
  await Promise.resolve();
  const secondXiaohongshuRender = helpers.runWithXiaohongshuBrowserSessionLock(async () => {
    xiaohongshuRenderOrder.push('second:start');
    xiaohongshuRenderOrder.push('second:end');
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepStrictEqual(xiaohongshuRenderOrder, ['first:start']);
  releaseFirstXiaohongshuRender();
  await Promise.all([firstXiaohongshuRender, secondXiaohongshuRender]);
  assert.deepStrictEqual(xiaohongshuRenderOrder, ['first:start', 'first:end', 'second:start', 'second:end']);

  const plugin = new PluginClass();
  plugin.settings = { aiProvider: 'off' };

  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const redirectMethods = [];
  http.request = (parsed, options, callback) => {
    assert.strictEqual(options.lookup, undefined, '短链跳转必须使用系统 DNS/代理路由，不能注入公网地址拦截器');
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
  https.request = http.request;
  try {
    const resolvedShortUrl = await helpers.resolveRedirectUrl('http://xhslink.com/o/demo');
    assert.strictEqual(resolvedShortUrl, 'https://xhslink.com/final');
    const resolvedCnShortUrl = await helpers.resolveRedirectUrl('http://xhslink.cn/o/demo');
    assert.strictEqual(resolvedCnShortUrl, 'https://xhslink.cn/final');
    assert.deepStrictEqual(redirectMethods, [
      'HEAD:/o/demo',
      'GET:/o/demo',
      'HEAD:/final',
      'HEAD:/o/demo',
      'GET:/o/demo',
      'HEAD:/final',
    ]);
    const redirectResult = await helpers.resolveRedirectUrlWithDiagnostics('http://xhslink.cn/o/demo');
    assert.strictEqual(redirectResult.url, 'https://xhslink.cn/final');
    assert.strictEqual(redirectResult.diagnostic.redirectCount, 1);
    assert.strictEqual(redirectResult.diagnostic.usedGetFallback, true);
    assert.deepStrictEqual(redirectResult.diagnostic.attempts, [{
      method: 'HEAD',
      status: 404,
      host: 'xhslink.cn',
      outcome: 'response',
    }, {
      method: 'GET',
      status: 302,
      host: 'xhslink.cn',
      outcome: 'redirect',
    }, {
      method: 'HEAD',
      status: 200,
      host: 'xhslink.cn',
      outcome: 'response',
    }]);
  } finally {
    http.request = originalHttpRequest;
    https.request = originalHttpsRequest;
  }

  const originalHttpsRequestForHeadError = https.request;
  const headErrorFallbackAttempts = [];
  const createRedirectRequest = (parsed, options, callback) => {
    const method = options.method || 'GET';
    const protocol = parsed.protocol || 'http:';
    const request = {
      errorHandler: null,
      setTimeout: () => request,
      on: (eventName, handler) => {
        if (eventName === 'error') request.errorHandler = handler;
        return request;
      },
      destroy: () => {},
      end: () => {
        headErrorFallbackAttempts.push(`${method}:${protocol}:${parsed.hostname}${parsed.pathname}`);
        if (method === 'HEAD' && protocol === 'http:' && parsed.hostname === 'xhslink.cn') {
          request.errorHandler(new Error('simulated connection reset'));
          return;
        }
        if (method === 'GET' && protocol === 'https:' && parsed.hostname === 'xhslink.cn') {
          callback({
            statusCode: 302,
            headers: { location: 'https://www.xiaohongshu.com/explore/demo' },
            resume: () => {},
          });
          return;
        }
        callback({ statusCode: 200, headers: {}, resume: () => {} });
      },
    };
    return request;
  };
  http.request = createRedirectRequest;
  https.request = createRedirectRequest;
  try {
    const redirectResult = await helpers.resolveRedirectUrlWithDiagnostics('http://xhslink.cn/o/demo');
    assert.strictEqual(redirectResult.url, 'https://www.xiaohongshu.com/explore/demo');
    assert.strictEqual(redirectResult.diagnostic.usedGetFallback, true);
    assert.deepStrictEqual(headErrorFallbackAttempts, [
      'HEAD:http::xhslink.cn/o/demo',
      'GET:https::xhslink.cn/o/demo',
      'HEAD:https::www.xiaohongshu.com/explore/demo',
    ]);
    assert.deepStrictEqual(redirectResult.diagnostic.attempts, [{
      method: 'HEAD',
      status: 0,
      host: 'xhslink.cn',
      outcome: 'request-error',
    }, {
      method: 'GET',
      status: 302,
      host: 'xhslink.cn',
      outcome: 'redirect',
    }, {
      method: 'HEAD',
      status: 200,
      host: 'xiaohongshu.com',
      outcome: 'response',
    }]);
    assert.strictEqual(JSON.stringify(redirectResult.diagnostic).includes('/o/demo'), false);
  } finally {
    http.request = originalHttpRequest;
    https.request = originalHttpsRequestForHeadError;
  }

  const originalHttpRequestForHttpsGetError = http.request;
  const originalHttpsRequestForHttpsGetError = https.request;
  const httpsGetErrorFallbackAttempts = [];
  const createHttpsGetErrorFallbackRequest = (parsed, options, callback) => {
    const method = options.method || 'GET';
    const protocol = parsed.protocol || 'http:';
    const request = {
      errorHandler: null,
      setTimeout: () => request,
      on: (eventName, handler) => {
        if (eventName === 'error') request.errorHandler = handler;
        return request;
      },
      destroy: () => {},
      end: () => {
        httpsGetErrorFallbackAttempts.push(`${method}:${protocol}:${parsed.hostname}${parsed.pathname}`);
        if (method === 'HEAD' && protocol === 'http:' && parsed.hostname === 'xhslink.cn') {
          request.errorHandler(new Error('simulated initial head error'));
          return;
        }
        if (method === 'GET' && protocol === 'https:' && parsed.hostname === 'xhslink.cn') {
          request.errorHandler(new Error('simulated https get error'));
          return;
        }
        if (method === 'GET' && protocol === 'http:' && parsed.hostname === 'xhslink.cn') {
          callback({
            statusCode: 302,
            headers: { location: 'https://www.xiaohongshu.com/explore/http-fallback' },
            resume: () => {},
          });
          return;
        }
        callback({ statusCode: 200, headers: {}, resume: () => {} });
      },
    };
    return request;
  };
  http.request = createHttpsGetErrorFallbackRequest;
  https.request = createHttpsGetErrorFallbackRequest;
  try {
    const redirectResult = await helpers.resolveRedirectUrlWithDiagnostics('http://xhslink.cn/o/demo');
    assert.strictEqual(redirectResult.url, 'https://www.xiaohongshu.com/explore/http-fallback');
    assert.deepStrictEqual(httpsGetErrorFallbackAttempts, [
      'HEAD:http::xhslink.cn/o/demo',
      'GET:https::xhslink.cn/o/demo',
      'GET:http::xhslink.cn/o/demo',
      'HEAD:https::www.xiaohongshu.com/explore/http-fallback',
    ]);
    assert.deepStrictEqual(redirectResult.diagnostic.attempts.map((attempt) => attempt.outcome), [
      'request-error',
      'request-error',
      'redirect',
      'response',
    ]);
    assert.strictEqual(JSON.stringify(redirectResult.diagnostic).includes('/o/demo'), false);
  } finally {
    http.request = originalHttpRequestForHttpsGetError;
    https.request = originalHttpsRequestForHttpsGetError;
  }

  const originalHttpRequestForHeadTimeout = http.request;
  const originalHttpsRequestForHeadTimeout = https.request;
  const headTimeoutFallbackAttempts = [];
  const createHeadTimeoutFallbackRequest = (parsed, options, callback) => {
    const method = options.method || 'GET';
    const protocol = parsed.protocol || 'http:';
    const request = {
      timeoutHandler: null,
      setTimeout: (timeoutMs, handler) => {
        request.timeoutHandler = handler;
        return request;
      },
      on: () => request,
      destroy: () => {},
      end: () => {
        headTimeoutFallbackAttempts.push(`${method}:${protocol}:${parsed.hostname}${parsed.pathname}`);
        if (method === 'HEAD' && protocol === 'http:' && parsed.hostname === 'xhslink.cn') {
          request.timeoutHandler();
          return;
        }
        if (method === 'GET' && protocol === 'https:' && parsed.hostname === 'xhslink.cn') {
          callback({
            statusCode: 302,
            headers: { location: 'https://www.xiaohongshu.com/explore/timeout-fallback' },
            resume: () => {},
          });
          return;
        }
        callback({ statusCode: 200, headers: {}, resume: () => {} });
      },
    };
    return request;
  };
  http.request = createHeadTimeoutFallbackRequest;
  https.request = createHeadTimeoutFallbackRequest;
  try {
    const redirectResult = await helpers.resolveRedirectUrlWithDiagnostics('http://xhslink.cn/o/demo');
    assert.strictEqual(redirectResult.url, 'https://www.xiaohongshu.com/explore/timeout-fallback');
    assert.deepStrictEqual(headTimeoutFallbackAttempts, [
      'HEAD:http::xhslink.cn/o/demo',
      'GET:https::xhslink.cn/o/demo',
      'HEAD:https::www.xiaohongshu.com/explore/timeout-fallback',
    ]);
    assert.deepStrictEqual(redirectResult.diagnostic.attempts.map((attempt) => attempt.outcome), [
      'timeout',
      'redirect',
      'response',
    ]);
    assert.strictEqual(JSON.stringify(redirectResult.diagnostic).includes('/o/demo'), false);
  } finally {
    http.request = originalHttpRequestForHeadTimeout;
    https.request = originalHttpsRequestForHeadTimeout;
  }

  const previousRequestUrlMock = requestUrlMock;
  const unsafePageRequests = [];
  http.request = (parsed, options, callback) => {
    const request = {
      setTimeout: () => request,
      on: () => request,
      destroy: () => {},
      end: () => callback({
        statusCode: 302,
        headers: { location: 'bytedance://aweme/detail/7644566503081119019' },
        resume: () => {},
      }),
    };
    return request;
  };
  requestUrlMock = async ({ url }) => {
    unsafePageRequests.push(url);
    return { text: '' };
  };
  try {
    const unsafeRedirectPlugin = new PluginClass();
    unsafeRedirectPlugin.settings = { aiProvider: 'off' };
    unsafeRedirectPlugin.fetchDouyinMediaUrlsWithSession = async (pageUrl, awemeId) => {
      assert.strictEqual(pageUrl, 'https://www.douyin.com/video/7644566503081119019');
      assert.strictEqual(awemeId, '7644566503081119019');
      return ['https://v11-weba.douyinvod.com/app-redirect-target/?mime_type=video_mp4'];
    };
    unsafeRedirectPlugin.renderSocialMediaUrls = async () => {
      throw new Error('normalized app redirect should resolve before browser rendering');
    };
    const unsafeRedirectRecord = await unsafeRedirectPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'http://v.douyin.com/unsafe-redirect/',
      metadata: { url: 'http://v.douyin.com/unsafe-redirect/' },
    }, '', '', '抖音外部协议');
    assert.strictEqual(unsafePageRequests[0], 'https://www.douyin.com/video/7644566503081119019');
    assert.strictEqual(unsafePageRequests.some((url) => url.startsWith('bytedance://')), false);
    assert.strictEqual(
      unsafeRedirectRecord.metadata.mediaUrl,
      'https://v11-weba.douyinvod.com/app-redirect-target/?mime_type=video_mp4',
    );
  } finally {
    http.request = originalHttpRequest;
    requestUrlMock = previousRequestUrlMock;
  }

  const sessionFetchCalls = [];
  const sessionMediaUrls = await helpers.fetchDouyinMediaUrlsWithSession({
    pageUrl: 'https://www.douyin.com/video/7644238277092174409',
    awemeId: '7644238277092174409',
    session: {
      fetch: async (url, options) => {
        sessionFetchCalls.push({ url, options });
        if (url === 'https://www.douyin.com/video/7644238277092174409') {
          return { text: async () => '<html><body>cookie warmup</body></html>' };
        }
        return {
          text: async () => JSON.stringify({
            aweme_detail: {
              aweme_id: '7644238277092174409',
              video: {
                play_addr: {
                  url_list: ['https://v11-weba.douyinvod.com/session-target/?mime_type=video_mp4'],
                },
              },
            },
          }),
        };
      },
    },
  });
  assert.deepStrictEqual(sessionMediaUrls, [
    'https://v11-weba.douyinvod.com/session-target/?mime_type=video_mp4',
  ]);
  assert.strictEqual(sessionFetchCalls[0].options.credentials, 'include');
  assert.strictEqual(sessionFetchCalls.length, 2);

  const mismatchedSessionMedia = await helpers.fetchDouyinMediaUrlsWithSession({
    pageUrl: 'https://www.douyin.com/video/7644238277092174409',
    awemeId: '7644238277092174409',
    session: {
      fetch: async (url) => ({
        text: async () => url.includes('/aweme/v1/web/aweme/detail/')
          ? JSON.stringify({
            aweme_detail: {
              aweme_id: '9999999999999999999',
              video: {
                play_addr: {
                  url_list: ['https://v11-weba.douyinvod.com/recommendation/?mime_type=video_mp4'],
                },
              },
            },
          })
          : '',
      }),
    },
  });
  assert.deepStrictEqual(mismatchedSessionMedia, []);

  const warmupFailureMedia = await helpers.fetchDouyinMediaUrlsWithSession({
    pageUrl: 'https://www.douyin.com/video/7644238277092174409',
    awemeId: '7644238277092174409',
    session: {
      fetch: async (url) => {
        if (url === 'https://www.douyin.com/video/7644238277092174409') {
          throw new Error('page warmup failed');
        }
        return {
          text: async () => JSON.stringify({
            aweme_detail: {
              aweme_id: '7644238277092174409',
              video: {
                play_addr: {
                  url_list: ['https://v11-weba.douyinvod.com/existing-session/?mime_type=video_mp4'],
                },
              },
            },
          }),
        };
      },
    },
  });
  assert.deepStrictEqual(warmupFailureMedia, [
    'https://v11-weba.douyinvod.com/existing-session/?mime_type=video_mp4',
  ]);

  const ignoredAbortSessionResult = await Promise.race([
    helpers.fetchDouyinMediaUrlsWithSession({
      pageUrl: 'https://www.douyin.com/video/7644238277092174409',
      awemeId: '7644238277092174409',
      requestTimeoutMs: 20,
      session: {
        fetch: async () => new Promise(() => {}),
      },
    }).then((urls) => ({ status: 'done', urls })),
    new Promise((resolve) => setTimeout(() => resolve({ status: 'hung' }), 250)),
  ]);
  assert.deepStrictEqual(ignoredAbortSessionResult, { status: 'done', urls: [] });

  assert.deepStrictEqual(await helpers.fetchDouyinMediaUrlsWithSession({
    pageUrl: 'https://www.douyin.com/video/7644238277092174409',
    awemeId: '7644238277092174409',
    session: null,
  }), []);

  const handledSchemes = [];
  const modernProtocol = {
    handled: new Set(),
    isProtocolHandled(scheme) {
      return this.handled.has(scheme);
    },
    handle(scheme, handler) {
      handledSchemes.push({ scheme, handler });
      this.handled.add(scheme);
    },
  };
  const modernSession = { protocol: modernProtocol };
  await helpers.installDouyinExternalProtocolHandlers(modernSession);
  await helpers.installDouyinExternalProtocolHandlers(modernSession);
  assert.deepStrictEqual(handledSchemes.map((item) => item.scheme), ['bytedance', 'snssdk1128']);
  const blockedResponse = await handledSchemes[0].handler({ url: 'bytedance://aweme/detail/123' });
  assert.strictEqual(blockedResponse.status, 204);

  const legacyRegistered = [];
  const legacyProtocol = {
    registered: new Set(),
    isProtocolRegistered(scheme) {
      return this.registered.has(scheme);
    },
    registerStringProtocol(scheme, handler) {
      legacyRegistered.push({ scheme, handler });
      this.registered.add(scheme);
    },
  };
  await helpers.installDouyinExternalProtocolHandlers({ protocol: legacyProtocol });
  await helpers.installDouyinExternalProtocolHandlers({ protocol: legacyProtocol });
  assert.deepStrictEqual(legacyRegistered.map((item) => item.scheme), ['bytedance', 'snssdk1128']);
  let legacyPayload = null;
  legacyRegistered[0].handler({}, (payload) => { legacyPayload = payload; });
  assert.deepStrictEqual(legacyPayload, { data: '', mimeType: 'text/plain' });

  assert.strictEqual(await helpers.installDouyinExternalProtocolHandlers(null), false);

  assert.strictEqual(helpers.shouldHydrateLinkAsWebpage('https://weixin.qq.com/sph/A7ULN6a876'), false);

  const feishuOpenApiRequests = [];
  const feishuOpenApiResult = await helpers.fetchFeishuOpenApiMarkdownFromUrl(
    'https://fv2fbshiww0.feishu.cn/wiki/wikiToken123',
    {
      appId: 'cli_test',
      appSecret: 'secret_test',
      requestJson: async ({ url, method, headers, body }) => {
        feishuOpenApiRequests.push({ url, method, headers, body });
        if (url === 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal') {
          assert.strictEqual(method, 'POST');
          assert.deepStrictEqual(JSON.parse(body), { app_id: 'cli_test', app_secret: 'secret_test' });
          return { status: 200, json: { code: 0, tenant_access_token: 'tenant-token', expire: 7200 } };
        }
        assert.strictEqual(headers.Authorization, 'Bearer tenant-token');
        if (url === 'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=wikiToken123') {
          return {
            status: 200,
            json: {
              code: 0,
              data: { node: { obj_token: 'docxToken456', obj_type: 'docx', title: 'Wiki 文档标题' } },
            },
          };
        }
        if (url === 'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken456') {
          return { status: 200, json: { code: 0, data: { document: { title: '官方文档标题' } } } };
        }
        if (url === 'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken456/blocks?page_size=500') {
          return {
            status: 200,
            json: {
              code: 0,
              data: {
                has_more: true,
                page_token: 'next-page',
                items: [
                  { block_id: 'page', block_type: 1, children: ['h1', 'p1'] },
                  { block_id: 'h1', block_type: 3, heading1: { elements: [{ text_run: { content: '官方分页标题' } }] } },
                  { block_id: 'p1', block_type: 2, text: { elements: [{ text_run: { content: '第一页正文' } }] } },
                ],
              },
            },
          };
        }
        if (url === 'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken456/blocks?page_size=500&page_token=next-page') {
          return {
            status: 200,
            json: {
              code: 0,
              data: {
                has_more: false,
                items: [
                  { block_id: 'h2', block_type: 4, heading2: { elements: [{ text_run: { content: '第二页标题' } }] } },
                  { block_id: 'p2', block_type: 2, text: { elements: [{ text_run: { content: '第二页正文，不能因为 239 个 block 截断。' } }] } },
                ],
              },
            },
          };
        }
        throw new Error(`Unexpected Feishu OpenAPI URL: ${url}`);
      },
    },
  );
  assert.strictEqual(feishuOpenApiResult.documentId, 'docxToken456');
  assert.strictEqual(feishuOpenApiResult.title, '官方文档标题');
  assert.strictEqual(feishuOpenApiResult.blockCount, 5);
  assert.ok(feishuOpenApiResult.markdown.includes('# 官方分页标题'));
  assert.ok(feishuOpenApiResult.markdown.includes('第一页正文'));
  assert.ok(feishuOpenApiResult.markdown.includes('## 第二页标题'));
  assert.ok(feishuOpenApiResult.markdown.includes('第二页正文，不能因为 239 个 block 截断。'));
  assert.deepStrictEqual(
    feishuOpenApiRequests.map((item) => item.url),
    [
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=wikiToken123',
      'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken456',
      'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken456/blocks?page_size=500',
      'https://open.feishu.cn/open-apis/docx/v1/documents/docxToken456/blocks?page_size=500&page_token=next-page',
    ],
  );

  await assert.rejects(
    () => helpers.fetchFeishuOpenApiMarkdownFromUrl(
      'https://my.feishu.cn/wiki/noWikiScope',
      {
        appId: 'cli_missing_scope',
        appSecret: 'secret_missing_scope',
        requestJson: async ({ url }) => {
          if (url === 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal') {
            return { status: 200, json: { code: 0, tenant_access_token: 'tenant-token', expire: 7200 } };
          }
          if (url === 'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=noWikiScope') {
            return {
              status: 400,
              json: {
                code: 99991672,
                msg: 'Access denied. One of the following scopes is required: [wiki:wiki, wiki:wiki:readonly, wiki:node:read].',
              },
            };
          }
          throw new Error(`Unexpected missing scope URL: ${url}`);
        },
      },
    ),
    /99991672.*wiki:wiki:readonly.*wiki:node:read/,
  );

  const cloudFeishuPlugin = new PluginClass();
  const cloudFeishuCalls = [];
  const cloudFeishuFiles = {};
  cloudFeishuPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    bindings: [{ token: 'ABC-123', label: '微信 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: { connected: true },
  });
  cloudFeishuPlugin.app = {
    vault: {
      adapter: {
        exists: async () => false,
        writeBinary: async (filePath, buffer) => {
          cloudFeishuFiles[filePath] = Buffer.from(buffer);
        },
      },
      createFolder: async () => {},
    },
  };
  requestUrlMock = async ({ url }) => {
    if (url === 'https://internal-api-drive-stream.feishu.cn/cloud-image-1') {
      return {
        arrayBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
      };
    }
    return {};
  };
  cloudFeishuPlugin.requestJson = async (path, method, body, binding) => {
    cloudFeishuCalls.push([path, method, body.url, binding && binding.token]);
    if (path === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: '云端授权标题',
          documentId: 'cloudDocxToken',
          blockCount: 2,
          blocks: [
            { block_id: 'h1', block_type: 3, heading1: { elements: [{ text_run: { content: '云端授权一级标题' } }] } },
            { block_id: 'p1', block_type: 2, text: { elements: [{ text_run: { content: '云端授权正文内容。' } }] } },
            { block_id: 'img1', block_type: 27, image: { token: 'boxcnCloudImageToken' } },
          ],
          imageTokenCount: 1,
          imageTmpDownloadUrls: {
            boxcnCloudImageToken: 'https://internal-api-drive-stream.feishu.cn/cloud-image-1',
          },
        },
      };
    }
    throw new Error(`Unexpected cloud Feishu path ${path}`);
  };
  const cloudHydrated = await cloudFeishuPlugin.hydrateWebpageMarkdown({
    _id: 'feishu-cloud-oauth-hydrate',
    type: 'webpage',
    content: 'https://my.feishu.cn/docx/cloudDocxToken',
    metadata: { url: 'https://my.feishu.cn/docx/cloudDocxToken' },
  }, '临时收集', '2026-07-04', '飞书云端授权测试');
  assert.strictEqual(cloudHydrated.metadata.conversionSource, 'feishu-cloud-oauth');
  assert.strictEqual(cloudHydrated.metadata.title, '云端授权标题');
  assert.ok(cloudHydrated.metadata.markdown.includes('# 云端授权一级标题'));
  assert.ok(cloudHydrated.metadata.markdown.includes('云端授权正文内容。'));
  assert.ok(cloudHydrated.metadata.markdown.includes('![[临时收集/网页图片/2026-07-04/云端授权标题-image-01.png]]'));
  assert.ok(Buffer.isBuffer(cloudFeishuFiles['临时收集/网页图片/2026-07-04/云端授权标题-image-01.png']));
  assert.deepStrictEqual(cloudFeishuCalls, [[
    '/feishu/extract',
    'POST',
    'https://my.feishu.cn/docx/cloudDocxToken',
    undefined,
  ]]);

  const fallbackImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);
  let fallbackImageRequestCount = 0;
  const fallbackImageServer = http.createServer((req, res) => {
    fallbackImageRequestCount += 1;
    assert.strictEqual(req.method, 'GET');
    assert.strictEqual(req.url, '/feishu-image.png');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': fallbackImageBytes.length,
    });
    res.end(fallbackImageBytes);
  });
  await new Promise((resolve) => fallbackImageServer.listen(0, '127.0.0.1', resolve));
  const fallbackImageUrl = `http://127.0.0.1:${fallbackImageServer.address().port}/feishu-image.png`;
  const feishuImagePreviousRequestUrlMock = requestUrlMock;
  const fallbackFeishuFiles = {};
  const fallbackFeishuPlugin = new PluginClass();
  fallbackFeishuPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    bindings: [{ token: 'ABC-123', label: '微信 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: { connected: true },
  });
  fallbackFeishuPlugin.app = {
    vault: {
      adapter: {
        exists: async () => false,
        writeBinary: async (filePath, buffer) => {
          fallbackFeishuFiles[filePath] = Buffer.from(buffer);
        },
      },
      createFolder: async () => {},
    },
  };
  requestUrlMock = async ({ url }) => {
    if (url === fallbackImageUrl) {
      throw new Error('net::ERR_CONNECTION_RESET');
    }
    return {};
  };
  fallbackFeishuPlugin.requestJson = async (requestPath) => {
    if (requestPath === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: '飞书图片下载兜底',
          documentId: 'fallbackDocxToken',
          blockCount: 1,
          blocks: [{ block_id: 'img1', block_type: 27, image: { token: 'boxcnFallbackImageToken' } }],
          imageTokenCount: 1,
          imageTmpDownloadUrls: {
            boxcnFallbackImageToken: fallbackImageUrl,
          },
        },
      };
    }
    throw new Error(`Unexpected fallback Feishu path ${requestPath}`);
  };
  try {
    const fallbackHydrated = await fallbackFeishuPlugin.hydrateWebpageMarkdown({
      _id: 'feishu-cloud-oauth-image-fallback',
      type: 'webpage',
      content: 'https://my.feishu.cn/docx/fallbackDocxToken',
      metadata: { url: 'https://my.feishu.cn/docx/fallbackDocxToken' },
    }, '临时收集', '2026-07-16', '飞书图片下载兜底');
    const fallbackImagePath = '临时收集/网页图片/2026-07-16/飞书图片下载兜底-image-01.png';
    assert.ok(fallbackHydrated.metadata.markdown.includes(`![[${fallbackImagePath}]]`));
    assert.deepStrictEqual(fallbackFeishuFiles[fallbackImagePath], fallbackImageBytes);
    assert.strictEqual(fallbackImageRequestCount, 1);
  } finally {
    requestUrlMock = feishuImagePreviousRequestUrlMock;
    await new Promise((resolve) => fallbackImageServer.close(resolve));
  }

  const failedImagePlugin = new PluginClass();
  failedImagePlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    bindings: [{ token: 'ABC-123', label: '微信 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: { connected: true },
  });
  failedImagePlugin.app = {
    vault: {
      adapter: {
        exists: async () => false,
        writeBinary: async () => {},
      },
      createFolder: async () => {},
    },
  };
  failedImagePlugin.downloadArrayBuffer = async () => {
    throw new Error('read ECONNRESET');
  };
  failedImagePlugin.requestJson = async (requestPath) => {
    if (requestPath === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: '飞书图片失败诊断',
          documentId: 'failedImageDocxToken',
          blockCount: 1,
          blocks: [{ block_id: 'img1', block_type: 27, image: { token: 'boxcnFailedImageToken' } }],
          imageTokenCount: 1,
          imageTmpDownloadUrls: {},
        },
      };
    }
    throw new Error(`Unexpected failed image Feishu path ${requestPath}`);
  };
  const failedImageHydrated = await failedImagePlugin.hydrateWebpageMarkdown({
    _id: 'feishu-cloud-oauth-image-failed',
    type: 'webpage',
    content: 'https://my.feishu.cn/docx/failedImageDocxToken',
    metadata: { url: 'https://my.feishu.cn/docx/failedImageDocxToken' },
  }, '临时收集', '2026-07-16', '飞书图片失败诊断');
  assert.ok(failedImageHydrated.metadata.conversionNote.includes('image-localize-failed=1'));
  assert.ok(failedImageHydrated.metadata.conversionNote.includes('read ECONNRESET'));
  assert.ok(failedImageHydrated.metadata.conversionNote.includes('image-temp-url-missing=1'));
  assert.strictEqual(failedImageHydrated.metadata.imageLocalizationFailedCount, 1);
  assert.strictEqual(failedImageHydrated.metadata.imageTempUrlMissingCount, 1);
  assert.ok(failedImageHydrated.metadata.imageLocalizationError.includes('read ECONNRESET'));

  const cloudStatusRefreshPlugin = new PluginClass();
  const cloudStatusRefreshCalls = [];
  cloudStatusRefreshPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    bindings: [{ token: 'ABC-123', label: '微信 1', status: 'bound', enabled: true }],
    feishuOAuthStatus: null,
  });
  cloudStatusRefreshPlugin.requestJson = async (path, method, body, binding) => {
    cloudStatusRefreshCalls.push([path, method, body && body.url, binding && binding.token]);
    if (path === '/feishu/oauth/status') {
      return { success: true, data: { connected: true, expiresAt: '2026-07-10T00:00:00.000Z' } };
    }
    if (path === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: '云端刷新标题',
          documentId: 'refreshDocxToken',
          blockCount: 1,
          blocks: [
            { block_id: 'p1', block_type: 2, text: { elements: [{ text_run: { content: '云端状态刷新后应该重新提取，不再复用旧网页解析缓存。' } }] } },
          ],
        },
      };
    }
    throw new Error(`Unexpected cloud Feishu refresh path ${path}`);
  };
  const refreshedCloudHydrated = await cloudStatusRefreshPlugin.hydrateWebpageMarkdown({
    _id: 'feishu-cloud-oauth-refresh-hydrate',
    type: 'webpage',
    content: 'https://my.feishu.cn/docx/refreshDocxToken',
    metadata: {
      url: 'https://my.feishu.cn/docx/refreshDocxToken',
      markdown: '旧网页解析缓存不应该阻止云端授权提取。',
    },
  }, '临时收集', '2026-07-04', '飞书云端授权刷新测试');
  assert.strictEqual(refreshedCloudHydrated.metadata.conversionSource, 'feishu-cloud-oauth', JSON.stringify({
    calls: cloudStatusRefreshCalls,
    metadata: refreshedCloudHydrated.metadata,
  }));
  assert.ok(refreshedCloudHydrated.metadata.markdown.includes('云端状态刷新后应该重新提取'));
  assert.deepStrictEqual(cloudStatusRefreshCalls, [
    ['/feishu/oauth/status', 'GET', undefined, 'ABC-123'],
    ['/feishu/extract', 'POST', 'https://my.feishu.cn/docx/refreshDocxToken', undefined],
  ]);

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
    if (url === 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d145') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
          '</head><body><script>',
          '{"noteDetailMap":{"6a4ccf88000000001101d145":{"note":{"noteId":"6a4ccf88000000001101d145","displayTitle":"XHS Video","desc":"目标视频笔记正文","video":{"media":{"stream":{"h264":[{"masterUrl":"https://video.example.com/xhs.mp4"}]}}}}}}}',
          '</script></body></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.xiaohongshu.com/explore/image-note') {
      return {
        text: [
          '<html><head>',
          '<link rel="canonical" href="https://www.xiaohongshu.com/explore/image-note">',
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

  const sessionFirstPlugin = new PluginClass();
  sessionFirstPlugin.settings = { aiProvider: 'off' };
  let sessionFirstRenderCalls = 0;
  sessionFirstPlugin.fetchDouyinMediaUrlsWithSession = async (pageUrl, awemeId) => {
    assert.strictEqual(pageUrl, 'https://www.douyin.com/video/7644238277092174409');
    assert.strictEqual(awemeId, '7644238277092174409');
    return ['https://v11-weba.douyinvod.com/session-first/?mime_type=video_mp4'];
  };
  sessionFirstPlugin.renderSocialMediaUrls = async () => {
    sessionFirstRenderCalls += 1;
    return ['https://v11-weba.douyinvod.com/rendered-recommendation/?mime_type=video_mp4'];
  };
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.douyin.com/video/7644238277092174409') return { text: '<html></html>' };
    if (url.includes('/aweme/v1/web/aweme/detail/')) {
      return {
        json: {
          aweme_detail: {
            aweme_id: '9999999999999999999',
            video: {
              play_addr: {
                url_list: ['https://v11-weba.douyinvod.com/direct-recommendation/?mime_type=video_mp4'],
              },
            },
          },
        },
      };
    }
    throw new Error(`unexpected session-first request ${url}`);
  };
  const sessionFirstRecord = await sessionFirstPlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.douyin.com/video/7644238277092174409',
    metadata: { url: 'https://www.douyin.com/video/7644238277092174409' },
  }, '', '', 'Session 优先抖音');
  assert.strictEqual(sessionFirstRecord.metadata.mediaUrl, 'https://v11-weba.douyinvod.com/session-first/?mime_type=video_mp4');
  assert.strictEqual(sessionFirstRenderCalls, 0);

  const sessionFallbackPlugin = new PluginClass();
  sessionFallbackPlugin.settings = { aiProvider: 'off' };
  let sessionFallbackRenderCalls = 0;
  sessionFallbackPlugin.fetchDouyinMediaUrlsWithSession = async () => [];
  sessionFallbackPlugin.renderSocialMediaUrls = async () => {
    sessionFallbackRenderCalls += 1;
    return ['https://www.douyin.com/aweme/v1/play/?video_id=sessionfallback&ratio=720p'];
  };
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.douyin.com/video/7644566503081119019') return { text: '<html></html>' };
    if (url.includes('/aweme/v1/web/aweme/detail/')) return { text: '' };
    throw new Error(`unexpected session-fallback request ${url}`);
  };
  const sessionFallbackRecord = await sessionFallbackPlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.douyin.com/video/7644566503081119019',
    metadata: { url: 'https://www.douyin.com/video/7644566503081119019' },
  }, '', '', 'Session 失败回退');
  assert.strictEqual(sessionFallbackRecord.metadata.mediaUrl.includes('sessionfallback'), true);
  assert.strictEqual(sessionFallbackRenderCalls, 1);

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

  const unavailableDouyinPlugin = new PluginClass();
  unavailableDouyinPlugin.settings = { aiProvider: 'off' };
  unavailableDouyinPlugin.fetchDouyinMediaUrlsWithSession = async () => [];
  unavailableDouyinPlugin.renderSocialMediaUrls = async () => [];
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.douyin.com/video/7659778280362429711') {
      return { text: '<html><head><meta charset="UTF-8"></head><body></body></html>' };
    }
    if (url.includes('/aweme/v1/web/aweme/detail/')) return { text: '' };
    throw new Error(`unexpected unavailable douyin request ${url}`);
  };
  const unavailableDouyinRecord = await unavailableDouyinPlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.douyin.com/video/7659778280362429711',
    metadata: { url: 'https://www.douyin.com/video/7659778280362429711' },
  }, '', '', '抖音链接');
  assert.strictEqual(unavailableDouyinRecord.metadata.platform, '抖音');
  assert.strictEqual(unavailableDouyinRecord.metadata.contentCategory, '视频');
  assert.strictEqual(unavailableDouyinRecord.metadata.transcriptionStatus, 'failed');
  assert.strictEqual(unavailableDouyinRecord.metadata.conversionStatus, 'link_saved');
  assert.strictEqual(unavailableDouyinRecord.metadata.markdown.includes('抖音链接已保存'), true);
  assert.strictEqual(unavailableDouyinRecord.metadata.markdown.includes('小红书'), false);

  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d145') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
          '</head><body><script>',
          '{"noteDetailMap":{"6a4ccf88000000001101d145":{"note":{"noteId":"6a4ccf88000000001101d145","displayTitle":"XHS Video","desc":"目标视频笔记正文","video":{"media":{"stream":{"h264":[{"masterUrl":"https://video.example.com/xhs.mp4"}]}}}}}}}',
          '</script></body></html>',
        ].join(''),
      };
    }
    if (url === 'https://www.xiaohongshu.com/explore/image-note') {
      return {
        text: [
          '<html><head>',
          '<link rel="canonical" href="https://www.xiaohongshu.com/explore/image-note">',
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
    content: 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d145',
    metadata: { url: 'https://www.xiaohongshu.com/explore/6a4ccf88000000001101d145' },
  }, '', '', '小红书视频');
  assert.strictEqual(xhsVideoRecord.metadata.transcriptOnly, true);
  assert.strictEqual(xhsVideoRecord.metadata.markdown, undefined);
  assert.strictEqual(xhsVideoRecord.metadata.mediaUrl, 'https://video.example.com/xhs.mp4');

  const targetGraphicNoteId = '6a4ccf88000000001101d144';
  const targetGraphicWithForeignMetaVideoHtml = [
    '<html><head><meta property="og:title" content="目标图文">',
    '<meta property="og:video" content="https://sns-video.xhscdn.com/unrelated-recommendation.mp4">',
    '</head><body><script>',
    JSON.stringify({
      noteDetailMap: {
        [targetGraphicNoteId]: {
          note: {
            noteId: targetGraphicNoteId,
            displayTitle: '目标图文',
            desc: '目标图文正文',
            imageList: [{
              urlDefault: 'https://sns-webpic-qc.xhscdn.com/target.jpg',
            }],
          },
        },
      },
    }),
    '</script></body></html>',
  ].join('');
  const targetGraphicPlugin = new PluginClass();
  targetGraphicPlugin.settings = helpers.mergeSettings({
    aiProvider: 'off',
    settingsVersion: 2,
    xiaohongshuCommentsEnabled: false,
  });
  targetGraphicPlugin.hasProFeatureAccess = async () => true;
  let targetGraphicTranscriptionCalls = 0;
  targetGraphicPlugin.runConfiguredTranscription = async () => {
    targetGraphicTranscriptionCalls += 1;
    return { transcription: '不应发生', source: 'local' };
  };
  targetGraphicPlugin.saveMarkdownRemoteImageAssets = async (markdown) => markdown;
  const previousTargetGraphicRequestUrlMock = requestUrlMock;
  requestUrlMock = async () => ({
    status: 200,
    text: targetGraphicWithForeignMetaVideoHtml,
  });
  try {
    const targetGraphicRecord = await targetGraphicPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: `https://www.xiaohongshu.com/explore/${targetGraphicNoteId}`,
      metadata: { url: `https://www.xiaohongshu.com/explore/${targetGraphicNoteId}` },
    }, '', '', '目标图文');
    assert.strictEqual(targetGraphicTranscriptionCalls, 0);
    assert.strictEqual(targetGraphicRecord.metadata.contentCategory, '图文');
    assert.ok(targetGraphicRecord.metadata.markdown.includes('目标图文正文'));
    assert.strictEqual(targetGraphicRecord.metadata.mediaUrl, undefined);
    assert.strictEqual(targetGraphicRecord.metadata.markdown.includes('unrelated-recommendation.mp4'), false);
  } finally {
    requestUrlMock = previousTargetGraphicRequestUrlMock;
  }

  const xhsVideoWithCommentsPlugin = new PluginClass();
  xhsVideoWithCommentsPlugin.settings = helpers.mergeSettings({
    aiProvider: 'off',
    settingsVersion: 2,
    xiaohongshuCommentsEnabled: true,
  });
  xhsVideoWithCommentsPlugin.hasProFeatureAccess = async () => true;
  xhsVideoWithCommentsPlugin.checkXiaohongshuLogin = async () => true;
  xhsVideoWithCommentsPlugin.runConfiguredTranscription = async () => ({
    transcription: '视频口播正文',
    source: 'local',
  });
  const xhsVideoWithCommentsHtml = [
    '<html><head>',
    '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
    '</head><body><script>',
    JSON.stringify({
      noteDetailMap: {
        'video-comments': {
          note: {
            noteId: 'video-comments',
            displayTitle: 'XHS Video Comments',
            desc: '目标视频笔记正文。',
            video: {
              media: {
                stream: {
                  h264: [{
                    masterUrl: 'https://video.example.com/xhs-comments.mp4',
                  }],
                },
              },
            },
          },
        },
      },
    }),
    '</script>',
    '<div class="comment-item"><span class="user-name">推荐用户</span><span class="comment-content">不应写入的推荐评论</span></div>',
    '</body></html>',
  ].join('');
  xhsVideoWithCommentsPlugin.renderXiaohongshuPage = async (url, options = {}) => {
    assert.strictEqual(url, 'https://www.xiaohongshu.com/explore/video-comments');
    if (options.includeComments === true) {
      assert.strictEqual(options.expectedUrl, 'https://www.xiaohongshu.com/explore/video-comments');
      return {
        html: '<html></html>',
        url,
        identityUrl: url,
        comments: [{
          author: '真实用户',
          content: '真实评论内容',
          likes: '6',
        }],
        commentDiagnosticDetails: {
          source: 'page-api',
          stopReason: 'exhausted',
          partial: false,
        },
      };
    }
    return {
      html: xhsVideoWithCommentsHtml,
      url,
      identityUrl: url,
      comments: [],
    };
  };
  const previousXhsCommentRequestUrlMock = requestUrlMock;
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/explore/video-comments') {
      return {
        text: xhsVideoWithCommentsHtml,
      };
    }
    throw new Error(`unexpected xhs comment video request ${url}`);
  };
  try {
    const xhsVideoWithCommentsRecord = await xhsVideoWithCommentsPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'https://www.xiaohongshu.com/explore/video-comments',
      metadata: { url: 'https://www.xiaohongshu.com/explore/video-comments' },
    }, '', '', '小红书视频评论区');
    assert.strictEqual(xhsVideoWithCommentsRecord.metadata.transcriptOnly, true);
    assert.ok(xhsVideoWithCommentsRecord.metadata.markdown.includes('## 评论区'));
    assert.ok(xhsVideoWithCommentsRecord.metadata.markdown.includes('**真实用户**：真实评论内容'));
    assert.strictEqual(xhsVideoWithCommentsRecord.metadata.markdown.includes('不应写入的推荐评论'), false);
    const xhsVideoWithCommentsMarkdown = helpers.buildMarkdownForRecord({
      record: xhsVideoWithCommentsRecord,
      title: '小红书视频评论区',
      syncedAt: '2026-07-08T00:00:00.000Z',
    });
    assert.ok(xhsVideoWithCommentsMarkdown.includes('视频口播正文'));
    assert.ok(xhsVideoWithCommentsMarkdown.includes('## 评论区'));
    assert.ok(xhsVideoWithCommentsMarkdown.includes('真实评论内容'));
  } finally {
    requestUrlMock = previousXhsCommentRequestUrlMock;
  }

  const genericXhsLandingVideoPlugin = new PluginClass();
  genericXhsLandingVideoPlugin.settings = helpers.mergeSettings({ aiProvider: 'local' });
  genericXhsLandingVideoPlugin.hasProFeatureAccess = async () => true;
  genericXhsLandingVideoPlugin.checkXiaohongshuLogin = async () => false;
  genericXhsLandingVideoPlugin.renderSocialMediaUrls = async () => [
    'https://sns-video-v6.xhscdn.com/stream/demo.mp4?sign=test',
  ];
  genericXhsLandingVideoPlugin.runConfiguredTranscription = async () => ({
    transcription: '从通用落地页恢复的视频口播文案',
    source: 'local',
  });
  const previousGenericXhsRequestUrlMock = requestUrlMock;
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/explore/generic-video') {
      return {
        text: [
          '<html><head>',
          '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
          '<meta name="description" content="该内容来自小红书，请打开小红书查看精彩笔记。">',
          '</head><body>小红书</body></html>',
        ].join(''),
      };
    }
    throw new Error(`unexpected generic xhs request ${url}`);
  };
  try {
    const genericXhsLandingVideoRecord = await genericXhsLandingVideoPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'https://www.xiaohongshu.com/explore/generic-video',
      metadata: { url: 'https://www.xiaohongshu.com/explore/generic-video' },
    }, '', '', '小红书通用落地页视频');
    assert.strictEqual(genericXhsLandingVideoRecord.metadata.transcriptOnly, true);
    assert.strictEqual(genericXhsLandingVideoRecord.metadata.transcriptionStatus, 'success');
    assert.strictEqual(genericXhsLandingVideoRecord.metadata.transcription, '从通用落地页恢复的视频口播文案');
  } finally {
    requestUrlMock = previousGenericXhsRequestUrlMock;
  }

  const transportFallbackPlugin = new PluginClass();
  transportFallbackPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
  transportFallbackPlugin.hasProFeatureAccess = async () => false;
  transportFallbackPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => extracted;
  transportFallbackPlugin.renderSocialMediaUrls = async () => [];
  let transportFallbackRenderCalls = 0;
  transportFallbackPlugin.renderXiaohongshuPage = async (renderUrl) => {
    transportFallbackRenderCalls += 1;
    assert.strictEqual(renderUrl, 'http://xhslink.cn/o/macos-transport');
    return {
      html: [
        '<html><head>',
        '<link rel="canonical" href="https://www.xiaohongshu.com/explore/macos-transport">',
        '<meta property="og:title" content="Mac 浏览器网络接管成功">',
        '<meta name="description" content="Node 三次连接失败后，隐藏浏览器成功打开短链并取得完整正文。">',
        '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/macos-transport.jpg">',
        '</head></html>',
      ].join(''),
      url: 'https://www.xiaohongshu.com/explore/macos-transport',
      identityUrl: 'https://www.xiaohongshu.com/explore/macos-transport',
      comments: [],
    };
  };
  const originalHttpRequestForTransportFallback = http.request;
  const originalHttpsRequestForTransportFallback = https.request;
  const previousTransportFallbackRequestUrlMock = requestUrlMock;
  const createTransportFailureRequest = () => {
    const request = {
      errorHandler: null,
      setTimeout: () => request,
      on: (eventName, handler) => {
        if (eventName === 'error') request.errorHandler = handler;
        return request;
      },
      destroy: () => {},
      end: () => request.errorHandler(new Error('simulated macOS Node transport failure')),
    };
    return request;
  };
  http.request = createTransportFailureRequest;
  https.request = createTransportFailureRequest;
  requestUrlMock = async () => {
    throw new Error('simulated webpage request transport failure');
  };
  try {
    const transportFallbackRecord = await transportFallbackPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'http://xhslink.cn/o/macos-transport',
      metadata: {
        url: 'http://xhslink.cn/o/macos-transport',
        automaticWebpageExtraction: true,
      },
    }, '', '', 'Mac 短链网络接管测试');
    assert.ok(transportFallbackRenderCalls >= 1);
    assert.strictEqual(transportFallbackRecord.metadata.title, 'Mac 浏览器网络接管成功');
    assert.ok(transportFallbackRecord.metadata.markdown.includes('隐藏浏览器成功打开短链'));
  } finally {
    http.request = originalHttpRequestForTransportFallback;
    https.request = originalHttpsRequestForTransportFallback;
    requestUrlMock = previousTransportFallbackRequestUrlMock;
  }

  const externalRedirectPlugin = new PluginClass();
  externalRedirectPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
  externalRedirectPlugin.hasProFeatureAccess = async () => false;
  let externalRedirectPageFetches = 0;
  let externalRedirectBrowserRenders = 0;
  let externalRedirectImageSaves = 0;
  let externalRedirectTargetProbes = 0;
  externalRedirectPlugin.renderXiaohongshuPage = async () => {
    externalRedirectBrowserRenders += 1;
    return {
      url: 'https://attacker.example/explore/6a4ccf88000000001101d144',
      html: canonicalTargetHtml.replace(
        'https://sns-webpic-qc.xhscdn.com/target-note-cover.jpg',
        'http://127.0.0.1:4567/internal.jpg',
      ),
      comments: [],
    };
  };
  externalRedirectPlugin.saveMarkdownRemoteImageAssets = async (markdown) => {
    externalRedirectImageSaves += 1;
    return markdown;
  };
  const originalHttpRequestForExternalRedirect = http.request;
  const originalHttpsRequestForExternalRedirect = https.request;
  const previousExternalRedirectRequestUrlMock = requestUrlMock;
  const createExternalRedirectRequest = (parsed, options, callback) => {
    const method = options.method || 'GET';
    const request = {
      setTimeout: () => request,
      on: () => request,
      destroy: () => {},
      end: () => {
        if (parsed.hostname === 'attacker.example') {
          externalRedirectTargetProbes += 1;
          callback({ statusCode: 200, headers: {}, resume: () => {} });
          return;
        }
        if (parsed.hostname === 'xhslink.cn' && method === 'HEAD') {
          callback({ statusCode: 404, headers: {}, resume: () => {} });
          return;
        }
        if (parsed.hostname === 'xhslink.cn' && method === 'GET') {
          callback({
            statusCode: 302,
            headers: { location: 'https://attacker.example/fake-note' },
            resume: () => {},
          });
          return;
        }
        callback({ statusCode: 404, headers: {}, resume: () => {} });
      },
    };
    return request;
  };
  http.request = createExternalRedirectRequest;
  https.request = createExternalRedirectRequest;
  requestUrlMock = async () => {
    externalRedirectPageFetches += 1;
    return {
      status: 200,
      text: canonicalTargetHtml,
    };
  };
  try {
    await assert.rejects(
      () => externalRedirectPlugin.hydrateWebpageMarkdown({
        type: 'webpage',
        content: 'http://xhslink.cn/o/external-redirect',
        metadata: { url: 'http://xhslink.cn/o/external-redirect' },
      }, '', '', '外站伪造小红书页面'),
      (error) => error && error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE',
    );
    assert.strictEqual(externalRedirectTargetProbes, 0);
    assert.strictEqual(externalRedirectPageFetches, 0);
    assert.strictEqual(externalRedirectBrowserRenders, 0);
    assert.strictEqual(externalRedirectImageSaves, 0);
  } finally {
    http.request = originalHttpRequestForExternalRedirect;
    https.request = originalHttpsRequestForExternalRedirect;
    requestUrlMock = previousExternalRedirectRequestUrlMock;
  }

  for (const automaticWebpageExtraction of [false, true]) {
    const bodyRedirectPlugin = new PluginClass();
    bodyRedirectPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
    bodyRedirectPlugin.hasProFeatureAccess = async () => false;
    bodyRedirectPlugin.requestXiaohongshuStaticPage = productionRequestXiaohongshuStaticPage.bind(bodyRedirectPlugin);
    let bodyRedirectRequestUrlCalls = 0;
    let bodyRedirectBrowserCalls = 0;
    let bodyRedirectImageSaves = 0;
    const bodyRedirectRequests = [];
    bodyRedirectPlugin.renderXiaohongshuPage = async () => {
      bodyRedirectBrowserCalls += 1;
      throw new Error('browser fallback intentionally unavailable');
    };
    bodyRedirectPlugin.saveMarkdownRemoteImageAssets = async (markdown) => {
      bodyRedirectImageSaves += 1;
      return markdown;
    };
    const originalHttpsRequestForBodyRedirect = https.request;
    const previousBodyRedirectRequestUrlMock = requestUrlMock;
    https.request = (parsed, options, callback) => {
      bodyRedirectRequests.push(parsed.toString());
      const request = {
        setTimeout: () => request,
        on: () => request,
        destroy: () => {},
        end: () => {
          if (parsed.hostname === 'www.xiaohongshu.com') {
            callback({
              statusCode: 302,
              headers: { location: 'https://attacker.example/forged-target' },
              resume: () => {},
            });
            return;
          }
          throw new Error(`untrusted redirect target must never be requested: ${parsed.toString()}`);
        },
      };
      return request;
    };
    requestUrlMock = async () => {
      bodyRedirectRequestUrlCalls += 1;
      return {
        status: 200,
        url: 'https://attacker.example/forged-target',
        text: canonicalTargetHtml,
      };
    };
    try {
      await assert.rejects(
        () => bodyRedirectPlugin.hydrateWebpageMarkdown({
          type: 'webpage',
          content: `https://www.xiaohongshu.com/explore/${targetGraphicNoteId}`,
          metadata: {
            url: `https://www.xiaohongshu.com/explore/${targetGraphicNoteId}`,
            automaticWebpageExtraction,
          },
        }, '', '', '正文二次跳转防护'),
        (error) => error && error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE',
      );
      assert.deepStrictEqual(bodyRedirectRequests, [
        `https://www.xiaohongshu.com/explore/${targetGraphicNoteId}`,
      ]);
      assert.strictEqual(bodyRedirectRequestUrlCalls, 0);
      assert.ok(bodyRedirectBrowserCalls >= 1);
      assert.strictEqual(bodyRedirectImageSaves, 0);
    } finally {
      https.request = originalHttpsRequestForBodyRedirect;
      requestUrlMock = previousBodyRedirectRequestUrlMock;
    }
  }

  const genericRedirectFallbackPlugin = new PluginClass();
  genericRedirectFallbackPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
  genericRedirectFallbackPlugin.hasProFeatureAccess = async () => false;
  genericRedirectFallbackPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => extracted;
  genericRedirectFallbackPlugin.renderSocialMediaUrls = async () => [];
  const originalHttpRequestForGenericRedirect = http.request;
  const originalHttpsRequestForGenericRedirect = https.request;
  const previousGenericRedirectRequestUrlMock = requestUrlMock;
  const genericRedirectRenderUrls = [];
  const genericRedirectRenderOptions = [];
  genericRedirectFallbackPlugin.renderXiaohongshuPage = async (renderUrl, renderOptions) => {
    genericRedirectRenderUrls.push(renderUrl);
    genericRedirectRenderOptions.push(renderOptions);
    if (renderUrl === 'http://xhslink.cn/o/original-note') {
      return {
        url: 'https://www.xiaohongshu.com/',
        html: genericXiaohongshuLandingHtml,
        comments: [],
      };
    }
    assert.strictEqual(renderUrl, 'https://www.xiaohongshu.com/');
    return {
      url: 'https://www.xiaohongshu.com/explore/recovered-note',
      html: [
        '<html><head>',
        '<link rel="canonical" href="https://www.xiaohongshu.com/explore/recovered-note">',
        '<meta property="og:title" content="真实地址恢复成功">',
        '<meta name="description" content="真实地址恢复出了完整正文内容。 #效率工具 #知识管理">',
        '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/resolved-cover.jpg">',
        '</head><body>',
        '<script>{"note":{"desc":"真实地址恢复出了完整正文内容。 #效率工具 #知识管理","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/resolved-cover.jpg"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/resolved-page-2.jpg"}]}}</script>',
        '</body></html>',
      ].join(''),
      comments: [],
    };
  };
  const createGenericRedirectRequest = (parsed, options, callback) => {
    const method = options.method || 'GET';
    const request = {
      setTimeout: () => request,
      on: () => request,
      destroy: () => {},
      end: () => {
        if (parsed.hostname === 'xhslink.cn'
          && parsed.pathname === '/o/identity-continuity'
          && method === 'HEAD') {
          callback({
            statusCode: 302,
            headers: {
              location: `https://www.xiaohongshu.com/explore/${targetGraphicNoteId}`,
            },
            resume: () => {},
          });
          return;
        }
        if (parsed.hostname === 'www.xiaohongshu.com'
          && parsed.pathname === `/explore/${targetGraphicNoteId}`
          && method === 'HEAD') {
          callback({ statusCode: 200, headers: {}, resume: () => {} });
          return;
        }
        if (parsed.hostname === 'xhslink.cn' && method === 'HEAD') {
          callback({ statusCode: 404, headers: {}, resume: () => {} });
          return;
        }
        if (parsed.hostname === 'xhslink.cn' && method === 'GET') {
          callback({
            statusCode: 302,
            headers: { location: 'https://www.xiaohongshu.com/' },
            resume: () => {},
          });
          return;
        }
        callback({ statusCode: 404, headers: {}, resume: () => {} });
      },
    };
    return request;
  };
  http.request = createGenericRedirectRequest;
  https.request = createGenericRedirectRequest;
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/') {
      return {
        status: 200,
        text: genericXiaohongshuLandingHtml,
      };
    }
    throw new Error(`unexpected generic redirect request ${url}`);
  };
  try {
    const genericRedirectRecord = await genericRedirectFallbackPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'http://xhslink.cn/o/original-note',
      metadata: {
        url: 'http://xhslink.cn/o/original-note',
        shareText: '原始短链恢复测试',
      },
    }, '', '', '小红书短链通用首页恢复');
    assert.deepStrictEqual(genericRedirectRenderUrls, [
      'http://xhslink.cn/o/original-note',
      'https://www.xiaohongshu.com/',
    ]);
    assert.ok(genericRedirectRenderOptions.every((options) => options && options.includeComments === false));
    assert.strictEqual(genericRedirectRecord.metadata.title, '真实地址恢复成功');
    assert.ok(genericRedirectRecord.metadata.markdown.includes('真实地址恢复出了完整正文内容'));
    assert.ok(genericRedirectRecord.metadata.markdown.includes('#效率工具'));
    assert.ok(genericRedirectRecord.metadata.markdown.includes('![封面](https://sns-webpic-qc.xhscdn.com/resolved-cover.jpg)'));
    assert.ok(genericRedirectRecord.metadata.markdown.includes('![内页图 1](https://sns-webpic-qc.xhscdn.com/resolved-page-2.jpg)'));

    const identityContinuityPlugin = new PluginClass();
    identityContinuityPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
    identityContinuityPlugin.hasProFeatureAccess = async () => false;
    identityContinuityPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => extracted;
    identityContinuityPlugin.renderSocialMediaUrls = async () => [];
    identityContinuityPlugin.saveMarkdownRemoteImageAssets = async (markdown) => markdown;
    const targetGraphicUrl = `https://www.xiaohongshu.com/explore/${targetGraphicNoteId}`;
    const identityContinuityRenderUrls = [];
    const identityContinuityRenderOptions = [];
    identityContinuityPlugin.requestXiaohongshuStaticPage = async (requestUrl) => {
      assert.strictEqual(requestUrl, targetGraphicUrl);
      return {
        status: 200,
        url: 'https://www.xiaohongshu.com/',
        text: genericXiaohongshuLandingHtml,
      };
    };
    identityContinuityPlugin.renderXiaohongshuPage = async (renderUrl, renderOptions) => {
      identityContinuityRenderUrls.push(renderUrl);
      identityContinuityRenderOptions.push(renderOptions);
      if (renderUrl !== targetGraphicUrl) {
        return {
          url: 'https://www.xiaohongshu.com/',
          html: genericXiaohongshuLandingHtml,
          comments: [],
        };
      }
      return {
        url: targetGraphicUrl,
        html: [
          '<html><head>',
          `<link rel="canonical" href="${targetGraphicUrl}">`,
          '<meta property="og:title" content="身份连续性恢复成功">',
          '<meta name="description" content="目标身份没有被通用首页覆盖，这是与准确 noteId 绑定的结构化图文正文。">',
          '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/identity-continuity.jpg">',
          '</head><body><script>',
          JSON.stringify({
            noteDetailMap: {
              [targetGraphicNoteId]: {
                note: {
                  noteId: targetGraphicNoteId,
                  displayTitle: '身份连续性恢复成功',
                  desc: '目标身份没有被通用首页覆盖，这是与准确 noteId 绑定的结构化图文正文。',
                  imageList: [{
                    urlDefault: 'https://sns-webpic-qc.xhscdn.com/identity-continuity.jpg',
                  }],
                },
              },
            },
          }),
          '</script></body></html>',
        ].join(''),
        comments: [],
      };
    };
    let identityContinuityRecord = null;
    let identityContinuityError = null;
    try {
      identityContinuityRecord = await identityContinuityPlugin.hydrateWebpageMarkdown({
        type: 'webpage',
        content: 'http://xhslink.cn/o/identity-continuity',
        metadata: {
          url: 'http://xhslink.cn/o/identity-continuity',
          shareText: '小红书目标身份连续性测试',
        },
      }, '', '', '小红书目标身份连续性');
    } catch (error) {
      identityContinuityError = error;
    }
    assert.deepStrictEqual(identityContinuityRenderUrls, [
      'http://xhslink.cn/o/identity-continuity',
      targetGraphicUrl,
      'https://www.xiaohongshu.com/',
    ]);
    assert.ifError(identityContinuityError);
    assert.ok(identityContinuityRenderOptions.every(
      (options) => options && options.expectedUrl === targetGraphicUrl,
    ));
    assert.strictEqual(identityContinuityRecord.metadata.title, '身份连续性恢复成功');
    assert.ok(identityContinuityRecord.metadata.markdown.includes('目标身份没有被通用首页覆盖'));

    const originalPreferredPlugin = new PluginClass();
    originalPreferredPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
    originalPreferredPlugin.hasProFeatureAccess = async () => false;
    originalPreferredPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => extracted;
    originalPreferredPlugin.renderSocialMediaUrls = async () => [];
    const originalPreferredRenderUrls = [];
    originalPreferredPlugin.renderXiaohongshuPage = async (renderUrl) => {
      originalPreferredRenderUrls.push(renderUrl);
      if (renderUrl === 'http://xhslink.cn/o/original-note') {
        return {
          url: 'https://www.xiaohongshu.com/explore/original-recovered',
          html: [
            '<html><head>',
            '<link rel="canonical" href="https://www.xiaohongshu.com/explore/original-recovered">',
            '<meta property="og:title" content="原始短链恢复成功">',
            '<meta name="description" content="原始短链恢复了真实正文，跳转后的地址仍然只是通用首页。">',
            '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/original-recovered.jpg">',
            '</head></html>',
          ].join(''),
          comments: [],
        };
      }
      return {
        url: 'https://www.xiaohongshu.com/',
        html: genericXiaohongshuLandingHtml,
        comments: [],
      };
    };
    const originalPreferredRecord = await originalPreferredPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'http://xhslink.cn/o/original-note',
      metadata: {
        url: 'http://xhslink.cn/o/original-note',
        shareText: '原始短链恢复测试',
      },
    }, '', '', '小红书原始短链恢复');
    assert.deepStrictEqual(originalPreferredRenderUrls, [
      'http://xhslink.cn/o/original-note',
      'https://www.xiaohongshu.com/',
    ]);
    assert.strictEqual(originalPreferredRecord.metadata.title, '原始短链恢复成功');
    assert.ok(originalPreferredRecord.metadata.markdown.includes('原始短链恢复了真实正文'));

    const complementaryFieldsPlugin = new PluginClass();
    complementaryFieldsPlugin.settings = helpers.mergeSettings({
      aiProvider: 'off',
      settingsVersion: 2,
      xiaohongshuCommentsEnabled: true,
    });
    complementaryFieldsPlugin.hasProFeatureAccess = async () => true;
    complementaryFieldsPlugin.checkXiaohongshuLogin = async () => true;
    complementaryFieldsPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => extracted;
    complementaryFieldsPlugin.renderSocialMediaUrls = async () => [];
    const complementaryRenderOptions = [];
    complementaryFieldsPlugin.renderXiaohongshuPage = async (renderUrl, renderOptions) => {
      complementaryRenderOptions.push(renderOptions);
      if (renderUrl === 'http://xhslink.cn/o/original-note') {
        return {
          url: 'https://www.xiaohongshu.com/explore/complementary-note',
          html: [
            '<html><head>',
            '<link rel="canonical" href="https://www.xiaohongshu.com/explore/complementary-note">',
            '<meta property="og:title" content="互补字段完整标题">',
            '<meta name="description" content="这是第一条路径取得的完整长正文内容，必须与另一条路径的全部图片合并。 #互补标签">',
            '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/complementary-cover.jpg">',
            '</head></html>',
          ].join(''),
          comments: [],
        };
      }
      return {
        url: 'https://www.xiaohongshu.com/explore/complementary-note',
        html: [
          '<html><head>',
          '<link rel="canonical" href="https://www.xiaohongshu.com/explore/complementary-note">',
          '<meta property="og:title" content="互补字段完整标题">',
          '<meta name="description" content="图片路径">',
          '</head><body>',
          '<script>{"note":{"desc":"图片路径","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/complementary-cover.jpg"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/complementary-page-2.jpg"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/complementary-page-3.jpg"}]}}</script>',
          '</body></html>',
        ].join(''),
        comments: [],
      };
    };
    const complementaryFieldsRecord = await complementaryFieldsPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'http://xhslink.cn/o/original-note',
      metadata: {
        url: 'http://xhslink.cn/o/original-note',
        shareText: '互补字段测试',
      },
    }, '', '', '小红书互补字段测试');
    assert.strictEqual(complementaryFieldsRecord.metadata.title, '互补字段完整标题');
    assert.ok(complementaryFieldsRecord.metadata.markdown.includes('这是第一条路径取得的完整长正文内容'));
    assert.ok(complementaryFieldsRecord.metadata.markdown.includes('#互补标签'));
    assert.ok(complementaryFieldsRecord.metadata.markdown.includes('![封面](https://sns-webpic-qc.xhscdn.com/complementary-cover.jpg)'));
    assert.ok(complementaryFieldsRecord.metadata.markdown.includes('![内页图 1](https://sns-webpic-qc.xhscdn.com/complementary-page-2.jpg)'));
    assert.ok(complementaryFieldsRecord.metadata.markdown.includes('![内页图 2](https://sns-webpic-qc.xhscdn.com/complementary-page-3.jpg)'));
    assert.strictEqual(
      complementaryRenderOptions.filter((options) => options && options.includeComments === false).length,
      2,
    );
    assert.strictEqual(
      complementaryRenderOptions.filter((options) => options && options.includeComments === true).length,
      1,
    );

    const genericRedirectMediaPlugin = new PluginClass();
    genericRedirectMediaPlugin.settings = helpers.mergeSettings({ aiProvider: 'local' });
    genericRedirectMediaPlugin.hasProFeatureAccess = async () => true;
    genericRedirectMediaPlugin.checkXiaohongshuLogin = async () => false;
    genericRedirectMediaPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => extracted;
    genericRedirectMediaPlugin.renderXiaohongshuPage = async (renderUrl) => {
      assert.strictEqual(renderUrl, 'http://xhslink.cn/o/original-note');
      return {
        html: genericXiaohongshuLandingHtml,
        comments: [],
      };
    };
    const genericRedirectMediaUrls = [];
    const genericRedirectMediaOptions = [];
    genericRedirectMediaPlugin.renderSocialMediaUrls = async (renderUrl, renderOptions) => {
      genericRedirectMediaUrls.push(renderUrl);
      genericRedirectMediaOptions.push(renderOptions);
      return ['https://sns-video-v6.xhscdn.com/stream/original-note.mp4'];
    };
    genericRedirectMediaPlugin.runConfiguredTranscription = async () => ({
      transcription: '原始短链恢复的视频转写正文',
      source: 'local',
    });
    const genericRedirectMediaRecord = await genericRedirectMediaPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'http://xhslink.cn/o/original-note',
      metadata: {
        url: 'http://xhslink.cn/o/original-note',
        webpageMediaType: 'audio_video',
        transcriptionMode: 'local',
      },
    }, '', '', '小红书短链视频恢复');
    assert.ok(genericRedirectMediaUrls.length >= 1);
    assert.ok(genericRedirectMediaUrls.every((renderUrl) => renderUrl === 'http://xhslink.cn/o/original-note'));
    assert.ok(genericRedirectMediaOptions.every((options) => options && options.includeComments === false));
    assert.strictEqual(genericRedirectMediaRecord.metadata.transcription, '原始短链恢复的视频转写正文');
  } finally {
    http.request = originalHttpRequestForGenericRedirect;
    https.request = originalHttpsRequestForGenericRedirect;
    requestUrlMock = previousGenericRedirectRequestUrlMock;
  }

  const renderedFallbackPlugin = new PluginClass();
  renderedFallbackPlugin.settings = helpers.mergeSettings({
    aiProvider: 'off',
    settingsVersion: 2,
    xiaohongshuCommentsEnabled: true,
  });
  renderedFallbackPlugin.hasProFeatureAccess = async () => true;
  renderedFallbackPlugin.checkXiaohongshuLogin = async () => true;
  renderedFallbackPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => extracted;
  renderedFallbackPlugin.renderSocialMediaUrls = async () => [];
  let renderedFallbackCalls = 0;
  const renderedFallbackOptions = [];
  renderedFallbackPlugin.renderXiaohongshuPage = async (_renderUrl, renderOptions) => {
    renderedFallbackCalls += 1;
    renderedFallbackOptions.push(renderOptions);
    return {
      html: [
        '<html><head>',
        '<link rel="canonical" href="https://www.xiaohongshu.com/explore/rendered-fallback">',
        '<meta property="og:title" content="超常儿童，也可能被鸡废了">',
        '<meta name="description" content="这是隐藏浏览器恢复出来的完整小红书正文，长度足够通过真实内容判断。">',
        '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/real-cover.jpg">',
        '</head></html>',
      ].join(''),
      url: 'https://www.xiaohongshu.com/explore/rendered-fallback',
      identityUrl: 'https://www.xiaohongshu.com/explore/rendered-fallback',
      comments: [{
        id: 'rendered-fallback-comment',
        author: '恢复用户',
        content: '正文和评论共用同一次页面渲染',
      }],
      commentDiagnosticDetails: {
        source: 'page-api',
        rootCount: 0,
        stopReason: 'root_unavailable',
      },
    };
  };
  const previousRenderedFallbackRequestUrlMock = requestUrlMock;
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/explore/rendered-fallback') {
      return { text: genericXiaohongshuLandingHtml };
    }
    throw new Error(`unexpected rendered fallback request ${url}`);
  };
  try {
    const renderedFallbackRecord = await renderedFallbackPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'https://www.xiaohongshu.com/explore/rendered-fallback',
      metadata: {
        url: 'https://www.xiaohongshu.com/explore/rendered-fallback',
        title: '小红书 - 你的生活兴趣社区',
        shareText: '86【超常儿童，也可能被鸡废了，家长都踩过】分享口令',
      },
    }, '', '', '小红书渲染恢复');
    assert.strictEqual(renderedFallbackCalls, 2);
    assert.strictEqual(
      renderedFallbackOptions.filter((options) => options && options.includeComments === false).length,
      1,
    );
    assert.strictEqual(
      renderedFallbackOptions.filter((options) => options && options.includeComments === true).length,
      1,
    );
    assert.strictEqual(renderedFallbackRecord.metadata.title, '超常儿童，也可能被鸡废了');
    assert.ok(renderedFallbackRecord.metadata.markdown.includes('隐藏浏览器恢复出来的完整小红书正文'));
    assert.ok(renderedFallbackRecord.metadata.markdown.includes('real-cover.jpg'));
    assert.ok(renderedFallbackRecord.metadata.markdown.includes('正文和评论共用同一次页面渲染'));
  } finally {
    requestUrlMock = previousRenderedFallbackRequestUrlMock;
  }

  const anonymousFastPlugin = new PluginClass();
  anonymousFastPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
  anonymousFastPlugin.hasProFeatureAccess = async () => false;
  let anonymousFastRenderCalls = 0;
  anonymousFastPlugin.renderXiaohongshuPage = async () => {
    anonymousFastRenderCalls += 1;
    return {
      url: 'https://www.xiaohongshu.com/explore/anonymous-fast-note',
      html: [
        '<html><head>',
        '<link rel="canonical" href="https://www.xiaohongshu.com/explore/anonymous-fast-note">',
        '<meta property="og:title" content="匿名路径真实笔记">',
        '<meta name="description" content="匿名路径完整正文已经直接返回，隐藏浏览器用于补齐内页图片。">',
        '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/anonymous-cover.jpg">',
        '<script>{"note":{"desc":"匿名路径完整正文已经直接返回，隐藏浏览器用于补齐内页图片。","imageList":[{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/anonymous-cover.jpg"},{"urlDefault":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/anonymous-inner.jpg"}]}}</script>',
        '</head></html>',
      ].join(''),
    };
  };
  const previousAnonymousFastRequestUrlMock = requestUrlMock;
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/explore/anonymous-fast-note') {
      return {
        text: [
          '<html><head>',
          '<link rel="canonical" href="https://www.xiaohongshu.com/explore/anonymous-fast-note">',
          '<meta property="og:title" content="匿名路径真实笔记">',
          '<meta name="description" content="匿名路径完整正文已经直接返回，不应该再启动隐藏浏览器浪费时间。">',
          '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/anonymous-cover.jpg">',
          '</head></html>',
        ].join(''),
      };
    }
    throw new Error(`unexpected anonymous fast request ${url}`);
  };
  try {
    const anonymousFastRecord = await anonymousFastPlugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'https://www.xiaohongshu.com/explore/anonymous-fast-note',
      metadata: { url: 'https://www.xiaohongshu.com/explore/anonymous-fast-note' },
    }, '', '', '匿名路径测试');
    assert.ok(anonymousFastRenderCalls > 0);
    assert.ok(anonymousFastRecord.metadata.markdown.includes('匿名路径完整正文'));
    assert.ok(anonymousFastRecord.metadata.markdown.includes('anonymous-inner.jpg'));
  } finally {
    requestUrlMock = previousAnonymousFastRequestUrlMock;
  }

  const xiaohongshuCapabilityHtml = [
    '<html><head>',
    '<link rel="canonical" href="https://www.xiaohongshu.com/explore/comment-capability">',
    '<meta property="og:title" content="公开图文不依赖评论权限">',
    '<meta name="description" content="所有用户都应该取得这段公开正文以及完整图片。 #公开内容">',
    '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/public-cover.jpg">',
    '</head><body>',
    '<script>window.__INITIAL_STATE__={"comments":[{"content":"仅登录 Pro 可见评论，这段评论故意写得比公开正文更长，绝不能被通用 JSON 正文提取器误判成笔记正文。 #评论内容"}]}</script>',
    '<div class="comment-item"><span class="user-name">评论用户</span><span class="comment-content">仅登录 Pro 可见评论</span></div>',
    '</body></html>',
  ].join('');

  const runXiaohongshuCommentCapabilityCase = async ({
    hasProAccess,
    loginResult,
    loginError = null,
  }) => {
    const capabilityPlugin = new PluginClass();
    capabilityPlugin.settings = helpers.mergeSettings({
      aiProvider: 'off',
      settingsVersion: 2,
      xiaohongshuCommentsEnabled: true,
    });
    capabilityPlugin.hasProFeatureAccess = async () => hasProAccess;
    capabilityPlugin.checkXiaohongshuLogin = async () => {
      if (loginError) throw loginError;
      return loginResult;
    };
    capabilityPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => extracted;
    capabilityPlugin.renderSocialMediaUrls = async () => [];
    capabilityPlugin.renderXiaohongshuPage = async () => ({
      url: 'https://www.xiaohongshu.com/explore/comment-capability',
      identityUrl: 'https://www.xiaohongshu.com/explore/comment-capability',
      html: xiaohongshuCapabilityHtml,
      comments: [{
        id: 'login-comment',
        author: '评论用户',
        content: '仅登录 Pro 可见评论',
      }],
    });
    const previousCapabilityRequestUrlMock = requestUrlMock;
    requestUrlMock = async ({ url }) => {
      if (url === 'https://www.xiaohongshu.com/explore/comment-capability') {
        return { status: 200, text: xiaohongshuCapabilityHtml };
      }
      throw new Error(`unexpected comment capability request ${url}`);
    };
    try {
      return await capabilityPlugin.hydrateWebpageMarkdown({
        type: 'webpage',
        content: 'https://www.xiaohongshu.com/explore/comment-capability',
        metadata: { url: 'https://www.xiaohongshu.com/explore/comment-capability' },
      }, '', '', '小红书评论权限测试');
    } finally {
      requestUrlMock = previousCapabilityRequestUrlMock;
    }
  };

  const freeCommentCapabilityRecord = await runXiaohongshuCommentCapabilityCase({
    hasProAccess: false,
    loginResult: false,
  });
  assert.ok(freeCommentCapabilityRecord.metadata.markdown.includes('所有用户都应该取得这段公开正文'));
  assert.strictEqual(freeCommentCapabilityRecord.metadata.markdown.includes('仅登录 Pro 可见评论'), false);

  const proLoggedOutCommentCapabilityRecord = await runXiaohongshuCommentCapabilityCase({
    hasProAccess: true,
    loginResult: false,
  });
  assert.ok(proLoggedOutCommentCapabilityRecord.metadata.markdown.includes('所有用户都应该取得这段公开正文'));
  assert.strictEqual(proLoggedOutCommentCapabilityRecord.metadata.markdown.includes('仅登录 Pro 可见评论'), false);

  const proLoggedInCommentCapabilityRecord = await runXiaohongshuCommentCapabilityCase({
    hasProAccess: true,
    loginResult: true,
  });
  assert.ok(proLoggedInCommentCapabilityRecord.metadata.markdown.includes('所有用户都应该取得这段公开正文'));
  assert.ok(proLoggedInCommentCapabilityRecord.metadata.markdown.includes('仅登录 Pro 可见评论'));

  const proLoginProbeFailureRecord = await runXiaohongshuCommentCapabilityCase({
    hasProAccess: true,
    loginResult: false,
    loginError: new Error('simulated login probe failure'),
  });
  assert.ok(proLoginProbeFailureRecord.metadata.markdown.includes('所有用户都应该取得这段公开正文'));
  assert.strictEqual(proLoginProbeFailureRecord.metadata.markdown.includes('仅登录 Pro 可见评论'), false);

  const runXiaohongshuOcrCapabilityCase = async (hasProAccess) => {
    const ocrPlugin = new PluginClass();
    ocrPlugin.settings = helpers.mergeSettings({
      aiProvider: 'off',
      settingsVersion: 2,
      xiaohongshuCommentsEnabled: false,
    });
    ocrPlugin.hasProFeatureAccess = async () => hasProAccess;
    let ocrCalls = 0;
    ocrPlugin.enrichXiaohongshuExtractionWithOcr = async (extracted) => {
      ocrCalls += 1;
      return {
        ...extracted,
        ocrError: 'simulated OCR enhancement failure',
      };
    };
    const previousOcrCapabilityRequestUrlMock = requestUrlMock;
    requestUrlMock = async ({ url }) => {
      if (url === 'https://www.xiaohongshu.com/explore/ocr-capability') {
        return {
          status: 200,
          text: [
            '<html><head>',
            '<link rel="canonical" href="https://www.xiaohongshu.com/explore/ocr-capability">',
            '<meta property="og:title" content="长图 OCR 权限测试">',
            '<meta name="description" content="公开图文正文必须先成功，OCR 只是 Pro 附加能力。">',
            '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/ocr-cover.jpg">',
            '</head></html>',
          ].join(''),
        };
      }
      throw new Error(`unexpected OCR capability request ${url}`);
    };
    try {
      const record = await ocrPlugin.hydrateWebpageMarkdown({
        type: 'webpage',
        content: 'https://www.xiaohongshu.com/explore/ocr-capability',
        metadata: { url: 'https://www.xiaohongshu.com/explore/ocr-capability' },
      }, '', '', '小红书 OCR 权限测试');
      return { record, ocrCalls };
    } finally {
      requestUrlMock = previousOcrCapabilityRequestUrlMock;
    }
  };

  const freeOcrCapability = await runXiaohongshuOcrCapabilityCase(false);
  assert.strictEqual(freeOcrCapability.ocrCalls, 0);
  assert.ok(freeOcrCapability.record.metadata.markdown.includes('公开图文正文必须先成功'));
  assert.strictEqual(freeOcrCapability.record.metadata.xiaohongshuOcrError, '');

  const proOcrCapability = await runXiaohongshuOcrCapabilityCase(true);
  assert.strictEqual(proOcrCapability.ocrCalls, 1);
  assert.ok(proOcrCapability.record.metadata.markdown.includes('公开图文正文必须先成功'));
  assert.strictEqual(proOcrCapability.record.metadata.xiaohongshuOcrError, 'simulated OCR enhancement failure');

  const runXiaohongshuVideoCapabilityCase = async (hasProAccess) => {
    const videoCapabilityPlugin = new PluginClass();
    videoCapabilityPlugin.settings = helpers.mergeSettings({
      aiProvider: 'local',
      settingsVersion: 2,
      xiaohongshuCommentsEnabled: false,
    });
    videoCapabilityPlugin.hasProFeatureAccess = async () => hasProAccess;
    let transcriptionCalls = 0;
    videoCapabilityPlugin.runConfiguredTranscription = async () => {
      transcriptionCalls += 1;
      if (!hasProAccess) throw new Error('free transcription must not run');
      return {
        transcription: 'Pro 用户成功取得音视频文案',
        source: 'local',
      };
    };
    const previousVideoCapabilityRequestUrlMock = requestUrlMock;
    requestUrlMock = async ({ url }) => {
      if (url === 'https://www.xiaohongshu.com/explore/video-capability') {
        return {
          status: 200,
          text: [
            '<html><head>',
            '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
            '</head><body><script>',
            '{"noteDetailMap":{"video-capability":{"note":{"noteId":"video-capability","displayTitle":"音视频 Pro 权限测试","desc":"目标视频笔记正文","video":{"media":{"stream":{"h264":[{"masterUrl":"https://sns-video-v6.xhscdn.com/stream/video-capability.mp4"}]}}}}}}}',
            '</script></body></html>',
          ].join(''),
        };
      }
      throw new Error(`unexpected video capability request ${url}`);
    };
    try {
      const record = await videoCapabilityPlugin.hydrateWebpageMarkdown({
        type: 'webpage',
        content: 'https://www.xiaohongshu.com/explore/video-capability',
        metadata: {
          url: 'https://www.xiaohongshu.com/explore/video-capability',
          webpageMediaType: 'audio_video',
          transcriptionMode: 'local',
        },
      }, '', '', '小红书音视频权限测试');
      return { record, transcriptionCalls };
    } finally {
      requestUrlMock = previousVideoCapabilityRequestUrlMock;
    }
  };

  const freeVideoCapability = await runXiaohongshuVideoCapabilityCase(false);
  assert.strictEqual(freeVideoCapability.transcriptionCalls, 0);
  assert.strictEqual(freeVideoCapability.record.metadata.transcriptionStatus, 'failed');
  assert.match(freeVideoCapability.record.metadata.transcriptionError, /Pro/);

  const proVideoCapability = await runXiaohongshuVideoCapabilityCase(true);
  assert.strictEqual(proVideoCapability.transcriptionCalls, 1);
  assert.strictEqual(proVideoCapability.record.metadata.transcriptionStatus, 'success');
  assert.strictEqual(proVideoCapability.record.metadata.transcription, 'Pro 用户成功取得音视频文案');

  const unavailableGraphicPlugin = new PluginClass();
  unavailableGraphicPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
  unavailableGraphicPlugin.hasProFeatureAccess = async () => false;
  unavailableGraphicPlugin.renderSocialMediaUrls = async () => [];
  unavailableGraphicPlugin.renderXiaohongshuPage = async () => ({
    html: genericXiaohongshuLandingHtml,
    comments: [],
    commentDiagnosticDetails: {
      source: 'page-api',
      rootCount: 0,
      stopReason: 'root_unavailable',
    },
  });
  const previousUnavailableGraphicRequestUrlMock = requestUrlMock;
  requestUrlMock = async ({ url }) => {
    if (url === 'https://www.xiaohongshu.com/explore/unavailable-graphic-note') {
      return { text: genericXiaohongshuLandingHtml };
    }
    throw new Error(`unexpected unavailable graphic request ${url}`);
  };
  try {
    await assert.rejects(
      () => unavailableGraphicPlugin.hydrateWebpageMarkdown({
        type: 'webpage',
        content: 'https://www.xiaohongshu.com/explore/unavailable-graphic-note',
        metadata: {
          url: 'https://www.xiaohongshu.com/explore/unavailable-graphic-note',
          shareText: '只有分享口令，没有真实正文',
        },
      }, '', '', '不可用图文测试'),
      (error) => error
        && error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE'
        && error.message === '小红书内容提取失败，已记录诊断，下次同步将重试。'
        && error.diagnostic
        && error.diagnostic.request.pageType === 'xiaohongshu-generic-landing',
    );
  } finally {
    requestUrlMock = previousUnavailableGraphicRequestUrlMock;
  }

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
    content: 'https://www.xiaohongshu.com/explore/image-note',
    metadata: {
      url: 'https://www.xiaohongshu.com/explore/image-note',
      webpageMediaType: 'audio_video',
    },
  }, '', '', '误标小红书图文');
  assert.strictEqual(mislabeledXhsImageRecord.metadata.transcriptOnly, undefined);
  assert.strictEqual(mislabeledXhsImageRecord.metadata.contentCategory, '图文');
  assert.ok(mislabeledXhsImageRecord.metadata.markdown.includes('真正图文正文'));
  assert.ok(mislabeledXhsImageRecord.metadata.markdown.includes('![封面](https://img.example.com/cover.jpg)'));

  await assert.rejects(
    () => plugin.hydrateWebpageMarkdown({
      type: 'webpage',
      content: 'https://www.xiaohongshu.com/404?source=note&type=video',
      metadata: { url: 'https://www.xiaohongshu.com/404?source=note&type=video' },
    }, '', '', '小红书失效视频'),
    (error) => error
      && error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE'
      && error.diagnostic
      && error.diagnostic.extraction.unavailablePage === true,
  );

  const requestFailurePlugin = new PluginClass();
  requestFailurePlugin.manifest = { version: '1.3.60' };
  requestFailurePlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
  requestFailurePlugin.hasProFeatureAccess = async () => false;
  const previousRequestFailureMock = requestUrlMock;
  requestUrlMock = async () => {
    throw new Error('network failed for https://www.xiaohongshu.com/explore/secret?xsec_token=never-log');
  };
  try {
    await assert.rejects(
      () => requestFailurePlugin.hydrateWebpageMarkdown({
        type: 'webpage',
        content: 'https://www.xiaohongshu.com/explore/request-failure?xsec_token=never-log',
        metadata: {
          url: 'https://www.xiaohongshu.com/explore/request-failure?xsec_token=never-log',
          title: '用户私密标题不应写入日志',
        },
      }, '', '', '请求失败测试'),
      (error) => error
        && error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE'
        && error.diagnostic
        && error.diagnostic.request.requestFailed === true
        && JSON.stringify(error.diagnostic).includes('never-log') === false,
    );
  } finally {
    requestUrlMock = previousRequestFailureMock;
  }

  const xhsImageRecord = await plugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/image-note',
    metadata: { url: 'https://www.xiaohongshu.com/explore/image-note' },
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

  const automaticLocalProPlugin = new PluginClass();
  automaticLocalProPlugin.settings = { aiProvider: 'off' };
  automaticLocalProPlugin.canRunLocalTranscription = () => true;
  automaticLocalProPlugin.hasProFeatureAccess = async () => true;
  automaticLocalProPlugin.runLocalTranscription = async (audioUrl) => {
    assert.strictEqual(audioUrl, 'https://sns-video-v6.xhscdn.com/stream/pro-video.mp4?sign=test');
    return 'Pro 本地组件应自动转写视频文案';
  };
  const automaticLocalProResult = await automaticLocalProPlugin.runConfiguredTranscription(
    'https://sns-video-v6.xhscdn.com/stream/pro-video.mp4?sign=test',
  );
  assert.deepStrictEqual(automaticLocalProResult, {
    transcription: 'Pro 本地组件应自动转写视频文案',
    source: 'local',
  });

  const webMediaFallbackPlugin = new PluginClass();
  webMediaFallbackPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'PRO-123',
    clientId: 'test-client',
    pendingRedeemCode: 'OBPROT93C6',
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

  const pausedLocalPlugin = new PluginClass();
  pausedLocalPlugin.settings = helpers.mergeSettings({ aiProvider: 'local' });
  pausedLocalPlugin.runLocalTranscription = async () => {
    throw helpers.createRetryableTranscriptionError('用户已停止当前转写');
  };
  let pausedFallbackCalled = false;
  pausedLocalPlugin.runCloudFallbackTranscription = async () => {
    pausedFallbackCalled = true;
    return { transcription: '不应运行', source: 'cloud' };
  };
  await assert.rejects(
    () => pausedLocalPlugin.runConfiguredTranscription('https://video.example.com/pause.mp4', {
      allowCloudUrlFallback: true,
    }),
    (error) => helpers.isRetryableTranscriptionError(error),
  );
  assert.strictEqual(pausedFallbackCalled, false);

  const bindErrorServer = http.createServer((request, response) => {
    assert.strictEqual(request.url, '/bind');
    response.writeHead(403, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      success: false,
      errCode: 'PLUGIN_BINDING_LIMIT_EXCEEDED',
      errMsg: '体验 Pro 有效期内最多绑定 3 个微信',
    }));
  });
  await new Promise((resolve) => bindErrorServer.listen(0, '127.0.0.1', resolve));
  const bindErrorPort = bindErrorServer.address().port;
  const bindErrorPlugin = new PluginClass();
  bindErrorPlugin.settings = helpers.mergeSettings({
    apiBase: `http://127.0.0.1:${bindErrorPort}`,
    token: 'BIND-403',
    clientId: 'bind-error-client',
  });
  const previousRequestUrlForBindError = requestUrlMock;
  requestUrlMock = async () => {
    throw new Error('Request failed, status 403');
  };
  try {
    await assert.rejects(
      () => bindErrorPlugin.requestJson('/bind', 'POST', { clientId: 'bind-error-client' }),
      (error) => error && error.code === 'PLUGIN_BINDING_LIMIT_EXCEEDED'
        && error.message === '体验 Pro 有效期内最多绑定 3 个微信',
    );
  } finally {
    requestUrlMock = previousRequestUrlForBindError;
    await new Promise((resolve) => bindErrorServer.close(resolve));
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
  localPlatformParsePlugin.hasProFeatureAccess = async () => true;
  localPlatformParsePlugin.checkXiaohongshuLogin = async () => false;
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
        text: '<html><script>{"noteDetailMap":{"local-parse":{"note":{"noteId":"local-parse","displayTitle":"小红书本地解析","desc":"目标视频笔记正文","video":{"media":{"stream":{"h264":[{"masterUrl":"https:\\/\\/media.example.com\\/local-xhs.mp4"}]}}}}}}}</script></html>',
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

async function runLocalTranscriptionQualityFallbackTests() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({ aiProvider: 'local' });
  const calls = [];
  plugin.runConfiguredTranscription = async (mediaUrl) => {
    calls.push(mediaUrl);
    if (mediaUrl.endsWith('/bad-audio.m4a')) {
      return {
        transcription: helpers.assertUsableTranscription(
          Array(12).fill('我们现在就来看看我们的临化设备').join('\n'),
          '本地转写',
        ),
        source: 'local',
      };
    }
    return {
      transcription: '这是从备用抖音媒体地址得到的正常口播内容。',
      source: 'local',
    };
  };

  const recovered = await plugin.buildTranscriptRecordFromMedia({
    type: 'webpage',
    content: 'https://www.douyin.com/video/quality-fallback',
    metadata: {
      url: 'https://www.douyin.com/video/quality-fallback',
      transcriptionMode: 'local',
    },
  }, {
    url: 'https://www.douyin.com/video/quality-fallback',
    platform: '抖音',
    mediaUrl: 'https://media.example.com/bad-audio.m4a',
    mediaUrls: ['https://media.example.com/good-video.mp4'],
    source: 'video',
  });
  assert.deepStrictEqual(calls, [
    'https://media.example.com/bad-audio.m4a',
    'https://media.example.com/good-video.mp4',
  ]);
  assert.strictEqual(recovered.metadata.transcriptionStatus, 'success');
  assert.strictEqual(recovered.metadata.mediaUrl, 'https://media.example.com/good-video.mp4');
  assert.strictEqual(recovered.metadata.transcription, '这是从备用抖音媒体地址得到的正常口播内容。');

  const allBadPlugin = new PluginClass();
  allBadPlugin.settings = helpers.mergeSettings({ aiProvider: 'local' });
  allBadPlugin.runConfiguredTranscription = async () => ({
    transcription: helpers.assertUsableTranscription(
      Array(3).fill('请输出简体中文').join('\n'),
      '本地转写',
    ),
    source: 'local',
  });
  const failed = await allBadPlugin.buildTranscriptRecordFromMedia({
    type: 'webpage',
    content: 'https://www.douyin.com/video/all-quality-failed',
    metadata: {
      url: 'https://www.douyin.com/video/all-quality-failed',
      transcriptionMode: 'local',
    },
  }, {
    url: 'https://www.douyin.com/video/all-quality-failed',
    platform: '抖音',
    mediaUrl: 'https://media.example.com/only-bad.mp4',
    source: 'video',
  });
  assert.strictEqual(failed.metadata.transcriptionStatus, 'failed');
  assert.strictEqual(failed.metadata.transcription, '');
  assert.ok(failed.metadata.transcriptionError.includes('提示词泄漏'));
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

async function runRequestJsonUsesActiveBindingWhenLegacyTokenMissingTest() {
  const previousRequestUrlMock = requestUrlMock;
  const calls = [];
  requestUrlMock = async (options) => {
    calls.push(options);
    return {
      status: 200,
      json: {
        success: true,
        data: {
          connected: false,
          status: 'not_connected',
        },
      },
    };
  };

  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: '',
    clientId: 'test-client',
    bindings: [{
      token: 'ABC-123',
      label: '微信 1',
      status: 'bound',
      enabled: true,
    }],
  });

  try {
    const payload = await plugin.requestJson('/feishu/oauth/status', 'GET', {});
    assert.deepStrictEqual(payload.data, {
      connected: false,
      status: 'not_connected',
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer ABC-123');
    assert.strictEqual(calls[0].headers['X-Wechat-Inbox-Client-Id'], 'test-client');
    assert.strictEqual(calls[0].url, 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync/feishu/oauth/status');
    assert.strictEqual(calls[0].url.includes('authToken='), false);
    assert.strictEqual(calls[0].url.includes('clientId='), false);
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runRequestJsonRoutesFeishuExtractToOAuthApiBaseTest() {
  const previousRequestUrlMock = requestUrlMock;
  const calls = [];
  requestUrlMock = async (options) => {
    calls.push(options);
    return {
      status: 200,
      json: {
        success: true,
        data: {
          title: 'Feishu API OK',
          blocks: [],
        },
      },
    };
  };

  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example-short-base.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    bindings: [{
      token: 'ABC-123',
      label: '微信 1',
      status: 'bound',
      enabled: true,
    }],
  });

  try {
    await plugin.requestJson('/feishu/extract', 'POST', { url: 'https://my.feishu.cn/wiki/wikiToken123' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(
      calls[0].url,
      'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync/feishu/extract',
    );
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runRequestJsonRecoversFromInvalidCloudBaseEnvTest() {
  const previousRequestUrlMock = requestUrlMock;
  const officialApiBase = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';
  const brokenApiBase = 'https://broken-cloudbase.example.com/sync';
  const calls = [];
  requestUrlMock = async (options) => {
    calls.push(options);
    if (options.url === `${brokenApiBase}/unbind-self`) {
      return {
        status: 500,
        json: {
          success: false,
          errMsg: 'collection.get:fail -501001 resource system error. [100003] Env Not Exists (859a7fdd-648c-4c9e-8e48-562dd4a3e90f) INVALID_ENV',
        },
      };
    }
    if (options.url === `${officialApiBase}/unbind-self`) {
      return {
        status: 200,
        json: {
          success: true,
          data: { status: 'unbound' },
        },
      };
    }
    throw new Error(`unexpected url ${options.url}`);
  };

  const plugin = new PluginClass();
  let savedSettings = null;
  plugin.saveData = async (settings) => {
    savedSettings = settings;
  };
  plugin.settings = helpers.mergeSettings({
    apiBase: brokenApiBase,
    token: 'ABC-123',
    clientId: 'test-client',
    bindings: [{
      token: 'ABC-123',
      label: '微信 1',
      status: 'bound',
      enabled: true,
    }],
  });

  try {
    const payload = await plugin.requestJson('/unbind-self', 'POST', { clientId: 'test-client' });
    assert.deepStrictEqual(payload.data, { status: 'unbound' });
    assert.deepStrictEqual(calls.map((item) => item.url), [
      `${brokenApiBase}/unbind-self`,
      `${officialApiBase}/unbind-self`,
    ]);
    assert.strictEqual(plugin.settings.apiBase, officialApiBase);
    assert.strictEqual(savedSettings.apiBase, officialApiBase);
    assert.strictEqual(calls[1].headers.Authorization, 'Bearer ABC-123');
    assert.strictEqual(calls[1].headers['X-Wechat-Inbox-Client-Id'], 'test-client');
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runRequestJsonRecoversFromEmptyMigrationApiBaseTest() {
  const previousRequestUrlMock = requestUrlMock;
  const officialApiBase = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';
  const emptyMigrationApiBase = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync';
  const calls = [];
  requestUrlMock = async (options) => {
    calls.push(options);
    if (options.url === `${emptyMigrationApiBase}/entitlements/status?plan=local_transcription_trial`) {
      return {
        status: 403,
        json: {
          success: false,
          errMsg: 'Invalid or expired token',
        },
      };
    }
    if (options.url === `${officialApiBase}/entitlements/status?plan=local_transcription_trial`) {
      return {
        status: 200,
        json: {
          success: true,
          data: { hasAccess: true, status: 'active', code: 'OBPROT93C6' },
        },
      };
    }
    throw new Error(`unexpected url ${options.url}`);
  };

  const plugin = new PluginClass();
  let savedSettings = null;
  plugin.saveData = async (settings) => {
    savedSettings = settings;
  };
  plugin.settings = helpers.mergeSettings({
    apiBase: emptyMigrationApiBase,
    token: 'TT7-7L6',
    clientId: 'test-client',
    bindings: [{
      token: 'TT7-7L6',
      label: '微信 1',
      status: 'bound',
      enabled: true,
    }],
  });

  try {
    const payload = await plugin.requestJson('/entitlements/status?plan=local_transcription_trial', 'GET', {});
    assert.strictEqual(payload.data.hasAccess, true);
    assert.deepStrictEqual(calls.map((item) => item.url), [
      `${officialApiBase}/entitlements/status?plan=local_transcription_trial`,
    ]);
    assert.strictEqual(plugin.settings.apiBase, officialApiBase);
    assert.strictEqual(savedSettings, null);
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runFeishuCustomAppConfigRequestTests() {
  const previousWindow = global.window;
  const openedUrls = [];
  global.window = {
    open(url) {
      openedUrls.push(url);
      return {};
    },
  };

  const calls = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: '',
    clientId: 'test-client',
    feishuAppId: 'cli_custom_app',
    feishuAppSecret: 'custom-secret',
    bindings: [{
      token: 'ABC-123',
      label: '微信 1',
      status: 'bound',
      enabled: true,
    }],
  });
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push({ path, method, body, binding });
    if (path === '/feishu/oauth/start') {
      return {
        success: true,
        data: {
          authUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=state-1',
        },
      };
    }
    if (path === '/feishu/extract') {
      return {
        success: true,
        data: {
          title: '飞书文档',
          documentId: 'docxToken123',
          blockCount: 1,
          blocks: [{ block_id: 'b1', block_type: 2, text: { elements: [{ text_run: { content: '这是一段来自飞书官方 API 的正文内容，用于验证自建应用配置会随请求传递。' } }] } }],
        },
      };
    }
    throw new Error(`unexpected request: ${path}`);
  };

  try {
    await plugin.connectFeishuCloudOAuth();
    await plugin.fetchFeishuCloudOAuthMarkdownFromUrl('https://example.feishu.cn/docx/docxToken123');
  } finally {
    global.window = previousWindow;
  }

  assert.deepStrictEqual(openedUrls, [
    'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=state-1',
  ]);
  assert.deepStrictEqual(calls.map((item) => [item.path, item.method, item.body.feishuApp]), [
    ['/feishu/oauth/start', 'POST', { appId: 'cli_custom_app', appSecret: 'custom-secret' }],
    ['/feishu/extract', 'POST', { appId: 'cli_custom_app', appSecret: 'custom-secret' }],
  ]);
  assert.strictEqual(calls[1].body.url, 'https://example.feishu.cn/docx/docxToken123');
}

async function runBindingInvalidClassificationTests() {
  assert.strictEqual(helpers.isBindingInvalidMessage('HTTP 403: upstream policy denied'), false);
  assert.strictEqual(helpers.isBindingInvalidMessage('Request failed, status 403'), false);
  assert.strictEqual(helpers.isBindingInvalidMessage('Invalid bind code'), true);
  assert.strictEqual(helpers.isBindingInvalidMessage('Invalid or expired token'), true);
  assert.strictEqual(helpers.isBindingInvalidMessage('绑定码未绑定或已失效'), true);
}

async function runFeishuOAuthSkipsStalePrimaryBindingTest() {
  const previousWindow = global.window;
  const openedUrls = [];
  global.window = {
    open(url) {
      openedUrls.push(url);
      return {};
    },
  };

  const calls = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'OLD-123',
    clientId: 'test-client',
    bindings: [{
      token: 'OLD-123',
      label: '旧微信',
      status: 'bound',
      enabled: true,
    }, {
      token: 'NEW-456',
      label: '新微信',
      status: 'bound',
      enabled: true,
    }],
  });
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push(binding.token);
    if (binding.token === 'OLD-123') {
      throw new Error('绑定码未绑定或已失效，请在插件设置里重新绑定');
    }
    return {
      success: true,
      data: {
        authUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=state-new',
      },
    };
  };

  try {
    await plugin.connectFeishuCloudOAuth();
  } finally {
    global.window = previousWindow;
  }

  assert.deepStrictEqual(calls, ['OLD-123', 'NEW-456']);
  assert.deepStrictEqual(openedUrls, [
    'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=state-new',
  ]);
}

async function runSuccessfulRebindPromotesNewPrimaryBindingTest() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'OLD-123',
    pendingBindCode: 'NEW-456',
    clientId: 'test-client',
    bindings: [{
      token: 'OLD-123',
      label: '旧微信',
      enabled: true,
      status: 'bound',
    }],
  });
  plugin.saveData = async () => {};
  plugin.requestJson = async () => ({ success: true, data: { status: 'bound' } });
  plugin.refreshProAndMaybePromptLocalComponentInstall = async () => null;

  await plugin.bindCurrentCode();

  assert.strictEqual(plugin.settings.token, 'NEW-456');
  assert.strictEqual(plugin.getActiveBindings()[0].token, 'NEW-456');
  assert.deepStrictEqual(
    plugin.settings.bindings.map((item) => item.token),
    ['NEW-456', 'OLD-123'],
  );
}

async function runInvalidBindCodeRemainsEditableTest() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    settingsVersion: 2,
    apiBase: 'https://example.com/sync',
    pendingBindCode: 'OBPROT93C6',
    clientId: 'test-client',
  });
  plugin.saveData = async () => {};
  plugin.requestJson = async () => {
    throw new Error('Request failed, status 403');
  };

  await plugin.bindCurrentCode();

  assert.strictEqual(plugin.settings.pendingBindCode, 'OBPROT93C6');
  assert.strictEqual(plugin.settings.token, '');
  assert.deepStrictEqual(plugin.getActiveBindings(), []);
}

async function runXiaohongshuRemoteImageLocalizationHeadersTest() {
  const writes = [];
  const downloads = [];
  const plugin = new PluginClass();
  plugin.app = {
    vault: {
      adapter: {
        async exists() {
          return true;
        },
        async writeBinary(filePath, buffer) {
          writes.push({ filePath, buffer });
        },
      },
    },
  };
  plugin.downloadArrayBuffer = async (url, headers) => {
    downloads.push({ url, headers });
    return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  };

  const imageUrl = 'https://sns-webpic-qc.xhscdn.com/spectrum/inner-image!nd_dft_wlteh_jpg_3';
  const markdown = `![内页图 1](${imageUrl})`;
  const localized = await plugin.saveMarkdownRemoteImageAssets(
    markdown,
    '临时收集',
    '2026-07-20',
    '小红书测试',
    { sourceUrl: 'https://www.xiaohongshu.com/explore/test-note' },
  );

  assert.strictEqual(downloads.length, 1);
  assert.strictEqual(downloads[0].url, imageUrl);
  assert.strictEqual(downloads[0].headers.Referer, 'https://www.xiaohongshu.com/');
  assert.ok(downloads[0].headers['User-Agent']);
  assert.strictEqual(writes.length, 1);
  assert.ok(localized.includes('![[临时收集/网页图片/2026-07-20/'));
  assert.strictEqual(localized.includes(imageUrl), false);
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

async function runStopCurrentTranscriptionDeletesCurrentRecordTest() {
  const calls = [];
  let aborted = false;
  const plugin = new PluginClass();
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push([path, method, body, binding && binding.token]);
    return { success: true, data: { id: 'record-stop-1', status: 'deleted' } };
  };
  plugin.currentTranscriptionAbortController = { abort() { aborted = true; } };
  plugin.currentTranscriptionContext = {
    recordId: 'record-stop-1',
    binding: { token: 'ABC-123' },
  };
  await plugin.stopCurrentTranscription();
  assert.strictEqual(aborted, true);
  assert.deepStrictEqual(calls, [[
    '/records/record-stop-1/delete', 'POST', {}, 'ABC-123',
  ]]);
}

async function runStoppedTranscriptionDeleteUsesLongControlPlaneTest() {
  const previousRequestUrlMock = requestUrlMock;
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://short.example.com/sync',
    token: 'ABC-123',
    clientId: 'client-stop-delete',
  });
  let requestedUrl = '';
  requestUrlMock = async (options) => {
    requestedUrl = options.url;
    return {
      status: 200,
      json: {
        success: true,
        data: { id: 'record-control-plane', deleted: true },
      },
      text: '',
    };
  };
  try {
    const result = await plugin.deleteCurrentTranscriptionRecord({
      recordId: 'record-control-plane',
      binding: { token: 'ABC-123' },
    });
    assert.strictEqual(result.deleted, true);
    assert.strictEqual(
      requestedUrl,
      'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync/records/record-control-plane/delete',
    );
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runStopCurrentTranscriptionWithoutCurrentRecordDoesNotDeleteTest() {
  const calls = [];
  const plugin = new PluginClass();
  plugin.requestJson = async (...args) => {
    calls.push(args);
    return { success: true, data: {} };
  };
  plugin.currentTranscriptionAbortController = { abort() {} };
  await plugin.stopCurrentTranscription();
  assert.deepStrictEqual(calls, []);
}

async function runStopCurrentTranscriptionWithoutActiveProcessDoesNotDeleteTest() {
  const calls = [];
  const plugin = new PluginClass();
  plugin.requestJson = async (...args) => {
    calls.push(args);
    return { success: true, data: {} };
  };
  plugin.currentTranscriptionContext = {
    recordId: 'record-stop-stale',
    binding: { token: 'ABC-123' },
  };
  await plugin.stopCurrentTranscription();
  assert.deepStrictEqual(calls, []);
}

async function runStoppedDeletedRecordDoesNotRemainFailedInCurrentSyncTest() {
  const plugin = new PluginClass();
  let resolveDeleteRequest;
  const deleteRequest = new Promise((resolve) => {
    resolveDeleteRequest = resolve;
  });
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
  });
  plugin.showSyncProgress = () => {};
  plugin.requestJson = async (path) => {
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'record-stop-2',
          type: 'voice',
          content: '需要停止的录音',
          createdAt: '2026-07-26T09:00:00.000Z',
          metadata: { audioFileID: 'cloud://voices/stop-2.mp3' },
        }],
      };
    }
    return deleteRequest;
  };
  plugin.findExistingRecordNotePath = async () => '';
  plugin.writeRecord = async (record) => {
    plugin.currentTranscriptionAbortController = { abort() {} };
    plugin.currentTranscriptionContext = {
      recordId: record._id,
      binding: { token: 'ABC-123' },
    };
    void plugin.stopCurrentTranscription();
    setTimeout(() => {
      resolveDeleteRequest({
        success: true,
        data: { id: 'record-stop-2', status: 'deleted' },
      });
    }, 0);
    throw helpers.createRetryableTranscriptionError('用户已停止当前转写');
  };
  const result = await plugin.syncBinding({
    token: 'ABC-123',
    label: '测试微信',
  }, false);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(result.skipped, [{
    recordId: 'record-stop-2',
    reason: 'deleted-current-transcription',
  }]);
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

async function runXiaohongshuUnavailableRecordRemainsPendingTest() {
  const calls = [];
  const writeCalls = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
  });
  plugin.showSyncProgress = () => {};
  plugin.findExistingRecordNotePath = async () => '';
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push([path, method, body, binding && binding.token]);
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'xhs-content-unavailable-1',
          type: 'webpage',
          content: 'https://www.xiaohongshu.com/explore/unavailable-graphic-note',
          createdAt: '2026-07-16T08:00:00.000Z',
          metadata: { url: 'https://www.xiaohongshu.com/explore/unavailable-graphic-note' },
        }, {
          _id: 'plain-record-after-xhs-failure',
          type: 'text',
          content: '失败后仍应继续处理',
          createdAt: '2026-07-16T08:01:00.000Z',
          metadata: {},
        }],
      };
    }
    return { success: true, data: {} };
  };
  plugin.writeRecord = async (record) => {
    writeCalls.push(record._id);
    if (record._id === 'xhs-content-unavailable-1') {
      throw helpers.createRetryableXiaohongshuContentError({
        runtime: helpers.getPluginRuntimeIdentity('1.3.70'),
        request: {
          sourceHost: 'xiaohongshu.com',
          finalHost: 'xiaohongshu.com',
          responseStatus: 200,
          pageType: 'xiaohongshu-generic-landing',
        },
        extraction: {
          hasUsableTitle: false,
          bodyCharacterCount: 0,
          imageCount: 0,
          shareBoilerplateOnly: true,
          genericLanding: true,
          unavailablePage: false,
        },
      });
    }
    return {
      recordId: record._id,
      title: '失败后仍应继续处理',
      filePath: '临时收集/失败后仍应继续处理.md',
    };
  };

  const result = await plugin.syncBinding({
    token: 'ABC-123',
    label: '测试微信',
  }, false);

  assert.deepStrictEqual(result.written, [{
    recordId: 'plain-record-after-xhs-failure',
    title: '失败后仍应继续处理',
    filePath: '临时收集/失败后仍应继续处理.md',
  }]);
  assert.deepStrictEqual(result.failed, [{
    recordId: 'xhs-content-unavailable-1',
    message: '小红书内容提取失败，已记录诊断，下次同步将重试。',
    diagnostic: {
      runtime: {
        manifestVersion: '1.3.70',
        runtimeVersion: '1.3.70',
        buildMarker: 'clipboard-link-path-v1',
        matchesManifest: true,
      },
      request: {
        sourceHost: 'xiaohongshu.com',
        finalHost: 'xiaohongshu.com',
        responseStatus: 200,
        pageType: 'xiaohongshu-generic-landing',
      },
      extraction: {
        hasUsableTitle: false,
        bodyCharacterCount: 0,
        imageCount: 0,
        shareBoilerplateOnly: true,
        genericLanding: true,
        unavailablePage: false,
      },
    },
  }]);
  assert.deepStrictEqual(writeCalls, [
    'xhs-content-unavailable-1',
    'plain-record-after-xhs-failure',
  ]);
  assert.strictEqual(plugin.lastSyncDiagnostic.recordId, 'xhs-content-unavailable-1');
  assert.strictEqual(plugin.lastSyncDiagnostic.diagnostic.extraction.shareBoilerplateOnly, true);
  assert.deepStrictEqual(calls, [[
    '/records?status=pending',
    'GET',
    {},
    'ABC-123',
  ], [
    '/records/plain-record-after-xhs-failure/synced',
    'POST',
    {},
    'ABC-123',
  ]]);
}

async function runXiaohongshuFailureClosedIntegrationTest() {
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-xhs-failure-'));
  const requestCalls = [];
  const vaultWrites = [];
  const plugin = new PluginClass();
  const privateTitle = '用户私密标题不应写入日志';
  const privateQueryValue = 'query-value-must-not-leak';
  plugin.manifest = { version: '1.3.62' };
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    inboxDir: '临时收集',
  });
  plugin.getConfiguredLocalAsrInstallRoot = () => logRoot;
  plugin.ensureFolder = async () => {};
  plugin.nextRecordTitle = async () => privateTitle;
  plugin.findExistingRecordNotePath = async () => '';
  plugin.hasProFeatureAccess = async () => false;
  plugin.renderSocialMediaUrls = async () => [];
  plugin.renderXiaohongshuPage = async () => ({
    html: genericXiaohongshuLandingHtml,
    comments: [],
  });
  plugin.app = {
    vault: {
      adapter: {
        async write(filePath, markdown) {
          vaultWrites.push({ filePath, markdown });
        },
      },
    },
  };
  plugin.requestJson = async (requestPath, method, body, binding) => {
    requestCalls.push([requestPath, method, body, binding && binding.token]);
    if (requestPath === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'xhs-full-failure-1',
          type: 'webpage',
          content: `https://www.xiaohongshu.com/explore/unavailable?xsec_token=${privateQueryValue}`,
          createdAt: '2026-07-25T08:00:00.000Z',
          metadata: {
            url: `https://www.xiaohongshu.com/explore/unavailable?xsec_token=${privateQueryValue}`,
            title: privateTitle,
            shareText: `${privateTitle} http://xhslink.cn/o/demo 存下口令，跳转【小红书】阅读~`,
          },
        }],
      };
    }
    return { success: true, data: {} };
  };
  const previousRequestUrlMock = requestUrlMock;
  requestUrlMock = async () => ({
    status: 200,
    text: genericXiaohongshuLandingHtml,
  });
  try {
    const result = await plugin.syncBinding({
      token: 'ABC-123',
      label: '测试微信',
    }, false);
    assert.deepStrictEqual(result.written, []);
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(result.failed[0].message, '小红书内容提取失败，已记录诊断，下次同步将重试。');
    assert.deepStrictEqual(vaultWrites, []);
    assert.deepStrictEqual(requestCalls, [[
      '/records?status=pending',
      'GET',
      {},
      'ABC-123',
    ]]);
    const logText = fs.readFileSync(path.join(logRoot, 'sync-last.log'), 'utf8');
    assert.ok(logText.includes('status=failed'));
    assert.ok(logText.includes('"pageType": "xiaohongshu-generic-landing"'));
    assert.strictEqual(logText.includes(privateTitle), false);
    assert.strictEqual(logText.includes(privateQueryValue), false);
    assert.strictEqual(logText.includes('存下口令'), false);
  } finally {
    requestUrlMock = previousRequestUrlMock;
    fs.rmSync(logRoot, { recursive: true, force: true });
  }
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

async function runMarkSyncedRecordNotFoundIsIdempotentTest() {
  const calls = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    inboxDir: '临时收集',
  });
  plugin.showSyncProgress = () => {};
  plugin.requestJson = async (path, method, body, binding) => {
    calls.push([path, method, body, binding && binding.token]);
    if (path === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'record-vanished-after-write',
          type: 'text',
          content: '本地已经写入，云端标记时记录已被清理',
          createdAt: '2026-06-25T08:00:00.000Z',
          metadata: {},
        }],
      };
    }
    if (path === '/records/record-vanished-after-write/synced') {
      throw new Error('Record not found');
    }
    return {
      success: true,
      data: {},
    };
  };
  plugin.writeRecord = async (record) => ({
    recordId: record._id,
    title: '文本-本地已经写入',
    filePath: '临时收集/2026-06-25/文本-本地已经写入.md',
  });

  const result = await plugin.syncBinding({
    token: 'ABC-123',
    label: '测试微信',
  }, false);

  assert.deepStrictEqual(result.written, [{
    recordId: 'record-vanished-after-write',
    title: '文本-本地已经写入',
    filePath: '临时收集/2026-06-25/文本-本地已经写入.md',
  }]);
  assert.deepStrictEqual(result.failed, []);
  assert.deepStrictEqual(result.skipped, []);
  assert.deepStrictEqual(calls, [[
    '/records?status=pending',
    'GET',
    {},
    'ABC-123',
  ], [
    '/records/record-vanished-after-write/synced',
    'POST',
    {},
    'ABC-123',
  ]]);
}

async function runUnbindAlreadyRemoteUnboundClearsLocalBindingTest() {
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
    pendingRedeemCode: 'OBPROT93C6',
    localTranscriptionEntitlementStatus: {
      hasAccess: false,
      plan: 'local_transcription_beta',
      status: 'invalid_redeem_code',
      code: 'OBPROT93C6',
      message: 'collection.get:fail -501001 resource system error. [100003] Env Not Exists (85ab9ac4-006f-4935-918d-e2c97ac3828e) INVALID_ENV',
      bindingToken: 'OLD-123',
      bindingLabel: '旧微信',
    },
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
    assert.strictEqual(plugin.settings.pendingRedeemCode, '');
    assert.deepStrictEqual(plugin.settings.localTranscriptionEntitlementStatus, {
      hasAccess: false,
      plan: 'local_transcription_beta',
      status: 'unbound',
      expiresAt: '',
    });
    assert.deepStrictEqual(savedSettings.bindings, []);
    assert.strictEqual(savedSettings.token, '');
    assert.strictEqual(savedSettings.pendingRedeemCode, '');
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runUnbindObsidianRaw403ClearsLocalBindingTest() {
  const previousRequestUrlMock = requestUrlMock;
  requestUrlMock = async () => {
    throw new Error('Request failed, status 403');
  };

  const plugin = new PluginClass();
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
    assert.strictEqual(savedSettings.token, '');
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }
}

async function runUnbindTransportFailurePreservesLocalBindingTest() {
  const plugin = new PluginClass();
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
  plugin.requestJson = async () => {
    throw new Error('网络连接失败：socket hang up');
  };

  await plugin.unbindBinding('OLD-123');

  assert.strictEqual(plugin.settings.token, 'OLD-123');
  assert.deepStrictEqual(plugin.settings.bindings.map((item) => item.token), ['OLD-123']);
  assert.strictEqual(savedSettings, null);
}

async function runUnbindServer5xxPreservesLocalBindingTest() {
  const server = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST');
    assert.strictEqual(req.url, '/sync/unbind-self');
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      errMsg: 'Temporary server error',
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const previousRequestUrlMock = requestUrlMock;
  requestUrlMock = async () => {
    throw new Error('Request failed, status 500');
  };

  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    apiBase: `http://127.0.0.1:${server.address().port}/sync`,
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
    assert.strictEqual(plugin.settings.token, 'OLD-123');
    assert.deepStrictEqual(plugin.settings.bindings.map((item) => item.token), ['OLD-123']);
    assert.strictEqual(savedSettings, null);
  } finally {
    requestUrlMock = previousRequestUrlMock;
    await new Promise((resolve) => server.close(resolve));
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
    pendingRedeemCode: 'OBPROT93C6',
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    bindings: [{
      token: 'ABC-123',
      label: '付费微信',
      enabled: true,
      status: 'bound',
    }],
  });

  requestUrlMock = async ({ url, method, headers, body }) => {
    if (method === 'GET') {
      assert.ok([
        'https://example.com/sync/entitlements/status?plan=local_transcription_beta',
        'https://example.com/sync/entitlements/status?plan=local_transcription_trial',
      ].includes(url));
      assert.strictEqual(headers.Authorization, 'Bearer ABC-123');
      assert.strictEqual(headers['Cache-Control'], 'no-cache');
      return {
        status: 200,
        text: JSON.stringify({
          success: true,
          data: {
            hasAccess: false,
            plan: 'local_transcription_beta',
            status: 'inactive',
          },
        }),
      };
    }
    assert.strictEqual(method, 'POST');
    assert.strictEqual(url, 'https://example.com/sync/entitlements/redeem');
    assert.strictEqual(headers.Authorization, 'Bearer ABC-123');
    assert.deepStrictEqual(JSON.parse(body), { code: 'OBPROT93C6' });
    return {
      status: 200,
      text: JSON.stringify({
        success: true,
        data: {
          hasAccess: true,
          plan: 'local_transcription_beta',
          status: 'active',
          expiresAt: '2026-07-03T08:00:00.000Z',
          code: 'OBPROT93C6',
        },
      }),
    };
  };

  try {
    const status = await plugin.getProFeatureAccessStatus({ forceRefresh: true });
    assert.strictEqual(status.hasAccess, true, JSON.stringify(status));
    assert.strictEqual(status.code, 'OBPROT93C6');
    assert.strictEqual(status.expiresAt, '2026-07-03T08:00:00.000Z');
    assert.strictEqual(plugin.settings.localTranscriptionEntitlementStatus.hasAccess, true);
    assert.strictEqual(plugin.settings.localTranscriptionEntitlementStatus.code, 'OBPROT93C6');
    assert.strictEqual(plugin.settings.pendingRedeemCode, 'OBPROT93C6');
    assert.strictEqual(plugin.settings.localTranscriptionEntitlementStatus.expiresAt, '2026-07-03T08:00:00.000Z');
    assert.strictEqual(typeof plugin.redeemLocalTranscriptionCode, 'undefined');
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }

  const cachedCodePlugin = new PluginClass();
  cachedCodePlugin.saveData = async () => {};
  cachedCodePlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'ABC-123',
    clientId: 'test-client',
    pendingRedeemCode: 'OBPROT93C6',
    localTranscriptionEntitlementStatus: {
      hasAccess: true,
      plan: 'local_transcription_beta',
      status: 'active',
      expiresAt: '2026-08-03T08:00:00.000Z',
      code: 'OBPROT93C6',
    },
    bindings: [{
      token: 'ABC-123',
      label: '付费微信',
      enabled: true,
      status: 'bound',
    }],
  });
  requestUrlMock = async () => {
    throw new Error('cached code access should not request the cloud');
  };
  try {
    const status = await cachedCodePlugin.getProFeatureAccessStatus();
    assert.strictEqual(status.hasAccess, true);
    assert.strictEqual(status.code, 'OBPROT93C6');
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }

  const bindingEntitlementPlugin = new PluginClass();
  bindingEntitlementPlugin.saveData = async () => {};
  bindingEntitlementPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'BIND-PRO',
    clientId: 'binding-pro-client',
    pendingRedeemCode: '',
    bindings: [{
      token: 'BIND-PRO',
      label: '已购微信',
      enabled: true,
      status: 'bound',
    }],
  });
  const bindingEntitlementRequests = [];
  requestUrlMock = async ({ url, method, headers }) => {
    bindingEntitlementRequests.push([method, url]);
    assert.strictEqual(method, 'GET');
    assert.strictEqual(url, 'https://example.com/sync/entitlements/status?plan=local_transcription_beta');
    assert.strictEqual(headers.Authorization, 'Bearer BIND-PRO');
    assert.strictEqual(headers['Cache-Control'], 'no-cache');
    assert.strictEqual(headers.Pragma, 'no-cache');
    return {
      status: 200,
      text: JSON.stringify({
        success: true,
        data: {
          hasAccess: true,
          plan: 'local_transcription_beta',
          status: 'active',
          expiresAt: '2026-07-30T08:00:00.000Z',
          code: 'OBPROT93C6',
        },
      }),
    };
  };
  try {
    const status = await bindingEntitlementPlugin.getProFeatureAccessStatus({ forceRefresh: true });
    assert.deepStrictEqual(bindingEntitlementRequests, [[
      'GET',
      'https://example.com/sync/entitlements/status?plan=local_transcription_beta',
    ]]);
    assert.strictEqual(status.hasAccess, true);
    assert.strictEqual(status.code, 'OBPROT93C6');
    assert.strictEqual(status.bindingLabel, '已购微信');
    assert.strictEqual(bindingEntitlementPlugin.settings.localTranscriptionEntitlementStatus.hasAccess, true);
    assert.strictEqual(bindingEntitlementPlugin.settings.pendingRedeemCode, 'OBPROT93C6');
    const usableStatus = await bindingEntitlementPlugin.ensureProFeatureAccess('图片 OCR');
    assert.strictEqual(usableStatus.hasAccess, true);
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }

  const queryFailurePlugin = new PluginClass();
  queryFailurePlugin.saveData = async () => {};
  const existingActiveEntitlement = {
    hasAccess: true,
    plan: 'local_transcription_trial',
    status: 'active',
    expiresAt: '2026-08-03T08:00:00.000Z',
    code: 'OBPROKEEP1',
  };
  queryFailurePlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'QUERY-FAIL',
    clientId: 'query-fail-client',
    localTranscriptionEntitlementStatus: existingActiveEntitlement,
    bindings: [{ token: 'QUERY-FAIL', label: '查询失败微信', enabled: true, status: 'bound' }],
  });
  queryFailurePlugin.requestJson = async () => {
    throw new Error('权限接口连接失败');
  };
  await assert.rejects(
    () => queryFailurePlugin.getProFeatureAccessStatus({ forceRefresh: true }),
    /权限接口连接失败/,
  );
  assert.deepStrictEqual(
    queryFailurePlugin.settings.localTranscriptionEntitlementStatus,
    existingActiveEntitlement,
  );
  assert.ok(queryFailurePlugin.settings.proEntitlementLastError.includes('权限接口连接失败'));
  assert.ok(queryFailurePlugin.settings.proEntitlementLastErrorAt);

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
  requestUrlMock = async ({ url, method, headers }) => {
    assert.strictEqual(method, 'GET');
    assert.ok([
      'https://example.com/sync/entitlements/status?plan=local_transcription_beta',
      'https://example.com/sync/entitlements/status?plan=local_transcription_trial',
    ].includes(url));
    assert.strictEqual(headers.Authorization, 'Bearer TRIAL-123');
    return {
      status: 200,
      text: JSON.stringify({
        success: true,
        data: {
          hasAccess: false,
          plan: 'local_transcription_beta',
          status: 'inactive',
        },
      }),
    };
  };

  try {
    const status = await trialFallbackPlugin.getProFeatureAccessStatus({ forceRefresh: true });
    assert.strictEqual(status.hasAccess, false);
    assert.strictEqual(status.status, 'inactive');
    assert.strictEqual(trialFallbackPlugin.settings.localTranscriptionEntitlementStatus.hasAccess, false);
    await assert.rejects(
      () => trialFallbackPlugin.ensureProFeatureAccess('测试功能'),
      /Pro/,
    );
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }

  const emptyInputWithCachedProPlugin = new PluginClass();
  emptyInputWithCachedProPlugin.saveData = async () => {};
  emptyInputWithCachedProPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'CACHED-123',
    clientId: 'cached-client',
    pendingRedeemCode: '',
    localTranscriptionEntitlementStatus: {
      hasAccess: true,
      plan: 'local_transcription_beta',
      status: 'active',
      expiresAt: '2026-07-30T08:00:00.000Z',
      code: 'OBPROT93C6',
    },
    bindings: [{
      token: 'CACHED-123',
      label: '已购微信',
      enabled: true,
      status: 'bound',
    }],
  });
  requestUrlMock = async () => {
    throw new Error('active cached Pro should not request the cloud when the redeem code input is empty');
  };
  try {
    const status = await emptyInputWithCachedProPlugin.getProFeatureAccessStatus();
    assert.strictEqual(status.hasAccess, true);
    assert.strictEqual(status.code, 'OBPROT93C6');
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }

  const autoRedeemPlugin = new PluginClass();
  autoRedeemPlugin.saveData = async () => {};
  autoRedeemPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'AUTO-123',
    clientId: 'auto-client',
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    bindings: [{
      token: 'AUTO-123',
      label: '自动识别微信',
      enabled: true,
      status: 'bound',
    }],
  });
  const autoRedeemRequests = [];
  requestUrlMock = async ({ url, method, headers, body }) => {
    assert.strictEqual(headers.Authorization, 'Bearer AUTO-123');
    autoRedeemRequests.push([method, url, body || '']);
    assert.strictEqual(method, 'POST');
    assert.strictEqual(url, 'https://example.com/sync/entitlements/auto-redeem');
    return {
      status: 200,
      text: JSON.stringify({
        success: true,
        data: {
          hasAccess: true,
          plan: 'local_transcription_beta',
          status: 'active',
          expiresAt: '2026-07-30T08:00:00.000Z',
          code: 'OBPROT93C6',
          source: 'redeem_code',
          autoRedeemed: true,
        },
      }),
    };
  };

  try {
    const status = await autoRedeemPlugin.autoRedeemProCode({ silent: true });
    assert.deepStrictEqual(autoRedeemRequests.map(([method, url]) => [method, url]), [
      ['POST', 'https://example.com/sync/entitlements/auto-redeem'],
    ]);
    assert.strictEqual(status.hasAccess, true);
    assert.strictEqual(status.code, 'OBPROT93C6');
    assert.strictEqual(status.expiresAt, '2026-07-30T08:00:00.000Z');
    assert.strictEqual(status.bindingLabel, '自动识别微信');
    assert.strictEqual(autoRedeemPlugin.settings.pendingRedeemCode, 'OBPROT93C6');
    assert.strictEqual(autoRedeemPlugin.settings.localTranscriptionEntitlementStatus.code, 'OBPROT93C6');
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }

  requestUrlMock = async () => {
    throw new Error('Request failed, status 404');
  };
  try {
    const status = await autoRedeemPlugin.autoRedeemProCode({ silent: true });
    assert.strictEqual(status, null);
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
  requestUrlMock = async ({ url, method, headers }) => {
    assert.strictEqual(method, 'GET');
    assert.ok([
      'https://example.com/sync/entitlements/status?plan=local_transcription_beta',
      'https://example.com/sync/entitlements/status?plan=local_transcription_trial',
    ].includes(url));
    assert.strictEqual(headers.Authorization, 'Bearer DEF-456');
    return {
      status: 200,
      text: JSON.stringify({
        success: true,
        data: {
          hasAccess: false,
          plan: 'local_transcription_beta',
          status: 'inactive',
        },
      }),
    };
  };

  try {
    await assert.rejects(
      () => deniedPlugin.runConfiguredTranscription('https://media.example.com/demo.mp4'),
      /Pro/,
    );
  } finally {
    requestUrlMock = previousRequestUrlMock;
  }

  const setupPlugin = new PluginClass();
  setupPlugin.saveData = async () => {};
  setupPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'SETUP-PRO',
    clientId: 'setup-client',
    bindings: [{
      token: 'SETUP-PRO',
      label: '自动安装微信',
      enabled: true,
      status: 'bound',
    }],
  });
  setupPlugin.requestJson = async (path, method, body, binding) => {
    assert.strictEqual(path, '/entitlements/status?plan=local_transcription_beta');
    assert.strictEqual(method, 'GET');
    assert.strictEqual(binding.token, 'SETUP-PRO');
    return {
      success: true,
      data: {
        hasAccess: true,
        plan: 'local_transcription_beta',
        status: 'active',
        expiresAt: '2026-07-30T08:00:00.000Z',
      },
    };
  };
  setupPlugin.getLocalAsrInstallStatus = () => ({
    ready: false,
    installRoot: 'C:\\Users\\tester\\.wechat-inbox-local-asr',
    missingReasons: ['whisper 未找到'],
  });
  setupPlugin.getLocalOcrInstallStatus = () => ({
    ready: false,
    installRoot: 'C:\\Users\\tester\\.wechat-inbox-local-ocr',
    missingReasons: ['Python OCR 运行环境未找到'],
  });
  let confirmSetupReason = '';
  setupPlugin.confirmLocalComponentInstall = async (status, reason, readiness) => {
    confirmSetupReason = reason;
    assert.strictEqual(status.hasAccess, true);
    assert.strictEqual(readiness.ready, false);
    assert.deepStrictEqual(readiness.missingComponents, ['音视频转写', '图片文字识别 OCR']);
    return true;
  };
  const installComponentCalls = [];
  setupPlugin.installLocalTranscriptionComponents = async (options = {}) => {
    installComponentCalls.push(options.reason);
    return { installed: true };
  };
  const setupStatus = await setupPlugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'bind', force: true });
  assert.strictEqual(setupStatus.hasAccess, true);
  assert.strictEqual(confirmSetupReason, 'bind');
  assert.deepStrictEqual(installComponentCalls, ['bind']);

  const refreshKeepsProStatusPlugin = new PluginClass();
  refreshKeepsProStatusPlugin.saveData = async () => {};
  refreshKeepsProStatusPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'KEEP-PRO',
    clientId: 'keep-pro-client',
    bindings: [{
      token: 'KEEP-PRO',
      label: '刷新微信',
      enabled: true,
      status: 'bound',
    }],
  });
  refreshKeepsProStatusPlugin.getProFeatureAccessStatus = async () => ({
    hasAccess: true,
    plan: 'local_transcription_beta',
    status: 'active',
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
  refreshKeepsProStatusPlugin.getLocalTranscriptionComponentReadiness = () => ({
    ready: false,
    platform: 'win32',
    platformName: 'Windows',
    missingComponents: ['图片文字识别 OCR'],
  });
  refreshKeepsProStatusPlugin.confirmLocalComponentInstall = async () => true;
  refreshKeepsProStatusPlugin.installLocalTranscriptionComponents = async () => {
    throw new Error('图片文字识别 OCR：tar.exe 拒绝访问');
  };
  const refreshKeepsProStatus = await refreshKeepsProStatusPlugin.refreshProAndMaybePromptLocalComponentInstall({
    reason: 'manual-refresh',
    force: true,
  });
  assert.strictEqual(refreshKeepsProStatus.hasAccess, true);
  assert.strictEqual(refreshKeepsProStatus.localComponentInstallError, '图片文字识别 OCR：tar.exe 拒绝访问');

  const ocrOnlyPlugin = new PluginClass();
  ocrOnlyPlugin.settings = helpers.mergeSettings({});
  ocrOnlyPlugin.ensureProFeatureAccess = async () => ({ hasAccess: true });
  let ocrOnlyReady = false;
  let ocrOnlyAsrCalls = 0;
  let ocrOnlyOcrCalls = 0;
  ocrOnlyPlugin.getLocalAsrInstallStatus = () => ({
    ready: false,
    missingReasons: ['whisper 未找到'],
  });
  ocrOnlyPlugin.getLocalOcrInstallStatus = () => ({
    ready: ocrOnlyReady,
    missingReasons: ocrOnlyReady ? [] : ['Python OCR 运行环境未找到'],
  });
  ocrOnlyPlugin.installLocalAsr = async () => {
    ocrOnlyAsrCalls += 1;
    throw new Error('OCR-only install should not install ASR');
  };
  ocrOnlyPlugin.installLocalOcr = async () => {
    ocrOnlyOcrCalls += 1;
    ocrOnlyReady = true;
  };
  await ocrOnlyPlugin.installLocalTranscriptionComponents({
    reason: 'first-use',
    requireAsr: false,
    requireOcr: true,
  });
  assert.strictEqual(ocrOnlyAsrCalls, 0);
  assert.strictEqual(ocrOnlyOcrCalls, 1);

  const installAllPlugin = new PluginClass();
  installAllPlugin.settings = helpers.mergeSettings({});
  installAllPlugin.ensureProFeatureAccess = async () => ({ hasAccess: true });
  let installAllOcrCalls = 0;
  installAllPlugin.getLocalAsrInstallStatus = () => ({
    ready: false,
    missingReasons: ['whisper 未找到'],
  });
  installAllPlugin.getLocalOcrInstallStatus = () => ({
    ready: false,
    missingReasons: ['Python OCR 运行环境未找到'],
  });
  installAllPlugin.installLocalAsr = async () => {
    throw new Error('ASR install failed');
  };
  installAllPlugin.installLocalOcr = async () => {
    installAllOcrCalls += 1;
  };
  await assert.rejects(
    () => installAllPlugin.doInstallLocalTranscriptionComponents({
      reason: 'settings-open',
      requireAsr: true,
      requireOcr: true,
    }),
    /ASR install failed/,
  );
  assert.strictEqual(installAllOcrCalls, 1);

  const freeSetupPlugin = new PluginClass();
  freeSetupPlugin.saveData = async () => {};
  freeSetupPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'SETUP-FREE',
    clientId: 'setup-free-client',
    bindings: [{
      token: 'SETUP-FREE',
      label: '免费微信',
      enabled: true,
      status: 'bound',
    }],
  });
  freeSetupPlugin.requestJson = async () => ({
    success: true,
    data: {
      hasAccess: false,
      plan: 'local_transcription_beta',
      status: 'inactive',
    },
  });
  freeSetupPlugin.getLocalAsrInstallStatus = setupPlugin.getLocalAsrInstallStatus;
  freeSetupPlugin.getLocalOcrInstallStatus = setupPlugin.getLocalOcrInstallStatus;
  freeSetupPlugin.confirmLocalComponentInstall = async () => {
    throw new Error('free user should not see local component install prompt');
  };
  freeSetupPlugin.installLocalTranscriptionComponents = async () => {
    throw new Error('free user should not install local components automatically');
  };
  const freeSetupStatus = await freeSetupPlugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open', force: true });
  assert.strictEqual(freeSetupStatus.hasAccess, false);

  const recentInactivePlugin = new PluginClass();
  recentInactivePlugin.saveData = async () => {};
  recentInactivePlugin.settings = helpers.mergeSettings({
    proSetupLastCheckedAt: new Date().toISOString(),
    localTranscriptionEntitlementStatus: {
      hasAccess: false,
      status: 'inactive',
      expiresAt: '',
    },
  });
  let recentInactiveCloudCalls = 0;
  recentInactivePlugin.getProFeatureAccessStatus = async () => {
    recentInactiveCloudCalls += 1;
    return {
      hasAccess: true,
      status: 'active',
      expiresAt: '2026-08-01T00:00:00.000Z',
    };
  };
  recentInactivePlugin.getLocalTranscriptionComponentReadiness = () => ({ ready: true });
  const refreshedRecentInactiveStatus = await recentInactivePlugin.refreshProAndMaybePromptLocalComponentInstall({
    reason: 'settings-open',
  });
  assert.strictEqual(recentInactiveCloudCalls, 1);
  assert.strictEqual(refreshedRecentInactiveStatus.hasAccess, true);

  const forceRefreshPlugin = new PluginClass();
  let receivedOptions = null;
  forceRefreshPlugin.getProFeatureAccessStatus = async (options) => {
    receivedOptions = options;
    return {
      hasAccess: true,
      status: 'active',
      expiresAt: '2026-08-01T00:00:00.000Z',
    };
  };
  await forceRefreshPlugin.ensureProFeatureAccess('保存原始音视频到本地', { forceRefresh: true });
  assert.deepStrictEqual(receivedOptions, { forceRefresh: true });

  const expiredPlugin = new PluginClass();
  expiredPlugin.saveData = async () => {};
  expiredPlugin.settings = helpers.mergeSettings({
    apiBase: 'https://example.com/sync',
    token: 'EXPIRED-PRO',
    clientId: 'expired-client',
    bindings: [{ token: 'EXPIRED-PRO', label: '已到期微信', enabled: true, status: 'bound' }],
    localTranscriptionEntitlementStatus: {
      hasAccess: true,
      status: 'active',
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  });
  expiredPlugin.requestJson = async () => ({
    success: true,
    data: {
      hasAccess: true,
      status: 'active',
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    },
  });
  await assert.rejects(
    () => expiredPlugin.ensureProFeatureAccess('音视频转写'),
    /Pro/,
  );
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
  }, 'raw\\wechatmd', '2026-06-13', '录音-001', {
    token: 'ABC-123',
  });

  assert.deepStrictEqual(transcriptionCalls, [[
    'https://temp.example.com/cloud-failed.mp3',
    'cloud://voices/cloud-failed.mp3',
    true,
    'cloud-pretranscription-failed',
  ]]);
  assert.deepStrictEqual(writtenBinaries, [[
    'raw/wechatmd/语音附件/2026-06-13/录音-001.mp3',
    'audio-bytes',
  ]]);
  assert.strictEqual(result.metadata.transcription, '本地兜底转写成功');
  assert.strictEqual(result.metadata.transcriptionStatus, 'success');
  assert.strictEqual(result.metadata.transcriptionProvider, 'local');
  assert.strictEqual(result.metadata.cloudTranscriptionError, '云端转写额度不足');
}

async function runStoppedTranscriptionEscapesRealAttachmentPathsTest() {
  const createPlugin = () => {
    const plugin = new PluginClass();
    plugin.settings = helpers.mergeSettings({
      aiProvider: 'local',
      localTranscriptionCommand: 'echo local',
    });
    plugin.app = {
      vault: {
        adapter: {
          exists: async () => true,
          writeBinary: async () => {},
        },
        createFolder: async () => {},
      },
    };
    plugin.requestFileDownloadUrl = async () => 'https://temp.example.com/stopped.mp3';
    plugin.downloadArrayBuffer = async () => Buffer.from('stopped-audio');
    plugin.runConfiguredTranscription = async () => {
      throw helpers.createRetryableTranscriptionError('用户已停止当前转写');
    };
    plugin.showSyncProgress = () => {};
    return plugin;
  };

  await assert.rejects(
    () => createPlugin().writeVoiceAttachment({
      _id: 'record-stopped-voice',
      type: 'voice',
      content: 'stopped.mp3',
      metadata: {
        audioFileID: 'cloud://voices/stopped.mp3',
        audioFileName: 'stopped.mp3',
        transcriptionMode: 'local',
      },
    }, 'raw/wechatmd', '2026-07-26', '停止录音', { token: 'ABC-123' }),
    (error) => helpers.isRetryableTranscriptionError(error),
  );

  await assert.rejects(
    () => createPlugin().writeFileAttachment({
      _id: 'record-stopped-file',
      type: 'file',
      content: 'stopped.mp4',
      metadata: {
        fileID: 'cloud://files/stopped.mp4',
        fileName: 'stopped.mp4',
        fileExt: 'mp4',
        transcriptionMode: 'local',
      },
    }, 'raw/wechatmd', '2026-07-26', '停止视频', { token: 'ABC-123' }),
    (error) => helpers.isRetryableTranscriptionError(error),
  );
}

async function runAudioVideoFileAttachmentTranscriptionTests() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    aiProvider: 'local',
    localTranscriptionCommand: 'echo test',
    aiMetadataEnabled: true,
  });
  const writtenBinaries = [];
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
    assert.strictEqual(fileID, 'cloud://files/wechat-channels.mp4');
    return 'https://temp.example.com/wechat-channels.mp4';
  };
  plugin.downloadArrayBuffer = async (url) => {
    assert.strictEqual(url, 'https://temp.example.com/wechat-channels.mp4');
    return Buffer.from('video-bytes');
  };
  const transcriptionCalls = [];
  plugin.runConfiguredTranscription = async (audioUrl, options = {}) => {
    transcriptionCalls.push([audioUrl, options.fileID, options.source, options.title]);
    return {
      transcription: '评论区才是最好的选题库，因为用户会把真实问题直接写出来。',
      source: 'local',
    };
  };
  plugin.showSyncProgress = () => {};

  const result = await plugin.writeFileAttachment({
    _id: 'record-video-file',
    type: 'file',
    content: 'wechat-channels.mp4',
    createdAt: '2026-06-30T10:00:00.000Z',
    metadata: {
      fileID: 'cloud://files/wechat-channels.mp4',
      fileName: 'wechat-channels.mp4',
      fileExt: 'mp4',
      fileSize: 1024,
    },
  }, 'raw\\wechatmd', '2026-06-30', '视频号-本地视频', {
    token: 'PRO-123',
  });

  assert.deepStrictEqual(transcriptionCalls, [[
    'https://temp.example.com/wechat-channels.mp4',
    'cloud://files/wechat-channels.mp4',
    'file-attachment',
    '视频号-本地视频',
  ]]);
  assert.deepStrictEqual(writtenBinaries, [[
    'raw/wechatmd/文件附件/2026-06-30/视频号-本地视频-wechat-channels.mp4',
    'video-bytes',
  ]]);
  assert.strictEqual(result.metadata.transcriptionStatus, 'success');
  assert.strictEqual(result.metadata.transcription, '评论区才是最好的选题库，因为用户会把真实问题直接写出来。');
  assert.strictEqual(result.metadata.transcriptionSource, 'file-attachment');
  assert.strictEqual(result.metadata.aiMetadataSource, 'transcription');
  assert.ok(result.metadata.description.includes('评论区才是最好的选题库'));
  assert.ok(result.metadata.keywords.length > 0);

  const markdown = helpers.buildMarkdownForRecord({
    record: {
      ...result,
      _id: 'record-video-file',
      createdAt: '2026-06-30T10:00:00.000Z',
    },
    title: '视频号-本地视频',
    syncedAt: '2026-06-30T10:05:00.000Z',
  });
  assert.ok(markdown.includes('## 口播/音频文案'));
  assert.ok(markdown.includes('评论区才是最好的选题库'));
  assert.match(markdown, /^description: .*评论区才是最好的选题库/m);
  assert.match(markdown, /^keywords: .+/m);
}

async function runSourceMediaAttachmentTests() {
  assert.strictEqual(helpers.mergeSettings({}).saveOriginalMediaEnabled, false);

  const mediaBytes = Buffer.alloc(640, 0);
  mediaBytes.write('ftyp', 4, 'ascii');
  const written = [];
  const folders = [];
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    inboxDir: 'raw\\wechatmd',
    saveOriginalMediaEnabled: true,
  });
  plugin.ensureProFeatureAccess = async () => ({
    hasAccess: true,
    status: 'active',
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
  plugin.app = {
    vault: {
      adapter: {
        writeBinary: async (filePath, buffer) => {
          written.push([filePath, Buffer.from(buffer)]);
        },
      },
    },
  };
  plugin.ensureFolder = async (folder) => folders.push(folder);
  plugin.downloadArrayBuffer = async (url) => {
    assert.strictEqual(url, 'https://media.example.com/demo.mp4?token=private');
    return mediaBytes;
  };

  const sourceRecord = {
    _id: 'media-record-001',
    type: 'webpage',
    content: 'https://www.example.com/demo',
    metadata: {
      url: 'https://www.example.com/demo',
      transcriptOnly: true,
      mediaUrl: 'https://media.example.com/demo.mp4?token=private',
      transcription: '这是一段已经成功取得的口播文案。',
      transcriptionStatus: 'success',
      transcriptionSource: 'local',
    },
  };
  const savedRecord = await plugin.saveSourceMediaAttachment(sourceRecord, 'raw\\wechatmd', '2026-07-14', '演示视频');
  assert.deepStrictEqual(folders, [
    'raw/wechatmd/音视频附件',
    'raw/wechatmd/音视频附件/2026-07-14',
  ]);
  assert.strictEqual(written.length, 1);
  assert.strictEqual(written[0][0], 'raw/wechatmd/音视频附件/2026-07-14/演示视频-media-record.mp4');
  assert.strictEqual(savedRecord.metadata.sourceMediaAttachmentPath, written[0][0]);
  const savedMarkdown = helpers.buildMarkdownForRecord({
    record: savedRecord,
    title: '演示视频',
    syncedAt: '2026-07-14T00:00:00.000Z',
  });
  assert.ok(savedMarkdown.includes('## 原始音视频'));
  assert.ok(savedMarkdown.includes('![[raw/wechatmd/音视频附件/2026-07-14/演示视频-media-record.mp4]]'));
  assert.ok(savedMarkdown.indexOf('## 原始音视频') < savedMarkdown.indexOf('## 口播/音频文案'));

  const videoBytes = Buffer.alloc(640, 0);
  videoBytes.write('ftyp', 4, 'ascii');
  videoBytes.write('vide', 48, 'ascii');
  const videoWrites = [];
  const videoDownloads = [];
  const videoPlugin = new PluginClass();
  videoPlugin.settings = helpers.mergeSettings({ inboxDir: '临时收集', saveOriginalMediaEnabled: true });
  videoPlugin.ensureProFeatureAccess = async () => ({ hasAccess: true, status: 'active', expiresAt: '2026-08-01T00:00:00.000Z' });
  videoPlugin.app = { vault: { adapter: { writeBinary: async (filePath, buffer) => videoWrites.push([filePath, Buffer.from(buffer)]) } } };
  videoPlugin.ensureFolder = async () => {};
  videoPlugin.downloadArrayBuffer = async (candidateUrl) => {
    videoDownloads.push(candidateUrl);
    return candidateUrl.includes('video-candidate') ? videoBytes : mediaBytes;
  };
  const videoRecord = await videoPlugin.saveSourceMediaAttachment({
    ...sourceRecord,
    metadata: {
      ...sourceRecord.metadata,
      platform: '抖音',
      mediaUrls: [
        'https://media.example.com/audio-candidate',
        'https://media.example.com/video-candidate',
      ],
    },
  }, '临时收集', '2026-07-14', '抖音视频');
  assert.deepStrictEqual(videoDownloads, [
    'https://media.example.com/audio-candidate',
    'https://media.example.com/video-candidate',
  ]);
  assert.strictEqual(videoWrites[0][0], '临时收集/音视频附件/2026-07-14/抖音视频-media-record.mp4');
  assert.strictEqual(videoRecord.metadata.sourceMediaAttachmentPath, videoWrites[0][0]);

  const disabledPlugin = new PluginClass();
  disabledPlugin.settings = helpers.mergeSettings({ inboxDir: '临时收集' });
  disabledPlugin.downloadArrayBuffer = async () => {
    throw new Error('disabled media save must not download');
  };
  const disabledRecord = await disabledPlugin.saveSourceMediaAttachment(sourceRecord, '临时收集', '2026-07-14', '演示视频');
  assert.strictEqual(disabledRecord, sourceRecord);

  const noProPlugin = new PluginClass();
  noProPlugin.settings = helpers.mergeSettings({ saveOriginalMediaEnabled: true });
  noProPlugin.ensureProFeatureAccess = async () => {
    throw new Error('保存原始音视频到本地需要有效 Pro。');
  };
  noProPlugin.downloadArrayBuffer = async () => {
    throw new Error('non-Pro media save must not download');
  };
  const noProRecord = await noProPlugin.saveSourceMediaAttachment(sourceRecord, '临时收集', '2026-07-14', '演示视频');
  assert.strictEqual(noProRecord, sourceRecord);

  const failedPlugin = new PluginClass();
  failedPlugin.settings = helpers.mergeSettings({
    inboxDir: '临时收集',
    saveOriginalMediaEnabled: true,
  });
  failedPlugin.ensureProFeatureAccess = async () => ({
    hasAccess: true,
    status: 'active',
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
  failedPlugin.app = {
    vault: {
      adapter: {
        writeBinary: async () => {
          throw new Error('disk full');
        },
      },
    },
  };
  failedPlugin.ensureFolder = async () => {};
  failedPlugin.downloadArrayBuffer = async () => mediaBytes;
  const failedRecord = await failedPlugin.saveSourceMediaAttachment(sourceRecord, '临时收集', '2026-07-14', '演示视频');
  assert.strictEqual(failedRecord.metadata.transcription, sourceRecord.metadata.transcription);
  assert.strictEqual(failedRecord.metadata.sourceMediaAttachmentPath, '');
  assert.strictEqual(failedRecord.metadata.sourceMediaAttachmentError, '原始音视频未能保存到本地。');
}

async function runPdfNoOcrFallbackTests() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({});
  plugin.app = {
    vault: {
      adapter: {
        exists: async () => true,
        writeBinary: async () => {},
      },
      createFolder: async () => {},
    },
  };
  plugin.requestFileDownloadUrl = async () => 'https://temp.example.com/corrupted.pdf';
  const corruptedPdfBuffer = createUtf16BePdfBuffer([
    '更部移两移少理随躁少么梳的主回过识表本不随谱随内容么消全流程随份案领稳玩随这',
    '险课法的是理物何需随更部移两移少理随际随图随本不份个部少么梳的主回过识表云需',
  ].join('').repeat(12));
  plugin.downloadArrayBuffer = async () => corruptedPdfBuffer;
  plugin.showSyncProgress = () => {};
  plugin.runLocalPdfOcr = async () => {
    throw new Error('PDF must not invoke local OCR');
  };

  const result = await plugin.writeFileAttachment({
    _id: 'record-corrupted-pdf',
    type: 'file',
    content: 'corrupted.pdf',
    createdAt: '2026-07-15T10:00:00.000Z',
    metadata: {
      fileID: 'cloud://files/corrupted.pdf',
      fileName: 'corrupted.pdf',
      fileExt: 'pdf',
    },
  }, '临时收集', '2026-07-15', 'pdf-乱码测试', { token: 'PRO-123' });

  assert.strictEqual(result.metadata.conversionStatus, 'attachment_saved');
  assert.strictEqual(result.metadata.filePath, '临时收集/文件附件/2026-07-15/pdf-乱码测试-corrupted.pdf');
  assert.ok(result.metadata.conversionError.includes('PDF'));
  assert.strictEqual(result.metadata.conversionProvider, undefined);
  assert.strictEqual(result.metadata.convertedMarkdown, undefined);
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

  const imagePlugin = new PluginClass();
  imagePlugin.downloadArrayBuffer = async () => Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(1024, 0),
  ]);
  await assert.rejects(
    () => imagePlugin.downloadMediaToTempFile('https://mpvideo.qpic.cn/cover-only/0?dis_k=demo', {
      sourceUrl: 'https://weixin.qq.com/sph/AmHcK1JE0j',
    }),
    /不是有效音视频|不是有效/,
  );

  assert.strictEqual(typeof helpers.decryptWechatChannelsMediaBuffer, 'function');
  assert.strictEqual(typeof helpers.generateWechatChannelsDecryptorBytes, 'function');
  const originalMp4Header = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom'),
    Buffer.alloc(512, 2),
  ]);
  const seed = '987654321';
  const encryptedMp4Header = Buffer.from(originalMp4Header);
  const keyBytes = helpers.generateWechatChannelsDecryptorBytes(seed, encryptedMp4Header.length);
  for (let index = 0; index < encryptedMp4Header.length; index += 1) {
    encryptedMp4Header[index] ^= keyBytes[index];
  }
  assert.deepStrictEqual(
    helpers.decryptWechatChannelsMediaBuffer(encryptedMp4Header, seed),
    originalMp4Header,
  );

  const encryptedDownloadPlugin = new PluginClass();
  encryptedDownloadPlugin.downloadArrayBuffer = async () => encryptedMp4Header;
  const decryptedTempPath = await encryptedDownloadPlugin.downloadMediaToTempFile(
    'https://finder.video.qq.com/251/20302/stodownload?encfilekey=abc123',
    {
      sourceUrl: 'https://weixin.qq.com/sph/AmHcK1JE0j',
      decryptKey: seed,
    },
  );
  try {
    assert.strictEqual(path.extname(decryptedTempPath), '.mp4');
    assert.deepStrictEqual(fs.readFileSync(decryptedTempPath).subarray(0, originalMp4Header.length), originalMp4Header);
  } finally {
    if (fs.existsSync(decryptedTempPath)) fs.unlinkSync(decryptedTempPath);
  }
}

async function runLocalAsrRepairDecisionTests() {
  const commandRootPlugin = new PluginClass();
  commandRootPlugin.settings = helpers.mergeSettings({
    localAsrPlatform: 'win32',
    localAsrInstallMode: 'default',
    localTranscriptionCommand: 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\ADMIN\\.wechat-inbox-local-asr\\transcribe.ps1" -InputPath {input} -OutputPath {output}',
  });
  const originalFsExistsSync = fs.existsSync;
  const originalFsReadFileSync = fs.readFileSync;
  fs.existsSync = (filePath) => {
    const value = String(filePath || '');
    if (value.startsWith('C:\\Users\\ADMIN\\.wechat-inbox-local-asr')) return true;
    if (value.startsWith('C:\\Users\\11266\\.wechat-inbox-local-asr')) return false;
    return originalFsExistsSync(filePath);
  };
  fs.readFileSync = (filePath, ...args) => (
    String(filePath || '') === 'C:\\Users\\ADMIN\\.wechat-inbox-local-asr\\transcribe.ps1'
      ? currentWindowsAsrScriptSource
      : originalFsReadFileSync(filePath, ...args)
  );
  try {
    assert.strictEqual(
      commandRootPlugin.getConfiguredLocalAsrInstallRoot(),
      'C:\\Users\\ADMIN\\.wechat-inbox-local-asr',
    );
    const status = commandRootPlugin.getLocalAsrInstallStatus();
    assert.strictEqual(status.installRoot, 'C:\\Users\\ADMIN\\.wechat-inbox-local-asr');
    assert.strictEqual(status.ready, true);
  } finally {
    fs.existsSync = originalFsExistsSync;
    fs.readFileSync = originalFsReadFileSync;
  }

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

  const compatibleOfflinePlugin = new PluginClass();
  compatibleOfflinePlugin.settings = helpers.mergeSettings({
    localAsrPlatform: 'win32',
    localAsrInstallMode: 'default',
  });
  compatibleOfflinePlugin.getConfiguredLocalAsrPlatform = () => 'win32';
  compatibleOfflinePlugin.getConfiguredLocalAsrInstallRoot = () => 'C:\\Users\\ADMIN\\.wechat-inbox-local-asr';
  compatibleOfflinePlugin.getLocalAsrInstallStatus = () => ({
    ready: true,
    scriptOutdated: false,
    upgradeRecommended: true,
    compatibilityMode: 'legacy-start-process',
  });
  let compatibleOfflineInstallCalls = 0;
  compatibleOfflinePlugin.installLocalAsr = async () => {
    compatibleOfflineInstallCalls += 1;
    throw new Error('HTTP 418');
  };
  const compatibleOfflineResult = await compatibleOfflinePlugin.checkAndRepairLocalAsr();
  assert.strictEqual(compatibleOfflineResult.action, 'none');
  assert.strictEqual(compatibleOfflineInstallCalls, 0);

  const installerMatrixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-asr-installer-matrix-'));
  const bundledInstallerPath = path.join(installerMatrixRoot, 'install-local-asr.ps1');
  const installedRoot = path.join(installerMatrixRoot, 'installed');
  fs.mkdirSync(path.join(installedRoot, 'whisper'), { recursive: true });
  fs.mkdirSync(path.join(installedRoot, 'ffmpeg'), { recursive: true });
  fs.mkdirSync(path.join(installedRoot, 'models'), { recursive: true });
  fs.writeFileSync(path.join(installedRoot, 'transcribe.ps1'), historicalWindowsAsrScriptSource, 'utf8');
  fs.writeFileSync(path.join(installedRoot, 'whisper', 'whisper-cli.exe'), 'existing-whisper', 'utf8');
  fs.writeFileSync(path.join(installedRoot, 'ffmpeg', 'ffmpeg.exe'), 'existing-ffmpeg', 'utf8');
  fs.writeFileSync(path.join(installedRoot, 'models', 'ggml-small.bin'), 'existing-model', 'utf8');
  fs.writeFileSync(bundledInstallerPath, windowsAsrInstallerSource, 'utf8');
  const installedSnapshot = [
    'transcribe.ps1',
    path.join('whisper', 'whisper-cli.exe'),
    path.join('ffmpeg', 'ffmpeg.exe'),
    path.join('models', 'ggml-small.bin'),
  ].map((relativePath) => [relativePath, fs.readFileSync(path.join(installedRoot, relativePath), 'utf8')]);
  const installerMatrixPlugin = new PluginClass();
  installerMatrixPlugin.settings = helpers.mergeSettings({
    localAsrPlatform: 'win32',
    localAsrInstallMode: 'default',
  });
  installerMatrixPlugin.getConfiguredLocalAsrPlatform = () => 'win32';
  installerMatrixPlugin.getConfiguredLocalAsrInstallRoot = () => installedRoot;
  installerMatrixPlugin.getBundledLocalAsrInstallerPath = () => bundledInstallerPath;
  try {
    const downloadedInstallerPath = await installerMatrixPlugin.getAvailableLocalAsrInstallerPath({
      fetchInstallerText: async () => windowsAsrInstallerSource,
    });
    assert.notStrictEqual(downloadedInstallerPath, bundledInstallerPath);
    assert.strictEqual(
      helpers.isLocalAsrInstallerCurrent(fs.readFileSync(downloadedInstallerPath, 'utf8'), false),
      true,
    );
    fs.rmSync(downloadedInstallerPath, { force: true });

    for (const networkFailure of [new Error('HTTP 418'), new Error('request timed out')]) {
      const fallbackInstallerPath = await installerMatrixPlugin.getAvailableLocalAsrInstallerPath({
        fetchInstallerText: async () => {
          throw networkFailure;
        },
      });
      assert.strictEqual(fallbackInstallerPath, bundledInstallerPath);
    }

    installerMatrixPlugin.getBundledLocalAsrInstallerPath = () => path.join(installerMatrixRoot, 'missing-installer.ps1');
    await assert.rejects(
      installerMatrixPlugin.getAvailableLocalAsrInstallerPath({
        fetchInstallerText: async () => {
          throw new Error('HTTP 418');
        },
      }),
      /HTTP 418/,
    );
    assert.strictEqual(
      helpers.getLocalAsrInstallStatus(
        installedRoot,
        fs.existsSync,
        portableWindowsLayoutPlatform,
      ).ready,
      true,
    );
    for (const [relativePath, expectedContent] of installedSnapshot) {
      assert.strictEqual(fs.readFileSync(path.join(installedRoot, relativePath), 'utf8'), expectedContent);
    }
  } finally {
    fs.rmSync(installerMatrixRoot, { recursive: true, force: true });
  }

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

async function runDiagnosticFailureLogFilteringTests() {
  const asrRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-asr-diagnostic-'));
  const ocrRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-ocr-diagnostic-'));
  try {
    fs.writeFileSync(
      path.join(asrRoot, 'transcribe-last.log'),
      'status=success\nASR SUCCESS TRANSCRIPT SHOULD NOT BE COPIED\n--- stderr ---\nmetal backend ready\n--- error ---\n',
      'utf8',
    );
    fs.writeFileSync(path.join(asrRoot, 'install.log'), 'status=success\nASR INSTALL SUCCESS SHOULD NOT BE COPIED', 'utf8');
    fs.writeFileSync(path.join(ocrRoot, 'install.log'), 'status=failed\ncurl: (35) Recv failure: Connection reset by peer', 'utf8');

    const plugin = new PluginClass();
    plugin.manifest = { version: '1.3.3' };
    plugin.settings = helpers.mergeSettings({
      apiBase: 'https://example.com/sync',
      token: 'ABC-123',
      localAsrPlatform: 'darwin',
      localTranscriptionEntitlementStatus: { hasAccess: true, status: 'active' },
      proEntitlementLastError: '权限接口连接失败',
      proEntitlementLastErrorAt: '2026-07-15T06:30:00.000Z',
      bindings: [{ token: 'ABC-123', label: '微信 1', enabled: true, status: 'bound' }],
    });
    plugin.getConfiguredLocalAsrPlatform = () => 'darwin';
    plugin.getConfiguredLocalAsrInstallRoot = () => asrRoot;
    plugin.getConfiguredLocalOcrInstallRoot = () => ocrRoot;
    plugin.getLocalAsrInstallStatus = () => ({
      ready: true,
      installRoot: asrRoot,
      transcribeScript: `${asrRoot}/transcribe.sh`,
      scriptVersion: 'ok',
      scriptOutdated: false,
      hasTranscribeScript: true,
      hasWhisper: true,
      hasFfmpeg: true,
      hasModel: true,
      whisperPath: `${asrRoot}/bin/whisper-cli`,
      ffmpegPath: `${asrRoot}/bin/ffmpeg`,
      modelPath: `${asrRoot}/models/ggml-small.bin`,
      missingReasons: [],
    });
    plugin.getLocalOcrInstallStatus = () => ({
      ready: false,
      installRoot: ocrRoot,
      pythonPath: `${ocrRoot}/venv/bin/python`,
      scriptPath: `${ocrRoot}/ocr_image.py`,
      hasPython: false,
      hasScript: false,
      missingReasons: ['Python OCR 运行环境未找到'],
    });

    const diagnostic = plugin.getSyncDiagnosticText();
    assert.ok(diagnostic.includes('插件版本：1.3.3'));
    assert.ok(diagnostic.includes('运行 Bundle：1.3.70 / clipboard-link-path-v1'));
    assert.ok(diagnostic.includes('版本身份一致：否（请完全退出并重新打开 Obsidian）'));
    assert.ok(diagnostic.includes('图片文字识别 OCR'));
    assert.ok(diagnostic.includes('最近权限查询失败'));
    assert.ok(diagnostic.includes('权限接口连接失败'));
    assert.ok(diagnostic.includes('2026-07-15T06:30:00.000Z'));
    assert.ok(diagnostic.includes('curl: (35) Recv failure: Connection reset by peer'));
    assert.strictEqual(diagnostic.includes('ASR SUCCESS TRANSCRIPT SHOULD NOT BE COPIED'), false);
    assert.strictEqual(diagnostic.includes('ASR INSTALL SUCCESS SHOULD NOT BE COPIED'), false);
    assert.strictEqual(diagnostic.includes('ABC-123'), false);

    helpers.appendLocalAsrRunLog({
      installRoot: asrRoot,
      status: 'failed',
      command: '',
      error: '媒体下载超时',
    });
    const preAsrFailureDiagnostic = plugin.getSyncDiagnosticText();
    assert.ok(preAsrFailureDiagnostic.includes('媒体下载超时'));
    assert.strictEqual(preAsrFailureDiagnostic.includes('ASR SUCCESS TRANSCRIPT SHOULD NOT BE COPIED'), false);

    fs.rmSync(path.join(ocrRoot, 'install.log'), { force: true });
    plugin.getLocalOcrInstallStatus = () => ({
      ready: false,
      installRoot: ocrRoot,
      pythonPath: `${ocrRoot}/venv/bin/python`,
      scriptPath: `${ocrRoot}/ocr_image.py`,
      hasPython: true,
      hasScript: false,
      missingReasons: ['OCR 脚本未找到，请安装/更新本地转写组件'],
    });
    const missingScriptDiagnostic = plugin.getSyncDiagnosticText();
    assert.ok(missingScriptDiagnostic.includes('Python 环境已安装，仅 OCR 脚本缺失'));
    assert.ok(missingScriptDiagnostic.includes('OCR 安装日志未找到或没有记录失败信息'));
    assert.strictEqual(missingScriptDiagnostic.includes('ASR SUCCESS TRANSCRIPT SHOULD NOT BE COPIED'), false);
  } finally {
    fs.rmSync(asrRoot, { recursive: true, force: true });
    fs.rmSync(ocrRoot, { recursive: true, force: true });
  }
}

async function runBoundedBrowserTaskTests() {
  const neverSettlingTask = new Promise(() => {});
  const result = await helpers.waitForBrowserTasksWithin(
    [neverSettlingTask],
    2000,
    async () => 'timeout',
  );
  assert.strictEqual(result, 'timeout');
  assert.strictEqual(await helpers.waitForBrowserTasksWithin([], 2000), 'empty');
  assert.strictEqual(await helpers.waitForBrowserTasksWithin([Promise.resolve('ok')], 2000), 'settled');
}

async function runClipboardTextWebpagePromotionTests() {
  const originalHttpRequest = http.request;
  const originalHttpsRequest = require('https').request;
  http.request = (parsed, options, callback) => {
    const requestHandlers = {};
    const request = {
      setTimeout: () => request,
      on(event, handler) {
        requestHandlers[event] = handler;
        return request;
      },
      write: () => {},
      destroy(error) {
        if (requestHandlers.error) requestHandlers.error(error);
      },
      end() {
        const responseHandlers = {};
        const response = {
          statusCode: 200,
          headers: {},
          on(event, handler) {
            responseHandlers[event] = handler;
            return response;
          },
          destroy: () => {},
        };
        callback(response);
        responseHandlers.data(Buffer.alloc(9, 1));
        if (responseHandlers.end) responseHandlers.end();
      },
    };
    return request;
  };
  try {
    await assert.rejects(
      () => helpers.requestJsonViaNode({
        url: 'http://example.com/oversized-json',
        maxBytes: 8,
      }),
      /configured size limit/,
      'Node JSON 请求必须在拼接响应体前拒绝超限内容',
    );
  } finally {
    http.request = originalHttpRequest;
  }

  let redirectRequestCount = 0;
  http.request = (parsed, options, callback) => {
    redirectRequestCount += 1;
    assert.strictEqual(options.lookup, undefined, '自动网页请求必须使用系统 DNS/代理路由');
    const request = {
      setTimeout: () => request,
      on: () => request,
      destroy: () => {},
      end: () => {
        if (redirectRequestCount > 1) {
          const handlers = {};
          callback({
            statusCode: 200,
            headers: {},
            resume: () => {},
            on(event, handler) {
              handlers[event] = handler;
            },
          });
          handlers.data(Buffer.from('<html><body>system route</body></html>'));
          handlers.end();
          return;
        }
        callback({
          statusCode: 302,
          headers: { location: 'http://127.0.0.1/private' },
          resume: () => {},
          on: () => {},
        });
      },
    };
    return request;
  };
  try {
    const response = await helpers.requestPublicWebpageText('http://example.com/start');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.text, '<html><body>system route</body></html>');
    assert.strictEqual(redirectRequestCount, 2);
  } finally {
    http.request = originalHttpRequest;
  }

  const redirectedHeaders = [];
  require('https').request = (parsed, options, callback) => {
    redirectedHeaders.push({ url: parsed.toString(), headers: { ...(options.headers || {}) } });
    const request = {
      setTimeout: () => request,
      on: () => request,
      destroy: () => {},
      end: () => {
        if (redirectedHeaders.length === 1) {
          callback({
            statusCode: 302,
            headers: { location: 'https://evil.example/collect' },
            resume: () => {},
            on: () => {},
          });
          return;
        }
        const handlers = {};
        callback({
          statusCode: 200,
          headers: {},
          resume: () => {},
          on(event, handler) {
            handlers[event] = handler;
          },
        });
        handlers.data(Buffer.from('<html><body>ok</body></html>'));
        handlers.end();
      },
    };
    return request;
  };
  try {
    await helpers.requestPublicWebpageText('https://www.xiaohongshu.com/explore/demo', {
      headers: {
        Cookie: 'session=TOP_SECRET',
        Authorization: 'Bearer TOP_SECRET',
        'Proxy-Authorization': 'Basic TOP_SECRET',
        'X-API-Token': 'TOP_SECRET',
        'X-Access-Token': 'TOP_SECRET',
        'X-Security-Token': 'TOP_SECRET',
        'X-Amz-Security-Token': 'TOP_SECRET',
        'X-Session-Token': 'TOP_SECRET',
        Token: 'TOP_SECRET',
        'X-Custom-Credential': 'TOP_SECRET',
        'X-Custom-Signature': 'TOP_SECRET',
        Referer: 'https://www.xiaohongshu.com/',
        'User-Agent': 'test-agent',
        Accept: 'text/html',
      },
    });
    assert.strictEqual(redirectedHeaders.length, 2);
    assert.strictEqual(redirectedHeaders[0].headers.Cookie, 'session=TOP_SECRET');
    assert.strictEqual(redirectedHeaders[1].headers.Cookie, undefined);
    assert.strictEqual(redirectedHeaders[1].headers.Authorization, undefined);
    assert.strictEqual(redirectedHeaders[1].headers['Proxy-Authorization'], undefined);
    assert.strictEqual(redirectedHeaders[1].headers['X-API-Token'], undefined);
    assert.strictEqual(redirectedHeaders[1].headers['X-Access-Token'], undefined);
    assert.strictEqual(redirectedHeaders[1].headers['X-Security-Token'], undefined);
    assert.strictEqual(redirectedHeaders[1].headers['X-Amz-Security-Token'], undefined);
    assert.strictEqual(redirectedHeaders[1].headers['X-Session-Token'], undefined);
    assert.strictEqual(redirectedHeaders[1].headers.Token, undefined);
    assert.strictEqual(redirectedHeaders[1].headers['X-Custom-Credential'], undefined);
    assert.strictEqual(redirectedHeaders[1].headers['X-Custom-Signature'], undefined);
    assert.strictEqual(redirectedHeaders[1].headers.Referer, undefined);
    assert.strictEqual(redirectedHeaders[1].headers['User-Agent'], 'test-agent');
    assert.strictEqual(redirectedHeaders[1].headers.Accept, 'text/html');
  } finally {
    require('https').request = originalHttpsRequest;
  }

  const writes = [];
  const hydrated = [];
  const originalText = '🔥有钱之后，应该多提升生活质量 http://xhslink.cn/o/3twEehTqivC 存下口令，跳转【小红书】阅读~';
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    inboxDir: 'raw\\wechatmd',
    noteSaveMode: 'root',
    aiProvider: 'off',
  });
  plugin.app = {
    vault: {
      adapter: {
        async exists() {
          return true;
        },
        async write(filePath, markdown) {
          writes.push({ filePath, markdown });
        },
      },
      async createFolder() {
        throw new Error('existing canonical folder must be reused');
      },
    },
  };
  plugin.showSyncProgress = () => {};
  plugin.nextRecordTitle = async () => '自动网页提取';
  plugin.hydrateWebpageMarkdown = async (record) => {
    hydrated.push(record);
    return {
      ...record,
      title: '自动网页提取',
      content: '# 自动网页提取\n\n网页正文',
      metadata: {
        ...(record.metadata || {}),
        title: '自动网页提取',
        markdown: '# 自动网页提取\n\n网页正文',
        conversionStatus: 'success',
      },
    };
  };
  plugin.saveSourceMediaAttachment = async (record) => record;
  plugin.enrichRecordMetadataWithAi = async (record) => record;

  const result = await plugin.writeRecord({
    _id: 'clipboard-text-xhs-1',
    type: 'text',
    content: originalText,
    createdAt: '2026-07-25T03:49:04.246Z',
    metadata: {},
  }, '2026-07-25T04:00:00.000Z');

  assert.strictEqual(hydrated.length, 1);
  assert.strictEqual(hydrated[0].type, 'webpage');
  assert.strictEqual(hydrated[0].metadata.url, 'http://xhslink.cn/o/3twEehTqivC');
  assert.strictEqual(hydrated[0].metadata.shareText, originalText);
  assert.strictEqual(result.filePath, 'raw/wechatmd/自动网页提取.md');
  assert.strictEqual(writes[0].filePath, 'raw/wechatmd/自动网页提取.md');
  assert.ok(writes[0].markdown.includes('## 原始剪切板内容'));
  assert.ok(writes[0].markdown.includes(originalText));

  const failedWrites = [];
  const failedPlugin = new PluginClass();
  failedPlugin.settings = helpers.mergeSettings({
    inboxDir: 'raw/wechatmd',
    noteSaveMode: 'root',
    aiProvider: 'off',
  });
  failedPlugin.app = {
    vault: {
      adapter: {
        async exists() {
          return true;
        },
        async write(filePath, markdown) {
          failedWrites.push({ filePath, markdown });
        },
      },
      async createFolder() {},
    },
  };
  failedPlugin.showSyncProgress = () => {};
  failedPlugin.nextRecordTitle = async () => '失败网页';
  failedPlugin.hydrateWebpageMarkdown = async (record) => ({
    ...record,
    metadata: {
      ...(record.metadata || {}),
      conversionStatus: 'failed',
      conversionError: '网页抓取失败',
    },
  });
  failedPlugin.saveSourceMediaAttachment = async (record) => record;
  failedPlugin.enrichRecordMetadataWithAi = async (record) => record;
  await assert.rejects(
    () => failedPlugin.writeRecord({
      _id: 'clipboard-generic-failed',
      type: 'text',
      content: '读取网页 https://example.com/unavailable',
      createdAt: '2026-07-25T03:49:04.246Z',
      metadata: {},
    }, '2026-07-25T04:00:00.000Z'),
    /剪切板链接网页提取失败/,
  );
  assert.deepStrictEqual(failedWrites, []);
  const failedSyncCalls = [];
  failedPlugin.findExistingRecordNotePath = async () => '';
  failedPlugin.requestJson = async (requestPath, method) => {
    failedSyncCalls.push([requestPath, method]);
    if (requestPath === '/records?status=pending') {
      return {
        success: true,
        data: [{
          _id: 'clipboard-generic-failed',
          type: 'text',
          content: '读取网页 https://example.com/unavailable',
          createdAt: '2026-07-25T03:49:04.246Z',
          metadata: {},
        }],
      };
    }
    return { success: true, data: {} };
  };
  const failedSyncResult = await failedPlugin.syncBinding({ token: 'ABC-123', label: '测试微信' }, false);
  assert.strictEqual(failedSyncResult.written.length, 0);
  assert.strictEqual(failedSyncResult.failed.length, 1);
  assert.match(failedSyncResult.failed[0].message, /剪切板链接网页提取失败/);
  assert.deepStrictEqual(failedSyncCalls, [['/records?status=pending', 'GET']]);

  for (const content of [
    '纯文字，不应该调用网页提取',
    '两个普通链接 https://example.com/a https://example.net/b',
  ]) {
    let hydrationCalls = 0;
    const safePlugin = new PluginClass();
    safePlugin.settings = helpers.mergeSettings({
      inboxDir: 'raw/wechatmd',
      noteSaveMode: 'root',
      aiProvider: 'off',
    });
    safePlugin.app = plugin.app;
    safePlugin.showSyncProgress = () => {};
    safePlugin.nextRecordTitle = async () => '保持文本';
    safePlugin.hydrateWebpageMarkdown = async () => {
      hydrationCalls += 1;
      throw new Error('unsafe or ambiguous text must not hydrate');
    };
    safePlugin.enrichRecordMetadataWithAi = async (record) => record;
    await safePlugin.writeRecord({
      _id: `text-${hydrationCalls}-${content.length}`,
      type: 'text',
      content,
      createdAt: '2026-07-25T03:49:04.246Z',
      metadata: {},
    }, '2026-07-25T04:00:00.000Z');
    assert.strictEqual(hydrationCalls, 0);
  }

  let localRouteHydrationCalls = 0;
  const localRoutePlugin = new PluginClass();
  localRoutePlugin.settings = helpers.mergeSettings({
    inboxDir: 'raw/wechatmd',
    noteSaveMode: 'root',
    aiProvider: 'off',
  });
  localRoutePlugin.app = plugin.app;
  localRoutePlugin.showSyncProgress = () => {};
  localRoutePlugin.nextRecordTitle = async () => '系统路由文本';
  localRoutePlugin.hydrateWebpageMarkdown = async (record) => {
    localRouteHydrationCalls += 1;
    return {
      ...record,
      metadata: {
        ...(record.metadata || {}),
        conversionStatus: 'success',
        markdown: 'system route content',
      },
    };
  };
  localRoutePlugin.enrichRecordMetadataWithAi = async (record) => record;
  await localRoutePlugin.writeRecord({
    _id: 'clipboard-system-route',
    type: 'text',
    content: '系统路由地址 http://127.0.0.1/private',
    createdAt: '2026-07-25T03:49:04.246Z',
    metadata: {},
  }, '2026-07-25T04:00:00.000Z');
  assert.strictEqual(localRouteHydrationCalls, 1);
}

async function runCanonicalVaultFolderTests() {
  const existing = new Set(['raw']);
  const created = [];
  const plugin = new PluginClass();
  plugin.app = {
    vault: {
      adapter: {
        async exists(folderPath) {
          assert.strictEqual(folderPath.includes('\\'), false);
          return existing.has(folderPath);
        },
      },
      async createFolder(folderPath) {
        assert.strictEqual(folderPath.includes('\\'), false);
        created.push(folderPath);
        existing.add(folderPath);
      },
    },
  };

  await plugin.ensureFolder('raw\\wechatmd\\2026-07-25');
  assert.deepStrictEqual(created, ['raw/wechatmd', 'raw/wechatmd/2026-07-25']);
  await plugin.ensureFolder('raw\\wechatmd\\2026-07-25');
  assert.deepStrictEqual(created, ['raw/wechatmd', 'raw/wechatmd/2026-07-25']);

  const concurrentExisting = new Set(['raw']);
  const concurrentPlugin = new PluginClass();
  concurrentPlugin.app = {
    vault: {
      adapter: {
        async exists(folderPath) {
          return concurrentExisting.has(folderPath);
        },
      },
      async createFolder(folderPath) {
        await new Promise((resolve) => setImmediate(resolve));
        if (concurrentExisting.has(folderPath)) {
          throw new Error(`Folder already exists: ${folderPath}`);
        }
        concurrentExisting.add(folderPath);
      },
    },
  };
  await Promise.all([
    concurrentPlugin.ensureFolder('raw\\wechatmd'),
    concurrentPlugin.ensureFolder('raw\\wechatmd'),
  ]);

  const canonicalWrites = [];
  const pathPlugin = new PluginClass();
  pathPlugin.settings = {
    ...helpers.mergeSettings({ noteSaveMode: 'date', aiProvider: 'off' }),
    inboxDir: 'raw\\wechatmd',
  };
  pathPlugin.app = {
    vault: {
      adapter: {
        async exists() {
          return true;
        },
        async write(filePath, markdown) {
          assert.strictEqual(filePath.includes('\\'), false);
          canonicalWrites.push({ filePath, markdown });
        },
      },
      async createFolder() {},
    },
  };
  pathPlugin.showSyncProgress = () => {};
  pathPlugin.nextRecordTitle = async () => '日期笔记';
  pathPlugin.enrichRecordMetadataWithAi = async (record) => record;
  const datedResult = await pathPlugin.writeRecord({
    _id: 'dated-text-1',
    type: 'text',
    content: '普通日期笔记',
    createdAt: '2026-07-25T03:49:04.246Z',
    metadata: {},
  }, '2026-07-25T04:00:00.000Z');
  assert.strictEqual(datedResult.filePath, 'raw/wechatmd/2026-07-25/日期笔记.md');

  pathPlugin.settings.noteSaveMode = 'root';
  pathPlugin.nextRecordTitle = async () => '视频号捕获';
  const channelResult = await pathPlugin.writeCapturedWechatChannelsRecord({
    _id: 'wechat-channel-capture-1',
    type: 'webpage',
    content: 'https://weixin.qq.com/sph/demo',
    createdAt: '2026-07-25T03:49:04.246Z',
    metadata: {
      url: 'https://weixin.qq.com/sph/demo',
      markdown: '视频号捕获正文',
      conversionStatus: 'success',
    },
  }, '2026-07-25T04:00:00.000Z');
  assert.strictEqual(channelResult.filePath, 'raw/wechatmd/视频号捕获.md');
}

async function runAiMetadataFailureDoesNotBlockCompletedTranscriptSyncTest() {
  const scenarios = [
    {
      name: 'rate-limit',
      contentKind: 'transcript',
      expectedCode: 'rate-limited',
      generate: async () => {
        const error = new Error('Request failed with status code 429 https://private.example.test?token=TOP_SECRET');
        error.code = 'ERR_BAD_REQUEST';
        error.response = { status: 429 };
        throw error;
      },
    },
    {
      name: 'upstream-5xx',
      contentKind: 'body',
      expectedCode: 'upstream-service-error',
      generate: async () => {
        const error = new Error('HTTP 502 api_key=TOP_SECRET');
        error.code = 'ERR_BAD_RESPONSE';
        error.response = { status: 502 };
        throw error;
      },
    },
    {
      name: 'timeout',
      contentKind: 'transcript',
      expectedCode: 'request-timeout',
      generate: async () => {
        throw new Error('ETIMEDOUT cookie=TOP_SECRET');
      },
    },
    {
      name: 'empty-result',
      contentKind: 'body',
      expectedCode: 'empty-response',
      generate: async () => ({ description: '', keywords: [] }),
    },
  ];

  for (const scenario of scenarios) {
    const writes = [];
    const requestCalls = [];
    let pendingReadCount = 0;
    let aiCallCount = 0;
    let transcriptionCallCount = 0;
    const recordId = `ai-metadata-${scenario.name}`;
    const coreText = scenario.contentKind === 'transcript'
      ? '这段正文已经在本地完成转写，AI 简介失败不应让它重新转写。'
      : '这段网页正文已经完成提取，AI 简介失败不应阻止它写入知识库。';
    const record = {
      _id: recordId,
      type: 'webpage',
      content: 'https://media.example.test/video',
      createdAt: '2026-07-27T09:00:00.000Z',
      metadata: {
        title: '已经成功转写的内容',
        url: 'https://media.example.test/video',
        ...(scenario.contentKind === 'transcript'
          ? {
            transcriptOnly: true,
            webpageMediaType: 'audio_video',
            transcription: coreText,
            transcriptionStatus: 'success',
            transcriptionSource: 'local',
          }
          : {
            markdown: coreText,
          }),
        conversionStatus: 'success',
      },
    };
    const directPlugin = new PluginClass();
    directPlugin.settings = helpers.mergeSettings({});
    directPlugin.hasProFeatureAccess = async () => true;
    directPlugin.generateMetadataWithDeepSeek = scenario.generate;
    const failedEnrichment = await directPlugin.enrichRecordMetadataWithAi(record);
    assert.strictEqual(failedEnrichment.metadata.description, undefined, scenario.name);
    assert.strictEqual(failedEnrichment.metadata.keywords, undefined, scenario.name);
    assert.strictEqual(failedEnrichment.metadata.aiMetadataSource, undefined, scenario.name);
    assert.strictEqual(failedEnrichment.metadata.aiMetadataError, scenario.expectedCode, scenario.name);

    const plugin = new PluginClass();
    plugin.settings = helpers.mergeSettings({
      inboxDir: '临时收集',
      noteSaveMode: 'root',
    });
    plugin.app = {
      vault: {
        adapter: {
          async exists() {
            return true;
          },
          async write(filePath, markdown) {
            writes.push({ filePath, markdown });
          },
        },
        async createFolder() {},
      },
    };
    plugin.showSyncProgress = () => {};
    plugin.nextRecordTitle = async () => `AI失败不阻断-${scenario.name}`;
    plugin.findExistingRecordNotePath = async () => '';
    plugin.hydrateWebpageMarkdown = async (currentRecord) => currentRecord;
    plugin.saveSourceMediaAttachment = async (currentRecord) => currentRecord;
    plugin.hasProFeatureAccess = async () => true;
    plugin.runConfiguredTranscription = async () => {
      transcriptionCallCount += 1;
      throw new Error('completed transcript must not run ASR again');
    };
    plugin.generateMetadataWithDeepSeek = async (...args) => {
      aiCallCount += 1;
      return scenario.generate(...args);
    };
    plugin.requestJson = async (requestPath, method) => {
      requestCalls.push([requestPath, method]);
      if (requestPath === '/records?status=pending') {
        pendingReadCount += 1;
        return {
          success: true,
          data: pendingReadCount === 1 ? [record] : [],
        };
      }
      if (requestPath === `/records/${encodeURIComponent(recordId)}/synced`) {
        return { success: true, data: {} };
      }
      throw new Error(`unexpected request: ${method} ${requestPath}`);
    };

    const firstResult = await plugin.syncBinding({ token: 'TEST-BINDING', label: '测试绑定' }, false);
    assert.strictEqual(firstResult.written.length, 1, scenario.name);
    assert.strictEqual(firstResult.failed.length, 0, scenario.name);
    assert.strictEqual(firstResult.conversionWarnings.length, 1, scenario.name);
    assert.match(
      firstResult.conversionWarnings[0],
      /正文已同步，但 AI 简介\/关键词未生成/,
      scenario.name,
    );
    assert.strictEqual(writes.length, 1, scenario.name);
    assert.strictEqual(aiCallCount, 1, scenario.name);
    assert.strictEqual(transcriptionCallCount, 0, scenario.name);
    assert.deepStrictEqual(
      requestCalls.filter(([requestPath]) => requestPath.includes('/synced')),
      [[`/records/${encodeURIComponent(recordId)}/synced`, 'POST']],
      scenario.name,
    );

    const markdown = writes[0].markdown;
    assert.ok(markdown.includes(coreText), scenario.name);
    assert.strictEqual(/^description:/m.test(markdown), false, scenario.name);
    assert.strictEqual(/^keywords:/m.test(markdown), false, scenario.name);
    assert.strictEqual(markdown.includes('aiMetadataSource'), false, scenario.name);
    const diagnosticLines = markdown
      .split(/\r?\n/)
      .filter((line) => line.includes('wechat-inbox-ai-metadata-error'));
    assert.deepStrictEqual(
      diagnosticLines,
      [`<!-- wechat-inbox-ai-metadata-error: ${scenario.expectedCode} -->`],
      scenario.name,
    );
    assert.strictEqual(/https?:|TOP_SECRET|token|api_key|cookie/i.test(diagnosticLines[0]), false, scenario.name);

    const secondResult = await plugin.syncBinding({ token: 'TEST-BINDING', label: '测试绑定' }, false);
    assert.strictEqual(secondResult.written.length, 0, scenario.name);
    assert.strictEqual(secondResult.failed.length, 0, scenario.name);
    assert.strictEqual(writes.length, 1, scenario.name);
    assert.strictEqual(aiCallCount, 1, scenario.name);
    assert.strictEqual(transcriptionCallCount, 0, scenario.name);
  }

  const noProRecord = {
    _id: 'ai-metadata-no-pro',
    type: 'webpage',
    content: 'https://media.example.test/free-video',
    createdAt: '2026-07-27T09:00:00.000Z',
    metadata: {
      title: '免费用户已保存的正文',
      url: 'https://media.example.test/free-video',
      markdown: '免费用户的正文仍应正常保存。',
      conversionStatus: 'success',
    },
  };
  const noProPlugin = new PluginClass();
  noProPlugin.settings = helpers.mergeSettings({});
  noProPlugin.hasProFeatureAccess = async () => false;
  noProPlugin.generateMetadataWithDeepSeek = async () => {
    throw new Error('a free user must not call the AI service');
  };
  const noProResult = await noProPlugin.enrichRecordMetadataWithAi(noProRecord);
  assert.strictEqual(noProResult, noProRecord);
  assert.strictEqual(noProResult.metadata.aiMetadataError, undefined);
  assert.strictEqual(helpers.getRecordConversionWarning(noProResult), '');
  assert.strictEqual(
    helpers.buildMarkdownForRecord({
      record: noProResult,
      title: '免费用户已保存的正文',
      syncedAt: '2026-07-27T09:01:00.000Z',
    }).includes('wechat-inbox-ai-metadata-error'),
    false,
  );
}

async function runAiMetadata429AfterLocalTranscriptionDoesNotRepeatWorkTest() {
  const noteWrites = [];
  const attachmentWrites = [];
  const requestCalls = [];
  let pendingReadCount = 0;
  let transcriptionCallCount = 0;
  let aiCallCount = 0;
  const recordId = 'ai-429-after-local-transcription';
  const transcript = '这段音频刚刚在本轮同步中完成本地转写，AI 限流不能让它下次再转一次。';
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    inboxDir: '临时收集',
    noteSaveMode: 'root',
    aiProvider: 'local',
  });
  plugin.app = {
    vault: {
      adapter: {
        async exists() {
          return true;
        },
        async writeBinary(filePath, content) {
          attachmentWrites.push({ filePath, content: Buffer.from(content).toString('utf8') });
        },
        async write(filePath, markdown) {
          noteWrites.push({ filePath, markdown });
        },
      },
      async createFolder() {},
    },
  };
  plugin.showSyncProgress = () => {};
  plugin.nextRecordTitle = async () => '本轮完成本地转写';
  plugin.findExistingRecordNotePath = async () => '';
  plugin.requestFileDownloadUrl = async () => 'https://download.example.test/audio.mp3';
  plugin.downloadArrayBuffer = async () => Buffer.from('controlled-audio-bytes');
  plugin.runConfiguredTranscription = async () => {
    transcriptionCallCount += 1;
    return {
      transcription: transcript,
      source: 'local',
    };
  };
  plugin.hasProFeatureAccess = async () => true;
  plugin.generateMetadataWithDeepSeek = async () => {
    aiCallCount += 1;
    const error = new Error(
      'Request failed with status code 429 https://private.example.test?token=TOP_SECRET api_key=TOP_SECRET cookie=TOP_SECRET',
    );
    error.code = 'ERR_BAD_REQUEST';
    error.response = { status: 429 };
    throw error;
  };
  plugin.requestJson = async (requestPath, method) => {
    requestCalls.push([requestPath, method]);
    if (requestPath === '/records?status=pending') {
      pendingReadCount += 1;
      return {
        success: true,
        data: pendingReadCount === 1
          ? [{
            _id: recordId,
            type: 'file',
            content: 'meeting.mp3',
            createdAt: '2026-07-27T09:30:00.000Z',
            metadata: {
              fileID: 'cloud://files/meeting.mp3',
              fileName: 'meeting.mp3',
              fileExt: 'mp3',
              transcriptionMode: 'local',
            },
          }]
          : [],
      };
    }
    if (requestPath === `/records/${encodeURIComponent(recordId)}/synced`) {
      return { success: true, data: {} };
    }
    throw new Error(`unexpected request: ${method} ${requestPath}`);
  };

  const firstResult = await plugin.syncBinding({ token: 'TEST-BINDING', label: '测试绑定' }, false);
  assert.strictEqual(firstResult.written.length, 1);
  assert.strictEqual(firstResult.failed.length, 0);
  assert.strictEqual(transcriptionCallCount, 1);
  assert.strictEqual(aiCallCount, 1);
  assert.strictEqual(noteWrites.length, 1);
  assert.strictEqual(attachmentWrites.length, 1);
  assert.strictEqual(
    requestCalls.filter(([requestPath]) => requestPath.includes('/synced')).length,
    1,
  );
  assert.ok(noteWrites[0].markdown.includes(transcript));
  assert.strictEqual(firstResult.conversionWarnings.length, 1);
  assert.match(firstResult.conversionWarnings[0], /正文已同步，但 AI 简介\/关键词未生成/);
  assert.strictEqual(
    /https?:|TOP_SECRET|token|api_key|cookie/i.test(firstResult.conversionWarnings[0]),
    false,
  );
  const finalNotice = helpers.buildSyncResultNotice(
    firstResult.written,
    firstResult.skipped,
    firstResult.conversionWarnings,
    firstResult.failed,
  );
  assert.match(finalNotice, /正文已同步，但 AI 简介\/关键词未生成/);
  assert.strictEqual(/https?:|TOP_SECRET|token|api_key|cookie/i.test(finalNotice), false);

  const secondResult = await plugin.syncBinding({ token: 'TEST-BINDING', label: '测试绑定' }, false);
  assert.strictEqual(secondResult.written.length, 0);
  assert.strictEqual(secondResult.failed.length, 0);
  assert.strictEqual(transcriptionCallCount, 1);
  assert.strictEqual(aiCallCount, 1);
  assert.strictEqual(noteWrites.length, 1);
  assert.strictEqual(attachmentWrites.length, 1);
  assert.strictEqual(
    requestCalls.filter(([requestPath]) => requestPath.includes('/synced')).length,
    1,
  );
}

async function main() {
  await runClipboardTextWebpagePromotionTests();
  await runCanonicalVaultFolderTests();
  await runAiMetadataFailureDoesNotBlockCompletedTranscriptSyncTest();
  await runAiMetadata429AfterLocalTranscriptionDoesNotRepeatWorkTest();
  await runBoundedBrowserTaskTests();
  await runAsyncHydrationTests();
  await runLocalTranscriptionQualityFallbackTests();
  await runOpenExternalUrlTests();
  await runCloudRequestFallbackTests();
  await runMissingClientIdRequestTest();
  await runRequestJsonUsesActiveBindingWhenLegacyTokenMissingTest();
  await runRequestJsonRoutesFeishuExtractToOAuthApiBaseTest();
  await runRequestJsonRecoversFromInvalidCloudBaseEnvTest();
  await runRequestJsonRecoversFromEmptyMigrationApiBaseTest();
  await runFeishuCustomAppConfigRequestTests();
  await runBindingInvalidClassificationTests();
  await runFeishuOAuthSkipsStalePrimaryBindingTest();
  await runInvalidBindCodeRemainsEditableTest();
  await runSuccessfulRebindPromotesNewPrimaryBindingTest();
  await runXiaohongshuRemoteImageLocalizationHeadersTest();
  await runTranscriptionPreferenceSyncTest();
  await runStopCurrentTranscriptionDeletesCurrentRecordTest();
  await runStoppedTranscriptionDeleteUsesLongControlPlaneTest();
  await runStopCurrentTranscriptionWithoutCurrentRecordDoesNotDeleteTest();
  await runStopCurrentTranscriptionWithoutActiveProcessDoesNotDeleteTest();
  await runStoppedDeletedRecordDoesNotRemainFailedInCurrentSyncTest();
  await runCloudProcessingRecordSkipSyncTest();
  await runXiaohongshuUnavailableRecordRemainsPendingTest();
  await runXiaohongshuFailureClosedIntegrationTest();
  await runExistingLocalRecordDedupSyncTest();
  await runExistingLocalRecordUrlDedupSyncTest();
  await runMarkSyncedRecordNotFoundIsIdempotentTest();
  await runUnbindAlreadyRemoteUnboundClearsLocalBindingTest();
  await runUnbindObsidianRaw403ClearsLocalBindingTest();
  await runUnbindTransportFailurePreservesLocalBindingTest();
  await runUnbindServer5xxPreservesLocalBindingTest();
  await runSyncInvalidCodePreservesLocalBindingTest();
  await runLocalTranscriptionEntitlementTests();
  await runCloudFailedVoiceLocalFallbackTests();
  await runStoppedTranscriptionEscapesRealAttachmentPathsTest();
  await runAudioVideoFileAttachmentTranscriptionTests();
  await runSourceMediaAttachmentTests();
  await runPdfNoOcrFallbackTests();
  await runPodcastDownloadHeaderTests();
  await runLocalAsrRepairDecisionTests();
  await runDiagnosticFailureLogFilteringTests();
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
