# 插件架构重构 Loop（1.3.74 本地基线）任务卡

- 任务 ID：`plugin-architecture-loop-1-3-74-001`
- 标题：在 1.3.74 稳定功能上建立可持续模块化源码与本地验收闭环
- 创建日期：2026-07-31
- 类型：插件架构 / 本地重构
- 状态：进行中
- 风险等级：L2
- 所属阶段：主线插件代码整理
- 所属支线：`plugin-architecture-loop-1.3.74`
- 父主线：`H2-002`
- 分支：`codex/plugin-architecture-loop-1.3.74`
- Worktree：`.worktrees/plugin-architecture-loop-1.3.74`
- 基线提交：`f08429edb54e900b34ea4d5c0f9e241e6f6bac5a`
- 正式功能锚点：`1.3.74 / 4405dcef28f4dea0d5a650f57e874c81175a3872`
- 环境占用：无
- 发布链路占用：无

## 负责人授权

负责人已要求完成发布管线地基后直接进入本地插件架构优化，允许使用 Harness、Loop 和子 Agent 审查；在负责人完成核心功能测试前，禁止发布、推送、部署、升级版本或影响正在使用的用户。

## 目标

1. 保持 1.3.74 的全部现有业务行为，尤其是小红书、ASR/OCR、同步队列、暂停删除、双环境 API、绑定、Pro 和飞书 OAuth。
2. 建立 `src/* -> main.js` 的确定性单文件构建，继续满足 Obsidian 市场只加载单一 `main.js` 的约束。
3. 一次只抽离一个低耦合职责，每步有独立测试、完整回归、审查和可回退提交。
4. 形成长期代码地图、模块边界、回归门禁和本地候选交接说明。
5. 最终只生成本地测试候选，等待负责人验收；发布另开 L3 任务。

## 非目标

- 不修改任何产品功能、UI、提示语、文件格式、同步策略或权限规则。
- 不发布新版本，不创建 tag、Release、PR，不推送远端。
- 不部署 CloudBase，不读取或写入线上环境、真实用户数据和凭据。
- 不删除历史 Worktree、旧分支、旧候选或根工作区现有改动。
- 不把旧 1.3.71 模块化分支整体合并或直接 cherry-pick。

## 允许修改路径

- `docs/PLUGIN_CODE_MAP_1.3.74.md`
- `docs/WORKLOG.md`
- `docs/superpowers/specs/2026-07-31-plugin-architecture-loop-1-3-74-design.md`
- `docs/superpowers/plans/2026-07-31-plugin-architecture-loop-1-3-74.md`
- `docs/task-cards/plugin-architecture-loop-1-3-74-001.md`
- `.gitattributes`
- `.gitignore`
- `obsidian-plugin/wechat-inbox-sync/build-plugin.js`
- `obsidian-plugin/wechat-inbox-sync/package.json`
- `obsidian-plugin/wechat-inbox-sync/package-lock.json`
- `obsidian-plugin/wechat-inbox-sync/src/**`
- `obsidian-plugin/wechat-inbox-sync/main.js`
- `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`
- `main.js`（仅允许由 `sync-plugin-release-mirror.js` 从权威插件生成）
- `.github/workflows/main-guards.yml`
- `.github/workflows/release.yml`
- `scripts/prepare-plugin-release-candidate.js`
- `scripts/plugin-release-candidate-core.js`
- `tests/plugin-build-foundation.test.js`
- `tests/plugin-*-utils.test.js`
- `tests/plugin-main-ai.test.js`
- `tests/plugin-marketplace-package.test.js`
- `tests/plugin-release-candidate.test.js`
- `tests/plugin-release-identity.test.js`
- `tests/release-governance.test.js`

以上路径只允许为模块化、构建和相应测试做最小修改。业务版本、运行标记、manifest、versions、ASR/OCR 资源不得改变。根 `main.js` 只能随权威生成物单向同步，禁止手改。

## 冻结区

本轮禁止重构或改变下列区域：

- 小红书短链、正文、图片、OCR、评论、浏览器会话和失败清理全链路。
- ASR/OCR 安装、修复、下载、执行、诊断及内嵌 OCR runner。
- 暂停当前转写、云端删除、同步 single-flight、失败/重试/跳过编排。
- 双环境 API、绑定、Pro 权益、飞书 OAuth 编排。
- 设置 UI。
- 版本、发布身份、候选包和 Release 契约；根镜像只允许由权威生成物机械同步。
- 未被当前入口引用且已经漂移的 `plugin-core.js`、`sync-core.js`、`cloud-client.js`。

## Loop 状态机

每个模块必须依次经过：

1. `SNAPSHOT`：记录当前提交、版本、bundle 哈希和基线测试结果。
2. `RED`：先加入能够证明现有行为的模块测试或黄金样本。
3. `MOVE`：只迁移当前一个职责，从 1.3.74 当前实现重新提取。
4. `BUILD`：生成单文件 `main.js`，检查源码与生成物无漂移。
5. `REGRESSION`：运行专项测试、插件核心、市场包、发布身份与发布治理。
6. `REVIEW`：由未参与实现的子 Agent 检查规格、行为差异和测试充分性。
7. `CHECKPOINT`：只有 P0/P1/P2 均为 0 才创建本地提交并进入下一模块。

## 失败停止条件

出现任一情况时立即停止当前模块，不继续叠加修改：

- 业务输出、提示、文件名、frontmatter、同步计数或错误分类发生非预期差异。
- 小红书、ASR/OCR、同步编排、双环境或版本身份出现差异。
- 构建不能稳定复现，或 `src` 与 `main.js` 漂移。
- 完整核心回归、候选管线或发布治理失败。
- 当前修改无法在单一职责内解释。

处理方式：回到上一个通过的本地检查点，缩小模块边界并重新进入 `RED`；禁止在多个未通过模块上连续修补。

## 第一阶段范围

1. 确定性构建地基。
2. 日期工具。
3. 转写质量纯函数。
4. 进度提示纯函数。
5. AI 元数据错误分类。
6. 诊断脱敏。
7. Vault 路径归一化。
8. 输入规范化。
9. 记录元数据纯函数。
10. 记录状态与记录身份最后处理。

历史 1.3.71 分支只提供模块边界和测试样本；所有实现都必须从当前 1.3.74 重新提取。

## 本地交付验收

- 插件版本仍为 1.3.74，运行标记、manifest、versions 不变。
- `src` 成为唯一人工源码，`main.js` 是确定性单文件生成物。
- 连续两次构建哈希一致，构建漂移门禁能够失败关闭。
- 所有新增模块有独立测试和旧/新行为对比。
- 插件核心、市场包、候选、身份、治理测试全部通过。
- 独立终审 P0/P1/P2 均为 0。
- 生成不可变本地候选和明确回退点，不自动替换正式用户插件。
- 负责人完成核心功能人工测试前，不进入任何发布动作。

## 基线快照（2026-07-31）

- 权威插件 `main.js` SHA-256：`AB3C12E754E40C55C5BF3C5E30B5C32E55F07600EB9FB6CD8BAD08A90437D91A`
- `manifest.json` SHA-256：`B89868409A9A705D74C52F17FDB479B25A33A5A9E82BBE45256B4CD39B089820`
- `versions.json` SHA-256：`B7C220CEB86CEE913D1F1297FD8DB54DA9D093E1F7D3C6D7D650A994AC1DDDC1`
- 根目录市场镜像与权威插件对应文件哈希一致。
- `plugin-main-ai`：通过。
- `plugin-marketplace-package`：通过。
- `plugin-release-candidate`：24 通过、0 失败、1 个 Windows 普通 symlink 用例因 `EPERM` 跳过；等价 junction 防护通过。
- `plugin-release-identity`：26/26 通过。
- `release-governance`：126/126 通过。
- `git diff --check`：通过。

该快照是所有模块迁移的比较基准。后续任何红灯都必须归因到当前小步或明确记录为环境差异。

## 当前进度

- 阶段 0（冻结与基线）：完成。
- 阶段 1（确定性构建地基）：实现与独立复审完成，P0=0、P1=0、P2=0。
- 构建地基本地检查点：`55696663`。
- `date-utils`：实现、完整回归与独立复审完成，P0=0、P1=0、P2=0。
- 日期工具本地检查点：`eec246a0`。
- `transcription-quality-utils`：实现、完整回归与独立复审完成，P0=0、P1=0、P2=0。
- 转写质量本地检查点：`ae498359`。
- `progress-notice-utils`：实现、完整回归与独立复审完成，P0=0、P1=0、P2=0。
- 进度提示本地检查点：`ff87abd6`。
- `ai-metadata-error-utils`：实现、完整回归与独立复审完成，P0=0、P1=0、P2=0。
- AI 元数据错误本地检查点：`8bd49b70`。
- `diagnostic-redaction-utils`：实现、完整回归与独立复审完成，P0=0、P1=0、P2=0。
- 诊断脱敏本地检查点：`ab08d09e`。
- `vault-path-utils`：实现、完整回归与独立复审完成，P0=0、P1=0、P2=0。
- Vault 路径本地检查点：`af0b058e`。
- `input-normalization-utils`：实现、完整回归与独立复审完成，P0=0、P1=0、P2=0。
- 输入规范化本地检查点：`c95b982b`。
- `record-metadata-utils`：实现、完整回归与独立复审完成，P0=0、P1=0、P2=0。
- 记录元数据本地检查点：`e5f1debb`。
- `record-state-utils`：实现、状态矩阵回归与独立复审完成，P0=0、P1=0、P2=0；同步编排未移动。
- 插件仍为 1.3.74；业务源码只移动低耦合纯函数，根 `main.js` 仅跟随权威生成物。
- 下一步：创建记录状态模块检查点，然后进入 `record-identity-utils` 高风险单模块 Loop。

## 第一阶段模块完成状态

- `record-identity-utils` 已完成 RED、原样迁移、单文件构建、完整回归和独立审查。
- 第一阶段 10 个纯函数/低耦合模块已全部完成；插件版本仍为 1.3.74。
- 独立模块审查结论：P0=0、P1=0、P2=0。
- 当前进入整条分支终审与本地候选包制作；仍禁止推送、发布、部署或替换正式用户插件。

## 整体终审与本地候选

- 整体架构终审、测试/发布隔离终审均已完成，最终 P0=0、P1=0、P2=0。
- 终审发现“新增模块测试未进入自动门禁”，已先用失败测试复现，再将 10 个模块测试完整接入 Linux 主分支门禁与 Release 门禁。
- 连续两次构建 SHA-256 一致：`08E4B7AEB9C6CFCCC34D12231A2D7EA4F52A801E8F382AEF725445FFC9796728`。
- 根目录与权威插件 `main.js` 哈希一致；manifest/versions 相对 1.3.74 基线零差异。
- 本地候选 ID：`1.3.74-a1e0dc0502c7029b`。
- 本地候选聚合 SHA-256：`a1e0dc0502c7029b6b6e7991ad1834d8683aefa7f05e1617f327a425aa2629a5`。
- 本地候选目录：`.artifacts/plugin-architecture-1.3.74/1.3.74-a1e0dc0502c7029b/package`。
- 候选已对权威源码与根镜像完成回读验证；未更新 `release-candidate.json`，未替换任何已安装插件。

## 负责人本地验收清单

1. 普通文本、网页链接、公众号链接和飞书文档各同步一次。
2. 小红书图文验证标题、正文、标签、封面与内页图片完整，图片不重复；Pro 再验证 OCR 与登录后的评论。
3. 音频/视频验证 Windows 或 macOS 现有 ASR 组件不被要求重复安装，转写正常。
4. OCR 只对文字型图片启用，结果合并为连续段落，不重复写入。
5. 连续点击同步验证 single-flight 提示；暂停当前转写后验证云端记录删除和后续不再出现。
6. 失效小红书短链验证限时失败、生成明确回执、从云端删除并继续后续队列。
7. 验证绑定、Pro 权益、设置保存与重启恢复。
8. 验证笔记路径、文件名、frontmatter、附件目录和已有笔记去重。

负责人完成上述核心功能人工测试前，本任务保持“等待本地验收”，不得晋升正式候选或发布。

## 测试前准备状态（2026-07-31）

- 发布候选管线 V2 已通过 PR #41 进入远端默认分支；PR #42 已回填授权、门禁、回读与回退证据。两次 PR 均通过 `guards` 与 `windows-deployer`，未创建新标签、Release 或插件市场版本。
- 本地架构候选仍为 `1.3.74-a1e0dc0502c7029b`，聚合 SHA-256 仍为 `a1e0dc0502c7029b6b6e7991ad1834d8683aefa7f05e1617f327a425aa2629a5`。
- 负责人知识库目标目录已确认存在；已安装插件版本仍为正式 `1.3.74`。候选与已安装插件的 `manifest.json`、`styles.css` 一致，`main.js` 不同，证明架构候选尚未被误装。
- 目标目录中的 `data.json` 已确认存在；只记录存在性和文件大小，不读取或输出内容。事务安装器会把它排除在受控发布文件之外并原样保留。
- 已从当前已安装插件运行文件生成测试回退候选 `1.3.74-564e852ef9eb5c0b`，聚合 SHA-256 为 `564e852ef9eb5c0bd2d1c68f2b0dd1034fc789f56d8f32a404bf69bae3a60ffe`；其 `main.js` 与当前安装运行文件一致，不包含 `data.json`。文本文件由候选管线规范化为 LF，不改变运行语义。
- 当前检测到 Obsidian 仍在运行，因此事务安装器按设计拒绝替换。负责人关闭 Obsidian 后，才允许执行候选校验、备份、事务替换和安装后复验；不得强杀进程或绕过进程门禁。
