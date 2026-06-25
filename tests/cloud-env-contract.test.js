const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const productionEnv = 'he02-d8gebzv050ed6c4ef';
const appJs = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');
const cloudbaserc = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));

assert.match(appJs, new RegExp(`WECHAT_CLOUD_ENV\\s*=\\s*['"]${productionEnv}['"]`));
assert.match(appJs, /wx\.cloud\.init\(\{\s*env:\s*WECHAT_CLOUD_ENV/);
assert.doesNotMatch(appJs, /env:\s*this\.globalData\.env\s*\|\|\s*undefined/);
assert.doesNotMatch(appJs, /env:\s*undefined/);

for (const item of cloudbaserc.functions || []) {
  assert.strictEqual(
    item.envVariables && item.envVariables.WECHAT_DATA_ENV,
    productionEnv,
    `${item.name} must read/write the production WeChat data env`,
  );
}

assert.strictEqual(cloudbaserc.envId, 'he02-d8gebzv050ed6c4ef-d350b93bf');
