// app.js
const WECHAT_CLOUD_ENV = 'he02-d8gebzv050ed6c4ef';

App({
  onLaunch: function (options) {
    this.globalData = {
      // 固定生产数据环境，避免开发者工具当前环境切换导致 INVALID_ENV。
      env: WECHAT_CLOUD_ENV,
      pendingForwardMaterials: [],
    };
    this.captureForwardMaterials(options);
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: WECHAT_CLOUD_ENV,
        traceUser: true,
      });
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
