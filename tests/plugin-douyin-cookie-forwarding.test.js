'use strict';

const assert = require('node:assert/strict');
const { buildNetscapeCookieFile, dedupeDouyinCookies } = require('../obsidian-plugin/wechat-inbox-sync/src/local-douyin-resolver-utils');
const { failureMessage } = require('../obsidian-plugin/wechat-inbox-sync/src/douyin-diagnostic-utils');

const cookies = [
  { domain: '.douyin.com', path: '/', name: 'sessionid', value: 'parent-first' },
  { domain: '.douyin.com', path: '/', name: 'sessionid', value: 'same-scope-later' },
  { domain: 'www.douyin.com', path: '/', name: 'sessionid', value: 'host-scope' },
  { domain: '.douyin.com', path: '/aweme', name: 'sessionid', value: 'path-scope' },
  { domain: '.douyin.com', path: '/', name: 'sid_guard', value: 'guard-scope' },
  { domain: '.not-douyin.com', path: '/', name: 'sessionid', value: 'untrusted-domain' },
];

const uniqueCookies = dedupeDouyinCookies(cookies);
assert.deepEqual(uniqueCookies.map(cookie => [cookie.domain, cookie.path, cookie.name, cookie.value]), [
  ['.douyin.com', '/', 'sessionid', 'parent-first'],
  ['www.douyin.com', '/', 'sessionid', 'host-scope'],
  ['.douyin.com', '/aweme', 'sessionid', 'path-scope'],
  ['.douyin.com', '/', 'sid_guard', 'guard-scope'],
  ['.not-douyin.com', '/', 'sessionid', 'untrusted-domain'],
]);

const cookieRows = buildNetscapeCookieFile(uniqueCookies).split('\n').filter(line => line && !line.startsWith('#'));
assert.equal(cookieRows.length, 4, 'same cookie scope is deduplicated and non-Douyin domains are filtered');
assert.deepEqual(cookieRows.map(line => line.split('\t').slice(0, 3)), [
  ['.douyin.com', 'TRUE', '/'],
  ['www.douyin.com', 'FALSE', '/'],
  ['.douyin.com', 'TRUE', '/aweme'],
  ['.douyin.com', 'TRUE', '/'],
]);
assert.deepEqual(cookieRows.map(line => line.split('\t')[5]), ['sessionid', 'sessionid', 'sessionid', 'sid_guard']);
assert.equal(cookieRows.some(line => line.includes('untrusted-domain')), false);

const freshCookieMessage = failureMessage('DOUYIN_COOKIE_REFRESH_REQUIRED');
assert.match(freshCookieMessage, /更新网页访问校验信息（Cookie）/);
assert.match(freshCookieMessage, /不等于未登录/);
assert.match(freshCookieMessage, /打开这条作品/);
assert.match(freshCookieMessage, /正常播放后再重试/);
assert.match(freshCookieMessage, /显示已登录不代表作品访问校验已通过/);
assert.doesNotMatch(freshCookieMessage, /重新登录后重试/);

console.log('plugin-douyin-cookie-forwarding.test.js passed');
