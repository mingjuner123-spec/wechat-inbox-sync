<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-cloud-transcription-response-utils-001
- 标题：Obsidian 插件云端转写响应解析模块拆分
- 创建日期：2026-08-09
- 类型：重构
- 状态：已完成
- 风险等级：L2
- 所属阶段：插件架构重构第七阶段
- 是否当前主线：否
- 所属支线：plugin-cloud-transcription-response-utils
- 父主线：H2-002
- 分支：codex/plugin-cloud-transcription-response-utils-1.3.79
- Worktree：.worktrees/plugin-cloud-transcription-response-utils-1.3.79
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/src/cloud-transcription-response-utils.js；obsidian-plugin/wechat-inbox-sync/main.js；tests/plugin-cloud-transcription-response-utils.test.js；tests/plugin-main-ai.test.js；docs/superpowers/specs/2026-08-09-plugin-cloud-transcription-response-utils-design.md；docs/superpowers/plans/2026-08-09-plugin-cloud-transcription-response-utils.md
- 环境或发布链路占用：无；仅本地源码、生成 bundle、测试和文档。
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

以第六阶段本地提交 `979438bcb46b855a10bcbf2fb1678a672f0d9323` 为基线，把阿里云、豆包和腾讯云转写返回值解析、响应头读取与错误格式化纯函数从 `src/main.js` 迁到独立模块，并保持所有输入输出、中文错误、调用顺序和正式 bundle 行为不变。

## 非目标

不修改请求签名、请求参数、网络发送、轮询间隔、超时、密钥、设置、供应商选择、媒体下载、本地 ASR/OCR、平台提取、同步队列、绑定、Pro、版本或发布流程；不替换用户本机插件，不发布、不部署、不推送。

## 前置事实与证据

- 第六阶段提交已通过定向测试、主回归、市场包、构建、语法、双构建哈希和独立复审，工作区干净。
- 目标函数均为同步解析或格式化逻辑；豆包文本规范化只依赖已经独立的 `transcription-quality-utils.js`。
- 请求构建、签名和真实 HTTP 调用继续留在主入口，避免把凭据或网络副作用带进本轮。

## 禁止动作

禁止更改任何解析规则、错误文案、状态映射或去重逻辑；禁止顺手修改转写业务、平台抓取、绑定码、`data.json`、根目录 loose assets、tag、Release、CloudBase 或真实用户数据。

## 分支与 Worktree

只使用元数据所列分支与 Worktree，并从第六阶段干净提交创建。本卡切换为进行中并通过中央 Harness 启动器后才能实施。

## 作者、审稿与验证

主 Agent 按 TDD 完成模块缺失红灯、最小等价迁移和回归；一名未参与实现的独立 Agent 审查函数边界、异常等价性、依赖方向、bundle 自包含性和测试充分性。

## 验收

1. 新模块覆盖选定的 11 个响应解析/格式化函数，正常值、空值、SSE、说话人、处理中、失败状态和腾讯时间戳清洗行为与旧实现一致。
2. `src/main.js` 只导入使用新模块，不保留重复定义；请求构建、签名、网络与轮询逻辑不迁移。
3. 构建后仍为单一自包含 `main.js`，版本保持 1.3.79。
4. 定向测试、`plugin-main-ai`、市场包、构建漂移、源码/模块/生成物语法、双构建哈希和 `git diff --check` 通过。
5. 独立审查 P0/P1 为 0；只形成干净本地提交，不发布、不部署、不替换本机插件。

## 纠偏记录

- 独立审查首次把任务卡路径未列入 `allowedPaths` 记为 P2；复核 `docs/HARNESS_TASK_CARD_TEMPLATE.md` 与 `scripts/harness-start.js` 后确认任务卡由启动器隐式放行，审查者撤销该问题，最终 P0/P1/P2 均为 0。

## 已知风险

这些解析函数直接决定云端转写成功、处理中和错误状态。通过逐字迁移、独立边界样本、旧测试回归与双构建哈希证明等价；任一差异即停止并回退本轮 Worktree。

## 唯一下一步

保留本地分支与隔离 Worktree，后续和前六阶段候选一起由负责人统一执行人工核心功能测试；通过后另建发布任务，本卡不直接发布。

## 是否需要负责人决定

否；用户已批准继续本地逐模块架构重构。任何行为变化、本机插件替换、发布或部署另行处理。

## 完成证据

- 候选基线：`979438bcb46b855a10bcbf2fb1678a672f0d9323`；本轮把 11 个云端转写响应解析/格式化函数迁入 `src/cloud-transcription-response-utils.js`。
- 机器化比对：11/11 个迁移函数与基线逐字一致；`buildTencentRequest`、`buildAliyunVoiceRequest`、`buildDoubaoAsrRequest`、`buildDoubaoAsrQueryRequest` 4 个请求构建函数保持原位且逐字一致。
- TDD：先获得新模块 `MODULE_NOT_FOUND` 红灯，再完成最小等价迁移；定向模块测试、`plugin-main-ai`、市场包、构建基础、构建漂移与三项语法检查全部通过。
- 可复现性：连续两次构建生成 `main.js` 的 SHA-256 均为 `B0FADFE3340A6E24F82F3E21932397A3A38528FD4DD808612F61994C0589B17C`；版本保持 1.3.79。
- 独立审查：P0=0、P1=0、P2=0，可作为本地可回退提交保留。
- 外部动作：无推送、无发布、无部署、无本机插件替换，未读取或修改 `data.json`、绑定码和真实用户数据。
