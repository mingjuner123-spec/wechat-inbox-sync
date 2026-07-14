# 小红书真实评论请求回放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从小红书网页真实签名请求中恢复主评论和折叠回复，并按父评论层级写入 Markdown。

**Architecture:** 在插件主文件中新增评论响应归类/合并纯函数。隐藏 Electron 页面继续优先尝试手工 API，但会捕获浏览器真实评论响应，分别归入主评论 payload 和子回复 payload，再按 `root_comment_id` 合并；页面脚本增加折叠回复触发器，保证浏览器发出真实请求。

**Tech Stack:** Node.js、Obsidian Electron Debugger Network API、现有小红书评论规范化函数、Node `assert` 回归测试。

---

### Task 1: 建立真实响应父子合并的失败测试

**Files:**
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 写入失败测试**

加入 `mergeXiaohongshuCapturedCommentPayloads` 的断言：一个主评论 payload 加一个 `root_comment_id` 对应的子回复 payload，结果必须保留一个主评论且 `replies.length === 1`；不同 root ID 的回复不得挂错父评论。

- [ ] **Step 2: 运行并确认失败**

运行：`node tests/plugin-main-ai.test.js`

预期：失败，因为生产代码尚未导出该合并函数。

- [ ] **Step 3: 提交测试**

```powershell
git add tests/plugin-main-ai.test.js
git commit -m "test: cover xiaohongshu captured reply merging"
```

### Task 2: 归类并合并真实浏览器评论响应

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 实现纯函数**

新增 `mergeXiaohongshuCapturedCommentPayloads(payloads, limit)`：识别 `comment/page` 和 `comment/sub/page`，解析请求 URL 中的 `root_comment_id`，先收集主评论，再调用 `mergeXiaohongshuReplyPages` 按父 ID 合并；没有父 ID 的响应只进入平铺兜底集合。

- [ ] **Step 2: 接入 Debugger 响应体**

保存真实评论响应的 URL、请求 ID 和响应文本；`Network.loadingFinished` 获取响应体后交给新的归类函数。渲染结束时把真实归类结果放在 DOM 和手工 API 结果之前合并，并将诊断来源标为 `browser-network`。

- [ ] **Step 3: 扩展折叠回复触发器**

在评论区域内点击包含“展开/查看/更多/回复/评论”的回复展开控件，覆盖动态 class、`role=button` 和 `data-testid` 控件；每轮滚动后等待网络响应，再继续收集。

- [ ] **Step 4: 运行测试并确认通过**

运行：`node tests/plugin-main-ai.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`git diff --check`。

### Task 3: 发布 1.3.26

**Files:**
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: `tests/plugin-marketplace-package.test.js`

- [ ] **Step 1: 更新版本元数据**

将两份 manifest 更新为 `1.3.26`，两份 versions 增加 `"1.3.26": "1.0.0"`，并同步市场测试期望版本。

- [ ] **Step 2: 发布前回归**

运行：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`git diff --check`。

- [ ] **Step 3: 推送并发布**

```powershell
git add manifest.json versions.json obsidian-plugin/wechat-inbox-sync/manifest.json obsidian-plugin/wechat-inbox-sync/versions.json tests/plugin-marketplace-package.test.js
git commit -m "chore: release plugin 1.3.26"
git push origin HEAD:main
git tag 1.3.26
git push origin 1.3.26
```

- [ ] **Step 4: 运行发布检查**

生成 `C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.26.zip`，运行插件发布检查脚本，确认默认分支、Release、资产和本地 zip 全部为 `1.3.26`。
