const { createInboxService } = require('../../services/inbox-service');

const CONTACT_WECHAT = 'heyhmjx';

function formatDateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getRemainingDays(value) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
}

function getErrorMessage(error, fallback) {
  const message = (error && (error.errMsg || error.message)) || String(error || '');
  return message && message !== '[object Object]' ? message : fallback;
}

function buildMembership(status = {}) {
  const hasAccess = Boolean(status.hasAccess);
  const expiresAt = status.expiresAt || '';
  const daysLeft = getRemainingDays(expiresAt);
  const isTrial = String(status.plan || '').includes('trial') || String(status.source || '').includes('trial');

  if (hasAccess) {
    return {
      badge: isTrial ? 'Pro 试用中' : 'Pro 已开通',
      title: isTrial ? `试用剩余 ${daysLeft || 1} 天` : '音视频文案提取已可用',
      desc: expiresAt ? `有效期至 ${formatDateLabel(expiresAt)}` : '当前微信已开通 Pro 权限',
    };
  }

  if (status.status === 'expired') {
    return {
      badge: 'Pro 已到期',
      title: '需要重新开通 Pro',
      desc: '图文同步仍可继续使用，音视频文案提取需重新兑换。',
    };
  }

  return {
    badge: '免费版',
    title: '可领取 7 天 Pro 试用码',
    desc: '联系张张获取试用码，先试抖音、B站、小宇宙、小红书视频文案提取。',
  };
}

Page({
  data: {
    contactWechat: CONTACT_WECHAT,
    contactVisible: false,
    redeemCodeInput: '',
    isRedeeming: false,
    entitlementStatus: {
      hasAccess: false,
      plan: '',
      status: 'inactive',
      expiresAt: '',
    },
    membership: buildMembership(),
  },

  onLoad() {
    this.inboxService = createInboxService(wx);
    this.loadEntitlementStatus();
  },

  async loadEntitlementStatus() {
    try {
      const response = await this.inboxService.getEntitlementStatus('local_transcription_beta');
      if (response.result && response.result.success) {
        const entitlementStatus = response.result.data || this.data.entitlementStatus;
        this.setData({
          entitlementStatus,
          membership: buildMembership(entitlementStatus),
        });
      }
    } catch (error) {
      // 权限状态读取失败不影响页面展示。
    }
  },

  showContactModal() {
    this.setData({ contactVisible: true });
  },

  hideContactModal() {
    this.setData({ contactVisible: false });
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

  onRedeemCodeInput(event) {
    this.setData({
      redeemCodeInput: event.detail.value,
    });
  },

  async submitRedeemCode() {
    const code = String(this.data.redeemCodeInput || '').trim();
    if (!code) {
      wx.showToast({
        title: '请输入兑换码',
        icon: 'none',
      });
      return;
    }
    if (this.data.isRedeeming) return;

    this.setData({ isRedeeming: true });
    try {
      const response = await this.inboxService.redeemAccessCode(code);
      if (!response.result || !response.result.success) {
        throw new Error(response.result && response.result.errMsg ? response.result.errMsg : '兑换失败');
      }
      const entitlementStatus = response.result.data || this.data.entitlementStatus;
      this.setData({
        redeemCodeInput: '',
        entitlementStatus,
        membership: buildMembership(entitlementStatus),
      });
      wx.showToast({
        title: '兑换成功',
        icon: 'none',
      });
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, '兑换失败，请检查兑换码'),
        icon: 'none',
      });
    } finally {
      this.setData({ isRedeeming: false });
    }
  },

  noop() {},
});
