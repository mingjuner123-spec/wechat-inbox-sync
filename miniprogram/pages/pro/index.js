const { createInboxService } = require('../../services/inbox-service');

const CONTACT_WECHAT = 'heyhmjx';
const PRO_TUTORIAL_URL = 'https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink';

function formatDateLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isExpired(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() <= Date.now();
}

function getRemainingDays(value) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
}

function getErrorMessage(error, fallback) {
  const message = (error && (error.errMsg || error.message)) || String(error || '');
  if (/FUNCTIONS_TIME_LIMIT_EXCEEDED|timed out|timeout|cloud\.callFunction/i.test(message)) {
    return '网络繁忙，请稍后再试';
  }
  return message && message !== '[object Object]' ? message : fallback;
}

function formatCloudMinutes(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return '0 分钟';
  const minutes = Math.ceil(value / 60);
  return `${minutes} 分钟`;
}

function buildCloudQuota(status = {}) {
  const quota = Math.max(0, Number(status.cloudQuotaSeconds || 0));
  const used = Math.max(0, Number(status.cloudUsedSeconds || 0));
  const remainingValue = status.cloudRemainingSeconds !== undefined
    ? Number(status.cloudRemainingSeconds || 0)
    : Math.max(0, quota - used);
  const remaining = Math.max(0, remainingValue);
  return {
    totalText: formatCloudMinutes(quota),
    usedText: formatCloudMinutes(used),
    remainingText: formatCloudMinutes(remaining),
  };
}

function buildMembership(status = {}) {
  const hasAccess = Boolean(status.hasAccess);
  const daysLeft = getRemainingDays(status.expiresAt || '');
  const isTrial = String(status.plan || '').includes('trial') || String(status.source || '').includes('trial');

  if (hasAccess) {
    return {
      badge: isTrial ? 'Pro 体验中' : 'Pro 已开通',
      title: isTrial ? `体验剩余 ${daysLeft || 1} 天` : 'Pro 已开通',
      desc: '音视频文案提取功能已可用。',
    };
  }

  if (status.status === 'expired') {
    return {
      badge: 'Pro 已到期',
      title: '体验已到期',
      desc: '该兑换码已到期，请联系张张续期。',
    };
  }

  return {
    badge: '免费版',
    title: '领取 7 天 Pro 体验',
    desc: '',
  };
}

function buildTrialState(status = {}) {
  const code = String(status.code || '').trim();
  const expiresAt = status.expiresAt || '';
  return {
    trialRedeemCode: code,
    trialRedeemCodeExpiresAt: expiresAt,
    trialRedeemCodeExpiresLabel: formatDateLabel(expiresAt),
    trialRedeemCodeExpired: isExpired(expiresAt),
  };
}

Page({
  data: {
    contactWechat: CONTACT_WECHAT,
    proTutorialUrl: PRO_TUTORIAL_URL,
    trialCodeLoading: false,
    paymentOrderLoading: false,
    selectedPaymentPlanId: 'pro_year',
    latestPaymentOrder: null,
    paymentPlans: [
      { id: 'pro_month', name: 'Pro 月卡', price: '29 元', desc: '适合先正式体验 1 个月' },
      { id: 'pro_year', name: 'Pro 年卡', price: '199 元', desc: '适合长期使用，本地转写更划算' },
    ],
    trialRedeemCode: '',
    trialRedeemCodeCreatedAt: '',
    trialRedeemCodeExpiresAt: '',
    trialRedeemCodeExpiresLabel: '',
    trialRedeemCodeExpired: false,
    quotaRefreshing: false,
    entitlementStatusLoading: false,
    entitlementStatusLoaded: false,
    entitlementStatus: {
      hasAccess: false,
      plan: '',
      status: 'inactive',
      expiresAt: '',
      code: '',
      cloudQuotaSeconds: 0,
      cloudUsedSeconds: 0,
      cloudRemainingSeconds: 0,
    },
    cloudQuota: buildCloudQuota(),
    membership: buildMembership(),
  },

  onLoad() {
    this.inboxService = createInboxService(wx);
    this.loadEntitlementStatus();
  },

  onShow() {
    if (this.inboxService && this.data.entitlementStatusLoaded) {
      this.loadEntitlementStatus({ silent: true });
    }
  },

  selectPaymentPlan(event) {
    const planId = event.currentTarget.dataset.planId || 'pro_year';
    this.setData({ selectedPaymentPlanId: planId });
  },

  async createFormalPaymentOrder() {
    if (this.data.paymentOrderLoading) return;
    this.setData({ paymentOrderLoading: true });
    try {
      const response = await this.inboxService.createPaymentOrder(this.data.selectedPaymentPlanId);
      if (!response.result || !response.result.success) {
        throw new Error(response.result && response.result.errMsg ? response.result.errMsg : '订单创建失败');
      }
      const order = response.result.data || {};
      this.setData({ latestPaymentOrder: order });
      wx.showModal({
        title: '订单已生成',
        content: order.paymentEnabled
          ? '微信支付已准备好，请继续完成付款。'
          : `当前微信支付商户号还在配置中，订单号：${order.orderNo || ''}。你可以先联系客服人工确认。`,
        showCancel: false,
      });
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, '订单创建失败，请稍后再试'),
        icon: 'none',
      });
    } finally {
      this.setData({ paymentOrderLoading: false });
    }
  },

  async loadEntitlementStatus(options = {}) {
    if (this.data.entitlementStatusLoading) return;
    this.setData({
      entitlementStatusLoading: true,
      quotaRefreshing: Boolean(options.refreshing),
    });
    try {
      const response = await this.inboxService.getEntitlementStatus('local_transcription_beta');
      if (response.result && response.result.success) {
        const entitlementStatus = response.result.data || this.data.entitlementStatus;
        this.setData({
          entitlementStatusLoaded: true,
          entitlementStatus,
          cloudQuota: buildCloudQuota(entitlementStatus),
          membership: buildMembership(entitlementStatus),
          ...buildTrialState(entitlementStatus),
        });
      }
    } catch (error) {
      this.setData({ entitlementStatusLoaded: true });
      if (options.refreshing) {
        wx.showToast({
          title: getErrorMessage(error, '刷新失败，请稍后再试'),
          icon: 'none',
        });
      }
    } finally {
      this.setData({
        entitlementStatusLoading: false,
        quotaRefreshing: false,
      });
    }
  },

  refreshEntitlementStatus() {
    this.loadEntitlementStatus({ refreshing: true });
  },

  async claimTrialRedeemCode() {
    if (this.data.trialCodeLoading) return;
    if (this.data.trialRedeemCode && !this.data.trialRedeemCodeExpired) {
      wx.showToast({
        title: '7 天体验已开通',
        icon: 'none',
      });
      return;
    }

    this.setData({ trialCodeLoading: true });
    try {
      const response = await this.inboxService.getTrialRedeemCode();
      if (!response.result || !response.result.success) {
        throw new Error(response.result && response.result.errMsg ? response.result.errMsg : '体验开通失败');
      }
      const data = response.result.data || {};
      const entitlementStatus = {
        ...this.data.entitlementStatus,
        ...data,
      };
      this.setData({
        entitlementStatusLoaded: true,
        entitlementStatus,
        cloudQuota: buildCloudQuota(entitlementStatus),
        membership: buildMembership(entitlementStatus),
        trialRedeemCodeCreatedAt: data.createdAt || '',
        ...buildTrialState(entitlementStatus),
      });
      wx.showToast({
        title: data.alreadyActivated ? '已读取体验资格' : '7 天体验已开通',
        icon: 'none',
      });
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, '体验开通失败，请稍后再试'),
        icon: 'none',
      });
    } finally {
      this.setData({ trialCodeLoading: false });
    }
  },

  copyTrialRedeemCode() {
    const code = String(this.data.trialRedeemCode || '').trim();
    if (!code) {
      wx.showToast({
        title: '请先领取 7 天体验',
        icon: 'none',
      });
      return;
    }
    wx.setClipboardData({
      data: code,
      success: () => {
        wx.showToast({
          title: '兑换码已复制',
          icon: 'none',
        });
      },
    });
  },

  copyProTutorialLink() {
    wx.setClipboardData({
      data: PRO_TUTORIAL_URL,
      success: () => {
        wx.showToast({
          title: '教程链接已复制',
          icon: 'none',
        });
      },
    });
  },

  copyUserGroupWechat() {
    wx.setClipboardData({
      data: this.data.contactWechat || CONTACT_WECHAT,
      success: () => {
        wx.showToast({
          title: '微信已复制，备注 OB 群',
          icon: 'none',
        });
      },
    });
  },

  copyFormalMembershipWechat() {
    wx.setClipboardData({
      data: this.data.contactWechat || CONTACT_WECHAT,
      success: () => {
        wx.showToast({
          title: '微信已复制，备注开通正式会员',
          icon: 'none',
        });
      },
    });
  },
});
