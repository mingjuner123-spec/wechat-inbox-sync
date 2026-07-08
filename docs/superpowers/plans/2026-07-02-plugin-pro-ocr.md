# Plugin Pro Gate And Xiaohongshu OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate plugin Pro features by valid per-plugin entitlement and add a non-destructive Xiaohongshu OCR test section.

**Architecture:** Reuse the existing sync API entitlement flow, add `clientId` locking for redeem-code entitlements, and keep paid Pro entitlements unlocked. Add pure OCR normalization helpers in the plugin, then wire them into Xiaohongshu extraction only when Pro and the OCR test toggle are enabled.

**Tech Stack:** Obsidian plugin JavaScript, CloudBase sync API JavaScript, Tencent Cloud OCR API, Node.js tests.

---

### Task 1: Entitlement Client Lock

**Files:**
- Modify: `cloudfunctions/syncApi/sync-api-core.js`
- Modify: `cloudfunctions/syncApi/index.js`
- Modify: `cloudfunctions/syncApi/redeem-code-core.js`
- Test: `tests/sync-api-core.test.js`

- [ ] Write tests asserting `/entitlements/redeem` passes `clientId` to `repository.redeemAccessCode`, and `/entitlements/status` passes `clientId` to `repository.getEntitlement`.
- [ ] Update `requireOpenId` to return `clientId`.
- [ ] Pass `clientId` through status and redeem handlers.
- [ ] Store `clientId` and `lastRedeemedClientId` when redeeming a code.
- [ ] Filter redeem-code entitlements by `clientId`, while keeping paid entitlements valid for all plugin instances.

### Task 2: Plugin Pro Settings

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/plugin-core.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Test: `tests/plugin-core.test.js`

- [ ] Add `pendingRedeemCode` and `xiaohongshuImageOcrEnabled` settings.
- [ ] Add plugin method to redeem a code through the active binding and cache status.
- [ ] Rename and reorganize the advanced settings section into `Pro 高级选项`.
- [ ] Gate AI metadata, Xiaohongshu comments, and local ASR actions behind refreshed Pro status.

### Task 3: Xiaohongshu OCR Test

**Files:**
- Modify: `cloudfunctions/syncApi/sync-api-core.js`
- Modify: `cloudfunctions/syncApi/index.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Test: `tests/plugin-upload-sync.test.js`

- [ ] Add `/ocr/images` sync API route with Pro entitlement check.
- [ ] Implement Tencent Cloud OCR provider using `ImageBase64`.
- [ ] Add pure helpers to normalize OCR text and decide whether an image-text note has substantial text.
- [ ] Append `## 图片文字 OCR（测试版）` to Xiaohongshu markdown only when OCR returns useful text.
- [ ] Leave the original Xiaohongshu image markdown unchanged.

### Task 4: Verification

**Files:**
- Test: `tests/sync-api-core.test.js`
- Test: `tests/plugin-core.test.js`
- Test: `tests/plugin-upload-sync.test.js`

- [ ] Run focused tests for entitlement locking, settings merge, and OCR markdown.
- [ ] Run syntax checks for modified cloud and plugin files.
- [ ] Copy the updated plugin files into the real Obsidian vault plugin directory after tests pass.
