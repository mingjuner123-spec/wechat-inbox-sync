# 插件架构重构 Loop 实施计划

## 当前锚点

- 基线：`f08429ed`
- 插件版本：`1.3.74`
- 业务正式锚点：`4405dcef`
- 模式：本地 L2、隔离 Worktree、无发布/部署/远端写入

## 阶段 0：冻结与基线

1. 记录插件目录受控文件哈希、版本和当前测试结果。
2. 建立任务卡、设计、代码地图和本计划。
3. 确认根工作区脏改动与本 Worktree 隔离。
4. 创建文档检查点提交。

验收：基线没有业务文件改动；任务可由文档和 Git 独立恢复。

## 阶段 1：确定性构建地基

1. 先加入构建地基失败测试：
   - 固定入口与输出；
   - 构建可重复；
   - `--check` 检测漂移；
   - 不改变 manifest/version；
   - 不破坏 V2 候选和根镜像契约。
2. 将当前 `main.js` 复制为 `src/main.js`。
3. 从历史 donor 重新适配 `build-plugin.js`、固定版本 `package.json` 和 lockfile。
4. 根据当前 1.3.74 调整构建包装，生成单文件 `main.js`。
5. 连续构建两次，比较哈希。
6. 运行完整回归与候选管线测试。
7. 子 Agent 独立审查；全零后提交。

验收：功能和发布身份不变，只有开发源码边界改变。

## 阶段 2：纯函数模块 Loop

每个模块单独执行 RED → MOVE → BUILD → REGRESSION → REVIEW → CHECKPOINT。

顺序：

1. `date-utils`
2. `transcription-quality-utils`
3. `progress-notice-utils`
4. `ai-metadata-error-utils`
5. `diagnostic-redaction-utils`
6. `vault-path-utils`
7. `input-normalization-utils`

每轮要求：

- 从当前 `src/main.js` 重新提取，不覆盖当前测试。
- donor 模块与测试只提供边界和样本。
- 对所有导出函数加入固定输入输出测试。
- 在迁移前后对一组代表样本做差分。
- 完整回归通过后才提交。

## 阶段 3：记录契约模块 Loop

顺序：

1. `record-metadata-utils`
2. `record-state-utils`
3. `record-identity-utils`

额外门禁：

- 记录 ID、URL 归一化和 frontmatter 识别差分。
- 成功、失败、跳过、删除、重试状态矩阵。
- 重复笔记与重复同步回归。
- 当前 1.3.74 小红书失效记录清理回归。

## 阶段 4：整分支验证

运行：

- 所有模块专项测试。
- `node --check` 生成 `main.js`。
- `tests/plugin-main-ai.test.js`
- `tests/plugin-marketplace-package.test.js`
- `tests/plugin-release-candidate.test.js`
- `tests/plugin-release-identity.test.js`
- `tests/release-governance.test.js`
- 构建漂移、版本身份和根镜像检查。
- `git diff --check`

然后由独立子 Agent 完成：

1. 规格审查。
2. 行为回退审查。
3. 测试充分性与发布边界审查。

P0/P1/P2 不为 0 时，不进入本地候选。

## 阶段 5：本地候选与用户测试

1. 从最终检查点生成不可变本地候选和回执。
2. 验证候选完整文件集、哈希、版本和来源提交。
3. 默认不替换任何正在使用的插件目录。
4. 准备人工测试清单：
   - 普通文本、网页、公众号、飞书；
   - 小红书图文、图片去重、OCR、评论权限；
   - 音视频、ASR、OCR 已安装组件兼容；
   - 同步 single-flight、暂停删除、失效记录清理；
   - 绑定、Pro、设置保存；
   - Windows/macOS 可验证项。
5. 负责人明确指定测试目标后，使用事务安装器替换本地测试插件并保留 `data.json`。
6. 等待负责人测试结论。

## 阶段 6：发布（不属于本任务）

只有负责人明确确认核心功能测试通过，才另建 L3 发布任务。该任务重新采样当前候选，不在本重构任务中直接推送或发布。
