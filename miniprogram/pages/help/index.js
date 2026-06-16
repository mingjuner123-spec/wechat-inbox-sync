const TUTORIAL_URL = 'https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink';
const CONTACT_WECHAT = 'heyhmjx';

Page({
  data: {
    tutorialUrl: TUTORIAL_URL,
    contactWechat: CONTACT_WECHAT,
  },

  copyTutorialLink() {
    wx.setClipboardData({
      data: this.data.tutorialUrl,
      success: () => {
        wx.showToast({
          title: '教程链接已复制',
          icon: 'none',
        });
      },
    });
  },

  copyWechat() {
    wx.setClipboardData({
      data: CONTACT_WECHAT,
      success: () => {
        wx.showToast({
          title: '微信号已复制',
          icon: 'none',
        });
      },
    });
  },
});
