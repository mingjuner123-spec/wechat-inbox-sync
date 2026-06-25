const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const productionEnv = 'he02-d8gebzv050ed6c4ef';
const appJs = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');
const cloudEnvJs = fs.readFileSync(path.join(root, 'miniprogram/services/cloud-env.js'), 'utf8');
const inboxServiceJs = fs.readFileSync(path.join(root, 'miniprogram/services/inbox-service.js'), 'utf8');
const cloudbaserc = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));

function listFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(fullPath, files);
    } else if (entry.isFile() && fullPath.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripTemplateLiterals(source) {
  return source.replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``');
}

assert.match(cloudEnvJs, new RegExp(`WECHAT_CLOUD_ENV\\s*=\\s*['"]${productionEnv}['"]`));
assert.match(appJs, /require\(['"]\.\/services\/cloud-env['"]\)/);
assert.match(appJs, /initCloud\(wx\)/);
assert.match(inboxServiceJs, /require\(['"]\.\/cloud-env['"]\)/);
assert.doesNotMatch(inboxServiceJs, /cloud\.callFunction\(\{/);
assert.doesNotMatch(inboxServiceJs, /cloud\.uploadFile\(\{/);
assert.doesNotMatch(appJs, /env:\s*this\.globalData\.env\s*\|\|\s*undefined/);
assert.doesNotMatch(appJs, /env:\s*undefined/);
assert.doesNotMatch(inboxServiceJs, /env:\s*undefined/);

const allowedCloudBoundary = path.join(root, 'miniprogram/services/cloud-env.js');
for (const filePath of listFiles(path.join(root, 'miniprogram'))) {
  if (filePath === allowedCloudBoundary) continue;
  const source = stripTemplateLiterals(fs.readFileSync(filePath, 'utf8'));
  assert.doesNotMatch(
    source,
    /(?:wx\.)?cloud\.callFunction\(\{/,
    `${path.relative(root, filePath)} must call cloud functions through services/cloud-env`,
  );
  assert.doesNotMatch(
    source,
    /(?:wx\.)?cloud\.uploadFile\(\{/,
    `${path.relative(root, filePath)} must upload files through services/cloud-env`,
  );
}

for (const item of cloudbaserc.functions || []) {
  assert.strictEqual(
    item.envVariables && item.envVariables.WECHAT_DATA_ENV,
    productionEnv,
    `${item.name} must read/write the production WeChat data env`,
  );
}

assert.strictEqual(cloudbaserc.envId, 'he02-d8gebzv050ed6c4ef-d350b93bf');
