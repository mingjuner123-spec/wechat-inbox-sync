# Plugin 1.3.70 Xiaohongshu OCR Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add text-dominant Xiaohongshu OCR that starts one local OCR process per note and merges qualifying multi-image text into one continuous Markdown section, then release it together with the existing 1.3.70 fixes.

**Architecture:** Keep permissions and ordinary Xiaohongshu extraction unchanged. Add a versioned temporary Python batch runner embedded in `main.js`, normalize its structured geometry/confidence result in JavaScript, apply explicit text-dominance policy, and merge only qualifying pages. Reuse the existing installed OCR Python environment so current users do not reinstall components and no CloudBase/CDN deployment is required.

**Tech Stack:** Obsidian/Electron plugin JavaScript, Node `child_process`/`fs`, Python 3, RapidOCR, Pillow, Node `assert` regression tests, GitHub Release workflow.

---

### Task 1: Lock text-dominance and merged-output behavior with RED tests

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify later: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Add failing policy fixtures**

Add fixtures that call exported helpers with:

```js
const textCard = {
  index: 1,
  text: '这是一张以正文为主体的长文字卡片，包含足够多的连续内容用于验证主体判定。'.repeat(3),
  metrics: {
    readableChars: 120,
    lineCount: 8,
    averageConfidence: 0.92,
    textBoxAreaRatio: 0.16,
    coveredRowRatio: 0.22,
    verticalSpanRatio: 0.62,
  },
};

const captionedPhoto = {
  index: 2,
  text: '照片标题\n一行字幕\n品牌水印',
  metrics: {
    readableChars: 18,
    lineCount: 3,
    averageConfidence: 0.91,
    textBoxAreaRatio: 0.03,
    coveredRowRatio: 0.04,
    verticalSpanRatio: 0.12,
  },
};
```

Assert that `isXiaohongshuTextDominantOcrItem(textCard)` is true, the photo is false, and `normalizeXiaohongshuOcrItems([textCard, captionedPhoto])` keeps only the text card.

- [ ] **Step 2: Add failing merged Markdown fixtures**

Create two qualifying pages whose boundary shares two identical lines. Assert:

```js
const markdown = helpers.buildXiaohongshuOcrMarkdown([page1, page2]);
assert.ok(markdown.startsWith('## 图片文字\n\n'));
assert.doesNotMatch(markdown, /### 图片\s*\d+/);
assert.strictEqual((markdown.match(/共同边界句/g) || []).length, 1);
assert.ok(markdown.indexOf('第一页正文') < markdown.indexOf('第二页正文'));
```

Also assert repeated prose inside one page is not globally removed.

- [ ] **Step 3: Run the test to verify RED**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: FAIL because `isXiaohongshuTextDominantOcrItem` and merged-boundary behavior do not exist.

- [ ] **Step 4: Commit the RED tests**

```powershell
git add tests/plugin-main-ai.test.js
git commit -m "test(plugin): define text-dominant OCR output"
```

### Task 2: Implement the pure OCR policy and merge layer

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Add named thresholds and metric normalization**

Add constants for trusted-box confidence, average confidence, long-text and large-card thresholds. Implement:

```js
function normalizeXiaohongshuOcrMetrics(metrics = {}, text = '') {
  return {
    readableChars: finiteNonNegative(metrics.readableChars, countReadableOcrChars(text)),
    lineCount: finiteNonNegative(metrics.lineCount, splitOcrLines(text).length),
    averageConfidence: finiteRatio(metrics.averageConfidence),
    textBoxAreaRatio: finiteRatio(metrics.textBoxAreaRatio),
    coveredRowRatio: finiteRatio(metrics.coveredRowRatio),
    verticalSpanRatio: finiteRatio(metrics.verticalSpanRatio),
  };
}
```

Malformed, negative, or non-finite values must normalize safely.

- [ ] **Step 2: Implement text-dominance policy**

Implement and export:

```js
function isXiaohongshuTextDominantOcrItem(item = {}) {
  // long-text route, large-card route, and strict geometry-missing fallback
}
```

Update `normalizeXiaohongshuOcrItems()` to preserve index order and retain only text-dominant items. Remove the old 15-character inclusion rule.

- [ ] **Step 3: Implement boundary-only overlap removal**

Implement:

```js
function mergeXiaohongshuOcrText(items = [], maxOverlapLines = 8) {
  // compare only accumulated tail against next-page head
  // preserve repeated lines elsewhere
}
```

Use normalized comparison keys but retain the original display text.

- [ ] **Step 4: Replace per-image headings**

Make `buildXiaohongshuOcrMarkdown()` return exactly one `## 图片文字` section followed by merged text. Return an empty string when no item qualifies.

- [ ] **Step 5: Run GREEN tests**

Run:

```powershell
node tests/plugin-main-ai.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix(plugin): filter and merge Xiaohongshu OCR text"
```

### Task 3: Lock one-process batch execution with RED tests

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify later: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Add request-level process-count test**

Create a plugin instance with stubbed component readiness and downloaded image payload. Stub `runLocalImageOcrBatch` and count calls. Supply ten images and assert:

```js
assert.strictEqual(batchCalls, 1);
assert.strictEqual(receivedEntries.length, 10);
```

Assert `runLocalImageOcr` is never called.

- [ ] **Step 2: Add batch-result resilience test**

Return two successful items and one item-level error from the batch stub. Assert only successful, text-dominant items are returned and source indexes remain ordered.

- [ ] **Step 3: Add ordinary-extraction failure test**

Make the batch method throw. Call `enrichXiaohongshuExtractionWithOcr()` and assert original Markdown, title, tags, and image URLs are unchanged while `ocrError` is populated.

- [ ] **Step 4: Run the test to verify RED**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: FAIL because the request path still loops over `runLocalImageOcr`.

- [ ] **Step 5: Commit the RED tests**

```powershell
git add tests/plugin-main-ai.test.js
git commit -m "test(plugin): require one OCR process per note"
```

### Task 4: Implement the single-process OCR batch runner

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Add a versioned embedded Python runner**

Add `LOCAL_OCR_BATCH_RUNNER_VERSION = 'xiaohongshu-batch-v1'` and a Python source constant that:

- reads `--batch-manifest` and `--output`;
- imports `RapidOCR` from `rapidocr_onnxruntime`, falling back to `rapidocr`;
- initializes the engine once;
- supports tuple/list and object-style RapidOCR results;
- reads image dimensions with Pillow;
- emits trusted line boxes, text, confidence, and layout metrics;
- catches errors per image;
- never emits source image content or URLs.

- [ ] **Step 2: Add JavaScript batch execution**

Implement:

```js
async runLocalImageOcrBatch(imageEntries = []) {
  // create runner, manifest, and result files in one temporary directory
  // execFile exactly once
  // parse schemaVersion 1 defensively
  // always clean the temporary directory
}
```

Use the installed `pythonPath`; do not pass `--batch-manifest` to the user's legacy installed `ocr_image.py`.

- [ ] **Step 3: Replace the per-image loop**

In `requestXiaohongshuImageOcr()`:

- download images before requesting component installation when possible;
- write all downloaded images to one temporary directory;
- call `runLocalImageOcrBatch(entries)` exactly once;
- map results back to source image URL/index;
- ignore item-level errors;
- return normalized text-dominant items.

- [ ] **Step 4: Run GREEN tests**

Run:

```powershell
node tests/plugin-main-ai.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix(plugin): batch Xiaohongshu image OCR"
```

### Task 5: Protect package, permissions, and the existing 1.3.70 fixes

**Files:**
- Modify if required: `tests/plugin-marketplace-package.test.js`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/WORKLOG.md`
- Verify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] **Step 1: Add source/package assertions**

Assert the release source contains the batch runner marker, the one-process path, the `## 图片文字` heading, and no production `### 图片 ${...}` OCR rendering.

- [ ] **Step 2: Re-run capability boundary tests**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: free users still invoke OCR zero times, Pro non-video notes retain the capability, video notes skip it, and comment permissions remain unchanged.

- [ ] **Step 3: Re-run the previous 1.3.70 regressions**

The same command must confirm:

- Xiaohongshu target identity remains continuous across static and hidden-browser navigation;
- current and legacy Electron event signatures remain supported;
- AI 429/5xx/timeout/empty enrichment remains nonblocking after body or transcription success;
- AI diagnostic text remains redacted;
- local ASR is not repeated after optional AI metadata failure.

- [ ] **Step 4: Record the decision and closeout evidence**

Document the one-process contract, practical text-dominance definition, no-reinstall compatibility, and the fact that rejected photos still require pixel inspection.

- [ ] **Step 5: Commit**

```powershell
git add tests/plugin-marketplace-package.test.js docs/DECISIONS.md docs/WORKLOG.md
git commit -m "docs: record text-dominant OCR contract"
```

### Task 6: Full verification, independent review, and 1.3.70 release

**Files:**
- Verify all files changed since `9c88f4787a0307f5f22afc5d9292646a97378548`
- Release from authoritative merged `main`

- [ ] **Step 1: Run complete local gates**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node tests/release-governance.test.js
node tests/plugin-release-identity.test.js
node scripts/check-local-components-manifest.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check 9c88f4787a0307f5f22afc5d9292646a97378548..HEAD
```

Expected: every command exits 0.

- [ ] **Step 2: Complete independent reviews**

Use different agents for:

- specification compliance;
- code quality/security and local-path privacy;
- regression-test sufficiency;
- final release verification.

Resolve every P0/P1/P2 issue and repeat affected gates.

- [ ] **Step 3: Push and create a PR**

Push the branch to the explicitly authorized public repository `mingjuner123-spec/wechat-inbox-sync`, create a PR, and wait for all required checks. Do not use an interactive GitHub web login.

- [ ] **Step 4: Merge and create immutable release identity**

After checks pass:

- squash merge to authoritative `main`;
- verify `main` contains the expanded 1.3.70 implementation;
- create a new annotated `1.3.70` tag only if the remote tag and Release are absent;
- let the workflow create the five release assets;
- never overwrite an existing tag or Release.

- [ ] **Step 5: Perform post-publish verification**

Run the release identity postpublish checker, compare raw manifest/version metadata, inspect the exact five assets and ZIP structure, and verify ZIP/main hashes against the merged commit.

- [ ] **Step 6: Send the completion notification**

After and only after post-publish verification succeeds, send the established Feishu completion notification with version, release URL, key behavior changes, and verification status.
