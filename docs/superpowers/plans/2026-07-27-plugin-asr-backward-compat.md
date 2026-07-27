# ASR Backward Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a previously working Windows ASR installation usable after a plugin update, even when the installer CDN is unavailable, while preserving hard failures for missing or genuinely incompatible components.

**Architecture:** Split ASR script assessment into “current”, “known-compatible legacy”, and “hard-incompatible” states. Current and legacy compatibility are limited to normalized SHA-256 identities of formally released scripts, so marker-complete but damaged or modified scripts fail closed. The plugin treats the known-compatible legacy script as ready and recommends an optional upgrade without automatically entering the network repair path. The Windows installer updates `transcribe.ps1` transactionally with a candidate file, backup, validation, committed completion state, best-effort cleanup, and pre-completion failure restoration.

**Tech Stack:** Obsidian plugin JavaScript, Node assert-based regression tests, Windows PowerShell installer, Markdown release governance.

---

### Task 1: Lock the compatibility regression in tests

**Files:**
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Add a legacy-script fixture**

Derive the immediately previous Windows transcribe template by removing the `diagnostics-process-v1` marker and replacing the `ProcessStartInfo` runner markers with the prior `Start-Process`/redirect markers, while keeping heartbeat, repeat guard, UTF-8 handling, safe fallback, and crash diagnostics.

- [ ] **Step 2: Assert the desired compatibility state**

Assert that the fixture reports `scriptOutdated: false`, `upgradeRecommended: true`, and `compatibilityMode: 'legacy-start-process'`; assert a temporary installation containing that script plus Whisper, FFmpeg, and the model reports `ready: true` with no missing reasons.

- [ ] **Step 3: Assert offline automatic repair does not run**

Make `checkAndRepairLocalAsr()` receive the known-compatible status, configure `installLocalAsr()` to throw an HTTP 418 error if called, and assert the result is `action: 'none'` and the installer was never called.

- [ ] **Step 4: Verify the test is red**

Run `node tests/plugin-main-ai.test.js`. Expected: failure because the current code marks the legacy script outdated or omits the new compatibility metadata.

### Task 2: Implement formal-release identity compatibility

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Return explicit current metadata**

For the current diagnostics runner, return `scriptOutdated: false`, `upgradeRecommended: false`, and `compatibilityMode: 'current'`.

- [ ] **Step 2: Permit only the immediate known-compatible formal runner**

Extract the real script from formal tag `1.3.56`, normalize BOM/line endings/trailing whitespace, and require its exact SHA-256 identity. For that known script return `scriptOutdated: false`, `upgradeRecommended: true`, and `compatibilityMode: 'legacy-start-process'`.

- [ ] **Step 3: Keep older scripts blocked**

Leave prompt-bearing, no-heartbeat, missing-quality-guard, missing-script, generated-text legacy branches, unknown scripts, and scripts whose markers remain but whose normalized identity differs as `scriptOutdated: true`.

- [ ] **Step 4: Expose compatibility without treating it as missing**

Propagate `upgradeRecommended` and `compatibilityMode` through `getLocalAsrInstallStatus()`, keep `ready` true for the known-compatible branch, and add a diagnostic line that distinguishes “兼容可用，建议升级” from “过旧不可用”.

- [ ] **Step 5: Verify green**

Run `node tests/plugin-main-ai.test.js`. Expected: pass.

### Task 3: Make Windows transcribe-script replacement transactional

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1`
- Modify: `obsidian-plugin/wechat-inbox-sync/local-components-manifest.json`
- Modify: `tests/plugin-marketplace-package.test.js`

- [ ] **Step 1: Add failing static installer-contract tests**

Require the installer to create a candidate script, retain a uniquely named backup when an old script exists, restore the backup in the top-level failure path, and remove the backup only after final installation validation succeeds.

- [ ] **Step 2: Verify the installer test is red**

Run `node tests/plugin-marketplace-package.test.js`. Expected: failure because `Write-TranscribeScript` currently overwrites `transcribe.ps1` directly.

- [ ] **Step 3: Implement candidate, backup, promote, restore, and complete helpers**

Parse the embedded template before touching the installed file; write and validate a candidate; move the existing script to a unique backup; promote the candidate; return rollback state. On any pre-completion installer failure, remove the promoted script and restore the backup. After inference and installed-file validation pass, mark the transaction completed before cleanup. Backup/candidate cleanup is best-effort and may warn, but cannot trigger rollback or delete the validated new script.

- [ ] **Step 4: Regenerate the local-component manifest**

Run `node scripts/update-local-components-manifest.js` so the committed Windows ASR installer hash matches the modified canonical bytes. Do not deploy the manifest or installer.

- [ ] **Step 5: Verify green and PowerShell syntax**

Run `node tests/plugin-marketplace-package.test.js` and parse `install-local-asr.ps1` with Windows PowerShell. Expected: pass.

### Task 4: Add the release rule and close the local task

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Record the compatibility policy**

State that version freshness alone cannot invalidate an installed component. Hard blocking requires missing/corrupt files or a specifically documented incompatible capability. Optional upgrades must preserve the last working script and must not require network success to keep using it.

- [ ] **Step 2: Add the release gate**

Require automated coverage for upgrading from the immediately previous supported component with network success, HTTP 418, timeout, and missing bundled installer; all offline cases must retain the prior ready state and must not remove large assets.

- [ ] **Step 3: Run the full verification**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node scripts/update-local-components-manifest.js --check
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Request independent review**

Provide the reviewer the base SHA `5f0961c`, the final diff, this plan, and the exact compatibility/security boundaries. Fix every P0/P1 issue before closeout.

- [ ] **Step 5: Record local-only closeout**

Update `docs/WORKLOG.md` with changed paths, red-green evidence, remaining risks, and the explicit statement that no CDN deployment, push, merge, tag, Release, or user-data action occurred.
