# 小红书视频跳过图片 OCR 设计

## 目标

小红书视频笔记即使页面包含封面图或预览图，也不得触发图片 OCR；图文长文笔记继续在 Pro 权限有效时执行既有图片 OCR。

## 根因

当前 `hydrateWebpageRecord` 在小红书分支中先调用 `enrichXiaohongshuExtractionWithOcr`，随后才依据 `extractedXiaohongshu.videoUrl` 与已解析的 `mediaUrl` 判断图文或视频。因此带封面图的视频笔记会把封面送入 OCR。

## 方案

在调用 OCR 前计算 `isXiaohongshuVideoNote`：当解析结果存在 `videoUrl`，或媒体解析已得到 `mediaUrl` 时，视为视频笔记并跳过 OCR。其余具备图片的可读图文笔记仍走原有 OCR 调用、Markdown 追加与 `ocrTextHeavy` 标记。

这比依赖 URL 形态或仅依赖 `webpageMediaType` 更可靠：小红书的普通笔记 URL、短链和动态渲染页面都可能承载视频，而解析出的实际媒体是最终可信信号。

## 不变项

- 小红书视频下载、媒体保存、音视频转写和评论采集不改动。
- 图文笔记的图片、正文、评论和 OCR 结果格式不改动。
- 不增加设置开关，不修改小程序、云函数、用户数据或本地 OCR 安装流程。

## 验证

新增源代码契约回归：OCR 调用必须由图文条件守卫，守卫同时排除 `videoUrl` 和 `mediaUrl`。保留现有 OCR、视频下载和插件发布包测试，防止误删既有能力。
