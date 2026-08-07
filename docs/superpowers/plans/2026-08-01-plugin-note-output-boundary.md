# Plugin Note Output Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Markdown/frontmatter and final note-path computation from the plugin's `writeRecord` flow while preserving every existing user-visible output byte and all side effects.

**Architecture:** Add a dependency-injected pure helper factory in `src/note-output-plan-utils.js`. `src/main.js` keeps record processing, folder creation, attachment download, AI enrichment, Vault write, and sync state; it configures the pure helper once and calls `buildNoteOutputPlan` immediately before the existing Vault write.

**Tech Stack:** Node.js CommonJS, esbuild plugin bundle, Node `assert` regression tests.

---

## File map

- `obsidian-plugin/wechat-inbox-sync/src/note-output-plan-utils.js`: new pure Markdown/frontmatter/path planning factory. It must not import Obsidian, access the filesystem, make requests, or mutate a record.
- `obsidian-plugin/wechat-inbox-sync/src/main.js`: supplies existing helper dependencies, exposes the configured plan helper to the test surface, and replaces only the final Markdown/path assembly in `writeRecord`.
- `tests/plugin-main-ai.test.js`: direct pure-module and integration regression coverage for all five record types and both save locations.
- `docs/PLUGIN_CODE_MAP_1.3.74.md`: records the new boundary and keeps the remaining side-effect hotspots explicit.

### Task 1: Lock the pure output contract with failing tests

**Files:**
- Modify: `tests/plugin-main-ai.test.js`
- Create later: `obsidian-plugin/wechat-inbox-sync/src/note-output-plan-utils.js`

- [ ] **Step 1: Add a direct-module contract test before the implementation exists**

At the top of `tests/plugin-main-ai.test.js`, add the required import and a small test runner before `main()`:

```js
const { createNoteOutputPlanHelpers } = require('../obsidian-plugin/wechat-inbox-sync/src/note-output-plan-utils');

function runNoteOutputPlanModuleTests() {
  const output = createNoteOutputPlanHelpers({
    buildRecordIdMarker: (id) => `<!-- wechat-inbox-record-id: ${id} -->`,
    buildAiMetadataErrorComment: (error) => `<!-- ai-error: ${error.code} -->`,
    cleanDisplayUrl: (url) => String(url || '').trim(),
    defaultNotePropertyFields: 'title,author,url,synced_at,source,description,keywords',
    getRecordAuthor: (metadata) => metadata.author || '',
    getRecordDescription: (metadata) => metadata.description || '',
    getRecordKeywords: (metadata) => metadata.keywords || [],
    getRecordId: (record) => record._id || record.id || '',
    getWebpageSourcePrefix: () => '网页',
    isFeishuUrl: () => false,
    normalizeNotePropertyFields: (value) => String(value || ''),
    normalizeVaultPath: (value) => String(value || '').replaceAll('\\\\', '/'),
    buildWebpageMarkdownBody: (record) => record.metadata.markdown,
    buildFileMarkdownBody: (record) => record.metadata.markdown,
  });
  const plan = output.buildNoteOutputPlan({
    record: { _id: 'output-plan-text-1', type: 'text', content: '正文', metadata: {} },
    title: '文本标题',
    syncedAt: '2026-08-01T00:00:00.000Z',
    noteDir: '临时收集\\2026-08-01',
    propertyFields: 'title,url,synced_at',
  });
  assert.strictEqual(plan.filePath, '临时收集/2026-08-01/文本标题.md');
  assert.ok(plan.markdown.includes('title: 文本标题'));
  assert.ok(plan.markdown.includes('<!-- wechat-inbox-record-id: output-plan-text-1 -->'));
  assert.ok(plan.markdown.endsWith('正文\n'));
}
```

Call `runNoteOutputPlanModuleTests()` as the first statement of `main()`.

- [ ] **Step 2: Run the new test and verify the expected RED failure**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: failure with `Cannot find module '../obsidian-plugin/wechat-inbox-sync/src/note-output-plan-utils'`. Do not add production code until this is observed.

- [ ] **Step 3: Extend the same failing test with output parity cases**

Add calls to `helpers.buildNoteOutputPlan(...)` for text, link, webpage, voice, and file records. For each case compare the new plan's `markdown` with the current `helpers.buildMarkdownForRecord(...)` output and assert the final path:

```js
const plan = helpers.buildNoteOutputPlan({ record, title, syncedAt, noteDir });
assert.strictEqual(plan.markdown, helpers.buildMarkdownForRecord({ record, title, syncedAt }));
assert.strictEqual(plan.filePath, expectedFilePath);
```

Include one record with `metadata.aiMetadataError = { code: 'rate-limited' }` and one with a custom property list; assert that the hidden record marker, AI marker, and selected frontmatter fields are present exactly once.

- [ ] **Step 4: Commit the red test contract**

```powershell
git add tests/plugin-main-ai.test.js
git commit -m "test: define note output plan contract"
```

Expected: the commit contains tests only and `node tests/plugin-main-ai.test.js` still fails for the missing module.

### Task 2: Implement the pure note-output helper factory

**Files:**
- Create: `obsidian-plugin/wechat-inbox-sync/src/note-output-plan-utils.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Create the smallest module that satisfies the direct contract**

Create `note-output-plan-utils.js` with a CommonJS factory. It must validate its required helper dependencies once, keep `yamlValue`, frontmatter field selection, Feishu text cleanup, source-label generation, frontmatter assembly, and Markdown assembly inside the factory closure, and return only pure functions:

```js
'use strict';

function createNoteOutputPlanHelpers(dependencies = {}) {
  const {
    buildAiMetadataErrorComment,
    buildFileMarkdownBody,
    buildRecordIdMarker,
    buildWebpageMarkdownBody,
    cleanDisplayUrl,
    defaultNotePropertyFields,
    getRecordAuthor,
    getRecordDescription,
    getRecordId,
    getRecordKeywords,
    getWebpageSourcePrefix,
    isFeishuUrl,
    normalizeNotePropertyFields,
    normalizeVaultPath,
  } = dependencies;
  if (typeof defaultNotePropertyFields !== 'string') throw new TypeError('defaultNotePropertyFields is required');
  for (const helper of [buildAiMetadataErrorComment, buildFileMarkdownBody, buildRecordIdMarker, buildWebpageMarkdownBody, cleanDisplayUrl, getRecordAuthor, getRecordDescription, getRecordId, getRecordKeywords, getWebpageSourcePrefix, isFeishuUrl, normalizeNotePropertyFields, normalizeVaultPath]) {
    if (typeof helper !== 'function') throw new TypeError('note output dependency is required');
  }
  // Move the seven current output-only helpers here byte-for-byte before adding the plan wrapper.
  function buildNoteOutputPlan({ record, title, syncedAt, noteDir, propertyFields }) {
    return {
      markdown: buildMarkdownForRecord({ record, title, syncedAt, propertyFields }),
      filePath: normalizeVaultPath(`${noteDir}/${title}.md`),
    };
  }
  return { buildRecordFrontmatter, buildMarkdownForRecord, buildNoteOutputPlan };
}

module.exports = { createNoteOutputPlanHelpers };
```

Copy the current output-only logic exactly: `yamlValue`, `buildFrontmatter`, `parseNotePropertyFields`, `getRecordUrl`, Feishu property cleanup, `getRecordSourceLabel`, `buildRecordFrontmatter`, and `buildMarkdownForRecord`. Do not move `buildWebpageMarkdownBody`, `buildFileMarkdownBody`, network logic, or any method on `WechatObsidianInboxPlugin`.

- [ ] **Step 2: Run the contract test and verify GREEN**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: the module loads; direct-plan assertions and all pre-existing regressions pass.

- [ ] **Step 3: Add immutability and unsupported-type failure coverage**

In `runNoteOutputPlanModuleTests`, snapshot a webpage record with `JSON.stringify`, call `buildNoteOutputPlan`, and assert the snapshot is unchanged. Also assert the existing error is preserved:

```js
assert.throws(
  () => output.buildNoteOutputPlan({ record: { type: 'unknown', metadata: {} }, title: 'x', syncedAt: 'x', noteDir: 'inbox' }),
  /Unsupported record type: unknown/,
);
```

- [ ] **Step 4: Re-run GREEN after the new edge tests**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: exit code 0; the direct module tests prove no record mutation and the existing error wording remains stable.

- [ ] **Step 5: Commit the pure module**

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/note-output-plan-utils.js tests/plugin-main-ai.test.js
git commit -m "refactor: add pure note output plan helpers"
```

### Task 3: Bridge `writeRecord` to the plan without moving side effects

**Files:**
- Modify: `obsidian-plugin/wechat-inbox-sync/src/main.js`
- Modify: `tests/plugin-main-ai.test.js`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Add the failing bridge assertion before changing `src/main.js`**

Extend `runCanonicalVaultFolderTests` so the fake adapter records both values passed to `write`. After `writeRecord`, assert the written path equals the returned `filePath`, and assert the Markdown includes the same ID marker and text body. Add source assertions requiring the bridge call and forbidding a second direct path assembly inside `writeRecord`:

```js
assert.ok(pluginMainSource.includes('buildNoteOutputPlan({'));
assert.strictEqual(pluginMainSource.includes('const filePath = normalizeVaultPath(`${noteDir}/${title}.md`);'), false);
```

- [ ] **Step 2: Run RED and verify it fails because the bridge is absent**

Run:

```powershell
node tests/plugin-main-ai.test.js
```

Expected: a source assertion failure mentioning `buildNoteOutputPlan`.

- [ ] **Step 3: Make the minimal bridge in `src/main.js`**

Import `createNoteOutputPlanHelpers`; after the existing pure helpers are declared and before the plugin class, configure it with the existing helpers and `DEFAULT_NOTE_PROPERTY_FIELDS`. Destructure `buildRecordFrontmatter`, `buildMarkdownForRecord`, and `buildNoteOutputPlan` from that configured object. In `writeRecord`, replace only:

```js
const markdown = buildMarkdownForRecord({ ... });
const filePath = normalizeVaultPath(`${noteDir}/${title}.md`);
```

with:

```js
const outputPlan = buildNoteOutputPlan({
  record: recordForMarkdown,
  title,
  syncedAt,
  noteDir,
  propertyFields: this.settings.notePropertyFields,
});
const { markdown, filePath } = outputPlan;
```

Keep the existing `showSyncProgress` and `vault.adapter.write(filePath, markdown)` lines in their current order. Add `buildNoteOutputPlan` to `WechatObsidianInboxPlugin.__test` so parity tests exercise the exact configured helper.

- [ ] **Step 4: Run GREEN and generated-bundle checks**

Run:

```powershell
node tests/plugin-main-ai.test.js
Push-Location obsidian-plugin/wechat-inbox-sync; npm run build; npm run check; Pop-Location
node --check obsidian-plugin/wechat-inbox-sync/src/main.js
git diff --check
```

Expected: all commands exit 0. The generated `main.js` changes only because it is the checked build output; it must not be manually edited.

- [ ] **Step 5: Commit the bridge and generated source**

```powershell
git add obsidian-plugin/wechat-inbox-sync/src/main.js obsidian-plugin/wechat-inbox-sync/main.js tests/plugin-main-ai.test.js
git commit -m "refactor: route note writes through output plan"
```

### Task 4: Record the boundary and final local verification

**Files:**
- Modify: `docs/PLUGIN_CODE_MAP_1.3.74.md`
- Modify: `docs/task-cards/plugin-note-output-boundary-001.md`
- Test: `tests/plugin-main-ai.test.js`

- [ ] **Step 1: Update the code map without changing product behavior**

Add a “第二阶段” entry naming `note-output-plan-utils.js` as the pure owner of frontmatter/Markdown/final note path and explicitly list the remaining `writeRecord` responsibilities: folders, attachment/webpage/AI processing, progress, Vault write, and sync state. State that this is a local candidate only and no version has changed.

- [ ] **Step 2: Run the complete local acceptance set from the isolated worktree**

Run:

```powershell
node tests/plugin-main-ai.test.js
node tests/plugin-marketplace-package.test.js
Push-Location obsidian-plugin/wechat-inbox-sync; npm run check; Pop-Location
node --check obsidian-plugin/wechat-inbox-sync/src/main.js
git diff --check
git status --short
```

Expected: all verification commands exit 0. The only changed paths are the task card, this design/plan documentation, the code map, `src/main.js`, generated plugin `main.js`, the new pure module, and the targeted test file.

- [ ] **Step 3: Update the task card for independent review**

Change its state to `审核中`, record the exact local verification commands and their outcomes, and set the unique next step to independent L2 review. Do not mark the overall task complete.

- [ ] **Step 4: Commit documentation and hand off for independent review**

```powershell
git add docs/PLUGIN_CODE_MAP_1.3.74.md docs/task-cards/plugin-note-output-boundary-001.md docs/superpowers/plans/2026-08-01-plugin-note-output-boundary.md
git commit -m "docs: record note output refactor candidate"
```

Expected: local commits only. A separate reviewer must inspect the full diff and fresh verification output before the task can be marked complete or offered for your manual testing.

## Plan self-review

- **Spec coverage:** Task 1 locks the output contract; Task 2 creates the pure boundary; Task 3 preserves the exact `writeRecord` effect order; Task 4 documents and verifies the local-only handoff. No specification requirement is omitted.
- **No placeholders:** all changed files, commands, expected outcomes, public API names, and behavior checks are explicit.
- **Name consistency:** the sole new factory is `createNoteOutputPlanHelpers`; its public methods are `buildRecordFrontmatter`, `buildMarkdownForRecord`, and `buildNoteOutputPlan` in all tasks.
