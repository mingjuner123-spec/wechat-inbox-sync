<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-xhs-image-ocr-dedupe-release-001
- 标题：发布小红书图片与 OCR 去重修复 1.3.72
- 创建日期：2026-07-29
- 类型：修复、发布
- 状态：进行中
- 风险等级：L3
- 所属阶段：插件稳定性
- 是否当前主线：否
- 所属支线：plugin-xhs-image-ocr-dedupe-release
- 父主线：H2-002
- 分支：codex/xhs-image-ocr-dedupe-release-1.3.72
- Worktree：.worktrees/xhs-image-ocr-dedupe-release
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/main.js；obsidian-plugin/wechat-inbox-sync/manifest.json；obsidian-plugin/wechat-inbox-sync/versions.json；obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md；manifest.json；versions.json；tests/plugin-main-ai.test.js；tests/plugin-marketplace-package.test.js；docs/task-cards/plugin-xhs-image-ocr-dedupe-release-001.md；docs/WORKLOG.md
- 环境或发布链路占用：obsidian-plugin/wechat-inbox-sync@1.3.72
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

从正式远端 main 发布 1.3.72，使同一小红书图片的 JPG/WebP 变体只生成一个本地附件并只进入一次 OCR。

## 非目标

不发布本地模块化重构，不修改 CloudBase、小程序、本地 ASR/OCR 组件、用户数据、绑定或 Pro 权益。

## 前置事实与证据

远端 main 为 4eda90eb，正式插件版本为 1.3.71；1.3.72 远端标签不存在。旧代码会把跨 CDN 路径的 JPG/WebP 同资产送入 OCR 两次，新增回归测试在修复前稳定失败、修复后通过。

## 禁止动作

禁止覆盖已有 tag/Release；禁止从脏根工作区或本地模块化重构分支发布；禁止登录 GitHub、部署 CloudBase/CDN、修改真实用户数据。

## 分支与 Worktree

只在本卡声明的发布分支和 Worktree 工作，发布候选必须基于 origin/main@4eda90eb。

## 作者、审稿与验证

主 Agent 完成实现、测试和受控发布；一名独立 Agent 审查当前补丁、失败路径、版本身份及是否夹带重构。负责人已在当前对话明确授权直接发布。

## 验收

- 插件核心、市场包、发布治理、发布身份、语法和差异检查通过。
- JPG/WebP 同资产在正文、附件和 OCR 三条链路均只保留一次。
- main、annotated tag、Release 和五项资产全部指向同一 1.3.72 提交。
- 发布后身份校验通过。

## 纠偏记录

发现最初本地修复基于尚未发布的模块化重构分支，已停止从该分支发布，改为从正式 origin/main 新建干净发布工作区并仅移植最小补丁。独立审查确认根目录 `main.js` 仍被六个移动端测试直接引用，已撤销本次误删；根镜像治理留给独立任务，不能夹入业务热修。

## 已知风险

GitHub Release 工作流历史上可能在五项资产已上传后因 Runner 未回读 annotated tag 出现末尾误报；若发生，只允许做远端只读身份复核，禁止覆盖或重建 Release。

## 唯一下一步

完成发布门禁和独立审查后发布 1.3.72。

## 是否需要负责人决定

否；负责人已明确授权直接发布。
