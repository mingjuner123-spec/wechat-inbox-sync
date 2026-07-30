# WeChat Inbox Sync 1.3.74 正式发布任务卡

- 风险等级：L3
- 状态：进行中
- 负责人授权：用户于 2026-07-30 明确授权“打包上传”，并确认当前本地插件功能正确、不得回退或丢失。
- 目标版本：`1.3.74`
- 权威仓库：`https://github.com/mingjuner123-spec/wechat-inbox-sync`
- 发布基线：远端 `main` 的正式 `1.3.73`
- 发布候选：当前本机已安装并由用户完成实测的插件源码。

## 允许修改路径（allowedPaths）

- `obsidian-plugin/wechat-inbox-sync/`
- `main.js`
- `manifest.json`
- `versions.json`
- `styles.css`
- `tests/`
- `docs/WORKLOG.md`
- `docs/task-cards/plugin-release-1-3-74-20260730.md`
- `docs/superpowers/plans/2026-07-30-expired-xhs-shortlink-delete.md`
- `docs/superpowers/specs/2026-07-30-expired-xhs-shortlink-delete-design.md`
- `docs/superpowers/specs/2026-07-30-xhs-image-variant-dedupe.md`

## 本次功能范围

1. 小红书 JPG/WebP 同图变体从提取源头去重，OCR 只处理一份。
2. 永久失效的小红书临时短链生成本地说明文件，并从短业务环境删除云端旧记录。
3. 同步任务 single-flight：已有同步时不再启动并发重复同步，并显示进行中提示。
4. 小红书隐藏浏览器、登录探测和脚本执行加入有界超时，卡死后释放锁并继续后续记录。
5. “暂停当前转写删除记录”和“失效短链删除记录”统一走短业务环境 `/records/:id/synced`，不再误发到长环境控制面。

## 发布不变量

- 以用户已实测的本机插件 `main.js` SHA-256 为功能源事实；版本身份变更前，发布源码必须与其逐字节一致。
- 只从 `obsidian-plugin/wechat-inbox-sync/` 生成插件资产；根目录资产只作为发布镜像同步。
- 不修改 CloudBase、不部署云函数、不改业务数据。
- 不覆盖或移动既有 tag/Release；`1.3.74` 必须为新版本。
- 发布后必须回读远端 `main`、annotated tag、Release 五项资产、ZIP 内文件和市场身份。

## 回退

- 发布前：停止，不推 tag、不创建 Release。
- 发布后发现阻断问题：保留不可变的 `1.3.74` 证据，基于最后稳定版本制作新的修复版本；不移动 tag、不覆盖 Release。

## 验收

- 本机已安装插件与候选源码 SHA-256 一致。
- 插件核心、市场包、发布治理、语法、diff 检查全部通过。
- 独立审查无 P0/P1 阻断项。
- 远端 `main`、peeled tag 和 Release target 指向同一候选提交。
- Release 精确包含 `main.js`、`manifest.json`、`styles.css`、`versions.json`、`wechat-inbox-sync-1.3.74.zip`。
- ZIP、独立资产和 raw manifest 均为 `1.3.74`，文件哈希与本地候选一致。
