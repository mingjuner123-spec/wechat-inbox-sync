# Invalid Bind Code Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a newly typed, unverified binding code from becoming a formal binding so an invalid code remains editable after validation fails.

**Architecture:** Keep `pendingBindCode` as draft state for current settings. Preserve the historical migration that restores a pre-settings-v2 pending code, but gate that migration by `savedSettingsVersion`; `/bind` success remains the only current path that promotes the draft into `token` and `bindings`.

**Tech Stack:** Obsidian plugin JavaScript, Node.js `assert` regression tests.

---

### Task 1: Keep current binding input as draft until validation succeeds

**Files:**
- Modify: `tests/plugin-main-ai.test.js:707-723,5786-5810`
- Modify: `obsidian-plugin/wechat-inbox-sync/main.js:1269-1307`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Write the failing settings migration test**

Add a current-settings case next to the existing legacy pending-code restoration test:

```js
{
  const draftBinding = helpers.mergeSettings({
    settingsVersion: 2,
    token: '',
    pendingBindCode: 'OBPROT93C6',
    bindings: [],
  });
  assert.strictEqual(draftBinding.token, '');
  assert.strictEqual(draftBinding.pendingBindCode, 'OBPROT93C6');
  assert.deepStrictEqual(draftBinding.bindings, []);
}
```

- [ ] **Step 2: Run the regression test and verify RED**

Run: `node tests/plugin-main-ai.test.js`

Expected: FAIL because `mergeSettings` currently promotes `pendingBindCode` into `token` and `bindings`.

- [ ] **Step 3: Gate pending-code restoration to legacy settings only**

In `mergeSettings`, replace the unconditional pending fallback with a version-gated fallback:

```js
  const canRestoreLegacyPendingBindCode = savedSettingsVersion < DEFAULT_SETTINGS.settingsVersion;
  const normalizedToken = normalizeBindCodeInput(merged.token)
    || entitlementBindingToken
    || (canRestoreLegacyPendingBindCode && !hasSourceBinding ? pendingBindToken : '');
```

Do not change `bindCurrentCode`; its existing successful `/bind` response remains responsible for promoting the code.

- [ ] **Step 4: Run the settings regression and verify GREEN**

Run: `node tests/plugin-main-ai.test.js`

Expected: PASS, including the existing legacy pending-code restoration and valid binding tests.

- [ ] **Step 5: Add the invalid `/bind` behavior regression**

Add a focused test near `runSuccessfulRebindPromotesNewPrimaryBindingTest`:

```js
async function runInvalidBindCodeRemainsEditableTest() {
  const plugin = new PluginClass();
  plugin.settings = helpers.mergeSettings({
    settingsVersion: 2,
    apiBase: 'https://example.com/sync',
    pendingBindCode: 'OBPROT93C6',
    clientId: 'test-client',
  });
  plugin.saveData = async () => {};
  plugin.requestJson = async () => {
    throw new Error('Request failed, status 403: Invalid bind code');
  };

  await plugin.bindCurrentCode();

  assert.strictEqual(plugin.settings.pendingBindCode, 'OBPROT93C6');
  assert.strictEqual(plugin.settings.token, '');
  assert.deepStrictEqual(plugin.getActiveBindings(), []);
}
```

Call it from the test runner immediately before the successful rebind test.

- [ ] **Step 6: Run focused and package regressions**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
node --check obsidian-plugin/wechat-inbox-sync/main.js
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 7: Record closeout and commit**

Add a `2026-07-21` entry to `docs/WORKLOG.md` recording the root cause, the settings-version gate, tests, scope, and release requirement. Then run:

```powershell
git add tests/plugin-main-ai.test.js obsidian-plugin/wechat-inbox-sync/main.js docs/WORKLOG.md docs/superpowers/plans/2026-07-21-invalid-bind-code-retry.md
git commit -m "fix: keep invalid binding codes editable"
```
