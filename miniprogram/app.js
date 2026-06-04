// app.js
App({
  onLaunch: function (options) {
    this.globalData = {
      // 可在这里填入云开发环境 ID；留空时使用微信开发者工具当前默认环境。
      env: "he02-d8gebzv050ed6c4ef",
      pendingForwardMaterials: [],
    };
    this.captureForwardMaterials(options);
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env || undefined,
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
