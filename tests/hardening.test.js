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
  /env:\s*getCloudDataEnv\(\)/,
  'quickstartFunctions should initialize wx-server-sdk with the resolved data environment'
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
assert.match(
  syncApiIndex,
  /cloud\.database\(\{\s*env:\s*getCloudDataEnv\(\),\s*\}\)/,
  'syncApi database handle should explicitly use the resolved data environment'
);
assert.match(
  syncAdminHandler,
  /cloud\.database\(\{\s*env:\s*getCloudDataEnv\(\),\s*\}\)/,
  'syncApi admin handler database handle should explicitly use the resolved data environment'
);
const activeAiMetadataBody = syncApiIndex.slice(
  syncApiIndex.lastIndexOf('async function generateAiMetadataWithModel'),
  syncApiIndex.indexOf('function downloadPreparedMedia'),
);
assert.match(
  activeAiMetadataBody,
  /Title: \$\{title\}/,
  'AI metadata prompt should send the real title to the model'
);
assert.match(
  activeAiMetadataBody,
  /Content:\\n\$\{content\}/,
  'AI metadata prompt should send the real content to the model'
);
assert.match(
  activeAiMetadataBody,
  /Simplified Chinese/,
  'AI metadata prompt should require Chinese output for mostly Chinese content'
);
assert.doesNotMatch(
  activeAiMetadataBody,
  /\{payload\.content \|\| ''\}/,
  'AI metadata prompt must not send a literal payload placeholder'
);
assert.doesNotMatch(
  activeAiMetadataBody,
  /[\u6D63\u9350\u93C1]\S{2,}/,
  'active AI metadata prompt should not contain mojibake text'
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
  /PRODUCTION_WECHAT_DATA_ENV\s*=\s*['"]he02-d8gebzv050ed6c4ef['"]/,
  'syncApi admin handler should share the same production data env fallback'
);
assert.match(
  syncAdminHandler,
  /env:\s*getCloudDataEnv\(\)/,
  'syncApi admin handler should use the same resolved data environment as syncApi'
);
