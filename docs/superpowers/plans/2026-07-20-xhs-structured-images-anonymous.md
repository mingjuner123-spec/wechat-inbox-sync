# Xiaohongshu structured images and anonymous-first extraction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save one high-quality local image per Xiaohongshu slide and keep public share-note extraction usable without login.

**Architecture:** Refine the existing pure HTML extractor so structured `imageList` blocks form the authoritative image source when present. Preserve the existing sanitized meta/DOM collector only as fallback, while leaving the authenticated browser comment pipeline separate.

**Tech Stack:** Node.js, Obsidian plugin JavaScript, assertion-based regression tests.

---

### Task 1: Reproduce thumbnail/original duplication

**Files:**
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Write the failing test**

Add an HTML fixture containing two DOM thumbnails and a structured two-image `imageList` whose URLs use different asset identities. Assert that extraction returns only the two structured originals in order and that thumbnail URLs do not appear in Markdown.

- [ ] **Step 2: Run the regression test**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because the current extractor returns all four URLs.

- [ ] **Step 3: Commit the red test**

Run:

```powershell
git add tests/plugin-main-ai.test.js
git commit -m "test: reproduce Xiaohongshu thumbnail duplication"
```

### Task 2: Prefer structured images

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Implement the minimal source-selection change**

Inside `collectXiaohongshuNoteImageUrls`, collect valid URLs from structured image-array blocks into their own ordered list. If that list is non-empty, return its deduplicated result without adding meta or DOM candidates. Otherwise retain the existing sanitized meta/DOM fallback.

- [ ] **Step 2: Run focused verification**

Run:

```powershell
node tests/plugin-main-ai.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
```

Expected: PASS.

- [ ] **Step 3: Commit the implementation**

Run:

```powershell
git add obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "fix: prefer structured Xiaohongshu note images"
```

### Task 3: Release preparation and closeout

**Files:**
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: `tests/plugin-marketplace-package.test.js`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Bump the plugin patch version**

Set the release version to the next patch after `1.3.50` in both manifests, both versions maps, and the marketplace packaging assertion.

- [ ] **Step 2: Record scope and verification**

Add a worklog entry covering the duplicate-image root cause, anonymous public-page evidence, changed files, validation, risks, and release requirement.

- [ ] **Step 3: Run release verification**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node tests/release-governance.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
git status --short
```

Expected: all tests pass, governance reports all checks passing, syntax succeeds, and only intended files are modified.

- [ ] **Step 4: Commit and publish through the protected workflow**

Commit the release candidate, push the branch, create a PR, wait for `guards` and `windows-deployer`, merge, tag the new version, and verify the GitHub Release assets and default-branch metadata.
