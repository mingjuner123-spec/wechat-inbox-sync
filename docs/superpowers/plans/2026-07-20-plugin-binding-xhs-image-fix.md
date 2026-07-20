# Plugin Binding and Xiaohongshu Image Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish plugin 1.3.49 with precise binding-invalid classification and authenticated Xiaohongshu image localization.

**Architecture:** Keep the change inside the plugin. Reuse the existing binding collection and Xiaohongshu header helpers, changing only classification, candidate selection, and the image-localization call boundary.

**Tech Stack:** Obsidian plugin JavaScript, Node.js assertion tests, PowerShell release tooling, GitHub Releases.

---

### Task 1: Binding classification and fallback

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] Add assertions proving a generic HTTP 403 is not a binding-invalid signal while explicit token errors are.
- [ ] Run `node tests/plugin-main-ai.test.js` and confirm the new assertion fails against 1.3.48.
- [ ] Add tests for successful rebind promotion and Feishu OAuth fallback from an explicitly invalid old binding.
- [ ] Implement precise classification, primary-binding promotion, and candidate fallback.
- [ ] Run `node tests/plugin-main-ai.test.js` and confirm all assertions pass.

### Task 2: Xiaohongshu image localization headers

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] Add a test that localizes Xiaohongshu Markdown and records the headers passed to `downloadArrayBuffer`.
- [ ] Run `node tests/plugin-main-ai.test.js` and confirm the test fails because 1.3.48 passes no headers.
- [ ] Pass the webpage URL into localization and call `getXiaohongshuRequestHeaders` for Xiaohongshu image downloads.
- [ ] Run the plugin tests and confirm the image is saved locally and the request includes platform headers.

### Task 3: Release 1.3.49

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/manifest.json`
- Modify: `obsidian-plugin/wechat-inbox-sync/versions.json`
- Modify: `manifest.json`
- Modify: `versions.json`
- Modify: `main.js`
- Modify: `styles.css`
- Modify: `docs/WORKLOG.md`

- [ ] Update plugin and root release assets to 1.3.49 without changing the canonical plugin-source rule.
- [ ] Build `wechat-inbox-sync-1.3.49.zip` from the canonical plugin directory.
- [ ] Run `node --check obsidian-plugin/wechat-inbox-sync/main.js`, `node tests/plugin-main-ai.test.js`, `node tests/plugin-marketplace-package.test.js`, and `git diff --check`.
- [ ] Commit, push the branch/default-branch release state, create tag `1.3.49`, and create a GitHub Release with `main.js`, `manifest.json`, `styles.css`, `versions.json`, and the ZIP.
- [ ] Run the dedicated Obsidian release checker and record the verified release URL, assets, version, and ZIP hash in `docs/WORKLOG.md`.
