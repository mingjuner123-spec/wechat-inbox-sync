'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');

// Keep this in sync with the server-side controlled-media limit. The plugin
// rejects oversized input before asking the backend for a paid upload slot.
const MAX_CLOUD_FALLBACK_MEDIA_BYTES = 100 * 1024 * 1024;
const DEFAULT_UPLOAD_TIMEOUT_MS = 120000;

function cloudMediaError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw cloudMediaError('CLOUD_MEDIA_UPLOAD_ABORTED', '云端媒体上传已取消', { name: 'AbortError' });
  }
}

function normalizeMaxBytes(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.min(MAX_CLOUD_FALLBACK_MEDIA_BYTES, Math.floor(numeric))
    : MAX_CLOUD_FALLBACK_MEDIA_BYTES;
}

async function statMediaFile(filePath, maxBytes = MAX_CLOUD_FALLBACK_MEDIA_BYTES) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) throw cloudMediaError('CLOUD_MEDIA_FILE_REQUIRED', '云端媒体文件缺失');
  let stat;
  try {
    stat = await fs.promises.stat(normalizedPath);
  } catch (_) {
    throw cloudMediaError('CLOUD_MEDIA_FILE_UNAVAILABLE', '云端媒体文件不可用');
  }
  const size = Number(stat && stat.size);
  if (!stat.isFile() || !Number.isSafeInteger(size) || size <= 0) {
    throw cloudMediaError('CLOUD_MEDIA_FILE_INVALID', '云端媒体文件无效');
  }
  if (size > normalizeMaxBytes(maxBytes)) {
    throw cloudMediaError('CLOUD_MEDIA_TOO_LARGE', '云端媒体文件超过大小限制', { size });
  }
  return { path: normalizedPath, size };
}

async function hashFileSha256(filePath, { signal, maxBytes = MAX_CLOUD_FALLBACK_MEDIA_BYTES } = {}) {
  throwIfAborted(signal);
  const file = await statMediaFile(filePath, maxBytes);
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file.path);
    let settled = false;
    let bytes = 0;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abort);
      if (error) {
        stream.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const abort = () => finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_ABORTED', '云端媒体处理已取消', { name: 'AbortError' }));
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', abort, { once: true });
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > normalizeMaxBytes(maxBytes)) {
        finish(cloudMediaError('CLOUD_MEDIA_TOO_LARGE', '云端媒体文件超过大小限制', { size: bytes }));
        return;
      }
      hash.update(chunk);
    });
    stream.on('error', (error) => finish(cloudMediaError('CLOUD_MEDIA_FILE_READ_FAILED', '读取云端媒体文件失败', { cause: error })));
    stream.on('end', () => {
      if (!bytes) {
        finish(cloudMediaError('CLOUD_MEDIA_FILE_INVALID', '云端媒体文件为空'));
        return;
      }
      finish(null, { size: bytes, sha256: hash.digest('hex') });
    });
  });
}

function sanitizeFileName(value) {
  const text = String(value || 'audio.mp3').replace(/[^A-Za-z0-9._-]/g, '_');
  return text || 'audio.mp3';
}

function makeMultipartParts(fields, fileName, contentType) {
  const boundary = `----wechatInboxMedia${crypto.randomBytes(12).toString('hex')}`;
  const fieldBuffers = [];
  Object.entries(fields && typeof fields === 'object' ? fields : {}).forEach(([key, value]) => {
    fieldBuffers.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${String(key).replace(/["\r\n]/g, '')}"\r\n\r\n${String(value)}\r\n`,
      'utf8',
    ));
  });
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${sanitizeFileName(fileName)}"\r\nContent-Type: ${String(contentType || 'audio/mpeg').replace(/[\r\n]/g, '')}\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { boundary, prefix: Buffer.concat([...fieldBuffers, fileHeader]), closing };
}

function normalizeSignedHeaders(value) {
  const headers = {};
  const allowed = /^(?:authorization|signature|key|x-cos-security-token|x-cos-meta-fileid)$/i;
  Object.entries(value && typeof value === 'object' ? value : {}).forEach(([key, headerValue]) => {
    if (!allowed.test(String(key)) || headerValue === undefined || headerValue === null) return;
    headers[String(key)] = String(headerValue);
  });
  return headers;
}

async function uploadRawFile(uploadUrl, file, {
  signal,
  timeoutMs,
  headers: signedHeaders,
  method = 'PUT',
  contentType = 'audio/mpeg',
  maxBytes,
  onProgress,
} = {}) {
  const transport = uploadUrl.protocol === 'https:' ? https : http;
  // Keep the signed header set exact. Content-Length is transport metadata;
  // the backend may choose whether to sign/provide Content-Type.
  const requestHeaders = normalizeSignedHeaders(signedHeaders);
  requestHeaders['Content-Length'] = file.size;
  const requestOptions = {
    protocol: uploadUrl.protocol,
    hostname: uploadUrl.hostname,
    port: uploadUrl.port || undefined,
    method: String(method || 'PUT').toUpperCase() === 'PUT' ? 'PUT' : 'PUT',
    path: `${uploadUrl.pathname || '/'}${uploadUrl.search || ''}`,
    headers: requestHeaders,
  };
  return await new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let stream = null;
    let sent = 0;
    let request;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abort);
      if (stream) stream.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => {
      if (request) request.destroy();
      finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_ABORTED', '云端媒体上传已取消', { name: 'AbortError' }));
    };
    try {
      request = transport.request(requestOptions, (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_FAILED', '云端媒体上传失败', { statusCode: response.statusCode }));
            return;
          }
          finish(null, { statusCode: response.statusCode, size: file.size });
        });
      });
    } catch (error) {
      finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_FAILED', '云端媒体上传失败', { cause: error }));
      return;
    }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      request.destroy();
      finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_TIMEOUT', '云端媒体上传超时'));
    }, Math.max(1000, Math.min(10 * 60 * 1000, Number(timeoutMs) || DEFAULT_UPLOAD_TIMEOUT_MS)));
    request.on('error', (error) => {
      if (settled) return;
      if (signal && signal.aborted) finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_ABORTED', '云端媒体上传已取消', { name: 'AbortError' }));
      else finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_FAILED', '云端媒体上传失败', { cause: error }));
    });
    stream = fs.createReadStream(file.path);
    stream.on('data', (chunk) => {
      if (settled) return;
      sent += chunk.length;
      if (sent > file.size || sent > normalizeMaxBytes(maxBytes)) {
        stream.destroy();
        request.destroy();
        finish(cloudMediaError('CLOUD_MEDIA_TOO_LARGE', '云端媒体文件超过大小限制', { size: sent }));
        return;
      }
      if (typeof onProgress === 'function') {
        try { onProgress({ bytesSent: sent, totalBytes: file.size, percent: Math.round((sent / file.size) * 100) }); } catch (_) { /* Progress is advisory. */ }
      }
      if (!request.write(chunk)) stream.pause();
    });
    request.on('drain', () => { if (stream && !settled) stream.resume(); });
    stream.on('error', (error) => finish(cloudMediaError('CLOUD_MEDIA_FILE_READ_FAILED', '读取云端媒体文件失败', { cause: error })));
    stream.on('end', () => { if (!settled) request.end(); });
  });
}

async function uploadMultipartFile(
  uploadUrl,
  fields,
  filePath,
  {
    signal,
    timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
    maxBytes = MAX_CLOUD_FALLBACK_MEDIA_BYTES,
    fileName = 'audio.mp3',
    contentType = 'audio/mpeg',
    onProgress,
    method = '',
    headers = {},
  } = {},
) {
  throwIfAborted(signal);
  let parsed;
  try {
    parsed = new URL(String(uploadUrl || ''));
  } catch (_) {
    throw cloudMediaError('CLOUD_MEDIA_UPLOAD_URL_INVALID', '云端媒体上传地址无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw cloudMediaError('CLOUD_MEDIA_UPLOAD_URL_INVALID', '云端媒体上传地址无效');
  }
  const file = await statMediaFile(filePath, maxBytes);
  if (String(method || '').trim().toUpperCase() === 'PUT' || Object.keys(headers || {}).length > 0) {
    return await uploadRawFile(parsed, file, {
      signal,
      timeoutMs,
      headers,
      method: 'PUT',
      contentType,
      maxBytes,
      onProgress,
    });
  }
  const parts = makeMultipartParts(fields, fileName, contentType);
  const contentLength = parts.prefix.length + file.size + parts.closing.length;
  const transport = parsed.protocol === 'https:' ? https : http;
  const requestOptions = {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || undefined,
    method: 'POST',
    path: `${parsed.pathname || '/'}${parsed.search || ''}`,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${parts.boundary}`,
      'Content-Length': contentLength,
    },
  };
  return await new Promise((resolve, reject) => {
    let settled = false;
    let sent = 0;
    let stream = null;
    let timer = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abort);
      if (stream) stream.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => {
      if (request) request.destroy();
      finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_ABORTED', '云端媒体上传已取消', { name: 'AbortError' }));
    };
    let request;
    try {
      request = transport.request(requestOptions, (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_FAILED', '云端媒体上传失败', { statusCode: response.statusCode }));
            return;
          }
          finish(null, { statusCode: response.statusCode, size: file.size });
        });
      });
    } catch (error) {
      finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_FAILED', '云端媒体上传失败', { cause: error }));
      return;
    }
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', abort, { once: true });
    const timeout = Math.max(1000, Math.min(10 * 60 * 1000, Number(timeoutMs) || DEFAULT_UPLOAD_TIMEOUT_MS));
    timer = setTimeout(() => {
      request.destroy();
      finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_TIMEOUT', '云端媒体上传超时'));
    }, timeout);
    request.on('error', (error) => {
      if (settled) return;
      if (signal && signal.aborted) {
        finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_ABORTED', '云端媒体上传已取消', { name: 'AbortError' }));
      } else {
        finish(cloudMediaError('CLOUD_MEDIA_UPLOAD_FAILED', '云端媒体上传失败', { cause: error }));
      }
    });
    request.write(parts.prefix);
    stream = fs.createReadStream(file.path);
    stream.on('data', (chunk) => {
      if (settled) return;
      sent += chunk.length;
      if (sent > file.size || sent > normalizeMaxBytes(maxBytes)) {
        stream.destroy();
        request.destroy();
        finish(cloudMediaError('CLOUD_MEDIA_TOO_LARGE', '云端媒体文件超过大小限制', { size: sent }));
        return;
      }
      if (typeof onProgress === 'function') {
        try { onProgress({ bytesSent: sent, totalBytes: file.size, percent: Math.round((sent / file.size) * 100) }); } catch (_) { /* Progress is advisory. */ }
      }
      if (!request.write(chunk)) stream.pause();
    });
    request.on('drain', () => { if (stream && !settled) stream.resume(); });
    stream.on('error', (error) => finish(cloudMediaError('CLOUD_MEDIA_FILE_READ_FAILED', '读取云端媒体文件失败', { cause: error })));
    stream.on('end', () => {
      if (settled) return;
      request.end(parts.closing);
    });
  });
}

module.exports = {
  MAX_CLOUD_FALLBACK_MEDIA_BYTES,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  hashFileSha256,
  uploadMultipartFile,
  uploadPreparedFile: uploadMultipartFile,
  statMediaFile,
};
