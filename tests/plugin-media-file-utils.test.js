const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pluginRoot = path.join(__dirname, '..', 'obsidian-plugin', 'wechat-inbox-sync');
const sourceMainPath = path.join(pluginRoot, 'src', 'main.js');
const modulePath = path.join(pluginRoot, 'src', 'media-file-utils.js');

const {
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
} = require(modulePath);

assert.strictEqual(getImageFileExtension('https://cdn.example/a.PNG?x=1'), 'png');
assert.strictEqual(getImageFileExtension('https://cdn.example/a.gif'), 'jpg');
assert.strictEqual(getImageFileExtension(''), 'jpg');

assert.strictEqual(getAudioFormatFromUrl('https://cdn.example/a.m4a?x=1'), 'm4a');
assert.strictEqual(getAudioFormatFromUrl('https://cdn.example/a.m4s'), 'mp4');
assert.strictEqual(getAudioFormatFromUrl('https://finder.video.qq.com/no-extension'), 'mp4');
assert.strictEqual(getAudioFormatFromUrl('https://cdn.example/a.bin'), 'mp3');

assert.strictEqual(hasVideoTrackInMediaBuffer(Buffer.from('0000ftypisom0000mp4a')), false);
assert.strictEqual(hasVideoTrackInMediaBuffer(Buffer.from('0000vide0000')), true);
assert.strictEqual(hasVideoTrackInMediaBuffer(new Uint8Array(Buffer.from('0000vp090000'))), true);
assert.strictEqual(hasVideoTrackInMediaBuffer(null), false);

assert.strictEqual(bufferStartsWith(Buffer.from([1, 2, 3]), [1, 2]), true);
assert.strictEqual(bufferStartsWith(Buffer.from([1]), [1, 2]), false);

const mediaBuffer = () => Buffer.alloc(512, 0);
assert.strictEqual(getInvalidDownloadedMediaReason(Buffer.alloc(511)), '下载到的媒体文件过小，可能不是有效音视频文件');
const html = mediaBuffer();
html.write('<!doctype html><body>', 0, 'utf8');
assert.strictEqual(getInvalidDownloadedMediaReason(html), '下载到的是网页内容，不是有效音视频文件');
const json = mediaBuffer();
json.write('{"error":true}', 0, 'utf8');
assert.strictEqual(getInvalidDownloadedMediaReason(json), '下载到的是接口返回数据，不是有效音视频文件');
for (const signature of [
  [0xff, 0xd8, 0xff],
  [0x89, 0x50, 0x4e, 0x47],
  [0x47, 0x49, 0x46, 0x38],
]) {
  const image = mediaBuffer();
  Buffer.from(signature).copy(image);
  assert.strictEqual(getInvalidDownloadedMediaReason(image), '下载到的是封面图片，不是有效音视频文件');
}
const webp = mediaBuffer();
Buffer.from('RIFF0000WEBP', 'ascii').copy(webp);
assert.strictEqual(getInvalidDownloadedMediaReason(webp), '下载到的是封面图片，不是有效音视频文件');
for (const prefix of [Buffer.from('%PDF-1.7', 'ascii'), Buffer.from([0x50, 0x4b, 0x03, 0x04])]) {
  const otherFile = mediaBuffer();
  prefix.copy(otherFile);
  assert.strictEqual(getInvalidDownloadedMediaReason(otherFile), '');
}
assert.strictEqual(getInvalidDownloadedMediaReason(mediaBuffer()), '');

assert.strictEqual(sanitizeAttachmentName('a:b/c?.mp3', 'fallback'), 'a-b-c-.mp3');
assert.strictEqual(sanitizeAttachmentName('', ''), 'upload-file');
assert.deepStrictEqual(decodeDataUrl('data:text/plain;base64,5L2g5aW9'), {
  mimeType: 'text/plain',
  buffer: Buffer.from('你好'),
});
assert.deepStrictEqual(decodeDataUrl('data:,hello%20world'), {
  mimeType: 'application/octet-stream',
  buffer: Buffer.from('hello world'),
});
assert.strictEqual(decodeDataUrl('https://example.com/a.png'), null);

assert.strictEqual(getImageExtFromMime('image/jpeg'), 'jpg');
assert.strictEqual(getImageExtFromMime('image/webp'), 'webp');
assert.strictEqual(getImageExtFromMime('image/gif'), 'gif');
assert.strictEqual(getImageExtFromMime('image/svg+xml'), 'svg');
assert.strictEqual(getImageExtFromMime('application/octet-stream'), 'png');

assert.strictEqual(getImageExtFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])), 'png');
assert.strictEqual(getImageExtFromBuffer(Buffer.from([0xff, 0xd8, 0xff])), 'jpg');
assert.strictEqual(getImageExtFromBuffer(Buffer.from('GIF89a', 'ascii')), 'gif');
assert.strictEqual(getImageExtFromBuffer(Buffer.from('RIFF0000WEBP', 'ascii')), 'webp');
assert.strictEqual(getImageExtFromBuffer(Buffer.from('unknown'), 'https://cdn.example/a.bmp'), 'bmp');

assert.strictEqual(getAttachmentExt('report.MD', ''), 'md');
assert.strictEqual(getAttachmentExt('README', ''), '');
assert.strictEqual(getAttachmentExt('', '.MP3'), 'mp3');
assert.strictEqual(isMarkdownConvertibleExt('MARKDOWN'), true);
assert.strictEqual(isMarkdownConvertibleExt('docx'), false);
assert.strictEqual(isAudioVideoAttachmentExt('M4V'), true);
assert.strictEqual(isAudioVideoAttachmentExt('pdf'), false);

const sourceBytes = new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]);
const normalized = toNodeBuffer(sourceBytes);
assert.strictEqual(Buffer.isBuffer(normalized), true);
assert.strictEqual(normalized.toString('utf8'), '你好');
assert.strictEqual(decodeUtf8ArrayBuffer(sourceBytes), '你好');
const rawArrayBuffer = sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength);
assert.strictEqual(toNodeBuffer(rawArrayBuffer).toString('utf8'), '你好');
const offsetView = new Uint8Array([0, ...sourceBytes, 0]).subarray(1, 1 + sourceBytes.length);
assert.strictEqual(toNodeBuffer(offsetView).toString('utf8'), '你好');
const direct = Buffer.from('direct');
assert.strictEqual(toNodeBuffer(direct), direct);

const sourceMain = fs.readFileSync(sourceMainPath, 'utf8');
const migratedFunctions = [
  'getImageFileExtension',
  'getAudioFormatFromUrl',
  'hasVideoTrackInMediaBuffer',
  'bufferStartsWith',
  'getInvalidDownloadedMediaReason',
  'sanitizeAttachmentName',
  'decodeDataUrl',
  'getImageExtFromMime',
  'getImageExtFromBuffer',
  'getAttachmentExt',
  'isMarkdownConvertibleExt',
  'isAudioVideoAttachmentExt',
  'decodeUtf8ArrayBuffer',
  'toNodeBuffer',
];
for (const name of migratedFunctions) {
  assert.strictEqual(new RegExp(`function\\s+${name}\\s*\\(`).test(sourceMain), false, `${name} must not remain defined in src/main.js`);
}

console.log('plugin media file utils tests passed');