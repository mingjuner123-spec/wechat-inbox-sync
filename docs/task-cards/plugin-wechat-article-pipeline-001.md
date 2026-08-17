<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-wechat-article-pipeline-001
- 标题：公众号图文提取管线重构与引导页降级
- 创建日期：2026-08-17
- 类型：重构｜修复
- 状态：发布准备中
- 风险等级：L3
- 所属阶段：公众号图文可靠性
- 是否当前主线：否
- 所属支线：wechat-article-pipeline
- 父主线：H2-002
- 分支：codex/wechat-article-refactor
- Worktree：.worktrees/wechat-article-refactor
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline.js；obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils.js；obsidian-plugin/wechat-inbox-sync/main.js；obsidian-plugin/wechat-inbox-sync/manifest.json；obsidian-plugin/wechat-inbox-sync/versions.json；obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md；obsidian-plugin/wechat-inbox-sync/build-plugin.js；tests/plugin-wechat-article-pipeline.test.js；tests/plugin-main-ai.test.js；tests/plugin-wechat-article-image-localization.test.js；tests/plugin-architecture-integration.test.js；tests/plugin-marketplace-package.test.js；main.js；manifest.json；styles.css；versions.json；release-candidate.json；.artifacts/plugin/；.artifacts/candidate-result.json；docs/task-cards/plugin-wechat-article-pipeline-001.md；docs/superpowers/specs/2026-08-17-wechat-article-pipeline-design.md；docs/superpowers/plans/2026-08-17-wechat-article-pipeline.md
- 环境或发布链路占用：公开插件仓库 GitHub Release 1.3.97；不占用 CloudBase 或用户数据
- 紧急事实：不适用
- 事故授权范围：用户于 2026-08-18 明确授权独立审查、新建 L3 发布任务、按远端最新版本递增并执行插件 GitHub 发布；不部署云函数、不修改用户数据

## 目标

把公众号文章的“抓取、页面分类、正文提取、图片本地化、部分结果保存”建立为可测试的独立管线：正常文章保存标题、正文与图片；微信只返回引导或验证页面时，不阻塞同批其他记录，并保存原始链接与可信元数据。

## 非目标

不增加微信登录、评论区、验证码绕过、代理、第三方抓取服务、视频号下载、云函数变更或任何发布动作。

## 前置事实与证据

- 用户诊断显示 1.3.93 对两篇公众号记录报“微信仅返回打开引导页”。
- 权威公开仓库 `mingjuner123-spec/wechat-inbox-sync` 的 `main` 已回读为 `ff4871c503c2fa2eb34b5e52c762d6bc1eadbe8e`。
- 当前综合工程插件目录含不属于本任务的未提交改动，不能作为实现或发布基线。

## 禁止动作

不读取或写入真实用户数据、凭据、登录会话；不部署、上传、发布、修改版本号或覆盖本地安装插件配置。

## 分支与 Worktree

唯一分支与隔离工作区如上；实现基线固定为权威 `main@ff4871c5`。

## 作者、审稿与验证

作者完成 TDD、定向回归和构建检查；合并或发布前需要一名独立审查者覆盖页面分类、浏览器兜底、部分保存和图片失败路径。

## 验收

- 引导页先进入受控浏览器兜底；浏览器取得正文时保存完整文章。
- 浏览器仍无正文时保存链接与可信标题/封面，不将该记录记作正文提取成功。
- 验证页不尝试绕过，只保存线索和明确状态。
- 单篇受限记录不会阻断同批可正常保存的文章。
- 正文、表格和图片本地化现有行为由定向测试保持。

## 纠偏记录

- 新增“正文首段很短、后续段落才包含主要内容”的回归用例，暴露了原始 `js_content` 正文检测在第一个嵌套标签处过早截断的问题；已改为按同名标签层级提取完整正文容器后再判定。
- 已本地重建发布资产；未读取真实用户数据、未部署、未发布。

## 已知风险

微信可能在所有通道都不返回正文；该情况只能降级保存线索，不能承诺自动提取。浏览器渲染与图片下载需有超时和逐项失败处理。

## 唯一下一步

由独立审查者覆盖页面分类、浏览器兜底、部分保存和图片失败路径；审查通过后再决定合并或发布。

## 是否需要负责人决定

否；发布、部署或引入外部服务时须另行决定。
