# 1.3.69 小红书身份连续性与 AI 429 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 1.3.69 中小红书目标地址被通用落地页覆盖的回归，并让 AI 简介/关键词限流不再吞掉已经提取或转写成功的核心内容。

**Architecture:** 小红书链路把“目标身份地址”和“最终响应地址”分开保存：前者一旦得到可信 noteId 就不可被无 noteId 的通用页覆盖，后者只用于传输安全与诊断。AI 元数据保持可选增强；失败时写入脱敏警告，核心 Markdown 仍落盘并标记云端记录已同步。

**Tech Stack:** Obsidian 插件单文件 JavaScript、Node.js `assert` 回归测试、Git Worktree、现有 Harness/发布门禁。

---

### Task 1: 锁定小红书目标身份连续性回归

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: 写入失败测试**

在小红书短链集成测试中加入场景：短链首次解析为
`https://www.xiaohongshu.com/explore/6a4ccf88000000001101d144`，随后静态正文请求最终落到
`https://www.xiaohongshu.com/`。隐藏浏览器必须依次收到原短链、含 noteId 的目标地址和通用最终页；用目标地址渲染时返回与该 noteId 匹配的结构化正文。

断言：

```js
assert.deepStrictEqual(identityContinuityRenderUrls, [
  'http://xhslink.cn/o/identity-continuity',
  `https://www.xiaohongshu.com/explore/${targetGraphicNoteId}`,
  'https://www.xiaohongshu.com/',
]);
assert.strictEqual(identityContinuityRecord.metadata.title, '身份连续性恢复成功');
assert.ok(identityContinuityRecord.metadata.markdown.includes('目标身份没有被通用首页覆盖'));
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: FAIL；浏览器候选缺少含 noteId 的目标地址，实际只有原短链和通用首页。

- [ ] **Step 3: 做最小实现**

将浏览器候选改为显式接收三个阶段：

```js
function getXiaohongshuBrowserCandidates(
  sourceUrl = '',
  targetIdentityUrl = '',
  responseFinalUrl = '',
) {
  // 依次加入原短链、可信目标身份地址、最终响应地址并去重。
}
```

在 `hydrateWebpageMarkdown()` 中：

```js
const redirectedUrl = redirectResult.url;
const targetIdentityUrl = resolveXiaohongshuIdentityUrl([redirectedUrl, url]);
let resolvedUrl = douyinTarget.url || redirectedUrl;
// 静态请求完成后只更新 responseFinalUrl/resolvedUrl，
// 不覆盖 targetIdentityUrl；重建候选时同时保留三个阶段。
```

隐藏浏览器的 `expectedUrl` 优先使用 `targetIdentityUrl`，正文仍必须满足现有精确 noteId 匹配；不得放宽标题、正文或图片阈值。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: PASS。

### Task 2: 保存浏览器跳转途中观察到的可信 noteId

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: 写入失败测试**

用假的 BrowserWindow 模拟：

1. 初始短链无 noteId。
2. 当前 Electron `details` 事件或旧版位置参数形式的主框架导航，短暂出现官方 HTTPS note URL。
3. 最终 `location.href` 回到小红书首页。
4. 页面结构里包含该 noteId 的目标正文。

断言返回的 `identityUrl` 仍是途中观察到的 note URL，而不是空值或首页。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: FAIL；当前渲染器只轮询最终地址，没有保存导航途中身份。

- [ ] **Step 3: 做最小实现**

在 `renderXiaohongshuContentWithElectron()` 中维护：

```js
let observedIdentityUrl = resolveXiaohongshuIdentityUrl([options.expectedUrl, url]);
const rememberIdentityUrl = (candidate) => {
  observedIdentityUrl = resolveXiaohongshuIdentityUrl([
    observedIdentityUrl,
    candidate,
  ]) || observedIdentityUrl;
};
```

在每个隐藏 BrowserWindow 自己的 `webContents` 上监听 `will-navigate` 和 `will-redirect`，同时兼容当前 Electron 的 `details.url/details.isMainFrame` 与旧版位置参数签名；只从受信任的主框架导航调用 `rememberIdentityUrl()`。窗口关闭时用原 handler 引用精确移除监听器，禁止共享 Session 或其它窗口污染身份。快照选择时把 `observedIdentityUrl` 作为 expected identity，并且只接受 `xiaohongshu.com` 官方 HTTPS 且能提取合法 noteId 的地址。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: PASS。

### Task 3: 让 AI 429 不再阻断核心内容落盘

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Modify: `docs/DECISIONS.md`

- [ ] **Step 1: 写入失败测试**

构造已经成功转写的网页记录，让 `/metadata/generate` 抛出 `Request failed with status code 429`，断言：

```js
assert.strictEqual(result.written.length, 1);
assert.strictEqual(result.failed.length, 0);
assert.strictEqual(vaultWrites.length, 1);
assert.ok(vaultWrites[0].markdown.includes('wechat-inbox-ai-metadata-error'));
assert.ok(vaultWrites[0].markdown.includes('已经成功取得的转写正文'));
assert.deepStrictEqual(markSyncedCalls, [
  ['/records/transcript-ai-429/synced', 'POST'],
]);
```

同时断言 Markdown 没有伪造 AI 简介、关键词或 `aiMetadataSource: cloud`。

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: FAIL；当前 `requireMetadata` 在写文件前抛错，`vaultWrites.length === 0`。

- [ ] **Step 3: 做最小实现**

删除“转写成功就强制 AI 成功”的硬门槛。`enrichRecordMetadataWithAi()` 对 429、5xx、超时、余额不足和空响应统一返回：

```js
{
  ...record,
  metadata: {
    ...metadata,
    aiMetadataError: finalMessage,
  },
}
```

不生成假的 description/keywords/source。新增 `buildAiMetadataErrorComment()`，只输出经过单行清洗和长度限制的错误类型/短原因；由 `buildMarkdownForRecord()` 将该 HTML 注释放在记录标记之后、正文之前。`getRecordConversionWarning()` 同时返回“内容已同步，但 AI 简介/关键词暂未生成”，使结果提示可见；`writeRecord()` 正常写入，`syncBinding()` 正常调用 `/synced`，本次同步不自动重试 AI。

- [ ] **Step 4: 更新长期决策**

把 `docs/DECISIONS.md` 的 AI 元数据决策改为：

- 核心标题、正文、图片和转写成功后，AI 简介/关键词永远是非阻断增强。
- 失败时写脱敏 `wechat-inbox-ai-metadata-error` 注释。
- 不在当前同步中自动重试；未来补生成必须走独立、幂等、退避的流程。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: PASS。

### Task 4: 回归、独立审查与发布候选

**Files:**
- Modify if release is authorized: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify if release is authorized: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify if release is authorized: `manifest.json`
- Modify if release is authorized: `versions.json`
- Modify if release is authorized: `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`
- Test: `tests/plugin-main-ai.test.js`
- Test: `tests/plugin-marketplace-package.test.js`

- [ ] **Step 1: 运行定向和发布身份回归**

Run:

```powershell
node --check obsidian-plugin/wechat-inbox-sync/main.js
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node scripts/check-plugin-release-identity.js
git diff --check
```

Expected: 全部 PASS。

- [ ] **Step 2: 独立审查**

安全审查必须确认：外站导航仍被拒绝、推荐流不能冒充目标笔记、诊断不包含 URL path/query/Cookie/正文。测试审查必须确认两个测试都先在 1.3.69 RED、候选 GREEN，并覆盖免费图文、Pro 转写/OCR、Pro+登录评论边界。

- [ ] **Step 3: 形成发布候选**

只有在根因、定向回归、完整插件回归和独立审查均通过后，才登记新版本占用并进入既有插件发布流程；不得覆盖 1.3.69 tag 或 Release。
