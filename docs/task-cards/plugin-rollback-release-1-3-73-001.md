<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-rollback-release-1-3-73-001
- 标题：将插件功能代码回滚到 1.3.71 并发布为 1.3.73
- 创建日期：2026-07-29
- 类型：修复、发布
- 状态：进行中
- 风险等级：L3
- 所属阶段：插件稳定性
- 是否当前主线：否
- 所属支线：plugin-rollback-release
- 父主线：H2-002
- 分支：codex/plugin-rollback-1.3.73
- Worktree：.worktrees/plugin-sync-placeholder-hotfix
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/main.js；obsidian-plugin/wechat-inbox-sync/manifest.json；obsidian-plugin/wechat-inbox-sync/versions.json；obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md；manifest.json；versions.json；tests/plugin-main-ai.test.js；tests/plugin-marketplace-package.test.js；docs/task-cards/plugin-rollback-release-1-3-73-001.md；docs/WORKLOG.md
- 环境或发布链路占用：obsidian-plugin/wechat-inbox-sync@1.3.73
- 紧急事实：1.3.72 上线后出现小红书无结果与重复进度占位的真实用户反馈，负责人要求先恢复 1.3.71 已知行为。
- 事故授权范围：只允许把 1.3.71 插件功能代码以 1.3.73 身份重新发布；禁止夹带并发、图片去重或其他功能修复。

## 目标

发布 1.3.73，其 `main.js` 除运行版本号外与 1.3.71 完全一致，先恢复已知可用行为。

## 非目标

本任务不修复并发同步、不重新设计图片/OCR 去重、不修改 CloudBase、小程序、用户数据、绑定或 Pro 权益。

## 前置事实与证据

权威公开仓库为 `https://github.com/mingjuner123-spec/wechat-inbox-sync.git`；远端默认分支为 `main`，开工时为 `5cae20b681597e18d69d9d540c4884cd9146b0f6`，1.3.73 远端标签尚不存在。1.3.72 相对 1.3.71 的插件运行代码变化仅为版本身份和小红书图片/OCR 去重。

## 禁止动作

禁止覆盖已有 tag/Release；禁止登录 GitHub 网页；禁止部署 CloudBase/CDN；禁止修改真实用户数据；禁止把尚未验证的并发或去重修复夹入 1.3.73。

## 分支与 Worktree

只在本卡声明的分支和隔离 Worktree 工作；候选基于权威 `origin/main@5cae20b6`。

## 作者、审稿与验证

主 Agent 完成精确回滚、测试和受控发布；一名独立 Agent 审查功能代码是否与 1.3.71 等价、是否夹带改动及版本身份是否一致。负责人已在当前对话明确授权直接发布 1.3.73。

## 验收

- `main.js` 将版本号规范化后与 1.3.71 字节级一致。
- `styles.css` 与 1.3.71 字节级一致。
- 插件核心、市场包、发布治理、语法和版本身份检查通过。
- 远端 main、annotated tag、Release 与五项资产全部指向同一 1.3.73 候选提交。

## 纠偏记录

最初把 macOS ASR 仓库提交误描述为首次进入 1.3.72 插件安装包；核对五项 Release 资产与提交差异后确认该修复未改变插件 `main.js`，本次仅回滚 1.3.72 的小红书运行代码，不撤销现有 ASR CDN 修复。

独立终审确认 `P0=0 / P1=0 / P2=0`，结论 PASS；候选运行代码与 1.3.71 仅有版本身份差异，未夹带并发或其他修复。

## 已知风险

1.3.71 原有的并发同步与图片重复问题仍会保留；这是负责人明确选择的短期止损边界，后续只在本地候选中修复。

## 唯一下一步

将 1.3.72 的小红书运行代码精确恢复到 1.3.71，并更新 1.3.73 发布身份。

## 是否需要负责人决定

否；负责人已明确授权本次回滚发布。
