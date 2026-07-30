# WeChat Inbox Sync 1.3.74 代码地图

## 基线

- 提交：`f08429ed`
- 正式业务锚点：`4405dcef`
- 插件版本：`1.3.74`
- 发布源：`obsidian-plugin/wechat-inbox-sync/`
- `main.js`：约 20,206 行
- `tests/plugin-main-ai.test.js`：约 13,647 行
- 基线 `main.js` SHA-256：`AB3C12E754E40C55C5BF3C5E30B5C32E55F07600EB9FB6CD8BAD08A90437D91A`
- 核心、市场包、候选、身份和发布治理基线测试：全绿

## 当前职责

| 区域 | 职责 | 风险 |
| --- | --- | --- |
| 本地组件 | ASR/OCR 安装、兼容、日志、修复、运行 | 高，跨 Windows/macOS、文件系统、进程和 CDN |
| 设置与传输 | 设置合并、绑定、Pro、HTTP、下载和中止 | 高，关联双环境和现有用户设置 |
| 转写协议 | 腾讯、阿里、豆包请求/响应、媒体与质量判断 | 中高 |
| 文档转换 | Markdown、AI 元数据、PDF、DOCX、附件 | 中高 |
| 社媒解析 | 小红书、抖音、B站、小宇宙、视频号 | 很高，外部页面和登录态经常变化 |
| 浏览器与 OAuth | Electron 会话、隐藏窗口、飞书、小红书登录 | 很高 |
| 存储与同步 | Vault、frontmatter、附件、队列、失败/删除 | 很高，决定用户文件和幂等性 |
| UI | Modal、进度提示、设置页 | 中高 |

## 主要热点

- `hydrateWebpageMarkdown`：约 850 行。
- 小红书 Electron 渲染：约 780 行。
- 设置页 `display`：约 580 行。
- `runLocalTranscription`：约 177 行。
- `syncBinding`：约 127 行。

## 重要状态和副作用

- 模块级可变状态：小红书浏览器会话队列。
- 插件实例状态：settings、安装 Promise、中止控制器、子进程、当前转写上下文、待删除记录、同步 single-flight、Notice。
- 外部副作用：文件系统、子进程、HTTP、Obsidian `requestUrl`、Electron session/BrowserWindow、Vault adapter、`saveData`、计时器。

## 已确认不能直接复用的文件

`plugin-core.js`、`sync-core.js`、`cloud-client.js` 当前未被插件入口引用，且默认 API/设置已与 1.3.74 漂移。它们是历史参考，不是可直接接回的模块。

## 第一阶段模块

| 顺序 | 模块 | 状态 | 备注 |
| ---: | --- | --- | --- |
| 0 | 确定性构建地基 | 已完成 | `src/main.js` 与正式 `main.js` 基线字节一致；CI/Release 已加漂移门禁 |
| 1 | 日期工具 | 已完成 | UTC+8、跨日和无效日期回退测试通过 |
| 2 | 转写质量 | 已完成 | 固定阈值、提示词泄漏和重复句错误契约 |
| 3 | 进度提示 | 已完成，待提交检查点 | 固定文字、计数、ASR 进度和心跳契约 |
| 4 | AI 元数据错误 | 待开始 | 纯分类与注释 |
| 5 | 诊断脱敏 | 待开始 | 不扩大或缩小现有脱敏 |
| 6 | Vault 路径 | 待开始 | 不改变目录和回退值 |
| 7 | 输入规范化 | 待开始 | 不改变设置默认值 |
| 8 | 记录元数据 | 待开始 | 后置 |
| 9 | 记录状态 | 待开始 | 高风险，状态矩阵 |
| 10 | 记录身份 | 待开始 | 高风险，重复笔记差分 |

## 检查点记录

### 构建地基

- `src/main.js` 与 1.3.74 正式 `main.js` SHA-256 均为 `AB3C12E754E40C55C5BF3C5E30B5C32E55F07600EB9FB6CD8BAD08A90437D91A`。
- 固定 esbuild `0.28.1`；当前无本地模块时保持源码字节，出现模块后生成单文件 bundle。
- 构建器拒绝缺失静态依赖、动态 require 和 bundle 中残留的相对 require。
- Linux/Windows 主门禁和 Release 在候选生成前安装固定工具链并校验源码/生成物。
- 核心、市场包、候选、身份和治理回归全绿。
- 独立复审：P0=0、P1=0、P2=0。

### 日期工具

- 从当前 1.3.74 抽离 `pad2`、`getChinaTimeParts`、`getDateFolderName`、`formatCreatedTime`、`getTitleTimePart`。
- UTC+8 跨日、时间戳输入、无效日期回退和生成 bundle 对照均通过。
- `plugin-main-ai` 继续加载最终 `main.js` 做运行行为回归；仅源码结构断言改读 `src/main.js`。
- 市场包测试继续读取最终生成物。
- 根 `main.js` 与权威生成 `main.js` 哈希一致。
- 完整相关回归通过；独立复审 P0=0、P1=0、P2=0。

### 转写质量

- 从当前 1.3.74 抽离重复行去除、质量单元归一化、提示词泄漏/重复句检测和错误构造六个纯函数。
- 新模块与原内联实现逐项等价；调用点和 `PluginClass.__test` 导出保持不变。
- 定向模块测试覆盖正常文本、相邻重复、提示词泄漏、重复句循环、空结果和最终生成 bundle。
- 构建、插件核心、市场包、候选、发布身份、治理、镜像和语法检查均通过。
- 小红书、ASR/OCR 安装、同步/暂停删除、设置、版本和 Release Pipeline V2 均未改。
- 独立复审未发现 P0/P1/P2。

### 进度提示

- 从当前 1.3.74 抽离同步结果、跳过原因、转换告警、进度百分比、ASR 日志、耗时和心跳提示十个纯函数。
- 完整保留 `locally-quarantined-unrecoverable` 与 `deleted-expired-xhs-shortlink` 的 1.3.74 提示、计数和排除规则。
- 定向测试同时验证源模块、最终生成 `main.js` 和 `PluginClass.__test`。
- 构建、插件核心、市场包、候选、发布身份、治理、镜像和语法检查均通过。
- 小红书提取、ASR/OCR 安装、同步 single-flight/暂停删除、设置、版本和 Release Pipeline V2 均未改。
- 独立复审：P0=0、P1=0、P2=0。

## 冻结区

- 小红书全链。
- ASR/OCR 全链。
- 暂停/删除、同步 single-flight 和失败清理。
- 双环境 API、绑定、Pro、飞书 OAuth。
- 设置 UI。
- manifest、versions、运行标记和发布候选契约；根 `main.js` 只允许跟随权威生成物单向同步。

## 下一阶段候选

只有第一阶段完成并通过用户本地测试后，才重新评估：

1. Frontmatter 生成器。
2. 附件和 Vault 存储接口。
3. 同步状态机。
4. 飞书纯内容解析。
5. PDF/DOCX 纯转换。
6. 平台解析器接口。
