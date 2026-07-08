const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const https = require('https');
const {
  buildSyncedRecordCleanupData,
  collectRecordFileIds,
  handleSyncApiRequest,
} = require('./sync-api-core');
const {
  evaluatePluginBindingLimit,
} = require('./inbox-core');
const {
  DEFAULT_REDEEM_PLAN,
  isFormalProPlan,
  isRedeemEntitlementAllowedForClient,
  isLocalTranscriptionPlan,
  normalizeRedeemCode,
  pickBestLocalTranscriptionEntitlement,
} = require('./redeem-code-core');
const {
  createAdminRedeemCodeDocuments,
} = require('./admin-core');
const {
  buildPaymentOrderState,
  createPaidEntitlementFromOrder,
  pickPaymentCarryoverEntitlement,
  mergePaidEntitlementWithCarryover,
  createPaidRedeemCodeDocument,
  buildPaymentNotificationWebhookPayload,
} = require('./payment-core');
const {
  DEFAULT_FEISHU_OAUTH_SCOPES,
  buildFeishuAuthorizeUrl,
  buildFeishuOAuthRefreshRequest,
  buildFeishuOAuthTokenRequest,
  createFeishuOAuthState,
  fetchFeishuOpenApiBlocksFromUrl,
  maskFeishuAppId,
  normalizeFeishuOAuthAppConfig,
  normalizeFeishuOAuthTokenPayload,
  normalizeScopeList,
} = require('./feishu-oauth-core');
const PRODUCTION_WECHAT_DATA_ENV = 'he02-d8gebzv050ed6c4ef';
const LEGACY_SYNC_API_BASE = 'https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync';

function getCloudDataEnv() {
  return String(process.env.WECHAT_DATA_ENV || '').trim() || PRODUCTION_WECHAT_DATA_ENV || cloud.DYNAMIC_CURRENT_ENV;
}

cloud.init({
  env: getCloudDataEnv(),
});

const db = cloud.database({
  env: getCloudDataEnv(),
});
const _ = db.command;
const { handleAdminRequest: handleAdminConsoleRequest } = require('./admin-handler');
const DEFAULT_BIND_DEVICE_LIMIT = 1;
const MAX_BIND_DEVICE_LIMIT = 3;
const BIND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DOUBAO_ASR_SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const DOUBAO_ASR_QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
const DOUBAO_ASR_RESOURCE_ID = 'volc.bigasr.auc';
const TENCENT_OCR_HOST = 'ocr.tencentcloudapi.com';
const TENCENT_OCR_SERVICE = 'ocr';
const TENCENT_OCR_VERSION = '2018-11-19';
const DEFAULT_TENCENT_OCR_ACTION = 'GeneralBasicOCR';
const DEFAULT_TENCENT_OCR_REGION = 'ap-guangzhou';
const DEFAULT_CLOUD_ASR_POLL_ATTEMPTS = 60;
const DEFAULT_CLOUD_ASR_POLL_INTERVAL_MS = 5000;
const MEDIA_RESOLVER_TIMEOUT_MS = 30000;
const MEDIA_PREPARE_DOWNLOAD_TIMEOUT_MS = 120000;
const MEDIA_PREPARE_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_AI_METADATA_MODEL = 'deepseek-chat';
const FEISHU_OAUTH_STORE_COLLECTION = 'feishu_oauth_states';
const FEISHU_OAUTH_LEGACY_STORE_COLLECTION = 'bind_codes';
const FEISHU_OAUTH_STATE_KIND = 'feishu_oauth_state';
const FEISHU_OAUTH_STATE_CODE_PREFIX = 'FEISHU_OAUTH_STATE_';

function isRealBindCodeDocument(item) {
  const code = String((item && item.code) || '').trim();
  const kind = String((item && item.kind) || '').trim();
  return Boolean(item)
    && (!kind || kind === 'bind_code')
    && !code.startsWith(FEISHU_OAUTH_STATE_CODE_PREFIX);
}

function pickFirstRealBindCode(docs = []) {
  return (docs || []).find(isRealBindCodeDocument) || null;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function getMediaResolverUrl() {
  return String(process.env.MEDIA_RESOLVER_URL || '').trim();
}

function getMediaResolverSecret() {
  return String(process.env.MEDIA_RESOLVER_SECRET || '').trim();
}

function isMediaPrepareCacheEnabled() {
  return String(process.env.MEDIA_PREPARE_CACHE_ENABLED || '').toLowerCase() === 'true';
}

function getMediaPrepareCacheTtlMs() {
  const hours = Number(process.env.MEDIA_PREPARE_CACHE_TTL_HOURS || 24);
  return Math.max(1, Math.min(168, Number.isFinite(hours) ? hours : 24)) * 60 * 60 * 1000;
}

function sanitizeCloudPathPart(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80) || 'unknown';
}

function getPreparedMediaExt(url) {
  const clean = String(url || '').split('?')[0].split('#')[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]{2,5})$/);
  const ext = match ? match[1] : '';
  if (['mp3', 'wav', 'm4a', 'mp4', 'aac', 'ogg', 'flac', 'webm', 'm4s'].includes(ext)) return ext;
  return 'm4a';
}

function normalizeResolverMediaUrl(mediaUrl, resolverUrl, data = {}) {
  const value = String(mediaUrl || '').trim();
  if (!value || !isHttpUrl(value)) return value;
  if (!data.proxied) return value;
  try {
    const media = new URL(value);
    const resolver = new URL(resolverUrl);
    if (media.pathname.startsWith('/media/') && resolver.protocol === 'https:') {
      return `${resolver.origin}${media.pathname}${media.search}`;
    }
  } catch (error) {
    return value;
  }
  return value;
}

function getAiMetadataApiKey() {
  return String(
    process.env.AI_METADATA_API_KEY
    || process.env.DEEPSEEK_API_KEY
    || process.env.OPENAI_API_KEY
    || ''
  ).trim();
}

function getAiMetadataModel() {
  return String(
    process.env.AI_METADATA_MODEL
    || process.env.DEEPSEEK_MODEL
    || process.env.OPENAI_MODEL
    || DEFAULT_AI_METADATA_MODEL
  ).trim();
}

function normalizeAiMetadataEndpoint(value) {
  const raw = String(value || '').trim() || 'https://api.deepseek.com/v1/chat/completions';
  if (/\/chat\/completions\/?$/i.test(raw)) return raw.replace(/\/+$/, '');
  return `${raw.replace(/\/+$/, '')}/chat/completions`;
}

function getAiMetadataEndpoint() {
  return normalizeAiMetadataEndpoint(
    process.env.AI_METADATA_API_URL
    || process.env.AI_METADATA_BASE_URL
    || process.env.DEEPSEEK_API_URL
    || process.env.DEEPSEEK_BASE_URL
    || (process.env.OPENAI_BASE_URL ? `${process.env.OPENAI_BASE_URL}/chat/completions` : '')
  );
}

function extractOpenAICompatibleText(payload) {
  const choices = payload && Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] || {};
  return String(
    first.message && first.message.content
    || first.text
    || payload && payload.output_text
    || ''
  ).trim();
}

function parseAiMetadataJsonLegacy(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  if (!source) return {};
  try {
    return JSON.parse(source);
  } catch (error) {
    const descriptionMatch = source.match(/description\s*[:：]\s*([^\n]+)/i)
      || source.match(/简介\s*[:：]\s*([^\n]+)/i);
    const keywordsMatch = source.match(/keywords?\s*[:：]\s*([^\n]+)/i)
      || source.match(/关键词\s*[:：]\s*([^\n]+)/i);
    return {
      description: descriptionMatch ? descriptionMatch[1].trim() : '',
      keywords: keywordsMatch ? keywordsMatch[1].split(/[,，、#\s]+/).filter(Boolean) : [],
    };
  }
}

async function generateAiMetadataWithModelLegacy(payload) {
  const apiKey = getAiMetadataApiKey();
  if (!apiKey) return null;
  const response = await postJson({
    url: getAiMetadataEndpoint(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      model: getAiMetadataModel(),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你是内容整理助手。请根据用户提供的内容生成简介和关键词，只输出 JSON：{"description":"一句话简介","keywords":["关键词","关键词"]}。description 控制在 1 句话，keywords 返回 3 到 8 个简洁中文或英文关键词。',
        },
        {
          role: 'user',
          content: [
            payload.title ? `标题：${payload.title}` : '',
            payload.source ? `来源：${payload.source}` : '',
            `内容：${payload.content || ''}`,
          ].filter(Boolean).join('\n'),
        },
      ],
    },
    timeoutMs: 30000,
  });
  if (!response.status || response.status < 200 || response.status >= 300) {
    throw new Error(`AI metadata request failed: HTTP ${response.status}`);
  }
  return parseAiMetadataJson(extractOpenAICompatibleText(response.json) || response.text || '');
}

function normalizeAiMetadataKeywords(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,;#\s]+/);
  return raw
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeAiMetadataObject(value) {
  const data = value && typeof value === 'object' ? value : {};
  return {
    description: String(
      data.description
      || data.summary
      || data.desc
      || data.introduction
      || data['\u7b80\u4ecb']
      || data['\u6458\u8981']
      || data['\u63cf\u8ff0']
      || ''
    ).trim(),
    keywords: normalizeAiMetadataKeywords(
      data.keywords
      || data.keyword
      || data.tags
      || data['\u5173\u952e\u8bcd']
      || data['\u6807\u7b7e']
      || []
    ),
  };
}

function parseAiMetadataJson(text) {
  const source = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  if (!source) return {};
  try {
    return normalizeAiMetadataObject(JSON.parse(source));
  } catch (error) {
    const jsonMatch = source.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return normalizeAiMetadataObject(JSON.parse(jsonMatch[0]));
      } catch (jsonError) {
        // Fall through to line-based parsing.
      }
    }
    const descriptionMatch = source.match(/(?:description|summary|intro)\s*[:\uFF1A]\s*([^\n]+)/i);
    const keywordsMatch = source.match(/(?:keywords?|tags?)\s*[:\uFF1A]\s*([^\n]+)/i);
    return normalizeAiMetadataObject({
      description: descriptionMatch ? descriptionMatch[1].trim() : '',
      keywords: keywordsMatch ? keywordsMatch[1] : [],
    });
  }
}

function stripAiMetadataUrls(value) {
  return String(value || '').replace(/https?:\/\/[^\s<>()\]]+/gi, ' ').trim();
}

async function generateAiMetadataWithModel(payload) {
  const apiKey = getAiMetadataApiKey();
  if (!apiKey) return null;
  const title = stripAiMetadataUrls(payload.title);
  const source = String(payload.source || '').trim();
  const content = stripAiMetadataUrls(payload.content);
  const response = await postJson({
    url: getAiMetadataEndpoint(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      model: getAiMetadataModel(),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are a content organization assistant.',
            'Generate a concise description and keywords from the real user content.',
            'Return ONLY a JSON object with this schema: {"description":"...","keywords":["..."]}.',
            'The description must be one natural sentence.',
            'Return 3 to 8 concise keywords in the same language as the source content.',
            'If the content contains mostly Chinese characters, both description and keywords MUST be in Simplified Chinese.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            title ? `Title: ${title}` : '',
            source ? `Source: ${source}` : '',
            `Content:\n${content}`,
          ].filter(Boolean).join('\n\n'),
        },
      ],
    },
    timeoutMs: 30000,
  });
  if (!response.status || response.status < 200 || response.status >= 300) {
    throw new Error(`AI metadata request failed: HTTP ${response.status}`);
  }
  return parseAiMetadataJson(extractOpenAICompatibleText(response.json) || response.text || '');
}

function downloadPreparedMedia(url, headers = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (!isHttpUrl(url)) {
      reject(new Error('Prepared media URL is invalid'));
      return;
    }
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? require('http') : https;
    const req = client.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 WeChatInboxMediaPrepare/1.0',
        Accept: '*/*',
        ...headers,
      },
    }, (res) => {
      const location = res.headers && res.headers.location;
      if ([301, 302, 303, 307, 308].includes(Number(res.statusCode)) && location && redirectCount < 5) {
        res.resume();
        resolve(downloadPreparedMedia(new URL(location, url).toString(), headers, redirectCount + 1));
        return;
      }
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume();
        reject(new Error(`Prepared media download failed: HTTP ${res.statusCode}`));
        return;
      }
      const contentLength = Number(res.headers && res.headers['content-length']) || 0;
      if (contentLength > MEDIA_PREPARE_MAX_BYTES) {
        res.resume();
        reject(new Error('Prepared media is too large'));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MEDIA_PREPARE_MAX_BYTES) {
          req.destroy(new Error('Prepared media is too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const head = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trim().toLowerCase();
        if (buffer.length < 512 || head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<body')) {
          reject(new Error('Prepared media download returned HTML instead of media'));
          return;
        }
        resolve({
          buffer,
          contentType: String(res.headers && res.headers['content-type'] || 'application/octet-stream'),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(MEDIA_PREPARE_DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error('Prepared media download timed out'));
    });
  });
}

function formatCleanupError(error) {
  return error && error.message ? error.message : String(error || '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson(text) {
  try {
    return JSON.parse(String(text || ''));
  } catch (error) {
    return null;
  }
}

function getAudioFormatFromUrl(url) {
  const clean = String(url || '').split('?')[0].split('#')[0].toLowerCase();
  const match = clean.match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1] : '';
  if (['mp3', 'wav', 'm4a', 'mp4', 'aac', 'ogg', 'flac', 'webm'].includes(ext)) return ext;
  return 'mp3';
}

function getHttpHeader(headers, name) {
  if (!headers || !name) return '';
  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find((item) => String(item).toLowerCase() === target);
  return key ? headers[key] : '';
}

function requestJson({ url, method = 'GET', headers = {}, body = null, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const normalizedMethod = String(method || 'GET').toUpperCase();
    const hasBody = body !== undefined && body !== null && normalizedMethod !== 'GET';
    const rawBody = !hasBody
      ? ''
      : (typeof body === 'string' ? body : JSON.stringify(body || {}));
    const req = https.request({
      method: normalizedMethod,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(hasBody ? { 'Content-Length': Buffer.byteLength(rawBody) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers || {},
          text,
          json: tryParseJson(text),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`${normalizedMethod} ${parsed.hostname} request timed out`));
    });
    if (hasBody) {
      req.end(rawBody);
    } else {
      req.end();
    }
  });
}

function postJson({ url, headers = {}, body = {}, timeoutMs = 30000 }) {
  return requestJson({
    url,
    method: 'POST',
    headers,
    body,
    timeoutMs,
  });
}

function getLegacySyncApiBase() {
  return String(process.env.LEGACY_SYNC_API_BASE || LEGACY_SYNC_API_BASE || '').trim().replace(/\/+$/, '');
}

function createLegacySyncOpenId(token) {
  const hash = crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 32);
  return hash ? `legacy-sync:${hash}` : '';
}

async function findLegacySyncOpenIdByToken(token, clientId) {
  const normalizedToken = String(token || '').trim();
  const normalizedClientId = String(clientId || '').trim();
  const base = getLegacySyncApiBase();
  if (!normalizedToken || !normalizedClientId || !base) return '';
  if (getCloudDataEnv() === PRODUCTION_WECHAT_DATA_ENV) return '';
  try {
    const response = await requestJson({
      url: `${base}/entitlements/status?plan=local_transcription_trial`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${normalizedToken}`,
        'X-Wechat-Inbox-Client-Id': normalizedClientId,
        Accept: 'application/json',
      },
      timeoutMs: 10000,
    });
    if (response.status >= 200
      && response.status < 300
      && response.json
      && response.json.success !== false) {
      return createLegacySyncOpenId(normalizedToken);
    }
  } catch (error) {
    console.warn('legacy sync token validation failed:', error && error.message ? error.message : error);
  }
  return '';
}

function getPaymentNotifyWebhookConfig() {
  const webhook = String(
    process.env.PAYMENT_NOTIFY_WEBHOOK
    || process.env.PAYMENT_NOTIFY_WEBHOOK_URL
    || process.env.FEISHU_FEEDBACK_WEBHOOK
    || ''
  ).trim();
  const enabledValue = String(process.env.PAYMENT_NOTIFY_ENABLED || '').trim().toLowerCase();
  return {
    webhook,
    webhookType: String(process.env.PAYMENT_NOTIFY_WEBHOOK_TYPE || 'feishu').trim().toLowerCase(),
    enabled: Boolean(webhook) && enabledValue !== 'false',
  };
}

async function notifyPaidPaymentOrder({ orderId, order, entitlement, source }) {
  const config = getPaymentNotifyWebhookConfig();
  if (!config.enabled) {
    if (orderId) {
      await db.collection('payment_orders').doc(orderId).update({
        data: {
          paymentNotifyStatus: 'skipped',
          paymentNotifyError: 'PAYMENT_NOTIFY_WEBHOOK is not configured',
        },
      });
    }
    return { status: 'skipped' };
  }
  const notifiedAt = new Date().toISOString();
  const response = await postJson({
    url: config.webhook,
    body: buildPaymentNotificationWebhookPayload({
      order,
      entitlement,
      source,
      webhookType: config.webhookType,
    }),
    timeoutMs: 10000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Payment notify webhook failed: HTTP ${response.status} ${String(response.text || '').slice(0, 200)}`);
  }
  if (orderId) {
    await db.collection('payment_orders').doc(orderId).update({
      data: {
        paymentNotifyStatus: 'sent',
        paymentNotifySentAt: notifiedAt,
        paymentNotifyError: '',
      },
    });
  }
  return { status: 'sent' };
}

async function recordPaymentNotifyFailure(orderId, error) {
  if (!orderId) return;
  await db.collection('payment_orders').doc(orderId).update({
    data: {
      paymentNotifyStatus: 'failed',
      paymentNotifyError: error.message || String(error),
    },
  });
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function getTencentOcrConfig(env = process.env || {}) {
  return {
    secretId: String(env.TENCENT_OCR_SECRET_ID || env.TENCENT_SECRET_ID || env.TENCENTCLOUD_SECRET_ID || '').trim(),
    secretKey: String(env.TENCENT_OCR_SECRET_KEY || env.TENCENT_SECRET_KEY || env.TENCENTCLOUD_SECRET_KEY || '').trim(),
    region: String(env.TENCENT_OCR_REGION || env.TENCENT_REGION || DEFAULT_TENCENT_OCR_REGION).trim() || DEFAULT_TENCENT_OCR_REGION,
    action: String(env.TENCENT_OCR_ACTION || DEFAULT_TENCENT_OCR_ACTION).trim() || DEFAULT_TENCENT_OCR_ACTION,
  };
}

function buildTencentCloudRequest({
  host,
  service,
  version,
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
    `host:${host}`,
    `x-tc-action:${String(action).toLowerCase()}`,
    '',
  ].join('\n');
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');
  const algorithm = 'TC3-HMAC-SHA256';
  const date = formatTencentDate(timestamp);
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    algorithm,
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign, 'hex');
  return {
    url: `https://${host}`,
    headers: {
      Authorization: `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
    },
    body,
  };
}

async function runTencentOcr(image, options = {}) {
  const config = getTencentOcrConfig(options.env || process.env || {});
  if (!config.secretId || !config.secretKey) {
    throw new Error('TENCENT_OCR_SECRET_ID/TENCENT_OCR_SECRET_KEY is not configured');
  }
  const imageBase64 = String(image && image.imageBase64 || '').trim();
  const imageUrl = String(image && image.imageUrl || '').trim();
  const body = imageBase64
    ? { ImageBase64: imageBase64 }
    : { ImageUrl: imageUrl };
  const request = buildTencentCloudRequest({
    host: TENCENT_OCR_HOST,
    service: TENCENT_OCR_SERVICE,
    version: TENCENT_OCR_VERSION,
    action: config.action,
    region: config.region,
    secretId: config.secretId,
    secretKey: config.secretKey,
    body,
  });
  const { Host, ...headers } = request.headers;
  const response = await postJson({
    url: request.url,
    headers,
    body: request.body,
    timeoutMs: 30000,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Tencent OCR HTTP ${response.status}: ${String(response.text || '').slice(0, 200)}`);
  }
  const payload = response.json || {};
  const data = payload.Response || payload;
  if (data.Error) {
    throw new Error(`${data.Error.Code}: ${data.Error.Message}`);
  }
  const detections = Array.isArray(data.TextDetections) ? data.TextDetections : [];
  return detections
    .map((item) => String(item && (item.DetectedText || item.AdvancedInfo || '') || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildDoubaoSubmitRequest({ apiKey, audioUrl, requestId }) {
  return {
    url: DOUBAO_ASR_SUBMIT_URL,
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': DOUBAO_ASR_RESOURCE_ID,
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: {
      user: {
        uid: 'wechat-inbox-sync-cloud',
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

function buildDoubaoQueryRequest({ apiKey, requestId }) {
  return {
    url: DOUBAO_ASR_QUERY_URL,
    headers: {
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': DOUBAO_ASR_RESOURCE_ID,
      'X-Api-Request-Id': requestId,
    },
    body: {},
  };
}

function formatDoubaoHttpError(response) {
  const parts = [`豆包语音识别请求失败：HTTP ${response && response.status}`];
  ['x-api-status-code', 'x-api-message', 'x-api-request-id'].forEach((name) => {
    const value = getHttpHeader(response && response.headers, name);
    if (value) parts.push(`${name}=${value}`);
  });
  const body = String((response && (response.text || JSON.stringify(response.json || ''))) || '').trim();
  if (body) parts.push(body.slice(0, 500));
  return parts.join('；');
}

function normalizeDoubaoSpeakerText(result) {
  if (!result || typeof result !== 'object') return '';
  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  if (utterances.length) {
    return utterances
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
      .trim();
  }
  return '';
}

function normalizeDoubaoTimeToSeconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 1000 ? Math.ceil(number / 1000) : Math.ceil(number);
}

function getDoubaoUtteranceEndSeconds(item = {}) {
  const additions = item && item.additions && typeof item.additions === 'object' ? item.additions : {};
  return normalizeDoubaoTimeToSeconds(
    item.end_time
    || item.endTime
    || item.end
    || item.end_ms
    || item.endMs
    || additions.end_time
    || additions.endTime
    || additions.end
    || additions.end_ms
    || additions.endMs
  );
}

function getDoubaoResultDurationSeconds(result) {
  if (!result || typeof result !== 'object') return 0;
  const directDuration = normalizeDoubaoTimeToSeconds(
    result.duration
    || result.duration_ms
    || result.durationMs
    || result.audio_duration
    || result.audioDuration
  );
  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  const utteranceDuration = utterances.reduce((maxValue, item) => Math.max(maxValue, getDoubaoUtteranceEndSeconds(item)), 0);
  return Math.max(directDuration, utteranceDuration);
}

function getDoubaoPayloadDurationSeconds(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const result = data && data.result;
  if (Array.isArray(result)) {
    return result.reduce((maxValue, item) => Math.max(maxValue, getDoubaoResultDurationSeconds(item)), 0);
  }
  return getDoubaoResultDurationSeconds(result || data);
}

function parseDoubaoResult(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const result = data && data.result;
  if (Array.isArray(result)) {
    return result
      .map((item) => normalizeDoubaoSpeakerText(item) || String((item && (item.text || item.result_text || item.utterance_text)) || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  const speakerText = normalizeDoubaoSpeakerText(result);
  if (speakerText) return speakerText;
  const text = (result && (result.text || result.result_text))
    || (data && (data.text || data.transcription))
    || '';
  return String(text || '').trim();
}

function parseDoubaoTaskState(response) {
  if (response.status && (response.status < 200 || response.status >= 300)) {
    throw new Error(formatDoubaoHttpError(response));
  }
  const statusCode = getHttpHeader(response.headers, 'x-api-status-code');
  if (statusCode && statusCode !== '20000000') {
    if (statusCode === '20000001' || statusCode === '20000002') {
      return {
        status: 'processing',
        transcription: '',
      };
    }
    throw new Error(formatDoubaoHttpError(response));
  }
  const transcription = parseDoubaoResult(response.json || response.text);
  return {
    status: transcription ? 'success' : 'empty',
    transcription,
    durationSeconds: getDoubaoPayloadDurationSeconds(response.json || response.text),
  };
}

async function runDoubaoCloudTranscription(audioUrl, options = {}) {
  const apiKey = String((options.env || process.env || {}).DOUBAO_ASR_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('DOUBAO_ASR_API_KEY is not configured');
  }
  const requestId = createRequestId();
  const submit = buildDoubaoSubmitRequest({ apiKey, audioUrl, requestId });
  const submitResponse = await postJson(submit);
  const submitState = parseDoubaoTaskState(submitResponse);
  if (submitState.status === 'success') {
    return {
      transcription: submitState.transcription,
      durationSeconds: submitState.durationSeconds || 0,
      requestId,
      provider: 'doubao',
    };
  }
  const attempts = Math.max(1, Number(process.env.CLOUD_ASR_POLL_ATTEMPTS) || DEFAULT_CLOUD_ASR_POLL_ATTEMPTS);
  const intervalMs = Math.max(1000, Number(process.env.CLOUD_ASR_POLL_INTERVAL_MS) || DEFAULT_CLOUD_ASR_POLL_INTERVAL_MS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(intervalMs);
    const query = buildDoubaoQueryRequest({ apiKey, requestId });
    const queryResponse = await postJson(query);
    const state = parseDoubaoTaskState(queryResponse);
    if (state.status === 'success') {
      return {
        transcription: state.transcription,
        durationSeconds: state.durationSeconds || 0,
        requestId,
        provider: 'doubao',
      };
    }
  }
  throw new Error('豆包语音识别仍在处理中，请稍后重试');
}

function normalizeEvent(event) {
  return {
    method: event.httpMethod || event.method || 'GET',
    path: event.path || event.requestPath || '/',
    query: event.queryStringParameters || event.query || {},
    headers: event.headers || {},
    body: event.body || '',
  };
}

function getRequestHost(request) {
  return String(
    getHttpHeader(request && request.headers, 'x-forwarded-host')
    || getHttpHeader(request && request.headers, 'host')
    || ''
  ).trim();
}

function getRequestProtocol(request) {
  return String(
    getHttpHeader(request && request.headers, 'x-forwarded-proto')
    || getHttpHeader(request && request.headers, 'x-forwarded-protocol')
    || ''
  ).trim().split(',')[0] || 'https';
}

function buildFeishuOAuthRedirectUri(request) {
  const explicit = String(process.env.FEISHU_OAUTH_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const host = getRequestHost(request);
  if (!host) return '';
  const path = String((request && request.path) || '/sync/feishu/oauth/start')
    .replace(/\/feishu\/oauth\/start(?:\/)?$/i, '/feishu/oauth/callback');
  return `${getRequestProtocol(request)}://${host}${path}`;
}

function getFeishuOAuthConfig(request, options = {}) {
  const requireRedirect = options.requireRedirect !== false;
  const customApp = normalizeFeishuOAuthAppConfig(options.appConfig || null);
  const appId = customApp
    ? customApp.appId
    : String(process.env.FEISHU_APP_ID || '').trim();
  const appSecret = customApp
    ? customApp.appSecret
    : String(process.env.FEISHU_APP_SECRET || '').trim();
  const redirectUri = buildFeishuOAuthRedirectUri(request);
  const scopes = normalizeScopeList([
    process.env.FEISHU_OAUTH_SCOPES || DEFAULT_FEISHU_OAUTH_SCOPES,
    DEFAULT_FEISHU_OAUTH_SCOPES,
  ]);
  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET is not configured');
  }
  if (requireRedirect && !redirectUri) {
    throw new Error('FEISHU_OAUTH_REDIRECT_URI is not configured');
  }
  return {
    appId,
    appSecret,
    appSource: customApp ? 'custom' : 'default',
    appIdMasked: maskFeishuAppId(appId),
    redirectUri,
    scopes,
  };
}

async function ensureCollection(name) {
  if (typeof db.createCollection !== 'function') return;
  try {
    await db.createCollection(name);
  } catch (error) {
    // Collection already exists or the runtime does not allow explicit creation.
  }
}

function isDatabaseCollectionNotExistError(error) {
  const message = String((error && (error.message || error.errMsg || error.code)) || error || '');
  return /DATABASE_COLLECTION_NOT_EXIST|collection does not exist|Table not exist|ResourceNotFound/i.test(message);
}

function isIsoAfterNow(value, now = new Date().toISOString()) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) && time > new Date(now).getTime();
}

function isTokenExpiringSoon(value, now = Date.now()) {
  const time = new Date(value || '').getTime();
  return !Number.isFinite(time) || time <= now + 2 * 60 * 1000;
}

function formatFeishuOAuthHttpError(response) {
  const payload = (response && response.json) || {};
  return payload.error_description
    || payload.msg
    || payload.message
    || (response && response.text)
    || `Feishu OAuth HTTP ${response && response.status}`;
}

async function requestFeishuOAuthToken(request) {
  const response = await postJson({
    url: request.url,
    body: request.body,
    timeoutMs: 30000,
  });
  const payload = response.json || {};
  if (!response.status || response.status < 200 || response.status >= 300) {
    throw new Error(formatFeishuOAuthHttpError(response));
  }
  if (payload && Number(payload.code || 0) !== 0) {
    throw new Error(formatFeishuOAuthHttpError(response));
  }
  return payload;
}

function getFeishuOAuthStateCode(state) {
  return `FEISHU_OAUTH_STATE_${String(state || '').trim()}`;
}

async function findFeishuOAuthStateDoc(state) {
  const stateCode = getFeishuOAuthStateCode(state);
  const collections = [FEISHU_OAUTH_STORE_COLLECTION, FEISHU_OAUTH_LEGACY_STORE_COLLECTION];
  for (const collectionName of collections) {
    try {
      const result = await db
        .collection(collectionName)
        .where({ code: stateCode })
        .limit(1)
        .get();
      const doc = result.data && result.data[0] ? result.data[0] : null;
      if (doc && doc.kind === FEISHU_OAUTH_STATE_KIND) {
        return {
          ...doc,
          _oauthCollection: collectionName,
        };
      }
    } catch (error) {
      if (!isDatabaseCollectionNotExistError(error)) throw error;
    }
  }
  return null;
}

async function findBindCodeForFeishuOAuth(openid, clientId, bindingToken) {
  const candidates = getBindCodeLookupCandidates(bindingToken);
  if (!candidates.length) return null;
  const result = await db
    .collection('bind_codes')
    .where({
      code: _.in(candidates),
      status: _.neq('revoked'),
    })
    .limit(10)
    .get();
  const bindCode = pickFirstRealBindCode(result.data || []);
  if (!bindCode || bindCode.status !== 'bound') return null;
  if (String(bindCode.openid || '').trim() !== String(openid || '').trim()) return null;
  return isBindClientAllowed(bindCode, clientId) ? bindCode : null;
}

async function findFeishuOAuthToken(openid, clientId, bindingToken = '') {
  try {
    const bindCode = await findBindCodeForFeishuOAuth(openid, clientId, bindingToken);
    const token = bindCode && bindCode.feishuOAuth && typeof bindCode.feishuOAuth === 'object'
      ? bindCode.feishuOAuth
      : null;
    return token ? { ...token, _bindCodeId: bindCode._id } : null;
  } catch (error) {
    if (isDatabaseCollectionNotExistError(error)) return null;
    throw error;
  }
}

async function saveFeishuOAuthToken(openid, clientId, tokenData, extra = {}, bindingToken = '') {
  const bindCode = await findBindCodeForFeishuOAuth(openid, clientId, bindingToken);
  if (!bindCode || !bindCode._id) {
    throw new Error('Feishu OAuth binding code not found');
  }
  const now = new Date().toISOString();
  const data = {
    openid,
    clientId,
    accessToken: tokenData.accessToken,
    accessTokenExpiresAt: tokenData.accessTokenExpiresAt,
    refreshToken: tokenData.refreshToken,
    refreshTokenExpiresAt: tokenData.refreshTokenExpiresAt,
    scope: tokenData.scope || '',
    updatedAt: now,
    ...extra,
  };
  await db.collection('bind_codes').doc(bindCode._id).update({
    data: {
      feishuOAuth: {
        ...(bindCode.feishuOAuth && typeof bindCode.feishuOAuth === 'object' ? bindCode.feishuOAuth : {}),
        ...data,
        createdAt: bindCode.feishuOAuth && bindCode.feishuOAuth.createdAt || now,
      },
      feishuOAuthUpdatedAt: now,
    },
  });
  return data;
}

async function refreshFeishuOAuthToken(openid, clientId, token, config, bindingToken = '') {
  const refreshToken = String(token && token.refreshToken || '').trim();
  if (!refreshToken) {
    throw new Error('Feishu is not connected. Please connect Feishu again.');
  }
  if (token.refreshTokenExpiresAt && !isIsoAfterNow(token.refreshTokenExpiresAt)) {
    throw new Error('Feishu authorization expired. Please connect Feishu again.');
  }
  const payload = await requestFeishuOAuthToken(buildFeishuOAuthRefreshRequest({
    appId: config.appId,
    appSecret: config.appSecret,
    refreshToken,
  }));
  const tokenData = normalizeFeishuOAuthTokenPayload(payload);
  return await saveFeishuOAuthToken(openid, clientId, tokenData, {
    appId: token.appId || config.appId,
    appSource: token.appSource || config.appSource || 'default',
    lastRefreshedAt: new Date().toISOString(),
  }, bindingToken);
}

async function ensureFeishuAccessToken(openid, clientId, config, bindingToken = '') {
  const token = await findFeishuOAuthToken(openid, clientId, bindingToken);
  if (!token) {
    throw new Error('Feishu is not connected. Please connect Feishu first.');
  }
  const tokenAppId = String(token.appId || '').trim();
  const configAppId = String(config && config.appId || '').trim();
  if (tokenAppId && configAppId && tokenAppId !== configAppId) {
    throw new Error('Feishu App ID does not match the connected authorization. Please reconnect Feishu with the current App ID.');
  }
  if (token.accessToken && !isTokenExpiringSoon(token.accessTokenExpiresAt)) {
    return token.accessToken;
  }
  const refreshed = await refreshFeishuOAuthToken(openid, clientId, token, config, bindingToken);
  return refreshed.accessToken;
}

function normalizeBindDeviceLimit(bindCode) {
  const value = Number(bindCode && bindCode.deviceLimit) || DEFAULT_BIND_DEVICE_LIMIT;
  return Math.min(MAX_BIND_DEVICE_LIMIT, Math.max(DEFAULT_BIND_DEVICE_LIMIT, value));
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

function getChinaLocalDay(now = new Date().toISOString()) {
  const date = new Date(now);
  const time = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getAnalyticsEventDocumentId(openid, eventName, day) {
  const safeOpenId = String(openid || '').replace(/[^A-Za-z0-9_-]/g, '_');
  return `analytics_${eventName}_${day}_${safeOpenId}`;
}

async function recordAnalyticsEvent(openid, eventName, payload = {}) {
  if (!openid || !eventName) return;
  const now = new Date().toISOString();
  const day = getChinaLocalDay(now);
  const documentId = getAnalyticsEventDocumentId(openid, eventName, day);
  if (typeof db.createCollection === 'function') {
    try {
      await db.createCollection('analytics_events');
    } catch (error) {
      // The collection already exists in normal use.
    }
  }
  try {
    await db.collection('analytics_events').add({
      data: {
        _id: documentId,
        openid,
        eventName,
        day,
        count: 1,
        firstAt: now,
        lastAt: now,
        payload,
      },
    });
  } catch (error) {
    await db.collection('analytics_events').doc(documentId).update({
      data: {
        count: _.inc(1),
        lastAt: now,
        payload,
      },
    });
  }
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

function addDaysIso(now, days) {
  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return '';
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString();
}

function getDefaultCloudQuotaSeconds(durationDays) {
  const days = Number(durationDays) || 30;
  if (days <= 7) return 20 * 60;
  if (days <= 31) return 60 * 60;
  if (days <= 100) return 240 * 60;
  return 1000 * 60;
}

function getBuiltInRedeemCodeDocument(code, now = new Date().toISOString()) {
  if (normalizeRedeemCode(code) !== 'ZZAI0603') return null;
  return {
    code: 'ZZAI0603',
    status: 'active',
    plan: DEFAULT_REDEEM_PLAN,
    durationDays: 30,
    cloudQuotaSeconds: getDefaultCloudQuotaSeconds(30),
    maxRedemptions: 1,
    redeemedCount: 0,
    note: 'built-in-test-code',
    createdAt: now,
    updatedAt: now,
  };
}

function isRedeemCodeActive(codeDoc, now) {
  if (!codeDoc) return false;
  if (codeDoc.status && codeDoc.status !== 'active') return false;
  const expiresAt = codeDoc.expiresAt || '';
  if (expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime()) return false;
  const redeemedCount = Number(codeDoc.redeemedCount) || 0;
  return redeemedCount < 1;
}

function buildEntitlementState(entitlement, now = new Date().toISOString()) {
  if (!entitlement) {
    return {
      hasAccess: false,
      plan: '',
      status: 'inactive',
      expiresAt: '',
      code: '',
      source: '',
      durationDays: 0,
    };
  }
  const expiresAt = entitlement.expiresAt || '';
  const isExpired = expiresAt && new Date(expiresAt).getTime() <= new Date(now).getTime();
  const status = isExpired ? 'expired' : (entitlement.status || 'active');
  return {
    hasAccess: status === 'active',
    plan: entitlement.plan || DEFAULT_REDEEM_PLAN,
    status,
    expiresAt,
    code: normalizeRedeemCode(entitlement.code),
    source: entitlement.source || '',
    durationDays: Number(entitlement.durationDays) || 0,
  };
}

function getAutoRedeemCodeOwnerScore(codeDoc, openid) {
  if (!codeDoc || !openid) return 0;
  if (codeDoc.paidOwnerOpenid === openid) return 100;
  if (codeDoc.trialOwnerOpenid === openid) return 80;
  if (codeDoc.deliveredTo === openid) return 60;
  if (codeDoc.openid === openid) return 40;
  return 0;
}

function getAutoRedeemCodeTimeScore(codeDoc) {
  const values = [
    codeDoc && codeDoc.entitlementExpiresAt,
    codeDoc && codeDoc.accessExpiresAt,
    codeDoc && codeDoc.expiresAt,
    codeDoc && codeDoc.updatedAt,
    codeDoc && codeDoc.createdAt,
  ];
  for (const value of values) {
    const time = new Date(value || '').getTime();
    if (!Number.isNaN(time)) return time;
  }
  return 0;
}

function pickAutoRedeemCode(codes = [], openid, now = new Date().toISOString()) {
  const byId = new Map();
  (codes || []).forEach((codeDoc) => {
    if (!codeDoc || !codeDoc.code) return;
    const key = codeDoc._id || normalizeRedeemCode(codeDoc.code);
    if (!key || byId.has(key)) return;
    if (!isRedeemCodeActive(codeDoc, now)) return;
    if (!isLocalTranscriptionPlan(codeDoc.plan || DEFAULT_REDEEM_PLAN)) return;
    if (!getAutoRedeemCodeOwnerScore(codeDoc, openid)) return;
    byId.set(key, codeDoc);
  });
  return Array.from(byId.values()).sort((a, b) => {
    const ownerDiff = getAutoRedeemCodeOwnerScore(b, openid) - getAutoRedeemCodeOwnerScore(a, openid);
    if (ownerDiff) return ownerDiff;
    return getAutoRedeemCodeTimeScore(b) - getAutoRedeemCodeTimeScore(a);
  })[0] || null;
}

async function listBindCodesByClientId(clientId) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) return [];

  const byId = new Map();
  const addDocs = (docs) => {
    (docs || []).forEach((doc) => {
      if (!isRealBindCodeDocument(doc)) return;
      const key = String((doc && (doc._id || doc.code)) || '').trim();
      if (!key) return;
      byId.set(key, doc);
    });
  };

  const legacyResult = await db
    .collection('bind_codes')
    .where({
      clientId: normalizedClientId,
      status: _.neq('revoked'),
    })
    .limit(100)
    .get();
  addDocs(legacyResult.data || []);

  try {
    const clientsResult = await db
      .collection('bind_codes')
      .where({
        'clients.clientId': normalizedClientId,
        status: _.neq('revoked'),
      })
      .limit(100)
      .get();
    addDocs(clientsResult.data || []);
  } catch (error) {
    console.warn('Failed to query bind code clients by clientId:', error && error.message ? error.message : error);
  }

  return Array.from(byId.values());
}

async function listActiveProOpenids(openids, now = new Date().toISOString()) {
  const normalizedOpenids = Array.from(new Set((openids || [])
    .map((openid) => String(openid || '').trim())
    .filter(Boolean)));
  if (!normalizedOpenids.length) return [];

  const result = await db
    .collection('user_entitlements')
    .where({
      openid: _.in(normalizedOpenids),
    })
    .limit(100)
    .get();

  const byOpenid = new Map();
  (result.data || []).forEach((entitlement) => {
    const openid = String((entitlement && entitlement.openid) || '').trim();
    if (!openid) return;
    if (!byOpenid.has(openid)) byOpenid.set(openid, []);
    byOpenid.get(openid).push(entitlement);
  });

  return Array.from(byOpenid.entries())
    .filter(([, entitlements]) => {
      const formalProEntitlements = (entitlements || [])
        .filter((entitlement) => isFormalProPlan(entitlement && entitlement.plan));
      const best = pickBestLocalTranscriptionEntitlement(formalProEntitlements);
      return buildEntitlementState(best, now).hasAccess;
    })
    .map(([openid]) => openid);
}

function buildPluginBindingLimitMessage(limitState) {
  if (limitState && limitState.hasProBinding) {
    return 'Pro 版最多绑定 3 个微信。';
  }
  return '免费版最多绑定 1 个微信，开通 Pro 后可绑定 3 个。';
}

async function checkPluginBindingLimitForClient({ clientId, targetBindCode, now = new Date().toISOString() }) {
  const existingBindCodes = await listBindCodesByClientId(clientId);
  const openids = [
    ...existingBindCodes.map((bindCode) => bindCode && bindCode.openid),
    targetBindCode && targetBindCode.openid,
  ];
  const proOpenids = await listActiveProOpenids(openids, now);
  return evaluatePluginBindingLimit({
    clientId,
    existingBindCodes,
    targetBindCode,
    proOpenids,
  });
}

async function ensureCollection(name) {
  if (!name || typeof db.createCollection !== 'function') return;
  try {
    await db.createCollection(name);
  } catch (error) {
    // Collection already exists.
  }
}

async function ensurePaidRedeemCodeForPayment({ openid, order, entitlement, now }) {
  await ensureCollection('redeem_codes');
  let code = normalizeRedeemCode(entitlement && entitlement.code);

  if (!code) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const [candidate] = createAdminRedeemCodeDocuments({
        count: 1,
        prefix: 'OBPRO',
        durationDays: Number(entitlement && entitlement.durationDays) || 30,
        note: 'virtual-payment-pro',
        plan: DEFAULT_REDEEM_PLAN,
        now,
      });
      const candidateCode = normalizeRedeemCode(candidate && candidate.code);
      const exists = await db.collection('redeem_codes')
        .where({ code: candidateCode })
        .limit(1)
        .get();
      if (exists.data && exists.data[0]) continue;
      const paidCodeDoc = createPaidRedeemCodeDocument({
        code: candidateCode,
        openid,
        entitlement,
        order,
        now,
        existingCodeDoc: candidate,
      });
      const { _id, ...data } = paidCodeDoc;
      await db.collection('redeem_codes').add({ data });
      return {
        ...entitlement,
        code: paidCodeDoc.code,
      };
    }
    throw new Error('Failed to create paid redeem code');
  }

  const codeResult = await db.collection('redeem_codes')
    .where({ code })
    .limit(1)
    .get();
  const existingCodeDoc = codeResult.data && codeResult.data[0] ? codeResult.data[0] : {};
  const paidCodeDoc = createPaidRedeemCodeDocument({
    code,
    openid,
    entitlement,
    order,
    now,
    existingCodeDoc,
  });
  const { _id, ...data } = paidCodeDoc;
  if (existingCodeDoc && existingCodeDoc._id) {
    await db.collection('redeem_codes').doc(existingCodeDoc._id).update({ data });
  } else {
    await db.collection('redeem_codes').add({ data });
  }
  return {
    ...entitlement,
    code: paidCodeDoc.code,
  };
}

async function applyPaidPaymentOrder(order, now = new Date().toISOString()) {
  await ensureCollection('user_entitlements');
  const currentResult = await db
    .collection('user_entitlements')
    .where({
      openid: order.openid,
    })
    .limit(100)
    .get();
  const carryover = pickPaymentCarryoverEntitlement(currentResult.data || [], now);
  const current = carryover.current;
  const entitlement = createPaidEntitlementFromOrder({
    order,
    now,
    baseExpiresAt: current && current.expiresAt,
  });
  let updateData = mergePaidEntitlementWithCarryover({
    entitlement,
    current,
    codeSource: carryover.codeSource,
    order,
    now,
  });
  updateData = await ensurePaidRedeemCodeForPayment({
    openid: order.openid,
    order,
    entitlement: updateData,
    now,
  });
  if (current && current._id) {
    await db.collection('user_entitlements').doc(current._id).update({ data: updateData });
  } else {
    await db.collection('user_entitlements').add({ data: updateData });
  }
  return updateData;
}

async function processVirtualPaymentNotify(notify = {}) {
  if (notify.event && notify.event !== 'xpay_goods_deliver_notify') {
    return {
      ignored: true,
      event: notify.event,
    };
  }
  const orderNo = String(notify.orderNo || '').trim();
  if (!orderNo) throw new Error('Missing payment order number');

  await ensureCollection('payment_orders');
  const result = await db
    .collection('payment_orders')
    .where({ orderNo })
    .limit(1)
    .get();
  const order = result.data && result.data[0] ? result.data[0] : null;
  if (!order || !order._id) throw new Error('Payment order not found');

  const notifyOpenId = String(notify.openid || '').trim();
  if (notifyOpenId && order.openid && notifyOpenId !== order.openid) {
    throw new Error('Payment notification OpenID mismatch');
  }
  const notifyProductId = String(notify.productId || '').trim();
  if (notifyProductId && order.productId && notifyProductId !== order.productId) {
    throw new Error('Payment notification product mismatch');
  }

  const now = new Date().toISOString();
  const paidAt = order.paidAt || notify.paidAt || now;
  const updateData = {
    status: 'paid',
    paidAt,
    updatedAt: now,
    payMode: 'virtual_payment',
    paymentEnabled: true,
    virtualPaymentNotifiedAt: now,
  };
  if (notify.transactionId) updateData.transactionId = notify.transactionId;
  if (notify.mchOrderNo) updateData.mchOrderNo = notify.mchOrderNo;

  let entitlement = null;
  if (order.status !== 'paid') {
    entitlement = await applyPaidPaymentOrder({ ...order, ...updateData }, paidAt);
  }
  await db.collection('payment_orders').doc(order._id).update({ data: updateData });
  if (entitlement) {
    try {
      await notifyPaidPaymentOrder({
        orderId: order._id,
        order: { ...order, ...updateData },
        entitlement,
        source: '微信支付回调',
      });
    } catch (error) {
      await recordPaymentNotifyFailure(order._id, error);
    }
  }

  return {
    ...buildPaymentOrderState({ ...order, ...updateData }),
    entitlement: entitlement ? buildEntitlementState(entitlement, paidAt) : null,
  };
}

function createRepository() {
  return {
    virtualPaymentNotifyToken: String(
      process.env.VIRTUAL_PAY_NOTIFY_TOKEN
      || process.env.WECHAT_MESSAGE_TOKEN
      || ''
    ).trim(),

    async bindClientByToken(token, clientId) {
      const candidates = getBindCodeLookupCandidates(token);
      const result = await db
        .collection('bind_codes')
        .where({
          code: _.in(candidates),
          status: _.neq('revoked'),
        })
        .limit(10)
        .get();

      const bindCode = pickFirstRealBindCode(result.data || []);
      if (!bindCode) {
        return { status: 'invalid' };
      }

      const boundAt = new Date().toISOString();
      const limitResult = await checkPluginBindingLimitForClient({
        clientId,
        targetBindCode: bindCode,
        now: boundAt,
      });
      if (!limitResult.allowed) {
        return {
          status: 'plugin-binding-limit-exceeded',
          currentCount: limitResult.currentCount,
          limit: limitResult.limit,
          hasProBinding: limitResult.hasProBinding,
          reason: limitResult.reason,
          errMsg: buildPluginBindingLimitMessage(limitResult),
        };
      }

      const bindResult = bindClientToCodeDocument(bindCode, clientId, boundAt);
      if (!bindResult || bindResult.status === 'invalid') {
        return { status: 'invalid' };
      }
      if (bindResult.status === 'already-bound') {
        return { status: 'already-bound' };
      }
      if (bindResult.data) {
        await db.collection('bind_codes').doc(bindCode._id).update({
          data: bindResult.data,
        });
      }
      await recordAnalyticsEvent(bindResult.openid, 'bind_success', {
        clientId,
        status: bindResult.status,
      });

      return {
        status: 'bound',
        openid: bindResult.openid,
        boundAt: bindResult.boundAt || boundAt,
      };
    },

    async findOpenIdByToken(token, clientId) {
      const candidates = getBindCodeLookupCandidates(token);
      const result = await db
        .collection('bind_codes')
        .where({
          code: _.in(candidates),
          status: _.neq('revoked'),
        })
        .limit(10)
        .get();

      const bindCode = pickFirstRealBindCode(result.data || []);
      if (!bindCode || bindCode.status !== 'bound') {
        return await findLegacySyncOpenIdByToken(token, clientId);
      }

      if (isBindClientAllowed(bindCode, clientId)) return bindCode.openid;
      return await findLegacySyncOpenIdByToken(token, clientId);
    },

    async unbindClientByToken(token, clientId) {
      const candidates = getBindCodeLookupCandidates(token);
      const result = await db
        .collection('bind_codes')
        .where({
          code: _.in(candidates),
          status: _.neq('revoked'),
        })
        .limit(10)
        .get();

      const bindCode = pickFirstRealBindCode(result.data || []);
      if (!bindCode) {
        return { status: 'invalid' };
      }

      const unboundAt = new Date().toISOString();
      const unbindResult = unbindClientFromCodeDocument(bindCode, clientId, unboundAt);
      if (!unbindResult || unbindResult.status === 'invalid') {
        return { status: 'invalid' };
      }
      if (unbindResult.status === 'not-found') {
        return { status: 'not-found' };
      }

      await db.collection('bind_codes').doc(bindCode._id).update({
        data: unbindResult.data,
      });

      return {
        status: 'updated',
      };
    },

    async createFeishuOAuthStart(openid, clientId, request, payload = {}, bindingToken = '') {
      const config = getFeishuOAuthConfig(request, {
        appConfig: payload && payload.feishuApp,
      });
      const stateData = createFeishuOAuthState();
      await ensureCollection(FEISHU_OAUTH_STORE_COLLECTION);
      await db.collection(FEISHU_OAUTH_STORE_COLLECTION).add({
        data: {
          kind: FEISHU_OAUTH_STATE_KIND,
          code: getFeishuOAuthStateCode(stateData.state),
          ...stateData,
          openid,
          clientId,
          bindingToken: normalizeBindCodeInput(bindingToken),
          appId: config.appId,
          appSecret: config.appSource === 'custom' ? config.appSecret : '',
          appSource: config.appSource,
          redirectUri: config.redirectUri,
          scopes: config.scopes,
          status: 'pending',
        },
      });
      return {
        authUrl: buildFeishuAuthorizeUrl({
          appId: config.appId,
          redirectUri: config.redirectUri,
          state: stateData.state,
          scopes: config.scopes,
        }),
        expiresAt: stateData.expiresAt,
        scope: config.scopes.join(' '),
        appSource: config.appSource,
        appId: config.appIdMasked,
      };
    },

    async completeFeishuOAuthCallback({ code, state }) {
      const stateDoc = await findFeishuOAuthStateDoc(state);
      if (!stateDoc || stateDoc.kind !== FEISHU_OAUTH_STATE_KIND) {
        throw new Error('Feishu OAuth state not found');
      }
      if (stateDoc.usedAt) {
        return { connected: true, reused: true };
      }
      if (!isIsoAfterNow(stateDoc.expiresAt)) {
        throw new Error('Feishu OAuth state expired');
      }
      const appId = String(stateDoc.appId || process.env.FEISHU_APP_ID || '').trim();
      const appSecret = String(stateDoc.appSecret || process.env.FEISHU_APP_SECRET || '').trim();
      const appSource = String(stateDoc.appSource || (stateDoc.appId ? 'custom' : 'default')).trim() || 'default';
      const redirectUri = String(stateDoc.redirectUri || process.env.FEISHU_OAUTH_REDIRECT_URI || '').trim();
      if (!appId || !appSecret || !redirectUri) {
        throw new Error('Feishu OAuth is not configured');
      }
      const payload = await requestFeishuOAuthToken(buildFeishuOAuthTokenRequest({
        appId,
        appSecret,
        code,
        redirectUri,
      }));
      const tokenData = normalizeFeishuOAuthTokenPayload(payload);
      await saveFeishuOAuthToken(stateDoc.openid, stateDoc.clientId, tokenData, {
        appId,
        appSource,
        authorizedAt: new Date().toISOString(),
      }, stateDoc.bindingToken);
      await db.collection(stateDoc._oauthCollection || FEISHU_OAUTH_STORE_COLLECTION).doc(stateDoc._id).update({
        data: {
          status: 'used',
          usedAt: new Date().toISOString(),
          appSecret: '',
        },
      });
      return {
        connected: true,
      };
    },

    async getFeishuOAuthStatus(openid, clientId, bindingToken = '') {
      const token = await findFeishuOAuthToken(openid, clientId, bindingToken);
      if (!token) {
        return {
          connected: false,
          status: 'not_connected',
        };
      }
      const refreshExpired = token.refreshTokenExpiresAt && !isIsoAfterNow(token.refreshTokenExpiresAt);
      return {
        connected: !refreshExpired,
        status: refreshExpired ? 'expired' : 'connected',
        expiresAt: token.accessTokenExpiresAt || '',
        refreshExpiresAt: token.refreshTokenExpiresAt || '',
        scope: token.scope || '',
        appSource: token.appSource || 'default',
        appId: maskFeishuAppId(token.appId || ''),
        updatedAt: token.updatedAt || '',
      };
    },

    async extractFeishuDocument(openid, clientId, payload, bindingToken = '') {
      const config = getFeishuOAuthConfig({
        path: '/sync/feishu/oauth/callback',
        headers: {},
      }, {
        requireRedirect: false,
        appConfig: payload && payload.feishuApp,
      });
      const accessToken = await ensureFeishuAccessToken(openid, clientId, config, bindingToken);
      const result = await fetchFeishuOpenApiBlocksFromUrl({
        url: payload.url,
        accessToken,
        requestJson,
      });
      await recordAnalyticsEvent(openid, 'feishu_openapi_extract', {
        clientId,
        blockCount: result.blockCount,
        documentId: result.documentId,
      });
      return result;
    },

    async getEntitlement(openid, plan, context = {}) {
      const clientId = String(context && context.clientId || '').trim();
      if (isLocalTranscriptionPlan(plan)) {
        const result = await db
          .collection('user_entitlements')
          .where({
            openid,
          })
          .limit(100)
          .get();

        return pickBestLocalTranscriptionEntitlement(result.data || []);
      }

      const result = await db
        .collection('user_entitlements')
        .where({
          openid,
          plan,
          status: 'active',
        })
        .orderBy('redeemedAt', 'desc')
        .limit(1)
        .get();

      const entitlement = result.data && result.data[0] ? result.data[0] : null;
      return isRedeemEntitlementAllowedForClient(entitlement, clientId) ? entitlement : null;
    },

    async getEntitlementByCode(openid, code, context = {}) {
      const normalizedCode = normalizeRedeemCode(code);
      if (!normalizedCode) return null;
      const clientId = String(context && context.clientId || '').trim();
      const result = await db
        .collection('user_entitlements')
        .where({
          openid,
          code: normalizedCode,
        })
        .limit(100)
        .get();
      return pickBestLocalTranscriptionEntitlement(result.data || []);
    },

    async redeemAccessCode(openid, code, context = {}) {
      const now = new Date().toISOString();
      const clientId = String(context && context.clientId || '').trim();
      const existingEntitlement = await this.getEntitlementByCode(openid, code, context);
      if (buildEntitlementState(existingEntitlement, now).hasAccess) {
        return buildEntitlementState(existingEntitlement, now);
      }
      const codeResult = await db
        .collection('redeem_codes')
        .where({ code })
        .limit(1)
        .get();
      const codeDoc = codeResult.data && codeResult.data[0] ? codeResult.data[0] : null;
      const effectiveCodeDoc = codeDoc || getBuiltInRedeemCodeDocument(code, now);
      if (!isRedeemCodeActive(effectiveCodeDoc, now)) {
        const error = new Error('兑换码无效、已过期或已被使用');
        error.code = 'INVALID_REDEEM_CODE';
        throw error;
      }

      if (effectiveCodeDoc.trialOwnerOpenid && effectiveCodeDoc.trialOwnerOpenid !== openid) {
        const error = new Error('Invalid redeem code');
        error.code = 'INVALID_REDEEM_CODE';
        throw error;
      }
      if (effectiveCodeDoc.paidOwnerOpenid && effectiveCodeDoc.paidOwnerOpenid !== openid) {
        const error = new Error('Invalid redeem code');
        error.code = 'INVALID_REDEEM_CODE';
        throw error;
      }

      const plan = effectiveCodeDoc.plan || DEFAULT_REDEEM_PLAN;
      const entitlement = {
        openid,
        plan,
        status: 'active',
        source: 'redeem_code',
        code,
        durationDays: Number(effectiveCodeDoc.durationDays) || 30,
        cloudQuotaSeconds: Number(effectiveCodeDoc.cloudQuotaSeconds)
          || getDefaultCloudQuotaSeconds(Number(effectiveCodeDoc.durationDays) || 30),
        cloudUsedSeconds: Number(effectiveCodeDoc.cloudUsedSeconds) || 0,
        redeemedAt: now,
        expiresAt: effectiveCodeDoc.entitlementExpiresAt || effectiveCodeDoc.accessExpiresAt || addDaysIso(now, effectiveCodeDoc.durationDays),
        updatedAt: now,
      };
      if (clientId) entitlement.clientId = clientId;

      const currentResult = await db
        .collection('user_entitlements')
        .where({
          openid,
          plan,
          status: 'active',
        })
        .orderBy('redeemedAt', 'desc')
        .limit(1)
        .get();
      const current = currentResult.data && currentResult.data[0] ? currentResult.data[0] : null;
      if (current) {
        await db.collection('user_entitlements').doc(current._id).update({ data: entitlement });
      } else {
        await db.collection('user_entitlements').add({ data: entitlement });
      }

      const updateData = {
        redeemedCount: _.inc(1),
        lastRedeemedAt: now,
        lastRedeemedOpenId: openid,
        lastRedeemedClientId: clientId,
        status: 'redeemed',
        updatedAt: now,
      };
      if (effectiveCodeDoc._id) {
        await db.collection('redeem_codes').doc(effectiveCodeDoc._id).update({ data: updateData });
      }

      return buildEntitlementState(entitlement, now);
    },

    async autoRedeemAccessCode(openid, context = {}) {
      const now = new Date().toISOString();
      await ensureCollection('redeem_codes');
      const queryFields = ['paidOwnerOpenid', 'trialOwnerOpenid', 'deliveredTo', 'openid'];
      const candidatesById = new Map();
      for (const field of queryFields) {
        try {
          const result = await db
            .collection('redeem_codes')
            .where({
              [field]: openid,
            })
            .limit(100)
            .get();
          (result.data || []).forEach((item) => {
            const key = item && (item._id || normalizeRedeemCode(item.code));
            if (key && !candidatesById.has(key)) candidatesById.set(key, item);
          });
        } catch (error) {
          console.warn(`Failed to query redeem_codes by ${field}:`, error && error.message ? error.message : error);
        }
      }
      const candidate = pickAutoRedeemCode(Array.from(candidatesById.values()), openid, now);
      if (!candidate) {
        const error = new Error('没有找到当前绑定微信可用的兑换码');
        error.code = 'INVALID_REDEEM_CODE';
        throw error;
      }
      return await this.redeemAccessCode(openid, candidate.code, context);
    },

    async listPendingRecords(openid) {
      const result = await db
        .collection('inbox_records')
        .where({
          openid,
          status: _.neq('synced'),
        })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      return result.data || [];
    },

    async markRecordSynced(openid, recordId) {
      const syncedAt = new Date().toISOString();

      const recordResult = await db
        .collection('inbox_records')
        .where({
          _id: recordId,
          openid,
        })
        .limit(1)
        .get();

      const record = recordResult.data && recordResult.data[0] ? recordResult.data[0] : null;
      if (!record) {
        throw new Error('Record not found');
      }

      const fileIds = collectRecordFileIds(record);
      let cleanupError = '';

      if (fileIds.length) {
        try {
          const deleteResult = await cloud.deleteFile({
            fileList: fileIds,
          });
          const failedFiles = (deleteResult.fileList || []).filter((item) => item.status && item.status !== 0);
          if (failedFiles.length) {
            cleanupError = failedFiles
              .map((item) => `${item.fileID || 'unknown'}:${item.errMsg || item.status}`)
              .join('; ');
          }
        } catch (error) {
          cleanupError = formatCleanupError(error);
        }
      }

      await db
        .collection('inbox_records')
        .doc(record._id)
        .remove();

      return {
        id: recordId,
        status: 'deleted',
        syncedAt,
        cleaned: true,
        deleted: true,
        deletedFileCount: fileIds.length,
        cleanupError,
      };
    },

    async isFileOwnedByOpenId(openid, fileID) {
      const normalizedFileID = String(fileID || '').trim();
      if (!normalizedFileID) return false;

      const result = await db
        .collection('inbox_records')
        .where(_.or([
          {
            openid,
            'metadata.fileID': normalizedFileID,
          },
          {
            openid,
            'metadata.audioFileID': normalizedFileID,
          },
        ]))
        .limit(1)
        .get();

      return Boolean(result.data && result.data.length);
    },

    async getTempFileURL(openid, fileID) {
      const result = await cloud.getTempFileURL({
        fileList: [fileID],
      });
      const file = result.fileList && result.fileList[0];
      if (!file || !file.tempFileURL) {
        throw new Error('Failed to create temp file URL');
      }
      return {
        fileID,
        tempFileURL: file.tempFileURL,
      };
    },

    async transcribeCloudAudio(openid, payload) {
      const audioUrl = payload.audioUrl
        ? String(payload.audioUrl).trim()
        : (await this.getTempFileURL(openid, payload.fileID)).tempFileURL;
      if (!/^https?:\/\//i.test(audioUrl)) {
        throw new Error('Cloud transcription audio URL is invalid');
      }
      const result = await runDoubaoCloudTranscription(audioUrl);
      const billedSeconds = Math.max(
        60,
        Math.ceil(Number(payload.durationSeconds) || 0),
        Math.ceil(Number(result.durationSeconds) || 0),
      );
      return {
        ...result,
        billedSeconds,
      };
    },

    async recognizeImageTexts(openid, payload) {
      const images = Array.isArray(payload && payload.images) ? payload.images.slice(0, 6) : [];
      const items = [];
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        try {
          // eslint-disable-next-line no-await-in-loop
          const text = await runTencentOcr(image);
          items.push({
            imageUrl: String(image.imageUrl || ''),
            index: Number(image.index) || index + 1,
            text,
          });
        } catch (error) {
          items.push({
            imageUrl: String(image.imageUrl || ''),
            index: Number(image.index) || index + 1,
            text: '',
            error: error.message || String(error),
          });
        }
      }
      await recordAnalyticsEvent(openid, 'image_ocr', {
        count: images.length,
        pageUrl: String(payload && payload.pageUrl || '').slice(0, 300),
        title: String(payload && payload.title || '').slice(0, 100),
      });
      return {
        provider: 'tencent-ocr',
        items,
      };
    },

    async prepareWebpageMedia(openid, payload) {
      const pageUrl = String(payload && payload.url || '').trim();
      const resolverUrl = getMediaResolverUrl();
      if (!isHttpUrl(pageUrl)) {
        throw new Error('Media prepare URL is invalid');
      }
      if (!resolverUrl || !isHttpUrl(resolverUrl)) {
        throw new Error('MEDIA_RESOLVER_URL is not configured');
      }
      const secret = getMediaResolverSecret();
      const response = await postJson({
        url: resolverUrl,
        headers: secret ? { 'x-resolver-secret': secret } : {},
        body: {
          url: pageUrl,
          recordId: payload.recordId || '',
        },
        timeoutMs: MEDIA_RESOLVER_TIMEOUT_MS,
      });
      if (!response.status || response.status < 200 || response.status >= 300) {
        const errorPayload = response.json || {};
        throw new Error(errorPayload.errMsg || response.text || `Media resolver HTTP ${response.status}`);
      }
      const data = response.json && response.json.data ? response.json.data : {};
      const mediaUrl = normalizeResolverMediaUrl(data.mediaUrl, resolverUrl, data);
      if (!isHttpUrl(mediaUrl)) {
        throw new Error('Media resolver returned empty media URL');
      }
      if (isMediaPrepareCacheEnabled()) {
        const downloaded = await downloadPreparedMedia(mediaUrl, data.headers || {});
        const now = Date.now();
        const ext = getPreparedMediaExt(mediaUrl);
        const openidPart = sanitizeCloudPathPart(openid);
        const recordPart = sanitizeCloudPathPart(payload.recordId || createRequestId());
        const cloudPath = `prepared-media/${openidPart}/${recordPart}-${now}.${ext}`;
        const upload = await cloud.uploadFile({
          cloudPath,
          fileContent: downloaded.buffer,
        });
        const fileID = upload.fileID || '';
        const tempUrlResult = await cloud.getTempFileURL({
          fileList: [fileID],
        });
        const file = tempUrlResult.fileList && tempUrlResult.fileList[0] ? tempUrlResult.fileList[0] : {};
        const tempFileURL = file.tempFileURL || '';
        if (!isHttpUrl(tempFileURL)) {
          throw new Error('Failed to create prepared media temp URL');
        }
        return {
          mediaUrl: tempFileURL,
          audioUrl: tempFileURL,
          originalMediaUrl: mediaUrl,
          preparedFileID: fileID,
          cached: true,
          mediaPreparedByCloud: true,
          source: String(data.source || 'media-resolver'),
          title: String(data.title || ''),
          durationSeconds: Number(data.durationSeconds || 0) || 0,
          expiresAt: new Date(Date.now() + getMediaPrepareCacheTtlMs()).toISOString(),
        };
      }
      return {
        mediaUrl,
        audioUrl: mediaUrl,
        originalMediaUrl: String(data.originalMediaUrl || ''),
        preparedFileID: '',
        cached: false,
        mediaPreparedByCloud: false,
        source: String(data.source || 'media-resolver'),
        title: String(data.title || ''),
        durationSeconds: Number(data.durationSeconds || 0) || 0,
        expiresAt: data.expiresAt || '',
      };
    },

    async generateMetadata(openid, payload) {
      return await generateAiMetadataWithModel(payload);
    },

    async recordCloudTranscriptionUsage(openid, usage) {
      const now = usage.createdAt || new Date().toISOString();
      if (typeof db.createCollection === 'function') {
        try {
          await db.createCollection('cloud_transcription_usages');
        } catch (error) {
          // Collection already exists.
        }
      }
      await db.collection('cloud_transcription_usages').add({
        data: {
          openid,
          fileID: usage.fileID,
          usedSeconds: Number(usage.usedSeconds) || 0,
          remainingSeconds: Number(usage.remainingSeconds) || 0,
          quotaSeconds: Number(usage.quotaSeconds) || 0,
          previousUsedSeconds: Number(usage.previousUsedSeconds) || 0,
          provider: usage.provider || 'doubao',
          requestId: usage.requestId || '',
          localError: usage.localError || '',
          createdAt: now,
        },
      });

      const entitlement = await this.getEntitlement(openid, DEFAULT_REDEEM_PLAN);
      if (entitlement && entitlement._id) {
        await db.collection('user_entitlements').doc(entitlement._id).update({
          data: {
            cloudUsedSeconds: _.inc(Number(usage.usedSeconds) || 0),
            cloudLastUsedAt: now,
            updatedAt: now,
          },
        });
      }
    },

    async saveTranscriptionPreferences(openid, preferences) {
      const now = new Date().toISOString();
      if (typeof db.createCollection === 'function') {
        try {
          await db.createCollection('user_transcription_settings');
        } catch (error) {
          // Collection already exists.
        }
      }
      const data = {
        openid,
        cloudPreTranscriptionEnabled: Boolean(preferences.cloudPreTranscriptionEnabled),
        cloudPreTranscriptionThresholdMinutes: Number(preferences.cloudPreTranscriptionThresholdMinutes) || 10,
        updatedAt: now,
      };
      const result = await db
        .collection('user_transcription_settings')
        .where({ openid })
        .limit(1)
        .get();
      const current = result.data && result.data[0] ? result.data[0] : null;
      if (current && current._id) {
        await db.collection('user_transcription_settings').doc(current._id).update({ data });
      } else {
        await db.collection('user_transcription_settings').add({ data: { ...data, createdAt: now } });
      }
      return data;
    },

    async handleAdminRequest(request) {
      return await handleAdminConsoleRequest(request);
    },

    async handleVirtualPaymentNotify(notify) {
      return await processVirtualPaymentNotify(notify);
    },
  };
}

const repository = createRepository();

exports.main = async (event) => {
  return handleSyncApiRequest({
    request: normalizeEvent(event),
    repository,
  });
};
