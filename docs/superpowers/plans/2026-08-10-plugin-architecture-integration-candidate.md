# 插件架构拆分统一整合候选实施计划

> **执行要求：** 按 `superpowers:executing-plans` 的顺序逐项完成；任何失败先停在本地定位，不用修业务功能来换取测试通过。

**目标：** 把已经完成的架构拆分累计头冻结为一个可回退的 1.3.79 本地候选，证明各模块能共同构建、共同回归，并交付给负责人做下一轮真实功能测试。

**基线：** `20da436e99547e77dc55cb6fd60f87b62ee6ea67`。它包含公开 1.3.79 的架构底座，以及文档解析、媒体文件、云端转写响应、视频号解密、飞书 Markdown 五个连续追加模块。禁止从共享根工作区或其他历史候选复制业务代码。

**边界：** 只做本地整合验证、测试、构建和候选包；不继续拆模块，不改业务行为，不替换已安装插件，不读取或修改 `data.json`，不推送、不发布、不部署。

---

## 任务 1：锁定累计架构身份

**文件：**
- 新增：`tests/plugin-architecture-integration.test.js`

1. 固定当前入口应加载的 20 个本地模块清单。
2. 断言每个模块文件存在、入口显式引用，且入口没有引用清单外的相对模块。
3. 断言 manifest/versions 均为 1.3.79，正式 bundle 与源码无漂移。
4. 断言连续两次内存构建字节完全一致。
5. 运行：`node tests/plugin-architecture-integration.test.js`。

## 任务 2：运行所有已拆模块定向回归

依次运行模块测试：日期、转写质量、云端转写响应、视频号解密、飞书 Markdown、进度提示、AI 错误、诊断脱敏、Vault 路径、输入规范化、记录元数据/状态/身份、媒体文件、文档解析、AI 元数据、社媒数据和转写标题。

成功标准：每项退出码均为 0；失败时记录具体测试，不修改既有业务规则来规避。

## 任务 3：运行插件核心与真实链路回归

运行：

- `node tests/plugin-main-ai.test.js`
- `node tests/plugin-local-candidate-regressions.test.js`
- `node tests/plugin-social-media-transcript-context.test.js`
- `node tests/plugin-processing-cancellation.test.js`
- `node tests/plugin-xiaohongshu-login-window.test.js`
- `node tests/plugin-xhs-repeat-local-dedupe.test.js`
- `node tests/plugin-audio-repeat-local-dedupe.test.js`
- `node tests/plugin-review-pending-notice.test.js`
- Windows/macOS ASR 安装与路径自愈测试

成功标准：核心同步、社媒、取消、重复同步、审核提示和双系统本地组件回归全部通过。

## 任务 4：构建、身份和候选包验证

1. 在插件目录执行 `npm ci`，使用锁定的 esbuild 版本。
2. 运行构建基础、市场包、发布候选、发布身份测试与 `npm run check`。
3. 对 `src/main.js`、20 个模块和生成的 `main.js` 执行 `node --check`。
4. 连续执行两次正式构建，记录两次 `main.js` SHA-256 并要求相同。
5. 用项目已有候选脚本在 `.artifacts/obsidian-plugin/plugin-architecture-integration-candidate-1.3.79/` 生成本地候选；只允许四项 loose assets 和对应 ZIP，不加入 Git。
6. 校验 ZIP 条目、内外 manifest 版本、四项资产哈希和 Git 状态。

## 任务 5：独立复审与本地交付

1. 由一名未参与实现的子 Agent 审查：累计基线、版本回退、模块接线、测试矩阵、候选包身份和禁止动作。
2. 对 P0/P1/P2 问题逐项修正并重新验证；P0/P1/P2 全部为 0 才可完成。
3. 只提交本任务计划和整合测试，确保插件业务资产与累计基线无非预期差异。
4. 回填任务卡、中央登记和工作日志，交付候选路径、提交 SHA、哈希与人工测试清单。

## 回退

任何组合回归出现无法在本任务边界内解释的失败，立即停止在本地；候选回退到 `20da436e99547e77dc55cb6fd60f87b62ee6ea67`。禁止用旧发布包覆盖累计头，也禁止在本任务中发布一个“暂时能用”的新版本。
