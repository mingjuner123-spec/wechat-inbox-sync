const DEFAULT_TUTORIAL_URL = 'https://my.feishu.cn/wiki/EPHhwqRobijHqfkAqjMcDEgvnlf?from=from_copylink';
const DEFAULT_ANNOUNCEMENT = '插件已可在 Obsidian 插件市场安装并自动更新，建议更换为插件市场版';

function normalizeText(value) {
  return String(value || '').trim();
}

function buildPublicConfig(config) {
  const source = config || {};
  return {
    announcement: normalizeText(source.announcement) || DEFAULT_ANNOUNCEMENT,
    tutorialUrl: normalizeText(source.tutorialUrl) || DEFAULT_TUTORIAL_URL,
    pluginVersion: normalizeText(source.pluginVersion),
    updatedAt: normalizeText(source.updatedAt),
  };
}

module.exports = {
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_TUTORIAL_URL,
  buildPublicConfig,
};
