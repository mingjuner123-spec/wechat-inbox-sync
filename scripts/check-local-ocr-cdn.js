const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const pluginOcrDir = path.join(repoRoot, 'obsidian-plugin', 'wechat-inbox-sync', 'local-ocr');
const baseUrl = String(process.env.LOCAL_OCR_CDN_BASE_URL
  || 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-ocr/common')
  .replace(/\/+$/, '');
const pythonRuntimeBaseUrl = String(process.env.LOCAL_PYTHON_CDN_BASE_URL
  || 'https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-python/python-build-standalone/releases/download/20260623')
  .replace(/\/+$/, '');

const assets = [
  'install-local-ocr.ps1',
  'install-local-ocr-macos.sh',
  'ocr_image.py',
];
const pythonRuntimes = [
  {
    fileName: 'cpython-3.12.13+20260623-x86_64-pc-windows-msvc-install_only.tar.gz',
    sha256: 'C6AF85BB83D5158C9FF71F50DFAD467853D1CD236F932B144E87E26E2EA2A83E',
  },
  {
    fileName: 'cpython-3.12.13+20260623-aarch64-apple-darwin-install_only.tar.gz',
    sha256: '3724AA4DAFB5F7B6C2CF98E89914E4248DC6BD2FE40407DF4A2D73DE99615F16',
  },
  {
    fileName: 'cpython-3.12.13+20260623-x86_64-apple-darwin-install_only.tar.gz',
    sha256: '7C57FDD1FA675190093700EB0D8E7117E1F9EAE7C30A46DEA5F8D5266BCFC791',
  },
];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function releaseBytes(buffer) {
  return Buffer.from(buffer.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
}

async function fetchUrl(url) {
  const response = await fetch(url, {
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (!response.ok) {
    throw new Error(`${url}: CDN returned HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchPublicAsset(fileName) {
  const url = `${baseUrl}/${fileName}?release_check=${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return fetchUrl(url);
}

async function main() {
  for (const fileName of assets) {
    const local = releaseBytes(fs.readFileSync(path.join(pluginOcrDir, fileName)));
    const remote = await fetchPublicAsset(fileName);
    const localHash = sha256(local);
    const remoteHash = sha256(remote);
    if (!local.equals(remote)) {
      throw new Error(`${fileName}: CDN mismatch (local ${localHash}, remote ${remoteHash})`);
    }
    console.log(`${fileName}: OK ${localHash}`);
  }

  for (const runtime of pythonRuntimes) {
    const url = `${pythonRuntimeBaseUrl}/${runtime.fileName}?release_check=${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const remoteHash = sha256(await fetchUrl(url));
    if (remoteHash !== runtime.sha256) {
      throw new Error(`${runtime.fileName}: CDN runtime hash mismatch (expected ${runtime.sha256}, remote ${remoteHash})`);
    }
    console.log(`${runtime.fileName}: OK ${remoteHash}`);
  }
}

main().catch((error) => {
  console.error(`LOCAL_OCR_CDN_CHECK_FAILED: ${error.message || error}`);
  process.exitCode = 1;
});
