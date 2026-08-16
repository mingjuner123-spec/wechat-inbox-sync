# WeChat Inbox Sync 1.3.91 发布任务

- Task ID：`plugin-release-1-3-91-001`
- 创建日期：2026-08-16
- 状态：发布准备中
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
