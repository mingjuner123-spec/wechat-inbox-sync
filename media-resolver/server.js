const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { createMediaResolver } = require('./resolver-core');

const PORT = Number(process.env.PORT || 8787);
const RESOLVER_SECRET = String(process.env.RESOLVER_SECRET || '');
const YT_DLP_BIN = String(process.env.YT_DLP_BIN || 'yt-dlp');
const YT_DLP_COOKIE_FILE = String(process.env.YT_DLP_COOKIE_FILE || '');
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const MEDIA_TOKEN_TTL_MS = Number(process.env.MEDIA_TOKEN_TTL_MS || 30 * 60 * 1000);
const mediaTokens = new Map();

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(new Error('invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function cleanupExpiredMediaTokens() {
  const now = Date.now();
  for (const [token, item] of mediaTokens.entries()) {
    if (!item || item.expiresAt <= now) {
      mediaTokens.delete(token);
    }
  }
}

function createProxiedMediaData(data) {
  if (!PUBLIC_BASE_URL || !data || !data.mediaUrl) {
    return data;
  }
  cleanupExpiredMediaTokens();
  const token = crypto.randomUUID();
  mediaTokens.set(token, {
    url: data.mediaUrl,
    headers: data.headers || {},
    expiresAt: Date.now() + MEDIA_TOKEN_TTL_MS,
  });
  return {
    ...data,
    originalMediaUrl: data.mediaUrl,
    mediaUrl: `${PUBLIC_BASE_URL}/media/${token}`,
    proxied: true,
  };
}

function runYtDlp(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '-J',
      '--no-playlist',
      '--no-warnings',
      '--no-check-certificate',
    ];
    if (YT_DLP_COOKIE_FILE) {
      args.push('--cookies', YT_DLP_COOKIE_FILE);
    }
    args.push(url);
    const child = execFile(YT_DLP_BIN, args, {
      timeout: REQUEST_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message || 'yt-dlp failed'));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end();
  });
}

function fetchHtml(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 WeChatInboxMediaResolver/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, (response) => {
      const location = response.headers && response.headers.location;
      if ([301, 302, 303, 307, 308].includes(Number(response.statusCode)) && location && redirectCount < 5) {
        response.resume();
        resolve(fetchHtml(new URL(location, url).toString(), redirectCount + 1));
        return;
      }
      if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
        response.resume();
        reject(new Error(`fetch failed: HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('fetch timed out'));
    });
  });
}

function resolveFinalUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request({
      method: 'HEAD',
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      headers: {
        'User-Agent': 'Mozilla/5.0 WeChatInboxMediaResolver/1.0',
      },
    }, (response) => {
      const location = response.headers && response.headers.location;
      if ([301, 302, 303, 307, 308].includes(Number(response.statusCode)) && location && redirectCount < 5) {
        response.resume();
        resolve(resolveFinalUrl(new URL(location, url).toString(), redirectCount + 1));
        return;
      }
      response.resume();
      resolve(url);
    });
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('redirect resolve timed out'));
    });
    req.end();
  });
}

const resolver = createMediaResolver({
  runYtDlp,
  fetchHtml,
  resolveFinalUrl,
});

function isAuthorized(req) {
  if (!RESOLVER_SECRET) return true;
  return String(req.headers['x-resolver-secret'] || '') === RESOLVER_SECRET;
}

async function handleResolve(req, res) {
  if (!isAuthorized(req)) {
    writeJson(res, 401, {
      success: false,
      errCode: 'UNAUTHORIZED',
      errMsg: 'resolver secret mismatch',
    });
    return;
  }
  try {
    const body = await readRequestBody(req);
    const result = await resolver.resolve(body);
    if (result.success && result.data) {
      result.data = createProxiedMediaData(result.data);
    }
    writeJson(res, result.success ? 200 : 422, result);
  } catch (error) {
    writeJson(res, 400, {
      success: false,
      errCode: 'BAD_REQUEST',
      errMsg: error.message || String(error),
    });
  }
}

function writeProxyError(res, status, message) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(message);
}

function handleMediaProxy(req, res, token) {
  cleanupExpiredMediaTokens();
  const item = mediaTokens.get(token);
  if (!item) {
    writeProxyError(res, 404, 'media token not found or expired');
    return;
  }

  let parsed;
  try {
    parsed = new URL(item.url);
  } catch (error) {
    writeProxyError(res, 500, 'invalid media url');
    return;
  }

  const client = parsed.protocol === 'http:' ? http : https;
  const headers = {
    ...item.headers,
  };
  if (req.headers.range) {
    headers.Range = req.headers.range;
  }
  const proxyReq = client.get({
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    path: `${parsed.pathname}${parsed.search}`,
    headers,
  }, (proxyRes) => {
    const responseHeaders = {};
    [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'last-modified',
      'etag',
    ].forEach((name) => {
      if (proxyRes.headers[name]) {
        responseHeaders[name] = proxyRes.headers[name];
      }
    });
    res.writeHead(proxyRes.statusCode || 200, responseHeaders);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (error) => {
    writeProxyError(res, 502, error.message || 'media proxy failed');
  });
  proxyReq.setTimeout(REQUEST_TIMEOUT_MS, () => {
    proxyReq.destroy(new Error('media proxy timed out'));
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    writeJson(res, 200, { success: true, data: { status: 'ok' } });
    return;
  }
  if (req.method === 'GET' && req.url && req.url.startsWith('/media/')) {
    handleMediaProxy(req, res, decodeURIComponent(req.url.slice('/media/'.length)));
    return;
  }
  if (req.method === 'POST' && req.url === '/resolve') {
    handleResolve(req, res);
    return;
  }
  writeJson(res, 404, {
    success: false,
    errCode: 'NOT_FOUND',
    errMsg: 'not found',
  });
});

server.listen(PORT, () => {
  console.log(`media resolver listening on ${PORT}`);
});
