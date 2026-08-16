# Douyin Overconstraint Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the successful 1.3.30-style Douyin browser fallback while keeping precise media sources first and rejecting only an explicit final-route mismatch.

**Architecture:** Keep the existing mobile-share, detail and authenticated-session stages unchanged. Replace fail-closed browser candidate filters with deterministic primary-player ranking, and allow non-strict browser fallback when no stable aweme ID is available. Persist the decision as a project rule and regression case.

**Tech Stack:** Node.js, CommonJS, Obsidian/Electron, built-in `assert`, existing plugin build scripts.

---

### Task 1: Lock the intended fallback behavior with tests

**Files:**
- Modify: `tests/plugin-douyin-media.test.js`

- [ ] Change the foreign candidate identity case to expect the visible playing candidate instead of `[]`.
- [ ] Add cases for canonical-only mismatch, multiple unbound players, and no target ID.
- [ ] Run `node tests\plugin-douyin-media.test.js` and confirm RED because current selectors still reject at least the foreign/no-target cases.

### Task 2: Remove speculative blockers

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`

- [ ] Make `selectPrimaryDouyinDomMediaUrls` rank all playable candidates; retain target identity only as a ranking bonus.
- [ ] Make `selectIdentityBoundDouyinBrowserMedia` reject only a concrete different ID in `finalUrl`; ignore canonical/page/candidate identity for blocking.
- [ ] Allow the selector to return a primary candidate even when `targetAwemeId` is empty.
- [ ] Restore non-strict browser fallback in both `refreshDouyinMediaUrls` and the main social-media hydration path when no stable aweme ID exists.
- [ ] Run the focused source test and confirm GREEN.

### Task 3: Record the rule and incident

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/WORKLOG.md`
- Modify: `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`
- Create: `docs/incidents/2026-08-16-douyin-overconstraint.md`

- [ ] Record that no real recommendation-mistranscription incident was found.
- [ ] Require incident evidence and a failing real-world fixture before adding new extraction blockers.
- [ ] Record the actual regression chain and rollback semantics.

### Task 4: Build and verify

**Files:**
- Generate: `obsidian-plugin/wechat-inbox-sync/main.js`

- [ ] Build with `D:\AIbc\npm.cmd run build` in the plugin directory.
- [ ] Run the focused test against source and generated bundle.
- [ ] Run `tests/plugin-douyin-failure-diagnostic.test.js`, `tests/plugin-local-candidate-regressions.test.js`, `tests/plugin-main-ai.test.js`, and the plugin build drift check.
- [ ] Run source/bundle syntax checks and `git diff --check`.
- [ ] Do not publish or deploy in this task.

