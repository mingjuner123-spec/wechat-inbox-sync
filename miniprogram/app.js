// app.js
const { WECHAT_CLOUD_ENV, initCloud } = require('./services/cloud-env');

App({
  onLaunch(options) {
    this.globalData = {
      // Pin the production data env so DevTools' selected env cannot break sync.
      env: WECHAT_CLOUD_ENV,
      pendingForwardMaterials: [],
    };
    this.captureForwardMaterials(options);
    if (!wx.cloud) {
      console.error('Please use base library 2.2.3 or later to use cloud capability.');
    } else {
      initCloud(wx);
    }
  },

  onShow(options) {
    this.captureForwardMaterials(options);
  },

  captureForwardMaterials(options = {}) {
    const scene = Number(options.scene);
    const materials = Array.isArray(options.forwardMaterials) ? options.forwardMaterials : [];
    if (scene === 1173 && materials.length) {
      this.globalData.pendingForwardMaterials = materials;
    }
  },

  consumeForwardMaterials() {
    const materials = (this.globalData && this.globalData.pendingForwardMaterials) || [];
    if (this.globalData) {
      this.globalData.pendingForwardMaterials = [];
    }
    return materials;
  },
});
