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

assert.strictEqual(DEFAULT_ANNOUNCEMENT, '插件 v1.3.0 已发布：修复绑定码与 Pro 权限链路，飞书文档转存可优先使用官方 API 通道。');
assert.strictEqual(DEFAULT_PLUGIN_VERSION, '1.3.0');
assert.strictEqual(DEFAULT_PLUGIN_UPDATED_AT, '2026-07-05 07:13');
assert.strictEqual(DEFAULT_ANNOUNCEMENT_VERSION, '2026-07-05-plugin-130-feishu-fix');
assert.deepStrictEqual(DEFAULT_UPDATE_ITEMS, [
  '插件 v1.3.0 已发布，整理 Pro 高级功能、绑定码和同步/安装失败诊断入口',
  '飞书文档转存已支持官方 API 通道，标题、正文和图片提取更完整；未连接时仍保留旧解析方式',
  '修复绑定码、兑换码和 Pro 权限读取异常，已开通用户刷新权限后即可恢复高级功能',
  'Pro 自动能力继续支持本地转写、小红书 OCR/评论区提取、AI 简介与关键词属性生成',
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
  announcement: '2026年5月13日有插件更新，更新文件请在绑定教程下载',
  tutorialUrl: ' https://example.com/tutorial ',
  pluginVersion: '0.1.1',
  updatedAt: '2026-05-13T16:00:00.000Z',
  announcementVersion: ' 2026-05-13 ',
  updateItems: [' 新增插件市场安装 ', '', '优化绑定提示'],
}), {
  announcement: '2026年5月13日有插件更新，更新文件请在绑定教程下载',
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
