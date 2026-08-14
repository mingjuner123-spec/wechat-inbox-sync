# 社媒内容上下文渲染拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将社媒转写笔记的原文上下文 Markdown 生成从巨型插件入口拆为可独立测试模块，且不改变抓取与转写行为。

**Architecture:** `src/main.js` 保留 HTML 解析、平台识别、登录会话与媒体地址选择；新的 `src/social-media-context-utils.js` 只接收已经解析出的标题、正文、标签和图片 URL，返回固定顺序的上下文 Markdown。插件入口只负责把模块返回结果接回现有笔记拼装流程。

**Tech Stack:** Node.js CommonJS、esbuild、现有 Node `assert` 回归测试。

---

### Task 1: 为纯渲染边界写失败回归

**Files:**
- Create: `tests/social-media-context-utils.test.js`
- Test: `tests/plugin-social-media-transcript-context.test.js`

- [ ] **Step 1: 写入独立模块的失败测试**

```js
const { buildSocialMediaSupplementalMarkdown } = require('../obsidian-plugin/wechat-inbox-sync/src/social-media-context-utils');

assert.strictEqual(buildSocialMediaSupplementalMarkdown({
  title: '抖音作品标题',
  description: '原文正文',
  tags: ['AI', '#Obsidian', 'AI'],
  imageUrls: ['https://img.example.com/cover.jpg', ''],
}), [
  '## 标题', '', '抖音作品标题', '',
  '## 原文正文', '', '原文正文', '',
  '## 标签', '', '#AI #Obsidian', '',
  '## 封面图', '', '![封面](https://img.example.com/cover.jpg)',
].join('\n'));
```

- [ ] **Step 2: 运行失败测试**

Run: `node tests/social-media-context-utils.test.js`
Expected: `MODULE_NOT_FOUND`，因为纯渲染模块尚不存在。

### Task 2: 新增社媒原文上下文纯函数模块

**Files:**
- Create: `obsidian-plugin/wechat-inbox-sync/src/social-media-context-utils.js`
- Test: `tests/social-media-context-utils.test.js`

- [ ] **Step 1: 实现最小纯函数**

实现并导出 `normalizeSocialMediaImageUrl` 与 `buildSocialMediaSupplementalMarkdown`：

```js
function buildSocialMediaSupplementalMarkdown({ title = '', description = '', tags = [], imageUrls = [] } = {}) {
  // 仅生成 标题 → 原文正文 → 标签 → 封面图；去掉空值、重复标签和无效 URL。
}
```

模块不得读取网络、文件、Obsidian API 或插件设置。

- [ ] **Step 2: 验证绿色**

Run: `node tests/social-media-context-utils.test.js`
Expected: `social-media-context-utils tests passed`。

### Task 3: 将入口的社媒上下文生成接到新模块

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js:1-140`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js:4070-4130`
- Test: `tests/plugin-social-media-transcript-context.test.js`

- [ ] **Step 1: 在入口顶部导入模块**

```js
const { buildSocialMediaSupplementalMarkdown } = require('./social-media-context-utils');
```

- [ ] **Step 2: 删除入口内同名 Markdown 拼接函数，仅保留 HTML 元数据提取函数**

`buildSocialMediaSupplementalMarkdownFromHtml` 继续在入口内调用 `extractWebpageMetadataFromHtml`、`extractTagsFromText` 和 `collectImageUrlsFromHtml`，但把结果传入新模块。

- [ ] **Step 3: 运行平台回归**

Run: `node tests/plugin-social-media-transcript-context.test.js`
Expected: PASS；小红书、抖音、B 站、小宇宙在转写前仍包含标题、正文、标签和封面。

### Task 4: 保住抖音媒体回退与构建一致性

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`（由构建生成）
- Test: `tests/plugin-social-media-transcript-context.test.js`
- Test: `tests/plugin-sync-history.test.js`

- [ ] **Step 1: 构建发布 bundle**

Run: `node obsidian-plugin/wechat-inbox-sync/build-plugin.js`

- [ ] **Step 2: 运行回归与语法检查**

Run:

```powershell
node tests/social-media-context-utils.test.js
node tests/plugin-social-media-transcript-context.test.js
node tests/plugin-sync-history.test.js
node obsidian-plugin/wechat-inbox-sync/build-plugin.js --check
node --check obsidian-plugin/wechat-inbox-sync/src/main.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: 全部通过；抖音无媒体时的严格浏览器回退测试仍被 `plugin-social-media-transcript-context` 覆盖。

### Task 5: 本地检查点与发布边界

**Files:**
- Modify: 本任务实际修改的源码、bundle、测试和本计划

- [ ] **Step 1: 检查差异范围**

Run: `git status --short` 与 `git diff --stat`。只允许包含本任务的社媒上下文模块、入口接线、bundle 与测试。

- [ ] **Step 2: 提交本地检查点**

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/social-media-context-utils.js obsidian-plugin/wechat-inbox-sync/src/main.js obsidian-plugin/wechat-inbox-sync/main.js tests/social-media-context-utils.test.js tests/plugin-social-media-transcript-context.test.js docs/superpowers/plans/2026-08-14-social-media-context-rendering.md
git commit -m "refactor(plugin): isolate social media context rendering"
```

- [ ] **Step 3: 不发布、不部署、不替换本机插件**

该提交只形成可回退本地候选。下一次发布必须以公开插件仓库最新正式版为基线，独立执行版本身份、发布资产与本地镜像同步校验。
