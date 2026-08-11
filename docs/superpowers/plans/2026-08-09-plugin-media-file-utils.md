# 插件附件与媒体文件纯工具模块拆分实施计划

1. 在隔离 Worktree 运行 Harness 启动器、目标路径状态和 1.3.79 基线测试。
2. 新增 `tests/plugin-media-file-utils.test.js`，先确认因模块缺失而失败。
3. 新增 `src/media-file-utils.js`，逐字迁移 14 个纯函数并导出。
4. 修改 `src/main.js` 导入新模块，删除原重复定义；保留所有调用点和编排不变。
5. 构建生成单文件 `main.js`，运行定向测试、主回归、市场包、语法、漂移与双构建哈希。
6. 请求独立 Agent 审查边界、等价性、Buffer 输入与测试充分性；关闭问题后形成干净本地提交。
7. 回填任务卡、PRODUCT_TRACKS 和 WORKLOG；不推送、不发布、不部署、不替换本机插件。