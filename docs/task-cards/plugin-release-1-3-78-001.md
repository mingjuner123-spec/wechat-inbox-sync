# 插件小红书评论预算与抖音标题修复 1.3.78 发布任务卡

- 任务 ID：`plugin-release-1-3-78-001`
- 创建日期：2026-08-08
- 状态：待发布（独立审查通过）
- 风险等级：L3
- 分支：`codex/plugin-release-1.3.78`
- Worktree：`.worktrees/plugin-release-1.3.78`
- 权威仓库：`https://github.com/mingjuner123-spec/wechat-inbox-sync`
- 基线版本：`1.3.77`
- 目标版本：`1.3.78`
- 外部动作：GitHub main/tag/Release 与 Obsidian 插件更新；不部署 CloudBase/CDN，不读取或修改真实用户数据

## 用户授权

用户于 2026-08-08 明确要求把小红书评论上限恢复为 300、保留原 90 秒限制，修复抖音标题与正文重复，并与小红书更新一起发布；随后要求明确需求后直接执行。

## 允许修改路径

- `.github/workflows/`
- `docs/`
- `main.js`
- `manifest.json`
- `versions.json`
- `release-candidate.json`
- `obsidian-plugin/wechat-inbox-sync/`
- `scripts/`
- `tests/`

## 回退与停止条件

- 任一目标回归、插件核心、市场包、发布治理、身份或独立审查失败，停止发布。
- 不移动、覆盖或重建既有 tag/Release；发布后修复必须再次递增版本。
- 不打开或登录小红书，不执行真实小红书页面测试。
- 不替换或修改任何 `data.json`。

## 验收标准

- 只包含评论预算恢复、抖音标题去重、版本与发布资产更新。
- 独立审查 P0/P1/P2 为 0。
- 权威 `main`、annotated tag、Release 五项资产和 ZIP 身份一致。
- 综合工程镜像由权威发布提交同步，四项 loose assets 哈希一致。

## 发布前验证

- 目标回归：小红书评论上限 300、总超时 90000ms、抖音标题与正文去重及显式标题候选优先级均通过。
- 最终非历史测试：27/27 通过。
- 既有移动端测试：6 项在未修改的 1.3.77 干净基线与本候选同样失败，确认为历史测试债，不属于本次回退。
- 发布治理：126/126 通过；发布身份：26/26 通过；候选门禁：24 通过、1 项因 Windows 无法创建符号链接而跳过。
- 候选身份：`1.3.78-a9a9be7ac748fec7`，聚合 SHA-256：`a9a9be7ac748fec780fff1cac462f2f5d9c364c27f8d4355b09c5f6883b7d378`。
- 独立审查：P0=0、P1=0、P2=0，可以发布。
