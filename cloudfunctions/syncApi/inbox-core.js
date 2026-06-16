const SUPPORTED_TYPES = ['text', 'link', 'webpage', 'voice', 'file'];
const DAILY_FREE_LIMIT = 5;
const DAILY_SHARE_LIMIT = 10;
const DAILY_AD_BONUS = 10;
const DEFAULT_BIND_DEVICE_LIMIT = 1;
const MAX_BIND_DEVICE_LIMIT = 3;
const BIND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLOUD_PRE_TRANSCRIPTION_TEMP_DISABLED = true;

function normalizeContentType(type) {
  const normalized = String(type || '').toLowerCase();
  if (!SUPPORTED_TYPES.includes(normalized)) {
    throw new Error(`Unsupported content type: ${type}`);
  }
  return normalized;
}

function isSupportedWebpageUrl(url) {
  const text = String(url || '').toLowerCase();
  return text.includes('mp.weixin.qq.com')
    || text.includes('feishu.cn')
    || text.includes('larksuite.com')
    || text.includes('feishu.net')
    || text.includes('xiaohongshu.com')
    || text.includes('xhslink.com')
    || text.includes('douyin.com')
    || text.includes('iesdouyin.com')
    || text.includes('amemv.com')
    || text.includes('bilibili.com')
    || text.includes('b23.tv')
    || text.includes('xiaoyuzhoufm.com')
    || text.includes('xiaoyuzhou.com');
}

function extractHttpUrl(content) {
  const text = String(content || '');
  const match = text.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i);
  if (!match) return '';
  return match[0].replace(/[.,!?;:)\]}]+$/g, '');
}

function isAudioVideoWebpageUrl(url, sourceText = '') {
  const text = `${String(url || '')}\n${String(sourceText || '')}`.toLowerCase();
  if (
    text.includes('douyin.com')
    || text.includes('iesdouyin.com')
    || text.includes('amemv.com')
    || text.includes('bilibili.com/video')
    || text.includes('b23.tv')
    || text.includes('xiaoyuzhoufm.com')
    || text.includes('xiaoyuzhou.com')
  ) {
    return true;
  }
  if (text.includes('xhslink.com')) {
    return true;
  }
  if (text.includes('xiaohongshu.com')) {
    return /([?&]type=video\b|\/video\/|视频|音频|播客|直播|vlog)/i.test(text);
  }
  return false;
}

function createBaseRecord({ event, openid, now }) {
  const incomingType = normalizeContentType(event.contentType);
  const content = String(event.content || '').trim();
  if (!content) {
    throw new Error('Content is required');
  }
  const extractedUrl = extractHttpUrl(event.url || content);
  const url = String(event.url || extractedUrl || content).trim();
  const type = (incomingType === 'link' || incomingType === 'text') && isSupportedWebpageUrl(url) ? 'webpage' : incomingType;
  const recordContent = type === 'webpage' ? url : content;

  return {
    openid,
    type,
    content: recordContent,
    status: 'pending',
    source: 'wechat-miniprogram',
    createdAt: now,
    syncedAt: null,
    metadata: {},
  };
}

function createInboxRecordDocument({
  event,
  openid,
  now,
  cloudPreTranscription = {},
}) {
  if (!openid) {
    throw new Error('OpenID is required');
  }

  const record = createBaseRecord({ event, openid, now });

  if (record.type === 'link') {
    record.metadata = {
      url: event.url || record.content,
      fetchStatus: 'pending',
    };
  }

  if (record.type === 'webpage') {
    const sourceText = String(event.shareText || event.content || '').trim();
    const eventCloudPreTranscription = event.cloudPreTranscription || null;
    const cloudPreTranscriptionConfig = eventCloudPreTranscription || cloudPreTranscription || {};
    const transcriptionMode = String(cloudPreTranscriptionConfig && cloudPreTranscriptionConfig.mode || '').toLowerCase();
    const isAudioVideoWebpage = event.webpageMediaType === 'audio_video' || isAudioVideoWebpageUrl(record.content, sourceText);
    record.metadata = {
      url: event.url || record.content,
      shareText: sourceText && sourceText !== record.content ? sourceText : '',
      conversionStatus: 'pending',
    };
    if (isAudioVideoWebpage) {
      const cloudRequestedByClient = transcriptionMode === 'cloud' && cloudPreTranscriptionConfig.enabled !== false;
      const cloudRequested = !CLOUD_PRE_TRANSCRIPTION_TEMP_DISABLED && cloudRequestedByClient;
      record.metadata.webpageMediaType = 'audio_video';
      record.metadata.transcriptionStatus = cloudRequested ? 'queued' : 'pending';
      record.metadata.transcriptionMode = cloudRequested ? 'cloud' : 'local';
      record.metadata.cloudTranscriptionRequested = cloudRequested;
      record.metadata.cloudTranscriptionReason = CLOUD_PRE_TRANSCRIPTION_TEMP_DISABLED && cloudRequestedByClient
        ? 'cloud-disabled'
        : Object.keys(cloudPreTranscriptionConfig).length
        ? String(cloudPreTranscriptionConfig.reason || 'manual')
        : 'missing-client-choice';
      if (cloudRequested) {
        record.metadata.transcriptionSource = 'cloud-pretranscription';
        record.metadata.speakerDiarizationRequested = Boolean(cloudPreTranscriptionConfig && cloudPreTranscriptionConfig.speakerDiarization);
      }
    }
  }

  if (record.type === 'voice') {
    if (!event.audioFileID) {
      throw new Error('Audio file ID is required');
    }
    const eventCloudPreTranscription = event.cloudPreTranscription || null;
    const cloudPreTranscriptionConfig = eventCloudPreTranscription || cloudPreTranscription || {};
    const transcriptionMode = String(cloudPreTranscriptionConfig.mode || '').toLowerCase();
    const explicitCloudTranscription = transcriptionMode === 'cloud';
    const explicitLocalTranscription = transcriptionMode === 'local' || (
      eventCloudPreTranscription && cloudPreTranscriptionConfig.enabled === false
    );
    const durationMs = Number(event.duration) || 0;
    const thresholdMinutes = Math.max(1, Number(cloudPreTranscriptionConfig.thresholdMinutes) || 10);
    const cloudRequestedByClientOrThreshold = explicitCloudTranscription || (
        !explicitLocalTranscription
        && Boolean(cloudPreTranscriptionConfig.enabled)
        && durationMs >= thresholdMinutes * 60 * 1000
      );
    const shouldQueueCloudTranscription = !CLOUD_PRE_TRANSCRIPTION_TEMP_DISABLED && cloudRequestedByClientOrThreshold;
    record.metadata = {
      audioFileID: event.audioFileID,
      audioFileName: event.audioFileName || '',
      duration: durationMs,
      transcriptionStatus: shouldQueueCloudTranscription ? 'queued' : 'pending',
      summaryStatus: 'pending',
    };
    record.metadata.transcriptionMode = shouldQueueCloudTranscription ? 'cloud' : 'local';
    record.metadata.cloudTranscriptionRequested = Boolean(shouldQueueCloudTranscription);
    record.metadata.cloudTranscriptionReason = String(
      (CLOUD_PRE_TRANSCRIPTION_TEMP_DISABLED && cloudRequestedByClientOrThreshold ? 'cloud-disabled' : '')
      || cloudPreTranscriptionConfig.reason
      || (shouldQueueCloudTranscription ? (explicitCloudTranscription ? 'manual' : 'threshold') : '')
      || (Object.keys(cloudPreTranscriptionConfig).length ? 'threshold-not-met' : 'missing-client-choice')
    );
    if (shouldQueueCloudTranscription) {
      record.metadata.transcriptionSource = 'cloud-pretranscription';
      record.metadata.cloudPreTranscriptionThresholdMinutes = thresholdMinutes;
      record.metadata.speakerDiarizationRequested = Boolean(cloudPreTranscriptionConfig.speakerDiarization);
    }
  }

  if (record.type === 'file') {
    if (!event.fileID) {
      throw new Error('File ID is required');
    }
    record.metadata = {
      fileID: event.fileID,
      fileName: event.fileName || record.content,
      fileExt: event.fileExt || '',
      fileSize: event.fileSize || 0,
      conversionStatus: 'pending',
    };
  }

  return record;
}

function createBindCodeDocument({ openid, code, now }) {
  if (!openid) {
    throw new Error('OpenID is required');
  }
  if (!code) {
    throw new Error('Bind code is required');
  }
  return {
    openid,
    code,
    status: 'pending',
    createdAt: now,
    expiresAt: '',
    boundAt: null,
    clientId: '',
    clients: [],
    deviceLimit: DEFAULT_BIND_DEVICE_LIMIT,
    revokedAt: null,
  };
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

function getBindCodeLookupCandidates(code) {
  const normalized = normalizeBindCodeInput(code);
  if (!normalized) return [];
  const variants = [''];
  for (const char of normalized) {
    let choices = [char];
    if (char === 'O') choices = ['O', '0'];
    if (char === '0') choices = ['0', 'O'];
    if (char === 'I') choices = ['I', '1'];
    if (char === '1') choices = ['1', 'I'];
    const currentLength = variants.length;
    for (let index = 0; index < currentLength; index += 1) {
      const prefix = variants.shift();
      choices.forEach((choice) => variants.push(`${prefix}${choice}`));
    }
  }
  return Array.from(new Set(variants));
}

function normalizeBindDeviceLimit(bindCode) {
  const value = Number(bindCode && bindCode.deviceLimit) || DEFAULT_BIND_DEVICE_LIMIT;
  return Math.min(MAX_BIND_DEVICE_LIMIT, Math.max(DEFAULT_BIND_DEVICE_LIMIT, value));
}

function normalizeBindClients(bindCode) {
  const seen = new Set();
  const clients = [];
  const source = Array.isArray(bindCode && bindCode.clients) ? bindCode.clients : [];

  source.forEach((item) => {
    const clientId = String((item && item.clientId) || '').trim();
    if (!clientId || seen.has(clientId)) return;
    seen.add(clientId);
    clients.push({
      clientId,
      name: String((item && item.name) || '').trim(),
      boundAt: (item && item.boundAt) || (bindCode && bindCode.boundAt) || '',
      lastSyncAt: (item && item.lastSyncAt) || '',
    });
  });

  const legacyClientId = String((bindCode && bindCode.clientId) || '').trim();
  if (legacyClientId && !seen.has(legacyClientId)) {
    clients.unshift({
      clientId: legacyClientId,
      name: '',
      boundAt: (bindCode && bindCode.boundAt) || '',
      lastSyncAt: '',
    });
  }

  return clients.slice(0, MAX_BIND_DEVICE_LIMIT);
}

function bindClientToCodeDocument(bindCode, clientId, now) {
  const normalizedClientId = String(clientId || '').trim();
  if (!bindCode || !normalizedClientId) {
    return { status: 'invalid' };
  }

  const status = bindCode.status || 'pending';
  if (status !== 'pending' && status !== 'bound') {
    return { status: 'invalid' };
  }

  const clients = normalizeBindClients(bindCode);
  const existing = clients.find((item) => item.clientId === normalizedClientId);
  if (existing) {
    return {
      status: 'bound',
      openid: bindCode.openid,
      boundAt: existing.boundAt || bindCode.boundAt || '',
      data: null,
    };
  }

  const deviceLimit = normalizeBindDeviceLimit(bindCode);
  if (clients.length >= deviceLimit) {
    return { status: 'already-bound' };
  }

  const boundAt = bindCode.boundAt || now;
  const nextClients = [
    ...clients,
    {
      clientId: normalizedClientId,
      name: '',
      boundAt: now,
      lastSyncAt: '',
    },
  ];

  return {
    status: 'bound',
    openid: bindCode.openid,
    boundAt,
    data: {
      status: 'bound',
      clientId: bindCode.clientId || nextClients[0].clientId,
      clients: nextClients,
      deviceLimit,
      boundAt,
    },
  };
}

function unbindClientFromCodeDocument(bindCode, clientId, now) {
  const normalizedClientId = String(clientId || '').trim();
  if (!bindCode || !normalizedClientId) {
    return { status: 'invalid' };
  }

  const clients = normalizeBindClients(bindCode);
  const nextClients = clients.filter((item) => item.clientId !== normalizedClientId);
  if (nextClients.length === clients.length) {
    return { status: 'not-found' };
  }

  const hasClients = nextClients.length > 0;
  return {
    status: 'updated',
    data: {
      status: hasClients ? 'bound' : 'pending',
      clientId: hasClients ? nextClients[0].clientId : '',
      clients: nextClients,
      boundAt: hasClients ? (bindCode.boundAt || nextClients[0].boundAt || now) : null,
      unboundAt: now,
    },
  };
}

function isBindClientAllowed(bindCode, clientId) {
  const normalizedClientId = String(clientId || '').trim();
  if (!bindCode || bindCode.status !== 'bound' || !normalizedClientId) return false;
  return normalizeBindClients(bindCode).some((item) => item.clientId === normalizedClientId);
}

function createBindStatusResponse(bindCode, now) {
  if (!bindCode) {
    return {
      code: '',
      status: 'missing',
      isBound: false,
      createdAt: '',
      expiresAt: '',
      boundAt: null,
      deviceLimit: DEFAULT_BIND_DEVICE_LIMIT,
      maxDeviceLimit: MAX_BIND_DEVICE_LIMIT,
      clientCount: 0,
      canAddDevice: false,
      clients: [],
    };
  }

  const status = bindCode.status || 'pending';
  const clients = normalizeBindClients(bindCode);
  const deviceLimit = normalizeBindDeviceLimit(bindCode);

  return {
    code: bindCode.code || '',
    status,
    isBound: status === 'bound',
    createdAt: bindCode.createdAt || '',
    expiresAt: bindCode.expiresAt || '',
    boundAt: bindCode.boundAt || null,
    deviceLimit,
    maxDeviceLimit: MAX_BIND_DEVICE_LIMIT,
    clientCount: clients.length,
    canAddDevice: deviceLimit < MAX_BIND_DEVICE_LIMIT,
    clients,
  };
}

function generateBindCode() {
  let code = '';
  for (let i = 0; i < 3; i += 1) {
    code += BIND_CODE_CHARS.charAt(Math.floor(Math.random() * BIND_CODE_CHARS.length));
  }
  code += '-';
  for (let i = 0; i < 3; i += 1) {
    code += BIND_CODE_CHARS.charAt(Math.floor(Math.random() * BIND_CODE_CHARS.length));
  }
  return code;
}

async function generateUniqueBindCode({
  codeExists,
  generateCode = generateBindCode,
  maxAttempts = 20,
} = {}) {
  if (typeof codeExists !== 'function') {
    throw new Error('Bind code existence checker is required');
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateCode();
    if (!code) continue;
    const exists = await codeExists(code);
    if (!exists) return code;
  }

  throw new Error('Unable to generate unique bind code');
}

function getUsageDay(now) {
  const date = new Date(new Date(now).getTime() + 8 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function buildDailyUsageDocument({ openid, now }) {
  return {
    openid,
    day: getUsageDay(now),
    used: 0,
    limit: DAILY_FREE_LIMIT,
    shareUnlocked: false,
    adUnlockCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function buildUsageState(usage) {
  const used = Number(usage && usage.used) || 0;
  const limit = Number(usage && usage.limit) || DAILY_FREE_LIMIT;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    shareUnlocked: Boolean(usage && usage.shareUnlocked),
    adUnlockCount: Number(usage && usage.adUnlockCount) || 0,
  };
}

function buildProUsageState() {
  return {
    used: 0,
    limit: null,
    remaining: null,
    shareUnlocked: true,
    adUnlockCount: 0,
    proUnlimited: true,
  };
}

module.exports = {
  DAILY_FREE_LIMIT,
  DAILY_SHARE_LIMIT,
  DAILY_AD_BONUS,
  CLOUD_PRE_TRANSCRIPTION_TEMP_DISABLED,
  DEFAULT_BIND_DEVICE_LIMIT,
  MAX_BIND_DEVICE_LIMIT,
  createInboxRecordDocument,
  createBindCodeDocument,
  createBindStatusResponse,
  bindClientToCodeDocument,
  unbindClientFromCodeDocument,
  isBindClientAllowed,
  normalizeBindClients,
  normalizeBindDeviceLimit,
  normalizeBindCodeInput,
  getBindCodeLookupCandidates,
  generateBindCode,
  generateUniqueBindCode,
  extractHttpUrl,
  normalizeContentType,
  isAudioVideoWebpageUrl,
  isSupportedWebpageUrl,
  getUsageDay,
  buildDailyUsageDocument,
  buildUsageState,
  buildProUsageState,
};
