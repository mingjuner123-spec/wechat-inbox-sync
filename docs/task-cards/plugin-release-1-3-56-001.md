<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-release-1-3-56-001
- 标题：停止转写入口与 ASR 修复统一发布
- 创建日期：2026-07-24
- 类型：修复 / 发布
- 状态：进行中
- 风险等级：L2
- 所属阶段：插件正式发布
- 是否当前主线：否
- 所属支线：plugin-release-1-3-56
- 父主线：H2-002
- 分支：codex/release-plugin-1.3.56
- Worktree：.worktrees/release-plugin-1.3.56
- 文件所有权：obsidian-plugin/wechat-inbox-sync/main.js；tests/plugin-main-ai.test.js；tests/plugin-marketplace-package.test.js；manifest.json；versions.json；obsidian-plugin/wechat-inbox-sync/manifest.json；obsidian-plugin/wechat-inbox-sync/versions.json；scripts/plugin-release-identity-core.js；scripts/check-plugin-release-identity.js；tests/plugin-release-identity.test.js；.github/workflows/release.yml；docs/superpowers/specs/2026-07-24-plugin-1.3.56-design.md；docs/superpowers/plans/2026-07-24-plugin-1.3.56.md；docs/task-cards/plugin-release-1-3-56-001.md
- 环境或发布链路占用：github-release:1.3.56；obsidian-marketplace:1.3.56

## 目标

从公开插件仓库最终受保护 `main` 提交发布 `1.3.56`，包含停止转写入口常驻，并完整保留 `1.3.55` 已有的停止转写核心和 macOS/Windows ASR 安装修复。

## 非目标

不加入体验 Pro 云端逻辑、Stage1A、Hermes、分销或其他未审查支线；不部署 CloudBase；不修改插件市场仓库地址。

## 前置事实与证据

实时公开基线为 `main@624fa7e`。停止入口候选 `02734f8` 的父提交正是该基线，差异仅涉及插件 `main.js` 与对应测试；三组 ASR 修复均已是基线祖先。目标版本在计划预检时未被远端 tag 或 Release 占用。

## 禁止动作

禁止覆盖已存在标签或 Release，禁止从综合项目脏根目录构建，禁止依赖综合项目私有 Harness，禁止把本任务当作任何云端部署授权。正式 ZIP 只认最终 tag checkout 的 GitHub 工作流产物。

## 分支与 Worktree

唯一候选分支为 `codex/release-plugin-1.3.56`，唯一实现区为 `.worktrees/release-plugin-1.3.56`。受保护合并后必须同步到最终 `origin/main` SHA，不能假定候选提交就是发布提交。

## 作者、审稿与验证

计划审稿、实现作者、规格审稿、安全质量审稿和最终发布验证由不同 Agent 执行。P0/P1 未归零或发布身份证门禁失败时不得发布。

## 验收

插件全量回归、版本治理、市场包、Windows/macOS 安装器语法、组件资产与发布工作流测试全部通过；本地 annotated tag、最终远端 main、远端 peeled tag 和 Release 目标提交必须一致；正式 ZIP 条目及关键文件字节必须与 tag checkout 一致。

## 纠偏记录

第一轮计划审稿发现中央未登记、私有 Harness 依赖、标签顺序错误、工作流允许 `--clobber` 和 ZIP 身份含糊；`25daa03` 已修订，独立复审 P0/P1/P2 均为 0。

实现阶段先后形成 `cb8c639`（停止转写入口常驻）、`86fdacb`（公开仓库自包含的不可变发布身份门禁）与 `91c0316`（四份 `1.3.56` 元数据）。停止入口与发布门禁均先见到目标红灯再最小实现转绿；发布门禁包含临时 bare Git 仓库、严格 HTTP 404、四份元数据、三方 SHA、五项资产、24 小时新鲜度与正式 ZIP 字节校验。一次性本地预检 ZIP 的条目和 14 个文件字节已与候选源一致，SHA-256 为 `A5AE4C36342B167C3253B2CD0A349BC64F533C65A791D03A5CD9DEAD8406D13A`，校验后已删除且未进入 Git。

首轮安全质量审稿以 P0=0/P1=2/P2=2 阻止推送：旧门禁会把任意本地 `origin` 与固定官方 API 混用，ZIP 也未核对中央目录与本地文件头。`688dd7b` 已用测试先行修复：fetch/push origin 必须规范化为同一官方仓库；真实默认分支、分支提交、annotated tag 与 peeled commit 只从固定官方 GitHub API 解析；Release target 只允许由可信分支/tag/SHA 映射；ZIP 拒绝 data descriptor、危险 flags、中央/本地文件名或大小漂移、重叠与越界；HTTP、单资产、ZIP 压缩及展开均有硬上限；所有错误出口统一脱敏。严格规则下重新生成的无 data-descriptor 预检 ZIP 含 14 个文件且逐字一致，SHA-256 为 `134AB15A33E5A50983790D163D89E3777F8A697FB60D433CDE44CC99AF49222E`，校验后已删除且未进入 Git。

第二轮安全质量复审继续以 ZIP P1 阻止推送：中央目录和本地文件头的 CRC 若同时伪造，旧实现仍会信任；未被中央目录引用的本地文件头、自解压前缀、中央目录与 EOCD 间隙、尾随字节和条目计数漂移也没有全部失败关闭。`bbe96c6` 按 TDD 先得到 20/23 红灯，再实现到 23/23 绿灯：对每个解压文件重新计算 CRC32；要求所有本地条目从偏移 0 到中央目录连续且无孤儿或空隙；要求 entries-on-disk、总条目数与实际解析数一致，中央目录紧邻 EOCD，EOCD 注释长度精确到文件末尾。真实预检 ZIP 的 14 个文件继续逐字一致，SHA-256 仍为 `134AB15A33E5A50983790D163D89E3777F8A697FB60D433CDE44CC99AF49222E`，校验后已删除。插件回归、市场包、发布治理 126/126、JavaScript/PowerShell/Bash 语法、组件 manifest 和完整 CDN 校验均通过；仍未推送、打标签或发布。

## 已知风险

GitHub 受保护分支流程可能产生新的合并 SHA，因此必须在合并后重新同步并以最终 main 为唯一身份。若同版本外部对象已存在或闭环回读失败，不得覆盖，停止并使用新补丁版本。

## 唯一下一步

由独立规格审稿与独立安全质量审稿检查 `31f0475..HEAD`；P0/P1 归零后才允许推送候选并进入受保护合并、最终 `origin/main` 身份同步与首次发布流程。

## 是否需要负责人决定

否；产品负责人已明确授权 `1.3.56` 的实现、受保护合并、标签、GitHub Release 和发布后回读。若必须更换版本号或改变插件市场仓库地址，再提交决定。
