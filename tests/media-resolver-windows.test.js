const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const setupScript = fs.readFileSync(path.join(root, 'media-resolver/setup-windows.ps1'), 'utf8');
const startScript = fs.readFileSync(path.join(root, 'media-resolver/start-windows.ps1'), 'utf8');

assert.match(setupScript, /yt-dlp\.exe/);
assert.match(setupScript, /github\.com\/yt-dlp\/yt-dlp\/releases\/latest\/download\/yt-dlp\.exe/);
assert.match(setupScript, /Invoke-WebRequest/);
assert.match(setupScript, /bin/);

assert.match(startScript, /\$env:YT_DLP_BIN/);
assert.match(startScript, /\$env:YT_DLP_COOKIE_FILE/);
assert.match(startScript, /\$CookieFile/);
assert.match(startScript, /\$env:RESOLVER_SECRET/);
assert.match(startScript, /node\s+server\.js/);
assert.match(startScript, /PUBLIC_BASE_URL/);

console.log('media-resolver-windows.test.js passed');
