# 小红书评论数量与时间预算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将每篇小红书笔记的评论提取限制为一级评论与回复合计最多 300 条，并让页面加载、分页、滚动、回复补抓和调试器收尾共用一个最长 90 秒的截止时间；达到任一上限后继续保存正文、图片和已获取评论。

**Architecture:** 在插件入口定义统一的评论总量和时间预算，使用纯函数裁剪评论树并计算停止原因。Electron 渲染器从开始加载页面时创建绝对截止时间，将它传入页面分页脚本和 DOM 滚动脚本；所有潜在长等待都按剩余时间竞速，超时返回部分结果而不是抛出整条同步失败。

**Tech Stack:** Obsidian desktop plugin、Electron BrowserWindow/Debugger、JavaScript、Node `assert` 回归测试。

---

### Task 1: 锁定 300 条总评论上限

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing test**

在 `tests/plugin-main-ai.test.js` 中断言插件导出的总评论上限为 300，并构造 3 条一级评论、每条 150 条回复的评论树；调用新的 `limitSocialCommentTreeTotal(comments, 300)` 后，断言 `rootCount + replyCount === 300`，原始一级评论顺序不变且输入对象未被修改。

- [ ] **Step 2: Run test to verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，提示 `XIAOHONGSHU_TOTAL_COMMENT_LIMIT` 或 `limitSocialCommentTreeTotal` 尚未定义。

- [ ] **Step 3: Implement the minimal total-tree limiter**

在 `main.js` 中增加 `XIAOHONGSHU_TOTAL_COMMENT_LIMIT = 300`，把一级评论采集上限同步提高到 300；实现 `limitSocialCommentTreeTotal`，按一级评论及其回复的现有顺序复制并裁剪评论树，所有节点合计不超过总上限。让 `finalizeXiaohongshuComments` 和 Electron 合并结果都经过该函数，并导出测试入口。

- [ ] **Step 4: Run test to verify GREEN**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

### Task 2: 锁定共享 90 秒截止时间

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing tests**

断言插件导出的 `XIAOHONGSHU_COMMENT_TIMEOUT_MS === 90000`；测试 `getXiaohongshuCommentBudgetState` 在 89,999ms 时继续、在 90,000ms 时返回 `time_budget_exceeded`、在总数达到 300 时返回 `total_limit_reached`。同时检查分页脚本包含绝对截止时间、单请求 `AbortController` 和总量停止判断，Electron 渲染源码使用 `beginBestEffortBrowserLoad` 且不再 `await win.loadURL(url)`。

- [ ] **Step 2: Run tests and verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，提示时间预算常量/纯函数缺失，或源码契约不满足。

- [ ] **Step 3: Implement shared deadline and partial-result fallback**

从 `renderXiaohongshuPageWithElectron` 开始创建 `deadlineAt = Date.now() + 90000`。页面加载只等待现有 20 秒事件窗口；分页脚本的每次请求最多 10 秒且不得越过总截止时间，根评论与回复合计达到 300 时停止；DOM 滚动脚本按相同截止时间停止；调试器响应体和签名请求补抓只等待剩余时间。任一阶段超时时设置诊断 `stop=time_budget_exceeded`、`partial=1`，返回已收集评论。

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

### Task 3: 回归验证与任务收尾

**Files:**
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Run focused and package verification**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: all commands exit 0。

- [ ] **Step 2: Review the final diff**

确认只修改 1.3.43 独立工作区中的插件主文件、插件测试、计划和工作日志；不修改 manifest/versions，不部署云函数，不发布插件。

- [ ] **Step 3: Update the work log**

按 `docs/TASK_CLOSEOUT_TEMPLATE.md` 记录目标、影响范围、修改文件、线上动作、数据变更、实际验证、结果、风险与下一步，并明确“需要后续升级版本和发布插件后用户端才生效”。
