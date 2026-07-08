const { createInboxService } = require('../../services/inbox-service');

const ADMIN_SECRET_STORAGE_KEY = 'ob_sync_admin_secret';

function getErrorMessage(error, fallback) {
  const message = (error && (error.errMsg || error.message)) || String(error || '');
  return message && message !== '[object Object]' ? message : fallback;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (item) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatRemainingDays(value) {
  if (value === null || value === undefined || value === '') return '-';
  const days = Number(value);
  if (!Number.isFinite(days)) return '-';
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  return `剩余 ${days} 天`;
}

function formatDeliveryStatus(item) {
  if (item && item.deliveryStatusText) return item.deliveryStatusText;
  if (isRedeemCodeAssigned(item)) return '已激活';
  return item && item.deliveryStatus === 'sent' ? '已发放未激活' : '未发放';
}

function isRedeemCodeAssigned(item) {
  if (!item) return false;
  if ((Number(item.redeemedCount) || 0) > 0) return true;
  const deliveryStatus = String(item.deliveryStatus || '').trim().toLowerCase();
  const status = String(item.status || '').trim().toLowerCase();
  return deliveryStatus === 'activated'
    || status === 'redeemed'
    || Boolean(item.lastRedeemedOpenId || item.redeemedOpenId)
    || Boolean(item.paidOwnerOpenid || item.trialOwnerOpenid)
    || Boolean(item.paymentOrderNo || item.latestPaymentOrderNo);
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function normalizeList(items = []) {
  return items.map((item) => ({
    ...item,
    createdAtText: formatDateTime(item.createdAt),
    updatedAtText: formatDateTime(item.updatedAt),
    paidAtText: formatDateTime(item.paidAt),
    redeemedAtText: formatDateTime(item.redeemedAt),
    expiresAtText: formatDateTime(item.expiresAt),
    lastRedeemedAtText: formatDateTime(item.lastRedeemedAt),
    remainingDaysText: formatRemainingDays(item.remainingDays),
    deliveredAtText: formatDateTime(item.deliveredAt),
    deliveryStatusText: formatDeliveryStatus(item),
  }));
}

function normalizeDashboard(data = {}) {
  const health = data.health || {};
  const pro = data.pro || {};
  const scope = data.scope || {};
  const funnel = data.funnel || {};
  return {
    generatedAtText: formatDateTime(data.generatedAt),
    scope,
    cards: data.cards || [],
    issues: data.issues || [],
    diagnoses: data.diagnoses || [],
    funnel: {
      ...funnel,
      steps: funnel.steps || [],
    },
    health: {
      ...health,
      typeBreakdown: health.typeBreakdown || [],
      storageHoldingText: formatBytes(health.storageHoldingBytes),
    },
    pro,
  };
}

Page({
  data: {
    adminSecret: '',
    keyword: '',
    count: '10',
    durationDays: '30',
    maxRedemptions: '1',
    prefix: 'OBPRO',
    note: 'Pro内测兑换码',
    extendDays: '30',
    isLoading: false,
    redeemCodes: [],
    entitlements: [],
    paymentOrders: [],
    bindCodes: [],
    dashboard: normalizeDashboard(),
    generatedCodes: [],
    generatedPlainText: '',
  },

  onLoad() {
    this.inboxService = createInboxService(wx);
    const adminSecret = wx.getStorageSync(ADMIN_SECRET_STORAGE_KEY) || '';
    this.setData({ adminSecret });
    if (adminSecret) {
      this.refreshAll();
    }
  },

  onAdminSecretInput(event) {
    this.setData({ adminSecret: event.detail.value });
  },

  saveAdminSecret() {
    wx.setStorageSync(ADMIN_SECRET_STORAGE_KEY, this.data.adminSecret);
    wx.showToast({ title: '管理密钥已保存', icon: 'none' });
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onFormInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: event.detail.value });
  },

  getAdminPayload(extra = {}) {
    return {
      adminSecret: String(this.data.adminSecret || '').trim(),
      ...extra,
    };
  },

  async runAdminAction(action, fallback) {
    const adminSecret = String(this.data.adminSecret || '').trim();
    if (!adminSecret) {
      wx.showToast({ title: '先输入管理密钥', icon: 'none' });
      return null;
    }
    this.setData({ isLoading: true });
    try {
      return await action();
    } catch (error) {
      wx.showToast({ title: getErrorMessage(error, fallback), icon: 'none' });
      return null;
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async refreshAll() {
    await this.loadDashboard();
    await this.loadPaymentOrders();
    await this.loadRedeemCodes();
    await this.loadEntitlements();
    await this.loadBindCodes();
  },

  async loadDashboard() {
    const response = await this.runAdminAction(() => this.inboxService.adminGetDashboard(this.getAdminPayload({
      maxRead: 5000,
    })), '读取工作台失败');
    if (!response || !response.result || !response.result.success) return;
    this.setData({
      dashboard: normalizeDashboard((response.result.data) || {}),
    });
  },

  async generateCodes() {
    const response = await this.runAdminAction(() => this.inboxService.adminGenerateRedeemCodes(this.getAdminPayload({
      count: Number(this.data.count),
      durationDays: Number(this.data.durationDays),
      maxRedemptions: Number(this.data.maxRedemptions),
      prefix: this.data.prefix,
      note: this.data.note,
    })), '生成失败');
    if (!response || !response.result || !response.result.success) return;
    const data = response.result.data || {};
    this.setData({
      generatedCodes: data.codes || [],
      generatedPlainText: data.plainText || '',
    });
    wx.showToast({ title: '兑换码已生成', icon: 'none' });
    await this.loadRedeemCodes();
  },

  copyGeneratedCodes() {
    if (!this.data.generatedPlainText) {
      wx.showToast({ title: '暂无可复制兑换码', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: this.data.generatedPlainText,
      success: () => wx.showToast({ title: '兑换码已复制', icon: 'none' }),
    });
  },

  async loadRedeemCodes() {
    const response = await this.runAdminAction(() => this.inboxService.adminListRedeemCodes(this.getAdminPayload({
      keyword: this.data.keyword,
      limit: 50,
    })), '读取兑换码失败');
    if (!response || !response.result || !response.result.success) return;
    this.setData({
      redeemCodes: normalizeList((response.result.data && response.result.data.items) || []),
    });
  },

  async loadPaymentOrders() {
    const response = await this.runAdminAction(() => this.inboxService.adminListPaymentOrders(this.getAdminPayload({
      keyword: this.data.keyword,
      limit: 50,
    })), '读取支付订单失败');
    if (!response || !response.result || !response.result.success) return;
    this.setData({
      paymentOrders: normalizeList((response.result.data && response.result.data.items) || []),
    });
  },

  async loadEntitlements() {
    const response = await this.runAdminAction(() => this.inboxService.adminListEntitlements(this.getAdminPayload({
      keyword: this.data.keyword,
      limit: 50,
    })), '读取 Pro 用户失败');
    if (!response || !response.result || !response.result.success) return;
    this.setData({
      entitlements: normalizeList((response.result.data && response.result.data.items) || []),
    });
  },

  async loadBindCodes() {
    const response = await this.runAdminAction(() => this.inboxService.adminListBindCodes(this.getAdminPayload({
      keyword: this.data.keyword,
      limit: 50,
    })), '读取绑定码失败');
    if (!response || !response.result || !response.result.success) return;
    this.setData({
      bindCodes: normalizeList((response.result.data && response.result.data.items) || []),
    });
  },

  async disableRedeemCode(event) {
    await this.updateRedeemCode(event, 'disable');
  },

  async activateRedeemCode(event) {
    await this.updateRedeemCode(event, 'activate');
  },

  async markRedeemCodeSent(event) {
    await this.updateRedeemCode(event, 'markSent');
  },

  async markRedeemCodeUnsent(event) {
    await this.updateRedeemCode(event, 'markUnsent');
  },

  async updateRedeemCode(event, action) {
    const codeId = event.currentTarget.dataset.id;
    const response = await this.runAdminAction(() => this.inboxService.adminUpdateRedeemCode(this.getAdminPayload({
      codeId,
      action,
    })), '更新兑换码失败');
    if (response && response.result && response.result.success) {
      wx.showToast({ title: '兑换码已更新', icon: 'none' });
      await this.loadRedeemCodes();
    }
  },

  async extendEntitlement(event) {
    const entitlementId = event.currentTarget.dataset.id;
    const response = await this.runAdminAction(() => this.inboxService.adminUpdateEntitlement(this.getAdminPayload({
      entitlementId,
      action: 'extend',
      days: Number(this.data.extendDays),
    })), '续期失败');
    if (response && response.result && response.result.success) {
      wx.showToast({ title: '已续期', icon: 'none' });
      await this.loadEntitlements();
    }
  },

  async disableEntitlement(event) {
    await this.updateEntitlementStatus(event, 'disable');
  },

  async activateEntitlement(event) {
    await this.updateEntitlementStatus(event, 'activate');
  },

  async updateEntitlementStatus(event, action) {
    const entitlementId = event.currentTarget.dataset.id;
    const response = await this.runAdminAction(() => this.inboxService.adminUpdateEntitlement(this.getAdminPayload({
      entitlementId,
      action,
    })), '更新 Pro 用户失败');
    if (response && response.result && response.result.success) {
      wx.showToast({ title: 'Pro 用户已更新', icon: 'none' });
      await this.loadEntitlements();
    }
  },
});
