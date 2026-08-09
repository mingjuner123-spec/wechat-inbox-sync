# 插件附件与媒体文件纯工具模块拆分设计

## 背景

1.3.79 的 `src/main.js` 已建立模块化构建，但附件命名、数据 URL 解码、Buffer 规范化、文件扩展名与媒体文件头判断仍散落在主入口。它们不负责网络、文件写入或同步状态，适合形成下一段低耦合边界。

## 设计目标

新增 `src/media-file-utils.js`，迁移以下纯函数：`getImageFileExtension`、`getAudioFormatFromUrl`、`hasVideoTrackInMediaBuffer`、`bufferStartsWith`、`getInvalidDownloadedMediaReason`、`sanitizeAttachmentName`、`decodeDataUrl`、`getImageExtFromMime`、`getImageExtFromBuffer`、`getAttachmentExt`、`isMarkdownConvertibleExt`、`isAudioVideoAttachmentExt`、`decodeUtf8ArrayBuffer`、`toNodeBuffer`。主入口只负责导入和调用。

`escapeRegExp` 继续保留在主入口，因为它同时服务非媒体 HTML 属性解析和 Markdown 链接替换，不属于本模块的单一职责。

## 等价策略

- 逐字迁移函数体，不调整默认值、扩展名白名单、媒体签名或错误返回文本。
- 新模块不依赖 Obsidian、网络、文件系统、用户设置或插件实例。
- DOCX/PDF 模块继续由主入口把同一个 `toNodeBuffer` 注入，避免出现两套 Buffer 规则。
- 构建产物仍由现有 esbuild 生成单一 `main.js`，不引入运行时相对模块依赖。

## 测试设计

独立测试覆盖 URL 扩展名、MIME、JPEG/PNG/GIF/WebP/PDF/ZIP/HTML/JSON 文件头、MP4 音视频轨、Data URL、ArrayBuffer/TypedArray/Buffer 规范化、附件类型判断和名称清洗；同时扫描主入口不再定义这些函数。再运行主回归、市场包、构建检查与双构建哈希。

## 回退

任何输出差异、构建漂移或回归失败都回退本任务提交，上一回退点为 `ebbbce457d40d7766447294783e19a9f564b750c`。不发布、不部署、不替换用户插件。