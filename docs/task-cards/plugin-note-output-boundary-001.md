<!-- HARNESS_TASK_CARD_V1 -->

# 插件笔记输出边界拆分：第二阶段

- 任务 ID：plugin-note-output-boundary-001
- 标题：插件笔记输出边界拆分（第二阶段）
- 创建日期：2026-08-01
- 类型：重构
- 状态：已完成
- 风险等级：L2
- 所属阶段：插件本地架构整理第二阶段
- 是否当前主线：否
- 所属支线：plugin-note-output-boundary
- 父主线：H2-002
- 分支：codex/plugin-note-output-boundary
- Worktree：.worktrees/plugin-note-output-boundary
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/src/note-output-plan-utils.js；tests/plugin-main-ai.test.js；docs/PLUGIN_CODE_MAP_1.3.74.md；docs/superpowers/specs/2026-08-01-plugin-note-output-boundary-design.md；docs/superpowers/plans/2026-08-01-plugin-note-output-boundary.md
- 环境或发布链路占用：无
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

将 Obsidian 插件的“笔记输出计划”从主入口中抽成纯函数：在不改变现有笔记标题、前言、正文、记录标记和目标 Markdown 路径的前提下，让这些结果可被独立回归测试。实际附件下载、网页处理、AI 元数据、Vault 写入和同步状态变更继续留在主入口。

## 非目标

不改变任何产品功能、同步队列、云端记录删除、小红书、飞书、ASR/OCR、设置、权限、网络请求、Obsidian Vault 写入时序或任何发布资产；不发布、部署、上传或接触真实用户数据。

## 前置事实与证据

基线为公开正式版本 1.3.75（`893ff828580de89697dcc3652f93f464ae0229be`）。已确认 `src/main.js` 的 `writeRecord` 同时承载附件/网页/AI 副作用与末尾 Markdown/路径组装；本任务只抽取后者，并以现有 `buildMarkdownForRecord`、`buildRecordFrontmatter` 的输出保持字节等价为首要约束。

## 禁止动作

禁止修改根目录发布镜像、版本号、manifest、versions、发布工作流；禁止 push、合并、创建 Release、部署 CloudBase、写入云端记录、读取真实环境或替换用户正在使用的本地插件。

## 分支与 Worktree

唯一分支 `codex/plugin-note-output-boundary`，唯一 Worktree `.worktrees/plugin-note-output-boundary`。修改边界只引用上方 allowedPaths，不建立第二份文件所有权清单。

## 作者、审稿与验证

L2：作者完成定向 TDD、构建与回归；一名未参与实现的独立 Agent 审查边界、行为等价与失败路径。审稿不得扩大范围；用户此前要求由子 Agent 负责审稿。

## 验收

新增纯函数回归覆盖文本、链接、网页、语音、文件五种笔记输出计划，覆盖自定义属性字段、隐藏记录标记、AI 错误标记及根目录/按日期目录两种保存路径；现有主入口仍通过 `node tests/plugin-main-ai.test.js`、`npm run check`、`node --check obsidian-plugin/wechat-inbox-sync/src/main.js` 与 `git diff --check`。仅交付本地候选，不进行发布。

## 纠偏记录

已在独立 Worktree 完成：先观察模块缺失和主入口未接线两次预期红灯；随后新增纯输出模块、将 writeRecord 最后的 Markdown/路径组装接到该模块，并删除主入口重复的输出实现。完整本地回归、市场包、构建、语法和 diff 检查通过。独立 L2 审查完成：P0=0、P1=0、P2=0；文本、链接、网页、语音、文件、飞书与自定义字段的 Markdown/路径均与 1.3.75 基线等价，副作用顺序未移动。

## 已知风险

笔记 Markdown 的历史格式兼容性高；如果任何既有断言或候选输出发生非预期变化，立即停止拆分、恢复到本任务开始提交，并只记录差异，不外发。

## 唯一下一步

本地候选 `codex/plugin-note-output-boundary@bf1d4885` 已交付负责人手工验收；保持分支和 Worktree，不推送、不合并、不发布。手工验收通过后，另立发布任务决定是否纳入正式版本。

## 是否需要负责人决定

否；只有发现必须改变用户可见笔记格式、Vault 写入顺序或需要发布时才请求决定。
