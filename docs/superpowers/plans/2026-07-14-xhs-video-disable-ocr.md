# 小红书视频跳过图片 OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止小红书视频笔记对封面/预览图执行 OCR，同时继续对小红书图文长文执行 OCR。

**Architecture:** 在 `hydrateWebpageRecord` 的小红书分支中，以已解析出的 `extractedXiaohongshu.videoUrl` 或 `mediaUrl` 作为视频判定。只有 Pro 权限有效且该判定为假时，调用已有 `enrichXiaohongshuExtractionWithOcr`；不改动 OCR 实现、媒体下载或转写实现。

**Tech Stack:** Node.js、Obsidian Electron 插件、`node:assert` 回归测试。

---

### Task 1: 为视频 OCR 排除条件建立回归测试

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 写入失败的源代码契约测试**

在现有小红书 OCR 断言附近加入：

```js
assert.ok(pluginMainSource.includes('const isXiaohongshuVideoNote = Boolean(extractedXiaohongshu.videoUrl || mediaUrl);'));
assert.ok(pluginMainSource.includes('if (hasProAdvancedAccess && !isXiaohongshuVideoNote) {'));
```

- [ ] **Step 2: 运行测试并确认失败**

运行：`node tests/plugin-main-ai.test.js`

预期：失败，原因是生产代码尚未定义 `isXiaohongshuVideoNote` 且 OCR 尚未受该守卫控制。

- [ ] **Step 3: 提交测试变更**

```powershell
git add tests/plugin-main-ai.test.js
git commit -m "test: cover xiaohongshu video OCR exclusion"
```

### Task 2: 仅允许图文笔记调用 OCR

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:12918-12923`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 实现最小视频守卫**

在现有 OCR 调用前插入：

```js
const isXiaohongshuVideoNote = Boolean(extractedXiaohongshu.videoUrl || mediaUrl);
if (hasProAdvancedAccess && !isXiaohongshuVideoNote) {
  extractedXiaohongshu = await this.enrichXiaohongshuExtractionWithOcr(extractedXiaohongshu, {
    pageUrl: resolvedUrl,
    binding,
  });
}
```

- [ ] **Step 2: 运行测试并确认通过**

运行：`node tests/plugin-main-ai.test.js`

预期：退出码为 0。

- [ ] **Step 3: 提交实现**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix: skip OCR for xiaohongshu videos"
```

### Task 3: 发布验证

**Files:**
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`

- [ ] **Step 1: 更新发布版本**

将两份 `manifest.json` 更新为 `1.3.25`，并在两份 `versions.json` 增加 `"1.3.25": "1.0.0"`，保留已有版本记录。

- [ ] **Step 2: 运行发布前验证**

运行：

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

预期：全部退出码为 0。

- [ ] **Step 3: 创建发布提交与标签**

```powershell
git add manifest.json versions.json obsidian-plugin/wechat-inbox-sync/manifest.json obsidian-plugin/wechat-inbox-sync/versions.json tests/plugin-marketplace-package.test.js
git commit -m "chore: release plugin 1.3.25"
git push origin HEAD:main
git tag 1.3.25
git push origin 1.3.25
```

- [ ] **Step 4: 检查 GitHub Release 与本地安装包**

运行发布检查脚本，确认默认分支 manifest、Release tag、Release assets、Release manifest、raw manifest 和本地 zip 的版本完全一致。
