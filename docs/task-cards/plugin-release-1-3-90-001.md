# WeChat Inbox Sync 1.3.90 release task

- Task ID: `plugin-release-1-3-90-001`
- Created: 2026-08-15
- Status: in progress
- Risk: L3 (public GitHub release)
- Branch: `codex/plugin-feishu-image-identity-accounting-1.3.89`
- Worktree: `D:\内容创作系统\ob内容同步助手 小程序\.worktrees\plugin-feishu-image-identity-accounting`
- Authoritative repository: `https://github.com/mingjuner123-spec/wechat-inbox-sync`
- Base version: `1.3.89`
- Target version: `1.3.90`

## User authorization

The user explicitly authorized fixing the Feishu image pipeline and directly publishing a new plugin version on 2026-08-15.

## Release scope

- Keep Feishu official API Markdown as the canonical title and body.
- Resolve images by stable Feishu image identity across official media, temporary URL, and one authenticated browser fallback.
- Count each unresolved image once even when several transports fail.
- Save recovered images as local vault attachments and replace the matching Markdown image with a local wiki reference.
- Preserve canonical block order for legacy responses that do not include an explicit image token array.
- Treat folder and binary-write failures as image-level failures without replacing the official body.
- No CloudBase deployment, user-data access, binding modification, payment change, local component change, or installed `data.json` replacement.

## Allowed paths

- `docs/task-cards/plugin-release-1-3-90-001.md`
- `docs/WORKLOG.md`
- `main.js`
- `manifest.json`
- `versions.json`
- `release-candidate.json`
- `obsidian-plugin/wechat-inbox-sync/main.js`
- `obsidian-plugin/wechat-inbox-sync/manifest.json`
- `obsidian-plugin/wechat-inbox-sync/src/main.js`
- `obsidian-plugin/wechat-inbox-sync/versions.json`
- `obsidian-plugin/wechat-inbox-sync/RELEASE_CHECKLIST.md`
- `tests/plugin-feishu-image-identity-accounting.test.js`
- `tests/plugin-main-ai.test.js`
- `tests/plugin-architecture-integration.test.js`
- `tests/plugin-marketplace-package.test.js`

## Stop and rollback conditions

- Stop before publishing if image identity ordering, unique failure accounting, official-body preservation, plugin regressions, release governance, version identity, or independent review fails.
- Do not overwrite, move, delete, or recreate an existing tag or GitHub Release.
- If a defect is found after publication, issue a later incremented version; never mutate immutable 1.3.90 assets.

## Acceptance criteria

- Six unique images failing through all transports are reported as six failures, not twelve or eighteen.
- Browser recovery saves every recovered image once and the canonical Markdown references each local attachment.
- Legacy responses preserve official image block order even if a temporary URL map has a different key order.
- Local folder or binary-write failure leaves official Markdown intact and reports an image-level failure.
- Source, generated bundle, root mirror, manifest, versions, candidate receipt, merged main, annotated tag, Release assets, and ZIP all identify 1.3.90.
- Release contains exactly `main.js`, `manifest.json`, `styles.css`, `versions.json`, and `wechat-inbox-sync-1.3.90.zip`.

## External action and rollback record

- Pre-publish remote readback, CI/PR result, merged commit, tag, Release, asset hashes, post-publish identity, and rollback decision will be recorded before this task is closed.
