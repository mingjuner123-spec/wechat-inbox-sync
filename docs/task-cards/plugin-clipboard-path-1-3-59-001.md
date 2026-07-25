<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-clipboard-path-1-3-59-001
- 标题：剪切板链接自动提取与 Windows 保存路径规范化
- 创建日期：2026-07-25
- 类型：修复 / 发布
- 状态：进行中
- 风险等级：L3
- 所属阶段：插件正式发布
- 是否当前主线：否
- 所属支线：plugin-clipboard-path-1-3-59
- 父主线：H2-002
- 分支：codex/plugin-clipboard-path-1.3.59
- Worktree：.worktrees/plugin-clipboard-path-1.3.59
- 允许修改路径（allowedPaths）：docs/task-cards/plugin-clipboard-path-1-3-59-001.md；docs/superpowers/specs/2026-07-25-plugin-clipboard-path-1.3.59-design.md；docs/superpowers/plans/2026-07-25-plugin-clipboard-path-1.3.59.md；docs/WORKLOG.md；obsidian-plugin/wechat-inbox-sync/main.js；obsidian-plugin/wechat-inbox-sync/manifest.json；obsidian-plugin/wechat-inbox-sync/versions.json；main.js；manifest.json；versions.json；tests/plugin-main-ai.test.js；tests/plugin-marketplace-package.test.js；tests/plugin-release-identity.test.js
- 环境或发布链路占用：github-release:1.3.59；obsidian-marketplace:1.3.59
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

插件兼容把旧客户端或剪切板入口误存为 `text` 的单一公开 HTTP(S) 链接转入网页提取，同时保留原始分享文案；统一 Windows 反斜杠与 Obsidian Vault 路径，避免同一物理目录在界面中出现两个别名。验证通过后发布 1.3.59。

## 非目标

不修改、不部署小程序或云函数；不迁移、复制或删除用户已有文件；不自动访问本机、私网、带凭据或非 HTTP(S) 地址；不把含多个含糊链接的普通文本强制转为网页。

## 前置事实与证据

正式基线为 `origin/main@58db48c`（1.3.58）。当前插件只会把 `link` 类型的支持平台链接转为网页，`text` 类型分享文案原样落盘。保存目录仅在查重时规范化，实际写入仍可能把 `raw\wechatmd` 原样传给 Obsidian adapter，Windows 上由此形成同一物理对象的双路径缓存别名。

## 禁止动作

禁止从综合项目脏根目录构建；禁止夹带小程序、云函数、Pro、支付、绑定或其他并行任务；禁止覆盖既有 tag/Release；禁止移动或删除用户文件；禁止在自动链接提取中放宽 SSRF 边界。

## 分支与 Worktree

唯一实现区为 `.worktrees/plugin-clipboard-path-1.3.59`，基线为正式 1.3.58。所有提交与发布候选必须只包含 allowedPaths。

## 作者、审稿与验证

主 Agent 为作者；独立安全审稿、独立测试审稿和独立最终发布验证由三个不同 Agent 执行。任何 P0/P1 未归零、测试失败或发布身份不一致都停止发布。

## 验收

单一安全网页链接可从 `text` 记录转入网页提取并保留 `shareText`；纯文本、多含糊链接和危险地址保持文本；现有 `link`/`webpage` 行为不回退。反斜杠设置被持久化为 `/`，已存在目录不重复创建，缺失多级目录逐级创建，笔记、附件、图片和视频号写入路径均无反斜杠。完整回归、语法、市场包和发布身份门禁通过；最终 main、annotated tag、Release 五项资产、raw manifest 与本地 ZIP 一致。

## 纠偏记录

首轮独立安全审查以 P1 阻止发布：初始实现只校验 URL 字面主机，未覆盖 IPv4-mapped IPv6、DNS 私网结果和重定向后的私网地址；自动提升后的普通网页提取失败仍可能写笔记并标记 synced；`shareText` 仅留在内存；并发建目录存在 exists/create 竞态。随后按 TDD 增加公网 DNS 实际 lookup 门禁、逐跳安全抓取、映射 IPv6/保留地址拒绝、失败抛出并保持 pending、原始剪切板正文落盘以及目录竞态复查。

首轮独立测试审查要求补齐实际写入矩阵。已增加日期子目录、视频号捕获、语音、文件和原始音视频附件的反斜杠输入测试，统一断言最终 adapter 路径只含 `/`。

## 已知风险

插件侧兼容能够覆盖现有和排队中的旧记录，但小程序与云端的链接类型合同仍需在干净基线上另立任务统一。若网页提取失败，既有失败关闭诊断继续生效，不能回退为伪成功笔记。

## 唯一下一步

按 TDD 先提交失败测试，再做最小实现。

## 是否需要负责人决定

否；负责人已明确确认插件 1.3.59 修复、独立审查、正式发布与飞书完成通知。
