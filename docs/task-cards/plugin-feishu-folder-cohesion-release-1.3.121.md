<!-- HARNESS_TASK_CARD_V1 -->

- Task ID: plugin-feishu-folder-cohesion-release-1.3.121
- Title: Release Feishu article folder cohesion fix
- Created: 2026-08-25
- Type: release
- Status: in progress
- Risk: L3
- Branch: codex/release-feishu-folder-cohesion-1.3.121
- Worktree: .release-worktrees/feishu-folder-cohesion-1.3.121
- Allowed paths: obsidian-plugin/wechat-inbox-sync; main.js; manifest.json; styles.css; versions.json; release-candidate.json; tests/plugin-social-article-folder-cohesion.test.js; tests/plugin-wechat-article-image-localization.test.js; tests/plugin-architecture-integration.test.js; docs/task-cards/plugin-feishu-folder-cohesion-release-1.3.121.md
- Release claim: mingjuner123-spec/wechat-inbox-sync 1.3.121
- Authorization: user explicitly authorized the ordered release in the active task on 2026-08-25.

## Goal

Publish 1.3.121 from public main 1.3.120, preserving every 1.3.120 change and adding only the reviewed Feishu/social-article folder cohesion fix from commit ebed4460.

## Non-goals

No CloudBase deployment, real-user-data access, installed-plugin replacement, binding, entitlement, or unrelated platform changes.

## Prohibited actions

Do not delete or move tags, overwrite a release, bypass branch protection, control the user screen, change CloudBase, or touch data.json.

## Verification

Run focused Feishu folder/image tests, the authoritative full plugin regression, marketplace packaging, license audit, source/bundle/mirror identity checks, independent review, prepublish checks, four-layer acceptance, and post-release readback.

## Rollback

Leave 1.3.120 unchanged. Stop before tagging if gates fail. If a post-release regression is confirmed, publish a new corrective version; never retag or overwrite 1.3.121.
