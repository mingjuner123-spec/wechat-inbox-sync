<!-- HARNESS_TASK_CARD_V1 -->

- Task ID: plugin-feishu-media-release-1.3.117-20260823
- Title: Feishu image recovery diagnostics and 1.3.117 release
- Created: 2026-08-23
- Type: defect fix | release
- Status: ready for publish
- Risk level: L3
- Stage: Feishu document ingestion and plugin release
- Current mainline: 1.3.116 authority baseline at 57e83487199711f396c052bd2a9c440b0cd042d2
- Branch: codex/feishu-media-v117-20260823
- Worktree: .release-worktrees/wechat-inbox-sync-1.3.117-feishu
- Allowed paths: LICENSE; README.md; main.js; manifest.json; versions.json; release-candidate.json; obsidian-plugin/wechat-inbox-sync/LICENSE; obsidian-plugin/wechat-inbox-sync/README.md; obsidian-plugin/wechat-inbox-sync/main.js; obsidian-plugin/wechat-inbox-sync/manifest.json; obsidian-plugin/wechat-inbox-sync/versions.json; obsidian-plugin/wechat-inbox-sync/src/main.js; obsidian-plugin/wechat-inbox-sync/src/feishu-media-utils.js; tests/plugin-feishu-media.test.js; tests/plugin-feishu-image-identity-accounting.test.js; docs/task-cards/plugin-feishu-media-release-1.3.117-20260823.md
- External scope: publish plugin 1.3.117 from the public repository after checks pass. No CloudBase deployment, user data, binding state, or data.json changes.

## Objective

Keep the official Feishu API as the canonical text and image path, retain a usable authenticated-browser image URL when local image download fails, replace Feishu image placeholders deterministically, and surface a redacted per-image diagnostic in the copied sync report. Publish the verified result as 1.3.117 without regressing 1.3.116.

## License gate

Version 1.3.117 and later use the complete MIT License plus Commons Clause License Condition v1.0. Versions obtained through 1.3.116 remain under the license that accompanied them. Third-party dependency licenses are unchanged.

## Acceptance criteria

- Each Feishu image is classified as localized, remote-link, or missing; diagnostics contain no raw token or URL.
- Browser-recovered HTTP(S) image URLs are used only for unresolved images and appear in Markdown instead of a broken placeholder.
- Successful-but-incomplete Feishu results expose the Feishu diagnostic in the user-copyable sync report.
- Root and canonical plugin loose assets match; version and runtime identity are 1.3.117.
- Release candidate identity is immutable and verified against a test installation.
- GitHub release assets and tag are created only from current public main after checks pass.

## Authorization and rollback

- User authorized publishing when necessary in the 2026-08-23 Feishu task.
- Rollback is to stop rollout and retain immutable 1.3.116 assets; no tag or release is overwritten or deleted.

## Verification

- `node tests/plugin-feishu-media.test.js`
- `node tests/plugin-feishu-image-identity-accounting.test.js`
- `node tests/plugin-architecture-integration.test.js`
- `node tests/plugin-main-ai.test.js`
- `node tests/plugin-marketplace-package.test.js`
- `node tests/plugin-release-candidate.test.js`
- `node tests/plugin-release-identity.test.js`
- `node obsidian-plugin/wechat-inbox-sync/build-plugin.js --check`
- `node --check obsidian-plugin/wechat-inbox-sync/src/main.js`
- `node --check obsidian-plugin/wechat-inbox-sync/main.js`
- `git diff --check`
