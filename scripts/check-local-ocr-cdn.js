const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const pluginOcrDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync', 'local-ocr');
const baseUrl = String(process.env.LOCAL_OCR_CDN_BASE_URL
  || 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common')
  .replace(/\/+$/, '');

const assets = [
  'install-local-ocr.ps1',
  'install-local-ocr-macos.sh',
  'ocr_image.py',
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function fetchPublicAsset(fileName) {
  const url = `${baseUrl}/${fileName}?release_check=${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (!response.ok) {
    throw new Error(`${fileName}: CDN returned HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  for (const fileName of assets) {
    const local = fs.readFileSync(path.join(pluginOcrDir, fileName));
    const remote = await fetchPublicAsset(fileName);
    const localHash = sha256(local);
    const remoteHash = sha256(remote);
    if (!local.equals(remote)) {
      throw new Error(`${fileName}: CDN mismatch (local ${localHash}, remote ${remoteHash})`);
    }
    console.log(`${fileName}: OK ${localHash}`);
  }
}

main().catch((error) => {
  console.error(`LOCAL_OCR_CDN_CHECK_FAILED: ${error.message || error}`);
  process.exitCode = 1;
});
