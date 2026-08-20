<!-- HARNESS_TASK_CARD_V1 -->

- Task ID: plugin-wechat-article-empty-shell-20260820-001
- Title: WeChat public-account empty-shell detection and browser body recovery
- Created: 2026-08-20
- Type: defect fix | local refactor
- Status: local verification and independent review passed; awaiting manual acceptance
- Risk level: L2
- Stage: public-account article extraction stability
- Current mainline: yes
- Branch: codex/wechat-article-body-parser-1.3.110
- Worktree: .worktrees/wechat-article-body-parser-1.3.110
- Allowed paths: obsidian-plugin/wechat-inbox-sync/src/main.js; obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils.js; obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline.js; obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils.js; obsidian-plugin/wechat-inbox-sync/main.js; tests/plugin-wechat-article-pipeline.test.js; tests/plugin-wechat-article-image-localization.test.js; tests/plugin-sync-history.test.js; docs/task-cards/plugin-wechat-article-empty-shell-20260820-001.md
- External scope: none. No real user data, cloud environment, deployment, release, version change, or local plugin replacement.

## Objective

Fix the case where WeChat returns an HTML shell without article content but the plugin saves page-tooling text as a successful article. Keep the existing static, Node, session, and hidden-browser paths. A successful article now requires a real #js_content body; when no body is available, keep the record retryable instead of saving a fake article.

## Non-goals

No login, captcha bypass, proxy, third-party scraper, video-channel, comments, cloud function, mini-program, image-policy, user binding, configuration, version, deployment, or release change.

## Evidence and scope

- User diagnostics showed all four paths returning about 17 KB shell HTML and no #js_content body, followed by a best-effort/static note containing page toolbar labels.
- This isolated branch starts at authority main@11631b57 and plugin identity 1.3.109. The stale integrated-root mirror was not used as a source.

## Implementation boundary

- wechat-article-utils extracts the complete #js_content container and recognizes text, image-first, and media-first articles.
- wechat-article-pipeline owns static/browser routing and returns retryable body_missing instead of best_effort article output.
- main.js owns the Obsidian/Electron adapter. It waits for body hydration every 500 ms for up to 15 seconds and reports bodyFound only after a real body is extracted.
- sync-lifecycle-utils rejects legacy successful notes that contain known WeChat empty-shell toolbar text.

## Acceptance criteria

- Static or session paths with real bodies save normally.
- Short text and image-first bodies are not rejected by an arbitrary length threshold.
- Shell HTML reaches the hidden browser; a rendered real body saves normally.
- No body on every path stays retryable and never creates a fake-success Markdown note.
- Existing captcha and unavailable fallback behavior is unchanged.

## Verification

- node tests/plugin-wechat-article-pipeline.test.js
- node tests/plugin-wechat-article-image-localization.test.js
- node tests/plugin-sync-history.test.js
- node tests/plugin-architecture-integration.test.js
- npm run build and npm run check in obsidian-plugin/wechat-inbox-sync
- node --check for all four changed source modules and built main.js
- git diff --check
- Independent read-only review: PASS, P0=0/P1=0/P2=0.

## Known risk and next step

WeChat may refuse to provide article content on every local path. This change makes that state transparent and retryable; it does not claim to bypass platform verification. Next step is optional manual local validation with one known shell page and one short/image-first article, then a separate explicit decision for replacement or release.
