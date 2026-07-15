# 小红书单一评论树 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or implement inline with strict TDD. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把小红书评论从多阶段重复合并改成单一权威评论图，消除已捕获回复在最终 Markdown 中丢失、跨来源重复以及回复增长掩盖主评论停滞的问题。

**Architecture:** 浏览器真实签名响应建立权威评论图；DOM/静态 HTML 只补缺。隐藏浏览器返回图后，同步主流程通过唯一收尾函数同时生成最终树、Markdown 和守恒诊断，不再二次通用合并。主评论与回复使用独立进展计数。

**Tech Stack:** Obsidian desktop plugin、Electron BrowserWindow/Debugger、JavaScript、Node `assert`、PowerShell。

---

### Task 1: 锁定单次收尾和跨来源身份契约

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] 新增生产形态失败用例：74 根/19 回复经过最终收尾仍为 74/19；静态 HTML 中 `[doge]`/无 emoji 和相对时间副本不得新增根评论。
- [ ] 新增不同网络 ID、相同正文必须同时保留的失败用例。
- [ ] 运行 `node tests/plugin-main-ai.test.js` 并确认失败来自缺少唯一收尾入口或结果不守恒。
- [ ] 实现 `finalizeXiaohongshuComments` 和展示型 emoji 标准化，导出测试 helper。
- [ ] 把同步主流程改为只调用该入口一次；隐藏浏览器已有评论时不再与初始静态 HTML二次通用合并。
- [ ] 重跑聚焦测试确认通过。

### Task 2: 锁定主评论独立进展和 partial 状态

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] 新增失败用例：根评论/根请求不变但回复增长时，主评论 `progressed` 必须为 false。
- [ ] 新增失败用例：平台仍有更多页而根评论空闲结束时，完整性状态必须为 partial。
- [ ] 运行聚焦测试确认红灯。
- [ ] 提取纯进展判定 helper，并在隐藏浏览器循环中分别统计根评论、回复和网络请求。
- [ ] 给回复展开保留独立收尾轮次；更新停止原因与安全诊断字段。
- [ ] 重跑聚焦测试确认通过。

### Task 3: 版本、回归和本地候选安装

**Files:**
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: `tests/plugin-marketplace-package.test.js`
- Modify: `docs/WORKLOG.md`

- [ ] 将本地候选版本升级为 `1.3.41`，先运行市场包测试确认版本红灯，再同步四份版本元数据。
- [ ] 运行 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 和 `git diff --check`。
- [ ] 备份当前知识库插件目录；只安装 `main.js`、`manifest.json` 和必要样式，安装前后核对 `data.json` 哈希不变。
- [ ] 更新 `docs/WORKLOG.md`，明确候选版未发布市场、真实验证条件和回退目录。

### Task 4: 真实样本验证与发布门槛

**Files:**
- Inspect: `D:/内容创作系统/张张的内容创作知识库/临时收集/2026-07-15/*.md`

- [ ] 用户重载 Obsidian 后重新同步问题小红书记录。
- [ ] 核对新笔记诊断中的 `lost_root`、`lost_replies`、`partial`、根/回复页数和停止原因。
- [ ] 核对可见 Markdown 无跨来源重复且回复缩进正确。
- [ ] 真实验证通过后再按 `obsidian-plugin-release-check` 流程发布 `1.3.41`；若未通过，保留候选不发布并按新诊断继续定位。
