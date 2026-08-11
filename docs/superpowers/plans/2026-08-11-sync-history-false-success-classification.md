# History False-Success Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent fallback receipts, failed transcriptions, bad PDF extraction, and WeChat shell pages from being reported as successfully synced notes.

**Architecture:** Add a pure classifier to `sync-lifecycle-utils.js` that converts post-hydration record metadata and narrowly scoped content signatures into a safe error object. Call it inside `writeRecord` before AI enrichment and before any Markdown note write, so the existing `syncBinding` catch path reports `failed` without changing cloud contracts.

**Tech Stack:** CommonJS JavaScript, Obsidian plugin esbuild, Node `assert` tests.

---

### Task 1: Add false-success classification tests

**Files:**
- Modify: `tests/plugin-sync-history.test.js`
- Test: `tests/plugin-sync-history.test.js`

- [ ] Add assertions for `getSyncLifecycleOutcomeError` covering video-channel fallback, WeChat shell Markdown, failed PDF extraction, and valid content.
- [ ] Assert the built plugin contains the classifier call before `enrichRecordMetadataWithAi` and before `adapter.write(temporaryFilePath, markdown)`.
- [ ] Run `node tests/plugin-sync-history.test.js` and confirm RED because the helper is not exported.

Use these fixtures:

```js
assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  content: 'https://weixin.qq.com/sph/At8GEKn0cY',
  metadata: { conversionStatus: 'link_saved', transcriptionStatus: 'failed' },
}).code, 'UNSUPPORTED_PLATFORM');

assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: {
    url: 'https://mp.weixin.qq.com/s/example',
    conversionStatus: 'success',
    markdown: '微信扫一扫可打开此内容，使用完整服务',
  },
}).code, 'EXTRACTION_FAILED');

assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'file',
  metadata: { fileExt: 'pdf', conversionStatus: 'attachment_saved', conversionError: 'PDF text missing' },
}).code, 'EXTRACTION_FAILED');

assert.strictEqual(helpers.getSyncLifecycleOutcomeError({
  type: 'webpage',
  metadata: { conversionStatus: 'success', markdown: '一篇正常且可交付的正文' },
}), null);
```

### Task 2: Implement and wire the classifier

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Generated: `obsidian-plugin/wechat-inbox-sync/main.js`
- Test: `tests/plugin-sync-history.test.js`

- [ ] Add `createOutcomeError(code, message)` and `getSyncLifecycleOutcomeError(record)` to `sync-lifecycle-utils.js`, using only whitelisted status fields and narrowly scoped URL/content signals.
- [ ] Export the helper, import it in `src/main.js`, and expose it through `WechatObsidianInboxPlugin.__test`.
- [ ] In `writeRecord`, after existing audio/video incomplete handling and before AI enrichment, throw the returned error when non-null:

```js
const lifecycleOutcomeError = getSyncLifecycleOutcomeError(recordForMarkdown);
if (lifecycleOutcomeError) throw lifecycleOutcomeError;
```

- [ ] Run `npm.cmd run build` from `obsidian-plugin/wechat-inbox-sync`.
- [ ] Run `node tests/plugin-sync-history.test.js` and confirm GREEN.

### Task 3: Regression and protected local candidate

**Files:**
- Verify only; do not edit user `data.json`.

- [ ] Run `node tests/plugin-wechat-article-image-localization.test.js`, `node tests/plugin-document-text-extraction.test.js`, `node tests/plugin-main-ai.test.js`, and `node tests/plugin-local-candidate-regressions.test.js`.
- [ ] Run `npm.cmd run check`, target `node --check`, and `git diff --check`.
- [ ] Commit the reviewed source and generated `main.js` as one plugin candidate commit.
- [ ] Prepare and verify a protected candidate from that commit.
- [ ] Replace only the four installed program assets after Obsidian is closed; compare `data.json` SHA-256, binding count, and token fingerprint before and after. Do not publish or deploy anything else.
