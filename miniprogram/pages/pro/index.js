const { createInboxService } = require('../../services/inbox-service');
const { buildMembershipDisplayState } = require('../../utils/membership-display');

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject,
    });
  });
}

function requestVirtualPayment(virtualPayment) {
  return new Promise((resolve, reject) => {
    if (typeof wx.requestVirtualPayment !== 'function') {
      reject(new Error('当前微信版本暂不支持虚拟支付，请升级微信后再试'));
      return;
    }
    if (typeof wx.canIUse === 'function' && !wx.canIUse('requestVirtualPayment')) {
      reject(new Error('当前微信版本暂不支持虚拟支付，请升级微信后再试'));
      return;
    }
    wx.requestVirtualPayment({
      mode: virtualPayment.mode,
      signData: virtualPayment.signData,
      paySig: virtualPayment.paySig,
      signature: virtualPayment.signature,
      success: resolve,
      fail: reject,
    });
  });
}

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
  const errCode = error && (error.errCode || error.err_code);
  const paymentMessages = {
    '-15002': '订单号已使用，请重新发起支付',
    '-15005': '支付用户签名错误，请联系客服处理',
    '-15006': '支付签名错误，请联系客服处理',
    '-15007': '微信登录态已过期，请重新支付',
    '-15010': '道具尚未发布或未生效，请稍后再试',
    '-15013': '道具价格不一致，请联系客服处理',
    '-15014': '道具发布还未生效，请稍后再试',
    '-15020': '操作太快，请稍后再试',
    '-15021': '交易过于频繁，请稍后再试',
  };
  if (errCode !== undefined && paymentMessages[String(errCode)]) {
    return paymentMessages[String(errCode)];
  }
  if (/cancel|取消/i.test(message)) {
    return '已取消支付';
  }
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
  const expiresLabel = formatDateLabel(status.expiresAt || '');

  if (hasAccess) {
    return {
      badge: isTrial ? 'Pro 体验中' : 'Pro 已开通',
      title: isTrial ? `体验剩余 ${daysLeft || 1} 天` : 'Pro 已开通',
      desc: '音视频文案提取功能已可用。',
      expiresLabel,
      paymentTitle: '续费 Pro',
      paymentButtonText: '立即续费 Pro',
    };
  }

  if (status.status === 'expired') {
    return {
      badge: 'Pro 已到期',
      title: '体验已到期',
      desc: '该兑换码已到期，请联系张张续期。',
      expiresLabel,
      paymentTitle: '开通 Pro',
      paymentButtonText: '立即开通 Pro',
    };
  }

  return {
    badge: '免费版',
    title: '领取 7 天 Pro 体验',
    desc: '',
    expiresLabel: '',
    paymentTitle: '开通 Pro',
    paymentButtonText: '立即开通 Pro',
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
    trialCodeLoading: false,
    paymentOrderLoading: false,
    selectedPaymentPlanId: 'pro_year',
    latestPaymentOrder: null,
    paymentPlans: [
      { id: 'pro_month', name: 'Pro 月卡', price: '9.9 元/月', desc: '早鸟体验价，7 月 10 日后恢复 19.9 元/月', badge: '' },
      { id: 'pro_year', name: 'Pro 年卡', price: '49.9 元/年', desc: '早鸟年卡，7 月 10 日后恢复 68 元/年', badge: '早鸟推荐' },
    ],
    trialRedeemCode: '',
    trialRedeemCodeCreatedAt: '',
    trialRedeemCodeExpiresAt: '',
    trialRedeemCodeExpiresLabel: '',
    trialRedeemCodeExpired: false,
    showTrialClaim: true,
    showRedeemCode: false,
    showMembershipExpiry: false,
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
      const login = await wxLogin();
      if (!login || !login.code) {
        throw new Error('微信登录失败，请稍后再试');
      }
      const loginCode = login.code;
      const response = await this.inboxService.createPaymentOrder(this.data.selectedPaymentPlanId, loginCode);
      if (!response.result || !response.result.success) {
        throw new Error(response.result && response.result.errMsg ? response.result.errMsg : '订单创建失败');
      }
      const order = response.result.data || {};
      this.setData({ latestPaymentOrder: order });
      if (order.paymentEnabled && order.virtualPayment) {
        await requestVirtualPayment(order.virtualPayment);
        let latestOrder = order;
        try {
          const queryResponse = await this.inboxService.queryPaymentOrder(order.orderNo);
          if (queryResponse.result && queryResponse.result.success) {
            latestOrder = queryResponse.result.data || order;
            this.setData({ latestPaymentOrder: latestOrder });
          }
        } catch (queryError) {
          // Payment already returned from WeChat; entitlement refresh can still catch up later.
        }
        const entitlementStatus = await this.loadEntitlementStatus({ silent: true, force: true });
        const expiresLabel = formatDateLabel(entitlementStatus && entitlementStatus.expiresAt);
        wx.showModal({
          title: latestOrder.status === 'paid' ? 'Pro 已开通' : '支付已提交',
          content: latestOrder.status === 'paid'
            ? `Pro 权益已生效${expiresLabel ? `，有效期至 ${expiresLabel}` : ''}，可以继续使用音视频转写等高级功能。`
            : '支付后请等待订单确认。如权益暂未刷新，请稍后点刷新或联系客服。',
          showCancel: false,
        });
        return;
      }
      wx.showModal({
        title: '支付配置未生效',
        content: order.message || `当前微信虚拟支付还没有拉起，订单号：${order.orderNo || ''}。请检查云函数环境变量并重新部署 quickstartFunctions。`,
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
    if (this.data.entitlementStatusLoading && !options.force) return this.data.entitlementStatus;
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
          ...buildMembershipDisplayState(entitlementStatus),
        });
        return entitlementStatus;
      }
      return this.data.entitlementStatus;
    } catch (error) {
      this.setData({ entitlementStatusLoaded: true });
      if (options.refreshing) {
        wx.showToast({
          title: getErrorMessage(error, '刷新失败，请稍后再试'),
          icon: 'none',
        });
      }
      return this.data.entitlementStatus;
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
        ...buildMembershipDisplayState(entitlementStatus),
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

});
