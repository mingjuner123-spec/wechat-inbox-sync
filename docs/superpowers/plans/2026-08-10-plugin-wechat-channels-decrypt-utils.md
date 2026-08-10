# 视频号媒体解密纯工具模块拆分实施计划

> **For Codex:** 按测试驱动顺序逐项实施；只产生本地代码、测试、文档和生成 bundle，不发布、不部署、不替换用户插件。

**目标：** 在不改变视频号抓取、下载或转写行为的前提下，把自包含解密算法迁出 `src/main.js`。

**架构：** 新增无外部依赖的 CommonJS 模块；内部算法符号不导出，主文件仅导入两个现有公共 helper，构建后仍为单文件插件。

**技术栈：** Node.js、CommonJS、Buffer、BigInt、现有 esbuild 和 Node 回归测试。

## 任务 1：锁定独立算法契约

- 新建 `tests/plugin-wechat-channels-decrypt-utils.test.js`。
- 覆盖固定向量、键格式等价、无效键、空 Buffer、默认/自定义长度和双次解密还原。
- 先运行并确认因模块不存在而红灯。

## 任务 2：最小等价迁移

- 新建 `obsidian-plugin/wechat-inbox-sync/src/wechat-channels-decrypt-utils.js`。
- 修改 `obsidian-plugin/wechat-inbox-sync/src/main.js`。
- 将常量、`u64`、`Isaac64`、键解析和两个公共函数逐字迁移；只导出两个公共函数。
- 主文件新增相对导入并删除原定义；调用点与 `__test` 导出名不变。
- 运行独立测试并确认绿灯。

## 任务 3：构建与回归

- 生成 `obsidian-plugin/wechat-inbox-sync/main.js`。
- 运行 `plugin-main-ai`、市场包、模块构建基础和构建漂移测试。
- 运行源码、新模块和生成 bundle 的语法检查。
- 连续构建两次比较 SHA-256，并运行 `git diff --check`。

## 任务 4：独立审查与收尾

- 由未参与实现的 Agent 审查算法等价性、字节边界、依赖方向和测试充分性。
- 修复全部 P0/P1/P2 并重跑受影响验证。
- 形成干净本地提交，回填控制文档；不推送、不发布、不部署。
