'use strict';

const assert = require('node:assert/strict');
const {
  shouldCheckLocalDouyinResolver,
  shouldForceLocalDouyinResolverCheck,
  isValidSha256,
  selectLocalDouyinResolverAsset,
  getLocalDouyinResolverRoot,
  buildNetscapeCookieFile,
  extractLocalDouyinResolverMediaUrls,
} = require('../obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils');

const now = 1720000000000;
assert.equal(shouldCheckLocalDouyinResolver({ now, lastCheckedAt: 0 }), true);
assert.equal(shouldCheckLocalDouyinResolver({ now, lastCheckedAt: now - 47 * 60 * 60 * 1000 }), false);
assert.equal(shouldCheckLocalDouyinResolver({ now, lastCheckedAt: now - 48 * 60 * 60 * 1000 }), true);
assert.equal(shouldCheckLocalDouyinResolver({ now, lastCheckedAt: now, force: true }), true);
assert.equal(shouldForceLocalDouyinResolverCheck(new Error('yt-dlp extractor is outdated')), true);
assert.equal(shouldForceLocalDouyinResolverCheck(new Error('fresh cookies are needed')), false);

const manifest = {
  schemaVersion: 1,
  assets: {
    'win32-x64': {
      url: 'https://cdn.example/yt-dlp/2026.08.17/win32-x64/yt-dlp.exe',
      sha256: 'a'.repeat(64),
    },
  },
};
assert.deepEqual(selectLocalDouyinResolverAsset(manifest, 'win32', 'x64'), manifest.assets['win32-x64']);
assert.equal(selectLocalDouyinResolverAsset(manifest, 'linux', 'x64'), null);
assert.equal(isValidSha256('not-a-hash'), false);

assert.equal(
  getLocalDouyinResolverRoot('C:\\Users\\Alice'),
  'C:\\Users\\Alice\\.wechat-inbox-local-asr\\tools\\yt-dlp',
  'the resolver stays underneath the existing local ASR root instead of creating another user-visible top-level directory',
);

const cookiesText = buildNetscapeCookieFile([
  {
    domain: '.douyin.com',
    path: '/',
    secure: true,
    expirationDate: 1900000000,
    name: 'sessionid',
    value: 'session-value',
  },
  {
    domain: '.example.com',
    name: 'unrelated',
    value: 'must-not-export',
  },
]);
assert.match(cookiesText, /^# Netscape HTTP Cookie File\n/m);
assert.match(cookiesText, /\.douyin\.com\tTRUE\t\/\tTRUE\t1900000000\tsessionid\tsession-value/);
assert.doesNotMatch(cookiesText, /unrelated|must-not-export/);

assert.deepEqual(
  extractLocalDouyinResolverMediaUrls(JSON.stringify({
    requested_formats: [
      { url: 'https://cdn.example/video.mp4' },
      { url: 'https://cdn.example/audio.m4a' },
    ],
  })),
  ['https://cdn.example/video.mp4', 'https://cdn.example/audio.m4a'],
  'yt-dlp JSON output must preserve all requested direct media URLs for download fallback',
);
assert.deepEqual(extractLocalDouyinResolverMediaUrls('{not-json'), []);
