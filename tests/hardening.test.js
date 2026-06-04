const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const quickstartIndex = fs.readFileSync(
  path.join(root, 'cloudfunctions/quickstartFunctions/index.js'),
  'utf8'
);
const syncApiIndex = fs.readFileSync(
  path.join(root, 'cloudfunctions/syncApi/index.js'),
  'utf8'
);
const miniprogramIndex = fs.readFileSync(
  path.join(root, 'miniprogram/pages/index/index.js'),
  'utf8'
);

assert.match(
  quickstartIndex,
  /\.where\(\{\s*_id:\s*usage\._id,[\s\S]*used:\s*_\.lt\(/,
  'daily quota consumption should use an atomic conditional update'
);
assert.match(
  quickstartIndex,
  /req\.setTimeout\(REQUEST_TIMEOUT_MS/,
  'Feishu webhook request should have a timeout'
);

assert.match(
  syncApiIndex,
  /const repository = createRepository\(\);[\s\S]*exports\.main/,
  'syncApi should reuse one repository per cloud function instance'
);
assert.doesNotMatch(
  syncApiIndex,
  /require\(['"]\.\.\/quickstartFunctions\//,
  'syncApi must be self-contained because cloud functions are deployed as separate directories'
);

assert.match(
  miniprogramIndex,
  /MAX_RECENT_ITEMS\s*=\s*50/,
  'mini program should cap recent items'
);
assert.match(
  miniprogramIndex,
  /prependRecentItems\(items\)/,
  'mini program should centralize recent-list prepending'
);
