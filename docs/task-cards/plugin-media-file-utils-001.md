<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-media-file-utils-001
- 标题：Obsidian 插件附件与媒体文件纯工具模块拆分
- 创建日期：2026-08-09
- 类型：重构
- 状态：已完成
- 风险等级：L2
- 所属阶段：插件架构重构第六阶段
- 是否当前主线：否
- 所属支线：plugin-media-file-utils
- 父主线：H2-002
- 分支：codex/plugin-media-file-utils-1.3.79
- Worktree：.worktrees/plugin-media-file-utils-1.3.79
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/src/media-file-utils.js；obsidian-plugin/wechat-inbox-sync/main.js；tests/plugin-media-file-utils.test.js；tests/plugin-main-ai.test.js；docs/task-cards/plugin-media-file-utils-001.md；docs/superpowers/specs/2026-08-09-plugin-media-file-utils-design.md；docs/superpowers/plans/2026-08-09-plugin-media-file-utils.md
- 环境或发布链路占用：无；仅本地源码、生成 bundle、测试和文档
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

以本地已验证提交 `ebbbce457d40d7766447294783e19a9f564b750c` 为底座，把附件命名、数据 URL 解码、Buffer 规范化、图片/音视频扩展名判断、媒体文件头校验等纯函数从 `src/main.js` 抽到独立模块，并保持所有调用结果、错误信息、同步流程和正式 bundle 行为不变。

## 非目标

不修改下载请求、重试策略、媒体解析、ASR/OCR、小红书/抖音、同步队列、Vault 写入、绑定、Pro、设置、版本、manifest、versions 或发布流程；不替换用户本机插件，不发布、不部署、不推送。

## 前置事实与证据

- 上一阶段 DOCX/PDF 模块提交已通过定向测试、主回归、市场包、构建、语法和独立审查，形成干净可回退点。
- 候选函数均为同步纯计算，只依赖字符串、ArrayBuffer/Buffer 和少量文件签名字节；下载与写入调用者仍留在主入口。
- 现有主回归只直接覆盖部分 MP4 视频轨判断，本阶段必须为全部迁移接口补独立行为测试。

## 禁止动作

禁止修改算法阈值或用户文案；禁止顺手修媒体下载、转写或平台提取功能；禁止改版本号、根目录 loose assets、tag/Release、CloudBase 或真实用户数据；禁止替换本机 `data.json`。

## 分支与 Worktree

唯一分支和 Worktree 如元数据所列，从上一阶段干净提交创建。任务切为进行中后调用中央 Harness 启动器，任何基线测试失败先定位，不把历史失败带入候选。

## 作者、审稿与验证

主 Agent 按 TDD 完成模块缺失红灯、最小抽取和回归；一名未参与实现的独立 Agent 审查函数边界、输入输出等价、Buffer 边界、bundle 自包含性和测试充分性。

## 验收

1. 新模块覆盖选定的附件/媒体纯函数，正常值、空值、ArrayBuffer、图片魔数、HTML/JSON 假媒体和 MP4 音视频轨边界保持原行为。
2. `src/main.js` 只导入使用新模块，不保留重复定义；网络、文件系统和同步编排不迁移。
3. 构建后仍为单一自包含 `main.js`，版本保持 1.3.79。
4. 定向测试、`plugin-main-ai`、市场包、构建/漂移、源码与产物语法、双构建哈希和 `git diff --check` 通过。
5. 独立审查 P0/P1 为 0；仅形成干净本地提交，不发布、不部署、不替换本机插件。

## 纠偏记录

- 初选飞书 Markdown 清洗模块，但其包含大量历史兼容规则并贯穿网页正文清洗，风险高于本轮目标；改选更纯、更窄的附件/媒体文件工具边界。
- 首次机械移除按 CRLF 组合匹配，但源码为 LF，脚本在写主入口前主动停止；改为按函数起止标记做与换行无关的区间迁移后通过，未形成半迁移提交。

## 完成证据

- 14/14 个函数与基线 `ebbbce457d40d7766447294783e19a9f564b750c` 机器化比对完全一致。
- 定向测试、`plugin-main-ai`、市场包、源码/模块/生成物语法、构建检查与 `git diff --check` 通过。
- 双构建 SHA-256 均为 `9492312B2AF90431920E0ED320A50D670BF36F17AE6705A6CBB59E34DC08F5D6`；生成 bundle 自包含。
- 独立复审 P0=0、P1=0、P2=0；未发布、未部署、未替换本机插件、未触碰 `data.json`。

## 已知风险

媒体文件头误判会影响下载后是否进入转写；本阶段只迁移原实现并用历史对照和边界样本证明等价，不调整任何识别规则。

## 唯一下一步

保留本地分支与 Worktree 作为第六阶段可回退交付；继续下一段独立拆分，全部本地候选完成后统一人工功能测试。本任务不发布、不部署、不替换本机插件。

## 是否需要负责人决定

否；本任务执行负责人已批准的本地逐模块架构重构。任何行为变化、本机插件替换或发布另行处理。