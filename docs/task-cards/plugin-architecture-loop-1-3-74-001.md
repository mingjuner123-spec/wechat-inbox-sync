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
- 插件仍为 1.3.74；业务源码只移动低耦合纯函数，根 `main.js` 仅跟随权威生成物。
- 下一步：创建输入规范化模块检查点，然后进入 `record-metadata-utils` 单模块 Loop。
