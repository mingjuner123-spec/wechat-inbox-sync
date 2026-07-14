# 小红书评论区完整采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在插件中按登录会话分页采集最多 200 条小红书主评论及其折叠回复，并准确标识未完整的采集结果。

**Architecture:** 将评论 ID、分页状态、响应解析和诊断从当前“单次请求重放”拆出为纯函数；Electron 页面层只负责使用同一登录会话执行分页请求、捕获响应和 DOM 兜底；合并层按 ID 构建评论树并输出诊断。

**Tech Stack:** Obsidian desktop plugin、Electron session/debugger、Node `assert` 回归测试。

---

### Task 1: 建立 200 条分页与 ID 去重的回归契约

**Files:**

- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:5485-5900`

- [ ] **Step 1: Write the failing test**

新增 fixture，模拟四页 `comments`，每页 50 条、前三页 `has_more=true` 且 cursor 前进；断言分页聚合函数返回 200 条。再输入同一作者同一内容但 ID 分别为 `a`、`b` 的评论，断言两条都保留。

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，因为当前代码没有导出的分页聚合函数，且现有合并上限为 50。

- [ ] **Step 3: Write minimal implementation**

新增 `XIAOHONGSHU_ROOT_COMMENT_LIMIT = 200`、评论 ID 读取与稳定去重键、分页响应元数据读取和纯分页聚合函数。保留没有 ID 的旧数据兼容路径。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

Run: `git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js && git commit -m "feat: paginate xiaohongshu root comments"`

### Task 2: 建立折叠回复分页与线程保留契约

**Files:**

- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:5485-5900`

- [ ] **Step 1: Write the failing test**

新增根评论含 `sub_comment_count=3`、首屏仅一条回复、两页回复响应的 fixture；断言合并结果的同一父评论含三条回复，并且 Markdown 是嵌套列表。

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，因为当前实现不会规划或合并回复分页。

- [ ] **Step 3: Write minimal implementation**

新增回复分页请求描述与响应合并纯函数；以 root comment ID 归属回复，以 reply ID 去重，保留没有 ID 的兼容去重键。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

Run: `git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js && git commit -m "feat: collect xiaohongshu collapsed replies"`

### Task 3: 在登录页面会话中执行分页并保留诊断

**Files:**

- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:5815-7340`

- [ ] **Step 1: Write the failing test**

断言插件源包含主评论 200 条上限、页面内 `credentials: 'include'`、根评论分页和回复分页请求路径，以及不会将 Cookie 或授权头写入诊断。用纯诊断函数断言 cursor 缺失和安全上限能产生明确 stop reason。

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，因为当前页面脚本仅滚动和重放已捕获请求，未执行受控分页。

- [ ] **Step 3: Write minimal implementation**

在隐藏 Electron 页中加入同源评论分页脚本：主评论最多 200 条，逐页按 cursor 终止；为有隐藏回复的根评论执行回复分页；合并网络响应、页面 API 与 DOM 结果。生成无敏感信息的诊断，并在 Markdown 结尾附加 HTML 注释。

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

Run: `git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js && git commit -m "feat: collect paged xiaohongshu comments"`

### Task 4: 发布前回归、版本与市场校验

**Files:**

- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `tests/plugin-marketplace-package.test.js`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Write the failing release-version test**

更新市场包回归断言到新补丁版本，并先运行使其因 manifest 仍是旧版本而失败。

- [ ] **Step 2: Update release assets and work log**

将插件与根目录镜像 manifest、versions 更新到下一个补丁版本；按 `docs/TASK_CLOSEOUT_TEMPLATE.md` 写入改动、验证、风险与真实样本验证项。

- [ ] **Step 3: Run focused and package verification**

Run: `node tests/plugin-main-ai.test.js; node tests/plugin-marketplace-package.test.js; node --check obsidian-plugin/wechat-inbox-sync/main.js; git diff --check`

Expected: all commands exit 0.

- [ ] **Step 4: Commit and publish**

Run: `git add obsidian-plugin/wechat-inbox-sync/main.js obsidian-plugin/wechat-inbox-sync/manifest.json obsidian-plugin/wechat-inbox-sync/versions.json manifest.json versions.json tests/plugin-main-ai.test.js tests/plugin-marketplace-package.test.js docs/WORKLOG.md docs/superpowers && git commit -m "release: xiaohongshu comment pagination" && git push origin HEAD:main && git tag <version> && git push origin <version>`

- [ ] **Step 5: Verify marketplace release**

Run: `node scripts/verify-obsidian-release.js --version <version>`

Expected: default branch, tag, release assets and raw manifest all match the released version.
