# 小红书评论完整采集与去重 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让插件通过小红书页面真实签名请求采集最多 200 条主评论及其折叠回复，消除 API/DOM 重复，并保证最终 Markdown 和诊断数量一致。

**Architecture:** 以浏览器网络响应构建权威评论树，DOM/静态 HTML 只补缺；页面层滚动实际评论容器以触发官方签名分页；合并后一次性渲染 Markdown，并在最终存储阶段保留子列表缩进。所有行为先用纯函数和源码契约回归测试锁定。

**Tech Stack:** Obsidian desktop plugin、Electron BrowserWindow/Debugger Network API、JavaScript、Node `assert` 回归测试、PowerShell 发布脚本。

---

### Task 1: 锁定跨来源去重和回复归属契约

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing tests**

新增以下断言：

```js
const mergedSources = helpers.mergeXiaohongshuCommentSources({
  networkComments: [{
    id: 'root-1', author: '用户甲', content: '同一条评论', time: '1780000000000',
    replies: [{ id: 'reply-1', author: '用户乙', content: '折叠回复' }],
  }],
  fallbackGroups: [[
    { author: '用户甲', content: '同一条评论', time: '1天前上海' },
    { author: '用户乙', content: '折叠回复', time: '1天前广东' },
    { author: '用户丙', content: '真正新增评论', time: '刚刚' },
  ]],
  limit: 200,
});
assert.strictEqual(mergedSources.comments.length, 2);
assert.strictEqual(mergedSources.comments[0].replies.length, 1);
assert.strictEqual(mergedSources.dedupedFallbackCount, 2);
```

再加入“子回复响应先到、主评论响应后到”和“未知 root ID 不得平铺成主评论”的 fixture。

- [ ] **Step 2: Run tests and verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，提示 `mergeXiaohongshuCommentSources` 不存在或孤立回复行为不符合契约。

- [ ] **Step 3: Implement the minimal pure merge layer**

在 `main.js` 中实现标准化正文键、网络评论/回复索引、DOM 补缺和未归属回复统计；导出测试 helper。

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix: canonicalize xiaohongshu comment merging"
```

### Task 2: 锁定最终 Markdown 层级与诊断一致性

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing tests**

```js
const nestedMarkdown = helpers.cleanMarkdownForStorage(
  helpers.buildSocialCommentsMarkdown([{
    id: 'root-1', author: '主评论', content: '正文',
    replies: [{ id: 'reply-1', author: '回复者', content: '回复正文' }],
  }]),
  { preserveListIndent: true },
);
assert.ok(nestedMarkdown.includes('\n  - ↳ **回复者**：回复正文'));

const finalStats = helpers.getSocialCommentTreeStats([{ content: '正文', replies: [{ content: '回复正文' }] }]);
assert.deepStrictEqual(finalStats, { rootCount: 1, replyCount: 1 });
```

诊断测试同时断言包含网络/最终计数，且不包含 Cookie、Token 或评论正文。

- [ ] **Step 2: Run tests and verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，因为存储清理会删除缩进，诊断只有单阶段数量。

- [ ] **Step 3: Preserve indentation and build final diagnostics**

给 `cleanMarkdownForStorage` 增加 `preserveListIndent`，只保留列表行原始前导空格；构建网页正文时对小红书启用。新增最终树统计并让诊断包含原始/最终指标。

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix: preserve xiaohongshu reply hierarchy"
```

### Task 3: 驱动真实评论容器分页并记录阶段诊断

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Write the failing source-contract tests**

断言渲染脚本包含：可滚动评论容器评分、`scrollTop` 推进、`scroll`/`wheel` 事件、连续空闲轮次退出、网络响应计数和未归属回复计数；同时断言不再只用固定 `window.scrollBy` 驱动评论分页。

- [ ] **Step 2: Run tests and verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，因为 `1.3.26` 只固定滚动 `window`，且没有分阶段指标。

- [ ] **Step 3: Implement condition-driven browser collection**

在隐藏页面脚本中定位评论列表及其可滚动祖先；每轮点击展开控件、推进容器、等待网络/DOM变化。Debugger 保存根评论页和回复页的响应 URL、请求关联和安全状态；完成后用 Task 1 的权威合并层生成最终评论。

- [ ] **Step 4: Run focused verification**

Run:

```powershell
node tests/plugin-main-ai.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: all commands exit 0。

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix: drive signed xiaohongshu comment pagination"
```

### Task 4: 发布 1.3.27 并校验市场链路

**Files:**
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: `tests/plugin-marketplace-package.test.js`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Write the failing release test**

将市场包测试期望版本改为 `1.3.27`，运行后确认因 manifest 仍为 `1.3.26` 而失败。

- [ ] **Step 2: Update release metadata and work log**

把两份 manifest 更新为 `1.3.27`，两份 versions 增加 `"1.3.27": "1.0.0"`，按任务收尾模板记录改动、验证、发布、风险与真实用户测试点。

- [ ] **Step 3: Run full release verification**

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: all commands exit 0。

- [ ] **Step 4: Commit, push and create release**

提交 `1.3.27` 版本资产，将当前分支推送到 `origin/main`，创建并推送标签 `1.3.27`，使用仓库既有 GitHub Release 工作流生成 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 ZIP。

- [ ] **Step 5: Verify marketplace release**

```powershell
& "$env:USERPROFILE\.codex\skills\obsidian-plugin-release-check\scripts\check_obsidian_release.ps1" `
  -Repo "mingjuner123-spec/wechat-inbox-sync" `
  -ExpectedVersion "1.3.27" `
  -LocalZip "$env:USERPROFILE\Desktop\wechat-inbox-sync-1.3.27.zip" `
  -RepoPath "." `
  -DefaultBranch main
```

Expected: default branch、raw manifest、tag、Release assets 和本地 ZIP 全部报告 `1.3.27`。

