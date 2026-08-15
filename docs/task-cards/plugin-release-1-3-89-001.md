# WeChat Inbox Sync 1.3.89 release task

- Task ID: `plugin-release-1-3-89-001`
- Created: 2026-08-15
- Status: in progress
- Risk: L3 (public GitHub release)
- Branch: `codex/douyin-relax-target-identity`
- Worktree: `D:\临时任务\plugin-release-1388-final`
- Authoritative repository: `https://github.com/mingjuner123-spec/wechat-inbox-sync`
- Base version: `1.3.88`
- Target version: `1.3.89`

## User authorization

The user explicitly authorized publishing this focused Douyin compatibility change directly from the current online 1.3.88 baseline on 2026-08-15.

## Release scope

- Do not reject target-page media merely because Douyin preloaded multiple page identities.
- When multiple unbound DOM players exist, select the strongest candidate using the existing playing, visibility, viewport, area, and source-order ranking.
- Keep hard rejection when the loaded route explicitly points to another work or a player is explicitly bound to another work.
- Preserve every 1.3.88 Feishu, diagnostic, installer, entitlement, and synchronization behavior.
- No CloudBase deployment, user data access, binding modification, payment change, or installed `data.json` replacement.

## Allowed paths

- `docs/task-cards/plugin-release-1-3-89-001.md`
- `docs/WORKLOG.md`
- `main.js`
- `manifest.json`
- `versions.json`
- `release-candidate.json`
- `obsidian-plugin/wechat-inbox-sync/main.js`
- `obsidian-plugin/wechat-inbox-sync/manifest.json`
- `obsidian-plugin/wechat-inbox-sync/src/main.js`
- `obsidian-plugin/wechat-inbox-sync/versions.json`
- `tests/plugin-douyin-media.test.js`

## Stop and rollback conditions

- Stop before publishing if explicit wrong-work rejection, candidate ranking, plugin regressions, release governance, identity checks, or independent review fails.
- Do not overwrite, move, delete, or recreate an existing tag or GitHub Release.
- If a defect is found after publication, use a later incremented version; never mutate immutable 1.3.89 assets.

## Acceptance criteria

- Mixed page identities alone no longer block a usable current player.
- Multiple unbound players select the strongest current candidate rather than failing closed.
- Explicit wrong-route and wrong-player identity tests remain rejected.
- Source, generated bundle, root mirror, manifest, versions, candidate receipt, tag, remote main, Release assets, and ZIP all identify 1.3.89.
- Release contains exactly `main.js`, `manifest.json`, `styles.css`, `versions.json`, and `wechat-inbox-sync-1.3.89.zip`.

## Pre-publish evidence

- Full release matrix: 34/34 passed, including Douyin media selection, fallback diagnostics, full plugin regression, marketplace packaging, release governance, and release identity.
- Release governance: 126/126 passed.
- Candidate: `1.3.89-92d5b1db32ad22f9`.
- Candidate aggregate SHA-256: `92d5b1db32ad22f99bef6b0f17138c9ec6cf6188e80a508f383173b4e1db80ac`.
- Root/plugin loose assets, candidate receipt, syntax, diff, local component manifest, and public CDN hashes passed.
- Independent review: PASS, P0=0, P1=0, P2=0. The reviewer confirmed explicit wrong-route and wrong-player identity rejection remains intact and no 1.3.88 Feishu, binding, sync, ASR, or OCR business behavior regressed.
- Remote re-read before publication: `origin/main=e5387f2a35e0773d9d04d1c2aa5a8b27ab8717bf`; tag `1.3.89` absent.
