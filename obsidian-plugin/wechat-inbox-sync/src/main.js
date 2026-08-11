const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl,
} = require('obsidian');
const {
  formatCreatedTime,
  getChinaTimeParts,
  getDateFolderName,
  getTitleTimePart,
  pad2,
} = require('./date-utils');
const {
  assertUsableTranscription,
  createTranscriptionQualityError,
  getTranscriptionQualityIssue,
  getTranscriptionQualityUnits,
  normalizeTranscriptionQualityUnit,
} = require('./transcription-quality-utils');
const {
  extractOpenAICompatibleText,
  formatHttpError,
  parseAliyunTranscriptionResult,
  parseDoubaoAsrResult,
  parseDoubaoAsrTaskState,
  parseTencentCreateTaskResponse,
  parseTencentTaskStatusResponse,
  tryParseJson,
} = require('./cloud-transcription-response-utils');
const {
  generateWechatChannelsDecryptorBytes,
  decryptWechatChannelsMediaBuffer,
} = require('./wechat-channels-decrypt-utils');
const {
  stripMarkdownCodeBlocks,
  normalizeTitleForCompare,
  normalizeFeishuMarkdownLine,
  shouldDropFeishuLine,
  formatFeishuHeadingLine,
  isFeishuCodeLanguageLine,
  postProcessFeishuMarkdown,
  isFeishuMarkdownLikelyTruncated,
} = require('./feishu-markdown-utils');
const {
  buildConversionWarningsNotice,
  buildLocalAsrProgressKey,
  buildSkippedSyncNotice,
  buildSyncNotice,
  buildSyncProgressMessage,
  buildSyncResultNotice,
  formatProgressElapsed,
  isProgressHeartbeatStale,
  normalizeProgressPercent,
  parseLocalAsrProgressLog,
} = require('./progress-notice-utils');
const {
  buildAiMetadataConversionWarning,
  buildAiMetadataErrorComment,
  classifyAiMetadataError,
} = require('./ai-metadata-error-utils');
const {
  redactKnownCredentials,
  redactSensitiveObject,
} = require('./diagnostic-redaction-utils');
const {
  normalizeConfiguredVaultPath,
  normalizeVaultPath,
  shouldPersistNormalizedInboxDir,
} = require('./vault-path-utils');
const {
  normalizeBindCodeInput,
  normalizeNotePropertyFields: normalizeNotePropertyFieldsWithKeys,
  normalizeNoteSaveMode: normalizeNoteSaveModeWithDefaults,
} = require('./input-normalization-utils');
const {
  enrichExtractedWebpageMetadata,
  extractKeywordsFromText,
  getRecordAuthor,
  getRecordDescription,
  getRecordKeywords,
  stripMarkdownForDescription,
} = require('./record-metadata-utils');
const {
  isAudioVideoTranscriptionIncompleteRecord,
  isCloudTranscriptionWaitingRecord,
} = require('./record-state-utils');
const {
  buildRecordIdMarker,
  getFrontmatterBlock,
  getFrontmatterScalar,
  getRecordIdFromFrontmatter,
  getRecordIdFromHiddenMarker,
  getRecordIdFromMarkdown,
  hasRecordIdInFrontmatter,
  hasRecordUrlInFrontmatter,
  normalizeRecordUrlForCompare,
  normalizeYamlScalar,
} = require('./record-identity-utils');
const {
  categorizeSyncFailure,
  getSyncLifecycleBindingFingerprint,
  getSyncLifecycleOutcomeError,
  getSyncNoteTitleFromPath,
  isExistingLocalNoteDeliverable,
  isLegacySyncLifecycleError,
  isSyncRecordBusyError,
  normalizePendingSyncLifecycleAttempts,
  sanitizeSyncNoteTitle,
} = require('./sync-lifecycle-utils');
const { createNoteOutputPlanHelpers } = require('./note-output-plan-utils');
const { createRecordBodyMarkdownHelpers } = require('./record-body-markdown-utils');
const {
  decodeDataUrl,
  decodeUtf8ArrayBuffer,
  getAttachmentExt,
  getAudioFormatFromUrl,
  getImageExtFromBuffer,
  getImageExtFromMime,
  getImageFileExtension,
  getInvalidDownloadedMediaReason,
  hasVideoTrackInMediaBuffer,
  isAudioVideoAttachmentExt,
  isMarkdownConvertibleExt,
  sanitizeAttachmentName,
  toNodeBuffer,
} = require('./media-file-utils');
const { createDocumentTextExtractionHelpers } = require('./document-text-extraction-utils');
const {
  createAiMetadataHelpers,
  retryAiMetadataGeneration,
} = require('./ai-metadata-utils');
const {
  buildSocialMetrics,
  buildSocialMetricsFromText,
  hasSocialMetrics,
  withCapturedSocialMetrics,
} = require('./social-engagement-utils');
const {
  applyTranscriptionNoteIdentity,
  buildSemanticTranscriptionTitle,
  buildTranscriptionNoteIdentity,
  getTranscriptionSourcePrefix,
  isSuccessfulTranscriptionRecord,
} = require('./transcription-note-title-utils');
const {
  cleanPdfExtractedText,
  extractDocxMarkdown,
  extractPdfMarkdown,
} = createDocumentTextExtractionHelpers({
  toNodeBuffer,
  cleanMarkdownForStorage,
});

const WECHAT_SESSION_PARTITION = 'persist:wechat-inbox-wechat';
const XIAOHONGSHU_SESSION_PARTITION = 'persist:wechat-inbox-sync-xiaohongshu';
const PLUGIN_RUNTIME_VERSION = '1.3.79';
const PLUGIN_RUNTIME_BUILD_MARKER = 'clipboard-link-path-v1';

const LEGACY_OFFICIAL_SYNC_API_BASES = [
  'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync',
];
const OFFICIAL_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';
const FEISHU_OAUTH_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync';
const FEISHU_TUTORIAL_URL = 'https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink';
const FEISHU_OFFICIAL_API_TUTORIAL_URL = 'https://my.feishu.cn/wiki/LZBlwhqBCi880Bk00yOcB2dKn1g?from=from_copylink';
const MAX_PLUGIN_BINDINGS = 3;
const XIAOHONGSHU_TOTAL_COMMENT_LIMIT = 300;
const XIAOHONGSHU_ROOT_COMMENT_LIMIT = XIAOHONGSHU_TOTAL_COMMENT_LIMIT;
const XIAOHONGSHU_REPLY_COMMENT_LIMIT = 100;
const XIAOHONGSHU_ROOT_COMMENT_PAGE_LIMIT = Math.min(
  120,
  Math.max(30, Math.ceil(XIAOHONGSHU_TOTAL_COMMENT_LIMIT / 10)),
);
const XIAOHONGSHU_COMMENT_TIMEOUT_MS = 90000;
const XIAOHONGSHU_COMMENT_REQUEST_TIMEOUT_MS = 10000;
const XIAOHONGSHU_BROWSER_SCRIPT_TIMEOUT_MS = 10000;
const XIAOHONGSHU_CONTENT_DEADLINE_MS = 40000;
const DOUYIN_MOBILE_SHARE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; 22041211AC) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36';
const LOCAL_TRANSCRIPTION_PLAN = 'local_transcription_beta';
const LOCAL_TRANSCRIPTION_FALLBACK_PLANS = ['local_transcription_trial'];
const LOCAL_COMPONENT_CDN_BASE_URL = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com';
const LOCAL_ASR_INSTALLER_URL = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr.ps1';
const LOCAL_ASR_MACOS_INSTALLER_URL = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr-macos.sh';
const LOCAL_OCR_WINDOWS_INSTALLER_SHA256 = '65ff6ec5aa844c780a4ebf4f83c9ea2f206de1b33e145dd2f1b9e1129f4e2337';
const LOCAL_OCR_MACOS_INSTALLER_SHA256 = 'de54e86dec02cca3bdd5e0e84e89ae4dd50918cff3300968aa84e7bb1f846074';
const LOCAL_OCR_INSTALLER_URL = `${LOCAL_COMPONENT_CDN_BASE_URL}/local-components/by-sha256/${LOCAL_OCR_WINDOWS_INSTALLER_SHA256}/install-local-ocr.ps1`;
const LOCAL_OCR_MACOS_INSTALLER_URL = `${LOCAL_COMPONENT_CDN_BASE_URL}/local-components/by-sha256/${LOCAL_OCR_MACOS_INSTALLER_SHA256}/install-local-ocr-macos.sh`;
const LOCAL_ASR_INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const PRO_SETUP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRO_SETUP_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const NOTE_SAVE_MODES = {
  date: '按日期创建子目录',
  root: '直接保存到根目录',
};
const normalizeNoteSaveMode = (value) => normalizeNoteSaveModeWithDefaults(
  value,
  NOTE_SAVE_MODES,
  DEFAULT_SETTINGS.noteSaveMode,
);
const normalizeNotePropertyFields = (value) => normalizeNotePropertyFieldsWithKeys(
  value,
  NOTE_PROPERTY_FIELD_KEYS,
);
const DEFAULT_NOTE_PROPERTY_FIELDS = 'title,author,url,synced_at,source,description,keywords,views,likes,collects,comments,shares,coins,metrics_captured_at';
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
  'views',
  'likes',
  'collects',
  'comments',
  'shares',
  'coins',
  'metrics_captured_at',
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
  proEntitlementLastError: '',
  proEntitlementLastErrorAt: '',
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
  xiaohongshuImageOcrEnabled: false,
  xiaohongshuImageOcrConsentVersion: 0,
  saveOriginalMediaEnabled: false,
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
  locallyQuarantinedRecordIds: [],
  pendingSyncLifecycleAttempts: [],
};

const XIAOHONGSHU_OCR_MAX_IMAGES = 18;
const XIAOHONGSHU_OCR_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const XIAOHONGSHU_CONTENT_MAX_IMAGES = 100;
const XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS = 4 * 1024 * 1024;
const XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS = 2 * 1024 * 1024;
const XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS = 1024 * 1024;
const XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS = 4 * 1024 * 1024;
const XIAOHONGSHU_COMMENT_IDENTITY_MAX_NODES = 2000;
const XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER = '__WECHAT_INBOX_XHS_COMMENT_BODY_TRUNCATED__';
const BROWSER_MEDIA_CAPTURE_MAX_REQUESTS = 512;
const BROWSER_MEDIA_CAPTURE_MAX_URLS = 256;
const BROWSER_MEDIA_CAPTURE_MAX_NODES = 2048;
const BROWSER_MEDIA_CAPTURE_MAX_STRING_CHARACTERS = 256 * 1024;

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
const LOCAL_OCR_BATCH_RUN_TIMEOUT_MS = 6 * 60 * 1000;
const LOCAL_OCR_BATCH_RUNNER_VERSION = 'xiaohongshu-batch-v1';

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

function completePendingLocalOcrSwitch(installRoot, dependencies = {}) {
  const exists = dependencies.exists || fs.existsSync;
  const readFile = dependencies.readFile || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  const rename = dependencies.rename || ((from, to) => fs.renameSync(from, to));
  const remove = dependencies.remove || ((target) => fs.rmSync(target, { recursive: true, force: true }));
  const validatePython = dependencies.validatePython || ((pythonPath) => {
    if (!exists(pythonPath)) return false;
    try {
      childProcess.execFileSync(pythonPath, ['-c', 'import rapidocr_onnxruntime, PIL'], {
        timeout: 30000,
        windowsHide: true,
        stdio: 'ignore',
      });
      return true;
    } catch (_) {
      return false;
    }
  });
  const root = path.resolve(String(installRoot || ''));
  const markerPath = path.join(root, 'pending-venv-switch.json');
  const legacyStagingPath = path.join(root, 'venv-staging');
  const targetPath = path.join(root, 'venv');
  const backupPath = path.join(root, 'venv-backup');
  if (!exists(markerPath)) return { status: 'none' };

  let marker;
  try {
    marker = JSON.parse(String(readFile(markerPath) || '').replace(/^\uFEFF/, ''));
  } catch (_) {
    remove(markerPath);
    return { status: 'invalid' };
  }
  if (!marker || !['single-dir-transaction-v1', 'unique-staging-transaction-v2'].includes(marker.capability)) {
    remove(markerPath);
    return { status: 'invalid' };
  }

  let stagingPath = legacyStagingPath;
  if (marker.capability === 'unique-staging-transaction-v2') {
    const markerStagingPath = path.resolve(String(marker.staging || ''));
    const markerTargetPath = path.resolve(String(marker.target || ''));
    const markerBackupPath = path.resolve(String(marker.backup || ''));
    const stagingName = path.basename(markerStagingPath);
    const hasSafeStagingName = /^venv-staging-[a-f0-9]{32}$/i.test(stagingName);
    const isDirectInstallChild = path.dirname(markerStagingPath) === root;
    const hasExpectedTransactionTargets = markerTargetPath === targetPath && markerBackupPath === backupPath;
    if (!hasSafeStagingName || !isDirectInstallChild || !hasExpectedTransactionTargets) {
      remove(markerPath);
      return { status: 'invalid' };
    }
    stagingPath = markerStagingPath;
  }

  const stagingPython = path.join(stagingPath, 'Scripts', 'python.exe');
  if (!exists(stagingPath) || !validatePython(stagingPython)) {
    remove(markerPath);
    if (exists(stagingPath)) remove(stagingPath);
    return { status: 'invalid' };
  }

  let movedTarget = false;
  try {
    if (exists(backupPath)) remove(backupPath);
    if (exists(targetPath)) {
      rename(targetPath, backupPath);
      movedTarget = true;
    }
    rename(stagingPath, targetPath);
    const activePython = path.join(targetPath, 'Scripts', 'python.exe');
    if (!validatePython(activePython)) {
      throw new Error('promoted OCR environment failed validation');
    }
    if (exists(backupPath)) remove(backupPath);
    remove(markerPath);
    return { status: 'activated', pythonPath: activePython };
  } catch (error) {
    try {
      if (movedTarget && exists(targetPath) && exists(backupPath)) {
        remove(targetPath);
      }
      if (movedTarget && !exists(targetPath) && exists(backupPath)) {
        rename(backupPath, targetPath);
      }
    } catch (_) {
    }
    return { status: 'pending', error: error && (error.message || String(error)) };
  }
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

const CURRENT_WINDOWS_ASR_SCRIPT_SHA256 = '23c195a46d2e7b875757ead4a76080891e9343eb7563171f726b1b33a66e2709';
const LEGACY_WINDOWS_ASR_SCRIPT_SHA256 = '509a1b5aee1326da11e5f674e98cac3939b853c45180cced0f421d59c67fafcb';

function getLocalAsrScriptIdentityHash(source) {
  const normalizedSource = String(source || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trimEnd();
  return crypto.createHash('sha256').update(normalizedSource, 'utf8').digest('hex');
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
    const sourceIdentityHash = getLocalAsrScriptIdentityHash(source);
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
      && source.includes('$TranscriptQualityGuardVersion = "repeat-guard-v2"')
      && source.includes('$NativeProcessRunnerVersion = "diagnostics-process-v1"')
      && source.includes('TRANSCRIPT_HALLUCINATION')
      && source.includes('Invoke-NativeProcess')
      && source.includes('System.Diagnostics.ProcessStartInfo')
      && source.includes('ReadToEndAsync')
      && !source.includes('Start-Process')
      && source.includes('ConvertTo-SimplifiedChinese')
      && source.includes('SimplifiedChinese')
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
      && source.includes('progressHeartbeatAt')
      && source.includes('progressPid')
      && source.includes('-ProgressStage "segmenting"')
      && !source.includes('$SimplifiedPrompt')
      && !source.includes('"--prompt"')
    ) {
      if (sourceIdentityHash !== CURRENT_WINDOWS_ASR_SCRIPT_SHA256) {
        return {
          scriptVersion: 'current-signature-mismatch',
          scriptOutdated: true,
        };
      }
      return {
        scriptVersion: 'adaptive-chunked-diagnostics-process-repeat-guard-v2-heartbeat-run-log',
        scriptOutdated: false,
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
      && source.includes('$TranscriptQualityGuardVersion = "repeat-guard-v2"')
      && source.includes('TRANSCRIPT_HALLUCINATION')
      && source.includes('Invoke-NativeProcess')
      && source.includes('Start-Process')
      && source.includes('RedirectStandardOutput')
      && source.includes('ConvertTo-SimplifiedChinese')
      && source.includes('SimplifiedChinese')
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
      && !source.includes('$SimplifiedPrompt')
      && !source.includes('"--prompt"')
      && !source.includes('DataReceivedEventHandler')
      && !source.includes('BeginOutputReadLine')
    ) {
      const hasHeartbeatProtocol = source.includes('progressHeartbeatAt')
        && source.includes('progressPid')
        && source.includes('-ProgressStage "segmenting"');
      if (hasHeartbeatProtocol && sourceIdentityHash !== LEGACY_WINDOWS_ASR_SCRIPT_SHA256) {
        return {
          scriptVersion: 'legacy-signature-mismatch',
          scriptOutdated: true,
        };
      }
      return {
        scriptVersion: hasHeartbeatProtocol
          ? 'adaptive-chunked-start-process-repeat-guard-v2-heartbeat-run-log'
          : 'adaptive-chunked-start-process-repeat-guard-v2-progress-run-log',
        scriptOutdated: !hasHeartbeatProtocol,
        ...(hasHeartbeatProtocol
          ? {
            upgradeRecommended: true,
            compatibilityMode: 'legacy-start-process',
          }
          : {}),
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
        scriptOutdated: true,
      };
    }
    if (
      source.includes('transcribe-last.log')
      && source.includes('CHUNK_SECONDS')
      && source.includes('set -euo pipefail')
      && source.includes('TRANSCRIPT_QUALITY_GUARD_VERSION="repeat-guard-v2"')
      && source.includes('CHUNK_SECONDS=120')
      && source.includes('choose_chunk_seconds')
      && source.includes('find_metal_resources_dir')
      && source.includes('GGML_METAL_PATH_RESOURCES')
      && source.includes('metalAcceleration=failed')
      && source.includes('progressPercent')
      && !source.includes('SIMPLIFIED_PROMPT')
      && !source.includes('--prompt "$SIMPLIFIED_PROMPT"')
    ) {
      const hasHeartbeatProtocol = source.includes('progressHeartbeatAt')
        && source.includes('progressPid')
        && source.includes('run_with_heartbeat segmenting');
      return {
        scriptVersion: hasHeartbeatProtocol
          ? 'adaptive-chunked-bash-repeat-guard-v2-heartbeat-run-log'
          : 'adaptive-chunked-bash-repeat-guard-v2-progress-metal-diagnostics-run-log',
        scriptOutdated: !hasHeartbeatProtocol,
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
        scriptOutdated: true,
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
      scriptOutdated: true,
    };
  } catch (error) {
    return {
      scriptVersion: 'unknown',
      scriptOutdated: true,
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
    ...(scriptVersionStatus.upgradeRecommended === undefined
      ? {}
      : {
        upgradeRecommended: Boolean(scriptVersionStatus.upgradeRecommended),
        compatibilityMode: scriptVersionStatus.compatibilityMode || 'current',
      }),
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
  if (text.includes('-1073741795') || text.toUpperCase().includes('0XC000001D')) {
    return 'whisper.cpp 使用了当前 CPU 不支持的指令（0xC000001D）。请重新点击“安装/更新本地转写组件”；新版会自动尝试兼容版本。若兼容版本仍无法运行，请复制同步/安装失败诊断联系支持。';
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
  diagnostic = null,
} = {}) {
  const lines = [
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
  ];
  if (diagnostic && typeof diagnostic === 'object') {
    lines.push(
      '--- diagnostic ---',
      JSON.stringify(redactSensitiveObject(diagnostic), null, 2),
    );
  }
  return lines.join('\n');
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

function getProEntitlementStatusFingerprint(status) {
  const source = status && typeof status === 'object' ? status : {};
  return JSON.stringify({
    hasAccess: source.hasAccess === true,
    status: String(source.status || ''),
    expiresAt: String(source.expiresAt || ''),
    code: normalizeBindCodeInput(source.code || source.redeemCode || ''),
    bindingToken: normalizeBindCodeInput(source.bindingToken || ''),
  });
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

function hasMinimumInstallerVersion(source, pattern, minimumVersion) {
  const versionMatch = String(source || '').match(pattern);
  if (!versionMatch) return false;
  const versionParts = versionMatch.slice(1).map((value) => Number(value));
  if (versionParts.length !== minimumVersion.length || versionParts.some((value) => !Number.isFinite(value))) {
    return false;
  }
  for (let index = 0; index < minimumVersion.length; index += 1) {
    if (versionParts[index] > minimumVersion[index]) return true;
    if (versionParts[index] < minimumVersion[index]) return false;
  }
  return true;
}

function isLocalAsrInstallerCurrent(scriptText, isMac = false) {
  const source = String(scriptText || '');
  if (!source.includes('.wechat-inbox-local-asr')) return false;
  if (isMac) {
    const portablePythonIndex = source.indexOf('if install_portable_python; then');
    const uvManagedPythonIndex = source.indexOf('"$UV_BIN" python install 3.12');
    return hasMinimumInstallerVersion(
      source,
      /INSTALLER_SCRIPT_VERSION=["'](\d+)\.(\d+)\.(\d+)["']/,
      [1, 3, 8],
    )
      && !source.includes('SIMPLIFIED_PROMPT')
      && !source.includes('--prompt')
      && source.includes('TRANSCRIPT_QUALITY_GUARD_VERSION="repeat-guard-v2"')
      && source.includes('CHUNK_SECONDS=120')
      && source.includes('choose_chunk_seconds')
      && source.includes('find_metal_resources_dir')
      && source.includes('GGML_METAL_PATH_RESOURCES')
      && source.includes('metalAcceleration=failed')
      && source.includes('transcribe-last.log')
      && source.includes('progressHeartbeatAt')
      && source.includes('progressPid')
      && source.includes('run_with_heartbeat segmenting')
      && source.includes('validate_local_asr_inference')
      && source.includes('TENCENT_MODEL_URL=')
      && source.includes('bootstrap_uv')
      && source.includes('detect_uv_arch')
      && source.includes('setup_python_and_packages')
      && source.includes('UV_PYTHON_DOWNLOADS=automatic')
      && source.includes('UV_PYTHON_PREFERENCE=managed')
      && source.includes('PYTHON_BUILD_STANDALONE_BUILD=')
      && source.includes('PYTHON_BUILD_STANDALONE_VERSION=')
      && source.includes('PYTHON_RUNTIME_VERSION=')
      && source.includes('PYTHON_RUNTIME_SHA256_ARM64=')
      && source.includes('PYTHON_RUNTIME_SHA256_X64=')
      && source.includes('TENCENT_PYTHON_DOWNLOAD_BASE=')
      && source.includes('PORTABLE_PYTHON=')
      && source.includes('install_portable_python')
      && source.includes('python_runtime_sha256')
      && source.includes('verify_sha256 "$archive_path" "$expected_sha256"')
      && source.includes('sys.version.split()[0] == sys.argv[1]')
      && source.includes('"$PORTABLE_PYTHON" -m venv "$VENV_DIR"')
      && source.includes('"$UV_BIN" python install 3.12')
      && source.includes('"$UV_BIN" venv "$VENV_DIR" --python 3.12 --managed-python')
      && portablePythonIndex >= 0
      && uvManagedPythonIndex > portablePythonIndex;
  }
  return hasMinimumInstallerVersion(
    source,
    /\$InstallerScriptVersion\s*=\s*["'](\d+)\.(\d+)\.(\d+)["']/,
      [1, 2, 26],
  )
    && source.includes('function Assert-TranscribeScriptCandidate')
    && source.includes('function Start-TranscribeScriptUpdate')
    && source.includes('function Promote-TranscribeScriptUpdate')
    && source.includes('function Restore-TranscribeScriptUpdate')
    && source.includes('function Complete-TranscribeScriptUpdate')
    && source.includes('[System.Management.Automation.Language.Parser]::ParseFile')
    && !source.includes('$SimplifiedPrompt')
    && !source.includes('--prompt')
    && source.includes('progressHeartbeatAt')
    && source.includes('progressPid')
    && source.includes('-ProgressStage "segmenting"')
    && source.includes('$TranscriptQualityGuardVersion = "repeat-guard-v2"')
    && source.includes('$NativeProcessRunnerVersion = "diagnostics-process-v1"')
    && source.includes('Invoke-NativeProcess')
    && source.includes('System.Diagnostics.ProcessStartInfo')
    && source.includes('ReadToEndAsync')
    && !source.includes('Start-Process')
    && source.includes('Convert-ExitCodeToHex')
    && source.includes('$hex = Convert-ExitCodeToHex -ExitCode $ExitCode')
    && source.includes('[string]$InstallRoot')
    && source.includes('Install-ExtractedPackage')
    && !source.includes('Move-Item -LiteralPath $FfmpegStageDir -Destination $FfmpegDir')
    && source.includes('safeModelPath')
    && source.includes('$TencentCosAssetBaseUrl')
    && source.includes('$WhisperWindowsTencentUrls')
    && source.includes('$WhisperWindowsCompatibilityUrls')
    && source.includes('$WhisperWindowsCompatibilitySha256')
    && source.includes('$FfmpegTencentUrls')
    && source.includes('$ModelTencentUrls')
    && source.includes('Get-EnabledAssetUrls')
    && source.includes('$WhisperWindowsFallbackUrls')
    && source.includes('Test-IllegalInstructionExitCode')
    && source.includes('whisper-bin-x64-compat.zip')
    && source.includes('Assert-FileSha256')
    && source.includes('GitHub release page parsing failed')
    && source.includes('INSTALLER FAILED')
    && source.includes('$DownloadTimeoutSeconds = 1200')
    && source.includes('--max-time $DownloadTimeoutSeconds')
    && source.includes('System.Text.UTF8Encoding')
    && source.includes('ReadAllText($chunkTxt, $Utf8NoBom)')
    && source.includes('WriteAllText($OutputPath');
}

function isLocalOcrInstallerCurrent(scriptText, isMac = false) {
  const source = String(scriptText || '');
  if (!source.includes('.wechat-inbox-local-ocr')) return false;
  if (!source.includes('rapidocr-onnxruntime==1.4.4')) return false;
  if (!source.includes('pillow==12.3.0')) return false;
  if (isMac) {
    return source.includes('TENCENT_OCR_ASSET_BASE_URL')
      && source.includes('TENCENT_PIP_INDEX_URL')
      && source.includes('TENCENT_PYTHON_INSTALL_MIRROR')
      && source.includes('PYTHON_BUILD_STANDALONE_BUILD="20260623"')
      && source.includes('PYTHON_BUILD_STANDALONE_VERSION="3.12.13+20260623"')
      && source.includes('PORTABLE_PYTHON=')
      && source.includes('download_with_retry')
      && source.includes('find_existing_python')
      && source.includes('install_portable_python')
      && source.includes('"$PORTABLE_PYTHON" -m venv "$VENV_DIR"')
      && source.includes('.wechat-inbox-local-asr/python-venv/bin/python');
  }
  return source.includes('$TencentOcrAssetBaseUrl')
    && source.includes('$TencentPipIndexUrl')
    && source.includes('$TencentPythonInstallMirror')
    && source.includes('$PythonBuildStandaloneBuild = "20260623"')
    && source.includes('$PythonBuildStandaloneVersion = "3.12.13+20260623"')
    && source.includes('$PortablePython')
    && source.includes('Download-TextFile')
    && source.includes('function Install-PortablePython')
    && source.includes('function Expand-TarGzArchiveWithPowerShell')
    && source.includes('unique-staging-transaction-v2')
    && source.includes('$python = Install-PortablePython')
    && source.includes('Invoke-Python -PythonCommand $python -m venv $VenvDir');
}

function isTrustedLocalOcrInstallerSource(scriptText, expectedSha256, isMac = false) {
  const expected = String(expectedSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected) || !isLocalOcrInstallerCurrent(scriptText, isMac)) return false;
  return sha256Hex(Buffer.from(String(scriptText || ''), 'utf8')) === expected;
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

function shouldBypassExistingLocalNoteDedupe(record) {
  const metadata = (record && record.metadata) || {};
  const sourceUrl = String(metadata.url || (record && record.content) || '').trim();
  return String((record && record.type) || '').toLowerCase() === 'voice'
    || metadata.webpageMediaType === 'audio_video'
    || Boolean(metadata.audioFileID)
    || metadata.transcriptOnly === true
    || isXiaohongshuUrl(sourceUrl);
}

function getPluginRuntimeIdentity(manifestVersion = '') {
  const normalizedManifestVersion = String(manifestVersion || '').trim() || 'unknown';
  return {
    manifestVersion: normalizedManifestVersion,
    runtimeVersion: PLUGIN_RUNTIME_VERSION,
    buildMarker: PLUGIN_RUNTIME_BUILD_MARKER,
    matchesManifest: normalizedManifestVersion === PLUGIN_RUNTIME_VERSION,
  };
}

function getSafeUrlDiagnostic(url = '') {
  try {
    const parsed = new URL(String(url || ''));
    return {
      protocol: parsed.protocol.replace(':', '').toLowerCase(),
      host: parsed.hostname.replace(/^www\./, '').toLowerCase(),
    };
  } catch (error) {
    return { protocol: '', host: '' };
  }
}

function getXiaohongshuCapabilityMatrix({
  hasProAccess = false,
  commentsEnabled = true,
  isLoggedIn = false,
  imageOcrEnabled = false,
} = {}) {
  const pro = hasProAccess === true;
  return {
    publicGraphic: true,
    mediaTranscription: pro,
    imageOcr: pro && imageOcrEnabled === true,
    comments: pro && commentsEnabled !== false && isLoggedIn === true,
  };
}

function getXiaohongshuBrowserCandidates(
  sourceUrl = '',
  targetIdentityUrl = '',
  responseFinalUrl = '',
) {
  const result = [];
  const seen = new Set();
  const add = (url, kind) => {
    const value = String(url || '').trim();
    if (!value || seen.has(value) || !isXiaohongshuUrl(value)) return;
    seen.add(value);
    result.push({ url: value, kind });
  };
  add(sourceUrl, isXiaohongshuShortLinkUrl(sourceUrl) ? 'original-shortlink' : 'source-url');
  add(targetIdentityUrl, 'resolved-url');
  add(responseFinalUrl, 'response-final-url');
  return result;
}

function isXiaohongshuShareBoilerplateOnly(extracted) {
  if (!extracted) return false;
  const source = Array.from(new Set([
    extracted.description,
    extracted.markdown,
  ].map((item) => String(item || '').trim()).filter(Boolean))).join('\n');
  const hasShareLink = /(?:xhslink\.(?:cn|com)|xiaohongshu\.com\/(?:explore|discovery)\/)/i.test(source);
  const hasShareInstruction = /(?:存下|复制).{0,12}(?:口令|信息)|(?:打开|跳转).{0,12}(?:小红书|RED).{0,12}(?:阅读|查看)?/is.test(source);
  return hasShareInstruction && (hasShareLink || source.replace(/\s+/g, '').length <= 80);
}

function classifyXiaohongshuPage({ html = '', resolvedUrl = '', extracted = null } = {}) {
  const finalHost = getSafeUrlDiagnostic(resolvedUrl).host;
  if (finalHost && finalHost !== 'xiaohongshu.com' && !finalHost.endsWith('.xiaohongshu.com')) {
    return 'unexpected-host';
  }
  if (isUnavailableXiaohongshuPage(html, resolvedUrl)) return 'xiaohongshu-unavailable';
  if (isGenericXiaohongshuLandingExtraction(extracted) || isXiaohongshuShareBoilerplateOnly(extracted)) {
    return 'xiaohongshu-generic-landing';
  }
  if (hasReadableXiaohongshuGraphicContent(extracted, html, resolvedUrl)
    || (extracted && extracted.videoUrl)) {
    return 'xiaohongshu-note';
  }
  return 'unknown';
}

function scoreXiaohongshuExtraction(extracted, html = '', url = '') {
  if (!hasReadableXiaohongshuGraphicContent(extracted, html, url)
    && !(extracted && extracted.videoUrl)) return -1;
  return (String(extracted && extracted.title || '').trim() ? 1000 : 0)
    + Math.min(String(extracted && extracted.description || '').trim().length, 2000)
    + Math.min(String(extracted && extracted.markdown || '').trim().length, 4000)
    + (Array.isArray(extracted && extracted.tags) ? extracted.tags.length * 100 : 0)
    + (Array.isArray(extracted && extracted.imageUrls) ? extracted.imageUrls.length * 500 : 0)
    + (extracted && extracted.videoUrl ? 300 : 0);
}

function buildXiaohongshuBrowserAttemptDiagnostic(candidate = {}, page = null, extracted = null, error = null) {
  const html = String(page && page.html || '');
  const finalUrl = String(page && page.url || candidate.url || '');
  return {
    inputKind: String(candidate.kind || ''),
    attempted: true,
    finalHost: getSafeUrlDiagnostic(finalUrl).host,
    pageType: error
      ? 'request-error'
      : classifyXiaohongshuPage({ html, resolvedUrl: finalUrl, extracted }),
    bodyCharacterCount: String(extracted && (extracted.description || extracted.markdown) || '').trim().length,
    imageCount: Array.isArray(extracted && extracted.imageUrls) ? extracted.imageUrls.length : 0,
    failed: Boolean(error),
    ...(error && error.code === 'BROWSER_TASK_TIMEOUT' ? { timedOut: true } : {}),
  };
}

function buildXiaohongshuFailureDiagnostic({
  manifestVersion = '',
  sourceUrl = '',
  resolvedUrl = '',
  responseStatus = 0,
  html = '',
  extracted = null,
  renderError = null,
  requestError = null,
  redirectDiagnostic = null,
  browserAttempts = [],
} = {}) {
  const source = getSafeUrlDiagnostic(sourceUrl);
  const final = getSafeUrlDiagnostic(resolvedUrl);
  const title = String(extracted && extracted.title ? extracted.title : '').trim();
  const description = String(extracted && extracted.description ? extracted.description : '').trim();
  const shareBoilerplateOnly = isXiaohongshuShareBoilerplateOnly(extracted);
  const genericLanding = isGenericXiaohongshuLandingExtraction(extracted);
  return {
    runtime: getPluginRuntimeIdentity(manifestVersion),
    request: {
      sourceProtocol: source.protocol,
      sourceHost: source.host,
      finalProtocol: final.protocol,
      finalHost: final.host,
      redirected: Boolean(source.host && final.host && source.host !== final.host),
      responseStatus: Number(responseStatus) || 0,
      pageType: classifyXiaohongshuPage({ html, resolvedUrl, extracted }),
      renderFailed: Boolean(renderError),
      requestFailed: Boolean(requestError),
      browserTimedOut: Boolean(
        (renderError && renderError.code === 'BROWSER_TASK_TIMEOUT')
        || (requestError && requestError.code === 'BROWSER_TASK_TIMEOUT')
        || (Array.isArray(browserAttempts)
          && browserAttempts.some((attempt) => attempt && attempt.timedOut === true)),
      ),
      redirectCount: Number(redirectDiagnostic && redirectDiagnostic.redirectCount) || 0,
      usedGetFallback: Boolean(redirectDiagnostic && redirectDiagnostic.usedGetFallback),
      redirectAttempts: redirectDiagnostic && Array.isArray(redirectDiagnostic.attempts)
        ? redirectDiagnostic.attempts.map((attempt) => ({
          method: String(attempt && attempt.method || ''),
          status: Number(attempt && attempt.status) || 0,
          host: String(attempt && attempt.host || ''),
          outcome: String(attempt && attempt.outcome || ''),
        }))
        : [],
      browserAttempts: (Array.isArray(browserAttempts) ? browserAttempts : []).map((attempt) => ({
        inputKind: String(attempt && attempt.inputKind || ''),
        attempted: Boolean(attempt && attempt.attempted),
        finalHost: String(attempt && attempt.finalHost || ''),
        pageType: String(attempt && attempt.pageType || ''),
        bodyCharacterCount: Number(attempt && attempt.bodyCharacterCount) || 0,
        imageCount: Number(attempt && attempt.imageCount) || 0,
        failed: Boolean(attempt && attempt.failed),
        ...(attempt && attempt.timedOut === true ? { timedOut: true } : {}),
      })),
    },
    extraction: {
      hasUsableTitle: Boolean(title && title !== '小红书笔记' && !isGenericXiaohongshuTitle(title)),
      bodyCharacterCount: shareBoilerplateOnly ? 0 : description.length,
      imageCount: extracted && Array.isArray(extracted.imageUrls) ? extracted.imageUrls.length : 0,
      shareBoilerplateOnly,
      genericLanding,
      unavailablePage: isUnavailableXiaohongshuPage(html, resolvedUrl),
    },
  };
}

function createRetryableXiaohongshuContentError(diagnostic = {}) {
  const error = new Error('小红书内容提取失败，已记录诊断，下次同步将重试。');
  error.retryable = true;
  error.code = 'XIAOHONGSHU_CONTENT_UNAVAILABLE';
  error.diagnostic = redactSensitiveObject(
    diagnostic && typeof diagnostic === 'object' ? diagnostic : {},
  );
  return error;
}

function isRetryableXiaohongshuContentError(error) {
  return Boolean(error && error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE');
}

function getRecordXiaohongshuIdentityCandidates(record = {}) {
  const metadata = record && record.metadata && typeof record.metadata === 'object'
    ? record.metadata
    : {};
  return [
    record && record.content,
    metadata.url,
    metadata.originalUrl,
    metadata.resolvedUrl,
    metadata.canonicalUrl,
    metadata.sourceUrl,
    metadata.noteUrl,
    metadata.shareUrl,
  ].map((value) => String(value || '').trim()).filter(Boolean);
}

function hasRecoverableXiaohongshuRecordIdentity(record = {}) {
  const metadata = record && record.metadata && typeof record.metadata === 'object'
    ? record.metadata
    : {};
  const explicitNoteId = [
    metadata.noteId,
    metadata.note_id,
    metadata.xiaohongshuNoteId,
    metadata.xhsNoteId,
  ].map((value) => String(value || '').trim()).find(Boolean);
  if (explicitNoteId) return true;
  return getRecordXiaohongshuIdentityCandidates(record)
    .some((candidate) => Boolean(getXiaohongshuTargetNoteId(candidate)));
}

function isPermanentlyExpiredXiaohongshuShortlinkRecord(record = {}, error = null) {
  if (!isRetryableXiaohongshuContentError(error)) return false;
  const metadata = record && record.metadata && typeof record.metadata === 'object'
    ? record.metadata
    : {};
  if ([
    metadata.fileID,
    metadata.fileId,
    metadata.audioFileID,
    metadata.audioFileId,
  ].some((value) => String(value || '').trim())) return false;
  const candidates = getRecordXiaohongshuIdentityCandidates(record);
  if (!candidates.some((candidate) => isXiaohongshuShortLinkUrl(candidate))) return false;
  if (hasRecoverableXiaohongshuRecordIdentity(record)) return false;

  const diagnostic = error && error.diagnostic && typeof error.diagnostic === 'object'
    ? error.diagnostic
    : {};
  const request = diagnostic.request && typeof diagnostic.request === 'object'
    ? diagnostic.request
    : {};
  const extraction = diagnostic.extraction && typeof diagnostic.extraction === 'object'
    ? diagnostic.extraction
    : {};
  const responseStatus = Number(request.responseStatus) || 0;
  const pageType = String(request.pageType || '');
  const finalHost = String(request.finalHost || '').toLowerCase();
  const browserAttempts = Array.isArray(request.browserAttempts)
    ? request.browserAttempts.filter((attempt) => attempt && attempt.attempted === true)
    : [];
  const browserFallbacksOnlyConfirmedFailure = browserAttempts.length > 0
    && browserAttempts.every((attempt) => (
      attempt.failed !== true
      && ['xiaohongshu-generic-landing', 'xiaohongshu-unavailable'].includes(
        String(attempt.pageType || ''),
      )
    ));

  return request.requestFailed !== true
    && request.renderFailed !== true
    && request.browserTimedOut !== true
    && responseStatus >= 200
    && responseStatus < 400
    && isHostnameWithinDomain(finalHost, 'xiaohongshu.com')
    && ['xiaohongshu-generic-landing', 'xiaohongshu-unavailable'].includes(pageType)
    && browserFallbacksOnlyConfirmedFailure
    && extraction.hasUsableTitle !== true;
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
  const normalizedScriptName = localPlatform === 'win32'
    ? path.win32.basename(normalizedScriptPath)
    : path.posix.basename(normalizedScriptPath);
  if (normalizedScriptName.toLowerCase() !== scriptName.toLowerCase()) return '';
  return localPlatform === 'win32'
    ? path.win32.dirname(normalizedScriptPath)
    : path.posix.dirname(normalizedScriptPath);
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
  return bindings.filter((item) => item.status !== 'needs_rebind').length < MAX_PLUGIN_BINDINGS;
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

function normalizeLocallyQuarantinedRecordIds(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  )].slice(0, 200);
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
  const canRestoreLegacyPendingBindCode = savedSettingsVersion < DEFAULT_SETTINGS.settingsVersion;
  const normalizedToken = normalizeBindCodeInput(merged.token)
    || entitlementBindingToken
    || (canRestoreLegacyPendingBindCode && !hasSourceBinding ? pendingBindToken : '');
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
  const tokenBinding = merged.bindings.find((item) => (
    item.token === normalizedToken
    && item.enabled !== false
    && item.status !== 'unbound'
    && item.status !== 'needs_rebind'
  ));
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
  merged.proEntitlementLastError = String(merged.proEntitlementLastError || '').trim();
  merged.proEntitlementLastErrorAt = String(merged.proEntitlementLastErrorAt || '').trim();
  merged.proSetupInstallPromptSnoozedUntil = String(merged.proSetupInstallPromptSnoozedUntil || '').trim();
  merged.clientId = String(merged.clientId || '').trim() || createClientId();
  merged.inboxDir = normalizeConfiguredVaultPath(merged.inboxDir);
  merged.noteSaveMode = normalizeNoteSaveMode(merged.noteSaveMode);
  merged.notePropertyFields = DEFAULT_NOTE_PROPERTY_FIELDS;
  merged.autoSyncOnLoad = true;
  merged.aiProvider = AI_PROVIDER_NAMES[merged.aiProvider] ? merged.aiProvider : DEFAULT_SETTINGS.aiProvider;
  merged.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  merged.aiMetadataEnabled = true;
  merged.xiaohongshuCommentsEnabled = savedSettingsVersion < 2
    ? true
    : merged.xiaohongshuCommentsEnabled !== false;
  merged.xiaohongshuImageOcrConsentVersion = Number(merged.xiaohongshuImageOcrConsentVersion) === 1 ? 1 : 0;
  merged.xiaohongshuImageOcrEnabled = merged.xiaohongshuImageOcrConsentVersion === 1
    && merged.xiaohongshuImageOcrEnabled === true;
  merged.saveOriginalMediaEnabled = merged.saveOriginalMediaEnabled === true;
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
  merged.locallyQuarantinedRecordIds = normalizeLocallyQuarantinedRecordIds(
    merged.locallyQuarantinedRecordIds,
  );
  merged.pendingSyncLifecycleAttempts = normalizePendingSyncLifecycleAttempts(
    merged.pendingSyncLifecycleAttempts,
  );

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
    || text.includes('Invalid or expired token');
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
    const signal = options && options.signal;
    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }
    let settled = false;
    let request = null;
    const cleanupAbort = () => {
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      callback(value);
    };
    const onAbort = () => {
      const error = createAbortError();
      if (request && typeof request.destroy === 'function') request.destroy(error);
      settle(reject, error);
    };
    let parsedUrl;
    try {
      parsedUrl = new URL(options.url);
    } catch (error) {
      settle(reject, error);
      return;
    }

    const transport = parsedUrl.protocol === 'http:' ? http : https;
    const body = options.body || '';
    const maxBytes = Number(options.maxBytes) > 0
      ? Number(options.maxBytes)
      : 16 * 1024 * 1024;
    const headers = {
      ...(options.headers || {}),
      'User-Agent': 'WeChat-Inbox-Sync-Obsidian/1.0',
    };
    if (body && !headers['Content-Length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    request = transport.request(parsedUrl, {
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 20000,
    }, (response) => {
      const chunks = [];
      let receivedBytes = 0;
      let rejectedForSize = false;
      response.on('data', (chunk) => {
        if (rejectedForSize) return;
        const buffer = Buffer.from(chunk);
          receivedBytes += buffer.length;
          if (receivedBytes > maxBytes) {
            rejectedForSize = true;
            const error = new Error('Node HTTP response exceeded the configured size limit');
            settle(reject, error);
            if (typeof response.destroy === 'function') response.destroy(error);
            if (typeof request.destroy === 'function') request.destroy(error);
            return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        if (rejectedForSize) return;
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (error) {
          json = null;
        }
        settle(resolve, {
          status: response.statusCode,
          headers: response.headers,
          text,
          json,
          arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        });
      });
      response.on('error', (error) => settle(reject, error));
    });

    request.on('timeout', () => {
      request.destroy(new Error('Node HTTP request timeout'));
    });
    request.on('error', (error) => settle(reject, error));
    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }
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

function waitForPromiseWithAbort(promise, signal) {
  throwIfAborted(signal);
  if (!signal || typeof signal.addEventListener !== 'function') {
    return Promise.resolve(promise);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
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

function isVideoPlatform(platform, url = '') {
  const source = `${String(platform || '')} ${String(url || '')}`.toLowerCase();
  return /抖音|小红书|b站|bilibili|douyin|xiaohongshu/.test(source);
}

function cleanTrailingTranscriptionHallucinations(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return lines.join('\n');
  const isCredit = (line) => /^(?:字幕|字幕\s*by|字幕\s*:|翻译|校对|制作|subtitles?\s*(?:by|:))/i.test(line);
  const isCorruptedClosing = (line) => /(?:我们|咱们).{0,10}(?:下身|下生|下声|下省)(?:再见|见)[。！!]?$/u.test(line);
  const isShortAsciiNoise = (line) => /^[a-z\s'.,!?-]{1,40}$/i.test(line);
  const isRepeatedVisualNoise = (line) => /画面.{0,8}画面/u.test(line);
  const knownTailHallucinationStart = lines.findIndex((line, index) => (
    index >= Math.max(1, lines.length - 12)
    && /请不吝.{0,12}点赞.{0,12}订阅.{0,12}转发.{0,12}打赏.{0,20}明镜/u.test(line)
  ));
  let cutoff = knownTailHallucinationStart >= 0 ? knownTailHallucinationStart : lines.length;
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const line = lines[index];
    const repeated = line === lines[index - 1];
    if (isCredit(line) || isCorruptedClosing(line) || repeated) {
      cutoff = Math.min(cutoff, repeated ? index - 1 : index);
      continue;
    }
    if (cutoff < lines.length && (isShortAsciiNoise(line) || isRepeatedVisualNoise(line))) {
      cutoff = index;
      continue;
    }
    break;
  }

  // Whisper may return a complete, useful transcript followed by a silent-end
  // hallucination loop. The loop can end with one unrelated short word, which
  // means a simple backward adjacent-line check never reaches it. When a
  // high-frequency loop is confined to the tail and a substantive prefix
  // exists, retain that prefix instead of rejecting the whole media item.
  const tailStart = Math.max(3, lines.length - 36);
  const tailOccurrences = new Map();
  lines.slice(tailStart).forEach((line, offset) => {
    const normalized = normalizeTranscriptionQualityUnit(line);
    if (normalized.length < 4) return;
    const indexes = tailOccurrences.get(normalized) || [];
    indexes.push(tailStart + offset);
    tailOccurrences.set(normalized, indexes);
  });
  let repeatedTailStart = lines.length;
  tailOccurrences.forEach((indexes) => {
    if (indexes.length >= 6) {
      repeatedTailStart = Math.min(repeatedTailStart, indexes[0]);
    }
  });
  if (repeatedTailStart < lines.length) {
    const prefix = lines.slice(0, repeatedTailStart).join('');
    if (repeatedTailStart >= 3 && prefix.length >= 80) {
      cutoff = Math.min(cutoff, repeatedTailStart);
      for (let index = cutoff - 1; index >= 1; index -= 1) {
        const line = lines[index];
        if (isCredit(line) || isShortAsciiNoise(line) || isRepeatedVisualNoise(line)) {
          cutoff = index;
          continue;
        }
        break;
      }
    }
  }
  return lines.slice(0, cutoff).join('\n').trim();
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

function sleep(ms) {
  const schedule = typeof globalThis !== 'undefined' && typeof globalThis.setTimeout === 'function'
    ? globalThis.setTimeout.bind(globalThis)
    : window.setTimeout.bind(window);
  return new Promise((resolve) => schedule(resolve, ms));
}

function shouldGenerateAiMetadata(settings, record) {
  if (!record || !record.metadata) return false;
  const metadata = record.metadata || {};
  if (!extractAiMetadataInputText(record)) return false;
  const type = String(record.type || '').toLowerCase();
  const hasCompletedTranscript = metadata.transcriptionStatus === 'success'
    && String(metadata.transcription || '').trim()
    && (
      metadata.transcriptOnly
      || metadata.webpageMediaType === 'audio_video'
      || type === 'voice'
      || (type === 'file' && metadata.transcriptionSource)
    );
  if (hasCompletedTranscript) return true;
  if (type === 'webpage' || type === 'link') {
    return true;
  }
  return !getRecordDescription(metadata) || !getRecordKeywords(metadata).length;
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
    const listIndentMatch = options.preserveListIndent
      ? rawLine.match(/^([ \t]+)(?=[-*]\s+)/)
      : null;
    const listIndent = listIndentMatch && listIndentMatch[1] ? listIndentMatch[1] : '';
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

    out.push(listIndent && /^[-*]\s+/.test(text) ? `${listIndent}${text}` : text);
    lastWasBlank = false;
  });

  let cleaned = restoreFlattenedSarBandTables(out).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (options.feishuTitle) {
    cleaned = postProcessFeishuMarkdown(cleaned, options.feishuTitle);
  }
  return cleaned;
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function getHttpUrlHostname(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return String(parsed.hostname || '').toLowerCase().replace(/\.$/, '');
  } catch (error) {
    return '';
  }
}

function isHostnameWithinDomain(hostname, domain) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const root = String(domain || '').toLowerCase().replace(/\.$/, '');
  return Boolean(host && root && (host === root || host.endsWith(`.${root}`)));
}

function isXiaohongshuUrl(url) {
  const hostname = getHttpUrlHostname(url);
  return isHostnameWithinDomain(hostname, 'xiaohongshu.com')
    || isHostnameWithinDomain(hostname, 'xhslink.com')
    || isHostnameWithinDomain(hostname, 'xhslink.cn');
}

function isXiaohongshuShortLinkUrl(url) {
  const hostname = getHttpUrlHostname(url);
  return isHostnameWithinDomain(hostname, 'xhslink.com')
    || isHostnameWithinDomain(hostname, 'xhslink.cn');
}

function isTrustedXiaohongshuCookieUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && (!parsed.port || parsed.port === '443')
      && isHostnameWithinDomain(parsed.hostname, 'xiaohongshu.com');
  } catch (error) {
    return false;
  }
}

function isTrustedXiaohongshuTransportUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && (!parsed.port || parsed.port === '443')
      && (
        isHostnameWithinDomain(parsed.hostname, 'xiaohongshu.com')
        || isHostnameWithinDomain(parsed.hostname, 'xhslink.com')
        || isHostnameWithinDomain(parsed.hostname, 'xhslink.cn')
      );
  } catch (error) {
    return false;
  }
}

function isDouyinUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('douyin.com') || text.includes('iesdouyin.com') || text.includes('amemv.com');
}

function isDouyinMediaUrl(url) {
  return /douyinvod\.com|zjcdn\.com\/tos-|snssdk\.com\/aweme\/v1\/play|bytedance[^/]*\.com\/.*(?:tos-|video)|mime_type=video/i.test(String(url || ''));
}

function extractDouyinAwemeId(url) {
  const text = String(url || '');
  const patterns = [
    /\/video\/(\d{8,})/i,
    /\/share\/video\/(\d{8,})/i,
    /\/aweme\/detail\/(\d{8,})/i,
    /[?&](?:aweme_id|item_id|item_ids)=(\d{8,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1];
  }
  return '';
}

function normalizeDouyinTargetUrl(originalUrl, resolvedUrl = '') {
  const original = String(originalUrl || '').trim();
  const resolved = String(resolvedUrl || '').trim();
  const awemeId = extractDouyinAwemeId(resolved) || extractDouyinAwemeId(original);
  if (awemeId) {
    return {
      awemeId,
      url: `https://www.douyin.com/video/${awemeId}`,
    };
  }
  const candidate = resolved || original;
  if (/^https?:\/\//i.test(candidate) && isDouyinUrl(candidate)) {
    return { awemeId: '', url: candidate };
  }
  return { awemeId: '', url: '' };
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

function getDouyinMobileSharePageUrls(awemeId) {
  const id = String(awemeId || '').trim();
  if (!id) return [];
  return [`https://www.iesdouyin.com/share/video/${encodeURIComponent(id)}/?from_ssr=1`];
}

function getDouyinMobileShareRequestHeaders(url) {
  return {
    ...getSocialRequestHeaders(url),
    'User-Agent': DOUYIN_MOBILE_SHARE_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: 'https://www.iesdouyin.com/',
  };
}

function parseJsonObjectAssignedTo(source, variableName) {
  const text = String(source || '');
  const assignmentIndex = text.indexOf(variableName);
  if (assignmentIndex < 0) return null;
  const objectStart = text.indexOf('{', assignmentIndex + variableName.length);
  if (objectStart < 0) return null;

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = objectStart; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(objectStart, index + 1));
        } catch (error) {
          return null;
        }
      }
    }
  }
  return null;
}

function extractDouyinMediaUrlsFromShareHtml(html, awemeId) {
  const source = String(html || '');
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(source))) {
    const payload = parseJsonObjectAssignedTo(match[1], 'window._ROUTER_DATA');
    const urls = extractDouyinMediaUrlsForAweme(payload, awemeId);
    if (urls.length) return urls;
  }
  return extractDouyinMediaUrlsForAweme(parseJsonObjectAssignedTo(source, 'window._ROUTER_DATA'), awemeId);
}

function findDouyinDetailForAweme(payload, awemeId) {
  const targetId = String(awemeId || '').trim();
  if (!targetId || !payload || typeof payload !== 'object') return null;
  const seen = new Set();
  let matched = null;
  const visit = (value, depth = 0) => {
    if (matched || !value || typeof value !== 'object' || depth > 16 || seen.size > 10000 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const candidateId = String(value.aweme_id || value.awemeId || '').trim();
    if (candidateId === targetId) {
      matched = value;
      return;
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(payload);
  return matched;
}

function extractDouyinDetailFromShareHtml(html, awemeId) {
  const source = String(html || '');
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(source))) {
    const detail = findDouyinDetailForAweme(
      parseJsonObjectAssignedTo(match[1], 'window._ROUTER_DATA'),
      awemeId,
    );
    if (detail) return detail;
  }
  return findDouyinDetailForAweme(
    parseJsonObjectAssignedTo(source, 'window._ROUTER_DATA'),
    awemeId,
  );
}

function collectDouyinImageUrlList(value, urls) {
  if (!value) return;
  if (typeof value === 'string') {
    pushUniqueUrl(urls, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDouyinImageUrlList(item, urls));
    return;
  }
  if (typeof value === 'object') {
    collectDouyinImageUrlList(value.url_list, urls);
    collectDouyinImageUrlList(value.urlList, urls);
    collectDouyinImageUrlList(value.url, urls);
    collectDouyinImageUrlList(value.uri, urls);
  }
}

function deriveDouyinTitleFromDescription(description = '') {
  const cleanedDescription = cleanSocialDescription(description);
  if (!cleanedDescription) return '';
  const firstContentLine = cleanedDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) || '';
  const withoutInlineTags = firstContentLine.replace(/\s*#[\p{L}\p{N}_-].*$/u, '').trim();
  const candidate = withoutInlineTags || firstContentLine;
  if (candidate.length <= 80) return candidate;
  const firstSentence = candidate.split(/[。！？!?；;]/, 1)[0].trim();
  if (firstSentence && firstSentence.length <= 80) return firstSentence;
  return `${candidate.slice(0, 77).trim()}...`;
}

function isGenericDouyinTitle(title = '') {
  const compact = String(title || '')
    .toLowerCase()
    .replace(/[\s\-_|·•]+/g, '');
  return !compact
    || compact === '抖音'
    || compact === 'douyin'
    || compact === '抖音短视频'
    || compact === '记录美好生活'
    || compact === '抖音记录美好生活';
}

function buildDouyinStructuredContent(detail = {}, fallback = {}) {
  const source = detail && typeof detail === 'object' ? detail : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : {};
  const description = cleanSocialDescription(
    source.desc
    || source.description
    || fallbackSource.description
    || '',
  );
  const title = [
    source.title,
    source.preview_title,
    source.previewTitle,
    fallbackSource.title,
  ]
    .map((candidate) => cleanSocialDescription(candidate || ''))
    .find((candidate) => candidate
      && candidate !== description
      && candidate.length <= 80
      && !candidate.includes('\n')
      && !isGenericDouyinTitle(candidate))
    || deriveDouyinTitleFromDescription(description);
  const structuredTags = [];
  const rememberTag = (value) => {
    const tag = String(value || '').replace(/^#+/, '').trim();
    if (tag && !structuredTags.includes(tag)) structuredTags.push(tag);
  };
  (Array.isArray(source.text_extra) ? source.text_extra : []).forEach((item) => {
    rememberTag(item && (item.hashtag_name || item.hashtagName));
  });
  (Array.isArray(source.cha_list) ? source.cha_list : []).forEach((item) => {
    rememberTag(item && (item.cha_name || item.chaName));
  });
  extractTagsFromText(description).forEach(rememberTag);
  if (!structuredTags.length) {
    (Array.isArray(fallbackSource.tags) ? fallbackSource.tags : []).forEach(rememberTag);
  }

  const video = source.video && typeof source.video === 'object' ? source.video : {};
  const coverUrls = [];
  [
    video.cover,
    video.origin_cover,
    video.originCover,
    video.dynamic_cover,
    video.dynamicCover,
    video.animated_cover,
    video.animatedCover,
  ].forEach((value) => collectDouyinImageUrlList(value, coverUrls));
  const socialMetrics = buildSocialMetrics(source);
  return {
    title,
    description,
    tags: structuredTags,
    coverUrl: coverUrls[0] || String(fallbackSource.coverUrl || '').trim(),
    socialMetrics: hasSocialMetrics(socialMetrics)
      ? socialMetrics
      : (fallbackSource.socialMetrics || {}),
  };
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

function isSafeAutomaticWebpageUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    return Boolean(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function isTrustedAutomaticPlatformUrl(url) {
  const hostname = getHttpUrlHostname(url);
  return isHostnameWithinDomain(hostname, 'mp.weixin.qq.com')
    || isHostnameWithinDomain(hostname, 'feishu.cn')
    || isHostnameWithinDomain(hostname, 'feishu.net')
    || isHostnameWithinDomain(hostname, 'larksuite.com')
    || isHostnameWithinDomain(hostname, 'xiaohongshu.com')
    || isHostnameWithinDomain(hostname, 'xhslink.com')
    || isHostnameWithinDomain(hostname, 'xhslink.cn')
    || isHostnameWithinDomain(hostname, 'douyin.com')
    || isHostnameWithinDomain(hostname, 'iesdouyin.com')
    || isHostnameWithinDomain(hostname, 'amemv.com')
    || isHostnameWithinDomain(hostname, 'bilibili.com')
    || isHostnameWithinDomain(hostname, 'b23.tv')
    || isHostnameWithinDomain(hostname, 'xiaoyuzhoufm.com')
    || isHostnameWithinDomain(hostname, 'xiaoyuzhou.com');
}

function extractAutomaticWebpageUrlCandidates(text) {
  const matches = String(text || '').match(/https?:\/\/[a-z0-9\-._~:/?#\[\]@!$&()*+,;=%]+/gi) || [];
  const unique = [];
  const seen = new Set();
  for (const match of matches) {
    const candidate = String(match || '').replace(/[)\]}>，。！？、；："'~.,!;]+$/g, '');
    if (!candidate || !isSafeAutomaticWebpageUrl(candidate)) continue;
    let normalized;
    try {
      normalized = new URL(candidate).toString();
      if (!/[/?#]$/.test(candidate) && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
    } catch (error) {
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(normalized);
    }
  }
  return unique;
}

function selectAutomaticWebpageUrlFromText(text) {
  const candidates = extractAutomaticWebpageUrlCandidates(text);
  if (candidates.length === 1) return candidates[0];
  const supportedPlatformCandidates = candidates.filter((url) => isTrustedAutomaticPlatformUrl(url));
  return supportedPlatformCandidates.length === 1 ? supportedPlatformCandidates[0] : '';
}

function getSafeRedirectRequestHeaders(sourceUrl, targetUrl, headers = {}) {
  const result = { ...(headers && typeof headers === 'object' ? headers : {}) };
  let mayRetainSensitiveHeaders = false;
  try {
    const source = new URL(String(sourceUrl || '').trim());
    const target = new URL(String(targetUrl || '').trim());
    mayRetainSensitiveHeaders = source.protocol === 'https:'
      && target.protocol === 'https:'
      && source.origin === target.origin;
  } catch (error) {
    mayRetainSensitiveHeaders = false;
  }
  if (mayRetainSensitiveHeaders) return result;

  const safeCrossOriginHeaderNames = new Set([
    'accept',
    'accept-language',
    'user-agent',
  ]);
  for (const headerName of Object.keys(result)) {
    if (!safeCrossOriginHeaderNames.has(String(headerName || '').trim().toLowerCase())) {
      delete result[headerName];
    }
  }
  return result;
}

function requestPublicWebpageText(url, options = {}) {
  const source = String(url || '').trim();
  const redirectsRemaining = Number.isInteger(options.redirectsRemaining)
    ? options.redirectsRemaining
    : 5;
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 8 * 1024 * 1024;
  if (!isSafeAutomaticWebpageUrl(source)) {
    return Promise.reject(new Error('网页地址不是可自动访问的 HTTP(S) 地址'));
  }
  if (redirectsRemaining < 0) {
    return Promise.reject(new Error('网页跳转次数过多'));
  }

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(source);
    } catch (error) {
      reject(new Error('网页地址格式无效'));
      return;
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.request(parsed, {
      method: 'GET',
      headers: options.headers || getSocialRequestHeaders(source),
    }, (response) => {
      const location = response.headers && response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        let redirectUrl;
        try {
          redirectUrl = new URL(location, source).toString();
        } catch (error) {
          reject(new Error('网页返回了无效跳转地址'));
          return;
        }
        if (typeof options.allowedRedirectUrl === 'function'
          && options.allowedRedirectUrl(redirectUrl, source) !== true) {
          reject(new Error('网页跳转到了不受信任的地址，已停止抓取'));
          return;
        }
        requestPublicWebpageText(redirectUrl, {
          ...options,
          headers: options.headers
            ? getSafeRedirectRequestHeaders(source, redirectUrl, options.headers)
            : getSocialRequestHeaders(redirectUrl),
          redirectsRemaining: redirectsRemaining - 1,
        }).then(resolve, reject);
        return;
      }
      const chunks = [];
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          request.destroy(new Error('网页正文超过安全大小限制'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          status: Number(response.statusCode) || 0,
          text: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers || {},
          url: source,
        });
      });
      response.on('error', reject);
    });
    request.setTimeout(10000, () => {
      request.destroy(new Error('网页抓取超时'));
    });
    request.on('error', reject);
    request.end();
  });
}

function isAutomaticWebpageHydrationSuccessful(record) {
  const metadata = record && record.metadata || {};
  const conversionStatus = String(metadata.conversionStatus || '').toLowerCase();
  const transcriptionStatus = String(metadata.transcriptionStatus || '').toLowerCase();
  if (['failed', 'link_saved', 'wechat_captcha'].includes(conversionStatus)) return false;
  if (transcriptionStatus === 'failed') return false;
  const hasStoredContent = Boolean(String(
    metadata.markdown
      || metadata.snapshot
      || metadata.contentSnapshot
      || metadata.transcription
      || metadata.convertedMarkdown
      || '',
  ).trim());
  return (conversionStatus === 'success' || transcriptionStatus === 'success') && hasStoredContent;
}

function createAutomaticWebpageExtractionError(url) {
  const host = getSafeUrlDiagnostic(url).host || 'unknown-host';
  const error = new Error(`剪切板链接网页提取失败，已保留待重试：${host}`);
  error.code = 'AUTOMATIC_WEBPAGE_EXTRACTION_FAILED';
  return error;
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

function getRedirectFallbackCandidates(source, method, resolverState) {
  if (method !== 'HEAD') return [];
  const candidates = [];
  try {
    const parsed = new URL(source);
    if (isXiaohongshuShortLinkUrl(source) && parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
      candidates.push(parsed.toString());
    }
  } catch (error) {
    // The caller already validated the source URL; keep the original GET fallback below.
  }
  candidates.push(source);

  const attempted = resolverState.fallbackRequestKeys;
  return candidates.filter((candidate) => {
    const key = `GET:${candidate}`;
    if (attempted.has(key)) return false;
    attempted.add(key);
    return true;
  });
}

function resolveRedirectFallbackCandidates(candidates, index, maxRedirects, resolverState, originalSource) {
  if (index >= candidates.length) {
    return Promise.resolve({ url: originalSource, diagnostic: resolverState.diagnostic });
  }
  const candidate = candidates[index];
  const attemptCountBefore = resolverState.diagnostic.attempts.length;
  return resolveRedirectUrlWithDiagnostics(candidate, maxRedirects, 'GET', resolverState).then((result) => {
    const finalAttempt = resolverState.diagnostic.attempts[resolverState.diagnostic.attempts.length - 1];
    const requestFailed = resolverState.diagnostic.attempts.length > attemptCountBefore
      && finalAttempt
      && (finalAttempt.outcome === 'request-error' || finalAttempt.outcome === 'timeout');
    if (requestFailed) {
      return resolveRedirectFallbackCandidates(candidates, index + 1, maxRedirects, resolverState, originalSource);
    }
    return result;
  });
}

function resolveRedirectUrlWithDiagnostics(url, maxRedirects = 5, method = 'HEAD', state = null) {
  const source = String(url || '').trim();
  const resolverState = state && state.diagnostic
    ? state
    : {
      diagnostic: state || {
        attempts: [],
        redirectCount: 0,
        usedGetFallback: false,
      },
      fallbackRequestKeys: new Set(),
      originalSource: source,
    };
  if (!resolverState.originalSource) resolverState.originalSource = source;
  const diagnostic = resolverState.diagnostic;
  const resolveGetFallback = () => {
    const candidates = getRedirectFallbackCandidates(source, method, resolverState);
    if (!candidates.length) return Promise.resolve({ url: source, diagnostic });
    diagnostic.usedGetFallback = true;
    return resolveRedirectFallbackCandidates(candidates, 0, maxRedirects, resolverState, source);
  };
  if (!/^https?:\/\//i.test(source) || maxRedirects <= 0) {
    return Promise.resolve({ url: source, diagnostic });
  }
  if (!isSafeAutomaticWebpageUrl(source)) {
    diagnostic.attempts.push({
      method,
      status: 0,
      host: getSafeUrlDiagnostic(source).host,
      outcome: 'blocked-url',
    });
    return Promise.resolve({ url: source, diagnostic });
  }

  return new Promise((resolve) => {
    let settled = false;
    let parsed;
    try {
      parsed = new URL(source);
    } catch (error) {
      diagnostic.attempts.push({
        method,
        status: 0,
        host: '',
        outcome: 'invalid-url',
      });
      resolve({ url: source, diagnostic });
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.request(parsed, {
      method,
      headers: getSocialRequestHeaders(source),
    }, (response) => {
      if (settled) {
        response.resume();
        return;
      }
      settled = true;
      const location = response.headers && response.headers.location;
      response.resume();
      const attempt = {
        method,
        status: Number(response.statusCode) || 0,
        host: getSafeUrlDiagnostic(source).host,
        outcome: 'response',
      };
      diagnostic.attempts.push(attempt);
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        let redirectUrl = '';
        try {
          redirectUrl = new URL(location, source).toString();
        } catch (error) {
          attempt.outcome = 'invalid-redirect';
          resolve({ url: source, diagnostic });
          return;
        }
        diagnostic.redirectCount += 1;
        if (isXiaohongshuShortLinkUrl(resolverState.originalSource)
          && !isXiaohongshuUrl(redirectUrl)) {
          attempt.outcome = 'blocked-redirect';
          resolve({ url: redirectUrl, diagnostic });
          return;
        }
        attempt.outcome = 'redirect';
        resolve(resolveRedirectUrlWithDiagnostics(
          redirectUrl,
          maxRedirects - 1,
          'HEAD',
          resolverState,
        ));
        return;
      }
      if (method === 'HEAD' && shouldRetryRedirectWithGet(source, response.statusCode)) {
        resolve(resolveGetFallback());
        return;
      }
      resolve({ url: source, diagnostic });
    });

    request.setTimeout(8000, () => {
      if (settled) return;
      settled = true;
      diagnostic.attempts.push({
        method,
        status: 0,
        host: getSafeUrlDiagnostic(source).host,
        outcome: 'timeout',
      });
      request.destroy();
      if (method === 'HEAD' && isXiaohongshuShortLinkUrl(source)) {
        resolve(resolveGetFallback());
        return;
      }
      resolve({ url: source, diagnostic });
    });
    request.on('error', () => {
      if (settled) return;
      settled = true;
      diagnostic.attempts.push({
        method,
        status: 0,
        host: getSafeUrlDiagnostic(source).host,
        outcome: 'request-error',
      });
      if (method === 'HEAD' && isXiaohongshuShortLinkUrl(source)) {
        resolve(resolveGetFallback());
        return;
      }
      resolve({ url: source, diagnostic });
    });
    request.end();
  });
}

async function resolveRedirectUrl(url, maxRedirects = 5, method = 'HEAD') {
  const result = await resolveRedirectUrlWithDiagnostics(url, maxRedirects, method);
  return result.url;
}

function shouldResolvePlatformRedirect(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('b23.tv')
    || text.includes('v.douyin.com')
    || isXiaohongshuShortLinkUrl(url)
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

function normalizePendingReviewSummary(summary = {}) {
  return {
    total: Math.max(0, Number(summary && summary.total) || 0),
    audioVideoCount: Math.max(0, Number(summary && summary.audioVideoCount) || 0),
  };
}

function mergePendingReviewSummaries(summaries = []) {
  return (Array.isArray(summaries) ? summaries : []).reduce((merged, summary) => {
    const normalized = normalizePendingReviewSummary(summary);
    return {
      total: merged.total + normalized.total,
      audioVideoCount: merged.audioVideoCount + normalized.audioVideoCount,
    };
  }, { total: 0, audioVideoCount: 0 });
}

function buildPendingReviewNotice(summary = {}) {
  const normalized = normalizePendingReviewSummary(summary);
  if (normalized.audioVideoCount > 0) {
    return `有 ${normalized.audioVideoCount} 条音频/音视频正在微信安全审核，通过后会自动进入转写`;
  }
  if (normalized.total > 0) {
    return `有 ${normalized.total} 条内容正在微信安全审核，通过后会自动进入同步`;
  }
  return '';
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

function buildSocialMediaSupplementalMarkdown({
  title = '',
  description = '',
  tags = [],
  imageUrls = [],
} = {}) {
  const cleanedTitle = String(title || '').trim();
  const cleanedDescription = String(description || '').trim();
  const normalizedTags = (Array.isArray(tags) ? tags : extractKeywordList(tags))
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
  const normalizedImages = (Array.isArray(imageUrls) ? imageUrls : [])
    .map((url) => normalizeExtractedUrl(url))
    .filter((url) => /^https?:\/\//i.test(url));
  const lines = [];
  if (cleanedTitle) lines.push('## 标题', '', cleanedTitle, '');
  if (cleanedDescription) lines.push('## 原文正文', '', cleanedDescription, '');
  if (normalizedTags.length) {
    lines.push('## 标签', '', Array.from(new Set(normalizedTags)).join(' '), '');
  }
  if (normalizedImages.length) {
    lines.push('## 封面图', '', `![封面](${normalizedImages[0]})`, '');
  }
  return cleanMarkdownForStorage(lines.join('\n').trim());
}

function buildSocialMediaSupplementalMarkdownFromHtml(html, url = '') {
  const metadata = extractWebpageMetadataFromHtml(html, url);
  const descriptionTags = extractTagsFromText(metadata.description, html);
  const preferredCover = normalizeExtractedUrl(extractMetaContent(html, ['og:image', 'twitter:image']));
  const isBilibiliPlaceholder = (imageUrl) => isBilibiliUrl(url)
    && /\/bfs\/static\/jinkela\/|\/long\/images\/512\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(String(imageUrl || ''));
  return buildSocialMediaSupplementalMarkdown({
    title: metadata.title,
    description: metadata.description,
    tags: descriptionTags.length ? descriptionTags : metadata.keywords,
    imageUrls: [preferredCover, ...collectImageUrlsFromHtml(html)]
      .filter(Boolean)
      .filter((imageUrl) => !isBilibiliPlaceholder(imageUrl)),
  });
}

function extractSocialMetricsFromLabeledHtml(html = '') {
  const source = String(html || '');
  const labels = '(?:视频)?播放(?:量|数|次数)?|(?:点赞|获赞)(?:量|数|次数)?|收藏(?:量|数|人数|次数)?|(?:评论|回复)(?:量|数|次数)?|(?:转发|分享)(?:量|数|人数|次数)?|(?:投硬币|硬币)(?:枚数|数|量|次数)?';
  const count = '\\d+(?:\\.\\d+)?\\s*(?:万|w|k)?';
  const pairPattern = new RegExp(
    `<(?:span|div|li|em|strong|button)\\b[^>]*>\\s*(${labels})\\s*<\\/(?:span|div|li|em|strong|button)>\\s*<(?:span|div|li|em|strong|button)\\b[^>]*>\\s*(${count})\\s*<\\/(?:span|div|li|em|strong|button)>`,
    'gi',
  );
  const pairs = [];
  let match;
  while ((match = pairPattern.exec(source))) pairs.push(`${match[1]} ${match[2]}`);
  return buildSocialMetricsFromText(pairs.join(' '));
}

function extractSocialMetricsFromHtml(html = '') {
  const blocks = collectTopLevelJsonObjectBlocks(html, {
    maxBlocks: 20,
    maxBlockCharacters: 1024 * 1024,
    maxTotalCharacters: 2 * 1024 * 1024,
    requiredTexts: ['"stat"', '"statistics"', '"playCount"', '"viewCount"'],
  });
  for (const block of blocks) {
    const metrics = buildSocialMetrics(tryParseJson(block));
    if (hasSocialMetrics(metrics)) return metrics;
  }
  return extractSocialMetricsFromLabeledHtml(html);
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
  return /(?:media\.xyzcdn\.net|finder\.video\.qq\.com|mpvideo|bilivideo\.com|bilibili\.com\/.*audio|(?:douyin\.com|snssdk\.com)\/aweme\/v1\/play|douyinvod\.com|zjcdn\.com\/tos-|bytedance[^/]*\.com\/.*(?:tos-|video)|mime_type=video)/i.test(url);
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
  const seen = new Set();
  return (urls || [])
    .map((url, index) => ({ url: normalizeExtractedUrl(url), index }))
    .filter((item) => {
      if (!/^https?:\/\//i.test(item.url) || !isLikelyMediaUrl(item.url) || seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      return true;
    })
    .sort((a, b) => {
      const scoreDiff = getTranscriptionMediaScore(b.url) - getTranscriptionMediaScore(a.url);
      return scoreDiff || a.index - b.index;
    })
    .map((item) => item.url);
}

function collectBrowserCapturedMediaUrls(value, urls = [], seen = new Set(), depth = 0, state = null) {
  const traversal = state && state.urlSet instanceof Set
    ? state
    : {
      urlSet: new Set(urls),
      visitedNodes: 0,
      visitedEntries: 0,
      truncated: false,
    };
  if (value === undefined || value === null || depth > 5) return urls;
  if (urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS
    || traversal.visitedNodes >= BROWSER_MEDIA_CAPTURE_MAX_NODES) {
    traversal.truncated = true;
    return urls;
  }
  traversal.visitedNodes += 1;
  const add = (candidate) => {
    if (urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS) {
      traversal.truncated = true;
      return;
    }
    const normalized = normalizeExtractedUrl(candidate);
    if (!/^https?:\/\//i.test(normalized)
      || !isLikelyMediaUrl(normalized)
      || traversal.urlSet.has(normalized)) return;
    traversal.urlSet.add(normalized);
    urls.push(normalized);
  };
  if (typeof value === 'string') {
    const source = value.slice(0, BROWSER_MEDIA_CAPTURE_MAX_STRING_CHARACTERS);
    if (value.length > source.length) traversal.truncated = true;
    add(source);
    for (const mediaUrl of extractLooseMediaUrlsFromText(source)) {
      add(mediaUrl);
      if (urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS) break;
    }
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectBrowserCapturedMediaUrls(item, urls, seen, depth + 1, traversal);
      if (traversal.truncated || urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS) break;
    }
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
  ].forEach((key) => collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1, traversal));

  ['request', 'response', 'resource', 'details'].forEach((key) => {
    if (value[key]) collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1, traversal);
  });

  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    traversal.visitedEntries += 1;
    if (traversal.visitedEntries > BROWSER_MEDIA_CAPTURE_MAX_NODES
      || urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS) {
      traversal.truncated = true;
      break;
    }
    if (/url|src|media|video|audio|stream|download|play|name/i.test(key)) {
      collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1, traversal);
    }
  }

  return urls;
}

function normalizeBrowserCapturedMediaUrls(items) {
  const urls = [];
  collectBrowserCapturedMediaUrls(items, urls);
  return sortMediaUrlsForTranscription(urls).slice(0, BROWSER_MEDIA_CAPTURE_MAX_URLS);
}

// Social pages can attempt to hand off short links or media playback to a
// native app (for example, bytedance://). The sync pipeline must never let
// those protocols escape to the operating system: ordinary HTTP parsing keeps
// working, while an unsafe hand-off is stopped before Windows can prompt.
function shouldBlockExternalAppUrl(value) {
  const url = String(value || '').trim();
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return !['http:', 'https:', 'blob:', 'data:', 'about:'].includes(protocol);
  } catch (error) {
    return false;
  }
}

const DOUYIN_EXTERNAL_PROTOCOLS = ['bytedance', 'snssdk1128'];

async function installDouyinExternalProtocolHandlers(session) {
  const protocol = session && session.protocol;
  if (!protocol) return false;
  let installedAny = false;
  for (const scheme of DOUYIN_EXTERNAL_PROTOCOLS) {
    try {
      if (typeof protocol.handle === 'function') {
        const handled = typeof protocol.isProtocolHandled === 'function'
          ? protocol.isProtocolHandled(scheme)
          : false;
        if (!handled) {
          protocol.handle(scheme, async () => new Response(null, { status: 204 }));
          installedAny = true;
        }
        continue;
      }
      if (typeof protocol.registerStringProtocol === 'function') {
        const registered = typeof protocol.isProtocolRegistered === 'function'
          ? protocol.isProtocolRegistered(scheme)
          : false;
        if (!registered) {
          protocol.registerStringProtocol(
            scheme,
            (_request, callback) => callback({ data: '', mimeType: 'text/plain' }),
          );
          installedAny = true;
        }
      }
    } catch (error) {
      // Navigation and webRequest guards remain active if protocol registration is unavailable.
    }
  }
  return installedAny;
}

function installExternalAppNavigationGuards(webContents) {
  if (!webContents) return;
  const preventExternalNavigation = (event, navigationUrl) => {
    const targetUrl = typeof navigationUrl === 'string'
      ? navigationUrl
      : (navigationUrl && navigationUrl.url) || (event && event.url);
    if (shouldBlockExternalAppUrl(targetUrl) && event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  };
  if (typeof webContents.on === 'function') {
    webContents.on('will-navigate', preventExternalNavigation);
    webContents.on('will-frame-navigate', preventExternalNavigation);
    webContents.on('will-redirect', preventExternalNavigation);
  }
  if (typeof webContents.setWindowOpenHandler === 'function') {
    webContents.setWindowOpenHandler((details) => (
      shouldBlockExternalAppUrl(details && details.url)
        ? { action: 'deny' }
        : { action: 'allow' }
    ));
  }
}

function isAllowedXiaohongshuBrowserNavigationUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (parsed.username || parsed.password) return false;
    if (isHostnameWithinDomain(parsed.hostname, 'xiaohongshu.com')) {
      return parsed.protocol === 'https:' && (!parsed.port || parsed.port === '443');
    }
    if (isHostnameWithinDomain(parsed.hostname, 'xhslink.com')
      || isHostnameWithinDomain(parsed.hostname, 'xhslink.cn')) {
      return (parsed.protocol === 'http:' && (!parsed.port || parsed.port === '80'))
        || (parsed.protocol === 'https:' && (!parsed.port || parsed.port === '443'));
    }
    return false;
  } catch (error) {
    return false;
  }
}

function shouldBlockXiaohongshuBrowserNavigationRequest(details = {}) {
  const resourceType = String(details && details.resourceType || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const isNavigation = resourceType === 'mainframe'
    || resourceType === 'subframe'
    || (
      !resourceType
      &&
      Number(details && details.frameId) === 0
      && Number(details && details.parentFrameId) < 0
    );
  return isNavigation && !isAllowedXiaohongshuBrowserNavigationUrl(details && details.url);
}

function installXiaohongshuNavigationGuards(webContents) {
  if (!webContents) return;
  const preventUntrustedNavigation = (event, navigationUrl) => {
    const targetUrl = typeof navigationUrl === 'string'
      ? navigationUrl
      : (navigationUrl && navigationUrl.url) || (event && event.url);
    if (!isAllowedXiaohongshuBrowserNavigationUrl(targetUrl)
      && event
      && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  };
  if (typeof webContents.on === 'function') {
    webContents.on('will-navigate', preventUntrustedNavigation);
    webContents.on('will-frame-navigate', preventUntrustedNavigation);
    webContents.on('will-redirect', preventUntrustedNavigation);
  }
  if (typeof webContents.setWindowOpenHandler === 'function') {
    // Extraction and comment collection never need a child window. Allowing even
    // trusted XHS targets here lets page-side window.open calls escape the hidden
    // renderer and create an unbounded number of visible Electron windows.
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
}

const activeXiaohongshuBrowserWindows = new Set();
let activeXiaohongshuLoginPromise = null;

function trackXiaohongshuBrowserWindow(browserWindow) {
  if (!browserWindow) return browserWindow;
  activeXiaohongshuBrowserWindows.add(browserWindow);
  if (typeof browserWindow.on === 'function') {
    browserWindow.on('closed', () => {
      activeXiaohongshuBrowserWindows.delete(browserWindow);
    });
  }
  return browserWindow;
}

function bindBrowserWindowToAbortSignal(browserWindow, signal) {
  if (!browserWindow || !signal || typeof signal.addEventListener !== 'function') {
    return () => {};
  }
  let cleaned = false;
  const closeWindow = () => {
    try {
      const destroyed = typeof browserWindow.isDestroyed === 'function'
        ? browserWindow.isDestroyed()
        : false;
      if (!destroyed && typeof browserWindow.destroy === 'function') {
        browserWindow.destroy();
      }
    } catch (error) {
      // The window may already be closing while the abort signal is delivered.
    }
  };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (typeof signal.removeEventListener === 'function') {
      signal.removeEventListener('abort', closeWindow);
    }
  };
  if (signal.aborted) {
    closeWindow();
  } else {
    signal.addEventListener('abort', closeWindow, { once: true });
  }
  return cleanup;
}

function closeActiveXiaohongshuBrowserWindows() {
  let closedCount = 0;
  for (const browserWindow of [...activeXiaohongshuBrowserWindows]) {
    activeXiaohongshuBrowserWindows.delete(browserWindow);
    try {
      const destroyed = typeof browserWindow.isDestroyed === 'function'
        ? browserWindow.isDestroyed()
        : false;
      if (!destroyed && typeof browserWindow.destroy === 'function') {
        browserWindow.destroy();
        closedCount += 1;
      }
    } catch (error) {
      // The window may have closed between the state check and destroy call.
    }
  }
  return closedCount;
}

function installXiaohongshuLoginWindowGuards(webContents) {
  installXiaohongshuNavigationGuards(webContents);
  if (webContents && typeof webContents.setWindowOpenHandler === 'function') {
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
}

function enableDebuggerNetworkCapture(debuggerApi) {
  if (!debuggerApi || typeof debuggerApi.sendCommand !== 'function') return false;
  try {
    const command = debuggerApi.sendCommand('Network.enable');
    if (command && typeof command.catch === 'function') {
      command.catch(() => {});
    }
    return true;
  } catch (error) {
    return false;
  }
}

function beginBestEffortBrowserLoad(browserWindow, url) {
  if (!browserWindow || typeof browserWindow.loadURL !== 'function') return false;
  try {
    const loadTask = browserWindow.loadURL(url);
    if (loadTask && typeof loadTask.catch === 'function') {
      loadTask.catch(() => {});
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function waitForBrowserTasksWithin(tasks, timeoutMs = 2500, timeoutTaskFactory = null) {
  const pendingTasks = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  if (!pendingTasks.length) return 'empty';
  let timer = null;
  const timeoutTask = typeof timeoutTaskFactory === 'function'
    ? Promise.resolve().then(() => timeoutTaskFactory(timeoutMs))
    : new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
  try {
    return await Promise.race([
      Promise.allSettled(pendingTasks).then(() => 'settled'),
      timeoutTask,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createBrowserTaskTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.code = 'BROWSER_TASK_TIMEOUT';
  return error;
}

async function runBrowserTaskWithTimeout(task, timeoutMs, label = 'browser task') {
  const boundedTimeoutMs = Math.max(1, Number(timeoutMs) || 1);
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(createBrowserTaskTimeoutError(label, boundedTimeoutMs)),
          boundedTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const getNormalizedAssetName = (pathname = '') => {
    const lastSegment = String(pathname || '').split('/').filter(Boolean).pop() || '';
    return lastSegment
      .replace(/!.+$/i, '')
      .replace(/\.(?:jpe?g|png|webp|bmp)$/i, '')
      .toLowerCase();
  };
  let xiaohongshuAssetName = '';
  try {
    const parsed = new URL(url);
    if (isHostnameWithinDomain(parsed.hostname, 'xhscdn.com')
      || isHostnameWithinDomain(parsed.hostname, 'xiaohongshu.com')) {
      xiaohongshuAssetName = getNormalizedAssetName(parsed.pathname);
    }
  } catch (error) {
    xiaohongshuAssetName = '';
  }
  if (xiaohongshuAssetName.length >= 20 && /^[a-z0-9_-]+$/i.test(xiaohongshuAssetName)) {
    return `xiaohongshu-asset:${xiaohongshuAssetName}`;
  }

  const noteImageMatch = url.match(/\/notes_pre_post\/([^"'\\\s<>?#]+)/i);
  if (noteImageMatch) return `notes_pre_post:${getNormalizedAssetName(noteImageMatch[1])}`;

  const spectrumImageMatch = url.match(/\/spectrum\/([^"'\\\s<>?#]+)/i);
  if (spectrumImageMatch) return `spectrum:${getNormalizedAssetName(spectrumImageMatch[1])}`;

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

function collectJsonArrayBlocks(source, keys, options = {}) {
  const wanted = (keys || []).map((key) => String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!wanted.length) return [];
  const pattern = new RegExp(`["'](?:${wanted.join('|')})["']\\s*:\\s*\\[`, 'gi');
  const blocks = [];
  const text = String(source || '');
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters))
    ? Math.max(1, Math.floor(Number(options.maxSourceCharacters)))
    : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return blocks;
  const maxBlocks = Number.isFinite(Number(options.maxBlocks))
    ? Math.max(1, Math.floor(Number(options.maxBlocks)))
    : Number.POSITIVE_INFINITY;
  const maxBlockCharacters = Number.isFinite(Number(options.maxBlockCharacters))
    ? Math.max(1, Math.floor(Number(options.maxBlockCharacters)))
    : Number.POSITIVE_INFINITY;
  const maxTotalCharacters = Number.isFinite(Number(options.maxTotalCharacters))
    ? Math.max(1, Math.floor(Number(options.maxTotalCharacters)))
    : Number.POSITIVE_INFINITY;
  let totalCharacters = 0;
  let match;
  while (blocks.length < maxBlocks && (match = pattern.exec(text))) {
    let depth = 1;
    let inString = '';
    let escaped = false;
    let closed = false;
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
        const blockLength = index + 1 - start;
        if (blockLength <= maxBlockCharacters
          && totalCharacters + blockLength <= maxTotalCharacters) {
          blocks.push(text.slice(start, index + 1));
          totalCharacters += blockLength;
        }
        pattern.lastIndex = index + 1;
        closed = true;
        break;
      }
    }
    if (!closed) break;
  }
  return blocks;
}

function collectTopLevelJsonObjectBlocks(source, options = {}) {
  const blocks = [];
  const text = String(source || '');
  const maxBlocks = Number.isFinite(Number(options.maxBlocks))
    ? Math.max(1, Math.floor(Number(options.maxBlocks)))
    : Number.POSITIVE_INFINITY;
  const maxBlockCharacters = Number.isFinite(Number(options.maxBlockCharacters))
    ? Math.max(1, Math.floor(Number(options.maxBlockCharacters)))
    : Number.POSITIVE_INFINITY;
  const maxTotalCharacters = Number.isFinite(Number(options.maxTotalCharacters))
    ? Math.max(1, Math.floor(Number(options.maxTotalCharacters)))
    : Number.POSITIVE_INFINITY;
  const requiredTexts = (Array.isArray(options.requiredTexts)
    ? options.requiredTexts
    : [options.requiredText])
    .map((value) => String(value || ''))
    .filter(Boolean);
  let totalCharacters = 0;
  let depth = 0;
  let start = -1;
  let inString = '';
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
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
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const blockLength = index + 1 - start;
        if (blockLength <= maxBlockCharacters
          && totalCharacters + blockLength <= maxTotalCharacters) {
          const blockText = text.slice(start, index + 1);
          const containsRequiredText = !requiredTexts.length
            || requiredTexts.some((requiredText) => blockText.includes(requiredText));
          if (containsRequiredText) {
            blocks.push(blockText);
            totalCharacters += blockLength;
          }
          if (blocks.length >= maxBlocks || totalCharacters >= maxTotalCharacters) return blocks;
        }
        start = -1;
      }
    }
  }
  return blocks;
}

function collectJsonStringValues(source, keys, options = {}) {
  const wanted = new Set((keys || []).map((key) => String(key || '').toLowerCase()));
  const values = [];
  const seen = new Set();
  const text = String(source || '');
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters))
    ? Math.max(1, Math.floor(Number(options.maxSourceCharacters)))
    : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return values;
  const maxMatches = Number.isFinite(Number(options.maxMatches))
    ? Math.max(1, Math.floor(Number(options.maxMatches)))
    : Number.POSITIVE_INFINITY;
  const maxValues = Number.isFinite(Number(options.maxValues))
    ? Math.max(1, Math.floor(Number(options.maxValues)))
    : Number.POSITIVE_INFINITY;
  const pattern = /["']([A-Za-z0-9_$-]{2,40})["']\s*:\s*["']((?:\\.|[^"'\\])*)["']/g;
  let match;
  let matchedFields = 0;
  while ((match = pattern.exec(text))) {
    if (!wanted.has(String(match[1] || '').toLowerCase())) continue;
    matchedFields += 1;
    const value = decodeHtmlEntities(decodeJsonLikeString(match[2])).trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
    if (matchedFields >= maxMatches || values.length >= maxValues) break;
  }
  return values;
}

function collectJsonArrayStringValues(source, keys, options = {}) {
  const wanted = new Set((keys || []).map((key) => String(key || '').toLowerCase()));
  const values = [];
  const seen = new Set();
  const text = String(source || '');
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters))
    ? Math.max(1, Math.floor(Number(options.maxSourceCharacters)))
    : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return values;
  const maxValues = Number.isFinite(Number(options.maxValues))
    ? Math.max(1, Math.floor(Number(options.maxValues)))
    : Number.POSITIVE_INFINITY;
  const pattern = /["']([A-Za-z0-9_$-]{2,40})["']\s*:\s*\[((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'\s*,?\s*)+)\]/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (!wanted.has(String(match[1] || '').toLowerCase())) continue;
    const arraySource = match[2] || '';
    const itemPattern = /["']((?:\\.|[^"'\\])*)["']/g;
    let itemMatch;
    while ((itemMatch = itemPattern.exec(arraySource))) {
      const value = decodeHtmlEntities(decodeJsonLikeString(itemMatch[1])).trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
      if (values.length >= maxValues) return values;
    }
  }
  return values;
}

function collectLooseXiaohongshuImageUrls(source, options = {}) {
  const text = String(source || '');
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters))
    ? Math.max(1, Math.floor(Number(options.maxSourceCharacters)))
    : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return [];
  const maxValues = Number.isFinite(Number(options.maxValues))
    ? Math.max(1, Math.floor(Number(options.maxValues)))
    : Number.POSITIVE_INFINITY;
  const normalized = decodeHtmlEntities(text)
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/');
  const urls = [];
  const seen = new Set();
  const pattern = /https?:\/\/[^"'\\\s<>]*(?:sns-webpic|xhscdn|notes_pre_post)[^"'\\\s<>]*/gi;
  let match;
  while (urls.length < maxValues && (match = pattern.exec(normalized))) {
    const url = normalizeExtractedUrl(match[0]);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function collectImageUrlsFromHtml(html, options = {}) {
  const source = String(html || '');
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters))
    ? Math.max(1, Math.floor(Number(options.maxSourceCharacters)))
    : Number.POSITIVE_INFINITY;
  if (source.length > maxSourceCharacters) return [];
  const maxValues = Number.isFinite(Number(options.maxValues))
    ? Math.max(1, Math.floor(Number(options.maxValues)))
    : Number.POSITIVE_INFINITY;
  const acceptUrl = typeof options.acceptUrl === 'function' ? options.acceptUrl : () => true;
  const urls = [];
  const seen = new Set();
  const addUrl = (value) => {
    if (urls.length >= maxValues) return;
    const url = normalizeExtractedUrl(value);
    if (!url
      || /^data:|^blob:/i.test(url)
      || !/^https?:\/\//i.test(url)
      || !acceptUrl(url)
      || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  [
    extractMetaContent(source, ['og:image', 'og:image:url', 'twitter:image']),
  ].forEach(addUrl);

  const imageTagPattern = /<img\b[^>]*>/gi;
  let imageTagMatch;
  while (urls.length < maxValues && (imageTagMatch = imageTagPattern.exec(source))) {
    const tag = imageTagMatch[0];
    addUrl(getHtmlAttribute(tag, 'data-src') || getHtmlAttribute(tag, 'src'));
    const srcset = getHtmlAttribute(tag, 'srcset');
    if (srcset) {
      addUrl(srcset.split(',')[0].trim().split(/\s+/)[0]);
    }
  }

  const imagePattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s<>]*)?/gi;
  let match;
  while (urls.length < maxValues && (match = imagePattern.exec(source))) {
    addUrl(match[0]);
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
  ], {
    maxSourceCharacters,
    maxMatches: maxValues,
    maxValues,
  }).forEach((url) => {
    if (isLikelyImageUrl(url)) {
      addUrl(url);
    }
  });

  collectLooseXiaohongshuImageUrls(source, {
    maxSourceCharacters,
    maxValues,
  }).forEach(addUrl);

  return dedupeImageVariants(urls).slice(0, maxValues);
}

function isNoisyXiaohongshuImageUrl(value) {
  const url = normalizeExtractedUrl(value).toLowerCase();
  return /picasso-static\.xiaohongshu\.com\/fe-platform\//i.test(url)
    || /fe-platform\.xhscdn\.com\/platform\//i.test(url)
    || /(?:^|\/\/)[^/]*xhscdn\.com\/platform\//i.test(url)
    || /(?:avatar|sns-avatar|recommend|banner|logo|icon|emoji|sticker|qrcode|qr-code|comment|user|profile|ads?)[^/]*(?:\.jpg|\.jpeg|\.png|\.webp|!|$)/i.test(url)
    || /ci\.xiaohongshu\.com\/(?:recommend|banner|logo|icon|avatar)/i.test(url);
}

function collectFilteredImageTagUrls(source, options = {}) {
  const text = String(source || '');
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters))
    ? Math.max(1, Math.floor(Number(options.maxSourceCharacters)))
    : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return [];
  const maxValues = Number.isFinite(Number(options.maxValues))
    ? Math.max(1, Math.floor(Number(options.maxValues)))
    : Number.POSITIVE_INFINITY;
  const urls = [];
  const seen = new Set();
  const addUrl = (value) => {
    if (urls.length >= maxValues) return;
    const url = normalizeExtractedUrl(value);
    if (!url || !isLikelyImageUrl(url) || isNoisyXiaohongshuImageUrl(url) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const imageTagPattern = /<img\b[^>]*>/gi;
  let match;
  while (urls.length < maxValues && (match = imageTagPattern.exec(text))) {
    const tag = match[0];
    const src = getHtmlAttribute(tag, 'data-src') || getHtmlAttribute(tag, 'src');
    addUrl(src);
    const srcset = getHtmlAttribute(tag, 'srcset');
    if (srcset) {
      addUrl(srcset.split(',')[0].trim().split(/\s+/)[0]);
    }
  }
  return urls;
}

function collectPreferredXiaohongshuImageObjectUrl(source) {
  const preferredKeys = [
    'original',
    'originalUrl',
    'original_url',
    'urlSizeLarge',
    'url_size_large',
    'urlDefault',
    'url',
    'src',
    'image',
    'imageUrl',
    'image_url',
    'cover',
    'urlPre',
    'url_pre',
  ];
  for (const key of preferredKeys) {
    const value = collectJsonStringValues(source, [key], {
      maxSourceCharacters: 256 * 1024,
      maxMatches: 4,
      maxValues: 1,
    })
      .find((url) => isLikelyImageUrl(url) && !isNoisyXiaohongshuImageUrl(url));
    if (value) return value;
  }
  return '';
}

function collectXiaohongshuNoteImageUrls(html) {
  const source = String(html || '');
  if (source.length > XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS) return [];
  const imageBlocks = collectJsonArrayBlocks(source, [
    'imageList',
    'image_list',
    'images',
    'imageUrls',
    'image_urls',
    'imageUrlList',
    'image_url_list',
  ], {
    maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS,
    maxBlocks: 16,
    maxBlockCharacters: XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS,
    maxTotalCharacters: XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS,
  });
  const structuredUrls = [];

  for (const block of imageBlocks) {
    if (structuredUrls.length >= XIAOHONGSHU_CONTENT_MAX_IMAGES) break;
    const remainingImageCount = XIAOHONGSHU_CONTENT_MAX_IMAGES - structuredUrls.length;
    const imageObjects = collectTopLevelJsonObjectBlocks(block, {
      maxBlocks: remainingImageCount,
      maxBlockCharacters: 256 * 1024,
      maxTotalCharacters: XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS,
    });
    if (imageObjects.length) {
      for (const imageObject of imageObjects) {
        pushUniqueUrl(structuredUrls, collectPreferredXiaohongshuImageObjectUrl(imageObject));
        if (structuredUrls.length >= XIAOHONGSHU_CONTENT_MAX_IMAGES) break;
      }
      continue;
    }
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
    ], {
      maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS,
      maxMatches: XIAOHONGSHU_CONTENT_MAX_IMAGES,
      maxValues: remainingImageCount,
    }).forEach((url) => {
      if (isLikelyImageUrl(url) && !isNoisyXiaohongshuImageUrl(url)) {
        pushUniqueUrl(structuredUrls, url);
      }
    });
    collectLooseXiaohongshuImageUrls(block, {
      maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS,
      maxValues: Math.max(1, XIAOHONGSHU_CONTENT_MAX_IMAGES - structuredUrls.length),
    }).forEach((url) => {
      if (!isNoisyXiaohongshuImageUrl(url)) pushUniqueUrl(structuredUrls, url);
    });
  }

  const structuredImages = dedupeImageVariants(structuredUrls)
    .slice(0, XIAOHONGSHU_CONTENT_MAX_IMAGES);
  if (structuredImages.length) {
    return structuredImages;
  }

  const urls = [];
  [
    extractMetaContent(source, ['og:image', 'og:image:url', 'twitter:image']),
  ].forEach((url) => {
    if (url && !isNoisyXiaohongshuImageUrl(url)) pushUniqueUrl(urls, url);
  });
  collectFilteredImageTagUrls(source, {
    maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS,
    maxValues: XIAOHONGSHU_CONTENT_MAX_IMAGES,
  }).forEach((url) => pushUniqueUrl(urls, url));

  const noteImages = dedupeImageVariants(urls)
    .slice(0, XIAOHONGSHU_CONTENT_MAX_IMAGES);
  if (noteImages.length > 1) return noteImages;

  const fallbackImages = collectImageUrlsFromHtml(source, {
    maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS,
    maxValues: XIAOHONGSHU_CONTENT_MAX_IMAGES,
    acceptUrl: (imageUrl) => !isNoisyXiaohongshuImageUrl(imageUrl),
  });
  return dedupeImageVariants([...noteImages, ...fallbackImages]).slice(0, 6);
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

function getDouyinDetailAwemeId(payload) {
  const detail = payload && (payload.aweme_detail || payload.awemeDetail || payload.item_list && payload.item_list[0]);
  return String(detail && (detail.aweme_id || detail.awemeId) || '').trim();
}

function extractDouyinMediaUrlsForAweme(payload, awemeId) {
  const targetId = String(awemeId || '').trim();
  if (!targetId) return [];
  let root = payload;
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root || '{}');
    } catch (error) {
      return [];
    }
  }
  if (!root || typeof root !== 'object') return [];

  const urls = [];
  const seen = new Set();
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 16 || seen.size > 10000 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }

    const candidateId = String(value.aweme_id || value.awemeId || '').trim();
    if (candidateId === targetId && value.video && typeof value.video === 'object') {
      extractDouyinMediaUrlsFromDetailPayload({ aweme_detail: value })
        .forEach((url) => pushUniqueMediaUrl(urls, url));
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(root);
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

function isGenericXiaohongshuTitle(title) {
  return String(title || '').trim().includes('你的生活兴趣社区');
}

function getXiaohongshuTargetNoteId(url = '') {
  if (!isTrustedXiaohongshuCookieUrl(url)) return '';
  try {
    const parsed = new URL(String(url || '').trim());
    const pathMatch = parsed.pathname.match(/\/(?:explore|discovery\/item|item)\/([0-9a-z_-]{6,})/i);
    if (pathMatch) return decodeURIComponent(pathMatch[1]);
    for (const key of ['note_id', 'noteId', 'item_id', 'itemId']) {
      const value = String(parsed.searchParams.get(key) || '').trim();
      if (/^[0-9a-z_-]{6,}$/i.test(value)) return value;
    }
  } catch (error) {}
  return '';
}

function normalizeXiaohongshuJsonState(source) {
  const input = String(source || '');
  let output = '';
  let quote = '';
  let escaped = false;
  for (let index = 0; index < input.length;) {
    const char = input[index];
    if (escaped) {
      output += char;
      escaped = false;
      index += 1;
      continue;
    }
    if (quote) {
      output += char;
      if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    const primitive = input.slice(index).match(/^(?:-?Infinity|undefined|NaN)(?![A-Za-z0-9_$])/);
    if (primitive) {
      output += 'null';
      index += primitive[0].length;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function tryParseXiaohongshuStateBlock(source) {
  try {
    return JSON.parse(String(source || ''));
  } catch (error) {
    try {
      return JSON.parse(normalizeXiaohongshuJsonState(source));
    } catch (normalizedError) {
      return null;
    }
  }
}

function normalizeXiaohongshuStructuredTag(value) {
  const raw = typeof value === 'string'
    ? value
    : String(value && (
      value.name
      || value.tagName
      || value.tag_name
      || value.title
      || value.topicName
      || value.topic_name
    ) || '');
  const cleaned = raw.trim().replace(/^#+/, '').replace(/\s+/g, '_');
  if (!cleaned || cleaned.length > 48 || /^https?:\/\//i.test(cleaned)) return '';
  return `#${cleaned}`;
}

function collectXiaohongshuStructuredTags(note, description = '') {
  const tags = extractTagsFromText(description, '').slice(0, 64);
  const seen = new Set(tags);
  const addTag = (value) => {
    if (tags.length >= 64) return;
    const tag = normalizeXiaohongshuStructuredTag(value);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  };
  [
    note && note.tagList,
    note && note.tag_list,
    note && note.topicList,
    note && note.topic_list,
    note && note.topics,
  ].forEach((group) => {
    if (!Array.isArray(group) || tags.length >= 64) return;
    for (let index = 0; index < group.length && tags.length < 64; index += 1) {
      addTag(group[index]);
    }
  });
  return tags;
}

function collectXiaohongshuStructuredImages(note) {
  const imageList = (note && (
    note.imageList
    || note.image_list
    || note.images
    || note.imageUrls
    || note.image_urls
  )) || [];
  if (!Array.isArray(imageList) || !imageList.length) return [];
  try {
    return collectXiaohongshuNoteImageUrls(JSON.stringify({
      imageList: imageList.slice(0, 100),
    })).slice(0, 100);
  } catch (error) {
    return [];
  }
}

function extractXiaohongshuStructuredVideoUrl(note) {
  if (!note || typeof note !== 'object') return '';
  const urls = [];
  let visitedEntries = 0;
  const collect = (value, depth = 0) => {
    if (!value || depth > 10 || visitedEntries >= 500 || urls.length >= 8) return;
    visitedEntries += 1;
    if (typeof value === 'string') {
      pushUniqueMediaUrl(urls, value);
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length && visitedEntries < 500 && urls.length < 8; index += 1) {
        collect(value[index], depth + 1);
      }
      return;
    }
    if (typeof value !== 'object') return;
    Object.entries(value).forEach(([key, child]) => {
      if (/^(?:url|urlList|url_list|masterUrl|master_url|backupUrls|backup_urls|playUrl|play_url|originVideoKey|origin_video_key)$/i.test(key)
        || /^(?:media|stream|h264|h265|h266|av1|consumer|videoInfo|video_info)$/i.test(key)) {
        collect(child, depth + 1);
      }
    });
  };
  [
    note.videoUrl,
    note.video_url,
    note.video,
    note.videoInfo,
    note.video_info,
  ].forEach((value) => collect(value));
  return urls[0] || '';
}

function isXiaohongshuStructuredVideoNote(note) {
  if (!note || typeof note !== 'object') return false;
  const declaredType = String(
    note.noteType
    || note.note_type
    || note.type
    || note.contentType
    || note.content_type
    || '',
  ).trim().toLowerCase();
  if (/(?:video|视频)/i.test(declaredType)) return true;
  return Boolean(note.video || note.videoInfo || note.video_info || note.videoUrl || note.video_url);
}

function extractXiaohongshuPrimaryNotePayload(html, url = '') {
  const targetNoteId = getXiaohongshuTargetNoteId(url);
  const empty = {
    targetNoteIdPresent: Boolean(targetNoteId),
    matched: false,
    structuredIdentityMismatch: false,
    title: '',
    description: '',
    tags: [],
    imageUrls: [],
    videoUrl: '',
    isVideoNote: false,
    author: '',
    socialMetrics: {},
  };
  if (!targetNoteId) return empty;

  const rawSource = String(html || '');
  if (rawSource.length > 8 * 1024 * 1024) return empty;
  const normalizedTargetId = targetNoteId.toLowerCase();
  const candidates = [];
  const source = decodeHtmlEntities(rawSource);
  const blocks = collectTopLevelJsonObjectBlocks(source, {
    maxBlocks: 16,
    maxBlockCharacters: 2 * 1024 * 1024,
    maxTotalCharacters: 4 * 1024 * 1024,
    requiredTexts: ['noteDetailMap', '"noteId"', '"note_id"'],
  }).filter((block) => /noteDetailMap|note_?id|displayTitle|imageList|image_list/i.test(block));
  const traversalBudget = { nodes: 0, maxNodes: 30000 };
  let structuredIdentityMismatch = false;

  const visit = (value, path = [], seen = new Set(), depth = 0) => {
    if (!value
      || typeof value !== 'object'
      || depth > 20
      || seen.size > 20000
      || traversalBudget.nodes >= traversalBudget.maxNodes
      || candidates.length >= 8
      || seen.has(value)) return;
    seen.add(value);
    traversalBudget.nodes += 1;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, path, seen, depth + 1));
      return;
    }

    const normalizedPath = path.map((entry) => String(entry || '').toLowerCase());
    const insideExcludedTree = normalizedPath.some((entry) => (
      entry !== normalizedTargetId
      && /^(?:comments?|comment_?list|replies|reply_?list|feeds?|recommend(?:ation|ed|s)?|search(?:result|results)?|related|cards?|similar)$/i.test(entry)
    ));
    const objectNoteIds = [value.noteId, value.note_id]
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean);
    const objectKeys = Object.keys(value);
    const looksLikeNote = objectKeys.some((key) => /^(?:displayTitle|display_title|desc|description|noteContent|note_content|content|imageList|image_list|noteType|note_type)$/i.test(key));
    if (looksLikeNote
      && objectNoteIds.length
      && !objectNoteIds.includes(normalizedTargetId)) {
      structuredIdentityMismatch = true;
    }
    const targetPathIndex = normalizedPath.lastIndexOf(normalizedTargetId);
    const targetPathSuffix = targetPathIndex >= 0
      ? normalizedPath.slice(targetPathIndex + 1).join('/')
      : '';
    const inheritsTargetFromPath = targetPathIndex >= 0
      && [
        '',
        'note',
        'data',
        'item',
        'notedetail',
        'note_detail',
        'data/note',
        'item/note',
        'notedetail/note',
        'note_detail/note',
      ].includes(targetPathSuffix);
    const matchesTarget = objectNoteIds.length
      ? objectNoteIds.includes(normalizedTargetId)
      : inheritsTargetFromPath;

    if (matchesTarget && looksLikeNote && !insideExcludedTree) {
      const title = decodeHtmlEntities(String(
        value.displayTitle
        || value.display_title
        || value.title
        || '',
      )).trim();
      const description = cleanSocialDescription(
        value.desc
        || value.description
        || value.noteContent
        || value.note_content
        || value.content
        || '',
      ).slice(0, 100000);
      const imageUrls = collectXiaohongshuStructuredImages(value);
      const videoUrl = extractXiaohongshuStructuredVideoUrl(value);
      const isVideoNote = isXiaohongshuStructuredVideoNote(value);
      const author = cleanSocialDescription(
        (value.user && (
          value.user.nickname
          || value.user.nickName
          || value.user.userName
        ))
        || (value.userInfo && (
          value.userInfo.nickname
          || value.userInfo.nickName
          || value.userInfo.userName
        ))
        || '',
      );
      const hasSubstantiveDescription = Boolean(description)
        && !isDefaultXiaohongshuDescription(description)
        && !isXiaohongshuShareBoilerplateOnly({
          title,
          description,
          markdown: description,
        });
      if (hasSubstantiveDescription || imageUrls.length || videoUrl) {
        candidates.push({
          targetNoteIdPresent: true,
          matched: true,
          title: isGenericXiaohongshuTitle(title) ? '' : title,
          description: hasSubstantiveDescription ? description : '',
          tags: collectXiaohongshuStructuredTags(value, description),
          imageUrls,
          videoUrl,
          isVideoNote,
          author,
          socialMetrics: buildSocialMetrics(value),
        });
      }
    }

    Object.entries(value).forEach(([key, child]) => {
      if (child && typeof child === 'object') {
        visit(child, [...normalizedPath, String(key || '').toLowerCase()], seen, depth + 1);
      }
    });
  };

  blocks.forEach((block) => {
    const parsed = tryParseXiaohongshuStateBlock(block);
    if (parsed) visit(parsed, []);
  });
  if (!candidates.length) return {
    ...empty,
    structuredIdentityMismatch,
  };
  candidates.sort((left, right) => (
    (String(right.title || '').length ? 1000 : 0)
    + Math.min(String(right.description || '').length, 5000)
    + (right.imageUrls.length * 500)
    + (right.videoUrl ? 300 : 0)
  ) - (
    (String(left.title || '').length ? 1000 : 0)
    + Math.min(String(left.description || '').length, 5000)
    + (left.imageUrls.length * 500)
    + (left.videoUrl ? 300 : 0)
  ));
  return {
    ...candidates[0],
    structuredIdentityMismatch,
  };
}

function shouldStopWaitingForXiaohongshuContent(html, url = '') {
  return extractXiaohongshuPrimaryNotePayload(html, url).matched === true;
}

function getXiaohongshuCanonicalUrlFromHtml(html = '') {
  const source = String(html || '');
  const linkTags = source.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = String(getHtmlAttribute(tag, 'rel') || '').toLowerCase().split(/\s+/);
    if (!rel.includes('canonical')) continue;
    const href = normalizeExtractedUrl(getHtmlAttribute(tag, 'href'));
    if (isXiaohongshuUrl(href) && getXiaohongshuTargetNoteId(href)) return href;
  }
  const ogUrl = normalizeExtractedUrl(extractMetaContent(source, ['og:url']));
  return isXiaohongshuUrl(ogUrl) && getXiaohongshuTargetNoteId(ogUrl) ? ogUrl : '';
}

function resolveXiaohongshuIdentityUrl(urls = [], html = '') {
  const candidates = Array.isArray(urls) ? urls : [urls];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (isXiaohongshuUrl(value) && getXiaohongshuTargetNoteId(value)) return value;
  }
  return getXiaohongshuCanonicalUrlFromHtml(html);
}

function rememberXiaohongshuObservedIdentity(previous = '', details = {}) {
  const remembered = resolveXiaohongshuIdentityUrl([previous]);
  if (remembered) return remembered;
  const resourceType = String(details && details.resourceType || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const isMainFrame = resourceType
    ? resourceType === 'mainframe'
    : (
      Number(details && details.frameId) === 0
      && Number(details && details.parentFrameId) < 0
    );
  if (!isMainFrame) return '';
  return resolveXiaohongshuIdentityUrl([
    details && details.redirectURL,
    details && details.url,
  ]);
}

function installXiaohongshuIdentityObserver(webContents, onIdentity) {
  if (!webContents
    || typeof webContents.on !== 'function'
    || typeof webContents.removeListener !== 'function'
    || typeof onIdentity !== 'function') {
    return () => {};
  }
  const observeNavigationDetails = (
    event,
    navigationUrl,
    legacyIsMainFrame,
    assumeLegacyMainFrame,
  ) => {
    const hasCurrentDetails = Boolean(
      event
      && typeof event.url === 'string'
      && typeof event.isMainFrame === 'boolean',
    );
    const candidate = hasCurrentDetails
      ? event.url
      : String(navigationUrl && navigationUrl.url || navigationUrl || '');
    const isMainFrame = hasCurrentDetails
      ? event.isMainFrame === true
      : (
        typeof legacyIsMainFrame === 'boolean'
          ? legacyIsMainFrame
          : assumeLegacyMainFrame
      );
    if (!isMainFrame) return;
    const identityUrl = rememberXiaohongshuObservedIdentity('', {
      resourceType: 'mainFrame',
      url: candidate,
    });
    if (identityUrl) onIdentity(identityUrl);
  };
  const observeNavigation = (event, navigationUrl, _isInPlace, isMainFrame) => {
    observeNavigationDetails(event, navigationUrl, isMainFrame, true);
  };
  const observeRedirect = (event, navigationUrl, _isInPlace, isMainFrame) => {
    observeNavigationDetails(event, navigationUrl, isMainFrame, false);
  };
  webContents.on('will-navigate', observeNavigation);
  webContents.on('will-redirect', observeRedirect);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    webContents.removeListener('will-navigate', observeNavigation);
    webContents.removeListener('will-redirect', observeRedirect);
  };
}

function selectXiaohongshuBrowserSnapshot(previous = null, current = null, expectedUrl = '') {
  const prior = previous && typeof previous === 'object' ? previous : {};
  const candidate = current && typeof current === 'object' ? current : {};
  const currentHtml = String(candidate.html || '');
  const currentUrl = String(candidate.url || '');
  const identityUrl = resolveXiaohongshuIdentityUrl([
    expectedUrl,
    prior.identityUrl,
    currentUrl,
  ], currentHtml);
  const matched = isTrustedXiaohongshuCookieUrl(currentUrl)
    && Boolean(identityUrl)
    && shouldStopWaitingForXiaohongshuContent(currentHtml, identityUrl);
  if (matched) {
    return {
      html: currentHtml,
      url: currentUrl,
      identityUrl,
      matched: true,
    };
  }
  const previousHtml = String(prior.html || '');
  const selected = currentHtml.length > previousHtml.length ? candidate : prior;
  return {
    html: String(selected.html || ''),
    url: String(selected.url || ''),
    identityUrl,
    matched: false,
  };
}

function isGenericXiaohongshuLandingExtraction(extracted) {
  if (!extracted) return true;
  if (extracted.xiaohongshuPrimaryNoteMatched === true) return false;
  const title = String(extracted.title || '').trim();
  const description = String(extracted.description || '').trim();
  return isGenericXiaohongshuTitle(title)
    || (/该内容来自小红书/.test(description) && /打开小红书/.test(description));
}

function getPreferredXiaohongshuTitle(existingTitle, extractedTitle, fallback = '小红书笔记') {
  const current = String(existingTitle || '').trim();
  if (current && !isGenericXiaohongshuTitle(current)) return current;
  return String(extractedTitle || '').trim() || fallback;
}

function hasReadableXiaohongshuGraphicContent(extracted, html, url = '') {
  if (!extracted
    || !isTrustedXiaohongshuCookieUrl(url)
    || isUnavailableXiaohongshuPage(html, url)) return false;
  const hasImages = Array.isArray(extracted.imageUrls) && extracted.imageUrls.length > 0;
  if (hasImages) return true;
  if (isXiaohongshuShareBoilerplateOnly(extracted)) return false;
  const description = String(extracted.description || '').trim();
  if (/分享口令/.test(description)) return false;
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

function extractBilibiliProgressiveVideoUrlFromPlayurlPayload(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const playData = data && data.data ? data.data : {};
  const durlList = Array.isArray(playData.durl) ? playData.durl : [];
  for (const item of durlList) {
    const url = normalizeExtractedUrl(item && item.url);
    if (url) return url;
    const backups = (item && (item.backupUrl || item.backup_url)) || [];
    if (Array.isArray(backups) && backups.length) {
      const backupUrl = normalizeExtractedUrl(backups[0]);
      if (backupUrl) return backupUrl;
    }
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

function collectXiaohongshuNoteContentValues(source) {
  const values = [];
  const rawSource = String(source || '');
  if (rawSource.length > 8 * 1024 * 1024) return values;
  const traversalBudget = { nodes: 0, maxNodes: 30000 };
  const seen = new Set();
  const pushValue = (value) => {
    const text = decodeHtmlEntities(String(value || '')).trim();
    if (text && !values.includes(text)) values.push(text);
  };
  const visit = (value, path = []) => {
    if (!value
      || typeof value !== 'object'
      || traversalBudget.nodes >= traversalBudget.maxNodes
      || values.length >= 64
      || seen.has(value)) return;
    seen.add(value);
    traversalBudget.nodes += 1;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, path));
      return;
    }
    const normalizedPath = path.map((entry) => String(entry || '').toLowerCase());
    const insideCommentTree = normalizedPath.some((entry) => /comment|reply/.test(entry));
    const objectKeys = Object.keys(value).map((key) => String(key || '').toLowerCase());
    const looksLikeNote = normalizedPath.some((entry) => /note/.test(entry))
      || objectKeys.some((key) => /^(?:image_?list|display_?title|note_?type)$/.test(key));
    Object.entries(value).forEach(([key, child]) => {
      const normalizedKey = String(key || '').toLowerCase();
      if (normalizedKey === 'content' && typeof child === 'string' && looksLikeNote && !insideCommentTree) {
        pushValue(child);
      }
      if (child && typeof child === 'object') visit(child, [...normalizedPath, normalizedKey]);
    });
  };

  collectTopLevelJsonObjectBlocks(decodeHtmlEntities(rawSource), {
    maxBlocks: 16,
    maxBlockCharacters: 2 * 1024 * 1024,
    maxTotalCharacters: 4 * 1024 * 1024,
    requiredTexts: ['"content"', "'content'"],
  }).forEach((block) => {
    try {
      visit(JSON.parse(block), []);
    } catch (error) {
      // Only structurally parsed note objects may contribute a generic "content" field.
    }
  });
  return values;
}

function extractXiaohongshuDescription(html, fallbackText = '') {
  const source = String(html || '');
  const jsonCandidates = [
    ...collectJsonStringValues(source, [
      'desc',
      'description',
      'noteContent',
      'note_content',
      'displayTitle',
    ], {
      maxSourceCharacters: 4 * 1024 * 1024,
      maxMatches: 256,
      maxValues: 64,
    }),
    ...collectXiaohongshuNoteContentValues(source),
  ];
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
  ], {
    maxSourceCharacters: 4 * 1024 * 1024,
    maxMatches: 128,
    maxValues: 64,
  }).map((item) => cleanSocialDescription(item))
    .filter((item) => item && item.length <= 40 && !/^https?:\/\//i.test(item));
  return candidates[0] || '';
}

function buildXiaohongshuMarkdown({
  title = '小红书笔记',
  description = '',
  tags = [],
  imageUrls = [],
  videoUrl = '',
  comments = [],
} = {}) {
  const images = Array.isArray(imageUrls) ? imageUrls : [];
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

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractXiaohongshuMarkdownFromHtml(html, url, fallbackText = '', options = {}) {
  url = cleanDisplayUrl(url);
  const source = String(html || '');
  const primaryNote = extractXiaohongshuPrimaryNotePayload(source, url);
  const pageTitle = extractMetaContent(source, ['og:title', 'twitter:title'])
    || extractHtmlTitle(source)
    || '小红书笔记';
  const title = primaryNote.matched
    ? (primaryNote.title || '小红书笔记')
    : pageTitle;
  const description = primaryNote.matched
    ? primaryNote.description
    : extractXiaohongshuDescription(source, fallbackText);
  const tags = primaryNote.matched
    ? primaryNote.tags
    : extractTagsFromText(description, source);
  const images = primaryNote.matched
    ? primaryNote.imageUrls
    : collectXiaohongshuNoteImageUrls(source);
  const videoUrl = primaryNote.matched
    ? primaryNote.videoUrl
    : extractVideoUrlFromHtml(source);
  const includeComments = options.includeComments !== false;
  const comments = includeComments ? extractSocialCommentsFromHtml(source) : [];

  return {
    title,
    author: primaryNote.matched
      ? primaryNote.author
      : extractXiaohongshuAuthor(source),
    description,
    tags,
    markdown: buildXiaohongshuMarkdown({
      title,
      description,
      tags,
      imageUrls: images,
      videoUrl,
      comments,
    }),
    imageUrls: images,
    videoUrl,
    isVideoNote: primaryNote.matched ? primaryNote.isVideoNote === true : false,
    comments,
    socialMetrics: primaryNote.matched ? primaryNote.socialMetrics || {} : {},
    xiaohongshuTargetNoteIdPresent: primaryNote.targetNoteIdPresent,
    xiaohongshuPrimaryNoteMatched: primaryNote.matched,
    xiaohongshuStructuredIdentityMismatch: primaryNote.structuredIdentityMismatch,
  };
}

function mergeXiaohongshuExtractions(extractions = [], preferred = null) {
  const ordered = [];
  const addExtraction = (item) => {
    if (!item || typeof item !== 'object' || ordered.includes(item)) return;
    ordered.push(item);
  };
  addExtraction(preferred);
  (Array.isArray(extractions) ? extractions : []).forEach(addExtraction);
  if (!ordered.length) return preferred || null;
  const matchedPrimary = ordered.filter((item) => item.xiaohongshuPrimaryNoteMatched === true);
  const identityBound = matchedPrimary.length ? matchedPrimary : ordered;
  const selectedPreferred = matchedPrimary.length
    ? (preferred?.xiaohongshuPrimaryNoteMatched === true ? preferred : matchedPrimary[0])
    : preferred;
  const substantive = identityBound.filter((item) => !isXiaohongshuShareBoilerplateOnly(item));
  const sources = substantive.length ? substantive : identityBound;
  if (!matchedPrimary.length) {
    const normalizedTitles = sources.map((item) => String(item.title || '').trim());
    const sharedNonGenericTitle = sources.length > 1
      && normalizedTitles.every(Boolean)
      && new Set(normalizedTitles).size === 1
      && !isGenericXiaohongshuTitle(normalizedTitles[0]);
    const firstImages = new Set(Array.isArray(sources[0]?.imageUrls) ? sources[0].imageUrls : []);
    const sharedImage = sources.length > 1
      && Array.from(firstImages).some((imageUrl) => sources.slice(1).every(
        (item) => Array.isArray(item.imageUrls) && item.imageUrls.includes(imageUrl),
      ));
    if (!sharedNonGenericTitle && !sharedImage) {
      return sources[0] || selectedPreferred || ordered[0];
    }
  }

  const isUsableTitle = (value) => {
    const text = String(value || '').trim();
    return text && !/^(小红书笔记|小红书|发现精彩|登录后查看更多)$/i.test(text);
  };
  const descriptions = sources
    .map((item) => String(item.description || '').trim())
    .filter(Boolean);
  const title = String((sources.find((item) => isUsableTitle(item.title)) || {}).title || selectedPreferred?.title || '小红书笔记').trim();
  const author = String((sources.find((item) => String(item.author || '').trim()) || {}).author || '').trim();
  const description = descriptions.sort((a, b) => b.length - a.length)[0]
    || String(selectedPreferred?.description || '').trim();
  const tags = [];
  const comments = [];
  const addUniqueText = (target, value) => {
    const text = String(value || '').trim();
    if (text && !target.includes(text)) target.push(text);
  };
  sources.forEach((item) => {
    (Array.isArray(item.tags) ? item.tags : []).forEach((tag) => addUniqueText(tags, tag));
    (Array.isArray(item.comments) ? item.comments : []).forEach((comment) => {
      const key = JSON.stringify(comment);
      if (!comments.some((existing) => JSON.stringify(existing) === key)) comments.push(comment);
    });
  });
  const preferredImageUrls = sources.includes(selectedPreferred)
    ? dedupeImageVariants(selectedPreferred.imageUrls || [])
    : [];
  let mergedImageUrls = preferredImageUrls;
  sources.forEach((item) => {
    const candidate = dedupeImageVariants(item.imageUrls || []);
    if (!candidate.length || candidate === mergedImageUrls) return;
    if (!mergedImageUrls.length) {
      mergedImageUrls = candidate;
      return;
    }
    const currentKeys = new Set(mergedImageUrls.map((imageUrl) => getImageVariantKey(imageUrl)));
    const sharesKnownImage = candidate.some(
      (imageUrl) => currentKeys.has(getImageVariantKey(imageUrl)),
    );
    if (sharesKnownImage) {
      mergedImageUrls = dedupeImageVariants([...mergedImageUrls, ...candidate]);
    } else if (candidate.length > mergedImageUrls.length) {
      mergedImageUrls = candidate;
    }
  });
  const videoUrl = String((sources.find((item) => String(item.videoUrl || '').trim()) || {}).videoUrl || '').trim();
  const isVideoNote = sources.some((item) => item.isVideoNote === true);
  const socialMetrics = (sources.find((item) => hasSocialMetrics(item.socialMetrics)) || {}).socialMetrics || {};

  return {
    title,
    author,
    description,
    tags,
    imageUrls: mergedImageUrls,
    videoUrl,
    isVideoNote,
    comments,
    socialMetrics,
    xiaohongshuTargetNoteIdPresent: sources.some((item) => item.xiaohongshuTargetNoteIdPresent === true),
    xiaohongshuPrimaryNoteMatched: matchedPrimary.length > 0,
    xiaohongshuStructuredIdentityMismatch: matchedPrimary.length === 0
      && sources.some((item) => item.xiaohongshuStructuredIdentityMismatch === true),
    markdown: buildXiaohongshuMarkdown({
      title,
      description,
      tags,
      imageUrls: mergedImageUrls,
      videoUrl,
      comments,
    }),
  };
}

function normalizeOcrText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function countReadableOcrChars(text) {
  return (String(text || '').replace(/\s+/g, '').match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length;
}

const XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS = Object.freeze({
  trustedBoxConfidence: 0.55,
  averageConfidence: 0.65,
  longTextReadableChars: 80,
  longTextLines: 5,
  longTextVerticalSpanRatio: 0.35,
  longTextCoveredRowRatio: 0.12,
  largeCardReadableChars: 35,
  largeCardLines: 3,
  largeCardTextBoxAreaRatio: 0.12,
  largeCardVerticalSpanRatio: 0.25,
  geometryFallbackReadableChars: 160,
  geometryFallbackLines: 6,
  maxBoundaryOverlapLines: 8,
});

const LOCAL_OCR_BATCH_RUNNER_SOURCE = String.raw`#!/usr/bin/env python3
import argparse
import json
import math
import re

SCHEMA_VERSION = 1
RUNNER_VERSION = ${JSON.stringify(LOCAL_OCR_BATCH_RUNNER_VERSION)}
TRUSTED_BOX_CONFIDENCE = ${XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS.trustedBoxConfidence}
MAX_IMAGE_DIMENSION = 32768
MAX_IMAGE_PIXELS = 40000000
READABLE_CHARACTER_PATTERN = re.compile(r"[\u3400-\u9fffA-Za-z0-9]")
SAFE_ITEM_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class ImageDimensionsExceededError(Exception):
    pass


def readable_character_count(value):
    return len(READABLE_CHARACTER_PATTERN.findall(str(value or "")))


def safe_item_id(value, fallback):
    candidate = str(value or "").strip()
    return candidate if SAFE_ITEM_ID_PATTERN.fullmatch(candidate) else fallback


def safe_positive_index(value, fallback):
    try:
        number = float(value)
        if not math.isfinite(number):
            return fallback
        integer = math.floor(number)
        return integer if integer > 0 else fallback
    except (TypeError, ValueError, OverflowError):
        return fallback


def validate_image_dimensions(width, height):
    width = int(width)
    height = int(height)
    if (
        width <= 0
        or height <= 0
        or width > MAX_IMAGE_DIMENSION
        or height > MAX_IMAGE_DIMENSION
        or (width * height) > MAX_IMAGE_PIXELS
    ):
        raise ImageDimensionsExceededError()
    return width, height


def to_plain_value(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def is_ocr_row(value):
    value = to_plain_value(value)
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return False
    try:
        score = float(value[2])
    except (TypeError, ValueError, OverflowError):
        return False
    return math.isfinite(score) and not isinstance(value[1], (list, tuple, dict))


def is_ocr_row_collection(value):
    value = to_plain_value(value)
    return (
        isinstance(value, (list, tuple))
        and all(is_ocr_row(row) for row in value)
    )


def is_result_metadata(value):
    return value is None or isinstance(value, (int, float, list, tuple, dict))


def result_rows(raw_result):
    value = raw_result
    if (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and is_ocr_row_collection(value[0])
        and is_result_metadata(value[1])
    ):
        value = value[0]
    if value is None:
        return []

    boxes = None
    texts = None
    scores = None
    if isinstance(value, dict):
        boxes = value.get("boxes")
        texts = value.get("txts")
        if texts is None:
            texts = value.get("texts")
        scores = value.get("scores")
    else:
        boxes = getattr(value, "boxes", None)
        texts = getattr(value, "txts", None)
        if texts is None:
            texts = getattr(value, "texts", None)
        scores = getattr(value, "scores", None)

    if boxes is not None and texts is not None and scores is not None:
        return list(zip(list(boxes), list(texts), list(scores)))
    if is_ocr_row(value):
        return [value]
    if is_ocr_row_collection(value):
        return list(value)
    return []


def clipped_box_geometry(box, image_width, image_height):
    value = to_plain_value(box)
    if not isinstance(value, (list, tuple)):
        return 0.0, None, []

    points = []
    if len(value) == 4 and all(isinstance(item, (int, float)) for item in value):
        left, top, right, bottom = [float(item) for item in value]
        points = [(left, top), (right, top), (right, bottom), (left, bottom)]
    else:
        for point in value:
            point = to_plain_value(point)
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            try:
                x_value = float(point[0])
                y_value = float(point[1])
            except (TypeError, ValueError, OverflowError):
                continue
            if math.isfinite(x_value) and math.isfinite(y_value):
                points.append((x_value, y_value))

    if len(points) < 3:
        return 0.0, None, []

    clipped = [
        (
            min(float(image_width), max(0.0, x_value)),
            min(float(image_height), max(0.0, y_value)),
        )
        for x_value, y_value in points
    ]
    area_twice = 0.0
    for point_index, (x_value, y_value) in enumerate(clipped):
        next_x, next_y = clipped[(point_index + 1) % len(clipped)]
        area_twice += (x_value * next_y) - (next_x * y_value)
    area = abs(area_twice) / 2.0
    top = min(point[1] for point in clipped)
    bottom = max(point[1] for point in clipped)
    return area, (top, bottom), clipped


def merged_interval_length(intervals):
    if not intervals:
        return 0.0
    ordered = sorted(intervals, key=lambda interval: (interval[0], interval[1]))
    merged_length = 0.0
    current_start, current_end = ordered[0]
    for next_start, next_end in ordered[1:]:
        if next_start <= current_end:
            current_end = max(current_end, next_end)
            continue
        merged_length += max(0.0, current_end - current_start)
        current_start, current_end = next_start, next_end
    return merged_length + max(0.0, current_end - current_start)


def classify_item_error(error):
    error_name = type(error).__name__.lower()
    if isinstance(error, ImageDimensionsExceededError):
        return "image_dimensions_exceeded"
    if "unidentifiedimage" in error_name or "decompression" in error_name:
        return "image_decode_error"
    if isinstance(error, (FileNotFoundError, IsADirectoryError, PermissionError, OSError)):
        return "image_read_error"
    return "ocr_item_error"


def process_image(engine, image_module, item, source_order):
    fallback_id = "image-" + str(source_order + 1)
    item_id = safe_item_id(item.get("id"), fallback_id)
    item_index = safe_positive_index(item.get("index"), source_order + 1)
    try:
        image_path = item.get("input")
        if not isinstance(image_path, str) or not image_path:
            image_path = item.get("path")
        if not isinstance(image_path, str) or not image_path:
            raise ValueError("image_path_missing")
        with image_module.open(image_path) as image:
            image_width, image_height = image.size
        image_width, image_height = validate_image_dimensions(image_width, image_height)

        structured_lines = []
        trusted_scores = []
        trusted_area = 0.0
        vertical_intervals = []
        for row in result_rows(engine(image_path)):
            row = to_plain_value(row)
            if not isinstance(row, (list, tuple)) or len(row) < 3:
                continue
            box, text, raw_score = row[0], row[1], row[2]
            try:
                score = float(raw_score)
            except (TypeError, ValueError, OverflowError):
                continue
            normalized_text = re.sub(r"\s+", " ", str(text or "")).strip()
            if (
                not math.isfinite(score)
                or score < TRUSTED_BOX_CONFIDENCE
                or readable_character_count(normalized_text) < 2
            ):
                continue
            area, vertical_interval, clipped_box = clipped_box_geometry(
                box,
                image_width,
                image_height,
            )
            normalized_score = min(1.0, max(0.0, score))
            has_line_geometry = (
                vertical_interval is not None
                and len(clipped_box) >= 3
                and math.isfinite(area)
                and area > 0.0
                and vertical_interval[1] > vertical_interval[0]
            )
            structured_lines.append({
                "text": normalized_text,
                "score": normalized_score,
                "box": clipped_box if has_line_geometry else None,
            })
            trusted_scores.append(normalized_score)
            if has_line_geometry:
                trusted_area += max(0.0, area)
                vertical_intervals.append(vertical_interval)

        image_area = float(image_width * image_height)
        covered_height = merged_interval_length(vertical_intervals)
        vertical_span = (
            max(interval[1] for interval in vertical_intervals)
            - min(interval[0] for interval in vertical_intervals)
            if vertical_intervals
            else 0.0
        )
        line_texts = [line["text"] for line in structured_lines]
        geometry_available = bool(vertical_intervals)
        metrics = {
            "readableChars": sum(readable_character_count(line) for line in line_texts),
            "lineCount": len(structured_lines),
            "averageConfidence": (
                sum(trusted_scores) / len(trusted_scores) if trusted_scores else 0.0
            ),
            "textBoxAreaRatio": (
                min(1.0, max(0.0, trusted_area / image_area))
                if geometry_available else None
            ),
            "coveredRowRatio": (
                min(1.0, max(0.0, covered_height / float(image_height)))
                if geometry_available else None
            ),
            "verticalSpanRatio": (
                min(1.0, max(0.0, vertical_span / float(image_height)))
                if geometry_available else None
            ),
        }
        return {
            "id": item_id,
            "status": "ok",
            "index": item_index,
            "width": image_width,
            "height": image_height,
            "text": "\n".join(line_texts),
            "lines": structured_lines,
            "metrics": metrics,
        }
    except Exception as error:
        return {
            "id": item_id,
            "status": "error",
            "index": item_index,
            "errorType": classify_item_error(error),
        }


def read_manifest(manifest_path):
    with open(manifest_path, "r", encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("batch_manifest_schema_invalid")
    items = manifest.get("items")
    if not isinstance(items, list):
        raise RuntimeError("batch_manifest_items_invalid")
    return items


def load_ocr_runtime():
    from PIL import Image
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        from rapidocr import RapidOCR
    return Image, RapidOCR


def run_result_rows_self_test():
    box_one = [[0, 0], [100, 0], [100, 20], [0, 20]]
    box_two = [[0, 30], [100, 30], [100, 50], [0, 50]]
    rows = [
        [box_one, "真实元数据第一行", 0.98],
        [box_two, "真实元数据第二行", 0.97],
    ]
    parsed_rows = result_rows((rows, [["det", 0.01], ["rec", 0.02]]))
    single_row = (box_one, "单行元组不能误判", 0.96)
    parsed_single_row = result_rows(single_row)
    blank_tuple_rows = result_rows((None, ["metadata"]))
    empty_tuple_rows = result_rows(([], ["metadata"]))

    class ObjectResult:
        boxes = [box_one, box_two]
        txts = ["对象结果第一行", "对象结果第二行"]
        scores = [0.95, 0.94]

    object_rows = result_rows(ObjectResult())
    if (
        parsed_rows != rows
        or parsed_single_row != [single_row]
        or blank_tuple_rows
        or empty_tuple_rows
        or [row[1] for row in object_rows] != ObjectResult.txts
    ):
        raise RuntimeError("result_rows_self_test_failed")

    engine_calls = []

    class FakeImage:
        size = (MAX_IMAGE_DIMENSION + 1, 100)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

    class FakeImageModule:
        @staticmethod
        def open(_image_path):
            return FakeImage()

    def fake_engine(_image_path):
        engine_calls.append(1)
        return rows

    oversized_result = process_image(
        fake_engine,
        FakeImageModule,
        {"id": "image-1", "index": 1, "input": "synthetic-image"},
        0,
    )
    if (
        oversized_result.get("errorType") != "image_dimensions_exceeded"
        or engine_calls
    ):
        raise RuntimeError("image_dimension_self_test_failed")

    print(json.dumps({
        "tupleTexts": [row[1] for row in parsed_rows],
        "singleTupleText": parsed_single_row[0][1],
        "blankTupleRows": len(blank_tuple_rows),
        "emptyTupleRows": len(empty_tuple_rows),
        "objectTexts": [row[1] for row in object_rows],
        "oversizedErrorType": oversized_result.get("errorType"),
        "oversizedEngineCalls": len(engine_calls),
    }))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-manifest")
    parser.add_argument("--output")
    parser.add_argument("--self-test-result-rows", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test_result_rows:
        run_result_rows_self_test()
        return
    if not arguments.batch_manifest or not arguments.output:
        parser.error("--batch-manifest and --output are required")

    manifest_items = read_manifest(arguments.batch_manifest)
    try:
        image_module, rapid_ocr_class = load_ocr_runtime()
        engine = rapid_ocr_class()
    except Exception:
        raise RuntimeError("ocr_engine_init_failed") from None

    output_items = []
    for source_order, item in enumerate(manifest_items):
        if not isinstance(item, dict):
            output_items.append({
                "id": "image-" + str(source_order + 1),
                "status": "error",
                "index": source_order + 1,
                "errorType": "manifest_item_invalid",
            })
            continue
        output_items.append(process_image(engine, image_module, item, source_order))

    with open(arguments.output, "w", encoding="utf-8") as output_file:
        json.dump({
            "schemaVersion": SCHEMA_VERSION,
            "runnerVersion": RUNNER_VERSION,
            "processed": len(output_items),
            "items": output_items,
        }, output_file, ensure_ascii=False)


if __name__ == "__main__":
    main()
`;

function createLocalOcrBatchError(category = 'process') {
  const messages = {
    not_ready: '本地 OCR 组件未就绪，请先在插件设置中修复本地转写组件。',
    timeout: '图片文字 OCR 批量识别超时，请稍后重试。',
    process: '图片文字 OCR 批量识别进程失败，请稍后重试。',
    schema: '图片文字 OCR 批量识别结果格式无效。',
    io: '图片文字 OCR 批量识别临时文件处理失败。',
  };
  const normalizedCategory = Object.prototype.hasOwnProperty.call(messages, category)
    ? category
    : 'process';
  const error = new Error(messages[normalizedCategory]);
  error.code = `LOCAL_OCR_BATCH_${normalizedCategory.toUpperCase()}`;
  return error;
}

function createLocalOcrBatchAllItemsFailedError(items = []) {
  const allowedErrorTypes = [
    'image_decode_error',
    'image_read_error',
    'image_dimensions_exceeded',
    'manifest_item_invalid',
    'ocr_item_error',
  ];
  const counts = Object.fromEntries(allowedErrorTypes.map((errorType) => [errorType, 0]));
  (Array.isArray(items) ? items : []).forEach((item) => {
    const errorType = String(item && item.errorType || '').trim().toLowerCase();
    const safeErrorType = allowedErrorTypes.includes(errorType) ? errorType : 'ocr_item_error';
    counts[safeErrorType] += 1;
  });
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const summary = allowedErrorTypes
    .filter((errorType) => counts[errorType] > 0)
    .map((errorType) => `${errorType}=${counts[errorType]}`)
    .join('; ');
  const error = new Error(`所有图片识别均失败（total=${total}; ${summary}）`);
  error.code = 'LOCAL_OCR_BATCH_ALL_ITEMS_FAILED';
  error.total = total;
  error.errorTypeCounts = Object.freeze(Object.fromEntries(
    allowedErrorTypes
      .filter((errorType) => counts[errorType] > 0)
      .map((errorType) => [errorType, counts[errorType]]),
  ));
  return error;
}

function normalizeLocalOcrBatchResultItems(payload) {
  if (!payload || typeof payload !== 'object'
    || payload.schemaVersion !== 1
    || payload.runnerVersion !== LOCAL_OCR_BATCH_RUNNER_VERSION
    || !Array.isArray(payload.items)
    || !Number.isInteger(payload.processed)
    || payload.processed < 0
    || payload.processed !== payload.items.length) {
    throw createLocalOcrBatchError('schema');
  }
  return payload.items.map((item) => {
    if (!item || typeof item !== 'object' || !['ok', 'error'].includes(item.status)) {
      throw createLocalOcrBatchError('schema');
    }
    const rawId = String(item.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(rawId)
      || !Number.isInteger(item.index)
      || item.index <= 0) {
      throw createLocalOcrBatchError('schema');
    }
    const id = rawId;
    const index = item.index;
    if (item.status === 'error') {
      const rawErrorType = String(item.errorType || 'ocr_item_error').trim().toLowerCase();
      return {
        id,
        index,
        status: 'error',
        errorType: /^[a-z0-9_-]{1,80}$/.test(rawErrorType)
          ? rawErrorType
          : 'ocr_item_error',
      };
    }
    if (!Number.isInteger(item.width) || item.width <= 0
      || !Number.isInteger(item.height) || item.height <= 0
      || typeof item.text !== 'string'
      || !Array.isArray(item.lines)
      || !item.metrics
      || typeof item.metrics !== 'object') {
      throw createLocalOcrBatchError('schema');
    }
    const lines = item.lines.map((line) => {
      if (!line || typeof line !== 'object'
        || typeof line.text !== 'string'
        || !line.text.trim()
        || line.text !== line.text.trim()
        || typeof line.score !== 'number'
        || !Number.isFinite(line.score)
        || line.score < 0
        || line.score > 1) {
        throw createLocalOcrBatchError('schema');
      }
      let box = null;
      if (line.box !== null) {
        if (!Array.isArray(line.box) || line.box.length < 3) {
          throw createLocalOcrBatchError('schema');
        }
        box = line.box.map((point) => {
          if (!Array.isArray(point) || point.length < 2
            || typeof point[0] !== 'number' || !Number.isFinite(point[0])
            || typeof point[1] !== 'number' || !Number.isFinite(point[1])
            || point[0] < 0 || point[0] > item.width
            || point[1] < 0 || point[1] > item.height) {
            throw createLocalOcrBatchError('schema');
          }
          return [point[0], point[1]];
        });
      }
      return {
        text: line.text,
        score: line.score,
        box,
      };
    });
    const text = lines.map((line) => line.text).join('\n');
    if (item.text !== text) throw createLocalOcrBatchError('schema');

    const readableChars = item.metrics.readableChars;
    const lineCount = item.metrics.lineCount;
    const averageConfidence = item.metrics.averageConfidence;
    if (!Number.isInteger(readableChars) || readableChars < 0
      || !Number.isInteger(lineCount) || lineCount < 0 || lineCount !== lines.length
      || typeof averageConfidence !== 'number'
      || !Number.isFinite(averageConfidence)
      || averageConfidence < 0
      || averageConfidence > 1) {
      throw createLocalOcrBatchError('schema');
    }
    const geometryMetricKeys = [
      'textBoxAreaRatio',
      'coveredRowRatio',
      'verticalSpanRatio',
    ];
    const geometryMetrics = {};
    geometryMetricKeys.forEach((key) => {
      const value = item.metrics[key];
      if (value !== null && (typeof value !== 'number'
        || !Number.isFinite(value)
        || value < 0
        || value > 1)) {
        throw createLocalOcrBatchError('schema');
      }
      geometryMetrics[key] = value;
    });
    const hasLineGeometry = lines.some((line) => line.box !== null);
    const geometryValueCount = geometryMetricKeys
      .filter((key) => geometryMetrics[key] !== null)
      .length;
    if ((hasLineGeometry && geometryValueCount !== geometryMetricKeys.length)
      || (!hasLineGeometry && geometryValueCount !== 0)) {
      throw createLocalOcrBatchError('schema');
    }
    const metrics = {
      readableChars,
      lineCount,
      averageConfidence,
      ...geometryMetrics,
    };
    return {
      id,
      index,
      status: 'ok',
      width: item.width,
      height: item.height,
      text,
      lines,
      metrics,
    };
  });
}

function bindLocalOcrBatchResultItems(payload, manifestItems = []) {
  const items = normalizeLocalOcrBatchResultItems(payload);
  if (!Array.isArray(manifestItems) || items.length !== manifestItems.length) {
    throw createLocalOcrBatchError('schema');
  }
  const manifestIds = new Set();
  const resultIds = new Set();
  items.forEach((item, position) => {
    const manifestItem = manifestItems[position];
    if (!manifestItem
      || manifestIds.has(manifestItem.id)
      || resultIds.has(item.id)
      || item.id !== manifestItem.id
      || item.index !== manifestItem.index) {
      throw createLocalOcrBatchError('schema');
    }
    manifestIds.add(manifestItem.id);
    resultIds.add(item.id);
  });
  return items;
}

function getSafeXiaohongshuOcrError(error) {
  const code = String(error && error.code || '');
  if (code === 'LOCAL_OCR_BATCH_TIMEOUT') return '图片文字 OCR 批量识别超时，请稍后重试。';
  if (code === 'LOCAL_OCR_BATCH_NOT_READY') return '图片文字 OCR 组件未就绪，请在插件设置中修复。';
  if (code === 'LOCAL_OCR_BATCH_ALL_ITEMS_FAILED') {
    return '所有图片识别均失败，原始图文内容已保留。';
  }
  return '图片文字 OCR 批量识别失败，原始图文内容已保留。';
}

function normalizeFiniteOcrMetric(value, fallback, {
  integer = false,
  ratio = false,
} = {}) {
  const number = typeof value === 'number'
    ? value
    : (typeof value === 'string' && value.trim() ? Number(value) : Number.NaN);
  if (!Number.isFinite(number) || number < 0 || (ratio && number > 1)) return fallback;
  return integer ? Math.floor(number) : number;
}

function splitNormalizedOcrLines(text) {
  const normalized = normalizeOcrText(text);
  return normalized ? normalized.split('\n') : [];
}

function normalizeOptionalOcrRatio(value) {
  const missing = value === undefined
    || value === null
    || (typeof value === 'string' && !value.trim());
  return missing ? null : normalizeFiniteOcrMetric(value, 0, { ratio: true });
}

function normalizeXiaohongshuOcrMetrics(metrics = {}, text = '') {
  const source = metrics && typeof metrics === 'object' ? metrics : {};
  const lines = splitNormalizedOcrLines(text);
  return {
    readableChars: normalizeFiniteOcrMetric(
      source.readableChars,
      countReadableOcrChars(text),
      { integer: true },
    ),
    lineCount: normalizeFiniteOcrMetric(source.lineCount, lines.length, { integer: true }),
    averageConfidence: normalizeOptionalOcrRatio(source.averageConfidence),
    textBoxAreaRatio: normalizeOptionalOcrRatio(source.textBoxAreaRatio),
    coveredRowRatio: normalizeOptionalOcrRatio(source.coveredRowRatio),
    verticalSpanRatio: normalizeOptionalOcrRatio(source.verticalSpanRatio),
  };
}

function isXiaohongshuTextDominantOcrItem(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const text = normalizeOcrText(item.text || item.ocrText || item.value);
  if (!text) return false;
  const metrics = normalizeXiaohongshuOcrMetrics(item.metrics, text);
  const thresholds = XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS;
  const geometry = [
    metrics.textBoxAreaRatio,
    metrics.coveredRowRatio,
    metrics.verticalSpanRatio,
  ];
  const hasGeometry = geometry.some((value) => Number.isFinite(value));
  const hasTrustedAverageConfidence = Number.isFinite(metrics.averageConfidence)
    && metrics.averageConfidence >= thresholds.averageConfidence;

  if (!hasGeometry) {
    return (metrics.averageConfidence === null || hasTrustedAverageConfidence)
      && metrics.readableChars >= thresholds.geometryFallbackReadableChars
      && metrics.lineCount >= thresholds.geometryFallbackLines;
  }
  if (!hasTrustedAverageConfidence) return false;

  const isLongText = metrics.readableChars >= thresholds.longTextReadableChars
    && metrics.lineCount >= thresholds.longTextLines
    && metrics.verticalSpanRatio >= thresholds.longTextVerticalSpanRatio
    && metrics.coveredRowRatio >= thresholds.longTextCoveredRowRatio;
  const isLargeCard = metrics.readableChars >= thresholds.largeCardReadableChars
    && metrics.lineCount >= thresholds.largeCardLines
    && metrics.textBoxAreaRatio >= thresholds.largeCardTextBoxAreaRatio
    && metrics.verticalSpanRatio >= thresholds.largeCardVerticalSpanRatio;
  return isLongText || isLargeCard;
}

function normalizeXiaohongshuOcrItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, sourceOrder) => {
      const text = normalizeOcrText(item && (item.text || item.ocrText || item.value));
      const metrics = normalizeXiaohongshuOcrMetrics(item && item.metrics, text);
      const rawIndex = Number(item && item.index);
      const integerIndex = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0;
      const index = integerIndex > 0
        ? integerIndex
        : sourceOrder + 1;
      return {
        imageUrl: String(item && (item.imageUrl || item.url) || '').trim(),
        text,
        index,
        readableChars: metrics.readableChars,
        substantial: metrics.readableChars >= XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS.longTextReadableChars,
        metrics,
        sourceOrder,
      };
    })
    .filter((item) => isXiaohongshuTextDominantOcrItem(item))
    .sort((left, right) => left.index - right.index || left.sourceOrder - right.sourceOrder)
    .map(({ sourceOrder, ...item }) => item);
}

function isLikelyImageTextNote(items = []) {
  return normalizeXiaohongshuOcrItems(items).length > 0;
}

function getNormalizedOcrLineKey(line) {
  return String(line || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function getXiaohongshuOcrLineBoundarySeparator(previousText, nextLine) {
  const previous = String(previousText || '');
  const next = String(nextLine || '');
  if (!previous || !next
    || /\s$/.test(previous)
    || !/^[A-Za-z0-9]/.test(next)) {
    return '';
  }
  return /[A-Za-z0-9,.!?:;'"%)\]}]$/.test(previous) ? ' ' : '';
}

function mergeXiaohongshuOcrText(items = [], maxOverlapLines = 8) {
  const normalized = normalizeXiaohongshuOcrItems(items);
  const configuredLimit = normalizeFiniteOcrMetric(maxOverlapLines, 8, { integer: true });
  const overlapLimit = Math.min(
    configuredLimit,
    XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS.maxBoundaryOverlapLines,
  );
  const mergedLines = [];

  normalized.forEach((item) => {
    const pageLines = splitNormalizedOcrLines(item.text);
    const maximumOverlap = Math.min(overlapLimit, mergedLines.length, pageLines.length);
    let overlap = 0;
    for (let length = maximumOverlap; length > 0; length -= 1) {
      const previousKeys = mergedLines.slice(-length).map(getNormalizedOcrLineKey);
      const nextKeys = pageLines.slice(0, length).map(getNormalizedOcrLineKey);
      if (previousKeys.every((key, index) => key && key === nextKeys[index])) {
        overlap = length;
        break;
      }
    }
    mergedLines.push(...pageLines.slice(overlap));
  });

  return mergedLines.reduce((text, line) => {
    if (!text) return line;
    return `${text}${getXiaohongshuOcrLineBoundarySeparator(text, line)}${line}`;
  }, '');
}

function buildXiaohongshuOcrMarkdown(items = []) {
  const text = mergeXiaohongshuOcrText(items);
  return text ? `## 图片文字\n\n${text}` : '';
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

function normalizeSocialComment(comment, depth = 0) {
  const author = String(comment.author || '').replace(/^[:：]+|[:：]+$/g, '').trim();
  const content = String(comment.content || '').replace(/\s+/g, ' ').trim();
  if (!content || content.length < 2) return null;
  if (isNoisySocialCommentContent(content, author)) return null;
  const normalized = {
    author,
    content,
    time: String(comment.time || '').trim(),
    likes: String(comment.likes || '').trim(),
  };
  const id = getSocialCommentId(comment);
  if (id) normalized.id = id;
  const domRole = String(comment.domRole || '').trim().toLowerCase();
  if (['root', 'reply', 'unknown'].includes(domRole)) normalized.domRole = domRole;
  const parentCommentId = String(comment.parentCommentId || comment.parent_comment_id || '').trim();
  const parentAuthor = String(comment.parentAuthor || '').trim();
  if (parentCommentId) normalized.parentCommentId = parentCommentId;
  if (parentAuthor) normalized.parentAuthor = parentAuthor;
  if (depth < 4 && Array.isArray(comment.replies)) {
    const replySeen = new Set();
    const replies = comment.replies
      .map((reply) => normalizeSocialComment(reply, depth + 1))
      .filter((reply) => {
        if (!reply) return false;
        const key = getSocialCommentIdentity(reply);
        if (replySeen.has(key)) return false;
        replySeen.add(key);
        return true;
      })
      .slice(0, XIAOHONGSHU_REPLY_COMMENT_LIMIT);
    if (replies.length) normalized.replies = replies;
  }
  return normalized;
}

function isNoisySocialCommentContent(content, author = '') {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  const byAuthor = String(author || '').trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^(?:回复|评论|点赞|分享|收藏|展开|收起|查看|更多|写评论|发布|发送)$/.test(text)) return true;
  if (/^共\s*\d+\s*(?:条|則|个)?\s*(?:评论|回复)/.test(text)) return true;
  if (/(?:共\s*\d+\s*(?:条|个)?\s*评论).*(?:回复|展开|查看)/.test(text)) return true;
  if (/问一问.{0,30}(?:总结|都在问什么|为你)/.test(text) || /^问一问$/.test(byAuthor)) return true;
  if (byAuthor && getSocialCommentCanonicalText(text) === getSocialCommentCanonicalText(byAuthor)) return true;
  if (!byAuthor && text.length <= 4 && /^[\d\s赞回复评论]+$/.test(text)) return true;
  return false;
}

function getSocialCommentCanonicalText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^回复\s+[^:：]{1,80}\s*[:：]\s*/u, '')
    .replace(/\[[^\]\r\n]{1,16}\]/gu, '')
    .replace(/(?:\.{3,}|…{2,})?\s*(?:展开|收起|查看全部)\s*$/u, '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

function getSocialCommentId(comment) {
  if (!comment || typeof comment !== 'object') return '';
  return String(comment.id || comment.comment_id || comment.commentId || '').trim();
}

function getSocialCommentIdentity(comment) {
  const id = getSocialCommentId(comment);
  if (id) return `id:${id}`;
  return `text:${String(comment && comment.author || '').trim()}|${String(comment && comment.content || '').trim()}|${String(comment && comment.time || '').trim()}`;
}

function getSocialCommentFallbackIdentity(comment) {
  const rawAuthor = String(comment && comment.author || '')
    .replace(/^[:：]+|[:：]+$/g, '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
  const author = getSocialCommentCanonicalText(rawAuthor) || rawAuthor;
  const content = getSocialCommentCanonicalText(comment && comment.content);
  return author && content ? `${author}|${content}` : '';
}

function collectSocialCommentFallbackIdentities(comments = [], target = new Set()) {
  (Array.isArray(comments) ? comments : []).forEach((comment) => {
    const key = getSocialCommentFallbackIdentity(comment);
    if (key) target.add(key);
    collectSocialCommentFallbackIdentities(comment && comment.replies, target);
  });
  return target;
}

function getSocialCommentAuthorKey(author) {
  return String(author || '')
    .replace(/^[:：]+|[:：]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseXiaohongshuDomReply(comment) {
  const content = String(comment && comment.content || '').trim();
  if (String(comment && comment.domRole || '').toLowerCase() === 'reply') {
    return {
      parentCommentId: String(comment && comment.parentCommentId || '').trim(),
      targetAuthorKey: getSocialCommentAuthorKey(comment && comment.parentAuthor),
      content,
    };
  }
  const match = content.match(/^回复\s+(.{1,80}?)\s*[:：]\s*(.+)$/u);
  if (!match || !match[1] || !match[2]) return null;
  return {
    targetAuthorKey: getSocialCommentAuthorKey(match[1]),
    content: match[2].trim(),
  };
}

function pushSocialComment(comments, seen, comment) {
  const normalized = normalizeSocialComment(comment || {});
  if (!normalized) return;
  const key = getSocialCommentIdentity(normalized);
  if (seen.has(key)) return;
  seen.add(key);
  comments.push(normalized);
  const markRepliesSeen = (replies = []) => {
    (Array.isArray(replies) ? replies : []).forEach((reply) => {
      const replyKey = getSocialCommentIdentity(reply);
      seen.add(replyKey);
      markRepliesSeen(reply.replies);
    });
  };
  markRepliesSeen(normalized.replies);
}

function getSocialCommentReplyValues(value) {
  if (!value || typeof value !== 'object') return [];
  const replies = [];
  [
    'replies',
    'replyList',
    'reply_list',
    'subComments',
    'sub_comments',
    'subCommentList',
    'sub_comment_list',
    'children',
  ].forEach((key) => {
    if (Array.isArray(value[key])) replies.push(...value[key]);
  });
  return replies;
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

function mergeXiaohongshuNetworkCommentVariants(current, incoming) {
  const primary = normalizeSocialComment(current);
  const secondary = normalizeSocialComment(incoming);
  if (!primary) return secondary;
  if (!secondary) return primary;
  const replies = mergeXiaohongshuNetworkComments([
    Array.isArray(primary.replies) ? primary.replies : [],
    Array.isArray(secondary.replies) ? secondary.replies : [],
  ], XIAOHONGSHU_REPLY_COMMENT_LIMIT);
  const chooseRicher = (first, second) => {
    const a = String(first || '').trim();
    const b = String(second || '').trim();
    return b.length > a.length ? b : a;
  };
  const merged = {
    author: chooseRicher(primary.author, secondary.author),
    content: chooseRicher(primary.content, secondary.content),
    time: primary.time || secondary.time,
    likes: primary.likes || secondary.likes,
  };
  const id = getSocialCommentId(primary) || getSocialCommentId(secondary);
  if (id) merged.id = id;
  if (replies.length) merged.replies = replies;
  return merged;
}

function mergeXiaohongshuNetworkComments(groups = [], limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT) {
  const max = Math.max(1, Number(limit) || XIAOHONGSHU_ROOT_COMMENT_LIMIT);
  const comments = [];
  const indexes = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((comment) => {
      const normalized = normalizeSocialComment(comment);
      if (!normalized) return;
      const key = getSocialCommentIdentity(normalized);
      if (indexes.has(key)) {
        const index = indexes.get(key);
        comments[index] = mergeXiaohongshuNetworkCommentVariants(comments[index], normalized);
        return;
      }
      if (comments.length >= max) return;
      indexes.set(key, comments.length);
      comments.push(normalized);
    });
  });
  return comments.slice(0, max);
}

function preserveXiaohongshuPrimaryCommentTree(primaryComments = [], candidateComments = [], limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT) {
  return mergeXiaohongshuNetworkComments([
    Array.isArray(primaryComments) ? primaryComments : [],
    Array.isArray(candidateComments) ? candidateComments : [],
  ], limit);
}

function mergeXiaohongshuCommentSources({
  networkComments = [],
  deferredReplyGroups = [],
  fallbackGroups = [],
  limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT,
} = {}) {
  const max = Math.max(1, Math.min(Number(limit) || XIAOHONGSHU_ROOT_COMMENT_LIMIT, XIAOHONGSHU_ROOT_COMMENT_LIMIT));
  let comments = mergeXiaohongshuNetworkComments([networkComments], max);
  const networkStats = getSocialCommentTreeStats(comments);
  const canonicalKeys = collectSocialCommentFallbackIdentities(comments);
  let dedupedFallbackCount = 0;
  let fallbackAddedCount = 0;
  let fallbackReplyAddedCount = 0;
  let unmatchedFallbackReplyCount = 0;
  let droppedFallbackCount = 0;
  let restoredReplyCount = 0;
  let unmatchedDeferredReplyCount = 0;
  const hasNetworkRoots = comments.length > 0;

  (Array.isArray(fallbackGroups) ? fallbackGroups : []).forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((comment) => {
      const normalized = normalizeSocialComment(comment);
      if (!normalized) {
        droppedFallbackCount += 1;
        return;
      }
      const key = getSocialCommentFallbackIdentity(normalized);
      if (key && canonicalKeys.has(key)) {
        dedupedFallbackCount += 1;
        return;
      }
      const domReply = parseXiaohongshuDomReply(normalized);
      if (domReply) {
        let matchingRootIndexes = [];
        if (domReply.parentCommentId) {
          matchingRootIndexes = comments
            .map((root, index) => (getSocialCommentId(root) === domReply.parentCommentId ? index : -1))
            .filter((index) => index >= 0);
        }
        if (!matchingRootIndexes.length && domReply.targetAuthorKey) {
          matchingRootIndexes = comments
            .map((root, index) => (getSocialCommentAuthorKey(root && root.author) === domReply.targetAuthorKey ? index : -1))
            .filter((index) => index >= 0);
        }
        if (matchingRootIndexes.length !== 1) {
          unmatchedFallbackReplyCount += 1;
          return;
        }
        const rootIndex = matchingRootIndexes[0];
        const root = comments[rootIndex];
        const reply = normalizeSocialComment({
          ...normalized,
          content: domReply.content,
        });
        if (!reply) {
          unmatchedFallbackReplyCount += 1;
          return;
        }
        const existingReplies = Array.isArray(root.replies) ? root.replies : [];
        const mergedReplies = mergeXiaohongshuNetworkComments([
          existingReplies,
          [reply],
        ], XIAOHONGSHU_REPLY_COMMENT_LIMIT);
        if (mergedReplies.length === existingReplies.length) {
          dedupedFallbackCount += 1;
          return;
        }
        comments[rootIndex] = { ...root, replies: mergedReplies };
        const replyKey = getSocialCommentFallbackIdentity(reply);
        if (replyKey) canonicalKeys.add(replyKey);
        fallbackAddedCount += 1;
        fallbackReplyAddedCount += 1;
        return;
      }
      if (hasNetworkRoots && normalized.domRole !== 'root') {
        droppedFallbackCount += 1;
        return;
      }
      if (comments.length >= max) return;
      comments.push(normalized);
      if (key) canonicalKeys.add(key);
      collectSocialCommentFallbackIdentities(normalized.replies, canonicalKeys);
      fallbackAddedCount += 1;
    });
  });

  (Array.isArray(deferredReplyGroups) ? deferredReplyGroups : []).forEach((group) => {
    const rootCommentId = String(group && group.rootCommentId || '').trim();
    const payloads = Array.isArray(group && group.payloads) ? group.payloads : [];
    const hasMatchingRoot = Boolean(rootCommentId)
      && comments.some((comment) => getSocialCommentId(comment) === rootCommentId);
    if (!hasMatchingRoot) {
      payloads.forEach((payload) => {
        unmatchedDeferredReplyCount += getXiaohongshuCommentPageItems(payload).length;
      });
      return;
    }
    const beforeReplyCount = countSocialCommentReplies(comments);
    comments = mergeXiaohongshuReplyPages(comments, rootCommentId, payloads);
    restoredReplyCount += Math.max(0, countSocialCommentReplies(comments) - beforeReplyCount);
  });

  const finalStats = getSocialCommentTreeStats(comments);
  return {
    comments: comments.slice(0, max),
    networkRootCount: networkStats.rootCount,
    networkReplyCount: networkStats.replyCount,
    restoredRootCount: 0,
    restoredReplyCount,
    lostRootCount: Math.max(0, networkStats.rootCount - finalStats.rootCount),
    lostReplyCount: Math.max(0, networkStats.replyCount - finalStats.replyCount),
    dedupedFallbackCount,
    fallbackAddedCount,
    fallbackReplyAddedCount,
    unmatchedFallbackReplyCount,
    unmatchedDeferredReplyCount,
    droppedFallbackCount,
  };
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
    const id = getSocialCommentId(value);
    const replies = [];
    const replySeen = new Set();
    getSocialCommentReplyValues(value).forEach((reply) => {
      if (replies.length >= 20) return;
      extractCommentsFromObject(reply, replies, replySeen, 20, depth + 1);
    });
    pushSocialComment(comments, seen, {
      author,
      content,
      time,
      likes,
      id,
      replies,
    });
    return;
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
  const items = (comments || []).map((comment) => normalizeSocialComment(comment)).filter(Boolean);
  if (!items.length) return '';
  const lines = ['## 评论区', ''];
  const appendComment = (comment, indent = '', reply = false) => {
    const meta = [formatSocialCommentTime(comment.time), formatSocialCommentLikes(comment.likes)].filter(Boolean).join(' · ');
    const prefix = comment.author ? `**${comment.author}**：` : '';
    lines.push(`${indent}- ${reply ? '↳ ' : ''}${prefix}${comment.content}${meta ? `（${meta}）` : ''}`);
    (Array.isArray(comment.replies) ? comment.replies : []).forEach((child) => appendComment(child, `${indent}  `, true));
  };
  items.forEach((comment) => {
    appendComment(comment);
  });
  return lines.join('\n').trim();
}

function formatSocialCommentTime(value) {
  const text = String(value || '').trim();
  if (!/^\d{10,13}$/.test(text)) return text;
  const timestamp = Number(text) * (text.length === 10 ? 1000 : 1);
  if (!Number.isFinite(timestamp)) return text;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

function formatSocialCommentLikes(value) {
  const text = String(value || '').replace(/\s+/g, '').trim();
  if (!text) return '';
  if (/^(?:赞|点赞)$/.test(text)) return '赞';
  const count = text.match(/^(\d+(?:\.\d+)?(?:万|w)?)(?:赞|点赞)?$/i);
  return count ? `${count[1]} 赞` : text.replace(/(?:赞\s*){2,}$/u, '赞');
}

function getSocialCommentMarkdownStats(markdown = '') {
  let rootCount = 0;
  let replyCount = 0;
  let inComments = false;
  String(markdown || '').split(/\r?\n/).forEach((line) => {
    if (/^##\s+评论区\s*$/.test(line.trim())) {
      inComments = true;
      return;
    }
    if (inComments && /^##\s+/.test(line.trim())) {
      inComments = false;
      return;
    }
    if (!inComments) return;
    const match = line.match(/^(\s*)-\s+(?:↳\s+)?/u);
    if (!match) return;
    if (match[1].length > 0) replyCount += 1;
    else rootCount += 1;
  });
  return { rootCount, replyCount };
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

function splitSocialCommentsMarkdown(markdown = '') {
  const source = String(markdown || '').trim();
  if (!source) return { markdown: '', trailingMarkdown: '' };
  const match = /(^|\n)##\s+评论区\s*(?:\n|$)/u.exec(source);
  if (!match) return { markdown: source, trailingMarkdown: '' };
  const sectionStart = match.index + (match[1] ? match[1].length : 0);
  return {
    markdown: source.slice(0, sectionStart).trim(),
    trailingMarkdown: source.slice(sectionStart).trim(),
  };
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
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && (!parsed.port || parsed.port === '443')
      && isHostnameWithinDomain(parsed.hostname, 'xiaohongshu.com')
      && /^\/api\/sns\/web\/v\d+\/comment\/(?:sub\/)?page\/?$/.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function getXiaohongshuCommentPageData(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const candidate = payload.data || payload.result || payload;
  return candidate && typeof candidate === 'object' ? candidate : {};
}

function getXiaohongshuCommentPageItems(payload) {
  const data = getXiaohongshuCommentPageData(payload);
  const items = data.comments || data.comment_list || data.list || data.items || [];
  return Array.isArray(items) ? items : [];
}

function collectXiaohongshuCommentPages(payloads = [], limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT) {
  const comments = [];
  const seen = new Set();
  const max = Math.max(1, Math.min(Number(limit) || XIAOHONGSHU_ROOT_COMMENT_LIMIT, XIAOHONGSHU_ROOT_COMMENT_LIMIT));
  let pageCount = 0;
  let stopReason = 'source_exhausted';
  let previousCursor = '';
  const pages = Array.isArray(payloads) ? payloads : [];

  for (let index = 0; index < pages.length && comments.length < max; index += 1) {
    const payload = pages[index];
    const data = getXiaohongshuCommentPageData(payload);
    const pageComments = [];
    extractCommentsFromObject(getXiaohongshuCommentPageItems(payload), pageComments, new Set(), max - comments.length);
    pageComments.forEach((comment) => pushSocialComment(comments, seen, comment));
    pageCount += 1;
    const hasMore = data.has_more === true || data.has_more === 1 || data.hasMore === true || data.hasMore === 1;
    const cursor = String(data.cursor || data.next_cursor || data.nextCursor || '').trim();
    if (!hasMore) {
      stopReason = 'exhausted';
      break;
    }
    if (comments.length >= max) {
      stopReason = 'limit_reached';
      break;
    }
    if (!cursor || cursor === previousCursor) {
      stopReason = 'cursor_missing';
      break;
    }
    previousCursor = cursor;
  }
  return { comments: comments.slice(0, max), pageCount, stopReason };
}

function mergeXiaohongshuReplyPages(rootComments = [], rootCommentId = '', payloads = [], limit = XIAOHONGSHU_REPLY_COMMENT_LIMIT) {
  const targetId = String(rootCommentId || '').trim();
  const replyLimit = Math.max(1, Math.min(Number(limit) || XIAOHONGSHU_REPLY_COMMENT_LIMIT, XIAOHONGSHU_REPLY_COMMENT_LIMIT));
  return (Array.isArray(rootComments) ? rootComments : [])
    .map((comment) => normalizeSocialComment(comment))
    .filter(Boolean)
    .map((comment) => {
      if (!targetId || getSocialCommentId(comment) !== targetId) return comment;
      const replies = [];
      const seen = new Set();
      (Array.isArray(comment.replies) ? comment.replies : []).forEach((reply) => pushSocialComment(replies, seen, reply));
      (Array.isArray(payloads) ? payloads : []).forEach((payload) => {
        if (replies.length >= replyLimit) return;
        const pageReplies = [];
        extractCommentsFromObject(getXiaohongshuCommentPageItems(payload), pageReplies, new Set(), replyLimit - replies.length);
        pageReplies.forEach((reply) => {
          if (getSocialCommentId(reply) === targetId) return;
          if (replies.length < replyLimit) pushSocialComment(replies, seen, reply);
        });
      });
      return replies.length ? { ...comment, replies } : comment;
    });
}

function isXiaohongshuSubCommentApiUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && (!parsed.port || parsed.port === '443')
      && isHostnameWithinDomain(parsed.hostname, 'xiaohongshu.com')
      && /^\/api\/sns\/web\/v\d+\/comment\/sub\/page\/?$/.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function getXiaohongshuCapturedRootCommentId(entry = {}) {
  const url = String(entry && entry.url || '').trim();
  try {
    const parsed = new URL(url);
    for (const key of ['root_comment_id', 'rootCommentId', 'comment_id', 'commentId']) {
      const value = String(parsed.searchParams.get(key) || '').trim();
      if (value) return value;
    }
  } catch (error) {}
  const body = String(entry && entry.body || '');
  try {
    const params = new URLSearchParams(body);
    for (const key of ['root_comment_id', 'rootCommentId', 'comment_id', 'commentId']) {
      const value = String(params.get(key) || '').trim();
      if (value) return value;
    }
  } catch (error) {}
  const match = body.match(/(?:^|[?&])(?:root_comment_id|rootCommentId|comment_id|commentId)=([^&]+)/i);
  return match && match[1] ? decodeURIComponent(match[1]).trim() : '';
}

function getXiaohongshuCapturedPayloads(entry = {}) {
  if (entry && entry.payload && typeof entry.payload === 'object') return [entry.payload];
  const text = String(entry && entry.text || '').trim();
  if (!text || text.length > XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS) return [];
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch (error) {}
  return collectJsonObjectCandidates(text)
    .map((candidate) => parseLooseJsonCandidate(candidate))
    .filter((payload) => payload && typeof payload === 'object');
}

function isRejectedXiaohongshuCommentPayload(payload) {
  if (!payload || typeof payload !== 'object') return true;
  const data = getXiaohongshuCommentPageData(payload);
  const success = payload.success !== undefined ? payload.success : data.success;
  const code = payload.code !== undefined
    ? payload.code
    : (payload.error_code !== undefined ? payload.error_code : (data.code !== undefined ? data.code : data.error_code));
  if (success === false || success === 0 || success === 'false') return true;
  return code !== undefined && code !== null && String(code) !== '' && String(code) !== '0';
}

function countSocialCommentReplies(comments = []) {
  let count = 0;
  const visit = (items) => {
    (Array.isArray(items) ? items : []).forEach((item) => {
      const replies = Array.isArray(item && item.replies) ? item.replies : [];
      count += replies.length;
      visit(replies);
    });
  };
  visit(comments);
  return count;
}

function getSocialCommentTreeStats(comments = []) {
  const roots = (Array.isArray(comments) ? comments : [])
    .map((comment) => normalizeSocialComment(comment))
    .filter(Boolean);
  return {
    rootCount: roots.length,
    replyCount: countSocialCommentReplies(roots),
  };
}

function limitSocialCommentTreeTotal(comments = [], limit = XIAOHONGSHU_TOTAL_COMMENT_LIMIT) {
  const max = Math.max(1, Math.min(
    Number(limit) || XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
  ));
  let remaining = max;
  const takeComment = (comment) => {
    if (remaining <= 0) return null;
    const normalized = normalizeSocialComment(comment);
    if (!normalized) return null;
    remaining -= 1;
    const limited = { ...normalized };
    const replies = Array.isArray(normalized.replies) ? normalized.replies : [];
    delete limited.replies;
    if (remaining > 0 && replies.length) {
      const limitedReplies = [];
      for (const reply of replies) {
        const limitedReply = takeComment(reply);
        if (limitedReply) limitedReplies.push(limitedReply);
        if (remaining <= 0) break;
      }
      if (limitedReplies.length) limited.replies = limitedReplies;
    }
    return limited;
  };
  const limitedComments = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    const limited = takeComment(comment);
    if (limited) limitedComments.push(limited);
    if (remaining <= 0) break;
  }
  return limitedComments;
}

function mergeXiaohongshuCapturedCommentPayloads(
  entries = [],
  limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT,
  options = {},
) {
  const rootPayloads = [];
  const replyPayloadGroups = new Map();
  const orphanReplyPayloads = [];
  let rootPayloadCount = 0;
  let replyPayloadCount = 0;
  let invalidPayloadCount = 0;
  const expectedNoteId = String(options && options.expectedNoteId || '').trim();
  const orderedEntries = (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({
      entry,
      index,
      sequence: Number.isFinite(Number(entry && entry.sequence)) ? Number(entry.sequence) : index,
    }))
    .sort((a, b) => a.sequence - b.sequence || a.index - b.index)
    .map((item) => item.entry);
  orderedEntries.forEach((entry) => {
    const url = String(entry && entry.url || '').trim();
    if (!isXiaohongshuCommentApiUrl(url)) return;
    const requestIdentity = {
      url,
      body: String(entry && (entry.body || entry.postData) || ''),
    };
    if (expectedNoteId
      && classifyXiaohongshuCommentRequestIdentity(requestIdentity, expectedNoteId) !== 'matched') return;
    const payloads = getXiaohongshuCapturedPayloads(entry);
    if (!payloads.length) return;
    const isReply = isXiaohongshuSubCommentApiUrl(url);
    if (!isReply) {
      payloads.forEach((payload) => {
        if (expectedNoteId
          && classifyXiaohongshuCommentRequestIdentity({
            ...requestIdentity,
            payload,
          }, expectedNoteId) !== 'matched') {
          invalidPayloadCount += 1;
          return;
        }
        if (isRejectedXiaohongshuCommentPayload(payload)) {
          invalidPayloadCount += 1;
          return;
        }
        rootPayloads.push(payload);
        rootPayloadCount += 1;
      });
      return;
    }
    const rootCommentId = getXiaohongshuCapturedRootCommentId(entry);
    payloads.forEach((payload) => {
      if (expectedNoteId
        && classifyXiaohongshuCommentRequestIdentity({
          ...requestIdentity,
          payload,
        }, expectedNoteId) !== 'matched') {
        invalidPayloadCount += 1;
        return;
      }
      if (isRejectedXiaohongshuCommentPayload(payload)) {
        invalidPayloadCount += 1;
        return;
      }
      replyPayloadCount += 1;
      const payloadRootId = rootCommentId
        || getXiaohongshuCommentPageItems(payload)
          .map((item) => String(item && (item.root_comment_id || item.rootCommentId) || '').trim())
          .find(Boolean)
        || '';
      if (!payloadRootId) {
        orphanReplyPayloads.push(payload);
        return;
      }
      if (!replyPayloadGroups.has(payloadRootId)) replyPayloadGroups.set(payloadRootId, []);
      replyPayloadGroups.get(payloadRootId).push(payload);
    });
  });

  const rootResult = collectXiaohongshuCommentPages(rootPayloads, limit);
  let comments = rootResult.comments;
  const deferredReplyGroups = [];
  let unmatchedReplyCount = 0;
  let unmatchedReplyPayloadCount = 0;
  replyPayloadGroups.forEach((payloads, rootCommentId) => {
    const hasMatchingRoot = comments.some((comment) => getSocialCommentId(comment) === rootCommentId);
    if (!hasMatchingRoot) {
      deferredReplyGroups.push({ rootCommentId, payloads: [...payloads] });
      unmatchedReplyPayloadCount += payloads.length;
      payloads.forEach((payload) => {
        unmatchedReplyCount += getXiaohongshuCommentPageItems(payload).length;
      });
      return;
    }
    comments = mergeXiaohongshuReplyPages(comments, rootCommentId, payloads);
  });
  if (orphanReplyPayloads.length) {
    deferredReplyGroups.push({ rootCommentId: '', payloads: [...orphanReplyPayloads] });
    orphanReplyPayloads.forEach((payload) => {
      unmatchedReplyCount += getXiaohongshuCommentPageItems(payload).length;
    });
    unmatchedReplyPayloadCount += orphanReplyPayloads.length;
  }
  return {
    comments: comments.slice(0, limit),
    rootPayloadCount,
    replyPayloadCount,
    invalidPayloadCount,
    orphanReplyPayloadCount: orphanReplyPayloads.length,
    unmatchedReplyCount,
    unmatchedReplyPayloadCount,
    deferredReplyGroups,
    rootCount: rootResult.comments.length,
    replyCount: countSocialCommentReplies(comments),
    rootPageCount: rootResult.pageCount,
    replyPageCount: replyPayloadCount,
    pageCount: rootResult.pageCount + replyPayloadCount,
    stopReason: rootPayloadCount ? rootResult.stopReason : 'root_unavailable',
    source: rootPayloadCount || replyPayloadCount ? 'browser-network' : 'page-api',
  };
}

function buildXiaohongshuCommentDiagnostic(details = {}) {
  const source = String(details.source || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown';
  const toCount = (value) => Math.max(0, Math.floor(Number(value) || 0));
  const toLabel = (value, fallback = 'unknown') => String(value || fallback).replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || fallback;
  const scrollMode = toLabel(details.scrollMode);
  const pageApiStopReason = toLabel(details.pageApiStopReason);
  const stopReason = String(details.stopReason || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'unknown';
  return `<!-- xhs-comment-diag: source=${source}; root=${toCount(details.rootCount)}; replies=${toCount(details.replyCount)}; pages=${toCount(details.pageCount)}; root_pages=${toCount(details.rootPageCount)}; reply_pages=${toCount(details.replyPageCount)}; root_requests=${toCount(details.rootRequestCount)}; reply_requests=${toCount(details.replyRequestCount)}; merged_root=${toCount(details.mergedRootCount)}; merged_replies=${toCount(details.mergedReplyCount)}; restored_root=${toCount(details.restoredRootCount)}; restored_replies=${toCount(details.restoredReplyCount)}; final_root=${toCount(details.finalRootCount)}; final_replies=${toCount(details.finalReplyCount)}; lost_root=${toCount(details.lostRootCount)}; lost_replies=${toCount(details.lostReplyCount)}; fallback=${toCount(details.fallbackAddedCount)}; deduped=${toCount(details.dedupedFallbackCount)}; dropped=${toCount(details.droppedFallbackCount)}; unmatched=${toCount(details.unmatchedReplyCount)}; invalid=${toCount(details.invalidPayloadCount)}; partial=${details.partial ? 1 : 0}; scroll=${scrollMode}; api_stop=${pageApiStopReason}; stop=${stopReason} -->`;
}

function appendXiaohongshuCommentDiagnostic(markdown, details = {}) {
  const source = String(markdown || '').trim().replace(/\n*<!-- xhs-comment-diag:[\s\S]*?-->\s*$/u, '').trim();
  if (!source) return source;
  const diagnostic = typeof details === 'string' && /^<!-- xhs-comment-diag: [\s\S]* -->$/.test(details)
    ? details
    : buildXiaohongshuCommentDiagnostic(details);
  return `${source}\n\n${diagnostic}`;
}

function stripSocialCommentsFromMarkdown(markdown = '') {
  const source = String(markdown || '')
    .replace(/\n*<!-- xhs-comment-diag:[\s\S]*?-->\s*$/u, '')
    .trim();
  if (!source) return '';
  const lines = source.split(/\r?\n/);
  const kept = [];
  let skippingComments = false;
  lines.forEach((line) => {
    if (/^##\s+评论区\s*$/u.test(line.trim())) {
      skippingComments = true;
      return;
    }
    if (skippingComments && /^##\s+\S/u.test(line.trim())) {
      skippingComments = false;
    }
    if (!skippingComments) kept.push(line);
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function replaceSocialCommentsInMarkdown(markdown, comments = []) {
  const source = stripSocialCommentsFromMarkdown(markdown);
  const commentMarkdown = buildSocialCommentsMarkdown(comments);
  return [source, commentMarkdown].filter(Boolean).join('\n\n').trim();
}

function isPartialXiaohongshuCommentResult(details = {}) {
  if (details.partial) return true;
  if (Number(details.lostRootCount || 0) > 0 || Number(details.lostReplyCount || 0) > 0) return true;
  if (Number(details.unmatchedReplyCount || 0) > 0) return true;
  const stopReason = String(details.stopReason || '').toLowerCase();
  return /(?:idle|unavailable|missing|failed|rejected|captcha|timeout|time_budget_exceeded|limit_reached|max_rounds|source_exhausted)/.test(stopReason);
}

function finalizeXiaohongshuComments({
  baseMarkdown = '',
  renderedComments = [],
  staticComments = [],
  diagnosticDetails = {},
  limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT,
} = {}) {
  const max = Math.max(1, Math.min(Number(limit) || XIAOHONGSHU_ROOT_COMMENT_LIMIT, XIAOHONGSHU_ROOT_COMMENT_LIMIT));
  const renderedTree = mergeXiaohongshuNetworkComments([renderedComments], max);
  const hasRenderedTree = renderedTree.length > 0;
  const fallbackMerge = hasRenderedTree
    ? null
    : mergeXiaohongshuCommentSources({
      networkComments: [],
      fallbackGroups: [staticComments],
      limit: max,
    });
  const comments = limitSocialCommentTreeTotal(
    hasRenderedTree ? renderedTree : fallbackMerge.comments,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
  );
  const stats = getSocialCommentTreeStats(comments);
  const inputStats = getSocialCommentTreeStats(renderedComments);
  const markdownWithoutDiagnostic = replaceSocialCommentsInMarkdown(baseMarkdown, comments);
  const markdownStats = getSocialCommentMarkdownStats(markdownWithoutDiagnostic);
  const mergedRootCount = Math.max(
    Number(diagnosticDetails.mergedRootCount || 0),
    inputStats.rootCount,
  );
  const mergedReplyCount = Math.max(
    Number(diagnosticDetails.mergedReplyCount || 0),
    inputStats.replyCount,
  );
  const finalDiagnosticDetails = {
    ...diagnosticDetails,
    mergedRootCount,
    mergedReplyCount,
    finalRootCount: markdownStats.rootCount,
    finalReplyCount: markdownStats.replyCount,
    lostRootCount: Math.max(
      Number(diagnosticDetails.lostRootCount || 0),
      Math.max(0, mergedRootCount - markdownStats.rootCount),
    ),
    lostReplyCount: Math.max(
      Number(diagnosticDetails.lostReplyCount || 0),
      Math.max(0, mergedReplyCount - markdownStats.replyCount),
    ),
    fallbackAddedCount: Number(diagnosticDetails.fallbackAddedCount || 0)
      + Number(fallbackMerge && fallbackMerge.fallbackAddedCount || 0),
    dedupedFallbackCount: Number(diagnosticDetails.dedupedFallbackCount || 0)
      + Number(fallbackMerge && fallbackMerge.dedupedFallbackCount || 0),
    droppedFallbackCount: Number(diagnosticDetails.droppedFallbackCount || 0)
      + Number(fallbackMerge && fallbackMerge.droppedFallbackCount || 0),
    unmatchedReplyCount: Number(diagnosticDetails.unmatchedReplyCount || 0)
      + Number(fallbackMerge && fallbackMerge.unmatchedFallbackReplyCount || 0),
  };
  finalDiagnosticDetails.partial = isPartialXiaohongshuCommentResult(finalDiagnosticDetails);
  const shouldAppendDiagnostic = Object.keys(diagnosticDetails || {}).length > 0;
  return {
    comments,
    markdown: shouldAppendDiagnostic
      ? appendXiaohongshuCommentDiagnostic(markdownWithoutDiagnostic, finalDiagnosticDetails)
      : markdownWithoutDiagnostic,
    stats,
    markdownStats,
    diagnosticDetails: finalDiagnosticDetails,
    usedStaticFallback: !hasRenderedTree && comments.length > 0,
  };
}

function didXiaohongshuRootCollectionProgress(previous = {}, current = {}) {
  const previousRootCommentCount = Number(previous && previous.rootCommentCount) || 0;
  const previousRootRequestCount = Number(previous && previous.rootRequestCount) || 0;
  const previousScrollTop = Number(previous && previous.scrollTop) || 0;
  const previousScrollHeight = Number(previous && previous.scrollHeight) || 0;
  const currentRootCommentCount = Number(current && current.rootCommentCount) || 0;
  const currentRootRequestCount = Number(current && current.rootRequestCount) || 0;
  const currentScrollTop = Number(current && current.scrollTop) || 0;
  const currentScrollHeight = Number(current && current.scrollHeight) || 0;
  return currentRootCommentCount > previousRootCommentCount
    || currentRootRequestCount > previousRootRequestCount
    || currentScrollTop > previousScrollTop + 1
    || currentScrollHeight > previousScrollHeight + 1;
}

function getXiaohongshuCommentBudgetState({
  deadlineAt = 0,
  now = Date.now(),
  totalCount = 0,
  limit = XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
} = {}) {
  const currentTime = Number(now) || 0;
  const deadline = Number(deadlineAt) || currentTime;
  const max = Math.max(1, Math.min(
    Number(limit) || XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
  ));
  const remainingMs = Math.max(0, deadline - currentTime);
  if (Math.max(0, Number(totalCount) || 0) >= max) {
    return { shouldStop: true, stopReason: 'total_limit_reached', remainingMs };
  }
  if (remainingMs <= 0) {
    return { shouldStop: true, stopReason: 'time_budget_exceeded', remainingMs: 0 };
  }
  return { shouldStop: false, stopReason: '', remainingMs };
}

function getXiaohongshuCommentPaginationScript(url = '', options = {}) {
  const requestedDeadlineAt = Number(options && options.deadlineAt);
  const deadlineAt = Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > 0
    ? Math.floor(requestedDeadlineAt)
    : Date.now() + XIAOHONGSHU_COMMENT_TIMEOUT_MS;
  const requestedTotalLimit = Number(options && options.totalLimit);
  const totalLimit = Math.max(1, Math.min(
    Number.isFinite(requestedTotalLimit) ? requestedTotalLimit : XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
  ));
  return `
    (async () => {
      const XIAOHONGSHU_ROOT_COMMENT_LIMIT = ${XIAOHONGSHU_ROOT_COMMENT_LIMIT};
      const XIAOHONGSHU_REPLY_COMMENT_LIMIT = ${XIAOHONGSHU_REPLY_COMMENT_LIMIT};
      const XIAOHONGSHU_TOTAL_COMMENT_LIMIT = ${totalLimit};
      const XIAOHONGSHU_ROOT_COMMENT_PAGE_LIMIT = ${XIAOHONGSHU_ROOT_COMMENT_PAGE_LIMIT};
      const deadlineAt = ${deadlineAt};
      const requestTimeoutMs = ${XIAOHONGSHU_COMMENT_REQUEST_TIMEOUT_MS};
      const inputUrl = ${JSON.stringify(cleanDisplayUrl(url))};
      const getBudgetStopReason = (totalCount) => {
        if (Number(totalCount || 0) >= XIAOHONGSHU_TOTAL_COMMENT_LIMIT) return 'total_limit_reached';
        if (Date.now() >= deadlineAt) return 'time_budget_exceeded';
        return '';
      };
      const safeUrl = (value) => { try { return new URL(value || location.href, location.href); } catch (error) { return null; } };
      const readField = (value, keys) => {
        for (const key of keys) {
          if (value && Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined && value[key] !== null) return value[key];
        }
        return undefined;
      };
      const getData = (payload) => payload && (payload.data || payload.result || payload) || {};
      const getItems = (payload) => {
        const items = readField(getData(payload), ['comments', 'comment_list', 'list', 'items']);
        return Array.isArray(items) ? items : [];
      };
      const getCursor = (payload) => String(readField(getData(payload), ['cursor', 'next_cursor', 'nextCursor']) || '').trim();
      const hasMore = (payload) => {
        const value = readField(getData(payload), ['has_more', 'hasMore', 'has_next', 'hasNext']);
        return value === true || value === 1 || value === 'true' || value === '1';
      };
      const getId = (comment) => String(readField(comment, ['id', 'comment_id', 'commentId']) || '').trim();
      const pageSource = () => {
        try { return JSON.stringify(window.__INITIAL_STATE__ || {}) + '\\n' + JSON.stringify(window.__APOLLO_STATE__ || {}); } catch (error) { return ''; }
      };
      const noteId = (() => {
        for (const parsed of [safeUrl(inputUrl)].filter(Boolean)) {
          const match = parsed.pathname.match(/\\/(?:explore|discovery\\/item|item)\\/([0-9a-zA-Z]+)/i);
          if (match && match[1]) return match[1];
          const value = parsed.searchParams.get('note_id') || parsed.searchParams.get('noteId');
          if (value) return value;
        }
        return '';
      })();
      const xsecToken = (() => {
        for (const parsed of [safeUrl(location.href), safeUrl(inputUrl)].filter(Boolean)) {
          const value = parsed.searchParams.get('xsec_token') || parsed.searchParams.get('xsecToken');
          if (value) return value;
        }
        const match = pageSource().match(/["']xsec_token["']\\s*:\\s*["']([^"']+)["']/i)
          || pageSource().match(/["']xsecToken["']\\s*:\\s*["']([^"']+)["']/i);
        return match && match[1] ? String(match[1]).trim() : '';
      })();
      const requestJson = async (path, params) => {
        const remainingMs = Math.max(0, deadlineAt - Date.now());
        if (remainingMs <= 0) throw new Error('time_budget_exceeded');
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value));
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(requestTimeoutMs, remainingMs)));
        try {
          const response = await fetch(path + '?' + query.toString(), {
            method: 'GET',
            credentials: 'include',
            signal: controller.signal,
            headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' },
          });
          if (!response.ok) throw new Error('http_' + response.status);
          return JSON.parse(await response.text());
        } finally {
          clearTimeout(timer);
        }
      };
      const diagnostic = { source: 'page-api', rootCount: 0, replyCount: 0, pageCount: 0, stopReason: 'unknown' };
      const rootPayloads = [];
      const replyPayloadGroups = [];
      if (!noteId) {
        diagnostic.stopReason = 'note_id_missing';
        return { rootPayloads, replyPayloadGroups, diagnostic, identityNoteId: '' };
      }
      const baseParams = { note_id: noteId, xsec_token: xsecToken, image_scenes: 'FD_WM_WEBP,CRD_WM_WEBP', image_formats: 'jpg,webp,avif' };
      const roots = [];
      let cursor = '';
      for (let page = 0; page < XIAOHONGSHU_ROOT_COMMENT_PAGE_LIMIT && roots.length < XIAOHONGSHU_ROOT_COMMENT_LIMIT; page += 1) {
        const budgetStopReason = getBudgetStopReason(roots.length + diagnostic.replyCount);
        if (budgetStopReason) {
          diagnostic.stopReason = budgetStopReason;
          break;
        }
        let payload;
        try {
          payload = await requestJson('/api/sns/web/v2/comment/page', { ...baseParams, cursor, top_comment_id: '' });
        } catch (error) {
          diagnostic.stopReason = getBudgetStopReason(roots.length + diagnostic.replyCount)
            || (roots.length ? 'root_request_failed' : 'root_unavailable');
          break;
        }
        rootPayloads.push(payload);
        diagnostic.pageCount += 1;
        getItems(payload).forEach((comment) => {
          if (roots.length < XIAOHONGSHU_ROOT_COMMENT_LIMIT) roots.push(comment);
        });
        if (!hasMore(payload)) {
          diagnostic.stopReason = 'exhausted';
          break;
        }
        const nextCursor = getCursor(payload);
        if (!nextCursor || nextCursor === cursor) {
          diagnostic.stopReason = 'root_cursor_missing';
          break;
        }
        cursor = nextCursor;
        if (roots.length >= XIAOHONGSHU_ROOT_COMMENT_LIMIT) diagnostic.stopReason = 'limit_reached';
      }
      diagnostic.rootCount = roots.length;
      for (const root of roots) {
        const rootBudgetStopReason = getBudgetStopReason(roots.length + diagnostic.replyCount);
        if (rootBudgetStopReason) {
          diagnostic.stopReason = rootBudgetStopReason;
          break;
        }
        const rootCommentId = getId(root);
        if (!rootCommentId) continue;
        const inlineReplies = readField(root, ['sub_comments', 'subComments', 'reply_list', 'replyList']);
        const inlineCount = Array.isArray(inlineReplies) ? inlineReplies.length : 0;
        const declaredCount = Number(readField(root, ['sub_comment_count', 'subCommentCount', 'sub_comment_num', 'reply_count', 'replyCount']) || 0);
        const hasHiddenReplies = declaredCount > inlineCount || readField(root, ['sub_comment_cursor', 'subCommentCursor', 'sub_comment_has_more', 'subCommentHasMore']) !== undefined;
        diagnostic.replyCount += Math.min(
          inlineCount,
          Math.max(0, XIAOHONGSHU_TOTAL_COMMENT_LIMIT - roots.length - diagnostic.replyCount),
        );
        if (!hasHiddenReplies) continue;
        const payloads = [];
        let replyCursor = '';
        let replyTotal = inlineCount;
        for (let page = 0; page < 10 && replyTotal < XIAOHONGSHU_REPLY_COMMENT_LIMIT; page += 1) {
          const replyBudgetStopReason = getBudgetStopReason(roots.length + diagnostic.replyCount);
          if (replyBudgetStopReason) {
            diagnostic.stopReason = replyBudgetStopReason;
            break;
          }
          let payload;
          try {
            payload = await requestJson('/api/sns/web/v2/comment/sub/page', { ...baseParams, root_comment_id: rootCommentId, cursor: replyCursor, num: 20 });
          } catch (error) {
            diagnostic.stopReason = getBudgetStopReason(roots.length + diagnostic.replyCount)
              || 'reply_request_failed';
            break;
          }
          payloads.push(payload);
          diagnostic.pageCount += 1;
          const replies = getItems(payload).filter((reply) => getId(reply) !== rootCommentId);
          replyTotal += replies.length;
          diagnostic.replyCount += Math.min(
            replies.length,
            Math.max(0, XIAOHONGSHU_TOTAL_COMMENT_LIMIT - roots.length - diagnostic.replyCount),
          );
          if (!hasMore(payload)) break;
          const nextCursor = getCursor(payload);
          if (!nextCursor || nextCursor === replyCursor) {
            if (diagnostic.stopReason === 'exhausted') diagnostic.stopReason = 'reply_cursor_missing';
            break;
          }
          replyCursor = nextCursor;
          if (replyTotal >= XIAOHONGSHU_REPLY_COMMENT_LIMIT && diagnostic.stopReason === 'exhausted') diagnostic.stopReason = 'reply_limit_reached';
        }
        if (payloads.length) replyPayloadGroups.push({ rootCommentId, payloads });
      }
      const finalBudgetStopReason = getBudgetStopReason(roots.length + diagnostic.replyCount);
      if (finalBudgetStopReason) diagnostic.stopReason = finalBudgetStopReason;
      if (diagnostic.stopReason === 'unknown') diagnostic.stopReason = roots.length >= XIAOHONGSHU_ROOT_COMMENT_LIMIT ? 'total_limit_reached' : 'source_exhausted';
      return { rootPayloads, replyPayloadGroups, diagnostic, identityNoteId: noteId };
    })()
  `;
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

function getXiaohongshuCapturedRequestBody(details = {}) {
  const parts = [];
  let totalBytes = 0;
  for (const item of (Array.isArray(details.uploadData) ? details.uploadData : [])) {
    if (!item || !item.bytes) continue;
    try {
      const byteLength = Number(item.bytes.byteLength ?? item.bytes.length);
      if (!Number.isFinite(byteLength)
        || byteLength < 0
        || totalBytes + byteLength > XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS) {
        return XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER;
      }
      const buffer = Buffer.from(item.bytes);
      totalBytes += buffer.length;
      if (totalBytes > XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS) {
        return XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER;
      }
      const text = buffer.toString('utf8');
      if (text) parts.push(text);
    } catch (error) {}
  }
  const body = parts.join('&');
  return body.length > XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS
    ? XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER
    : body;
}

function getXiaohongshuCapturedResponseText(bodyResult = {}) {
  const body = String(bodyResult && bodyResult.body || '');
  if (!body) return '';
  if (bodyResult && bodyResult.base64Encoded) {
    const maxEncodedLength = Math.ceil(XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS / 3) * 4 + 8;
    if (body.length > maxEncodedLength) return '';
    try {
      const decoded = Buffer.from(body, 'base64');
      if (decoded.length > XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS) return '';
      return decoded.toString('utf8');
    } catch (error) {
      return '';
    }
  }
  return body.length <= XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS ? body : '';
}

function collectXiaohongshuCommentNoteIdsFromValue(payload, ids, state = null, depth = 0) {
  const traversal = state && state.seen instanceof Set
    ? state
    : {
      seen: state instanceof Set ? state : new Set(),
      visitedEntries: 0,
      truncated: false,
    };
  if (!payload || typeof payload !== 'object') return traversal;
  if (depth > 8 || traversal.seen.size >= XIAOHONGSHU_COMMENT_IDENTITY_MAX_NODES) {
    traversal.truncated = true;
    return traversal;
  }
  if (traversal.seen.has(payload)) return traversal;
  traversal.seen.add(payload);
  for (const key in payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    traversal.visitedEntries += 1;
    if (traversal.visitedEntries > XIAOHONGSHU_COMMENT_IDENTITY_MAX_NODES) {
      traversal.truncated = true;
      break;
    }
    const child = payload[key];
    if (/^(?:note_id|noteId|item_id|itemId)$/.test(key)) {
      const rawId = String(child || '').trim();
      if (rawId.length > 256) {
        traversal.truncated = true;
        break;
      }
      const id = rawId.toLowerCase();
      if (/^[0-9a-z_-]{6,}$/i.test(id) && !ids.includes(id)) ids.push(id);
    } else if (child && typeof child === 'object') {
      collectXiaohongshuCommentNoteIdsFromValue(child, ids, traversal, depth + 1);
      if (traversal.truncated) break;
    }
  }
  return traversal;
}

function collectXiaohongshuCommentRequestNoteIds(request = {}, includePayload = false) {
  const ids = [];
  let truncated = false;
  const add = (value) => {
    const id = String(value || '').trim().toLowerCase();
    if (/^[0-9a-z_-]{6,}$/i.test(id) && !ids.includes(id)) ids.push(id);
  };
  const readParams = (params) => {
    ['note_id', 'noteId', 'item_id', 'itemId'].forEach((key) => {
      const values = typeof params.getAll === 'function' ? params.getAll(key) : [params.get(key)];
      values.forEach(add);
    });
  };
  try {
    readParams(new URL(String(request.url || '')).searchParams);
  } catch (error) {}
  const body = String(request.body || '').trim();
  if (body) {
    if (body === XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER
      || body.length > XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS) {
      truncated = true;
    } else {
      try {
        readParams(new URLSearchParams(body));
      } catch (error) {}
      try {
        const payload = JSON.parse(body);
        const bodyIds = [];
        const bodyState = collectXiaohongshuCommentNoteIdsFromValue(payload, bodyIds);
        truncated = truncated || Boolean(bodyState && bodyState.truncated);
        bodyIds.forEach(add);
      } catch (error) {}
    }
  }
  if (includePayload && request.payload && typeof request.payload === 'object') {
    const payloadIds = [];
    const payloadState = collectXiaohongshuCommentNoteIdsFromValue(request.payload, payloadIds);
    truncated = truncated || Boolean(payloadState && payloadState.truncated);
    payloadIds.forEach(add);
  }
  return { ids, truncated };
}

function classifyXiaohongshuCommentRequestIdentity(request = {}, expectedNoteId = '') {
  const expected = String(expectedNoteId || '').trim().toLowerCase();
  if (!expected) return 'unbound';
  const requestUrl = String(request && request.url || '').trim();
  if (requestUrl && !isXiaohongshuCommentApiUrl(requestUrl)) return 'mismatched';
  const requestIdentity = collectXiaohongshuCommentRequestNoteIds(request, false);
  if (requestIdentity.truncated) return 'mismatched';
  const requestIds = requestIdentity.ids;
  if (!requestIds.length) return 'unidentified';
  if (!requestIds.every((id) => id === expected)) return 'mismatched';
  const payloadIds = [];
  const payloadState = collectXiaohongshuCommentNoteIdsFromValue(request.payload, payloadIds);
  if (payloadState && payloadState.truncated) return 'mismatched';
  if (payloadIds.length && !payloadIds.every((id) => id === expected)) return 'mismatched';
  return 'matched';
}

async function fetchXiaohongshuCommentsFromCapturedRequests(
  commentApiRequests = [],
  limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT,
  options = {},
) {
  throwIfAborted(options.signal);
  const comments = [];
  const seen = new Set();
  const deadlineAt = Number(options && options.deadlineAt) || (Date.now() + XIAOHONGSHU_COMMENT_TIMEOUT_MS);
  const totalLimit = Math.max(1, Math.min(
    Number(options && options.totalLimit) || XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
  ));
  const expectedNoteId = String(options && options.expectedNoteId || '').trim();
  if (!expectedNoteId) return [];
  const cookieHeader = await getXiaohongshuCookieHeader();
  throwIfAborted(options.signal);
  const uniqueRequests = [];
  const seenRequests = new Set();
  (commentApiRequests || []).forEach((request) => {
    const url = String(request && request.url || '').trim();
    const method = String(request && request.method || 'GET').toUpperCase();
    const body = String(request && request.body || '');
    const key = `${method}|${url}|${body}`;
    if (!isXiaohongshuCommentApiUrl(url)
      || classifyXiaohongshuCommentRequestIdentity({ url, body }, expectedNoteId) !== 'matched'
      || seenRequests.has(key)) return;
    seenRequests.add(key);
    uniqueRequests.push(request);
  });
  for (const request of uniqueRequests.slice(-8)) {
    throwIfAborted(options.signal);
    const budget = getXiaohongshuCommentBudgetState({
      deadlineAt,
      totalCount: comments.length,
      limit: totalLimit,
    });
    if (comments.length >= limit || budget.shouldStop) break;
    try {
      const response = await requestJsonViaNode({
        url: request.url,
        method: String(request.method || 'GET').toUpperCase(),
        body: String(request.method || 'GET').toUpperCase() === 'GET' ? '' : String(request.body || ''),
        headers: sanitizeXiaohongshuCapturedHeaders(request.requestHeaders || {}, cookieHeader),
        timeout: Math.max(1, Math.min(XIAOHONGSHU_COMMENT_REQUEST_TIMEOUT_MS, budget.remainingMs)),
        maxBytes: XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS,
        signal: options.signal,
      });
      throwIfAborted(options.signal);
      if (!response || response.status < 200 || response.status >= 300) continue;
      if (response.json) {
        if (classifyXiaohongshuCommentRequestIdentity({
          url: request.url,
          body: request.body,
          payload: response.json,
        }, expectedNoteId) !== 'matched') continue;
        extractCommentsFromObject(response.json, comments, seen, limit);
      } else if (response.text) {
        collectJsonObjectCandidates(response.text).forEach((candidate) => {
          const payload = parseLooseJsonCandidate(candidate);
          if (classifyXiaohongshuCommentRequestIdentity({
            url: request.url,
            body: request.body,
            payload,
          }, expectedNoteId) === 'matched') {
            extractCommentsFromObject(payload, comments, seen, limit);
          }
        });
      }
    } catch (error) {
      if (isAbortError(error) || (options.signal && options.signal.aborted)) {
        throw createAbortError();
      }
    }
  }
  throwIfAborted(options.signal);
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

function buildDouyinFallbackMarkdown(url, reason = '') {
  return [
    '抖音链接已保存。',
    '',
    `原始链接：${url || ''}`,
    '',
    reason ? `> 抖音视频转写失败：${reason}` : '',
    '> 插件没有把该作品误认成其他平台；可以稍后重试，或从手机相册/文件导入视频继续转写。',
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

async function readSessionFetchText(session, url, headers, timeoutMs = 12000) {
  if (!session || typeof session.fetch !== 'function' || !/^https?:\/\//i.test(String(url || ''))) return '';
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const requestTask = (async () => {
    const response = await session.fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      redirect: 'follow',
      ...(controller ? { signal: controller.signal } : {}),
    });
    return response && typeof response.text === 'function' ? await response.text() : '';
  })();
  const timeoutTask = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`Electron Session request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([requestTask, timeoutTask]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function downloadArrayBufferViaElectronSession(
  url,
  headers = {},
  options = {},
  session = getWechatSession(),
) {
  if (!session || typeof session.fetch !== 'function') {
    throw new Error('当前环境无法使用浏览器会话下载媒体');
  }
  throwIfAborted(options.signal);
  const timeoutMs = Math.max(100, Number(options.timeout) || 30000);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const abortSessionRequest = () => {
    if (controller) controller.abort();
  };
  if (options.signal && typeof options.signal.addEventListener === 'function') {
    options.signal.addEventListener('abort', abortSessionRequest, { once: true });
  }
  let timer = null;
  const requestTask = (async () => {
    const response = await session.fetch(url, {
      method: 'GET', headers, credentials: 'include', redirect: 'follow',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response || !response.ok) {
      throw new Error(`媒体下载失败：HTTP ${response ? response.status : 0}`);
    }
    return response.arrayBuffer();
  })();
  const timeoutTask = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abortSessionRequest();
      reject(new Error(`浏览器会话媒体下载超时（${timeoutMs}ms）`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([requestTask, timeoutTask]);
  } finally {
    if (timer) clearTimeout(timer);
    if (options.signal && typeof options.signal.removeEventListener === 'function') {
      options.signal.removeEventListener('abort', abortSessionRequest);
    }
    throwIfAborted(options.signal);
  }
}

function isMediaAuthorizationError(error) {
  return /媒体下载失败：HTTP\s*(?:401|403)\b|\bHTTP\s*(?:401|403)\b/i.test(
    String((error && error.message) || error || ''),
  );
}

function mergeDouyinDetailCandidates(current, incoming) {
  const previous = current && typeof current === 'object' ? current : null;
  const next = incoming && typeof incoming === 'object' ? incoming : null;
  if (!previous) return next;
  if (!next) return previous;

  const merged = { ...previous, ...next };
  const preferText = (left, right) => {
    const first = String(left || '').trim();
    const second = String(right || '').trim();
    return second.length >= first.length ? second : first;
  };
  merged.desc = preferText(previous.desc || previous.description, next.desc || next.description);
  merged.title = preferText(previous.title, next.title);
  merged.video = {
    ...((previous.video && typeof previous.video === 'object') ? previous.video : {}),
    ...((next.video && typeof next.video === 'object') ? next.video : {}),
  };
  merged.statistics = {
    ...((previous.statistics && typeof previous.statistics === 'object') ? previous.statistics : {}),
    ...((next.statistics && typeof next.statistics === 'object') ? next.statistics : {}),
  };
  for (const key of ['text_extra', 'cha_list']) {
    const previousList = Array.isArray(previous[key]) ? previous[key] : [];
    const nextList = Array.isArray(next[key]) ? next[key] : [];
    const seen = new Set();
    merged[key] = [...previousList, ...nextList].filter((item) => {
      const identity = String(
        item && (
          item.hashtag_name
          || item.hashtagName
          || item.cha_name
          || item.chaName
          || item.cid
          || item.id
        ) || '',
      ).trim().toLowerCase() || JSON.stringify(item);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }
  return merged;
}

async function fetchDouyinMediaResolutionWithSession({
  pageUrl,
  awemeId,
  session = getWechatSession(),
  requestTimeoutMs = 12000,
}) {
  const target = normalizeDouyinTargetUrl(pageUrl, pageUrl);
  const id = String(awemeId || target.awemeId || '').trim();
  if (!session || typeof session.fetch !== 'function' || !id || !target.url) {
    return { mediaUrls: [], detail: null };
  }

  try {
    await readSessionFetchText(session, target.url, getSocialRequestHeaders(target.url), requestTimeoutMs);
  } catch (error) {
    // Existing cookies may still make the pinned detail request usable.
  }

  let mediaUrls = [];
  let detail = null;
  for (const detailUrl of getDouyinAwemeDetailUrls(id)) {
    try {
      const text = await readSessionFetchText(session, detailUrl, getSocialRequestHeaders(detailUrl), requestTimeoutMs);
      const payload = JSON.parse(text || '{}');
      if (getDouyinDetailAwemeId(payload) !== id) continue;
      const urls = extractDouyinMediaUrlsFromDetailPayload(payload)
        .filter((url) => /^https?:\/\//i.test(url));
      const nextDetail = findDouyinDetailForAweme(payload, id)
        || payload.aweme_detail
        || payload.awemeDetail
        || (Array.isArray(payload.item_list) ? payload.item_list[0] : null);
      mediaUrls = sortMediaUrlsForTranscription([...mediaUrls, ...urls]);
      detail = mergeDouyinDetailCandidates(detail, nextDetail);
    } catch (error) {
      // Try the alternate pinned detail endpoint before browser rendering.
    }
  }
  return { mediaUrls, detail };
}

async function fetchDouyinMediaUrlsWithSession(options = {}) {
  const resolution = await fetchDouyinMediaResolutionWithSession(options);
  return resolution.mediaUrls;
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

async function probeXiaohongshuLoginStatus(targetUrl = '', options = {}) {
  throwIfAborted(options.signal);
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
  trackXiaohongshuBrowserWindow(win);
  installXiaohongshuNavigationGuards(win.webContents);
  const cleanupAbort = bindBrowserWindowToAbortSignal(win, options.signal);
  try {
    throwIfAborted(options.signal);
    const url = targetUrl || 'https://www.xiaohongshu.com/';
    const loaded = waitForWebContents(win.webContents, 15000);
    if (!beginBestEffortBrowserLoad(win, url)) return false;
    await loaded;
    throwIfAborted(options.signal);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    throwIfAborted(options.signal);
    const state = await runBrowserTaskWithTimeout(
      win.webContents.executeJavaScript(`
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
      `),
      XIAOHONGSHU_BROWSER_SCRIPT_TIMEOUT_MS,
      'xiaohongshu-login-probe',
    );
    if (state && state.hasLoginWall) return false;
    const hasCookie = await checkXiaohongshuLoginStatus();
    return Boolean(hasCookie && state && (state.hasAccountApiSignal || state.hasUserSignal));
  } catch (error) {
    if (isAbortError(error)) throw error;
    return false;
  } finally {
    cleanupAbort();
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
  if (isTrustedXiaohongshuCookieUrl(url)) {
    const cookieHeader = await getXiaohongshuCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
  }
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

function buildXiaohongshuLoginPageConfig(targetUrl = '') {
  const loginUrl = String(targetUrl || 'https://www.xiaohongshu.com/').trim();
  const userAgent = String(getSocialRequestHeaders(loginUrl)['User-Agent'] || '').trim();
  return { loginUrl, userAgent };
}

function isAbortedBrowserNavigationError(error) {
  const code = error && error.code;
  const errno = error && error.errno;
  if (Number(code) === -3 || Number(errno) === -3) return true;
  const message = String(error && (error.message || error) || '');
  return /ERR_ABORTED/i.test(`${String(code || '')} ${message}`);
}

async function loginXiaohongshuWeb(targetUrl) {
  if (activeXiaohongshuLoginPromise) {
    return await activeXiaohongshuLoginPromise;
  }
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('当前 Obsidian 环境不支持浏览器窗口');
  }

  const session = getXiaohongshuSession();
  if (!session) {
    throw new Error('无法创建小红书登录会话');
  }

  const { loginUrl, userAgent } = buildXiaohongshuLoginPageConfig(targetUrl);

  const loginPromise = new Promise((resolve, reject) => {
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
    trackXiaohongshuBrowserWindow(win);
    installXiaohongshuLoginWindowGuards(win.webContents);

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

    if (win.webContents && typeof win.webContents.setUserAgent === 'function' && userAgent) {
      win.webContents.setUserAgent(userAgent);
    }
    win.on('closed', async () => {
      finish();
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame === false || isAbortedBrowserNavigationError({ code: errorCode, message: errorDescription })) return;
      finish(new Error(`打开小红书登录页面失败（${errorCode}）：${errorDescription || '未知错误'}`));
    });
    win.loadURL(loginUrl, { userAgent }).catch((error) => {
      if (isAbortedBrowserNavigationError(error)) return;
      finish(new Error(`打开小红书登录页面失败：${error.message || error}`));
    });
  });
  activeXiaohongshuLoginPromise = loginPromise;
  try {
    return await loginPromise;
  } finally {
    if (activeXiaohongshuLoginPromise === loginPromise) {
      activeXiaohongshuLoginPromise = null;
    }
  }
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
  if (isXiaohongshuUrl(url)) {
    trackXiaohongshuBrowserWindow(win);
  }

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

async function renderSocialMediaUrlsWithElectron(url, options = {}) {
  throwIfAborted(options.signal);
  if (isXiaohongshuUrl(url) && options.__xiaohongshuSessionLockHeld !== true) {
    return await runWithXiaohongshuBrowserSessionLock(() => renderSocialMediaUrlsWithElectron(url, {
      ...options,
      __xiaohongshuSessionLockHeld: true,
    }), options.signal);
  }
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('Current Obsidian environment does not support hidden browser rendering');
  }

  const wechatSession = isXiaohongshuUrl(url) ? getXiaohongshuSession() : getWechatSession();
  if (isDouyinUrl(url)) {
    await installDouyinExternalProtocolHandlers(wechatSession);
  }
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
  if (isXiaohongshuUrl(url)) {
    trackXiaohongshuBrowserWindow(win);
  }
  const cleanupAbort = isXiaohongshuUrl(url)
    ? bindBrowserWindowToAbortSignal(win, options.signal)
    : () => {};

  const capturedRequests = [];
  const targetDouyinAwemeId = isDouyinUrl(url) ? extractDouyinAwemeId(url) : '';
  const blockXiaohongshuCommentRequests = isXiaohongshuUrl(url) && options.includeComments === false;
  const browserSession = (win.webContents && win.webContents.session) || wechatSession;
  const installedWebRequestHandlers = [];
  const debuggerApi = targetDouyinAwemeId && win.webContents && win.webContents.debugger;
  const debuggerResponseRequests = new Map();
  const debuggerBodyTasks = [];
  const debuggerMediaUrls = [];
  let debuggerAttached = false;
  let debuggerMessageHandler = null;
  const captureWebRequestDetails = (details) => {
    if (capturedRequests.length >= BROWSER_MEDIA_CAPTURE_MAX_REQUESTS) return;
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
    if (typeof callback === 'function') {
      callback(
        (isXiaohongshuUrl(url) && shouldBlockXiaohongshuBrowserNavigationRequest(details))
          || (blockXiaohongshuCommentRequests && isXiaohongshuCommentApiUrl(details && details.url))
          || shouldBlockExternalAppUrl(details && details.url)
          ? { cancel: true }
          : {},
      );
    }
  });
  installWebRequestHandler('onBeforeRedirect', captureWebRequestDetails);
  installWebRequestHandler('onCompleted', captureWebRequestDetails);
  if (isXiaohongshuUrl(url)) {
    installXiaohongshuNavigationGuards(win.webContents);
  } else {
    installExternalAppNavigationGuards(win.webContents);
  }

  if (debuggerApi && typeof debuggerApi.attach === 'function' && typeof debuggerApi.sendCommand === 'function') {
    try {
      if (!debuggerApi.isAttached || !debuggerApi.isAttached()) {
        debuggerApi.attach('1.3');
        debuggerAttached = true;
      }
      enableDebuggerNetworkCapture(debuggerApi);
      debuggerMessageHandler = (_event, method, params = {}) => {
        try {
          if (method === 'Network.responseReceived') {
            const response = params.response || {};
            const responseUrl = String(response.url || '').trim();
            const responseType = String(params.type || '').toLowerCase();
            const mimeType = String(response.mimeType || '').toLowerCase();
            const isJsonCandidate = responseType === 'xhr'
              || responseType === 'fetch'
              || mimeType.includes('json')
              || /\/aweme\/|\/feed(?:[/?]|$)|\/detail(?:[/?]|$)/i.test(responseUrl);
            if (
              params.requestId
              && isDouyinUrl(responseUrl)
              && isJsonCandidate
              && debuggerResponseRequests.size < 120
            ) {
              debuggerResponseRequests.set(params.requestId, responseUrl);
            }
          }
          if (method === 'Network.loadingFinished' && debuggerResponseRequests.has(params.requestId)) {
            const requestId = params.requestId;
            debuggerResponseRequests.delete(requestId);
            debuggerBodyTasks.push((async () => {
              try {
                const body = await debuggerApi.sendCommand('Network.getResponseBody', { requestId });
                const text = body && body.base64Encoded
                  ? Buffer.from(String(body.body || ''), 'base64').toString('utf8')
                  : String(body && body.body || '');
                extractDouyinMediaUrlsForAweme(text, targetDouyinAwemeId)
                  .forEach((mediaUrl) => pushUniqueMediaUrl(debuggerMediaUrls, mediaUrl));
              } catch (error) {}
            })());
          }
        } catch (error) {}
      };
      debuggerApi.on('message', debuggerMessageHandler);
    } catch (error) {
      debuggerMessageHandler = null;
    }
  }

  try {
    throwIfAborted(options.signal);
    const loaded = waitForWebContents(win.webContents, 18000);
    if (!beginBestEffortBrowserLoad(win, url)) {
      throw new Error('隐藏浏览器未能开始加载抖音页面');
    }
    await loaded;
    throwIfAborted(options.signal);
    const payload = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const urls = [];
        const seen = new Set();
        const maxUrls = ${BROWSER_MEDIA_CAPTURE_MAX_URLS};
        let resourceCursor = 0;
        const add = (value, resourceType = '') => {
          if (urls.length >= maxUrls) return;
          const url = String(value || '').trim();
          if (!url) return;
          if (seen.has(url)) return;
          seen.add(url);
          urls.push({ url, resourceType });
        };
        const collect = () => {
          document.querySelectorAll('video, audio, source').forEach((node) => {
            if (urls.length >= maxUrls) return;
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
            const entries = performance.getEntriesByType('resource');
            for (let index = resourceCursor; index < entries.length && urls.length < maxUrls; index += 1) {
              const entry = entries[index];
              add(entry.name, entry.initiatorType || '');
            }
            resourceCursor = entries.length;
          } catch (error) {}
        };
        for (let index = 0; index < 24; index += 1) {
          collect();
          if (urls.length >= maxUrls) break;
          await sleep(500);
        }
        collect();
        return urls;
      })()
    `);

    throwIfAborted(options.signal);
    await waitForBrowserTasksWithin(debuggerBodyTasks, 2500);
    throwIfAborted(options.signal);
    return normalizeBrowserCapturedMediaUrls([capturedRequests, payload, debuggerMediaUrls]);
  } finally {
    cleanupAbort();
    installedWebRequestHandlers.forEach((method) => {
      try {
        if (browserSession && browserSession.webRequest && typeof browserSession.webRequest[method] === 'function') {
          browserSession.webRequest[method]({ urls: ['<all_urls>'] }, null);
        }
      } catch (error) {}
    });
    try {
      if (debuggerApi && debuggerMessageHandler && typeof debuggerApi.removeListener === 'function') {
        debuggerApi.removeListener('message', debuggerMessageHandler);
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

async function renderXiaohongshuContentWithElectron(url, options = {}) {
  throwIfAborted(options.signal);
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error('Current Obsidian environment does not support hidden browser rendering');
  }

  const xiaohongshuSession = getXiaohongshuSession();
  const win = new BrowserWindow({
    width: 1280,
    height: 960,
    show: false,
    webPreferences: {
      session: xiaohongshuSession || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  trackXiaohongshuBrowserWindow(win);
  installXiaohongshuNavigationGuards(win.webContents);
  const cleanupAbort = bindBrowserWindowToAbortSignal(win, options.signal);
  const browserSession = (win.webContents && win.webContents.session) || xiaohongshuSession;
  let blocksCommentRequests = false;
  let observedIdentityUrl = resolveXiaohongshuIdentityUrl([
    options.expectedUrl,
    url,
  ]);
  const deadlineAt = Date.now() + XIAOHONGSHU_CONTENT_DEADLINE_MS;
  const cleanupIdentityObserver = installXiaohongshuIdentityObserver(
    win.webContents,
    (identityUrl) => {
      observedIdentityUrl = rememberXiaohongshuObservedIdentity(
        observedIdentityUrl,
        {
          resourceType: 'mainFrame',
          url: identityUrl,
        },
      );
    },
  );

  try {
    throwIfAborted(options.signal);
    if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeRequest === 'function') {
      browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        if (typeof callback === 'function') {
          callback(
            shouldBlockXiaohongshuBrowserNavigationRequest(details)
              || isXiaohongshuCommentApiUrl(details && details.url)
              ? { cancel: true }
              : {},
          );
        }
      });
      blocksCommentRequests = true;
    }

    const loaded = waitForWebContents(win.webContents, 18000);
    if (!beginBestEffortBrowserLoad(win, url)) {
      throw new Error('隐藏浏览器未能开始加载小红书页面');
    }
    await loaded;
    throwIfAborted(options.signal);
    let payload = null;
    for (let index = 0; index < 12; index += 1) {
      throwIfAborted(options.signal);
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw createBrowserTaskTimeoutError(
          'xiaohongshu-content-render',
          XIAOHONGSHU_CONTENT_DEADLINE_MS,
        );
      }
      const current = await runBrowserTaskWithTimeout(
        win.webContents.executeJavaScript(`
          (() => ({
            html: document.documentElement ? document.documentElement.outerHTML : '',
            url: String(location.href || ''),
          }))()
        `),
        Math.min(XIAOHONGSHU_BROWSER_SCRIPT_TIMEOUT_MS, remainingMs),
        'xiaohongshu-content-snapshot',
      );
      payload = selectXiaohongshuBrowserSnapshot(
        payload,
        current,
        observedIdentityUrl || options.expectedUrl || url,
      );
      if (payload.matched) break;
      const remainingAfterSnapshotMs = deadlineAt - Date.now();
      if (remainingAfterSnapshotMs <= 0) {
        throw createBrowserTaskTimeoutError(
          'xiaohongshu-content-render',
          XIAOHONGSHU_CONTENT_DEADLINE_MS,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, remainingAfterSnapshotMs)));
    }
    throwIfAborted(options.signal);
    return {
      html: String(payload && payload.html || ''),
      url: String(payload && payload.url || (win.webContents && win.webContents.getURL && win.webContents.getURL()) || url),
      identityUrl: String(payload && payload.identityUrl || ''),
      comments: [],
      commentDiagnosticDetails: {
        source: 'disabled',
        stopReason: 'comments_disabled',
        partial: false,
      },
    };
  } finally {
    cleanupAbort();
    try {
      if (blocksCommentRequests
        && browserSession
        && browserSession.webRequest
        && typeof browserSession.webRequest.onBeforeRequest === 'function') {
        browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, null);
      }
      cleanupIdentityObserver();
    } catch (error) {}
    if (win && typeof win.destroy === 'function') {
      win.destroy();
    }
  }
}

let xiaohongshuBrowserSessionQueue = Promise.resolve();

async function runWithXiaohongshuBrowserSessionLock(task, signal = null) {
  const previous = xiaohongshuBrowserSessionQueue;
  let release;
  const currentGate = new Promise((resolve) => {
    release = resolve;
  });
  // Keep the queue chained to the active owner even when this waiter is
  // cancelled. Otherwise an aborted waiter can either deadlock the queue or
  // let a later renderer run concurrently with the still-active window.
  xiaohongshuBrowserSessionQueue = Promise.resolve(previous).then(
    () => currentGate,
    () => currentGate,
  );
  try {
    await waitForPromiseWithAbort(previous, signal);
    throwIfAborted(signal);
    return await task();
  } finally {
    release();
  }
}

async function renderXiaohongshuPageWithElectron(url, options = {}) {
  return await runWithXiaohongshuBrowserSessionLock(async () => {
    throwIfAborted(options.signal);
    if (options.includeComments === false) {
      return await renderXiaohongshuContentWithElectron(url, options);
    }
    const expectedIdentityUrl = resolveXiaohongshuIdentityUrl([
      options.expectedUrl,
      url,
    ]);
    const expectedNoteId = getXiaohongshuTargetNoteId(expectedIdentityUrl);
    if (!expectedNoteId) {
      return {
        html: '',
        comments: [],
        identityUrl: '',
        commentDiagnosticDetails: {
          source: 'disabled',
          stopReason: 'target_identity_missing',
          partial: true,
        },
      };
    }
    const BrowserWindow = getElectronBrowserWindow();
    if (!BrowserWindow) {
      throw new Error('Current Obsidian environment does not support hidden browser rendering');
    }
    const deadlineAt = Date.now() + XIAOHONGSHU_COMMENT_TIMEOUT_MS;
    const getCommentBudget = (totalCount = 0) => getXiaohongshuCommentBudgetState({
    deadlineAt,
    totalCount,
    limit: XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
  });

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
  trackXiaohongshuBrowserWindow(win);
  installXiaohongshuNavigationGuards(win.webContents);
  const cleanupAbort = bindBrowserWindowToAbortSignal(win, options.signal);

  const commentApiRequests = [];
  const browserSession = (win.webContents && win.webContents.session) || wechatSession;
  const seenCommentApiRequests = new Set();
  const captureCommentApiRequest = (details) => {
    const requestUrl = String(details && details.url || '').trim();
    if (!isXiaohongshuCommentApiUrl(requestUrl)) return;
    const method = String(details && details.method || 'GET').toUpperCase();
    const body = getXiaohongshuCapturedRequestBody(details);
    if (classifyXiaohongshuCommentRequestIdentity({
      url: requestUrl,
      body,
    }, expectedNoteId) !== 'matched') return;
    const key = `${method}|${requestUrl}|${body}`;
    if (seenCommentApiRequests.has(key)) return;
    seenCommentApiRequests.add(key);
    commentApiRequests.push({
      url: requestUrl,
      method,
      body,
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
    if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeRequest === 'function') {
      browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        if (shouldBlockXiaohongshuBrowserNavigationRequest(details)) {
          if (typeof callback === 'function') callback({ cancel: true });
          return;
        }
        captureCommentApiRequest(details);
        if (typeof callback === 'function') callback({});
      });
    }
  } catch (error) {}

  const debuggerComments = [];
  const debuggerCommentPayloads = [];
  const debuggerSeen = new Set();
  const debuggerBodyTasks = [];
  const debuggerRequestUrls = new Map();
  let debuggerResponseSequence = 0;
  let debuggerAttached = false;
  const debuggerApi = win.webContents && win.webContents.debugger;
  const drainDebuggerBodyTasks = async () => {
    let settledCount = 0;
    let idlePasses = 0;
    for (let pass = 0; pass < 20 && idlePasses < 2; pass += 1) {
      throwIfAborted(options.signal);
      const budget = getCommentBudget(debuggerComments.length);
      if (budget.shouldStop) return budget.stopReason;
      const pending = debuggerBodyTasks.slice(settledCount);
      if (pending.length) {
        const remainingMs = budget.remainingMs;
        const waitStatus = await waitForPromiseWithAbort(
          waitForBrowserTasksWithin(pending, remainingMs),
          options.signal,
        );
        throwIfAborted(options.signal);
        if (waitStatus === 'timeout') return 'time_budget_exceeded';
        settledCount += pending.length;
        idlePasses = 0;
      } else {
        idlePasses += 1;
      }
      if (idlePasses < 2) {
        const remainingMs = getCommentBudget(debuggerComments.length).remainingMs;
        if (remainingMs <= 0) return 'time_budget_exceeded';
        await waitForPromiseWithAbort(
          new Promise((resolve) => setTimeout(resolve, Math.min(120, remainingMs))),
          options.signal,
        );
      }
    }
    return '';
  };
  const parseCommentApiText = (requestDetails, text, sequence = 0) => {
    if (!text || text.length > XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS) return;
    const requestUrl = String(requestDetails && requestDetails.url || '').trim();
    const requestBody = String(requestDetails && requestDetails.body || '');
    const payloads = [];
    try {
      const payload = JSON.parse(text);
      if (payload && typeof payload === 'object') payloads.push(payload);
    } catch (error) {}
    if (!payloads.length) {
      collectJsonObjectCandidates(text).forEach((candidate) => {
        const payload = parseLooseJsonCandidate(candidate);
        if (payload && typeof payload === 'object') payloads.push(payload);
      });
    }
    payloads.forEach((payload) => {
      if (classifyXiaohongshuCommentRequestIdentity({
        url: requestUrl,
        body: requestBody,
        payload,
      }, expectedNoteId) !== 'matched') return;
      debuggerCommentPayloads.push({
        url: requestUrl,
        body: requestBody,
        payload,
        sequence,
      });
      extractCommentsFromObject(payload, debuggerComments, debuggerSeen, XIAOHONGSHU_ROOT_COMMENT_LIMIT);
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
          if (method === 'Network.requestWillBeSent') {
            const requestUrl = String(params.request && params.request.url || '').trim();
            const requestBody = String(params.request && params.request.postData || '');
            if (params.requestId
              && isXiaohongshuCommentApiUrl(requestUrl)
              && classifyXiaohongshuCommentRequestIdentity({
                url: requestUrl,
                body: requestBody,
              }, expectedNoteId) === 'matched') {
              debuggerRequestUrls.set(params.requestId, {
                url: requestUrl,
                body: requestBody,
                sequence: 0,
              });
            }
          }
          if (method === 'Network.responseReceived') {
            const responseUrl = String(params.response && params.response.url || '').trim();
            const capturedRequest = debuggerRequestUrls.get(params.requestId) || {
              url: responseUrl,
              body: '',
            };
            if (params.requestId
              && isXiaohongshuCommentApiUrl(responseUrl)
              && classifyXiaohongshuCommentRequestIdentity(capturedRequest, expectedNoteId) === 'matched') {
              debuggerResponseSequence += 1;
              debuggerRequestUrls.set(params.requestId, {
                ...capturedRequest,
                sequence: debuggerResponseSequence,
              });
            } else if (params.requestId) {
              debuggerRequestUrls.delete(params.requestId);
            }
          }
          if (method === 'Network.loadingFinished' && debuggerRequestUrls.has(params.requestId)) {
            const requestId = params.requestId;
            const responseDetails = debuggerRequestUrls.get(requestId) || {};
            debuggerRequestUrls.delete(requestId);
            debuggerBodyTasks.push((async () => {
              try {
                const body = await debuggerApi.sendCommand('Network.getResponseBody', { requestId });
                const text = getXiaohongshuCapturedResponseText(body);
                parseCommentApiText(responseDetails, text, responseDetails.sequence);
              } catch (error) {}
            })());
          }
        } catch (error) {}
      });
    }
  } catch (error) {}

  try {
    const loadBudget = getCommentBudget(0);
    const loaded = waitForWebContents(win.webContents, Math.min(20000, loadBudget.remainingMs));
    beginBestEffortBrowserLoad(win, url);
    await waitForPromiseWithAbort(loaded, options.signal);
    throwIfAborted(options.signal);
    let identitySnapshot = null;
    for (let index = 0; index < 12; index += 1) {
      throwIfAborted(options.signal);
      const identityBudget = getCommentBudget(0);
      if (identityBudget.shouldStop) break;
      const current = await runBrowserTaskWithTimeout(
        win.webContents.executeJavaScript(`
          (() => ({
            html: document.documentElement ? document.documentElement.outerHTML : '',
            url: String(location.href || ''),
          }))()
        `),
        Math.min(XIAOHONGSHU_BROWSER_SCRIPT_TIMEOUT_MS, identityBudget.remainingMs),
        'xiaohongshu-comment-identity-snapshot',
      );
      identitySnapshot = selectXiaohongshuBrowserSnapshot(
        identitySnapshot,
        current,
        expectedIdentityUrl,
      );
      throwIfAborted(options.signal);
      if (identitySnapshot.matched) break;
      await waitForPromiseWithAbort(
        new Promise((resolve) => setTimeout(resolve, Math.min(500, identityBudget.remainingMs))),
        options.signal,
      );
    }
    if (!identitySnapshot || !identitySnapshot.matched) {
      return {
        html: String(identitySnapshot && identitySnapshot.html || ''),
        comments: [],
        identityUrl: expectedIdentityUrl,
        commentDiagnosticDetails: {
          source: 'disabled',
          stopReason: 'target_identity_mismatch',
          partial: true,
        },
      };
    }
    let pageApiPayload = {
      rootPayloads: [],
      replyPayloadGroups: [],
      diagnostic: { source: 'page-api', stopReason: 'page_script_skipped' },
    };
    const pageApiBudget = getCommentBudget(debuggerComments.length);
    if (!pageApiBudget.shouldStop) {
      const pageApiTask = Promise.resolve(win.webContents.executeJavaScript(getXiaohongshuCommentPaginationScript(expectedIdentityUrl, {
        deadlineAt,
        totalLimit: XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
      }))).then((value) => {
        pageApiPayload = value;
      }).catch((error) => {
        if (isAbortError(error) || (options.signal && options.signal.aborted)) {
          throw createAbortError();
        }
        pageApiPayload = {
          rootPayloads: [],
          replyPayloadGroups: [],
          diagnostic: { source: 'page-api', stopReason: 'page_script_failed' },
        };
      });
      const pageApiWaitStatus = await waitForPromiseWithAbort(
        waitForBrowserTasksWithin([pageApiTask], pageApiBudget.remainingMs),
        options.signal,
      );
      throwIfAborted(options.signal);
      if (pageApiWaitStatus === 'timeout') {
        pageApiPayload = {
          rootPayloads: [],
          replyPayloadGroups: [],
          diagnostic: { source: 'page-api', stopReason: 'time_budget_exceeded' },
        };
      }
    }
    if (String(pageApiPayload && pageApiPayload.identityNoteId || '').trim().toLowerCase()
      !== String(expectedNoteId).trim().toLowerCase()) {
      pageApiPayload = {
        rootPayloads: [],
        replyPayloadGroups: [],
        identityNoteId: '',
        diagnostic: { source: 'page-api', stopReason: 'target_identity_mismatch' },
      };
    } else {
      const rootRequestUrl = `https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${encodeURIComponent(expectedNoteId)}`;
      const replyRequestUrl = `https://www.xiaohongshu.com/api/sns/web/v2/comment/sub/page?note_id=${encodeURIComponent(expectedNoteId)}`;
      pageApiPayload.rootPayloads = (Array.isArray(pageApiPayload.rootPayloads)
        ? pageApiPayload.rootPayloads
        : []).filter((payload) => classifyXiaohongshuCommentRequestIdentity({
        url: rootRequestUrl,
        payload,
      }, expectedNoteId) === 'matched');
      pageApiPayload.replyPayloadGroups = (Array.isArray(pageApiPayload.replyPayloadGroups)
        ? pageApiPayload.replyPayloadGroups
        : []).map((group) => ({
        ...group,
        payloads: (Array.isArray(group && group.payloads) ? group.payloads : [])
          .filter((payload) => classifyXiaohongshuCommentRequestIdentity({
            url: replyRequestUrl,
            payload,
          }, expectedNoteId) === 'matched'),
      })).filter((group) => group.payloads.length > 0);
    }
    const capturedPageDiagnostic = pageApiPayload && pageApiPayload.diagnostic && typeof pageApiPayload.diagnostic === 'object'
      ? pageApiPayload.diagnostic
      : {};
    let renderedPayload = {
      html: '',
      comments: [],
      collectionStopReason: capturedPageDiagnostic.stopReason === 'time_budget_exceeded'
        ? 'time_budget_exceeded'
        : 'page_render_skipped',
    };
    const renderedBudget = getCommentBudget(
      Number(capturedPageDiagnostic.rootCount || 0) + Number(capturedPageDiagnostic.replyCount || 0),
    );
    if (!renderedBudget.shouldStop) {
      const renderedTask = Promise.resolve(win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const XIAOHONGSHU_ROOT_COMMENT_LIMIT = ${XIAOHONGSHU_ROOT_COMMENT_LIMIT};
        const XIAOHONGSHU_TOTAL_COMMENT_LIMIT = ${XIAOHONGSHU_TOTAL_COMMENT_LIMIT};
        const deadlineAt = ${deadlineAt};
        const getCollectionStopReason = () => {
          if (comments.length >= XIAOHONGSHU_TOTAL_COMMENT_LIMIT) return 'total_limit_reached';
          if (Date.now() >= deadlineAt) return 'time_budget_exceeded';
          return '';
        };
        const didRootCollectionProgress = (${didXiaohongshuRootCollectionProgress.toString()});
        const clean = (text) => String(text || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
        const comments = [];
        const seen = new Set();
        const push = (author, content, time, likes, structure = {}) => {
          if (comments.length >= XIAOHONGSHU_TOTAL_COMMENT_LIMIT) return;
          const body = clean(content);
          if (!body || body.length < 2) return;
          if (/^(?:回复|评论|点赞|赞|展开|更多|查看|分享|收藏|[0-9]+)$/.test(body)) return;
          if (/^共\\s*\\d+\\s*条评论/.test(body)) return;
          const name = clean(author);
          const key = name + '|' + body;
          if (seen.has(key)) return;
          seen.add(key);
          comments.push({
            author: name,
            content: body,
            time: clean(time),
            likes: clean(likes),
            id: clean(structure.id),
            domRole: structure.domRole || 'unknown',
            parentAuthor: clean(structure.parentAuthor),
            parentCommentId: clean(structure.parentCommentId),
          });
        };
        const clickUsefulButtons = () => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], .show-more, .more, .expand, [class*="more"], [class*="expand"], [class*="reply"], [class*="Reply"], [class*="sub-comment"], [class*="subComment"], [data-testid*="reply"], [data-testid*="comment"]'));
          buttons.forEach((node) => {
            const text = String(node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim();
            const inCommentArea = Boolean(node.closest('[class*="comment"], [class*="Comment"], [id*="comment"], [id*="Comment"], [class*="reply"], [class*="Reply"]'));
            const isExpansion = /(?:展开|查看|更多).{0,16}(?:回复|评论)|(?:回复|评论).{0,16}(?:展开|查看|更多)|^(?:展开|更多|查看全部)$/i.test(text);
            if (inCommentArea && isExpansion) {
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
            const pickFrom = (root, selectorsToTry) => {
              for (const selector of selectorsToTry) {
                const candidates = Array.from(root && root.querySelectorAll ? root.querySelectorAll(selector) : []);
                for (const child of candidates) {
                  const value = clean(child.innerText || child.textContent || '');
                  if (value) return value;
                }
              }
              return '';
            };
            const pick = (selectorsToTry) => pickFrom(node, selectorsToTry);
            const author = pick(['[class*="name"]', '[class*="nick"]', '[class*="author"]', '[class*="user"]']);
            const time = pick(['[class*="time"]', '[class*="date"]']);
            const likes = pick(['[class*="like"]', '[class*="praise"]']);
            let content = pick(['[class*="content"]', '[class*="text"]', '[class*="desc"]']);
            if (!content) {
              const text = clean(node.innerText || node.textContent || '');
              const parts = text.split(/\\s+/).filter(Boolean);
              content = parts.find((part) => part.length >= 2 && !/^(?:回复|评论|点赞|赞|展开|更多|查看|分享|收藏|[0-9]+)$/.test(part)) || text;
            }
            const marker = clean(String(node.className || '') + ' ' + String(node.id || ''));
            const replyAncestor = node.closest
              ? node.closest('[class*="reply"], [class*="Reply"], [class*="sub-comment"], [class*="subComment"]')
              : null;
            const isReplyNode = /reply|sub[-_]?comment/i.test(marker)
              || Boolean(replyAncestor && replyAncestor !== node.closest('.comments-container, [class*="comment-list"], [class*="CommentList"]'));
            const rootSelector = '.comment-item, [class*="comment-item"], [class*="CommentItem"], [class*="comment"][class*="item"]';
            let parentRoot = null;
            if (isReplyNode && node.parentElement && node.parentElement.closest) {
              parentRoot = node.parentElement.closest(rootSelector);
            }
            const parentAuthor = parentRoot
              ? pickFrom(parentRoot, ['[class*="name"]', '[class*="nick"]', '[class*="author"]', '[class*="user"]'])
              : '';
            const parentCommentId = parentRoot
              ? clean(parentRoot.getAttribute('data-comment-id') || parentRoot.getAttribute('data-id') || parentRoot.id || '')
              : '';
            const commentId = clean(node.getAttribute('data-comment-id') || node.getAttribute('data-id') || node.id || '');
            push(author, content, time, likes, {
              id: commentId,
              domRole: isReplyNode ? 'reply' : 'root',
              parentAuthor,
              parentCommentId,
            });
          });
        };
        const findCommentScrollContainer = () => {
          const candidates = new Set();
          const addWithAncestors = (node) => {
            let current = node;
            for (let depth = 0; current && depth < 8; depth += 1) {
              candidates.add(current);
              current = current.parentElement;
            }
          };
          Array.from(document.querySelectorAll([
            '.comments-container',
            '[class*="comments-container"]',
            '[class*="comment-list"]',
            '[class*="CommentList"]',
            '[class*="comment"][class*="list"]',
            '[class*="note-scroller"]',
          ].join(','))).forEach(addWithAncestors);
          const firstComment = document.querySelector('.comment-item, [class*="comment-item"], [class*="CommentItem"]');
          if (firstComment) addWithAncestors(firstComment);
          if (document.scrollingElement) candidates.add(document.scrollingElement);
          if (document.documentElement) candidates.add(document.documentElement);
          if (document.body) candidates.add(document.body);
          const scored = Array.from(candidates)
            .map((node) => {
              if (!node || !Number.isFinite(Number(node.scrollHeight)) || !Number.isFinite(Number(node.clientHeight))) return null;
              const available = Math.max(0, Number(node.scrollHeight) - Number(node.clientHeight));
              if (available < 80) return null;
              let overflowY = '';
              try { overflowY = String(getComputedStyle(node).overflowY || ''); } catch (error) {}
              const marker = String(node.className || '') + ' ' + String(node.id || '');
              let nestedReplyAncestor = null;
              try {
                nestedReplyAncestor = node.closest('[class*="reply"], [class*="Reply"], [class*="sub-comment"], [class*="subComment"]');
              } catch (error) {}
              const nestedReplyPenalty = /reply|sub[-_]?comment/i.test(marker) || nestedReplyAncestor ? -2000000 : 0;
              const mainCommentListBonus = !nestedReplyPenalty && /comments?[-_\s]?(?:container|list)|commentlist/i.test(marker)
                ? 1200000
                : 0;
              let rootCommentCount = 0;
              try {
                rootCommentCount = Array.from(node.querySelectorAll('.comment-item, [class*="comment-item"], [class*="CommentItem"], [class*="comment"][class*="item"]'))
                  .filter((item) => !item.closest('[class*="reply"], [class*="Reply"], [class*="sub-comment"], [class*="subComment"]'))
                  .length;
              } catch (error) {}
              const rootCoverageBonus = Math.min(rootCommentCount, 50) * 10000;
              const overflowBonus = /auto|scroll/i.test(overflowY) ? 500000 : 0;
              const documentPenalty = node === document.scrollingElement || node === document.body || node === document.documentElement ? -250000 : 0;
              return { node, score: mainCommentListBonus + rootCoverageBonus + overflowBonus + available + nestedReplyPenalty + documentPenalty };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);
          return scored.length ? scored[0].node : null;
        };
        const advanceCommentScroll = () => {
          const container = findCommentScrollContainer();
          if (container && container !== document.scrollingElement && container !== document.body && container !== document.documentElement) {
            const before = Number(container.scrollTop) || 0;
            const maxTop = Math.max(0, Number(container.scrollHeight) - Number(container.clientHeight));
            const step = Math.max(600, Math.floor(Number(container.clientHeight || window.innerHeight) * 0.85));
            container.scrollTop = Math.min(maxTop, before + step);
            try { container.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (error) {}
            try { container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: step })); } catch (error) {}
            return {
              moved: Number(container.scrollTop) > before + 1,
              top: Number(container.scrollTop) || 0,
              height: Number(container.scrollHeight) || 0,
              mode: 'comment_container',
            };
          }
          const before = Number(window.scrollY) || 0;
          const step = Math.max(600, Math.floor(window.innerHeight * 0.8));
          window.scrollBy(0, step);
          return {
            moved: Number(window.scrollY) > before + 1,
            top: Number(window.scrollY) || 0,
            height: Math.max(document.documentElement && document.documentElement.scrollHeight || 0, document.body && document.body.scrollHeight || 0),
            mode: 'window_fallback',
          };
        };
        let idleRounds = 0;
        let completedRounds = 0;
        let lastRootSnapshot = {
          rootCommentCount: -1,
          rootRequestCount: -1,
          replyCommentCount: -1,
          replyRequestCount: -1,
          scrollTop: -1,
          scrollHeight: -1,
        };
        let rootRequestCount = 0;
        let replyRequestCount = 0;
        let scrollMode = 'unknown';
        let collectionStopReason = 'max_rounds';
        const maxRounds = 90;
        for (let index = 0; index < maxRounds; index += 1) {
          const beforeRoundStopReason = getCollectionStopReason();
          if (beforeRoundStopReason) {
            collectionStopReason = beforeRoundStopReason;
            break;
          }
          clickUsefulButtons();
          collectDomComments();
          const movement = advanceCommentScroll();
          scrollMode = movement.mode;
          await sleep(Math.max(0, Math.min(450, deadlineAt - Date.now())));
          clickUsefulButtons();
          collectDomComments();
          let resourceUrls = [];
          try {
            resourceUrls = performance.getEntriesByType('resource')
              .map((entry) => String(entry && entry.name || ''))
              .filter((entryUrl) => /xiaohongshu\\.com\\/api\\/sns\\/web\\/v\\d+\\/comment/i.test(entryUrl));
          } catch (error) {}
          rootRequestCount = resourceUrls.filter((entryUrl) => !/\\/comment\\/sub\\/page(?:[/?]|$)/i.test(entryUrl)).length;
          replyRequestCount = resourceUrls.filter((entryUrl) => /\\/comment\\/sub\\/page(?:[/?]|$)/i.test(entryUrl)).length;
          const rootCommentCount = comments.filter((comment) => comment && comment.domRole === 'root').length;
          const replyCommentCount = comments.filter((comment) => comment && comment.domRole === 'reply').length;
          const currentRootSnapshot = {
            rootCommentCount,
            rootRequestCount,
            replyCommentCount,
            replyRequestCount,
            scrollTop: movement.top,
            scrollHeight: movement.height,
          };
          const progressed = didRootCollectionProgress(lastRootSnapshot, currentRootSnapshot);
          idleRounds = progressed ? 0 : idleRounds + 1;
          lastRootSnapshot = currentRootSnapshot;
          completedRounds = index + 1;
          const afterRoundStopReason = getCollectionStopReason();
          if (afterRoundStopReason) {
            collectionStopReason = afterRoundStopReason;
            break;
          }
          if (idleRounds >= 10 && index >= 9) {
            collectionStopReason = 'root_idle';
            break;
          }
        }
        let replySettlingRounds = 0;
        let replyIdleRounds = 0;
        let lastReplySnapshot = {
          replyCommentCount: comments.filter((comment) => comment && comment.domRole === 'reply').length,
          replyRequestCount,
        };
        for (let index = 0; index < 6 && replyIdleRounds < 2; index += 1) {
          const beforeReplyStopReason = getCollectionStopReason();
          if (beforeReplyStopReason) {
            collectionStopReason = beforeReplyStopReason;
            break;
          }
          clickUsefulButtons();
          collectDomComments();
          await sleep(Math.max(0, Math.min(450, deadlineAt - Date.now())));
          collectDomComments();
          let nextReplyRequestCount = replyRequestCount;
          try {
            nextReplyRequestCount = performance.getEntriesByType('resource')
              .map((entry) => String(entry && entry.name || ''))
              .filter((entryUrl) => /\\/comment\\/sub\\/page(?:[/?]|$)/i.test(entryUrl))
              .length;
          } catch (error) {}
          const nextReplyCommentCount = comments.filter((comment) => comment && comment.domRole === 'reply').length;
          const replyProgressed = nextReplyCommentCount > lastReplySnapshot.replyCommentCount
            || nextReplyRequestCount > lastReplySnapshot.replyRequestCount;
          replyIdleRounds = replyProgressed ? 0 : replyIdleRounds + 1;
          replyRequestCount = nextReplyRequestCount;
          lastReplySnapshot = {
            replyCommentCount: nextReplyCommentCount,
            replyRequestCount: nextReplyRequestCount,
          };
          replySettlingRounds = index + 1;
        }
        const finalCollectionStopReason = getCollectionStopReason();
        if (finalCollectionStopReason) collectionStopReason = finalCollectionStopReason;
        return {
          html: document.documentElement ? document.documentElement.outerHTML : '',
          url: String(location.href || ''),
          comments,
          scrollMode,
          completedRounds,
          idleRounds,
          rootCommentCount: lastRootSnapshot.rootCommentCount,
          replyCommentCount: lastReplySnapshot.replyCommentCount,
          rootRequestCount,
          replyRequestCount,
          replySettlingRounds,
          collectionStopReason,
        };
      })()
    `)).then((value) => {
        renderedPayload = value;
      }).catch((error) => {
        if (isAbortError(error) || (options.signal && options.signal.aborted)) {
          throw createAbortError();
        }
        renderedPayload = {
          html: '',
          comments: [],
          collectionStopReason: getCommentBudget(0).shouldStop ? 'time_budget_exceeded' : 'page_render_failed',
        };
      });
      const renderedWaitStatus = await waitForPromiseWithAbort(
        waitForBrowserTasksWithin([renderedTask], renderedBudget.remainingMs),
        options.signal,
      );
      throwIfAborted(options.signal);
      if (renderedWaitStatus === 'timeout') {
        renderedPayload = {
          html: '',
          comments: [],
          collectionStopReason: 'time_budget_exceeded',
        };
      }
    } else {
      renderedPayload.collectionStopReason = renderedBudget.stopReason;
    }
    throwIfAborted(options.signal);
    const debuggerDrainStopReason = await drainDebuggerBodyTasks();
    throwIfAborted(options.signal);
    const renderedHtml = renderedPayload && typeof renderedPayload === 'object'
      ? String(renderedPayload.html || '')
      : String(renderedPayload || '');
    const renderedUrl = String(renderedPayload && renderedPayload.url || '');
    const renderedUrlNoteId = getXiaohongshuTargetNoteId(renderedUrl);
    const renderedPageMatchesTarget = extractXiaohongshuPrimaryNotePayload(
      renderedHtml,
      expectedIdentityUrl,
    ).matched === true
      && (!renderedUrlNoteId
        || renderedUrlNoteId.toLowerCase() === String(expectedNoteId).toLowerCase());
    const inlineDomComments = renderedPageMatchesTarget
      && renderedPayload
      && typeof renderedPayload === 'object'
      && Array.isArray(renderedPayload.comments)
      ? renderedPayload.comments
      : [];
    const pagedRootResult = collectXiaohongshuCommentPages(pageApiPayload && pageApiPayload.rootPayloads, XIAOHONGSHU_ROOT_COMMENT_LIMIT);
    let pagedComments = pagedRootResult.comments;
    (Array.isArray(pageApiPayload && pageApiPayload.replyPayloadGroups) ? pageApiPayload.replyPayloadGroups : []).forEach((group) => {
      pagedComments = mergeXiaohongshuReplyPages(pagedComments, group && group.rootCommentId, group && group.payloads);
    });
    let apiComments = [];
    const signedReplayBudget = getCommentBudget(
      debuggerComments.length + getSocialCommentTreeStats(pagedComments).rootCount + getSocialCommentTreeStats(pagedComments).replyCount,
    );
    if (!signedReplayBudget.shouldStop) {
      apiComments = await fetchXiaohongshuCommentsFromCapturedRequests(
        commentApiRequests,
        XIAOHONGSHU_ROOT_COMMENT_LIMIT,
        {
          deadlineAt,
          totalLimit: XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
          expectedNoteId,
          signal: options.signal,
        },
      );
      throwIfAborted(options.signal);
    }
    const browserNetworkResult = mergeXiaohongshuCapturedCommentPayloads(
      debuggerCommentPayloads,
      XIAOHONGSHU_ROOT_COMMENT_LIMIT,
      { expectedNoteId },
    );
    const domComments = renderedPageMatchesTarget
      ? extractSocialCommentsFromHtml(renderedHtml, XIAOHONGSHU_ROOT_COMMENT_LIMIT)
      : [];
    const candidateNetworkComments = mergeXiaohongshuNetworkComments([
      browserNetworkResult.comments,
      pagedComments,
      debuggerComments,
      apiComments,
    ], XIAOHONGSHU_ROOT_COMMENT_LIMIT);
    const networkComments = preserveXiaohongshuPrimaryCommentTree(
      browserNetworkResult.comments,
      candidateNetworkComments,
      XIAOHONGSHU_ROOT_COMMENT_LIMIT,
    );
    const mergedCommentSources = mergeXiaohongshuCommentSources({
      networkComments,
      deferredReplyGroups: browserNetworkResult.deferredReplyGroups,
      fallbackGroups: [
      inlineDomComments,
      domComments,
      ],
      limit: XIAOHONGSHU_ROOT_COMMENT_LIMIT,
    });
    const comments = limitSocialCommentTreeTotal(
      mergedCommentSources.comments,
      XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    );
    const finalCommentStats = getSocialCommentTreeStats(comments);
    const capturedDiagnostic = pageApiPayload && pageApiPayload.diagnostic && typeof pageApiPayload.diagnostic === 'object'
      ? pageApiPayload.diagnostic
      : {};
    const hasBrowserNetworkPayload = browserNetworkResult.rootPayloadCount > 0 || browserNetworkResult.replyPayloadCount > 0;
    const browserStopReason = browserNetworkResult.stopReason === 'source_exhausted'
      && renderedPayload && renderedPayload.collectionStopReason
      ? `network_${renderedPayload.collectionStopReason}`
      : browserNetworkResult.stopReason;
    const finalBudget = getCommentBudget(finalCommentStats.rootCount + finalCommentStats.replyCount);
    const explicitBudgetStopReason = [
      capturedDiagnostic.stopReason,
      renderedPayload && renderedPayload.collectionStopReason,
      debuggerDrainStopReason,
      signedReplayBudget.stopReason,
      finalBudget.stopReason,
    ].find((reason) => reason === 'time_budget_exceeded' || reason === 'total_limit_reached') || '';
    const commentDiagnosticDetails = {
      source: hasBrowserNetworkPayload ? browserNetworkResult.source : (capturedDiagnostic.source || 'page-api'),
      rootCount: hasBrowserNetworkPayload ? browserNetworkResult.rootCount : (capturedDiagnostic.rootCount || comments.length),
      replyCount: hasBrowserNetworkPayload ? browserNetworkResult.replyCount : (capturedDiagnostic.replyCount || 0),
      pageCount: hasBrowserNetworkPayload ? browserNetworkResult.pageCount : (capturedDiagnostic.pageCount || pagedRootResult.pageCount),
      rootPageCount: hasBrowserNetworkPayload ? browserNetworkResult.rootPageCount : pagedRootResult.pageCount,
      replyPageCount: hasBrowserNetworkPayload ? browserNetworkResult.replyPageCount : Math.max(0, Number(capturedDiagnostic.pageCount || 0) - pagedRootResult.pageCount),
      rootRequestCount: Number(renderedPayload && renderedPayload.rootRequestCount || 0),
      replyRequestCount: Number(renderedPayload && renderedPayload.replyRequestCount || 0),
      mergedRootCount: finalCommentStats.rootCount,
      mergedReplyCount: finalCommentStats.replyCount,
      restoredRootCount: mergedCommentSources.restoredRootCount,
      restoredReplyCount: mergedCommentSources.restoredReplyCount,
      finalRootCount: finalCommentStats.rootCount,
      finalReplyCount: finalCommentStats.replyCount,
      lostRootCount: Math.max(0, browserNetworkResult.rootCount - finalCommentStats.rootCount),
      lostReplyCount: Math.max(0, browserNetworkResult.replyCount - finalCommentStats.replyCount),
      fallbackAddedCount: mergedCommentSources.fallbackAddedCount,
      dedupedFallbackCount: mergedCommentSources.dedupedFallbackCount,
      droppedFallbackCount: mergedCommentSources.droppedFallbackCount,
      unmatchedReplyCount: mergedCommentSources.unmatchedDeferredReplyCount + mergedCommentSources.unmatchedFallbackReplyCount,
      invalidPayloadCount: browserNetworkResult.invalidPayloadCount,
      scrollMode: renderedPayload && renderedPayload.scrollMode,
      pageApiStopReason: hasBrowserNetworkPayload ? 'network_primary' : capturedDiagnostic.stopReason,
      stopReason: explicitBudgetStopReason
        || (hasBrowserNetworkPayload ? browserStopReason : (capturedDiagnostic.stopReason || pagedRootResult.stopReason)),
    };
    commentDiagnosticDetails.partial = isPartialXiaohongshuCommentResult(commentDiagnosticDetails);
    const commentDiagnostic = buildXiaohongshuCommentDiagnostic(commentDiagnosticDetails);
    throwIfAborted(options.signal);
    return {
      html: renderedHtml,
      identityUrl: expectedIdentityUrl,
      comments,
      commentDiagnostic,
      commentDiagnosticDetails,
      commentApiRequestCount: commentApiRequests.length,
      debuggerCommentCount: debuggerComments.length,
      debuggerCommentPayloadCount: debuggerCommentPayloads.length,
    };
  } finally {
    cleanupAbort();
    try {
      if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeSendHeaders === 'function') {
        browserSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.xiaohongshu.com/*'] }, null);
      }
      if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeRequest === 'function') {
        browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, null);
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
  }, options.signal);
}

async function renderXiaohongshuCommentsWithElectron(url) {
  const page = await renderXiaohongshuPageWithElectron(url, { includeComments: true });
  return page && Array.isArray(page.comments) ? page.comments : [];
}

async function renderSocialMediaUrlWithElectron(url, options = {}) {
  const urls = await renderSocialMediaUrlsWithElectron(url, options);
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

function getRecordUrl(record, metadata = record && record.metadata || {}) {
  return cleanDisplayUrl(metadata.url || metadata.originalUrl || record.content || '');
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

const aiMetadataHelpers = createAiMetadataHelpers({
  tryParseJson,
  cleanMarkdownForStorage,
  stripMarkdownCodeBlocks,
});
const {
  normalizeGeneratedKeywords,
  parseGeneratedMetadataResponse,
  normalizeGeneratedMetadataResult,
  extractAiMetadataInputText,
} = aiMetadataHelpers;

const recordBodyMarkdownHelpers = createRecordBodyMarkdownHelpers({
  cleanDisplayUrl,
  cleanMarkdownForStorage,
  extractKeywordsFromText,
  formatCreatedTime,
  getWebpageSourcePrefix,
  isFeishuUrl,
  isWechatChannelsUrl,
  isXiaohongshuUrl,
  normalizeExtractedUrl,
  sanitizeXiaohongshuMarkdownImages,
  stripMarkdownCodeBlocks,
});
const {
  buildAudioTranscriptMarkdown,
  buildFileMarkdownBody,
  buildSourceMediaAttachmentMarkdown,
  buildTranscriptOnlyMetadata,
  buildTranscriptPropertyMetadata,
  buildWebpageMarkdownBody,
} = recordBodyMarkdownHelpers;

const noteOutputPlanHelpers = createNoteOutputPlanHelpers({
  buildAiMetadataErrorComment,
  buildFileMarkdownBody,
  buildRecordIdMarker,
  buildWebpageMarkdownBody,
  cleanDisplayUrl,
  defaultNotePropertyFields: DEFAULT_NOTE_PROPERTY_FIELDS,
  getRecordAuthor,
  getRecordDescription,
  getRecordId,
  getRecordKeywords,
  getRecordSourceLabel,
  getRecordUrl,
  getWebpageSourcePrefix,
  isFeishuUrl,
  isSuccessfulTranscriptionRecord,
  normalizeNotePropertyFields,
  normalizeVaultPath,
});
const {
  buildRecordFrontmatter,
  buildMarkdownForRecord,
  buildNoteOutputPlan,
} = noteOutputPlanHelpers;

function getRecordConversionWarning(record) {
  if (!record) return '';
  const metadata = record.metadata || {};
  const aiMetadataWarning = metadata.aiMetadataError
    ? buildAiMetadataConversionWarning(metadata.aiMetadataError)
    : '';
  const imageLocalizationFailedCount = Number(metadata.imageLocalizationFailedCount) || 0;
  const imageTempUrlMissingCount = Number(metadata.imageTempUrlMissingCount) || 0;
  const imageFailureCount = Math.max(imageLocalizationFailedCount, imageTempUrlMissingCount);
  if (imageFailureCount > 0) {
    const details = [];
    if (imageTempUrlMissingCount > 0) {
      details.push(`飞书未返回 ${imageTempUrlMissingCount} 张图片地址`);
    }
    const localizationError = String(metadata.imageLocalizationError || '').trim();
    if (localizationError) details.push(localizationError);
    const imageWarning = `飞书图片有 ${imageFailureCount} 张未保存${details.length ? `：${details.join('；')}` : ''}`;
    return [imageWarning, aiMetadataWarning].filter(Boolean).join('；');
  }
  const status = metadata.conversionStatus || metadata.transcriptionStatus || '';
  const errorMsg = metadata.conversionError || metadata.transcriptionError || '';
  if (status === 'failed') {
    return [errorMsg || '网页转写失败（未知原因）', aiMetadataWarning].filter(Boolean).join('；');
  }
  if (status === 'wechat_captcha') {
    return ['微信安全验证拦截', aiMetadataWarning].filter(Boolean).join('；');
  }
  if (status === 'link_saved') {
    return [errorMsg || '网页抓取未成功', aiMetadataWarning].filter(Boolean).join('；');
  }
  return aiMetadataWarning;
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
    if (!savedSettings || !savedSettings.clientId || shouldPersistNormalizedInboxDir(savedSettings, this.settings)) {
      await this.saveData(this.settings);
    }
    this.lastSyncDiagnostic = null;
    this.syncStatusBar = typeof this.addStatusBarItem === 'function' ? this.addStatusBarItem() : null;
    if (this.syncStatusBar && typeof this.syncStatusBar.setText === 'function') {
      this.syncStatusBar.setText('');
    }
    this.localAsrInstallPromise = null;
    this.localOcrInstallPromise = null;
    this.currentTranscriptionAbortController = null;
    this.currentTranscriptionProcess = null;
    this.currentTranscriptionProcessDetached = false;
    this.currentTranscriptionContext = null;
    this.currentProcessingAbortController = null;
    this.currentProcessingContext = null;
    this.pendingStoppedTranscriptionDeletes = new Map();
    this.syncInboxPromise = null;
    if (this.getConfiguredLocalAsrPlatform() === 'win32') {
      try {
        const switchResult = completePendingLocalOcrSwitch(this.getConfiguredLocalOcrInstallRoot());
        if (switchResult.status === 'activated') {
          new Notice('图片文字识别 OCR 修复已自动完成。');
        }
      } catch (error) {
        console.warn('Failed to complete pending OCR environment switch:', error);
      }
    }

    this.addCommand({
      id: 'sync-wechat-inbox',
      name: '同步微信收集箱',
      callback: () => this.syncInbox(),
    });

    this.addCommand({
      id: 'stop-current-transcription',
      name: '停止当前转写',
      callback: async () => this.stopCurrentTranscription(),
    });

    this.addCommand({
      id: 'login-xiaohongshu-web',
      name: '登录小红书（用于提取小红书评论区）',
      callback: () => this.loginXiaohongshu(),
    });

    this.addCommand({
      id: 'restore-locally-quarantined-records',
      name: '恢复本机忽略的历史失败内容',
      callback: async () => {
        const count = normalizeLocallyQuarantinedRecordIds(
          this.settings.locallyQuarantinedRecordIds,
        ).length;
        if (!count) {
          new Notice('当前没有在本机忽略的历史失败内容。');
          return;
        }
        await this.saveSettings({
          ...this.settings,
          locallyQuarantinedRecordIds: [],
        });
        new Notice(`已恢复 ${count} 条历史失败内容，下次同步会重新尝试。`);
      },
    });

    this.addRibbonIcon('inbox', '同步微信收集箱', () => {
      this.syncInbox();
    });
    this.transcriptionStopRibbon = this.addRibbonIcon('square', '暂停当前转写', () => this.stopCurrentTranscription());
    this.setTranscriptionStopAvailable(false);

    this.addSettingTab(new WechatInboxSettingTab(this.app, this));

    if (this.settings.autoSyncOnLoad) {
      window.setTimeout(() => this.syncInbox(false), 1000);
    }
  }

  async saveSettings(nextSettings) {
    this.settings = mergeSettings(nextSettings);
    await this.saveData(this.settings);
  }

  setTranscriptionStopAvailable(available) {
    if (!this.transcriptionStopRibbon || !this.transcriptionStopRibbon.style) return;
    this.transcriptionStopRibbon.style.display = '';
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

  async checkXiaohongshuLogin(options = {}) {
    try {
      return await probeXiaohongshuLoginStatus('', options);
    } catch (error) {
      if (isAbortError(error)) throw error;
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
    const rootDir = normalizeConfiguredVaultPath(this.settings.inboxDir);
    const noteDir = normalizeVaultPath(this.settings.noteSaveMode === 'root' ? rootDir : `${rootDir}/${dateFolder}`);
    await this.ensureFolder(rootDir);
    await this.ensureFolder(noteDir);
    const fallbackTitle = await this.nextRecordTitle(noteDir, record, '');
    let recordForMarkdown = await this.enrichRecordMetadataWithAi(record, binding);
    const noteIdentity = applyTranscriptionNoteIdentity(recordForMarkdown, { fallbackTitle });
    recordForMarkdown = noteIdentity.record;
    const title = noteIdentity.displayTitle || fallbackTitle;
    const fileTitle = noteIdentity.titleSource
      ? await this.nextTitle(noteDir, noteIdentity.fileTitle)
      : fallbackTitle;
    const outputPlan = buildNoteOutputPlan({
      record: recordForMarkdown,
      title,
      fileTitle,
      syncedAt,
      noteDir,
      propertyFields: this.settings.notePropertyFields,
    });
    const { markdown, filePath } = outputPlan;
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
      proEntitlementLastError: '',
      proEntitlementLastErrorAt: '',
    });
    if (typeof this.saveData === 'function') {
      await this.saveData(this.settings);
    }
  }

  async cacheProEntitlementQueryError(error) {
    const message = redactKnownCredentials(
      error && error.message ? error.message : String(error || '权限查询失败'),
      this.settings,
    ).slice(0, 1000);
    this.settings = mergeSettings({
      ...this.settings,
      proEntitlementLastError: message,
      proEntitlementLastErrorAt: new Date().toISOString(),
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

  async requestJson(path, method = 'GET', body = {}, binding = null, options = {}) {
    const signal = options.signal || null;
    throwIfAborted(signal);
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
        || isBindingInvalidMessage(message);
      if (!shouldRetry || currentApiBase === officialApiBase) {
        return null;
      }
      await this.saveSettings({
        ...this.settings,
        apiBase: OFFICIAL_SYNC_API_BASE,
      });
      return await this.requestJson(path, method, body, binding, options);
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
        ...(options.noCache === true ? {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        } : {}),
      },
      body: method === 'POST' ? JSON.stringify(requestBody || {}) : undefined,
      signal,
    };

    let response;
    try {
      response = signal
        ? await requestJsonViaNode(requestOptions)
        : await requestUrl(requestOptions);
    } catch (error) {
      if (isAbortError(error) || (signal && signal.aborted)) throw createAbortError();
      const message = error && error.message ? error.message : String(error || '');
      const shouldReadBindErrorBody = path !== '/unbind-self'
        && /request failed|status\s*(?:4|5)\d\d|http\s*(?:4|5)\d\d/i.test(message);
      if (isRequestUrlTransportError(message) || shouldReadBindErrorBody) {
        try {
          response = await requestJsonViaNode(requestOptions);
        } catch (fallbackError) {
          if (isAbortError(fallbackError) || (signal && signal.aborted)) throw createAbortError();
          if (shouldReadBindErrorBody) throw error;
          const fallbackMessage = fallbackError && fallbackError.message ? fallbackError.message : String(fallbackError || '');
          throw new Error(`网络连接失败：${fallbackMessage || message}`);
        }
      } else {
        throw error;
      }
    }
    throwIfAborted(signal);

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
      if (isBindingInvalidMessage(message)) {
        throw new Error('绑定码未绑定或已失效，请在插件设置里粘贴小程序绑定码后点击「立即绑定」');
      }
      const requestError = new Error(message);
      requestError.status = response.status;
      requestError.statusCode = response.status;
      if (payload && payload.errCode) requestError.code = String(payload.errCode);
      throw requestError;
    }
    if (!payload || payload.success === false) {
      const message = (payload && payload.errMsg) || '同步 API 请求失败';
      const officialRetryPayload = await retryWithOfficialApiBaseIfNeeded(message);
      if (officialRetryPayload) return officialRetryPayload;
      if (message.includes('Missing client ID')) {
        throw new Error('本地设备标识缺失，请更新到最新版插件并重启 Obsidian 后再绑定');
      }
      if (isBindingInvalidMessage(message)) {
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
      const error = new Error((payload && (payload.error && payload.error.message || payload.errMsg)) || `HTTP ${response.status}`);
      error.status = Number(response.status) || 0;
      error.statusCode = error.status;
      error.response = { status: error.status };
      throw error;
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

  async requestFeishuJsonWithBindingFallback(path, method = 'GET', body = {}, binding = null) {
    const bindings = binding ? [binding] : this.getActiveBindings();
    if (!bindings.length) {
      return await this.requestJson(path, method, body, binding || undefined);
    }
    let lastError = null;
    for (const candidate of bindings) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await this.requestJson(path, method, body, candidate);
      } catch (error) {
        lastError = error;
        if (!isBindingInvalidMessage(error && error.message ? error.message : error)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  async connectFeishuCloudOAuth(binding = null) {
    const payload = await this.requestFeishuJsonWithBindingFallback(
      '/feishu/oauth/start',
      'POST',
      this.withFeishuCustomAppConfig({}),
      binding,
    );
    const data = payload && payload.data ? payload.data : payload;
    const authUrl = String((data && data.authUrl) || '').trim();
    if (!authUrl) throw new Error('Feishu OAuth did not return authUrl');
    await openExternalUrl(authUrl);
    return data;
  }

  async refreshFeishuCloudOAuthStatus(binding = null) {
    const payload = await this.requestFeishuJsonWithBindingFallback(
      '/feishu/oauth/status',
      'GET',
      {},
      binding,
    );
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
    if (!inputText) return { title: '', description: '', keywords: [] };
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
    if (!inputText) return { title: '', description: '', keywords: [] };
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
            content: '你是内容整理助手。请基于用户提供的文案生成独立标题、简介和关键词。只输出 JSON：{"title":"主题式短标题","description":"一句话简介","keywords":["关键词1","关键词2"]}。title 用 8 到 24 个中文字符概括核心主题，不带平台名，不使用“这是一份”“本文介绍”“本视频讲述”等报告式开头；description 控制在 1 句话；keywords 返回 3 到 8 个简洁中文或英文关键词。',
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

  async enrichRecordMetadataWithAi(record, binding = null) {
    if (!shouldGenerateAiMetadata(this.settings, record)) return record;
    const metadata = { ...((record && record.metadata) || {}) };
    delete metadata.aiMetadataError;
    const fail = (error) => {
      return {
        ...record,
        metadata: {
          ...metadata,
          aiMetadataError: classifyAiMetadataError(error),
        },
      };
    };
    let hasAccess = false;
    try {
      hasAccess = await this.hasProFeatureAccess();
    } catch (error) {
      return fail(error);
    }
    if (!hasAccess) {
      return record;
    }
    let generated;
    try {
      generated = await retryAiMetadataGeneration(
        () => this.generateMetadataWithDeepSeek(record, binding),
        { wait: sleep, maxAttempts: 3 },
      );
    } catch (error) {
      return fail(error);
    }
    const semanticTitle = String(generated && generated.title || '').trim();
    const description = String(generated && generated.description || '').trim();
    const keywords = getRecordKeywords(generated || {}).map((item) => String(item || '').trim()).filter(Boolean);
    if (!semanticTitle && !description && !keywords.length) {
      return fail('empty-response');
    }
    if (semanticTitle) metadata.semanticTitle = semanticTitle;
    if (description) {
      metadata.description = description;
    }
    if (keywords.length) {
      metadata.keywords = keywords;
    }
    if (semanticTitle || description || keywords.length) {
      metadata.aiMetadataSource = this.settings.deepseekApiKey ? 'deepseek' : 'cloud';
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
    const replacement = !existing && currentBindings.length >= MAX_PLUGIN_BINDINGS
      ? currentBindings.find((item) => item.status === 'needs_rebind')
      : null;
    if (!canAddPluginBinding(this.settings, tokenToBind)) {
      new Notice(`最多绑定 ${MAX_PLUGIN_BINDINGS} 个小程序码`);
      return;
    }

    try {
      await this.requestJson('/bind', 'POST', {
        clientId: this.settings.clientId,
      }, { token: tokenToBind });
      const token = tokenToBind;
      const boundBinding = existing
        ? {
          ...existing,
          enabled: true,
          status: 'bound',
          lastError: '',
          unboundAt: '',
        }
        : {
          token,
          label: `微信 ${currentBindings.length + 1}`,
          enabled: true,
          status: 'bound',
          boundAt: new Date().toISOString(),
          lastSyncAt: '',
          unboundAt: '',
          lastError: '',
        };
      const nextBindings = [
        boundBinding,
        ...currentBindings.filter((item) => item.token !== token && (!replacement || item.token !== replacement.token)),
      ];
      await this.saveSettings({
        ...this.settings,
        token,
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
        (error && error.code === 'PLUGIN_BINDING_LIMIT_EXCEEDED')
        || message.includes('PLUGIN_BINDING_LIMIT_EXCEEDED')
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
      if (error && error.code === 'EXTRA_BINDING_REQUIRES_ACTIVE_PRO') {
        new Notice('体验 Pro 已到期，额外绑定暂不可用；续期后会自动恢复。');
        return;
      }
      if (/Invalid bind code/i.test(message) || (error && error.code === 'INVALID_BIND_CODE')) {
        new Notice('绑定码无效');
        return;
      }
      if (/request failed|status\s*403|http\s*403/i.test(message)) {
        new Notice('暂时无法确认绑定码状态，请重试。');
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

  async markBindingNeedsRebind(binding, reason = '') {
    const normalizedToken = normalizeBindCodeInput(binding && binding.token);
    if (!normalizedToken) return '';
    const label = String((binding && binding.label) || '').trim() || '该微信';
    const actionMessage = `${label} 的绑定码已失效，已暂停该绑定；请在小程序重新生成绑定码后，在插件设置中重新绑定。`;
    const nextBindings = normalizeBindings(this.settings).map((item) => (
      item.token === normalizedToken
        ? { ...item, enabled: false, status: 'needs_rebind', lastError: actionMessage }
        : item
    ));
    await this.saveSettings({
      ...this.settings,
      token: getPrimaryBoundToken(nextBindings),
      bindings: nextBindings,
    });
    return actionMessage;
  }

  async downloadArrayBuffer(url, headers = {}, options = {}) {
    if (options.signal || typeof options.onProgress === 'function') {
      return downloadArrayBufferViaNode(url, headers, options);
    }
    try {
      const response = await requestUrl({ url, method: 'GET', headers });
      const responseBuffer = response && response.arrayBuffer;
      const responseBufferSize = responseBuffer
        ? Number(responseBuffer.byteLength ?? responseBuffer.length ?? 0)
        : 0;
      if (responseBuffer && responseBufferSize > 0) {
        return responseBuffer;
      }
    } catch (error) {
      // Some Electron/Obsidian requestUrl environments cannot download Feishu temporary media URLs.
    }
    return downloadArrayBufferViaNode(url, headers, options);
  }

  async buildXiaohongshuOcrImagePayload(imageUrls = []) {
    const items = [];
    const selected = dedupeImageVariants(
      (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean),
    )
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
    const requestedImageUrls = dedupeImageVariants(
      (Array.isArray(imageUrls) ? imageUrls : [])
        .map((imageUrl) => String(imageUrl || '').trim())
        .filter(Boolean),
    );
    if (!requestedImageUrls.length) return [];
    await this.ensureProFeatureAccess('小红书图片 OCR');
    const images = await this.buildXiaohongshuOcrImagePayload(requestedImageUrls);
    if (!images.length) return [];
    await this.ensureLocalComponentReadyForUse('小红书图片 OCR', {
      reason: 'first-use',
      requireAsr: false,
      requireOcr: true,
    });
    const ocrTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-ocr-'));
    try {
      const entries = [];
      const sourceById = new Map();
      images.forEach((image, sourceOrder) => {
        const rawIndex = Number(image && image.index);
        const integerIndex = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0;
        const index = integerIndex > 0 ? integerIndex : sourceOrder + 1;
        const id = `image-${sourceOrder + 1}`;
        const ext = getImageFileExtension(image.imageUrl);
        const imagePath = path.join(ocrTempDir, `${id}.${ext}`);
        fs.writeFileSync(imagePath, Buffer.from(image.imageBase64 || '', 'base64'));
        const source = {
          id,
          imageUrl: String(image.imageUrl || '').trim(),
          index,
          imagePath,
        };
        entries.push({
          id,
          index,
          imagePath,
        });
        sourceById.set(id, source);
      });
      if (!entries.length) return [];
      const batchItems = await this.runLocalImageOcrBatch(entries);
      if (!Array.isArray(batchItems)
        || batchItems.length !== entries.length
        || !batchItems.every((item, position) => item
          && ['ok', 'error'].includes(item.status)
          && item.id === entries[position].id
          && item.index === entries[position].index)) {
        throw createLocalOcrBatchError('schema');
      }
      if (batchItems.length > 0
        && batchItems.every((item) => item && item.status === 'error')) {
        throw createLocalOcrBatchAllItemsFailedError(batchItems);
      }
      const items = batchItems.flatMap((item) => {
        if (!item || item.status !== 'ok') return [];
        const resultId = String(item.id || '').trim();
        const source = sourceById.get(resultId);
        if (!source) return [];
        return [{
          imageUrl: source.imageUrl,
          index: source.index,
          text: item.text,
          metrics: item.metrics,
        }];
      });
      return normalizeXiaohongshuOcrItems(items);
    } finally {
      try {
        fs.rmSync(ocrTempDir, { recursive: true, force: true });
      } catch (error) {
        // Best-effort cleanup only.
      }
    }
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
        ocrError: getSafeXiaohongshuOcrError(error),
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
    writeSyncDiagnosticLog(this.lastSyncDiagnostic, this.getConfiguredLocalAsrInstallRoot());
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

  getPendingStoppedTranscriptionDeletes() {
    if (!(this.pendingStoppedTranscriptionDeletes instanceof Map)) {
      this.pendingStoppedTranscriptionDeletes = new Map();
    }
    return this.pendingStoppedTranscriptionDeletes;
  }

  rememberPendingStoppedTranscriptionDelete(recordId, promise) {
    const normalizedRecordId = String(recordId || '').trim();
    if (!normalizedRecordId || !promise || typeof promise.then !== 'function') return;
    this.getPendingStoppedTranscriptionDeletes().set(normalizedRecordId, promise);
  }

  async consumePendingStoppedTranscriptionDelete(recordId) {
    const normalizedRecordId = String(recordId || '').trim();
    if (!normalizedRecordId) return null;
    const pendingDeletes = this.getPendingStoppedTranscriptionDeletes();
    const pending = pendingDeletes.get(normalizedRecordId);
    if (!pending) return null;
    pendingDeletes.delete(normalizedRecordId);
    return pending;
  }

  async deleteCurrentTranscriptionRecord(context = {}) {
    const recordId = String(context.recordId || '').trim();
    const binding = context.binding || null;
    if (!recordId || !binding || !binding.token) {
      return { deleted: false, recordId, reason: 'missing-context' };
    }
    const payload = await this.requestJson(
      `/records/${encodeURIComponent(recordId)}/synced`,
      'POST',
      {},
      binding,
    );
    const data = payload && payload.data ? payload.data : {};
    const responseRecordId = String(data.id || data.recordId || '').trim();
    return {
      deleted: responseRecordId === recordId
        && (data.deleted === true || data.alreadyMissing === true || data.status === 'deleted'),
      recordId,
      response: data,
    };
  }

  async writeExpiredXiaohongshuLinkReceipt(record = {}) {
    const originalUrl = getRecordXiaohongshuIdentityCandidates(record)
      .find((candidate) => isXiaohongshuShortLinkUrl(candidate))
      || getRecordUrl(record);
    const recordId = String(getRecordId(record) || '').trim();
    let shortCode = 'shortlink';
    try {
      shortCode = new URL(originalUrl).pathname.split('/').filter(Boolean).pop() || shortCode;
    } catch (error) {
      shortCode = 'shortlink';
    }
    const safeShortCode = sanitizeNoteTitlePart(shortCode, 'shortlink');
    const safeRecordSuffix = sanitizeNoteTitlePart(recordId, 'record').slice(-8);
    const rootDir = normalizeConfiguredVaultPath(this.settings.inboxDir);
    const dateFolder = getDateFolderName(record.createdAt);
    const noteDir = normalizeVaultPath(
      this.settings.noteSaveMode === 'root' ? rootDir : `${rootDir}/${dateFolder}`,
    );
    const filePath = normalizeVaultPath(
      `${noteDir}/小红书临时链接已失效-${safeShortCode}-${safeRecordSuffix}.md`,
    );
    if (!this.app
      || !this.app.vault
      || !this.app.vault.adapter
      || typeof this.app.vault.adapter.write !== 'function') {
      throw new Error('无法写入小红书失效链接说明文件');
    }
    await this.ensureFolder(rootDir);
    await this.ensureFolder(noteDir);
    const markdown = [
      '# 小红书临时链接已失效',
      '',
      '这条内容保存时使用的是小红书临时短链。同步时该短链已经失效，无法再定位原笔记。',
      '',
      `原始临时链接：${originalUrl}`,
      '',
      `原保存时间：${formatCreatedTime(record.createdAt)}`,
      '',
      '请回到原笔记，重新复制当前有效的分享链接，再发送到小程序保存。',
      '',
      '> 插件会尝试清理云端旧记录；只有清理成功后，这条内容才不会在后续同步中反复出现。',
      '',
    ].join('\n');
    await this.app.vault.adapter.write(filePath, markdown);
    return filePath;
  }

  async stopCurrentTranscription() {
    let stopped = false;
    const activeContext = this.currentTranscriptionContext && typeof this.currentTranscriptionContext === 'object'
      ? this.currentTranscriptionContext
      : this.currentProcessingContext;
    const context = activeContext && typeof activeContext === 'object'
      ? {
        ...activeContext,
        binding: activeContext.binding
          ? { ...activeContext.binding }
          : null,
      }
      : null;
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort();
      stopped = true;
    }
    if (this.currentTranscriptionAbortController) {
      this.currentTranscriptionAbortController.abort();
      stopped = true;
    }
    if (this.currentTranscriptionProcess && !this.currentTranscriptionProcess.killed) {
      try {
        const child = this.currentTranscriptionProcess;
        if (process.platform === 'win32' && Number.isInteger(child.pid) && child.pid > 0) {
          childProcess.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else if (process.platform === 'darwin' && this.currentTranscriptionProcessDetached && Number.isInteger(child.pid) && child.pid > 0) {
          process.kill(-child.pid, 'SIGTERM');
        }
        child.kill();
        stopped = true;
      } catch (error) {
        // Ignore process cleanup failures.
      }
    }
    if (context && closeActiveXiaohongshuBrowserWindows() > 0) {
      stopped = true;
    }
    if (!stopped) {
      new Notice('当前没有正在转写的任务。');
      return false;
    }
    if (!context || !context.recordId || !context.binding || !context.binding.token) {
      new Notice('已停止当前转写，会继续处理后面的同步内容。');
      return true;
    }
    const pendingDeletes = this.getPendingStoppedTranscriptionDeletes();
    let deletePromise = pendingDeletes.get(String(context.recordId));
    if (!deletePromise) {
      deletePromise = this.deleteCurrentTranscriptionRecord(context)
        .catch((error) => ({
          deleted: false,
          recordId: context.recordId,
          error,
        }));
      this.rememberPendingStoppedTranscriptionDelete(context.recordId, deletePromise);
    }
    const deleteResult = await deletePromise;
    if (deleteResult && deleteResult.deleted) {
      const cleanupWarning = deleteResult.response && deleteResult.response.cleanupComplete === false
        ? '；记录已删除，但部分关联文件清理失败'
        : '';
      new Notice(`已停止当前转写，并从云端删除这条内容；后续同步不会再出现${cleanupWarning}。`);
      return true;
    }
    const message = deleteResult && deleteResult.error
      ? (deleteResult.error.message || String(deleteResult.error))
      : '云端未确认删除成功';
    new Notice(`已停止当前转写，但删除云端内容失败：${message}；这条内容下次同步可能还会出现。`);
    return true;
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
      if (isBindingInvalidMessage(message) || /Request failed,\s*status\s+403\b/i.test(message)) {
        await this.markBindingUnbound(normalizedToken, '小程序已解除绑定，本机同步清理旧绑定');
        new Notice('该绑定已在小程序解除，本机旧绑定已同步清除。');
        return;
      }
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
    const platform = this.getConfiguredLocalAsrPlatform();
    if (configured) {
      const configuredRoot = extractLocalAsrInstallRootFromCommand(configured, platform);
      if (!configuredRoot) return configured;
      const configuredStatus = getLocalAsrInstallStatus(configuredRoot, fs.existsSync, platform);
      if (configuredStatus.ready) return configured;
    }
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    const installStatus = getLocalAsrInstallStatus(installRoot, fs.existsSync, platform);
    return installStatus.ready
      ? getDefaultLocalTranscriptionCommand(platform, installRoot)
      : configured;
  }

  async recoverStaleLocalTranscriptionCommand() {
    const configured = String(this.settings.localTranscriptionCommand || '').trim();
    const platform = this.getConfiguredLocalAsrPlatform();
    const configuredRoot = extractLocalAsrInstallRootFromCommand(configured, platform);
    if (!configured || !configuredRoot) return '';
    const configuredStatus = getLocalAsrInstallStatus(configuredRoot, fs.existsSync, platform);
    if (configuredStatus.ready) return '';
    const recoveredCommand = this.getEffectiveLocalTranscriptionCommand();
    if (!recoveredCommand || recoveredCommand === configured) return '';
    await this.saveSettings({
      ...this.settings,
      localTranscriptionCommand: recoveredCommand,
    });
    return recoveredCommand;
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
    const pendingSwitchPath = path.join(installRoot, 'pending-venv-switch.json');
    if (platform === 'win32' && fs.existsSync(pendingSwitchPath)) {
      new Notice('图片文字识别 OCR 修复已准备完成，重启 Obsidian 后会自动完成切换。', 10000);
      return { pendingRestart: true };
    }
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
    const installerSha256 = isMac ? LOCAL_OCR_MACOS_INSTALLER_SHA256 : LOCAL_OCR_WINDOWS_INSTALLER_SHA256;
    const downloadedPath = path.join(os.tmpdir(), `wechat-inbox-local-ocr-installer-${Date.now()}${isMac ? '.sh' : '.ps1'}`);

    try {
      let scriptText = '';
      try {
        const response = await requestUrl({ url: `${installerUrl}?t=${Date.now()}`, method: 'GET' });
        scriptText = response.text || '';
      } catch (error) {
        scriptText = await downloadTextViaNode(`${installerUrl}?t=${Date.now()}`);
      }
      if (!isTrustedLocalOcrInstallerSource(scriptText, installerSha256, isMac)) {
        throw new Error('Local OCR installer download returned outdated or invalid content');
      }
      fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(scriptText, isMac), 'utf8');
      this.copyBundledLocalOcrRuntimeAssets(downloadedPath);
      return downloadedPath;
    } catch (downloadError) {
      if (fs.existsSync(installerPath)) {
        const bundledScriptText = fs.readFileSync(installerPath, 'utf8');
        if (isTrustedLocalOcrInstallerSource(bundledScriptText, installerSha256, isMac)) {
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

  async runLocalImageOcrBatch(imageEntries = []) {
    const entries = Array.isArray(imageEntries) ? imageEntries : [];
    if (!entries.length) return [];
    const status = this.getLocalOcrInstallStatus();
    if (!status || !status.ready || !status.pythonPath) {
      throw createLocalOcrBatchError('not_ready');
    }

    let batchTempDir = '';
    try {
      batchTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-inbox-ocr-batch-'));
      const runnerPath = path.join(
        batchTempDir,
        `${LOCAL_OCR_BATCH_RUNNER_VERSION}.py`,
      );
      const manifestPath = path.join(batchTempDir, 'manifest.json');
      const outputPath = path.join(batchTempDir, 'result.json');
      const manifestItems = entries.map((entry, sourceOrder) => {
        const rawIndex = Number(entry && entry.index);
        const integerIndex = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0;
        const rawId = String(entry && entry.id || '').trim();
        return {
          id: /^[A-Za-z0-9_-]{1,80}$/.test(rawId) ? rawId : `image-${sourceOrder + 1}`,
          index: integerIndex > 0 ? integerIndex : sourceOrder + 1,
          input: String(entry && (entry.imagePath || entry.input || entry.path) || ''),
        };
      });
      fs.writeFileSync(runnerPath, LOCAL_OCR_BATCH_RUNNER_SOURCE, 'utf8');
      fs.writeFileSync(manifestPath, JSON.stringify({
        schemaVersion: 1,
        runnerVersion: LOCAL_OCR_BATCH_RUNNER_VERSION,
        items: manifestItems,
      }), 'utf8');

      await new Promise((resolve, reject) => {
        childProcess.execFile(status.pythonPath, [
          runnerPath,
          '--batch-manifest',
          manifestPath,
          '--output',
          outputPath,
        ], {
          timeout: LOCAL_OCR_BATCH_RUN_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        }, (error) => {
          if (error) {
            const timedOut = Boolean(
              error.killed
              || error.signal === 'SIGTERM'
              || /timed out|timeout/i.test(String(error.message || '')),
            );
            reject(createLocalOcrBatchError(timedOut ? 'timeout' : 'process'));
            return;
          }
          resolve();
        });
      });

      if (!fs.existsSync(outputPath)) throw createLocalOcrBatchError('schema');
      let payload;
      try {
        payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      } catch (error) {
        throw createLocalOcrBatchError('schema');
      }
      return bindLocalOcrBatchResultItems(payload, manifestItems);
    } catch (error) {
      if (/^LOCAL_OCR_BATCH_/.test(String(error && error.code || ''))) throw error;
      throw createLocalOcrBatchError('io');
    } finally {
      if (batchTempDir) {
        try {
          fs.rmSync(batchTempDir, { recursive: true, force: true });
        } catch (error) {
          // Best-effort cleanup only.
        }
      }
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

  async getAvailableLocalAsrInstallerPath(options = {}) {
    const installerPath = this.getBundledLocalAsrInstallerPath();
    const isMac = this.getConfiguredLocalAsrPlatform() === 'darwin';
    const installerUrl = isMac ? LOCAL_ASR_MACOS_INSTALLER_URL : LOCAL_ASR_INSTALLER_URL;
    const downloadedPath = path.join(os.tmpdir(), `wechat-inbox-local-asr-installer-${Date.now()}${isMac ? '.sh' : '.ps1'}`);

    const isInstallerCurrent = (scriptText) => isLocalAsrInstallerCurrent(scriptText, isMac);
    const fetchInstallerText = typeof options.fetchInstallerText === 'function'
      ? options.fetchInstallerText
      : async (url) => {
        try {
          const response = await requestUrl({ url, method: 'GET' });
          return response.text || '';
        } catch (error) {
          return downloadTextViaNode(url);
        }
      };

    try {
      const scriptText = await fetchInstallerText(`${installerUrl}?t=${Date.now()}`);
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
      `脚本兼容状态：${status.upgradeRecommended ? '兼容可用，建议升级' : (status.scriptOutdated ? '不可用' : '当前版本')}`,
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
      `最近权限查询失败：${this.settings.proEntitlementLastError
        ? `${this.settings.proEntitlementLastErrorAt || '时间未知'} ${this.settings.proEntitlementLastError}`
        : '无'}`,
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
    const runtimeIdentity = getPluginRuntimeIdentity(
      this.manifest && this.manifest.version ? this.manifest.version : '',
    );
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
      `插件版本：${runtimeIdentity.manifestVersion}`,
      `运行 Bundle：${runtimeIdentity.runtimeVersion} / ${runtimeIdentity.buildMarker}`,
      `版本身份一致：${runtimeIdentity.matchesManifest ? '是' : '否（请完全退出并重新打开 Obsidian）'}`,
      `运行系统：${os.platform()} ${os.arch()} ${os.release()}`,
      `手动选择系统：${this.settings.localAsrPlatform || 'auto'}`,
      `实际使用系统：${platform}`,
      `API 地址：${this.settings.apiBase || '-'}`,
      `绑定码：${this.getActiveBindings().map((item) => `${item.label || ''}:[REDACTED]`).join(', ') || '-'}`,
      `权限缓存：${JSON.stringify(redactSensitiveObject(this.settings.localTranscriptionEntitlementStatus || {}))}`,
      `最近权限查询失败：${this.settings.proEntitlementLastError
        ? `${this.settings.proEntitlementLastErrorAt || '时间未知'} ${this.settings.proEntitlementLastError}`
        : '无'}`,
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

  async getLocalTranscriptionEntitlementStatus(options = {}) {
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
    let lastInactiveStatus = null;
    const queryErrors = [];
    for (const binding of bindings) {
      for (const plan of plans) {
        try {
          const payload = await this.requestJson(
            `/entitlements/status?plan=${encodeURIComponent(plan)}`,
            'GET',
            {},
            binding,
            { noCache: options.forceRefresh === true },
          );
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
          lastInactiveStatus = data;
        } catch (error) {
          queryErrors.push(error);
        }
      }
    }

    if (queryErrors.length) {
      const queryError = queryErrors[queryErrors.length - 1];
      await this.cacheProEntitlementQueryError(queryError);
      throw queryError;
    }

    const inactiveStatus = {
      hasAccess: false,
      plan: LOCAL_TRANSCRIPTION_PLAN,
      status: (lastInactiveStatus && lastInactiveStatus.status) || 'inactive',
      expiresAt: (lastInactiveStatus && lastInactiveStatus.expiresAt) || '',
    };
    await this.cacheLocalTranscriptionEntitlementStatus(inactiveStatus);
    return inactiveStatus;
  }

  async getProFeatureAccessStatus(options = {}) {
    const code = normalizeBindCodeInput(this.settings.pendingRedeemCode);
    const cached = this.settings && this.settings.localTranscriptionEntitlementStatus;
    if (!options.forceRefresh && isCachedProStatusActive(cached)) return cached;
    const bindingStatus = await this.getLocalTranscriptionEntitlementStatus({
      forceRefresh: options.forceRefresh === true,
    });
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

  async ensureProFeatureAccess(featureName = '该功能', options = {}) {
    let status = await this.getProFeatureAccessStatus({
      forceRefresh: options.forceRefresh === true,
    });
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
      if (isCachedProStatusActive(cached)) return cached;
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

    try {
      await this.installLocalTranscriptionComponents({ reason, readiness });
    } catch (error) {
      if (reason === 'first-use') {
        throw error;
      }
      return {
        ...status,
        localComponentInstallError: error && error.message ? error.message : String(error || ''),
      };
    }
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

  async renderSocialMediaUrl(url, options = {}) {
    return renderSocialMediaUrlWithElectron(url, options);
  }

  async renderXiaohongshuPage(url, options = {}) {
    return await renderXiaohongshuPageWithElectron(url, options);
  }

  async requestXiaohongshuStaticPage(url) {
    const sourceUrl = String(url || '').trim();
    if (!isTrustedXiaohongshuTransportUrl(sourceUrl)) {
      throw new Error('小红书静态抓取地址不是可信的官方 HTTPS 地址');
    }
    const response = await requestPublicWebpageText(sourceUrl, {
      // Static public-note extraction never needs login cookies. Logged-in
      // comments stay inside the isolated BrowserWindow / strict API path.
      headers: getSocialRequestHeaders(sourceUrl),
      allowedRedirectUrl: (redirectUrl) => isTrustedXiaohongshuTransportUrl(redirectUrl),
    });
    if (!response || !isTrustedXiaohongshuCookieUrl(response.url)) {
      throw new Error('小红书正文抓取的最终地址无法确认为官方 HTTPS 内容页');
    }
    return response;
  }

  async fetchDouyinMediaUrlsWithSession(pageUrl, awemeId) {
    return fetchDouyinMediaUrlsWithSession({ pageUrl, awemeId });
  }

  async fetchDouyinMediaResolutionWithSession(pageUrl, awemeId) {
    return fetchDouyinMediaResolutionWithSession({ pageUrl, awemeId });
  }

  async downloadMediaArrayBufferWithSession(url, headers = {}, options = {}) {
    return downloadArrayBufferViaElectronSession(url, headers, options);
  }

  async refreshDouyinMediaUrls(sourceUrl) {
    const originalUrl = String(sourceUrl || '').trim();
    if (!isDouyinUrl(originalUrl)) return [];
    const directTarget = normalizeDouyinTargetUrl(originalUrl, originalUrl);
    if (directTarget.awemeId) {
      try {
        return sortMediaUrlsForTranscription(
          await this.fetchDouyinMediaUrlsWithSession(directTarget.url, directTarget.awemeId),
        );
      } catch (error) {
        return [];
      }
    }
    let resolvedUrl = originalUrl;
    try {
      resolvedUrl = await resolveRedirectUrl(originalUrl, 5, 'GET');
    } catch (error) {
      resolvedUrl = originalUrl;
    }
    const target = normalizeDouyinTargetUrl(originalUrl, resolvedUrl);
    const candidates = [];
    if (target.awemeId) {
      try {
        candidates.push(...await this.fetchDouyinMediaUrlsWithSession(target.url, target.awemeId));
      } catch (error) {
        return [];
      }
      return sortMediaUrlsForTranscription(candidates);
    }
    try {
      candidates.push(...await this.renderSocialMediaUrls(target.url || resolvedUrl || originalUrl, {
        timeoutMs: 18000,
      }));
    } catch (error) {
      // Keep the original download error if refreshing also fails.
    }
    return sortMediaUrlsForTranscription(candidates);
  }

  async renderSocialMediaUrls(url, options = {}) {
    if (
      Object.prototype.hasOwnProperty.call(this, 'renderSocialMediaUrl')
      && !Object.prototype.hasOwnProperty.call(this, 'renderSocialMediaUrls')
    ) {
      return sortMediaUrlsForTranscription([await this.renderSocialMediaUrl(url, options)]);
    }
    return renderSocialMediaUrlsWithElectron(url, options);
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

    // Local transcription is a Pro capability with no user-facing provider picker.
    // Older installations can still retain the legacy "off" provider value after
    // the ASR component has been installed, which must not silently disable every
    // social-video transcription.
    if (provider === 'off' && this.canRunLocalTranscription() && await this.hasProFeatureAccess()) {
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
        if (isRetryableTranscriptionError(error)) {
          throw error;
        }
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
      const payload = await this.requestJson('/transcriptions/cloud', 'POST', requestBody, binding, {
        signal: options.signal || null,
      });
      throwIfAborted(options.signal || null);
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
      if (isAbortError(cloudError) || (options.signal && options.signal.aborted)) {
        throw createAbortError();
      }
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
    await this.recoverStaleLocalTranscriptionCommand();
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
    this.currentTranscriptionContext = {
      recordId: options.recordId || '',
      binding: options.binding || null,
      title: progressTitle,
    };
    this.setTranscriptionStopAvailable(true);
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
      const key = buildLocalAsrProgressKey(progress);
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
        localProgressStartedAt: progress.startedAt,
        localProgressHeartbeatAt: progress.heartbeatAt,
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
          detached: process.platform === 'darwin',
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
        this.currentTranscriptionProcessDetached = process.platform === 'darwin';
      });

      const outputText = fs.existsSync(outputPath)
        ? fs.readFileSync(outputPath, 'utf8')
        : stdout;
      const transcription = assertUsableTranscription(
        cleanTrailingTranscriptionHallucinations(String(outputText || '').trim()),
        '本地转写',
      );
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
      this.currentTranscriptionProcessDetached = false;
      this.currentTranscriptionContext = null;
      this.setTranscriptionStopAvailable(false);
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
    const requestOptions = { signal: options.signal, onProgress: options.onProgress };
    const sourceUrl = String(options.sourceUrl || '').trim();
    const requestHeaders = getSocialRequestHeaders(sourceUrl || resolvedUrl);
    const canRecoverDouyin = isDouyinUrl(sourceUrl)
      || isDouyinUrl(audioUrl)
      || isDouyinMediaUrl(resolvedUrl);
    let downloadedUrl = resolvedUrl;
    let downloadedArrayBuffer;
    try {
      downloadedArrayBuffer = await this.downloadArrayBuffer(resolvedUrl, requestHeaders, requestOptions);
    } catch (error) {
      if (!canRecoverDouyin || !isMediaAuthorizationError(error)) throw error;
      let lastError = error;
      try {
        downloadedArrayBuffer = await this.downloadMediaArrayBufferWithSession(resolvedUrl, requestHeaders, requestOptions);
      } catch (sessionError) {
        lastError = sessionError;
        const refreshedUrls = sourceUrl ? await this.refreshDouyinMediaUrls(sourceUrl) : [];
        for (const refreshedUrl of refreshedUrls) {
          if (!refreshedUrl || refreshedUrl === resolvedUrl) continue;
          try {
            // eslint-disable-next-line no-await-in-loop
            downloadedArrayBuffer = await this.downloadArrayBuffer(
              refreshedUrl,
              getSocialRequestHeaders(sourceUrl || refreshedUrl),
              requestOptions,
            );
            downloadedUrl = refreshedUrl;
            break;
          } catch (refreshedError) {
            lastError = refreshedError;
            if (!isMediaAuthorizationError(refreshedError)) continue;
            try {
              // eslint-disable-next-line no-await-in-loop
              downloadedArrayBuffer = await this.downloadMediaArrayBufferWithSession(
                refreshedUrl,
                getSocialRequestHeaders(sourceUrl || refreshedUrl),
                requestOptions,
              );
              downloadedUrl = refreshedUrl;
              break;
            } catch (refreshedSessionError) {
              lastError = refreshedSessionError;
            }
          }
        }
        if (!downloadedArrayBuffer) throw lastError;
      }
    }
    const downloadedBuffer = Buffer.from(downloadedArrayBuffer);
    throwIfAborted(options.signal);
    const buffer = options.decryptKey
      ? decryptWechatChannelsMediaBuffer(downloadedBuffer, options.decryptKey)
      : downloadedBuffer;
    const invalidReason = getInvalidDownloadedMediaReason(buffer);
    if (invalidReason) {
      throw new Error(`${invalidReason}：${cleanDisplayUrl(downloadedUrl || audioUrl)}`);
    }
    const ext = getAudioFormatFromUrl(downloadedUrl || audioUrl);
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
    const normalizedFolderPath = normalizeVaultPath(folderPath);
    if (!normalizedFolderPath) return;
    const segments = normalizedFolderPath.split('/');
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(currentPath))) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch (error) {
          if (!(await this.app.vault.adapter.exists(currentPath))) {
            throw error;
          }
        }
      }
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
    rootDir = normalizeConfiguredVaultPath(rootDir);
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
    await this.app.vault.adapter.writeBinary(normalizeVaultPath(audioPath), audioBuffer);

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
          recordId: getRecordId(record),
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
        if (isRetryableTranscriptionError(error)) throw error;
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
          recordId: getRecordId(record),
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
        if (isRetryableTranscriptionError(error)) throw error;
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
    rootDir = normalizeConfiguredVaultPath(rootDir);
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
      await this.app.vault.adapter.writeBinary(normalizeVaultPath(filePath), fileBuffer);
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
          nextMetadata.conversionProvider = 'pdf-text-layer';
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
            recordId: getRecordId(record),
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
          if (isRetryableTranscriptionError(error)) throw error;
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
      if (isRetryableTranscriptionError(error)) throw error;
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
    rootDir = normalizeConfiguredVaultPath(rootDir);
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
      await this.app.vault.adapter.writeBinary(normalizeVaultPath(imagePath), decoded.buffer);
      const pattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(asset.src)}\\)`, 'g');
      nextMarkdown = nextMarkdown.replace(pattern, `![[${imagePath}]]`);
      index += 1;
    }

    return nextMarkdown;
  }

  async saveMarkdownRemoteImageAssets(markdown, rootDir, dateFolder, title, options = {}) {
    rootDir = normalizeConfiguredVaultPath(rootDir);
    if (!markdown
      || !this.app
      || !this.app.vault
      || !this.app.vault.adapter
      || typeof this.app.vault.adapter.writeBinary !== 'function') {
      return markdown;
    }
    const sourceUrl = String(options.sourceUrl || '').trim();
    const isXiaohongshuSource = isXiaohongshuUrl(sourceUrl);
    const isWechatArticleSource = isWechatArticleUrl(sourceUrl);
    let nextMarkdown = isXiaohongshuSource
      ? sanitizeXiaohongshuMarkdownImages(String(markdown))
      : String(markdown);
    const imageMatches = Array.from(nextMarkdown.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g));
    if (!imageMatches.length) return nextMarkdown;

    const imageRootDir = `${rootDir}/网页图片`;
    const imageDayDir = `${imageRootDir}/${dateFolder}`;
    let index = 1;
    const savedByUrl = new Map();
    const safeTitle = sanitizeAttachmentName(title, '网页图片');

    try {
      await this.ensureFolder(imageRootDir);
      await this.ensureFolder(imageDayDir);
    } catch (error) {
      if (typeof options.onError === 'function') {
        options.onError({ imageUrl: '', error });
      }
      return nextMarkdown;
    }

    for (const match of imageMatches) {
      const imageUrl = String(match[2] || '').trim();
      if (!imageUrl || savedByUrl.has(imageUrl)) continue;
      try {
        const imageHeaders = isXiaohongshuSource
          ? await getXiaohongshuRequestHeaders(sourceUrl)
          : isWechatArticleSource
            ? { ...getSocialRequestHeaders(sourceUrl), Referer: sourceUrl }
            : {};
        // eslint-disable-next-line no-await-in-loop
        const arrayBuffer = await this.downloadArrayBuffer(imageUrl, imageHeaders);
        const buffer = Buffer.from(arrayBuffer || []);
        if (!buffer.length) throw new Error('图片下载结果为空');
        const ext = getImageExtFromBuffer(buffer, imageUrl);
        const imagePath = `${imageDayDir}/${safeTitle}-image-${String(index).padStart(2, '0')}.${ext}`;
        // eslint-disable-next-line no-await-in-loop
        await this.app.vault.adapter.writeBinary(normalizeVaultPath(imagePath), buffer);
        savedByUrl.set(imageUrl, imagePath);
        index += 1;
      } catch (error) {
        // Remote image localization is best-effort. Keep the original URL if download fails.
        if (typeof options.onError === 'function') {
          options.onError({ imageUrl, error });
        }
      }
    }

    savedByUrl.forEach((imagePath, imageUrl) => {
      const pattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(imageUrl)}\\)`, 'g');
      nextMarkdown = nextMarkdown.replace(pattern, `![[${imagePath}]]`);
    });

    return nextMarkdown;
  }

  async saveSourceMediaAttachment(record, rootDir, dateFolder, title) {
    rootDir = normalizeConfiguredVaultPath(rootDir);
    const metadata = (record && record.metadata) || {};
    const mediaUrl = String(metadata.mediaUrl || metadata.audioUrl || '').trim();
    if (!this.settings.saveOriginalMediaEnabled || !metadata.transcriptOnly || !mediaUrl) {
      return record;
    }

    try {
      await this.ensureProFeatureAccess('保存原始音视频到本地', { forceRefresh: true });
    } catch (error) {
      return record;
    }

    const videoPlatform = isVideoPlatform(metadata.platform, metadata.url || record.content || '');
    const attachmentFailure = (message = '') => ({
      ...record,
      metadata: {
        ...metadata,
        sourceMediaAttachmentPath: '',
        sourceMediaAttachmentError: message || (videoPlatform ? '未取得原视频，已保留转写结果。' : '原始音视频未能保存到本地。'),
      },
    });
    if (!this.app || !this.app.vault || !this.app.vault.adapter || typeof this.app.vault.adapter.writeBinary !== 'function') {
      return attachmentFailure();
    }

    try {
      const sourceUrl = String(metadata.url || record.content || mediaUrl).trim();
      const candidates = Array.from(new Set([
        ...(Array.isArray(metadata.mediaUrls) ? metadata.mediaUrls : []),
        mediaUrl,
      ].map((item) => String(item || '').trim()).filter(Boolean)));
      let selectedBuffer = null;
      let selectedUrl = '';
      for (const candidateUrl of candidates) {
        const headers = isXiaohongshuUrl(sourceUrl)
          ? await getXiaohongshuRequestHeaders(candidateUrl)
          : getSocialRequestHeaders(sourceUrl || candidateUrl);
        // eslint-disable-next-line no-await-in-loop
        const buffer = Buffer.from(await this.downloadArrayBuffer(candidateUrl, headers));
        if (getInvalidDownloadedMediaReason(buffer)) continue;
        if (videoPlatform && !hasVideoTrackInMediaBuffer(buffer)) continue;
        selectedBuffer = buffer;
        selectedUrl = candidateUrl;
        break;
      }
      if (!selectedBuffer || !selectedUrl) return attachmentFailure();
      const extension = videoPlatform ? 'mp4' : getAudioFormatFromUrl(selectedUrl);
      const recordShortId = sanitizeAttachmentName(getRecordId(record), 'media').slice(0, 12) || 'media';
      const safeTitle = sanitizeAttachmentName(title || metadata.title, '音视频');
      const attachmentRootDir = `${rootDir}/音视频附件`;
      const attachmentDayDir = `${attachmentRootDir}/${dateFolder}`;
      const attachmentPath = `${attachmentDayDir}/${safeTitle}-${recordShortId}.${extension}`;
      await this.ensureFolder(attachmentRootDir);
      await this.ensureFolder(attachmentDayDir);
      await this.app.vault.adapter.writeBinary(normalizeVaultPath(attachmentPath), selectedBuffer);
      return {
        ...record,
        metadata: {
          ...metadata,
          sourceMediaAttachmentPath: attachmentPath,
          sourceMediaAttachmentError: '',
        },
      };
    } catch (error) {
      return attachmentFailure();
    }
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
    trailingMarkdown = '',
    binding = null,
    title = '',
    socialMetrics = {},
    sourceTitle = '',
    signal = null,
  }) {
    throwIfAborted(signal);
    const metadata = record.metadata || {};
    const normalizedSourceTitle = String(sourceTitle || metadata.sourceTitle || '').trim();
    const metadataWithSocialMetrics = {
      ...metadata,
      contentCategory: metadata.contentCategory || '音视频',
      ...(hasSocialMetrics(socialMetrics)
        ? { socialMetrics: withCapturedSocialMetrics(socialMetrics, new Date().toISOString()) }
        : {}),
      ...(normalizedSourceTitle ? { sourceTitle: normalizedSourceTitle } : {}),
    };

    if (subtitleText) {
      return {
        ...record,
        metadata: buildTranscriptOnlyMetadata(metadataWithSocialMetrics, {
          url,
          platform,
          mediaUrl,
          mediaUrls,
          subtitleUrl,
          transcription: subtitleText,
          transcriptionStatus: 'success',
          transcriptionSource: source || 'subtitle',
          conversionStatus: 'success',
          markdown,
          trailingMarkdown,
          sourceTitle: normalizedSourceTitle,
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
        metadata: buildTranscriptOnlyMetadata(metadataWithSocialMetrics, {
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
          trailingMarkdown,
          sourceTitle: normalizedSourceTitle,
        }),
      };
    }

    let lastError = null;
    try {
      for (const candidate of candidates) {
        throwIfAborted(signal);
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
               signal,
             })
            : await this.runConfiguredTranscription(candidateUrl, {
              allowCloudUrlFallback: true,
              title: metadata.title || '',
              source: source || 'media-url',
              sourceUrl: url,
              binding,
              recordId: getRecordId(record),
              decryptKey: candidateDecryptKey,
              forceLocal: metadata.transcriptionMode === 'local',
              signal,
            });
          throwIfAborted(signal);
          const nextMetadata = buildTranscriptOnlyMetadata(metadataWithSocialMetrics, {
            url,
            platform,
            mediaUrl: candidateUrl,
            mediaUrls: candidates.map((candidate) => candidate.url),
            subtitleUrl,
            transcription: result.transcription,
            transcriptionStatus: 'success',
            transcriptionSource: result.source,
            conversionStatus: 'success',
            markdown,
            trailingMarkdown,
            sourceTitle: normalizedSourceTitle,
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
          if (isAbortError(candidateError)) throw candidateError;
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
        metadata: buildTranscriptOnlyMetadata(metadataWithSocialMetrics, {
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
          trailingMarkdown,
          sourceTitle: normalizedSourceTitle,
        }),
      };
    }
  }

  async hydrateXiaoyuzhouTranscript(record, url, binding = null, title = '') {
    const response = await requestUrl({ url, method: 'GET', headers: getSocialRequestHeaders(url) });
    const html = response.text || '';
    const markdown = buildSocialMediaSupplementalMarkdownFromHtml(html, url);
    const pageMetadata = extractWebpageMetadataFromHtml(html, url);
    const mediaUrl = extractPodcastAudioUrlFromHtml(html) || extractSocialMediaUrlFromHtml(html);
    return this.buildTranscriptRecordFromMedia(record, {
      url,
      platform: '小宇宙',
      mediaUrl,
      mediaUrls: extractSocialMediaUrlsFromHtml(html),
      source: 'audio',
      markdown,
      binding,
      title,
      sourceTitle: pageMetadata.title,
      socialMetrics: extractSocialMetricsFromHtml(html),
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
    let markdown = buildSocialMediaSupplementalMarkdownFromHtml(html, resolvedUrl);
    const pageMetadata = extractWebpageMetadataFromHtml(html, resolvedUrl);
    let sourceTitle = pageMetadata.title;
    let bilibiliSocialMetrics = extractSocialMetricsFromHtml(html);
    let subtitleUrls = extractBilibiliSubtitleUrlsFromHtml(html);
    let bvid = extractBilibiliBvid(resolvedUrl) || extractBilibiliBvid(url) || extractBilibiliBvid(html);
    let cid = '';
    let playurlAudioUrl = '';
    let progressiveVideoUrl = '';

    if (bvid) {
      try {
        const viewResponse = await requestUrl({
          url: `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
          method: 'GET',
          headers: getSocialRequestHeaders(resolvedUrl),
        });
        const viewPayload = viewResponse.json || tryParseJson(viewResponse.text) || {};
        const viewData = viewPayload && viewPayload.data && typeof viewPayload.data === 'object'
          ? viewPayload.data
          : {};
        const apiTitle = cleanSocialDescription(viewData.title || '');
        const apiDescription = cleanSocialDescription(viewData.desc || viewData.description || '');
        const apiCoverUrl = normalizeExtractedUrl(viewData.pic || viewData.cover || viewData.coverUrl || '');
        sourceTitle = apiTitle || sourceTitle;
        if (apiTitle || apiDescription || apiCoverUrl) {
          markdown = buildSocialMediaSupplementalMarkdown({
            title: sourceTitle,
            description: apiDescription || pageMetadata.description,
            tags: pageMetadata.keywords,
            imageUrls: [
              apiCoverUrl,
              extractMetaContent(html, ['og:image', 'twitter:image']),
            ].filter(Boolean),
          });
        }
        cid = extractBilibiliCidFromPayload(viewPayload);
        bilibiliSocialMetrics = hasSocialMetrics(buildSocialMetrics(viewPayload))
          ? buildSocialMetrics(viewPayload)
          : bilibiliSocialMetrics;
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
          try {
            const progressiveResponse = await requestUrl({
              url: `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&fnval=0&fourk=0`,
              method: 'GET',
              headers: getSocialRequestHeaders(resolvedUrl),
            });
            progressiveVideoUrl = extractBilibiliProgressiveVideoUrlFromPlayurlPayload(progressiveResponse.json || progressiveResponse.text);
          } catch (progressiveError) {
            // Keep the audio/transcript fallback when Bilibili does not expose a progressive video stream.
          }
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
        mediaUrl: progressiveVideoUrl,
        mediaUrls: progressiveVideoUrl ? [progressiveVideoUrl] : [],
        subtitleText: subtitle.transcription,
        subtitleUrl: subtitle.subtitleUrl,
        source: 'bilibili-subtitle',
        markdown,
        binding,
        title,
        sourceTitle,
        socialMetrics: bilibiliSocialMetrics,
      });
    }

    return this.buildTranscriptRecordFromMedia(record, {
      url,
      platform: 'B站',
      mediaUrl: playurlAudioUrl || extractBilibiliAudioUrlFromHtml(html) || extractSocialMediaUrlFromHtml(html),
      mediaUrls: [progressiveVideoUrl, playurlAudioUrl].filter(Boolean),
      source: 'audio',
      markdown,
      binding,
      title,
      sourceTitle,
      socialMetrics: bilibiliSocialMetrics,
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

  async hydrateWebpageMarkdown(record, rootDir, dateFolder, title, binding = null, options = {}) {
    const signal = options.signal || null;
    throwIfAborted(signal);
    const metadata = record.metadata || {};
    const url = metadata.url || record.content;
    let xiaohongshuRedirectDiagnostic = null;
    let xiaohongshuResolvedUrl = url || '';
    let xiaohongshuResponseStatus = 0;
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
            const imageTokenCount = Number(cloudOpenApiResult.imageTokenCount) || 0;
            const imageTempUrlCount = Object.values(cloudOpenApiResult.imageTmpDownloadUrls || {})
              .filter((value) => /^https?:\/\//i.test(String(value || '').trim()))
              .length;
            const missingImageTempUrlCount = Math.max(0, imageTokenCount - imageTempUrlCount);
            const imageLocalizationErrors = [];
            cleanedCloudOpenApiMarkdown = await this.saveMarkdownRemoteImageAssets(
              cleanedCloudOpenApiMarkdown,
              rootDir,
              dateFolder,
              feishuTitle,
              {
                onError: ({ error }) => {
                  imageLocalizationErrors.push(String(error && (error.message || error) || 'unknown error'));
                },
              },
            );
            return {
              ...record,
              metadata: enrichExtractedWebpageMetadata({
                ...metadata,
                title: feishuTitle,
                markdown: cleanedCloudOpenApiMarkdown,
                conversionStatus: 'success',
                conversionSource: 'feishu-cloud-oauth',
                imageTempUrlMissingCount: missingImageTempUrlCount,
                imageLocalizationFailedCount: imageLocalizationErrors.length,
                imageLocalizationError: imageLocalizationErrors.slice(0, 3).join(' | '),
                conversionNote: [
                  `feishu-cloud-oauth blocks=${cloudOpenApiResult.blockCount || 0}`,
                  imageTokenCount ? `images=${imageTokenCount}` : '',
                  missingImageTempUrlCount ? `image-temp-url-missing=${missingImageTempUrlCount}` : '',
                  cloudOpenApiResult.imageDownloadError ? `image-download: ${cloudOpenApiResult.imageDownloadError}` : '',
                  imageLocalizationErrors.length
                    ? `image-localize-failed=${imageLocalizationErrors.length}: ${imageLocalizationErrors.slice(0, 3).join(' | ')}`
                    : '',
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
        throwIfAborted(signal);
        const redirectResult = shouldResolvePlatformRedirect(url)
          ? await resolveRedirectUrlWithDiagnostics(url)
          : {
            url,
            diagnostic: {
              attempts: [],
              redirectCount: 0,
              usedGetFallback: false,
            },
          };
        throwIfAborted(signal);
        xiaohongshuRedirectDiagnostic = redirectResult.diagnostic;
        const redirectedUrl = redirectResult.url;
        const targetIdentityUrl = isXiaohongshuUrl(url)
          ? resolveXiaohongshuIdentityUrl([redirectedUrl, url])
          : '';
        xiaohongshuResolvedUrl = redirectedUrl;
        const douyinTarget = isDouyinUrl(url) || isDouyinUrl(redirectedUrl)
          ? normalizeDouyinTargetUrl(url, redirectedUrl)
          : { awemeId: '', url: '' };
        let resolvedUrl = douyinTarget.url || redirectedUrl;
        let xiaohongshuBrowserCandidates = isXiaohongshuUrl(url)
          ? getXiaohongshuBrowserCandidates(url, targetIdentityUrl, resolvedUrl)
          : [];
        let primarySocialMediaBrowserUrl = xiaohongshuBrowserCandidates[0]
          ? xiaohongshuBrowserCandidates[0].url
          : resolvedUrl;
        let douyinAwemeId = douyinTarget.awemeId;
        if (shouldBlockExternalAppUrl(resolvedUrl)) {
          throw new Error(`已阻止网页尝试打开外部应用协议：${new URL(resolvedUrl).protocol}`);
        }
        if (isXiaohongshuUrl(url) && !isXiaohongshuUrl(resolvedUrl)) {
          const externalRedirectError = new Error('小红书短链接跳转到了非官方网站，已停止请求');
          externalRedirectError.code = 'XIAOHONGSHU_CONTENT_UNAVAILABLE';
          throw externalRedirectError;
        }
        const headers = getSocialRequestHeaders(resolvedUrl);
        let renderedXiaohongshuPage = null;
        let renderedXiaohongshuUrl = '';
        let renderedXiaohongshuIncludesComments = false;
        let renderedXiaohongshuError = null;
        const xiaohongshuBrowserAttempts = [];
        let response;
        try {
          response = isXiaohongshuUrl(url)
            ? await this.requestXiaohongshuStaticPage(resolvedUrl)
            : (metadata.automaticWebpageExtraction
              ? await requestPublicWebpageText(resolvedUrl, { headers })
              : await requestUrl({ url: resolvedUrl, method: 'GET', headers }));
        } catch (requestError) {
          if (!isXiaohongshuUrl(url)) throw requestError;
          for (const candidate of xiaohongshuBrowserCandidates) {
            throwIfAborted(signal);
            try {
              const candidatePage = await this.renderXiaohongshuPage(candidate.url, {
                includeComments: false,
                expectedUrl: targetIdentityUrl || resolvedUrl,
                signal,
              });
              const candidateFinalUrl = String(candidatePage && candidatePage.url || '').trim();
              if (!isTrustedXiaohongshuCookieUrl(candidateFinalUrl)) {
                throw new Error('隐藏浏览器最终页面不是可信的小红书 HTTPS 内容页');
              }
              renderedXiaohongshuPage = candidatePage;
              renderedXiaohongshuUrl = candidate.url;
              renderedXiaohongshuIncludesComments = false;
              response = {
                status: 200,
                text: String(candidatePage && candidatePage.html || ''),
                url: candidateFinalUrl,
              };
              break;
            } catch (renderError) {
              if (isAbortError(renderError)) throw renderError;
              renderedXiaohongshuError = renderError;
            }
          }
          if (!response) throw renderedXiaohongshuError || requestError;
        }
        if (isXiaohongshuUrl(url)) {
          const responseFinalUrl = String(response && response.url || '').trim();
          if (!isTrustedXiaohongshuCookieUrl(responseFinalUrl)) {
            throw new Error('小红书正文响应的最终地址无法确认为官方 HTTPS 内容页');
          }
          resolvedUrl = responseFinalUrl;
          xiaohongshuResolvedUrl = responseFinalUrl;
          xiaohongshuBrowserCandidates = getXiaohongshuBrowserCandidates(
            url,
            targetIdentityUrl,
            responseFinalUrl,
          );
          primarySocialMediaBrowserUrl = xiaohongshuBrowserCandidates[0]
            ? xiaohongshuBrowserCandidates[0].url
            : resolvedUrl;
        }
        xiaohongshuResponseStatus = Number(response.status) || 0;
        let html = response.text || '';
        let socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdownFromHtml(html, resolvedUrl);
        const hasProAdvancedAccess = isXiaohongshuUrl(url)
          ? await this.hasProFeatureAccess()
          : false;
        let xiaohongshuLoggedIn = false;
        if (isXiaohongshuUrl(url)
          && hasProAdvancedAccess
          && this.settings.xiaohongshuCommentsEnabled !== false) {
          try {
            xiaohongshuLoggedIn = await this.checkXiaohongshuLogin({ signal });
          } catch (error) {
            if (isAbortError(error)) throw error;
            xiaohongshuLoggedIn = false;
          }
        }
        const xiaohongshuCapabilities = getXiaohongshuCapabilityMatrix({
          hasProAccess: hasProAdvancedAccess,
          commentsEnabled: this.settings.xiaohongshuCommentsEnabled !== false,
          imageOcrEnabled: this.settings.xiaohongshuImageOcrEnabled === true,
          isLoggedIn: xiaohongshuLoggedIn,
        });
        // XHS media must come from an identity-bound note payload or the dedicated
        // browser media probe. Scanning the whole landing page can select a
        // recommendation video and lets an oversized feed block the Obsidian thread.
        let mediaUrls = isXiaohongshuUrl(url) || Boolean(douyinAwemeId)
          ? []
          : extractSocialMediaUrlsFromHtml(html);
        let mediaUrl = mediaUrls[0] || '';
        let hasPreciseDouyinMedia = false;
        let douyinSocialMetrics = {};
        let douyinStructuredContent = null;
        if (isDouyinUrl(url) || isDouyinUrl(resolvedUrl)) {
          douyinAwemeId = douyinAwemeId || extractDouyinAwemeId(resolvedUrl) || extractDouyinAwemeId(url);
          for (const shareUrl of getDouyinMobileSharePageUrls(douyinAwemeId)) {
            try {
              const shareResponse = await requestUrl({
                url: shareUrl,
                method: 'GET',
                headers: getDouyinMobileShareRequestHeaders(shareUrl),
              });
              const shareHtml = shareResponse.text || '';
              const shareUrls = extractDouyinMediaUrlsFromShareHtml(shareHtml, douyinAwemeId);
              const shareDetail = extractDouyinDetailFromShareHtml(shareHtml, douyinAwemeId);
              if (shareDetail) {
                const sharePageMetadata = extractWebpageMetadataFromHtml(shareHtml, resolvedUrl);
                douyinStructuredContent = buildDouyinStructuredContent(shareDetail, {
                  title: douyinStructuredContent && douyinStructuredContent.title || sharePageMetadata.title,
                  description: douyinStructuredContent && douyinStructuredContent.description || sharePageMetadata.description,
                  tags: douyinStructuredContent && douyinStructuredContent.tags && douyinStructuredContent.tags.length
                    ? douyinStructuredContent.tags
                    : extractTagsFromText(sharePageMetadata.description, shareHtml),
                  coverUrl: douyinStructuredContent && douyinStructuredContent.coverUrl
                    || normalizeExtractedUrl(extractMetaContent(shareHtml, ['og:image', 'twitter:image'])),
                  socialMetrics: douyinStructuredContent && douyinStructuredContent.socialMetrics
                    || douyinSocialMetrics,
                });
                socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdown({
                  title: douyinStructuredContent.title,
                  description: douyinStructuredContent.description,
                  tags: douyinStructuredContent.tags,
                  imageUrls: [douyinStructuredContent.coverUrl].filter(Boolean),
                });
                if (hasSocialMetrics(douyinStructuredContent.socialMetrics)) {
                  douyinSocialMetrics = douyinStructuredContent.socialMetrics;
                }
              }
              if (shareUrls.length) {
                html = shareHtml;
                const structuredShareMetrics = buildSocialMetrics(shareDetail);
                const shareMetrics = hasSocialMetrics(structuredShareMetrics)
                  ? structuredShareMetrics
                  : extractSocialMetricsFromHtml(shareHtml);
                if (hasSocialMetrics(shareMetrics)) douyinSocialMetrics = shareMetrics;
                mediaUrls = sortMediaUrlsForTranscription([...shareUrls, ...mediaUrls]);
                mediaUrl = mediaUrls[0] || mediaUrl;
                hasPreciseDouyinMedia = true;
                break;
              }
            } catch (shareError) {
              // The share page is an anonymous, cookie-free fast path. Continue with other resolvers.
            }
          }
          if (!hasPreciseDouyinMedia || !hasSocialMetrics(douyinSocialMetrics) || !douyinStructuredContent) {
            for (const detailUrl of getDouyinAwemeDetailUrls(douyinAwemeId)) {
              try {
                // Douyin's rendered page can load recommendation videos; the detail API is pinned to one aweme id.
                const detailResponse = await requestUrl({ url: detailUrl, method: 'GET', headers: getSocialRequestHeaders(detailUrl) });
                const detailPayload = detailResponse.json || JSON.parse(detailResponse.text || '{}');
                if (getDouyinDetailAwemeId(detailPayload) !== douyinAwemeId) continue;
                const detail = detailPayload.aweme_detail || detailPayload.awemeDetail
                  || (Array.isArray(detailPayload.item_list) ? detailPayload.item_list[0] : null);
                const detailPageMetadata = extractWebpageMetadataFromHtml(html, resolvedUrl);
                douyinStructuredContent = buildDouyinStructuredContent(detail, {
                  title: douyinStructuredContent && douyinStructuredContent.title || detailPageMetadata.title,
                  description: douyinStructuredContent && douyinStructuredContent.description || detailPageMetadata.description,
                  tags: douyinStructuredContent && douyinStructuredContent.tags && douyinStructuredContent.tags.length
                    ? douyinStructuredContent.tags
                    : extractTagsFromText(detailPageMetadata.description, html),
                  coverUrl: douyinStructuredContent && douyinStructuredContent.coverUrl
                    || normalizeExtractedUrl(extractMetaContent(html, ['og:image', 'twitter:image'])),
                  socialMetrics: douyinStructuredContent && douyinStructuredContent.socialMetrics
                    || douyinSocialMetrics,
                });
                socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdown({
                  title: douyinStructuredContent.title,
                  description: douyinStructuredContent.description,
                  tags: douyinStructuredContent.tags,
                  imageUrls: [douyinStructuredContent.coverUrl].filter(Boolean),
                });
                if (hasSocialMetrics(douyinStructuredContent.socialMetrics)) {
                  douyinSocialMetrics = douyinStructuredContent.socialMetrics;
                }
                const detailUrls = extractDouyinMediaUrlsFromDetailPayload(detailPayload);
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
          if (douyinAwemeId && (!hasPreciseDouyinMedia || !douyinStructuredContent || !hasSocialMetrics(douyinSocialMetrics))) {
            try {
              const hasLegacyInstanceResolver = Object.prototype.hasOwnProperty.call(this, 'fetchDouyinMediaUrlsWithSession')
                && !Object.prototype.hasOwnProperty.call(this, 'fetchDouyinMediaResolutionWithSession');
              const sessionResolution = !hasLegacyInstanceResolver && typeof this.fetchDouyinMediaResolutionWithSession === 'function'
                ? await this.fetchDouyinMediaResolutionWithSession(resolvedUrl, douyinAwemeId)
                : {
                  mediaUrls: typeof this.fetchDouyinMediaUrlsWithSession === 'function'
                    ? await this.fetchDouyinMediaUrlsWithSession(resolvedUrl, douyinAwemeId)
                    : [],
                  detail: null,
                };
              const sessionUrls = Array.isArray(sessionResolution && sessionResolution.mediaUrls)
                ? sessionResolution.mediaUrls
                : [];
              const sessionDetail = sessionResolution && sessionResolution.detail;
              if (sessionDetail) {
                const detailPageMetadata = extractWebpageMetadataFromHtml(html, resolvedUrl);
                douyinStructuredContent = buildDouyinStructuredContent(sessionDetail, {
                  title: (douyinStructuredContent && douyinStructuredContent.title) || detailPageMetadata.title,
                  description: (douyinStructuredContent && douyinStructuredContent.description) || detailPageMetadata.description,
                  tags: (douyinStructuredContent && douyinStructuredContent.tags && douyinStructuredContent.tags.length)
                    ? douyinStructuredContent.tags
                    : extractTagsFromText(detailPageMetadata.description, html),
                  coverUrl: (douyinStructuredContent && douyinStructuredContent.coverUrl)
                    || normalizeExtractedUrl(extractMetaContent(html, ['og:image', 'twitter:image'])),
                  socialMetrics: (douyinStructuredContent && douyinStructuredContent.socialMetrics) || douyinSocialMetrics,
                });
                socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdown({
                  title: douyinStructuredContent.title,
                  description: douyinStructuredContent.description,
                  tags: douyinStructuredContent.tags,
                  imageUrls: [douyinStructuredContent.coverUrl].filter(Boolean),
                });
                if (hasSocialMetrics(douyinStructuredContent.socialMetrics)) {
                  douyinSocialMetrics = douyinStructuredContent.socialMetrics;
                }
              }
              if (sessionUrls.length) {
                mediaUrls = sortMediaUrlsForTranscription([...sessionUrls, ...mediaUrls]);
                mediaUrl = mediaUrls[0] || mediaUrl;
                hasPreciseDouyinMedia = true;
              }
            } catch (sessionError) {
              // Fall back to hidden browser rendering below.
            }
          }
        }
        const isUnavailableXhs = isXiaohongshuUrl(url)
          && isUnavailableXiaohongshuPage(html, resolvedUrl);
        let isVideoIntent = metadata.webpageMediaType === 'audio_video'
          || isDouyinUrl(url)
          || isDouyinUrl(resolvedUrl)
          || /[?&]type=video\b/i.test(resolvedUrl)
          || /\/video\//i.test(resolvedUrl);
        const shouldIncludeXiaohongshuComments = xiaohongshuCapabilities.comments;
        let extractedXiaohongshu = null;
        let pendingXiaohongshuFailureDiagnostic = null;
        if (isXiaohongshuUrl(url)) {
          if (!isTrustedXiaohongshuCookieUrl(resolvedUrl)) {
            mediaUrls = [];
            mediaUrl = '';
            // A short link may only use an untrusted response to discover a redirect.
            // Never parse its HTML, canonical tag, structured state, or assets as XHS content.
            html = '';
          }
          let xiaohongshuIdentityUrl = resolveXiaohongshuIdentityUrl([
            targetIdentityUrl,
            resolvedUrl,
            url,
          ], html);
          // Raw page HTML can contain recommendation comments from other notes.
          // Comments are therefore accepted only from the identity-bound browser paths below.
          const staticXiaohongshuComments = [];
          extractedXiaohongshu = extractXiaohongshuMarkdownFromHtml(html, xiaohongshuIdentityUrl, metadata.shareText || record.content || '', {
            includeComments: false,
          });
          isVideoIntent = isVideoIntent || extractedXiaohongshu.isVideoNote === true;
          if (extractedXiaohongshu.xiaohongshuPrimaryNoteMatched === true) {
            mediaUrls = extractedXiaohongshu.videoUrl
              ? [extractedXiaohongshu.videoUrl]
              : [];
            mediaUrl = mediaUrls[0] || '';
          }
          const shouldEnrichXiaohongshuGraphicImages = !extractedXiaohongshu.videoUrl && !mediaUrl;
          let bestRenderedXiaohongshuPage = null;
          let bestRenderedXiaohongshuExtraction = null;
          let bestRenderedXiaohongshuHtml = '';
          let bestRenderedXiaohongshuUrl = '';
          let bestRenderedXiaohongshuScore = -1;
          const mergeableXiaohongshuExtractions = [];
          if (scoreXiaohongshuExtraction(extractedXiaohongshu, html, resolvedUrl) >= 0) {
            mergeableXiaohongshuExtractions.push(extractedXiaohongshu);
          }
          if (shouldEnrichXiaohongshuGraphicImages || shouldIncludeXiaohongshuComments) {
            for (const candidate of xiaohongshuBrowserCandidates) {
              throwIfAborted(signal);
              let candidatePage = null;
              try {
                candidatePage = renderedXiaohongshuPage
                  && renderedXiaohongshuUrl === candidate.url
                  && renderedXiaohongshuIncludesComments === false
                  ? renderedXiaohongshuPage
                  : await this.renderXiaohongshuPage(candidate.url, {
                    includeComments: false,
                    expectedUrl: xiaohongshuIdentityUrl,
                    signal,
                  });
                const candidateHtml = String(candidatePage && candidatePage.html || '');
                const candidateFinalUrl = String(candidatePage && candidatePage.url || resolvedUrl);
                if (!isTrustedXiaohongshuCookieUrl(candidateFinalUrl)) {
                  throw new Error('隐藏浏览器最终页面不是可信的小红书 HTTPS 内容页');
                }
                const candidateIdentityUrl = resolveXiaohongshuIdentityUrl([
                  xiaohongshuIdentityUrl,
                  candidatePage && candidatePage.identityUrl,
                  candidateFinalUrl,
                  candidate.url,
                ], candidateHtml);
                const candidateExtraction = extractXiaohongshuMarkdownFromHtml(
                  candidateHtml,
                  candidateIdentityUrl,
                  metadata.shareText || record.content || '',
                  { includeComments: false },
                );
                xiaohongshuBrowserAttempts.push(buildXiaohongshuBrowserAttemptDiagnostic(
                  candidate,
                  candidatePage,
                  candidateExtraction,
                ));
                const candidateScore = scoreXiaohongshuExtraction(
                  candidateExtraction,
                  candidateHtml,
                  candidateIdentityUrl,
                );
                if (candidateScore >= 0) {
                  mergeableXiaohongshuExtractions.push(candidateExtraction);
                }
                const candidateHasExactIdentity = candidateExtraction.xiaohongshuPrimaryNoteMatched === true;
                const bestHasExactIdentity = bestRenderedXiaohongshuExtraction
                  && bestRenderedXiaohongshuExtraction.xiaohongshuPrimaryNoteMatched === true;
                const shouldSelectCandidate = bestRenderedXiaohongshuScore < 0
                  || (candidateHasExactIdentity && !bestHasExactIdentity)
                  || (candidateHasExactIdentity
                    && bestHasExactIdentity
                    && candidateScore > bestRenderedXiaohongshuScore);
                if (shouldSelectCandidate) {
                  bestRenderedXiaohongshuPage = candidatePage;
                  bestRenderedXiaohongshuExtraction = candidateExtraction;
                  bestRenderedXiaohongshuHtml = candidateHtml;
                  bestRenderedXiaohongshuUrl = candidateIdentityUrl;
                  bestRenderedXiaohongshuScore = candidateScore;
                }
              } catch (error) {
                if (isAbortError(error)) throw error;
                renderedXiaohongshuError = error;
                xiaohongshuBrowserAttempts.push(buildXiaohongshuBrowserAttemptDiagnostic(
                  candidate,
                  candidatePage,
                  null,
                  error,
                ));
              }
            }
          }
          if (bestRenderedXiaohongshuPage) {
            renderedXiaohongshuPage = bestRenderedXiaohongshuPage;
            renderedXiaohongshuIncludesComments = false;
          }
          if (bestRenderedXiaohongshuExtraction && bestRenderedXiaohongshuScore >= 0) {
            extractedXiaohongshu = mergeXiaohongshuExtractions(
              mergeableXiaohongshuExtractions,
              bestRenderedXiaohongshuExtraction,
            );
            isVideoIntent = isVideoIntent || extractedXiaohongshu.isVideoNote === true;
            html = bestRenderedXiaohongshuHtml;
            xiaohongshuIdentityUrl = bestRenderedXiaohongshuUrl || xiaohongshuIdentityUrl;
            mediaUrls = extractedXiaohongshu.xiaohongshuPrimaryNoteMatched === true
              ? (extractedXiaohongshu.videoUrl ? [extractedXiaohongshu.videoUrl] : [])
              : mediaUrls;
            mediaUrl = extractedXiaohongshu.xiaohongshuPrimaryNoteMatched === true
              ? (mediaUrls[0] || '')
              : (mediaUrls[0] || mediaUrl);
          }
          const shouldProbeConfirmedXiaohongshuVideo = extractedXiaohongshu.xiaohongshuPrimaryNoteMatched === true
            && extractedXiaohongshu.isVideoNote === true;
          if (!mediaUrl && (
            shouldProbeConfirmedXiaohongshuVideo
            || shouldProbeXiaohongshuMediaFromGenericLanding(extractedXiaohongshu, html, resolvedUrl)
          )) {
            for (const candidate of xiaohongshuBrowserCandidates) {
              throwIfAborted(signal);
              try {
                mediaUrls = sortMediaUrlsForTranscription([
                  ...mediaUrls,
                  ...(await this.renderSocialMediaUrls(candidate.url, { includeComments: false, signal })),
                ]);
                mediaUrl = mediaUrls[0] || '';
                if (mediaUrl) break;
              } catch (renderError) {
                if (isAbortError(renderError)) throw renderError;
                // Keep trying the other browser candidate.
              }
            }
          }
          if (shouldIncludeXiaohongshuComments) {
            try {
              const commentsRenderUrl = bestRenderedXiaohongshuUrl
                || String(bestRenderedXiaohongshuPage && bestRenderedXiaohongshuPage.url || '')
                || resolvedUrl
                || url;
              const commentsPage = await this.renderXiaohongshuPage(commentsRenderUrl, {
                includeComments: true,
                expectedUrl: xiaohongshuIdentityUrl,
                signal,
              });
              const renderedXiaohongshuComments = commentsPage && Array.isArray(commentsPage.comments)
                ? commentsPage.comments
                : [];
              const renderedDiagnosticDetails = commentsPage
                && commentsPage.commentDiagnosticDetails
                && typeof commentsPage.commentDiagnosticDetails === 'object'
                ? commentsPage.commentDiagnosticDetails
                : {};
              const finalizedXiaohongshuComments = finalizeXiaohongshuComments({
                baseMarkdown: extractedXiaohongshu.markdown,
                renderedComments: renderedXiaohongshuComments,
                staticComments: staticXiaohongshuComments,
                diagnosticDetails: renderedDiagnosticDetails,
                limit: XIAOHONGSHU_ROOT_COMMENT_LIMIT,
              });
              extractedXiaohongshu = {
                ...extractedXiaohongshu,
                comments: finalizedXiaohongshuComments.comments,
                markdown: finalizedXiaohongshuComments.markdown,
              };
            } catch (xiaohongshuRenderError) {
              if (isAbortError(xiaohongshuRenderError)) throw xiaohongshuRenderError;
              if (staticXiaohongshuComments.length) {
                const fallbackXiaohongshuComments = finalizeXiaohongshuComments({
                  baseMarkdown: extractedXiaohongshu.markdown,
                  renderedComments: [],
                  staticComments: staticXiaohongshuComments,
                  limit: XIAOHONGSHU_ROOT_COMMENT_LIMIT,
                });
                extractedXiaohongshu = {
                  ...extractedXiaohongshu,
                  comments: fallbackXiaohongshuComments.comments,
                  markdown: fallbackXiaohongshuComments.markdown,
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
          const hasReadableXiaohongshuGraphic = hasReadableXiaohongshuGraphicContent(
            extractedXiaohongshu,
            html,
            xiaohongshuIdentityUrl,
          );
          if (!hasReadableXiaohongshuGraphic
            && !extractedXiaohongshu.videoUrl
            && !mediaUrl) {
            pendingXiaohongshuFailureDiagnostic = buildXiaohongshuFailureDiagnostic({
              manifestVersion: this.manifest && this.manifest.version,
              sourceUrl: url,
              resolvedUrl,
              responseStatus: response.status,
              html,
              extracted: extractedXiaohongshu,
              renderError: renderedXiaohongshuError,
              redirectDiagnostic: redirectResult.diagnostic,
              browserAttempts: xiaohongshuBrowserAttempts,
            });
            if (!isVideoIntent) {
              throw createRetryableXiaohongshuContentError(pendingXiaohongshuFailureDiagnostic);
            }
          }
          const isXiaohongshuVideoNote = Boolean(extractedXiaohongshu.videoUrl || mediaUrl);
          if (xiaohongshuCapabilities.imageOcr && !isVideoIntent && !isXiaohongshuVideoNote) {
            extractedXiaohongshu = await this.enrichXiaohongshuExtractionWithOcr(extractedXiaohongshu, {
              pageUrl: resolvedUrl,
              binding,
            });
          }
          if (hasReadableXiaohongshuGraphic
            && extractedXiaohongshu.isVideoNote !== true
            && (!isVideoIntent || !shouldProbeXiaohongshuMediaFromGenericLanding(
              extractedXiaohongshu,
              html,
              resolvedUrl,
            ))
            && !extractedXiaohongshu.videoUrl
            && !mediaUrl) {
            extractedXiaohongshu = {
              ...extractedXiaohongshu,
              markdown: await this.saveMarkdownRemoteImageAssets(
                extractedXiaohongshu.markdown,
                rootDir,
                dateFolder,
                extractedXiaohongshu.title || title || '小红书图文',
                { sourceUrl: xiaohongshuIdentityUrl },
              ),
            };
            return {
              ...record,
              metadata: {
                ...metadata,
                title: getPreferredXiaohongshuTitle(
                  metadata.title,
                  extractedXiaohongshu.title,
                  getWebpageSourcePrefix(url),
                ),
                author: metadata.author || extractedXiaohongshu.author || '',
                extractedDescription: metadata.extractedDescription || extractedXiaohongshu.description || '',
                extractedKeywords: metadata.extractedKeywords || extractedXiaohongshu.tags || [],
                platform: metadata.platform || '小红书',
                contentCategory: '图文',
                markdown: extractedXiaohongshu.markdown,
                imageUrls: extractedXiaohongshu.imageUrls || [],
                xiaohongshuOcrTextHeavy: Boolean(extractedXiaohongshu.ocrTextHeavy),
                xiaohongshuOcrError: extractedXiaohongshu.ocrError || '',
                socialMetrics: withCapturedSocialMetrics(
                  extractedXiaohongshu.socialMetrics,
                  new Date().toISOString(),
                ),
                videoUrl: '',
                conversionStatus: 'success',
              },
            };
          }
        }
        const socialMediaRenderOptions = isXiaohongshuUrl(url)
          ? { includeComments: false, signal }
          : { signal };
        const allowGenericSocialMediaRender = !(douyinAwemeId && (isDouyinUrl(url) || isDouyinUrl(resolvedUrl)));
        if (!hasPreciseDouyinMedia
          && allowGenericSocialMediaRender
          && isVideoIntent
          && typeof this.renderSocialMediaUrls === 'function') {
          try {
            mediaUrls = sortMediaUrlsForTranscription([
              ...mediaUrls,
              ...(await this.renderSocialMediaUrls(primarySocialMediaBrowserUrl, socialMediaRenderOptions)),
            ]);
            mediaUrl = mediaUrls[0] || mediaUrl;
          } catch (renderError) {
            if (isAbortError(renderError)) throw renderError;
            mediaUrl = mediaUrl || '';
          }
        } else if (!hasPreciseDouyinMedia
          && allowGenericSocialMediaRender
          && !mediaUrl
          && isVideoIntent
          && typeof this.renderSocialMediaUrl === 'function') {
          try {
            mediaUrl = await this.renderSocialMediaUrl(primarySocialMediaBrowserUrl, socialMediaRenderOptions);
            mediaUrls = sortMediaUrlsForTranscription([...mediaUrls, mediaUrl]);
          } catch (renderError) {
            if (isAbortError(renderError)) throw renderError;
            mediaUrl = '';
          }
        }
        if (pendingXiaohongshuFailureDiagnostic && !mediaUrl) {
          throw createRetryableXiaohongshuContentError(pendingXiaohongshuFailureDiagnostic);
        }
        if (mediaUrl) {
          if (isXiaohongshuUrl(url) && !xiaohongshuCapabilities.mediaTranscription) {
            return {
              ...record,
              metadata: buildTranscriptOnlyMetadata(metadata, {
                url,
                platform: '小红书',
                mediaUrl,
                mediaUrls,
                transcription: '',
                transcriptionStatus: 'failed',
                transcriptionError: '小红书音视频转写需要有效 Pro。请先开通 Pro 并刷新插件权限。',
                transcriptionSource: 'pro-required',
                conversionStatus: 'failed',
                markdown: '',
              }),
            };
          }
          const selectedSupplementalMarkdown = isXiaohongshuUrl(url)
            && extractedXiaohongshu
            && String(extractedXiaohongshu.markdown || '').trim()
            ? extractedXiaohongshu.markdown
            : socialMediaSupplementalMarkdown;
          const supplementalMarkdownParts = isXiaohongshuUrl(url)
            ? splitSocialCommentsMarkdown(selectedSupplementalMarkdown)
            : { markdown: selectedSupplementalMarkdown, trailingMarkdown: '' };
          return await this.buildTranscriptRecordFromMedia(record, {
            url,
            platform: isDouyinUrl(url) || isDouyinUrl(resolvedUrl) ? '抖音' : '小红书',
            mediaUrl,
            mediaUrls,
            source: 'video',
            markdown: supplementalMarkdownParts.markdown,
            trailingMarkdown: supplementalMarkdownParts.trailingMarkdown,
            binding,
            title,
            socialMetrics: isXiaohongshuUrl(url)
              ? (extractedXiaohongshu && extractedXiaohongshu.socialMetrics)
              : (douyinStructuredContent && hasSocialMetrics(douyinStructuredContent.socialMetrics)
                ? douyinStructuredContent.socialMetrics
                : (hasSocialMetrics(douyinSocialMetrics)
                  ? douyinSocialMetrics
                  : extractSocialMetricsFromHtml(html))),
            sourceTitle: isXiaohongshuUrl(url)
              ? getPreferredXiaohongshuTitle(metadata.title, extractedXiaohongshu && extractedXiaohongshu.title, '小红书')
              : (douyinStructuredContent && douyinStructuredContent.title
                || extractWebpageMetadataFromHtml(html, resolvedUrl).title),
            noMediaError: isUnavailableXhs
              ? '小红书网页端未返回可转写的视频资源。这通常是该分享链接在电脑网页端不可访问、笔记失效或需要小红书登录环境。请让用户重新复制小红书链接；如果仍失败，建议从手机相册或文件导入视频。'
              : '',
            signal,
          });
        }
        if (isVideoIntent && (isDouyinUrl(url) || isDouyinUrl(resolvedUrl))) {
          const noMediaError = '未能从抖音作品页获取到与目标作品一致的音频或视频地址';
          return {
            ...record,
            metadata: {
              ...metadata,
              title: metadata.title || extractHtmlTitle(html) || '抖音链接',
              url,
              markdown: buildDouyinFallbackMarkdown(url, noMediaError),
              platform: '抖音',
              contentCategory: '视频',
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
            title: isXiaohongshuUrl(url)
              ? getPreferredXiaohongshuTitle(metadata.title, extracted.title, getWebpageSourcePrefix(url))
              : metadata.title || extracted.title || getWebpageSourcePrefix(url),
            author: metadata.author || extracted.author || '',
            extractedDescription: metadata.extractedDescription || extracted.description || '',
            extractedKeywords: metadata.extractedKeywords || extracted.tags || [],
            platform: metadata.platform || '小红书',
            contentCategory: metadata.contentCategory || (extracted.videoUrl || metadata.webpageMediaType === 'audio_video' ? '视频' : '图文'),
            markdown: extracted.markdown,
            imageUrls: extracted.imageUrls || [],
            socialMetrics: withCapturedSocialMetrics(extracted.socialMetrics, new Date().toISOString()),
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
        const response = metadata.automaticWebpageExtraction && !isTrustedAutomaticPlatformUrl(url)
          ? await requestPublicWebpageText(url)
          : await requestUrl({ url, method: 'GET' });
        html = response.text || '';
      } catch (requestError) {
        if (metadata.automaticWebpageExtraction) {
          throw new Error(`网页抓取失败：${requestError.message || requestError}`);
        }
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
      const imageLocalizationErrors = [];
      if (isWechatArticleUrl(url)) {
        markdown = await this.saveMarkdownRemoteImageAssets(
          markdown,
          rootDir,
          dateFolder,
          pageTitle || title || '公众号文章',
          {
            sourceUrl: url,
            onError: ({ error }) => {
              imageLocalizationErrors.push(String(error && (error.message || error) || 'unknown error'));
            },
          },
        );
      }
      const conversionNote = [
        usedFallback ? '已通过备用通道抓取' : '',
        imageLocalizationErrors.length
          ? `image-localize-failed=${imageLocalizationErrors.length}: ${imageLocalizationErrors.slice(0, 3).join(' | ')}`
          : '',
      ].filter(Boolean).join('; ');
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
          conversionNote,
          ...(isWechatArticleUrl(url) ? {
            imageLocalizationFailedCount: imageLocalizationErrors.length,
            imageLocalizationError: imageLocalizationErrors.slice(0, 3).join(' | '),
          } : {}),
        },
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isRetryableTranscriptionError(error) || isRetryableXiaohongshuContentError(error)) {
        throw error;
      }
      if (isXiaohongshuUrl(url)) {
        throw createRetryableXiaohongshuContentError(buildXiaohongshuFailureDiagnostic({
          manifestVersion: this.manifest && this.manifest.version,
          sourceUrl: url,
          resolvedUrl: xiaohongshuResolvedUrl || url,
          responseStatus: xiaohongshuResponseStatus,
          requestError: error,
          redirectDiagnostic: xiaohongshuRedirectDiagnostic,
        }));
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
        const matchesRecordId = Boolean(normalizedRecordId && hasRecordIdInFrontmatter(markdown, normalizedRecordId));
        const matchesRecordUrl = Boolean(normalizedRecordUrl && hasRecordUrlInFrontmatter(markdown, normalizedRecordUrl));
        if (matchesRecordId || matchesRecordUrl) {
          if (!isExistingLocalNoteDeliverable(record, markdown)) {
            continue;
          }
          if (normalizedRecordUrl && isFeishuUrl(normalizedRecordUrl) && shouldRefreshFeishuMarkdownFromSource(normalizedRecordUrl, { markdown })) {
            continue;
          }
          if (shouldBypassExistingLocalNoteDedupe(record) && !matchesRecordId && matchesRecordUrl) {
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
    const signal = progress.signal || null;
    throwIfAborted(signal);
    const dateFolder = getDateFolderName(record.createdAt);
    const rootDir = normalizeConfiguredVaultPath(this.settings.inboxDir);
    const noteDir = normalizeVaultPath(this.settings.noteSaveMode === 'root' ? rootDir : `${rootDir}/${dateFolder}`);
    const bindingLabel = shouldPrefixTitle && binding ? binding.label : '';
    const progressTitle = buildRecordTitleBase(record);
    this.showSyncProgress({ ...progress, stage: 'processing', title: progressTitle });

    await this.ensureFolder(rootDir);
    await this.ensureFolder(noteDir);

    let title = await this.nextRecordTitle(noteDir, record, bindingLabel);
    let recordForMarkdown = record;
    const recordType = String(record.type || '').toLowerCase();
    const linkAsWebpage = recordType === 'link' && shouldHydrateLinkAsWebpage((record.metadata && record.metadata.url) || record.content || '');
    const textWebpageUrl = recordType === 'text'
      ? selectAutomaticWebpageUrlFromText([
        record.content || '',
        record.metadata && record.metadata.url || '',
      ].filter(Boolean).join('\n'))
      : '';
    const textAsWebpage = Boolean(textWebpageUrl);
    if (recordType === 'voice') {
      recordForMarkdown = await this.writeVoiceAttachment(record, rootDir, dateFolder, title, binding, progress);
    } else if (recordType === 'file') {
      recordForMarkdown = await this.writeFileAttachment(record, rootDir, dateFolder, title, binding, progress);
    } else if (recordType === 'webpage' || linkAsWebpage || textAsWebpage) {
      this.showSyncProgress({ ...progress, stage: 'processing', title: progressTitle });
      recordForMarkdown = await this.hydrateWebpageMarkdown(
        linkAsWebpage || textAsWebpage
          ? {
            ...record,
            type: 'webpage',
            metadata: {
              ...(record.metadata || {}),
              url: textAsWebpage
                ? textWebpageUrl
                : (record.metadata && record.metadata.url) || record.content || '',
              ...(textAsWebpage
                ? {
                  shareText: (record.metadata && record.metadata.shareText) || record.content || '',
                  automaticWebpageExtraction: true,
                }
                : {}),
              conversionStatus: (record.metadata && record.metadata.conversionStatus) || 'pending',
            },
          }
          : record,
        rootDir,
        dateFolder,
        title,
        binding,
        { signal },
      );
      throwIfAborted(signal);
      if (textAsWebpage && !isAutomaticWebpageHydrationSuccessful(recordForMarkdown)) {
        throw createAutomaticWebpageExtractionError(textWebpageUrl);
      }
      recordForMarkdown = await this.saveSourceMediaAttachment(recordForMarkdown, rootDir, dateFolder, title);
      title = await this.nextRecordTitle(noteDir, recordForMarkdown, bindingLabel);
    }
    throwIfAborted(signal);
    if (isAudioVideoTranscriptionIncompleteRecord(recordForMarkdown)) {
      const metadata = recordForMarkdown.metadata || {};
      const status = metadata.transcriptionStatus || 'pending';
      throw createRetryableTranscriptionError(metadata.transcriptionError || `audio/video transcription is ${status}`);
    }
    const lifecycleOutcomeError = getSyncLifecycleOutcomeError(recordForMarkdown);
    if (lifecycleOutcomeError) throw lifecycleOutcomeError;
    recordForMarkdown = await this.enrichRecordMetadataWithAi(recordForMarkdown, binding);
    throwIfAborted(signal);
    const noteIdentity = applyTranscriptionNoteIdentity(recordForMarkdown, {
      fallbackTitle: title,
      bindingLabel,
    });
    recordForMarkdown = noteIdentity.record;
    const displayTitle = noteIdentity.displayTitle || title;
    const fileTitle = noteIdentity.titleSource
      ? await this.nextTitle(noteDir, noteIdentity.fileTitle)
      : title;
    const markdown = buildMarkdownForRecord({
      record: recordForMarkdown,
      title: displayTitle,
      syncedAt,
      propertyFields: this.settings.notePropertyFields,
    });
    const filePath = normalizeVaultPath(`${noteDir}/${fileTitle}.md`);
    this.showSyncProgress({ ...progress, stage: 'writing', title: fileTitle });
    const adapter = this.app.vault.adapter;
    const temporaryFilePath = normalizeVaultPath(
      `${noteDir}/.wechat-inbox-sync-${crypto.randomBytes(12).toString('hex')}.tmp`,
    );
    let temporaryFileExists = false;
    try {
      throwIfAborted(signal);
      temporaryFileExists = true;
      await adapter.write(temporaryFilePath, markdown);
      throwIfAborted(signal);
      if (typeof adapter.exists === 'function' && await adapter.exists(filePath)) {
        throw new Error(`笔记目标路径已存在，已停止写入以避免覆盖：${filePath}`);
      }
      if (typeof adapter.getFullPath === 'function') {
        await fs.promises.copyFile(
          adapter.getFullPath(temporaryFilePath),
          adapter.getFullPath(filePath),
          fs.constants.COPYFILE_EXCL,
        );
      } else if (this.app.vault && typeof this.app.vault.create === 'function') {
        await this.app.vault.create(filePath, markdown);
      } else {
        throw new Error('当前 Obsidian 存储适配器不支持原子安全提交笔记');
      }
    } finally {
      if (temporaryFileExists && typeof adapter.remove === 'function') {
        try {
          await adapter.remove(temporaryFilePath);
        } catch (cleanupError) {
          // The unique temporary file is owned by this write and can be cleaned on the next run.
        }
      }
    }

    return {
      recordId: getRecordId(record),
      filePath,
      title: fileTitle,
      committed: true,
      conversionWarning: getRecordConversionWarning(recordForMarkdown),
    };
  }

  async reportSyncLifecycleStatus(recordId, body, binding) {
    return await this.requestJson(
      `/records/${encodeURIComponent(recordId)}/status`,
      'POST',
      body,
      binding,
    );
  }

  async persistPendingSyncLifecycleAttempts(value) {
    const pendingSyncLifecycleAttempts = normalizePendingSyncLifecycleAttempts(value);
    this.settings = {
      ...this.settings,
      pendingSyncLifecycleAttempts,
    };
    if (typeof this.saveData === 'function') {
      await this.saveData(this.settings);
    }
    return pendingSyncLifecycleAttempts;
  }

  async upsertPendingSyncLifecycleAttempt(binding, value = {}) {
    const bindingFingerprint = getSyncLifecycleBindingFingerprint(binding && binding.token);
    const recordId = String(value.recordId || '').trim();
    const attemptId = String(value.attemptId || '').trim();
    if (!bindingFingerprint || !recordId || !attemptId) return null;
    const current = normalizePendingSyncLifecycleAttempts(this.settings.pendingSyncLifecycleAttempts);
    const previous = current.find((item) => (
      item.bindingFingerprint === bindingFingerprint && item.recordId === recordId
    ));
    const now = new Date().toISOString();
    const next = normalizePendingSyncLifecycleAttempts([
      ...current.filter((item) => !(
        item.bindingFingerprint === bindingFingerprint && item.recordId === recordId
      )),
      {
        recordId,
        attemptId,
        bindingFingerprint,
        stage: value.stage || 'processing',
        code: value.code,
        noteTitle: value.noteTitle,
        createdAt: previous && previous.createdAt ? previous.createdAt : now,
        updatedAt: now,
      },
    ]);
    await this.persistPendingSyncLifecycleAttempts(next);
    return next.find((item) => (
      item.bindingFingerprint === bindingFingerprint && item.recordId === recordId
    )) || null;
  }

  async clearPendingSyncLifecycleAttempt(binding, recordId) {
    const bindingFingerprint = getSyncLifecycleBindingFingerprint(binding && binding.token);
    const normalizedRecordId = String(recordId || '').trim();
    if (!bindingFingerprint || !normalizedRecordId) return false;
    const current = normalizePendingSyncLifecycleAttempts(this.settings.pendingSyncLifecycleAttempts);
    const next = current.filter((item) => !(
      item.bindingFingerprint === bindingFingerprint && item.recordId === normalizedRecordId
    ));
    if (next.length === current.length) return false;
    await this.persistPendingSyncLifecycleAttempts(next);
    return true;
  }

  async replayPendingSyncLifecycleAttempts(binding) {
    const bindingFingerprint = getSyncLifecycleBindingFingerprint(binding && binding.token);
    if (!bindingFingerprint) return { replayed: 0, retained: 0 };
    const attempts = normalizePendingSyncLifecycleAttempts(this.settings.pendingSyncLifecycleAttempts)
      .filter((item) => item.bindingFingerprint === bindingFingerprint);
    let replayed = 0;
    for (const item of attempts) {
      try {
        if (item.stage === 'committed') {
          await this.reportSyncRecordCompletion(item.recordId, item.noteTitle || '', binding, {
            enabled: true,
            attemptId: item.attemptId,
          });
        } else {
          await this.reportSyncLifecycleStatus(item.recordId, {
            status: 'failed',
            attemptId: item.attemptId,
            code: item.stage === 'failed' ? (item.code || 'SYNC_FAILED') : 'SYNC_INTERRUPTED',
          }, binding);
        }
        await this.clearPendingSyncLifecycleAttempt(binding, item.recordId);
        replayed += 1;
      } catch (error) {
        if (isRecordNotFoundError(error)
          || isLegacySyncLifecycleError(error)
          || isSyncRecordBusyError(error)) {
          try {
            await this.clearPendingSyncLifecycleAttempt(binding, item.recordId);
          } catch (clearError) {
            // Preserve the marker when local persistence is temporarily unavailable.
          }
        }
      }
    }
    const retained = normalizePendingSyncLifecycleAttempts(this.settings.pendingSyncLifecycleAttempts)
      .filter((item) => item.bindingFingerprint === bindingFingerprint).length;
    return { replayed, retained };
  }

  async claimSyncRecordProcessing(recordId, binding, lifecycleAdvertised) {
    if (!lifecycleAdvertised) return { enabled: false };
    try {
      const payload = await this.reportSyncLifecycleStatus(recordId, { status: 'processing' }, binding);
      const data = payload && payload.data && typeof payload.data === 'object'
        ? payload.data
        : (payload && typeof payload === 'object' ? payload : {});
      const attemptId = String(data.attemptId || data.syncAttemptId || '').trim();
      if (!attemptId) throw new Error('sync processing claim is missing an attempt id');
      return { enabled: true, attemptId };
    } catch (error) {
      if (isLegacySyncLifecycleError(error)) return { enabled: false, legacyFallback: true };
      if (isSyncRecordBusyError(error)) return { enabled: true, conflict: true };
      throw error;
    }
  }

  async reportSyncRecordCompletion(recordId, noteTitle, binding, lifecycle = {}) {
    const safeNoteTitle = sanitizeSyncNoteTitle(noteTitle);
    const body = lifecycle.enabled && lifecycle.attemptId
      ? {
        attemptId: lifecycle.attemptId,
        ...(safeNoteTitle ? { noteTitle: safeNoteTitle } : {}),
      }
      : (lifecycle.legacyFallback && safeNoteTitle ? { noteTitle: safeNoteTitle } : {});
    try {
      return await this.requestJson(
        `/records/${encodeURIComponent(recordId)}/synced`,
        'POST',
        body,
        binding,
      );
    } catch (error) {
      if (!lifecycle.enabled || !isLegacySyncLifecycleError(error)) throw error;
      return await this.requestJson(
        `/records/${encodeURIComponent(recordId)}/synced`,
        'POST',
        safeNoteTitle ? { noteTitle: safeNoteTitle } : {},
        binding,
      );
    }
  }

  async reportSyncRecordCompletionBestEffort(recordId, noteTitle, binding, lifecycle = {}) {
    try {
      await this.reportSyncRecordCompletion(recordId, noteTitle, binding, lifecycle);
      return null;
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      return {
        code: 'COMPLETION_REPORT_FAILED',
        message: 'sync completion report failed; local note is preserved',
      };
    }
  }

  async reportSyncRecordFailure(recordId, attemptId, error, binding) {
    const code = categorizeSyncFailure(error);
    return await this.reportSyncLifecycleStatus(recordId, {
      status: 'failed',
      attemptId,
      code,
    }, binding);
  }

  async syncBinding(binding, shouldPrefixTitle) {
    const bindingLabel = binding && (binding.label || binding.token) ? (binding.label || binding.token) : '';
    await this.replayPendingSyncLifecycleAttempts(binding);
    this.showSyncProgress({ bindingLabel, stage: 'fetching' });
    const payload = await this.requestJson('/records?status=pending', 'GET', {}, binding);
    const records = payload.data || [];
    const pendingReview = normalizePendingReviewSummary(payload && payload.meta && payload.meta.pendingReview);
    const lifecycleAdvertised = Boolean(payload && payload.meta && payload.meta.syncLifecycleStatus === true);
    const written = [];
    const failed = [];
    const skipped = [];
    const conversionWarnings = [];
    const completionWarnings = [];
    const syncedAt = new Date().toISOString();
    if (!records.length) {
      this.showSyncProgress({ bindingLabel, stage: 'empty' });
    }

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const recordId = getRecordId(record);
      const progress = {
        bindingLabel,
        current: index + 1,
        total: records.length,
      };
      let lifecycle = { enabled: false };
      if (this.settings.locallyQuarantinedRecordIds.includes(recordId)) {
        skipped.push({
          recordId,
          reason: 'locally-quarantined-unrecoverable',
        });
        continue;
      }
      if (isCloudTranscriptionWaitingRecord(record)) {
        skipped.push({
          recordId,
          reason: 'cloud-transcription-processing',
        });
        this.showSyncProgress({ ...progress, stage: 'processing', title: `${buildRecordTitleBase(record)} 云端转写中` });
        continue;
      }
      const processingAbortController = new AbortController();
      const processingProgress = {
        ...progress,
        signal: processingAbortController.signal,
      };
      this.currentProcessingAbortController = processingAbortController;
      this.currentProcessingContext = {
        recordId,
        binding: binding ? { ...binding } : null,
        title: buildRecordTitleBase(record),
      };
      this.setTranscriptionStopAvailable(true);
      try {
        throwIfAborted(processingAbortController.signal);
        lifecycle = await this.claimSyncRecordProcessing(recordId, binding, lifecycleAdvertised);
        if (lifecycle.conflict) {
          skipped.push({ recordId, reason: 'record-busy' });
          continue;
        }
        if (lifecycle.enabled && lifecycle.attemptId) {
          await this.upsertPendingSyncLifecycleAttempt(binding, {
            recordId,
            attemptId: lifecycle.attemptId,
            stage: 'processing',
          });
        }
        const existingFilePath = await this.findExistingRecordNotePath(record);
        if (existingFilePath) {
          skipped.push({
            recordId,
            reason: 'already-synced-local',
            filePath: existingFilePath,
          });
          this.showSyncProgress({ ...progress, stage: 'marking', title: buildRecordTitleBase(record) });
          const existingNoteTitle = getSyncNoteTitleFromPath(existingFilePath) || buildRecordTitleBase(record);
          if (lifecycle.enabled && lifecycle.attemptId) {
            await this.upsertPendingSyncLifecycleAttempt(binding, {
              recordId,
              attemptId: lifecycle.attemptId,
              stage: 'committed',
              noteTitle: existingNoteTitle,
            });
          }
          const completionWarning = await this.reportSyncRecordCompletionBestEffort(
            recordId,
            existingNoteTitle,
            binding,
            lifecycle,
          );
          if (completionWarning) completionWarnings.push({ recordId, ...completionWarning });
          else if (lifecycle.enabled && lifecycle.attemptId) {
            await this.clearPendingSyncLifecycleAttempt(binding, recordId);
          }
          continue;
        }
        const item = await this.writeRecord(record, syncedAt, binding, shouldPrefixTitle, processingProgress);
        if (processingAbortController.signal.aborted && !item.committed) {
          throw createAbortError();
        }
        written.push(item);
        if (item.conversionWarning) {
          conversionWarnings.push(item.conversionWarning);
        }
        if (lifecycle.enabled && lifecycle.attemptId) {
          await this.upsertPendingSyncLifecycleAttempt(binding, {
            recordId: item.recordId,
            attemptId: lifecycle.attemptId,
            stage: 'committed',
            noteTitle: item.title,
          });
        }
        this.showSyncProgress({ ...progress, stage: 'marking', title: item.title });
        const completionWarning = await this.reportSyncRecordCompletionBestEffort(
          item.recordId,
          item.title,
          binding,
          lifecycle,
        );
        if (completionWarning) completionWarnings.push({ recordId: item.recordId, ...completionWarning });
        else if (lifecycle.enabled && lifecycle.attemptId) {
          await this.clearPendingSyncLifecycleAttempt(binding, item.recordId);
        }
      } catch (error) {
        const message = error.message || String(error);
        const deletionResult = await this.consumePendingStoppedTranscriptionDelete(getRecordId(record));
        if (deletionResult && deletionResult.deleted) {
          skipped.push({
            recordId: getRecordId(record),
            reason: 'deleted-current-transcription',
          });
          continue;
        }
        if (isPermanentlyExpiredXiaohongshuShortlinkRecord(record, error)) {
          try {
            const receiptPath = await this.writeExpiredXiaohongshuLinkReceipt(record);
            const expiredDeleteResult = await this.deleteCurrentTranscriptionRecord({
              recordId,
              binding,
            });
            if (expiredDeleteResult && expiredDeleteResult.deleted) {
              skipped.push({
                recordId,
                reason: 'deleted-expired-xhs-shortlink',
                receiptPath,
              });
              continue;
            }
          } catch (deleteError) {
            // Keep the original extraction failure retryable if cloud cleanup fails.
          }
        }
        let lifecycleReportError = null;
        if (lifecycle.enabled && lifecycle.attemptId) {
          const failureCode = categorizeSyncFailure(error);
          try {
            await this.upsertPendingSyncLifecycleAttempt(binding, {
              recordId,
              attemptId: lifecycle.attemptId,
              stage: 'failed',
              code: failureCode,
            });
          } catch (persistError) {
            // The in-memory attempt remains available for the immediate report below.
          }
          try {
            await this.reportSyncRecordFailure(recordId, lifecycle.attemptId, error, binding);
            try {
              await this.clearPendingSyncLifecycleAttempt(binding, recordId);
            } catch (clearError) {
              // A retained marker is safe: replay is idempotent and stale attempts are discarded.
            }
          } catch (reportError) {
            lifecycleReportError = {
              code: 'STATUS_REPORT_FAILED',
              message: 'status report failed; original error remains local',
            };
          }
        }

        const diagnostic = error && error.diagnostic && typeof error.diagnostic === 'object'
          ? redactSensitiveObject(error.diagnostic)
          : null;
        let failedTitle = '小红书内容';
        if (!isXiaohongshuUrl(getRecordUrl(record))) {
          try {
            failedTitle = buildRecordTitleBase(record);
          } catch (titleError) {
            failedTitle = getRecordId(record) || String(record && record.type ? record.type : 'unknown');
          }
        }
        this.lastSyncDiagnostic = {
          ...progress,
          status: 'failed',
          stage: progress.stage || 'processing',
          title: failedTitle,
          recordId: getRecordId(record),
          message: '单条内容同步失败',
          error: message,
          ...(diagnostic ? { diagnostic } : {}),
          ...(lifecycleReportError ? { lifecycleReportError } : {}),
          time: new Date().toISOString(),
        };
        writeSyncDiagnosticLog(this.lastSyncDiagnostic, this.getConfiguredLocalAsrInstallRoot());
        failed.push({
          recordId: getRecordId(record),
          message,
          ...(diagnostic ? { diagnostic } : {}),
          ...(lifecycleReportError ? { lifecycleReportError } : {}),
        });
      } finally {
        if (this.currentProcessingAbortController === processingAbortController) {
          this.currentProcessingAbortController = null;
        }
        if (this.currentProcessingContext
          && this.currentProcessingContext.recordId === recordId) {
          this.currentProcessingContext = null;
        }
        if (!this.currentTranscriptionAbortController && !this.currentTranscriptionProcess) {
          this.setTranscriptionStopAvailable(false);
        }
      }
    }

    return { written, failed, skipped, conversionWarnings, completionWarnings, pendingReview };
  }

  async syncInbox(showNotice = true) {
    if (this.syncInboxPromise) {
      if (showNotice) {
        new Notice('同步正在进行中，请等待当前任务完成。', 2500);
      }
      return await this.syncInboxPromise;
    }
    const syncTask = this.runSyncInboxOnce(showNotice);
    this.syncInboxPromise = syncTask;
    try {
      return await syncTask;
    } finally {
      if (this.syncInboxPromise === syncTask) {
        this.syncInboxPromise = null;
      }
    }
  }

  async runSyncInboxOnce(showNotice = true) {
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
      const completionWarnings = [];
      const pendingReviews = [];
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
          if (result.completionWarnings && result.completionWarnings.length) {
            completionWarnings.push(...result.completionWarnings);
          }
          if (result.pendingReview && (result.pendingReview.total || result.pendingReview.audioVideoCount)) {
            pendingReviews.push(result.pendingReview);
          }
        } catch (error) {
          const message = error.message || String(error);
          if (isBindingInvalidMessage(message)) {
            // eslint-disable-next-line no-await-in-loop
            const actionMessage = await this.markBindingNeedsRebind(binding, message);
            if (actionMessage) conversionWarnings.push(actionMessage);
            continue;
          }
          failed.push({
            recordId: binding.label || binding.token,
            message: `${binding.label || binding.token}：${message}`,
          });
        }
      }

      let finalMessage = buildSyncResultNotice(written, skipped, conversionWarnings, failed);
      const pendingReviewNotice = buildPendingReviewNotice(mergePendingReviewSummaries(pendingReviews));
      if (!written.length && !failed.length && pendingReviewNotice) {
        finalMessage = pendingReviewNotice;
      } else if (pendingReviewNotice) {
        finalMessage += `；${pendingReviewNotice}`;
      }
      if (completionWarnings.length) {
        finalMessage += `；本地笔记已保存，但 ${completionWarnings.length} 条同步状态回报失败，请稍后再次点击同步补报状态`;
      }

      if (showNotice || written.length) {
        new Notice(finalMessage);
      }
      this.lastSyncDiagnostic = {
        status: failed.length ? 'failed' : (completionWarnings.length ? 'warning' : 'success'),
        stage: 'finished',
        current: written.length,
        total: written.length + failed.length + skipped.length,
        message: finalMessage,
        error: failed.length ? failed.map((item) => `${item.recordId}: ${item.message}`).join('\n') : '',
        completionWarningCount: completionWarnings.length,
        completionWarningCode: completionWarnings.length ? 'COMPLETION_REPORT_FAILED' : '',
        ...(failed.find((item) => item.diagnostic)
          ? { diagnostic: failed.find((item) => item.diagnostic).diagnostic }
          : {}),
        time: new Date().toISOString(),
      };
      writeSyncDiagnosticLog(this.lastSyncDiagnostic, this.getConfiguredLocalAsrInstallRoot());
      this.clearSyncProgressNotice();
    } catch (error) {
      this.lastSyncDiagnostic = {
        status: 'failed',
        stage: 'syncInbox',
        message: '同步失败',
        error: error.message || String(error),
        time: new Date().toISOString(),
      };
      writeSyncDiagnosticLog(this.lastSyncDiagnostic, this.getConfiguredLocalAsrInstallRoot());
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
    const primaryBinding = bindings.find((item) => (
      item.enabled !== false
      && item.status !== 'unbound'
      && item.status !== 'needs_rebind'
    )) || null;
    const nonPrimaryBindings = bindings.filter((item) => (
      !primaryBinding || item.token !== primaryBinding.token
    ));
    const needsRebindBindings = nonPrimaryBindings.filter((item) => item.status === 'needs_rebind');
    const extraBindings = nonPrimaryBindings.filter((item) => item.status !== 'needs_rebind');
    const renderBindingSetting = (parentEl, binding, indexLabel) => {
      const isUnbound = binding.status === 'unbound';
      const needsRebind = binding.status === 'needs_rebind';
      const statusDesc = needsRebind
        ? (binding.lastError || '绑定码已失效，请重新生成绑定码后重新绑定。')
        : (isUnbound
          ? `已解除/已失效${binding.lastError ? `：${binding.lastError}` : ''}`
          : (binding.enabled === false ? '已暂停同步' : '同步时会拉取这个微信里的收集内容'));
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
        .addToggle((toggle) => {
          toggle
            .setValue(binding.enabled !== false)
            .onChange(async (value) => {
              if (isUnbound || needsRebind) return;
              const nextBindings = normalizeBindings(this.plugin.settings).map((item) => (
                item.token === binding.token ? { ...item, enabled: value, status: value ? 'bound' : 'paused' } : item
              ));
              await this.plugin.saveSettings({ ...this.plugin.settings, bindings: nextBindings });
              this.display();
            });
          if (isUnbound || needsRebind) toggle.setDisabled(true);
        })
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

    const renderedProStatusFingerprint = getProEntitlementStatusFingerprint(
      this.plugin.settings.localTranscriptionEntitlementStatus,
    );
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
              const proAccessNotice = `Pro 权限有效${status.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : ''}`;
              if (status.localComponentInstallError) {
                new Notice(`${proAccessNotice}；但本地转写组件安装/修复失败，请按弹窗提示处理后重试。`, 8000);
              } else {
                new Notice(proAccessNotice);
              }
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

    new Setting(proPanel)
      .setName('保存原始音视频到本地')
      .setDesc('Pro 功能。默认关闭；开启后，新同步且可下载的音频或视频会保存到“音视频附件/日期”目录，并在笔记中插入本地链接；无法下载时仍会保留转写结果。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.saveOriginalMediaEnabled === true)
        .onChange(async (value) => {
          if (!value) {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              saveOriginalMediaEnabled: false,
            });
            return;
          }
          try {
            await this.plugin.ensureProFeatureAccess('保存原始音视频到本地', { forceRefresh: true });
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              saveOriginalMediaEnabled: true,
            });
          } catch (error) {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              saveOriginalMediaEnabled: false,
            });
            new Notice(error.message || String(error));
            this.display();
          }
        }));

    new Setting(proPanel)
      .setName('启用小红书图片 OCR')
      .setDesc('Pro 功能，默认关闭。开启后，后续同步的小红书图文会识别图片中的文字；关闭时仍会保存正文和图片，不会启动 OCR。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.xiaohongshuImageOcrEnabled === true)
        .onChange(async (value) => {
          if (!value) {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              xiaohongshuImageOcrEnabled: false,
              xiaohongshuImageOcrConsentVersion: 1,
            });
            return;
          }
          try {
            await this.plugin.ensureProFeatureAccess('小红书图片 OCR', { forceRefresh: true });
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              xiaohongshuImageOcrEnabled: true,
              xiaohongshuImageOcrConsentVersion: 1,
            });
          } catch (error) {
            await this.plugin.saveSettings({
              ...this.plugin.settings,
              xiaohongshuImageOcrEnabled: false,
              xiaohongshuImageOcrConsentVersion: 1,
            });
            new Notice(error.message || String(error));
            this.display();
          }
        }));

    proPanel.createDiv({
      text: 'AI 简介与关键词自动生成：已默认开启。小红书图片 OCR 默认关闭，按需手动开启。',
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
    needsRebindBindings.forEach((binding, index) => {
      renderBindingSetting(extraBindingsPanel, binding, `需重新绑定微信 ${index + 1}`);
    });
    const canAcceptExtraBinding = bindings.length < MAX_PLUGIN_BINDINGS
      || bindings.some((item) => item.status === 'needs_rebind');
    new Setting(extraBindingsPanel)
      .setName('绑定额外设备')
      .setDesc(!canAcceptExtraBinding
        ? `已达到上限：最多绑定 ${MAX_PLUGIN_BINDINGS} 个小程序码。`
        : '先确认 Pro 仍在有效期内，再把新的小程序绑定码绑定到当前插件。')
      .addText((text) => text
        .setPlaceholder('例如 ABC-123')
        .setValue(this.plugin.settings.pendingBindCode || '')
        .setDisabled(!canAcceptExtraBinding)
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
    this.plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: 'settings-open' })
      .then(() => {
        const currentProStatusFingerprint = getProEntitlementStatusFingerprint(
          this.plugin.settings.localTranscriptionEntitlementStatus,
        );
        if (currentProStatusFingerprint !== renderedProStatusFingerprint) {
          this.display();
        }
      })
      .catch((error) => {
        new Notice(`Pro 自动能力检查失败：${error.message || error}`);
      });
  }
}

WechatObsidianInboxPlugin.__test = {
  categorizeSyncFailure,
  getSyncLifecycleBindingFingerprint,
  getSyncLifecycleOutcomeError,
  isExistingLocalNoteDeliverable,
  normalizePendingSyncLifecycleAttempts,
  sanitizeSyncNoteTitle,
  XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
  XIAOHONGSHU_COMMENT_TIMEOUT_MS,
  FEISHU_TUTORIAL_URL,
  FEISHU_OFFICIAL_API_TUTORIAL_URL,
  MAX_PLUGIN_BINDINGS,
  LOCAL_TRANSCRIPTION_PLAN,
  LOCAL_OCR_WINDOWS_INSTALLER_SHA256,
  LOCAL_OCR_MACOS_INSTALLER_SHA256,
  LOCAL_ASR_INSTALLER_URL,
  LOCAL_ASR_MACOS_INSTALLER_URL,
  LOCAL_OCR_INSTALLER_URL,
  LOCAL_OCR_MACOS_INSTALLER_URL,
  LOCAL_OCR_BATCH_RUNNER_VERSION,
  LOCAL_OCR_BATCH_RUNNER_SOURCE,
  isLocalAsrInstallerCurrent,
  isLocalOcrInstallerCurrent,
  isTrustedLocalOcrInstallerSource,
  completePendingLocalOcrSwitch,
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
  getProEntitlementStatusFingerprint,
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
  getXiaohongshuTargetNoteId,
  isGenericXiaohongshuLandingExtraction,
  hasReadableXiaohongshuGraphicContent,
  shouldStopWaitingForXiaohongshuContent,
  rememberXiaohongshuObservedIdentity,
  installXiaohongshuIdentityObserver,
  selectXiaohongshuBrowserSnapshot,
  extractSocialCommentsFromHtml,
  collectXiaohongshuCommentPages,
  mergeXiaohongshuReplyPages,
  mergeXiaohongshuCapturedCommentPayloads,
  mergeXiaohongshuCommentSources,
  preserveXiaohongshuPrimaryCommentTree,
  finalizeXiaohongshuComments,
  didXiaohongshuRootCollectionProgress,
  getXiaohongshuCommentBudgetState,
  buildXiaohongshuCommentDiagnostic,
  appendXiaohongshuCommentDiagnostic,
  getXiaohongshuCommentPaginationScript,
  buildSocialCommentsMarkdown,
  getSocialCommentTreeStats,
  limitSocialCommentTreeTotal,
  getSocialCommentMarkdownStats,
  getXiaohongshuCapturedRequestBody,
  getXiaohongshuCapturedResponseText,
  isXiaohongshuCommentApiUrl,
  isXiaohongshuSubCommentApiUrl,
  classifyXiaohongshuCommentRequestIdentity,
  collectXiaohongshuNoteImageUrls,
  appendXiaohongshuOcrMarkdown,
  buildXiaohongshuOcrMarkdown,
  isXiaohongshuTextDominantOcrItem,
  isLikelyImageTextNote,
  mergeXiaohongshuOcrText,
  normalizeXiaohongshuOcrMetrics,
  normalizeXiaohongshuOcrItems,
  XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS,
  buildWebpageMarkdownBody,
  buildFileMarkdownBody,
  buildSourceMediaAttachmentMarkdown,
  buildMarkdownForRecord,
  buildNoteOutputPlan,
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
  normalizeDouyinTargetUrl,
  getDouyinMobileSharePageUrls,
  extractDouyinMediaUrlsFromShareHtml,
  extractDouyinMediaUrlsFromDetailPayload,
  extractDouyinMediaUrlsForAweme,
  fetchDouyinMediaResolutionWithSession,
  fetchDouyinMediaUrlsWithSession,
  buildDouyinStructuredContent,
  isUnavailableXiaohongshuPage,
  normalizeBrowserCapturedMediaUrls,
  shouldBlockExternalAppUrl,
  installDouyinExternalProtocolHandlers,
  installExternalAppNavigationGuards,
  isAllowedXiaohongshuBrowserNavigationUrl,
  shouldBlockXiaohongshuBrowserNavigationRequest,
  installXiaohongshuNavigationGuards,
  installXiaohongshuLoginWindowGuards,
  trackXiaohongshuBrowserWindow,
  bindBrowserWindowToAbortSignal,
  closeActiveXiaohongshuBrowserWindows,
  enableDebuggerNetworkCapture,
  beginBestEffortBrowserLoad,
  waitForBrowserTasksWithin,
  runBrowserTaskWithTimeout,
  sortMediaUrlsForTranscription,
  cleanDisplayUrl,
  isWechatMpArticleUrl,
  shouldHydrateLinkAsWebpage,
  selectAutomaticWebpageUrlFromText,
  requestPublicWebpageText,
  getSafeRedirectRequestHeaders,
  normalizeConfiguredVaultPath,
  shouldPersistNormalizedInboxDir,
  extractBilibiliSubtitleUrlsFromHtml,
  parseBilibiliSubtitlePayload,
  extractBilibiliAudioUrlFromPlayurlPayload,
  extractBilibiliProgressiveVideoUrlFromPlayurlPayload,
  hasVideoTrackInMediaBuffer,
  cleanTrailingTranscriptionHallucinations,
  buildAudioTranscriptMarkdown,
  buildTranscriptPropertyMetadata,
  buildTranscriptOnlyMetadata,
  buildSyncProgressMessage,
  buildSyncDiagnosticLogText,
  buildSyncResultNotice,
  buildSkippedSyncNotice,
  getRecordConversionWarning,
  buildConversionWarningsNotice,
  parseLocalAsrProgressLog,
  buildLocalAsrProgressKey,
  getTranscriptionQualityIssue,
  createTranscriptionQualityError,
  assertUsableTranscription,
  createRetryableTranscriptionError,
  isRetryableTranscriptionError,
  getPluginRuntimeIdentity,
  getSafeUrlDiagnostic,
  getXiaohongshuCapabilityMatrix,
  runWithXiaohongshuBrowserSessionLock,
  getXiaohongshuBrowserCandidates,
  scoreXiaohongshuExtraction,
  mergeXiaohongshuExtractions,
  buildXiaohongshuBrowserAttemptDiagnostic,
  isXiaohongshuShareBoilerplateOnly,
  classifyXiaohongshuPage,
  buildXiaohongshuFailureDiagnostic,
  createRetryableXiaohongshuContentError,
  isRetryableXiaohongshuContentError,
  isPermanentlyExpiredXiaohongshuShortlinkRecord,
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
  buildXiaohongshuLoginPageConfig,
  isAbortedBrowserNavigationError,
  isXiaohongshuUrl,
  isTrustedXiaohongshuCookieUrl,
  isTrustedXiaohongshuTransportUrl,
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
  resolveRedirectUrlWithDiagnostics,
  resolveRedirectUrl,
  isRequestUrlTransportError,
  requestJsonViaNode,
  isBindingInvalidMessage,
  validateSettings,
  mergeSettings,
  normalizeBindings,
  normalizeLocallyQuarantinedRecordIds,
  normalizeApiBase,
  normalizeBindCodeInput,
  pad2,
  getChinaTimeParts,
  getDateFolderName,
  formatCreatedTime,
  getTitleTimePart,
};

module.exports = WechatObsidianInboxPlugin;
