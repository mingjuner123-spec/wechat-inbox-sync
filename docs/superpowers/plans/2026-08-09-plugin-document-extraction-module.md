# 插件文档解析模块拆分实施计划

> 执行方式：在隔离 Worktree `.worktrees/plugin-document-extraction-module-1.3.79` 中按 TDD 完成；每个阶段先验证，再进入下一阶段。

## 任务 1：建立基线与依赖

1. 在插件目录运行 `npm ci`。
2. 运行 `npm.cmd run check`。
3. 运行 `node tests/plugin-main-ai.test.js`。
4. 运行 `node tests/plugin-marketplace-package.test.js`。
5. 若基线失败，先记录并停止；不得把基线问题混进本重构。

## 任务 2：先写独立模块红灯测试

新建 `tests/plugin-document-text-extraction.test.js`，覆盖：

- 最小 DOCX 的标题、正文和 XML 实体。
- 缺少 `word/document.xml`。
- UTF-16BE 中文 PDF。
- 低质量 PDF。
- 异常字形 PDF。
- PDF 清洗和跨行合并。
- `src/main.js` 引用新模块且不再保留迁出函数定义。

先运行 `node tests/plugin-document-text-extraction.test.js`，预期因模块不存在而失败。

## 任务 3：最小迁出 DOCX/PDF 实现

1. 新建 `src/document-text-extraction-utils.js`，添加工厂并校验两个依赖。
2. 原样迁入 DOCX 与 PDF 专属函数。
3. 在 `src/main.js` 导入工厂，注入现有 `toNodeBuffer` 和 `cleanMarkdownForStorage`。
4. 删除主文件中的重复定义，不改业务调用点、错误文案和算法阈值。
5. 运行目标测试至转绿。

## 任务 4：构建单文件产物

1. 运行 `npm.cmd run build`。
2. 对源码主入口、新模块和生成 `main.js` 分别运行 `node --check`。
3. 再运行目标测试，确认源码边界与主入口装配。

## 任务 5：扩大回归与漂移检查

1. `node tests/plugin-main-ai.test.js`
2. `node tests/plugin-marketplace-package.test.js`
3. `npm.cmd run check`
4. `git diff --check`
5. 连续构建两次并比较 `main.js` SHA-256。
6. 确认 manifest/versions 仍为 1.3.79。
7. 确认没有修改 `data.json`，没有部署、发布或本地替换。

## 任务 6：独立审查与本地交付

1. 独立 Agent 审查模块边界、行为等价、错误路径、重复定义、测试充分性和 bundle 自包含性。
2. 修复 P0/P1，记录 P2。
3. 重跑目标回归。
4. 仅提交允许路径，形成干净可回退的本地提交。
5. 交付负责人后续统一功能测试；本任务不发布、不部署、不替换用户插件。
