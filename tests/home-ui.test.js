const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.wxss'), 'utf8');
const js = fs.readFileSync(path.join(root, 'miniprogram/pages/index/index.js'), 'utf8');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
const appJs = fs.readFileSync(path.join(root, 'miniprogram/app.js'), 'utf8');

assert.match(wxml, /class="bind-guide-button"/);
assert.match(wxml, /class="bind-home-button"/);
assert.doesNotMatch(wxml, /class="bind-navbar"/);
assert.doesNotMatch(wxml, /class="back-button"/);
assert.doesNotMatch(wxml, /class="bind-nav-title"/);
assert.doesNotMatch(wxss, /\.bind-navbar/);
assert.doesNotMatch(wxss, /\.back-button/);
assert.doesNotMatch(wxss, /\.bind-nav-title/);
assert.match(wxml, /\{\{isBound \? '已完成绑定' : '未绑定本地 Vault'\}\}/);
assert.match(wxml, /一个绑定码默认绑定 1 台电脑/);
assert.doesNotMatch(wxml, /10 分钟内有效/);
assert.match(wxml, /class="bind-rule-tip"/);
assert.match(wxml, /\{\{displayBindCode\}\}/);
assert.match(wxml, /bindtap="toggleBindCodeVisibility"/);
assert.match(wxml, /bindtap="replaceCode"/);
assert.match(wxml, /class="bind-device-panel"/);
assert.match(wxml, /bindtap="increaseBindDeviceLimit"/);
assert.match(wxml, /查看绑定码/);
assert.match(wxml, /更换绑定码/);
assert.match(wxml, /bindtap="readClipboard"/);
assert.match(wxml, /bindtap="saveWebpageFromClipboardOrInput"/);
assert.match(wxml, /bindtap="toggleRecording"/);
assert.match(wxml, /bindtap="chooseInboxFile"/);
assert.match(wxml, />读取网页链接</);
assert.match(wxml, /'录音'/);
assert.doesNotMatch(wxml, /录音\/音频/);
assert.match(wxml, />文件\/音频</);
assert.doesNotMatch(wxml, /bindtap="showUploadSheet"/);
assert.doesNotMatch(js, /showUploadSheet\(\)/);
assert.doesNotMatch(js, /showVoiceSheet\(\)/);
assert.doesNotMatch(js, /itemList: \['开始录音', '上传音频'\]/);
assert.doesNotMatch(js, /itemList: \['上传网页链接', '上传文件'\]/);
assert.match(wxml, /class="notice-bar" bindtap="showAnnouncementDetail"/);
assert.doesNotMatch(wxml, /class="notice-scroll"/);
assert.doesNotMatch(wxml, /\{\{announcementText\}\}/);
assert.doesNotMatch(wxml, /查看详情/);
assert.match(wxml, /WeChat Inbox Sync/);
assert.match(wxml, /插件名字：WeChat Inbox Sync/);
assert.match(wxml, /安装位置：Obsidian 插件市场/);
assert.match(wxml, /最新插件版本：v1\.1\.0（6月3日更新）/);
assert.doesNotMatch(wxml, /插件更新公告 · WeChat Inbox Sync/);
assert.match(wxss, /\.notice-plugin-meta/);
assert.match(wxss, /\.notice-plugin-line/);
assert.doesNotMatch(wxss, /\.notice-detail-link/);
assert.doesNotMatch(wxss, /\.notice-scroll/);
assert.doesNotMatch(wxss, /\.notice-text/);
assert.doesNotMatch(wxml, /<button class="notice-bar" bindtap="copyTutorialLink">/);
assert.doesNotMatch(wxml, /<button class="secondary-action-button" bindtap="copyTutorialLink">/);
assert.doesNotMatch(wxml, /bindtap="showFeedbackModal"/);
assert.doesNotMatch(wxml, /feedback-mask/);
assert.doesNotMatch(wxml, /open-type="contact"/);
assert.match(wxml, /<view class="notice-bar" bindtap="showAnnouncementDetail">/);
assert.match(wxml, /class="bind-guide-button" bindtap="showTutorialModal"/);
assert.match(wxml, /class="primary-actions"/);
assert.match(wxml, /class="[^"]*share-button[^"]*" open-type="share"/);
assert.match(wxml, /class="share-button-text"/);
assert.match(wxml, /wx:if="\{\{tutorialVisible\}\}"/);
assert.match(wxml, /class="tutorial-link-text"/);
assert.match(wxml, /bindtap="copyTutorialLinkFromModal"/);
assert.match(wxss, /\.bind-guide-button/);
assert.match(wxss, /\.bind-home-button/);
assert.match(wxss, /\.primary-actions/);
assert.match(wxss, /\.share-button/);
assert.match(wxss, /\.share-button\s*\{[\s\S]*flex: 0 0 176rpx/);
assert.match(wxss, /\.share-button-text/);
assert.match(wxss, /\.capture-actions/);
assert.match(wxss, /\.capture-action-button/);
assert.match(wxss, /\.action-bar\s*\{[\s\S]*flex-direction: column/);
assert.match(wxss, /\.action-bar\s*\{[\s\S]*gap: 28rpx/);
assert.match(wxss, /\.capture-actions\s*\{[\s\S]*width: 496rpx/);
assert.match(wxss, /\.capture-actions\s*\{[\s\S]*margin: 0 auto/);
assert.match(wxss, /\.capture-actions\s*\{[\s\S]*display: flex/);
assert.match(wxss, /\.capture-actions\s*\{[\s\S]*flex-wrap: wrap/);
assert.match(wxss, /\.capture-actions\s*\{[\s\S]*justify-content: space-between/);
assert.match(wxss, /\.capture-action-button\s*\{[\s\S]*box-sizing: border-box/);
assert.match(wxss, /\.capture-action-button\s*\{[\s\S]*flex: 0 0 208rpx/);
assert.match(wxss, /\.capture-action-button\s*\{[\s\S]*width: 208rpx/);
assert.match(wxss, /\.capture-actions \.capture-action-button\s*\{[\s\S]*border: 1rpx solid rgba\(111, 123, 89, 0\.14\)/);
assert.match(wxss, /\.capture-actions \.capture-action-button\s*\{[\s\S]*box-shadow: 0 6rpx 16rpx rgba\(29, 29, 27, 0\.06\)/);
assert.match(wxss, /\.capture-actions \.capture-action-button:nth-child\(-n \+ 2\)\s*\{[\s\S]*margin-bottom: 22rpx/);
assert.match(wxss, /\.save-button\s*\{[\s\S]*align-self: flex-end/);
assert.match(wxss, /\.save-button\s*\{[\s\S]*height: 72rpx/);
assert.match(wxss, /\.bind-rule-tip/);
assert.match(wxss, /\.bind-device-panel/);
assert.match(wxss, /\.add-bind-device-button/);
assert.match(wxss, /\.add-bind-device-button\s*\{[\s\S]*display: flex/);
assert.match(wxss, /\.add-bind-device-button\s*\{[\s\S]*align-items: center/);
assert.match(wxss, /\.add-bind-device-button\s*\{[\s\S]*justify-content: center/);
assert.match(wxss, /\.tutorial-panel/);
assert.match(js, /wx\.showShareMenu/);
assert.match(js, /REWARDED_AD_UNIT_ID/);
assert.match(js, /quotaUnlockPending: false/);
assert.match(js, /quotaUnlockVisible: false/);
assert.match(js, /showQuotaUnlockSheet/);
assert.match(wxml, /分享解锁到10次/);
assert.match(wxml, /看广告再加10次/);
assert.match(js, /unlockDailyUsageByShare/);
assert.match(js, /unlockDailyUsageByAd/);
assert.match(wxml, /wx:if="\{\{quotaUnlockVisible\}\}"/);
assert.match(wxml, /open-type="share"[\s\S]*分享解锁到10次/);
assert.match(wxml, /bindtap="showRewardedAdForQuota"[\s\S]*看广告再加10次/);
assert.doesNotMatch(js, /请点击右下角分享给朋友/);
assert.doesNotMatch(js, /wx\.showActionSheet\(\{[\s\S]*分享解锁到10次/);
assert.match(js, /MAX_RECORDER_DURATION_MS\s*=\s*600000/);
assert.match(js, /duration:\s*MAX_RECORDER_DURATION_MS/);
assert.match(js, /extractHttpUrl/);
assert.doesNotMatch(js, /function isHttpUrl/);
assert.match(js, /MAX_CHAT_UPLOAD_COUNT\s*=\s*10/);
assert.match(js, /AUDIO_FILE_EXTENSIONS\s*=\s*\[[\s\S]*'amr'[\s\S]*\]/);
assert.match(js, /DOCUMENT_FILE_EXTENSIONS\s*=\s*\[[\s\S]*'pdf'[\s\S]*'docx'[\s\S]*\]/);
assert.match(js, /SUPPORTED_CHAT_UPLOAD_EXTENSIONS\s*=\s*\[\.\.\.DOCUMENT_FILE_EXTENSIONS,\s*\.\.\.AUDIO_FILE_EXTENSIONS\]/);
assert.match(js, /count:\s*MAX_CHAT_UPLOAD_COUNT/);
assert.match(js, /extension:\s*SUPPORTED_CHAT_UPLOAD_EXTENSIONS/);
assert.match(js, /saveInboxFiles\(files\)/);
assert.match(js, /saveOneInboxFile\(file\)/);
assert.match(js, /isAudioInboxFile\(file\)/);
assert.match(js, /buildVoicePayload\(upload\.fileID,\s*0,\s*file\.name\s*\|\|\s*''\)/);
assert.match(js, /shareAppMessage/);
assert.match(js, /shareTimeline/);
assert.match(js, /onShareAppMessage\(\)/);
assert.match(js, /onShareTimeline\(\)/);
assert.match(js, /isBound: false/);
assert.match(js, /bindCode: ''/);
assert.match(js, /bindCodeVisible: false/);
assert.match(js, /displayBindCode: '######'/);
assert.match(js, /toggleBindCodeVisibility/);
assert.match(js, /replaceCode/);
assert.match(js, /replaceBindCode/);
assert.match(js, /bindClients: \[\]/);
assert.match(js, /increaseBindDeviceLimit/);
assert.match(js, /requestIncreaseBindDeviceLimit/);
assert.doesNotMatch(js, /bindCode: 'X9A-4KF'/);
assert.doesNotMatch(js, /generateBindCode\(\)/);
assert.match(js, /onShow\(\)/);
assert.match(js, /requestBindStatus/);
assert.match(js, /startBindStatusPolling/);
assert.match(js, /showStatus\(text, options = \{\}\)/);
assert.match(js, /options\.persist/);
assert.match(js, /showStatus\('[^']+', \{ persist: true \}\)/);
assert.match(js, /getErrorMessage/);
assert.match(js, /showAnnouncementDetail\(\)/);
assert.match(js, /wx\.showModal\(\{[\s\S]*title: '插件更新公告'[\s\S]*confirmText: '知道了'/);
assert.match(js, /文件保存失败：/);
assert.deepStrictEqual(appJson.supportedMaterials, [
  {
    materialType: 'text/html',
    name: '用${nickname}保存',
    desc: '保存公众号文章到 Obsidian 收集箱',
    path: 'pages/index/index',
  },
  {
    materialType: 'application/pdf',
    name: '用${nickname}保存',
    desc: '保存 PDF 到 Obsidian 收集箱',
    path: 'pages/index/index',
  },
  {
    materialType: 'application/msword',
    name: '用${nickname}保存',
    desc: '保存 Word 到 Obsidian 收集箱',
    path: 'pages/index/index',
  },
  {
    materialType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    name: '用${nickname}保存',
    desc: '保存 Word 到 Obsidian 收集箱',
    path: 'pages/index/index',
  },
  {
    materialType: 'text/plain',
    name: '用${nickname}保存',
    desc: '保存文本文件到 Obsidian 收集箱',
    path: 'pages/index/index',
  },
]);
assert.match(appJs, /forwardMaterials/);
assert.match(appJs, /scene\s*===\s*1173/);
assert.match(appJs, /consumeForwardMaterials/);
assert.match(js, /handleForwardMaterials/);
assert.match(js, /getForwardMaterialFile/);
assert.match(js, /saveInboxFiles\(\[file\]\)/);
assert.match(js, /consumeForwardMaterials/);
assert.match(js, /saveWebpageUrl\(url, sourceText\)/);
