# 视频号暂未接通提示与 1.3.58 发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 视频号链接提取失败时显示明确的“功能暂未接通”提示，同时保持普通网页的原失败提示不变，并发布插件 1.3.58。

**Architecture:** 复用现有 `isWechatChannelsUrl()` 做严格平台判断，只在 `buildWebpageMarkdownBody()` 的失败状态分支中返回视频号专用文案。原始链接继续保存在笔记属性；不接入现有实验解析器，不改变抓取、转写或其他平台行为。

**Tech Stack:** Obsidian/Electron Node.js、Node `assert` 回归测试、GitHub Actions/Release、Obsidian 社区插件发布链路。

---

### Task 1: 建立失败回归测试

**Files:**
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 写视频号和普通网页的对照断言**

使用 `buildMarkdownForRecord()` 构造两个 `conversionStatus: failed` 的网页记录。视频号记录必须包含“视频号内容解析功能暂未接通”和“当前已为你保存原始链接”，且不包含“网页正文太短”；普通网页仍必须包含原通用失败提示。

- [ ] **Step 2: 运行测试并确认旧版失败**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，原因是 1.3.57 的视频号失败记录仍输出“这篇文章的正文未能自动提取”。

### Task 2: 最小实现

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: 在失败分支前加入视频号专用返回**

仅当 URL 被 `isWechatChannelsUrl()` 识别，且状态为 `failed`、`wechat_captcha` 或 `link_saved` 时返回：

```text
> ⚠️ 视频号内容解析功能暂未接通，当前已为你保存原始链接。
> 功能上线后，可以重新发送链接进行提取。
```

- [ ] **Step 2: 运行插件核心测试并确认通过**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

### Task 3: 版本身份与发布验证

**Files:**
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Test: `tests/plugin-marketplace-package.test.js`
- Test: `tests/plugin-release-identity.test.js`

- [ ] **Step 1: 将四处正式版本身份统一提升到 1.3.58**

`versions.json` 新增 `"1.3.58": "1.0.0"`，不改写历史版本。

- [ ] **Step 2: 运行发布回归**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node tests/plugin-release-identity.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: 全部退出码为 0。

- [ ] **Step 3: 发布并执行发布后终检**

创建 PR 并合并到默认分支；创建精确标签和 GitHub Release `1.3.58`，上传 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 ZIP。运行 `obsidian-plugin-release-check`，确认默认分支、标签、Release 资产、远端 manifest 与本地 ZIP 身份一致。

