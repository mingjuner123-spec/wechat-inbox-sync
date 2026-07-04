const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const wxml = read('miniprogram/pages/index/index.wxml');
const wxss = read('miniprogram/pages/index/index.wxss');
const js = read('miniprogram/pages/index/index.js');
const inboxServiceJs = read('miniprogram/services/inbox-service.js');
const appJson = JSON.parse(read('miniprogram/app.json'));
const projectConfig = JSON.parse(read('project.config.json'));
const appJs = read('miniprogram/app.js');
const proWxml = read('miniprogram/pages/pro/index.wxml');
const proJs = read('miniprogram/pages/pro/index.js');
const helpWxml = read('miniprogram/pages/help/index.wxml');
const helpJs = read('miniprogram/pages/help/index.js');
const adminWxml = read('miniprogram/pages/admin/index.wxml');
const adminJs = read('miniprogram/pages/admin/index.js');
const homeOnLoadBody = js.slice(
  js.indexOf('  onLoad() {'),
  js.indexOf('  onShow() {', js.indexOf('  onLoad() {')),
);
const homeOnShowBody = js.slice(
  js.indexOf('  onShow() {'),
  js.indexOf('  enableShareMenu()', js.indexOf('  onShow() {')),
);

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    return [fullPath];
  });
}

const oversizedAssets = listFiles(path.join(root, 'miniprogram'))
  .filter((filePath) => /\.(png|jpe?g|gif|webp|svg|mp3|wav|m4a|aac)$/i.test(filePath))
  .map((filePath) => ({ filePath, size: fs.statSync(filePath).size }))
  .filter((item) => item.size > 200 * 1024);
assert.deepStrictEqual(oversizedAssets, []);

assert.deepStrictEqual(appJson.pages.slice(0, 3), [
  'pages/index/index',
  'pages/pro/index',
  'pages/admin/index',
]);
assert.ok(appJson.pages.includes('pages/help/index'));
assert.ok(appJson.window.navigationBarTitleText.includes('Obsidian'));
assert.ok(appJson.supportedMaterials.every((item) => String(item.name || '').includes('${nickname}')));
assert.ok(projectConfig.packOptions.ignore.some((item) => item.value === 'images/create_cbr.png'));
assert.ok(projectConfig.packOptions.ignore.some((item) => item.value === 'images/ai_example1.png'));

assert.match(wxml, /currentView === 'collect'/);
assert.match(wxml, /currentView === 'bind'/);
assert.match(wxml, /currentView === 'mine'/);
assert.match(wxml, /class="tabbar"/);
assert.match(wxml, /data-view="collect"/);
assert.match(wxml, /data-view="bind"/);
assert.match(wxml, /data-view="mine"/);
assert.match(wxml, /bindtap="showAnnouncementDetail"/);
assert.match(wxml, /class="usage-status/);
assert.match(wxml, /\{\{usageStatusText\}\}/);
assert.match(wxml, /wx:if="\{\{uploadProgressVisible\}\}"/);
assert.match(wxml, /class="platform-compact-strip"/);
assert.match(wxml, /class="platform-compact-node free"/);
assert.match(wxml, /class="platform-compact-node pro"/);
assert.doesNotMatch(wxml, /channels-video\.svg/);
assert.doesNotMatch(wxml, /视频号/);
assert.doesNotMatch(wxml, /class="platform-support-groups"/);
assert.match(wxml, /class="benefit-table"/);
assert.match(wxml, /class="benefit-table-header"/);
assert.match(wxml, /class="benefit-table-row"/);
assert.doesNotMatch(wxml, /class="home-ad-slot"/);
assert.match(wxml, /wx:if="\{\{showAdEntry\}\}" class="quota-ad-button"/);
assert.match(js, /showAdEntry: false/);
assert.match(js, /dailyUsageLoaded: false/);
assert.match(js, /dailyUsageLoaded: true/);
assert.match(js, /showAdEntry: shouldShowAdEntry\(entitlementStatus, this\.data\.dailyUsage, this\.data\.dailyUsageLoaded\)/);
assert.match(wxml, /bindtap="claimTrialRedeemCode"/);
assert.match(wxml, /bindtap="navigateToPro"/);
assert.match(wxml, /wx:if="\{\{showTrialClaim\}\}"/);
assert.match(wxml, /wx:if="\{\{showMembershipExpiry && !showRedeemCode\}\}"/);
assert.doesNotMatch(wxml, /bindtap="copyFormalMembershipWechat"/);
assert.match(wxml, /\{\{trialRedeemCode\}\}/);
assert.match(wxml, /bindtap="copyCurrentRedeemCode"/);
assert.match(wxml, /data-note="OB .*" bindtap="copyWechatWithNote"/);
assert.match(wxml, /bindtap="readClipboard"/);
assert.match(wxml, /bindtap="saveWebpageFromClipboardOrInput"/);
assert.match(wxml, /bindtap="toggleRecording"/);
assert.match(wxml, /bindtap="showImportMaterialSheet"/);
assert.match(wxml, /class="home-capability-strip"/);
assert.match(wxml, /5次\/天/);
assert.match(wxml, /本地图文文件（PDF、Word 等）/);
assert.match(wxml, /无限次/);
assert.match(wxml, /本地音视频文件（MP3、MP4）/);
assert.match(wxml, /小红书评论区提取/);
assert.match(wxml, /关键词与简介属性生成/);
assert.match(wxss, /\.home-capability-text/);
assert.match(wxml, /open-type="share"/);
assert.match(wxml, /bindtap="toggleBindCodeVisibility"/);
assert.match(wxml, /bindtap="replaceCode"/);
assert.match(wxml, /class="bind-device-panel white"/);
assert.match(wxml, /bindtap="increaseBindDeviceLimit"/);
assert.match(wxml, /bindtap="confirmUnbindClient"/);
assert.match(wxml, /bindtap="showTutorialModal"/);
assert.match(wxml, /images\/tutorials\/pro-install-local-asr\.png/);
assert.match(wxml, /images\/tutorials\/pro-update-plugin\.png/);
assert.match(wxml, /wx:if="\{\{announcementVisible\}\}"/);
assert.match(wxml, /class="announcement-sheet"/);

assert.match(wxss, /\.tabbar/);
assert.match(wxss, /\.benefit-table/);
assert.match(wxss, /\.benefit-table-row/);
assert.doesNotMatch(wxss, /\.home-ad-slot/);
assert.match(wxss, /\.quota-ad-button/);
assert.match(wxss, /\.announcement-sheet/);
assert.match(wxss, /\.view-mine/);
assert.match(wxss, /\.usage-status/);
assert.match(wxss, /\.upload-progress-card/);

assert.match(js, /DEFAULT_PLUGIN_VERSION = '1\.3\.0'/);
assert.match(js, /ANNOUNCEMENT_VERSION = '2026-07-05-plugin-130-feishu-fix'/);
assert.match(js, /DEFAULT_PLUGIN_UPDATED_AT = '2026-07-05 07:13'/);
assert.match(js, /pluginVersion: useRemoteAnnouncement \? \(config\.pluginVersion \|\| DEFAULT_PLUGIN_VERSION\) : DEFAULT_PLUGIN_VERSION/);
assert.match(js, /pluginUpdatedAt: useRemoteAnnouncement \? \(config\.updatedAt \|\| DEFAULT_PLUGIN_UPDATED_AT\) : DEFAULT_PLUGIN_UPDATED_AT/);
assert.match(js, /usageStatusText: buildUsageStatusText/);
assert.match(js, /loadDailyUsageStatus/);
assert.match(homeOnShowBody, /this\.data\.entitlementStatusLoaded/);
assert.match(homeOnShowBody, /this\.loadEntitlementStatus\(\)/);
assert.match(js, /showQuotaUnlockSheet\(\)\s*\{\s*if \(!this\.data\.showAdEntry\)/s);
assert.match(js, /showRewardedAdForQuota\(\)\s*\{\s*if \(!this\.data\.showAdEntry\)/s);
assert.doesNotMatch(homeOnLoadBody, /setupRewardedVideoAd\(\)/);
assert.match(js, /showRewardedAdForQuota\(\)[\s\S]*?this\.setupRewardedVideoAd\(\)/);
assert.match(js, /navigateToPro\(\)/);
assert.match(js, /url: '\/pages\/pro\/index'/);
assert.doesNotMatch(js, /copyFormalMembershipWechat/);
assert.match(js, /copyCurrentRedeemCode/);
assert.match(js, /switchMainTab/);
assert.match(js, /showCollectView/);
assert.match(js, /showMineView/);
assert.match(js, /copyWechatWithNote/);
assert.match(js, /buildMembershipCard/);
assert.match(js, /membershipCard: buildMembershipCard/);
assert.match(js, /REWARDED_AD_UNIT_ID/);
assert.match(js, /quotaUnlockPending: false/);
assert.match(js, /quotaUnlockVisible: false/);
assert.match(js, /unlockDailyUsageByShare/);
assert.match(js, /unlockDailyUsageByAd/);

assert.match(proWxml, /bindtap="claimTrialRedeemCode"/);
assert.match(proWxml, /bindtap="copyTrialRedeemCode"/);
assert.match(proWxml, /showMembershipExpiry && !showRedeemCode/);
assert.match(proWxml, /showTrialClaim/);
assert.match(proWxml, /showRedeemCode/);
assert.match(proWxml, /bindtap="createFormalPaymentOrder"/);
assert.match(proWxml, /class="payment-plan/);
assert.match(proWxml, /selectedPaymentPlanId === item\.id/);
assert.match(proWxml, /latestPaymentOrder/);
assert.doesNotMatch(proWxml, /class="benefit-table"/);
assert.doesNotMatch(proWxml, /class="benefit-table-header"/);
assert.doesNotMatch(proWxml, /class="benefit-table-row"/);
assert.doesNotMatch(proWxml, /images\/tutorials\/pro-install-local-asr\.png/);
assert.doesNotMatch(proWxml, /images\/tutorials\/pro-update-plugin\.png/);
assert.doesNotMatch(proWxml, /bindtap="copyProTutorialLink"/);
assert.doesNotMatch(proWxml, /bindtap="copyUserGroupWechat"/);
assert.doesNotMatch(proWxml, /heyhmjx|\{\{contactWechat\}\}/);

assert.match(proJs, /wx\.login/);
assert.match(proJs, /requestVirtualPayment/);
assert.match(proJs, /createPaymentOrder/);
assert.match(proJs, /createFormalPaymentOrder/);
assert.match(proJs, /支付配置未生效/);
assert.doesNotMatch(proJs, /订单已生成/);
assert.match(proJs, /loginCode/);
assert.match(proJs, /pro_month/);
assert.match(proJs, /pro_year/);
assert.match(proJs, /9\.9/);
assert.match(proJs, /49\.9/);
assert.match(proJs, /19\.9/);
assert.match(proJs, /68/);
assert.match(proJs, /7 月 10 日后恢复 19\.9 元\/月/);
assert.match(proJs, /7 月 10 日后恢复 68 元\/年/);
assert.match(proWxml, /price-reset-tip/);
assert.match(proWxml, /早鸟价截止到 7 月 10 日/);
assert.match(proJs, /selectedPaymentPlanId/);
assert.match(proJs, /claimTrialRedeemCode/);
assert.match(proJs, /copyTrialRedeemCode/);
assert.doesNotMatch(proJs, /copyProTutorialLink/);
assert.doesNotMatch(proJs, /copyUserGroupWechat/);
assert.doesNotMatch(proJs, /CONTACT_WECHAT = 'heyhmjx'/);
assert.doesNotMatch(proJs, /Lm5kw8QXdiQE96kaDUYcnIsVnAd/);
assert.match(proJs, /FUNCTIONS_TIME_LIMIT_EXCEEDED/);
assert.match(proJs, /getEntitlementStatus/);
assert.match(proJs, /formatCloudMinutes/);
assert.match(proJs, /buildCloudQuota/);
assert.match(proJs, /refreshEntitlementStatus/);
assert.match(proJs, /expiresLabel/);
assert.match(proJs, /续费 Pro/);

assert.match(inboxServiceJs, /function createPaymentOrder\(planId, loginCode\)/);
assert.match(inboxServiceJs, /type: 'createPaymentOrder'/);
assert.match(inboxServiceJs, /loginCode/);
assert.match(inboxServiceJs, /function queryPaymentOrder\(orderNo\)/);
assert.match(inboxServiceJs, /type: 'queryPaymentOrder'/);
assert.match(inboxServiceJs, /function adminListPaymentOrders\(payload\)/);
assert.match(inboxServiceJs, /type: 'adminListPaymentOrders'/);

assert.match(adminJs, /paymentOrders: \[\]/);
assert.match(adminJs, /loadPaymentOrders/);
assert.match(adminJs, /adminListPaymentOrders/);
assert.match(adminJs, /paidAtText: formatDateTime\(item\.paidAt\)/);
assert.match(adminWxml, /支付订单列表/);
assert.match(adminWxml, /wx:for="\{\{paymentOrders\}\}"/);
assert.match(adminWxml, /paymentNotifyStatus/);

assert.match(helpWxml, /bindtap="copyTutorialLink"/);
assert.match(helpWxml, /bindtap="copyWechat"/);
assert.match(helpJs, /copyTutorialLink/);
assert.match(helpJs, /copyWechat/);
assert.match(helpJs, /CONTACT_WECHAT = 'heyhmjx'/);
assert.match(helpJs, /Lm5kw8QXdiQE96kaDUYcnIsVnAd/);
assert.match(appJs, /App\(/);
