# Release Pipeline Root-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make current `origin/main` the only publishable source and make local-component CDN assets content-addressed, manifest-verified, and continuously monitored.

**Architecture:** A pure Node manifest/guard core provides testable release invariants. CI, tag Release, and a controlled PowerShell CloudBase deploy command consume the same committed component manifest and refuse stale, dirty, mutable, or hash-mismatched sources.

**Tech Stack:** Node.js 24, GitHub Actions YAML, PowerShell 5.1, Git, CloudBase CLI.

---

### Task 1: Release-governance contract tests

**Files:**
- Create: `tests/release-governance.test.js`
- Test: `tests/release-governance.test.js`

- [x] **Step 1: Write failing tests**

Assert that the repository contains a canonical component manifest, manifest checker, release-source guard, controlled deploy script, `main` CI workflow, scheduled CDN workflow, full-history tag checkout, main-equality guard, immutable paths, compatibility aliases, and LF rules for ASR scripts.

- [x] **Step 2: Run the test and verify RED**

Run: `node tests/release-governance.test.js`

Expected: FAIL because the manifest and governance files do not exist.

- [x] **Step 3: Keep the test focused on externally observable repository contracts**

The test reads real repository files and invokes exported pure helpers. It does not mock GitHub Actions or CloudBase.

### Task 2: Canonical component manifest

**Files:**
- Create: `scripts/local-component-manifest-core.js`
- Create: `scripts/update-local-components-manifest.js`
- Create: `obsidian-plugin/wechat-inbox-sync/local-components-manifest.json`
- Modify: `.gitattributes`
- Modify: `tests/release-governance.test.js`

- [x] **Step 1: Add failing unit cases**

Cover LF/CRLF canonical equivalence, full-hash immutable paths, source-change mismatch, manifest schema validation, and compatibility alias preservation.

- [x] **Step 2: Run and verify RED**

Run: `node tests/release-governance.test.js`

Expected: FAIL because manifest helpers are missing.

- [x] **Step 3: Implement canonical hashing and manifest validation**

Normalize text files to UTF-8 LF, hash with SHA-256, and build immutable paths under `local-components/by-sha256/`.

- [x] **Step 4: Generate and commit the current manifest**

Run: `node scripts/update-local-components-manifest.js --write`

Then run: `node scripts/update-local-components-manifest.js --check`

Expected: PASS and no manifest drift.

### Task 3: Source and tag guards

**Files:**
- Create: `scripts/release-source-guard-core.js`
- Create: `scripts/release-source-guard.js`
- Modify: `tests/release-governance.test.js`

- [x] **Step 1: Add failing tests**

Cover clean current main success, dirty status rejection, stale local HEAD rejection, stale tag rejection, manifest/tag version mismatch, and current tag success.

- [x] **Step 2: Run and verify RED**

Run: `node tests/release-governance.test.js`

Expected: FAIL because guard helpers are missing.

- [x] **Step 3: Implement pure comparisons and CLI Git probes**

The CLI reads `git status --porcelain`, local HEAD, `git ls-remote origin refs/heads/main`, and optional tag/manifest values. Deployment mode accepts any clean checkout whose HEAD exactly equals remote `origin/main`; tag mode requires tag SHA equal remote main. The invariant is commit identity, not the local branch label, so clean release worktrees remain usable without weakening stale-source protection.

- [x] **Step 4: Run and verify GREEN**

Run: `node tests/release-governance.test.js`

Expected: PASS.

### Task 4: CI and tag Release enforcement

**Files:**
- Create: `.github/workflows/main-guards.yml`
- Modify: `.github/workflows/release.yml`
- Create: `.github/workflows/component-integrity.yml`
- Modify: `tests/release-governance.test.js`

- [x] **Step 1: Add failing workflow assertions**

Assert `main` push/PR triggers, Node 24 setup, governance tests, plugin tests, manifest check, shell syntax, full tag history, remote-main fetch, release guard, CDN integrity check, and version-tag-only trigger.

- [x] **Step 2: Run and verify RED**

Run: `node tests/release-governance.test.js`

Expected: FAIL against current workflows.

- [x] **Step 3: Implement workflows**

Keep commands identical between main guards and Release where practical. Release creation remains the final step.

- [x] **Step 4: Run and verify GREEN**

Run: `node tests/release-governance.test.js`

Expected: PASS.

### Task 5: Controlled CDN deployment and integrity verifier

**Files:**
- Create: `scripts/check-local-components-cdn.js`
- Create: `scripts/deploy-local-components.ps1`
- Modify: `scripts/check-local-ocr-cdn.js`
- Modify: `tests/release-governance.test.js`

- [x] **Step 1: Add failing contracts**

Assert dry-run default, `-Execute` opt-in, release-source guard invocation, immutable-first ordering, mismatch refusal, compatibility update after immutable verification, CloudBase object download, public cache-busted fetch, and final hash comparison.

- [x] **Step 2: Run and verify RED**

Run: `node tests/release-governance.test.js`

Expected: FAIL because deployment and generic integrity scripts do not exist.

- [x] **Step 3: Implement the generic verifier**

Read the committed manifest and verify canonical source, immutable public URL, compatibility alias, and public manifest. Preserve `check-local-ocr-cdn.js` as a compatibility wrapper.

- [x] **Step 4: Implement the PowerShell deploy command**

Use exact manifest paths and CloudBase environment `he02-d8gebzv050ed6c4ef-d350b93bf`; never construct a destructive filesystem operation from remote output.

- [x] **Step 5: Run and verify GREEN**

Run: `node tests/release-governance.test.js`

Expected: PASS.

### Task 6: Documentation, deployment, and final verification

**Files:**
- Modify: `RELEASE_CHECKLIST.md`
- Modify: `docs/WORKLOG.md`
- Modify: `docs/DECISIONS.md`

- [x] **Step 1: Document the source-of-truth rule**

Record that direct local-component `tcb hosting deploy` is unsupported and that emergency hotfixes must be committed to main before the next release.

- [x] **Step 2: Run all local gates**

Run:

```powershell
node tests/release-governance.test.js
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
node scripts/update-local-components-manifest.js --check
```

Also run Git Bash syntax checks for macOS installers and PowerShell AST parsing for `scripts/deploy-local-components.ps1`.

- [x] **Step 3: Commit and push governance code to main**

Verify remote main has not advanced, commit the scoped files, and push the fast-forward update.

- [x] **Step 4: Deploy immutable assets from clean main**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-local-components.ps1 -Execute
```

Expected: immutable objects, compatibility aliases, and public manifest all match the committed manifest.

- [x] **Step 5: Verify public integrity**

Run: `node scripts/check-local-components-cdn.js`

Expected: every asset reports matching source, immutable, and compatibility hashes.

- [x] **Step 6: Enable branch protection**

Require the main governance workflow through GitHub repository settings/API when permissions allow. If repository plan or permissions reject it, record that exact external limitation without weakening local and Release gates.
