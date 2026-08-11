# Plugin Cloud Transcription Response Utils Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move eleven cloud-transcription response parsing and error-formatting pure functions out of the plugin entry file without changing behavior.

**Architecture:** Add one CommonJS module that depends only on `transcription-quality-utils.js`. Keep request construction, signing, HTTP calls, polling and all product orchestration in `src/main.js`; import the same function names back into the entry file so existing call sites and `__test` exports remain unchanged.

**Tech Stack:** Node.js 16 CommonJS, esbuild, built-in `assert`, existing plugin regression scripts.

---

### Task 1: Establish the module contract with a failing test

**Files:**
- Create: `tests/plugin-cloud-transcription-response-utils.test.js`

- [ ] **Step 1: Write the failing test**

Create a test that requires `../obsidian-plugin/wechat-inbox-sync/src/cloud-transcription-response-utils`, asserts all eleven exports are functions, and verifies representative Aliyun, Doubao and Tencent success/error inputs using the existing expected strings from `tests/plugin-main-ai.test.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/plugin-cloud-transcription-response-utils.test.js`

Expected: FAIL with `MODULE_NOT_FOUND` for `cloud-transcription-response-utils`.

### Task 2: Add the pure module and reconnect the entry file

**Files:**
- Create: `obsidian-plugin/wechat-inbox-sync/src/cloud-transcription-response-utils.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`

- [ ] **Step 1: Add the minimal module**

Move the eleven existing function bodies byte-for-byte into the new CommonJS module. At the top import:

```js
'use strict';

const { dedupeRepeatedTranscriptionLines } = require('./transcription-quality-utils');
```

At the bottom export the exact eleven names listed in the design.

- [ ] **Step 2: Replace local definitions with one static import**

Add a destructured `require('./cloud-transcription-response-utils')` near the other local modules, then delete only the eleven original function declarations. Do not move request builders, signing, HTTP or polling code.

- [ ] **Step 3: Run the focused test**

Run: `node tests/plugin-cloud-transcription-response-utils.test.js`

Expected: PASS.

### Task 3: Build and regression verification

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js` (generated only)

- [ ] **Step 1: Build the plugin**

Run from the plugin directory: `node build-plugin.js`

Expected: `plugin build completed`.

- [ ] **Step 2: Run regressions**

Run:

```powershell
node tests/plugin-cloud-transcription-response-utils.test.js
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node obsidian-plugin/wechat-inbox-sync/build-plugin.js --check
node --check obsidian-plugin/wechat-inbox-sync/src/main.js
node --check obsidian-plugin/wechat-inbox-sync/src/cloud-transcription-response-utils.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: all exit 0.

- [ ] **Step 3: Prove deterministic output**

Build twice and compare SHA-256 of `obsidian-plugin/wechat-inbox-sync/main.js`.

Expected: identical hashes.

### Task 4: Review and local closeout

**Files:**
- Modify: `docs/task-cards/plugin-cloud-transcription-response-utils-001.md`

- [ ] **Step 1: Request independent review**

Provide the base SHA, head diff, task card and verification outputs to one independent reviewer. Resolve every P0/P1 finding before continuing.

- [ ] **Step 2: Commit the local delivery**

Stage only the task-card allowed paths and commit with message `refactor(plugin): extract cloud transcription response utils`.

- [ ] **Step 3: Preserve the branch**

Keep the branch and Worktree for the later unified manual plugin test. Do not push, publish, deploy or replace the installed plugin.
