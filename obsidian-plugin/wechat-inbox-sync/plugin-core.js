const LEGACY_OFFICIAL_SYNC_API_BASES = [
  'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync',
];
const OFFICIAL_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync';
const MAX_PLUGIN_BINDINGS = 3;
const LOCAL_ASR_HOME = '.wechat-inbox-local-asr';
const NOTE_SAVE_MODES = {
  date: '按日期创建子目录',
  root: '直接保存到根目录',
};
const DEFAULT_NOTE_PROPERTY_FIELDS = 'title,author,url,synced_at,source,description,keywords';
const NOTE_PROPERTY_FIELD_KEYS = [
  'id',
  'type',
  'title',
  'author',
  'created_at',
  'synced_at',
  'source',
  'description',
  'keywords',
  'status',
  'url',
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
  bindings: [],
  clientId: '',
  inboxDir: '临时收集',
  noteSaveMode: 'date',
  notePropertyFields: DEFAULT_NOTE_PROPERTY_FIELDS,
  autoSyncOnLoad: false,
  aiProvider: 'off',
  aiMetadataEnabled: true,
  xiaohongshuCommentsEnabled: true,
  xiaohongshuImageOcrEnabled: true,
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

const AI_PROVIDER_NAMES = {
  off: '关闭转写',
  local: '本地转写命令',
  aliyun: '阿里云百炼 Qwen-Omni',
  doubao: '豆包语音识别',
  tencent: '腾讯云 ASR 录音文件识别',
};

function createClientId() {
  return `obsidian-${require('crypto').randomBytes(16).toString('hex')}`;
}

function getLocalAsrPlatform(platform = process.platform) {
  if (platform === 'win32') return 'win32';
  if (platform === 'darwin') return 'darwin';
  return platform || '';
}

function normalizeLocalAsrPlatform(value) {
  return ['auto', 'win32', 'darwin'].includes(String(value || '').trim())
    ? String(value || '').trim()
    : 'auto';
}

function resolveLocalAsrPlatform(value, runtimePlatform = process.platform) {
  const normalized = normalizeLocalAsrPlatform(value);
  return normalized === 'auto' ? getLocalAsrPlatform(runtimePlatform) : normalized;
}

function getDefaultLocalTranscriptionCommand(platform = process.platform) {
  if (getLocalAsrPlatform(platform) === 'darwin') {
    return `/bin/bash "$HOME/${LOCAL_ASR_HOME}/transcribe.sh" --input {input} --output {output}`;
  }
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\${LOCAL_ASR_HOME}\\transcribe.ps1" -InputPath {input} -OutputPath {output}`;
}

function isWindowsLocalAsrCommand(command) {
  const normalized = String(command || '').toLowerCase();
  return normalized.includes('powershell')
    && (normalized.includes('transcribe.ps1') || normalized.includes(LOCAL_ASR_HOME));
}

function normalizeLocalTranscriptionCommand(command, platform = process.platform) {
  const normalized = String(command || '')
    .trim()
    .replace(/\$env:USERPROFILE/gi, '%USERPROFILE%');
  if (getLocalAsrPlatform(platform) === 'darwin' && isWindowsLocalAsrCommand(normalized)) {
    return getDefaultLocalTranscriptionCommand(platform);
  }
  return normalized;
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

function getPrimaryBoundToken(bindings) {
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

function mergeSettings(savedSettings, platform = process.platform) {
  const sourceSettings = savedSettings && typeof savedSettings === 'object' ? savedSettings : {};
  const savedSettingsVersion = Number(sourceSettings.settingsVersion) || 0;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...sourceSettings,
  };

  merged.apiBase = normalizeApiBase(merged.apiBase);
  merged.bindings = normalizeBindings(merged);
  const normalizedToken = normalizeBindCodeInput(merged.token);
  const tokenBinding = merged.bindings.find((item) => item.token === normalizedToken && item.status !== 'unbound');
  merged.token = tokenBinding ? normalizedToken : getPrimaryBoundToken(merged.bindings);
  merged.pendingBindCode = normalizeBindCodeInput(merged.pendingBindCode);
  merged.pendingRedeemCode = normalizeBindCodeInput(merged.pendingRedeemCode);
  merged.localTranscriptionEntitlementStatus = merged.localTranscriptionEntitlementStatus
    && typeof merged.localTranscriptionEntitlementStatus === 'object'
    && !Array.isArray(merged.localTranscriptionEntitlementStatus)
    ? merged.localTranscriptionEntitlementStatus
    : null;
  merged.clientId = String(merged.clientId || '').trim() || createClientId();
  merged.inboxDir = String(merged.inboxDir || '').trim() || DEFAULT_SETTINGS.inboxDir;
  merged.noteSaveMode = normalizeNoteSaveMode(merged.noteSaveMode);
  merged.notePropertyFields = DEFAULT_NOTE_PROPERTY_FIELDS;
  merged.autoSyncOnLoad = Boolean(merged.autoSyncOnLoad);
  merged.aiProvider = AI_PROVIDER_NAMES[merged.aiProvider] ? merged.aiProvider : DEFAULT_SETTINGS.aiProvider;
  merged.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  merged.aiMetadataEnabled = true;
  merged.xiaohongshuCommentsEnabled = savedSettingsVersion < 2
    ? true
    : merged.xiaohongshuCommentsEnabled !== false;
  merged.xiaohongshuImageOcrEnabled = true;
  merged.deepseekApiKey = String(merged.deepseekApiKey || '').trim();
  merged.deepseekModel = String(merged.deepseekModel || '').trim() || DEFAULT_SETTINGS.deepseekModel;
  merged.deepseekBaseUrl = String(merged.deepseekBaseUrl || '').trim() || DEFAULT_SETTINGS.deepseekBaseUrl;
  merged.cloudPreTranscriptionEnabled = Boolean(merged.cloudPreTranscriptionEnabled);
  const cloudPreTranscriptionThresholdMinutes = Number(merged.cloudPreTranscriptionThresholdMinutes);
  merged.cloudPreTranscriptionThresholdMinutes = [10, 30, 60].includes(cloudPreTranscriptionThresholdMinutes)
    ? cloudPreTranscriptionThresholdMinutes
    : DEFAULT_SETTINGS.cloudPreTranscriptionThresholdMinutes;
  merged.localAsrPlatform = normalizeLocalAsrPlatform(merged.localAsrPlatform);
  merged.localAsrInstallMode = ['default', 'safe'].includes(String(merged.localAsrInstallMode || '').trim())
    ? String(merged.localAsrInstallMode || '').trim()
    : DEFAULT_SETTINGS.localAsrInstallMode;
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

function buildSyncNotice(count) {
  return count ? `已同步 ${count} 条内容到 Obsidian` : '没有需要同步的新内容';
}

module.exports = {
  AI_PROVIDER_NAMES,
  DEFAULT_SETTINGS,
  MAX_PLUGIN_BINDINGS,
  NOTE_PROPERTY_FIELD_KEYS,
  NOTE_SAVE_MODES,
  OFFICIAL_SYNC_API_BASE,
  buildSyncNotice,
  canAddPluginBinding,
  createClientId,
  getDefaultLocalTranscriptionCommand,
  getLocalAsrPlatform,
  mergeSettings,
  normalizeBindCodeInput,
  normalizeBindings,
  normalizeApiBase,
  normalizeLocalAsrPlatform,
  normalizeLocalTranscriptionCommand,
  normalizeNotePropertyFields,
  normalizeNoteSaveMode,
  resolveLocalAsrPlatform,
  validateSettings,
};
