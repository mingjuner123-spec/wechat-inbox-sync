# 插件架构候选集成与 1.3.75 发布任务卡

- 任务 ID：`plugin-architecture-release-1-3-75-001`
- 创建日期：2026-07-31
- 状态：进行中
- 风险等级：L3
- 分支：`codex/plugin-architecture-release-1.3.75`
- Worktree：`.worktrees/plugin-architecture-release-1.3.75`
- 权威仓库：`https://github.com/mingjuner123-spec/wechat-inbox-sync`
- 目标版本：`1.3.75`
- 环境/发布链路占用：Obsidian 插件 GitHub main、tag、Release 与 Marketplace；不涉及 CloudBase、小程序或真实业务数据

## 用户授权

用户已于 2026-07-31 完成架构候选的本地人工测试并确认“均已测试，没有问题，继续下一步”，授权继续正式集成与发布。

## 允许修改路径（allowedPaths）

- `.gitattributes`
- `.github/workflows/main-guards.yml`
- `.github/workflows/release.yml`
- `.gitignore`
- `docs/PLUGIN_CODE_MAP_1.3.74.md`
- `docs/WORKLOG.md`
- `docs/superpowers/plans/2026-07-31-plugin-architecture-loop-1-3-74.md`
- `docs/superpowers/specs/2026-07-31-plugin-architecture-loop-1-3-74-design.md`
- `docs/task-cards/plugin-architecture-loop-1-3-74-001.md`
- `docs/task-cards/plugin-architecture-release-1-3-75-001.md`
- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`
- `release-candidate.json`
- `obsidian-plugin/wechat-inbox-sync/`
- `scripts/`
- `tests/`

## 已锁定的人工测试事实

- 人工测试候选：`1.3.74-a1e0dc0502c7029b`
- 候选聚合 SHA-256：`a1e0dc0502c7029b6b6e7991ad1834d8683aefa7f05e1617f327a425aa2629a5`
- 候选 `main.js` SHA-256：`08e4b7aeb9c6cfccc34d12231a2d7ea4f52a801e8f382aef725445ffc9796728`
- 用户本地插件安装后 `data.json` 未变化，候选安装验证通过。
- 目标发布版本只允许将版本元数据递增到 `1.3.75`；最终 `main.js` 必须继续保持上述 SHA-256。

## 执行顺序

1. 从最新 `origin/main` 建立干净集成分支，保留原人工测试分支不变。
2. 移植架构提交，重新验证正式源、根镜像、候选包和用户已安装插件四者一致。
3. 晋升人工测试候选并通过完整回归与独立子 Agent 审查。
4. 推送架构 PR，等待远端门禁通过后合并。
5. 从合并后的远端 `main` 创建独立 1.3.75 发布分支，仅更新版本元数据并重新生成候选。
6. 验证 1.3.75 的 `main.js` 与人工测试候选逐字节一致，完成完整回归、独立审查、PR 和合并。
7. 在干净且等于远端 `main` 的发布 Worktree 创建本地 annotated tag，依次通过 source guard 与 prepublish。
8. 推送 tag，等待 GitHub Release 生成五项资产，再执行 postpublish 与 Marketplace 回读。

## 失败关闭与回退

- 任一哈希、构建、候选、CI、审查或发布身份校验失败，立即停止后续外部动作。
- 架构 PR 如需回退，只对该 PR 的 squash merge 创建普通 revert；不得移动历史 tag 或覆盖 Release。
- tag 推送前可删除未推送的本地 tag；tag 推送后禁止覆盖，任何修复必须递增新版本。
- 不修改 CloudBase、用户绑定、Pro 权益、同步记录、支付或真实用户数据。

## 验收标准

- 架构 PR 和版本 PR 的远端门禁全部通过。
- 1.3.75 的 `main.js` SHA-256 精确等于人工测试候选。
- GitHub main、annotated tag peeled commit、Release 和五项资产身份一致。
- Release 非 draft、非 prerelease，ZIP 内容与 loose assets 一致。
- Obsidian Marketplace 能读取 1.3.75；发布后监控不出现活动目录移除或版本身份异常。
- 独立审查 P0/P1/P2 均为 0。
