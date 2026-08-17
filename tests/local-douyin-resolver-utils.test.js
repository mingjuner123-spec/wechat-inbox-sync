'use strict';

const assert = require('node:assert/strict');
const {
  shouldCheckLocalDouyinResolver,
  shouldForceLocalDouyinResolverCheck,
  isValidSha256,
  selectLocalDouyinResolverAsset,
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
