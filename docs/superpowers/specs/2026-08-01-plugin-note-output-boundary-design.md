# 插件笔记输出边界：第二阶段设计

## 问题

当前插件的 `writeRecord` 负责从同步记录到实际文件的整段流程：创建目录、下载附件、网页处理、AI 元数据、选择标题、生成 Markdown、计算笔记路径，以及调用 Obsidian Vault 写入。它是稳定的核心，但职责过多，任何只改笔记格式的需求都必须进入近两万行主文件并经过整段流程，定位和回归成本都很高。

第一阶段已把低耦合工具函数迁到 `src/` 并固定构建；第二阶段只继续处理其中最容易独立验证的一小段：**最后一次标题确定后，如何得到 Markdown 和目标笔记路径。**

## 目标与不变量

- 现有笔记的 frontmatter、正文、隐藏记录 ID 标记、AI 错误标记和路径保持完全相同。
- 已有的“文本、链接、网页、语音、文件”五类记录仍使用同一份正文规则。
- `Unsupported record type` 等既有错误语义保持不变。
- `writeRecord` 的副作用顺序不变：目录、附件、网页、AI、输出计划、Vault 写入、随后同步标记。
- 本阶段只产出本地候选；不发布、不上传、不部署、不替换用户插件。

## 方案

新增 `src/note-output-plan-utils.js`，提供一个依赖显式传入的纯函数工厂 `createNoteOutputPlanHelpers(dependencies)`。

它接收当前已经稳定存在的辅助能力（记录 ID、URL 清洗、来源名称、网页/文件正文构建、AI 错误标记、属性字段标准化、Vault 路径标准化等），并返回三类纯函数：

1. `buildRecordFrontmatter(...)`：保留当前字段顺序、飞书清洗和 YAML 转义。
2. `buildMarkdownForRecord(...)`：按现有五种记录类型组装完全相同的 Markdown。
3. `buildNoteOutputPlan(...)`：在给定 `record`、最终 `title`、`syncedAt`、`noteDir` 和属性字段后，一次性返回 `{ markdown, filePath }`。

`src/main.js` 仍保留所有 I/O 与流程控制。它只在 `writeRecord` 的最后一步把已经完成处理的 `recordForMarkdown`、最终标题和目录交给输出计划，再将 plan 的 `filePath`/`markdown` 原样传给现有 `vault.adapter.write`。

```text
现有 writeRecord
  附件 / 网页 / AI / 标题选择 / Markdown / 路径 / Vault 写入

第二阶段后
  writeRecord
    附件 / 网页 / AI / 标题选择
       ↓
    note-output-plan-utils（纯计算）
       ↓ { markdown, filePath }
    现有 Vault 写入 / 同步标记
```

## 为什么不直接抽走“保存文件”

`Vault` 写入与目录创建、附件下载、重复检查和同步状态相连，是容易造成用户笔记丢失或重复的副作用区。本轮不碰它。纯输出计划给后续需要改 frontmatter、文件命名或展示格式的工作提供稳定接口，同时不改变当前数据链路。

## 不采用的方案

1. **只包一层空函数。** 改动虽小，但不减少主文件复杂度，也不能独立测试输出兼容性。
2. **一次性抽走附件和真实写入。** 边界太大，会触及转写、网页、小红书和 Obsidian 文件系统，违反本阶段“本地、低风险、无功能变化”的目的。
3. **重新设计 Markdown 格式。** 会改变已有用户笔记，不是重构，应另立产品任务。

## 测试与验收

- 对每一类记录建立固定输入和历史输出断言，确保模块输出与当前格式一致。
- 覆盖 `noteSaveMode=root` 和按日期保存；验证自定义属性字段、隐藏记录标记与 AI 错误标记。
- 现有 `plugin-main-ai` 回归必须通过，保证 `writeRecord` 仍只在输出计划之后执行原有写入。
- 运行构建检查、语法检查和 diff 检查。
- 实现完成后由独立 Agent 审查：输出是否纯、依赖是否最小、是否意外移动了任何副作用。

## 回退

第二阶段不会接触线上版本。若本地候选测试中发现输出差异，直接放弃候选分支；1.3.75 正式发布基线和用户当前本地插件均不受影响。
