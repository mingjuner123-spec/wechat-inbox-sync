# Worklog

### 2026-07-20 - 小红书图集只保留每页最高质量图片

- 目标：修复小红书 `imageList` 同一页同时包含缩略图与高质量图时，插件把两者都下载、写入笔记并重复 OCR 的问题。
- 影响范围：仅 Obsidian 插件的小红书结构化图片提取逻辑、回归测试和工作日志；未修改知识库内已安装插件、既有 Markdown、附件、云函数、小程序或线上数据。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`tests/plugin-main-ai.test.js`、`docs/WORKLOG.md`。
- 线上动作：无；尚未合并、发布或覆盖本地插件。
- 数据变更：无。
- 验证：先新增 `imageList` 每项同时含 `urlPre` 与 `urlDefault` 的回归样本，确认旧实现错误返回 4 张图；修复后只返回 2 张高质量 `urlDefault` 图片。`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node tests/release-governance.test.js` 和 `git diff --check` 通过，其中发布治理 122 项全部通过。
- 结果：结构化 `imageList` 现在保留图片对象边界，每个对象按 `original`、`urlSizeLarge`、`urlDefault`、通用 URL、最后才到 `urlPre` 的顺序只选择一个可用地址；低质量缩略图不会再被下载、写入笔记或 OCR。字符串形式的历史 `imageList` 继续走原有兼容路径。
- 已知风险：`tests/release-social-feishu-ai.test.js` 仍将版本硬编码为历史值 `1.2.97`，在当前 `1.3.51` 基线上失败，与本次图片修复无关；真实小红书页面字段若再次变化，仍需用新样本扩展字段优先级。
- 下一步：确认后合并并随下一插件版本发布；发布后用同一篇 8 页小红书笔记重新采集，验收只生成 8 张高质量图片且 OCR 不重复。

### 2026-07-20 - 小红书结构化高清图优先与匿名公开页提取（1.3.51）

- 目标：修复小红书图文同时保存 DOM 缩略图和结构化高清原图、8 张图变成 16 张的问题，并明确公开分享页无需登录即可提取的范围。
- 影响范围：Obsidian 插件小红书 HTML 提取、插件回归测试、版本元数据和文档；不修改小程序、云函数、绑定码、Pro 权益、本地 OCR/ASR 组件或用户知识库文件。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`tests/plugin-main-ai.test.js`、两份 `manifest.json`/`versions.json`、`tests/plugin-marketplace-package.test.js`、设计与实施计划及本工作日志。
- 线上动作：PR `#10` 通过 `guards` 与 `windows-deployer` 后合并为 `ee372d01152a78574b18f494eb9f1f761c097b15`；不可变标签 `1.3.51` 已推送；Release workflow `29749830080` 成功；GitHub Release 为 `https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.51`，包含五个标准资产。
- 数据变更：无。
- 验证：真实故障样本有 8 组内容相同但 URL、压缩质量和文件大小不同的缩略图/高清图，共生成 16 个有效 JPEG。无 Cookie 请求对应公开分享链接返回 HTTP 200、正确标题和结构化 `imageList`。新增测试在旧逻辑下稳定返回 4 张而非预期 2 张；实现后只保留结构化原图并保持顺序，DOM/meta 回退测试继续通过。
- 结果：存在有效结构化图集时，只使用该图集作为图片真源，不再混入网页 `<img>` 缩略图；结构化图集缺失时仍使用清洗后的 meta/DOM 图片。公开分享页的标题、正文和图片走匿名优先路径，登录会话继续仅作为评论区、受限页面和风控回退的增强能力。
- 已知风险：私密、删除、分享令牌过期或被小红书风控拦截的内容无法保证匿名提取；已同步成 16 张的历史笔记不会自动改写，需要重置对应同步记录后重新同步。
- 下一步：受影响用户更新到 `1.3.51` 后重置原同步记录并重新同步；确认 8 张图只生成 8 个高清本地附件。私密、删除、令牌过期或风控内容继续提示登录或保留失败诊断。

### 2026-07-20 - 修复 Windows OCR 安装目录占用并准备 1.3.50

- 目标：修复 Windows OCR 安装器在旧 `venv\Scripts\python.exe` 残留或被占用时继续原地安装并报 `Permission denied`，让普通用户无需结束进程或手动改目录。
- 影响范围：Windows OCR 安装器、插件启动时的待切换处理、安装状态提示、本地组件清单、插件发布元数据、回归测试和文档；macOS OCR、ASR、云函数、绑定码和 Pro 权益未修改。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr.ps1`、`obsidian-plugin/wechat-inbox-sync/main.js`、`obsidian-plugin/wechat-inbox-sync/local-ocr/README.md`、`obsidian-plugin/wechat-inbox-sync/local-components-manifest.json`、两份 `manifest.json`/`versions.json`、相关测试、设计与实施计划。
- 线上动作：PR `#8` 通过 `guards` 与 `windows-deployer` 后合并为 `fb0cbf08d06902b2ab66ec3d21b6d340fcd6b1bd`；受控脚本完成本地组件 CDN 部署及公网哈希校验；不可变标签 `1.3.50` 已推送，Release workflow `29744376519` 第 2 次运行成功；GitHub Release 为 `https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.50`。
- 数据变更：无。
- 验证：新增测试先分别因缺少 staging 事务标记和插件待切换能力失败；实现后 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node tests/release-governance.test.js`（122/122）、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、Windows PowerShell AST 语法解析和 `git diff --check` 通过。计划中引用的 `plugin-core.test.js` 与 `release-governance-integration.test.js` 在当前公开主分支不存在，已改跑实际的 `release-governance.test.js`。
- 结果：Windows 修复只保留一个正式 `venv`；新环境在 `venv-staging` 中创建和验证，使用短暂 backup 原子切换并支持失败回滚。若正式环境被占用，插件提示重启一次，并在下次 Obsidian 启动、OCR 尚未运行时自动完成切换和清理。正式插件 `1.3.50` 与新版 Windows OCR 安装器均已发布。
- 已知风险：持续性的 Windows Defender/第三方安全软件执行阻止仍可能让新环境无法通过健康检查；此时保留旧环境并报告安全软件/系统策略错误。尚未在受影响用户机器完成真实占用场景回归。
- 下一步：让受影响用户更新到 `1.3.50` 后点击一次“安装/更新本地转写组件”；若旧 OCR 进程仍占用环境，只需重启一次 Obsidian，插件会在下次启动自动完成切换。

### 2026-07-20 - 设计 Windows OCR 单目录自动修复

- 目标：解决 Windows OCR 安装器在旧 `venv\Scripts\python.exe` 残留或被占用时继续安装并报 `Permission denied`，同时避免要求普通用户结束进程或手动重命名目录。
- 影响范围：仅设计文档与工作日志；拟议实现限定为 Windows OCR 安装器和 Obsidian 插件本地组件调度。
- 修改文件：`docs/superpowers/specs/2026-07-20-windows-ocr-single-directory-repair-design.md`、`docs/WORKLOG.md`。
- 线上动作：无；未上传 CDN、未发布插件、未修改线上配置或业务数据。
- 验证：从 `origin/main` 创建隔离 worktree；基线 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 通过；设计自查覆盖根因、单目录事务安装、占用延迟切换、回滚、安装锁、状态刷新、兼容性和验收标准。
- 结果：确认永久只保留一个正式 `venv`；安装期间使用临时 staging，验证成功后切换，极端占用时由下次 Obsidian 启动自动完成，不要求用户操作任务管理器或目录。
- 已知风险：Windows 文件锁和安全软件拦截需要通过自动化契约测试与可控文件占用模拟验证；本设计尚未实现或发布。
- 下一步：用户复核书面设计后，编写 TDD 实施计划并实现、验证和发布下一插件版本。

### 2026-07-20 - Published Obsidian plugin 1.3.49: binding fallback and Xiaohongshu image localization

- Goal: stop generic HTTP 403 responses from being reported as invalid binding codes, prefer newly bound codes, let Feishu OAuth skip explicitly invalid stale bindings, and save Xiaohongshu images as local Obsidian attachments with platform session headers.
- Scope: Obsidian plugin runtime, plugin regression tests, release-governance fixture versioning, release metadata, design/implementation docs, and GitHub Release. No Mini Program, cloud function, CloudBase business data, user binding record, sync record, vault content, save-directory logic, or OCR installer was changed.
- Changed files: `obsidian-plugin/wechat-inbox-sync/main.js`, root/plugin `manifest.json` and `versions.json`, `tests/plugin-main-ai.test.js`, `tests/plugin-marketplace-package.test.js`, `tests/release-governance.test.js`, design/implementation docs, and this worklog.
- Online actions: PR `#6` passed required `guards` and `windows-deployer` checks and merged as `006f2daa84895a6a03482e15a682e51596cde390`; immutable tag `1.3.49` was pushed; Release workflow `29739186016` succeeded; GitHub Release is `https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.49`.
- Data changes: none.
- Verification: TDD reproduced the generic-403 misclassification before implementation. Fresh local checks passed: `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, `node tests/release-governance.test.js` (122/122), `node --check obsidian-plugin/wechat-inbox-sync/main.js`, `git diff --check`, and the public component CDN verifier. Authenticated release verification confirmed default-branch manifest/versions, Raw manifest, Latest/target Release, all five required assets, release manifest/versions, and the official ZIP manifest all report `1.3.49`.
- Result: only explicit invalid-token signals enter the binding-invalid flow; a successful new bind becomes primary; Feishu OAuth can try the next active binding; Xiaohongshu graphic-note images are downloaded with Referer/Cookie/User-Agent and replaced with local attachment links.
- Release package: official `wechat-inbox-sync-1.3.49.zip`, SHA-256 `B97C7C5B6E64D278F76E156AA5CE969E6442D09D55786021A2A4437872FA1A17`.
- Known risk: expired Xiaohongshu login, CAPTCHA, rate limiting, or expired image URLs can still prevent localization. The original remote URL is retained and body sync continues when an individual image download fails. Existing broken notes are not rewritten automatically and must be resynced.
- Next: affected users update to 1.3.49 and re-run the original Feishu/WeChat binding and Xiaohongshu graphic-note cases; investigate the separate Windows OCR install-permission issue afterward.

### 2026-07-20 - 插件 1.3.49：修复绑定码误报与小红书图片本地化（发布候选）

- 目标：避免把普通 HTTP 403 一律误报为绑定码失效，恢复新绑定优先和飞书多绑定回退；把小红书远程图片下载为 Obsidian 本地附件，避免 CDN 防盗链或临时链接导致破图。
- 影响范围：Obsidian 插件、插件测试、版本元数据、设计/实施文档和发布日志；不修改小程序、云函数、业务数据、保存目录逻辑或本地 OCR 安装器。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、插件与根目录 `manifest.json`/`versions.json`、`tests/plugin-main-ai.test.js`、设计/实施文档及本工作日志。
- 线上动作：待发布 1.3.49；尚未修改云函数、腾讯云 CDN、用户绑定记录、同步记录或知识库文件。
- 数据变更：无。
- 验证：TDD 先确认 1.3.48 会把普通 403 判为绑定失效；新增绑定分类、新绑定主序、飞书跳过旧失效绑定和小红书本地化请求头回归，最小实现后 `node tests/plugin-main-ai.test.js` 通过。完整发布门禁和线上发布检查待执行。
- 结果：发布候选中普通 403 保留原始业务错误，明确绑定失效才触发失效流程；新绑定成为主绑定；飞书 OAuth 可尝试下一有效绑定；小红书图文图片带平台 Referer/Cookie/User-Agent 下载并替换为本地附件链接。
- 已知风险：小红书登录失效、验证码、风控或图片 URL 已过期时仍可能下载失败；失败时保留远程 URL，不阻断正文保存。
- 下一步：完成插件回归、版本/ZIP 校验，推送默认分支与 1.3.49 标签，等待 GitHub Actions 创建 Release 后运行专用发布检查器。
### 2026-07-20 - Root-cause fix for cross-platform release-governance CI

- Goal: stop `Main guards` from failing on Ubuntu because it runs Windows-only PowerShell deployer probes, while preserving those probes as a required merge gate.
- Scope: GitHub Actions workflow, release-governance regression test, and release-governance documentation only. No plugin runtime, Mini Program, cloud function, CloudBase object, user data, entitlement, binding, or CDN bytes were changed.
- Root cause: PR #1's `guards` job ran on `ubuntu-latest`, but the test suite invoked `powershell.exe` and Windows `.cmd` fixtures. The same suite passed on Windows and therefore represented a platform-mismatched CI configuration rather than an ASR installer or GitHub Git service defect.
- Changed: added the `windows-deployer` job on `windows-latest` to run the full governance suite, plus a regression assertion that this job must exist with full checkout and Node 24. The current main baseline already skips Windows-runtime-only probes on non-Windows hosts; this change makes their Windows execution explicit rather than dropping coverage.
- Online action: PR #4 passed both required checks and was merged as `b2ed9f5aa3c2fa9b145dea9b2449def0dd1de002`. Main branch protection requires both `guards` and `windows-deployer` with strict up-to-date checks, includes administrators, and forbids force pushes and deletion. No release or CDN deployment was required.
- Data changes: none.
- Verification: TDD red test failed because `windows-deployer` was absent; green test passed after the workflow change. On Windows, `node tests/release-governance.test.js` passed 122/122. With `process.platform` simulated as Linux, 108 checks passed and exactly 5 Windows-only runtime probes skipped. Plugin regression tests, manifest `--check`, Git Bash syntax checks, and `git diff --check` passed. Docker/actionlint is unavailable locally; GitHub Actions remains the authoritative actionlint execution.
- Result: complete. PR-head checks passed, then the merge-triggered main run `29737321802` also completed with both `guards` and `windows-deployer` successful. An Ubuntu-only green result can no longer permit a merge that leaves the Windows deployer untested.
- Known risk: GitHub's branch-protection API cannot prove why PR #1 was merged after its failed check; the protection policy will be re-read after adding the second required context, and future merge attempts will be validated against both checks.
- Next: keep both required contexts in branch protection and investigate any future Linux or Windows failure independently; do not weaken one platform to make the other pass.

### 2026-07-20 - Windows ASR illegal-instruction compatibility fallback

- Goal: repair local ASR installation on Windows computers where the default whisper.cpp package exits with `0xC000001D` before transcription begins.
- Scope: Obsidian plugin local ASR installer, controlled local-component CDN deployment, compatibility-package build/verification tooling, regression tests, and documentation. No Mini Program, cloud function, binding, Pro entitlement, payment, sync data, or user vault data changes.
- Changed: the Windows installer keeps the optimized whisper.cpp package as the default. Only an explicit illegal-instruction exit (`-1073741795` / `0xC000001D`) triggers a separately cached baseline compatibility package. The archive is SHA-256 pinned; its metadata records whisper.cpp `v1.9.0` and disabled CPU extensions. The controlled deployer now verifies the supplied archive hash, publishes an immutable object before its compatibility alias, and verifies both CloudBase download and public CDN bytes.
- Online action: pending. The committed source and its exact compatibility archive must first be on current `origin/main`, then `scripts/deploy-local-components.ps1 -Execute -WindowsAsrCompatibilityArchivePath <verified archive>` can publish the installer and fallback archive together.
- Data changes: none.
- Verification: regression tests were added for the `0xC000001D` diagnostic and installer freshness contract; PowerShell AST parsing, manifest regeneration/check, deployer dry run, compatibility-package rebuild, extracted `whisper-cli --help`, plugin tests, and `git diff --check` passed locally before publication.
- Result: unaffected Windows users retain the existing optimized path. Affected CPUs or virtual machines no longer fail immediately; the installer retries once with the compatibility build and then runs the existing inference validation.
- Known risk: the fallback build was verified on the available Windows x64 host, not on the affected user's exact CPU/virtual-machine configuration. If the fallback fails, the user must return the new installer diagnostic for further investigation.
- CI follow-up: the protected-main `guards` workflow runs on Ubuntu, while several release-governance tests invoked `powershell.exe` unconditionally. Those Windows-only runtime probes now skip on non-Windows hosts; the workflow continues to parse all PowerShell sources with `pwsh`, and the probes still run on Windows development hosts.
- Next: publish the controlled CDN update, confirm public hashes, then ask the affected user to click “安装/更新本地转写组件” again. Failure-history logging is explicitly deferred.

### 2026-07-19～20 - 根治插件版本回退与本地组件发布源漂移（已上线）

- 目标：从发布体系根治“修复已经完成，但插件或代码更新后又退回旧版本”的问题；把当前 `origin/main`、正式插件发布源、GitHub Release 和腾讯云 ASR/OCR 组件绑定到同一个可验证的 Git 提交与 SHA-256 manifest。
- 根因：macOS ASR portable-Python 修复曾只存在于分叉开发线，不是正式 `1.3.48` 的祖先；腾讯云 `common` 路径可被任意旧 worktree 直接覆盖；旧 Release 流程不要求 tag 等于当前远端主线，也没有 committed manifest、不可变组件路径和持续漂移检测。混合换行又使“本地工作文件等于 CDN”不能证明“Git 中提交的 blob 等于 CDN”。
- 影响范围：插件发布治理、ASR/OCR canonical manifest、受控 CDN 部署、GitHub 主线/Release/每日完整性工作流和回归测试；未修改小程序、云函数、绑定码、Pro 权益、支付、同步业务数据或用户知识库。
- 变更：新增 canonical manifest 生成/校验、发布源与 tag guard、内容寻址不可变路径、通用 CDN 完整性验证器和默认 dry-run 的 PowerShell 受控部署器；保留旧 OCR 检查命令为通用验证器的薄兼容入口。主线/PR 工作流加入 actionlint、插件回归、manifest、JS/Bash/PowerShell 检查；Release 只接受当前主线上的数字版本 tag；每日任务检测不可变对象、兼容别名、公开 manifest 和固定 Python 运行时漂移。
- 防回退约束：正式插件源只认 `obsidian-plugin/wechat-inbox-sync/`；发布身份只认 commit identity；组件版本只认 canonical SHA-256；不可变对象先上传并验证，兼容别名后切换；紧急 CDN 热修必须在下一次插件发版前以相同字节回写主线。直接部署本地组件的 `tcb hosting deploy` 不再是支持的操作。
- TDD 与审查：release governance 测试从红灯开始覆盖旧分支/脏工作区/tag 版本错配、CRLF/LF 规范化、路径逃逸与 reparse point、不可变对象替换拒绝、CloudBase 严格 JSON envelope、真实 PowerShell dry-run/fake `tcb` 参数、工作流命令存在性与发布顺序。任务按实现、规格和质量三轮检查；最终质量审查为 Approved，无 Critical/Important 问题。
- 部署现场修复：第一次正式执行部署器时，CloudBase CLI 的正常进度行 `- Loading data...` 写到 stderr；普通命令封装在 PowerShell 5.1 的全局 `ErrorActionPreference=Stop` 下把它误判为 `NativeCommandError`，在任何上传前退出。先新增真实 `.cmd` 红灯用例，再让封装仅在原生命令调用期间使用 `Continue`、恢复原策略并以退出码判定成功；治理套件由 119 增至 120 项并全部通过。修复提交为 `fa19fea8efd21b45d0cb2b7ea6705226d04e5982`。
- 本地验证：`node tests/release-governance.test.js` 120/120、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、相关 `node --check`、manifest `--check`、Windows PowerShell 5.1 AST 与真实 dry-run、两份 macOS 安装器 `bash -n`、`git diff --check` 均通过。工作流固定 `docker://rhysd/actionlint:1.7.12` 作为 CI lint 门禁；当前 Windows 环境没有 Docker，因此未在本机执行该镜像。
- GitHub 线上动作：治理提交链已从官方热修主线 `d89e5e2` 快进推送到 `main`；完整治理提交为 `5c367e3e3280df30ccc480eb314f9438bd1f013b`，部署器 PowerShell 5.1 兼容修复为 `fa19fea8efd21b45d0cb2b7ea6705226d04e5982`。未创建新插件 tag 或 GitHub Release。
- CDN 线上动作：从干净且等于远端 `main` 的 `fa19fea` 执行 `scripts/deploy-local-components.ps1 -Execute` 成功。5 个 canonical 组件的完整 SHA-256 不可变路径、5 个兼容别名和 `local-components/manifest.json` 均完成 CloudBase 对象/公网验证；随后独立运行 `node scripts/check-local-components-cdn.js`，上述 11 个对象及 Windows、macOS arm64、macOS x64 三个固定 CPython 运行时全部哈希一致。
- GitHub 门禁状态：`Main guards` 工作流为 active，正式 push 运行 `29711600567`（`fa19fea`）已创建，但在本次收尾检查时仍处于 GitHub 托管 runner 的 `queued` 状态，尚未取得 success/failure 终态。GitHub 官方状态 API 同期显示 `Actions=partial_outage`、`API Requests=partial_outage`，与仓库多个新运行持续 queued 一致；没有把外部故障下的排队状态视为通过。
- 分支保护：浏览器没有 GitHub 登录态且本机没有 GitHub CLI，因此改用 Git Credential Manager 中已有的仓库凭据在单次 PowerShell 进程内调用 GitHub API；令牌未写入文件或输出。API 回读确认 `main` 已启用保护：required context 为 `guards`、`strict=true`、`enforce_admins=true`、禁止 force push、禁止删除。后续变更必须通过新门禁，管理员也不能直接绕过。
- 已知限制：CloudBase CLI 3.5.9 没有 hosting conditional-create，无法做到服务端原子“仅不存在时创建”；现以内容寻址、两次存在性检查、已存在对象下载验证和发布后 CloudBase/公网双校验失败关闭。
- 下一步：等待最新 `Main guards` 运行进入终态；若失败，按具体 job 日志修复。由于 GitHub 托管 runner 在本次收尾期间持续排队，不能把 queued 误报成门禁通过。

### 2026-07-18 - 热修 macOS Apple Silicon ASR 固定 Python 下载链

- 目标：修复 Obsidian 插件 `1.3.48` 在 macOS arm64 安装本地 ASR 时，`uv` 报 `No download found for request: cpython-3.12-macos-aarch64-none`，导致 whisper、ffmpeg、模型和转写脚本均未安装的问题。
- 根因：正式 `1.3.48` 和线上 CDN 都回退到了 uv-only 安装器；该脚本把 `UV_PYTHON_INSTALL_MIRROR` 指向自有 CDN，但 uv 请求的抽象别名与 CDN 上固定的 `cpython-3.12.13+20260623-...-install_only.tar.gz` 文件名不兼容。此前直接下载固定 Python 的修复存在于分叉开发线，没有进入后续正式发布源，CDN 又被旧脚本覆盖。
- 影响范围：Obsidian 插件 macOS ASR 安装器、安装器新鲜度校验、插件发布包回归测试、腾讯云静态托管；未修改 Windows ASR、OCR、小程序、云函数、绑定码、Pro 权益、支付或业务数据。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh`、`obsidian-plugin/wechat-inbox-sync/main.js`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`、`docs/WORKLOG.md`。
- TDD：先新增“uv-only macOS ASR 安装器必须被拒绝”和“发布包必须先使用固定 portable Python”的断言；在 `1.3.48` 基线上分别因旧校验返回 `true`、缺少 `PYTHON_BUILD_STANDALONE_VERSION` 而失败。合并前审查再补充“Python 归档解压前必须校验双架构 SHA-256”“严格核对已安装运行时版本”和“未来升级固定 Python 构建仍应被结构化校验接受”的红灯用例；实现后全部通过。
- 线上动作：已把最终安装器 `1.3.7` 上传到长环境静态托管 `local-asr/common/install-local-asr-macos.sh`。CloudBase 对象回读和带随机查询参数、`Cache-Control: no-cache` 的公网 CDN 回读 SHA-256 均为 `613E11D8B2CEFCCB45D2F5DD2D5CFA83ABDF9EB21302A0EDC656ABBCED9596D3`，与本地文件一致，且公网内容已确认包含 `INSTALLER_SCRIPT_VERSION="1.3.7"` 和 SHA 校验调用。未发布新的 Obsidian 插件版本。
- 数据变更：无。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、Git Bash `bash -n obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh`、`git diff --check` 均通过；CloudBase 环境列表确认目标为 `he02-d8gebzv050ed6c4ef-d350b93bf`；arm64/x86_64 两个固定 CPython 对象均返回 HTTP 200，两套 ASR wheelhouse 索引均包含 `whisper.cpp-cli==0.0.3` 和 `imageio-ffmpeg==0.6.0`。
- 结果：macOS arm64/x86_64 会优先从腾讯云 CDN 直接下载固定 CPython `3.12.13+20260623`，按架构校验 SHA-256 后才解压执行，用该运行时创建 ASR venv，并优先从腾讯 CDN wheelhouse 安装固定版本的 `whisper.cpp-cli` 与 `imageio-ffmpeg`；只有固定 Python 下载或建 venv 失败时才进入 uv 兜底。插件校验器最低要求安装器 `1.3.7`，并结构化检查 portable Python、双架构哈希、严格运行时版本校验及“直下优先、uv 兜底”的顺序，不再把 uv-only 脚本判为最新，也不把校验器锁死在某一个未来会升级的 Python 构建号。
- 已知风险：本轮没有在真实 Apple Silicon Mac 上完成从空目录到首次转写的端到端实测；首次安装仍依赖固定 Python 包、ASR wheels 和模型三个 CDN 资产可访问。`1.3.48` 的不可变 GitHub Release 资产仍内置旧脚本，但该版本每次安装都会优先拉取已热修的远端脚本。
- 下一步：让问题用户在 `1.3.48` 直接重新点击“安装/修复本地转写组件”并回传新诊断；若固定 Python 阶段通过但后续失败，按 wheel、模型或 Metal 推理验证阶段分别处理，不再混为网络问题。

### 2026-07-17 - Publish Obsidian plugin 1.3.48: reliable Feishu API image localization

- Goal: fix Feishu official API notes whose text and headings sync correctly but images appear as broken placeholders on only some user computers.
- Scope: Obsidian plugin Feishu image download/localization, focused plugin regression tests, and release metadata only. No Mini Program, cloud function, payment, binding, Pro entitlement, OAuth configuration, or online business data changes.
- Changed files: `obsidian-plugin/wechat-inbox-sync/main.js`, both release `manifest.json` / `versions.json` copies, `tests/plugin-main-ai.test.js`, `tests/plugin-marketplace-package.test.js`, and this worklog.
- Online actions: pushed release commit `a687730` to `main`, pushed tag `1.3.48`, and published GitHub Release `https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.48`. GitHub Actions Release run `29541164485` completed successfully.
- Data changes: none.
- Verification: `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, `node --check obsidian-plugin/wechat-inbox-sync/main.js`, and `git diff --check` passed. The release checker confirmed default-branch and raw manifests, versions mapping, tag, all required Release assets, and the local ZIP all report `1.3.48`.
- Result: Feishu image downloads now fall back from Obsidian `requestUrl` to the Node HTTP transport when needed; empty downloads also trigger fallback. Missing Feishu temporary image URLs and local download/write failures are recorded separately, and the final sync notice reports incomplete Feishu images instead of incorrectly reporting missing body text.
- Known risk: if both local transports are blocked, or the user's Feishu app lacks/requires renewed `docs:document.media:download` authorization, images still cannot be saved; the failure is now visible. Previously generated notes with expired links do not repair themselves. The historical `tests/release-social-feishu-ai.test.js` still pins release `1.2.97` and fails on every modern version; it is not part of the active Release workflow and should be retired or converted to version-agnostic assertions separately.
- Next step: ask affected users to update to `1.3.48`, save the original Feishu link again, and sync it again. If images still fail, collect the new focused diagnostic message to distinguish missing Feishu media authorization from local network failure.

### 2026-07-16 - 发布 Obsidian 插件 1.3.47：修复小红书通用落地页误同步

- 目标：修复部分用户未登录或匿名访问受限时，只保存“小红书 - 你的生活兴趣社区”、分享口令和失效封面，却被标记为同步成功的问题；保持匿名可读笔记无需登录即可快速提取。
- 根因：小红书会按链接参数、Cookie、风控和访问频率返回通用落地页。插件 `1.3.46` 只把持久 Electron 会话的渲染结果用于评论，没有用返回的 HTML 恢复正文；可读性判断又会把分享口令或默认图片误当真实内容，最终继续调用 `/synced`。
- 修改：新增通用落地页分类和严格成功判定；匿名 HTTP 已含真实标题、正文和图片时不启动浏览器；匿名结果不可读时复用插件现有持久小红书会话渲染一次，并让正文与评论共享该结果，同时用恢复出的真实标题覆盖已有通用标题。两条路径仍没有真实图文且也没有视频时，抛出 `XIAOHONGSHU_CONTENT_UNAVAILABLE`，由同步循环记录失败但不调用 `/records/:id/synced`，云端记录保留 pending。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`tests/plugin-main-ai.test.js`、`docs/superpowers/specs/2026-07-16-xiaohongshu-anonymous-extraction-fallback-design.md`、`docs/superpowers/plans/2026-07-16-xiaohongshu-anonymous-extraction-fallback.md`、`docs/WORKLOG.md`。
- TDD：先分别确认旧代码缺少通用页分类、不会调用正文渲染恢复、双路径通用页仍正常返回；实现后覆盖默认 Logo 误判、真实 `og:title`/正文/图片不受通用文档标题误伤、匿名快路 0 次渲染、渲染恢复正文/图片/评论且只调用 1 次、不可用记录不发送 `/synced`。
- 发布：默认分支已推进到版本提交 `13c80bf`，正式标签 `1.3.47` 已推送。GitHub Actions 运行 <https://github.com/mingjuner123-spec/wechat-inbox-sync/actions/runs/29494309338> 成功；正式 Release <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.47> 为 Latest、非 draft、非 prerelease，包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.47.zip`。
- 线上动作与数据：仅更新 GitHub 默认分支、标签、Release 和插件市场版本元数据；未改小程序、云函数、绑定码、Pro 权益、用户 Cookie、本地知识库、云端同步记录或腾讯云 OCR/CDN 文件。
- 验证：`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、四份发布 JSON 解析、`node scripts/check-local-ocr-cdn.js`、`git diff --check` 均通过。发布专用检查器已确认默认分支 manifest/versions、Raw manifest、Latest/目标 Release、五项资产、资产内 manifest/versions 与本地 ZIP 全部为 `1.3.47`。计划中误写的 `tests/plugin-upload-sync.test.js` 在 `1.3.46` 基线不存在；仓库根镜像移动测试为既有过期失败且不是正式插件发布源，未计入本次门禁。
- 本地包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.47.zip`；包内 manifest 为 `1.3.47`，根目录必需资产齐全，SHA-256 `2607A259FCD05E448D18F5C28E973AA602F81EC093D465301CF15668F019ED20`。
- 已知风险：小红书仍可能要求登录、验证码或触发风控；本修复不绕过平台限制，只复用用户主动建立的插件会话并避免把受限页误报成功。此前已经被云端标记为 synced 的坏记录不会自动回到 pending，需要后台重置或重新收集后再同步。
- 下一步：用户在 Obsidian 社区插件中检查更新到 `1.3.47` 并重载后，先直接重新同步新的小红书链接；若仍提示内容不可用，再在插件设置里登录小红书。此前已被标记 synced 的历史坏记录需先恢复为 pending 或重新收集。

### 2026-07-16 - 发布 Obsidian 插件 1.3.46：远端解绑恢复，并继承小红书评论稳定能力

- 目标：解决用户先在小程序解绑后，插件仍保留失效绑定、再次点击“解除本机”反而卡在“绑定码已失效”的问题；用户无需卸载插件即可清除旧绑定并绑定新码。
- 变更：在插件解除本机绑定的异常分支中，将服务端明确返回的 `Invalid or expired token` / `绑定码未绑定或已失效` 视为幂等解绑成功，复用 `markBindingUnbound` 清理本机旧 token、绑定列表及关联缓存，并提示用户旧绑定已同步清除。网络连接和服务端 5xx 等非失效错误仍保留本机绑定，避免误清除。
- 小红书评论：本版本继承正式 `1.3.45` 中已上线的小红书完整评论树收集、最终单一权威评论树渲染、重复/回复去重，以及“一级评论与回复合计最多 300 条、评论阶段最多 90 秒”的防卡死边界；稳定锚点 `xhs-comments-stable-1.3.42` 保持不变。
- Pro 防回退：未修改 `getProEntitlementStatusFingerprint`、权益刷新、缓存保留或设置页重绘逻辑；1.3.41 起的 Pro 有效期刷新改动被完整保留。
- 发布：`main` 已推进到 `142419e`，正式标签 `1.3.46` 已推送；GitHub Release <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.46> 为 Latest、非 draft、非 prerelease，包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.46.zip`。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node scripts/check-local-ocr-cdn.js`、版本 JSON 解析及 `git diff --check` 全部通过；发布检查已验证默认分支、raw manifest、Release 资产、Release ZIP 与桌面 ZIP 均为 `1.3.46`。
- 本地包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.46.zip`；SHA-256 `1721091BFF70421C491D2424C17DB1C05EB2FAF502D9C2FD7078FFD344D7DB42`。
- 数据变更：无；未修改小程序、云函数、绑定码/兑换码/Pro 业务数据、用户同步内容或任何知识库插件 `data.json`。

### 2026-07-16 - 修复小程序先解绑后插件卡住旧绑定码（候选，未发布）

- 目标：用户在小程序侧先解绑后，插件不再保留失效绑定并卡住“解除本机/立即绑定”；无需卸载重装即可输入并绑定新码。
- 根因：`unbindBinding` 调用 `/unbind-self` 时，服务端对已经在小程序解除的旧码返回 `Invalid or expired token` / `绑定码未绑定或已失效`。插件已有 `isBindingInvalidMessage` 分类函数，但解除绑定的异常分支没有使用它；历史回归还明确要求保留本地旧绑定，导致已失效状态被当作失败。
- 修改：仅在“解除本机”动作收到明确绑定失效信号时，将操作按幂等解绑处理，调用既有 `markBindingUnbound` 清除旧 token、绑定列表、关联兑换码/权益缓存，并显示“该绑定已在小程序解除，本机旧绑定已同步清除”。网络连接、服务端 5xx 等非失效错误仍保留本地绑定并提示失败。
- TDD：先把历史“失效码保留旧绑定”用例改为“远端已解绑必须清空本机”，旧实现红灯；最小修改后绿灯。新增网络 `socket hang up` 回归，确认不能误清绑定。
- 基线：修复提交在官方 `1.3.45` 基线（`d350ea8`）上重放；未改版本号、未发布市场、未安装到用户知识库。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`git diff --check` 均通过。
- 数据变更：无；未修改小程序、云函数、支付、绑定码、Pro 权益或本地插件 `data.json`。

### 2026-07-16 11:32 - 发布插件 1.3.45：小红书评论 300 条/90 秒上限与跨平台发布修复

- 目标：正式发布小红书评论一级评论与回复合计最多 300 条、评论阶段最长 90 秒的防卡死能力；同时修复首次接入 Ubuntu 发布回归后暴露的跨平台 ASR 安装路径解析问题。
- 影响范围：Obsidian 插件的小红书评论预算、ASR 安装路径解析、版本元数据、插件回归测试、GitHub Release；不修改小程序、云函数、绑定码、Pro 权益、腾讯云 CDN 文件或业务数据。
- 根因与修复：`1.3.44` 的 Actions 在 Ubuntu 上运行 `plugin-main-ai.test.js` 时失败。`extractLocalAsrInstallRootFromCommand` 虽按目标平台使用 `path.win32.normalize` / `path.posix.normalize`，随后却调用宿主系统的 `path.basename`，导致 Linux 无法识别传入的 Windows `transcribe.ps1` 路径。现改为按目标平台调用 `path.win32.basename` / `path.posix.basename`，并加入发布回归约束。
- 版本处理：保留已推送但未生成 Release 的不可变标签 `1.3.44` 及其 versions 历史，不移动标签；修复顺延为 `1.3.45`。默认分支与 `1.3.45` 标签指向提交 `356badc`。
- 线上动作：GitHub Actions 运行 `29469011916` 成功，正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.45>，为 Latest、非 draft、非 prerelease，包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.45.zip`。此次本地组件文件未变，只回读校验腾讯云 OCR 资产，未覆盖 CDN。
- 数据变更：无；未修改用户同步记录、笔记、插件 `data.json`、登录 Cookie、兑换码、权益或设备。
- 验证：TDD 先确认跨平台 basename 回归约束在旧实现失败，最小修复后通过；`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node scripts/check-local-ocr-cdn.js` 和 `git diff --check` 均通过。Actions 的 Ubuntu 回归、OCR CDN 校验和 Release 创建全部成功；专用发布检查确认默认分支、Raw manifest、Latest/目标 Release 和五项资产均为 `1.3.45`。另通过已认证 Release Asset API 验证正式 manifest、versions 与 ZIP 内 manifest 为 `1.3.45`，ZIP 必需文件无缺失，正式 ZIP SHA-256 为 `E750E60B5F80599FAF0A448574D47BBCBE528AA6A7BE81EC94EE23D6C534BBB9`。
- 本地包：`C:\Users\ADMIN\AppData\Local\Temp\wechat-inbox-sync-1.3.45.zip`，包内 manifest 为 `1.3.45`，SHA-256 为 `88991088A51730FF540E9FCBE1687AFE779F0E8C305F4A0E8616001DFB103744`。
- 结果：插件市场更新链路已发布 `1.3.45`；高热度小红书评论达到 300 条或评论阶段达到 90 秒时提前结束评论抓取，并继续保存正文、图片和已取得评论，不再无限停留在“正在处理”。
- 已知风险：平台验证码、登录失效或限流可能使 90 秒内取得的评论少于 300 条；本次没有在真实 4000+ 评论笔记上完成发布后端到端复测。`1.3.44` 标签存在但没有 Release，属于失败发布记录，不应被复用或移动。
- 下一步：让问题用户更新到 `1.3.45` 后复测高评论量笔记，确认最长约 90 秒后保存且诊断为 `total_limit_reached` 或 `time_budget_exceeded`；随后进入小程序首页客服气泡、Hermes/Codex/知识库分流和飞书人工介入的产品设计。

### 2026-07-15 21:42 - 限制小红书评论提取为 300 条和 90 秒

- 目标：解决高热度小红书笔记评论数达到数千条时，插件可能长期停留在“正在处理”且整条链接无法完成保存的问题；按用户确认的产品限制，将一级评论与回复合计设为最多 300 条，并把评论相关阶段的总耗时设为最长 90 秒。
- 影响范围：Obsidian 插件的小红书评论分页、回复补抓、DOM 滚动、调试器响应体收尾、最终评论树裁剪、诊断和回归测试；不修改小程序、云函数、绑定码、Pro 权益、ASR/OCR、腾讯云 CDN 或业务数据。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`tests/plugin-main-ai.test.js`、`docs/superpowers/plans/2026-07-15-xhs-comment-budget.md`、`docs/WORKLOG.md`。
- 线上动作：无；当前仍为基于插件 `1.3.43` 的独立候选工作区，未修改 manifest/versions，未推送、未创建标签或 Release，也未安装到用户知识库。
- 数据变更：无；未修改云端同步记录、用户笔记、插件 `data.json`、登录 Cookie 或本地组件。
- 验证：TDD 先确认旧实现未导出 300 条总量和 90 秒预算；新增评论树用例证明移除最终裁剪时会从 300 回退到 303，恢复后通过。`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`git diff --check` 均通过；生成的页面分页脚本另经 `new Function` 语法解析验证。
- 结果：评论页面从开始加载时创建唯一绝对截止时间，页面加载、分页接口、回复接口、DOM 滚动、调试器收尾和签名请求补抓共用该 90 秒预算；单次评论请求最多等待 10 秒。达到 300 条或 90 秒后停止评论阶段，诊断记录 `total_limit_reached` 或 `time_budget_exceeded`，正文、图片和已抓到的评论继续走原有保存流程。
- 已知风险：尚未在真实登录小红书账号下对 4000+ 评论笔记做候选版端到端计时；平台响应速度、验证码或限流可能使实际评论数低于 300，但不得再无限等待。评论总数按一级评论和嵌套回复共同计数，不等同于 300 条一级评论。
- 下一步：如需用户端生效，从线上 `1.3.43` 基线升级插件版本并发布；发布前用本次问题笔记验证总耗时不超过约 90 秒、最终诊断准确且链接正文和图片成功保存。

### 2026-07-15 15:37 - 固化小红书评论区稳定基线和回看流程

- 目标：把用户已经实测通过的小红书评论区实现做成长期可追溯基线，后续出现评论缺失、重复或回复层级错误时能够精确比较和恢复，而不是依赖聊天记录或整体回退插件。
- 版本锚点：创建并推送不可移动的 annotated tag `xhs-comments-stable-1.3.42`，与正式标签 `1.3.42` 同指向提交 `fd6183d`；评论核心修复为 `7058d4d`，同期必须保留的 Pro 有效期刷新提交为 `0e92e94`。
- 文档：新增 `docs/XHS_COMMENT_VERSION_BASELINE.md`，记录稳定标签、正式 Release、核心提交、Git blob、六项行为不变量、74 根/19 回复回归锚点、诊断字段、比较命令、安全恢复原则和下一稳定版本登记条件；`docs/DECISIONS.md` 同步增加标签不可移动及禁止整体硬回退的长期约束。
- 线上动作：仅向 GitHub 推送 `xhs-comments-stable-1.3.42` 标签和版本管理文档；不创建新插件版本、不覆盖 `1.3.43`、不修改插件运行代码或 Release 资产。
- 验证：标签对象说明包含真实复测日期、核心修复和 Pro 刷新提交；本地与远端标签均解析到 `fd6183d`，且与 `1.3.42^{commit}` 一致；插件主回归、市场包回归、语法检查和文档差异检查通过。
- 数据变更：无；未修改小程序、云函数、支付、绑定码、Pro 权益、同步记录、本地插件文件或用户 `data.json`。

### 2026-07-15 15:36 - 发布插件 1.3.43：修复正确 OCR 安装器被误判为过期

- 目标：解决 1.3.41/1.3.42 用户点击安装或修复 OCR 时提示 `Local OCR installer download returned outdated or invalid content`，恢复 Windows 与 macOS 图片 OCR 安装；从线上 1.3.42 增量发布，不回退小红书评论、ASR、抖音及既有 OCR 能力。
- 影响范围：Obsidian 插件 OCR 安装器新鲜度校验、插件版本元数据、回归测试、GitHub Release 工作流和发布文档；未修改小程序、云函数、业务数据、OCR 安装器、OCR Python 依赖或腾讯云 CDN 文件。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、根目录与插件目录的 `manifest.json` / `versions.json`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`、`.github/workflows/release.yml`、`docs/DECISIONS.md`、`docs/LOCAL_OCR_RELEASE_PREVENTION.md`、`docs/WORKLOG.md`。
- 根因：`1.3.38` 已把 Windows/macOS OCR 从 uv 下载 Python 切换为固定便携 CPython `3.12.13+20260623`，但插件下载后的校验仍要求 `Install-Uv`、`UV_PYTHON_DOWNLOADS` 等旧标记。腾讯云和随包安装器均为正确新版本，却在运行前被插件误拒绝，所以没有新 `install.log`，最终只显示 Python OCR 环境和脚本缺失。
- 修复与防复发：提取 Windows/macOS 共用的生产校验函数，按当前固定 Python、RapidOCR `1.4.4`、Pillow `12.3.0` 和镜像/venv 标记验证；测试直接把当前两端安装器原文交给该函数并加入旧标记负例。Release 工作流新增插件回归步骤，再结合公网 CDN 逐字节门禁，防止以后出现“CDN 文件正确、插件校验落后”的版本漂移。
- 线上动作：`1.3.43` 版本提交 `46e40b5` 与同名标签已推送，随后在默认分支补充未来发版门禁；正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.43>，包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.43.zip`，并标记为 Latest。此次腾讯云 OCR 文件本身正确，未覆盖 CDN，只做公网回读验证。
- 数据变更：无；未修改绑定码、兑换码、Pro 权益、设备、同步记录、用户笔记或本地插件 `data.json`。
- 验证：TDD 先确认旧代码没有当前 OCR 校验 helper，修改后 Windows/macOS 当前安装器通过、关键安装标记被替换时拒绝；`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node scripts/check-local-ocr-cdn.js`、JSON 解析和 `git diff --check` 通过。真实腾讯云 Windows/macOS 安装器通过生产校验函数；公网两端安装器、OCR 脚本和三平台固定 Python 运行时 SHA-256 与发布源一致。专用发布检查确认默认分支、raw manifest/versions、Latest Release、五项 Release 资产、Release 内 manifest/versions 和本地 ZIP 均为 1.3.43；下载后的四个独立 Release 文件与发布源规范化换行后逐字节一致，Release ZIP 内含完整 ASR/OCR 资产并保留 1.3.42/1.3.43 版本记录。
- 结果：用户更新到 1.3.43 后，可直接再次点击安装/修复 OCR；无需删除 ASR，也无需重新上传腾讯云组件。桌面手动安装包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.43.zip`，SHA-256 `70233CFEC8BF3AB05489EDAB71784E15B9C04DBF7ACB504654BAA5A5E047ACB5`。
- 已知风险：macOS 已验证安装器语法、双架构公网资产、生产校验和发布包完整性，但本次没有 Apple Silicon/Intel 真机端到端重装；若用户更新后仍失败，应复制新的 OCR 安装分阶段日志，此时已能越过本次安装器误判阶段。
- 下一步：让报错用户更新至 1.3.43，在插件设置中点击安装/修复 OCR；安装完成后确认“图片文字识别 OCR：可用”，再用一张小红书长图文做真实识别。

### 2026-07-15 15:35 - 发布小红书评论完整性修复 1.3.42，并确认后续 1.3.43 无回退

- 目标：把用户真实复测通过的小红书评论单一树修复发布为 `1.3.42`；必须以官方 `1.3.41` 为基线，完整保留新领取/续费 Pro 后立即刷新有效期的改动。
- 基线与合并：先把评论修复提交重放到 `origin/main@7a4433e`（包含 `1.3.41` 标签提交 `0e92e94`），再生成版本提交 `fd6183d`。`1.3.42` 的核心修复为 `7058d4d`：修正 `Array.map` 把索引误传成评论递归深度而导致仅前四条根评论保留回复的问题；最终收尾统一删除旧评论区并只渲染一次权威评论树，同时保留 emoji 去重、主评论/回复独立进度及 `lost_*` 诊断。
- Pro 防回退：相对 `1.3.41`，评论修复没有修改 `getProEntitlementStatusFingerprint`、`proEntitlementLastError`、强制刷新/no-cache、接口异常时保留既有有效权益、无效缓存继续复查云端或设置页权益变化重绘逻辑；对应回归用例仍全部通过。
- 发布：默认分支与标签 `1.3.42` 已推送至提交 `fd6183d`，正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.42>，包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.42.zip`。随后并发任务发布了 `1.3.43`（提交 `46e40b5`），其父提交正是 `fd6183d`，因此完整继承 `1.3.42` 评论修复与 `1.3.41` Pro 刷新，仅追加 OCR 固定 Python 安装器兼容修复；未用旧基线覆盖远端。
- 验证：在最新 `1.3.43` 继承链上重新运行 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node scripts/check-local-ocr-cdn.js` 和 `git diff --check`，全部通过。专用发布检查器确认默认分支、raw manifest、latest Release、五项 Release 资产、资产内 manifest/versions 和本地 ZIP 均为 `1.3.43`；版本历史同时保留 `1.3.41`、`1.3.42` 和 `1.3.43`。
- 本地包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.42.zip`，SHA-256 `53D8C12EE998E4F9FB8B5702E657570D6F3E993472D9052BC061D3313114BCB1`；后续最新包为 `C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.43.zip`。
- 数据变更：无；未修改小程序、云函数、支付、绑定码、Pro 业务数据或本地插件 `data.json`。

### 2026-07-15 14:50 - 发布插件 1.3.41：新领取体验立即刷新并保留 1.3.40 全部能力

- 目标：用户在小程序领取或续费体验后，插件能够立即查询到有效权益并使用 Pro 功能；发布必须从线上 1.3.40 基线增量制作，不能回退 1.3.40 已有的转写正文保留、OCR、ASR、抖音等能力。
- 根因：旧逻辑会把权限接口异常合成为 `inactive`，设置页又会在 6 小时内复用近期无效缓存，导致真实有效权益仍显示“未开通或已过期”。
- 修改：只有云端明确返回无权限时才缓存无效状态；强制刷新增加 no-cache 请求头；查询异常保留原有效缓存并写入诊断；近期无效缓存不再阻止云端复查；设置页在权益变化后自动重绘。同步更新两份 `manifest.json` / `versions.json` 和插件回归测试。
- 防回退：候选分支从 `origin/main@974027d`（1.3.40 发布记录）建立，不使用旧 1.3.36 修复分支直接发版；相对 1.3.40，`styles.css`、README、LICENSE、`local-asr/`、`local-ocr/` 均保持不变；两份 `versions.json` 同时保留 `1.3.40` 并新增 `1.3.41`；1.3.40 的转写幻觉尾段保留回归与完整插件测试均通过。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`git diff --check` 均通过；`node scripts/check-local-ocr-cdn.js` 验证 Windows/macOS OCR 安装器、OCR 脚本及三平台固定 Python 运行时公网 SHA-256 全部一致；发布检查确认默认分支、raw manifest、latest Release、五项发布资产和本地 ZIP 均为 1.3.41。GitHub 展示的四个独立发布文件 SHA-256 与 `1.3.41` 标签 Git blob 逐字节一致。
- 线上动作：默认分支与标签 `1.3.41` 已推送至提交 `0e92e94`；正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.41>，包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.41.zip`，并标记为 Latest。此次未修改本地组件，因此未覆盖腾讯云 CDN 文件，只执行一致性门禁。
- 本地包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.41.zip`，SHA-256 `B2B563B2C1D7F97ED48DF0D5B54D6DA5AD6A4D62BE383C1EC5256A5E8B0310A0`；包内 manifest 为 1.3.41，versions 同时包含 1.3.40 和 1.3.41。
- 数据变更：无；未修改小程序、云函数、兑换码、绑定码、权益、设备、同步记录或本地插件 `data.json`。

### 2026-07-15 14:50 - 安装 1.3.41 小红书评论单一树候选版（待真实复测，未发布）

- 目标：修复三篇真实小红书笔记中网络已捕获回复、最终 Markdown 却大量丢失，以及 `[doge]`/无 emoji、绝对/相对时间副本重复的问题；先安装本地候选版复测，真实样本通过前不发布插件市场。
- 影响范围：仅 Obsidian 插件的小红书评论合并、Markdown 渲染、采集进展诊断、版本元数据和回归测试；不修改小程序、云函数、登录、支付、Pro、媒体下载、ASR/OCR 或业务数据。
- 根因证据：现有三篇笔记诊断分别为 `19→3`、`6→4`、`39→23` 条回复，合计捕获 64 条、最终仅 30 条。生产形态红灯复现中，74 根/19 回复的评论树经旧 Markdown 渲染后精确变成 74 根/4 回复。原因是 `buildSocialCommentsMarkdown` 直接把带 `depth` 参数的 `normalizeSocialComment` 传给 `Array.map`，导致根评论下标被误当成递归深度，只有前 4 个根评论渲染回复；最终流程还会在正文已有局部 `## 评论区` 时跳过权威评论树。
- 修改：改用单参数回调调用递归标准化；新增唯一 `finalizeXiaohongshuComments` 收尾入口，先移除旧评论区，再从浏览器最终评论树完整渲染一次，浏览器已有评论树时不再与初始静态 HTML 二次通用合并；无 ID 去重忽略 `[doge]` 等展示型方括号 emoji；主评论进展与回复进展分开统计，并新增 `root_requests`、`reply_requests`、`partial` 诊断字段。
- TDD：先新增 74 根/19 回复、已有 3 条旧回复、emoji/时间变体、不同 ID 同文案和“只有回复增长”进展判定用例；旧实现先因缺少最终入口失败，最小实现后进一步暴露 19→4 的真实渲染缺陷；修复后评论树与 Markdown 均保持 74/19，旧评论区被替换，`lost_root=0`、`lost_replies=0`。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 与 `git diff --check` 通过；直接加载已安装运行文件复放 74/19 fixture，树统计和 Markdown 统计均为 74/19，旧评论区已移除。
- 本机安装：已把候选 `1.3.41` 的 `main.js`、`manifest.json`、`styles.css` 安装到 `D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync`；备份位于 `C:\Users\ADMIN\AppData\Local\Temp\wechat-inbox-sync-before-1.3.41-20260715-144657`。三项运行文件与发布源 SHA-256 一致；安装前后 `data.json` SHA-256 均为 `EE9B321B531A7592FAEB80738FE8D64BD81330EBD10A4F600EAC9D5C1A43E665`。
- 线上动作：无。未推送默认分支、未创建 `1.3.41` 标签或 GitHub Release、未发布插件市场。
- 已知风险：当前运行中的 Obsidian renderer 仍需用户重载后才会加载候选代码；平台登录态或风控可能让评论源本身不完整，此时新诊断应显示 `partial=1`，但插件内部不得再把已捕获回复丢掉。
- 下一步：用户重载 Obsidian 后重新同步三条问题小红书记录；核对新笔记 `merged_replies=final_replies`、`lost_root=0`、`lost_replies=0`，可见评论无跨来源重复，并检查 `partial/stop` 是否准确。通过后再发布 1.3.42。

### 2026-07-15 14:00 - 发布插件 1.3.40：保留抖音转写正确正文并截断重复幻觉尾段

- 目标：解决抖音链接已下载、Whisper 已转写到 100%，但因为片尾出现大量重复句而把整条同步判为失败的问题；优先保留已经正确转出的正文，同时继续拒绝纯重复或正文不足的低质量结果。
- 影响范围：Obsidian 插件的本地音视频转写结果清理、插件版本元数据、回归测试与 GitHub Release；不修改小程序、云函数、支付、绑定码、Pro 权益、ASR/OCR 安装器或业务数据。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、根目录与插件目录的 `manifest.json` / `versions.json`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`。
- 根因证据：同一条待同步抖音真实媒体被本地 ASR 分为 3 个音频块，前 48 行为完整的正常中文正文；结尾 18 行包含高频“画面的画面”、字幕署名、短英文和无关短词。旧的尾部清理器会被最后一个无关短词提前截断，随后质量门禁检测到前面的循环并拒绝整条结果。
- 修改：尾部清理器仅在最后 36 行内发现同一句至少重复 6 次、且此前至少已有 80 个字符的正文时，从首次循环处裁掉尾部；同时向前去掉紧邻的字幕署名、短英文和“画面…画面”噪声。纯循环结果、正文过短结果和正文中偶发的正常重复仍交由原有质量门禁拒绝。
- 数据变更：无。已把候选 `main.js` 与 `manifest.json` 安装到本机知识库插件目录，安装前备份为 `.backup-before-1.3.40-20260715-135655`；安装操作未写入 `data.json`。
- 验证：先新增“正确正文 + 短噪声 + 13 次重复画面 + 字幕尾巴”的回归用例，旧实现失败、修改后通过；`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node scripts/check-local-ocr-cdn.js` 与 `git diff --check` 均通过。对真实抖音媒体重新运行本地 ASR 后，清理结果从 66 行保留为前 48 行，质量检查无异常。线上 Release 的 `main.js` 与发布源按规范化换行计算的 SHA-256 一致，且包含本次尾部循环修复标记。
- 线上动作：默认分支已推送提交 `567fed1`，标签 `1.3.40` 已推送；GitHub Actions Release `29392902080` 成功，正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.40>，包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 与 `wechat-inbox-sync-1.3.40.zip`。`check_obsidian_release.ps1` 已验证默认分支、Release 和 ZIP 均为 1.3.40。
- 结果：失败记录可在重载后的 1.3.40 中重新同步，无需重新发送链接；正确正文会保留，已识别的循环尾部不会再导致整条作废。
- 已知风险：静音、片尾字幕或原始音频极差时 Whisper 仍可能产生其他类型错误；本次只对具有高频重复特征且明确位于正文后方的尾段裁剪，不会擅自改写正文内容。
- 下一步：重载或重启 Obsidian 后重新同步现有待处理抖音记录，确认生成的笔记含完整正文且不含重复尾巴；若仍异常，收集新生成的 `transcribe-last.log` 与对应笔记，不用旧日志替代现场证据。

### 2026-07-15 13:26 - 发布插件 1.3.39：恢复小红书/抖音视频的本地转写链路

- 目标：处理用户反馈的“小红书视频口播文案为空”和抖音链接无法进入下载/转写；优先恢复解析和转写成功，同时不重新引入 `bytedance://` 外部应用唤起。
- 根因证据：本机 `小红书-小红书口播文案.md` 已保存视频、图片和评论，但转写段为“未配置可用的音频转写方案”；同机 `data.json` 的 Pro 权益和本地 ASR 均可用，却保留了历史 `aiProvider: "off"`。旧逻辑把该遗留值当成明确禁用，绕开本地 ASR。抖音短链 `v.douyin.com/blEhzLRl0e8` 可解析精确 `aweme_id=7659778280362429711`，但桌面详情页/API 返回空正文，`yt-dlp` 也要求新鲜 Cookie；同一作品的匿名移动分享 SSR 页则包含精确作品的 `aweme.snssdk.com/aweme/v1/playwm` 媒体地址，且实际响应为 MP4。
- 修改：当用户具备有效 Pro 权益且已可运行本地 ASR 时，遗留的 `aiProvider: "off"` 自动走本地转写，不影响真正不可用或无权益的情形。抖音解析新增匿名移动分享 SSR 优先路径，严格按目标 `aweme_id` 提取媒体，识别 `snssdk.com` 播放地址；只有该路径无结果才保留原详情 API、Session 和隐藏浏览器兜底。未使用或恢复 `bytedance://` 协议。
- TDD 与验证：先新增“Pro + 本地 ASR 可用 + 历史 off 配置必须自动转写”和“分享页混有推荐作品时只能取目标 aweme 媒体”的回归，旧代码分别失败；实现后 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node scripts/check-local-ocr-cdn.js`、版本 JSON 解析和 `git diff --check` 全部通过。真实移动分享 HTML 也已用本次目标作品验证可提取其精确播放地址。
- 本机安装：已将 `main.js` 与 `manifest.json` 安装到 `D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync`，版本为 `1.3.39`；安装前备份位于 `.backup-before-1.3.39-20260715-132547`，安装前后 `data.json` SHA-256 一致，未改绑定码、Pro 缓存或用户设置。
- 发布：默认分支已推送提交 `b0db3a5`，标签 `1.3.39` 已推送，GitHub Actions Release 成功。正式 Release：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.39>；资产包含 `main.js`、`manifest.json`、`styles.css`、`versions.json`、`wechat-inbox-sync-1.3.39.zip`。桌面安装包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.39.zip`，SHA-256 `3483D677A9ECEBD8677792DA29706CBA92549E428D0F914282E2DF13EE634ECF`。
- 市场验证：`check_obsidian_release.ps1` 已确认 `main` 与 Raw manifest/versions、正式 latest Release、五项 Release 资产、Release asset manifest/versions 与本地 ZIP 都是 `1.3.39`。
- 已知风险：抖音移动分享页属于平台公开 SSR 输出，页面字段或反爬策略未来仍可能变化；此时插件会继续走原有详情 API、Session 和隐藏浏览器兜底，但不能保证被平台限制的视频一定可下载。转写内容质量仍依赖本地 Whisper 与原音质量，本次修复的是“未进入转写/无目标媒体”的链路问题。
- 下一步：重载或重启 Obsidian 使已运行的 renderer 加载 1.3.39，然后用一条新的小红书视频和当前抖音链接各同步一次；确认笔记同时出现媒体附件与“口播/音频文案”。

### 2026-07-15 12:35 - 发布插件 1.3.38：固定 OCR Python 运行时并清理抖音转写结尾幻觉

- 目标：修复 Windows/macOS 用户在已有 Python 3.13+ 时无法安装 OCR 的问题，并把上一任务已完成的抖音转写结尾幻觉清理合并发布为插件市场 `1.3.38`。
- 影响范围：Obsidian 插件 / Windows 与 macOS 本地 OCR 安装器 / OCR CDN 发布门禁 / 插件版本元数据 / 文档；不修改小程序、云函数、支付、绑定码、用户数据或本地插件 `data.json`。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr.ps1`、`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr-macos.sh`、两份 `manifest.json`、两份 `versions.json`、`scripts/check-local-ocr-cdn.js`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`、`docs/DECISIONS.md`、`docs/WORKLOG.md`。
- 线上动作：已将 Windows/macOS OCR 安装器和 `ocr_image.py` 上传到长环境静态托管 `local-ocr/common/` 并通过公网逐字节校验；已快进推送官方 `main`，创建并推送 tag `1.3.38`，GitHub Release 已发布且包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.38.zip`。
- 数据变更：无。
- 验证：回归测试先在旧实现上因缺少固定 Python 运行时失败，实现后 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node --check scripts/check-local-ocr-cdn.js`、Windows PowerShell 解析和 macOS Bash `-n` 均通过；在完全隐藏系统 Python 的全新 Windows 临时目录中实跑安装器，成功下载 CPython `3.12.13+20260623`、创建隔离 venv、从 CDN wheelhouse 安装并导入 RapidOCR，真实图片 OCR 输出 `TEST 123`；`node scripts/check-local-ocr-cdn.js` 验证三份 OCR 文件及 Windows/macOS 三个平台 Python 运行时 SHA-256 全部一致；`check_obsidian_release.ps1` 对 `1.3.38` 的默认分支、raw manifest、Release 资产和本地 zip 检查全部通过。
- 结果：系统 Python 3.13+ 不再被误判为可直接使用，也不会被卸载或降级；OCR 会优先复用兼容的 Python 3.10-3.12，否则直接下载插件专用的固定 Python 3.12.13，不再由 uv 猜测镜像版本。插件市场 `1.3.38` 同时包含抖音已知结尾幻觉清理。
- 已知风险：macOS 安装器已通过语法、双架构运行时公网哈希和包索引验证，但本次没有 Apple Silicon / Intel 真机端到端安装；仓库中历史移动端镜像测试与当前 `isDesktopOnly: true` 发布源不一致，仍处于既有失败状态，本次未扩展范围修复。
- 下一步：让报错用户更新到 `1.3.38` 后重新点击安装/修复 OCR；若仍失败，收集新的 OCR 安装日志，重点核对运行时下载、解压、VC++ 修复或 RapidOCR 导入阶段。

### 2026-07-15 12:15 - 识别并清理抖音本地转写的少量片尾字幕幻觉

- 目标：处理 `1.3.37` 已完成到 100% 且主体正确，但笔记末尾混入“明镜点赞话术、无关食材、MING PAO、CC 字幕制作”等少量非正文的问题；保持解析成功和正文召回优先。
- 现场：`D:\内容创作系统\张张的内容创作知识库\临时收集\2026-07-15\抖音-抖音口播文案.md` 主体与源抖音教程一致，真实结束语后多出 6 行跨主题内容；同步日志为 success，说明不是下载/转写未完成。后续同批第二条转写正常，进一步排除组件整体损坏和媒体串线。
- 根因：Whisper small 在片尾音乐/静音上生成了少量训练字幕语料幻觉；现有质量门只拒绝提示词泄漏和大量重复，现有尾部清理器也只识别以“字幕/翻译/制作”开头的署名，未命中该组以“请不吝点赞…明镜”起始、以括号 CC 字幕结尾的组合，因此按成功保存。
- 修复：`cleanTrailingTranscriptionHallucinations` 仅检查最后 12 行，在同时出现“请不吝、点赞、订阅、转发、打赏、明镜”的高度特异组合指纹时，从该行截断；保留此前真实结束语，不改变 Whisper 参数、媒体候选、正文转写或失败回退。
- TDD：先把本次真实尾部样本加入 `plugin-main-ai.test.js`，确认旧实现完整保留污染并红灯；最小实现后同一回归通过，已有“正文中提到错听案例不得误删”等保护样本继续通过。
- 用户笔记：已删除该文件结束语后的 6 行确定性幻觉；正文里的“小某书”等少数同音误识别未擅自改写，避免在缺少原音时间戳时改变用户表达。
- 当前状态：修复位于分支 `codex/fix-transcript-tail`，尚未改版本、安装或发布插件市场；完成完整回归后等待是否发布下一版本。

### 2026-07-15 11:50 - 基于正式 1.3.36 发布 Obsidian 插件 1.3.37，修复抖音 Session 永久等待

- 目标：用户确认云端已更新到 `1.3.36`，要求只以该正式版本为基线发布 `1.3.37`，随后从插件市场更新并复测抖音；不得用旧候选覆盖 `1.3.36` 的 OCR 发布修复。
- 基线与合并：远端 `origin/main@822f4cb`、标签 `1.3.36@bb0c6e9` 已包含 OCR 资产 LF 固定和公网一致性门禁，但不包含抖音 Session 墙钟超时。新分支从 `origin/main` 建立，仅移植经红绿测试的修复为 `9ae5ce7`，版本提交为 `823ab0e`；保留 1.3.36 全部内容。
- 根因与修复：`session.fetch()` 即使收到 `AbortSignal`，Electron 远端 Session 仍可能不结算请求 Promise，令流程永久停在 `processing`、无法进入隐藏浏览器和 ASR。`readSessionFetchText` 现在对 `fetch + response.text` 完整任务使用主进程墙钟 `Promise.race`；超时只结束当前 Session 尝试，继续原有浏览器解析、目标作品 ID 校验、媒体候选和本地转写路径。
- TDD 与回归：先用永不 settle 且忽略 abort 的 Session 复现旧实现 250ms 后仍为 `hung`，修复后同一样本按预算返回并继续兜底。`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、四份版本 JSON 解析和 `git diff --check` 全部通过；测试前后已备份并恢复真实 `sync-last.log`。
- OCR 发布门禁：`node scripts/check-local-ocr-cdn.js` 通过，Windows 安装器、macOS 安装器和 `ocr_image.py` 公网 SHA-256 均与 `1.3.36` 基线发布源一致，没有绕过已有门禁。
- 发布：默认分支已推到 `823ab0e`，标签 `1.3.37` 已推送，GitHub Actions 成功创建 latest、非 draft、非 prerelease Release：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.37>。资产包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.37.zip`。
- 市场验证：专用检查器确认默认分支 manifest/versions、Raw manifest、latest/目标 Release、五项 Release 资产、资产内 manifest/versions 与本地 ZIP 全部为 `1.3.37`，满足 Obsidian 社区插件市场发现与更新条件。
- 本地包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.37.zip`，SHA-256 `7E96D1027F081E405EC7BD5D9942F1A12594A63D4AE64F7FB648A407CFB268B0`，包内 manifest 为 `1.3.37`。按用户要求未直接覆盖知识库插件，等待用户从插件市场更新后做真实抖音复测。
- 下一步：用户在 Obsidian 社区插件中检查更新到 `1.3.37`，按 `Ctrl+R` 或完整重启后重新同步当前 pending 抖音记录；观察流程是否进入下载/转写或明确失败，并核对不再永久停留在 processing。真实平台解析成功仍受抖音风控与媒体可用性影响，本次修复保证 Session 无响应时能够继续现有兜底路径。

### 2026-07-15 11:40 - 发布 1.3.36，回退 PDF OCR 并建立 OCR CDN 发布门禁

- 目标：PDF 恢复文本层提取/原附件保留，不再触发耗时本地 OCR；保留小红书长图文图片 OCR；修复插件与腾讯云组件版本漂移，并建立防复发门禁。
- 影响范围：Obsidian 插件 / Windows 与 macOS 本地 OCR 组件 / 腾讯云静态托管 / GitHub Release / 发布工作流 / 文档。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`obsidian-plugin/wechat-inbox-sync/local-ocr/*`、`manifest.json`、`versions.json`、插件目录版本文件、`.github/workflows/release.yml`、`.gitattributes`、`scripts/check-local-ocr-cdn.js`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`、`docs/LOCAL_OCR_RELEASE_PREVENTION.md`、`docs/DECISIONS.md`、`docs/WORKLOG.md`。
- 线上动作：已上传 Windows OCR 安装器、macOS OCR 安装器和 `ocr_image.py` 到长环境静态托管 `local-ocr/common/`；已推送 `main` 和正式标签 `1.3.36`，GitHub Actions Release 成功，正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.36>。`1.3.35` 标签因首版字节门禁发现 CRLF/LF 差异而失败，未创建 Release，未强推改写，版本顺延。
- 数据变更：无；未修改业务数据环境、绑定码、Pro 权益或同步记录。
- 验证：先确认 `1.3.31` PDF OCR 代码晚于 CDN Windows/macOS 安装器、运行脚本和 wheelhouse；回退测试先因生产代码仍要求 PDF 依赖而失败，实现后 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、PowerShell/ Bash 安装器语法检查通过。GitHub `1.3.36` Release 工作流成功；Raw manifest 缓存绕过返回 `1.3.36`；五项 Release 资产直链存在，Release ZIP 内 `manifest.json` 为 `1.3.36`。完整目录中的旧移动端测试仍因桌面专用根代码加载 `child_process` 失败，`release-social-feishu-ai.test.js` 仍引用已经移除的历史 helper，两者均为 `origin/main@1.3.34` 既存问题且不在上一版插件发布门禁中，本次未伪装为通过。
- CDN 公网 SHA-256：Windows 安装器 `174647158C74606FF14FD024751DF0144F8B0B26D3A307B52E6CA929CBE46928`；macOS 安装器 `8367432F693248E196F8F5EC588E61ED7E5952C8D491C4E62D9236B4B67519A5`；OCR 运行脚本 `52D32BFB9384EC5BE1DBFB25938D6316A46A51D7B56A43A9C40552BD1F2DE291`。
- 结果：PDF 提取失败时保留原附件，不安装/升级/调用 OCR；图片 OCR 继续使用 RapidOCR + Pillow。tag 发布前会从公网下载三份 OCR 资产并与仓库 LF 发布字节做 SHA-256 比对，任一不一致则禁止创建 Release；`.gitattributes` 固定三份资产为 LF。
- 已知风险：当前 CDN 仍使用可覆盖的 `local-ocr/common/*` 路径，自动门禁能阻止发布时漂移，但不能提供不可变历史版本；GitHub 公共 API 检查期间遇到匿名限流，已改用 Release 直链和 Raw 缓存绕过完成验证。
- 下一步：把组件迁移到 `local-ocr/releases/<componentVersion>/`，生成含 Git 提交、平台和 SHA-256 的 manifest；插件固定组件版本，升级/回滚只切换 manifest 指针，不覆盖历史文件。

### 2026-07-15 11:17 - 正式发布 Obsidian 插件 1.3.34：统一小红书完整评论与抖音超时边界

- 目标：纠正市场版本停留在 `1.3.33`、本机已使用合并版 `1.3.34` 的版本不一致；以正式 `1.3.33` 小红书评论完整性修复为基线，叠加抖音隐藏浏览器非阻塞启动和有界收尾，统一发布 `1.3.34`。
- 用户决策：用户明确指出后续更新应基于已安装的 `1.3.34`，并沿用此前“直接推到插件市场”的发布授权；因此不再把合并版保留为仅本地候选。抖音真实链接的成功率仍受平台 Session/风控影响，但本次自动化回归已证明可选浏览器 Promise 不会无限阻塞。
- Git 与线上动作：`main` 已从 `ba7ca3f` 快进到合并提交 `6e751e7`，标签 `1.3.34` 已推送并触发 GitHub Actions；正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.34>，latest、非 draft、非 prerelease。
- 发布资产：Release 包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 与 `wechat-inbox-sync-1.3.34.zip`；本地安装包为 `C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.34.zip`，包内 manifest 为 `1.3.34`，SHA-256 为 `E3CFA214095D1AAF710A87744749F316B1F3236E635524A2157065B3F18D5ECD`。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、四份版本 JSON 解析和 `git diff --check origin/main...HEAD` 均通过；测试前后真实 `sync-last.log` SHA-256 都是 `F8E191A00E2B583DFA43DCBF266806F8548A71600E6FE0817846ACF6D536F02B`。发布清单中的 `tests/plugin-core.test.js` 与 `tests/plugin-upload-sync.test.js` 当前仓库不存在，已如实记录，未伪装为通过。
- 市场检查：专用发布检查器确认默认分支 manifest/versions、Raw manifest、latest/目标 Release、五项 Release 资产、资产内 manifest/versions 和本地 ZIP 全部为 `1.3.34`，满足 Obsidian 社区插件市场自动更新条件。
- 风险与下一步：本机磁盘已安装合并版，但用户仍需在 Obsidian 中按 `Ctrl+R` 或完整重启，让运行中的旧 renderer 加载 `1.3.34`。随后分别复测小红书评论诊断 `lost_root=0/lost_replies=0`，以及抖音在有界等待后进入下载/转写或明确失败、不再无限停留在“正在处理”。

### 2026-07-15 11:02 - 合并小红书 1.3.33 与抖音 1.3.34 候选并重新安装

- 目标：处理并发发布冲突，避免旧 `1.3.32` 基线上的抖音候选覆盖已正式发布的小红书 `1.3.33` 评论树修复；把抖音隐藏浏览器的非阻塞 debugger 启动和整条链路时间边界重放到 `origin/main@ba7ca3f`，统一形成 `1.3.34` 候选。
- 合并：原抖音提交 `039790c`、`7c28d9a` 已分别重放为 `8cde4ff`、`b88efd5`。基线继续包含 `b81f00e` 的浏览器网络评论树无损合并、主评论滚动容器优先、deferred reply groups、Emoji/纯符号作者去重，以及 `lost_root/lost_replies` 诊断。
- 版本：根目录与正式插件发布源的 manifest 均为 `1.3.34`；两份 versions 均保留正式 `1.3.33` 并新增 `1.3.34`，市场包回归锁定 `1.3.34`。
- 验证：`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、四份版本 JSON 解析和 `git diff --check origin/main...HEAD` 均通过。运行主测试前后备份并恢复了真实 `sync-last.log`，没有用测试日志覆盖用户现场。
- 本机安装：合并版已安装到 `D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync`，安装前候选备份为 `.backup-before-merged-1.3.34-20260715-110235`；源码与安装目录 `main.js` SHA-256 均为 `76CA4F4ADEF28C37DF96C600841C31865E67524C672538406CA71EB869E2430F`，安装前后 `data.json` SHA-256 均为 `F1ECF14C9311880AEC3002C24D36620B8EFC9C96D496B7E32250DEB3E77D8394`。
- 当前状态：磁盘安装已完成，但 Obsidian 当前 renderer 创建于 10:47，早于 11:02 的合并版安装，内存仍未加载该代码。真实抖音端到端验证必须先重载当前窗口或重启应用，再触发同步；通过前不发布 `1.3.34`。
- 风险与下一步：不强制结束 Obsidian，避免影响未保存内容。用户重载后重新同步待处理抖音记录；若在页面等待、资源收集和 debugger 收尾的时间边界内继续到下载/转写或明确失败，即可判断不再无限卡住；只有真实解析/转写通过后才把 `1.3.34` 推送默认分支、创建标签/Release 并运行专用发布检查器。

### 2026-07-15 10:55 - 发布 Obsidian 插件 1.3.33：修复小红书主评论与回复漏采

- 目标：修复 `1.3.32` 真实笔记中“回复已被浏览器网络捕获但最终 Markdown 数量减少”、折叠回复因主评论未出现而被丢弃、滚动误选嵌套回复容器，以及 Emoji/纯符号昵称导致跨来源重复的问题；主评论上限保持 200，每条主评论回复上限保持 100。
- 影响范围：Obsidian 插件发布源、根目录市场发现元数据、插件回归测试、设计/实施文档、本机已安装插件、GitHub 默认分支和 `1.3.33` Release；不修改小程序、云函数、支付、绑定码、Pro 权益、OCR、ASR 或用户业务数据。
- 根因证据：三篇 2026-07-15 实测笔记分别出现 `replies=6/final_replies=4`、`19/4`、`40/23`；第三篇同时只有 `root_pages=1`、却有 `reply_pages=11` 并以 `network_idle` 停止，另有 8 条未归属回复。旧容器评分给 `comment` 与 `reply` 相同高分，嵌套回复区可能胜过主评论列表；未命中根 ID 的回复响应会在 DOM 补根之前被丢弃；纯符号昵称标准化后为空，无法命中网络副本。
- 修改：浏览器网络评论树增加无损保留层，后续来源只能补充、不能删除已有回复；未归属回复响应延迟到网络/DOM 根评论合并后再次挂载；DOM 根/回复同时保留可取得的评论 ID；主评论容器按根评论覆盖度加分，嵌套回复容器及其祖先降权；Debugger 响应体任务连续排空两轮，避免尾页刚返回就结束；符号昵称使用 NFKC 原值作为去重后备键；诊断新增 `merged_*`、`restored_*` 与 `lost_*` 字段。
- Git 管理：从 `origin/main@683fb5c` 创建隔离分支 `codex/xhs-comment-completeness-1.3.33`；改代码前先提交设计和实施计划 `3ca0393`，核心修复提交 `b81f00e`，版本提交 `b66c00f`。默认分支已快进到 `b66c00f`，标签 `1.3.33` 指向该版本提交。
- 线上动作：GitHub Actions Release 运行 `29385044710` 成功；正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.33>，latest、非 draft、非 prerelease，资产包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.33.zip`。
- 本机安装：完整手动安装包为 `C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.33.zip`，SHA-256 `A8F4327319EAE303C97C512D3D02E4468E2A8C1E5BA2F93C2FF52066F5F86DB4`；当前知识库已安装并启用 `1.3.33`，备份位于 `.obsidian/plugins/wechat-inbox-sync/.backup-before-1.3.33-20260715-105001`。安装源码与本机 `main.js` 哈希一致，`data.json` 安装前后 SHA-256 均为 `D6F28E23E36C5A055E03C9A9E02793827E4A8ABD94705F6CDBB3B863A156BE55`。
- 验证：新回归均先在旧实现上失败，再在修复后通过；`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、插件语法检查、四份版本 JSON 解析和 `git diff --check` 均通过。专用发布检查器确认默认分支 manifest/versions、Raw manifest、latest/目标 Release、五项 Release 资产及资产 manifest 均为 `1.3.33`；本地 ZIP 内 manifest 也为 `1.3.33`。
- 结果：本机与插件市场均已获得小红书评论无损收尾逻辑。新笔记诊断中 `lost_root=0`、`lost_replies=0` 表示网络合并到最终 Markdown 没有再丢节点；`unmatched` 只表示平台响应中仍无法找到父评论的剩余回复。
- 已知风险：小红书登录失效、验证码、平台不继续返回主评论页或 DOM 不暴露根评论 ID 时，仍可能留下 `unmatched>0`；插件不会绕过平台安全限制，也不会把无法确认父级的回复伪造成主评论。
- 下一步：重载或重启 Obsidian 后重新同步同一批三条链接，重点核对 `root_pages` 不再停在 1、`lost_root=0`、`lost_replies=0`，并对照页面可见评论/回复确认真实完整度。

### 2026-07-15 10:52 - 为抖音隐藏浏览器整条链路建立时间边界，安装 1.3.34 本地候选

- 目标：处理 1.3.33 去掉 `Network.enable` 前置等待后，同一抖音记录仍表现为长时间无响应的问题；从整个隐藏浏览器链路消除无限等待，而不是继续单点打补丁。
- 影响范围：Obsidian 插件抖音隐藏浏览器加载与调试响应体收尾、版本元数据、测试和本机候选安装；不修改云函数、小程序、支付、绑定码、Pro 权益、ASR 模型或业务数据。本次未发布插件市场。
- 复核证据：磁盘插件为 `1.3.33` 且源码一致，安装后 Obsidian 在 10:47 新建渲染进程；云端“微信 1”仍有 1 条 10:31 创建的 `v.douyin.com` 网页记录处于 pending，ASR 日志仍停在 10:28，说明候选已经加载但主链路仍未进入下载/转写。Windows 应用截图尝试因系统接口返回 `0x80004002` 失败，未继续盲目点击。此前 `sync-last.log` 中“旧微信”错误由 `plugin-main-ai.test.js` 的模拟用例覆盖真实日志产生，不是用户绑定状态；本轮测试均在运行前备份、结束后恢复现场日志。
- 根因扩展：1.3.33 只移除了第一处 `Network.enable` 等待；函数仍先 `await win.loadURL(url)`，因此后置的 18 秒 `waitForWebContents` 超时无法接管，还会在页面脚本结束后无限 `await Promise.allSettled(debuggerBodyTasks)`。任何一条 `loadURL` 或 `Network.getResponseBody` Promise 不 settle 都会继续卡住。
- 修改：新增 `beginBestEffortBrowserLoad`，启动 `loadURL` 后立即让事件计时器接管，启动同步失败则明确报错；新增 `waitForBrowserTasksWithin`，可选响应体任务最多等待 2.5 秒，之后使用已捕获的请求、DOM 资源和已完成响应继续解析。目标 `aweme_id` 校验、Debugger 捕获和 24×500ms 页面资源收集均保留。由于 1.3.33 已实际安装，版本顺延为 `1.3.34`。
- 验证：按 TDD 先用永不 settle 的 `loadURL` 与响应体 Promise 构造红灯，再实现到绿灯；插件语法、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、四份 1.3.34 版本 JSON 和 `git diff --check` 通过。
- 本机安装：旧候选备份到 `D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync\.backup-before-1.3.34-20260715-105225`；已安装 manifest 为 `1.3.34`，源码与安装目录 `main.js` SHA-256 均为 `48DAEB1BA29D1A4586FF922958E7AD4A97FC69494802F84BAA26357F88F25F7C`，安装前后 `data.json` SHA-256 均为 `F1ECF14C9311880AEC3002C24D36620B8EFC9C96D496B7E32250DEB3E77D8394`。
- 结果：磁盘上的 1.3.34 候选已保证隐藏浏览器的页面启动、页面事件等待、页面资源收集和调试响应体收尾均有可达退出路径；真实端到端结果仍需让 Obsidian 新建渲染进程后重跑 pending 记录确认。
- 已知风险：抖音对未签名详情接口返回空正文，仍需依赖浏览器 Session；时间边界只约束可选等待，不保证平台一定返回目标媒体。若目标媒体不存在，会生成明确的抖音失败笔记而不是无限等待。
- 下一步：在 Obsidian 中重新加载当前窗口或完整重启后同步；预期最迟在页面 18 秒等待、12 秒资源收集和 2.5 秒调试收尾后继续到下载/转写或明确失败。真实通过后再决定是否发布 1.3.34。

### 2026-07-15 10:39 - 修复 1.3.32 抖音同步卡在“正在处理”，安装 1.3.33 本地候选

- 目标：修复 1.3.32 同步抖音短链时长时间停留在“正在处理 1/1”且没有进入下载/转写的问题，同时保持按目标作品 ID 捕获真实媒体的能力。
- 影响范围：Obsidian 插件抖音隐藏浏览器网络捕获、版本元数据、回归测试、本机候选安装和工程决策；不修改云函数、小程序、支付、绑定码、Pro 权益、ASR 模型或业务数据。本次未发布插件市场。
- 现场证据：`C:\Users\ADMIN\.wechat-inbox-local-asr\sync-last.log` 自 10:32:32 起停在 `stage=processing`、标题 `抖音-blEhzLRl0e8`，超过三分钟没有更新；`transcribe-last.log` 仍停在 10:28:06，系统没有 Whisper/FFmpeg 进程。目标短链、作品页和详情接口本机网络探针分别约 1.03 秒、0.28 秒和 0.23 秒返回，详情接口正文为空，因此流程必然进入 Session/隐藏浏览器增强路径。
- 根因：1.3.32 新增抖音 DevTools 响应体捕获后，在创建隐藏浏览器页面前执行 `await debuggerApi.sendCommand('Network.enable')`。该命令是可选增强但没有超时，一旦 Electron Promise 不返回，下游 `waitForWebContents(..., 18000)` 永远无法开始；同项目稳定的小红书实现对相同命令采用非阻塞启动。
- 修改：新增同步的 `enableDebuggerNetworkCapture`，触发 `Network.enable` 后只登记异步错误处理并立即返回；抛错、不支持或永不完成都不会阻塞页面加载。抖音的 debugger 消息监听、目标 `aweme_id` 过滤和响应体媒体提取保持不变。版本从正式 `1.3.32` 顺延为本地候选 `1.3.33`，根目录和插件目录的 manifest/versions 同步更新。
- 验证：按 TDD 先用永不 settle 的 Promise 断言非阻塞入口并观察到 helper 缺失红灯，再实现到绿灯；`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、插件语法、四份版本 JSON 和 `git diff --check` 通过。
- 本机安装：旧插件备份到 `D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync\.backup-before-1.3.33-20260715-103908`；已安装 manifest 为 `1.3.33`，源码与安装目录 `main.js` SHA-256 均为 `D80B8647C2B3EB3DAFB5D1FC87FEFDF0602ACEA0C3A39AA82DB2D97A19474A5F`，安装前后 `data.json` SHA-256 均为 `6388F96C1E83C481F19B74725D377C66C6EC3448D7BC9E6E58497AC6174A1D23`，用户配置未改。
- 结果：磁盘上的 1.3.33 候选已消除本次新增的无限等待点；当前 Obsidian 内存里仍运行已经卡住的 1.3.32 调用，必须完整重启 Obsidian 才能销毁旧隐藏窗口并加载候选代码。
- 已知风险：抖音当前对未签名详情接口返回空正文，解析仍依赖 Session/隐藏浏览器，真实成功率受平台风控影响；本次只移除无限等待，不降低目标作品 ID 校验，也不把失败结果伪装成其他平台。尚未完成重启后的真实短链端到端复测。
- 下一步：用户确认笔记已保存后完整退出并重开 Obsidian，再同步同一条记录；预期会继续到下载/转写，或在取不到目标媒体时明确生成抖音失败笔记，不再无限停留。实测通过后再发布 1.3.33。

### 2026-07-15 10:12 - 发布 Obsidian 插件 1.3.32

- 目标：把已经完成的抖音平台误判修复和 Windows/macOS ASR 旧安装器防回灌能力正式发布到插件市场更新链路。
- 影响范围：Obsidian 插件发布源、根目录市场发现元数据、GitHub 默认分支、`1.3.32` 标签/Release、本地手动安装包和工作日志；不修改小程序、云函数、支付、绑定码、Pro 权益或业务数据。
- 发布内容：抖音无媒体时不再误落入小红书提取器；Windows ASR 动态安装器必须不低于 `1.2.22`，macOS 必须不低于 `1.3.5`，两端都拒绝旧提示词参数并要求 `repeat-guard-v2`。Windows/macOS 正确安装器此前已分别同步到腾讯云 CDN，因此旧插件用户的当前安装也可恢复，新版插件再增加未来回灌防线。
- 线上动作：默认分支 `main` 已快进到 `92da082`，标签 `1.3.32` 指向同一提交；GitHub Actions 运行 `29383445788` 成功，正式 Release 为 <https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.32>，包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.32.zip`，且标记为 latest、非 draft、非 prerelease。
- 本地安装包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.32.zip`，SHA-256 为 `048CFE012B34BBC26E980D776DB78A279798326A4AF8A00CE8F976BD07A4A64D`；解包后 manifest 为 `1.3.32`，发布必需文件及 `local-asr` / `local-ocr` 均存在。
- 验证：`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、四份 manifest/versions JSON 解析和 `git diff --check` 均通过。专用发布检查器确认默认分支 manifest/versions、Raw manifest、latest/目标 Release、五项 Release 资产、资产内 manifest/versions 与本地 ZIP 全部为 `1.3.32`。
- 基线测试说明：尝试扩大到历史根目录测试时，`mobile-compat.test.js` 因根目录旧 `main.js` 引入 `child_process` 失败，`release-social-feishu-ai.test.js` 仍硬编码 `1.2.97`；这两项都指向 AGENTS 明确排除的根目录历史镜像，相关 `main.js` 相对正式 `1.3.31` 未改且实际发布 manifest 为 `isDesktopOnly: true`，不作为本次桌面插件发布源门禁。后续应单独清理或归档这组过期测试。
- 结果：插件市场发现所需的默认分支 Raw manifest 已返回 `1.3.32`，Release 资产齐全；用户刷新社区插件更新后即可获得 1.3.32。市场客户端的区域缓存仍可能造成短暂延迟。
- 已知风险：本次在 Windows 完成自动回归，真实 macOS 端仍需报障用户重新安装 ASR 并用短音频完成端到端复测；抖音风控响应仍可能导致个别链接明确失败，但不会再伪装成小红书笔记。
- 下一步：在本机从插件市场检查更新到 `1.3.32`，用一条抖音短链和一条短音频验证同步；让 macOS 报障用户重新点“安装/更新本地转写组件”后回传最新诊断。

### 2026-07-15 10:06 - 修复 macOS ASR 旧安装器回灌并更新 CDN

- 目标：修复 macOS 用户点击“安装/更新本地转写组件”后，Whisper、FFmpeg、模型均存在但仍报告“转写脚本过旧”的循环故障。
- 影响范围：Obsidian 插件 macOS ASR 安装器新鲜度校验、腾讯云静态托管 `local-asr/common/install-local-asr-macos.sh`、回归测试和工程决策；不修改 OCR、小程序、云函数、支付、绑定码、Pro 权益、模型或业务数据。
- 根因：项目发布源 macOS 安装器已是 `1.3.5`，公网 CDN 仍为 `1.3.4`；旧文件继续生成 `SIMPLIFIED_PROMPT` / `--prompt` 转写命令且缺少 `repeat-guard-v2`。插件只校验通用能力标记，因此会下载并执行旧安装器；安装结束后的状态检查再把其生成脚本判为过期。该问题与 Windows 旧安装器故障同源，不是 macOS Intel 架构、权限或依赖下载失败。
- 修改：macOS 动态安装器必须声明版本不低于 `1.3.5`、包含 `TRANSCRIPT_QUALITY_GUARD_VERSION="repeat-guard-v2"`，且不得包含 `SIMPLIFIED_PROMPT` 或 `--prompt`；Windows 与 macOS 共用数字版本比较器。回归用当前安装器构造 `1.3.4` 旧版样本，确保旧内容被拒绝、当前内容被接受。
- 线上动作：已把发布源 `install-local-asr-macos.sh` 上传到长环境静态托管 `local-asr/common/install-local-asr-macos.sh`。云端对象下载与带随机查询参数、`Cache-Control: no-cache` 的公网 CDN 回读 SHA-256 均为 `B7AED33EB50966EBBCF07D603B4E2E555A80185DF7658FB70B8A4C7CBF9CE173`；版本为 `1.3.5`，无旧提示词参数并包含 `repeat-guard-v2`。未发布新的 Obsidian 插件市场版本。
- 验证：按 TDD 先观察到旧 macOS 样本被错误接受的红灯，再实现严格校验使 `node tests/plugin-main-ai.test.js` 与插件语法检查通过；云端对象和公网 CDN 内容均与发布源逐字节一致。当前 Windows 环境只能做脚本语法/静态验证，尚未替远端用户完成一次真实 macOS 推理。
- 结果：运行 `1.3.30` 的 macOS 用户无需先更新插件，重新点击安装/更新即可从 CDN 获取正确的 `1.3.5`；已有 Whisper、FFmpeg 和模型会被复用。候选 `1.3.32` 同时增加安装前严格拦截，防止 CDN 将来被旧文件覆盖时再次回灌。
- 已知风险：远端 Mac 的首次真实安装和短音频转写仍需用户复测；若仍失败，需获取新的安装诊断以区分脚本执行、文件权限或实际推理阶段。
- 下一步：让报障用户重新点击安装/更新并重启或重载 Obsidian，确认 ASR 状态可用，再用一条短音频做端到端转写；抖音平台修复实测通过后再决定是否发布 `1.3.32`。

### 2026-07-15 09:58 - 修复 Windows ASR 旧安装器回灌并更新 CDN

- 目标：修复 Windows 用户反复点击“安装/更新本地转写组件”仍收到“转写脚本过旧”的闭环故障，并阻止旧 CDN 安装器再次覆盖新版转写脚本。
- 影响范围：Obsidian 插件 Windows ASR 安装器新鲜度校验、腾讯云静态托管 `local-asr/common/install-local-asr.ps1`、本机 ASR 安装和工程决策；不修改 OCR、小程序、云函数、支付、绑定码、Pro 权益、模型或业务数据。
- 根因：项目发布源已经包含安装器 `1.2.22`，但公网 CDN 仍是 `1.2.21`，且旧安装器包含 `$SimplifiedPrompt` / `--prompt`。插件原下载校验只检查通用能力标记，错误接受了旧安装器；旧安装器成功覆盖 `transcribe.ps1` 后，安装结束状态检查又正确判定该脚本过旧，形成“每次重装都重新装旧脚本”的循环。故障日志中的 Whisper、FFmpeg 和模型均正常，不是下载、权限或推理依赖问题。
- 修改：提取并导出 `isLocalAsrInstallerCurrent`，Windows 安装器必须声明版本不低于 `1.2.22`、包含 `repeat-guard-v2` 质量门、且不得包含 `$SimplifiedPrompt` 或 `--prompt`；下载和随包回退统一使用该校验。回归用真实当前安装器构造旧版样本，确保旧内容被拒绝、当前内容被接受。
- 线上动作：已将发布源 `install-local-asr.ps1` 上传到长环境静态托管 `local-asr/common/install-local-asr.ps1`。云端对象下载与带随机查询参数、`Cache-Control: no-cache` 的公网 CDN 回读 SHA-256 均为 `4CFDF0B2BFEDA838EE46F5020355453A7A14946A6E6E03C3F5928BFC99E0F7E8`，版本为 `1.2.22`，无提示词参数并包含新版质量门。未发布新的 Obsidian 插件市场版本。
- 本机修复：旧脚本备份到 `C:\Users\ADMIN\.wechat-inbox-local-asr\.backup-before-installer-1.2.22-20260715-095533` 后运行正确安装器；现有 Whisper、FFmpeg 和模型均复用，真实推理验证通过，`.install-state.json` 为 `installerScriptVersion: 1.2.22`、`validationStatus: passed`。插件运行文件备份到 `D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync\.backup-before-asr-installer-validator-20260715-095738`，随后安装 `1.3.32` 候选；源码和安装目录 `main.js` SHA-256 均为 `5A309C1BA339926AB61DD0F1E8248B5FA2C6C6587174CBC582D37886F97F4613`，安装前后 `data.json` SHA-256 均为 `6400341FB7133A2909DA513447645D1366A3489023AA0B80B5C80FAABFBA9E63`。
- 验证：按 TDD 先新增 `isLocalAsrInstallerCurrent` 行为断言并观察到 helper 缺失红灯，再实现到绿灯；本机正确安装器输出 `Local ASR inference validation passed` 和 `Local ASR install validation passed`。插件实际状态为 `scriptOutdated: false`、`hasWhisper/hasFfmpeg/hasModel: true`、`missingReasons: []`、`ready: true`。`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、Windows 安装器 PowerShell 解析和 `git diff --check` 均通过；源码/安装目录 `main.js` 一致，旧安装器被拒绝，当前安装器被接受。
- 结果：远端动态安装链和本机组件都已脱离旧 `1.2.21`；已经安装正确脚本的用户无需重新下载 Whisper、FFmpeg 或模型。本机 Obsidian 仍需重载或重启，才会从旧内存代码切换到磁盘上的 `1.3.32` 校验逻辑。
- 已知风险：`1.3.31` 及更早插件仍使用旧的通用标记校验，但 CDN 已更新为正确安装器，因此当前可直接修复；只有 CDN 未来再次被错误覆盖时，这些旧插件才可能重复接受旧文件。`1.3.32` 的严格校验会在这种情况下拒绝远端文件，而不是静默回灌。
- 下一步：重载 Obsidian 后重新打开诊断，确认运行版本为 `1.3.32`、ASR 可用；再用一条短音频做端到端转写。与抖音平台误判修复一起完成实测后，再决定是否发布 `1.3.32`。

### 2026-07-15 09:47 - 修复抖音无媒体时误写为小红书，并安装 1.3.32 本地候选

- 目标：修复正式 `1.3.29` 同步抖音短链 `https://v.douyin.com/blEhzLRl0e8/` 后生成 `source: 小红书视频`、标题“小红书笔记”的平台误判，同时提升抖音详情接口被风控时从真实浏览器响应中提取目标作品媒体的成功率。
- 影响范围：Obsidian 插件抖音媒体解析、失败兜底、发布版本元数据和插件回归测试；不修改小红书解析逻辑、小程序、云函数、支付、绑定码、Pro 权益或业务数据。
- 根因：抖音静态详情、Session 详情和隐藏浏览器都未返回媒体地址时，共用社交平台分支继续调用 `extractXiaohongshuMarkdownFromHtml`，并硬编码 `platform: 小红书`，因此原始 URL 虽为 `v.douyin.com`，保存结果却被覆盖成小红书。该问题在抖音新风控令详情接口返回空内容时被放大；问题短链仍能解析出目标作品 ID `7659778280362429711`。
- 修改：新增按目标 `aweme_id` 递归提取媒体地址的纯函数；抖音隐藏浏览器通过 DevTools Network 读取 XHR/Fetch/JSON 响应体，只接纳目标作品 ID 匹配的媒体，继续拒绝推荐作品；抖音最终无媒体时走独立失败记录，固定 `platform: 抖音`、`contentCategory: 视频`，不再调用小红书提取器。远端检查确认 `1.3.30` 已正式发布；修复重放期间 `1.3.31` 也已正式生成标签和 Release，但该标签不含本次抖音修复，因此本候选必须顺延为 `1.3.32`，并继续保留正式 `1.3.30/1.3.31` 的已有能力。
- 线上动作：本次抖音修复尚未推送 GitHub、未创建 `1.3.32` 标签/Release、未发布插件市场。远端已有的 `1.3.31` Release 是版本修正，不包含本次抖音修复。
- 本机安装：曾短暂安装基于 `1.3.29` 的同号 `1.3.30` 候选，随后安装了基于正式 `1.3.30` 的 `1.3.31` 候选；核对远端发现 `1.3.31` 已正式占用后，本修复顺延为 `1.3.32`。替换前的运行文件备份位于 `D:\内容创作系统\张张的内容创作知识库\.obsidian\plugins\wechat-inbox-sync\.backup-before-1.3.32-20260715-094707`；安装后 manifest 为 `1.3.32`，源码和安装目录 `main.js` SHA-256 均为 `5CE01B366105F71FB50ADF1DC0011EDE1591A9E7D5AF01055F607FD2433D1A61`。安装前后 `data.json` SHA-256 均为 `31F9A0A06195D725EAF7BCA9D6C03E7169B6AEA798306558171A886C36D5FF72`，用户配置未改动。
- 验证：先新增“抖音无媒体不得落入小红书”的回归，确认旧实现以 `小红书 !== 抖音` 失败；再新增目标 ID 嵌套响应提取测试，确认旧实现缺少函数而失败。重放到正式 `1.3.31` 后，`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、四份版本 JSON 解析和 `git diff --check` 均通过；根目录和插件目录 manifest 均为 `1.3.32`，两份 versions 同时保留 `1.3.31` 和 `1.3.32`。
- 结果：平台误判已在代码和自动回归层修复，本机已安装基于正式 `1.3.31` 的 `1.3.32` 候选；真实链接能否通过新增 Network 响应体路径成功转写，仍需重载 Obsidian 并新建一条云端记录后验证。原记录 `dc089a366a56d0b902445c9c3952e830` 已被 `1.3.29` 标记同步，重复点击同步不会重跑。
- 已知风险：抖音可能返回加密或不含目标作品对象的响应；此时 `1.3.32` 会明确保存为“抖音转写失败”，不会再伪装为小红书，也不会接受推荐视频。Windows 桌面捕获问题只影响自动点击验证，不影响插件自身解析。
- 下一步：用户重载或重启 Obsidian，在小程序重新发送同一条抖音短链并触发同步；核对新笔记是否为目标作品文案、无 `bytedance://` 弹窗、无复读、无小红书字段。真实通过后再发布 `1.3.32`。

### 2026-07-15 - 更正版本占用并发布 Obsidian 插件 1.3.31

- 目标：更正小红书评论加固版错误复用本机候选版本 `1.3.30` 的发布编号，保证已经安装过 1.3.30 候选版的用户仍能收到更高版本更新。
- 根因：1.3.30 发布前只检查了远端默认分支、标签与 Release；远端当时确实只有 1.3.29，但本机知识库和 `douyin-protocol-event-shape` 工作区在 08:22 已使用 1.3.30 候选版。发布流程没有把“本机已安装/已打包但未打标签的候选版本”视为已占用，因而复用了同一版本号。
- 修复：根目录与插件发布源 manifest 顺延为 `1.3.31`，两份 versions 同时保留 `1.3.30` 并新增 `1.3.31`；市场包测试改为锁定 1.3.31。发布清单新增强制规则：远端标签、默认分支、本机已安装插件、已有安装包和发布工作区必须一起审计，任何候选版本一经使用即视为占用，禁止复用。
- 线上动作：默认分支提交 `85f5528` 和标签 `1.3.31` 已推送；GitHub Actions Release 成功：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.31>。`1.3.30` 保留为可识别的中间版本，不删除标签或 Release，1.3.31 已成为 latest。
- 本地安装包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.31.zip`，SHA-256 为 `4D9D8DFDAC328D49D0288A8B9D70900B1B971245AF567D75A4A914985FF9D814`。
- 验证：先把市场包期望版本改为 1.3.31，确认 1.3.30 基线以 `1.3.30 !== 1.3.31` 红灯失败；完成元数据与门禁后，插件主测试、市场包测试、插件语法和 diff 检查通过。发布检查器确认默认分支/Raw manifest、versions、latest Release、五项 Release 资产、Release 内 manifest/versions 和本地 ZIP 均为 1.3.31。
- 结果：正式可测试版本为 `1.3.31`；1.3.30 不再作为用户验收目标。
- 下一步：用户在 Obsidian 检查更新到 1.3.31，再用原小红书链接复测评论总数、折叠回复与诊断字段。

### 2026-07-15 - 发布 Obsidian 插件 1.3.30：小红书评论输出加固

- 目标：修复 2026-07-15 三份真实小红书笔记中仍存在的 API/DOM 重复、评论区操作噪音、折叠回复平铺、原始时间戳、`赞 赞` 和诊断计数失真；同时保守清理仅出现在转写末尾的高置信错听结束语。
- 影响范围：Obsidian 插件的小红书评论采集/合并/Markdown 输出、本地转写末尾清理、插件回归测试、版本元数据与设计/实施文档；不涉及小程序、云函数、支付、绑定码、Pro 云端权益或用户数据。
- 实现：网络响应继续作为权威评论树；DOM 项新增主评论/回复角色与父评论 ID/作者，已有网络数据时不再把无结构 DOM 硬追加为主评论。跨源指纹统一小红书表情占位、标点、空白和尾部“展开”；过滤作者自重复及“问一问”摘要；结构化回复优先按父 ID、其次按唯一父作者归属，无法归属时只计诊断。页面滚动同时观察 DOM 评论数和评论接口资源数，稳定 10 轮或达到 200 条主评论上限后停止；真实页面触发的签名网络请求为主通道，诊断不再把并行无签名直连的 `root_unavailable` 显示成主故障。
- 输出：Unix 秒/毫秒时间转为 ISO 日期；点赞只输出一次；新增 `dropped` 诊断字段；`final_root/final_replies` 从最终 Markdown 重新统计。转写清理只删除最后一行匹配“下身/下生/下声/下省再见”的高置信错听结束语，不改写正文中间内容。
- Git：开发期间远端先发布了 `1.3.29` 抖音修复，本分支已变基到最新 `origin/main@1.3.29`，保留全部抖音 Session 与协议隔离改动。默认分支已快进到提交 `ac9a4c9`，标签 `1.3.30` 已推送并触发 GitHub Actions Release。
- 线上动作：GitHub Release 已生成：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.30>；本地安装包为 `C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.30.zip`，SHA-256 为 `9F154AF4D10F2A30E5A953FEBC4C63D2DEAE97C5C3D8AFC1AC70AD3F577E0E58`。
- 验证：按 TDD 先观察到 1.3.29 基线把 5 个样本项合并成 5 条而不是 1 条，再实现到绿灯。变基和版本升级后，`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 与 `git diff --check` 均退出码 0。发布检查器确认默认分支与 Raw manifest 为 `1.3.30`、versions 包含 `1.3.30`、Release 非草稿/非预发布、五项资产齐全、Release 内 manifest/versions 正确、本地 ZIP 四项核心文件与 manifest 正确。
- 结果：`1.3.30` 曾满足社区插件市场发现条件，但随后确认该编号此前已被本机抖音候选版使用，现已由 `1.3.31` 正式取代；真实小红书验收统一以 1.3.31 为准。
- 已知风险：小红书页面结构或接口风控继续变化时，平台可能不返回全部评论；保守策略会丢弃无法证明归属的 DOM 独有项，以避免污染主评论。末尾错听规则不等于全文语义纠错，不会擅自改写“废书/钢区”等正文中间的 ASR 错词。
- 下一步：用户更新到 `1.3.30` 后复测原问题链接，核对 `## 评论区` 与末尾诊断中的 `final_root/final_replies/dropped/unmatched/stop`；若仍有折叠回复缺失，直接提供新笔记文件即可继续按真实响应定位。

### 2026-07-15 08:20 - 发布 Obsidian 插件 1.3.29：抖音 Session 优先解析与外部协议隔离

- 目标：在解析成功率优先的前提下，从根源减少抖音隐藏页面触发 `bytedance://` / Microsoft Store 弹窗，并拒绝批量解析时误取推荐作品媒体；不依赖云端解析。
- 影响范围：Obsidian 插件抖音地址标准化、精确详情校验、持久化 Electron Session HTTP 解析、隐藏浏览器协议隔离、导航守卫与插件回归测试；不涉及小程序、云函数、支付、绑定码、Pro 云端权益或业务数据。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`tests/plugin-main-ai.test.js`、抖音设计/实施计划、`docs/WORKLOG.md`。实施期间远端已发布 `1.3.28`，本分支已重放到最新 `origin/main@1.3.28`，保留 PDF OCR、本地 ASR 质量门和小红书评论能力。
- 实现：短链跳到 `bytedance://aweme/detail/<id>` 或 `snssdk1128://...` 时只提取作品 ID并改写为规范 HTTPS；直接详情与 Session 详情都必须匹配目标 `aweme_id`；静态接口失败后用 `persist:wechat-inbox-wechat` 的 `session.fetch` 预热 Cookie 并请求两条固定详情接口；仍失败才进入原隐藏浏览器。隐藏窗口创建前，在同一专用 Session 上幂等注册两个自定义协议空响应处理器，并继续保留 webRequest、导航、重定向、新窗口四层事件守卫。
- 线上动作：用户明确要求直接发布。提交 `8ec7b86` 已快进推送到默认分支 `main`，标签 `1.3.29` 已推送并触发 GitHub Actions；Release 已生成：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.29>。桌面手动安装包为 `C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.29.zip`。
- 本机安装：用户先通过插件市场更新到正式 `1.3.28`，已把该完整目录备份到 `C:\Users\ADMIN\AppData\Local\Temp\wechat-inbox-sync-official-1.3.28-before-1.3.29-20260715-075236`，再安装基于正式 28 的 `1.3.29` 候选。10 个运行文件逐项 SHA-256 一致，manifest 为 `1.3.29`，候选 `main.js` SHA-256 为 `774A5D76D63B97328B0330F68699006372A701672E9D86F4F69A1F7AD5D9C938`；安装动作前后 `data.json` SHA-256 均为 `D2CC6738D958056D01BC60CE06A0A0D19BC4194D5F2196D2B9DFD314DD0E496E`。
- 验证：按 TDD 分别观察到自定义协议 ID 提取失败、Session 函数缺失、直接详情误收推荐作品、协议处理器缺失四组预期红灯，再实现到绿灯。重放到 `1.3.28` 后，`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`git diff --check` 均退出码 0。发布检查器确认默认分支和 Raw manifest 为 `1.3.29`、versions 包含 `1.3.29`、最新/目标 Release 正确、五项 Release 资产齐全、Release 内 manifest/versions 正确、桌面 ZIP 的四项核心文件与 manifest 版本正确。仓库没有计划初稿引用的三份 core 测试；移动端测试仍加载根目录桌面插件镜像，release 历史测试仍硬编码 `1.2.97`，两项在原 `1.3.28` 基线就失败且本任务未修改对应文件。
- 结果：`1.3.29` 已满足 Obsidian 社区插件市场自动发现条件，代码、自动回归、本机安装包和发布链路均已完成。真实 Obsidian 抖音端到端验收仍由用户更新/重载后进行，不能在实际复测前宣称弹窗已经根治。尝试控制本机 Obsidian 重载时，Windows 捕获接口返回 `SetIsBorderRequired failed: 不支持此接口 (0x80004002)`，已按桌面控制安全规则停止输入操作，没有改用非授权键鼠脚本。
- 已知风险：抖音继续调整接口时 Session HTTP 可能仍取不到媒体，但会进入原浏览器兜底；实机尚需确认 Obsidian 1.12.7 中 Session 协议处理器能完全吞掉页面 iframe 发起的外部协议，同时不影响媒体请求和 MP4 保存。
- 下一步：用户在 Obsidian 检查更新到 `1.3.29` 后，先用本次问题链接验证“正确作品转写 + 无 Microsoft Store 弹窗”，再用 3 条旧链接和至少 10 条批量链接验证无串单；如仍有弹窗，记录触发链接和发生时间用于继续定位。

### 2026-07-15 08:05 - 发布 Obsidian 插件 1.3.28：PDF 自动 OCR 与本地转写质量修复

- 目标：把已完成的 PDF 文本层质量检测、异常 PDF 自动本地 OCR、简繁转换和本地 ASR 复读质量门合并到最新插件市场基线，并完整发布给用户。
- 影响范围：Obsidian 插件发布源、Windows/macOS 本地 ASR/OCR 安装器、插件回归测试和发布元数据；不修改小程序、云函数、支付、绑定码、Pro 云端权益或用户数据。
- 修改：普通 PDF 继续优先读取文本层；扫描版、空文本、特殊编码或疑似乱码 PDF 自动切换到本地逐页 OCR。OCR 增加 `PyMuPDF` 与 OpenCC 依赖、300 DPI 渲染、阅读顺序整理和简体中文输出；旧 OCR 组件在首次需要 PDF OCR 时自动升级。PDF OCR 继续通过云端 Pro 权限校验，非 Pro 不开放。ASR 去掉内容提示词，并在保存前拦截提示词泄漏和高密度复读，失败时继续尝试备用媒体地址。
- 兼容处理：以线上 `1.3.27` 为基线合并，保留该版本的小红书评论、抖音外部协议守卫和原始音视频附件能力；没有用旧分支整文件覆盖线上插件。
- 线上动作：提交 `349cda7` 已推送到默认分支 `main`，标签 `1.3.28` 已推送，GitHub Actions Release 成功。GitHub Release：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.28>；本地安装包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.28.zip`。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、插件 `node --check`、两份 Windows 安装器 PowerShell 解析、OCR Python AST 解析、四份发布 JSON 解析和 `git diff --check` 通过。发布检查器确认默认分支与 Raw manifest、versions、Release 标签与五项资产、Release 内 manifest、桌面 ZIP 内 manifest 均为 `1.3.28`。仓库历史测试 `release-social-feishu-ai.test.js` 仍把版本写死为 `1.2.97`，移动端兼容测试仍尝试加载明确标记为桌面专用的插件，均作为既有测试债务记录，不作为本次发布门禁。
- 结果：`1.3.28` 已满足 Obsidian 社区插件市场自动发现条件，用户可通过社区插件检查更新；手动安装 ZIP 也已就绪。
- 已知风险：macOS 安装器通过静态语法和插件回归，仍需 Apple Silicon 用户用扫描版或乱码 PDF 做一次端到端 OCR 冒烟；公开包索引不可用时安装器仍依赖现有腾讯云/备用下载链路。
- 下一步：收集 Windows 与 Apple Silicon 各一份真实 PDF 结果；后续单独清理两组过时测试，不与本次已发布功能混改。

### 2026-07-15 07:32 - 发布 Obsidian 插件 1.3.27：补全小红书评论与折叠回复

- 目标：解决小红书评论常停在首屏约 10 条、折叠回复遗漏、API/DOM 重复、回复被误写成主评论，以及长时间处理中缺少可诊断信息的问题。
- 影响范围：仅 `obsidian-plugin/wechat-inbox-sync/`、根目录市场发布元数据、插件回归测试和工程文档；不涉及小程序、云函数、Pro 权益、绑定码或用户数据。
- 修改：以登录浏览器捕获的签名评论响应为主数据源；按请求顺序合并分页；滚动真实评论容器并依据 API 耗尽/空闲轮次/安全上限停止；同 ID 网络响应合并回复；DOM 与静态 HTML 仅补缺并跨时间格式去重；折叠回复只在根 ID 或唯一父作者匹配时归属，无法确定的回复不再冒充主评论；Markdown 保留回复缩进；诊断信息增加分页、主评论、回复、去重、无归属、无效响应、滚动和停止原因。
- 数量边界：默认最多采集 200 条主评论，每条主评论最多保留 100 条回复；边界为安全上限，不代表平台一定会返回满额。
- 线上动作：提交 `a8fb770` 已快进推送到 `main`，标签 `1.3.27` 已推送并生成 GitHub Release：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.27>。
- 数据变更：无。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`git diff --check` 均通过；使用 2026-07-15 三份现有小红书笔记做结构回放，验证跨源重复被移除、唯一父作者回复可归属、歧义回复保持为诊断项；专用发布检查器确认默认分支、Raw 元数据、GitHub Release 五项资产、本地 ZIP 内容和版本均为 `1.3.27`。
- 已知风险：现有笔记只能验证合并和层级规则，真实小红书页面的登录态、风控、页面结构仍可能变化；最终端到端效果需要用户在 Obsidian 更新到 1.3.27 后用原问题链接复测。若平台未返回完整数据，诊断中的 `stop`、`api_stop`、`unmatched` 和页数可用于下一步定位。
- 结果：插件市场发布链路已完成，等待用户实测评论总数、折叠回复层级和处理耗时。
- 下一步：用户更新到 1.3.27 后复测原链接；如仍不完整，提供该条笔记末尾诊断和截图，不需重复描述环境。
### 2026-07-15 07:35 - 修复 1.3.26 对新版 Electron 导航事件的协议拦截漏口

- 目标：定位并修复用户已在 `1.3.26` 仍出现 Windows“获取打开此 bytedance 链接的应用”弹窗的问题，同时保持抖音媒体解析与转写路径不变。
- 影响范围：Obsidian 插件外部协议导航守卫、插件回归测试、本机已安装插件；不涉及小程序、云函数、支付、绑定、媒体提取或用户数据。
- 修改文件：隔离工作区 `.worktrees/douyin-protocol-event-shape/obsidian-plugin/wechat-inbox-sync/main.js`、`.worktrees/douyin-protocol-event-shape/tests/plugin-main-ai.test.js`；并将同一导航守卫修复安装到当前知识库 `.obsidian/plugins/wechat-inbox-sync/main.js`。本日志记录在 `docs/WORKLOG.md`。
- 线上动作：无。未推送 GitHub、未创建标签或 Release、未发布插件市场版本。
- 数据变更：无；本机插件 `data.json` 未修改。
- 验证：在原始 `1.3.26` 上直接调用真实守卫，旧 URL 字符串参数返回 `true`，Electron 对象参数返回 `false`；新增对象参数回归后运行 `node tests/plugin-main-ai.test.js`，按预期以 `false !== true` 失败。修复后 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 均退出码 0；本机安装文件的对象参数与事件对象两种调用均实测拦截为 `true`。
- 结果：根因不是版本未更新，而是 `installExternalAppNavigationGuards` 只识别旧式字符串参数；新版 Electron 可把 URL 放在导航 details/事件对象的 `url` 字段中，导致抖音 iframe 的 `bytedance://` 跳转漏过。修复兼容字符串、details 对象和事件对象三种签名，不改变 HTTP/HTTPS、媒体请求或转写逻辑。
- 已知风险：尚需重载 Obsidian 后用真实抖音链接做一次实机验证；抖音仍可能引入新的协议触发方式，需保留网络请求、导航、重定向和新窗口四层守卫。
- 下一步：用户实测无弹窗且解析成功后，从该 `origin/main@1.3.26` 隔离分支发布 `1.3.27`，再由插件市场分发。

### 2026-07-15 07:14 - 复核批量抖音复读与 PDF OCR 的真实生效状态

- 目标：回答批量转写 38 条后少数笔记整句复读是否已经根治，并解释 PDF OCR “待收尾”的准确含义。
- 影响范围：当前知识库已安装插件、本机 ASR 运行脚本、安装日志、插件回归测试与文档；不修改业务逻辑、不发布版本。
- 修改文件：`docs/WORKLOG.md`。
- 线上动作：无。
- 数据变更：无。
- 验证：当前正式 `1.3.26` 已安装插件不包含 `getTranscriptionQualityIssue`、`assertUsableTranscription`、`runLocalPdfOcr` 或 `PDF_OCR_REQUIRED`；同步循环按 `for` + `await this.writeRecord` 串行处理记录。`C:\Users\ADMIN\.wechat-inbox-local-asr\install.log` 显示 07:12 自动修复使用临时安装器，读取该临时文件确认它是旧 `1.2.21`，仍生成 `$SimplifiedPrompt` 与 `--prompt`；当前实际 `transcribe.ps1` 的修改时间同为 07:12，且同样包含旧提示词。`.install-state.json` 虽写着 `1.2.22`，但与实际运行脚本不一致，不能作为生效证明。`tests/plugin-upload-sync.test.js:482` 仍断言旧行为应写入“PDF 文本提取质量过低”，而开发中的新设计应改为自动 OCR，因此该测试与新行为尚未统一。
- 结果：抖音复读根因已定位，但当前已安装链路尚未彻底修复；批量 38 条本身不是共享上下文污染，失败集中在少数记录更符合对应媒体音轨/分块触发 Whisper 幻觉。PDF OCR 改动仅存在于落后的开发分支，未移植到正式 `1.3.26`，截图中的 PDF 乱码问题当前仍可能发生。
- 已知风险：插件自动修复会从远端重新安装旧 ASR 脚本，覆盖手工更新；只改本机脚本无法形成稳定修复。缺少发生复读的原始链接或 MP4，尚不能对同一批 38 条做端到端复测。
- 下一步：以正式 `1.3.26` 为基线同时移植 ASR 最终质量门与 PDF OCR 回退；升级插件版本识别和远端/随包安装器，阻止旧脚本回灌；用用户提供的失败链接或 MP4 做“正常转写 / 30 秒重试 / 备用媒体地址 / 全失败不写垃圾正文”的端到端验收后再发布。

### 2026-07-15 07:10 - 核对 bytedance 弹窗与原视频保存的因果关系

- 目标：确认 Windows 的 `bytedance://` / Microsoft Store 弹窗是否由“下载并保存原始 MP4”功能引入，并判断是否需要退回该功能之前的版本。
- 影响范围：Obsidian 插件 Git 历史、当前本机插件候选状态与文档；不修改业务逻辑、不发布版本、不改用户配置。
- 修改文件：`docs/WORKLOG.md`；同时把上一任务误同步到当前知识库的落后分支 `main.js` 从自动备份恢复。
- 线上动作：无。未发布、未推送、未覆盖 CDN。
- 数据变更：无。当前知识库插件的 `data.json` 保持原样。
- 验证：Git 时间线显示 `1.3.17` 已存在抖音隐藏浏览器 `renderSocialMediaUrlsWithElectron`、`win.loadURL(url)` 以及抖音媒体回退调用；保存原始音视频由提交 `d8f2832` 在 `1.3.18` 加入，默认关闭，只在转写记录建立后调用 `saveSourceMediaAttachment`。当前 `1.3.26` 的代码顺序仍是抖音页面渲染与媒体提取在前、可选原视频下载在后。同步前备份与恢复后的本机 `main.js` SHA-256 均为 `08F902F147D88CD3F2C4DDF84414C2733146BA0D530F64E84029A5B659BFF6A5`，`node --check` 通过，`data.json` 存在。
- 结果：`bytedance://` 的源头是抖音网页在隐藏 Electron 页面解析阶段发起原生 App 跳转，不是后续的 MP4 下载。退回 `1.3.17` 会保留该页面加载路径，同时移除后续协议拦截和其他修复，因此不采用整版回退。
- 已知风险：抖音可以继续改变页面跳转方式；需要保留请求、导航、重定向和新窗口四层协议拦截，并用真实短链持续回归。
- 下一步：维持正式 `1.3.26` 基线；如需做产品侧 A/B，只关闭“保存原始音视频到本地”开关，不回退插件版本，但这不会替代 `bytedance://` 源头拦截。

### 2026-07-15 07:05 - 本地 ASR 复读幻觉拦截与备用媒体重试

- 目标：修复部分抖音音视频本地转写生成整句循环、重复输出“请输入/请输出简体中文”且仍被保存为成功笔记的问题；全程不依赖云端转写。
- 影响范围：Obsidian 插件 / Windows 与 macOS 本地 ASR 组件 / 插件测试 / 文档；不涉及小程序、云函数、支付、绑定码或线上业务数据。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1`、`obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`、`docs/DECISIONS.md`、`docs/WORKLOG.md`。
- 线上动作：无。未发布插件市场，未覆盖腾讯云 CDN；曾把候选 `main.js` 与 `local-asr/` 同步到当前知识库，随后发现当前开发分支落后于正式 `1.3.26`，已立即用自动备份恢复正式插件 `main.js`，保留 `1.3.26` manifest 与原有 `data.json`；本机 ASR 脚本曾升级，但之后被插件自动修复下载的旧安装器覆盖，当前不能视为 `1.2.22` 新逻辑已生效。
- 数据变更：无。
- 验证：先新增回归并确认旧实现分别因缺少质量检测函数和缺少脚本能力标记而失败；开发分支修复后 `node tests/plugin-main-ai.test.js`、`node tests/plugin-core.test.js`、`node tests/plugin-sync-core.test.js`、`node tests/plugin-marketplace-package.test.js`、`node tests/media-resolver-core.test.js`、`node tests/media-resolver-windows.test.js` 全部通过；`node --check obsidian-plugin/wechat-inbox-sync/main.js`、Windows 安装器与生成 `transcribe.ps1` 的 PowerShell 解析、macOS 安装器的 Git Bash `bash -n`、`git diff --check` 均通过。本机安装器曾复用现有 Whisper/ffmpeg/model 并完成推理校验，但 07:12 后实际脚本再次出现旧提示词，证明安装状态随后被旧安装器覆盖。补充运行 `node tests/plugin-upload-sync.test.js` 时仍有一条 PDF OCR 旧行为断言未更新。
- 结果：当前开发分支中的 Windows/macOS Whisper 命令不再注入“请输出简体中文”提示词，插件最终质量门与备用媒体地址逻辑也已通过分支内测试；但该分支落后于正式 `1.3.26`，而本机新 ASR 脚本又被远端旧安装器回灌，因此这些能力当前均不能视为正式生效，发布前必须移植到以 `origin/main` 为基线的新分支并解决安装器覆盖问题。
- 已知风险：macOS 仅完成静态语法与插件层质量门验证，尚未在 Apple Silicon 真机跑问题音视频；重复检测使用保守阈值，但极少数真实内容若连续三次逐字重复同一句，也会被判为低质量并切换备用地址。
- 下一步：以 `origin/main` / `1.3.26` 为新基线移植 ASR 质量门和需要保留的 PDF OCR 改动，统一回归后再发布并同步两份 ASR 安装器；随后在 Windows 与 Apple Silicon 各用本次失败的抖音样本做一次端到端实测。

### 2026-07-15 00:49 - PDF 文本层自动判定与本地 OCR 回退

- 目标：避免特殊编码或扫描版 PDF 生成连续乱码；自动识别文本层质量，异常时改走本地逐页 OCR，并统一输出简体中文。
- 影响范围：Obsidian 插件 / Windows 与 macOS 本地 OCR 组件 / 插件测试 / 文档；不涉及小程序、云函数、支付、绑定码或线上业务数据。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`obsidian-plugin/wechat-inbox-sync/local-ocr/ocr_image.py`、两份 OCR 安装器、两份 OCR/插件 README、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`、PDF OCR 设计与实施计划、`docs/DECISIONS.md`、`docs/WORKLOG.md`。
- 线上动作：无。未发布插件市场，未覆盖腾讯云 CDN；已把候选程序文件同步到本机知识库的 `.obsidian/plugins/wechat-inbox-sync/`，且未修改 `data.json`。
- 数据变更：无。仅在本机安装/升级 `~/.wechat-inbox-local-ocr` 运行环境以完成端到端验证。
- 验证：乱码 PDF 回归先确认旧逻辑未抛错，再实现 `PDF_OCR_REQUIRED`；`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node tests/inbox-core.test.js`、插件 `node --check`、Windows OCR 安装器 scriptblock 解析和 `git diff --check` 通过；Python 脚本编译及阅读顺序单元检查通过；实际 Windows 安装器成功导入 `rapidocr_onnxruntime`、`fitz`、`opencc`；使用 300 DPI 扫描 PDF 端到端识别成功，并验证繁体“這是”输出为简体“这是”；源码与本地插件目录 6 个文件 SHA-256 一致。
- 结果：PDF 先走快速文本层；空文本、低质量文本、已知乱码或长串低标点重复乱码会自动转入本地 PDF OCR。OCR 按 300 DPI 逐页渲染、按识别框坐标排序、保留页标题，单页失败不阻断其他页，最终使用 OpenCC `t2s` 转简体。已安装的旧 OCR 脚本在首次遇到需 OCR 的 PDF 时会自动升级。
- 已知风险：当前腾讯云 OCR wheelhouse 尚未包含 `PyMuPDF` 与 `opencc-python-reimplemented`，安装会先快速失败再回退腾讯/官方 PyPI；插件已拒绝缺少这两项的新旧 CDN 安装器并使用随插件打包的安装器。当前 Windows 环境没有 Bash，macOS 安装器只完成静态依赖断言，尚需 Apple Silicon 真机安装与 PDF 冒烟测试。
- 下一步：在本机 Obsidian 重载插件后，用问题 PDF 验证笔记排版；通过后发布新插件版本，并把两项新依赖补入三平台 CDN wheelhouse、更新 CDN 安装器与 OCR 运行脚本，再由 Windows 和 Apple Silicon 各做一次新用户安装测试。

### 2026-07-14 23:10 - 修复回归优惠预览误显示为有效 Pro 续费提醒

- 目标：让所有者白名单测试展示“已过期用户的 48 小时回归优惠”，不再把测试到期时间误当成真实 Pro 有效期。
- 影响范围：`quickstartFunctions` 短环境运行代码 / 小程序开发版回归预览 / 测试 / 文档；不修改真实 Pro 权益、支付、绑定码、兑换码或广告权限。
- 修改文件：`cloudfunctions/quickstartFunctions/expiry-reminder-preview-core.js`、`cloudfunctions/quickstartFunctions/index.js`、`miniprogram/pages/index/index.js`、`tests/expiry-reminder-preview-core.test.js`、`tests/home-ui.test.js`。
- 线上动作：此前新逻辑只更新到长环境；本次确认小程序通过 `miniprogram/app.js` 调用短环境 `he02-d8gebzv050ed6c4ef` 后，使用微信开发者工具 CLI 仅增量更新短环境 `quickstartFunctions` 的 `expiry-reminder-preview-core.js` 和 `index.js`。小程序开发版仍为 `1.3.29`，无需重新上传客户端代码。
- 数据变更：所有者测试白名单保留 `previewMode=recovery`，真实 Pro 到期时间和权益记录未修改。
- 验证：`node tests/expiry-reminder-preview-core.test.js`、`node tests/home-ui.test.js`、`node tests/pro-offer-notice.test.js` 及两份 JavaScript 语法检查通过；重新下载短环境函数确认包含 recovery 分支、`offerNoticePreview` 返回和 `previewMode` 写入，且 `payment-core.js` 与 `payment-delivery-lock.js` 的 SHA-256 和本地已验证版本一致。
- 结果：短环境已具备独立回归优惠预览，首页会员状态仍使用真实权益；错误的有效 Pro 续费提示与回归优惠使用不同本地去重键，不会互相遮挡。
- 已知风险：仍需所有者在真机彻底关闭并重开小程序，确认卡片标题为“48 小时回归优惠”且弹窗标题为“48 小时回归优惠已到账”。
- 下一步：真机视觉确认后禁用所有者测试白名单，避免长期保留测试入口。

### 2026-07-14 - Publish Obsidian plugin 1.3.26: replay Xiaohongshu folded replies

- Goal: fix Xiaohongshu comment extraction when folded replies are loaded only after the signed page requests are triggered by the logged-in browser.
- Scope: `obsidian-plugin/wechat-inbox-sync/` plugin release source and its regression/marketplace tests; no Mini Program, cloud function, entitlement, or user data changes.
- Changed: capture actual browser `comment/page` and `comment/sub/page` response bodies through the renderer debugger, classify root/reply payloads, associate replies by `root_comment_id`, retain DOM expansion clicks, and prefer the browser-network result over the rejected unsigned fallback request. No login, CAPTCHA, or platform security bypass was added.
- Online action: pushed commit `efe6ce4` to `main`, pushed tag `1.3.26`, and published GitHub Release [1.3.26](https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.26).
- Verification: `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, `node --check obsidian-plugin/wechat-inbox-sync/main.js`, and `git diff --check` passed. The release checker confirmed the default branch, raw manifest, release assets, and local ZIP all report `1.3.26`; local package: `C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.26.zip`.
- Result: the plugin marketplace release is ready for real logged-in Xiaohongshu testing. The generated diagnostic now reports `browser-network` when signed comment payloads were captured.
- Known risk: Xiaohongshu may change response shapes or require an active session; if the browser emits no signed comment response, the existing DOM/API fallback and diagnostic stop reason remain in place.
- Next: install/update to 1.3.26 and test a note with folded replies; compare the saved `## 评论区` section and diagnostic footer with the visible comment thread.

### 2026-07-14 - Add owner-only 48-hour recovery-offer preview

- Goal: let the owner visually verify the homepage recovery card and first-entry modal without expiring or editing the real Pro entitlement.
- Changed: the existing `entitlement_reminder_test_whitelist` now supports an optional `recovery` preview mode. For a matched active entitlement, `getEntitlementStatus` returns a separate `offerNoticePreview`; only the homepage notice builder consumes it. Membership cards, ads, Pro access, payment offers, refund state, and plugin permissions continue using the real entitlement response.
- Online actions: updated `quickstartFunctions` code only, uploaded Mini Program development version `1.3.29`, and switched the owner redemption code `OBPROT93C6` whitelist record to `recovery` mode with a display expiry of `2026-07-16T14:48:51.670Z` (`2026-07-16 22:48` Beijing time).
- Verification: added failing tests for the missing recovery preview and client routing, then passed `tests/expiry-reminder-preview-core.test.js`, `tests/home-ui.test.js`, `tests/pro-offer-notice.test.js`, and JavaScript syntax checks. The deployed administrator action returned the expected active record with `previewMode=recovery`.
- Cleanup: disable the whitelist record after the owner finishes visual testing. Development version `1.3.29` has not been submitted for review or formally released.

### 2026-07-14 - 发布 Obsidian 插件 1.3.25：小红书视频跳过图片 OCR

- 目标：关闭小红书视频笔记（含封面/预览图）的图片 OCR；仅让图文长文笔记继续使用图片 OCR。
- 范围：仅修改 Obsidian 插件发布源、插件测试和版本清单；未修改小程序、云函数、业务数据、本地 OCR 安装器、视频下载或音视频转写。
- 根因与修复：原逻辑在识别笔记是否为视频前执行 OCR，带封面图的视频会把封面送入 OCR。现在当小红书解析结果包含 `videoUrl`，或已解析到 `mediaUrl` 时，标记为视频并跳过 `enrichXiaohongshuExtractionWithOcr`；无视频媒体的图文笔记保留原有 OCR 路径。
- 测试：先新增视频 OCR 守卫的回归断言，并确认旧代码按预期失败；修复后 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 与 `git diff --check` 均通过。
- 发布：已推送默认分支提交 `f3f7a23`，已推送标签 `1.3.25`，GitHub Release：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.25>。本地安装包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.25.zip`。
- 发布核验：发布检查确认默认分支、raw manifest、Release tag、`main.js`/`manifest.json`/`styles.css`/`versions.json`/zip 资产和本地 zip manifest 均为 `1.3.25`。
- 风险与下一步：视频媒体若因平台限制未能解析到 `videoUrl` 或 `mediaUrl`，该笔记仍会走图文 OCR 路径；请以一篇带封面图的小红书视频实测确认媒体解析正常时不再出现 OCR 段落，同时确认图文长文仍会产出 OCR。

### 2026-07-14 - 发布 Obsidian 插件 1.3.24：小红书评论分页与折叠回复采集

- 目标：改善小红书评论区采集不全的问题；默认最多采集 200 条主评论，并继续采集已折叠评论下的回复。
- 范围：仅修改 `obsidian-plugin/wechat-inbox-sync/` 的插件发布源、对应测试和版本清单；未修改小程序、云函数、业务数据或用户配置。
- 实现：在已登录的小红书页面会话内，按游标分页请求主评论接口和子回复接口（携带页面会话凭据）；保留原有网络响应、调试器与 DOM 展开/滚动兜底；评论去重改为 ID 优先，避免相同作者、相同文本的不同评论被错误合并。采集结果会写入不含 Cookie、授权头等敏感信息的停止原因诊断注释。
- 发布：已推送插件市场主分支提交 `a2eee5e` 与标签 `1.3.24`，GitHub Release：<https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.24>。本地安装包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.24.zip`。
- 验证：`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`git diff --check` 和插件发布检查脚本均通过；已核对 Release 与本地 zip 中的 manifest 均为 `1.3.24`。
- 风险与下一步：小红书可能因登录失效、验证码或接口变动少返回评论；插件不会绕过这些平台限制，会保留安全的诊断停止原因。下一步由用户在真实、已登录的小红书笔记（多页评论且有折叠回复）中验证采集效果。

### 2026-07-14 - Refresh owner seven-day expiry-reminder preview

- Goal: let the owner verify the homepage Pro countdown after the reminder window was shortened from 30 days to 7 days.
- Online data change: updated the active `entitlement_reminder_test_whitelist` record for redemption code `OBPROT93C6`; the display-only expiry is `2026-07-20T14:24:49.770Z` (`2026-07-20 22:24` Beijing time), about six days from the update.
- Safety: the record only supplies `displayExpiresAt` for the homepage reminder. The real entitlement expiry, Pro access, payment pricing, refund state, and subscription-message schedule are unchanged.
- Verification: the deployed `quickstartFunctions` administrator action returned success with the matching code, active status, and new preview expiry.
- Cleanup: after visual verification, disable this whitelist record through `adminUpsertExpiryReminderPreviewWhitelist` with `status: disabled`.

### 2026-07-14 - 补全抖音外部协议重定向拦截

- 目标：修复插件更新后处理部分抖音短链时仍弹出“获取打开此 bytedance 链接的应用 / Microsoft Store”的问题。
- 根因：`1.3.20` 已拦截页面导航、子框架和新窗口，但 Electron 的程序化 `loadURL` 不触发 `will-navigate`，服务器侧重定向需要单独使用可取消的 `will-redirect`；同时短链解析结果可能直接变成 `bytedance://`，旧代码仍会把它交给 `requestUrl`。
- 影响范围：仅修改隔离工作区 `.worktrees/release-plugin-1.3.20/` 中的插件发布源 `obsidian-plugin/wechat-inbox-sync/main.js` 与 `tests/plugin-main-ai.test.js`；未修改小程序、云函数、支付、绑定或用户数据。
- 修改：隐藏社交网页增加 `will-redirect` 外部协议拦截；抖音/小红书短链解析后若结果为非网页外部协议，则在进入 Obsidian/Electron 请求前终止。正常 `http/https` 页面、媒体下载、转写和原视频保存路径保持不变。
- 基线：发现远端主分支已发布 `1.3.21`，已将修复迁移到提交 `b983dcd` 的最新基线，避免覆盖 `1.3.21` 新增的原视频保存校验能力。
- 验证：回归测试先分别复现缺少 `will-redirect` 和 `bytedance://` 被交给网页请求的失败，再完成修复；`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、插件 `node --check` 与 `git diff --check` 通过。
- 发布：已基于远端 `1.3.21` 发布 `1.3.22`。修复提交为 `1b9523c`，版本提交为 `fa71af7`；默认分支 `main`、tag、GitHub Release、raw manifest、Release 资产和桌面 zip 均回读为 `1.3.22`。正式地址：`https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.22`，桌面包：`C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.22.zip`。
- 发布后验证：GitHub Actions Release 成功；Obsidian 发布检查器全部通过。按用户要求先发布再实机测试，下一步使用原问题抖音链接在 Windows Obsidian 中确认不再出现 Microsoft Store 弹窗，并确认转写及原视频保存仍正常。

### 2026-07-14 - Pro 到期提醒窗口缩短为 7 天

- 目标：避免 Pro 有效期还很长时过早展示倒计时和续费提醒。
- 影响范围：小程序首页 Pro 优惠提醒状态、对应回归测试和设计文档；不修改 Pro 权限、价格、支付、订阅消息或管理后台的续费关注名单。
- 修改：用户端提醒窗口由 30 天缩短为 7 天；剩余时间正好等于 7 天时显示，超过 7 天隐藏，过期后仍按既有一次性 48 小时回归优惠逻辑处理。
- 线上动作：已上传微信小程序开发版 `1.3.28`，描述为“Pro到期提醒改为7天内展示”；尚未提交审核或正式发布。
- 验证：先新增窗口常量和 7 天边界断言，确认旧 30 天实现按预期失败；修复后 `node tests/pro-offer-notice.test.js`、`node tests/home-ui.test.js`、相关 JavaScript 语法检查和 `git diff --check` 通过。
- 下一步：用一个剩余 7 天以内和一个剩余超过 7 天的测试账号验证首页展示差异，再决定是否提交正式版审核。

### 2026-07-14 - 同步首页插件公告到 GitHub 最新版本

- 目标：让首页插件更新公告显示 GitHub 当前最新 Release，而不是继续停留在 `1.3.3`。
- 影响范围：小程序首页默认配置、`quickstartFunctions` 公共配置默认值、首页与公共配置回归测试、短业务环境 `public_config` 数据；不修改公告功能、Pro 价格或支付逻辑。
- 版本依据：GitHub Release API 最终回读最新版本为 `1.3.20`，发布时间为 `2026-07-14T13:50:23Z`，首页按北京时间展示 `2026-07-14 21:50`。
- 线上动作：通过长环境函数读取和更新短业务数据环境的首页公共配置，回读确认 `pluginVersion=1.3.20`、`updatedAt=2026-07-14 21:50`；先上传的开发版 `1.3.26` 在并发发布 `1.3.20` 前使用了 `1.3.19`，随后已上传开发版 `1.3.27` 覆盖；尚未提交审核或正式发布。
- 验证：先更新版本断言并确认旧代码按预期失败；修改后 `node tests/home-ui.test.js`、`node tests/public-config-core.test.js`、相关 JavaScript 语法检查和 `git diff --check` 通过。
- 结果：已发布的小程序可通过云端公共配置读取最新公告；开发版和未来代码回退路径也使用相同版本与时间。

### 2026-07-14 - 发布插件 1.3.20 并拦截抖音外部应用弹窗

- 目标：在完整保留正式版 `1.3.19` 的 Pro 原始音视频保存与转写能力的前提下，阻止后台解析抖音时触发 `bytedance://` 等协议并弹出 Microsoft Store。
- 影响范围：插件 / 测试 / 发布资产 / 文档；不涉及小程序、云函数、支付、绑定码或用户数据。
- 修改文件：隔离工作区 `.worktrees/release-plugin-1.3.20/` 中的 `obsidian-plugin/wechat-inbox-sync/main.js`、两份 `manifest.json`、两份 `versions.json`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`；主项目更新本工作日志。
- 线上动作：已将提交 `adee292` 推送到 GitHub 默认分支 `main`，创建并推送 tag `1.3.20`；GitHub Actions Release 成功，正式地址为 `https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.20`。
- 数据变更：无。
- 验证：确认线上正式 `1.3.19` 提交 `c3db2e9` 未包含此前隔离分支中的协议拦截，因此用户仍弹窗不是转写回退；从该正式提交创建 `1.3.20`。协议回归先失败后通过，覆盖网络请求、主页面导航、子框架导航和新窗口，验证 `bytedance://`、`snssdk...://` 被阻止且 `http/https/blob/data/about` 放行。`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、插件语法检查、`git diff --check` 通过；差异检查确认没有修改 `saveSourceMediaAttachment`、Pro 媒体开关或既有转写实现。
- 结果：Obsidian 发布检查脚本全部通过，默认分支与 raw manifest 为 `1.3.20`，Release 含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 zip；线上 `main.js` Git blob 与提交完全一致，并同时包含协议拦截和 `1.3.19` 媒体保存功能。桌面安装包为 `C:\Users\ADMIN\Desktop\wechat-inbox-sync-1.3.20.zip`。
- 已知风险：自动测试和线上资产已闭环，但仍需在真实 Windows Obsidian 中用触发过弹窗的同一条抖音链接做一次用户侧冒烟验证；若抖音改用 Electron 事件之外的系统调用，需要根据新日志继续补充拦截。
- 下一步：在 Obsidian 社区插件里检查更新到 `1.3.20`，用原问题链接同步一次，确认不再弹 Microsoft Store 且转写与可选原始媒体保存继续正常。

### 2026-07-14 - 优化首页 Pro 优惠提醒卡片

- 目标：解决首页 Pro 到期/续费提醒文字发白、位置突兀的问题，并把提醒放到插件更新公告下方。
- 影响范围：小程序首页 UI、首页回归测试；不修改优惠资格、价格、支付、Pro 权限或云端数据。
- 根因：通用 `.notice-bar` 按钮重置样式位于文件后部，把提醒卡原有深色背景覆盖为透明，但白色文字仍然保留，形成低对比度显示。
- 修改：固定插件更新公告在上、Pro 优惠提醒在下；使用首页专属高优先级样式，将提醒改为暖白底、金色边框、深色正文和深绿续费按钮。
- 验证：先增加布局顺序和关键视觉样式断言，确认旧实现按预期失败；修复后 `node tests/home-ui.test.js`、`node tests/pro-offer-notice.test.js`、`node --check miniprogram/pages/index/index.js` 和相关文件 `git diff --check` 通过。
- 线上动作：已上传微信小程序开发版 `1.3.25`，描述为“优化Pro优惠提醒卡片展示”；尚未提交审核或发布正式版。
- 下一步：在微信开发者工具和真机检查窄屏下两张公告卡的间距、文字换行和按钮可读性，通过后再提交正式版审核。

### 2026-07-14 - 拦截抖音解析时的外部应用协议弹窗

- 目标：修复插件后台解析抖音链接时触发 `bytedance://`，导致 Windows 提示前往 Microsoft Store 查找应用的问题。
- 影响范围：插件 / 测试 / 文档。
- 修改文件：隔离工作区 `.worktrees/douyin-external-protocol/` 中的根目录与 `obsidian-plugin/wechat-inbox-sync/` 发布资产、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`；主项目仅更新本工作日志。
- 线上动作：无；尚未推送 GitHub 或发布插件市场版本。候选分支 `codex/fix-douyin-external-protocol` 已提交为 `38d854f`，并生成桌面候选包 `wechat-inbox-sync-1.3.19-rc.zip`。
- 数据变更：无。
- 验证：在远端最新 `1.3.18` 基线上先运行测试确认协议接线断言失败，再实现修复；随后 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、两份 `main.js` 语法检查、发布资产一致性、相关文件 `git diff --check` 通过。候选 zip 包含必需资产，内置 `manifest.json` 为 `1.3.19`。
- 结果：`1.3.19` 候选版的抖音隐藏解析窗口会在网络请求、页面跳转和新窗口三个入口拦截 `bytedance://`、`snssdk...://` 等外部应用协议；`http/https/blob/data/about` 仍正常放行，不影响网页和媒体抓取。
- 已知风险：现有市场版本不会自动获得该行为；仍需推送默认分支、创建 `1.3.19` GitHub Release，并用真实 Windows 环境的抖音链接验证系统弹窗不再出现。
- 下一步：选择保留候选分支、推送并创建 PR，或执行正式 `1.3.19` 发布；正式发布后运行市场发布检查脚本验证默认分支、tag、Release 资产和 raw manifest。

### 2026-07-14 - Clarify post-expiry pricing and one-time recovery copy

- Goal: remove ambiguity from the new Pro offer notices without changing any pricing or eligibility behavior.
- Copy: active trial/Pro notices now say `到期后开通/续费会员恢复原价`; the recovery modal, homepage entry, expired membership card, and Pro pricing tip state that each user has only one recovery-offer opportunity.
- Verification: notice, homepage UI, pricing wiring, and payment tests passed; Mini Program utility and Pro page syntax checks plus `git diff --check` passed.
- Deployment: uploaded Mini Program development version `1.3.24` with description `优化Pro到期与回归优惠说明`; formal review/release remains pending true-device validation.

### 2026-07-14 - Add visible Pro renewal and 48-hour return-offer notices

- Goal: make active Pro/trial users and eligible expired users clearly aware of their current renewal pricing without introducing coupon state or changing payment eligibility.
- Mini Program behavior: active Pro/trial users in the final 30 days receive one modal per `expiresAt` explaining 68/108 renewal pricing and 78/118 post-expiry pricing; eligible expired users receive one modal per server recovery record with its exact Beijing-time expiry. Dismissing either modal leaves the existing homepage countdown entry visible.
- Safety: local storage only records that a modal was seen. Recovery eligibility and its fixed 48-hour window continue to come from `quickstartFunctions`; refreshing or changing the device clock cannot extend it. The modal waits behind the plugin update announcement instead of stacking over it.
- Files: added `miniprogram/utils/pro-offer-notice.js` and `tests/pro-offer-notice.test.js`; integrated the pure notice state and modal queue in `miniprogram/pages/index/index.js`; updated the homepage source-contract test and product decision documentation.
- Verification: the new notice test first failed because the module did not exist, then passed after implementation. Fifteen focused pricing, payment, reminder, homepage, binding/sync, infrastructure, and regression tests passed, along with syntax checks for the new utility, homepage, Pro page, and main cloud function. `git diff --check` passed.
- Deployment: uploaded Mini Program development version `1.3.23` with description `Pro续费与48小时回归优惠提醒`. No cloud-function deployment or user-data migration was needed for this UI-only change; formal review/release remains pending true-device validation.
- Remaining validation: true-device check one active trial, one paid Pro inside the final 30 days, and one eligible expired account; confirm each modal appears once, “稍后再说” preserves the homepage entry, and “立即续费” opens the Pro page.

### 2026-07-14 - Simplify Pro renewal pricing and preserve the one-time return offer

- 目标：停止优惠券方案，统一为服务端自动选价，并把用户已发布的年卡原价从 79 元同步为 78 元。
- 影响范围：小程序 Pro 页面、`quickstartFunctions`、`syncApi`、支付与价格回归测试、订阅消息文案、产品决策文档。
- 修改文件：两份 `trial-pricing-core.js`、两份 `payment-core.js`、`miniprogram/pages/pro/index.js`、`pro-expiry-subscribe-core.js` 及对应测试和决策文档。
- 行为：月卡 19.9 元；免费/过期用户年卡 78 元、两年卡 118 元；有效 Pro（含体验与正式会员）自动使用 68/108；不增加优惠券领取或核销状态。
- 48 小时回归：历史过期用户第一次在过期后查询权益时，服务端为该 OpenID 创建唯一回归记录，并从创建时刻固定计算 48 小时；刷新或再次进入不会延长，回归价支付成功后标记为已使用。
- 数据变更：无。没有创建优惠券集合，也没有修改现有权益、订单或兑换码数据。
- 线上动作：已用腾讯云 CLI 更新长环境 `quickstartFunctions` 与 `syncApi`；已用微信开发者工具 CLI 更新短业务环境同名两函数；已上传小程序开发版 `1.3.22`，尚未提交审核或发布正式版。
- 验证：价格、支付、UI、订阅消息的聚焦测试先对旧 79 元实现产生预期失败，修改后通过；`trial-pricing-core`、`trial-pricing-wiring`、`payment-core`、支付发货锁与接线、订阅提醒、首页 UI、绑定/同步、会员展示、`syncApi`、基础设施双环境与回归契约共 14 个测试通过，7 个相关 JavaScript 文件语法检查通过。
- 已知风险：微信后台 `pro_year` 道具必须确实已发布为 78 元，否则会因客户端/服务端签名金额与道具价格不一致导致支付失败。
- 线上回读：短环境和长环境下载后的 `trial-pricing-core.js` 均包含 7800/6800/10800 且不含 7900；短环境两份 `payment-core.js` 包含 7800 且不含 7900。
- 下一步：在开发版真机分别验证免费/过期、有效体验、有效正式 Pro 和 48 小时回归用户；确认显示价格与订单金额、道具 ID 一致后再提交正式版审核。

### 2026-07-14 - 确认 Pro 续费价格采用简化方案

- 目标：停止建设优惠券状态机，恢复按有效 Pro 状态自动选择续费价的简单方案。
- 最终规则：月卡 19.9 元；年卡原价 78 元、Pro 有效期内 68 元；两年卡原价 118 元、Pro 有效期内 108 元。体验期属于有效 Pro，过期后恢复原价。
- 兼容：保留现有一次性历史用户回归优惠和支付价格保护；不新增优惠券集合、领券 UI、券核销或优惠券提醒。
- 文档：新增 `docs/superpowers/specs/2026-07-14-pro-renewal-pricing-simplification-design.md`，并明确其取代同日优惠券设计。
- 线上动作：无。本次仅完成设计存档，尚未修改、部署或发布运行代码。
- 下一步：复核设计后编写实施计划，再修改云函数、小程序和测试。

### 2026-07-14 - Windows OCR 自动修复 Visual C++ 运行库

- 目标：解决 OCR 依赖已安装但 `rapidocr_onnxruntime` 导入验证失败时只能返回笼统错误、用户需要手动排查系统运行库的问题。
- 影响范围：Windows OCR 安装器、插件发布包回归测试、腾讯云静态托管安装器；不修改 ASR、macOS、小程序、云函数或用户数据。
- 根因证据：用户诊断显示 Python 3.12 和 14 个 OCR 包均已安装，失败发生在原生模块导入阶段；当前安装器吞掉了具体导入模块和 traceback。ONNX Runtime Windows 构建依赖 Microsoft Visual C++ Runtime。
- 修改：Windows 安装器按 `numpy`、`cv2`、`onnxruntime`、`rapidocr_onnxruntime` 分阶段验证并记录真实错误；仅当错误命中 DLL/VC++ 特征时，从微软官方地址下载 x64 Redistributable，校验 Microsoft Authenticode 签名后通过 UAC 安装一次，并自动重试导入。取消 UAC、签名异常、安装失败或需要重启都会返回明确原因。
- 线上动作：已上传 `install-local-ocr.ps1` 到长环境静态托管 `local-ocr/common/install-local-ocr.ps1`；公网 CDN 回读 SHA-256 与本地一致。插件 `1.3.17` 会动态下载该安装器，因此本次无需发布插件市场版本。
- 验证：新增断言先失败后通过；`node tests/plugin-marketplace-package.test.js`、PowerShell AST 语法检查通过；微软下载文件签名验证为 `Microsoft Corporation`；独立临时目录完整安装 OCR 成功，四个 Python 模块逐级导入成功。
- 已知风险：真正缺少运行库的电脑会出现一次 Windows UAC 确认，系统安全策略拒绝提权时无法自动安装；若导入失败并非 DLL/VC++ 原因，安装器不会误装运行库，而会在诊断中保留具体失败模块。
- 下一步：让该 Windows 用户重新点击安装/修复；同时重新绑定其已显示 `unbound` 的小程序绑定码。若仍失败，新的诊断会直接给出 `cv2` 或 `onnxruntime` 的底层错误。

### 2026-07-14 - Create a Feishu operations-reporting copy

- Goal: preserve the owner's current manual operations spreadsheet while creating a separate copy for reporting automation and future AI-assisted operations analysis.
- Online action: created `Obsidian 内容同步助手｜运营数据日报（副本）` at `https://my.feishu.cn/wiki/XvRDwXfSDiTJU4kVAMXcdEjgnfc` without modifying the original spreadsheet.
- Data: the copy inherited the original historical rows and values. Its workbook now contains `每日经营日报`, `付费订单明细`, `内容流量明细`, and `周运营建议` worksheets.
- Verification: Feishu reported `Saved to cloud`; the copied daily sheet was reopened and visually verified to contain the historical traffic, user, trial, payment, conversion-rate, and revenue values.
- Remaining work: the three new detail/advice sheets are structural placeholders. Automatic order enrichment, daily aggregation, Feishu API writes, timers, and the weekly analysis Agent are not connected yet.

### 2026-07-14 - Switch Pro trial expiry reminders to the detailed member-expiry template

- Goal: make the subscription message explain both why the user should renew and how pricing changes after the trial expires.
- New template: `vy3I06dFZ_b4v_7YalDOdaygi3A2uJ6lyixQt9ttHs0` with `thing1` 会员权益, `time3` 到期时间, `thing5` 温馨提示, and `thing2` 会员类型.
- Message fields: 会员权益=`到期前优惠：年68元，两年108元`; 到期时间=the entitlement's real Beijing-time expiry; 温馨提示=`到期后原价：年79元，两年118元`; 会员类型=`7天Pro体验会员`.
- Compatibility: new trial claims request authorization for the new template. Existing accepted records keep their stored old template ID and continue using the old field mapping, so historical authorizations are not invalidated by the migration.
- Online actions: redeployed `quickstartFunctions`, downloaded the deployed source and verified both template mappings; uploaded Mini Program development version `1.3.21` with description `Pro体验到期提醒模板升级`.
- Verification: the focused subscription-message test failed against the old mapping, then passed after implementation. `node tests/pro-expiry-subscribe-core.test.js`, `node tests/home-ui.test.js`, `node tests/expiry-reminder-preview-core.test.js`, relevant syntax checks, and `git diff --check` passed.
- Remaining validation: use a fresh test account in development build `1.3.21`, claim the 7-day trial and allow the native subscription prompt. The real reminder remains scheduled for the final 25 hours of the trial.

### 2026-07-14 - Clarify trial-expiry renewal pricing in the subscription message

- Goal: make the trial-expiry subscription message clearly distinguish the renewal price before expiry from the standard price after expiry.
- Changed: the approved template's `thing2` value is now `到期将至：68/108；过期79/118`; it keeps `time3` for the trial start time and `time4` for the exact expiry time. The message opens the Pro page, where 68/108 map to the annual/two-year cards and 79/118 map to the corresponding standard prices.
- Constraint: the WeChat `thing` keyword is short, so the complete wording with all units does not fit safely in that one field. The compact text preserves all four price points and avoids a rejected subscription-message request.
- Online action: redeployed `quickstartFunctions` and downloaded the deployed source to verify `thing2`, `time3`, and `time4` are present with the new value.
- Verification: `node tests/pro-expiry-subscribe-core.test.js`, `node --check cloudfunctions/quickstartFunctions/pro-expiry-subscribe-core.js`, and `git diff --check` passed.
- Result: users who granted the subscription-message authorization receive the expiry time plus the before/after renewal price distinction, then can tap through to the full Pro pricing page.

### 2026-07-14 - Fix owner expiry-reminder preview state compatibility

- Goal: make the owner-only homepage reminder render for the existing active entitlement whose real expiry is in 2038.
- Root cause: the active entitlement's redemption code (`OBPROT93C6`) matches the whitelist and the runtime uses the correct short business-data environment, but the preview helper rejected legacy entitlement documents when their `status` field was absent. The main entitlement state builder correctly treats that same legacy shape as active, so the two checks were inconsistent.
- Changed: `expiry-reminder-preview-core.js` now treats a missing status as active while still rejecting an explicit non-active status. Added a regression test for the legacy document shape.
- Online action: redeployed `quickstartFunctions` and downloaded the deployed source to verify the corrected condition.
- Verification: `node tests/expiry-reminder-preview-core.test.js`, `node tests/pro-expiry-subscribe-core.test.js`, `node tests/home-ui.test.js`, syntax checks, and `git diff --check` passed.
- Result: on the next homepage entitlement refresh, the owner sees the display-only 29-day renewal reminder. Actual expiry, payment, and Pro permission data are unchanged.

### 2026-07-14 - Repair owner expiry-reminder preview data

- Goal: restore the owner-only homepage expiry-reminder visual preview without changing the real Pro entitlement expiry.
- Root cause: the deployed code and Mini Program already supported `displayExpiresAt`, but no active matching document existed in the short business-data environment's `entitlement_reminder_test_whitelist` collection. The earlier preview write had not reached the runtime data store.
- Online action: invoked `adminUpsertExpiryReminderPreviewWhitelist` through `quickstartFunctions` and created an active record for the owner's current redemption code with `previewExpiresAt` set to `2026-08-12T12:00:00.000Z`.
- Result: the next entitlement refresh returns the display-only expiry for the owner, so the homepage shows the under-30-days renewal reminder. The real `expiresAt`, access control, payment pricing, and refund state remain unchanged.
- Verification: confirmed the deployed function contains the whitelist lookup and return field; the administrator call returned a successful created record; `node tests/expiry-reminder-preview-core.test.js` and `node tests/home-ui.test.js` passed.
- Cleanup: set this whitelist record to `disabled` through the same admin function after the visual test is complete.

### 2026-07-14 10:30 - Update the plugin Feishu tutorial link

- Goal: replace the plugin's general Feishu-hosted tutorial link with the owner-provided wiki URL.
- Impact: Obsidian plugin release metadata and settings-page tutorial button only; Mini Program, cloud functions, payment, binding, and Feishu OAuth behavior are unchanged.
- Changed files: `obsidian-plugin/wechat-inbox-sync/main.js`, both plugin manifest/version mirrors, and plugin regression tests. The release source is the plugin subdirectory.
- Online actions: pushed `main` commit `0aaacae`, created tag `1.3.17`, and published GitHub Release `1.3.17`.
- Data changes: none.
- Verification: first changed `tests/plugin-main-ai.test.js` and observed its expected failure against the old URL; then ran `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, `node --check obsidian-plugin/wechat-inbox-sync/main.js`, `git diff --check`, and `check_obsidian_release.ps1` for `mingjuner123-spec/wechat-inbox-sync@1.3.17`. All passed; the release contains `main.js`, `manifest.json`, `styles.css`, `versions.json`, and the ZIP, whose embedded manifest is `1.3.17`.
- Result: the plugin's general tutorial button now opens `Lm5kw8QXdiQE96kaDUYcnIsVnAd`; the separate Feishu official-API connection tutorial link remains unchanged.
- Known risk: the Community Plugins directory may take time to scan the new release, but existing installed users obtain updates from the GitHub release.
- Next step: install or update to `1.3.17` and verify the tutorial button opens the new page.

### 2026-07-14 - Pro 7-day trial expiry subscription reminder

- Goal: request a user-authorized Mini Program subscription message while a user claims the 7-day Pro trial, then send exactly one reminder shortly before the trial expires.
- Changed files: `miniprogram/pages/index/index.js`, `miniprogram/pages/pro/index.js`, `miniprogram/services/inbox-service.js`, `miniprogram/utils/pro-expiry-subscription.js`, `cloudfunctions/quickstartFunctions/index.js`, `cloudfunctions/quickstartFunctions/pro-expiry-subscribe-core.js`, the function `config.json`, `cloudbaserc.json`, focused tests, and `docs/DECISIONS.md`.
- Behavior: the native WeChat authorization request is invoked only from the direct claim tap. Rejecting, closing, or not supporting the request does not block trial activation. An accepted decision is stored in `pro_expiry_subscriptions`; a server timer runs every 30 minutes and sends once during the final 25 hours of an active trial. Paid, refunded, expired, or already-notified accounts are skipped. Conditional status updates prevent duplicate sends and allow at most three failed delivery attempts.
- Template migration: new claims now use the detailed member-expiry template recorded above. Existing accepted records from the original `账户余额提醒` template retain their stored template ID and continue using its `thing2` / `time3` / `time4` mapping. Values use Beijing time and the card opens `pages/pro/index` when tapped.
- Online actions: uploaded the Mini Program development version `1.3.20` (`Pro体验到期订阅提醒`); uploaded `quickstartFunctions` code using `tcb fn code update`; created trigger `pro-trial-expiry-reminder-every-30-minutes` with cron `0 */30 * * * * *`. The original combined `tcb fn deploy` command failed in the CLI after starting deployment, so code and trigger were deployed and verified separately. On 2026-07-14 the function was deployed again after adding the complete three-field payload. The deployed function was downloaded again and confirmed to include the handler, `subscribeMessage.send` permission configuration, all three template fields, and timer routing.
- Verification: `node tests/pro-expiry-subscribe-core.test.js`, `node tests/home-ui.test.js`, JavaScript syntax checks for cloud function and Mini Program files, `git diff --check`, successful code upload, downloaded deployed source verification, and trigger detail verification all passed.
- Remaining validation: use a separate test account in the `1.3.20` development build, claim the trial, tap Allow on the native prompt, then confirm the `pro_expiry_subscriptions` record appears. The real delivery is intentionally scheduled for the final day of the 7-day trial; no production user should be force-expired merely to test it.

### 2026-07-14 - Owner-only expiry-reminder preview whitelist

- Goal: allow a controlled preview of the homepage reminder for an active Pro account without changing its real entitlement expiry, purchase price, refund state, or access rights.
- Changed files: `cloudfunctions/quickstartFunctions/index.js`, `cloudfunctions/quickstartFunctions/expiry-reminder-preview-core.js`, `miniprogram/pages/index/index.js`, `tests/expiry-reminder-preview-core.test.js`, and `tests/home-ui.test.js`.
- Online actions: deployed `quickstartFunctions` to the long function environment, which continues to use the short business-data environment; created one owner-only record in `entitlement_reminder_test_whitelist` with a display expiry about 29.5 days ahead; uploaded Mini Program development version `1.3.19` (not submitted or released).
- Behavior: only an active entitlement whose current redemption code matches an active server-side whitelist record receives `displayExpiresAt`. The client uses that field only for the homepage reminder countdown; `expiresAt` and all server-side Pro/payment decisions remain unchanged.
- Verification: `node tests/expiry-reminder-preview-core.test.js`, `node tests/home-ui.test.js`, syntax checks for the edited JS files, `git diff --check`, function deployment success, and successful administrator creation of the preview record.
- Next step: test the `1.3.19` development build with the owner account. Disable the whitelist record through `adminUpsertExpiryReminderPreviewWhitelist` with `status: disabled` when the visual check is complete.

### 2026-07-14 - Remove the stale announcement summary from the homepage card

- Goal: remove the static “recent update” summary from the homepage announcement card so stale pricing or feature copy is not shown alongside the version metadata.
- Changed files: `miniprogram/pages/index/index.wxml`, `tests/home-ui.test.js`.
- Online actions: none. A Mini Program upload and release is required before phones reflect this layout.
- Verification: `node tests/home-ui.test.js`, `node --check miniprogram/pages/index/index.js`, and `git diff --check` passed.
- Result: the homepage card now shows only the plugin version, update time, and “view details”; the detailed update sheet remains available.

### 2026-07-14 - Show renewal reminder for every Pro account expiring within 30 days

- Goal: extend the homepage renewal reminder from trial users only to every active Pro user whose entitlement expires in less than 30 days.
- Changed files: `miniprogram/pages/index/index.js`, `tests/home-ui.test.js`.
- Online actions: none. This requires a Mini Program code upload and release before it reaches phones.
- Verification: `node tests/home-ui.test.js`, `node --check miniprogram/pages/index/index.js`, and `git diff --check` passed.
- Result: trial users retain trial-specific wording; formal Pro users see their remaining validity time and the same 68-yuan annual / 108-yuan two-year renewal reminder. Accounts with 30 days or more remaining do not see this card.
- Risk: this is a display reminder only; payment offers continue to be selected by the server.

### 2026-07-14 - Trial countdown, one-time return pricing, and payment price protection

- Goal: show active trial users a personal renewal countdown, give previously expired users one 48-hour return-price window, and preserve a discounted pending payment price for 30 minutes.
- Impact: Mini Program / quickstartFunctions / syncApi shared payment core / tests / documentation.
- Changed files: `miniprogram/pages/index/*`, `miniprogram/pages/pro/*`, `cloudfunctions/quickstartFunctions/index.js`, both `trial-pricing-core.js` and `payment-core.js` copies, public config defaults, and focused tests.
- Online actions: none. No Mini Program upload, cloud-function deployment, payment-item change, or production data change was performed.
- Data changes: none during development. After deployment, `trial_expiry_recovery_offers` is created lazily and stores only each eligible account's single return-offer timestamps and status.
- Verification: `node tests/home-ui.test.js`, `node tests/public-config-core.test.js`, `node tests/trial-pricing-core.test.js`, `node tests/trial-pricing-wiring.test.js`, `node tests/payment-core.test.js`, `node tests/sync-api-core.test.js`, `node tests/inbox-service.test.js`, `node tests/admin-backend.test.js`, relevant `node --check` commands, and `git diff --check` all passed.
- Result: active trials display an in-app countdown and an urgent final-day message; expired trial/historical Pro users receive one durable 48-hour 68/108 return offer on their next status request; paid/expired/refunded states cannot repeatedly create the offer; pending discounted orders preserve the original server-selected price for 30 minutes.
- Known risks: WeChat subscription-message push is not enabled because no approved template ID/field mapping is configured; the current expiry reminder is the in-app countdown. Production behavior requires deployment to the short business-data environment and Mini Program upload/release.
- Next step: deploy `quickstartFunctions` to the short business environment, upload the Mini Program code, then test an active trial, a historical expired account, an expired return offer, and a retry within/after the 30-minute payment-protection window.

### 2026-07-14 - 修复插件市场描述自动校验

- 目标：恢复 `wechat-inbox-sync` 在 Obsidian 社区目录中的可见性；此前 `1.3.15` 因描述包含 “Obsidian” 且未以市场接受的英文标点结尾，自动检查失败并导致条目下架。
- 改动：发布 `1.3.16`，将插件市场描述改为中文的“本地知识库”表述，以英文句号收尾；同步根目录镜像、插件发布源、版本映射和 README；新增回归断言，禁止描述再出现 “Obsidian”，并要求以 `.`, `!` 或 `?` 结尾。
- 部署：已推送 `main`（提交 `7e13896`）并创建 `1.3.16` 标签；GitHub Actions 已生成 [Release 1.3.16](https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.16)，含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 ZIP。
- 验证：红灯阶段 `node tests/plugin-marketplace-package.test.js` 因旧版本 `1.3.15` 失败；改动后同测试、`node tests/plugin-main-ai.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 和 `git diff --check` 均通过。发布检查脚本确认默认分支、Release 资产和本地 ZIP 内的 manifest 均为 `1.3.16`。
- 风险与下一步：本次只解决阻塞性 manifest 描述错误。官方社区注册表当前尚未镜像回该条目，需等待社区后台完成新版本自动检查并恢复列出；“额外不支持文件”和 artifact attestation 属于建议项，不阻止列出。文件系统、Shell、剪贴板权限提示为功能审核提示，需另行评估，不在本次改动范围内。

### 2026-07-13 - Keep renewal offer badges beside their plan names

- Goal: keep the "限时特惠" label for both annual and two-year active-Pro renewal plans on the same row as the plan name.
- Changed: the payment-plan heading now does not wrap; the plan title and badge do not shrink, while the plan content takes the remaining width.
- Impact: Mini Program Pro purchase-card styling only. Payment item IDs, amounts, entitlement checks, and payment flow are unchanged.
- Verification: `node tests/home-ui.test.js`, `node --check miniprogram/pages/pro/index.js`, and targeted `git diff --check` passed.
- Deployment: Mini Program development version `1.3.18` ("统一 Pro 续费标签排版", 299180 bytes) was uploaded. It still requires formal review and release before phone users see it.
- Risk: on extremely narrow layouts the title and badge intentionally take priority over a wrapped badge; price rendering remains in its own fixed-width group.

### 2026-07-13 - Active-Pro renewal pricing: 68/year and 108/two-year

- Goal: active Pro users, including active trial users, see 68 yuan/year and 108 yuan/two-year. Expired/free users see 79 yuan/year and 118 yuan/two-year. The monthly plan remains 19.9 yuan for everyone.
- Changed: server-side offer resolution, payment-order pricing-kind validation, Pro page price mapping, and targeted regression tests.
- UI: active Pro sees `79/年` struck through before `68/年`, and `118/两年` struck through before `108/两年`. Both are labelled as limited-time offers, and the page explicitly states that prices return to 79 yuan/year and 118 yuan/two-year after Pro expires. Expired/free users see only their actual prices.
- Home announcement: the compact notice reads: "新用户可领 7 天 Pro 体验。体验期内开通：年卡 68 元/年、两年卡 108 元/两年；到期恢复 79 元/年、118 元/两年。" Its announcement version is advanced to `2026-07-13-pro-trial-price-copy-v2` so this copy is shown again after the mini-program update.
- Payment item mapping: `pro_month` is 19.9 yuan; expired/free users use `pro_year` (79 yuan) and `Pro_2years` (118 yuan); active Pro users use `Pro_year_group` (68 yuan) and a published 108-yuan `Pro_2years_group` item. The two active-Pro item IDs are built-in defaults and may be overridden only with `VIRTUAL_PAY_ACTIVE_PRO_YEAR_PRODUCT_ID` and `VIRTUAL_PAY_ACTIVE_PRO_TWO_YEAR_PRODUCT_ID`.
- Deployment: the four virtual-payment items are reported published, including the 108-yuan `Pro_2years_group`. `quickstartFunctions` and `syncApi` were deployed to the long function environment on 2026-07-13 and their runtime `WECHAT_DATA_ENV` was verified as the short business environment. Mini Program development version `1.3.17` ("精简 Pro 价格公告", 299085 bytes) was uploaded; it has not been submitted for review or formally released.
- Verification: targeted pricing, payment, home UI, infrastructure, syntax, and whitespace checks passed locally. Both deployed function sources were downloaded after deployment and verified to contain the 10800-fen active two-year offer and `Pro_2years_group` mapping.
- Risk: the development upload does not change the production Mini Program. Submit and release `1.3.17`, then verify one active-Pro account sees 79/118 struck through before 68/108 and one expired/free account sees only 79/118. The mini program must not be relied on to force the payment price locally; the server remains the payment-price authority.

### 2026-07-13 - 插件市场首屏中文承诺

- 目标：将 Obsidian 插件市场首屏描述替换为已确认的中文承诺，明确公众号、飞书、小红书、抖音、B站、小宇宙、网页链接、PDF、MP3、MP4、文件与速记的收集范围。
- 影响范围：Obsidian 插件发布元数据、README、发布包测试与文档；不涉及小程序、云函数、同步行为、权益或支付。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/manifest.json`、根目录 `manifest.json` 市场镜像、两份 `versions.json`、`obsidian-plugin/wechat-inbox-sync/README.md`、`tests/plugin-marketplace-package.test.js`、文案规格与实施计划。
- 线上动作：已推送默认分支 `main`，创建标签 `1.3.15` 并由 GitHub Actions 生成 [Release 1.3.15](https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.15)。Obsidian 社区目录尚在缓存 `1.3.14`，需等待其抓取刷新后才会显示中文。
- 数据变更：无。
- 验证：先运行 `node tests/plugin-marketplace-package.test.js`，确认新文案断言按预期失败；更新后重新运行 `node tests/plugin-marketplace-package.test.js`、`node tests/plugin-main-ai.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 与 `git diff --check`，均以退出码 0 通过。GitHub Release 列出 7 个资源；从 Release 实际下载的 `manifest.json`、`versions.json` 和 ZIP 均验证为 `1.3.15`，raw 默认分支 manifest 已显示中文文案。
- 结果：已发布 `1.3.15`；插件发布源、根目录市场镜像、Release 资产和 README 使用同一中文价值承诺，发布包测试会防止日后漂移。
- 已知风险：公开页面内容受登录限制或页面结构变动影响，文案不保证私密或登录后内容一定能完整解析。
- 下一步：等待并确认 Obsidian 社区目录刷新到 `1.3.15`；刷新后，搜索和详情页将显示中文介绍。

### 2026-07-13 - Hide group-buy offer UI without removing its backend

- Goal: temporarily hide the group-buy discount entry and popup from the Pro page while retaining existing campaign, code, order, and historical payment behavior.
- Impact: Mini Program Pro page / home UI regression test / work log.
- Changed files: `miniprogram/pages/pro/index.js`, `miniprogram/pages/pro/index.wxml`, and `tests/home-ui.test.js`.
- Online actions: none. A Mini Program code upload and release is required before phone users stop seeing the entry.
- Data changes: none.
- Verification: added a failing regression assertion for a disabled group-buy UI gate, then ran `node tests/home-ui.test.js`, `node --check miniprogram/pages/pro/index.js`, and targeted `git diff --check`.
- Result: the group-buy UI gate defaults to disabled; campaign loading, the entry, and the popup all require that gate. Backend validation and already-created group-buy records remain untouched.
- Known risk: a developer could re-enable the explicit UI flag in a future code change; it remains intentionally code-controlled rather than tied to the backend campaign state.
- Next: include this Mini Program change with the separately approved trial-pricing release, then upload and verify the Pro page on a real device.

### 2026-07-13 - Route AI metadata through CloudBase Hunyuan only

- Goal: generate Pro descriptions and keywords for text, converted documents, webpages, and audio/video through the shared Hunyuan quota, without any local DeepSeek key.
- Impact: Obsidian plugin / `syncApi` / plugin and sync API regression tests / decision log.
- Changed files: `obsidian-plugin/wechat-inbox-sync/main.js`, `obsidian-plugin/wechat-inbox-sync/plugin-core.js`, `cloudfunctions/syncApi/index.js`, `tests/plugin-main-ai.test.js`, `tests/plugin-core.test.js`, `tests/hardening.test.js`, and `docs/DECISIONS.md`.
- Online actions: none. This requires a plugin release and a `syncApi` deployment together before users receive the new behavior.
- Data changes: none. No API keys or user records were changed.
- Verification: wrote regression tests first and observed failures for plain-text input and the active DeepSeek fallback; then ran `node tests/plugin-main-ai.test.js`, `node tests/plugin-core.test.js`, `node tests/hardening.test.js`, `node tests/sync-api-core.test.js`, `node tests/plugin-marketplace-package.test.js`, and syntax checks for the modified plugin and cloud function.
- Result: AI input now includes `record.content` and `metadata.convertedMarkdown`; all six record types are covered by regression assertions. Metadata failures are saved as short redacted Markdown comments when non-blocking. The active cloud route uses CloudBase Hunyuan only, and the plugin removes legacy local DeepSeek settings on load.
- Known risk: any existing DeepSeek variables in the CloudBase console are now unused by this metadata route, but should be removed separately only after confirming they are not used by another cloud function.
- Next: deploy `syncApi`, release the plugin, then validate one Pro text note and one Pro PDF/DOCX note on a real account.

### 2026-07-13 - Refund policy anchored to the original trial window

- Goal: make Pro refund eligibility follow the user's first 7-day trial period, rather than restarting a new 7-day window from payment time.
- Impact: `quickstartFunctions` / `syncApi` / admin console / payment tests / decision log.
- Changed files: `cloudfunctions/quickstartFunctions/index.js`, `cloudfunctions/quickstartFunctions/payment-core.js`, `cloudfunctions/syncApi/admin-handler.js`, `cloudfunctions/syncApi/payment-core.js`, `admin-console/app.js`, related tests, and `docs/DECISIONS.md`.
- Online actions: none. The matching `quickstartFunctions` and `syncApi` sources still need to be uploaded together; the admin-console static deployment also needs its normal publish step before the confirmation wording is visible.
- Data changes: none.
- Verification: added failing tests first for trial-window eligibility and trial-start lookup, then ran `node tests/payment-core.test.js`, `node tests/admin-backend.test.js`, `node tests/admin-console.test.js`, `node tests/payment-delivery-lock.test.js`, `node tests/payment-delivery-wiring.test.js`, `node tests/support-ops-core.test.js`, JavaScript syntax checks for both payment cores, both handlers, and the admin console, plus targeted `git diff --check`.
- Result: refunds are allowed only when payment and administrator confirmation both occur before the first trial's seven-day deadline. Historical trial start is recovered from `redeem_codes.trialOwnerOpenid`; new trial entitlements persist `trialStartedAt`. The admin action now requires an explicit confirmation that the original payment has already been refunded in WeChat before it rolls back the Pro entitlement and redemption code.
- Known risk: this remains a business-side refund confirmation, not an automatic money refund request. An automatic provider refund must be implemented as a separate, idempotent workflow with merchant configuration and provider status reconciliation.
- Next: upload `quickstartFunctions` and `syncApi` together, verify one in-window and one expired-trial test order in the admin console, then publish the admin static assets.

### 2026-07-13 - Payment support entry in the Pro purchase card

- Goal: give users a direct support route when virtual payment cannot be completed, without restoring the hidden home-page customer-service button.
- Changes: added a small "支付碰到问题？点击咨询客服" entry below the Pro purchase controls. It uses the native Mini Program customer-service button and sends a minimal support context containing the current order number, selected plan, order status, and payment error code when present. No WeChat ID or payment credential is included.
- Deployment: not uploaded or released. This is a `miniprogram/` change and requires a new Mini Program code upload/release before phone users see it. The Obsidian plugin is unaffected.
- Verification: `node tests/home-ui.test.js`, `node --check miniprogram/pages/pro/index.js`, and `git diff --check` for the modified files passed.
- Next: configure the customer-service recipient in the Mini Program backend, then upload a development build and confirm a real support message can be received from this page.

### 2026-07-12 - Refund entitlement recovery for `OBTRYCRBHG`

- Goal: revoke all access for a user whose payment was already refunded through the mini-program payment backend, including any retained trial/base period.
- Data change: verified the long-environment `syncApi` was reading the short business data environment, then reconciled paid order `OBPAY20260709072835DMGY1A` through the internal refund path. The order is now `refunded`; `OBTRYCRBHG` is `disabled`; its only associated entitlement is `disabled` and expires at the reconciliation timestamp. No second payment-provider refund was initiated.
- Verification: read back the order, redemption code, and all entitlements for the code owner. There was exactly one entitlement, and it is disabled. No other independent entitlement was present.
- Note: direct code disable alone is insufficient for a refund because a pre-existing active entitlement can remain usable; refunds must reconcile order, entitlement, and code together.

### 2026-07-12 - Release 1.3.14: reuse Xiaohongshu login state for media probing

- Goal: ensure Xiaohongshu audio/video media probing is independent from comment extraction and can reuse the saved Xiaohongshu login state when it exists.
- Changes: `renderSocialMediaUrlsWithElectron` now selects the Xiaohongshu session for Xiaohongshu URLs; all other platforms retain the existing session. Anonymous probing remains the default when the user has not logged in.
- Release: committed `a1d4712`, pushed to `main`, tagged `1.3.14`, and verified GitHub Release assets plus the local ZIP.
- Verification: added a regression assertion for the session selection; `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, `node --check obsidian-plugin/wechat-inbox-sync/main.js`, `git diff --check`, and the Obsidian release checker passed.
- Remaining risk: Xiaohongshu can still withhold a real media page from anonymous visitors. Login increases retrieval success, but comments are not a prerequisite for video transcription.

### 2026-07-12 - Release 1.3.13: recover Xiaohongshu videos from generic landing pages

- Goal: fix macOS cases where a Xiaohongshu video returns the generic "小红书 - 你的生活兴趣社区" landing page, is saved as a graphic note, and never reaches local transcription.
- Changes: only for that generic landing-page signature, the plugin now performs a hidden-page media probe using the Xiaohongshu session. When a media URL is found, it follows the existing audio/video transcription route; ordinary graphic notes keep their existing path. Diagnostic logging also replaces stale successful ASR text when a media download fails before transcription starts.
- Release: committed `d290eb7`, pushed to `main`, tagged `1.3.13`, and created GitHub Release `1.3.13` with `main.js`, `manifest.json`, `styles.css`, `versions.json`, and `wechat-inbox-sync-1.3.13.zip`.
- Verification: added regression coverage for the generic landing-page video case and pre-ASR download-failure log isolation; `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, `node --check obsidian-plugin/wechat-inbox-sync/main.js`, `git diff --check`, package inspection, and the Obsidian release checker all passed.
- Remaining risk: a media URL can still be unavailable or reset by Xiaohongshu's CDN. That is a transport failure after classification, not a graphic/video misclassification. The new isolated diagnostic will expose it cleanly for a specific link.

### 2026-07-12 - Isolate pre-ASR media download failures in diagnostics

- Goal: prevent a failed media download from appending to the previous successful transcript and making diagnostic reports misleading.
- Changes: when no transcription command has started, the plugin now replaces `transcribe-last.log` with the current failure wrapper. Failures after the native ASR command starts still retain that same run's native log.
- Deployment: not released to the Obsidian marketplace in this task.
- Verification: added a regression case for a prior successful transcript followed by `媒体下载超时`; `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, and `node --check obsidian-plugin/wechat-inbox-sync/main.js` passed.
- Next: include this diagnostic-only change in the next isolated plugin release; do not publish the current dirty workspace as-is.

### 2026-07-11 14:20 - Group-buy test whitelist and deployment audit

- Goal: let the current account test a group-buy purchase without weakening the new-customer rule or generating affiliate records.
- Scope: quickstartFunctions / syncApi / admin-console / tests / documentation.
- Changes: added a code-owned `group_buy_test_whitelist`; the cloud function checks that the caller's entitlement owns the whitelisted redemption code. Qualified test purchases persist `groupBuy.testMode`, then skip attribution, commission, and partner-count updates. The admin dashboard can add, list, and disable whitelist records.
- Online actions: attempted six incremental cloud-function uploads to the short environment, in dependency order, then one minimal retry after the user reauthenticated WeChat Developer Tools. All seven failed before upload at the WeChat Developer Tools signing request (`getCloudAPISignedHeader`, error 41002). A fresh function download verified that no whitelist module or wiring was uploaded.
- Data changes: none. No redemption code, OpenID, or whitelist record was written to cloud data.
- Verification: red-green tests for whitelist ownership and payment marker; `node tests/group-buy-test-whitelist-core.test.js`, `node tests/group-buy-test-whitelist-wiring.test.js`, `node tests/group-buy-core.test.js`, `node tests/payment-core.test.js`, `node tests/admin-console.test.js`, `node tests/admin-backend.test.js`, `node tests/home-ui.test.js`, `node tests/inbox-service.test.js`, `node tests/sync-api-core.test.js`; syntax checks for the modified JS files all passed.
- Result: implementation is local and verified. Production remains unchanged because the upload signing service rejected every request.
- Known risk: reauthentication alone did not restore the upload signature. Until an account with short-environment deployment signing permission can upload the functions, the existing account will still be rejected as a historical paid user, and the dashboard cannot add the whitelist record.
- Next: use the short-environment owner/cloud-development administrator account to deploy from the Developer Tools file tree, or resolve the WeChat signing service error; rerun the six-file incremental deployment, download both functions to verify the new modules, then add the test redemption code in the deployed admin dashboard and perform one test purchase.

### 2026-07-11 - 限时团购价与推广归因（本地实现，未部署）

- 目标：保持 19.9 / 68 / 118 正价套餐可见，仅在活动期通过团购码开放 59 元年卡与 108 元两年卡，并为码所属推广员记录首单和长期佣金。
- 修改：新增团购规则核心、活动价订单覆盖、Pro 页团购弹层、团购活动/码/佣金后台 HTTP 接口；支付成功写入归因和 7 天待确认佣金，退款作废记录。
- 数据集合：`group_buy_campaigns`、`group_buy_codes`、`group_buy_attributions`、`group_buy_commissions`。
- 部署：未部署。上线前必须在微信虚拟支付后台创建并发布 59 元年卡、108 元两年卡两个活动道具，再通过后台创建活动并填入对应 productId。
- 验证：`payment-core`、`group-buy-core`、`inbox-service`、`home-ui`、`sync-api-core`、`admin-backend` 测试及相关 JS 语法检查通过。
- 已知风险：本次仅新增后台 HTTP 管理接口，静态 `admin-console` 的可视化团购管理区尚未接入；`syncApi` 的支付通知镜像尚未写入团购账本，生产支付回调必须继续命中 `quickstartFunctions` 或补齐镜像后才能上线。

### 2026-07-11 - Harden macOS ASR package installation
- Goal: remove the remaining public-package-index dependency after fixing the managed Python download failure on macOS.
- Changes: macOS ASR installer now uses a Tencent CDN wheelhouse first for `whisper.cpp-cli==0.0.3` and `imageio-ffmpeg==0.6.0`; Apple Silicon and Intel wheel sets were uploaded under `local-asr/wheels/`.
- Deployment: updated `local-asr/common/install-local-asr-macos.sh` on CloudBase static hosting. No Obsidian marketplace release is required for currently installed clients to retrieve the updated remote installer.
- Verification: Tencent CDN ARM and Intel wheelhouse indexes both resolved the exact pinned macOS wheels through pip's target-platform resolver; installer syntax and plugin package tests passed.
- Remaining risk: first installation still needs network access for the fixed Python archive, ASR model, and wheel downloads. Each normal-path asset is now served from Tencent CDN; public sources are fallbacks only.

### 2026-07-11 - 修复 macOS ASR 固定 Python 下载链

- 目标：修复 Apple Silicon macOS 安装 ASR 时 uv 请求不存在的 `cpython-3.12-macos-aarch64-none`，导致整套本地组件无法完成的问题。
- 影响范围：Obsidian 插件 macOS ASR 安装器 / 腾讯云静态托管 CDN / 测试 / 文档。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh`、`obsidian-plugin/wechat-inbox-sync/main.js`、相关插件测试、`docs/DECISIONS.md`、`docs/WORKLOG.md`。
- 线上动作：已上传 macOS ASR 安装器到长环境静态托管 `local-asr/common/install-local-asr-macos.sh`；未发布新的 Obsidian 插件版本。
- 数据变更：无。
- 验证：用户诊断确认失败发生在 ASR 的 uv Python 下载阶段；确认 Apple Silicon 固定 Python 包可访问且含 `python/bin/python`；运行 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、macOS shell 语法检查均通过；CDN 回读 SHA-256 与本地脚本一致，旧插件的安装器校验仍接受该脚本。
- 结果：macOS ASR 与 OCR 都优先直接使用腾讯云固定 Python 包；当前用户重新点击安装/修复即可获取脚本，无需等待插件市场更新。
- 已知风险：ASR Python 包 `whisper.cpp-cli` 与 `imageio-ffmpeg` 仍需要网络安装，真实 macOS 需继续验证该阶段；Windows ASR 不依赖 Python。
- 下一步：收集该用户新的诊断信息；若 Python 阶段通过但 ASR 包安装失败，再单独镜像 ASR Python 包，不混入 Python 下载问题。

### 2026-07-11 - 修复 OCR 固定 Python 下载链

- 目标：修复 Windows/macOS 本地 OCR 安装时 uv 无法从自有 CDN 解析 Python 3.12，导致 OCR 安装失败的问题。
- 影响范围：Obsidian 插件本地 OCR 安装器 / 腾讯云静态托管 CDN / 测试 / 文档。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr.ps1`、`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr-macos.sh`、`obsidian-plugin/wechat-inbox-sync/main.js`、相关插件测试、`docs/DECISIONS.md`、`docs/WORKLOG.md`。
- 线上动作：已上传 Windows 和 macOS OCR 安装器到长环境静态托管 `local-ocr/common/`；未发布新的 Obsidian 插件版本。
- 数据变更：无。
- 验证：复现线上 uv 0.9.14 请求 `cpython-3.12-windows-x86_64-none` 失败；验证三个 Python 运行时对象与三个 wheelhouse 均可访问；在无系统 Python 的 Windows 临时环境中，直接下载固定 Python、创建 venv、离线安装 OCR wheelhouse 并导入 `RapidOCR` 成功；运行 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、PowerShell/Bash 安装器语法检查均通过；CDN 回读的两个安装器 SHA-256 与本地一致。
- 结果：当前插件重新点击安装/修复 OCR 时会优先走固定腾讯云 Python 包，不再依赖 uv 的镜像文件命名规则；旧插件的安装器校验仍接受新脚本，因此不必等待插件市场更新。
- 已知风险：macOS 的完整安装需由真实 macOS 用户再验一次；本地插件发布源此前与 CDN 脚本发生过漂移，下一次插件发布必须从干净发布基线制作并包含本次脚本与 `main.js` 的新鲜度校验。
- 下一步：收集一位 Windows 和一位 macOS 用户的最新安装诊断；确认后再走独立的插件市场发布流程。

本文件记录当前项目状态和最近上下文，帮助新对话、新窗口、新 agent 快速接上工作。

更新时间：2026-07-10

## 当前稳定理解

项目是一个多端产品：

- 微信小程序负责收集内容、绑定 Obsidian、开通 Pro、广告、虚拟支付。
- 云函数负责收集箱数据、绑定码、Pro 权益、兑换码、支付订单、飞书 OAuth、同步 API。
- Obsidian 插件负责把云端收集内容同步到本地 vault，并执行本地转写/OCR/飞书官方 API 同步等能力。
- CloudBase 采用双环境兼容结构：函数部署在长环境，绑定码、兑换码、Pro 和同步记录仍以短业务数据环境为准。
- 普通插件同步暂时使用短域名；飞书 OAuth、管理后台和新代码验证使用长域名。域名、函数命名空间和数据环境不能混为一谈。
- 域名迁移必须保留原绑定码，通过双入口兼容、静默探测和失败回退完成，不能要求所有用户重新绑定。

## 最近完成的工作

- 修复支付发放幂等：同一支付订单重复通知不会再次增加 Pro 有效期。
- 增加 7 天退款业务状态与权益回滚逻辑；真实微信资金退款接口仍需单独接入。
- 纠正 3 条历史重复加年的 Pro 权益，确认每条只有 1 笔真实支付订单。
- 建立基础设施长期记忆和护栏：
  - 新增 `docs/ARCHITECTURE.md`，记录短/长环境、域名和业务数据关系。
  - 在 `AGENTS.md` 增加基础设施红线和任务结束强制回填规则。
  - 新增 `docs/TASK_CLOSEOUT_TEMPLATE.md`。
  - 新增 `tests/infrastructure-contract.test.js` 并接入回归 CI。
  - 补充 `DECISIONS.md`、`RUNBOOK.md` 和 `RELEASE_CHECKLIST.md`。
- 小程序广告改为自主接入思路：
  - 激励广告保留。
  - 插屏广告位：`adunit-080aa7a67f50b9de`。
  - 原生模板广告位：`adunit-a9b616c898835639`。
  - 原生模板广告放在收集页支持平台图标下方、最近同步上方。
  - Pro 用户和 Pro 状态未确认时不展示广告。
- 看广告加次数从 10 次改为 5 次：
  - `cloudfunctions/quickstartFunctions/inbox-core.js`
  - `cloudfunctions/syncApi/inbox-core.js`
  - `miniprogram/pages/index/index.js`
  - `miniprogram/pages/index/index.wxml`
- 首页客服按钮已隐藏，客服弹窗和后端逻辑暂时保留。
- 补充了小程序首页和会员展示相关测试。

## 最近验证过的命令

```powershell
node tests/infrastructure-contract.test.js
node tests/admin-backend.test.js
node tests/payment-core.test.js
node tests/inbox-core.test.js
node tests/home-ui.test.js
node tests/membership-display.test.js
node --check miniprogram/pages/index/index.js
node --check miniprogram/utils/membership-display.js
node --check cloudfunctions/quickstartFunctions/inbox-core.js
```

## 当前已知风险

- 短域名仍运行历史同步实现，长域名承载当前部署的 `syncApi`。在完成兼容迁移前，两边代码版本可能漂移。
- 支付通知 URL 必须确认命中带有最新幂等逻辑的函数版本，不能只看“部署成功”。
- 插件当前会把误写入的长 API 地址归一化回短稳定入口，这是恢复绑定后的兼容策略，不应被随手删除。
- 根目录存在 `main.js`、`manifest.json`、`versions.json`，和 `obsidian-plugin/wechat-inbox-sync/` 下的插件发布文件容易混淆。
- 工作区里存在大量未跟踪临时目录和发布包，容易干扰 Git 判断。
- README 里有历史编码乱码，短期不要依赖它作为唯一项目说明。
- 小程序、云函数、插件三端经常同时涉及同一业务，改动前要先判断是否需要同步部署/上传/发布。
- CloudBase、飞书、微信支付等敏感配置不能写入仓库文档。

## 下次开工优先读

1. `AGENTS.md`
2. `docs/WORKLOG.md`
3. 涉及跨端、域名或 CloudBase 时读 `docs/ARCHITECTURE.md`
4. `docs/RUNBOOK.md`
5. `git status --short`
6. 本次任务相关代码和测试

## 下次可继续优化

- 梳理根目录插件镜像文件和插件发布源的关系。
- 清理 `.tmp-*`、zip 发布包、`.bak` 等未跟踪文件，但清理前先确认不需要保留。
- 建立小程序上传、云函数部署、插件发布的统一脚本或检查脚本。
- 为 Pro 权限、绑定码、兑换码、广告展示建立更完整的回归测试。
- 按 `docs/ARCHITECTURE.md` 分阶段实现自有 API 前门和绑定码无感迁移，不直接替换现有短域名。
- 给云函数增加稳定的 build ID/health 探针，部署后自动验证“请求实际命中了新版本”，而不是只相信部署成功提示。
- 建立脱敏 smoke test：同一测试绑定码在短/长入口的绑定状态、Pro 状态和到期时间必须一致。
- 建立数据迁移脚本目录和审计格式，涉及权益、兑换码、订单的历史数据修复不得再使用一次性临时命令。
- 增加 staging/canary 发布路径，绑定、支付、Pro、同步等高风险改动先小流量验证。
- 最终消除根目录插件镜像与正式插件发布目录的双源问题，由一个构建步骤生成发布资产。
- 研究微信“小绿书/图文笔记”的链接转存能力。该类型不是公众号文章，不能直接套用公众号文章提取或公众号图片 OCR；开始实现前需要真实分享链接样本，确认链接是否公开可访问、页面数据结构和图片资源授权方式。

## 最近任务记录

### 2026-07-11 07:12 - 修复 Pro 管理页 `plan is not defined`

- 目标：修复 Pro 管理页加载时的前端运行时错误。
- 影响范围：管理后台静态前端 / 测试 / 文档。
- 修改文件：`admin-console/app.js`、`tests/admin-console.test.js`、`docs/WORKLOG.md`。
- 线上动作：无。实际运营后台发布路径仍未登记。
- 数据变更：无。
- 验证：先在 `tests/admin-console.test.js` 增加“不允许存在 `plan.includes`”断言，运行 `node tests/admin-console.test.js` 按预期失败并定位未声明变量；删除该错误引用后运行 `node tests/admin-console.test.js`、`node tests/admin-backend.test.js`、`node --check admin-console/app.js`、`git diff --check -- admin-console/app.js tests/admin-console.test.js` 均通过。
- 结果：体验用户分支默认归为体验用户；付费、已到期体验和付费续费提醒分类规则不变。
- 已知风险：需要将修复后的静态管理页发布到实际运营后台地址后，外部用户才会看到修复。
- 下一步：确认实际运营后台静态发布路径，上传 `admin-console/` 资产并刷新验证页面。

### 2026-07-11 07:05 - 重组 Pro 管理为付费、体验和续费提醒分层

- 目标：删除后台“可用兑换码”列表，把 Pro 管理改为付费订单、付费 Pro、体验 Pro、已到期体验用户和临近/已到期付费用户五块，便于后续统计体验转化与付费续费。
- 影响范围：管理后台静态前端 / 测试 / 设计与实施文档。
- 修改文件：`admin-console/index.html`、`admin-console/app.js`、`tests/admin-console.test.js`、`docs/superpowers/specs/2026-07-11-pro-management-segmentation-design.md`、`docs/superpowers/plans/2026-07-11-pro-management-segmentation.md`、`docs/WORKLOG.md`。
- 线上动作：无。已确认 CloudBase 静态托管的 `cloud-admin/index.html` 是腾讯云后台壳页，不是本项目的 `admin-console/` 发布资产，因此未覆盖错误目标。
- 数据变更：无。
- 验证：先改 `tests/admin-console.test.js`，运行 `node tests/admin-console.test.js` 观察到旧页面缺少 `paidProTable` 的预期失败；实现后运行 `node tests/admin-console.test.js`、`node tests/admin-backend.test.js`、`node --check admin-console/app.js`、`git diff --check -- admin-console/index.html admin-console/app.js tests/admin-console.test.js` 均通过。
- 结果：付费用户定义为“存在已支付订单、已有支付关联/支付来源，或剩余有效期超过 300 天”；有效的非付费用户为体验用户；已到期列表仅放体验用户；付费用户中剩余有效期少于 30 天（含负数）进入续费提醒列表。保留生成兑换码和用户表里的兑换激活信息，删除可用兑换码列表及其筛选/操作控件。
- 已知风险：后台实际静态页发布地址尚未在仓库或运行手册登记，不能凭 CloudBase 中的 `cloud-admin/` 壳页推断并覆盖。
- 下一步：确认运营后台实际 URL 或静态发布路径后，只上传 `admin-console/` 对应资产；不需要再修改云函数或业务数据。

### 2026-07-11 06:49 - 上传小程序开发版 1.3.13 并完成短环境支付验证

- 目标：完成标准价与两年卡小程序版本上传，并在短环境支付函数更新后验证实际支付契约。
- 影响范围：小程序 / quickstartFunctions / syncApi / 文档。
- 修改文件：`docs/WORKLOG.md`；上传内容使用已通过验证的现有小程序改动。
- 线上动作：已上传微信小程序开发版 `1.3.13`，描述为“Pro价格调整与两年卡”，上传包总大小 288497 字节；用户已手动部署短环境的 `quickstartFunctions` 与 `syncApi`；未提交审核、未发布。
- 数据变更：无。
- 验证：重新运行 `node tests/payment-core.test.js`、`node tests/payment-delivery-wiring.test.js`、`node tests/sync-api-core.test.js`、`node tests/home-ui.test.js`、`node tests/public-config-core.test.js`、`node tests/redeem-code-core.test.js`、`node tests/support-ops-core.test.js`、`node tests/admin-backend.test.js` 及四个相关 JS 的 `node --check` 均成功；微信开发者工具 CLI 上传命令返回 `upload` 成功并回读上传大小。部署后从短环境重新下载两份函数，分别以 `createPaymentOrderDocument` 断言月卡 1990 分/30 天、年卡 6800 分/365 天、两年卡 11800 分/730 天和 `Pro_2years`，两份函数均通过；两份 `payment-delivery-lock.js` 均存在。
- 结果：开发版已可在微信后台看到，短环境的实际支付契约已更新；尚未对线上用户发布。
- 已知风险：提交审核和正式发布仍是两个独立步骤；发布前应复核三项微信道具仍为 19.9 / 68 / 118 元。
- 下一步：在用户确认后提交审核；审核通过后，在用户确认的最终发布动作前再次复核道具价格。

### 2026-07-11 06:30 - Pro 标准价短环境部署被微信上传签名服务阻断

- 目标：在用户已发布三个微信虚拟支付道具后，把月卡 19.9 元、年卡 68 元、两年卡 118 元（`Pro_2years`）部署到实际小程序调用的短业务环境，并继续上传小程序。
- 影响范围：quickstartFunctions / syncApi / 小程序 / 文档。
- 修改文件：`docs/WORKLOG.md`；本地支付与小程序改动沿用上一任务记录，未额外修改业务源码。
- 线上动作：已把长环境的两份函数以线上回读基线部署为最小价格补丁；短环境部署尝试两次均失败，未上传或发布小程序。
- 数据变更：无。
- 验证：微信开发者工具 CLI 能读取短环境、下载两份函数并查询到函数均为 `Active`，登录状态为有效；短环境回读确认原有 `payment-delivery-lock` 仍在。最小补丁在临时线上基线上通过两份 `node --check` 和三档订单映射断言。两次短环境部署均在微信上传签名接口返回 `getCloudAPISignedHeader ... ret:41002 system error`；失败后再次回读 `quickstartFunctions/payment-core.js`，仍为 990/4990 分，说明没有半成功上线。
- 结果：短环境当前仍是旧价格，用户看不到新版小程序，也不会遇到“新展示价但旧支付价”。
- 已知风险：微信开发者工具的上传签名服务或其登录会话未能为部署生成签名，虽然普通登录、环境查询、函数查询和下载均正常；不能在该状态下上传/发布小程序。
- 下一步：在微信开发者工具重新登录后，以短环境线上回读目录部署 `quickstartFunctions` 与 `syncApi`；回读确认 1990/6800/11800 分及 `Pro_2years` 后，上传小程序版本，最后由用户在微信后台确认正式发布。

### 2026-07-11 06:17 - 完成本地 Pro 标准价切换，线上发布被浏览器安全检查中止

- 目标：把月卡/年卡从 9.9/49.9 调整为 19.9/68，保留两年卡 118 元，并完成微信道具、云函数和小程序上线。
- 影响范围：quickstartFunctions / syncApi / 小程序 / 测试 / 文档；线上发布尚未发生。
- 修改文件：`cloudfunctions/quickstartFunctions/payment-core.js`、`cloudfunctions/syncApi/payment-core.js`、`tests/payment-core.test.js`、`docs/WORKLOG.md`。
- 线上动作：无。未部署云函数，未修改或发布微信道具，未上传或发布小程序。
- 数据变更：无。
- 验证：先把 `tests/payment-core.test.js` 改为 1990/6800 分并运行，确认旧实现以 `990 !== 1990` 失败；修改两份支付核心后，`node tests/payment-core.test.js` 通过。随后运行 `node tests/payment-delivery-wiring.test.js`、`node tests/sync-api-core.test.js`、`node tests/home-ui.test.js`、`node tests/public-config-core.test.js`、`node tests/inbox-service.test.js`、`node tests/redeem-code-core.test.js`、`node tests/support-ops-core.test.js`、`node tests/admin-backend.test.js` 和相关 JS 的 `node --check`，全部通过。
- 结果：本地代码三档价格为月卡 1990 分、年卡 6800 分、两年卡 11800 分；两年卡内部 planId 为 `pro_two_year`，微信 productId 为 `Pro_2years`。
- 已知风险：工作区存在大量其他未提交改动，不能直接整目录部署；小程序实际支付依赖短环境 `quickstartFunctions`，而当前 CloudBase CLI 只列出长环境。尝试读取已登录 Edge 微信后台时，Windows 控制因无法可靠确认当前网址而被安全策略中止，因此不能宣称线上已生效。
- 下一步：用户在 Chrome 打开并登录微信公众平台对应小程序后台，或提供可验证的目标后台网址后继续；先发布三项道具价格，再通过微信开发者工具向短环境部署最小支付补丁，上传/发布小程序，最后做线上订单金额和权益探针。

### 2026-07-10 23:24 - 恢复免费飞书并发布 Obsidian 插件 1.3.12

- 目标：纠正飞书官方提取被误纳入 Pro 的回归，确认现有用户兼容性，并完成插件版本管理和正式发布。
- 影响范围：`syncApi` / Obsidian 插件 / Git / GitHub Release / 测试 / 文档。
- 修改文件：`cloudfunctions/syncApi/sync-api-core.js`、`tests/sync-api-core.test.js`、`obsidian-plugin/wechat-inbox-sync/main.js`、插件与根目录 `manifest.json`/`versions.json`、`tests/plugin-main-ai.test.js`、相关决策和工作日志。
- 线上动作：已重新部署 `syncApi`，回读线上代码确认飞书提取 handler 不查询 Pro；从 `origin/main` 的 1.3.11 干净基线创建隔离发布分支，提交 `89ab76e`，快进推送到 `main`，创建并推送 tag `1.3.12`，GitHub Actions 成功创建 Release。
- 数据变更：无。只读审计 229 条权益，当前有效 81 条；有效权益中缺少到期时间 0 条、到期格式异常 0 条。
- 验证：先把免费飞书测试改为“不得调用 `getEntitlement`”，确认当前实现返回 500；移除误加的 Pro guard 后 `node tests/sync-api-core.test.js` 通过。发布工作区运行 `node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js` 和 `git diff --check` 均通过。发布检查确认默认分支和 raw manifest 均为 1.3.12，`versions.json` 包含 1.3.10/1.3.11/1.3.12，Release tag 与资产完整，本地 zip 内 manifest/main/styles/versions 完整。
- 结果：基础同步和飞书 OAuth/提取继续免费；Pro 校验仍只用于明确的付费云能力和官方组件下载。插件 1.3.12 已发布，包含凭证脱敏、飞书 URL 不携带凭证、以及本地组件到期校验。
- 已知风险：本地组件及安装依赖仍有旧公网 CDN 路径，1.3.12 尚未切换到私有 manifest 下载；有能力的用户仍可复制纯本地组件，但不能因此获得服务端付费能力。
- 下一步：观察 1.3.12 更新与飞书免费链路；完成私有组件对象和 manifest 后再发布下一版插件，旧公网路径在兼容验证完成前不下线。

### 2026-07-10 23:06 - 归档生产内置兑换码并加固 Pro 服务端边界

- 目标：先确认生产内置兑换码是否已有用户使用，在不改变现有权益和支付数据的前提下退役内置码；同时让付费云能力和官方组件 manifest 统一走服务端 Pro 校验，修复插件凭证泄露和到期缓存放行。
- 影响范围：`quickstartFunctions` / `syncApi` / Obsidian 插件源码 / 生产兑换码数据 / 测试 / 文档。
- 修改文件：`cloudfunctions/quickstartFunctions/index.js`、`cloudfunctions/quickstartFunctions/redeem-code-core.js`、`cloudfunctions/quickstartFunctions/legacy-redeem-archive-core.js`、`cloudfunctions/syncApi/index.js`、`cloudfunctions/syncApi/sync-api-core.js`、`cloudfunctions/syncApi/redeem-code-core.js`、`obsidian-plugin/wechat-inbox-sync/main.js`、相关测试、设计与实施文档。
- 线上动作：先回读线上函数并以线上源码为基线生成最小补丁；已部署 `quickstartFunctions` 和 `syncApi`。未发布新的 Obsidian 插件版本，未迁移或删除旧公网 CDN 组件。
- 数据变更：只读审计发现 10 条权益使用过生产内置码，其中 1 条仍有效、9 条已过期；创建 13 条 `disabled` 兑换码归档，累计关联 10 条原权益。没有删除或修改 `user_entitlements`、`payment_orders`，没有猜测同一用户的支付订单与内置码之间存在直接关系。
- 验证：归档 dry-run 返回 13 个码、10 条权益、1 条有效权益；提交后回读为 13 个码全部 `disabled`、`redeemedCount` 合计 10，再次 dry-run 仍为 10 条权益/1 条有效权益。线上代码下载回读确认两函数均移除内置码兜底，`syncApi` 包含统一 Pro guard 和组件 manifest 路由；短/长 HTTP 入口无凭证访问均返回 401。运行 `node tests/legacy-redeem-archive.test.js`、`node tests/redeem-code-core.test.js`、`node tests/sync-api-core.test.js`、`node tests/component-manifest-repository.test.js`、`node tests/plugin-main-ai.test.js`、`node tests/admin-backend.test.js`、`node tests/hardening.test.js`、`node tests/infrastructure-contract.test.js`、`node tests/plugin-marketplace-package.test.js`、`node tests/payment-core.test.js`、`node tests/payment-delivery-wiring.test.js` 及相关 `node --check`，全部通过。
- 结果：未兑换的历史内置码不能再创建 Pro；已有用户继续按原 `user_entitlements.expiresAt` 使用。云端媒体准备与云转写/OCR/AI 元数据一样由服务端拒绝免费用户；组件 manifest 仅对有效 Pro 开放。飞书官方提取继续免费。插件诊断不再输出完整绑定码/兑换凭证，飞书 GET 不再把凭证放进 URL，官方插件不再接受无有效到期时间或已到期的 Pro 缓存。
- 已知风险：插件源码修复尚未发布，现有用户要等下一版插件才会获得凭证脱敏和更严格的本地到期检查；`local_component_manifests` 尚未配置私有对象，旧安装器和依赖仍是公网 CDN，因此本次没有宣称已阻止组件文件被复制；工作区原有大量未提交改动，本次云函数部署使用线上回读目录，避免夹带这些本地改动。
- 下一步：从干净发布基线制作并发布新的 Obsidian 插件；把安装器、Python runtime、wheelhouse 和模型迁入私有对象，写入版本/SHA-256 manifest，再让插件切换到 manifest 下载并退役旧公网路径；上线付费接口调用审计后再按真实基线决定是否加网关限流。

### 2026-07-10 23:00 - 提前接入 118 元两年卡支付契约

- 目标：在不提前切换月卡/年卡价格的前提下，把两年卡接入支付、权益、诊断和经营报表，允许小程序先上传并提交审核。
- 影响范围：quickstartFunctions / syncApi / 小程序 / 测试 / 文档。
- 修改文件：`cloudfunctions/quickstartFunctions/payment-core.js`、`cloudfunctions/syncApi/payment-core.js`、`cloudfunctions/quickstartFunctions/redeem-code-core.js`、`cloudfunctions/syncApi/redeem-code-core.js`、`cloudfunctions/quickstartFunctions/ops-report-core.js`、`cloudfunctions/quickstartFunctions/index.js`、`tests/payment-core.test.js`、`tests/redeem-code-core.test.js`、`tests/support-ops-core.test.js`、`tests/admin-backend.test.js`、`docs/WORKLOG.md`。
- 线上动作：无。未部署云函数，未上传或发布小程序，未修改微信后台道具。
- 数据变更：无。
- 验证：先运行 `node tests/payment-core.test.js`、`node tests/redeem-code-core.test.js`、`node tests/support-ops-core.test.js`、`node tests/admin-backend.test.js`，分别确认因缺少两年计划、计划别名、报表分栏和诊断价格而失败；实现后上述测试通过。用户确认微信真实道具 ID 后，再先把断言改为 `Pro_2years` 并确认 `node tests/payment-core.test.js` 因缺少 productId 映射失败；实现映射后运行该测试、`node tests/payment-delivery-wiring.test.js`、`node tests/sync-api-core.test.js`、`node tests/home-ui.test.js`、相关 JS 文件的 `node --check` 和 `git diff --check -- <本次相关文件>`，均通过。
- 结果：两份支付核心均以内部 planId `pro_two_year` 识别两年卡，价格 11800 分、有效期 730 天；订单、签名和回调校验使用微信后台真实 productId `Pro_2years`。正式 Pro 识别、运行诊断和经营日报/周报均支持两年卡。月卡和年卡仍保持 990/4990 分。
- 已知风险：本地接入不等于线上生效；正式发布前必须在微信后台发布大小写完全一致的 `Pro_2years`、价格 118 元的道具，并部署实际被小程序调用的 `quickstartFunctions`。审核通过但未发布的小程序不会影响线上用户。
- 下一步：已把 7 月 11 日 00:01 的续跑任务缩小为只把月卡/年卡改为 1990/6800 分并更新测试；完成后用户可协调三个道具生效、云函数部署和小程序正式发布。

### 2026-07-10 22:50 - 准备 Pro 标准价与两年卡 UI，云函数价格延后切换

- 目标：把 Pro 页面准备为月卡 19.9 元、年卡 68 元、两年卡 118 元，并按要求保持线上及本地支付核心价格到 7 月 11 日 00:00 后再切换。
- 影响范围：小程序 / quickstartFunctions 公告配置 / 测试 / 文档。
- 修改文件：`miniprogram/pages/index/index.js`、`miniprogram/pages/pro/index.js`、`miniprogram/pages/pro/index.wxml`、`miniprogram/pages/pro/index.wxss`、`cloudfunctions/quickstartFunctions/public-config-core.js`、`tests/home-ui.test.js`、`tests/public-config-core.test.js`、`tests/payment-core.test.js`、`docs/WORKLOG.md`。
- 线上动作：无。未部署云函数，未上传或发布小程序，未修改微信后台道具。
- 数据变更：无。
- 验证：`node tests/home-ui.test.js`、`node tests/public-config-core.test.js`、`node tests/payment-core.test.js`、`node --check miniprogram/pages/index/index.js`、`node --check miniprogram/pages/pro/index.js`、`git diff --check -- <本次相关文件>` 通过；确认两份 `payment-core.js` 仍为月卡 990 分、年卡 4990 分。
- 结果：UI 与公告已移除早鸟文案，展示 19.9 元/月、68 元/年、118 元/两年；UI 使用内部 planId `pro_two_year`，后续已映射到微信真实 productId `Pro_2years`。已创建 7 月 11 日 00:01 的当前任务续跑，仅修改本地支付代码和测试。
- 已知风险：小程序可以提前上传并提交审核，但三个微信道具与云函数价格必须协调生效后才能正式发布。
- 下一步：00:01 后只把两份支付核心的月卡/年卡改为 1990/6800 分并更新测试；仍不做线上部署，等待用户发布道具并提交小程序。

### 2026-07-10 21:35 - 发布 1.3.11 并完成 Python runtime / rapidocr 离线依赖 CDN

- 目标：把 `uv / Python / rapidocr` 下载失败从“只能重试网络”改成“优先走自有 CDN 镜像和离线 wheelhouse”，并发布包含同样 fallback 逻辑的 Obsidian 插件版本。
- 影响范围：Obsidian 插件 / 本地 ASR macOS 安装器 / 本地 OCR macOS 与 Windows 安装器 / CloudBase 静态托管 CDN / 测试 / 文档。
- 修改文件：`manifest.json`、`versions.json`、`obsidian-plugin/wechat-inbox-sync/manifest.json`、`obsidian-plugin/wechat-inbox-sync/versions.json`、`obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh`、`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr-macos.sh`、`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr.ps1`、`tests/plugin-marketplace-package.test.js`、`docs/WORKLOG.md`、`docs/DECISIONS.md`。
- 线上动作：已上传 python-build-standalone `20260623` 的 CPython `3.12.13` 三个平台包到 `local-python/python-build-standalone/releases/download/20260623/`；已上传 OCR wheelhouse 到 `local-ocr/wheels/win_amd64`、`local-ocr/wheels/macosx_11_0_arm64`、`local-ocr/wheels/macosx_11_0_x86_64`；已更新 CDN 上的 `local-asr/common/install-local-asr-macos.sh`、`local-ocr/common/install-local-ocr-macos.sh`、`local-ocr/common/install-local-ocr.ps1`；已推送 `main` 到提交 `e169a5d`，创建并推送 tag `1.3.11`，GitHub Release 已生成。
- 数据变更：无。
- 验证：先新增安装器断言测试并确认 `node tests/plugin-marketplace-package.test.js` 因缺少 `$PythonBuildStandaloneBuild = "20260623"` 失败；实现后运行 `node tests/plugin-marketplace-package.test.js`、`node tests/plugin-main-ai.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、Git Bash `bash -n` 检查两个 macOS 安装脚本、PowerShell scriptblock 解析 `install-local-ocr.ps1`、版本元数据检查、`git diff --check` 均通过；本地 `win_amd64` wheelhouse 使用 `--no-index --find-links` 安装并导入 `rapidocr_onnxruntime` 成功；三平台 wheelhouse 使用公网 CDN `--no-index --find-links` 解析通过；Python runtime、三个安装脚本和三个 wheelhouse index 的公网 SHA256 校验通过；`check_obsidian_release.ps1 -Repo "mingjuner123-spec/wechat-inbox-sync" -ExpectedVersion "1.3.11" -LocalZip "...wechat-inbox-sync-1.3.11.zip" -RepoPath "...local-ocr-offline-deps" -DefaultBranch main` 通过。
- 结果：安装器会让 uv 通过 `UV_PYTHON_INSTALL_MIRROR` 优先下载自有 CDN 上的 Python runtime，并固定 `UV_PYTHON_CPYTHON_BUILD=20260623`；OCR 依赖优先从 CDN wheelhouse 离线安装 `rapidocr-onnxruntime==1.4.4` 和 `pillow==12.3.0`，失败后才回退腾讯 PyPI / 官方 PyPI。Obsidian 插件 `1.3.11` 发布链路已通过，Release URL：`https://github.com/mingjuner123-spec/wechat-inbox-sync/releases/tag/1.3.11`。
- 关键哈希：Python arm64 macOS `3724AA4DAFB5F7B6C2CF98E89914E4248DC6BD2FE40407DF4A2D73DE99615F16`；Python x64 macOS `7C57FDD1FA675190093700EB0D8E7117E1F9EAE7C30A46DEA5F8D5266BCFC791`；Python x64 Windows `C6AF85BB83D5158C9FF71F50DFAD467853D1CD236F932B144E87E26E2EA2A83E`；ASR macOS 安装器 `4EF6971DE0F7D3A74C08DD84E7DBF611421CEDE03D2CE7D658B21B52AE0CCA4F`；OCR macOS 安装器 `65A6CA085789CC8E3B07C30D97078F81D1B8659EB1F64669863F1E6F7DBF50D0`；OCR Windows 安装器 `4C99443953B39D883BB65ED73ABCDE3BDCDF76239A56F3E6962B13F7CD07426D`。
- 已知风险：macOS Intel wheelhouse 目标为 `macosx_11_0_x86_64`，与当前报障用户 Darwin 21/macOS 12 匹配；极老 Intel macOS 可能仍需走包索引回退。Windows ASR 仍主要依赖既有 ASR 二进制与模型 CDN/镜像链路，本次重点解决 uv/Python/OCR 依赖。
- 下一步：让报错用户升级插件到 `1.3.11` 后重新点击“安装/修复本地转写组件”；若仍失败，收集新的 OCR/ASR 安装日志，重点看是否命中 CDN wheelhouse、Python mirror 和导入验证阶段。

### 2026-07-10 21:08 - 发布 Obsidian 插件 1.3.10 并更新 macOS 本地组件 CDN

- 目标：发布本地转写安装修复版本，解决 macOS ASR/OCR 安装器 CRLF 崩溃、OCR-only 被 ASR 失败阻断、`Record not found` 误报同步失败和诊断日志误判问题，并同步更新 CDN 上的 macOS 安装脚本。
- 影响范围：Obsidian 插件 / 本地组件 CDN / 测试 / 文档。
- 修改文件：`manifest.json`、`versions.json`、`obsidian-plugin/wechat-inbox-sync/manifest.json`、`obsidian-plugin/wechat-inbox-sync/versions.json`、`obsidian-plugin/wechat-inbox-sync/main.js`、`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr-macos.sh`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`、`docs/WORKLOG.md`。
- 线上动作：已从独立 release worktree 推送 `main` 到提交 `93b051d`，创建并推送 tag `1.3.10`；GitHub Release 已生成并包含 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 `wechat-inbox-sync-1.3.10.zip`；已上传 `local-asr/common/install-local-asr-macos.sh` 与 `local-ocr/common/install-local-ocr-macos.sh` 到 CloudBase 静态托管。
- 数据变更：无。
- 验证：`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`git diff --check`、插件版本一致性检查、本地 zip 内 `manifest.json` 版本检查、CloudBase 对象下载哈希检查、公网 CDN 下载哈希检查、`check_obsidian_release.ps1 -Repo "mingjuner123-spec/wechat-inbox-sync" -ExpectedVersion "1.3.10" -LocalZip "...wechat-inbox-sync-1.3.10.zip" -RepoPath "...ob内容同步助手-release-1.3.10" -DefaultBranch main` 均通过。
- 结果：Obsidian 插件发布链路已闭环，默认分支 `manifest.json` 为 `1.3.10`，`versions.json` 包含 `1.3.10`，GitHub Release tag 与资产完整；macOS CDN 安装器已确认是 LF 版本。ASR CDN SHA256：`1051C710BC93A4E9B280C72A39EADEFA8B96FC2B4091047FB8FD4D3C9FA2975B`；OCR CDN SHA256：`3AF69A1C08A0036B46704A141047E0424152F2D177E2516BFD827D2DE3250645`。
- 已知风险：`tests/plugin-upload-sync.test.js` 在 1.3.9 发布基线中不存在，因此未运行；Python 运行时、uv 与 `rapidocr-onnxruntime` wheel 仍依赖上游下载，本次 1.3.10 尚未完成离线 wheel/镜像化。
- 下一步：把 Python runtime、uv 下载源与 `rapidocr`/`onnxruntime`/`numpy` 等 OCR wheel 做腾讯云 CDN 镜像或离线 wheelhouse，安装器优先走自有 CDN，失败时再回退上游。

### 2026-07-10 20:54 - 修复 OCR-only 场景被 ASR 安装失败阻断

- 目标：解释并修复“Python OCR 运行环境未找到”反复出现的问题，避免小红书图片 OCR 首次使用时被 ASR 缺失或 ASR 安装失败挡住。
- 影响范围：插件 / 本地组件 / 测试 / 文档。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`tests/plugin-main-ai.test.js`、`docs/WORKLOG.md`。
- 线上动作：无。尚未发布 Obsidian 插件。
- 数据变更：无。
- 验证：先运行 `node tests/plugin-main-ai.test.js`，新增 OCR-only 测试因错误调用 ASR 安装失败；修复后运行 `node tests/plugin-main-ai.test.js`、`node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-marketplace-package.test.js`、`git diff --check -- obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js` 通过。
- 结果：`ensureLocalComponentReadyForUse` 会把 `requireAsr/requireOcr` 传给安装调度；小红书图片 OCR 只会安装 OCR，不再先安装 ASR。安装全部组件时 ASR 与 OCR 会分别尝试，ASR 失败不再阻止 OCR 创建 Python venv，最后统一汇总失败项。
- 已知风险：如果用户的网络无法下载 uv、Python 或 `rapidocr-onnxruntime`，OCR Python 仍会安装失败，但现在诊断会指向 OCR 自己的安装日志，而不是被 ASR 失败连带遮住。
- 下一步：发布新插件后，让出现该问题的用户重新点击“安装/修复本地转写组件”，并回传新的 OCR 安装日志确认是否是网络/依赖下载问题。

### 2026-07-10 20:47 - 修复 macOS 本地转写安装器换行与同步标记幂等

- 目标：根据 3 份插件诊断拆分 ASR 安装失败、OCR 半安装、同步标记失败和绑定失效问题；修复可由插件侧解决的 macOS 安装器 CRLF 崩溃与 `Record not found` 误报同步失败。
- 影响范围：插件 / 本地组件 / 测试 / 文档。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`tests/plugin-main-ai.test.js`、`docs/WORKLOG.md`。
- 线上动作：无。尚未发布 Obsidian 插件，尚未重新上传 CDN 安装器。
- 数据变更：无。
- 验证：先运行 `node tests/plugin-main-ai.test.js` 观察到新增测试因 `normalizeInstallerScriptText` 缺失失败；修复后运行 `node --check obsidian-plugin/wechat-inbox-sync/main.js`、`node tests/plugin-main-ai.test.js`、`node tests/plugin-marketplace-package.test.js`、`git diff --check -- obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js` 通过。
- 结果：macOS ASR/OCR 下载或回退的 `.sh` 安装器在执行前会移除 BOM 并把 CRLF/CR 归一为 LF，避免 `/bin/bash` 在 `set -euo pipefail\r` 崩溃；插件在本地内容已写入后，标记云端已同步返回 `Record not found` 时按幂等成功处理，不再把整次同步标成失败。
- 已知风险：绑定码“未绑定或已失效”仍必须通过重新点击插件「立即绑定」或后台核验解决，不能用本地权限缓存绕过云端绑定校验；用户要拿到安装器换行和诊断过滤修复，需要发布新插件，并建议重新上传/校验 CDN 安装器对象。
- 下一步：发布插件版本并上传/校验 macOS ASR/OCR 安装器 CDN 文件；对报绑定失效的绑定码做脱敏后台核验。

### 2026-07-10 11:15 - 修复 macOS OCR 半安装状态与首页绑定误提示

- 目标：修复 OCR 脚本缺失的半安装状态，缩短失败诊断，并避免小程序首页在绑定状态返回前误显示未绑定。
- 影响范围：Obsidian 插件 / macOS OCR 安装器 / 小程序首页 / 文档 / 测试。
- 修改文件：`obsidian-plugin/wechat-inbox-sync/main.js`、`obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr-macos.sh`、`miniprogram/pages/index/index.js`、`miniprogram/pages/index/index.wxml`、`tests/plugin-main-ai.test.js`、`tests/plugin-marketplace-package.test.js`、`tests/home-ui.test.js`、`docs/RUNBOOK.md`、`docs/WORKLOG.md`。
- 线上动作：macOS OCR 安装器已上传腾讯云静态托管并完成对象与公网 CDN 哈希校验；插件市场未发布；小程序未上传。
- 数据变更：无。
- 验证：OCR CDN 文件和本地 SHA256 一致；macOS shell 语法检查通过；插件诊断、插件发布包、小程序首页测试和 JS 语法检查通过。
- 结果：OCR 脚本改为先安装并原子替换，Python 安装中断不会再造成“Python 已有但脚本缺失”；成功 ASR 日志不再被空 `--- error ---` 标题误判；首页绑定提醒等待云端状态返回后再显示。
- 已知风险：用户要看到新的诊断逻辑需要发布新插件；小程序首页修复需要上传并发布小程序代码。
- 下一步：本地验证后发布插件和小程序；小绿书链接转存另行获取样本评估，不在本次实现。

### 2026-07-10 13:30 - 支付失败查单与 iOS 错误可诊断化

- 目标：支付接口回调失败时不误判为未支付；不因用户已有 Pro 状态限制续费。
- 影响范围：小程序 Pro 页 / 首页页面回归测试。
- 修改文件：`miniprogram/pages/pro/index.js`、`tests/home-ui.test.js`、`docs/WORKLOG.md`。
- 行为：`requestVirtualPayment` 失败后立即按订单号查单；若微信侧已支付则刷新权益并显示成功，未支付时展示原始错误信息、错误码和订单号。购买入口不读取或拦截既有 Pro 状态。
- 验证：`node tests/home-ui.test.js`、`node tests/payment-core.test.js`、`node tests/inbox-service.test.js`、`node --check miniprogram/pages/pro/index.js`、`git diff --check` 通过。
- 部署：尚未上传小程序代码。此改动属于 `miniprogram/`，只有上传/发布小程序后手机端才会生效，不涉及 Obsidian 插件发布。
- 已知风险：当前 CLI 只能管理长环境；手机端实际支付调用的短环境不在当前 CLI 账号列表中。禁止为了处理 iOS 支付错误而对长环境盲目回滚或改写短/长环境配置。

### 2026-07-10 15:00 - 支付回调与主动查单并发重复发货诊断

- 证据：支付通知中，同一 `orderNo` 会在同一秒出现“用户主动查单”和“微信支付回调”。短业务环境实际运行的 `quickstartFunctions` 未包含此前本地/长环境的支付幂等代码。
- 根因：两个入口同时读取到订单 `pending`，各自发放一次权益；原有“先读权益、再判断订单号”的逻辑不是原子操作，不能阻止并发竞争。
- 本地修复：新增 `payment-delivery-lock.js`，用订单状态的条件更新把 `pending` 原子领取为 `fulfilling`；仅领取成功的入口可发放权益、标记 `paid`、发送到账通知。失败会释放回 `pending`，以便后续重试。已覆盖 `quickstartFunctions` 查单/支付回调/后台手动确认，以及 `syncApi` 支付回调/后台手动确认。
- 验证：新增 `tests/payment-delivery-lock.test.js`（并发只有一个领取成功）和 `tests/payment-delivery-wiring.test.js`；支付核心、后台、同步 API 测试及语法检查均通过。
- 历史数据修复：
  - `OBTRYXQ43Q` 仅有 1 笔年卡订单，权益已从 `2028-07-16` 修正为 `2027-07-17`。
  - `OBTRYFYTR6` 仅有 1 笔年卡订单，权益已从 `2028-07-09` 修正为 `2027-07-10`。
- 部署状态：已由开发者在微信开发者工具中手动上传到短业务环境 `he02-d8gebzv050ed6c4ef`。随后通过 CLI 分别下载 `quickstartFunctions` 与 `syncApi` 回读验证：两个函数均包含原子领取锁、订单号二次幂等保护和 `payment-delivery-lock.js`，线上热修已生效。未改动长环境。

### 2026-07-10 10:59 - 建立双环境长期记忆与工程护栏

- 目标：解释短/长域名的真实关系，制定不要求用户重新绑定的迁移方案，并减少新对话重复诊断。
- 影响范围：文档 / 测试 / CI。
- 修改文件：`AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DECISIONS.md`、`docs/RUNBOOK.md`、`docs/RELEASE_CHECKLIST.md`、`docs/TASK_CLOSEOUT_TEMPLATE.md`、`docs/WORKLOG.md`、`tests/infrastructure-contract.test.js`、`scripts/run-regression-guards.ps1`、`.github/workflows/regression-guards.yml`。
- 线上动作：无。本任务未修改或部署小程序、插件和云函数运行逻辑。
- 数据变更：无。
- 验证：运行基础设施契约测试、关键同步测试和文档引用检查。
- 结果：双环境不变量已文档化，并增加 CI 防回退检查。
- 已知风险：短/长入口仍是两份运行代码，迁移完成前仍需防止版本漂移。
- 下一步：建立自有 API 前门；先让长入口完全兼容，再让插件静默探测并逐步迁移。

### 2026-07-10 - 支付幂等、退款状态与历史权益纠偏

- 目标：阻止同一支付订单重复增加有效期，并修复历史重复加年数据。
- 影响范围：`quickstartFunctions` / `syncApi` / 管理后台 / 测试 / 线上数据。
- 线上动作：已部署相关云函数；已对 3 条历史权益做定向纠偏。
- 数据变更：仅修改目标权益与兑换码到期时间，不记录用户隐私明细。
- 验证：`payment-core`、后台接口测试、语法检查及线上订单/权益回查通过。
- 结果：每条历史记录均确认只有 1 笔真实支付，剩余有效期恢复到约 1 年。
- 已知风险：微信资金原路退款尚未接入；短域名支付通知是否命中新版本仍需单独核验。
- 下一步：确认支付通知使用包含最新幂等逻辑的稳定入口。
