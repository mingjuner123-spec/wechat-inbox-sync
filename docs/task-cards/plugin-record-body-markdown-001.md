<!-- HARNESS_TASK_CARD_V1 -->

# 插件内容正文格式化拆分：第三阶段

- 任务 ID：plugin-record-body-markdown-001
- 标题：插件内容正文格式化拆分（第三阶段）
- 创建日期：2026-08-01
- 类型：重构
- 状态：审核中
- 风险等级：L2
- 所属阶段：插件本地架构整理第三阶段
- 是否当前主线：否
- 所属支线：plugin-record-body-markdown
- 父主线：H2-002
- 分支：codex/plugin-record-body-markdown
- Worktree：.worktrees/plugin-record-body-markdown
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/src/record-body-markdown-utils.js；tests/plugin-main-ai.test.js；docs/PLUGIN_CODE_MAP_1.3.74.md；docs/superpowers/specs/2026-08-01-plugin-record-body-markdown-design.md；docs/superpowers/plans/2026-08-01-plugin-record-body-markdown.md
- 环境或发布链路占用：无
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

将网页、文件和音视频转写的 Markdown 正文生成抽成单一纯模块。给定记录及已存在的纯辅助函数，模块必须输出与当前 1.3.75 加第二阶段候选完全一致的正文；主入口继续负责下载、解析、AI、目录、Vault 写入与同步状态。

## 非目标

不改产品功能、正文文案、图片去重、小红书/飞书解析、ASR/OCR、附件下载、Obsidian Vault 写入、同步队列、失败删除、设置、绑定、权限、网络请求、版本、manifest、根目录镜像或发布流程；不发布、部署、上传或读取真实环境/用户数据。

## 前置事实与证据

上一阶段候选 `codex/plugin-note-output-boundary@bf1d4885` 已由独立审查确认 P0/P1/P2=0。其 `note-output-plan-utils` 仍通过主入口注入 `buildWebpageMarkdownBody` 与 `buildFileMarkdownBody`；这两个正文格式化入口及其音视频转写辅助函数仅做字符串/对象计算，是下一段可验证的低耦合边界。

## 禁止动作

禁止修改版本号、manifest、versions、根目录发布镜像、Release/CI/部署脚本；禁止 push、合并、创建 Release、部署 CloudBase、写入云端记录、访问真实环境或替换用户当前本地插件。

## 分支与 Worktree

唯一分支 `codex/plugin-record-body-markdown` 从上一阶段本地候选创建；唯一 Worktree `.worktrees/plugin-record-body-markdown`。修改边界只引用上方 allowedPaths，不建立第二份所有权清单。

## 作者、审稿与验证

L2：作者以测试先行完成最小抽取、构建和定向回归；一名未参与实现的独立 Agent 审查模块边界、旧新输出等价、失败路径和测试充分性。审查不得扩大任务范围。用户已要求子 Agent 负责审查。

## 验收

先观察正文格式化模块缺失导致的预期失败；实现后，文本化网页、飞书网页、视频号未接通提示、转写网页、转写文件、普通文件六类记录的 Markdown 必须与抽取前实现逐字一致，输入记录不被修改。再运行 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、插件目录 `npm.cmd run build` 与 `npm.cmd run check`、源/生成物语法检查、`git diff --check`，并运行 Harness 双检查。只交付本地候选。

## 纠偏记录

先观察到 `record-body-markdown-utils` 缺失导致的预期 `Cannot find module` 红灯；模块接线后，构建首次因新 Worktree 缺少本地 `esbuild` 开发依赖失败，安装已锁定依赖后构建正常。随后正文回归发现测试预期错误地保留了简介末尾句号；原逻辑本就去掉该句号，已修正断言，未改变产品文案或逻辑。核心、市场包、构建检查、源/生成物语法与 diff 检查均通过，待独立审查。

## 已知风险

正文是用户可见格式。若任一既有断言或旧新对照发现差异，立即停止本段抽取、恢复到本任务开始提交，并只记录差异；不得外发。

## 唯一下一步

独立 Agent 正在审查候选 `216ce51f` 相对第二阶段基线的范围、输出等价与回归充分性；通过后再继续下一段本地拆分，不发布。

## 是否需要负责人决定

否；只有发现必须改变现有可见正文文案、写入顺序或需要发布时才请求决定。
