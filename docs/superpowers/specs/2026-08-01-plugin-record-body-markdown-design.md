# 插件内容正文格式化拆分设计

## 目标

把当前 `src/main.js` 中“记录已经准备好后，如何生成用户可见 Markdown 正文”的六个纯函数移到 `src/record-body-markdown-utils.js`。行为必须与本地基线逐字等价；只改变代码位置与依赖边界。

## 推荐方案

采用一个显式依赖注入的工厂 `createRecordBodyMarkdownHelpers(dependencies)`。它只接收现有纯函数，并返回六个正文函数：

1. `buildWebpageMarkdownBody(record, title)`
2. `buildAudioTranscriptMarkdown(options)`
3. `buildSourceMediaAttachmentMarkdown(metadata)`
4. `buildTranscriptPropertyMetadata(options)`
5. `buildTranscriptOnlyMetadata(metadata, options)`
6. `buildFileMarkdownBody(record)`

主入口保留所有副作用与业务编排，只在旧函数原本的位置配置工厂、解构并继续使用同名函数。第二阶段的 `note-output-plan-utils` 继续通过同名依赖拿到网页/文件正文函数，不改变其接口。

## 不采用的方案

- 不抽取“附件和 Vault 存储接口”：那会同时碰文件下载、目录创建和真实写入，边界更大。
- 不抽取飞书或小红书解析：外部网页、浏览器登录态和解析兼容性仍处于冻结区。
- 不直接把正文函数塞进 `note-output-plan-utils`：它会把“如何组装整篇笔记”和“不同记录怎样生成正文”重新耦合在一起。

## 数据流与边界

```text
已解析 record / metadata
        │
        ▼
record-body-markdown-utils（纯字符串 / 对象计算）
        │
        ▼
note-output-plan-utils（frontmatter + 正文 + 标记 + 路径）
        │
        ▼
writeRecord（原有 Vault.adapter.write，顺序不变）
```

模块不得导入 Obsidian、读写文件、发 HTTP、启动进程、改写输入 record、创建计时器或访问网络。所需的正文清洗、URL 判断、关键词提取和时间格式化均从主入口显式注入。

## 等价约束

- 网页：飞书去重、小红书图片清理、视频号未接通提示、失败/待处理信息及自动剪贴板引用保持原文。
- 转写：标题、来源媒体嵌入、云端等待/失败文字、关键词和简介提取保持原文与顺序。
- 文件：附件/云端文件引用、转写正文、转换失败和待处理提示保持原文与顺序。
- 不得改变空行、尾部换行、Markdown 标题、失败提示或输入对象。

## 验证

测试先从不存在的模块导入开始红灯；实现后，以相同依赖分别调用“抽取前原函数”和新模块，对六类代表记录比较 Markdown 字符串及元数据对象，并断言输入未被修改。最后运行主插件回归、市场包、构建、语法与差异检查；独立 Agent 再以基线文件进行第二次对照。

## 发布边界

本阶段只交付本地候选。版本号、manifest、生成的公开 Release、CDN、CloudBase、用户插件安装目录均不动；后续手工测试通过后，才可另建发布任务。
