# 插件同步取消与小红书登录窗口治理 1.3.79 发布任务卡

- 任务 ID：`plugin-release-1-3-79-001`
- 创建日期：2026-08-09
- 状态：发布中
- 风险等级：L3
- 分支：`codex/plugin-release-1.3.79`
- Worktree：`.worktrees/plugin-release-1.3.79`
- 权威仓库：`https://github.com/mingjuner123-spec/wechat-inbox-sync`
- 基线版本：`1.3.78`
- 目标版本：`1.3.79`
- 外部动作：GitHub main/tag/Release 与 Obsidian 插件更新；不部署 CloudBase/CDN，不读取或修改真实用户数据

## 用户授权

用户已完成本地候选测试，并于 2026-08-09 明确要求直接发布更新。

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

- 只包含已完成本地验收的同步取消、小红书登录窗口治理、安全笔记写入、版本与发布资产更新。
- 独立审查 P0/P1/P2 为 0。
- 权威 `main`、annotated tag、Release 五项资产和 ZIP 身份一致。
- 综合工程镜像由权威发布提交同步，四项 loose assets 哈希一致。

## 发布前验证

- 功能 PR：#50，两项远端门禁通过，squash 合并提交 e149405449c98e1332fa92d19c23251df3d8e976。
- 本地目标回归、完整插件回归、语法与发布治理已通过。
- 独立复审：P0=0、P1=0；审查提出的安全写入边界已收紧并重新验证。
- 发布治理 126/126；候选门禁 24 通过、1 项因 Windows 无法创建符号链接而跳过；发布身份 26/26。
- 候选身份：`1.3.79-9e06bfa2be7eb6a0`，聚合 SHA-256：`9e06bfa2be7eb6a039e650abf1b0ad59e16c73c3559d905a41ecfc8a8b05748a`。
- 发版 PR、annotated tag、Release 与线上回读结果在发布完成后补充。
