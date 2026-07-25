# 小红书失败关闭与自动诊断设计

## 背景

用户使用 1.3.57 同步小红书图文时，可能只得到分享口令或通用落地页，却在本地看到带 `synced_at` 的笔记，形成“看起来同步成功、实际正文未提取”的假成功体验。1.3.57 已补充 `xhslink.cn` 识别和不可读内容的可重试错误，但诊断仍不足以直接区分运行版本、短链/页面和提取质量问题。

## 目标

1. 小红书只提取到分享口令、通用落地页或不可读内容时失败关闭。
2. 失败记录不写本地笔记、不调用云端已同步接口、保留为待同步，且不影响同批其他记录。
3. 用户只看到一句可行动提示：`小红书内容提取失败，已记录诊断，下次同步将重试。`
4. 插件自动记录三层脱敏诊断：
   - 运行身份：manifest 版本、bundle 运行版本、build 标记及是否一致。
   - 短链/页面：原始 host、跳转后 host、响应状态、页面类型。
   - 提取质量：标题是否有效、正文字符数、图片数、是否命中分享口令/通用落地页。
5. 免费用户继续拥有基础标题、正文和图片提取；OCR、评论区和 AI 增强仍按现有 Pro 规则执行。

## 非目标

- 不把小红书基础提取改成 Pro。
- 不新增服务端探针、网络接口或真实环境写入。
- 不在诊断中保存 URL 查询参数、Cookie、token、正文、标题正文原文或用户隐私内容。
- 不自动覆盖用户已经生成的旧错误笔记。

## 方案

### 1. 运行身份

bundle 内定义明确的运行版本和 build 标记。`getPluginRuntimeIdentity(manifestVersion)` 返回：

```js
{
  manifestVersion: '1.3.58',
  runtimeVersion: '1.3.58',
  buildMarker: 'xhs-failure-diagnostics-v1',
  matchesManifest: true,
}
```

该信息进入同步失败诊断。它能从 1.3.58 起识别“磁盘 manifest 已更新但当前内存 bundle 不是同一版本”；已经运行的旧 bundle 无法反向拥有新诊断能力，这是技术边界。

### 2. 短链与页面

保留现有 `resolveRedirectUrl()` 兼容接口，同时新增可返回诊断的解析结果。诊断只保留协议和 host，不保留 path/query/hash。最终页面响应记录 HTTP 状态和页面分类：

- `xiaohongshu-note`
- `xiaohongshu-generic-landing`
- `xiaohongshu-unavailable`
- `unexpected-host`
- `unknown`

短链 HEAD 返回 400/403/404/405/501 时继续用 GET 验证，保持 1.3.57 已有兼容行为。

### 3. 提取质量

质量判断沿用 `hasReadableXiaohongshuGraphicContent()`，并补充分享口令识别。仅出现“存下口令、跳转【小红书】阅读”等分享引导时，不能作为正文通过。诊断仅记录布尔值和数量：

```js
{
  hasUsableTitle: false,
  bodyCharacterCount: 0,
  imageCount: 0,
  shareBoilerplateOnly: true,
  genericLanding: false,
  unavailablePage: false,
}
```

### 4. 错误与重试

`createRetryableXiaohongshuContentError()` 接收结构化诊断并附在 error 上。`syncBinding()` 捕获后：

- `failed` 增加该记录；
- 不进入写笔记成功分支；
- 不调用 `/records/{id}/synced`；
- 继续下一条记录；
- `lastSyncDiagnostic` 和 `sync-last.log` 写入脱敏结构；
- 最终 Notice 使用简洁失败提示。

## 安全与隐私

所有诊断先经过安全 URL 摘要和递归脱敏。测试必须证明 `xsec_token`、查询参数值、Cookie 和正文不会进入诊断文本。现有“复制诊断信息”继续作为唯一用户导出入口。

## 验收

1. 分享口令单独存在时判定不可读。
2. 可读标题/正文或真实图片仍能通过，免费路径不要求 Pro。
3. 小红书失败不写笔记、不标记已同步，后续普通记录仍被处理。
4. 失败诊断包含三层字段且没有敏感 URL 查询参数或正文。
5. manifest/runtime 不一致时诊断明确标记。
6. 插件核心测试、语法、发布包和版本身份测试全部通过。

