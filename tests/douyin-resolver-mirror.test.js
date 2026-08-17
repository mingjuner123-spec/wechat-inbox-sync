'use strict';

const assert = require('node:assert/strict');
const {
  buildManifest,
  getTcbInvocation,
  parseOfficialChecksums,
  sha256,
} = require('../scripts/sync-douyin-resolver-mirror');

const checksum = sha256(Buffer.from('binary'));
const manifest = buildManifest({
  tagName: '2026.07.04',
  selected: [{
    key: 'win32-x64',
    localName: 'yt-dlp.exe',
    sha256: checksum,
  }],
});
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.version, '2026.07.04');
assert.equal(manifest.assets['win32-x64'].sha256, checksum);
assert.match(manifest.assets['win32-x64'].url, new RegExp(`/yt-dlp/by-sha256/${checksum}/yt-dlp\\.exe$`));

const checksums = parseOfficialChecksums(`${checksum}  yt-dlp.exe\n`);
assert.equal(checksums.get('yt-dlp.exe'), checksum);

assert.deepEqual(
  getTcbInvocation('D:\\AIbc\\tcb.cmd', ['hosting', 'list'], 'win32'),
  {
    command: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', "& 'D:\\AIbc\\tcb.cmd' 'hosting' 'list'"],
  },
  'Windows .cmd launchers must be invoked through PowerShell instead of spawnSync directly',
);

console.log('douyin-resolver-mirror.test.js passed');
