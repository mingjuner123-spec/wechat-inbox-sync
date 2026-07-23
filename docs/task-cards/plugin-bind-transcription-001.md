<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-bind-transcription-001
- 标题：体验 Pro 额外绑定与本地转写进度/暂停修复
- 创建日期：2026-07-23
- 类型：修复
- 状态：准备中
- 风险等级：L2
- 所属阶段：设计与离线实现
- 是否当前主线：否
- 所属支线：plugin-bind-transcription
- 父主线：H2-002
- 分支：codex/plugin-bind-transcription
- Worktree：.worktrees/plugin-bind-transcription
- 文件所有权：docs/task-cards/plugin-bind-transcription-001.md；docs/superpowers/specs/2026-07-23-plugin-bind-transcription-design.md；docs/superpowers/plans/2026-07-23-plugin-bind-transcription.md；obsidian-plugin/wechat-inbox-sync/main.js；obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1；obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh；tests/plugin-main-ai.test.js；tests/plugin-marketplace-package.test.js
- 环境或发布链路占用：无

## 目标

离线实现并验证：有效绑定码遇到服务端配额限制时不再误报为无效；本地转写有阶段、心跳和可见的暂停入口。体验 Pro 额度与到期收敛由独立私有云函数任务实现。

## 非目标

不部署、不发布、不读取生产用户数据；不做跨平台冻结并从中断位置恢复的“真暂停”。

## 前置事实与证据

体验计划未计入现有绑定配额；服务端配额限制与失效码均返回 403；ASR 进度仅在预处理完成和每段完成后更新。

## 禁止动作

禁止部署云函数、修改线上数据、调用真实绑定码、发布插件、创建 GitHub Release、变更密钥或生产环境配置。

## 分支与 Worktree

唯一分支 `codex/plugin-bind-transcription`，唯一 Worktree `.worktrees/plugin-bind-transcription`。只允许改写已登记路径。

## 作者、审稿与验证

作者：plugin-bind-transcription-001。独立安全审稿、测试审稿与最终验证均待分配。

## 验收

覆盖体验 Pro 有效/过期、正式 Pro、无 Pro；覆盖无效码与配额限制的不同提示；覆盖转写准备、活跃心跳、暂停及重试语义；运行离线 Node 测试和语法检查。

## 纠偏记录

暂无。

## 已知风险

部署后才会影响真实用户；Windows/macOS 的进程树终止需要分别验证。

## 唯一下一步

完成设计双审稿。

## 是否需要负责人决定

否；若需要部署或发布，将单独请求明确批准。
