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
const syncAdminHandler = fs.readFileSync(
  path.join(root, 'cloudfunctions/syncApi/admin-handler.js'),
  'utf8'
);
const adminApiIndex = fs.readFileSync(
  path.join(root, 'cloudfunctions/adminApi/index.js'),
  'utf8'
);
const miniprogramIndex = fs.readFileSync(
  path.join(root, 'miniprogram/pages/index/index.js'),
  'utf8'
);
const miniprogramApp = fs.readFileSync(
  path.join(root, 'miniprogram/app.js'),
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

assert.match(
  miniprogramApp,
  /env:\s*["']he02-d8gebzv050ed6c4ef["']/,
  'mini program should use the WeChat cloud env id that owns production data'
);
assert.match(
  quickstartIndex,
  /env:\s*cloud\.DYNAMIC_CURRENT_ENV/,
  'quickstartFunctions should use the current deployed WeChat cloud environment'
);
assert.match(
  syncApiIndex,
  /WECHAT_DATA_ENV/,
  'syncApi should allow the HTTP deployment env to explicitly read the WeChat production data env'
);
assert.match(
  syncApiIndex,
  /pickBestLocalTranscriptionEntitlement/,
  'syncApi should treat trial, pro, and beta local transcription entitlements as one plugin permission'
);
assert.match(
  syncApiIndex,
  /isLocalTranscriptionPlan\(plan\)[\s\S]*collection\('user_entitlements'\)[\s\S]*where\(\{\s*openid\s*\}/,
  'syncApi entitlement lookup should fetch all entitlements for the openid before applying local transcription aliases'
);
assert.match(
  syncApiIndex,
  /env:\s*getCloudDataEnv\(\)/,
  'syncApi should initialize wx-server-sdk with the resolved data environment'
);
assert.ok(
  syncApiIndex.indexOf("cloud.init({") < syncApiIndex.indexOf("require('./admin-handler')"),
  'syncApi should initialize wx-server-sdk before loading admin-handler because admin-handler creates database handles at module load'
);
assert.match(
  adminApiIndex,
  /WECHAT_DATA_ENV/,
  'adminApi should allow the HTTP deployment env to explicitly read the WeChat production data env'
);
assert.match(
  adminApiIndex,
  /env:\s*getCloudDataEnv\(\)/,
  'adminApi should initialize wx-server-sdk with the resolved data environment'
);
assert.match(
  syncAdminHandler,
  /WECHAT_DATA_ENV/,
  'syncApi admin handler should not reinitialize wx-server-sdk back to the empty deployment env'
);
assert.match(
  syncAdminHandler,
  /env:\s*getCloudDataEnv\(\)/,
  'syncApi admin handler should use the same resolved data environment as syncApi'
);
