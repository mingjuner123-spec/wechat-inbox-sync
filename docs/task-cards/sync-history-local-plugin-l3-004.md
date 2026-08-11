# sync-history-local-plugin-l3-004

## 状态

- 风险级别：L3（替换负责人本机 Obsidian 插件测试资产）
- 状态：已授权；候选已验证，等待 Obsidian 完全退出后执行
- 授权日期：2026-08-11
- 授权范围：用户要求直接开发；如需替换插件，必须基于现有本地插件保留未提交能力，并在退出 Obsidian 后替换。

## 目标

把 History 同步结果分类修复安装到指定测试知识库，使以下情况不再上报假成功：视频号等明确不支持的平台、公众号/今日头条等登录或打开 App 壳页、坏 PDF、转写失败、解析失败，以及未产生文件的插件异常。

## 非目标

- 不部署云函数，不上传小程序，不发布插件市场，不推送 Git。
- 不回写或推断已经被旧版本标为成功的历史记录。
- 不替换第二个知识库中的插件。
- 不复制、覆盖、删除或重建 `data.json`。

## 权威输入

- 分支：`codex/plugin-history-local-base-1.3.79`
- 源码提交：`4e2848d7f572fbffbb74f65c40012c7aed8b1e67`
- 功能修复提交：`f6e0463615e233c4e1f0b864f9017637f8b366af`
- 候选：`1.3.79-cd46d9c7146d66d5`
- 候选聚合 SHA-256：`cd46d9c7146d66d51f29613b612c9dae2c9ed53d76aaaf4e580e7adf45707ffe`
- 目标：`D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync`

## 允许路径

仅允许替换目标插件目录中的：

- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`

事务 staging 和备份仅允许位于同一知识库的 `.obsidian/plugin-staging/` 与 `.obsidian/plugin-backups/`。

## 门禁

1. Obsidian 进程必须为 0；运行中立即停止。
2. 候选身份和包哈希验证通过。
3. `.obsidian/plugins/` 中不得存在第二个相同 `manifest.id`。
4. 替换前后比较 `data.json` 的 SHA-256、绑定数量和绑定令牌脱敏指纹；任一变化自动回退。
5. 只使用受保护候选安装器；禁止手工覆盖。

## 测试与审查

- `node tests/plugin-sync-history.test.js`
- `node tests/plugin-wechat-article-image-localization.test.js`
- `node tests/plugin-document-text-extraction.test.js`
- `node tests/plugin-main-ai.test.js`
- `node tests/plugin-local-candidate-regressions.test.js`
- 插件 `npm.cmd run check`
- 源文件与构建资产 `node --check`
- `git diff --check`
- 独立终审：P0=0、P1=0、P2=0、P3=1；唯一 P3 为两份文档 EOF 空行，已在 `4e2848d7` 修复，`git diff --check` 通过。

## 回退

安装器在替换前创建四项发布资产备份。任何进程、重复插件、候选漂移、写入失败或 `data.json` 身份变化都必须失败关闭；若替换事务失败，立即用本次备份恢复四项资产，并再次验证 `data.json` 三重身份不变。

## 完成定义

- 受保护安装器成功返回并生成回执。
- 目标四项资产与候选一致。
- `data.json` 三重身份前后不变。
- Obsidian 重启后由用户重新分享测试链接，History 显示失败原因和重新同步按钮；正常正文仍显示完成同步。
<!-- end of task card -->
