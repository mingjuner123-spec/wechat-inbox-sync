<!-- HARNESS_TASK_CARD_V1 -->

- 任务 ID：plugin-wechat-channels-decrypt-utils-001
- 标题：Obsidian 插件视频号媒体解密纯工具模块拆分
- 创建日期：2026-08-10
- 类型：重构
- 状态：已完成
- 风险等级：L2
- 所属阶段：插件架构重构第八阶段
- 是否当前主线：否
- 所属支线：plugin-wechat-channels-decrypt-utils
- 父主线：H2-002
- 分支：codex/plugin-wechat-channels-decrypt-utils-1.3.79
- Worktree：.worktrees/plugin-wechat-channels-decrypt-utils-1.3.79
- 允许修改路径（allowedPaths）：obsidian-plugin/wechat-inbox-sync/src/main.js；obsidian-plugin/wechat-inbox-sync/src/wechat-channels-decrypt-utils.js；obsidian-plugin/wechat-inbox-sync/main.js；tests/plugin-wechat-channels-decrypt-utils.test.js；tests/plugin-main-ai.test.js；docs/superpowers/specs/2026-08-10-plugin-wechat-channels-decrypt-utils-design.md；docs/superpowers/plans/2026-08-10-plugin-wechat-channels-decrypt-utils.md
- 环境或发布链路占用：无；仅本地源码、生成 bundle、测试和文档。
- 紧急事实：不适用
- 事故授权范围：不适用

## 目标

以第七阶段本地提交 `8f7e3cdb324ece7cdfeee1bb23e55f23825c5cda` 为基线，把视频号加密媒体头所使用的 ISAAC-64 密钥流生成、解密键解析和 Buffer 异或解密纯算法从 `src/main.js` 迁到独立模块，同时保持全部字节输出、无效键行为、默认解密长度和正式 bundle 行为不变。

## 非目标

不修改视频号链接识别、页面抓取、媒体候选、下载地址、请求头、解密键来源、下载、转写、文件写入、绑定、Pro、本地组件、版本或发布流程；不替换用户本机插件，不发布、不部署、不推送。

## 禁止动作

禁止调整 ISAAC-64 算法、字节序、解密长度、键格式或错误行为；禁止顺手修改视频号抓取、转写、绑定码、`data.json`、根目录 loose assets、tag、Release、CloudBase 或真实用户数据。

## 验收

1. 新模块仅公开 `generateWechatChannelsDecryptorBytes` 与 `decryptWechatChannelsMediaBuffer`，内部实现与基线逐字等价。
2. 固定 seed 密钥流、十进制/十六进制键等价、无效键、空 Buffer、默认 131072 字节上限、自定义 limit 与双次解密还原全部通过。
3. `src/main.js` 只导入新模块，不保留重复算法；调用点和 `__test` 导出不变。
4. 版本保持 1.3.79；定向测试、主回归、市场包、构建漂移、语法、双构建哈希与 `git diff --check` 通过。
5. 独立审查 P0/P1/P2 为 0；只形成干净本地提交，不发布、不部署、不替换本机插件。

## 唯一下一步

保留本地分支和隔离 Worktree，等待与前七阶段候选一起做统一人工核心功能测试；测试通过后另建发布任务。

## 是否需要负责人决定

否；用户已明确要求继续本地主线重构。任何行为变化、本机插件替换、发布或部署另行处理。
