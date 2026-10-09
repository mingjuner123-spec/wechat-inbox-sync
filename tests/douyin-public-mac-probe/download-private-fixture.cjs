'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const HASH = '3f1295443ea9541de08fd5a61b1e01436752e2582b1469adfb31cfedec4093b3';
const BYTES = 562604;
async function main() {
  const url = new URL(process.env.ASR_FIXTURE_URL || '');
  if (url.protocol !== 'https:' || url.hostname !== '6865-he02-d8gebzv050ed6c4ef-1428610652.cos.ap-shanghai.myqcloud.com' || url.port || url.username || url.password) throw Error('FIXTURE_HOST_REJECTED');
  if (process.env.ASR_FIXTURE_SHA256 !== HASH) throw Error('FIXTURE_PIN_MISMATCH');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error('FIXTURE_HTTP_' + response.status);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > BYTES) throw Error('FIXTURE_TOO_LARGE');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (bytes !== BYTES || crypto.createHash('sha256').update(buffer).digest('hex') !== HASH) throw Error('FIXTURE_IDENTITY_MISMATCH');
  const root = path.join(process.env.RUNNER_TEMP, 'asr-engine-private');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(root, 'fixture.bin'), buffer, { mode: 0o600, flag: 'wx' });
}
main().catch(error => {
  const code = /^FIXTURE_[A-Z0-9_]+$/.test(error.message) ? error.message : 'FIXTURE_TRANSPORT_FAILED';
  const cause = /^[A-Z0-9_]+$/.test(error.cause?.code || '') ? error.cause.code : 'NONE';
  process.stderr.write(code + ' cause=' + cause + '\n'); process.exitCode = 1;
});
