<!-- HARNESS_TASK_CARD_V1 -->

- Task ID: plugin-wechat-article-request-profile-release-1.3.120
- Title: Release WeChat article request-profile recovery and diagnostics
- Created: 2026-08-25
- Type: release
- Status: in progress
- Risk: L3
- Branch: codex/release-wechat-article-url-normalization-1.3.120
- Worktree: .release-worktrees/wechat-article-url-normalization-1.3.120
- Allowed paths: obsidian-plugin/wechat-inbox-sync; main.js; manifest.json; styles.css; versions.json; release-candidate.json; tests/plugin-wechat-article-pipeline.test.js; docs/task-cards/plugin-wechat-article-request-profile-release-1.3.120.md
- Release claim: mingjuner123-spec/wechat-inbox-sync 1.3.120
- Authorization: user explicitly authorized release in the active task on 2026-08-25.

## Goal

Publish 1.3.120 from public main 1.3.119, preserving all 1.3.119 changes and adding verified WeChat article request-profile recovery and privacy-safe terminal diagnostics.

## Non-goals

No CloudBase deployment, real-user-data access, installed-plugin replacement, binding, entitlement, or unrelated feature changes.

## Prohibited actions

Do not delete or move tags, overwrite a release, bypass branch protection, control the user screen, change CloudBase, or touch data.json.

## Verification

Run focused WeChat article tests, full plugin regression, marketplace packaging, source/bundle/mirror identity checks, independent review, prepublish checks, and post-release readback.

## Rollback

Leave 1.3.119 unchanged. Stop before tagging if gates fail. If a post-release regression is confirmed, publish a new corrective version; never retag or overwrite 1.3.120.
