# 飞书 Markdown 纯格式化模块拆分实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变任何飞书笔记输出和刷新判断的前提下，把纯 Markdown 格式化规则迁出插件主入口。

**Architecture:** 新增无外部依赖的 CommonJS 纯函数模块。`src/main.js` 只导入四个跨边界函数，内部 helper 不对外暴露；构建后仍交付单一 `main.js`。

**Tech Stack:** Node.js、CommonJS、现有 esbuild、Node assert 回归测试。

---

### Task 1: 锁定模块合同

**Files:**
- Create: `tests/plugin-feishu-markdown-utils.test.js`

- [ ] **Step 1: 写模块缺失红灯测试**

测试直接 `require('../obsidian-plugin/wechat-inbox-sync/src/feishu-markdown-utils')`，并用固定样本断言四个公开函数：`- 正文`、`# 一、项目背景`、含 Bash 代码块的清洗结果、完整与疑似截断正文的布尔结果。

- [ ] **Step 2: 运行测试确认正确红灯**

Run: `node tests/plugin-feishu-markdown-utils.test.js`

Expected: FAIL，原因是 `MODULE_NOT_FOUND`，不是语法或样本错误。

### Task 2: 最小等价迁移

**Files:**
- Create: `obsidian-plugin/wechat-inbox-sync/src/feishu-markdown-utils.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`

- [ ] **Step 1: 原样迁移函数簇**

从 `stripMarkdownCodeBlocks` 到 `postProcessFeishuMarkdown` 整段迁入新模块，不修改任何正则、阈值、噪声词或调用顺序。在模块末尾只导出：

```js
module.exports = {
  normalizeFeishuMarkdownLine,
  formatFeishuHeadingLine,
  postProcessFeishuMarkdown,
  isFeishuMarkdownLikelyTruncated,
};
```

- [ ] **Step 2: 主入口改为单向导入**

在 `src/main.js` 顶部加入：

```js
const {
  normalizeFeishuMarkdownLine,
  formatFeishuHeadingLine,
  postProcessFeishuMarkdown,
  isFeishuMarkdownLikelyTruncated,
} = require('./feishu-markdown-utils');
```

删除主文件原函数簇，其他调用点不改。

- [ ] **Step 3: 运行定向测试确认绿灯**

Run: `node tests/plugin-feishu-markdown-utils.test.js`

Expected: PASS，退出码 0。

### Task 3: 构建和完整回归

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: 生成正式 bundle**

Run: `npm.cmd run build`（工作目录 `obsidian-plugin/wechat-inbox-sync`）

Expected: `plugin build completed`，退出码 0。

- [ ] **Step 2: 运行回归和语法检查**

Run:

```powershell
node tests/plugin-feishu-markdown-utils.test.js
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/src/feishu-markdown-utils.js
node --check obsidian-plugin/wechat-inbox-sync/src/main.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
npm.cmd run check
git diff --check
```

Expected: 全部退出码 0。

- [ ] **Step 3: 验证重复构建稳定**

连续构建两次并计算 `obsidian-plugin/wechat-inbox-sync/main.js` SHA-256。

Expected: 两次哈希完全一致。

### Task 4: 独立审查和本地交付

**Files:**
- Modify after review only if needed: task allowed paths

- [ ] **Step 1: 独立审查**

审查基线 `8e7b070e4ddd81836a75c5bc8e85c008c38be5a7` 至候选 HEAD，检查正则逐字等价、依赖方向、调用点和测试充分性。

- [ ] **Step 2: 修复全部 P0/P1/P2 并重跑验证**

Expected: P0/P1/P2 均为 0，所有受影响命令重新退出 0。

- [ ] **Step 3: 形成干净本地提交**

只提交本阶段允许路径；不推送、不发布、不部署、不替换本机插件。
