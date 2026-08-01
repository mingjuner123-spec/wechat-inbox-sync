# 插件内容正文格式化拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将网页、文件和转写正文的纯 Markdown 计算从插件主入口抽取为可独立测试的模块，且不改变任何用户可见输出。

**Architecture:** 新建依赖注入式 `record-body-markdown-utils`；主入口将现有纯辅助函数作为依赖传入并继续使用原函数名。`writeRecord`、下载、解析、AI、同步和 Vault 写入不移动。

**Tech Stack:** Node.js CommonJS、esbuild 0.28.1、既有 Node 回归测试。

---

### Task 1: 写入正文模块的失败回归

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Create: `obsidian-plugin/wechat-inbox-sync/src/record-body-markdown-utils.js`

- [x] **Step 1: 写一个从未存在模块加载的测试**

在 `plugin-main-ai.test.js` 的模块化回归区添加：

```js
const { createRecordBodyMarkdownHelpers } = require(path.join(
  __dirname,
  '..',
  'obsidian-plugin',
  'wechat-inbox-sync',
  'src',
  'record-body-markdown-utils',
));

assert.strictEqual(typeof createRecordBodyMarkdownHelpers, 'function');
```

- [x] **Step 2: 运行并确认红灯**

运行：`node tests/plugin-main-ai.test.js`

预期：因 `record-body-markdown-utils` 不存在而报 `Cannot find module`，不是其它测试失败。

- [x] **Step 3: 追加六类等价用例**

为网页、飞书网页、视频号失败提示、转写网页、转写文件、普通文件分别保留抽取前的主入口函数输出，再用新模块同一套依赖计算输出，断言 `strictEqual`；在每个调用前后深比较输入记录，断言不变。

### Task 2: 最小纯模块和主入口桥接

**Files:**
- Create: `obsidian-plugin/wechat-inbox-sync/src/record-body-markdown-utils.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `tests/plugin-main-ai.test.js`

- [x] **Step 1: 创建工厂并强制所有依赖为函数**

实现 `createRecordBodyMarkdownHelpers`，通过 `requireFunction` 校验 `cleanDisplayUrl`、`cleanMarkdownForStorage`、`extractKeywordsFromText`、`formatCreatedTime`、`getWebpageSourcePrefix`、`isFeishuUrl`、`isWechatChannelsUrl`、`isXiaohongshuUrl`、`normalizeExtractedUrl`、`sanitizeXiaohongshuMarkdownImages`、`stripMarkdownCodeBlocks`。模块只返回六个正文函数，不导入 Obsidian 或 Node 文件/网络模块。

- [x] **Step 2: 原样移动六个函数**

只将 `buildWebpageMarkdownBody`、`buildAudioTranscriptMarkdown`、`buildSourceMediaAttachmentMarkdown`、`buildTranscriptPropertyMetadata`、`buildTranscriptOnlyMetadata`、`buildFileMarkdownBody` 的函数体移入工厂，所有旧文案、空行、条件与参数默认值保持不变；把原来对同文件辅助函数的调用改为 `helpers.<name>`。

- [x] **Step 3: 在主入口配置并解构**

在所有注入依赖已经声明的位置创建：

```js
const recordBodyMarkdownHelpers = createRecordBodyMarkdownHelpers({
  cleanDisplayUrl,
  cleanMarkdownForStorage,
  extractKeywordsFromText,
  formatCreatedTime,
  getWebpageSourcePrefix,
  isFeishuUrl,
  isWechatChannelsUrl,
  isXiaohongshuUrl,
  normalizeExtractedUrl,
  sanitizeXiaohongshuMarkdownImages,
  stripMarkdownCodeBlocks,
});
const { buildWebpageMarkdownBody, buildAudioTranscriptMarkdown, buildSourceMediaAttachmentMarkdown, buildTranscriptPropertyMetadata, buildTranscriptOnlyMetadata, buildFileMarkdownBody } = recordBodyMarkdownHelpers;
```

原调用点不改名、不移动。把这六个函数继续暴露在 `WechatObsidianInboxPlugin.__test`，使既有测试契约不变。

- [x] **Step 4: 运行绿色回归**

运行：`node tests/plugin-main-ai.test.js`

预期：新模块用例和既有插件主回归全部通过。

### Task 3: 生成物和边界验证

**Files:**
- Modify: `docs/PLUGIN_CODE_MAP_1.3.74.md`
- Modify: `docs/task-cards/plugin-record-body-markdown-001.md`

- [x] **Step 1: 构建并检查生成物**

运行：`Push-Location obsidian-plugin/wechat-inbox-sync; & 'D:\AIbc\npm.cmd' run build; & 'D:\AIbc\npm.cmd' run check; Pop-Location`

预期：`plugin build check passed`，最终 `main.js` 含新模块，且没有相对 `require`。

- [x] **Step 2: 运行全套定向验证**

运行：

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/src/main.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

预期：全部退出码为 0。

- [x] **Step 3: 更新代码地图与任务卡**

在代码地图追加第三阶段候选说明：正文模块职责、六类等价覆盖、明确未移动的副作用和“未发布”状态。任务卡记录红绿测试、构建及独立审查结果；禁止改版本/发布资产。

- [ ] **Step 4: 本地提交**

运行：

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/main.js obsidian-plugin/wechat-inbox-sync/src/record-body-markdown-utils.js obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js docs/PLUGIN_CODE_MAP_1.3.74.md docs/task-cards/plugin-record-body-markdown-001.md docs/superpowers/specs/2026-08-01-plugin-record-body-markdown-design.md docs/superpowers/plans/2026-08-01-plugin-record-body-markdown.md
git commit -m "refactor: isolate record body markdown"
```

预期：仅隔离分支产生本地提交；不推送、不合并、不发布。

## 自审

- 范围覆盖：Task 1 锁定原始输出，Task 2 仅移动纯函数，Task 3 覆盖生成物、市场包和文档交接。
- 无占位符：全部函数、依赖、文件路径和命令均已明确。
- 一致性：工厂名、六个导出名、主入口解构名和测试名保持一致；没有新版本号或外部动作。
