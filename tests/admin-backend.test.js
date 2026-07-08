const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'cloudfunctions/quickstartFunctions/index.js'), 'utf8');
const syncAdminHandlerSource = fs.readFileSync(path.join(root, 'cloudfunctions/syncApi/admin-handler.js'), 'utf8');
const syncApiSource = fs.readFileSync(path.join(root, 'cloudfunctions/syncApi/index.js'), 'utf8');
const adminApiSource = fs.readFileSync(path.join(root, 'cloudfunctions/adminApi/index.js'), 'utf8');
const paymentCoreSource = fs.readFileSync(path.join(root, 'cloudfunctions/quickstartFunctions/payment-core.js'), 'utf8');
const cloudbaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));

[
  'adminGenerateRedeemCodes',
  'adminListRedeemCodes',
  'adminListEntitlements',
  'adminListBindCodes',
  'adminGetDashboard',
  'adminUpdateEntitlement',
  'adminRepairPaidEntitlements',
  'adminUpdateRedeemCode',
  'trackAnalyticsEvent',
  'processCloudPreTranscription',
  'processCloudTranscriptionQueue',
  'sendDailyOpsReport',
  'adminCreateHermesTask',
  'adminListHermesTasks',
  'adminUpdateHermesTask',
  'getCloudRuntimeConfigStatus',
  'adminRetryCloudPreTranscription',
].forEach((name) => {
  assert.match(indexSource, new RegExp(`async function ${name}`));
  assert.match(indexSource, new RegExp(`case '${name}'`));
});

assert.match(indexSource, /async function getTrialRedeemCode/);
assert.match(indexSource, /case 'getTrialRedeemCode'/);
assert.match(indexSource, /trialOwnerOpenid/);
assert.match(indexSource, /codeDoc\.trialOwnerOpenid && codeDoc\.trialOwnerOpenid !== wxContext\.OPENID/);
assert.match(indexSource, /self-service-pro-trial/);
assert.match(indexSource, /local_transcription_trial/);
const trialRedeemBody = indexSource.slice(
  indexSource.indexOf('async function activateTrialRedeemCode'),
  indexSource.indexOf('function assertRedeemAdmin'),
);
assert.match(trialRedeemBody, /ensureCollection\('user_entitlements'\)/);
assert.match(trialRedeemBody, /createEntitlementDocument/);
assert.match(trialRedeemBody, /buildEntitlementState\(activation\.entitlement/);
assert.match(trialRedeemBody, /alreadyActivated/);
assert.match(indexSource, /assertRedeemAdmin\(event\)/);
assert.match(indexSource, /REDEEM_ADMIN_SECRET/);
assert.match(indexSource, /createAdminRedeemCodeDocuments/);
assert.match(indexSource, /adminUpdateEntitlement/);
assert.match(indexSource, /adminRepairPaidEntitlements/);
assert.match(indexSource, /ensurePaidRedeemCodeForPayment/);
assert.match(indexSource, /action === 'extend'/);
assert.match(syncAdminHandlerSource, /setExpiresAt/);
assert.match(syncAdminHandlerSource, /Invalid Pro expiration time/);
assert.match(syncAdminHandlerSource, /paymentOrderNo/);
assert.match(syncAdminHandlerSource, /latestPaymentOrderNo/);
assert.match(syncAdminHandlerSource, /wxOrderId/);
assert.match(syncAdminHandlerSource, /transactionId/);
assert.match(syncAdminHandlerSource, /paymentNotifyStatus/);
assert.match(syncAdminHandlerSource, /paymentNotifyWebhookConfigured/);
assert.match(syncAdminHandlerSource, /PAYMENT_NOTIFY_WEBHOOK/);
assert.match(adminApiSource, /setExpiresAt/);
assert.match(adminApiSource, /Invalid Pro expiration time/);
assert.match(adminApiSource, /paymentOrderNo/);
assert.match(adminApiSource, /latestPaymentOrderNo/);
assert.match(adminApiSource, /wxOrderId/);
assert.match(adminApiSource, /transactionId/);
assert.match(adminApiSource, /paymentNotifyStatus/);
[
  indexSource,
  syncAdminHandlerSource,
  adminApiSource,
  syncApiSource,
].forEach((source) => {
  assert.match(source, /pickPaymentCarryoverEntitlement/);
  assert.match(source, /mergePaidEntitlementWithCarryover/);
  assert.match(source, /ensurePaidRedeemCodeForPayment/);
  assert.match(source, /createPaidRedeemCodeDocument/);
});
assert.match(paymentCoreSource, /paidOwnerOpenid/);
assert.match(indexSource, /codeDoc\.paidOwnerOpenid/);
assert.match(syncApiSource, /effectiveCodeDoc\.paidOwnerOpenid/);
assert.match(indexSource, /trialOwnerOpenid/);
assert.match(indexSource, /paidOwnerOpenid/);
assert.match(indexSource, /createPaidRedeemCodeDocument\(\{\s*code,/);
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
assert.match(indexSource, /HERMES_WEBHOOK_URL/);
assert.match(indexSource, /HERMES_LOCAL_QUEUE_ENABLED/);
assert.match(indexSource, /hermes_tasks/);
assert.match(indexSource, /buildDailyOpsReport/);
assert.match(indexSource, /buildDailyOpsReportWebhookPayload/);
assert.match(indexSource, /TriggerName === 'daily-ops-report-at-night'/);
assert.match(indexSource, /app_visit/);
assert.match(indexSource, /bind_page_view/);
assert.match(indexSource, /bind_success/);
assert.match(indexSource, /DOUBAO_ASR_API_KEY/);
assert.match(indexSource, /doubaoAsrApiKeyConfigured/);
assert.match(indexSource, /doubaoAsrApiKeyLength/);
assert.match(indexSource, /virtualPaymentConfigured/);
assert.match(indexSource, /virtualPaymentMissing/);
assert.match(indexSource, /virtualPaymentEnv/);
assert.match(indexSource, /virtualPaymentOfferIdConfigured/);
assert.match(indexSource, /virtualPaymentAppKeyConfigured/);
assert.match(indexSource, /wechatAppSecretConfigured/);
assert.match(indexSource, /paymentPlanPricesFen/);
assert.match(indexSource, /paymentDiagnosticsVersion/);
assert.match(indexSource, /application\/json; charset=utf-8/);
assert.match(fs.readFileSync(path.join(root, 'cloudfunctions/syncApi/index.js'), 'utf8'), /application\/json; charset=utf-8/);
assert.match(indexSource, /function getCloudDataEnv/);
assert.match(indexSource, /process\.env\.WECHAT_DATA_ENV/);
assert.strictEqual(cloudbaseConfig.functions.find((item) => item.name === 'quickstartFunctions').envVariables.WECHAT_DATA_ENV, 'he02-d8gebzv050ed6c4ef');
assert.match(indexSource, /const http = require\('http'\)/);
assert.match(indexSource, /runDoubaoCloudTranscription/);
assert.match(indexSource, /submitDoubaoCloudTranscription/);
assert.match(indexSource, /queryDoubaoCloudTranscription/);
assert.match(indexSource, /processCloudTranscriptionQueue/);
assert.match(indexSource, /getDoubaoPayloadDurationSeconds/);
assert.match(indexSource, /getBillableCloudSecondsFromResult/);
assert.match(indexSource, /processCloudPreTranscription/);
assert.match(indexSource, /fetchTextUrl/);
assert.match(indexSource, /extractCloudPreTranscriptionMediaUrl/);
assert.match(indexSource, /MEDIA_RESOLVER_URL/);
assert.match(indexSource, /MEDIA_RESOLVER_SECRET/);
assert.match(indexSource, /async function requestMediaResolver/);
assert.match(indexSource, /async function resolveWebpageAudioUrl/);
assert.match(indexSource, /function normalizeResolverMediaUrl/);
assert.match(indexSource, /data\.proxied/);
assert.match(indexSource, /media\.pathname\.startsWith\('\/media\/'\)/);
assert.match(indexSource, /resolver\.protocol === 'https:'/);
assert.match(indexSource, /async function findInboxRecordByIdFromSnapshot/);
assert.match(indexSource, /findInboxRecordByIdFromSnapshot\(recordId\)/);
assert.match(indexSource, /parsed\.protocol === 'http:' \? http : https/);
assert.match(indexSource, /transcriptOnly: true/);
assert.match(indexSource, /cloud_transcription_usages/);
assert.match(indexSource, /transcriptionStatus: 'success'/);
assert.match(indexSource, /cloudDetectedDurationSeconds/);
assert.match(indexSource, /doubaoRequestId/);
assert.match(indexSource, /cloudNextPollAt/);
assert.match(indexSource, /CLOUD_TRANSCRIPTION_MAX_POLL_ATTEMPTS/);

const completeCloudPreTranscriptionBody = indexSource.slice(
  indexSource.indexOf('async function completeCloudPreTranscriptionRecord'),
  indexSource.indexOf('async function processCloudPreTranscription'),
);
assert.doesNotMatch(completeCloudPreTranscriptionBody, /reactivateSyncedRecordPatch/);
assert.doesNotMatch(completeCloudPreTranscriptionBody, /status:\s*'pending'/);
assert.doesNotMatch(completeCloudPreTranscriptionBody, /syncedAt:\s*''/);

const processCloudPreTranscriptionRecordBody = indexSource.slice(
  indexSource.indexOf('async function processCloudPreTranscriptionRecord'),
  indexSource.indexOf('async function adminRetryCloudPreTranscription'),
);
assert.match(processCloudPreTranscriptionRecordBody, /alreadyProcessed: true/);
assert.doesNotMatch(processCloudPreTranscriptionRecordBody, /status:\s*'pending'/);
assert.doesNotMatch(processCloudPreTranscriptionRecordBody, /syncedAt:\s*''/);

const quickstartFunctionConfig = cloudbaseConfig.functions.find((item) => item.name === 'quickstartFunctions');
assert.ok(quickstartFunctionConfig);
assert.deepStrictEqual(quickstartFunctionConfig.triggers, [
  {
    name: 'cloud-transcription-queue-every-minute',
    type: 'timer',
    config: '0 */1 * * * * *',
  },
  {
    name: 'daily-ops-report-at-night',
    type: 'timer',
    config: '0 30 21 * * * *',
  },
]);

const cloudPreTranscriptionBody = indexSource.slice(
  indexSource.indexOf('async function processCloudPreTranscription'),
  indexSource.indexOf('async function createBindCode'),
);
assert.match(cloudPreTranscriptionBody, /resolveWebpageAudioUrl\(pageUrl,\s*record\)/);
assert.doesNotMatch(cloudPreTranscriptionBody, /const html = await fetchTextUrl\(pageUrl\)/);

const redeemListBody = indexSource.slice(
  indexSource.indexOf('async function adminListRedeemCodes'),
  indexSource.indexOf('async function adminListEntitlements'),
);
assert.match(redeemListBody, /readAdminCollectionSnapshot\('redeem_codes'/);
assert.match(redeemListBody, /event\.maxRead/);
assert.doesNotMatch(redeemListBody, /\.limit\(100\)/);

const entitlementStatusBody = indexSource.slice(
  indexSource.indexOf('async function getEntitlementStatus'),
  indexSource.indexOf('async function redeemAccessCode'),
);
assert.match(entitlementStatusBody, /shouldHydrateRedeemCode/);
assert.match(entitlementStatusBody, /plan === DEFAULT_REDEEM_PLAN/);
assert.match(entitlementStatusBody, /hydrateEntitlementWithRedeemCode/);
assert.match(indexSource, /async function hydrateEntitlementWithRedeemCode/);
assert.match(indexSource, /async function findRedeemCodeForOpenid/);
assert.match(indexSource, /lastRedeemedOpenId/);
assert.match(indexSource, /db\.collection\('user_entitlements'\)[\s\S]*where\(\{\s*openid/);
assert.match(indexSource, /normalizeRedeemCode\(item\.code\)/);
assert.match(indexSource, /db\.collection\('user_entitlements'\)\.doc\(entitlement\._id\)\.update/);
assert.match(indexSource, /source: isPaidEntitlement \? 'payment' : 'redeem_code'/);
assert.match(indexSource, /trialOwnerOpenid/);
assert.match(indexSource, /paidOwnerOpenid/);
assert.match(indexSource, /_sourceCollection: 'redeem_codes'/);
assert.match(indexSource, /_sourceCollection: 'user_entitlements'/);
assert.match(indexSource, /delete existingCodeDoc\._sourceCollection/);
assert.match(indexSource, /const repaired = await ensurePaidRedeemCodeForPayment/);

const createInboxRecordBody = indexSource.slice(
  indexSource.indexOf('async function createInboxRecord'),
  indexSource.indexOf('async function getOwnedInboxRecord'),
);
assert.match(createInboxRecordBody, /requiresProTranscriptionAccess\(data\)/);
assert.match(createInboxRecordBody, /errCode: 'PRO_REQUIRED'/);
assert.ok(
  createInboxRecordBody.indexOf('requiresProTranscriptionAccess(data)') < createInboxRecordBody.indexOf('consumeDailyQuota'),
  'Pro-only transcription should be rejected before consuming free quota',
);
