const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { Notice, Plugin, PluginSettingTab, Setting, requestUrl } = require('obsidian');

const OFFICIAL_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';
const FEISHU_TUTORIAL_URL = 'https://my.feishu.cn/wiki/EPHhwqRobijHqfkAqjMcDEgvnlf?from=from_copylink';
const MAX_PLUGIN_BINDINGS = 3;
const LOCAL_TRANSCRIPTION_PLAN = 'local_transcription_beta';
const LOCAL_ASR_INSTALLER_URL = 'https://raw.githubusercontent.com/mingjuner123-spec/wechat-inbox-sync/main/local-asr/install-local-asr.ps1';
const LOCAL_ASR_MACOS_INSTALLER_URL = 'https://raw.githubusercontent.com/mingjuner123-spec/wechat-inbox-sync/main/local-asr/install-local-asr-macos.sh';

const DEFAULT_SETTINGS = {
  apiBase: OFFICIAL_SYNC_API_BASE,
  token: '',
  pendingBindCode: '',
  localTranscriptionEntitlementStatus: null,
  bindings: [],
  clientId: '',
  inboxDir: '临时收集',
  autoSyncOnLoad: true,
  aiProvider: 'off',
  localAsrPlatform: 'auto',
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
  local: '本地转写',
  aliyun: '阿里云百炼 Qwen-Omni',
  doubao: '豆包语音识别',
  tencent: '腾讯云 ASR 录音文件识别',
};

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
const DOUBAO_ASR_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const DOUBAO_ASR_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
const DOUBAO_ASR_RESOURCE_ID = 'volc.seedasr.auc';
const ALIYUN_TRANSCRIPTION_PROMPT = '请逐字转写这段音频，只输出转写文本，不要摘要，不要解释，不要使用 Markdown。';
const LOCAL_ASR_HOME = '.wechat-inbox-local-asr';

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

function getDefaultLocalTranscriptionCommand(platform = os.platform()) {
  if (getLocalAsrPlatform(platform) === 'darwin') {
    return `/bin/bash "$HOME/${LOCAL_ASR_HOME}/transcribe.sh" --input {input} --output {output}`;
  }
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\${LOCAL_ASR_HOME}\\transcribe.ps1" -InputPath {input} -OutputPath {output}`;
}

function getLocalAsrInstallRoot(homeDir = os.homedir()) {
  return path.join(homeDir, LOCAL_ASR_HOME);
}

function joinLocalAsrPath(platform, ...segments) {
  if (getLocalAsrPlatform(platform) === 'darwin') {
    const [first, ...rest] = segments;
    return [
      String(first || '').replace(/\/+$/g, ''),
      ...rest.map((segment) => String(segment || '').replace(/^\/+|\/+$/g, '')),
    ].filter(Boolean).join('/');
  }
  return path.join(...segments);
}

function hasFileRecursive(rootDir, predicate) {
  try {
    if (!fs.existsSync(rootDir)) return false;
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isFile() && predicate(fullPath, entry.name)) return true;
      if (entry.isDirectory() && hasFileRecursive(fullPath, predicate)) return true;
    }
  } catch (error) {
    return false;
  }
  return false;
}

function getLocalAsrInstallStatus(installRoot = getLocalAsrInstallRoot(), exists = fs.existsSync, platform = os.platform()) {
  const isMac = getLocalAsrPlatform(platform) === 'darwin';
  const transcribeScript = joinLocalAsrPath(platform, installRoot, isMac ? 'transcribe.sh' : 'transcribe.ps1');
  const modelPath = joinLocalAsrPath(platform, installRoot, 'models', 'ggml-small.bin');
  const hasTranscribeScript = exists(transcribeScript);
  const hasModel = exists(modelPath);
  const whisperNames = isMac ? ['whisper-cli', 'main'] : ['whisper-cli.exe', 'main.exe'];
  const ffmpegName = isMac ? 'ffmpeg' : 'ffmpeg.exe';
  const hasWhisper = exists(joinLocalAsrPath(platform, installRoot, 'bin', 'whisper-cli'))
    || exists(joinLocalAsrPath(platform, installRoot, 'whisper', whisperNames[0]))
    || exists(joinLocalAsrPath(platform, installRoot, 'whisper', whisperNames[1]))
    || (exists === fs.existsSync && hasFileRecursive(path.join(installRoot, 'whisper'), (filePath, name) => whisperNames.includes(name)))
    || (exists === fs.existsSync && hasFileRecursive(path.join(installRoot, 'bin'), (filePath, name) => whisperNames.includes(name)));
  const hasFfmpeg = exists(joinLocalAsrPath(platform, installRoot, 'bin', 'ffmpeg'))
    || exists(joinLocalAsrPath(platform, installRoot, 'ffmpeg', ffmpegName))
    || (exists === fs.existsSync && hasFileRecursive(path.join(installRoot, 'ffmpeg'), (filePath, name) => name === ffmpegName))
    || (exists === fs.existsSync && hasFileRecursive(path.join(installRoot, 'bin'), (filePath, name) => name === ffmpegName));

  return {
    installRoot,
    transcribeScript,
    hasTranscribeScript,
    hasWhisper,
    hasFfmpeg,
    hasModel,
    ready: hasTranscribeScript && hasWhisper && hasFfmpeg && hasModel,
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

function buildLocalAsrInstallCommand(installerPath, platform = os.platform()) {
  if (getLocalAsrPlatform(platform) === 'darwin' || String(installerPath || '').endsWith('.sh')) {
    return `/bin/bash ${quoteCommandPath(installerPath)}`;
  }
  return `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoteCommandPath(installerPath)}`;
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
    return '权限状态：未刷新。请先在小程序里兑换，再回到插件点击「刷新权限」。';
  }
  if (status.hasAccess) {
    return `权限状态：已开通${status.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : ''}${status.bindingLabel ? `，绑定：${status.bindingLabel}` : ''}`;
  }
  if (status.status === 'expired') {
    return `权限状态：已过期${status.expiresAt ? `，到期时间 ${formatEntitlementExpiresAt(status.expiresAt)}` : ''}。请在小程序里输入新的兑换码续期。`;
  }
  if (status.status === 'unbound') {
    return '权限状态：未绑定小程序。请先完成小程序绑定。';
  }
  return '权限状态：未开通。请在小程序里输入兑换码开通后，再回到插件刷新权限。';
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

function getDefaultLocalTranscriptionScriptPath(platform = os.platform()) {
  return path.join(os.homedir(), LOCAL_ASR_HOME, getLocalAsrPlatform(platform) === 'darwin' ? 'transcribe.sh' : 'transcribe.ps1');
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

function getPrimaryBindingToken(bindings) {
  const active = (Array.isArray(bindings) ? bindings : [])
    .find((item) => item && item.enabled !== false && item.status !== 'unbound' && item.token);
  return active ? active.token : '';
}

function mergeSettings(savedSettings, platform = os.platform()) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(savedSettings || {}),
  };

  merged.apiBase = String(merged.apiBase || '').trim() || DEFAULT_SETTINGS.apiBase;
  merged.bindings = normalizeBindings(merged);
  const normalizedToken = normalizeBindCodeInput(merged.token);
  const tokenBinding = merged.bindings.find((item) => item.token === normalizedToken && item.status !== 'unbound');
  merged.token = tokenBinding ? normalizedToken : getPrimaryBindingToken(merged.bindings);
  merged.pendingBindCode = normalizeBindCodeInput(merged.pendingBindCode);
  merged.localTranscriptionEntitlementStatus = merged.localTranscriptionEntitlementStatus
    && typeof merged.localTranscriptionEntitlementStatus === 'object'
    && !Array.isArray(merged.localTranscriptionEntitlementStatus)
    ? merged.localTranscriptionEntitlementStatus
    : null;
  merged.clientId = String(merged.clientId || '').trim() || createClientId();
  merged.inboxDir = String(merged.inboxDir || '').trim() || DEFAULT_SETTINGS.inboxDir;
  merged.autoSyncOnLoad = true;
  merged.aiProvider = AI_PROVIDER_NAMES[merged.aiProvider] ? merged.aiProvider : DEFAULT_SETTINGS.aiProvider;
  merged.localAsrPlatform = normalizeLocalAsrPlatform(merged.localAsrPlatform);
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
    || text.includes('NetworkError');
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

function getRecordId(record) {
  return record._id || record.id || '';
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
  const ext = match ? match[1] : 'mp3';
  if (['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'mp4'].includes(ext)) return ext;
  if (ext === 'm4s') return 'mp4';
  return 'mp3';
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
        enable_speaker_info: false,
        enable_channel_split: false,
        show_utterances: false,
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

function parseDoubaoAsrResult(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const result = data && data.result;
  if (Array.isArray(result)) {
    return result
      .map((item) => item && (item.text || item.result_text || item.utterance_text || ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  const text = (result && (result.text || result.result_text))
    || (data && (data.text || data.transcription))
    || '';
  return String(text || '').trim();
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
  if (metadata.transcriptOnly) {
    return buildAudioTranscriptMarkdown({
      url,
      transcription: metadata.transcription || '',
      transcriptionStatus: metadata.transcriptionStatus || metadata.conversionStatus || 'pending',
      transcriptionSource: metadata.transcriptionSource || metadata.transcriptionProvider || '',
      transcriptionError: metadata.transcriptionError || metadata.conversionError || '',
    });
  }

  const pageTitle = metadata.title || title;
  const snapshot = cleanMarkdownForStorage(
    metadata.markdown || metadata.snapshot || metadata.contentSnapshot || '',
    { dedupe: isFeishuUrl(url), feishuTitle: isFeishuUrl(url) ? pageTitle : '' },
  );
  const status = metadata.conversionStatus || 'pending';
  const errorText = metadata.conversionError || '';
  let fallback;
  if (status === 'failed') {
    const reason = errorText ? `\n\n失败原因：${errorText}` : '';
    fallback = `网页转 Markdown 失败，已保存原始链接。${reason}`;
  } else if (status === 'wechat_captcha') {
    fallback = `微信返回公众号安全验证页，未能提取正文。已保存原始链接。${errorText ? `\n\n详细信息：${errorText}` : ''}`;
  } else if (status === 'link_saved') {
    fallback = `网页正文提取未成功，已保存原始链接。${errorText ? `\n\n说明：${errorText}` : ''}`;
  } else {
    fallback = '网页转 Markdown 处理中，已先保存原始链接。';
  }

  return [
    `原始链接：${url}`,
    '',
    '## Markdown 内容',
    '',
    snapshot || fallback,
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
  const content = String(transcription || '').trim()
    || (status === 'failed'
      ? `转写失败。${transcriptionError || '未能提取到视频/音频文案。'}`
      : '转写处理中，或未配置可用的转写方案。');
  return [
    `原始链接：${url || ''}`,
    transcriptionSource ? `转写来源：${transcriptionSource}` : '',
    '',
    '## 口播/音频文案',
    '',
    content,
    '',
  ].filter((line) => line !== '').join('\n');
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
  return {
    ...rest,
    title: `${sourceName}口播文案`,
    url: url || rest.url || '',
    transcriptOnly: true,
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

function buildFileMarkdownBody(record) {
  const metadata = record.metadata || {};
  const fileName = metadata.fileName || record.content || 'upload-file';
  const fileID = metadata.fileID || '';
  const filePath = metadata.filePath || '';
  const converted = cleanMarkdownForStorage(metadata.markdown || metadata.convertedMarkdown || '');
  const status = metadata.conversionStatus || 'pending';
  const errorText = metadata.conversionError || '';
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

  lines.forEach((line) => {
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

    if (options.feishuTitle && shouldDropFeishuLine(text, options.feishuTitle)) {
      return;
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

    if (options.dedupe) {
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

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeTitleForCompare(text) {
  return String(text || '')
    .replace(/[-–—]\s*飞书云文档\s*$/i, '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeFeishuMarkdownLine(line) {
  return String(line || '')
    .replace(/^-\s*$/, '')
    .replace(/^-\s+/, '- ')
    .replace(/^Plain Text复制$/i, '')
    .replace(/^代码块$/i, '')
    .trim();
}

function shouldDropFeishuLine(line, title) {
  const text = String(line || '').trim();
  if (!text) return true;
  const normalized = normalizeTitleForCompare(text);
  const normalizedTitle = normalizeTitleForCompare(title);
  const noise = new Set([
    '飞书云文档',
    '与我分享',
    '登录/注册',
    '帮助中心',
    '效率指南',
    'header-v2',
    '评论（0）',
    '跳转至首条评论',
    'Plain Text',
    'Plain Text复制',
    '复制',
  ]);
  if (noise.has(text)) return true;
  if (/^最新修改时间为/.test(text)) return true;
  if (/^\d+\s*字$/.test(text)) return true;
  if (/^评论/.test(text)) return true;
  if (/^[春壹始]$/.test(text)) return true;
  if (/^春树.*云文档$/.test(text)) return true;
  if (normalizedTitle && normalized === normalizedTitle) return true;
  return false;
}

function formatFeishuHeadingLine(line) {
  const text = String(line || '').trim();
  if (/^#{1,6}\s+/.test(text) || /^!\[/.test(text) || /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text)) {
    return text;
  }
  if (/^[一二三四五六七八九十]+、/.test(text)) {
    return `# **${text}**`;
  }
  if (/^第[一二三四五六七八九十]+步[:：、]/.test(text) || text === '先认识工具') {
    return `## **${text}**`;
  }
  if (/^(系统页面截图|工作流程图|整套系统分三层|格式|示例|提示词|示例（.*）|人群画像格式.*)$/.test(text)) {
    return `### **${text}**`;
  }
  if (/^(先自我介绍下|这套系统适合什么人？|这套系统适合什么人\?)$/.test(text)) {
    return `# **${text}**`;
  }
  return text;
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

function getAttachmentExt(fileName, fallbackExt) {
  const fromName = String(fileName || '').split('.').pop();
  const ext = String(fallbackExt || fromName || '').toLowerCase().replace(/^\./, '');
  return ext === String(fileName || '').toLowerCase() ? '' : ext;
}

function isMarkdownConvertibleExt(ext) {
  return ['md', 'markdown', 'txt'].includes(String(ext || '').toLowerCase());
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
  const compactCjk = source.replace(/[^\u4e00-\u9fff]/g, '');
  const oddCjkTokens = source.match(/(?:学么|人未|改取|周朋|练么|可维)/g) || [];

  if (knownGlyphNoise.length >= 4) return true;
  if (longLatinWords.length >= 6 && latinWords.length >= 12) return true;
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
    || text.includes('xhslink.com');
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
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  const value = cleaned || fallback;
  return truncateByChars(value, 56).replace(/[.\s]+$/g, '').trim() || fallback;
}

function getWebpageSourcePrefix(url) {
  if (isFeishuUrl(url)) return '飞书';
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
  return /(?:media\.xyzcdn\.net|bilivideo\.com|bilibili\.com\/.*audio|douyin\.com\/aweme\/v1\/play|douyinvod\.com|zjcdn\.com\/tos-|bytedance[^/]*\.com\/.*(?:tos-|video)|mime_type=video)/i.test(url);
}

function pushUniqueMediaUrl(list, value) {
  const url = normalizeExtractedUrl(value);
  if (!/^https?:\/\//i.test(url)) return;
  if (!isLikelyMediaUrl(url)) return;
  if (!list.includes(url)) list.push(url);
}

function getTranscriptionMediaScore(value) {
  const url = normalizeExtractedUrl(value).toLowerCase();
  if (!url) return -1000;

  let score = 0;
  if (/\.(?:mp3|m4a|aac|wav|ogg|flac)(?:[?#]|$)/i.test(url)) score += 1000;
  if (/audio|music|voice|mime_type=audio|audio_url|music_url|play_audio/i.test(url)) score += 800;
  if (/aweme\/v1\/play/i.test(url)) score += 500;
  if (/\.(?:mp4)(?:[?#]|$)|douyinvod\.com|zjcdn\.com\/tos-|mime_type=video/i.test(url)) score += 250;
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

function extractXiaohongshuMarkdownFromHtml(html, url, fallbackText = '') {
  url = cleanDisplayUrl(url);
  const source = String(html || '');
  const title = extractMetaContent(source, ['og:title', 'twitter:title'])
    || extractHtmlTitle(source)
    || '小红书笔记';
  const description = extractXiaohongshuDescription(source, fallbackText);
  const tags = extractTagsFromText(description, source);
  const images = collectImageUrlsFromHtml(source);
  const videoUrl = extractVideoUrlFromHtml(source);
  const lines = [
    '## 标题',
    '',
    title,
    '',
    '## 正文',
    '',
    description || '页面未直接暴露正文，已保存原始链接。',
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

  lines.push(`原始链接：${url || ''}`, '');
  return {
    title,
    markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    imageUrls: images,
    videoUrl,
  };
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
    description || '页面未直接暴露视频文案，已保存原始链接。',
    '',
  ];

  if (tags.length) {
    lines.push('## 标签', '', ...tags.map((tag) => `- ${tag}`), '');
  }

  if (videoUrl) {
    lines.push('## 视频源', '', `[视频文件](${videoUrl})`, '');
  }

  lines.push(`原始链接：${url || ''}`, '');
  return {
    title,
    markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    videoUrl,
  };
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

function stripHtmlTags(html) {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function imageTagToMarkdown(tag) {
  const sourceMatch = String(tag || '').match(/\s(?:data-src|src)=["']([^"']+)["']/i);
  if (!sourceMatch || !sourceMatch[1]) return '';
  const altMatch = String(tag || '').match(/\salt=["']([^"']*)["']/i);
  const alt = altMatch && altMatch[1] ? stripHtmlTags(altMatch[1]) : '图片';
  return `\n\n![${alt}](${decodeHtmlEntities(sourceMatch[1])})\n\n`;
}

function htmlToMarkdown(html) {
  let readable = selectReadableHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
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

  readable = stripHtmlTags(readable)
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, lines) => line || lines[index - 1])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

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

  const win = new BrowserWindow({
    width: 1280,
    height: 1600,
    show: false,
    webPreferences: {
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
        const imageAssets = [];
        const imageToMarkdown = (img) => {
          const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
          if (!src) return '';
          const alt = img.alt || '图片';
          imageAssets.push({ src, alt });
          return '\\n\\n![' + alt + '](' + src + ')\\n\\n';
        };
        const blockToMarkdown = (node) => {
          if (!node) return '';
          if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
          if (node.nodeType !== Node.ELEMENT_NODE) return '';
          const tag = node.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
          if (tag === 'img') return imageToMarkdown(node);
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
          const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,[data-block-id],[data-block-type],[class*="block"],[class*="paragraph"],[class*="docx"],[class*="text"]'));
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
          }
          uniqueAssets.push(next);
        }
        return {
          title: document.title || '',
          markdown,
          assets: uniqueAssets,
        };
      })()
    `);

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

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    const loaded = waitForWebContents(win.webContents, 18000);
    await win.loadURL(url);
    await loaded;
    const payload = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const urls = [];
        const add = (value) => {
          const url = String(value || '').trim();
          if (url && !urls.includes(url)) urls.push(url);
        };
        const collect = () => {
          document.querySelectorAll('video, audio, source').forEach((node) => {
            try {
              if (node.tagName && node.tagName.toLowerCase() === 'video' && typeof node.play === 'function') {
                node.muted = true;
                node.play().catch(() => {});
              }
            } catch (error) {}
            add(node.currentSrc);
            add(node.src);
            add(node.getAttribute('src'));
          });
          try {
            performance.getEntriesByType('resource').forEach((entry) => add(entry.name));
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

    const urls = [];
    (Array.isArray(payload) ? payload : []).forEach((item) => pushUniqueMediaUrl(urls, item));
    return sortMediaUrlsForTranscription(urls);
  } finally {
    if (win && typeof win.destroy === 'function') {
      win.destroy();
    }
  }
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

function extractFeishuMarkdownFromHtml(html) {
  const source = decodeHtmlEntities(String(html || ''));
  const lines = [];
  const patterns = [
    /"(?:text|content|title|name)"\s*:\s*"((?:\\.|[^"\\]){8,})"/g,
    /'text'\s*:\s*'((?:\\.|[^'\\]){8,})'/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source))) {
      const text = decodeJsonStringLiteral(match[1])
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (
        text.length >= 8
        && !/^https?:\/\//i.test(text)
        && !/[{}[\]<>]/.test(text)
        && !lines.includes(text)
      ) {
        lines.push(text);
      }
    }
  });

  const markdown = lines.join('\n\n').trim();
  if (markdown.length < 20) {
    throw new Error('飞书静态页面中未提取到正文');
  }
  return markdown;
}

function buildMarkdownForRecord({ record, title, syncedAt }) {
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
      `原始链接：${url}`,
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

  return `收集时间：${formatCreatedTime(record.createdAt)}\n\n${body}`;
}

function buildSyncNotice(count) {
  return count ? `已同步 ${count} 条内容到 Obsidian` : '没有需要同步的新内容';
}

function getRecordConversionWarning(record) {
  if (!record) return '';
  const metadata = record.metadata || {};
  const status = metadata.conversionStatus || metadata.transcriptionStatus || '';
  if (status === 'failed') {
    const errorMsg = metadata.conversionError || metadata.transcriptionError || '';
    const prefix = getRecordSourcePrefix(record);
    const name = getRecordSourceName(record);
    const label = `${prefix}-${name}`;
    return `${label} 转写失败${errorMsg ? `：${errorMsg}` : ''}`;
  }
  if (status === 'wechat_captcha') {
    return '公众号文章触发微信安全验证，正文未能提取';
  }
  return '';
}

class WechatObsidianInboxPlugin extends Plugin {
  async onload() {
    const savedSettings = await this.loadData();
    this.settings = mergeSettings(savedSettings);
    if (!savedSettings || !savedSettings.clientId) {
      await this.saveData(this.settings);
    }

    this.addCommand({
      id: 'sync-wechat-inbox',
      name: '同步微信收集箱',
      callback: () => this.syncInbox(),
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

  async requestJson(path, method = 'GET', body = {}, binding = null) {
    const token = normalizeBindCodeInput(
      typeof binding === 'string' ? binding : ((binding && binding.token) || this.settings.token),
    );
    const requestOptions = {
      url: `${trimTrailingSlash(this.settings.apiBase)}${path}`,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Wechat-Inbox-Client-Id': this.settings.clientId,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
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
      if (response.status === 400 && message.includes('Missing client ID')) {
        throw new Error('本地设备标识缺失，请更新到最新版插件并重启 Obsidian 后再绑定');
      }
      throw new Error(message);
    }
    if (!payload || payload.success === false) {
      const message = (payload && payload.errMsg) || '同步 API 请求失败';
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
    if (!existing && currentBindings.length >= MAX_PLUGIN_BINDINGS) {
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
    } catch (error) {
      const message = error && error.message ? error.message : String(error || '');
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
    await this.saveSettings({
      ...this.settings,
      token: getPrimaryBoundToken(nextBindings),
      bindings: nextBindings,
    });
  }

  async downloadArrayBuffer(url, headers = {}) {
    const response = await requestUrl({ url, method: 'GET', headers });
    if (!response.arrayBuffer) {
      throw new Error('录音文件下载失败');
    }
    return response.arrayBuffer;
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
      if (isBindingInvalidMessage(message)) {
        await this.markBindingUnbound(normalizedToken, '绑定码已失效或已被更换');
        new Notice('绑定码已失效，已在本地标记为已解除');
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
    if (configured) return configured;
    const platform = this.getConfiguredLocalAsrPlatform();
    return fs.existsSync(getDefaultLocalTranscriptionScriptPath(platform))
      ? getDefaultLocalTranscriptionCommand(platform)
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

  getBundledLocalAsrInstallerPath() {
    const fileName = this.getConfiguredLocalAsrPlatform() === 'darwin' ? 'install-local-asr-macos.sh' : 'install-local-asr.ps1';
    return path.join(this.getPluginBaseDir(), 'local-asr', fileName);
  }

  async getAvailableLocalAsrInstallerPath() {
    const installerPath = this.getBundledLocalAsrInstallerPath();
    if (fs.existsSync(installerPath)) return installerPath;

    const isMac = this.getConfiguredLocalAsrPlatform() === 'darwin';
    const installerUrl = isMac ? LOCAL_ASR_MACOS_INSTALLER_URL : LOCAL_ASR_INSTALLER_URL;
    const downloadedPath = path.join(os.tmpdir(), `wechat-inbox-local-asr-installer-${Date.now()}${isMac ? '.sh' : '.ps1'}`);
    let scriptText = '';
    try {
      const response = await requestUrl({ url: installerUrl, method: 'GET' });
      scriptText = response.text || '';
    } catch (error) {
      scriptText = await downloadTextViaNode(installerUrl);
    }
    if (!scriptText || !scriptText.includes('.wechat-inbox-local-asr')) {
      throw new Error('Local ASR installer download returned invalid content');
    }
    fs.writeFileSync(downloadedPath, scriptText, 'utf8');
    return downloadedPath;
  }

  getLocalAsrInstallStatus() {
    return getLocalAsrInstallStatus(getLocalAsrInstallRoot(), fs.existsSync, this.getConfiguredLocalAsrPlatform());
  }

  getLocalAsrDiagnosticText() {
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = getLocalAsrInstallRoot();
    const status = getLocalAsrInstallStatus(installRoot, fs.existsSync, platform);
    const logText = readLocalAsrInstallLog(installRoot);
    return [
      'WeChat Inbox Sync 本地转写诊断',
      `插件版本：${this.manifest && this.manifest.version ? this.manifest.version : 'unknown'}`,
      `运行系统：${os.platform()} ${os.arch()} ${os.release()}`,
      `手动选择系统：${this.settings.localAsrPlatform || 'auto'}`,
      `实际使用系统：${platform}`,
      `安装目录：${status.installRoot}`,
      `转写脚本：${status.transcribeScript}`,
      `脚本存在：${status.hasTranscribeScript ? '是' : '否'}`,
      `whisper：${status.hasWhisper ? '是' : '否'}`,
      `ffmpeg：${status.hasFfmpeg ? '是' : '否'}`,
      `模型文件：${status.hasModel ? '是' : '否'}`,
      `组件可用：${status.ready ? '是' : '否'}`,
      `绑定码：${this.getActiveBindings().map((item) => `${item.label || ''}:${item.token}`).join(', ') || '-'}`,
      `权限缓存：${JSON.stringify(this.settings.localTranscriptionEntitlementStatus || {})}`,
      '最近安装日志：',
      logText || '暂无 install.log',
    ].join('\n');
  }

  async copyLocalAsrDiagnosticText() {
    const text = this.getLocalAsrDiagnosticText();
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
    const diagnosticPath = path.join(getLocalAsrInstallRoot(), 'diagnostic.txt');
    fs.mkdirSync(getLocalAsrInstallRoot(), { recursive: true });
    fs.writeFileSync(diagnosticPath, text, 'utf8');
    new Notice(`诊断信息已写入：${diagnosticPath}`);
    return false;
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

    let lastError = null;
    for (const binding of bindings) {
      try {
        const payload = await this.requestJson(`/entitlements/status?plan=${encodeURIComponent(LOCAL_TRANSCRIPTION_PLAN)}`, 'GET', {}, binding);
        const data = payload && payload.data ? payload.data : {};
        if (data.hasAccess) {
          const activeStatus = {
            hasAccess: true,
            plan: data.plan || LOCAL_TRANSCRIPTION_PLAN,
            status: data.status || 'active',
            expiresAt: data.expiresAt || '',
            bindingToken: binding.token,
            bindingLabel: binding.label || '',
          };
          await this.cacheLocalTranscriptionEntitlementStatus(activeStatus);
          return activeStatus;
        }
        lastError = data;
      } catch (error) {
        lastError = error;
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

  async ensureLocalTranscriptionAccess() {
    const status = await this.getLocalTranscriptionEntitlementStatus();
    if (status.hasAccess) return status;
    if (status.status === 'unbound') {
      throw new Error('本地转写权限未开通：请先绑定小程序，并在小程序里输入兑换码开通。');
    }
    if (status.status === 'expired') {
      throw new Error('本地转写权限已过期：请在小程序里输入新的周期兑换码后再使用。');
    }
    throw new Error('本地转写权限未开通：请在小程序里输入兑换码开通后再使用。');
  }

  async installLocalAsr() {
    await this.ensureLocalTranscriptionAccess();
    const mismatchMessage = getLocalAsrPlatformMismatchMessage(this.settings.localAsrPlatform);
    if (mismatchMessage) {
      throw new Error(mismatchMessage);
    }
    const installerPath = await this.getAvailableLocalAsrInstallerPath();
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = getLocalAsrInstallRoot();
    const command = buildLocalAsrInstallCommand(installerPath, platform);
    new Notice('开始安装本地转写组件，可能需要几分钟。');
    await new Promise((resolve, reject) => {
      childProcess.exec(command, {
        timeout: 30 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) {
          const logPath = writeLocalAsrInstallLog({
            installRoot,
            platform,
            installerPath,
            command,
            stdout,
            stderr,
            error: error.message || String(error),
            status: 'failed',
          });
          const message = stderr || stdout || error.message || String(error);
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
    await this.saveSettings({
      ...this.settings,
      aiProvider: 'local',
      localTranscriptionCommand: getDefaultLocalTranscriptionCommand(this.getConfiguredLocalAsrPlatform()),
    });
    new Notice('本地转写组件已安装，并已填入默认命令。');
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

  async runConfiguredTranscription(audioUrl) {
    const provider = this.settings.aiProvider;
    const runLocalFallback = async (sourcePrefix) => {
      if (provider === 'doubao') {
        await this.clearPendingDoubaoTask(getDoubaoTaskKey(audioUrl));
      }
      return {
        transcription: await this.runLocalTranscription(audioUrl),
        source: sourcePrefix ? `${sourcePrefix}-local` : 'local',
      };
    };

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
      return {
        transcription: await this.runLocalTranscription(audioUrl),
        source: 'local',
      };
    }
    throw new Error('未配置可用的音频转写方案');
  }

  async runLocalTranscription(audioUrl) {
    await this.ensureLocalTranscriptionAccess();
    const commandTemplate = this.getEffectiveLocalTranscriptionCommand();
    if (!commandTemplate) {
      throw new Error('未配置本地转写命令');
    }

    const inputPath = await this.downloadMediaToTempFile(audioUrl);
    const outputPath = `${inputPath}.txt`;
    const quote = (value) => `"${String(value).replace(/"/g, '\\"')}"`;
    const command = commandTemplate.includes('{input}')
      ? commandTemplate
        .replace(/\{input\}/g, quote(inputPath))
        .replace(/\{output\}/g, quote(outputPath))
      : `${commandTemplate} ${quote(inputPath)}`;

    try {
      const { stdout } = await new Promise((resolve, reject) => {
        childProcess.exec(command, {
          timeout: 2 * 60 * 60 * 1000,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message || String(error)));
            return;
          }
          resolve({ stdout, stderr });
        });
      });

      const outputText = fs.existsSync(outputPath)
        ? fs.readFileSync(outputPath, 'utf8')
        : stdout;
      const transcription = String(outputText || '').trim();
      if (!transcription) {
        throw new Error('本地转写命令没有返回文本');
      }
      return transcription;
    } finally {
      [inputPath, outputPath].forEach((filePath) => {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (error) {
          // Ignore temp cleanup failures.
        }
      });
    }
  }

  async downloadMediaToTempFile(audioUrl) {
    const resolvedUrl = shouldResolveMediaDownloadUrl(audioUrl)
      ? await resolveRedirectUrl(audioUrl, 5, 'GET')
      : audioUrl;
    const buffer = Buffer.from(await this.downloadArrayBuffer(resolvedUrl, getSocialRequestHeaders(resolvedUrl)));
    const head = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trim().toLowerCase();
    if (buffer.length < 512 || head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<body')) {
      throw new Error('下载到的媒体不是有效音视频文件，可能是平台风控页或无效视频地址');
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

  async writeVoiceAttachment(record, rootDir, dateFolder, title, binding = null) {
    const metadata = record.metadata || {};
    if (!metadata.audioFileID) {
      return record;
    }

    const audioFileName = `${title}.mp3`;
    const audioRootDir = `${rootDir}/语音附件`;
    const audioDayDir = `${audioRootDir}/${dateFolder}`;
    const audioPath = `${audioDayDir}/${audioFileName}`;
    const tempFileURL = await this.requestFileDownloadUrl(metadata.audioFileID, binding);
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

    if (this.settings.aiProvider !== 'off') {
      try {
        const result = await this.runConfiguredTranscription(tempFileURL);
        nextMetadata = {
          ...nextMetadata,
          transcription: result.transcription,
          transcriptionStatus: 'success',
          transcriptionProvider: result.source,
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

  async writeFileAttachment(record, rootDir, dateFolder, title, binding = null) {
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

  async buildTranscriptRecordFromMedia(record, {
    url,
    platform,
    mediaUrl = '',
    mediaUrls = [],
    subtitleText = '',
    subtitleUrl = '',
    source = '',
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
        }),
      };
    }

    const candidates = sortMediaUrlsForTranscription([mediaUrl, ...(Array.isArray(mediaUrls) ? mediaUrls : [])]);

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
          transcriptionError: '未能从链接中提取到可转写的音频或视频地址',
          transcriptionSource: source || 'media-url',
          conversionStatus: 'failed',
        }),
      };
    }

    let lastError = null;
    try {
      for (const candidate of candidates) {
        try {
          const result = await this.runConfiguredTranscription(candidate);
          return {
            ...record,
            metadata: buildTranscriptOnlyMetadata(metadata, {
              url,
              platform,
              mediaUrl: candidate,
              subtitleUrl,
              transcription: result.transcription,
              transcriptionStatus: 'success',
              transcriptionSource: result.source,
              conversionStatus: 'success',
            }),
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
        }),
      };
    }
  }

  async hydrateXiaoyuzhouTranscript(record, url) {
    const response = await requestUrl({ url, method: 'GET', headers: getSocialRequestHeaders(url) });
    const html = response.text || '';
    const mediaUrl = extractPodcastAudioUrlFromHtml(html) || extractSocialMediaUrlFromHtml(html);
    return this.buildTranscriptRecordFromMedia(record, {
      url,
      platform: '小宇宙',
      mediaUrl,
      mediaUrls: extractSocialMediaUrlsFromHtml(html),
      source: 'audio',
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

  async hydrateBilibiliTranscript(record, url) {
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
      });
    }

    return this.buildTranscriptRecordFromMedia(record, {
      url,
      platform: 'B站',
      mediaUrl: playurlAudioUrl || extractBilibiliAudioUrlFromHtml(html) || extractSocialMediaUrlFromHtml(html),
      source: 'audio',
    });
  }

  async hydrateWebpageMarkdown(record, rootDir, dateFolder, title) {
    const metadata = record.metadata || {};
    const url = metadata.url || record.content;
    if (!url || metadata.markdown || metadata.snapshot || metadata.contentSnapshot) {
      return record;
    }

    try {
      if (isFeishuUrl(url)) {
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
              title: metadata.title || rendered.title || '飞书链接',
              markdown,
              conversionStatus: 'success',
            },
          };
        } catch (renderError) {
          const response = await requestUrl({ url, method: 'GET' });
          const html = response.text || '';
          const markdown = extractFeishuMarkdownFromHtml(html);
          return {
            ...record,
            metadata: {
              ...metadata,
              title: metadata.title || extractHtmlTitle(html) || '飞书链接',
              markdown,
              conversionStatus: 'success',
              conversionNote: renderError.message || String(renderError),
            },
          };
        }
      }

      if (isXiaoyuzhouUrl(url)) {
        return await this.hydrateXiaoyuzhouTranscript(record, url);
      }

      if (isBilibiliUrl(url)) {
        return await this.hydrateBilibiliTranscript(record, url);
      }

      if (isXiaohongshuUrl(url) || isDouyinUrl(url)) {
        const resolvedUrl = shouldResolvePlatformRedirect(url) ? await resolveRedirectUrl(url) : url;
        const response = await requestUrl({ url: resolvedUrl, method: 'GET', headers: getSocialRequestHeaders(resolvedUrl) });
        const html = response.text || '';
        let mediaUrls = extractSocialMediaUrlsFromHtml(html);
        let mediaUrl = mediaUrls[0] || '';
        const isVideoIntent = isDouyinUrl(url)
          || isDouyinUrl(resolvedUrl)
          || /[?&]type=video\b/i.test(resolvedUrl)
          || /\/video\//i.test(resolvedUrl);
        if (isVideoIntent && typeof this.renderSocialMediaUrls === 'function') {
          try {
            mediaUrls = sortMediaUrlsForTranscription([...mediaUrls, ...(await this.renderSocialMediaUrls(resolvedUrl))]);
            mediaUrl = mediaUrls[0] || mediaUrl;
          } catch (renderError) {
            mediaUrl = mediaUrl || '';
          }
        } else if (!mediaUrl && isVideoIntent && typeof this.renderSocialMediaUrl === 'function') {
          try {
            mediaUrl = await this.renderSocialMediaUrl(resolvedUrl);
            mediaUrls = sortMediaUrlsForTranscription([...mediaUrls, mediaUrl]);
          } catch (renderError) {
            mediaUrl = '';
          }
        }
        if (mediaUrl || isVideoIntent) {
          return await this.buildTranscriptRecordFromMedia(record, {
            url,
            platform: isDouyinUrl(url) || isDouyinUrl(resolvedUrl) ? '抖音' : '小红书',
            mediaUrl,
            mediaUrls,
            source: 'video',
          });
        }

        const extracted = extractXiaohongshuMarkdownFromHtml(html, resolvedUrl, metadata.shareText || record.content || '');
        return {
          ...record,
          metadata: {
            ...metadata,
            title: metadata.title || extracted.title || getWebpageSourcePrefix(url),
            markdown: extracted.markdown,
            imageUrls: extracted.imageUrls || [],
            videoUrl: extracted.videoUrl || '',
            conversionStatus: 'success',
          },
        };
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
      const markdown = htmlToMarkdown(html);
      const pageTitle = metadata.title || extractHtmlTitle(html);
      return {
        ...record,
        metadata: {
          ...metadata,
          title: pageTitle || metadata.title || '',
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

  async writeRecord(record, syncedAt, binding = null, shouldPrefixTitle = false) {
    const dateFolder = getDateFolderName(record.createdAt);
    const rootDir = this.settings.inboxDir;
    const dayDir = `${rootDir}/${dateFolder}`;
    const bindingLabel = shouldPrefixTitle && binding ? binding.label : '';

    await this.ensureFolder(rootDir);
    await this.ensureFolder(dayDir);

    let title = await this.nextRecordTitle(dayDir, record, bindingLabel);
    let recordForMarkdown = record;
    const recordType = String(record.type || '').toLowerCase();
    if (recordType === 'voice') {
      recordForMarkdown = await this.writeVoiceAttachment(record, rootDir, dateFolder, title, binding);
    } else if (recordType === 'file') {
      recordForMarkdown = await this.writeFileAttachment(record, rootDir, dateFolder, title, binding);
    } else if (recordType === 'webpage') {
      recordForMarkdown = await this.hydrateWebpageMarkdown(record, rootDir, dateFolder, title);
      title = await this.nextRecordTitle(dayDir, recordForMarkdown, bindingLabel);
    }
    const markdown = buildMarkdownForRecord({ record: recordForMarkdown, title, syncedAt });
    const filePath = `${dayDir}/${title}.md`;
    await this.app.vault.adapter.write(filePath, markdown);

    return {
      recordId: getRecordId(record),
      filePath,
      title,
      conversionWarning: getRecordConversionWarning(recordForMarkdown),
    };
  }

  async syncBinding(binding, shouldPrefixTitle) {
    const payload = await this.requestJson('/records?status=pending', 'GET', {}, binding);
    const records = payload.data || [];
    const written = [];
    const failed = [];
    const conversionWarnings = [];
    const syncedAt = new Date().toISOString();

    for (const record of records) {
      try {
        const item = await this.writeRecord(record, syncedAt, binding, shouldPrefixTitle);
        written.push(item);
        if (item.conversionWarning) {
          conversionWarnings.push(item.conversionWarning);
        }
        await this.requestJson(`/records/${encodeURIComponent(item.recordId)}/synced`, 'POST', {}, binding);
      } catch (error) {
        failed.push({
          recordId: getRecordId(record),
          message: error.message || String(error),
        });
      }
    }

    return { written, failed, conversionWarnings };
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
      const conversionWarnings = [];

      for (const binding of bindings) {
        try {
          const result = await this.syncBinding(binding, shouldPrefixTitle);
          written.push(...result.written);
          failed.push(...result.failed);
          if (result.conversionWarnings && result.conversionWarnings.length) {
            conversionWarnings.push(...result.conversionWarnings);
          }
        } catch (error) {
          const message = error.message || String(error);
          if (isBindingInvalidMessage(message)) {
            await this.markBindingUnbound(binding.token, '绑定码已失效或已被更换');
          }
          failed.push({
            recordId: binding.label || binding.token,
            message: `${binding.label || binding.token}：${message}`,
          });
        }
      }

      if (showNotice || written.length) {
        let message = buildSyncNotice(written.length);
        if (conversionWarnings.length) {
          message += `，${conversionWarnings.length} 条内容转写未完成（已保存原始链接）`;
        }
        if (failed.length) {
          message += `，${failed.length} 条失败：${failed[0].message}`;
        }
        new Notice(message);
        // Log detailed warnings to console for debugging.
        if (conversionWarnings.length) {
          console.warn('[wechat-inbox-sync] Conversion warnings:', conversionWarnings);
        }
      }
    } catch (error) {
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

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Obsidian 内容同步助手' });

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

    const bindings = normalizeBindings(this.plugin.settings);
    if (bindings.length) {
      containerEl.createEl('h3', { text: '已绑定小程序码' });
      bindings.forEach((binding, index) => {
        const isUnbound = binding.status === 'unbound';
        const statusDesc = isUnbound
          ? `已解除/已失效${binding.lastError ? `：${binding.lastError}` : ''}`
          : (binding.enabled === false ? '已暂停同步' : '同步时会拉取这个微信里的收集内容');
        new Setting(containerEl)
          .setName(`${binding.label || `微信 ${index + 1}`}：${binding.token}`)
          .setDesc(statusDesc)
          .addText((text) => text
            .setPlaceholder(`微信 ${index + 1}`)
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
      });
    }

    new Setting(containerEl)
      .setName('新增绑定码')
      .setDesc(bindings.length >= MAX_PLUGIN_BINDINGS
        ? `已达到上限：最多绑定 ${MAX_PLUGIN_BINDINGS} 个小程序码。`
        : `打开微信小程序【Obsidian 内容同步助手】的「绑定 Obsidian」页面，复制小程序绑定码后粘贴到这里。点击新增后会加入上方列表，不会覆盖已有绑定。当前 ${bindings.length}/${MAX_PLUGIN_BINDINGS}。`)
      .addText((text) => text
        .setPlaceholder('例如 ABC-123')
        .setValue(this.plugin.settings.pendingBindCode || '')
        .onChange(async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, pendingBindCode: value });
        }))
      .addButton((button) => {
        button
          .setButtonText('新增绑定码')
          .setCta()
          .onClick(async () => {
            await this.plugin.bindCurrentCode();
            this.display();
          });
        if (bindings.length >= MAX_PLUGIN_BINDINGS) {
          button.setDisabled(true);
        }
      });

    new Setting(containerEl)
      .setName('保存根目录')
      .setDesc('内容会写入该目录下的 YYYY-MM-DD 文件夹。')
      .addText((text) => text
        .setPlaceholder('临时收集')
        .setValue(this.plugin.settings.inboxDir)
        .onChange(async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, inboxDir: value });
        }));

    new Setting(containerEl)
      .setName('语音转写')
      .setDesc('第一版只做转写，不做摘要。腾讯云密钥只保存在当前 Obsidian 本地。')
      .addDropdown((dropdown) => {
        Object.entries(AI_PROVIDER_NAMES).forEach(([value, label]) => {
          dropdown.addOption(value, label);
        });
        dropdown
          .setValue(this.plugin.settings.aiProvider)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, aiProvider: value });
            this.display();
          });
      });

    if (this.plugin.settings.aiProvider === 'local') {
      const localAsrStatus = this.plugin.getLocalAsrInstallStatus();
      const entitlementText = buildLocalTranscriptionEntitlementText(this.plugin.settings.localTranscriptionEntitlementStatus);
      new Setting(containerEl)
        .setName('本地转写系统')
        .setDesc('默认自动识别；如果苹果电脑安装失败，请手动选择 macOS 后再安装。')
        .addDropdown((dropdown) => {
          Object.entries(LOCAL_ASR_PLATFORM_NAMES).forEach(([value, label]) => {
            dropdown.addOption(value, label);
          });
          dropdown
            .setValue(this.plugin.settings.localAsrPlatform || 'auto')
            .onChange(async (value) => {
              const localAsrPlatform = normalizeLocalAsrPlatform(value);
              const platform = resolveLocalAsrPlatform(localAsrPlatform);
              await this.plugin.saveSettings({
                ...this.plugin.settings,
                localAsrPlatform,
                localTranscriptionCommand: getDefaultLocalTranscriptionCommand(platform),
              });
              this.display();
            });
        });
      new Setting(containerEl)
        .setName('本地转写权限')
        .setDesc(`音视频文案提取功能为付费功能，请在微信小程序【Obsidian 内容同步助手】里输入兑换码开通。${entitlementText}`)
        .addButton((button) => button
          .setButtonText('刷新权限')
          .setCta()
          .onClick(async () => {
            try {
              const status = await this.plugin.getLocalTranscriptionEntitlementStatus();
              new Notice(status.hasAccess
                ? `本地转写权限有效${status.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : ''}`
                : '本地转写权限未开通或已过期');
              this.display();
            } catch (error) {
              new Notice(`权限查询失败：${error.message || error}`);
            }
          }));
      new Setting(containerEl)
        .setName('本地转写组件')
        .setDesc(localAsrStatus.ready
          ? `已安装：${localAsrStatus.installRoot}`
          : `未完整安装：${localAsrStatus.installRoot}`)
        .addButton((button) => button
          .setButtonText('检测状态')
          .onClick(async () => {
            const status = this.plugin.getLocalAsrInstallStatus();
            let entitlementText = '';
            try {
              const entitlement = await this.plugin.getLocalTranscriptionEntitlementStatus();
              entitlementText = entitlement.hasAccess
                ? `权限有效${entitlement.expiresAt ? `，到期时间：${entitlement.expiresAt}` : ''}`
                : '权限未开通或已过期';
            } catch (error) {
              entitlementText = '权限状态查询失败';
            }
            new Notice(`${status.ready ? '本地转写组件可用' : '本地转写组件未完整安装'}；${entitlementText}`);
          }))
        .addButton((button) => button
          .setButtonText('一键安装')
          .setCta()
          .onClick(async () => {
            try {
              await this.plugin.installLocalAsr();
              this.display();
            } catch (error) {
              new Notice(`本地转写组件安装失败：${error.message || error}`);
            }
          }))
        .addButton((button) => button
          .setButtonText('复制诊断信息')
          .onClick(async () => {
            try {
              await this.plugin.copyLocalAsrDiagnosticText();
              new Notice('本地转写诊断信息已复制');
            } catch (error) {
              new Notice(`复制诊断信息失败：${error.message || error}`);
            }
          }));
    }

    if (this.plugin.settings.aiProvider === 'tencent') {
      this.addPasswordSetting(containerEl, {
        name: '腾讯云 SecretId',
        desc: '用于调用腾讯云 ASR 录音文件识别。',
        placeholder: 'AKID...',
        value: this.plugin.settings.tencentSecretId,
        onChange: async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, tencentSecretId: value });
        },
      });

      this.addPasswordSetting(containerEl, {
        name: '腾讯云 SecretKey',
        desc: '只保存在当前 Obsidian 本地。',
        placeholder: 'SecretKey',
        value: this.plugin.settings.tencentSecretKey,
        onChange: async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, tencentSecretKey: value });
        },
      });

      new Setting(containerEl)
        .setName('腾讯云地域')
        .setDesc('默认 ap-shanghai。')
        .addText((text) => text
          .setPlaceholder('ap-shanghai')
          .setValue(this.plugin.settings.tencentRegion)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, tencentRegion: value });
          }));

      new Setting(containerEl)
        .setName('识别模型')
        .setDesc('普通话默认 16k_zh。')
        .addText((text) => text
          .setPlaceholder('16k_zh')
          .setValue(this.plugin.settings.tencentEngineModelType)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, tencentEngineModelType: value });
          }));

      new Setting(containerEl)
        .setName('最大等待次数')
        .setDesc('每次同步最多轮询多少次。默认 60 次。')
        .addText((text) => text
          .setPlaceholder('60')
          .setValue(String(this.plugin.settings.tencentPollAttempts))
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, tencentPollAttempts: Number(value) });
          }));

      new Setting(containerEl)
        .setName('每次等待毫秒')
        .setDesc('默认 5000，60 次约等 5 分钟。')
        .addText((text) => text
          .setPlaceholder('5000')
          .setValue(String(this.plugin.settings.tencentPollIntervalMs))
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, tencentPollIntervalMs: Number(value) });
          }));
    }

    if (this.plugin.settings.aiProvider === 'aliyun') {
      this.addPasswordSetting(containerEl, {
        name: '阿里云百炼 API Key',
        desc: '用于 Qwen-Omni 直接处理音频，Key 只保存在当前 Obsidian 本地。',
        placeholder: 'sk-...',
        value: this.plugin.settings.aliyunApiKey,
        onChange: async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, aliyunApiKey: value });
        },
      });

      new Setting(containerEl)
        .setName('阿里模型')
        .setDesc('默认 qwen3.5-omni-plus，适合先跑通长音频转写。')
        .addText((text) => text
          .setPlaceholder('qwen3.5-omni-plus')
          .setValue(this.plugin.settings.aliyunModel)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, aliyunModel: value });
          }));

      new Setting(containerEl)
        .setName('阿里接口地址')
        .setDesc('一般保持默认即可。')
        .addText((text) => text
          .setPlaceholder(DEFAULT_SETTINGS.aliyunBaseUrl)
          .setValue(this.plugin.settings.aliyunBaseUrl)
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, aliyunBaseUrl: value });
          }));
    }

    if (this.plugin.settings.aiProvider === 'doubao') {
      this.addPasswordSetting(containerEl, {
        name: '豆包语音识别 API Key',
        desc: '用于豆包语音识别极速版，只做转写，不做摘要。Key 只保存在当前 Obsidian 本地。',
        placeholder: 'volc-asr-key',
        value: this.plugin.settings.doubaoAsrApiKey,
        onChange: async (value) => {
          await this.plugin.saveSettings({ ...this.plugin.settings, doubaoAsrApiKey: value });
        },
      });

      new Setting(containerEl)
        .setName('豆包最大等待次数')
        .setDesc('每次同步最多轮询多少次。默认 60 次。')
        .addText((text) => text
          .setPlaceholder('60')
          .setValue(String(this.plugin.settings.doubaoPollAttempts))
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, doubaoPollAttempts: Number(value) });
          }));

      new Setting(containerEl)
        .setName('豆包每次等待毫秒')
        .setDesc('默认 5000，60 次约等 5 分钟。')
        .addText((text) => text
          .setPlaceholder('5000')
          .setValue(String(this.plugin.settings.doubaoPollIntervalMs))
          .onChange(async (value) => {
            await this.plugin.saveSettings({ ...this.plugin.settings, doubaoPollIntervalMs: Number(value) });
          }));
    }

    new Setting(containerEl)
      .setName('立即同步')
      .setDesc('手动拉取云端收集箱，并写入当前 vault。')
      .addButton((button) => button
        .setButtonText('同步')
        .setCta()
        .onClick(() => this.plugin.syncInbox()));

    const status = containerEl.createDiv({ cls: 'wechat-inbox-sync-status' });
    status.setText('同步后会生成：临时收集/YYYY-MM-DD/文字-143205.md、链接-143210.md、语音-143220.md。语音附件会放入临时收集/语音附件/。');
  }
}

WechatObsidianInboxPlugin.__test = {
  FEISHU_TUTORIAL_URL,
  MAX_PLUGIN_BINDINGS,
  LOCAL_TRANSCRIPTION_PLAN,
  LOCAL_ASR_INSTALLER_URL,
  LOCAL_ASR_MACOS_INSTALLER_URL,
  LOCAL_ASR_PLATFORM_NAMES,
  getLocalAsrPlatform,
  normalizeLocalAsrPlatform,
  resolveLocalAsrPlatform,
  getLocalAsrPlatformMismatchMessage,
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
  extractXiaohongshuMarkdownFromHtml,
  extractSocialVideoMarkdownFromHtml,
  extractPodcastAudioUrlFromHtml,
  extractSocialMediaUrlsFromHtml,
  extractSocialMediaUrlFromHtml,
  sortMediaUrlsForTranscription,
  cleanDisplayUrl,
  extractBilibiliSubtitleUrlsFromHtml,
  parseBilibiliSubtitlePayload,
  extractBilibiliAudioUrlFromPlayurlPayload,
  buildAudioTranscriptMarkdown,
  buildTranscriptOnlyMetadata,
  createRetryableTranscriptionError,
  isRetryableTranscriptionError,
  isRemoteAsrDownloadFailure,
  getDoubaoTaskKey,
  getDefaultLocalTranscriptionCommand,
  getLocalAsrInstallRoot,
  getLocalAsrInstallStatus,
  buildLocalAsrInstallCommand,
  downloadTextViaNode,
  getSocialRequestHeaders,
  shouldResolveMediaDownloadUrl,
  openExternalUrl,
  extractPdfMarkdown,
  cleanPdfExtractedText,
  cleanMarkdownForStorage,
  resolveRedirectUrl,
  isRequestUrlTransportError,
  requestJsonViaNode,
  validateSettings,
  mergeSettings,
  normalizeBindings,
  normalizeBindCodeInput,
};

module.exports = WechatObsidianInboxPlugin;
