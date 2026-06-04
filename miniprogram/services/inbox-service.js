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

  function getEntitlementStatus(plan) {
    return callInboxFunction({
      type: 'getEntitlementStatus',
      plan,
    });
  }

  function redeemAccessCode(code) {
    return callInboxFunction({
      type: 'redeemAccessCode',
      code,
    });
  }

  function submitFeedback(payload) {
    return callInboxFunction({
      type: 'submitFeedback',
      ...payload,
    });
  }

  function uploadVoiceFile(filePath) {
    const suffix = filePath && filePath.includes('.') ? filePath.slice(filePath.lastIndexOf('.')) : '.mp3';
    return cloud.uploadFile({
      cloudPath: `voices/${Date.now()}-${Math.floor(Math.random() * 1000)}${suffix}`,
      filePath,
    });
  }

  function uploadInboxFile(file) {
    const filePath = file.path || file.tempFilePath;
    const fileName = file.name || 'upload-file';
    const suffix = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    return cloud.uploadFile({
      cloudPath: `files/${Date.now()}-${Math.floor(Math.random() * 1000)}${suffix}`,
      filePath,
    });
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
    submitFeedback,
    uploadInboxFile,
    uploadVoiceFile,
  };
}

module.exports = {
  createInboxService,
};
