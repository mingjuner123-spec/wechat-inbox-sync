# Windows OCR Single-Directory Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows OCR repair transactional and automatic while retaining exactly one stable `venv` directory after completion.

**Architecture:** Build and validate a fresh OCR environment in `venv-staging`, then promote it to `venv` with a short-lived `venv-backup` rollback directory. If Windows locks the active environment, preserve the validated staging environment and a pending-switch marker; the plugin completes the switch on its next startup before any OCR process runs.

**Tech Stack:** Obsidian/Electron Node.js plugin, PowerShell 5.1, Python 3.12/RapidOCR, Node assertion tests.

---

## File map

- `obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr.ps1`: staging environment creation, health validation, promotion, rollback, and pending marker.
- `obsidian-plugin/wechat-inbox-sync/main.js`: installer freshness marker, startup pending-switch completion, one-task installation lock, and post-install status refresh.
- `tests/plugin-marketplace-package.test.js`: static Windows installer contract.
- `tests/plugin-main-ai.test.js`: plugin startup/pending-switch and install-task behavior.
- `obsidian-plugin/wechat-inbox-sync/local-ocr/README.md`: user-facing single-directory repair behavior.
- `docs/WORKLOG.md`: implementation, verification, release, risks, and next steps.

### Task 1: Define the transactional Windows installer contract

**Files:**
- Modify: `tests/plugin-marketplace-package.test.js`
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Write failing installer assertions**

Require the Windows installer to contain:

```js
assert.ok(windowsOcrInstaller.includes('$StagingVenvDir'));
assert.ok(windowsOcrInstaller.includes('$BackupVenvDir'));
assert.ok(windowsOcrInstaller.includes('$PendingSwitchPath'));
assert.ok(windowsOcrInstaller.includes('function Promote-StagedOcrEnvironment'));
assert.ok(windowsOcrInstaller.includes('single-dir-transaction-v1'));
assert.strictEqual(
  windowsOcrInstaller.includes('Remove-Item -LiteralPath $VenvDir -Recurse -Force -ErrorAction SilentlyContinue'),
  false,
);
```

Require plugin freshness validation and startup completion symbols:

```js
assert.ok(pluginMainSource.includes("source.includes('single-dir-transaction-v1')"));
assert.ok(pluginMainSource.includes('completePendingLocalOcrSwitch'));
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node tests\plugin-marketplace-package.test.js
node tests\plugin-main-ai.test.js
```

Expected: both fail because the installer has no transaction marker and the plugin has no pending-switch completion.

- [ ] **Step 3: Commit the failing tests**

```powershell
git add tests\plugin-marketplace-package.test.js tests\plugin-main-ai.test.js
git commit -m "test: define transactional Windows OCR repair"
```

### Task 2: Build and promote OCR in staging

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/local-ocr/install-local-ocr.ps1`
- Test: `tests/plugin-marketplace-package.test.js`

- [ ] **Step 1: Add transaction paths and strict cleanup**

Define:

```powershell
$StagingVenvDir = Join-Path $InstallRoot "venv-staging"
$BackupVenvDir = Join-Path $InstallRoot "venv-backup"
$PendingSwitchPath = Join-Path $InstallRoot "pending-venv-switch.json"
$InstallerCapability = "single-dir-transaction-v1"
```

Add a bounded removal helper that retries access-denied failures and throws if the path still exists. Never silently continue after failing to remove staging.

- [ ] **Step 2: Parameterize environment creation**

Change `Setup-PythonEnvironment` and uv/pip helpers to accept a target venv directory. All creation and package validation during repair must use `$StagingVenvDir`; the active `$VenvDir` remains untouched until staging is healthy.

- [ ] **Step 3: Implement promotion and rollback**

Add `Promote-StagedOcrEnvironment`:

1. Remove stale backup strictly.
2. Move active `venv` to `venv-backup` when present.
3. Move staging to `venv`.
4. Validate the promoted Python.
5. On failure, move the failed promoted directory aside/remove it and restore backup.
6. On success, remove backup and pending marker.

If moving active `venv` fails due to a lock, write UTF-8 JSON to `$PendingSwitchPath` with `staging`, `target`, `backup`, `createdAt`, and capability, then exit successfully with a distinct log line:

```text
OCR environment is ready and will be activated after Obsidian restarts.
```

- [ ] **Step 4: Run installer contract and verify GREEN**

Run:

```powershell
node tests\plugin-marketplace-package.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin\wechat-inbox-sync\local-ocr\install-local-ocr.ps1 tests\plugin-marketplace-package.test.js
git commit -m "fix: stage Windows OCR environment before promotion"
```

### Task 3: Complete pending promotion on plugin startup

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Add focused failing behavior tests**

Export a pure helper through `__test` that receives filesystem operations and paths. Verify:

- no marker returns `status: 'none'`;
- a valid staging Python promotes staging and removes backup/marker;
- promotion failure leaves marker and returns `status: 'pending'`;
- invalid staging removes the marker and returns `status: 'invalid'`;
- rollback restores the previous `venv` if promoted validation fails.

Add an `onload` contract assertion that pending completion is invoked after install state initialization and before settings UI can launch OCR.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
node tests\plugin-main-ai.test.js
```

Expected: FAIL because the helper and startup call do not exist.

- [ ] **Step 3: Implement minimal pending-switch helper**

Implement `completePendingLocalOcrSwitch` with dependency-injected filesystem functions for tests. Accept only marker paths rooted under the configured OCR directory; reject arbitrary paths. Use rename-based promotion and rollback. Do not kill system-wide Python processes.

During `onload`, initialize `localOcrInstallPromise`, then attempt completion on Windows. Log failures and leave the marker for a later restart without blocking plugin startup.

Update `isLocalOcrInstallerCurrent` to require `single-dir-transaction-v1` for Windows so cached/CDN legacy installers cannot bypass the repair.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node tests\plugin-main-ai.test.js
node --check obsidian-plugin\wechat-inbox-sync\main.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin\wechat-inbox-sync\main.js tests\plugin-main-ai.test.js
git commit -m "fix: activate staged OCR repair on restart"
```

### Task 4: Refresh status and document the user experience

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js`
- Modify: `obsidian-plugin/wechat-inbox-sync/local-ocr/README.md`
- Modify: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Write failing notice/status assertions**

Test that an immediately promoted install reports the status returned by a fresh `getLocalOcrInstallStatus()` call, while a pending switch produces a restart notice instead of “installed”.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```powershell
node tests\plugin-main-ai.test.js
```

Expected: FAIL because `doInstallLocalOcr` treats every zero-exit installer result as immediately installed.

- [ ] **Step 3: Implement result handling**

After installer exit, inspect the pending marker before declaring success:

- ready and no marker: show “图片文字识别模块已安装”;
- validated staging plus marker: show “修复已准备完成，重启 Obsidian 后自动完成”;
- neither ready nor pending: record failure and throw.

Document that the user only updates the plugin, clicks repair, and may need one Obsidian restart in the locked-file case.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node tests\plugin-main-ai.test.js
node tests\plugin-marketplace-package.test.js
node --check obsidian-plugin\wechat-inbox-sync\main.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add obsidian-plugin\wechat-inbox-sync\main.js obsidian-plugin\wechat-inbox-sync\local-ocr\README.md tests\plugin-main-ai.test.js
git commit -m "fix: report automatic OCR repair state"
```

### Task 5: Close out and release

**Files:**
- Modify: `docs/WORKLOG.md`
- Modify release metadata required by the repository release workflow.

- [ ] **Step 1: Run full scoped verification**

Run:

```powershell
node tests\plugin-main-ai.test.js
node tests\plugin-marketplace-package.test.js
node tests\plugin-core.test.js
node tests\release-governance-integration.test.js
node --check obsidian-plugin\wechat-inbox-sync\main.js
git diff --check
```

Expected: all exit 0.

- [ ] **Step 2: Update worklog**

Record goal, changed files, exact verification, Windows-only scope, no user manual filesystem operations, CDN/release actions, residual antivirus risk, and next step.

- [ ] **Step 3: Run release checklist**

Use `obsidian-plugin-release-check` to bump the next patch version, publish required assets, verify default-branch manifest/versions, tag, release assets, raw CDN manifest, and packaged ZIP.

- [ ] **Step 4: Final verification and commit**

Re-run the scoped suite after metadata changes, commit the closeout, and ensure `git status --short` contains no unexpected files.
