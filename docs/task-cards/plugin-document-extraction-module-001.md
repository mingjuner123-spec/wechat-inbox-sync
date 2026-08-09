<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-document-extraction-module-001
- 标题：Obsidian 插件 DOCX/PDF 文本解析模块拆分
- 创建日期：2026-08-09
- 类型：重构
- 状态：已完成
- 风险等级：L2
- 所属阶段：插件架构重构第五阶段
- 是否当前主线：否
- 所属支线：plugin-document-extraction-module
- 父主线：H2-002
- 分支：codex/plugin-document-extraction-module-1.3.79
- Worktree：.worktrees/plugin-document-extraction-module-1.3.79
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/src/document-text-extraction-utils.js；obsidian-plugin/wechat-inbox-sync/main.js；tests/plugin-document-text-extraction.test.js；tests/plugin-main-ai.test.js；docs/task-cards/plugin-document-extraction-module-001.md；docs/superpowers/specs/2026-08-09-plugin-document-extraction-module-design.md；docs/superpowers/plans/2026-08-09-plugin-document-extraction-module.md
- 环境或发布链路占用：无；仅本地源码、生成 bundle、测试和文档
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

以公开稳定 1.3.79 `5748f680434f2bca10976335f2201f59599905b4` 为唯一行为底座，把 DOCX ZIP/XML 解析和 PDF 文本层解析从 `src/main.js` 抽到独立纯模块，并保持所有成功输出、失败提示、同步流程和正式 bundle 行为不变。

## 非目标

不修改 DOCX/PDF 提取算法、用户可见 Markdown、附件保存策略、网页/社媒解析、飞书、小红书、ASR/OCR、绑定、Pro、设置、网络请求、版本、manifest、versions 或发布流程；不替换用户本机插件，不发布、不部署、不推送。

## 前置事实与证据

- 1.3.79 已正式发布并通过发布身份闭环，插件源码已有 15 个独立模块。
- 当前 `src/main.js` 仍有 20,492 行；DOCX/PDF 解析约 600 行，主要依赖 Node `Buffer`、内置 `zlib` 和现有 `cleanMarkdownForStorage`，没有 Obsidian、网络或用户状态副作用。
- `tests/plugin-main-ai.test.js` 已覆盖 PDF 正常中文文本、异常字形与清洗边界；DOCX 和独立模块接口需要补充定向回归。

## 禁止动作

禁止从综合工程脏工作区复制整包；禁止修改版本号或根目录 loose assets；禁止改变提取结果来顺便修功能；禁止创建 tag/Release、部署 CloudBase、写真实用户数据或替换本机 `data.json`。

## 分支与 Worktree

唯一分支和 Worktree 如元数据所列，从公开 1.3.79 干净提交创建。实现前运行中央 Harness 启动器；任何基线测试失败必须先停下定位，不得把历史失败带入候选。

## 作者、审稿与验证

主 Agent 按 TDD 完成模块缺失红灯、最小抽取和整体验证；一名未参与实现的独立 Agent 审查边界、输出等价、错误路径、bundle 自包含性和测试充分性。

## 验收

1. 独立模块提供 DOCX/PDF 提取与 PDF 清洗接口，并对缺失 document.xml、低质量 PDF、异常字形和正常中文内容保持原行为。
2. `src/main.js` 只装配并使用新模块，不保留重复解析实现。
3. 构建后仍只生成单一自包含 `main.js`；版本保持 1.3.79。
4. 定向模块测试、`plugin-main-ai`、市场包、构建/漂移检查、源码与产物语法、两次构建哈希和 `git diff --check` 全部通过。
5. 独立审查 P0/P1 为 0；仅交付干净本地提交，不发布、不部署、不替换本机插件。

## 纠偏记录

无。

## 已知风险

PDF 文本层格式复杂，任何输出变化都可能改变已有笔记；本阶段只移动现有实现，不调整算法。若历史对照出现差异，立即回退本任务代码并保留失败证据。

## 唯一下一步

建立隔离 Worktree，完成设计/计划与 Harness 启动；随后按 TDD 先补独立模块缺失红灯，再做最小抽取。

## 是否需要负责人决定

否；本任务执行的是负责人已批准的本地逐模块架构重构。任何功能变化、本机插件替换或发布另行处理。