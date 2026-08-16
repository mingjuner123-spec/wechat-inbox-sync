# WeChat Inbox Sync 1.3.91 发布任务

- Task ID：`plugin-release-1-3-91-001`
- 创建日期：2026-08-16
- 状态：已发布并完成独立回读
- 风险级别：L3（公开 GitHub 插件发布）
- 分支：`codex/release-1.3.91-pdf-douyin`
- 权威仓库：`mingjuner123-spec/wechat-inbox-sync`
- 基线版本：`1.3.90`
- 目标版本：`1.3.91`

## 用户授权

用户明确要求把 PDF 稳定性更新与抖音过度约束移除合并发布。

## 发布范围

- 普通 PDF 保留原快速文本层提取；复杂 PDF 回退 PDF.js；只有无可用文本层的页面调用现有本地 OCR。
- 不引入 PyMuPDF，不强制安装新 OCR 组件；保留 PDF.js Apache-2.0 许可证声明。
- 抖音精确详情仍优先；精确路径失败时恢复当前页面主媒体兜底。
- 推荐流标签、多个播放器、身份不完整或缺少稳定 aweme ID 不再单独阻断；仅最终页面明确跳到另一个具体作品时拒绝。
- 不部署云函数，不修改绑定码、Pro、支付、用户配置或数据。

## 停止条件

- PDF 快速路径、PDF.js 文本层、扫描页 OCR、抖音明确错作品拦截、插件回归、版本身份或发布资产任一失败即停止。
- 不覆盖、删除、移动或重建已有 tag/Release。

## 验收

- 合并后的源码、生成 bundle、根目录镜像、manifest、versions、候选收据均为 1.3.91。
- PR 门禁通过并合并到远端 main 后，创建 annotated tag `1.3.91`。
- Release 精确包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.91.zip`。
- 发布后回读 tag、Release、五项资产和 raw manifest，执行 postpublish 身份校验。

## 发布结果

- PR：`#62`；两项必需检查 `guards`、`windows-deployer` 均通过后 squash 合并。
- 远端 `main`：`555293d8c23d748884b479f07a7ddf6750e759be`。
- annotated tag：对象 `b135c65bff60be13e965cbc78344921a2152a708`，peeled commit 与远端 `main` 一致。
- Release：`https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.91`，非草稿、非预发布并标记 Latest。
- 五项正式资产齐全；`main.js` 为 2,087,769 bytes，SHA-256 `93603090d9fac8cf0e1789f0aebafc8965d6306033f8026de895a49328ef1cd0`；ZIP 为 526,665 bytes，SHA-256 `f8930d538871e71968ba964038cfa664479e6d6da346db6a308c02ea36ffcee1`。
- 线上 ZIP 结构与内嵌 `manifest.json` 回读通过，版本为 `1.3.91`；raw `main/manifest.json` 同为 `1.3.91`。
- GitHub Release workflow 在五项资产创建完成后的最后 postpublish 回读显示失败：`main.js` 增至 1 MiB 以上后，检查器 `git show` 仍使用 Node 默认 `execFileSync` 缓冲区，触发检查器自身容量边界。Release、tag、main、资产字节数与哈希均已通过独立回读；未删除、覆盖或重建 Release。

## 回退与外部影响

- 不修改 CloudBase、绑定码、Pro、支付、用户配置或用户数据。
- 既有 Release 保持不可变；如发现业务回归，只通过新版本修复，不移动或覆盖 `1.3.91` tag/Release。
