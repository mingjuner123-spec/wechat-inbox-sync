'use strict';

const assert = require('node:assert/strict');
const {
  shouldCheckLocalDouyinResolver,
  shouldForceLocalDouyinResolverCheck,
} = require('../obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils');

const now = 1720000000000;
assert.equal(shouldCheckLocalDouyinResolver({ now, lastCheckedAt: 0 }), true);
assert.equal(shouldCheckLocalDouyinResolver({ now, lastCheckedAt: now - 47 * 60 * 60 * 1000 }), false);
assert.equal(shouldCheckLocalDouyinResolver({ now, lastCheckedAt: now - 48 * 60 * 60 * 1000 }), true);
assert.equal(shouldCheckLocalDouyinResolver({ now, lastCheckedAt: now, force: true }), true);
assert.equal(shouldForceLocalDouyinResolverCheck(new Error('yt-dlp extractor is outdated')), true);
assert.equal(shouldForceLocalDouyinResolverCheck(new Error('fresh cookies are needed')), false);

