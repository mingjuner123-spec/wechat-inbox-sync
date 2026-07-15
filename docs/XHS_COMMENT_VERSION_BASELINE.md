# 小红书评论区稳定基线

这份文档用于在后续平台变化或代码改动导致评论缺失、重复、层级错误时，快速找到已经由真实用户验证通过的版本，进行对比和恢复。

## 当前稳定基线

- 稳定标签：`xhs-comments-stable-1.3.42`
- 正式版本标签：`1.3.42`
- 基线提交：`fd6183dcc6c66d06046f73cd8e726b6ac0e79f58`
- 评论核心修复：`7058d4d7a75abf543e9a857a48338464accdb28e`
- 同期必须保留的 Pro 刷新提交：`0e92e94bbb030e58b4962c70950faa310f6b983f`
- 基线 `main.js` Git blob：`f285e85b489545afca69c6ff92df7680d99ccd5c`
- 正式发布包：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.42>
- 设计说明：`docs/superpowers/specs/2026-07-15-xhs-single-comment-graph-design.md`
- 实施记录：`docs/superpowers/plans/2026-07-15-xhs-single-comment-graph.md`

`xhs-comments-stable-1.3.42` 是不可移动的已验证标签。以后如果出现新的稳定实现，应创建新的 `xhs-comments-stable-<version>` 标签，不得移动或覆盖旧标签。

## 这份基线保证什么

1. 浏览器网络阶段生成的最终评论树是权威数据，不再与初始静态 HTML 做第二次通用合并。
2. 最终写入前先移除正文中旧的 `## 评论区`，再通过 `finalizeXiaohongshuComments` 完整渲染一次。
3. 递归标准化函数不直接作为 `Array.map` 回调，避免根评论索引被误当成递归深度而丢失后半部分回复。
4. 有网络 ID 时优先按 ID 去重；无 ID 的降级去重忽略 `[doge]` 等展示型 emoji 和时间格式差异，但不删除不同 ID 的同文案评论。
5. 主评论请求和回复请求分别统计；`lost_root`、`lost_replies` 用于判断插件内部是否丢失已捕获节点，`partial` 用于区分平台没有继续返回数据。
6. 用户真实样本已验证通过；生产形态回归要求 74 条根评论、19 条回复在最终 Markdown 中仍保持 74/19。

## 回归测试锚点

主要回归位于 `tests/plugin-main-ai.test.js`，可用以下关键词定位，不依赖会随代码变化的固定行号：

- `productionShapedXiaohongshuFinalization`
- `fallbackEmojiDuplicateFinalization`
- `sameTextDistinctIdsFinalization`
- `finalizeXiaohongshuComments`
- `lost_root=0; lost_replies=0`

每次修改小红书评论采集、合并、去重、分页、回复树或 Markdown 渲染时，至少执行：

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

新增行为必须先增加能复现问题的回归样本，再修改实现。不得通过删除、放宽或跳过上述稳定样本来让测试通过。

## 出现问题时怎么回看

先确认稳定标签仍指向正式 1.3.42：

```powershell
git rev-parse 'xhs-comments-stable-1.3.42^{commit}'
git rev-parse '1.3.42^{commit}'
```

两条命令都应返回：

```text
fd6183dcc6c66d06046f73cd8e726b6ac0e79f58
```

查看稳定实现和当前实现的差异：

```powershell
git diff xhs-comments-stable-1.3.42..HEAD -- obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git log --oneline xhs-comments-stable-1.3.42..HEAD -- obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
```

重点检查这些函数和诊断：

- `finalizeXiaohongshuComments`
- `buildSocialCommentsMarkdown`
- `normalizeSocialComment`
- `buildXiaohongshuCommentDiagnostic`
- `merged_root` / `merged_replies`
- `final_root` / `final_replies`
- `lost_root` / `lost_replies`
- `partial` / `api_stop` / `stop`

## 恢复原则

- 不对 `main` 使用 `git reset --hard`，也不整体退回 1.3.42；后续版本可能包含 Pro、OCR、ASR、抖音和安全修复。
- 从最新 `main` 建立修复分支，只对照稳定标签恢复小红书评论相关逻辑和回归样本。
- 恢复后必须重新运行完整插件测试，并确认 1.3.41 起加入的 Pro 有效期强制刷新、no-cache、异常保留有效权益和设置页重绘回归仍通过。
- 插件文件回滚不得覆盖用户知识库中的 `data.json`。

## 新稳定版本的登记规则

只有同时满足以下条件，才创建新的 `xhs-comments-stable-<version>` 标签：

1. 自动回归通过；
2. 至少一组真实小红书样本验证评论数量、回复层级和去重效果；
3. 新笔记诊断中已捕获节点满足 `lost_root=0`、`lost_replies=0`；
4. 若 `partial=1`，原因能够归因于平台分页、登录态或风控，而不是插件内部丢失；
5. Pro、媒体转写和市场包回归没有被破坏；
6. 在 `docs/WORKLOG.md` 记录版本、标签、验证样本和已知风险。
