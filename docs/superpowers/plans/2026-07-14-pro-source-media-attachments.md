# Pro 原始音视频保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原始音视频本地保存移入 Pro 高级功能，并在开启和实际写入时强制校验云端 Pro 权益。

**Architecture:** 复用插件既有 Pro 权益查询路径，为 `ensureProFeatureAccess` 增加强制刷新选项。设置层在 Pro 面板中先校验再保存开关；写盘层在下载前进行同样的校验并将失败降级为跳过附件。

**Tech Stack:** Obsidian Plugin API、Node.js、`tests/plugin-main-ai.test.js`。

---

### Task 1: 为写盘 Pro 门禁写失败测试

**Files:**

- Modify: `tests/plugin-main-ai.test.js:runSourceMediaAttachmentTests`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:saveSourceMediaAttachment`

- [ ] **Step 1: 写入失败测试**

在 `disabledPlugin` 用例后加入：

```js
const noProPlugin = new PluginClass();
noProPlugin.settings = helpers.mergeSettings({ saveOriginalMediaEnabled: true });
noProPlugin.ensureProFeatureAccess = async () => {
  throw new Error('保存原始音视频到本地需要有效 Pro。');
};
noProPlugin.downloadArrayBuffer = async () => {
  throw new Error('non-Pro media save must not download');
};
const noProRecord = await noProPlugin.saveSourceMediaAttachment(sourceRecord, '临时收集', '2026-07-14', '演示视频');
assert.strictEqual(noProRecord, sourceRecord);
```

- [ ] **Step 2: 运行失败测试**

运行 `node tests/plugin-main-ai.test.js`。预期因当前写盘入口没有调用 `ensureProFeatureAccess` 而失败。

- [ ] **Step 3: 最小实现**

在 `saveSourceMediaAttachment` 的前置开关、转写、URL 检查之后，下载之前加入：

```js
try {
  await this.ensureProFeatureAccess('保存原始音视频到本地', { forceRefresh: true });
} catch (error) {
  return record;
}
```

- [ ] **Step 4: 运行通过测试**

运行 `node tests/plugin-main-ai.test.js`。预期通过且非 Pro 用例不下载、不写盘。

- [ ] **Step 5: 提交**

运行 `git add tests/plugin-main-ai.test.js obsidian-plugin/wechat-inbox-sync/main.js`，再运行 `git commit -m "feat: gate media attachments by pro"`。

### Task 2: 强制 Pro 云端刷新

**Files:**

- Modify: `tests/plugin-main-ai.test.js:Pro access tests`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:ensureProFeatureAccess`

- [ ] **Step 1: 写入选项转发失败测试**

加入以下断言：

```js
const forceRefreshPlugin = new PluginClass();
let receivedOptions = null;
forceRefreshPlugin.getProFeatureAccessStatus = async (options) => {
  receivedOptions = options;
  return { hasAccess: true, status: 'active', expiresAt: '2026-08-01T00:00:00.000Z' };
};
await forceRefreshPlugin.ensureProFeatureAccess('保存原始音视频到本地', { forceRefresh: true });
assert.deepStrictEqual(receivedOptions, { forceRefresh: true });
```

- [ ] **Step 2: 运行失败测试**

运行 `node tests/plugin-main-ai.test.js`。预期失败，因为当前方法未接收、未转发选项。

- [ ] **Step 3: 最小实现**

将方法签名和首行改为：

```js
async ensureProFeatureAccess(featureName = '该功能', options = {}) {
  let status = await this.getProFeatureAccessStatus({
    forceRefresh: options.forceRefresh === true,
  });
```

保留既有过期和错误分支。

- [ ] **Step 4: 运行通过测试并提交**

运行 `node tests/plugin-main-ai.test.js`，通过后执行 `git add tests/plugin-main-ai.test.js obsidian-plugin/wechat-inbox-sync/main.js` 和 `git commit -m "feat: refresh pro access for media saves"`。

### Task 3: 移动开关至 Pro 高级面板

**Files:**

- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:WechatInboxSettingTab.display`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 删除基础区开关**

删除“笔记保存方式”后的 `new Setting(containerEl)` 原始音视频开关，不改变默认设置键。

- [ ] **Step 2: 添加 Pro 面板开关**

紧随 `proPanel` 的“刷新 Pro 权限”设置后添加 `new Setting(proPanel)`。名称保持“保存原始音视频到本地”，描述以“Pro 功能。默认关闭”开头。关闭时直接保存 `false`；开启时执行 `await this.plugin.ensureProFeatureAccess('保存原始音视频到本地', { forceRefresh: true })`，成功后保存 `true`，失败后保存 `false`、显示 `new Notice(error.message || String(error))` 并调用 `this.display()`。

- [ ] **Step 3: 验证并提交**

运行 `node tests/plugin-main-ai.test.js; node --check obsidian-plugin/wechat-inbox-sync/main.js; rg -n "保存原始音视频到本地" obsidian-plugin/wechat-inbox-sync/main.js`。预期测试和语法通过，唯一设置项由 `new Setting(proPanel)` 创建。执行 `git add obsidian-plugin/wechat-inbox-sync/main.js` 和 `git commit -m "feat: move media saving toggle to pro settings"`。

### Task 4: 发布前验证与记录

**Files:**

- Modify: `docs/superpowers/plans/2026-07-14-pro-source-media-attachments.md`
- Test: `tests/plugin-main-ai.test.js`
- Test: `tests/plugin-marketplace-package.test.js`

- [ ] **Step 1: 运行回归**

运行 `node tests/plugin-main-ai.test.js; node tests/plugin-marketplace-package.test.js; node --check obsidian-plugin/wechat-inbox-sync/main.js; git diff --check; git status --short`。预期所有命令成功且仅有本次设计、计划和功能文件。

- [ ] **Step 2: 提交计划文档**

运行 `git add docs/superpowers/plans/2026-07-14-pro-source-media-attachments.md` 和 `git commit -m "docs: plan pro media attachment settings"`。当前发布分支没有 `docs/WORKLOG.md`，不新建脱离主项目历史的工作日志；设计与计划文档记录完整范围和验证。
