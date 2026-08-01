<!-- HARNESS_TASK_CARD_V1 -->

# 插件 AI 元数据纯格式化拆分：第四阶段

- 任务 ID：plugin-ai-metadata-formatting-001
- 标题：插件 AI 元数据纯格式化拆分（第四阶段）
- 创建日期：2026-08-01
- 类型：重构
- 状态：审核中
- 风险等级：L2
- 所属阶段：插件本地架构整理第四阶段
- 是否当前主线：否
- 所属支线：plugin-ai-metadata-formatting
- 父主线：H2-002
- 分支：codex/plugin-ai-metadata-formatting
- Worktree：.worktrees/plugin-ai-metadata-formatting
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/src/ai-metadata-utils.js；tests/plugin-main-ai.test.js；docs/PLUGIN_CODE_MAP_1.3.74.md；docs/superpowers/specs/2026-08-01-plugin-ai-metadata-formatting-design.md；docs/superpowers/plans/2026-08-01-plugin-ai-metadata-formatting.md
- 环境或发布链路占用：无
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

抽取 AI 元数据的四项纯计算，并保持第三阶段候选的关键词、解析、截断和输入文本逐字等价；请求、限流、同步、解析和写入仍留在主入口。

## 非目标

不改模型、提示词、请求、限流、同步、网页解析、ASR/OCR、附件、Vault、设置、绑定、权限、版本、manifest、根目录镜像或发布流程；不发布、部署、上传或读取真实环境/用户数据。

## 前置事实与证据

第三阶段候选 `codex/plugin-record-body-markdown@1a9c8d6e` 已独立复审 P0/P1/P2=0。目标四个函数只做纯计算，现有调用点仍由主入口处理网络、错误和同步。

## 禁止动作

禁止修改版本号、manifest、versions、根目录发布镜像、Release/CI/部署脚本；禁止 push、合并、创建 Release、部署 CloudBase、写入云端记录、访问真实环境或替换用户当前本地插件。

## 分支与 Worktree

唯一分支 `codex/plugin-ai-metadata-formatting` 从第三阶段本地候选创建；唯一 Worktree `.worktrees/plugin-ai-metadata-formatting`。

## 作者、审稿与验证

L2：作者先观察模块缺失红灯，再完成最小抽取、构建与定向回归；独立 Agent 审查范围、历史等价、输入不变和测试充分性。

## 验收

关键词、JSON/fenced JSON/标签式/空响应、结果截断、网页与转写输入文本同历史基线一致，输入不变；核心、市场包、构建、语法、diff 与 Harness 双检查全部通过。只交付本地候选。

## 纠偏记录

尚未开始实现。

## 已知风险

AI metadata 会写入用户笔记。发现任何对照差异立即停止，不得外发。

## 唯一下一步

将任务状态转为进行中后，在该隔离 Worktree 先观察模块缺失红灯，再依计划完成最小抽取和独立审查。

## 是否需要负责人决定

否；只有发现必须改变模型提示词、AI 调用策略、用户可见 metadata 或需要发布时才请求决定。
