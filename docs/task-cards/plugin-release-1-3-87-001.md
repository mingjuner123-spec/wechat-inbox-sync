# WeChat Inbox Sync 1.3.87 release task

- Task ID: `plugin-release-1-3-87-001`
- Created: 2026-08-15
- Status: in progress
- Risk: L3 (public GitHub release)
- Branch: `codex/plugin-douyin-media-hotfix-1.3.87`
- Worktree: `.worktrees/fix-transcription-diagnostic-1.3.86`
- Authoritative repository: `https://github.com/mingjuner123-spec/wechat-inbox-sync`
- Base version: `1.3.86`
- Target version: `1.3.87`

## User authorization

The user explicitly authorized fixing the Douyin extraction failure and publishing the next plugin version on 2026-08-15.

## Release scope

- Preserve target-bound Douyin media identity checks so recommendation and preload videos cannot be transcribed as the requested work.
- When exact detail payloads no longer expose `play_addr`, accept only the primary DOM media element from a page whose final or canonical URL proves the requested aweme ID.
- Recognize Douyin `modal_id` target URLs.
- On expired/403 media downloads, refresh through the same strict target-bound browser path before retrying the existing session-backed downloader.
- Preserve the already-deployed Feishu complete-image backend compatibility and all 1.3.86 behavior.

## Allowed paths

- `.github/workflows/`
- `docs/`
- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`
- `release-candidate.json`
- `obsidian-plugin/wechat-inbox-sync/`
- `scripts/`
- `tests/`

## Stop and rollback conditions

- Stop before publishing if target identity, recommendation rejection, full plugin, social transcript, marketplace package, build identity, release governance, or independent review fails.
- Do not overwrite, move, delete, or recreate an existing tag or GitHub Release.
- Do not modify installed plugin `data.json`, binding state, CloudBase records, payments, or entitlements.
- If a defect is found after publication, use a later incremented version; never mutate immutable 1.3.87 assets.

## Acceptance criteria

- Exact payload media remains first priority.
- Primary DOM media is accepted only when final/canonical page identity exactly matches the target aweme ID.
- Wrong-target, missing-identity, recommendation, and generic resource candidates remain rejected.
- Expired/403 refresh invokes the same strict target-bound browser path.
- Source and generated bundle match; full plugin, social transcript, marketplace package, release governance, and independent review are green.
- Manifest, versions, root mirrors, candidate receipt, tag, remote main, Release assets, and ZIP all identify 1.3.87.
- Release contains exactly `main.js`, `manifest.json`, `styles.css`, `versions.json`, and `wechat-inbox-sync-1.3.87.zip`.

## Execution record

- Target-identity and refresh tests were added test-first and observed failing before implementation.
- Final immutable candidate: `1.3.87-4a3716f5501a684b`; aggregate SHA-256: `4a3716f5501a684bb8ec477f04086de54f8faea04cf9c3a2d78066ef87d42f23`.
- Plugin source/bundle syntax, build identity, root mirrors, candidate promotion, social transcript, marketplace, architecture, and all 32 release workflow test groups are green.
- Release governance is 126/126; release identity is 26/26; independent final review is PASS with P0=0, P1=0, P2=0.
- Public publication is pending.
