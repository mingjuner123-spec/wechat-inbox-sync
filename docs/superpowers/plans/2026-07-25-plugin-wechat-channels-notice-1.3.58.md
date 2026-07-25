# 视频号提示、小红书失败闭环诊断与 1.3.58 发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 视频号失败显示明确提示；小红书不可读内容失败关闭并自动记录三层脱敏诊断；验证后发布插件 1.3.58。

**Architecture:** 复用现有 `isWechatChannelsUrl()` 做严格平台判断。小红书链路在现有可读性门禁前后收集运行身份、短链/页面响应与提取质量摘要，将其附到可重试错误；同步循环只记录失败并继续，不写笔记、不标记已同步。所有 URL 只记录 host 摘要，基础图文提取不新增 Pro 门禁。

**Tech Stack:** Obsidian/Electron Node.js、Node `assert` 回归测试、GitHub Actions/Release、Obsidian 社区插件发布链路。

---

### Task 1: 建立小红书三层诊断失败测试

**Files:**
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 写运行身份、URL 脱敏和质量摘要断言**

加入以下断言：

```js
assert.deepStrictEqual(helpers.getPluginRuntimeIdentity('1.3.58'), {
  manifestVersion: '1.3.58',
  runtimeVersion: '1.3.58',
  buildMarker: 'xhs-failure-diagnostics-v1',
  matchesManifest: true,
});
assert.strictEqual(helpers.getPluginRuntimeIdentity('1.3.57').matchesManifest, false);

const diagnostic = helpers.buildXiaohongshuFailureDiagnostic({
  manifestVersion: '1.3.58',
  sourceUrl: 'http://xhslink.cn/o/demo?xsec_token=secret',
  resolvedUrl: 'https://www.xiaohongshu.com/explore/123?xsec_token=secret',
  responseStatus: 200,
  html: '<title>小红书 - 你的生活兴趣社区</title>',
  extracted: { title: '小红书 - 你的生活兴趣社区', description: '存下口令，跳转【小红书】阅读', imageUrls: [] },
});
assert.strictEqual(diagnostic.request.sourceHost, 'xhslink.cn');
assert.strictEqual(diagnostic.request.finalHost, 'xiaohongshu.com');
assert.strictEqual(JSON.stringify(diagnostic).includes('secret'), false);
assert.strictEqual(diagnostic.extraction.shareBoilerplateOnly, true);
```

- [ ] **Step 2: 写同步失败关闭断言**

扩展 `runXiaohongshuUnavailableRecordRemainsPendingTest()`：第一个小红书记录抛出带诊断的可重试错误，第二个普通记录写入成功。断言小红书没有写入、没有 `/synced` 调用；普通记录正常写入和标记；`lastSyncDiagnostic.diagnostic` 存在，失败消息精确为：

```text
小红书内容提取失败，已记录诊断，下次同步将重试。
```

- [ ] **Step 3: 运行测试并确认旧版失败**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，原因是三层诊断 helper 和新错误消息尚不存在。

### Task 2: 实现运行身份与脱敏诊断

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: 增加运行身份和安全 URL 摘要**

定义：

```js
const PLUGIN_RUNTIME_VERSION = '1.3.58';
const PLUGIN_RUNTIME_BUILD_MARKER = 'xhs-failure-diagnostics-v1';

function getPluginRuntimeIdentity(manifestVersion = '') {
  const normalizedManifestVersion = String(manifestVersion || '').trim() || 'unknown';
  return {
    manifestVersion: normalizedManifestVersion,
    runtimeVersion: PLUGIN_RUNTIME_VERSION,
    buildMarker: PLUGIN_RUNTIME_BUILD_MARKER,
    matchesManifest: normalizedManifestVersion === PLUGIN_RUNTIME_VERSION,
  };
}

function getSafeUrlDiagnostic(url = '') {
  try {
    const parsed = new URL(String(url || ''));
    return {
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname.replace(/^www\./, '').toLowerCase(),
    };
  } catch (error) {
    return { protocol: '', host: '' };
  }
}
```

- [ ] **Step 2: 增加页面分类与提取质量摘要**

实现 `isXiaohongshuShareBoilerplateOnly()`、`classifyXiaohongshuPage()` 和 `buildXiaohongshuFailureDiagnostic()`。只输出运行身份、host/status/pageType 及标题有效性、正文字符数、图片数、分享口令/通用页/不可用页布尔值，不输出原文。

- [ ] **Step 3: 让可重试错误携带结构化诊断**

```js
function createRetryableXiaohongshuContentError(diagnostic = {}) {
  const error = new Error('小红书内容提取失败，已记录诊断，下次同步将重试。');
  error.retryable = true;
  error.code = 'XIAOHONGSHU_CONTENT_UNAVAILABLE';
  error.diagnostic = redactSensitiveObject(diagnostic);
  return error;
}
```

- [ ] **Step 4: 运行核心测试**

Run: `node tests/plugin-main-ai.test.js`

Expected: 仍可能因调用点和同步循环尚未传递诊断而失败，但新增纯函数断言通过。

### Task 3: 接入小红书抓取与同步循环

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: 在小红书请求后构建诊断**

在 `requestUrl()` 响应后保留 `response.status`；不可读门禁触发时调用：

```js
throw createRetryableXiaohongshuContentError(buildXiaohongshuFailureDiagnostic({
  manifestVersion: this.manifest && this.manifest.version,
  sourceUrl: url,
  resolvedUrl,
  responseStatus: response.status,
  html,
  extracted: extractedXiaohongshu,
  renderError: renderedXiaohongshuError,
}));
```

- [ ] **Step 2: 将诊断写入单条失败状态**

在 `syncBinding()` catch 中把 `error.diagnostic || null` 放入 `lastSyncDiagnostic.diagnostic` 和 `failed` 项；`buildSyncDiagnosticLogText()` 增加：

```js
'--- diagnostic ---',
JSON.stringify(redactSensitiveObject(diagnostic || {}), null, 2),
```

最终汇总诊断也保留第一条失败的结构化诊断，避免 `syncInbox()` 覆盖单条详情。

- [ ] **Step 3: 确认失败关闭和批次继续**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS；小红书记录没有写入和 `/synced`，第二条普通记录仍成功。

### Task 4: 建立视频号专用提示

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: 写视频号和普通网页对照断言**

用 `buildMarkdownForRecord()` 构造两个 `conversionStatus: failed` 的网页记录。视频号记录必须包含“视频号内容解析功能暂未接通”和“当前已为你保存原始链接”，且不包含“网页正文太短”；普通网页仍包含原通用提示。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL，旧版视频号仍输出通用失败文案。

- [ ] **Step 3: 在失败分支加入视频号专用返回**

仅当 URL 被 `isWechatChannelsUrl()` 识别，且状态为 `failed`、`wechat_captcha` 或 `link_saved` 时返回：

```text
> ⚠️ 视频号内容解析功能暂未接通，当前已为你保存原始链接。
> 功能上线后，可以重新发送链接进行提取。
```

- [ ] **Step 4: 运行插件核心测试并确认通过**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS。

### Task 5: 独立审核与修正

**Files:**
- Modify if required: `obsidian-plugin/wechat-inbox-sync/main.js`
- Modify if required: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: 请求独立子 Agent 审核**

审核必须覆盖失败关闭、免费/Pro 边界、URL/正文脱敏、批次继续、测试充分性和视频号非目标边界。

- [ ] **Step 2: 对每条意见先复现再修正**

若有问题，先用失败测试证明，再做最小修复；运行 `node tests/plugin-main-ai.test.js` 直至通过。无问题则记录审核结论后继续。

### Task 6: 版本身份与发布验证

**Files:**
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Test: `tests/plugin-marketplace-package.test.js`
- Test: `tests/plugin-release-identity.test.js`

- [ ] **Step 1: 将四处正式版本身份统一提升到 1.3.58**

`versions.json` 新增 `"1.3.58": "1.0.0"`，不改写历史版本。

- [ ] **Step 2: 运行发布回归**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node tests/plugin-release-identity.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: 全部退出码为 0。

- [ ] **Step 3: 写结果日志**

按 `docs/TASK_CLOSEOUT_TEMPLATE.md` 在 `docs/WORKLOG.md` 记录任务、测试、独立审核、未发生的外部动作和回退点。

- [ ] **Step 4: 发布并执行发布后终检**

创建 PR 并合并到默认分支；创建精确标签和 GitHub Release `1.3.58`，上传 `main.js`、`manifest.json`、`styles.css`、`versions.json` 和 ZIP。运行 `obsidian-plugin-release-check`，确认默认分支、标签、Release 资产、远端 manifest 与本地 ZIP 身份一致。
