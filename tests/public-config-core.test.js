const assert = require('assert');

const {
  DEFAULT_ANNOUNCEMENT,
  DEFAULT_ANNOUNCEMENT_VERSION,
  DEFAULT_PLUGIN_UPDATED_AT,
  DEFAULT_PLUGIN_VERSION,
  DEFAULT_TUTORIAL_URL,
  DEFAULT_UPDATE_ITEMS,
  buildPublicConfig,
} = require('../cloudfunctions/quickstartFunctions/public-config-core');

assert.strictEqual(DEFAULT_ANNOUNCEMENT, '小程序内已支持直接开通 Pro，年卡早鸟价 49.9 元，7 月 10 日后恢复 68 元/年。');
assert.strictEqual(DEFAULT_PLUGIN_VERSION, '1.3.3');
assert.strictEqual(DEFAULT_PLUGIN_UPDATED_AT, '2026-07-05 08:04');
assert.strictEqual(DEFAULT_ANNOUNCEMENT_VERSION, '2026-07-05-plugin-133-pro-price');
assert.deepStrictEqual(DEFAULT_UPDATE_ITEMS, [
  '小程序内已支持直接开通 Pro，年卡早鸟价 49.9 元，7 月 10 日后恢复 68 元/年。',
  'Pro 用户支持小红书长文笔记提取图片文字。',
  '飞书文档转存支持接入飞书官方 API。',
]);
assert.strictEqual(DEFAULT_TUTORIAL_URL, 'https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink');

assert.deepStrictEqual(buildPublicConfig(), {
  announcement: DEFAULT_ANNOUNCEMENT,
  tutorialUrl: DEFAULT_TUTORIAL_URL,
  pluginVersion: DEFAULT_PLUGIN_VERSION,
  updatedAt: DEFAULT_PLUGIN_UPDATED_AT,
  announcementVersion: DEFAULT_ANNOUNCEMENT_VERSION,
  updateItems: DEFAULT_UPDATE_ITEMS,
});

assert.deepStrictEqual(buildPublicConfig({
  announcement: ' 2026年5月3日有插件更新，更新文件请在绑定教程下载 ',
  tutorialUrl: ' https://example.com/tutorial ',
  pluginVersion: '0.1.1',
  updatedAt: '2026-05-13T16:00:00.000Z',
  announcementVersion: ' 2026-05-13 ',
  updateItems: [' 新增插件市场安装 ', '', '优化绑定提示'],
}), {
  announcement: '2026年5月3日有插件更新，更新文件请在绑定教程下载',
  tutorialUrl: 'https://example.com/tutorial',
  pluginVersion: '0.1.1',
  updatedAt: '2026-05-13T16:00:00.000Z',
  announcementVersion: '2026-05-13',
  updateItems: ['新增插件市场安装', '优化绑定提示'],
});

assert.deepStrictEqual(buildPublicConfig({
  announcement: '  ',
  tutorialUrl: '  ',
}), {
  announcement: DEFAULT_ANNOUNCEMENT,
  tutorialUrl: DEFAULT_TUTORIAL_URL,
  pluginVersion: DEFAULT_PLUGIN_VERSION,
  updatedAt: DEFAULT_PLUGIN_UPDATED_AT,
  announcementVersion: DEFAULT_ANNOUNCEMENT_VERSION,
  updateItems: DEFAULT_UPDATE_ITEMS,
});
