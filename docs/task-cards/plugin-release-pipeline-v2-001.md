# 插件发布与本地候选管线 V2 任务卡

- 任务 ID：`plugin-release-pipeline-v2-001`
- 标题：插件候选快照、镜像同步、时间稳定测试与发布后身份校验
- 创建日期：2026-07-30
- 类型：基础设施 / 发布契约
- 状态：准备中
- 风险等级：L2
- 所属阶段：主线重构前置地基
- 是否当前主线：否
- 所属支线：`plugin-release-pipeline-v2`
- 父主线：`H2-002`
- 分支：`codex/plugin-release-pipeline-v2`
- Worktree：`.worktrees/plugin-release-pipeline-v2`
- 环境或发布链路占用：无；本任务不推送、不合并、不打标签、不创建 Release

## 允许修改路径（allowedPaths）

- `.gitignore`
- `.github/workflows/main-guards.yml`
- `.github/workflows/release.yml`
- `release-candidate.json`
- `docs/DECISIONS.md`
- `docs/WORKLOG.md`
- `docs/superpowers/specs/2026-07-30-plugin-release-pipeline-v2-design.md`
- `docs/superpowers/plans/2026-07-30-plugin-release-pipeline-v2.md`
- `docs/task-cards/plugin-release-pipeline-v2-001.md`
- `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`
- `scripts/check-plugin-release-identity.js`
- `scripts/plugin-release-identity-core.js`
- `scripts/plugin-release-candidate-core.js`
- `scripts/prepare-plugin-release-candidate.js`
- `scripts/install-plugin-release-candidate.ps1`
- `scripts/promote-plugin-release-candidate.js`
- `scripts/verify-plugin-release-candidate.js`
- `scripts/sync-plugin-release-mirror.js`
- `tests/plugin-main-ai.test.js`
- `tests/plugin-release-candidate.test.js`
- `tests/plugin-release-identity.test.js`
- `tests/release-governance.test.js`

## 目标

1. 本地测试对象成为不可变候选快照，避免测试后被其他任务覆盖。
2. `obsidian-plugin/wechat-inbox-sync/` 保持唯一源码，根目录发布文件只能由脚本单向生成并接受 CI 校验。
3. 权益测试不再因真实日期经过而失效。
4. GitHub Release 已成功且远端 annotated tag 正确时，发布后身份检查不再因 Runner 本地标签形态误报失败。

## 非目标

- 不修改插件业务逻辑、界面、同步、提取、OCR、ASR、Pro、飞书或队列行为。
- 不升级插件版本，不替换用户本地插件，不创建 GitHub Release。
- 不调整 CloudBase、业务数据、权限、市场状态或远端分支保护。
- 不在本任务中拆分 `main.js`。

## 前置事实与证据

- 当前正式稳定锚点为 `main@4405dcef28f4dea0d5a650f57e874c81175a3872`、插件 `1.3.74`。
- 权威插件源码为 `obsidian-plugin/wechat-inbox-sync/`，根目录四个发布文件是市场兼容镜像。
- 现有本地测试依赖人工复制与比较，没有不可变候选身份证。
- 当前 Release ZIP 除四个 loose assets 外还包含 `README.md`、`LICENSE`、`local-asr/` 和 `local-ocr/`；候选必须覆盖这套完整 ZIP 文件集。
- 当前公开仓库没有 `.gitignore`，实施时必须先精确忽略根 `/.artifacts/`。
- `tests/plugin-main-ai.test.js` 存在按墙上时间过期的固定日期样本。
- 发布工作流曾在 Release 与资产正确创建后，因 Runner 本地标签对象不是 annotated tag 而末尾误报失败；远端 GitHub tag API 已证实标签正确。

## 禁止动作

- 禁止修改 `obsidian-plugin/wechat-inbox-sync/main.js` 或根目录 `main.js` 的业务内容。
- 禁止发布、部署、上传、推送、合并、打标签或覆盖 Release。
- 禁止删除现有 Worktree、历史 tag、Release 或候选产物。
- 禁止读取或记录用户凭据、真实用户数据与插件 `data.json` 内容。

## 作者、审稿与验证

- 作者在专属 Worktree 中按 TDD 实现。
- 完成后由一名独立审查者覆盖路径边界、失败关闭和测试充分性。
- 本地用户试用前先验证候选安装不会覆盖 `data.json`。

## 验收

- 候选准备、安装、漂移拒绝、镜像生成、镜像漂移拒绝均有自动回归测试。
- 候选身份证覆盖四个 loose assets 与 Release ZIP 完整文件集，不含 `data.json`、缓存、日志或本机路径。
- 同一候选的源码、根镜像、候选包、本地安装目标、提交内 `release-candidate.json` 和 tag commit 哈希一致。
- 修改任一候选文件后，验证和晋升失败关闭。
- Windows CI 实际覆盖候选安装、整体回滚、错误目标拒绝和 `data.json` 原样保留。
- 时间测试在任意系统日期运行均稳定。
- postpublish 测试复现“本地轻量/缺失标签、远端 annotated tag 正确”的 GitHub Runner 场景并通过。
- prepublish 仍必须拒绝本地 lightweight tag。
- 现有发布身份、发布治理和插件核心定向测试全部通过。

## 已知风险

- 本任务只建立本地与 CI 管线；在其变更进入远端默认分支前，旧发布流程仍然存在。
- 用户本地 Obsidian 目录在仓库外，安装脚本必须显式接收目标路径并拒绝宽泛目录。

## 唯一下一步

完成设计文档书面复核并获得负责人确认后，编写逐步实施计划。

## 是否需要负责人决定

当前设计已经由负责人同意；开始编码前仍需负责人确认书面规格没有遗漏。
