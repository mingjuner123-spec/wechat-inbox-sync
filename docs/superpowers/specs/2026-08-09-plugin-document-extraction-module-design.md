# 插件文档解析模块拆分设计

日期：2026-08-09
状态：已批准，进入本地实现
基线：WeChat Inbox Sync 1.3.79，提交 `5748f680434f2bca10976335f2201f59599905b4`

## 目标

把 `src/main.js` 中 DOCX ZIP/XML 解析与 PDF 文本层解析迁入独立模块，减少主入口体积和认知负担，同时保持输出、错误、调用顺序和正式 bundle 行为完全不变。

本阶段是纯结构重构：不增加能力，不修改用户界面，不修改版本，不发布、不部署，也不替换负责人本机插件。

## 当前边界

现有实现位于 `src/main.js` 的文档附件处理区域，包含：

- DOCX：ZIP 中央目录读取、deflate 解压、XML 实体解码、段落和标题转换。
- PDF：流读取与解压、ToUnicode CMap、字面量/十六进制字符串解码、换行合并、低质量和异常字形识别。
- 共享依赖：`toNodeBuffer` 与 `cleanMarkdownForStorage`。

`toNodeBuffer` 仍被图片附件流程使用，所以继续保留在 `src/main.js`；新模块通过工厂参数注入它与 `cleanMarkdownForStorage`。模块内部只直接依赖 Node 内置 `zlib`。

## 设计

新增 `src/document-text-extraction-utils.js`，导出：

```js
createDocumentTextExtractionHelpers({
  toNodeBuffer,
  cleanMarkdownForStorage,
})
```

工厂返回：

- `extractDocxMarkdown(bufferLike)`
- `extractPdfMarkdown(bufferLike)`
- `cleanPdfExtractedText(text)`

`src/main.js` 只负责导入、装配并在原调用点使用这三个接口。原有内部辅助函数全部随实现迁出，不在主文件保留第二份副本。

## 行为等价约束

- DOCX 标题层级、段落空行、XML 实体和缺少 `word/document.xml` 的错误保持一致。
- PDF CMap、UTF-16BE、压缩流、换行清洗、低质量文本、异常字形与空文本错误保持一致。
- 错误文案按源文件字节迁移，不趁重构修正历史文案或编码。
- 附件保存、Markdown 写入、同步状态和失败回退不变。
- 构建后仍只有单个可发布 `main.js`，不要求用户额外安装模块文件。
- `manifest.json` 与 `versions.json` 保持 1.3.79。

## 测试设计

新增独立模块测试，直接覆盖模块公开接口：

1. 正常 DOCX：正文、标题和 XML 实体。
2. 异常 DOCX：缺少 `word/document.xml`。
3. 正常 PDF：UTF-16BE 中文文本。
4. PDF 低质量文本。
5. PDF 异常字形/乱码启发式。
6. PDF 清洗和跨行合并。
7. 源码装配检查：`src/main.js` 使用新模块，且不再保留迁出函数定义。

同时保留现有插件 AI、市场包、构建漂移和语法回归。

## 风险与回退

主要风险是迁移时漏掉内部辅助函数、改变闭包依赖或构建产物漂移。控制方式是先写失败测试，再原样迁移，最后双构建比对。

回退单位是本任务独立分支提交；没有任何线上或用户数据动作。
