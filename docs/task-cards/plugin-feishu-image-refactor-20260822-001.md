<!-- HARNESS_TASK_CARD_V1 -->

- Task ID: plugin-feishu-image-refactor-20260822-001
- Title: Feishu image localization and Markdown reference refactor
- Created: 2026-08-22
- Type: defect fix | local refactor
- Status: ready for local review; local only
- Risk level: L2
- Stage: Feishu document ingestion
- Current mainline: 1.3.113 authority baseline
- Branch: codex/feishu-refactor-20260822
- Worktree: .worktrees/feishu-refactor-20260822
- Allowed paths: obsidian-plugin/wechat-inbox-sync/src/main.js; obsidian-plugin/wechat-inbox-sync/src/feishu-media-utils.js; obsidian-plugin/wechat-inbox-sync/main.js; tests/plugin-feishu-media.test.js; tests/plugin-feishu-image-identity-accounting.test.js; docs/task-cards/plugin-feishu-image-refactor-20260822-001.md
- External scope: none. No CloudBase read/write, deployment, release, local plugin replacement, user data, or data.json.

## Objective

Make Feishu image transfer auditable and deterministic: preserve image-token identity from the official API, localize each image once when possible, and always replace the corresponding Markdown placeholder with the saved Obsidian attachment. Surface OAuth media-scope and per-stage failures without changing unrelated platform rules.

## Non-goals

No changes to Feishu OAuth credentials, cloud functions, API permissions, business data, binding state, versions, release assets, or other platform extraction behavior.

## Evidence and scope

- Users report that Feishu text syncs while images return 401/403, or an attachment is present on disk but the Markdown note does not render it.
- The public plugin 1.3.113 calls `/feishu/media`; the integrated root cloud source is not a valid source for this local-only change and is not modified.
- Existing tests already cover HTML-escaped URLs, per-token failure accounting, browser recovery, canonical image ordering, and local write failures; this task adds a pure Feishu media boundary and regression coverage for token-based replacement and missing OAuth scope diagnostics.

## Acceptance criteria

- Official `docs:document.media:download` scope is detected from cached OAuth status; missing scope produces a reconnectable diagnostic and does not suppress text.
- Image tokens are normalized and deduplicated once; official, temporary, and browser assets share the same token identity.
- Saved attachments replace `feishu-image:{token}` references by token, even when source URL formatting differs or HTML entities are present.
- A saved binary with no Markdown reference is counted as a localization failure and is repaired when a matching token placeholder exists.
- Per-stage diagnostics expose counts/statuses without credentials or raw user URLs.
- Existing Feishu text and image fallback behavior remains compatible.

## Verification

- `node tests/plugin-feishu-media.test.js`
- `node tests/plugin-feishu-image-identity-accounting.test.js`
- `node tests/plugin-main-ai.test.js`
- `node obsidian-plugin/wechat-inbox-sync/build-plugin.js --check`
- `node --check obsidian-plugin/wechat-inbox-sync/src/main.js`
- `node --check obsidian-plugin/wechat-inbox-sync/main.js`
- `git diff --check`

## Review closeout

- Independent review: no P0/P1 findings. The review's P2 findings were addressed for dead legacy placeholder code, CDN source prefetch coverage, browser asset-to-token order mapping, and the saved-attachment-without-Markdown-reference path.
- Passed after the final source-to-bundle rebuild: `plugin-feishu-media.test.js`, `plugin-feishu-image-identity-accounting.test.js`, `plugin-main-ai.test.js`, `plugin-marketplace-package.test.js`, `plugin-wechat-article-image-localization.test.js`, both `node --check` targets, and `git diff --check`.
- `plugin-media-fallback-diagnostics.test.js` remains an unrelated historical fixture issue when run against this release bundle (its public-account browser fallback fixture cannot provide a hidden browser in the Node harness); it was not changed by this task.

## External actions

None performed or authorized in this task. Publishing/deployment/local replacement require a separate explicit user decision after verification.
