const DEFAULT_TUTORIAL_URL = 'https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink';
const DEFAULT_ANNOUNCEMENT = 'Pro 版，已开启7天全面体验。前往开通 Pro 领取会员和查看教程。';
const DEFAULT_PLUGIN_VERSION = '1.2.7';
const DEFAULT_PLUGIN_UPDATED_AT = '2026-06-14';
const DEFAULT_ANNOUNCEMENT_VERSION = '2026-06-14-local-transcription-first';
const DEFAULT_UPDATE_ITEMS = [
  'Pro 版，已开启7天全面体验',
  '前往开通 Pro 领取会员和查看教程',
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
