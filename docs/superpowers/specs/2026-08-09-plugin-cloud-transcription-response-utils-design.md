# 插件云端转写响应解析模块设计

## 背景

公开 1.3.79 的累计本地架构候选已经完成六个可回退阶段，但 `src/main.js` 仍同时承载阿里云、豆包和腾讯云转写的请求编排与响应解析。响应解析是同步纯计算，适合先从网络副作用中剥离。

## 方案比较

1. **整段迁出请求、签名、轮询和响应处理**：一次减少最多代码，但会把密钥、默认设置、超时与真实网络行为一起移动，回归面过大。
2. **只迁出响应解析与错误格式化（采用）**：主入口仍负责签名、请求、轮询与供应商选择；新模块只接收普通对象/字符串并返回状态或文本，边界窄且可独立验证。
3. **只补测试、不拆模块**：风险最低，但不能继续缩小主入口，也不能改善后续定位速度。

## 模块边界

新增 `src/cloud-transcription-response-utils.js`，导出：

- `parseTencentCreateTaskResponse`
- `cleanTencentResultText`
- `tryParseJson`
- `extractOpenAICompatibleText`
- `parseAliyunTranscriptionResult`
- `getHeader`
- `formatHttpError`
- `normalizeDoubaoSpeakerText`
- `parseDoubaoAsrResult`
- `parseDoubaoAsrTaskState`
- `parseTencentTaskStatusResponse`

模块唯一内部依赖是 `transcription-quality-utils.js` 的 `dedupeRepeatedTranscriptionLines`。它不读取设置、环境变量、文件、网络、Obsidian API 或用户数据。

## 数据流

网络请求仍在 `src/main.js` 完成。响应对象进入新模块后，被解析为任务 ID、转写文本、处理中/成功/空结果状态或保持原样的错误文本；结果再交回现有轮询与笔记生成流程。没有新增缓存、状态或异步边界。

## 兼容与错误处理

所有函数逐字迁移，不修改腾讯时间戳行清洗、阿里云 SSE 拼接、豆包响应头大小写查找、说话人格式、处理中状态码和错误正文截断规则。原 `__test` 出口保持不变。

## 测试

先创建独立模块测试并确认因模块不存在而失败，再迁移实现。测试覆盖 JSON 失败、阿里云 SSE/普通 JSON/纯文本、豆包说话人/重复行/处理中/HTTP 错误、腾讯创建任务/错误/时间戳清洗。随后运行现有主回归、市场包、构建一致性、语法、双构建哈希与独立审查。

## 发布边界

本阶段只形成本地分支和提交；不修改版本、manifest、versions、根目录镜像，不替换本机插件，不推送、不发布、不部署。
