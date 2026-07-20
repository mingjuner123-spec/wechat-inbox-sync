# Windows ASR CPU Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover automatically when the optimized Windows whisper.cpp binary cannot execute on an older or restricted CPU/VM.

**Architecture:** The Windows installer continues to try the existing optimized x64 package first. It recognizes only Windows illegal-instruction status `0xC000001D`, removes that variant's cache, and installs a separately cached CPU-baseline archive. The compatibility archive is compiled from pinned whisper.cpp source with native CPU feature flags disabled and is published before the installer alias is updated.

**Tech Stack:** PowerShell 5.1 installer, Node.js assertion tests, CMake/MSVC Windows build, controlled CloudBase local-component deployment.

---

### Task 1: Lock the installer contract with a failing test

**Files:**

- Modify: `tests/plugin-marketplace-package.test.js`
- Test: `tests/plugin-marketplace-package.test.js`

- [ ] **Step 1: Require the absent compatibility contract**

Add these assertions:

```js
assert.ok(windowsInstaller.includes('$WhisperWindowsCompatibilityUrls = @()'));
assert.ok(windowsInstaller.includes('whisper-bin-x64-compat.zip'));
assert.ok(windowsInstaller.includes('function Test-IllegalInstructionExitCode'));
assert.ok(windowsInstaller.includes('0xC000001D'));
assert.ok(windowsInstaller.includes('Current whisper.cpp uses unsupported CPU instructions; trying the compatibility build.'));
assert.ok(windowsInstaller.includes('Join-Path $CacheRoot "whisper-compat.zip"'));
```

- [ ] **Step 2: Verify red**

Run `node tests/plugin-marketplace-package.test.js`. It must fail because the current installer lacks the compatibility contract.

### Task 2: Implement narrow fallback behavior

**Files:**

- Modify: `obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1`
- Test: `tests/plugin-marketplace-package.test.js`

- [ ] **Step 1: Add compatibility asset source**

Initialize `$WhisperWindowsCompatibilityUrls` from the controlled Windows component base URL using `whisper-bin-x64-compat.zip`; preserve the current optimized source and its official fallback.

- [ ] **Step 2: Add exact classifier**

Add this function after `Assert-ExecutableRuns`:

```powershell
function Test-IllegalInstructionExitCode {
  param([int]$ExitCode)
  return $ExitCode -eq -1073741795 -or (Convert-ExitCodeToHex -ExitCode $ExitCode) -eq '0xC000001D'
}
```

- [ ] **Step 3: Add compatibility installer helper**

The helper downloads only compatibility URLs to `cache\whisper-compat.zip`, extracts expected executable files, replaces the existing `whisper` directory through existing `Install-ExtractedPackage`, and validates `--help`.

- [ ] **Step 4: Use helper only for illegal instruction**

At both optimized `--help` validation points, call the helper only when `Test-IllegalInstructionExitCode` is true. All other errors still throw. Print the required fallback message before switching.

- [ ] **Step 5: Verify green**

Run `node tests/plugin-marketplace-package.test.js`; it must pass.

### Task 3: Build and verify a CPU-baseline archive

**Files:**

- Create: `scripts/build-windows-whisper-compat.ps1`
- Create: `scripts/verify-windows-whisper-compat.ps1`

- [ ] **Step 1: Build pinned source**

Build whisper.cpp `v1.9.0` in x64 Release with `GGML_NATIVE=OFF`, `GGML_AVX=OFF`, `GGML_AVX2=OFF`, `GGML_FMA=OFF`, and `GGML_F16C=OFF`. Package `whisper-cli.exe`, `main.exe` when present, and adjacent runtime DLLs as `whisper-bin-x64-compat.zip`.

- [ ] **Step 2: Verify layout and runtime**

Extract into a contained temporary directory, assert `whisper-cli.exe` or `main.exe` exists, run `--help`, and output the SHA-256. Fail for a missing binary or nonzero result.

- [ ] **Step 3: Run parser, build, and verification**

Run PowerShell AST parser checks, the build script, then the verifier. Preserve the SHA-256 for deployment verification.

### Task 4: Controlled publication and regression

**Files:**

- Modify: `docs/WORKLOG.md`
- Test: `tests/plugin-marketplace-package.test.js`, `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Publish the archive before installer alias changes**

Upload `whisper-bin-x64-compat.zip` as `local-asr/windows/whisper-bin-x64-compat.zip`; download it back with cache bypass and compare its SHA-256 to Task 3.

- [ ] **Step 2: Run guarded installer deployment**

Run `powershell -ExecutionPolicy Bypass -File scripts/deploy-local-components.ps1 -Execute`, then verify the public installer alias.

- [ ] **Step 3: Run full source regression**

Run:

```powershell
node tests/plugin-marketplace-package.test.js
node tests/plugin-main-ai.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
git status --short
```

- [ ] **Step 4: Close out**

Update `docs/WORKLOG.md` using `docs/TASK_CLOSEOUT_TEMPLATE.md`, recording the root cause, archive SHA-256, deployment evidence, tests, performance tradeoff, and the instruction for affected users to click “安装/更新本地转写组件” once.
