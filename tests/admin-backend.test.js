const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'cloudfunctions/quickstartFunctions/index.js'), 'utf8');
const cloudbaseConfig = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));

[
  'adminGenerateRedeemCodes',
  'adminListRedeemCodes',
  'adminListEntitlements',
  'adminListBindCodes',
  'adminGetDashboard',
  'adminUpdateEntitlement',
  'adminUpdateRedeemCode',
  'trackAnalyticsEvent',
  'processCloudPreTranscription',
  'processCloudTranscriptionQueue',
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
assert.match(indexSource, /DOUBAO_ASR_API_KEY/);
assert.match(indexSource, /doubaoAsrApiKeyConfigured/);
assert.match(indexSource, /doubaoAsrApiKeyLength/);
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
assert.match(entitlementStatusBody, /event && event\.includeRedeemCode/);
assert.match(entitlementStatusBody, /hydrateEntitlementWithRedeemCode/);
assert.match(indexSource, /async function hydrateEntitlementWithRedeemCode/);
assert.match(indexSource, /async function findRedeemCodeForOpenid/);
assert.match(indexSource, /lastRedeemedOpenId/);
assert.match(indexSource, /db\.collection\('user_entitlements'\)[\s\S]*where\(\{\s*openid/);
assert.match(indexSource, /normalizeRedeemCode\(item\.code\)/);
assert.match(indexSource, /db\.collection\('user_entitlements'\)\.doc\(entitlement\._id\)\.update/);
assert.match(indexSource, /source: 'redeem_code'/);

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
