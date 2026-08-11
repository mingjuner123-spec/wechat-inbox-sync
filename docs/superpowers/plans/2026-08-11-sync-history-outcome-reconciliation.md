# History Sync Outcome Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent false History successes and replay interrupted lifecycle reports without storing private content.

**Architecture:** Extend the focused lifecycle utility module with deliverable-evidence and local-note checks. Add a bounded, privacy-minimal lifecycle attempt queue to plugin settings and replay it before fetching pending records for each binding.

**Tech Stack:** Node.js, Obsidian plugin JavaScript, existing Node assertion tests, esbuild plugin bundle.

---

### Task 1: Deliverable evidence gate

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils.js`
- Modify: `tests/plugin-sync-history.test.js`

- [ ] Add failing cases for empty-success webpages, unrecognized App/paywall receipts, valid short text, non-PDF attachments and long technical articles.
- [ ] Run `node tests/plugin-sync-history.test.js` and verify failure occurs on the new empty-success assertion.
- [ ] Implement type-aware deliverable evidence without broad substring-only rejection.
- [ ] Build and rerun the test until green.
- [ ] Commit the focused change.

### Task 2: Existing local note validation

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `tests/plugin-sync-history.test.js`

- [ ] Add failing unit cases for a failed receipt, link-only note, valid webpage note, short text note and attachment note.
- [ ] Add a failing integration case proving a failed receipt is not sent directly to `/synced`.
- [ ] Implement `isExistingLocalNoteDeliverable(record, markdown)` and gate the existing-note return path.
- [ ] Build and rerun targeted tests until green.
- [ ] Commit the focused change.

### Task 3: Persistent lifecycle attempt queue

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `tests/plugin-sync-history.test.js`

- [ ] Add failing normalization tests for bounded, deduplicated, privacy-minimal queue entries.
- [ ] Add failing integration cases for processing, failed and committed replay plus network retention.
- [ ] Add queue defaults/normalization and plugin persistence helpers.
- [ ] Persist immediately after claim, update after commit/failure, clear only after terminal report success, and replay before pending fetch.
- [ ] Run the targeted suite until green and commit.

### Task 4: Build, regression and candidate replacement

**Files:**
- Regenerate: `obsidian-plugin/wechat-inbox-sync/main.js`
- Update: `docs/task-cards/sync-history-local-plugin-l3-004.md`

- [ ] Run `npm.cmd run build` and `npm.cmd run check` in the plugin source.
- [ ] Run plugin History, record-state, extraction, image-localization, AI and local-candidate regressions.
- [ ] Run `node --check` and `git diff --check`.
- [ ] Obtain independent P0-P3 review; fix P0/P1/P2 before proceeding.
- [ ] Prepare and verify a new immutable candidate and update the L3 task card identity.
- [ ] With Obsidian fully exited, run the protected installer against only `张张的内容创作知识库`.
- [ ] Verify four asset hashes and `data.json` SHA/binding/fingerprint invariants, then preserve the branch and worktree for rollback.
<!-- end of implementation checklist -->
