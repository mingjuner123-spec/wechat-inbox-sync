const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'cloudfunctions/quickstartFunctions/index.js'), 'utf8');

[
  'adminGenerateRedeemCodes',
  'adminListRedeemCodes',
  'adminListEntitlements',
  'adminListBindCodes',
  'adminGetDashboard',
  'adminUpdateEntitlement',
  'adminUpdateRedeemCode',
  'trackAnalyticsEvent',
].forEach((name) => {
  assert.match(indexSource, new RegExp(`async function ${name}`));
  assert.match(indexSource, new RegExp(`case '${name}'`));
});

assert.match(indexSource, /assertRedeemAdmin\(event\)/);
assert.match(indexSource, /REDEEM_ADMIN_SECRET/);
assert.match(indexSource, /createAdminRedeemCodeDocuments/);
assert.match(indexSource, /adminUpdateEntitlement/);
assert.match(indexSource, /action === 'extend'/);
assert.match(indexSource, /markSent/);
assert.match(indexSource, /markUnsent/);
assert.match(indexSource, /deliveryStatus/);
assert.match(indexSource, /deliveryStatusText/);
assert.match(indexSource, /summarizeAdminDashboard/);
assert.match(indexSource, /inbox_records/);
assert.match(indexSource, /readAdminCollectionSnapshot/);
assert.match(indexSource, /collection\.count\(\)/);
assert.match(indexSource, /maxRead/);
assert.match(indexSource, /buildAdminDashboardScope/);
assert.match(indexSource, /analytics_events/);
assert.match(indexSource, /app_visit/);
assert.match(indexSource, /bind_page_view/);
assert.match(indexSource, /bind_success/);
