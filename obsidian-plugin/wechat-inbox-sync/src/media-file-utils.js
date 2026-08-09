function getImageFileExtension(url = '') {
  const match = String(url || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  const ext = match ? match[1].toLowerCase() : 'jpg';
  return ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext) ? ext : 'jpg';
}

function getAudioFormatFromUrl(audioUrl) {
  const match = String(audioUrl || '').toLowerCase().match(/\.([a-z0-9]{2,5})(?:[?#]|$)/);
  if (!match && /finder\.video\.qq\.com|mpvideo/i.test(String(audioUrl || ''))) return 'mp4';
  const ext = match ? match[1] : 'mp3';
  if (['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg', 'mp4'].includes(ext)) return ext;
  if (ext === 'm4s') return 'mp4';
  return 'mp3';
}

function hasVideoTrackInMediaBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (!buffer.length) return false;
  return buffer.includes(Buffer.from('vide'))
    || buffer.includes(Buffer.from('vp09'));
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

function sanitizeAttachmentName(fileName, fallbackName) {
  const text = String(fileName || fallbackName || 'upload-file').trim();
  return (text || 'upload-file').replace(/[\\/:*?"<>|]/g, '-');
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

module.exports = {
  bufferStartsWith,
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
};