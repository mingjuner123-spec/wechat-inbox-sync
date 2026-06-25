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
const miniprogramCloudEnv = fs.readFileSync(
  path.join(root, 'miniprogram/services/cloud-env.js'),
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
  miniprogramCloudEnv,
  /WECHAT_CLOUD_ENV\s*=\s*['"]he02-d8gebzv050ed6c4ef['"]/,
  'mini program should use the WeChat cloud env id that owns production data'
);
assert.match(
  miniprogramApp,
  /initCloud\(wx\)/,
  'mini program cloud init should go through the centralized fixed env helper'
);
assert.doesNotMatch(
  miniprogramApp,
  /env:\s*this\.globalData\.env\s*\|\|\s*undefined/,
  'mini program must not fall back to the developer-tools selected env because invalid local envs break sync'
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
  /PRODUCTION_WECHAT_DATA_ENV\s*=\s*['"]he02-d8gebzv050ed6c4ef['"]/,
  'syncApi should fall back to the production WeChat data env when HTTP service env variables are missing'
);
assert.match(
  syncApiIndex,
  /ALLOWED_WECHAT_DATA_ENVS[\s\S]*PRODUCTION_WECHAT_DATA_ENV[\s\S]*has\(configured\)[\s\S]*PRODUCTION_WECHAT_DATA_ENV/,
  'syncApi should ignore invalid HTTP deployment env ids and always read the production WeChat data env'
);
assert.match(
  syncApiIndex,
  /pickBestLocalTranscriptionEntitlement/,
  'syncApi should treat trial, pro, and beta local transcription entitlements as one plugin permission'
);
assert.match(
  syncApiIndex,
  /const\s*\{[\s\S]*normalizeRedeemCode[\s\S]*\}\s*=\s*require\('\.\/redeem-code-core'\)/,
  'syncApi should import normalizeRedeemCode before using it in entitlement state'
);
assert.match(
  syncApiIndex,
  /isLocalTranscriptionPlan\(plan\)[\s\S]*collection\('user_entitlements'\)[\s\S]*where\(\{\s*openid\s*\}/,
  'syncApi entitlement lookup should fetch all entitlements for the openid before applying local transcription aliases'
);
assert.match(
  syncApiIndex,
  /const\s+CLOUD_DATA_ENV\s*=\s*getCloudDataEnv\(\)[\s\S]*env:\s*CLOUD_DATA_ENV/,
  'syncApi should initialize wx-server-sdk with the resolved data environment'
);
assert.match(
  syncApiIndex,
  /function\s+getDataCloud\(\)[\s\S]*resourceEnv:\s*CLOUD_DATA_ENV[\s\S]*cloud\.Cloud\(options\)[\s\S]*dataCloud\.init\(\)/,
  'syncApi should use a resource-bound cloud instance for the resolved data environment'
);
assert.match(
  syncApiIndex,
  /function\s+getDatabase\(\)[\s\S]*cloud\.database\(\{\s*env:\s*CLOUD_DATA_ENV\s*\}\)/,
  'syncApi repository and admin diagnostics should use the same explicit production database env'
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
  /env:\s*getCloudDataEnv\(\)|env:\s*CLOUD_DATA_ENV/,
  'adminApi should initialize wx-server-sdk with the resolved data environment'
);
assert.match(
  syncAdminHandler,
  /WECHAT_DATA_ENV/,
  'syncApi admin handler should not reinitialize wx-server-sdk back to the empty deployment env'
);
assert.match(
  syncAdminHandler,
  /PRODUCTION_WECHAT_DATA_ENV\s*=\s*['"]he02-d8gebzv050ed6c4ef['"]/,
  'syncApi admin handler should share the same production data env fallback'
);
assert.match(
  syncAdminHandler,
  /ALLOWED_WECHAT_DATA_ENVS[\s\S]*PRODUCTION_WECHAT_DATA_ENV[\s\S]*has\(configured\)[\s\S]*PRODUCTION_WECHAT_DATA_ENV/,
  'syncApi admin handler should resolve the same data env as syncApi'
);
assert.match(
  syncAdminHandler,
  /const\s+CLOUD_DATA_ENV\s*=\s*getCloudDataEnv\(\)[\s\S]*env:\s*CLOUD_DATA_ENV/,
  'syncApi admin handler should use the same resolved data environment as syncApi'
);
assert.match(
  syncAdminHandler,
  /const\s+CLOUD_DATA_ENV\s*=\s*getCloudDataEnv\(\)[\s\S]*cloud\.database\(\{\s*env:\s*CLOUD_DATA_ENV\s*\}\)/,
  'syncApi admin handler should create database handles with the resolved data environment'
);
