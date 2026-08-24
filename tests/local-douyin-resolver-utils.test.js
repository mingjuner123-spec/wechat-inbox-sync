'use strict';

const assert = require('node:assert/strict');
const {
  isValidSha256,
  selectLocalDouyinResolverAsset,
  buildLocalDouyinResolverGithubManifest,
  getLocalDouyinResolverRoot,
  buildNetscapeCookieFile,
  extractLocalDouyinResolverMediaUrls,
} = require('../obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils');

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

const githubManifest = buildLocalDouyinResolverGithubManifest(
  { tag_name: '2026.08.24' },
  `${'b'.repeat(64)}  yt-dlp.exe\n${'c'.repeat(64)}  yt-dlp_macos\n`,
);
assert.equal(
  githubManifest.assets['win32-x64'].url,
  'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.24/yt-dlp.exe',
);
assert.equal(githubManifest.assets['darwin-arm64'].sha256, 'c'.repeat(64));
assert.equal(buildLocalDouyinResolverGithubManifest({ tag_name: '../latest' }, ''), null);

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
