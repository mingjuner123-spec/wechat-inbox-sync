const OFFICIAL_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';
const MAX_PLUGIN_BINDINGS = 3;

const DEFAULT_SETTINGS = {
  apiBase: OFFICIAL_SYNC_API_BASE,
  token: '',
  pendingBindCode: '',
  bindings: [],
  clientId: '',
  inboxDir: '临时收集',
  autoSyncOnLoad: false,
  aiProvider: 'off',
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

function normalizeLocalTranscriptionCommand(command) {
  return String(command || '')
    .trim()
    .replace(/\$env:USERPROFILE/gi, '%USERPROFILE%');
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

function getPrimaryBoundToken(bindings) {
  const active = (Array.isArray(bindings) ? bindings : [])
    .find((item) => item && item.enabled !== false && item.status !== 'unbound' && item.token);
  return active ? active.token : '';
}

function mergeSettings(savedSettings) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(savedSettings || {}),
  };

  merged.apiBase = String(merged.apiBase || '').trim() || DEFAULT_SETTINGS.apiBase;
  merged.bindings = normalizeBindings(merged);
  const normalizedToken = normalizeBindCodeInput(merged.token);
  const tokenBinding = merged.bindings.find((item) => item.token === normalizedToken && item.status !== 'unbound');
  merged.token = tokenBinding ? normalizedToken : getPrimaryBoundToken(merged.bindings);
  merged.pendingBindCode = normalizeBindCodeInput(merged.pendingBindCode);
  merged.clientId = String(merged.clientId || '').trim() || createClientId();
  merged.inboxDir = String(merged.inboxDir || '').trim() || DEFAULT_SETTINGS.inboxDir;
  merged.autoSyncOnLoad = Boolean(merged.autoSyncOnLoad);
  merged.aiProvider = AI_PROVIDER_NAMES[merged.aiProvider] ? merged.aiProvider : DEFAULT_SETTINGS.aiProvider;
  merged.localTranscriptionCommand = normalizeLocalTranscriptionCommand(merged.localTranscriptionCommand);
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

  if (settings.aiProvider === 'tencent') {
    if (!settings.tencentSecretId) errors.push('请填写腾讯云 SecretId');
    if (!settings.tencentSecretKey) errors.push('请填写腾讯云 SecretKey');
  }
  if (settings.aiProvider === 'aliyun') {
    if (!settings.aliyunApiKey) errors.push('请填写阿里云百炼 API Key');
  }
  if (settings.aiProvider === 'doubao') {
    if (!settings.doubaoAsrApiKey) errors.push('请填写豆包语音识别 API Key');
  }
  if (settings.aiProvider === 'local') {
    if (!settings.localTranscriptionCommand) errors.push('请填写本地转写命令');
  }

  return errors;
}

function buildSyncNotice(count) {
  return count ? `已同步 ${count} 条内容到 Obsidian` : '没有需要同步的新内容';
}

module.exports = {
  AI_PROVIDER_NAMES,
  DEFAULT_SETTINGS,
  MAX_PLUGIN_BINDINGS,
  OFFICIAL_SYNC_API_BASE,
  buildSyncNotice,
  createClientId,
  mergeSettings,
  normalizeBindCodeInput,
  normalizeBindings,
  normalizeLocalTranscriptionCommand,
  validateSettings,
};
