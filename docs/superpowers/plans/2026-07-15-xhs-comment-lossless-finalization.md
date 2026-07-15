# 小红书评论无损收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `1.3.32` 真实样本中的主评论漏翻页、回复捕获后丢失和 Emoji 昵称重复，并发布 `1.3.33`。

**Architecture:** 浏览器签名网络评论树保持为不可减主数据，其他来源只做增量合并；滚动只驱动主评论容器，回复先缓存后归属；每个阶段用树统计和节点身份集合验证无损。

**Tech Stack:** Obsidian desktop plugin、Electron BrowserWindow/Debugger、JavaScript、Node `assert`、PowerShell 发布检查。

---

### Task 1: 锁定评论树无损契约

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] 新增失败测试：74 个根评论、19 条回复经过网络多来源和保存前二次合并后仍为 74/19；Emoji/符号昵称的 DOM 副本不新增。
- [ ] 运行 `node tests/plugin-main-ai.test.js`，确认失败原因是缺少无损合并/符号昵称后备键。
- [ ] 实现网络树恢复与标准化后备身份键，并导出必要的纯函数测试入口。
- [ ] 重跑测试确认通过，提交 `fix: preserve xiaohongshu network comment trees`。

### Task 2: 锁定主评论滚动与延迟回复归属

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] 新增失败测试/源码契约：主评论列表优先级高于 reply 容器；回复响应先到时在根评论补齐后归属；存在主评论进展时不以 DOM idle 提前停止。
- [ ] 运行聚焦测试并确认预期失败。
- [ ] 修改容器评分、采集阶段和延迟归属逻辑，保留 200/100 上限。
- [ ] 运行 `node tests/plugin-main-ai.test.js`、插件语法检查和 `git diff --check`，提交 `fix: finish xiaohongshu root and reply collection`。

### Task 3: 诊断、版本与发布

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `tests/plugin-marketplace-package.test.js`
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: `docs/WORKLOG.md`

- [ ] 新增失败断言，要求诊断含合并后数量、恢复数和最终损失数。
- [ ] 实现诊断字段并确认最终 `lost_root=0`、`lost_replies=0`。
- [ ] 把两份 manifest/versions 和市场测试升级为 `1.3.33`，按收尾模板更新工作日志。
- [ ] 运行插件核心、市场包、语法和差异检查；安装到当前知识库并核对哈希与版本。
- [ ] 提交、推送 `main`、创建 `1.3.33` 标签与 Release，运行 Obsidian 市场发布检查器。
- [ ] 发布完成后通过既有飞书通知链路发送完成消息。
