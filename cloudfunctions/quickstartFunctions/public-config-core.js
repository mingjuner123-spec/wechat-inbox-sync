const DEFAULT_TUTORIAL_URL = 'https://my.feishu.cn/wiki/EPHhwqRobijHqfkAqjMcDEgvnlf?from=from_copylink';
const DEFAULT_ANNOUNCEMENT = '插件已可在 Obsidian 插件市场安装并自动更新，建议更换为插件市场版';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function buildPublicConfig(config) {
  const source = config || {};
  return {
    announcement: normalizeText(source.announcement) || DEFAULT_ANNOUNCEMENT,
    tutorialUrl: normalizeText(source.tutorialUrl) || DEFAULT_TUTORIAL_URL,
    pluginVersion: normalizeText(source.pluginVersion),
    updatedAt: normalizeText(source.updatedAt),
    announcementVersion: normalizeText(source.announcementVersion),
    updateItems: normalizeTextList(source.updateItems),
  };
}

module.exports = {
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_TUTORIAL_URL,
  buildPublicConfig,
};
