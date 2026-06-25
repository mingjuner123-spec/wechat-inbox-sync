const WECHAT_CLOUD_ENV = 'he02-d8gebzv050ed6c4ef';

function getCloudEnvConfig() {
  return { env: WECHAT_CLOUD_ENV };
}

function initCloud(wxApi) {
  if (!wxApi || !wxApi.cloud) {
    return false;
  }
  wxApi.cloud.init({
    env: WECHAT_CLOUD_ENV,
    traceUser: true,
  });
  return true;
}

function withCloudEnv(options = {}) {
  return {
    ...options,
    config: {
      ...(options.config || {}),
      env: WECHAT_CLOUD_ENV,
    },
  };
}

function callCloudFunction(cloud, options) {
  return cloud.callFunction(withCloudEnv(options));
}

function uploadCloudFile(cloud, options) {
  return cloud.uploadFile(withCloudEnv(options));
}

module.exports = {
  WECHAT_CLOUD_ENV,
  getCloudEnvConfig,
  initCloud,
  callCloudFunction,
  uploadCloudFile,
};
