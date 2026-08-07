# 插件 AI 元数据纯格式化拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI 元数据的四项纯字符串/对象计算抽为独立模块，行为与第三阶段历史候选完全一致。

**Architecture:** 新模块只通过显式依赖取得 `tryParseJson`、Markdown 清理和代码块剥离能力。主入口配置并解构工厂结果，继续拥有 AI 请求、限流、同步和写入副作用；测试从 `1a9c8d6e` 历史主文件取得独立基线。

**Tech Stack:** Node.js、CommonJS、现有插件构建脚本、Node `assert`。

---

### Task 1: 建立独立历史基线的失败测试

**Files:**
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 引入待创建模块与历史基线加载器**

在测试文件顶部加入：

```js
const { createAiMetadataHelpers } = require('../obsidian-plugin/wechat-inbox-sync/src/ai-metadata-utils');
```

从 `git show 1a9c8d6e:obsidian-plugin/wechat-inbox-sync/main.js` 读取历史生成物，把四个目标函数和三个依赖函数临时加入 `PluginClass.__test`，并断言每个导出均为函数。

- [ ] **Step 2: 写入对照用例**

创建 `runAiMetadataFormattingModuleTests()`：候选工厂注入历史基线的 `tryParseJson`、`cleanMarkdownForStorage`、`stripMarkdownCodeBlocks`。比较数组/逗号字符串关键词、普通 JSON、fenced JSON、标签式文本、空文本、300 字简介截断、网页记录与转写记录输入文本；每个 record 在调用后使用 JSON 快照断言未变。

- [ ] **Step 3: 运行并确认红灯**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL with `Cannot find module '../obsidian-plugin/wechat-inbox-sync/src/ai-metadata-utils'`.

- [ ] **Step 4: 提交测试红灯**

```powershell
git add tests/plugin-main-ai.test.js
git commit -m "test: define ai metadata formatting parity"
```

### Task 2: 实现最小纯模块并接回主入口

**Files:**
- Create: `obsidian-plugin/wechat-inbox-sync/src/ai-metadata-utils.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 创建显式依赖工厂**

创建：

```js
'use strict';

function createAiMetadataHelpers(dependencies = {}) {
  const { tryParseJson, cleanMarkdownForStorage, stripMarkdownCodeBlocks } = dependencies;
  if (typeof tryParseJson !== 'function' || typeof cleanMarkdownForStorage !== 'function' || typeof stripMarkdownCodeBlocks !== 'function') {
    throw new TypeError('AI metadata helpers require pure parsing dependencies');
  }
  // 保留现有四个函数的逐字实现并返回它们。
}

module.exports = { createAiMetadataHelpers };
```

函数实现只能移动既有逻辑：关键词清洗、返回解析、结果截断、输入文本提取；不得新增字段、规则或副作用。

- [ ] **Step 2: 在主入口配置工厂**

在 `src/main.js` 引入并在原函数区域配置：

```js
const aiMetadataHelpers = createAiMetadataHelpers({
  tryParseJson,
  cleanMarkdownForStorage,
  stripMarkdownCodeBlocks,
});
const {
  normalizeGeneratedKeywords,
  parseGeneratedMetadataResponse,
  normalizeGeneratedMetadataResult,
  extractAiMetadataInputText,
} = aiMetadataHelpers;
```

删除原四个函数定义，不移动 `shouldGenerateAiMetadata` 或任何调用位置。

- [ ] **Step 3: 运行测试并确认绿灯**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS.

- [ ] **Step 4: 提交最小抽取**

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/main.js obsidian-plugin/wechat-inbox-sync/src/ai-metadata-utils.js tests/plugin-main-ai.test.js
git commit -m "refactor: isolate ai metadata formatting"
```

### Task 3: 构建、记录和独立审查

**Files:**
- Modify: `docs/PLUGIN_CODE_MAP_1.3.74.md`
- Modify: `docs/task-cards/plugin-ai-metadata-formatting-001.md`

- [ ] **Step 1: 记录边界**

代码地图说明新模块只拥有四项纯计算；主入口仍拥有请求、错误、同步、写入和版本身份。本地候选未发布。

- [ ] **Step 2: 运行完整本地验收**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
Push-Location obsidian-plugin/wechat-inbox-sync; & 'D:\AIbc\npm.cmd' run build; & 'D:\AIbc\npm.cmd' run check; Pop-Location
node --check obsidian-plugin/wechat-inbox-sync/src/main.js
node --check obsidian-plugin/wechat-inbox-sync/src/ai-metadata-utils.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: all commands exit 0; manifest/version and release files have no diff.

- [ ] **Step 3: 提交本地候选并请求独立审查**

```powershell
git add docs/PLUGIN_CODE_MAP_1.3.74.md docs/task-cards/plugin-ai-metadata-formatting-001.md docs/superpowers/specs/2026-08-01-plugin-ai-metadata-formatting-design.md docs/superpowers/plans/2026-08-01-plugin-ai-metadata-formatting.md
git commit -m "docs: record ai metadata refactor candidate"
```

独立审查必须检查历史基线是否真实独立、四项函数范围、输入不变、构建结果和禁止发布边界。
