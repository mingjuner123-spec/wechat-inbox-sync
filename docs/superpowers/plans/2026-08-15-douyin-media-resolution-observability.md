# Douyin Media Resolution Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Douyin media-resolution and download outcome attributable while preserving strict target identity and repairing the confirmed generic-route fallback.

**Architecture:** Extend the existing focused diagnostic utility with a stable, redacted trace contract. The main plugin records the existing resolver waterfall and download recovery attempts into that trace, propagates the final trace through successful and failed records, and exposes the latest Douyin trace in copied diagnostics. Existing media selection remains fail-closed for conflicting or ambiguous identities.

**Tech Stack:** Node.js, CommonJS, Obsidian desktop plugin, Electron session, built-in `assert`, existing plugin build and release scripts.

---

### Task 1: Define the redacted trace contract

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/social-media-diagnostic-utils.js`
- Modify: `tests/social-media-diagnostic-utils.test.js`

- [ ] **Step 1: Add a failing contract test**

Add a case that passes successful and failed stages plus download attempts and expects only bounded diagnostic fields:

```js
const diagnostic = buildDiagnostic({
  sourceUrl: 'https://v.douyin.com/example',
  resolvedUrl: 'https://www.douyin.com/',
  awemeId: '7644566503081119019',
  selectedStage: 'targeted-browser',
  finalOutcome: 'transcription-ready',
  stages: [{
    stage: 'targeted-browser',
    attempted: true,
    ok: true,
    mediaCount: 1,
    identityOutcome: 'page-unique-single-player',
    durationMs: 421,
  }],
  downloadAttempts: [{
    transport: 'node-http',
    ok: false,
    status: 403,
    refreshed: false,
    durationMs: 50,
  }, {
    transport: 'browser-session',
    ok: true,
    mediaType: 'video/mp4',
    bytes: 4096,
    refreshed: false,
    durationMs: 90,
  }],
});
assert.strictEqual(diagnostic.selectedStage, 'targeted-browser');
assert.strictEqual(diagnostic.finalOutcome, 'transcription-ready');
assert.strictEqual(diagnostic.stages[0].identityOutcome, 'page-unique-single-player');
assert.strictEqual(diagnostic.downloadAttempts[0].status, 403);
assert.strictEqual(JSON.stringify(diagnostic).includes('douyinvod.com'), false);
```

- [ ] **Step 2: Run the test and observe RED**

Run: `node tests\social-media-diagnostic-utils.test.js`

Expected: FAIL because `selectedStage`, `finalOutcome`, extended stage fields, and `downloadAttempts` are absent.

- [ ] **Step 3: Implement bounded normalization**

Extend `createDouyinMediaResolutionDiagnosticBuilder` to return these exact fields while accepting only scalar enums/counts and redacted URL diagnostics:

```js
const normalizeDuration = (value) => Math.max(0, Math.min(30 * 60 * 1000, Number(value) || 0));
const normalizeCount = (value) => Math.max(0, Math.min(100, Number(value) || 0));
const safeText = (value, max = 64) => String(value || '').trim().slice(0, max);
```

Normalize stages to `stage`, `attempted`, `ok`, `mediaCount`, `detailFound`, `identityOutcome`, `rejectionReason`, `durationMs`, and redacted `error`. Normalize download attempts to `transport`, `ok`, `status`, `code`, `mediaType`, `bytes`, `refreshed`, and `durationMs`. Do not accept or serialize full media URLs, headers, Cookie, Authorization, tokens, or openid.

- [ ] **Step 4: Run the contract test GREEN**

Run: `node tests\social-media-diagnostic-utils.test.js`

Expected: `social-media-diagnostic-utils tests passed`.

- [ ] **Step 5: Commit the diagnostic contract**

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/social-media-diagnostic-utils.js tests/social-media-diagnostic-utils.test.js
git commit -m "feat(plugin): define Douyin resolution trace"
```

### Task 2: Instrument all resolver stages and final selection

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `tests/plugin-douyin-media.test.js`
- Create: `tests/plugin-douyin-resolution-diagnostics.test.js`

- [ ] **Step 1: Add failing waterfall tests**

Create mocked cases for `mobile-share`, `aweme-detail`, `authenticated-session`, and `targeted-browser`. For each case assert:

```js
assert.strictEqual(result.metadata.mediaResolutionDiagnostic.selectedStage, expectedStage);
assert.strictEqual(result.metadata.mediaResolutionDiagnostic.finalOutcome, 'media-selected');
assert.ok(result.metadata.mediaResolutionDiagnostic.stages.some((stage) => (
  stage.stage === expectedStage && stage.ok === true && stage.mediaCount > 0
)));
```

Add failure cases asserting explicit `rejectionReason` values for `conflicting-target-id`, `ambiguous-unbound-players`, and `no-target-bound-media`.

- [ ] **Step 2: Run and observe RED**

Run: `node tests\plugin-douyin-resolution-diagnostics.test.js`

Expected: FAIL because the current stages lack selection, identity outcome, rejection reason, and duration.

- [ ] **Step 3: Record stages without changing resolver order**

In `hydrateWebpageMarkdown`, wrap each current stage with a start timestamp and set:

```js
const stage = {
  stage: 'mobile-share',
  attempted: true,
  ok: false,
  mediaCount: 0,
  detailFound: false,
  identityOutcome: '',
  rejectionReason: '',
  startedAt: Date.now(),
};
```

Before pushing, replace `startedAt` with `durationMs: Date.now() - stage.startedAt`. When a stage first supplies target-bound media, set `selectedStage` once and never let a lower-confidence stage overwrite it. Preserve the existing order: mobile share → detail → session → targeted browser.

- [ ] **Step 4: Preserve strict browser identity outcomes**

Keep the existing selector behavior and expose its classification to the trace:

```js
{
  urls: selectedUrls,
  identityOutcome: 'exact-debugger-payload'
    | 'exact-dom-target'
    | 'page-unique-single-player'
    | 'rejected',
  rejectionReason: ''
    | 'conflicting-target-id'
    | 'ambiguous-unbound-players'
    | 'no-target-bound-media',
}
```

The public selector may retain its URL-array return for compatibility; add a focused internal classification helper and let the existing selector return `classification.urls`.

- [ ] **Step 5: Run resolver tests GREEN**

Run:

```powershell
node tests\plugin-douyin-media.test.js
node tests\plugin-douyin-resolution-diagnostics.test.js
```

Expected: both tests pass, including multiple unbound-player rejection.

- [ ] **Step 6: Commit resolver instrumentation**

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/main.js tests/plugin-douyin-media.test.js tests/plugin-douyin-resolution-diagnostics.test.js
git commit -m "feat(plugin): trace Douyin resolver waterfall"
```

### Task 3: Trace media download and same-identity refresh

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `tests/plugin-local-candidate-regressions.test.js`
- Modify: `tests/plugin-douyin-resolution-diagnostics.test.js`

- [ ] **Step 1: Add failing download-attempt tests**

Mock direct 403 followed by browser-session success, and direct/session 403 followed by refreshed URL success. Pass `onMediaDownloadDiagnostic` and assert ordered attempts:

```js
assert.deepStrictEqual(attempts.map((item) => [item.transport, item.ok, item.refreshed]), [
  ['node-http', false, false],
  ['browser-session', true, false],
]);
```

For refresh assert no more than three refreshed candidates, only the original target source URL is used, and the total download budget remains enforced.

- [ ] **Step 2: Run and observe RED**

Run: `node tests\plugin-local-candidate-regressions.test.js`

Expected: FAIL because download attempts are not emitted.

- [ ] **Step 3: Emit bounded attempt events**

In `downloadMediaToTempFile`, add:

```js
const reportAttempt = (attempt) => {
  if (typeof options.onMediaDownloadDiagnostic === 'function') {
    options.onMediaDownloadDiagnostic(attempt);
  }
};
```

Report `node-http`, `browser-session`, `refreshed-node-http`, and `refreshed-browser-session` with `ok`, safe HTTP status/code, `refreshed`, duration, and on success the detected media type and byte count. Never include the media URL or headers.

- [ ] **Step 4: Propagate the callback into local transcription**

From `processSocialMediaTranscription` pass a callback through `runConfiguredTranscription` → `runLocalTranscription` → `downloadMediaToTempFile`, appending events to `mediaResolutionDiagnostic.downloadAttempts`. Set `finalOutcome` to `transcription-ready`, `download-failed`, `cancelled`, or `timeout` as appropriate.

- [ ] **Step 5: Run download and timeout tests GREEN**

Run:

```powershell
node tests\plugin-local-candidate-regressions.test.js
node tests\plugin-douyin-resolution-diagnostics.test.js
```

Expected: both pass; the existing three-candidate and remaining-budget assertions remain unchanged.

- [ ] **Step 6: Commit download tracing**

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/main.js tests/plugin-local-candidate-regressions.test.js tests/plugin-douyin-resolution-diagnostics.test.js
git commit -m "feat(plugin): trace Douyin media download recovery"
```

### Task 4: Preserve successful diagnostics and improve copied output

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Create: `tests/plugin-douyin-diagnostic-copy.test.js`

- [ ] **Step 1: Add failing success-copy test**

Construct a successful written item containing `mediaResolutionDiagnostic` and assert the final sync diagnostic includes a `douyinMediaDiagnostic` object. Assert `getSyncDiagnosticText()` includes the selected stage even when overall sync status is success, while credentials and full media URLs remain absent.

- [ ] **Step 2: Run and observe RED**

Run: `node tests\plugin-douyin-diagnostic-copy.test.js`

Expected: FAIL because successful resolution diagnostics are currently discarded and successful logs are omitted.

- [ ] **Step 3: Propagate the successful trace**

Return the record diagnostic from `writeRecord`:

```js
mediaResolutionDiagnostic: recordForMarkdown.metadata
  && recordForMarkdown.metadata.mediaResolutionDiagnostic
  || null,
```

At the end of `runSyncInboxOnce`, select the latest written Douyin diagnostic and include it as `douyinMediaDiagnostic` in `lastSyncDiagnostic`. Update `getSyncDiagnosticText()` to append a compact `最近抖音媒体解析` section independently of failure-log filtering.

- [ ] **Step 4: Run copy test GREEN**

Run: `node tests\plugin-douyin-diagnostic-copy.test.js`

Expected: pass; output includes stage names and no raw media URLs or credentials.

- [ ] **Step 5: Commit successful diagnostic propagation**

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/main.js tests/plugin-douyin-diagnostic-copy.test.js
git commit -m "feat(plugin): retain latest Douyin resolution diagnostic"
```

### Task 5: Rebuild and run the complete regression matrix

**Files:**
- Modify generated: `obsidian-plugin/wechat-inbox-sync/main.js`
- Verify: `tests/plugin-feishu-media.test.js`
- Verify: `tests/plugin-douyin-media.test.js`
- Verify: `tests/plugin-douyin-resolution-diagnostics.test.js`
- Verify: `tests/plugin-douyin-diagnostic-copy.test.js`

- [ ] **Step 1: Build the generated bundle**

Run: `D:\AIbc\npm.cmd run build` in `obsidian-plugin/wechat-inbox-sync`.

Expected: `plugin main.js generated from src/main.js`.

- [ ] **Step 2: Run focused tests**

Run:

```powershell
node tests\social-media-diagnostic-utils.test.js
node tests\plugin-feishu-media.test.js
node tests\plugin-douyin-media.test.js
node tests\plugin-douyin-resolution-diagnostics.test.js
node tests\plugin-douyin-diagnostic-copy.test.js
node tests\plugin-local-candidate-regressions.test.js
```

Expected: all pass.

- [ ] **Step 3: Run broad plugin regressions**

Run:

```powershell
node tests\plugin-main-ai.test.js
node tests\plugin-social-media-transcript-context.test.js
node tests\sync-audio-repeat-dedupe.test.js
node tests\plugin-audio-repeat-local-dedupe.test.js
node tests\plugin-marketplace-package.test.js
```

Expected: all pass; save-original-media on/off and repeated audio/video behavior remain intact.

- [ ] **Step 4: Check source/bundle identity and diff hygiene**

Run:

```powershell
D:\AIbc\npm.cmd run check
node --check obsidian-plugin\wechat-inbox-sync\src\main.js
node --check obsidian-plugin\wechat-inbox-sync\main.js
git diff --check
```

Expected: all exit 0.

- [ ] **Step 5: Request independent review**

Reviewer must inspect target identity, ambiguous player rejection, diagnostic redaction, download retry bounds, Feishu Markdown replacement, test adequacy, and report P0/P1/P2. Any finding is fixed and re-reviewed before release preparation.

- [ ] **Step 6: Commit the tested candidate**

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js docs tests
git commit -m "fix(plugin): complete Douyin resolution diagnostics"
```

### Task 6: Prepare and publish the next immutable plugin release

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: root release mirrors and candidate receipt only through the repository release scripts
- Modify: `docs/WORKLOG.md`
- Create: next-version release task card under `docs/task-cards/`

- [ ] **Step 1: Verify the remote baseline**

Confirm remote `main`, latest annotated tag, GitHub Release and raw manifest still identify 1.3.87. If remote moved, rebase/cherry-pick the tested commits onto the new clean authority and rerun Task 5; never overwrite newer work.

- [ ] **Step 2: Select the next unused patch version**

Use the next version after the verified remote latest release. Update manifest and versions through the established release scripts; do not edit only one mirror.

- [ ] **Step 3: Generate and verify the immutable candidate**

Run the existing candidate creation, release identity, marketplace, governance, manifest drift and Windows deployer checks. Expected: candidate identity, source, bundle, root mirrors and ZIP agree exactly.

- [ ] **Step 4: Independent final release review**

Require P0=0, P1=0, P2=0 for the complete diff from remote main to the candidate.

- [ ] **Step 5: Push branch and create PR**

Push only the isolated branch. Create a PR, wait for `guards` and `windows-deployer`, and merge only when both are green.

- [ ] **Step 6: Publish without mutating history**

Create a new annotated tag and GitHub Release containing exactly `main.js`, `manifest.json`, `styles.css`, `versions.json`, and the versioned ZIP. Never move an existing tag or overwrite an existing Release.

- [ ] **Step 7: Post-publish readback**

Verify remote main, peeled tag, raw manifest, versions map, Release assets and downloaded ZIP all match. Record the commit, tag object, asset sizes and SHA-256 in the task card and `docs/WORKLOG.md`.
