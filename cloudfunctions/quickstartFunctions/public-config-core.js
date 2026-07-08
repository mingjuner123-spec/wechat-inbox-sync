const DEFAULT_TUTORIAL_URL = 'https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink';
const DEFAULT_ANNOUNCEMENT = '小程序内已支持直接开通 Pro，年卡早鸟价 49.9 元，7 月 10 日后恢复 68 元/年。';
const DEFAULT_PLUGIN_VERSION = '1.3.3';
const DEFAULT_PLUGIN_UPDATED_AT = '2026-07-05 08:04';
const DEFAULT_ANNOUNCEMENT_VERSION = '2026-07-05-plugin-133-pro-price';
const DEFAULT_UPDATE_ITEMS = [
  '小程序内已支持直接开通 Pro，年卡早鸟价 49.9 元，7 月 10 日后恢复 68 元/年。',
  'Pro 用户支持小红书长文笔记提取图片文字。',
  '飞书文档转存支持接入飞书官方 API。',
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
