# Xiaohongshu Anonymous Extraction Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Xiaohongshu extraction anonymous-first, recover generic landing pages through the existing persistent Electron session, and leave unavailable records pending instead of saving share text as complete content.

**Architecture:** Add pure classification and retryable-error helpers beside the existing Xiaohongshu extractors. Route hidden rendering through an overridable plugin method, reuse one rendered page for both content and comments, and rethrow a Xiaohongshu-specific retryable error so `syncBinding` never reaches the `/synced` call for incomplete records.

**Tech Stack:** Node.js, Obsidian plugin JavaScript, Electron BrowserWindow session, built-in `assert` regression tests.

---

### Task 1: Reject generic Xiaohongshu landing pages

**Files:**
- Modify: `tests/plugin-main-ai.test.js:2059-2083`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:5265-5289`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:15798-15800`

- [x] **Step 1: Write the failing classification test**

Add a fixture with the production symptom and assert it is not readable:

```js
const genericXiaohongshuLandingHtml = [
  '<html><head>',
  '<meta property="og:title" content="小红书 - 你的生活兴趣社区">',
  '<meta name="description" content="86【超常儿童，也可能被鸡废了，家长都踩过】分享口令">',
  '<meta property="og:image" content="https://picasso-static.xiaohongshu.com/fe-platform/default-logo.png">',
  '</head></html>',
].join('');
const genericXiaohongshuExtraction = helpers.extractXiaohongshuMarkdownFromHtml(
  genericXiaohongshuLandingHtml,
  'https://www.xiaohongshu.com/explore/generic-note',
  '86【超常儿童，也可能被鸡废了，家长都踩过】分享口令',
);
assert.strictEqual(helpers.isGenericXiaohongshuLandingExtraction(
  genericXiaohongshuExtraction,
  genericXiaohongshuLandingHtml,
), true);
assert.strictEqual(helpers.hasReadableXiaohongshuGraphicContent(
  genericXiaohongshuExtraction,
  genericXiaohongshuLandingHtml,
  'https://www.xiaohongshu.com/explore/generic-note',
), false);
```

- [x] **Step 2: Run the test and verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because `helpers.isGenericXiaohongshuLandingExtraction` and the stricter exported readability helper do not exist.

- [x] **Step 3: Implement the minimal classifier**

Add and use this classifier before the existing image/description checks:

```js
function isGenericXiaohongshuLandingExtraction(extracted) {
  if (!extracted) return true;
  const title = String(extracted.title || '').trim();
  const description = String(extracted.description || '').trim();
  return title.includes('你的生活兴趣社区')
    || (/该内容来自小红书/.test(description) && /打开小红书/.test(description));
}

function hasReadableXiaohongshuGraphicContent(extracted, html, url = '') {
  if (!extracted
    || isUnavailableXiaohongshuPage(html, url)
    || isGenericXiaohongshuLandingExtraction(extracted, html)) return false;
  const hasImages = Array.isArray(extracted.imageUrls) && extracted.imageUrls.length > 0;
  if (hasImages) return true;
  const description = String(extracted.description || '').trim();
  if (!description || description.length < 20) return false;
  if (/^(?:短链落地页|当前笔记暂时无法浏览|你访问的页面不见了|页面未直接暴露正文)/.test(description)) return false;
  return true;
}
```

Export both helpers through `WechatObsidianInboxPlugin.__test`.

- [x] **Step 4: Run the test and verify GREEN**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS.

### Task 2: Recover content from the persistent browser session

**Files:**
- Modify: `tests/plugin-main-ai.test.js:4378-4464`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:11168-11214`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:14649-14749`

- [x] **Step 1: Write the failing rendered-content recovery test**

Create a plugin whose fast request returns the generic fixture while its rendered page returns a real note:

```js
const renderedFallbackPlugin = new PluginClass();
renderedFallbackPlugin.settings = helpers.mergeSettings({ aiProvider: 'off' });
renderedFallbackPlugin.hasProFeatureAccess = async () => false;
let renderedFallbackCalls = 0;
renderedFallbackPlugin.renderXiaohongshuPage = async () => {
  renderedFallbackCalls += 1;
  return {
    html: [
      '<html><head>',
      '<meta property="og:title" content="超常儿童，也可能被鸡废了">',
      '<meta name="description" content="这是隐藏浏览器恢复出来的完整小红书正文，长度足够通过真实内容判断。">',
      '<meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/real-cover.jpg">',
      '</head></html>',
    ].join(''),
    comments: [],
    commentDiagnosticDetails: { source: 'page-api', rootCount: 0, stopReason: 'root_unavailable' },
  };
};
```

Mock `requestUrl` for `https://www.xiaohongshu.com/explore/rendered-fallback` to return the generic landing HTML. Call `hydrateWebpageMarkdown` and assert:

```js
assert.strictEqual(renderedFallbackCalls, 1);
assert.strictEqual(renderedFallbackRecord.metadata.title, '超常儿童，也可能被鸡废了');
assert.ok(renderedFallbackRecord.metadata.markdown.includes('隐藏浏览器恢复出来的完整小红书正文'));
assert.ok(renderedFallbackRecord.metadata.markdown.includes('real-cover.jpg'));
```

- [x] **Step 2: Run the test and verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because `hydrateWebpageMarkdown` does not call the overridable renderer for generic graphic notes and keeps the generic title/share text.

- [x] **Step 3: Implement one-render fallback and reuse**

Add an overridable class wrapper:

```js
async renderXiaohongshuPage(url) {
  return await renderXiaohongshuPageWithElectron(url);
}
```

In the Xiaohongshu branch, keep `renderedXiaohongshuPage` outside the comments block. If the fast extraction is unreadable, call the wrapper once, extract from `renderedXiaohongshuPage.html`, and replace the fast result only when the rendered result passes `hasReadableXiaohongshuGraphicContent`. When comments are enabled, reuse the same object instead of opening a second BrowserWindow.

```js
let renderedXiaohongshuPage = null;
let renderedXiaohongshuError = null;
const fastXiaohongshuReadable = hasReadableXiaohongshuGraphicContent(
  extractedXiaohongshu,
  html,
  resolvedUrl,
);
if (!fastXiaohongshuReadable || shouldIncludeXiaohongshuComments) {
  try {
    renderedXiaohongshuPage = await this.renderXiaohongshuPage(resolvedUrl);
  } catch (error) {
    renderedXiaohongshuError = error;
  }
}
if (!fastXiaohongshuReadable && renderedXiaohongshuPage && renderedXiaohongshuPage.html) {
  const renderedHtml = renderedXiaohongshuPage.html;
  const renderedExtraction = extractXiaohongshuMarkdownFromHtml(
    renderedHtml,
    resolvedUrl,
    metadata.shareText || record.content || '',
    { includeComments: false },
  );
  if (hasReadableXiaohongshuGraphicContent(renderedExtraction, renderedHtml, resolvedUrl)) {
    extractedXiaohongshu = renderedExtraction;
    html = renderedHtml;
  }
}
```

Use `renderedXiaohongshuError` only for the final diagnostic message; do not fail a valid fast extraction because comment rendering failed.

- [x] **Step 4: Run the test and verify GREEN**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS.

### Task 3: Keep unavailable notes pending and preserve anonymous fast path

**Files:**
- Modify: `tests/plugin-main-ai.test.js:4378-4464`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:5284-5290`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:14649-14749`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:14926-14930`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:15798-15800`

- [x] **Step 1: Write two failing behavior tests**

First assert the anonymous fast path does not invoke rendering when the HTTP HTML is already real. Second, return generic HTML from both paths and assert rejection:

```js
let anonymousFastRenderCalls = 0;
anonymousFastPlugin.renderXiaohongshuPage = async () => {
  anonymousFastRenderCalls += 1;
  throw new Error('complete anonymous HTML must not need rendered content');
};
// requestUrl returns a real title, substantial description, and real image for this URL.
const anonymousFastRecord = await anonymousFastPlugin.hydrateWebpageMarkdown({
  type: 'webpage',
  content: 'https://www.xiaohongshu.com/explore/anonymous-fast-note',
  metadata: {
    url: 'https://www.xiaohongshu.com/explore/anonymous-fast-note',
    shareText: '匿名分享文本',
  },
}, '', '', '匿名路径测试');
assert.strictEqual(anonymousFastRenderCalls, 0);
assert.ok(anonymousFastRecord.metadata.markdown.includes('匿名路径完整正文'));

await assert.rejects(
  () => unavailableGraphicPlugin.hydrateWebpageMarkdown({
    type: 'webpage',
    content: 'https://www.xiaohongshu.com/explore/unavailable-graphic-note',
    metadata: {
      url: 'https://www.xiaohongshu.com/explore/unavailable-graphic-note',
      shareText: '只有分享口令，没有真实正文',
    },
  }, '', '', '不可用图文测试'),
  (error) => error
    && error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE'
    && error.message.includes('插件设置中登录小红书'),
);
```

- [x] **Step 2: Run the test and verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because a generic rendered result is still returned as `conversionStatus: success` instead of a retryable rejection.

- [x] **Step 3: Add the retryable unavailable-content error**

```js
function createRetryableXiaohongshuContentError(detail = '') {
  const suffix = detail ? `：${detail}` : '';
  const error = new Error(`小红书没有返回真实笔记内容，请在插件设置中登录小红书后重试${suffix}`);
  error.code = 'XIAOHONGSHU_CONTENT_UNAVAILABLE';
  return error;
}

function isRetryableXiaohongshuContentError(error) {
  return Boolean(error && error.code === 'XIAOHONGSHU_CONTENT_UNAVAILABLE');
}
```

After rendered recovery and before OCR, throw this error only when all are true: the URL is Xiaohongshu, no real graphic content exists, there is no recovered media URL, and the record is not an explicit video-intent fallback. In the outer `catch`, rethrow this error beside retryable transcription errors:

```js
if (isRetryableTranscriptionError(error) || isRetryableXiaohongshuContentError(error)) {
  throw error;
}
```

Export both helpers for regression tests. Because `writeRecord` rejects before returning, the existing `syncBinding` sequence never executes `/records/:id/synced`, leaving the cloud record pending.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS with the anonymous fast path, rendered recovery, and retryable rejection assertions all green.

### Task 4: Verify and document the completed change

**Files:**
- Modify: `docs/WORKLOG.md`

- [x] **Step 1: Run syntax and focused regression checks**

Run:

```powershell
node --check obsidian-plugin/wechat-inbox-sync/main.js
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
```

Expected: all commands exit 0.

- [x] **Step 2: Inspect the diff**

Run:

```powershell
git diff --check
git status --short
```

Expected: only the plugin source, focused tests, plan/spec, and worklog are changed; `git diff --check` has no errors.

- [x] **Step 3: Update the worklog**

Replace the design-only entry with a completion entry recording the generic-page root cause, rendered HTML reuse, retryable failure behavior, exact verification commands, no deployment, and the need to reset already-synced historical records before retrying them.

- [x] **Step 4: Commit implementation**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js docs/WORKLOG.md docs/superpowers/plans/2026-07-16-xiaohongshu-anonymous-extraction-fallback.md
git commit -m "fix(plugin): recover xiaohongshu generic landing pages"
```
