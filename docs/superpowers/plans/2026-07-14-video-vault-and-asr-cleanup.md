# 视频平台原视频保存与 ASR 尾部清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 视频平台仅保存可验证原视频，并清除本地 ASR 异常尾段。

**Architecture:** 在转写元数据中保存全部候选 URL；附件层逐个下载、验证容器视频轨并只保存视频。B 站从 progressive 播放接口提取完整视频候选。本地 ASR 返回前调用尾部清理函数。

**Tech Stack:** Obsidian desktop plugin、Node.js Buffer、现有 Node 断言测试。

---

### Task 1: 纯函数与失败测试

- [ ] 在 `tests/plugin-main-ai.test.js` 为 `hasVideoTrackInMediaBuffer`、`cleanTrailingTranscriptionHallucinations` 和 B 站 progressive 提取写断言；先运行测试观察缺失函数失败。
- [ ] 在 `obsidian-plugin/wechat-inbox-sync/main.js` 实现 MP4/WebM 视频轨检测、视频候选规范化、B 站 progressive URL 提取和尾部清理函数。
- [ ] 重跑 `node tests/plugin-main-ai.test.js`，通过后提交 `feat: detect videos and clean asr tails`。

### Task 2: 传递视频候选并保存原视频

- [ ] 扩展 `buildTranscriptOnlyMetadata` 和 `buildTranscriptRecordFromMedia`，保留 `mediaUrls` 与 `videoUrls`。
- [ ] 抖音/小红书传入收集的媒体候选；B 站追加 progressive `durl` 视频候选。
- [ ] 重写 `saveSourceMediaAttachment`：视频平台只尝试视频候选，下载后验证视频轨，保存为 `.mp4`；无法取得视频则返回“未取得原视频”状态，且不影响转写。
- [ ] 运行媒体保存回归和语法检查，提交 `feat: save verified source videos`。

### Task 3: 本地 ASR 接入、回归与发布

- [ ] 在 `runLocalTranscription` 读取输出后调用尾部清理器，并保留空结果保护。
- [ ] 运行 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、语法检查和 `git diff --check`。
- [ ] 将插件版本升至 1.3.20，推送 `main` 和标签，等待 GitHub Release 后运行市场发布校验脚本。
