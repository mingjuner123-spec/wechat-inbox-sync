const crypto = require('crypto');

const FEISHU_AUTHORIZE_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
const FEISHU_OAUTH_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
const FEISHU_OPEN_API_BASE = 'https://open.feishu.cn/open-apis';
const LARK_OPEN_API_BASE = 'https://open.larksuite.com/open-apis';
const FEISHU_BLOCK_PAGE_SIZE = 500;
const FEISHU_BLOCK_MAX_PAGES = 80;
const DEFAULT_FEISHU_OAUTH_SCOPES = [
  'offline_access',
  'docx:document:readonly',
  'docs:document.media:download',
  'wiki:node:read',
  'wiki:node:retrieve',
  'wiki:wiki:readonly',
];

function normalizeScopeList(scopes) {
  const source = Array.isArray(scopes) ? scopes.join(' ') : String(scopes || '');
  return Array.from(new Set(source.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean)));
}

function normalizeFeishuOAuthAppConfig(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? (input.feishuApp || input.feishuOAuth || input)
    : {};
  const appId = String(
    (source && (source.appId || source.feishuAppId || source.clientId))
    || ''
  ).trim();
  const appSecret = String(
    (source && (source.appSecret || source.feishuAppSecret || source.clientSecret))
    || ''
  ).trim();
  if (!appId && !appSecret) return null;
  if (!appId || !appSecret) {
    throw new Error('Feishu App ID and App Secret must be provided together');
  }
  return {
    appId,
    appSecret,
    appSource: 'custom',
  };
}

function maskFeishuAppId(appId) {
  const value = String(appId || '').trim();
  if (!value) return '';
  if (value.length <= 10) return value;
  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}

function addSeconds(isoTime, seconds) {
  const base = isoTime ? new Date(isoTime).getTime() : Date.now();
  return new Date(base + Math.max(0, Number(seconds) || 0) * 1000).toISOString();
}

function buildFeishuAuthorizeUrl({
  appId,
  redirectUri,
  state,
  scopes = DEFAULT_FEISHU_OAUTH_SCOPES,
  prompt = 'consent',
}) {
  const url = new URL(FEISHU_AUTHORIZE_URL);
  url.searchParams.set('client_id', String(appId || '').trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', String(redirectUri || '').trim());
  const scope = normalizeScopeList(scopes).join(' ');
  if (scope) url.searchParams.set('scope', scope);
  if (state) url.searchParams.set('state', String(state));
  if (prompt) url.searchParams.set('prompt', String(prompt));
  return url.toString();
}

function buildFeishuOAuthTokenRequest({
  appId,
  appSecret,
  code,
  redirectUri,
}) {
  return {
    url: FEISHU_OAUTH_TOKEN_URL,
    body: {
      grant_type: 'authorization_code',
      client_id: String(appId || '').trim(),
      client_secret: String(appSecret || '').trim(),
      code: String(code || '').trim(),
      redirect_uri: String(redirectUri || '').trim(),
    },
  };
}

function buildFeishuOAuthRefreshRequest({
  appId,
  appSecret,
  refreshToken,
}) {
  return {
    url: FEISHU_OAUTH_TOKEN_URL,
    body: {
      grant_type: 'refresh_token',
      client_id: String(appId || '').trim(),
      client_secret: String(appSecret || '').trim(),
      refresh_token: String(refreshToken || '').trim(),
    },
  };
}

function normalizeFeishuOAuthTokenPayload(payload, now = new Date().toISOString()) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const accessToken = String(data.access_token || data.accessToken || '').trim();
  if (!accessToken) {
    throw new Error(data.error_description || data.msg || 'Feishu OAuth did not return access_token');
  }
  return {
    accessToken,
    accessTokenExpiresAt: addSeconds(now, data.expires_in || data.expiresIn || 0),
    refreshToken: String(data.refresh_token || data.refreshToken || '').trim(),
    refreshTokenExpiresAt: data.refresh_token_expires_in || data.refreshTokenExpiresIn
      ? addSeconds(now, data.refresh_token_expires_in || data.refreshTokenExpiresIn)
      : '',
    scope: String(data.scope || '').trim(),
  };
}

function createFeishuOAuthState({ randomBytes = crypto.randomBytes, now = new Date().toISOString() } = {}) {
  const state = randomBytes(24).toString('hex');
  return {
    state,
    createdAt: now,
    expiresAt: addSeconds(now, 10 * 60),
  };
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
    apiBase: isLark ? LARK_OPEN_API_BASE : FEISHU_OPEN_API_BASE,
    kind: kind === 'docs' ? 'doc' : kind,
    token: decodeURIComponent(match[2]),
  };
}

function buildFeishuOpenApiUrl(apiBase, path, params = {}) {
  const base = String(apiBase || FEISHU_OPEN_API_BASE).replace(/\/+$/, '');
  const url = new URL(`${base}${String(path || '').startsWith('/') ? path : `/${path}`}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function buildFeishuOpenApiRepeatedQueryUrl(apiBase, path, params = {}) {
  const base = String(apiBase || FEISHU_OPEN_API_BASE).replace(/\/+$/, '');
  const url = new URL(`${base}${String(path || '').startsWith('/') ? path : `/${path}`}`);
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && String(item) !== '') {
          url.searchParams.append(key, String(item));
        }
      });
      return;
    }
    if (value !== undefined && value !== null && String(value) !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function tryParseJson(text) {
  try {
    return JSON.parse(String(text || ''));
  } catch (error) {
    return null;
  }
}

async function requestFeishuOpenApiJson({
  apiBase,
  path,
  method = 'GET',
  accessToken,
  params = {},
  body = null,
  requestJson,
}) {
  const url = /^https?:\/\//i.test(String(path || ''))
    ? String(path)
    : buildFeishuOpenApiUrl(apiBase, path, params);
  const response = await requestJson({
    url,
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const status = Number(response && response.status) || 0;
  const payload = (response && response.json) || tryParseJson(response && response.text) || {};
  if (status && (status < 200 || status >= 300)) {
    throw new Error((payload && (payload.msg || payload.message || payload.error_description)) || `Feishu OpenAPI HTTP ${status}`);
  }
  if (payload && Number(payload.code || 0) !== 0) {
    throw new Error((payload && (payload.msg || payload.message || payload.error_description)) || `Feishu OpenAPI code ${payload.code}`);
  }
  return payload;
}

async function resolveFeishuOpenApiDocument(url, accessToken, { requestJson }) {
  const info = extractFeishuOpenApiUrlInfo(url);
  if (!info || !info.token) throw new Error('Feishu document token not found');
  if (info.kind === 'wiki') {
    const payload = await requestFeishuOpenApiJson({
      apiBase: info.apiBase,
      path: '/wiki/v2/spaces/get_node',
      params: { token: info.token },
      accessToken,
      requestJson,
    });
    const node = payload && payload.data && payload.data.node;
    const documentId = String((node && node.obj_token) || '').trim();
    const objType = String((node && node.obj_type) || '').toLowerCase();
    if (!documentId) throw new Error('Feishu wiki node did not return document token');
    if (objType && !/doc|docx/.test(objType)) {
      throw new Error(`Feishu wiki node is not a document: ${objType}`);
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

async function fetchFeishuOpenApiDocumentTitle(documentInfo, accessToken, { requestJson }) {
  try {
    const payload = await requestFeishuOpenApiJson({
      apiBase: documentInfo.apiBase,
      path: `/docx/v1/documents/${encodeURIComponent(documentInfo.documentId)}`,
      accessToken,
      requestJson,
    });
    const document = payload && payload.data && payload.data.document;
    return String((document && document.title) || documentInfo.title || '').trim();
  } catch (error) {
    return documentInfo.title || '';
  }
}

async function fetchFeishuOpenApiDocumentBlocks(documentInfo, accessToken, { requestJson }) {
  const items = [];
  let pageToken = '';
  for (let pageIndex = 0; pageIndex < FEISHU_BLOCK_MAX_PAGES; pageIndex += 1) {
    const payload = await requestFeishuOpenApiJson({
      apiBase: documentInfo.apiBase,
      path: `/docx/v1/documents/${encodeURIComponent(documentInfo.documentId)}/blocks`,
      params: {
        page_size: FEISHU_BLOCK_PAGE_SIZE,
        page_token: pageToken,
      },
      accessToken,
      requestJson,
    });
    const data = (payload && payload.data) || {};
    const pageItems = Array.isArray(data.items) ? data.items : [];
    pageItems.forEach((item) => {
      if (item && typeof item === 'object') items.push(item);
    });
    if (!data.has_more) break;
    pageToken = String(data.page_token || '').trim();
    if (!pageToken) throw new Error('Feishu block pagination interrupted');
  }
  if (!items.length) throw new Error('Feishu OpenAPI returned no document blocks');
  return items;
}

function extractFeishuImageToken(block) {
  const data = block && typeof block === 'object' ? block : {};
  const image = data.image || data.Image || {};
  return String(
    image.token
    || image.file_token
    || image.fileToken
    || data.token
    || data.file_token
    || data.fileToken
    || ''
  ).trim();
}

function collectFeishuImageTokensFromBlocks(blocks = []) {
  const tokens = [];
  const seen = new Set();
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    const token = extractFeishuImageToken(block);
    if (token && !seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  });
  return tokens;
}

async function fetchFeishuMediaTmpDownloadUrls({
  apiBase,
  accessToken,
  fileTokens = [],
  requestJson,
}) {
  const tokens = Array.from(new Set((Array.isArray(fileTokens) ? fileTokens : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)));
  if (!tokens.length) return {};
  const result = {};
  const chunkSize = 20;
  for (let index = 0; index < tokens.length; index += chunkSize) {
    const chunk = tokens.slice(index, index + chunkSize);
    const url = buildFeishuOpenApiRepeatedQueryUrl(apiBase, '/drive/v1/medias/batch_get_tmp_download_url', {
      file_tokens: chunk,
    });
    const payload = await requestFeishuOpenApiJson({
      apiBase,
      path: url,
      accessToken,
      requestJson,
    });
    const items = payload && payload.data && Array.isArray(payload.data.tmp_download_urls)
      ? payload.data.tmp_download_urls
      : [];
    items.forEach((item) => {
      const token = String(item && item.file_token || '').trim();
      const tmpUrl = String(item && item.tmp_download_url || '').trim();
      if (token && tmpUrl) result[token] = tmpUrl;
    });
  }
  return result;
}

async function fetchFeishuOpenApiBlocksFromUrl({
  url,
  accessToken,
  requestJson,
}) {
  const documentInfo = await resolveFeishuOpenApiDocument(url, accessToken, { requestJson });
  const [title, blocks] = await Promise.all([
    fetchFeishuOpenApiDocumentTitle(documentInfo, accessToken, { requestJson }),
    fetchFeishuOpenApiDocumentBlocks(documentInfo, accessToken, { requestJson }),
  ]);
  const imageTokens = collectFeishuImageTokensFromBlocks(blocks);
  let imageTmpDownloadUrls = {};
  let imageDownloadError = '';
  if (imageTokens.length) {
    try {
      imageTmpDownloadUrls = await fetchFeishuMediaTmpDownloadUrls({
        apiBase: documentInfo.apiBase,
        accessToken,
        fileTokens: imageTokens,
        requestJson,
      });
    } catch (error) {
      imageDownloadError = error && error.message ? error.message : String(error || '');
    }
  }
  return {
    title: title || documentInfo.title || 'Feishu document',
    documentId: documentInfo.documentId,
    blockCount: blocks.length,
    blocks,
    imageTokenCount: imageTokens.length,
    imageTmpDownloadUrls,
    imageDownloadError,
  };
}

module.exports = {
  DEFAULT_FEISHU_OAUTH_SCOPES,
  FEISHU_AUTHORIZE_URL,
  FEISHU_OAUTH_TOKEN_URL,
  buildFeishuAuthorizeUrl,
  buildFeishuOAuthRefreshRequest,
  buildFeishuOAuthTokenRequest,
  createFeishuOAuthState,
  collectFeishuImageTokensFromBlocks,
  extractFeishuOpenApiUrlInfo,
  fetchFeishuOpenApiBlocksFromUrl,
  fetchFeishuMediaTmpDownloadUrls,
  maskFeishuAppId,
  normalizeFeishuOAuthAppConfig,
  normalizeFeishuOAuthTokenPayload,
  normalizeScopeList,
};
