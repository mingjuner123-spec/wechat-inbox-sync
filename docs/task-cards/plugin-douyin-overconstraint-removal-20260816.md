# 抖音媒体提取过度约束移除

- Task ID：`plugin-douyin-overconstraint-removal-20260816`
- 创建日期：2026-08-16
- 状态：本地候选已通过验证，待用户决定是否进入后续本地替换/发布流程
- 风险级别：L2（插件提取链路与发布契约相关；本任务不发布、不部署）
- 分支：`codex/plugin-douyin-media-followup-20260816`
- 基线：`a4f4d3ec4da7923ceb547234dc713c0bea8ccf1b`

## 目标

删除没有真实事故证据支持的抖音推荐流阻断规则，恢复“精确详情优先、当前页面主媒体兜底”的行为；仅在浏览器最终地址明确指向另一个具体作品时拒绝。

## 允许修改路径

- `obsidian-plugin/wechat-inbox-sync/src/main.js`
- `obsidian-plugin/wechat-inbox-sync/main.js`
- `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`
- `tests/plugin-douyin-media.test.js`
- `tests/plugin-douyin-failure-diagnostic.test.js`
- `tests/plugin-main-ai.test.js`
- `docs/DECISIONS.md`
- `docs/WORKLOG.md`
- `docs/incidents/2026-08-16-douyin-overconstraint.md`
- `docs/superpowers/specs/2026-08-16-douyin-overconstraint-removal-design.md`
- `docs/superpowers/plans/2026-08-16-douyin-overconstraint-removal.md`
- 本任务卡

## 验收标准

1. 精确详情、目标作品接口和认证会话仍优先。
2. 混合身份、多个无身份播放器、候选身份不完整或缺少稳定 aweme ID 不再单独导致失败。
3. 精确通道失败后可选择当前页面最强的可播放主媒体。
4. 最终地址明确跳到另一个 `/video/:id` 时仍拒绝。
5. 源码测试、生成 bundle 测试、完整插件回归、语法、构建漂移与 diff 检查通过。
6. 不改版本号，不替换本机插件，不发布，不部署，不触碰用户配置和云端数据。
