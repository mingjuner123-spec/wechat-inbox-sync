const {
  classifyContent,
  createRecentItem,
  extractHttpUrl,
  buildFilePayload,
  buildTextOrLinkPayload,
  buildWebpagePayload,
  buildVoicePayload,
} = require('./inbox-utils');
const { createInboxService } = require('../../services/inbox-service');

const APP_VERSION = '0.1.0';
const DEFAULT_PLUGIN_VERSION = '1.1.5';
const DEFAULT_PLUGIN_UPDATED_AT = '2026-06-04';
const TUTORIAL_URL = 'https://my.feishu.cn/wiki/EPHhwqRobijHqfkAqjMcDEgvnlf?from=from_copylink';
const DEFAULT_ANNOUNCEMENT = '插件已可在 Obsidian 插件市场安装并自动更新，建议更换为插件市场版';
const ANNOUNCEMENT_VERSION = '2026-06-04-pro-multi-device';
const DEFAULT_UPDATE_ITEMS = [
  '新增 Pro 音视频文案提取能力',
  '新增 7 天 Pro 试用码领取入口',
  '一个绑定码最多可绑定 3 台电脑',
  '新增 macOS 本地转写组件安装支持',
  '优化抖音、B站、小宇宙、小红书识别',
];
const CONTACT_WECHAT = 'heyhmjx';
const SHARE_TITLE = 'Obsidian 内容同步助手';
const SHARE_PATH = 'pages/index/index';
const REWARDED_AD_UNIT_ID = 'adunit-d21c10ffc8e30f1d';
const MAX_RECORDER_DURATION_MS = 600000;
const MAX_CHAT_UPLOAD_COUNT = 10;
const MAX_RECENT_ITEMS = 50;
const DEFAULT_INPUT_PLACEHOLDER = '复制编辑文字，网页链接请点击读取网页链接';
const AUDIO_FILE_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'amr', 'silk', 'ogg', 'flac'];
const DOCUMENT_FILE_EXTENSIONS = ['pdf', 'md', 'markdown', 'doc', 'docx', 'txt'];
const SUPPORTED_CHAT_UPLOAD_EXTENSIONS = [...DOCUMENT_FILE_EXTENSIONS, ...AUDIO_FILE_EXTENSIONS];

function collectForwardMaterialText(value, depth = 0) {
  if (!value || depth > 3) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => collectForwardMaterialText(item, depth + 1)).filter(Boolean).join('\n');
  }
  if (typeof value !== 'object') return '';

  return [
    value.path,
    value.url,
    value.webUrl,
    value.webviewUrl,
    value.pageUrl,
    value.link,
    value.name,
    value.title,
    value.desc,
    value.description,
    value.content,
    value.text,
    collectForwardMaterialText(value.query, depth + 1),
  ].filter(Boolean).join('\n');
}

function getForwardMaterialUrl(material) {
  return extractHttpUrl(collectForwardMaterialText(material));
}

function getForwardMaterialFile(material) {
  if (!material || typeof material !== 'object') return null;
  const path = material.path || material.tempFilePath || material.filePath;
  if (!path) return null;

  const file = {
    name: material.name || material.title || path.split('/').pop() || '聊天文件',
    path,
    tempFilePath: path,
    size: material.size || 0,
    type: material.type || material.materialType || '',
  };
  const ext = getFileExtension(file);
  return DOCUMENT_FILE_EXTENSIONS.includes(ext) ? file : null;
}

function getFileExtension(file) {
  const fileName = String((file && file.name) || (file && file.path) || (file && file.tempFilePath) || '');
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

function isAudioInboxFile(file) {
  return AUDIO_FILE_EXTENSIONS.includes(getFileExtension(file));
}

function getErrorMessage(error, fallback) {
  const message = (error && (error.errMsg || error.message)) || String(error || '');
  return message && message !== '[object Object]' ? message : fallback;
}

function getRewardedAdErrorMessage(error) {
  const errCode = Number(error && error.errCode);
  const messageMap = {
    1001: '广告参数错误，请检查广告位 ID',
    1002: '广告位无效或还未生效',
    1003: '广告组件内部错误，请稍后再试',
    1004: '当前没有广告填充，请稍后再试',
    1005: '广告组件审核中或未通过',
    1006: '广告功能被关闭',
    1007: '当前账号/场景暂不能展示广告',
    1008: '广告单元已关闭',
  };
  if (messageMap[errCode]) return messageMap[errCode];
  const rawMessage = getErrorMessage(error, '');
  if (rawMessage) return rawMessage;
  return '广告暂时不可用，请稍后再试';
}

function isDevtoolsPlatform() {
  try {
    return wx.getSystemInfoSync && wx.getSystemInfoSync().platform === 'devtools';
  } catch (error) {
    return false;
  }
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

function getRemainingDays(value) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86400000));
}

function buildMembershipCard(status = {}) {
  const hasAccess = Boolean(status.hasAccess);
  const expiresAt = status.expiresAt || '';
  const daysLeft = getRemainingDays(expiresAt);
  const isTrial = String(status.plan || '').includes('trial') || String(status.source || '').includes('trial');

  if (hasAccess) {
    return {
      badge: isTrial ? 'Pro 试用中' : 'Pro 版',
      title: isTrial ? `Pro 试用剩余 ${daysLeft || 1} 天` : 'Pro 功能已开通',
      desc: expiresAt ? `有效期至 ${formatDateLabel(expiresAt)}` : '音视频文案提取功能可用',
      cta: '查看 Pro 权益',
      tone: 'pro',
    };
  }

  if (status.status === 'expired') {
    return {
      badge: 'Pro 已到期',
      title: '图文同步仍可继续使用',
      desc: '音视频文案提取需要重新开通 Pro',
      cta: '重新开通',
      tone: 'expired',
    };
  }

  return {
    badge: '免费版',
    title: '可免费领取 7 天 Pro 试用',
    desc: '免费版可同步图文链接，想试音视频文案提取可联系张张领取试用码',
    cta: '领取试用码',
    tone: 'free',
  };
}

function buildUsageStatusText(usage = {}, entitlementStatus = {}) {
  if (entitlementStatus && entitlementStatus.hasAccess) {
    return 'Pro 使用中，今日不限次数';
  }

  if (usage && usage.proUnlimited) {
    return 'Pro 使用中，今日不限次数';
  }

  const used = Number(usage && usage.used) || 0;
  const limit = Number(usage && usage.limit) || 5;
  return `今日已用 ${used}/${limit} 次，分享可解锁更多次数`;
}

function buildAnnouncementContent(items = DEFAULT_UPDATE_ITEMS) {
  return (items || DEFAULT_UPDATE_ITEMS)
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n');
}

Page({
  data: {
    currentView: 'bind',
    appVersion: APP_VERSION,
    tutorialUrl: TUTORIAL_URL,
    announcementText: DEFAULT_ANNOUNCEMENT,
    announcementVersion: ANNOUNCEMENT_VERSION,
    updateItems: DEFAULT_UPDATE_ITEMS,
    pluginVersion: DEFAULT_PLUGIN_VERSION,
    pluginUpdatedAt: DEFAULT_PLUGIN_UPDATED_AT,
    contactWechat: CONTACT_WECHAT,
    membershipCard: buildMembershipCard(),
    inputValue: '',
    inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    isRecording: false,
    isSaving: false,
    tutorialVisible: false,
    announcementVisible: false,
    statusText: '已保存，等待 Obsidian 同步',
    statusVisible: false,
    quotaUnlockPending: false,
    quotaUnlockVisible: false,
    dailyUsage: {
      used: 0,
      limit: 5,
      remaining: 5,
      shareUnlocked: false,
      adUnlockCount: 0,
    },
    usageStatusText: buildUsageStatusText(),
    redeemVisible: false,
    redeemCodeInput: '',
    isRedeeming: false,
    entitlementStatus: {
      hasAccess: false,
      plan: '',
      status: 'inactive',
      expiresAt: '',
    },
    bindCode: '',
    bindCodeVisible: false,
    displayBindCode: '######',
    isBound: false,
    bindClients: [],
    bindDeviceLimit: 1,
    bindMaxDeviceLimit: 3,
    canAddBindDevice: false,
    recentList: [
      {
        id: 'preset-link',
        type: 'LINK',
        labelClass: 'label-link',
        time: '刚刚',
        content: '微信云开发官方文档 - 快速开始',
        url: 'https://developers.weixin.qq.com/miniprogram...',
        pending: true,
      },
      {
        id: 'preset-text',
        type: 'TEXT',
        labelClass: 'label-text',
        time: '10分钟前',
        content: '关于这款产品的初步想法：不要做太重，只做单向收集。让微信的归微信，Obsidian的归Obsidian。',
        pending: false,
      },
    ],
  },

  onLoad() {
    this.inboxService = createInboxService(wx);
    this.analyticsTracked = {};
    this.trackAnalyticsOnce('app_visit');
    if (this.data.currentView === 'bind') {
      this.trackAnalyticsOnce('bind_page_view');
    }
    this.enableShareMenu();
    this.setupRecorder();
    this.setupRewardedVideoAd();
    this.loadPublicConfig();
    this.loadDailyUsageStatus();
    this.loadEntitlementStatus();
    this.requestBindCode({ switchToCollectIfBound: true });
    this.consumeForwardMaterialsFromApp();
  },

  onShow() {
    if (
      this.inboxService
      && this.data.currentView === 'bind'
      && this.data.bindCode
      && !this.data.isBound
    ) {
      this.startBindStatusPolling();
    }
    if (this.inboxService) {
      this.consumeForwardMaterialsFromApp();
    }
  },

  enableShareMenu() {
    if (!wx.showShareMenu) return;
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
    });
  },

  onShareAppMessage() {
    if (this.data.quotaUnlockPending) {
      this.unlockQuotaByShare();
    }
    return {
      title: SHARE_TITLE,
      path: SHARE_PATH,
    };
  },

  onShareTimeline() {
    if (this.data.quotaUnlockPending) {
      this.unlockQuotaByShare();
    }
    return {
      title: SHARE_TITLE,
      query: '',
    };
  },

  onUnload() {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.stopBindStatusPolling();
  },

  setupRewardedVideoAd() {
    if (!REWARDED_AD_UNIT_ID || !wx.createRewardedVideoAd) return;
    this.rewardedVideoAd = wx.createRewardedVideoAd({
      adUnitId: REWARDED_AD_UNIT_ID,
    });
    this.rewardedAdLoading = false;
    this.rewardedAdLastError = '';
    if (this.rewardedVideoAd.onLoad) {
      this.rewardedVideoAd.onLoad(() => {
        this.rewardedAdLastError = '';
      });
    }
    this.rewardedVideoAd.onClose((result) => {
      if (result && result.isEnded) {
        this.unlockQuotaByAd();
      } else {
        wx.showToast({
          title: '看完广告后才能解锁次数',
          icon: 'none',
        });
      }
    });
    this.rewardedVideoAd.onError((error) => {
      this.rewardedAdLastError = getRewardedAdErrorMessage(error);
    });
  },

  onHide() {
    this.stopBindStatusPolling();
  },

  setupRecorder() {
    if (!wx.getRecorderManager) {
      return;
    }

    this.recorderManager = wx.getRecorderManager();
    this.recorderManager.onStop((result) => {
      this.handleRecorderStop(result);
    });
    this.recorderManager.onError(() => {
      this.setData({
        isRecording: false,
        inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
      });
      wx.showToast({
        title: '录音失败，请重试',
        icon: 'none',
      });
    });
  },

  onInput(event) {
    this.setData({
      inputValue: event.detail.value,
    });
  },

  prependRecentItems(items) {
    const nextItems = Array.isArray(items) ? items : [items];
    return [...nextItems, ...this.data.recentList].slice(0, MAX_RECENT_ITEMS);
  },

  async loadPublicConfig() {
    try {
      const response = await this.inboxService.getPublicConfig();
      const config = response.result && response.result.success ? response.result.data : null;
      if (!config) return;

      const updateItems = Array.isArray(config.updateItems) && config.updateItems.length
        ? config.updateItems
        : DEFAULT_UPDATE_ITEMS;
      const announcementVersion = config.announcementVersion || ANNOUNCEMENT_VERSION;
      this.setData({
        announcementText: config.announcement || DEFAULT_ANNOUNCEMENT,
        announcementVersion,
        updateItems,
        pluginVersion: config.pluginVersion || DEFAULT_PLUGIN_VERSION,
        pluginUpdatedAt: config.updatedAt || DEFAULT_PLUGIN_UPDATED_AT,
        tutorialUrl: config.tutorialUrl || TUTORIAL_URL,
      });
      this.showLaunchAnnouncementIfNeeded({ announcementVersion, updateItems });
    } catch (error) {
      this.setData({
        announcementText: DEFAULT_ANNOUNCEMENT,
        announcementVersion: ANNOUNCEMENT_VERSION,
        updateItems: DEFAULT_UPDATE_ITEMS,
        pluginVersion: DEFAULT_PLUGIN_VERSION,
        pluginUpdatedAt: DEFAULT_PLUGIN_UPDATED_AT,
        tutorialUrl: TUTORIAL_URL,
      });
      this.showLaunchAnnouncementIfNeeded();
    }
  },

  showLaunchAnnouncementIfNeeded(options = {}) {
    const announcementVersion = options.announcementVersion || this.data.announcementVersion || ANNOUNCEMENT_VERSION;
    const updateItems = options.updateItems || this.data.updateItems || DEFAULT_UPDATE_ITEMS;
    const storageKey = `announcement_seen_${announcementVersion}`;
    try {
      if (wx.getStorageSync(storageKey)) return;
      wx.setStorageSync(storageKey, true);
    } catch (error) {
      // 本地缓存失败不影响公告展示。
    }

    this.setData({
      announcementVisible: true,
    });
  },

  showTutorialModal() {
    if (!this.data.tutorialUrl) {
      wx.showToast({
        title: '教程链接待配置',
        icon: 'none',
      });
      return;
    }

    this.setData({
      tutorialVisible: true,
    });
  },

  copyTutorialLink() {
    this.showTutorialModal();
  },

  showAnnouncementDetail() {
    this.setData({
      announcementVisible: true,
    });
  },

  hideAnnouncementSheet() {
    this.setData({
      announcementVisible: false,
    });
  },

  hideAnnouncementAndShowMine() {
    this.setData({
      announcementVisible: false,
      currentView: 'mine',
    });
  },

  hideTutorialModal() {
    this.setData({
      tutorialVisible: false,
    });
  },

  copyTutorialLinkFromModal() {
    if (!this.data.tutorialUrl) {
      wx.showToast({
        title: '教程链接待配置',
        icon: 'none',
      });
      return;
    }

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

  noop() {},

  trackAnalyticsOnce(eventName, payload = {}) {
    if (!this.inboxService || !this.inboxService.trackAnalyticsEvent || !eventName) return;
    this.analyticsTracked = this.analyticsTracked || {};
    if (this.analyticsTracked[eventName]) return;
    this.analyticsTracked[eventName] = true;
    this.inboxService.trackAnalyticsEvent(eventName, {
      view: this.data.currentView,
      appVersion: this.data.appVersion,
      ...payload,
    }).catch(() => {});
  },

  showHomeView() {
    this.showCollectView();
  },

  showCollectView() {
    this.stopBindStatusPolling();
    this.setData({
      currentView: 'collect',
    });
  },

  navigateToPro() {
    wx.navigateTo({
      url: '/pages/pro/index',
    });
  },

  navigateToHelp() {
    wx.navigateTo({
      url: '/pages/help/index',
    });
  },

  showBindView() {
    this.setData({
      currentView: 'bind',
    });
    this.trackAnalyticsOnce('bind_page_view', { source: 'showBindView' });
    this.requestBindCode();
  },

  showMineView() {
    this.stopBindStatusPolling();
    this.setData({
      currentView: 'mine',
    });
  },

  copyContactWechat() {
    this.copyWechatWithNote({
      currentTarget: {
        dataset: {
          note: 'ob用户群',
        },
      },
    });
  },

  copyWechatWithNote(event = {}) {
    const note = event.currentTarget && event.currentTarget.dataset
      ? String(event.currentTarget.dataset.note || 'ob用户群')
      : 'ob用户群';
    wx.setClipboardData({
      data: this.data.contactWechat || CONTACT_WECHAT,
      success: () => {
        wx.showToast({
          title: `微信已复制，添加备注${note}`,
          icon: 'none',
        });
      },
    });
  },

  switchMainTab(event) {
    const target = event.currentTarget && event.currentTarget.dataset
      ? String(event.currentTarget.dataset.view || '')
      : '';
    if (target === 'collect') {
      this.showCollectView();
      return;
    }
    if (target === 'bind') {
      this.showBindView();
      return;
    }
    if (target === 'mine') {
      this.showMineView();
    }
  },

  toggleRecording() {
    if (!this.recorderManager) {
      wx.showToast({
        title: '当前基础库不支持录音',
        icon: 'none',
      });
      return;
    }

    const nextRecording = !this.data.isRecording;

    if (nextRecording) {
      this.recorderManager.start({
        duration: MAX_RECORDER_DURATION_MS,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3',
      });
      this.setData({
        isRecording: true,
        inputValue: '',
        inputPlaceholder: '正在录音... 说出你的想法',
      });
      return;
    }

    this.recorderManager.stop();
  },

  getSaveErrorMessage(response, fallback) {
    const result = response && response.result ? response.result : null;
    if (result && result.errCode === 'DAILY_QUOTA_EXCEEDED') {
      this.updateDailyUsageStatus(result.data || {});
      this.showQuotaUnlockSheet(result.data || {});
      return '今日免费次数已用完';
    }
    return result && result.errMsg ? result.errMsg : fallback;
  },

  showQuotaUnlockSheet() {
    this.setData({
      quotaUnlockVisible: true,
      quotaUnlockPending: true,
    });
  },

  hideQuotaUnlockSheet() {
    this.setData({
      quotaUnlockVisible: false,
      quotaUnlockPending: false,
    });
  },

  async unlockQuotaByShare() {
    try {
      const response = await this.inboxService.unlockDailyUsageByShare();
      if (response.result && response.result.success) {
        this.updateDailyUsageStatus(response.result.data);
        this.setData({
          quotaUnlockPending: false,
          quotaUnlockVisible: false,
        });
        wx.showToast({
          title: '今日已解锁到10次',
          icon: 'none',
        });
      }
    } catch (error) {
      wx.showToast({
        title: '分享解锁失败，请稍后再试',
        icon: 'none',
      });
    }
  },

  showRewardedAdForQuota() {
    this.setData({
      quotaUnlockVisible: false,
      quotaUnlockPending: false,
    });
    if (!this.rewardedVideoAd) {
      wx.showToast({
        title: '广告位待配置，暂时不能看广告解锁',
        icon: 'none',
      });
      return;
    }
    if (this.rewardedAdLoading) return;
    this.rewardedAdLoading = true;
    wx.showLoading({
      title: '广告加载中',
      mask: true,
    });
    this.rewardedVideoAd.load()
      .then(() => this.rewardedVideoAd.show())
      .catch((error) => {
        const message = isDevtoolsPlatform()
          ? '开发者工具可能无法展示激励广告，请用真机预览测试'
          : (this.rewardedAdLastError || getRewardedAdErrorMessage(error));
        this.showStatus(`广告不可用：${message}`, { duration: 7000 });
        wx.showToast({
          title: message,
          icon: 'none',
        });
      })
      .finally(() => {
        this.rewardedAdLoading = false;
        wx.hideLoading();
      });
  },

  async unlockQuotaByAd() {
    try {
      const response = await this.inboxService.unlockDailyUsageByAd();
      if (response.result && response.result.success) {
        this.updateDailyUsageStatus(response.result.data);
        wx.showToast({
          title: '已增加10次同步次数',
          icon: 'none',
        });
      }
    } catch (error) {
      wx.showToast({
        title: '广告解锁失败，请稍后再试',
        icon: 'none',
      });
    }
  },

  async loadEntitlementStatus() {
    try {
      const response = await this.inboxService.getEntitlementStatus('local_transcription_beta');
      if (response.result && response.result.success) {
        const entitlementStatus = response.result.data || this.data.entitlementStatus;
        this.setData({
          entitlementStatus,
          membershipCard: buildMembershipCard(entitlementStatus),
          usageStatusText: buildUsageStatusText(this.data.dailyUsage, entitlementStatus),
        });
      }
    } catch (error) {
      // 权益状态失败不影响主流程。
    }
  },

  async loadDailyUsageStatus() {
    try {
      const response = await this.inboxService.getDailyUsage();
      if (response.result && response.result.success) {
        const dailyUsage = response.result.data || this.data.dailyUsage;
        this.setData({
          dailyUsage,
          usageStatusText: buildUsageStatusText(dailyUsage, this.data.entitlementStatus),
        });
      }
    } catch (error) {
      // 次数状态失败不影响保存。
    }
  },

  updateDailyUsageStatus(quota) {
    if (!quota) return;
    this.setData({
      dailyUsage: quota,
      usageStatusText: buildUsageStatusText(quota, this.data.entitlementStatus),
    });
  },

  showRedeemModal() {
    this.setData({
      redeemVisible: true,
      redeemCodeInput: '',
    });
  },

  hideRedeemModal() {
    if (this.data.isRedeeming) return;
    this.setData({
      redeemVisible: false,
      redeemCodeInput: '',
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
        redeemVisible: false,
        redeemCodeInput: '',
        entitlementStatus,
        membershipCard: buildMembershipCard(entitlementStatus),
        usageStatusText: buildUsageStatusText(this.data.dailyUsage, entitlementStatus),
      });
      wx.showToast({
        title: entitlementStatus.alreadyRedeemed ? '该兑换码已激活过' : '兑换成功',
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

  readClipboard() {
    wx.getClipboardData({
      success: (result) => {
        const content = String(result.data || '').trim();
        if (!content) {
          wx.showToast({
            title: '剪切板没有内容',
            icon: 'none',
          });
          return;
        }
        this.setData({
          inputValue: content,
        });
        this.showStatus('已读取剪切板，点击保存后原样存入');
      },
      fail: () => {
        wx.showToast({
          title: '读取剪切板失败',
          icon: 'none',
        });
      },
    });
  },

  saveWebpageFromClipboardOrInput() {
    const currentText = this.data.inputValue;
    const currentUrl = extractHttpUrl(currentText);
    if (currentUrl) {
      this.saveWebpageUrl(currentUrl, currentText);
      return;
    }

    wx.getClipboardData({
      success: (result) => {
        const clipboardText = result.data;
        const url = extractHttpUrl(clipboardText);
        if (!url) {
          wx.showToast({
            title: '请先复制网页链接',
            icon: 'none',
          });
          return;
        }
        this.saveWebpageUrl(url, clipboardText);
      },
      fail: () => {
        wx.showToast({
          title: '读取链接失败',
          icon: 'none',
        });
      },
    });
  },

  consumeForwardMaterialsFromApp() {
    const app = typeof getApp === 'function' ? getApp() : null;
    const materials = app && typeof app.consumeForwardMaterials === 'function'
      ? app.consumeForwardMaterials()
      : [];
    if (materials && materials.length) {
      this.handleForwardMaterials(materials);
    }
  },

  handleForwardMaterials(materials) {
    if (this.forwardMaterialHandling) return;
    const list = Array.isArray(materials) ? materials : [];
    const file = list.map((material) => getForwardMaterialFile(material)).find(Boolean);
    if (file) {
      this.forwardMaterialHandling = true;
      this.showStatus('已从微信聊天文件入口识别文件，正在保存', { persist: true });
      Promise.resolve(this.saveInboxFiles([file]))
        .finally(() => {
          this.forwardMaterialHandling = false;
        });
      return;
    }

    const matchedMaterial = list.find((material) => getForwardMaterialUrl(material));
    const url = getForwardMaterialUrl(matchedMaterial);
    const sourceText = collectForwardMaterialText(matchedMaterial);

    if (!url) {
      wx.showToast({
        title: '没有识别到文章链接',
        icon: 'none',
      });
      return;
    }

    this.forwardMaterialHandling = true;
    this.showStatus('已从微信文章入口识别链接，正在保存', { persist: true });
    Promise.resolve(this.saveWebpageUrl(url, sourceText))
      .finally(() => {
        this.forwardMaterialHandling = false;
      });
  },

  async saveWebpageUrl(url, sourceText = '') {
    if (this.data.isSaving) return;
    this.setData({ isSaving: true });
    this.showStatus('网页链接保存中，请勿重复操作', { persist: true });

    try {
      const payload = buildWebpagePayload(url, sourceText);
      const response = await this.inboxService.saveRecord(payload);
      if (!response.result || !response.result.success) {
        throw new Error(this.getSaveErrorMessage(response, '保存失败'));
      }
      this.updateDailyUsageStatus(response.result.data.quota);

      const item = createRecentItem('WEBPAGE', url);
      item.recordId = response.result.data.id;

      this.setData({
        inputValue: '',
        isSaving: false,
        recentList: this.prependRecentItems(item),
      });
      this.showStatus('网页链接已上传，等待转 Markdown');
    } catch (error) {
      this.setData({ isSaving: false });
      this.showStatus('网页保存失败，请重试');
      wx.showToast({
        title: '网页保存失败',
        icon: 'none',
      });
    }
  },

  chooseInboxFile() {
    wx.chooseMessageFile({
      count: MAX_CHAT_UPLOAD_COUNT,
      type: 'file',
      extension: SUPPORTED_CHAT_UPLOAD_EXTENSIONS,
      success: (result) => {
        const files = (result.tempFiles || []).slice(0, MAX_CHAT_UPLOAD_COUNT);
        if (files.length) {
          this.saveInboxFiles(files);
        }
      },
    });
  },

  async saveInboxFiles(files) {
    if (this.data.isSaving) return;
    const selectedFiles = (files || []).slice(0, MAX_CHAT_UPLOAD_COUNT);
    if (!selectedFiles.length) return;

    const recentItems = [];
    this.setData({ isSaving: true });

    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        const fileName = file.name || `素材 ${index + 1}`;
        this.showStatus(`正在上传 ${index + 1}/${selectedFiles.length}：${fileName}`, { persist: true });
        // eslint-disable-next-line no-await-in-loop
        const item = await this.saveOneInboxFile(file);
        recentItems.push(item);
      }

      this.setData({
        isSaving: false,
        recentList: this.prependRecentItems(recentItems),
      });
      this.showStatus(`已上传 ${recentItems.length} 个素材，等待 Obsidian 同步`);
    } catch (error) {
      this.setData({
        isSaving: false,
        recentList: recentItems.length ? this.prependRecentItems(recentItems) : this.data.recentList,
      });
      const message = getErrorMessage(error, '请重试');
      this.showStatus(`已上传 ${recentItems.length}/${selectedFiles.length}，失败：${message}`, { duration: 7000 });
      wx.showToast({
        title: '批量上传失败',
        icon: 'none',
      });
    }
  },

  async saveOneInboxFile(file) {
    if (isAudioInboxFile(file)) {
      const upload = await this.inboxService.uploadVoiceFile(file.path || file.tempFilePath);
      const payload = buildVoicePayload(upload.fileID, 0, file.name || '');
      const response = await this.inboxService.saveRecord(payload);
      if (!response.result || !response.result.success) {
        throw new Error(this.getSaveErrorMessage(response, '保存失败'));
      }
      this.updateDailyUsageStatus(response.result.data.quota);

      const item = createRecentItem('VOICE', file.name || payload.content);
      item.recordId = response.result.data.id;
      item.fileID = upload.fileID;
      return item;
    }

    const upload = await this.inboxService.uploadInboxFile(file);
    const payload = buildFilePayload({
      ...file,
      fileID: upload.fileID,
    });
    const response = await this.inboxService.saveRecord(payload);
    if (!response.result || !response.result.success) {
      throw new Error(this.getSaveErrorMessage(response, '保存失败'));
    }
    this.updateDailyUsageStatus(response.result.data.quota);

    const item = createRecentItem('FILE', payload.fileName);
    item.recordId = response.result.data.id;
    item.fileID = upload.fileID;
    return item;
  },

  async saveInboxFile(file) {
    if (this.data.isSaving) return;
    this.setData({ isSaving: true });
    this.showStatus('文件上传中，请勿重复操作', { persist: true });

    try {
      const item = await this.saveOneInboxFile(file);

      this.setData({
        isSaving: false,
        recentList: this.prependRecentItems(item),
      });
      this.showStatus('文件已上传，等待 Obsidian 同步');
    } catch (error) {
      this.setData({ isSaving: false });
      const message = getErrorMessage(error, '请重试');
      this.showStatus(`文件保存失败：${message}`, { duration: 7000 });
      wx.showToast({
        title: '文件保存失败',
        icon: 'none',
      });
    }
  },

  async handleRecorderStop(result) {
    this.setData({
      isSaving: true,
      isRecording: false,
      inputPlaceholder: DEFAULT_INPUT_PLACEHOLDER,
    });
    this.showStatus('语音上传中，请勿重复操作', { persist: true });

    try {
      const upload = await this.inboxService.uploadVoiceFile(result.tempFilePath);
      const payload = buildVoicePayload(upload.fileID, result.duration);
      const response = await this.inboxService.saveRecord(payload);
      if (!response.result || !response.result.success) {
        throw new Error(this.getSaveErrorMessage(response, '保存失败'));
      }
      this.updateDailyUsageStatus(response.result.data.quota);

      const voiceItem = createRecentItem('VOICE', payload.content);
      voiceItem.recordId = response.result.data.id;
      voiceItem.fileID = upload.fileID;

      this.setData({
        isSaving: false,
        recentList: this.prependRecentItems(voiceItem),
      });
      this.showStatus('语音已上传转写中');
    } catch (error) {
      this.setData({
        isSaving: false,
      });
      const message = getErrorMessage(error, '请重试');
      this.showStatus(`语音保存失败：${message}`, { duration: 7000 });
      wx.showToast({
        title: '语音保存失败',
        icon: 'none',
      });
    }
  },

  async handleSave() {
    const content = this.data.inputValue.trim();
    if (!content || this.data.isSaving) return;

    this.setData({
      isSaving: true,
    });

    try {
      const payload = buildTextOrLinkPayload(content);
      const response = await this.inboxService.saveRecord(payload);
      if (!response.result || !response.result.success) {
        throw new Error(this.getSaveErrorMessage(response, '保存失败'));
      }
      this.updateDailyUsageStatus(response.result.data.quota);

      const type = classifyContent(content);
      const item = createRecentItem(type, content);
      item.recordId = response.result.data.id;

      this.setData({
        inputValue: '',
        isSaving: false,
        recentList: this.prependRecentItems(item),
      });

      this.showStatus('已保存，等待 Obsidian 同步');
    } catch (error) {
      this.setData({
        isSaving: false,
      });
      const message = getErrorMessage(error, '请重试');
      this.showStatus(`保存失败：${message}`, { duration: 7000 });
      wx.showToast({
        title: '保存失败',
        icon: 'none',
      });
    }
  },

  showStatus(text, options = {}) {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    this.setData({
      statusText: text,
      statusVisible: true,
    });

    if (options.persist) {
      return;
    }

    const duration = options.duration || 3000;
    this.statusTimer = setTimeout(() => {
      this.setData({
        statusVisible: false,
      });
      this.statusTimer = null;
    }, duration);
  },

  copyCode() {
    if (!this.data.bindCode) {
      wx.showToast({
        title: '绑定码生成中，请稍后',
        icon: 'none',
      });
      return;
    }

    wx.setClipboardData({
      data: this.data.bindCode,
      success: () => {
        wx.showToast({
          title: '绑定码已复制',
          icon: 'none',
        });
      },
    });
  },

  setBindCodeState({ code, isBound, clients, deviceLimit, maxDeviceLimit, canAddDevice }) {
    const bindCode = String(code || '');
    this.setData({
      bindCode,
      isBound: Boolean(isBound),
      displayBindCode: this.data.bindCodeVisible && bindCode ? bindCode : '######',
      bindClients: Array.isArray(clients) ? clients : this.data.bindClients,
      bindDeviceLimit: Number(deviceLimit) || this.data.bindDeviceLimit || 1,
      bindMaxDeviceLimit: Number(maxDeviceLimit) || this.data.bindMaxDeviceLimit || 3,
      canAddBindDevice: typeof canAddDevice === 'boolean' ? canAddDevice : this.data.canAddBindDevice,
    });
  },

  async requestBindCode(options = {}) {
    try {
      const response = await this.inboxService.createBindCode();
      if (!response.result || !response.result.success) {
        throw new Error(response.result && response.result.errMsg ? response.result.errMsg : '绑定码生成失败');
      }
      const isBound = response.result.data.status === 'bound';
      this.setBindCodeState({
        code: response.result.data.code,
        isBound,
        clients: response.result.data.clients || [],
        deviceLimit: response.result.data.deviceLimit,
        maxDeviceLimit: response.result.data.maxDeviceLimit,
        canAddDevice: response.result.data.canAddDevice,
      });
      if (options.switchToCollectIfBound && isBound) {
        this.setData({ currentView: 'collect' });
        return;
      }
      this.startBindStatusPolling();
    } catch (error) {
      this.stopBindStatusPolling();
      this.setData({
        bindCode: '',
        displayBindCode: '######',
        isBound: false,
      });
      wx.showToast({
        title: '云端绑定码生成失败，请稍后重试',
        icon: 'none',
      });
    }
  },

  async requestBindStatus() {
    if (!this.data.bindCode || this.data.isBound) return;

    try {
      const response = await this.inboxService.getBindStatus(this.data.bindCode);
      const statusData = response.result && response.result.success ? response.result.data : null;
      if (!statusData) return;

      if (statusData.isBound) {
        this.setBindCodeState({
          code: statusData.code || this.data.bindCode,
          isBound: true,
          clients: statusData.clients || [],
          deviceLimit: statusData.deviceLimit,
          maxDeviceLimit: statusData.maxDeviceLimit,
          canAddDevice: statusData.canAddDevice,
        });
        this.stopBindStatusPolling();
        return;
      }
      this.setBindCodeState({
        code: statusData.code || this.data.bindCode,
        isBound: statusData.isBound,
        clients: statusData.clients || [],
        deviceLimit: statusData.deviceLimit,
        maxDeviceLimit: statusData.maxDeviceLimit,
        canAddDevice: statusData.canAddDevice,
      });
    } catch (error) {
      // 查询状态失败不打断用户手动复制绑定码。
    }
  },

  startBindStatusPolling() {
    this.stopBindStatusPolling();
    this.requestBindStatus();
    this.bindStatusTimer = setInterval(() => {
      this.requestBindStatus();
    }, 3000);
  },

  stopBindStatusPolling() {
    if (this.bindStatusTimer) {
      clearInterval(this.bindStatusTimer);
      this.bindStatusTimer = null;
    }
  },

  toggleBindCodeVisibility() {
    const nextVisible = !this.data.bindCodeVisible;
    this.setData({
      bindCodeVisible: nextVisible,
      displayBindCode: nextVisible && this.data.bindCode ? this.data.bindCode : '######',
    });
  },

  replaceCode() {
    wx.showModal({
      title: '更换绑定码',
      content: '更换绑定码后，原绑定码将失效。之前使用原绑定码绑定的 Obsidian 插件将无法继续同步。',
      confirmText: '确认更换',
      cancelText: '取消',
      success: (result) => {
        if (result.confirm) {
          this.requestReplaceBindCode();
        }
      },
    });
  },

  async requestReplaceBindCode() {
    try {
      const response = await this.inboxService.replaceBindCode();
      if (!response.result || !response.result.success) {
        throw new Error(response.result && response.result.errMsg ? response.result.errMsg : '绑定码更换失败');
      }
      this.setData({ bindCodeVisible: false });
      this.setBindCodeState({
        code: response.result.data.code,
        isBound: false,
        clients: response.result.data.clients || [],
        deviceLimit: response.result.data.deviceLimit,
        maxDeviceLimit: response.result.data.maxDeviceLimit,
        canAddDevice: response.result.data.canAddDevice,
      });
      this.startBindStatusPolling();
      wx.showToast({
        title: '绑定码已更换',
        icon: 'none',
      });
    } catch (error) {
      wx.showToast({
        title: '绑定码更换失败，请稍后重试',
        icon: 'none',
      });
    }
  },

  increaseBindDeviceLimit() {
    if (!this.data.bindCode) {
      wx.showToast({
        title: '绑定码生成中，请稍后',
        icon: 'none',
      });
      return;
    }

    if (!this.data.canAddBindDevice) {
      wx.showToast({
        title: '最多绑定 3 台电脑',
        icon: 'none',
      });
      return;
    }

    wx.showModal({
      title: '新增电脑名额',
      content: '新增后，这个绑定码可以再绑定一台 Obsidian 插件。素材同步一次后仍会从云端清理，请确保你的电脑之间已经开启 Obsidian 同步。',
      confirmText: '确认新增',
      cancelText: '取消',
      success: (result) => {
        if (result.confirm) {
          this.requestIncreaseBindDeviceLimit();
        }
      },
    });
  },

  async requestIncreaseBindDeviceLimit() {
    try {
      const response = await this.inboxService.increaseBindDeviceLimit(this.data.bindCode);
      if (!response.result || !response.result.success) {
        throw new Error(response.result && response.result.errMsg ? response.result.errMsg : '新增设备名额失败');
      }
      const statusData = response.result.data || {};
      this.setBindCodeState({
        code: statusData.code || this.data.bindCode,
        isBound: statusData.isBound,
        clients: statusData.clients || [],
        deviceLimit: statusData.deviceLimit,
        maxDeviceLimit: statusData.maxDeviceLimit,
        canAddDevice: statusData.canAddDevice,
      });
      wx.showToast({
        title: '已新增电脑名额',
        icon: 'none',
      });
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, '新增设备名额失败，请稍后重试'),
        icon: 'none',
      });
    }
  },

  confirmUnbindClient(event) {
    const clientId = event.currentTarget && event.currentTarget.dataset
      ? String(event.currentTarget.dataset.clientId || '')
      : '';
    if (!this.data.bindCode || !clientId) {
      wx.showToast({
        title: '未找到绑定设备',
        icon: 'none',
      });
      return;
    }

    wx.showModal({
      title: '解除电脑绑定',
      content: '解除后，这台电脑将不能继续拉取这个微信里的收集内容。需要恢复时，可在插件里重新绑定。',
      confirmText: '确认解除',
      cancelText: '取消',
      success: (result) => {
        if (result.confirm) {
          this.requestUnbindClient(clientId);
        }
      },
    });
  },

  async requestUnbindClient(clientId) {
    try {
      const response = await this.inboxService.unbindBindClient(this.data.bindCode, clientId);
      if (!response.result || !response.result.success) {
        throw new Error(response.result && response.result.errMsg ? response.result.errMsg : '解除绑定失败');
      }
      const statusData = response.result.data || {};
      this.setBindCodeState({
        code: statusData.code || this.data.bindCode,
        isBound: statusData.isBound,
        clients: statusData.clients || [],
        deviceLimit: statusData.deviceLimit,
        maxDeviceLimit: statusData.maxDeviceLimit,
        canAddDevice: statusData.canAddDevice,
      });
      if (!statusData.isBound) {
        this.startBindStatusPolling();
      }
      wx.showToast({
        title: '已解除绑定',
        icon: 'none',
      });
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, '解除绑定失败，请稍后重试'),
        icon: 'none',
      });
    }
  },
});
