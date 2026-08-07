# 插件 AI 元数据纯格式化拆分设计

## 目标

将 `src/main.js` 中不含网络、文件系统或 Obsidian 调用的四项 AI 元数据计算提取为 `src/ai-metadata-utils.js`，并保持第三阶段候选的所有输出和输入不变行为。

## 推荐方案

使用 CommonJS 工厂 `createAiMetadataHelpers(dependencies)`。工厂显式接收仍由主入口持有的三个已有纯辅助函数：`tryParseJson`、`cleanMarkdownForStorage` 与 `stripMarkdownCodeBlocks`，并返回：

1. `normalizeGeneratedKeywords(value)`
2. `parseGeneratedMetadataResponse(text)`
3. `normalizeGeneratedMetadataResult(result)`
4. `extractAiMetadataInputText(record)`

主入口仍保留 `shouldGenerateAiMetadata`，因为它决定是否请求模型；也保留所有模型请求、429/超时处理、同步和写入逻辑。主入口只配置工厂并继续使用同名函数。

## 不采用的方案

- 不移动 `cleanMarkdownForStorage`：它同时服务飞书、PDF、网页等冻结链路，移动会扩大风险。
- 不移动 AI 请求或错误分类：这些涉及网络、限流和同步行为，不是纯格式化边界。
- 不修改提示词、模型、字段长度、标签规则或用户可见文案。

## 等价验证

测试在内存中读取第三阶段历史生成物 `1a9c8d6e:obsidian-plugin/wechat-inbox-sync/main.js`，仅临时注入测试导出。候选模块使用历史依赖，逐项比较关键词、JSON/fenced JSON/标签式/空响应、结果截断、网页记录与转写记录的输入文本；每项断言原始输入对象不变。任何差异均停止本段，不发布。

## 范围与发布边界

只修改 `src/main.js`、新建 `src/ai-metadata-utils.js`、定向测试及本阶段文档。版本、manifest、根目录镜像、Release/CI、云端、用户本地插件均不修改；本阶段只保留本地候选。
