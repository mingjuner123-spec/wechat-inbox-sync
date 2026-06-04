const assert = require('assert');

const {
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_TUTORIAL_URL,
  buildPublicConfig,
} = require('../cloudfunctions/quickstartFunctions/public-config-core');

assert.strictEqual(DEFAULT_ANNOUNCEMENT, '插件已可在 Obsidian 插件市场安装并自动更新，建议更换为插件市场版');
assert.strictEqual(DEFAULT_TUTORIAL_URL, 'https://my.feishu.cn/wiki/EPHhwqRobijHqfkAqjMcDEgvnlf?from=from_copylink');

assert.deepStrictEqual(buildPublicConfig(), {
  announcement: DEFAULT_ANNOUNCEMENT,
  tutorialUrl: DEFAULT_TUTORIAL_URL,
  pluginVersion: '',
  updatedAt: '',
});

assert.deepStrictEqual(buildPublicConfig({
  announcement: '2026年5月13日有插件更新，更新文件请在绑定教程下载',
  tutorialUrl: ' https://example.com/tutorial ',
  pluginVersion: '0.1.1',
  updatedAt: '2026-05-13T16:00:00.000Z',
}), {
  announcement: '2026年5月13日有插件更新，更新文件请在绑定教程下载',
  tutorialUrl: 'https://example.com/tutorial',
  pluginVersion: '0.1.1',
  updatedAt: '2026-05-13T16:00:00.000Z',
});

assert.deepStrictEqual(buildPublicConfig({
  announcement: '  ',
  tutorialUrl: '  ',
}), {
  announcement: DEFAULT_ANNOUNCEMENT,
  tutorialUrl: DEFAULT_TUTORIAL_URL,
  pluginVersion: '',
  updatedAt: '',
});
