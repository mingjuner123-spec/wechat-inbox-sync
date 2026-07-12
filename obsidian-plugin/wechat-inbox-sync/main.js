const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl,
} = require('obsidian');

const WECHAT_SESSION_PARTITION = 'persist:wechat-inbox-wechat';
const XIAOHONGSHU_SESSION_PARTITION = 'persist:wechat-inbox-sync-xiaohongshu';

const LEGACY_OFFICIAL_SYNC_API_BASES = [
  'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync',
];
const OFFICIAL_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';
const FEISHU_OAUTH_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync';
const FEISHU_TUTORIAL_URL = 'https://my.feishu.cn/wiki/EPHhwqRobijHqfkAqjMcDEgvnlf?from=from_copylink';
const FEISHU_OFFICIAL_API_TUTORIAL_URL = 'https://my.feishu.cn/wiki/LZBlwhqBCi880Bk00yOcB2dKn1g?from=from_copylink';
const MAX_PLUGIN_BINDINGS = 3;
const LOCAL_TRANSCRIPTION_PLAN = 'local_transcription_beta';
const LOCAL_TRANSCRIPTION_FALLBACK_PLANS = ['local_transcription_trial'];
const LOCAL_ASR_INSTALLER_URL = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr.ps1';
const LOCAL_ASR_MACOS_INSTALLER_URL = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr-macos.sh';
const LOCAL_OCR_INSTALLER_URL = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common/install-local-ocr.ps1';
const LOCAL_OCR_MACOS_INSTALLER_URL = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common/install-local-ocr-macos.sh';
const LOCAL_ASR_INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const PRO_SETUP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRO_SETUP_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const NOTE_SAVE_MODES = {
  date: '按日期创建子目录',
  root: '直接保存到根目录',
};
const DEFAULT_NOTE_PROPERTY_FIELDS = 'title,author,url,synced_at,source,description,keywords';
const RECORD_ID_MARKER_NAME = 'wechat-inbox-record-id';
const NOTE_PROPERTY_FIELD_KEYS = [
  'id',
  'type',
  'title',
  'author',
  'url',
  'created_at',
  'synced_at',
  'source',
  'description',
  'keywords',
  'status',
  'fetch_status',
  'conversion_status',
  'audio_file',
  'audio_file_id',
  'transcription_status',
  'file_name',
  'file_id',
  'file_ext',
];

const DEFAULT_SETTINGS = {
  apiBase: OFFICIAL_SYNC_API_BASE,
  settingsVersion: 2,
  token: '',
  pendingBindCode: '',
  pendingRedeemCode: '',
  localTranscriptionEntitlementStatus: null,
  proSetupLastCheckedAt: '',
  proSetupInstallPromptSnoozedUntil: '',
  bindings: [],
  clientId: '',
  inboxDir: '临时收集',
  noteSaveMode: 'date',
  notePropertyFields: DEFAULT_NOTE_PROPERTY_FIELDS,
  autoSyncOnLoad: true,
  aiProvider: 'off',
  aiMetadataEnabled: true,
  xiaohongshuCommentsEnabled: true,
  xiaohongshuImageOcrEnabled: true,
  wechatChannelsExperimentUrl: '',
  feishuOAuthStatus: null,
  feishuAppId: '',
  feishuAppSecret: '',
  deepseekApiKey: '',
  deepseekModel: 'deepseek-chat',
  deepseekBaseUrl: 'https://api.deepseek.com/v1/chat/completions',
  cloudPreTranscriptionEnabled: false,
  cloudPreTranscriptionThresholdMinutes: 10,
  localAsrPlatform: 'auto',
  localAsrInstallMode: 'default',
  localTranscriptionCommand: '',
  aliyunApiKey: '',
  aliyunModel: 'qwen3.5-omni-plus',
  aliyunBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  doubaoAsrApiKey: '',
  doubaoPollAttempts: 60,
  doubaoPollIntervalMs: 5000,
  pendingDoubaoTasks: {},
  tencentSecretId: '',
  tencentSecretKey: '',
  tencentRegion: 'ap-shanghai',
  tencentEngineModelType: '16k_zh',
  tencentPollAttempts: 60,
  tencentPollIntervalMs: 5000,
};

const XIAOHONGSHU_OCR_MAX_IMAGES = 18;
const XIAOHONGSHU_OCR_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function getImageFileExtension(url = '') {
  const match = String(url || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  const ext = match ? match[1].toLowerCase() : 'jpg';
  return ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext) ? ext : 'jpg';
}

const AI_PROVIDER_NAMES = {
  off: '关闭转写',
  local: '本地转写',
  aliyun: '阿里云百炼 Qwen-Omni',
  doubao: '豆包语音识别',
  tencent: '腾讯云 ASR 录音文件识别',
};

function normalizeCloudPreTranscriptionThresholdMinutes(value) {
  const number = Number(value);
  return [10, 30, 60].includes(number) ? number : DEFAULT_SETTINGS.cloudPreTranscriptionThresholdMinutes;
}

const LOCAL_ASR_PLATFORM_NAMES = {
  auto: '自动识别',
  win32: 'Windows',
  darwin: 'macOS',
};

const TYPE_DISPLAY_NAMES = {
  text: '文字',
  link: '链接',
  webpage: '网页',
  voice: '语音',
  file: '文件',
};

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
const TENCENT_ASR_HOST = 'asr.tencentcloudapi.com';
const TENCENT_ASR_VERSION = '2019-06-14';
const TENCENT_ASR_SERVICE = 'asr';
const FEISHU_OPEN_API_PAGE_SIZE = 500;
const FEISHU_OPEN_API_MAX_PAGES = 50;
const DOUBAO_ASR_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const DOUBAO_ASR_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
const DOUBAO_ASR_RESOURCE_ID = 'volc.seedasr.auc';
const ALIYUN_TRANSCRIPTION_PROMPT = '请逐字转写这段音频，只输出转写文本，不要摘要，不要解释，不要使用 Markdown。';
const LOCAL_ASR_HOME = '.wechat-inbox-local-asr';
const LOCAL_ASR_SAFE_HOME = 'wechat-inbox-local-asr';
const LOCAL_OCR_HOME = '.wechat-inbox-local-ocr';
const LOCAL_OCR_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const LOCAL_OCR_RUN_TIMEOUT_MS = 90 * 1000;

function getLocalAsrPlatform(platform = os.platform()) {
  if (platform === 'win32') return 'win32';
  if (platform === 'darwin') return 'darwin';
  return platform || '';
}

function normalizeLocalAsrPlatform(value) {
  return Object.prototype.hasOwnProperty.call(LOCAL_ASR_PLATFORM_NAMES, String(value || '').trim())
    ? String(value || '').trim()
    : 'auto';
}

function resolveLocalAsrPlatform(value, runtimePlatform = os.platform()) {
  const normalized = normalizeLocalAsrPlatform(value);
  return normalized === 'auto' ? getLocalAsrPlatform(runtimePlatform) : normalized;
}

function getLocalAsrPlatformMismatchMessage(selectedPlatform, runtimePlatform = os.platform()) {
  const normalized = normalizeLocalAsrPlatform(selectedPlatform);
  if (normalized === 'auto') return '';
  const selected = getLocalAsrPlatform(normalized);
  const runtime = getLocalAsrPlatform(runtimePlatform);
  if (!['win32', 'darwin'].includes(selected) || !['win32', 'darwin'].includes(runtime)) return '';
  if (selected === runtime) return '';
  const selectedName = LOCAL_ASR_PLATFORM_NAMES[selected] || selected;
  const runtimeName = LOCAL_ASR_PLATFORM_NAMES[runtime] || runtime;
  return `Local ASR platform mismatch: this computer is ${runtimeName}, but the selected installer is ${selectedName}. Please choose Auto or ${runtimeName}, then install again.`;
}

function getDefaultLocalTranscriptionCommand(platform = os.platform(), installRoot = '') {
  if (getLocalAsrPlatform(platform) === 'darwin') {
    return `/bin/bash "$HOME/${LOCAL_ASR_HOME}/transcribe.sh" --input {input} --output {output}`;
  }
  if (installRoot) {
    return `powershell -NoProfile -ExecutionPolicy Bypass -File "${joinLocalAsrPath(platform, installRoot, 'transcribe.ps1')}" -InputPath {input} -OutputPath {output}`;
  }
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\${LOCAL_ASR_HOME}\\transcribe.ps1" -InputPath {input} -OutputPath {output}`;
}

function normalizeLocalAsrInstallMode(value) {
  return String(value || '').trim() === 'safe' ? 'safe' : 'default';
}

function isAsciiPath(value) {
  return /^[\x00-\x7F]+$/.test(String(value || ''));
}

function getSafeLocalAsrInstallRoot(platform = os.platform(), env = process.env) {
  if (getLocalAsrPlatform(platform) === 'win32') {
    const systemDrive = String((env && env.SystemDrive) || 'C:').trim() || 'C:';
    const candidates = [
      String((env && env.PUBLIC) || '').trim(),
      String((env && env.ProgramData) || '').trim(),
      path.win32.join(systemDrive, LOCAL_ASR_SAFE_HOME),
      path.win32.join('C:', LOCAL_ASR_SAFE_HOME),
    ].filter(Boolean);
    const safeBase = candidates.find((candidate) => isAsciiPath(candidate)) || path.win32.join('C:', LOCAL_ASR_SAFE_HOME);
    return safeBase.endsWith(LOCAL_ASR_SAFE_HOME) ? safeBase : path.win32.join(safeBase, LOCAL_ASR_SAFE_HOME);
  }
  return path.join(os.homedir(), LOCAL_ASR_HOME);
}

function hasLocalAsrNativeCrash(runLogText) {
  const text = String(runLogText || '');
  return text.includes('0xC0000409')
    || text.includes('-1073740791')
    || /whisper\.cpp[^\n]*崩溃/.test(text);
}

function getLocalAsrRepairAction({
  platform = os.platform(),
  installRoot = '',
  status = {},
  runLogText = '',
} = {}) {
  if (
    getLocalAsrPlatform(platform) === 'win32'
    && (!isAsciiPath(installRoot) || hasLocalAsrNativeCrash(runLogText))
  ) {
    return 'safe';
  }
  if (!status || !status.ready || status.scriptOutdated) {
    return 'default';
  }
  return 'none';
}

function getLocalAsrInstallRoot(homeDir = os.homedir(), mode = 'default', platform = os.platform(), env = process.env) {
  if (normalizeLocalAsrInstallMode(mode) === 'safe') {
    return getSafeLocalAsrInstallRoot(platform, env);
  }
  return joinLocalAsrPath(platform, homeDir, LOCAL_ASR_HOME);
}

function getLocalOcrInstallRoot(homeDir = os.homedir(), platform = os.platform()) {
  return joinLocalAsrPath(platform, homeDir, LOCAL_OCR_HOME);
}

function getLocalOcrPythonPath(platform = os.platform(), installRoot = getLocalOcrInstallRoot(os.homedir(), platform)) {
  return getLocalAsrPlatform(platform) === 'darwin'
    ? joinLocalAsrPath(platform, installRoot, 'venv', 'bin', 'python')
    : joinLocalAsrPath(platform, installRoot, 'venv', 'Scripts', 'python.exe');
}

function getLocalOcrScriptPath(platform = os.platform(), installRoot = getLocalOcrInstallRoot(os.homedir(), platform)) {
  return joinLocalAsrPath(platform, installRoot, 'ocr_image.py');
}

function getLocalOcrInstallStatus(installRoot = getLocalOcrInstallRoot(), exists = fs.existsSync, platform = os.platform()) {
  const pythonPath = getLocalOcrPythonPath(platform, installRoot);
  const scriptPath = getLocalOcrScriptPath(platform, installRoot);
  const hasPython = Boolean(pythonPath && exists(pythonPath));
  const hasScript = Boolean(scriptPath && exists(scriptPath));
  const missingReasons = [];
  if (!hasPython) missingReasons.push('Python OCR 运行环境未找到，请安装/更新本地转写组件');
  if (!hasScript) missingReasons.push('OCR 脚本未找到，请安装/更新本地转写组件');
  return {
    installRoot,
    pythonPath,
    scriptPath,
    hasPython,
    hasScript,
    missingReasons,
    ready: hasPython && hasScript,
  };
}

function joinLocalAsrPath(platform, ...segments) {
  if (getLocalAsrPlatform(platform) === 'darwin') {
    const [first, ...rest] = segments;
    return [
      String(first || '').replace(/\/+$/g, ''),
      ...rest.map((segment) => String(segment || '').replace(/^\/+|\/+$/g, '')),
    ].filter(Boolean).join('/');
  }
  if (getLocalAsrPlatform(platform) === 'win32') {
    return path.win32.join(...segments);
  }
  return path.join(...segments);
}

function hasFileRecursive(rootDir, predicate) {
  return Boolean(findFileRecursive(rootDir, predicate));
}

function findFileRecursive(rootDir, predicate) {
  try {
    if (!fs.existsSync(rootDir)) return '';
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isFile() && predicate(fullPath, entry.name)) return fullPath;
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, predicate);
        if (found) return found;
      }
    }
  } catch (error) {
    return '';
  }
  return '';
}

function findFileRecursiveByNames(rootDir, names) {
  try {
    if (!fs.existsSync(rootDir)) return '';
    const matches = [];
    const visit = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && names.includes(entry.name)) {
          matches.push(fullPath);
        } else if (entry.isDirectory()) {
          visit(fullPath);
        }
      }
    };
    visit(rootDir);
    matches.sort((left, right) => {
      const leftRank = names.indexOf(path.basename(left));
      const rightRank = names.indexOf(path.basename(right));
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.localeCompare(right);
    });
    return matches[0] || '';
  } catch (error) {
    return '';
  }
}

function findFirstExistingPath(candidates, exists) {
  return candidates.find((candidate) => candidate && exists(candidate)) || '';
}

function getLocalAsrScriptVersionStatus(scriptPath, fileSystem = fs) {
  try {
    if (!scriptPath || !fileSystem.existsSync(scriptPath)) {
      return {
        scriptVersion: 'missing',
        scriptOutdated: true,
      };
    }
    const source = String(fileSystem.readFileSync(scriptPath, 'utf8') || '');
    if (source.includes('GeneratedTxt')) {
      return {
        scriptVersion: 'legacy-generated-txt',
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && source.includes('recoveryTriggered=')
      && source.includes('Split-AudioToChunks')
      && source.includes('Test-TranscriptHasRepeatHallucination')
      && source.includes('Invoke-RecoverRepeatedChunkText')
      && source.includes('$ChunkRetrySeconds')
      && source.includes('$ChunkSeconds = 120')
      && source.includes('Invoke-NativeProcess')
      && source.includes('Start-Process')
      && source.includes('RedirectStandardOutput')
      && source.includes('ConvertTo-SimplifiedChinese')
      && source.includes('SimplifiedChinese')
      && source.includes('$SimplifiedPrompt')
      && source.includes('System.Text.UTF8Encoding')
      && source.includes('ReadAllText')
      && source.includes('WriteAllText')
      && source.includes('Get-ShortPath')
      && source.includes('Test-WhisperNativeCrashExitCode')
      && source.includes('Convert-ExitCodeToHex')
      && source.includes('$hex = Convert-ExitCodeToHex -ExitCode $ExitCode')
      && source.includes('Invoke-TranscribeAttempt -Mode "normal"')
      && source.includes('Invoke-TranscribeAttempt -Mode "safe"')
      && source.includes('safeModelPath')
      && source.includes('progressPercent')
      && !source.includes('DataReceivedEventHandler')
      && !source.includes('BeginOutputReadLine')
    ) {
      return {
        scriptVersion: 'adaptive-chunked-start-process-repeat-guard-progress-run-log',
        scriptOutdated: false,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && (source.includes('ChunkSeconds') || source.includes('CHUNK_SECONDS'))
      && source.includes('Invoke-NativeProcess')
      && source.includes('Start-Process')
      && source.includes('RedirectStandardOutput')
      && source.includes('ConvertTo-SimplifiedChinese')
      && source.includes('SimplifiedChinese')
      && source.includes('$SimplifiedPrompt')
      && source.includes('System.Text.UTF8Encoding')
      && source.includes('ReadAllText')
      && source.includes('WriteAllText')
      && source.includes('Get-ShortPath')
      && source.includes('Test-WhisperNativeCrashExitCode')
      && source.includes('Convert-ExitCodeToHex')
      && source.includes('$hex = Convert-ExitCodeToHex -ExitCode $ExitCode')
      && source.includes('Invoke-TranscribeAttempt -Mode "normal"')
      && source.includes('Invoke-TranscribeAttempt -Mode "safe"')
      && source.includes('safeModelPath')
      && source.includes('progressPercent')
      && !source.includes('DataReceivedEventHandler')
      && !source.includes('BeginOutputReadLine')
    ) {
      return {
        scriptVersion: 'chunked-start-process-utf8-simplified-fallback-safe-model-progress-run-log',
        scriptOutdated: false,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && (source.includes('ChunkSeconds') || source.includes('CHUNK_SECONDS'))
      && source.includes('Invoke-NativeProcess')
      && source.includes('Start-Process')
      && source.includes('RedirectStandardOutput')
      && source.includes('ConvertTo-SimplifiedChinese')
      && source.includes('SimplifiedChinese')
      && source.includes('$SimplifiedPrompt')
      && source.includes('System.Text.UTF8Encoding')
      && source.includes('ReadAllText')
      && source.includes('WriteAllText')
      && source.includes('Get-ShortPath')
      && source.includes('Test-WhisperNativeCrashExitCode')
      && source.includes('Invoke-TranscribeAttempt -Mode "normal"')
      && source.includes('Invoke-TranscribeAttempt -Mode "safe"')
    ) {
      return {
        scriptVersion: 'chunked-start-process-utf8-simplified-fallback-run-log',
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && (source.includes('ChunkSeconds') || source.includes('CHUNK_SECONDS'))
      && source.includes('Invoke-NativeProcess')
      && source.includes('Start-Process')
      && source.includes('RedirectStandardOutput')
      && source.includes('ConvertTo-SimplifiedChinese')
      && source.includes('SimplifiedChinese')
      && source.includes('$SimplifiedPrompt')
      && source.includes('System.Text.UTF8Encoding')
      && source.includes('ReadAllText')
      && source.includes('WriteAllText')
      && source.includes('Get-ShortPath')
      && source.includes('$SafeTempRoot')
    ) {
      return {
        scriptVersion: 'chunked-start-process-utf8-simplified-shortpath-run-log',
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && (source.includes('ChunkSeconds') || source.includes('CHUNK_SECONDS'))
      && source.includes('Invoke-NativeProcess')
      && source.includes('Start-Process')
      && source.includes('RedirectStandardOutput')
      && source.includes('ConvertTo-SimplifiedChinese')
      && source.includes('SimplifiedChinese')
      && source.includes('$SimplifiedPrompt')
      && source.includes('System.Text.UTF8Encoding')
      && source.includes('ReadAllText')
      && source.includes('WriteAllText')
    ) {
      return {
        scriptVersion: 'chunked-start-process-utf8-simplified-run-log',
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && (source.includes('ChunkSeconds') || source.includes('CHUNK_SECONDS'))
      && source.includes('Invoke-NativeProcess')
      && source.includes('Start-Process')
      && source.includes('RedirectStandardOutput')
      && source.includes('System.Text.UTF8Encoding')
      && source.includes('ReadAllText')
      && source.includes('WriteAllText')
    ) {
      return {
        scriptVersion: 'chunked-start-process-utf8-run-log',
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && (source.includes('ChunkSeconds') || source.includes('CHUNK_SECONDS'))
      && source.includes('Invoke-NativeProcess')
      && source.includes('System.Text.UTF8Encoding')
      && source.includes('ReadAllText')
      && source.includes('WriteAllText')
    ) {
      return {
        scriptVersion: 'chunked-safe-native-utf8-run-log',
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && (source.includes('ChunkSeconds') || source.includes('CHUNK_SECONDS'))
      && source.includes('Invoke-NativeProcess')
    ) {
      return {
        scriptVersion: 'chunked-safe-native-run-log',
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && source.includes('CHUNK_SECONDS')
      && source.includes('set -euo pipefail')
      && source.includes('SIMPLIFIED_PROMPT')
      && source.includes('--prompt "$SIMPLIFIED_PROMPT"')
      && source.includes('CHUNK_SECONDS=120')
      && source.includes('choose_chunk_seconds')
      && source.includes('find_metal_resources_dir')
      && source.includes('GGML_METAL_PATH_RESOURCES')
      && source.includes('metalAcceleration=failed')
      && source.includes('progressPercent')
    ) {
      return {
        scriptVersion: 'adaptive-chunked-bash-simplified-progress-metal-diagnostics-run-log',
        scriptOutdated: false,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && source.includes('CHUNK_SECONDS')
      && source.includes('set -euo pipefail')
      && source.includes('SIMPLIFIED_PROMPT')
      && source.includes('--prompt "$SIMPLIFIED_PROMPT"')
      && source.includes('progressPercent')
    ) {
      return {
        scriptVersion: 'chunked-bash-simplified-progress-run-log',
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && source.includes('CHUNK_SECONDS')
      && source.includes('set -euo pipefail')
    ) {
      return {
        scriptVersion: 'chunked-bash-run-log',
        scriptOutdated: true,
      };
    }
    if (source.includes('transcribe-last.log') && (source.includes('ChunkSeconds') || source.includes('CHUNK_SECONDS'))) {
      return {
        scriptVersion: 'chunked-run-log',
        scriptOutdated: true,
      };
    }
    return {
      scriptVersion: 'unknown',
      scriptOutdated: false,
    };
  } catch (error) {
    return {
      scriptVersion: 'unknown',
      scriptOutdated: false,
    };
  }
}

function getLocalAsrInstallStatus(installRoot = getLocalAsrInstallRoot(), exists = fs.existsSync, platform = os.platform()) {
  const isMac = getLocalAsrPlatform(platform) === 'darwin';
  const transcribeScript = joinLocalAsrPath(platform, installRoot, isMac ? 'transcribe.sh' : 'transcribe.ps1');
  const modelPath = joinLocalAsrPath(platform, installRoot, 'models', 'ggml-small.bin');
  const hasTranscribeScript = exists(transcribeScript);
  const scriptVersionStatus = exists === fs.existsSync
    ? getLocalAsrScriptVersionStatus(transcribeScript)
    : { scriptVersion: 'unknown', scriptOutdated: false };
  const hasModel = exists(modelPath);
  const whisperNames = isMac ? ['whisper-cli', 'main'] : ['whisper-cli.exe', 'main.exe'];
  const ffmpegName = isMac ? 'ffmpeg' : 'ffmpeg.exe';
  const whisperCandidates = [
    joinLocalAsrPath(platform, installRoot, 'bin', whisperNames[0]),
    joinLocalAsrPath(platform, installRoot, 'bin', whisperNames[1]),
    joinLocalAsrPath(platform, installRoot, 'whisper', whisperNames[0]),
    joinLocalAsrPath(platform, installRoot, 'whisper', whisperNames[1]),
  ];
  const ffmpegCandidates = [
    joinLocalAsrPath(platform, installRoot, 'bin', ffmpegName),
    joinLocalAsrPath(platform, installRoot, 'ffmpeg', ffmpegName),
  ];
  const whisperPath = findFirstExistingPath(whisperCandidates, exists)
    || (exists === fs.existsSync ? findFileRecursiveByNames(path.join(installRoot, 'whisper'), whisperNames) : '')
    || (exists === fs.existsSync ? findFileRecursiveByNames(path.join(installRoot, 'bin'), whisperNames) : '');
  const ffmpegPath = findFirstExistingPath(ffmpegCandidates, exists)
    || (exists === fs.existsSync ? findFileRecursive(path.join(installRoot, 'ffmpeg'), (filePath, name) => name === ffmpegName) : '')
    || (exists === fs.existsSync ? findFileRecursive(path.join(installRoot, 'bin'), (filePath, name) => name === ffmpegName) : '');
  const hasWhisper = Boolean(whisperPath);
  const hasFfmpeg = Boolean(ffmpegPath);
  const missingReasons = [];
  if (!hasTranscribeScript) missingReasons.push('转写脚本未找到，请重新安装/更新本地转写组件');
  if (scriptVersionStatus.scriptOutdated) missingReasons.push('转写脚本过旧，请重新安装/更新本地转写组件');
  if (!hasWhisper) missingReasons.push('whisper 未找到，请重新安装/更新本地转写组件');
  if (!hasFfmpeg) missingReasons.push('ffmpeg 未找到，请重新安装/更新本地转写组件');
  if (!hasModel) missingReasons.push('模型文件未找到，请重新安装/更新本地转写组件');

  return {
    installRoot,
    transcribeScript,
    whisperPath,
    ffmpegPath,
    modelPath,
    hasTranscribeScript,
    scriptVersion: scriptVersionStatus.scriptVersion,
    scriptOutdated: scriptVersionStatus.scriptOutdated,
    hasWhisper,
    hasFfmpeg,
    hasModel,
    missingReasons,
    ready: hasTranscribeScript && !scriptVersionStatus.scriptOutdated && hasWhisper && hasFfmpeg && hasModel,
  };
}

function getLocalAsrInstallLogPath(installRoot = getLocalAsrInstallRoot()) {
  return path.join(installRoot, 'install.log');
}

function readLocalAsrInstallLog(installRoot = getLocalAsrInstallRoot()) {
  const logPath = getLocalAsrInstallLogPath(installRoot);
  try {
    if (!fs.existsSync(logPath)) return '';
    return fs.readFileSync(logPath, 'utf8').slice(-5000);
  } catch (error) {
    return `读取安装日志失败：${error.message || error}`;
  }
}

function getLocalAsrRunLogPath(installRoot = getLocalAsrInstallRoot()) {
  return path.join(installRoot, 'transcribe-last.log');
}

function explainLocalAsrExitCode(value) {
  const text = String(value || '');
  if (text.includes('-1073741515') || text.toUpperCase().includes('0XC0000135')) {
    return '缺少 Windows VC++ 运行库或 whisper 依赖 DLL，请重新点击“安装/更新本地转写组件”修复。';
  }
  if (text.includes('-1073740791') || text.toUpperCase().includes('0XC0000409')) {
    return 'whisper.cpp 原生程序崩溃（0xC0000409）。常见原因是 Windows 本机运行环境、CPU 指令集兼容性、中文路径或当前音视频片段触发了 whisper.cpp 崩溃。请先重新点击“安装/更新本地转写组件”，新版会用安全路径和真实推理校验修复；如果仍失败，需要复制同步/安装失败诊断里的 transcribe-last.log 继续定位。';
  }
  return '';
}

function getSyncDiagnosticLogPath(installRoot = getLocalAsrInstallRoot()) {
  return path.join(installRoot, 'sync-last.log');
}

function buildLocalAsrRunLogText({
  time = new Date().toISOString(),
  status = '',
  command = '',
  inputPath = '',
  outputPath = '',
  stdout = '',
  stderr = '',
  error = '',
} = {}) {
  const explanation = explainLocalAsrExitCode(error) || explainLocalAsrExitCode(stderr) || explainLocalAsrExitCode(stdout);
  return [
    `time=${time}`,
    `status=${status}`,
    `inputPath=${inputPath}`,
    `outputPath=${outputPath}`,
    `command=${command}`,
    '--- stdout ---',
    String(stdout || ''),
    '--- stderr ---',
    String(stderr || ''),
    '--- error ---',
    String(error || ''),
    explanation ? `--- 可能原因 ---\n${explanation}` : '',
    '',
  ].filter((line) => line !== '').join('\n');
}

function writeLocalAsrRunLog({
  installRoot = getLocalAsrInstallRoot(),
  status = '',
  command = '',
  inputPath = '',
  outputPath = '',
  stdout = '',
  stderr = '',
  error = '',
} = {}) {
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    const logPath = getLocalAsrRunLogPath(installRoot);
    fs.writeFileSync(logPath, buildLocalAsrRunLogText({
      status,
      command,
      inputPath,
      outputPath,
      stdout,
      stderr,
      error,
    }), 'utf8');
    return logPath;
  } catch (writeError) {
    return '';
  }
}

function appendLocalAsrRunLog({
  installRoot = getLocalAsrInstallRoot(),
  status = '',
  command = '',
  inputPath = '',
  outputPath = '',
  stdout = '',
  stderr = '',
  error = '',
} = {}) {
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    const logPath = getLocalAsrRunLogPath(installRoot);
    const wrapperText = buildLocalAsrRunLogText({
      status,
      command,
      inputPath,
      outputPath,
      stdout,
      stderr,
      error,
    });
    // A download failure happens before the native transcriber starts. Keeping
    // a prior successful transcript in this log makes diagnostics misleading.
    if (!String(command || '').trim()) {
      fs.writeFileSync(logPath, wrapperText, 'utf8');
      return logPath;
    }
    const prefix = fs.existsSync(logPath) ? '\n\n--- plugin wrapper ---\n' : '';
    fs.appendFileSync(logPath, `${prefix}${wrapperText}`, 'utf8');
    return logPath;
  } catch (writeError) {
    return '';
  }
}

function buildSyncDiagnosticLogText({
  time = new Date().toISOString(),
  status = '',
  message = '',
  bindingLabel = '',
  stage = '',
  current = 0,
  total = 0,
  title = '',
  recordId = '',
  error = '',
} = {}) {
  return [
    `time=${time}`,
    `status=${status}`,
    `message=${message}`,
    `bindingLabel=${bindingLabel}`,
    `stage=${stage}`,
    `current=${current}`,
    `total=${total}`,
    `title=${title}`,
    `recordId=${recordId}`,
    '--- error ---',
    String(error || ''),
  ].join('\n');
}

function writeSyncDiagnosticLog(payload = {}, installRoot = getLocalAsrInstallRoot()) {
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    const logPath = getSyncDiagnosticLogPath(installRoot);
    fs.writeFileSync(logPath, buildSyncDiagnosticLogText(payload), 'utf8');
    return logPath;
  } catch (error) {
    return '';
  }
}

function readSyncDiagnosticLog(installRoot = getLocalAsrInstallRoot()) {
  const logPath = getSyncDiagnosticLogPath(installRoot);
  try {
    if (!fs.existsSync(logPath)) return '';
    return fs.readFileSync(logPath, 'utf8').slice(-5000);
  } catch (error) {
    return `读取同步日志失败：${error.message || error}`;
  }
}

function readLocalAsrRunLog(installRoot = getLocalAsrInstallRoot()) {
  const logPath = getLocalAsrRunLogPath(installRoot);
  try {
    if (!fs.existsSync(logPath)) return '';
    return fs.readFileSync(logPath, 'utf8').slice(-8000);
  } catch (error) {
    return `读取转写日志失败：${error.message || error}`;
  }
}

function writeLocalAsrInstallLog({
  installRoot = getLocalAsrInstallRoot(),
  platform = os.platform(),
  command = '',
  installerPath = '',
  stdout = '',
  stderr = '',
  error = '',
  status = '',
} = {}) {
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    const logPath = getLocalAsrInstallLogPath(installRoot);
    const lines = [
      `time=${new Date().toISOString()}`,
      `status=${status}`,
      `platform=${platform}`,
      `installerPath=${installerPath}`,
      `command=${command}`,
      '--- stdout ---',
      String(stdout || ''),
      '--- stderr ---',
      String(stderr || ''),
      '--- error ---',
      String(error || ''),
      '',
    ];
    fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
    return logPath;
  } catch (writeError) {
    return '';
  }
}

function quoteCommandPath(filePath) {
  return `"${String(filePath || '').replace(/"/g, '\\"')}"`;
}

function buildLocalAsrInstallCommand(installerPath, platform = os.platform(), installRoot = '') {
  if (getLocalAsrPlatform(platform) === 'darwin' || String(installerPath || '').endsWith('.sh')) {
    return `/bin/bash ${quoteCommandPath(installerPath)}`;
  }
  const rootArg = installRoot ? ` -InstallRoot ${quoteCommandPath(installRoot)}` : '';
  return `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoteCommandPath(installerPath)}${rootArg}`;
}

function buildLocalOcrInstallCommand(installerPath, platform = os.platform(), installRoot = '') {
  if (getLocalAsrPlatform(platform) === 'darwin' || String(installerPath || '').endsWith('.sh')) {
    return `/bin/bash ${quoteCommandPath(installerPath)}`;
  }
  const rootArg = installRoot ? ` -InstallRoot ${quoteCommandPath(installRoot)}` : '';
  return `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoteCommandPath(installerPath)}${rootArg}`;
}

function formatEntitlementExpiresAt(expiresAt) {
  if (!expiresAt) return '';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return String(expiresAt);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildLocalTranscriptionEntitlementText(status) {
  if (!status || typeof status !== 'object') {
    return '权限状态：未刷新。请先绑定小程序并开通 Pro，再回到插件点击「刷新权限」。';
  }
  if (status.hasAccess) {
    return `权限状态：已开通${status.code ? `，兑换码：${status.code}` : ''}${status.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : ''}${status.bindingLabel ? `，绑定：${status.bindingLabel}` : ''}`;
  }
  if (status.status === 'missing_redeem_code') {
    return '权限状态：未识别到 Pro。请确认已绑定小程序并在小程序里开通 Pro。';
  }
  if (status.status === 'invalid_redeem_code') {
    return `权限状态：兑换码无效${status.code ? `（${status.code}）` : ''}。`;
  }
  if (status.status === 'expired') {
    return `权限状态：已过期${status.expiresAt ? `，到期时间 ${formatEntitlementExpiresAt(status.expiresAt)}` : ''}。请在小程序里续费 Pro 后刷新权限。`;
  }
  if (status.status === 'unbound') {
    return '权限状态：未绑定小程序。请先完成小程序绑定。';
  }
  return '权限状态：未开通。请在小程序开通 Pro 后，再回到插件刷新权限。';
}

function isCachedProStatusActive(status, now = Date.now()) {
  if (!status || typeof status !== 'object') return false;
  if (!status.hasAccess || status.status === 'expired') return false;
  if (!status.expiresAt) return false;
  const expiresAt = new Date(status.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function isCachedProStatusActiveForCode(status, code, now = Date.now()) {
  const normalizedCode = normalizeBindCodeInput(code);
  return Boolean(
    normalizedCode
    && isCachedProStatusActive(status, now)
    && normalizeBindCodeInput(status && status.code) === normalizedCode,
  );
}

function buildMissingRedeemCodeStatus() {
  return {
    hasAccess: false,
    plan: LOCAL_TRANSCRIPTION_PLAN,
    status: 'missing_redeem_code',
    expiresAt: '',
    code: '',
  };
}

function formatRedeemAccessError(error, mode = 'redeem') {
  const message = error && error.message ? error.message : String(error || '');
  if (/status\s*404|NO_AVAILABLE_REDEEM_CODE|没有找到|No available redeem code/i.test(message)) {
    return mode === 'auto'
      ? '没有识别到可用兑换码，请手动输入兑换码。'
      : '无可用兑换码，请先输入或自动识别兑换码。';
  }
  if (/status\s*400|INVALID_REDEEM_CODE|Invalid redeem code|兑换码无效|Missing redeem code/i.test(message)) {
    return '兑换码无效、已过期，或不属于当前绑定微信。';
  }
  if (/Invalid bind code|绑定码未绑定|403/i.test(message)) {
    return '绑定码未绑定或已失效，请先重新绑定小程序。';
  }
  if (/Request failed, status/i.test(message)) {
    return '兑换码验证失败，请稍后重试。';
  }
  return message || '兑换码验证失败，请稍后重试。';
}

function downloadTextViaNode(url) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch (error) {
      reject(error);
      return;
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': 'wechat-inbox-sync',
        Accept: 'text/plain,*/*',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          try {
            downloadTextViaNode(new URL(response.headers.location, url).toString()).then(resolve, reject);
          } catch (error) {
            reject(error);
          }
          return;
        }
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${text.slice(0, 120)}`));
          return;
        }
        resolve(text);
      });
    });
    request.setTimeout(30000, () => {
      request.destroy(new Error('download timeout'));
    });
    request.on('error', reject);
    request.end();
  });
}

function normalizeInstallerScriptText(scriptText, isMac = false) {
  const source = String(scriptText || '');
  if (!isMac) return source;
  return source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

function createRetryableTranscriptionError(message) {
  const error = new Error(message);
  error.retryable = true;
  error.code = 'TRANSCRIPTION_PENDING';
  return error;
}

function isRetryableTranscriptionError(error) {
  return Boolean(error && (error.retryable || error.code === 'TRANSCRIPTION_PENDING'));
}

function isRemoteAsrDownloadFailure(error) {
  const message = String((error && error.message) || error || '');
  return /Invalid audio URI|audio download failed|Audio download failed/i.test(message);
}

function isRecordNotFoundError(error) {
  const message = String((error && error.message) || error || '');
  return /Record not found/i.test(message);
}

function getDefaultLocalTranscriptionScriptPath(platform = os.platform(), installRoot = '') {
  const root = installRoot || getLocalAsrInstallRoot(os.homedir(), 'default', platform);
  return path.join(root, getLocalAsrPlatform(platform) === 'darwin' ? 'transcribe.sh' : 'transcribe.ps1');
}

function getDoubaoTaskKey(audioUrl) {
  return crypto.createHash('sha256').update(String(audioUrl || '')).digest('hex');
}

function createClientId() {
  return `obsidian-${crypto.randomBytes(16).toString('hex')}`;
}

function isWindowsLocalAsrCommand(command) {
  const normalized = String(command || '').toLowerCase();
  return normalized.includes('powershell')
    && (normalized.includes('transcribe.ps1') || normalized.includes(LOCAL_ASR_HOME));
}

function normalizeLocalTranscriptionCommand(command, platform = os.platform()) {
  const normalized = String(command || '')
    .trim()
    .replace(/\$env:USERPROFILE/gi, '%USERPROFILE%');
  if (getLocalAsrPlatform(platform) === 'darwin' && isWindowsLocalAsrCommand(normalized)) {
    return getDefaultLocalTranscriptionCommand(platform);
  }
  return normalized;
}

function extractLocalAsrInstallRootFromCommand(command, platform = os.platform()) {
  const source = String(command || '').trim();
  if (!source) return '';
  const localPlatform = getLocalAsrPlatform(platform);
  const scriptName = localPlatform === 'darwin' ? 'transcribe.sh' : 'transcribe.ps1';
  const scriptPattern = escapeRegExp(scriptName);
  const quotedMatch = source.match(new RegExp(`["']([^"']*${scriptPattern})["']`, 'i'));
  const unquotedMatch = quotedMatch ? null : source.match(new RegExp(`(?:^|\\s)([^\\s"']*${scriptPattern})(?:\\s|$)`, 'i'));
  const scriptPath = String((quotedMatch && quotedMatch[1]) || (unquotedMatch && unquotedMatch[1]) || '').trim();
  if (!scriptPath || /[%$]|\{|\}/.test(scriptPath)) return '';
  const normalizedScriptPath = localPlatform === 'win32'
    ? path.win32.normalize(scriptPath)
    : path.posix.normalize(scriptPath.replace(/\\/g, '/'));
  if (path.basename(normalizedScriptPath).toLowerCase() !== scriptName.toLowerCase()) return '';
  return localPlatform === 'win32'
    ? path.win32.dirname(normalizedScriptPath)
    : path.posix.dirname(normalizedScriptPath);
}

function normalizeNoteSaveMode(value) {
  const normalized = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(NOTE_SAVE_MODES, normalized)
    ? normalized
    : DEFAULT_SETTINGS.noteSaveMode;
}

function normalizeNotePropertyFields(value) {
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      if (!NOTE_PROPERTY_FIELD_KEYS.includes(item) || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .join(',');
}

function normalizeBindCodeInput(code) {
  const compact = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[‐-‒–—―]/g, '-')
    .replace(/[^A-Z0-9]/g, '');
  if (compact.length === 6) {
    return `${compact.slice(0, 3)}-${compact.slice(3)}`;
  }
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[‐-‒–—―]/g, '-')
    .replace(/\s+/g, '');
}

function redactSensitiveObject(value, key = '') {
  if (/token|code|secret|authorization|cookie/i.test(String(key || ''))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactSensitiveObject(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitiveObject(entryValue, entryKey),
      ])
    );
  }
  return value;
}

function redactKnownCredentials(text, settings = {}) {
  const entitlement = settings.localTranscriptionEntitlementStatus || {};
  const credentials = [
    settings.token,
    settings.pendingRedeemCode,
    entitlement.code,
    entitlement.bindingToken,
    ...(Array.isArray(settings.bindings) ? settings.bindings.map((item) => item && item.token) : []),
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return credentials.reduce(
    (result, credential) => result.split(credential).join('[REDACTED]'),
    String(text || '')
  );
}

function normalizeBindings(settings) {
  const sourceBindings = Array.isArray(settings && settings.bindings) ? settings.bindings : [];
  const legacyToken = normalizeBindCodeInput(settings && settings.token);
  const seen = new Set();
  const bindings = [];

  sourceBindings.forEach((item) => {
    const token = normalizeBindCodeInput(item && item.token);
    if (!token || seen.has(token)) return;
    if (item && item.status === 'unbound') return;
    seen.add(token);
    bindings.push({
      token,
      label: String((item && item.label) || '').trim() || `微信 ${bindings.length + 1}`,
      enabled: item && Object.prototype.hasOwnProperty.call(item, 'enabled') ? Boolean(item.enabled) : true,
      status: String((item && item.status) || '').trim() || (item && item.enabled === false ? 'paused' : 'bound'),
      boundAt: (item && item.boundAt) || '',
      lastSyncAt: (item && item.lastSyncAt) || '',
      unboundAt: (item && item.unboundAt) || '',
      lastError: (item && item.lastError) || '',
    });
  });

  if (legacyToken && !seen.has(legacyToken)) {
    bindings.unshift({
      token: legacyToken,
      label: '默认微信',
      enabled: true,
      status: 'bound',
      boundAt: '',
      lastSyncAt: '',
      unboundAt: '',
      lastError: '',
    });
  }

  return bindings.slice(0, MAX_PLUGIN_BINDINGS);
}

function canAddPluginBinding(settings, candidateToken) {
  const token = normalizeBindCodeInput(candidateToken);
  if (!token) return false;
  const bindings = normalizeBindings(settings);
  if (bindings.some((item) => item && item.token === token)) return true;
  return bindings.length < MAX_PLUGIN_BINDINGS;
}

function getPrimaryBindingToken(bindings) {
  const active = (Array.isArray(bindings) ? bindings : [])
    .find((item) => item && item.enabled !== false && item.status !== 'unbound' && item.token);
  return active ? active.token : '';
}

function normalizeApiBase(apiBase) {
  const normalized = String(apiBase || '').trim() || DEFAULT_SETTINGS.apiBase;
  return LEGACY_OFFICIAL_SYNC_API_BASES.includes(normalized)
    ? OFFICIAL_SYNC_API_BASE
    : normalized;
}

function mergeSettings(savedSettings, platform = os.platform()) {
  const sourceSettings = savedSettings && typeof savedSettings === 'object' ? savedSettings : {};
  const savedSettingsVersion = Number(sourceSettings.settingsVersion) || 0;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...sourceSettings,
  };

  merged.apiBase = normalizeApiBase(merged.apiBase);
  const rawEntitlementStatus = merged.localTranscriptionEntitlementStatus
    && typeof merged.localTranscriptionEntitlementStatus === 'object'
    && !Array.isArray(merged.localTranscriptionEntitlementStatus)
    ? merged.localTranscriptionEntitlementStatus
    : null;
  const entitlementBindingToken = normalizeBindCodeInput(rawEntitlementStatus && rawEntitlementStatus.bindingToken);
  const entitlementRedeemCode = normalizeBindCodeInput(
    (rawEntitlementStatus && (rawEntitlementStatus.code || rawEntitlementStatus.redeemCode)) || '',
  );
  const pendingBindToken = normalizeBindCodeInput(merged.pendingBindCode);
  if (entitlementRedeemCode && !merged.pendingRedeemCode) {
    merged.pendingRedeemCode = entitlementRedeemCode;
  }
  const hasSourceBinding = Array.isArray(merged.bindings)
    && merged.bindings.some((item) => normalizeBindCodeInput(item && item.token) && item.status !== 'unbound');
  const normalizedToken = normalizeBindCodeInput(merged.token)
    || entitlementBindingToken
    || (!hasSourceBinding ? pendingBindToken : '');
  if (normalizedToken && !hasSourceBinding) {
    merged.bindings = [{
      token: normalizedToken,
      label: String((rawEntitlementStatus && rawEntitlementStatus.bindingLabel) || '').trim() || '微信 1',
      enabled: true,
      status: 'bound',
      boundAt: '',
      lastSyncAt: '',
      unboundAt: '',
      lastError: '',
    }];
  }
  merged.bindings = normalizeBindings(merged);
  const tokenBinding = merged.bindings.find((item) => item.token === normalizedToken && item.status !== 'unbound');
  merged.token = tokenBinding ? normalizedToken : getPrimaryBindingToken(merged.bindings);
  merged.pendingBindCode = merged.token === pendingBindToken ? '' : pendingBindToken;
  merged.pendingRedeemCode = normalizeBindCodeInput(merged.pendingRedeemCode);
  merged.localTranscriptionEntitlementStatus = rawEntitlementStatus;
  if (isInvalidCloudBaseEnvMessage(merged.localTranscriptionEntitlementStatus && merged.localTranscriptionEntitlementStatus.message)) {
    merged.localTranscriptionEntitlementStatus = null;
  }
  if (!merged.token && !merged.bindings.length) {
    if (merged.localTranscriptionEntitlementStatus && !merged.localTranscriptionEntitlementStatus.hasAccess) {
      merged.localTranscriptionEntitlementStatus = {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: 'unbound',
        expiresAt: '',
      };
    }
  }
  merged.proSetupLastCheckedAt = String(merged.proSetupLastCheckedAt || '').trim();
  merged.proSetupInstallPromptSnoozedUntil = String(merged.proSetupInstallPromptSnoozedUntil || '').trim();
  merged.clientId = String(merged.clientId || '').trim() || createClientId();
  merged.inboxDir = String(merged.inboxDir || '').trim() || DEFAULT_SETTINGS.inboxDir;
  merged.noteSaveMode = normalizeNoteSaveMode(merged.noteSaveMode);
  merged.notePropertyFields = DEFAULT_NOTE_PROPERTY_FIELDS;
  merged.autoSyncOnLoad = true;
  merged.aiProvider = AI_PROVIDER_NAMES[merged.aiProvider] ? merged.aiProvider : DEFAULT_SETTINGS.aiProvider;
  merged.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  merged.aiMetadataEnabled = true;
  merged.xiaohongshuCommentsEnabled = savedSettingsVersion < 2
    ? true
    : merged.xiaohongshuCommentsEnabled !== false;
  merged.xiaohongshuImageOcrEnabled = true;
  merged.wechatChannelsExperimentUrl = String(merged.wechatChannelsExperimentUrl || '').trim();
  merged.feishuOAuthStatus = merged.feishuOAuthStatus
    && typeof merged.feishuOAuthStatus === 'object'
    && !Array.isArray(merged.feishuOAuthStatus)
    ? merged.feishuOAuthStatus
    : null;
  delete merged.feishuCloudOAuthEnabled;
  delete merged.feishuOpenApiEnabled;
  merged.feishuAppId = String(merged.feishuAppId || '').trim();
  merged.feishuAppSecret = String(merged.feishuAppSecret || '').trim();
  merged.deepseekApiKey = String(merged.deepseekApiKey || '').trim();
  merged.deepseekModel = String(merged.deepseekModel || '').trim() || DEFAULT_SETTINGS.deepseekModel;
  merged.deepseekBaseUrl = String(merged.deepseekBaseUrl || '').trim() || DEFAULT_SETTINGS.deepseekBaseUrl;
  merged.cloudPreTranscriptionEnabled = Boolean(merged.cloudPreTranscriptionEnabled);
  merged.cloudPreTranscriptionThresholdMinutes = normalizeCloudPreTranscriptionThresholdMinutes(merged.cloudPreTranscriptionThresholdMinutes);
  merged.localAsrPlatform = normalizeLocalAsrPlatform(merged.localAsrPlatform);
  merged.localAsrInstallMode = normalizeLocalAsrInstallMode(merged.localAsrInstallMode);
  merged.localTranscriptionCommand = normalizeLocalTranscriptionCommand(
    merged.localTranscriptionCommand,
    resolveLocalAsrPlatform(merged.localAsrPlatform, platform),
  );
  merged.aliyunApiKey = String(merged.aliyunApiKey || '').trim();
  merged.aliyunModel = String(merged.aliyunModel || '').trim() || DEFAULT_SETTINGS.aliyunModel;
  merged.aliyunBaseUrl = String(merged.aliyunBaseUrl || '').trim() || DEFAULT_SETTINGS.aliyunBaseUrl;
  merged.doubaoAsrApiKey = String(merged.doubaoAsrApiKey || '').trim();
  const doubaoPollAttempts = Number(merged.doubaoPollAttempts);
  const doubaoPollIntervalMs = Number(merged.doubaoPollIntervalMs);
  merged.doubaoPollAttempts = Math.max(1, Number.isFinite(doubaoPollAttempts) ? doubaoPollAttempts : DEFAULT_SETTINGS.doubaoPollAttempts);
  merged.doubaoPollIntervalMs = Math.max(1000, Number.isFinite(doubaoPollIntervalMs) ? doubaoPollIntervalMs : DEFAULT_SETTINGS.doubaoPollIntervalMs);
  merged.pendingDoubaoTasks = merged.pendingDoubaoTasks && typeof merged.pendingDoubaoTasks === 'object' && !Array.isArray(merged.pendingDoubaoTasks)
    ? merged.pendingDoubaoTasks
    : {};
  merged.tencentSecretId = String(merged.tencentSecretId || '').trim();
  merged.tencentSecretKey = String(merged.tencentSecretKey || '').trim();
  merged.tencentRegion = String(merged.tencentRegion || '').trim() || DEFAULT_SETTINGS.tencentRegion;
  merged.tencentEngineModelType = String(merged.tencentEngineModelType || '').trim() || DEFAULT_SETTINGS.tencentEngineModelType;

  const pollAttempts = Number(merged.tencentPollAttempts);
  const pollIntervalMs = Number(merged.tencentPollIntervalMs);
  merged.tencentPollAttempts = Math.max(1, Number.isFinite(pollAttempts) ? pollAttempts : DEFAULT_SETTINGS.tencentPollAttempts);
  merged.tencentPollIntervalMs = Math.max(1000, Number.isFinite(pollIntervalMs) ? pollIntervalMs : DEFAULT_SETTINGS.tencentPollIntervalMs);

  return merged;
}

function validateSettings(settings) {
  const errors = [];
  if (!settings.apiBase) errors.push('请填写同步 API 地址');
  const hasEnabledBinding = Array.isArray(settings.bindings)
    && settings.bindings.some((item) => item && item.enabled !== false && item.status !== 'unbound' && item.token);
  if (!settings.token && !hasEnabledBinding) errors.push('请填写小程序绑定码');
  return errors;
}

function isBindingInvalidMessage(message) {
  const text = String(message || '');
  return text.includes('绑定码未绑定或已失效')
    || text.includes('Invalid bind code')
    || text.includes('Invalid or expired token')
    || text.includes('403');
}

function getPrimaryBoundToken(bindings) {
  const active = (Array.isArray(bindings) ? bindings : [])
    .find((item) => item && item.enabled !== false && item.status !== 'unbound' && item.token);
  return active ? active.token : '';
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function isRequestUrlTransportError(message) {
  const text = String(message || '');
  return text.includes('net::ERR_')
    || text.includes('ERR_CONNECTION_')
    || text.includes('ECONNRESET')
    || text.includes('ETIMEDOUT')
    || text.includes('socket hang up')
    || text.includes('NetworkError')
    || /Request failed,\s*status\s+5\d\d/i.test(text);
}

function isRequestUrlHttpStatusError(message) {
  return /Request failed,\s*status\s+\d+/i.test(String(message || ''));
}

function isInvalidCloudBaseEnvMessage(message) {
  const text = String(message || '');
  return /INVALID_ENV/i.test(text) || /Env Not Exists/i.test(text);
}

function formatSyncApiErrorMessage(payload, fallback = '') {
  const raw = String(
    (payload && (
      payload.errMsg
      || payload.message
      || (payload.error && (payload.error.message || payload.error.errMsg))
      || payload.code
    ))
    || fallback
    || '',
  );
  if (/InsufficientBalance|Function is Unavailable|AvailableStatus\s*=\s*InsufficientBalance/i.test(raw)) {
    return '云端同步服务暂时不可用：腾讯云资源包或账户余额不足，请先在腾讯云控制台续费/充值后再重试。';
  }
  return raw || '同步 API 请求失败';
}

function requestJsonViaNode(options) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(options.url);
    } catch (error) {
      reject(error);
      return;
    }

    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const body = options.body || '';
    const headers = {
      ...(options.headers || {}),
      'User-Agent': 'WeChat-Inbox-Sync-Obsidian/1.0',
    };
    if (body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const request = transport.request(parsedUrl, {
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 20000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (error) {
          json = null;
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          text,
          json,
          arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Node HTTP request timeout'));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function createAbortError(message = '当前转写已停止') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function isAbortError(error) {
  return error && (error.name === 'AbortError' || /aborted|abort|已停止|用户已停止/i.test(error.message || ''));
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw createAbortError();
  }
}

function downloadArrayBufferViaNode(url, headers = {}, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const signal = options.signal || null;
    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }

    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const request = transport.request(parsedUrl, {
      method: 'GET',
      headers,
      timeout: options.timeout || 30000,
    }, (response) => {
      const location = response.headers && response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location && redirectCount < 5) {
        response.resume();
        try {
          const nextUrl = new URL(location, url).toString();
          downloadArrayBufferViaNode(nextUrl, headers, options, redirectCount + 1).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
        return;
      }

      if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
        response.resume();
        reject(new Error(`媒体下载失败：HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      let received = 0;
      const total = Number(response.headers && response.headers['content-length']) || 0;
      response.on('data', (chunk) => {
        if (signal && signal.aborted) {
          request.destroy(createAbortError());
          return;
        }
        const buffer = Buffer.from(chunk);
        chunks.push(buffer);
        received += buffer.length;
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            received,
            total,
            percent: total > 0 ? Math.max(1, Math.min(99, Math.floor((received * 100) / total))) : null,
          });
        }
      });
      response.on('end', () => {
        if (signal && signal.aborted) {
          reject(createAbortError());
          return;
        }
        const buffer = Buffer.concat(chunks);
        if (typeof options.onProgress === 'function') {
          options.onProgress({
            received,
            total: total || received,
            percent: 100,
          });
        }
        resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      });
    });

    const abort = () => request.destroy(createAbortError());
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', abort, { once: true });
    }
    request.on('timeout', () => {
      request.destroy(new Error('媒体下载超时'));
    });
    request.on('error', reject);
    request.end();
  });
}

function getRecordId(record) {
  return record._id || record.id || '';
}

function normalizeVaultPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function normalizeYamlScalar(value) {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function getFrontmatterBlock(markdown) {
  const source = String(markdown || '').replace(/^\uFEFF/, '');
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return match ? match[1] : '';
}

function getFrontmatterScalar(markdown, fieldName) {
  const block = getFrontmatterBlock(markdown);
  if (!block || !fieldName) return '';
  const escapedField = String(fieldName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const fieldMatch = new RegExp(`^\\s*${escapedField}\\s*:\\s*(.*?)\\s*$`, 'i').exec(line);
    if (fieldMatch) return normalizeYamlScalar(fieldMatch[1]);
  }
  return '';
}

function getRecordIdFromFrontmatter(markdown) {
  return getFrontmatterScalar(markdown, 'id');
}

function getRecordIdFromHiddenMarker(markdown) {
  const match = new RegExp(`<!--\\s*${RECORD_ID_MARKER_NAME}\\s*:\\s*([\\s\\S]*?)\\s*-->`, 'i').exec(String(markdown || ''));
  return match ? normalizeYamlScalar(match[1]).replace(/-->/g, '').trim() : '';
}

function getRecordIdFromMarkdown(markdown) {
  return getRecordIdFromFrontmatter(markdown) || getRecordIdFromHiddenMarker(markdown);
}

function hasRecordIdInFrontmatter(markdown, recordId) {
  const expected = String(recordId || '').trim();
  return Boolean(expected && getRecordIdFromMarkdown(markdown) === expected);
}

function buildRecordIdMarker(recordId) {
  const id = String(recordId || '').replace(/-->/g, '').trim();
  return id ? `<!-- ${RECORD_ID_MARKER_NAME}: ${id} -->` : '';
}

function normalizeRecordUrlForCompare(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/$/, '');
  } catch (error) {
    return raw.replace(/#.*$/, '').replace(/\/$/, '');
  }
}

function hasRecordUrlInFrontmatter(markdown, recordUrl) {
  const expected = normalizeRecordUrlForCompare(recordUrl);
  if (!expected) return false;
  const actual = normalizeRecordUrlForCompare(getFrontmatterScalar(markdown, 'url'));
  return Boolean(actual && actual === expected);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getChinaTimeParts(createdAt) {
  const parsed = new Date(createdAt);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const shifted = new Date(date.getTime() + CHINA_TIME_OFFSET_MS);

  return {
    year: shifted.getUTCFullYear(),
    month: pad2(shifted.getUTCMonth() + 1),
    day: pad2(shifted.getUTCDate()),
    hour: pad2(shifted.getUTCHours()),
    minute: pad2(shifted.getUTCMinutes()),
    second: pad2(shifted.getUTCSeconds()),
  };
}

function getDateFolderName(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatCreatedTime(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getTitleTimePart(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.hour}${parts.minute}${parts.second}`;
}

function getTypeDisplayName(type) {
  const normalized = String(type || '').toLowerCase();
  if (!TYPE_DISPLAY_NAMES[normalized]) {
    throw new Error(`Unsupported record type: ${type}`);
  }
  return TYPE_DISPLAY_NAMES[normalized];
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacSha256(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function formatTencentDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function buildTencentCreateRecTaskBody({ audioUrl, engineModelType }) {
  return {
    EngineModelType: engineModelType || DEFAULT_SETTINGS.tencentEngineModelType,
    ChannelNum: 1,
    ResTextFormat: 0,
    SourceType: 0,
    Url: audioUrl,
  };
}

function buildTencentRequest({
  action,
  region,
  secretId,
  secretKey,
  body,
  timestamp = Math.floor(Date.now() / 1000),
}) {
  const payload = JSON.stringify(body || {});
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = [
    'content-type:application/json; charset=utf-8',
    `host:${TENCENT_ASR_HOST}`,
    `x-tc-action:${String(action).toLowerCase()}`,
    '',
  ].join('\n');
  const signedHeaders = 'content-type;host;x-tc-action';
  const hashedRequestPayload = sha256Hex(payload);
  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join('\n');

  const algorithm = 'TC3-HMAC-SHA256';
  const date = formatTencentDate(timestamp);
  const credentialScope = `${date}/${TENCENT_ASR_SERVICE}/tc3_request`;
  const stringToSign = [
    algorithm,
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, TENCENT_ASR_SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign, 'hex');
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${TENCENT_ASR_HOST}`,
    body: payload,
    canonicalRequest,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: TENCENT_ASR_HOST,
      'X-TC-Action': action,
      'X-TC-Version': TENCENT_ASR_VERSION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region || DEFAULT_SETTINGS.tencentRegion,
    },
  };
}

function parseTencentCreateTaskResponse(payload) {
  const data = payload && payload.Response && payload.Response.Data;
  const taskId = data && (data.TaskId || data.TaskID || data.Taskid);
  if (!taskId) {
    const error = payload && payload.Response && payload.Response.Error;
    throw new Error(error ? `${error.Code}: ${error.Message}` : '腾讯云未返回转写任务 ID');
  }
  return taskId;
}

function cleanTencentResultText(text) {
  return String(text || '')
    .replace(/^\[[^\]]+\]\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function extractOpenAICompatibleText(payload) {
  const choice = payload && payload.choices && payload.choices[0];
  const content = choice && (
    (choice.delta && choice.delta.content)
    || (choice.message && choice.message.content)
    || choice.text
  );
  if (Array.isArray(content)) {
    return content.map((part) => part.text || part.content || '').join('');
  }
  return typeof content === 'string' ? content : '';
}

function parseAliyunTranscriptionResult(responseText) {
  const text = String(responseText || '').trim();
  const dataLines = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'));

  if (dataLines.length) {
    return dataLines
      .map((line) => line.replace(/^data:\s*/, '').trim())
      .filter((line) => line && line !== '[DONE]')
      .map((line) => extractOpenAICompatibleText(tryParseJson(line)))
      .join('')
      .trim();
  }

  const payload = tryParseJson(text);
  if (payload) {
    return extractOpenAICompatibleText(payload).trim();
  }
  return text;
}

function getAudioFormatFromUrl(audioUrl) {
  const match = String(audioUrl || '').toLowerCase().match(/\.([a-z0-9]{2,5})(?:[?#]|$)/);
  if (!match && /finder\.video\.qq\.com|mpvideo/i.test(String(audioUrl || ''))) return 'mp4';
  const ext = match ? match[1] : 'mp3';
  if (['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'mp4'].includes(ext)) return ext;
  if (ext === 'm4s') return 'mp4';
  return 'mp3';
}

function bufferStartsWith(buffer, bytes) {
  if (!buffer || buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function getInvalidDownloadedMediaReason(buffer) {
  if (!buffer || buffer.length < 512) {
    return '下载到的媒体文件过小，可能不是有效音视频文件';
  }
  const headBuffer = buffer.subarray(0, Math.min(buffer.length, 256));
  const headText = headBuffer.toString('utf8').trim().toLowerCase();
  if (headText.startsWith('<!doctype') || headText.startsWith('<html') || headText.includes('<body')) {
    return '下载到的是网页内容，不是有效音视频文件';
  }
  if (headText.startsWith('{') || headText.startsWith('[')) {
    return '下载到的是接口返回数据，不是有效音视频文件';
  }
  if (
    bufferStartsWith(buffer, [0xff, 0xd8, 0xff])
    || bufferStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47])
    || bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38])
    || (bufferStartsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && buffer.subarray(8, 12).toString('ascii') === 'WEBP')
  ) {
    return '下载到的是封面图片，不是有效音视频文件';
  }
  return '';
}

const WECHAT_CHANNELS_ENCRYPTED_HEAD_BYTES = 131072;

function u64(value) {
  return BigInt.asUintN(64, value);
}

class Isaac64 {
  constructor(seed) {
    this.randrsl = new Array(256).fill(0n);
    this.mm = new Array(256).fill(0n);
    this.randcnt = 0;
    this.aa = 0n;
    this.bb = 0n;
    this.cc = 0n;
    this.randrsl[0] = u64(seed);
    this.randinit(true);
  }

  mix(a, b, c, d, e, f, g, h) {
    a = u64(a - e); f = u64(f ^ (h >> 9n)); h = u64(h + a);
    b = u64(b - f); g = u64(g ^ u64(a << 9n)); a = u64(a + b);
    c = u64(c - g); h = u64(h ^ (b >> 23n)); b = u64(b + c);
    d = u64(d - h); a = u64(a ^ u64(c << 15n)); c = u64(c + d);
    e = u64(e - a); b = u64(b ^ (d >> 14n)); d = u64(d + e);
    f = u64(f - b); c = u64(c ^ u64(e << 20n)); e = u64(e + f);
    g = u64(g - c); d = u64(d ^ (f >> 17n)); f = u64(f + g);
    h = u64(h - d); e = u64(e ^ u64(g << 14n)); g = u64(g + h);
    return [a, b, c, d, e, f, g, h];
  }

  randinit(flag) {
    let a = 0x9e3779b97f4a7c13n;
    let b = a;
    let c = a;
    let d = a;
    let e = a;
    let f = a;
    let g = a;
    let h = a;

    for (let index = 0; index < 4; index += 1) {
      [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
    }

    for (let index = 0; index < 256; index += 8) {
      if (flag) {
        a = u64(a + this.randrsl[index]);
        b = u64(b + this.randrsl[index + 1]);
        c = u64(c + this.randrsl[index + 2]);
        d = u64(d + this.randrsl[index + 3]);
        e = u64(e + this.randrsl[index + 4]);
        f = u64(f + this.randrsl[index + 5]);
        g = u64(g + this.randrsl[index + 6]);
        h = u64(h + this.randrsl[index + 7]);
      }
      [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
      this.mm[index] = a;
      this.mm[index + 1] = b;
      this.mm[index + 2] = c;
      this.mm[index + 3] = d;
      this.mm[index + 4] = e;
      this.mm[index + 5] = f;
      this.mm[index + 6] = g;
      this.mm[index + 7] = h;
    }

    if (flag) {
      for (let index = 0; index < 256; index += 8) {
        a = u64(a + this.mm[index]);
        b = u64(b + this.mm[index + 1]);
        c = u64(c + this.mm[index + 2]);
        d = u64(d + this.mm[index + 3]);
        e = u64(e + this.mm[index + 4]);
        f = u64(f + this.mm[index + 5]);
        g = u64(g + this.mm[index + 6]);
        h = u64(h + this.mm[index + 7]);
        [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
        this.mm[index] = a;
        this.mm[index + 1] = b;
        this.mm[index + 2] = c;
        this.mm[index + 3] = d;
        this.mm[index + 4] = e;
        this.mm[index + 5] = f;
        this.mm[index + 6] = g;
        this.mm[index + 7] = h;
      }
    }

    this.isaac64();
    this.randcnt = 256;
  }

  isaac64() {
    this.cc = u64(this.cc + 1n);
    this.bb = u64(this.bb + this.cc);

    for (let index = 0; index < 256; index += 1) {
      const x = this.mm[index];
      switch (index % 4) {
        case 0:
          this.aa = u64(~u64(this.aa ^ u64(this.aa << 21n)));
          break;
        case 1:
          this.aa = u64(this.aa ^ (this.aa >> 5n));
          break;
        case 2:
          this.aa = u64(this.aa ^ u64(this.aa << 12n));
          break;
        default:
          this.aa = u64(this.aa ^ (this.aa >> 33n));
          break;
      }
      this.aa = u64(this.aa + this.mm[(index + 128) % 256]);
      const y = u64(this.mm[Number((x >> 3n) & 255n)] + this.aa + this.bb);
      this.mm[index] = y;
      this.bb = u64(this.mm[Number((y >> 11n) & 255n)] + x);
      this.randrsl[index] = this.bb;
    }
  }

  next() {
    if (this.randcnt === 0) {
      this.isaac64();
      this.randcnt = 256;
    }
    this.randcnt -= 1;
    return this.randrsl[this.randcnt];
  }

  generate(length) {
    const result = Buffer.alloc(Math.max(0, Number(length) || 0));
    let position = 0;
    while (position < result.length) {
      const value = this.next();
      for (let shift = 56; shift >= 0 && position < result.length; shift -= 8) {
        result[position] = Number((value >> BigInt(shift)) & 0xffn);
        position += 1;
      }
    }
    return result;
  }
}

function parseWechatChannelsDecryptKey(decryptKey) {
  const value = String(decryptKey || '').trim();
  if (!value) return null;
  try {
    if (/^0x[0-9a-f]+$/i.test(value) || /^\d+$/.test(value)) {
      return u64(BigInt(value));
    }
  } catch (error) {
    return null;
  }
  return null;
}

function generateWechatChannelsDecryptorBytes(decryptKey, length) {
  const seed = parseWechatChannelsDecryptKey(decryptKey);
  if (seed === null) return Buffer.alloc(0);
  return new Isaac64(seed).generate(length);
}

function decryptWechatChannelsMediaBuffer(buffer, decryptKey, limit = WECHAT_CHANNELS_ENCRYPTED_HEAD_BYTES) {
  const input = Buffer.from(buffer || []);
  const seed = parseWechatChannelsDecryptKey(decryptKey);
  if (seed === null || !input.length) return input;
  const result = Buffer.from(input);
  const decryptLength = Math.min(result.length, Math.max(0, Number(limit) || 0));
  const keyBytes = new Isaac64(seed).generate(decryptLength);
  for (let index = 0; index < decryptLength; index += 1) {
    result[index] ^= keyBytes[index];
  }
  return result;
}

function buildAliyunVoiceRequest({ settings, audioUrl }) {
  return {
    model: settings.aliyunModel || DEFAULT_SETTINGS.aliyunModel,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: {
              data: audioUrl,
              format: getAudioFormatFromUrl(audioUrl),
            },
          },
          {
            type: 'text',
            text: ALIYUN_TRANSCRIPTION_PROMPT,
          },
        ],
      },
    ],
    modalities: ['text'],
    stream: true,
    stream_options: {
      include_usage: false,
    },
  };
}

function createRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildDoubaoAsrRequest({ apiKey, audioUrl, requestId = createRequestId() }) {
  return {
    url: DOUBAO_ASR_SUBMIT_URL,
    throw: false,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': DOUBAO_ASR_RESOURCE_ID,
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: {
      user: {
        uid: 'wechat-inbox-sync',
      },
      audio: {
        url: audioUrl,
        format: getAudioFormatFromUrl(audioUrl),
        codec: 'raw',
        rate: 16000,
        bits: 16,
        channel: 1,
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false,
        enable_speaker_info: true,
        enable_channel_split: false,
        show_utterances: true,
        vad_segment: false,
        sensitive_words_filter: '',
      },
    },
  };
}

function buildDoubaoAsrQueryRequest({ apiKey, requestId }) {
  return {
    url: DOUBAO_ASR_QUERY_URL,
    throw: false,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': DOUBAO_ASR_RESOURCE_ID,
      'X-Api-Request-Id': requestId,
    },
    body: {},
  };
}

function getHeader(headers, name) {
  if (!headers) return '';
  if (headers[name]) return headers[name];
  const lowerName = name.toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === lowerName);
  return key ? headers[key] : '';
}

function formatHttpError(provider, response) {
  const parts = [`${provider}请求失败：HTTP ${response && response.status}`];
  ['X-Api-Status-Code', 'X-Api-Message', 'X-Api-Request-Id'].forEach((name) => {
    const value = getHeader(response && response.headers, name);
    if (value) {
      parts.push(`${name}=${value}`);
    }
  });
  const body = String((response && (response.text || JSON.stringify(response.json || ''))) || '').trim();
  if (body) {
    parts.push(body.slice(0, 500));
  }
  return parts.join('；');
}

function normalizeDoubaoSpeakerText(result) {
  if (!result || typeof result !== 'object') return '';
  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  if (!utterances.length) return '';
  return dedupeRepeatedTranscriptionLines(utterances
    .map((item) => {
      const text = String((item && (item.text || item.result_text || item.utterance_text)) || '').trim();
      if (!text) return '';
      const additions = item && item.additions && typeof item.additions === 'object' ? item.additions : {};
      const speaker = item && (
        item.speaker
        || item.speaker_id
        || item.spk
        || item.speakerId
        || additions.speaker
        || additions.speaker_id
        || additions.spk
        || additions.speakerId
      );
      return speaker === undefined || speaker === null || speaker === ''
        ? text
        : `说话人${speaker}：${text}`;
    })
    .filter(Boolean)
    .join('\n')
    .trim());
}

function dedupeRepeatedTranscriptionLines(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return '';

  const deduped = [];
  let previousLine = '';
  for (const line of lines) {
    if (line === previousLine) {
      continue;
    } else {
      previousLine = line;
    }
    deduped.push(line);
  }
  return deduped.join('\n').trim();
}

function parseDoubaoAsrResult(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const result = data && data.result;
  if (Array.isArray(result)) {
    return dedupeRepeatedTranscriptionLines(result
      .map((item) => normalizeDoubaoSpeakerText(item) || String((item && (item.text || item.result_text || item.utterance_text)) || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim());
  }
  const speakerText = normalizeDoubaoSpeakerText(result);
  if (speakerText) return speakerText;
  const text = (result && (result.text || result.result_text))
    || (data && (data.text || data.transcription))
    || '';
  return dedupeRepeatedTranscriptionLines(String(text || '').trim());
}

function parseDoubaoAsrTaskState(response) {
  if (response.status && (response.status < 200 || response.status >= 300)) {
    throw new Error(formatHttpError('豆包语音识别', response));
  }

  const statusCode = getHeader(response.headers, 'X-Api-Status-Code');
  if (statusCode && statusCode !== '20000000') {
    if (statusCode === '20000001' || statusCode === '20000002') {
      return {
        status: 'processing',
        transcription: '',
      };
    }
    throw new Error(formatHttpError('豆包语音识别', response));
  }

  const transcription = parseDoubaoAsrResult(response.json || response.text);
  return {
    status: transcription ? 'success' : 'empty',
    transcription,
  };
}

function parseTencentTaskStatusResponse(payload) {
  const data = payload && payload.Response && payload.Response.Data;
  const error = payload && payload.Response && payload.Response.Error;
  if (error) {
    return {
      status: 3,
      statusStr: 'failed',
      transcription: '',
      errorMsg: `${error.Code}: ${error.Message}`,
    };
  }

  const status = Number(data && data.Status);
  const statusStr = String((data && data.StatusStr) || '').toLowerCase();
  return {
    status,
    statusStr,
    transcription: cleanTencentResultText(data && data.Result),
    errorMsg: (data && (data.ErrorMsg || data.ErrorMessage)) || '',
  };
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildWebpageMarkdownBody(record, title) {
  const metadata = record.metadata || {};
  const url = cleanDisplayUrl(metadata.url || record.content || '');
  const pageTitle = metadata.title || title;
  let snapshot = cleanMarkdownForStorage(
    metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '',
    { dedupe: isFeishuUrl(url), feishuTitle: isFeishuUrl(url) ? pageTitle : '' },
  );
  if (snapshot && isXiaohongshuUrl(url)) {
    snapshot = sanitizeXiaohongshuMarkdownImages(snapshot);
  }
  if (metadata.transcriptOnly && snapshot && isWechatChannelsUrl(url) && metadata.conversionStatus === 'link_saved') {
    return `${snapshot}\n`;
  }
  if (metadata.transcriptOnly) {
    const transcriptMarkdown = buildAudioTranscriptMarkdown({
      url,
      transcription: metadata.transcription || '',
      transcriptionStatus: metadata.transcriptionStatus || metadata.conversionStatus || 'pending',
      transcriptionSource: metadata.transcriptionSource || metadata.transcriptionProvider || '',
      transcriptionError: metadata.transcriptionError || metadata.conversionError || '',
    });
    return snapshot ? `${transcriptMarkdown.trim()}\n\n${snapshot}\n` : transcriptMarkdown;
  }

  const status = metadata.conversionStatus || 'pending';
  const errorText = metadata.conversionError || '';

  if (snapshot) {
    if (isFeishuUrl(url)) {
      return `${snapshot}\n`;
    }
    return [
      '## Markdown 内容',
      '',
      snapshot,
      '',
    ].join('\n');
  }

  if (status === 'failed' || status === 'wechat_captcha' || status === 'link_saved') {
    const reasonLine = status === 'wechat_captcha'
      ? '原因：微信返回了安全验证页，插件无法绕过'
      : `原因：${errorText || '网页抓取失败'}`;
    return [
      '> ⚠️ 这篇文章的正文未能自动提取，原始链接已写入笔记属性。',
      `> ${reasonLine}`,
      '',
      '---',
      '',
      '**如果这个问题持续出现，请复制以下信息发给张张（微信 heyhmjx），帮助产品改进：**',
      '',
      '```',
      `链接：${url}`,
      `错误：${errorText || '未知'}`,
      `时间：${formatCreatedTime(record.createdAt)}`,
      '```',
      '',
    ].join('\n');
  }

  // pending — 还没处理到
  return [
    '> 网页正文正在处理中，原始链接已写入笔记属性，下次同步时会自动更新。',
    '',
  ].join('\n');
}

function buildAudioTranscriptMarkdown({
  url,
  transcription,
  transcriptionStatus = 'pending',
  transcriptionSource = '',
  transcriptionError = '',
}) {
  url = cleanDisplayUrl(url);
  const status = String(transcriptionStatus || '').toLowerCase();
  const isCloudPending = ['queued', 'processing'].includes(status)
    && String(transcriptionSource || '').includes('cloud');
  const content = String(transcription || '').trim()
    || (status === 'failed'
      ? `转写失败。${transcriptionError || '未能提取到视频/音频文案。'}`
      : isCloudPending
        ? '云端转写中，下次同步会自动更新。'
        : '转写处理中，或未配置可用的转写方案。');
  return [
    '## 口播/音频文案',
    '',
    content,
    '',
  ].filter((line) => line !== '').join('\n');
}

function buildTranscriptPropertyMetadata({
  transcription = '',
  title = '',
} = {}) {
  const text = cleanMarkdownForStorage(stripMarkdownCodeBlocks(String(transcription || '')))
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return {
      description: '',
      keywords: [],
      aiMetadataSource: '',
    };
  }
  const sentences = text.split(/[。！？!?]\s*/).map((item) => item.trim()).filter((item) => item.length >= 8);
  const description = (sentences[0] || text).slice(0, 160).trim();
  const keywords = extractKeywordsFromText(text, title).slice(0, 8);
  return {
    description,
    keywords,
    aiMetadataSource: 'transcription',
  };
}

function buildTranscriptOnlyMetadata(metadata, {
  url = '',
  platform = '',
  mediaUrl = '',
  subtitleUrl = '',
  transcription = '',
  transcriptionStatus = 'failed',
  transcriptionSource = '',
  transcriptionError = '',
  conversionStatus = '',
  markdown: supplementalMarkdown = '',
} = {}) {
  const {
    markdown,
    snapshot,
    contentSnapshot,
    imageUrls,
    images,
    ...rest
  } = metadata || {};

  const sourceName = platform || getWebpageSourcePrefix(url) || '网页';
  const cleanedSupplementalMarkdown = String(supplementalMarkdown || '').trim();
  return {
    ...rest,
    title: `${sourceName}口播文案`,
    url: url || rest.url || '',
    transcriptOnly: true,
    ...(cleanedSupplementalMarkdown ? { markdown: cleanedSupplementalMarkdown } : {}),
    mediaUrl,
    audioUrl: mediaUrl,
    subtitleUrl,
    transcription,
    transcriptionStatus,
    transcriptionSource,
    transcriptionError,
    conversionStatus: conversionStatus || transcriptionStatus,
  };
}

function shouldGenerateAiMetadata(settings, record) {
  if (!record || !record.metadata) return false;
  const metadata = record.metadata || {};
  if (!extractAiMetadataInputText(record)) return false;
  if (String(record.type || '').toLowerCase() === 'webpage' || String(record.type || '').toLowerCase() === 'link') {
    return true;
  }
  return !getRecordDescription(metadata) || !getRecordKeywords(metadata).length;
}

function shouldRequireAiMetadataForTranscript(record) {
  const metadata = (record && record.metadata) || {};
  const type = String(record && record.type || '').toLowerCase();
  return Boolean(
    metadata.transcriptionStatus === 'success'
    && String(metadata.transcription || '').trim()
    && extractAiMetadataInputText(record)
    && (
      metadata.transcriptOnly
      || metadata.webpageMediaType === 'audio_video'
      || type === 'voice'
      || (type === 'file' && metadata.transcriptionSource)
    ),
  );
}

function buildFileMarkdownBody(record) {
  const metadata = record.metadata || {};
  const fileName = metadata.fileName || record.content || 'upload-file';
  const fileID = metadata.fileID || '';
  const filePath = metadata.filePath || '';
  const converted = cleanMarkdownForStorage(metadata.markdown || metadata.convertedMarkdown || '');
  const status = metadata.conversionStatus || 'pending';
  const errorText = metadata.conversionError || '';
  const transcriptionStatus = String(metadata.transcriptionStatus || '').toLowerCase();
  const transcription = String(metadata.transcription || '').trim();
  if (transcriptionStatus || transcription) {
    const transcriptionError = metadata.transcriptionError || '';
    const content = transcription || (transcriptionStatus === 'failed'
      ? `转写失败。${transcriptionError || '未能提取到音视频文案。'}`
      : '转写处理中，或未配置可用的转写方案。');
    return [
      `文件名：${fileName}`,
      filePath ? `本地附件：[[${filePath}]]` : '',
      fileID ? `云端文件：${fileID}` : '',
      metadata.transcriptionSource ? `转写来源：${metadata.transcriptionSource}` : '',
      '',
      '## 口播/音频文案',
      '',
      content,
      '',
    ].filter((line) => line !== '').join('\n');
  }
  const fallback = status === 'failed'
    ? `文件转 Markdown 失败，已保存文件信息。${errorText ? `\n\n失败原因：${errorText}` : ''}`
    : status === 'attachment_saved'
      ? `文件附件已保存。${errorText ? `\n\n说明：${errorText}` : '暂未提取到可用正文。'}`
    : '文件转 Markdown 处理中，已先保存文件信息。';

  return [
    `文件名：${fileName}`,
    filePath ? `本地附件：[[${filePath}]]` : '',
    fileID ? `云端文件：${fileID}` : '',
    '',
    '## Markdown 内容',
    '',
    converted || fallback,
    '',
  ].filter((line) => line !== '').join('\n');
}

function cleanMarkdownForStorage(markdown, options = {}) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const seen = new Map();
  let lastWasBlank = true;
  let pendingListMarker = '';
  let inFence = false;
  let skippedFeishuOpeningOutline = false;
  let feishuOpeningOutlineCount = 0;
  let feishuOpeningContentStarted = false;

  lines.forEach((line) => {
    const rawLine = String(line || '').replace(/\u200b/g, '').replace(/\ufeff/g, '');
    if (/^\s*```/.test(rawLine)) {
      out.push(rawLine.trim());
      inFence = !inFence;
      lastWasBlank = false;
      pendingListMarker = '';
      return;
    }
    if (inFence) {
      out.push(rawLine);
      lastWasBlank = false;
      return;
    }

    let text = String(line || '')
      .replace(/\u200b/g, '')
      .replace(/\ufeff/g, '')
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
      .replace(/&quot;/g, '"')
      .trim();

    if (options.feishuTitle) {
      text = normalizeFeishuMarkdownLine(text, options.feishuTitle);
    }

    if (!text) {
      if (pendingListMarker) {
        return;
      }
      if (!lastWasBlank && out.length) {
        out.push('');
        lastWasBlank = true;
      }
      return;
    }

    if (options.feishuTitle && shouldDropFeishuLine(text, options.feishuTitle) && !isFeishuCodeLanguageLine(text)) {
      return;
    }

    if (options.feishuTitle && !feishuOpeningContentStarted && /^-\s+/.test(text)) {
      feishuOpeningOutlineCount += 1;
      if (feishuOpeningOutlineCount >= 3 || skippedFeishuOpeningOutline) {
        skippedFeishuOpeningOutline = true;
        return;
      }
    } else if (text && !/^!\[/.test(text)) {
      if (!/^#{1,6}\s+/.test(text) && !/^-\s+/.test(text) && text.length >= 12 && /[。！？.!?]/.test(text)) {
        feishuOpeningContentStarted = true;
      }
    }

    if (/^\d+\.$/.test(text) || /^[•·]$/.test(text)) {
      pendingListMarker = text === '•' || text === '·' ? '-' : text;
      return;
    }

    if (pendingListMarker) {
      text = `${pendingListMarker} ${text}`;
      pendingListMarker = '';
    }

    if (options.feishuTitle) {
      text = formatFeishuHeadingLine(text, options.feishuTitle);
    }

    if (options.dedupe && !text.startsWith('|')) {
      const key = text
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ');
      const maxRepeats = Array.from(key).length <= 3 ? 2 : 1;
      const count = seen.get(key) || 0;
      if (count >= maxRepeats) {
        return;
      }
      seen.set(key, count + 1);
    }

    out.push(text);
    lastWasBlank = false;
  });

  let cleaned = restoreFlattenedSarBandTables(out).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (options.feishuTitle) {
    cleaned = postProcessFeishuMarkdown(cleaned, options.feishuTitle);
  }
  return cleaned;
}

function stripMarkdownCodeBlocks(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
}

function normalizeGeneratedKeywords(value) {
  const source = Array.isArray(value) ? value.join(',') : String(value || '');
  const seen = new Set();
  return source
    .replace(/[\r\n]+/g, ',')
    .split(/[#,，,、；;\s]+/)
    .map((item) => String(item || '').trim())
    .filter((item) => item && item.length <= 24)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseGeneratedMetadataResponse(text) {
  const source = String(text || '').trim();
  if (!source) return { description: '', keywords: [] };

  const fencedJsonMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonSource = fencedJsonMatch ? fencedJsonMatch[1].trim() : source;
  const jsonPayload = tryParseJson(jsonSource);
  if (jsonPayload && typeof jsonPayload === 'object') {
    return {
      description: String(jsonPayload.description || jsonPayload.summary || jsonPayload.excerpt || '').trim(),
      keywords: normalizeGeneratedKeywords(jsonPayload.keywords || jsonPayload.tags || jsonPayload.hashtags || []),
    };
  }

  const descriptionMatch = source.match(/description\s*[:：]\s*([^\n]+)/i)
    || source.match(/简介\s*[:：]\s*([^\n]+)/i)
    || source.match(/总结\s*[:：]\s*([^\n]+)/i);
  const keywordsMatch = source.match(/keywords?\s*[:：]\s*([^\n]+)/i)
    || source.match(/标签\s*[:：]\s*([^\n]+)/i)
    || source.match(/关键词\s*[:：]\s*([^\n]+)/i);
  return {
    description: String(descriptionMatch ? descriptionMatch[1] : '').trim(),
    keywords: normalizeGeneratedKeywords(keywordsMatch ? keywordsMatch[1] : ''),
  };
}

function normalizeGeneratedMetadataResult(result) {
  return {
    description: String(result && result.description || '').trim().slice(0, 300),
    keywords: normalizeGeneratedKeywords(result && result.keywords),
  };
}

function extractAiMetadataInputText(record) {
  const metadata = (record && record.metadata) || {};
  const isTranscriptRecord = metadata.transcriptOnly
    || metadata.webpageMediaType === 'audio_video'
    || (
      metadata.transcriptionStatus === 'success'
      && String(metadata.transcription || '').trim()
    );
  const parts = isTranscriptRecord
    ? [
      metadata.title,
      metadata.transcription,
    ].filter(Boolean)
    : [
      metadata.title,
      metadata.markdown,
      metadata.snapshot,
      metadata.contentSnapshot,
      metadata.description,
      metadata.summary,
      metadata.excerpt,
    ].filter(Boolean);
  return cleanMarkdownForStorage(
    stripMarkdownCodeBlocks(parts.join('\n\n'))
      .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/https?:\/\/[^\s<>()\]]+/gi, ' ')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^\s*>\s*/gm, '')
      .replace(/\n{3,}/g, '\n\n'),
  ).slice(0, 6000);
}

function normalizeTitleForCompare(text) {
  return String(text || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[-–—]\s*飞书云文档\s*$/i, '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeFeishuMarkdownLine(line) {
  return String(line || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/^-\s*$/, '')
    .replace(/^-\s+/, '- ')
    .replace(/^Plain Text复制$/i, '')
    .replace(/^代码块$/i, '')
    .trim();
}

function shouldDropFeishuLine(line, title) {
  const text = String(line || '').trim();
  if (!text) return true;
  const plainText = text.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').trim();
  const normalized = normalizeTitleForCompare(text);
  const normalizedTitle = normalizeTitleForCompare(title);
  const noise = new Set([
    '飞书云文档',
    '与我分享',
    '登录/注册',
    '帮助中心',
    '效率指南',
    '添加快捷方式',
    '最近修改',
    '搜索',
    '墨度',
    '莞尔',
    '分享',
    '回复...',
    '附件不支持打印',
    '上传日志',
    '联系客服',
    '功能更新',
    'header-v2',
    '评论（0）',
    '跳转至首条评论',
    'Plain Text',
    'Plain Text复制',
    '复制',
    'Bash',
    '重播',
    '播放',
    '直播',
    '进入全屏',
    '画中画',
    '原画',
    '点击按住可拖动视频',
    '星辰大海',
    '蟹',
    '蟹老板-老王1',
    '正在以画中画形式播放',
    '语句划分',
    '音频时长核定',
    '画面规划',
    '画面代码审查',
    '多AIAGENT优化',
    '人点赞',
  ]);
  if (noise.has(text) || noise.has(plainText)) return true;
  if (/^\d{1,3}%$/.test(plainText)) return true;
  if (/^\d+(?:\.\d+)?\s*(?:KB|MB|GB)$/i.test(plainText)) return true;
  if (/^(?:-\s*)?\d{3,4}p$/i.test(plainText)) return true;
  if (/^(?:-\s*)?\d+(?:\.\d+)?x$/i.test(plainText)) return true;
  if (/^\d{1,2}月\d{1,2}日修改$/.test(plainText)) return true;
  if (/^(?:\d{1,2}:\d{2}|\/|[0-9]+(?:\.[0-9]+)?x)$/.test(plainText)) return true;
  if (/^\S{1,30}的云文档$/.test(plainText)) return true;
  if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]+$/u.test(plainText)) return true;
  if (normalizedTitle && normalized.includes(normalizedTitle) && normalized !== normalizedTitle && normalized.length <= normalizedTitle.length + 24) return true;
  if (/添加快捷方式\s*最近修改\s*[:：]?/.test(text)) return true;
  if (/^最近修改\s*[:：]?/.test(text)) return true;
  if (/^你可能还想问/.test(text)) return true;
  if (/^查询.*更多相关内容$/.test(text)) return true;
  if (/^推荐内容由\s*AI\s*生成$/i.test(text)) return true;
  if (/^加载中/.test(text)) return true;
  if (/^本文暂未(?:引用|被).*文档/.test(text)) return true;
  if (/^取消发送$/.test(text)) return true;
  if (/^\d+\s*人点赞$/.test(text)) return true;
  if (/^-\s+.+\s-\s+.+/.test(text) && text.length > 40) return true;
  if (/^-\s*(?:上传日志|联系客服|功能更新|帮助中心|效率指南)$/.test(text)) return true;
  if (/^-\s*(?:第[一二三四五六七八九十\d]+(?:次|个)?风口|规律：|什么是|举个例子|知识付费|最后|第[一二三四五六七八九十\d]+[步层：])/.test(text)) return true;
  if (/^图\s*\d+$/i.test(text)) return true;
  if (/^\d{1,2}$/.test(text)) return true;
  if (/^\+\d+$/.test(text)) return true;
  if (/^共有\s*\d+\s*个协作者$/.test(text)) return true;
  if (/^最近修改\s*[:：]?\s*/.test(text)) return true;
  if (/^昨天\s*\d{1,2}:\d{2}$/.test(text)) return true;
  if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(text)) return true;
  if (/^最新修改时间为/.test(text)) return true;
  if (/^\d+\s*字$/.test(text)) return true;
  if (/^评论/.test(text)) return true;
  if (/^[春壹始]$/.test(text)) return true;
  if (/^[\u4e00-\u9fa5]{1,4}$/.test(text) && /(?:斤|斧|淇|钖|作者|头像)/.test(text)) return true;
  if (/成长笔记(?:昨天\s*\d{1,2}:\d{2})?$/.test(text)) return true;
  if (/^春树.*云文档$/.test(text)) return true;
  if (normalizedTitle && normalized === normalizedTitle) return true;
  return false;
}

function formatFeishuHeadingLine(line) {
  const text = String(line || '').trim();
  if (/^#\s+(?:创建项目|或者克隆|应输出)/.test(text)) return `\\${text}`;
  if (/^#{1,6}\s+/.test(text) || /^!\[/.test(text) || /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text)) {
    return text;
  }
  const numericSection = text.match(/^(\d+)\.(\d{1,3})(.+)$/);
  if (numericSection && Number(numericSection[1]) <= 6 && !/^(?:[+]|MB|GB|KB|（推荐|推荐)/i.test(numericSection[3].trim())) {
    return numericSection[2].length >= 2 ? `### ${text}` : `## ${text}`;
  }
  const length = Array.from(text).length;
  if (length >= 4 && length <= 34) {
    if (/^[一二三四五六七八九十]+[、.．]\s*.+/.test(text)) return `# ${text}`;
    if (/^[（(]\d+[）)]\s*.+/.test(text)) return `### ${text}`;
    if (/^\d{4}年之前，我没有任何目标$/.test(text)) return `## ${text}`;
    if (/^(第[一二三四五六七八九十\d]+[、.．]?\s*)?[^，。！？!?]{0,16}风口[：:]/.test(text)) return `## ${text}`;
    if (/^(什么是.+原理|举个例子|最后|知识付费的下一个形态)$/.test(text)) return `## ${text}`;
    if (/^第[一二三四五六七八九十\d]+[步层：:]/.test(text)) return `### ${text}`;
  }
  return text;
}

function isFeishuTocBulletLine(line) {
  const text = String(line || '').trim().replace(/^[-*]\s+/, '');
  return /^[一二三四五六七八九十]+[、.．]/.test(text)
    || /^\d+\.\d/.test(text)
    || /^[（(]\d+[）)]/.test(text)
    || /^第[一二三四五六七八九十\d]+[步层：:]/.test(text)
    || /^.+(?:成果|经验|收获|流程|配置|安装|教学|优化|什么|想法|视频|画面|审查|制作|下一步).*$/.test(text);
}

function removeFeishuTocBlocks(lines) {
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    if (!/^[-*]\s+/.test(line.trim())) {
      output.push(line);
      continue;
    }
    const block = [];
    let cursor = index;
    while (cursor < lines.length && /^[-*]\s+/.test(String(lines[cursor] || '').trim())) {
      block.push(String(lines[cursor] || ''));
      cursor += 1;
    }
    const tocCount = block.filter(isFeishuTocBulletLine).length;
    if (block.length >= 4 && tocCount >= Math.ceil(block.length * 0.65)) {
      index = cursor - 1;
      continue;
    }
    output.push(...block);
    index = cursor - 1;
  }
  return output;
}

function repairFeishuMarkdownTables(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = String(lines[index] || '').trim();
    if (current === '|') continue;
    const nextNonBlank = [];
    let scan = index;
    while (scan < lines.length && nextNonBlank.length < 8) {
      const value = String(lines[scan] || '').trim();
      if (value && value !== '|') nextNonBlank.push({ value, index: scan });
      scan += 1;
    }
    let headers = null;
    let separatorPattern = null;
    if (
      current === '组件'
      && nextNonBlank.some((item) => item.value === '要求')
      && nextNonBlank.some((item) => item.value === '说明')
    ) {
      headers = ['组件', '要求', '说明'];
      separatorPattern = /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|$/;
    } else if (
      current === '序号'
      && nextNonBlank.some((item) => item.value === '版本')
      && nextNonBlank.some((item) => item.value === '用途')
      && nextNonBlank.some((item) => item.value === '是否必须')
    ) {
      headers = ['序号', '版本', '用途', '是否必须'];
      separatorPattern = /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*(?:\|\s*---\s*)?\|$/;
    }
    if (!headers || !nextNonBlank.some((item) => separatorPattern.test(item.value))) {
      output.push(lines[index]);
      continue;
    }

    const separator = nextNonBlank.find((item) => separatorPattern.test(item.value));
    const cells = [];
    let cursor = separator.index + 1;
    while (cursor < lines.length) {
      const value = String(lines[cursor] || '').trim();
      if (!value) {
        cursor += 1;
        continue;
      }
      if (value === '|' || /^#{1,6}\s+/.test(value) || /^!\[/.test(value) || /^\[[^\]]+]\(/.test(value)) break;
      if (headers.includes(value) && cells.length) break;
      if (shouldDropFeishuLine(value, '')) {
        cursor += 1;
        continue;
      }
      cells.push(value.replace(/\|/g, '\\|'));
      cursor += 1;
      if (cells.length >= 30) break;
    }
    const rows = [];
    for (let cellIndex = 0; cellIndex + headers.length - 1 < cells.length; cellIndex += headers.length) {
      rows.push(cells.slice(cellIndex, cellIndex + headers.length));
    }
    if (rows.length) {
      output.push(`| ${headers.join(' | ')} |`);
      output.push(`| ${headers.map(() => '---').join(' | ')} |`);
      rows.forEach((row) => output.push(`| ${row.join(' | ')} |`));
      index = Math.max(index, cursor - 1);
      continue;
    }
    output.push(lines[index]);
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function removeFeishuResidualTableLines(markdown) {
  const residue = new Set(['组件', '要求', '说明', 'CPU', '内存', '硬盘', '序号', '版本', '用途', '是否必须']);
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  let recentlySawTable = 0;
  lines.forEach((line) => {
    const text = String(line || '').trim();
    if (/^\|.+\|$/.test(text)) {
      recentlySawTable = 8;
      output.push(line);
      return;
    }
    if (recentlySawTable > 0 && residue.has(text)) {
      recentlySawTable -= 1;
      return;
    }
    if (recentlySawTable > 0) recentlySawTable -= 1;
    output.push(line);
  });
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isFeishuCodeLanguageLine(line) {
  return /^(?:Bash|Shell|PowerShell|JavaScript|TypeScript|Python|JSON|YAML|HTML|CSS)$/i.test(String(line || '').trim());
}

function isFeishuCommandLikeLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^#\s+/.test(text)) return true;
  if (/^\\#\s+/.test(text)) return true;
  if (/^(?:npx|npm|pnpm|yarn|node|python|pip|conda|ffmpeg|git|cd|mkdir|curl|brew|uv|powershell|pwsh|setx|export)\b/i.test(text)) return true;
  if (/^(?:[A-Za-z]:\\|\.\/|\.\.\/|~\/)/.test(text)) return true;
  if (/^[A-Z_][A-Z0-9_]*=/.test(text)) return true;
  return false;
}

function isFeishuNarrativeAfterCode(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (/^#{1,6}\s+/.test(text) || /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text) || /^\|.+\|$/.test(text)) return true;
  return /[。！？；：]$/.test(text) || /^[\u4e00-\u9fa5].{4,}$/.test(text);
}

function formatFeishuCodeBlocks(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = String(lines[index] || '').trim();
    if (!isFeishuCodeLanguageLine(current)) {
      output.push(lines[index]);
      continue;
    }
    const language = current.toLowerCase() === 'bash' || current.toLowerCase() === 'shell' ? 'bash' : current.toLowerCase();
    const codeLines = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const value = String(lines[cursor] || '').trim();
      if (!value) {
        cursor += 1;
        continue;
      }
      if (isFeishuCodeLanguageLine(value) || /^```/.test(value) || /^#{1,6}\s+/.test(value) || /^\|.+\|$/.test(value)) break;
      if (isFeishuCommandLikeLine(value)) {
        codeLines.push(value.replace(/^\\#/, '#'));
        cursor += 1;
        continue;
      }
      if (codeLines.length && isFeishuNarrativeAfterCode(value)) break;
      if (!codeLines.length) break;
      codeLines.push(value.replace(/^\\#/, '#'));
      cursor += 1;
    }
    if (!codeLines.length) {
      output.push(lines[index]);
      continue;
    }
    if (output.length && String(output[output.length - 1] || '').trim()) output.push('');
    output.push(`\`\`\`${language}`);
    output.push(...codeLines);
    output.push('```');
    output.push('');
    index = cursor - 1;
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isFeishuRecommendationTitleLine(line) {
  const text = String(line || '').trim();
  if (!text || /^#{1,6}\s+/.test(text) || /^[-*]\s+/.test(text) || /^\|.+\|$/.test(text) || /^!\[/.test(text) || /^\[[^\]]+]\(/.test(text)) return false;
  if (text.length < 8 || text.length > 80) return false;
  if (/[。！？；：]$/.test(text)) return false;
  return /(?:REMOTION|Remotion|AI|Agent|Hermes|Qwen|TTS|部署|教程|经验|分享|方法|踩坑|实操|策略|指南)/i.test(text);
}

function trimFeishuTrailingRecommendations(lines) {
  const source = Array.isArray(lines) ? lines.slice() : [];
  let lastContentIndex = source.length - 1;
  while (lastContentIndex >= 0 && !String(source[lastContentIndex] || '').trim()) lastContentIndex -= 1;
  if (lastContentIndex < 0) return source;
  let start = lastContentIndex;
  while (start >= 0 && isFeishuRecommendationTitleLine(source[start])) start -= 1;
  const count = lastContentIndex - start;
  if (count >= 3) return source.slice(0, start + 1);
  return source;
}

function hasFeishuDanglingTableTail(lines) {
  const source = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  if (source.length < 10) return false;
  const joined = source.join('\n');
  if (!/(?:安装清单总览|逐步安装指南|配置要求|以下是所有需要安装的软件和工具)/.test(joined)) return false;
  const tail = source.slice(-18);
  const shortFragmentCount = tail.filter((line) => {
    if (/^#{1,6}\s+/.test(line) || /^[-*]\s+/.test(line) || /^!\[/.test(line)) return false;
    if (/[。！？；：]$/.test(line)) return false;
    return line.length <= 28;
  }).length;
  const toolFragmentCount = tail.filter((line) => /^(?:Node\.js|npm|FFmpeg|Python|Conda|CUDA Toolkit|Remotion|v?\d|必须|推荐|用途|版本|序号|是否必须)/i.test(line)).length;
  return shortFragmentCount >= 8 && toolFragmentCount >= 4;
}

function isFeishuMarkdownLikelyTruncated(markdown) {
  const lines = String(markdown || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const trimmed = trimFeishuTrailingRecommendations(lines);
  if (trimmed.length <= lines.length - 3) return true;
  if (hasFeishuDanglingTableTail(lines)) return true;
  if (lines.length < 20) return false;
  const lastHeadingIndex = lines.map((line, index) => (/^#{1,6}\s+/.test(line) ? index : -1)).filter((index) => index >= 0).pop() ?? -1;
  const tail = lines.slice(Math.max(0, lines.length - 12));
  return lastHeadingIndex >= 0
    && lines.length - lastHeadingIndex < 12
    && tail.filter(isFeishuRecommendationTitleLine).length >= 3;
}

function postProcessFeishuMarkdown(markdown, title = '') {
  let lines = String(markdown || '').split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line && (!shouldDropFeishuLine(line, title) || isFeishuCodeLanguageLine(line)));
  const commentsIndex = lines.findIndex((line) => /^(?:真诚点赞，手留余香|全文评论)$/.test(line));
  if (commentsIndex >= 0) {
    lines = lines.slice(0, commentsIndex);
  }
  lines = removeFeishuTocBlocks(lines);
  lines = lines.map((line) => {
    if (/^[-*]\s+读完这篇/.test(line)) return line.replace(/^[-*]\s+/, '# ');
    if (/^[-*]\s+/.test(line) && isFeishuTocBulletLine(line)) return '';
    return formatFeishuHeadingLine(line);
  }).filter(Boolean);
  lines = trimFeishuTrailingRecommendations(lines);
  return formatFeishuCodeBlocks(removeFeishuResidualTableLines(repairFeishuMarkdownTables(lines.join('\n')))).replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeAttachmentName(fileName, fallbackName) {
  const text = String(fileName || fallbackName || 'upload-file').trim();
  return (text || 'upload-file').replace(/[\\/:*?"<>|]/g, '-');
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const body = match[3] || '';
  const buffer = match[2]
    ? Buffer.from(body, 'base64')
    : Buffer.from(decodeURIComponent(body), 'utf8');
  return { mimeType, buffer };
}

function getImageExtFromMime(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('svg')) return 'svg';
  return 'png';
}

function getImageExtFromBuffer(buffer, fallbackUrl = '') {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (data.length >= 8
    && data[0] === 0x89
    && data[1] === 0x50
    && data[2] === 0x4e
    && data[3] === 0x47) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length >= 6 && data.slice(0, 6).toString('ascii').startsWith('GIF')) return 'gif';
  if (data.length >= 12 && data.slice(0, 4).toString('ascii') === 'RIFF' && data.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return getImageFileExtension(fallbackUrl) || 'png';
}

function getAttachmentExt(fileName, fallbackExt) {
  const fromName = String(fileName || '').split('.').pop();
  const ext = String(fallbackExt || fromName || '').toLowerCase().replace(/^\./, '');
  return ext === String(fileName || '').toLowerCase() ? '' : ext;
}

function isMarkdownConvertibleExt(ext) {
  return ['md', 'markdown', 'txt'].includes(String(ext || '').toLowerCase());
}

function isAudioVideoAttachmentExt(ext) {
  return ['mp3', 'm4a', 'wav', 'aac', 'amr', 'silk', 'ogg', 'flac', 'mp4', 'mov', 'm4v'].includes(String(ext || '').toLowerCase());
}

function decodeUtf8ArrayBuffer(buffer) {
  return toNodeBuffer(buffer).toString('utf8');
}

function toNodeBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  return Buffer.from(data || []);
}

function decodeUtf16Be(buffer) {
  const chunks = [];
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    chunks.push(String.fromCharCode(buffer.readUInt16BE(index)));
  }
  return chunks.join('');
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function inflateZipEntry(buffer, method) {
  if (method === 0) return buffer;
  if (method === 8) return zlib.inflateRawSync(buffer);
  throw new Error(`暂不支持的 docx 压缩方式：${method}`);
}

function readZipEntries(bufferLike) {
  const buffer = toNodeBuffer(bufferLike);
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65558);
  for (let index = buffer.length - 22; index >= minOffset; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error('未找到 docx 压缩包目录');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('docx 压缩包目录格式异常');
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
    entries.set(fileName, inflateZipEntry(compressed, method));

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function extractDocxMarkdown(bufferLike) {
  const entries = readZipEntries(bufferLike);
  const documentXml = entries.get('word/document.xml');
  if (!documentXml) {
    throw new Error('docx 中没有找到 word/document.xml');
  }

  const xml = documentXml.toString('utf8');
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  const lines = paragraphs.map((paragraph) => {
    const isHeading = /<w:pStyle[^>]+w:val=["']Heading([1-6])["']/i.exec(paragraph);
    const text = decodeXmlEntities(paragraph
      .replace(/<w:tab\s*\/>/g, '\t')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<w:t[^>]*>/g, '')
      .replace(/<\/w:t>/g, '')
      .replace(/<[^>]+>/g, ''))
      .replace(/[ \t]+\n/g, '\n')
      .trim();

    if (!text) return '';
    if (isHeading) {
      return `${'#'.repeat(Math.min(Number(isHeading[1]), 6))} ${text}`;
    }
    return text;
  }).filter(Boolean);

  if (!lines.length) {
    throw new Error('docx 正文为空，未提取到文本');
  }

  return lines.join('\n\n');
}

function decodePdfBytes(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeUtf16Be(buffer.slice(2));
  }

  let zeroEven = 0;
  for (let index = 0; index < Math.min(buffer.length, 80); index += 2) {
    if (buffer[index] === 0) zeroEven += 1;
  }
  if (zeroEven > 4) {
    return decodeUtf16Be(buffer);
  }

  return buffer.toString('utf8');
}

function decodePdfLiteralString(value) {
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\\') {
      bytes.push(char.charCodeAt(0) & 0xff);
      continue;
    }

    const next = value[index + 1];
    if (!next) break;
    index += 1;
    if (next === 'n') bytes.push(10);
    else if (next === 'r') bytes.push(13);
    else if (next === 't') bytes.push(9);
    else if (next === 'b') bytes.push(8);
    else if (next === 'f') bytes.push(12);
    else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let count = 0; count < 2 && /[0-7]/.test(value[index + 1]); count += 1) {
        index += 1;
        octal += value[index];
      }
      bytes.push(parseInt(octal, 8));
    } else {
      bytes.push(next.charCodeAt(0) & 0xff);
    }
  }
  return decodePdfBytes(Buffer.from(bytes));
}

function decodePdfHexString(value, cmap) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '');
  if (!hex) return '';
  if (cmap && cmap.size) {
    const mapped = applyPdfCMap(hex, cmap);
    if (mapped) return mapped;
  }
  const normalized = hex.length % 2 ? `${hex}0` : hex;
  return decodePdfBytes(Buffer.from(normalized, 'hex'));
}

function unicodeFromPdfHex(hex) {
  const buffer = Buffer.from(String(hex || '').replace(/[^0-9a-f]/gi, ''), 'hex');
  if (!buffer.length) return '';
  if (buffer.length >= 2) return decodeUtf16Be(buffer);
  return buffer.toString('utf8');
}

function parsePdfCMap(content, cmap) {
  const source = String(content || '');
  let section;
  const bfcharPattern = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((section = bfcharPattern.exec(source))) {
    const pairPattern = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
    let pair;
    while ((pair = pairPattern.exec(section[1]))) {
      cmap.set(pair[1].toUpperCase(), unicodeFromPdfHex(pair[2]));
    }
  }

  const bfrangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((section = bfrangePattern.exec(source))) {
    const rangePattern = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+(<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
    let range;
    while ((range = rangePattern.exec(section[1]))) {
      const start = parseInt(range[1], 16);
      const end = parseInt(range[2], 16);
      const width = range[1].length;
      if (range[4]) {
        let target = parseInt(range[4], 16);
        for (let code = start; code <= end; code += 1) {
          cmap.set(code.toString(16).toUpperCase().padStart(width, '0'), unicodeFromPdfHex(target.toString(16).padStart(range[4].length, '0')));
          target += 1;
        }
      } else if (range[5]) {
        const values = [...range[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((item) => item[1]);
        values.forEach((value, index) => {
          cmap.set((start + index).toString(16).toUpperCase().padStart(width, '0'), unicodeFromPdfHex(value));
        });
      }
    }
  }
}

function buildPdfCMap(streams) {
  const cmap = new Map();
  streams.forEach((stream) => {
    if (String(stream || '').includes('beginbfchar') || String(stream || '').includes('beginbfrange')) {
      parsePdfCMap(stream, cmap);
    }
  });
  return cmap;
}

function applyPdfCMap(hex, cmap) {
  const source = String(hex || '').toUpperCase();
  const keyLengths = [...new Set([...cmap.keys()].map((key) => key.length))].sort((a, b) => b - a);
  const out = [];
  let index = 0;

  while (index < source.length) {
    let matched = false;
    for (const length of keyLengths) {
      const part = source.slice(index, index + length);
      if (cmap.has(part)) {
        out.push(cmap.get(part));
        index += length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push(decodePdfBytes(Buffer.from(source.slice(index, index + 2), 'hex')));
      index += 2;
    }
  }

  return out.join('').replace(/\0/g, '').trim();
}

function extractPdfTextFromContent(content, cmap) {
  const chunks = [];
  const literalPattern = /\((?:\\.|[^\\()])*\)\s*Tj/g;
  const hexPattern = /<([0-9a-fA-F\s]+)>\s*Tj/g;
  const arrayPattern = /\[(.*?)\]\s*TJ/gs;

  let match;
  while ((match = literalPattern.exec(content))) {
    chunks.push(decodePdfLiteralString(match[0].replace(/\s*Tj$/, '').slice(1, -1)));
  }
  while ((match = hexPattern.exec(content))) {
    chunks.push(decodePdfHexString(match[1], cmap));
  }
  while ((match = arrayPattern.exec(content))) {
    const arrayBody = match[1];
    const parts = arrayBody.match(/\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>/g) || [];
    parts.forEach((part) => {
      if (part.startsWith('(')) chunks.push(decodePdfLiteralString(part.slice(1, -1)));
      else chunks.push(decodePdfHexString(part.slice(1, -1), cmap));
    });
  }

  return chunks
    .map((text) => text.replace(/\0/g, '').trim())
    .filter((text) => text && /[\p{L}\p{N}\u4e00-\u9fff]/u.test(text))
    .join('\n');
}

function isPdfMicroLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^[-*+]\s+/.test(text)) return false;
  const compact = text.replace(/\s+/g, '');
  return Array.from(compact).length <= 2;
}

function shouldJoinPdfLines(previous, next) {
  const left = String(previous || '').trim();
  const right = String(next || '').trim();
  if (!left || !right) return false;
  if (/^#{1,6}\s+/.test(left) || /^#{1,6}\s+/.test(right)) return false;
  if (/^[-*+]\s+/.test(left) || /^[-*+]\s+/.test(right)) return false;
  if (/^\d{1,3}[.)、]\s*/.test(right)) return false;
  if (/[。！？!?；;：:]$/.test(left)) return false;
  if (/^[,，.。!?！？;；:：)]/.test(right)) return true;
  return /[\p{L}\p{N}\u4e00-\u9fff]$/u.test(left) && /^[\p{L}\p{N}\u4e00-\u9fff]/u.test(right);
}

function getPdfLineJoiner(previous, next) {
  const left = String(previous || '').trim();
  const right = String(next || '').trim();
  if (!left || !right) return '';
  if (/^[,，.。!?！？;；:：)]/.test(right)) return '';
  if (/[\u4e00-\u9fff]$/u.test(left) && /^[\u4e00-\u9fff]/u.test(right)) return '';
  if (/\b[A-Z]{1,8}$/u.test(left) && /^[A-Z]\b/u.test(right)) return '';
  return ' ';
}

function mergePdfWrappedLines(lines) {
  const merged = [];
  (lines || []).forEach((line) => {
    const current = String(line || '').trim();
    if (!current) {
      if (merged.length && merged[merged.length - 1] !== '') merged.push('');
      return;
    }

    const previous = merged[merged.length - 1];
    if (previous && shouldJoinPdfLines(previous, current)) {
      merged[merged.length - 1] = `${previous}${getPdfLineJoiner(previous, current)}${current}`;
      return;
    }

    merged.push(current);
  });
  return merged;
}

function isLowQualityPdfExtraction(text) {
  const source = String(text || '');
  const compact = source.replace(/\s+/g, '');
  if (!compact) return true;
  const controlCount = (source.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
  if (controlCount > 3) return true;
  if (/[锟�]/.test(source)) return true;

  const cjkCount = (compact.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjkCount >= 2) return false;
  const latinWordCount = (source.match(/[A-Za-z]{2,}/g) || []).length;
  const readableCount = cjkCount + latinWordCount * 2;
  return readableCount < 4;
}

function isSuspectPdfGlyphEncoding(text) {
  const source = String(text || '');
  const latinWords = source.match(/[A-Za-z]{12,}/g) || [];
  const longLatinWords = latinWords.filter((word) => word.length >= 18);
  const knownGlyphNoise = source.match(/\b(?:Rhe|Nlaybook|Buildine|Natite|Cncwfe|Copteptu|CHCRVER|Staee|chaneine|Aeentic|aeent|Nroeram|RESOWRCES)\b/gi) || [];
  const compact = source.replace(/\s+/g, '');
  const compactCjk = source.replace(/[^\u4e00-\u9fff]/g, '');
  const oddCjkTokens = source.match(/(?:学么|人未|改取|周朋|练么|可维)/g) || [];
  const cjkRatio = compact ? compactCjk.length / Array.from(compact).length : 0;
  const hasReadableCjkText = compactCjk.length >= 80 && cjkRatio >= 0.25;

  if (knownGlyphNoise.length >= 4) return true;
  if (!hasReadableCjkText && longLatinWords.length >= 6 && latinWords.length >= 12) return true;
  return compactCjk.length >= 1000 && oddCjkTokens.length >= 8 && longLatinWords.length >= 3;
}

function cleanPdfExtractedText(text) {
  const lines = String(text || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const out = [];
  let microRun = [];
  let pendingBlankAfterMicroRun = 0;

  const flushMicroRun = () => {
    if (!microRun.length) {
      return;
    }

    const compact = microRun.join('').replace(/\s+/g, '');
    const compactLength = Array.from(compact).length;
    if (/^[A-Za-z]{2,8}$/.test(compact)) {
      out.push(compact);
    } else if (microRun.length < 4 && compactLength < 4) {
      out.push(...microRun);
    } else if (compactLength >= 4 && /[\p{L}\p{N}\u4e00-\u9fff]/u.test(compact)) {
      out.push(compact);
    }
    microRun = [];
    pendingBlankAfterMicroRun = 0;
  };

  lines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      if (microRun.length && pendingBlankAfterMicroRun < 2) {
        pendingBlankAfterMicroRun += 1;
        return;
      }
      flushMicroRun();
      if (out.length && out[out.length - 1] !== '') out.push('');
      return;
    }

    if (/^\d{1,4}$/.test(trimmed)) {
      flushMicroRun();
      return;
    }

    if (isPdfMicroLine(trimmed)) {
      microRun.push(trimmed);
      pendingBlankAfterMicroRun = 0;
      return;
    }

    flushMicroRun();
    out.push(trimmed);
  });

  flushMicroRun();
  return cleanMarkdownForStorage(mergePdfWrappedLines(out).join('\n'));
}

function decodePdfStream(raw, dictionary) {
  if (/\/Subtype\s*\/Image\b/.test(dictionary)) {
    return '';
  }
  if (/\/FlateDecode\b/.test(dictionary)) {
    try {
      return zlib.inflateSync(raw).toString('latin1');
    } catch (error) {
      try {
        return zlib.inflateRawSync(raw).toString('latin1');
      } catch (fallbackError) {
        return '';
      }
    }
  }
  return raw.toString('latin1');
}

function extractPdfStreamLength(dictionary) {
  const match = String(dictionary || '').match(/\/Length\s+(\d+)/);
  return match ? Number(match[1]) : null;
}

function getPdfStreamData({ buffer, source, dictionary, streamKeywordEnd }) {
  let dataStart = streamKeywordEnd;
  if (source[dataStart] === '\r' && source[dataStart + 1] === '\n') {
    dataStart += 2;
  } else if (source[dataStart] === '\n' || source[dataStart] === '\r') {
    dataStart += 1;
  }

  const directLength = extractPdfStreamLength(dictionary);
  if (Number.isFinite(directLength) && directLength >= 0 && dataStart + directLength <= buffer.length) {
    const endstreamOffset = source.indexOf('endstream', dataStart + directLength);
    return {
      raw: buffer.slice(dataStart, dataStart + directLength),
      nextOffset: endstreamOffset > -1 ? endstreamOffset + 9 : dataStart + directLength,
    };
  }

  const streamEnd = source.indexOf('endstream', dataStart);
  if (streamEnd < 0) {
    return null;
  }

  let dataEnd = streamEnd;
  if (source[dataEnd - 2] === '\r' && source[dataEnd - 1] === '\n') {
    dataEnd -= 2;
  } else if (source[dataEnd - 1] === '\n' || source[dataEnd - 1] === '\r') {
    dataEnd -= 1;
  }

  return {
    raw: buffer.slice(dataStart, dataEnd),
    nextOffset: streamEnd + 9,
  };
}

function extractPdfMarkdown(bufferLike) {
  const buffer = toNodeBuffer(bufferLike);
  const source = buffer.toString('latin1');
  const streams = [];
  const streamPattern = /(<<[\s\S]{0,5000}?>>)\s*stream/g;
  let match;

  while ((match = streamPattern.exec(source))) {
    const streamData = getPdfStreamData({
      buffer,
      source,
      dictionary: match[1],
      streamKeywordEnd: streamPattern.lastIndex,
    });
    if (!streamData) break;
    streams.push(decodePdfStream(streamData.raw, match[1]));
    streamPattern.lastIndex = streamData.nextOffset;
  }

  const cmap = buildPdfCMap(streams);
  const rawText = streams
    .map((stream) => extractPdfTextFromContent(stream, cmap))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n');

  if (isLowQualityPdfExtraction(rawText)) {
    throw new Error('PDF 文本提取质量过低。该文件可能使用特殊编码或扫描版，需要 OCR/高级解析。');
  }

  const text = cleanPdfExtractedText(rawText);

  if (isSuspectPdfGlyphEncoding(text)) {
    throw new Error('PDF 文本层编码异常，已保存原始附件，但暂不强制转 Markdown，避免生成乱码。建议使用 OCR 或导出为可复制文本的 PDF 后再同步。');
  }

  if (!text) {
    throw new Error('PDF 未提取到文本。扫描版 PDF 或特殊编码 PDF 需要 OCR/高级解析。');
  }

  return text;
}

function isFeishuUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('feishu.cn')
    || text.includes('larksuite.com')
    || text.includes('feishu.net')
    || text.includes('feishu');
}

function isWechatArticleUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('mp.weixin.qq.com') || text.includes('weixin.qq.com');
}

function isWechatMpArticleUrl(url) {
  const source = String(url || '').trim();
  if (!source) return false;
  try {
    const parsed = new URL(source);
    return /(^|\.)mp\.weixin\.qq\.com$/i.test(parsed.hostname);
  } catch (error) {
    return source.toLowerCase().includes('mp.weixin.qq.com');
  }
}

function isWechatCaptchaUrl(url) {
  return /\/mp\/wappoc_appmsgcaptcha\b/i.test(String(url || ''));
}

function decodeUrlComponentSafely(value) {
  let text = decodeHtmlEntities(String(value || '')).trim();
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch (error) {
      break;
    }
  }
  return text;
}

function extractWechatCaptchaTargetUrl(url) {
  const source = String(url || '');
  try {
    const parsed = new URL(source);
    const targetUrl = parsed.searchParams.get('target_url');
    if (targetUrl) return decodeUrlComponentSafely(targetUrl);
  } catch (error) {
    // Fall back to regex for malformed links copied from apps.
  }

  const match = source.match(/[?&]target_url=([^&#]+)/i);
  return match && match[1] ? decodeUrlComponentSafely(match[1]) : '';
}

function cleanDisplayUrl(url) {
  const source = String(url || '').trim();
  if (!source) return '';
  const target = extractWechatCaptchaTargetUrl(source) || source;
  if (!isWechatArticleUrl(target)) return source;

  try {
    const parsed = new URL(target);
    if (!/mp\.weixin\.qq\.com$/i.test(parsed.hostname)) return source;
    const cleaned = new URL(`${parsed.protocol}//${parsed.hostname}${parsed.pathname || '/s'}`);
    ['__biz', 'mid', 'idx', 'sn'].forEach((key) => {
      const value = parsed.searchParams.get(key);
      if (value) cleaned.searchParams.set(key, value);
    });
    return cleaned.search ? cleaned.toString() : `${cleaned.origin}${cleaned.pathname}`;
  } catch (error) {
    return source;
  }
}

function isXiaohongshuUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('xiaohongshu.com') || text.includes('xhslink.com');
}

function isDouyinUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('douyin.com') || text.includes('iesdouyin.com') || text.includes('amemv.com');
}

function isDouyinMediaUrl(url) {
  return /douyinvod\.com|zjcdn\.com\/tos-|bytedance[^/]*\.com\/.*(?:tos-|video)|mime_type=video/i.test(String(url || ''));
}

function extractDouyinAwemeId(url) {
  const text = String(url || '');
  const patterns = [
    /\/video\/(\d{8,})/i,
    /\/share\/video\/(\d{8,})/i,
    /[?&](?:aweme_id|item_id|item_ids)=(\d{8,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1];
  }
  return '';
}

function getDouyinAwemeDetailUrls(awemeId) {
  const id = String(awemeId || '').trim();
  if (!id) return [];
  const query = `aweme_id=${encodeURIComponent(id)}&aid=6383&device_platform=webapp`;
  return [
    `https://www.douyin.com/aweme/v1/web/aweme/detail/?${query}`,
    `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(id)}&aid=1128&device_platform=webapp`,
  ];
}

function shouldResolveMediaDownloadUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('/aweme/v1/play')
    || text.includes('v.douyin.com')
    || text.includes('iesdouyin.com/share/video')
    || text.includes('amemv.com');
}

function isBilibiliUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('bilibili.com') || text.includes('b23.tv');
}

function isXiaoyuzhouUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('xiaoyuzhoufm.com') || text.includes('xiaoyuzhou.com');
}

const WECHAT_CHANNELS_FEED_INFO_URL = 'https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info';

function isWechatChannelsUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('channels.weixin.qq.com')
    || /(^|\/\/)weixin\.qq\.com\/sph\//i.test(text);
}

function isWechatChannelsMediaUrl(url) {
  return /finder\.video\.qq\.com|mpvideo\.qpic\.cn|(^|[./-])mpvideo/i.test(String(url || ''));
}

function extractWechatChannelsRequestPayload(url) {
  const source = String(url || '').trim();
  try {
    const parsed = new URL(source);
    const hostname = parsed.hostname.toLowerCase();
    const path = parsed.pathname || '';
    if (hostname === 'weixin.qq.com') {
      const match = path.match(/\/sph\/([^/?#]+)/i);
      if (match && match[1]) return { shortUri: decodeURIComponent(match[1]) };
    }
    if (hostname === 'channels.weixin.qq.com') {
      const id = parsed.searchParams.get('id');
      if (id) return { shortUri: id };
      const eid = parsed.searchParams.get('eid');
      if (eid) return { exportId: eid };
    }
  } catch (error) {
    // Fall through to regex extraction for malformed copied links.
  }

  const shortMatch = source.match(/weixin\.qq\.com\/sph\/([^/?#\s]+)/i)
    || source.match(/[?&]id=([^&#\s]+)/i);
  if (shortMatch && shortMatch[1]) {
    return { shortUri: decodeUrlComponentSafely(shortMatch[1]) };
  }
  const exportMatch = source.match(/[?&]eid=([^&#\s]+)/i);
  if (exportMatch && exportMatch[1]) {
    return { exportId: decodeUrlComponentSafely(exportMatch[1]) };
  }
  return {};
}

function shouldHydrateLinkAsWebpage(url) {
  return isWechatMpArticleUrl(url)
    || isFeishuUrl(url)
    || isXiaohongshuUrl(url)
    || isDouyinUrl(url)
    || isBilibiliUrl(url)
    || isXiaoyuzhouUrl(url);
}

function getSocialRequestHeaders(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  if (isBilibiliUrl(url)) headers.Referer = 'https://www.bilibili.com/';
  if (/bilivideo\.com/i.test(String(url || ''))) headers.Referer = 'https://www.bilibili.com/';
  if (isXiaohongshuUrl(url)) headers.Referer = 'https://www.xiaohongshu.com/';
  if (isDouyinUrl(url) || isDouyinMediaUrl(url)) headers.Referer = 'https://www.douyin.com/';
  if (isXiaoyuzhouUrl(url)) headers.Referer = 'https://www.xiaoyuzhoufm.com/';
  if (isWechatChannelsUrl(url) || isWechatChannelsMediaUrl(url)) headers.Referer = 'https://channels.weixin.qq.com/';
  return headers;
}

function isHeaderProtectedMediaUrl(url) {
  return /bilivideo\.com|upos-[^/]+\.bilivideo\.com/i.test(String(url || ''));
}

function shouldRetryRedirectWithGet(url, statusCode) {
  return shouldResolvePlatformRedirect(url) && [400, 403, 404, 405, 501].includes(Number(statusCode));
}

function resolveRedirectUrl(url, maxRedirects = 5, method = 'HEAD') {
  const source = String(url || '').trim();
  if (!/^https?:\/\//i.test(source) || maxRedirects <= 0) {
    return Promise.resolve(source);
  }

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(source);
    } catch (error) {
      resolve(source);
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.request(parsed, {
      method,
      headers: getSocialRequestHeaders(source),
    }, (response) => {
      const location = response.headers && response.headers.location;
      response.resume();
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        try {
          resolve(resolveRedirectUrl(new URL(location, source).toString(), maxRedirects - 1));
          return;
        } catch (error) {
          resolve(source);
          return;
        }
      }
      if (method === 'HEAD' && shouldRetryRedirectWithGet(source, response.statusCode)) {
        resolve(resolveRedirectUrl(source, maxRedirects, 'GET'));
        return;
      }
      resolve(source);
    });

    request.setTimeout(8000, () => {
      request.destroy();
      resolve(source);
    });
    request.on('error', () => resolve(source));
    request.end();
  });
}

function shouldResolvePlatformRedirect(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('b23.tv')
    || text.includes('v.douyin.com')
    || text.includes('xhslink.com')
    || /weixin\.qq\.com\/sph\//i.test(text);
}

function getUrlHostname(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '');
  } catch (error) {
    const match = String(url || '').match(/^https?:\/\/([^/?#]+)/i);
    return match && match[1] ? match[1].replace(/^www\./, '') : '';
  }
}

function getUrlLastPathSegment(url) {
  try {
    const parsed = new URL(String(url || ''));
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : '';
  } catch (error) {
    return '';
  }
}

function stripFileExtension(fileName) {
  const leaf = String(fileName || '').split(/[\\/]/).pop() || '';
  return leaf.replace(/\.[a-z0-9]{1,12}$/i, '').trim();
}

function truncateByChars(text, maxLength) {
  const chars = Array.from(String(text || ''));
  return chars.length > maxLength ? chars.slice(0, maxLength).join('') : chars.join('');
}

function sanitizeNoteTitlePart(text, fallback = '未命名') {
  const cleaned = decodeHtmlEntities(String(text || ''))
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  const value = cleaned || fallback;
  return truncateByChars(value, 56).replace(/[.\s]+$/g, '').trim() || fallback;
}

function getWebpageSourcePrefix(url) {
  if (isFeishuUrl(url)) return '飞书';
  if (isWechatChannelsUrl(url)) return '视频号';
  if (isWechatArticleUrl(url)) return '公众号';
  if (isXiaohongshuUrl(url)) return '小红书';
  if (isDouyinUrl(url)) return '抖音';
  if (isBilibiliUrl(url)) return 'B站';
  if (isXiaoyuzhouUrl(url)) return '小宇宙';
  return '网页';
}

function getRecordSourcePrefix(record) {
  const type = String(record && record.type || '').toLowerCase();
  const metadata = (record && record.metadata) || {};
  if (type === 'link' && shouldHydrateLinkAsWebpage(metadata.url || record.content || '')) {
    return getWebpageSourcePrefix(metadata.url || record.content || '');
  }
  if (type === 'text') return '文本';
  if (type === 'link') return '链接';
  if (type === 'voice') return '录音';
  if (type === 'webpage') return getWebpageSourcePrefix(metadata.url || record.content || '');
  if (type === 'file') {
    return getAttachmentExt(metadata.fileName || record.content || '', metadata.fileExt) || '文件';
  }
  return getTypeDisplayName(type);
}

function getRecordSourceName(record) {
  const type = String(record && record.type || '').toLowerCase();
  const metadata = (record && record.metadata) || {};
  const content = String((record && record.content) || '').trim();
  const fallbackTime = getTitleTimePart(record && record.createdAt);

  if (type === 'file') {
    return stripFileExtension(metadata.fileName || content) || fallbackTime;
  }
  if (type === 'voice') {
    const audioName = stripFileExtension(metadata.originalAudioFileName || metadata.audioFileName || '');
    if (audioName) return audioName;
    if (content && !/^现场语音备忘录\s*-/.test(content)) return content;
    return fallbackTime;
  }
  if (type === 'webpage') {
    const url = metadata.url || content;
    return metadata.title || getUrlLastPathSegment(url) || getUrlHostname(url) || fallbackTime;
  }
  if (type === 'link') {
    const url = metadata.url || content;
    if (shouldHydrateLinkAsWebpage(url)) {
      return metadata.title || getUrlLastPathSegment(url) || getUrlHostname(url) || fallbackTime;
    }
    return metadata.title || getUrlHostname(url) || getUrlLastPathSegment(url) || content || fallbackTime;
  }
  return content || fallbackTime;
}

function buildRecordTitleBase(record) {
  const prefix = sanitizeNoteTitlePart(getRecordSourcePrefix(record), '内容');
  const name = sanitizeNoteTitlePart(getRecordSourceName(record), getTitleTimePart(record && record.createdAt));
  return `${prefix}-${name}`;
}

function getHtmlAttribute(tag, name) {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(tag || '').match(pattern);
  return match ? decodeHtmlEntities(match[1] || match[2] || match[3] || '') : '';
}

function extractMetaContent(html, names) {
  const wanted = new Set((Array.isArray(names) ? names : [names]).map((name) => String(name || '').toLowerCase()));
  const source = String(html || '');
  const tags = source.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (getHtmlAttribute(tag, 'property') || getHtmlAttribute(tag, 'name') || getHtmlAttribute(tag, 'itemprop')).toLowerCase();
    if (wanted.has(key)) {
      const content = getHtmlAttribute(tag, 'content');
      if (content) return content.trim();
    }
  }
  return '';
}

function extractKeywordList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractWebpageMetadataFromHtml(html, url = '') {
  const source = String(html || '');
  const description = cleanSocialDescription(extractMetaContent(source, [
    'description',
    'og:description',
    'twitter:description',
  ]));
  return {
    title: extractMetaContent(source, ['og:title', 'twitter:title']) || extractHtmlTitle(source),
    author: extractMetaContent(source, [
      'author',
      'article:author',
      'og:site_name',
      'weixin:author',
      'twitter:creator',
    ]),
    description,
    keywords: extractKeywordList(extractMetaContent(source, ['keywords', 'article:tag'])),
    platform: getWebpageSourcePrefix(url),
    contentCategory: isDouyinUrl(url) || isBilibiliUrl(url) || isXiaoyuzhouUrl(url) ? '音视频' : '图文',
  };
}

function normalizeExtractedUrl(url) {
  const normalized = decodeHtmlEntities(String(url || ''))
    .replace(/\\u002F/g, '/')
    .replace(/\\\//g, '/')
    .trim();
  return normalized.startsWith('//') ? `https:${normalized}` : normalized;
}

function decodeJsonLikeString(text) {
  const source = String(text || '');
  if (!source) return '';
  try {
    return JSON.parse(`"${source.replace(/"/g, '\\"')}"`);
  } catch (error) {
    return source
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\t/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\u002F/g, '/')
      .replace(/\\\//g, '/');
  }
}

function pushUniqueUrl(list, value) {
  const url = normalizeExtractedUrl(value);
  if (!url || /^data:/i.test(url) || /^blob:/i.test(url)) return;
  if (!/^https?:\/\//i.test(url)) return;
  if (!list.includes(url)) list.push(url);
}

function isLikelyMediaUrl(value) {
  const url = normalizeExtractedUrl(value);
  if (!url) return false;
  if (/\.(?:mp3|m4a|aac|wav|ogg|flac|mp4|m4s|m3u8)(?:[?#]|$)/i.test(url)) return true;
  return /(?:media\.xyzcdn\.net|finder\.video\.qq\.com|mpvideo|bilivideo\.com|bilibili\.com\/.*audio|douyin\.com\/aweme\/v1\/play|douyinvod\.com|zjcdn\.com\/tos-|bytedance[^/]*\.com\/.*(?:tos-|video)|mime_type=video)/i.test(url);
}

function pushUniqueMediaUrl(list, value) {
  const url = normalizeExtractedUrl(value);
  if (!/^https?:\/\//i.test(url)) return;
  if (!isLikelyMediaUrl(url)) return;
  if (!list.includes(url)) list.push(url);
}

function extractLooseMediaUrlsFromText(text) {
  const source = String(text || '');
  const urls = [];
  const patterns = [
    /https?:\\?\/\\?\/[^"'\s<>]*?(?:finder\.video\.qq\.com|mpvideo\.qpic\.cn|mpvideo)[^"'\s<>]*/gi,
    /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:mp3|m4a|aac|wav|ogg|flac|mp4|m4s|m3u8)(?:[?#][^"'\s<>]*)?/gi,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source))) {
      const rawUrl = String(match[0] || '').replace(/[),.;]+$/g, '');
      pushUniqueMediaUrl(urls, rawUrl);
    }
  });

  return urls;
}

function getTranscriptionMediaScore(value) {
  const url = normalizeExtractedUrl(value).toLowerCase();
  if (!url) return -1000;

  let score = 0;
  if (/\.(?:mp3|m4a|aac|wav|ogg|flac)(?:[?#]|$)/i.test(url)) score += 1000;
  if (/audio|music|voice|mime_type=audio|audio_url|music_url|play_audio/i.test(url)) score += 800;
  if (/aweme\/v1\/play/i.test(url)) score += 500;
  if (/\.(?:mp4)(?:[?#]|$)|finder\.video\.qq\.com|mpvideo|douyinvod\.com|zjcdn\.com\/tos-|mime_type=video/i.test(url)) score += 250;
  if (/\.(?:m4s|m3u8)(?:[?#]|$)/i.test(url)) score -= 300;
  if (/\.css(?:[?#]|$)|\.js(?:[?#]|$)|image|webp|jpg|png/i.test(url)) score -= 1000;
  return score;
}

function sortMediaUrlsForTranscription(urls) {
  return (urls || [])
    .map((url, index) => ({ url: normalizeExtractedUrl(url), index }))
    .filter((item) => /^https?:\/\//i.test(item.url) && isLikelyMediaUrl(item.url))
    .filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index)
    .sort((a, b) => {
      const scoreDiff = getTranscriptionMediaScore(b.url) - getTranscriptionMediaScore(a.url);
      return scoreDiff || a.index - b.index;
    })
    .map((item) => item.url);
}

function collectBrowserCapturedMediaUrls(value, urls = [], seen = new Set(), depth = 0) {
  if (value === undefined || value === null || depth > 5) return urls;
  if (typeof value === 'string') {
    pushUniqueMediaUrl(urls, value);
    extractLooseMediaUrlsFromText(value).forEach((url) => pushUniqueMediaUrl(urls, url));
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectBrowserCapturedMediaUrls(item, urls, seen, depth + 1));
    return urls;
  }
  if (typeof value !== 'object' || seen.has(value)) return urls;
  seen.add(value);

  const resourceType = String(value.resourceType || value.initiatorType || value.type || '').toLowerCase();
  if (['image', 'img', 'script', 'stylesheet', 'font', 'css'].includes(resourceType)) {
    return urls;
  }

  [
    'url',
    'requestUrl',
    'redirectURL',
    'redirectUrl',
    'name',
    'src',
    'currentSrc',
  ].forEach((key) => collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1));

  ['request', 'response', 'resource', 'details'].forEach((key) => {
    if (value[key]) collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1);
  });

  Object.keys(value).forEach((key) => {
    if (/url|src|media|video|audio|stream|download|play|name/i.test(key)) {
      collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1);
    }
  });

  return urls;
}

function normalizeBrowserCapturedMediaUrls(items) {
  const urls = [];
  collectBrowserCapturedMediaUrls(items, urls);
  return sortMediaUrlsForTranscription(urls);
}

function isLikelyImageUrl(value) {
  const url = normalizeExtractedUrl(value);
  if (!url) return false;
  if (/\.(?:js|css|pdf|mp4|m4a|mp3|m3u8)(?:[?#]|$)/i.test(url)) return false;
  return /\.(?:jpg|jpeg|png|webp)(?:[?!#]|$)/i.test(url)
    || /\/notes_pre_post\//i.test(url)
    || /sns-webpic/i.test(url)
    || /(?:^|[!?#&])nd_(?:dft|prv)/i.test(url)
    || /\/image\//i.test(url);
}

function getImageVariantKey(value) {
  const url = normalizeExtractedUrl(value);
  const noteImageMatch = url.match(/\/notes_pre_post\/([^"'\\\s<>?#]+)/i);
  if (noteImageMatch) return `notes_pre_post:${noteImageMatch[1].replace(/!.+$/i, '')}`;

  const spectrumImageMatch = url.match(/\/spectrum\/([^"'\\\s<>?#]+)/i);
  if (spectrumImageMatch) return `spectrum:${spectrumImageMatch[1].replace(/!.+$/i, '')}`;

  return url
    .replace(/^http:\/\//i, 'https://')
    .replace(/([!?#&])nd_(?:dft|prv)[^?#&]*/i, '$1nd')
    .replace(/[?#].*$/g, '');
}

function dedupeImageVariants(urls) {
  const map = new Map();
  (urls || []).forEach((url) => {
    if (!isLikelyImageUrl(url)) return;
    const key = getImageVariantKey(url);
    const existing = map.get(key);
    if (!existing || /(?:^|[!?#&])nd_dft/i.test(url)) {
      map.set(key, url);
    }
  });
  return Array.from(map.values());
}

function collectJsonArrayBlocks(source, keys) {
  const wanted = (keys || []).map((key) => String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!wanted.length) return [];
  const pattern = new RegExp(`["'](?:${wanted.join('|')})["']\\s*:\\s*\\[`, 'gi');
  const blocks = [];
  const text = String(source || '');
  let match;
  while ((match = pattern.exec(text))) {
    let depth = 1;
    let inString = '';
    let escaped = false;
    const start = pattern.lastIndex - 1;
    for (let index = pattern.lastIndex; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (inString) {
        if (char === inString) inString = '';
        continue;
      }
      if (char === '"' || char === "'") {
        inString = char;
        continue;
      }
      if (char === '[') depth += 1;
      if (char === ']') depth -= 1;
      if (depth === 0) {
        blocks.push(text.slice(start, index + 1));
        pattern.lastIndex = index + 1;
        break;
      }
    }
  }
  return blocks;
}

function collectJsonStringValues(source, keys) {
  const wanted = new Set((keys || []).map((key) => String(key || '').toLowerCase()));
  const values = [];
  const pattern = /["']([A-Za-z0-9_$-]{2,40})["']\s*:\s*["']((?:\\.|[^"'\\])*)["']/g;
  let match;
  while ((match = pattern.exec(String(source || '')))) {
    if (!wanted.has(String(match[1] || '').toLowerCase())) continue;
    const value = decodeHtmlEntities(decodeJsonLikeString(match[2])).trim();
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function collectJsonArrayStringValues(source, keys) {
  const wanted = new Set((keys || []).map((key) => String(key || '').toLowerCase()));
  const values = [];
  const pattern = /["']([A-Za-z0-9_$-]{2,40})["']\s*:\s*\[((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'\s*,?\s*)+)\]/g;
  let match;
  while ((match = pattern.exec(String(source || '')))) {
    if (!wanted.has(String(match[1] || '').toLowerCase())) continue;
    const arraySource = match[2] || '';
    const itemPattern = /["']((?:\\.|[^"'\\])*)["']/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(arraySource))) {
      const value = decodeHtmlEntities(decodeJsonLikeString(itemMatch[1])).trim();
      if (value && !values.includes(value)) values.push(value);
    }
  }
  return values;
}

function collectLooseXiaohongshuImageUrls(source) {
  const normalized = decodeHtmlEntities(String(source || ''))
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/');
  const urls = [];
  const pattern = /https?:\/\/[^"'\\\s<>]*(?:sns-webpic|xhscdn|notes_pre_post)[^"'\\\s<>]*/gi;
  let match;
  while ((match = pattern.exec(normalized))) {
    pushUniqueUrl(urls, match[0]);
  }
  return urls;
}

function collectImageUrlsFromHtml(html) {
  const source = String(html || '');
  const urls = [];
  [
    extractMetaContent(source, ['og:image', 'og:image:url', 'twitter:image']),
  ].forEach((url) => pushUniqueUrl(urls, url));

  const imageTags = source.match(/<img\b[^>]*>/gi) || [];
  imageTags.forEach((tag) => {
    pushUniqueUrl(urls, getHtmlAttribute(tag, 'data-src') || getHtmlAttribute(tag, 'src'));
    const srcset = getHtmlAttribute(tag, 'srcset');
    if (srcset) {
      pushUniqueUrl(urls, srcset.split(',')[0].trim().split(/\s+/)[0]);
    }
  });

  const imagePattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s<>]*)?/gi;
  let match;
  while ((match = imagePattern.exec(source))) {
    pushUniqueUrl(urls, match[0]);
  }

  collectJsonStringValues(source, [
    'url',
    'urlDefault',
    'urlPre',
    'url_pre',
    'urlSizeLarge',
    'url_size_large',
    'original',
    'originalUrl',
    'original_url',
    'src',
    'image',
    'imageUrl',
    'image_url',
    'cover',
  ]).forEach((url) => {
    if (isLikelyImageUrl(url)) {
      pushUniqueUrl(urls, url);
    }
  });

  collectLooseXiaohongshuImageUrls(source).forEach((url) => pushUniqueUrl(urls, url));

  return dedupeImageVariants(urls);
}

function isNoisyXiaohongshuImageUrl(value) {
  const url = normalizeExtractedUrl(value).toLowerCase();
  return /picasso-static\.xiaohongshu\.com\/fe-platform\//i.test(url)
    || /fe-platform\.xhscdn\.com\/platform\//i.test(url)
    || /(?:^|\/\/)[^/]*xhscdn\.com\/platform\//i.test(url)
    || /(?:avatar|sns-avatar|recommend|banner|logo|icon|emoji|sticker|qrcode|qr-code|comment|user|profile|ads?)[^/]*(?:\.jpg|\.jpeg|\.png|\.webp|!|$)/i.test(url)
    || /ci\.xiaohongshu\.com\/(?:recommend|banner|logo|icon|avatar)/i.test(url);
}

function collectFilteredImageTagUrls(source) {
  const urls = [];
  const imageTags = String(source || '').match(/<img\b[^>]*>/gi) || [];
  imageTags.forEach((tag) => {
    const src = getHtmlAttribute(tag, 'data-src') || getHtmlAttribute(tag, 'src');
    if (src && isLikelyImageUrl(src) && !isNoisyXiaohongshuImageUrl(src)) {
      pushUniqueUrl(urls, src);
    }
    const srcset = getHtmlAttribute(tag, 'srcset');
    if (srcset) {
      const srcsetUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
      if (isLikelyImageUrl(srcsetUrl) && !isNoisyXiaohongshuImageUrl(srcsetUrl)) {
        pushUniqueUrl(urls, srcsetUrl);
      }
    }
  });
  return urls;
}

function collectXiaohongshuNoteImageUrls(html) {
  const source = String(html || '');
  const urls = [];
  [
    extractMetaContent(source, ['og:image', 'og:image:url', 'twitter:image']),
  ].forEach((url) => {
    if (url && !isNoisyXiaohongshuImageUrl(url)) pushUniqueUrl(urls, url);
  });

  collectFilteredImageTagUrls(source).forEach((url) => pushUniqueUrl(urls, url));

  const imageBlocks = collectJsonArrayBlocks(source, [
    'imageList',
    'image_list',
    'images',
    'imageUrls',
    'image_urls',
    'imageUrlList',
    'image_url_list',
  ]);

  imageBlocks.forEach((block) => {
    collectJsonStringValues(block, [
      'url',
      'urlDefault',
      'urlPre',
      'url_pre',
      'urlSizeLarge',
      'url_size_large',
      'original',
      'originalUrl',
      'original_url',
      'src',
      'image',
      'imageUrl',
      'image_url',
      'cover',
    ]).forEach((url) => {
      if (isLikelyImageUrl(url) && !isNoisyXiaohongshuImageUrl(url)) {
        pushUniqueUrl(urls, url);
      }
    });
    collectLooseXiaohongshuImageUrls(block).forEach((url) => {
      if (!isNoisyXiaohongshuImageUrl(url)) pushUniqueUrl(urls, url);
    });
  });

  const noteImages = dedupeImageVariants(urls);
  if (imageBlocks.length || noteImages.length > 1) {
    return noteImages;
  }

  return dedupeImageVariants(collectImageUrlsFromHtml(source)
    .filter((imageUrl) => !isNoisyXiaohongshuImageUrl(imageUrl))).slice(0, 6);
}

function sanitizeXiaohongshuMarkdownImages(markdown) {
  const source = String(markdown || '');
  if (!source.includes('## 图片')) return source;
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^##\s+图片\s*$/u.test(String(line || '').trim()));
  if (start < 0) return source;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(String(lines[index] || '').trim())) {
      end = index;
      break;
    }
  }
  const imageSection = lines.slice(start, end).join('\n');
  const imageUrls = [];
  const imagePattern = /!\[[^\]]*]\(([^)]+)\)/g;
  let match;
  while ((match = imagePattern.exec(imageSection))) {
    const imageUrl = normalizeExtractedUrl(match[1]);
    if (imageUrl && isLikelyImageUrl(imageUrl) && !isNoisyXiaohongshuImageUrl(imageUrl)) {
      pushUniqueUrl(imageUrls, imageUrl);
    }
  }
  const cleanImages = dedupeImageVariants(imageUrls);
  if (!cleanImages.length || cleanImages.length === (imageSection.match(/!\[[^\]]*]\(/g) || []).length) {
    return source;
  }

  const replacement = ['## 图片', '', '### 封面', '', `![封面](${cleanImages[0]})`, ''];
  if (cleanImages.length > 1) {
    replacement.push('### 内页图', '');
    cleanImages.slice(1).forEach((imageUrl, index) => {
      replacement.push(`![内页图 ${index + 1}](${imageUrl})`, '');
    });
  }

  return [
    ...lines.slice(0, start),
    ...replacement,
    ...lines.slice(end),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractVideoUrlFromHtml(html) {
  const source = String(html || '');
  const fromMeta = extractMetaContent(source, ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']);
  if (fromMeta) return normalizeExtractedUrl(fromMeta);

  const videoTags = source.match(/<(?:video|source)\b[^>]*>/gi) || [];
  for (const tag of videoTags) {
    const src = getHtmlAttribute(tag, 'src');
    if (src && isLikelyMediaUrl(src)) return normalizeExtractedUrl(src);
  }

  const match = source.match(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp4|m4a|mp3|m3u8)(?:\?[^"'\\\s<>]*)?/i);
  return match ? normalizeExtractedUrl(match[0]) : '';
}

function extractPodcastAudioUrlFromHtml(html) {
  const source = String(html || '');
  const urls = [];
  [
    extractMetaContent(source, ['og:audio', 'og:audio:url', 'music:album', 'twitter:player:stream']),
  ].forEach((url) => pushUniqueMediaUrl(urls, url));

  const audioTags = source.match(/<audio\b[^>]*>/gi) || [];
  audioTags.forEach((tag) => {
    pushUniqueMediaUrl(urls, getHtmlAttribute(tag, 'src'));
  });

  collectJsonStringValues(source, [
    'audioUrl',
    'audio_url',
    'mediaUrl',
    'media_url',
    'enclosureUrl',
    'enclosure_url',
    'src',
    'url',
  ]).forEach((url) => pushUniqueMediaUrl(urls, url));

  const mediaPattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp3|m4a|aac|wav|ogg|flac)(?:\?[^"'\\\s<>]*)?/gi;
  let match;
  while ((match = mediaPattern.exec(source))) {
    pushUniqueMediaUrl(urls, match[0]);
  }

  return urls[0] || '';
}

function extractSocialMediaUrlsFromHtml(html) {
  const source = String(html || '');
  const urls = [];

  [
    extractVideoUrlFromHtml(source),
    extractPodcastAudioUrlFromHtml(source),
  ].forEach((url) => pushUniqueMediaUrl(urls, url));

  collectJsonStringValues(source, [
    'audioUrl',
    'audio_url',
    'downloadAddr',
    'download_addr',
    'mediaUrl',
    'media_url',
    'musicUrl',
    'music_url',
    'playApi',
    'play_api',
    'playAddr',
    'play_addr',
    'src',
    'streamUrl',
    'stream_url',
    'url',
    'videoUrl',
    'video_url',
  ]).forEach((url) => pushUniqueMediaUrl(urls, url));

  collectJsonArrayStringValues(source, [
    'urlList',
    'url_list',
    'downloadList',
    'download_list',
    'playUrlList',
    'play_url_list',
  ]).forEach((url) => pushUniqueMediaUrl(urls, url));

  extractLooseMediaUrlsFromText(source).forEach((url) => pushUniqueMediaUrl(urls, url));

  const mediaPattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp3|m4a|aac|wav|ogg|flac|mp4|m4s|m3u8)(?:\?[^"'\\\s<>]*)?/gi;
  let match;
  while ((match = mediaPattern.exec(source))) {
    pushUniqueMediaUrl(urls, match[0]);
  }

  return sortMediaUrlsForTranscription(urls);
}

function extractSocialMediaUrlFromHtml(html) {
  return extractSocialMediaUrlsFromHtml(html)[0] || '';
}

function collectDouyinUrlList(value, urls) {
  if (!value) return;
  if (typeof value === 'string') {
    pushUniqueMediaUrl(urls, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDouyinUrlList(item, urls));
    return;
  }
  if (typeof value === 'object') {
    collectDouyinUrlList(value.url_list, urls);
    collectDouyinUrlList(value.urlList, urls);
    collectDouyinUrlList(value.url, urls);
  }
}

function extractDouyinMediaUrlsFromDetailPayload(payload) {
  const detail = payload && (payload.aweme_detail || payload.awemeDetail || payload.item_list && payload.item_list[0]);
  if (!detail || typeof detail !== 'object') return [];
  const video = detail.video || {};
  const urls = [];
  collectDouyinUrlList(video.play_addr, urls);
  collectDouyinUrlList(video.download_addr, urls);
  collectDouyinUrlList(video.playAddr, urls);
  collectDouyinUrlList(video.downloadAddr, urls);
  (Array.isArray(video.bit_rate) ? video.bit_rate : []).forEach((item) => {
    collectDouyinUrlList(item && item.play_addr, urls);
    collectDouyinUrlList(item && item.playAddr, urls);
  });
  return sortMediaUrlsForTranscription(urls);
}

function isUnavailableXiaohongshuPage(html, url = '') {
  const source = decodeHtmlEntities(String(html || ''));
  const target = String(url || '');
  return /xiaohongshu\.com\/404/i.test(target)
    || /errorCode=-510001|error_code=300031/i.test(target)
    || source.includes('你访问的页面不见了')
    || source.includes('当前笔记暂时无法浏览');
}

function hasReadableXiaohongshuGraphicContent(extracted, html, url = '') {
  if (!extracted || isUnavailableXiaohongshuPage(html, url)) return false;
  const hasImages = Array.isArray(extracted.imageUrls) && extracted.imageUrls.length > 0;
  if (hasImages) return true;
  const description = String(extracted.description || '').trim();
  if (!description || description.length < 20) return false;
  if (/^(?:短链落地页|当前笔记暂时无法浏览|你访问的页面不见了|页面未直接暴露正文)/.test(description)) return false;
  return true;
}

function shouldProbeXiaohongshuMediaFromGenericLanding(extracted, html, url = '') {
  if (!extracted || extracted.videoUrl || isUnavailableXiaohongshuPage(html, url)) return false;
  const title = String(extracted.title || '').trim();
  const description = String(extracted.description || '').trim();
  return title.includes('你的生活兴趣社区')
    || (/该内容来自小红书/.test(description) && /打开小红书/.test(description));
}

function extractBilibiliSubtitleUrlsFromHtml(html) {
  const source = String(html || '');
  const urls = [];
  collectJsonStringValues(source, [
    'subtitle_url',
    'subtitleUrl',
  ]).forEach((value) => {
    const url = normalizeExtractedUrl(value);
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
  });

  const pattern = /["']subtitle_url["']\s*:\s*["']((?:\\.|[^"'\\])+)["']/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const url = normalizeExtractedUrl(decodeJsonLikeString(match[1]));
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function parseBilibiliSubtitlePayload(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const body = Array.isArray(data && data.body) ? data.body : [];
  return body
    .map((item) => String((item && (item.content || item.text)) || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractBilibiliBvid(url) {
  const match = String(url || '').match(/BV[0-9A-Za-z]+/);
  return match ? match[0] : '';
}

function extractBilibiliCidFromPayload(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const pages = data && data.data && Array.isArray(data.data.pages) ? data.data.pages : [];
  const cid = (pages[0] && pages[0].cid)
    || (data && data.data && data.data.cid)
    || '';
  return cid ? String(cid) : '';
}

function extractBilibiliAudioUrlFromPlayurlPayload(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const playData = data && data.data ? data.data : {};
  const audioList = playData.dash && Array.isArray(playData.dash.audio) ? playData.dash.audio : [];
  for (const item of audioList) {
    const url = normalizeExtractedUrl(item && (item.baseUrl || item.base_url || item.url));
    if (url) return url;
    const backups = (item && (item.backupUrl || item.backup_url)) || [];
    if (Array.isArray(backups) && backups.length) {
      const backupUrl = normalizeExtractedUrl(backups[0]);
      if (backupUrl) return backupUrl;
    }
  }

  const durlList = Array.isArray(playData.durl) ? playData.durl : [];
  for (const item of durlList) {
    const url = normalizeExtractedUrl(item && item.url);
    if (url) return url;
  }

  return '';
}

function extractBilibiliAudioUrlFromHtml(html) {
  const source = String(html || '');
  const urls = [];
  collectJsonStringValues(source, [
    'baseUrl',
    'base_url',
    'backupUrl',
    'backup_url',
  ]).forEach((url) => pushUniqueMediaUrl(urls, url));

  const mediaPattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?(?:bilivideo\.com|bilibili\.com)[^"'\\\s<>]+?(?:audio|\.m4s|\.m4a|\.mp3)[^"'\\\s<>]*/gi;
  let match;
  while ((match = mediaPattern.exec(source))) {
    pushUniqueMediaUrl(urls, match[0]);
  }
  return urls[0] || '';
}

function extractTagsFromText(text, html = '') {
  const tags = [];
  const source = `${text || ''}\n${extractMetaContent(html, ['keywords', 'article:tag']) || ''}`;
  const hashPattern = /#([\p{L}\p{N}_-]{1,32})/gu;
  let match;
  while ((match = hashPattern.exec(source))) {
    const tag = `#${match[1]}`;
    if (!tags.includes(tag)) tags.push(tag);
  }
  source.split(/[,，、\s]+/).forEach((item) => {
    const cleaned = item.trim();
    if (cleaned && cleaned.length <= 24 && !cleaned.includes('http') && !cleaned.startsWith('#') && extractMetaContent(html, ['keywords']).includes(cleaned)) {
      const tag = `#${cleaned}`;
      if (!tags.includes(tag)) tags.push(tag);
    }
  });
  return tags;
}

function cleanSocialDescription(text) {
  return decodeHtmlEntities(String(text || ''))
    .replace(/\\n/g, '\n')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/把文字复制好，?\s*然后去【小红书】查看详情。?/g, '')
    .replace(/\s+#/g, '\n#')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isDefaultXiaohongshuDescription(text) {
  return /^3\s*亿人的生活经验/.test(String(text || '').trim());
}

function isNoisyXiaohongshuDescription(text) {
  const source = String(text || '');
  if (!source) return true;
  if (isDefaultXiaohongshuDescription(source)) return true;
  const compact = source.replace(/\s+/g, '');
  if (compact.length > 6000) return true;

  const noisyMarkers = [
    'window.__INITIAL_STATE__',
    'window.__SSR__',
    'ICP备',
    '营业执照',
    '违法不良信息举报',
    '增值电信业务经营许可证',
    '创作中心',
    'appSettings',
    'serverTime',
    'webpack',
  ];
  const markerCount = noisyMarkers.reduce((count, marker) => count + (source.includes(marker) ? 1 : 0), 0);
  if (markerCount >= 2) return true;

  const jsonNoiseCount = (source.match(/[{}[\]"'=]/g) || []).length;
  return source.length > 1200 && jsonNoiseCount / Math.max(source.length, 1) > 0.08;
}

function stripScriptAndStyleBlocks(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
}

function scoreXiaohongshuDescriptionCandidate(candidate) {
  const text = String(candidate.text || '').trim();
  const length = Array.from(text).length;
  let score = Math.min(length, 3000) + (candidate.weight || 0);
  if (/#([\p{L}\p{N}_-]{1,32})/u.test(text)) score += 500;
  if (/[\u4e00-\u9fff].*[\u4e00-\u9fff]/u.test(text)) score += 200;
  if (length < 12) score -= 1000;
  return score;
}

function extractXiaohongshuDescription(html, fallbackText = '') {
  const source = String(html || '');
  const jsonCandidates = collectJsonStringValues(source, [
      'desc',
      'description',
      'content',
      'noteContent',
      'note_content',
      'displayTitle',
    ]);
  const candidates = [
    { text: cleanSocialDescription(fallbackText), weight: 100 },
    { text: cleanSocialDescription(extractMetaContent(source, ['description', 'og:description', 'twitter:description'])), weight: 300 },
    ...jsonCandidates.map((text) => ({ text: cleanSocialDescription(text), weight: 800 })),
    { text: cleanSocialDescription(stripHtmlTags(stripScriptAndStyleBlocks(selectReadableHtml(source)))), weight: 0 },
  ].filter((item) => item.text && !/^https?:\/\//i.test(item.text) && !isNoisyXiaohongshuDescription(item.text));

  candidates.sort((a, b) => scoreXiaohongshuDescriptionCandidate(b) - scoreXiaohongshuDescriptionCandidate(a));
  return candidates[0]?.text || '';
}

function extractXiaohongshuAuthor(html) {
  const source = String(html || '');
  const candidates = collectJsonStringValues(source, [
    'nickname',
    'nickName',
    'userNickname',
    'user_nickname',
    'userName',
  ]).map((item) => cleanSocialDescription(item))
    .filter((item) => item && item.length <= 40 && !/^https?:\/\//i.test(item));
  return candidates[0] || '';
}

function extractXiaohongshuMarkdownFromHtml(html, url, fallbackText = '', options = {}) {
  url = cleanDisplayUrl(url);
  const source = String(html || '');
  const title = extractMetaContent(source, ['og:title', 'twitter:title'])
    || extractHtmlTitle(source)
    || '小红书笔记';
  const description = extractXiaohongshuDescription(source, fallbackText);
  const tags = extractTagsFromText(description, source);
  const images = collectXiaohongshuNoteImageUrls(source);
  const videoUrl = extractVideoUrlFromHtml(source);
  const includeComments = options.includeComments !== false;
  const comments = includeComments ? extractSocialCommentsFromHtml(source) : [];
  const lines = [
    '## 标题',
    '',
    title,
    '',
    '## 正文',
    '',
    description || '页面未直接暴露正文，原始链接已写入笔记属性。',
    '',
  ];

  if (tags.length) {
    lines.push('## 标签', '', tags.join(' '), '');
  }

  if (images.length) {
    lines.push('## 图片', '', '### 封面', '', `![封面](${images[0]})`, '');
    if (images.length > 1) {
      lines.push('### 内页图', '');
      images.slice(1).forEach((image, index) => {
        lines.push(`![内页图 ${index + 1}](${image})`, '');
      });
    }
  }

  if (videoUrl) {
    lines.push('## 视频源', '', `[视频文件](${videoUrl})`, '');
  }

  const commentsMarkdown = buildSocialCommentsMarkdown(comments);
  if (commentsMarkdown) {
    lines.push(commentsMarkdown, '');
  }

  return {
    title,
    author: extractXiaohongshuAuthor(source),
    description,
    tags,
    markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    imageUrls: images,
    videoUrl,
    comments,
  };
}

function normalizeOcrText(text) {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const seen = new Set();
  return lines
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n')
    .trim();
}

function countReadableOcrChars(text) {
  return (String(text || '').replace(/\s+/g, '').match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length;
}

function normalizeXiaohongshuOcrItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const text = normalizeOcrText(item && (item.text || item.ocrText || item.value));
      const readableChars = countReadableOcrChars(text);
      return {
        imageUrl: String(item && (item.imageUrl || item.url) || '').trim(),
        text,
        index: Number(item && item.index) || index + 1,
        readableChars,
        substantial: readableChars >= 80,
      };
    })
    .filter((item) => item.text && item.readableChars >= 15);
}

function isLikelyImageTextNote(items = []) {
  const normalized = normalizeXiaohongshuOcrItems(items);
  const total = normalized.reduce((sum, item) => sum + item.readableChars, 0);
  const imageTextCount = normalized.filter((item) => item.readableChars >= 40).length;
  return normalized.some((item) => item.readableChars >= 80)
    || imageTextCount >= 2
    || total >= 120;
}

function buildXiaohongshuOcrMarkdown(items = []) {
  const normalized = normalizeXiaohongshuOcrItems(items);
  if (!normalized.length) return '';
  const lines = [
    '## 图片文字 OCR（测试版）',
    '',
    isLikelyImageTextNote(normalized)
      ? '> 检测到图片里有较多文字，下面是 OCR 识别结果；原图片仍保留在上方。'
      : '> 下面是图片中的少量可识别文字；原图片仍保留在上方。',
    '',
  ];
  normalized.forEach((item, index) => {
    const displayIndex = Number.isFinite(item.index) && item.index > 0 ? item.index : index + 1;
    lines.push(`### 图片 ${displayIndex}`, '', item.text, '');
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function appendXiaohongshuOcrMarkdown(markdown, items = []) {
  const ocrMarkdown = buildXiaohongshuOcrMarkdown(items);
  if (!ocrMarkdown) return String(markdown || '').trim();
  const source = String(markdown || '').trim();
  return `${source}\n\n${ocrMarkdown}`.trim();
}

function extractSocialVideoMarkdownFromHtml(html, url, platform = '视频') {
  url = cleanDisplayUrl(url);
  const source = String(html || '');
  const title = extractMetaContent(source, ['og:title', 'twitter:title'])
    || extractHtmlTitle(source)
    || `${platform}视频`;
  const description = cleanSocialDescription(
    extractMetaContent(source, ['description', 'og:description', 'twitter:description'])
    || stripHtmlTags(selectReadableHtml(source)),
  );
  const tags = extractTagsFromText(description, source);
  const videoUrl = extractVideoUrlFromHtml(source);
  const lines = [
    '## 标题',
    '',
    title,
    '',
    '## 视频文案',
    '',
    description || '页面未直接暴露视频文案，原始链接已写入笔记属性。',
    '',
  ];

  if (tags.length) {
    lines.push('## 标签', '', ...tags.map((tag) => `- ${tag}`), '');
  }

  if (videoUrl) {
    lines.push('## 视频源', '', `[视频文件](${videoUrl})`, '');
  }

  return {
    title,
    description,
    tags,
    platform,
    markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    videoUrl,
  };
}

const WECHAT_CHANNELS_MEDIA_URL_KEYS = [
  'videoUrl',
  'video_url',
  'mediaUrl',
  'media_url',
  'downloadUrl',
  'download_url',
  'fileUrl',
  'file_url',
  'url',
];

const WECHAT_CHANNELS_MEDIA_URL_TOKEN_KEYS = [
  'urlToken',
  'url_token',
  'token',
];

const WECHAT_CHANNELS_DECODE_KEY_KEYS = [
  'decodeKey',
  'decode_key',
  'decodekey',
  'decryptKey',
  'decrypt_key',
  'decryptkey',
];

const WECHAT_CHANNELS_COVER_URL_KEYS = [
  'coverUrl',
  'cover_url',
  'thumbUrl',
  'thumb_url',
  'fullThumbUrl',
  'full_thumb_url',
  'poster',
  'posterUrl',
];

const WECHAT_CHANNELS_MEDIA_CONTAINER_KEYS = [
  'object',
  'object_desc',
  'objectDesc',
  'objectList',
  'object_list',
  'media',
  'mediaList',
  'media_list',
  'h264VideoInfo',
  'h264_video_info',
  'h265VideoInfo',
  'h265_video_info',
  'videoInfo',
  'video_info',
  'objectDesc',
  'object_desc',
  'feedInfo',
  'feed_info',
  'data',
];

function isWechatChannelsPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function readWechatChannelsString(object, keys) {
  if (!isWechatChannelsPlainObject(object)) return '';
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function isWechatChannelsImageUrl(url) {
  return /\.(?:jpg|jpeg|png|webp|gif|svg)(?:[?#]|$)/i.test(String(url || ''));
}

function isLikelyWechatChannelsMediaUrl(url) {
  const value = normalizeExtractedUrl(url);
  if (!/^https?:\/\//i.test(value) || isWechatChannelsImageUrl(value)) return false;
  return /finder\.video\.qq\.com|mpvideo|video|media|\.mp4|\.m4s|\.m3u8|mime_type=video/i.test(value);
}

function appendWechatChannelsUrlToken(url, token) {
  const baseUrl = normalizeExtractedUrl(url);
  const normalizedToken = decodeHtmlEntities(String(token || '').trim());
  if (!baseUrl || !normalizedToken) return baseUrl;
  if (/^https?:\/\//i.test(normalizedToken)) return normalizeExtractedUrl(normalizedToken);
  if (baseUrl.includes(normalizedToken)) return baseUrl;
  if (/^[?&]/.test(normalizedToken)) return `${baseUrl}${normalizedToken}`;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${normalizedToken.replace(/^[?&]/, '')}`;
}

function pushWechatChannelsMediaCandidate(candidates, object, forceMediaObject = false) {
  if (!isWechatChannelsPlainObject(object)) return;
  const url = appendWechatChannelsUrlToken(
    readWechatChannelsString(object, WECHAT_CHANNELS_MEDIA_URL_KEYS),
    readWechatChannelsString(object, WECHAT_CHANNELS_MEDIA_URL_TOKEN_KEYS),
  );
  if (!/^https?:\/\//i.test(url) || isWechatChannelsImageUrl(url)) return;
  if (!forceMediaObject && !isLikelyWechatChannelsMediaUrl(url)) return;
  const decodeKey = readWechatChannelsString(object, WECHAT_CHANNELS_DECODE_KEY_KEYS);
  const coverUrl = normalizeExtractedUrl(readWechatChannelsString(object, WECHAT_CHANNELS_COVER_URL_KEYS));
  const durationValue = Number(object.videoPlayLen || object.duration || object.durationSeconds || object.duration_seconds || 0);
  const fileSizeValue = Number(object.fileSize || object.file_size || object.size || 0);
  const resolution = readWechatChannelsString(object, ['videoResolution', 'video_resolution', 'resolution']);
  if (!candidates.some((candidate) => candidate.url === url)) {
    candidates.push({
      url,
      decodeKey,
      decryptKey: decodeKey,
      coverUrl,
      durationSeconds: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : 0,
      fileSize: Number.isFinite(fileSizeValue) && fileSizeValue > 0 ? fileSizeValue : 0,
      resolution,
    });
  }
}

function collectWechatChannelsMediaCandidates(value, candidates = [], seen = new Set(), forceMediaObject = false) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectWechatChannelsMediaCandidates(item, candidates, seen, forceMediaObject));
    return candidates;
  }
  if (!isWechatChannelsPlainObject(value) || seen.has(value)) return candidates;
  seen.add(value);

  pushWechatChannelsMediaCandidate(candidates, value, forceMediaObject);

  for (const key of WECHAT_CHANNELS_MEDIA_CONTAINER_KEYS) {
    if (value[key] !== undefined && value[key] !== null) {
      const childIsMediaObject = forceMediaObject
        || key.toLowerCase().includes('media')
        || key.toLowerCase().includes('video');
      collectWechatChannelsMediaCandidates(value[key], candidates, seen, childIsMediaObject);
    }
  }

  return candidates;
}

function getWechatChannelsMediaCandidates(feedInfo) {
  return collectWechatChannelsMediaCandidates(feedInfo);
}

function getWechatChannelsVideoUrl(feedInfo) {
  const firstMedia = getWechatChannelsMediaCandidates(feedInfo)[0] || {};
  return firstMedia.url || '';
}

function buildWechatChannelsTitle(description, fallback = '视频号文案') {
  const firstLine = String(description || '')
    .replace(/#[\p{L}\p{N}_-]{1,32}/gu, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
  return sanitizeNoteTitlePart(truncateByChars(firstLine, 32), fallback);
}

function normalizeWechatChannelsFeedPayload(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const data = root.data && typeof root.data === 'object' ? root.data : {};
  const objectInfo = data.object && typeof data.object === 'object' ? data.object
    : data.object_info && typeof data.object_info === 'object' ? data.object_info
      : {};
  const feedInfo = data.feedInfo && typeof data.feedInfo === 'object' ? data.feedInfo
    : data.feed_info && typeof data.feed_info === 'object' ? data.feed_info
      : {};
  const objectDesc = data.object_desc && typeof data.object_desc === 'object' ? data.object_desc
    : data.objectDesc && typeof data.objectDesc === 'object' ? data.objectDesc
      : objectInfo.object_desc && typeof objectInfo.object_desc === 'object' ? objectInfo.object_desc
        : objectInfo.objectDesc && typeof objectInfo.objectDesc === 'object' ? objectInfo.objectDesc
      : feedInfo.object_desc && typeof feedInfo.object_desc === 'object' ? feedInfo.object_desc
        : feedInfo.objectDesc && typeof feedInfo.objectDesc === 'object' ? feedInfo.objectDesc
          : {};
  const authorInfo = data.authorInfo && typeof data.authorInfo === 'object' ? data.authorInfo
    : data.author_info && typeof data.author_info === 'object' ? data.author_info
      : objectInfo.contact && typeof objectInfo.contact === 'object' ? objectInfo.contact
        : objectInfo.authorInfo && typeof objectInfo.authorInfo === 'object' ? objectInfo.authorInfo
      : {};
  const sceneInfo = data.sceneInfo && typeof data.sceneInfo === 'object' ? data.sceneInfo
    : data.scene_info && typeof data.scene_info === 'object' ? data.scene_info
      : {};
  const errMsg = data.errMsg && typeof data.errMsg === 'object' ? data.errMsg : {};
  const description = cleanSocialDescription(
    feedInfo.description || feedInfo.desc
    || objectDesc.description || objectDesc.desc
    || data.description || data.desc
    || '',
  );
  const mediaCandidates = getWechatChannelsMediaCandidates(root);
  const mediaUrls = mediaCandidates.map((candidate) => candidate.url);
  const firstMedia = mediaCandidates[0] || {};
  const decodeKey = firstMedia.decodeKey || (mediaCandidates.find((candidate) => candidate.decodeKey) || {}).decodeKey || '';
  const videoUrl = firstMedia.url || getWechatChannelsVideoUrl(feedInfo);
  const coverUrl = normalizeExtractedUrl(
    firstMedia.coverUrl
    || feedInfo.coverUrl || feedInfo.cover_url
    || objectDesc.coverUrl || objectDesc.cover_url || objectDesc.thumbUrl || objectDesc.thumb_url
    || data.coverUrl || data.cover_url
    || '',
  );
  return {
    title: buildWechatChannelsTitle(description),
    author: cleanSocialDescription(authorInfo.nickname || authorInfo.nickName || ''),
    description,
    tags: extractTagsFromText(description),
    coverUrl,
    videoUrl,
    mediaUrls,
    mediaItems: mediaCandidates,
    decodeKey,
    dynamicExportId: String(sceneInfo.dynamicExportId || sceneInfo.dynamic_export_id || objectInfo.id || objectInfo.exportId || ''),
    errMsg: String(errMsg.title || errMsg.content || root.errMsg || '').trim(),
  };
}

function pushWechatChannelsProfile(profiles, profile, sourceUrl = '') {
  if (!profile || typeof profile !== 'object') return;
  const mediaItems = Array.isArray(profile.mediaItems) ? profile.mediaItems : [];
  if (!mediaItems.length && !profile.videoUrl) return;
  const normalizedProfile = {
    ...profile,
    sourceUrl: sourceUrl || profile.sourceUrl || '',
    mediaItems,
    mediaUrls: Array.isArray(profile.mediaUrls) ? profile.mediaUrls : mediaItems.map((item) => item.url).filter(Boolean),
    videoUrl: profile.videoUrl || (mediaItems[0] && mediaItems[0].url) || '',
  };
  const key = [
    normalizedProfile.videoUrl,
    ...normalizedProfile.mediaItems.map((item) => item && item.url).filter(Boolean),
  ].join('|');
  if (!key || profiles.some((item) => [
    item.videoUrl,
    ...((item.mediaItems || []).map((media) => media && media.url).filter(Boolean)),
  ].join('|') === key)) return;
  profiles.push(normalizedProfile);
}

function collectWechatChannelsProfiles(value, profiles = [], seen = new Set(), sourceUrl = '') {
  if (Array.isArray(value)) {
    value.forEach((item) => collectWechatChannelsProfiles(item, profiles, seen, sourceUrl));
    return profiles;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return profiles;
  seen.add(value);

  [
    normalizeWechatChannelsFeedPayload(value),
    normalizeWechatChannelsFeedPayload({ data: value }),
    normalizeWechatChannelsFeedPayload({ data: { object: value } }),
  ].forEach((profile) => pushWechatChannelsProfile(profiles, profile, sourceUrl));

  Object.keys(value).forEach((key) => {
    if (/data|object|feed|media|video|desc|list|item|response/i.test(key)) {
      collectWechatChannelsProfiles(value[key], profiles, seen, sourceUrl);
    }
  });
  return profiles;
}

function extractWechatChannelsProfilesFromText(text, sourceUrl = '') {
  const source = typeof text === 'string' ? text : JSON.stringify(text || {});
  const parsed = typeof text === 'string' ? tryParseJson(source) : text;
  const profiles = [];
  if (parsed && typeof parsed === 'object') {
    collectWechatChannelsProfiles(parsed, profiles, new Set(), sourceUrl);
  }
  return profiles;
}

function buildWechatChannelsPreviewUrl(url) {
  const payload = extractWechatChannelsRequestPayload(url);
  if (payload.shortUri) {
    return `https://channels.weixin.qq.com/finder-preview/pages/sph?id=${encodeURIComponent(payload.shortUri)}`;
  }
  if (payload.exportId) {
    return `https://channels.weixin.qq.com/web/pages/feed?eid=${encodeURIComponent(payload.exportId)}`;
  }
  return String(url || '');
}

function buildWechatChannelsUnavailableMarkdown(url, feed = {}, reason = '') {
  const lines = [
    '原始链接：' + cleanDisplayUrl(url),
    '',
    '## 视频号口播文案',
    '',
    '未能提取视频号口播文案。',
    '',
    reason || '视频号网页端未返回可转写的视频资源。',
    '',
    '这通常表示当前分享链接在网页端只公开了发布简介、封面等信息，未公开真实视频播放地址。可以尝试重新从微信内分享链接；如果仍失败，请把视频保存到相册或导出为 MP4/音频后，通过小程序上传素材，插件会按原视频文件自动转写。',
  ];
  if (feed.description) {
    lines.push('', '## 发布简介（仅供定位，不作为口播转写）', '', feed.description);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanHtmlCodeText(html) {
  return decodeHtmlEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/^\n+|\n+$/g, '');
}

function htmlCodeBlockToMarkdown(html) {
  const code = cleanHtmlCodeText(html);
  if (!code.trim()) return '';
  return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
}

function stripHtmlTags(html) {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHtmlTextByClass(html, classPattern) {
  const pattern = /<([a-z][\w:-]*)\b[^>]*class=["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  const candidates = [];
  let match;
  while ((match = pattern.exec(String(html || '')))) {
    if (classPattern.test(match[2] || '')) {
      const text = stripHtmlTags(match[3]);
      if (text) candidates.push({ className: match[2] || '', text });
    }
  }
  candidates.sort((a, b) => {
    const aExact = /(^|\s)(comment[_-]?content|js_comment_content|discuss_message_content)(\s|$)/i.test(a.className) ? 1 : 0;
    const bExact = /(^|\s)(comment[_-]?content|js_comment_content|discuss_message_content)(\s|$)/i.test(b.className) ? 1 : 0;
    return bExact - aExact || a.text.length - b.text.length;
  });
  return candidates[0]?.text || '';
}

function decodeJsonLikeText(value) {
  return decodeHtmlEntities(decodeJsonStringLiteral(String(value || '')))
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSocialComment(comment) {
  const author = String(comment.author || '').replace(/^[:：]+|[:：]+$/g, '').trim();
  const content = String(comment.content || '').replace(/\s+/g, ' ').trim();
  if (!content || content.length < 2) return null;
  if (isNoisySocialCommentContent(content, author)) return null;
  return {
    author,
    content,
    time: String(comment.time || '').trim(),
    likes: String(comment.likes || '').trim(),
  };
}

function isNoisySocialCommentContent(content, author = '') {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  const byAuthor = String(author || '').trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^(?:回复|评论|点赞|分享|收藏|展开|收起|查看|更多|写评论|发布|发送)$/.test(text)) return true;
  if (/^共\s*\d+\s*(?:条|則|个)?\s*(?:评论|回复)/.test(text)) return true;
  if (/(?:共\s*\d+\s*(?:条|个)?\s*评论).*(?:回复|展开|查看)/.test(text)) return true;
  if (!byAuthor && text.length <= 4 && /^[\d\s赞回复评论]+$/.test(text)) return true;
  return false;
}

function pushSocialComment(comments, seen, comment) {
  const normalized = normalizeSocialComment(comment || {});
  if (!normalized) return;
  const key = `${normalized.author}|${normalized.content}`;
  if (seen.has(key)) return;
  seen.add(key);
  comments.push(normalized);
}

function mergeSocialComments(groups = [], limit = 50) {
  const comments = [];
  const seen = new Set();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((comment) => {
      if (comments.length < limit) pushSocialComment(comments, seen, comment);
    });
  });
  return comments.slice(0, limit);
}

function pushWechatComment(comments, seen, comment) {
  pushSocialComment(comments, seen, comment);
}

function readCommentField(item, keys) {
  for (const key of keys) {
    if (item && Object.prototype.hasOwnProperty.call(item, key) && item[key] !== undefined && item[key] !== null) {
      const value = item[key];
      if (typeof value === 'object') {
        const nested = readCommentField(value, ['text', 'content', 'contentText', 'commentText', 'value', 'nickname', 'nickName', 'name']);
        if (nested) return nested;
      } else {
        const text = String(value).trim();
        if (text) return text;
      }
    }
  }
  return '';
}

function extractCommentsFromObject(value, comments, seen, limit = 20, depth = 0) {
  if (!value || depth > 8 || comments.length >= limit) return;
  if (Array.isArray(value)) {
    value.forEach((item) => extractCommentsFromObject(item, comments, seen, limit, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;

  const content = readCommentField(value, [
    'content',
    'contentText',
    'content_text',
    'text',
    'commentText',
    'comment_text',
    'commentContent',
    'comment_content',
    'noteText',
    'note_text',
    'desc',
    'message',
  ]);
  if (content) {
    const author = readCommentField(value, [
      'nick_name',
      'nickname',
      'nickName',
      'userNickname',
      'user_nickname',
      'userName',
      'name',
      'author',
    ]) || readCommentField(value.user || value.userInfo || value.user_info || value.authorInfo || value.author_info || {}, [
      'nick_name',
      'nickname',
      'nickName',
      'userName',
      'user_name',
      'name',
    ]);
    const time = readCommentField(value, ['create_time', 'createTime', 'time', 'date']);
    const likes = readCommentField(value, ['like_num', 'likeNum', 'likeCount', 'likedCount', 'liked_count', 'like_count', 'likes']);
    pushSocialComment(comments, seen, { author, content, time, likes });
  }

  Object.keys(value).forEach((key) => {
    if (comments.length >= limit) return;
    const child = value[key];
    if (/comment|cmt|reply|discuss/i.test(key) || (Array.isArray(child) && /^(?:list|items|entries|data)$/i.test(key))) {
      extractCommentsFromObject(child, comments, seen, limit, depth + 1);
    }
  });
}

function collectJsonObjectCandidates(source) {
  const candidates = [];
  const text = String(source || '');
  const starts = [];
  const objectPattern = /(?:__INITIAL_STATE__|INITIAL_STATE|elected_comment|comment(?:List|_list|s)?|comments|cmt_list|reply_list|discussion)\s*[:=]\s*([\[{])/gi;
  let match;
  while ((match = objectPattern.exec(text))) {
    starts.push(objectPattern.lastIndex - 1);
  }
  starts.forEach((start) => {
    const open = text[start];
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === open) depth += 1;
      if (char === close) depth -= 1;
      if (depth === 0) {
        candidates.push(text.slice(start, index + 1));
        break;
      }
    }
  });
  return candidates;
}

function parseLooseJsonCandidate(text) {
  const source = String(text || '').trim();
  return tryParseJson(source)
    || tryParseJson(source
      .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      .replace(/'/g, '"'));
}

function extractWechatCommentsFromJson(html, comments, seen) {
  const source = String(html || '');
  collectJsonObjectCandidates(source).forEach((candidate) => {
    extractCommentsFromObject(parseLooseJsonCandidate(candidate), comments, seen);
  });
  const patterns = [
    /"nick_?name"\s*:\s*"((?:\\.|[^"\\])*)"\s*,[\s\S]{0,900}?"content"\s*:\s*"((?:\\.|[^"\\])*)"/gi,
    /"content"\s*:\s*"((?:\\.|[^"\\])*)"\s*,[\s\S]{0,900}?"nick_?name"\s*:\s*"((?:\\.|[^"\\])*)"/gi,
  ];

  patterns.forEach((pattern, patternIndex) => {
    let match;
    while ((match = pattern.exec(source))) {
      const author = patternIndex === 0 ? match[1] : match[2];
      const content = patternIndex === 0 ? match[2] : match[1];
      pushWechatComment(comments, seen, {
        author: decodeJsonLikeText(author),
        content: decodeJsonLikeText(content),
      });
    }
  });
}

function extractWechatCommentsFromHtml(html, limit = 20) {
  const source = String(html || '');
  const comments = [];
  const seen = new Set();
  const areaMatch = source.match(/<[^>]+id=["']js_cmt_area["'][^>]*>([\s\S]*?)(?:<script\b|<\/body>|$)/i);
  const area = areaMatch && areaMatch[1] ? areaMatch[1] : source;
  const itemPattern = /<((?:li|div))\b[^>]*(?:class|id)=["'][^"']*(?:comment|cmt)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = itemPattern.exec(area))) {
    const item = match[2] || '';
    const content = extractHtmlTextByClass(item, /(?:comment[_-]?content|js_comment_content|discuss_message_content|content|message)/i)
      || stripHtmlTags(item);
    const author = extractHtmlTextByClass(item, /(?:nickname|nick[_-]?name|comment[_-]?name|user[_-]?name|author)/i);
    const time = extractHtmlTextByClass(item, /(?:time|date)/i);
    const likes = extractHtmlTextByClass(item, /(?:like|praise|赞)/i);
    pushWechatComment(comments, seen, { author, content, time, likes });
    if (comments.length >= limit) return comments;
  }

  extractWechatCommentsFromJson(source, comments, seen);
  return comments.slice(0, limit);
}

function extractSocialCommentsFromHtml(html, limit = 20) {
  const source = String(html || '');
  const comments = [];
  const seen = new Set();
  const itemPattern = /<((?:li|div|section|article))\b[^>]*(?:class|id)=["'][^"']*(?:comment|cmt|reply|discuss)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = itemPattern.exec(source))) {
    const item = match[2] || '';
    const content = extractHtmlTextByClass(item, /(?:comment[_-]?content|content|message|text|desc)/i)
      || stripHtmlTags(item);
    const author = extractHtmlTextByClass(item, /(?:nickname|nick[_-]?name|user[_-]?name|user-name|author|name)/i);
    const time = extractHtmlTextByClass(item, /(?:time|date)/i);
    const likes = extractHtmlTextByClass(item, /(?:like|liked|praise|赞)/i);
    pushSocialComment(comments, seen, { author, content, time, likes });
    if (comments.length >= limit) return comments;
  }
  collectJsonObjectCandidates(source).forEach((candidate) => {
    extractCommentsFromObject(parseLooseJsonCandidate(candidate), comments, seen, limit);
  });
  return comments.slice(0, limit);
}

function buildSocialCommentsMarkdown(comments = []) {
  const items = (comments || []).map(normalizeSocialComment).filter(Boolean);
  if (!items.length) return '';
  const lines = ['## 评论区', ''];
  items.forEach((comment) => {
    const meta = [comment.time, comment.likes ? `${comment.likes} 赞` : ''].filter(Boolean).join(' · ');
    const prefix = comment.author ? `**${comment.author}**：` : '';
    lines.push(`- ${prefix}${comment.content}${meta ? `（${meta}）` : ''}`);
  });
  return lines.join('\n').trim();
}

function buildWechatCommentsMarkdown(comments = []) {
  return buildSocialCommentsMarkdown(comments);
}

function appendSocialCommentsToMarkdown(markdown, comments = []) {
  const source = String(markdown || '').trim();
  if (!source || /(^|\n)##\s+评论区\b/.test(source)) return source;
  const commentMarkdown = buildSocialCommentsMarkdown(comments);
  return commentMarkdown ? `${source}\n\n${commentMarkdown}` : source;
}

function appendWechatCommentsToMarkdown(markdown, htmlOrComments) {
  const source = String(markdown || '').trim();
  if (!source || /(^|\n)##\s+评论区\b/.test(source)) return source;
  const comments = Array.isArray(htmlOrComments)
    ? htmlOrComments
    : extractWechatCommentsFromHtml(htmlOrComments);
  return appendSocialCommentsToMarkdown(markdown, comments);
}

function isXiaohongshuCommentApiUrl(url) {
  return /xiaohongshu\.com\/api\/sns\/web\/v\d+\/comment/i.test(String(url || ''));
}

function sanitizeXiaohongshuCapturedHeaders(headers = {}, cookieHeader = '') {
  const result = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    const name = String(key || '').trim();
    if (!name || /^(?:host|content-length|connection|accept-encoding)$/i.test(name)) return;
    if (typeof value === 'undefined' || value === null) return;
    result[name] = value;
  });
  if (cookieHeader && !Object.keys(result).some((key) => /^cookie$/i.test(key))) {
    result.Cookie = cookieHeader;
  }
  if (!Object.keys(result).some((key) => /^referer$/i.test(key))) {
    result.Referer = 'https://www.xiaohongshu.com/';
  }
  if (!Object.keys(result).some((key) => /^user-agent$/i.test(key))) {
    result['User-Agent'] = 'Mozilla/5.0 WeChat-Inbox-Sync';
  }
  return result;
}

async function fetchXiaohongshuCommentsFromCapturedRequests(commentApiRequests = [], limit = 50) {
  const comments = [];
  const seen = new Set();
  const cookieHeader = await getXiaohongshuCookieHeader();
  const uniqueRequests = [];
  const seenUrls = new Set();
  (commentApiRequests || []).forEach((request) => {
    const url = String(request && request.url || '').trim();
    if (!isXiaohongshuCommentApiUrl(url) || seenUrls.has(url)) return;
    seenUrls.add(url);
    uniqueRequests.push(request);
  });
  for (const request of uniqueRequests.slice(-8)) {
    if (comments.length >= limit) break;
    try {
      const response = await requestJsonViaNode({
        url: request.url,
        method: 'GET',
        headers: sanitizeXiaohongshuCapturedHeaders(request.requestHeaders || {}, cookieHeader),
        timeout: 15000,
      });
      if (!response || response.status < 200 || response.status >= 300) continue;
      if (response.json) {
        extractCommentsFromObject(response.json, comments, seen, limit);
      } else if (response.text) {
        collectJsonObjectCandidates(response.text).forEach((candidate) => {
          extractCommentsFromObject(parseLooseJsonCandidate(candidate), comments, seen, limit);
        });
      }
    } catch (error) {}
  }
  return comments.slice(0, limit);
}

function extractHtmlTitle(html) {
  const ogTitle = String(html || '').match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle && ogTitle[1]) {
    return decodeHtmlEntities(ogTitle[1]).trim();
  }
  const title = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title && title[1] ? stripHtmlTags(title[1]) : '';
}

function selectReadableHtml(html) {
  const source = String(html || '');
  const wechatContent = source.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<script/i);
  if (wechatContent && wechatContent[1]) return wechatContent[1];

  const article = source.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article && article[1]) return article[1];

  const main = source.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main && main[1]) return main[1];

  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body && body[1] ? body[1] : source;
}

function isWechatCaptchaHtml(html) {
  const text = stripHtmlTags(String(html || ''));
  return /环境异常/.test(text)
    && /完成验证后即可继续访问|去验证/.test(text);
}

function buildWechatCaptchaMarkdown(url, html = '') {
  const targetUrl = cleanDisplayUrl(extractWechatCaptchaTargetUrl(url));
  const lines = [
    '公众号文章触发了微信安全验证。',
    '',
    '这不是插件解析失败，而是微信返回了验证页；插件不能自动绕过这个验证。',
    '',
    '建议处理方式：',
    '',
    '- 在微信内打开原文，完成验证后再复制正文保存。',
    '- 或从公众号文章页使用“选择小程序工具”打开本小程序保存。',
    '',
  ];

  if (targetUrl) {
    lines.push(`原始文章链接：${targetUrl}`, '');
  }
  lines.push(`验证页链接：${url || ''}`, '');

  const title = extractHtmlTitle(html);
  if (title && !/wappoc_appmsgcaptcha/i.test(title)) {
    lines.unshift(title, '');
  }

  return lines.join('\n').trim();
}

function buildXiaohongshuFallbackMarkdown(url, reason = '') {
  return [
    '小红书链接已保存。',
    '',
    `原始链接：${url || ''}`,
    '',
    reason ? `> 小红书视频转写失败：${reason}` : '',
    '> 如果这是视频笔记且需要口播/音频文案，请从手机相册或文件导入视频；如果只是图文笔记，正文会在页面公开内容可访问时自动保存。',
  ].filter((line) => line !== '').join('\n');
}

function imageTagToMarkdown(tag) {
  const sourceMatch = String(tag || '').match(/\s(?:data-src|src)=["']([^"']+)["']/i);
  if (!sourceMatch || !sourceMatch[1]) return '';
  const altMatch = String(tag || '').match(/\salt=["']([^"']*)["']/i);
  const alt = altMatch && altMatch[1] ? stripHtmlTags(altMatch[1]) : '图片';
  return `\n\n![${alt}](${decodeHtmlEntities(sourceMatch[1])})\n\n`;
}

function escapeMarkdownTableCell(value) {
  return decodeHtmlEntities(stripHtmlTags(value))
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function htmlTableToMarkdown(tableHtml) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(String(tableHtml || '')))) {
    const cells = [];
    const cellPattern = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1] || ''))) {
      cells.push(escapeMarkdownTableCell(cellMatch[1] || ''));
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  if (!rows.length) return stripHtmlTags(tableHtml);

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const next = row.slice(0, columnCount);
    while (next.length < columnCount) next.push('');
    return next;
  });
  const header = normalizedRows[0];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  return `\n\n${lines.join('\n')}\n\n`;
}

function isBlankMarkdownLine(line) {
  return !String(line || '').trim();
}

function findNextNonBlankLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!isBlankMarkdownLine(lines[index])) return index;
  }
  return -1;
}

function buildMarkdownTableFromRows(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

function restoreFlattenedSarBandTables(lines) {
  const headers = ['频段', '频率', '波长', '应用方向'];
  const firstColumnPattern = /^(?:Ka|K|Ku|X|C|S|L|P)$/i;
  const out = [];

  for (let index = 0; index < lines.length;) {
    const firstHeaderIndex = findNextNonBlankLine(lines, index);
    if (firstHeaderIndex !== index || lines[index] !== headers[0]) {
      out.push(lines[index]);
      index += 1;
      continue;
    }

    let cursor = index;
    let matchedHeaders = true;
    for (const header of headers) {
      const nextIndex = findNextNonBlankLine(lines, cursor);
      if (nextIndex < 0 || lines[nextIndex] !== header) {
        matchedHeaders = false;
        break;
      }
      cursor = nextIndex + 1;
    }
    if (!matchedHeaders) {
      out.push(lines[index]);
      index += 1;
      continue;
    }

    const rows = [];
    let rowCursor = cursor;
    while (rowCursor < lines.length) {
      const row = [];
      const indexes = [];
      let cellCursor = rowCursor;
      for (let cellIndex = 0; cellIndex < headers.length; cellIndex += 1) {
        const nextIndex = findNextNonBlankLine(lines, cellCursor);
        if (nextIndex < 0) break;
        row.push(String(lines[nextIndex] || '').trim());
        indexes.push(nextIndex);
        cellCursor = nextIndex + 1;
      }
      if (row.length !== headers.length || !firstColumnPattern.test(row[0])) break;
      rows.push(row);
      rowCursor = indexes[indexes.length - 1] + 1;
    }

    if (rows.length < 2) {
      out.push(lines[index]);
      index += 1;
      continue;
    }

    if (out.length && !isBlankMarkdownLine(out[out.length - 1])) out.push('');
    out.push(...buildMarkdownTableFromRows(headers, rows));
    out.push('');
    index = rowCursor;
  }

  return out;
}

function htmlToMarkdown(html) {
  const sourceHtml = String(html || '');
  let readable = selectReadableHtml(sourceHtml)
    .replace(/<[^>]+id=["']js_cmt_area["'][^>]*>[\s\S]*?(?=<script\b|<\/body>|$)/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => htmlCodeBlockToMarkdown(code))
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => htmlTableToMarkdown(table))
    .replace(/<img\b[^>]*>/gi, imageTagToMarkdown)
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = stripHtmlTags(label);
      return text ? `[${text}](${decodeHtmlEntities(href)})` : decodeHtmlEntities(href);
    });

  readable = cleanMarkdownForStorage(stripHtmlTags(readable));

  if (readable.length < 20) {
    throw new Error('网页正文太短，无法转为 Markdown');
  }
  return readable;
}

function getElectronBrowserWindow() {
  try {
    const electron = require('electron');
    return (electron.remote && electron.remote.BrowserWindow) || electron.BrowserWindow || null;
  } catch (error) {
    return null;
  }
}

function getElectronRemote() {
  try {
    const electron = require('electron');
    return electron.remote || null;
  } catch (error) {
    return null;
  }
}

function getWechatSession() {
  const remote = getElectronRemote();
  if (!remote) return null;
  try {
    return remote.session.fromPartition(WECHAT_SESSION_PARTITION);
  } catch (error) {
    return null;
  }
}

function getXiaohongshuSession() {
  const remote = getElectronRemote();
  if (!remote) return null;
  try {
    return remote.session.fromPartition(XIAOHONGSHU_SESSION_PARTITION);
  } catch (error) {
    return null;
  }
}

async function checkWechatLoginStatus() {
  const session = getWechatSession();
  if (!session) return false;
  try {
    const cookies = await session.cookies.get({ domain: 'mp.weixin.qq.com' });
    return cookies.some((cookie) => cookie.name === 'wap_sid2' || cookie.name === 'wxuin');
  } catch (error) {
    return false;
  }
}

async function checkFeishuLoginStatus() {
  const session = getWechatSession();
  if (!session) return false;
  try {
    const cookies = await session.cookies.get({ domain: '.feishu.cn' });
    return cookies.some((cookie) => cookie.name === 'session' || cookie.name === 'passport_web_did');
  } catch (error) {
    return false;
  }
}

async function getXiaohongshuCookies() {
  const session = getXiaohongshuSession();
  if (!session) return [];
  try {
    const groups = await Promise.all([
      session.cookies.get({ domain: '.xiaohongshu.com' }),
      session.cookies.get({ domain: 'www.xiaohongshu.com' }),
    ]);
    const seen = new Set();
    return groups
      .flat()
      .filter((cookie) => cookie && cookie.name && !seen.has(cookie.name) && seen.add(cookie.name));
  } catch (error) {
    return [];
  }
}

function hasXiaohongshuLoginCookies(cookies = []) {
  return (cookies || []).some((cookie) => {
    const name = String(cookie && cookie.name || '').trim();
    const value = String(cookie && cookie.value || '').trim();
    if (name !== 'web_session') return false;
    if (!value || /^(?:null|undefined|deleted|expired)$/i.test(value)) return false;
    return value.length >= 8;
  });
}

async function checkXiaohongshuLoginStatus() {
  const cookies = await getXiaohongshuCookies();
  return hasXiaohongshuLoginCookies(cookies);
}

async function probeXiaohongshuLoginStatus(targetUrl = '') {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    return await checkXiaohongshuLoginStatus();
  }
  const session = getXiaohongshuSession();
  if (!session) return false;
  const win = new BrowserWindow({
    width: 980,
    height: 820,
    show: false,
    webPreferences: {
      session,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    const url = targetUrl || 'https://www.xiaohongshu.com/';
    const loaded = waitForWebContents(win.webContents, 15000);
    await win.loadURL(url);
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const state = await win.webContents.executeJavaScript(`
      (async () => {
        const text = String(document.body && (document.body.innerText || document.body.textContent) || '').replace(/\\s+/g, ' ').trim();
        const hasLoginWall = /登录后|请登录|登录小红书|手机号登录|验证码登录|扫码登录|未登录/.test(text);
        const hasUserSignal = Boolean(document.querySelector('[href*="/user/profile"], [class*="avatar"], [class*="user-info"], [class*="userInfo"]'));
        let hasAccountApiSignal = false;
        try {
          const response = await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo', {
            credentials: 'include',
            headers: { accept: 'application/json, text/plain, */*' },
          });
          const payload = await response.clone().json().catch(async () => ({ text: await response.text().catch(() => '') }));
          const payloadText = JSON.stringify(payload || {});
          hasAccountApiSignal = response.ok && /user_?id|nickname|red_?id|avatar/i.test(payloadText) && !/login|登录|unauthorized|forbidden/i.test(payloadText);
        } catch (error) {}
        return { hasLoginWall, hasUserSignal, hasAccountApiSignal, text: text.slice(0, 500) };
      })()
    `);
    if (state && state.hasLoginWall) return false;
    const hasCookie = await checkXiaohongshuLoginStatus();
    return Boolean(hasCookie && state && (state.hasAccountApiSignal || state.hasUserSignal));
  } catch (error) {
    return false;
  } finally {
    if (win && typeof win.destroy === 'function') {
      win.destroy();
    }
  }
}

async function getXiaohongshuCookieHeader() {
  const cookies = await getXiaohongshuCookies();
  return cookies
    .filter((cookie) => cookie && cookie.name && typeof cookie.value !== 'undefined')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function getXiaohongshuRequestHeaders(url) {
  const headers = getSocialRequestHeaders(url);
  const cookieHeader = await getXiaohongshuCookieHeader();
  if (cookieHeader) headers.Cookie = cookieHeader;
  return headers;
}

async function loginWechatWeb(articleUrl) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('当前 Obsidian 环境不支持浏览器窗口');
  }

  const session = getWechatSession();
  if (!session) {
    throw new Error('无法创建微信登录会话');
  }

  // Navigate to WeChat article page. If not logged in, the page will show a QR code
  // in the comment area prompting the user to scan with WeChat.
  const loginUrl = articleUrl || 'https://mp.weixin.qq.com/';

  return new Promise((resolve, reject) => {
    let settled = false;

    const win = new BrowserWindow({
      width: 820,
      height: 900,
      show: true,
      title: '微信扫码登录 — 登录后关闭窗口即可',
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (error) => {
      if (settled) return;
      settled = true;
      try {
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
      } catch (destroyError) {
        // Window may already be gone.
      }
      if (error) {
        reject(error);
        return;
      }
      const loggedIn = await checkWechatLoginStatus();
      resolve(loggedIn);
    };

    win.on('closed', () => finish());

    win.webContents.on('did-finish-load', async () => {
      const loggedIn = await checkWechatLoginStatus();
      if (loggedIn) {
        finish();
      }
    });

    win.loadURL(loginUrl).catch((error) => {
      finish(new Error(`打开微信登录页面失败：${error.message || error}`));
    });

    // Timeout after 5 minutes.
    setTimeout(() => {
      finish(new Error('微信登录超时（5分钟），请重试'));
    }, 5 * 60 * 1000);
  });
}

async function loginFeishuWeb(targetUrl) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('当前 Obsidian 环境不支持浏览器窗口');
  }

  const session = getWechatSession();
  if (!session) {
    throw new Error('无法创建飞书登录会话');
  }

  const loginUrl = targetUrl || 'https://my.feishu.cn/';

  return new Promise((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 1040,
      height: 860,
      show: true,
      title: '飞书网页登录 - 登录后关闭窗口即可',
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (error) => {
      if (settled) return;
      settled = true;
      try {
        const destroyed = typeof win.isDestroyed === 'function' ? win.isDestroyed() : false;
        if (win && typeof win.destroy === 'function' && !destroyed) {
          win.destroy();
        }
      } catch (destroyError) {}
      if (error) {
        reject(error);
        return;
      }
      resolve(await checkFeishuLoginStatus());
    };

    const timer = setInterval(async () => {
      try {
        await checkFeishuLoginStatus();
      } catch (error) {}
    }, 1500);

    win.on('closed', async () => {
      clearInterval(timer);
      finish();
    });
    win.loadURL(loginUrl).catch((error) => {
      clearInterval(timer);
      finish(error);
    });
  });
}

async function loginXiaohongshuWeb(targetUrl) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('当前 Obsidian 环境不支持浏览器窗口');
  }

  const session = getXiaohongshuSession();
  if (!session) {
    throw new Error('无法创建小红书登录会话');
  }

  const loginUrl = targetUrl || 'https://www.xiaohongshu.com/';

  return new Promise((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 1040,
      height: 860,
      show: true,
      title: '小红书网页登录 - 登录后关闭窗口即可',
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (error) => {
      if (settled) return;
      settled = true;
      try {
        const destroyed = typeof win.isDestroyed === 'function' ? win.isDestroyed() : false;
        if (win && typeof win.destroy === 'function' && !destroyed) {
          win.destroy();
        }
      } catch (destroyError) {}
      if (error) {
        reject(error);
        return;
      }
      resolve(await probeXiaohongshuLoginStatus(loginUrl));
    };

    win.on('closed', async () => {
      finish();
    });
    win.loadURL(loginUrl).catch((error) => {
      finish(error);
    });
  });
}

function getElectronShell() {
  const candidates = [];
  if (typeof require === 'function') candidates.push(require);
  if (typeof window !== 'undefined' && typeof window.require === 'function') candidates.push(window.require.bind(window));
  if (typeof globalThis !== 'undefined' && typeof globalThis.require === 'function') candidates.push(globalThis.require.bind(globalThis));

  for (const load of candidates) {
    try {
      const electron = load('electron');
      const shell = electron && ((electron.remote && electron.remote.shell) || electron.shell);
      if (shell && typeof shell.openExternal === 'function') {
        return shell;
      }
    } catch (error) {
      // Try the next Electron entry point.
    }
  }
  return null;
}

async function openExternalUrl(url) {
  const shell = getElectronShell();
  if (shell) {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
      // Fall back to browser APIs below.
    }
  }

  try {
    if (typeof window !== 'undefined' && window.open) {
      const opened = window.open(url, '_blank', 'noopener');
      if (opened) {
        return true;
      }
    }
  } catch (error) {
    // Fall back to location navigation below.
  }

  try {
    if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
      window.location.assign(url);
      return true;
    }
  } catch (error) {
    // Report failure to the caller.
  }

  return false;
}

function waitForWebContents(webContents, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    webContents.once('did-finish-load', () => {
      window.clearTimeout(timer);
      window.setTimeout(finish, 2500);
    });
    webContents.once('did-fail-load', () => {
      window.clearTimeout(timer);
      finish();
    });
  });
}

async function settleRenderedPage(webContents) {
  await webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      for (let index = 0; index < 18; index += 1) {
        const before = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        );
        window.scrollTo(0, before);
        document.querySelectorAll('[class*="scroll"], [class*="container"], [class*="content"], [class*="doc"]').forEach((node) => {
          try {
            if (node && node.scrollHeight > node.clientHeight) node.scrollTop = node.scrollHeight;
          } catch (error) {}
        });
        await sleep(700);
        const after = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        );
        if (Math.abs(after - before) < 20 && window.innerHeight + window.scrollY >= after - 8) break;
      }
      window.scrollTo(0, 0);
      await sleep(600);
      return true;
    })()
  `);
}

async function renderUrlToMarkdownWithElectron(url) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('当前 Obsidian 环境不支持隐藏浏览器渲染');
  }

  const wechatSession = isXiaohongshuUrl(url) ? getXiaohongshuSession() : getWechatSession();
  const win = new BrowserWindow({
    width: 1280,
    height: 1600,
    show: false,
    webPreferences: {
      session: wechatSession || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    const loaded = waitForWebContents(win.webContents);
    await win.loadURL(url);
    await loaded;
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const clean = (text) => String(text || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
        const isLoginPage = () => /accounts\\/(?:page\\/login|trap)|login\\.feishu\\.cn/i.test(location.href)
          || /扫码登录|登录飞书|Login Required/i.test(clean(document.body ? document.body.innerText || document.body.textContent || '' : ''));
        const getPathToken = () => {
          const match = String(location.pathname || '').match(/\\/(?:docx|wiki)\\/([^/?#]+)/i);
          return match ? decodeURIComponent(match[1]) : '';
        };
        const getFeishuClientVars = async () => {
          const token = getPathToken();
          const candidates = [
            window.DATA && window.DATA.clientVars && window.DATA.clientVars.data,
            window.DATA && token && window.DATA[token] && window.DATA[token].CLIENT_VARS && window.DATA[token].CLIENT_VARS.data,
            window.SERVER_DATA && window.SERVER_DATA.clientVars && window.SERVER_DATA.clientVars.data,
            window.SERVER_RUNTIME_DATA && window.SERVER_RUNTIME_DATA.clientVars && window.SERVER_RUNTIME_DATA.clientVars.data,
          ].filter(Boolean);
          const existing = candidates.find((item) => item && (item.block_map || item.blockMap));
          if (existing) return existing;
          if (!token || isLoginPage()) return null;
          try {
            const response = await fetch('/space/api/docx/pages/client_vars?id=' + encodeURIComponent(token), {
              credentials: 'include',
              headers: { accept: 'application/json, text/plain, */*' },
            });
            const json = await response.json();
            if (json && json.code && json.code !== 0) return null;
            return json && json.data ? json.data : json;
          } catch (error) {
            return null;
          }
        };
        const imageAssets = [];
        const imageToMarkdown = (img) => {
          const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
          if (!src) return '';
          const width = Number(img.naturalWidth || img.width || 0);
          const height = Number(img.naturalHeight || img.height || 0);
          const className = String(img.className || '');
          if ((width && height && (width < 80 || height < 80)) || /avatar|portrait|icon|logo/i.test(className)) return '';
          const alt = img.alt || '图片';
          imageAssets.push({ src, alt, width, height });
          return '\\n\\n![' + alt + '](' + src + ')\\n\\n';
        };
        const mediaToMarkdown = (node) => {
          const tag = String(node && node.tagName || '').toLowerCase();
          const label = tag === 'audio' ? '音频文件' : '视频文件';
          const urls = [];
          const push = (value) => {
            const src = String(value || '').trim();
            if (!src || /^blob:/i.test(src) || urls.includes(src)) return;
            urls.push(src);
          };
          push(node.currentSrc || node.src || node.getAttribute('src') || node.getAttribute('data-src') || '');
          if (node.querySelectorAll) {
            node.querySelectorAll('source').forEach((source) => push(source.src || source.getAttribute('src') || ''));
          }
          return urls.map((src, index) => '\\n\\n[' + label + (urls.length > 1 ? ' ' + (index + 1) : '') + '](' + src + ')\\n\\n').join('');
        };
        const tableToMarkdown = (table) => {
          const rows = Array.from(table.querySelectorAll('tr')).map((row) => {
            return Array.from(row.children)
              .filter((cell) => ['th', 'td'].includes(String(cell.tagName || '').toLowerCase()))
              .map((cell) => clean(cell.innerText || cell.textContent || '').replace(/\\|/g, '\\\\|'));
          }).filter((row) => row.some(Boolean));
          if (!rows.length) return '';
          const columnCount = Math.max(...rows.map((row) => row.length));
          const normalizedRows = rows.map((row) => {
            const next = row.slice(0, columnCount);
            while (next.length < columnCount) next.push('');
            return next;
          });
          const header = normalizedRows[0];
          return '\\n\\n| ' + header.join(' | ') + ' |\\n'
            + '| ' + header.map(() => '---').join(' | ') + ' |\\n'
            + normalizedRows.slice(1).map((row) => '| ' + row.join(' | ') + ' |').join('\\n')
            + '\\n\\n';
        };
        const blockToMarkdown = (node) => {
          if (!node) return '';
          if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
          if (node.nodeType !== Node.ELEMENT_NODE) return '';
          if (node.closest && node.closest('#js_cmt_area')) return '';
          const tag = node.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
          if (tag === 'img') return imageToMarkdown(node);
          if (tag === 'video' || tag === 'audio' || tag === 'source') return mediaToMarkdown(node);
          if (tag === 'table') return tableToMarkdown(node);
          if (tag === 'pre' || tag === 'code') {
            const code = String(node.innerText || node.textContent || '').replace(/\\u00a0/g, ' ').replace(/^\\n+|\\n+$/g, '');
            const fence = String.fromCharCode(96, 96, 96);
            return code.trim() ? '\\n\\n' + fence + '\\n' + code + '\\n' + fence + '\\n\\n' : '';
          }
          const childText = Array.from(node.childNodes).map(blockToMarkdown).join('');
          if (/^h[1-6]$/.test(tag)) return '\\n' + '#'.repeat(Number(tag[1])) + ' ' + clean(childText) + '\\n';
          if (tag === 'li') return '\\n- ' + clean(childText);
          if (['p', 'div', 'section', 'article', 'main', 'blockquote', 'tr'].includes(tag)) return '\\n' + childText + '\\n';
          if (tag === 'br') return '\\n';
          return childText;
        };
        const seen = new Set();
        const collected = [];
        const collectVisibleBlocks = () => {
          const blocks = [];
          const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,video,audio,source,[data-block-id],[data-block-type],[class*="block"],[class*="paragraph"],[class*="docx"],[class*="text"]'));
          candidates.forEach((node) => {
            const text = clean(node.innerText || node.textContent || '');
            if (!text || text.length < 2 || seen.has(text)) return;
            seen.add(text);
            const markdown = clean(blockToMarkdown(node));
            if (markdown) {
              blocks.push(markdown);
              collected.push(markdown);
            }
          });
          return clean(blocks.join('\\n\\n'));
        };
        const scrollables = () => Array.from(document.querySelectorAll('[class*="scroll"], [class*="container"], [class*="content"], [class*="doc"], main, body, html'))
          .filter((node) => {
            try { return node && node.scrollHeight > node.clientHeight + 20; } catch (error) { return false; }
          });
        collectVisibleBlocks();
        for (let index = 0; index < 36; index += 1) {
          const before = Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0
          );
          window.scrollBy(0, Math.max(500, Math.floor(window.innerHeight * 0.85)));
          scrollables().forEach((node) => {
            try { node.scrollTop = Math.min(node.scrollTop + Math.max(500, Math.floor(node.clientHeight * 0.85)), node.scrollHeight); } catch (error) {}
          });
          await sleep(500);
          collectVisibleBlocks();
          const after = Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0
          );
          const atDocumentBottom = window.innerHeight + window.scrollY >= after - 8;
          const atScrollableBottom = scrollables().every((node) => {
            try { return node.scrollTop + node.clientHeight >= node.scrollHeight - 8; } catch (error) { return true; }
          });
          if (atDocumentBottom && atScrollableBottom && Math.abs(after - before) < 20) break;
        }
        const selectors = [
          '[data-testid*="doc"]',
          '[data-docx-has-block-data]',
          '[data-page-id]',
          '[data-block-id]',
          '[class*="docx"]',
          '[class*="suite"]',
          '[class*="wiki"]',
          '[class*="editor"]',
          'article',
          'main',
          'body'
        ];
        const candidates = selectors.map((selector) => document.querySelector(selector)).filter(Boolean);
        const root = candidates.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0] || document.body;
        const byBlocks = clean(collected.join('\\n\\n'));
        const byRoot = clean(blockToMarkdown(root));
        const markdown = byBlocks.length > byRoot.length * 0.6 ? byBlocks : byRoot;
        const toDataUrl = (blob) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('image read failed'));
          reader.readAsDataURL(blob);
        });
        const uniqueAssets = [];
        const seenAssets = new Set();
        for (const asset of imageAssets) {
          if (!asset.src || seenAssets.has(asset.src)) continue;
          seenAssets.add(asset.src);
          const next = { src: asset.src, alt: asset.alt || '图片' };
          if (asset.src.startsWith('blob:')) {
            try {
              const blob = await fetch(asset.src).then((response) => response.blob());
              next.dataUrl = await toDataUrl(blob);
            } catch (error) {}
          } else if (asset.src.startsWith('data:')) {
            next.dataUrl = asset.src;
          } else if (/feishu\.cn|feishu\.net|internal-api-drive-stream/i.test(asset.src)) {
            try {
              const blob = await fetch(asset.src, { credentials: 'include' }).then((response) => response.blob());
              if (blob && blob.size && /^image\//i.test(blob.type || '')) {
                next.dataUrl = await toDataUrl(blob);
              }
            } catch (error) {}
          }
          uniqueAssets.push(next);
        }
        return {
          title: document.title || '',
          markdown,
          needsLogin: isLoginPage(),
          clientVars: await getFeishuClientVars(),
          assets: uniqueAssets,
        };
      })()
    `);

    if (result && result.needsLogin) {
      throw new Error('飞书页面需要授权后才能完整提取。请在插件设置中点击“连接飞书官方 API”，授权后再同步。');
    }
    let __feishuDiag = 'no-clientVars';
    if (result && result.clientVars) {
      try {
        const cv = result.clientVars;
        const bm = cv.block_map || cv.blockMap || {};
        const cvBlockCount = Object.keys(bm).length;
        const seqLen = Array.isArray(cv.block_sequence) ? cv.block_sequence.length : -1;
        const clientVarsMarkdown = extractFeishuMarkdownFromClientVars(cv);
        const renderedLen = String(result.markdown || '').length;
        result.markdown = mergeFeishuRenderedAndClientVarsMarkdown(result.markdown, clientVarsMarkdown);
        __feishuDiag = `cv:ok bm=${cvBlockCount} seq=${seqLen} rendered=${renderedLen} structured=${clientVarsMarkdown.length} merged=${result.markdown.length}`;
      } catch (error) {
        __feishuDiag = `cv:fail ${error.message}`;
      }
    }
    result.__feishuDiag = __feishuDiag;
    if (!result || !result.markdown || result.markdown.length < 20) {
      throw new Error('隐藏浏览器未读取到足够正文');
    }
    return result;
  } finally {
    if (win && typeof win.destroy === 'function') {
      win.destroy();
    }
  }
}

async function renderFeishuUrlToSimpleMarkdownWithElectron(url) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('当前 Obsidian 环境不支持隐藏浏览器渲染');
  }

  const wechatSession = getWechatSession();
  const win = new BrowserWindow({
    width: 1280,
    height: 1600,
    show: false,
    webPreferences: {
      session: wechatSession || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    const loaded = waitForWebContents(win.webContents);
    await win.loadURL(url);
    await loaded;
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const clean = (text) => String(text || '')
          .replace(/\\u00a0/g, ' ')
          .replace(/[ \\t]+/g, ' ')
          .trim();
        const isLoginPage = () => /accounts\\/(?:page\\/login|trap)|login\\.feishu\\.cn/i.test(location.href)
          || /扫码登录|登录飞书|Login Required/i.test(document.body ? String(document.body.innerText || document.body.textContent || '') : '');
        const getPathToken = () => {
          const match = String(location.pathname || '').match(/\\/(?:docx|wiki)\\/([^/?#]+)/i);
          return match ? decodeURIComponent(match[1]) : '';
        };
        const getFeishuClientVars = async () => {
          const token = getPathToken();
          const candidates = [
            window.DATA && window.DATA.clientVars && window.DATA.clientVars.data,
            window.DATA && token && window.DATA[token] && window.DATA[token].CLIENT_VARS && window.DATA[token].CLIENT_VARS.data,
            window.SERVER_DATA && window.SERVER_DATA.clientVars && window.SERVER_DATA.clientVars.data,
            window.SERVER_RUNTIME_DATA && window.SERVER_RUNTIME_DATA.clientVars && window.SERVER_RUNTIME_DATA.clientVars.data,
          ].filter(Boolean);
          const existing = candidates.find((item) => item && (item.block_map || item.blockMap));
          if (existing) return existing;
          if (!token || isLoginPage()) return null;
          try {
            const response = await fetch('/space/api/docx/pages/client_vars?id=' + encodeURIComponent(token), {
              credentials: 'include',
              headers: { accept: 'application/json, text/plain, */*' },
            });
            const json = await response.json();
            if (json && json.code && json.code !== 0) return null;
            return json && json.data ? json.data : json;
          } catch (error) {
            return null;
          }
        };
        const lines = [];
        const seenLines = new Set();
        const imageAssets = [];
        const seenImages = new Set();
        const pushLine = (value) => {
          const text = clean(value);
          if (!text || text.length < 2 || seenLines.has(text)) return;
          seenLines.add(text);
          lines.push(text);
        };
        const pushImage = (img) => {
          try {
            const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
            if (!src || seenImages.has(src)) return;
            const width = Number(img.naturalWidth || img.width || 0);
            const height = Number(img.naturalHeight || img.height || 0);
            const className = String(img.className || '');
            if ((width && height && (width < 80 || height < 80)) || /avatar|portrait|icon|logo/i.test(className)) return;
            seenImages.add(src);
            const alt = clean(img.alt || '图片') || '图片';
            imageAssets.push({ src, alt, width, height });
            lines.push('![' + alt + '](' + src + ')');
          } catch (error) {}
        };
        const feishuTableSeen = new Set();
        const collectFeishuTables = () => {
          // 飞书 docx 表格在 DOM 里是 <table>，innerText 会把单元格打散成散落文本。
          // 先从 DOM 提取 <table> 转 markdown 表格，标记已处理的表格节点，避免重复。
          document.querySelectorAll('table').forEach((tableEl) => {
            if (feishuTableSeen.has(tableEl)) return;
            feishuTableSeen.add(tableEl);
            const tableHtml = tableEl.outerHTML || '';
            if (!tableHtml) return;
            // 复用公众号路径的 htmlTableToMarkdown 逻辑（正则解析 tr/td/th）
            const md = (function (html) {
              const rows = [];
              const rowPattern = /<tr\\b[^>]*>([\\s\\S]*?)<\\/tr>/gi;
              let rowMatch;
              while ((rowMatch = rowPattern.exec(html))) {
                const cells = [];
                const cellPattern = /<(?:th|td)\\b[^>]*>([\\s\\S]*?)<\\/(?:th|td)>/gi;
                let cellMatch;
                while ((cellMatch = cellPattern.exec(rowMatch[1] || ''))) {
                  const cellText = String(cellMatch[1] || '').replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim().replace(/\\|/g, '\\\\|');
                  cells.push(cellText);
                }
                if (cells.some(Boolean)) rows.push(cells);
              }
              if (!rows.length) return '';
              const colCount = Math.max.apply(null, rows.map(function (r) { return r.length; }));
              const norm = rows.map(function (r) { var n = r.slice(0, colCount); while (n.length < colCount) n.push(''); return n; });
              var header = norm[0];
              var lines = ['| ' + header.join(' | ') + ' |', '| ' + header.map(function () { return '---'; }).join(' | ') + ' |'];
              for (var i = 1; i < norm.length; i++) lines.push('| ' + norm[i].join(' | ') + ' |');
              return lines.join('\\n');
            })(tableHtml);
            if (md) lines.push(md);
          });
        };
        const collect = () => {
          // 先提取表格（结构化），再提取纯文本和图片
          collectFeishuTables();
          const bodyText = document.body ? String(document.body.innerText || document.body.textContent || '') : '';
          bodyText.split(/\\n+/).forEach(pushLine);
          document.querySelectorAll('img').forEach(pushImage);
        };
        const getMainScrollTarget = () => {
          const selectors = [
            '[class*="scroll"]',
            '[class*="container"]',
            '[class*="content"]',
            '[class*="doc"]',
            '[class*="Doc"]',
            '[class*="editor"]',
            '[data-docx-has-block-data]',
            '[data-page-id]',
            'main',
            'article',
            'body',
            'html',
          ];
          const candidates = [];
          selectors.forEach((selector) => {
            try {
              document.querySelectorAll(selector).forEach((node) => {
                if (!node || candidates.includes(node)) return;
                const scrollRange = Number(node.scrollHeight || 0) - Number(node.clientHeight || 0);
                if (scrollRange <= 20) return;
                const textLength = String(node.innerText || node.textContent || '').length;
                candidates.push({ node, scrollRange, textLength });
              });
            } catch (error) {}
          });
          candidates.sort((a, b) => {
            const aScore = a.scrollRange + Math.min(a.textLength, 20000);
            const bScore = b.scrollRange + Math.min(b.textLength, 20000);
            return bScore - aScore;
          });
          return candidates.length ? candidates[0].node : (document.scrollingElement || document.documentElement || document.body);
        };
        collect();
        let stableRounds = 0;
        let lastSignature = '';
        for (let index = 0; index < 300; index += 1) {
          const beforeCount = lines.length;
          const target = getMainScrollTarget();
          const beforeTop = target ? Number(target.scrollTop || 0) : Number(window.scrollY || 0);
          const step = Math.max(480, Math.floor((target && target.clientHeight ? target.clientHeight : window.innerHeight || 900) * 0.72));
          try {
            if (target && target !== document.body && target !== document.documentElement && target !== document.scrollingElement) {
              target.scrollTop = Math.min(Number(target.scrollTop || 0) + step, Number(target.scrollHeight || 0));
            } else {
              window.scrollBy(0, step);
            }
          } catch (error) {
            window.scrollBy(0, step);
          }
          await sleep(index < 12 ? 700 : 380);
          collect();
          const afterTop = target ? Number(target.scrollTop || 0) : Number(window.scrollY || 0);
          const atBottom = target
            ? afterTop + Number(target.clientHeight || window.innerHeight || 0) >= Number(target.scrollHeight || 0) - 12
            : true;
          const tail = lines.slice(-24).join('\\n');
          const signature = String(lines.length) + ':' + tail;
          if (signature === lastSignature || (lines.length === beforeCount && Math.abs(afterTop - beforeTop) < 8 && atBottom)) stableRounds += 1;
          else stableRounds = 0;
          lastSignature = signature;
          if (stableRounds >= 20) break;
        }
        const toDataUrl = (blob) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('image read failed'));
          reader.readAsDataURL(blob);
        });
        const uniqueAssets = [];
        for (const asset of imageAssets) {
          const next = { src: asset.src, alt: asset.alt || '图片' };
          if (asset.src.startsWith('data:')) {
            next.dataUrl = asset.src;
          } else if (/feishu\\.cn|feishu\\.net|internal-api-drive-stream/i.test(asset.src)) {
            try {
              const blob = await fetch(asset.src, { credentials: 'include' }).then((response) => response.blob());
              if (blob && blob.size && /^image\\//i.test(blob.type || '')) {
                next.dataUrl = await toDataUrl(blob);
              }
            } catch (error) {}
          }
          uniqueAssets.push(next);
        }
        return {
          title: document.title || '',
          markdown: lines.join('\\n'),
          needsLogin: isLoginPage(),
          clientVars: await getFeishuClientVars(),
          assets: uniqueAssets,
        };
      })()
    `);

    if (result && result.needsLogin) {
      throw new Error('飞书页面需要授权后才能完整提取。请在插件设置中点击“连接飞书官方 API”，授权后再同步。');
    }
    let __feishuDiag = 'no-clientVars';
    if (result && result.clientVars) {
      try {
        const cv = result.clientVars;
        const bm = cv.block_map || cv.blockMap || {};
        const cvBlockCount = Object.keys(bm).length;
        const seqLen = Array.isArray(cv.block_sequence) ? cv.block_sequence.length : -1;
        const clientVarsMarkdown = extractFeishuMarkdownFromClientVars(cv);
        const renderedLen = String(result.markdown || '').length;
        result.markdown = mergeFeishuRenderedAndClientVarsMarkdown(result.markdown, clientVarsMarkdown);
        __feishuDiag = `cv:ok bm=${cvBlockCount} seq=${seqLen} rendered=${renderedLen} structured=${clientVarsMarkdown.length} merged=${result.markdown.length}`;
      } catch (error) {
        __feishuDiag = `cv:fail ${error.message}`;
      }
    }
    result.__feishuDiag = __feishuDiag;
    if (!result || !result.markdown || result.markdown.length < 20) {
      throw new Error('隐藏浏览器未读取到足够正文');
    }
    return result;
  } finally {
    if (win && typeof win.destroy === 'function') {
      win.destroy();
    }
  }
}

async function renderSocialMediaUrlsWithElectron(url) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('Current Obsidian environment does not support hidden browser rendering');
  }

  const wechatSession = isXiaohongshuUrl(url) ? getXiaohongshuSession() : getWechatSession();
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      session: wechatSession || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const capturedRequests = [];
  const browserSession = (win.webContents && win.webContents.session) || wechatSession;
  const installedWebRequestHandlers = [];
  const captureWebRequestDetails = (details) => {
    capturedRequests.push({
      url: details && details.url,
      redirectURL: details && (details.redirectURL || details.redirectUrl),
      resourceType: details && details.resourceType,
    });
  };
  const installWebRequestHandler = (method, listener) => {
    try {
      if (!browserSession || !browserSession.webRequest || typeof browserSession.webRequest[method] !== 'function') return;
      browserSession.webRequest[method]({ urls: ['<all_urls>'] }, listener);
      installedWebRequestHandlers.push(method);
    } catch (error) {}
  };

  installWebRequestHandler('onBeforeRequest', (details, callback) => {
    captureWebRequestDetails(details);
    if (typeof callback === 'function') callback({});
  });
  installWebRequestHandler('onBeforeRedirect', captureWebRequestDetails);
  installWebRequestHandler('onCompleted', captureWebRequestDetails);

  try {
    const loaded = waitForWebContents(win.webContents, 18000);
    await win.loadURL(url);
    await loaded;
    const payload = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const urls = [];
        const add = (value, resourceType = '') => {
          const url = String(value || '').trim();
          if (!url) return;
          if (!urls.some((item) => item && item.url === url)) {
            urls.push({ url, resourceType });
          }
        };
        const collect = () => {
          document.querySelectorAll('video, audio, source').forEach((node) => {
            try {
              if (node.tagName && node.tagName.toLowerCase() === 'video' && typeof node.play === 'function') {
                node.muted = true;
                node.play().catch(() => {});
              }
            } catch (error) {}
            add(node.currentSrc, 'media');
            add(node.src, 'media');
            add(node.getAttribute('src'), 'media');
          });
          try {
            performance.getEntriesByType('resource').forEach((entry) => add(entry.name, entry.initiatorType || ''));
          } catch (error) {}
        };
        for (let index = 0; index < 24; index += 1) {
          collect();
          await sleep(500);
        }
        collect();
        return urls;
      })()
    `);

    return normalizeBrowserCapturedMediaUrls([capturedRequests, payload]);
  } finally {
    installedWebRequestHandlers.forEach((method) => {
      try {
        if (browserSession && browserSession.webRequest && typeof browserSession.webRequest[method] === 'function') {
          browserSession.webRequest[method]({ urls: ['<all_urls>'] }, null);
        }
      } catch (error) {}
    });
    if (win && typeof win.destroy === 'function') {
      win.destroy();
    }
  }
}

async function renderXiaohongshuPageWithElectron(url) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('Current Obsidian environment does not support hidden browser rendering');
  }

  const wechatSession = getXiaohongshuSession();
  const win = new BrowserWindow({
    width: 1280,
    height: 960,
    show: false,
    webPreferences: {
      session: wechatSession || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const commentApiRequests = [];
  const browserSession = (win.webContents && win.webContents.session) || wechatSession;
  const captureCommentApiRequest = (details) => {
    const requestUrl = String(details && details.url || '').trim();
    if (!isXiaohongshuCommentApiUrl(requestUrl)) return;
    commentApiRequests.push({
      url: requestUrl,
      requestHeaders: details && details.requestHeaders ? { ...details.requestHeaders } : {},
    });
  };
  try {
    if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeSendHeaders === 'function') {
      browserSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.xiaohongshu.com/*'] }, (details, callback) => {
        captureCommentApiRequest(details);
        if (typeof callback === 'function') callback({ requestHeaders: details.requestHeaders });
      });
    }
  } catch (error) {}

  const debuggerComments = [];
  const debuggerSeen = new Set();
  const debuggerBodyTasks = [];
  const debuggerRequestUrls = new Map();
  let debuggerAttached = false;
  const debuggerApi = win.webContents && win.webContents.debugger;
  const parseCommentApiText = (text) => {
    if (!text) return;
    try {
      extractCommentsFromObject(JSON.parse(text), debuggerComments, debuggerSeen, 50);
      return;
    } catch (error) {}
    collectJsonObjectCandidates(text).forEach((candidate) => {
      extractCommentsFromObject(parseLooseJsonCandidate(candidate), debuggerComments, debuggerSeen, 50);
    });
  };
  try {
    if (debuggerApi && typeof debuggerApi.attach === 'function' && typeof debuggerApi.sendCommand === 'function') {
      if (!debuggerApi.isAttached || !debuggerApi.isAttached()) {
        debuggerApi.attach('1.3');
        debuggerAttached = true;
      }
      debuggerApi.sendCommand('Network.enable').catch(() => {});
      debuggerApi.on('message', (_event, method, params = {}) => {
        try {
          if (method === 'Network.responseReceived') {
            const responseUrl = String(params.response && params.response.url || '').trim();
            if (params.requestId && isXiaohongshuCommentApiUrl(responseUrl)) {
              debuggerRequestUrls.set(params.requestId, responseUrl);
            }
          }
          if (method === 'Network.loadingFinished' && debuggerRequestUrls.has(params.requestId)) {
            const requestId = params.requestId;
            debuggerBodyTasks.push((async () => {
              try {
                const body = await debuggerApi.sendCommand('Network.getResponseBody', { requestId });
                const text = body && body.base64Encoded
                  ? Buffer.from(String(body.body || ''), 'base64').toString('utf8')
                  : String(body && body.body || '');
                parseCommentApiText(text);
              } catch (error) {}
            })());
          }
        } catch (error) {}
      });
    }
  } catch (error) {}

  try {
    const loaded = waitForWebContents(win.webContents, 20000);
    await win.loadURL(url);
    await loaded;
    const renderedPayload = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const clean = (text) => String(text || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
        const comments = [];
        const seen = new Set();
        const push = (author, content, time, likes) => {
          const body = clean(content);
          if (!body || body.length < 2) return;
          if (/^(?:回复|评论|点赞|赞|展开|更多|查看|分享|收藏|[0-9]+)$/.test(body)) return;
          if (/^共\\s*\\d+\\s*条评论/.test(body)) return;
          const name = clean(author);
          const key = name + '|' + body;
          if (seen.has(key)) return;
          seen.add(key);
          comments.push({ author: name, content: body, time: clean(time), likes: clean(likes) });
        };
        const clickUsefulButtons = () => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], .show-more, .more, .expand, [class*="more"], [class*="expand"]'));
          buttons.forEach((node) => {
            const text = String(node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim();
            if (/评论|回复|展开|更多|查看/i.test(text)) {
              try { node.click(); } catch (error) {}
            }
          });
        };
        const collectDomComments = () => {
          const selectors = [
            '.comment-item',
            '[class*="comment-item"]',
            '[class*="CommentItem"]',
            '[class*="comment"][class*="item"]',
            '[class*="reply-item"]',
            '[class*="ReplyItem"]',
          ];
          const nodes = Array.from(document.querySelectorAll(selectors.join(',')));
          nodes.forEach((node) => {
            const pick = (selectorsToTry) => {
              for (const selector of selectorsToTry) {
                const candidates = Array.from(node.querySelectorAll(selector));
                for (const child of candidates) {
                  const value = clean(child.innerText || child.textContent || '');
                  if (value) return value;
                }
              }
              return '';
            };
            const author = pick(['[class*="name"]', '[class*="nick"]', '[class*="author"]', '[class*="user"]']);
            const time = pick(['[class*="time"]', '[class*="date"]']);
            const likes = pick(['[class*="like"]', '[class*="praise"]']);
            let content = pick(['[class*="content"]', '[class*="text"]', '[class*="desc"]']);
            if (!content) {
              const text = clean(node.innerText || node.textContent || '');
              const parts = text.split(/\\s+/).filter(Boolean);
              content = parts.find((part) => part.length >= 2 && !/^(?:回复|评论|点赞|赞|展开|更多|查看|分享|收藏|[0-9]+)$/.test(part)) || text;
            }
            push(author, content, time, likes);
          });
        };
        for (let index = 0; index < 18; index += 1) {
          clickUsefulButtons();
          collectDomComments();
          window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.8)));
          await sleep(700);
        }
        clickUsefulButtons();
        collectDomComments();
        await sleep(1000);
        collectDomComments();
        return {
          html: document.documentElement ? document.documentElement.outerHTML : '',
          comments,
        };
      })()
    `);
    await Promise.allSettled(debuggerBodyTasks);
    const renderedHtml = renderedPayload && typeof renderedPayload === 'object'
      ? String(renderedPayload.html || '')
      : String(renderedPayload || '');
    const inlineDomComments = renderedPayload && typeof renderedPayload === 'object' && Array.isArray(renderedPayload.comments)
      ? renderedPayload.comments
      : [];
    const apiComments = await fetchXiaohongshuCommentsFromCapturedRequests(commentApiRequests, 50);
    const domComments = extractSocialCommentsFromHtml(renderedHtml, 50);
    const comments = mergeSocialComments([debuggerComments, apiComments, inlineDomComments, domComments], 50);
    return {
      html: renderedHtml,
      comments,
      commentApiRequestCount: commentApiRequests.length,
      debuggerCommentCount: debuggerComments.length,
    };
  } finally {
    try {
      if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeSendHeaders === 'function') {
        browserSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.xiaohongshu.com/*'] }, null);
      }
    } catch (error) {}
    try {
      if (debuggerAttached && debuggerApi && typeof debuggerApi.detach === 'function') {
        debuggerApi.detach();
      }
    } catch (error) {}
    if (win && typeof win.destroy === 'function') {
      win.destroy();
    }
  }
}

async function renderXiaohongshuCommentsWithElectron(url) {
  const page = await renderXiaohongshuPageWithElectron(url);
  return page && Array.isArray(page.comments) ? page.comments : [];
}

async function renderSocialMediaUrlWithElectron(url) {
  const urls = await renderSocialMediaUrlsWithElectron(url);
  return urls[0] || '';
}

function decodeJsonStringLiteral(value) {
  try {
    return JSON.parse(`"${String(value || '').replace(/"/g, '\\"')}"`);
  } catch (error) {
    return String(value || '');
  }
}

function slugifyMarkdownHeading(text) {
  return String(text || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function buildMarkdownToc(markdown) {
  const headings = String(markdown || '')
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (!match) return null;
      const text = match[2].replace(/\*\*/g, '').trim();
      if (!text || text === '目录' || text === '评论区') return null;
      return {
        level: match[1].length,
        text,
        slug: slugifyMarkdownHeading(text),
      };
    })
    .filter(Boolean);
  if (headings.length < 2) return '';
  const minLevel = Math.min(...headings.map((item) => item.level));
  return [
    '## 目录',
    '',
    ...headings.map((item) => `${'  '.repeat(Math.max(0, item.level - minLevel))}- [${item.text}](#${item.slug})`),
  ].join('\n');
}

function appendMarkdownToc(markdown) {
  const source = String(markdown || '').trim();
  if (!source || /(^|\n)##\s+目录\b/.test(source)) return source;
  const toc = buildMarkdownToc(source);
  return toc ? `${toc}\n\n${source}` : source;
}

function collectFeishuImageUrls(source) {
  const urls = [];
  collectImageUrlsFromHtml(source).forEach((url) => pushUniqueUrl(urls, url));
  collectJsonStringValues(source, [
    'url',
    'src',
    'image',
    'imageUrl',
    'image_url',
    'originUrl',
    'origin_url',
    'downloadUrl',
    'download_url',
  ]).forEach((url) => {
    if (isLikelyImageUrl(url)) pushUniqueUrl(urls, url);
  });
  return urls;
}

function getFeishuOutlineLevelFromTag(tag) {
  const source = String(tag || '');
  const attrPatterns = [
    /\bdata-(?:level|heading-level|outline-level)\s*=\s*["']?([1-6])["']?/i,
    /\b(?:aria-level|level)\s*=\s*["']?([1-6])["']?/i,
  ];
  for (const pattern of attrPatterns) {
    const match = source.match(pattern);
    if (match && match[1]) return Number(match[1]);
  }
  const classMatch = source.match(/\b(?:level|heading|h)-?([1-6])\b/i);
  return classMatch && classMatch[1] ? Number(classMatch[1]) : 0;
}

function extractFeishuOutlineHeadingMap(html) {
  const source = String(html || '');
  const map = new Map();
  const containerPattern = /<(?<tag>aside|nav|div|section)\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/\k<tag>>/gi;
  let containerMatch;
  while ((containerMatch = containerPattern.exec(source))) {
    const attrs = containerMatch.groups && containerMatch.groups.attrs || '';
    const body = containerMatch.groups && containerMatch.groups.body || '';
    if (!/(?:outline|catalog|toc|目录|docx-outline)/i.test(`${attrs} ${body.slice(0, 300)}`)) continue;
    const itemPattern = /<(?<tag>h[1-6]|li|a|div|span)\b(?<attrs>[^>]*)>(?<text>[\s\S]*?)<\/\k<tag>>/gi;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(body))) {
      const tag = String(itemMatch.groups && itemMatch.groups.tag || '').toLowerCase();
      const attrsText = itemMatch.groups && itemMatch.groups.attrs || '';
      const text = stripHtmlTags(itemMatch.groups && itemMatch.groups.text || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2 || shouldDropFeishuLine(text, '')) continue;
      let level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : getFeishuOutlineLevelFromTag(attrsText);
      if (!level) {
        const indentMatch = attrsText.match(/padding-left\s*:\s*(\d+)px/i);
        level = indentMatch ? Math.max(1, Math.min(6, Math.floor(Number(indentMatch[1]) / 16) + 1)) : 1;
      }
      const key = normalizeTitleForCompare(text);
      if (key && !map.has(key)) map.set(key, Math.max(1, Math.min(6, level)));
    }
  }
  return map;
}

function stripFeishuOutlineContainers(html) {
  const source = String(html || '');
  return source.replace(/<(?<tag>aside|nav|div|section)\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/\k<tag>>/gi, function stripOutline(full) {
    const groups = arguments[arguments.length - 1] || {};
    const attrs = groups && groups.attrs || '';
    const body = groups && groups.body || '';
    return /(?:outline|catalog|toc|目录|docx-outline)/i.test(`${attrs} ${body.slice(0, 300)}`) ? '' : full;
  });
}

function inferFeishuHeadingLevel(text, blockType = '') {
  const normalizedType = String(blockType || '').toLowerCase();
  const match = normalizedType.match(/heading[_-]?([1-6])|h([1-6])/i);
  if (match) return Number(match[1] || match[2]);
  return 0;
}

function pushFeishuLine(lines, seen, text, level = 0) {
  const value = String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!value || value.length < 2 || /^https?:\/\//i.test(value) || /[{}[\]<>]/.test(value)) return;
  const markdown = level ? `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${value}` : formatFeishuHeadingLine(value);
  const key = markdown.replace(/\s+/g, ' ');
  if (seen.has(key)) return;
  seen.add(key);
  lines.push(markdown);
}

function extractFeishuMarkdownFromHtml(html) {
  const source = decodeHtmlEntities(String(html || ''));
  const outlineHeadingMap = extractFeishuOutlineHeadingMap(source);
  const lines = [];
  const seen = new Set();
  const readable = stripScriptAndStyleBlocks(stripFeishuOutlineContainers(source))
    .replace(/<img\b[^>]*>/gi, (tag) => imageTagToMarkdown(tag))
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n# ${stripHtmlTags(text)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n## ${stripHtmlTags(text)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n### ${stripHtmlTags(text)}\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `\n#### ${stripHtmlTags(text)}\n`)
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, text) => `\n##### ${stripHtmlTags(text)}\n`)
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, text) => `\n###### ${stripHtmlTags(text)}\n`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n${stripHtmlTags(text)}\n`);
  cleanMarkdownForStorage(stripHtmlTags(readable), { dedupe: true })
    .split(/\r?\n/)
    .forEach((line) => {
      const text = line.trim();
      if (shouldDropFeishuLine(text, '')) return;
      if (/^#{1,6}\s+/.test(text) || /^!\[/.test(text)) {
        if (!seen.has(text)) {
          seen.add(text);
          lines.push(text);
        }
        return;
      }
      const outlineLevel = outlineHeadingMap.get(normalizeTitleForCompare(text)) || 0;
      pushFeishuLine(lines, seen, text, outlineLevel);
    });

  const patterns = [
    /"(?:block_type|type)"\s*:\s*"([^"]+)"[\s\S]{0,500}?"(?:text|content|title|name)"\s*:\s*"((?:\\.|[^"\\]){2,})"/g,
    /"(?:text|content|title|name)"\s*:\s*"((?:\\.|[^"\\]){8,})"/g,
    /'text'\s*:\s*'((?:\\.|[^'\\]){8,})'/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source))) {
      const hasBlockType = match.length > 2;
      const blockType = hasBlockType ? match[1] : '';
      const rawText = hasBlockType ? match[2] : match[1];
      const text = decodeJsonStringLiteral(rawText)
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (shouldDropFeishuLine(text, '')) return;
      const blockLevel = inferFeishuHeadingLevel(text, blockType);
      const outlineLevel = outlineHeadingMap.get(normalizeTitleForCompare(text)) || 0;
      pushFeishuLine(lines, seen, text, blockLevel || outlineLevel);
    }
  });

  const existingImageUrls = new Set();
  lines.forEach((line) => {
    const match = String(line || '').match(/!\[[^\]]*]\(([^)]+)\)/);
    if (match && match[1]) existingImageUrls.add(match[1]);
  });
  let appendedImageIndex = 0;
  collectFeishuImageUrls(source).forEach((url) => {
    if (existingImageUrls.has(url)) return;
    existingImageUrls.add(url);
    const markdown = `![图片${appendedImageIndex ? ` ${appendedImageIndex + 1}` : ''}](${url})`;
    appendedImageIndex += 1;
    if (!seen.has(markdown)) {
      seen.add(markdown);
      lines.push(markdown);
    }
  });

  const markdown = lines.join('\n\n').trim();
  if (markdown.length < 20) {
    throw new Error('飞书静态页面中未提取到正文');
  }
  return markdown;
}

function unwrapFeishuClientVarsPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.block_map || payload.blockMap) return payload;
  if (payload.data && typeof payload.data === 'object') return unwrapFeishuClientVarsPayload(payload.data);
  if (payload.CLIENT_VARS && typeof payload.CLIENT_VARS === 'object') return unwrapFeishuClientVarsPayload(payload.CLIENT_VARS);
  if (payload.clientVars && typeof payload.clientVars === 'object') return unwrapFeishuClientVarsPayload(payload.clientVars);
  return null;
}

function collectFeishuRichText(value, output = [], key = '') {
  if (value === undefined || value === null) return output;
  const normalizedKey = String(key || '').toLowerCase();
  if (typeof value === 'string') {
    if (['text', 'content', 'title', 'name', 'plain_text', 'plainText'].some((item) => normalizedKey === item.toLowerCase())) {
      const text = value.replace(/\s+/g, ' ').trim();
      if (text) output.push(text);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFeishuRichText(item, output, key));
    return output;
  }
  if (typeof value !== 'object') return output;

  if (['text', 'content', 'title', 'name', 'plain_text', 'plaintext'].includes(normalizedKey)) {
    Object.values(value).forEach((item) => {
      if (typeof item === 'string') {
        const text = item.replace(/\s+/g, ' ').trim();
        if (text) output.push(text);
      }
    });
  }

  if (value.initialAttributedTexts && typeof value.initialAttributedTexts === 'object') {
    collectFeishuRichText(value.initialAttributedTexts, output, 'text');
  }
  if (value.text && typeof value.text === 'object' && value.text.initialAttributedTexts) {
    collectFeishuRichText(value.text, output, 'text');
  }
  if (value.nodes && Array.isArray(value.nodes)) {
    value.nodes.forEach((node) => collectFeishuRichText(node, output, 'text'));
  }

  Object.entries(value).forEach(([childKey, childValue]) => {
    if (['id', 'token', 'parent_id', 'parentId', 'children', 'type', 'block_type'].includes(childKey)) return;
    collectFeishuRichText(childValue, output, childKey);
  });
  return output;
}

const FEISHU_NUMERIC_BLOCK_TYPE_NAMES = {
  1: 'page',
  2: 'text',
  3: 'heading1',
  4: 'heading2',
  5: 'heading3',
  6: 'heading4',
  7: 'heading5',
  8: 'heading6',
  9: 'heading7',
  10: 'heading8',
  11: 'heading9',
  12: 'bullet',
  13: 'ordered',
  14: 'code',
  15: 'quote',
  17: 'todo',
  23: 'file',
  27: 'image',
  31: 'table',
  32: 'table_cell',
  33: 'view',
};

function normalizeFeishuBlockTypeName(value) {
  const text = String(value || '').toLowerCase();
  return FEISHU_NUMERIC_BLOCK_TYPE_NAMES[text] || text;
}

function getFeishuBlockType(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  return normalizeFeishuBlockTypeName(data.type || data.block_type || block.type || block.block_type || '');
}

function getFeishuBlockText(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  return Array.from(new Set(collectFeishuRichText(data)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectFeishuCodeText(value, output = [], key = '') {
  if (value === undefined || value === null) return output;
  const normalizedKey = String(key || '').toLowerCase();
  if (typeof value === 'string') {
    if (['content', 'text', 'plain_text', 'plaintext'].includes(normalizedKey)) {
      output.push(value);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFeishuCodeText(item, output, key));
    return output;
  }
  if (typeof value !== 'object') return output;
  if (value.text_run && typeof value.text_run === 'object') {
    collectFeishuCodeText(value.text_run, output, 'text_run');
  }
  Object.entries(value).forEach(([childKey, childValue]) => {
    if (['id', 'token', 'parent_id', 'parentId', 'children', 'type', 'block_type'].includes(childKey)) return;
    collectFeishuCodeText(childValue, output, childKey);
  });
  return output;
}

function getFeishuBlockCodeText(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const source = data.code || data.Code || data;
  return collectFeishuCodeText(source)
    .join('')
    .replace(/\r\n/g, '\n')
    .trim();
}

function collectFeishuTableRowsFromValue(value, rows = []) {
  if (!value) return rows;
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => Array.isArray(item) || (item && typeof item === 'object' && Array.isArray(item.cells)))) {
      value.forEach((row) => {
        const cells = Array.isArray(row) ? row : row.cells;
        const next = cells.map((cell) => getFeishuBlockText(cell) || collectFeishuRichText(cell).join(' ')).map((cell) => String(cell || '').trim());
        if (next.some(Boolean)) rows.push(next);
      });
      return rows;
    }
    value.forEach((item) => collectFeishuTableRowsFromValue(item, rows));
    return rows;
  }
  if (typeof value !== 'object') return rows;

  const directRows = value.rows || value.row_list || value.rowList;
  if (Array.isArray(directRows)) {
    collectFeishuTableRowsFromValue(directRows, rows);
  }

  const cells = value.cells || value.cell_list || value.cellList;
  if (Array.isArray(cells) && cells.length) {
    const matrix = [];
    cells.forEach((cell, index) => {
      const rowIndex = Number(cell.row || cell.rowIndex || cell.row_index || cell.r || 0);
      const colIndex = Number(cell.col || cell.colIndex || cell.col_index || cell.c || index);
      if (!matrix[rowIndex]) matrix[rowIndex] = [];
      matrix[rowIndex][colIndex] = getFeishuBlockText(cell) || collectFeishuRichText(cell).join(' ');
    });
    matrix.filter(Boolean).forEach((row) => {
      const normalized = row.map((cell) => String(cell || '').trim());
      if (normalized.some(Boolean)) rows.push(normalized);
    });
  }
  return rows;
}

function formatMarkdownTableRows(rows) {
  const normalizedSource = (rows || []).filter((row) => Array.isArray(row) && row.some(Boolean));
  if (!normalizedSource.length) return '';
  const columnCount = Math.max(...normalizedSource.map((row) => row.length));
  const normalizedRows = normalizedSource.map((row) => {
    const next = row.map((cell) => String(cell || '').replace(/\|/g, '\\|').trim()).slice(0, columnCount);
    while (next.length < columnCount) next.push('');
    return next;
  });
  const header = normalizedRows[0];
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function isFeishuTableType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'table' || t === '31';
}

function isFeishuTableCellType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'table_cell' || t === 'tablecell' || t === '32';
}

function isFeishuImageType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'image' || t === '27';
}

// 只取 children 相关键的子 block ID（不取 id/token，避免把 block 自身 ID 误当子节点）
function getFeishuBlockChildrenIds(value) {
  const ids = [];
  if (!value || typeof value !== 'object') return ids;
  const keys = ['children', 'child_ids', 'childIds', 'children_ids', 'childrenIds', 'block_ids', 'blockIds'];
  keys.forEach((key) => {
    const v = value[key];
    if (!Array.isArray(v)) return;
    v.forEach((item) => {
      if (typeof item === 'string' && item.trim()) {
        ids.push(item.trim());
      } else if (item && typeof item === 'object') {
        const id = item.id || item.block_id || item.blockId;
        if (typeof id === 'string' && id.trim()) ids.push(id.trim());
      }
    });
  });
  return ids;
}

// 递归提取 TableCell（或任意容器 block）内的纯文本，通过 blockMap 查子 block
function getFeishuCellTextFromBlock(block, blockMap, depth = 0) {
  if (!block || depth > 6) return '';
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  let text = getFeishuBlockText(block);
  if (text) return text;
  const childIds = getFeishuBlockChildrenIds(data);
  if (!childIds.length || !blockMap) return '';
  const parts = [];
  childIds.forEach((cid) => {
    const cb = blockMap[cid];
    if (!cb) return;
    const t = getFeishuCellTextFromBlock(cb, blockMap, depth + 1);
    if (t) parts.push(t);
  });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// 飞书 docx table: { table: { property: { row_size, column_size }, cells: [cellBlockId...] } }
// cells 按行优先排列，长度 = row_size * column_size；每个 cellId 指向 table_cell block（内容在其 children）
function formatFeishuClientVarTableBlock(block, blockMap) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const table = data.table || data.Table || data;
  const property = (table && table.property) || (table && table.Property) || {};
  let rowSize = Number(property.row_size || property.rowSize || 0);
  let colSize = Number(property.column_size || property.columnSize || 0);
  const cellIds = (table && (table.cells || table.Cells)) || [];

  if (Array.isArray(cellIds) && cellIds.length && blockMap) {
    if (!colSize) colSize = Math.ceil(Math.sqrt(cellIds.length));
    if (!rowSize) rowSize = Math.ceil(cellIds.length / colSize);
    if (rowSize > 0 && colSize > 0) {
      const matrix = [];
      cellIds.forEach((cellId, index) => {
        const r = Math.floor(index / colSize);
        const c = index % colSize;
        if (!matrix[r]) matrix[r] = [];
        const id = String(cellId || '').trim();
        const cellBlock = blockMap[id];
        matrix[r][c] = cellBlock ? getFeishuCellTextFromBlock(cellBlock, blockMap) : '';
      });
      const rows = matrix.filter(Boolean).map((row) => row.map((cell) => String(cell || '').trim()));
      if (rows.length >= 1 && rows.some((row) => row.some(Boolean))) {
        return formatMarkdownTableRows(rows);
      }
    }
  }

  // 兼容旧结构（rows/cells 对象数组，非 docx blockId 数组）
  const legacyRows = collectFeishuTableRowsFromValue(data, []);
  if (legacyRows.length >= 2) return formatMarkdownTableRows(legacyRows);
  return '';
}

function extractFeishuImageToken(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const img = data.image || data.Image || {};
  const token = img.token || img.file_token || img.fileToken || data.token || data.file_token || data.fileToken;
  return String(token || '').trim();
}

function collectFeishuBlockImageUrls(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const urls = [];
  // 飞书 docx image block: 图片标识在 image.token，输出 feishu-image:{token} 占位供后续关联下载
  const token = extractFeishuImageToken(block);
  if (token && !urls.includes(`feishu-image:${token}`)) {
    urls.push(`feishu-image:${token}`);
  }
  collectFeishuImageUrls(JSON.stringify(data || {})).forEach((url) => pushUniqueUrl(urls, url));
  collectJsonStringValues(JSON.stringify(data || {}), [
    'origin_url',
    'originUrl',
    'preview_url',
    'previewUrl',
    'download_url',
    'downloadUrl',
    'src',
    'url',
  ]).forEach((url) => {
    if (isLikelyImageUrl(url)) pushUniqueUrl(urls, url);
  });
  return urls;
}

function collectFeishuBlockMediaUrls(block) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const urls = [];
  collectJsonStringValues(JSON.stringify(data || {}), [
    'origin_url',
    'originUrl',
    'preview_url',
    'previewUrl',
    'download_url',
    'downloadUrl',
    'src',
    'url',
    'file_url',
    'fileUrl',
    'media_url',
    'mediaUrl',
    'video_url',
    'videoUrl',
    'play_url',
    'playUrl',
  ]).forEach((url) => {
    if (isLikelyMediaUrl(url)) pushUniqueUrl(urls, url);
  });
  return urls;
}

function getFeishuBlockMediaLabel(block, text = '') {
  if (isFeishuAssetPlaceholderLine(text)) return text;
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const labels = collectJsonStringValues(JSON.stringify(data || {}), [
    'name',
    'file_name',
    'fileName',
    'title',
  ]).filter((item) => /\.(?:mp4|mov|m4v|webm|avi|mkv|mp3|m4a|wav|aac|flac)$/i.test(String(item || '').trim()));
  return labels[0] || text || '媒体文件';
}

function getFeishuHeadingLevelFromBlock(block, type) {
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const headingMatch = String(type || '').match(/heading[_-]?([1-6])|h([1-6])/);
  if (headingMatch) return Number(headingMatch[1] || headingMatch[2] || 1);
  const numericLevel = Number(data.heading_level || data.headingLevel || data.level || data.text_level || data.textLevel || 0);
  return numericLevel >= 1 && numericLevel <= 6 ? numericLevel : 0;
}

function formatFeishuClientVarBlock(block, blockMap) {
  const text = getFeishuBlockText(block);
  const type = getFeishuBlockType(block);

  // table_cell 由父 table block 整体处理，单独出现时跳过，避免散落成纯文本
  if (isFeishuTableCellType(type)) return '';

  if (isFeishuTableType(type) || /sheet|grid/i.test(type)) {
    const table = formatFeishuClientVarTableBlock(block, blockMap);
    if (table) return table;
  }

  if (isFeishuImageType(type) || /picture|diagram/i.test(type)) {
    const imageUrls = collectFeishuBlockImageUrls(block);
    if (imageUrls.length) {
      return imageUrls.map((url, index) => `![图片${index ? ` ${index + 1}` : ''}](${url})`).join('\n\n');
    }
    // image block 没有可识别 token/URL 时不降级为裸文件名文本，直接跳过
    return '';
  }

  if (/video|audio|media|file|attachment/i.test(type) || isFeishuAssetPlaceholderLine(text)) {
    const mediaUrls = collectFeishuBlockMediaUrls(block);
    if (mediaUrls.length) {
      const label = getFeishuBlockMediaLabel(block, text);
      return mediaUrls.map((url, index) => {
        const suffix = mediaUrls.length > 1 ? ` ${index + 1}` : '';
        return `[${label}${suffix}](${url})`;
      }).join('\n\n');
    }
  }

  if (!text || shouldDropFeishuLine(text, '')) return '';
  if (/code/.test(type)) return `\`\`\`\n${getFeishuBlockCodeText(block) || text}\n\`\`\``;
  if (/quote/.test(type)) return text.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
  const headingLevel = getFeishuHeadingLevelFromBlock(block, type);
  if (headingLevel) {
    const level = headingLevel;
    return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}`;
  }
  if (/bullet|unordered|todo|check/.test(type)) return `- ${text}`;
  if (/ordered|number/.test(type)) return `1. ${text}`;
  return formatFeishuHeadingLine(text);
}

function collectFeishuBlockChildIds(value, ids = []) {
  if (!value) return ids;
  if (typeof value === 'string') {
    if (value.trim()) ids.push(value.trim());
    return ids;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFeishuBlockChildIds(item, ids));
    return ids;
  }
  if (typeof value !== 'object') return ids;

  const directKeys = [
    'children',
    'child_ids',
    'childIds',
    'children_ids',
    'childrenIds',
    'block_ids',
    'blockIds',
  ];
  directKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      collectFeishuBlockChildIds(value[key], ids);
    }
  });
  ['id', 'block_id', 'blockId', 'token'].forEach((key) => {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) ids.push(candidate.trim());
  });
  return ids;
}

function markFeishuDescendantsSeen(blockId, blockMap, seen) {
  const block = blockMap[blockId];
  if (!block) return;
  const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
  const table = data.table || data.Table;
  const childIds = Array.isArray(table && (table.cells || table.Cells))
    ? (table.cells || table.Cells)
    : getFeishuBlockChildrenIds(data);
  childIds.forEach((cid) => {
    const id = typeof cid === 'string' ? cid.trim() : String((cid && (cid.id || cid.block_id)) || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      markFeishuDescendantsSeen(id, blockMap, seen);
    }
  });
}

function buildFeishuClientVarBlockSequence(clientVars, blockMap) {
  const initial = Array.isArray(clientVars.block_sequence)
    ? clientVars.block_sequence
    : (Array.isArray(clientVars.blockSequence) ? clientVars.blockSequence : []);
  const ordered = [];
  const seen = new Set();
  const push = (id) => {
    const key = String(id || '').trim();
    if (!key || seen.has(key) || !blockMap[key]) return;
    seen.add(key);
    ordered.push(key);
    const block = blockMap[key];
    const data = block && block.data && typeof block.data === 'object' ? block.data : block || {};
    const blockType = getFeishuBlockType(block);
    if (isFeishuTableType(blockType)) {
      // table 后代（table_cell 及其内容子 block）由 formatFeishuClientVarTableBlock 整体处理，
      // 标记为 seen，防止末尾兜底把它们重复输出为散落文本
      markFeishuDescendantsSeen(key, blockMap, seen);
    } else if (!isFeishuTableCellType(blockType)) {
      collectFeishuBlockChildIds(data).forEach(push);
    }
  };
  initial.forEach(push);
  if (!ordered.length) {
    Object.entries(blockMap).forEach(([id, block]) => {
      const type = getFeishuBlockType(block);
      if (type === 'page' || type === 'root') push(id);
    });
  }
  Object.keys(blockMap).forEach(push);
  return ordered;
}

function extractFeishuMarkdownFromClientVars(payload) {
  const clientVars = unwrapFeishuClientVarsPayload(payload);
  const blockMap = clientVars && (clientVars.block_map || clientVars.blockMap);
  if (!blockMap || typeof blockMap !== 'object') {
    throw new Error('飞书 client_vars 中未找到 block_map');
  }

  const sequence = buildFeishuClientVarBlockSequence(clientVars, blockMap);
  const seen = new Set();
  const lines = [];
  sequence.forEach((id) => {
    const block = blockMap[id];
    if (!block) return;
    const type = getFeishuBlockType(block);
    if (type === 'page' || type === 'root') return;
    const line = formatFeishuClientVarBlock(block, blockMap);
    if (!line) return;
    // markdown 表格行（| 开头）不参与去重，避免表格内重复单元格被误删
    if (!line.startsWith('|')) {
      if (seen.has(line)) return;
      seen.add(line);
    }
    lines.push(line);
  });

  const markdown = lines.join('\n\n').trim();
  if (markdown.length < 20) {
    throw new Error('飞书 client_vars 中未提取到正文');
  }
  return markdown;
}

function appendMissingMarkdownImages(markdown, fallbackMarkdown = '') {
  const source = String(markdown || '').trim();
  // 若已含飞书 image token 占位，图片由 replaceFeishuImageTokenPlaceholders 专门关联处理，
  // 不再追加 fallback 渲染图片，避免同一图片出现两次
  if (source.includes('feishu-image:')) return source;
  const existing = new Set();
  const collect = (text) => {
    const pattern = /!\[[^\]]*]\(([^)]+)\)/g;
    let match;
    while ((match = pattern.exec(String(text || '')))) {
      if (match[1]) existing.add(match[1]);
    }
  };
  collect(source);
  const additions = [];
  const pattern = /!\[([^\]]*)]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(String(fallbackMarkdown || '')))) {
    const alt = match[1] || '图片';
    const url = match[2] || '';
    if (!url || existing.has(url) || !isLikelyImageUrl(url) || isLikelyFeishuShellImage(alt, url)) continue;
    existing.add(url);
    additions.push(`![${alt || '图片'}](${url})`);
  }
  return additions.length ? `${source}\n\n${additions.join('\n\n')}`.trim() : source;
}

function isFeishuAssetPlaceholderLine(line) {
  const text = String(line || '').trim();
  if (!text || /^!\[/.test(text) || /^\[.+]\(.+\)$/.test(text)) return false;
  return /^[^\s\\/<>|?*:"]{2,180}\.(?:jpe?g|png|webp|gif|mp4|mov|m4v|webm|avi|mkv)$/i.test(text);
}

function isLikelyFeishuShellImage(alt = '', url = '') {
  const source = `${alt || ''} ${url || ''}`.toLowerCase();
  if (!source) return false;
  if (/^blob:/.test(String(url || '').trim())) return true;
  return /avatar|portrait|profile|user[-_]?avatar|icon|logo|emoji|sticker|reaction|comment|header|toolbar/.test(source)
    || /头像|图标|表情|评论/.test(`${alt || ''} ${url || ''}`);
}

function getFirstMarkdownHeading(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  for (const line of lines) {
    const match = String(line || '').trim().match(/^#{1,6}\s+(.+)$/);
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

function cleanFeishuRenderedMarkdown(markdown, structuredMarkdown = '') {
  const title = getFirstMarkdownHeading(structuredMarkdown);
  const cleaned = cleanMarkdownForStorage(markdown, {
    dedupe: true,
    feishuTitle: title,
  });
  return cleaned
    .split(/\r?\n/)
    .filter((line) => {
      const imageMatch = String(line || '').trim().match(/^!\[([^\]]*)]\(([^)]+)\)$/);
      if (!imageMatch) return true;
      return !isLikelyFeishuShellImage(imageMatch[1], imageMatch[2]);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getFeishuMarkdownBodyScore(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line && !/^!\[/.test(line) && !isFeishuAssetPlaceholderLine(line) && !shouldDropFeishuLine(line, ''))
    .join('\n')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/https?:\/\/[^\s<>()\]]+/gi, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, '')
    .length;
}

function countFeishuAssetPlaceholders(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .filter((line) => isFeishuAssetPlaceholderLine(line))
    .length;
}

function countMarkdownImages(markdown) {
  return (String(markdown || '').match(/!\[[^\]]*]\([^)]+\)/g) || []).length;
}

function shouldRefreshFeishuMarkdownFromSource(url, metadata = {}) {
  if (!isFeishuUrl(url)) return false;
  const markdown = String(metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '').trim();
  if (!markdown) return false;
  if (isFeishuMarkdownLikelyTruncated(markdown)) return true;
  const placeholderCount = countFeishuAssetPlaceholders(markdown);
  if (!placeholderCount) return false;
  const bodyScore = getFeishuMarkdownBodyScore(markdown);
  const imageCount = countMarkdownImages(markdown);
  const hasLinkedMedia = /\[[^\]]+\]\(https?:\/\/[^)]+\.(?:mp4|mov|m4v|webm|mp3|m4a|wav|aac|flac)(?:[?#][^)]*)?\)/i.test(markdown);
  return placeholderCount >= 2
    || (placeholderCount >= 1 && !imageCount && !hasLinkedMedia)
    || (placeholderCount >= 1 && bodyScore < 1500);
}

function mergeFeishuRenderedAndClientVarsMarkdown(renderedMarkdown = '', clientVarsMarkdown = '') {
  const structured = cleanMarkdownForStorage(String(clientVarsMarkdown || '').trim(), { dedupe: true });
  const rendered = cleanFeishuRenderedMarkdown(renderedMarkdown, structured);
  if (structured.length >= 20) {
    const structuredScore = getFeishuMarkdownBodyScore(structured);
    const renderedScore = getFeishuMarkdownBodyScore(rendered);
    const structuredPlaceholders = countFeishuAssetPlaceholders(structured);
    const renderedHasBodyMedia = countMarkdownImages(rendered) > 0;
    const renderedIsSubstantiallyRicher = renderedScore >= 160
      && renderedScore >= Math.max(structuredScore * 1.45, structuredScore + 80);
    if (rendered && (renderedIsSubstantiallyRicher || (structuredPlaceholders >= 2 && renderedHasBodyMedia && renderedScore > structuredScore))) {
      return appendMissingMarkdownImages(rendered, structured);
    }
    return appendMissingMarkdownImages(structured, rendered);
  }
  return rendered || String(renderedMarkdown || '').trim();
}

function extractFeishuDocumentTokenFromUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const match = parsed.pathname.match(/\/(?:docx|wiki)\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  } catch (error) {
    const match = String(url || '').match(/\/(?:docx|wiki)\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }
}

function buildFeishuClientVarsApiUrl(url) {
  const token = extractFeishuDocumentTokenFromUrl(url);
  if (!token) return '';
  const parsed = new URL(String(url || ''));
  parsed.pathname = '/space/api/docx/pages/client_vars';
  parsed.search = `?id=${encodeURIComponent(token)}`;
  parsed.hash = '';
  return parsed.toString();
}

function extractFeishuOpenApiUrlInfo(url) {
  const source = String(url || '').trim();
  if (!source) return null;
  let parsed = null;
  try {
    parsed = new URL(source);
  } catch (error) {
    parsed = null;
  }
  const path = parsed ? parsed.pathname : source;
  const match = String(path || '').match(/\/(wiki|docx|docs|doc)\/([^/?#]+)/i);
  if (!match) return null;
  const host = String((parsed && parsed.hostname) || '').toLowerCase();
  const isLark = /(?:^|\.)larksuite\.com$|(?:^|\.)larkoffice\.com$/.test(host);
  const kind = match[1].toLowerCase();
  return {
    apiBase: isLark ? 'https://open.larksuite.com/open-apis' : 'https://open.feishu.cn/open-apis',
    kind: kind === 'docs' ? 'doc' : kind,
    token: decodeURIComponent(match[2]),
  };
}

function buildFeishuOpenApiUrl(apiBase, path, params = {}) {
  const base = String(apiBase || 'https://open.feishu.cn/open-apis').replace(/\/+$/, '');
  const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function requestFeishuOpenApiJson({
  apiBase,
  path,
  method = 'GET',
  token = '',
  body = null,
  params = {},
  requestJson = requestUrl,
}) {
  const url = /^https?:\/\//i.test(String(path || ''))
    ? String(path)
    : buildFeishuOpenApiUrl(apiBase, path, params);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await requestJson({
    url,
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    throw: false,
  });
  const status = Number(response && response.status);
  const payload = (response && response.json) || tryParseJson((response && response.text) || '') || {};
  const apiErrorMessage = payload && (payload.msg || payload.message)
    ? `飞书 OpenAPI 返回 code ${payload.code || status}：${payload.msg || payload.message}`
    : '';
  if (status && (status < 200 || status >= 300)) {
    throw new Error(apiErrorMessage || `飞书 OpenAPI 请求失败：HTTP ${status}`);
  }
  if (payload && Number(payload.code || 0) !== 0) {
    throw new Error(apiErrorMessage || `飞书 OpenAPI 返回 code ${payload.code}`);
  }
  return payload;
}

async function fetchFeishuTenantAccessToken({ apiBase, appId, appSecret, requestJson = requestUrl }) {
  const normalizedAppId = String(appId || '').trim();
  const normalizedSecret = String(appSecret || '').trim();
  if (!normalizedAppId || !normalizedSecret) {
    throw new Error('未配置飞书自建应用凭据');
  }
  const payload = await requestFeishuOpenApiJson({
    apiBase,
    path: '/auth/v3/tenant_access_token/internal',
    method: 'POST',
    body: {
      app_id: normalizedAppId,
      app_secret: normalizedSecret,
    },
    requestJson,
  });
  const token = String(payload.tenant_access_token || '').trim();
  if (!token) throw new Error('飞书 OpenAPI 未返回 tenant_access_token');
  return {
    token,
    expire: Number(payload.expire || 0),
  };
}

async function resolveFeishuOpenApiDocument(url, token, { requestJson = requestUrl } = {}) {
  const info = extractFeishuOpenApiUrlInfo(url);
  if (!info || !info.token) throw new Error('飞书链接中未找到文档 token');
  if (info.kind === 'wiki') {
    const payload = await requestFeishuOpenApiJson({
      apiBase: info.apiBase,
      path: '/wiki/v2/spaces/get_node',
      token,
      params: { token: info.token },
      requestJson,
    });
    const node = payload && payload.data && payload.data.node;
    const documentId = String((node && node.obj_token) || '').trim();
    const objType = String((node && node.obj_type) || '').toLowerCase();
    if (!documentId) throw new Error('飞书 wiki 节点未返回真实文档 token');
    if (objType && !/doc|docx/.test(objType)) {
      throw new Error(`飞书 wiki 节点不是文档类型：${objType}`);
    }
    return {
      ...info,
      documentId,
      title: String((node && node.title) || '').trim(),
      objType,
    };
  }
  return {
    ...info,
    documentId: info.token,
    title: '',
    objType: info.kind,
  };
}

async function fetchFeishuOpenApiDocumentTitle(documentInfo, token, { requestJson = requestUrl } = {}) {
  try {
    const payload = await requestFeishuOpenApiJson({
      apiBase: documentInfo.apiBase,
      path: `/docx/v1/documents/${encodeURIComponent(documentInfo.documentId)}`,
      token,
      requestJson,
    });
    const document = payload && payload.data && payload.data.document;
    return String((document && document.title) || payload.title || documentInfo.title || '').trim();
  } catch (error) {
    return documentInfo.title || '';
  }
}

async function fetchFeishuOpenApiDocumentBlocks(documentInfo, token, { requestJson = requestUrl } = {}) {
  const items = [];
  let pageToken = '';
  for (let pageIndex = 0; pageIndex < FEISHU_OPEN_API_MAX_PAGES; pageIndex += 1) {
    const payload = await requestFeishuOpenApiJson({
      apiBase: documentInfo.apiBase,
      path: `/docx/v1/documents/${encodeURIComponent(documentInfo.documentId)}/blocks`,
      token,
      params: {
        page_size: FEISHU_OPEN_API_PAGE_SIZE,
        page_token: pageToken,
      },
      requestJson,
    });
    const data = (payload && payload.data) || {};
    const pageItems = Array.isArray(data.items) ? data.items : [];
    pageItems.forEach((item) => {
      if (item && typeof item === 'object') items.push(item);
    });
    if (!data.has_more) break;
    pageToken = String(data.page_token || '').trim();
    if (!pageToken) {
      throw new Error('飞书 OpenAPI 分页中断：has_more=true 但缺少 page_token');
    }
  }
  if (!items.length) throw new Error('飞书 OpenAPI 未返回文档 block');
  return items;
}

function extractFeishuMarkdownFromOpenApiBlocks(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const blockMap = {};
  const sequence = [];
  list.forEach((block) => {
    if (!block || typeof block !== 'object') return;
    const id = String(block.block_id || block.id || '').trim();
    if (!id) return;
    blockMap[id] = block;
    sequence.push(id);
  });
  if (!sequence.length) throw new Error('飞书 OpenAPI blocks 中未找到 block_id');
  return extractFeishuMarkdownFromClientVars({
    block_sequence: sequence,
    block_map: blockMap,
  });
}

async function fetchFeishuOpenApiMarkdownFromUrl(url, {
  appId = '',
  appSecret = '',
  tenantAccessToken = '',
  requestJson = requestUrl,
} = {}) {
  const info = extractFeishuOpenApiUrlInfo(url);
  if (!info) throw new Error('不是可识别的飞书文档链接');
  const accessToken = String(tenantAccessToken || '').trim()
    || (await fetchFeishuTenantAccessToken({
      apiBase: info.apiBase,
      appId,
      appSecret,
      requestJson,
    })).token;
  const documentInfo = await resolveFeishuOpenApiDocument(url, accessToken, { requestJson });
  const [title, blocks] = await Promise.all([
    fetchFeishuOpenApiDocumentTitle(documentInfo, accessToken, { requestJson }),
    fetchFeishuOpenApiDocumentBlocks(documentInfo, accessToken, { requestJson }),
  ]);
  const markdown = extractFeishuMarkdownFromOpenApiBlocks(blocks);
  return {
    source: 'feishu-open-api',
    title: title || documentInfo.title || getFirstMarkdownHeading(markdown) || '飞书链接',
    markdown,
    documentId: documentInfo.documentId,
    blockCount: blocks.length,
  };
}

function getFeishuRequestHeaders(url) {
  return {
    Accept: 'application/json, text/plain, */*',
    Referer: String(url || ''),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  };
}

async function fetchFeishuClientVarsMarkdown(url) {
  const apiUrl = buildFeishuClientVarsApiUrl(url);
  if (!apiUrl) throw new Error('飞书链接中未找到文档 token');
  const response = await requestUrl({
    url: apiUrl,
    method: 'GET',
    headers: getFeishuRequestHeaders(url),
  });
  const payload = response.json || JSON.parse(response.text || '{}');
  if (payload && payload.code && payload.code !== 0) {
    throw new Error(payload.msg || `飞书 client_vars 接口返回 code ${payload.code}`);
  }
  return extractFeishuMarkdownFromClientVars(payload);
}

// 基于文档 host 构造飞书图片下载 URL（需登录态，作为找不到 DOM 对应图时的兜底占位）
function buildFeishuImageFallbackUrl(token, docUrl) {
  const t = String(token || '').trim();
  if (!t) return '';
  let origin = '';
  try {
    origin = new URL(String(docUrl || '')).origin;
  } catch (error) {
    origin = 'https://feishu.cn';
  }
  return `${origin}/space/api/box/stream/download/v2/cover/${encodeURIComponent(t)}?width=0&height=0&policy=equal`;
}

// 把 markdown 里的 feishu-image:{token} 占位关联到 DOM 图片 assets 的真实 src，
// 使 saveWebpageImageAssets 能按 src 匹配下载到本地；找不到则用飞书下载 URL 兜底
function replaceFeishuImageTokenPlaceholders(markdown, assets, docUrl, tokenUrlMap = {}) {
  let result = String(markdown || '');
  if (!result.includes('feishu-image:')) return result;
  const tokenPattern = /!\[([^\]]*)\]\(feishu-image:([^)]+)\)/g;
  result = result.replace(tokenPattern, (full, alt, token) => {
    const t = String(token || '').trim();
    if (!t) return full;
    const mappedUrl = String(tokenUrlMap && tokenUrlMap[t] || '').trim();
    if (/^https?:\/\//i.test(mappedUrl)) {
      return `![${alt || '图片'}](${mappedUrl})`;
    }
    if (Array.isArray(assets)) {
      for (const asset of assets) {
        const src = String((asset && asset.src) || '');
        // 飞书 docx 图片 DOM src 通常含 token，且为 https 可下载链接
        if (src && src.indexOf(t) !== -1 && /^https?:\/\//i.test(src)) {
          return `![${alt || '图片'}](${src})`;
        }
      }
    }
    const fallback = buildFeishuImageFallbackUrl(t, docUrl);
    return fallback ? `![${alt || '图片'}](${fallback})` : full;
  });
  return result;
}

function yamlValue(value, options = {}) {
  if (value === undefined || value === null) return '';
  const normalize = (input) => String(input || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (Array.isArray(value)) {
    value = value
      .map((item) => normalize(item))
      .filter(Boolean)
      .join(', ');
  }
  const text = normalize(value);
  if (!text) return '';
  if (options.quote || /[\r\n]/.test(text) || /^(?:true|false|null|yes|no|on|off)$/i.test(text)) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return text;
}

function buildFrontmatter(lines) {
  return ['---', ...lines, '---', ''].join('\n');
}

function parseNotePropertyFields(propertyFields) {
  return normalizeNotePropertyFields(propertyFields).split(',').filter(Boolean);
}

function getRecordUrl(record, metadata = record && record.metadata || {}) {
  return cleanDisplayUrl(metadata.url || metadata.originalUrl || record.content || '');
}

function getRecordAuthor(metadata = {}) {
  return metadata.author
    || metadata.accountName
    || metadata.nickname
    || metadata.nickName
    || metadata.sourceName
    || '';
}

function getRecordDescription(metadata = {}) {
  return metadata.description
    || metadata.summary
    || metadata.excerpt
    || metadata.abstract
    || '';
}

function cleanFeishuPropertyText(value) {
  return String(value || '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\u6dfb\u52a0\u5feb\u6377\u65b9\u5f0f\s*\u6700\u8fd1\u4fee\u6539\s*[:\uff1a]?\s*[^,\uff0c\u3002\uff01\uff1f!?]{0,30}/g, ' ')
    .replace(/\u6700\u8fd1\u4fee\u6539\s*[:\uff1a]?\s*[^,\uff0c\u3002\uff01\uff1f!?]{0,30}/g, ' ')
    .replace(/\bheader-v2\b/gi, ' ')
    .replace(/\b\u5206\u4eab\b/g, ' ')
    .replace(/-\s+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanFeishuDescriptionForFrontmatter(value) {
  const beforeShell = String(value || '').split(/\u6dfb\u52a0\u5feb\u6377\u65b9\u5f0f|\u6700\u8fd1\u4fee\u6539|header-v2/i)[0] || value;
  const cleaned = cleanFeishuPropertyText(beforeShell);
  const firstSentence = cleaned.split(/[\u3002\uff01\uff1f!?]\s*/).map((item) => item.trim()).filter(Boolean)[0] || cleaned;
  return firstSentence.slice(0, 160).trim();
}

function cleanRecordFrontmatterField(record, key, value) {
  const metadata = (record && record.metadata) || {};
  const url = getRecordUrl(record || {}, metadata);
  if (!isFeishuUrl(url)) return value;
  if (key === 'title' || key === 'author' || key === 'source') return cleanFeishuPropertyText(value);
  if (key === 'description') return cleanFeishuDescriptionForFrontmatter(value);
  if (key === 'keywords' && Array.isArray(value)) return value.map((item) => cleanFeishuPropertyText(item)).filter(Boolean);
  if (key === 'keywords') return cleanFeishuPropertyText(value);
  return value;
}

function getRecordKeywords(metadata = {}) {
  const value = metadata.keywords || metadata.tags || metadata.hashtags || [];
  if (Array.isArray(value)) return value;
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripMarkdownForDescription(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+/.test(String(line || '').trim()))
    .join('\n')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[\[([^\]]+)]]/g, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\|.*\|$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywordsFromText(text, title = '') {
  const source = `${title || ''} ${text || ''}`;
  const keywords = [];
  const candidates = [
    '风口',
    '小红书',
    'AI',
    '知识库',
    '飞书',
    '复盘',
    '电商',
    '公众号',
    '流量',
    '创新',
    '创业',
  ];
  candidates.forEach((candidate) => {
    if (source.includes(candidate) && !keywords.includes(candidate)) keywords.push(candidate);
  });
  if (keywords.length) return keywords.slice(0, 8);
  return Array.from(new Set(String(source || '').match(/[\p{L}\p{N}]{2,12}/gu) || [])).slice(0, 6);
}

function enrichExtractedWebpageMetadata(metadata = {}) {
  const next = { ...metadata };
  const text = stripMarkdownForDescription(next.markdown || next.content || '');
  if (!next.description && text) {
    const sentences = text.split(/[。！？!?]\s*/).map((item) => item.trim()).filter((item) => item.length >= 8);
    next.description = (sentences[0] || text).slice(0, 120);
  }
  if (!getRecordKeywords(next).length) {
    next.keywords = extractKeywordsFromText(`${next.description || ''} ${text}`, next.title || '');
  }
  return next;
}

function getRecordSourceLabel(record, metadata = {}) {
  const type = String(record && record.type || '').toLowerCase();
  const url = getRecordUrl(record, metadata);
  let platform = metadata.platform || metadata.platformName || '';
  if (!platform) platform = getWebpageSourcePrefix(url);
  if (!platform && type === 'voice') platform = '录音';
  if (!platform && type === 'file') platform = '文件';
  if (!platform && type === 'text') platform = '文本';
  if (!platform) platform = record.source || '微信小程序';

  let category = metadata.contentCategory || metadata.category || metadata.noteType || '';
  if (!category) {
    if (type === 'voice') category = '录音';
    else if (type === 'file') category = metadata.fileExt ? String(metadata.fileExt).toUpperCase() : '文件';
    else if (metadata.transcriptOnly || metadata.webpageMediaType === 'audio_video') category = '音视频';
    else if (type === 'webpage' || type === 'link') category = '图文';
  }

  const normalizedPlatform = String(platform || '').trim();
  const normalizedCategory = String(category || '').trim();
  if (normalizedPlatform && normalizedCategory && !normalizedPlatform.includes(normalizedCategory)) {
    return `${normalizedPlatform}${normalizedCategory}`;
  }
  return normalizedPlatform || normalizedCategory || '';
}

function buildRecordFrontmatter(record, title, syncedAt, audioFileName, propertyFields = DEFAULT_NOTE_PROPERTY_FIELDS) {
  const type = String(record.type || '').toLowerCase();
  const metadata = record.metadata || {};
  const aiMetadataSource = String(metadata.aiMetadataSource || '').trim();
  const fields = {
    id: getRecordId(record),
    type,
    title,
    author: getRecordAuthor(metadata),
    url: getRecordUrl(record, metadata),
    created_at: record.createdAt,
    synced_at: syncedAt,
    source: getRecordSourceLabel(record, metadata),
    description: aiMetadataSource ? getRecordDescription(metadata) : '',
    keywords: aiMetadataSource ? getRecordKeywords(metadata) : [],
    status: 'synced',
  };

  if (type === 'link') {
    fields.fetch_status = metadata.fetchStatus || 'pending';
  }

  if (type === 'webpage') {
    fields.conversion_status = metadata.conversionStatus || 'pending';
  }

  if (type === 'voice') {
    fields.audio_file = audioFileName;
    fields.audio_file_id = metadata.audioFileID || '';
    fields.transcription_status = metadata.transcriptionStatus || 'pending';
  }

  if (type === 'file') {
    fields.file_name = metadata.fileName || record.content || '';
    fields.file_id = metadata.fileID || '';
    fields.file_ext = metadata.fileExt || '';
    fields.conversion_status = metadata.conversionStatus || 'pending';
  }

  const defaultFieldOrder = parseNotePropertyFields(DEFAULT_NOTE_PROPERTY_FIELDS);
  const legacyFieldOrder = [
    'id',
    'type',
    'title',
    'author',
    'url',
    'created_at',
    'synced_at',
    'source',
    'description',
    'keywords',
    'status',
    'fetch_status',
    'conversion_status',
    'audio_file',
    'audio_file_id',
    'transcription_status',
    'file_name',
    'file_id',
    'file_ext',
  ];
  const selectedFields = parseNotePropertyFields(propertyFields);
  const fieldOrder = selectedFields.length ? selectedFields : (defaultFieldOrder.length ? defaultFieldOrder : legacyFieldOrder);
  const shouldQuoteFrontmatterValue = isFeishuUrl(getRecordUrl(record, metadata));
  const lines = fieldOrder
    .filter((key) => Object.prototype.hasOwnProperty.call(fields, key))
    .map((key) => [key, cleanRecordFrontmatterField(record, key, fields[key])])
    .filter(([, value]) => yamlValue(value, { quote: shouldQuoteFrontmatterValue }))
    .map(([key, value]) => `${key}: ${yamlValue(value, { quote: shouldQuoteFrontmatterValue })}`);

  return buildFrontmatter(lines);
}

function buildMarkdownForRecord({ record, title, syncedAt, propertyFields = DEFAULT_NOTE_PROPERTY_FIELDS }) {
  const type = String(record.type || '').toLowerCase();
  const metadata = record.metadata || {};
  const audioFileName = metadata.audioFileName || `${title}.mp3`;

  let body = '';
  if (type === 'text') {
    body = `${record.content || ''}\n`;
  } else if (type === 'link') {
    const pageTitle = metadata.title || title;
    const url = cleanDisplayUrl(metadata.url || record.content || '');
    const snapshot = metadata.snapshot || metadata.contentSnapshot || '';
    const fallback = metadata.fetchStatus === 'failed'
      ? '正文抓取失败，已保存标题和原始链接。'
      : '正文快照处理中，已先保存标题和原始链接。';
    body = [
      pageTitle,
      '',
      '## 正文快照',
      '',
      snapshot || fallback,
      '',
    ].join('\n');
  } else if (type === 'webpage') {
    body = buildWebpageMarkdownBody(record, title);
  } else if (type === 'voice') {
    const errorText = metadata.transcriptionError || metadata.aiError || '';
    const transcription = metadata.transcription
      || (metadata.transcriptionStatus === 'failed' ? `语音转写失败。${errorText}` : '未开启语音转写。');
    body = [
      '## 转写全文',
      '',
      transcription,
      '',
      '## 录音文件',
      '',
      `![[${audioFileName}]]`,
      '',
    ].join('\n');
  } else if (type === 'file') {
    body = buildFileMarkdownBody(record);
  } else {
    throw new Error(`Unsupported record type: ${record.type}`);
  }

  const frontmatter = buildRecordFrontmatter(record, title, syncedAt, audioFileName, propertyFields);
  const recordIdMarker = buildRecordIdMarker(getRecordId(record));
  return `${frontmatter}\n${recordIdMarker ? `${recordIdMarker}\n\n` : ''}${body}`;
}

function buildSyncNotice(count) {
  return count ? `已同步 ${count} 条内容到 Obsidian` : '没有需要同步的新内容';
}

function buildSkippedSyncNotice(skipped = []) {
  const cloudProcessingCount = skipped.filter((item) => item && item.reason === 'cloud-transcription-processing').length;
  const otherSkippedCount = skipped.filter((item) => item && item.reason !== 'already-synced-local' && item.reason !== 'cloud-transcription-processing').length;
  const parts = [];
  if (cloudProcessingCount) {
    parts.push(`${cloudProcessingCount} 条云端转写中，完成后再同步`);
  }
  if (otherSkippedCount) {
    parts.push(`${otherSkippedCount} 条已跳过`);
  }
  return parts.length ? `，${parts.join('，')}` : '';
}

function normalizeProgressPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.floor(number)));
}

function parseLocalAsrProgressLog(text) {
  const source = String(text || '');
  const values = {};
  source.split(/\r?\n/).forEach((line) => {
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(String(line || '').trim());
    if (match) values[match[1]] = match[2];
  });
  if (
    !Object.prototype.hasOwnProperty.call(values, 'progressStage')
    && !Object.prototype.hasOwnProperty.call(values, 'progressCurrent')
    && !Object.prototype.hasOwnProperty.call(values, 'progressTotal')
    && !Object.prototype.hasOwnProperty.call(values, 'progressPercent')
  ) {
    return null;
  }
  const current = Number(values.progressCurrent);
  const total = Number(values.progressTotal);
  let percent = normalizeProgressPercent(values.progressPercent);
  if (percent === null && Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    percent = normalizeProgressPercent((current * 100) / total);
  }
  if (percent === null) percent = 0;
  return {
    stage: values.progressStage || '',
    current: Number.isFinite(current) ? current : 0,
    total: Number.isFinite(total) ? total : 0,
    percent,
  };
}

function buildSyncProgressMessage({
  bindingLabel = '',
  stage = '',
  current = 0,
  total = 0,
  title = '',
  percent = null,
} = {}) {
  const label = bindingLabel ? `${bindingLabel}：` : '';
  const countText = total ? `${current}/${total}` : '';
  const normalizedPercent = normalizeProgressPercent(percent);
  const percentText = normalizedPercent === null ? '' : ` (${normalizedPercent}%)`;
  const suffix = title ? `：${title}` : '';
  if (stage === 'fetching') return `${label}正在同步，正在获取待同步内容`;
  if (stage === 'empty') return `${label}没有需要同步的新内容`;
  if (stage === 'processing') return `${label}正在处理 ${countText}${suffix}`;
  if (stage === 'downloading') return `${label}正在下载附件 ${countText}${percentText}${suffix}`;
  if (stage === 'transcribing') return `${label}正在转写音视频 ${countText}${percentText}${suffix}`;
  if (stage === 'writing') return `${label}正在写入 Obsidian ${countText}${suffix}`;
  if (stage === 'marking') return `${label}正在更新同步状态 ${countText}${suffix}`;
  return `${label}正在同步${countText ? ` ${countText}` : ''}${suffix}`;
}

function getRecordConversionWarning(record) {
  if (!record) return '';
  const metadata = record.metadata || {};
  const status = metadata.conversionStatus || metadata.transcriptionStatus || '';
  const errorMsg = metadata.conversionError || metadata.transcriptionError || '';
  if (status === 'failed') {
    return errorMsg || '网页转写失败（未知原因）';
  }
  if (status === 'wechat_captcha') {
    return '微信安全验证拦截';
  }
  if (status === 'link_saved') {
    return errorMsg || '网页抓取未成功';
  }
  return '';
}

function isCloudTranscriptionWaitingRecord(record) {
  const metadata = (record && record.metadata) || {};
  const status = String(metadata.transcriptionStatus || '').toLowerCase();
  const source = String(metadata.transcriptionSource || metadata.transcriptionProvider || '').toLowerCase();
  const isCloudRecord = metadata.transcriptionMode === 'cloud'
    || metadata.cloudTranscriptionRequested === true
    || source.includes('cloud-pretranscription')
    || source.includes('cloud');
  const hasTranscription = String(metadata.transcription || '').trim().length > 0;
  return isCloudRecord && !hasTranscription && ['pending', 'queued', 'processing'].includes(status);
}

function isAudioVideoTranscriptionIncompleteRecord(record) {
  const metadata = (record && record.metadata) || {};
  const status = String(metadata.transcriptionStatus || '').toLowerCase();
  const hasTranscription = String(metadata.transcription || '').trim().length > 0;
  const hasPersistableMarkdown = String(metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '').trim().length > 0;
  if (hasPersistableMarkdown) return false;
  const isAudioVideoRecord = String(record && record.type || '').toLowerCase() === 'voice'
    || metadata.webpageMediaType === 'audio_video'
    || Boolean(metadata.audioFileID)
    || metadata.transcriptOnly === true;
  if (!isAudioVideoRecord || hasTranscription) return false;
  return ['pending', 'queued', 'processing', 'failed'].includes(status);
}

const LocalComponentInstallConfirmModalBase = Modal || class {};

class LocalComponentInstallConfirmModal extends LocalComponentInstallConfirmModalBase {
  constructor(app, options = {}) {
    super(app);
    this.message = String(options.message || '');
    this.resolve = typeof options.resolve === 'function' ? options.resolve : () => {};
    this.finished = false;
  }

  finish(value) {
    if (this.finished) return;
    this.finished = true;
    this.resolve(Boolean(value));
    this.close();
  }

  onOpen() {
    const contentEl = this.contentEl;
    if (!contentEl) return;
    contentEl.empty();
    contentEl.createEl('h3', { text: '本地转写组件准备' });
    this.message
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => contentEl.createEl('p', { text: line }));

    const buttonRow = contentEl.createDiv({ cls: 'wechat-inbox-sync-modal-actions' });
    const confirmButton = buttonRow.createEl('button', { text: '开始安装/修复' });
    if (typeof confirmButton.addClass === 'function') {
      confirmButton.addClass('mod-cta');
    } else {
      confirmButton.className = `${confirmButton.className || ''} mod-cta`.trim();
    }
    confirmButton.addEventListener('click', () => this.finish(true));

    const laterButton = buttonRow.createEl('button', { text: '稍后再试' });
    laterButton.addEventListener('click', () => this.finish(false));
  }

  onClose() {
    if (this.contentEl) this.contentEl.empty();
    if (!this.finished) {
      this.finished = true;
      this.resolve(false);
    }
  }
}

function showLocalComponentInstallConfirm(app, message) {
  if (!Modal || !app) return null;
  return new Promise((resolve) => {
    new LocalComponentInstallConfirmModal(app, { message, resolve }).open();
  });
}

class LocalComponentInstallFailureModal extends LocalComponentInstallConfirmModalBase {
  constructor(app, options = {}) {
    super(app);
    this.message = String(options.message || '');
  }

  onOpen() {
    const contentEl = this.contentEl;
    if (!contentEl) return;
    contentEl.empty();
    contentEl.createEl('h3', { text: '本地转写组件安装失败' });
    this.message
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => contentEl.createEl('p', { text: line }));

    const buttonRow = contentEl.createDiv({ cls: 'wechat-inbox-sync-modal-actions' });
    const closeButton = buttonRow.createEl('button', { text: '知道了' });
    if (typeof closeButton.addClass === 'function') {
      closeButton.addClass('mod-cta');
    } else {
      closeButton.className = `${closeButton.className || ''} mod-cta`.trim();
    }
    closeButton.addEventListener('click', () => this.close());
  }

  onClose() {
    if (this.contentEl) this.contentEl.empty();
  }
}

function showLocalComponentInstallFailure(app, message) {
  if (!Modal || !app) return null;
  return new Promise((resolve) => {
    const modal = new LocalComponentInstallFailureModal(app, { message });
    const originalOnClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      originalOnClose();
      resolve(true);
    };
    modal.open();
  });
}

function formatLocalComponentInstallFailureReason(error) {
  const rawMessage = String(error && (error.message || error) || '未知错误').trim();
  const lines = rawMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const isCurlProgressLine = (line) => /^%?\s*Total\s+%?\s*Received/i.test(line)
    || /Dload\s+Upload\s+Total\s+Spent\s+Left\s+Speed/i.test(line)
    || /^\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+/.test(line)
    || /^-+:\s*-+:\s*-+/.test(line);
  const isFailureLine = (line) => /curl:\s*\(\d+\)|status\s*=\s*failed|failed|failure|error|exception|traceback|connection reset|timed out|timeout|not found|permission denied|denied|无法|失败|错误|异常|超时|未找到|拒绝/i.test(line);
  const failureLines = lines.filter((line) => !isCurlProgressLine(line) && isFailureLine(line));
  const cleanLines = failureLines.length
    ? failureLines
    : lines.filter((line) => !isCurlProgressLine(line));
  return cleanLines.slice(0, 6).join('\n') || '未知错误';
}

class WechatObsidianInboxPlugin extends Plugin {
  async onload() {
    const savedSettings = await this.loadData();
    this.settings = mergeSettings(savedSettings);
    if (!savedSettings || !savedSettings.clientId) {
      await this.saveData(this.settings);
    }
    this.lastSyncDiagnostic = null;
    this.syncStatusBar = typeof this.addStatusBarItem === 'function' ? this.addStatusBarItem() : null;
    if (this.syncStatusBar && typeof this.syncStatusBar.setText === 'function') {
      this.syncStatusBar.setText('');
    }
    this.localAsrInstallPromise = null;
    this.currentTranscriptionAbortController = null;
    this.currentTranscriptionProcess = null;

    this.addCommand({
      id: 'sync-wechat-inbox',
      name: '同步微信收集箱',
      callback: () => this.syncInbox(),
    });

    this.addCommand({
      id: 'stop-current-transcription',
      name: '停止当前转写',
      callback: () => this.stopCurrentTranscription(),
    });

    this.addCommand({
      id: 'login-xiaohongshu-web',
      name: '登录小红书（用于提取小红书评论区）',
      callback: () => this.loginXiaohongshu(),
    });

    this.addRibbonIcon('inbox', '同步微信收集箱', () => {
      this.syncInbox();
    });

    this.addSettingTab(new WechatInboxSettingTab(this.app, this));

    if (this.settings.autoSyncOnLoad) {
      window.setTimeout(() => this.syncInbox(false), 1000);
    }
  }

  async saveSettings(nextSettings) {
    this.settings = mergeSettings(nextSettings);
    await this.saveData(this.settings);
  }

  async checkWechatLogin() {
    try {
      return await checkWechatLoginStatus();
    } catch (error) {
      return false;
    }
  }

  async checkFeishuLogin() {
    try {
      return await checkFeishuLoginStatus();
    } catch (error) {
      return false;
    }
  }

  async checkXiaohongshuLogin() {
    try {
      return await probeXiaohongshuLoginStatus();
    } catch (error) {
      return false;
    }
  }

  async loginWechat() {
    try {
      const loggedIn = await loginWechatWeb(null);
      if (loggedIn) {
        new Notice('微信登录成功！后续同步公众号文章时会自动提取评论区内容。');
      } else {
        new Notice('微信登录未完成，请在浏览器窗口中扫码后重试。');
      }
    } catch (error) {
      new Notice(`微信登录失败：${error.message || error}`);
    }
  }

  async loginFeishu(targetUrl = '') {
    try {
      const loggedIn = await loginFeishuWeb(targetUrl || null);
      if (loggedIn) {
        new Notice('飞书登录已保存，后续同步会复用该登录状态。');
      } else {
        new Notice('飞书登录未确认，请在打开的窗口中完成登录后再同步。');
      }
    } catch (error) {
      new Notice(`飞书登录失败：${error.message || error}`);
    }
  }

  async loginXiaohongshu(targetUrl = '') {
    try {
      const loggedIn = await loginXiaohongshuWeb(targetUrl || null);
      if (loggedIn) {
        new Notice('小红书登录已保存，后续同步小红书图文会复用该登录状态提取评论区。');
      } else {
        new Notice('小红书登录未确认，请在打开的窗口中完成登录后再同步。');
      }
    } catch (error) {
      new Notice(`小红书登录失败：${error.message || error}`);
    }
  }

  async resolveWechatChannelsListenerUrl(targetUrl = '') {
    const source = String(targetUrl || this.settings.wechatChannelsExperimentUrl || '').trim();
    if (!source) return 'https://channels.weixin.qq.com/';
    if (!isWechatChannelsUrl(source)) return source;
    const payload = extractWechatChannelsRequestPayload(source);
    if (payload.exportId) return buildWechatChannelsPreviewUrl(source);
    try {
      const feed = await this.fetchWechatChannelsFeedInfo(source);
      if (feed.dynamicExportId) {
        return `https://channels.weixin.qq.com/web/pages/feed?eid=${encodeURIComponent(feed.dynamicExportId)}&context_id=wechat-inbox-${Date.now()}&entrance_id=1019`;
      }
    } catch (error) {
      // Fall back to the public preview page; logged-in pages can still trigger useful requests.
    }
    return buildWechatChannelsPreviewUrl(source);
  }

  async openWechatChannelsListener(targetUrl = '') {
    const BrowserWindow = getElectronBrowserWindow();
    if (!BrowserWindow) {
      new Notice('当前版本已暂停视频号监听功能。');
      return null;
    }
    const session = getWechatSession();
    if (!session) {
      new Notice('无法创建微信网页会话。');
      return null;
    }

    const listenerUrl = await this.resolveWechatChannelsListenerUrl(targetUrl);
    await this.saveSettings({
      ...this.settings,
      wechatChannelsExperimentUrl: String(targetUrl || this.settings.wechatChannelsExperimentUrl || '').trim(),
    });

    const win = new BrowserWindow({
      width: 1100,
      height: 860,
      show: true,
      title: '视频号转写监听（实验）',
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const requestMeta = new Map();
    const debuggerApi = win.webContents && win.webContents.debugger;
    const inspectCapturedBody = async (requestId) => {
      const meta = requestMeta.get(requestId) || {};
      const inspectKey = `${meta.url || ''} ${meta.mimeType || ''} ${meta.type || ''}`.toLowerCase();
      if (!/(channels\.weixin\.qq\.com|finder|wechat|json|cgi|feed|object|comment|profile|media|video)/i.test(inspectKey)) return;
      try {
        const bodyResult = await debuggerApi.sendCommand('Network.getResponseBody', { requestId });
        const rawBody = bodyResult && bodyResult.body ? bodyResult.body : '';
        if (!rawBody || rawBody.length > 8 * 1024 * 1024) return;
        const text = bodyResult.base64Encoded
          ? Buffer.from(rawBody, 'base64').toString('utf8')
          : rawBody;
        const profiles = extractWechatChannelsProfilesFromText(text, targetUrl || this.settings.wechatChannelsExperimentUrl || meta.url || listenerUrl);
        for (const profile of profiles) {
          await this.handleWechatChannelsCapturedProfile(profile, targetUrl || this.settings.wechatChannelsExperimentUrl || meta.url || listenerUrl);
        }
      } catch (error) {
        // Some responses cannot be read after completion; keep listening.
      } finally {
        requestMeta.delete(requestId);
      }
    };

    if (debuggerApi) {
      try {
        debuggerApi.attach('1.3');
        await debuggerApi.sendCommand('Network.enable');
        debuggerApi.on('message', (_event, method, params = {}) => {
          if (method === 'Network.responseReceived' && params.requestId) {
            requestMeta.set(params.requestId, {
              url: params.response && params.response.url,
              mimeType: params.response && params.response.mimeType,
              type: params.type,
            });
          }
          if (method === 'Network.loadingFinished' && params.requestId) {
            inspectCapturedBody(params.requestId);
          }
        });
        win.on('closed', () => {
          try {
            if (debuggerApi.isAttached && debuggerApi.isAttached()) {
              debuggerApi.detach();
            }
          } catch (error) {}
        });
        new Notice('视频号监听窗口已打开。扫码登录后，打开或刷新视频号内容，捕获到媒体后会自动转写保存。');
      } catch (error) {
        new Notice(`视频号监听未能启用网络捕获：${error.message || error}`);
      }
    }

    try {
      await win.loadURL(listenerUrl);
    } catch (error) {
      new Notice(`打开视频号页面失败：${error.message || error}`);
    }
    return win;
  }

  async handleWechatChannelsCapturedProfile(profile, sourceUrl = '') {
    const mediaItems = Array.isArray(profile && profile.mediaItems) ? profile.mediaItems : [];
    const mediaUrl = profile.videoUrl || (mediaItems[0] && mediaItems[0].url) || '';
    if (!mediaUrl) return null;
    const decryptKey = String((mediaItems[0] && (mediaItems[0].decryptKey || mediaItems[0].decodeKey)) || profile.decodeKey || '').trim();
    const captureKey = `${mediaUrl}|${decryptKey}`;
    this.wechatChannelsCapturedMediaKeys = this.wechatChannelsCapturedMediaKeys || new Set();
    this.wechatChannelsCaptureInFlight = this.wechatChannelsCaptureInFlight || new Set();
    if (this.wechatChannelsCapturedMediaKeys.has(captureKey) || this.wechatChannelsCaptureInFlight.has(captureKey)) {
      return null;
    }
    this.wechatChannelsCaptureInFlight.add(captureKey);
    try {
      new Notice('已捕获视频号媒体，开始转写...');
      const now = new Date().toISOString();
      const title = profile.title || buildWechatChannelsTitle(profile.description || '', '视频号口播文案');
      const record = {
        _id: `wechat-channels-local-${crypto.createHash('sha256').update(captureKey).digest('hex').slice(0, 24)}`,
        type: 'webpage',
        content: cleanDisplayUrl(sourceUrl || profile.sourceUrl || mediaUrl),
        createdAt: now,
        metadata: {
          url: cleanDisplayUrl(sourceUrl || profile.sourceUrl || ''),
          title,
          author: profile.author || '',
          platform: '视频号',
          contentCategory: '视频',
          webpageMediaType: 'audio_video',
          transcriptOnly: true,
          coverUrl: profile.coverUrl || (mediaItems[0] && mediaItems[0].coverUrl) || '',
          dynamicExportId: profile.dynamicExportId || '',
          wechatChannelsDecodeKey: decryptKey,
          wechatChannelsEncryptedMedia: Boolean(decryptKey),
        },
      };
      const activeBinding = this.getActiveBindings()[0] || null;
      const transcribedRecord = await this.buildTranscriptRecordFromMedia(record, {
        url: sourceUrl || profile.sourceUrl || mediaUrl,
        platform: '视频号',
        mediaUrl,
        mediaUrls: Array.isArray(profile.mediaUrls) ? profile.mediaUrls : mediaItems.map((item) => item.url).filter(Boolean),
        mediaItems,
        source: 'wechat-channels-local-capture',
        binding: activeBinding,
        title,
        noMediaError: '监听窗口未捕获到可转写的视频号媒体资源',
      });
      const metadata = transcribedRecord.metadata || {};
      if (metadata.transcriptionStatus !== 'success') {
        throw new Error(metadata.transcriptionError || '视频号转写失败');
      }
      const transcriptProperties = buildTranscriptPropertyMetadata({
        transcription: metadata.transcription,
        title,
      });
      const finalRecord = {
        ...transcribedRecord,
        metadata: {
          ...metadata,
          title: metadata.title || title,
          author: metadata.author || profile.author || '',
          platform: '视频号',
          contentCategory: '视频',
          coverUrl: metadata.coverUrl || profile.coverUrl || '',
          dynamicExportId: metadata.dynamicExportId || profile.dynamicExportId || '',
          description: metadata.description || transcriptProperties.description,
          keywords: getRecordKeywords(metadata).length ? getRecordKeywords(metadata) : transcriptProperties.keywords,
          aiMetadataSource: metadata.aiMetadataSource || transcriptProperties.aiMetadataSource,
          wechatChannelsDecodeKey: metadata.wechatChannelsDecodeKey || decryptKey,
          wechatChannelsEncryptedMedia: Boolean(metadata.wechatChannelsDecodeKey || decryptKey),
        },
      };
      const result = await this.writeCapturedWechatChannelsRecord(finalRecord, now, activeBinding);
      this.wechatChannelsCapturedMediaKeys.add(captureKey);
      new Notice(`视频号转写已保存：${result.title}`);
      return result;
    } catch (error) {
      new Notice(`视频号转写失败：${error.message || error}`);
      return null;
    } finally {
      this.wechatChannelsCaptureInFlight.delete(captureKey);
    }
  }

  async writeCapturedWechatChannelsRecord(record, syncedAt, binding = null) {
    const dateFolder = getDateFolderName(record.createdAt);
    const rootDir = this.settings.inboxDir;
    const noteDir = this.settings.noteSaveMode === 'root' ? rootDir : `${rootDir}/${dateFolder}`;
    await this.ensureFolder(rootDir);
    await this.ensureFolder(noteDir);
    const title = await this.nextRecordTitle(noteDir, record, '');
    const recordForMarkdown = await this.enrichRecordMetadataWithAi(record, binding);
    const markdown = buildMarkdownForRecord({
      record: recordForMarkdown,
      title,
      syncedAt,
      propertyFields: this.settings.notePropertyFields,
    });
    const filePath = `${noteDir}/${title}.md`;
    await this.app.vault.adapter.write(filePath, markdown);
    return {
      recordId: getRecordId(record),
      filePath,
      title,
      conversionWarning: getRecordConversionWarning(recordForMarkdown),
    };
  }

  async cacheLocalTranscriptionEntitlementStatus(status) {
    this.settings = mergeSettings({
      ...this.settings,
      localTranscriptionEntitlementStatus: status,
    });
    if (typeof this.saveData === 'function') {
      await this.saveData(this.settings);
    }
  }

  getActiveBindings() {
    const bindings = normalizeBindings(this.settings)
      .filter((item) => item.enabled !== false && item.status !== 'unbound' && item.token);
    if (bindings.length) return bindings;
    return this.settings.token
      ? [{
        token: this.settings.token,
        label: '默认微信',
        enabled: true,
        boundAt: '',
        lastSyncAt: '',
      }]
      : [];
  }

  async syncTranscriptionPreferences() {
    const payload = {
      cloudPreTranscriptionEnabled: Boolean(this.settings.cloudPreTranscriptionEnabled),
      cloudPreTranscriptionThresholdMinutes: normalizeCloudPreTranscriptionThresholdMinutes(this.settings.cloudPreTranscriptionThresholdMinutes),
    };
    const bindings = this.getActiveBindings();
    for (const binding of bindings) {
      // eslint-disable-next-line no-await-in-loop
      await this.requestJson('/transcription-preferences', 'POST', payload, binding);
    }
    return payload;
  }

  async requestJson(path, method = 'GET', body = {}, binding = null) {
    const fallbackToken = getPrimaryBoundToken(normalizeBindings(this.settings));
    const token = normalizeBindCodeInput(
      typeof binding === 'string'
        ? binding
        : ((binding && binding.token) || this.settings.token || fallbackToken),
    );
    if (!token) {
      throw new Error('请先在插件设置里输入小程序绑定码并完成绑定。');
    }
    const retryWithOfficialApiBaseIfNeeded = async (message) => {
      const currentApiBase = trimTrailingSlash(this.settings.apiBase || '');
      const officialApiBase = trimTrailingSlash(OFFICIAL_SYNC_API_BASE);
      const shouldRetry = isInvalidCloudBaseEnvMessage(message)
        || /Invalid or expired token|Invalid bind code|绑定码未绑定或已失效|403/i.test(String(message || ''));
      if (!shouldRetry || currentApiBase === officialApiBase) {
        return null;
      }
      await this.saveSettings({
        ...this.settings,
        apiBase: OFFICIAL_SYNC_API_BASE,
      });
      return await this.requestJson(path, method, body, binding);
    };
    const isFeishuCloudRequest = /^\/feishu(?:\/|$)/.test(String(path || ''));
    const apiBaseForRequest = isFeishuCloudRequest
      ? FEISHU_OAUTH_SYNC_API_BASE
      : this.settings.apiBase;
    const requestPath = path;
    const requestBody = body || {};
    const requestOptions = {
      url: `${trimTrailingSlash(apiBaseForRequest)}${requestPath}`,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Wechat-Inbox-Token': token,
        'X-Wechat-Inbox-Client-Id': this.settings.clientId,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(requestBody || {}) : undefined,
    };

    let response;
    try {
      response = await requestUrl(requestOptions);
    } catch (error) {
      const message = error && error.message ? error.message : String(error || '');
      if (message.includes('403')) {
        throw new Error('绑定码未绑定或已失效，请在插件设置里粘贴小程序绑定码后点击「立即绑定」');
      }
      if (isRequestUrlTransportError(message)) {
        try {
          response = await requestJsonViaNode(requestOptions);
        } catch (fallbackError) {
          const fallbackMessage = fallbackError && fallbackError.message ? fallbackError.message : String(fallbackError || '');
          throw new Error(`网络连接失败：${fallbackMessage || message}`);
        }
      } else {
        throw error;
      }
    }

    let payload = response.json || null;
    if (!payload && response.text) {
      try {
        payload = JSON.parse(response.text || '{}');
      } catch (error) {
        payload = null;
      }
    }
    if (response.status && (response.status < 200 || response.status >= 300)) {
      const message = (payload && payload.errMsg) || `HTTP ${response.status}`;
      const officialRetryPayload = await retryWithOfficialApiBaseIfNeeded(message);
      if (officialRetryPayload) return officialRetryPayload;
      if (response.status === 400 && message.includes('Missing client ID')) {
        throw new Error('本地设备标识缺失，请更新到最新版插件并重启 Obsidian 后再绑定');
      }
      throw new Error(message);
    }
    if (!payload || payload.success === false) {
      const message = (payload && payload.errMsg) || '同步 API 请求失败';
      const officialRetryPayload = await retryWithOfficialApiBaseIfNeeded(message);
      if (officialRetryPayload) return officialRetryPayload;
      if (message.includes('Missing client ID')) {
        throw new Error('本地设备标识缺失，请更新到最新版插件并重启 Obsidian 后再绑定');
      }
      if (message.includes('403') || message.includes('Invalid bind code')) {
        throw new Error('绑定码未绑定或已失效，请在插件设置里粘贴小程序绑定码后点击「立即绑定」');
      }
      throw new Error(message);
    }
    return payload;
  }

  async requestExternalJson(url, { method = 'POST', headers = {}, body = null } = {}) {
    const requestOptions = {
      url,
      method,
      headers,
      body,
    };
    let response;
    try {
      response = await requestUrl(requestOptions);
    } catch (error) {
      const message = error && error.message ? error.message : String(error || '');
      if (!isRequestUrlTransportError(message)) throw error;
      response = await requestJsonViaNode(requestOptions);
    }
    const payload = response.json || (response.text ? tryParseJson(response.text) : null);
    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error((payload && (payload.error && payload.error.message || payload.errMsg)) || `HTTP ${response.status}`);
    }
    return payload || {};
  }

  getFeishuCustomAppConfig({ requireComplete = false } = {}) {
    const appId = String(this.settings.feishuAppId || '').trim();
    const appSecret = String(this.settings.feishuAppSecret || '').trim();
    if (!appId && !appSecret) return null;
    if (!appId || !appSecret) {
      if (requireComplete) {
        throw new Error('请同时填写飞书 App ID 和 App Secret，或清空两项后使用默认飞书连接。');
      }
      return null;
    }
    return { appId, appSecret };
  }

  withFeishuCustomAppConfig(body = {}) {
    const config = this.getFeishuCustomAppConfig({ requireComplete: true });
    return config ? { ...(body || {}), feishuApp: config } : (body || {});
  }

  async fetchFeishuCloudOAuthMarkdownFromUrl(url, binding = null) {
    const payload = await this.requestJson('/feishu/extract', 'POST', this.withFeishuCustomAppConfig({
      url,
    }), binding || undefined);
    const data = payload && payload.data ? payload.data : payload;
    const blocks = Array.isArray(data && data.blocks) ? data.blocks : [];
    if (!blocks.length) {
      throw new Error('Feishu cloud OAuth returned no document blocks');
    }
    return {
      source: 'feishu-cloud-oauth',
      title: String((data && data.title) || '').trim(),
      markdown: extractFeishuMarkdownFromOpenApiBlocks(blocks),
      documentId: String((data && data.documentId) || '').trim(),
      blockCount: Number((data && data.blockCount) || blocks.length) || blocks.length,
      imageTmpDownloadUrls: data && data.imageTmpDownloadUrls && typeof data.imageTmpDownloadUrls === 'object'
        ? data.imageTmpDownloadUrls
        : {},
      imageTokenCount: Number(data && data.imageTokenCount || 0) || 0,
      imageDownloadError: String(data && data.imageDownloadError || '').trim(),
    };
  }

  async connectFeishuCloudOAuth(binding = null) {
    const activeBinding = binding || this.getActiveBindings()[0] || null;
    const payload = await this.requestJson('/feishu/oauth/start', 'POST', this.withFeishuCustomAppConfig({}), activeBinding || undefined);
    const data = payload && payload.data ? payload.data : payload;
    const authUrl = String((data && data.authUrl) || '').trim();
    if (!authUrl) throw new Error('Feishu OAuth did not return authUrl');
    await openExternalUrl(authUrl);
    return data;
  }

  async refreshFeishuCloudOAuthStatus(binding = null) {
    const activeBinding = binding || this.getActiveBindings()[0] || null;
    const payload = await this.requestJson('/feishu/oauth/status', 'GET', {}, activeBinding || undefined);
    const data = payload && payload.data ? payload.data : payload;
    try {
      await this.saveSettings({
        ...this.settings,
        feishuOAuthStatus: data || null,
      });
    } catch (error) {
      this.settings.feishuOAuthStatus = data || null;
    }
    return data || null;
  }

  async getFeishuCloudOAuthStatus(binding = null) {
    if (this.settings.feishuOAuthStatus && this.settings.feishuOAuthStatus.connected) {
      return this.settings.feishuOAuthStatus;
    }
    try {
      return await this.refreshFeishuCloudOAuthStatus(binding);
    } catch (error) {
      return this.settings.feishuOAuthStatus || null;
    }
  }

  async generateMetadataWithCloud(record, binding = null) {
    const inputText = extractAiMetadataInputText(record);
    if (!inputText) return { description: '', keywords: [] };
    const metadata = (record && record.metadata) || {};
    const payload = await this.requestJson('/metadata/generate', 'POST', {
      title: metadata.title || record.title || '',
      source: getRecordSourceLabel(record, metadata),
      content: inputText,
    }, binding || null);
    return normalizeGeneratedMetadataResult(payload && payload.data ? payload.data : payload);
  }

  async generateMetadataWithDeepSeek(record, binding = null) {
    if (!this.settings.deepseekApiKey) {
      return await this.generateMetadataWithCloud(record, binding);
    }
    const inputText = extractAiMetadataInputText(record);
    if (!inputText) return { description: '', keywords: [] };
    const payload = await this.requestExternalJson(this.settings.deepseekBaseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.deepseekApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.settings.deepseekModel || DEFAULT_SETTINGS.deepseekModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是内容整理助手。请基于用户提供的文案生成简介和关键词。只输出 JSON：{"description":"一句话简介","keywords":["关键词1","关键词2"]}。description 控制在 1 句话，keywords 返回 3 到 8 个简洁中文或英文关键词。',
          },
          {
            role: 'user',
            content: inputText,
          },
        ],
      }),
    });
    return parseGeneratedMetadataResponse(extractOpenAICompatibleText(payload) || JSON.stringify(payload || {}));
  }

  async enrichRecordMetadataWithAi(record, binding = null, options = {}) {
    const requireMetadata = Boolean(options.requireMetadata);
    if (!requireMetadata && !shouldGenerateAiMetadata(this.settings, record)) return record;
    const metadata = { ...((record && record.metadata) || {}) };
    const fail = (message) => {
      const finalMessage = message || 'AI 简介与关键词生成失败';
      if (requireMetadata) {
        throw new Error(`AI 简介与关键词生成失败：${finalMessage}`);
      }
      return {
        ...record,
        metadata: {
          ...metadata,
          aiMetadataError: finalMessage,
        },
      };
    };
    const hasAccess = await this.hasProFeatureAccess();
    if (!hasAccess) {
      return fail('Pro 权限未开通，或插件还没有识别到当前绑定码的 Pro 状态。请先绑定小程序并开通 Pro，然后在插件里刷新权限。');
    }
    let generated;
    try {
      generated = await this.generateMetadataWithDeepSeek(record, binding);
    } catch (error) {
      return fail(error && error.message ? error.message : String(error || ''));
    }
    if (generated.description) {
      metadata.description = generated.description;
    }
    if (generated.keywords.length) {
      metadata.keywords = generated.keywords;
    }
    if (generated.description || generated.keywords.length) {
      metadata.aiMetadataSource = this.settings.deepseekApiKey ? 'deepseek' : 'cloud';
    }
    if (requireMetadata && (!metadata.description || !getRecordKeywords(metadata).length)) {
      return fail('AI 接口没有返回可用的简介和关键词。');
    }
    return {
      ...record,
      metadata,
    };
  }

  async testDeepSeekConnection() {
    const result = await this.generateMetadataWithDeepSeek({
      type: 'text',
      content: '这是一段关于 Obsidian 内容同步助手、飞书机器人和知识管理的测试文案。',
      metadata: {
        title: 'AI 连接测试',
      },
    });
    if (!result.description && !result.keywords.length) {
      throw new Error('DeepSeek 已响应，但没有返回可用的简介或关键词');
    }
    return result;
  }

  async bindCurrentCode() {
    if (!this.settings.clientId) {
      await this.saveSettings({
        ...this.settings,
        clientId: createClientId(),
      });
    }

    const tokenToBind = normalizeBindCodeInput(this.settings.pendingBindCode || this.settings.token);
    if (!tokenToBind) {
      new Notice('请填写小程序绑定码');
      return;
    }

    if (!this.settings.apiBase) {
      new Notice('请填写同步 API 地址');
      return;
    }

    const currentBindings = normalizeBindings(this.settings);
    const existing = currentBindings.find((item) => item.token === tokenToBind);
    if (!canAddPluginBinding(this.settings, tokenToBind)) {
      new Notice(`最多绑定 ${MAX_PLUGIN_BINDINGS} 个小程序码`);
      return;
    }

    try {
      await this.requestJson('/bind', 'POST', {
        clientId: this.settings.clientId,
      }, { token: tokenToBind });
      const token = tokenToBind;
      const nextBindings = existing
        ? currentBindings.map((item) => (item.token === token ? {
          ...item,
          enabled: true,
          status: 'bound',
          lastError: '',
          unboundAt: '',
        } : item))
        : [
          ...currentBindings,
          {
            token,
            label: `微信 ${currentBindings.length + 1}`,
            enabled: true,
            status: 'bound',
            boundAt: new Date().toISOString(),
            lastSyncAt: '',
            unboundAt: '',
            lastError: '',
          },
        ];
      await this.saveSettings({
        ...this.settings,
        token: this.settings.token || token,
        pendingBindCode: '',
        bindings: nextBindings,
      });
      new Notice('绑定成功');
      this.refreshProAndMaybePromptLocalComponentInstall({ reason: 'bind', force: true }).catch((error) => {
        new Notice(`Pro 组件检查失败：${error.message || error}`);
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error || '');
      if (
        message.includes('PLUGIN_BINDING_LIMIT_EXCEEDED')
        || message.includes('免费版最多绑定')
        || message.includes('Pro 版最多绑定')
      ) {
        new Notice(message);
        return;
      }
      if (message.includes('409') || message.includes('already bound') || message.includes('already-bound')) {
        new Notice('绑定电脑名额已满，请在小程序绑定页新增电脑名额后再试');
        return;
      }
      if (message.includes('403') || message.includes('Invalid bind code')) {
        new Notice('绑定码无效');
        return;
      }
      new Notice(`绑定失败：${message || '请稍后重试'}`);
    }
  }

  async markBindingUnbound(token, reason = '') {
    const normalizedToken = normalizeBindCodeInput(token);
    if (!normalizedToken) return;
    const nextBindings = normalizeBindings(this.settings)
      .filter((item) => item.token !== normalizedToken);
    const currentEntitlement = this.settings.localTranscriptionEntitlementStatus || null;
    const shouldClearProStatus = !nextBindings.length
      || normalizeBindCodeInput(currentEntitlement && currentEntitlement.bindingToken) === normalizedToken;
    const nextSettings = {
      ...this.settings,
      token: getPrimaryBoundToken(nextBindings),
      bindings: nextBindings,
    };
    if (shouldClearProStatus) {
      nextSettings.pendingRedeemCode = '';
      nextSettings.localTranscriptionEntitlementStatus = nextBindings.length
        ? null
        : {
          hasAccess: false,
          plan: LOCAL_TRANSCRIPTION_PLAN,
          status: 'unbound',
          expiresAt: '',
        };
    }
    await this.saveSettings(nextSettings);
  }

  async downloadArrayBuffer(url, headers = {}, options = {}) {
    if (options.signal || typeof options.onProgress === 'function') {
      return downloadArrayBufferViaNode(url, headers, options);
    }
    const response = await requestUrl({ url, method: 'GET', headers });
    if (!response.arrayBuffer) {
      throw new Error('录音文件下载失败');
    }
    return response.arrayBuffer;
  }

  async buildXiaohongshuOcrImagePayload(imageUrls = []) {
    const items = [];
    const selected = (Array.isArray(imageUrls) ? imageUrls : [])
      .filter(Boolean)
      .slice(0, XIAOHONGSHU_OCR_MAX_IMAGES);
    for (let index = 0; index < selected.length; index += 1) {
      const imageUrl = selected[index];
      try {
        // eslint-disable-next-line no-await-in-loop
        const headers = await getXiaohongshuRequestHeaders(imageUrl);
        // eslint-disable-next-line no-await-in-loop
        const arrayBuffer = await this.downloadArrayBuffer(imageUrl, headers);
        const buffer = Buffer.from(arrayBuffer);
        if (!buffer.length || buffer.length > XIAOHONGSHU_OCR_MAX_IMAGE_BYTES) continue;
        items.push({
          imageUrl,
          imageBase64: buffer.toString('base64'),
          index: index + 1,
        });
      } catch (error) {
        // Keep OCR best-effort; normal Xiaohongshu extraction must not fail.
      }
    }
    return items;
  }

  async requestXiaohongshuImageOcr(imageUrls = [], {
    pageUrl = '',
    title = '',
    binding = null,
  } = {}) {
    await this.ensureLocalComponentReadyForUse('小红书图片 OCR', {
      reason: 'first-use',
      requireAsr: false,
      requireOcr: true,
    });
    const images = await this.buildXiaohongshuOcrImagePayload(imageUrls);
    if (!images.length) return [];
    const ocrTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-ocr-'));
    const items = [];
    try {
      for (const image of images) {
        const ext = getImageFileExtension(image.imageUrl);
        const tempImagePath = path.join(ocrTempDir, `image-${image.index || items.length + 1}.${ext}`);
        fs.writeFileSync(tempImagePath, Buffer.from(image.imageBase64 || '', 'base64'));
        // eslint-disable-next-line no-await-in-loop
        const text = await this.runLocalImageOcr(tempImagePath);
        items.push({
          imageUrl: image.imageUrl,
          index: image.index,
          text,
        });
      }
    } finally {
      try {
        fs.rmSync(ocrTempDir, { recursive: true, force: true });
      } catch (error) {
        // Best-effort cleanup only.
      }
    }
    return normalizeXiaohongshuOcrItems(items);
  }

  async enrichXiaohongshuExtractionWithOcr(extracted, {
    pageUrl = '',
    binding = null,
  } = {}) {
    if (!extracted || !Array.isArray(extracted.imageUrls) || !extracted.imageUrls.length) return extracted;
    let items = [];
    try {
      items = await this.requestXiaohongshuImageOcr(extracted.imageUrls, {
        pageUrl,
        title: extracted.title || '',
        binding,
      });
    } catch (error) {
      return {
        ...extracted,
        ocrError: error.message || String(error),
      };
    }
    if (!items.length) return extracted;
    return {
      ...extracted,
      markdown: appendXiaohongshuOcrMarkdown(extracted.markdown, items),
      ocrItems: items,
      ocrTextHeavy: isLikelyImageTextNote(items),
    };
  }

  showSyncProgress(progress = {}) {
    const message = buildSyncProgressMessage(progress);
    if (!message) return;
    this.lastSyncDiagnostic = {
      ...progress,
      message,
      status: progress.stage === 'empty' ? 'empty' : 'running',
      time: new Date().toISOString(),
    };
    writeSyncDiagnosticLog(this.lastSyncDiagnostic);
    if (this.syncStatusBar && typeof this.syncStatusBar.setText === 'function') {
      this.syncStatusBar.setText(message);
    }
    if (!this.syncProgressNotice) {
      this.syncProgressNotice = new Notice(message, 0);
      return;
    }
    if (typeof this.syncProgressNotice.setMessage === 'function') {
      this.syncProgressNotice.setMessage(message);
      return;
    }
    new Notice(message, 2500);
  }

  clearSyncProgressNotice() {
    if (this.syncProgressNotice && typeof this.syncProgressNotice.hide === 'function') {
      this.syncProgressNotice.hide();
    }
    this.syncProgressNotice = null;
    if (this.syncStatusBar && typeof this.syncStatusBar.setText === 'function') {
      this.syncStatusBar.setText('');
    }
  }

  stopCurrentTranscription() {
    let stopped = false;
    if (this.currentTranscriptionAbortController) {
      this.currentTranscriptionAbortController.abort();
      stopped = true;
    }
    if (this.currentTranscriptionProcess && !this.currentTranscriptionProcess.killed) {
      try {
        this.currentTranscriptionProcess.kill();
        stopped = true;
      } catch (error) {
        // Ignore process cleanup failures.
      }
    }
    new Notice(stopped ? '已停止当前转写，会继续处理后面的同步内容。' : '当前没有正在转写的任务。');
    return stopped;
  }

  async unbindBinding(token) {
    const normalizedToken = normalizeBindCodeInput(token);
    if (!normalizedToken) {
      new Notice('未找到绑定码');
      return;
    }

    try {
      await this.requestJson('/unbind-self', 'POST', {
        clientId: this.settings.clientId,
      }, { token: normalizedToken });
      await this.markBindingUnbound(normalizedToken, '用户已主动解除本机绑定');
      new Notice('已解除当前电脑绑定');
    } catch (error) {
      const message = error && error.message ? error.message : String(error || '');
      new Notice(`解除绑定失败：${message || error}`);
    }
  }

  async requestFileDownloadUrl(fileID, binding = null) {
    const payload = await this.requestJson(`/files/download-url?fileID=${encodeURIComponent(fileID)}`, 'GET', {}, binding);
    if (!payload.data || !payload.data.tempFileURL) {
      throw new Error('未获取到录音下载地址');
    }
    return payload.data.tempFileURL;
  }

  async requestAudioDownloadUrl(fileID, binding = null) {
    return this.requestFileDownloadUrl(fileID, binding);
  }

  async postTencent(action, body) {
    const request = buildTencentRequest({
      action,
      region: this.settings.tencentRegion,
      secretId: this.settings.tencentSecretId,
      secretKey: this.settings.tencentSecretKey,
      body,
    });
    const { Host, ...headers } = request.headers;
    const response = await requestUrl({
      url: request.url,
      method: 'POST',
      headers,
      body: request.body,
    });

    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(`腾讯云请求失败：HTTP ${response.status} ${String(response.text || '').slice(0, 180)}`);
    }

    const payload = response.json || JSON.parse(response.text || '{}');
    const error = payload && payload.Response && payload.Response.Error;
    if (error) {
      throw new Error(`${error.Code}: ${error.Message}`);
    }
    return payload;
  }

  getEffectiveLocalTranscriptionCommand() {
    const configured = String(this.settings.localTranscriptionCommand || '').trim();
    if (configured) return configured;
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    return fs.existsSync(getDefaultLocalTranscriptionScriptPath(platform, installRoot))
      ? getDefaultLocalTranscriptionCommand(platform, installRoot)
      : '';
  }

  canRunLocalTranscription() {
    return Boolean(this.getEffectiveLocalTranscriptionCommand());
  }

  getPluginBaseDir() {
    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    if (adapter && adapter.basePath) {
      const dir = (this.manifest && this.manifest.dir) || '.obsidian/plugins/wechat-inbox-sync';
      return path.join(adapter.basePath, dir);
    }
    return __dirname;
  }

  getConfiguredLocalAsrPlatform() {
    return resolveLocalAsrPlatform(this.settings.localAsrPlatform);
  }

  getConfiguredLocalAsrInstallRoot(mode = this.settings.localAsrInstallMode) {
    const platform = this.getConfiguredLocalAsrPlatform();
    const commandRoot = extractLocalAsrInstallRootFromCommand(this.settings.localTranscriptionCommand, platform);
    if (commandRoot && normalizeLocalAsrInstallMode(mode) === normalizeLocalAsrInstallMode(this.settings.localAsrInstallMode)) {
      const status = getLocalAsrInstallStatus(commandRoot, fs.existsSync, platform);
      if (status.ready) return commandRoot;
    }
    return getLocalAsrInstallRoot(os.homedir(), mode, platform);
  }

  getBundledLocalAsrInstallerPath() {
    const fileName = this.getConfiguredLocalAsrPlatform() === 'darwin' ? 'install-local-asr-macos.sh' : 'install-local-asr.ps1';
    return path.join(this.getPluginBaseDir(), 'local-asr', fileName);
  }

  getConfiguredLocalOcrInstallRoot() {
    return getLocalOcrInstallRoot(os.homedir(), this.getConfiguredLocalAsrPlatform());
  }

  getBundledLocalOcrInstallerPath() {
    const fileName = this.getConfiguredLocalAsrPlatform() === 'darwin' ? 'install-local-ocr-macos.sh' : 'install-local-ocr.ps1';
    return path.join(this.getPluginBaseDir(), 'local-ocr', fileName);
  }

  copyBundledLocalOcrRuntimeAssets(installerPath) {
    if (!installerPath) return;
    const sourcePath = path.join(this.getPluginBaseDir(), 'local-ocr', 'ocr_image.py');
    const targetPath = path.join(path.dirname(installerPath), 'ocr_image.py');
    try {
      if (!fs.existsSync(sourcePath)) return;
      if (path.resolve(sourcePath) === path.resolve(targetPath)) return;
      fs.copyFileSync(sourcePath, targetPath);
    } catch (error) {
      console.warn('Failed to copy bundled OCR runtime asset:', error);
    }
  }

  getLocalOcrInstallStatus() {
    return getLocalOcrInstallStatus(
      this.getConfiguredLocalOcrInstallRoot(),
      fs.existsSync,
      this.getConfiguredLocalAsrPlatform(),
    );
  }

  async installLocalOcr() {
    if (this.localOcrInstallPromise) {
      new Notice('本地转写组件的图片文字识别模块正在安装中，请等待当前安装完成后再重试。');
      return await this.localOcrInstallPromise;
    }
    this.localOcrInstallPromise = this.doInstallLocalOcr();
    try {
      return await this.localOcrInstallPromise;
    } finally {
      this.localOcrInstallPromise = null;
    }
  }

  async doInstallLocalOcr() {
    await this.ensureProFeatureAccess('本地转写组件安装');
    const installerPath = await this.getAvailableLocalOcrInstallerPath();
    if (!fs.existsSync(installerPath)) {
      throw new Error(`本地转写组件的图片文字识别安装器不存在：${installerPath}`);
    }
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = this.getConfiguredLocalOcrInstallRoot();
    const command = buildLocalOcrInstallCommand(installerPath, platform, platform === 'win32' ? installRoot : '');
    new Notice('开始安装本地转写组件的图片文字识别模块，可能需要几分钟。');
    const installResult = await new Promise((resolve, reject) => {
      childProcess.exec(command, {
        timeout: LOCAL_OCR_INSTALL_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed || error.signal === 'SIGTERM' || /timed out|timeout/i.test(error.message || '');
          const errorText = timedOut
            ? '本地转写组件安装超时：图片文字识别模块安装超过 10 分钟仍未完成。通常是 Python 或依赖下载源访问过慢，安装已中止。'
            : (stderr || stdout || error.message || String(error));
          writeLocalAsrInstallLog({
            installRoot,
            platform,
            installerPath,
            command,
            stdout,
            stderr,
            error: errorText,
            status: 'failed',
          });
          reject(new Error(errorText));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
    const status = this.getLocalOcrInstallStatus();
    if (!status.ready) {
      const missingText = status.missingReasons && status.missingReasons.length
        ? status.missingReasons.join('；')
        : '图片文字识别模块不完整';
      writeLocalAsrInstallLog({
        installRoot,
        platform,
        installerPath,
        command,
        stdout: installResult && installResult.stdout,
        stderr: installResult && installResult.stderr,
        error: missingText,
        status: 'failed',
      });
      throw new Error(`本地转写组件安装不完整：${missingText}`);
    }
    new Notice('本地转写组件的图片文字识别模块已安装。');
  }

  async getAvailableLocalOcrInstallerPath() {
    const installerPath = this.getBundledLocalOcrInstallerPath();
    const isMac = this.getConfiguredLocalAsrPlatform() === 'darwin';
    const installerUrl = isMac ? LOCAL_OCR_MACOS_INSTALLER_URL : LOCAL_OCR_INSTALLER_URL;
    const downloadedPath = path.join(os.tmpdir(), `wechat-inbox-local-ocr-installer-${Date.now()}${isMac ? '.sh' : '.ps1'}`);

    const isInstallerCurrent = (scriptText) => {
      const source = String(scriptText || '');
      if (!source.includes('.wechat-inbox-local-ocr')) return false;
      if (!source.includes('rapidocr')) return false;
      if (isMac) {
        return source.includes('TENCENT_OCR_ASSET_BASE_URL')
          && source.includes('TENCENT_PIP_INDEX_URL')
          && source.includes('download_with_retry')
          && source.includes('find_existing_python')
          && source.includes('detect_uv_arch')
          && source.includes('UV_PYTHON_DOWNLOADS=automatic')
          && source.includes('UV_PYTHON_PREFERENCE=managed')
          && source.includes('.wechat-inbox-local-asr/python-venv/bin/python')
          && source.includes('"$UV_BIN" python install 3.12')
          && source.includes('"$UV_BIN" venv "$VENV_DIR" --python 3.12 --managed-python');
      }
      return source.includes('$TencentOcrAssetBaseUrl')
        && source.includes('$TencentPipIndexUrl')
        && source.includes('Download-TextFile')
        && source.includes('Install-Uv')
        && source.includes('uv-x86_64-pc-windows-msvc.zip')
        && source.includes('$env:UV_PYTHON_DOWNLOADS')
        && source.includes('$env:UV_PYTHON_PREFERENCE')
        && source.includes('& $UvExe python install 3.12')
        && source.includes('& $UvExe venv $VenvDir --python 3.12');
    };

    try {
      let scriptText = '';
      try {
        const response = await requestUrl({ url: `${installerUrl}?t=${Date.now()}`, method: 'GET' });
        scriptText = response.text || '';
      } catch (error) {
        scriptText = await downloadTextViaNode(`${installerUrl}?t=${Date.now()}`);
      }
      if (!isInstallerCurrent(scriptText)) {
        throw new Error('Local OCR installer download returned outdated or invalid content');
      }
      fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(scriptText, isMac), 'utf8');
      this.copyBundledLocalOcrRuntimeAssets(downloadedPath);
      return downloadedPath;
    } catch (downloadError) {
      if (fs.existsSync(installerPath)) {
        const bundledScriptText = fs.readFileSync(installerPath, 'utf8');
        if (isInstallerCurrent(bundledScriptText)) {
          if (isMac) {
            fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(bundledScriptText, isMac), 'utf8');
            this.copyBundledLocalOcrRuntimeAssets(downloadedPath);
            return downloadedPath;
          }
          return installerPath;
        }
      }
      throw new Error(`无法下载本地转写 OCR 安装器：${downloadError.message || downloadError}`);
    }
  }

  async runLocalImageOcr(imagePath) {
    const status = this.getLocalOcrInstallStatus();
    if (!status.ready) {
      const missingText = status.missingReasons && status.missingReasons.length
        ? status.missingReasons.join('；')
        : '图片文字识别模块未安装';
      throw new Error(`${missingText}。请在插件设置的 Pro 高级功能里修复本地转写组件。`);
    }
    const outputPath = path.join(os.tmpdir(), `wechat-inbox-ocr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
    try {
      await new Promise((resolve, reject) => {
        childProcess.execFile(status.pythonPath, [
          status.scriptPath,
          '--input',
          imagePath,
          '--output',
          outputPath,
        ], {
          timeout: LOCAL_OCR_RUN_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || stdout || error.message || String(error)));
            return;
          }
          resolve({ stdout, stderr });
        });
      });
      return fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8').trim() : '';
    } finally {
      try {
        fs.rmSync(outputPath, { force: true });
      } catch (error) {
        // Best-effort cleanup only.
      }
    }
  }

  async getAvailableLocalAsrInstallerPath() {
    const installerPath = this.getBundledLocalAsrInstallerPath();
    const isMac = this.getConfiguredLocalAsrPlatform() === 'darwin';
    const installerUrl = isMac ? LOCAL_ASR_MACOS_INSTALLER_URL : LOCAL_ASR_INSTALLER_URL;
    const downloadedPath = path.join(os.tmpdir(), `wechat-inbox-local-asr-installer-${Date.now()}${isMac ? '.sh' : '.ps1'}`);

    const isInstallerCurrent = (scriptText) => {
      const source = String(scriptText || '');
      if (!source.includes('.wechat-inbox-local-asr')) return false;
      if (isMac) {
        return source.includes('CHUNK_SECONDS=120')
          && source.includes('choose_chunk_seconds')
          && source.includes('find_metal_resources_dir')
          && source.includes('GGML_METAL_PATH_RESOURCES')
          && source.includes('metalAcceleration=failed')
          && source.includes('transcribe-last.log')
          && source.includes('validate_local_asr_inference')
          && source.includes('TENCENT_MODEL_URL=')
          && source.includes('bootstrap_uv')
          && source.includes('detect_uv_arch')
          && source.includes('setup_python_and_packages')
          && source.includes('UV_PYTHON_DOWNLOADS=automatic')
          && source.includes('UV_PYTHON_PREFERENCE=managed')
          && source.includes('"$UV_BIN" python install 3.12')
          && source.includes('"$UV_BIN" venv "$VENV_DIR" --python 3.12 --managed-python');
      }
      return source.includes('Invoke-NativeProcess')
        && source.includes('Convert-ExitCodeToHex')
        && source.includes('$hex = Convert-ExitCodeToHex -ExitCode $ExitCode')
        && source.includes('[string]$InstallRoot')
        && source.includes('Install-ExtractedPackage')
        && !source.includes('Move-Item -LiteralPath $FfmpegStageDir -Destination $FfmpegDir')
        && source.includes('safeModelPath')
        && source.includes('$TencentCosAssetBaseUrl')
        && source.includes('$WhisperWindowsTencentUrls')
        && source.includes('$FfmpegTencentUrls')
        && source.includes('$ModelTencentUrls')
        && source.includes('Get-EnabledAssetUrls')
        && source.includes('$WhisperWindowsFallbackUrls')
        && source.includes('GitHub release page parsing failed')
        && source.includes('INSTALLER FAILED')
        && source.includes('$DownloadTimeoutSeconds = 1200')
        && source.includes('--max-time $DownloadTimeoutSeconds')
        && source.includes('System.Text.UTF8Encoding')
        && source.includes('ReadAllText($chunkTxt, $Utf8NoBom)')
        && source.includes('WriteAllText($OutputPath');
    };

    try {
      let scriptText = '';
      try {
        const response = await requestUrl({ url: `${installerUrl}?t=${Date.now()}`, method: 'GET' });
        scriptText = response.text || '';
      } catch (error) {
        scriptText = await downloadTextViaNode(`${installerUrl}?t=${Date.now()}`);
      }
      if (!isInstallerCurrent(scriptText)) {
        throw new Error('Local ASR installer download returned outdated or invalid content');
      }
      fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(scriptText, isMac), 'utf8');
      return downloadedPath;
    } catch (downloadError) {
      if (fs.existsSync(installerPath)) {
        const bundledScriptText = fs.readFileSync(installerPath, 'utf8');
        if (isInstallerCurrent(bundledScriptText)) {
          if (isMac) {
            fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(bundledScriptText, isMac), 'utf8');
            return downloadedPath;
          }
          return installerPath;
        }
      }
      throw new Error(`无法下载最新本地转写安装器：${downloadError.message || downloadError}`);
    }
  }

  getLocalAsrInstallStatus() {
    return getLocalAsrInstallStatus(this.getConfiguredLocalAsrInstallRoot(), fs.existsSync, this.getConfiguredLocalAsrPlatform());
  }

  getLocalAsrDiagnosticText() {
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    const status = getLocalAsrInstallStatus(installRoot, fs.existsSync, platform);
    const logText = readLocalAsrInstallLog(installRoot);
    const runLogText = readLocalAsrRunLog(installRoot);
    const syncLogText = readSyncDiagnosticLog(installRoot);
    const lastSyncText = this.lastSyncDiagnostic ? JSON.stringify(this.lastSyncDiagnostic, null, 2) : '';
    const diagnosticText = [
      'WeChat Inbox Sync 同步/安装失败诊断',
      `插件版本：${this.manifest && this.manifest.version ? this.manifest.version : 'unknown'}`,
      `运行系统：${os.platform()} ${os.arch()} ${os.release()}`,
      `手动选择系统：${this.settings.localAsrPlatform || 'auto'}`,
      `实际使用系统：${platform}`,
      `API 地址：${this.settings.apiBase || '-'}`,
      `安装目录：${status.installRoot}`,
      `转写脚本：${status.transcribeScript}`,
      `脚本存在：${status.hasTranscribeScript ? '是' : '否'}`,
      `脚本版本：${status.scriptOutdated ? '过旧，请重新安装本地转写组件' : status.scriptVersion}`,
      `脚本过旧：${status.scriptOutdated ? '是' : '否'}`,
      `whisper：${status.hasWhisper ? '是' : '否'}`,
      `whisper 路径：${status.whisperPath || '未找到'}`,
      `ffmpeg：${status.hasFfmpeg ? '是' : '否'}`,
      `ffmpeg 路径：${status.ffmpegPath || '未找到'}`,
      `模型文件：${status.hasModel ? '是' : '否'}`,
      `模型路径：${status.modelPath}`,
      `组件可用：${status.ready ? '是' : '否'}`,
      `缺失项：${status.missingReasons && status.missingReasons.length ? status.missingReasons.join('；') : '无'}`,
      `绑定码：${this.getActiveBindings().map((item) => `${item.label || ''}:[REDACTED]`).join(', ') || '-'}`,
      `权限缓存：${JSON.stringify(redactSensitiveObject(this.settings.localTranscriptionEntitlementStatus || {}))}`,
      '最近同步状态：',
      lastSyncText || syncLogText || '暂无 sync-last.log',
      '最近转写日志：',
      runLogText || '暂无 transcribe-last.log',
      '最近安装日志：',
      logText || '暂无 install.log',
    ].join('\n');
    return redactKnownCredentials(diagnosticText, this.settings);
  }

  getSyncDiagnosticText() {
    const platform = this.getConfiguredLocalAsrPlatform();
    const asrRoot = this.getConfiguredLocalAsrInstallRoot();
    const ocrRoot = this.getConfiguredLocalOcrInstallRoot();
    const asrStatus = typeof this.getLocalAsrInstallStatus === 'function'
      ? this.getLocalAsrInstallStatus()
      : getLocalAsrInstallStatus(asrRoot, fs.existsSync, platform);
    const ocrStatus = typeof this.getLocalOcrInstallStatus === 'function'
      ? this.getLocalOcrInstallStatus()
      : getLocalOcrInstallStatus(ocrRoot, fs.existsSync, platform);
    const asrInstallLog = readLocalAsrInstallLog(asrRoot);
    const asrRunLog = readLocalAsrRunLog(asrRoot);
    const ocrInstallLog = readLocalAsrInstallLog(ocrRoot);
    const syncLogText = readSyncDiagnosticLog(asrRoot);
    const lastSyncText = this.lastSyncDiagnostic ? JSON.stringify(this.lastSyncDiagnostic, null, 2) : syncLogText;
    const hasFailureSignal = (text) => /status\s*=\s*failed|failed|failure|error|exception|traceback|curl:\s*\(\d+\)|connection reset|timed out|timeout|not found|permission denied|denied|未找到|失败|错误|异常|超时|缺失|不完整/i.test(String(text || ''));
    const hasAsrRunFailureSignal = (text) => {
      const source = String(text || '');
      const errorSectionMatch = source.match(/--- error ---\s*([\s\S]*)$/i);
      const explicitError = errorSectionMatch ? errorSectionMatch[1].trim() : '';
      return Boolean(explicitError)
        || /status\s*=\s*failed|whisper failed|ffmpeg failed|failed with exit code|command failed|runtimeexception|fullyqualifiederrorid|operationstopped|traceback|enoent|permission denied|timed out|timeout/i.test(source);
    };
    const tailLog = (text, maxLines = 50) => String(text || '')
      .split(/\r?\n/)
      .slice(-maxLines)
      .join('\n')
      .trim();
    const appendFailedLog = (lines, title, text, detector = hasFailureSignal) => {
      const source = String(text || '').trim();
      if (!source || !detector(source)) return false;
      lines.push(title, tailLog(source));
      return true;
    };
    const formatMissingReasons = (status) => (
      status && Array.isArray(status.missingReasons) && status.missingReasons.length
        ? status.missingReasons.join('；')
        : '无'
    );
    const lines = [
      'WeChat Inbox Sync 同步/安装失败诊断',
      `插件版本：${this.manifest && this.manifest.version ? this.manifest.version : 'unknown'}`,
      `运行系统：${os.platform()} ${os.arch()} ${os.release()}`,
      `手动选择系统：${this.settings.localAsrPlatform || 'auto'}`,
      `实际使用系统：${platform}`,
      `API 地址：${this.settings.apiBase || '-'}`,
      `绑定码：${this.getActiveBindings().map((item) => `${item.label || ''}:[REDACTED]`).join(', ') || '-'}`,
      `权限缓存：${JSON.stringify(redactSensitiveObject(this.settings.localTranscriptionEntitlementStatus || {}))}`,
      '',
      '组件状态：',
      `音视频转写 ASR：${asrStatus.ready ? '可用' : '不可用'}`,
      `ASR 安装目录：${asrStatus.installRoot || asrRoot}`,
      `ASR 缺失项：${formatMissingReasons(asrStatus)}`,
      `图片文字识别 OCR：${ocrStatus.ready ? '可用' : '不可用'}`,
      `OCR 安装目录：${ocrStatus.installRoot || ocrRoot}`,
      `OCR 安装日志：${getLocalAsrInstallLogPath(ocrRoot)}`,
      `OCR 缺失项：${formatMissingReasons(ocrStatus)}`,
    ];

    if (lastSyncText && hasFailureSignal(lastSyncText)) {
      lines.push('', '最近同步失败状态：', lastSyncText);
    }
    if (!asrStatus.ready) {
      appendFailedLog(lines, 'ASR 最近安装失败日志：', asrInstallLog);
      appendFailedLog(lines, 'ASR 最近转写失败日志：', asrRunLog, hasAsrRunFailureSignal);
    } else {
      appendFailedLog(lines, 'ASR 最近转写失败日志：', asrRunLog, hasAsrRunFailureSignal);
    }
    if (!ocrStatus.ready) {
      const appendedOcrLog = appendFailedLog(lines, 'OCR 最近安装失败日志：', ocrInstallLog);
      if (ocrStatus.hasPython && !ocrStatus.hasScript) {
        lines.push('', 'OCR 修复建议：Python 环境已安装，仅 OCR 脚本缺失；重新安装会复用现有环境并补齐脚本。');
      }
      if (!appendedOcrLog) {
        lines.push('', 'OCR 安装日志未找到或没有记录失败信息；请重新安装/修复本地转写组件以生成新的分阶段日志。');
      }
    }
    if (!lines.some((line) => /失败日志|失败状态/.test(line))) {
      lines.push('', '未检测到失败日志；已省略成功日志。');
    } else {
      lines.push('', '已省略成功日志，只保留失败相关信息。');
    }
    return redactKnownCredentials(lines.join('\n'), this.settings);
  }

  async copyTextToClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    try {
      const electron = require('electron');
      if (electron && electron.clipboard && electron.clipboard.writeText) {
        electron.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // Obsidian mobile/electron variants may not expose electron here.
    }
    return false;
  }

  async copyDiagnosticText(text, fileName = 'diagnostic.txt') {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    try {
      const electron = require('electron');
      if (electron && electron.clipboard && electron.clipboard.writeText) {
        electron.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // Obsidian mobile/electron variants may not expose electron here.
    }
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    const diagnosticPath = path.join(installRoot, fileName);
    fs.mkdirSync(installRoot, { recursive: true });
    fs.writeFileSync(diagnosticPath, text, 'utf8');
    new Notice(`诊断信息已写入：${diagnosticPath}`);
    return false;
  }

  async copyLocalAsrDiagnosticText() {
    return this.copyDiagnosticText(this.getLocalAsrDiagnosticText(), 'local-asr-diagnostic.txt');
  }

  async copySyncDiagnosticText() {
    return this.copyDiagnosticText(this.getSyncDiagnosticText(), 'sync-diagnostic.txt');
  }

  async getLocalTranscriptionEntitlementStatus() {
    const bindings = this.getActiveBindings();
    if (!bindings.length) {
      const unboundStatus = {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: 'unbound',
        expiresAt: '',
      };
      await this.cacheLocalTranscriptionEntitlementStatus(unboundStatus);
      return unboundStatus;
    }

    const plans = [LOCAL_TRANSCRIPTION_PLAN, ...LOCAL_TRANSCRIPTION_FALLBACK_PLANS];
    let lastError = null;
    for (const binding of bindings) {
      for (const plan of plans) {
        try {
          const payload = await this.requestJson(`/entitlements/status?plan=${encodeURIComponent(plan)}`, 'GET', {}, binding);
          const data = payload && payload.data ? payload.data : {};
          if (data.hasAccess) {
            const activeStatus = {
              hasAccess: true,
              plan: data.plan || plan,
              status: data.status || 'active',
              expiresAt: data.expiresAt || '',
              code: normalizeBindCodeInput(data.code || data.redeemCode || ''),
              bindingToken: binding.token,
              bindingLabel: binding.label || '',
            };
            await this.cacheLocalTranscriptionEntitlementStatus(activeStatus);
            if (activeStatus.code && this.settings.pendingRedeemCode !== activeStatus.code) {
              await this.saveSettings({
                ...this.settings,
                pendingRedeemCode: activeStatus.code,
              });
            }
            return activeStatus;
          }
          lastError = data;
        } catch (error) {
          lastError = error;
        }
      }
    }

    const inactiveStatus = {
      hasAccess: false,
      plan: LOCAL_TRANSCRIPTION_PLAN,
      status: (lastError && lastError.status) || 'inactive',
      expiresAt: (lastError && lastError.expiresAt) || '',
    };
    await this.cacheLocalTranscriptionEntitlementStatus(inactiveStatus);
    return inactiveStatus;
  }

  async getProFeatureAccessStatus(options = {}) {
    const code = normalizeBindCodeInput(this.settings.pendingRedeemCode);
    const cached = this.settings && this.settings.localTranscriptionEntitlementStatus;
    if (!options.forceRefresh && isCachedProStatusActive(cached)) return cached;
    const bindingStatus = await this.getLocalTranscriptionEntitlementStatus();
    if (isCachedProStatusActive(bindingStatus)) return bindingStatus;
    if (code) {
      return await this.validateProRedeemCodeAccess(code);
    }
    return bindingStatus || buildMissingRedeemCodeStatus();
  }

  async hasProFeatureAccess() {
    const cached = this.settings && this.settings.localTranscriptionEntitlementStatus;
    if (isCachedProStatusActive(cached)) return true;
    try {
      const status = await this.getProFeatureAccessStatus();
      return isCachedProStatusActive(status);
    } catch (error) {
      return false;
    }
  }

  async ensureProFeatureAccess(featureName = '该功能') {
    let status = await this.getProFeatureAccessStatus();
    if (isCachedProStatusActive(status)) return status;
    const expiresAt = status && status.expiresAt ? new Date(status.expiresAt).getTime() : 0;
    if (status && status.hasAccess && expiresAt && expiresAt <= Date.now()) {
      status = { ...status, hasAccess: false, status: 'expired' };
    }
    if (status.status === 'missing_redeem_code') {
      throw new Error(`${featureName}需要有效 Pro。请先绑定小程序并开通 Pro。`);
    }
    if (status.status === 'unbound') {
      throw new Error(`${featureName}需要有效 Pro。请先绑定小程序绑定码。`);
    }
    if (status.status === 'expired') {
      throw new Error(`${featureName}需要有效 Pro，当前权限已过期。`);
    }
    throw new Error(`${featureName}需要有效 Pro，${status.message || '请先在小程序开通 Pro 后刷新权限。'}`);
  }

  async validateProRedeemCodeAccess(code, options = {}) {
    const normalizedCode = normalizeBindCodeInput(code);
    if (!normalizedCode) {
      const missingStatus = buildMissingRedeemCodeStatus();
      await this.cacheLocalTranscriptionEntitlementStatus(missingStatus);
      if (options.throwOnError) throw new Error('请先输入兑换码。');
      return missingStatus;
    }
    const bindings = this.getActiveBindings();
    if (!bindings.length) {
      const unboundStatus = {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: 'unbound',
        expiresAt: '',
        code: normalizedCode,
        message: '请先绑定小程序绑定码，再输入兑换码。',
      };
      await this.cacheLocalTranscriptionEntitlementStatus(unboundStatus);
      if (options.throwOnError) throw new Error(unboundStatus.message);
      return unboundStatus;
    }
    const binding = bindings[0];
    try {
      const payload = await this.requestJson('/entitlements/redeem', 'POST', { code: normalizedCode }, binding);
      const status = payload && payload.data ? payload.data : payload;
      const activeStatus = {
        ...status,
        hasAccess: Boolean(status && status.hasAccess),
        code: normalizeBindCodeInput((status && status.code) || normalizedCode),
        bindingToken: binding.token,
        bindingLabel: binding.label || '',
      };
      await this.cacheLocalTranscriptionEntitlementStatus(activeStatus);
      if (activeStatus.code && this.settings.pendingRedeemCode !== activeStatus.code) {
        await this.saveSettings({
          ...this.settings,
          pendingRedeemCode: activeStatus.code,
        });
      }
      if (!activeStatus.hasAccess && options.throwOnError) {
        throw new Error(formatRedeemAccessError(new Error(activeStatus.message || ''), 'redeem'));
      }
      return activeStatus;
    } catch (error) {
      const message = formatRedeemAccessError(error, options.mode || 'redeem');
      const inactiveStatus = {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: /过期/.test(message) ? 'expired' : 'invalid_redeem_code',
        expiresAt: '',
        code: normalizedCode,
        message,
        bindingToken: binding.token,
        bindingLabel: binding.label || '',
      };
      await this.cacheLocalTranscriptionEntitlementStatus(inactiveStatus);
      if (options.throwOnError) throw new Error(message);
      return inactiveStatus;
    }
  }

  async redeemProCode() {
    const code = normalizeBindCodeInput(this.settings.pendingRedeemCode);
    if (!code) {
      new Notice('请填写兑换码');
      return null;
    }
    try {
      const status = await this.validateProRedeemCodeAccess(code, { throwOnError: true, mode: 'redeem' });
      new Notice(status && status.expiresAt
        ? `Pro 权限已开通，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}`
        : 'Pro 权限已开通');
      return status;
    } catch (error) {
      new Notice(`兑换失败：${formatRedeemAccessError(error, 'redeem')}`);
      return null;
    }
  }

  async autoRedeemProCode(options = {}) {
    const bindings = this.getActiveBindings();
    if (!bindings.length) {
      if (!options.silent) new Notice('请先绑定小程序绑定码，再自动识别兑换码。');
      return null;
    }
    let lastError = null;
    for (const binding of bindings) {
      try {
        const payload = await this.requestJson('/entitlements/auto-redeem', 'POST', {}, binding);
        const status = payload && payload.data ? payload.data : payload;
        if (status && status.hasAccess) {
          const cachedStatus = {
            ...status,
            code: normalizeBindCodeInput(status.code || ''),
            bindingToken: binding.token,
            bindingLabel: binding.label || '',
          };
          if (!cachedStatus.code) {
            lastError = new Error('没有识别到可用兑换码');
            continue;
          }
          await this.cacheLocalTranscriptionEntitlementStatus(cachedStatus);
          await this.saveSettings({
            ...this.settings,
            pendingRedeemCode: cachedStatus.code,
          });
          if (!options.silent) {
            new Notice(status.autoRedeemed
              ? `已自动识别并开通 Pro，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}`
              : `Pro 权限有效${status.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : ''}`);
          }
          return cachedStatus;
        }
        lastError = status;
      } catch (error) {
        lastError = error;
      }
    }
    if (!options.silent) {
      new Notice(`自动识别兑换码失败：${formatRedeemAccessError(lastError, 'auto')}`);
    }
    return null;
  }

  getLocalTranscriptionComponentReadiness() {
    const asrStatus = this.getLocalAsrInstallStatus();
    const ocrStatus = this.getLocalOcrInstallStatus();
    const platform = this.getConfiguredLocalAsrPlatform();
    const missingComponents = [];
    if (!asrStatus.ready) missingComponents.push('音视频转写');
    if (!ocrStatus.ready) missingComponents.push('图片文字识别 OCR');
    return {
      ready: missingComponents.length === 0,
      platform,
      platformName: LOCAL_ASR_PLATFORM_NAMES[platform] || platform,
      missingComponents,
      asrStatus,
      ocrStatus,
    };
  }

  async refreshProAndMaybePromptLocalComponentInstall(options = {}) {
    const reason = options.reason || 'settings-open';
    const now = Date.now();
    const lastCheckedAt = Date.parse(this.settings.proSetupLastCheckedAt || '');
    if (
      !options.force
      && reason === 'settings-open'
      && Number.isFinite(lastCheckedAt)
      && now - lastCheckedAt < PRO_SETUP_CHECK_INTERVAL_MS
    ) {
      const cached = this.settings.localTranscriptionEntitlementStatus;
      if (!isCachedProStatusActive(cached)) return cached || buildMissingRedeemCodeStatus();
    }

    let status = null;
    try {
      status = await this.getProFeatureAccessStatus({ forceRefresh: Boolean(options.force) });
    } finally {
      if (reason === 'settings-open') {
        await this.saveSettings({
          ...this.settings,
          proSetupLastCheckedAt: new Date(now).toISOString(),
        });
      }
    }

    if (!status || !status.hasAccess) return status;

    const readiness = this.getLocalTranscriptionComponentReadiness();
    if (readiness.ready) return status;

    const snoozedUntil = Date.parse(this.settings.proSetupInstallPromptSnoozedUntil || '');
    if (
      !options.force
      && reason !== 'first-use'
      && Number.isFinite(snoozedUntil)
      && snoozedUntil > now
    ) {
      return status;
    }

    const accepted = await this.confirmLocalComponentInstall(status, reason, readiness);
    if (!accepted) {
      await this.saveSettings({
        ...this.settings,
        proSetupInstallPromptSnoozedUntil: new Date(now + PRO_SETUP_PROMPT_COOLDOWN_MS).toISOString(),
      });
      return status;
    }

    await this.installLocalTranscriptionComponents({ reason, readiness });
    return status;
  }

  async confirmLocalComponentInstall(status, reason, readiness) {
    const missingText = readiness.missingComponents.join('、') || '本地转写组件';
    const reasonText = reason === 'first-use'
      ? '当前操作需要使用本地转写组件。'
      : '检测到你已开通 Pro，但本地转写组件还没有准备完整。';
    const message = [
      reasonText,
      `缺少：${missingText}`,
      `当前电脑：${readiness.platformName || '当前系统'}`,
      '这个组件用于音视频转写和小红书图片文字识别，图片会在本机识别，不上传到云端。',
      '现在开始安装/修复吗？',
    ].join('\n');
    const modalResult = showLocalComponentInstallConfirm(this.app, message);
    if (modalResult) {
      return await modalResult;
    }
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return Boolean(window.confirm(message));
    }
    new Notice(`Pro 已开通，但缺少${missingText}。请在插件设置的 Pro 高级功能里安装本地转写组件。`, 10000);
    return false;
  }

  async installLocalTranscriptionComponents(options = {}) {
    if (this.localComponentInstallPromise) {
      new Notice('本地转写组件正在准备中，请等待当前安装完成后再重试。');
      return await this.localComponentInstallPromise;
    }
    this.localComponentInstallPromise = this.doInstallLocalTranscriptionComponents(options);
    try {
      return await this.localComponentInstallPromise;
    } catch (error) {
      await this.showLocalComponentInstallFailure(error);
      throw error;
    } finally {
      this.localComponentInstallPromise = null;
    }
  }

  async showLocalComponentInstallFailure(error) {
    const reason = formatLocalComponentInstallFailureReason(error);
    const message = [
      `失败原因：${reason}`,
      '如需协助，请点击插件设置里的「复制诊断信息」，联系开发者张张（微信：heyhmjx）。',
    ].join('\n');
    const modalResult = showLocalComponentInstallFailure(this.app, message);
    if (modalResult) {
      await modalResult;
      return;
    }
    new Notice(`本地转写组件安装失败：${reason}。如需协助，请点击插件设置里的「复制诊断信息」，联系开发者张张（微信：heyhmjx）。`, 12000);
  }

  async doInstallLocalTranscriptionComponents(options = {}) {
    await this.ensureProFeatureAccess('本地转写组件安装');
    const readiness = options.readiness || this.getLocalTranscriptionComponentReadiness();
    const requireAsr = options.requireAsr !== false;
    const requireOcr = options.requireOcr !== false;
    const failures = [];
    if (requireAsr && (!readiness.asrStatus || !readiness.asrStatus.ready)) {
      try {
        await this.installLocalAsr({ installMode: normalizeLocalAsrInstallMode(this.settings.localAsrInstallMode), reason: options.reason });
      } catch (error) {
        failures.push({
          component: '音视频转写 ASR',
          error,
        });
      }
    }
    const ocrStatus = this.getLocalOcrInstallStatus();
    if (requireOcr && !ocrStatus.ready) {
      try {
        await this.installLocalOcr({ reason: options.reason });
      } catch (error) {
        failures.push({
          component: '图片文字识别 OCR',
          error,
        });
      }
    }
    if (failures.length) {
      const message = failures
        .map((item) => `${item.component}：${item.error && item.error.message ? item.error.message : item.error}`)
        .join('\n');
      throw new Error(message);
    }
    return {
      installed: true,
      reason: options.reason || '',
      readiness: this.getLocalTranscriptionComponentReadiness(),
    };
  }

  async ensureLocalComponentReadyForUse(featureName = '该功能', options = {}) {
    const status = await this.ensureProFeatureAccess(featureName);
    const readiness = this.getLocalTranscriptionComponentReadiness();
    const requireAsr = options.requireAsr !== false;
    const requireOcr = Boolean(options.requireOcr);
    const asrMissing = requireAsr && (!readiness.asrStatus || !readiness.asrStatus.ready);
    const ocrMissing = requireOcr && (!readiness.ocrStatus || !readiness.ocrStatus.ready);
    if (!asrMissing && !ocrMissing) return status;

    const accepted = await this.confirmLocalComponentInstall(status, options.reason || 'first-use', readiness);
    if (!accepted) {
      throw new Error(`${featureName}需要先安装本地转写组件。`);
    }
    await this.installLocalTranscriptionComponents({
      reason: options.reason || 'first-use',
      readiness,
      requireAsr,
      requireOcr,
    });

    const nextReadiness = this.getLocalTranscriptionComponentReadiness();
    const stillAsrMissing = requireAsr && (!nextReadiness.asrStatus || !nextReadiness.asrStatus.ready);
    const stillOcrMissing = requireOcr && (!nextReadiness.ocrStatus || !nextReadiness.ocrStatus.ready);
    if (stillAsrMissing || stillOcrMissing) {
      throw new Error(`${featureName}需要本地转写组件安装完整后才能使用。`);
    }
    return status;
  }

  async ensureLocalTranscriptionAccess() {
    return await this.ensureProFeatureAccess('音视频转写权限');
  }

  async installLocalAsr(options = {}) {
    if (this.localAsrInstallPromise) {
      new Notice('本地转写组件正在安装中，请等待当前安装完成后再重试。');
      return await this.localAsrInstallPromise;
    }
    this.localAsrInstallPromise = this.doInstallLocalAsr(options);
    try {
      return await this.localAsrInstallPromise;
    } finally {
      this.localAsrInstallPromise = null;
    }
  }

  async doInstallLocalAsr(options = {}) {
    await this.ensureLocalTranscriptionAccess();
    const mismatchMessage = getLocalAsrPlatformMismatchMessage(this.settings.localAsrPlatform);
    if (mismatchMessage) {
      throw new Error(mismatchMessage);
    }
    const installerPath = await this.getAvailableLocalAsrInstallerPath();
    const platform = this.getConfiguredLocalAsrPlatform();
    const installMode = normalizeLocalAsrInstallMode(options.installMode || this.settings.localAsrInstallMode);
    const installRoot = this.getConfiguredLocalAsrInstallRoot(installMode);
    const command = buildLocalAsrInstallCommand(installerPath, platform, platform === 'win32' ? installRoot : '');
    new Notice('开始安装本地转写组件，可能需要几分钟。');
    await new Promise((resolve, reject) => {
      childProcess.exec(command, {
        timeout: LOCAL_ASR_INSTALL_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed || error.signal === 'SIGTERM' || /timed out|timeout/i.test(error.message || '');
          const errorText = timedOut
            ? '本地转写组件安装超时：安装超过 20 分钟仍未完成。通常是腾讯云下载源、ffmpeg、模型文件或 Python 依赖访问过慢。安装已中止，请复制诊断信息联系开发者。'
            : (error.message || String(error));
          const logPath = writeLocalAsrInstallLog({
            installRoot,
            platform,
            installerPath,
            command,
            stdout,
            stderr,
            error: errorText,
            status: 'failed',
          });
          const message = timedOut ? errorText : (stderr || stdout || errorText);
          reject(new Error(`${message}${logPath ? `\n安装日志：${logPath}` : ''}`));
          return;
        }
        writeLocalAsrInstallLog({
          installRoot,
          platform,
          installerPath,
          command,
          stdout,
          stderr,
          status: 'success',
        });
        resolve({ stdout, stderr });
      });
    });
    const installStatus = getLocalAsrInstallStatus(installRoot, fs.existsSync, platform);
    if (!installStatus.ready) {
      const missingText = installStatus.missingReasons && installStatus.missingReasons.length
        ? installStatus.missingReasons.join('；')
        : '本地转写组件不完整';
      const logPath = writeLocalAsrInstallLog({
        installRoot,
        platform,
        installerPath,
        command,
        stdout: `whisper=${installStatus.whisperPath || 'missing'}\nffmpeg=${installStatus.ffmpegPath || 'missing'}\nmodel=${installStatus.hasModel ? installStatus.modelPath : 'missing'}`,
        stderr: missingText,
        error: missingText,
        status: 'failed',
      });
      throw new Error(`本地转写组件安装不完整：${missingText}${logPath ? `\n安装日志：${logPath}` : ''}`);
    }
    await this.saveSettings({
      ...this.settings,
      aiProvider: 'local',
      localAsrInstallMode: installMode,
      localTranscriptionCommand: getDefaultLocalTranscriptionCommand(platform, installRoot),
    });
    new Notice('本地转写组件已安装，并已填入默认命令。');
  }

  async switchLocalAsrToSafeInstallRoot() {
    if (this.getConfiguredLocalAsrPlatform() !== 'win32') {
      throw new Error('安全安装目录目前只用于 Windows。');
    }
    await this.installLocalAsr({ installMode: 'safe' });
  }

  async checkAndRepairLocalAsr() {
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    const status = this.getLocalAsrInstallStatus();
    const action = getLocalAsrRepairAction({
      platform,
      installRoot,
      status,
      runLogText: readLocalAsrRunLog(installRoot),
    });

    if (action === 'none') {
      new Notice('当前本地转写组件正常，不需要高级修复。');
      return { action };
    }

    if (action === 'safe') {
      await this.installLocalAsr({ installMode: 'safe' });
      new Notice('已切换到安全安装目录，并重新安装本地转写组件。');
      return { action };
    }

    await this.installLocalAsr({ installMode: normalizeLocalAsrInstallMode(this.settings.localAsrInstallMode) });
    new Notice('已更新本地转写组件。');
    return { action };
  }

  async renderSocialMediaUrl(url) {
    return renderSocialMediaUrlWithElectron(url);
  }

  async renderSocialMediaUrls(url) {
    if (
      Object.prototype.hasOwnProperty.call(this, 'renderSocialMediaUrl')
      && !Object.prototype.hasOwnProperty.call(this, 'renderSocialMediaUrls')
    ) {
      return sortMediaUrlsForTranscription([await this.renderSocialMediaUrl(url)]);
    }
    return renderSocialMediaUrlsWithElectron(url);
  }

  async runConfiguredTranscription(audioUrl, options = {}) {
    const provider = this.settings.aiProvider;
    const runLocalFallback = async (sourcePrefix) => {
      if (provider === 'doubao') {
        await this.clearPendingDoubaoTask(getDoubaoTaskKey(audioUrl));
      }
      return {
        transcription: await this.runLocalTranscription(audioUrl, options),
        source: sourcePrefix ? `${sourcePrefix}-local` : 'local',
      };
    };

    if (options.forceLocal) {
      return runLocalFallback('');
    }

    if (['aliyun', 'doubao', 'tencent'].includes(provider) && isHeaderProtectedMediaUrl(audioUrl)) {
      if (this.canRunLocalTranscription()) {
        return runLocalFallback(provider);
      }
      throw new Error('该平台音频地址带防盗链，云端转写服务无法直接下载。请安装本地转写组件后重试。');
    }

    if (this.settings.aiProvider === 'aliyun') {
      try {
        return {
          transcription: await this.runAliyunTranscription(audioUrl),
          source: 'aliyun',
        };
      } catch (error) {
        if (isRemoteAsrDownloadFailure(error) && this.canRunLocalTranscription()) {
          return runLocalFallback('aliyun');
        }
        throw error;
      }
    }
    if (this.settings.aiProvider === 'doubao') {
      try {
        return {
          transcription: await this.runDoubaoTranscription(audioUrl),
          source: 'doubao',
        };
      } catch (error) {
        if (isRemoteAsrDownloadFailure(error) && this.canRunLocalTranscription()) {
          return runLocalFallback('doubao');
        }
        throw error;
      }
    }
    if (this.settings.aiProvider === 'tencent') {
      try {
        return {
          transcription: await this.runTencentTranscription(audioUrl),
          source: 'tencent',
        };
      } catch (error) {
        if (isRemoteAsrDownloadFailure(error) && this.canRunLocalTranscription()) {
          return runLocalFallback('tencent');
        }
        throw error;
      }
    }
    if (this.settings.aiProvider === 'local') {
      try {
        return {
          transcription: await this.runLocalTranscription(audioUrl, options),
          source: 'local',
        };
      } catch (error) {
        if (!options.fileID && !options.allowCloudUrlFallback) {
          throw error;
        }
        return await this.runCloudFallbackTranscription(audioUrl, {
          ...options,
          localError: error && error.message ? error.message : String(error || ''),
          source: options.source || 'local',
        });
      }
    }
    throw new Error('未配置可用的音频转写方案');
  }

  async runCloudFallbackTranscription(audioUrl, options = {}) {
    const binding = options.binding || this.getActiveBindings()[0] || null;
    if (!binding) {
      throw new Error(`${options.localError || '本地转写失败'}；云端兜底失败：未绑定小程序`);
    }
    this.showSyncProgress({
      stage: 'transcribing',
      title: options.title || '',
      message: '本地转写失败，正在尝试云端兜底',
    });
    const fileID = String(options.fileID || '').trim();
    if (!fileID && !options.allowCloudUrlFallback) {
      throw new Error(`${options.localError || '本地转写失败'}；云端兜底失败：缺少云端文件 ID`);
    }
    try {
      const requestBody = {
        durationSeconds: options.durationSeconds || 60,
        localError: options.localError || '',
        source: options.source || 'local',
        title: options.title || '',
      };
      if (fileID) {
        requestBody.fileID = fileID;
      } else {
        requestBody.audioUrl = audioUrl;
      }
      const payload = await this.requestJson('/transcriptions/cloud', 'POST', requestBody, binding);
      const data = payload && payload.data ? payload.data : {};
      const transcription = String(data.transcription || '').trim();
      if (!transcription) {
        throw new Error('云端兜底返回空转写结果');
      }
      return {
        transcription,
        source: 'local-cloud-fallback',
        cloudProvider: data.provider || 'cloud',
        cloudRequestId: data.requestId || '',
        cloudUsedSeconds: Number(data.usedSeconds) || 0,
        cloudRemainingSeconds: Number(data.remainingSeconds) || 0,
      };
    } catch (cloudError) {
      const cloudMessage = cloudError && cloudError.message ? cloudError.message : String(cloudError || '');
      throw new Error(`${options.localError || '本地转写失败'}；云端兜底失败：${cloudMessage}`);
    }
  }

  async runLocalTranscription(audioUrl, options = {}) {
    await this.ensureLocalComponentReadyForUse('音视频转写', {
      reason: 'first-use',
      requireAsr: true,
      requireOcr: false,
    });
    const installStatus = this.getLocalAsrInstallStatus();
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    if (installStatus.scriptOutdated) {
      throw new Error('本地转写脚本过旧：请在插件设置里重新点击“安装/更新本地转写组件”，安装完成后再同步。');
    }
    const commandTemplate = this.getEffectiveLocalTranscriptionCommand();
    if (!commandTemplate) {
      throw new Error('未配置本地转写命令');
    }

    const progressTitle = options.title || '';
    const abortController = new AbortController();
    this.currentTranscriptionAbortController = abortController;
    let progressTimer = null;
    let lastProgressKey = '';
    const emitLocalProgress = (fallbackPercent = null) => {
      if (typeof this.showSyncProgress !== 'function') return;
      const parsedProgress = parseLocalAsrProgressLog(readLocalAsrRunLog(installRoot));
      const progress = parsedProgress || (
        fallbackPercent === null
          ? null
          : {
            stage: '',
            current: 0,
            total: 0,
            percent: fallbackPercent,
          }
      );
      if (!progress) return;
      const key = `${progress.stage}|${progress.current}|${progress.total}|${progress.percent}`;
      if (key === lastProgressKey) return;
      lastProgressKey = key;
      this.showSyncProgress({
        ...options,
        stage: 'transcribing',
        title: progressTitle,
        percent: progress.percent,
        localProgressStage: progress.stage,
        localProgressCurrent: progress.current,
        localProgressTotal: progress.total,
      });
    };
    const stopProgressPolling = () => {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    };

    let inputPath = '';
    let outputPath = '';
    let command = '';
    try {
      this.showSyncProgress({
        ...options,
        stage: 'downloading',
        title: progressTitle,
        percent: 0,
      });
      inputPath = await this.downloadMediaToTempFile(audioUrl, {
        sourceUrl: options.sourceUrl || options.url || '',
        decryptKey: options.decryptKey || options.wechatChannelsDecodeKey || '',
        signal: abortController.signal,
        onProgress: (progress = {}) => {
          if (typeof progress.percent === 'number') {
            this.showSyncProgress({
              ...options,
              stage: 'downloading',
              title: progressTitle,
              percent: progress.percent,
            });
          }
        },
      });
      throwIfAborted(abortController.signal);
      outputPath = `${inputPath}.txt`;
      const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
      command = commandTemplate.includes('{input}')
        ? commandTemplate
          .replace(/\{input\}/g, quote(inputPath))
          .replace(/\{output\}/g, quote(outputPath))
        : `${commandTemplate} ${quote(inputPath)}`;
      const { stdout, stderr } = await new Promise((resolve, reject) => {
        emitLocalProgress(0);
        progressTimer = setInterval(() => emitLocalProgress(), 1000);
        if (progressTimer && typeof progressTimer.unref === 'function') {
          progressTimer.unref();
        }
        const child = childProcess.exec(command, {
          timeout: 2 * 60 * 60 * 1000,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        }, (error, stdout, stderr) => {
          stopProgressPolling();
          this.currentTranscriptionProcess = null;
          if (abortController.signal.aborted) {
            reject(createAbortError());
            return;
          }
          if (error) {
            const wrapped = new Error(stderr || error.message || String(error));
            wrapped.stdout = stdout;
            wrapped.stderr = stderr;
            reject(wrapped);
            return;
          }
          emitLocalProgress(100);
          resolve({ stdout, stderr });
        });
        this.currentTranscriptionProcess = child;
      });

      const outputText = fs.existsSync(outputPath)
        ? fs.readFileSync(outputPath, 'utf8')
        : stdout;
      const transcription = String(outputText || '').trim();
      if (!transcription) {
        throw new Error('本地转写命令没有返回文本');
      }
      writeLocalAsrRunLog({
        installRoot,
        status: 'success',
        command,
        inputPath,
        outputPath,
        stdout,
        stderr,
      });
      return transcription;
    } catch (error) {
      if (isAbortError(error)) {
        throw createRetryableTranscriptionError('用户已停止当前转写');
      }
      appendLocalAsrRunLog({
        installRoot,
        status: 'failed',
        command,
        inputPath,
        outputPath,
        stdout: error && error.stdout ? error.stdout : '',
        stderr: error && error.stderr ? error.stderr : '',
        error: error && error.message ? error.message : String(error || ''),
      });
      throw error;
    } finally {
      stopProgressPolling();
      this.currentTranscriptionAbortController = null;
      this.currentTranscriptionProcess = null;
      [inputPath, outputPath].forEach((filePath) => {
        try {
          if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (error) {
          // Ignore temp cleanup failures.
        }
      });
    }
  }

  async downloadMediaToTempFile(audioUrl, options = {}) {
    const resolvedUrl = shouldResolveMediaDownloadUrl(audioUrl)
      ? await resolveRedirectUrl(audioUrl, 5, 'GET')
      : audioUrl;
    throwIfAborted(options.signal);
    const downloadedBuffer = Buffer.from(await this.downloadArrayBuffer(
      resolvedUrl,
      getSocialRequestHeaders(options.sourceUrl || resolvedUrl),
      {
        signal: options.signal,
        onProgress: options.onProgress,
      },
    ));
    throwIfAborted(options.signal);
    const buffer = options.decryptKey
      ? decryptWechatChannelsMediaBuffer(downloadedBuffer, options.decryptKey)
      : downloadedBuffer;
    const invalidReason = getInvalidDownloadedMediaReason(buffer);
    if (invalidReason) {
      throw new Error(`${invalidReason}：${cleanDisplayUrl(resolvedUrl || audioUrl)}`);
    }
    const ext = getAudioFormatFromUrl(resolvedUrl || audioUrl);
    const filePath = path.join(os.tmpdir(), `wechat-inbox-sync-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  async runAliyunTranscription(audioUrl) {
    const response = await requestUrl({
      url: this.settings.aliyunBaseUrl,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.settings.aliyunApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildAliyunVoiceRequest({
        settings: this.settings,
        audioUrl,
      })),
    });

    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(`阿里云百炼请求失败：HTTP ${response.status} ${String(response.text || '').slice(0, 180)}`);
    }

    const transcription = parseAliyunTranscriptionResult(response.text || JSON.stringify(response.json || {}));
    if (!transcription) {
      throw new Error('阿里云百炼返回空转写结果');
    }
    return transcription;
  }

  async runDoubaoTranscriptionLegacy(audioUrl) {
    const request = buildDoubaoAsrRequest({
      apiKey: this.settings.doubaoAsrApiKey,
      audioUrl,
    });
    const response = await requestUrl({
      url: request.url,
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      throw: request.throw,
    });

    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(formatHttpError('豆包语音识别', response));
    }

    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(`豆包语音识别请求失败：HTTP ${response.status} ${String(response.text || '').slice(0, 180)}`);
    }

    const transcription = parseDoubaoAsrResult(response.json || response.text);
    if (!transcription) {
      throw new Error('豆包语音识别返回空转写结果');
    }
    return transcription;
  }

  async runDoubaoTranscription(audioUrl) {
    const taskKey = getDoubaoTaskKey(audioUrl);
    const pendingTasks = this.settings.pendingDoubaoTasks || {};
    const existingTask = pendingTasks[taskKey];
    if (existingTask && existingTask.requestId) {
      try {
        const existingState = await this.queryDoubaoTranscription(existingTask.requestId);
        if (existingState.status === 'success') {
          await this.clearPendingDoubaoTask(taskKey);
          return existingState.transcription;
        }
      } catch (error) {
        await this.clearPendingDoubaoTask(taskKey);
        throw error;
      }
      throw createRetryableTranscriptionError('豆包语音识别仍在处理中，请稍后再次同步');
    }

    const requestId = createRequestId();
    const request = buildDoubaoAsrRequest({
      apiKey: this.settings.doubaoAsrApiKey,
      audioUrl,
      requestId,
    });
    const submitResponse = await requestUrl({
      url: request.url,
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      throw: request.throw,
    });

    const submitState = parseDoubaoAsrTaskState(submitResponse);
    if (submitState.status === 'success') {
      return submitState.transcription;
    }
    await this.savePendingDoubaoTask(taskKey, {
      requestId,
      audioUrl,
      createdAt: new Date().toISOString(),
    });

    for (let attempt = 0; attempt < this.settings.doubaoPollAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(this.settings.doubaoPollIntervalMs);
      }

      let state;
      try {
        state = await this.queryDoubaoTranscription(requestId);
      } catch (error) {
        await this.clearPendingDoubaoTask(taskKey);
        throw error;
      }
      if (state.status === 'success') {
        await this.clearPendingDoubaoTask(taskKey);
        return state.transcription;
      }
    }

    throw createRetryableTranscriptionError('豆包语音识别仍在处理中，请稍后再次同步');
  }

  async queryDoubaoTranscription(requestId) {
    const query = buildDoubaoAsrQueryRequest({
      apiKey: this.settings.doubaoAsrApiKey,
      requestId,
    });
    const queryResponse = await requestUrl({
      url: query.url,
      method: 'POST',
      headers: query.headers,
      body: JSON.stringify(query.body),
      throw: query.throw,
    });
    return parseDoubaoAsrTaskState(queryResponse);
  }

  async savePendingDoubaoTask(taskKey, task) {
    await this.saveSettings({
      ...this.settings,
      pendingDoubaoTasks: {
        ...(this.settings.pendingDoubaoTasks || {}),
        [taskKey]: task,
      },
    });
  }

  async clearPendingDoubaoTask(taskKey) {
    const nextTasks = { ...(this.settings.pendingDoubaoTasks || {}) };
    delete nextTasks[taskKey];
    await this.saveSettings({
      ...this.settings,
      pendingDoubaoTasks: nextTasks,
    });
  }

  async runTencentTranscription(audioUrl) {
    const createPayload = await this.postTencent('CreateRecTask', buildTencentCreateRecTaskBody({
      audioUrl,
      engineModelType: this.settings.tencentEngineModelType,
    }));
    const taskId = parseTencentCreateTaskResponse(createPayload);

    for (let attempt = 0; attempt < this.settings.tencentPollAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(this.settings.tencentPollIntervalMs);
      }

      const statusPayload = await this.postTencent('DescribeTaskStatus', { TaskId: taskId });
      const status = parseTencentTaskStatusResponse(statusPayload);
      if (status.transcription || status.status === 2 || status.statusStr === 'success') {
        return status.transcription;
      }
      if (status.status === 3 || status.statusStr === 'failed') {
        throw new Error(status.errorMsg || '腾讯云转写失败');
      }
    }

    throw new Error('腾讯云转写仍在处理中，请稍后重试或调大轮询等待时间');
  }

  async ensureFolder(folderPath) {
    if (!(await this.app.vault.adapter.exists(folderPath))) {
      await this.app.vault.createFolder(folderPath);
    }
  }

  async nextTitle(dayDir, recordOrTitle, createdAt) {
    const baseTitle = typeof recordOrTitle === 'string'
      ? (createdAt ? `${recordOrTitle}-${getTitleTimePart(createdAt)}` : recordOrTitle)
      : buildRecordTitleBase(recordOrTitle);
    if (!(await this.app.vault.adapter.exists(`${dayDir}/${baseTitle}.md`))) {
      return baseTitle;
    }

    let sequence = 2;
    while (await this.app.vault.adapter.exists(`${dayDir}/${baseTitle}-${String(sequence).padStart(3, '0')}.md`)) {
      sequence += 1;
    }
    return `${baseTitle}-${String(sequence).padStart(3, '0')}`;
  }

  async writeVoiceAttachment(record, rootDir, dateFolder, title, binding = null, progress = {}) {
    const metadata = record.metadata || {};
    if (!metadata.audioFileID) {
      return record;
    }

    const sourceAudioName = metadata.audioFileName || record.content || '';
    const sourceAudioExt = getAttachmentExt(sourceAudioName, metadata.audioFileExt || metadata.fileExt);
    const audioFileName = `${title}.${sourceAudioExt || 'mp3'}`;
    const audioRootDir = `${rootDir}/语音附件`;
    const audioDayDir = `${audioRootDir}/${dateFolder}`;
    const audioPath = `${audioDayDir}/${audioFileName}`;
    const tempFileURL = await this.requestFileDownloadUrl(metadata.audioFileID, binding);
    this.showSyncProgress({ ...progress, stage: 'downloading', title });
    const audioBuffer = await this.downloadArrayBuffer(tempFileURL);

    if (typeof this.app.vault.adapter.writeBinary !== 'function') {
      throw new Error('当前 Obsidian 环境不支持写入二进制附件');
    }

    await this.ensureFolder(audioRootDir);
    await this.ensureFolder(audioDayDir);
    await this.app.vault.adapter.writeBinary(audioPath, audioBuffer);

    let nextMetadata = {
      ...metadata,
      audioFileName: audioPath,
    };

    const existingTranscriptionStatus = String(metadata.transcriptionStatus || '').toLowerCase();
    const existingTranscription = String(metadata.transcription || '').trim();
    const transcriptionSource = String(metadata.transcriptionSource || metadata.transcriptionProvider || '');
    const isCloudTranscriptionRecord = metadata.transcriptionMode === 'cloud'
      || transcriptionSource.includes('cloud-pretranscription')
      || transcriptionSource.includes('cloud');
    const shouldFallbackCloudFailureToLocal = isCloudTranscriptionRecord
      && existingTranscriptionStatus === 'failed'
      && !existingTranscription;

    if (shouldFallbackCloudFailureToLocal) {
      try {
        this.showSyncProgress({ ...progress, stage: 'transcribing', title });
        const result = await this.runConfiguredTranscription(tempFileURL, {
          binding,
          fileID: metadata.audioFileID,
          title,
          forceLocal: true,
          cloudFallbackReason: 'cloud-pretranscription-failed',
        });
        nextMetadata = {
          ...nextMetadata,
          transcription: result.transcription,
          transcriptionStatus: 'success',
          transcriptionProvider: result.source,
          transcriptionSource: 'local-fallback',
          cloudTranscriptionError: metadata.transcriptionError || '',
          cloudTranscriptionProvider: metadata.transcriptionProvider || metadata.transcriptionSource || 'cloud-pretranscription',
        };
      } catch (error) {
        const message = error.message || String(error);
        nextMetadata = {
          ...nextMetadata,
          transcription: '',
          transcriptionStatus: 'failed',
          transcriptionError: message,
          transcriptionProvider: 'local',
          transcriptionSource: 'local-fallback',
          cloudTranscriptionError: metadata.transcriptionError || '',
        };
      }
    } else if (isCloudTranscriptionRecord) {
      nextMetadata = {
        ...nextMetadata,
        transcription: existingTranscription,
        transcriptionStatus: existingTranscriptionStatus || 'processing',
        transcriptionProvider: metadata.transcriptionProvider || metadata.transcriptionSource || 'cloud-pretranscription',
        transcriptionSource: metadata.transcriptionSource || 'cloud-pretranscription',
        transcriptionError: metadata.transcriptionError || (
          ['queued', 'processing'].includes(existingTranscriptionStatus)
            ? '云端转写中，下次同步会自动更新'
            : ''
        ),
      };
    } else if (this.settings.aiProvider !== 'off' || metadata.transcriptionMode === 'local') {
      try {
        this.showSyncProgress({ ...progress, stage: 'transcribing', title });
        const result = await this.runConfiguredTranscription(tempFileURL, {
          binding,
          fileID: metadata.audioFileID,
          title,
          forceLocal: metadata.transcriptionMode === 'local',
        });
        nextMetadata = {
          ...nextMetadata,
          transcription: result.transcription,
          transcriptionStatus: 'success',
          transcriptionProvider: result.source,
          cloudTranscriptionProvider: result.cloudProvider || '',
          cloudTranscriptionRequestId: result.cloudRequestId || '',
          cloudTranscriptionUsedSeconds: result.cloudUsedSeconds || 0,
          cloudTranscriptionRemainingSeconds: result.cloudRemainingSeconds || 0,
        };
      } catch (error) {
        const message = error.message || String(error);
        nextMetadata = {
          ...nextMetadata,
          transcription: '',
          transcriptionStatus: 'failed',
          transcriptionError: message,
          transcriptionProvider: this.settings.aiProvider,
        };
      }
    }

    return {
      ...record,
      metadata: nextMetadata,
    };
  }

  async writeFileAttachment(record, rootDir, dateFolder, title, binding = null, progress = {}) {
    const metadata = record.metadata || {};
    if (!metadata.fileID) {
      return record;
    }

    try {
      const fileName = metadata.fileName || record.content || `${title}.bin`;
      const fileExt = getAttachmentExt(fileName, metadata.fileExt);
      const safeFileName = sanitizeAttachmentName(fileName, `${title}${fileExt ? `.${fileExt}` : ''}`);
      const fileRootDir = `${rootDir}/文件附件`;
      const fileDayDir = `${fileRootDir}/${dateFolder}`;
      const filePath = `${fileDayDir}/${title}-${safeFileName}`;
      const tempFileURL = await this.requestFileDownloadUrl(metadata.fileID, binding);
      this.showSyncProgress({ ...progress, stage: 'downloading', title: fileName });
      const fileBuffer = await this.downloadArrayBuffer(tempFileURL);

      if (typeof this.app.vault.adapter.writeBinary !== 'function') {
        throw new Error('当前 Obsidian 环境不支持写入二进制附件');
      }

      await this.ensureFolder(fileRootDir);
      await this.ensureFolder(fileDayDir);
      await this.app.vault.adapter.writeBinary(filePath, fileBuffer);
      const nodeBuffer = toNodeBuffer(fileBuffer);

      const nextMetadata = {
        ...metadata,
        fileName,
        fileExt,
        filePath,
      };

      try {
        if (isMarkdownConvertibleExt(fileExt)) {
          nextMetadata.convertedMarkdown = decodeUtf8ArrayBuffer(nodeBuffer);
          nextMetadata.conversionStatus = 'success';
        } else if (fileExt === 'docx') {
          nextMetadata.convertedMarkdown = extractDocxMarkdown(nodeBuffer);
          nextMetadata.conversionStatus = 'success';
        } else if (fileExt === 'pdf') {
          this.showSyncProgress({ ...progress, stage: 'processing', title: fileName });
          nextMetadata.convertedMarkdown = extractPdfMarkdown(nodeBuffer);
          nextMetadata.conversionStatus = 'success';
        } else if (fileExt === 'doc') {
          nextMetadata.conversionStatus = 'attachment_saved';
          nextMetadata.conversionError = '旧版 .doc 是二进制格式，当前请优先上传 .docx。';
        } else if (!nextMetadata.convertedMarkdown && !nextMetadata.markdown) {
          nextMetadata.conversionStatus = 'attachment_saved';
        }
      } catch (error) {
        nextMetadata.conversionStatus = 'attachment_saved';
        nextMetadata.conversionError = error.message || String(error);
      }

      if (isAudioVideoAttachmentExt(fileExt)) {
        try {
          this.showSyncProgress({ ...progress, stage: 'transcribing', title: fileName });
          const result = await this.runConfiguredTranscription(tempFileURL, {
            binding,
            fileID: metadata.fileID,
            title,
            source: 'file-attachment',
            forceLocal: metadata.transcriptionMode === 'local',
            durationSeconds: Math.max(60, Math.ceil((Number(metadata.duration) || 0) / 1000) || 60),
          });
          const transcriptProperties = buildTranscriptPropertyMetadata({
            transcription: result.transcription,
            title: metadata.title || title || fileName,
          });
          nextMetadata.transcription = result.transcription;
          nextMetadata.transcriptionStatus = 'success';
          nextMetadata.transcriptionProvider = result.source;
          nextMetadata.transcriptionSource = 'file-attachment';
          nextMetadata.conversionStatus = 'success';
          nextMetadata.cloudTranscriptionProvider = result.cloudProvider || '';
          nextMetadata.cloudTranscriptionRequestId = result.cloudRequestId || '';
          nextMetadata.cloudTranscriptionUsedSeconds = result.cloudUsedSeconds || 0;
          nextMetadata.cloudTranscriptionRemainingSeconds = result.cloudRemainingSeconds || 0;
          nextMetadata.description = nextMetadata.description || transcriptProperties.description;
          nextMetadata.keywords = getRecordKeywords(nextMetadata).length ? getRecordKeywords(nextMetadata) : transcriptProperties.keywords;
          nextMetadata.aiMetadataSource = nextMetadata.aiMetadataSource || transcriptProperties.aiMetadataSource;
          nextMetadata.contentCategory = nextMetadata.contentCategory || (['mp4', 'mov', 'm4v'].includes(fileExt) ? '视频' : '音频');
        } catch (error) {
          nextMetadata.transcription = '';
          nextMetadata.transcriptionStatus = 'failed';
          nextMetadata.transcriptionError = error.message || String(error);
          nextMetadata.transcriptionProvider = this.settings.aiProvider;
          nextMetadata.transcriptionSource = 'file-attachment';
          nextMetadata.conversionStatus = 'failed';
          nextMetadata.contentCategory = nextMetadata.contentCategory || (['mp4', 'mov', 'm4v'].includes(fileExt) ? '视频' : '音频');
        }
      }

      return {
        ...record,
        metadata: nextMetadata,
      };
    } catch (error) {
      return {
        ...record,
        metadata: {
          ...metadata,
          conversionStatus: 'failed',
          conversionError: error.message || String(error),
        },
      };
    }
  }

  async saveWebpageImageAssets(markdown, assets, rootDir, dateFolder, title) {
    if (!Array.isArray(assets) || !assets.length || typeof this.app.vault.adapter.writeBinary !== 'function') {
      return markdown;
    }

    const imageRootDir = `${rootDir}/网页图片`;
    const imageDayDir = `${imageRootDir}/${dateFolder}`;
    let nextMarkdown = String(markdown || '');
    let index = 1;

    await this.ensureFolder(imageRootDir);
    await this.ensureFolder(imageDayDir);

    for (const asset of assets) {
      const decoded = decodeDataUrl(asset.dataUrl);
      if (!decoded || !asset.src) continue;
      const ext = getImageExtFromMime(decoded.mimeType);
      const imagePath = `${imageDayDir}/${title}-image-${String(index).padStart(2, '0')}.${ext}`;
      await this.app.vault.adapter.writeBinary(imagePath, decoded.buffer);
      const pattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(asset.src)}\\)`, 'g');
      nextMarkdown = nextMarkdown.replace(pattern, `![[${imagePath}]]`);
      index += 1;
    }

    return nextMarkdown;
  }

  async saveMarkdownRemoteImageAssets(markdown, rootDir, dateFolder, title) {
    if (!markdown
      || !this.app
      || !this.app.vault
      || !this.app.vault.adapter
      || typeof this.app.vault.adapter.writeBinary !== 'function') {
      return markdown;
    }
    const imageMatches = Array.from(String(markdown).matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g));
    if (!imageMatches.length) return markdown;

    const imageRootDir = `${rootDir}/网页图片`;
    const imageDayDir = `${imageRootDir}/${dateFolder}`;
    let nextMarkdown = String(markdown || '');
    let index = 1;
    const savedByUrl = new Map();
    const safeTitle = sanitizeAttachmentName(title, '网页图片');

    await this.ensureFolder(imageRootDir);
    await this.ensureFolder(imageDayDir);

    for (const match of imageMatches) {
      const imageUrl = String(match[2] || '').trim();
      if (!imageUrl || savedByUrl.has(imageUrl)) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const arrayBuffer = await this.downloadArrayBuffer(imageUrl);
        const buffer = Buffer.from(arrayBuffer || []);
        if (!buffer.length) continue;
        const ext = getImageExtFromBuffer(buffer, imageUrl);
        const imagePath = `${imageDayDir}/${safeTitle}-image-${String(index).padStart(2, '0')}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
        await this.app.vault.adapter.writeBinary(imagePath, buffer);
        savedByUrl.set(imageUrl, imagePath);
        index += 1;
      } catch (error) {
        // Remote image localization is best-effort. Keep the original URL if download fails.
      }
    }

    savedByUrl.forEach((imagePath, imageUrl) => {
      const pattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(imageUrl)}\\)`, 'g');
      nextMarkdown = nextMarkdown.replace(pattern, `![[${imagePath}]]`);
    });

    return nextMarkdown;
  }

  async buildTranscriptRecordFromMedia(record, {
    url,
    platform,
    mediaUrl = '',
    mediaUrls = [],
    mediaItems = [],
    subtitleText = '',
    subtitleUrl = '',
    source = '',
    noMediaError = '',
    markdown = '',
    binding = null,
    title = '',
  }) {
    const metadata = record.metadata || {};

    if (subtitleText) {
      return {
        ...record,
        metadata: buildTranscriptOnlyMetadata(metadata, {
          url,
          platform,
          mediaUrl,
          subtitleUrl,
          transcription: subtitleText,
          transcriptionStatus: 'success',
          transcriptionSource: source || 'subtitle',
          conversionStatus: 'success',
          markdown,
        }),
      };
    }

    const candidateMap = new Map();
    const addCandidate = (value, extra = {}) => {
      let candidateUrl = '';
      let candidateMetadata = { ...extra };
      if (typeof value === 'string') {
        candidateUrl = value;
      } else if (value && typeof value === 'object') {
        candidateUrl = value.url || value.mediaUrl || value.videoUrl || '';
        candidateMetadata = { ...value, ...extra };
      }
      const normalizedUrl = normalizeExtractedUrl(candidateUrl);
      if (!/^https?:\/\//i.test(normalizedUrl) || !isLikelyMediaUrl(normalizedUrl)) return;
      const existing = candidateMap.get(normalizedUrl) || { url: normalizedUrl };
      const decryptKey = String(
        candidateMetadata.decryptKey
        || candidateMetadata.decodeKey
        || candidateMetadata.decode_key
        || candidateMetadata.wechatChannelsDecodeKey
        || existing.decryptKey
        || existing.decodeKey
        || '',
      ).trim();
      candidateMap.set(normalizedUrl, {
        ...existing,
        ...candidateMetadata,
        url: normalizedUrl,
        decryptKey,
        decodeKey: decryptKey || existing.decodeKey || '',
      });
    };

    addCandidate(mediaUrl);
    (Array.isArray(mediaUrls) ? mediaUrls : []).forEach((item) => addCandidate(item));
    (Array.isArray(mediaItems) ? mediaItems : []).forEach((item) => addCandidate(item));
    const candidates = sortMediaUrlsForTranscription(Array.from(candidateMap.keys()))
      .map((candidateUrl) => candidateMap.get(candidateUrl))
      .filter(Boolean);

    if (!candidates.length) {
      return {
        ...record,
        metadata: buildTranscriptOnlyMetadata(metadata, {
          url,
          platform,
          mediaUrl,
          subtitleUrl,
          transcription: '',
          transcriptionStatus: 'failed',
          transcriptionError: noMediaError || '未能从链接中提取到可转写的音频或视频地址',
          transcriptionSource: source || 'media-url',
          conversionStatus: 'failed',
          markdown,
        }),
      };
    }

    let lastError = null;
    try {
      for (const candidate of candidates) {
        try {
          const candidateUrl = candidate.url;
          const candidateDecryptKey = String(candidate.decryptKey || candidate.decodeKey || '').trim();
          const useCloudForWebpage = !candidateDecryptKey && (
            metadata.transcriptionMode === 'cloud'
            || metadata.cloudTranscriptionRequested === true
          );
          const result = useCloudForWebpage
            ? await this.runCloudFallbackTranscription(candidateUrl, {
              binding,
              title: title || metadata.title || '',
              source: source || 'media-url',
              localError: 'user selected cloud transcription',
              allowCloudUrlFallback: true,
            })
            : await this.runConfiguredTranscription(candidateUrl, {
              allowCloudUrlFallback: true,
              title: metadata.title || '',
              source: source || 'media-url',
              sourceUrl: url,
              decryptKey: candidateDecryptKey,
              forceLocal: metadata.transcriptionMode === 'local',
            });
          const nextMetadata = buildTranscriptOnlyMetadata(metadata, {
            url,
            platform,
            mediaUrl: candidateUrl,
            subtitleUrl,
            transcription: result.transcription,
            transcriptionStatus: 'success',
            transcriptionSource: result.source,
            conversionStatus: 'success',
            markdown,
          });
          return {
            ...record,
            metadata: {
              ...nextMetadata,
              cloudTranscriptionProvider: result.cloudProvider || nextMetadata.cloudTranscriptionProvider || '',
              cloudTranscriptionRequestId: result.cloudRequestId || nextMetadata.cloudTranscriptionRequestId || '',
              cloudTranscriptionUsedSeconds: result.cloudUsedSeconds || nextMetadata.cloudTranscriptionUsedSeconds || 0,
              cloudTranscriptionRemainingSeconds: result.cloudRemainingSeconds || nextMetadata.cloudTranscriptionRemainingSeconds || 0,
              wechatChannelsDecodeKey: candidateDecryptKey || nextMetadata.wechatChannelsDecodeKey || '',
              wechatChannelsEncryptedMedia: Boolean(candidateDecryptKey) || Boolean(nextMetadata.wechatChannelsEncryptedMedia),
            },
          };
        } catch (candidateError) {
          lastError = candidateError;
        }
      }
      throw lastError || new Error('未能完成音视频转写');
    } catch (error) {
      if (isRetryableTranscriptionError(error)) {
        throw error;
      }
      return {
        ...record,
        metadata: buildTranscriptOnlyMetadata(metadata, {
          url,
          platform,
          mediaUrl,
          subtitleUrl,
          transcription: '',
          transcriptionStatus: 'failed',
          transcriptionError: error.message || String(error),
          transcriptionSource: source || this.settings.aiProvider || 'unknown',
          conversionStatus: 'failed',
          markdown,
        }),
      };
    }
  }

  async hydrateXiaoyuzhouTranscript(record, url, binding = null, title = '') {
    const response = await requestUrl({ url, method: 'GET', headers: getSocialRequestHeaders(url) });
    const html = response.text || '';
    const mediaUrl = extractPodcastAudioUrlFromHtml(html) || extractSocialMediaUrlFromHtml(html);
    return this.buildTranscriptRecordFromMedia(record, {
      url,
      platform: '小宇宙',
      mediaUrl,
      mediaUrls: extractSocialMediaUrlsFromHtml(html),
      source: 'audio',
      binding,
      title,
    });
  }

  async fetchBilibiliSubtitleTextFromUrls(subtitleUrls) {
    for (const subtitleUrl of subtitleUrls || []) {
      try {
        const response = await requestUrl({ url: subtitleUrl, method: 'GET', headers: getSocialRequestHeaders('https://www.bilibili.com/') });
        const transcription = parseBilibiliSubtitlePayload(response.json || response.text);
        if (transcription) {
          return {
            transcription,
            subtitleUrl,
          };
        }
      } catch (error) {
        // Try the next subtitle candidate.
      }
    }
    return {
      transcription: '',
      subtitleUrl: '',
    };
  }

  async hydrateBilibiliTranscript(record, url, binding = null, title = '') {
    const resolvedUrl = shouldResolvePlatformRedirect(url) ? await resolveRedirectUrl(url) : url;
    const response = await requestUrl({ url: resolvedUrl, method: 'GET', headers: getSocialRequestHeaders(resolvedUrl) });
    const html = response.text || '';
    let subtitleUrls = extractBilibiliSubtitleUrlsFromHtml(html);
    let bvid = extractBilibiliBvid(resolvedUrl) || extractBilibiliBvid(url) || extractBilibiliBvid(html);
    let cid = '';
    let playurlAudioUrl = '';

    if (bvid) {
      try {
        const viewResponse = await requestUrl({
          url: `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
          method: 'GET',
          headers: getSocialRequestHeaders(resolvedUrl),
        });
        cid = extractBilibiliCidFromPayload(viewResponse.json || viewResponse.text);
        if (cid && !subtitleUrls.length) {
          const playerResponse = await requestUrl({
            url: `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
            method: 'GET',
            headers: getSocialRequestHeaders(resolvedUrl),
          });
          subtitleUrls = extractBilibiliSubtitleUrlsFromHtml(JSON.stringify(playerResponse.json || tryParseJson(playerResponse.text) || {}));
        }
        if (cid) {
          const playurlResponse = await requestUrl({
            url: `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&fnval=16&fourk=1`,
            method: 'GET',
            headers: getSocialRequestHeaders(resolvedUrl),
          });
          playurlAudioUrl = extractBilibiliAudioUrlFromPlayurlPayload(playurlResponse.json || playurlResponse.text);
        }
      } catch (error) {
        // Fall back to media transcription below.
      }
    }

    const subtitle = await this.fetchBilibiliSubtitleTextFromUrls(subtitleUrls);
    if (subtitle.transcription) {
      return this.buildTranscriptRecordFromMedia(record, {
        url,
        platform: 'B站',
        subtitleText: subtitle.transcription,
        subtitleUrl: subtitle.subtitleUrl,
        source: 'bilibili-subtitle',
        binding,
        title,
      });
    }

    return this.buildTranscriptRecordFromMedia(record, {
      url,
      platform: 'B站',
      mediaUrl: playurlAudioUrl || extractBilibiliAudioUrlFromHtml(html) || extractSocialMediaUrlFromHtml(html),
      source: 'audio',
      binding,
      title,
    });
  }

  async fetchWechatChannelsFeedInfo(url) {
    const payload = extractWechatChannelsRequestPayload(url);
    if (!payload.shortUri && !payload.exportId) {
      throw new Error('无法识别视频号链接 ID');
    }

    const response = await requestUrl({
      url: WECHAT_CHANNELS_FEED_INFO_URL,
      method: 'POST',
      headers: {
        ...getSocialRequestHeaders(url),
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://channels.weixin.qq.com',
        Referer: 'https://channels.weixin.qq.com/',
      },
      body: JSON.stringify({
        baseReq: { generalToken: '' },
        ...payload,
      }),
      throw: false,
    });

    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(`视频号文案接口请求失败：HTTP ${response.status}`);
    }

    const body = response.json || tryParseJson(response.text || '') || {};
    if (Number(body.errCode || 0) !== 0) {
      throw new Error(body.errMsg || '视频号文案接口返回失败');
    }
    return normalizeWechatChannelsFeedPayload(body);
  }

  async hydrateWechatChannelsTranscript(record, url, binding = null, title = '') {
    const metadata = record.metadata || {};
    const feed = await this.fetchWechatChannelsFeedInfo(url);
    let mediaUrl = feed.videoUrl || '';
    let mediaUrls = Array.isArray(feed.mediaUrls) ? feed.mediaUrls : [];
    const mediaItems = Array.isArray(feed.mediaItems) ? feed.mediaItems : [];
    let mediaSource = mediaUrl ? 'wechat-channels-feed' : 'video';

    if (typeof this.renderSocialMediaUrls === 'function') {
      try {
        const renderedUrls = await this.renderSocialMediaUrls(buildWechatChannelsPreviewUrl(url));
        mediaUrls = sortMediaUrlsForTranscription([mediaUrl, ...mediaUrls, ...renderedUrls]);
        mediaUrl = mediaUrls[0] || '';
        if (renderedUrls && renderedUrls.length) {
          mediaSource = mediaSource === 'wechat-channels-feed'
            ? 'wechat-channels-feed-rendered'
            : 'video-rendered';
        }
      } catch (error) {
        mediaUrls = sortMediaUrlsForTranscription([mediaUrl, ...mediaUrls]);
        mediaUrl = mediaUrls[0] || '';
      }
    }
    mediaUrls = sortMediaUrlsForTranscription([mediaUrl, ...mediaUrls]);
    mediaUrl = mediaUrls[0] || '';

    if (mediaUrl) {
      const transcribedRecord = await this.buildTranscriptRecordFromMedia(record, {
        url,
        platform: '视频号',
        mediaUrl,
        mediaUrls,
        mediaItems,
        source: mediaSource,
        binding,
        title,
        noMediaError: '视频号网页端未返回可转写的视频资源',
      });
      const nextMetadata = transcribedRecord.metadata || {};
      const transcriptProperties = nextMetadata.transcriptionStatus === 'success'
        ? buildTranscriptPropertyMetadata({
          transcription: nextMetadata.transcription,
          title: metadata.title || nextMetadata.title || '视频号口播文案',
        })
        : { description: '', keywords: [], aiMetadataSource: '' };
      return {
        ...transcribedRecord,
        metadata: {
          ...nextMetadata,
          title: metadata.title || nextMetadata.title || '视频号口播文案',
          author: metadata.author || feed.author || nextMetadata.author || '',
          platform: metadata.platform || '视频号',
          contentCategory: metadata.contentCategory || '视频',
          coverUrl: feed.coverUrl || metadata.coverUrl || nextMetadata.coverUrl || '',
          dynamicExportId: feed.dynamicExportId || metadata.dynamicExportId || nextMetadata.dynamicExportId || '',
          wechatChannelsDecodeKey: feed.decodeKey || nextMetadata.wechatChannelsDecodeKey || '',
          wechatChannelsEncryptedMedia: Boolean(feed.decodeKey) || Boolean(nextMetadata.wechatChannelsEncryptedMedia),
          description: nextMetadata.description || transcriptProperties.description,
          keywords: getRecordKeywords(nextMetadata).length ? getRecordKeywords(nextMetadata) : transcriptProperties.keywords,
          aiMetadataSource: nextMetadata.aiMetadataSource || transcriptProperties.aiMetadataSource,
        },
      };
    }

    return {
      ...record,
      metadata: {
        ...buildTranscriptOnlyMetadata(metadata, {
          url,
          platform: '视频号',
          transcription: '',
          transcriptionStatus: 'failed',
          transcriptionSource: 'wechat-channels-preview',
          transcriptionError: feed.errMsg || '视频号网页端未返回可转写的视频资源，无法提取视频口播文案',
          conversionStatus: 'link_saved',
        }),
        markdown: buildWechatChannelsUnavailableMarkdown(
          url,
          feed,
          feed.errMsg || '视频号网页端未返回可转写的视频资源，无法提取视频口播文案',
        ),
        conversionStatus: 'link_saved',
        title: metadata.title || feed.title || '视频号口播文案',
        author: metadata.author || feed.author || '',
        platform: metadata.platform || '视频号',
        contentCategory: metadata.contentCategory || '视频',
        coverUrl: feed.coverUrl || metadata.coverUrl || '',
        dynamicExportId: feed.dynamicExportId || metadata.dynamicExportId || '',
        wechatChannelsDecodeKey: feed.decodeKey || metadata.wechatChannelsDecodeKey || '',
        wechatChannelsEncryptedMedia: Boolean(feed.decodeKey) || Boolean(metadata.wechatChannelsEncryptedMedia),
      },
    };
  }

  async hydrateWebpageMarkdown(record, rootDir, dateFolder, title, binding = null) {
    const metadata = record.metadata || {};
    const url = metadata.url || record.content;
    if (!url) {
      return record;
    }
    const isFeishuLink = isFeishuUrl(url);
    const feishuCloudOAuthStatus = isFeishuLink
      ? await this.getFeishuCloudOAuthStatus(binding)
      : null;
    if (!feishuCloudOAuthStatus?.connected
      && (metadata.markdown || metadata.snapshot || metadata.contentSnapshot)
      && !shouldRefreshFeishuMarkdownFromSource(url, metadata)) {
      return record;
    }

    try {
      if (isFeishuLink) {
        let openApiError = null;
        const shouldUseFeishuCloudOAuth = feishuCloudOAuthStatus && feishuCloudOAuthStatus.connected;
        if (shouldUseFeishuCloudOAuth) {
          try {
            const cloudOpenApiResult = await this.fetchFeishuCloudOAuthMarkdownFromUrl(url, binding);
            const feishuTitle = metadata.title || cloudOpenApiResult.title || '飞书文档';
            let cleanedCloudOpenApiMarkdown = replaceFeishuImageTokenPlaceholders(
              cleanMarkdownForStorage(cloudOpenApiResult.markdown, {
                dedupe: true,
                feishuTitle,
              }),
              [],
              url,
              cloudOpenApiResult.imageTmpDownloadUrls || {},
            );
            cleanedCloudOpenApiMarkdown = await this.saveMarkdownRemoteImageAssets(
              cleanedCloudOpenApiMarkdown,
              rootDir,
              dateFolder,
              feishuTitle,
            );
            return {
              ...record,
              metadata: enrichExtractedWebpageMetadata({
                ...metadata,
                title: feishuTitle,
                markdown: cleanedCloudOpenApiMarkdown,
                conversionStatus: 'success',
                conversionSource: 'feishu-cloud-oauth',
                conversionNote: [
                  `feishu-cloud-oauth blocks=${cloudOpenApiResult.blockCount || 0}`,
                  cloudOpenApiResult.imageTokenCount ? `images=${cloudOpenApiResult.imageTokenCount}` : '',
                  cloudOpenApiResult.imageDownloadError ? `image-download: ${cloudOpenApiResult.imageDownloadError}` : '',
                ].filter(Boolean).join('; '),
              }),
            };
          } catch (error) {
            openApiError = error;
          }
        }
        try {
          const rendered = await renderFeishuUrlToSimpleMarkdownWithElectron(url);
          const feishuTitle = metadata.title || rendered.title || '飞书链接';
          let cleanedRenderedMarkdown = cleanMarkdownForStorage(rendered.markdown, {
            dedupe: true,
            feishuTitle,
          });
          // 把 feishu-image:{token} 占位关联到 DOM 图片真实 src，让 saveWebpageImageAssets 能下载到本地
          cleanedRenderedMarkdown = replaceFeishuImageTokenPlaceholders(cleanedRenderedMarkdown, rendered.assets, url);
          const markdown = await this.saveWebpageImageAssets(
            cleanedRenderedMarkdown,
            rendered.assets,
            rootDir,
            dateFolder,
            title,
          );
          const openApiDiag = openApiError
            ? `\n\n<!-- feishu-openapi-error: ${String(openApiError.message || openApiError).replace(/-->/g, '-- >')} -->`
            : '';
          const diagComment = rendered.__feishuDiag ? `\n\n<!-- feishu-diag: ${rendered.__feishuDiag} -->` : '';
          return {
            ...record,
            metadata: enrichExtractedWebpageMetadata({
                ...metadata,
                title: feishuTitle,
                markdown: markdown + openApiDiag + diagComment,
                conversionStatus: 'success',
                conversionNote: openApiError ? `feishu-open-api: ${openApiError.message || openApiError}` : metadata.conversionNote,
              }),
          };
        } catch (renderError) {
          try {
            const markdown = replaceFeishuImageTokenPlaceholders(await fetchFeishuClientVarsMarkdown(url), [], url);
            return {
              ...record,
              metadata: enrichExtractedWebpageMetadata({
                ...metadata,
                title: metadata.title || '飞书链接',
                markdown,
                conversionStatus: 'success',
                conversionNote: [
                  openApiError ? `feishu-open-api: ${openApiError.message || String(openApiError)}` : '',
                  renderError.message || String(renderError),
                ].filter(Boolean).join('；'),
              }),
            };
          } catch (clientVarsError) {
            try {
              const response = await requestUrl({ url, method: 'GET' });
              const html = response.text || '';
              const markdown = extractFeishuMarkdownFromHtml(html);
              return {
                ...record,
                metadata: enrichExtractedWebpageMetadata({
                  ...metadata,
                  title: metadata.title || extractHtmlTitle(html) || '飞书链接',
                  markdown,
                  conversionStatus: 'success',
                  conversionNote: [
                    openApiError ? `feishu-open-api: ${openApiError.message || String(openApiError)}` : '',
                    renderError.message || String(renderError),
                    clientVarsError.message || String(clientVarsError),
                  ].filter(Boolean).join('；'),
                }),
              };
            } catch (staticError) {
              throw new Error([
                openApiError ? `feishu-open-api: ${openApiError.message || String(openApiError)}` : '',
                renderError.message || String(renderError),
                clientVarsError.message || String(clientVarsError),
                staticError.message || String(staticError),
              ].filter(Boolean).join('；'));
            }
          }
        }
      }

      if (isXiaoyuzhouUrl(url)) {
        return await this.hydrateXiaoyuzhouTranscript(record, url, binding, title);
      }

      if (isBilibiliUrl(url)) {
        return await this.hydrateBilibiliTranscript(record, url, binding, title);
      }

      if (isXiaohongshuUrl(url) || isDouyinUrl(url)) {
        const resolvedUrl = shouldResolvePlatformRedirect(url) ? await resolveRedirectUrl(url) : url;
        const headers = isXiaohongshuUrl(resolvedUrl)
          ? await getXiaohongshuRequestHeaders(resolvedUrl)
          : getSocialRequestHeaders(resolvedUrl);
        const response = await requestUrl({ url: resolvedUrl, method: 'GET', headers });
        const html = response.text || '';
        const hasProAdvancedAccess = isXiaohongshuUrl(url)
          ? await this.hasProFeatureAccess()
          : false;
        let mediaUrls = extractSocialMediaUrlsFromHtml(html);
        let mediaUrl = mediaUrls[0] || '';
        let hasPreciseDouyinMedia = false;
        if (isDouyinUrl(url) || isDouyinUrl(resolvedUrl)) {
          const awemeId = extractDouyinAwemeId(resolvedUrl) || extractDouyinAwemeId(url);
          for (const detailUrl of getDouyinAwemeDetailUrls(awemeId)) {
            try {
              // Douyin's rendered page can load recommendation videos; the detail API is pinned to one aweme id.
              const detailResponse = await requestUrl({ url: detailUrl, method: 'GET', headers: getSocialRequestHeaders(detailUrl) });
              const detailUrls = extractDouyinMediaUrlsFromDetailPayload(detailResponse.json || JSON.parse(detailResponse.text || '{}'));
              if (detailUrls.length) {
                mediaUrls = sortMediaUrlsForTranscription([...detailUrls, ...mediaUrls]);
                mediaUrl = mediaUrls[0] || mediaUrl;
                hasPreciseDouyinMedia = true;
                break;
              }
            } catch (detailError) {
              // Fall back to page extraction/rendering below.
            }
          }
        }
        const isUnavailableXhs = isXiaohongshuUrl(url)
          && isUnavailableXiaohongshuPage(html, resolvedUrl);
        const isVideoIntent = metadata.webpageMediaType === 'audio_video'
          || isDouyinUrl(url)
          || isDouyinUrl(resolvedUrl)
          || /[?&]type=video\b/i.test(resolvedUrl)
          || /\/video\//i.test(resolvedUrl);
        const shouldIncludeXiaohongshuComments = hasProAdvancedAccess
          && this.settings.xiaohongshuCommentsEnabled !== false;
        let extractedXiaohongshu = null;
        if (isXiaohongshuUrl(url)) {
          const staticXiaohongshuComments = shouldIncludeXiaohongshuComments
            ? extractSocialCommentsFromHtml(html, 50)
            : [];
          extractedXiaohongshu = extractXiaohongshuMarkdownFromHtml(html, resolvedUrl, metadata.shareText || record.content || '', {
            includeComments: false,
          });
          if (!mediaUrl && shouldProbeXiaohongshuMediaFromGenericLanding(extractedXiaohongshu, html, resolvedUrl)) {
            try {
              mediaUrls = sortMediaUrlsForTranscription([
                ...mediaUrls,
                ...(await this.renderSocialMediaUrls(resolvedUrl)),
              ]);
              mediaUrl = mediaUrls[0] || '';
            } catch (renderError) {
              // Keep the generic landing-page fallback when hidden rendering is unavailable.
            }
          }
          if (shouldIncludeXiaohongshuComments) {
            try {
              const renderedXiaohongshuPage = await renderXiaohongshuPageWithElectron(resolvedUrl);
              const renderedXiaohongshuComments = renderedXiaohongshuPage && Array.isArray(renderedXiaohongshuPage.comments)
                ? renderedXiaohongshuPage.comments
                : [];
              const mergedXiaohongshuComments = mergeSocialComments([staticXiaohongshuComments, renderedXiaohongshuComments], 50);
              if (mergedXiaohongshuComments.length) {
                extractedXiaohongshu = {
                  ...extractedXiaohongshu,
                  comments: mergedXiaohongshuComments,
                  markdown: appendSocialCommentsToMarkdown(extractedXiaohongshu.markdown, mergedXiaohongshuComments),
                };
              }
            } catch (xiaohongshuRenderError) {
              if (staticXiaohongshuComments.length) {
                extractedXiaohongshu = {
                  ...extractedXiaohongshu,
                  comments: staticXiaohongshuComments,
                  markdown: appendSocialCommentsToMarkdown(extractedXiaohongshu.markdown, staticXiaohongshuComments),
                };
              }
            }
          } else if (staticXiaohongshuComments.length) {
            extractedXiaohongshu = {
              ...extractedXiaohongshu,
              comments: staticXiaohongshuComments,
              markdown: appendSocialCommentsToMarkdown(extractedXiaohongshu.markdown, staticXiaohongshuComments),
            };
          }
          if (hasProAdvancedAccess) {
            extractedXiaohongshu = await this.enrichXiaohongshuExtractionWithOcr(extractedXiaohongshu, {
              pageUrl: resolvedUrl,
              binding,
            });
          }
          if (hasReadableXiaohongshuGraphicContent(extractedXiaohongshu, html, resolvedUrl) && !extractedXiaohongshu.videoUrl && !mediaUrl) {
            return {
              ...record,
              metadata: {
                ...metadata,
                title: metadata.title || extractedXiaohongshu.title || getWebpageSourcePrefix(url),
                author: metadata.author || extractedXiaohongshu.author || '',
                extractedDescription: metadata.extractedDescription || extractedXiaohongshu.description || '',
                extractedKeywords: metadata.extractedKeywords || extractedXiaohongshu.tags || [],
                platform: metadata.platform || '小红书',
                contentCategory: '图文',
                markdown: extractedXiaohongshu.markdown,
                imageUrls: extractedXiaohongshu.imageUrls || [],
                xiaohongshuOcrTextHeavy: Boolean(extractedXiaohongshu.ocrTextHeavy),
                xiaohongshuOcrError: extractedXiaohongshu.ocrError || '',
                videoUrl: '',
                conversionStatus: 'success',
              },
            };
          }
        }
        if (!hasPreciseDouyinMedia && isVideoIntent && typeof this.renderSocialMediaUrls === 'function') {
          try {
            mediaUrls = sortMediaUrlsForTranscription([...mediaUrls, ...(await this.renderSocialMediaUrls(resolvedUrl))]);
            mediaUrl = mediaUrls[0] || mediaUrl;
          } catch (renderError) {
            mediaUrl = mediaUrl || '';
          }
        } else if (!hasPreciseDouyinMedia && !mediaUrl && isVideoIntent && typeof this.renderSocialMediaUrl === 'function') {
          try {
            mediaUrl = await this.renderSocialMediaUrl(resolvedUrl);
            mediaUrls = sortMediaUrlsForTranscription([...mediaUrls, mediaUrl]);
          } catch (renderError) {
            mediaUrl = '';
          }
        }
        if (mediaUrl) {
          return await this.buildTranscriptRecordFromMedia(record, {
            url,
            platform: isDouyinUrl(url) || isDouyinUrl(resolvedUrl) ? '抖音' : '小红书',
            mediaUrl,
            mediaUrls,
            source: 'video',
            markdown: isXiaohongshuUrl(url)
              && extractedXiaohongshu
              && Array.isArray(extractedXiaohongshu.comments)
              && extractedXiaohongshu.comments.length
              ? extractedXiaohongshu.markdown
              : '',
            binding,
            title,
            noMediaError: isUnavailableXhs
              ? '小红书网页端未返回可转写的视频资源。这通常是该分享链接在电脑网页端不可访问、笔记失效或需要小红书登录环境。请让用户重新复制小红书链接；如果仍失败，建议从手机相册或文件导入视频。'
              : '',
          });
        }
        if (isVideoIntent && isXiaohongshuUrl(url)) {
          const noMediaError = isUnavailableXhs
            ? '小红书网页端未返回可转写的视频资源。这通常是该分享链接在电脑网页端不可访问、笔记失效或需要小红书登录环境。请让用户重新复制小红书链接；如果仍失败，建议从手机相册或文件导入视频。'
            : '未能从链接中提取到可转写的音频或视频地址';
          return {
            ...record,
            metadata: {
              ...metadata,
              title: metadata.title || extractHtmlTitle(html) || '小红书链接',
              url,
              markdown: buildXiaohongshuFallbackMarkdown(url, noMediaError),
              platform: metadata.platform || '小红书',
              contentCategory: metadata.contentCategory || '视频',
              transcriptionStatus: 'failed',
              transcriptionError: noMediaError,
              transcriptionSource: 'video',
              conversionStatus: 'link_saved',
            },
          };
        }

        const extracted = extractedXiaohongshu || extractXiaohongshuMarkdownFromHtml(html, resolvedUrl, metadata.shareText || record.content || '', {
          includeComments: shouldIncludeXiaohongshuComments,
        });
        return {
          ...record,
          metadata: {
            ...metadata,
            title: metadata.title || extracted.title || getWebpageSourcePrefix(url),
            author: metadata.author || extracted.author || '',
            extractedDescription: metadata.extractedDescription || extracted.description || '',
            extractedKeywords: metadata.extractedKeywords || extracted.tags || [],
            platform: metadata.platform || '小红书',
            contentCategory: metadata.contentCategory || (extracted.videoUrl || metadata.webpageMediaType === 'audio_video' ? '视频' : '图文'),
            markdown: extracted.markdown,
            imageUrls: extracted.imageUrls || [],
            videoUrl: extracted.videoUrl || '',
            conversionStatus: 'success',
          },
        };
      }

      // For WeChat articles, try Electron rendering first if logged in (enables comment extraction).
      if (isWechatArticleUrl(url)) {
        const wechatLoggedIn = await checkWechatLoginStatus();
        if (wechatLoggedIn) {
          try {
            const rendered = await renderUrlToMarkdownWithElectron(url);
            const markdown = await this.saveWebpageImageAssets(
              rendered.markdown,
              rendered.assets,
              rootDir,
              dateFolder,
              title,
            );
            return {
              ...record,
              metadata: {
                ...metadata,
                title: metadata.title || rendered.title || '',
                markdown,
                conversionStatus: 'success',
              },
            };
          } catch (electronError) {
            // Electron rendering failed; fall through to the standard request path.
          }
        }
      }

      let html;
      let usedFallback = false;
      try {
        const response = await requestUrl({ url, method: 'GET' });
        html = response.text || '';
      } catch (requestError) {
        // Obsidian requestUrl can fail on some networks; fall back to Node.js HTTP.
        try {
          html = await downloadTextViaNode(url);
          usedFallback = true;
        } catch (fallbackError) {
          throw new Error(`网页抓取失败（Obsidian 请求 + Node.js 降级均失败）：${requestError.message || requestError}；降级错误：${fallbackError.message || fallbackError}`);
        }
      }
      if (isWechatArticleUrl(url) && (isWechatCaptchaUrl(url) || isWechatCaptchaHtml(html))) {
        const targetUrl = extractWechatCaptchaTargetUrl(url);
        return {
          ...record,
          metadata: {
            ...metadata,
            title: metadata.title || '公众号文章需要验证',
            url: targetUrl || metadata.url || url,
            originalUrl: metadata.originalUrl || url,
            markdown: buildWechatCaptchaMarkdown(url, html),
            conversionStatus: 'wechat_captcha',
            conversionError: '微信返回公众号文章安全验证页',
            conversionNote: usedFallback ? '已通过备用通道抓取' : '',
          },
        };
      }
      let markdown;
      try {
        markdown = htmlToMarkdown(html);
      } catch (convertError) {
        throw new Error(`HTML 转 Markdown 失败：${convertError.message || convertError}`);
      }
      const pageTitle = metadata.title || extractHtmlTitle(html);
      const pageMeta = extractWebpageMetadataFromHtml(html, url);
      return {
        ...record,
        metadata: {
          ...metadata,
          title: pageTitle || metadata.title || '',
          author: metadata.author || pageMeta.author || '',
          description: metadata.description || pageMeta.description || '',
          keywords: metadata.keywords || pageMeta.keywords || [],
          platform: metadata.platform || pageMeta.platform || '',
          contentCategory: metadata.contentCategory || pageMeta.contentCategory || '',
          markdown,
          conversionStatus: 'success',
          conversionNote: usedFallback ? '已通过备用通道抓取' : '',
        },
      };
    } catch (error) {
      if (isRetryableTranscriptionError(error)) {
        throw error;
      }
      if (isXiaoyuzhouUrl(url) || isBilibiliUrl(url) || isDouyinUrl(url)) {
        return {
          ...record,
          metadata: buildTranscriptOnlyMetadata(metadata, {
            url,
            platform: getWebpageSourcePrefix(url),
            transcription: '',
            transcriptionStatus: 'failed',
            transcriptionError: error.message || String(error),
            transcriptionSource: 'platform-fetch',
            conversionStatus: 'failed',
          }),
        };
      }
      if (isFeishuUrl(url)) {
        return {
          ...record,
          metadata: {
            ...metadata,
            title: metadata.title || '飞书链接',
            markdown: [
              '飞书链接已保存。',
              '',
              `原始链接：${url}`,
              '',
              `> 飞书正文提取失败：${error.message || String(error)}`,
              '> 如果该链接在浏览器能无登录打开，可以后续接入浏览器剪藏助手把页面 DOM 直接转成 Markdown。',
            ].join('\n'),
            conversionStatus: 'link_saved',
            conversionError: error.message || String(error),
          },
        };
      }
      return {
        ...record,
        metadata: {
          ...metadata,
          conversionStatus: 'failed',
          conversionError: error.message || String(error),
        },
      };
    }
  }

  async nextRecordTitle(dayDir, record, bindingLabel = '') {
    const label = sanitizeNoteTitlePart(bindingLabel, '');
    const baseTitle = buildRecordTitleBase(record);
    return this.nextTitle(dayDir, label ? `${label}-${baseTitle}` : baseTitle);
  }

  async findExistingRecordNotePath(record) {
    const normalizedRecordId = String(getRecordId(record) || '').trim();
    const metadata = (record && record.metadata) || {};
    const normalizedRecordUrl = normalizeRecordUrlForCompare(getRecordUrl(record || {}, metadata));
    if ((!normalizedRecordId && !normalizedRecordUrl) || !this.app || !this.app.vault || typeof this.app.vault.getMarkdownFiles !== 'function') {
      return '';
    }

    const inboxDir = normalizeVaultPath(this.settings.inboxDir);
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const filePath = normalizeVaultPath(file && file.path);
      if (!filePath || (inboxDir && filePath !== inboxDir && !filePath.startsWith(`${inboxDir}/`))) {
        continue;
      }
      try {
        let markdown = '';
        if (typeof this.app.vault.cachedRead === 'function') {
          markdown = await this.app.vault.cachedRead(file);
        } else if (this.app.vault.adapter && typeof this.app.vault.adapter.read === 'function') {
          markdown = await this.app.vault.adapter.read(file.path);
        }
        if (
          (normalizedRecordId && hasRecordIdInFrontmatter(markdown, normalizedRecordId))
          || (normalizedRecordUrl && hasRecordUrlInFrontmatter(markdown, normalizedRecordUrl))
        ) {
          if (normalizedRecordUrl && isFeishuUrl(normalizedRecordUrl) && shouldRefreshFeishuMarkdownFromSource(normalizedRecordUrl, { markdown })) {
            continue;
          }
          return file.path || filePath;
        }
      } catch (error) {
        // Ignore unreadable notes; sync should continue and surface real write/mark errors.
      }
    }
    return '';
  }

  async writeRecord(record, syncedAt, binding = null, shouldPrefixTitle = false, progress = {}) {
    const dateFolder = getDateFolderName(record.createdAt);
    const rootDir = this.settings.inboxDir;
    const noteDir = this.settings.noteSaveMode === 'root' ? rootDir : `${rootDir}/${dateFolder}`;
    const bindingLabel = shouldPrefixTitle && binding ? binding.label : '';
    const progressTitle = buildRecordTitleBase(record);
    this.showSyncProgress({ ...progress, stage: 'processing', title: progressTitle });

    await this.ensureFolder(rootDir);
    await this.ensureFolder(noteDir);

    let title = await this.nextRecordTitle(noteDir, record, bindingLabel);
    let recordForMarkdown = record;
    const recordType = String(record.type || '').toLowerCase();
    const linkAsWebpage = recordType === 'link' && shouldHydrateLinkAsWebpage((record.metadata && record.metadata.url) || record.content || '');
    if (recordType === 'voice') {
      recordForMarkdown = await this.writeVoiceAttachment(record, rootDir, dateFolder, title, binding, progress);
    } else if (recordType === 'file') {
      recordForMarkdown = await this.writeFileAttachment(record, rootDir, dateFolder, title, binding, progress);
    } else if (recordType === 'webpage' || linkAsWebpage) {
      this.showSyncProgress({ ...progress, stage: 'processing', title: progressTitle });
      recordForMarkdown = await this.hydrateWebpageMarkdown(
        linkAsWebpage
          ? {
            ...record,
            type: 'webpage',
            metadata: {
              ...(record.metadata || {}),
              url: (record.metadata && record.metadata.url) || record.content || '',
              conversionStatus: (record.metadata && record.metadata.conversionStatus) || 'pending',
            },
          }
          : record,
        rootDir,
        dateFolder,
        title,
        binding,
      );
      title = await this.nextRecordTitle(noteDir, recordForMarkdown, bindingLabel);
    }
    if (isAudioVideoTranscriptionIncompleteRecord(recordForMarkdown)) {
      const metadata = recordForMarkdown.metadata || {};
      const status = metadata.transcriptionStatus || 'pending';
      throw createRetryableTranscriptionError(metadata.transcriptionError || `audio/video transcription is ${status}`);
    }
    recordForMarkdown = await this.enrichRecordMetadataWithAi(recordForMarkdown, binding, {
      requireMetadata: shouldRequireAiMetadataForTranscript(recordForMarkdown),
    });
    const markdown = buildMarkdownForRecord({
      record: recordForMarkdown,
      title,
      syncedAt,
      propertyFields: this.settings.notePropertyFields,
    });
    const filePath = `${noteDir}/${title}.md`;
    this.showSyncProgress({ ...progress, stage: 'writing', title });
    await this.app.vault.adapter.write(filePath, markdown);

    return {
      recordId: getRecordId(record),
      filePath,
      title,
      conversionWarning: getRecordConversionWarning(recordForMarkdown),
    };
  }

  async syncBinding(binding, shouldPrefixTitle) {
    const bindingLabel = binding && (binding.label || binding.token) ? (binding.label || binding.token) : '';
    this.showSyncProgress({ bindingLabel, stage: 'fetching' });
    const payload = await this.requestJson('/records?status=pending', 'GET', {}, binding);
    const records = payload.data || [];
    const written = [];
    const failed = [];
    const skipped = [];
    const conversionWarnings = [];
    const syncedAt = new Date().toISOString();
    if (!records.length) {
      this.showSyncProgress({ bindingLabel, stage: 'empty' });
    }

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const progress = {
        bindingLabel,
        current: index + 1,
        total: records.length,
      };
      if (isCloudTranscriptionWaitingRecord(record)) {
        skipped.push({
          recordId: getRecordId(record),
          reason: 'cloud-transcription-processing',
        });
        this.showSyncProgress({ ...progress, stage: 'processing', title: `${buildRecordTitleBase(record)} 云端转写中` });
        continue;
      }
      try {
        const recordId = getRecordId(record);
        const existingFilePath = await this.findExistingRecordNotePath(record);
        if (existingFilePath) {
          skipped.push({
            recordId,
            reason: 'already-synced-local',
            filePath: existingFilePath,
          });
          this.showSyncProgress({ ...progress, stage: 'marking', title: buildRecordTitleBase(record) });
          try {
            await this.requestJson(`/records/${encodeURIComponent(recordId)}/synced`, 'POST', {}, binding);
          } catch (markError) {
            if (!isRecordNotFoundError(markError)) throw markError;
          }
          continue;
        }
        const item = await this.writeRecord(record, syncedAt, binding, shouldPrefixTitle, progress);
        written.push(item);
        if (item.conversionWarning) {
          conversionWarnings.push(item.conversionWarning);
        }
        this.showSyncProgress({ ...progress, stage: 'marking', title: item.title });
        try {
          await this.requestJson(`/records/${encodeURIComponent(item.recordId)}/synced`, 'POST', {}, binding);
        } catch (markError) {
          if (!isRecordNotFoundError(markError)) throw markError;
        }
      } catch (error) {
        const message = error.message || String(error);
        let failedTitle = '';
        try {
          failedTitle = buildRecordTitleBase(record);
        } catch (titleError) {
          failedTitle = getRecordId(record) || String(record && record.type ? record.type : 'unknown');
        }
        this.lastSyncDiagnostic = {
          ...progress,
          status: 'failed',
          stage: progress.stage || 'processing',
          title: failedTitle,
          recordId: getRecordId(record),
          message: '单条内容同步失败',
          error: message,
          time: new Date().toISOString(),
        };
        writeSyncDiagnosticLog(this.lastSyncDiagnostic);
        failed.push({
          recordId: getRecordId(record),
          message,
        });
      }
    }

    return { written, failed, skipped, conversionWarnings };
  }

  async syncInbox(showNotice = true) {
    const errors = validateSettings(this.settings);
    if (errors.length) {
      new Notice(errors[0]);
      return;
    }

    try {
      const bindings = this.getActiveBindings();
      const shouldPrefixTitle = bindings.length > 1;
      const written = [];
      const failed = [];
      const skipped = [];
      const conversionWarnings = [];
      this.syncProgressNotice = null;
      this.showSyncProgress({ stage: 'fetching' });

      for (const binding of bindings) {
        try {
          const result = await this.syncBinding(binding, shouldPrefixTitle);
          written.push(...result.written);
          failed.push(...result.failed);
          if (result.skipped && result.skipped.length) {
            skipped.push(...result.skipped);
          }
          if (result.conversionWarnings && result.conversionWarnings.length) {
            conversionWarnings.push(...result.conversionWarnings);
          }
        } catch (error) {
          const message = error.message || String(error);
          failed.push({
            recordId: binding.label || binding.token,
            message: `${binding.label || binding.token}：${message}`,
          });
        }
      }

      let finalMessage = buildSyncNotice(written.length);
      if (skipped.length) {
        finalMessage += buildSkippedSyncNotice(skipped);
      }
      if (showNotice || written.length) {
        if (conversionWarnings.length) {
          finalMessage += `，${conversionWarnings.length} 条未提取到正文，打开文件查看详情`;
        }
        if (failed.length) {
          finalMessage += `，${failed.length} 条失败：${failed[0].message}`;
        }
        new Notice(finalMessage);
      }
      this.lastSyncDiagnostic = {
        status: failed.length ? 'failed' : 'success',
        stage: 'finished',
        current: written.length,
        total: written.length + failed.length + skipped.length,
        message: finalMessage,
        error: failed.length ? failed.map((item) => `${item.recordId}: ${item.message}`).join('\n') : '',
        time: new Date().toISOString(),
      };
      writeSyncDiagnosticLog(this.lastSyncDiagnostic);
      this.clearSyncProgressNotice();
    } catch (error) {
      this.lastSyncDiagnostic = {
        status: 'failed',
        stage: 'syncInbox',
        message: '同步失败',
        error: error.message || String(error),
        time: new Date().toISOString(),
      };
      writeSyncDiagnosticLog(this.lastSyncDiagnostic);
      this.clearSyncProgressNotice();
      new Notice(`同步失败：${error.message || error}`);
    }
  }
}

class WechatInboxSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  addPasswordSetting(containerEl, { name, desc, placeholder, value, onChange }) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder(placeholder)
          .setValue(value)
          .onChange(onChange);
      });
  }

  renderFeishuSettings(containerEl) {
    const feishuPanel = containerEl.createEl('details', { cls: 'wechat-inbox-sync-advanced-panel' });
    feishuPanel.open = true;
    feishuPanel.createEl('summary', { text: '连接飞书文档' });
    const feishuOAuthStatus = this.plugin.settings.feishuOAuthStatus || {};
    feishuPanel.createDiv({
      text: feishuOAuthStatus.connected
        ? `已连接飞书官方 API；token 有效期至 ${feishuOAuthStatus.expiresAt || '未知'}。同步飞书链接时会优先走官方授权通道。`
        : '未连接飞书官方 API 时仍会使用旧解析方式转存飞书链接，但可能出现内容不全、图片缺失或结构不稳定；建议按教程连接官方 API。',
      cls: 'wechat-inbox-sync-muted',
    });

    new Setting(feishuPanel)
      .setName('飞书官方 API 连接教程')
      .setDesc(`按教程创建飞书自建应用、配置权限和回调地址：${FEISHU_OFFICIAL_API_TUTORIAL_URL}`)
      .addButton((button) => button
        .setButtonText('打开教程')
        .onClick(async () => {
          const opened = await openExternalUrl(FEISHU_OFFICIAL_API_TUTORIAL_URL);
          if (!opened) {
            new Notice(`请复制链接到浏览器打开：${FEISHU_OFFICIAL_API_TUTORIAL_URL}`);
          }
        }));

    const feishuCallbackUrl = `${trimTrailingSlash(FEISHU_OAUTH_SYNC_API_BASE)}/feishu/oauth/callback`;
    new Setting(feishuPanel)
      .setName('飞书回调地址')
      .setDesc(`在飞书自建应用后台配置这个重定向 URL：${feishuCallbackUrl}`)
      .addButton((button) => button
        .setButtonText('复制')
        .onClick(async () => {
          const copied = await this.plugin.copyTextToClipboard(feishuCallbackUrl);
          new Notice(copied ? '飞书回调地址已复制' : `请手动复制：${feishuCallbackUrl}`);
        }));

    new Setting(feishuPanel)
      .setName('飞书 App ID')
      .setDesc('填写你自己在飞书开放平台创建的企业自建应用 App ID。')
      .addText((text) => text
        .setPlaceholder('cli_xxx')
        .setValue(this.plugin.settings.feishuAppId || '')
        .onChange(async (value) => {
          await this.plugin.saveSettings({
            ...this.plugin.settings,
            feishuAppId: String(value || '').trim(),
            feishuOAuthStatus: null,
          });
        }));

    new Setting(feishuPanel)
      .setName('飞书 App Secret')
      .setDesc('只保存在当前 Obsidian 插件本地；授权和提取时会通过 HTTPS 临时发送给云端使用。')
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('App Secret')
          .setValue(this.plugin.settings.feishuAppSecret || '')
          .onChange(async (value) => {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              feishuAppSecret: String(value || '').trim(),
              feishuOAuthStatus: null,
            });
          });
      });

    new Setting(feishuPanel)
      .setName(feishuOAuthStatus.connected ? '更换飞书账号' : '连接飞书官方 API')
      .setDesc(feishuOAuthStatus.connected
        ? '需要切换飞书账号或重新授权时，点击后在浏览器完成授权。'
        : '连接后同步飞书链接会优先走官方 API，文字、图片和标题结构更稳定。')
      .addButton((button) => button
        .setButtonText(feishuOAuthStatus.connected ? '重新连接' : '连接飞书')
        .setCta()
        .onClick(async () => {
          try {
            await this.plugin.connectFeishuCloudOAuth();
            new Notice('已打开飞书授权页，授权完成后请回到 Obsidian 点击“刷新状态”。');
          } catch (error) {
            new Notice(`打开飞书授权失败：${error.message || error}`);
          }
        }))
      .addButton((button) => button
        .setButtonText('刷新状态')
        .onClick(async () => {
          try {
            const status = await this.plugin.refreshFeishuCloudOAuthStatus();
            new Notice(status && status.connected
              ? '飞书连接状态已刷新：已连接'
              : '飞书连接状态已刷新：未连接或已过期');
            this.display();
          } catch (error) {
            new Notice(`刷新飞书授权状态失败：${error.message || error}`);
          }
        }));
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Obsidian 内容同步助手' });

    containerEl.createEl('h3', {
      text: '使用教程',
      cls: 'wechat-inbox-sync-section-heading',
    });

    new Setting(containerEl)
      .setName('小程序名字：Obsidian 内容同步助手')
      .setDesc('打开微信后搜索这个小程序，进入「绑定 Obsidian」页面复制绑定码。');

    new Setting(containerEl)
      .setName('微信小程序绑定教程')
      .setDesc(`插件安装、绑定码填写和常见问题。小程序名字：Obsidian 内容同步助手。教程链接：${FEISHU_TUTORIAL_URL}`)
      .addButton((button) => button
        .setButtonText('打开教程')
        .onClick(async () => {
          const opened = await openExternalUrl(FEISHU_TUTORIAL_URL);
          if (!opened) {
            new Notice(`请复制链接到浏览器打开：${FEISHU_TUTORIAL_URL}`);
          }
        }));

    containerEl.createEl('h3', {
      text: '绑定小程序',
      cls: 'wechat-inbox-sync-section-heading',
    });

    const bindings = normalizeBindings(this.plugin.settings);
    const primaryBinding = bindings[0] || null;
    const extraBindings = bindings.slice(1);
    const renderBindingSetting = (parentEl, binding, indexLabel) => {
      const isUnbound = binding.status === 'unbound';
      const statusDesc = isUnbound
        ? `已解除/已失效${binding.lastError ? `：${binding.lastError}` : ''}`
        : (binding.enabled === false ? '已暂停同步' : '同步时会拉取这个微信里的收集内容');
      new Setting(parentEl)
        .setName(`${binding.label || indexLabel}：${binding.token}`)
        .setDesc(statusDesc)
        .addText((text) => text
          .setPlaceholder(indexLabel)
          .setValue(binding.label || '')
          .onChange(async (value) => {
            const nextBindings = normalizeBindings(this.plugin.settings).map((item) => (
              item.token === binding.token ? { ...item, label: value } : item
            ));
            await this.plugin.saveSettings({ ...this.plugin.settings, bindings: nextBindings });
          }))
        .addToggle((toggle) => toggle
          .setValue(binding.enabled !== false)
          .onChange(async (value) => {
            if (isUnbound) return;
            const nextBindings = normalizeBindings(this.plugin.settings).map((item) => (
              item.token === binding.token ? { ...item, enabled: value, status: value ? 'bound' : 'paused' } : item
            ));
            await this.plugin.saveSettings({ ...this.plugin.settings, bindings: nextBindings });
            this.display();
          }))
        .addButton((button) => {
          button
            .setButtonText(isUnbound ? '已解除' : '解除本机')
            .onClick(async () => {
              if (isUnbound) return;
              await this.plugin.unbindBinding(binding.token);
              this.display();
            });
          if (isUnbound) {
            button.setDisabled(true);
          }
        });
    };
    new Setting(containerEl)
      .setName('输入绑定码')
      .setDesc(primaryBinding
        ? '绑定成功。基础绑定区只保留 1 个小程序绑定码；更多绑定请到下方 Pro 高级功能里增加设备。'
        : '基础绑定区只保留 1 个小程序绑定码。打开微信小程序【Obsidian 内容同步助手】的「绑定 Obsidian」页面，复制小程序绑定码后粘贴到这里。')
      .addText((text) => text
        .setPlaceholder('例如 ABC-123')
        .setValue(primaryBinding ? primaryBinding.token : (this.plugin.settings.pendingBindCode || ''))
        .setDisabled(Boolean(primaryBinding))
        .onChange(async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, pendingBindCode: value });
        }))
      .addButton((button) => {
        button
          .setButtonText(primaryBinding ? '绑定成功' : '立即绑定')
          .setCta()
          .onClick(async () => {
            if (primaryBinding) return;
            await this.plugin.bindCurrentCode();
            this.display();
          });
        if (primaryBinding) {
          button.setDisabled(true);
        }
      })
      .addButton((button) => {
        button
          .setButtonText('解除本机')
          .onClick(async () => {
            if (!primaryBinding) return;
            await this.plugin.unbindBinding(primaryBinding.token);
            this.display();
          });
        if (!primaryBinding) button.setDisabled(true);
      });

    new Setting(containerEl)
      .setName('保存根目录')
      .setDesc('同步笔记写入的位置；可选择是否按日期再创建子目录。')
      .addText((text) => text
        .setPlaceholder('临时收集')
        .setValue(this.plugin.settings.inboxDir)
        .onChange(async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, inboxDir: value });
        }));

    new Setting(containerEl)
      .setName('笔记保存方式')
      .setDesc('默认按日期分类；如果想所有文章都直接进入上面的目录，选择“直接保存到根目录”。')
      .addDropdown((dropdown) => {
        Object.entries(NOTE_SAVE_MODES).forEach(([value, label]) => {
          dropdown.addOption(value, label);
        });
        dropdown
          .setValue(this.plugin.settings.noteSaveMode || DEFAULT_SETTINGS.noteSaveMode)
          .onChange(async (value) => {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              noteSaveMode: normalizeNoteSaveMode(value),
            });
            this.display();
          });
      });

    new Setting(containerEl)
      .setName('立即同步')
      .setDesc('手动拉取云端收集箱，并写入当前 vault。')
      .addButton((button) => button
        .setButtonText('同步')
        .setCta()
        .onClick(() => this.plugin.syncInbox()));

    new Setting(containerEl)
      .setName('同步/安装失败诊断')
      .setDesc('同步失败、转写失败、下载卡住时，点这里复制诊断信息发给开发者张张（微信：heyhmjx）。里面包含最近同步阶段、转写日志和安装日志。')
      .addButton((button) => button
        .setButtonText('复制诊断信息')
        .onClick(async () => {
          try {
            await this.plugin.copySyncDiagnosticText();
            new Notice('诊断信息已复制');
          } catch (error) {
            new Notice(`复制诊断信息失败：${error.message || error}`);
          }
        }));

    containerEl.createEl('h3', {
      text: '登录设置',
      cls: 'wechat-inbox-sync-section-heading',
    });
    this.renderFeishuSettings(containerEl);

    containerEl.createDiv({ cls: 'wechat-inbox-sync-section-spacer' });
    containerEl.createEl('h3', {
      text: 'Pro 高级功能',
      cls: 'wechat-inbox-sync-section-heading',
    });

    const proStatusText = buildLocalTranscriptionEntitlementText(this.plugin.settings.localTranscriptionEntitlementStatus);
    const proPanel = containerEl.createEl('details', { cls: 'wechat-inbox-sync-advanced-panel' });
    proPanel.open = true;
    proPanel.createEl('summary', { text: 'Pro 状态' });
    proPanel.createDiv({
      text: `插件会通过已绑定的小程序绑定码自动识别 Pro 权限；开通 Pro 后点击刷新即可更新有效期和本地组件状态。${proStatusText}`,
      cls: 'wechat-inbox-sync-muted',
    });
    new Setting(proPanel)
      .setName('刷新 Pro 权限')
      .setDesc(this.plugin.settings.pendingRedeemCode
        ? `兑换码：${this.plugin.settings.pendingRedeemCode}`
        : '兑换码会在成功识别 Pro 后自动显示；普通使用只需要绑定小程序并开通 Pro。')
      .addButton((button) => button
        .setButtonText('刷新权限')
        .setCta()
        .onClick(async () => {
          try {
            const status = await this.plugin.refreshProAndMaybePromptLocalComponentInstall({
              reason: 'manual-refresh',
              force: true,
            });
            if (status.hasAccess) {
              new Notice(`Pro 权限有效${status.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : ''}`);
            } else if (status.status === 'missing_redeem_code') {
              new Notice('未识别到 Pro，请确认已绑定小程序并在小程序里开通 Pro。');
            } else {
              new Notice(status.message || 'Pro 未开通或已过期，请在小程序开通/续费后刷新。');
            }
            this.display();
          } catch (error) {
            new Notice(`权限查询失败：${error.message || error}`);
          }
        }));

    proPanel.createDiv({
      text: 'AI 简介与关键词自动生成：已默认开启；小红书图文 OCR：已默认开启。以上能力会在 Pro 权限有效时自动执行，不需要额外打开开关。',
      cls: 'wechat-inbox-sync-muted',
    });
    const proComponentReadiness = this.plugin.getLocalTranscriptionComponentReadiness();
    const proComponentStatusText = this.plugin.localComponentInstallPromise
      ? '准备中'
      : (proComponentReadiness.ready
        ? '已安装'
        : `需修复：${proComponentReadiness.missingComponents.join('、')}`);
    proPanel.createDiv({
      text: `本地转写组件：${proComponentStatusText}；当前系统：${proComponentReadiness.platformName || '自动识别'}`,
      cls: 'wechat-inbox-sync-muted',
    });

    const extraBindingsPanel = containerEl.createEl('details', { cls: 'wechat-inbox-sync-advanced-panel' });
    extraBindingsPanel.createEl('summary', { text: '额外绑定设备' });
    extraBindingsPanel.createDiv({
      text: 'Pro 功能。免费版只保留 1 个基础绑定码；Pro 有效期内可以继续绑定第 2、3 个小程序绑定码。',
      cls: 'wechat-inbox-sync-muted',
    });
    extraBindings.forEach((binding, index) => {
      renderBindingSetting(extraBindingsPanel, binding, `额外绑定微信 ${index + 2}`);
    });
    new Setting(extraBindingsPanel)
      .setName('绑定额外设备')
      .setDesc(bindings.length >= MAX_PLUGIN_BINDINGS
        ? `已达到上限：最多绑定 ${MAX_PLUGIN_BINDINGS} 个小程序码。`
        : '先确认 Pro 仍在有效期内，再把新的小程序绑定码绑定到当前插件。')
      .addText((text) => text
        .setPlaceholder('例如 ABC-123')
        .setValue(this.plugin.settings.pendingBindCode || '')
        .setDisabled(bindings.length >= MAX_PLUGIN_BINDINGS)
        .onChange(async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, pendingBindCode: value });
        }))
      .addButton((button) => {
        button
          .setButtonText('绑定额外设备')
          .onClick(async () => {
            try {
              await this.plugin.ensureProFeatureAccess('额外绑定设备');
              await this.plugin.bindCurrentCode();
              this.display();
            } catch (error) {
              new Notice(`绑定额外设备失败：${error.message || error}`);
            }
          });
        if (bindings.length >= MAX_PLUGIN_BINDINGS) {
          button.setDisabled(true);
        }
      });

    const socialPanel = containerEl.createEl('details', { cls: 'wechat-inbox-sync-advanced-panel' });
    socialPanel.createEl('summary', { text: '登录小红书评论区' });
    socialPanel.createDiv({
      text: 'Pro 功能。同步小红书图文时保留可解析到的评论区内容；如果评论区提取失败，请先登录小红书。',
      cls: 'wechat-inbox-sync-muted',
    });
    const xiaohongshuLoginBtn = new Setting(socialPanel)
      .setName('登录小红书')
      .setDesc('小红书评论区可能需要网页登录状态；登录后插件会复用该状态提取评论区。')
      .addButton((button) => button
        .setButtonText('打开小红书登录')
        .onClick(async () => {
          xiaohongshuLoginBtn.setDesc('正在打开小红书登录窗口...');
          await this.plugin.loginXiaohongshu();
          this.display();
        }))
      .addButton((button) => button
        .setButtonText('检测登录状态')
        .onClick(async () => {
          xiaohongshuLoginBtn.setDesc('正在检测小红书登录状态...');
          const loggedIn = await this.plugin.checkXiaohongshuLogin();
          if (loggedIn) {
            xiaohongshuLoginBtn.setDesc('小红书登录状态正常；同步小红书图文时会复用该状态提取评论区。');
            new Notice('小红书登录状态正常');
          } else {
            xiaohongshuLoginBtn.setDesc('未检测到小红书登录状态，或登录状态已过期；如需提取评论区，请重新登录小红书。');
            new Notice('未检测到小红书登录状态，或登录状态已过期');
          }
        }));

    this.plugin.checkXiaohongshuLogin().then((loggedIn) => {
      if (loggedIn) {
        xiaohongshuLoginBtn.setDesc('已保存小红书登录状态；同步小红书图文时会复用该状态提取评论区。');
      }
    });

    const status = containerEl.createDiv({ cls: 'wechat-inbox-sync-status' });
    status.setText(this.plugin.settings.noteSaveMode === 'root'
      ? '同步后会生成：临时收集/文本-示例.md、临时收集/公众号-示例.md。语音附件仍会放入临时收集/语音附件/YYYY-MM-DD/。'
      : '同步后会生成：临时收集/YYYY-MM-DD/文本-示例.md、公众号-示例.md。语音附件会放入临时收集/语音附件/YYYY-MM-DD/。');
    this.plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open' }).catch((error) => {
      new Notice(`Pro 自动能力检查失败：${error.message || error}`);
    });
  }
}

WechatObsidianInboxPlugin.__test = {
  FEISHU_TUTORIAL_URL,
  FEISHU_OFFICIAL_API_TUTORIAL_URL,
  MAX_PLUGIN_BINDINGS,
  LOCAL_TRANSCRIPTION_PLAN,
  LOCAL_ASR_INSTALLER_URL,
  LOCAL_ASR_MACOS_INSTALLER_URL,
  LOCAL_OCR_INSTALLER_URL,
  LOCAL_OCR_MACOS_INSTALLER_URL,
  LOCAL_ASR_PLATFORM_NAMES,
  NOTE_PROPERTY_FIELD_KEYS,
  NOTE_SAVE_MODES,
  canAddPluginBinding,
  getLocalAsrPlatform,
  normalizeLocalAsrPlatform,
  normalizeLocalAsrInstallMode,
  normalizeNotePropertyFields,
  normalizeNoteSaveMode,
  normalizeCloudPreTranscriptionThresholdMinutes,
  isAsciiPath,
  extractLocalAsrInstallRootFromCommand,
  hasLocalAsrNativeCrash,
  getLocalAsrRepairAction,
  resolveLocalAsrPlatform,
  getLocalAsrPlatformMismatchMessage,
  formatRedeemAccessError,
  formatLocalComponentInstallFailureReason,
  isCachedProStatusActiveForCode,
  buildAliyunVoiceRequest,
  buildDoubaoAsrRequest,
  buildDoubaoAsrQueryRequest,
  buildTencentCreateRecTaskBody,
  buildTencentRequest,
  parseAliyunTranscriptionResult,
  parseDoubaoAsrResult,
  parseDoubaoAsrTaskState,
  formatHttpError,
  parseTencentCreateTaskResponse,
  parseTencentTaskStatusResponse,
  buildRecordTitleBase,
  hasRecordIdInFrontmatter,
  extractXiaohongshuMarkdownFromHtml,
  extractSocialCommentsFromHtml,
  appendXiaohongshuOcrMarkdown,
  buildXiaohongshuOcrMarkdown,
  isLikelyImageTextNote,
  normalizeXiaohongshuOcrItems,
  buildMarkdownForRecord,
  enrichExtractedWebpageMetadata,
  extractSocialVideoMarkdownFromHtml,
  extractPodcastAudioUrlFromHtml,
  extractSocialMediaUrlsFromHtml,
  extractSocialMediaUrlFromHtml,
  WECHAT_CHANNELS_FEED_INFO_URL,
  isWechatChannelsUrl,
  extractWechatChannelsRequestPayload,
  normalizeWechatChannelsFeedPayload,
  extractWechatChannelsProfilesFromText,
  generateWechatChannelsDecryptorBytes,
  decryptWechatChannelsMediaBuffer,
  extractDouyinAwemeId,
  extractDouyinMediaUrlsFromDetailPayload,
  isUnavailableXiaohongshuPage,
  normalizeBrowserCapturedMediaUrls,
  sortMediaUrlsForTranscription,
  cleanDisplayUrl,
  isWechatMpArticleUrl,
  shouldHydrateLinkAsWebpage,
  extractBilibiliSubtitleUrlsFromHtml,
  parseBilibiliSubtitlePayload,
  extractBilibiliAudioUrlFromPlayurlPayload,
  buildAudioTranscriptMarkdown,
  buildTranscriptPropertyMetadata,
  buildTranscriptOnlyMetadata,
  buildSyncProgressMessage,
  buildSkippedSyncNotice,
  parseLocalAsrProgressLog,
  createRetryableTranscriptionError,
  isRetryableTranscriptionError,
  isRemoteAsrDownloadFailure,
  getDoubaoTaskKey,
  getDefaultLocalTranscriptionCommand,
  getSafeLocalAsrInstallRoot,
  getLocalAsrInstallRoot,
  getLocalAsrInstallStatus,
  getLocalOcrInstallRoot,
  getLocalOcrInstallStatus,
  getLocalOcrPythonPath,
  getLocalOcrScriptPath,
  getLocalAsrScriptVersionStatus,
  explainLocalAsrExitCode,
  getLocalAsrRunLogPath,
  buildLocalAsrRunLogText,
  appendLocalAsrRunLog,
  readLocalAsrRunLog,
  buildLocalAsrInstallCommand,
  buildLocalOcrInstallCommand,
  downloadTextViaNode,
  normalizeInstallerScriptText,
  getSocialRequestHeaders,
  hasXiaohongshuLoginCookies,
  getXiaohongshuCookieHeader,
  getXiaohongshuRequestHeaders,
  checkXiaohongshuLoginStatus,
  shouldResolveMediaDownloadUrl,
  openExternalUrl,
  extractPdfMarkdown,
  cleanPdfExtractedText,
  htmlToMarkdown,
  extractWebpageMetadataFromHtml,
  extractFeishuMarkdownFromHtml,
  extractFeishuMarkdownFromClientVars,
  mergeFeishuRenderedAndClientVarsMarkdown,
  shouldRefreshFeishuMarkdownFromSource,
  extractFeishuDocumentTokenFromUrl,
  buildFeishuClientVarsApiUrl,
  extractFeishuOpenApiUrlInfo,
  extractFeishuMarkdownFromOpenApiBlocks,
  fetchFeishuOpenApiMarkdownFromUrl,
  normalizeGeneratedKeywords,
  parseGeneratedMetadataResponse,
  extractAiMetadataInputText,
  cleanMarkdownForStorage,
  resolveRedirectUrl,
  isRequestUrlTransportError,
  requestJsonViaNode,
  validateSettings,
  mergeSettings,
  normalizeBindings,
  normalizeApiBase,
  normalizeBindCodeInput,
};

module.exports = WechatObsidianInboxPlugin;
