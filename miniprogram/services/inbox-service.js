function createInboxService(wxApi) {
  const cloud = wxApi.cloud;

  function callInboxFunction(data) {
    return cloud.callFunction({
      name: 'quickstartFunctions',
      data,
    });
  }

  function saveRecord(payload) {
    return callInboxFunction({
      type: 'createInboxRecord',
      ...payload,
    });
  }

  function createBindCode() {
    return callInboxFunction({
      type: 'createBindCode',
    });
  }

  function replaceBindCode() {
    return callInboxFunction({
      type: 'replaceBindCode',
    });
  }

  function getBindStatus(code) {
    return callInboxFunction({
      type: 'getBindStatus',
      code,
    });
  }

  function increaseBindDeviceLimit(code) {
    return callInboxFunction({
      type: 'increaseBindDeviceLimit',
      code,
    });
  }

  function unbindBindClient(code, clientId) {
    return callInboxFunction({
      type: 'unbindBindClient',
      code,
      clientId,
    });
  }

  function getPublicConfig() {
    return callInboxFunction({
      type: 'getPublicConfig',
    });
  }

  function getDailyUsage() {
    return callInboxFunction({
      type: 'getDailyUsage',
    });
  }

  function unlockDailyUsageByShare() {
    return callInboxFunction({
      type: 'unlockDailyUsageByShare',
    });
  }

  function unlockDailyUsageByAd() {
    return callInboxFunction({
      type: 'unlockDailyUsageByAd',
    });
  }

  function getEntitlementStatus(plan, options = {}) {
    return callInboxFunction({
      type: 'getEntitlementStatus',
      plan,
      includeRedeemCode: options.includeRedeemCode !== false,
    });
  }

  function redeemAccessCode(code) {
    return callInboxFunction({
      type: 'redeemAccessCode',
      code,
    });
  }

  function getTrialRedeemCode() {
    return callInboxFunction({
      type: 'getTrialRedeemCode',
    });
  }

  function createPaymentOrder(planId, loginCode) {
    return callInboxFunction({
      type: 'createPaymentOrder',
      planId,
      loginCode,
    });
  }

  function queryPaymentOrder(orderNo) {
    return callInboxFunction({
      type: 'queryPaymentOrder',
      orderNo,
    });
  }

  function startCloudPreTranscription(recordId) {
    return callInboxFunction({
      type: 'processCloudPreTranscription',
      recordId,
    });
  }

  function submitFeedback(payload) {
    return callInboxFunction({
      type: 'submitFeedback',
      ...payload,
    });
  }

  function trackAnalyticsEvent(eventName, payload) {
    return callInboxFunction({
      type: 'trackAnalyticsEvent',
      eventName,
      payload,
    });
  }

  function adminGenerateRedeemCodes(payload) {
    return callInboxFunction({
      type: 'adminGenerateRedeemCodes',
      ...payload,
    });
  }

  function adminListRedeemCodes(payload) {
    return callInboxFunction({
      type: 'adminListRedeemCodes',
      ...payload,
    });
  }

  function adminListEntitlements(payload) {
    return callInboxFunction({
      type: 'adminListEntitlements',
      ...payload,
    });
  }

  function adminListBindCodes(payload) {
    return callInboxFunction({
      type: 'adminListBindCodes',
      ...payload,
    });
  }

  function adminGetDashboard(payload) {
    return callInboxFunction({
      type: 'adminGetDashboard',
      ...payload,
    });
  }

  function adminUpdateEntitlement(payload) {
    return callInboxFunction({
      type: 'adminUpdateEntitlement',
      ...payload,
    });
  }

  function adminUpdateRedeemCode(payload) {
    return callInboxFunction({
      type: 'adminUpdateRedeemCode',
      ...payload,
    });
  }

  function adminListPaymentOrders(payload) {
    return callInboxFunction({
      type: 'adminListPaymentOrders',
      ...payload,
    });
  }

  function adminUpdatePaymentOrder(payload) {
    return callInboxFunction({
      type: 'adminUpdatePaymentOrder',
      ...payload,
    });
  }

  function uploadWithProgress(uploadOptions, onProgress) {
    return new Promise((resolve, reject) => {
      const uploadTask = cloud.uploadFile({
        ...uploadOptions,
        success: resolve,
        fail: reject,
      });
      if (uploadTask && typeof uploadTask.onProgressUpdate === 'function' && typeof onProgress === 'function') {
        uploadTask.onProgressUpdate(onProgress);
      }
    });
  }

  function uploadVoiceFile(filePath, options = {}) {
    const suffix = filePath && filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')) : '.mp3';
    return uploadWithProgress({
      cloudPath: `voices/${Date.now()}-${Math.floor(Math.random() * 1000)}${suffix}`,
      filePath,
    }, options.onProgress);
  }

  function uploadInboxFile(file, options = {}) {
    const filePath = file.path || file.tempFilePath;
    const fileName = file.name || 'upload-file';
    const suffix = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    return uploadWithProgress({
      cloudPath: `files/${Date.now()}-${Math.floor(Math.random() * 1000)}${suffix}`,
      filePath,
    }, options.onProgress);
  }

  return {
    saveRecord,
    createBindCode,
    replaceBindCode,
    getBindStatus,
    increaseBindDeviceLimit,
    unbindBindClient,
    getPublicConfig,
    getDailyUsage,
    unlockDailyUsageByShare,
    unlockDailyUsageByAd,
    getEntitlementStatus,
    redeemAccessCode,
    getTrialRedeemCode,
    createPaymentOrder,
    queryPaymentOrder,
    startCloudPreTranscription,
    submitFeedback,
    trackAnalyticsEvent,
    adminGenerateRedeemCodes,
    adminListRedeemCodes,
    adminListEntitlements,
    adminListBindCodes,
    adminGetDashboard,
    adminUpdateEntitlement,
    adminUpdateRedeemCode,
    adminListPaymentOrders,
    adminUpdatePaymentOrder,
    uploadInboxFile,
    uploadVoiceFile,
  };
}

module.exports = {
  createInboxService,
};
