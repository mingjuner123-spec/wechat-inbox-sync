const DEFAULT_TUTORIAL_URL = 'https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink';
const DEFAULT_ANNOUNCEMENT = '插件 v1.3.2 已发布：修复绑定码与 Pro 权限链路，飞书文档转存可优先使用官方 API 通道。';
const DEFAULT_PLUGIN_VERSION = '1.3.2';
const DEFAULT_PLUGIN_UPDATED_AT = '2026-07-05 07:13';
const DEFAULT_ANNOUNCEMENT_VERSION = '2026-07-05-plugin-132-market-update';
const DEFAULT_UPDATE_ITEMS = [
  '插件 v1.3.2 已发布，整理 Pro 高级功能、绑定码和同步/安装失败诊断入口',
  '飞书文档转存已支持官方 API 通道，标题、正文和图片提取更完整；未连接时仍保留旧解析方式',
  '修复绑定码、兑换码和 Pro 权限读取异常，已开通用户刷新权限后即可恢复高级功能',
  'Pro 自动能力继续支持本地转写、小红书 OCR/评论区提取、AI 简介与关键词属性生成',
];

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function buildPublicConfig(config) {
  const source = config || {};
  const updateItems = normalizeTextList(source.updateItems);
  return {
    announcement: normalizeText(source.announcement) || DEFAULT_ANNOUNCEMENT,
    tutorialUrl: normalizeText(source.tutorialUrl) || DEFAULT_TUTORIAL_URL,
    pluginVersion: normalizeText(source.pluginVersion) || DEFAULT_PLUGIN_VERSION,
    updatedAt: normalizeText(source.updatedAt) || DEFAULT_PLUGIN_UPDATED_AT,
    announcementVersion: normalizeText(source.announcementVersion) || DEFAULT_ANNOUNCEMENT_VERSION,
    updateItems: updateItems.length ? updateItems : DEFAULT_UPDATE_ITEMS,
  };
}

module.exports = {
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_ANNOUNCEMENT_VERSION,
  DEFAULT_PLUGIN_UPDATED_AT,
  DEFAULT_PLUGIN_VERSION,
  DEFAULT_TUTORIAL_URL,
  DEFAULT_UPDATE_ITEMS,
  buildPublicConfig,
};
